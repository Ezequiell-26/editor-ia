//! Dominio del puente de sincronización labial: DTOs IPC, validación del
//! endpoint loopback, detección de MP4 y naming del resultado. El HTTP al
//! motor local y el comando quedan en `commands::lip_sync`.

use std::path::{Path, PathBuf};

use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_OUTPUT_SECONDS: f64 = 900.0;
pub const MAX_AUDIO_SECONDS: f64 = 900.0;
pub const MAX_RESPONSE_BYTES: usize = 200 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LipSyncRequest {
    pub video_path: String,
    pub audio_path: String,
    pub output_dir: String,
    /// Endpoint local completo, por ejemplo http://127.0.0.1:8000/lipsync
    pub engine_url: String,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LipSyncResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub engine: String,
}

/// El motor de lip-sync sólo puede vivir en loopback: el video del proyecto
/// nunca sale a internet por este camino.
pub fn loopback_endpoint(value: &str) -> Result<String, ProjectError> {
    let url = Url::parse(value.trim()).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor de lip-sync no es válida",
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
            "el motor de lip-sync debe estar en loopback (localhost/127.0.0.1); no se envía el video a internet",
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

/// Un MP4 contiene el box `ftyp` cerca del inicio; FFprobe hace la validación
/// definitiva después de recibirlo.
pub fn is_mp4(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && bytes.windows(4).take(32).any(|window| window == b"ftyp")
}

/// Valida la duración del audio de entrada (0,1–900 s).
pub fn validate_audio_duration(seconds: f64) -> Result<(), ProjectError> {
    if seconds <= 0.0 || seconds > MAX_AUDIO_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio del lip-sync debe durar entre 0,1 y 900 segundos",
        ));
    }
    Ok(())
}

/// Valida el video producido por el motor (dimensiones y duración > 0, ≤900 s).
pub fn validate_output_probe(width: u32, height: u32, duration: f64) -> Result<(), ProjectError> {
    if width == 0 || height == 0 || duration <= 0.0 || duration > MAX_OUTPUT_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el motor devolvió un video sin dimensiones o duración válidas",
        ));
    }
    Ok(())
}

/// Ruta final `<stem>-lipsync.mp4` con sufijo `-N` si ya existe.
pub fn lipsync_output_path(output_dir: &Path, video_path: &Path) -> PathBuf {
    let stem = video_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let safe: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let base = safe.trim_matches('-');
    let base = if base.is_empty() { "video" } else { base };
    let mut final_path = output_dir.join(format!("{base}-lipsync.mp4"));
    let mut index = 2;
    while final_path.exists() {
        final_path = output_dir.join(format!("{base}-lipsync-{index}.mp4"));
        index += 1;
    }
    final_path
}

#[cfg(test)]
#[path = "lip_sync.tests.rs"]
mod tests;
