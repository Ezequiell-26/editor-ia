//! Cola de render persistente — adaptador IPC.
//!
//! La lógica vive en `render::queue` (dominio), `application::render_queue`
//! (casos de uso) e `infrastructure::render_queue` (JSON en disco). Acá sólo
//! queda el contrato IPC: mismos nombres, payloads y tipos serde.

use tauri::State;

use crate::render::queue::QueueEntry;
use crate::state::AppState;

/// Estado completo de la cola persistida (con recuperación aplicada).
#[tauri::command]
pub fn render_queue_load(state: State<'_, AppState>) -> Result<Vec<QueueEntry>, String> {
    Ok(crate::application::render_queue::load_render_queue(
        &state.render_queue_store(),
    ))
}

/// Reemplaza la cola persistida con la que manda la UI.
#[tauri::command]
pub fn render_queue_save(state: State<'_, AppState>, queue: Vec<QueueEntry>) -> Result<(), String> {
    crate::application::render_queue::save_render_queue(&state.render_queue_store(), queue)
}

/// Descarta las entradas terminadas (`done`, `error`, `cancelled`).
#[tauri::command]
pub fn render_queue_clear_finished(state: State<'_, AppState>) -> Result<Vec<QueueEntry>, String> {
    crate::application::render_queue::clear_finished_render_queue(&state.render_queue_store())
}
