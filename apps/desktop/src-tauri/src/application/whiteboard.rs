//! Whiteboard — dominio puro: DTOs del motor y validación de parámetros.
//!
//! El motor es el paquete Python `whiteboard-animator` (MIT, © Masih Sultani),
//! instalado en un Python del equipo — no se distribuye dentro del binario,
//! igual que Faster-Whisper y Demucs. `whiteboard_generate` convierte una
//! imagen de estilo pizarra en un video donde el contenido se dibuja trazo a
//! trazo, con pacing opcional sobre un audio de narración.
//!
//! Este módulo no conoce Tauri ni procesos: validación y vistas tipadas.
//! La resolución del intérprete, el spawn con deadline y el ffprobe del
//! resultado viven en `commands::whiteboard`.

use std::path::PathBuf;

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Un scene sin audio no tiene sentido más largo que esto: el dibujo ya
/// termina en el primer 70 % del slot y el resto es frame congelado.
pub const MAX_SCENE_SECONDS: f64 = 60.0 * 60.0;

/// La duración de la narración marca la duración del video: más de una hora
/// por escena es un abuso que el deadline de 2 h no llegaría a cubrir bien.
pub const MAX_AUDIO_SECONDS: f64 = 60.0 * 60.0;

/// Deadline del proceso Python: el render es CPU-bound pero acotado por la
/// duración de la escena; 2 h cubre el peor caso sin dejar un cuelgue eterno.
pub const GENERATION_TIMEOUT_SECONDS: u64 = 2 * 3600;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardStatus {
    pub available: bool,
    pub python: Option<PathBuf>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardOutcome {
    /// MP4 generado (h264 + audio si se pasó narración).
    pub video_path: PathBuf,
    /// Metadatos medidos con ffprobe sobre el archivo resultante; 0 si el
    /// probe no estuvo disponible.
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub processing_time_ms: u64,
}

pub fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

pub fn validate_quality(quality: Option<&str>) -> Result<&'static str, ProjectError> {
    match quality.unwrap_or("medium") {
        "low" => Ok("low"),
        "medium" => Ok("medium"),
        "high" => Ok("high"),
        _ => Err(invalid("la calidad debe ser low, medium o high")),
    }
}

/// Duración de la escena cuando NO hay audio. Con audio el engine usa la
/// duración del archivo y este valor se ignora (se valida igual para
/// detectar errores del cliente temprano).
pub fn validate_duration(seconds: Option<f64>) -> Result<f64, ProjectError> {
    let seconds = seconds.unwrap_or(8.0);
    if !seconds.is_finite() || seconds <= 0.0 {
        return Err(invalid(
            "la duración debe ser un número finito mayor que cero",
        ));
    }
    if seconds > MAX_SCENE_SECONDS {
        return Err(invalid(
            "la duración no puede superar 60 minutos por escena",
        ));
    }
    Ok(seconds)
}

#[cfg(test)]
#[path = "whiteboard.tests.rs"]
mod tests;
