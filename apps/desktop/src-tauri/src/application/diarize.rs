//! Diarización por proveedor externo — DTOs IPC, parsers de respuesta y
//! validación de la configuración del proveedor. La clave vive en el
//! almacén de Windows y las llamadas HTTP quedan en `commands::diarize`.

use serde::Serialize;
use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const KEYRING_SERVICE: &str = "editor-ia.diarize";
pub const KEYRING_USER: &str = "diarize";
pub const DEEPGRAM_URL: &str = "https://api.deepgram.com";
pub const ASSEMBLY_URL: &str = "https://api.assemblyai.com";
pub const POLL_ATTEMPTS: u32 = 100;
pub const POLL_SECONDS: u64 = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeProviderInfo {
    pub kind: String,
    pub base_url: String,
    pub language: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerSegment {
    /// Segundos desde el inicio del material.
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeResult {
    pub provider: String,
    pub segments: Vec<SpeakerSegment>,
}

/// Config del proveedor ya normalizada: `(kind, base_url, language)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiarizeConfig {
    pub kind: String,
    pub base_url: String,
    pub language: String,
}

/// Normaliza kind/base_url/language igual que el comando `save_diarize_provider`.
pub fn normalize_diarize_config(
    kind: &str,
    base_url: &str,
    language: &str,
) -> Result<DiarizeConfig, ProjectError> {
    let kind = match kind {
        "deepgram" => "deepgram",
        "assemblyai" => "assemblyai",
        _ => "none",
    };
    let base_url = base_url.trim().trim_end_matches('/').to_owned();
    // La clave y el audio viajan a este host: la misma política que los
    // proveedores de IA — http sólo en loopback exacto, https siempre para
    // hosts remotos, sin credenciales embebidas en la URL.
    if !base_url.is_empty() {
        crate::ai::providers::validate_provider_base_url(&base_url)?;
    }
    let language = {
        let trimmed = language.trim();
        if trimmed.is_empty() {
            "es".to_owned()
        } else {
            trimmed.to_owned()
        }
    };
    Ok(DiarizeConfig {
        kind: kind.to_owned(),
        base_url,
        language,
    })
}

/// Una clave nueva tiene que tener un largo mínimo razonable.
pub fn validate_api_key(secret: &str) -> Result<(), ProjectError> {
    if secret.trim().chars().count() < 8 {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la clave parece demasiado corta",
        ));
    }
    Ok(())
}

pub fn parse_deepgram(value: &Value) -> Vec<SpeakerSegment> {
    value["results"]["utterances"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let start = item["start"].as_f64()?;
                    let end = item["end"].as_f64()?;
                    let text = item["transcript"].as_str()?.trim().to_owned();
                    let speaker = item["speaker"]
                        .as_u64()
                        .map(|number| number.to_string())
                        .or_else(|| item["speaker"].as_str().map(str::to_owned))?;
                    if text.is_empty() || end <= start {
                        return None;
                    }
                    Some(SpeakerSegment {
                        start,
                        end,
                        text,
                        speaker,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_assemblyai(value: &Value) -> Vec<SpeakerSegment> {
    value["utterances"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    // AssemblyAI devuelve milisegundos.
                    let start = item["start"].as_f64()? / 1000.0;
                    let end = item["end"].as_f64()? / 1000.0;
                    let text = item["text"].as_str()?.trim().to_owned();
                    let speaker = item["speaker"].as_str()?.trim().to_owned();
                    if text.is_empty() || end <= start || speaker.is_empty() {
                        return None;
                    }
                    Some(SpeakerSegment {
                        start,
                        end,
                        text,
                        speaker,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "diarize.tests.rs"]
mod tests;
