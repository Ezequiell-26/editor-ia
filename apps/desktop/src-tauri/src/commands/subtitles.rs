//! Native subtitle file picker. The dialog chooses a local `.srt`, `.vtt`,
//! `.ass` or `.ssa`; the native side only reads and validates the text, and the
//! UI parses and imports it into the project.

use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::projects::service::{ProjectError, ProjectErrorCode};

const MAX_SUBTITLE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct SubtitleFile {
    pub name: String,
    pub text: String,
}

fn read_subtitle_file(path: &Path) -> Result<SubtitleFile, ProjectError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "srt" | "vtt" | "ass" | "ssa") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí un archivo .srt, .vtt, .ass o .ssa",
        ));
    }
    let metadata = std::fs::metadata(path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de subtítulos ya no está en esa ruta",
        )
    })?;
    if !metadata.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la selección no es un archivo",
        ));
    }
    if metadata.len() == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos está vacío",
        ));
    }
    if metadata.len() > MAX_SUBTITLE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos supera los 4 MB",
        ));
    }
    let bytes = std::fs::read(path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo leer el archivo de subtítulos",
        )
    })?;
    let text = String::from_utf8(bytes).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos no está codificado en UTF-8",
        )
    })?;
    if text.trim().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos no tiene texto",
        ));
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("subtitulos.srt")
        .to_owned();
    Ok(SubtitleFile { name, text })
}

#[tauri::command]
pub async fn choose_subtitle_file(app: AppHandle) -> Result<Option<SubtitleFile>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Importar subtítulos SRT/VTT/ASS")
        .add_filter("Subtítulos", &["srt", "vtt", "ass", "ssa"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    read_subtitle_file(&path).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let directory =
            std::env::temp_dir().join(format!("editoria-subtitles-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn reads_a_utf8_srt_file() {
        let path = temp("demo.srt", b"1\n00:00:00,000 --> 00:00:01,000\nHola\n");
        let file = read_subtitle_file(&path).expect("SRT válido");
        assert_eq!(file.name, "demo.srt");
        assert!(file.text.contains("Hola"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn reads_a_vtt_file_case_insensitively() {
        let path = temp("demo.VTT", b"WEBVTT\n\n00:00.000 --> 00:01.000\nHola\n");
        assert!(read_subtitle_file(&path).is_ok());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn reads_an_ass_file_from_a_styled_export() {
        let ass = b"[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,Hola\n";
        let path = temp("demo.ass", ass);
        let file = read_subtitle_file(&path).expect("ASS válido");
        assert_eq!(file.name, "demo.ass");
        assert!(file.text.contains("Dialogue:"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn rejects_wrong_extensions_and_empty_files() {
        let wrong = temp("demo.txt", b"1\n00:00:00,000 --> 00:00:01,000\nHola\n");
        assert!(read_subtitle_file(&wrong).is_err());
        let empty = temp("empty.srt", b"");
        assert!(read_subtitle_file(&empty).is_err());
        let _ = std::fs::remove_dir_all(wrong.parent().unwrap());
        let _ = std::fs::remove_dir_all(empty.parent().unwrap());
    }

    #[test]
    fn rejects_files_that_are_not_utf8() {
        let path = temp("binary.srt", &[0xff, 0xfe, 0x00]);
        assert!(read_subtitle_file(&path).is_err());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
