//! Localization Studio: publica subtítulos traducidos sin confiar en el nombre
//! ni en el formato que manda el frontend.
//!
//! El contenido ya llegó como texto UTF-8 desde la UI; acá se acota el tamaño,
//! se valida que el formato declarado coincida con el cuerpo, se escribe un
//! temporal oculto y se publica con rename atómico y nombre único.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};

const MAX_SUBTITLE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalizedSubtitleRequest {
    pub content: String,
    pub output_dir: String,
    pub base_name: String,
    pub language: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalizedSubtitleResult {
    pub path: String,
    pub bytes: u64,
    pub format: String,
    pub language: String,
}

fn fold_accent(ch: char) -> char {
    match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        _ => ch,
    }
}

fn safe_token(value: &str, fallback: &str) -> String {
    let mapped: String = value
        .trim()
        .chars()
        .map(|ch| {
            let lower = ch.to_lowercase().next().unwrap_or(ch);
            let folded = fold_accent(lower);
            if folded.is_ascii_alphanumeric() || folded == '-' || folded == '_' {
                folded
            } else {
                '-'
            }
        })
        .collect();
    let collapsed = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let trimmed = collapsed.trim_matches('-').trim_matches('_').to_owned();
    if trimmed.is_empty() {
        fallback.to_owned()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn validate_format(format: &str) -> Result<&'static str, ProjectError> {
    match format.to_ascii_lowercase().as_str() {
        "srt" => Ok("srt"),
        "vtt" => Ok("vtt"),
        _ => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato de salida debe ser SRT o VTT",
        )),
    }
}

fn validate_content(content: &str, format: &str) -> Result<(), ProjectError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el subtítulo traducido llegó vacío",
        ));
    }
    if content.len() > MAX_SUBTITLE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el subtítulo traducido supera los 4 MB",
        ));
    }
    if !trimmed.contains("-->") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el subtítulo traducido no tiene líneas de tiempo",
        ));
    }
    if format == "vtt" && !trimmed.starts_with("WEBVTT") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "un archivo VTT debe empezar con WEBVTT",
        ));
    }
    Ok(())
}

fn unique_path(dir: &Path, base: &str, language: &str, extension: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{base}.{language}.{extension}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base}.{language}-{index}.{extension}"));
        index += 1;
    }
    candidate
}

/// Guarda un subtítulo traducido y devuelve la ruta publicada.
#[tauri::command]
pub fn save_localized_subtitle(
    request: SaveLocalizedSubtitleRequest,
) -> Result<SaveLocalizedSubtitleResult, ProjectError> {
    let format = validate_format(&request.format)?;
    validate_content(&request.content, format)?;
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de los subtítulos no existe",
        ));
    }
    let base = safe_token(&request.base_name, "subtitulos");
    let language = safe_token(&request.language, "xx");
    let final_path = unique_path(&output_dir, &base, &language, format);
    let temp_path = output_dir.join(format!(".localized-{}.{format}", Uuid::new_v4()));
    std::fs::write(&temp_path, request.content.as_bytes()).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir el subtítulo: {error}").as_str(),
        )
    })?;
    let written = std::fs::metadata(&temp_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if written == 0 {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el subtítulo temporal quedó vacío",
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el subtítulo: {error}").as_str(),
        )
    })?;
    let published = std::fs::metadata(&final_path)
        .map(|metadata| metadata.len())
        .unwrap_or(written);
    Ok(SaveLocalizedSubtitleResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes: published,
        format: format.to_owned(),
        language,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRT: &str = "1\n00:00:00,000 --> 00:00:01,500\nHola mundo\n";

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("editoria-loc-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta");
        dir
    }

    fn request(dir: &Path, content: &str, format: &str) -> SaveLocalizedSubtitleRequest {
        SaveLocalizedSubtitleRequest {
            content: content.to_owned(),
            output_dir: dir.to_string_lossy().into_owned(),
            base_name: "Mi Video: Ñandú / 2026".to_owned(),
            language: "EN".to_owned(),
            format: format.to_owned(),
        }
    }

    #[test]
    fn saves_an_srt_with_a_safe_unique_name() {
        let dir = temp_dir();
        let first = save_localized_subtitle(request(&dir, SRT, "srt")).expect("primera");
        assert!(first.path.ends_with("mi-video-nandu-2026.en.srt"));
        assert_eq!(first.bytes, SRT.len() as u64);
        assert_eq!(first.language, "en");
        let second = save_localized_subtitle(request(&dir, SRT, "srt")).expect("segunda");
        assert!(second.path.ends_with("mi-video-nandu-2026.en-2.srt"));
        assert_ne!(first.path, second.path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn saves_vtt_and_validates_its_header() {
        let dir = temp_dir();
        let vtt = "WEBVTT\n\n00:00.000 --> 00:01.500\nHola mundo\n";
        let saved = save_localized_subtitle(request(&dir, vtt, "vtt")).expect("VTT");
        assert!(saved.path.ends_with(".vtt"));
        assert_eq!(saved.format, "vtt");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bad_format_content_and_destination() {
        let dir = temp_dir();
        assert!(save_localized_subtitle(request(&dir, SRT, "ass")).is_err());
        assert!(save_localized_subtitle(request(&dir, "", "srt")).is_err());
        assert!(save_localized_subtitle(request(&dir, "sin tiempos", "srt")).is_err());
        assert!(save_localized_subtitle(request(&dir, "sin cabecera", "vtt")).is_err());
        let missing = SaveLocalizedSubtitleRequest {
            content: SRT.to_owned(),
            output_dir: dir.join("no-existe").to_string_lossy().into_owned(),
            base_name: "x".to_owned(),
            language: "en".to_owned(),
            format: "srt".to_owned(),
        };
        assert!(save_localized_subtitle(missing).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitizes_tokens_and_falls_back_for_empty_names() {
        assert_eq!(safe_token("  Ñandú / 2026  ", "x"), "nandu-2026");
        assert_eq!(safe_token("...", "subtitulos"), "subtitulos");
        assert_eq!(safe_token("EN", "xx"), "en");
    }
}
