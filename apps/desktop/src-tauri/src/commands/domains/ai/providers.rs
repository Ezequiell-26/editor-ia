//! AI provider settings and the structured generators — adaptadores IPC.
//!
//! Las reglas puras (URLs, payload/repair de chat, parsers de planes) viven en
//! `ai::providers`; la orquestación en `application::providers`; keyring,
//! settings y HTTP en `infrastructure::ai` + `ports::ai`.
//!
//! Los `pub use`/`pub(crate)` de abajo mantienen las rutas
//! `commands::providers::*` que ya consumen assistant, motion_ai y
//! subtitles_pipeline.

use tauri::State;

use crate::infrastructure::ai::{
    KeyringProviderSecrets, ReqwestProviderChat, ReqwestProviderProbe, StateProviderSettings,
};
use crate::ports::ai::ProviderSecrets;
use crate::projects::service::ProjectError;
use crate::state::AppState;

pub use crate::ai::providers::{
    chat_endpoint, extract_json, is_local_endpoint, json_repair_messages,
    validate_provider_base_url, EffectRecipe, EffectRequest, GenerateRequest, ProviderInfo,
    ProviderTestResult, ScriptPlan, ScriptScene, TranslateRequest, TranslatedTexts,
};

/// Fachada síncrona para el worker de streaming del asistente (usa el port `ProviderSecrets`).
pub(crate) fn read_key() -> Option<String> {
    KeyringProviderSecrets.read_key()
}

#[tauri::command]
pub async fn get_provider(state: State<'_, AppState>) -> Result<ProviderInfo, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::providers::get_provider(&store, &KeyringProviderSecrets)
}

#[tauri::command]
pub async fn save_provider(
    state: State<'_, AppState>,
    kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<ProviderInfo, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::providers::save_provider(
        &store,
        &KeyringProviderSecrets,
        kind,
        base_url,
        model,
        api_key,
    )
}

#[tauri::command]
pub async fn clear_provider_key(state: State<'_, AppState>) -> Result<ProviderInfo, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::providers::clear_provider_key(&store, &KeyringProviderSecrets)
}

#[tauri::command]
pub async fn generate_script(
    state: State<'_, AppState>,
    request: GenerateRequest,
) -> Result<ScriptPlan, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::providers::generate_script(
        &store,
        &KeyringProviderSecrets,
        &ReqwestProviderChat,
        request,
    )
    .await
}

#[tauri::command]
pub async fn generate_video_effect(
    state: State<'_, AppState>,
    request: EffectRequest,
) -> Result<EffectRecipe, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::providers::generate_video_effect(
        &store,
        &KeyringProviderSecrets,
        &ReqwestProviderChat,
        request,
    )
    .await
}

#[tauri::command]
pub async fn translate_subtitles(
    state: State<'_, AppState>,
    request: TranslateRequest,
) -> Result<TranslatedTexts, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::providers::translate_subtitles(
        &store,
        &KeyringProviderSecrets,
        &ReqwestProviderChat,
        request,
    )
    .await
}

#[tauri::command]
pub async fn test_provider(state: State<'_, AppState>) -> Result<ProviderTestResult, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::providers::test_provider(
        &store,
        &KeyringProviderSecrets,
        &ReqwestProviderProbe,
    )
    .await
}
