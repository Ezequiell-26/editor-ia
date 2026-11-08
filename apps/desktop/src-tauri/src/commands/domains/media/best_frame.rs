//! Selección del mejor frame de un video para Miniaturas.
//!
//! Se muestrean 12 puntos del video con FFmpeg, se puntúa nitidez, contraste y
//! exposición en Rust y se publican los tres mejores PNG en la caché de la app.
//! No usa IA ni identifica caras: es una heurística local explicable.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use image::GenericImageView;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::{probe_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestFrameRequest {
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BestThumbnailFrame {
    pub path: String,
    pub score: f64,
    pub time_seconds: f64,
    pub width: u32,
    pub height: u32,
}

fn score_frame(path: &Path) -> Result<(f64, u32, u32), ProjectError> {
    let image = image::open(path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "FFmpeg generó un frame que no se pudo decodificar",
        )
    })?;
    let (width, height) = image.dimensions();
    if width < 3 || height < 3 {
        return Ok((0.0, width, height));
    }
    let luma = image.to_luma8();
    let mut count = 0.0f64;
    let mut sum = 0.0f64;
    let mut sum_squares = 0.0f64;
    let mut gradient = 0.0f64;
    for y in 1..height as u32 - 1 {
        for x in 1..width as u32 - 1 {
            let value = luma.get_pixel(x, y)[0] as f64;
            sum += value;
            sum_squares += value * value;
            let gx =
                (luma.get_pixel(x + 1, y)[0] as f64 - luma.get_pixel(x - 1, y)[0] as f64).abs();
            let gy =
                (luma.get_pixel(x, y + 1)[0] as f64 - luma.get_pixel(x, y - 1)[0] as f64).abs();
            gradient += gx + gy;
            count += 1.0;
        }
    }
    if count == 0.0 {
        return Ok((0.0, width, height));
    }
    let mean = sum / count;
    let variance = (sum_squares / count - mean * mean).max(0.0);
    let deviation = variance.sqrt();
    let sharpness = (gradient / count / 24.0).clamp(0.0, 1.0);
    let contrast = (deviation / 64.0).clamp(0.0, 1.0);
    let exposure = (1.0 - ((mean / 255.0) - 0.5).abs() * 2.0).clamp(0.0, 1.0);
    let score = (sharpness * 0.55 + contrast * 0.30 + exposure * 0.15) * 100.0;
    Ok((score, width, height))
}

fn extract_frames(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output_dir: &Path,
) -> Result<Vec<BestThumbnailFrame>, ProjectError> {
    let measured = probe_file(ffprobe, input, MediaKind::Video)?;
    let duration = measured.duration_seconds.unwrap_or(0.0);
    if duration <= 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el video no tiene una duración válida para elegir un frame",
        ));
    }
    let temp = output_dir.join(format!(".thumb-frames-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&temp).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar la caché de frames: {error}").as_str(),
        )
    })?;
    let samples = 12usize;
    let mut candidates: Vec<(PathBuf, f64, f64, u32, u32)> = Vec::new();
    for index in 0..samples {
        let fraction = 0.05 + 0.90 * index as f64 / (samples - 1) as f64;
        let time = duration * fraction;
        let frame = temp.join(format!("frame-{index:02}.png"));
        let mut command = Command::new(ffmpeg);
        command
            .args(["-v", "error", "-ss", &format!("{time:.3}"), "-i"])
            .arg(input)
            .args(["-frames:v", "1", "-vf", "scale=480:-2", "-y"])
            .arg(&frame)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console(&mut command);
        let status = command.status();
        if !status.map(|value| value.success()).unwrap_or(false) || !frame.is_file() {
            continue;
        }
        if let Ok((score, width, height)) = score_frame(&frame) {
            candidates.push((frame, score, time, width, height));
        }
    }
    if candidates.is_empty() {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "FFmpeg no pudo extraer ningún frame del video",
        ));
    }
    candidates.sort_by(|left, right| right.1.total_cmp(&left.1));
    let mut results = Vec::new();
    for (rank, (frame, score, time, width, height)) in candidates.into_iter().take(3).enumerate() {
        let final_path =
            output_dir.join(format!("mejor-frame-{}-{}.png", Uuid::new_v4(), rank + 1));
        std::fs::copy(&frame, &final_path).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo publicar el frame elegido: {error}").as_str(),
            )
        })?;
        results.push(BestThumbnailFrame {
            path: final_path.to_string_lossy().into_owned(),
            score: (score * 10.0).round() / 10.0,
            time_seconds: (time * 100.0).round() / 100.0,
            width,
            height,
        });
    }
    let _ = std::fs::remove_dir_all(&temp);
    Ok(results)
}

/// Devuelve los tres mejores frames de un video para usarlos como fondo de una
/// miniatura. Los PNG quedan en la caché de la app y el frontend los carga.
#[tauri::command]
pub async fn pick_thumbnail_frames(
    app: AppHandle,
    state: State<'_, AppState>,
    request: BestFrameRequest,
) -> Result<Vec<BestThumbnailFrame>, ProjectError> {
    let input = PathBuf::from(request.path.trim());
    if input.as_os_str().is_empty() || !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para elegir el frame no está en disco",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para elegir el frame",
        ));
    };
    let output_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo resolver la caché de miniaturas",
            )
        })?
        .join("thumbnails");
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo crear la caché de miniaturas: {error}").as_str(),
        )
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        extract_frames(&ffmpeg, &ffprobe, &input, &output_dir)
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("la selección de frames se interrumpió: {error}").as_str(),
        )
    })?
}

#[cfg(test)]
mod best_frame_tests {
    use super::*;

    #[test]
    fn sharp_images_score_higher_than_flat_ones() {
        let dir = std::env::temp_dir().join(format!("editoria-score-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta");
        let flat_path = dir.join("flat.png");
        let sharp_path = dir.join("sharp.png");
        let mut flat = image::RgbImage::new(64, 64);
        for pixel in flat.pixels_mut() {
            *pixel = image::Rgb([128, 128, 128]);
        }
        flat.save(&flat_path).expect("flat");
        let mut sharp = image::RgbImage::new(64, 64);
        for (x, y, pixel) in sharp.enumerate_pixels_mut() {
            let value = if (x / 4 + y / 4) % 2 == 0 { 0 } else { 255 };
            *pixel = image::Rgb([value, value, value]);
        }
        sharp.save(&sharp_path).expect("sharp");
        let flat_score = score_frame(&flat_path).expect("score flat").0;
        let sharp_score = score_frame(&sharp_path).expect("score sharp").0;
        assert!(sharp_score > flat_score);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_extracts_three_frames_from_a_video() {
        let dir = std::env::temp_dir().join(format!("editoria-frames-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta");
        let video = dir.join("testsrc.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:d=3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg");
        assert!(generated.success());
        let frames = extract_frames(Path::new("ffmpeg"), Path::new("ffprobe"), &video, &dir)
            .expect("frames");
        assert!(!frames.is_empty());
        assert!(frames.iter().all(|frame| Path::new(&frame.path).is_file()));
        assert!(frames[0].score >= frames[frames.len() - 1].score);
        println!("mejor frame: {:?}", frames[0]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
