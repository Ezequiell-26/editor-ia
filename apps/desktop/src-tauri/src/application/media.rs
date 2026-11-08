//! Casos de uso del dominio Media: ingesta de archivos al proyecto y
//! verificación de assets en disco.
//!
//! La lógica pesada (copiar a `media/`, sondear con ffprobe, hashear,
//! medir) vive en `crate::media` — el dominio puro. Aquí queda la
//! orquestación que antes estaba duplicada en dos comandos IPC: el tope de
//! archivos, el formato de warnings, la confirmación de derechos y la
//! comprobación de existencia de assets.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::media::analysis::{
    parse_scene_times, parse_vmaf_score, requested_threshold, scene_filter,
};
use crate::media::subtitle_file::{
    decode_subtitle_text, subtitle_name, validate_subtitle_extension, validate_subtitle_len,
    SubtitleFile,
};
use crate::media::{import_file, resolve_inside_root, ImportOutcome};
use crate::ports::media::{
    AssetFileInfo, MediaProbe, MediaRunner, MediaTools, SceneCut, SceneDetection,
    StabilizationAnalysis, SubtitleFiles,
};
use crate::ports::projects::{ProjectDocuments, ProjectSession};
use crate::projects::service::{OpenedProject, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;

/// Máximo de rutas por llamada de `check_asset_files`.
const MAX_CHECK_PATHS: usize = 2_000;

fn file_name_label(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned())
}

/// Declara derechos de uso generado por el usuario/proveedor sobre un asset
/// recién importado (sólo cuando la persona lo confirmó).
pub fn confirm_generated_rights(asset: &mut Value, provider: Option<&str>) {
    asset["status"] = json!("ready");
    if let Some(rights) = asset.get_mut("rights").and_then(Value::as_object_mut) {
        rights.insert(
            "license".to_owned(),
            json!({ "id": "user-declared", "commercialUse": "allowed" }),
        );
        if let Some(provenance) = rights.get_mut("provenance").and_then(Value::as_object_mut) {
            provenance.insert("origin".to_owned(), json!("generated-by-provider"));
            if let Some(provider) = provider {
                provenance.insert("provider".to_owned(), json!(provider));
            }
        }
    }
}

/// Cómo se aplica el tope de importación:
/// - `MaxAssets`: sigue procesando archivos aunque fallen, y corta cuando ya
///   hay N assets importados (diálogo de importación, con aviso).
/// - `MaxPaths`: procesa como máximo N rutas y trunca en silencio
///   (tool bridges que ya produjeron los archivos).
#[derive(Debug, Clone, Copy)]
pub enum ImportLimit {
    MaxAssets(usize),
    MaxPaths(usize),
}

/// Importa archivos locales al `media/` del proyecto: copia, sondea y
/// devuelve los assets con warnings por archivo fallido.
///
/// - `skip_missing`: las rutas explícitas que ya no existen se saltean con
///   aviso propio; las del diálogo pasan por `import_file` y reportan su
///   error normal.
/// - `confirm_rights`/`provider`: declaran procedencia cuando la persona
///   confirmó derechos sobre material generado.
pub fn import_local_files(
    root: &Path,
    ffprobe: &Path,
    files: Vec<PathBuf>,
    fps_num: u32,
    fps_den: u32,
    confirm_rights: bool,
    provider: Option<&str>,
    skip_missing: bool,
    limit: ImportLimit,
) -> ImportOutcome {
    let mut outcome = ImportOutcome {
        assets: Vec::new(),
        warnings: Vec::new(),
    };
    let max_paths = match limit {
        ImportLimit::MaxPaths(max) => max,
        ImportLimit::MaxAssets(_) => usize::MAX,
    };
    for file in files.into_iter().take(max_paths) {
        if let ImportLimit::MaxAssets(max) = limit {
            if outcome.assets.len() >= max {
                outcome
                    .warnings
                    .push(format!("Se importaron solo los primeros {} archivos.", max));
                break;
            }
        }
        if skip_missing && !file.is_file() {
            outcome
                .warnings
                .push("Se salteó un artefacto que ya no existe en esa ruta.".to_owned());
            continue;
        }
        match import_file(root, &file, ffprobe, fps_num.max(1), fps_den.max(1)) {
            Ok(mut asset) => {
                if confirm_rights {
                    confirm_generated_rights(&mut asset, provider);
                }
                outcome.assets.push(asset);
            }
            Err(error) => {
                outcome
                    .warnings
                    .push(format!("{}: {}", file_name_label(&file), error.message))
            }
        }
    }
    outcome
}

/// Verifica que cada ruta relativa sigue resolviendo dentro del root del
/// proyecto y reporta bytes reales en disco.
pub fn check_asset_files(root: &Path, paths: Vec<String>) -> Vec<AssetFileInfo> {
    paths
        .into_iter()
        .take(MAX_CHECK_PATHS)
        .map(|path| match resolve_inside_root(root, &path) {
            Ok(resolved) => {
                let bytes = std::fs::metadata(&resolved).map(|m| m.len()).unwrap_or(0);
                AssetFileInfo {
                    path,
                    exists: bytes > 0,
                    bytes,
                }
            }
            Err(_) => AssetFileInfo {
                path,
                exists: false,
                bytes: 0,
            },
        })
        .collect()
}

/// Error cuando ffprobe no está disponible (compartido por los comandos de
/// importación).
pub fn require_ffprobe(ffprobe: Option<PathBuf>) -> Result<PathBuf, ProjectError> {
    ffprobe.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible; sin medir el material no se puede importar",
        )
    })
}

// ---------------------------------------------------------------------------
// Análisis de medios (escenas, estabilización)
// ---------------------------------------------------------------------------

/// Asset de video listo para análisis: existe en el proyecto, es `video`,
/// está `ready` y su fuente resuelve dentro del root.
fn ready_video_asset(
    opened: &OpenedProject,
    root: &Path,
    asset_id: &str,
    action: &str,
    subject: &str,
) -> Result<(Value, PathBuf), ProjectError> {
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                format!("el material que se quiere {action} no está en el proyecto").as_str(),
            )
        })?;
    if asset["kind"].as_str() != Some("video") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("{subject} sólo se aplica a videos").as_str(),
        ));
    }
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            format!("el video no está listo para {action}").as_str(),
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del video no está en disco",
        ));
    }
    Ok((asset, path))
}

fn session_project(
    session: &dyn ProjectSession,
    documents: &dyn ProjectDocuments,
) -> Result<(crate::ports::projects::ProjectSessionInfo, OpenedProject), ProjectError> {
    let info = session.require()?;
    let opened = documents.open(&info.path)?;
    Ok((info, opened))
}

/// Detecta cortes de escena de un asset de video del proyecto abierto.
pub fn detect_scenes(
    session: &dyn ProjectSession,
    documents: &dyn ProjectDocuments,
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    asset_id: &str,
    threshold: f64,
) -> Result<SceneDetection, ProjectError> {
    let ffmpeg = tools.ffmpeg_path().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para analizar escenas",
        )
    })?;
    let (info, opened) = session_project(session, documents)?;
    let (asset, path) = ready_video_asset(
        &opened,
        &info.root,
        asset_id,
        "analizar",
        "la detección de escenas",
    )?;
    let fps_num = asset["media"]["frameRate"]["num"]
        .as_u64()
        .unwrap_or(30)
        .max(1) as u32;
    let fps_den = asset["media"]["frameRate"]["den"]
        .as_u64()
        .unwrap_or(1)
        .max(1) as u32;
    let duration_frames = asset["media"]["durationFrames"].as_u64().unwrap_or(0);
    let threshold = requested_threshold(threshold);
    let filter = scene_filter(threshold);

    let args = [
        "-hide_banner".to_owned(),
        "-nostats".to_owned(),
        "-i".to_owned(),
        path.to_string_lossy().into_owned(),
        "-vf".to_owned(),
        filter,
        "-an".to_owned(),
        "-f".to_owned(),
        "null".to_owned(),
        "-".to_owned(),
    ];
    let output = runner.run_ffmpeg(&ffmpeg, &args, None).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para analizar escenas",
        )
    })?;
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo analizar el video: {}",
                sanitize_log(&stderr, &info.root, 300)
            )
            .as_str(),
        ));
    }

    let fps = fps_num as f64 / fps_den as f64;
    let cuts = parse_scene_times(&stderr)
        .into_iter()
        .filter_map(|seconds| {
            let frame = (seconds * fps).round() as u64;
            if frame == 0 || (duration_frames > 0 && frame >= duration_frames) {
                None
            } else {
                Some(SceneCut { frame, seconds })
            }
        })
        .collect();
    Ok(SceneDetection {
        cuts,
        duration_frames,
        fps_num,
        fps_den,
        threshold,
    })
}

/// Analiza el movimiento de cámara de la ventana del clip y escribe el `.trf`
/// en `media/stabilizers` del proyecto.
pub fn analyze_stabilization(
    session: &dyn ProjectSession,
    documents: &dyn ProjectDocuments,
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    asset_id: &str,
    in_frame: u64,
    out_frame: u64,
    smoothing: u32,
) -> Result<StabilizationAnalysis, ProjectError> {
    let ffmpeg = tools.ffmpeg_path().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para estabilizar",
        )
    })?;
    let (info, opened) = session_project(session, documents)?;
    let (_asset, path) = ready_video_asset(
        &opened,
        &info.root,
        asset_id,
        "estabilizar",
        "la estabilización",
    )?;
    if out_frame <= in_frame {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la ventana de estabilización no es válida",
        ));
    }
    let fps_num = opened.project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0)
        .max(1.0);
    let fps_den = opened.project["video"]["frameRate"]["den"]
        .as_f64()
        .unwrap_or(1.0)
        .max(1.0);
    let fps = fps_num / fps_den;
    let in_seconds = in_frame as f64 / fps;
    let duration = (out_frame - in_frame) as f64 / fps;
    if !duration.is_finite() || duration <= 0.0 || duration > 3_600.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la ventana de estabilización no es válida",
        ));
    }
    let smoothing = smoothing.clamp(1, 60);
    let directory = info.root.join("media").join("stabilizers");
    runner.ensure_dir(&directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/stabilizers")
    })?;
    let file_name = format!("{}.trf", uuid::Uuid::new_v4());
    let transform_path = directory.join(&file_name);
    // FFmpeg filter options reject an unquoted Windows drive colon. Running
    // inside `media/stabilizers` keeps the value a bare UUID file name.
    let filter = format!("vidstabdetect=shakiness=5:accuracy=15:result={file_name}");
    let args = [
        "-hide_banner".to_owned(),
        "-nostats".to_owned(),
        "-ss".to_owned(),
        format!("{in_seconds:.6}"),
        "-t".to_owned(),
        format!("{duration:.6}"),
        "-i".to_owned(),
        path.to_string_lossy().into_owned(),
        "-vf".to_owned(),
        filter,
        "-an".to_owned(),
        "-f".to_owned(),
        "null".to_owned(),
        "-".to_owned(),
    ];
    let output = runner
        .run_ffmpeg(&ffmpeg, &args, Some(&directory))
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo iniciar FFmpeg para estabilizar",
            )
        })?;
    if !output.status.success() {
        runner.remove_file(&transform_path);
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo analizar el movimiento: {}",
                sanitize_log(&stderr, &info.root, 300)
            )
            .as_str(),
        ));
    }
    if !runner.file_exists(&transform_path) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFmpeg no produjo el archivo de transformación",
        ));
    }
    Ok(StabilizationAnalysis {
        path: format!("media/stabilizers/{file_name}"),
        smoothing,
        in_frame,
        out_frame,
    })
}

// ---------------------------------------------------------------------------
// Inspección de archivos y calidad VMAF
// ---------------------------------------------------------------------------

/// Corre ffprobe completo (`-show_format -show_streams`) sobre un archivo.
/// Es la puerta de entrada del convertidor universal: se acepta por
/// contenido, no por extensión.
pub fn probe_file_json(
    runner: &dyn MediaRunner,
    ffprobe: Option<&Path>,
    path: &Path,
) -> Result<Value, ProjectError> {
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible para inspeccionar el archivo",
        ));
    };
    let args = [
        "-v".to_owned(),
        "error".to_owned(),
        "-print_format".to_owned(),
        "json".to_owned(),
        "-show_format".to_owned(),
        "-show_streams".to_owned(),
        path.to_string_lossy().into_owned(),
    ];
    let output = runner.run_ffprobe(ffprobe, &args)?;
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "FFmpeg no puede leer ese archivo: no es un medio soportado",
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "ffprobe devolvió una respuesta ilegible",
        )
    })
}

/// Inspección completa de cualquier archivo que FFmpeg entienda.
pub fn probe_any_file(
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    path: &str,
) -> Result<MediaProbe, ProjectError> {
    let input_path = PathBuf::from(path.trim());
    if input_path.as_os_str().is_empty() || !input_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo no está en disco",
        ));
    }
    let ffprobe = tools.ffprobe_path();
    let value = probe_file_json(runner, ffprobe.as_deref(), &input_path)?;
    Ok(MediaProbe::from_value(&input_path, &value))
}

static VMAF_CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// ¿El build de FFmpeg trae el filtro libvmaf? Se consulta una sola vez por
/// proceso. Sin el filtro, la medición se oculta con el motivo en la UI.
pub fn vmaf_available(tools: &dyn MediaTools, runner: &dyn MediaRunner) -> bool {
    *VMAF_CACHE.get_or_init(|| {
        let Some(ffmpeg) = tools.ffmpeg_path() else {
            return false;
        };
        let args = ["-hide_banner".to_owned(), "-filters".to_owned()];
        runner
            .run_ffmpeg(&ffmpeg, &args, None)
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(" libvmaf "))
            .unwrap_or(false)
    })
}

/// Mide la calidad objetiva (VMAF) entre el original y el comprimido.
/// Devuelve `None` si el build de FFmpeg no trae libvmaf.
pub fn measure_vmaf(
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
    original: &str,
    compressed: &str,
) -> Result<Option<f64>, ProjectError> {
    let ffmpeg = tools.ffmpeg_path().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para medir la calidad",
        )
    })?;
    let ffprobe = tools.ffprobe_path().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para medir la calidad",
        )
    })?;
    if !vmaf_available(tools, runner) {
        return Ok(None);
    }
    let original_path = PathBuf::from(original.trim());
    let compressed_path = PathBuf::from(compressed.trim());
    if !original_path.is_file() || !compressed_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el original o el comprimido no están en disco",
        ));
    }
    let value = probe_file_json(runner, Some(ffprobe.as_path()), &original_path)?;
    let streams = value["streams"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["codec_type"] == "video"));
    let width = streams.and_then(|item| item["width"].as_u64()).unwrap_or(0);
    let height = streams
        .and_then(|item| item["height"].as_u64())
        .unwrap_or(0);
    if width == 0 || height == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el original no expone su resolución: no se puede medir VMAF",
        ));
    }

    let args = [
        "-hide_banner".to_owned(),
        "-nostats".to_owned(),
        "-i".to_owned(),
        original_path.to_string_lossy().into_owned(),
        "-i".to_owned(),
        compressed_path.to_string_lossy().into_owned(),
        "-filter_complex".to_owned(),
        format!("[1:v]scale={width}:{height}[comp];[0:v][comp]libvmaf"),
        "-f".to_owned(),
        "null".to_owned(),
        "-".to_owned(),
    ];
    let output = runner.run_ffmpeg(&ffmpeg, &args, None).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para medir VMAF",
        )
    })?;
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFmpeg no pudo medir VMAF entre los dos archivos",
        ));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let score = parse_vmaf_score(&stderr).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "FFmpeg terminó sin reportar un puntaje VMAF",
        )
    })?;
    Ok(Some((score * 100.0).round() / 100.0))
}

/// Lee y valida el archivo de subtítulos que devolvió el diálogo nativo.
/// Conserva el orden histórico de errores: extensión → metadatos → tamaño →
/// lectura → UTF-8 → no vacío.
pub fn read_subtitle_file(
    files: &dyn SubtitleFiles,
    path: &Path,
) -> Result<SubtitleFile, ProjectError> {
    validate_subtitle_extension(path)?;
    let meta = files.metadata(path).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de subtítulos ya no está en esa ruta",
        )
    })?;
    if !meta.is_file {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la selección no es un archivo",
        ));
    }
    validate_subtitle_len(meta.len)?;
    let bytes = files.read(path)?;
    let text = decode_subtitle_text(&bytes)?;
    Ok(SubtitleFile {
        name: subtitle_name(path),
        text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::media::LocalSubtitleFiles;
    use crate::media::MAX_IMPORT_FILES;

    fn temp_subtitle(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let directory =
            std::env::temp_dir().join(format!("editoria-subtitles-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn reads_a_utf8_srt_file() {
        let path = temp_subtitle("demo.srt", b"1\n00:00:00,000 --> 00:00:01,000\nHola\n");
        let file = read_subtitle_file(&LocalSubtitleFiles, &path).expect("SRT válido");
        assert_eq!(file.name, "demo.srt");
        assert!(file.text.contains("Hola"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn reads_a_vtt_file_case_insensitively() {
        let path = temp_subtitle("demo.VTT", b"WEBVTT\n\n00:00.000 --> 00:01.000\nHola\n");
        assert!(read_subtitle_file(&LocalSubtitleFiles, &path).is_ok());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn reads_an_ass_file_from_a_styled_export() {
        let ass = b"[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,Hola\n";
        let path = temp_subtitle("demo.ass", ass);
        let file = read_subtitle_file(&LocalSubtitleFiles, &path).expect("ASS válido");
        assert_eq!(file.name, "demo.ass");
        assert!(file.text.contains("Dialogue:"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn rejects_wrong_extensions_and_empty_files() {
        let wrong = temp_subtitle("demo.txt", b"1\n00:00:00,000 --> 00:00:01,000\nHola\n");
        assert!(read_subtitle_file(&LocalSubtitleFiles, &wrong).is_err());
        let empty = temp_subtitle("empty.srt", b"");
        assert!(read_subtitle_file(&LocalSubtitleFiles, &empty).is_err());
        let _ = std::fs::remove_dir_all(wrong.parent().unwrap());
        let _ = std::fs::remove_dir_all(empty.parent().unwrap());
    }

    #[test]
    fn rejects_files_that_are_not_utf8() {
        let path = temp_subtitle("binary.srt", &[0xff, 0xfe, 0x00]);
        assert!(read_subtitle_file(&LocalSubtitleFiles, &path).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    fn fake_files(count: usize) -> (PathBuf, Vec<PathBuf>) {
        let dir = std::env::temp_dir().join(format!("olyvia-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("tmp");
        // Archivos vacíos: import_file falla antes de llamar a ffprobe.
        let files = (0..count)
            .map(|index| {
                let file = dir.join(format!("clip-{index}.mp4"));
                std::fs::write(&file, b"").expect("write");
                file
            })
            .collect();
        (dir, files)
    }

    #[test]
    fn max_paths_trunca_en_silencio() {
        let (dir, files) = fake_files(3);
        let outcome = import_local_files(
            &dir,
            Path::new("ffprobe-inexistente"),
            files,
            30,
            1,
            false,
            None,
            false,
            ImportLimit::MaxPaths(2),
        );
        assert_eq!(outcome.warnings.len(), 2);
        assert!(outcome.assets.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn max_assets_sigue_pese_a_fallos_hasta_el_tope() {
        let (dir, files) = fake_files(3);
        // Con MaxAssets el tope cuenta assets importados, no rutas: los 3
        // archivos fallan pero se procesan los 3 (sin truncar por paths).
        let outcome = import_local_files(
            &dir,
            Path::new("ffprobe-inexistente"),
            files,
            30,
            1,
            false,
            None,
            false,
            ImportLimit::MaxAssets(MAX_IMPORT_FILES),
        );
        assert_eq!(outcome.warnings.len(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skip_missing_reporta_rutas_que_ya_no_existen() {
        let (dir, mut files) = fake_files(1);
        files.push(dir.join("ya-no-esta.mp4"));
        let outcome = import_local_files(
            &dir,
            Path::new("ffprobe-inexistente"),
            files,
            30,
            1,
            false,
            None,
            true,
            ImportLimit::MaxPaths(MAX_IMPORT_FILES),
        );
        assert!(outcome
            .warnings
            .iter()
            .any(|warning| warning.contains("ya no existe")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn check_asset_files_reporta_existencia_y_bytes() {
        let dir = std::env::temp_dir().join(format!("olyvia-check-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).expect("tmp");
        std::fs::write(dir.join("media/clip.mp4"), b"12345").expect("write");
        let results = check_asset_files(
            &dir,
            vec!["media/clip.mp4".to_owned(), "media/falta.mp4".to_owned()],
        );
        assert_eq!(results.len(), 2);
        assert!(results[0].exists);
        assert_eq!(results[0].bytes, 5);
        assert!(!results[1].exists);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
