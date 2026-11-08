//! Exportación sin recodificar — adaptador IPC.
//!
//! La lógica vive en `application::lossless` sobre los puertos
//! `MediaTools`/`MediaRunner`/`LosslessOutputs`; las reglas puras en
//! `render::lossless` y la reserva de nombres en `infrastructure::render_lossless`.
//! Acá sólo queda el contrato IPC: mismos nombres, payloads y tipos serde.

use tauri::State;

use crate::infrastructure::media::{StateMediaTools, SystemMediaRunner};
use crate::infrastructure::render_lossless::LocalLosslessOutputs;
use crate::projects::service::ProjectError;
use crate::render::lossless::{ChapterInput, ChaptersResult, ExtractResult, LosslessResult};
use crate::state::AppState;

/// Corta `input` entre `start_seconds` y `end_seconds` sin recodificar.
#[tauri::command]
pub async fn export_lossless(
    state: State<'_, AppState>,
    input: String,
    output: String,
    start_seconds: f64,
    end_seconds: f64,
    exact: Option<bool>,
) -> Result<LosslessResult, ProjectError> {
    let tools = StateMediaTools::new(&state);
    let runner = SystemMediaRunner;
    let outputs = LocalLosslessOutputs;
    crate::application::lossless::export_lossless(
        &tools,
        &runner,
        &outputs,
        &input,
        &output,
        start_seconds,
        end_seconds,
        exact,
    )
}

/// Cambia el contenedor sin tocar los códecs (`-c copy`).
#[tauri::command]
pub async fn remux(
    state: State<'_, AppState>,
    input: String,
    output: String,
) -> Result<LosslessResult, ProjectError> {
    let tools = StateMediaTools::new(&state);
    let runner = SystemMediaRunner;
    let outputs = LocalLosslessOutputs;
    crate::application::lossless::remux(&tools, &runner, &outputs, &input, &output)
}

/// Escribe capítulos y título dentro de una copia del archivo.
#[tauri::command]
pub async fn write_chapters(
    state: State<'_, AppState>,
    input: String,
    output: String,
    title: Option<String>,
    chapters: Vec<ChapterInput>,
) -> Result<ChaptersResult, ProjectError> {
    let tools = StateMediaTools::new(&state);
    let runner = SystemMediaRunner;
    let outputs = LocalLosslessOutputs;
    crate::application::lossless::write_chapters(
        &tools, &runner, &outputs, &input, &output, title, chapters,
    )
}

/// Extrae la primera pista de audio sin recodificar.
#[tauri::command]
pub async fn extract_audio(
    state: State<'_, AppState>,
    input: String,
    output: String,
) -> Result<ExtractResult, ProjectError> {
    let tools = StateMediaTools::new(&state);
    let runner = SystemMediaRunner;
    let outputs = LocalLosslessOutputs;
    crate::application::lossless::extract_audio(&tools, &runner, &outputs, &input, &output)
}
