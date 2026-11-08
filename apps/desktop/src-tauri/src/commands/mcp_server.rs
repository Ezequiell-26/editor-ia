//! Servidor MCP local.
//!
//! La app ya era **cliente** de servidores MCP; esto es lo contrario: expone un
//! endpoint HTTP en 127.0.0.1 para que una IA externa (Claude Desktop, Cursor,
//! un agente propio) pueda leer el estado y ejecutar comandos.
//!
//! El transporte es HTTP con JSON-RPC 2.0 en `POST /mcp`. El token se conserva
//! entre reinicios en el Administrador de credenciales de Windows: sin `Authorization: Bearer <token>` no se atiende nada, así
//! que otro proceso de la máquina no puede manejar el editor por accidente.
//!
//! Las acciones viven en el frontend (picos, planes, render). Por eso
//! `run_command` emite un evento a la ventana y espera la respuesta: el mismo
//! camino que usa el asistente, con la misma semántica.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use keyring::Entry;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Semaphore};
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MCP_PORT: u16 = 31417;
const MCP_KEYRING_SERVICE: &str = "editor-ia.mcp";
const MCP_KEYRING_USER: &str = "olyvia-server-token";
const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(900);
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
const BODY_READ_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CONNECTIONS: usize = 32;

struct McpReply {
    ok: bool,
    text: String,
}

static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<McpReply>>>> = OnceLock::new();
static INFO: OnceLock<Mutex<Option<McpServerInfo>>> = OnceLock::new();
static START_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static READ_ONLY_TOOLS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<McpReply>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registra una respuesta pendiente dentro de un ámbito síncrono para no
/// conservar un MutexGuard en el futuro async que atiende la conexión.
fn register_pending(id: &str, sender: oneshot::Sender<McpReply>) -> Result<(), ()> {
    let mut entries = pending().lock().map_err(|_| ())?;
    entries.insert(id.to_owned(), sender);
    Ok(())
}

fn info_slot() -> &'static Mutex<Option<McpServerInfo>> {
    INFO.get_or_init(|| Mutex::new(None))
}

fn start_lock() -> &'static tokio::sync::Mutex<()> {
    START_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn collect_read_only_tools(items: &[Value]) -> HashSet<String> {
    items
        .iter()
        .filter(|item| item["annotations"]["readOnlyHint"].as_bool() == Some(true))
        .filter_map(|item| item["name"].as_str().map(str::to_owned))
        .collect()
}

fn valid_rpc_id(value: &Value) -> bool {
    value.is_null() || value.is_string() || value.is_number()
}

fn read_only_tools() -> &'static Mutex<HashSet<String>> {
    READ_ONLY_TOOLS.get_or_init(|| {
        let fallback = tools();
        let names = fallback
            .as_array()
            .map(|items| collect_read_only_tools(items))
            .unwrap_or_default();
        Mutex::new(names)
    })
}

fn cache_read_only_tools(items: &[Value]) {
    if let Ok(mut cached) = read_only_tools().lock() {
        *cached = collect_read_only_tools(items);
    }
}

/// Token estable del servidor MCP, protegido por el Administrador de credenciales de Windows.
fn persistent_server_token() -> Result<String, ProjectError> {
    let entry = Entry::new(MCP_KEYRING_SERVICE, MCP_KEYRING_USER).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el Administrador de credenciales de Windows no esta disponible",
        )
    })?;
    if let Ok(existing) = entry.get_password() {
        let existing = existing.trim();
        if existing.len() >= 32 {
            return Ok(existing.to_owned());
        }
    }
    let token = Uuid::new_v4().to_string();
    entry.set_password(&token).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "no se pudo guardar el token MCP en el Administrador de credenciales",
        )
    })?;
    Ok(token)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub url: String,
    pub token: String,
}

fn normalize_json_schema(schema: &mut Value) {
    if schema["type"].as_str() == Some("object") && schema.get("additionalProperties").is_none() {
        schema["additionalProperties"] = Value::Bool(false);
    }
    if let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) {
        for child in properties.values_mut() {
            normalize_json_schema(child);
        }
    }
    if let Some(items) = schema.get_mut("items") {
        normalize_json_schema(items);
    }
}

fn tools() -> Value {
    let mut catalog = json!([
        {
            "name": "diagnostics",
            "description": "Diagnóstico básico de Olyvia sin credenciales.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "app_status",
            "description": "Estado del editor: si hay proyecto abierto y cuál.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "project_summary",
            "description": "Resumen del proyecto abierto: formato, fps, duración, pistas, clips, subtítulos y assets.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "project_snapshot",
            "description": "Fotografía consolidada del proyecto: resumen, pistas, clips, subtítulos, medios, marcadores y perfiles.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include": { "type": "array", "minItems": 1, "maxItems": 6, "uniqueItems": true, "items": { "type": "string", "enum": ["tracks", "clips", "captions", "assets", "markers", "profiles"] } },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500, "description": "Máximo de elementos por sección (1–500; por defecto 200)." }
                }
            }
        },
        {
            "name": "timeline_clips",
            "description": "Lista los clips de la timeline con id, pista, tipo, inicio, duración, motion y ganancia.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "captions_list",
            "description": "Lista los subtítulos con id, tiempos, texto y hablante.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "assets_list",
            "description": "Lista los medios del proyecto con id, tipo, ruta y metadatos.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tracks_list",
            "description": "Lista las pistas con id, tipo, nombre, bloqueo, silencio y cantidad de clips.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "export_profiles",
            "description": "Lista los perfiles de exportación con formato, resolución y bitrate.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "clip_update",
            "description": "Cambia etiqueta, habilitado, ganancia o movimiento de un clip.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "clipId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "label": { "type": "string", "maxLength": 200 },
                    "enabled": { "type": "boolean" },
                    "gainDb": { "type": "number", "minimum": -60, "maximum": 24 },
                    "motion": { "type": ["string", "null"], "enum": ["zoom-in", "zoom-out", "pan-left", "pan-right", null] },
                    "motionIntensity": { "type": "number", "minimum": 0, "maximum": 1 }
                },
                "required": ["clipId"],
                "minProperties": 2
            }
        },
        {
            "name": "clip_move",
            "description": "Mueve un clip a un frame de inicio y, opcionalmente, a otra pista.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "clipId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "startFrame": { "type": "integer", "minimum": 0, "maximum": 10000000 },
                    "trackId": { "type": "string", "minLength": 1, "maxLength": 256 }
                },
                "required": ["clipId", "startFrame"]
            }
        },
        {
            "name": "clip_delete",
            "description": "Elimina un clip de la timeline.",
            "inputSchema": {
                "type": "object",
                "properties": { "clipId": { "type": "string", "minLength": 1, "maxLength": 256 } },
                "required": ["clipId"]
            }
        },
        {
            "name": "clip_split",
            "description": "Divide un clip en un frame.",
            "inputSchema": {
                "type": "object",
                "properties": { "clipId": { "type": "string", "minLength": 1, "maxLength": 256 }, "atFrame": { "type": "integer", "minimum": 1, "maximum": 10000000 } },
                "required": ["clipId", "atFrame"]
            }
        },
        {
            "name": "caption_add",
            "description": "Agrega un subtítulo en un frame con una duración.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "minLength": 1, "maxLength": 2000 },
                    "startFrame": { "type": "integer", "minimum": 0, "maximum": 10000000 },
                    "durationFrames": { "type": "integer", "minimum": 1, "maximum": 10000000 }
                },
                "required": ["text", "startFrame", "durationFrames"]
            }
        },
        {
            "name": "caption_update",
            "description": "Cambia texto o tiempos de un subtítulo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "cueId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "text": { "type": "string", "minLength": 1, "maxLength": 2000 },
                    "startFrame": { "type": "integer", "minimum": 0, "maximum": 10000000 },
                    "endFrame": { "type": "integer", "minimum": 1, "maximum": 10000000 }
                },
                "required": ["cueId"],
                "minProperties": 2
            }
        },
        {
            "name": "caption_delete",
            "description": "Elimina un subtítulo.",
            "inputSchema": {
                "type": "object",
                "properties": { "cueId": { "type": "string", "minLength": 1, "maxLength": 256 } },
                "required": ["cueId"]
            }
        },
        {
            "name": "track_update",
            "description": "Cambia nombre, bloqueo, silencio u ocultamiento de una pista.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "trackId": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "label": { "type": "string", "maxLength": 120 },
                    "locked": { "type": "boolean" },
                    "muted": { "type": "boolean" },
                    "hidden": { "type": "boolean" }
                },
                "required": ["trackId"],
                "minProperties": 2
            }
        },
        {
            "name": "run_automation",
            "description": "Ejecuta automatizaciones: cut_silences, cut_pauses, auto_cleanup, auto_pilot o export.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["cut_silences", "cut_pauses", "auto_cleanup", "auto_pilot", "export"] },
                    "outputDir": { "type": "string", "maxLength": 32768 },
                    "profileId": { "type": "string", "maxLength": 256 }
                },
                "required": ["kind"]
            }
        },
        {
            "name": "export_render",
            "description": "Renderiza y verifica la entrega (MP4) en una carpeta.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "outputDir": { "type": "string", "maxLength": 32768 },
                    "profileId": { "type": "string", "maxLength": 256 },
                    "qualityCheck": { "type": "boolean" }
                }
            }
        },
        {
            "name": "navigate",
            "description": "Abre una vista de la app (editor, inicio, fabrica, produccion, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": { "view": { "type": "string", "minLength": 1, "maxLength": 80 } },
                "required": ["view"]
            }
        },
        {
            "name": "run_command",
            "description": "Ejecuta un comando del editor en lenguaje natural (cortar silencios, limpiar, pilotar).",
            "inputSchema": {
                "type": "object",
                "properties": { "command": { "type": "string", "minLength": 1, "maxLength": 2000 } },
                "required": ["command"]
            }
        },
        {
            "name": "factory_run",
            "description": "Encola la creación completa de un video y devuelve un jobId.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "brief": { "type": "string", "minLength": 10, "maxLength": 4000 },
                    "outputDir": { "type": "string", "maxLength": 32768 },
                    "scenes": { "type": "integer", "minimum": 1, "maximum": 12 },
                    "width": { "type": "integer", "minimum": 2, "maximum": 7680 },
                    "height": { "type": "integer", "minimum": 2, "maximum": 4320 },
                    "language": { "type": "string", "minLength": 2, "maxLength": 12 },
                    "render": { "type": "boolean" }
                },
                "required": ["brief"]
            }
        },
        {
            "name": "factory_job_status",
            "description": "Consulta el estado y progreso de un trabajo de fábrica.",
            "inputSchema": {
                "type": "object",
                "properties": { "jobId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["jobId"]
            }
        },
        {
            "name": "factory_job_list",
            "description": "Lista trabajos de fábrica recientes.",
            "inputSchema": {
                "type": "object",
                "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 50 } }
            }
        },
        {
            "name": "factory_job_cancel",
            "description": "Solicita cancelación cooperativa de un trabajo de fábrica.",
            "inputSchema": {
                "type": "object",
                "properties": { "jobId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["jobId"]
            }
        }
    ]);

    if let Some(items) = catalog.as_array_mut() {
        for item in items {
            let Some(name) = item["name"].as_str().map(str::to_owned) else {
                continue;
            };
            if let Some(schema) = item.get_mut("inputSchema") {
                normalize_json_schema(schema);
            }
            let read_only = matches!(
                name.as_str(),
                "diagnostics"
                    | "app_status"
                    | "project_summary"
                    | "project_snapshot"
                    | "timeline_clips"
                    | "captions_list"
                    | "assets_list"
                    | "tracks_list"
                    | "export_profiles"
                    | "critic_run"
                    | "settings_get"
                    | "review_build"
                    | "factory_job_status"
                    | "factory_job_list"
            );
            let additive = matches!(
                name.as_str(),
                "track_add"
                    | "clip_add"
                    | "caption_add"
                    | "asset_import"
                    | "marker_add"
                    | "multicam_build"
                    | "navigate"
                    | "playhead"
            );
            let idempotent = matches!(name.as_str(), "project_save" | "navigate" | "playhead");
            let open_world = matches!(
                name.as_str(),
                "project_open"
                    | "project_save"
                    | "project_save_as"
                    | "diarize"
                    | "export_render"
                    | "export_interchange"
                    | "factory_run"
                    | "extract_audio"
                    | "write_chapters"
                    | "remux"
                    | "export_lossless"
                    | "asset_import"
                    | "package_project"
                    | "run_command"
            );
            item["annotations"] = json!({
                "title": name.replace('_', " "),
                "readOnlyHint": read_only,
                "destructiveHint": !read_only && !additive,
                "idempotentHint": !read_only && idempotent,
                "openWorldHint": open_world
            });
        }
    }

    catalog
}

fn tool_result(text: &str, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    })
}

async fn run_tool_with_timeout(app: &AppHandle, tool: &str, args: &Value, wait: Duration) -> Value {
    let id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    if register_pending(&id, sender).is_err() {
        return tool_result("el registro de solicitudes MCP está bloqueado", true);
    }

    let emitted = app.emit("mcp-call", json!({ "id": id, "tool": tool, "args": args }));
    if emitted.is_err() {
        if let Ok(mut entries) = pending().lock() {
            entries.remove(&id);
        }
        return tool_result("la ventana del editor no está disponible", true);
    }

    match tokio::time::timeout(wait, receiver).await {
        Ok(Ok(reply)) => tool_result(&reply.text, !reply.ok),
        Ok(Err(_)) => tool_result("la ventana cerró antes de responder", true),
        Err(_) => {
            if let Ok(mut entries) = pending().lock() {
                entries.remove(&id);
            }
            tool_result(
                &format!("la herramienta no respondió en {} segundos", wait.as_secs()),
                true,
            )
        }
    }
}

async fn run_tool(app: &AppHandle, tool: &str, args: &Value) -> Value {
    run_tool_with_timeout(app, tool, args, BRIDGE_TIMEOUT).await
}

async fn handle_rpc(app: &AppHandle, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    if !message.is_object() || message.get("jsonrpc") != Some(&json!("2.0")) {
        return Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32600, "message": "solicitud JSON-RPC inválida" }
        }));
    }
    if message.get("id").is_some_and(|value| !valid_rpc_id(value)) {
        return Some(json!({
            "jsonrpc": "2.0",
            "id": Value::Null,
            "error": { "code": -32600, "message": "el id JSON-RPC debe ser texto, número o null" }
        }));
    }
    if message
        .get("params")
        .is_some_and(|params| !params.is_object())
    {
        return Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32602, "message": "params debe ser un objeto JSON" }
        }));
    }
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32600, "message": "falta el método JSON-RPC" }
        }));
    };
    if id.is_null() && method.starts_with("notifications/") {
        return None;
    }
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2025-06-18",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "olyvia", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => {
            // El catálogo real vive en el frontend (`mcp-catalog.ts`): así una
            // herramienta nueva no se declara dos veces. Si la ventana no
            // responde, queda el catálogo mínimo de respaldo.
            let reply =
                run_tool_with_timeout(app, "__catalog", &json!({}), Duration::from_secs(5)).await;
            let parsed = reply["content"][0]["text"]
                .as_str()
                .and_then(|text| serde_json::from_str::<Value>(text).ok());
            let listed = match parsed {
                Some(Value::Array(items)) if !items.is_empty() => items,
                _ => tools().as_array().cloned().unwrap_or_default(),
            };
            // La lista publicada decide qué llamadas se pueden adelantar en
            // lotes; el fallback sólo se usa cuando la UI no está disponible.
            cache_read_only_tools(&listed);
            Ok(json!({ "tools": listed }))
        }
        "tools/call" => {
            let name = message["params"]["name"].as_str().unwrap_or("");
            let args = message["params"]["arguments"].clone();
            if name.is_empty() {
                Err((-32602, "falta el nombre de la herramienta".to_owned()))
            } else {
                Ok(run_tool(app, name, &args).await)
            }
        }
        _ => Err((-32601, format!("método desconocido: {method}"))),
    };
    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, text)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": text }
        }),
    })
}

const MAX_PARALLEL_BATCH_READS: usize = 8;

/// Sólo estas operaciones pueden adelantarse dentro de un lote JSON-RPC.
/// Cualquier escritura o herramienta desconocida conserva el orden secuencial.
fn is_parallel_read_request(message: &Value) -> bool {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    match method {
        "initialize" | "ping" | "tools/list" => true,
        "tools/call" => {
            let Some(name) = message["params"]["name"].as_str() else {
                return false;
            };
            if name == "__catalog" {
                return true;
            }
            read_only_tools()
                .lock()
                .map(|names| names.contains(name))
                .unwrap_or(false)
        }
        notification if notification.starts_with("notifications/") => {
            message.get("id").map(Value::is_null).unwrap_or(true)
        }
        _ => false,
    }
}

/// Ejecuta en paralelo sólo lotes compuestos íntegramente por lecturas.
/// La concurrencia queda limitada y las respuestas se reordenan como la petición.
async fn handle_batch_rpc(app: &AppHandle, items: &[Value]) -> Value {
    if items.is_empty() {
        return json!({
            "jsonrpc": "2.0",
            "id": Value::Null,
            "error": { "code": -32600, "message": "el lote JSON-RPC no puede estar vacío" }
        });
    }
    let mut answers = vec![None; items.len()];

    if items.iter().all(is_parallel_read_request) {
        for (chunk_index, chunk) in items.chunks(MAX_PARALLEL_BATCH_READS).enumerate() {
            let base_index = chunk_index * MAX_PARALLEL_BATCH_READS;
            let handles: Vec<_> = chunk
                .iter()
                .cloned()
                .map(|message| {
                    let app = app.clone();
                    tokio::spawn(async move { handle_rpc(&app, &message).await })
                })
                .collect();

            for (offset, (message, handle)) in chunk.iter().zip(handles).enumerate() {
                answers[base_index + offset] = match handle.await {
                    Ok(answer) => answer,
                    Err(_) if !message["id"].is_null() => Some(json!({
                        "jsonrpc": "2.0",
                        "id": message["id"],
                        "error": {
                            "code": -32603,
                            "message": "falló una tarea del lote MCP"
                        }
                    })),
                    Err(_) => None,
                };
            }
        }
    } else {
        // Los lotes mixtos pueden depender del orden (por ejemplo, editar y luego leer).
        for (index, message) in items.iter().enumerate() {
            answers[index] = handle_rpc(app, message).await;
        }
    }

    Value::Array(answers.into_iter().flatten().collect())
}

async fn write_response(stream: &mut tokio::net::TcpStream, status: u16, body: &str) {
    let response = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        if status == 200 { "OK" } else { "Error" },
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

fn header_value(headers: &str, name: &str) -> Option<String> {
    for line in headers.lines().skip(1) {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case(name) {
            return Some(value.trim().to_owned());
        }
    }
    None
}

fn is_json_content_type(headers: &str) -> bool {
    header_value(headers, "content-type")
        .and_then(|value| value.split(';').next().map(str::trim).map(str::to_owned))
        .map(|value| value.eq_ignore_ascii_case("application/json"))
        .unwrap_or(false)
}

fn request_content_length(headers: &str) -> Result<usize, &'static str> {
    let mut content_length = None;
    for line in headers.lines().skip(1) {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.eq_ignore_ascii_case("transfer-encoding") && !value.eq_ignore_ascii_case("identity")
        {
            return Err("transfer-encoding no compatible");
        }
        if key.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err("content-length duplicado");
            }
            if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err("content-length inválido");
            }
            content_length = value.parse::<usize>().ok();
            if content_length.is_none() {
                return Err("content-length inválido");
            }
        }
    }
    content_length.ok_or("falta content-length")
}

async fn serve(mut stream: tokio::net::TcpStream, app: AppHandle, token: String) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end;
    let header_deadline = tokio::time::Instant::now() + HEADER_READ_TIMEOUT;
    loop {
        match tokio::time::timeout_at(header_deadline, stream.read(&mut chunk)).await {
            Ok(Ok(0)) => return,
            Ok(Ok(read)) => {
                buffer.extend_from_slice(&chunk[..read]);
                if let Some(position) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                    header_end = position + 4;
                    break;
                }
                if buffer.len() > MAX_HEADER_BYTES {
                    write_response(
                        &mut stream,
                        431,
                        "{\"error\":\"headers demasiado grandes\"}",
                    )
                    .await;
                    return;
                }
            }
            Ok(Err(_)) => return,
            Err(_) => {
                write_response(&mut stream, 408, "{\"error\":\"timeout leyendo headers\"}").await;
                return;
            }
        }
    }
    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    if method != "POST" || path != "/mcp" {
        write_response(&mut stream, 404, "{\"error\":\"usá POST /mcp\"}").await;
        return;
    }
    let expected = format!("Bearer {token}");
    if header_value(&head, "authorization").as_deref() != Some(expected.as_str()) {
        write_response(&mut stream, 401, "{\"error\":\"token inválido\"}").await;
        return;
    }
    if !is_json_content_type(&head) {
        write_response(
            &mut stream,
            415,
            "{\"error\":\"content-type debe ser application/json\"}",
        )
        .await;
        return;
    }
    let length = match request_content_length(&head) {
        Ok(length) => length,
        Err(message) => {
            write_response(&mut stream, 400, &format!("{{\"error\":\"{message}\"}}")).await;
            return;
        }
    };
    if length > MAX_BODY_BYTES {
        write_response(&mut stream, 413, "{\"error\":\"cuerpo demasiado grande\"}").await;
        return;
    }
    let mut body = buffer[header_end..].to_vec();
    if body.len() > length {
        write_response(
            &mut stream,
            400,
            "{\"error\":\"bytes adicionales después del cuerpo\"}",
        )
        .await;
        return;
    }
    let body_deadline = tokio::time::Instant::now() + BODY_READ_TIMEOUT;
    while body.len() < length {
        match tokio::time::timeout_at(body_deadline, stream.read(&mut chunk)).await {
            Ok(Ok(0)) => {
                write_response(&mut stream, 400, "{\"error\":\"cuerpo HTTP incompleto\"}").await;
                return;
            }
            Ok(Ok(read)) => {
                body.extend_from_slice(&chunk[..read]);
                if body.len() > length {
                    write_response(
                        &mut stream,
                        400,
                        "{\"error\":\"cuerpo HTTP excede content-length\"}",
                    )
                    .await;
                    return;
                }
            }
            Ok(Err(_)) => {
                write_response(
                    &mut stream,
                    400,
                    "{\"error\":\"no se pudo leer el cuerpo HTTP\"}",
                )
                .await;
                return;
            }
            Err(_) => {
                write_response(
                    &mut stream,
                    408,
                    "{\"error\":\"timeout leyendo el cuerpo HTTP\"}",
                )
                .await;
                return;
            }
        }
    }
    let value: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            write_response(&mut stream, 400, "{\"error\":\"JSON inválido\"}").await;
            return;
        }
    };
    let response = if let Some(items) = value.as_array() {
        handle_batch_rpc(&app, items).await
    } else {
        match handle_rpc(&app, &value).await {
            Some(answer) => answer,
            None => {
                write_response(&mut stream, 202, "{}").await;
                return;
            }
        }
    };
    write_response(&mut stream, 200, &response.to_string()).await;
}

#[tauri::command]
pub async fn start_mcp_server(app: AppHandle) -> Result<McpServerInfo, ProjectError> {
    let _start_guard = start_lock().lock().await;
    if let Ok(guard) = info_slot().lock() {
        if let Some(existing) = guard.clone() {
            return Ok(existing);
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", MCP_PORT))
        .await
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "el puerto MCP 31417 esta ocupado; cerra la otra instancia o libera ese puerto",
            )
        })?;
    let token = persistent_server_token()?;
    let info = McpServerInfo {
        url: format!("http://127.0.0.1:{MCP_PORT}/mcp"),
        token: token.clone(),
    };
    if let Ok(mut guard) = info_slot().lock() {
        *guard = Some(info.clone());
    }
    let loop_token = token;
    let connection_slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let permit = match connection_slots.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => {
                    tauri::async_runtime::spawn(async move {
                        write_response(
                            &mut stream,
                            503,
                            "{\"error\":\"servidor MCP ocupado; reintentá más tarde\"}",
                        )
                        .await;
                    });
                    continue;
                }
            };
            let app = app.clone();
            let token = loop_token.clone();
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                serve(stream, app, token).await;
            });
        }
    });
    Ok(info)
}

#[tauri::command]
pub fn mcp_server_status() -> Option<McpServerInfo> {
    info_slot().lock().ok().and_then(|guard| guard.clone())
}

/// Cliente de IA externo (Claude Desktop, Antigravity…) que Olyvia sabe
/// conectar con un botón, y si lo encontró instalado en este equipo.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedClient {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoconnectResult {
    pub client: String,
    pub config_path: String,
    pub message: String,
}

fn claude_desktop_config_path() -> Option<std::path::PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(
        std::path::PathBuf::from(appdata)
            .join("Claude")
            .join("claude_desktop_config.json"),
    )
}

/// Heurística de instalación: Claude Desktop crea una de estas carpetas al
/// instalarse, sin depender de que ya se haya abierto una vez.
fn claude_desktop_installed() -> bool {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    let local = std::path::PathBuf::from(local);
    local.join("AnthropicClaude").exists() || local.join("Programs").join("Claude").exists()
}

/// Config compartida de Antigravity 2.0 / IDE / CLI (todas leen el mismo
/// archivo). Ver docs de Google Antigravity: `~/.gemini/config/mcp_config.json`.
fn antigravity_config_path() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("USERPROFILE")?;
    Some(
        std::path::PathBuf::from(home)
            .join(".gemini")
            .join("config")
            .join("mcp_config.json"),
    )
}

fn antigravity_installed() -> bool {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return false;
    };
    std::path::PathBuf::from(local)
        .join("Programs")
        .join("Antigravity IDE")
        .exists()
}

/// Clientes que Olyvia sabe conectar con un clic, con si los encontró
/// instalados en este equipo. La vista usa esto para mostrar un botón
/// activo o un enlace de descarga, sin que la persona tenga que saber nada
/// de JSON ni de rutas de archivo.
#[tauri::command]
pub fn mcp_detect_clients() -> Vec<DetectedClient> {
    vec![
        DetectedClient {
            id: "claude-desktop".into(),
            label: "Claude Desktop".into(),
            installed: claude_desktop_installed(),
            download_url: "https://claude.ai/download".into(),
        },
        DetectedClient {
            id: "antigravity".into(),
            label: "Antigravity".into(),
            installed: antigravity_installed(),
            download_url: "https://antigravity.google/".into(),
        },
    ]
}

/// Conecta Olyvia a un cliente de IA externo con un solo clic: arranca el
/// servidor MCP propio si hace falta y mezcla la entrada "olyvia" en el
/// archivo de configuración de ese cliente, preservando cualquier otro
/// servidor que ya tenga configurado.
#[tauri::command]
pub async fn mcp_server_autoconnect(
    app: AppHandle,
    client: String,
) -> Result<AutoconnectResult, ProjectError> {
    type EntryBuilder = fn(&McpServerInfo) -> Value;
    let (path, installed, download_url, build_entry): (
        std::path::PathBuf,
        bool,
        &str,
        EntryBuilder,
    ) = match client.as_str() {
        "claude-desktop" => (
            claude_desktop_config_path().ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se encontró %APPDATA% en este equipo",
                )
            })?,
            claude_desktop_installed(),
            "https://claude.ai/download",
            |info| {
                json!({
                    "type": "http",
                    "url": info.url,
                    "headers": { "Authorization": format!("Bearer {}", info.token) }
                })
            },
        ),
        "antigravity" => (
            antigravity_config_path().ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se encontró %USERPROFILE% en este equipo",
                )
            })?,
            antigravity_installed(),
            "https://antigravity.google/",
            |info| {
                json!({
                    "serverUrl": info.url,
                    "headers": { "Authorization": format!("Bearer {}", info.token) }
                })
            },
        ),
        other => {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("cliente MCP desconocido: {other}"),
            ));
        }
    };

    if !installed {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            &format!(
                "no encontramos esa app instalada en este equipo; descargala de {download_url} y volvé a tocar el botón"
            ),
        ));
    }

    let info = start_mcp_server(app).await?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo crear la carpeta de configuración de ese cliente",
            )
        })?;
    }

    // Mezcla no destructiva: se preserva cualquier otro contenido del
    // archivo (otros servidores MCP, ajustes propios del cliente) y sólo se
    // agrega o reemplaza la entrada "olyvia".
    let mut root: Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| json!({}));
    merge_olyvia_entry(&mut root, build_entry(&info));

    let pretty = serde_json::to_string_pretty(&root).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo generar la configuración")
    })?;
    std::fs::write(&path, pretty).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo escribir el archivo de configuración de ese cliente",
        )
    })?;

    Ok(AutoconnectResult {
        client,
        config_path: path.to_string_lossy().into_owned(),
        message: "listo".into(),
    })
}

/// Inserta o reemplaza la entrada `mcpServers.olyvia` en la raíz de la
/// configuración del cliente sin tocar nada más: otros servidores MCP,
/// ajustes del cliente y campos extra se conservan. Si el archivo no era
/// un objeto JSON válido, se reinicia como `{}`.
fn merge_olyvia_entry(root: &mut Value, entry: Value) {
    if !root.is_object() {
        *root = json!({});
    }
    let servers = root
        .as_object_mut()
        .expect("root es un objeto JSON")
        .entry("mcpServers")
        .or_insert_with(|| json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    servers
        .as_object_mut()
        .expect("mcpServers es un objeto JSON")
        .insert("olyvia".to_owned(), entry);
}

/// Respuesta del frontend a un `run_command` pendiente.
#[tauri::command]
pub fn mcp_respond(state: State<'_, AppState>, id: String, ok: bool, text: String) -> bool {
    let _ = state;
    let sender = pending().lock().ok().and_then(|mut map| map.remove(&id));
    match sender {
        Some(sender) => sender.send(McpReply { ok, text }).is_ok(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_olyvia_entry_preserves_other_servers_and_settings() {
        let mut root = json!({
            "mcpServers": {
                "otro-servidor": { "command": "npx", "args": ["-y", "algo"] }
            },
            "theme": "dark"
        });
        merge_olyvia_entry(
            &mut root,
            json!({ "type": "http", "url": "http://127.0.0.1:1" }),
        );
        assert_eq!(root["theme"], "dark");
        assert_eq!(root["mcpServers"]["otro-servidor"]["command"], "npx");
        assert_eq!(root["mcpServers"]["olyvia"]["type"], "http");
    }

    #[test]
    fn merge_olyvia_entry_replaces_only_olyvia_and_repairs_bad_shapes() {
        let mut root = json!({
            "mcpServers": {
                "olyvia": { "type": "sse", "url": "http://viejo" },
                "otro": { "command": "x" }
            }
        });
        merge_olyvia_entry(&mut root, json!({ "type": "http", "url": "http://nuevo" }));
        assert_eq!(root["mcpServers"]["olyvia"]["url"], "http://nuevo");
        assert_eq!(root["mcpServers"]["otro"]["command"], "x");

        let mut bad = json!({ "mcpServers": "no-es-objeto", "ajuste": 1 });
        merge_olyvia_entry(&mut bad, json!({ "ok": true }));
        assert_eq!(bad["ajuste"], 1);
        assert_eq!(bad["mcpServers"]["olyvia"]["ok"], true);

        let mut scalar = json!("basura");
        merge_olyvia_entry(&mut scalar, json!({ "ok": true }));
        assert_eq!(scalar["mcpServers"]["olyvia"]["ok"], true);
    }

    #[test]
    fn detect_clients_returns_known_clients() {
        let clients = mcp_detect_clients();
        let ids: Vec<&str> = clients.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"claude-desktop"));
        assert!(ids.contains(&"antigravity"));
        for client in &clients {
            assert!(!client.label.is_empty());
            assert!(client.download_url.starts_with("https://"));
        }
    }

    #[cfg(windows)]
    #[test]
    fn persistent_mcp_token_is_reused_from_windows_credential_manager() {
        let first = persistent_server_token()
            .expect("el Administrador de credenciales debe estar disponible");
        let second = persistent_server_token().expect("la credencial MCP debe poder leerse");
        assert!(first.len() >= 32);
        assert!(
            first == second,
            "el token MCP debe conservarse entre reinicios"
        );
    }

    #[test]
    fn fallback_catalog_covers_the_core() {
        let list = tools();
        let names: Vec<&str> = list
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert_eq!(names.len(), 25);
        for required in [
            "diagnostics",
            "run_command",
            "project_summary",
            "project_snapshot",
            "timeline_clips",
            "clip_update",
            "clip_move",
            "clip_split",
            "caption_add",
            "run_automation",
            "export_render",
            "navigate",
            "factory_run",
            "factory_job_status",
            "factory_job_list",
            "factory_job_cancel",
        ] {
            assert!(names.contains(&required), "falta {required}");
        }
    }

    #[test]
    fn read_only_batch_policy_follows_the_published_catalog() {
        let catalog = json!([
            {
                "name": "project_read",
                "annotations": { "readOnlyHint": true }
            },
            {
                "name": "project_write",
                "annotations": { "readOnlyHint": false }
            },
            {
                "name": "unknown",
                "annotations": {}
            }
        ]);
        let items = catalog.as_array().expect("catalog array");
        let names = collect_read_only_tools(items);
        assert!(names.contains("project_read"));
        assert!(!names.contains("project_write"));
        assert!(!names.contains("unknown"));
    }

    #[test]
    fn fallback_catalog_has_risk_annotations_for_every_tool() {
        let list = tools();
        let items = list.as_array().expect("fallback catalog must be an array");
        fn schema_is_closed(schema: &Value) -> bool {
            if schema["type"].as_str() == Some("object")
                && schema["additionalProperties"] != Value::Bool(false)
            {
                return false;
            }
            if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
                if !properties.values().all(schema_is_closed) {
                    return false;
                }
            }
            if let Some(items) = schema.get("items") {
                if !schema_is_closed(items) {
                    return false;
                }
            }
            true
        }

        for item in items {
            assert!(item["annotations"]["title"].is_string());
            assert!(item["annotations"]["readOnlyHint"].is_boolean());
            assert!(item["annotations"]["destructiveHint"].is_boolean());
            assert!(item["annotations"]["idempotentHint"].is_boolean());
            assert!(item["annotations"]["openWorldHint"].is_boolean());
            assert!(
                schema_is_closed(&item["inputSchema"]),
                "esquema abierto: {}",
                item["name"]
            );
        }
        let factory = items
            .iter()
            .find(|item| item["name"] == "factory_run")
            .expect("factory_run must exist");
        assert_eq!(factory["annotations"]["destructiveHint"], true);
        let diagnostic = items
            .iter()
            .find(|item| item["name"] == "diagnostics")
            .expect("diagnostics must exist");
        assert_eq!(diagnostic["annotations"]["readOnlyHint"], true);
    }

    #[test]
    fn only_explicit_read_tools_are_parallelized_in_batches() {
        let read = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "project_snapshot", "arguments": {} }
        });
        let diagnostic_read = json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "tools/call",
            "params": { "name": "diagnostics", "arguments": {} }
        });
        let write = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": "clip_update", "arguments": { "clipId": "clip-1" } }
        });
        let unknown = json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "future_tool", "arguments": {} }
        });
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });

        let job_read = json!({
            "jsonrpc": "2.0",
            "id": 5,
            "method": "tools/call",
            "params": { "name": "factory_job_status", "arguments": { "jobId": "job-1" } }
        });
        let job_cancel = json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "tools/call",
            "params": { "name": "factory_job_cancel", "arguments": { "jobId": "job-1" } }
        });

        assert!(is_parallel_read_request(&read));
        assert!(is_parallel_read_request(&diagnostic_read));
        assert!(is_parallel_read_request(&job_read));
        assert!(is_parallel_read_request(
            &json!({ "method": "ping", "id": 4 })
        ));
        assert!(is_parallel_read_request(&notification));
        assert!(!is_parallel_read_request(&write));
        assert!(!is_parallel_read_request(&job_cancel));
        assert!(!is_parallel_read_request(&unknown));
    }

    #[test]
    fn accepts_only_json_rpc_id_scalars() {
        assert!(valid_rpc_id(&json!(null)));
        assert!(valid_rpc_id(&json!("request-1")));
        assert!(valid_rpc_id(&json!(42)));
        assert!(!valid_rpc_id(&json!(true)));
        assert!(!valid_rpc_id(&json!([])));
        assert!(!valid_rpc_id(&json!({ "nested": 1 })));
    }

    #[test]
    fn reads_headers_case_insensitively() {
        let head = "POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc\r\n\r\n";
        assert_eq!(
            header_value(head, "authorization"),
            Some("Bearer abc".to_owned())
        );
    }

    #[test]
    fn validates_http_body_headers() {
        let valid = "POST /mcp HTTP/1.1\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 2\r\n\r\n";
        assert!(is_json_content_type(valid));
        assert_eq!(request_content_length(valid), Ok(2));
        let missing = "POST /mcp HTTP/1.1\r\nContent-Type: application/json\r\n\r\n";
        assert_eq!(request_content_length(missing), Err("falta content-length"));
        let duplicate = "POST /mcp HTTP/1.1\r\nContent-Length: 2\r\ncontent-length: 2\r\n\r\n";
        assert_eq!(
            request_content_length(duplicate),
            Err("content-length duplicado")
        );
        let chunked = "POST /mcp HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n";
        assert_eq!(
            request_content_length(chunked),
            Err("transfer-encoding no compatible")
        );
        let invalid = "POST /mcp HTTP/1.1\r\nContent-Length: 2x\r\n\r\n";
        assert_eq!(
            request_content_length(invalid),
            Err("content-length inválido")
        );
        let wrong_type =
            "POST /mcp HTTP/1.1\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\n";
        assert!(!is_json_content_type(wrong_type));
    }

    #[test]
    fn tool_result_marks_errors() {
        let value = tool_result("falló", true);
        assert_eq!(value["isError"], json!(true));
        assert_eq!(value["content"][0]["text"], json!("falló"));
    }
}
