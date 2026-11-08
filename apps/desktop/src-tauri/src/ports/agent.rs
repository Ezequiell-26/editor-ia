//! Puerto del vigilante de cola (tareas programadas de Windows).

use crate::projects::service::ProjectError;

/// Ejecuta `schtasks` y las consultas de tareas. La construcción de los
/// argumentos vive en `ai::watchdog`.
pub trait WatchdogTasks: Send + Sync {
    /// `schtasks <args>` → éxito del proceso.
    fn run(&self, args: &[String]) -> bool;
    /// ¿Existe la tarea programada con ese nombre?
    fn task_exists(&self, name: &str) -> bool;
    /// Ruta del ejecutable actual.
    fn current_exe(&self) -> Result<String, ProjectError>;
}
