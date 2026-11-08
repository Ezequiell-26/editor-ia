//! Casos de uso de capacidades de export y verificación de archivos.
//!
//! La matriz de códecs se construye en `render::export_tools` (puro); acá se
//! resuelve la ruta de ffmpeg/ffprobe por `MediaTools`, se ejecuta el sondeo
//! por `MediaRunner` y se mide el archivo por `LosslessOutputs`.

use std::path::Path;

use serde_json::Value;

use crate::ports::media::{MediaRunner, MediaTools};
use crate::ports::render::LosslessOutputs;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::export_tools::{
    matrix_from_encoders, parse_verification, ExportCapabilities, ExportVerification,
};

/// Matriz de exportación real del FFmpeg configurado.
pub fn export_capabilities(
    tools: &dyn MediaTools,
    runner: &dyn MediaRunner,
) -> Result<ExportCapabilities, ProjectError> {
    let Some(ffmpeg) = tools.ffmpeg_path() else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está configurado; no se pueden detectar los códecs disponibles",
        ));
    };
    let _ = runner;
    Ok(matrix_from_encoders(&crate::render::ffmpeg::encoder_names(
        &ffmpeg,
    )))
}

/// Verifica un archivo existente con FFprobe; usado por el comando y por el
/// worker de render al terminar (`render-finished.verification`).
pub fn verify_export_file(
    runner: &dyn MediaRunner,
    outputs: &dyn LosslessOutputs,
    ffprobe: &Path,
    path: &Path,
) -> Result<ExportVerification, ProjectError> {
    let bytes = outputs.file_bytes(path);
    if bytes == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo exportado no existe o está vacío",
        ));
    }
    let args = [
        "-v".to_owned(),
        "error".to_owned(),
        "-show_streams".to_owned(),
        "-show_format".to_owned(),
        "-of".to_owned(),
        "json".to_owned(),
        path.to_string_lossy().into_owned(),
    ];
    let output = runner.run_ffprobe(ffprobe, &args).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFprobe para verificar el archivo",
        )
    })?;
    let document: Value = serde_json::from_slice(&output.stdout).unwrap_or(Value::Null);
    if !output.status.success() || document["streams"].is_null() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFprobe no pudo leer el archivo exportado",
        ));
    }
    Ok(parse_verification(path, &document, bytes))
}
