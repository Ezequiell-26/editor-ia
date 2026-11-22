//! Adaptadores IPC del `concat-worker` (proceso JSON-lines con
//! `concat-media`) y del audit log del MCP.
//!
//! La lógica vive en `application::concat_worker` (sesión persistente,
//! allowlist de ops) e `application::mcp_audit` (cola JSONL). Acá sólo se
//! traduce la firma Tauri y se resuelve el `config_dir` para el audit.

use serde_json::Value;
use tauri::{Emitter, State};

use crate::application::concat_worker::{self, ConcatWorkerStatus};
use crate::application::mcp_audit::{self, AuditTail};
use crate::projects::service::ProjectError;
use crate::state::AppState;

/// Evento Tauri con las líneas de EVENTO del worker (JSON sin `ok`):
/// `render_export_progress` durante un render y `cancel_ack` tras un
/// cancel. El frontend lo escucha con `listen('concat-worker-progress')`.
pub const CONCAT_WORKER_EVENT: &str = "concat-worker-progress";

/// Disponibilidad del worker: ejecutable resuelto, ops del protocolo y si
/// hay sesión viva. No spawnea el proceso — para eso está `ping` vía
/// `concat_worker_request`.
#[tauri::command]
pub fn concat_worker_status(state: State<'_, AppState>) -> ConcatWorkerStatus {
    concat_worker::status(&state.concat_worker_backend())
}

/// Request genérico al worker: `op` debe estar en la allowlist
/// (`ping`, `probe`, `decode_frame`, `render_export`, `shutdown`) y `params` es el resto del
/// JSON (`path`, `time`, `out`, `width`, ... según la op).
///
/// Devuelve el envelope del worker: `{"ok": true, ...}` o
/// `{"ok": false, "error": "..."}` (falla de la op, sesión viva). Un `Err`
/// del comando es fallo de transporte: worker no disponible, timeout
/// (el proceso se mata) o respuesta inválida.
///
/// Mientras la request está en vuelo, las líneas de EVENTO del worker se
/// re-emiten como `concat-worker-progress` (payload = el JSON del evento:
/// `{"type":"render_export_progress","phase":...,"frames":..., ...}`).
///
/// `timeout_ms` se acota a [500, 600000]; default 30 s. El worker no
/// implementa cancelación por timeout — eso es `concat_worker_cancel_render`.
#[tauri::command]
pub async fn concat_worker_request(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    op: String,
    params: Option<Value>,
    timeout_ms: Option<u64>,
) -> Result<Value, ProjectError> {
    concat_worker::request_with_events(
        &state.concat_worker_backend(),
        &op,
        &params.unwrap_or(Value::Null),
        timeout_ms,
        &mut |event| {
            let _ = app.emit(CONCAT_WORKER_EVENT, event.clone());
        },
    )
}

/// Cancela el `render_export` en curso del worker activo. Es
/// fire-and-forget: devuelve `true` si la notificación `{"op":"cancel"}`
/// se escribió en el pipe del proceso. El render aborta en el próximo
/// frame o cambio de fase y la request en vuelo responde
/// `{"ok": false, "error": "render_export cancelled"}`; el worker sigue
/// vivo. No usa el mutex de sesión (estaría tomado por el render), por eso
/// es un comando aparte y no la op `cancel` de `concat_worker_request`.
#[tauri::command]
pub fn concat_worker_cancel_render() -> bool {
    concat_worker::cancel_render()
}

/// Últimas `limit` entradas del audit log JSONL del servidor MCP
/// (`<config_dir>/mcp-audit.jsonl`), parseadas y re-sanitizadas. `limit`
/// default 50, tope 500. Archivo inexistente → cola vacía.
#[tauri::command]
pub fn mcp_audit_tail(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<AuditTail, ProjectError> {
    mcp_audit::tail(
        &state.config_dir.join("mcp-audit.jsonl"),
        limit.unwrap_or(50),
    )
}
