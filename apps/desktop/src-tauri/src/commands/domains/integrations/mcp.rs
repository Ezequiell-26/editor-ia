//! Adaptadores IPC del cliente MCP. La lógica vive en
//! `application::mcp`; aquí sólo se resuelven los puertos desde `AppState`
//! y se delega.

use serde_json::Value;
use tauri::State;

use crate::application::mcp;
use crate::mcp::client::{
    McpCallResult, McpProbeResult, McpServerConfig, McpServerInput, McpSessionInfo,
};
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn list_mcp_servers(
    state: State<'_, AppState>,
) -> Result<Vec<McpServerConfig>, ProjectError> {
    let store = state.mcp_store();
    mcp::list_servers(&store)
}

#[tauri::command]
pub async fn save_mcp_server(
    state: State<'_, AppState>,
    server: McpServerInput,
) -> Result<McpServerConfig, ProjectError> {
    let store = state.mcp_store();
    let secrets = state.mcp_env();
    tauri::async_runtime::spawn_blocking(move || {
        mcp::save_server(&store, &secrets, mcp::shared_sessions(), server)
    })
    .await
    .map_err(|_| {
        crate::mcp::client::error(
            crate::projects::service::ProjectErrorCode::ProviderUnavailable,
            "no se pudo guardar el servidor MCP",
        )
    })?
}

#[tauri::command]
pub async fn delete_mcp_server(state: State<'_, AppState>, id: String) -> Result<(), ProjectError> {
    let store = state.mcp_store();
    let secrets = state.mcp_env();
    tauri::async_runtime::spawn_blocking(move || {
        mcp::delete_server(&store, &secrets, mcp::shared_sessions(), &id)
    })
    .await
    .map_err(|_| {
        crate::mcp::client::error(
            crate::projects::service::ProjectErrorCode::ProviderUnavailable,
            "no se pudo borrar el servidor MCP",
        )
    })?
}

#[tauri::command]
pub async fn probe_mcp_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<McpProbeResult, ProjectError> {
    let store = state.mcp_store();
    let secrets = state.mcp_env();
    let factory = state.mcp_factory();
    tauri::async_runtime::spawn_blocking(move || mcp::probe_server(&store, &secrets, &factory, &id))
        .await
        .map_err(|_| {
            crate::mcp::client::error(
                crate::projects::service::ProjectErrorCode::ProviderUnavailable,
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
    let store = state.mcp_store();
    let secrets = state.mcp_env();
    let factory = state.mcp_factory();
    tauri::async_runtime::spawn_blocking(move || {
        mcp::call_tool(
            mcp::shared_sessions(),
            &store,
            &secrets,
            &factory,
            &id,
            &tool,
            arguments,
        )
    })
    .await
    .map_err(|_| {
        crate::mcp::client::error(
            crate::projects::service::ProjectErrorCode::ProviderUnavailable,
            "la llamada al servidor MCP no pudo completarse",
        )
    })?
}

#[tauri::command]
pub async fn close_mcp_session(id: String) -> Result<bool, ProjectError> {
    Ok(mcp::shared_sessions().close(&id))
}

#[tauri::command]
pub async fn mcp_session_status() -> Result<Vec<McpSessionInfo>, ProjectError> {
    Ok(mcp::shared_sessions().infos())
}
