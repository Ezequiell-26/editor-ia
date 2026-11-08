//! Native subtitle file picker. The dialog chooses a local `.srt`, `.vtt`,
//! `.ass` or `.ssa`; the native side only reads and validates the text, and the
//! UI parses and imports it into the project.
//!
//! La lectura y validación viven en `media::subtitle_file` (reglas puras),
//! `application::media::read_subtitle_file` (orquestación) y
//! `infrastructure::media::LocalSubtitleFiles` (filesystem).

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::infrastructure::media::LocalSubtitleFiles;
use crate::projects::service::ProjectError;

pub use crate::media::subtitle_file::SubtitleFile;

#[tauri::command]
pub async fn choose_subtitle_file(app: AppHandle) -> Result<Option<SubtitleFile>, ProjectError> {
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
    crate::application::media::read_subtitle_file(&LocalSubtitleFiles, &path).map(Some)
}
