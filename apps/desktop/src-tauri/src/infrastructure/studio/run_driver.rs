//! Driver de corridas de producción en el backend.
//!
//! Hoy la UI avanza cada corrida llamando `production_advance` en bucle
//! (`advanceProductionRun`). Este driver hace lo mismo desde Rust: al
//! arrancar una corrida la va llevando etapa por etapa hasta un estado
//! terminal (o pausada/fallida, que esperan decisión del usuario) sin
//! depender de que la ventana esté montada — mientras el proceso de la
//! app viva, la corrida progresa.
//!
//! Reglas:
//! - Un driver por `run_id`; `start` es idempotente (si ya hay driver
//!   activo no hace nada).
//! - `advance` sigue siendo el único camino de ejecución: el driver y el
//!   comando IPC comparten `AppState::advance_production_run`, serializado
//!   por un lock por corrida — nunca dos etapas de la misma corrida en
//!   paralelo.
//! - La cancelación es real: si la corrida quedó `cancelled`, el driver
//!   cancela el job de render activo (si lo hay) antes de salir.
//! - Límite de drivers concurrentes para no saturar la máquina.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::ports::render::RenderRuntime;
use crate::ports::studio::ProductionStore;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;
use crate::studio::run::{ProductionRun, RunStatus, StageRecordStatus};

/// Espera entre iteraciones cuando la etapa está sondeando trabajo async
/// (render). Igual que el poll de la UI (`production-runs.ts`).
const POLL_INTERVAL: Duration = Duration::from_millis(1_500);
/// Espera tras un error de infraestructura antes de reintentar.
const ERROR_RETRY_INTERVAL: Duration = Duration::from_secs(2);
/// Errores consecutivos de `advance` antes de soltar la corrida.
const MAX_CONSECUTIVE_ERRORS: u32 = 10;
/// Drivers simultáneos: cada uno puede lanzar renders/descargas pesadas.
const MAX_ACTIVE_DRIVERS: usize = 2;

fn drivers() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static DRIVERS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    DRIVERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Locks de avance por corrida: serializan `advance` entre el driver, el
/// comando IPC y cualquier otro llamador para que una etapa nunca corra
/// dos veces en paralelo.
fn advance_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Guard compartido para avanzar `run_id`. Serializa todo el `advance`.
pub fn advance_guard(run_id: &str) -> Result<Arc<Mutex<()>>, ProjectError> {
    let mut locks = advance_locks().lock().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el registro de corridas está bloqueado",
        )
    })?;
    Ok(locks
        .entry(run_id.to_owned())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}

/// ¿Hay un driver activo para esta corrida?
pub fn is_active(run_id: &str) -> bool {
    drivers()
        .lock()
        .map(|map| map.contains_key(run_id))
        .unwrap_or(false)
}

/// Estados en los que la corrida no necesita driver: terminales, pausada
/// (espera al usuario) o fallida (espera `resume`).
fn needs_driver(status: RunStatus) -> bool {
    matches!(status, RunStatus::Planned | RunStatus::Running)
}

/// Arranca el driver de una corrida. Si está `paused`/`failed` la reanuda
/// primero (arrancar el driver ES la intención de continuar). Errores si
/// ya hay `MAX_ACTIVE_DRIVERS` drivers vivos o la corrida no existe.
pub fn start(app: &AppHandle, run_id: &str) -> Result<(), ProjectError> {
    {
        let state = app.state::<AppState>();
        let store = state.production_store();
        let run = store.load(run_id)?.ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::NotFound, "corrida no encontrada")
        })?;
        if !needs_driver(run.status) {
            if matches!(run.status, RunStatus::Paused | RunStatus::Failed) {
                crate::application::production::resume_run(&store, run_id)?;
            } else {
                return Ok(());
            }
        }
    }

    let mut map = drivers().lock().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el registro de drivers está bloqueado",
        )
    })?;
    if map.contains_key(run_id) {
        return Ok(());
    }
    // Cuentan sólo drivers vivos (flag en false); los parados esperan su
    // limpieza en `drive` y no habilitan un driver duplicado.
    let active = map
        .values()
        .filter(|flag| !flag.load(Ordering::Relaxed))
        .count();
    if active >= MAX_ACTIVE_DRIVERS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("ya hay {MAX_ACTIVE_DRIVERS} corridas en ejecución; esperá a que terminen"),
        ));
    }
    let stop = Arc::new(AtomicBool::new(false));
    map.insert(run_id.to_owned(), stop.clone());
    drop(map);

    let app = app.clone();
    let id = run_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || drive(app, id, stop));
    Ok(())
}

/// Pide al driver que suelte la corrida en su próxima iteración. NO
/// cancela la corrida ni el render en curso: para eso está
/// `production_cancel`. Se usa en tests y para apagado ordenado futuro.
pub fn request_stop(run_id: &str) {
    if let Ok(map) = drivers().lock() {
        if let Some(flag) = map.get(run_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Si la corrida fue cancelada con un render activo, mata ese job de
/// FFmpeg: la cancelación tiene que ser real, no sólo un estado en disco.
fn propagate_render_cancel(state: &AppState, run: &ProductionRun) {
    let job_id = run
        .stage_record(crate::studio::plan::StudioStage::Render)
        .and_then(|record| record.output.as_ref())
        .and_then(|output| output["jobId"].as_str().map(str::to_owned));
    if let Some(job_id) = job_id {
        let runtime = state.render_runtime();
        let _ = runtime.cancel(&job_id);
    }
}

/// Resultado de una iteración: `Some(delay)` = dormir y seguir;
/// `None` = la corrida no necesita más driver.
fn drive(app: AppHandle, run_id: String, stop: Arc<AtomicBool>) {
    let mut consecutive_errors = 0u32;
    // Última firma emitida: los sondeos de una etapa async no cambian la
    // corrida y no deben spamear eventos a la UI.
    let mut last_emit: Option<String> = None;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        let delay = {
            let state = app.state::<AppState>();
            let store = state.production_store();
            let run = match store.load(&run_id) {
                Ok(Some(run)) => run,
                // Corrida borrada o store caído: no hay nada que conducir.
                _ => break,
            };
            if run.status == RunStatus::Cancelled {
                propagate_render_cancel(&state, &run);
                break;
            }
            if !needs_driver(run.status) {
                break;
            }
            // La etapa en `running` se re-sondea dentro del mismo advance
            // (el ejecutor usa `previous_output`); advance es idempotente.
            let stage_running = run.stages.iter().any(|record| {
                record.stage == run.current_stage && record.status == StageRecordStatus::Running
            });
            match state.advance_production_run(&run_id) {
                Ok(run) => {
                    consecutive_errors = 0;
                    // Evento para la UI/MCP: la corrida cambió de verdad
                    // (etapa, estado o checkpoint). Mismo shape que
                    // `production_status` — la UI sólo renderiza.
                    let signature = format!(
                        "{:?}|{:?}|{}|{}",
                        run.status, run.current_stage, run.updated_at, run.spent_cents
                    );
                    if last_emit.as_deref() != Some(signature.as_str()) {
                        last_emit = Some(signature);
                        let _ = app.emit(
                            "production-run",
                            serde_json::json!({ "runId": run_id, "run": run }),
                        );
                    }
                    if stage_running {
                        POLL_INTERVAL
                    } else {
                        // Etapa recién cerrada: encadenar la siguiente sin
                        // pausa larga, pero ceder el hilo un instante.
                        Duration::from_millis(200)
                    }
                }
                Err(_) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        break;
                    }
                    ERROR_RETRY_INTERVAL
                }
            }
        };
        std::thread::sleep(delay);
    }
    // Sólo limpiar el slot si sigue siendo el nuestro: un `start` posterior
    // pudo haber registrado un driver nuevo para la misma corrida.
    if let Ok(mut map) = drivers().lock() {
        if map
            .get(&run_id)
            .is_some_and(|flag| Arc::ptr_eq(flag, &stop))
        {
            map.remove(&run_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_driver_only_for_planned_and_running() {
        assert!(needs_driver(RunStatus::Planned));
        assert!(needs_driver(RunStatus::Running));
        assert!(!needs_driver(RunStatus::Paused));
        assert!(!needs_driver(RunStatus::Cancelled));
        assert!(!needs_driver(RunStatus::Done));
        assert!(!needs_driver(RunStatus::Failed));
    }

    #[test]
    fn advance_guard_serializes_per_run() {
        let a = advance_guard("run-x").unwrap();
        let b = advance_guard("run-x").unwrap();
        let c = advance_guard("run-y").unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert!(!Arc::ptr_eq(&a, &c));
    }

    #[test]
    fn request_stop_marks_flag_without_touching_store() {
        // Sin AppHandle no se puede start(); el flag sólo existe tras start.
        // Acá se verifica que request_stop es no-op seguro sin driver.
        request_stop("run-inexistente");
        assert!(!is_active("run-inexistente"));
    }
}
