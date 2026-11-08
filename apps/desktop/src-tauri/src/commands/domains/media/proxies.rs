//! Proxies de vista previa — adaptador IPC.
//!
//! La lógica vive en `application::proxies` sobre los puertos
//! `ProxyRuntime`/`ProxyFiles`/`ProxyEvents`/`ProxyGenerator` (y los de
//! sesión/documentos/media compartidos); las reglas puras en
//! `media::proxy`. Acá sólo queda el contrato IPC: mismos nombres,
//! payloads y tipos serde.

use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::application::proxies::{self, ProxyDeps};
use crate::infrastructure::media::StateMediaTools;
use crate::infrastructure::projects::{LocalProjectDocuments, StateProjectSession};
use crate::infrastructure::proxies::{
    LocalProxyFiles, LocalProxyRuntime, StdioProxyGenerator, TauriProxyEvents,
};
use crate::media::proxy::{ProxyCleanupResult, ProxyStatus};
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn proxy_status(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<ProxyStatus, ProjectError> {
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let runtime = LocalProxyRuntime;
    let files = LocalProxyFiles;
    let events = TauriProxyEvents::new(app);
    let tools = StateMediaTools::new(&state);
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
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
    quality: Option<String>,
) -> Result<ProxyStatus, ProjectError> {
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let runtime = LocalProxyRuntime;
    let files = LocalProxyFiles;
    let events = TauriProxyEvents::new(app.clone());
    let tools = StateMediaTools::new(&state);
    let deps = ProxyDeps {
        session: &session,
        documents: &documents,
        runtime: &runtime,
        files: &files,
        events: &events,
        tools: &tools,
    };
    let generator = StdioProxyGenerator::new(
        Arc::new(LocalProxyRuntime),
        Arc::new(TauriProxyEvents::new(app)),
        Arc::new(LocalProxyFiles),
    );
    proxies::ensure_proxy(&deps, &generator, &asset_id, quality.as_deref())
}

#[tauri::command]
pub async fn cancel_proxy(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<ProxyStatus, ProjectError> {
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let runtime = LocalProxyRuntime;
    let files = LocalProxyFiles;
    let events = TauriProxyEvents::new(app);
    let tools = StateMediaTools::new(&state);
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
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<Option<Value>, ProjectError> {
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let runtime = LocalProxyRuntime;
    let files = LocalProxyFiles;
    let events = TauriProxyEvents::new(app);
    let tools = StateMediaTools::new(&state);
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
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: Option<String>,
) -> Result<ProxyCleanupResult, ProjectError> {
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let runtime = LocalProxyRuntime;
    let files = LocalProxyFiles;
    let events = TauriProxyEvents::new(app);
    let tools = StateMediaTools::new(&state);
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
