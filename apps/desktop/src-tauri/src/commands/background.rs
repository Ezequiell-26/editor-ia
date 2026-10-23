//! Quitar fondo con U²-Net corriendo localmente vía ONNX Runtime.
//!
//! El flujo: se carga el modelo descargado (u2netp, 4,4 MB), la imagen se
//! re-escala a 320×320 y se normaliza igual que rembg, el modelo devuelve una
//! máscara de saliencia que se re-escala al tamaño original y se aplica como
//! canal alfa. El resultado es un PNG con transparencia, sin subir nada a
//! ningún lado.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use image::{imageops::FilterType, DynamicImage, GenericImageView, RgbaImage};
use serde::Serialize;
use tauri::State;

use crate::commands::models::{is_model_downloaded, model_by_id, model_dir};
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
    let spec = model_by_id("u2netp").ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "el modelo de recorte no existe")
    })?;
    if !is_model_downloaded(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta descargar el modelo de recorte (Ajustes → Capacidades)",
        ));
    }
    let model_path = model_dir(&state, spec).join(spec.files[0].file_name);
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

/// Ejecuta u2netp y devuelve la máscara al tamaño de la imagen.
fn run_u2netp(model_path: &Path, image: &DynamicImage) -> Result<image::GrayImage, ProjectError> {
    let environment = ensure_environment()?;
    let mut session = ort::session::Session::builder(environment)
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
        })?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn fixture_model() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/u2netp.onnx")
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
