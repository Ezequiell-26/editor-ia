//! Comprensión local del contenido de una imagen.
//!
//! El montaje automático necesita saber **qué muestra** cada foto para decidir
//! dónde va. Hasta ahora el emparejamiento se hacía con el nombre del archivo,
//! que no dice nada. Este módulo mide la imagen en el equipo: nada se sube y
//! nada se modifica en disco.
//!
//! Las medidas son deliberadamente geométricas y fotométricas (luz, color,
//! textura, rostros) y no semánticas. La interpretación —"esto parece un
//! atardecer en la costa"— la hace el planificador del frontend combinando
//! estas señales con el texto de la narración, o un modelo de visión cuando el
//! proveedor configurado lo soporta.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use image::imageops::FilterType;
use image::{GenericImageView, GrayImage, RgbImage};
use serde::Serialize;
use tauri::State;

use crate::commands::face;
use crate::commands::models::{is_model_downloaded, model_by_id, model_file};
use crate::commands::system::resolve_tools;
use crate::commands::{hide_console};
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Lado máximo de trabajo. Con 320 px alcanza para estadísticas estables y
/// mantiene el costo por imagen en milisegundos.
const WORK_SIZE: u32 = 320;
/// Lado máximo para la detección facial: SeetaFace necesita más detalle.
const FACE_SIZE: u32 = 480;
const PALETTE_COLORS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContent {
    pub asset_id: String,
    pub width: u32,
    pub height: u32,
    /// Ancho / alto. 1.78 es 16:9, 0.56 es 9:16.
    pub aspect: f64,
    /// `landscape`, `portrait` o `square`.
    pub orientation: String,
    /// Luminancia media 0–255.
    pub luma_mean: f64,
    /// Desvío de luminancia: mide contraste.
    pub luma_std: f64,
    /// Saturación media 0–255.
    pub saturation_mean: f64,
    /// Colorfulness (Hasler–Süsstrunk): 0 apagado, >40 muy vivo.
    pub colorfulness: f64,
    /// Tono dominante en grados 0–360.
    pub dominant_hue: f64,
    /// Concentración del tono dominante, 0–1. Bajo = imagen multicolor.
    pub hue_concentration: f64,
    /// `warm`, `cool` o `neutral`.
    pub temperature: String,
    /// Proporción de píxeles con borde fuerte, 0–1. Alto = mucha textura.
    pub edge_density: f64,
    /// Nitidez normalizada 0–1 (varianza del laplaciano).
    pub sharpness: f64,
    /// Balance cielo/suelo: 1 = mitad superior mucho más clara.
    pub sky_bias: f64,
    pub face_count: u32,
    pub face_center_x: Option<f64>,
    pub face_center_y: Option<f64>,
    pub face_size: Option<f64>,
    /// Colores dominantes en hex, de mayor a menor presencia.
    pub palette: Vec<String>,
    /// Para un video: segundo del que salió el cuadro analizado.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sampled_at_seconds: Option<f64>,
    pub warnings: Vec<String>,
}

fn clamp01(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;
    let max = rf.max(gf).max(bf);
    let min = rf.min(gf).min(bf);
    let delta = max - min;
    let hue = if delta <= f64::EPSILON {
        0.0
    } else if (max - rf).abs() < f64::EPSILON {
        60.0 * (((gf - bf) / delta) % 6.0)
    } else if (max - gf).abs() < f64::EPSILON {
        60.0 * (((bf - rf) / delta) + 2.0)
    } else {
        60.0 * (((rf - gf) / delta) + 4.0)
    };
    let hue = if hue < 0.0 { hue + 360.0 } else { hue };
    let saturation = if max <= f64::EPSILON { 0.0 } else { delta / max };
    (hue, saturation, max)
}

fn luma_of(r: u8, g: u8, b: u8) -> f64 {
    0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64
}

/// Varianza del laplaciano sobre gris, normalizada con una escala logarítmica.
/// El laplaciano castiga el desenfoque mucho más que el gradiente simple.
fn sharpness_of(gray: &GrayImage) -> f64 {
    let (width, height) = gray.dimensions();
    if width < 3 || height < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut sum_sq = 0.0;
    let mut count = 0.0;
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let center = gray.get_pixel(x, y)[0] as f64;
            let up = gray.get_pixel(x, y - 1)[0] as f64;
            let down = gray.get_pixel(x, y + 1)[0] as f64;
            let left = gray.get_pixel(x - 1, y)[0] as f64;
            let right = gray.get_pixel(x + 1, y)[0] as f64;
            let value = up + down + left + right - 4.0 * center;
            sum += value;
            sum_sq += value * value;
            count += 1.0;
        }
    }
    if count <= 0.0 {
        return 0.0;
    }
    let mean = sum / count;
    let variance = (sum_sq / count) - mean * mean;
    // 1e4 de varianza ya es una foto nítida; log comprime la cola.
    clamp01((variance.max(0.0) / 10_000.0).ln_1p() / 3.0)
}

/// Proporción de píxeles donde el gradiente supera un umbral fijo.
fn edge_density_of(gray: &GrayImage) -> f64 {
    let (width, height) = gray.dimensions();
    if width < 3 || height < 3 {
        return 0.0;
    }
    let mut edges = 0.0;
    let mut total = 0.0;
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let left = gray.get_pixel(x - 1, y)[0] as f64;
            let right = gray.get_pixel(x + 1, y)[0] as f64;
            let up = gray.get_pixel(x, y - 1)[0] as f64;
            let down = gray.get_pixel(x, y + 1)[0] as f64;
            let magnitude = (right - left).abs() + (down - up).abs();
            if magnitude > 48.0 {
                edges += 1.0;
            }
            total += 1.0;
        }
    }
    if total <= 0.0 {
        0.0
    } else {
        clamp01(edges / total)
    }
}

/// Diferencia media entre la mitad superior y la inferior, mapeada a −1..1.
/// Positivo = arriba más claro (cielo, ventana); negativo = arriba más oscuro.
fn sky_bias_of(gray: &GrayImage) -> f64 {
    let (width, height) = gray.dimensions();
    if width == 0 || height < 4 {
        return 0.0;
    }
    let band = (height / 4).max(1);
    let mut top = 0.0;
    let mut bottom = 0.0;
    let mut count = 0.0;
    for y in 0..band {
        for x in 0..width {
            top += gray.get_pixel(x, y)[0] as f64;
            bottom += gray.get_pixel(x, height - 1 - y)[0] as f64;
            count += 1.0;
        }
    }
    if count <= 0.0 {
        return 0.0;
    }
    let diff = (top - bottom) / count / 255.0;
    diff.clamp(-1.0, 1.0)
}

/// Paleta por cuantización: agrupa en cubos de 32 niveles y promedia los
/// colores de los cubos más poblados. Barato y suficiente para la interfaz.
fn palette_of(rgb: &RgbImage) -> Vec<String> {
    use std::collections::HashMap;
    let mut buckets: HashMap<(u8, u8, u8), (u64, u64, u64, u64)> = HashMap::new();
    for pixel in rgb.pixels() {
        let key = (pixel[0] >> 5, pixel[1] >> 5, pixel[2] >> 5);
        let entry = buckets.entry(key).or_insert((0, 0, 0, 0));
        entry.0 += pixel[0] as u64;
        entry.1 += pixel[1] as u64;
        entry.2 += pixel[2] as u64;
        entry.3 += 1;
    }
    let mut ranked: Vec<((u8, u8, u8), (u64, u64, u64, u64))> =
        buckets.into_iter().collect();
    ranked.sort_by(|a, b| b.1 .3.cmp(&a.1 .3));
    ranked
        .into_iter()
        .take(PALETTE_COLORS)
        .filter(|(_, sums)| sums.3 > 0)
        .map(|(_, sums)| {
            let count = sums.3;
            format!(
                "#{:02x}{:02x}{:02x}",
                (sums.0 / count) as u8,
                (sums.1 / count) as u8,
                (sums.2 / count) as u8
            )
        })
        .collect()
}

fn orientation_of(width: u32, height: u32) -> &'static str {
    if width == 0 || height == 0 {
        return "square";
    }
    let aspect = width as f64 / height as f64;
    if aspect > 1.08 {
        "landscape"
    } else if aspect < 0.92 {
        "portrait"
    } else {
        "square"
    }
}

fn temperature_of(dominant_hue: f64, concentration: f64, warm_bias: f64) -> &'static str {
    // El tono manda cuando la imagen es claramente monocromática; si no, la
    // diferencia media rojo–azul es más fiable.
    if concentration > 0.45 {
        let hue = dominant_hue;
        if (hue <= 65.0) || (hue >= 300.0) {
            return "warm";
        }
        if (160.0..=265.0).contains(&hue) {
            return "cool";
        }
        return "neutral";
    }
    if warm_bias > 0.06 {
        "warm"
    } else if warm_bias < -0.06 {
        "cool"
    } else {
        "neutral"
    }
}

fn measure(asset_id: &str, path: &Path, model_path: Option<&Path>) -> Result<ImageContent, String> {
    let decoded = image::open(path).map_err(|error| format!("no se pudo leer la imagen: {error}"))?;
    let (width, height) = decoded.dimensions();
    if width == 0 || height == 0 {
        return Err("la imagen no tiene dimensiones válidas".to_owned());
    }

    let work = decoded.resize(WORK_SIZE, WORK_SIZE, FilterType::Triangle);
    let rgb: RgbImage = work.to_rgb8();
    let gray: GrayImage = work.to_luma8();

    let mut luma_sum = 0.0;
    let mut luma_sq = 0.0;
    let mut saturation_sum = 0.0;
    let mut warm_sum = 0.0;
    let mut count = 0.0;
    let mut hue_histogram = [0.0f64; 36];
    let mut rg_sum = 0.0;
    let mut rg_sq = 0.0;
    let mut yb_sum = 0.0;
    let mut yb_sq = 0.0;

    for pixel in rgb.pixels() {
        let (r, g, b) = (pixel[0], pixel[1], pixel[2]);
        let luma = luma_of(r, g, b);
        luma_sum += luma;
        luma_sq += luma * luma;
        warm_sum += (r as f64 - b as f64) / 255.0;

        let (hue, saturation, value) = rgb_to_hsv(r, g, b);
        saturation_sum += saturation * 255.0;
        // Los píxeles casi grises no aportan tono y ensucian el histograma.
        if saturation > 0.12 && value > 0.10 {
            let bin = ((hue / 10.0).floor() as usize).min(35);
            hue_histogram[bin] += saturation * value;
        }

        let rg = r as f64 - g as f64;
        let yb = 0.5 * (r as f64 + g as f64) - b as f64;
        rg_sum += rg;
        rg_sq += rg * rg;
        yb_sum += yb;
        yb_sq += yb * yb;
        count += 1.0;
    }

    if count <= 0.0 {
        return Err("la imagen no tiene píxeles".to_owned());
    }

    let luma_mean = luma_sum / count;
    let luma_variance = (luma_sq / count) - luma_mean * luma_mean;
    let luma_std = luma_variance.max(0.0).sqrt();
    let saturation_mean = saturation_sum / count;
    let warm_bias = warm_sum / count;

    let rg_mean = rg_sum / count;
    let yb_mean = yb_sum / count;
    let rg_std = ((rg_sq / count) - rg_mean * rg_mean).max(0.0).sqrt();
    let yb_std = ((yb_sq / count) - yb_mean * yb_mean).max(0.0).sqrt();
    let colorfulness =
        (rg_std.powi(2) + yb_std.powi(2)).sqrt() + 0.3 * (rg_mean.powi(2) + yb_mean.powi(2)).sqrt();

    let hue_total: f64 = hue_histogram.iter().sum();
    let (dominant_hue, hue_concentration) = if hue_total <= f64::EPSILON {
        (0.0, 0.0)
    } else {
        let mut best_bin = 0usize;
        for (index, weight) in hue_histogram.iter().enumerate() {
            if *weight > hue_histogram[best_bin] {
                best_bin = index;
            }
        }
        // Promedio circular dentro de la ventana vecina para no reportar
        // bordes de bin como tonos distintos.
        let mut x = 0.0;
        let mut y = 0.0;
        for offset in -1i32..=1 {
            let index = (best_bin as i32 + offset).rem_euclid(36) as usize;
            let weight = hue_histogram[index];
            let angle = (index as f64 * 10.0 + 5.0).to_radians();
            x += angle.cos() * weight;
            y += angle.sin() * weight;
        }
        let hue = y.atan2(x).to_degrees();
        let hue = if hue < 0.0 { hue + 360.0 } else { hue };
        (hue, clamp01(hue_histogram[best_bin] / hue_total))
    };

    let mut warnings = Vec::new();
    let (face_count, face_center_x, face_center_y, face_size) = match model_path {
        Some(model) => match face::create_detector(model) {
            Ok(mut detector) => {
                let big = decoded.resize(FACE_SIZE, FACE_SIZE, FilterType::Triangle);
                let big_gray = big.to_luma8();
                match face::detect_largest_face(detector.as_mut(), &big_gray) {
                    Some((x, y, size)) => (
                        1,
                        Some(clamp01(x)),
                        Some(clamp01(y)),
                        Some(clamp01(size)),
                    ),
                    None => (0, None, None, None),
                }
            }
            Err(error) => {
                warnings.push(error);
                (0, None, None, None)
            }
        },
        None => {
            warnings.push("sin modelo de rostros: no se detectaron caras".to_owned());
            (0, None, None, None)
        }
    };

    Ok(ImageContent {
        asset_id: asset_id.to_owned(),
        width,
        height,
        aspect: (width as f64 / height.max(1) as f64 * 1000.0).round() / 1000.0,
        orientation: orientation_of(width, height).to_owned(),
        luma_mean: (luma_mean * 10.0).round() / 10.0,
        luma_std: (luma_std * 10.0).round() / 10.0,
        saturation_mean: (saturation_mean * 10.0).round() / 10.0,
        colorfulness: (colorfulness * 10.0).round() / 10.0,
        dominant_hue: dominant_hue.round(),
        hue_concentration: (hue_concentration * 1000.0).round() / 1000.0,
        temperature: temperature_of(dominant_hue, hue_concentration, warm_bias).to_owned(),
        edge_density: (edge_density_of(&gray) * 1000.0).round() / 1000.0,
        sharpness: (sharpness_of(&gray) * 1000.0).round() / 1000.0,
        sky_bias: (sky_bias_of(&gray) * 1000.0).round() / 1000.0,
        face_count,
        face_center_x,
        face_center_y,
        face_size,
        palette: palette_of(&rgb),
        // `None` salvo que la medición venga de un cuadro extraído de un video.
        sampled_at_seconds: None,
        warnings,
    })
}

/// Analiza el contenido visual de varias imágenes del proyecto en una sola
/// llamada. Las imágenes que fallan se omiten del resultado en vez de abortar
/// el lote: el montaje sigue funcionando con las que sí se pudieron leer.
#[tauri::command]
pub async fn analyze_images(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
) -> Result<Vec<ImageContent>, ProjectError> {
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }
    let session = state.require_session()?;
    let opened = service::open_project(&session.path)?;
    let assets = opened
        .project
        .get("assets")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let model_path: Option<PathBuf> = model_by_id("seeta-face")
        .filter(|spec| is_model_downloaded(&state, spec))
        .and_then(|spec| spec.files.first().map(|file| model_file(&state, spec, file)));

    let mut jobs: Vec<(String, PathBuf)> = Vec::new();
    for asset_id in &asset_ids {
        let Some(asset) = assets
            .iter()
            .find(|item| item["id"].as_str() == Some(asset_id.as_str()))
        else {
            continue;
        };
        if asset["kind"].as_str() != Some("image") {
            continue;
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let Ok(path) = resolve_inside_root(&session.root, relative) else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        jobs.push((asset_id.clone(), path));
    }

    if jobs.is_empty() {
        return Ok(Vec::new());
    }

    let model = model_path;
    let measured = tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::with_capacity(jobs.len());
        for (asset_id, path) in jobs {
            if let Ok(content) = measure(&asset_id, &path, model.as_deref()) {
                out.push(content);
            }
        }
        out
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("el análisis de imágenes se interrumpió: {error}"),
        )
    })?;

    Ok(measured)
}

/// Extrae un cuadro representativo de un video con FFmpeg. Escribirlo a PNG
/// permite reutilizar exactamente la misma medición que se usa para imágenes.
fn sample_video_frame(
    ffmpeg: &Path,
    video: &Path,
    at_seconds: f64,
    output: &Path,
) -> Result<(), String> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-v")
        .arg("error")
        .arg("-ss")
        .arg(format!("{at_seconds:.3}"))
        .arg("-i")
        .arg(video)
        .arg("-frames:v")
        .arg("1")
        .arg("-update")
        .arg("1")
        .arg("-y")
        .arg(output);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let result = command
        .output()
        .map_err(|error| format!("no se pudo iniciar FFmpeg: {error}"))?;
    if !result.status.success() {
        let reason = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "no se pudo extraer el cuadro: {}",
            reason.trim().chars().take(300).collect::<String>()
        ));
    }
    if !output.is_file() {
        return Err("el cuadro no se escribió en el disco".to_owned());
    }
    Ok(())
}

/// Segundo representativo de un video: el punto medio de su duración medida.
fn representative_second(asset: &serde_json::Value) -> Option<f64> {
    let frames = asset["media"]["durationFrames"].as_f64()?;
    let num = asset["media"]["frameRate"]["num"].as_f64().unwrap_or(0.0);
    let den = asset["media"]["frameRate"]["den"].as_f64().unwrap_or(1.0);
    if den <= 0.0 || frames <= 0.0 || num <= 0.0 {
        return None;
    }
    let fps = num / den;
    if !fps.is_finite() || fps <= 0.0 {
        return None;
    }
    Some((frames / fps) / 2.0)
}

/// Mide el contenido visual de los materiales del proyecto, **incluidos videos**.
///
/// Es la forma en que el asistente puede *ver* qué hay en la timeline: para cada
/// material devuelve luz, color, textura, nitidez, orientación y rostros medidos
/// en el equipo. En imágenes mide el archivo; en videos extrae el cuadro del
/// punto medio con FFmpeg y lo mide igual. Nada se sube ni se modifica.
#[tauri::command]
pub async fn analyze_media_frames(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
) -> Result<Vec<ImageContent>, ProjectError> {
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para mirar el contenido de los clips",
        ));
    };
    let opened = service::open_project(&session.path)?;
    let assets = opened
        .project
        .get("assets")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let face_model: Option<PathBuf> = model_by_id("seeta-face")
        .filter(|spec| is_model_downloaded(&state, spec))
        .and_then(|spec| spec.files.first().map(|file| model_file(&state, spec, file)));

    let mut jobs: Vec<(String, PathBuf, Option<f64>)> = Vec::new();
    for asset_id in &asset_ids {
        let Some(asset) = assets
            .iter()
            .find(|item| item["id"].as_str() == Some(asset_id.as_str()))
        else {
            continue;
        };
        let kind = asset["kind"].as_str().unwrap_or("");
        if kind != "image" && kind != "video" {
            continue;
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let Ok(path) = resolve_inside_root(&session.root, relative) else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        let at_seconds = if kind == "video" {
            representative_second(asset)
        } else {
            None
        };
        jobs.push((asset_id.clone(), path, at_seconds));
    }

    if jobs.is_empty() {
        return Ok(Vec::new());
    }

    let ffmpeg_for_jobs = ffmpeg.clone();
    let measured = tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<ImageContent> = Vec::with_capacity(jobs.len());
        for (asset_id, path, at_seconds) in jobs {
            let content = match at_seconds {
                Some(at) => {
                    let sample = std::env::temp_dir().join(format!(
                        "editoria-frame-{}.png",
                        uuid::Uuid::new_v4()
                    ));
                    if sample_video_frame(&ffmpeg_for_jobs, &path, at, &sample).is_err() {
                        continue;
                    }
                    let measured =
                        measure(&asset_id, &sample, face_model.as_deref()).ok();
                    let _ = std::fs::remove_file(&sample);
                    measured.map(|mut content| {
                        content.sampled_at_seconds = Some((at * 1000.0).round() / 1000.0);
                        content
                    })
                }
                None => measure(&asset_id, &path, face_model.as_deref()).ok(),
            };
            if let Some(content) = content {
                out.push(content);
            }
        }
        out
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("el análisis del contenido se interrumpió: {error}"),
        )
    })?;

    Ok(measured)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, GenericImage};

    fn solid(r: u8, g: u8, b: u8, size: u32) -> RgbImage {
        RgbImage::from_pixel(size, size, image::Rgb([r, g, b]))
    }

    #[test]
    fn hsv_reports_expected_primaries() {
        assert!((rgb_to_hsv(255, 0, 0).0 - 0.0).abs() < 0.01);
        assert!((rgb_to_hsv(0, 255, 0).0 - 120.0).abs() < 0.01);
        assert!((rgb_to_hsv(0, 0, 255).0 - 240.0).abs() < 0.01);
        let (_, saturation, value) = rgb_to_hsv(128, 128, 128);
        assert!(saturation < 0.01);
        assert!((value - 0.502).abs() < 0.01);
    }

    #[test]
    fn flat_image_has_no_edges_and_no_sharpness() {
        let image = solid(120, 120, 120, 32);
        let gray = DynamicImage::ImageRgb8(image).to_luma8();
        assert!(edge_density_of(&gray) < 0.01);
        assert!(sharpness_of(&gray) < 0.01);
    }

    #[test]
    fn checkerboard_has_high_edge_density() {
        let mut image = RgbImage::new(32, 32);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            let value = if (x / 4 + y / 4) % 2 == 0 { 0 } else { 255 };
            *pixel = image::Rgb([value, value, value]);
        }
        let gray = DynamicImage::ImageRgb8(image).to_luma8();
        assert!(edge_density_of(&gray) > 0.5);
        assert!(sharpness_of(&gray) > 0.1);
    }

    #[test]
    fn sky_bias_is_positive_when_top_is_brighter() {
        let mut image = RgbImage::new(40, 40);
        for (_, y, pixel) in image.enumerate_pixels_mut() {
            let value = if y < 10 { 240 } else { 30 };
            *pixel = image::Rgb([value, value, value]);
        }
        let gray = DynamicImage::ImageRgb8(image).to_luma8();
        assert!(sky_bias_of(&gray) > 0.5);
    }

    #[test]
    fn warm_and_cool_temperature() {
        assert_eq!(temperature_of(30.0, 0.9, 0.2), "warm");
        assert_eq!(temperature_of(210.0, 0.9, -0.2), "cool");
        assert_eq!(temperature_of(120.0, 0.9, 0.0), "neutral");
        // Con poca concentración manda el sesgo rojo–azul.
        assert_eq!(temperature_of(120.0, 0.1, 0.2), "warm");
    }

    #[test]
    fn orientation_thresholds() {
        assert_eq!(orientation_of(1920, 1080), "landscape");
        assert_eq!(orientation_of(1080, 1920), "portrait");
        assert_eq!(orientation_of(1000, 1000), "square");
    }

    #[test]
    fn palette_returns_hex_colors() {
        let image = solid(200, 40, 40, 16);
        let palette = palette_of(&image);
        assert_eq!(palette.len(), 1);
        assert_eq!(palette[0], "#c82828");
    }
}
