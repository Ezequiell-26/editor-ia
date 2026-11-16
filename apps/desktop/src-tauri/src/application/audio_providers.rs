//! Audio providers: validación de configuración y errores de API.
//!
//! Reglas puras de proveedor de audio (SAPI local, ElevenLabs, web manual):
//! identificadores, URL externa HTTPS, texto acotado y extracción acotada de
//! mensajes de error de la API. El keyring, HTTP y la síntesis quedan en la
//! capa de comandos.

use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_TEXT_CHARS: usize = 4_000;
pub const DEFAULT_MODEL: &str = "eleven_multilingual_v2";

pub fn validate_kind(kind: &str) -> Result<&'static str, ProjectError> {
    match kind {
        "windows-sapi" => Ok("windows-sapi"),
        "elevenlabs" => Ok("elevenlabs"),
        "external-web" => Ok("external-web"),
        _ => Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "proveedor de audio desconocido",
        )),
    }
}

pub fn validate_voice_id(value: &str) -> Result<String, ProjectError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "elegí una voz antes de sintetizar",
        ));
    }
    if value.chars().count() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el identificador de la voz no es válido",
        ));
    }
    Ok(value.to_owned())
}

pub fn validate_model_id(value: &str) -> Result<String, ProjectError> {
    let value = if value.trim().is_empty() {
        DEFAULT_MODEL
    } else {
        value.trim()
    };
    if value.chars().count() > 80
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el identificador del modelo de voz no es válido",
        ));
    }
    Ok(value.to_owned())
}

pub fn validate_external_url(value: &str) -> Result<String, ProjectError> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.chars().count() > 500 {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL de la web externa es demasiado larga",
        ));
    }
    let url = reqwest::Url::parse(value).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL de la web externa no es válida",
        )
    })?;
    if url.scheme() != "https" {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la web externa debe usar HTTPS",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL de la web externa no puede incluir credenciales",
        ));
    }
    Ok(url.to_string())
}

pub fn validate_text(text: &str) -> Result<String, ProjectError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la narración está vacía",
        ));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la narración supera los 4000 caracteres",
        ));
    }
    Ok(text.to_owned())
}

pub fn extract_api_error(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let message = value["detail"]["message"]
        .as_str()
        .or_else(|| value["detail"].as_str())
        .or_else(|| value["message"].as_str())?;
    Some(message.chars().take(300).collect())
}

#[cfg(test)]
#[path = "audio_providers.tests.rs"]
mod tests;
