//! Cola de render persistente — adaptador IPC.
//!
//! La lógica vive en `render::queue` (dominio), `application::render_queue`
//! (casos de uso) e `infrastructure::render_queue` (JSON en disco). Acá sólo
//! queda el contrato IPC: mismos nombres, payloads y tipos serde.

use crate::infrastructure::render_queue::LocalRenderQueueStore;
use crate::render::queue::QueueEntry;

/// Estado completo de la cola persistida (con recuperación aplicada).
#[tauri::command]
pub fn render_queue_load() -> Result<Vec<QueueEntry>, String> {
    Ok(crate::application::render_queue::load_render_queue(
        &LocalRenderQueueStore::local(),
    ))
}

/// Reemplaza la cola persistida con la que manda la UI.
#[tauri::command]
pub fn render_queue_save(queue: Vec<QueueEntry>) -> Result<(), String> {
    crate::application::render_queue::save_render_queue(&LocalRenderQueueStore::local(), queue)
}

/// Descarta las entradas terminadas (`done`, `error`, `cancelled`).
#[tauri::command]
pub fn render_queue_clear_finished() -> Result<Vec<QueueEntry>, String> {
    crate::application::render_queue::clear_finished_render_queue(&LocalRenderQueueStore::local())
}
