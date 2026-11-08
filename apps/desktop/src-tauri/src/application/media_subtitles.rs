//! Lectura y validación de archivos de subtítulos elegidos por diálogo.
//!
//! La decodificación y las reglas de formato viven en
//! `crate::media::subtitle_file` (dominio puro); aquí queda el caso de uso
//! que recibe el puerto de filesystem.

use std::path::Path;

use crate::media::subtitle_file::{
    decode_subtitle_text, subtitle_name, validate_subtitle_extension, validate_subtitle_len,
    SubtitleFile,
};
use crate::ports::media::SubtitleFiles;
use crate::projects::service::{ProjectError, ProjectErrorCode};

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
}
