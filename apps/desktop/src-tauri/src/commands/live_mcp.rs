//! Puente MCP en vivo: la app abierta ejecuta las herramientas del agente y un
//! cliente MCP local (stdio) las consume por el puente HTTP autenticado.
//!
//! El registro de esquemas y la ejecución viven en la UI: este módulo sólo
//! guarda los esquemas, encola un pedido, espera la respuesta con timeout y
//! devuelve el resultado. Desactivado por defecto; sin `enabled` no se emite
//! nada y el endpoint responde 403.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_TOOLS: usize = 64;
const MAX_TOOLS_BYTES: usize = 131_072;

pub struct LiveMcp {
    tools: Mutex<Option<Value>>,
    pending: Mutex<HashMap<String, Sender<Value>>>,
    enabled: AtomicBool,
    workspace: Mutex<Option<PathBuf>>,
    /// `--mcp-workspace` fija el root de la sesión: la restauración de un
    /// proyecto en la UI no debe reemplazarlo.
    workspace_locked: AtomicBool,
    /// `--mcp-export`/`EDITOR_IA_MCP_EXPORT=1` habilita exportar en sesiones
    /// headless de confianza sin depender del localStorage de la UI.
    export_allowed: AtomicBool,
    /// Suscriptores SSE (`/v1/mcp/events`).
    event_subscribers: Mutex<Vec<Sender<String>>>,
    /// Secuencia e historial corto para reconexión con Last-Event-ID.
    event_sequence: AtomicU64,
    event_history: Mutex<VecDeque<(u64, String)>>,
    /// Resultados idempotentes por clave (TTL 10 min, máximo 100).
    idempotency: Mutex<HashMap<String, (Instant, Value)>>,
}

impl Default for LiveMcp {
    fn default() -> Self {
        Self {
            tools: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            enabled: AtomicBool::new(false),
            workspace: Mutex::new(None),
            workspace_locked: AtomicBool::new(false),
            export_allowed: AtomicBool::new(false),
            event_subscribers: Mutex::new(Vec::new()),
            event_sequence: AtomicU64::new(0),
            event_history: Mutex::new(VecDeque::new()),
            idempotency: Mutex::new(HashMap::new()),
        }
    }
}

const IDEMPOTENCY_TTL: Duration = Duration::from_secs(600);
const IDEMPOTENCY_MAX: usize = 100;

pub fn outcome_is_cacheable(outcome: &Value) -> bool {
    if outcome.get("ok").is_none() {
        return false;
    }
    let summary = outcome
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("");
    !summary.contains("no respondió")
        && !summary.contains("desactivado")
        && !summary.contains("no está disponible")
        && !summary.contains("herramienta desconocida")
}

impl LiveMcp {
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    pub fn export_allowed(&self) -> bool {
        self.export_allowed.load(Ordering::SeqCst)
    }

    /// Registra un cliente SSE. El receptor se cierra cuando se cae el socket.
    pub fn subscribe_events(&self) -> Receiver<String> {
        let (sender, receiver) = channel();
        if let Ok(mut subscribers) = self.event_subscribers.lock() {
            subscribers.push(sender);
        }
        receiver
    }

    /// Difunde un evento numerado a los clientes SSE, guarda historial corto
    /// para Last-Event-ID y descarta los suscriptores desconectados.
    pub fn emit_event(&self, event: &Value) -> u64 {
        let id = self.event_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let mut numbered = event.clone();
        if let Some(object) = numbered.as_object_mut() {
            object.insert("eventId".to_owned(), json!(id));
        }
        let payload = numbered.to_string();
        if let Ok(mut history) = self.event_history.lock() {
            history.push_back((id, payload.clone()));
            while history.len() > 200 {
                history.pop_front();
            }
        }
        if let Ok(mut subscribers) = self.event_subscribers.lock() {
            subscribers.retain(|sender| sender.send(payload.clone()).is_ok());
        }
        id
    }

    /// Eventos posteriores a `last_id` para reenviar tras una reconexión SSE.
    pub fn events_since(&self, last_id: u64) -> Vec<(u64, String)> {
        self.event_history
            .lock()
            .map(|history| {
                history
                    .iter()
                    .filter(|(id, _)| *id > last_id)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn cached_outcome(&self, key: &str) -> Option<Value> {
        let mut cache = self.idempotency.lock().ok()?;
        cache.retain(|_, (stored, _)| stored.elapsed() < IDEMPOTENCY_TTL);
        cache.get(key).map(|(_, outcome)| outcome.clone())
    }

    pub fn remember_outcome(&self, key: &str, outcome: &Value) {
        if key.is_empty() || !outcome_is_cacheable(outcome) {
            return;
        }
        let Ok(mut cache) = self.idempotency.lock() else {
            return;
        };
        cache.retain(|_, (stored, _)| stored.elapsed() < IDEMPOTENCY_TTL);
        if cache.len() >= IDEMPOTENCY_MAX {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, (stored, _))| *stored)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(key.to_owned(), (Instant::now(), outcome.clone()));
    }

    pub fn subscriber_count(&self) -> usize {
        self.event_subscribers
            .lock()
            .map(|subscribers| subscribers.len())
            .unwrap_or(0)
    }

    pub fn set_export_allowed(&self, allowed: bool) {
        self.export_allowed.store(allowed, Ordering::SeqCst);
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            if let Ok(mut pending) = self.pending.lock() {
                for (_, sender) in pending.drain() {
                    let _ = sender.send(json!({
                        "ok": false,
                        "summary": "el control en vivo se desactivó"
                    }));
                }
            }
        }
    }

    /// Valida y guarda los esquemas MCP (`{name, description, inputSchema}`).
    pub fn register_tools(&self, tools: Value) -> Result<usize, String> {
        let Some(array) = tools.as_array() else {
            return Err("los esquemas deben ser un arreglo".to_owned());
        };
        if array.len() > MAX_TOOLS {
            return Err(format!("máximo {MAX_TOOLS} herramientas"));
        }
        let mut sanitized = Vec::with_capacity(array.len());
        for tool in array {
            let name = tool
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty() && name.len() <= 80)
                .ok_or_else(|| "cada herramienta necesita un nombre válido".to_owned())?;
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .chars()
                .take(600)
                .collect::<String>();
            let schema = tool
                .get("inputSchema")
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            if !schema.is_object() {
                return Err(format!("el esquema de {name} debe ser un objeto"));
            }
            sanitized.push(json!({
                "name": name,
                "description": description,
                "inputSchema": schema,
            }));
        }
        let value = Value::Array(sanitized);
        let bytes = value.to_string().len();
        if bytes > MAX_TOOLS_BYTES {
            return Err(format!("los esquemas superan {MAX_TOOLS_BYTES} bytes"));
        }
        let count = value.as_array().map(Vec::len).unwrap_or(0);
        let mut guard = self
            .tools
            .lock()
            .map_err(|_| "el registro de herramientas no está disponible".to_owned())?;
        *guard = Some(value);
        Ok(count)
    }

    pub fn tools_snapshot(&self) -> Option<Value> {
        self.tools.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn tool_count(&self) -> usize {
        self.tools
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().and_then(Value::as_array).map(Vec::len))
            .unwrap_or(0)
    }

    pub fn has_tool(&self, name: &str) -> bool {
        self.tools
            .lock()
            .ok()
            .and_then(|guard| {
                guard.as_ref().and_then(|tools| {
                    tools
                        .as_array()
                        .map(|array| array.iter().any(|tool| tool.get("name").and_then(Value::as_str) == Some(name)))
                })
            })
            .unwrap_or(false)
    }

    /// Encola un pedido y espera el resultado de la UI con timeout.
    pub fn call<F>(&self, tool: &str, args: Value, emit: F, timeout: Duration) -> Value
    where
        F: FnOnce(String, Value) -> Result<(), String>,
    {
        if !self.is_enabled() {
            return json!({ "ok": false, "summary": "el control en vivo está desactivado" });
        }
        if !args.is_object() {
            return json!({ "ok": false, "summary": "los argumentos deben ser un objeto" });
        }
        if !self.has_tool(tool) {
            return json!({ "ok": false, "summary": format!("herramienta desconocida o no registrada: {tool}") });
        }
        if let Err(error) = self.validate_tool_paths(tool, &args) {
            return json!({ "ok": false, "summary": error });
        }
        let request_id = Uuid::new_v4().simple().to_string();
        let (sender, receiver) = channel();
        let inserted = self
            .pending
            .lock()
            .map(|mut pending| {
                pending.insert(request_id.clone(), sender);
            })
            .is_ok();
        if !inserted {
            return json!({ "ok": false, "summary": "la cola del puente en vivo no está disponible" });
        }
        let payload = json!({
            "requestId": request_id,
            "tool": tool,
            "arguments": args,
        });
        if let Err(error) = emit(request_id.clone(), payload) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&request_id);
            }
            return json!({ "ok": false, "summary": format!("no se pudo avisar a la app: {error}") });
        }
        match receiver.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&request_id);
                }
                json!({ "ok": false, "summary": format!("la app no respondió a tiempo ({} s)", timeout.as_secs()) })
            }
            Err(RecvTimeoutError::Disconnected) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&request_id);
                }
                json!({ "ok": false, "summary": "la app cerró el pedido en vivo" })
            }
        }
    }

    /// Resuelve un pedido; devuelve `false` si ya expiró o no existe.
    pub fn complete(&self, request_id: &str, outcome: Value) -> bool {
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(request_id));
        match sender {
            Some(sender) => sender.send(outcome).is_ok(),
            None => false,
        }
    }

    pub fn pending_count(&self) -> usize {
        self.pending.lock().map(|pending| pending.len()).unwrap_or(0)
    }

    /// Define la carpeta permitida para `project_open` y `asset_import` desde la
    /// UI. `None` la limpia. La ruta debe existir y ser una carpeta. Si la
    /// sesión arrancó con `--mcp-workspace`, el root queda fijado y este setter
    /// se rechaza para que un proyecto restaurado no lo reemplace.
    pub fn set_workspace(&self, path: Option<String>) -> Result<(), String> {
        if self.workspace_locked.load(Ordering::SeqCst) {
            return Err("el workspace fue fijado por --mcp-workspace".to_owned());
        }
        self.assign_workspace(path)
    }

    /// Fija el workspace de la línea de comandos y lo bloquea para la sesión.
    pub fn set_workspace_from_cli(&self, path: String) -> Result<(), String> {
        self.assign_workspace(Some(path))?;
        self.workspace_locked.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn assign_workspace(&self, path: Option<String>) -> Result<(), String> {
        let next = match path {
            Some(raw) if !raw.trim().is_empty() => {
                let canonical = std::fs::canonicalize(Path::new(raw.trim()))
                    .map_err(|_| "la carpeta de trabajo no existe".to_owned())?;
                if !canonical.is_dir() {
                    return Err("la ruta de trabajo debe ser una carpeta".to_owned());
                }
                Some(canonical)
            }
            _ => None,
        };
        let mut guard = self
            .workspace
            .lock()
            .map_err(|_| "el workspace no está disponible".to_owned())?;
        *guard = next;
        Ok(())
    }

    pub fn workspace(&self) -> Option<PathBuf> {
        self.workspace.lock().ok().and_then(|guard| guard.clone())
    }

    fn ensure_inside_workspace(&self, raw: &str) -> Result<(), String> {
        let workspace = self
            .workspace()
            .ok_or_else(|| "el workspace todavía no está configurado".to_owned())?;
        let candidate = std::fs::canonicalize(raw)
            .map_err(|_| format!("la ruta no existe o no es accesible: {raw}"))?;
        if !candidate.starts_with(&workspace) {
            return Err("la ruta está fuera del workspace permitido".to_owned());
        }
        Ok(())
    }

    /// Restringe las herramientas que reciben rutas. Se ejecuta antes de emitir
    /// el pedido para que un cliente MCP no pueda importar/abrir fuera del
    /// workspace aunque la UI estuviera distraída.
    fn validate_tool_paths(&self, tool: &str, args: &Value) -> Result<(), String> {
        match tool {
            "project_open" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "project_open necesita path".to_owned())?;
                self.ensure_inside_workspace(path)
            }
            "asset_import" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| "asset_import necesita path".to_owned())?;
                self.ensure_inside_workspace(path)
            }
            "video_concat" => {
                let paths = args
                    .get("paths")
                    .and_then(Value::as_array)
                    .filter(|paths| !paths.is_empty() && paths.len() <= 64)
                    .ok_or_else(|| "video_concat necesita 1..64 paths".to_owned())?;
                for path in paths {
                    let raw = path
                        .as_str()
                        .filter(|value| !value.trim().is_empty())
                        .ok_or_else(|| "cada segmento necesita una ruta".to_owned())?;
                    self.ensure_inside_workspace(raw)?;
                }
                Ok(())
            }
            "three_add" => {
                // Un modelo glTF/GLB opcional también debe vivir dentro del workspace.
                let Some(raw) = args.get("modelPath").and_then(Value::as_str) else {
                    return Ok(());
                };
                if raw.trim().is_empty() {
                    return Ok(());
                }
                self.ensure_inside_workspace(raw)
            }
            _ => Ok(()),
        }
    }
}

fn internal_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

#[tauri::command]
pub fn mcp_live_set_enabled(state: State<'_, AppState>, enabled: bool) -> bool {
    state.live_mcp.set_enabled(enabled);
    state.live_mcp.is_enabled()
}

#[tauri::command]
pub fn mcp_live_register_tools(
    state: State<'_, AppState>,
    tools: Value,
) -> Result<usize, ProjectError> {
    state
        .live_mcp
        .register_tools(tools)
        .map_err(|error| internal_error(&error))
}

#[tauri::command]
pub fn mcp_live_result(
    state: State<'_, AppState>,
    request_id: String,
    outcome: Value,
) -> Result<bool, ProjectError> {
    if request_id.is_empty() {
        return Err(internal_error("falta requestId"));
    }
    Ok(state.live_mcp.complete(&request_id, outcome))
}

#[tauri::command]
pub fn mcp_live_set_workspace(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<bool, ProjectError> {
    state
        .live_mcp
        .set_workspace(path)
        .map(|_| true)
        .map_err(|error| internal_error(&error))
}

#[tauri::command]
pub fn mcp_live_emit_event(state: State<'_, AppState>, event: Value) -> bool {
    if !state.live_mcp.is_enabled() {
        return false;
    }
    let Some(kind) = event.get("type").and_then(Value::as_str) else {
        return false;
    };
    if kind != "render_progress" && kind != "render_finished" {
        return false;
    }
    if event.to_string().len() > 8_192 {
        return false;
    }
    state.live_mcp.emit_event(&event);
    true
}

#[tauri::command]
pub fn mcp_live_status(state: State<'_, AppState>) -> Value {
    json!({
        "enabled": state.live_mcp.is_enabled(),
        "export": state.live_mcp.export_allowed(),
        "tools": state.live_mcp.tool_count(),
        "pending": state.live_mcp.pending_count(),
        "workspace": state.live_mcp.workspace().map(|path| path.to_string_lossy().into_owned()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel as test_channel;
    use std::thread;

    fn tool(name: &str) -> Value {
        json!({
            "name": name,
            "description": "prueba",
            "inputSchema": { "type": "object", "properties": {} }
        })
    }

    #[test]
    fn disabled_by_default_and_does_not_emit() {
        let live = LiveMcp::default();
        live.register_tools(json!([tool("project_inspect")])).unwrap();
        let emitted = std::sync::Arc::new(Mutex::new(false));
        let flag = emitted.clone();
        let outcome = live.call(
            "project_inspect",
            json!({}),
            move |_, _| {
                *flag.lock().unwrap() = true;
                Ok(())
            },
            Duration::from_millis(50),
        );
        assert_eq!(outcome["ok"], json!(false));
        assert!(!*emitted.lock().unwrap());
    }

    #[test]
    fn registers_and_rejects_invalid_schemas() {
        let live = LiveMcp::default();
        assert_eq!(
            live.register_tools(json!([tool("a"), tool("b")])).unwrap(),
            2
        );
        assert_eq!(live.tool_count(), 2);
        assert!(live.has_tool("a"));
        assert!(!live.has_tool("c"));
        assert!(live.register_tools(json!({})).is_err());
        assert!(live.register_tools(json!([{ "description": "sin nombre" }])).is_err());
        assert!(live
            .register_tools(json!([{ "name": "x", "inputSchema": "no" }]))
            .is_err());
    }

    #[test]
    fn completes_a_pending_call_from_the_ui() {
        let live = std::sync::Arc::new(LiveMcp::default());
        live.set_enabled(true);
        live.register_tools(json!([tool("project_inspect")])).unwrap();
        let (payload_tx, payload_rx) = test_channel();
        let server = live.clone();
        let handle = thread::spawn(move || {
            server.call(
                "project_inspect",
                json!({ "detail": "full" }),
                move |id, payload| {
                    payload_tx.send((id, payload)).map_err(|error| error.to_string())
                },
                Duration::from_secs(2),
            )
        });
        let (request_id, payload) = payload_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(payload["tool"], json!("project_inspect"));
        assert_eq!(payload["arguments"]["detail"], json!("full"));
        assert_eq!(live.pending_count(), 1);
        assert!(live.complete(&request_id, json!({ "ok": true, "summary": "listo" })));
        let outcome = handle.join().unwrap();
        assert_eq!(outcome["summary"], json!("listo"));
        assert_eq!(live.pending_count(), 0);
        assert!(!live.complete(&request_id, json!({ "ok": true })));
    }

    #[test]
    fn times_out_and_unknown_tools_never_emit() {
        let live = LiveMcp::default();
        live.set_enabled(true);
        live.register_tools(json!([tool("project_inspect")])).unwrap();
        let unknown = live.call(
            "hack",
            json!({}),
            |_, _| panic!("no debe emitir"),
            Duration::from_millis(30),
        );
        assert_eq!(unknown["ok"], json!(false));
        assert!(unknown["summary"].as_str().unwrap().contains("desconocida"));
        let timeout = live.call(
            "project_inspect",
            json!({}),
            |_, _| Ok(()),
            Duration::from_millis(30),
        );
        assert!(timeout["summary"].as_str().unwrap().contains("no respondió"));
        assert_eq!(live.pending_count(), 0);
    }

    #[test]
    fn workspace_limits_project_open_and_asset_import() {
        let live = LiveMcp::default();
        let root = std::env::temp_dir().join(format!("editoria-live-ws-{}", Uuid::new_v4()));
        let outside = std::env::temp_dir().join(format!("editoria-live-out-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let inside_file = root.join("demo.editoria.json");
        let outside_file = outside.join("fuera.editoria.json");
        std::fs::write(&inside_file, b"{}").unwrap();
        std::fs::write(&outside_file, b"{}").unwrap();

        assert!(live
            .validate_tool_paths("project_open", &json!({ "path": inside_file }))
            .is_err());
        live.set_workspace(Some(root.to_string_lossy().into_owned()))
            .unwrap();
        assert!(live
            .validate_tool_paths("project_open", &json!({ "path": inside_file }))
            .is_ok());
        assert!(live
            .validate_tool_paths("project_open", &json!({ "path": outside_file }))
            .is_err());
        assert!(live
            .validate_tool_paths("asset_import", &json!({ "path": inside_file }))
            .is_ok());
        assert!(live
            .validate_tool_paths("asset_import", &json!({ "path": outside_file }))
            .is_err());
        assert!(live
            .validate_tool_paths("project_inspect", &json!({}))
            .is_ok());
        assert!(live
            .validate_tool_paths("three_add", &json!({ "modelPath": inside_file }))
            .is_ok());
        assert!(live
            .validate_tool_paths("three_add", &json!({ "modelPath": outside_file }))
            .is_err());
        assert!(live
            .validate_tool_paths("three_add", &json!({ "preset": "orbit-cube" }))
            .is_ok());
        assert!(live.set_workspace(Some(outside_file.to_string_lossy().into_owned())).is_err());
        live.set_workspace(None).unwrap();
        assert!(live.workspace().is_none());
        assert!(live
            .validate_tool_paths("project_open", &json!({ "path": inside_file }))
            .is_err());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn idempotency_cache_returns_the_same_outcome_and_skips_errors() {
        let live = LiveMcp::default();
        let outcome = json!({ "ok": true, "summary": "clip agregado", "data": { "clipId": "c1" } });
        assert!(live.cached_outcome("key-1").is_none());
        live.remember_outcome("key-1", &outcome);
        assert_eq!(live.cached_outcome("key-1"), Some(outcome.clone()));
        live.remember_outcome("key-2", &json!({ "ok": false, "summary": "la app no respondió a tiempo (30 s)" }));
        assert!(live.cached_outcome("key-2").is_none());
        assert!(!outcome_is_cacheable(&json!({ "summary": "sin ok" })));
        assert!(outcome_is_cacheable(&json!({ "ok": false, "summary": "argumentos inválidos" })));
    }

    #[test]
    fn sse_subscribers_receive_events_and_drop_disconnected() {
        let live = LiveMcp::default();
        let first = live.subscribe_events();
        let second = live.subscribe_events();
        assert_eq!(live.subscriber_count(), 2);
        let first_id = live.emit_event(&json!({ "type": "tool_finished", "tool": "project_inspect", "ok": true }));
        assert_eq!(first_id, 1);
        assert!(first.recv_timeout(Duration::from_millis(50)).unwrap().contains("project_inspect"));
        assert!(second.recv_timeout(Duration::from_millis(50)).unwrap().contains("project_inspect"));
        drop(first);
        drop(second);
        live.emit_event(&json!({ "type": "ping" }));
        assert_eq!(live.subscriber_count(), 0);
        assert_eq!(live.events_since(1).len(), 1);
        assert_eq!(live.events_since(2).len(), 0);
    }

    #[test]
    fn export_flag_defaults_off_and_can_be_enabled() {
        let live = LiveMcp::default();
        assert!(!live.export_allowed());
        live.set_export_allowed(true);
        assert!(live.export_allowed());
        live.set_export_allowed(false);
        assert!(!live.export_allowed());
    }

    #[test]
    fn cli_workspace_cannot_be_overridden_by_the_ui() {
        let live = LiveMcp::default();
        let root = std::env::temp_dir().join(format!("editoria-live-cli-{}", Uuid::new_v4()));
        let other = std::env::temp_dir().join(format!("editoria-live-other-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let inside = root.join("proyecto.editoria.json");
        let outside = other.join("proyecto.editoria.json");
        std::fs::write(&inside, b"{}").unwrap();
        std::fs::write(&outside, b"{}").unwrap();

        live.set_workspace_from_cli(root.to_string_lossy().into_owned())
            .unwrap();
        assert!(live
            .validate_tool_paths("project_open", &json!({ "path": inside }))
            .is_ok());
        assert!(live
            .validate_tool_paths("project_open", &json!({ "path": outside }))
            .is_err());
        assert!(live
            .set_workspace(Some(other.to_string_lossy().into_owned()))
            .is_err());
        assert!(live.set_workspace(None).is_err());
        assert_eq!(
            live.workspace().as_deref(),
            Some(std::fs::canonicalize(&root).unwrap().as_path())
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&other);
    }

    #[test]
    fn disabling_releases_pending_calls() {
        let live = std::sync::Arc::new(LiveMcp::default());
        live.set_enabled(true);
        live.register_tools(json!([tool("project_inspect")])).unwrap();
        let (payload_tx, payload_rx) = test_channel();
        let server = live.clone();
        let handle = thread::spawn(move || {
            server.call(
                "project_inspect",
                json!({}),
                move |id, payload| payload_tx.send((id, payload)).map_err(|error| error.to_string()),
                Duration::from_secs(5),
            )
        });
        let _ = payload_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        live.set_enabled(false);
        let outcome = handle.join().unwrap();
        assert_eq!(outcome["ok"], json!(false));
        assert!(outcome["summary"].as_str().unwrap().contains("desactivó"));
        assert!(!live.is_enabled());
    }
}
