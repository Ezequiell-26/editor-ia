//! Native subtitle file picker. The dialog chooses a local `.srt`, `.vtt`,
//! `.ass` or `.ssa`; the native side only reads and validates the text, and the
//! UI parses and imports it into the project.
//!
//! La lectura y validación viven en `media::subtitle_file` (reglas puras),
//! `application::media::read_subtitle_file` (orquestación) y
//! `infrastructure::media::state.subtitle_files()` (filesystem).

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::projects::service::ProjectError;
use crate::state::AppState;

pub use crate::media::subtitle_file::SubtitleFile;

#[tauri::command]
pub async fn choose_subtitle_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<SubtitleFile>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Importar subtítulos SRT/VTT/ASS")
        .add_filter("Subtítulos", &["srt", "vtt", "ass", "ssa"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(
            crate::projects::service::ProjectErrorCode::Io,
            "no se pudo usar la ruta elegida",
        )
    })?;
    crate::application::media::read_subtitle_file(&state.subtitle_files(), &path).map(Some)
}
