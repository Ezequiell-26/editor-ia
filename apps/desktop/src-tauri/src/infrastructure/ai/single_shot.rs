//! POST único compartido por los consumidores one-shot del proveedor:
//! `MotionChat` (motion AI) y `MediaMatchChat` (emparejamiento de medios).
//!
//! Mismo endpoint `/chat/completions`, sin `response_format`, timeout de
//! 120 s y errores clasificados con los mensajes históricos de cada comando.

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

use crate::ai::providers::chat_endpoint;
use crate::ports::ai::MotionChatCall;
use crate::projects::service::{ProjectError, ProjectErrorCode};

const SINGLE_SHOT_TIMEOUT_SECS: u64 = 120;

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
    call: MotionChatCall,
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

async fn motion_completion(call: MotionChatCall) -> Result<Value, ProjectError> {
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
