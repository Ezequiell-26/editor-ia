//! Adaptadores IPC del servidor MCP embebido. La lógica vive en
//! `application::mcp_server`; aquí sólo se arman los adaptadores de
//! infrastructure y se delega.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::application::mcp_server::{self, RpcDispatcher};
use crate::infrastructure::mcp_server::{
    respond_pending, serve_mcp, EnvAiClientConfigs, KeyringMcpServerToken,
};
use crate::infrastructure::mcp_studio::StudioMcpInvoker;
use crate::mcp::server::{AutoconnectResult, DetectedClient, McpServerInfo};
use crate::ports::mcp_server::McpRequestHandler;
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn start_mcp_server(app: AppHandle) -> Result<McpServerInfo, ProjectError> {
    let token_store = KeyringMcpServerToken;
    // Las tools del estudio las ejecuta el backend; el resto va a la ventana.
    let invoker = StudioMcpInvoker::new(app);
    let handler: Arc<dyn McpRequestHandler> = Arc::new(RpcDispatcher::new(invoker));
    mcp_server::start_server(&token_store, handler, |token, handler| {
        serve_mcp(token, handler)
    })
    .await
}

#[tauri::command]
pub fn mcp_server_status() -> Option<McpServerInfo> {
    mcp_server::status()
}

/// Cliente de IA externo (Claude Desktop, Antigravity…) que Olyvia sabe
/// conectar con un botón, y si lo encontró instalado en este equipo.
#[tauri::command]
pub fn mcp_detect_clients() -> Vec<DetectedClient> {
    mcp_server::detect_clients(&EnvAiClientConfigs)
}

/// Conecta Olyvia a un cliente de IA externo con un solo clic: arranca el
/// servidor MCP propio si hace falta y mezcla la entrada "olyvia" en el
/// archivo de configuración de ese cliente, preservando cualquier otro
/// servidor que ya tenga configurado.
#[tauri::command]
pub async fn mcp_server_autoconnect(
    app: AppHandle,
    client: String,
) -> Result<AutoconnectResult, ProjectError> {
    // El cliente se valida antes de levantar el listener, como antes.
    mcp_server::ensure_client_ready(&EnvAiClientConfigs, &client)?;
    let info = start_mcp_server(app).await?;
    mcp_server::autoconnect_client(&EnvAiClientConfigs, &client, &info)
}

/// Respuesta del frontend a un `run_command` pendiente.
#[tauri::command]
pub fn mcp_respond(_state: State<'_, AppState>, id: String, ok: bool, text: String) -> bool {
    respond_pending(&id, ok, text)
}
