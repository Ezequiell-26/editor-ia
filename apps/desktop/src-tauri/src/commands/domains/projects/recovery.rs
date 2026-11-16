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
    _app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<MissingAssetInfo>, ProjectError> {
    let session = state.project_session();
    let environment = state.project_environment();
    let documents = state.project_documents();
    let recovery = state.project_asset_recovery();
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
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
    new_path: String,
) -> Result<RelinkResult, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let recovery = state.project_asset_recovery();
    let result =
        use_cases::relink_asset(&session, &documents, &recovery, &asset_id, &new_path)?;
    // Si el relink dejó el asset apuntando fuera del proyecto (sin copia),
    // su preview por asset:// necesita el archivo concedido al scope.
    if result.ok {
        if let Some(path) = result.path.as_deref() {
            let resolved = Path::new(path);
            let resolved = if resolved.is_absolute() {
                resolved.to_path_buf()
            } else if let Ok(info) = state.require_session() {
                info.root.join(resolved)
            } else {
                resolved.to_path_buf()
            };
            crate::commands::allow_asset_protocol_file(&app, &resolved);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn relink_assets_from_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
    folder: String,
) -> Result<RelinkFolderResult, ProjectError> {
    let session = state.project_session();
    let environment = state.project_environment();
    let documents = state.project_documents();
    let recovery = state.project_asset_recovery();
    let result = use_cases::relink_assets_from_folder(
        &session,
        &environment,
        &documents,
        &recovery,
        project_path.as_deref(),
        &folder,
    )?;
    // Mismo motivo que `relink_asset`: assets repuntados fuera del proyecto
    // necesitan su archivo en el scope del asset protocol.
    if let Ok(info) = state.require_session() {
        for relinked in &result.relinked {
            if !relinked.ok {
                continue;
            }
            if let Some(path) = relinked.path.as_deref() {
                let resolved = Path::new(path);
                let resolved = if resolved.is_absolute() {
                    resolved.to_path_buf()
                } else {
                    info.root.join(resolved)
                };
                crate::commands::allow_asset_protocol_file(&app, &resolved);
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn find_duplicate_assets(
    _app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<DuplicateAssetGroup>, ProjectError> {
    let session = state.project_session();
    let environment = state.project_environment();
    let documents = state.project_documents();
    let recovery = state.project_asset_recovery();
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
    _app: AppHandle,
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<ProjectVersionInfo>, ProjectError> {
    let session = state.project_session();
    let environment = state.project_environment();
    let versioning = state.project_versioning();
    use_cases::list_project_versions(&session, &environment, &versioning, project_path.as_deref())
}

#[tauri::command]
pub async fn restore_project_version(
    state: State<'_, AppState>,
    project_path: String,
    version_id: String,
    mode: Option<String>,
) -> Result<RestoreProjectVersionResult, ProjectError> {
    let versioning = state.project_versioning();
    use_cases::restore_project_version(&versioning, &project_path, &version_id, mode.as_deref())
}
