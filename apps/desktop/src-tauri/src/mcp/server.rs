//! Dominio puro del servidor MCP embebido: catálogo de herramientas,
//! validación JSON-RPC, política de lotes paralelos, parsers HTTP de
//! headers y merge de configuración de clientes externos.
//!
//! Nada de esto toca sockets, keyring, filesystem ni `AppHandle`.

use std::collections::HashSet;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

pub const MCP_PORT: u16 = 31417;
pub const MCP_KEYRING_SERVICE: &str = "editor-ia.mcp";
pub const MCP_KEYRING_USER: &str = "olyvia-server-token";
pub const MAX_HEADER_BYTES: usize = 64 * 1024;
pub const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
pub const BRIDGE_TIMEOUT: Duration = Duration::from_secs(900);
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
pub const BODY_READ_TIMEOUT: Duration = Duration::from_secs(30);
pub const MAX_CONNECTIONS: usize = 32;
pub const MAX_PARALLEL_BATCH_READS: usize = 8;

/// Respuesta del frontend a un `tools/call` pendiente.
#[derive(Debug)]
pub struct McpReply {
    pub ok: bool,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub url: String,
    pub token: String,
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

// ---------------------------------------------------------------------------
// Catálogo de herramientas
// ---------------------------------------------------------------------------

pub fn normalize_json_schema(schema: &mut Value) {
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

fn is_read_only(name: &str) -> bool {
    matches!(
        name,
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
            | "production_list"
            | "production_status"
            | "studio_capabilities"
            | "quality_gate_review"
            | "production_plan_from_brief"
    )
}

fn is_additive(name: &str) -> bool {
    matches!(
        name,
        "track_add"
            | "clip_add"
            | "caption_add"
            | "asset_import"
            | "marker_add"
            | "multicam_build"
            | "navigate"
            | "playhead"
    )
}

fn is_open_world(name: &str) -> bool {
    matches!(
        name,
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
            | "production_plan_from_text"
    )
}

/// Catálogo fallback que sirve el backend cuando la ventana no responde.
/// El catálogo real vive en el frontend (`mcp-catalog.ts`): así una
/// herramienta nueva no se declara dos veces.
pub fn tools() -> Value {
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
        },
        {
            "name": "production_list",
            "description": "Lista las corridas de producción autónoma persistidas.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "production_status",
            "description": "Estado de una corrida de producción: etapa actual, etapas, presupuesto y error.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_create",
            "description": "Crea una corrida de producción desde un ProductionPlan serializado (schemaVersion 1). No la ejecuta: usar production_start o production_advance.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plan": { "type": "object", "description": "ProductionPlan validado por el schema del proyecto." },
                    "runId": { "type": "string", "minLength": 1, "maxLength": 128 },
                    "maxCostCents": { "type": "integer", "minimum": 0, "maximum": 100000000 }
                },
                "required": ["plan"]
            }
        },
        {
            "name": "production_start",
            "description": "Arranca el driver backend que conduce la corrida hasta terminar, pausarse o fallar. Reanuda corridas pausadas/fallidas.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_advance",
            "description": "Avanza la corrida una etapa (avanzada manual; el driver hace esto solo).",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_cancel",
            "description": "Cancela la corrida y el render FFmpeg activo, si lo hay.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_resume",
            "description": "Reanuda una corrida pausada o fallida y arranca su driver.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "production_pause",
            "description": "Pausa la corrida entre etapas; el driver se detiene solo.",
            "inputSchema": {
                "type": "object",
                "properties": { "runId": { "type": "string", "minLength": 1, "maxLength": 128 } },
                "required": ["runId"]
            }
        },
        {
            "name": "studio_capabilities",
            "description": "Inventario real del estudio: providers de generación, fuentes de adquisición, etapas del pipeline y disponibilidad de ffmpeg/ffprobe.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "quality_gate_review",
            "description": "Quality Gate del proyecto abierto: valida documento (assets, clips, captions, derechos) y devuelve el reporte con hallazgos tipados errors/warnings. No modifica nada; evalúa el último estado guardado en disco.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "production_plan_from_brief",
            "description": "Construye un ProductionPlan válido desde un brief (objetivo, keyPoints, escenas, plataforma, voz, música, tarjeta). No crea ni ejecuta la corrida: revisar el plan y usar production_create.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "objective": { "type": "string", "minLength": 1, "maxLength": 2000 },
                    "audience": { "type": "string", "maxLength": 500 },
                    "tone": { "type": "string", "maxLength": 500 },
                    "keyPoints": { "type": "array", "maxItems": 16, "items": { "type": "string", "maxLength": 2000 } },
                    "sceneCount": { "type": "integer", "minimum": 1, "maximum": 8 },
                    "durationSeconds": { "type": "integer", "minimum": 3, "maximum": 3600 },
                    "platform": { "type": "string", "enum": ["youtube", "shorts", "reels", "tiktok"] },
                    "aspectRatio": { "type": "string", "enum": ["16:9", "9:16", "1:1", "4:5"] },
                    "voice": { "type": "string", "maxLength": 200 },
                    "music": { "type": "boolean" },
                    "titleCard": { "type": "boolean" },
                    "brollQuery": { "type": "string", "maxLength": 500 },
                    "maxCostCents": { "type": "integer", "minimum": 0, "maximum": 100000000 }
                },
                "required": ["objective"]
            }
        },
        {
            "name": "production_plan_from_text",
            "description": "Interpreta texto libre con el provider de chat configurado (BYOK) y devuelve un ProductionPlan válido. Puede gastar en proveedor remoto: requiere approvedCost=true. No crea ni ejecuta la corrida.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "minLength": 10, "maxLength": 2000 },
                    "approvedCost": { "type": "boolean" }
                },
                "required": ["text"]
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
            let read_only = is_read_only(&name);
            let additive = is_additive(&name);
            let idempotent = matches!(name.as_str(), "project_save" | "navigate" | "playhead");
            let open_world = is_open_world(&name);
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

/// Herramientas del estudio autónomo que el BACKEND ejecuta directo
/// (casos de uso de `application::production`), sin pasar por la ventana:
/// deben funcionar aunque el frontend no esté montado.
pub fn is_studio_tool(name: &str) -> bool {
    matches!(
        name,
        "production_list"
            | "production_status"
            | "production_create"
            | "production_start"
            | "production_advance"
            | "production_cancel"
            | "production_resume"
            | "production_pause"
            | "studio_capabilities"
            | "quality_gate_review"
            | "production_plan_from_brief"
            | "production_plan_from_text"
    )
}

/// Catálogo de las tools de estudio tal como queda en `tools()` (con
/// anotaciones y schemas normalizados). Se usa para mezclar el catálogo
/// real del frontend con las tools que sólo el backend conoce.
pub fn studio_tools() -> Vec<Value> {
    tools()
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item["name"]
                        .as_str()
                        .is_some_and(|name| is_studio_tool(name))
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub fn collect_read_only_tools(items: &[Value]) -> HashSet<String> {
    items
        .iter()
        .filter(|item| item["annotations"]["readOnlyHint"].as_bool() == Some(true))
        .filter_map(|item| item["name"].as_str().map(str::to_owned))
        .collect()
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

pub fn valid_rpc_id(value: &Value) -> bool {
    value.is_null() || value.is_string() || value.is_number()
}

pub fn tool_result(text: &str, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error
    })
}

pub fn rpc_result(id: &Value, value: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": value })
}

pub fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

/// Validación previa al despacho: devuelve el id si el mensaje es un
/// request bien formado, o la respuesta de error que corresponde.
/// `None` significa notificación (no generar respuesta).
pub enum RpcRequest {
    /// Request válido con su id.
    Call(Value),
    /// Notificación: no hay respuesta.
    Notification,
    /// Responder con este valor de error.
    Reject(Value),
}

pub fn classify_request(message: &Value) -> RpcRequest {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    if !message.is_object() || message.get("jsonrpc") != Some(&json!("2.0")) {
        return RpcRequest::Reject(rpc_error(&id, -32600, "solicitud JSON-RPC inválida"));
    }
    if message.get("id").is_some_and(|value| !valid_rpc_id(value)) {
        return RpcRequest::Reject(rpc_error(
            &Value::Null,
            -32600,
            "el id JSON-RPC debe ser texto, número o null",
        ));
    }
    if message
        .get("params")
        .is_some_and(|params| !params.is_object())
    {
        return RpcRequest::Reject(rpc_error(&id, -32602, "params debe ser un objeto JSON"));
    }
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return RpcRequest::Reject(rpc_error(&id, -32600, "falta el método JSON-RPC"));
    };
    if id.is_null() && method.starts_with("notifications/") {
        return RpcRequest::Notification;
    }
    RpcRequest::Call(id)
}

/// Extrae (method, name, args) de un request ya clasificado como Call.
pub fn call_parts(message: &Value) -> (&str, &str, &Value) {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let name = message["params"]["name"].as_str().unwrap_or("");
    let args = &message["params"]["arguments"];
    (method, name, args)
}

/// Sólo estas operaciones pueden adelantarse dentro de un lote JSON-RPC.
/// Cualquier escritura o herramienta desconocida conserva el orden secuencial.
pub fn is_parallel_read_request(read_only: &HashSet<String>, message: &Value) -> bool {
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
            read_only.contains(name)
        }
        notification if notification.starts_with("notifications/") => {
            message.get("id").map(Value::is_null).unwrap_or(true)
        }
        _ => false,
    }
}

pub fn empty_batch_error() -> Value {
    rpc_error(
        &Value::Null,
        -32600,
        "el lote JSON-RPC no puede estar vacío",
    )
}

pub fn batch_task_error(id: &Value) -> Value {
    rpc_error(id, -32603, "falló una tarea del lote MCP")
}

// ---------------------------------------------------------------------------
// Clientes externos (autoconnect)
// ---------------------------------------------------------------------------

/// Entrada `mcpServers.olyvia` en la config de cada cliente. Claude Desktop
/// usa `type: "http"`; Antigravity usa `serverUrl`.
pub fn client_entry(client: &str, info: &McpServerInfo) -> Option<Value> {
    match client {
        "claude-desktop" => Some(json!({
            "type": "http",
            "url": info.url,
            "headers": { "Authorization": format!("Bearer {}", info.token) }
        })),
        "antigravity" => Some(json!({
            "serverUrl": info.url,
            "headers": { "Authorization": format!("Bearer {}", info.token) }
        })),
        _ => None,
    }
}

/// Catálogo de clientes conocidos: id, etiqueta y URL de descarga.
pub fn known_clients() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "claude-desktop",
            "Claude Desktop",
            "https://claude.ai/download",
        ),
        ("antigravity", "Antigravity", "https://antigravity.google/"),
    ]
}

/// Inserta o reemplaza la entrada `mcpServers.olyvia` en la raíz de la
/// configuración del cliente sin tocar nada más: otros servidores MCP,
/// ajustes del cliente y campos extra se conservan. Si el archivo no era
/// un objeto JSON válido, se reinicia como `{}`.
pub fn merge_olyvia_entry(root: &mut Value, entry: Value) {
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

// ---------------------------------------------------------------------------
// Parsers HTTP de headers (puros)
// ---------------------------------------------------------------------------

pub fn header_value(headers: &str, name: &str) -> Option<String> {
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

pub fn is_json_content_type(headers: &str) -> bool {
    header_value(headers, "content-type")
        .and_then(|value| value.split(';').next().map(str::trim).map(str::to_owned))
        .map(|value| value.eq_ignore_ascii_case("application/json"))
        .unwrap_or(false)
}

pub fn request_content_length(headers: &str) -> Result<usize, &'static str> {
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

#[cfg(test)]
#[path = "server.tests.rs"]
mod tests;
