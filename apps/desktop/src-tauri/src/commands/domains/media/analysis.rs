//! Análisis local de medios: detección de escenas y estabilización.
//!
//! Adaptador IPC delgado: la orquestación vive en `application::media` y la
//! ejecución de FFmpeg en `infrastructure::media`. Los helpers puros
//! (`parse_scene_times`, `scene_filter`, `requested_threshold`) están en
//! `crate::media::analysis`.

use tauri::State;

use crate::application::media as use_cases;
use crate::ports::media::{SceneDetection, StabilizationAnalysis};
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub async fn detect_scenes(
    state: State<'_, AppState>,
    asset_id: String,
    threshold: f64,
) -> Result<SceneDetection, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runner = state.media_runner();
    use_cases::detect_scenes(&session, &documents, &tools, &runner, &asset_id, threshold)
}

#[tauri::command]
pub async fn analyze_stabilization(
    state: State<'_, AppState>,
    asset_id: String,
    in_frame: u64,
    out_frame: u64,
    smoothing: u32,
) -> Result<StabilizationAnalysis, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runner = state.media_runner();
    use_cases::analyze_stabilization(
        &session, &documents, &tools, &runner, &asset_id, in_frame, out_frame, smoothing,
    )
}
