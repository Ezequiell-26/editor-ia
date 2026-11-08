//! Motion suggestions through the configured AI provider — adaptador IPC.
//! Reglas en `ai::motion`, orquestación en `application::motion`, HTTP en
//! `infrastructure::ai::ReqwestMotionChat`.

pub use crate::ai::motion::{MotionRequest, MotionSuggestion};

use tauri::State;

use crate::infrastructure::ai::{KeyringProviderSecrets, ReqwestMotionChat, StateProviderSettings};
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn generate_motion(
    state: State<'_, AppState>,
    request: MotionRequest,
) -> Result<MotionSuggestion, ProjectError> {
    let store = StateProviderSettings::new(&state);
    crate::application::motion::generate_motion(
        &store,
        &KeyringProviderSecrets,
        &ReqwestMotionChat,
        request,
    )
    .await
}
