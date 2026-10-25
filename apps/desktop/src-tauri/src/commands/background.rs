//! Quitar fondo con U²-Net corriendo localmente vía ONNX Runtime.
//!
//! El flujo: se carga el modelo descargado (u2netp, 4,4 MB), la imagen se
//! re-escala a 320×320 y se normaliza igual que rembg, el modelo devuelve una
//! máscara de saliencia que se re-escala al tamaño original y se aplica como
//! canal alfa. El resultado es un PNG con transparencia, sin subir nada a
//! ningún lado.

use std::io::{BufReader, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;

use image::{imageops::FilterType, DynamicImage, GenericImageView, RgbImage, RgbaImage};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::commands::hide_console;
use crate::commands::models::{is_model_downloaded, model_by_id, model_dir};
use crate::commands::system::resolve_tools;
use crate::media::{import_file, probe_file, resolve_inside_root, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const U2NET_INPUT: usize = 320;
const U2NET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const U2NET_STD: [f32; 3] = [0.229, 0.224, 0.225];
/// Forma de la salida principal de u2netp (las otras salidas son mapas de
/// características intermedios con más canales).
const OUTPUT_SHAPE: [i64; 4] = [1, 1, 320, 320];

/// El entorno de ONNX Runtime se crea una sola vez y vive para siempre.
static ENVIRONMENT: OnceLock<ort::environment::Environment> = OnceLock::new();

/// ¿Se puede correr la inferencia en esta máquina? Medido: el DLL tiene que
/// estar junto al ejecutable (o en `ORT_DYLIB_PATH`).
pub fn onnx_runtime_available(model_path: Option<&Path>) -> bool {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("onnxruntime.dll").is_file() {
                return true;
            }
        }
    }
    if let Ok(value) = std::env::var("ORT_DYLIB_PATH") {
        if Path::new(&value).is_file() {
            return true;
        }
    }
    false
}

/// ¿Hay Python con faster-whisper disponible? Misma resolución que la
/// transcripción: una sola fuente de verdad.
pub fn whisper_cli_available() -> bool {
    crate::commands::transcribe::resolve_python().is_some()
}

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
            // Los binarios de prueba viven en target/debug/deps: el DLL queda
            // un nivel arriba (target/debug), lo copia build.rs.
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
        .with_name("editoria-ort")
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
pub struct BackgroundRemoval {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// Quita el fondo de una imagen y guarda un PNG con canal alfa.
#[tauri::command]
pub fn remove_background(
    state: State<'_, AppState>,
    input_path: String,
    output_path: Option<String>,
) -> Result<BackgroundRemoval, ProjectError> {
    let model_path = require_recorte_model(&state)?;
    let input = PathBuf::from(input_path.trim());
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la imagen a procesar no está en disco",
        ));
    }

    let image = image::open(&input).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no se pudo leer la imagen: ¿es un formato soportado?",
        )
    })?;

    let mask = run_u2netp(&model_path, &image)?;
    let output = composite_with_alpha(&image, &mask);

    let destination = match output_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => {
            let stem = input
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "imagen".to_owned());
            input
                .with_file_name(format!("{stem}-sin-fondo.png"))
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
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el recorte"))?;

    Ok(BackgroundRemoval {
        path: destination.to_string_lossy().into_owned(),
        width: output.width(),
        height: output.height(),
    })
}

/// Abre una sesión de u2netp reutilizable. El video la conserva durante todos
/// los frames: cargar el modelo por frame costaría más que la inferencia.
fn open_session(model_path: &Path) -> Result<ort::session::Session, ProjectError> {
    let environment = ensure_environment()?;
    ort::session::Session::builder(environment)
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo crear la sesión de ONNX Runtime: {error}").as_str(),
            )
        })?
        // Sin `with_optimization_level`: el nivel por defecto de ONNX Runtime
        // ya es el máximo, y esta llamada fue rechazada por el DLL cargado.
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

/// Ejecuta u2netp y devuelve la máscara al tamaño de la imagen.
fn run_u2netp(model_path: &Path, image: &DynamicImage) -> Result<image::GrayImage, ProjectError> {
    let mut session = open_session(model_path)?;
    run_u2netp_session(&mut session, image)
}

fn run_u2netp_session(
    session: &mut ort::session::Session,
    image: &DynamicImage,
) -> Result<image::GrayImage, ProjectError> {
    // Preprocesado: RGB → 320×320 → normalización por canal (igual que rembg).
    let resized = image
        .resize_exact(U2NET_INPUT as u32, U2NET_INPUT as u32, FilterType::Triangle)
        .to_rgb8();
    let mut input = vec![0f32; U2NET_INPUT * U2NET_INPUT * 3];
    for (index, pixel) in resized.pixels().enumerate() {
        let r = pixel[0] as f32 / 255.0;
        let g = pixel[1] as f32 / 255.0;
        let b = pixel[2] as f32 / 255.0;
        input[index] = (r - U2NET_MEAN[0]) / U2NET_STD[0];
        input[index + U2NET_INPUT * U2NET_INPUT] = (g - U2NET_MEAN[1]) / U2NET_STD[1];
        input[index + U2NET_INPUT * U2NET_INPUT * 2] = (b - U2NET_MEAN[2]) / U2NET_STD[2];
    }

    let tensor = ort::value::Tensor::from_array(([1usize, 3, U2NET_INPUT, U2NET_INPUT], input))
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo preparar la imagen para el modelo: {error}").as_str(),
            )
        })?;
    let outputs = session.run(ort::inputs![tensor]).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el modelo falló al procesar la imagen: {error}").as_str(),
        )
    })?;

    // u2netp devuelve varias salidas; la principal es la única con forma
    // [1, 1, 320, 320]. Se elige por forma, no por nombre: los nombres internos
    // cambian entre conversiones del modelo.
    let mut values: Option<Vec<f32>> = None;
    for (_name, output) in &outputs {
        let (shape, data) = output.try_extract_tensor::<f32>().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                format!("el modelo devolvió algo inesperado: {error}").as_str(),
            )
        })?;
        if shape.to_vec() == OUTPUT_SHAPE {
            values = Some(data.to_vec());
            break;
        }
    }
    let Some(values) = values else {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el modelo no devolvió la máscara esperada",
        ));
    };

    // La máscara cruda se normaliza a 0–1 y se re-escala al tamaño original.
    let (width, height) = image.dimensions();
    let mask_min = values.iter().cloned().fold(f32::INFINITY, f32::min);
    let mask_max = values.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let span = (mask_max - mask_min).max(f32::EPSILON);

    let mut normalized = image::GrayImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let source_x = (x as f32 / width as f32 * U2NET_INPUT as f32) as usize;
            let source_y = (y as f32 / height as f32 * U2NET_INPUT as f32) as usize;
            let value = values[source_y * U2NET_INPUT + source_x];
            let scaled = ((value - mask_min) / span).clamp(0.0, 1.0);
            normalized.put_pixel(x, y, image::Luma([(scaled * 255.0).round() as u8]));
        }
    }
    Ok(normalized)
}

/// Aplica la máscara como canal alfa sobre la imagen original.
fn composite_with_alpha(image: &DynamicImage, mask: &image::GrayImage) -> RgbaImage {
    let mut output = image.to_rgba8();
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        if let Some(alpha) = mask.get_pixel(x, y).0.first() {
            let alpha = (*alpha as u16 * pixel.0[3] as u16 / 255) as u8;
            pixel.0[3] = alpha;
        }
    }
    output
}

/// Devuelve la ruta del modelo u2netp si está descargado.
fn require_recorte_model(state: &AppState) -> Result<PathBuf, ProjectError> {
    let spec = model_by_id("u2netp").ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "el modelo de recorte no existe")
    })?;
    if !is_model_downloaded(state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta descargar el modelo de recorte (Ajustes → Capacidades)",
        ));
    }
    Ok(model_dir(state, spec).join(spec.files[0].file_name))
}

fn derived_label(stem: &str) -> String {
    format!("{stem} sin fondo").chars().take(200).collect()
}

/// Copia el resultado a `media/` y devuelve el asset completo. Los derechos
/// quedan sin declarar a propósito: la interfaz hereda la licencia del clip
/// original en vez de inventar una.
fn import_derived_asset(
    root: &Path,
    temp: &Path,
    ffprobe: &Path,
    fps_num: u32,
    fps_den: u32,
    stem: &str,
) -> Result<Value, ProjectError> {
    let mut asset = import_file(root, temp, ffprobe, fps_num.max(1), fps_den.max(1))?;
    if let Some(object) = asset.as_object_mut() {
        object.insert("label".into(), json!(derived_label(stem)));
        if let Some(provenance) = object
            .get_mut("rights")
            .and_then(Value::as_object_mut)
            .and_then(|rights| rights.get_mut("provenance"))
            .and_then(Value::as_object_mut)
        {
            provenance.insert("origin".into(), json!("generated-locally"));
        }
        if object["kind"].as_str() == Some("video") {
            if let Some(media) = object.get_mut("media").and_then(Value::as_object_mut) {
                // El renderer lee esta marca para forzar el decoder de libvpx,
                // el único que expone el alfa lateral de VP9.
                media.insert("alpha".into(), json!(true));
            }
        }
    }
    Ok(asset)
}

fn source_stem(input: &Path) -> String {
    input
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "material".to_owned())
}

fn remove_image_background(
    root: &Path,
    input: &Path,
    ffprobe: &Path,
    model_path: &Path,
    fps_num: u32,
    fps_den: u32,
) -> Result<Value, ProjectError> {
    let image = image::open(input).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no se pudo leer la imagen: ¿es un formato soportado?",
        )
    })?;
    let mask = run_u2netp(model_path, &image)?;
    let output = composite_with_alpha(&image, &mask);
    let temp = std::env::temp_dir().join(format!("olyvia-recorte-{}.png", uuid::Uuid::new_v4()));
    image::save_buffer_with_format(
        &temp,
        output.as_raw(),
        output.width(),
        output.height(),
        image::ExtendedColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo guardar el recorte"))?;
    let stem = source_stem(input);
    let result = import_derived_asset(root, &temp, ffprobe, fps_num, fps_den, &stem);
    let _ = std::fs::remove_file(&temp);
    result
}

/// Ajusta el frame de salida a un máximo de 1080p y dimensiones pares.
fn fit_output_frame(width: u32, height: u32) -> Result<(u32, u32), ProjectError> {
    if width < 2 || height < 2 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el video no declara dimensiones legibles",
        ));
    }
    let scale = (1920.0 / width as f64).min(1080.0 / height as f64).min(1.0);
    let fit_width = ((width as f64 * scale).round() as u32).max(2) & !1;
    let fit_height = ((height as f64 * scale).round() as u32).max(2) & !1;
    Ok((fit_width, fit_height))
}

fn drain_stderr<R: Read + Send + 'static>(mut reader: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut collected = Vec::new();
        let mut buffer = [0u8; 8 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if collected.len() < 64 * 1024 {
                        let room = 64 * 1024 - collected.len();
                        collected.extend_from_slice(&buffer[..read.min(room)]);
                    }
                }
            }
        }
        String::from_utf8_lossy(&collected).into_owned()
    })
}

fn read_full_frame(reader: &mut impl Read, buffer: &mut [u8]) -> Result<bool, ProjectError> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => return Ok(false),
            Ok(read) => filled += read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => {
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    "FFmpeg dejó de entregar frames durante el recorte",
                ))
            }
        }
    }
    Ok(true)
}

fn count_video_frames(ffprobe: &Path, path: &Path) -> Result<u64, ProjectError> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no pudo contar los frames del recorte",
        )
    })?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().parse::<u64>().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no informó los frames del recorte",
        )
    })
}

fn log_tail(text: &str) -> String {
    text.chars()
        .rev()
        .take(300)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

/// Quita el fondo de un tramo de video frame por frame y devuelve un WebM VP9
/// con canal alfa y el audio original. El tramo se expresa en frames del
/// proyecto para que la ventana del clip siga siendo exacta.
fn remove_video_background<F>(
    root: &Path,
    input: &Path,
    ffmpeg: &Path,
    ffprobe: &Path,
    model_path: &Path,
    in_frame: u64,
    out_frame: u64,
    fps_num: u32,
    fps_den: u32,
    mut progress: F,
) -> Result<Value, ProjectError>
where
    F: FnMut(f64),
{
    let frames = out_frame.saturating_sub(in_frame);
    if frames == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tramo del clip no tiene frames para procesar",
        ));
    }
    if frames > 3_600 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tramo supera los 3.600 frames (unos 2 minutos a 30 fps); procesalo en partes más cortas",
        ));
    }
    let measure = probe_file(ffprobe, input, MediaKind::Video)?;
    let (width, height) =
        fit_output_frame(measure.width.unwrap_or(0), measure.height.unwrap_or(0))?;
    let fps = fps_num.max(1) as f64 / fps_den.max(1) as f64;
    if !fps.is_finite() || fps <= 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la tasa del proyecto no es válida",
        ));
    }
    let start_seconds = in_frame as f64 / fps;
    let duration_seconds = frames as f64 / fps;
    let temp = std::env::temp_dir().join(format!("olyvia-recorte-{}.webm", uuid::Uuid::new_v4()));
    // La sesión se abre antes de lanzar procesos: si falta el modelo o el DLL,
    // no queda ningún hijo ni temporal que limpiar.
    let mut session = open_session(model_path)?;

    let mut decoder = Command::new(ffmpeg);
    decoder
        .args(["-hide_banner", "-v", "error", "-ss"])
        .arg(format!("{start_seconds:.6}"))
        .arg("-i")
        .arg(input)
        .args([
            "-vf",
            &format!(
                "fps={}/{},scale={}:{}:flags=lanczos",
                fps_num.max(1),
                fps_den.max(1),
                width,
                height
            ),
            "-frames:v",
            &frames.to_string(),
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
            &format!("{width}x{height}"),
            "-r",
            &format!("{}/{}", fps_num.max(1), fps_den.max(1)),
            "-i",
            "pipe:0",
            "-ss",
        ])
        .arg(format!("{start_seconds:.6}"))
        .arg("-i")
        .arg(input)
        .args([
            "-t",
            &format!("{duration_seconds:.6}"),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuva420p",
            "-b:v",
            "0",
            "-crf",
            "30",
            "-cpu-used",
            "2",
            "-row-mt",
            "1",
            "-c:a",
            "libopus",
            "-b:a",
            "160k",
            "-frames:v",
            &frames.to_string(),
            "-y",
        ])
        .arg(&temp)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut encoder);
    let mut encoder_child = encoder.spawn().map_err(|error| {
        let _ = decoder_child.kill();
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar el codificador del recorte: {error}").as_str(),
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
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    let mut last_rgb: Option<Vec<u8>> = None;
    let step = (frames / 100).max(1);
    let mut written = 0u64;
    let mut failure: Option<ProjectError> = None;

    for index in 0..frames {
        let complete = match read_full_frame(&mut stdout, &mut rgb) {
            Ok(value) => value,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };
        if complete {
            last_rgb = Some(rgb.clone());
        } else if let Some(last) = &last_rgb {
            // Si el decoder termina antes, se repite el último frame: el clip
            // conserva su ventana exacta en vez de quedar corto.
            rgb.copy_from_slice(last);
        } else {
            failure = Some(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el video no entregó ningún frame en ese tramo",
            ));
            break;
        }
        let Some(frame) = RgbImage::from_raw(width, height, rgb.clone()) else {
            failure = Some(ProjectError::message(
                ProjectErrorCode::Io,
                "el frame decodificado no coincide con el tamaño esperado",
            ));
            break;
        };
        let dynamic = DynamicImage::ImageRgb8(frame);
        let mask = match run_u2netp_session(&mut session, &dynamic) {
            Ok(mask) => mask,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };
        let cutout = composite_with_alpha(&dynamic, &mask);
        rgba.copy_from_slice(cutout.as_raw());
        if stdin.write_all(&rgba).is_err() {
            failure = Some(ProjectError::message(
                ProjectErrorCode::Io,
                "el codificador cerró el flujo antes de terminar el recorte",
            ));
            break;
        }
        written += 1;
        if index == 0 || index + 1 == frames || (index + 1) % step == 0 {
            progress(written as f64 / frames as f64 * 100.0);
        }
    }
    drop(stdin);
    if failure.is_none() {
        // El decoder puede haber emitido un frame extra por redondeo; vaciar
        // el pipe evita que termine con un error de escritura rota.
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
    }
    drop(stdout);

    let encoder_status = encoder_child.wait();
    let decoder_status = decoder_child.wait();
    let encoder_text = encoder_log.map(|handle| handle.join().unwrap_or_default());
    let decoder_text = decoder_log.map(|handle| handle.join().unwrap_or_default());

    if let Some(error) = failure {
        let _ = std::fs::remove_file(&temp);
        let _ = encoder_child.kill();
        return Err(error);
    }
    if !matches!(encoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "el codificador del recorte falló: {}",
                log_tail(encoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if !matches!(decoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "FFmpeg no pudo leer el tramo del video: {}",
                log_tail(decoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if std::fs::metadata(&temp).map(|meta| meta.len()).unwrap_or(0) == 0 {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el recorte se generó vacío",
        ));
    }
    let encoded_frames = match count_video_frames(ffprobe, &temp) {
        Ok(count) => count,
        Err(error) => {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
    };
    if encoded_frames != frames {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "el recorte quedó con {encoded_frames} de {frames} frames; probá un tramo más corto"
            ),
        ));
    }
    progress(100.0);
    let stem = source_stem(input);
    let result = import_derived_asset(root, &temp, ffprobe, fps_num, fps_den, &stem);
    let _ = std::fs::remove_file(&temp);
    let mut asset = result?;
    // El WebM contiene exactamente `frames` frames a la tasa del proyecto.
    // Se fija la medición al conteo real para que la ventana del clip siga
    // siendo exacta aunque el contenedor redondee la duración.
    if let Some(media) = asset.get_mut("media").and_then(Value::as_object_mut) {
        media.insert("width".into(), json!(width));
        media.insert("height".into(), json!(height));
        media.insert("durationFrames".into(), json!(frames));
        media.insert(
            "frameRate".into(),
            json!({ "num": fps_num, "den": fps_den }),
        );
        media.insert("alpha".into(), json!(true));
    }
    Ok(asset)
}

/// Quita el fondo de un asset del proyecto (imagen o video) y devuelve el
/// asset nuevo ya copiado a `media/`. El original nunca se modifica.
#[tauri::command]
pub async fn remove_background_asset(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    kind: String,
    in_frame: u64,
    out_frame: u64,
    fps_num: u32,
    fps_den: u32,
) -> Result<Value, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffprobe = ffprobe.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe es necesario para registrar el recorte en el proyecto",
        )
    })?;
    let model_path = require_recorte_model(&state)?;
    let input = resolve_inside_root(&session.root, path.trim())?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el material a recortar ya no está en disco",
        ));
    }
    match kind.as_str() {
        "image" => remove_image_background(
            &session.root,
            &input,
            &ffprobe,
            &model_path,
            fps_num.max(1),
            fps_den.max(1),
        ),
        "video" => {
            let ffmpeg = ffmpeg.ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "FFmpeg es necesario para quitar el fondo de un video",
                )
            })?;
            remove_video_background(
                &session.root,
                &input,
                &ffmpeg,
                &ffprobe,
                &model_path,
                in_frame,
                out_frame,
                fps_num.max(1),
                fps_den.max(1),
                |percent| {
                    let _ = app.emit("background-progress", json!({ "percent": percent }));
                },
            )
        }
        _ => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el recorte automático sólo acepta imágenes o videos",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn fixture_model() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/u2netp.onnx")
    }

    #[test]
    fn output_frame_is_even_and_capped_at_1080p() {
        assert_eq!(fit_output_frame(3840, 2160).unwrap(), (1920, 1080));
        assert_eq!(fit_output_frame(1001, 563).unwrap(), (1000, 562));
        assert_eq!(fit_output_frame(640, 360).unwrap(), (640, 360));
        assert!(fit_output_frame(0, 0).is_err());
    }

    /// Prueba real del recorte de imagen: infiere, importa el PNG al proyecto y
    /// conserva el alfa y la procedencia local.
    #[test]
    fn live_image_cutout_imports_a_transparent_asset() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el recorte de imagen real");
            return;
        }
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let ffprobe = manifest.join("resources/ffmpeg/ffprobe.exe");
        let model = fixture_model();
        let runtime = manifest.join("resources/onnxruntime/onnxruntime.dll");
        if !ffprobe.is_file() || !model.is_file() || !runtime.is_file() {
            eprintln!("faltan binarios del recorte; se omite la prueba real");
            return;
        }
        std::env::set_var("ORT_DYLIB_PATH", &runtime);

        let root = std::env::temp_dir().join(format!("olyvia-imagen-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("media")).expect("carpeta media");
        let input = root.join("media/entrada.png");
        let mut source = RgbaImage::from_pixel(640, 360, Rgba([20, 24, 32, 255]));
        for y in 120..280 {
            for x in 220..420 {
                source.put_pixel(x, y, Rgba([235, 238, 245, 255]));
            }
        }
        source.save(&input).expect("imagen de entrada");

        let asset = remove_image_background(&root, &input, &ffprobe, &model, 30, 1)
            .expect("recorte de imagen");
        let relative = asset["source"]["path"].as_str().expect("ruta del recorte");
        let output = root.join(relative);
        assert!(output.is_file(), "no se copió el recorte: {relative}");
        assert_eq!(asset["kind"], "image");
        assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");
        let decoded = image::open(&output).expect("leer el recorte").to_rgba8();
        let min = decoded
            .pixels()
            .map(|pixel| pixel.0[3])
            .min()
            .unwrap_or(255);
        let max = decoded.pixels().map(|pixel| pixel.0[3]).max().unwrap_or(0);
        assert!(
            max.saturating_sub(min) > 16,
            "el PNG importado no conservó el alfa: min={min} max={max}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Prueba real del pipeline de video: genera un clip sintético, lo procesa
    /// frame por frame, importa el WebM con alfa y verifica que el fondo y el
    /// sujeto tengan alfa distinta. Detrás de `EDITOR_IA_RUN_RENDER_TESTS`.
    #[test]
    fn live_video_cutout_keeps_duration_and_alpha() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el recorte de video real");
            return;
        }
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let ffmpeg = manifest.join("resources/ffmpeg/ffmpeg.exe");
        let ffprobe = manifest.join("resources/ffmpeg/ffprobe.exe");
        let model = fixture_model();
        let runtime = manifest.join("resources/onnxruntime/onnxruntime.dll");
        if !ffmpeg.is_file() || !ffprobe.is_file() || !model.is_file() || !runtime.is_file() {
            eprintln!("faltan binarios del recorte; se omite la prueba real");
            return;
        }
        std::env::set_var("ORT_DYLIB_PATH", &runtime);

        let root = std::env::temp_dir().join(format!("olyvia-recorte-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("media")).expect("carpeta media");
        let input = root.join("media/entrada.mp4");
        let mut source = Command::new(&ffmpeg);
        source
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x141821:s=640x360:d=0.5:r=30",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=0.2",
                "-vf",
                "drawbox=x=220:y=80:w=200:h=200:color=white@1:t=fill",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-t",
                "0.5",
                "-y",
            ])
            .arg(&input);
        hide_console(&mut source);
        assert!(source.status().expect("ffmpeg de entrada").success());

        let asset = remove_video_background(
            &root,
            &input,
            &ffmpeg,
            &ffprobe,
            &model,
            0,
            15,
            30,
            1,
            |_| {},
        )
        .expect("recorte de video");
        let relative = asset["source"]["path"].as_str().expect("ruta del recorte");
        let output = root.join(relative);
        assert!(output.is_file(), "no se copió el recorte: {relative}");
        let frames = asset["media"]["durationFrames"].as_u64().expect("duración");
        assert_eq!(frames, 15, "duración declarada inesperada: {frames}");
        let real_frames = count_video_frames(&ffprobe, &output).expect("contar los frames reales");
        assert_eq!(
            real_frames, 15,
            "el archivo no tiene los 15 frames declarados"
        );
        assert_eq!(asset["kind"], "video");
        assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");

        let mut decode = Command::new(&ffmpeg);
        decode
            .args(["-hide_banner", "-v", "error", "-c:v", "libvpx-vp9", "-i"])
            .arg(&output)
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        hide_console(&mut decode);
        let frame = decode.output().expect("decodificar el recorte").stdout;
        let width = asset["media"]["width"].as_u64().expect("ancho") as usize;
        let height = asset["media"]["height"].as_u64().expect("alto") as usize;
        assert_eq!(frame.len(), width * height * 4, "frame RGBA incompleto");
        let alpha_at = |x: usize, y: usize| frame[(y * width + x) * 4 + 3];
        let corner = alpha_at(4, 4);
        let center = alpha_at(width / 2, height / 2);
        assert!(
            corner.abs_diff(center) > 64,
            "el alfa no distingue fondo y sujeto: corner={corner} center={center}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Prueba real de inferencia: el modelo del fixture procesa una imagen
    /// sintética y la máscara tiene variación (distingue algo). Detrás de
    /// `EDITOR_IA_RUN_RENDER_TESTS` como las pruebas que necesitan binarios.
    #[test]
    fn live_u2netp_produces_a_variance_mask() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la inferencia real");
            return;
        }
        let model = fixture_model();
        assert!(model.is_file(), "falta el fixture del modelo u2netp");
        std::env::set_var(
            "ORT_DYLIB_PATH",
            Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/onnxruntime/onnxruntime.dll"),
        );

        // Sujeto claro sobre fondo oscuro: lo mínimo para que haya saliencia.
        let mut image = RgbaImage::from_pixel(640, 360, Rgba([20, 24, 32, 255]));
        for y in 120..280 {
            for x in 220..420 {
                image.put_pixel(x, y, Rgba([235, 238, 245, 255]));
            }
        }
        let dynamic = DynamicImage::ImageRgba8(image);

        let mask = run_u2netp(&model, &dynamic).expect("inferencia");
        assert_eq!(mask.width(), 640);
        assert_eq!(mask.height(), 360);

        let min = mask.pixels().map(|p| p.0[0]).min().expect("máscara vacía");
        let max = mask.pixels().map(|p| p.0[0]).max().expect("máscara vacía");
        assert!(
            max.saturating_sub(min) > 16,
            "la máscara no distingue nada: min={min} max={max}"
        );
    }
}
