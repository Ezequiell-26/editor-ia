//! Generador remoto de imágenes sobre la API OpenAI-compatible
//! `/images/generations`, usando la configuración BYOK del proveedor de chat
//! (`ProviderConfig` + clave del Credential Manager).
//!
//! Honesto por contrato:
//! - Sólo existe cuando el usuario configuró un proveedor `openai-compatible`
//!   con URL y modelo; sin clave en endpoints remotos no se construye.
//! - La API no devuelve el coste real: `cost_cents` queda `None` y la
//!   capability declara `estimated_cost_cents: None`. El gasto se controla
//!   por el presupuesto del plan (`maxCostCents`), que el ejecutor exige
//!   antes de llamar a un endpoint no-local.
//! - La licencia del resultado es `provider-terms`/`unknown`: los derechos
//!   dependen de los términos del proveedor, no se declaran `allowed`.
//! - Soporta `b64_json` (OpenAI/gpt-image) y `url` (DALL·E) con validación
//!   de esquema y tope de bytes en la descarga.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde_json::{json, Value};

use crate::ai::providers::{is_local_endpoint, validate_provider_base_url};
use crate::ports::ai::ProviderConfig;
use crate::ports::studio::{
    ContentGenerator, GenerationCapability, GenerationRequest, GenerationResult,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::StudioResourceKind;

const PROVIDER_ID: &str = "openai-compatible-image";
const IMAGE_TIMEOUT: Duration = Duration::from_secs(120);
/// Una imagen 1024×1024 en b64 ronda 1–3 MB; 32 MB cubre URLs grandes sin
/// abrir la puerta a descargas descontroladas.
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PROMPT_CHARS: usize = 2_000;
const ALLOWED_SIZES: [&str; 5] = ["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"];

/// Generador de imágenes remoto configurable por el usuario (BYOK).
pub struct RemoteImageGenerator {
    config: ProviderConfig,
    key: Option<String>,
}

impl RemoteImageGenerator {
    pub fn new(config: ProviderConfig, key: Option<String>) -> Self {
        Self { config, key }
    }

    /// Endpoint no-loopback ⇒ la llamada sale a internet y puede costar
    /// dinero: el ejecutor exige presupuesto declarado en el plan.
    pub fn is_local(&self) -> bool {
        is_local_endpoint(&self.config.base_url)
    }

    /// ¿La configuración del proveedor alcanza para intentar generar?
    /// Remoto exige clave; local (shim de pruebas) puede ir sin ella.
    pub fn usable(&self) -> bool {
        self.config.kind == "openai-compatible"
            && !self.config.base_url.trim().is_empty()
            && !self.config.model.trim().is_empty()
            && (self.is_local() || self.key.is_some())
    }

    fn endpoint(&self) -> String {
        format!(
            "{}/images/generations",
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
        ProjectErrorCode::ProviderRejected,
        &format!("el proveedor de imagen rechazó la solicitud (HTTP {status})"),
    )
}

/// Magic bytes de los formatos que aceptamos como imagen generada.
fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
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
        "image".to_owned()
    } else {
        stem
    }
}

/// POST a `/images/generations`. `json_mode` equivale a pedir
/// `response_format: b64_json`; si el endpoint lo rechaza (400/415/422) se
/// reintenta una vez sin el parámetro y se acepta `url` como fallback.
fn post_images(generator: &RemoteImageGenerator, body: &Value) -> Result<Value, ProjectError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(IMAGE_TIMEOUT)
        .build()
        .map_err(|_| provider_error("no se pudo preparar la conexión con el proveedor"))?;
    let mut attempt = 0u8;
    let mut with_format = true;
    loop {
        attempt += 1;
        let mut payload = body.clone();
        if with_format {
            payload["response_format"] = json!("b64_json");
        } else {
            if let Some(map) = payload.as_object_mut() {
                map.remove("response_format");
            }
        }
        let mut request = client
            .post(generator.endpoint())
            .json(&payload)
            .header("Accept", "application/json");
        if let Some(key) = generator.key.clone() {
            request = request.bearer_auth(key);
        }
        let response = request.send().map_err(|error| {
            let safe = if error.is_timeout() {
                format!(
                    "el proveedor de imagen no respondió en {} segundos",
                    IMAGE_TIMEOUT.as_secs()
                )
            } else if error.is_connect() {
                "no se pudo conectar con el proveedor de imagen".to_owned()
            } else {
                "la llamada al proveedor de imagen falló".to_owned()
            };
            provider_error(&safe)
        })?;
        let status = response.status();
        if attempt == 1 && with_format && matches!(status.as_u16(), 400 | 415 | 422) {
            with_format = false;
            continue;
        }
        if !status.is_success() {
            return Err(rejected(status.as_u16()));
        }
        let bytes = response.bytes().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el proveedor de imagen no devolvió un cuerpo legible",
            )
        })?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta del proveedor de imagen supera el límite de 32 MB",
            ));
        }
        return serde_json::from_slice(&bytes).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el proveedor de imagen no devolvió un JSON interpretable",
            )
        });
    }
}

/// Descarga la imagen desde la URL que devolvió el proveedor. La URL es
/// dato remoto no confiable: se exige https (o loopback) y sin credenciales
/// embebidas, y los bytes se validan por magic antes de guardarse.
fn download_image(generator: &RemoteImageGenerator, url: &str) -> Result<Vec<u8>, ProjectError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor devolvió una URL de imagen inválida",
        )
    })?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la URL de imagen del proveedor no puede incluir credenciales",
        ));
    }
    let local = is_local_endpoint(url);
    if parsed.scheme() != "https" && !local {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la URL de imagen del proveedor debe usar https",
        ));
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(IMAGE_TIMEOUT)
        .build()
        .map_err(|_| provider_error("no se pudo preparar la descarga de la imagen"))?;
    let mut request = client.get(parsed).header("Accept", "image/*");
    if let Some(key) = generator.key.clone() {
        request = request.bearer_auth(key);
    }
    let mut response = request.send().map_err(|_| {
        provider_error("no se pudo descargar la imagen generada desde el proveedor")
    })?;
    if !response.status().is_success() {
        return Err(rejected(response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take((MAX_IMAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la descarga de la imagen quedó incompleta",
            )
        })?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la imagen descargada supera el límite de 32 MB",
        ));
    }
    Ok(bytes)
}

impl ContentGenerator for RemoteImageGenerator {
    fn provider_id(&self) -> &str {
        PROVIDER_ID
    }

    fn capabilities(&self) -> Vec<GenerationCapability> {
        vec![GenerationCapability {
            provider: PROVIDER_ID.to_owned(),
            model: self.config.model.clone(),
            kind: StudioResourceKind::Image,
            // La API de imágenes no informa el coste por llamada.
            estimated_cost_cents: None,
            limits: ALLOWED_SIZES
                .iter()
                .map(|size| format!("size {size}"))
                .chain(std::iter::once(
                    "endpoint /images/generations compatible con OpenAI".to_owned(),
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
        if request.kind != StudioResourceKind::Image {
            return Err(invalid("el generador remoto sólo produce imágenes"));
        }
        if !self.usable() {
            return Err(provider_error(
                "el proveedor de imagen no está configurado (URL, modelo y clave)",
            ));
        }
        validate_provider_base_url(&self.config.base_url)?;
        if !self.is_local() && self.key.is_none() {
            return Err(provider_error(
                "falta la clave del proveedor en el almacén de Windows",
            ));
        }
        let prompt: String = request
            .prompt
            .trim()
            .chars()
            .take(MAX_PROMPT_CHARS)
            .collect();
        if prompt.is_empty() {
            return Err(invalid("el prompt de imagen no puede estar vacío"));
        }
        let size = request
            .params
            .get("size")
            .and_then(Value::as_str)
            .filter(|size| ALLOWED_SIZES.contains(size))
            .unwrap_or("1024x1024")
            .to_owned();
        let payload = post_images(
            self,
            &json!({
                "model": self.config.model,
                "prompt": prompt,
                "size": size,
                "n": 1,
            }),
        )?;
        let item = payload["data"][0].clone();
        let (bytes, ext) = if let Some(b64) = item["b64_json"].as_str() {
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|_| {
                    ProjectError::message(
                        ProjectErrorCode::InvalidProviderResponse,
                        "la imagen devuelta no es base64 válido",
                    )
                })?;
            let ext = image_extension(&decoded).ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "el proveedor devolvió bytes que no son una imagen reconocible",
                )
            })?;
            (decoded, ext)
        } else if let Some(url) = item["url"].as_str() {
            let downloaded = download_image(self, url)?;
            let ext = image_extension(&downloaded).unwrap_or("png");
            if image_extension(&downloaded).is_none() {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "la imagen descargada no tiene un formato reconocible",
                ));
            }
            (downloaded, ext)
        } else {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta del proveedor no trae data[0].b64_json ni data[0].url",
            ));
        };

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
                &format!("no se pudo guardar la imagen generada: {e}"),
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

    /// Servidor HTTP/1.1 mínimo síncrono: una respuesta por conexión, en
    /// orden. Devuelve la base URL `…/v1` (como los tests de `ai::chat`).
    fn serve(responses: Vec<String>) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("puerto de prueba");
        let address = listener.local_addr().expect("dirección");
        let handle = std::thread::spawn(move || {
            for response in responses {
                let Ok((mut socket, _)) = listener.accept() else {
                    return;
                };
                let mut buffer = [0u8; 8192];
                let _ = socket.read(&mut buffer);
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
            }
        });
        (format!("http://{address}/v1"), handle)
    }

    fn http_response(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// PNG 1×1 válido en base64.
    const TINY_PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    fn generator(base_url: &str) -> RemoteImageGenerator {
        RemoteImageGenerator::new(
            ProviderConfig {
                kind: "openai-compatible".to_owned(),
                base_url: base_url.to_owned(),
                model: "test-image".to_owned(),
            },
            None,
        )
    }

    fn request() -> GenerationRequest {
        GenerationRequest {
            request_id: "req-test/1".to_owned(),
            kind: StudioResourceKind::Image,
            prompt: "un gato".to_owned(),
            duration_seconds: None,
            voice: None,
            params: json!({}),
        }
    }

    #[test]
    fn generate_writes_png_from_b64_json() {
        let body = format!(r#"{{"data":[{{"b64_json":"{TINY_PNG_B64}"}}]}}"#);
        let (base, server) = serve(vec![http_response("200 OK", &body)]);
        let temp = std::env::temp_dir().join(format!("img-gen-{}", uuid::Uuid::new_v4()));
        let result = generator(&base).generate(&request(), &temp).unwrap();
        let _ = server.join();
        assert_eq!(result.provider, PROVIDER_ID);
        assert!(result.path.starts_with("generated/"));
        let saved = temp.join(&result.path);
        let bytes = std::fs::read(&saved).unwrap();
        assert!(image_extension(&bytes).is_some());
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn generate_retries_without_response_format_on_400() {
        let body = format!(r#"{{"data":[{{"b64_json":"{TINY_PNG_B64}"}}]}}"#);
        let (base, server) = serve(vec![
            http_response(
                "400 Bad Request",
                r#"{"error":"response_format unsupported"}"#,
            ),
            http_response("200 OK", &body),
        ]);
        let temp = std::env::temp_dir().join(format!("img-gen-{}", uuid::Uuid::new_v4()));
        let result = generator(&base).generate(&request(), &temp).unwrap();
        let _ = server.join();
        assert!(temp.join(&result.path).exists());
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn generate_rejects_auth_failure_without_retry() {
        let (base, server) = serve(vec![http_response(
            "401 Unauthorized",
            r#"{"error":"bad key"}"#,
        )]);
        let temp = std::env::temp_dir().join(format!("img-gen-{}", uuid::Uuid::new_v4()));
        let error = generator(&base)
            .generate(&request(), &temp)
            .expect_err("401 no se reintenta");
        let _ = server.join();
        assert!(error.message.contains("401"), "{}", error.message);
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn generate_rejects_non_image_payload() {
        let body = r#"{"data":[{"b64_json":"aGVsbG8gd29ybGQ="}]}"#; // "hello world"
        let (base, server) = serve(vec![http_response("200 OK", body)]);
        let temp = std::env::temp_dir().join(format!("img-gen-{}", uuid::Uuid::new_v4()));
        let error = generator(&base)
            .generate(&request(), &temp)
            .expect_err("bytes que no son imagen se rechazan");
        let _ = server.join();
        assert!(error.message.contains("imagen"), "{}", error.message);
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn generate_rejects_non_https_image_url() {
        // Una URL `http://` no-loopback en la respuesta del proveedor se
        // rechaza antes de descargar (la clave no puede viajar en claro).
        let body = r#"{"data":[{"url":"http://evil.example/x.png"}]}"#;
        let (base, server) = serve(vec![http_response("200 OK", body)]);
        let temp = std::env::temp_dir().join(format!("img-gen-{}", uuid::Uuid::new_v4()));
        let error = generator(&base)
            .generate(&request(), &temp)
            .expect_err("URL http remota debe rechazarse");
        let _ = server.join();
        assert!(error.message.contains("https"), "{}", error.message);
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn usable_requires_key_for_remote() {
        let remote = RemoteImageGenerator::new(
            ProviderConfig {
                kind: "openai-compatible".to_owned(),
                base_url: "https://api.ejemplo.com/v1".to_owned(),
                model: "m".to_owned(),
            },
            None,
        );
        assert!(!remote.usable());
        let local = RemoteImageGenerator::new(
            ProviderConfig {
                kind: "openai-compatible".to_owned(),
                base_url: "http://127.0.0.1:1234/v1".to_owned(),
                model: "m".to_owned(),
            },
            None,
        );
        assert!(local.usable());
    }
}
