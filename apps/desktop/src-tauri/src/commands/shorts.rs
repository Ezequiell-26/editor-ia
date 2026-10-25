//! Exporta un rango de un asset como short vertical 1080×1920.
//!
//! El encuadre es un recorte central (sin detección de rostro): escala el video
//! para cubrir el lienzo y recorta los lados o el alto que sobran. El audio se
//! conserva; si el material no tiene audio, el MP4 se publica sin pista de audio.
//! La salida se escribe en un temporal oculto, se verifica con FFprobe y recién
//! entonces se renombra.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::face::{self, FaceSample};
use crate::commands::hide_console;
use crate::commands::models::{is_model_downloaded, model_by_id, model_file, verify_model_hash};
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const SHORT_WIDTH: u32 = 1080;
const SHORT_HEIGHT: u32 = 1920;
const MIN_SECONDS: f64 = 3.0;
const MAX_SECONDS: f64 = 90.0;
/// El análisis de rostros no es un short: acepta clips cortos y ventanas
/// largas (hasta 10 minutos) porque sólo muestrea 6–30 frames.
const FACE_MIN_SECONDS: f64 = 0.1;
const FACE_MAX_SECONDS: f64 = 600.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportShortRequest {
    /// Ruta del asset relativa a la carpeta del proyecto.
    pub path: String,
    pub output_dir: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    #[serde(default)]
    pub label: Option<String>,
    /// Sigue el rostro más grande con el modelo SeetaFace local.
    #[serde(default)]
    pub smart_reframe: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportShortResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    /// `smart` si el encuadre siguió rostros; `center` si fue recorte fijo.
    pub reframe: String,
    /// Cantidad de frames muestreados en los que se encontró al menos un rostro.
    pub faces_detected: u32,
}

pub(crate) fn vertical_short_filter() -> String {
    format!(
        "scale={SHORT_WIDTH}:{SHORT_HEIGHT}:force_original_aspect_ratio=increase,crop={SHORT_WIDTH}:{SHORT_HEIGHT},setsar=1"
    )
}

pub(crate) fn validate_short_range(start: f64, end: f64) -> Result<f64, ProjectError> {
    if !start.is_finite() || !end.is_finite() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el rango del short no es numérico",
        ));
    }
    if start < 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el short no puede empezar antes de cero",
        ));
    }
    let duration = end - start;
    if duration < MIN_SECONDS || duration > MAX_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("un short debe durar entre {MIN_SECONDS:.0} y {MAX_SECONDS:.0} segundos"),
        ));
    }
    Ok(duration)
}

pub(crate) fn validate_face_range(start: f64, end: f64) -> Result<f64, ProjectError> {
    if !start.is_finite() || !end.is_finite() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el rango para analizar rostros no es numérico",
        ));
    }
    if start < 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el análisis de rostros no puede empezar antes de cero",
        ));
    }
    let duration = end - start;
    if duration < FACE_MIN_SECONDS || duration > FACE_MAX_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!(
                "el tramo para rostros debe durar entre {FACE_MIN_SECONDS:.1} y {FACE_MAX_SECONDS:.0} segundos"
            ),
        ));
    }
    Ok(duration)
}

fn fold_accent(ch: char) -> char {
    match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        _ => ch,
    }
}

fn safe_stem(value: &str, fallback: &str) -> String {
    let mapped: String = value
        .trim()
        .chars()
        .map(|ch| {
            let lower = ch.to_lowercase().next().unwrap_or(ch);
            let folded = fold_accent(lower);
            if folded.is_ascii_alphanumeric() || folded == '-' || folded == '_' {
                folded
            } else {
                '-'
            }
        })
        .collect();
    let collapsed = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let trimmed = collapsed.trim_matches('-').trim_matches('_').to_owned();
    if trimmed.is_empty() {
        fallback.to_owned()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn unique_path(dir: &Path, stem: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}-vertical.mp4"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-vertical-{index}.mp4"));
        index += 1;
    }
    candidate
}

/// Extrae frames muestreados y detecta el rostro más grande en cada uno.
/// Devuelve sólo las muestras con detección; la expresión de FFmpeg interpola
/// los huecos. El directorio temporal se borra siempre.
fn extract_face_samples(
    app: Option<&AppHandle>,
    ffmpeg: &Path,
    model_path: &Path,
    input: &Path,
    start_seconds: f64,
    duration: f64,
) -> Result<Vec<FaceSample>, ProjectError> {
    let directory = std::env::temp_dir().join(format!("editoria-faces-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el análisis de rostros: {error}").as_str(),
        )
    })?;
    let result = (|| -> Result<Vec<FaceSample>, ProjectError> {
        let target = ((duration * 1.5).ceil() as usize).clamp(6, 30);
        let fps = target as f64 / duration;
        let pattern = directory.join("frame-%04d.jpg");
        let fps_arg = format!("{fps:.4}");
        let mut command = Command::new(ffmpeg);
        command
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                &format!("{start_seconds:.3}"),
                "-i",
            ])
            .arg(input)
            .args([
                "-t",
                &format!("{duration:.3}"),
                "-vf",
                &format!("fps={fps_arg},scale=480:-2"),
                "-q:v",
                "3",
                "-frames:v",
                &target.to_string(),
            ])
            .arg(&pattern)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let output = command.output().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudieron extraer frames para rostros: {error}").as_str(),
            )
        })?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                detail
                    .lines()
                    .last()
                    .unwrap_or("FFmpeg no pudo extraer frames para el análisis facial")
                    .chars()
                    .take(240)
                    .collect::<String>()
                    .as_str(),
            ));
        }
        let mut frames: Vec<PathBuf> = std::fs::read_dir(&directory)
            .map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudo leer el directorio temporal de rostros",
                )
            })?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("jpg"))
                    .unwrap_or(false)
            })
            .collect();
        frames.sort();
        if frames.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "no se extrajeron frames para analizar rostros",
            ));
        }
        let mut detector = face::create_detector(model_path)
            .map_err(|detail| ProjectError::message(ProjectErrorCode::Io, &detail))?;
        let mut samples = Vec::new();
        for (index, path) in frames.iter().enumerate() {
            let image = match image::open(path) {
                Ok(image) => image,
                Err(_) => continue,
            };
            let time = ((index as f64 + 0.5) / fps).clamp(0.0, duration);
            if let Some(sample) = face::detect_in_image(detector.as_mut(), &image, time) {
                samples.push(sample);
            }
            if let Some(app) = app {
                let percent = 5.0 + (index as f64 + 1.0) / frames.len() as f64 * 25.0;
                let _ = app.emit("short-progress", serde_json::json!({ "percent": percent }));
            }
        }
        Ok(samples)
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

fn probe_result(ffprobe: Option<&Path>, path: &Path, fallback_duration: f64) -> (u32, u32, f64) {
    let Some(ffprobe) = ffprobe else {
        return (SHORT_WIDTH, SHORT_HEIGHT, fallback_duration);
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return (SHORT_WIDTH, SHORT_HEIGHT, fallback_duration);
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return (SHORT_WIDTH, SHORT_HEIGHT, fallback_duration);
    };
    let stream = value["streams"].as_array().and_then(|items| items.first());
    let width = stream
        .and_then(|item| item["width"].as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(SHORT_WIDTH);
    let height = stream
        .and_then(|item| item["height"].as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(SHORT_HEIGHT);
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(fallback_duration);
    (width, height, duration)
}

/// Exporta el rango como MP4 vertical. La ruta de entrada se resuelve dentro del
/// proyecto para que el frontend no pueda leer archivos arbitrarios.
#[tauri::command]
pub async fn export_short(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ExportShortRequest,
) -> Result<ExportShortResult, ProjectError> {
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del short ya no está en el proyecto",
        ));
    }
    let duration = validate_short_range(request.start_seconds, request.end_seconds)?;
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del short no existe",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para exportar el short",
        ));
    };
    let source_stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let stem = request
        .label
        .as_deref()
        .map(|label| safe_stem(label, &safe_stem(&source_stem, "video")))
        .unwrap_or_else(|| format!("{}-short", safe_stem(&source_stem, "video")));
    let final_path = unique_path(&output_dir, &stem);
    let temp_path = output_dir.join(format!(".short-{}.mp4", Uuid::new_v4()));
    let (source_width, source_height, _) = probe_result(ffprobe.as_deref(), &input, duration);
    let mut faces_detected = 0u32;
    let mut reframe = "center";
    let filter = if request.smart_reframe {
        let spec = model_by_id("seeta-face").ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el catálogo no tiene el modelo de rostros",
            )
        })?;
        if !is_model_downloaded(&state, spec) {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "descargá el modelo de rostros (1,2 MB) en Ajustes → Capacidades para usar smart reframe",
            ));
        }
        if !verify_model_hash(&state, spec) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el modelo de rostros no coincide con su checksum; volvé a descargarlo en Ajustes → Capacidades",
            ));
        }
        let model_path = spec
            .files
            .first()
            .map(|file| model_file(&state, spec, file))
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::NotFound,
                    "el modelo de rostros no declara archivos",
                )
            })?;
        let samples = extract_face_samples(
            Some(&app),
            &ffmpeg,
            &model_path,
            &input,
            request.start_seconds,
            duration,
        )?;
        faces_detected = samples.len() as u32;
        let track = face::smooth_track(&samples);
        if track.is_empty() {
            vertical_short_filter()
        } else {
            reframe = "smart";
            let (scaled_width, scaled_height) = face::scaled_cover(source_width, source_height);
            let x = face::crop_expression(
                &track,
                f64::from(scaled_width),
                f64::from(scaled_height),
                f64::from(SHORT_WIDTH),
                f64::from(SHORT_HEIGHT),
                'x',
            );
            let y = face::crop_expression(
                &track,
                f64::from(scaled_width),
                f64::from(scaled_height),
                f64::from(SHORT_WIDTH),
                f64::from(SHORT_HEIGHT),
                'y',
            );
            format!(
                "setpts=PTS-STARTPTS,scale={scaled_width}:{scaled_height},crop={SHORT_WIDTH}:{SHORT_HEIGHT}:x='{x}':y='{y}',setsar=1"
            )
        }
    } else {
        vertical_short_filter()
    };
    let progress_base = if request.smart_reframe { 30.0 } else { 0.0 };
    let progress_scale = 100.0 - progress_base;
    let start = format!("{:.3}", request.start_seconds);
    let length = format!("{duration:.3}");

    let mut command = Command::new(ffmpeg);
    command
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &start,
            "-i",
        ])
        .arg(&input)
        .args([
            "-t",
            &length,
            "-vf",
            &filter,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(&temp_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para el short: {error}").as_str(),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso su progreso")
    })?;
    let progress_app = app.clone();
    let progress_thread = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let raw = line
                .strip_prefix("out_time_us=")
                .or_else(|| line.strip_prefix("out_time_ms="));
            let Some(raw) = raw else { continue };
            let Ok(micros) = raw.trim().parse::<f64>() else {
                continue;
            };
            if micros < 0.0 {
                continue;
            }
            let percent =
                (progress_base + micros / 1_000_000.0 / duration * progress_scale).clamp(0.0, 99.0);
            let _ = progress_app.emit("short-progress", serde_json::json!({ "percent": percent }));
        }
    });
    let status = child.wait();
    let mut stderr = String::new();
    if let Some(mut handle) = child.stderr.take() {
        let _ = handle.read_to_string(&mut stderr);
    }
    let _ = progress_thread.join();

    if !matches!(status, Ok(status) if status.success()) {
        let safe = stderr
            .lines()
            .last()
            .unwrap_or("FFmpeg no pudo exportar el short")
            .chars()
            .take(240)
            .collect::<String>();
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(ProjectErrorCode::Io, &safe));
    }
    let bytes = std::fs::metadata(&temp_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if bytes == 0 {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el short quedó vacío; no se publicó",
        ));
    }
    let (width, height, measured) = probe_result(ffprobe.as_deref(), &temp_path, duration);
    if width != SHORT_WIDTH || height != SHORT_HEIGHT {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            &format!(
                "el short salió en {width}×{height} y se esperaba {SHORT_WIDTH}×{SHORT_HEIGHT}"
            ),
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el short: {error}").as_str(),
        )
    })?;
    let published = std::fs::metadata(&final_path)
        .map(|metadata| metadata.len())
        .unwrap_or(bytes);
    let _ = app.emit("short-progress", serde_json::json!({ "percent": 100.0 }));
    Ok(ExportShortResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes: published,
        width,
        height,
        duration_seconds: measured,
        reframe: reframe.to_owned(),
        faces_detected,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceTrackRequest {
    pub path: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceTrackResult {
    pub model: String,
    pub duration_seconds: f64,
    pub detections: u32,
    pub samples: Vec<FaceSample>,
    pub track: Vec<face::FaceTrackPoint>,
    pub scaled_width: u32,
    pub scaled_height: u32,
    /// Expresiones listas para `crop` en FFmpeg; si no hay rostros, centran.
    pub x_expression: String,
    pub y_expression: String,
}

/// Analiza rostros de un rango sin exportar video. Es la API que usa el
/// smart reframe y la que puede consumir una preview futura.
#[tauri::command]
pub async fn analyze_face_track(
    app: AppHandle,
    state: State<'_, AppState>,
    request: FaceTrackRequest,
) -> Result<FaceTrackResult, ProjectError> {
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para analizar rostros ya no está en el proyecto",
        ));
    }
    let duration = validate_face_range(request.start_seconds, request.end_seconds)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para analizar rostros",
        ));
    };
    let spec = model_by_id("seeta-face").ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el catálogo no tiene el modelo de rostros",
        )
    })?;
    if !is_model_downloaded(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "descargá el modelo de rostros (1,2 MB) en Ajustes → Capacidades",
        ));
    }
    if !verify_model_hash(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el modelo de rostros no coincide con su checksum; volvé a descargarlo",
        ));
    }
    let model_path = spec
        .files
        .first()
        .map(|file| model_file(&state, spec, file))
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el modelo de rostros no declara archivos",
            )
        })?;
    let samples = extract_face_samples(
        Some(&app),
        &ffmpeg,
        &model_path,
        &input,
        request.start_seconds,
        duration,
    )?;
    let track = face::smooth_track(&samples);
    let (source_width, source_height, _) = probe_result(ffprobe.as_deref(), &input, duration);
    let (scaled_width, scaled_height) = face::scaled_cover(source_width, source_height);
    let x_expression = face::crop_expression(
        &track,
        f64::from(scaled_width),
        f64::from(scaled_height),
        f64::from(SHORT_WIDTH),
        f64::from(SHORT_HEIGHT),
        'x',
    );
    let y_expression = face::crop_expression(
        &track,
        f64::from(scaled_width),
        f64::from(scaled_height),
        f64::from(SHORT_WIDTH),
        f64::from(SHORT_HEIGHT),
        'y',
    );
    Ok(FaceTrackResult {
        model: "seeta-face".to_owned(),
        duration_seconds: duration,
        detections: samples.len() as u32,
        samples,
        track,
        scaled_width,
        scaled_height,
        x_expression,
        y_expression,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_fills_and_center_crops_the_vertical_canvas() {
        let filter = vertical_short_filter();
        assert!(filter.contains("scale=1080:1920"));
        assert!(filter.contains("force_original_aspect_ratio=increase"));
        assert!(filter.contains("crop=1080:1920"));
        assert!(filter.contains("setsar=1"));
    }

    #[test]
    fn range_is_bounded_between_three_and_ninety_seconds() {
        assert!(validate_short_range(0.0, 30.0).is_ok());
        assert!(validate_short_range(10.0, 13.0).is_ok());
        assert!(validate_short_range(-1.0, 30.0).is_err());
        assert!(validate_short_range(10.0, 5.0).is_err());
        assert!(validate_short_range(0.0, 120.0).is_err());
        assert!(validate_short_range(f64::NAN, 30.0).is_err());
    }

    #[test]
    fn face_range_accepts_short_and_long_clips() {
        assert!(validate_face_range(0.0, 1.0).is_ok());
        assert!(validate_face_range(10.0, 250.0).is_ok());
        assert!(validate_face_range(0.0, 0.05).is_err());
        assert!(validate_face_range(0.0, 601.0).is_err());
        assert!(validate_face_range(-1.0, 10.0).is_err());
    }

    #[test]
    #[ignore = "requiere SEETA_MODEL y FACE_VIDEO para verificar con un video real"]
    fn detects_faces_in_a_moving_video() {
        let model = std::env::var("SEETA_MODEL").expect("SEETA_MODEL");
        let video = std::env::var("FACE_VIDEO").expect("FACE_VIDEO");
        let samples = extract_face_samples(
            None,
            Path::new("ffmpeg"),
            Path::new(&model),
            Path::new(&video),
            0.0,
            4.0,
        )
        .expect("muestras");
        assert!(samples.len() >= 3, "muestras: {}", samples.len());
        assert!(samples.iter().any(|sample| sample.center_x < 0.4));
        assert!(samples.iter().any(|sample| sample.center_x > 0.6));
        let track = face::smooth_track(&samples);
        let (width, height) = face::scaled_cover(1280, 720);
        let expression = face::crop_expression(
            &track,
            f64::from(width),
            f64::from(height),
            1080.0,
            1920.0,
            'x',
        );
        println!(
            "rostros: {}, track: {}, x: {}",
            samples.len(),
            track.len(),
            expression
        );
        assert!(expression.contains("if(lt(t,"));
    }

    #[test]
    fn names_are_safe_and_never_overwrite() {
        assert_eq!(
            safe_stem("Mi Short: ñandú / 2026", "x"),
            "mi-short-nandu-2026"
        );
        assert_eq!(safe_stem("...", "video"), "video");
        let dir = std::env::temp_dir().join(format!("editoria-short-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta");
        let first = unique_path(&dir, "demo");
        std::fs::write(&first, b"x").expect("archivo");
        let second = unique_path(&dir, "demo");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().contains("demo-vertical-2.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
