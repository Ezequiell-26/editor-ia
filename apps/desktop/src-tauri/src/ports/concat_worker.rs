//! Port del `concat-worker`: sesión de proceso JSON-lines y backend que la
//! resuelve/spawnea. La implementación concreta vive en
//! `infrastructure::concat_worker`.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

/// Token de cancelación de una sesión viva: se obtiene al spawnear y
/// permite notificar `{"op":"cancel"}` al worker SIN tomar el mutex de
/// sesión (que está tomado por el `render_export` en vuelo). Es
/// fire-and-forget: `true` = la línea se escribió en el pipe.
pub trait ConcatWorkerCancel: Send + Sync {
    fn cancel(&self) -> bool;
}

/// Sesión viva con el proceso worker. Las requests son seriales; un timeout
/// mata al proceso y la sesión queda inservible.
pub trait ConcatWorkerSession: Send {
    /// Envía un request JSON-line y espera la respuesta dentro de `timeout`.
    /// `Err` = fallo de transporte (protocolo roto, proceso muerto, timeout).
    fn request(&mut self, request: &Value, timeout: Duration) -> Result<Value, String>;
    /// Como `request`, pero las líneas del worker que NO son respuesta
    /// (objetos JSON sin `ok`: eventos `render_export_progress`,
    /// `cancel_ack`) se pasan a `on_event` en vez de ignorarse o romper el
    /// protocolo. Un worker viejo nunca emite esas líneas: compatible.
    fn request_with_events(
        &mut self,
        request: &Value,
        timeout: Duration,
        on_event: &mut dyn FnMut(&Value),
    ) -> Result<Value, String>;
    /// `true` si el proceso hijo sigue vivo.
    fn is_alive(&mut self) -> bool;
    /// Cierre ordenado (op `shutdown` + kill de respaldo).
    fn shutdown(&mut self);
    /// Token de cancelación de ESTA sesión, si el backend lo soporta.
    /// Se consulta al spawnear (antes de que la sesión quede detrás del
    /// mutex) y se guarda aparte: cancel no puede pedir `&mut self` porque
    /// el render en vuelo ya tiene la sesión tomada.
    fn cancel_token(&self) -> Option<Arc<dyn ConcatWorkerCancel>>;
}

/// Resuelve la ruta del ejecutable y spawnea sesiones. `SystemConcatWorker`
/// en infrastructure implementa esto contra el binario real.
pub trait ConcatWorkerBackend {
    /// Ruta del ejecutable si existe en disco (no garantiza que corra).
    fn worker_path(&self) -> Option<PathBuf>;
    /// Spawnea una sesión nueva con el entorno adecuado (PATH de DLLs FFmpeg).
    fn spawn(&self) -> Result<Box<dyn ConcatWorkerSession>, String>;
}
