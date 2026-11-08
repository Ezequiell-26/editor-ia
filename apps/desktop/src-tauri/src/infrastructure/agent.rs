//! Adaptador del vigilante de cola sobre `schtasks.exe`.

use std::process::Command;

use crate::ports::agent::WatchdogTasks;
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub struct SchtasksWatchdog;

impl Default for SchtasksWatchdog {
    fn default() -> Self {
        Self::new()
    }
}

impl SchtasksWatchdog {
    pub fn new() -> Self {
        Self
    }
}

impl WatchdogTasks for SchtasksWatchdog {
    fn run(&self, args: &[String]) -> bool {
        let mut command = Command::new("schtasks");
        command
            .args(args.iter().map(String::as_str))
            .stdin(std::process::Stdio::null());
        crate::commands::hide_console(&mut command);
        command
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn task_exists(&self, name: &str) -> bool {
        self.run(&["/Query".to_owned(), "/TN".to_owned(), name.to_owned()])
    }

    fn current_exe(&self) -> Result<String, ProjectError> {
        std::env::current_exe()
            .map(|exe| exe.to_string_lossy().into_owned())
            .map_err(|_| agent_error("No se pudo ubicar el ejecutable de Olyvia."))
    }
}

fn agent_error(message: impl Into<String>) -> ProjectError {
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message.into())
}
