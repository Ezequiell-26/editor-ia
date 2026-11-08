//! Casos de uso del vigilante de cola: estado, instalación y desinstalación
//! de las tareas programadas de Windows.

use crate::ai::watchdog;
use crate::ports::agent::WatchdogTasks;
use crate::projects::service::{ProjectError, ProjectErrorCode};

fn agent_error(message: impl Into<String>) -> ProjectError {
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message.into())
}

pub fn watchdog_status(tasks: &dyn WatchdogTasks) -> watchdog::WatchdogStatus {
    watchdog::watchdog_status(
        tasks.task_exists(watchdog::LOGON_TASK),
        tasks.task_exists(watchdog::WATCHDOG_TASK),
    )
}

pub fn install_watchdog(
    tasks: &dyn WatchdogTasks,
) -> Result<watchdog::WatchdogStatus, ProjectError> {
    if !cfg!(windows) {
        return Err(agent_error(
            "El vigilante de cola sólo está disponible en Windows.",
        ));
    }
    let exe = tasks.current_exe()?;
    let (logon_args, watchdog_args) = watchdog::install_args(&exe);
    let logon = tasks.run(&logon_args);
    let watchdog_ok = tasks.run(&watchdog_args);
    if !logon && !watchdog_ok {
        return Err(agent_error(
            "Windows rechazó las tareas programadas. Abrí Olyvia como tu usuario y volvé a intentar.",
        ));
    }
    if !watchdog_ok {
        // La tarea de inicio de sesión alcanza para sobrevivir reinicios; el
        // latido de 5 minutos es opcional si el sistema lo bloquea.
        return Ok(watchdog::WatchdogStatus {
            installed: true,
            tasks: vec![watchdog::LOGON_TASK.to_owned()],
            hint: "Se instaló el inicio automático; el latido de 5 minutos no se pudo crear."
                .to_owned(),
        });
    }
    Ok(watchdog_status(tasks))
}

/// Desinstalación silenciosa (la usa el cierre de la app).
pub fn remove_watchdog_silent(tasks: &dyn WatchdogTasks) {
    for args in watchdog::delete_args() {
        let _ = tasks.run(&args);
    }
}

pub fn remove_watchdog(tasks: &dyn WatchdogTasks) -> watchdog::WatchdogStatus {
    remove_watchdog_silent(tasks);
    watchdog_status(tasks)
}
