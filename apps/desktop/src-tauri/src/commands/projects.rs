//! Project commands: create, open, adopt, save, save-as and close.
//!
//! The dialogs live on the native side. A project is only committed to the
//! native session after the webview has validated it with the canonical schema
//! (`adopt_project`). Until then a failed open cannot redirect the next save to
//! the wrong file.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::media::copy_project_assets;
use crate::projects::service::{self, OpenedProject, ProjectError, ProjectErrorCode};
use crate::state::{AppState, Session};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProjectDto {
    pub project: Value,
    pub path: String,
    pub root: String,
    pub label: String,
}

impl OpenedProjectDto {
    fn from_opened(opened: OpenedProject) -> Self {
        let path = PathBuf::from(&opened.path);
        let root = path
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .unwrap_or_default();
        let label = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| {
                opened.project["name"]
                    .as_str()
                    .unwrap_or("proyecto")
                    .to_owned()
            });
        Self {
            project: opened.project,
            path: opened.path,
            root,
            label,
        }
    }
}

fn safe_file_stem(name: &str) -> String {
    let mut stem = String::new();
    for character in name.trim().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
            stem.push(character.to_ascii_lowercase());
        } else if character.is_whitespace() || matches!(character, '.' | '/' | '\\') {
            if !stem.ends_with('-') {
                stem.push('-');
            }
        }
    }
    let trimmed = stem.trim_matches('-').to_owned();
    if trimmed.is_empty() {
        "proyecto".to_owned()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// Keep an explicit `.json` name exactly as the save dialog confirmed it. Only
/// a name without a JSON extension is completed, and that completion is
/// checked for collisions before writing.
fn ensure_extension(path: PathBuf) -> PathBuf {
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.ends_with(".json") {
        return path;
    }
    PathBuf::from(format!("{}.editoria.json", path.to_string_lossy()))
}

fn pick_project_to_save(
    app: &AppHandle,
    default_name: &str,
) -> Result<Option<PathBuf>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Proyecto de Editor IA", &["json"])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let completed = ensure_extension(picked.clone());
    if completed != picked && completed.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un proyecto con el nombre completo que se agregó automáticamente; elegí otro nombre",
        ));
    }
    Ok(Some(completed))
}

fn pick_project_to_open(app: &AppHandle) -> Option<PathBuf> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Proyecto de Editor IA", &["json"])
        .blocking_pick_file()?;
    picked.into_path().ok()
}

/// Validate, expose media through the asset protocol and describe a project
/// without changing the native session.
fn describe(app: &AppHandle, opened: OpenedProject) -> Result<OpenedProjectDto, ProjectError> {
    let dto = OpenedProjectDto::from_opened(opened);
    let root = PathBuf::from(&dto.root);
    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo habilitar la vista previa de los medios del proyecto",
            )
        })?;
    Ok(dto)
}

/// Commit a validated project to the native session. Any render belongs to the
/// project that requested it, so changing the session cancels active jobs.
fn adopt(
    app: &AppHandle,
    state: &AppState,
    opened: OpenedProject,
) -> Result<OpenedProjectDto, ProjectError> {
    let dto = describe(app, opened)?;
    let project_id = dto
        .project
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    state.cancel_all_renders();
    state.set_session(Some(Session::new(PathBuf::from(&dto.path), project_id)))?;
    Ok(dto)
}

fn open_and_adopt(
    app: &AppHandle,
    state: &AppState,
    path: &Path,
) -> Result<OpenedProjectDto, ProjectError> {
    let opened = service::open_project(path)?;
    adopt(app, state, opened)
}

fn ensure_session_project(session: &Session, project: &Value) -> Result<(), ProjectError> {
    let project_id = project
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if project_id != session.project_id {
        return Err(ProjectError::message(
            ProjectErrorCode::SessionMismatch,
            "el proyecto de la pantalla no coincide con la sesión nativa; volvé a abrirlo antes de guardar",
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn create_project(
    app: AppHandle,
    name: String,
    video: Option<Value>,
) -> Result<Option<OpenedProjectDto>, ProjectError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto necesita un nombre",
        ));
    }
    let default_name = format!("{}.editoria.json", safe_file_stem(trimmed));
    let Some(path) = pick_project_to_save(&app, &default_name)? else {
        return Ok(None);
    };
    let opened = service::create_project_with_video(&path, trimmed, video)?;
    describe(&app, opened).map(Some)
}

#[tauri::command]
pub async fn open_project(app: AppHandle) -> Result<Option<OpenedProjectDto>, ProjectError> {
    let Some(path) = pick_project_to_open(&app) else {
        return Ok(None);
    };
    let opened = service::open_project(&path)?;
    describe(&app, opened).map(Some)
}

#[tauri::command]
pub async fn open_project_at(
    app: AppHandle,
    path: String,
) -> Result<OpenedProjectDto, ProjectError> {
    let opened = service::open_project(Path::new(&path))?;
    describe(&app, opened)
}

#[tauri::command]
pub async fn adopt_project(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<OpenedProjectDto, ProjectError> {
    open_and_adopt(&app, &state, Path::new(&path))
}

#[tauri::command]
pub async fn save_project(
    state: State<'_, AppState>,
    project: Value,
) -> Result<OpenedProjectDto, ProjectError> {
    let session = state.require_session()?;
    ensure_session_project(&session, &project)?;
    let saved = service::save_project(&session.path, &project)?;
    Ok(OpenedProjectDto::from_opened(OpenedProject {
        project,
        path: saved.path,
    }))
}

#[tauri::command]
pub async fn save_project_as(
    app: AppHandle,
    state: State<'_, AppState>,
    project: Value,
) -> Result<Option<OpenedProjectDto>, ProjectError> {
    let session = state.require_session()?;
    ensure_session_project(&session, &project)?;
    let name = project["name"].as_str().unwrap_or("proyecto");
    let default_name = format!("{}.editoria.json", safe_file_stem(name));
    let Some(path) = pick_project_to_save(&app, &default_name)? else {
        return Ok(None);
    };

    let old_root = session.root.clone();
    let new_root = path.parent().map(PathBuf::from).ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "el destino no tiene carpeta")
    })?;
    let copied = if old_root.canonicalize().ok() == new_root.canonicalize().ok() {
        Vec::new()
    } else {
        copy_project_assets(&project, &old_root, &new_root)?
    };

    match service::save_project(&path, &project) {
        Ok(_) => open_and_adopt(&app, &state, &path).map(Some),
        Err(error) => {
            for file in copied {
                let _ = std::fs::remove_file(file);
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn close_project(state: State<'_, AppState>) -> Result<(), ProjectError> {
    state.cancel_all_renders();
    state.set_session(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_is_safe_and_bounded() {
        assert_eq!(
            safe_file_stem("  Mi Obra: capítulo 1/2  "),
            "mi-obra-captulo-1-2"
        );
        assert_eq!(safe_file_stem("///"), "proyecto");
        assert_eq!(safe_file_stem("a".repeat(200).as_str()).chars().count(), 80);
    }

    #[test]
    fn explicit_json_names_are_kept_and_missing_extensions_are_completed() {
        assert_eq!(
            ensure_extension(PathBuf::from("C:/obra.editoria.json")),
            PathBuf::from("C:/obra.editoria.json")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("C:/obra.json")),
            PathBuf::from("C:/obra.json")
        );
        assert_eq!(
            ensure_extension(PathBuf::from("C:/obra")),
            PathBuf::from("C:/obra.editoria.json")
        );
    }

    #[test]
    fn session_identity_must_match_the_payload() {
        let session = Session::new(
            PathBuf::from("C:/proyectos/obra.json"),
            "60606060-6060-4606-8606-606060606060".to_owned(),
        );
        let mut project = serde_json::json!({
            "id": "60606060-6060-4606-8606-606060606060"
        });
        assert!(ensure_session_project(&session, &project).is_ok());
        project["id"] = serde_json::json!("70707070-7070-4707-8707-707070707070");
        let error = ensure_session_project(&session, &project).unwrap_err();
        assert_eq!(error.code, ProjectErrorCode::SessionMismatch);
    }

    #[test]
    fn an_asset_path_cannot_escape_the_project() {
        let root = std::env::temp_dir();
        assert!(crate::media::resolve_inside_root(&root, "../fuera.mp4").is_err());
    }
}
