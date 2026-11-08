//! Casos de uso del servidor MCP embebido: dispatcher JSON-RPC/batch
//! sobre el bridge de herramientas, ciclo de vida del listener y
//! autoconexión de clientes de IA externos.
//!
//! El socket, el keyring y la emisión de eventos viven en
//! `infrastructure::mcp_server`; aquí sólo hay orquestación sobre ports.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use serde_json::{json, Value};
use tauri::async_runtime;

use crate::mcp::server::{
    self, batch_task_error, call_parts, classify_request, collect_read_only_tools,
    empty_batch_error, is_parallel_read_request, rpc_error, rpc_result, tool_result,
    AutoconnectResult, DetectedClient, McpServerInfo, BRIDGE_TIMEOUT, MCP_PORT,
};
use crate::ports::mcp_server::{
    AiClientConfigs, McpRequestHandler, McpServerToken, McpToolInvoker,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

// ---------------------------------------------------------------------------
// Estado del servidor (info publicada + cerrojo de arranque)
// ---------------------------------------------------------------------------

fn info_slot() -> &'static Mutex<Option<McpServerInfo>> {
    static INFO: OnceLock<Mutex<Option<McpServerInfo>>> = OnceLock::new();
    INFO.get_or_init(|| Mutex::new(None))
}

fn start_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub fn status() -> Option<McpServerInfo> {
    info_slot().lock().ok().and_then(|guard| guard.clone())
}

fn set_info(info: Option<McpServerInfo>) {
    if let Ok(mut guard) = info_slot().lock() {
        *guard = info;
    }
}

/// Arranca el servidor si no está corriendo. `serve` es el adaptador de
/// infrastructure que hace bind + accept loop; se invoca con el token y el
/// handler ya construido.
pub async fn start_server<S, F>(
    token_store: &S,
    handler: Arc<dyn McpRequestHandler>,
    serve: F,
) -> Result<McpServerInfo, ProjectError>
where
    S: McpServerToken + ?Sized,
    F: FnOnce(String, Arc<dyn McpRequestHandler>) -> Result<(), ProjectError>,
{
    let _start_guard = start_lock().lock().await;
    if let Some(existing) = status() {
        return Ok(existing);
    }
    let token = token_store.get_or_create()?;
    let info = McpServerInfo {
        url: format!("http://127.0.0.1:{MCP_PORT}/mcp"),
        token: token.clone(),
    };
    serve(token, handler)?;
    set_info(Some(info.clone()));
    Ok(info)
}

// ---------------------------------------------------------------------------
// Herramientas read-only publicadas por la ventana (para lotes paralelos)
// ---------------------------------------------------------------------------

fn read_only_tools() -> &'static RwLock<HashSet<String>> {
    static TOOLS: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        let fallback = server::tools();
        let names = fallback
            .as_array()
            .map(|items| collect_read_only_tools(items))
            .unwrap_or_default();
        RwLock::new(names)
    })
}

fn cache_read_only_tools(items: &[Value]) {
    if let Ok(mut cached) = read_only_tools().write() {
        *cached = collect_read_only_tools(items);
    }
}

fn read_only_snapshot() -> HashSet<String> {
    read_only_tools()
        .read()
        .map(|set| set.clone())
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Dispatcher JSON-RPC
// ---------------------------------------------------------------------------

/// Implementación de `McpRequestHandler` sobre un invoker concreto.
pub struct RpcDispatcher<I: McpToolInvoker> {
    invoker: Arc<I>,
}

impl<I: McpToolInvoker> RpcDispatcher<I> {
    pub fn new(invoker: I) -> Self {
        Self {
            invoker: Arc::new(invoker),
        }
    }

    async fn dispatch(invoker: &I, message: &Value) -> Option<Value> {
        let request = classify_request(message);
        let id = match request {
            server::RpcRequest::Notification => return None,
            server::RpcRequest::Reject(response) => return Some(response),
            server::RpcRequest::Call(id) => id,
        };
        let (method, name, args) = call_parts(message);
        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": "2025-06-18",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "olyvia", "version": env!("CARGO_PKG_VERSION") }
            })),
            "ping" => Ok(json!({})),
            "tools/list" => {
                // El catálogo real vive en el frontend (`mcp-catalog.ts`): si
                // la ventana no responde, queda el catálogo mínimo de respaldo.
                let reply = invoker
                    .invoke("__catalog", &json!({}), std::time::Duration::from_secs(5))
                    .await;
                let listed = reply
                    .text
                    .parse::<Value>()
                    .ok()
                    .and_then(|value| value.as_array().cloned())
                    .filter(|items| !items.is_empty())
                    .unwrap_or_else(|| server::tools().as_array().cloned().unwrap_or_default());
                // La lista publicada decide qué llamadas se pueden adelantar
                // en lotes; el fallback sólo se usa cuando la UI no está.
                cache_read_only_tools(&listed);
                Ok(json!({ "tools": listed }))
            }
            "tools/call" => {
                if name.is_empty() {
                    Err((-32602, "falta el nombre de la herramienta".to_owned()))
                } else {
                    let reply = invoker.invoke(name, args, BRIDGE_TIMEOUT).await;
                    Ok(tool_result(&reply.text, !reply.ok))
                }
            }
            _ => Err((-32601, format!("método desconocido: {method}"))),
        };
        Some(match result {
            Ok(value) => rpc_result(&id, value),
            Err((code, text)) => rpc_error(&id, code, &text),
        })
    }
}

impl<I: McpToolInvoker + Send + Sync + 'static> McpRequestHandler for RpcDispatcher<I> {
    fn handle(
        &self,
        request: &Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<Value>> + Send + '_>> {
        let invoker = self.invoker.clone();
        let request = request.clone();
        Box::pin(async move { Self::dispatch(&invoker, &request).await })
    }

    fn handle_batch(
        &self,
        items: &[Value],
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Value> + Send + '_>> {
        let invoker = self.invoker.clone();
        let items = items.to_vec();
        Box::pin(async move {
            if items.is_empty() {
                return empty_batch_error();
            }
            let mut answers = vec![None; items.len()];
            let read_only = read_only_snapshot();

            if items
                .iter()
                .all(|message| is_parallel_read_request(&read_only, message))
            {
                for (chunk_index, chunk) in
                    items.chunks(server::MAX_PARALLEL_BATCH_READS).enumerate()
                {
                    let base_index = chunk_index * server::MAX_PARALLEL_BATCH_READS;
                    let mut handles = Vec::with_capacity(chunk.len());
                    for message in chunk {
                        let invoker = invoker.clone();
                        let cloned = message.clone();
                        handles.push(async_runtime::spawn(async move {
                            Self::dispatch(&invoker, &cloned).await
                        }));
                    }
                    for (offset, (message, handle)) in chunk.iter().zip(handles).enumerate() {
                        answers[base_index + offset] = match handle.await {
                            Ok(answer) => answer,
                            Err(_) if !message["id"].is_null() => {
                                Some(batch_task_error(&message["id"]))
                            }
                            Err(_) => None,
                        };
                    }
                }
            } else {
                // Los lotes mixtos pueden depender del orden (por ejemplo,
                // editar y luego leer).
                for (index, message) in items.iter().enumerate() {
                    answers[index] = Self::dispatch(&invoker, message).await;
                }
            }

            Value::Array(answers.into_iter().flatten().collect())
        })
    }
}

// ---------------------------------------------------------------------------
// Clientes externos
// ---------------------------------------------------------------------------

/// Clientes conocidos con su estado de instalación real en este equipo.
pub fn detect_clients(clients: &dyn AiClientConfigs) -> Vec<DetectedClient> {
    clients.detect()
}

/// Verifica que el cliente exista en el catálogo y esté instalado, antes
/// de arrancar el servidor (evita levantar el listener al pedo).
pub fn ensure_client_ready(
    clients: &dyn AiClientConfigs,
    client: &str,
) -> Result<(), ProjectError> {
    if !known_client(client) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("cliente MCP desconocido: {client}"),
        ));
    }
    if !clients.installed(client) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            &format!(
                "no encontramos esa app instalada en este equipo; descargala de {} y volvé a tocar el botón",
                clients.download_url(client)
            ),
        ));
    }
    Ok(())
}

/// Escribe la entrada `olyvia` en la config del cliente ya instalado.
pub fn autoconnect_client(
    clients: &dyn AiClientConfigs,
    client: &str,
    info: &McpServerInfo,
) -> Result<AutoconnectResult, ProjectError> {
    ensure_client_ready(clients, client)?;
    let path = clients.config_path(client)?;
    clients.write_olyvia_entry(&path, info)
}

/// Atajo para el comando: valida que el cliente exista en el catálogo.
pub fn known_client(client: &str) -> bool {
    server::known_clients()
        .iter()
        .any(|(id, _, _)| *id == client)
}

/// Error helper para respuestas de tools/call.
pub fn rpc_tool_error(id: &Value, message: &str) -> Value {
    rpc_error(id, -32603, message)
}
