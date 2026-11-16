//! Puente de clonación de voz local — validación de entrada y referencia.
//!
//! La app no incluye un modelo neuronal de clonación (serían cientos de MB y
//! otro runtime). El comando conecta un motor **local** que el usuario ya
//! tenga: XTTS API Server o GPT-SoVITS, ambos por HTTP en loopback. Este
//! módulo valida la muestra de referencia, acota el texto y el idioma, no
//! acepta URLs remotas y verifica el WAV resultante. No envía datos a
//! internet ni presenta una voz SAPI disfrazada como clon.

use std::path::Path;

use reqwest::Url;

use crate::media::{probe_file, sha256_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_TEXT_CHARS: usize = 2_000;
pub const MAX_REFERENCE_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_AUDIO_BYTES: usize = 20 * 1024 * 1024;
pub const MIN_REFERENCE_SECONDS: f64 = 3.0;
pub const MAX_REFERENCE_SECONDS: f64 = 30.0;
pub const MAX_OUTPUT_SECONDS: f64 = 300.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloneEngine {
    Xtts,
    GptSovits,
}

impl CloneEngine {
    pub fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("xtts").trim().to_ascii_lowercase().as_str() {
            "gpt-sovits" | "gptsovits" | "gpt_sovits" => Self::GptSovits,
            _ => Self::Xtts,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Xtts => "xtts",
            Self::GptSovits => "gpt-sovits",
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::Xtts => "/tts_to_audio/",
            Self::GptSovits => "/tts",
        }
    }
}

pub fn validate_text(text: &str) -> Result<String, ProjectError> {
    let clean = text.replace('\n', " ").trim().to_owned();
    if clean.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el texto para clonar la voz está vacío",
        ));
    }
    if clean.chars().count() > MAX_TEXT_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("el texto supera los {MAX_TEXT_CHARS} caracteres"),
        ));
    }
    Ok(clean)
}

const CLONE_LANGUAGES: &[&str] = &[
    "es", "en", "pt", "fr", "de", "it", "zh", "ja", "ko", "ru", "ar", "hi", "tr", "pl", "nl", "cs",
];

pub fn normalize_language(value: &str) -> Result<String, ProjectError> {
    let lower = value.trim().to_ascii_lowercase();
    let base = lower.split(['-', '_']).next().unwrap_or("");
    if CLONE_LANGUAGES.contains(&base) {
        Ok(base.to_owned())
    } else {
        Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el idioma no está entre los soportados por el motor local",
        ))
    }
}

/// Sólo loopback: la clonación no puede mandar la muestra a un host remoto.
pub fn local_engine_url(base: &str, engine: CloneEngine) -> Result<String, ProjectError> {
    let trimmed = base.trim().trim_end_matches('/');
    let path = engine.path().trim_end_matches('/');
    let full = if trimmed.ends_with(path) {
        trimmed.to_owned()
    } else {
        format!("{trimmed}{}", engine.path())
    };
    let url = Url::parse(&full).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor de voz no es válida",
        )
    })?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor no puede incluir usuario ni contraseña",
        ));
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor debe usar http o https",
        ));
    }
    if !matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1") | Some("[::1]")
    ) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el motor de clonación debe estar en loopback (localhost/127.0.0.1); no se envía la muestra a internet",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor no debe incluir query ni fragmento",
        ));
    }
    Ok(url.to_string())
}

pub fn validate_reference(ffprobe: &Path, reference: &Path) -> Result<(f64, String), ProjectError> {
    let metadata = std::fs::metadata(reference).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la muestra de voz ya no está en el proyecto",
        )
    })?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la muestra de voz está vacía",
        ));
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la muestra de voz supera los 20 MB",
        ));
    }
    let measure = probe_file(ffprobe, reference, MediaKind::Audio)?;
    let duration = measure.duration_seconds.unwrap_or(0.0);
    if !(MIN_REFERENCE_SECONDS..=MAX_REFERENCE_SECONDS).contains(&duration) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!(
                "la muestra debe durar entre {MIN_REFERENCE_SECONDS:.0} y {MAX_REFERENCE_SECONDS:.0} segundos"
            ),
        ));
    }
    let (sha256, _) = sha256_file(reference)?;
    Ok((duration, sha256))
}

pub fn is_wav(bytes: &[u8]) -> bool {
    bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE"
}

#[cfg(test)]
#[path = "voice_clone.tests.rs"]
mod tests;
