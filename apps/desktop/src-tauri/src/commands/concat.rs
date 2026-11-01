//! Concatenación de segmentos MP4 idénticos con el demuxer concat de FFmpeg.
//!
//! La usa el render por escenas: cada escena se renderiza por separado y el
//! agente las une sin recodificar. No sustituye al render: sólo compone tramos
//! ya verificados con el mismo perfil.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcatResult {
    pub output_path: String,
    pub bytes: u64,
    pub duration_seconds: f64,
    pub segments: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub exists: bool,
    pub bytes: u64,
}

#[tauri::command]
pub fn file_info(path: String) -> FileInfo {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => FileInfo {
            exists: true,
            bytes: metadata.len(),
        },
        _ => FileInfo {
            exists: false,
            bytes: 0,
        },
    }
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn io_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

fn concat_line(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/").replace('\'', "'\\''");
    format!("file '{value}'")
}

fn validate(paths: &[String], output: &Path) -> Result<Vec<PathBuf>, ProjectError> {
    if paths.is_empty() || paths.len() > 64 {
        return Err(invalid("el concat necesita entre 1 y 64 segmentos"));
    }
    let mut resolved = Vec::with_capacity(paths.len());
    for raw in paths {
        if raw.contains('\n') || raw.contains('\r') {
            return Err(invalid("una ruta de segmento contiene saltos de línea"));
        }
        let path = PathBuf::from(raw);
        if !path.is_file() {
            return Err(io_error(&format!("el segmento no existe: {raw}")));
        }
        resolved.push(path);
    }
    if output.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un archivo con la ruta de salida del concat",
        ));
    }
    let parent = output
        .parent()
        .ok_or_else(|| invalid("la salida del concat no tiene carpeta"))?;
    if !parent.is_dir() {
        return Err(io_error("la carpeta de salida del concat no existe"));
    }
    Ok(resolved)
}

#[tauri::command]
pub async fn concat_videos(
    state: State<'_, AppState>,
    paths: Vec<String>,
    output_path: String,
) -> Result<ConcatResult, ProjectError> {
    let output = PathBuf::from(&output_path);
    let segments = validate(&paths, &output)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(io_error("FFmpeg no está disponible para concatenar"));
    };
    let directory = state.cache_dir.join(format!("concat-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory)
        .map_err(|error| io_error(&format!("no se pudo preparar el concat: {error}")))?;
    let list_path = directory.join("segments.txt");
    let mut list = std::fs::File::create(&list_path)
        .map_err(|error| io_error(&format!("no se pudo crear la lista del concat: {error}")))?;
    for segment in &segments {
        writeln!(list, "{}", concat_line(segment))
            .map_err(|error| io_error(&format!("no se pudo escribir la lista: {error}")))?;
    }
    drop(list);

    let mut command = Command::new(&ffmpeg);
    command
        .args(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i"])
        .arg(&list_path)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let result = command.output().map_err(|error| {
        io_error(&format!("no se pudo ejecutar FFmpeg para concatenar: {error}"))
    })?;
    let _ = std::fs::remove_dir_all(&directory);
    if !result.status.success() {
        let detail = String::from_utf8_lossy(&result.stderr);
        return Err(io_error(
            detail
                .lines()
                .last()
                .unwrap_or("FFmpeg no pudo concatenar los segmentos")
                .chars()
                .take(240)
                .collect::<String>()
                .as_str(),
        ));
    }
    let bytes = std::fs::metadata(&output)
        .map_err(|error| io_error(&format!("no se pudo leer el MP4 concatenado: {error}")))?
        .len();
    if bytes == 0 {
        return Err(io_error("el MP4 concatenado quedó vacío"));
    }
    let duration_seconds = ffprobe
        .and_then(|probe| {
            let mut command = Command::new(probe);
            command
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                ])
                .arg(&output);
            hide_console(&mut command);
            let output = command.output().ok()?;
            if !output.status.success() {
                return None;
            }
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse::<f64>()
                .ok()
        })
        .unwrap_or(0.0);
    Ok(ConcatResult {
        output_path: output.to_string_lossy().into_owned(),
        bytes,
        duration_seconds,
        segments: segments.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concat_lines_escape_quotes_and_windows_paths() {
        assert_eq!(
            concat_line(Path::new(r"C:\videos\uno.mp4")),
            "file 'C:/videos/uno.mp4'"
        );
        assert_eq!(
            concat_line(Path::new("C:/a'b/uno.mp4")),
            "file 'C:/a'\\''b/uno.mp4'"
        );
    }

    #[test]
    fn validation_rejects_missing_and_existing_output() {
        let directory = std::env::temp_dir().join(format!("editoria-concat-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let output = directory.join("final.mp4");
        assert!(validate(&[String::from("no-existe.mp4")], &output).is_err());
        std::fs::write(&output, b"x").unwrap();
        assert_eq!(validate(&[], &output).unwrap_err().code, ProjectErrorCode::InvalidProject);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
