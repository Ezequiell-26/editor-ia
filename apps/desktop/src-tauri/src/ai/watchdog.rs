//! Vigilante de Windows para la cola de descargas (dominio puro).
//!
//! Nombres de tareas programadas y argumentos de `schtasks`; la ejecución del
//! proceso vive en infrastructure y la orquestación en application.

use serde::Serialize;

pub const LOGON_TASK: &str = "Olyvia Queue Agent (logon)";
pub const WATCHDOG_TASK: &str = "Olyvia Queue Agent (watchdog)";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchdogStatus {
    pub installed: bool,
    pub tasks: Vec<String>,
    pub hint: String,
}

pub const WATCHDOG_HINT: &str = "El vigilante abre Olyvia oculta al iniciar sesión y cada 5 minutos si no está corriendo; la cola persistente se reanuda. «Salir de Olyvia» lo desactiva.";

/// Estado agregado a partir de qué tareas existen.
pub fn watchdog_status(logon_exists: bool, watchdog_exists: bool) -> WatchdogStatus {
    let mut tasks = Vec::new();
    if logon_exists {
        tasks.push(LOGON_TASK.to_owned());
    }
    if watchdog_exists {
        tasks.push(WATCHDOG_TASK.to_owned());
    }
    WatchdogStatus {
        installed: !tasks.is_empty(),
        tasks,
        hint: WATCHDOG_HINT.to_owned(),
    }
}

/// Argumentos de `schtasks /Create` para las dos tareas (logon + latido de
/// 5 minutos), dados el ejecutable actual.
pub fn install_args(exe: &str) -> (Vec<String>, Vec<String>) {
    let action = format!("\"{exe}\" --background");
    let logon = vec![
        "/Create".to_owned(),
        "/TN".to_owned(),
        LOGON_TASK.to_owned(),
        "/TR".to_owned(),
        action.clone(),
        "/SC".to_owned(),
        "ONLOGON".to_owned(),
        "/RL".to_owned(),
        "LIMITED".to_owned(),
        "/F".to_owned(),
    ];
    let watchdog = vec![
        "/Create".to_owned(),
        "/TN".to_owned(),
        WATCHDOG_TASK.to_owned(),
        "/TR".to_owned(),
        action,
        "/SC".to_owned(),
        "MINUTE".to_owned(),
        "/MO".to_owned(),
        "5".to_owned(),
        "/RL".to_owned(),
        "LIMITED".to_owned(),
        "/F".to_owned(),
    ];
    (logon, watchdog)
}

pub fn delete_args() -> [Vec<String>; 2] {
    [
        vec![
            "/Delete".to_owned(),
            "/TN".to_owned(),
            LOGON_TASK.to_owned(),
            "/F".to_owned(),
        ],
        vec![
            "/Delete".to_owned(),
            "/TN".to_owned(),
            WATCHDOG_TASK.to_owned(),
            "/F".to_owned(),
        ],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reflects_which_tasks_exist() {
        let none = watchdog_status(false, false);
        assert!(!none.installed);
        assert!(none.tasks.is_empty());
        let both = watchdog_status(true, true);
        assert!(both.installed);
        assert_eq!(both.tasks, vec![LOGON_TASK, WATCHDOG_TASK]);
    }

    #[test]
    fn install_args_target_both_tasks_with_background_flag() {
        let (logon, watchdog) = install_args("C:\\Olyvia\\app.exe");
        assert!(logon.windows(2).any(|w| w == ["/TN", LOGON_TASK]));
        assert!(logon.iter().any(|a| a.contains("--background")));
        assert!(logon.windows(2).any(|w| w == ["/SC", "ONLOGON"]));
        assert!(watchdog.windows(2).any(|w| w == ["/TN", WATCHDOG_TASK]));
        assert!(watchdog.windows(2).any(|w| w == ["/SC", "MINUTE"]));
        assert!(watchdog.windows(2).any(|w| w == ["/MO", "5"]));
    }
}
