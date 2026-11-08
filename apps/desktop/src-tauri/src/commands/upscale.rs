//! Upscale ×4 con Real-ESRGAN corriendo localmente vía ONNX Runtime.
//!
//! El modelo exportado por Qualcomm tiene entrada fija de 128×128: cualquier
//! imagen se procesa por teselas con un borde de solape (10 px, igual que el
//! CLI de referencia de Real-ESRGAN) para que las costuras sean mínimas. Cada
//! tesela entra como [1, 3, 128, 128] float 0–1 RGB y sale [1, 3, 512, 512].

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use image::{imageops::FilterType, DynamicImage, GenericImage, GenericImageView, RgbaImage};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::commands::background::{drain_stderr, log_tail, read_full_frame};
use crate::commands::hide_console;
use crate::commands::models::{is_model_downloaded, model_by_id, model_dir};
use crate::commands::system::resolve_tools;
use crate::media::{probe_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const TILE: usize = 128;
/// Solape entre teselas: el CLI de referencia usa `tile_pad = 10`.
const TILE_PAD: usize = 10;
const SCALE: u32 = 4;
/// Tope de memoria: una imagen más grande se rechaza con el motivo claro.
const MAX_INPUT_SIDE: u32 = 2048;

static ENVIRONMENT: OnceLock<ort::environment::Environment> = OnceLock::new();

fn runtime_dll() -> Result<PathBuf, ProjectError> {
    if let Ok(value) = std::env::var("ORT_DYLIB_PATH") {
        if Path::new(&value).is_file() {
            return Ok(PathBuf::from(value));
        }
    }
    let mut candidates: Vec<PathBuf> = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            let dir = exe.parent()?.to_path_buf();
            let mut candidates = vec![dir.join("onnxruntime.dll")];
            if let Some(parent) = dir.parent() {
                candidates.push(parent.join("onnxruntime.dll"));
            }
            Some(candidates)
        })
        .unwrap_or_default();
    candidates.retain(|path| path.is_file());
    candidates.into_iter().next().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "falta onnxruntime.dll junto a la aplicación",
        )
    })
}

fn ensure_environment() -> Result<&'static ort::environment::Environment, ProjectError> {
    if let Some(environment) = ENVIRONMENT.get() {
        return Ok(environment);
    }
    let dll = runtime_dll()?;
    let environment = ort::init_from(&dll)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo cargar onnxruntime.dll: {error}").as_str(),
            )
        })?
        .with_name("editoria-ort-upscale")
        .build()
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo iniciar ONNX Runtime: {error}").as_str(),
            )
        })?;
    Ok(ENVIRONMENT.get_or_init(|| environment))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleResult {
    pub path: String,
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub tiles: u64,
}

/// Agranda una imagen ×4 con Real-ESRGAN local.
#[tauri::command]
pub fn upscale_image(
    state: State<'_, AppState>,
    input_path: String,
    output_path: Option<String>,
) -> Result<UpscaleResult, ProjectError> {
    let spec = model_by_id("real-esrgan-x4plus").ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "el modelo de upscale no existe")
    })?;
    if !is_model_downloaded(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta descargar el modelo de upscale (Ajustes → Capacidades)",
        ));
    }
    let model_path = model_dir(&state, spec).join(spec.files[0].file_name);
    let input = PathBuf::from(input_path.trim());
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la imagen a agrandar no está en disco",
        ));
    }

    let image = image::open(&input).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no se pudo leer la imagen: ¿es un formato soportado?",
        )
    })?;
    let (width, height) = image.dimensions();
    if width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!(
                "por memoria, el upscale local acepta hasta {MAX_INPUT_SIDE}×{MAX_INPUT_SIDE}; esta imagen mide {width}×{height}"
            )
            .as_str(),
        ));
    }

    let output = run_realesrgan(&model_path, &image)?;

    let destination = match output_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => {
            let stem = input
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "imagen".to_owned());
            input
                .with_file_name(format!("{stem}-x4.png"))
                .with_extension("png")
        }
    };
    image::save_buffer_with_format(
        &destination,
        output.as_raw(),
        output.width(),
        output.height(),
        image::ExtendedColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el upscale"))?;

    let tiles = ((width as u64 + TILE as u64 - 1) / TILE as u64)
        * ((height as u64 + TILE as u64 - 1) / TILE as u64);
    Ok(UpscaleResult {
        path: destination.to_string_lossy().into_owned(),
        input_width: width,
        input_height: height,
        output_width: output.width(),
        output_height: output.height(),
        tiles,
    })
}

/// Sesión ONNX del modelo Real-ESRGAN, abierta una vez por proceso de
/// upscale (imagen o video) en vez de una vez por llamada.
fn open_esrgan_session(model_path: &Path) -> Result<ort::session::Session, ProjectError> {
    let environment = ensure_environment()?;
    ort::session::Session::builder(environment)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo crear la sesión de ONNX Runtime: {error}").as_str(),
            )
        })?
        .with_intra_threads(4)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo configurar ONNX Runtime: {error}").as_str(),
            )
        })?
        .commit_from_file(model_path)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo cargar el modelo: {error}").as_str(),
            )
        })
}

/// La inferencia por teselas sobre una imagen completa.
fn run_realesrgan(model_path: &Path, image: &DynamicImage) -> Result<RgbaImage, ProjectError> {
    let mut session = open_esrgan_session(model_path)?;
    let rgb = image.to_rgb8();
    upscale_frame_tiled(&mut session, &rgb)
}

/// Agranda un frame RGB ×4 por teselas con solape (compartido por imagen y
/// video: cada frame del video pasa por acá).
fn upscale_frame_tiled(
    session: &mut ort::session::Session,
    rgb: &image::RgbImage,
) -> Result<RgbaImage, ProjectError> {
    let (width, height) = rgb.dimensions();
    let mut output = RgbaImage::new(width * SCALE, height * SCALE);
    let tiles_x = width.div_ceil(TILE as u32);
    let tiles_y = height.div_ceil(TILE as u32);
    let mut done_tiles: u64 = 0;

    for tile_y in 0..tiles_y {
        for tile_x in 0..tiles_x {
            let base_x = (tile_x * TILE as u32) as i64;
            let base_y = (tile_y * TILE as u32) as i64;
            // Ventana con solape: el contexto de los bordes evita costuras.
            let window_x = (base_x - TILE_PAD as i64).max(0);
            let window_y = (base_y - TILE_PAD as i64).max(0);
            let window_w = ((window_x + (TILE + TILE_PAD * 2) as i64) as u32)
                .min(width)
                .saturating_sub(window_x as u32);
            let window_h = ((window_y + (TILE + TILE_PAD * 2) as i64) as u32)
                .min(height)
                .saturating_sub(window_y as u32);

            let window = image::imageops::crop_imm(
                rgb,
                window_x as u32,
                window_y as u32,
                window_w.max(1),
                window_h.max(1),
            )
            .to_image();

            let upscaled = run_tile(session, &window)?;
            // La tesela ampliada es window×4; se recorta el corazón que le
            // corresponde a esta tesela (sin el solape) y se pega.
            let core_x = ((base_x - window_x).max(0) as u32) * SCALE;
            let core_y = ((base_y - window_y).max(0) as u32) * SCALE;
            let core_w = ((base_x as u32 + TILE as u32).min(width) - base_x as u32) * SCALE;
            let core_h = ((base_y as u32 + TILE as u32).min(height) - base_y as u32) * SCALE;
            let piece = image::imageops::crop_imm(
                &upscaled,
                core_x,
                core_y,
                core_w.min(upscaled.width().saturating_sub(core_x)),
                core_h.min(upscaled.height().saturating_sub(core_y)),
            )
            .to_image();
            image::imageops::overlay(
                &mut output,
                &piece,
                base_x * SCALE as i64,
                base_y * SCALE as i64,
            );
            done_tiles += 1;
            let _ = done_tiles;
        }
    }
    Ok(output)
}

/// Una tesela: RGB 0–1 → modelo → RGBA 0–255 a escala ×4.
fn run_tile(
    session: &mut ort::session::Session,
    window: &image::RgbImage,
) -> Result<RgbaImage, ProjectError> {
    let (win_w, win_h) = window.dimensions();
    let tile_w = win_w.next_power_of_two().min(TILE as u32 * 4) as usize;
    let tile_h = win_h.next_power_of_two().min(TILE as u32 * 4) as usize;
    // El modelo exige exactamente 128×128: la ventana se re-escala a ese tamaño
    // (el solape da el contexto) y la salida vuelve a win×4 con un re-escale.
    let resized = image::DynamicImage::ImageRgb8(window.clone())
        .resize_exact(TILE as u32, TILE as u32, FilterType::Triangle)
        .to_rgb8();

    let mut input = vec![0f32; 3 * TILE * TILE];
    for (index, pixel) in resized.pixels().enumerate() {
        input[index] = pixel[0] as f32 / 255.0;
        input[index + TILE * TILE] = pixel[1] as f32 / 255.0;
        input[index + TILE * TILE * 2] = pixel[2] as f32 / 255.0;
    }
    let tensor =
        ort::value::Tensor::from_array(([1usize, 3, TILE, TILE], input)).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo preparar la tesela para el modelo: {error}").as_str(),
            )
        })?;
    let outputs = session.run(ort::inputs![tensor]).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el modelo falló al procesar la tesela: {error}").as_str(),
        )
    })?;

    let mut result = RgbaImage::new(win_w * SCALE, win_h * SCALE);
    for (_name, output) in &outputs {
        let (shape, data) = output.try_extract_tensor::<f32>().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                format!("el modelo devolvió algo inesperado: {error}").as_str(),
            )
        })?;
        if shape.len() == 4 && shape[1] == 3 {
            let out_w = *shape.last().unwrap_or(&0) as u32;
            let out_h = shape.get(2).copied().unwrap_or(0) as u32;
            let scaled = DynamicImage::ImageRgb8({
                let mut rgb = image::RgbImage::new(out_w, out_h);
                let plane = TILE as u32 * SCALE;
                for y in 0..out_h {
                    for x in 0..out_w {
                        let source_x = (x as f32 / out_w as f32 * plane as f32) as usize;
                        let source_y = (y as f32 / out_h as f32 * plane as f32) as usize;
                        let index = source_y * plane as usize * 3 + source_x * 3;
                        let r = (data[index].clamp(0.0, 1.0) * 255.0).round() as u8;
                        let g = (data[index + 1].clamp(0.0, 1.0) * 255.0).round() as u8;
                        let b = (data[index + 2].clamp(0.0, 1.0) * 255.0).round() as u8;
                        rgb.put_pixel(x, y, image::Rgb([r, g, b]));
                    }
                }
                rgb
            })
            .resize_exact(win_w * SCALE, win_h * SCALE, FilterType::Triangle)
            .to_rgba8();
            result.copy_from(&scaled, 0, 0).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo armar el upscale")
            })?;
            break;
        }
    }
    let _ = (tile_w, tile_h);
    Ok(result)
}

// ---------------------------------------------------------------------------
// Upscale de video ×4 (Real-ESRGAN frame a frame)
// ---------------------------------------------------------------------------

/// Tope de entrada por memoria y tiempo: cada frame se procesa por teselas
/// 128×128 en CPU, así que un clip 720p de ~50 s ya son ~40-90 minutos.
const MAX_VIDEO_PIXELS: u64 = 1280 * 720;
const MAX_VIDEO_FRAMES: u64 = 1_800;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleVideoResult {
    pub path: String,
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub frames: u64,
    pub fps_num: u32,
    pub fps_den: u32,
}

/// Agranda un video ×4 con Real-ESRGAN local, frame por frame.
///
/// Decodifica con FFmpeg a RGB crudo, pasa cada frame por el mismo motor
/// por teselas del upscale de imagen y codifica a H.264 con el audio
/// original. Es un proceso pesado (minutos por segundo de video): la UI lo
/// corre con progreso y la función emite `upscale-progress` con `percent`.
#[tauri::command]
pub async fn upscale_video(
    app: AppHandle,
    state: State<'_, AppState>,
    input_path: String,
    output_path: Option<String>,
    max_seconds: Option<f64>,
) -> Result<UpscaleVideoResult, ProjectError> {
    let spec = model_by_id("real-esrgan-x4plus").ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "el modelo de upscale no existe")
    })?;
    if !is_model_downloaded(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta descargar el modelo de upscale (Ajustes → Capacidades)",
        ));
    }
    let model_path = model_dir(&state, spec).join(spec.files[0].file_name);
    let input = PathBuf::from(input_path.trim());
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video a agrandar no está en disco",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para leer y escribir el video",
        )
    })?;
    let ffprobe = ffprobe.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe es necesario para medir el video",
        )
    })?;
    let max_seconds = max_seconds
        .map(|value| value.clamp(0.5, 3600.0))
        .filter(|value| value.is_finite());

    let measure = probe_file(&ffprobe, &input, MediaKind::Video)?;
    let (width, height) = (measure.width.unwrap_or(0), measure.height.unwrap_or(0));
    if width == 0 || height == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "ffprobe no pudo medir la resolución del video",
        ));
    }
    if width as u64 * height as u64 > MAX_VIDEO_PIXELS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!(
                "por memoria y tiempo, el upscale local de video acepta hasta {}×{} ({:.1} MP); este video mide {}×{}",
                1280,
                720,
                MAX_VIDEO_PIXELS as f64 / 1_000_000.0,
                width,
                height
            )
            .as_str(),
        ));
    }
    let fps_num = measure.frame_rate_num.unwrap_or(30).max(1);
    let fps_den = measure.frame_rate_den.unwrap_or(1).max(1);
    let duration = measure.duration_seconds.unwrap_or(0.0);
    let estimated_frames = if duration > 0.0 {
        let capped = max_seconds.map_or(duration, |cap| duration.min(cap));
        (capped * fps_num as f64 / fps_den as f64).ceil() as u64
    } else {
        MAX_VIDEO_FRAMES
    };
    if estimated_frames > MAX_VIDEO_FRAMES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!(
                "el video estima ~{estimated_frames} frames (tope {MAX_VIDEO_FRAMES}); recortalo o usá «máx. segundos»"
            )
            .as_str(),
        ));
    }

    let output = match output_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => {
            let stem = input
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "video".to_owned());
            let mut candidate = input.with_file_name(format!("{stem}-x4.mp4"));
            let mut counter = 2u32;
            while candidate.exists() {
                candidate = input.with_file_name(format!("{stem}-x4-{counter}.mp4"));
                counter += 1;
            }
            candidate
        }
    };

    let result = tauri::async_runtime::spawn_blocking(move || {
        upscale_video_blocking(
            &app,
            &input,
            &output,
            &model_path,
            &ffmpeg,
            width,
            height,
            fps_num,
            fps_den,
            max_seconds,
            estimated_frames,
        )
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el upscale de video se cortó: {error}").as_str(),
        )
    })??;
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn upscale_video_blocking(
    app: &AppHandle,
    input: &Path,
    output: &Path,
    model_path: &Path,
    ffmpeg: &Path,
    width: u32,
    height: u32,
    fps_num: u32,
    fps_den: u32,
    max_seconds: Option<f64>,
    estimated_frames: u64,
) -> Result<UpscaleVideoResult, ProjectError> {
    let mut session = open_esrgan_session(model_path)?;

    // Decoder: la fuente entera (o el tope de segundos) a RGB crudo.
    let mut decoder = Command::new(ffmpeg);
    decoder
        .args(["-hide_banner", "-v", "error"]);
    if let Some(cap) = max_seconds {
        decoder.args(["-t", &format!("{cap:.3}")]);
    }
    decoder
        .args(["-i"])
        .arg(input)
        .args([
            "-vf",
            &format!("fps={fps_num}/{fps_den}"),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut decoder);
    let mut decoder_child = decoder.spawn().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para leer el video: {error}").as_str(),
        )
    })?;
    let mut stdout = decoder_child.stdout.take().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no expuso los frames del video",
        )
    })?;
    let decoder_log = decoder_child.stderr.take().map(drain_stderr);

    // Encoder: frames RGBA ya ampliados → H.264 + audio original.
    let out_width = width * SCALE;
    let out_height = height * SCALE;
    let mut encoder = Command::new(ffmpeg);
    encoder
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{out_width}x{out_height}"),
            "-r",
            &format!("{fps_num}/{fps_den}"),
            "-i",
            "pipe:0",
            "-i",
        ])
        .arg(input)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "16",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
        ]);
    if let Some(cap) = max_seconds {
        encoder.arg("-t").arg(format!("{cap:.3}"));
    }
    encoder
        .args([
            "-shortest",
            "-movflags",
            "+faststart",
            "-y",
        ])
        .arg(output);
    hide_console(&mut encoder);
    let mut encoder_child = encoder.spawn().map_err(|error| {
        let _ = decoder_child.kill();
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar el codificador del upscale: {error}").as_str(),
        )
    })?;
    let mut stdin = encoder_child.stdin.take().ok_or_else(|| {
        let _ = decoder_child.kill();
        ProjectError::message(
            ProjectErrorCode::Io,
            "el codificador no aceptó el flujo de frames",
        )
    })?;
    let encoder_log = encoder_child.stderr.take().map(drain_stderr);

    let frame_bytes = width as usize * height as usize * 3;
    let mut rgb = vec![0u8; frame_bytes];
    let mut written = 0u64;
    let progress_every = (estimated_frames / 100).max(1);
    let mut failure: Option<ProjectError> = None;

    loop {
        match read_full_frame(&mut stdout, &mut rgb) {
            Ok(true) => {}
            Ok(false) => break,
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
        let Some(frame) = image::RgbImage::from_raw(width, height, rgb.clone()) else {
            failure = Some(ProjectError::message(
                ProjectErrorCode::Io,
                "el frame decodificado no coincide con el tamaño esperado",
            ));
            break;
        };
        match upscale_frame_tiled(&mut session, &frame) {
            Ok(upscaled) => {
                if stdin.write_all(upscaled.as_raw()).is_err() {
                    failure = Some(ProjectError::message(
                        ProjectErrorCode::Io,
                        "el codificador cerró el flujo antes de terminar el upscale",
                    ));
                    break;
                }
            }
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
        written += 1;
        if written == 1 || written % progress_every == 0 || written == estimated_frames {
            let _ = app.emit(
                "upscale-progress",
                json!({
                    "percent": (written as f64 / estimated_frames.max(1) as f64 * 100.0).min(100.0),
                    "frame": written,
                    "total": estimated_frames,
                }),
            );
        }
    }
    drop(stdin);
    if failure.is_none() {
        // Vaciar el pipe para que el decoder no termine con escritura rota.
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
    }
    drop(stdout);

    let encoder_status = encoder_child.wait();
    let decoder_status = decoder_child.wait();
    let encoder_text = encoder_log.map(|handle| handle.join().unwrap_or_default());
    let decoder_text = decoder_log.map(|handle| handle.join().unwrap_or_default());

    if let Some(error) = failure {
        let _ = std::fs::remove_file(output);
        let _ = encoder_child.kill();
        return Err(error);
    }
    if written == 0 {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el video no entregó ningún frame para procesar",
        ));
    }
    if !matches!(encoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "el codificador del upscale falló: {}",
                log_tail(encoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if !matches!(decoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "FFmpeg no pudo leer el video completo: {}",
                log_tail(decoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if std::fs::metadata(output).map(|meta| meta.len()).unwrap_or(0) == 0 {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el upscale se generó vacío",
        ));
    }
    Ok(UpscaleVideoResult {
        path: output.to_string_lossy().into_owned(),
        input_width: width,
        input_height: height,
        output_width: out_width,
        output_height: out_height,
        frames: written,
        fps_num,
        fps_den,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn fixture_model() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/realesrgan/real_esrgan_x4plus.onnx")
    }

    /// Prueba real: el modelo del fixture agranda una tesela 128×128 a
    /// 512×512 con variación de contenido. Detrás de
    /// `EDITOR_IA_RUN_RENDER_TESTS` como las pruebas que necesitan binarios.
    #[test]
    fn live_realesrgan_upscales_a_tile() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el upscale real");
            return;
        }
        let model = fixture_model();
        assert!(model.is_file(), "falta el fixture del modelo Real-ESRGAN");
        std::env::set_var(
            "ORT_DYLIB_PATH",
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/onnxruntime/onnxruntime.dll"),
        );

        // Una imagen con un cuadrado claro: el upscale debe preservar la
        // estructura (variación de brillo en la salida).
        let mut image = RgbaImage::from_pixel(128, 128, Rgba([30, 30, 40, 255]));
        for y in 32..96 {
            for x in 32..96 {
                image.put_pixel(x, y, Rgba([220, 224, 235, 255]));
            }
        }
        let dynamic = DynamicImage::ImageRgba8(image);

        let output = run_realesrgan(&model, &dynamic).expect("upscale");
        assert_eq!(output.width(), 512);
        assert_eq!(output.height(), 512);

        let min = output.pixels().map(|p| p.0[0]).min().expect("salida vacía");
        let max = output.pixels().map(|p| p.0[0]).max().expect("salida vacía");
        assert!(
            max.saturating_sub(min) > 32,
            "el upscale aplastó el contenido: min={min} max={max}"
        );
    }
}
