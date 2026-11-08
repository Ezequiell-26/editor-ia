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

use crate::infrastructure::media::LocalLocalizedSubtitleFiles;
use crate::projects::service::ProjectError;

/// Guarda un subtítulo traducido y devuelve la ruta publicada.
#[tauri::command]
pub fn save_localized_subtitle(
    request: SaveLocalizedSubtitleRequest,
) -> Result<SaveLocalizedSubtitleResult, ProjectError> {
    crate::application::localization::save_localized_subtitle(
        &LocalLocalizedSubtitleFiles::new(),
        request,
    )
}
