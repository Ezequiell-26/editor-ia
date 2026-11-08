//! Render commands: start, cancel and report — adaptador IPC.
//!
//! La orquestación vive en `application::render_lifecycle` sobre los ports
//! de `ports::render` (runtime, eventos, filesystem, diálogos, encoder,
//! launcher, verifier); los DTOs de eventos en `render::lifecycle` y el
//! worker FFmpeg en `infrastructure::render_jobs`.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::application::render_lifecycle::{self, RenderDeps};
use crate::infrastructure::media::StateMediaTools;
use crate::infrastructure::projects::{LocalProjectDocuments, StateProjectSession};
use crate::infrastructure::render_jobs::{
    LocalRenderFiles, SharedRenderRuntime, StdioRenderLauncher, SystemRenderEncoder,
    SystemRenderVerifier, TauriRenderDialogs, TauriRenderEvents,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::lifecycle::RenderStarted;
use crate::state::AppState;

fn deps<'a>(
    _state: &'a State<'a, AppState>,
    _app: &'a AppHandle,
    session: &'a StateProjectSession<'a>,
    documents: &'a LocalProjectDocuments,
    tools: &'a StateMediaTools<'a>,
    runtime: &'a SharedRenderRuntime,
    events: &'a TauriRenderEvents,
    files: &'a LocalRenderFiles,
    dialogs: &'a TauriRenderDialogs,
    encoder: &'a SystemRenderEncoder,
    launcher: &'a StdioRenderLauncher,
    cache_dir: &'a PathBuf,
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
        cache_dir: cache_dir.clone(),
    }
}

#[tauri::command]
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
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let tools = StateMediaTools::new(&state);
    let runtime = SharedRenderRuntime::new(state.render_jobs.clone());
    let events = TauriRenderEvents::new(app.clone());
    let files = LocalRenderFiles;
    let dialogs = TauriRenderDialogs::new(app.clone());
    let encoder = SystemRenderEncoder;
    let launcher = StdioRenderLauncher::new(
        Arc::new(SharedRenderRuntime::new(state.render_jobs.clone())),
        Arc::new(TauriRenderEvents::new(app.clone())),
        Arc::new(LocalRenderFiles),
        Arc::new(SystemRenderVerifier),
    );
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
    let path = PathBuf::from(output_path);
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
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let tools = StateMediaTools::new(&state);
    let runtime = SharedRenderRuntime::new(state.render_jobs.clone());
    let events = TauriRenderEvents::new(app.clone());
    let files = LocalRenderFiles;
    let dialogs = TauriRenderDialogs::new(app.clone());
    let encoder = SystemRenderEncoder;
    let launcher = StdioRenderLauncher::new(
        Arc::new(SharedRenderRuntime::new(state.render_jobs.clone())),
        Arc::new(TauriRenderEvents::new(app.clone())),
        Arc::new(LocalRenderFiles),
        Arc::new(SystemRenderVerifier),
    );
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
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let tools = StateMediaTools::new(&state);
    let runtime = SharedRenderRuntime::new(state.render_jobs.clone());
    let events = TauriRenderEvents::new(app.clone());
    let files = LocalRenderFiles;
    let dialogs = TauriRenderDialogs::new(app.clone());
    let encoder = SystemRenderEncoder;
    let launcher = StdioRenderLauncher::new(
        Arc::new(SharedRenderRuntime::new(state.render_jobs.clone())),
        Arc::new(TauriRenderEvents::new(app.clone())),
        Arc::new(LocalRenderFiles),
        Arc::new(SystemRenderVerifier),
    );
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
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let tools = StateMediaTools::new(&state);
    let runtime = SharedRenderRuntime::new(state.render_jobs.clone());
    let events = TauriRenderEvents::new(app.clone());
    let files = LocalRenderFiles;
    let dialogs = TauriRenderDialogs::new(app.clone());
    let encoder = SystemRenderEncoder;
    let launcher = StdioRenderLauncher::new(
        Arc::new(SharedRenderRuntime::new(state.render_jobs.clone())),
        Arc::new(TauriRenderEvents::new(app.clone())),
        Arc::new(LocalRenderFiles),
        Arc::new(SystemRenderVerifier),
    );
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
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let tools = StateMediaTools::new(&state);
    let runtime = SharedRenderRuntime::new(state.render_jobs.clone());
    let events = TauriRenderEvents::new(app.clone());
    let files = LocalRenderFiles;
    let dialogs = TauriRenderDialogs::new(app.clone());
    let encoder = SystemRenderEncoder;
    let launcher = StdioRenderLauncher::new(
        Arc::new(SharedRenderRuntime::new(state.render_jobs.clone())),
        Arc::new(TauriRenderEvents::new(app.clone())),
        Arc::new(LocalRenderFiles),
        Arc::new(SystemRenderVerifier),
    );
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

#[tauri::command]
pub async fn prune_render_cache(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<u64, ProjectError> {
    let session = StateProjectSession::new(&state);
    let documents = LocalProjectDocuments;
    let tools = StateMediaTools::new(&state);
    let runtime = SharedRenderRuntime::new(state.render_jobs.clone());
    let events = TauriRenderEvents::new(app.clone());
    let files = LocalRenderFiles;
    let dialogs = TauriRenderDialogs::new(app.clone());
    let encoder = SystemRenderEncoder;
    let launcher = StdioRenderLauncher::new(
        Arc::new(SharedRenderRuntime::new(state.render_jobs.clone())),
        Arc::new(TauriRenderEvents::new(app.clone())),
        Arc::new(LocalRenderFiles),
        Arc::new(SystemRenderVerifier),
    );
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
