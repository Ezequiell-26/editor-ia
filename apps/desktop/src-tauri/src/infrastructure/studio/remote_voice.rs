//! `ContentGenerator` remoto: narración TTS OpenAI-compatible
//! (`POST /audio/speech`).
//!
//! Mismo BYOK que `remote_image`: configuración del provider de chat en
//! settings + clave en el Credential Manager. La respuesta es audio crudo
//! (no JSON): se valida el magic `RIFF`/`WAVE` antes de guardar.
//!
//! Coste: la API de speech no informa precio por llamada ⇒
//! `cost_cents: None`; el gasto se controla con `maxCostCents` del plan,
//! igual que la imagen remota (endpoint no-local lo exige).

use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use crate::ai::providers::{is_local_endpoint, validate_provider_base_url};
use crate::ports::ai::ProviderConfig;
use crate::ports::studio::{
    ContentGenerator, GenerationCapability, GenerationRequest, GenerationResult,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::StudioResourceKind;

const PROVIDER_ID: &str = "remote-tts-openai";
/// La narración puede tardar más que una imagen: TTS de textos largos.
const SPEECH_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_AUDIO_BYTES: usize = 64 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 4_000;
/// Voces documentadas por la API de speech de OpenAI; con otro endpoint
/// compatible el usuario puede pasar cualquier nombre en `req.voice`.
const DEFAULT_VOICE: &str = "alloy";
const ALLOWED_FORMATS: &[&str] = &["wav", "mp3", "opus", "aac", "flac", "pcm"];

pub struct RemoteVoiceGenerator {
    config: ProviderConfig,
    key: Option<String>,
}

impl RemoteVoiceGenerator {
    pub fn new(config: ProviderConfig, key: Option<String>) -> Self {
        Self { config, key }
    }

    /// Endpoint no-loopback ⇒ la llamada sale a internet y puede costar.
    pub fn is_local(&self) -> bool {
        is_local_endpoint(&self.config.base_url)
    }

    pub fn usable(&self) -> bool {
        !self.config.base_url.trim().is_empty()
            && !self.config.model.trim().is_empty()
            && (self.is_local() || self.key.is_some())
    }

    fn endpoint(&self) -> String {
        format!(
            "{}/audio/speech",
            self.config.base_url.trim_end_matches('/')
        )
    }
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn provider_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, message)
}

fn rejected(status: u16) -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::InvalidProviderResponse,
        &format!("el proveedor de voz rechazó la síntesis (HTTP {status})"),
    )
}

/// Extensión por magic bytes del audio devuelto. `wav` es el formato que
/// pedimos; `mp3`/`flac`/`ogg` cubren endpoints que ignoran `response_format`.
fn audio_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("wav");
    }
    if bytes.len() >= 3 && &bytes[0..3] == b"ID3" || bytes.len() >= 2 && &bytes[0..2] == b"\xff\xfb"
    {
        return Some("mp3");
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"fLaC" {
        return Some("flac");
    }
    if bytes.len() >= 4 && &bytes[0..4] == b"OggS" {
        return Some("ogg");
    }
    None
}

fn safe_file_stem(request_id: &str) -> String {
    let stem: String = request_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let stem: String = stem.chars().take(64).collect();
    if stem.is_empty() {
        "voice".to_owned()
    } else {
        stem
    }
}

/// POST a `/audio/speech`. La respuesta exitosa es el audio en crudo
/// (no JSON); los errores sí pueden venir en JSON pero sólo se usa el
/// status — nunca se devuelve cuerpo del proveedor al usuario.
fn post_speech(generator: &RemoteVoiceGenerator, body: &Value) -> Result<Vec<u8>, ProjectError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(SPEECH_TIMEOUT)
        .build()
        .map_err(|_| provider_error("no se pudo preparar la conexión con el proveedor"))?;
    let mut request = client
        .post(generator.endpoint())
        .json(body)
        .header("Accept", "audio/*");
    if let Some(key) = generator.key.clone() {
        request = request.bearer_auth(key);
    }
    let mut response = request.send().map_err(|error| {
        let safe = if error.is_timeout() {
            format!(
                "el proveedor de voz no respondió en {} segundos",
                SPEECH_TIMEOUT.as_secs()
            )
        } else if error.is_connect() {
            "no se pudo conectar con el proveedor de voz".to_owned()
        } else {
            "la llamada al proveedor de voz falló".to_owned()
        };
        provider_error(&safe)
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(rejected(status.as_u16()));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take((MAX_AUDIO_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta del proveedor de voz quedó incompleta",
            )
        })?;
    if bytes.len() > MAX_AUDIO_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el audio devuelto por el proveedor supera el límite de 64 MB",
        ));
    }
    Ok(bytes)
}

impl ContentGenerator for RemoteVoiceGenerator {
    fn provider_id(&self) -> &str {
        PROVIDER_ID
    }

    fn capabilities(&self) -> Vec<GenerationCapability> {
        vec![GenerationCapability {
            provider: PROVIDER_ID.to_owned(),
            model: self.config.model.clone(),
            kind: StudioResourceKind::Voice,
            // La API de speech no informa el coste por llamada.
            estimated_cost_cents: None,
            limits: ALLOWED_FORMATS
                .iter()
                .map(|format| format!("response_format {format}"))
                .chain(std::iter::once(
                    "endpoint /audio/speech compatible con OpenAI".to_owned(),
                ))
                .collect(),
            requires_network: !self.is_local(),
        }]
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        project_root: &Path,
    ) -> Result<GenerationResult, ProjectError> {
        if request.kind != StudioResourceKind::Voice {
            return Err(invalid("el generador remoto de voz sólo produce narración"));
        }
        if !self.usable() {
            return Err(provider_error(
                "el proveedor de voz no está configurado (URL, modelo y clave)",
            ));
        }
        validate_provider_base_url(&self.config.base_url)?;
        if !self.is_local() && self.key.is_none() {
            return Err(provider_error(
                "falta la clave del proveedor en el almacén de Windows",
            ));
        }
        let text: String = request.prompt.trim().chars().take(MAX_TEXT_CHARS).collect();
        if text.is_empty() {
            return Err(invalid("el texto para la voz no puede estar vacío"));
        }
        let voice = request
            .voice
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(DEFAULT_VOICE)
            .to_owned();
        let format = request
            .params
            .get("response_format")
            .and_then(Value::as_str)
            .filter(|f| ALLOWED_FORMATS.contains(f))
            .unwrap_or("wav")
            .to_owned();
        // `params.model` permite sobreescribir el modelo del provider para
        // esta llamada (p.ej. `tts-1` cuando el provider está configurado
        // con un modelo de chat). Sin override se usa el configurado.
        let model = request
            .params
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or(&self.config.model)
            .to_owned();
        let bytes = post_speech(
            self,
            &json!({
                "model": model,
                "input": text,
                "voice": voice,
                "response_format": format,
            }),
        )?;
        let ext = audio_extension(&bytes).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el proveedor devolvió bytes que no son audio reconocible",
            )
        })?;

        let dir = project_root.join("generated");
        std::fs::create_dir_all(&dir).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo crear el directorio de generados: {e}"),
            )
        })?;
        let file_name = format!("{}.{}", safe_file_stem(&request.request_id), ext);
        let abs: PathBuf = dir.join(&file_name);
        std::fs::write(&abs, &bytes).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo guardar el audio generado: {e}"),
            )
        })?;
        Ok(GenerationResult {
            path: format!("generated/{file_name}"),
            bytes: bytes.len() as u64,
            provider: PROVIDER_ID.to_owned(),
            model: self.config.model.clone(),
            cost_cents: None,
            license: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::net::TcpListener;

    /// WAV mínimo válido: header RIFF/WAVE + fmt + data vacía.
    fn wav_bytes() -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"RIFF");
        b.extend_from_slice(&36u32.to_le_bytes());
        b.extend_from_slice(b"WAVEfmt ");
        b.extend_from_slice(&16u32.to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes()); // PCM
        b.extend_from_slice(&1u16.to_le_bytes()); // mono
        b.extend_from_slice(&24000u32.to_le_bytes()); // rate
        b.extend_from_slice(&48000u32.to_le_bytes()); // byte rate
        b.extend_from_slice(&2u16.to_le_bytes()); // block align
        b.extend_from_slice(&16u16.to_le_bytes()); // bits
        b.extend_from_slice(b"data");
        b.extend_from_slice(&0u32.to_le_bytes());
        b
    }

    /// Servidor HTTP/1.1 mínimo: responde las respuestas en orden.
    fn serve(responses: Vec<(u16, Vec<u8>)>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = [0u8; 8192];
                let _ = stream.read(&mut buf);
                let reason = if status == 200 { "OK" } else { "ERR" };
                let head = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(head.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        (format!("http://{addr}/v1"), handle)
    }

    fn generator(base_url: &str) -> RemoteVoiceGenerator {
        RemoteVoiceGenerator::new(
            ProviderConfig {
                kind: "openai-compatible".to_owned(),
                base_url: base_url.to_owned(),
                model: "tts-1".to_owned(),
            },
            None,
        )
    }

    fn request() -> GenerationRequest {
        GenerationRequest {
            request_id: "run-1-req-voz-s1-0".to_owned(),
            kind: StudioResourceKind::Voice,
            prompt: "Hola, esto es una prueba de voz.".to_owned(),
            duration_seconds: None,
            voice: Some("alloy".to_owned()),
            params: json!({}),
        }
    }

    #[test]
    fn generate_writes_wav_from_speech_endpoint() {
        let (base, _h) = serve(vec![(200, wav_bytes())]);
        let gen = generator(&base);
        let dir = std::env::temp_dir().join(format!("tts-{}", uuid::Uuid::new_v4()));
        let result = gen.generate(&request(), &dir).unwrap();
        assert!(result.path.ends_with(".wav"), "{}", result.path);
        assert_eq!(result.provider, PROVIDER_ID);
        assert_eq!(result.cost_cents, None);
        let saved = std::fs::read(
            dir.join("generated")
                .join(result.path.strip_prefix("generated/").unwrap()),
        )
        .unwrap();
        assert_eq!(&saved[0..4], b"RIFF");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn generate_rejects_non_audio_payload() {
        let (base, _h) = serve(vec![(200, b"not audio at all".to_vec())]);
        let gen = generator(&base);
        let dir = std::env::temp_dir().join(format!("tts-{}", uuid::Uuid::new_v4()));
        let error = gen.generate(&request(), &dir).unwrap_err();
        assert!(error.message.contains("audio"), "{}", error.message);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn generate_rejects_auth_failure() {
        let (base, _h) = serve(vec![(401, b"{}".to_vec())]);
        let gen = generator(&base);
        let dir = std::env::temp_dir().join(format!("tts-{}", uuid::Uuid::new_v4()));
        let error = gen.generate(&request(), &dir).unwrap_err();
        assert!(error.message.contains("401"), "{}", error.message);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remote_endpoint_without_key_is_not_usable() {
        let gen = RemoteVoiceGenerator::new(
            ProviderConfig {
                kind: "openai-compatible".to_owned(),
                base_url: "https://api.example.com/v1".to_owned(),
                model: "tts-1".to_owned(),
            },
            None,
        );
        assert!(!gen.usable());
        assert!(!gen.is_local());
    }

    #[test]
    fn loopback_endpoint_is_usable_without_key() {
        let gen = generator("http://127.0.0.1:9999/v1");
        assert!(gen.usable());
        assert!(gen.is_local());
    }
}
