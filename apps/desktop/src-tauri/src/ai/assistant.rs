//! Asistente flotante Olyvia — dominio puro.
//!
//! Validación de mensajes y acciones permitidas (allowlist), contexto con
//! catálogo MCP acotado, prompt del sistema, parseo tolerante de la respuesta,
//! parser SSE incremental, registro de cancelación de streams y reglas de
//! emparejado media/frases. La orquestación vive en `application::assistant`;
//! keyring/settings/HTTP en `infrastructure::ai` + `ports::ai`.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ai::providers::{extract_json, should_retry_without_json_mode};
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_MESSAGES: usize = 16;
pub const MAX_MESSAGE_CHARS: usize = 4_000;
pub const MAX_CONTEXT_CHARS: usize = 3_000;
pub const MAX_REPLY_CHARS: usize = 2_000;
pub const MAX_ASSISTANT_ACTIONS: usize = 5;
pub const MAX_ASSISTANT_MCP_ARGS_BYTES: usize = 12 * 1024;
pub const MAX_ASSISTANT_MCP_CATALOG_BYTES: usize = 48 * 1024;
pub const MAX_ASSISTANT_MCP_ARG_FIELDS: usize = 48;

pub const VIEWS: [&str; 33] = [
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

pub fn clean_name(value: &Value, key: &str, max: usize) -> Option<String> {
    let raw = value.get(key)?.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    Some(raw.chars().take(max).collect())
}

pub fn clean_number(value: &Value, key: &str, min: f64, max: f64) -> Option<f64> {
    let raw = value.get(key)?.as_f64()?;
    if !raw.is_finite() || raw < min || raw > max {
        return None;
    }
    Some((raw * 1000.0).round() / 1000.0)
}

/// La ruta tiene que ser absoluta: el operador del asistente no adivina rutas
/// relativas porque importaría material del directorio de trabajo sin querer.
pub fn clean_absolute_path(value: &Value) -> Option<String> {
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

pub fn clean_url(value: &Value) -> Option<String> {
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

pub fn clean_messages(
    messages: &[AssistantMessage],
) -> Result<Vec<AssistantMessage>, ProjectError> {
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

pub fn clean_action(value: Option<&Value>) -> Option<Value> {
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
            let name = crate::media::folder::sanitize_media_folder_name(folder)?;
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
pub fn clean_actions(value: &Value) -> Vec<Value> {
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

pub fn clean_reply(value: &str) -> String {
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

pub fn mock_reply(messages: &[AssistantMessage], model: &str) -> AssistantReply {
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
pub fn assistant_system_prompt(context: &str) -> String {
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
        "disponibles. ",
        "Las marcas h del catalogo: r=solo lectura, d=destructiva, o=efecto externo; ",
        "se pueden combinar. Si falta una letra, no atribuyas esa condicion. ",
        "Llamá una herramienta con ",
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
pub fn assistant_body_messages(context: &str, messages: &[AssistantMessage]) -> Vec<Value> {
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
pub fn parse_reply_content(content: &str) -> Option<(String, Vec<Value>)> {
    let json_text = extract_json(content)?;
    let value: Value = serde_json::from_str(json_text).ok()?;
    Some((
        clean_reply(value.get("reply").and_then(Value::as_str).unwrap_or("")),
        clean_actions(&value),
    ))
}

// --- Contexto del proyecto y catálogo MCP -------------------------------

pub fn pack_mcp_catalog(tools: &[Value]) -> Option<(String, usize)> {
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

pub fn assistant_context(context: Option<&Value>) -> String {
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

// --- Emparejado narración ↔ imágenes -------------------------------------

pub const MAX_MATCH_SENTENCES: usize = 300;
pub const MAX_MATCH_IMAGES: usize = 300;
pub const MAX_MATCH_TEXT_CHARS: usize = 500;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchMediaRequest {
    pub sentences: Vec<String>,
    pub images: Vec<String>,
    /// Descripción medida del contenido de cada imagen (`analyze_images`).
    /// Sin esto el modelo sólo ve el nombre del archivo y adivina.
    #[serde(default)]
    pub image_descriptions: Vec<String>,
    pub approved_cost: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchMediaReply {
    pub assignments: Vec<usize>,
    pub model: String,
}

pub fn validate_assignments(
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

// --- Streaming SSE del asistente ------------------------------------------

pub const MAX_STREAM_ID_CHARS: usize = 80;

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
pub struct StreamDeltaEvent {
    pub stream_id: String,
    pub delta: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamCompletedEvent {
    pub stream_id: String,
    pub reply: String,
    pub action: Option<Value>,
    pub actions: Vec<Value>,
    pub provider_id: String,
    pub model: String,
    pub simulated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamFailedEvent {
    pub stream_id: String,
    pub message: String,
    /// El fallo ocurrió antes de cualquier delta: la UI puede reintentar con el
    /// camino no-streaming sin duplicar texto en pantalla.
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamCancelledEvent {
    pub stream_id: String,
}

pub fn active_streams() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn clean_stream_id(value: &str) -> Option<String> {
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
pub struct StreamRegistration {
    pub stream_id: String,
}

impl StreamRegistration {
    pub fn new(stream_id: &str) -> Self {
        if let Ok(mut map) = active_streams().lock() {
            map.insert(stream_id.to_owned(), Arc::new(AtomicBool::new(false)));
        }
        Self {
            stream_id: stream_id.to_owned(),
        }
    }

    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
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
/// Parser SSE incremental: el cuerpo llega en chunks arbitrarios, así que sólo
/// se procesan las líneas completas y el resto queda para el próximo chunk.
#[derive(Debug, Default)]
pub struct SseStreamParser {
    pub buffer: String,
    pub done: bool,
}

impl SseStreamParser {
    pub fn push_chunk(&mut self, chunk: &[u8]) -> Vec<String> {
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

    pub fn finish(&mut self) -> Vec<String> {
        let rest = self.buffer.trim().to_owned();
        self.buffer.clear();
        self.consume_line(&rest).into_iter().collect()
    }

    pub fn consume_line(&mut self, line: &str) -> Option<String> {
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
pub fn consume_sse_stream<R: Read>(
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
pub fn retry_without_json_mode(status: u16) -> bool {
    should_retry_without_json_mode(status)
}

/// Cuerpo de la petición de streaming (OpenAI-compatible).
pub fn stream_request_body(model: &str, messages: &[Value], json_mode: bool) -> Value {
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

// --- Prompt y limpieza del emparejado narración ↔ imágenes -----------------

/// System prompt del emparejado (directorz de edición).
pub const MATCH_SYSTEM_PROMPT: &str = concat!(
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

/// Frases e imágenes limpias según el contrato del comando: recorte por
/// caracteres, descarte de frases vacías y rechazo si los conteos no cierran.
pub fn clean_match_inputs(
    sentences: &[String],
    images: &[String],
) -> Result<(Vec<String>, Vec<String>), ProjectError> {
    let cleaned_sentences: Vec<String> = sentences
        .iter()
        .map(|text| -> String { text.trim().chars().take(MAX_MATCH_TEXT_CHARS).collect() })
        .filter(|text| !text.is_empty())
        .collect();
    let cleaned_images: Vec<String> = images
        .iter()
        .map(|label| -> String { label.trim().chars().take(200).collect() })
        .collect();
    if cleaned_sentences.len() != sentences.len() || cleaned_images.iter().any(String::is_empty) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "hay frases vacías o imágenes sin nombre",
        ));
    }
    Ok((cleaned_sentences, cleaned_images))
}

/// Prompt de usuario: frases numeradas + imágenes con descripción medida
/// cuando está disponible (una por imagen, mismo largo).
pub fn match_user_prompt(
    sentences: &[String],
    images: &[String],
    descriptions: &[String],
) -> String {
    let mut user = String::from("FRASES:\n");
    for (index, sentence) in sentences.iter().enumerate() {
        user.push_str(&format!("{}. {}\n", index + 1, sentence));
    }
    user.push_str("\nIMÁGENES:\n");
    let described = descriptions.len() == images.len();
    for (index, image) in images.iter().enumerate() {
        match descriptions
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
    user
}

#[cfg(test)]
#[path = "assistant.tests.rs"]
mod tests;
