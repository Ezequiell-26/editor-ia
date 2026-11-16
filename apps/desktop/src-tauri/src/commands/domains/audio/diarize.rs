//! Diarización por proveedor externo.
//!
//! La app no trae un modelo de hablantes: sería otro binario de cientos de MB.
//! En cambio, la persona configura su propia API —Deepgram o AssemblyAI, free
//! o paga— y la clave queda en el almacén de Windows, nunca en los ajustes.
//!
//! El comando devuelve tramos con hablante; el mapeo a subtítulos vive en el
//! frontend (`state/speakers.ts`), que decide por solapamiento.
//!
//! DTOs, parsers de respuesta y validación de la config viven en
//! `application::diarize`; acá queda el keyring de Windows y las llamadas HTTP.

use std::time::Duration;

use keyring::Entry;
use serde_json::{json, Value};
use tauri::State;

use crate::commands::system::resolve_tools;
use crate::media::{probe_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::{AppState, DiarizeSettings};

// DTOs, constantes, parsers y validación: `application::diarize`.
pub use crate::application::diarize::*;

/// Tope de subida, alineado con el límite de audio pre-grabado de los
/// proveedores (~2 GB). Por encima, el costo y la espera dejan de ser
/// razonables para el audio de un clip del editor.
const MAX_DIARIZE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Tope de duración medido con ffprobe cuando está disponible.
const MAX_DIARIZE_SECONDS: f64 = 4.0 * 3600.0;
/// Tope de la respuesta JSON del proveedor: las transcripciones de horas
/// de audio no deberían acercarse a esto.
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

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
    let config = normalize_diarize_config(&kind, &base_url, &language)?;

    if let Some(secret) = api_key {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            validate_api_key(trimmed)?;
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
        kind: config.kind,
        base_url: config.base_url,
        language: config.language,
    };
    state.save_settings(&settings)?;
    Ok(provider_info(&settings.diarize))
}

/// Lee el cuerpo por chunks con tope estricto (`commands::read_body_capped`,
/// el helper compartido de `infrastructure::http`).
const DIARIZE_INTERRUPTED: &str = "la respuesta del proveedor se cortó";

/// Igual que `response.json()` pero con tope de bytes antes de parsear.
async fn read_json_capped(
    response: reqwest::Response,
    unreadable: &str,
) -> Result<Value, ProjectError> {
    let bytes = crate::commands::read_body_capped(
        response,
        MAX_RESPONSE_BYTES,
        ProjectErrorCode::InvalidProviderResponse,
        "la respuesta del proveedor de diarización supera el límite",
        DIARIZE_INTERRUPTED,
    )
    .await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| ProjectError::message(ProjectErrorCode::InvalidProviderResponse, unreadable))
}

async fn deepgram(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    language: &str,
    body: reqwest::Body,
    content_length: u64,
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
        .header("Content-Length", content_length.to_string())
        .body(body)
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
    let value =
        read_json_capped(response, "Deepgram devolvió una respuesta que no entiendo").await?;
    Ok(parse_deepgram(&value))
}

async fn assemblyai(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    language: &str,
    body: reqwest::Body,
    content_length: u64,
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
        .header("Content-Length", content_length.to_string())
        .body(body)
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
    let uploaded = read_json_capped(upload, "AssemblyAI no devolvió la URL de subida").await?;
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
    let created = read_json_capped(created, "AssemblyAI no devolvió el id del trabajo").await?;
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
        let value = read_json_capped(poll, "AssemblyAI devolvió un estado ilegible").await?;
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
    asset_id: String,
    language: Option<String>,
) -> Result<DiarizeResult, ProjectError> {
    let settings = state.settings_snapshot()?;
    let diarize = settings.diarize.clone();
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
    // AUD-087: el audio viaja a un proveedor externo, así que el comando no
    // acepta una ruta arbitraria — recibe el id del asset, lo resuelve
    // dentro del proyecto abierto y exige kind video/audio con archivo
    // presente (misma política que la onda de `audio.rs`).
    let session = state.require_session()?;
    let (_kind, source) = crate::commands::audio::resolve_audio_asset(&session, &asset_id)?;
    // Límites antes de subir: el archivo viaja a un proveedor externo y su
    // respuesta puede ser grande; nada de eso debe leerse sin tope.
    let metadata = std::fs::metadata(&source).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude leer el archivo de audio")
    })?;
    if metadata.len() > MAX_DIARIZE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::FileTooLarge,
            "el audio supera el máximo de 2 GB para diarización",
        ));
    }
    let (_, ffprobe, _) = resolve_tools(&settings);
    if let Some(ffprobe) = ffprobe {
        if let Ok(measure) = probe_file(&ffprobe, &source, MediaKind::Audio) {
            if measure
                .duration_seconds
                .is_some_and(|duration| duration > MAX_DIARIZE_SECONDS)
            {
                return Err(ProjectError::message(
                    ProjectErrorCode::FileTooLarge,
                    "el audio supera las 4 horas máximas para diarización",
                ));
            }
        }
    }
    let content_length = metadata.len();
    // Subida por streaming: el archivo no se carga entero en RAM.
    let file = tokio::fs::File::open(&source).await.map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude leer el archivo de audio")
    })?;
    let body = reqwest::Body::from(file);
    let language = language
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or(diarize.language.clone());
    let client = reqwest::Client::new();
    let segments = match diarize.kind.as_str() {
        "deepgram" => {
            deepgram(
                &client,
                &diarize.base_url,
                &key,
                &language,
                body,
                content_length,
            )
            .await?
        }
        "assemblyai" => {
            assemblyai(
                &client,
                &diarize.base_url,
                &key,
                &language,
                body,
                content_length,
            )
            .await?
        }
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
    use std::io::{Read, Write};

    /// Sirve una respuesta HTTP/1.1 cruda en loopback y devuelve la URL.
    /// Mismo patrón que `lip_sync::tests::spawn_raw_server`.
    fn spawn_raw_server(head: &'static str, body: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 8192];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\n");
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(b"\r\n\r\n");
                let _ = stream.write_all(&body);
                let _ = stream.flush();
            }
        });
        format!("http://{addr}/")
    }

    async fn fetch(url: &str) -> reqwest::Response {
        reqwest::Client::new()
            .get(url)
            .send()
            .await
            .expect("respuesta del servidor de prueba")
    }

    #[tokio::test]
    async fn read_json_capped_parses_small_json() {
        let url = spawn_raw_server("Connection: close", b"{\"a\":1}".to_vec());
        let response = fetch(&url).await;
        let value = read_json_capped(response, "ilegible")
            .await
            .expect("json válido");
        assert_eq!(value["a"], 1);
    }
}
