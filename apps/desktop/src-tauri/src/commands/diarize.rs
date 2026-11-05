//! Diarización por proveedor externo.
//!
//! La app no trae un modelo de hablantes: sería otro binario de cientos de MB.
//! En cambio, la persona configura su propia API —Deepgram o AssemblyAI, free
//! o paga— y la clave queda en el almacén de Windows, nunca en los ajustes.
//!
//! El comando devuelve tramos con hablante; el mapeo a subtítulos vive en el
//! frontend (`state/speakers.ts`), que decide por solapamiento.

use std::path::PathBuf;
use std::time::Duration;

use keyring::Entry;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::{AppState, DiarizeSettings};

const KEYRING_SERVICE: &str = "editor-ia.diarize";
const KEYRING_USER: &str = "diarize";
const DEEPGRAM_URL: &str = "https://api.deepgram.com";
const ASSEMBLY_URL: &str = "https://api.assemblyai.com";
const POLL_ATTEMPTS: u32 = 100;
const POLL_SECONDS: u64 = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeProviderInfo {
    pub kind: String,
    pub base_url: String,
    pub language: String,
    pub has_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerSegment {
    /// Segundos desde el inicio del material.
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub speaker: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeResult {
    pub provider: String,
    pub segments: Vec<SpeakerSegment>,
}

fn keyring_entry() -> Result<Entry, ProjectError> {
    Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de claves de Windows no está disponible",
        )
    })
}

fn provider_info(settings: &DiarizeSettings) -> DiarizeProviderInfo {
    let has_key = keyring_entry()
        .and_then(|entry| {
            entry.get_password().map_err(|_| {
                ProjectError::message(ProjectErrorCode::KeyringUnavailable, "sin clave")
            })
        })
        .is_ok();
    DiarizeProviderInfo {
        kind: settings.kind.clone(),
        base_url: settings.base_url.clone(),
        language: settings.language.clone(),
        has_key,
    }
}

#[tauri::command]
pub async fn get_diarize_provider(
    state: State<'_, AppState>,
) -> Result<DiarizeProviderInfo, ProjectError> {
    let settings = state.settings_snapshot()?;
    Ok(provider_info(&settings.diarize))
}

#[tauri::command]
pub async fn save_diarize_provider(
    state: State<'_, AppState>,
    kind: String,
    base_url: String,
    language: String,
    api_key: Option<String>,
) -> Result<DiarizeProviderInfo, ProjectError> {
    let kind = match kind.as_str() {
        "deepgram" => "deepgram",
        "assemblyai" => "assemblyai",
        _ => "none",
    };
    let base_url = base_url.trim().trim_end_matches('/').to_owned();
    if !base_url.is_empty()
        && !(base_url.starts_with("https://") || base_url.starts_with("http://"))
    {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL base tiene que empezar con https://",
        ));
    }
    let language = {
        let trimmed = language.trim();
        if trimmed.is_empty() {
            "es".to_owned()
        } else {
            trimmed.to_owned()
        }
    };

    if let Some(secret) = api_key {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            if trimmed.chars().count() < 8 {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "la clave parece demasiado corta",
                ));
            }
            keyring_entry()?.set_password(trimmed).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::KeyringUnavailable,
                    "no se pudo guardar la clave en el almacén de Windows",
                )
            })?;
        }
    }

    let mut settings = state.settings.lock().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
    })?;
    settings.diarize = DiarizeSettings {
        kind: kind.to_owned(),
        base_url,
        language,
    };
    state.save_settings(&settings)?;
    Ok(provider_info(&settings.diarize))
}

fn parse_deepgram(value: &Value) -> Vec<SpeakerSegment> {
    value["results"]["utterances"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let start = item["start"].as_f64()?;
                    let end = item["end"].as_f64()?;
                    let text = item["transcript"].as_str()?.trim().to_owned();
                    let speaker = item["speaker"]
                        .as_u64()
                        .map(|number| number.to_string())
                        .or_else(|| item["speaker"].as_str().map(str::to_owned))?;
                    if text.is_empty() || end <= start {
                        return None;
                    }
                    Some(SpeakerSegment {
                        start,
                        end,
                        text,
                        speaker,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_assemblyai(value: &Value) -> Vec<SpeakerSegment> {
    value["utterances"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    // AssemblyAI devuelve milisegundos.
                    let start = item["start"].as_f64()? / 1000.0;
                    let end = item["end"].as_f64()? / 1000.0;
                    let text = item["text"].as_str()?.trim().to_owned();
                    let speaker = item["speaker"].as_str()?.trim().to_owned();
                    if text.is_empty() || end <= start || speaker.is_empty() {
                        return None;
                    }
                    Some(SpeakerSegment {
                        start,
                        end,
                        text,
                        speaker,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

async fn deepgram(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    language: &str,
    bytes: Vec<u8>,
) -> Result<Vec<SpeakerSegment>, ProjectError> {
    let base = if base_url.trim().is_empty() {
        DEEPGRAM_URL
    } else {
        base_url.trim()
    };
    let url = format!(
        "{base}/v1/listen?model=nova-3&diarize=true&punctuate=true&utterances=true&language={language}"
    );
    let response = client
        .post(url)
        .header("Authorization", format!("Token {key}"))
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                &format!("no pude hablar con Deepgram: {error}"),
            )
        })?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!("Deepgram respondió {status}"),
        ));
    }
    let value: Value = response.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "Deepgram devolvió una respuesta que no entiendo",
        )
    })?;
    Ok(parse_deepgram(&value))
}

async fn assemblyai(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    language: &str,
    bytes: Vec<u8>,
) -> Result<Vec<SpeakerSegment>, ProjectError> {
    let base = if base_url.trim().is_empty() {
        ASSEMBLY_URL
    } else {
        base_url.trim()
    };
    let upload = client
        .post(format!("{base}/v2/upload"))
        .header("authorization", key)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                &format!("no pude subir el audio a AssemblyAI: {error}"),
            )
        })?;
    if !upload.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "AssemblyAI rechazó el archivo",
        ));
    }
    let uploaded: Value = upload.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "AssemblyAI no devolvió la URL de subida",
        )
    })?;
    let audio_url = uploaded["upload_url"].as_str().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "AssemblyAI no devolvió la URL de subida",
        )
    })?;
    let created = client
        .post(format!("{base}/v2/transcript"))
        .header("authorization", key)
        .json(&json!({
            "audio_url": audio_url,
            "speaker_labels": true,
            "language_code": language,
        }))
        .timeout(Duration::from_secs(60))
        .send()
        .await
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                &format!("AssemblyAI no aceptó el trabajo: {error}"),
            )
        })?;
    let created: Value = created.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "AssemblyAI no devolvió el id del trabajo",
        )
    })?;
    let id = created["id"].as_str().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "AssemblyAI no devolvió el id del trabajo",
        )
    })?;

    for _ in 0..POLL_ATTEMPTS {
        tokio::time::sleep(Duration::from_secs(POLL_SECONDS)).await;
        let poll = client
            .get(format!("{base}/v2/transcript/{id}"))
            .header("authorization", key)
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    &format!("AssemblyAI no respondió al estado: {error}"),
                )
            })?;
        let value: Value = poll.json().await.map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "AssemblyAI devolvió un estado ilegible",
            )
        })?;
        match value["status"].as_str() {
            Some("completed") => return Ok(parse_assemblyai(&value)),
            Some("error") => {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "AssemblyAI no pudo transcribir el archivo",
                ))
            }
            _ => continue,
        }
    }
    Err(ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        "AssemblyAI tardó demasiado; probá de nuevo más tarde",
    ))
}

#[tauri::command]
pub async fn diarize_audio(
    state: State<'_, AppState>,
    path: String,
    language: Option<String>,
) -> Result<DiarizeResult, ProjectError> {
    let settings = state.settings_snapshot()?;
    let diarize = settings.diarize;
    if diarize.kind == "none" {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor de diarización (Deepgram o AssemblyAI) y su clave",
        ));
    }
    let key = keyring_entry()?.get_password().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "falta la clave del proveedor de diarización",
        )
    })?;
    let source = PathBuf::from(path.trim());
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo no existe",
        ));
    }
    let bytes = std::fs::read(&source).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude leer el archivo de audio")
    })?;
    let language = language
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or(diarize.language.clone());
    let client = reqwest::Client::new();
    let segments = match diarize.kind.as_str() {
        "deepgram" => deepgram(&client, &diarize.base_url, &key, &language, bytes).await?,
        "assemblyai" => assemblyai(&client, &diarize.base_url, &key, &language, bytes).await?,
        other => {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                &format!("proveedor de diarización desconocido: {other}"),
            ))
        }
    };
    if segments.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el proveedor no devolvió hablantes para este audio",
        ));
    }
    Ok(DiarizeResult {
        provider: diarize.kind,
        segments,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_deepgram_utterances() {
        let value: Value = serde_json::from_str(
            r#"{"results":{"utterances":[
                {"speaker":0,"start":0.1,"end":2.4,"transcript":"Hola"},
                {"speaker":1,"start":2.4,"end":5.0,"transcript":"Qué tal"}
            ]}}"#,
        )
        .unwrap();
        let segments = parse_deepgram(&value);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].speaker, "0");
        assert!((segments[1].end - 5.0).abs() < 1e-9);
    }

    #[test]
    fn parses_assemblyai_utterances_in_seconds() {
        let value: Value = serde_json::from_str(
            r#"{"utterances":[
                {"speaker":"A","start":100,"end":2400,"text":"Hola"},
                {"speaker":"B","start":2400,"end":5000,"text":"Qué tal"}
            ]}"#,
        )
        .unwrap();
        let segments = parse_assemblyai(&value);
        assert_eq!(segments.len(), 2);
        assert!((segments[0].start - 0.1).abs() < 1e-9);
        assert_eq!(segments[1].speaker, "B");
    }

    #[test]
    fn ignores_empty_or_inverted_segments() {
        let value: Value = serde_json::from_str(
            r#"{"results":{"utterances":[
                {"speaker":0,"start":2.0,"end":1.0,"transcript":"mal"},
                {"speaker":0,"start":0.0,"end":1.0,"transcript":"  "}
            ]}}"#,
        )
        .unwrap();
        assert!(parse_deepgram(&value).is_empty());
    }
}
