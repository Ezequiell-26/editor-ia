//! Aislamiento de voz — dominio puro: rutas de stem, marcador de caché y
//! validación de parámetros del motor Demucs.
//!
//! El comando `prepare_voice_isolation` deja el stem en
//! `<root>/media/isolation/<assetId>/vocals.wav`, ruta fija que el render
//! consulta cuando `clip.audio.voiceIsolation.enabled`. Este módulo es puro
//! (fs/JSON determinista, sin procesos ni sesión); el estado del motor Python
//! y la ejecución de Demucs quedan en commands.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const ISOLATION_DIR: &str = "media/isolation";

/// Demucs carga el material entero en memoria (~1,3 GB por hora de audio en
/// float32): más de 2 h de entrada puede tirar la app en PCs de 16 GB.
/// El límite es por duración medida con ffprobe, no por tamaño de archivo.
pub const MAX_ISOLATION_SECONDS: f64 = 2.0 * 3600.0;

#[derive(Debug, Clone, Serialize)]
pub struct VoiceIsolationStatus {
    pub available: bool,
    pub python: Option<PathBuf>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceIsolationOutcome {
    pub vocals_path: PathBuf,
    pub accompaniment_path: Option<PathBuf>,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub processing_time_ms: u64,
    /// true cuando se reutilizó un stem ya generado (no corrió el modelo).
    pub cached: bool,
}

pub fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

pub fn validate_quality(quality: Option<&str>) -> Result<&'static str, ProjectError> {
    match quality.unwrap_or("medium") {
        "low" => Ok("low"),
        "medium" => Ok("medium"),
        "high" => Ok("high"),
        "best" => Ok("best"),
        _ => Err(invalid("la calidad debe ser low, medium, high o best")),
    }
}

pub fn validate_model(model: Option<&str>) -> Result<String, ProjectError> {
    let model = model.unwrap_or("htdemucs");
    if !model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(invalid("el nombre del modelo no es válido"));
    }
    Ok(model.to_owned())
}

/// Stem cacheado de un asset: `<root>/media/isolation/<assetId>/vocals.wav`.
/// Es la ruta fija que el render consulta cuando el clip tiene
/// `audio.voiceIsolation.enabled`.
pub fn isolation_stem_path(root: &Path, asset_id: &str) -> PathBuf {
    root.join(ISOLATION_DIR.replace('/', "\\"))
        .join(asset_id)
        .join("vocals.wav")
}

/// Marcador de caché junto al stem: registra de qué fuente, con qué calidad
/// y modelo se generó, más los metadatos del audio resultante. Sin él, un
/// stem viejo se reutilizaba aunque el material cambiara o se pidiera otra
/// calidad (AUD-010).
fn isolation_marker_path(root: &Path, asset_id: &str) -> PathBuf {
    isolation_stem_path(root, asset_id)
        .parent()
        .map(|dir| dir.join(".cache.json"))
        .unwrap_or_else(|| root.join(".cache.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IsolationMarker {
    source_path: String,
    /// size + mtime del fuente al momento de procesar: detecta reemplazos
    /// del material sin hashear archivos de horas (AUD-010).
    source_size: u64,
    source_mtime_ms: u64,
    quality: String,
    model: String,
    duration_seconds: f64,
    sample_rate: u32,
    channels: u32,
}

fn source_fingerprint(source: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(source).ok()?;
    let mtime_ms = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((meta.len(), mtime_ms))
}

/// Un stem cacheado sólo vale si existe completo (vocals + accompaniment no
/// vacíos, AUD-011) y el marcador coincide con la fuente y la calidad
/// pedidas. Devuelve los metadatos guardados para reportarlos sin inventar.
pub fn cached_outcome(
    root: &Path,
    asset_id: &str,
    source: &Path,
    quality: &str,
    model: &str,
) -> Option<VoiceIsolationOutcome> {
    let dir = isolation_stem_path(root, asset_id).parent()?.to_path_buf();
    let vocals = dir.join("vocals.wav");
    let accompaniment = dir.join("accompaniment.wav");
    let non_empty = |p: &Path| {
        std::fs::metadata(p)
            .map(|m| m.is_file() && m.len() > 44)
            .unwrap_or(false)
    };
    if !non_empty(&vocals) || !non_empty(&accompaniment) {
        return None;
    }
    let marker: IsolationMarker =
        serde_json::from_slice(&std::fs::read(isolation_marker_path(root, asset_id)).ok()?).ok()?;
    let (size, mtime) = source_fingerprint(source)?;
    if marker.source_size != size
        || marker.source_mtime_ms != mtime
        || marker.quality != quality
        || marker.model != model
    {
        return None;
    }
    Some(VoiceIsolationOutcome {
        vocals_path: vocals,
        accompaniment_path: Some(accompaniment),
        duration_seconds: marker.duration_seconds,
        sample_rate: marker.sample_rate,
        channels: marker.channels,
        processing_time_ms: 0,
        cached: true,
    })
}

pub fn write_marker(
    root: &Path,
    asset_id: &str,
    source: &Path,
    quality: &str,
    model: &str,
    outcome: &VoiceIsolationOutcome,
) {
    let Some((size, mtime)) = source_fingerprint(source) else {
        return;
    };
    let marker = IsolationMarker {
        source_path: source.to_string_lossy().into_owned(),
        source_size: size,
        source_mtime_ms: mtime,
        quality: quality.to_owned(),
        model: model.to_owned(),
        duration_seconds: outcome.duration_seconds,
        sample_rate: outcome.sample_rate,
        channels: outcome.channels,
    };
    if let Ok(bytes) = serde_json::to_vec(&marker) {
        let _ = std::fs::write(isolation_marker_path(root, asset_id), bytes);
    }
}

#[cfg(test)]
#[path = "voice_isolation.tests.rs"]
mod tests;
