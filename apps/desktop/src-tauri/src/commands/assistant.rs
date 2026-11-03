//! Floating Olyvia assistant.
//!
//! The provider only returns text plus a small, allowlisted action. The frontend
//! validates the action again and executes it through the same store/navigation
//! APIs as the UI. This module never mutates a project directly.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::commands::providers::{
    chat_endpoint, extract_json, is_local_endpoint, read_key, validate_provider_base_url,
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
    let system = concat!(
        "Sos Olyvia, la asistente del estudio de creación local Olyvia: un editor de ",
        "video con guion, medios, voz, motion graphics y exportación FFmpeg, 100% sin nube. ",
        "Respondé breve, claro y en español rioplatense; no inventes datos del proyecto. ",
        "Devolvés SOLO un objeto JSON válido, sin markdown: ",
        "{\"reply\": string, \"actions\"?: [object, ...]}. ",
        "Podés proponer entre 1 y 5 acciones ordenadas; se ejecutan en secuencia. ",
        "Usá varias sólo cuando el pedido requiera pasos dependientes; no repitas acciones. ",
        "El borrado siempre espera confirmación explícita. ",
        "El catálogo completo con nombres, descripciones y JSON Schema está en la sección ",
        "CATALOGO_MCP_JSON del contexto. Llamá una herramienta con ",
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
    let system = format!("{system}{context}");
    let mut body_messages = vec![json!({ "role": "system", "content": system })];
    for message in messages {
        body_messages.push(json!({ "role": message.role, "content": message.content }));
    }
    let body = json!({
        "model": model,
        "temperature": 0.3,
        "messages": body_messages
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
        .post(chat_endpoint(base_url))
        .json(&body)
        .header("Accept", "application/json");
    if let Some(secret) = key {
        call = call.bearer_auth(secret);
    }
    let response = call.send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            "el proveedor no respondió en 120 segundos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el proveedor; revisá que Ollama/servicio esté encendido"
                .to_owned()
        } else {
            "la llamada al proveedor falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó el mensaje (HTTP {})",
                response.status().as_u16()
            ),
        ));
    }
    let payload: Value = response.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor no devolvió JSON legible",
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
    let (reply, actions) = if let Some(json_text) = extract_json(content) {
        match serde_json::from_str::<Value>(json_text) {
            Ok(value) => (
                clean_reply(value.get("reply").and_then(Value::as_str).unwrap_or("")),
                clean_actions(&value),
            ),
            Err(_) => (clean_reply(content), Vec::new()),
        }
    } else {
        (clean_reply(content), Vec::new())
    };
    Ok((reply, actions))
}

/// El catálogo MCP viaja separado del contexto del proyecto para que el
/// límite breve de contexto nunca recorte los esquemas de herramientas.
fn assistant_context(context: Option<&Value>) -> String {
    let Some(value) = context else {
        return "{}".to_owned();
    };

    let mcp_catalog = value
        .get("mcpTools")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .and_then(|items| serde_json::to_string(items).ok())
        .filter(|serialized| serialized.len() <= MAX_ASSISTANT_MCP_CATALOG_BYTES);

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
    if let Some(catalog) = mcp_catalog {
        sections.push(format!(
            "CATALOGO_MCP_JSON (nombres, descripciones y JSON Schema):\n{catalog}"
        ));
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
            "folder": "C:\\Users\\ofici\\Downloads"
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
    }

    #[test]
    fn assistant_context_omits_catalog_if_it_exceeds_the_safe_budget() {
        let context = json!({
            "mcpTools": [{
                "name": "oversized",
                "schema": "x".repeat(MAX_ASSISTANT_MCP_CATALOG_BYTES)
            }]
        });
        let packed = assistant_context(Some(&context));
        assert!(!packed.contains("CATALOGO_MCP_JSON"));
        assert!(packed.contains("CONTEXTO DEL PROYECTO"));
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
}
