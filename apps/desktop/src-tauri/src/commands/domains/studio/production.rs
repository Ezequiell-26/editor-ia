//! Ciclo de vida de producciones autónomas por IPC.
//!
//! Adaptador IPC delgado sobre `application::production` y el driver de
//! corridas (`infrastructure::studio::run_driver`): crear la corrida desde
//! un `ProductionPlan` serializado, consultar, arrancar el driver que la
//! conduce en backend, pausar/reanudar, cancelar y eliminar. El avance de
//! etapas vive en `AppState::advance_production_run`, compartido por IPC,
//! driver y MCP.

use serde_json::Value;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::application::production as use_cases;
use crate::ports::render::RenderRuntime as _;

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

/// Construye un `ProductionPlan` válido desde un brief estructurado
/// (objetivo + key points + opciones). No crea ni ejecuta la corrida:
/// el cliente revisa el plan y luego llama `production_create`.
#[tauri::command]
pub async fn production_plan_from_brief(
    request: Value,
) -> Result<crate::studio::plan::ProductionPlan, ProjectError> {
    let parsed: crate::application::studio_planner::PlanRequest =
        serde_json::from_value(request)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
    crate::application::studio_planner::plan_from_brief(&parsed)
}

/// Interpreta texto libre con el provider de chat configurado (BYOK) y
/// devuelve el `ProductionPlan` resultante. No crea ni ejecuta la corrida.
/// `approvedCost` autoriza gasto del provider remoto (misma regla que el
/// resto de generaciones: local no lo exige, remoto sí).
#[tauri::command]
pub async fn production_plan_from_text(
    state: State<'_, AppState>,
    request: Value,
) -> Result<crate::studio::plan::ProductionPlan, ProjectError> {
    let parsed: crate::application::studio_planner::PlanTextRequest =
        serde_json::from_value(request)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
    let settings = crate::infrastructure::ai::StateProviderSettings::new(&state);
    let secrets = crate::infrastructure::ai::KeyringProviderSecrets;
    let (config, _simulated, key) = crate::application::providers::generation_provider(
        &settings,
        &secrets,
        parsed.approved_cost.unwrap_or(false),
        "el proveedor de chat no está configurado para interpretar texto libre",
        "interpretar texto libre con un proveedor remoto requiere approvedCost",
    )?;
    if config.kind == "mock" {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el proveedor mock no interpreta lenguaje natural; configurá un proveedor real",
        ));
    }
    let chat = crate::infrastructure::ai::ReqwestProviderChat;
    crate::application::studio_planner::plan_from_text(&chat, &config, key, &parsed.text).await
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
    app: AppHandle,
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProductionRun, ProjectError> {
    let store = state.production_store();
    let run = use_cases::resume_run(&store, &run_id)?;
    // Reanudar implica querer que la corrida avance: se arranca el driver
    // (idempotente si ya hay uno). Si falla el arranque la corrida queda
    // reanudada igual — la UI puede seguir avanzándola a mano.
    let _ = crate::infrastructure::studio::run_driver::start(&app, &run_id);
    Ok(run)
}

/// Pausa la corrida entre etapas. Si el driver está activo lo detecta en
/// su próxima iteración y se detiene solo.
#[tauri::command]
pub async fn production_pause(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProductionRun, ProjectError> {
    let store = state.production_store();
    use_cases::pause_run(&store, &run_id)
}

/// Arranca el driver backend que conduce la corrida hasta un estado
/// terminal/pausado/fallido. Idempotente; reanuda si estaba pausada o
/// fallida. Devuelve `true` si quedó un driver activo.
#[tauri::command]
pub async fn production_start(app: AppHandle, run_id: String) -> Result<bool, ProjectError> {
    crate::infrastructure::studio::run_driver::start(&app, &run_id)?;
    Ok(crate::infrastructure::studio::run_driver::is_active(
        &run_id,
    ))
}

#[tauri::command]
pub async fn production_cancel(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProductionRun, ProjectError> {
    let store = state.production_store();
    let run = use_cases::cancel_run(&store, &run_id)?;
    // Cancelación real del render en curso: el driver también lo hace al
    // detectar el estado, pero esto mata el FFmpeg sin esperar el poll.
    let runtime = state.render_runtime();
    if let Some(job_id) = run
        .stage_record(crate::studio::plan::StudioStage::Render)
        .and_then(|record| record.output.as_ref())
        .and_then(|output| output["jobId"].as_str().map(str::to_owned))
    {
        let _ = runtime.cancel(&job_id);
    }
    Ok(run)
}

#[tauri::command]
pub async fn production_remove(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<(), ProjectError> {
    let store = state.production_store();
    use_cases::remove_run(&store, &run_id)
}

/// Avanza la corrida UNA etapa. Es el mismo camino que usa el driver y
/// las tools MCP (`AppState::advance_production_run`), serializado por
/// corrida: se puede llamar a mano sin romper un driver activo.
#[tauri::command]
pub async fn production_advance(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<ProductionRun, ProjectError> {
    state.advance_production_run(&run_id)
}
