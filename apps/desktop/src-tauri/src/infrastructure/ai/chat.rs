//! `/chat/completions` sobre reqwest async, con JSON mode y fallback.

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

use crate::ai::providers::{
    chat_endpoint, chat_payload, should_retry_without_json_mode, CHAT_TIMEOUT,
    MAX_CHAT_RESPONSE_BYTES,
};
use crate::ports::ai::{ChatCall, ProviderChat};
use crate::projects::service::{ProjectError, ProjectErrorCode};

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

#[cfg(test)]
mod tests {
    use super::super::test_server::{chat_call, http_response, serve};
    use super::*;

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
}
