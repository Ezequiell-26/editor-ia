//! Exportación OpenTimelineIO (`.otio` JSON) desde la timeline de Editor IA.
//! Es un intercambio propio; no usa el modelo de FilmCraft para no fingir un
//! adaptador que todavía no existe.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infrastructure::media::LocalTimelineExportFiles;
use crate::projects::service::ProjectError;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtioRequest {
    pub project: Value,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtioResult {
    pub path: String,
    pub bytes: u64,
    pub tracks: usize,
    pub clips: usize,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn export_otio(request: OtioRequest) -> Result<OtioResult, ProjectError> {
    let outcome = crate::application::timeline_export::export_otio(
        &LocalTimelineExportFiles,
        &request.project,
        &request.output_dir,
    )?;
    Ok(OtioResult {
        path: outcome.path,
        bytes: outcome.bytes,
        tracks: outcome.tracks,
        clips: outcome.items,
        warnings: outcome.warnings,
    })
}
