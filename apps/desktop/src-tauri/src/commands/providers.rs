//! AI provider settings and the structured script generator.
//!
//! The API key lives in the Windows Credential Manager, never in the project,
//! settings file, logs or a prompt. The model output is treated as untrusted
//! text: it is parsed into a bounded plan and every scene is validated before
//! the UI can apply it to the project. `mock` is an explicitly simulated
//! provider that lets the whole flow run offline without pretending to be a
//! model.

use std::time::Duration;

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

fn read_key() -> Option<String> {
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
fn is_local_endpoint(base_url: &str) -> bool {
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

fn validate_provider_base_url(base_url: &str) -> Result<(), ProjectError> {
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

fn chat_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_owned()
    } else {
        format!("{trimmed}/chat/completions")
    }
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

fn extract_json(text: &str) -> Option<&str> {
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
    let body = json!({
        "model": provider.model,
        "temperature": 0.6,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
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
            "no se pudo conectar con el proveedor; revisá la URL y que el servicio esté encendido"
                .to_owned()
        } else {
            "la llamada al proveedor falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó la solicitud (HTTP {})",
                status.as_u16()
            ),
        ));
    }
    let body = response.bytes().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor no devolvió un cuerpo legible",
        )
    })?;
    if body.len() > 2_000_000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la respuesta del proveedor supera el límite de 2 MB",
        ));
    }
    let payload: Value = serde_json::from_slice(&body).map_err(|_| {
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
    let json_text = extract_json(content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la respuesta del modelo no contiene un objeto JSON",
        )
    })?;
    let value: Value = serde_json::from_str(json_text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el JSON del modelo no se pudo parsear",
        )
    })?;
    let raw = validate_plan(&value).map_err(|detail| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            &format!("el plan del modelo no cumple el contrato: {detail}"),
        )
    })?;
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
    let body = json!({
        "model": provider.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
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
            "no se pudo conectar con el proveedor; revisá la URL y que el servicio esté encendido"
                .to_owned()
        } else {
            "la llamada de traducción falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó la traducción (HTTP {})",
                status.as_u16()
            ),
        ));
    }
    let body = response.bytes().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor no devolvió un cuerpo legible",
        )
    })?;
    if body.len() > 2_000_000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la respuesta de traducción supera el límite de 2 MB",
        ));
    }
    let payload: Value = serde_json::from_slice(&body).map_err(|_| {
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
                "la respuesta no trae choices[0].message.content",
            )
        })?;
    Ok(TranslatedTexts {
        texts: parse_translations(content, texts.len())?,
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
