//! Adaptadores del dominio AI.
//!
//! - `KeyringProviderSecrets`: API key en el Windows Credential Manager.
//! - `StateProviderSettings`: `ProviderSettings` de `AppState` ↔ `ProviderConfig`.
//! - `ReqwestProviderChat`: `/chat/completions` con JSON mode y fallback.
//! - `ReqwestProviderProbe`: sondeo `{base}/models` con errores clasificados.

use std::future::Future;
use std::pin::Pin;
use std::time::Instant;

use serde_json::Value;

use crate::ai::providers::{
    chat_endpoint, chat_payload, http_failure_detail, models_endpoint, parse_model_ids,
    provider_test_result, should_retry_without_json_mode, ProviderTestResult, CHAT_TIMEOUT,
    MAX_CHAT_RESPONSE_BYTES, MAX_MODELS_BODY_BYTES,
};
use crate::ports::ai::{
    ChatCall, ProviderChat, ProviderConfig, ProviderProbe, ProviderSecrets, ProviderSettingsStore,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const KEYRING_SERVICE: &str = "editor-ia.provider";
const KEYRING_USER: &str = "openai-compatible";

fn keyring_entry() -> Result<keyring::Entry, ProjectError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de credenciales de Windows no está disponible",
        )
    })
}

/// Secretos del proveedor sobre el Credential Manager de Windows.
pub struct KeyringProviderSecrets;

impl ProviderSecrets for KeyringProviderSecrets {
    fn read_key(&self) -> Option<String> {
        keyring_entry()
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .filter(|secret| !secret.trim().is_empty())
    }

    fn set_key(&self, secret: &str) -> Result<(), ProjectError> {
        keyring_entry()?.set_password(secret).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::KeyringUnavailable,
                "no se pudo guardar la clave en el almacén de Windows",
            )
        })
    }

    fn clear_key(&self) {
        if let Ok(entry) = keyring_entry() {
            let _ = entry.delete_credential();
        }
    }

    fn available(&self) -> bool {
        keyring_entry().is_ok()
    }
}

/// Configuración del proveedor sobre `AppState`.
pub struct StateProviderSettings<'a> {
    state: &'a AppState,
}

impl<'a> StateProviderSettings<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl ProviderSettingsStore for StateProviderSettings<'_> {
    fn provider(&self) -> Result<ProviderConfig, ProjectError> {
        let settings = self.state.settings_snapshot()?;
        Ok(ProviderConfig {
            kind: settings.provider.kind,
            base_url: settings.provider.base_url,
            model: settings.provider.model,
        })
    }

    fn save_provider(&self, config: &ProviderConfig) -> Result<(), ProjectError> {
        let mut settings = self.state.settings.lock().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
        })?;
        settings.provider = crate::state::ProviderSettings {
            kind: config.kind.clone(),
            base_url: config.base_url.clone(),
            model: config.model.clone(),
        };
        self.state.save_settings(&settings)
    }
}

/// `/chat/completions` sobre reqwest async.
pub struct ReqwestProviderChat;

impl ProviderChat for ReqwestProviderChat {
    fn chat<'a>(
        &'a self,
        call: ChatCall,
    ) -> Pin<Box<dyn Future<Output = Result<String, ProjectError>> + Send + 'a>> {
        Box::pin(async move { chat_completion(call).await })
    }
}

async fn chat_completion(call: ChatCall) -> Result<String, ProjectError> {
    let client = reqwest::Client::builder()
        .timeout(CHAT_TIMEOUT)
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let mut json_mode = true;
    let mut attempt = 0u8;
    loop {
        attempt += 1;
        let body = chat_payload(&call.model, call.temperature, &call.messages, json_mode);
        let mut request = client
            .post(chat_endpoint(&call.base_url))
            .json(&body)
            .header("Accept", "application/json");
        if let Some(secret) = call.key.clone() {
            request = request.bearer_auth(secret);
        }
        let response = request.send().await.map_err(|error| {
            let safe = if error.is_timeout() {
                format!(
                    "el proveedor no respondió en {} segundos",
                    CHAT_TIMEOUT.as_secs()
                )
            } else if error.is_connect() {
                "no se pudo conectar con el proveedor; revisá la URL y que el servicio esté encendido"
                    .to_owned()
            } else {
                "la llamada al proveedor falló".to_owned()
            };
            ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
        })?;
        let status = response.status();
        if attempt == 1 && json_mode && should_retry_without_json_mode(status.as_u16()) {
            // El endpoint no conoce `response_format`: se repite sin el parámetro.
            json_mode = false;
            continue;
        }
        if !status.is_success() {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                &format!(
                    "el proveedor rechazó la solicitud (HTTP {})",
                    status.as_u16()
                ),
            ));
        }
        let bytes = response.bytes().await.map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el proveedor no devolvió un cuerpo legible",
            )
        })?;
        if bytes.len() > MAX_CHAT_RESPONSE_BYTES {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta del proveedor supera el límite de 2 MB",
            ));
        }
        let payload: Value = serde_json::from_slice(&bytes).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el proveedor no devolvió un JSON interpretable",
            )
        })?;
        let content = payload["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "la respuesta del proveedor no trae choices[0].message.content",
                )
            })?;
        return Ok(content.to_owned());
    }
}

/// Sondeo `{base}/models` sobre reqwest async.
pub struct ReqwestProviderProbe;

impl ProviderProbe for ReqwestProviderProbe {
    fn probe<'a>(
        &'a self,
        base_url: &'a str,
        model: &'a str,
        key: Option<String>,
        timeout: std::time::Duration,
    ) -> Pin<Box<dyn Future<Output = ProviderTestResult> + Send + 'a>> {
        Box::pin(async move { probe_models(base_url, model, key.as_deref(), timeout).await })
    }
}

/// Sondeo real del endpoint. Devuelve un resultado **tipado** (éxito, 401,
/// 404, timeout, sin conexión) con el modelo configurado verificado contra la
/// lista, sin lanzar la excepción genérica del primer error de generación.
async fn probe_models(
    base_url: &str,
    configured_model: &str,
    key: Option<&str>,
    timeout: std::time::Duration,
) -> ProviderTestResult {
    let started = Instant::now();
    let client = match reqwest::Client::builder().timeout(timeout).build() {
        Ok(client) => client,
        Err(_) => {
            return provider_test_result(
                "unreachable",
                false,
                None,
                started.elapsed().as_millis() as u64,
                None,
                "no se pudo preparar la conexión HTTP".to_owned(),
                base_url,
            );
        }
    };
    let mut call = client
        .get(models_endpoint(base_url))
        .header("Accept", "application/json");
    if let Some(secret) = key {
        call = call.bearer_auth(secret);
    }
    let response = match call.send().await {
        Ok(response) => response,
        Err(error) => {
            let latency_ms = started.elapsed().as_millis() as u64;
            let (status, detail) = if error.is_timeout() {
                let waited = if timeout.as_millis() < 1_000 {
                    format!("{} ms", timeout.as_millis())
                } else {
                    format!("{} segundos", timeout.as_secs())
                };
                (
                    "timeout",
                    format!(
                        "el proveedor no respondió en {waited}; revisá que Ollama/servicio esté encendido y la URL"
                    ),
                )
            } else if error.is_connect() {
                (
                    "unreachable",
                    "no se pudo conectar: el servicio está apagado, la URL es incorrecta o un firewall bloquea el puerto"
                        .to_owned(),
                )
            } else {
                (
                    "unreachable",
                    "la conexión con el proveedor falló antes de recibir respuesta".to_owned(),
                )
            };
            return provider_test_result(status, false, None, latency_ms, None, detail, base_url);
        }
    };
    let http_status = response.status().as_u16();
    let latency_ms = started.elapsed().as_millis() as u64;
    if !response.status().is_success() {
        let (status, detail) = http_failure_detail(http_status);
        return provider_test_result(
            status,
            false,
            Some(http_status),
            latency_ms,
            None,
            detail,
            base_url,
        );
    }
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(_) => {
            return provider_test_result(
                "invalid-response",
                false,
                Some(http_status),
                latency_ms,
                None,
                "el proveedor respondió pero el cuerpo no se pudo leer".to_owned(),
                base_url,
            );
        }
    };
    if body.len() > MAX_MODELS_BODY_BYTES {
        return provider_test_result(
            "invalid-response",
            false,
            Some(http_status),
            latency_ms,
            None,
            "la lista de modelos supera el límite de 2 MB".to_owned(),
            base_url,
        );
    }
    let Some(models) = parse_model_ids(&body) else {
        return provider_test_result(
            "invalid-response",
            false,
            Some(http_status),
            latency_ms,
            None,
            "el proveedor respondió 200 pero el cuerpo no es una lista de modelos compatible"
                .to_owned(),
            base_url,
        );
    };
    if models.iter().any(|id| id == configured_model.trim()) {
        return provider_test_result(
            "ok",
            true,
            Some(http_status),
            latency_ms,
            Some(configured_model.trim().to_owned()),
            format!(
                "conexión correcta: el modelo configurado «{}» está disponible en el proveedor",
                configured_model.trim()
            ),
            base_url,
        );
    }
    if let Some(first) = models.first() {
        return provider_test_result(
            "ok",
            true,
            Some(http_status),
            latency_ms,
            Some(first.clone()),
            format!(
                "conexión correcta, pero el modelo configurado «{}» no aparece en la lista (por ejemplo «{first}»); revisá el nombre o descargalo",
                configured_model.trim()
            ),
            base_url,
        );
    }
    provider_test_result(
        "ok",
        true,
        Some(http_status),
        latency_ms,
        None,
        "conexión correcta, pero el proveedor no listó ningún modelo; verificá el nombre del modelo con una generación"
            .to_owned(),
        base_url,
    )
}

/// `MotionChat` sobre reqwest: un único POST sin `response_format`, timeout
/// de 120 s y los mismos errores clasificados que el comando histórico.
pub struct ReqwestMotionChat;

impl crate::ports::ai::MotionChat for ReqwestMotionChat {
    fn complete<'a>(
        &'a self,
        call: crate::ports::ai::MotionChatCall,
    ) -> Pin<Box<dyn Future<Output = Result<Value, ProjectError>> + Send + 'a>> {
        Box::pin(async move { motion_completion(call).await })
    }
}

const SINGLE_SHOT_TIMEOUT_SECS: u64 = 120;

/// Textos de error de un POST único; cada consumidor (motion, media match)
/// conserva los mensajes históricos del comando.
struct SingleShotErrors {
    timeout: &'static str,
    connect: &'static str,
    fail: &'static str,
    rejected: &'static str,
    invalid_json: &'static str,
}

const MOTION_ERRORS: SingleShotErrors = SingleShotErrors {
    timeout: "el proveedor no respondió en 120 segundos",
    connect: "no se pudo conectar con el proveedor; revisá que Ollama/servicio esté encendido",
    fail: "la llamada al proveedor falló",
    rejected: "el proveedor rechazó el motion",
    invalid_json: "el proveedor no devolvió JSON legible",
};

const MATCH_ERRORS: SingleShotErrors = SingleShotErrors {
    timeout: "la IA no respondió en 120 segundos",
    connect: "no se pudo conectar con la IA configurada",
    fail: "la llamada a la IA falló",
    rejected: "la IA rechazó el emparejamiento",
    invalid_json: "la IA no devolvió JSON legible",
};

async fn single_shot_completion(
    call: crate::ports::ai::MotionChatCall,
    errors: &SingleShotErrors,
) -> Result<Value, ProjectError> {
    let body = serde_json::json!({
        "model": call.model,
        "temperature": call.temperature,
        "messages": [
            { "role": "system", "content": call.system },
            { "role": "user", "content": call.user }
        ]
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(SINGLE_SHOT_TIMEOUT_SECS))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let mut request = client
        .post(chat_endpoint(&call.base_url))
        .json(&body)
        .header("Accept", "application/json");
    if let Some(secret) = call.key {
        request = request.bearer_auth(secret);
    }
    let response = request.send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            errors.timeout.to_owned()
        } else if error.is_connect() {
            errors.connect.to_owned()
        } else {
            errors.fail.to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!("{} (HTTP {})", errors.rejected, response.status().as_u16()),
        ));
    }
    response.json::<Value>().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            errors.invalid_json,
        )
    })
}

async fn motion_completion(call: crate::ports::ai::MotionChatCall) -> Result<Value, ProjectError> {
    single_shot_completion(call, &MOTION_ERRORS).await
}

/// `MediaMatchChat` sobre reqwest: mismo POST único, mensajes del comando
/// `match_media_plan`.
pub struct ReqwestMediaMatchChat;

impl crate::ports::ai::MediaMatchChat for ReqwestMediaMatchChat {
    fn complete<'a>(
        &'a self,
        call: crate::ports::ai::MotionChatCall,
    ) -> Pin<Box<dyn Future<Output = Result<Value, ProjectError>> + Send + 'a>> {
        Box::pin(async move { single_shot_completion(call, &MATCH_ERRORS).await })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;

    fn http_response(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// Servidor HTTP mínimo: atiende una respuesta por conexión y cierra. Así se
    /// prueba el adaptador real contra 200/401/404 sin depender de internet.
    async fn serve(responses: Vec<String>) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("puerto de prueba");
        let address = listener.local_addr().expect("dirección");
        let handle = tokio::spawn(async move {
            for response in responses {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buffer = [0u8; 4096];
                let _ = socket.read(&mut buffer).await;
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            }
        });
        (format!("http://{address}/v1"), handle)
    }

    fn chat_call(base_url: &str) -> ChatCall {
        ChatCall {
            base_url: base_url.to_owned(),
            model: "m".to_owned(),
            temperature: 0.0,
            messages: vec![json!({ "role": "user", "content": "x" })],
            key: None,
        }
    }

    #[tokio::test]
    async fn chat_completion_retries_without_json_mode_when_rejected() {
        let (base, server) = serve(vec![
            http_response(
                "400 Bad Request",
                r#"{"error":"response_format is not supported"}"#,
            ),
            http_response(
                "200 OK",
                r#"{"choices":[{"message":{"content":"{\"ok\":true}"}}]}"#,
            ),
        ])
        .await;
        let content = chat_completion(chat_call(&base))
            .await
            .expect("segundo intento sin response_format");
        let _ = server.await;
        assert_eq!(content, r#"{"ok":true}"#);
    }

    #[tokio::test]
    async fn chat_completion_does_not_retry_auth_failures() {
        let (base, server) = serve(vec![http_response(
            "401 Unauthorized",
            r#"{"error":"bad key"}"#,
        )])
        .await;
        let error = chat_completion(chat_call(&base))
            .await
            .expect_err("401 no se reintenta");
        let _ = server.await;
        assert!(error.message.contains("401"), "{}", error.message);
    }

    #[tokio::test]
    async fn provider_test_reports_success_with_the_configured_model() {
        let (base, server) = serve(vec![http_response(
            "200 OK",
            r#"{"data":[{"id":"llama3.1"},{"id":"qwen2.5"}]}"#,
        )])
        .await;
        let result = probe_models(&base, "llama3.1", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(result.ok, "{result:?}");
        assert_eq!(result.status, "ok");
        assert_eq!(result.http_status, Some(200));
        assert_eq!(result.model.as_deref(), Some("llama3.1"));
        assert!(result.detail.contains("llama3.1"), "{result:?}");
    }

    #[tokio::test]
    async fn provider_test_warns_when_the_configured_model_is_not_listed() {
        let (base, server) = serve(vec![http_response(
            "200 OK",
            r#"{"data":[{"id":"llama3.1"}]}"#,
        )])
        .await;
        let result = probe_models(&base, "modelo-inexistente", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(result.ok);
        assert_eq!(result.model.as_deref(), Some("llama3.1"));
        assert!(result.detail.contains("no aparece"), "{result:?}");
    }

    #[tokio::test]
    async fn provider_test_classifies_401_and_404() {
        let (base, server) = serve(vec![http_response(
            "401 Unauthorized",
            r#"{"error":"bad key"}"#,
        )])
        .await;
        let unauthorized = probe_models(&base, "m", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(!unauthorized.ok);
        assert_eq!(unauthorized.status, "unauthorized");
        assert_eq!(unauthorized.http_status, Some(401));
        assert!(unauthorized.detail.contains("401"), "{unauthorized:?}");

        let (base, server) =
            serve(vec![http_response("404 Not Found", r#"{"error":"nope"}"#)]).await;
        let not_found = probe_models(&base, "m", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(!not_found.ok);
        assert_eq!(not_found.status, "not-found");
        assert_eq!(not_found.http_status, Some(404));
        assert!(not_found.detail.contains("/v1"), "{not_found:?}");
    }

    #[tokio::test]
    async fn provider_test_reports_timeout() {
        use tokio::io::AsyncReadExt;
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("puerto de prueba");
        let address = listener.local_addr().expect("dirección");
        let slow = tokio::spawn(async move {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let mut buffer = [0u8; 4096];
            let _ = socket.read(&mut buffer).await;
            tokio::time::sleep(Duration::from_secs(5)).await;
        });
        let timeout = probe_models(
            &format!("http://{address}/v1"),
            "m",
            None,
            Duration::from_millis(150),
        )
        .await;
        slow.abort();
        assert!(!timeout.ok);
        assert_eq!(timeout.status, "timeout", "{timeout:?}");
        assert!(timeout.detail.contains("150 ms"), "{timeout:?}");
    }

    #[tokio::test]
    async fn provider_test_classifies_transport_failures_as_unreachable() {
        // URL no parseable: el error de transporte no debe confundirse con un
        // rechazo del proveedor ni con un timeout.
        let invalid = probe_models("sin esquema", "m", None, Duration::from_millis(300)).await;
        assert!(!invalid.ok);
        assert_eq!(invalid.status, "unreachable", "{invalid:?}");

        // Puerto cerrado: según el stack de red el error puede ser un rechazo
        // inmediato o un timeout de conexión; ambos son fallos de transporte.
        let closed = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("puerto libre");
        let port = closed.local_addr().expect("dirección").port();
        drop(closed);
        let refused = probe_models(
            &format!("http://127.0.0.1:{port}/v1"),
            "m",
            None,
            Duration::from_millis(400),
        )
        .await;
        assert!(!refused.ok, "{refused:?}");
        assert!(
            matches!(refused.status.as_str(), "unreachable" | "timeout"),
            "{refused:?}"
        );
    }
}
