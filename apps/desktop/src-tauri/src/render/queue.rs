//! Cola de render persistida: tipos y reglas puras.
//!
//! La lectura/escritura del archivo vive en infrastructure; aquí quedan el
//! contrato serde (espejo de `state/render-queue.ts` del frontend) y las
//! reglas: tope de 50 entradas y recuperación `running → pending` al cargar
//! (un render quedó incompleto: nunca se reporta como entregado).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RENDER_QUEUE_LIMIT: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueStatus {
    Pending,
    Running,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub profile_id: String,
    pub profile_name: String,
    #[serde(default)]
    pub include_captions: bool,
    pub status: QueueStatus,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    pub queued_at: String,
}

/// Estado que `clear_finished` conserva: lo que todavía puede correr.
pub fn is_unfinished(status: QueueStatus) -> bool {
    matches!(status, QueueStatus::Pending | QueueStatus::Running)
}

/// Reglas de carga: JSON ya parseado → entradas válidas con recuperación
/// `running → pending` y la cola capada a `RENDER_QUEUE_LIMIT` (las más
/// viejas se descartan). Entradas basura se degradan, no tumban la carga.
pub fn recover_entries(items: Vec<Value>) -> Vec<QueueEntry> {
    let mut entries: Vec<QueueEntry> = items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<QueueEntry>(item).ok())
        .map(|mut entry| {
            if entry.status == QueueStatus::Running {
                entry.status = QueueStatus::Pending;
                entry.output_path = None;
                entry.message = None;
            }
            entry
        })
        .collect();
    let start = entries.len().saturating_sub(RENDER_QUEUE_LIMIT);
    entries.drain(..start);
    entries
}

/// La porción de la cola que se persiste (capeada a `RENDER_QUEUE_LIMIT`).
pub fn persisted_slice(queue: &[QueueEntry]) -> &[QueueEntry] {
    let start = queue.len().saturating_sub(RENDER_QUEUE_LIMIT);
    &queue[start..]
}
