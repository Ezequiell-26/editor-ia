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
    if !matches!(kind, "none" | "fade" | "slide-up" | "slide-left" | "pop") {
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
                            | "custom"
                    ) {
                        return Err(fail(format!("{label}: forma inválida")));
                    }
                    if shape == "custom" {
                        let valid =
                            layer
                                .get("points")
                                .and_then(Value::as_array)
                                .is_some_and(|points| {
                                    (3..=16).contains(&points.len())
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
                                "{label}: la forma personalizada necesita 3-16 puntos con x/y entre 0 y 1"
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
    let points = layer.get("points")?.as_array()?;
    if points.len() < 3 || points.len() > 16 {
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

fn rect_drawing(width: f64, height: f64) -> String {
    format!("m 0 0 l {width:.1} 0 {width:.1} {height:.1} 0 {height:.1} l 0 0{{\\p0}}")
}

/// Dibujo `\p1` de las formas del titler. ASS no tiene curvas: la elipse se
/// aproxima con 32 lados y triángulo/rombo son polúgonos regulares inscriptos
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
                format!(
                    "{{\\an{anchor}\\pos({pos_x:.1},{y:.1})\\fn{font}\\fs{size:.1}\\c{color}\\b{bold}{tags}}}{text}"
                )
            } else {
                let color = override_color(text_field(&layer, "color").unwrap_or("#000000"));
                let opacity = number(&layer, "opacity").unwrap_or(1.0).clamp(0.0, 1.0);
                let alpha = ((1.0 - opacity) * 255.0).round().clamp(0.0, 255.0) as u8;
                let drawing = match text_field(&layer, "shape") {
                    Some("ellipse") | Some("triangle") | Some("diamond") | Some("star")
                    | Some("pentagon") | Some("hexagon") | Some("arrow") => polygon_drawing(
                        text_field(&layer, "shape").unwrap_or("ellipse"),
                        width,
                        height,
                    ),
                    Some("custom") => custom_shape_vertices(&layer, width, height)
                        .map(|vertices| drawing_commands(&vertices))
                        .unwrap_or_else(|| rect_drawing(width, height)),
                    _ => rect_drawing(width, height),
                };
                format!(
                    "{{\\an7\\pos({x:.1},{y:.1})\\p1\\c{color}\\alpha&H{alpha:02X}&{tags}}}{drawing}"
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
    fn skips_hidden_graphic_tracks() {
        let mut project = project_with_graphic();
        project["timeline"]["tracks"][0]["hidden"] = json!(true);
        let ass = build_motion_ass(input(&project, &plans())).expect("ass");
        assert!(ass.is_empty());
    }
}
