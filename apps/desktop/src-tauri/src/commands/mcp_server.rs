//! Servidor MCP local.
//!
//! La app ya era **cliente** de servidores MCP; esto es lo contrario: expone un
//! endpoint HTTP en 127.0.0.1 para que una IA externa (Claude Desktop, Cursor,
//! un agente propio) pueda leer el estado y ejecutar comandos.
//!
//! El transporte es HTTP con JSON-RPC 2.0 en `POST /mcp`. Cada arranque genera
//! un token nuevo: sin `Authorization: Bearer <token>` no se atiende nada, así
//! que otro proceso de la máquina no puede manejar el editor por accidente.
//!
//! Las acciones viven en el frontend (picos, planes, render). Por eso
//! `run_command` emite un evento a la ventana y espera la respuesta: el mismo
//! camino que usa el asistente, con la misma semántica.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(900);

struct McpReply {
    ok: bool,
    text: String,
}

static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<McpReply>>>> = OnceLock::new();
static INFO: OnceLock<Mutex<Option<McpServerInfo>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<McpReply>>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn info_slot() -> &'static Mutex<Option<McpServerInfo>> {
    INFO.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub url: String,
    pub token: String,
}

fn tools() -> Value {
    json!([
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
                    "clipId": { "type": "string" },
                    "label": { "type": "string" },
                    "enabled": { "type": "boolean" },
                    "gainDb": { "type": "number" },
                    "motion": { "type": ["string", "null"], "enum": ["zoom-in", "zoom-out", "pan-left", "pan-right", null] },
                    "motionIntensity": { "type": "number" }
                },
                "required": ["clipId"]
            }
        },
        {
            "name": "clip_move",
            "description": "Mueve un clip a un frame de inicio y, opcionalmente, a otra pista.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "clipId": { "type": "string" },
                    "startFrame": { "type": "number" },
                    "trackId": { "type": "string" }
                },
                "required": ["clipId", "startFrame"]
            }
        },
        {
            "name": "clip_delete",
            "description": "Elimina un clip de la timeline.",
            "inputSchema": {
                "type": "object",
                "properties": { "clipId": { "type": "string" } },
                "required": ["clipId"]
            }
        },
        {
            "name": "clip_split",
            "description": "Divide un clip en un frame.",
            "inputSchema": {
                "type": "object",
                "properties": { "clipId": { "type": "string" }, "atFrame": { "type": "number" } },
                "required": ["clipId", "atFrame"]
            }
        },
        {
            "name": "caption_add",
            "description": "Agrega un subtítulo en un frame con una duración.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "startFrame": { "type": "number" },
                    "durationFrames": { "type": "number" }
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
                    "cueId": { "type": "string" },
                    "text": { "type": "string" },
                    "startFrame": { "type": "number" },
                    "endFrame": { "type": "number" }
                },
                "required": ["cueId"]
            }
        },
        {
            "name": "caption_delete",
            "description": "Elimina un subtítulo.",
            "inputSchema": {
                "type": "object",
                "properties": { "cueId": { "type": "string" } },
                "required": ["cueId"]
            }
        },
        {
            "name": "track_update",
            "description": "Cambia nombre, bloqueo, silencio u ocultamiento de una pista.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "trackId": { "type": "string" },
                    "label": { "type": "string" },
                    "locked": { "type": "boolean" },
                    "muted": { "type": "boolean" },
                    "hidden": { "type": "boolean" }
                },
                "required": ["trackId"]
            }
        },
        {
            "name": "run_automation",
            "description": "Ejecuta automatizaciones: cut_silences, cut_pauses, auto_cleanup, auto_pilot o export.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": { "type": "string", "enum": ["cut_silences", "cut_pauses", "auto_cleanup", "auto_pilot", "export"] },
                    "outputDir": { "type": "string" },
                    "profileId": { "type": "string" }
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
                    "outputDir": { "type": "string" },
                    "profileId": { "type": "string" },
                    "qualityCheck": { "type": "boolean" }
                }
            }
        },
        {
            "name": "navigate",
            "description": "Abre una vista de la app (editor, inicio, fabrica, produccion, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": { "view": { "type": "string" } },
                "required": ["view"]
            }
        },
        {
            "name": "run_command",
            "description": "Ejecuta un comando del editor en lenguaje natural (cortar silencios, limpiar, pilotar).",
            "inputSchema": {
                "type": "object",
                "properties": { "command": { "type": "string" } },
                "required": ["command"]
            }
        }
    ])
}

fn tool_result(text: &str, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    })
}

async fn run_tool(app: &AppHandle, tool: &str, args: &Value) -> Value {
    let id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    if let Ok(mut map) = pending().lock() {
        map.insert(id.clone(), sender);
    }
    let emitted = app.emit("mcp-call", json!({ "id": id, "tool": tool, "args": args }));
    if emitted.is_err() {
        if let Ok(mut map) = pending().lock() {
            map.remove(&id);
        }
        return tool_result("la ventana del editor no está disponible", true);
    }
    match tokio::time::timeout(BRIDGE_TIMEOUT, receiver).await {
        Ok(Ok(reply)) => tool_result(&reply.text, !reply.ok),
        Ok(Err(_)) => tool_result("la ventana cerró antes de responder", true),
        Err(_) => {
            if let Ok(mut map) = pending().lock() {
                map.remove(&id);
            }
            tool_result("la herramienta tardó demasiado (15 min)", true)
        }
    }
}

async fn handle_rpc(app: &AppHandle, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
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
            let reply = run_tool(app, "__catalog", &json!({})).await;
            let parsed = reply["content"][0]["text"]
                .as_str()
                .and_then(|text| serde_json::from_str::<Value>(text).ok());
            Ok(match parsed {
                Some(Value::Array(items)) if !items.is_empty() => json!({ "tools": items }),
                _ => json!({ "tools": tools() }),
            })
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

async fn serve(mut stream: tokio::net::TcpStream, app: AppHandle, token: String) {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end;
    loop {
        match stream.read(&mut chunk).await {
            Ok(0) => return,
            Ok(read) => {
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
            Err(_) => return,
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
    let length: usize = header_value(&head, "content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if length > MAX_BODY_BYTES {
        write_response(&mut stream, 413, "{\"error\":\"cuerpo demasiado grande\"}").await;
        return;
    }
    let mut body = buffer[header_end..].to_vec();
    while body.len() < length {
        match stream.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => body.extend_from_slice(&chunk[..read]),
            Err(_) => break,
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
        let mut answers = Vec::new();
        for item in items {
            if let Some(answer) = handle_rpc(&app, item).await {
                answers.push(answer);
            }
        }
        Value::Array(answers)
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
    if let Ok(guard) = info_slot().lock() {
        if let Some(existing) = guard.clone() {
            return Ok(existing);
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no pude abrir el puerto del servidor MCP",
        )
    })?;
    let port = listener
        .local_addr()
        .map(|address| address.port())
        .unwrap_or(0);
    if port == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el servidor MCP no consiguió un puerto",
        ));
    }
    let token = Uuid::new_v4().to_string();
    let info = McpServerInfo {
        url: format!("http://127.0.0.1:{port}/mcp"),
        token: token.clone(),
    };
    if let Ok(mut guard) = info_slot().lock() {
        *guard = Some(info.clone());
    }
    let loop_token = token;
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let app = app.clone();
            let token = loop_token.clone();
            tauri::async_runtime::spawn(async move {
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
    fn fallback_catalog_covers_the_core() {
        let list = tools();
        let names: Vec<&str> = list
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert_eq!(names.len(), 19);
        for required in [
            "run_command",
            "project_summary",
            "timeline_clips",
            "clip_update",
            "clip_move",
            "clip_split",
            "caption_add",
            "run_automation",
            "export_render",
            "navigate",
        ] {
            assert!(names.contains(&required), "falta {required}");
        }
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
    fn tool_result_marks_errors() {
        let value = tool_result("falló", true);
        assert_eq!(value["isError"], json!(true));
        assert_eq!(value["content"][0]["text"], json!("falló"));
    }
}
