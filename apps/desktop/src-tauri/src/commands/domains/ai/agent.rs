//! Vigilante de Windows para la cola de descargas. Adaptadores IPC delgados;
//! las reglas en `ai::watchdog`, `application::agent` y
//! `infrastructure::agent::SchtasksWatchdog`.

pub use crate::ai::watchdog::WatchdogStatus;

use tauri::State;

use crate::ports::agent::WatchdogTasks;
use crate::projects::service::ProjectError;
use crate::state::AppState;

#[tauri::command]
pub fn install_watchdog(state: State<'_, AppState>) -> Result<WatchdogStatus, ProjectError> {
    crate::application::agent::install_watchdog(&state.watchdog())
}

#[tauri::command]
pub fn remove_watchdog(state: State<'_, AppState>) -> Result<WatchdogStatus, ProjectError> {
    Ok(crate::application::agent::remove_watchdog(
        &state.watchdog(),
    ))
}

#[tauri::command]
pub fn watchdog_status(state: State<'_, AppState>) -> WatchdogStatus {
    crate::application::agent::watchdog_status(&state.watchdog())
}

/// La usa el cierre de la app (`lib.rs`, composition root): el watchdog se
/// construye ahí porque no hay `AppState` disponible en ese punto.
pub fn remove_watchdog_silent(watchdog: &dyn WatchdogTasks) {
    crate::application::agent::remove_watchdog_silent(watchdog);
}
