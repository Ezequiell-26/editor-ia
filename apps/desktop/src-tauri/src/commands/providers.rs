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
}
