//! Seguimiento de un punto por correlación cruzada normalizada (NCC).
//!
//! Es un tracker propio, sin OpenCV: plantilla gris del primer frame y búsqueda
//! local en cada frame siguiente. No promete invariancia a escala/rotación; si
//! la confianza cae por debajo del umbral conserva la última posición y lo
//! informa, para que la UI no invente una trayectoria.

#[derive(Debug, Clone)]
pub struct GrayFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PointTrack {
    pub frame: usize,
    pub x: f64,
    pub y: f64,
    pub confidence: f64,
}

const MIN_CONFIDENCE: f64 = 0.35;

fn patch_values(
    frame: &GrayFrame,
    center_x: f64,
    center_y: f64,
    radius: u32,
) -> Option<Vec<f32>> {
    let radius = radius as i64;
    let center_x = center_x.round() as i64;
    let center_y = center_y.round() as i64;
    let mut values = Vec::with_capacity(((radius * 2 + 1) * (radius * 2 + 1)) as usize);
    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let x = center_x + dx;
            let y = center_y + dy;
            if x < 0 || y < 0 || x >= frame.width as i64 || y >= frame.height as i64 {
                return None;
            }
            values.push(f32::from(frame.data[(y as u32 * frame.width + x as u32) as usize]));
        }
    }
    Some(values)
}

fn normalized(values: &[f32]) -> (f32, f32) {
    let count = values.len() as f32;
    let mean = values.iter().copied().sum::<f32>() / count;
    let norm = values
        .iter()
        .map(|value| (value - mean) * (value - mean))
        .sum::<f32>()
        .sqrt();
    (mean, norm)
}

/// NCC en [-1, 1]. Devuelve 0 si alguna de las ventanas es plana.
fn ncc(template: &[f32], template_mean: f32, template_norm: f32, candidate: &[f32]) -> f64 {
    if template_norm <= 1e-3 {
        return 0.0;
    }
    let (mean, norm) = normalized(candidate);
    if norm <= 1e-3 {
        return 0.0;
    }
    let mut dot = 0.0f32;
    for (a, b) in template.iter().zip(candidate.iter()) {
        dot += (a - template_mean) * (b - mean);
    }
    f64::from((dot / (template_norm * norm)).clamp(-1.0, 1.0))
}

/// Sigue el punto inicial (en píxeles) sobre los frames grises.
pub fn track_point(
    frames: &[GrayFrame],
    start_x: f64,
    start_y: f64,
    patch_radius: u32,
    search_radius: u32,
) -> Vec<PointTrack> {
    let Some(first) = frames.first() else {
        return Vec::new();
    };
    if first.width == 0 || first.height == 0 || first.data.len() < (first.width * first.height) as usize {
        return Vec::new();
    }
    let radius = patch_radius.max(2).min(48);
    let search = search_radius.max(1).min(128) as i64;
    let start_x = start_x.clamp(radius as f64, (first.width.saturating_sub(1)) as f64 - radius as f64);
    let start_y = start_y.clamp(radius as f64, (first.height.saturating_sub(1)) as f64 - radius as f64);
    let Some(template) = patch_values(first, start_x, start_y, radius) else {
        return Vec::new();
    };
    let (template_mean, template_norm) = normalized(&template);
    let mut position = (start_x, start_y);
    let mut track = vec![PointTrack {
        frame: 0,
        x: start_x,
        y: start_y,
        confidence: 1.0,
    }];
    for (index, frame) in frames.iter().enumerate().skip(1) {
        if frame.width != first.width || frame.height != first.height {
            break;
        }
        let mut best = (position.0, position.1, f64::NEG_INFINITY);
        for dy in -search..=search {
            for dx in -search..=search {
                let x = position.0 + dx as f64;
                let y = position.1 + dy as f64;
                let Some(candidate) = patch_values(frame, x, y, radius) else {
                    continue;
                };
                let score = ncc(&template, template_mean, template_norm, &candidate);
                if score > best.2 {
                    best = (x, y, score);
                }
            }
        }
        let confidence = best.2.max(0.0);
        if confidence >= MIN_CONFIDENCE {
            position = (best.0, best.1);
        }
        track.push(PointTrack {
            frame: index,
            x: position.0,
            y: position.1,
            confidence,
        });
    }
    track
}

/// Sigue una región rectangular (objeto) muestreando su textura.
///
/// A diferencia del punto, la plantilla cubre todo el rectángulo con un paso
/// que mantiene ~144 muestras; la búsqueda devuelve el centro del objeto. Sin
/// invariancia a escala/rotación: si la confianza cae, conserva la posición.
pub fn track_region(
    frames: &[GrayFrame],
    start_x: f64,
    start_y: f64,
    width: u32,
    height: u32,
    search_radius: u32,
) -> Vec<PointTrack> {
    let Some(first) = frames.first() else {
        return Vec::new();
    };
    if first.width == 0 || first.height == 0 || first.data.len() < (first.width * first.height) as usize {
        return Vec::new();
    }
    let width = width.clamp(4, 240).min(first.width.saturating_sub(1)).max(2);
    let height = height.clamp(4, 240).min(first.height.saturating_sub(1)).max(2);
    let half_w = f64::from(width) / 2.0;
    let half_h = f64::from(height) / 2.0;
    let start_x = start_x.clamp(half_w, (first.width.saturating_sub(1)) as f64 - half_w);
    let start_y = start_y.clamp(half_h, (first.height.saturating_sub(1)) as f64 - half_h);
    let Some(template) = region_values(first, start_x, start_y, width, height) else {
        return Vec::new();
    };
    let (template_mean, template_norm) = normalized(&template);
    let search = search_radius.max(1).min(128) as i64;
    let mut position = (start_x, start_y);
    let mut track = vec![PointTrack {
        frame: 0,
        x: start_x,
        y: start_y,
        confidence: 1.0,
    }];
    for (index, frame) in frames.iter().enumerate().skip(1) {
        if frame.width != first.width || frame.height != first.height {
            break;
        }
        let mut best = (position.0, position.1, f64::NEG_INFINITY);
        for dy in -search..=search {
            for dx in -search..=search {
                let x = position.0 + dx as f64;
                let y = position.1 + dy as f64;
                let Some(candidate) = region_values(frame, x, y, width, height) else {
                    continue;
                };
                let score = ncc(&template, template_mean, template_norm, &candidate);
                if score > best.2 {
                    best = (x, y, score);
                }
            }
        }
        let confidence = best.2.max(0.0);
        if confidence >= MIN_CONFIDENCE {
            position = (best.0, best.1);
        }
        track.push(PointTrack {
            frame: index,
            x: position.0,
            y: position.1,
            confidence,
        });
    }
    track
}

fn region_values(
    frame: &GrayFrame,
    center_x: f64,
    center_y: f64,
    width: u32,
    height: u32,
) -> Option<Vec<f32>> {
    let x0 = (center_x - f64::from(width) / 2.0).round() as i64;
    let y0 = (center_y - f64::from(height) / 2.0).round() as i64;
    let step_x = (width / 12).max(1);
    let step_y = (height / 12).max(1);
    let mut values = Vec::with_capacity(((width / step_x + 1) * (height / step_y + 1)) as usize);
    let mut y = 0u32;
    while y < height {
        let mut x = 0u32;
        while x < width {
            let px = x0 + i64::from(x);
            let py = y0 + i64::from(y);
            if px < 0 || py < 0 || px >= i64::from(frame.width) || py >= i64::from(frame.height) {
                return None;
            }
            values.push(f32::from(
                frame.data[(py as u32 * frame.width + px as u32) as usize],
            ));
            x += step_x;
        }
        y += step_y;
    }
    Some(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame_with_square(x: i32, y: i32, size: u32) -> GrayFrame {
        let width = 160;
        let height = 120;
        let mut data = vec![40u8; (width * height) as usize];
        for py in y.max(0)..(y + size as i32).min(height as i32) {
            for px in x.max(0)..(x + size as i32).min(width as i32) {
                data[(py as u32 * width + px as u32) as usize] = 220;
            }
        }
        GrayFrame { width, height, data }
    }

    /// Bloque 24×24 con textura a cuadros: una región plana daría NCC 0.
    fn frame_with_pattern(x: i32, y: i32) -> GrayFrame {
        let width = 160;
        let height = 120;
        let mut data = vec![40u8; (width * height) as usize];
        for py in y.max(0)..(y + 24).min(height as i32) {
            for px in x.max(0)..(x + 24).min(width as i32) {
                let cell = ((px - x) / 4 + (py - y) / 4) % 2;
                data[(py as u32 * width + px as u32) as usize] = if cell == 0 { 235 } else { 120 };
            }
        }
        GrayFrame { width, height, data }
    }

    #[test]
    fn follows_a_moving_square_within_two_pixels() {
        let frames: Vec<GrayFrame> = (0..12)
            .map(|index| frame_with_square(20 + index * 3, 50, 16))
            .collect();
        let track = track_point(&frames, 28.0, 58.0, 10, 8);
        assert_eq!(track.len(), 12);
        let last = track.last().unwrap();
        assert!((last.x - (20.0 + 11.0 * 3.0 + 8.0)).abs() <= 2.0, "x={}", last.x);
        assert!((last.y - 58.0).abs() <= 2.0, "y={}", last.y);
        assert!(track.iter().skip(1).all(|point| point.confidence > 0.8));
    }

    #[test]
    fn keeps_the_last_position_when_the_subject_disappears() {
        let mut frames: Vec<GrayFrame> = (0..6)
            .map(|index| frame_with_square(20 + index * 2, 40, 14))
            .collect();
        for _ in 0..4 {
            frames.push(GrayFrame {
                width: 160,
                height: 120,
                data: vec![40u8; 160 * 120],
            });
        }
        let track = track_point(&frames, 27.0, 47.0, 8, 10);
        assert_eq!(track.len(), 10);
        let last_visible = track[5];
        for point in &track[6..] {
            assert!((point.x - last_visible.x).abs() <= 1.0);
            assert!((point.y - last_visible.y).abs() <= 1.0);
            assert!(point.confidence < 0.35, "confianza {}", point.confidence);
        }
    }

    #[test]
    fn handles_empty_and_tiny_input() {
        assert!(track_point(&[], 0.0, 0.0, 8, 8).is_empty());
        let flat = GrayFrame {
            width: 20,
            height: 20,
            data: vec![0u8; 400],
        };
        let track = track_point(&[flat], 10.0, 10.0, 4, 4);
        assert_eq!(track.len(), 1);
        assert_eq!(track[0].confidence, 1.0);
    }

    #[test]
    fn follows_a_textured_region_within_two_pixels() {
        let frames: Vec<GrayFrame> = (0..12)
            .map(|index| frame_with_pattern(20 + index * 4, 50))
            .collect();
        let track = track_region(&frames, 32.0, 62.0, 20, 20, 8);
        assert_eq!(track.len(), 12);
        let last = track.last().unwrap();
        assert!((last.x - (20.0 + 11.0 * 4.0 + 12.0)).abs() <= 2.0, "x={}", last.x);
        assert!((last.y - 62.0).abs() <= 2.0, "y={}", last.y);
        assert!(track.iter().skip(1).all(|point| point.confidence > 0.8));
    }

    #[test]
    fn keeps_the_region_when_the_object_disappears() {
        let mut frames: Vec<GrayFrame> = (0..6)
            .map(|index| frame_with_pattern(20 + index * 3, 40))
            .collect();
        for _ in 0..4 {
            frames.push(GrayFrame {
                width: 160,
                height: 120,
                data: vec![40u8; 160 * 120],
            });
        }
        let track = track_region(&frames, 32.0, 52.0, 18, 18, 10);
        assert_eq!(track.len(), 10);
        let last_visible = track[5];
        for point in &track[6..] {
            assert!((point.x - last_visible.x).abs() <= 1.0);
            assert!((point.y - last_visible.y).abs() <= 1.0);
            assert!(point.confidence < 0.35, "confianza {}", point.confidence);
        }
    }

    #[test]
    fn clamps_region_size_and_handles_empty_input() {
        assert!(track_region(&[], 10.0, 10.0, 20, 20, 8).is_empty());
        let flat = GrayFrame {
            width: 40,
            height: 30,
            data: vec![90u8; 40 * 30],
        };
        let track = track_region(&[flat.clone()], 20.0, 15.0, 999, 999, 8);
        assert_eq!(track.len(), 1);
        assert!(track[0].x.is_finite() && track[0].y.is_finite());
        assert!(track[0].x >= 0.0 && track[0].x < 40.0);
    }
}
