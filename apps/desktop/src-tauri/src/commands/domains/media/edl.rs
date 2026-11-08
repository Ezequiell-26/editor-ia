//! Exportación CMX 3600 EDL desde el esquema de Editor IA.
//! Lleva la timeline a Resolve/Premiere sin fingir efectos que el EDL no soporta.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::infrastructure::media::LocalTimelineExportFiles;
use crate::projects::service::ProjectError;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdlRequest {
    pub project: Value,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EdlResult {
    pub path: String,
    pub bytes: u64,
    pub events: usize,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn export_edl(request: EdlRequest) -> Result<EdlResult, ProjectError> {
    let outcome = crate::application::timeline_export::export_edl(
        &LocalTimelineExportFiles,
        &request.project,
        &request.output_dir,
    )?;
    Ok(EdlResult {
        path: outcome.path,
        bytes: outcome.bytes,
        events: outcome.items,
        warnings: outcome.warnings,
    })
}
