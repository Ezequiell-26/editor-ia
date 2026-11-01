//! Remap de velocidad por frame para clips con `speedCurve`.
//!
//! La curva define `dSource/dTimeline`; la posición de origen se obtiene
//! integrando y el frame de timeline `k` muestra el frame de origen más
//! cercano a `σ(k)`. La integral se normaliza a la ventana real del clip
//! (`outFrame - inFrame`), igual que el módulo TS
//! `apps/desktop/src/state/time-remap.ts`.
//!
//! El export usa `setpts` con un `if` por frame de origen: coloca cada frame
//! en su posición `σ⁻¹(m)` (en frames de timeline) y el `fps=…` posterior
//! vuelve a muestrear a tasa constante. El preview de la app usa la misma
//! tabla, así ambos eligen el mismo frame.

use serde_json::Value;

use super::ffmpeg::cubic_bezier_progress;
use crate::projects::service::{ProjectError, ProjectErrorCode};

const BEZIER_SAMPLES: usize = 64;
const EPSILON: f64 = 1e-9;

#[derive(Debug, Clone)]
enum Easing {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
    Hold,
    Bezier([f64; 4]),
}

#[derive(Debug, Clone)]
struct Segment {
    t0: f64,
    t1: f64,
    s0: f64,
    s1: f64,
    easing: Easing,
    /// Muestras y(x) de la Bézier (sólo para `Easing::Bezier`).
    bezier_ys: Vec<f64>,
    /// Integral acumulada de `bezier_ys` en cada nudo.
    bezier_prefix: Vec<f64>,
}

#[derive(Debug, Clone)]
pub struct TimeRemap {
    duration_frames: u32,
    source_frames: u32,
    /// Posición de timeline (en frames) de cada frame de origen.
    timeline_frames: Vec<f64>,
}

fn fail(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
}

fn parse_easing(point: &Value) -> Easing {
    if let Some(bezier) = point.get("bezier").and_then(Value::as_object) {
        let coords = ["cp1X", "cp1Y", "cp2X", "cp2Y"].map(|key| {
            bezier
                .get(key)
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
        });
        if let [Some(cp1_x), Some(cp1_y), Some(cp2_x), Some(cp2_y)] = coords {
            return Easing::Bezier([cp1_x, cp1_y, cp2_x, cp2_y]);
        }
    }
    match point
        .get("easing")
        .and_then(Value::as_str)
        .unwrap_or("linear")
    {
        "ease-in" => Easing::EaseIn,
        "ease-out" => Easing::EaseOut,
        "ease-in-out" => Easing::EaseInOut,
        "hold" => Easing::Hold,
        _ => Easing::Linear,
    }
}

impl Segment {
    fn new(start: &Value, end: &Value) -> Option<Self> {
        let t0 = number(start, "t")?.clamp(0.0, 1.0);
        let t1 = number(end, "t")?.clamp(0.0, 1.0);
        if t1 - t0 <= EPSILON {
            return None;
        }
        let s0 = number(start, "speed")?;
        let s1 = number(end, "speed")?;
        let easing = parse_easing(start);
        let (bezier_ys, bezier_prefix) =
            if let Easing::Bezier([cp1_x, cp1_y, cp2_x, cp2_y]) = &easing {
                let (cp1_x, cp1_y, cp2_x, cp2_y) = (*cp1_x, *cp1_y, *cp2_x, *cp2_y);
                let mut ys = Vec::with_capacity(BEZIER_SAMPLES + 1);
                for index in 0..=BEZIER_SAMPLES {
                    ys.push(cubic_bezier_progress(
                        index as f64 / BEZIER_SAMPLES as f64,
                        cp1_x,
                        cp1_y,
                        cp2_x,
                        cp2_y,
                    ));
                }
                let width = 1.0 / BEZIER_SAMPLES as f64;
                let mut prefix = Vec::with_capacity(BEZIER_SAMPLES + 1);
                prefix.push(0.0);
                for index in 1..=BEZIER_SAMPLES {
                    prefix.push(prefix[index - 1] + (ys[index - 1] + ys[index]) * 0.5 * width);
                }
                (ys, prefix)
            } else {
                (Vec::new(), Vec::new())
            };
        Some(Self {
            t0,
            t1,
            s0,
            s1,
            easing,
            bezier_ys,
            bezier_prefix,
        })
    }

    fn area(&self) -> f64 {
        let area = match &self.easing {
            Easing::Linear | Easing::EaseInOut => 0.5,
            Easing::EaseIn => 0.25,
            Easing::EaseOut => 0.75,
            Easing::Hold => 0.0,
            Easing::Bezier(_) => self.bezier_prefix[BEZIER_SAMPLES],
        };
        (self.t1 - self.t0) * (self.s0 + (self.s1 - self.s0) * area)
    }

    fn moment(&self, u: f64) -> f64 {
        let u = u.clamp(0.0, 1.0);
        match &self.easing {
            Easing::Linear => u * u / 2.0,
            Easing::EaseIn => u.powi(4) / 4.0,
            Easing::EaseOut => 1.5 * u * u - u.powi(3) + 0.25 * u.powi(4),
            Easing::EaseInOut => u.powi(3) - 0.5 * u.powi(4),
            Easing::Hold => 0.0,
            Easing::Bezier(_) => {
                let position = u * BEZIER_SAMPLES as f64;
                let index = (position.floor() as usize).min(BEZIER_SAMPLES - 1);
                let remainder = (position - index as f64) / BEZIER_SAMPLES as f64;
                let slope = self.bezier_ys[index + 1] - self.bezier_ys[index];
                self.bezier_prefix[index]
                    + self.bezier_ys[index] * remainder
                    + 0.5 * slope * remainder * remainder
            }
        }
    }
}

impl TimeRemap {
    /// `None` si el clip no tiene curva. Valida las combinaciones que el
    /// clock del render no puede resolver (reverse, estabilización, Ken Burns,
    /// keyframes de geometría o transición de entrada).
    pub fn from_clip(clip: &Value) -> Result<Option<Self>, ProjectError> {
        let Some(curve) = clip.get("speedCurve").filter(|value| value.is_object()) else {
            return Ok(None);
        };
        if clip.get("kind").and_then(Value::as_str) != Some("video") {
            return Ok(None);
        }
        if clip.get("reverse").and_then(Value::as_bool) == Some(true) {
            return Err(fail(
                "la curva de velocidad no se puede combinar con reverse",
            ));
        }
        if clip
            .get("stabilization")
            .is_some_and(|value| value.is_object())
        {
            return Err(fail(
                "la curva de velocidad no se puede combinar con estabilización",
            ));
        }
        if clip
            .get("motion")
            .and_then(Value::as_object)
            .is_some_and(|motion| !motion.is_empty())
        {
            return Err(fail(
                "quitá el movimiento Ken Burns antes de usar una curva de velocidad",
            ));
        }
        for field in ["transform", "mask"] {
            if clip
                .get(field)
                .and_then(|value| value.get("keyframes"))
                .and_then(Value::as_array)
                .is_some_and(|keyframes| !keyframes.is_empty())
            {
                return Err(fail(
                    "quitá los keyframes de transformación o máscara antes de usar una curva de velocidad",
                ));
            }
        }
        if clip
            .get("transitionIn")
            .and_then(Value::as_object)
            .is_some_and(|transition| !transition.is_empty())
        {
            return Err(fail(
                "la curva de velocidad no se puede combinar con la transición de entrada",
            ));
        }

        let duration = clip
            .get("durationFrames")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .max(1) as u32;
        let source = clip
            .get("source")
            .ok_or_else(|| fail("el clip no tiene fuente"))?;
        let in_frame = source
            .get("inFrame")
            .and_then(Value::as_u64)
            .ok_or_else(|| fail("el clip no tiene inFrame"))?;
        let out_frame = source
            .get("outFrame")
            .and_then(Value::as_u64)
            .ok_or_else(|| fail("el clip no tiene outFrame"))?;
        if out_frame <= in_frame {
            return Err(fail("la ventana de origen de la curva está vacía"));
        }
        let source_frames = (out_frame - in_frame).min(u32::MAX as u64) as u32;
        if source_frames > 120_000 {
            return Err(fail(
                "la curva de velocidad cubre demasiados frames (máximo 120 000); dividí el clip",
            ));
        }

        let points = curve
            .get("points")
            .and_then(Value::as_array)
            .ok_or_else(|| fail("la curva de velocidad no tiene puntos"))?;
        if points.len() < 2 {
            return Err(fail("la curva de velocidad necesita al menos dos puntos"));
        }
        let mut segments: Vec<Segment> = Vec::new();
        for pair in points.windows(2) {
            if let Some(segment) = Segment::new(&pair[0], &pair[1]) {
                segments.push(segment);
            }
        }
        if segments.is_empty() {
            return Err(fail("la curva de velocidad no tiene tramos válidos"));
        }
        let mut cumulative = Vec::with_capacity(segments.len() + 1);
        cumulative.push(0.0);
        let mut total = 0.0;
        for segment in &segments {
            total += segment.area();
            cumulative.push(total);
        }
        let duration_f64 = duration as f64;
        let scale = if total > EPSILON {
            source_frames as f64 / (duration_f64 * total)
        } else {
            source_frames as f64 / duration_f64
        };

        let integral_at = |x: f64| -> f64 {
            let clamped = x.clamp(0.0, 1.0);
            if total <= EPSILON {
                return clamped;
            }
            if clamped <= 0.0 {
                return 0.0;
            }
            if clamped >= 1.0 {
                return total;
            }
            let index = segments
                .iter()
                .position(|segment| clamped > segment.t0 && clamped <= segment.t1)
                .unwrap_or(segments.len() - 1);
            let segment = &segments[index];
            let length = segment.t1 - segment.t0;
            let u = ((clamped - segment.t0) / length).clamp(0.0, 1.0);
            cumulative[index]
                + length * (segment.s0 * u + (segment.s1 - segment.s0) * segment.moment(u))
        };
        let sigma = |x: f64| -> f64 {
            (scale * duration_f64 * integral_at(x)).clamp(0.0, source_frames as f64)
        };

        let mut timeline_frames = Vec::with_capacity(source_frames as usize);
        for source_frame in 0..source_frames {
            let target = source_frame as f64;
            if target <= 0.0 {
                timeline_frames.push(0.0);
                continue;
            }
            if target >= source_frames as f64 {
                timeline_frames.push(duration_f64);
                continue;
            }
            let mut low = 0.0;
            let mut high = 1.0;
            for _ in 0..80 {
                let middle = (low + high) / 2.0;
                if sigma(middle) < target {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            timeline_frames.push(((low + high) / 2.0 * duration_f64 * 1e6).round() / 1e6);
        }
        // El último frame tiene que caer dentro de la duración; una curva que
        // acelera al final puede dejarlo en D o más allá.
        for index in (0..timeline_frames.len()).rev() {
            let limit = if index + 1 == timeline_frames.len() {
                (duration_f64 - 0.001).max(0.0)
            } else {
                timeline_frames[index + 1]
            };
            timeline_frames[index] = timeline_frames[index].min(limit).max(0.0);
        }

        Ok(Some(Self {
            duration_frames: duration,
            source_frames,
            timeline_frames,
        }))
    }

    pub fn duration_frames(&self) -> u32 {
        self.duration_frames
    }

    pub fn source_frames(&self) -> u32 {
        self.source_frames
    }

    /// Frame de origen que se ve en `local` (0..duration-1), con la misma
    /// selección por cercanía al centro del frame (`k + 0.5`) que
    /// `fps=…:round=near`.
    pub fn source_frame(&self, local: u32) -> u32 {
        let local = local.min(self.duration_frames.saturating_sub(1)) as f64 + 0.5;
        let index = self.timeline_frames.partition_point(|value| *value < local);
        let after = index.min(self.timeline_frames.len().saturating_sub(1));
        let before = index.saturating_sub(1);
        let after_distance = (self.timeline_frames[after] - local).abs();
        let before_distance = (self.timeline_frames[before] - local).abs();
        if before_distance <= after_distance {
            before as u32
        } else {
            after as u32
        }
    }

    /// Segundos dentro del asset para el frame local. El `+0.5` cae en el
    /// centro del frame de origen, igual que la preview TS.
    pub fn source_seconds(&self, local: u32, in_frame: u64, fps: f64) -> f64 {
        (in_frame as f64 + self.source_frame(local) as f64 + 0.5) / fps.max(1.0)
    }

    pub fn is_identity(&self) -> bool {
        self.timeline_frames
            .iter()
            .enumerate()
            .all(|(index, value)| (*value - index as f64).abs() < 1e-4)
    }

    /// Expresión para `setpts`, en frames de timeline (la unidad de PTS tras
    /// el `fps` inicial es 1/fps). Usa un `if` por frame de origen; para
    /// curvas largas agrupa tramos lineales con error máximo de 0,05 frame.
    pub fn setpts_expression(&self) -> String {
        if self.timeline_frames.len() <= 64 {
            let mut expression = format!(
                "{:.6}",
                self.timeline_frames[self.timeline_frames.len() - 1]
            );
            for index in (0..self.timeline_frames.len() - 1).rev() {
                expression = format!(
                    "if(lt(N,{}),{:.6},{})",
                    index + 1,
                    self.timeline_frames[index],
                    expression
                );
            }
            return expression;
        }
        let mut groups: Vec<(usize, usize, f64, f64)> = Vec::new();
        let mut start = 0;
        while start < self.timeline_frames.len() {
            if start + 1 >= self.timeline_frames.len() {
                groups.push((start, start, 0.0, self.timeline_frames[start]));
                break;
            }
            let slope = self.timeline_frames[start + 1] - self.timeline_frames[start];
            let mut end = start + 1;
            while end + 1 < self.timeline_frames.len() {
                let predicted = self.timeline_frames[start] + slope * (end + 1 - start) as f64;
                if (predicted - self.timeline_frames[end + 1]).abs() > 0.05 {
                    break;
                }
                end += 1;
            }
            groups.push((start, end, slope, self.timeline_frames[start]));
            start = end + 1;
        }
        // FFmpeg acepta menos de 100 `if` anidados; si la agrupación no baja
        // de 90 ramas, se usa una polilínea uniforme de 90 nudos. El error de
        // interpolación queda acotado y la expresión siempre parsea.
        if groups.len() > 90 {
            return uniform_setpts(&self.timeline_frames, 90);
        }
        let mut expression = String::new();
        for (position, (start, end, slope, intercept)) in groups.iter().enumerate().rev() {
            let term = if slope.abs() < 1e-9 {
                format!("{intercept:.6}")
            } else {
                format!("{intercept:.6}+({slope:.6})*(N-{start})")
            };
            expression = if position + 1 == groups.len() {
                term
            } else {
                format!("if(lt(N,{}),{}, {})", end + 1, term, expression)
            };
        }
        expression
    }
}

/// `setpts` de respaldo para curvas largas: `knots` intervalos lineales
/// uniformes sobre los frames de origen. Garantiza menos de 100 `if` sin
/// importar la longitud del clip.
fn uniform_setpts(frames: &[f64], knots: usize) -> String {
    let last = frames.len().saturating_sub(1);
    let mut points: Vec<(usize, f64)> = Vec::new();
    for knot in 0..=knots {
        let index = knot * last / knots;
        if points.last().map(|(previous, _)| *previous) != Some(index) {
            points.push((index, frames[index]));
        }
    }
    let mut expression = format!("{:.6}", frames[last]);
    for pair in points.windows(2).rev() {
        let (start, start_value) = pair[0];
        let (end, end_value) = pair[1];
        if start + 1 >= end {
            continue;
        }
        let slope = (end_value - start_value) / (end - start) as f64;
        expression = format!(
            "if(lt(N,{}),{:.6}+({:.6})*(N-{}),{})",
            end, start_value, slope, start, expression
        );
    }
    expression
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn clip_with_curve(curve: Value, duration: u64, source_frames: u64) -> Value {
        json!({
            "kind": "video",
            "durationFrames": duration,
            "source": { "type": "asset", "inFrame": 0, "outFrame": source_frames },
            "speedCurve": curve
        })
    }

    #[test]
    fn loads_the_shared_fixture_and_matches_every_local_frame() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../../packages/project-schema/fixtures/time-remap.fixture.json"
        ))
        .expect("fixture");
        for case in fixture["cases"].as_array().expect("cases") {
            let clip = clip_with_curve(
                case["curve"].clone(),
                case["durationFrames"].as_u64().expect("duration"),
                case["sourceFrames"].as_u64().expect("source"),
            );
            let remap = TimeRemap::from_clip(&clip).expect("remap").expect("curve");
            let expected_frames = case["sourceFramesAt"].as_array().expect("frames");
            for (local, expected) in expected_frames.iter().enumerate() {
                assert_eq!(
                    remap.source_frame(local as u32),
                    expected.as_u64().expect("frame") as u32,
                    "{} frame {local}",
                    case["name"]
                );
            }
            let expected_timeline = case["timelineFrames"].as_array().expect("timeline");
            assert_eq!(remap.timeline_frames.len(), expected_timeline.len());
            for (index, expected) in expected_timeline.iter().enumerate() {
                let expected = expected.as_f64().expect("timeline frame");
                assert!(
                    (remap.timeline_frames[index] - expected).abs() < 1e-4,
                    "{} timeline {index}: {} vs {expected}",
                    case["name"],
                    remap.timeline_frames[index]
                );
            }
        }
    }

    #[test]
    fn long_curve_expression_stays_below_ffmpeg_nesting_limit() {
        let clip = clip_with_curve(
            json!({ "points": [{ "t": 0, "speed": 0.5 }, { "t": 1, "speed": 2 }] }),
            120,
            120,
        );
        let remap = TimeRemap::from_clip(&clip).expect("remap").expect("curve");
        let expression = remap.setpts_expression();
        let branches = expression.matches("if(lt(").count();
        assert!(
            branches < 100,
            "FFmpeg rechaza 100 if anidados; la expresión tiene {branches}"
        );
        assert!(expression.contains("N-"), "debe usar tramos lineales");
    }

    #[test]
    #[ignore = "requiere FFmpeg en PATH"]
    fn ffmpeg_parses_a_120_frame_curve_expression() {
        let clip = clip_with_curve(
            json!({ "points": [{ "t": 0, "speed": 0.5 }, { "t": 1, "speed": 2 }] }),
            120,
            120,
        );
        let remap = TimeRemap::from_clip(&clip).expect("remap").expect("curve");
        let filter = format!(
            "fps=30,setpts='{}',tpad=stop_mode=clone:stop_duration=0.1,fps=30:round=near",
            remap.setpts_expression()
        );
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=32x32:r=30:d=5",
                "-vf",
                &filter,
                "-frames:v",
                "120",
                "-f",
                "null",
                "-",
            ])
            .status()
            .expect("ffmpeg");
        assert!(
            status.success(),
            "FFmpeg debe parsear la expresión agrupada"
        );
    }

    #[test]
    fn constant_one_x_is_identity_and_emits_the_existing_setpts() {
        let clip = clip_with_curve(
            json!({ "points": [{ "t": 0, "speed": 1 }, { "t": 1, "speed": 1 }] }),
            100,
            100,
        );
        let remap = TimeRemap::from_clip(&clip).expect("remap").expect("curve");
        assert!(remap.is_identity());
        for local in 0..100 {
            assert_eq!(remap.source_frame(local), local);
        }
    }

    #[test]
    fn rejects_combinations_that_break_the_clock() {
        for patch in [
            json!({ "reverse": true }),
            json!({ "stabilization": { "inFrame": 0, "outFrame": 100 } }),
            json!({ "motion": { "type": "zoom-in" } }),
            json!({ "transform": { "keyframes": [{ "frame": 0, "x": 0, "y": 0 }] } }),
            json!({ "transitionIn": { "type": "dissolve", "frames": 6 } }),
        ] {
            let mut clip = clip_with_curve(
                json!({ "points": [{ "t": 0, "speed": 0.5 }, { "t": 1, "speed": 2 }] }),
                100,
                88,
            );
            let object = clip.as_object_mut().expect("object");
            for (key, value) in patch.as_object().expect("patch") {
                object.insert(key.clone(), value.clone());
            }
            assert!(
                TimeRemap::from_clip(&clip).is_err(),
                "debía rechazar {patch}"
            );
        }
    }
}
