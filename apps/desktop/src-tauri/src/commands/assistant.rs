//! Floating Olyvia assistant.
//!
//! The provider only returns text plus a small, allowlisted action. The frontend
//! validates the action again and executes it through the same store/navigation
//! APIs as the UI. This module never mutates a project directly.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::commands::providers::{
    chat_completion, chat_endpoint, extract_json, is_local_endpoint, json_repair_messages, read_key,
    validate_provider_base_url, ChatRequest,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_MESSAGES: usize = 16;
const MAX_MESSAGE_CHARS: usize = 4_000;
const MAX_CONTEXT_CHARS: usize = 3_000;
const MAX_REPLY_CHARS: usize = 2_000;
const MAX_ASSISTANT_ACTIONS: usize = 5;
const MAX_ASSISTANT_MCP_ARGS_BYTES: usize = 12 * 1024;
const MAX_ASSISTANT_MCP_CATALOG_BYTES: usize = 48 * 1024;
const MAX_ASSISTANT_MCP_ARG_FIELDS: usize = 48;

const VIEWS: [&str; 33] = [
    "home",
    "projects",
    "script",
    "assets",
    "production",
    "editor",
    "download",
    "director",
    "auto-edit",
    "youtube",
    "factory",
    "creator",
    "compliance",
    "convert",
    "compare",
    "compress",
    "denoise",
    "sharpen",
    "thumbnails",
    "localization",
    "ai-hub",
    "motion",
    "visuals",
    "background",
    "upscale",
    "text-edit",
    "multicam",
    "mixer",
    "vfx",
    "lab",
    "learn",
    "mcp",
    "settings",
];

fn clean_name(value: &Value, key: &str, max: usize) -> Option<String> {
    let raw = value.get(key)?.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    Some(raw.chars().take(max).collect())
}

fn clean_number(value: &Value, key: &str, min: f64, max: f64) -> Option<f64> {
    let raw = value.get(key)?.as_f64()?;
    if !raw.is_finite() || raw < min || raw > max {
        return None;
    }
    Some((raw * 1000.0).round() / 1000.0)
}

/// La ruta tiene que ser absoluta: el operador del asistente no adivina rutas
/// relativas porque importaría material del directorio de trabajo sin querer.
fn clean_absolute_path(value: &Value) -> Option<String> {
    let raw = value.get("path")?.as_str()?.trim();
    if raw.is_empty() || raw.len() > 500 {
        return None;
    }
    let is_absolute = raw.starts_with('/')
        || raw
            .chars()
            .next()
            .is_some_and(|letter| letter.is_ascii_alphabetic() && raw[1..].starts_with(':'));
    if !is_absolute {
        return None;
    }
    Some(raw.chars().take(500).collect())
}

fn clean_url(value: &Value) -> Option<String> {
    let raw = value.get("url")?.as_str()?.trim();
    if raw.len() > 500 {
        return None;
    }
    let lower = raw.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        .then(|| raw.chars().take(500).collect())
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantRequest {
    pub messages: Vec<AssistantMessage>,
    #[serde(default)]
    pub context: Option<Value>,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantReply {
    pub reply: String,
    /// Primera acción para clientes antiguos que sólo conocen `action`.
    pub action: Option<Value>,
    /// Secuencia validada y ordenada; máximo MAX_ASSISTANT_ACTIONS.
    pub actions: Vec<Value>,
    pub provider_id: String,
    pub model: String,
    pub simulated: bool,
}

fn clean_messages(messages: &[AssistantMessage]) -> Result<Vec<AssistantMessage>, ProjectError> {
    let mut cleaned = Vec::new();
    for message in messages.iter().take(MAX_MESSAGES) {
        let role = message.role.trim().to_ascii_lowercase();
        if role != "user" && role != "assistant" {
            continue;
        }
        let content = message.content.trim();
        if content.is_empty() {
            continue;
        }
        cleaned.push(AssistantMessage {
            role,
            content: content.chars().take(MAX_MESSAGE_CHARS).collect(),
        });
    }
    if !cleaned.iter().any(|message| message.role == "user") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el asistente necesita al menos un mensaje del usuario",
        ));
    }
    Ok(cleaned)
}

fn clean_action(value: Option<&Value>) -> Option<Value> {
    let value = value?;
    let kind = value.get("kind")?.as_str()?.trim();
    match kind {
        "navigate" => {
            let view = value.get("view")?.as_str()?.trim();
            if VIEWS.contains(&view) {
                Some(json!({ "kind": "navigate", "view": view }))
            } else {
                None
            }
        }
        "motion" => {
            let template = value.get("templateId")?.as_str()?.trim();
            if !matches!(
                template,
                "title-card" | "lower-third" | "end-card" | "stat-callout"
            ) {
                return None;
            }
            let text: String = value
                .get("text")?
                .as_str()?
                .trim()
                .chars()
                .take(120)
                .collect();
            if text.is_empty() {
                return None;
            }
            let secondary: String = value
                .get("secondary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .chars()
                .take(80)
                .collect();
            let mut action = json!({
                "kind": "motion",
                "templateId": template,
                "text": text
            });
            if !secondary.is_empty() {
                action["secondary"] = json!(secondary);
            }
            Some(action)
        }
        "media_folder" => {
            let folder = value.get("folder")?.as_str()?;
            let name = crate::commands::media::sanitize_media_folder_name(folder)?;
            Some(json!({ "kind": "media_folder", "folder": name }))
        }
        "new_project" => {
            let name = clean_name(value, "name", 60)?;
            Some(json!({ "kind": "new_project", "name": name }))
        }
        "import_file" => {
            let path = clean_absolute_path(value)?;
            Some(json!({ "kind": "import_file", "path": path }))
        }
        "download_url" => {
            let url = clean_url(value)?;
            Some(json!({ "kind": "download_url", "url": url }))
        }
        "add_clip" => {
            let asset = clean_name(value, "asset", 120)?;
            let at_playhead = value
                .get("atPlayhead")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Some(json!({ "kind": "add_clip", "asset": asset, "atPlayhead": at_playhead }))
        }
        "goto" => {
            let seconds = clean_number(value, "seconds", 0.0, 36_000.0)?;
            Some(json!({ "kind": "goto", "seconds": seconds }))
        }
        "add_caption" => {
            let text = clean_name(value, "text", 200)?;
            let seconds = clean_number(value, "seconds", 0.3, 60.0).unwrap_or(3.0);
            Some(json!({ "kind": "add_caption", "text": text, "seconds": seconds }))
        }
        "set_speed" => {
            let speed = clean_number(value, "speed", 0.1, 10.0)?;
            Some(json!({ "kind": "set_speed", "speed": speed }))
        }
        "set_gain" => {
            let db = clean_number(value, "db", -24.0, 24.0)?;
            if db == 0.0 {
                return None;
            }
            Some(json!({ "kind": "set_gain", "db": db }))
        }
        "mute_clip" => {
            let muted = value.get("muted").and_then(Value::as_bool)?;
            Some(json!({ "kind": "mute_clip", "muted": muted }))
        }
        "cut_silences" => {
            let threshold = clean_number(value, "thresholdDb", -90.0, -10.0).unwrap_or(-45.0);
            let minimum = clean_number(value, "minSilenceSeconds", 0.05, 5.0).unwrap_or(0.35);
            let padding = clean_number(value, "paddingSeconds", 0.0, 2.0).unwrap_or(0.15);
            let scope = match value.get("scope").and_then(Value::as_str) {
                Some("project") => "project",
                _ => "selection",
            };
            Some(json!({
                "kind": "cut_silences",
                "thresholdDb": threshold,
                "minSilenceSeconds": minimum,
                "paddingSeconds": padding,
                "scope": scope
            }))
        }
        "auto_subtitles" => {
            let scope = match value.get("scope").and_then(Value::as_str) {
                Some("project") => "project",
                _ => "selection",
            };
            Some(json!({ "kind": "auto_subtitles", "scope": scope }))
        }
        "cut_voice_pauses" => {
            let minimum = clean_number(value, "minPauseSeconds", 0.1, 3.0).unwrap_or(0.35);
            let padding = clean_number(value, "paddingSeconds", 0.0, 0.5).unwrap_or(0.08);
            let scope = match value.get("scope").and_then(Value::as_str) {
                Some("project") => "project",
                _ => "selection",
            };
            Some(json!({
                "kind": "cut_voice_pauses",
                "minPauseSeconds": minimum,
                "paddingSeconds": padding,
                "scope": scope
            }))
        }
        "auto_cleanup" => {
            let denoise = match value.get("denoise").and_then(Value::as_str) {
                Some("off") => "off",
                Some("light") => "light",
                Some("strong") => "strong",
                _ => "medium",
            };
            let target = clean_number(value, "targetLufs", -33.0, -9.0).unwrap_or(-14.0);
            let flag = |key: &str, default: bool| {
                value.get(key).and_then(Value::as_bool).unwrap_or(default)
            };
            Some(json!({
                "kind": "auto_cleanup",
                "denoise": denoise,
                "levelAudio": flag("levelAudio", true),
                "zoomCuts": flag("zoomCuts", true),
                "cutSilences": flag("cutSilences", true),
                "cutPauses": flag("cutPauses", true),
                "targetLufs": target
            }))
        }
        "auto_pilot" => Some(json!({ "kind": "auto_pilot" })),
        "delete_selected" | "split_at_playhead" => Some(json!({ "kind": kind })),
        "play" | "pause" | "save" | "export" | "status" | "undo" | "redo" => {
            Some(json!({ "kind": kind }))
        }
        "mcp_call" => {
            let tool = clean_name(value, "tool", 80)?;
            let arguments = value.get("arguments")?;
            let fields = arguments.as_object()?;
            if fields.len() > MAX_ASSISTANT_MCP_ARG_FIELDS
                || serde_json::to_vec(arguments)
                    .map(|bytes| bytes.len() > MAX_ASSISTANT_MCP_ARGS_BYTES)
                    .unwrap_or(true)
            {
                return None;
            }
            Some(json!({
                "kind": "mcp_call",
                "tool": tool,
                "arguments": arguments
            }))
        }
        _ => None,
    }
}

/// Limpia una lista de acciones propuesta por el proveedor. Se mantiene el
/// campo singular antiguo como fallback; no se aceptan acciones desconocidas,
/// duplicadas ni más de MAX_ASSISTANT_ACTIONS por respuesta.
fn clean_actions(value: &Value) -> Vec<Value> {
    let candidates: Vec<&Value> = value
        .get("actions")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .map(|items| items.iter().collect())
        .unwrap_or_else(|| value.get("action").into_iter().collect());

    let mut actions = Vec::with_capacity(MAX_ASSISTANT_ACTIONS);
    for candidate in candidates.into_iter().take(MAX_ASSISTANT_ACTIONS * 4) {
        let Some(action) = clean_action(Some(candidate)) else {
            continue;
        };
        if !actions.contains(&action) {
            actions.push(action);
            if actions.len() == MAX_ASSISTANT_ACTIONS {
                break;
            }
        }
    }
    actions
}

fn clean_reply(value: &str) -> String {
    let cleaned = value
        .trim()
        .chars()
        .take(MAX_REPLY_CHARS)
        .collect::<String>();
    if cleaned.is_empty() {
        "Listo. ¿Qué querés hacer ahora?".to_owned()
    } else {
        cleaned
    }
}

fn mock_reply(messages: &[AssistantMessage], model: &str) -> AssistantReply {
    let text = messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.to_ascii_lowercase())
        .unwrap_or_default();
    let (reply, action) = if text.contains("editor") {
        (
            "Abriendo el editor.",
            Some(json!({ "kind": "navigate", "view": "editor" })),
        )
    } else if text.contains("guardar") {
        ("Guardando el proyecto.", Some(json!({ "kind": "save" })))
    } else if text.contains("exportar") || text.contains("render") {
        (
            "Abriendo la exportación.",
            Some(json!({ "kind": "export" })),
        )
    } else if text.contains("reproducir") || text.contains("play") {
        ("Reproduciendo.", Some(json!({ "kind": "play" })))
    } else if text.contains("pausar") || text.contains("pausa") {
        ("Pausado.", Some(json!({ "kind": "pause" })))
    } else if text.contains("estado") {
        (
            "Te muestro el estado del proyecto.",
            Some(json!({ "kind": "status" })),
        )
    } else if text.contains("motion") {
        (
            "Abriendo Motion.",
            Some(json!({ "kind": "navigate", "view": "motion" })),
        )
    } else if text.contains("inicio") || text.contains("home") {
        (
            "Volviendo al inicio.",
            Some(json!({ "kind": "navigate", "view": "home" })),
        )
    } else if text.contains("hola") {
        (
            "Hola. Soy Olyvia. Estoy en modo simulado; puedo abrir vistas, guardar, exportar o darte el estado. Configurá un proveedor en Ajustes para conversar con un modelo real.",
            None,
        )
    } else {
        (
            "Modo simulado: no hay un modelo conectado. Puedo navegar por la app, guardar, exportar o consultar el estado. Para respuestas libres, configurá Ollama o una API en Ajustes.",
            None,
        )
    };
    let actions = action.clone().into_iter().collect();
    AssistantReply {
        reply: reply.to_owned(),
        action,
        actions,
        provider_id: "mock".to_owned(),
        model: model.to_owned(),
        simulated: true,
    }
}

/// Prompt de sistema del asistente. Vive separado para que el streaming use el
/// mismo contrato sin duplicar el texto.
fn assistant_system_prompt(context: &str) -> String {
    let system = concat!(
        "Sos Olyvia, la asistente del estudio de creación local Olyvia: un editor de ",
        "video con guion, medios, voz, motion graphics y exportación FFmpeg, 100% sin nube. ",
        "Respondé breve, claro y en español rioplatense; no inventes datos del proyecto. ",
        "Devolvés SOLO un objeto JSON válido, sin markdown: ",
        "{\"reply\": string, \"actions\"?: [object, ...]}. ",
        "Podés proponer entre 1 y 5 acciones ordenadas; se ejecutan en secuencia. ",
        "Usá varias sólo cuando el pedido requiera pasos dependientes; no repitas acciones. ",
        "El borrado siempre espera confirmación explícita. ",
        "El catálogo de herramientas con nombres, descripciones y JSON Schema está en la sección ",
        "CATALOGO_MCP_JSON del contexto; si dice CATALOGO PARCIAL, sólo esas herramientas están ",
        "disponibles. Llamá una herramienta con ",
        "{\"kind\":\"mcp_call\",\"tool\":\"nombre_exacto\",\"arguments\":{...}}. ",
        "Elegí sólo herramientas presentes en ese catálogo y respetá inputSchema; ",
        "la app rechazará herramientas desconocidas o argumentos inválidos. ",
        "Las consultas read-only no requieren confirmación; las escrituras destructivas ",
        "o las operaciones sobre archivos/servicios externos se detienen para autorización. ",
        "Acciones permitidas: {\"kind\":\"navigate\",\"view\":\"home|projects|script|assets|production|editor|download|director|auto-edit|youtube|factory|creator|compliance|convert|compare|compress|denoise|sharpen|thumbnails|localization|ai-hub|motion|visuals|background|upscale|text-edit|multicam|mixer|vfx|lab|learn|mcp|settings\"}, ",
        "{\"kind\":\"play\"}, {\"kind\":\"pause\"}, {\"kind\":\"save\"}, {\"kind\":\"export\"}, {\"kind\":\"status\"}, {\"kind\":\"undo\"}, {\"kind\":\"redo\"}, ",
        "{\"kind\":\"motion\",\"templateId\":\"title-card|lower-third|end-card|stat-callout\",\"text\":string,\"secondary\"?:string}, ",
        "{\"kind\":\"media_folder\",\"folder\":string}, {\"kind\":\"new_project\",\"name\":string}, ",
        "{\"kind\":\"import_file\",\"path\":string} (ruta absoluta que exista), {\"kind\":\"download_url\",\"url\":string} (http o https), ",
        "{\"kind\":\"add_clip\",\"asset\":string,\"atPlayhead\":boolean} (nombre del material en Medios), ",
        "{\"kind\":\"delete_selected\"}, {\"kind\":\"split_at_playhead\"}, {\"kind\":\"goto\",\"seconds\":number}, ",
        "{\"kind\":\"add_caption\",\"text\":string,\"seconds\":number}, {\"kind\":\"set_speed\",\"speed\":number}, ",
        "{\"kind\":\"set_gain\",\"db\":number} (-24 a 24, sin cero) y {\"kind\":\"mute_clip\",\"muted\":boolean}. ",
        "{\"kind\":\"cut_silences\",\"scope\":\"selection|project\",\"thresholdDb\"?:number,",
        "\"minSilenceSeconds\"?:number,\"paddingSeconds\"?:number} corta los silencios medidos ",
        "por la app con ripple y deshacer. Usalo cuando pidan limpiar pausas, silencios o ",
        "tiempos muertos: no borres clip por clip a mano. ",
        "{\"kind\":\"auto_subtitles\",\"scope\":\"selection|project\"} transcribe la voz con ",
        "Whisper local y crea subtítulos partidos en dos líneas, sincronizados por palabra. ",
        "Usalo cuando pidan subtitular, transcribir o poner subtítulos automáticos. ",
        "{\"kind\":\"cut_voice_pauses\",\"scope\":\"selection|project\",\"minPauseSeconds\"?:number,",
        "\"paddingSeconds\"?:number} corta el aire entre frases usando los subtítulos. ",
        "Usalo cuando pidan cortar pausas, quitar el aire o ajustar la narración; ",
        "no es lo mismo que cut_silences (amplitud). ",
        "{\"kind\":\"auto_cleanup\",\"denoise\":\"off|light|medium|strong\",\"levelAudio\"?:boolean,",
        "\"zoomCuts\"?:boolean,\"cutSilences\"?:boolean,\"cutPauses\"?:boolean,\"targetLufs\"?:number} ",
        "hace la limpieza completa en un paso: silencios, pausas, ruido, volumen y zoom. ",
        "Usalo cuando pidan dejar el video listo, limpiarlo o prepararlo para publicar. ",
        "{\"kind\":\"auto_pilot\"} hace todo el camino: mide, limpia, exporta y verifica el MP4 ",
        "en un solo paso. Usalo cuando pidan el piloto automático o una entrega completa. ",
        "{\"kind\":\"brain\",\"mode\":\"report|safe|all\"} delega la edición al cerebro de la app: ",
        "report devuelve el diagnóstico medido, safe aplica sólo lo que no rompe nada y all aplica todo. ",
        "Para mejorar ritmo, cerrar huecos o ajustar el formato usá brain en vez de cortar a mano; ",
        "el cerebro ya midió la timeline y sus números están en el contexto. ",
        "Si piden usar los archivos, fotos, sonido o audio de una carpeta de Descargas, ",
        "devolvé media_folder con el nombre exacto de la carpeta (sin ruta); la app la ",
        "resuelve, importa y monta. No digas que la abrirás: usá la acción. ",
        "Para editar la timeline necesitás saber qué hay: si el contexto no alcanza, ",
        "preguntá antes de proponer un corte o un borrado. Borrar y cortar se pueden deshacer. ",
        "No inventes rutas, nombres de material, IDs ni argumentos de herramientas. ",
        "Si no hace falta una acción, omití actions. Contexto del proyecto: "
    );
    format!("{system}{context}")
}

/// Mensajes de la llamada: system + historial ya limpiado.
fn assistant_body_messages(context: &str, messages: &[AssistantMessage]) -> Vec<Value> {
    let mut body_messages = vec![json!({
        "role": "system",
        "content": assistant_system_prompt(context),
    })];
    for message in messages {
        body_messages.push(json!({ "role": message.role, "content": message.content }));
    }
    body_messages
}

/// Parsea la respuesta estructurada del asistente. `None` cuando vino texto
/// plano o JSON roto: el llamador decide el fallback tolerante de siempre.
fn parse_reply_content(content: &str) -> Option<(String, Vec<Value>)> {
    let json_text = extract_json(content)?;
    let value: Value = serde_json::from_str(json_text).ok()?;
    Some((
        clean_reply(value.get("reply").and_then(Value::as_str).unwrap_or("")),
        clean_actions(&value),
    ))
}

/// Llamada real al proveedor OpenAI-compatible: devuelve respuesta y
/// secuencia de acciones ya saneadas. Separada del comando para poder probarla
/// sin estado de Tauri.
async fn call_provider(
    base_url: &str,
    model: &str,
    context: &str,
    messages: &[AssistantMessage],
    key: Option<String>,
) -> Result<(String, Vec<Value>), ProjectError> {
    let system = assistant_system_prompt(context);
    let mut body_messages = vec![json!({ "role": "system", "content": system })];
    for message in messages {
        body_messages.push(json!({ "role": message.role, "content": message.content }));
    }
    let first = chat_completion(ChatRequest {
        base_url,
        model,
        temperature: 0.3,
        messages: body_messages.clone(),
        key: key.clone(),
    })
    .await?;
    let (reply, actions) = match parse_reply_content(&first) {
        Some(parsed) => parsed,
        None => {
            // Respondió texto plano o JSON roto: un reintento de reparación con
            // el mismo contrato. Si tampoco cumple, se conserva el texto, que
            // es el comportamiento tolerante de siempre.
            let repaired = chat_completion(ChatRequest {
                base_url,
                model,
                temperature: 0.3,
                messages: json_repair_messages(body_messages, &first),
                key,
            })
            .await?;
            parse_reply_content(&repaired).unwrap_or_else(|| (clean_reply(&repaired), Vec::new()))
        }
    };
    Ok((reply, actions))
}

/// El catálogo MCP viaja separado del contexto del proyecto para que el
/// límite breve de contexto nunca recorte los esquemas de herramientas.
///
/// Si el catálogo completo supera el presupuesto, se degrada **por herramienta**
/// (se incluyen las que entran y se avisa cuántas quedaron afuera). Antes se
/// descartaba entero y el modelo se quedaba sin ninguna herramienta, sin aviso.
fn pack_mcp_catalog(tools: &[Value]) -> Option<(String, usize)> {
    let mut parts: Vec<String> = Vec::new();
    let mut bytes = 2; // corchetes
    let mut omitted = 0usize;
    for tool in tools {
        let Ok(part) = serde_json::to_string(tool) else {
            omitted += 1;
            continue;
        };
        let separator = usize::from(!parts.is_empty());
        if bytes + part.len() + separator > MAX_ASSISTANT_MCP_CATALOG_BYTES {
            omitted += 1;
            continue;
        }
        bytes += part.len() + separator;
        parts.push(part);
    }
    if parts.is_empty() {
        None
    } else {
        Some((format!("[{}]", parts.join(",")), omitted))
    }
}

fn assistant_context(context: Option<&Value>) -> String {
    let Some(value) = context else {
        return "{}".to_owned();
    };

    let mcp_tools = value
        .get("mcpTools")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty());

    let brain = value
        .get("brain")
        .and_then(Value::as_str)
        .map(|brief| brief.chars().take(MAX_CONTEXT_CHARS).collect::<String>());

    let mut rest = value.clone();
    if let Some(map) = rest.as_object_mut() {
        map.remove("brain");
        map.remove("mcpTools");
    }
    let rest: String = rest.to_string().chars().take(MAX_CONTEXT_CHARS).collect();

    let mut sections = Vec::with_capacity(3);
    if let Some(tools) = mcp_tools {
        match pack_mcp_catalog(tools) {
            Some((catalog, omitted)) => {
                let mut section =
                    format!("CATALOGO_MCP_JSON (nombres, descripciones y JSON Schema):\n{catalog}");
                if omitted > 0 {
                    let total = tools.len();
                    let included = total - omitted;
                    section.push_str(&format!(
                        "\n[CATALOGO PARCIAL: se incluyeron {included} de {total} herramientas por el límite de {} KB. Las omitidas no están disponibles en este turno: no inventes su nombre ni su esquema; si el pedido depende de una, decí que no está disponible ahora.]",
                        MAX_ASSISTANT_MCP_CATALOG_BYTES / 1024
                    ));
                }
                sections.push(section);
            }
            None => sections.push(format!(
                "CATALOGO_MCP_JSON: ninguna de las {} herramientas entró en el presupuesto de {} KB; no hay herramientas disponibles en este turno.",
                tools.len(),
                MAX_ASSISTANT_MCP_CATALOG_BYTES / 1024
            )),
        }
    }
    if let Some(brief) = brain {
        sections.push(format!("CONTEXTO DEL CEREBRO DE EDICION:\n{brief}"));
    }
    sections.push(format!("CONTEXTO DEL PROYECTO:\n{rest}"));
    sections.join("\n\n")
}

#[tauri::command]
pub async fn assistant_chat(
    state: State<'_, AppState>,
    request: AssistantRequest,
) -> Result<AssistantReply, ProjectError> {
    let messages = clean_messages(&request.messages)?;
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" {
        return Ok(mock_reply(&messages, &provider.model));
    }
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor en Ajustes o usá el simulador",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de enviar el mensaje",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    // El catálogo de herramientas y sus esquemas se conserva separado del
    // resumen del proyecto: el límite de contexto breve no debe truncarlo.
    let context = assistant_context(request.context.as_ref());
    let (reply, actions) = call_provider(
        &provider.base_url,
        &provider.model,
        &context,
        &messages,
        key,
    )
    .await?;
    let action = actions.first().cloned();
    Ok(AssistantReply {
        reply,
        action,
        actions,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        simulated: false,
    })
}

// ---------------------------------------------------------------------------
// Streaming del asistente (SSE) con cancelación
//
// Mismo contrato/validaciones que `assistant_chat`, pero la respuesta viaja
// como Server-Sent Events y se emite por eventos de Tauri para que la UI la
// pinte en vivo y pueda detenerla. Si el endpoint no es SSE, la UI cae al
// comando no-streaming de siempre.
// ---------------------------------------------------------------------------

const STREAM_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_STREAM_ID_CHARS: usize = 80;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStreamRequest {
    pub messages: Vec<AssistantMessage>,
    #[serde(default)]
    pub context: Option<Value>,
    #[serde(default)]
    pub approved_cost: bool,
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamDeltaEvent {
    stream_id: String,
    delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamCompletedEvent {
    stream_id: String,
    reply: String,
    action: Option<Value>,
    actions: Vec<Value>,
    provider_id: String,
    model: String,
    simulated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamFailedEvent {
    stream_id: String,
    message: String,
    /// El fallo ocurrió antes de cualquier delta: la UI puede reintentar con el
    /// camino no-streaming sin duplicar texto en pantalla.
    retryable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StreamCancelledEvent {
    stream_id: String,
}

fn active_streams() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clean_stream_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_STREAM_ID_CHARS {
        return None;
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':'))
    {
        return None;
    }
    Some(trimmed.to_owned())
}

/// Entrada en el registro de cancelación; se limpia sola al terminar (incluso
/// si la task entra en pánico).
struct StreamRegistration {
    stream_id: String,
}

impl StreamRegistration {
    fn new(stream_id: &str) -> Self {
        if let Ok(mut map) = active_streams().lock() {
            map.insert(stream_id.to_owned(), Arc::new(AtomicBool::new(false)));
        }
        Self {
            stream_id: stream_id.to_owned(),
        }
    }

    fn cancel_flag(&self) -> Arc<AtomicBool> {
        active_streams()
            .lock()
            .ok()
            .and_then(|map| map.get(&self.stream_id).cloned())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)))
    }
}

impl Drop for StreamRegistration {
    fn drop(&mut self) {
        if let Ok(mut map) = active_streams().lock() {
            map.remove(&self.stream_id);
        }
    }
}

/// Detiene un streaming en curso. Devuelve `false` si ya terminó o el id no es
/// válido (la UI no necesita tratarlo como error).
#[tauri::command]
pub fn cancel_assistant_stream(stream_id: String) -> bool {
    let Some(stream_id) = clean_stream_id(&stream_id) else {
        return false;
    };
    if let Ok(map) = active_streams().lock() {
        if let Some(flag) = map.get(&stream_id) {
            flag.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

/// Parser SSE incremental: el cuerpo llega en chunks arbitrarios, así que sólo
/// se procesan las líneas completas y el resto queda para el próximo chunk.
#[derive(Debug, Default)]
struct SseStreamParser {
    buffer: String,
    done: bool,
}

impl SseStreamParser {
    fn push_chunk(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.push_str(&String::from_utf8_lossy(chunk));
        let mut deltas = Vec::new();
        while let Some(index) = self.buffer.find('\n') {
            let line = self.buffer[..index].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=index);
            if let Some(delta) = self.consume_line(&line) {
                deltas.push(delta);
            }
            if self.done {
                break;
            }
        }
        deltas
    }

    fn finish(&mut self) -> Vec<String> {
        let rest = self.buffer.trim().to_owned();
        self.buffer.clear();
        self.consume_line(&rest).into_iter().collect()
    }

    fn consume_line(&mut self, line: &str) -> Option<String> {
        let line = line.trim();
        // Comentarios/keep-alive (": ping"), `event:` y líneas vacías.
        if line.is_empty() || line.starts_with(':') {
            return None;
        }
        let payload = line.strip_prefix("data:")?.trim();
        if payload == "[DONE]" {
            self.done = true;
            return None;
        }
        let value: Value = serde_json::from_str(payload).ok()?;
        let choice = &value["choices"][0];
        let content = choice["delta"]["content"]
            .as_str()
            .or_else(|| choice["message"]["content"].as_str())?;
        if content.is_empty() {
            return None;
        }
        Some(content.to_owned())
    }
}

/// Consume una respuesta SSE completa. Devuelve el contenido acumulado y si se
/// cortó por pedido del usuario. `on_delta` permite emitir cada fragmento.
fn consume_sse_stream<R: Read>(
    reader: &mut R,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str),
) -> Result<(String, bool), String> {
    let mut parser = SseStreamParser::default();
    let mut content = String::new();
    let mut buffer = [0u8; 8 * 1024];
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok((content, true));
        }
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                for delta in parser.push_chunk(&buffer[..read]) {
                    content.push_str(&delta);
                    on_delta(&delta);
                }
                if parser.done {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err("se cortó la conexión con el proveedor".to_owned()),
        }
    }
    for delta in parser.finish() {
        content.push_str(&delta);
        on_delta(&delta);
    }
    Ok((content, cancel.load(Ordering::SeqCst)))
}

/// Mismo criterio que `providers::should_retry_without_json_mode`: sólo se
/// reintenta sin `response_format` cuando el rechazo es por el parámetro.
fn retry_without_json_mode(status: u16) -> bool {
    matches!(status, 400 | 415 | 422)
}

/// Cuerpo de la petición de streaming (OpenAI-compatible).
fn stream_request_body(model: &str, messages: &[Value], json_mode: bool) -> Value {
    let mut body = json!({
        "model": model,
        "temperature": 0.3,
        "stream": true,
        "messages": messages,
    });
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    body
}

fn emit_stream_failed(app: &AppHandle, stream_id: &str, message: &str, retryable: bool) {
    let _ = app.emit(
        "assistant-stream-failed",
        StreamFailedEvent {
            stream_id: stream_id.to_owned(),
            message: message.to_owned(),
            retryable,
        },
    );
}

/// Trabajo de streaming: corre en un hilo propio porque la respuesta HTTP se
/// lee con `std::io::Read` (reqwest blocking, ya habilitado) sin sumar crates.
fn run_stream_worker(
    app: AppHandle,
    registration: StreamRegistration,
    base_url: String,
    model: String,
    messages: Vec<Value>,
    key: Option<String>,
) {
    let stream_id = registration.stream_id.clone();
    let cancel = registration.cancel_flag();
    if cancel.load(Ordering::SeqCst) {
        let _ = app.emit(
            "assistant-stream-cancelled",
            StreamCancelledEvent {
                stream_id: stream_id.clone(),
            },
        );
        return;
    }
    let client = match reqwest::blocking::Client::builder()
        .timeout(STREAM_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            emit_stream_failed(&app, &stream_id, "no se pudo preparar la conexión", false);
            return;
        }
    };
    for attempt in 1..=2u8 {
        let json_mode = attempt == 1;
        let body = stream_request_body(&model, &messages, json_mode);
        let mut call = client
            .post(chat_endpoint(&base_url))
            .json(&body)
            .header("Accept", "text/event-stream");
        if let Some(secret) = key.as_deref() {
            call = call.bearer_auth(secret);
        }
        let response = match call.send() {
            Ok(response) => response,
            Err(error) => {
                let message = if error.is_timeout() {
                    format!(
                        "el proveedor no respondió en {} segundos",
                        STREAM_TIMEOUT.as_secs()
                    )
                } else if error.is_connect() {
                    "no se pudo conectar con el proveedor; revisá que Ollama/servicio esté encendido"
                        .to_owned()
                } else {
                    "la conexión con el proveedor falló".to_owned()
                };
                emit_stream_failed(&app, &stream_id, &message, true);
                return;
            }
        };
        let status = response.status();
        if json_mode && retry_without_json_mode(status.as_u16()) {
            continue;
        }
        if !status.is_success() {
            emit_stream_failed(
                &app,
                &stream_id,
                &format!(
                    "el proveedor rechazó el mensaje (HTTP {})",
                    status.as_u16()
                ),
                false,
            );
            return;
        }
        let is_sse = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.contains("text/event-stream"))
            .unwrap_or(false);
        if !is_sse {
            // Algunos endpoints ignoran `stream:true`; la UI reintenta sin
            // streaming en vez de mostrar un error definitivo.
            emit_stream_failed(
                &app,
                &stream_id,
                "el proveedor no devolvió un stream SSE interpretable",
                true,
            );
            return;
        }
        let mut response = response;
        let outcome = consume_sse_stream(&mut response, &cancel, |delta| {
            let _ = app.emit(
                "assistant-stream-delta",
                StreamDeltaEvent {
                    stream_id: stream_id.clone(),
                    delta: delta.to_owned(),
                },
            );
        });
        match outcome {
            Ok((_content, true)) => {
                let _ = app.emit(
                    "assistant-stream-cancelled",
                    StreamCancelledEvent {
                        stream_id: stream_id.clone(),
                    },
                );
            }
            Ok((content, false)) => {
                let (reply, actions) = parse_reply_content(&content)
                    .unwrap_or_else(|| (clean_reply(&content), Vec::new()));
                let action = actions.first().cloned();
                let _ = app.emit(
                    "assistant-stream-completed",
                    StreamCompletedEvent {
                        stream_id: stream_id.clone(),
                        reply,
                        action,
                        actions,
                        provider_id: "openai-compatible".to_owned(),
                        model: model.clone(),
                        simulated: false,
                    },
                );
            }
            Err(message) => emit_stream_failed(&app, &stream_id, &message, false),
        }
        return;
    }
}

/// Streaming del asistente. Devuelve en cuanto el trabajo quedó encolado; los
/// deltas y el cierre llegan por los eventos `assistant-stream-*`. Mismas
/// validaciones que `assistant_chat`; el proveedor simulado completa al instante.
#[tauri::command]
pub async fn assistant_chat_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AssistantStreamRequest,
) -> Result<(), ProjectError> {
    let Some(stream_id) = clean_stream_id(&request.stream_id) else {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el identificador de streaming no es válido",
        ));
    };
    let messages = clean_messages(&request.messages)?;
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" {
        let reply = mock_reply(&messages, &provider.model);
        let _ = app.emit(
            "assistant-stream-completed",
            StreamCompletedEvent {
                stream_id,
                reply: reply.reply,
                action: reply.action,
                actions: reply.actions,
                provider_id: reply.provider_id,
                model: reply.model,
                simulated: true,
            },
        );
        return Ok(());
    }
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor en Ajustes o usá el simulador",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de enviar el mensaje",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let context = assistant_context(request.context.as_ref());
    let body_messages = assistant_body_messages(&context, &messages);
    let registration = StreamRegistration::new(&stream_id);
    let base_url = provider.base_url.clone();
    let model = provider.model.clone();
    std::thread::spawn(move || {
        run_stream_worker(app, registration, base_url, model, body_messages, key);
    });
    Ok(())
}

const MAX_MATCH_SENTENCES: usize = 300;
const MAX_MATCH_IMAGES: usize = 300;
const MAX_MATCH_TEXT_CHARS: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchMediaRequest {
    sentences: Vec<String>,
    images: Vec<String>,
    /// Descripción medida del contenido de cada imagen (`analyze_images`).
    /// Sin esto el modelo sólo ve el nombre del archivo y adivina.
    #[serde(default)]
    image_descriptions: Vec<String>,
    approved_cost: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchMediaReply {
    assignments: Vec<usize>,
    model: String,
}

fn validate_assignments(
    value: &Value,
    sentences: usize,
    images: usize,
) -> Result<Vec<usize>, ProjectError> {
    let list = value
        .get("assignments")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la IA no devolvió assignments",
            )
        })?;
    if list.len() != sentences {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la IA devolvió una cantidad de asignaciones distinta de las frases",
        ));
    }
    let mut assignments = Vec::with_capacity(sentences);
    for item in list {
        let index = item.as_u64().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la IA devolvió un índice que no es un entero",
            )
        })? as usize;
        if index >= images {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la IA devolvió un índice de imagen fuera de rango",
            ));
        }
        assignments.push(index);
    }
    Ok(assignments)
}

/// Empareja frases de la narración con imágenes usando el proveedor configurado.
/// El frontend valida de nuevo y cae al orden de archivos si esto falla.
#[tauri::command]
pub async fn match_media_plan(
    state: State<'_, AppState>,
    request: MatchMediaRequest,
) -> Result<MatchMediaReply, ProjectError> {
    if request.sentences.is_empty() || request.images.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "faltan frases o imágenes para emparejar",
        ));
    }
    if request.sentences.len() > MAX_MATCH_SENTENCES || request.images.len() > MAX_MATCH_IMAGES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "hay demasiadas frases o imágenes para emparejar en una sola llamada",
        ));
    }
    let sentences: Vec<String> = request
        .sentences
        .iter()
        .map(|text| -> String { text.trim().chars().take(MAX_MATCH_TEXT_CHARS).collect() })
        .filter(|text| !text.is_empty())
        .collect();
    let images: Vec<String> = request
        .images
        .iter()
        .map(|label| -> String { label.trim().chars().take(200).collect() })
        .collect();
    if sentences.len() != request.sentences.len() || images.iter().any(String::is_empty) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "hay frases vacías o imágenes sin nombre",
        ));
    }
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" || provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor real para emparejar la narración",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que la IA puede consumir cuota antes de emparejar",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let system = concat!(
        "Sos el director de edición de Olyvia. Recibís frases de una narración y una lista ",
        "de imágenes. De cada imagen tenés el nombre y, cuando está disponible, una ",
        "descripción medida de su contenido (luz, color, encuadre, si hay personas). ",
        "Asigná a cada frase el índice de la imagen que mejor la represente; podés ",
        "repetir imágenes, pero no pongas dos veces seguidas la misma si hay alternativa. ",
        "Guiate por lo que muestra la imagen, no por cómo se llama el archivo. ",
        "Devolvés SOLO JSON válido: {\"assignments\":[entero,...]} con exactamente una ",
        "entrada por frase y valores entre 0 y (cantidad de imágenes - 1). ",
        "Sin markdown ni explicaciones."
    );
    let mut user = String::from("FRASES:\n");
    for (index, sentence) in sentences.iter().enumerate() {
        user.push_str(&format!("{}. {}\n", index + 1, sentence));
    }
    user.push_str("\nIMÁGENES:\n");
    let described = request.image_descriptions.len() == images.len();
    for (index, image) in images.iter().enumerate() {
        match request
            .image_descriptions
            .get(index)
            .map(|text| text.trim())
            .filter(|text| !text.is_empty() && described)
        {
            Some(description) => {
                let trimmed: String = description.chars().take(240).collect();
                user.push_str(&format!("{index}. {image} — {trimmed}\n"));
            }
            None => user.push_str(&format!("{index}. {image}\n")),
        }
    }
    let body = json!({
        "model": provider.model.clone(),
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let mut call = client
        .post(chat_endpoint(&provider.base_url))
        .json(&body)
        .header("Accept", "application/json");
    if let Some(secret) = key {
        call = call.bearer_auth(secret);
    }
    let response = call.send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            "la IA no respondió en 120 segundos"
        } else if error.is_connect() {
            "no se pudo conectar con la IA configurada"
        } else {
            "la llamada a la IA falló"
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, safe)
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "la IA rechazó el emparejamiento (HTTP {})",
                response.status().as_u16()
            ),
        ));
    }
    let payload: Value = response.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la IA no devolvió JSON legible",
        )
    })?;
    let content = payload["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta no trae choices[0].message.content",
            )
        })?;
    let json_text = extract_json(content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la IA no devolvió un objeto JSON",
        )
    })?;
    let value: Value = serde_json::from_str(json_text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el JSON de la IA no se pudo leer",
        )
    })?;
    let assignments = validate_assignments(&value, sentences.len(), images.len())?;
    Ok(MatchMediaReply {
        assignments,
        model: provider.model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_navigation_and_motion_actions() {
        assert_eq!(
            clean_action(Some(&json!({ "kind": "navigate", "view": "editor" }))),
            Some(json!({ "kind": "navigate", "view": "editor" }))
        );
        assert!(clean_action(Some(&json!({ "kind": "navigate", "view": "ovnis" }))).is_none());
        let motion = clean_action(Some(&json!({
            "kind": "motion",
            "templateId": "lower-third",
            "text": "Ana",
            "secondary": "Editora"
        })))
        .expect("motion válido");
        assert_eq!(motion["templateId"], "lower-third");
        assert_eq!(motion["text"], "Ana");
        assert!(clean_action(Some(&json!({ "kind": "delete_everything" }))).is_none());
    }

    #[test]
    fn editing_actions_validate_their_bounds() {
        assert_eq!(
            clean_action(Some(
                &json!({ "kind": "new_project", "name": "  Reel de mayo  " })
            )),
            Some(json!({ "kind": "new_project", "name": "Reel de mayo" }))
        );
        assert!(clean_action(Some(&json!({ "kind": "new_project", "name": "   " }))).is_none());

        assert_eq!(
            clean_action(Some(&json!({
                "kind": "import_file",
                "path": "C:\\Videos\\clip.mp4"
            }))),
            Some(json!({ "kind": "import_file", "path": "C:\\Videos\\clip.mp4" }))
        );
        // Sin ruta absoluta no pasa: el operador no adivina.
        assert!(clean_action(Some(&json!({
            "kind": "import_file",
            "path": "media/clip.mp4"
        })))
        .is_none());
        assert!(clean_action(Some(&json!({ "kind": "import_file" }))).is_none());

        assert_eq!(
            clean_action(Some(&json!({
                "kind": "download_url",
                "url": "https://youtu.be/x"
            }))),
            Some(json!({ "kind": "download_url", "url": "https://youtu.be/x" }))
        );
        assert!(clean_action(Some(&json!({
            "kind": "download_url",
            "url": "ftp://youtu.be/x"
        })))
        .is_none());

        assert_eq!(
            clean_action(Some(&json!({
                "kind": "add_clip",
                "asset": " b-roll ",
                "atPlayhead": true
            }))),
            Some(json!({ "kind": "add_clip", "asset": "b-roll", "atPlayhead": true }))
        );
        assert!(clean_action(Some(&json!({ "kind": "add_clip", "asset": "" }))).is_none());

        assert_eq!(
            clean_action(Some(&json!({ "kind": "goto", "seconds": 90.5 }))),
            Some(json!({ "kind": "goto", "seconds": 90.5 }))
        );
        assert!(clean_action(Some(&json!({ "kind": "goto", "seconds": -1 }))).is_none());
        assert!(clean_action(Some(&json!({ "kind": "goto", "seconds": 99_999 }))).is_none());

        let caption = clean_action(Some(&json!({
            "kind": "add_caption",
            "text": "Hola",
            "seconds": 0.1
        })))
        .expect("subtítulo válido");
        assert_eq!(
            caption["seconds"], 3.0,
            "un subtítulo de 0,1 s se lleva al mínimo"
        );

        assert_eq!(
            clean_action(Some(&json!({ "kind": "set_speed", "speed": 2 }))),
            Some(json!({ "kind": "set_speed", "speed": 2.0 }))
        );
        assert!(clean_action(Some(&json!({ "kind": "set_speed", "speed": 40 }))).is_none());

        assert_eq!(
            clean_action(Some(&json!({ "kind": "set_gain", "db": -6 }))),
            Some(json!({ "kind": "set_gain", "db": -6.0 }))
        );
        assert!(clean_action(Some(&json!({ "kind": "set_gain", "db": 0 }))).is_none());
        assert!(clean_action(Some(&json!({ "kind": "set_gain", "db": 99 }))).is_none());

        assert_eq!(
            clean_action(Some(&json!({ "kind": "mute_clip", "muted": true }))),
            Some(json!({ "kind": "mute_clip", "muted": true }))
        );
        assert!(clean_action(Some(&json!({ "kind": "mute_clip" }))).is_none());

        assert_eq!(
            clean_action(Some(&json!({
                "kind": "cut_silences",
                "scope": "project",
                "thresholdDb": -40,
                "minSilenceSeconds": 0.5,
                "paddingSeconds": 0.1
            }))),
            Some(json!({
                "kind": "cut_silences",
                "thresholdDb": -40.0,
                "minSilenceSeconds": 0.5,
                "paddingSeconds": 0.1,
                "scope": "project"
            }))
        );
        assert_eq!(
            clean_action(Some(&json!({ "kind": "cut_silences" }))),
            Some(json!({
                "kind": "cut_silences",
                "thresholdDb": -45.0,
                "minSilenceSeconds": 0.35,
                "paddingSeconds": 0.15,
                "scope": "selection"
            }))
        );
        // Un umbral imposible o un alcance desconocido caen a los valores por
        // defecto: el corte sigue siendo útil y acotado por la guardia del 80 %.
        assert_eq!(
            clean_action(Some(
                &json!({ "kind": "cut_silences", "thresholdDb": 5, "scope": "otro" })
            ))
            .unwrap()["thresholdDb"],
            json!(-45.0)
        );
        assert_eq!(
            clean_action(Some(&json!({ "kind": "cut_silences", "scope": "otro" }))).unwrap()
                ["scope"],
            json!("selection")
        );

        assert_eq!(
            clean_action(Some(
                &json!({ "kind": "auto_subtitles", "scope": "project" })
            )),
            Some(json!({ "kind": "auto_subtitles", "scope": "project" }))
        );
        assert_eq!(
            clean_action(Some(&json!({ "kind": "auto_subtitles" }))).unwrap()["scope"],
            json!("selection")
        );

        assert_eq!(
            clean_action(Some(&json!({
                "kind": "cut_voice_pauses",
                "scope": "project",
                "minPauseSeconds": 0.6,
                "paddingSeconds": 0.1
            }))),
            Some(json!({
                "kind": "cut_voice_pauses",
                "minPauseSeconds": 0.6,
                "paddingSeconds": 0.1,
                "scope": "project"
            }))
        );
        assert_eq!(
            clean_action(Some(&json!({ "kind": "cut_voice_pauses" }))).unwrap(),
            json!({
                "kind": "cut_voice_pauses",
                "minPauseSeconds": 0.35,
                "paddingSeconds": 0.08,
                "scope": "selection"
            })
        );

        assert_eq!(
            clean_action(Some(&json!({
                "kind": "auto_cleanup",
                "denoise": "strong",
                "zoomCuts": false,
                "targetLufs": -16
            }))),
            Some(json!({
                "kind": "auto_cleanup",
                "denoise": "strong",
                "levelAudio": true,
                "zoomCuts": false,
                "cutSilences": true,
                "cutPauses": true,
                "targetLufs": -16.0
            }))
        );
        assert_eq!(
            clean_action(Some(&json!({ "kind": "auto_cleanup" }))).unwrap()["denoise"],
            json!("medium")
        );

        assert_eq!(
            clean_action(Some(&json!({ "kind": "auto_pilot" }))),
            Some(json!({ "kind": "auto_pilot" }))
        );
        assert_eq!(
            clean_action(Some(&json!({ "kind": "auto_pilot" }))),
            Some(json!({ "kind": "auto_pilot" }))
        );

        assert_eq!(
            clean_action(Some(&json!({ "kind": "split_at_playhead" }))),
            Some(json!({ "kind": "split_at_playhead" }))
        );
        assert_eq!(
            clean_action(Some(&json!({ "kind": "delete_selected" }))),
            Some(json!({ "kind": "delete_selected" }))
        );
    }

    #[test]
    fn navigation_accepts_the_full_surface_of_the_app() {
        for view in [
            "sharpen",
            "lab",
            "creator",
            "mixer",
            "text-edit",
            "auto-edit",
        ] {
            assert_eq!(
                clean_action(Some(&json!({ "kind": "navigate", "view": view }))),
                Some(json!({ "kind": "navigate", "view": view }))
            );
        }
    }

    #[test]
    fn match_assignments_validate_count_and_range() {
        assert_eq!(
            validate_assignments(&json!({ "assignments": [0, 2, 2] }), 3, 3).unwrap(),
            vec![0, 2, 2]
        );
        assert!(validate_assignments(&json!({ "assignments": [0, 1] }), 3, 3).is_err());
        assert!(validate_assignments(&json!({ "assignments": [0, 3, 1] }), 3, 3).is_err());
        assert!(validate_assignments(&json!({ "assignments": [0, "1", 1] }), 3, 3).is_err());
        assert!(validate_assignments(&json!({ "nope": [] }), 3, 3).is_err());
    }

    #[test]
    fn media_folder_action_only_accepts_a_folder_name() {
        assert_eq!(
            clean_action(Some(
                &json!({ "kind": "media_folder", "folder": " video 1 " })
            )),
            Some(json!({ "kind": "media_folder", "folder": "video 1" }))
        );
        assert!(clean_action(Some(&json!({
            "kind": "media_folder",
            "folder": "..\\Windows"
        })))
        .is_none());
        assert!(clean_action(Some(&json!({
            "kind": "media_folder",
            "folder": "C:\\Users\\tester\\Downloads"
        })))
        .is_none());
        assert!(clean_action(Some(&json!({ "kind": "media_folder", "folder": "" }))).is_none());
    }

    #[test]
    fn sanitizes_ordered_multi_action_plans_and_keeps_legacy_action() {
        let legacy = clean_actions(&json!({
            "action": { "kind": "navigate", "view": "editor" }
        }));
        assert_eq!(
            legacy,
            vec![json!({ "kind": "navigate", "view": "editor" })]
        );

        let actions = clean_actions(&json!({
            "actions": [
                { "kind": "navigate", "view": "editor" },
                { "kind": "navigate", "view": "motion" },
                { "kind": "unknown" },
                { "kind": "navigate", "view": "motion" },
                { "kind": "save" },
                { "kind": "undo" },
                { "kind": "redo" },
                { "kind": "export" }
            ],
            "action": { "kind": "pause" }
        }));
        assert_eq!(actions.len(), 5);
        assert_eq!(actions[0], json!({ "kind": "navigate", "view": "editor" }));
        assert_eq!(actions[1], json!({ "kind": "navigate", "view": "motion" }));
        assert_eq!(actions[2], json!({ "kind": "save" }));
        assert_eq!(actions[3], json!({ "kind": "undo" }));
        assert_eq!(actions[4], json!({ "kind": "redo" }));
        assert!(!actions.contains(&json!({ "kind": "pause" })));
    }

    #[test]
    fn assistant_context_preserves_catalog_separately_from_project_limit() {
        let context = json!({
            "view": "editor",
            "brain": "CEREBRO DE EDICION",
            "mcpTools": [{
                "name": "app_status",
                "description": "Estado de la app",
                "inputSchema": { "type": "object", "properties": {} },
                "annotations": { "readOnly": true }
            }],
            "largeProjectField": "x".repeat(MAX_CONTEXT_CHARS + 1_000)
        });
        let packed = assistant_context(Some(&context));
        assert!(packed.contains("CATALOGO_MCP_JSON"));
        assert!(packed.contains("app_status"));
        assert!(packed.contains("inputSchema"));
        assert!(packed.contains("CEREBRO DE EDICION"));
        assert!(packed.contains("CONTEXTO DEL PROYECTO"));
        assert!(!packed.contains("mcpTools\\\":"));
        assert!(!packed.contains("CATALOGO PARCIAL"));
    }

    #[test]
    fn assistant_context_degrades_the_catalog_by_tool_instead_of_dropping_it() {
        let small_tool = |name: &str| {
            json!({
                "name": name,
                "description": "x".repeat(1_000),
                "inputSchema": { "type": "object", "properties": {} }
            })
        };
        let context = json!({
            "mcpTools": [
                small_tool("app_status"),
                small_tool("media_probe"),
                {
                    "name": "oversized",
                    "schema": "y".repeat(MAX_ASSISTANT_MCP_CATALOG_BYTES)
                }
            ]
        });
        let packed = assistant_context(Some(&context));
        // Las herramientas chicas se conservan; sólo la gigante queda afuera y
        // el modelo recibe un aviso explícito de que el catálogo es parcial.
        assert!(packed.contains("CATALOGO_MCP_JSON"), "{packed}");
        assert!(packed.contains("app_status"));
        assert!(packed.contains("media_probe"));
        assert!(!packed.contains("oversized"));
        assert!(packed.contains("CATALOGO PARCIAL"), "{packed}");
        assert!(packed.contains("2 de 3"), "{packed}");
    }

    #[test]
    fn assistant_context_warns_when_no_tool_fits_the_budget() {
        let context = json!({
            "mcpTools": [{
                "name": "oversized",
                "schema": "x".repeat(MAX_ASSISTANT_MCP_CATALOG_BYTES)
            }]
        });
        let packed = assistant_context(Some(&context));
        assert!(
            !packed.contains("(nombres, descripciones y JSON Schema)"),
            "{packed}"
        );
        assert!(packed.contains("ninguna de las 1 herramientas"), "{packed}");
    }

    #[test]
    fn mcp_action_requires_a_bounded_tool_name_and_object_arguments() {
        assert_eq!(
            clean_action(Some(&json!({
                "kind": "mcp_call",
                "tool": "app_status",
                "arguments": {}
            }))),
            Some(json!({
                "kind": "mcp_call",
                "tool": "app_status",
                "arguments": {}
            }))
        );
        assert!(clean_action(Some(&json!({
            "kind": "mcp_call",
            "tool": "",
            "arguments": {}
        })))
        .is_none());
        assert!(clean_action(Some(&json!({
            "kind": "mcp_call",
            "tool": "app_status",
            "arguments": []
        })))
        .is_none());

        let oversized = json!({
            "kind": "mcp_call",
            "tool": "settings_set",
            "arguments": { "payload": "x".repeat(MAX_ASSISTANT_MCP_ARGS_BYTES) }
        });
        assert!(clean_action(Some(&oversized)).is_none());

        let many_fields = (0..=MAX_ASSISTANT_MCP_ARG_FIELDS)
            .map(|index| (format!("key_{index}"), json!(index)))
            .collect::<serde_json::Map<String, Value>>();
        assert!(clean_action(Some(&json!({
            "kind": "mcp_call",
            "tool": "settings_set",
            "arguments": Value::Object(many_fields)
        })))
        .is_none());
    }

    #[test]
    fn mock_mode_returns_a_navigation_action() {
        let reply = mock_reply(
            &[AssistantMessage {
                role: "user".to_owned(),
                content: "abrí el editor".to_owned(),
            }],
            "mock",
        );
        assert!(reply.simulated);
        assert_eq!(reply.action.unwrap()["view"], "editor");
    }

    #[test]
    fn rejects_empty_conversations() {
        let error = clean_messages(&[]).expect_err("debe rechazar");
        assert_eq!(error.code, ProjectErrorCode::InvalidProject);
    }

    /// Ronda real contra el proveedor local configurado (por defecto Ollama
    /// qwen2.5:3b en 127.0.0.1:11435). Requiere `EDITOR_IA_RUN_RENDER_TESTS=1`
    /// y el servicio encendido; mide latencia y verifica que la respuesta
    /// llegue por el mismo camino que usa el comando.
    #[test]
    #[ignore = "llamada real al proveedor; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_local_provider_round_trip_answers_the_assistant() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la llamada real");
            return;
        }
        let base_url = std::env::var("EDITOR_IA_ASSISTANT_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:11435/v1".to_owned());
        let model =
            std::env::var("EDITOR_IA_ASSISTANT_MODEL").unwrap_or_else(|_| "qwen2.5:3b".to_owned());
        let messages = vec![AssistantMessage {
            role: "user".to_owned(),
            content: "En una frase: ¿qué podés hacer por mí en la app?".to_owned(),
        }];

        let started = std::time::Instant::now();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime de tokio");
        let (reply, actions) = runtime
            .block_on(call_provider(&base_url, &model, "{}", &messages, None))
            .expect("el proveedor local debe responder");
        let elapsed = started.elapsed();

        eprintln!("ronda real {model} en {elapsed:.1?}: “{reply}” (actions={actions:?})");
        assert!(!reply.trim().is_empty(), "la respuesta quedó vacía");
        assert_ne!(
            reply, "Listo. ¿Qué querés hacer ahora?",
            "la respuesta cayó al texto de fallback: el proveedor no contestó contenido"
        );
    }

    // --- Streaming SSE -----------------------------------------------------

    #[test]
    fn stream_request_body_asks_for_sse_and_json_mode() {
        let messages = vec![json!({ "role": "user", "content": "hola" })];
        let with_json = stream_request_body("modelo", &messages, true);
        assert_eq!(with_json["stream"], true);
        assert_eq!(with_json["response_format"]["type"], "json_object");
        assert_eq!(with_json["messages"][0]["content"], "hola");

        let plain = stream_request_body("modelo", &messages, false);
        assert!(plain.get("response_format").is_none());
        assert_eq!(plain["stream"], true);
    }

    #[test]
    fn retry_without_json_mode_only_for_parameter_rejections() {
        for status in [400, 415, 422] {
            assert!(retry_without_json_mode(status), "{status}");
        }
        for status in [401, 403, 404, 429, 500, 503] {
            assert!(!retry_without_json_mode(status), "{status}");
        }
    }

    #[test]
    fn sse_parser_handles_incremental_chunks_and_done() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hola\"}}]}\n\n",
            ": keep-alive\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\" \"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"mundo\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let mut parser = SseStreamParser::default();
        let mut deltas = Vec::new();
        // Un byte por vez: el caso más hostil de chunks partidos.
        for byte in sse.as_bytes() {
            deltas.extend(parser.push_chunk(std::slice::from_ref(byte)));
        }
        assert_eq!(deltas, vec!["Hola", " ", "mundo"]);
        assert!(parser.done);
        assert!(parser.finish().is_empty());
    }

    #[test]
    fn sse_parser_ignores_empty_deltas_comments_and_crlf() {
        let sse = concat!(
            ": ping\r\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"\"}}]}\r\n",
            "data: {\"choices\":[{\"delta\":{}}]}\r\n",
            "event: message\r\n",
            "data: {\"choices\":[{\"message\":{\"content\":\"final\"}}]}\r\n"
        );
        let mut parser = SseStreamParser::default();
        let deltas = parser.push_chunk(sse.as_bytes());
        assert_eq!(deltas, vec!["final"]);
        assert!(!parser.done);
    }

    #[test]
    fn sse_parser_finish_returns_the_last_line_without_newline() {
        let mut parser = SseStreamParser::default();
        assert!(parser
            .push_chunk(b"data: {\"choices\":[{\"delta\":{\"content\":\"parcial\"}}]}")
            .is_empty());
        assert_eq!(parser.finish(), vec!["parcial"]);
    }

    #[test]
    fn consume_sse_stream_accumulates_and_observes_cancellation() {
        let sse = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"uno\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"dos\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let cancel = AtomicBool::new(false);
        let mut reader = std::io::Cursor::new(sse.as_bytes().to_vec());
        let mut seen: Vec<String> = Vec::new();
        let (content, cancelled) =
            consume_sse_stream(&mut reader, &cancel, |delta| seen.push(delta.to_owned()))
                .expect("stream válido");
        assert_eq!(content, "unodos");
        assert_eq!(seen, vec!["uno", "dos"]);
        assert!(!cancelled);

        // Cancelado de antemano: no consume nada y avisa que fue cancelación.
        let cancel = AtomicBool::new(true);
        let mut reader = std::io::Cursor::new(sse.as_bytes().to_vec());
        let (content, cancelled) =
            consume_sse_stream(&mut reader, &cancel, |_| {}).expect("cancelación");
        assert!(content.is_empty());
        assert!(cancelled);
    }

    #[test]
    fn stream_registry_cancels_and_cleans_up() {
        let registration = StreamRegistration::new("stream-test-1");
        assert!(cancel_assistant_stream("stream-test-1".to_owned()));
        assert!(registration.cancel_flag().load(Ordering::SeqCst));
        drop(registration);
        // Al terminar el trabajo el registro se limpia: cancelar ya no encuentra nada.
        assert!(!cancel_assistant_stream("stream-test-1".to_owned()));
        assert!(!cancel_assistant_stream("id con espacios".to_owned()));
        assert_eq!(clean_stream_id(" abc-123_ok:1 ").as_deref(), Some("abc-123_ok:1"));
        assert!(clean_stream_id("").is_none());
        assert!(clean_stream_id("x".repeat(MAX_STREAM_ID_CHARS + 1).as_str()).is_none());
    }

    #[test]
    fn consumes_a_real_sse_response_from_a_local_server() {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("puerto de prueba");
        let address = listener.local_addr().expect("dirección");
        let server = std::thread::spawn(move || {
            let Ok((mut socket, _)) = listener.accept() else {
                return;
            };
            // Leer hasta el final de los headers antes de responder.
            let mut received = Vec::new();
            let mut chunk = [0u8; 1024];
            while !received.windows(4).any(|window| window == b"\r\n\r\n") {
                match socket.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => received.extend_from_slice(&chunk[..read]),
                }
            }
            let body = concat!(
                "data: {\"choices\":[{\"delta\":{\"content\":\"Hola\"}}]}\n\n",
                "data: {\"choices\":[{\"delta\":{\"content\":\" SSE\"}}]}\n\n",
                "data: [DONE]\n\n"
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = socket.write_all(response.as_bytes());
        });
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("cliente de prueba");
        let response = client
            .get(format!("http://{address}/v1/chat/completions"))
            .send()
            .expect("el servidor local responde");
        assert_eq!(response.status().as_u16(), 200);
        let mut response = response;
        let cancel = AtomicBool::new(false);
        let mut seen: Vec<String> = Vec::new();
        let (content, cancelled) =
            consume_sse_stream(&mut response, &cancel, |delta| seen.push(delta.to_owned()))
                .expect("SSE real");
        let _ = server.join();
        assert_eq!(content, "Hola SSE");
        assert_eq!(seen, vec!["Hola", " SSE"]);
        assert!(!cancelled);
    }
}
