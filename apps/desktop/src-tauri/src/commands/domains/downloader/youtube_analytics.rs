//! Analizador de canales de YouTube.
//!
//! Usa el yt-dlp ya gestionado por la app para listar el canal y leer metadatos
//! públicos: vistas, likes, comentarios, duración, fecha, miniatura y título.
//! No usa LLM: el ranking, el sentimiento y los patrones de título son
//! heurísticas locales medibles.

use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};

use crate::commands::downloader::resolve_engine;
use crate::commands::hide_console;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

// DTOs, constantes y heurísticas puras: application::channel_analytics.
// El pub use mantiene los nombres visibles para los include! hermanos
// (engine/thumbnails/channel) y los tests.
pub use crate::application::channel_analytics::*;

fn provider_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

fn emit_progress(app: Option<&AppHandle>, stage: &str, current: u32, total: u32, message: &str) {
    let Some(app) = app else {
        return;
    };
    let _ = app.emit(
        "channel-analysis-progress",
        ChannelProgress {
            stage: stage.to_owned(),
            current,
            total,
            message: message.to_owned(),
        },
    );
}

include!("youtube_analytics/engine.rs");
include!("youtube_analytics/thumbnails.rs");
include!("youtube_analytics/channel.rs");

#[tauri::command]
pub async fn analyze_youtube_channel(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ChannelAnalysisRequest,
) -> Result<ChannelReport, ProjectError> {
    let config_dir = state.config_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        analyze_channel_blocking(Some(&app), &config_dir, request)
    })
    .await
    .map_err(|error| provider_error(&format!("el analizador de canales falló: {error}")))?
}
#[cfg(test)]
#[path = "youtube_analytics.live_tests.rs"]
mod live_tests;
#[cfg(test)]
#[path = "youtube_analytics.tests.rs"]
mod tests;
