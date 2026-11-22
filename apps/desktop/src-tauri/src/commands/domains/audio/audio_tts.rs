//! Narración TTS local con las voces formant de `filmcraft-tts` (sintetizador
//! source-filter original del crate, sin descargas ni modelos). Soporta
//! marcadores de pausa `[pause 1s]`/`[pause 500ms]` en el script.
//! Herramientas para la IA vía MCP, sin UI.

use serde::Serialize;
use tauri::State;

use super::audio_tools::output_file;
use crate::media::audio_tools::encode_wav_f32;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Voz del catálogo built-in (formant). `engine` es siempre `basic`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoiceInfo {
    pub id: String,
    pub name: String,
    pub language: String,
    pub gender: String,
    pub engine: String,
    pub description: String,
    pub license: String,
}

/// Catálogo de voces TTS disponibles sin descarga (las neurales Kokoro no
/// están compiladas: feature `kokoro` off).
#[tauri::command]
pub fn tts_voices() -> Vec<TtsVoiceInfo> {
    filmcraft_tts::voices()
        .into_iter()
        .map(|v| TtsVoiceInfo {
            id: v.id.to_string(),
            name: v.name.to_string(),
            language: v.language.to_string(),
            gender: match v.gender {
                filmcraft_tts::Gender::Female => "female",
                filmcraft_tts::Gender::Male => "male",
            }
            .to_string(),
            engine: v.engine.to_string(),
            description: v.description.to_string(),
            license: v.license.to_string(),
        })
        .collect()
}

/// Sintetiza `text` a WAV float32 mono a 24 kHz ( SAMPLE_RATE del crate).
/// `voice_id` default: la primera del catálogo. `pace` 0.5–2.0,
/// `semitones` ±12. Acepta `[pause 1s]`/`[pause 500ms]` en el script.
#[tauri::command]
pub async fn tts_synthesize(
    state: State<'_, AppState>,
    text: String,
    output: String,
    voice_id: Option<String>,
    pace: Option<f64>,
    semitones: Option<f64>,
) -> Result<String, ProjectError> {
    let _ = &state;
    let dest = output_file(&output)?;
    if !dest.to_string_lossy().to_lowercase().ends_with(".wav") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la narración TTS debe escribirse en un archivo .wav",
        ));
    }
    let voice_id = voice_id
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| filmcraft_tts::default_voice_id().to_string());
    let params = filmcraft_tts::Params {
        semitones: semitones.unwrap_or(0.0),
        pace: pace.unwrap_or(1.0),
    };
    let voice = filmcraft_tts::voice(&voice_id).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("voz TTS inválida: {e}"),
        )
    })?;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el texto de la narración está vacío",
        ));
    }
    let audio = tokio::task::spawn_blocking(move || voice.synthesize(&text, &params))
        .await
        .map_err(|_| {
            ProjectError::message(ProjectErrorCode::RenderFailed, "la síntesis TTS falló")
        })?
        .map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                &format!("no se pudo sintetizar la narración: {e}"),
            )
        })?;
    let pcm = vec![audio.samples];
    let wav = encode_wav_f32(&pcm, audio.sample_rate);
    std::fs::write(&dest, wav).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el WAV de la narración: {e}"),
        )
    })?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voices_catalog_is_non_empty_and_ids_resolve() {
        let voices = tts_voices();
        assert!(voices.len() >= 2);
        for v in &voices {
            assert!(!v.id.is_empty());
            assert!(
                filmcraft_tts::voice(&v.id).is_ok(),
                "voice {} no resuelve",
                v.id
            );
        }
    }

    #[test]
    fn synthesize_produces_wav_bytes() {
        let dir = std::env::temp_dir().join(format!("olyvia-tts-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("narration.wav");
        let voice = filmcraft_tts::voice(filmcraft_tts::default_voice_id()).unwrap();
        let audio = voice
            .synthesize(
                "Hello world. This is a test.",
                &filmcraft_tts::Params::default(),
            )
            .unwrap();
        assert!(audio.samples.len() > 1000);
        let pcm = vec![audio.samples];
        let wav = encode_wav_f32(&pcm, audio.sample_rate);
        assert_eq!(&wav[0..4], b"RIFF");
        std::fs::write(&out, wav).unwrap();
        assert!(out.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
