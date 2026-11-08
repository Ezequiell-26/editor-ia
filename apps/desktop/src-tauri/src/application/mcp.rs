//! Casos de uso del cliente MCP: CRUD de servidores, probe efímero y
//! sesiones persistentes con límite de inactividad.
//!
//! Nada aquí conoce Tauri ni el filesystem concreto: la configuración entra
//! por `McpServerStore`, los secretos por `McpEnvSecrets` y los procesos por
//! `McpTransportFactory`.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use uuid::Uuid;

use crate::mcp::client::{
    self, error, handshake_fields, initialize_request, initialized_notification, parse_tools,
    tools_call_request, tools_list_request, validate, validate_working_dir, McpCallResult,
    McpProbeResult, McpServerConfig, McpServerInput, McpSessionInfo, McpToolInfo, CALL_TIMEOUT,
    INIT_TIMEOUT, LIST_TIMEOUT, MAX_SESSIONS, SESSION_IDLE_TIMEOUT,
};
use crate::ports::mcp::{McpEnvSecrets, McpServerStore, McpTransport, McpTransportFactory};
use crate::projects::service::{ProjectError, ProjectErrorCode};

// ---------------------------------------------------------------------------
// Orquestación del protocolo JSON-RPC sobre un transporte
// ---------------------------------------------------------------------------

/// Handshake `initialize` + `notifications/initialized`.
/// Devuelve (protocolVersion, serverInfo.name, serverInfo.version).
fn transport_handshake(
    transport: &mut dyn McpTransport,
) -> Result<(String, String, String), ProjectError> {
    transport.send(&initialize_request())?;
    let response = transport.receive_for(1, INIT_TIMEOUT)?;
    let result = response.get("result").cloned().ok_or_else(|| {
        error(
            ProjectErrorCode::InvalidProviderResponse,
            "el servidor MCP no devolvió un resultado de inicialización",
        )
    })?;
    transport.send(&initialized_notification())?;
    Ok(handshake_fields(&result))
}

/// `tools/list` paginado sobre un transporte ya inicializado.
fn list_tools(transport: &mut dyn McpTransport) -> Result<Vec<McpToolInfo>, ProjectError> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    for page in 0..5u64 {
        let id = 2 + page;
        transport.send(&tools_list_request(id, cursor.as_deref()))?;
        let response = transport.receive_for(id, LIST_TIMEOUT)?;
        let page_result = response
            .get("result")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        tools.extend(parse_tools(&page_result));
        cursor = page_result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    Ok(tools)
}

/// `tools/call` sobre un transporte ya inicializado.
fn call_transport(
    transport: &mut dyn McpTransport,
    id: u64,
    tool: &str,
    arguments: &Value,
    timeout: std::time::Duration,
) -> Result<(Value, bool), ProjectError> {
    transport.send(&tools_call_request(id, tool, arguments))?;
    let response = transport.receive_for(id, timeout)?;
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
    Ok((result, is_error))
}

/// Handshake + `tools/list` + cierre sobre un transporte efímero.
fn probe_transport(
    transport: &mut dyn McpTransport,
    server_id: &str,
    started: Instant,
) -> Result<McpProbeResult, ProjectError> {
    let (protocol_version, server_name, server_version) = transport_handshake(transport)?;
    let tools = list_tools(transport)?;
    Ok(McpProbeResult {
        server_id: server_id.to_owned(),
        server_name,
        server_version,
        protocol_version,
        tools,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// Helpers compartidos
// ---------------------------------------------------------------------------

fn require_enabled(server: &McpServerConfig) -> Result<(), ProjectError> {
    if !server.enabled {
        return Err(error(
            ProjectErrorCode::ProviderUnavailable,
            "el servidor MCP está desactivado",
        ));
    }
    Ok(())
}

fn find_server(store: &dyn McpServerStore, id: &str) -> Result<McpServerConfig, ProjectError> {
    store
        .read_servers()?
        .into_iter()
        .find(|server| server.id == id)
        .ok_or_else(|| {
            error(
                ProjectErrorCode::NotFound,
                "el servidor MCP ya no está configurado",
            )
        })
}

// ---------------------------------------------------------------------------
// CRUD de servidores
// ---------------------------------------------------------------------------

pub fn list_servers(store: &dyn McpServerStore) -> Result<Vec<McpServerConfig>, ProjectError> {
    store.read_servers()
}

pub fn save_server(
    store: &dyn McpServerStore,
    secrets: &dyn McpEnvSecrets,
    sessions: &SessionRegistry,
    input: McpServerInput,
) -> Result<McpServerConfig, ProjectError> {
    validate(&input)?;
    validate_working_dir(input.working_dir.as_deref())?;
    let mut servers = store.read_servers()?;
    let id = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = servers.iter().find(|item| item.id == id).cloned();
    if existing.is_none() && servers.len() >= client::MAX_SERVERS {
        return Err(error(
            ProjectErrorCode::FileTooLarge,
            "se alcanzó el máximo de servidores MCP configurados",
        ));
    }

    let mut env_keys = Vec::new();
    for variable in &input.env {
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
            secrets.set_env(&id, &key, value)?;
        }
    }

    let config = McpServerConfig {
        id: id.clone(),
        name: input.name.trim().to_owned(),
        command: input.command.trim().to_owned(),
        args: input
            .args
            .into_iter()
            .map(|arg| arg.trim().to_owned())
            .collect(),
        env_keys,
        working_dir: input
            .working_dir
            .map(|dir| dir.trim().to_owned())
            .filter(|dir| !dir.is_empty()),
        enabled: input.enabled,
    };
    if let Some(previous) = &existing {
        for key in &previous.env_keys {
            if !config.env_keys.contains(key) {
                secrets.remove_key(&id, key);
            }
        }
        if let Some(index) = servers.iter().position(|item| item.id == id) {
            servers[index] = config.clone();
        }
    } else {
        servers.push(config.clone());
    }
    store.write_servers(&servers)?;
    // El comando, los argumentos o el entorno pueden haber cambiado: la sesión
    // viva ya no representa esta configuración.
    sessions.close(&id);
    Ok(config)
}

pub fn delete_server(
    store: &dyn McpServerStore,
    secrets: &dyn McpEnvSecrets,
    sessions: &SessionRegistry,
    id: &str,
) -> Result<(), ProjectError> {
    let mut servers = store.read_servers()?;
    if let Some(index) = servers.iter().position(|item| item.id == id) {
        let removed = servers.remove(index);
        secrets.remove_env(&removed);
        store.write_servers(&servers)?;
        sessions.close(id);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Probe efímero (arranca, lista herramientas, cierra)
// ---------------------------------------------------------------------------

pub fn probe_server(
    store: &dyn McpServerStore,
    secrets: &dyn McpEnvSecrets,
    factory: &dyn McpTransportFactory,
    id: &str,
) -> Result<McpProbeResult, ProjectError> {
    let server = find_server(store, id)?;
    require_enabled(&server)?;
    let env = secrets.read_env(&server)?;
    probe_config(factory, &server, &env)
}

/// Probe directo sobre una config (sin store): lo usan los tests live.
pub fn probe_config(
    factory: &dyn McpTransportFactory,
    server: &McpServerConfig,
    env: &BTreeMap<String, String>,
) -> Result<McpProbeResult, ProjectError> {
    require_enabled(server)?;
    let started = Instant::now();
    let mut transport = factory.spawn(server, env)?;
    // `transport` se descarta al volver (Drop → kill_tree): la prueba nunca
    // deja un servidor corriendo.
    probe_transport(&mut *transport, &server.id, started)
}

// ---------------------------------------------------------------------------
// Sesiones persistentes
// ---------------------------------------------------------------------------

struct SessionEntry {
    transport: Box<dyn McpTransport>,
    initialized: bool,
    next_id: u64,
    started_at: SystemTime,
    last_used: Instant,
    calls: u64,
}

type SessionHandle = Arc<Mutex<SessionEntry>>;

/// Registro global de sesiones MCP vivas. El registry es inyectable para
/// que los tests puedan crear instancias aisladas.
pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, SessionHandle>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl SessionRegistry {
    fn map(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, SessionHandle>>, ProjectError> {
        self.sessions.lock().map_err(|_| {
            error(
                ProjectErrorCode::ProviderUnavailable,
                "el registro de sesiones MCP quedó en un estado inválido",
            )
        })
    }

    /// Cierra las sesiones inactivas. Se llama con el registro tomado.
    ///
    /// Usa `try_lock` a propósito: si otra llamada está usando la sesión, se
    /// saltea. Nunca se toma el candado de una sesión mientras se tiene el
    /// del registro, que es como se produciría un abrazo mortal.
    fn reap_idle_locked(&self, registry: &mut HashMap<String, SessionHandle>) {
        let mut stale = Vec::new();
        for (id, handle) in registry.iter() {
            if let Ok(entry) = handle.try_lock() {
                if entry.last_used.elapsed() > SESSION_IDLE_TIMEOUT {
                    stale.push(id.clone());
                }
            }
        }
        for id in stale {
            // Al soltar el último Arc, SessionEntry → transport → Drop cierra
            // el árbol de procesos.
            registry.remove(&id);
        }
    }

    fn open(
        &self,
        factory: &dyn McpTransportFactory,
        server: &McpServerConfig,
        env: &BTreeMap<String, String>,
    ) -> Result<SessionHandle, ProjectError> {
        let mut registry = self.map()?;
        self.reap_idle_locked(&mut registry);
        if let Some(existing) = registry.get(&server.id) {
            return Ok(existing.clone());
        }
        if registry.len() >= MAX_SESSIONS {
            // Se libera la sesión más ociosa que no esté en uso.
            let candidate = registry
                .iter()
                .filter_map(|(id, handle)| {
                    handle
                        .try_lock()
                        .ok()
                        .map(|entry| (id.clone(), entry.last_used))
                })
                .min_by_key(|(_, last_used)| *last_used)
                .map(|(id, _)| id);
            match candidate {
                Some(id) => {
                    registry.remove(&id);
                }
                None => {
                    return Err(error(
                        ProjectErrorCode::ProviderUnavailable,
                        "hay demasiadas sesiones MCP activas; cerrá una antes de abrir otra",
                    ));
                }
            }
        }
        let transport = factory.spawn(server, env)?;
        let entry = Arc::new(Mutex::new(SessionEntry {
            transport,
            initialized: false,
            next_id: 2,
            started_at: SystemTime::now(),
            last_used: Instant::now(),
            calls: 0,
        }));
        registry.insert(server.id.clone(), entry.clone());
        Ok(entry)
    }

    /// Descarta la sesión de un servidor. La próxima llamada arranca de cero.
    pub fn close(&self, server_id: &str) -> bool {
        let Ok(mut registry) = self.map() else {
            return false;
        };
        registry.remove(server_id).is_some()
    }

    pub fn infos(&self) -> Vec<McpSessionInfo> {
        let Ok(mut registry) = self.map() else {
            return Vec::new();
        };
        self.reap_idle_locked(&mut registry);
        let mut infos = Vec::new();
        for (id, handle) in registry.iter() {
            if let Ok(entry) = handle.try_lock() {
                infos.push(McpSessionInfo {
                    server_id: id.clone(),
                    pid: entry.transport.pid(),
                    calls: entry.calls,
                    started_at_ms: entry
                        .started_at
                        .duration_since(UNIX_EPOCH)
                        .map(|value| value.as_millis() as u64)
                        .unwrap_or(0),
                    idle_ms: entry.last_used.elapsed().as_millis() as u64,
                });
            }
        }
        infos.sort_by(|a, b| a.server_id.cmp(&b.server_id));
        infos
    }
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Registry compartido del proceso: las sesiones MCP sobreviven entre
/// comandos IPC.
pub fn shared_sessions() -> &'static SessionRegistry {
    static SESSIONS: OnceLock<SessionRegistry> = OnceLock::new();
    SESSIONS.get_or_init(SessionRegistry::new)
}

// ---------------------------------------------------------------------------
// tools/call con sesión persistente
// ---------------------------------------------------------------------------

/// Llamada directa sobre config+env (tests live y camino interno).
pub fn call_config(
    registry: &SessionRegistry,
    factory: &dyn McpTransportFactory,
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
    let handle = registry.open(factory, server, env)?;
    let mut entry = handle.lock().map_err(|_| {
        error(
            ProjectErrorCode::ProviderUnavailable,
            "la sesión MCP quedó en un estado inválido",
        )
    })?;

    let outcome = (|| {
        if !entry.initialized {
            transport_handshake(&mut *entry.transport)?;
            entry.initialized = true;
        }
        let id = entry.next_id;
        entry.next_id += 1;
        let (result, is_error) =
            call_transport(&mut *entry.transport, id, tool, &arguments, CALL_TIMEOUT)?;
        Ok((result, is_error))
    })();

    match outcome {
        Ok((result, is_error)) => {
            entry.calls += 1;
            entry.last_used = Instant::now();
            Ok(McpCallResult {
                server_id: server.id.clone(),
                tool_name: tool.to_owned(),
                result,
                is_error,
                elapsed_ms: started.elapsed().as_millis() as u64,
            })
        }
        Err(failure) => {
            // Una sesión que falló al hablar no se reutiliza: puede haber
            // quedado a medio inicializar o con el proceso muerto.
            drop(entry);
            registry.close(&server.id);
            Err(failure)
        }
    }
}

/// `tools/call` por id de servidor (camino IPC).
pub fn call_tool(
    registry: &SessionRegistry,
    store: &dyn McpServerStore,
    secrets: &dyn McpEnvSecrets,
    factory: &dyn McpTransportFactory,
    id: &str,
    tool: &str,
    arguments: Value,
) -> Result<McpCallResult, ProjectError> {
    let server = find_server(store, id)?;
    require_enabled(&server)?;
    if tool.trim().is_empty() || tool.chars().count() > 200 {
        return Err(error(
            ProjectErrorCode::InvalidProject,
            "la herramienta MCP no tiene un nombre válido",
        ));
    }
    let env = secrets.read_env(&server)?;
    call_config(registry, factory, &server, &env, tool.trim(), arguments)
}

#[cfg(test)]
#[path = "mcp.tests.rs"]
mod tests;
