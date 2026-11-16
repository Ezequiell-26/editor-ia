// SPDX-License-Identifier: AGPL-3.0-or-later
// Concat es AGPL-3.0-or-later (ver vendor/concat/LICENSE).

//! `{"op":"render_export"}`: exporta una composición simple a video.
//!
//! Alcance real de esta op (el pipeline completo de Concat — concat-project,
//! concat-render/wgpu, concat-export — NO está en este worker):
//!
//! - Canvas `width`x`height` a `frame_rate` constante.
//! - Cada clip del request es un tramo `[in, in+duration)` de un archivo,
//!   pintado en `[start, start+duration)` de la línea de tiempo, dentro de
//!   un rectángulo de destino con `fit` contain/cover/fill.
//! - Compositing CPU: muestreo bilineal RGBA por software. Sin alpha
//!   blending — cada clip pinta su rect opaco y los clips posteriores
//!   cubren a los anteriores (orden del array = orden de pintado).
//! - Audio opcional por clip (`"audio": true`): se mezcla con
//!   `concat_media::audio::mix_to_file` (48 kHz estéreo AAC) y se une por
//!   stream-copy con `concat_media::audio::mux`.
//! - Video por `concat_media::Encoder` (H.264 por defecto; también hevc,
//!   av1, prores-4444, vp9-alpha).
//! - `"speed"` por clip: retime constante (segundos de fuente por segundo
//!   de timeline). El video remuestrea por `source_at` y el audio va por
//!   `atempo` de `AudioClip.speed`.
//! - `"speed_curve"` por clip: velocidad variable `(at, speed)` con `at`
//!   fracción 0..1 del clip — el `SpeedCurve` de concat-core da el mapa de
//!   tiempo exacto (`consumed`); el video remuestrea por él y el audio por
//!   pasos `tempo` (`AudioClip.tempo`, ~8 pasos/segundo: el `atempo`
//!   escalonado del mixer aproxima la curva sin stutter).
//! - `"transition"` por clip: fundido CPU con el clip anterior durante los
//!   primeros `duration`/`frames` segundos del entrante, con las mismas
//!   formas xfade que dibuja el compositor de Concat sin GPU
//!   (`src/transitions.rs`, port del fallback de concat-render). El clip
//!   saliente sigue corriendo su fuente durante la ventana (como el primer
//!   input de un xfade de FFmpeg).
//! - Crossfade de audio en la transición (`audio_crossfade`, default
//!   activo): el entrante hace fade in y el saliente —extendido para
//!   sonar durante la ventana, como en el video— hace fade out, ambos de
//!   la duración de la transición.
//!
//! Lo que NO hace todavía: efectos, texto, keyframes de transform ni el
//! modelo de documento de concat-project. Es el "concat + PiP + cortes
//! con transición" honesto.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use concat_core::animate::Track;
use concat_core::frame::{Depth, Frame};
use concat_core::time::{FrameRate, Rational};
use concat_core::SpeedCurve;
use concat_media::audio::AudioClip;
use concat_media::{
    DecodeOptions, Decoder, EncodeOptions, Encoder, FrameSink, FrameSource, VideoCodec,
};
use serde_json::{json, Value};

use crate::protocol::{ExportClip, ExportRequest};

/// Techo de frames por export: guarda contra un `duration` disparatado.
/// 4K60 durante ~4.6 h entra; más allá es un request mal formado.
const MAX_FRAMES: i64 = 1_000_000;

/// Flag de cancelación de la op larga en curso (`render_export` o
/// `analyze_motion` — hay como mucho una a la vez, ver `LONG_ACTIVE` en
/// main.rs). El loop principal la arma al recibir `{"op":"cancel"}`; el
/// op la consulta por frame y entre fases. Se limpia al entrar a cada
/// `run_with_progress` para que un cancel previo no tumbe la próxima.
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Arma la cancelación de la op larga en curso. Idempotente; si no hay op
/// activa el flag queda puesto y la próxima lo limpia al empezar (un
/// cancel "huérfano" no cancela nada).
pub fn request_cancel() {
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

/// `true` si hay un cancel pedido y sin consumir por la op en curso.
pub(crate) fn cancel_requested() -> bool {
    CANCEL_REQUESTED.load(Ordering::SeqCst)
}

/// Limpia el flag al empezar una op larga.
pub(crate) fn clear_cancel() {
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);
}

/// Serializa los renders bajo `cfg(test)` (ver `run_with_progress`).
#[cfg(test)]
fn test_render_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|error| error.into_inner())
}

/// Error con el que aborta un render cancelado (la app lo reconoce por la
/// subcadena "cancel").
const CANCELLED_ERROR: &str = "render_export cancelled";

/// Evento de progreso JSON-lines: una línea `{"type":"render_export_progress",
/// ...}` SIN `ok`, así el cliente la distingue de la respuesta del envelope.
fn emit_progress(
    emit: &mut dyn FnMut(&Value),
    phase: &str,
    done: u64,
    total: u64,
) {
    let percent = if total > 0 {
        (done as f64 / total as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };
    emit(&json!({
        "type": "render_export_progress",
        "phase": phase,
        "frames": done,
        "frames_total": total,
        "percent": percent,
    }));
}

/// Evento de cambio de fase sin avance de frames (audio/mux no saben su
/// progreso interno; el campo `phase` es lo que la UI muestra).
fn emit_phase(emit: &mut dyn FnMut(&Value), phase: &str) {
    emit(&json!({
        "type": "render_export_progress",
        "phase": phase,
    }));
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Fit {
    /// Entra entero en el rect, centrado; el resto queda negro.
    Contain,
    /// Llena el rect recortando lo que sobre (aspecto preservado).
    Cover,
    /// Estira al rect sin preservar aspecto.
    Fill,
}

/// Una transición ya validada: el clip entrante se funde con el clip
/// anterior durante los primeros `duration` segundos de su ventana.
struct TransitionSpec {
    /// Nombre xfade en minúsculas, ya verificado contra
    /// `transitions::known`.
    kind: String,
    /// Largo de la ventana en segundos de timeline.
    duration: Rational,
    /// Crossfade de audio durante la ventana (default true).
    audio_crossfade: bool,
}

/// Un clip ya resuelto: tiempos en `Rational` y defaults aplicados.
struct ClipPlan {
    path: PathBuf,
    /// Segundo de fuente donde empieza el clip.
    input: Rational,
    /// Segundo de timeline donde aparece.
    start: Rational,
    /// Cuánto dura en el timeline.
    duration: Rational,
    /// Segundos de fuente por segundo de timeline (> 0) cuando no hay
    /// curva; con curva es el `speed` pedido (no se usa para el mapa de
    /// tiempo, que sale de `speed_curve`).
    speed: Rational,
    /// Velocidad variable sobre el clip (fracciones de su duración en el
    /// timeline); `None` = `speed` constante.
    speed_curve: Option<SpeedCurve>,
    /// Rectángulo de destino en píxeles del canvas (ya clampeado).
    rect: [u32; 4], // x, y, w, h
    fit: Fit,
    /// Incluir su audio en la mezcla.
    audio: bool,
    /// Transición con el clip anterior, si la pidió.
    transition: Option<TransitionSpec>,
    /// El archivo tiene stream de audio (de `probe`).
    has_audio: bool,
    /// Frame rate de la fuente, para estimar posiciones si el decoder no
    /// reporta PTS.
    source_rate: Option<FrameRate>,
}

impl ClipPlan {
    /// Segundo de fuente que se ve en el instante de timeline `t`.
    fn source_at(&self, t: Rational) -> Rational {
        let offset = t - self.start;
        match &self.speed_curve {
            None => self.input + offset * self.speed,
            Some(curve) => match curve_source_seconds(curve, self.duration, offset)
                .and_then(Rational::approximate)
            {
                Some(source) => self.input + source,
                None => self.input + offset * self.speed,
            },
        }
    }

    /// `true` si `t` cae dentro de la ventana del clip.
    fn active_at(&self, t: Rational) -> bool {
        t >= self.start && t < self.start + self.duration
    }
}

/// Estado de decode de un clip: su decoder y el último frame "corriente"
/// (el último con PTS <= al segundo pedido) más uno de lookahead.
struct ClipDecoder {
    plan: ClipPlan,
    decoder: Option<Decoder>,
    /// El frame que cubre el instante actual, con su posición de fuente.
    current: Option<(Frame, Rational)>,
    /// El primer frame posterior al actual (o el primero si no hay actual).
    next: Option<(Frame, Rational)>,
    /// El decoder llegó a EOF: `next` queda `None` para siempre.
    eof: bool,
    /// Frames ya pedidos al decoder; estima posiciones sin PTS.
    pulled: u64,
}

impl ClipDecoder {
    fn new(plan: ClipPlan) -> Self {
        Self {
            plan,
            decoder: None,
            current: None,
            next: None,
            eof: false,
            pulled: 0,
        }
    }

    /// Avanza el decoder hasta que `current` sea el frame que cubre
    /// `needed` (segundos de fuente). Monótono: `needed` nunca retrocede
    /// porque el timeline avanza en orden.
    fn advance(&mut self, needed: Rational) -> Result<(), String> {
        if self.decoder.is_none() {
            let options = DecodeOptions::default().starting_at(self.plan.input);
            let decoder = Decoder::open(&self.plan.path, &options)
                .map_err(|error| format!("{}: {error}", self.plan.path.display()))?;
            self.decoder = Some(decoder);
        }

        loop {
            if self.next.is_none() && !self.eof {
                let decoder = self.decoder.as_mut().expect("opened above");
                match decoder.next_frame().map_err(|e| e.to_string())? {
                    Some(frame) => {
                        if frame.depth() != Depth::Eight {
                            return Err(format!(
                                "{}: frames de 16 bits (HDR) no se exportan todavía",
                                self.plan.path.display()
                            ));
                        }
                        // Posición real del frame; si el container no da
                        // PTS se estima con el frame rate de la fuente.
                        let position = decoder.position().unwrap_or_else(|| {
                            self.plan
                                .source_rate
                                .map(|rate| {
                                    self.plan.input
                                        + Rational::from_int(self.pulled as i64) * rate.frame_duration()
                                })
                                .unwrap_or(Rational::ZERO)
                        });
                        self.pulled += 1;
                        self.next = Some((frame, position));
                    }
                    None => self.eof = true,
                }
                continue;
            }

            // Promueve `next` a `current` cuando `next` ya empezó antes del
            // instante pedido (el frame cubre [pts, pts_siguiente)). El
            // primer frame se promueve siempre: un PTS apenas posterior al
            // `in` pedido muestra el frame más cercano, como decode_frame.
            let promote = match (&self.current, &self.next) {
                (None, Some(_)) => true,
                (Some(_), Some((_, position))) => *position <= needed,
                _ => false,
            };
            if promote {
                self.current = self.next.take();
            } else {
                break;
            }
        }
        Ok(())
    }

    /// El frame corriente, si el clip tiene alguno para `needed`.
    fn current(&self) -> Option<&Frame> {
        self.current.as_ref().map(|(frame, _)| frame)
    }
}

/// Cómo un frame fuente cae en el rectángulo de destino.
struct Sampler {
    dst_w: u32,
    dst_h: u32,
    /// dst→src: `sx = x * ax + bx`, `sy = y * ay + by`.
    ax: f32,
    bx: f32,
    ay: f32,
    by: f32,
    /// Rango `[x0, x1) × [y0, y1)` de dst donde hay contenido (contain);
    /// `None` = todo el dst tiene contenido.
    inside: Option<((f32, f32), (f32, f32))>,
}

impl Sampler {
    fn new(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32, fit: Fit) -> Self {
        // Todos los casos mapean con centro de pixel: sx = x*ax + bx donde
        // bx ya incluye el "+0.5 del centro menos el "+0.5 de la fuente".
        let (ax, bx, ay, by, inside) = match fit {
            // fill: sx = (x + 0.5) * k - 0.5.
            Fit::Fill => {
                let kx = src_w as f32 / dst_w as f32;
                let ky = src_h as f32 / dst_h as f32;
                (kx, 0.5 * kx - 0.5, ky, 0.5 * ky - 0.5, None)
            }
            // contain: escala uniforme, contenido centrado, resto negro.
            Fit::Contain => {
                let s = (dst_w as f32 / src_w as f32).min(dst_h as f32 / src_h as f32);
                let cw = src_w as f32 * s;
                let ch = src_h as f32 * s;
                let ox = (dst_w as f32 - cw) / 2.0;
                let oy = (dst_h as f32 - ch) / 2.0;
                // sx = (x + 0.5 - ox) / s - 0.5 = x/s + (0.5 - ox)/s - 0.5
                (
                    1.0 / s,
                    (0.5 - ox) / s - 0.5,
                    1.0 / s,
                    (0.5 - oy) / s - 0.5,
                    Some(((ox, ox + cw), (oy, oy + ch))),
                )
            }
            // cover: escala uniforme recortando el centro.
            Fit::Cover => {
                let s = (dst_w as f32 / src_w as f32).max(dst_h as f32 / src_h as f32);
                let cw = src_w as f32 * s;
                let ch = src_h as f32 * s;
                // El contenido sobresale `cox`/`coy` px por cada lado.
                let cox = (cw - dst_w as f32) / 2.0;
                let coy = (ch - dst_h as f32) / 2.0;
                // sx = (x + 0.5 + cox) / s - 0.5
                (
                    1.0 / s,
                    (0.5 + cox) / s - 0.5,
                    1.0 / s,
                    (0.5 + coy) / s - 0.5,
                    None,
                )
            }
        };
        Self {
            dst_w,
            dst_h,
            ax,
            bx,
            ay,
            by,
            inside,
        }
    }

    /// `true` si el frame fuente ya tiene el tamaño del destino: el
    /// muestreo sería identidad y se puede blitear directo.
    fn is_identity_for(&self, src_w: u32, src_h: u32) -> bool {
        src_w == self.dst_w && src_h == self.dst_h
    }

    /// Renderiza `src` al tamaño destino. Fuera del contenido (barras de
    /// contain) queda negro opaco.
    fn render(&self, src: &Frame) -> Frame {
        let (sw, sh) = (src.width() as f32, src.height() as f32);
        let src_pixels = src.pixels();
        let src_stride = src.width() as usize * 4;
        let mut out = vec![0u8; Frame::byte_len(self.dst_w, self.dst_h)];

        for y in 0..self.dst_h {
            let fy = y as f32;
            let sy = fy * self.ay + self.by;
            let row_inside = self
                .inside
                .is_none_or(|((_, _), (y0, y1))| y0 <= fy && fy < y1);
            for x in 0..self.dst_w {
                let fx = x as f32;
                let offset = (y as usize * self.dst_w as usize + x as usize) * 4;
                if !row_inside {
                    out[offset..offset + 4].copy_from_slice(&[0, 0, 0, 255]);
                    continue;
                }
                if let Some(((x0, x1), _)) = self.inside {
                    if !(x0 <= fx && fx < x1) {
                        out[offset..offset + 4].copy_from_slice(&[0, 0, 0, 255]);
                        continue;
                    }
                }
                let sx = (fx * self.ax + self.bx).clamp(0.0, sw - 1.0);
                let sy = sy.clamp(0.0, sh - 1.0);
                let [r, g, b, _] = bilinear(src_pixels, src_stride, sw, sh, sx, sy);
                out[offset..offset + 4].copy_from_slice(&[r, g, b, 255]);
            }
        }
        // byte_len es w*h*4 y from_rgba valida el tamaño exacto.
        Frame::from_rgba(self.dst_w, self.dst_h, out).expect("sampler output size")
    }
}

/// Pinta en `canvas` todos los clips visibles en el instante `t`.
///
/// `skip` excluye un clip (la escena "antes" de una transición); `extend`
/// mantiene activo al clip `(índice, inicio, fin)` durante su ventana
/// aunque su `start + duration` ya haya pasado — es la cola del clip
/// saliente durante un xfade: su fuente sigue avanzando.
#[allow(clippy::too_many_arguments)]
fn paint_scene(
    clips: &mut [ClipDecoder],
    samplers: &mut [Option<Sampler>],
    canvas: &mut Frame,
    canvas_w: u32,
    canvas_h: u32,
    t: Rational,
    skip: Option<usize>,
    extend: Option<(usize, Rational, Rational)>,
) -> Result<(), String> {
    for (clip_index, clip) in clips.iter_mut().enumerate() {
        if Some(clip_index) == skip {
            continue;
        }
        // Todo lo que hace falta del plan se copia antes de tocar
        // el decoder: `plan` es un borrow inmutable de `clip` y
        // `advance` necesita el mutable.
        let ([rx, ry, rw, rh], fit, needed, visible) = {
            let plan = &clip.plan;
            let extended = extend.is_some_and(|(index, window_start, window_end)| {
                clip_index == index && t >= plan.start && t >= window_start && t < window_end
            });
            let visible = plan.rect[2] != 0
                && plan.rect[3] != 0
                && (plan.active_at(t) || extended);
            (
                plan.rect,
                plan.fit,
                plan.source_at(t),
                visible,
            )
        };
        if !visible {
            continue;
        }
        clip.advance(needed)?;
        let Some(source) = clip.current() else {
            continue;
        };
        // Fast path: el frame ya es del tamaño del canvas y el clip
        // cubre todo el lienzo — blit directo sin remuestrear.
        let identity = source.width() == canvas_w
            && source.height() == canvas_h
            && rx == 0
            && ry == 0
            && rw == canvas_w
            && rh == canvas_h;
        if identity {
            canvas.blit(source, 0, 0);
            continue;
        }
        if samplers[clip_index].is_none() {
            samplers[clip_index] = Some(Sampler::new(
                source.width(),
                source.height(),
                rw,
                rh,
                fit,
            ));
        }
        let sampler = samplers[clip_index].as_ref().expect("just built");
        if sampler.is_identity_for(source.width(), source.height()) {
            canvas.blit(source, rx, ry);
        } else {
            let scaled = sampler.render(source);
            canvas.blit(&scaled, rx, ry);
        }
    }
    Ok(())
}

/// Bilineal sobre píxeles RGBA8 con borde clampeado. Devuelve `[r,g,b,a]`.
fn bilinear(pixels: &[u8], stride: usize, w: f32, h: f32, sx: f32, sy: f32) -> [u8; 4] {
    let x0 = sx.floor().max(0.0) as usize;
    let y0 = sy.floor().max(0.0) as usize;
    let x1 = (x0 + 1).min((w as usize).saturating_sub(1));
    let y1 = (y0 + 1).min((h as usize).saturating_sub(1));
    let fx = (sx - x0 as f32).clamp(0.0, 1.0);
    let fy = (sy - y0 as f32).clamp(0.0, 1.0);

    let at = |x: usize, y: usize| -> [f32; 4] {
        let o = y * stride + x * 4;
        [
            pixels[o] as f32,
            pixels[o + 1] as f32,
            pixels[o + 2] as f32,
            pixels[o + 3] as f32,
        ]
    };
    let p00 = at(x0, y0);
    let p10 = at(x1, y0);
    let p01 = at(x0, y1);
    let p11 = at(x1, y1);
    let mut out = [0u8; 4];
    for channel in 0..4 {
        let top = p00[channel] * (1.0 - fx) + p10[channel] * fx;
        let bottom = p01[channel] * (1.0 - fx) + p11[channel] * fx;
        out[channel] = (top * (1.0 - fy) + bottom * fy).round().clamp(0.0, 255.0) as u8;
    }
    out
}

fn parse_time(text: &str, what: &str) -> Result<Rational, String> {
    let value = Rational::parse(text)
        .ok_or_else(|| format!("bad {what} {text:?}: use seconds, num/den or an integer"))?;
    if value.is_negative() {
        return Err(format!("{what} cannot be negative: {text}"));
    }
    Ok(value)
}

/// El frame rate pedido, o el del primer clip con video, o 30 fps.
fn resolve_frame_rate(
    request: &ExportRequest,
    infos: &[concat_media::MediaInfo],
) -> Result<FrameRate, String> {
    let rational = match &request.frame_rate {
        Some(Value::String(text)) => Some(parse_time(text, "frame_rate")?),
        Some(Value::Number(number)) => number
            .as_f64()
            .and_then(Rational::approximate),
        Some(_) => None,
        None => None,
    };
    if request.frame_rate.is_some() && rational.is_none() {
        return Err("bad frame_rate: use \"num/den\", seconds or a number".to_owned());
    }
    if let Some(rate) = rational {
        return checked_rate(rate).ok_or_else(|| format!("bad frame_rate {rate}"));
    }
    // Default: el frame rate del primer clip con video.
    for info in infos {
        if let Some(video) = &info.video {
            if let Some(rate) = checked_rate(video.cadence.fps())
                .or_else(|| checked_rate(video.frame_rate.fps()))
            {
                return Ok(rate);
            }
        }
    }
    Ok(FrameRate::THIRTY)
}

/// `Rational` fps → `FrameRate`, o `None` si no es un rate válido.
fn checked_rate(fps: Rational) -> Option<FrameRate> {
    if fps.is_zero() || fps.is_negative() {
        return None;
    }
    FrameRate::checked(fps.numerator(), fps.denominator())
        .or_else(|| FrameRate::approximated(fps.as_f64()))
}

/// Segundos de fuente consumidos `offset` segundos de timeline después
/// del inicio del clip con `curve`: la integral de la curva dentro de su
/// ventana y, fuera de ella, sostenida a la velocidad de cada extremo —
/// el mismo criterio que `concat_project::speed::source_consumed`, que es
/// lo que el video necesita durante una transición (el saliente sigue
/// avanzando pasada su duración).
fn curve_source_seconds(
    curve: &SpeedCurve,
    duration: Rational,
    offset: Rational,
) -> Option<f64> {
    let extent = duration.as_f64();
    let offset = offset.as_f64();
    if !offset.is_finite() || !extent.is_finite() {
        return None;
    }
    if extent <= 0.0 {
        return Some(offset * curve.speed_at(0.0));
    }
    if offset < 0.0 {
        Some(offset * curve.speed_at(0.0))
    } else if offset > extent {
        Some(extent * curve.consumed(1.0) + (offset - extent) * curve.speed_at(1.0))
    } else {
        Some(extent * curve.consumed(offset / extent))
    }
}

/// `speed_curve` → `SpeedCurve` de concat-core. Los puntos llegan como
/// `(at, speed)` con `at` fracción 0..1; `slope` sólo dobla la curva si
/// TODOS los puntos lo traen (regla de `concat_project::speed`). El motor
/// ordena y clampea; una lista vacía o sin puntos usables es error.
fn parse_speed_curve(
    points: &[crate::protocol::SpeedCurvePoint],
    path: &str,
) -> Result<Option<SpeedCurve>, String> {
    if points.is_empty() {
        return Err(format!(
            "{path}: `speed_curve` needs at least one {{\"at\", \"speed\"}} point"
        ));
    }
    let pairs: Vec<(f64, f64)> = points.iter().map(|p| (p.at, p.speed)).collect();
    // `collect::<Option<_>>` da Some sólo si TODOS los puntos tienen
    // slope: pendiente parcial = líneas rectas, como en Concat.
    let tangents: Option<Vec<f64>> = points.iter().map(|p| p.slope).collect();
    SpeedCurve::with_tangents(&pairs, tangents.as_deref())
        .map(Some)
        .ok_or_else(|| format!("{path}: bad `speed_curve`: no usable (at, speed) points"))
}

/// Pasos `tempo` del `AudioClip` que aproximan una curva: ~8 por segundo
/// de clip (cada ~125 ms), entre 8 y 96. El mixer los toca con un solo
/// `atempo` por eslabón (`asendcmd`), así que la curva se oye suave sin
/// el stutter de un tempo por frame.
fn curve_tempo_steps(curve: &SpeedCurve, duration: Rational) -> Vec<(f64, f64)> {
    let extent = duration.as_f64();
    let count = ((extent * 8.0).ceil() as usize).clamp(8, 96);
    curve
        .pieces(count)
        .iter()
        .map(|(x0, _, _, mean)| {
            (x0 * extent, mean.max(*concat_media::audio::SPEED_RANGE.start()))
        })
        .collect()
}

/// `speed` acepta número JSON o string (`"2"`, `"3/2"`); se clampea al
/// rango del motor (`concat_media::audio::SPEED_RANGE`) como hace el
/// audio de Concat. Rechaza no-finito y no-positivo.
fn parse_speed(value: &Value, path: &str) -> Result<Rational, String> {
    let raw = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => {
            let text = text.trim();
            text.parse::<f64>()
                .ok()
                .or_else(|| Rational::parse(text).map(|r| r.as_f64()))
        }
        _ => None,
    };
    let Some(speed) = raw.filter(|v| v.is_finite() && *v > 0.0) else {
        return Err(format!(
            "{path}: bad `speed` {value}: positive number or \"num/den\""
        ));
    };
    let clamped = concat_media::audio::clamp_speed(speed);
    Rational::approximate(clamped)
        .ok_or_else(|| format!("{path}: bad `speed` {value}"))
}

/// Resuelve el `transition` de un clip: tipo conocido, duración en
/// segundos de timeline y coherencia con la ventana del clip.
fn parse_transition(
    spec: &crate::protocol::ExportTransition,
    clip_index: usize,
    clip_duration: Rational,
    rate: FrameRate,
    path: &str,
) -> Result<TransitionSpec, String> {
    if clip_index == 0 {
        return Err(format!(
            "{path}: `transition` needs a previous clip in `clips`"
        ));
    }
    let kind = spec.kind.trim().to_ascii_lowercase();
    if !crate::transitions::known(&kind) {
        return Err(format!(
            "{path}: unknown transition type {:?} (dissolve, wipeleft, \
             fadeblack, circleopen, slideleft, ...)",
            spec.kind
        ));
    }
    let duration = match (&spec.duration, spec.frames) {
        (Some(_), Some(_)) => {
            return Err(format!(
                "{path}: transition takes `duration` or `frames`, not both"
            ))
        }
        (Some(text), None) => parse_time(text, "transition `duration`")?,
        (None, Some(frames)) => {
            let frames = i64::try_from(frames)
                .map_err(|_| format!("{path}: transition `frames` is too large"))?;
            Rational::from_int(frames) * rate.frame_duration()
        }
        (None, None) => {
            return Err(format!(
                "{path}: transition needs `duration` (seconds) or `frames`"
            ))
        }
    };
    if duration <= Rational::ZERO {
        return Err(format!("{path}: transition duration must be positive"));
    }
    if duration > clip_duration {
        return Err(format!(
            "{path}: transition is longer than the clip's `duration`"
        ));
    }
    Ok(TransitionSpec {
        kind,
        duration,
        // `audio_crossfade` ausente = crossfade activo: es lo que una
        // transición entre clips con audio espera oír.
        audio_crossfade: spec.audio_crossfade.unwrap_or(true),
    })
}

/// Resuelve defaults de cada clip con la metadata de `probe`.
fn plan_clips(
    request: &ExportRequest,
    canvas: (u32, u32),
    infos: &[concat_media::MediaInfo],
    rate: FrameRate,
) -> Result<Vec<ClipPlan>, String> {
    if request.clips.is_empty() {
        return Err("render_export needs at least one clip".to_owned());
    }
    let mut plans = Vec::with_capacity(request.clips.len());
    let mut cursor = Rational::ZERO; // `start` default: fin del clip anterior
    for (index, (spec, info)) in request.clips.iter().zip(infos.iter()).enumerate() {
        let speed = match &spec.speed {
            Some(value) => parse_speed(value, &spec.path)?,
            None => Rational::from_int(1),
        };
        // `speed_curve` manda sobre `speed`: el mapa de tiempo sale de la
        // curva y `speed` queda sólo como valor del campo (el audio usa
        // la media de la curva).
        let speed_curve = match &spec.speed_curve {
            Some(points) => parse_speed_curve(points, &spec.path)?,
            None => None,
        };
        let input = match &spec.input {
            Some(text) => parse_time(text, "clip `in`")?,
            None => Rational::ZERO,
        };
        let duration = match &spec.duration {
            Some(text) => parse_time(text, "clip `duration`")?,
            None => info
                .duration
                .map(|end| end - input)
                .filter(|remaining| !remaining.is_negative())
                .ok_or_else(|| {
                    format!(
                        "{}: sin `duration` y el probe no dio duración del medio",
                        spec.path
                    )
                })
                .and_then(|remaining| match &speed_curve {
                    // `duration` es timeline: la curva consume
                    // `duration * media` segundos de fuente, así que la
                    // duración default es lo que queda del medio a esa
                    // velocidad media.
                    Some(curve) => Rational::approximate(
                        remaining.as_f64() / curve.mean().max(1e-9),
                    )
                    .ok_or_else(|| format!("{}: bad `speed_curve` mean", spec.path)),
                    None => Ok(remaining / speed),
                })?,
        };
        let start = match &spec.start {
            Some(text) => parse_time(text, "clip `start`")?,
            None => cursor,
        };
        let fit = match spec.fit.as_deref().map(str::to_ascii_lowercase).as_deref() {
            None | Some("contain") => Fit::Contain,
            Some("cover") => Fit::Cover,
            Some("fill") => Fit::Fill,
            Some(other) => {
                return Err(format!("bad clip fit {other:?}: contain, cover or fill"))
            }
        };
        let rect = resolve_rect(spec, canvas);
        let transition = match &spec.transition {
            Some(spec_transition) => Some(parse_transition(
                spec_transition,
                index,
                duration,
                rate,
                &spec.path,
            )?),
            None => None,
        };
        let source_rate = info
            .video
            .as_ref()
            .and_then(|video| checked_rate(video.cadence.fps()).or_else(|| checked_rate(video.frame_rate.fps())));
        plans.push(ClipPlan {
            path: PathBuf::from(&spec.path),
            input,
            start,
            duration,
            speed,
            speed_curve,
            rect,
            fit,
            audio: spec.audio,
            transition,
            has_audio: info.audio.is_some() || !info.audio_streams.is_empty(),
            source_rate,
        });
        cursor = start + duration;
    }

    // Coherencia entre clips: el clip saliente de cada transición tiene
    // que llegar al borde (sin gap) y dos ventanas no pueden pisarse.
    let mut windows: Vec<(usize, Rational, Rational)> = Vec::new();
    for (index, plan) in plans.iter().enumerate() {
        let Some(transition) = &plan.transition else {
            continue;
        };
        let previous_end = plans[index - 1].start + plans[index - 1].duration;
        if previous_end < plan.start {
            return Err(format!(
                "{}: `transition` needs the previous clip to reach its \
                 `start` (there is a gap before it)",
                request.clips[index].path
            ));
        }
        windows.push((index, plan.start, plan.start + transition.duration));
    }
    windows.sort_by_key(|window| window.1);
    for pair in windows.windows(2) {
        if pair[1].1 < pair[0].2 {
            return Err(format!(
                "clips {} and {}: transition windows overlap",
                request.clips[pair[0].0].path, request.clips[pair[1].0].path
            ));
        }
    }
    Ok(plans)
}

/// El rectángulo `[x, y, w, h]` del clip en píxeles, clampeado al canvas.
fn resolve_rect(spec: &ExportClip, canvas: (u32, u32)) -> [u32; 4] {
    let (cw, ch) = (canvas.0 as f64, canvas.1 as f64);
    let x = spec.x.unwrap_or(0.0);
    let y = spec.y.unwrap_or(0.0);
    let w = spec.width.unwrap_or(cw);
    let h = spec.height.unwrap_or(ch);
    // Clampeo a píxeles enteros dentro del canvas; lo que queda vacío no
    // se dibuja.
    let x0 = x.round().clamp(0.0, cw) as u32;
    let y0 = y.round().clamp(0.0, ch) as u32;
    let x1 = (x + w).round().clamp(0.0, cw) as u32;
    let y1 = (y + h).round().clamp(0.0, ch) as u32;
    [x0, y0, x1.saturating_sub(x0), y1.saturating_sub(y0)]
}

fn temp_file(suffix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "concat-worker-{}-{nanos}-{suffix}",
        std::process::id()
    ))
}

/// Ejecuta `render_export`. Devuelve el payload JSON de la respuesta.
///
/// Sin callback de progreso ni cancelación fina: es la forma que usan los
/// tests y `ops::dispatch`. El binario usa `run_with_progress`, que corre
/// en su propio hilo para que el loop principal siga leyendo `cancel`.
pub fn run(request: &ExportRequest) -> Result<Value, String> {
    run_with_progress(request, &mut |_| {})
}

/// Como `run`, pero reporta progreso por `emit` (eventos JSON-lines sin
/// `ok`) y aborta limpio cuando `{"op":"cancel"}` armó el flag: devuelve
/// `Err("render_export cancelled")` y el caller escribe el envelope
/// `ok:false` como cualquier otro fallo.
///
/// Fases reportadas: `"composite"` durante el loop de frames (decode +
/// composite + encode van frame a frame, no se distinguen), `"audio"`
/// durante la mezcla y `"mux"` durante la unión de streams. La cancelación
/// se consulta por frame y antes de cada fase; dentro de `mix_to_file`/
/// `mux` (procesos ffmpeg internos) no hay interrupción fina — se chequea
/// al entrar a la fase.
pub fn run_with_progress(
    request: &ExportRequest,
    emit: &mut dyn FnMut(&Value),
) -> Result<Value, String> {
    // El flag de cancelación es global al proceso: en tests los renders
    // corren en paralelo y un `cancel` de un test abortaría el render de
    // otro. El lock serializa todos los `run_with_progress` del binario
    // de test (sólo existe bajo cfg(test)).
    #[cfg(test)]
    let _test_render_guard = test_render_lock();

    // Un cancel recibido antes de este render (sin op activa) no debe
    // tumbar éste: el flag se limpia al empezar.
    clear_cancel();

    // 1. Probe de todos los clips: defaults de duración, canvas, fps y audio.
    let mut infos = Vec::with_capacity(request.clips.len());
    for spec in &request.clips {
        infos.push(
            concat_media::probe(&spec.path).map_err(|error| format!("probe {}: {error}", spec.path))?,
        );
    }

    // Canvas: explícito o el del primer clip con video.
    let canvas = match (request.width, request.height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        (None, None) => infos
            .iter()
            .find_map(|info| info.video.as_ref().map(|v| (v.width, v.height)))
            .ok_or_else(|| {
                "sin width/height y ningún clip reportó video: hay que darlos".to_owned()
            })?,
        _ => return Err("width and height must be given together or not at all".to_owned()),
    };
    let (canvas_w, canvas_h) = canvas;

    let rate = resolve_frame_rate(request, &infos)?;
    let plans = plan_clips(request, canvas, &infos, rate)?;

    // Duración total: la pedida o el fin del último clip, lo mayor.
    let clips_end = plans
        .iter()
        .map(|plan| plan.start + plan.duration)
        .max()
        .unwrap_or(Rational::ZERO);
    let total = match &request.duration {
        Some(text) => {
            let asked = parse_time(text, "duration")?;
            asked.max(clips_end)
        }
        None => clips_end,
    };
    let frames = (total * rate.fps()).ceil();
    if frames <= 0 {
        return Err("render_export produced zero frames".to_owned());
    }
    if frames > MAX_FRAMES {
        return Err(format!(
            "render_export would write {frames} frames (max {MAX_FRAMES})"
        ));
    }

    // 2. Audio: qué clips lo piden y tienen stream.
    //
    // Crossfade de transiciones: cuando el clip `i` entra con transición
    // `audio_crossfade` y tanto él como el saliente `i-1` van a la mezcla,
    // el entrante hace fade in de la duración de la ventana y el saliente
    // —alargado hasta el fin de la ventana, como su video— hace fade out
    // de la misma duración. El mixer (`amix normalize=0`) suma ambos
    // durante el solape: es el crossfade.
    let audible = |index: usize| plans[index].audio && plans[index].has_audio;
    let mut audio_clips: Vec<AudioClip> = Vec::new();
    let mut audio_crossfades = 0usize;
    for (index, plan) in plans.iter().enumerate() {
        if !(plan.audio && plan.has_audio) {
            continue;
        }
        // ¿Este clip entra con una transición que crossfades y el
        // saliente también suena? Entonces hay fade in acá y fade out
        // (con extensión) en el saliente.
        let incoming = plan.transition.as_ref().filter(|transition| {
            transition.audio_crossfade && index > 0 && audible(index - 1)
        });
        let mut duration = plan.duration.as_f64();
        let mut fade_in = 0.0;
        let mut fade_out = 0.0;
        if let Some(transition) = incoming {
            fade_in = transition.duration.as_f64().min(duration);
            audio_crossfades += 1;
        }
        // ¿El clip siguiente entra con crossfade y éste es su saliente?
        // Se extiende para cubrir la ventana y hace fade out en ella.
        let outgoing = plans.get(index + 1).and_then(|next| {
            next.transition.as_ref().filter(|transition| {
                transition.audio_crossfade && audible(index) && audible(index + 1)
            })
        });
        if let Some(transition) = outgoing {
            // La ventana es [start_next, start_next + T): el audio del
            // saliente llega hasta su fin si la ventana lo pide.
            let window_end = plans[index + 1].start + transition.duration;
            let needed = window_end - plan.start;
            if needed.as_f64() > duration {
                duration = needed.as_f64();
            }
            fade_out = transition.duration.as_f64();
        }
        // Curva de velocidad → pasos `tempo` del mixer; sin curva, el
        // `speed` constante de siempre.
        let (speed, tempo) = match &plan.speed_curve {
            Some(curve) => (
                curve.mean(),
                curve_tempo_steps(curve, plan.duration),
            ),
            None => (plan.speed.as_f64(), Vec::new()),
        };
        audio_clips.push(AudioClip {
            path: plan.path.clone(),
            stream: None,
            start: plan.start.as_f64(),
            duration,
            source_start: plan.input.as_f64(),
            // Con `tempo` el campo es la media de la curva (ver
            // `AudioClip.speed`); `atempo` la aplica por tramos.
            speed,
            tempo,
            preserve_pitch: true,
            volume: 1.0,
            volume_curve: Track::default(),
            fade_in,
            fade_out,
            filter_chain: String::new(),
        })
    }
    let want_audio = !audio_clips.is_empty();
    let audio_skipped = plans
        .iter()
        .filter(|plan| plan.audio && !plan.has_audio)
        .count();

    // 3. Codec y opciones de encode.
    let codec = match &request.codec {
        Some(name) => VideoCodec::parse(name)
            .ok_or_else(|| format!("unknown codec {name:?} (h264, hevc, av1, prores-4444, vp9-alpha)"))?,
        None => VideoCodec::H264,
    };
    let mut options = EncodeOptions {
        codec,
        preset: request.preset.clone().unwrap_or_else(|| "medium".to_owned()),
        crf: request.crf.unwrap_or(18),
        ..EncodeOptions::default()
    };
    if request.hardware == Some(false) {
        options.hardware = false;
        options.software_only = true;
    }

    // 4. Video a archivo temporal si hay audio que muxear; si no, directo
    //    a `output`. `output_touched` marca si ya se truncó/creó, para no
    //    borrar un archivo preexistente del usuario cuando el fallo es
    //    anterior a abrir el encoder.
    let output = PathBuf::from(&request.output);
    let tmp_video = want_audio.then(|| temp_file("video.mp4"));
    let video_path = tmp_video.clone().unwrap_or_else(|| output.clone());
    let mut output_touched = false;

    let result = (|| -> Result<Value, String> {
        // Encoder::create trunca/crea `video_path`: si es `output` directo,
        // a partir de acá un fallo puede dejar un archivo parcial que hay
        // que limpiar. Con tmp_video, `output` sólo se toca en el mux.
        if tmp_video.is_none() {
            output_touched = true;
        }
        let mut encoder = Encoder::create(&video_path, canvas_w, canvas_h, rate, &options)
            .map_err(|error| error.to_string())?;

        // Transiciones resueltas: (índice del clip entrante, tipo, inicio
        // y largo de la ventana en segundos de timeline). Las ventanas son
        // disjuntas (validado en `plan_clips`), así que a lo sumo una cubre
        // cada frame.
        let transitions: Vec<(usize, String, Rational, Rational)> = plans
            .iter()
            .enumerate()
            .filter_map(|(index, plan)| {
                plan.transition.as_ref().map(|transition| {
                    (
                        index,
                        transition.kind.clone(),
                        plan.start,
                        transition.duration,
                    )
                })
            })
            .collect();

        let plans_with_curves = plans
            .iter()
            .filter(|plan| plan.speed_curve.is_some())
            .count();
        let mut clips: Vec<ClipDecoder> = plans.into_iter().map(ClipDecoder::new).collect();
        let mut samplers: Vec<Option<Sampler>> =
            (0..clips.len()).map(|_| None).collect();
        let mut canvas = Frame::black(canvas_w, canvas_h);
        let mut written = 0u64;
        // ~240 eventos de progreso como techo: suficiente para una barra
        // suave sin inundar el pipe en renders de horas.
        let report_every = ((frames as u64) / 240).max(1);
        let frames_total = frames as u64;
        emit_progress(emit, "composite", 0, frames_total);

        for index in 0..frames {
            if cancel_requested() {
                return Err(CANCELLED_ERROR.to_owned());
            }
            let t = rate.time_of_frame(index);
            let active = transitions
                .iter()
                .position(|(_, _, start, duration)| *start <= t && t < *start + *duration);
            match active {
                None => {
                    canvas.fill([0, 0, 0, 255]);
                    paint_scene(
                        &mut clips,
                        &mut samplers,
                        &mut canvas,
                        canvas_w,
                        canvas_h,
                        t,
                        None,
                        None,
                    )?;
                    encoder.write_frame(&canvas).map_err(|e| e.to_string())?;
                }
                Some(slot) => {
                    let (clip_index, kind, window_start, window_duration) =
                        &transitions[slot];
                    let progress =
                        ((t - *window_start) / *window_duration).as_f64() as f32;
                    // Escena "antes": sin el clip entrante y con el saliente
                    // (el clip anterior en `clips`) extendido durante la
                    // ventana — su fuente sigue avanzando, como el primer
                    // input de un xfade.
                    let mut from = Frame::black(canvas_w, canvas_h);
                    let extend = (*clip_index > 0).then(|| {
                        (
                            *clip_index - 1,
                            *window_start,
                            *window_start + *window_duration,
                        )
                    });
                    paint_scene(
                        &mut clips,
                        &mut samplers,
                        &mut from,
                        canvas_w,
                        canvas_h,
                        t,
                        Some(*clip_index),
                        extend,
                    )?;
                    // Escena "después": el frame normal con el entrante ya
                    // encima (su ventana empieza en `window_start`).
                    let mut to = Frame::black(canvas_w, canvas_h);
                    paint_scene(
                        &mut clips,
                        &mut samplers,
                        &mut to,
                        canvas_w,
                        canvas_h,
                        t,
                        None,
                        None,
                    )?;
                    let frame = crate::transitions::combine(&from, &to, kind, progress)
                        .unwrap_or(to);
                    encoder.write_frame(&frame).map_err(|e| e.to_string())?;
                }
            }
            written += 1;
            if written % report_every == 0 || written == frames_total {
                emit_progress(emit, "composite", written, frames_total);
            }
        }
        encoder.finish().map_err(|e| e.to_string())?;

        // 5. Audio: mezcla y mux, todo stream-copy. La cancelación se
        // consulta entre fases (dentro del ffmpeg interno no hay corte
        // fino): un cancel durante la mezcla aborta antes del mux.
        let mut muxed = false;
        if want_audio {
            if cancel_requested() {
                return Err(CANCELLED_ERROR.to_owned());
            }
            emit_phase(emit, "audio");
            let tmp_audio = temp_file("audio.m4a");
            let mixed = concat_media::audio::mix_to_file(
                &audio_clips,
                total.as_f64(),
                &tmp_audio,
            )
            .map_err(|e| e.to_string());
            // mux crea/trunca `output`: si falla puede quedar parcial.
            // El flag se marca recién cuando mux efectivamente corre —
            // un fallo de la mezcla no tocó `output`.
            let joined = mixed.and_then(|_| {
                if cancel_requested() {
                    return Err(CANCELLED_ERROR.to_owned());
                }
                emit_phase(emit, "mux");
                output_touched = true;
                concat_media::audio::mux(&video_path, &tmp_audio, &output)
                    .map_err(|e| e.to_string())
            });
            let _ = std::fs::remove_file(&tmp_audio);
            joined?;
            muxed = true;
        }

        Ok(json!({
            "output": output,
            "width": canvas_w,
            "height": canvas_h,
            "frame_rate": format!("{}/{}", rate.fps().numerator(), rate.fps().denominator()),
            "frame_rate_fps": rate.fps().as_f64(),
            "frames": written,
            "duration": format!("{}/{}", total.numerator(), total.denominator()),
            "duration_seconds": total.as_f64(),
            "codec": codec.name(),
            "audio": muxed,
            "audio_clips": audio_clips.len(),
            "audio_clips_skipped": audio_skipped,
            "audio_crossfades": audio_crossfades,
            "speed_curves": plans_with_curves,
            "transitions": transitions.len(),
        }))
    })();

    // Limpieza: temporales siempre; `output` sólo si ya se había tocado
    // (un probe fallido no debe borrar un archivo del usuario).
    if let Some(tmp) = &tmp_video {
        let _ = std::fs::remove_file(tmp);
    }
    if result.is_err() && output_touched {
        let _ = std::fs::remove_file(&output);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol;

    /// Mismo fixture que los tests de `ops.rs`: 64x64, 10 fps, ~2.3 s.
    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../vendor/concat/crates/concat-media/fixtures/vfr-still-screen.mp4"
    );

    fn temp_output(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "concat-worker-{tag}-{}-{nanos}.mp4",
            std::process::id()
        ))
    }

    /// `render_export` de 1 s del fixture a 10 fps = 10 frames.
    fn request_for(output: &PathBuf) -> crate::protocol::ExportRequest {
        let line = serde_json::to_string(&json!({
            "op": "render_export",
            "output": output.display().to_string(),
            "width": 64,
            "height": 64,
            "frame_rate": "10",
            "hardware": false,
            "clips": [{ "path": FIXTURE, "duration": "1" }],
        }))
        .unwrap();
        match protocol::parse(&line).unwrap() {
            protocol::Request::RenderExport(request) => request,
            other => panic!("not a render_export: {other:?}"),
        }
    }

    /// Los eventos `render_export_progress` llegan por `emit` mientras el
    /// render corre: fase composite con frames/total/percent.
    #[test]
    fn progress_events_report_composite_frames() {
        let out = temp_output("progress");
        let request = request_for(&out);
        let mut events: Vec<Value> = Vec::new();
        let result = run_with_progress(&request, &mut |event| events.push(event.clone()));
        assert!(result.is_ok(), "{:?}", result.err());
        assert!(out.exists());

        let progress: Vec<&Value> = events
            .iter()
            .filter(|event| event["type"] == "render_export_progress")
            .collect();
        assert!(progress.len() >= 2, "expected several events: {events:?}");
        // El primero anuncia la fase con 0 frames; el último cierra en 10/10.
        assert_eq!(progress.first().unwrap()["frames"], 0);
        let last = progress.last().unwrap();
        assert_eq!(last["phase"], "composite");
        assert_eq!(last["frames"], 10);
        assert_eq!(last["frames_total"], 10);
        assert_eq!(last["percent"].as_f64(), Some(1.0));
        let _ = std::fs::remove_file(&out);
    }

    /// `request_cancel` durante el render aborta limpio: `Err` con
    /// "cancel" y el MP4 parcial se limpia (mismo camino que un fallo).
    #[test]
    fn cancel_aborts_render_and_cleans_output() {
        let out = temp_output("cancel");
        let request = request_for(&out);
        let mut cancel_sent = false;
        let result = run_with_progress(&request, &mut |event| {
            // El primer evento de progreso (frames_done=0, antes del loop)
            // arma el cancel: el primer chequeo del loop aborta.
            if event["type"] == "render_export_progress" && !cancel_sent {
                cancel_sent = true;
                request_cancel();
            }
        });
        let error = result.err().expect("cancel must abort the render");
        assert!(error.contains("cancel"), "{error}");
        assert!(!out.exists(), "partial output must be removed");
    }

    /// Un `cancel` sin render activo queda armado pero el próximo render
    /// limpia el flag al entrar: no lo cancela por accidente.
    #[test]
    fn stale_cancel_does_not_kill_next_render() {
        // El `request_cancel` va bajo el mismo lock de los renders: si se
        // llamara suelto podría caer en medio del render de OTRO test
        // (el flag es global al proceso) y abortarlo por accidente.
        {
            let _guard = test_render_lock();
            request_cancel();
        }
        let out = temp_output("stale");
        let request = request_for(&out);
        let result = run_with_progress(&request, &mut |_| {});
        assert!(result.is_ok(), "{:?}", result.err());
        let _ = std::fs::remove_file(&out);
    }
}
