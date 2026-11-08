//! Project commands: create, open, adopt, save, save-as and close.
//!
//! Adaptadores IPC delgados: reciben el DTO, arman los ports de infraestructura
//! y delegan en los casos de uso de `crate::application::projects`. Las
//! reglas de sesión, diálogos, assets y versionado ya no viven acá.
//!
//! La miniatura de proyecto reciente queda en este módulo porque combina
//! `projects::service` con el motor de medios y la caché de thumbnails: es
//! una consulta de presentación, no parte del ciclo de vida del proyecto.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::application::projects::{self as use_cases, OpenedProjectView};
use crate::commands::system::resolve_tools;
use crate::media::{resolve_inside_root, thumbnail_data_url};
use crate::ports::projects::ProjectSession;
use crate::projects::service::ProjectError;
use crate::state::AppState;

/// Miniatura de portada para un proyecto reciente, sin abrir una sesión.
///
/// Prioriza el primer clip visual de la timeline; si el proyecto no tiene
/// clips, usa el primer asset de video o imagen. Los errores se convierten en
/// `None` para que el lanzador siga funcionando aunque un proyecto esté roto.
#[tauri::command]
pub async fn recent_project_thumbnail(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<String>, ProjectError> {
    Ok(recent_thumbnail_inner(&state, Path::new(&path)))
}

fn recent_thumbnail_inner(state: &AppState, project_path: &Path) -> Option<String> {
    if !project_path.is_file() {
        return None;
    }
    let opened = crate::projects::service::open_project(project_path).ok()?;
    let root = project_path.parent()?;
    let ffmpeg = {
        let settings = state.settings_snapshot().ok()?;
        resolve_tools(&settings).0?
    };
    let (asset_path, is_image) = thumbnail_source(&opened.project)?;
    let source = resolve_inside_root(root, asset_path).ok()?;
    let metadata = std::fs::metadata(&source).ok()?;
    let cache_key = format!(
        "project:{}:{}:{}",
        source.to_string_lossy(),
        metadata.len(),
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    );
    if let Ok(cache) = state.thumbnails.lock() {
        if let Some(hit) = cache.get(&cache_key) {
            return Some(hit.clone());
        }
    }
    let data_url = thumbnail_data_url(&ffmpeg, &source, is_image).ok()?;
    if let Ok(mut cache) = state.thumbnails.lock() {
        cache.insert(cache_key, data_url.clone());
    }
    Some(data_url)
}

/// Devuelve la ruta relativa y si es imagen del visual que mejor representa
/// el proyecto: el primer clip visual de la timeline o, si no hay, el primer
/// asset visual listo.
fn thumbnail_source(project: &Value) -> Option<(&str, bool)> {
    let assets = project["assets"].as_array()?;
    let asset_for = |id: &str| {
        assets
            .iter()
            .find(|asset| asset["id"].as_str() == Some(id))
            .filter(|asset| asset["status"].as_str() == Some("ready"))
    };
    // Portada explícita puesta por el descargador en el namespace x-*.
    if let Some(id) = project["x-coverAssetId"].as_str() {
        if let Some(asset) = asset_for(id) {
            if asset["kind"].as_str() == Some("image") {
                if let Some(path) = asset["source"]["path"].as_str() {
                    return Some((path, true));
                }
            }
        }
    }
    let mut clips = project["timeline"]["clips"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|clip| {
                    let start = clip["startFrame"].as_u64().unwrap_or(0);
                    let id = clip["source"]["assetId"].as_str()?;
                    Some((start, id))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    clips.sort_by_key(|(start, _)| *start);
    for (_, id) in clips {
        if let Some(asset) = asset_for(id) {
            let kind = asset["kind"].as_str().unwrap_or("");
            if (kind == "video" || kind == "image") && asset["source"]["path"].as_str().is_some() {
                return Some((asset["source"]["path"].as_str()?, kind == "image"));
            }
        }
    }
    for asset in assets {
        if asset["status"].as_str() != Some("ready") {
            continue;
        }
        let kind = asset["kind"].as_str().unwrap_or("");
        if (kind == "video" || kind == "image") && asset["source"]["path"].as_str().is_some() {
            return Some((asset["source"]["path"].as_str()?, kind == "image"));
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProjectDto {
    pub project: Value,
    pub path: String,
    pub root: String,
    pub label: String,
}

impl From<OpenedProjectView> for OpenedProjectDto {
    fn from(view: OpenedProjectView) -> Self {
        Self {
            project: view.project,
            path: view.path,
            root: view.root,
            label: view.label,
        }
    }
}

#[tauri::command]
pub async fn create_project(
    _app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    video: Option<Value>,
) -> Result<Option<OpenedProjectDto>, ProjectError> {
    let documents = state.project_documents();
    let environment = state.project_environment();
    use_cases::create_project(&documents, &environment, &name, video)
        .map(|view| view.map(OpenedProjectDto::from))
}

#[tauri::command]
pub async fn open_project(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<OpenedProjectDto>, ProjectError> {
    let documents = state.project_documents();
    let environment = state.project_environment();
    use_cases::open_project(&documents, &environment).map(|view| view.map(OpenedProjectDto::from))
}

#[tauri::command]
pub async fn open_project_at(
    _app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<OpenedProjectDto, ProjectError> {
    let documents = state.project_documents();
    let environment = state.project_environment();
    use_cases::open_project_at(&documents, &environment, Path::new(&path))
        .map(OpenedProjectDto::from)
}

#[tauri::command]
pub async fn adopt_project(
    _app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<OpenedProjectDto, ProjectError> {
    let documents = state.project_documents();
    let environment = state.project_environment();
    let session = state.project_session();
    // Si el proyecto que entra es otro, limpia los proxies huérfanos del que
    // sale (best-effort: el cache nunca puede tumbar la adopción).
    let incoming = Path::new(&path);
    let switching = session
        .current()
        .ok()
        .flatten()
        .map(|info| {
            let current = info.path.canonicalize().unwrap_or(info.path);
            let next = incoming
                .canonicalize()
                .unwrap_or_else(|_| incoming.to_path_buf());
            current != next
        })
        .unwrap_or(false);
    if switching {
        let files = state.proxy_files();
        crate::application::proxies::cleanup_session_orphans(&session, &documents, &files);
    }
    use_cases::adopt_project(&documents, &environment, &session, incoming)
        .map(OpenedProjectDto::from)
}

#[tauri::command]
pub async fn save_project(
    state: State<'_, AppState>,
    project: Value,
) -> Result<OpenedProjectDto, ProjectError> {
    let documents = state.project_documents();
    let session = state.project_session();
    let versioning = state.project_versioning();
    use_cases::save_project(&documents, &session, &versioning, project).map(OpenedProjectDto::from)
}

#[tauri::command]
pub async fn save_project_as(
    _app: AppHandle,
    state: State<'_, AppState>,
    project: Value,
) -> Result<Option<OpenedProjectDto>, ProjectError> {
    let documents = state.project_documents();
    let environment = state.project_environment();
    let session = state.project_session();
    let asset_files = state.project_asset_files();
    use_cases::save_project_as(&documents, &environment, &session, &asset_files, &project)
        .map(|view| view.map(OpenedProjectDto::from))
}

#[tauri::command]
pub async fn close_project(state: State<'_, AppState>) -> Result<(), ProjectError> {
    let session = state.project_session();
    // Limpieza automática de proxies huérfanos del proyecto que se cierra
    // (best-effort): nunca bloquea el cierre.
    let documents = state.project_documents();
    let files = state.proxy_files();
    crate::application::proxies::cleanup_session_orphans(&session, &documents, &files);
    use_cases::close_project(&session)
}

#[cfg(test)]
mod thumbnail_tests {
    use super::*;

    fn project_with(assets: Value, clips: Value) -> Value {
        serde_json::json!({ "assets": assets, "timeline": { "clips": clips } })
    }

    fn asset(id: &str, kind: &str, status: &str, path: &str) -> Value {
        serde_json::json!({
            "id": id,
            "kind": kind,
            "status": status,
            "source": { "path": path }
        })
    }

    #[test]
    fn prefiere_el_primer_clip_visual_de_la_timeline() {
        let project = project_with(
            serde_json::json!([
                asset("img", "image", "ready", "media/portada.png"),
                asset("vid", "video", "ready", "media/toma.mp4")
            ]),
            serde_json::json!([
                { "startFrame": 180, "source": { "assetId": "img" } },
                { "startFrame": 0, "source": { "assetId": "vid" } }
            ]),
        );
        assert_eq!(thumbnail_source(&project), Some(("media/toma.mp4", false)));
    }

    #[test]
    fn sin_clips_usa_el_primer_visual_listo() {
        let project = project_with(
            serde_json::json!([
                asset("audio", "audio", "ready", "media/voz.wav"),
                asset("sin", "video", "unverified", "media/sin.mp4"),
                asset("img", "image", "ready", "media/foto.jpg")
            ]),
            serde_json::json!([]),
        );
        assert_eq!(thumbnail_source(&project), Some(("media/foto.jpg", true)));
    }

    #[test]
    fn sin_visuales_no_hay_portada() {
        let project = project_with(
            serde_json::json!([asset("audio", "audio", "ready", "media/voz.wav")]),
            serde_json::json!([]),
        );
        assert_eq!(thumbnail_source(&project), None);
    }
}
