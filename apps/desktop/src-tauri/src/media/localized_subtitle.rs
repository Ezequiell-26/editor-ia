//! Publicación de subtítulos localizados (Localization Studio).
//!
//! Reglas puras: saneado de tokens para el nombre de archivo, validación de
//! formato/contenido y armado del nombre único `{base}.{lang}[-N].{ext}`.
//! La escritura temporal + rename atómico vive en infrastructure.

use serde::{Deserialize, Serialize};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_SUBTITLE_BYTES: usize = 4 * 1024 * 1024;

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

/// Token seguro para nombres de archivo: minúsculas sin acentos, separadores
/// `-`, máximo 60 caracteres, con fallback si queda vacío.
pub fn safe_token(value: &str, fallback: &str) -> String {
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

pub fn validate_format(format: &str) -> Result<&'static str, ProjectError> {
    match format.to_ascii_lowercase().as_str() {
        "srt" => Ok("srt"),
        "vtt" => Ok("vtt"),
        _ => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato de salida debe ser SRT o VTT",
        )),
    }
}

pub fn validate_content(content: &str, format: &str) -> Result<(), ProjectError> {
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

/// Nombre del archivo publicado: `{base}.{language}.{extension}`, con sufijo
/// `-2`, `-3`, … cuando ya existe (el chequeo de existencia lo hace el caller).
pub fn localized_file_name(base: &str, language: &str, extension: &str, index: u32) -> String {
    if index <= 1 {
        format!("{base}.{language}.{extension}")
    } else {
        format!("{base}.{language}-{index}.{extension}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_tokens_and_falls_back_for_empty_names() {
        assert_eq!(safe_token("  Ñandú / 2026  ", "x"), "nandu-2026");
        assert_eq!(safe_token("...", "subtitulos"), "subtitulos");
        assert_eq!(safe_token("EN", "xx"), "en");
    }

    #[test]
    fn file_names_follow_the_unique_suffix_contract() {
        assert_eq!(localized_file_name("clip", "en", "srt", 1), "clip.en.srt");
        assert_eq!(localized_file_name("clip", "en", "srt", 2), "clip.en-2.srt");
        assert_eq!(localized_file_name("clip", "en", "vtt", 3), "clip.en-3.vtt");
    }
}
