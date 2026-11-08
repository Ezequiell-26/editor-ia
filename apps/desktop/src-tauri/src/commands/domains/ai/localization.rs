//! Localization Studio: publica subtítulos traducidos sin confiar en el nombre
//! ni en el formato que manda el frontend.
//!
//! Las reglas puras (saneado de tokens, validación de formato/contenido,
//! nombre único) viven en `media::localized_subtitle`; la escritura atómica
//! en `infrastructure::media::LocalLocalizedSubtitleFiles`; la orquestación
//! en `application::localization`.

pub use crate::media::localized_subtitle::{
    SaveLocalizedSubtitleRequest, SaveLocalizedSubtitleResult,
};

use tauri::State;

use crate::projects::service::ProjectError;
use crate::state::AppState;

/// Guarda un subtítulo traducido y devuelve la ruta publicada.
#[tauri::command]
pub fn save_localized_subtitle(
    state: State<'_, AppState>,
    request: SaveLocalizedSubtitleRequest,
) -> Result<SaveLocalizedSubtitleResult, ProjectError> {
    crate::application::localization::save_localized_subtitle(
        &state.localized_subtitle_files(),
        request,
    )
}
