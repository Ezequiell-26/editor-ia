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
const MAX_CONTEXT_CHARS: usize = 2_000;
const MAX_REPLY_CHARS: usize = 2_000;

const VIEWS: [&str; 24] = [
    "home",
    "projects",
    "script",
    "assets",
    "production",
    "editor",
    "download",
    "director",
    "factory",
    "compliance",
    "convert",
    "compare",
    "compress",
    "denoise",
    "thumbnails",
    "localization",
    "ai-hub",
    "motion",
    "visuals",
    "background",
    "upscale",
    "learn",
    "mcp",
    "settings",
];

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
    pub action: Option<Value>,
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
        "play" | "pause" | "save" | "export" | "status" | "undo" | "redo" => {
            Some(json!({ "kind": kind }))
        }
        _ => None,
    }
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
    AssistantReply {
        reply: reply.to_owned(),
        action,
        provider_id: "mock".to_owned(),
        model: model.to_owned(),
        simulated: true,
    }
}

/// Llamada real al proveedor OpenAI-compatible: arma el prompt del sistema,
/// envía el chat y devuelve `(reply, action)` ya saneados. Separada del
/// comando para poder medirla en una prueba live sin estado de Tauri.
async fn call_provider(
    base_url: &str,
    model: &str,
    context: &str,
    messages: &[AssistantMessage],
    key: Option<String>,
) -> Result<(String, Option<Value>), ProjectError> {
    let system = concat!(
        "Sos Olyvia, la asistente del estudio de creación local Olyvia: un editor de ",
        "video con guion, medios, voz, motion graphics y exportación FFmpeg, 100% sin nube. ",
        "Respondé breve, claro y en español rioplatense; no inventes datos del proyecto. ",
        "Devolvés SOLO un objeto JSON válido, sin markdown: ",
        "{\"reply\": string, \"action\"?: object}. ",
        "Acciones permitidas: {\"kind\":\"navigate\",\"view\":\"home|projects|script|assets|production|editor|download|director|factory|compliance|convert|compare|compress|denoise|thumbnails|localization|ai-hub|motion|visuals|background|upscale|learn|mcp|settings\"}, ",
        "{\"kind\":\"play\"}, {\"kind\":\"pause\"}, {\"kind\":\"save\"}, {\"kind\":\"export\"}, {\"kind\":\"status\"}, {\"kind\":\"undo\"}, {\"kind\":\"redo\"}, ",
        "o {\"kind\":\"motion\",\"templateId\":\"title-card|lower-third|end-card|stat-callout\",\"text\":string,\"secondary\"?:string}. ",
        "No propongas acciones destructivas ni inventes rutas. Si no hace falta una acción, omití action. ",
        "Contexto del proyecto: "
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
    let (reply, action) = if let Some(json_text) = extract_json(content) {
        match serde_json::from_str::<Value>(json_text) {
            Ok(value) => (
                clean_reply(value.get("reply").and_then(Value::as_str).unwrap_or("")),
                clean_action(value.get("action")),
            ),
            Err(_) => (clean_reply(content), None),
        }
    } else {
        (clean_reply(content), None)
    };
    Ok((reply, action))
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
    let context = request
        .context
        .as_ref()
        .map(|value| value.to_string())
        .map(|value| value.chars().take(MAX_CONTEXT_CHARS).collect::<String>())
        .unwrap_or_else(|| "{}".to_owned());
    let (reply, action) = call_provider(
        &provider.base_url,
        &provider.model,
        &context,
        &messages,
        key,
    )
    .await?;
    Ok(AssistantReply {
        reply,
        action,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        simulated: false,
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
        let (reply, action) = runtime
            .block_on(call_provider(&base_url, &model, "{}", &messages, None))
            .expect("el proveedor local debe responder");
        let elapsed = started.elapsed();

        eprintln!("ronda real {model} en {elapsed:.1?}: “{reply}” (action={action:?})");
        assert!(!reply.trim().is_empty(), "la respuesta quedó vacía");
        assert_ne!(
            reply, "Listo. ¿Qué querés hacer ahora?",
            "la respuesta cayó al texto de fallback: el proveedor no contestó contenido"
        );
    }
}
