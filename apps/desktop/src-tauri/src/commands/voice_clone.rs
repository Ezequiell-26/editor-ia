//! Puente de clonación de voz local.
//!
//! La app no incluye un modelo neuronal de clonación (serían cientos de MB y
//! otro runtime). Este comando conecta un motor **local** que el usuario ya
//! tenga: XTTS API Server o GPT-SoVITS, ambos por HTTP en loopback. La app
//! valida la muestra de referencia, acota el texto y el idioma, no acepta URLs
//! remotas y guarda el WAV verificado dentro del proyecto. No envía datos a
//! internet ni presenta una voz SAPI disfrazada como clon.

use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::media::{probe_file, resolve_inside_root, sha256_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_TEXT_CHARS: usize = 2_000;
const MAX_REFERENCE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES: usize = 20 * 1024 * 1024;
const MIN_REFERENCE_SECONDS: f64 = 3.0;
const MAX_REFERENCE_SECONDS: f64 = 30.0;
const MAX_OUTPUT_SECONDS: f64 = 300.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CloneEngine {
    Xtts,
    GptSovits,
}

impl CloneEngine {
    pub(crate) fn parse(value: Option<&str>) -> Self {
        match value.unwrap_or("xtts").trim().to_ascii_lowercase().as_str() {
            "gpt-sovits" | "gptsovits" | "gpt_sovits" => Self::GptSovits,
            _ => Self::Xtts,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Xtts => "xtts",
            Self::GptSovits => "gpt-sovits",
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::Xtts => "/tts_to_audio/",
            Self::GptSovits => "/tts",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneVoiceRequest {
    /// Texto que se va a decir con la voz clonada.
    pub text: String,
    /// Muestra de referencia dentro del proyecto (WAV/MP3/M4A…).
    pub reference_path: String,
    /// Motor local: "xtts" (default) o "gpt-sovits".
    #[serde(default)]
    pub engine: Option<String>,
    /// Base HTTP del motor, obligatoriamente loopback.
    pub engine_url: String,
    /// Idioma del texto (es, en, pt, fr, de, it, zh, ja, ko, ru, ar, hi, tr…).
    #[serde(default = "default_language")]
    pub language: String,
    /// Transcripción de la referencia; GPT-SoVITS la usa para alinear.
    #[serde(default)]
    pub prompt_text: Option<String>,
    /// Si el motor local exige una clave, se manda como Bearer; no se persiste.
    #[serde(default)]
    pub api_key: Option<String>,
}

fn default_language() -> String {
    "es".to_owned()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneVoiceResult {
    /// Ruta relativa al proyecto (`media/voz-clonada-….wav`).
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: f64,
    pub language: String,
    pub engine: String,
    pub reference_sha256: String,
}

fn validate_text(text: &str) -> Result<String, ProjectError> {
    let clean = text.replace('\n', " ").trim().to_owned();
    if clean.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el texto para clonar la voz está vacío",
        ));
    }
    if clean.chars().count() > MAX_TEXT_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("el texto supera los {MAX_TEXT_CHARS} caracteres"),
        ));
    }
    Ok(clean)
}

const CLONE_LANGUAGES: &[&str] = &[
    "es", "en", "pt", "fr", "de", "it", "zh", "ja", "ko", "ru", "ar", "hi", "tr", "pl", "nl", "cs",
];

pub(crate) fn normalize_language(value: &str) -> Result<String, ProjectError> {
    let lower = value.trim().to_ascii_lowercase();
    let base = lower.split(['-', '_']).next().unwrap_or("");
    if CLONE_LANGUAGES.contains(&base) {
        Ok(base.to_owned())
    } else {
        Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el idioma no está entre los soportados por el motor local",
        ))
    }
}

/// Sólo loopback: la clonación no puede mandar la muestra a un host remoto.
pub(crate) fn local_engine_url(base: &str, engine: CloneEngine) -> Result<String, ProjectError> {
    let trimmed = base.trim().trim_end_matches('/');
    let path = engine.path().trim_end_matches('/');
    let full = if trimmed.ends_with(path) {
        trimmed.to_owned()
    } else {
        format!("{trimmed}{}", engine.path())
    };
    let url = Url::parse(&full).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor de voz no es válida",
        )
    })?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor no puede incluir usuario ni contraseña",
        ));
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor debe usar http o https",
        ));
    }
    if !matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1") | Some("[::1]")
    ) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el motor de clonación debe estar en loopback (localhost/127.0.0.1); no se envía la muestra a internet",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del motor no debe incluir query ni fragmento",
        ));
    }
    Ok(url.to_string())
}

fn validate_reference(ffprobe: &Path, reference: &Path) -> Result<(f64, String), ProjectError> {
    let metadata = std::fs::metadata(reference).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "la muestra de voz ya no está en el proyecto",
        )
    })?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la muestra de voz está vacía",
        ));
    }
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la muestra de voz supera los 20 MB",
        ));
    }
    let measure = probe_file(ffprobe, reference, MediaKind::Audio)?;
    let duration = measure.duration_seconds.unwrap_or(0.0);
    if !(MIN_REFERENCE_SECONDS..=MAX_REFERENCE_SECONDS).contains(&duration) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!(
                "la muestra debe durar entre {MIN_REFERENCE_SECONDS:.0} y {MAX_REFERENCE_SECONDS:.0} segundos"
            ),
        ));
    }
    let (sha256, _) = sha256_file(reference)?;
    Ok((duration, sha256))
}

fn is_wav(bytes: &[u8]) -> bool {
    bytes.len() > 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE"
}

async fn request_clone(
    engine: CloneEngine,
    endpoint: &str,
    reference: &Path,
    text: &str,
    language: &str,
    prompt_text: &str,
    api_key: Option<&str>,
) -> Result<Vec<u8>, ProjectError> {
    let reference = reference.to_string_lossy().into_owned();
    let body = match engine {
        CloneEngine::Xtts => json!({
            "text": text,
            "speaker_wav": reference,
            "language": language,
        }),
        CloneEngine::GptSovits => json!({
            "text": text,
            "text_lang": language,
            "ref_audio_path": reference,
            "prompt_lang": language,
            "prompt_text": prompt_text,
            "streaming_mode": false,
        }),
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión con el motor de voz",
            )
        })?;
    let mut call = client
        .post(endpoint)
        .json(&body)
        .header("Accept", "audio/wav, application/octet-stream");
    if let Some(secret) = api_key.filter(|value| !value.trim().is_empty()) {
        call = call.bearer_auth(secret.trim());
    }
    let response = call.send().await.map_err(|error| {
        let detail = if error.is_timeout() {
            "el motor local no respondió en 180 segundos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el motor local; revisá que esté encendido en la URL indicada"
                .to_owned()
        } else {
            "la llamada al motor local de voz falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &detail)
    })?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        let safe = detail.lines().next().unwrap_or("sin detalle");
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el motor local rechazó la clonación (HTTP {}): {}",
                status.as_u16(),
                safe.chars().take(200).collect::<String>()
            ),
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let bytes = response.bytes().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el motor local no devolvió un audio legible",
        )
    })?;
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el audio clonado supera los 20 MB",
        ));
    }
    if !is_wav(&bytes) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            &format!(
                "el motor devolvió {} y se esperaba un WAV; revisá el adaptador de {}",
                if content_type.is_empty() {
                    "un formato desconocido"
                } else {
                    content_type.as_str()
                },
                engine.name()
            ),
        ));
    }
    Ok(bytes.to_vec())
}

/// Clona la voz de una muestra del proyecto con un motor local y guarda el WAV.
#[tauri::command]
pub async fn clone_voice(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CloneVoiceRequest,
) -> Result<CloneVoiceResult, ProjectError> {
    let text = validate_text(&request.text)?;
    let language = normalize_language(&request.language)?;
    let engine = CloneEngine::parse(request.engine.as_deref());
    let endpoint = local_engine_url(&request.engine_url, engine)?;
    let session = state.require_session()?;
    let reference = resolve_inside_root(&session.root, &request.reference_path)?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe es necesario para validar la muestra y el audio clonado",
        ));
    };
    let _ = app.emit(
        "clone-progress",
        json!({ "percent": 5.0, "stage": "Validando la muestra de voz" }),
    );
    let (reference_seconds, reference_sha) = validate_reference(&ffprobe, &reference)?;
    if reference_seconds < MIN_REFERENCE_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la muestra es demasiado corta para clonar la voz",
        ));
    }
    let prompt_text = request
        .prompt_text
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .chars()
        .take(1_000)
        .collect::<String>();
    let _ = app.emit(
        "clone-progress",
        json!({ "percent": 35.0, "stage": "Generando la voz en el motor local" }),
    );
    let audio = request_clone(
        engine,
        &endpoint,
        &reference,
        &text,
        &language,
        &prompt_text,
        request.api_key.as_deref(),
    )
    .await?;
    let media_dir = session.root.join("media");
    std::fs::create_dir_all(&media_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar la carpeta media: {error}").as_str(),
        )
    })?;
    let temp = media_dir.join(format!(".clone-{}.wav", Uuid::new_v4()));
    std::fs::write(&temp, &audio).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo guardar el audio clonado: {error}").as_str(),
        )
    })?;
    let measure = probe_file(&ffprobe, &temp, MediaKind::Audio).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        error
    })?;
    let duration = measure.duration_seconds.unwrap_or(0.0);
    if !(0.05..=MAX_OUTPUT_SECONDS).contains(&duration) {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el audio clonado no tiene una duración válida",
        ));
    }
    let final_name = format!("voz-clonada-{}.wav", Uuid::new_v4());
    let final_path = media_dir.join(&final_name);
    std::fs::rename(&temp, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el audio clonado: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(&final_path)
        .map(|metadata| metadata.len())
        .unwrap_or(audio.len() as u64);
    let _ = app.emit(
        "clone-progress",
        json!({ "percent": 100.0, "stage": "Voz clonada lista" }),
    );
    Ok(CloneVoiceResult {
        path: format!("media/{final_name}"),
        bytes,
        duration_seconds: duration,
        language,
        engine: engine.name().to_owned(),
        reference_sha256: reference_sha,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_urls_are_loopback_and_get_the_right_path() {
        assert_eq!(
            local_engine_url("http://127.0.0.1:8020", CloneEngine::Xtts).expect("xtts"),
            "http://127.0.0.1:8020/tts_to_audio/"
        );
        assert_eq!(
            local_engine_url("http://localhost:9880/tts", CloneEngine::GptSovits).expect("sovits"),
            "http://localhost:9880/tts"
        );
        assert!(local_engine_url("https://api.example.com", CloneEngine::Xtts).is_err());
        assert!(local_engine_url("http://user:pass@127.0.0.1:8020", CloneEngine::Xtts).is_err());
        assert!(local_engine_url("ftp://127.0.0.1", CloneEngine::Xtts).is_err());
        assert!(local_engine_url("http://127.0.0.1:8020?x=1", CloneEngine::Xtts).is_err());
    }

    #[test]
    fn languages_and_text_are_bounded() {
        assert_eq!(normalize_language("es-AR").expect("es"), "es");
        assert_eq!(normalize_language("ZH-cn").expect("zh"), "zh");
        assert!(normalize_language("xx").is_err());
        assert!(validate_text("  ").is_err());
        assert!(validate_text(&"a".repeat(MAX_TEXT_CHARS + 1)).is_err());
        assert_eq!(
            validate_text("  Hola\nmundo  ").expect("texto"),
            "Hola mundo"
        );
    }

    #[test]
    fn recognizes_a_riff_wav_without_trusting_the_header_alone() {
        let wav = b"RIFF\x24\x00\x00\x00WAVEfmt ";
        assert!(is_wav(wav));
        assert!(!is_wav(b"RIFF\x24\x00\x00\x00AVI "));
        assert!(!is_wav(b"<html></html>"));
    }

    #[test]
    fn engine_parser_defaults_to_xtts() {
        assert_eq!(CloneEngine::parse(None), CloneEngine::Xtts);
        assert_eq!(
            CloneEngine::parse(Some("gpt-sovits")),
            CloneEngine::GptSovits
        );
        assert_eq!(CloneEngine::parse(Some("otro")), CloneEngine::Xtts);
        assert_eq!(CloneEngine::Xtts.name(), "xtts");
        assert_eq!(CloneEngine::GptSovits.name(), "gpt-sovits");
    }

    fn tiny_wav() -> Vec<u8> {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&36u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&16_000u32.to_le_bytes());
        wav.extend_from_slice(&32_000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&0u32.to_le_bytes());
        wav
    }

    #[tokio::test]
    async fn posts_the_reference_to_a_loopback_engine_and_accepts_wav() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("addr");
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = Vec::new();
            let mut chunk = [0u8; 2048];
            loop {
                let read = socket.read(&mut chunk).await.expect("read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(header_end) = request
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .map(|index| index + 4)
                else {
                    continue;
                };
                let head = String::from_utf8_lossy(&request[..header_end]);
                let length = head
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if request.len() >= header_end + length {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&request);
            assert!(text.contains("POST /tts_to_audio/"));
            assert!(text.contains("\"speaker_wav\""));
            assert!(text.contains("\"text\""));
            let wav = tiny_wav();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                wav.len()
            );
            socket.write_all(response.as_bytes()).await.expect("write");
            socket.write_all(&wav).await.expect("wav");
        });
        let endpoint =
            local_engine_url(&format!("http://{address}"), CloneEngine::Xtts).expect("endpoint");
        let audio = request_clone(
            CloneEngine::Xtts,
            &endpoint,
            Path::new("C:\\muestra.wav"),
            "Hola mundo",
            "es",
            "",
            None,
        )
        .await
        .expect("audio");
        assert!(is_wav(&audio));
        server.await.expect("server");
    }
}
