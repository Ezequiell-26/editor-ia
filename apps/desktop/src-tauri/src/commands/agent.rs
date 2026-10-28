//! Vigilante de Windows para la cola de descargas. No es un servicio: crea
//! tareas programadas que abren Olyvia oculta (`--background`) al iniciar
//! sesión y cada cinco minutos. El mutex de instancia única evita duplicados.

use std::process::Command;

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

const LOGON_TASK: &str = "Olyvia Queue Agent (logon)";
const WATCHDOG_TASK: &str = "Olyvia Queue Agent (watchdog)";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogStatus {
    pub installed: bool,
    pub tasks: Vec<String>,
    pub hint: String,
}

fn agent_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

fn run_schtasks(args: &[&str]) -> bool {
    let mut command = Command::new("schtasks");
    command.args(args).stdin(std::process::Stdio::null());
    crate::commands::hide_console(&mut command);
    command
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn task_exists(name: &str) -> bool {
    run_schtasks(&["/Query", "/TN", name])
}

pub fn status() -> WatchdogStatus {
    let mut tasks = Vec::new();
    if task_exists(LOGON_TASK) {
        tasks.push(LOGON_TASK.to_owned());
    }
    if task_exists(WATCHDOG_TASK) {
        tasks.push(WATCHDOG_TASK.to_owned());
    }
    WatchdogStatus {
        installed: !tasks.is_empty(),
        tasks,
        hint: "El vigilante abre Olyvia oculta al iniciar sesión y cada 5 minutos si no está corriendo; la cola persistente se reanuda. «Salir de Olyvia» lo desactiva.".to_owned(),
    }
}

#[tauri::command]
pub fn install_watchdog() -> Result<WatchdogStatus, ProjectError> {
    if !cfg!(windows) {
        return Err(agent_error(
            "El vigilante de cola sólo está disponible en Windows.",
        ));
    }
    let exe = std::env::current_exe()
        .map_err(|_| agent_error("No se pudo ubicar el ejecutable de Olyvia."))?;
    let exe = exe.to_string_lossy().into_owned();
    let action = format!("\"{exe}\" --background");
    let logon = run_schtasks(&[
        "/Create",
        "/TN",
        LOGON_TASK,
        "/TR",
        &action,
        "/SC",
        "ONLOGON",
        "/RL",
        "LIMITED",
        "/F",
    ]);
    let watchdog = run_schtasks(&[
        "/Create",
        "/TN",
        WATCHDOG_TASK,
        "/TR",
        &action,
        "/SC",
        "MINUTE",
        "/MO",
        "5",
        "/RL",
        "LIMITED",
        "/F",
    ]);
    if !logon && !watchdog {
        return Err(agent_error(
            "Windows rechazó las tareas programadas. Abrí Olyvia como tu usuario y volvé a intentar.",
        ));
    }
    if !watchdog {
        // La tarea de inicio de sesión alcanza para sobrevivir reinicios; el
        // latido de 5 minutos es opcional si el sistema lo bloquea.
        return Ok(WatchdogStatus {
            installed: true,
            tasks: vec![LOGON_TASK.to_owned()],
            hint: "Se instaló el inicio automático; el latido de 5 minutos no se pudo crear."
                .to_owned(),
        });
    }
    Ok(status())
}

pub fn remove_watchdog_silent() {
    let _ = run_schtasks(&["/Delete", "/TN", LOGON_TASK, "/F"]);
    let _ = run_schtasks(&["/Delete", "/TN", WATCHDOG_TASK, "/F"]);
}

#[tauri::command]
pub fn remove_watchdog() -> Result<WatchdogStatus, ProjectError> {
    remove_watchdog_silent();
    Ok(status())
}

#[tauri::command]
pub fn watchdog_status() -> WatchdogStatus {
    status()
}
