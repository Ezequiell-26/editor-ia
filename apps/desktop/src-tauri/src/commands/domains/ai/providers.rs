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

use crate::ports::ai::ProviderSecrets;
use crate::projects::service::ProjectError;
use crate::state::AppState;

pub use crate::ai::providers::{
    chat_endpoint, extract_json, is_local_endpoint, json_repair_messages,
    validate_provider_base_url, EffectRecipe, EffectRequest, GenerateRequest, ProviderInfo,
    ProviderTestResult, ScriptPlan, ScriptScene, TranslateRequest, TranslatedTexts,
};

/// Fachada síncrona para el worker de streaming del asistente (usa el port `ProviderSecrets`).
///
/// EXCEPCIÓN DE ARQUITECTURA (ver docs/architecture/DEPENDENCY-RULES.md):
/// el worker de streaming no recibe `AppState`; se elimina cuando
/// `ProviderSecrets` se inyecte por parámetro en la cadena del stream.
pub(crate) fn read_key() -> Option<String> {
    crate::infrastructure::ai::KeyringProviderSecrets.read_key()
}

#[tauri::command]
pub async fn get_provider(state: State<'_, AppState>) -> Result<ProviderInfo, ProjectError> {
    let store = state.provider_settings();
    crate::application::providers::get_provider(&store, &state.provider_secrets())
}

#[tauri::command]
pub async fn save_provider(
    state: State<'_, AppState>,
    kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<ProviderInfo, ProjectError> {
    let store = state.provider_settings();
    crate::application::providers::save_provider(
        &store,
        &state.provider_secrets(),
        kind,
        base_url,
        model,
        api_key,
    )
}

#[tauri::command]
pub async fn clear_provider_key(state: State<'_, AppState>) -> Result<ProviderInfo, ProjectError> {
    let store = state.provider_settings();
    crate::application::providers::clear_provider_key(&store, &state.provider_secrets())
}

#[tauri::command]
pub async fn generate_script(
    state: State<'_, AppState>,
    request: GenerateRequest,
) -> Result<ScriptPlan, ProjectError> {
    let store = state.provider_settings();
    crate::application::providers::generate_script(
        &store,
        &state.provider_secrets(),
        &state.provider_chat(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn generate_video_effect(
    state: State<'_, AppState>,
    request: EffectRequest,
) -> Result<EffectRecipe, ProjectError> {
    let store = state.provider_settings();
    crate::application::providers::generate_video_effect(
        &store,
        &state.provider_secrets(),
        &state.provider_chat(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn translate_subtitles(
    state: State<'_, AppState>,
    request: TranslateRequest,
) -> Result<TranslatedTexts, ProjectError> {
    let store = state.provider_settings();
    crate::application::providers::translate_subtitles(
        &store,
        &state.provider_secrets(),
        &state.provider_chat(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn test_provider(state: State<'_, AppState>) -> Result<ProviderTestResult, ProjectError> {
    let store = state.provider_settings();
    crate::application::providers::test_provider(
        &store,
        &state.provider_secrets(),
        &state.provider_probe(),
    )
    .await
}
