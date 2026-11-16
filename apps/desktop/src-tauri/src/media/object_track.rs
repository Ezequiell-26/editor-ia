//! Seguimiento de objeto genérico por template matching (NCC) — dominio puro.
//!
//! Equivalente legal e independiente del object tracking de AlaukCut
//! (`rastreamento.js`): no usa modelos propietarios ni detección por
//! clases — el usuario siembra un rectángulo (típicamente el bbox de una
//! máscara dibujada) y el tracker lo sigue cuadro a cuadro con
//! correlación cruzada normalizada sobre una versión reducida del frame.
//!
//! Los frames llegan ya decodificados y escalados por la infraestructura
//! (FFmpeg a rawvideo rgb24, lado máximo `MAX_DIM`); este módulo nunca
//! toca procesos ni disco. La salida usa la misma forma que `FaceSample`,
//! así el frontend puede reutilizar `applyFaceBlurOverlay` para
//! blur/máscara que sigue al objeto.

use serde::{Deserialize, Serialize};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const SAMPLE_FPS: u32 = 6;
pub const MAX_DIM: u32 = 256;
pub const MIN_DIM: u32 = 32;
/// Pasada de búsqueda en píxeles (paso 3 reduce ~9× el coste de NCC).
pub const SEARCH_STEP: i32 = 3;
/// NCC mínimo para considerar que el objeto sigue visible.
pub const MIN_CONFIDENCE: f64 = 0.45;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTrackRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTrackRequest {
    pub path: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub rect: ObjectTrackRect,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTrackSample {
    pub time: f64,
    pub center_x: f64,
    pub center_y: f64,
    pub size: f64,
    pub confidence: f64,
    pub rotation_deg: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectTrackResult {
    pub frames: u32,
    pub confident: u32,
    pub samples: Vec<ObjectTrackSample>,
    pub duration_seconds: f64,
    pub scaled_width: u32,
    pub scaled_height: u32,
}

pub fn validate_rect(rect: &ObjectTrackRect) -> Result<ObjectTrackRect, ProjectError> {
    let finite = |v: f64| v.is_finite();
    if !(finite(rect.x)
        && finite(rect.y)
        && finite(rect.w)
        && finite(rect.h)
        && rect.x >= 0.0
        && rect.y >= 0.0
        && rect.x <= 1.0
        && rect.y <= 1.0
        && rect.w >= 0.005
        && rect.h >= 0.005
        && rect.x + rect.w <= 1.0001
        && rect.y + rect.h <= 1.0001)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la región a seguir debe ser un rectángulo válido dentro del frame",
        ));
    }
    Ok(ObjectTrackRect {
        x: rect.x,
        y: rect.y,
        w: rect.w.min(1.0 - rect.x),
        h: rect.h.min(1.0 - rect.y),
    })
}

pub fn scaled_dims(src_w: u32, src_h: u32) -> (u32, u32) {
    if src_w == 0 || src_h == 0 {
        return (MAX_DIM, MAX_DIM);
    }
    let (mut w, mut h) = if src_w >= src_h {
        (MAX_DIM, (MAX_DIM * src_h / src_w).max(2))
    } else {
        ((MAX_DIM * src_w / src_h).max(2), MAX_DIM)
    };
    w = w.clamp(MIN_DIM, MAX_DIM * 2);
    h = h.clamp(MIN_DIM, MAX_DIM * 2);
    (w, h)
}

// ---------------------------------------------------------------------------
// Núcleo del tracker (puro, testeable sin FFmpeg)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct Patch {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

fn to_gray(frame: &[u8]) -> Vec<f32> {
    frame
        .as_chunks::<3>()
        .0
        .iter()
        .map(|px| 0.299 * px[0] as f32 + 0.587 * px[1] as f32 + 0.114 * px[2] as f32)
        .collect()
}

fn patch_values(gray: &[f32], width: i32, patch: Patch) -> Vec<f32> {
    let mut out = Vec::with_capacity((patch.w * patch.h) as usize);
    for row in 0..patch.h {
        let base = ((patch.y + row) * width + patch.x) as usize;
        for col in 0..patch.w {
            out.push(gray[base + col as usize]);
        }
    }
    out
}

/// NCC entre el template (ya centrado y normalizado) y una ventana.
fn ncc_centered(template: &[f32], template_norm: f64, window: &[f32]) -> f64 {
    let n = window.len() as f64;
    if n == 0.0 || template_norm <= 0.0 {
        return 0.0;
    }
    let mean = window.iter().sum::<f32>() as f64 / n;
    let mut dot = 0.0f64;
    let mut norm = 0.0f64;
    for (t, w) in template.iter().zip(window.iter()) {
        let d = (*w as f64) - mean;
        dot += (*t as f64) * d;
        norm += d * d;
    }
    if norm <= 0.0 {
        return 0.0;
    }
    dot / (template_norm * norm.sqrt())
}

fn centered_template(patch: &[f32]) -> (Vec<f32>, f64) {
    let n = patch.len() as f64;
    let mean = patch.iter().sum::<f32>() as f64 / n.max(1.0);
    let centered: Vec<f32> = patch.iter().map(|v| *v - mean as f32).collect();
    let norm = centered
        .iter()
        .map(|v| (*v as f64) * (*v as f64))
        .sum::<f64>()
        .sqrt();
    (centered, norm)
}

/// Escalas candidatas por frame alrededor del tamaño actual del patch.
/// La ventana se re-muestrea al tamaño del template antes del NCC, así la
/// comparación sigue siendo válida aunque el objeto cambie de tamaño.
const SCALE_CANDIDATES: [f64; 3] = [0.8, 1.0, 1.25];
/// Rango total de escala respecto al rectángulo semilla.
pub(crate) const MIN_SCALE: f64 = 0.6;
pub(crate) const MAX_SCALE: f64 = 1.8;

/// Re-muestreo bilineal de una ventana rectangular del frame gris a
/// `out_w × out_h` (típicamente el tamaño del template).
fn resized_window(
    gray: &[f32],
    width: i32,
    height: i32,
    patch: Patch,
    out_w: usize,
    out_h: usize,
) -> Vec<f32> {
    let mut out = Vec::with_capacity(out_w * out_h);
    for row in 0..out_h {
        let fy = patch.y as f64 + (row as f64 + 0.5) * patch.h as f64 / out_h as f64 - 0.5;
        let y0 = fy.floor() as i32;
        let y1 = (y0 + 1).min(height - 1).max(0);
        let wy = (fy - y0 as f64).clamp(0.0, 1.0);
        for col in 0..out_w {
            let fx = patch.x as f64 + (col as f64 + 0.5) * patch.w as f64 / out_w as f64 - 0.5;
            let x0 = fx.floor() as i32;
            let x1 = (x0 + 1).min(width - 1).max(0);
            let wx = (fx - x0 as f64).clamp(0.0, 1.0);
            let y0c = y0.clamp(0, height - 1);
            let y1c = y1.clamp(0, height - 1);
            let x0c = x0.clamp(0, width - 1);
            let base0 = (y0c * width + x0c) as usize;
            let base1 = (y1c * width + x0c) as usize;
            let base2 = (y0c * width + x1) as usize;
            let base3 = (y1c * width + x1) as usize;
            let top = gray[base0] as f64 * (1.0 - wx) + gray[base2] as f64 * wx;
            let bottom = gray[base1] as f64 * (1.0 - wx) + gray[base3] as f64 * wx;
            out.push((top * (1.0 - wy) + bottom * wy) as f32);
        }
    }
    out
}

/// Ángulos candidatos por frame (grados) alrededor de la rotación actual.
const ROTATION_STEP_DEG: f64 = 7.5;
const ROTATION_CANDIDATES: usize = 2; // -2..=+2 pasos
/// Rotación máxima acumulada respecto a la semilla.
const MAX_ROTATION_DEG: f64 = 60.0;

/// Muestrea una ventana centrada en (cx, cy) de `patch_w × patch_h` rotada
/// `angle_deg` grados (horario positivo, coordenadas de imagen) y la
/// re-muestrea bilineal a `out_w × out_h` para comparar con el template.
#[allow(clippy::too_many_arguments)]
fn rotated_window(
    gray: &[f32],
    width: i32,
    height: i32,
    cx: f64,
    cy: f64,
    patch_w: i32,
    patch_h: i32,
    angle_deg: f64,
    out_w: usize,
    out_h: usize,
) -> Vec<f32> {
    let rad = angle_deg.to_radians();
    let (sin, cos) = rad.sin_cos();
    // Coordenadas de la ventana sin rotar, centradas en el patch.
    let hx = patch_w as f64 / 2.0;
    let hy = patch_h as f64 / 2.0;
    let mut out = Vec::with_capacity(out_w * out_h);
    for row in 0..out_h {
        // Posición en la ventana rotada → coordenada fuente (rotación
        // inversa alrededor del centro del patch).
        let vy = (row as f64 + 0.5) / out_h as f64 * patch_h as f64 - hy;
        for col in 0..out_w {
            let vx = (col as f64 + 0.5) / out_w as f64 * patch_w as f64 - hx;
            let sx = cx + vx * cos + vy * sin;
            let sy = cy - vx * sin + vy * cos;
            // Bilineal sobre el frame.
            let x0 = sx.floor() as i32;
            let y0 = sy.floor() as i32;
            let fx = (sx - x0 as f64).clamp(0.0, 1.0);
            let fy = (sy - y0 as f64).clamp(0.0, 1.0);
            let x0c = x0.clamp(0, width - 1);
            let x1c = (x0 + 1).clamp(0, width - 1);
            let y0c = y0.clamp(0, height - 1);
            let y1c = (y0 + 1).clamp(0, height - 1);
            let i00 = (y0c * width + x0c) as usize;
            let i01 = (y0c * width + x1c) as usize;
            let i10 = (y1c * width + x0c) as usize;
            let i11 = (y1c * width + x1c) as usize;
            let top = gray[i00] as f64 * (1.0 - fx) + gray[i01] as f64 * fx;
            let bottom = gray[i10] as f64 * (1.0 - fx) + gray[i11] as f64 * fx;
            out.push((top * (1.0 - fy) + bottom * fy) as f32);
        }
    }
    out
}

/// Mejor (score, ángulo) probando la rotación actual ± pasos.
#[allow(clippy::too_many_arguments)]
fn best_rotation_at(
    gray: &[f32],
    width: i32,
    height: i32,
    cx: f64,
    cy: f64,
    patch_w: i32,
    patch_h: i32,
    current_deg: f64,
    template: &[f32],
    template_norm: f64,
    out_w: usize,
    out_h: usize,
) -> (f64, f64) {
    let mut best = (f64::NEG_INFINITY, current_deg);
    for step in -(ROTATION_CANDIDATES as i32)..=(ROTATION_CANDIDATES as i32) {
        let angle = (current_deg + step as f64 * ROTATION_STEP_DEG)
            .clamp(-MAX_ROTATION_DEG, MAX_ROTATION_DEG);
        let window = rotated_window(
            gray, width, height, cx, cy, patch_w, patch_h, angle, out_w, out_h,
        );
        let score = ncc_centered(template, template_norm, &window);
        if score > best.0 {
            best = (score, angle);
        }
    }
    best
}

/// Mejor escala en el centro dado: compara el NCC de la ventana re-muestreada
/// a tamaño de template para cada candidata y devuelve (score, patch w, h).
/// `patch_w`/`patch_h` son el tamaño actual; las candidatas lo escalan por
/// `SCALE_CANDIDATES` y quedan acotadas a `seed_w/h × MIN/MAX_SCALE`.
#[allow(clippy::too_many_arguments)]
fn best_scale_at(
    gray: &[f32],
    width: i32,
    height: i32,
    center_x: f64,
    center_y: f64,
    patch_w: i32,
    patch_h: i32,
    seed_w: i32,
    seed_h: i32,
    template: &[f32],
    template_norm: f64,
    out_w: usize,
    out_h: usize,
) -> (f64, i32, i32) {
    let min_w = ((seed_w as f64 * MIN_SCALE).round() as i32).max(6);
    let min_h = ((seed_h as f64 * MIN_SCALE).round() as i32).max(6);
    let max_w = ((seed_w as f64 * MAX_SCALE).round() as i32)
        .min(width.saturating_sub(2))
        .max(6);
    let max_h = ((seed_h as f64 * MAX_SCALE).round() as i32)
        .min(height.saturating_sub(2))
        .max(6);
    let mut best = (f64::NEG_INFINITY, patch_w, patch_h);
    for factor in SCALE_CANDIDATES {
        let w = ((patch_w as f64 * factor).round() as i32).clamp(min_w, max_w);
        let h = ((patch_h as f64 * factor).round() as i32).clamp(min_h, max_h);
        let px = (center_x - w as f64 / 2.0)
            .round()
            .clamp(0.0, (width - w) as f64) as i32;
        let py = (center_y - h as f64 / 2.0)
            .round()
            .clamp(0.0, (height - h) as f64) as i32;
        let window = resized_window(
            gray,
            width,
            height,
            Patch { x: px, y: py, w, h },
            out_w,
            out_h,
        );
        let score = ncc_centered(template, template_norm, &window);
        if score > best.0 {
            best = (score, w, h);
        }
    }
    best
}

/// Trackea una ventana de frames rgb24 consecutivos y devuelve un sample
/// por frame. El primer frame fija el template; los siguientes buscan el
/// mejor NCC en una ventana local (con pasada global si la confianza cae),
/// re-evalúan escala y rotación en el mejor centro.
pub fn track_frames(
    frames: &[Vec<u8>],
    width: u32,
    height: u32,
    rect: &ObjectTrackRect,
) -> Vec<ObjectTrackSample> {
    if frames.is_empty() {
        return Vec::new();
    }
    let (w_i, h_i) = (width as i32, height as i32);
    let mut seed = Patch {
        x: (rect.x * width as f64) as i32,
        y: (rect.y * height as f64) as i32,
        w: ((rect.w * width as f64).round() as i32).max(8),
        h: ((rect.h * height as f64).round() as i32).max(8),
    };
    seed.x = seed.x.clamp(0, (w_i - seed.w).max(0));
    seed.y = seed.y.clamp(0, (h_i - seed.h).max(0));
    seed.w = seed.w.min(w_i);
    seed.h = seed.h.min(h_i);
    if seed.w < 4 || seed.h < 4 {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(frames.len());
    let gray0 = to_gray(&frames[0]);
    let template_patch = patch_values(&gray0, w_i, seed);
    let (template, template_norm) = centered_template(&template_patch);
    let seed_w = seed.w;
    let seed_h = seed.h;
    let mut patch_w = seed.w;
    let mut patch_h = seed.h;
    // La búsqueda de posición siempre usa la ventana del tamaño semilla:
    // el NCC exige template y ventana del mismo largo. La escala se
    // re-evalúa aparte re-muestreando al tamaño del template.
    let search_w = seed.w;
    let search_h = seed.h;
    let radius = (search_w.max(search_h) / 2).clamp(12, 72);

    let mut center_x = seed.x as f64 + patch_w as f64 / 2.0;
    let mut center_y = seed.y as f64 + patch_h as f64 / 2.0;
    let mut rotation_deg = 0.0f64;

    for (index, frame) in frames.iter().enumerate() {
        let gray = to_gray(frame);
        if index > 0 {
            let mut best = (f64::NEG_INFINITY, center_x, center_y);
            let min_cx = (center_x - radius as f64).max(search_w as f64 / 2.0);
            let max_cx = (center_x + radius as f64).min(w_i as f64 - search_w as f64 / 2.0);
            let min_cy = (center_y - radius as f64).max(search_h as f64 / 2.0);
            let max_cy = (center_y + radius as f64).min(h_i as f64 - search_h as f64 / 2.0);
            let mut cy = min_cy;
            while cy <= max_cy {
                let mut cx = min_cx;
                while cx <= max_cx {
                    let px = (cx - search_w as f64 / 2.0).round() as i32;
                    let py = (cy - search_h as f64 / 2.0).round() as i32;
                    let candidate = Patch {
                        x: px,
                        y: py,
                        w: search_w,
                        h: search_h,
                    };
                    let window = patch_values(&gray, w_i, candidate);
                    let score = ncc_centered(&template, template_norm, &window);
                    if score > best.0 {
                        best = (score, cx, cy);
                    }
                    cx += SEARCH_STEP as f64;
                }
                cy += SEARCH_STEP as f64;
            }
            // Si el objetivo sale de la ventana local, intenta recuperarlo
            // en todo el frame. Esta pasada sólo corre con baja confianza.
            if best.0 < MIN_CONFIDENCE {
                let mut global = (f64::NEG_INFINITY, center_x, center_y);
                let half_w = search_w as f64 / 2.0;
                let half_h = search_h as f64 / 2.0;
                let mut gy = half_h;
                while gy <= h_i as f64 - half_h {
                    let mut gx = half_w;
                    while gx <= w_i as f64 - half_w {
                        let candidate = Patch {
                            x: (gx - half_w).round() as i32,
                            y: (gy - half_h).round() as i32,
                            w: search_w,
                            h: search_h,
                        };
                        let window = patch_values(&gray, w_i, candidate);
                        let score = ncc_centered(&template, template_norm, &window);
                        if score > global.0 {
                            global = (score, gx, gy);
                        }
                        gx += 8.0;
                    }
                    gy += 8.0;
                }
                if global.0 > best.0 {
                    best = global;
                }
            }
            if best.0 >= MIN_CONFIDENCE {
                center_x = best.1;
                center_y = best.2;
                // Re-evalúa escala en el mejor centro: la ventana se
                // re-muestrea al tamaño del template para cada candidata.
                let (scale_score, sw, sh) = best_scale_at(
                    &gray,
                    w_i,
                    h_i,
                    center_x,
                    center_y,
                    patch_w,
                    patch_h,
                    seed_w,
                    seed_h,
                    &template,
                    template_norm,
                    seed_w as usize,
                    seed_h as usize,
                );
                if scale_score >= MIN_CONFIDENCE {
                    patch_w = sw;
                    patch_h = sh;
                    center_x =
                        center_x.clamp(patch_w as f64 / 2.0, w_i as f64 - patch_w as f64 / 2.0);
                    center_y =
                        center_y.clamp(patch_h as f64 / 2.0, h_i as f64 - patch_h as f64 / 2.0);
                }
                // Re-evalúa rotación en el centro ya ajustado: ventana
                // rotada re-muestreada al tamaño del template.
                let (rot_score, rot) = best_rotation_at(
                    &gray,
                    w_i,
                    h_i,
                    center_x,
                    center_y,
                    patch_w,
                    patch_h,
                    rotation_deg,
                    &template,
                    template_norm,
                    seed_w as usize,
                    seed_h as usize,
                );
                if rot_score >= MIN_CONFIDENCE {
                    rotation_deg = rot;
                }
            }
            // Si la confianza cae por debajo del umbral se conserva la última
            // posición (posible oclusión); el sample lo reporta vía confidence.
            let confidence = best.0.max(0.0);
            out.push(ObjectTrackSample {
                time: index as f64 / SAMPLE_FPS as f64,
                center_x: (center_x / width as f64).clamp(0.0, 1.0),
                center_y: (center_y / height as f64).clamp(0.0, 1.0),
                size: (patch_w.max(patch_h) as f64 / width.max(height) as f64).clamp(0.01, 1.0),
                confidence,
                rotation_deg,
            });
        } else {
            out.push(ObjectTrackSample {
                time: 0.0,
                center_x: (center_x / width as f64).clamp(0.0, 1.0),
                center_y: (center_y / height as f64).clamp(0.0, 1.0),
                size: (patch_w.max(patch_h) as f64 / width.max(height) as f64).clamp(0.01, 1.0),
                confidence: 1.0,
                rotation_deg,
            });
        }
    }
    out
}

#[cfg(test)]
#[path = "object_track.tests.rs"]
mod tests;
