//! Herramientas de audio profesionales sobre `filmcraft-audio-dsp` (MIT/Apache-2.0):
//! cadena de efectos offline, loudness BS.1770, alineación GCC-PHAT y
//! time-stretch WSOLA con pitch preservado. Todo el cálculo vive en funciones
//! puras testeables; los comandos `audio_*` sólo decodifican con FFmpeg,
//! delegan y codifican WAV float32.
//!
//! Convención: PCM planar f32 (`Vec<Vec<f32>>`, una entrada por canal, todas
//! del mismo largo). La tasa de trabajo es 48 kHz estéreo salvo indicación.

use filmcraft_audio_dsp::{
    create_effect, effect_info, effects, AudioEffect, Category, ParamSpec, Unit,
};

/// WSOLA local (el rev pineado de filmcraft no trae `stretch`): hops de 15 ms,
/// tolerancia de búsqueda de 8 ms y ventana raised-cosine — mismas medidas que
/// `filmcraft-audio-dsp/stretch.rs` de upstream.
struct Wsola {
    hop: usize,
    tolerance: usize,
    rise: Vec<f32>,
}

impl Wsola {
    fn new(sample_rate: u32) -> Self {
        let sr = f64::from(sample_rate.clamp(1_000, 768_000));
        let hop = ((sr * 0.015).round() as usize).max(16);
        let tolerance = ((sr * 0.008).round() as usize).max(4);
        let rise = (0..hop)
            .map(|t| {
                let s = (std::f64::consts::FRAC_PI_2 * (t as f64 + 0.5) / hop as f64).sin();
                (s * s) as f32
            })
            .collect();
        Wsola {
            hop,
            tolerance,
            rise,
        }
    }

    fn rise(&self, t: usize) -> f32 {
        self.rise.get(t).copied().unwrap_or(0.0)
    }

    /// Posición dentro de ±tolerance de `nominal` cuyo primer hop coincida mejor
    /// con la continuación `continuation` del guide (correlación normalizada).
    fn align(&self, guide: &[f32], continuation: i64, nominal: i64) -> i64 {
        let h = self.hop as i64;
        let len = guide.len() as i64;
        let window = |p: i64| -> Option<&[f32]> {
            if p < 0 || p.checked_add(h)? > len {
                return None;
            }
            guide.get(p as usize..p as usize + h as usize)
        };
        let Some(template) = window(continuation) else {
            return nominal;
        };
        if template.iter().all(|x| x.abs() < 1e-9) {
            return nominal;
        }
        let score = |p: i64, step: usize| -> Option<f64> {
            let cand = window(p)?;
            let (mut xy, mut yy) = (0.0f64, 0.0f64);
            for (x, y) in template.iter().zip(cand).step_by(step) {
                xy += f64::from(*x) * f64::from(*y);
                yy += f64::from(*y) * f64::from(*y);
            }
            Some(if yy > 1e-18 { xy / yy.sqrt() } else { 0.0 })
        };
        let tol = self.tolerance as i64;
        let consider = |d: i64, step: usize, best: &mut Option<(i64, f64)>| {
            if let Some(s) = score(nominal.saturating_add(d), step) {
                if best.is_none_or(|(_, b)| s > b) {
                    *best = Some((d, s));
                }
            }
        };
        let mut best = None;
        let mut d = 0;
        while d <= tol {
            consider(d, 2, &mut best);
            if d > 0 {
                consider(-d, 2, &mut best);
            }
            d += 2;
        }
        let Some((coarse, _)) = best else {
            return nominal;
        };
        let mut fine = None;
        for d in [coarse, coarse - 1, coarse + 1] {
            if d.abs() <= tol {
                consider(d, 1, &mut fine);
            }
        }
        nominal.saturating_add(fine.map_or(coarse, |(d, _)| d))
    }
}

/// Tasa de trabajo de las herramientas offline (la misma que los scopes).
pub const TARGET_RATE: u32 = 48_000;
/// PCM planar: `channels[ch][sample]`.
pub type PlanarPcm = Vec<Vec<f32>>;

/// Una etapa de la cadena de efectos: id de registry + parámetros por id.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectStep {
    pub effect: String,
    #[serde(default)]
    pub params: Vec<EffectParam>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectParam {
    pub param: String,
    pub value: f32,
}

/// DTO serializable del registry de efectos (para `audio_effects_list`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectInfoDto {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub params: Vec<ParamDto>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamDto {
    pub id: &'static str,
    pub name: &'static str,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    pub unit: &'static str,
    pub log_scale: bool,
    pub choices: Vec<&'static str>,
}

fn category_name(category: Category) -> &'static str {
    match category {
        Category::Filter => "filter",
        Category::Dynamics => "dynamics",
        Category::Time => "time",
        Category::Channel => "channel",
        Category::Restoration => "restoration",
        Category::Pitch => "pitch",
        Category::Modulation => "modulation",
        Category::Reverb => "reverb",
        Category::Special => "special",
    }
}

fn unit_name(unit: Unit) -> &'static str {
    match unit {
        Unit::None => "none",
        Unit::Decibels => "db",
        Unit::Hertz => "hz",
        Unit::Milliseconds => "ms",
        Unit::Seconds => "s",
        Unit::Percent => "percent",
        Unit::Q => "q",
        Unit::Ratio => "ratio",
        Unit::Semitones => "semitones",
        Unit::Bpm => "bpm",
        Unit::Pan => "pan",
        Unit::Toggle => "toggle",
        Unit::Choice => "choice",
    }
}

/// Catálogo completo de efectos DSP disponibles para la cadena offline.
pub fn list_effects() -> Vec<EffectInfoDto> {
    effects()
        .iter()
        .map(|info| EffectInfoDto {
            id: info.id,
            name: info.name,
            category: category_name(info.category),
            params: info
                .params
                .iter()
                .map(|p: &ParamSpec| ParamDto {
                    id: p.id,
                    name: p.name,
                    min: p.min,
                    max: p.max,
                    default: p.default,
                    unit: unit_name(p.unit),
                    log_scale: p.log_scale,
                    choices: p.choices.to_vec(),
                })
                .collect(),
        })
        .collect()
}

/// Parámetros válidos de un efecto (para mensajes de error útiles).
pub fn effect_param_ids(effect: &str) -> Option<Vec<&'static str>> {
    effect_info(effect).map(|info| info.params.iter().map(|p| p.id).collect())
}

/// Aplica una cadena de efectos en sitio sobre PCM planar. Procesa en bloques
/// de 16k samples para no exigir un solo `process` gigante; al final descuenta
/// la latencia declarada por cada efecto (los look-ahead desplazan la salida).
/// Devuelve error con el id del efecto y el parámetro inválido si aplica.
pub fn apply_effect_chain(pcm: &mut PlanarPcm, chain: &[EffectStep]) -> Result<(), String> {
    if pcm.is_empty() {
        return Ok(());
    }
    let rate = TARGET_RATE as f32;
    let channels = pcm.len();
    let len = pcm.first().map_or(0, Vec::len);
    let mut latency_total = 0usize;
    for step in chain {
        let mut fx: Box<dyn AudioEffect> = create_effect(&step.effect, rate, channels)
            .ok_or_else(|| format!("efecto desconocido: {}", step.effect))?;
        for param in &step.params {
            if !fx.set_param(&param.param, param.value) {
                let valid = effect_param_ids(&step.effect)
                    .unwrap_or_default()
                    .join(", ");
                return Err(format!(
                    "parámetro inválido \"{}\" en efecto \"{}\" (válidos: {})",
                    param.param, step.effect, valid
                ));
            }
        }
        latency_total += fx.latency();
        // Bloques de 16384 samples por canal.
        const BLOCK: usize = 16_384;
        let mut start = 0usize;
        while start < len {
            let end = (start + BLOCK).min(len);
            let mut views: Vec<&mut [f32]> = pcm.iter_mut().map(|ch| &mut ch[start..end]).collect();
            fx.process(&mut views);
            start = end;
        }
    }
    // Compensar latencia: los efectos con look-ahead retrasan la salida;
    // recortar el frente realinea con la entrada.
    if latency_total > 0 && latency_total < len {
        for ch in pcm.iter_mut() {
            ch.drain(..latency_total);
            ch.resize(len, 0.0);
        }
    }
    Ok(())
}

/// Deinterleave PCM f32le interleaved → planar.
pub fn deinterleave(samples: &[f32], channels: usize) -> PlanarPcm {
    let channels = channels.max(1);
    let frames = samples.len() / channels;
    let mut out = vec![Vec::with_capacity(frames); channels];
    for frame in samples[..frames * channels].chunks_exact(channels) {
        for (ch, &sample) in frame.iter().enumerate() {
            out[ch].push(sample);
        }
    }
    out
}

/// Interleave planar → PCM f32le interleaved.
pub fn interleave(pcm: &PlanarPcm) -> Vec<u8> {
    let channels = pcm.len();
    if channels == 0 {
        return Vec::new();
    }
    let len = pcm.iter().map(Vec::len).min().unwrap_or(0);
    let mut out = Vec::with_capacity(len * channels * 4);
    for i in 0..len {
        for ch in pcm {
            out.extend_from_slice(&ch[i].to_le_bytes());
        }
    }
    out
}

/// WAV IEEE-float32 mono/multicanal (formato 0x0003), directo a bytes.
pub fn encode_wav_f32(pcm: &PlanarPcm, sample_rate: u32) -> Vec<u8> {
    let channels = pcm.len() as u16;
    let frames = pcm.iter().map(Vec::len).min().unwrap_or(0) as u32;
    let bits = 32u16;
    let block_align = channels * (bits / 8);
    let byte_rate = sample_rate * block_align as u32;
    let data_size = frames * block_align as u32;
    let mut out = Vec::with_capacity(44 + data_size as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_size).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_size.to_le_bytes());
    out.extend_from_slice(&interleave(pcm));
    out
}

/// Mezcla planar → mono (promedio de canales).
pub fn mixdown(pcm: &PlanarPcm) -> Vec<f32> {
    let channels = pcm.len();
    if channels == 0 {
        return Vec::new();
    }
    let len = pcm.iter().map(Vec::len).min().unwrap_or(0);
    let mut out = vec![0.0f32; len];
    for ch in pcm {
        for (o, &s) in out.iter_mut().zip(ch.iter().take(len)) {
            *o += s;
        }
    }
    let scale = 1.0 / channels as f32;
    for s in &mut out {
        *s *= scale;
    }
    out
}

/// Time-stretch WSOLA con pitch preservado sobre PCM planar.
/// `speed` es la velocidad de reproducción del material: `speed > 1` acorta
/// (más rápido), `speed < 1` alarga. La salida tiene `len / speed` samples.
/// Grano a grano replica el algoritmo de `filmcraft-render/stretch.rs`:
/// posiciones alineadas por similitud de forma sobre la mezcla mono.
pub fn wsola_stretch(pcm: &PlanarPcm, speed: f64) -> PlanarPcm {
    if pcm.is_empty() {
        return Vec::new();
    }
    let channels = pcm.len();
    let len = pcm.iter().map(Vec::len).min().unwrap_or(0);
    if len == 0 {
        return vec![Vec::new(); channels];
    }
    let speed = speed.clamp(0.1, 10.0);
    let ws = Wsola::new(TARGET_RATE);
    let h = ws.hop as i64;
    let n_out = ((len as f64) / speed).round().max(1.0) as usize;
    let k_last = (n_out as i64).div_euclid(h) + 1;
    // Granos de calentamiento antes del primer hop de salida.
    const WARMUP: i64 = 4;
    let k0 = -WARMUP;
    let guide = mixdown(pcm);
    let max_pos = (len as i64).saturating_sub(2 * h);
    // pos[i] = posición de entrada del grano (k0 + i); siempre ≥ 0.
    let mut pos: Vec<i64> = Vec::with_capacity((k_last - k0 + 2) as usize);
    pos.push(0);
    for k in (k0 + 1)..=k_last {
        let prev = *pos.last().unwrap_or(&0);
        let nominal = (k * h * speed as i64).clamp(0, max_pos);
        let aligned = ws.align(&guide, prev + h, nominal).clamp(0, max_pos);
        pos.push(aligned);
    }
    let at = |k: i64| -> Option<i64> {
        let i = (k - k0 + 1) as usize;
        pos.get(i).copied()
    };
    let mut out = vec![vec![0.0f32; n_out]; channels];
    for (c, ch) in pcm.iter().enumerate() {
        let dst = &mut out[c];
        for k in 0..=k_last {
            let (Some(prev), Some(cur)) = (at(k - 1), at(k)) else {
                continue;
            };
            let start = k * h;
            if start >= n_out as i64 {
                break;
            }
            let end = ((start + h).min(n_out as i64)) as usize;
            for (x, slot) in dst
                .iter_mut()
                .enumerate()
                .take(end)
                .skip(start.max(0) as usize)
            {
                let t = (x as i64 - start) as usize;
                let r = ws.rise(t);
                let a = (prev + h + t as i64) as usize;
                let b = (cur + t as i64) as usize;
                let va = ch.get(a).copied().unwrap_or(0.0);
                let vb = ch.get(b).copied().unwrap_or(0.0);
                *slot = va * (1.0 - r) + vb * r;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, rate: u32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.5)
            .collect()
    }

    #[test]
    fn deinterleave_interleave_roundtrip() {
        let interleaved = vec![1.0f32, 4.0, 2.0, 5.0, 3.0, 6.0];
        let back = deinterleave(&interleaved, 2);
        assert_eq!(back[0], vec![1.0, 2.0, 3.0]);
        assert_eq!(back[1], vec![4.0, 5.0, 6.0]);
        // interleave(deinterleave(x)) == x para estéreo alineado.
        let bytes = interleave(&back);
        let samples: Vec<f32> = bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| f32::from_le_bytes(*c))
            .collect();
        assert_eq!(samples, interleaved);
    }

    #[test]
    fn wav_header_is_float32() {
        let pcm = vec![vec![0.5f32, -0.5]];
        let wav = encode_wav_f32(&pcm, 48_000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u16::from_le_bytes([wav[20], wav[21]]), 3); // IEEE float
        assert_eq!(u16::from_le_bytes([wav[22], wav[23]]), 1); // mono
        assert_eq!(wav.len(), 44 + 2 * 4);
    }

    #[test]
    fn effects_list_has_professional_set() {
        let list = list_effects();
        let ids: Vec<&str> = list.iter().map(|e| e.id).collect();
        for expected in [
            "compressor",
            "limiter",
            "parametric_eq",
            "deesser",
            "denoise",
            "dehum",
            "dereverb",
            "click_remover",
            "speech_enhance",
            "vocal_enhancer",
            "convolution_reverb",
            "mastering",
        ] {
            assert!(ids.contains(&expected), "falta efecto {expected}");
        }
        assert!(list.len() > 40, "registry inesperadamente chico");
    }

    #[test]
    fn amplify_boosts_signal() {
        let mut pcm = vec![sine(440.0, TARGET_RATE, 4096)];
        apply_effect_chain(
            &mut pcm,
            &[EffectStep {
                effect: "amplify".into(),
                params: vec![EffectParam {
                    param: "gain".into(),
                    value: 6.0,
                }],
            }],
        )
        .expect("amplify");
        let peak_in = 0.5f32;
        let peak_out = pcm[0].iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak_out > peak_in * 1.5, "amplify no amplificó: {peak_out}");
    }

    #[test]
    fn unknown_effect_and_param_error() {
        let mut pcm = vec![vec![0.1f32; 128]];
        let err = apply_effect_chain(
            &mut pcm,
            &[EffectStep {
                effect: "nope".into(),
                params: vec![],
            }],
        )
        .unwrap_err();
        assert!(err.contains("nope"));
        let err = apply_effect_chain(
            &mut pcm,
            &[EffectStep {
                effect: "compressor".into(),
                params: vec![EffectParam {
                    param: "bogus".into(),
                    value: 1.0,
                }],
            }],
        )
        .unwrap_err();
        assert!(err.contains("bogus"));
    }

    #[test]
    fn stretch_changes_length_keeps_pitch_band() {
        // 440 Hz estirado 2× (más corto) sigue teniendo energía en ~440 Hz.
        let rate = TARGET_RATE;
        let input = vec![sine(440.0, rate, rate as usize)]; // 1 s
        let out = wsola_stretch(&input, 2.0);
        let expected = (input[0].len() as f64 / 2.0).round() as usize;
        assert!(
            (out[0].len() as i64 - expected as i64).abs() <= 2,
            "largo {} vs {}",
            out[0].len(),
            expected
        );
        // Energía no nula en el cuerpo (sin silencio total).
        let mid = &out[0][out[0].len() / 4..out[0].len() * 3 / 4];
        let rms = (mid.iter().map(|s| s * s).sum::<f32>() / mid.len() as f32).sqrt();
        assert!(rms > 0.05, "salida estirado casi silenciosa: rms {rms}");
        // Y el doble de lento produce el doble de largo.
        let slow = wsola_stretch(&input, 0.5);
        assert!(slow[0].len() > out[0].len() * 3 / 2);
    }

    #[test]
    fn stretch_silence_stays_silence() {
        let pcm = vec![vec![0.0f32; 4096]];
        let out = wsola_stretch(&pcm, 1.5);
        assert!(out[0].iter().all(|s| s.abs() < 1e-6));
    }
}
