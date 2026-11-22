//! Mejora de diálogo con DSP local de FilmCraft.
//!
//! La cadena viene de `filmcraft-audio-dsp` (MIT OR Apache-2.0): reducción de
//! ruido espectral, de-hum, de-esser, de-reverb, EQ, compresor, realce de voz y
//! limitador de pico real. No separa voces superpuestas ni es un modelo de IA:
//! es procesamiento de señal determinista sobre el audio elegido.
//!
//! Este módulo es puro: presets → cadena de efectos configurada. La
//! orquestación FFmpeg (decode → bloques → WAV) queda en el comando.

use crate::projects::service::{ProjectError, ProjectErrorCode};
use filmcraft_audio_dsp::{create_effect, AudioEffect};

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DialoguePreset {
    Dialogue,
    Voice,
    Podcast,
    Soft,
}

impl DialoguePreset {
    pub fn parse(value: Option<&str>) -> Result<Self, ProjectError> {
        match value
            .unwrap_or("dialogo")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "dialogo" | "diálogo" | "dialogue" => Ok(Self::Dialogue),
            "voz" | "voice" => Ok(Self::Voice),
            "podcast" => Ok(Self::Podcast),
            "suave" | "soft" => Ok(Self::Soft),
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "preajuste de voz inválido: usá dialogo, voz, podcast o suave",
            )),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Dialogue => "dialogo",
            Self::Voice => "voz",
            Self::Podcast => "podcast",
            Self::Soft => "suave",
        }
    }

    pub fn effect_ids(self) -> &'static [&'static str] {
        match self {
            Self::Dialogue => &[
                "denoise",
                "parametric_eq",
                "dehum",
                "deesser",
                "compressor",
                "simple_eq",
                "speech_enhance",
                "limiter",
            ],
            Self::Voice => &[
                "denoise",
                "dehum",
                "deesser",
                "compressor",
                "speech_enhance",
                "limiter",
            ],
            Self::Podcast => &[
                "denoise",
                "dehum",
                "deesser",
                "dereverb",
                "compressor",
                "simple_eq",
                "speech_enhance",
                "limiter",
            ],
            Self::Soft => &["denoise", "deesser", "speech_enhance", "limiter"],
        }
    }
}

fn set(fx: &mut Box<dyn AudioEffect>, id: &str, value: f32) {
    let _ = fx.set_param(id, value);
}

/// Construye la cadena DSP del preset con sus parámetros ajustados.
pub fn build_chain(preset: DialoguePreset) -> Result<Vec<Box<dyn AudioEffect>>, ProjectError> {
    let mut chain: Vec<Box<dyn AudioEffect>> = Vec::new();
    for id in preset.effect_ids() {
        let effect = create_effect(id, SAMPLE_RATE as f32, CHANNELS).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "el DSP local no tiene todos los efectos de la cadena de voz",
            )
        })?;
        chain.push(effect);
    }
    for fx in chain.iter_mut() {
        match fx.id() {
            "denoise" => {
                let reduction = match preset {
                    DialoguePreset::Dialogue => 14.0,
                    DialoguePreset::Voice => 18.0,
                    DialoguePreset::Podcast => 16.0,
                    DialoguePreset::Soft => 8.0,
                };
                set(fx, "reduction", reduction);
                set(fx, "threshold", 6.0);
                set(fx, "smoothing", 60.0);
            }
            "parametric_eq" => {
                set(fx, "b1.on", 1.0);
                set(fx, "b1.type", 4.0); // high-pass
                set(fx, "b1.freq", 80.0);
                set(fx, "b1.q", 0.707);
                set(fx, "b2.on", 0.0);
            }
            "dehum" => {
                set(fx, "frequency", 0.0); // 50 Hz
                set(fx, "harmonics", 4.0);
                set(fx, "q", 30.0);
                set(fx, "amount", 85.0);
            }
            "deesser" => {
                set(fx, "frequency", 6000.0);
                set(fx, "threshold", -14.0);
                set(fx, "reduction", 6.0);
            }
            "dereverb" => {
                set(fx, "amount", 35.0);
                set(fx, "rt60", 0.6);
            }
            "compressor" => {
                set(fx, "threshold", -22.0);
                set(fx, "ratio", 3.0);
                set(fx, "knee", 6.0);
                set(fx, "attack", 8.0);
                set(fx, "release", 160.0);
                set(fx, "makeup", 2.0);
            }
            "simple_eq" => {
                set(fx, "low", -2.0);
                set(fx, "low_freq", 120.0);
                set(fx, "mid", 1.5);
                set(fx, "mid_freq", 2200.0);
                set(fx, "mid_q", 0.8);
                set(fx, "high", 1.5);
                set(fx, "high_freq", 8000.0);
            }
            "speech_enhance" => {
                set(fx, "mix", 100.0);
                set(fx, "tone", 0.0); // Low Tone: menos sibilancia
            }
            "limiter" => {
                set(fx, "ceiling", -1.0);
                set(fx, "true_peak", 1.0);
                set(fx, "release", 60.0);
            }
            _ => {}
        }
    }
    Ok(chain)
}

#[cfg(test)]
#[path = "dialogue.tests.rs"]
mod tests;
