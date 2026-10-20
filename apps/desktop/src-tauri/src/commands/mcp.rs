//! Local MCP (Model Context Protocol) server manager.
//!
//! The user registers a stdio MCP server with an explicit command, arguments
//! and environment variable names. Values for those variables live in the
//! Windows Credential Manager, never in the JSON config. Nothing runs until the
//! user presses "Probar" or "Ejecutar": saving a server never spawns it.
//!
//! The client speaks the newline-delimited JSON-RPC stdio transport, performs
//! the mandatory `initialize` handshake, sends `notifications/initialized` and
//! then requests `tools/list` or `tools/call`. Every read is bounded by a
//! deadline and the child process is killed before returning.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MCP_FILE: &str = "mcp-servers.json";
const KEYRING_SERVICE: &str = "editor-ia.mcp";
const MAX_SERVERS: usize = 40;
const MAX_ARGS: usize = 32;
const MAX_ENV: usize = 24;
const MAX_TOOLS: usize = 500;
const MAX_LINE_BYTES: usize = 4_000_000;
const INIT_TIMEOUT: Duration = Duration::from_secs(12);
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
/// Flow/Veo and other generative tools can legitimately take several minutes.
const CALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);

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

fn error(code: ProjectErrorCode, message: &str) -> ProjectError {
    ProjectError::message(code, message)
}

fn validate(input: &McpServerInput) -> Result<(), ProjectError> {
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
        let path = PathBuf::from(dir);
        if !path.is_dir() {
            return Err(error(
                ProjectErrorCode::NotFound,
                "la carpeta de trabajo del servidor MCP no existe",
            ));
        }
    }
    Ok(())
}

fn valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    key.len() <= 128 && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn read_servers(config_dir: &PathBuf) -> Result<Vec<McpServerConfig>, ProjectError> {
    let path = config_dir.join(MCP_FILE);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|_| {
        error(
            ProjectErrorCode::Io,
            "no se pudo leer la configuración de servidores MCP",
        )
    })?;
    let servers: Vec<McpServerConfig> = serde_json::from_str(&text).map_err(|_| {
        error(
            ProjectErrorCode::InvalidJson,
            "la configuración de servidores MCP está dañada",
        )
    })?;
    Ok(servers.into_iter().take(MAX_SERVERS).collect())
}

fn write_servers(config_dir: &PathBuf, servers: &[McpServerConfig]) -> Result<(), ProjectError> {
    let text = serde_json::to_string_pretty(servers).map_err(|_| {
        error(
            ProjectErrorCode::Io,
            "no se pudo serializar la configuración MCP",
        )
    })?;
    let path = config_dir.join(MCP_FILE);
    let temp = config_dir.join(format!(".{MCP_FILE}.{}.tmp", Uuid::new_v4()));
    std::fs::write(&temp, text).map_err(|_| {
        error(
            ProjectErrorCode::Io,
            "no se pudo escribir la configuración MCP",
        )
    })?;
    std::fs::rename(&temp, &path).map_err(|_| {
        let _ = std::fs::remove_file(&temp);
        error(
            ProjectErrorCode::Io,
            "no se pudo publicar la configuración MCP",
        )
    })?;
    Ok(())
}

fn keyring_entry(server_id: &str, key: &str) -> Result<keyring::Entry, ProjectError> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("{server_id}:{key}")).map_err(|_| {
        error(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de credenciales de Windows no está disponible para MCP",
        )
    })
}

fn read_env(server: &McpServerConfig) -> Result<BTreeMap<String, String>, ProjectError> {
    let mut values = BTreeMap::new();
    for key in &server.env_keys {
        let entry = keyring_entry(&server.id, key)?;
        match entry.get_password() {
            Ok(secret) => {
                values.insert(key.clone(), secret);
            }
            Err(keyring::Error::NoEntry) => {
                return Err(error(
                    ProjectErrorCode::KeyringUnavailable,
                    "falta el valor de una variable de entorno MCP; volvé a guardarla",
                ));
            }
            Err(_) => {
                return Err(error(
                    ProjectErrorCode::KeyringUnavailable,
                    "no se pudo leer una variable de entorno MCP del almacén de Windows",
                ));
            }
        }
    }
    Ok(values)
}

fn remove_env(server: &McpServerConfig) {
    for key in &server.env_keys {
        if let Ok(entry) = keyring_entry(&server.id, key) {
            let _ = entry.delete_credential();
        }
    }
}

#[tauri::command]
pub async fn list_mcp_servers(
    state: State<'_, AppState>,
) -> Result<Vec<McpServerConfig>, ProjectError> {
    read_servers(&state.config_dir)
}

#[tauri::command]
pub async fn save_mcp_server(
    state: State<'_, AppState>,
    server: McpServerInput,
) -> Result<McpServerConfig, ProjectError> {
    validate(&server)?;
    let mut servers = read_servers(&state.config_dir)?;
    let id = server
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = servers.iter().find(|item| item.id == id).cloned();
    if existing.is_none() && servers.len() >= MAX_SERVERS {
        return Err(error(
            ProjectErrorCode::FileTooLarge,
            "se alcanzó el máximo de servidores MCP configurados",
        ));
    }

    let mut env_keys = Vec::new();
    for variable in &server.env {
        let key = variable.key.trim().to_owned();
        if !env_keys.contains(&key) {
            env_keys.push(key.clone());
        }
        if let Some(value) = variable
            .value
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            keyring_entry(&id, &key)?.set_password(value).map_err(|_| {
                error(
                    ProjectErrorCode::KeyringUnavailable,
                    "no se pudo guardar una variable de entorno MCP en el almacén de Windows",
                )
            })?;
        }
    }

    let config = McpServerConfig {
        id: id.clone(),
        name: server.name.trim().to_owned(),
        command: server.command.trim().to_owned(),
        args: server
            .args
            .into_iter()
            .map(|arg| arg.trim().to_owned())
            .collect(),
        env_keys,
        working_dir: server
            .working_dir
            .map(|dir| dir.trim().to_owned())
            .filter(|dir| !dir.is_empty()),
        enabled: server.enabled,
    };
    if let Some(previous) = &existing {
        for key in &previous.env_keys {
            if !config.env_keys.contains(key) {
                if let Ok(entry) = keyring_entry(&id, key) {
                    let _ = entry.delete_credential();
                }
            }
        }
        if let Some(index) = servers.iter().position(|item| item.id == id) {
            servers[index] = config.clone();
        }
    } else {
        servers.push(config.clone());
    }
    write_servers(&state.config_dir, &servers)?;
    Ok(config)
}

#[tauri::command]
pub async fn delete_mcp_server(state: State<'_, AppState>, id: String) -> Result<(), ProjectError> {
    let mut servers = read_servers(&state.config_dir)?;
    if let Some(index) = servers.iter().position(|item| item.id == id) {
        let removed = servers.remove(index);
        remove_env(&removed);
        write_servers(&state.config_dir, &servers)?;
    }
    Ok(())
}

fn find_server(config_dir: &PathBuf, id: &str) -> Result<McpServerConfig, ProjectError> {
    read_servers(config_dir)?
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| {
            error(
                ProjectErrorCode::NotFound,
                "el servidor MCP ya no está configurado",
            )
        })
}

#[tauri::command]
pub async fn probe_mcp_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<McpProbeResult, ProjectError> {
    let server = find_server(&state.config_dir, &id)?;
    if !server.enabled {
        return Err(error(
            ProjectErrorCode::ProviderUnavailable,
            "el servidor MCP está desactivado",
        ));
    }
    let env = read_env(&server)?;
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&server, &env))
        .await
        .map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "la prueba del servidor MCP no pudo completarse",
            )
        })?
}

#[tauri::command]
pub async fn call_mcp_tool(
    state: State<'_, AppState>,
    id: String,
    tool: String,
    arguments: Value,
) -> Result<McpCallResult, ProjectError> {
    let server = find_server(&state.config_dir, &id)?;
    if !server.enabled {
        return Err(error(
            ProjectErrorCode::ProviderUnavailable,
            "el servidor MCP está desactivado",
        ));
    }
    if tool.trim().is_empty() || tool.chars().count() > 200 {
        return Err(error(
            ProjectErrorCode::InvalidProject,
            "la herramienta MCP no tiene un nombre válido",
        ));
    }
    let env = read_env(&server)?;
    tauri::async_runtime::spawn_blocking(move || {
        call_blocking(&server, &env, tool.trim(), arguments)
    })
    .await
    .map_err(|_| {
        error(
            ProjectErrorCode::ProviderUnavailable,
            "la llamada al servidor MCP no pudo completarse",
        )
    })?
}

fn build_command(server: &McpServerConfig) -> Command {
    #[cfg(windows)]
    {
        let lower = server.command.to_ascii_lowercase();
        let needs_shell = lower.ends_with(".cmd")
            || lower.ends_with(".bat")
            || lower == "npx"
            || lower == "npm"
            || lower == "pnpm"
            || lower == "yarn"
            || lower == "bunx";
        if needs_shell {
            let mut command = Command::new("cmd");
            command.arg("/C").arg(&server.command).args(&server.args);
            return command;
        }
    }
    let mut command = Command::new(&server.command);
    command.args(&server.args);
    command
}

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
}

impl McpProcess {
    fn spawn(
        server: &McpServerConfig,
        env: &BTreeMap<String, String>,
    ) -> Result<Self, ProjectError> {
        if !server.enabled {
            return Err(error(
                ProjectErrorCode::ProviderUnavailable,
                "el servidor MCP está desactivado",
            ));
        }
        let mut command = build_command(server);
        if let Some(dir) = server.working_dir.as_deref() {
            command.current_dir(dir);
        }
        if !env.is_empty() {
            command.envs(env);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo iniciar el servidor MCP; revisá el comando",
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(|| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "el servidor MCP no expone una entrada estándar",
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "el servidor MCP no expone una salida estándar",
            )
        })?;
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        if text.len() > MAX_LINE_BYTES {
                            break;
                        }
                        if sender.send(text).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            child,
            stdin,
            lines: receiver,
        })
    }

    fn send(&mut self, value: &Value) -> Result<(), ProjectError> {
        let mut text = serde_json::to_string(value)
            .map_err(|_| error(ProjectErrorCode::Io, "no se pudo serializar el mensaje MCP"))?;
        text.push('\n');
        self.stdin.write_all(text.as_bytes()).map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "el servidor MCP cerró la entrada antes de responder",
            )
        })?;
        self.stdin.flush().map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo enviar el mensaje al servidor MCP",
            )
        })
    }

    fn receive_for(&mut self, id: u64, timeout: Duration) -> Result<Value, ProjectError> {
        let until = Instant::now() + timeout;
        loop {
            let now = Instant::now();
            if now >= until {
                return Err(error(
                    ProjectErrorCode::ProviderUnavailable,
                    "el servidor MCP no respondió a tiempo",
                ));
            }
            let message = self.lines.recv_timeout(until - now).map_err(|_| {
                error(
                    ProjectErrorCode::ProviderUnavailable,
                    "el servidor MCP no respondió a tiempo",
                )
            })?;
            let value: Value = match serde_json::from_str(&message) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                // Logs and notifications are not part of this request.
                continue;
            }
            if let Some(failure) = value.get("error") {
                let detail = failure
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("error sin detalle");
                return Err(error(
                    ProjectErrorCode::ProviderRejected,
                    &format!("el servidor MCP rechazó la operación: {detail}"),
                ));
            }
            return Ok(value);
        }
    }

    fn handshake(&mut self) -> Result<(String, String, String), ProjectError> {
        let request = json!({
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
        });
        self.send(&request)?;
        let response = self.receive_for(1, INIT_TIMEOUT)?;
        let result = response.get("result").cloned().ok_or_else(|| {
            error(
                ProjectErrorCode::InvalidProviderResponse,
                "el servidor MCP no devolvió un resultado de inicialización",
            )
        })?;
        self.send(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }))?;
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
        Ok((protocol, name, version))
    }

    fn close(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn parse_tools(result: &Value) -> Vec<McpToolInfo> {
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

fn probe_blocking(
    server: &McpServerConfig,
    env: &BTreeMap<String, String>,
) -> Result<McpProbeResult, ProjectError> {
    let started = Instant::now();
    let mut process = McpProcess::spawn(server, env)?;
    let result = (|| {
        let (protocol_version, server_name, server_version) = process.handshake()?;
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for page in 0..5u64 {
            let id = 2 + page;
            let mut params = json!({});
            if let Some(cursor) = cursor.clone() {
                params["cursor"] = Value::String(cursor);
            }
            process.send(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "tools/list",
                "params": params
            }))?;
            let response = process.receive_for(id, LIST_TIMEOUT)?;
            let page_result = response.get("result").cloned().unwrap_or_else(|| json!({}));
            tools.extend(parse_tools(&page_result));
            cursor = page_result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if cursor.is_none() {
                break;
            }
        }
        Ok(McpProbeResult {
            server_id: server.id.clone(),
            server_name,
            server_version,
            protocol_version,
            tools,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    })();
    process.close();
    result
}

fn call_blocking(
    server: &McpServerConfig,
    env: &BTreeMap<String, String>,
    tool: &str,
    arguments: Value,
) -> Result<McpCallResult, ProjectError> {
    if !arguments.is_object() {
        return Err(error(
            ProjectErrorCode::InvalidJson,
            "los argumentos de una herramienta MCP deben ser un objeto JSON",
        ));
    }
    let started = Instant::now();
    let mut process = McpProcess::spawn(server, env)?;
    let result = (|| {
        process.handshake()?;
        process.send(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": tool, "arguments": arguments }
        }))?;
        let response = process.receive_for(2, CALL_TIMEOUT)?;
        let result = response.get("result").cloned().ok_or_else(|| {
            error(
                ProjectErrorCode::InvalidProviderResponse,
                "el servidor MCP no devolvió un resultado",
            )
        })?;
        let is_error = result
            .get("isError")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(McpCallResult {
            server_id: server.id.clone(),
            tool_name: tool.to_owned(),
            result,
            is_error,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    })();
    process.close();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base(command: &str) -> McpServerInput {
        McpServerInput {
            id: None,
            name: "Fixture".to_owned(),
            command: command.to_owned(),
            args: Vec::new(),
            env: Vec::new(),
            working_dir: None,
            enabled: true,
        }
    }

    #[test]
    fn validates_bounded_config() {
        assert!(validate(&base("node")).is_ok());
        assert!(validate(&McpServerInput {
            name: String::new(),
            ..base("node")
        })
        .is_err());
        assert!(validate(&McpServerInput {
            args: vec!["a\nb".to_owned()],
            ..base("node")
        })
        .is_err());
        assert!(validate(&McpServerInput {
            env: vec![McpEnvInput {
                key: "BAD-KEY".to_owned(),
                value: Some("x".to_owned()),
            }],
            ..base("node")
        })
        .is_err());
        assert!(validate(&McpServerInput {
            working_dir: Some("Z:\\no-existe-editoria".to_owned()),
            ..base("node")
        })
        .is_err());
        assert!(valid_env_key("GITHUB_TOKEN"));
        assert!(!valid_env_key("1TOKEN"));
    }

    #[test]
    fn live_stdio_probe_and_tool_call() {
        let node = Command::new("node").arg("--version").output();
        if node.is_err() {
            eprintln!("node no está disponible; se omite la prueba MCP en vivo");
            return;
        }
        let dir = std::env::temp_dir().join(format!("editoria-mcp-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let script = dir.join("fixture.mjs");
        std::fs::write(
            &script,
            r#"
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture-mcp', version: '1.0.0' }
    }});
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{
      name: 'echo',
      description: 'Devuelve el texto recibido',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
    }] }});
  } else if (msg.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: msg.id, result: {
      content: [{ type: 'text', text: msg.params?.arguments?.text ?? '' }],
      isError: false
    }});
  }
});
"#,
        )
        .expect("script");
        let server = McpServerConfig {
            id: "fixture".to_owned(),
            name: "Fixture".to_owned(),
            command: "node".to_owned(),
            args: vec![script.to_string_lossy().into_owned()],
            env_keys: Vec::new(),
            working_dir: None,
            enabled: true,
        };
        let env = BTreeMap::new();
        let probe = probe_blocking(&server, &env).expect("probe");
        assert_eq!(probe.server_name, "fixture-mcp");
        assert_eq!(probe.tools.len(), 1);
        assert_eq!(probe.tools[0].name, "echo");
        let call =
            call_blocking(&server, &env, "echo", json!({ "text": "hola MCP" })).expect("call");
        assert_eq!(call.result["content"][0]["text"], "hola MCP");
        assert!(!call.is_error);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
