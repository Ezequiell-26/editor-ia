//! Proxies de vista previa — adaptador IPC.
//!
//! La lógica vive en `application::proxies` sobre los puertos
//! `ProxyRuntime`/`ProxyFiles`/`ProxyEvents`/`ProxyGenerator` (y los de
//! sesión/documentos/media compartidos); las reglas puras en
//! `media::proxy`. Acá sólo queda el contrato IPC: mismos nombres,
//! payloads y tipos serde.

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::application::proxies::{self, ProxyDeps};
use crate::media::proxy::{ProxyCleanupResult, ProxyStatus};
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn proxy_status(
    _app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<ProxyStatus, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let runtime = state.proxy_runtime();
    let files = state.proxy_files();
    let events = state.proxy_events();
    let tools = state.media_tools();
    let deps = ProxyDeps {
        session: &session,
        documents: &documents,
        runtime: &runtime,
        files: &files,
        events: &events,
        tools: &tools,
    };
    proxies::proxy_status(&deps, &asset_id)
}

#[tauri::command]
pub async fn ensure_proxy(
    _app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
    quality: Option<String>,
) -> Result<ProxyStatus, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let runtime = state.proxy_runtime();
    let files = state.proxy_files();
    let events = state.proxy_events();
    let tools = state.media_tools();
    let deps = ProxyDeps {
        session: &session,
        documents: &documents,
        runtime: &runtime,
        files: &files,
        events: &events,
        tools: &tools,
    };
    let generator = state.proxy_generator();
    proxies::ensure_proxy(&deps, &generator, &asset_id, quality.as_deref())
}

#[tauri::command]
pub async fn cancel_proxy(
    _app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<ProxyStatus, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let runtime = state.proxy_runtime();
    let files = state.proxy_files();
    let events = state.proxy_events();
    let tools = state.media_tools();
    let deps = ProxyDeps {
        session: &session,
        documents: &documents,
        runtime: &runtime,
        files: &files,
        events: &events,
        tools: &tools,
    };
    proxies::cancel_proxy(&deps, &asset_id)
}

#[tauri::command]
pub async fn apply_proxy_to_asset(
    _app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<Option<Value>, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let runtime = state.proxy_runtime();
    let files = state.proxy_files();
    let events = state.proxy_events();
    let tools = state.media_tools();
    let deps = ProxyDeps {
        session: &session,
        documents: &documents,
        runtime: &runtime,
        files: &files,
        events: &events,
        tools: &tools,
    };
    proxies::apply_proxy_to_asset(&deps, &asset_id)
}

#[tauri::command]
pub async fn cleanup_proxies(
    _app: AppHandle,
    state: State<'_, AppState>,
    asset_id: Option<String>,
) -> Result<ProxyCleanupResult, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let runtime = state.proxy_runtime();
    let files = state.proxy_files();
    let events = state.proxy_events();
    let tools = state.media_tools();
    let deps = ProxyDeps {
        session: &session,
        documents: &documents,
        runtime: &runtime,
        files: &files,
        events: &events,
        tools: &tools,
    };
    proxies::cleanup_proxies(&deps, asset_id.as_deref())
}
