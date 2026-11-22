//! Seguimiento de objeto genérico por template matching (NCC) — adaptador IPC.
//!
//! La validación de rango/rectángulo y la resolución de herramientas FFmpeg
//! son frontera IPC; el tracking en sí vive en `media::object_track`
//! (dominio puro), el stream de frames en `infrastructure::object_track`
//! (FFmpeg) y la orquestación por chunks en `application::object_track`.

use tauri::State;

use crate::media::object_track::validate_rect;
pub use crate::media::object_track::{
    ObjectTrackRect, ObjectTrackRequest, ObjectTrackResult, ObjectTrackSample,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Límite de ventana analizada: el tracking es por clip, no por película.
const MAX_TRACK_SECONDS: f64 = 180.0;

/// Valida el rango temporal igual que el análisis de rostros más el tope
/// propio del tracking (3 minutos por análisis).
fn validate_object_range(start: f64, end: f64) -> Result<f64, ProjectError> {
    let duration = crate::commands::shorts::validate_face_range(start, end)?;
    if duration > MAX_TRACK_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!(
                "el seguimiento de objeto admite hasta {MAX_TRACK_SECONDS:.0} segundos por análisis"
            ),
        ));
    }
    Ok(duration)
}

#[tauri::command]
pub async fn track_object(
    state: State<'_, AppState>,
    request: ObjectTrackRequest,
) -> Result<ObjectTrackResult, ProjectError> {
    let session = state.require_session()?;
    let input = crate::media::resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para seguir ya no está en el proyecto",
        ));
    }
    let duration = validate_object_range(request.start_seconds, request.end_seconds)?;
    let rect = validate_rect(&request.rect)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = crate::commands::system::resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg/FFprobe no están disponibles para el seguimiento",
        ));
    };
    let start_seconds = request.start_seconds;
    let backend = state.object_track_backend();
    tauri::async_runtime::spawn_blocking(move || {
        crate::application::object_track::track_object(
            &backend,
            &ffmpeg,
            &ffprobe,
            &input,
            start_seconds,
            duration,
            rect,
        )
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el seguimiento del objeto se interrumpió antes de terminar",
        )
    })?
}
