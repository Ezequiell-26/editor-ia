//! Export de la timeline a formatos de intercambio (AAF/OMF/FCP7XML/FCPXML/
//! EDL/OTIO) vía `filmcraft-interchange`. La construcción del proyecto
//! filmcraft vive en `media::timeline_interchange`; acá queda el comando IPC.

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::State;

use crate::media::timeline_interchange::{export_interchange_bytes, interchange_format};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterchangeExportRequest {
    pub project: Value,
    pub output: String,
    /// aaf|omf|fcp7xml|fcpxml|edl|otio — si se omite se deduce de la extensión.
    pub format: Option<String>,
}

#[tauri::command]
pub async fn export_timeline_interchange(
    state: State<'_, AppState>,
    request: InterchangeExportRequest,
) -> Result<Value, ProjectError> {
    let session = state.require_session()?;
    let root = session.root.clone();
    let output = crate::commands::audio_tools::output_file(&request.output)?;
    let format_name = request
        .format
        .clone()
        .or_else(|| output.extension().map(|e| e.to_string_lossy().into_owned()))
        .unwrap_or_default();
    let format = interchange_format(&format_name).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "formato de salida no soportado: usar .aaf/.omf/.xml(fcp7)/.fcpxml/.edl/.otio",
        )
    })?;
    let format_label = format.name().to_owned();
    let project = request.project;
    let out_path = output.clone();
    let (bytes_len, warnings) = tauri::async_runtime::spawn_blocking(move || {
        let (bytes, warnings) = export_interchange_bytes(&project, &root, format)?;
        std::fs::write(&out_path, &bytes).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo escribir el archivo exportado: {e}"),
            )
        })?;
        Ok::<(usize, Vec<String>), ProjectError>((bytes.len(), warnings))
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("la exportación de la timeline se interrumpió: {error}").as_str(),
        )
    })??;
    Ok(json!({
        "output": output.to_string_lossy(),
        "bytes": bytes_len,
        "format": format_label,
        "warnings": warnings,
    }))
}
