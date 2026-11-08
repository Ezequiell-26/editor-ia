//! Vigilante de Windows para la cola de descargas. Adaptadores IPC delgados;
//! las reglas en `ai::watchdog`, `application::agent` y
//! `infrastructure::agent::SchtasksWatchdog`.

pub use crate::ai::watchdog::WatchdogStatus;

use crate::infrastructure::agent::SchtasksWatchdog;
use crate::projects::service::ProjectError;

#[tauri::command]
pub fn install_watchdog() -> Result<WatchdogStatus, ProjectError> {
    crate::application::agent::install_watchdog(&SchtasksWatchdog::new())
}

#[tauri::command]
pub fn remove_watchdog() -> Result<WatchdogStatus, ProjectError> {
    Ok(crate::application::agent::remove_watchdog(
        &SchtasksWatchdog::new(),
    ))
}

#[tauri::command]
pub fn watchdog_status() -> WatchdogStatus {
    crate::application::agent::watchdog_status(&SchtasksWatchdog::new())
}

/// La usa el cierre de la app (`lib.rs`); mantiene la ruta histórica.
pub fn remove_watchdog_silent() {
    crate::application::agent::remove_watchdog_silent(&SchtasksWatchdog::new());
}
