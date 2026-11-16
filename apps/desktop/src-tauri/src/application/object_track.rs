//! Caso de uso: seguimiento de objeto por template matching (NCC).
//!
//! Orquesta el puerto `ObjectTrackBackend`: sondea dimensiones, dimensiona
//! el frame de análisis y trackea por chunks re-sembrando el rectángulo en
//! cada ventana — la memoria queda acotada a ~5 segundos de frames
//! decodificados. La validación de entrada ya ocurrió en el comando IPC.

use std::path::Path;

use crate::media::object_track::{
    scaled_dims, track_frames, MAX_SCALE, MIN_CONFIDENCE, MIN_SCALE, SAMPLE_FPS,
};
use crate::media::object_track::{ObjectTrackRect, ObjectTrackResult, ObjectTrackSample};
use crate::ports::object_track::ObjectTrackBackend;
use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Frames por chunk de tracking: 5 segundos a `SAMPLE_FPS` — acota la
/// memoria de frames decodificados y permite re-sembrar el rectángulo.
const TRACK_CHUNK_FRAMES: usize = SAMPLE_FPS as usize * 5;

/// Ejecuta el seguimiento completo y devuelve los samples normalizados.
pub fn track_object(
    backend: &dyn ObjectTrackBackend,
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    start_seconds: f64,
    duration: f64,
    rect: ObjectTrackRect,
) -> Result<ObjectTrackResult, ProjectError> {
    let (src_w, src_h) = backend.probe_dimensions(ffprobe, input)?;
    let (w, h) = scaled_dims(src_w, src_h);
    let mut current_rect = rect.clone();
    let seed_rect = rect;
    let seed_max_side = (seed_rect.w * w as f64)
        .max(seed_rect.h * h as f64)
        .max(1.0);
    let mut samples: Vec<ObjectTrackSample> = Vec::new();

    backend.stream_frame_chunks(
        ffmpeg,
        input,
        start_seconds,
        duration,
        w,
        h,
        TRACK_CHUNK_FRAMES,
        &mut |chunk| {
            let mut tracked = track_frames(&chunk, w, h, &current_rect);
            let offset = samples.len() as f64 / f64::from(SAMPLE_FPS);
            for sample in &mut tracked {
                sample.time += offset;
            }
            // Track only a short window at a time. This bounds decoded-frame
            // memory to ~5 seconds and re-seeds the next chunk at the
            // previous target box.
            if let Some(last) = tracked.last() {
                let scale = (last.size * f64::from(w.max(h)) / seed_max_side)
                    .clamp(MIN_SCALE, MAX_SCALE);
                let next_w = (seed_rect.w * scale).clamp(0.005, 1.0);
                let next_h = (seed_rect.h * scale).clamp(0.005, 1.0);
                current_rect = ObjectTrackRect {
                    x: (last.center_x - next_w / 2.0).clamp(0.0, 1.0 - next_w),
                    y: (last.center_y - next_h / 2.0).clamp(0.0, 1.0 - next_h),
                    w: next_w,
                    h: next_h,
                };
            }
            samples.extend(tracked);
            Ok(())
        },
    )?;

    if samples.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no produjo frames para el seguimiento",
        ));
    }
    let confident = samples
        .iter()
        .filter(|s| s.confidence >= MIN_CONFIDENCE)
        .count() as u32;
    Ok(ObjectTrackResult {
        frames: samples.len() as u32,
        confident,
        samples,
        duration_seconds: duration,
        scaled_width: w,
        scaled_height: h,
    })
}
