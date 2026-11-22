//! Switching OBS en vivo: spec pura y filtergraph para coser los
//! segmentos MP4 de una sesión de conmutación de escenas.
//!
//! Modelo: una sesión graba la escena activa en segmentos sucesivos
//! (`switch-<stamp>-segNN.mp4`). Cada cambio de escena cierra el
//! segmento actual (cierre ordenado por stdin) y abre uno nuevo. Al
//! detener la sesión, los segmentos se re-codifican en UN MP4 con
//! transiciones `xfade`/`acrossfade` en cada unión — el resultado es un
//! video continuo con fundidos entre escenas, no una concatenación seca.
//!
//! Alcance honesto v1: la conmutación es por comando (la IA o el usuario
//! la dispara); no hay preview del programa mezclado en vivo ni streaming
//! RTMP durante la sesión; el cursor estilizado no aplica (se graba el
//! cursor del sistema); cada segmento usa el encoder de software — el
//! cosido re-codifica igual, así que el encoder de captura no cambia el
//! resultado.

use crate::projects::service::{ProjectError, ProjectErrorCode};

use super::obs_transition::TRANSITION_KINDS;

pub const MIN_SWITCH_TRANSITION_SECS: f64 = 0.1;
pub const MAX_SWITCH_TRANSITION_SECS: f64 = 30.0;
/// Techo de duración total cosida (6 h): una sesión más larga se corta
/// en el comando antes de llegar acá.
pub const MAX_STITCH_TOTAL_SECS: f64 = 21_600.0;
/// Margen mínimo de cada offset de xfade: por debajo de ~2 centésimas la
/// transición degeneraría en un corte y ffmpeg podría rechazar el grafo.
pub const MIN_XFADE_OFFSET_SECS: f64 = 0.02;

/// Spec de la sesión de switching: kind/duración de transición en cada
/// unión y canvas comum de normalización (idéntico al de `obs_transition`).
#[derive(Debug, Clone)]
pub struct ObsSwitchSpec {
    pub kind: String,
    /// Duración del fundido/wipe en CADA unión entre segmentos.
    pub transition_secs: f64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

impl ObsSwitchSpec {
    pub fn new(
        kind: Option<String>,
        transition_secs: Option<f64>,
        width: Option<u32>,
        height: Option<u32>,
        fps: Option<u32>,
    ) -> Result<Self, ProjectError> {
        let spec = Self {
            kind: kind.unwrap_or_else(|| super::obs_transition::DEFAULT_TRANSITION_KIND.to_owned()),
            transition_secs: transition_secs.unwrap_or(1.0),
            width: width.unwrap_or(super::obs_transition::DEFAULT_WIDTH),
            height: height.unwrap_or(super::obs_transition::DEFAULT_HEIGHT),
            fps: fps.unwrap_or(30),
        };
        spec.validate()?;
        Ok(spec)
    }

    pub fn validate(&self) -> Result<(), ProjectError> {
        if !TRANSITION_KINDS.contains(&self.kind.as_str()) {
            return Err(invalid(&format!(
                "transición no soportada; usá una de: {}",
                TRANSITION_KINDS.join(", ")
            )));
        }
        if !self.transition_secs.is_finite()
            || !(MIN_SWITCH_TRANSITION_SECS..=MAX_SWITCH_TRANSITION_SECS)
                .contains(&self.transition_secs)
        {
            return Err(invalid("transitionSecs debe ser un número entre 0.1 y 30"));
        }
        if self.width < super::obs_transition::MIN_CANVAS
            || self.height < super::obs_transition::MIN_CANVAS
            || self.width > super::obs_transition::MAX_CANVAS_W
            || self.height > super::obs_transition::MAX_CANVAS_H
        {
            return Err(invalid("width/height del canvas no son válidos"));
        }
        if !(1..=60).contains(&self.fps) {
            return Err(invalid("fps debe ser un entero entre 1 y 60"));
        }
        Ok(())
    }
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// Duración total que producirá el cosido: suma de segmentos menos una
/// transición por cada unión (n-1 uniones).
pub fn stitched_total_secs(durations: &[f64], transition_secs: f64) -> f64 {
    let sum: f64 = durations.iter().sum();
    let joins = durations.len().saturating_sub(1) as f64;
    (sum - joins * transition_secs).max(0.0)
}

/// Offset `xfade` de la unión que incorpora el segmento `i` (1-based en
/// la lista de offsets devuelta): el fundido arranca `transition_secs`
/// antes del final del stream acumulado. Devuelve un offset por cada
/// unión (índice 0 = unión entre seg0 y seg1).
pub fn stitch_offsets(durations: &[f64], transition_secs: f64) -> Vec<f64> {
    let mut offsets = Vec::with_capacity(durations.len().saturating_sub(1));
    let mut accumulated = durations.first().copied().unwrap_or(0.0);
    for d in durations.iter().skip(1) {
        // `accumulated` ya descuenta las uniones anteriores.
        offsets.push(accumulated - transition_secs);
        accumulated += d - transition_secs;
    }
    offsets
}

/// Valida que el plan de cosido sea ejecutable: ≥2 segmentos, duraciones
/// finitas positivas, offsets sanos y total acotado.
pub fn validate_stitch_plan(
    durations: &[f64],
    has_audio: &[bool],
    spec: &ObsSwitchSpec,
) -> Result<(), ProjectError> {
    if durations.len() < 2 {
        return Err(invalid(
            "el cosido necesita al menos dos segmentos; si la sesión tuvo uno solo, el segmento ya es el resultado",
        ));
    }
    if durations.len() != has_audio.len() {
        return Err(invalid(
            "el plan de cosido tiene duraciones y flags de audio desalineados",
        ));
    }
    for (i, d) in durations.iter().enumerate() {
        if !d.is_finite() || *d <= 0.0 {
            return Err(invalid(&format!(
                "el segmento {} no tiene una duración medible",
                i + 1
            )));
        }
    }
    let offsets = stitch_offsets(durations, spec.transition_secs);
    for (i, off) in offsets.iter().enumerate() {
        if *off < MIN_XFADE_OFFSET_SECS {
            return Err(invalid(&format!(
                "el segmento {} es demasiado corto para la transición de {}s; los segmentos deben durar más que la transición",
                i + 2,
                spec.transition_secs
            )));
        }
    }
    if stitched_total_secs(durations, spec.transition_secs) > MAX_STITCH_TOTAL_SECS {
        return Err(invalid(
            "la sesión supera las 6 horas de video cosido; dividila en sesiones más cortas",
        ));
    }
    Ok(())
}

/// `-i` repetidos no van acá: el comando arma las entradas. Esta función
/// devuelve sólo el `filter_complex` con las N entradas ya indexadas.
///
/// Video: cada segmento se normaliza al canvas/fps/formato común y se
/// encadenan `xfade` (mismo patrón que `ObsTransitionSpec::filtergraph`,
/// generalizado a N entradas). Audio: los segmentos con pista usan
/// `aformat` común; los que no, `anullsrc` del mismo largo — así la
/// cadena `acrossfade` es uniforme aunque las escenas tengan audio
/// mixto. Sin ninguna pista de audio en ningún segmento el caller omite
/// el map de audio.
///
/// `channels[i]` es el layout medido por ffprobe (`None` = sin dato). Un
/// segmento mono pasa por `pan` a ganancia unitaria antes del `aformat`:
/// el upmix `aformat` mono→estéreo aplica la ley de rematrix de ffmpeg
/// (−3,01 dB por canal) y las voces de OBS exportaban 3 dB bajas.
pub fn stitch_filtergraph(
    durations: &[f64],
    has_audio: &[bool],
    channels: &[Option<u32>],
    spec: &ObsSwitchSpec,
) -> Result<String, ProjectError> {
    validate_stitch_plan(durations, has_audio, spec)?;
    let n = durations.len();
    if channels.len() != n {
        return Err(invalid(
            "el plan de cosido tiene canales y duraciones desalineados",
        ));
    }
    let scale = format!(
        "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2",
        w = spec.width,
        h = spec.height
    );
    let norm = format!(",setsar=1,fps={},format=yuv420p,settb=AVTB", spec.fps);

    let mut parts: Vec<String> = Vec::with_capacity(n * 2 + 2);
    for i in 0..n {
        parts.push(format!("[{i}:v]{scale}{norm}[sv{i}]"));
    }
    let offsets = stitch_offsets(durations, spec.transition_secs);
    // Encadenamiento xfade: cada unión consume el acumulado previo y el
    // segmento nuevo; la última produce la etiqueta final `[v]`.
    let mut prev = "sv0".to_owned();
    for (j, off) in offsets.iter().enumerate() {
        let next = j + 1;
        let label = format!("xj{next}");
        let final_label = if next == n - 1 { "v" } else { label.as_str() };
        parts.push(format!(
            "[{prev}][sv{next}]xfade=transition={kind}:duration={dur}:offset={off:.3}[{final_label}]",
            kind = spec.kind,
            dur = spec.transition_secs,
            off = off
        ));
        prev = if next == n - 1 { "v".to_owned() } else { label };
    }

    let any_audio = has_audio.iter().any(|a| *a);
    if any_audio {
        for i in 0..n {
            if has_audio[i] {
                if channels[i] == Some(1) {
                    parts.push(format!(
                        "[{i}:a]pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[sa{i}]"
                    ));
                } else {
                    parts.push(format!(
                        "[{i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[sa{i}]"
                    ));
                }
            } else {
                parts.push(format!(
                    "anullsrc=sample_rate=48000:channel_layout=stereo,atrim=duration={:.3},asetpts=PTS-STARTPTS[sa{i}]",
                    durations[i]
                ));
            }
        }
        let mut aprev = "sa0".to_owned();
        for j in 0..offsets.len() {
            let next = j + 1;
            let label = format!("aj{next}");
            let final_label = if next == n - 1 { "a" } else { label.as_str() };
            parts.push(format!(
                "[{aprev}][sa{next}]acrossfade=d={dur:.3}[{final_label}]",
                dur = spec.transition_secs
            ));
            aprev = if next == n - 1 { "a".to_owned() } else { label };
        }
    }

    Ok(parts.join(";"))
}

#[cfg(test)]
#[path = "obs_switch.tests.rs"]
mod tests;
