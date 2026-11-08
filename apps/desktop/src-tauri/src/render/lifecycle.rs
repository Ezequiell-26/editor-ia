//! Ciclo de vida del render: DTOs de eventos IPC y helpers puros de
//! nombres de archivo. La orquestación vive en `application::render_lifecycle`
//! y el worker FFmpeg en `infrastructure::render_jobs`.

use std::path::PathBuf;

use serde::Serialize;

use crate::render::export_tools::ExportVerification;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderStarted {
    pub job_id: String,
    pub profile_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgressEvent {
    pub job_id: String,
    pub percent: f64,
    pub processed_seconds: f64,
    pub total_seconds: f64,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderFinishedEvent {
    pub job_id: String,
    pub status: String,
    pub code: Option<String>,
    pub message: Option<String>,
    pub detail: Option<String>,
    pub output_path: Option<String>,
    pub output_bytes: Option<u64>,
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub elapsed_ms: u64,
    /// Reporte FFprobe del archivo entregado (sólo cuando termina bien).
    pub verification: Option<ExportVerification>,
}

/// Nombre seguro para el archivo sugerido de exportación.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('-');
    if cleaned.is_empty() {
        "export".to_owned()
    } else {
        cleaned.chars().take(80).collect()
    }
}

/// Garantiza extensión `.mp4` (case-insensitive) en la ruta elegida.
pub fn ensure_mp4(mut path: PathBuf) -> PathBuf {
    if path
        .extension()
        .map(|value| value.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        path
    } else {
        path.set_extension("mp4");
        path
    }
}
