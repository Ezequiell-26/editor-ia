//! Detección facial local y trayectoria de encuadre para smart reframe.
//!
//! La detección corre con SeetaFace (rustface, BSD-2-Clause) sobre frames
//! muestreados en gris. No sube nada ni usa GPU. El seguimiento es una
//! interpolación suavizada del rostro más grande; no es reconocimiento de
//! personas ni identifica a nadie.

use std::path::Path;

use image::{DynamicImage, GrayImage};
use rustface::{Detector, ImageData};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceSample {
    pub time: f64,
    pub center_x: f64,
    pub center_y: f64,
    pub size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceTrackPoint {
    pub time: f64,
    pub x: f64,
    pub y: f64,
}

fn clamp01(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.5;
    }
    value.clamp(0.0, 1.0)
}

/// Devuelve el centro y el tamaño relativo del rostro más grande del frame.
pub fn detect_largest_face(
    detector: &mut dyn Detector,
    gray: &GrayImage,
) -> Option<(f64, f64, f64)> {
    let width = gray.width();
    let height = gray.height();
    if width == 0 || height == 0 {
        return None;
    }
    let image = ImageData::new(gray.as_raw(), width, height);
    let mut best: Option<(f64, f64, f64, f64)> = None;
    for face in detector.detect(&image) {
        let bbox = face.bbox();
        let area = f64::from(bbox.width()) * f64::from(bbox.height());
        if area <= 0.0 {
            continue;
        }
        let center_x = (f64::from(bbox.x()) + f64::from(bbox.width()) / 2.0) / f64::from(width);
        let center_y = (f64::from(bbox.y()) + f64::from(bbox.height()) / 2.0) / f64::from(height);
        let size = f64::from(bbox.width().max(bbox.height())) / f64::from(width.max(height));
        let better = best
            .map(|(best_area, _, _, _)| area > best_area)
            .unwrap_or(true);
        if better {
            best = Some((area, center_x, center_y, size));
        }
    }
    best.map(|(_, x, y, size)| (clamp01(x), clamp01(y), clamp01(size)))
}

/// Crea el detector una sola vez para procesar varios frames.
pub fn create_detector(model_path: &Path) -> Result<Box<dyn Detector>, String> {
    let path = model_path.to_string_lossy();
    let mut detector = rustface::create_detector(&path)
        .map_err(|error| format!("no se pudo cargar el modelo de rostros: {error}"))?;
    detector.set_min_face_size(20);
    // 1.2 tolera rostros chicos en frames de 480 px sin llenar de falsos
    // positivos; el modelo devuelve scores normalizados por el clasificador.
    detector.set_score_thresh(1.2);
    detector.set_pyramid_scale_factor(0.8);
    detector.set_slide_window_step(4, 4);
    Ok(detector)
}

pub fn detect_in_image(
    detector: &mut dyn Detector,
    image: &DynamicImage,
    time: f64,
) -> Option<FaceSample> {
    let gray = image.to_luma8();
    detect_largest_face(detector, &gray).map(|(x, y, size)| FaceSample {
        time,
        center_x: x,
        center_y: y,
        size,
    })
}

/// Rellena huecos y suaviza la trayectoria. Si no hay ninguna detección,
/// devuelve una lista vacía y el recorte queda centrado.
pub fn smooth_track(samples: &[FaceSample]) -> Vec<FaceTrackPoint> {
    let mut valid: Vec<FaceSample> = samples
        .iter()
        .copied()
        .filter(|sample| sample.time.is_finite() && sample.time >= 0.0)
        .collect();
    valid.sort_by(|a, b| a.time.total_cmp(&b.time));
    if valid.is_empty() {
        return Vec::new();
    }
    // Suavizado 0.25 / 0.5 / 0.25 sobre las detecciones reales. Los huecos se
    // interpolan después en la expresión de FFmpeg; no se duplican muestras.
    let smoothed: Vec<FaceTrackPoint> = valid
        .iter()
        .enumerate()
        .map(|(index, sample)| {
            let prev = valid[index.saturating_sub(1)];
            let next = valid[(index + 1).min(valid.len() - 1)];
            FaceTrackPoint {
                time: sample.time,
                x: clamp01(prev.center_x * 0.25 + sample.center_x * 0.5 + next.center_x * 0.25),
                y: clamp01(prev.center_y * 0.25 + sample.center_y * 0.5 + next.center_y * 0.25),
            }
        })
        .collect();
    smoothed
}

fn number(value: f64) -> String {
    format!("{value:.3}")
}

/// Construye una expresión FFmpeg `if(lt(t,...),...)` que interpola el centro
/// del rostro entre muestras. El resultado ya está limitado al rango de crop.
pub fn crop_expression(
    points: &[FaceTrackPoint],
    scaled_width: f64,
    scaled_height: f64,
    crop_width: f64,
    crop_height: f64,
    axis: char,
) -> String {
    if points.is_empty() {
        return match axis {
            'x' => number(((scaled_width - crop_width) / 2.0).max(0.0)),
            _ => number(((scaled_height - crop_height) / 2.0).max(0.0)),
        };
    }
    let range = match axis {
        'x' => (scaled_width - crop_width).max(0.0),
        _ => (scaled_height - crop_height).max(0.0),
    };
    if range <= 0.0 {
        return "0".to_owned();
    }
    let values: Vec<f64> = points
        .iter()
        .map(|point| {
            let center = if axis == 'x' {
                point.x * scaled_width
            } else {
                point.y * scaled_height
            };
            let half = if axis == 'x' {
                crop_width / 2.0
            } else {
                crop_height / 2.0
            };
            (center - half).clamp(0.0, range)
        })
        .collect();
    let mut expression = number(values[values.len() - 1]);
    for index in (0..points.len().saturating_sub(1)).rev() {
        let left = points[index];
        let right = points[index + 1];
        let span = (right.time - left.time).max(0.001);
        let value = if (values[index + 1] - values[index]).abs() < 0.01 {
            number(values[index])
        } else {
            format!(
                "({0}+({1}-{0})*(t-{2})/{3})",
                number(values[index]),
                number(values[index + 1]),
                number(left.time),
                number(span)
            )
        };
        expression = format!(
            "if(lt(t,{0}),{1},{2})",
            number(right.time),
            value,
            expression
        );
    }
    expression
}

/// Elige dimensiones escaladas pares que cubren el lienzo 1080×1920.
pub fn scaled_cover(source_width: u32, source_height: u32) -> (u32, u32) {
    if source_width == 0 || source_height == 0 {
        return (1080, 1920);
    }
    let factor = (1080.0 / f64::from(source_width)).max(1920.0 / f64::from(source_height));
    let width = ((f64::from(source_width) * factor).ceil() as u32).max(1080);
    let height = ((f64::from(source_height) * factor).ceil() as u32).max(1920);
    (width + width % 2, height + height % 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(time: f64, x: f64, y: f64) -> FaceSample {
        FaceSample {
            time,
            center_x: x,
            center_y: y,
            size: 0.2,
        }
    }

    #[test]
    fn scaled_cover_always_covers_the_canvas_and_is_even() {
        let (w, h) = scaled_cover(640, 360);
        assert!(w >= 1080 && h >= 1920);
        assert_eq!(w % 2, 0);
        assert_eq!(h % 2, 0);
        let (w, h) = scaled_cover(1080, 1920);
        assert_eq!((w, h), (1080, 1920));
        assert_eq!(scaled_cover(0, 0), (1080, 1920));
    }

    #[test]
    fn smooth_track_clamps_and_keeps_times() {
        let track = smooth_track(&[
            sample(0.0, 0.2, 0.5),
            sample(0.5, 0.8, 0.5),
            sample(1.0, 1.4, -0.2),
        ]);
        assert_eq!(track.len(), 3);
        assert!(track.iter().all(|point| (0.0..=1.0).contains(&point.x)));
        assert!(track.iter().all(|point| (0.0..=1.0).contains(&point.y)));
        assert_eq!(track[0].time, 0.0);
        assert_eq!(track[2].time, 1.0);
        assert!(smooth_track(&[]).is_empty());
    }

    #[test]
    #[ignore = "requiere SEETA_MODEL y FACE_IMAGE para verificar contra una foto real"]
    fn detects_a_real_face() {
        let model = std::env::var("SEETA_MODEL").expect("SEETA_MODEL");
        let image_path = std::env::var("FACE_IMAGE").expect("FACE_IMAGE");
        let mut detector = create_detector(Path::new(&model)).expect("detector");
        let image = image::open(&image_path).expect("imagen");
        let sample = detect_in_image(detector.as_mut(), &image, 0.0).expect("rostro");
        assert!((0.0..=1.0).contains(&sample.center_x));
        assert!((0.0..=1.0).contains(&sample.center_y));
        assert!(sample.size > 0.0);
    }

    #[test]
    fn crop_expression_interpolates_between_face_points() {
        let points = vec![
            FaceTrackPoint {
                time: 0.0,
                x: 0.25,
                y: 0.5,
            },
            FaceTrackPoint {
                time: 1.0,
                x: 0.75,
                y: 0.5,
            },
        ];
        let x = crop_expression(&points, 3414.0, 1920.0, 1080.0, 1920.0, 'x');
        assert!(x.contains("if(lt(t,1.000)"));
        assert!(x.contains("313.500"));
        assert!(x.contains("2020.500"));
        let y = crop_expression(&points, 3414.0, 1920.0, 1080.0, 1920.0, 'y');
        assert_eq!(y, "0");
        let centered = crop_expression(&[], 3414.0, 1920.0, 1080.0, 1920.0, 'x');
        assert_eq!(centered, "1167.000");
    }
}
