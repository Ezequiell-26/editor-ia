//! Upscale ×4 con Real-ESRGAN corriendo localmente vía ONNX Runtime.
//!
//! El modelo exportado por Qualcomm tiene entrada fija de 128×128: cualquier
//! imagen se procesa por teselas con un borde de solape (10 px, igual que el
//! CLI de referencia de Real-ESRGAN) para que las costuras sean mínimas. Cada
//! tesela entra como [1, 3, 128, 128] float 0–1 RGB y sale [1, 3, 512, 512].

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use image::{imageops::FilterType, DynamicImage, GenericImage, GenericImageView, RgbaImage};
use serde::Serialize;
use tauri::State;

use crate::commands::models::{is_model_downloaded, model_by_id, model_dir};
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

/// La inferencia por teselas sobre la imagen completa.
fn run_realesrgan(model_path: &Path, image: &DynamicImage) -> Result<RgbaImage, ProjectError> {
    let environment = ensure_environment()?;
    let mut session = ort::session::Session::builder(environment)
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
        })?;

    let (width, height) = image.dimensions();
    let rgb = image.to_rgb8();
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
                &rgb,
                window_x as u32,
                window_y as u32,
                window_w.max(1),
                window_h.max(1),
            )
            .to_image();

            let upscaled = run_tile(&mut session, &window)?;
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
                (base_x * SCALE as i64),
                (base_y * SCALE as i64),
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
