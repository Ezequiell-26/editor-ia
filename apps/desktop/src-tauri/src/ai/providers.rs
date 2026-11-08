//! Contratos puros del subsistema de proveedores de IA.
//!
//! El API key vive en el Windows Credential Manager, nunca en el proyecto,
//! settings file, logs o un prompt. La salida del modelo se trata como texto
//! no confiable: se parsea a un plan acotado y cada escena se valida antes de
//! que la UI pueda aplicarla al proyecto. `mock` es un proveedor simulador
//! explícito que permite correr todo el flujo offline sin fingir ser un modelo.
//!
//! Orquestación: `application::providers`. Secretos/HTTP/settings:
//! `infrastructure::ai` + `ports::ai`.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::ports::ai::ProviderConfig;
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const MAX_BRIEF_CHARS: usize = 4_000;
pub const MAX_SCENES: usize = 30;
pub const CHAT_TIMEOUT: Duration = Duration::from_secs(120);
pub const MAX_CHAT_RESPONSE_BYTES: usize = 2_000_000;
pub const MAX_REPAIR_ECHO_CHARS: usize = 2_000;
pub const PROVIDER_TEST_TIMEOUT: Duration = Duration::from_secs(8);
pub const MAX_MODELS_LISTED: usize = 50;
pub const MAX_MODELS_BODY_BYTES: usize = 2_000_000;
pub const MAX_TRANSLATE_CUES: usize = 100;
pub const MAX_TRANSLATE_CHARS: usize = 12_000;
pub const MAX_GLOSSARY_CHARS: usize = 1_000;

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

/// Vista pública del proveedor configurado.
pub fn provider_info(
    config: &ProviderConfig,
    has_key: bool,
    keyring_available: bool,
) -> ProviderInfo {
    ProviderInfo {
        kind: config.kind.clone(),
        base_url: config.base_url.clone(),
        model: config.model.clone(),
        has_key,
        keyring_available,
    }
}

// --- Validación de URL del proveedor --------------------------------------

fn parse_provider_url(base_url: &str) -> Option<reqwest::Url> {
    reqwest::Url::parse(base_url.trim()).ok()
}

/// Loopback is the only place a plain-http provider is accepted. Compare the
/// parsed host exactly: a prefix check would treat 127.0.0.1.evil.example as
/// local and leak the API key over an unencrypted connection.
pub fn is_local_endpoint(base_url: &str) -> bool {
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

pub fn validate_provider_base_url(base_url: &str) -> Result<(), ProjectError> {
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

pub fn chat_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_owned()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

// --- Contrato de chat con JSON mode y reparación ---------------------------
//
// Guion, asistente, efectos y traducción comparten el mismo contrato: pedir
// JSON con `response_format` cuando el endpoint lo soporte, reintentar sin el
// parámetro si lo rechaza y, si el contenido no es JSON válido, hacer **un**
// reintento de reparación mostrándole al modelo su salida anterior. Todo
// acotado: la salida del modelo sigue siendo texto no confiable.

/// Cuerpo mínimo de `/chat/completions`. `json_mode` agrega `response_format`.
pub fn chat_payload(model: &str, temperature: f64, messages: &[Value], json_mode: bool) -> Value {
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
pub fn should_retry_without_json_mode(status: u16) -> bool {
    matches!(status, 400 | 415 | 422)
}

/// Segunda vuelta con reparación: se muestra la salida inválida y se pide sólo
/// el JSON corregido. Se recorta para no arrastrar una respuesta enorme.
pub fn json_repair_messages(mut messages: Vec<Value>, invalid: &str) -> Vec<Value> {
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

pub fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    (end > start).then_some(&text[start..=end])
}

// --- Plan de guion ---------------------------------------------------------

#[derive(Debug, Deserialize)]
pub(crate) struct RawScene {
    title: Option<String>,
    intent: Option<String>,
    narration: Option<String>,
    visual: Option<String>,
    #[serde(alias = "estimated_seconds", alias = "estimatedSeconds")]
    estimated_seconds: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawPlan {
    title: Option<String>,
    scenes: Vec<RawScene>,
}

pub(crate) fn clean_text(value: Option<String>, max: usize) -> Option<String> {
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

pub(crate) fn validate_plan(value: &Value) -> Result<RawPlan, String> {
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

/// Parsea y valida el plan de guion devuelto por el modelo. Separado para
/// poder aplicar el reintento de reparación sin duplicar el contrato.
pub(crate) fn parse_script_content(content: &str) -> Result<RawPlan, String> {
    let json_text = extract_json(content)
        .ok_or_else(|| "la respuesta no contiene un objeto JSON".to_owned())?;
    let value: Value =
        serde_json::from_str(json_text).map_err(|_| "el JSON no se pudo parsear".to_owned())?;
    validate_plan(&value)
}

pub(crate) fn plan_from_raw(
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

pub fn mock_plan(request: &GenerateRequest, model: &str) -> ScriptPlan {
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

// --- Efecto de video --------------------------------------------------------

pub(crate) fn clean_effect(value: &Value) -> Result<Value, String> {
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

pub fn mock_effect_recipe() -> EffectRecipe {
    EffectRecipe {
        name: "Cine local".to_owned(),
        description: "Contraste y viñeta calculados sin red.".to_owned(),
        effects: json!({ "contrast": 1.15, "saturation": 0.92, "vignette": 0.2, "temperature": 0.08 }),
        provider_id: "mock".to_owned(),
        model: "mock".to_owned(),
        simulated: true,
    }
}

// --- Traducción de subtítulos ----------------------------------------------

pub fn language_name(code: &str) -> Option<&'static str> {
    match code.to_ascii_lowercase().as_str() {
        "es" => Some("español rioplatense"),
        "en" => Some("inglés"),
        "zh" => Some("chino mandarín simplificado"),
        "hi" => Some("hindi"),
        "ar" => Some("árabe moderno estándar"),
        "pt" => Some("portugués brasileño"),
        "bn" => Some("bengalí"),
        "ru" => Some("ruso"),
        "fr" => Some("francés"),
        "de" => Some("alemán"),
        "it" => Some("italiano"),
        "ja" => Some("japonés"),
        _ => None,
    }
}

pub fn validate_translation(
    request: &TranslateRequest,
) -> Result<(Vec<String>, String), ProjectError> {
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
            "el idioma de destino no está soportado",
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

pub fn parse_translations(content: &str, expected: usize) -> Result<Vec<String>, ProjectError> {
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

pub fn mock_translation(request: &TranslateRequest) -> TranslatedTexts {
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

// --- Sondeo de conexión ------------------------------------------------------

/// `{base}/models`, tolerando que la URL ya incluya `/models` o que se haya
/// configurado el endpoint de chat completo.
pub fn models_endpoint(base_url: &str) -> String {
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
pub fn parse_model_ids(payload: &[u8]) -> Option<Vec<String>> {
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

pub fn provider_test_result(
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
pub fn http_failure_detail(status: u16) -> (&'static str, String) {
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

#[cfg(test)]
#[path = "providers.tests.rs"]
mod tests;
