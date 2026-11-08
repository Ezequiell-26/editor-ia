//! Exportación FCPXML 1.11 desde la timeline. Una sola spine; si hay clips
//! solapados se advierte porque FCPXML los trataría como conflicto de pista.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use tauri::State;

use crate::projects::service::ProjectError;
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FcpxmlRequest {
    pub project: Value,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcpxmlResult {
    pub path: String,
    pub bytes: u64,
    pub clips: usize,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn export_fcpxml(
    state: State<'_, AppState>,
    request: FcpxmlRequest,
) -> Result<FcpxmlResult, ProjectError> {
    let outcome = crate::application::timeline_export::export_fcpxml(
        &state.timeline_export_files(),
        &request.project,
        &request.output_dir,
    )?;
    Ok(FcpxmlResult {
        path: outcome.path,
        bytes: outcome.bytes,
        clips: outcome.items,
        warnings: outcome.warnings,
    })
}

#[cfg(test)]
pub(crate) fn export_fcpxml_for_test(request: FcpxmlRequest) -> Result<FcpxmlResult, ProjectError> {
    let outcome = crate::application::timeline_export::export_fcpxml(
        &crate::infrastructure::media::LocalTimelineExportFiles,
        &request.project,
        &request.output_dir,
    )?;
    Ok(FcpxmlResult {
        path: outcome.path,
        bytes: outcome.bytes,
        clips: outcome.items,
        warnings: outcome.warnings,
    })
}
