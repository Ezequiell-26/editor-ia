//! Render commands: start, cancel and report — adaptador IPC.
//!
//! La orquestación vive en `application::render_lifecycle` sobre los ports
//! de `ports::render` (runtime, eventos, filesystem, diálogos, encoder,
//! launcher, verifier); los DTOs de eventos en `render::lifecycle` y el
//! worker FFmpeg en `infrastructure::render_jobs`.

use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::application::render_lifecycle::{self, RenderDeps};
use crate::ports::media::MediaTools;
use crate::ports::projects::{ProjectDocuments, ProjectSession};
use crate::ports::render::{
    RenderDialogs, RenderEncoder, RenderEvents, RenderFiles, RenderLauncher, RenderRuntime,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::lifecycle::RenderStarted;
use crate::state::AppState;

// clippy::too_many_arguments: reagrupa las dependencias Dyn que ya forman
// RenderDeps; separarlas en otro struct no reduce la superficie real.
#[allow(clippy::too_many_arguments)]
fn deps<'a>(
    _state: &'a State<'a, AppState>,
    _app: &'a AppHandle,
    session: &'a dyn ProjectSession,
    documents: &'a dyn ProjectDocuments,
    tools: &'a dyn MediaTools,
    runtime: &'a dyn RenderRuntime,
    events: &'a dyn RenderEvents,
    files: &'a dyn RenderFiles,
    dialogs: &'a dyn RenderDialogs,
    encoder: &'a dyn RenderEncoder,
    launcher: &'a dyn RenderLauncher,
    cache_dir: &'a Path,
) -> RenderDeps<'a> {
    RenderDeps {
        session,
        documents,
        tools,
        runtime,
        events,
        files,
        dialogs,
        encoder,
        launcher,
        cache_dir: cache_dir.to_path_buf(),
    }
}

#[tauri::command]
// clippy::too_many_arguments: la aridad es el contrato IPC con el frontend.
#[allow(clippy::too_many_arguments)]
pub async fn start_render(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: Option<String>,
    include_captions: bool,
    motion_plans: Option<Value>,
    hardware_encoder: Option<String>,
    start_frame: Option<u64>,
    end_frame: Option<u64>,
) -> Result<Option<RenderStarted>, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runtime = state.render_runtime();
    let events = state.render_events();
    let files = state.render_files();
    let dialogs = state.render_dialogs();
    let encoder = state.render_encoder();
    let launcher = state.render_launcher();
    let deps = deps(
        &state,
        &app,
        &session,
        &documents,
        &tools,
        &runtime,
        &events,
        &files,
        &dialogs,
        &encoder,
        &launcher,
        &state.cache_dir,
    );
    render_lifecycle::start_render(
        &deps,
        profile_id,
        include_captions,
        motion_plans,
        hardware_encoder,
        match (start_frame, end_frame) {
            (Some(start), Some(end)) => Some((start, end)),
            _ => None,
        },
        None,
    )
}

#[tauri::command]
// clippy::too_many_arguments: la aridad es el contrato IPC con el frontend.
#[allow(clippy::too_many_arguments)]
pub async fn start_render_to(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    include_captions: bool,
    output_path: String,
    motion_plans: Option<Value>,
    hardware_encoder: Option<String>,
    start_frame: Option<u64>,
    end_frame: Option<u64>,
) -> Result<Option<RenderStarted>, ProjectError> {
    let path = crate::application::fs::validate_user_write_path(&output_path)?;
    if !path
        .extension()
        .map(|value| value.eq_ignore_ascii_case("mp4"))
        .unwrap_or(false)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el lote solo escribe archivos .mp4",
        ));
    }
    if path.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un archivo con ese nombre en la carpeta elegida",
        ));
    }
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runtime = state.render_runtime();
    let events = state.render_events();
    let files = state.render_files();
    let dialogs = state.render_dialogs();
    let encoder = state.render_encoder();
    let launcher = state.render_launcher();
    let deps = deps(
        &state,
        &app,
        &session,
        &documents,
        &tools,
        &runtime,
        &events,
        &files,
        &dialogs,
        &encoder,
        &launcher,
        &state.cache_dir,
    );
    render_lifecycle::start_render(
        &deps,
        Some(profile_id),
        include_captions,
        motion_plans,
        hardware_encoder,
        match (start_frame, end_frame) {
            (Some(start), Some(end)) => Some((start, end)),
            _ => None,
        },
        Some(path),
    )
}

#[tauri::command]
pub async fn choose_export_directory(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runtime = state.render_runtime();
    let events = state.render_events();
    let files = state.render_files();
    let dialogs = state.render_dialogs();
    let encoder = state.render_encoder();
    let launcher = state.render_launcher();
    let deps = deps(
        &state,
        &app,
        &session,
        &documents,
        &tools,
        &runtime,
        &events,
        &files,
        &dialogs,
        &encoder,
        &launcher,
        &state.cache_dir,
    );
    render_lifecycle::choose_export_directory(&deps)
}

#[tauri::command]
pub async fn cancel_render(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runtime = state.render_runtime();
    let events = state.render_events();
    let files = state.render_files();
    let dialogs = state.render_dialogs();
    let encoder = state.render_encoder();
    let launcher = state.render_launcher();
    let deps = deps(
        &state,
        &app,
        &session,
        &documents,
        &tools,
        &runtime,
        &events,
        &files,
        &dialogs,
        &encoder,
        &launcher,
        &state.cache_dir,
    );
    render_lifecycle::cancel_render(&deps, &job_id)
}

#[tauri::command]
pub async fn active_render(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runtime = state.render_runtime();
    let events = state.render_events();
    let files = state.render_files();
    let dialogs = state.render_dialogs();
    let encoder = state.render_encoder();
    let launcher = state.render_launcher();
    let deps = deps(
        &state,
        &app,
        &session,
        &documents,
        &tools,
        &runtime,
        &events,
        &files,
        &dialogs,
        &encoder,
        &launcher,
        &state.cache_dir,
    );
    render_lifecycle::active_render(&deps)
}

/// `render_diary(limit)` — últimas entradas de la bitácora de exports
/// (`export_diario.js`), más nuevas primero.
#[tauri::command]
pub async fn render_diary(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<Value>, ProjectError> {
    Ok(crate::commands::render_diary_tail(
        &state.cache_dir,
        limit.unwrap_or(20).clamp(1, 200),
    ))
}

#[tauri::command]
pub async fn prune_render_cache(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<u64, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    let tools = state.media_tools();
    let runtime = state.render_runtime();
    let events = state.render_events();
    let files = state.render_files();
    let dialogs = state.render_dialogs();
    let encoder = state.render_encoder();
    let launcher = state.render_launcher();
    let deps = deps(
        &state,
        &app,
        &session,
        &documents,
        &tools,
        &runtime,
        &events,
        &files,
        &dialogs,
        &encoder,
        &launcher,
        &state.cache_dir,
    );
    render_lifecycle::prune_render_cache(&deps)
}
