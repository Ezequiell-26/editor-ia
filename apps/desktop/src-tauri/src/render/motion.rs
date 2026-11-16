//! Motion graphics burned through libass.
//!
//! The TypeScript catalog validates the user-facing props and produces a
//! neutral plan. This module treats that plan as untrusted JSON: it validates
//! every layer, converts it to ASS events and fails the render when a graphic
//! clip has no plan instead of dropping the clip silently.

use std::collections::HashMap;

use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::subtitles::{ass_color, ass_time};

const MAX_LAYERS: usize = 16;
const MAX_TEXT_CHARS: usize = 500;

pub struct MotionAssInput<'a> {
    pub project: &'a Value,
    pub plans: &'a Value,
    pub render_width: u32,
    pub render_height: u32,
    pub project_width: u32,
    pub project_height: u32,
    pub project_fps: f64,
}

fn fail(message: impl Into<String>) -> ProjectError {
    ProjectError::message(ProjectErrorCode::RenderFailed, &message.into())
}

fn text_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key)?.as_str()
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key)?.as_f64().filter(|number| number.is_finite())
}

fn unit(value: &Value, key: &str, label: &str) -> Result<f64, ProjectError> {
    let Some(number) = number(value, key) else {
        return Err(fail(format!("{}: {key} no es un número válido", label)));
    };
    if !(0.0..=1.0).contains(&number) {
        return Err(fail(format!("{}: {key} debe estar entre 0 y 1", label)));
    }
    Ok(number)
}

fn valid_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn font_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ' ' | '-' | '_' | '.')
        })
        .take(80)
        .collect();
    if cleaned.trim().is_empty() {
        "Segoe UI".to_owned()
    } else {
        cleaned
    }
}

fn escape_text(value: &str) -> String {
    let mut out = String::new();
    for character in value.trim().chars().take(MAX_TEXT_CHARS) {
        match character {
            '{' | '}' => out.push(' '),
            '\\' => out.push('/'),
            '\r' => {}
            '\n' => out.push_str("\\N"),
            other => out.push(other),
        }
    }
    out
}

fn validate_animation(layer: &Value, label: &str) -> Result<(), ProjectError> {
    let Some(animation) = layer.get("animation") else {
        return Ok(());
    };
    let Some(object) = animation.as_object() else {
        return Err(fail(format!("{label}: animation debe ser un objeto")));
    };
    let kind = object.get("kind").and_then(Value::as_str).unwrap_or("none");
    if !matches!(
        kind,
        "none" | "fade" | "slide-up" | "slide-left" | "pop" | "write" | "wipe" | "back"
    ) {
        return Err(fail(format!("{label}: animación {kind} desconocida")));
    }
    for key in ["inFrames", "outFrames"] {
        if let Some(value) = object.get(key) {
            let Some(number) = value.as_f64().filter(|number| number.is_finite()) else {
                return Err(fail(format!("{label}: {key} inválido")));
            };
            if !(0.0..=600.0).contains(&number) {
                return Err(fail(format!("{label}: {key} fuera de rango")));
            }
        }
    }
    if let Some(value) = object.get("distance") {
        let Some(number) = value.as_f64().filter(|number| number.is_finite()) else {
            return Err(fail(format!("{label}: distance inválido")));
        };
        if !(0.0..=0.5).contains(&number) {
            return Err(fail(format!("{label}: distance fuera de rango")));
        }
    }
    Ok(())
}

fn validate_plan(plan: &Value, clip_id: &str) -> Result<(), ProjectError> {
    let context = format!("clip gráfico {clip_id}");
    if plan.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(fail(format!("{context}: versión de plan inválida")));
    }
    let Some(layers) = plan.get("layers").and_then(Value::as_array) else {
        return Err(fail(format!("{context}: el plan no tiene capas")));
    };
    if layers.is_empty() || layers.len() > MAX_LAYERS {
        return Err(fail(format!(
            "{context}: el plan debe tener entre 1 y {MAX_LAYERS} capas"
        )));
    }
    for (index, layer) in layers.iter().enumerate() {
        let label = format!("{context}, capa {index}");
        match layer.get("kind").and_then(Value::as_str) {
            Some("text") => {
                let Some(text) = text_field(layer, "text") else {
                    return Err(fail(format!("{label}: falta text")));
                };
                if text.chars().count() > MAX_TEXT_CHARS {
                    return Err(fail(format!("{label}: texto demasiado largo")));
                }
                let Some(color) = text_field(layer, "color") else {
                    return Err(fail(format!("{label}: falta color")));
                };
                if !valid_color(color) {
                    return Err(fail(format!("{label}: color inválido")));
                }
                let Some(size) = number(layer, "fontSizePx") else {
                    return Err(fail(format!("{label}: falta fontSizePx")));
                };
                if !(4.0..=400.0).contains(&size) {
                    return Err(fail(format!("{label}: fontSizePx fuera de rango")));
                }
                let Some(weight) = number(layer, "weight") else {
                    return Err(fail(format!("{label}: falta weight")));
                };
                if !(100.0..=900.0).contains(&weight) {
                    return Err(fail(format!("{label}: weight fuera de rango")));
                }
                let align = text_field(layer, "align").unwrap_or("left");
                if !matches!(align, "left" | "center" | "right") {
                    return Err(fail(format!("{label}: alineación inválida")));
                }
                for key in ["skewXDeg", "skewYDeg"] {
                    if let Some(skew) = number(layer, key) {
                        if !(skew.is_finite() && (-90.0..=90.0).contains(&skew)) {
                            return Err(fail(format!("{label}: {key} fuera de rango")));
                        }
                    }
                }
                for key in ["x", "y", "width", "height"] {
                    unit(layer, key, &label)?;
                }
                validate_animation(layer, &label)?;
            }
            Some("rect") => {
                let Some(color) = text_field(layer, "color") else {
                    return Err(fail(format!("{label}: falta color")));
                };
                if !valid_color(color) {
                    return Err(fail(format!("{label}: color inválido")));
                }
                if let Some(shape) = text_field(layer, "shape") {
                    if !matches!(
                        shape,
                        "rect"
                            | "ellipse"
                            | "triangle"
                            | "diamond"
                            | "star"
                            | "pentagon"
                            | "hexagon"
                            | "arrow"
                            | "line"
                            | "parallelogram"
                            | "trapezoid"
                            | "heart"
                            | "hand"
                            | "custom"
                    ) {
                        return Err(fail(format!("{label}: forma inválida")));
                    }
                    if shape == "custom" || shape == "line" {
                        let min_points = if shape == "line" { 2 } else { 3 };
                        let valid =
                            layer
                                .get("points")
                                .and_then(Value::as_array)
                                .is_some_and(|points| {
                                    (min_points..=16).contains(&points.len())
                                        && points.iter().all(|point| {
                                            let x = point.get("x").and_then(Value::as_f64);
                                            let y = point.get("y").and_then(Value::as_f64);
                                            matches!(
                                                (x, y),
                                                (Some(x), Some(y))
                                                    if x.is_finite()
                                                        && y.is_finite()
                                                        && (0.0..=1.0).contains(&x)
                                                        && (0.0..=1.0).contains(&y)
                                            )
                                        })
                                });
                        if !valid {
                            return Err(fail(format!(
                                "{label}: la forma necesita {min_points}-16 puntos con x/y entre 0 y 1"
                            )));
                        }
                    }
                }
                let Some(opacity) = number(layer, "opacity") else {
                    return Err(fail(format!("{label}: falta opacity")));
                };
                if !(0.0..=1.0).contains(&opacity) {
                    return Err(fail(format!("{label}: opacity fuera de rango")));
                }
                if let Some(stroke_color) = text_field(layer, "strokeColor") {
                    if !valid_color(stroke_color) {
                        return Err(fail(format!("{label}: strokeColor inválido")));
                    }
                }
                if let Some(stroke_width) = number(layer, "strokeWidth") {
                    if !(0.0..=0.5).contains(&stroke_width) {
                        return Err(fail(format!("{label}: strokeWidth fuera de rango")));
                    }
                }
                if let Some(stroke_opacity) = number(layer, "strokeOpacity") {
                    if !(0.0..=1.0).contains(&stroke_opacity) {
                        return Err(fail(format!("{label}: strokeOpacity fuera de rango")));
                    }
                }
                if let Some(shadow) = layer.get("shadow") {
                    if let Some(shadow_color) = shadow.get("color").and_then(Value::as_str) {
                        if !valid_color(shadow_color) {
                            return Err(fail(format!("{label}: shadow.color inválido")));
                        }
                    }
                    if let Some(offset) = shadow.get("offsetPx").and_then(Value::as_f64) {
                        if !(offset.is_finite() && (0.0..=2000.0).contains(&offset)) {
                            return Err(fail(format!("{label}: shadow.offsetPx fuera de rango")));
                        }
                    }
                    if let Some(angle) = shadow.get("angleDeg").and_then(Value::as_f64) {
                        if !(angle.is_finite() && (-360.0..=360.0).contains(&angle)) {
                            return Err(fail(format!("{label}: shadow.angleDeg fuera de rango")));
                        }
                    }
                    if let Some(opacity) = shadow.get("opacity").and_then(Value::as_f64) {
                        if !(opacity.is_finite() && (0.0..=1.0).contains(&opacity)) {
                            return Err(fail(format!("{label}: shadow.opacity fuera de rango")));
                        }
                    }
                    if let Some(blur) = shadow.get("blurPx").and_then(Value::as_f64) {
                        if !(blur.is_finite() && (0.0..=500.0).contains(&blur)) {
                            return Err(fail(format!("{label}: shadow.blurPx fuera de rango")));
                        }
                    }
                }
                for key in ["x", "y", "width", "height"] {
                    unit(layer, key, &label)?;
                }
                validate_animation(layer, &label)?;
            }
            Some("stroke") => {
                let Some(color) = text_field(layer, "color") else {
                    return Err(fail(format!("{label}: falta color")));
                };
                if !valid_color(color) {
                    return Err(fail(format!("{label}: color inválido")));
                }
                let Some(opacity) = number(layer, "opacity") else {
                    return Err(fail(format!("{label}: falta opacity")));
                };
                if !(0.0..=1.0).contains(&opacity) {
                    return Err(fail(format!("{label}: opacity fuera de rango")));
                }
                let thickness = number(layer, "thickness").unwrap_or(0.0);
                if !(0.0005..=1.0).contains(&thickness) {
                    return Err(fail(format!("{label}: thickness fuera de rango")));
                }
                let radius = number(layer, "radius").unwrap_or(0.0);
                if !(0.0..=0.5).contains(&radius) {
                    return Err(fail(format!("{label}: radius fuera de rango")));
                }
                let draw_seconds = number(layer, "drawSeconds").unwrap_or(0.0);
                if !(0.0..=30.0).contains(&draw_seconds) {
                    return Err(fail(format!("{label}: drawSeconds fuera de rango")));
                }
                for key in ["x", "y", "width", "height"] {
                    unit(layer, key, &label)?;
                }
                validate_animation(layer, &label)?;
            }
            _ => return Err(fail(format!("{label}: tipo de capa desconocido"))),
        }
    }
    Ok(())
}

fn override_color(value: &str) -> String {
    let color = ass_color(value, "#ffffff");
    format!("{}&", color.trim_end_matches('&'))
}

/// easeOutBack — la misma curva que `easeOutBack` de `plan.ts`
/// (c1 = 1.70158, c3 = c1 + 1); se usa para muestrear el pico del
/// sobreimpulso de la animación `back`.
fn ease_out_back(t: f64) -> f64 {
    let c1 = 1.70158_f64;
    let c3 = c1 + 1.0;
    1.0 + c3 * (t - 1.0).powi(3) + c1 * (t - 1.0).powi(2)
}

// clippy::too_many_arguments: genera los tags de animación del layer;
// geometría renderizada y fps son entradas del cálculo.
#[allow(clippy::too_many_arguments)]
fn animation_tags(
    layer: &Value,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    render_width: f64,
    render_height: f64,
    fps: f64,
) -> String {
    let animation = layer.get("animation");
    let kind = animation
        .and_then(|value| value.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("none");
    if kind == "none" {
        return String::new();
    }
    let in_frames = animation
        .and_then(|value| value.get("inFrames"))
        .and_then(Value::as_f64)
        .unwrap_or(12.0);
    let out_frames = animation
        .and_then(|value| value.get("outFrames"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let distance = animation
        .and_then(|value| value.get("distance"))
        .and_then(Value::as_f64)
        .unwrap_or(0.04);
    let fps = fps.max(1.0);
    let in_ms = (in_frames / fps * 1000.0).round().max(0.0) as u64;
    let out_ms = (out_frames / fps * 1000.0).round().max(0.0) as u64;
    let mut tags = format!("\\fad({in_ms},{out_ms})");
    match kind {
        "slide-up" => {
            let start_y = y + distance * render_height;
            tags.push_str(&format!(
                "\\move({x:.1},{start_y:.1},{x:.1},{y:.1},0,{in_ms})"
            ));
        }
        "slide-left" => {
            let start_x = x - distance * render_width;
            tags.push_str(&format!(
                "\\move({start_x:.1},{y:.1},{x:.1},{y:.1},0,{in_ms})"
            ));
        }
        "pop" => tags.push_str(&format!(
            "\\fscx70\\fscy70\\t(0,{in_ms},\\fscx100\\fscy100)"
        )),
        "back" => {
            // easeOutBack (entrada con sobreimpulso de `faixas.js`):
            // escala 60 → pico ~103 al 70 % de la entrada → 100. ASS no
            // tiene easing, así que se encadenan dos `\t` con el pico
            // medido de la misma curva que usa el preview.
            // El máximo de easeOutBack cae en t≈0.58 (derivada = 0).
            let t1 = (0.58 * in_ms as f64).round().max(0.0) as u64;
            let peak = ease_out_back(0.58);
            let peak_scale = ((0.6 + 0.4 * peak) * 100.0).round() as u64;
            tags.push_str(&format!(
                "\\fscx60\\fscy60\\t(0,{t1},\\fscx{peak_scale}\\fscy{peak_scale})\\t({t1},{in_ms},\\fscx100\\fscy100)"
            ));
        }
        "write" | "wipe" => {
            // «Se escribe» (`marca_texto`) y «barrido» (clip-paths de
            // entrada de `faixas.js`): el borde derecho del `\clip` de
            // la capa avanza durante la entrada — mismo efecto que el
            // clip-path del preview. Aplica a texto y a dibujos.
            tags.push_str(&format!(
                "\\clip({x:.1},{y:.1},{x:.1},{y2:.1})\\t(0,{in_ms},\\clip({x:.1},{y:.1},{x2:.1},{y2:.1}))",
                y2 = y + height,
                x2 = x + width,
            ));
        }
        _ => {}
    }
    let _ = width;
    let _ = height;
    tags
}

/// Vértices `points` (0..1 dentro de la caja de la capa) de una forma
/// `custom`. La validación ya corrió en `validate_plan`; acá se relee de
/// forma tolerante y un plan inválido cae al rectángulo en vez de romper
/// el render.
fn custom_shape_vertices(layer: &Value, width: f64, height: f64) -> Option<Vec<(f64, f64)>> {
    shape_vertices(layer, width, height, 3)
}

/// Vértices `points` (0..1 dentro de la caja de la capa). `min_points`
/// depende de la forma: `custom` exige ≥3 (polígono cerrado), `line` ≥2
/// (polilínea abierta). La validación ya corrió en `validate_plan`; acá
/// se relee de forma tolerante y un plan inválido cae al rectángulo.
fn shape_vertices(
    layer: &Value,
    width: f64,
    height: f64,
    min_points: usize,
) -> Option<Vec<(f64, f64)>> {
    let points = layer.get("points")?.as_array()?;
    if points.len() < min_points || points.len() > 16 {
        return None;
    }
    let mut vertices = Vec::with_capacity(points.len());
    for point in points {
        let x = point.get("x").and_then(Value::as_f64)?;
        let y = point.get("y").and_then(Value::as_f64)?;
        if !(x.is_finite() && y.is_finite() && (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y))
        {
            return None;
        }
        vertices.push((x * width, y * height));
    }
    Some(vertices)
}

fn drawing_commands(vertices: &[(f64, f64)]) -> String {
    let mut drawing = String::new();
    for (index, (px, py)) in vertices.iter().enumerate() {
        if index == 0 {
            drawing.push_str(&format!("m {px:.1} {py:.1}"));
        } else {
            drawing.push_str(&format!(" l {px:.1} {py:.1}"));
        }
    }
    if let Some((fx, fy)) = vertices.first() {
        drawing.push_str(&format!(" l {fx:.1} {fy:.1}{{\\p0}}"));
    }
    drawing
}

/// Polilínea abierta (`line` de `formas.js`): un quad por segmento con
/// `thickness` px de ancho y extremos cortados (butt). Las juntas entre
/// segmentos quedan con pequeñas muescas en ángulos cerrados —
/// aproximación documentada frente al trazo SVG con miters del preview.
fn polyline_drawing(vertices: &[(f64, f64)], thickness: f64) -> String {
    let half = (thickness / 2.0).max(0.5);
    let mut drawing = String::new();
    for pair in vertices.windows(2) {
        let (x0, y0) = pair[0];
        let (x1, y1) = pair[1];
        let dx = x1 - x0;
        let dy = y1 - y0;
        let len = (dx * dx + dy * dy).sqrt().max(1e-6);
        let nx = -dy / len * half;
        let ny = dx / len * half;
        drawing.push_str(&format!(
            "m {:.1} {:.1} l {:.1} {:.1} {:.1} {:.1} {:.1} {:.1} l {:.1} {:.1} ",
            x0 + nx,
            y0 + ny,
            x1 + nx,
            y1 + ny,
            x1 - nx,
            y1 - ny,
            x0 - nx,
            y0 - ny,
            x0 + nx,
            y0 + ny,
        ));
    }
    drawing.push_str("{\\p0}");
    drawing
}

fn rect_drawing(width: f64, height: f64) -> String {
    format!("m 0 0 l {width:.1} 0 {width:.1} {height:.1} 0 {height:.1} l 0 0{{\\p0}}")
}

/// Dibujo `\p1` de las formas del titler. ASS no tiene curvas: la elipse se
/// aproxima con 32 lados y triángulo/rombo son polúgonos regulares inscriptos
/// Vértices del corazón de `formas.js` en coordenadas centradas (-0.82..0.86,
/// cúspide abajo): la misma tabla que el preview (`HEART_POINTS`) y la máscara
/// `heart`, escalada ×0.52 dentro de la caja de la capa.
const HEART_POINTS: &[(f64, f64)] = &[
    (0.0, -0.72),
    (0.28, -0.78),
    (0.55, -0.62),
    (0.72, -0.38),
    (0.82, -0.1),
    (0.8, 0.18),
    (0.62, 0.42),
    (0.4, 0.62),
    (0.18, 0.78),
    (0.0, 0.86),
    (-0.18, 0.78),
    (-0.4, 0.62),
    (-0.62, 0.42),
    (-0.8, 0.18),
    (-0.82, -0.1),
    (-0.72, -0.38),
    (-0.55, -0.62),
    (-0.28, -0.78),
];

/// Vértices de la mano señalando a la derecha (paridad del «manito» de
/// `maozinha` de AlaukCut): índice extendido, pulgar arriba y dorso con
/// tres nudillos. Coordenadas 0..1 dentro de la caja de la capa — la
/// misma tabla que `HAND_POINTS` del preview (`MotionPreview.tsx`).
const HAND_POINTS: &[(f64, f64)] = &[
    (0.98, 0.16),
    (1.0, 0.3),
    (0.84, 0.38),
    (0.74, 0.3),
    (0.6, 0.12),
    (0.52, 0.0),
    (0.42, 0.14),
    (0.34, 0.3),
    (0.16, 0.42),
    (0.14, 0.66),
    (0.34, 0.84),
    (0.6, 0.9),
    (0.74, 0.82),
    (0.84, 0.7),
    (0.9, 0.56),
    (0.92, 0.44),
];

/// en el rectángulo de la capa — las mismas coordenadas que el `clip-path`
/// del preview, así ambas vistas coinciden.
fn polygon_drawing(shape: &str, width: f64, height: f64) -> String {
    let cx = width / 2.0;
    let cy = height / 2.0;
    let rx = width / 2.0;
    let ry = height / 2.0;
    // Vértices en coordenadas de capa (origen arriba-izquierda), en el mismo
    // orden que el clip-path CSS del preview.
    let vertices: Vec<(f64, f64)> = match shape {
        "triangle" => vec![(cx, 0.0), (width, height), (0.0, height)],
        "diamond" => vec![(cx, 0.0), (width, cy), (cx, height), (0.0, cy)],
        "star" => (0..10)
            .map(|index| {
                // 5 puntas: vértices alternan radio externo (100%) e interno
                // (50%) sobre la elipse inscripta, empezando arriba — los
                // mismos puntos que el clip-path del preview.
                let angle =
                    -std::f64::consts::FRAC_PI_2 + index as f64 * std::f64::consts::PI / 5.0;
                let radius = if index % 2 == 0 { 1.0 } else { 0.5 };
                (
                    cx + rx * radius * angle.cos(),
                    cy + ry * radius * angle.sin(),
                )
            })
            .collect(),
        "pentagon" | "hexagon" => {
            let sides = if shape == "pentagon" { 5.0 } else { 6.0 };
            (0..sides as usize)
                .map(|index| {
                    let angle =
                        -std::f64::consts::FRAC_PI_2 + index as f64 * std::f64::consts::TAU / sides;
                    (cx + rx * angle.cos(), cy + ry * angle.sin())
                })
                .collect()
        }
        "arrow" => vec![
            (0.5 * width, 0.0),
            (0.85 * width, 0.38 * height),
            (0.66 * width, 0.38 * height),
            (0.66 * width, height),
            (0.34 * width, height),
            (0.34 * width, 0.38 * height),
            (0.15 * width, 0.38 * height),
        ],
        // Paralelogramo (~22 % de inclinación) y trapecio (base inferior más
        // ancha) de `formas.js` de AlaukCut — mismos vértices que el
        // clip-path del preview.
        "parallelogram" => vec![
            (0.22 * width, 0.0),
            (width, 0.0),
            (0.78 * width, height),
            (0.0, height),
        ],
        "trapezoid" => vec![
            (0.25 * width, 0.0),
            (0.75 * width, 0.0),
            (width, height),
            (0.0, height),
        ],
        // Corazón de `formas.js`: los mismos 18 puntos muestreados de la
        // curva implícita que la máscara `heart`, escalados ×0.52 a la caja.
        "heart" => HEART_POINTS
            .iter()
            .map(|(u, v)| {
                (
                    (0.5 + u * 0.52) * width,
                    (0.5 + v * 0.52) * height,
                )
            })
            .collect(),
        // Mano señalando (`maozinha`): vértices 0..1 escalados a la caja.
        "hand" => HAND_POINTS
            .iter()
            .map(|(x, y)| (x * width, y * height))
            .collect(),
        _ => {
            // Elipse: 32 lados paramétricos, primer punto a la derecha.
            let segments = 32;
            (0..segments)
                .map(|index| {
                    let angle = std::f64::consts::TAU * index as f64 / segments as f64;
                    (cx + rx * angle.cos(), cy + ry * angle.sin())
                })
                .collect()
        }
    };
    drawing_commands(&vertices)
}

fn graphic_clips(project: &Value) -> Vec<&Value> {
    let tracks = project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut info: HashMap<String, (u64, bool)> = HashMap::new();
    for track in &tracks {
        let Some(id) = text_field(track, "id") else {
            continue;
        };
        if track.get("kind").and_then(Value::as_str) != Some("graphic") {
            continue;
        }
        info.insert(
            id.to_owned(),
            (
                track.get("order").and_then(Value::as_u64).unwrap_or(0),
                track
                    .get("hidden")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            ),
        );
    }
    let mut clips: Vec<&Value> = project["timeline"]["clips"]
        .as_array()
        .map(|clips| {
            clips
                .iter()
                .filter(|clip| {
                    if clip.get("kind").and_then(Value::as_str) != Some("graphic") {
                        return false;
                    }
                    if clip.get("enabled").and_then(Value::as_bool) == Some(false) {
                        return false;
                    }
                    let Some(track_id) = text_field(clip, "trackId") else {
                        return false;
                    };
                    info.get(track_id)
                        .map(|(_, hidden)| !hidden)
                        .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default();
    clips.sort_by_key(|clip| {
        let track_id = text_field(clip, "trackId").unwrap_or("");
        let order = info.get(track_id).map(|(order, _)| *order).unwrap_or(0);
        (
            order,
            clip.get("startFrame").and_then(Value::as_u64).unwrap_or(0),
        )
    });
    clips
}

pub fn has_visible_graphic_clips(project: &Value) -> bool {
    !graphic_clips(project).is_empty()
}

/// Segmentos en que se divide el perímetro del trazo para el draw-on:
/// cada tramo es un Dialogue propio que aparece en su instante (easing
/// coseno), así el borde "se dibuja" como en `contorno.js` de AlaukCut.
const STROKE_SEGMENTS: usize = 40;

/// Punto sobre el perímetro del rectángulo redondeado a distancia de arco
/// `s`, en coords locales de la capa. El orden es horario empezando en el
/// borde superior tras la esquina superior-izquierda — el mismo recorrido
/// que `caminho` de AlaukCut.
fn stroke_perimeter_point(
    x0: f64,
    y0: f64,
    w: f64,
    h: f64,
    r: f64,
    s: f64,
) -> (f64, f64, f64, f64) {
    // (longitud, kind): kind 0=line, 1=arc(cos,sin del centro, ángulo inicio)
    struct Seg {
        len: f64,
        kind: u8,
        // line: (x1,y1)->(x2,y2); arc: (cx,cy,a0)
        a: f64,
        b: f64,
        c: f64,
        d: f64,
    }
    let line = |x1: f64, y1: f64, x2: f64, y2: f64| Seg {
        len: ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt(),
        kind: 0,
        a: x1,
        b: y1,
        c: x2,
        d: y2,
    };
    let arc = |cx: f64, cy: f64, a0: f64, a1: f64| Seg {
        len: r * (a1 - a0).abs(),
        kind: 1,
        a: cx,
        b: cy,
        c: a0,
        d: a1,
    };
    let segs = [
        line(x0 + r, y0, x0 + w - r, y0),
        arc(x0 + w - r, y0 + r, -std::f64::consts::FRAC_PI_2, 0.0),
        line(x0 + w, y0 + r, x0 + w, y0 + h - r),
        arc(x0 + w - r, y0 + h - r, 0.0, std::f64::consts::FRAC_PI_2),
        line(x0 + w - r, y0 + h, x0 + r, y0 + h),
        arc(x0 + r, y0 + h - r, std::f64::consts::FRAC_PI_2, std::f64::consts::PI),
        line(x0, y0 + h - r, x0, y0 + r),
        arc(x0 + r, y0 + r, std::f64::consts::PI, std::f64::consts::PI * 1.5),
    ];
    let total: f64 = segs.iter().map(|seg| seg.len).sum();
    let mut remaining = s.rem_euclid(total.max(1e-6));
    for (index, seg) in segs.iter().enumerate() {
        if remaining <= seg.len || index == segs.len() - 1 {
            let t = if seg.len > 1e-9 {
                (remaining / seg.len).clamp(0.0, 1.0)
            } else {
                0.0
            };
            if seg.kind == 0 {
                let x = seg.a + (seg.c - seg.a) * t;
                let y = seg.b + (seg.d - seg.b) * t;
                let dx = seg.c - seg.a;
                let dy = seg.d - seg.b;
                let len = (dx * dx + dy * dy).sqrt().max(1e-9);
                // Tangente (dx,dy)/len; normal outward = (-dy,dx) o (dy,-dx)
                // según el lado — se decide afuera con el centro del rect.
                return (x, y, dx / len, dy / len);
            }
            let angle = seg.c + (seg.d - seg.c) * t;
            let x = seg.a + r * angle.cos();
            let y = seg.b + r * angle.sin();
            // Tangente de la arco: derivada = (-sin, cos) en la dirección del ángulo.
            let dir = if seg.d >= seg.c { 1.0 } else { -1.0 };
            return (x, y, -angle.sin() * dir, angle.cos() * dir);
        }
        remaining -= seg.len;
    }
    (x0 + r, y0, 1.0, 0.0)
}

/// Inversa del easing coseno de AlaukCut: dado el progreso dibujado `p`
/// devuelve la fracción de tiempo `x` en [0,1] tal que
/// `p = (1 - cos(πx))/2`.
fn stroke_ease_inverse(p: f64) -> f64 {
    ((1.0 - 2.0 * p.clamp(0.0, 1.0)).acos() / std::f64::consts::PI).clamp(0.0, 1.0)
}

/// Dibujo `\p1` de un segmento del trazo: quad a ambos lados del centro del
/// perímetro con `thickness` de ancho. Devuelve también el punto medio para
/// orientar la normal hacia afuera del rectángulo.
fn stroke_segment_drawing(
    p0: (f64, f64, f64, f64),
    p1: (f64, f64, f64, f64),
    cx: f64,
    cy: f64,
    half: f64,
) -> String {
    let (x0, y0, tx0, ty0) = p0;
    let (x1, y1, tx1, ty1) = p1;
    let mid_x = (x0 + x1) / 2.0;
    let mid_y = (y0 + y1) / 2.0;
    // Normal perpendicular a la tangente; se orienta hacia afuera del centro.
    let mut nx = -(ty0 + ty1) / 2.0;
    let mut ny = (tx0 + tx1) / 2.0;
    let nlen = (nx * nx + ny * ny).sqrt().max(1e-9);
    nx /= nlen;
    ny /= nlen;
    if nx * (mid_x - cx) + ny * (mid_y - cy) < 0.0 {
        nx = -nx;
        ny = -ny;
    }
    let ax = x0 + nx * half;
    let ay = y0 + ny * half;
    let bx = x1 + nx * half;
    let by = y1 + ny * half;
    let cxq = x1 - nx * half;
    let cyq = y1 - ny * half;
    let dxq = x0 - nx * half;
    let dyq = y0 - ny * half;
    format!(
        "m {ax:.1} {ay:.1} l {bx:.1} {by:.1} {cxq:.1} {cyq:.1} {dxq:.1} {dyq:.1} l {ax:.1} {ay:.1}{{\\p0}}"
    )
}

pub fn build_motion_ass(input: MotionAssInput<'_>) -> Result<String, ProjectError> {
    let clips = graphic_clips(input.project);
    if clips.is_empty() {
        return Ok(String::new());
    }
    let fps = input.project_fps.max(1.0);
    let render_width = input.render_width.max(1) as f64;
    let render_height = input.render_height.max(1) as f64;
    let project_height = input.project_height.max(1) as f64;
    let scale = (render_height / project_height).clamp(0.25, 4.0);

    let mut output = String::from(
        "[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nScaledBorderAndShadow: yes\n",
    );
    output.push_str(&format!(
        "PlayResX: {}\nPlayResY: {}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n",
        input.render_width, input.render_height
    ));
    output.push_str(
        "Style: Motion,Segoe UI,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n",
    );
    output.push_str("\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");

    for clip in clips {
        let clip_id = text_field(clip, "id").unwrap_or("");
        let plan = input.plans.get(clip_id).ok_or_else(|| {
            fail(format!(
                "el clip gráfico {clip_id} no tiene un plan de motion; volvé a exportar desde el editor"
            ))
        })?;
        validate_plan(plan, clip_id)?;
        let start_frame = clip.get("startFrame").and_then(Value::as_u64).unwrap_or(0);
        let duration_frames = clip
            .get("durationFrames")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        if duration_frames == 0 {
            continue;
        }
        let start = start_frame as f64 / fps;
        let end = (start_frame + duration_frames) as f64 / fps;
        let track_id = text_field(clip, "trackId").unwrap_or("");
        let layer_number = input
            .project
            .get("timeline")
            .and_then(|timeline| timeline.get("tracks"))
            .and_then(Value::as_array)
            .and_then(|tracks| {
                tracks
                    .iter()
                    .find(|track| text_field(track, "id") == Some(track_id))
                    .and_then(|track| track.get("order").and_then(Value::as_u64))
            })
            .unwrap_or(0)
            .min(9);

        for layer in plan["layers"].as_array().cloned().unwrap_or_default() {
            let x = number(&layer, "x").unwrap_or(0.0) * render_width;
            let y = number(&layer, "y").unwrap_or(0.0) * render_height;
            let width = number(&layer, "width").unwrap_or(0.0) * render_width;
            let height = number(&layer, "height").unwrap_or(0.0) * render_height;
            let tags = animation_tags(
                &layer,
                x,
                y,
                width,
                height,
                render_width,
                render_height,
                fps,
            );
            let kind = layer.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind == "stroke" {
                // Trazo animado (paridad `contorno.js`): el perímetro del
                // rectángulo redondeado se divide en STROKE_SEGMENTS tramos;
                // cada tramo es un Dialogue que aparece en su instante según
                // el easing coseno, así el borde "se dibuja" a lo largo del
                // clip. Los tramos son quads rellenos (winding simple).
                let min_dim = render_width.min(render_height);
                let th = (number(&layer, "thickness").unwrap_or(0.02) * min_dim).max(1.0);
                let half = th / 2.0;
                let lw = width.max(4.0);
                let lh = height.max(4.0);
                // Centro del trazo: insetado medio grosor dentro de la caja
                // de la capa (mismo margen que `desenhar` de AlaukCut).
                let rw = (lw - th).max(4.0);
                let rh = (lh - th).max(4.0);
                let layer_min = lw.min(lh);
                let outer_r = (number(&layer, "radius").unwrap_or(0.0) * layer_min)
                    .clamp(0.0, layer_min / 2.0);
                let r = (outer_r - half).clamp(0.0, rw.min(rh) / 2.0);
                let color = override_color(text_field(&layer, "color").unwrap_or("#000000"));
                let opacity = number(&layer, "opacity").unwrap_or(1.0).clamp(0.0, 1.0);
                let alpha = ((1.0 - opacity) * 255.0).round().clamp(0.0, 255.0) as u8;
                let draw_seconds = number(&layer, "drawSeconds").unwrap_or(0.0).max(0.0);
                // Largo total del perímetro (líneas + 4 cuartos de arco).
                let perimeter =
                    2.0 * (rw - 2.0 * r).max(0.0) + 2.0 * (rh - 2.0 * r).max(0.0) + 2.0 * std::f64::consts::PI * r;
                for index in 0..STROKE_SEGMENTS {
                    let s0 = perimeter * index as f64 / STROKE_SEGMENTS as f64;
                    let s1 = perimeter * (index + 1) as f64 / STROKE_SEGMENTS as f64;
                    let p0 = stroke_perimeter_point(half, half, rw, rh, r, s0);
                    let p1 = stroke_perimeter_point(half, half, rw, rh, r, s1);
                    let drawing = stroke_segment_drawing(
                        p0,
                        p1,
                        half + rw / 2.0,
                        half + rh / 2.0,
                        half,
                    );
                    let offset = if draw_seconds > 0.0 {
                        draw_seconds * stroke_ease_inverse(index as f64 / STROKE_SEGMENTS as f64)
                    } else {
                        0.0
                    };
                    let event_start = start + offset;
                    if event_start >= end {
                        continue;
                    }
                    output.push_str(&format!(
                        "Dialogue: {layer_number},{},{},Motion,,0,0,0,,{{\\an7\\pos({x:.1},{y:.1})\\p1\\c{color}\\alpha&H{alpha:02X}&{tags}}}{drawing}\n",
                        ass_time(event_start),
                        ass_time(end),
                    ));
                }
                continue;
            }
            let content = if kind == "text" {
                let text = escape_text(text_field(&layer, "text").unwrap_or(""));
                if text.is_empty() {
                    continue;
                }
                let align = text_field(&layer, "align").unwrap_or("left");
                let (anchor, pos_x) = match align {
                    "center" => (8, x + width / 2.0),
                    "right" => (9, x + width),
                    _ => (7, x),
                };
                let size = (number(&layer, "fontSizePx").unwrap_or(48.0) * scale).clamp(8.0, 400.0);
                let color = override_color(text_field(&layer, "color").unwrap_or("#ffffff"));
                let bold = if number(&layer, "weight").unwrap_or(400.0) >= 600.0 {
                    1
                } else {
                    0
                };
                let font = font_name(text_field(&layer, "fontFamily").unwrap_or("Segoe UI"));
                // Sombra paralela (`shadow` del plan, paridad `sombra` de
                // faixas.js): `\4c`/`\4a` fijan color y alfa, y `\xshad`/
                // `\yshad` el desplazamiento compuesto por `angleDeg`
                // (90 = abajo). `blurPx` suaviza los bordes con `\be`
                // (blur de bordes ASS — aproximación; también suaviza el
                // texto, no hay pase de sombra separado).
                let mut shadow_tags = String::new();
                if let Some(shadow) = layer.get("shadow") {
                    if let (Some(shadow_color), Some(offset_px)) = (
                        shadow.get("color").and_then(Value::as_str),
                        shadow.get("offsetPx").and_then(Value::as_f64),
                    ) {
                        let distance = (offset_px * scale).clamp(0.0, 200.0);
                        let angle = shadow
                            .get("angleDeg")
                            .and_then(Value::as_f64)
                            .unwrap_or(90.0)
                            .to_radians();
                        let dx = distance * angle.cos();
                        let dy = distance * angle.sin();
                        if distance > 0.0 {
                            let shadow_opacity = shadow
                                .get("opacity")
                                .and_then(Value::as_f64)
                                .unwrap_or(1.0)
                                .clamp(0.0, 1.0);
                            let shadow_alpha =
                                ((1.0 - shadow_opacity) * 255.0).round().clamp(0.0, 255.0) as u8;
                            let blur = (shadow
                                .get("blurPx")
                                .and_then(Value::as_f64)
                                .unwrap_or(0.0)
                                * scale)
                                .clamp(0.0, 64.0);
                            let blur_tag = if blur > 0.05 {
                                format!("\\be{blur:.1}")
                            } else {
                                String::new()
                            };
                            shadow_tags = format!(
                                "\\4c{}\\4a&H{shadow_alpha:02X}&\\xshad{dx:.1}\\yshad{dy:.1}{blur_tag}",
                                override_color(shadow_color)
                            );
                        }
                    }
                }
                // Oblicuidad (`skewXDeg`/`skewYDeg`, paridad del skew de
                // `faixas.js`): `\fax`/`\fay` en grados ASS.
                let skew_x = number(&layer, "skewXDeg").unwrap_or(0.0);
                let skew_y = number(&layer, "skewYDeg").unwrap_or(0.0);
                let mut skew_tags = String::new();
                if skew_x.abs() > 0.01 {
                    skew_tags.push_str(&format!("\\fax{skew_x:.1}"));
                }
                if skew_y.abs() > 0.01 {
                    skew_tags.push_str(&format!("\\fay{skew_y:.1}"));
                }
                format!(
                    "{{\\an{anchor}\\pos({pos_x:.1},{y:.1})\\fn{font}\\fs{size:.1}\\c{color}\\b{bold}{shadow_tags}{skew_tags}{tags}}}{text}"
                )
            } else {
                let color = override_color(text_field(&layer, "color").unwrap_or("#000000"));
                let opacity = number(&layer, "opacity").unwrap_or(1.0).clamp(0.0, 1.0);
                let alpha = ((1.0 - opacity) * 255.0).round().clamp(0.0, 255.0) as u8;
                // `line` es una polilínea abierta: el trazo ES la forma —
                // se dibuja con quads del color/grosor de trazo y sin
                // `\bord` (los segmentos ya son el pincel).
                let is_line = text_field(&layer, "shape") == Some("line");
                let drawing = if is_line {
                    shape_vertices(&layer, width, height, 2)
                        .map(|vertices| {
                            let thickness = (number(&layer, "strokeWidth")
                                .unwrap_or(0.0)
                                * width.min(height))
                            .max(1.0);
                            polyline_drawing(&vertices, thickness)
                        })
                        .unwrap_or_else(|| rect_drawing(width, height))
                } else {
                    match text_field(&layer, "shape") {
                        Some("ellipse") | Some("triangle") | Some("diamond") | Some("star")
                        | Some("pentagon") | Some("hexagon") | Some("arrow")
                        | Some("parallelogram") | Some("trapezoid") | Some("heart")
                        | Some("hand") => {
                            polygon_drawing(
                                text_field(&layer, "shape").unwrap_or("ellipse"),
                                width,
                                height,
                            )
                        }
                        Some("custom") => custom_shape_vertices(&layer, width, height)
                            .map(|vertices| drawing_commands(&vertices))
                            .unwrap_or_else(|| rect_drawing(width, height)),
                        _ => rect_drawing(width, height),
                    }
                };
                // Trazo del borde (`traco` de `formas.js` de AlaukCut):
                // `\bord` fija el grosor en px de PlayRes y `\3c`/`\3a` el
                // color/alfa del contorno. strokeWidth es fracción del lado
                // menor de la capa. En `line` el trazo ES la forma: el color
                // y alfa salen de strokeColor/strokeOpacity y no hay `\bord`.
                let mut stroke_tags = String::new();
                let (fill_color, fill_alpha) = if is_line {
                    (
                        override_color(
                            text_field(&layer, "strokeColor")
                                .or_else(|| text_field(&layer, "color"))
                                .unwrap_or("#000000"),
                        ),
                        ((1.0 - number(&layer, "strokeOpacity")
                            .unwrap_or(opacity))
                            .clamp(0.0, 1.0)
                            * 255.0)
                            .round()
                            .clamp(0.0, 255.0) as u8,
                    )
                } else {
                    (color.clone(), alpha)
                };
                let stroke_width = number(&layer, "strokeWidth").unwrap_or(0.0);
                if !is_line && stroke_width > 0.0 {
                    let px = (stroke_width * width.min(height)).max(0.5);
                    let stroke_color = override_color(
                        text_field(&layer, "strokeColor").unwrap_or("#ffffff"),
                    );
                    let stroke_opacity =
                        number(&layer, "strokeOpacity").unwrap_or(1.0).clamp(0.0, 1.0);
                    let stroke_alpha =
                        ((1.0 - stroke_opacity) * 255.0).round().clamp(0.0, 255.0) as u8;
                    stroke_tags = format!(
                        "\\bord{px:.1}\\3c{stroke_color}\\3a&H{stroke_alpha:02X}&"
                    );
                }
                // Sombra paralela (`sombra` de `formas.js`): `\4c`/`\4a`
                // fijan color y alfa, y `\xshad`/`\yshad` el desplazamiento
                // compuesto por `angleDeg`. `blurPx` suaviza con `\be`
                // (misma aproximación que la capa de texto).
                let mut shadow_tags = String::new();
                if let Some(shadow) = layer.get("shadow") {
                    if let (Some(shadow_color), Some(offset_px)) = (
                        shadow.get("color").and_then(Value::as_str),
                        shadow.get("offsetPx").and_then(Value::as_f64),
                    ) {
                        let distance = (offset_px * scale).clamp(0.0, 200.0);
                        // angleDeg con y hacia abajo: 90 = recto abajo,
                        // 0 = derecha, 180 = izquierda, -90/270 = arriba.
                        let angle = shadow
                            .get("angleDeg")
                            .and_then(Value::as_f64)
                            .unwrap_or(90.0)
                            .to_radians();
                        let dx = distance * angle.cos();
                        let dy = distance * angle.sin();
                        if distance > 0.0 {
                            let shadow_opacity = shadow
                                .get("opacity")
                                .and_then(Value::as_f64)
                                .unwrap_or(1.0)
                                .clamp(0.0, 1.0);
                            let shadow_alpha =
                                ((1.0 - shadow_opacity) * 255.0).round().clamp(0.0, 255.0) as u8;
                            let blur = (shadow
                                .get("blurPx")
                                .and_then(Value::as_f64)
                                .unwrap_or(0.0)
                                * scale)
                                .clamp(0.0, 64.0);
                            let blur_tag = if blur > 0.05 {
                                format!("\\be{blur:.1}")
                            } else {
                                String::new()
                            };
                            shadow_tags = format!(
                                "\\4c{}\\4a&H{shadow_alpha:02X}&\\xshad{dx:.1}\\yshad{dy:.1}{blur_tag}",
                                override_color(shadow_color)
                            );
                        }
                    }
                }
                format!(
                    "{{\\an7\\pos({x:.1},{y:.1})\\p1\\c{fill_color}\\alpha&H{fill_alpha:02X}&{stroke_tags}{shadow_tags}{tags}}}{drawing}"
                )
            };
            output.push_str(&format!(
                "Dialogue: {layer_number},{},{},Motion,,0,0,0,,{}\n",
                ass_time(start),
                ass_time(end),
                content
            ));
        }
    }

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project_with_graphic() -> Value {
        json!({
            "timeline": {
                "tracks": [
                    {"id": "g", "kind": "graphic", "label": "G1", "order": 0, "muted": false, "hidden": false, "locked": false}
                ],
                "clips": [
                    {"id": "clip-g", "trackId": "g", "kind": "graphic", "startFrame": 0, "durationFrames": 60, "source": {"type": "graphic", "motionId": "m"}}
                ]
            }
        })
    }

    fn plans() -> Value {
        json!({
            "clip-g": {
                "version": 1,
                "width": 1920,
                "height": 1080,
                "fps": {"num": 30, "den": 1},
                "durationFrames": 60,
                "layers": [
                    {"kind": "rect", "x": 0.1, "y": 0.7, "width": 0.5, "height": 0.15, "color": "#0f172a", "opacity": 0.9, "animation": {"kind": "fade", "inFrames": 10}},
                    {"kind": "text", "x": 0.12, "y": 0.72, "width": 0.4, "height": 0.08, "text": "Ana {Editora}", "fontFamily": "Segoe UI", "fontSizePx": 48, "weight": 700, "color": "#ffffff", "align": "left", "animation": {"kind": "slide-up", "inFrames": 10, "distance": 0.04}}
                ]
            }
        })
    }

    fn input<'a>(project: &'a Value, plans: &'a Value) -> MotionAssInput<'a> {
        MotionAssInput {
            project,
            plans,
            render_width: 1920,
            render_height: 1080,
            project_width: 1920,
            project_height: 1080,
            project_fps: 30.0,
        }
    }

    #[test]
    fn generates_escaped_text_and_animation_events() {
        let project = project_with_graphic();
        let plans = plans();
        let ass = build_motion_ass(input(&project, &plans)).expect("ass");
        assert!(ass.contains("Ana  Editora"));
        assert!(ass.contains("\\fad("));
        assert!(ass.contains("\\move("));
        assert!(ass.contains("Dialogue: 0,"));
    }

    #[test]
    fn write_animation_emits_an_animated_clip() {
        // «Se escribe» (`maozinha`/`marca_texto`): el borde derecho del
        // `\clip` de la capa crece durante la entrada.
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][1]["animation"] = json!({"kind": "write", "inFrames": 30});
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        assert!(ass.contains("\\clip("));
        assert!(ass.contains("\\t(0,1000,\\clip("));
    }

    #[test]
    fn wipe_animation_reveals_rect_layers_too() {
        // «Barrido» (`faixas.js` clip-paths de entrada): el `\clip`
        // animado aplica también a capas de dibujo, no sólo a texto.
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["animation"] = json!({"kind": "wipe", "inFrames": 15});
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        assert!(ass.contains("\\clip("));
        assert!(ass.contains("\\t(0,500,\\clip("));
    }

    #[test]
    fn back_animation_emits_a_two_stage_scale() {
        // easeOutBack: la escala va 60 → pico (~104) → 100 con dos `\t`.
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["animation"] = json!({"kind": "back", "inFrames": 30});
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        assert!(ass.contains("\\fscx60\\fscy60"));
        assert!(ass.contains("\\fscx100\\fscy100"));
        // Pico intermedio ~104 (easeOutBack(0.58) ≈ 1.10 → escala 104).
        assert!(ass.contains("\\fscx104\\fscy104"));
    }

    #[test]
    fn rejects_a_missing_plan() {
        let project = project_with_graphic();
        let error = build_motion_ass(input(&project, &json!({}))).expect_err("error");
        assert_eq!(error.code, ProjectErrorCode::RenderFailed);
        assert!(error.message.contains("plan de motion"));
    }

    #[test]
    fn rejects_invalid_layers() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][1]["color"] = json!("rojo");
        let error = build_motion_ass(input(&project, &plan)).expect_err("error");
        assert!(error.message.contains("color"));
    }

    #[test]
    fn ellipse_shape_draws_a_polygon_instead_of_a_rect() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["shape"] = json!("ellipse");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        // Polígono de 32 lados: 1 moveto + 31 líneas + cierre = 33 comandos.
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        // 1 moveto + 32 líneas (31 vértices + cierre al primero).
        assert!(drawing.contains("m "));
        assert_eq!(drawing.matches(" l ").count(), 32);
    }

    #[test]
    fn rect_layer_emits_ass_stroke_tags() {
        let project = project_with_graphic();
        let mut plan = plans();
        // Capa rect: w=0.5,h=0.15 de 1920 → min side = 162 px.
        // strokeWidth 0.1 → 16.2 px de borde.
        plan["clip-g"]["layers"][0]["strokeColor"] = json!("#ff0000");
        plan["clip-g"]["layers"][0]["strokeWidth"] = json!(0.1);
        plan["clip-g"]["layers"][0]["strokeOpacity"] = json!(0.5);
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert!(drawing.contains("\\bord16.2"), "{drawing}");
        assert!(drawing.contains("\\3c"), "{drawing}");
        assert!(drawing.contains("\\3a&H80&"), "{drawing}");
    }

    #[test]
    fn line_shape_draws_open_polyline_with_stroke_color() {
        let project = project_with_graphic();
        let mut plan = plans();
        // Capa rect: w=0.5,h=0.15 de 1920x1080 → 960x162 px; min side 162.
        plan["clip-g"]["layers"][0]["shape"] = json!("line");
        plan["clip-g"]["layers"][0]["points"] = json!([
            {"x": 0.1, "y": 0.5},
            {"x": 0.9, "y": 0.5},
            {"x": 0.9, "y": 0.9}
        ]);
        plan["clip-g"]["layers"][0]["strokeColor"] = json!("#00ff00");
        plan["clip-g"]["layers"][0]["strokeWidth"] = json!(0.1);
        plan["clip-g"]["layers"][0]["strokeOpacity"] = json!(1.0);
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        // Dos segmentos → dos subpaths "m"; sin \bord (los quads son el trazo).
        assert_eq!(drawing.matches("m ").count(), 2, "{drawing}");
        assert!(!drawing.contains("\\bord"), "{drawing}");
        // Color de trazo como fill de los quads.
        assert!(drawing.contains("\\c"), "{drawing}");
    }

    #[test]
    fn rect_layer_emits_shadow_tags() {
        let project = project_with_graphic();
        let mut plan = plans();
        // offsetPx=20 en proyecto 1920 → scale 1 → \yshad20.
        plan["clip-g"]["layers"][0]["shadow"] = json!({
            "color": "#112233",
            "offsetPx": 20.0
        });
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert!(drawing.contains("\\4c"), "{drawing}");
        // Sin angleDeg → default 90° (recto abajo): dy = offset.
        assert!(drawing.contains("\\xshad0.0\\yshad20.0"), "{drawing}");
        // angleDeg=0 → recto a la derecha; opacity=0.5 → \4a&H80&.
        plan["clip-g"]["layers"][0]["shadow"] = json!({
            "color": "#112233",
            "offsetPx": 20.0,
            "angleDeg": 0.0,
            "opacity": 0.5
        });
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert!(drawing.contains("\\4a&H80&"), "{drawing}");
        assert!(drawing.contains("\\xshad20.0\\yshad0.0"), "{drawing}");
    }

    #[test]
    fn shadow_blur_emits_be_tag_on_text_and_drawing() {
        let project = project_with_graphic();
        let mut plan = plans();
        // blurPx=12 con scale=1 → \be12.0; el tag sigue al \yshad.
        plan["clip-g"]["layers"][0]["shadow"] = json!({
            "color": "#112233",
            "offsetPx": 20.0,
            "blurPx": 12.0
        });
        plan["clip-g"]["layers"][1]["shadow"] = json!({
            "color": "#112233",
            "offsetPx": 8.0,
            "blurPx": 12.0
        });
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert!(drawing.contains("\\yshad20.0\\be12.0"), "{drawing}");
        let text = ass
            .lines()
            .find(|line| line.contains("Ana"))
            .expect("texto");
        assert!(text.contains("\\yshad8.0\\be12.0"), "{text}");
        // Sin blurPx no se emite \be.
        plan["clip-g"]["layers"][1]["shadow"] = json!({
            "color": "#112233",
            "offsetPx": 8.0
        });
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let text = ass
            .lines()
            .find(|line| line.contains("Ana"))
            .expect("texto");
        assert!(!text.contains("\\be"), "{text}");
    }

    #[test]
    fn text_layer_emits_skew_tags() {
        let project = project_with_graphic();
        let mut plan = plans();
        // skewXDeg=14 → \fax14.0; skewYDeg=5 → \fay5.0 en el Dialogue.
        plan["clip-g"]["layers"][1]["skewXDeg"] = json!(14.0);
        plan["clip-g"]["layers"][1]["skewYDeg"] = json!(5.0);
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let text = ass
            .lines()
            .find(|line| line.contains("Ana"))
            .expect("texto");
        assert!(text.contains("\\fax14.0"), "{text}");
        assert!(text.contains("\\fay5.0"), "{text}");
        // Sin skew no se emiten tags de oblicuidad.
        let ass = build_motion_ass(input(&project, &plans())).expect("ass");
        let text = ass
            .lines()
            .find(|line| line.contains("Ana"))
            .expect("texto");
        assert!(!text.contains("\\fax") && !text.contains("\\fay"), "{text}");
    }

    #[test]
    fn rejects_invalid_shadow_offset() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["shadow"] = json!({
            "color": "#112233",
            "offsetPx": -5.0
        });
        let error = build_motion_ass(input(&project, &plan)).expect_err("error");
        assert!(error.message.contains("offsetPx"));
    }

    #[test]
    fn line_shape_rejects_single_point() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["shape"] = json!("line");
        plan["clip-g"]["layers"][0]["points"] = json!([{"x": 0.5, "y": 0.5}]);
        let error = build_motion_ass(input(&project, &plan)).expect_err("error");
        assert!(error.message.contains("puntos"));
    }

    #[test]
    fn rejects_invalid_stroke_width() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["strokeWidth"] = json!(0.9);
        let error = build_motion_ass(input(&project, &plan)).expect_err("error");
        assert!(error.message.contains("strokeWidth"));
    }

    #[test]
    fn triangle_and_diamond_draw_their_own_polygons() {
        let project = project_with_graphic();
        let mut plan = plans();
        // Capa rect: x=0.1,y=0.7,w=0.5,h=0.15 de 1920x1080 → 960x162 px.
        plan["clip-g"]["layers"][0]["shape"] = json!("triangle");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 3);
        assert!(drawing.contains("m 480.0 0.0 l 960.0 162.0 l 0.0 162.0"));

        plan["clip-g"]["layers"][0]["shape"] = json!("diamond");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 4);
        assert!(drawing.contains("m 480.0 0.0 l 960.0 81.0 l 480.0 162.0 l 0.0 81.0"));

        plan["clip-g"]["layers"][0]["shape"] = json!("star");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        // 10 vértices + cierre.
        assert_eq!(drawing.matches(" l ").count(), 10);
        // Primera punta arriba al centro (480, 0).
        assert!(drawing.contains("}m 480.0 0.0"));

        plan["clip-g"]["layers"][0]["shape"] = json!("pentagon");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 5);

        plan["clip-g"]["layers"][0]["shape"] = json!("hexagon");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 6);

        plan["clip-g"]["layers"][0]["shape"] = json!("arrow");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 7);
        assert!(drawing.contains("}m 480.0 0.0"));

        // `formas.js` de AlaukCut: paralelogramo, trapecio y corazón.
        plan["clip-g"]["layers"][0]["shape"] = json!("parallelogram");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 4);
        assert!(drawing.contains("m 211.2 0.0 l 960.0 0.0 l 748.8 162.0 l 0.0 162.0"));

        plan["clip-g"]["layers"][0]["shape"] = json!("trapezoid");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 4);
        assert!(drawing.contains("m 240.0 0.0 l 720.0 0.0 l 960.0 162.0 l 0.0 162.0"));

        plan["clip-g"]["layers"][0]["shape"] = json!("heart");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        // 18 vértices muestreados de la curva implícita, cúspide abajo.
        assert_eq!(drawing.matches(" l ").count(), 18);
        // Primer punto: (0.5, 0.5-0.72*0.52) de la caja → arriba-centro.
        assert!(drawing.contains("}m 480.0 20.3"));

        // Mano señalando a la derecha (`maozinha`): 16 vértices 0..1.
        plan["clip-g"]["layers"][0]["shape"] = json!("hand");
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        assert_eq!(drawing.matches(" l ").count(), 16);
        // Primer punto (0.98, 0.16) de la caja de 960×162 → punta del índice.
        assert!(drawing.contains("}m 940.8 25.9"));
    }

    #[test]
    fn rejects_unknown_shape() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["shape"] = json!("circle");
        let error = build_motion_ass(input(&project, &plan)).expect_err("error");
        assert!(error.message.contains("forma"));
    }

    #[test]
    fn custom_shape_draws_its_own_points() {
        let project = project_with_graphic();
        let mut plan = plans();
        // Capa rect: x=0.1,y=0.7,w=0.5,h=0.15 de 1920x1080 → 960x162 px.
        plan["clip-g"]["layers"][0]["shape"] = json!("custom");
        plan["clip-g"]["layers"][0]["points"] = json!([
            { "x": 0.0, "y": 0.0 },
            { "x": 1.0, "y": 0.0 },
            { "x": 0.5, "y": 1.0 }
        ]);
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let drawing = ass
            .lines()
            .find(|line| line.contains("\\p1"))
            .expect("dibujo");
        // 3 vértices + cierre al primero.
        assert_eq!(drawing.matches(" l ").count(), 3);
        assert!(drawing.contains("}m 0.0 0.0 l 960.0 0.0 l 480.0 162.0 l 0.0 0.0"));
    }

    #[test]
    fn custom_shape_requires_valid_points() {
        let project = project_with_graphic();
        for points in [
            json!([]),
            json!([{ "x": 0.0, "y": 0.0 }, { "x": 1.0, "y": 0.0 }]),
            json!([{ "x": -0.1, "y": 0.0 }, { "x": 1.0, "y": 0.0 }, { "x": 0.5, "y": 1.0 }]),
            json!([{ "x": 0.0 }, { "x": 1.0, "y": 0.0 }, { "x": 0.5, "y": 1.0 }]),
        ] {
            let mut plan = plans();
            plan["clip-g"]["layers"][0]["shape"] = json!("custom");
            plan["clip-g"]["layers"][0]["points"] = points;
            let error = build_motion_ass(input(&project, &plan)).expect_err("error");
            assert!(error.message.contains("puntos"), "{}", error.message);
        }
        // Sin points directamente también falla.
        let mut plan = plans();
        plan["clip-g"]["layers"][0]["shape"] = json!("custom");
        let error = build_motion_ass(input(&project, &plan)).expect_err("error");
        assert!(error.message.contains("puntos"));
    }

    #[test]
    fn text_shadow_emits_shadow_color_and_vertical_offset() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"][1]["shadow"] =
            json!({"color": "#000000", "offsetPx": 8});
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        assert!(ass.contains("\\4c"), "ass: {ass}");
        assert!(ass.contains("\\xshad0"), "ass: {ass}");
        assert!(ass.contains("\\yshad"), "ass: {ass}");
        // Sin opacidad explícita el alfa es opaco (\4a&H00&).
        assert!(ass.contains("\\4a&H00&"), "ass: {ass}");
        // Sin el campo no hay tags de sombra.
        let clean = build_motion_ass(input(&project, &plans())).expect("ass");
        assert!(!clean.contains("\\4c"), "ass: {clean}");
        assert!(!clean.contains("\\yshad"), "ass: {clean}");
    }

    #[test]
    fn text_shadow_emits_angle_and_alpha_tags() {
        let project = project_with_graphic();
        let mut plan = plans();
        // angleDeg=0 → recto a la derecha; opacity=0.5 → \4a&H80&.
        plan["clip-g"]["layers"][1]["shadow"] = json!({
            "color": "#123456",
            "offsetPx": 10,
            "angleDeg": 0,
            "opacity": 0.5
        });
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        assert!(ass.contains("\\4a&H80&"), "ass: {ass}");
        assert!(ass.contains("\\xshad"), "ass: {ass}");
        // El desplazamiento horizontal no es cero con ángulo 0.
        assert!(!ass.contains("\\xshad0.0"), "ass: {ass}");
    }

    #[test]
    fn skips_hidden_graphic_tracks() {
        let mut project = project_with_graphic();
        project["timeline"]["tracks"][0]["hidden"] = json!(true);
        let ass = build_motion_ass(input(&project, &plans())).expect("ass");
        assert!(ass.is_empty());
    }
}

#[cfg(test)]
mod stroke_tests {
    use super::*;
    use serde_json::json;

    fn project_with_graphic() -> Value {
        json!({
            "timeline": {
                "tracks": [
                    {"id": "g", "kind": "graphic", "label": "G1", "order": 0, "muted": false, "hidden": false, "locked": false}
                ],
                "clips": [
                    {"id": "clip-g", "trackId": "g", "kind": "graphic", "startFrame": 0, "durationFrames": 60, "source": {"type": "graphic", "motionId": "m"}}
                ]
            }
        })
    }

    fn plans() -> Value {
        json!({
            "clip-g": {
                "version": 1,
                "width": 1920,
                "height": 1080,
                "fps": {"num": 30, "den": 1},
                "durationFrames": 60,
                "layers": []
            }
        })
    }

    fn input<'a>(project: &'a Value, plans: &'a Value) -> MotionAssInput<'a> {
        MotionAssInput {
            project,
            plans,
            render_width: 1920,
            render_height: 1080,
            project_width: 1920,
            project_height: 1080,
            project_fps: 30.0,
        }
    }

    #[test]
    fn stroke_layer_emits_segmented_draw_on_events() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"] = json!([
            {"kind": "stroke", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0,
             "color": "#ff2233", "opacity": 0.96, "thickness": 0.02,
             "radius": 0.12, "drawSeconds": 0.8, "animation": {"kind": "none"}}
        ]);
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let dialogues: Vec<&str> = ass
            .lines()
            .filter(|line| line.starts_with("Dialogue:"))
            .collect();
        // 40 segmentos, todos dentro de la duración del clip (2 s a 30 fps).
        assert_eq!(dialogues.len(), STROKE_SEGMENTS);
        // Empiezan escalonados: el primero en t=0, el último ~0.72 s después
        // (easing coseno: el tramo 39/40 aparece al 90 % del tiempo de trazo).
        let first = dialogues[0];
        let last = dialogues[dialogues.len() - 1];
        assert!(first.contains("0:00:00.00"));
        assert!(!last.contains("0:00:00.00"));
        // Cada evento dibuja un quad (5 líneas + cierre).
        assert!(first.contains("m "));
        assert!(first.contains("l "));
        assert!(first.contains(r"\p1"));
    }

    #[test]
    fn stroke_layer_with_zero_draw_seconds_starts_all_at_once() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"] = json!([
            {"kind": "stroke", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0,
             "color": "#ff2233", "opacity": 0.96, "thickness": 0.02,
             "radius": 0.12, "drawSeconds": 0.0, "animation": {"kind": "none"}}
        ]);
        let ass = build_motion_ass(input(&project, &plan)).expect("ass");
        let dialogues: Vec<&str> = ass
            .lines()
            .filter(|line| line.starts_with("Dialogue:"))
            .collect();
        assert_eq!(dialogues.len(), STROKE_SEGMENTS);
        assert!(dialogues.iter().all(|d| d.contains("0:00:00.00")));
    }

    #[test]
    fn stroke_layer_rejects_bad_thickness() {
        let project = project_with_graphic();
        let mut plan = plans();
        plan["clip-g"]["layers"] = json!([
            {"kind": "stroke", "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0,
             "color": "#ff2233", "opacity": 0.96, "thickness": 5.0,
             "radius": 0.12, "drawSeconds": 0.8, "animation": {"kind": "none"}}
        ]);
        let error = build_motion_ass(input(&project, &plan)).expect_err("error");
        assert!(error.message.contains("thickness"));
    }
}
