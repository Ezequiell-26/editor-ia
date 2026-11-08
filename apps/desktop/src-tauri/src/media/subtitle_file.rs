//! Validación pura de archivos de subtítulos importados (SRT/VTT/ASS/SSA).
//!
//! El diálogo nativo elige la ruta y la infraestructura lee bytes/tamaño;
//! acá viven sólo las reglas: extensión admitida, topes de tamaño, UTF-8 y
//! texto no vacío. Están separadas para conservar el orden histórico de los
//! errores: extensión → metadatos → tamaño → lectura → UTF-8 → no vacío.

use std::path::Path;

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_SUBTITLE_BYTES: u64 = 4 * 1024 * 1024;
const SUBTITLE_EXTENSIONS: [&str; 4] = ["srt", "vtt", "ass", "ssa"];

#[derive(Debug, Serialize)]
pub struct SubtitleFile {
    pub name: String,
    pub text: String,
}

/// Nombre de archivo para el DTO: la última componente de la ruta o el
/// fallback histórico.
pub fn subtitle_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("subtitulos.srt")
        .to_owned()
}

/// Extensión admitida, verificada antes de tocar el filesystem.
pub fn validate_subtitle_extension(path: &Path) -> Result<(), ProjectError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if SUBTITLE_EXTENSIONS.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí un archivo .srt, .vtt, .ass o .ssa",
        ))
    }
}

/// Tamaño declarado en disco: se valida antes de leer para no cargar un
/// archivo enorme en memoria.
pub fn validate_subtitle_len(len: u64) -> Result<(), ProjectError> {
    if len == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos está vacío",
        ));
    }
    if len > MAX_SUBTITLE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos supera los 4 MB",
        ));
    }
    Ok(())
}

/// UTF-8 válido y con texto visible.
pub fn decode_subtitle_text(bytes: &[u8]) -> Result<String, ProjectError> {
    let text = String::from_utf8(bytes.to_vec()).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos no está codificado en UTF-8",
        )
    })?;
    if text.trim().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de subtítulos no tiene texto",
        ));
    }
    Ok(text)
}
