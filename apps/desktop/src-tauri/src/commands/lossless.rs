//! Exportación sin recodificar.
//!
//! Sacar un rango de un archivo grande no necesita render: FFmpeg copia los
//! paquetes y termina en segundos. La contra es que el corte cae en el keyframe
//! anterior al pedido; por eso se devuelve la duración real y cuánto se corrió
//! el inicio, en vez de fingir precisión.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LosslessResult {
    pub path: String,
    pub bytes: u64,
    pub requested_seconds: f64,
    pub actual_seconds: f64,
    /// Diferencia entre el inicio pedido y el real (keyframe anterior).
    pub start_shift_seconds: f64,
}

/// Contenedores que aceptamos como destino de un remux.
pub(crate) fn valid_container(extension: &str) -> bool {
    matches!(
        extension.trim().to_ascii_lowercase().as_str(),
        "mp4" | "mkv" | "mov" | "webm"
    )
}

/// Un rango válido: fin después del inicio y ambos no negativos.
pub(crate) fn valid_range(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start >= 0.0 && end > start + 0.05
}

/// Normaliza una ruta de destino usando su carpeta canonica.
fn normalized_output_path(path: &Path) -> Result<PathBuf, ProjectError> {
    let file_name = path.file_name().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta el nombre del archivo de salida",
        )
    })?;
    let parent = path
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let canonical_parent = parent.canonicalize().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no pude resolver la carpeta de salida",
        )
    })?;
    Ok(canonical_parent.join(file_name))
}

#[derive(Debug)]
struct ReservedOutput {
    path: PathBuf,
    _output_file: std::fs::File,
    metadata: Option<(PathBuf, std::fs::File)>,
}

/// Reserva el destino mediante create_new para evitar carreras entre exportaciones.
fn reserve_output_path(
    source: &Path,
    requested: &Path,
    reserve_metadata: bool,
) -> Result<ReservedOutput, ProjectError> {
    if requested.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta la ruta de salida",
        ));
    }
    let parent = requested
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude crear la carpeta de salida")
    })?;
    let requested_path = normalized_output_path(requested)?;
    if same_file_path(source, &requested_path)? {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de salida no puede ser el mismo que el origen",
        ));
    }
    let stem = requested
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    let extension = requested.extension().and_then(|value| value.to_str());
    let source_path = source.canonicalize().map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "el archivo de origen no existe")
    })?;
    for index in 1..=9_999u32 {
        let candidate = if index == 1 {
            requested_path.clone()
        } else {
            let name = match extension {
                Some(extension) => format!("{stem}-{index}.{extension}"),
                None => format!("{stem}-{index}"),
            };
            requested_path.with_file_name(name)
        };
        #[cfg(windows)]
        let same_source = candidate
            .to_string_lossy()
            .eq_ignore_ascii_case(&source_path.to_string_lossy());
        #[cfg(not(windows))]
        let same_source = candidate == source_path;
        if same_source {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el archivo de salida no puede ser el mismo que el origen",
            ));
        }
        let output_file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    "no pude reservar el archivo de salida",
                ))
            }
        };
        let sidecar = candidate.with_extension("ffmeta.txt");
        let metadata = if reserve_metadata {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&sidecar)
            {
                Ok(file) => Some((sidecar, file)),
                Err(error) => {
                    drop(output_file);
                    let _ = std::fs::remove_file(&candidate);
                    if error.kind() == std::io::ErrorKind::AlreadyExists {
                        continue;
                    }
                    return Err(ProjectError::message(
                        ProjectErrorCode::Io,
                        "no pude reservar los metadatos de capitulos",
                    ));
                }
            }
        } else {
            None
        };
        return Ok(ReservedOutput {
            path: candidate,
            _output_file: output_file,
            metadata,
        });
    }
    Err(ProjectError::message(
        ProjectErrorCode::AlreadyExists,
        "no encontre un nombre libre para la entrega",
    ))
}

fn probe_duration(ffprobe: &PathBuf, path: &PathBuf) -> Option<f64> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
}

/// Corta `input` entre `start_seconds` y `end_seconds` sin recodificar.
#[tauri::command]
pub async fn export_lossless(
    state: State<'_, AppState>,
    input: String,
    output: String,
    start_seconds: f64,
    end_seconds: f64,
    exact: Option<bool>,
) -> Result<LosslessResult, ProjectError> {
    let source = PathBuf::from(input.trim());
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de origen no existe",
        ));
    }
    if !valid_range(start_seconds, end_seconds) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el rango no es válido: el fin tiene que ser mayor que el inicio",
        ));
    }
    let reservation = reserve_output_path(&source, Path::new(output.trim()), false)?;
    let target = reservation.path.clone();

    let settings = state
        .settings
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let (ffmpeg, ffprobe, _) = crate::commands::system::resolve_tools(&settings);
    let ffmpeg = ffmpeg.unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let ffprobe = ffprobe.unwrap_or_else(|| PathBuf::from("ffprobe"));

    let exact = exact.unwrap_or(false);
    let mut command = Command::new(&ffmpeg);
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        &start_seconds.to_string(),
        "-to",
        &end_seconds.to_string(),
        "-i",
    ]);
    command.arg(&source);
    if exact {
        // Corte exacto: recodifica sólo el rango. Más lento, pero el inicio cae
        // donde se pidió en vez de en el keyframe anterior.
        let encoder = crate::render::ffmpeg::software_encoder(&ffprobe, "h264");
        command.args(["-c:v", &encoder, "-preset", "veryfast", "-crf", "18"]);
        if !encoder.starts_with("libx26") {
            command.args(["-b:v", "12000000"]);
        }
        command.args(["-c:a", "aac", "-b:a", "192k"]);
    } else {
        command.args(["-c", "copy", "-avoid_negative_ts", "make_zero"]);
    }
    let status = command
        .args(["-y"])
        .arg(&target)
        .status()
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no pude ejecutar FFmpeg"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg failed to export the requested range; partial output removed",
        ));
    }

    let bytes = std::fs::metadata(&target)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let actual = probe_duration(&ffprobe, &target).unwrap_or(end_seconds - start_seconds);
    let requested = end_seconds - start_seconds;
    Ok(LosslessResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        requested_seconds: requested,
        actual_seconds: actual,
        start_shift_seconds: if exact {
            0.0
        } else {
            (requested - actual).max(0.0)
        },
    })
}

/// Cambia el contenedor sin tocar los códecs (`-c copy`).
#[tauri::command]
pub async fn remux(
    state: State<'_, AppState>,
    input: String,
    output: String,
) -> Result<LosslessResult, ProjectError> {
    let source = PathBuf::from(input.trim());
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de origen no existe",
        ));
    }
    let requested = PathBuf::from(output.trim());
    let extension = requested
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !valid_container(extension) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el contenedor debe ser mp4, mkv, mov o webm",
        ));
    }
    let reservation = reserve_output_path(&source, &requested, false)?;
    let target = reservation.path.clone();
    let settings = state
        .settings
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let (ffmpeg, ffprobe, _) = crate::commands::system::resolve_tools(&settings);
    let ffmpeg = ffmpeg.unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let ffprobe = ffprobe.unwrap_or_else(|| PathBuf::from("ffprobe"));

    let status = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&source)
        .args(["-c", "copy", "-y"])
        .arg(&target)
        .status()
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no pude ejecutar FFmpeg"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no pudo cambiar el contenedor; salida descartada",
        ));
    }
    let bytes = std::fs::metadata(&target)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let duration = probe_duration(&ffprobe, &target).unwrap_or(0.0);
    Ok(LosslessResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        requested_seconds: duration,
        actual_seconds: duration,
        start_shift_seconds: 0.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_forward_range() {
        assert!(valid_range(0.0, 10.0));
        assert!(valid_range(5.5, 6.0));
    }

    #[test]
    fn picks_a_container_that_accepts_the_codec() {
        assert_eq!(audio_container("aac"), "m4a");
        assert_eq!(audio_container("ALAC"), "m4a");
        assert_eq!(audio_container("opus"), "mka");
        assert_eq!(audio_container("mp3"), "mka");
    }

    #[test]
    fn writes_ffmetadata_chapters() {
        let chapters = vec![
            ChapterInput {
                start_seconds: 0.0,
                end_seconds: 2.5,
                title: "Intro".to_owned(),
            },
            ChapterInput {
                start_seconds: 2.5,
                end_seconds: 5.0,
                title: "Cierre".to_owned(),
            },
        ];
        let text = chapters_metadata(Some("Mi video"), &chapters);
        assert!(text.starts_with(";FFMETADATA1\ntitle=Mi video\n"));
        assert!(text.contains("[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2500\ntitle=Intro"));
        assert!(text.contains("START=2500\nEND=5000\ntitle=Cierre"));
    }

    #[test]
    fn skips_chapters_without_duration() {
        let chapters = vec![
            ChapterInput {
                start_seconds: 3.0,
                end_seconds: 3.0,
                title: "Vacío".to_owned(),
            },
            ChapterInput {
                start_seconds: 4.0,
                end_seconds: 6.0,
                title: "Válido".to_owned(),
            },
        ];
        let text = chapters_metadata(None, &chapters);
        assert!(!text.contains("Vacío"));
        assert!(text.contains("Válido"));
    }

    #[test]
    fn accepts_common_containers_only() {
        assert!(valid_container("mp4"));
        assert!(valid_container("MKV"));
        assert!(!valid_container("avi"));
        assert!(!valid_container(""));
    }

    #[test]
    fn rejects_inverted_or_empty_ranges() {
        assert!(!valid_range(10.0, 10.0));
        assert!(!valid_range(10.0, 5.0));
        assert!(!valid_range(-1.0, 5.0));
        assert!(!valid_range(f64::NAN, 5.0));
    }

    #[test]
    fn refuses_to_export_over_the_source() {
        let root = std::env::temp_dir().join(format!("lossless-source-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        std::fs::write(&source, b"original").unwrap();
        let error = reserve_output_path(&source, &source, false).unwrap_err();
        assert_eq!(error.code, ProjectErrorCode::InvalidProject);
        assert_eq!(std::fs::read(&source).unwrap(), b"original");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reserves_a_new_name_instead_of_overwriting_an_existing_delivery() {
        let root = std::env::temp_dir().join(format!("lossless-collision-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        let requested = root.join("cut.mp4");
        std::fs::write(&source, b"original").unwrap();
        std::fs::write(&requested, b"keep-me").unwrap();
        let reserved = reserve_output_path(&source, &requested, false).unwrap();
        assert_eq!(reserved.path.file_name().unwrap(), "cut-2.mp4");
        assert_eq!(std::fs::read(&requested).unwrap(), b"keep-me");
        assert_eq!(std::fs::metadata(&reserved.path).unwrap().len(), 0);
        drop(reserved);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reserves_chapter_sidecar_name_as_well_as_video_name() {
        let root = std::env::temp_dir().join(format!("lossless-sidecar-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        let requested = root.join("cut.mp4");
        std::fs::write(&source, b"original").unwrap();
        std::fs::write(root.join("cut.ffmeta.txt"), b"keep-metadata").unwrap();
        let reserved = reserve_output_path(&source, &requested, true).unwrap();
        assert_eq!(reserved.path.file_name().unwrap(), "cut-2.mp4");
        assert_eq!(
            std::fs::read(root.join("cut.ffmeta.txt")).unwrap(),
            b"keep-metadata"
        );
        assert!(reserved.metadata.is_some());
        drop(reserved);
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterInput {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaptersResult {
    pub path: String,
    pub bytes: u64,
    pub chapters: usize,
}

/// Arma el archivo `ffmetadata` con los capítulos.
pub(crate) fn chapters_metadata(title: Option<&str>, chapters: &[ChapterInput]) -> String {
    let mut text = String::from(";FFMETADATA1\n");
    if let Some(value) = title.filter(|value| !value.trim().is_empty()) {
        text.push_str(&format!("title={}\n", value.replace('\n', " ")));
    }
    for chapter in chapters {
        let start = (chapter.start_seconds.max(0.0) * 1000.0).round() as i64;
        let end = (chapter.end_seconds.max(0.0) * 1000.0).round() as i64;
        if end <= start {
            continue;
        }
        text.push_str("[CHAPTER]\nTIMEBASE=1/1000\n");
        text.push_str(&format!("START={start}\nEND={end}\n"));
        text.push_str(&format!(
            "title={}\n",
            chapter.title.trim().replace('\n', " ")
        ));
    }
    text
}

/// Escribe capítulos y título dentro de una copia del archivo, sin recodificar.
#[tauri::command]
pub async fn write_chapters(
    state: State<'_, AppState>,
    input: String,
    output: String,
    title: Option<String>,
    chapters: Vec<ChapterInput>,
) -> Result<ChaptersResult, ProjectError> {
    let source = PathBuf::from(input.trim());
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de origen no existe",
        ));
    }
    if chapters.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no hay marcadores para escribir como capítulos",
        ));
    }
    let mut reservation = reserve_output_path(&source, Path::new(output.trim()), true)?;
    let target = reservation.path.clone();
    let (metadata_path, mut metadata_file) = reservation.metadata.take().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no pude reservar los metadatos de capitulos",
        )
    })?;
    let metadata = chapters_metadata(title.as_deref(), &chapters);
    metadata_file.write_all(metadata.as_bytes()).map_err(|_| {
        let _ = std::fs::remove_file(&metadata_path);
        ProjectError::message(ProjectErrorCode::Io, "no pude escribir los metadatos")
    })?;
    drop(metadata_file);

    let settings = state
        .settings
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let (ffmpeg, _, _) = crate::commands::system::resolve_tools(&settings);
    let ffmpeg = ffmpeg.unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let status = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&source)
        .arg("-i")
        .arg(&metadata_path)
        .args([
            "-map_metadata",
            "1",
            "-map_chapters",
            "1",
            "-c",
            "copy",
            "-y",
        ])
        .arg(&target)
        .status();
    let _ = std::fs::remove_file(&metadata_path);
    let status = status
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no pude ejecutar FFmpeg"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no pudo escribir los capítulos en ese contenedor",
        ));
    }
    let bytes = std::fs::metadata(&target)
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(ChaptersResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        chapters: chapters.len(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResult {
    pub path: String,
    pub bytes: u64,
    pub codec: String,
}

/// Contenedor de audio que acepta el códec sin recodificar.
pub(crate) fn audio_container(codec: &str) -> &'static str {
    match codec.trim().to_ascii_lowercase().as_str() {
        "aac" | "alac" => "m4a",
        _ => "mka",
    }
}

fn probe_audio_codec(ffprobe: &PathBuf, path: &PathBuf) -> Option<String> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .ok()?;
    let codec = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if codec.is_empty() {
        None
    } else {
        Some(codec)
    }
}

/// Extrae la primera pista de audio sin recodificar.
#[tauri::command]
pub async fn extract_audio(
    state: State<'_, AppState>,
    input: String,
    output: String,
) -> Result<ExtractResult, ProjectError> {
    let source = PathBuf::from(input.trim());
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de origen no existe",
        ));
    }
    let settings = state
        .settings
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let (ffmpeg, ffprobe, _) = crate::commands::system::resolve_tools(&settings);
    let ffmpeg = ffmpeg.unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let ffprobe = ffprobe.unwrap_or_else(|| PathBuf::from("ffprobe"));

    let codec = probe_audio_codec(&ffprobe, &source).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no tiene una pista de audio",
        )
    })?;
    // El contenedor lo decide el códec: así nunca hay que recodificar.
    let mut requested = PathBuf::from(output.trim());
    if requested.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta la ruta de salida",
        ));
    }
    requested.set_extension(audio_container(&codec));
    let reservation = reserve_output_path(&source, &requested, false)?;
    let target = reservation.path.clone();
    let status = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&source)
        .args(["-vn", "-map", "0:a:0", "-c", "copy", "-y"])
        .arg(&target)
        .status()
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no pude ejecutar FFmpeg"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no pudo extraer el audio",
        ));
    }
    let bytes = std::fs::metadata(&target)
        .map(|meta| meta.len())
        .unwrap_or(0);
    Ok(ExtractResult {
        path: target.to_string_lossy().to_string(),
        bytes,
        codec,
    })
}
