//! Importación de timelines EDL, OTIO y FCPXML — adaptador IPC.
//!
//! Los formatos son un intercambio, no una promesa de paridad: se importan
//! pistas, cortes y ventanas de origen; las transiciones, efectos y clips
//! conectados que el formato no puede representar se avisan y no se inventan.
//! Los medios referenciados se copian al proyecto con el mismo importador que
//! usa Medios, y los assets se devuelven para que la UI los agregue con undo.
//!
//! El parseo vive en `crate::media::timeline_import` y la orquestación en
//! `application::timeline_import`.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::system::resolve_tools;
use crate::ports::media::TimelineImportResult;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineImportRequest {
    pub project: Value,
    pub path: String,
    #[serde(default)]
    pub confirm_rights: bool,
}

#[tauri::command]
pub async fn choose_timeline_file(app: AppHandle) -> Result<Option<String>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Importar timeline EDL, OTIO o FCPXML")
        .add_filter("Intercambio de timeline", &["edl", "otio", "fcpxml", "xml"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn import_timeline(
    state: State<'_, AppState>,
    request: TimelineImportRequest,
) -> Result<TimelineImportResult, ProjectError> {
    if !request.confirm_rights {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "confirmá que tenés derechos para importar los medios referenciados por la timeline",
        ));
    }
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe no está disponible; sin medir los medios no se puede importar la timeline",
        ));
    };
    let root = session.root.clone();
    let path = PathBuf::from(request.path.trim());
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de timeline elegido ya no existe",
        ));
    }
    let project = request.project;
    tauri::async_runtime::spawn_blocking(move || {
        crate::application::timeline_import::import_timeline_file(&root, &ffprobe, &path, &project)
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("la importación de la timeline se interrumpió: {error}").as_str(),
        )
    })?
}
