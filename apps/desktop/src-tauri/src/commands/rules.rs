//! Refreshes the optional platform-rule packs. The bundled rules are always
//! available offline; a remote document can replace them when published.

use std::time::Duration;

use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};

const RULES_URL: &str =
    "https://raw.githubusercontent.com/Ezequiell-26/editor-ia/main/data/platform-rules.json";
const MAX_RULES_BYTES: usize = 512 * 1024;

fn rules_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

#[tauri::command]
pub async fn fetch_platform_rules() -> Result<Value, ProjectError> {
    let client = reqwest::Client::builder()
        .user_agent("EditorIA/0.1 platform-rules")
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| rules_error("No se pudo preparar la actualización de reglas."))?;
    let response =
        client.get(RULES_URL).send().await.map_err(|error| {
            rules_error(format!("No se pudieron actualizar las reglas: {error}"))
        })?;
    if !response.status().is_success() {
        return Err(rules_error(format!(
            "El servidor de reglas respondió {}.",
            response.status()
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| rules_error("La actualización de reglas se cortó."))?;
    if bytes.len() > MAX_RULES_BYTES {
        return Err(rules_error(
            "El documento de reglas supera el límite permitido.",
        ));
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| rules_error("El documento de reglas no es JSON válido."))?;
    if value["schema"].as_str() != Some("editor-ia.platform-rules.v1") || !value["packs"].is_array()
    {
        return Err(rules_error(
            "El documento de reglas no tiene el esquema esperado.",
        ));
    }
    Ok(value)
}
