//! Agent loop primitives: forwards JSON-Schema tools to an OpenAI-compatible
//! provider and returns the assistant message with `tool_calls`.
//!
//! Execution belongs to the webview (the only writer of the open project).
//! This module validates and limits what the provider can ask for.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::commands::providers::{
    chat_endpoint, is_local_endpoint, read_key, validate_provider_base_url,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_MESSAGES: usize = 32;
const MAX_MESSAGE_CHARS: usize = 4_000;
const MAX_CONTEXT_CHARS: usize = 2_000;
const MAX_REPLY_CHARS: usize = 2_000;
// El catálogo del asistente superó las 40 herramientas (edición, render,
// escenas y exploración de archivos); 64 deja margen sin aceptar payloads
// arbitrarios.
const MAX_TOOLS: usize = 64;
const MAX_TOOLS_BYTES: usize = 96_000;
const MAX_TOOL_CHARS: usize = 20_000;
const MAX_TOOL_ARG_CHARS: usize = 8_000;
const MAX_TOOL_CALLS: usize = 8;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub tool_calls: Vec<AssistantToolCall>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantAgentRequest {
    pub messages: Vec<AgentMessage>,
    #[serde(default)]
    pub context: Option<Value>,
    #[serde(default)]
    pub tools: Vec<Value>,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantAgentReply {
    pub reply: String,
    pub tool_calls: Vec<AssistantToolCall>,
    pub finish_reason: Option<String>,
    pub provider_id: String,
    pub model: String,
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn valid_tool_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => {}
        _ => return false,
    }
    name.len() >= 2
        && name.len() <= 48
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn clean_tool_calls(calls: &[AssistantToolCall]) -> Result<Vec<AssistantToolCall>, ProjectError> {
    if calls.len() > MAX_TOOL_CALLS {
        return Err(invalid("demasiadas llamadas a herramientas en un turno"));
    }
    let mut cleaned = Vec::new();
    for call in calls {
        let id = call.id.trim();
        if id.is_empty() || id.len() > 128 {
            return Err(invalid("una herramienta no trae un id válido"));
        }
        let name = call.name.trim();
        if !valid_tool_name(name) {
            return Err(invalid("nombre de herramienta inválido"));
        }
        if !call.arguments.is_object() {
            return Err(invalid("los argumentos deben ser un objeto"));
        }
        if call.arguments.to_string().len() > MAX_TOOL_ARG_CHARS {
            return Err(invalid("los argumentos de la herramienta son demasiado grandes"));
        }
        cleaned.push(AssistantToolCall {
            id: id.to_owned(),
            name: name.to_owned(),
            arguments: call.arguments.clone(),
        });
    }
    Ok(cleaned)
}

fn clean_tools(tools: &[Value]) -> Result<Vec<Value>, ProjectError> {
    if tools.is_empty() {
        return Err(invalid("el agente necesita al menos una herramienta"));
    }
    if tools.len() > MAX_TOOLS {
        return Err(invalid("demasiadas herramientas"));
    }
    let total_bytes: usize = tools
        .iter()
        .map(|tool| serde_json::to_string(tool).map(|text| text.len()).unwrap_or(0))
        .sum();
    if total_bytes > MAX_TOOLS_BYTES {
        return Err(invalid("los esquemas de herramientas son demasiado grandes"));
    }
    let mut cleaned = Vec::new();
    for tool in tools {
        let function = tool
            .get("function")
            .ok_or_else(|| invalid("herramienta sin función"))?;
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if !valid_tool_name(name) {
            return Err(invalid("nombre de herramienta inválido"));
        }
        let description: String = function
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(400)
            .collect();
        let parameters = function
            .get("parameters")
            .ok_or_else(|| invalid("herramienta sin parámetros"))?;
        if !parameters.is_object() {
            return Err(invalid("los parámetros deben ser un objeto JSON Schema"));
        }
        if parameters.to_string().len() > MAX_TOOL_CHARS {
            return Err(invalid("los parámetros de la herramienta son demasiado grandes"));
        }
        cleaned.push(json!({
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters,
            }
        }));
    }
    Ok(cleaned)
}

fn clean_agent_messages(messages: &[AgentMessage]) -> Result<Vec<Value>, ProjectError> {
    let mut cleaned = Vec::new();
    for message in messages.iter().take(MAX_MESSAGES) {
        let role = message.role.trim().to_ascii_lowercase();
        if !matches!(role.as_str(), "system" | "user" | "assistant" | "tool") {
            continue;
        }
        let content: String = message
            .content
            .trim()
            .chars()
            .take(MAX_MESSAGE_CHARS)
            .collect();
        if role == "tool" {
            let call_id = message
                .tool_call_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid("un resultado de herramienta no trae tool_call_id"))?;
            cleaned.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": content,
            }));
            continue;
        }
        if role == "assistant" && !message.tool_calls.is_empty() {
            let calls = clean_tool_calls(&message.tool_calls)?;
            let formatted: Vec<Value> = calls
                .iter()
                .map(|call| {
                    json!({
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.name,
                            "arguments": call.arguments.to_string(),
                        }
                    })
                })
                .collect();
            cleaned.push(json!({
                "role": "assistant",
                "content": content,
                "tool_calls": formatted,
            }));
            continue;
        }
        if content.is_empty() && role != "assistant" {
            continue;
        }
        cleaned.push(json!({ "role": role, "content": content }));
    }
    if !cleaned.iter().any(|message| message["role"] == "user") {
        return Err(invalid("el agente necesita al menos un mensaje del usuario"));
    }
    Ok(cleaned)
}

fn agent_body(model: &str, messages: &[Value], tools: &[Value]) -> Value {
    json!({
        "model": model,
        "temperature": 0.2,
        "max_tokens": 1024,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
    })
}

fn parse_agent_reply(
    payload: &Value,
) -> Result<(String, Vec<AssistantToolCall>, Option<String>), ProjectError> {
    let choice = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta no trae choices[0]",
            )
        })?;
    let message = choice.get("message").ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la respuesta no trae message",
        )
    })?;
    let reply: String = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .chars()
        .take(MAX_REPLY_CHARS)
        .collect();
    let mut calls = Vec::new();
    if let Some(items) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, item) in items.iter().take(MAX_TOOL_CALLS).enumerate() {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("call_{index}"));
            let name = item
                .pointer("/function/name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            if !valid_tool_name(name) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "el proveedor devolvió una herramienta inválida",
                ));
            }
            let raw = item
                .pointer("/function/arguments")
                .and_then(Value::as_str)
                .unwrap_or("{}");
            let arguments: Value = serde_json::from_str(raw).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "los argumentos de la herramienta no son JSON",
                )
            })?;
            if !arguments.is_object() {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "los argumentos de la herramienta deben ser un objeto",
                ));
            }
            calls.push(AssistantToolCall {
                id,
                name: name.to_owned(),
                arguments,
            });
        }
        clean_tool_calls(&calls)?;
    }
    let finish_reason = choice
        .get("finish_reason")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok((reply, calls, finish_reason))
}


async fn call_openai_agent(
    base_url: &str,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    key: Option<String>,
) -> Result<(String, Vec<AssistantToolCall>, Option<String>), ProjectError> {
    let body = agent_body(model, messages, tools);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
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
            "el proveedor no respondió en 180 segundos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el proveedor; revisá que esté encendido".to_owned()
        } else {
            "la llamada al proveedor falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó las herramientas o el mensaje (HTTP {})",
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
    parse_agent_reply(&payload)
}


fn anthropic_endpoint(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    }
}

/// Traduce los mensajes OpenAI ya saneados al formato de Anthropic Messages.
fn anthropic_messages(messages: &[Value]) -> (String, Vec<Value>) {
    let mut system = String::new();
    let mut out: Vec<Value> = Vec::new();
    for message in messages {
        match message.get("role").and_then(Value::as_str).unwrap_or("") {
            "system" => {
                if let Some(content) = message.get("content").and_then(Value::as_str) {
                    if !system.is_empty() {
                        system.push_str("\n\n");
                    }
                    system.push_str(content);
                }
            }
            "tool" => {
                let block = json!({
                    "type": "tool_result",
                    "tool_use_id": message.get("tool_call_id").cloned().unwrap_or(Value::Null),
                    "content": message.get("content").cloned().unwrap_or(Value::String(String::new())),
                });
                let append = out.last_mut().filter(|last| {
                    last.get("role").and_then(Value::as_str) == Some("user")
                        && last.get("content").map(Value::is_array).unwrap_or(false)
                });
                if let Some(last) = append {
                    if let Some(content) = last.get_mut("content").and_then(Value::as_array_mut) {
                        content.push(block);
                        continue;
                    }
                }
                out.push(json!({ "role": "user", "content": [block] }));
            }
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                if let Some(text) = message.get("content").and_then(Value::as_str) {
                    if !text.trim().is_empty() {
                        blocks.push(json!({ "type": "text", "text": text }));
                    }
                }
                if let Some(calls) = message.get("tool_calls").and_then(Value::as_array) {
                    for call in calls {
                        let arguments = call
                            .pointer("/function/arguments")
                            .and_then(Value::as_str)
                            .unwrap_or("{}");
                        let input: Value =
                            serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": call.get("id").cloned().unwrap_or(Value::Null),
                            "name": call.pointer("/function/name").cloned().unwrap_or(Value::Null),
                            "input": input,
                        }));
                    }
                }
                if !blocks.is_empty() {
                    out.push(json!({ "role": "assistant", "content": blocks }));
                }
            }
            "user" => {
                out.push(json!({
                    "role": "user",
                    "content": message.get("content").cloned().unwrap_or(Value::String(String::new())),
                }));
            }
            _ => {}
        }
    }
    (system, out)
}

fn anthropic_tools(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|tool| {
            let function = tool.get("function")?;
            Some(json!({
                "name": function.get("name")?.clone(),
                "description": function
                    .get("description")
                    .cloned()
                    .unwrap_or(Value::String(String::new())),
                "input_schema": function.get("parameters")?.clone(),
            }))
        })
        .collect()
}

fn anthropic_body(model: &str, system: String, messages: &[Value], tools: &[Value]) -> Value {
    json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "messages": messages,
        "tools": tools,
    })
}

fn parse_anthropic_reply(
    payload: &Value,
) -> Result<(String, Vec<AssistantToolCall>, Option<String>), ProjectError> {
    let blocks = payload
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta de Anthropic no trae content",
            )
        })?;
    let mut texts: Vec<&str> = Vec::new();
    let mut calls = Vec::new();
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    texts.push(text);
                }
            }
            Some("tool_use") => {
                let name = block.get("name").and_then(Value::as_str).unwrap_or("").trim();
                if !valid_tool_name(name) {
                    return Err(ProjectError::message(
                        ProjectErrorCode::InvalidProviderResponse,
                        "el proveedor devolvió una herramienta inválida",
                    ));
                }
                let input = block.get("input").cloned().unwrap_or_else(|| json!({}));
                if !input.is_object() {
                    return Err(ProjectError::message(
                        ProjectErrorCode::InvalidProviderResponse,
                        "los argumentos de la herramienta deben ser un objeto",
                    ));
                }
                let id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("toolu_{}", calls.len()));
                calls.push(AssistantToolCall {
                    id,
                    name: name.to_owned(),
                    arguments: input,
                });
            }
            _ => {}
        }
    }
    clean_tool_calls(&calls)?;
    let reply: String = texts
        .join("\n")
        .trim()
        .chars()
        .take(MAX_REPLY_CHARS)
        .collect();
    let stop_reason = payload
        .get("stop_reason")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok((reply, calls, stop_reason))
}

async fn call_anthropic_agent(
    base_url: &str,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    key: Option<String>,
) -> Result<(String, Vec<AssistantToolCall>, Option<String>), ProjectError> {
    let (system, translated) = anthropic_messages(messages);
    let body = anthropic_body(model, system, &translated, &anthropic_tools(tools));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let mut call = client
        .post(anthropic_endpoint(base_url))
        .json(&body)
        .header("Accept", "application/json")
        .header("anthropic-version", "2023-06-01");
    if let Some(secret) = key {
        call = call.header("x-api-key", secret);
    }
    let response = call.send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            "el proveedor no respondió en 180 segundos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el proveedor; revisá que esté encendido".to_owned()
        } else {
            "la llamada al proveedor falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó las herramientas o el mensaje (HTTP {})",
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
    parse_anthropic_reply(&payload)
}

async fn call_agent_provider(
    kind: &str,
    base_url: &str,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    key: Option<String>,
) -> Result<(String, Vec<AssistantToolCall>, Option<String>), ProjectError> {
    if kind.eq_ignore_ascii_case("anthropic") {
        call_anthropic_agent(base_url, model, messages, tools, key).await
    } else {
        call_openai_agent(base_url, model, messages, tools, key).await
    }
}

#[tauri::command]
pub async fn assistant_agent(
    state: State<'_, AppState>,
    request: AssistantAgentRequest,
) -> Result<AssistantAgentReply, ProjectError> {
    let messages = clean_agent_messages(&request.messages)?;
    let tools = clean_tools(&request.tools)?;
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor real en Ajustes → IA antes de usar herramientas",
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
    let system = format!(
        concat!(
            "Sos Olyvia, la operadora del estudio local Olyvia. ",
            "Respondé en español rioplatense, breve y claro. ",
            "Usá las herramientas disponibles para inspeccionar y operar el proyecto; ",
            "no inventes ids, materiales ni frames. ",
            "Después de ejecutar herramientas, resumí qué cambió. ",
            "Si una herramienta falla, explicá el error y proponé el siguiente paso. ",
            "No pidas permisos que la interfaz ya controla. ",
            "Contexto del proyecto: {}"
        ),
        context
    );
    let mut body_messages = vec![json!({ "role": "system", "content": system })];
    body_messages.extend(messages);
    let (reply, tool_calls, finish_reason) =
        call_agent_provider(
            &provider.agent_kind,
            &provider.base_url,
            &provider.model,
            &body_messages,
            &tools,
            key,
        )
            .await?;
    Ok(AssistantAgentReply {
        reply,
        tool_calls,
        finish_reason,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str) -> Value {
        json!({
            "type": "function",
            "function": {
                "name": name,
                "description": "prueba",
                "parameters": { "type": "object", "properties": {}, "additionalProperties": false }
            }
        })
    }

    #[test]
    fn accepts_valid_tools_and_rejects_bad_names() {
        let cleaned = clean_tools(&[tool("project_inspect"), tool("clip_split")]).expect("válidas");
        assert_eq!(cleaned.len(), 2);
        assert_eq!(cleaned[0]["function"]["name"], "project_inspect");
        let error = clean_tools(&[tool("Project Inspect")]).expect_err("inválida");
        assert_eq!(error.code, ProjectErrorCode::InvalidProject);
        assert!(clean_tools(&[]).is_err());
    }

    #[test]
    fn formats_tool_results_and_assistant_calls() {
        let calls = vec![AssistantToolCall {
            id: "call_1".to_owned(),
            name: "navigate".to_owned(),
            arguments: json!({ "view": "editor" }),
        }];
        let messages = clean_agent_messages(&[
            AgentMessage {
                role: "user".to_owned(),
                content: "abrí el editor".to_owned(),
                tool_call_id: None,
                tool_calls: vec![],
            },
            AgentMessage {
                role: "assistant".to_owned(),
                content: String::new(),
                tool_call_id: None,
                tool_calls: calls.clone(),
            },
            AgentMessage {
                role: "tool".to_owned(),
                content: "{\"ok\":true}".to_owned(),
                tool_call_id: Some("call_1".to_owned()),
                tool_calls: vec![],
            },
        ])
        .expect("mensajes válidos");
        assert_eq!(messages[1]["tool_calls"][0]["function"]["name"], "navigate");
        assert_eq!(
            messages[1]["tool_calls"][0]["function"]["arguments"],
            "{\"view\":\"editor\"}"
        );
        assert_eq!(messages[2]["role"], "tool");
        assert_eq!(messages[2]["tool_call_id"], "call_1");
        let missing = clean_agent_messages(&[AgentMessage {
            role: "tool".to_owned(),
            content: "x".to_owned(),
            tool_call_id: None,
            tool_calls: vec![],
        }]);
        assert!(missing.is_err());
    }

    #[test]
    fn parses_openai_tool_calls() {
        let payload = json!({
            "choices": [{
                "finish_reason": "tool_calls",
                "message": {
                    "content": null,
                    "tool_calls": [
                        {
                            "id": "call_9",
                            "type": "function",
                            "function": { "name": "clip_split", "arguments": "{\"frame\":30}" }
                        }
                    ]
                }
            }]
        });
        let (reply, calls, finish) = parse_agent_reply(&payload).expect("parsea");
        assert!(reply.is_empty());
        assert_eq!(finish.as_deref(), Some("tool_calls"));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "clip_split");
        assert_eq!(calls[0].arguments["frame"], 30);
        let bad = json!({
            "choices": [{ "message": { "tool_calls": [
                { "id": "c", "function": { "name": "Bad Name", "arguments": "{}" } }
            ] } }]
        });
        assert!(parse_agent_reply(&bad).is_err());
    }

    #[test]
    fn body_declares_tools_and_auto_choice() {
        let body = agent_body("modelo", &[json!({"role":"user","content":"hola"})], &[tool("navigate")]);
        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["tools"][0]["function"]["name"], "navigate");
        assert_eq!(body["messages"][0]["role"], "user");
    }
    #[test]
    fn http_round_trip_forwards_tools_and_parses_calls() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let read = stream.read(&mut chunk).expect("read");
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&buffer);
                if let Some(header_end) = text.find("\r\n\r\n") {
                    let header = &text[..header_end];
                    let length = header
                        .lines()
                        .find_map(|line| {
                            let lower = line.to_ascii_lowercase();
                            lower
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if buffer.len() >= header_end + 4 + length {
                        break;
                    }
                }
            }
            let text = String::from_utf8_lossy(&buffer).to_string();
            let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
            assert!(body.contains("\"tools\""), "el pedido debe incluir tools");
            assert!(
                body.contains("\"project_inspect\""),
                "el pedido debe incluir la herramienta"
            );
            let payload = r#"{"choices":[{"finish_reason":"tool_calls","message":{"content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"project_inspect","arguments":"{}"}}]}}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                payload.len(),
                payload
            );
            stream.write_all(response.as_bytes()).expect("write");
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let base = format!("http://{address}/v1");
        let (reply, calls, finish) = runtime
            .block_on(call_agent_provider(
                "openai-compatible",
                &base,
                "test-model",
                &[json!({ "role": "user", "content": "hola" })],
                &[tool("project_inspect")],
                None,
            ))
            .expect("round trip");
        server.join().expect("server");
        assert!(reply.is_empty());
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "project_inspect");
        assert_eq!(finish.as_deref(), Some("tool_calls"));
    }

    #[test]
    fn translates_messages_for_anthropic() {
        let calls = vec![AssistantToolCall {
            id: "toolu_1".to_owned(),
            name: "navigate".to_owned(),
            arguments: json!({ "view": "editor" }),
        }];
        let messages = clean_agent_messages(&[
            AgentMessage {
                role: "system".to_owned(),
                content: "sistema".to_owned(),
                tool_call_id: None,
                tool_calls: vec![],
            },
            AgentMessage {
                role: "user".to_owned(),
                content: "abrí el editor".to_owned(),
                tool_call_id: None,
                tool_calls: vec![],
            },
            AgentMessage {
                role: "assistant".to_owned(),
                content: String::new(),
                tool_call_id: None,
                tool_calls: calls,
            },
            AgentMessage {
                role: "tool".to_owned(),
                content: "{\"ok\":true}".to_owned(),
                tool_call_id: Some("toolu_1".to_owned()),
                tool_calls: vec![],
            },
        ])
        .expect("mensajes válidos");
        let (system, translated) = anthropic_messages(&messages);
        assert_eq!(system, "sistema");
        assert_eq!(translated[0]["role"], "user");
        assert_eq!(translated[1]["role"], "assistant");
        assert_eq!(translated[1]["content"][0]["type"], "tool_use");
        assert_eq!(translated[1]["content"][0]["input"]["view"], "editor");
        assert_eq!(translated[2]["role"], "user");
        assert_eq!(translated[2]["content"][0]["type"], "tool_result");
        assert_eq!(translated[2]["content"][0]["tool_use_id"], "toolu_1");
    }

    #[test]
    fn parses_anthropic_tool_use() {
        let payload = json!({
            "content": [
                { "type": "text", "text": "Voy a inspeccionar." },
                { "type": "tool_use", "id": "toolu_9", "name": "project_inspect", "input": {} }
            ],
            "stop_reason": "tool_use"
        });
        let (reply, calls, stop) = parse_anthropic_reply(&payload).expect("parsea");
        assert_eq!(reply, "Voy a inspeccionar.");
        assert_eq!(stop.as_deref(), Some("tool_use"));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "toolu_9");
        assert_eq!(calls[0].name, "project_inspect");
    }

    #[test]
    fn http_round_trip_anthropic_translates_tools_and_headers() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let address = listener.local_addr().expect("addr");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let read = stream.read(&mut chunk).expect("read");
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&buffer);
                if let Some(header_end) = text.find("\r\n\r\n") {
                    let header = &text[..header_end];
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    if buffer.len() >= header_end + 4 + length {
                        break;
                    }
                }
            }
            let text = String::from_utf8_lossy(&buffer).to_string();
            let lower = text.to_ascii_lowercase();
            assert!(lower.contains("x-api-key: test-key"), "falta x-api-key");
            assert!(
                lower.contains("anthropic-version: 2023-06-01"),
                "falta anthropic-version"
            );
            assert!(lower.contains("post /v1/messages"), "endpoint incorrecto");
            let body = text.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
            assert!(body.contains("\"input_schema\""), "falta input_schema");
            assert!(body.contains("\"max_tokens\""), "falta max_tokens");
            assert!(body.contains("\"project_inspect\""), "falta la herramienta");
            let payload = r#"{"content":[{"type":"text","text":"Listo"},{"type":"tool_use","id":"toolu_1","name":"project_inspect","input":{}}],"stop_reason":"tool_use"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                payload.len(),
                payload
            );
            stream.write_all(response.as_bytes()).expect("write");
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let base = format!("http://{address}");
        let (reply, calls, finish) = runtime
            .block_on(call_agent_provider(
                "anthropic",
                &base,
                "claude-test",
                &[json!({ "role": "user", "content": "hola" })],
                &[tool("project_inspect")],
                Some("test-key".to_owned()),
            ))
            .expect("round trip anthropic");
        server.join().expect("server");
        assert_eq!(reply, "Listo");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "project_inspect");
        assert_eq!(finish.as_deref(), Some("tool_use"));
    }

}
