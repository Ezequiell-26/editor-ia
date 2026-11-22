//! `ContentGenerator` local de efectos de sonido: síntesis procedural
//! propia en Rust, sin samples de terceros ni dependencias externas.
//!
//! Es el port fiel de `scripts/generate-sfx.mjs` (el generador que
//! produce `resources/sfx/*.wav` para la biblioteca SFX de la UI): los
//! mismos 8 presets, el mismo sample rate (44.1 kHz), el mismo formato
//! (WAV PCM 16-bit mono) y el mismo RNG determinista (LCG). Coste 0, sin
//! red, licencia `user-generated`.
//!
//! Convención de prompt: `sfx:<preset>` — o el id del preset a secas
//! (`sfx-click`, `click`, `boom`…). `params.preset`/`params.id` también
//! resuelven el preset si viene como string. `duration_seconds` estira el
//! preset en el tiempo (0.25×–4×; el tono cambia con la velocidad, como un
//! time-stretch de cinta — se declara en `limits`).
//!
//! Límite honesto: los presets son los 8 del catálogo SFX, no síntesis
//! paramétrica libre por prompt; un sonido que no esté en el catálogo
//! falla con la lista de ids válidos.

use std::path::Path;

use crate::ports::studio::{
    ContentGenerator, GenerationCapability, GenerationRequest, GenerationResult, ResourceLicense,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

const PROVIDER_ID: &str = "local-synth-sfx";
const MODEL: &str = "procedural-wav";
const SAMPLE_RATE: usize = 44_100;
const TWO_PI: f64 = std::f64::consts::PI * 2.0;

// ---------------------------------------------------------------------------
// Primitivas de síntesis (port 1:1 de generate-sfx.mjs)
// ---------------------------------------------------------------------------

/// RNG determinista: LCG idéntico al `makeRng` del script Node.
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Self {
        Self(seed)
    }

    /// Devuelve un float en [0,1).
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.0 as f64 / 4_294_967_296.0
    }
}

/// Oscilador de fase continua; `freq` en Hz se evalúa por muestra.
struct Osc {
    phase: f64,
}

impl Osc {
    fn new() -> Self {
        Self { phase: 0.0 }
    }

    /// Devuelve `sin(phase)` y avanza la fase (mismo orden que el JS).
    fn sample(&mut self, freq: f64) -> f64 {
        let value = self.phase.sin();
        self.phase += TWO_PI * freq / SAMPLE_RATE as f64;
        value
    }
}

/// Pasa-bajas de un polo: `alpha` más bajo = más suave.
struct Lowpass {
    alpha: f64,
    y: f64,
}

impl Lowpass {
    fn new(alpha: f64) -> Self {
        Self { alpha, y: 0.0 }
    }

    fn process(&mut self, x: f64) -> f64 {
        self.y += self.alpha * (x - self.y);
        self.y
    }
}

/// Pasa-altas de un polo (derivador suavizado).
struct Highpass {
    alpha: f64,
    y: f64,
    prev_x: f64,
}

impl Highpass {
    fn new(alpha: f64) -> Self {
        Self {
            alpha,
            y: 0.0,
            prev_x: 0.0,
        }
    }

    fn process(&mut self, x: f64) -> f64 {
        self.y = self.alpha * (self.y + x - self.prev_x);
        self.prev_x = x;
        self.y
    }
}

/// Envolvente ADSR mínima: ataque lineal, decaimiento exponencial.
fn decay_env(t: f64, attack: f64, decay: f64) -> f64 {
    if t < attack {
        return t / attack;
    }
    let u = ((t - attack) / decay.max(1e-6)).min(1.0);
    (-4.5 * u).exp()
}

/// Curva suave 0→1→0 (para barridos): sube en `attack`, baja en `release`.
fn swell_env(t: f64, duration: f64, attack: f64, release: f64) -> f64 {
    if t < attack {
        return t / attack;
    }
    let remaining = duration - t;
    if remaining < release {
        return (remaining / release).max(0.0);
    }
    1.0
}

/// Renderiza `seconds` de audio. `fn_sample(t, duration)` recibe el tiempo
/// en segundos del preset (ya estirado si aplica) y la duración del preset
/// en esas mismas unidades. Aplica fade de 3 ms en los bordes como el JS.
fn render(
    seconds: f64,
    preset_seconds: f64,
    mut fn_sample: impl FnMut(f64, f64) -> f64,
) -> Vec<f32> {
    let frames = (seconds * SAMPLE_RATE as f64).round() as usize;
    let mut samples = vec![0f32; frames];
    for (i, slot) in samples.iter_mut().enumerate() {
        let t_out = i as f64 / SAMPLE_RATE as f64;
        // Time-stretch lineal: el tiempo del preset avanza `preset/seconds`
        // por cada segundo de salida (cambia tono y envolventes juntas).
        let t = t_out * preset_seconds / seconds;
        *slot = fn_sample(t, preset_seconds).clamp(-1.0, 1.0) as f32;
    }
    let edge = (0.003 * SAMPLE_RATE as f64).round() as usize;
    for i in 0..edge.min(frames) {
        let g = i as f64 / edge as f64;
        samples[i] *= g as f32;
        samples[frames - 1 - i] *= g as f32;
    }
    samples
}

/// Escribe WAV PCM 16-bit mono 44.1 kHz (mismo layout que `writeWav`).
fn write_wav(path: &Path, samples: &[f32]) -> std::io::Result<()> {
    let data_size = (samples.len() * 2) as u32;
    let mut buffer = Vec::with_capacity(44 + data_size as usize);
    buffer.extend_from_slice(b"RIFF");
    buffer.extend_from_slice(&(36 + data_size).to_le_bytes());
    buffer.extend_from_slice(b"WAVE");
    buffer.extend_from_slice(b"fmt ");
    buffer.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    buffer.extend_from_slice(&1u16.to_le_bytes()); // PCM
    buffer.extend_from_slice(&1u16.to_le_bytes()); // mono
    buffer.extend_from_slice(&(SAMPLE_RATE as u32).to_le_bytes());
    buffer.extend_from_slice(&(SAMPLE_RATE as u32 * 2).to_le_bytes()); // byte rate
    buffer.extend_from_slice(&2u16.to_le_bytes()); // block align
    buffer.extend_from_slice(&16u16.to_le_bytes()); // bits
    buffer.extend_from_slice(b"data");
    buffer.extend_from_slice(&data_size.to_le_bytes());
    for &s in samples {
        let v = (s * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
        buffer.extend_from_slice(&v.to_le_bytes());
    }
    std::fs::write(path, buffer)
}

// ---------------------------------------------------------------------------
// Los 8 presets del catálogo (ids = CATALOG de commands/domains/audio/sfx.rs
// y PRESETS de scripts/generate-sfx.mjs)
// ---------------------------------------------------------------------------

type SampleFn = Box<dyn FnMut(f64, f64) -> f64>;

struct SfxPreset {
    /// Id del catálogo (`sfx-click`, …).
    id: &'static str,
    /// Segundos del preset en generate-sfx.mjs.
    seconds: f64,
    build: fn() -> SampleFn,
}

fn preset_click() -> SampleFn {
    let mut tick = Osc::new();
    let mut rng = Rng::new(11);
    let mut hp = Highpass::new(0.08);
    Box::new(move |t, _duration| {
        let tick_v = tick.sample(2400.0);
        let noise = rng.next() * 2.0 - 1.0;
        let hp_v = hp.process(noise);
        let env = decay_env(t, 0.001, 0.05);
        0.5 * tick_v * env + 0.35 * hp_v * env
    })
}

fn preset_pop() -> SampleFn {
    // Chirp descendente 950→320 Hz con decaimiento rápido: "burbuja".
    let mut chirp = Osc::new();
    Box::new(move |t, _duration| {
        let freq = 950.0 - 630.0 * (t / 0.09).min(1.0);
        chirp.sample(freq) * decay_env(t, 0.004, 0.16) * 0.9
    })
}

fn preset_ding() -> SampleFn {
    // Campana: fundamental + parciales inarmónicos, decaimiento largo.
    let mut f1 = Osc::new();
    let mut f2 = Osc::new();
    let mut f3 = Osc::new();
    Box::new(move |t, _duration| {
        let env = decay_env(t, 0.003, 0.6);
        (0.6 * f1.sample(880.0) + 0.3 * f2.sample(1318.5) + 0.15 * f3.sample(1975.5))
            * env
            * if t < 0.5 { 1.0 } else { 0.4 }
    })
}

fn preset_woosh() -> SampleFn {
    // Ruido con pasa-bajas que se abre y cierra + barrido de fase.
    let mut rng = Rng::new(23);
    let mut lp = Lowpass::new(0.12);
    let mut hp = Highpass::new(0.35);
    Box::new(move |t, duration| {
        let noise = rng.next() * 2.0 - 1.0;
        let noise2 = rng.next() * 2.0 - 1.0;
        let openness = 0.3 + 0.7 * swell_env(t, duration, 0.08, 0.12);
        let swept = lp.process(noise) * openness
            + hp.process(noise2) * 0.15 * swell_env(t, duration, 0.08, 0.12);
        swept * 1.6 * swell_env(t, duration, 0.08, 0.12)
    })
}

fn preset_boom() -> SampleFn {
    // Subida de seno 95→42 Hz + golpe de ruido inicial.
    let mut body = Osc::new();
    let mut sub = Osc::new();
    let mut rng = Rng::new(37);
    let mut lp = Lowpass::new(0.2);
    Box::new(move |t, _duration| {
        let body_freq = 95.0 - 53.0 * (t / 0.5).min(1.0);
        let sub_freq = 48.0 - 14.0 * (t / 0.8).min(1.0);
        let noise = rng.next() * 2.0 - 1.0;
        (0.85 * body.sample(body_freq) + 0.5 * sub.sample(sub_freq)) * decay_env(t, 0.005, 1.05)
            + 0.5 * lp.process(noise) * decay_env(t, 0.001, 0.09)
    })
}

fn preset_riser() -> SampleFn {
    // Barrido 180→1400 Hz + ruido creciente, crescendo hasta el final.
    let mut tone = Osc::new();
    let mut rng = Rng::new(41);
    let mut lp = Lowpass::new(0.18);
    Box::new(move |t, duration| {
        // En el JS la envolvente usa `t / 1.9` hardcodeado (duración del
        // preset); con time-stretch `t` ya viene en unidades del preset.
        let _ = duration;
        let freq = 180.0 * (1400.0_f64 / 180.0).powf(t / 2.0);
        let noise = rng.next() * 2.0 - 1.0;
        let env = (t / 1.9).min(1.0).powf(1.6);
        (0.35 * tone.sample(freq) + 0.3 * lp.process(noise)) * env * 1.4
    })
}

fn preset_glitch() -> SampleFn {
    // Ráfagas de square con sample&hold (crush) en intervalos irregulares.
    let mut rng = Rng::new(53);
    let mut held = 0.0f64;
    let mut next_change = 0.0f64;
    let bursts = [0.02, 0.09, 0.14, 0.26, 0.33, 0.41];
    let burst_len = 0.045;
    Box::new(move |t, _duration| {
        let in_burst = bursts
            .iter()
            .any(|start| t >= *start && t < start + burst_len);
        if !in_burst {
            return 0.0;
        }
        if t >= next_change {
            held = if rng.next() > 0.5 { 1.0 } else { -1.0 };
            next_change = t + 0.012 + rng.next() * 0.02;
        }
        let jitter = if rng.next() > 0.85 { 0.4 } else { 1.0 };
        held * jitter * 0.4
    })
}

fn preset_subdrop() -> SampleFn {
    // Caída 130→36 Hz con segundo armónico que se desvanece antes.
    let mut drop = Osc::new();
    let mut harm = Osc::new();
    Box::new(move |t, _duration| {
        let freq = 130.0 - 94.0 * (t / 1.1).min(1.0);
        let drop_v = drop.sample(freq);
        let harm_v = harm.sample(2.0 * freq);
        (0.9 * drop_v + 0.3 * harm_v * if t < 0.5 { 1.0 } else { 0.0 }) * decay_env(t, 0.01, 1.6)
            + 0.25 * harm_v * decay_env(t, 0.005, 0.35)
    })
}

const PRESETS: &[SfxPreset] = &[
    SfxPreset {
        id: "sfx-click",
        seconds: 0.08,
        build: preset_click,
    },
    SfxPreset {
        id: "sfx-pop",
        seconds: 0.22,
        build: preset_pop,
    },
    SfxPreset {
        id: "sfx-ding",
        seconds: 0.70,
        build: preset_ding,
    },
    SfxPreset {
        id: "sfx-woosh",
        seconds: 0.45,
        build: preset_woosh,
    },
    SfxPreset {
        id: "sfx-boom",
        seconds: 1.20,
        build: preset_boom,
    },
    SfxPreset {
        id: "sfx-riser",
        seconds: 2.00,
        build: preset_riser,
    },
    SfxPreset {
        id: "sfx-glitch",
        seconds: 0.50,
        build: preset_glitch,
    },
    SfxPreset {
        id: "sfx-subdrop",
        seconds: 1.80,
        build: preset_subdrop,
    },
];

/// Normaliza un nombre de preset: minúsculas, sólo alfanuméricos.
/// `sfx-click`, `sfx:click`, `SFX_CLICK` y `click` colapsan igual.
fn normalize_name(raw: &str) -> String {
    let trimmed = raw.trim();
    let body = trimmed
        .get(..4)
        .filter(|head| head.eq_ignore_ascii_case("sfx:"))
        .map(|_| &trimmed[4..])
        .unwrap_or(trimmed);
    body.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Resuelve el preset pedido: `params.preset`/`params.id`/`params.sfx`
/// (string) tiene prioridad sobre el prompt. Acepta el id completo
/// (`sfx-click`), el sufijo (`click`) o alias con `_`/`-`/espacios.
fn resolve_preset(query: &str) -> Option<&'static SfxPreset> {
    let name = normalize_name(query);
    if name.is_empty() {
        return None;
    }
    PRESETS.iter().find(|preset| {
        let id_norm = normalize_name(preset.id);
        let suffix = preset.id.strip_prefix("sfx-").unwrap_or(preset.id);
        name == id_norm || name == normalize_name(suffix)
    })
}

/// Igual que `resolve_preset` pero mirando primero `params`.
fn resolve_request_preset(request: &GenerationRequest) -> Option<&'static SfxPreset> {
    for key in ["preset", "id", "sfx"] {
        if let Some(raw) = request.params.get(key).and_then(|v| v.as_str()) {
            if let Some(preset) = resolve_preset(raw) {
                return Some(preset);
            }
        }
    }
    resolve_preset(&request.prompt)
}

fn valid_ids() -> String {
    PRESETS.iter().map(|p| p.id).collect::<Vec<_>>().join(", ")
}

/// `true` si el query nombra un preset conocido (para el dispatch de
/// `acquire`, igual que `is_music_prompt` para música).
pub fn is_sfx_prompt(query: &str) -> bool {
    resolve_preset(query).is_some()
}

pub struct LocalSfxGenerator;

impl LocalSfxGenerator {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LocalSfxGenerator {
    fn default() -> Self {
        Self::new()
    }
}

impl ContentGenerator for LocalSfxGenerator {
    fn provider_id(&self) -> &str {
        PROVIDER_ID
    }

    fn capabilities(&self) -> Vec<GenerationCapability> {
        vec![GenerationCapability {
            provider: PROVIDER_ID.to_owned(),
            model: MODEL.to_owned(),
            kind: StudioResourceKind::Sfx,
            estimated_cost_cents: Some(0),
            limits: vec![
                format!("8 presets fijos: {}", valid_ids()),
                "WAV PCM 16-bit mono 44.1 kHz, síntesis procedural propia".to_owned(),
                "duración del preset; duration_seconds estira 0.25×–4× (cambia el tono)".to_owned(),
            ],
            requires_network: false,
        }]
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        project_root: &Path,
    ) -> Result<GenerationResult, ProjectError> {
        if request.kind != StudioResourceKind::Sfx {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "LocalSfxGenerator sólo genera efectos de sonido (kind sfx)",
            ));
        }
        let preset = resolve_request_preset(request).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!(
                    "el generador de sfx exige un preset conocido (sfx:<id>); válidos: {}",
                    valid_ids()
                ),
            )
        })?;
        let seconds = request
            .duration_seconds
            .map(|d| d.clamp(preset.seconds * 0.25, preset.seconds * 4.0))
            .unwrap_or(preset.seconds);
        let dir = project_root.join("media").join("generated");
        std::fs::create_dir_all(&dir).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo crear media/generated: {e}"),
            )
        })?;
        let safe_id: String = request
            .request_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .take(60)
            .collect();
        let suffix = preset.id.strip_prefix("sfx-").unwrap_or(preset.id);
        let output = dir.join(format!("sfx-{suffix}-{safe_id}.wav"));
        let synth = (preset.build)();
        let samples = render(seconds, preset.seconds, synth);
        write_wav(&output, &samples).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo escribir el WAV: {e}"),
            )
        })?;
        if !output.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el sintetizador terminó sin escribir el WAV",
            ));
        }
        let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        let relative = format!("media/generated/sfx-{suffix}-{safe_id}.wav");
        Ok(GenerationResult {
            path: relative,
            bytes,
            provider: PROVIDER_ID.to_owned(),
            model: MODEL.to_owned(),
            cost_cents: Some(0),
            license: Some(ResourceLicense {
                id: "user-generated".to_owned(),
                commercial_use: CommercialUseRequirement::Allowed,
                url: None,
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: StudioResourceKind, prompt: &str) -> GenerationRequest {
        GenerationRequest {
            request_id: "test-req".to_owned(),
            kind,
            prompt: prompt.to_owned(),
            duration_seconds: None,
            voice: None,
            params: serde_json::json!({}),
        }
    }

    #[test]
    fn resolve_preset_accepts_ids_aliases_and_prefix() {
        for query in [
            "sfx-click",
            "sfx:click",
            "SFX:BOOM",
            "click",
            "sub-drop",
            "SUBDROP",
            "sfx_woosh",
        ] {
            assert!(resolve_preset(query).is_some(), "{query} debería resolver");
        }
        assert!(resolve_preset("click").unwrap().id == "sfx-click");
        assert!(resolve_preset("sfx:sub-drop").unwrap().id == "sfx-subdrop");
        assert!(resolve_preset("musica ambiental").is_none());
        assert!(resolve_preset("").is_none());
        assert!(resolve_preset("sfx:").is_none());
    }

    #[test]
    fn params_override_the_prompt() {
        let mut req = request(StudioResourceKind::Sfx, "cualquier cosa");
        req.params = serde_json::json!({ "preset": "ding" });
        assert_eq!(resolve_request_preset(&req).unwrap().id, "sfx-ding");
    }

    #[test]
    fn rejects_non_sfx_kinds_and_unknown_presets() {
        let generator = LocalSfxGenerator::new();
        let dir = std::env::temp_dir().join("editoria-sfx-test");
        let err = generator
            .generate(&request(StudioResourceKind::Music, "sfx:click"), &dir)
            .unwrap_err();
        assert!(err.message.contains("sfx"));
        let err = generator
            .generate(&request(StudioResourceKind::Sfx, "un sonido raro"), &dir)
            .unwrap_err();
        assert!(err.message.contains("sfx-click"), "{err:?}");
    }

    #[test]
    fn capabilities_declare_sfx_at_zero_cost_without_network() {
        let caps = LocalSfxGenerator::new().capabilities();
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].kind, StudioResourceKind::Sfx);
        assert_eq!(caps[0].provider, PROVIDER_ID);
        assert_eq!(caps[0].estimated_cost_cents, Some(0));
        assert!(!caps[0].requires_network);
    }

    /// Lee el header WAV y devuelve (frames, sample_rate, channels, bits).
    fn wav_header(bytes: &[u8]) -> (u32, u32, u16, u16) {
        assert_eq!(&bytes[0..4], b"RIFF", "falta magic RIFF");
        assert_eq!(&bytes[8..12], b"WAVE", "falta magic WAVE");
        assert_eq!(&bytes[12..16], b"fmt ", "falta chunk fmt");
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 16);
        let channels = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
        let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
        let bits = u16::from_le_bytes(bytes[34..36].try_into().unwrap());
        assert_eq!(&bytes[36..40], b"data", "falta chunk data");
        let data_size = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert_eq!(
            bytes.len() as u32,
            44 + data_size,
            "tamaño RIFF inconsistente"
        );
        (data_size / 2, rate, channels, bits)
    }

    #[test]
    fn generate_writes_a_valid_wav_with_expected_duration() {
        let dir = std::env::temp_dir().join(format!("editoria-sfx-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let generator = LocalSfxGenerator::new();
        let result = generator
            .generate(&request(StudioResourceKind::Sfx, "sfx:boom"), &dir)
            .expect("la síntesis local debería generar el WAV");
        assert_eq!(result.provider, PROVIDER_ID);
        assert_eq!(result.cost_cents, Some(0));
        let wav = dir.join(&result.path);
        assert!(wav.is_file(), "el WAV no existe: {wav:?}");
        let bytes = std::fs::read(&wav).unwrap();
        let (frames, rate, channels, bits) = wav_header(&bytes);
        assert_eq!(rate, SAMPLE_RATE as u32);
        assert_eq!(channels, 1);
        assert_eq!(bits, 16);
        // boom = 1.2 s ⇒ ~52 920 frames (±1 por el redondeo).
        let expected = (1.2 * SAMPLE_RATE as f64).round() as u32;
        assert!(
            frames.abs_diff(expected) <= 1,
            "frames {frames} != esperado {expected}"
        );
        // El preset boom tiene energía: pico no trivial.
        let mut peak = 0i16;
        for chunk in bytes[44..].as_chunks::<2>().0 {
            let v = i16::from_le_bytes([chunk[0], chunk[1]]);
            peak = peak.max(v.abs());
        }
        assert!(peak > 1_000, "el WAV parece silencio (peak {peak})");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn generate_is_deterministic_and_duration_seconds_stretches() {
        let dir = std::env::temp_dir().join(format!("editoria-sfx-det-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let generator = LocalSfxGenerator::new();
        let first = generator
            .generate(&request(StudioResourceKind::Sfx, "sfx:click"), &dir)
            .unwrap();
        let mut second_req = request(StudioResourceKind::Sfx, "sfx:click");
        second_req.request_id = "test-req-2".to_owned();
        let second = generator.generate(&second_req, &dir).unwrap();
        let a = std::fs::read(dir.join(&first.path)).unwrap();
        let b = std::fs::read(dir.join(&second.path)).unwrap();
        assert_eq!(a, b, "la síntesis debería ser determinista");

        let mut stretched = request(StudioResourceKind::Sfx, "sfx:click");
        stretched.request_id = "test-req-3".to_owned();
        stretched.duration_seconds = Some(0.32); // 4× el preset de 0.08 s
        let result = generator.generate(&stretched, &dir).unwrap();
        let bytes = std::fs::read(dir.join(&result.path)).unwrap();
        let (frames, _, _, _) = wav_header(&bytes);
        let expected = (0.32 * SAMPLE_RATE as f64).round() as u32;
        assert!(
            frames.abs_diff(expected) <= 1,
            "frames {frames} != {expected}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
