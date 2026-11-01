//! Seguimiento de un punto elegido por el usuario sobre un video.
//!
//! Extrae frames grises a 480 px con FFmpeg y corre el tracker NCC propio
//! (`render::point_track`). La salida son posiciones normalizadas con
//! confianza; la UI las convierte en keyframes de máscara/transformación.
//! No usa OpenCV ni sube nada.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::point_track::{track_point, track_region, GrayFrame};
use crate::state::AppState;

const MAX_FRAMES: usize = 240;
const SAMPLE_RATE: f64 = 6.0;
const MAX_DURATION: f64 = 30.0;
const PATCH_RADIUS: u32 = 10;
const SEARCH_RADIUS: u32 = 24;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointTrackRequest {
    pub path: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    /// Centro inicial normalizado (0..1) sobre el frame escalado.
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointTrackSample {
    pub time: f64,
    pub x: f64,
    pub y: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointTrackResult {
    pub duration_seconds: f64,
    pub fps: f64,
    pub scaled_width: u32,
    pub scaled_height: u32,
    pub points: Vec<PointTrackSample>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTrackRequest {
    pub path: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    /// Centro inicial y tamaño de la caja normalizados (0..1).
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTrackResult {
    pub duration_seconds: f64,
    pub fps: f64,
    pub scaled_width: u32,
    pub scaled_height: u32,
    pub region_width: f64,
    pub region_height: f64,
    pub points: Vec<PointTrackSample>,
}

fn validate_range(start: f64, end: f64) -> Result<f64, ProjectError> {
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el rango de seguimiento no es válido",
        ));
    }
    let duration = end - start;
    if duration > MAX_DURATION {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el seguimiento de punto se limita a 30 segundos",
        ));
    }
    Ok(duration)
}

fn sample_count(duration: f64) -> usize {
    ((duration * SAMPLE_RATE).ceil() as usize).clamp(12, MAX_FRAMES)
}

fn extract_frames(
    ffmpeg: &Path,
    input: &Path,
    start: f64,
    duration: f64,
    count: usize,
    directory: &Path,
) -> Result<Vec<PathBuf>, ProjectError> {
    let fps = count as f64 / duration;
    let pattern = directory.join("frame-%04d.png");
    let mut command = Command::new(ffmpeg);
    command
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{start:.3}"),
            "-i",
        ])
        .arg(input)
        .args([
            "-t",
            &format!("{duration:.3}"),
            "-vf",
            &format!("fps={fps:.4},scale=480:-2"),
            "-frames:v",
            &count.to_string(),
        ])
        .arg(&pattern)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = command.output().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudieron extraer frames para el seguimiento: {error}").as_str(),
        )
    })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            detail
                .lines()
                .last()
                .unwrap_or("FFmpeg no pudo extraer frames para el seguimiento")
                .chars()
                .take(240)
                .collect::<String>()
                .as_str(),
        ));
    }
    let mut frames: Vec<PathBuf> = std::fs::read_dir(directory)
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo leer el directorio temporal del seguimiento",
            )
        })?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.eq_ignore_ascii_case("png"))
                .unwrap_or(false)
        })
        .collect();
    frames.sort();
    Ok(frames)
}

fn load_gray_frames(frames: &[PathBuf]) -> Result<(u32, u32, Vec<GrayFrame>), ProjectError> {
    let mut gray_frames = Vec::new();
    let mut dimensions = (0u32, 0u32);
    for path in frames {
        let image = image::open(path).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo leer un frame del seguimiento: {error}").as_str(),
            )
        })?;
        let gray = image.to_luma8();
        let width = gray.width();
        let height = gray.height();
        if gray_frames.is_empty() {
            dimensions = (width, height);
        } else if dimensions != (width, height) {
            break;
        }
        gray_frames.push(GrayFrame {
            width,
            height,
            data: gray.into_raw(),
        });
    }
    if gray_frames.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el video no produjo frames para el seguimiento",
        ));
    }
    Ok((dimensions.0, dimensions.1, gray_frames))
}

/// Convierte los frames temporales a gris y ejecuta el tracker de punto.
fn track_frames(
    frames: &[PathBuf],
    start_x: f64,
    start_y: f64,
) -> Result<(u32, u32, Vec<crate::render::point_track::PointTrack>), ProjectError> {
    let (width, height, gray_frames) = load_gray_frames(frames)?;
    let x = start_x.clamp(0.0, 1.0) * f64::from(width.saturating_sub(1));
    let y = start_y.clamp(0.0, 1.0) * f64::from(height.saturating_sub(1));
    let track = track_point(&gray_frames, x, y, PATCH_RADIUS, SEARCH_RADIUS);
    Ok((width, height, track))
}

fn region_pixels(normalized: f64, frame: u32) -> u32 {
    let pixels = (normalized.clamp(0.01, 1.0) * f64::from(frame)).round() as u32;
    pixels.clamp(4, 240)
}

/// Convierte los frames temporales a gris y ejecuta el tracker de región.
fn track_region_frames(
    frames: &[PathBuf],
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<
    (
        u32,
        u32,
        f64,
        f64,
        Vec<crate::render::point_track::PointTrack>,
    ),
    ProjectError,
> {
    let (frame_width, frame_height, gray_frames) = load_gray_frames(frames)?;
    let region_width = region_pixels(width, frame_width);
    let region_height = region_pixels(height, frame_height);
    let start_x = x.clamp(0.0, 1.0) * f64::from(frame_width.saturating_sub(1));
    let start_y = y.clamp(0.0, 1.0) * f64::from(frame_height.saturating_sub(1));
    let track = track_region(
        &gray_frames,
        start_x,
        start_y,
        region_width,
        region_height,
        SEARCH_RADIUS,
    );
    Ok((
        frame_width,
        frame_height,
        f64::from(region_width) / f64::from(frame_width.max(1)),
        f64::from(region_height) / f64::from(frame_height.max(1)),
        track,
    ))
}

#[tauri::command]
pub async fn track_point_in_video(
    state: State<'_, AppState>,
    request: PointTrackRequest,
) -> Result<PointTrackResult, ProjectError> {
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para seguir el punto ya no está en el proyecto",
        ));
    }
    let duration = validate_range(request.start_seconds, request.end_seconds)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para seguir el punto",
        ));
    };
    let directory = std::env::temp_dir().join(format!("editoria-point-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el seguimiento: {error}").as_str(),
        )
    })?;
    let result = (|| -> Result<PointTrackResult, ProjectError> {
        let count = sample_count(duration);
        let frames = extract_frames(
            &ffmpeg,
            &input,
            request.start_seconds,
            duration,
            count,
            &directory,
        )?;
        let (width, height, track) = track_frames(&frames, request.x, request.y)?;
        let fps = count as f64 / duration;
        let points = track
            .iter()
            .map(|point| PointTrackSample {
                time: point.frame as f64 / fps,
                x: if width > 1 {
                    (point.x / f64::from(width - 1)).clamp(0.0, 1.0)
                } else {
                    0.0
                },
                y: if height > 1 {
                    (point.y / f64::from(height - 1)).clamp(0.0, 1.0)
                } else {
                    0.0
                },
                confidence: point.confidence.clamp(0.0, 1.0),
            })
            .collect();
        Ok(PointTrackResult {
            duration_seconds: duration,
            fps,
            scaled_width: width,
            scaled_height: height,
            points,
        })
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

#[tauri::command]
pub async fn track_object_in_video(
    state: State<'_, AppState>,
    request: ObjectTrackRequest,
) -> Result<ObjectTrackResult, ProjectError> {
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para seguir el objeto ya no está en el proyecto",
        ));
    }
    let duration = validate_range(request.start_seconds, request.end_seconds)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para seguir el objeto",
        ));
    };
    let directory = std::env::temp_dir().join(format!("editoria-object-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el seguimiento: {error}").as_str(),
        )
    })?;
    let result = (|| -> Result<ObjectTrackResult, ProjectError> {
        let count = sample_count(duration);
        let frames = extract_frames(
            &ffmpeg,
            &input,
            request.start_seconds,
            duration,
            count,
            &directory,
        )?;
        let (width, height, region_width, region_height, track) = track_region_frames(
            &frames,
            request.x,
            request.y,
            request.width,
            request.height,
        )?;
        let fps = count as f64 / duration;
        let points = track
            .iter()
            .map(|point| PointTrackSample {
                time: point.frame as f64 / fps,
                x: if width > 1 {
                    (point.x / f64::from(width - 1)).clamp(0.0, 1.0)
                } else {
                    0.0
                },
                y: if height > 1 {
                    (point.y / f64::from(height - 1)).clamp(0.0, 1.0)
                } else {
                    0.0
                },
                confidence: point.confidence.clamp(0.0, 1.0),
            })
            .collect();
        Ok(ObjectTrackResult {
            duration_seconds: duration,
            fps,
            scaled_width: width,
            scaled_height: height,
            region_width: region_width.clamp(0.0, 1.0),
            region_height: region_height.clamp(0.0, 1.0),
            points,
        })
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_the_tracking_range() {
        assert!(validate_range(0.0, 2.0).is_ok());
        assert!(validate_range(-1.0, 2.0).is_err());
        assert!(validate_range(2.0, 2.0).is_err());
        assert!(validate_range(0.0, 31.0).is_err());
    }

    #[test]
    fn samples_between_twelve_and_the_cap() {
        assert_eq!(sample_count(0.5), 12);
        assert_eq!(sample_count(2.0), 12);
        assert_eq!(sample_count(10.0), 60);
        assert_eq!(sample_count(30.0), 180);
        assert_eq!(sample_count(100.0), MAX_FRAMES);
    }

    #[test]
    fn reads_frames_from_disk_and_tracks_the_square() {
        let directory =
            std::env::temp_dir().join(format!("editoria-point-frames-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut paths = Vec::new();
        for index in 0..8i32 {
            let mut image = image::GrayImage::from_pixel(160, 120, image::Luma([30]));
            let left = 20 + index * 4;
            for y in 50..66u32 {
                for x in (left as u32)..((left + 16) as u32) {
                    image.put_pixel(x, y, image::Luma([230]));
                }
            }
            let path = directory.join(format!("frame-{index:04}.png"));
            image.save(&path).unwrap();
            paths.push(path);
        }
        let (width, height, track) = track_frames(&paths, 28.0 / 159.0, 58.0 / 119.0).unwrap();
        assert_eq!((width, height), (160, 120));
        assert_eq!(track.len(), 8);
        assert!(track.last().unwrap().x > track[0].x + 20.0);
        assert!(track.last().unwrap().confidence > 0.7);
        let _ = std::fs::remove_dir_all(&directory);
    }

    fn patterned_image(index: i32) -> image::GrayImage {
        let mut image = image::GrayImage::from_pixel(160, 120, image::Luma([30]));
        let left = 20 + index * 4;
        for y in 50..74u32 {
            for x in (left as u32)..((left + 24) as u32) {
                let cell = ((x - left as u32) / 4 + (y - 50) / 4) % 2;
                image.put_pixel(x, y, image::Luma([if cell == 0 { 235 } else { 120 }]));
            }
        }
        image
    }

    #[test]
    fn limits_region_pixels_to_the_frame() {
        assert_eq!(region_pixels(0.0, 480), 5);
        assert_eq!(region_pixels(1.0, 480), 240);
        assert_eq!(region_pixels(0.5, 480), 240);
        assert_eq!(region_pixels(0.1, 100), 10);
    }

    #[test]
    fn reads_frames_and_tracks_the_pattern_region() {
        let directory =
            std::env::temp_dir().join(format!("editoria-object-frames-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let mut paths = Vec::new();
        for index in 0..8i32 {
            let path = directory.join(format!("frame-{index:04}.png"));
            patterned_image(index).save(&path).unwrap();
            paths.push(path);
        }
        let (width, height, region_width, region_height, track) = track_region_frames(
            &paths,
            32.0 / 159.0,
            62.0 / 119.0,
            20.0 / 160.0,
            20.0 / 120.0,
        )
        .unwrap();
        assert_eq!((width, height), (160, 120));
        assert!(region_width > 0.1 && region_height > 0.1);
        assert_eq!(track.len(), 8);
        assert!(track.last().unwrap().x > track[0].x + 20.0);
        assert!(track.last().unwrap().confidence > 0.7);
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    #[ignore]
    fn live_ffmpeg_tracks_a_moving_square_in_a_video() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("live_ffmpeg_tracks_a_moving_square omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        let ffmpeg =
            crate::commands::system::find_executable("ffmpeg", None).expect("ffmpeg instalado");
        let directory =
            std::env::temp_dir().join(format!("editoria-point-live-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let video = directory.join("move.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "nullsrc=s=320x180:d=2:r=10,format=gray,geq=lum='if(between(X,20+T*40,36+T*40)*between(Y,80,96),235,20)'",
                "-c:v",
                "libopenh264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&video)
            .status()
            .expect("generar video");
        assert!(status.success());
        let frames = extract_frames(&ffmpeg, &video, 0.0, 2.0, 12, &directory).unwrap();
        assert!(frames.len() >= 10, "frames extraídos: {}", frames.len());
        let (width, height, track) = track_frames(&frames, 28.0 / 320.0, 88.0 / 180.0).unwrap();
        assert!(width >= 320 && height >= 180);
        assert!(track.len() >= 10);
        let first = track.first().unwrap();
        let last = track.last().unwrap();
        assert!(
            last.x > first.x + 20.0,
            "x inicial {} final {} (ancho {width})",
            first.x,
            last.x
        );
        assert!(last.confidence > 0.5, "confianza {}", last.confidence);
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    #[ignore]
    fn live_ffmpeg_tracks_a_moving_object_in_a_video() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("live_ffmpeg_tracks_a_moving_object omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        let ffmpeg =
            crate::commands::system::find_executable("ffmpeg", None).expect("ffmpeg instalado");
        let directory =
            std::env::temp_dir().join(format!("editoria-object-live-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let video = directory.join("move.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "nullsrc=s=320x180:d=2:r=10,format=gray,geq=lum='if(between(X,20+T*40,44+T*40)*between(Y,80,104),if(mod(floor((X-20)/4)+floor((Y-80)/4),2),235,120),20)'",
                "-c:v",
                "libopenh264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&video)
            .status()
            .expect("generar video");
        assert!(status.success());
        let frames = extract_frames(&ffmpeg, &video, 0.0, 2.0, 12, &directory).unwrap();
        assert!(frames.len() >= 10, "frames extraídos: {}", frames.len());
        let (width, height, region_width, region_height, track) = track_region_frames(
            &frames,
            32.0 / 320.0,
            92.0 / 180.0,
            20.0 / 320.0,
            20.0 / 180.0,
        )
        .unwrap();
        assert!(width >= 320 && height >= 180);
        assert!(region_width > 0.0 && region_height > 0.0);
        assert!(track.len() >= 10);
        let first = track.first().unwrap();
        let last = track.last().unwrap();
        assert!(
            last.x > first.x + 20.0,
            "x inicial {} final {} (ancho {width})",
            first.x,
            last.x
        );
        assert!(last.confidence > 0.5, "confianza {}", last.confidence);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
