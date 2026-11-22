//! Análisis de medios: detección de escenas, estabilización, sondeo ffprobe
//! y medición VMAF.
//!
//! Orquesta sesión → asset del proyecto → FFmpeg/FFprobe a través de ports.
//! El parseo de salidas vive en `crate::media` (dominio puro); aquí queda la
//! coordinación del caso de uso.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::media::analysis::{
    parse_scene_times, parse_vmaf_score, requested_threshold, scene_filter,
};
use crate::media::resolve_inside_root;
use crate::ports::media::{
    proportional_analysis_timeout, MediaProbe, MediaRunner, MediaTools, SceneCut, SceneDetection,
    StabilizationAnalysis, MEDIA_PROBE_TIMEOUT, MEDIA_TOOL_CHECK_TIMEOUT,
};
use crate::ports::projects::{ProjectDocuments, ProjectSession};
use crate::projects::service::{OpenedProject, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;

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
    let fps = fps_num as f64 / fps_den as f64;
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
    // El scene detect decodifica el video completo: el deadline es
    // proporcional a la duración del asset (sin metadata → techo del helper).
    let duration_seconds = if duration_frames > 0 {
        duration_frames as f64 / fps
    } else {
        0.0
    };
    let timeout = proportional_analysis_timeout(duration_seconds);
    // El runner ya distingue spawn ("no se pudo iniciar") de timeout
    // ("no terminó a tiempo"); se propaga tal cual para no enmascararlo.
    let output = runner.run_ffmpeg_with_timeout(&ffmpeg, &args, None, timeout)?;
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
// clippy::too_many_arguments: API de aplicación alineada con el comando IPC;
// deps y rango de frames son ejes ortogonales del análisis.
#[allow(clippy::too_many_arguments)]
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
    // vidstabdetect procesa la ventana completa: deadline proporcional a su
    // duración (acotada a 1 h por la validación de arriba).
    let timeout = proportional_analysis_timeout(duration);
    let output = runner.run_ffmpeg_with_timeout(&ffmpeg, &args, Some(&directory), timeout)?;
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
    // Proxy de preview: el mismo `vidstabtransform` del export horneado una
    // vez sobre la ventana analizada. Best-effort — si el bake falla el
    // análisis sigue siendo válido y la preview queda sin estabilizar.
    let preview_name = format!("{}-preview.mp4", file_name.trim_end_matches(".trf"));
    let preview_path = directory.join(&preview_name);
    let preview_proxy = bake_stabilization_preview(
        runner,
        &ffmpeg,
        &path,
        &directory,
        &file_name,
        smoothing,
        in_seconds,
        duration,
        &preview_path,
    );
    Ok(StabilizationAnalysis {
        path: format!("media/stabilizers/{file_name}"),
        smoothing,
        in_frame,
        out_frame,
        preview_proxy,
    })
}

/// Hornea `media/stabilizers/<uuid>-preview.mp4` con el mismo filtro que el
/// export (`vidstabtransform … crop=black`). Devuelve la ruta relativa al
/// proyecto o `None` si el bake falla (se limpia el parcial).
#[allow(clippy::too_many_arguments)]
fn bake_stabilization_preview(
    runner: &dyn MediaRunner,
    ffmpeg: &Path,
    source: &Path,
    directory: &Path,
    trf_name: &str,
    smoothing: u32,
    in_seconds: f64,
    duration: f64,
    preview_path: &Path,
) -> Option<String> {
    // Mismo cwd (`media/stabilizers`) que la pasada de detección: el `.trf`
    // se referencia por nombre pelado y FFmpeg lo resuelve relativo al cwd.
    let filter = format!("vidstabtransform=input='{trf_name}':smoothing={smoothing}:crop=black");
    let args = [
        "-hide_banner".to_owned(),
        "-nostats".to_owned(),
        "-ss".to_owned(),
        format!("{in_seconds:.6}"),
        "-t".to_owned(),
        format!("{duration:.6}"),
        "-i".to_owned(),
        source.to_string_lossy().into_owned(),
        "-vf".to_owned(),
        filter,
        // El <video> de la preview también aporta el audio del clip: el proxy
        // conserva la pista (la estabilización no la toca) en AAC para mp4.
        "-c:v".to_owned(),
        "libx264".to_owned(),
        "-preset".to_owned(),
        "veryfast".to_owned(),
        "-crf".to_owned(),
        "18".to_owned(),
        "-c:a".to_owned(),
        "aac".to_owned(),
        "-b:a".to_owned(),
        "192k".to_owned(),
        preview_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
    ];
    let timeout = proportional_analysis_timeout(duration);
    let baked = runner
        .run_ffmpeg_with_timeout(ffmpeg, &args, Some(directory), timeout)
        .map(|output| output.status.success())
        .unwrap_or(false)
        && runner.file_exists(preview_path);
    if !baked {
        runner.remove_file(preview_path);
        return None;
    }
    preview_path
        .file_name()
        .map(|name| format!("media/stabilizers/{}", name.to_string_lossy()))
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
    // ffprobe de cabeceras: sondeo acotado, un archivo que no responde en 2
    // min está corrupto o en un disco colgado.
    let output = runner.run_ffprobe_with_timeout(ffprobe, &args, MEDIA_PROBE_TIMEOUT)?;
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
    // Archivo suelto del usuario: política de lectura de `fs_*` (absoluta,
    // fuera de credenciales). No hace falta sesión ni proyecto abierto.
    let input_path = crate::application::fs::resolve_user_file_path(path)?;
    if !input_path.is_file() {
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
            .run_ffmpeg_with_timeout(&ffmpeg, &args, None, MEDIA_TOOL_CHECK_TIMEOUT)
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
    // Ambos archivos son del usuario (original y comprimido): política de
    // lectura de `fs_*` — se valida antes de gastar FFmpeg/FFprobe.
    let original_path = crate::application::fs::resolve_user_file_path(original)?;
    let compressed_path = crate::application::fs::resolve_user_file_path(compressed)?;
    if !original_path.is_file() || !compressed_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el original o el comprimido no están en disco",
        ));
    }
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
    // VMAF compara fotograma a fotograma los dos archivos completos: el
    // deadline es proporcional a la duración del original ya sondeado.
    let probe_duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .unwrap_or(0.0);
    let vmaf_timeout = proportional_analysis_timeout(probe_duration);
    let output = runner
        .run_ffmpeg_with_timeout(&ffmpeg, &args, None, vmaf_timeout)
        .map_err(|_| {
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

#[cfg(test)]
#[path = "media_analysis.tests.rs"]
mod tests;
