//! Capacidades de export y verificación — adaptador IPC.
//!
//! La lógica vive en `render::export_tools` (puro) y `application::export_tools`
//! (casos de uso) sobre los puertos `MediaTools`/`MediaRunner`/`LosslessOutputs`.
//! Acá quedan el contrato IPC y `verify_file`, helper que el worker de render
//! reutiliza al terminar una entrega.

use std::path::Path;

use tauri::State;

use crate::infrastructure::media::{StateMediaTools, SystemMediaRunner};
use crate::infrastructure::render_lossless::LocalLosslessOutputs;
use crate::ports::media::MediaTools;
use crate::projects::service::ProjectError;
use crate::state::AppState;

pub use crate::render::export_tools::{
    CodecCapability, ContainerCapability, ExportCapabilities, ExportVerification,
};

/// Matriz de exportación real del FFmpeg configurado.
#[tauri::command]
pub async fn export_capabilities(
    state: State<'_, AppState>,
) -> Result<ExportCapabilities, ProjectError> {
    let tools = StateMediaTools::new(&state);
    let runner = SystemMediaRunner;
    crate::application::export_tools::export_capabilities(&tools, &runner)
}

/// Verifica un archivo existente con FFprobe; usado por el comando y por el
/// worker de render al terminar (`render-finished.verification`).
pub fn verify_file(ffprobe: &Path, path: &Path) -> Result<ExportVerification, ProjectError> {
    crate::application::export_tools::verify_export_file(
        &SystemMediaRunner,
        &LocalLosslessOutputs,
        ffprobe,
        path,
    )
}

#[tauri::command]
pub async fn verify_export(
    state: State<'_, AppState>,
    path: String,
) -> Result<ExportVerification, ProjectError> {
    let tools = StateMediaTools::new(&state);
    let Some(ffprobe) = tools.ffprobe_path() else {
        return Err(ProjectError::message(
            crate::projects::service::ProjectErrorCode::Io,
            "FFprobe no está configurado",
        ));
    };
    verify_file(&ffprobe, Path::new(path.trim()))
}
