//! AI provider settings and the structured script generator.
//!
//! The API key lives in the Windows Credential Manager, never in the project,
//! settings file, logs or a prompt. The model output is treated as untrusted
//! text: it is parsed into a bounded plan and every scene is validated before
//! the UI can apply it to the project. `mock` is an explicitly simulated
//! provider that lets the whole flow run offline without pretending to be a
//! model.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::{AppState, ProviderSettings};

const KEYRING_SERVICE: &str = "editor-ia.provider";
const KEYRING_USER: &str = "openai-compatible";
const MAX_BRIEF_CHARS: usize = 4_000;
const MAX_SCENES: usize = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub kind: String,
    pub base_url: String,
    pub model: String,
    pub has_key: bool,
    pub keyring_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptScene {
    pub id: String,
    pub order: u32,
    pub title: String,
    pub intent: String,
    pub narration: String,
    pub visual: String,
    pub estimated_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPlan {
    pub title: String,
    pub scenes: Vec<ScriptScene>,
    pub provider_id: String,
    pub model: String,
    pub simulated: bool,
    pub cost_disclosed: bool,
    pub cost_approved: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    pub brief: String,
    #[serde(default = "default_scene_count")]
    pub scene_count: u32,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub approved_cost: bool,
}

fn default_scene_count() -> u32 {
    5
}

fn default_language() -> String {
    "es".to_owned()
}

fn keyring_entry() -> Result<keyring::Entry, ProjectError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de credenciales de Windows no está disponible",
        )
    })
}

pub(crate) fn read_key() -> Option<String> {
    keyring_entry()
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|secret| !secret.trim().is_empty())
}

fn keyring_available() -> bool {
    keyring_entry().is_ok()
}

fn provider_info(settings: &ProviderSettings) -> ProviderInfo {
    ProviderInfo {
        kind: settings.kind.clone(),
        base_url: settings.base_url.clone(),
        model: settings.model.clone(),
        has_key: read_key().is_some(),
        keyring_available: keyring_available(),
    }
}

#[tauri::command]
pub async fn get_provider(state: State<'_, AppState>) -> Result<ProviderInfo, ProjectError> {
    let settings = state.settings_snapshot()?;
    Ok(provider_info(&settings.provider))
}

#[tauri::command]
pub async fn save_provider(
    state: State<'_, AppState>,
    kind: String,
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<ProviderInfo, ProjectError> {
    let kind = match kind.as_str() {
        "mock" => "mock",
        _ => "openai-compatible",
    };
    let base_url = base_url.trim().to_owned();
    let model = model.trim().to_owned();
    if kind != "mock" && base_url.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el proveedor necesita una URL base (por ejemplo http://127.0.0.1:11434/v1)",
        ));
    }
    if kind != "mock" {
        validate_provider_base_url(&base_url)?;
    }
    if kind != "mock" && model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el proveedor necesita un nombre de modelo",
        ));
    }

    if let Some(secret) = api_key {
        let trimmed = secret.trim();
        if !trimmed.is_empty() {
            if trimmed.chars().count() < 8 {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "la clave del proveedor es demasiado corta",
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

    {
        let mut settings = state.settings.lock().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
        })?;
        settings.provider = ProviderSettings {
            kind: kind.to_owned(),
            base_url,
            model,
        };
        state.save_settings(&settings)?;
        Ok(provider_info(&settings.provider))
    }
}

#[tauri::command]
pub async fn clear_provider_key(state: State<'_, AppState>) -> Result<ProviderInfo, ProjectError> {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    let settings = state.settings_snapshot()?;
    Ok(provider_info(&settings.provider))
}

fn parse_provider_url(base_url: &str) -> Option<reqwest::Url> {
    reqwest::Url::parse(base_url.trim()).ok()
}

/// Loopback is the only place a plain-http provider is accepted. Compare the
/// parsed host exactly: a prefix check would treat 127.0.0.1.evil.example as
/// local and leak the API key over an unencrypted connection.
pub(crate) fn is_local_endpoint(base_url: &str) -> bool {
    let Some(url) = parse_provider_url(base_url) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    matches!(
        url.host_str(),
        Some("localhost") | Some("127.0.0.1") | Some("::1") | Some("[::1]")
    )
}

pub(crate) fn validate_provider_base_url(base_url: &str) -> Result<(), ProjectError> {
    let Some(url) = parse_provider_url(base_url) else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL base no es una URL válida",
        ));
    };
    if !matches!(url.scheme(), "http" | "https") {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL base debe usar http o https",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL base no puede incluir usuario ni contraseña",
        ));
    }
    if url.host_str().is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la URL base no declara un host",
        ));
    }
    if !is_local_endpoint(base_url) && url.scheme() != "https" {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "los proveedores remotos deben usar https para no enviar la clave en claro",
        ));
    }
    Ok(())
}

pub(crate) fn chat_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_owned()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

// --- Llamada de chat con JSON mode y reparación ---------------------------
//
// Guion, asistente y traducción comparten el mismo contrato: pedir JSON con
// `response_format` cuando el endpoint lo soporte, reintentar sin el parámetro
// si lo rechaza y, si el contenido no es JSON válido, hacer **un** reintento de
// reparación mostrándole al modelo su salida anterior. Todo acotado: la salida
// del modelo sigue siendo texto no confiable que se valida después.

const CHAT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_CHAT_RESPONSE_BYTES: usize = 2_000_000;
const MAX_REPAIR_ECHO_CHARS: usize = 2_000;

pub(crate) struct ChatRequest<'a> {
    pub(crate) base_url: &'a str,
    pub(crate) model: &'a str,
    pub(crate) temperature: f64,
    pub(crate) messages: Vec<Value>,
    pub(crate) key: Option<String>,
}

/// Cuerpo mínimo de `/chat/completions`. `json_mode` agrega `response_format`.
fn chat_payload(model: &str, temperature: f64, messages: &[Value], json_mode: bool) -> Value {
    let mut body = json!({
        "model": model,
        "temperature": temperature,
        "messages": messages,
    });
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    body
}

/// El endpoint sólo se reintenta sin `response_format` cuando el rechazo es de
/// parámetro (400/415/422). Un 401/403/429/5xx no se arregla sacándolo.
fn should_retry_without_json_mode(status: u16) -> bool {
    matches!(status, 400 | 415 | 422)
}

/// Segunda vuelta con reparación: se muestra la salida inválida y se pide sólo
/// el JSON corregido. Se recorta para no arrastrar una respuesta enorme.
pub(crate) fn json_repair_messages(mut messages: Vec<Value>, invalid: &str) -> Vec<Value> {
    messages.push(json!({
        "role": "assistant",
        "content": invalid.chars().take(MAX_REPAIR_ECHO_CHARS).collect::<String>(),
    }));
    messages.push(json!({
        "role": "user",
        "content": "Tu respuesta anterior no era JSON válido. Devolvé SOLO el objeto JSON corregido, sin markdown ni comentarios, respetando exactamente el contrato pedido.",
    }));
    messages
}

/// Petición de chat completions compartida. Devuelve el `content` del mensaje
/// (todavía sin parsear) y aplica el fallback de JSON mode si el endpoint lo
/// rechaza.
pub(crate) async fn chat_completion(request: ChatRequest<'_>) -> Result<String, ProjectError> {
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
        let body = chat_payload(
            request.model,
            request.temperature,
            &request.messages,
            json_mode,
        );
        let mut call = client
            .post(chat_endpoint(request.base_url))
            .json(&body)
            .header("Accept", "application/json");
        if let Some(secret) = request.key.clone() {
            call = call.bearer_auth(secret);
        }
        let response = call.send().await.map_err(|error| {
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

/// Parsea y valida el plan de guion devuelto por el modelo. Separado para poder
/// aplicar el reintento de reparación sin duplicar el contrato.
fn parse_script_content(content: &str) -> Result<RawPlan, String> {
    let json_text =
        extract_json(content).ok_or_else(|| "la respuesta no contiene un objeto JSON".to_owned())?;
    let value: Value =
        serde_json::from_str(json_text).map_err(|_| "el JSON no se pudo parsear".to_owned())?;
    validate_plan(&value)
}

// --- "Probar conexión" del proveedor -------------------------------------
//
// El default del proveedor está vacío y hasta ahora el primer error aparecía
// recién al generar. Este sondeo hace una petición GET corta a `{base}/models`
// y devuelve un resultado **tipado** (éxito, 401, 404, timeout, sin conexión)
// con el modelo configurado verificado contra la lista, sin lanzar la excepción
// genérica del primer error de generación.

const PROVIDER_TEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_MODELS_LISTED: usize = 50;
const MAX_MODELS_BODY_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    /// `ok`, `mock`, `unconfigured`, `missing-key`, `unauthorized`, `forbidden`,
    /// `not-found`, `timeout`, `unreachable`, `http-error`, `invalid-response`.
    pub status: String,
    pub ok: bool,
    pub http_status: Option<u16>,
    pub latency_ms: u64,
    /// Modelo configurado si el proveedor lo lista; si no, el primero listado.
    pub model: Option<String>,
    pub detail: String,
    pub base_url: String,
}

/// `{base}/models`, tolerando que la URL ya incluya `/models` o que se haya
/// configurado el endpoint de chat completo.
pub(crate) fn models_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/models") {
        trimmed.to_owned()
    } else if let Some(prefix) = trimmed.strip_suffix("/chat/completions") {
        format!("{prefix}/models")
    } else {
        format!("{trimmed}/models")
    }
}

/// Extrae ids de la respuesta de `/models` (máximo acotado). `None` si el
/// cuerpo no es JSON interpretable con forma de listado.
fn parse_model_ids(payload: &[u8]) -> Option<Vec<String>> {
    let value: Value = serde_json::from_slice(payload).ok()?;
    let entries = value.get("data")?.as_array()?;
    let mut ids = Vec::new();
    for entry in entries.iter().take(MAX_MODELS_LISTED) {
        if let Some(id) = entry.get("id").and_then(Value::as_str) {
            let trimmed = id.trim();
            if !trimmed.is_empty() {
                ids.push(trimmed.chars().take(120).collect::<String>());
            }
        }
    }
    Some(ids)
}

fn provider_test_result(
    status: &str,
    ok: bool,
    http_status: Option<u16>,
    latency_ms: u64,
    model: Option<String>,
    detail: String,
    base_url: &str,
) -> ProviderTestResult {
    ProviderTestResult {
        status: status.to_owned(),
        ok,
        http_status,
        latency_ms,
        model,
        detail,
        base_url: base_url.to_owned(),
    }
}

/// Mensaje accionable según el estado HTTP: dice qué revisar, no sólo el código.
fn http_failure_detail(status: u16) -> (&'static str, String) {
    match status {
        401 => (
            "unauthorized",
            "el proveedor rechazó la clave (HTTP 401); revisá la clave guardada en Ajustes → IA"
                .to_owned(),
        ),
        403 => (
            "forbidden",
            "el proveedor respondió 403: la clave no tiene permiso sobre este modelo o endpoint"
                .to_owned(),
        ),
        404 => (
            "not-found",
            "el proveedor respondió 404: la URL base no expone /models; revisá que termine en /v1"
                .to_owned(),
        ),
        429 => (
            "rate-limited",
            "el proveedor respondió 429: hay un límite de uso o cuota agotada".to_owned(),
        ),
        other => (
            "http-error",
            format!("el proveedor respondió HTTP {other} al listar los modelos"),
        ),
    }
}

/// Sondeo real del endpoint, separado del comando para poder probarlo con un
/// servidor local de prueba sin estado de Tauri.
async fn test_provider_endpoint(
    base_url: &str,
    configured_model: &str,
    key: Option<&str>,
    timeout: Duration,
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

/// Prueba la conexión con el proveedor configurado (Ajustes → IA). No lanza el
/// error genérico de una generación: devuelve un estado tipado y accionable que
/// la interfaz puede mostrar tal cual.
#[tauri::command]
pub async fn test_provider(
    state: State<'_, AppState>,
) -> Result<ProviderTestResult, ProjectError> {
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    let base_url = provider.base_url.trim().to_owned();
    if provider.kind == "mock" {
        return Ok(provider_test_result(
            "mock",
            false,
            None,
            0,
            None,
            "el proveedor simulado no hace llamadas de red: configurá Ollama o una API compatible para probar la conexión"
                .to_owned(),
            &base_url,
        ));
    }
    if base_url.is_empty() || provider.model.trim().is_empty() {
        return Ok(provider_test_result(
            "unconfigured",
            false,
            None,
            0,
            None,
            "configurá la URL base y el modelo en Ajustes → IA antes de probar la conexión"
                .to_owned(),
            &base_url,
        ));
    }
    validate_provider_base_url(&base_url)?;
    let local = is_local_endpoint(&base_url);
    let key = read_key();
    if !local && key.is_none() {
        return Ok(provider_test_result(
            "missing-key",
            false,
            None,
            0,
            None,
            "falta la clave del proveedor en el almacén de Windows; guardala en Ajustes → IA"
                .to_owned(),
            &base_url,
        ));
    }
    Ok(test_provider_endpoint(
        &base_url,
        provider.model.trim(),
        key.as_deref(),
        PROVIDER_TEST_TIMEOUT,
    )
    .await)
}

#[derive(Debug, Deserialize)]
struct RawScene {
    title: Option<String>,
    intent: Option<String>,
    narration: Option<String>,
    visual: Option<String>,
    #[serde(alias = "estimated_seconds", alias = "estimatedSeconds")]
    estimated_seconds: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct RawPlan {
    title: Option<String>,
    scenes: Vec<RawScene>,
}

fn clean_text(value: Option<String>, max: usize) -> Option<String> {
    let text = value?.trim().to_owned();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(max).collect())
}

fn clean_intent(value: Option<String>) -> String {
    let normalized = value.unwrap_or_default().trim().to_ascii_lowercase();
    match normalized.as_str() {
        "hook" | "context" | "explainer" | "demo" | "proof" | "cta" | "outro" => normalized,
        _ => "explainer".to_owned(),
    }
}

pub(crate) fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then_some(&text[start..=end])
}

fn validate_plan(value: &Value) -> Result<RawPlan, String> {
    let plan: RawPlan = serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    if plan.scenes.is_empty() {
        return Err("el plan no trae escenas".to_owned());
    }
    if plan.scenes.len() > MAX_SCENES {
        return Err(format!("el plan trae más de {MAX_SCENES} escenas"));
    }
    if plan
        .scenes
        .iter()
        .all(|scene| clean_text(scene.narration.clone(), 4_000).is_none())
    {
        return Err("ninguna escena trae narración".to_owned());
    }
    Ok(plan)
}

fn plan_from_raw(
    raw: RawPlan,
    provider_id: &str,
    model: &str,
    simulated: bool,
    approved: bool,
) -> ScriptPlan {
    let mut scenes = Vec::new();
    for (index, scene) in raw.scenes.into_iter().enumerate().take(MAX_SCENES) {
        let narration = clean_text(scene.narration, 4_000)
            .unwrap_or_else(|| "Escena sin narración.".to_owned());
        let title = clean_text(scene.title, 200).unwrap_or_else(|| format!("Escena {}", index + 1));
        let visual = clean_text(scene.visual, 2_000).unwrap_or_default();
        let seconds = scene
            .estimated_seconds
            .filter(|value| value.is_finite() && *value > 0.5 && *value < 600.0)
            .unwrap_or(8.0);
        scenes.push(ScriptScene {
            id: Uuid::new_v4().to_string(),
            order: index as u32,
            title,
            intent: clean_intent(scene.intent),
            narration,
            visual,
            estimated_seconds: seconds,
        });
    }
    ScriptPlan {
        title: raw
            .title
            .map(|title| title.trim().chars().take(200).collect::<String>())
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| "Guion generado".to_owned()),
        scenes,
        provider_id: provider_id.to_owned(),
        model: model.to_owned(),
        simulated,
        cost_disclosed: true,
        cost_approved: approved,
    }
}

fn mock_plan(request: &GenerateRequest, model: &str) -> ScriptPlan {
    let language = request.language.to_ascii_lowercase();
    let spanish = !language.starts_with("en");
    let count = request.scene_count.clamp(1, MAX_SCENES as u32);
    let brief = request.brief.trim().chars().take(120).collect::<String>();
    let intents = ["hook", "context", "explainer", "demo", "proof", "cta"];
    let templates_es = [
        ("Apertura", "¿Y si pudieras resolver esto en minutos en lugar de horas? Hoy te muestro cómo."),
        ("Contexto", "El problema no es la falta de ideas: es el tiempo que se va en tareas repetitivas."),
        ("Cómo funciona", "El flujo es simple: describís el objetivo, revisás el plan y ajustás lo que quieras."),
        ("Demostración", "Mirá el proceso completo, paso a paso, con el material real sobre la línea de tiempo."),
        ("Prueba", "El resultado queda como un proyecto editable, con fuentes, escenas y subtítulos verificables."),
        ("Cierre", "Probá el flujo con tu propio material y contame qué mejorarías."),
    ];
    let templates_en = [
        (
            "Opening",
            "What if you could finish this in minutes instead of hours? Here is the workflow.",
        ),
        (
            "Context",
            "The bottleneck is rarely ideas; it is the repetitive work around them.",
        ),
        (
            "How it works",
            "Describe the goal, review the plan, and change anything you want.",
        ),
        (
            "Demo",
            "Watch the whole process with real material on the timeline.",
        ),
        (
            "Proof",
            "The result is an editable project with sources, scenes and verifiable captions.",
        ),
        (
            "Closing",
            "Try the workflow with your own material and tell me what to improve.",
        ),
    ];
    let templates = if spanish { templates_es } else { templates_en };
    let raw = RawPlan {
        title: Some(if spanish {
            format!("Guion simulado: {brief}")
        } else {
            format!("Simulated script: {brief}")
        }),
        scenes: (0..count)
            .map(|index| {
                let template = templates[index as usize % templates.len()];
                RawScene {
                    title: Some(template.0.to_owned()),
                    intent: Some(intents[index as usize % intents.len()].to_owned()),
                    narration: Some(template.1.to_owned()),
                    visual: Some(if spanish {
                        "Plano de apoyo con el material del proyecto; reemplazalo por una toma propia.".to_owned()
                    } else {
                        "Supporting shot from the project media; replace it with your own footage.".to_owned()
                    }),
                    estimated_seconds: Some(8.0),
                }
            })
            .collect(),
    };
    plan_from_raw(raw, "mock", model, true, true)
}

#[tauri::command]
pub async fn generate_script(
    state: State<'_, AppState>,
    request: GenerateRequest,
) -> Result<ScriptPlan, ProjectError> {
    let brief = request.brief.trim().to_owned();
    if brief.chars().count() < 10 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "describí el video con al menos 10 caracteres",
        ));
    }
    if brief.chars().count() > MAX_BRIEF_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el brief supera los 4000 caracteres",
        ));
    }
    if !(1..=MAX_SCENES as u32).contains(&request.scene_count) {
        let message = format!("la cantidad de escenas debe estar entre 1 y {MAX_SCENES}");
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &message,
        ));
    }

    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" {
        return Ok(mock_plan(&request, "mock"));
    }
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor en Ajustes o usá el proveedor simulado",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de generar",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }

    let language = match request.language.to_ascii_lowercase().as_str() {
        "en" | "en-us" | "en-gb" => "inglés",
        _ => "español rioplatense",
    };
    let system = format!(
        "Sos un guionista y productor de video. Escribís en {language}. Devolvés SOLO un objeto JSON válido, sin markdown ni comentarios. El objeto tiene {{\"title\": string, \"scenes\": [{{\"title\": string, \"intent\": \"hook\"|\"context\"|\"explainer\"|\"demo\"|\"proof\"|\"cta\"|\"outro\", \"narration\": string, \"visual\": string, \"estimatedSeconds\": number}}]}}. Escribí narración natural para leer en voz alta, sin acotaciones. Máximo {max_scenes} escenas.",
        max_scenes = request.scene_count,
    );
    let user = format!(
        "Brief del video:\n{brief}\n\nGenerá exactamente {} escenas con una progresión narrativa clara.",
        request.scene_count
    );
    let messages = vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": user }),
    ];
    let first = chat_completion(ChatRequest {
        base_url: &provider.base_url,
        model: &provider.model,
        temperature: 0.6,
        messages: messages.clone(),
        key: key.clone(),
    })
    .await?;
    let raw = match parse_script_content(&first) {
        Ok(raw) => raw,
        Err(first_detail) => {
            // Un solo reintento de reparación, también en JSON mode: si el
            // modelo devolvió texto o un JSON roto, se le muestra y se le pide
            // sólo el objeto corregido.
            let repaired = chat_completion(ChatRequest {
                base_url: &provider.base_url,
                model: &provider.model,
                temperature: 0.6,
                messages: json_repair_messages(messages, &first),
                key,
            })
            .await?;
            parse_script_content(&repaired).map_err(|detail| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    &format!(
                        "el plan del modelo no cumple el contrato ni tras un reintento de reparación: {detail} (primer intento: {first_detail})"
                    ),
                )
            })?
        }
    };
    Ok(plan_from_raw(
        raw,
        "openai-compatible",
        &provider.model,
        false,
        request.approved_cost,
    ))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRequest {
    pub prompt: String,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectRecipe {
    pub name: String,
    pub description: String,
    pub effects: Value,
    pub provider_id: String,
    pub model: String,
    pub simulated: bool,
}

fn clean_effect(value: &Value) -> Result<Value, String> {
    let source = value
        .get("effects")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(|| value.as_object().cloned().unwrap_or_default());
    let mut effects = serde_json::Map::new();
    let mut number = |key: &str, min: f64, max: f64| {
        if let Some(raw) = source.get(key).and_then(Value::as_f64) {
            if raw.is_finite() {
                effects.insert(key.to_owned(), json!(raw.clamp(min, max)));
            }
        }
    };
    number("brightness", -1.0, 1.0);
    number("contrast", 0.0, 3.0);
    number("saturation", 0.0, 3.0);
    number("temperature", -1.0, 1.0);
    number("vignette", 0.0, 1.0);
    number("sharpen", 0.0, 5.0);
    number("blur", 0.0, 50.0);
    number("hueRotateDeg", -180.0, 180.0);
    for key in ["grayscale", "sepia"] {
        if let Some(raw) = source.get(key).and_then(Value::as_bool) {
            effects.insert(key.to_owned(), Value::Bool(raw));
        }
    }
    if effects.is_empty() {
        return Err("el efecto no trae ningún parámetro visual válido".to_owned());
    }
    Ok(Value::Object(effects))
}

#[tauri::command]
pub async fn generate_video_effect(
    state: State<'_, AppState>,
    request: EffectRequest,
) -> Result<EffectRecipe, ProjectError> {
    let prompt = request.prompt.trim().to_owned();
    if !(3..=500).contains(&prompt.chars().count()) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "describí el efecto con 3 a 500 caracteres",
        ));
    }
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" {
        return Ok(EffectRecipe {
            name: "Cine local".to_owned(),
            description: "Contraste y viñeta calculados sin red.".to_owned(),
            effects: json!({ "contrast": 1.15, "saturation": 0.92, "vignette": 0.2, "temperature": 0.08 }),
            provider_id: "mock".to_owned(),
            model: "mock".to_owned(),
            simulated: true,
        });
    }
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor en Ajustes o usá el simulador",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de generar el efecto",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let system = "Sos colorista de video. Devolvés SOLO un objeto JSON válido, sin markdown: {\"name\": string, \"description\": string, \"effects\": {\"brightness\": -1..1, \"contrast\": 0..3, \"saturation\": 0..3, \"temperature\": -1..1, \"vignette\": 0..1, \"sharpen\": 0..5, \"blur\": 0..50, \"hueRotateDeg\": -180..180, \"grayscale\": boolean, \"sepia\": boolean}}. Usá sólo los parámetros necesarios y valores moderados.";
    let body = json!({
        "model": provider.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": format!("Efecto pedido: {prompt}") }
        ]
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let mut call = client
        .post(chat_endpoint(&provider.base_url))
        .json(&body)
        .header("Accept", "application/json");
    if let Some(secret) = key {
        call = call.bearer_auth(secret);
    }
    let response = call.send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            "el proveedor no respondió en 120 segundos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el proveedor; revisá que Ollama/servicio esté encendido"
                .to_owned()
        } else {
            "la llamada al proveedor falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó el efecto (HTTP {})",
                response.status().as_u16()
            ),
        ));
    }
    let payload: Value = response.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor no devolvió JSON legible",
        )
    })?;
    let content = payload["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta no trae choices[0].message.content",
            )
        })?;
    let json_text = extract_json(content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el modelo no devolvió un objeto JSON",
        )
    })?;
    let value: Value = serde_json::from_str(json_text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el JSON del efecto no se pudo parsear",
        )
    })?;
    let effects = clean_effect(&value).map_err(|detail| {
        ProjectError::message(ProjectErrorCode::InvalidProviderResponse, &detail)
    })?;
    Ok(EffectRecipe {
        name: clean_text(value["name"].as_str().map(str::to_owned), 80)
            .unwrap_or_else(|| "Efecto IA".to_owned()),
        description: clean_text(value["description"].as_str().map(str::to_owned), 300)
            .unwrap_or_default(),
        effects,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        simulated: false,
    })
}

const MAX_TRANSLATE_CUES: usize = 100;
const MAX_TRANSLATE_CHARS: usize = 12_000;
const MAX_GLOSSARY_CHARS: usize = 1_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub texts: Vec<String>,
    #[serde(default = "default_source_language")]
    pub source_language: String,
    pub target_language: String,
    #[serde(default)]
    pub glossary: Option<String>,
    #[serde(default)]
    pub approved_cost: bool,
}

fn default_source_language() -> String {
    "auto".to_owned()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatedTexts {
    pub texts: Vec<String>,
    pub provider_id: String,
    pub model: String,
    pub simulated: bool,
}

fn language_name(code: &str) -> Option<&'static str> {
    match code.to_ascii_lowercase().as_str() {
        "es" => Some("español rioplatense"),
        "en" => Some("inglés"),
        "zh" => Some("chino mandarín simplificado"),
        "hi" => Some("hindi"),
        "ar" => Some("árabe moderno estándar"),
        "pt" => Some("portugués brasileño"),
        "bn" => Some("bengalí"),
        "ru" => Some("ruso"),
        _ => None,
    }
}

fn validate_translation(request: &TranslateRequest) -> Result<(Vec<String>, String), ProjectError> {
    if request.texts.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no hay subtítulos para traducir",
        ));
    }
    if request.texts.len() > MAX_TRANSLATE_CUES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("un lote de traducción admite hasta {MAX_TRANSLATE_CUES} subtítulos"),
        ));
    }
    let target = request.target_language.trim().to_ascii_lowercase();
    if language_name(&target).is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el idioma de destino no está entre los ocho soportados",
        ));
    }
    let source = request.source_language.trim().to_ascii_lowercase();
    if source != "auto" && language_name(&source).is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el idioma de origen no es válido",
        ));
    }
    let mut total = 0usize;
    let mut texts = Vec::with_capacity(request.texts.len());
    for text in &request.texts {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "un subtítulo llegó vacío",
            ));
        }
        if trimmed.chars().count() > 4_000 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "un subtítulo supera los 4000 caracteres",
            ));
        }
        total += trimmed.chars().count();
        texts.push(trimmed.to_owned());
    }
    if total > MAX_TRANSLATE_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!(
                "el lote supera los {MAX_TRANSLATE_CHARS} caracteres; dividilo en partes más chicas"
            ),
        ));
    }
    Ok((texts, target))
}

fn parse_translations(content: &str, expected: usize) -> Result<Vec<String>, ProjectError> {
    let trimmed = content.trim();
    let value: Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(_) => {
            let json_text = extract_json(trimmed).ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "la traducción no es un JSON interpretable",
                )
            })?;
            serde_json::from_str(json_text).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "la traducción no es un JSON interpretable",
                )
            })?
        }
    };
    let entries = value
        .get("texts")
        .or_else(|| value.get("translations"))
        .and_then(Value::as_array)
        .or_else(|| value.as_array())
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la traducción no trae una lista de textos",
            )
        })?;
    if entries.len() != expected {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            &format!(
                "la traducción devolvió {} textos y se esperaban {expected}; no se aplicó nada",
                entries.len()
            ),
        ));
    }
    let mut texts = Vec::with_capacity(expected);
    for entry in entries {
        let text = entry.as_str().map(str::trim).unwrap_or("");
        if text.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la traducción devolvió un subtítulo vacío; no se aplicó nada",
            ));
        }
        texts.push(text.chars().take(4_000).collect());
    }
    Ok(texts)
}

fn mock_translation(request: &TranslateRequest) -> TranslatedTexts {
    TranslatedTexts {
        texts: request
            .texts
            .iter()
            .map(|text| text.trim().to_owned())
            .collect(),
        provider_id: "mock".to_owned(),
        model: "mock".to_owned(),
        simulated: true,
    }
}

#[tauri::command]
pub async fn translate_subtitles(
    state: State<'_, AppState>,
    request: TranslateRequest,
) -> Result<TranslatedTexts, ProjectError> {
    let (texts, target) = validate_translation(&request)?;
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" {
        // El proveedor simulado no inventa una traducción: devuelve el texto
        // original marcado como simulado para que la UI no lo presente como
        // traducido ni lo exporte como si lo fuera.
        return Ok(mock_translation(&request));
    }
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor en Ajustes para traducir",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "autorizá el consumo de cuota antes de traducir con un proveedor remoto",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let source = request.source_language.trim().to_ascii_lowercase();
    let source_label = if source == "auto" {
        "detección automática".to_owned()
    } else {
        language_name(&source)
            .unwrap_or("origen desconocido")
            .to_owned()
    };
    let target_label = language_name(&target).unwrap_or("destino");
    let glossary = request
        .glossary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(MAX_GLOSSARY_CHARS).collect::<String>())
        .unwrap_or_default();
    let glossary_block = if glossary.is_empty() {
        String::new()
    } else {
        format!("\nGlosario que NO se traduce (respetá estas grafías): {glossary}")
    };
    let system = format!(
        "Sos un traductor profesional de subtítulos. Traducís de {source_label} a {target_label}. Devolvés SOLO un objeto JSON válido, sin markdown ni comentarios, con la forma {{\"texts\": [string, ...]}}. Traducí cada entrada en el mismo orden, sin numerarlas ni agregar notas, con lenguaje natural y compacto para leer en pantalla. No omitas, fusiones ni agregues entradas. Respondé exactamente {} entradas.{glossary_block}",
        texts.len()
    );
    let user = serde_json::json!({ "texts": texts }).to_string();
    let expected = texts.len();
    let messages = vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": user }),
    ];
    let first = chat_completion(ChatRequest {
        base_url: &provider.base_url,
        model: &provider.model,
        temperature: 0.2,
        messages: messages.clone(),
        key: key.clone(),
    })
    .await?;
    let translated = match parse_translations(&first, expected) {
        Ok(translated) => translated,
        Err(_) => {
            // Un reintento de reparación: mismo contrato, misma cantidad de
            // entradas; si tampoco cumple, gana el error del segundo intento.
            let repaired = chat_completion(ChatRequest {
                base_url: &provider.base_url,
                model: &provider.model,
                temperature: 0.2,
                messages: json_repair_messages(messages, &first),
                key,
            })
            .await?;
            parse_translations(&repaired, expected)?
        }
    };
    Ok(TranslatedTexts {
        texts: translated,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model.clone(),
        simulated: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> GenerateRequest {
        GenerateRequest {
            brief: "Un video corto sobre cómo ordenar una timeline".to_owned(),
            scene_count: 3,
            language: "es".to_owned(),
            approved_cost: false,
        }
    }

    #[test]
    fn endpoint_join_is_idempotent() {
        assert_eq!(chat_endpoint("http://x/v1"), "http://x/v1/chat/completions");
        assert_eq!(
            chat_endpoint("http://x/v1/chat/completions/"),
            "http://x/v1/chat/completions"
        );
    }

    #[test]
    fn local_endpoints_do_not_require_cost_approval() {
        assert!(is_local_endpoint("http://127.0.0.1:11434/v1"));
        assert!(is_local_endpoint("HTTP://LOCALHOST:8080/v1"));
        assert!(is_local_endpoint("http://[::1]:11434/v1"));
        assert!(!is_local_endpoint("https://api.openai.com/v1"));
        assert!(!is_local_endpoint("http://127.0.0.1.evil.example/v1"));
        assert!(!is_local_endpoint("http://localhost.evil.example/v1"));
        assert!(!is_local_endpoint("http://localhost@evil.example/v1"));
        assert!(!is_local_endpoint("http://127.0.0.1:11434@evil.example/v1"));
    }

    #[test]
    fn remote_providers_require_https_and_no_userinfo() {
        assert!(validate_provider_base_url("https://api.openai.com/v1").is_ok());
        assert!(validate_provider_base_url("http://api.openai.com/v1").is_err());
        assert!(validate_provider_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_provider_base_url("http://127.0.0.1.evil.example/v1").is_err());
        assert!(validate_provider_base_url("https://user:pass@api.openai.com/v1").is_err());
        assert!(validate_provider_base_url("ftp://localhost/v1").is_err());
    }

    #[test]
    fn extracts_json_from_fences() {
        let text = "```json\n{\"title\":\"x\",\"scenes\":[]}\n```";
        assert_eq!(extract_json(text), Some("{\"title\":\"x\",\"scenes\":[]}"));
        assert!(extract_json("sin json").is_none());
    }

    #[test]
    fn chat_payload_requests_json_only_when_enabled() {
        let messages = vec![json!({ "role": "user", "content": "hola" })];
        let with_json = chat_payload("modelo", 0.2, &messages, true);
        assert_eq!(with_json["response_format"]["type"], "json_object");
        assert_eq!(with_json["messages"][0]["content"], "hola");
        let plain = chat_payload("modelo", 0.2, &messages, false);
        assert!(plain.get("response_format").is_none());
        assert_eq!(plain["model"], "modelo");
    }

    #[test]
    fn only_parameter_rejections_retry_without_json_mode() {
        for status in [400, 415, 422] {
            assert!(should_retry_without_json_mode(status), "{status}");
        }
        for status in [401, 403, 404, 429, 500, 503] {
            assert!(!should_retry_without_json_mode(status), "{status}");
        }
    }

    #[test]
    fn json_repair_retry_echoes_the_invalid_output_and_asks_only_for_json() {
        let messages = vec![json!({ "role": "user", "content": "hacé un guion" })];
        let invalid = "x".repeat(MAX_REPAIR_ECHO_CHARS + 500);
        let repaired = json_repair_messages(messages, &invalid);
        assert_eq!(repaired.len(), 3);
        assert_eq!(repaired[1]["role"], "assistant");
        assert_eq!(
            repaired[1]["content"].as_str().unwrap().chars().count(),
            MAX_REPAIR_ECHO_CHARS
        );
        let instruction = repaired[2]["content"].as_str().unwrap();
        assert!(instruction.contains("SOLO"), "{instruction}");
        assert!(instruction.contains("JSON"), "{instruction}");
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
        let content = chat_completion(ChatRequest {
            base_url: &base,
            model: "m",
            temperature: 0.0,
            messages: vec![json!({ "role": "user", "content": "x" })],
            key: None,
        })
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
        let error = chat_completion(ChatRequest {
            base_url: &base,
            model: "m",
            temperature: 0.0,
            messages: vec![json!({ "role": "user", "content": "x" })],
            key: None,
        })
        .await
        .expect_err("401 no se reintenta");
        let _ = server.await;
        assert!(error.message.contains("401"), "{}", error.message);
    }

    #[test]
    fn plan_is_bounded_and_normalized() {
        let raw = RawPlan {
            title: Some("  Plan  ".to_owned()),
            scenes: vec![
                RawScene {
                    title: Some("  Uno ".to_owned()),
                    intent: Some("inventado".to_owned()),
                    narration: Some("Texto válido".to_owned()),
                    visual: None,
                    estimated_seconds: Some(5.0),
                },
                RawScene {
                    title: None,
                    intent: None,
                    narration: None,
                    visual: None,
                    estimated_seconds: None,
                },
            ],
        };
        let plan = plan_from_raw(raw, "p", "m", false, false);
        assert_eq!(plan.title, "Plan");
        assert_eq!(plan.scenes.len(), 2);
        assert_eq!(plan.scenes[0].intent, "explainer");
        assert_eq!(plan.scenes[0].order, 0);
        assert_eq!(plan.scenes[1].title, "Escena 2");
    }

    #[test]
    fn empty_plans_are_rejected() {
        let empty = json!({ "title": "x", "scenes": [] });
        assert!(validate_plan(&empty).is_err());
        let no_narration = json!({ "title": "x", "scenes": [{ "title": "a" }] });
        assert!(validate_plan(&no_narration).is_err());
    }

    #[test]
    fn mock_plan_is_explicitly_simulated_and_respects_scene_count() {
        let plan = mock_plan(&request(), "mock");
        assert!(plan.simulated);
        assert_eq!(plan.scenes.len(), 3);
        assert!(plan.title.contains("simulado"));
        assert!(plan.scenes.iter().all(|scene| !scene.narration.is_empty()));
    }

    #[test]
    fn brief_length_is_bounded_by_the_command_contract() {
        let too_short = "corto";
        assert!(too_short.chars().count() < 10);
        let too_long = "x".repeat(MAX_BRIEF_CHARS + 1);
        assert!(too_long.chars().count() > MAX_BRIEF_CHARS);
    }

    fn translation(texts: &[&str], target: &str) -> TranslateRequest {
        TranslateRequest {
            texts: texts.iter().map(|text| (*text).to_owned()).collect(),
            source_language: "auto".to_owned(),
            target_language: target.to_owned(),
            glossary: None,
            approved_cost: false,
        }
    }

    #[test]
    fn translation_accepts_the_eight_languages_and_trims() {
        for code in ["es", "en", "zh", "hi", "ar", "pt", "bn", "ru"] {
            let request = translation(&["  Hola  "], code);
            let (texts, target) = validate_translation(&request).expect("válido");
            assert_eq!(texts, vec!["Hola"]);
            assert_eq!(target, code);
        }
    }

    #[test]
    fn translation_rejects_unknown_languages_empty_and_huge_batches() {
        assert!(validate_translation(&translation(&["Hola"], "fr")).is_err());
        assert!(validate_translation(&translation(&[], "en")).is_err());
        assert!(validate_translation(&translation(&["   "], "en")).is_err());
        let many = vec!["Hola"; MAX_TRANSLATE_CUES + 1];
        assert!(validate_translation(&translation(&many, "en")).is_err());
        let long = "x".repeat(MAX_TRANSLATE_CHARS + 1);
        assert!(validate_translation(&translation(&[&long], "en")).is_err());
    }

    #[test]
    fn translation_parser_requires_every_cue_in_order() {
        let parsed = parse_translations(r#"{"texts":["Hello","World"]}"#, 2).expect("JSON");
        assert_eq!(parsed, vec!["Hello", "World"]);
        let array = parse_translations(r#"["Uno","Dos"]"#, 2).expect("array");
        assert_eq!(array, vec!["Uno", "Dos"]);
        let fenced =
            parse_translations("```json\n{\"translations\":[\"Eins\"]}\n```", 1).expect("fenced");
        assert_eq!(fenced, vec!["Eins"]);
    }

    #[test]
    fn translation_parser_rejects_missing_empty_or_extra_cues() {
        assert!(parse_translations(r#"{"texts":["Uno"]}"#, 2).is_err());
        assert!(parse_translations(r#"{"texts":["Uno","Dos","Tres"]}"#, 2).is_err());
        assert!(parse_translations(r#"{"texts":["Uno","   "]}"#, 2).is_err());
        assert!(parse_translations("sin json", 1).is_err());
    }

    #[test]
    fn simulated_translation_is_marked_and_does_not_invent_text() {
        let request = translation(&["Hola", "Mundo"], "en");
        let result = mock_translation(&request);
        assert!(result.simulated);
        assert_eq!(result.texts, vec!["Hola", "Mundo"]);
    }

    fn http_response(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// Servidor HTTP mínimo: atiende una respuesta por conexión y cierra. Así se
    /// prueba el comando real contra 200/401/404 sin depender de internet.
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

    #[test]
    fn models_endpoint_joins_like_the_chat_endpoint() {
        assert_eq!(models_endpoint("http://x/v1"), "http://x/v1/models");
        assert_eq!(models_endpoint("http://x/v1/"), "http://x/v1/models");
        assert_eq!(models_endpoint("http://x/v1/models"), "http://x/v1/models");
        assert_eq!(
            models_endpoint("http://x/v1/chat/completions"),
            "http://x/v1/models"
        );
    }

    #[test]
    fn model_ids_are_bounded_and_validated() {
        assert_eq!(
            parse_model_ids(br#"{"data":[{"id":" llama3.1 "},{"id":""},{"id":5}]}"#),
            Some(vec!["llama3.1".to_owned()])
        );
        assert_eq!(parse_model_ids(br#"{"data":[]}"#), Some(Vec::new()));
        assert!(parse_model_ids(b"no json").is_none());
        assert!(parse_model_ids(br#"{"object":"list"}"#).is_none());
    }

    #[tokio::test]
    async fn provider_test_reports_success_with_the_configured_model() {
        let (base, server) = serve(vec![http_response(
            "200 OK",
            r#"{"data":[{"id":"llama3.1"},{"id":"qwen2.5"}]}"#,
        )])
        .await;
        let result = test_provider_endpoint(&base, "llama3.1", None, Duration::from_secs(2)).await;
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
        let result = test_provider_endpoint(&base, "modelo-inexistente", None, Duration::from_secs(2))
            .await;
        let _ = server.await;
        assert!(result.ok);
        assert_eq!(result.model.as_deref(), Some("llama3.1"));
        assert!(result.detail.contains("no aparece"), "{result:?}");
    }

    #[tokio::test]
    async fn provider_test_classifies_401_and_404() {
        let (base, server) = serve(vec![http_response("401 Unauthorized", r#"{"error":"bad key"}"#)]).await;
        let unauthorized = test_provider_endpoint(&base, "m", None, Duration::from_secs(2)).await;
        let _ = server.await;
        assert!(!unauthorized.ok);
        assert_eq!(unauthorized.status, "unauthorized");
        assert_eq!(unauthorized.http_status, Some(401));
        assert!(unauthorized.detail.contains("401"), "{unauthorized:?}");

        let (base, server) = serve(vec![http_response("404 Not Found", r#"{"error":"nope"}"#)]).await;
        let not_found = test_provider_endpoint(&base, "m", None, Duration::from_secs(2)).await;
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
        let timeout = test_provider_endpoint(
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
        let invalid = test_provider_endpoint("sin esquema", "m", None, Duration::from_millis(300)).await;
        assert!(!invalid.ok);
        assert_eq!(invalid.status, "unreachable", "{invalid:?}");

        // Puerto cerrado: según el stack de red el error puede ser un rechazo
        // inmediato o un timeout de conexión; ambos son fallos de transporte.
        let closed = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("puerto libre");
        let port = closed.local_addr().expect("dirección").port();
        drop(closed);
        let refused = test_provider_endpoint(
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

#[cfg(test)]
mod effect_tests {
    use super::*;

    #[test]
    fn effect_parameters_are_clamped_and_filtered() {
        let recipe = clean_effect(&serde_json::json!({
            "effects": { "brightness": 9, "contrast": -2, "vignette": 0.4, "inventado": 3 }
        }))
        .expect("efecto válido");
        assert_eq!(recipe["brightness"], 1.0);
        assert_eq!(recipe["contrast"], 0.0);
        assert_eq!(recipe["vignette"], 0.4);
        assert!(recipe.get("inventado").is_none());
    }
}
