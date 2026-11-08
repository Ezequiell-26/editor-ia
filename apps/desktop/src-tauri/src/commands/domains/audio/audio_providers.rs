//! Audio providers: local Windows SAPI, ElevenLabs (official API) and a
//! manual external-web handoff.
//!
//! The ElevenLabs key lives in the Windows Credential Manager under a separate
//! service name and is never written to settings, projects or logs. The API
//! endpoint is fixed; the user cannot point this command at arbitrary hosts.
//! The external-web provider never automates a third-party site: it only opens
//! the URL and the user imports the audio they generated there.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::commands::narration::{NarrationResult, VoiceInfo};
use crate::commands::system::resolve_tools;
use crate::media::{probe_file, sha256_file, MediaKind};
use crate::projects::service::{now_rfc3339, ProjectError, ProjectErrorCode};
use crate::state::AppState;

const KEYRING_SERVICE: &str = "editor-ia.audio";
const KEYRING_USER: &str = "elevenlabs";
const MAX_TEXT_CHARS: usize = 4_000;
const MAX_AUDIO_BYTES: usize = 25 * 1024 * 1024;
const MAX_VOICES_BYTES: usize = 2 * 1024 * 1024;
const ELEVENLABS_VOICES_URL: &str = "https://api.elevenlabs.io/v1/voices";
const ELEVENLABS_TTS_BASE: &str = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL: &str = "eleven_multilingual_v2";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioProviderInfo {
    pub kind: String,
    pub voice_id: String,
    pub model_id: String,
    pub approved: bool,
    pub external_url: String,
    pub has_key: bool,
    pub keyring_available: bool,
}

fn keyring_entry() -> Result<keyring::Entry, ProjectError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de credenciales de Windows no está disponible",
        )
    })
}

fn read_key() -> Option<String> {
    keyring_entry()
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .map(|secret| secret.trim().to_owned())
        .filter(|secret| !secret.is_empty())
}

fn keyring_available() -> bool {
    keyring_entry().is_ok()
}

fn provider_info(settings: &crate::state::AudioProviderSettings) -> AudioProviderInfo {
    AudioProviderInfo {
        kind: settings.kind.clone(),
        voice_id: settings.voice_id.clone(),
        model_id: settings.model_id.clone(),
        approved: settings.approved,
        external_url: settings.external_url.clone(),
        has_key: read_key().is_some(),
        keyring_available: keyring_available(),
    }
}

fn validate_kind(kind: &str) -> Result<&'static str, ProjectError> {
    match kind {
        "windows-sapi" => Ok("windows-sapi"),
        "elevenlabs" => Ok("elevenlabs"),
        "external-web" => Ok("external-web"),
        _ => Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "proveedor de audio desconocido",
        )),
    }
}

fn validate_voice_id(value: &str) -> Result<String, ProjectError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "elegí una voz antes de sintetizar",
        ));
    }
    if value.chars().count() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el identificador de la voz no es válido",
        ));
    }
    Ok(value.to_owned())
}

fn validate_model_id(value: &str) -> Result<String, ProjectError> {
    let value = if value.trim().is_empty() {
        DEFAULT_MODEL
    } else {
        value.trim()
    };
    if value.chars().count() > 80
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el identificador del modelo de voz no es válido",
        ));
    }
    Ok(value.to_owned())
}

fn validate_external_url(value: &str) -> Result<String, ProjectError> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    if value.chars().count() > 500 {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL de la web externa es demasiado larga",
        ));
    }
    let url = reqwest::Url::parse(value).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL de la web externa no es válida",
        )
    })?;
    if url.scheme() != "https" {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la web externa debe usar HTTPS",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL de la web externa no puede incluir credenciales",
        ));
    }
    Ok(url.to_string())
}

fn validate_text(text: &str) -> Result<String, ProjectError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la narración está vacía",
        ));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la narración supera los 4000 caracteres",
        ));
    }
    Ok(text.to_owned())
}

#[tauri::command]
pub async fn get_audio_provider(
    state: State<'_, AppState>,
) -> Result<AudioProviderInfo, ProjectError> {
    let settings = state.settings_snapshot()?;
    Ok(provider_info(&settings.audio_provider))
}

#[tauri::command]
pub async fn save_audio_provider(
    state: State<'_, AppState>,
    kind: String,
    voice_id: String,
    model_id: String,
    external_url: String,
    approved: bool,
    api_key: Option<String>,
) -> Result<AudioProviderInfo, ProjectError> {
    let kind = validate_kind(kind.trim())?;
    let voice_id = voice_id.trim().to_owned();
    let model_id = validate_model_id(&model_id)?;
    let external_url = validate_external_url(&external_url)?;

    if kind == "elevenlabs" {
        if !voice_id.is_empty() {
            validate_voice_id(&voice_id)?;
        }
    }
    if kind == "windows-sapi" && voice_id.chars().count() > 200 {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el nombre de la voz local es demasiado largo",
        ));
    }
    if kind != "external-web" && !external_url.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL externa solo se usa con el proveedor web manual",
        ));
    }

    if let Some(secret) = api_key {
        let secret = secret.trim();
        if !secret.is_empty() {
            if kind != "elevenlabs" {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "solo ElevenLabs usa una clave de API",
                ));
            }
            if secret.chars().count() < 8 || secret.chars().count() > 300 {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "la clave de ElevenLabs no tiene un largo válido",
                ));
            }
            keyring_entry()?.set_password(secret).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::KeyringUnavailable,
                    "no se pudo guardar la clave de audio en el almacén de Windows",
                )
            })?;
        }
    }

    let mut settings = state.settings.lock().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
    })?;
    settings.audio_provider.kind = kind.to_owned();
    settings.audio_provider.voice_id = voice_id;
    settings.audio_provider.model_id = model_id;
    settings.audio_provider.approved = approved;
    settings.audio_provider.external_url = external_url;
    state.save_settings(&settings)?;
    Ok(provider_info(&settings.audio_provider))
}

#[tauri::command]
pub async fn clear_audio_provider_key(
    state: State<'_, AppState>,
) -> Result<AudioProviderInfo, ProjectError> {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    let settings = state.settings_snapshot()?;
    Ok(provider_info(&settings.audio_provider))
}

fn parse_elevenlabs_voices(value: &Value) -> Vec<VoiceInfo> {
    value["voices"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry["voice_id"].as_str()?.trim();
                    let name = entry["name"].as_str()?.trim();
                    if id.is_empty() || name.is_empty() {
                        return None;
                    }
                    let labels = &entry["labels"];
                    let culture = labels["language"]
                        .as_str()
                        .or_else(|| labels["accent"].as_str())
                        .unwrap_or("")
                        .to_owned();
                    let gender = labels["gender"].as_str().unwrap_or("").to_owned();
                    Some(VoiceInfo {
                        id: id.to_owned(),
                        name: name.to_owned(),
                        culture,
                        gender,
                    })
                })
                .take(200)
                .collect()
        })
        .unwrap_or_default()
}

fn extract_api_error(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let message = value["detail"]["message"]
        .as_str()
        .or_else(|| value["detail"].as_str())
        .or_else(|| value["message"].as_str())?;
    Some(message.chars().take(300).collect())
}

async fn read_limited(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, ProjectError> {
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la respuesta de ElevenLabs se interrumpió",
        )
    })? {
        if data.len() + chunk.len() > limit {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "la respuesta de ElevenLabs supera el límite permitido",
            ));
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

pub(crate) async fn list_elevenlabs_voices(
    _state: &AppState,
) -> Result<Vec<VoiceInfo>, ProjectError> {
    let key = read_key().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "guardá una clave de ElevenLabs en Ajustes para listar sus voces",
        )
    })?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar el cliente HTTP",
            )
        })?;
    let response = client
        .get(ELEVENLABS_VOICES_URL)
        .header("xi-api-key", key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo conectar con ElevenLabs; revisá la red y la clave",
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let raw = read_limited(response, 4_096).await.unwrap_or_default();
        let detail = extract_api_error(&String::from_utf8_lossy(&raw))
            .unwrap_or_else(|| format!("ElevenLabs respondió HTTP {}", status.as_u16()));
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!("ElevenLabs rechazó la lista de voces: {detail}").as_str(),
        ));
    }
    let bytes = read_limited(response, MAX_VOICES_BYTES).await?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ElevenLabs devolvió una lista de voces ilegible",
        )
    })?;
    let voices = parse_elevenlabs_voices(&value);
    if voices.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ElevenLabs no devolvió voces para esta cuenta",
        ));
    }
    Ok(voices)
}

pub(crate) async fn synthesize_elevenlabs(
    state: &AppState,
    text: String,
    voice: Option<String>,
    fps_num: u32,
    fps_den: u32,
) -> Result<NarrationResult, ProjectError> {
    let settings = state.settings_snapshot()?;
    if !settings.audio_provider.approved {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "confirmá en Ajustes que ElevenLabs puede consumir créditos antes de sintetizar",
        ));
    }
    let key = read_key().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave de ElevenLabs en el almacén de Windows",
        )
    })?;
    let requested_voice = voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(settings.audio_provider.voice_id.as_str());
    let voice_id = validate_voice_id(requested_voice)?;
    let model_id = validate_model_id(&settings.audio_provider.model_id)?;
    let text = validate_text(&text)?;
    let session = state.require_session()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible para medir la voz generada",
        ));
    };

    let media_dir = session.root.join("media");
    std::fs::create_dir_all(&media_dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear la carpeta media del proyecto",
        )
    })?;
    let output = media_dir.join(format!("voz-elevenlabs-{}.mp3", Uuid::new_v4()));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar el cliente HTTP",
            )
        })?;
    let response = client
        .post(format!(
            "{ELEVENLABS_TTS_BASE}/{voice_id}?output_format=mp3_44100_128"
        ))
        .header("xi-api-key", key)
        .header("Accept", "audio/mpeg")
        .json(&json!({ "text": text, "model_id": model_id }))
        .send()
        .await
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo conectar con ElevenLabs; revisá la red y la clave",
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let raw = read_limited(response, 4_096).await.unwrap_or_default();
        let detail = extract_api_error(&String::from_utf8_lossy(&raw))
            .unwrap_or_else(|| format!("ElevenLabs respondió HTTP {}", status.as_u16()));
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!("ElevenLabs no generó el audio: {detail}").as_str(),
        ));
    }
    let bytes = read_limited(response, MAX_AUDIO_BYTES).await?;
    if bytes.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ElevenLabs devolvió un audio vacío",
        ));
    }
    std::fs::write(&output, &bytes).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo escribir el audio generado en el proyecto",
        )
    })?;

    let measure = match probe_file(&ffprobe, &output, MediaKind::Audio) {
        Ok(measure) => measure,
        Err(error) => {
            let _ = std::fs::remove_file(&output);
            return Err(error);
        }
    };
    let (sha256, byte_count) = sha256_file(&output)?;
    let relative = format!(
        "media/{}",
        output
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "voz.mp3".to_owned())
    );
    let seconds = measure.duration_seconds.unwrap_or(0.0);
    let frames = if seconds > 0.0 {
        ((seconds * fps_num.max(1) as f64 / fps_den.max(1) as f64).round() as u64).max(1)
    } else {
        1
    };
    let acquired_at = now_rfc3339();
    let asset = json!({
        "id": Uuid::new_v4().to_string(),
        "label": "Narración ElevenLabs",
        "kind": "audio",
        "source": {
            "type": "generated",
            "provider": { "id": "elevenlabs", "model": model_id },
            "path": relative,
            "generatedAt": acquired_at.clone()
        },
        "status": "unverified",
        "integrity": { "sha256": sha256, "bytes": byte_count },
        "rights": {
            "license": { "id": "unknown", "commercialUse": "unknown" },
            "provenance": {
                "origin": "generated-by-provider",
                "acquiredAt": acquired_at,
                "provider": "elevenlabs",
                "termsSnapshot": "Audio generado con ElevenLabs. Verificá la licencia de la voz y los términos del servicio antes de publicar."
            }
        },
        "media": {
            "sampleRate": measure.sample_rate.unwrap_or(44_100),
            "channels": measure.channels.unwrap_or(1),
            "durationFrames": frames
        }
    });

    if let Ok(mut settings) = state.settings.lock() {
        settings.audio_provider.voice_id = voice_id.clone();
        let _ = state.save_settings(&settings);
    }

    Ok(NarrationResult {
        asset,
        voice: voice_id,
        provider: "elevenlabs".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_provider_inputs() {
        assert!(validate_kind("elevenlabs").is_ok());
        assert!(validate_kind("whatever").is_err());
        assert!(validate_voice_id("21m00Tcm4TlvDq8ikWAM").is_ok());
        assert!(validate_voice_id("voice id with spaces").is_err());
        assert!(validate_model_id("eleven_multilingual_v2").is_ok());
        assert!(validate_model_id("bad model!").is_err());
        assert!(validate_external_url("http://example.com").is_err());
        assert!(validate_external_url("https://example.com/tts").is_ok());
        assert!(validate_external_url("https://user:pass@example.com").is_err());
        assert!(validate_text("  hola  ").is_ok());
        assert!(validate_text("   ").is_err());
    }

    #[test]
    fn parses_elevenlabs_voices() {
        let value = json!({
            "voices": [
                { "voice_id": "abc_123", "name": "Voz Uno", "labels": { "language": "es", "gender": "female" } },
                { "voice_id": "", "name": "sin id" },
                { "voice_id": "def-456", "name": "Voz Dos", "labels": { "accent": "neutral" } }
            ]
        });
        let voices = parse_elevenlabs_voices(&value);
        assert_eq!(voices.len(), 2);
        assert_eq!(voices[0].id, "abc_123");
        assert_eq!(voices[0].culture, "es");
        assert_eq!(voices[1].culture, "neutral");
    }

    #[test]
    fn extracts_bounded_api_errors() {
        let raw = r#"{"detail":{"message":"invalid api key"}}"#;
        assert_eq!(extract_api_error(raw).as_deref(), Some("invalid api key"));
        assert_eq!(extract_api_error("not json"), None);
        let long =
            extract_api_error(&format!(r#"{{"message":"{}"}}"#, "x".repeat(500))).expect("mensaje");
        assert!(long.chars().count() <= 300);
    }
}
