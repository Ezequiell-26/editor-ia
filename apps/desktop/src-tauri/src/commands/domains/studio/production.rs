//! Ciclo de vida de producciones autónomas por IPC.
//!
//! Adaptador IPC delgado sobre `application::production`: crear la corrida
//! desde un `ProductionPlan` serializado, consultar, pausar/reanudar,
//! cancelar y eliminar. La ejecución de etapas (`advance`) NO se expone
//! todavía: no hay `StageExecutor` real registrado — exponerlo ahora
//! permitiría "correr" producciones sin hacer nada. Llega con el primer
//! ejecutor real (catálogo/analizador) en la siguiente fase.

use serde_json::Value;
use tauri::State;
use uuid::Uuid;

use crate::application::production as use_cases;
use crate::ports::projects::ProjectSession;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;
use crate::studio::plan::ProductionPlan;
use crate::studio::run::ProductionRun;

#[tauri::command]
pub async fn production_create(
    state: State<'_, AppState>,
    plan: Value,
    run_id: Option<String>,
    max_cost_cents: Option<u64>,
) -> Result<ProductionRun, ProjectError> {
    let plan: ProductionPlan = serde_json::from_value(plan)
        .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
    let id = run_id.unwrap_or_else(|| format!("run-{}", Uuid::new_v4()));
    let store = state.production_store();
    use_cases::create_run(&store, &plan, &id, max_cost_cents.or(plan.max_cost_cents))
}

#[tauri::command]
pub async fn production_status(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<Option<ProductionRun>, ProjectError> {
    let store = state.production_store();
    use_cases::run_status(&store, &run_id)
}

#[tauri::command]
pub async fn production_list(
    state: State<'_, AppState>,
) -> Result<Vec<ProductionRun>, ProjectError> {
    let store = state.production_store();
    use_cases::list_runs(&store)
}

#[tauri::command]
pub async fn production_resume(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProductionRun, ProjectError> {
    let store = state.production_store();
    use_cases::resume_run(&store, &run_id)
}

#[tauri::command]
pub async fn production_cancel(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProductionRun, ProjectError> {
    let store = state.production_store();
    use_cases::cancel_run(&store, &run_id)
}

#[tauri::command]
pub async fn production_remove(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<(), ProjectError> {
    let store = state.production_store();
    use_cases::remove_run(&store, &run_id)
}

/// Avanza la corrida UNA etapa con el ejecutor del proyecto abierto.
/// Requiere sesión de proyecto: las etapas escriben sobre sus assets.
/// El composite incluye el ejecutor de render/review/deliver, que toma las
/// dependencias del `AppState` (sesión, documentos, tools, runtime de
/// render, verifier) — mismo cableado que `start_render`.
#[tauri::command]
pub async fn production_advance(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProductionRun, ProjectError> {
    let session = state.project_session();
    let info = session.require()?;
    let store = state.production_store();

    let documents = state.project_documents();
    let tools = state.media_tools();
    let runtime = state.render_runtime();
    let events = state.render_events();
    let files = state.render_files();
    let dialogs = state.render_dialogs();
    let encoder = state.render_encoder();
    let launcher = state.render_launcher();
    let verifier = state.render_verifier();
    let render_deps = crate::application::render_lifecycle::RenderDeps {
        session: &session,
        documents: &documents,
        tools: &tools,
        runtime: &runtime,
        events: &events,
        files: &files,
        dialogs: &dialogs,
        encoder: &encoder,
        launcher: &launcher,
        cache_dir: state.cache_dir.clone(),
    };
    let tail = state.render_tail_executor(render_deps, &verifier);
    let executor = state.project_stage_executor().with_extra(&tail);
    use_cases::advance(&store, &executor, &run_id, &info.root, &info.path)
}
