//! Dominio puro del cliente MCP: configuración, validación, protocolo
//! JSON-RPC stdio y política de sesiones. Nada de esto toca procesos,
//! keyring ni filesystem.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MCP_FILE: &str = "mcp-servers.json";
pub const MAX_SERVERS: usize = 40;
pub const MAX_ARGS: usize = 32;
pub const MAX_ENV: usize = 24;
pub const MAX_TOOLS: usize = 500;
pub const INIT_TIMEOUT: Duration = Duration::from_secs(12);
pub const LIST_TIMEOUT: Duration = Duration::from_secs(20);
/// Flow/Veo and other generative tools can legitimately take several minutes.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Una sesión sin uso se cierra sola: el navegador que tenga abierto no debe
/// quedar vivo para siempre por haber probado una herramienta.
pub const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Cada sesión puede tener un navegador detrás; no se acumulan sin límite.
pub const MAX_SESSIONS: usize = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env_keys: Vec<String>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpEnvInput {
    pub key: String,
    #[serde(default)]
    pub value: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<McpEnvInput>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbeResult {
    pub server_id: String,
    pub server_name: String,
    pub server_version: String,
    pub protocol_version: String,
    pub tools: Vec<McpToolInfo>,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallResult {
    pub server_id: String,
    pub tool_name: String,
    pub result: Value,
    pub is_error: bool,
    pub elapsed_ms: u64,
}

/// Estado de una sesión viva, para que la UI pueda mostrarla y cerrarla.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSessionInfo {
    pub server_id: String,
    pub pid: u32,
    pub calls: u64,
    pub started_at_ms: u64,
    pub idle_ms: u64,
}

pub fn error(code: ProjectErrorCode, message: &str) -> ProjectError {
    ProjectError::message(code, message)
}

pub fn validate(input: &McpServerInput) -> Result<(), ProjectError> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(error(
            ProjectErrorCode::InvalidProject,
            "el nombre del servidor MCP debe tener entre 1 y 80 caracteres",
        ));
    }
    let command = input.command.trim();
    if command.is_empty() || command.chars().count() > 500 || command.chars().any(char::is_control)
    {
        return Err(error(
            ProjectErrorCode::InvalidProject,
            "el comando MCP no es válido",
        ));
    }
    if input.args.len() > MAX_ARGS {
        return Err(error(
            ProjectErrorCode::InvalidProject,
            "el servidor MCP declara demasiados argumentos",
        ));
    }
    for arg in &input.args {
        if arg.chars().count() > 500 || arg.chars().any(|c| c == '\n' || c == '\r' || c == '\0') {
            return Err(error(
                ProjectErrorCode::InvalidProject,
                "un argumento del servidor MCP no es válido",
            ));
        }
    }
    if input.env.len() > MAX_ENV {
        return Err(error(
            ProjectErrorCode::InvalidProject,
            "el servidor MCP declara demasiadas variables de entorno",
        ));
    }
    for variable in &input.env {
        if !valid_env_key(&variable.key) {
            return Err(error(
                ProjectErrorCode::InvalidProject,
                "una variable de entorno del servidor MCP no tiene un nombre válido",
            ));
        }
        if let Some(value) = &variable.value {
            if value.chars().count() > 4_000
                || value.chars().any(|c| c == '\n' || c == '\r' || c == '\0')
            {
                return Err(error(
                    ProjectErrorCode::InvalidProject,
                    "el valor de una variable de entorno MCP no es válido",
                ));
            }
        }
    }
    if let Some(dir) = input
        .working_dir
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    {
        // La existencia del directorio la verifica la capa de aplicación:
        // el dominio no toca el filesystem.
        let _ = dir;
    }
    Ok(())
}

/// Valida la carpeta de trabajo contra el filesystem (caller: application).
pub fn validate_working_dir(dir: Option<&str>) -> Result<(), ProjectError> {
    if let Some(dir) = dir.map(str::trim).filter(|dir| !dir.is_empty()) {
        if !std::path::Path::new(dir).is_dir() {
            return Err(error(
                ProjectErrorCode::NotFound,
                "la carpeta de trabajo del servidor MCP no existe",
            ));
        }
    }
    Ok(())
}

pub fn valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    key.len() <= 128 && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// ---------------------------------------------------------------------------
// Lanzamiento vía shell (npx, npm, .cmd, .bat)
// ---------------------------------------------------------------------------

/// Metacaracteres de `cmd.exe` que permitirían encadenar comandos o
/// expandir variables cuando el servidor se lanza vía `cmd /C`.
pub const CMD_METACHARS: &[char] = &['&', '|', '<', '>', '^', '%', '!', '"', '(', ')'];

/// ¿El comando necesita envoltorio `cmd /C` en Windows?
pub fn needs_cmd_shell(command: &str) -> bool {
    let lower = command.to_ascii_lowercase();
    lower.ends_with(".cmd")
        || lower.ends_with(".bat")
        || lower == "npx"
        || lower == "npm"
        || lower == "pnpm"
        || lower == "yarn"
        || lower == "bunx"
}

/// Rechaza metacaracteres de cmd cuando el lanzamiento pasa por `cmd /C`.
pub fn check_shell_launch(command: &str, args: &[String]) -> Result<(), ProjectError> {
    #[cfg(windows)]
    {
        if needs_cmd_shell(command) {
            let unsafe_arg = |text: &str| text.chars().any(|c| CMD_METACHARS.contains(&c));
            if unsafe_arg(command) || args.iter().any(|a| unsafe_arg(a)) {
                return Err(error(
                    ProjectErrorCode::InvalidProject,
                    "el servidor MCP usa caracteres no permitidos para lanzadores de shell",
                ));
            }
        }
    }
    let _ = (command, args);
    Ok(())
}

// ---------------------------------------------------------------------------
// Protocolo JSON-RPC stdio
// ---------------------------------------------------------------------------

pub fn initialize_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {
                "name": "Editor IA",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    })
}

pub fn initialized_notification() -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    })
}

pub fn tools_list_request(id: u64, cursor: Option<&str>) -> Value {
    let mut params = json!({});
    if let Some(cursor) = cursor {
        params["cursor"] = Value::String(cursor.to_owned());
    }
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/list",
        "params": params
    })
}

pub fn tools_call_request(id: u64, tool: &str, arguments: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/call",
        "params": { "name": tool, "arguments": arguments }
    })
}

/// Extrae (protocolVersion, serverInfo.name, serverInfo.version) del
/// resultado del handshake `initialize`.
pub fn handshake_fields(result: &Value) -> (String, String, String) {
    let protocol = result
        .get("protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("desconocida")
        .to_owned();
    let info = result.get("serverInfo");
    let name = info
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("servidor MCP")
        .to_owned();
    let version = info
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("desconocida")
        .to_owned();
    (protocol, name, version)
}

pub fn parse_tools(result: &Value) -> Vec<McpToolInfo> {
    result
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| {
                    let name = tool.get("name").and_then(Value::as_str)?.trim().to_owned();
                    if name.is_empty() {
                        return None;
                    }
                    Some(McpToolInfo {
                        name,
                        description: tool
                            .get("description")
                            .and_then(Value::as_str)
                            .map(|text| text.chars().take(600).collect()),
                        input_schema: tool
                            .get("inputSchema")
                            .cloned()
                            .unwrap_or_else(|| json!({ "type": "object" })),
                    })
                })
                .take(MAX_TOOLS)
                .collect()
        })
        .unwrap_or_default()
}

/// Entorno resuelto para un servidor: claves ya leídas desde el store de
/// secretos. El transporte sólo recibe el mapa, nunca el keyring.
pub type ResolvedEnv = BTreeMap<String, String>;

#[cfg(test)]
#[path = "client.tests.rs"]
mod tests;
