//! Fase 1 · recuperación de proyectos, assets faltantes y duplicados.
//!
//! Adaptador IPC delgado: los casos de uso viven en `application::projects`
//! y la complejidad de filesystem/hashing en `infrastructure::projects_recovery`.
//! Sólo `choose_media_folder` queda aquí porque es un diálogo nativo puro.
//!
//! Contrato expuesto al frontend (camelCase):
//! - `choose_media_folder(title?)` → `Option<String>`
//! - `find_missing_assets(projectPath?)` → `MissingAssetInfo[]`
//! - `relink_asset(assetId, newPath)` → `RelinkResult`
//! - `relink_assets_from_folder(projectPath?, folder)` → `RelinkFolderResult`
//! - `find_duplicate_assets(projectPath?)` → `DuplicateAssetGroup[]`
//! - `list_project_versions(projectPath?)` → `ProjectVersionInfo[]`
//! - `restore_project_version(projectPath, versionId, mode?)` → `RestoreProjectVersionResult`

use std::path::Path;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::application::projects as use_cases;
use crate::infrastructure::projects::{
    LocalProjectDocuments, StateProjectSession, TauriProjectEnvironment,
};
use crate::infrastructure::projects_history::LocalProjectVersioning;
use crate::infrastructure::projects_recovery::LocalProjectAssetRecovery;
use crate::ports::projects::{
    DuplicateAssetGroup, MissingAssetInfo, ProjectVersionInfo, RelinkFolderResult, RelinkResult,
    RestoreProjectVersionResult,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

fn absolute(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
pub async fn choose_media_folder(
    app: tauri::AppHandle,
    title: Option<String>,
) -> Result<Option<String>, ProjectError> {
    let mut dialog = app.dialog().file();
    if let Some(title) = title.as_deref().filter(|value| !value.trim().is_empty()) {
        dialog = dialog.set_title(title);
    }
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la carpeta elegida")
    })?;
    Ok(Some(absolute(&path)))
}

#[tauri::command]
pub async fn find_missing_assets(
    app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<MissingAssetInfo>, ProjectError> {
    let session = StateProjectSession::new(&state);
    let environment = TauriProjectEnvironment::new(&app);
    let documents = LocalProjectDocuments;
    let recovery = LocalProjectAssetRecovery;
    use_cases::find_missing_assets(
        &session,
        &environment,
        &documents,
        &recovery,
        project_path.as_deref(),
    )
}

#[tauri::command]
pub async fn relink_asset(
    state: State<'_, AppState>,
    asset_id: String,
    new_path: String,
) -> Result<RelinkResult, ProjectError> {
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let recovery = LocalProjectAssetRecovery;
    use_cases::relink_asset(&session, &documents, &recovery, &asset_id, &new_path)
}

#[tauri::command]
pub async fn relink_assets_from_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
    folder: String,
) -> Result<RelinkFolderResult, ProjectError> {
    let session = StateProjectSession::new(&state);
    let environment = TauriProjectEnvironment::new(&app);
    let documents = LocalProjectDocuments;
    let recovery = LocalProjectAssetRecovery;
    use_cases::relink_assets_from_folder(
        &session,
        &environment,
        &documents,
        &recovery,
        project_path.as_deref(),
        &folder,
    )
}

#[tauri::command]
pub async fn find_duplicate_assets(
    app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<DuplicateAssetGroup>, ProjectError> {
    let session = StateProjectSession::new(&state);
    let environment = TauriProjectEnvironment::new(&app);
    let documents = LocalProjectDocuments;
    let recovery = LocalProjectAssetRecovery;
    use_cases::find_duplicate_assets(
        &session,
        &environment,
        &documents,
        &recovery,
        project_path.as_deref(),
    )
}

#[tauri::command]
pub async fn list_project_versions(
    app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<ProjectVersionInfo>, ProjectError> {
    let session = StateProjectSession::new(&state);
    let environment = TauriProjectEnvironment::new(&app);
    let versioning = LocalProjectVersioning;
    use_cases::list_project_versions(&session, &environment, &versioning, project_path.as_deref())
}

#[tauri::command]
pub async fn restore_project_version(
    project_path: String,
    version_id: String,
    mode: Option<String>,
) -> Result<RestoreProjectVersionResult, ProjectError> {
    let versioning = LocalProjectVersioning;
    use_cases::restore_project_version(&versioning, &project_path, &version_id, mode.as_deref())
}
