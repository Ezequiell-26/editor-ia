//! Quality Gate del proyecto abierto.
//!
//! Adaptador IPC delgado: la revisión vive en `application::quality_gate`
//! (comprobaciones puras de `studio::quality` + verificación de archivos en
//! disco) y la sesión/documento llegan por los puertos de `AppState`.
//!
//! El comando evalúa el último estado persistido del proyecto: la UI debe
//! guardar antes de pedir el veredicto si tiene cambios en memoria.

use tauri::State;

use crate::application::quality_gate as use_cases;
use crate::projects::service::ProjectError;
use crate::state::AppState;
use crate::studio::quality::QualityReportSummary;

#[tauri::command]
pub async fn quality_gate_review(
    state: State<'_, AppState>,
) -> Result<QualityReportSummary, ProjectError> {
    let session = state.project_session();
    let documents = state.project_documents();
    use_cases::review_open_project(&session, &documents)
}
