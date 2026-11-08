//! Floating Olyvia assistant — adaptadores IPC.
//!
//! El proveedor sólo devuelve texto más una acción pequeña de una allowlist;
//! el frontend la revalida y la ejecuta por las mismas APIs de store/
//! navegación que la UI. Este módulo nunca muta un proyecto directamente.
//!
//! Reglas puras en `ai::assistant`, orquestación en `application::assistant`,
//! keyring/settings/HTTP en `infrastructure::ai` + `ports::ai`. El worker de
//! streaming SSE queda en `assistant/stream.rs` (include!) consumiendo el
//! dominio.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::commands::providers::{
    chat_endpoint, is_local_endpoint, read_key, validate_provider_base_url,
};
use crate::infrastructure::ai::{
    KeyringProviderSecrets, ReqwestMediaMatchChat, ReqwestProviderChat, StateProviderSettings,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

// Todo lo puro del asistente (DTOs, validación, acciones, contexto, parser
// SSE, registro de streams, media match) vive en el dominio.
pub use crate::ai::assistant::*;

#[tauri::command]
pub async fn assistant_chat(
    state: State<'_, AppState>,
    request: AssistantRequest,
) -> Result<AssistantReply, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::assistant::assistant_chat(
        &store,
        &KeyringProviderSecrets,
        &ReqwestProviderChat,
        request,
    )
    .await
}

#[tauri::command]
pub async fn match_media_plan(
    state: State<'_, AppState>,
    request: MatchMediaRequest,
) -> Result<MatchMediaReply, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::assistant::match_media_plan(
        &store,
        &KeyringProviderSecrets,
        &ReqwestMediaMatchChat,
        request,
    )
    .await
}

include!("assistant/stream.rs");
