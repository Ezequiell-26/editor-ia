//! Motion suggestions through the configured AI provider.
//!
//! The provider returns untrusted JSON; this module cleans it into the exact
//! prop shape of the selected template. The UI still previews the result and
//! requires an explicit "Agregar a la timeline" action.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::commands::providers::{
    chat_endpoint, extract_json, is_local_endpoint, read_key, validate_provider_base_url,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionRequest {
    pub brief: String,
    pub template_id: String,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionSuggestion {
    pub template_id: String,
    pub props: Value,
    pub provider_id: String,
    pub model: String,
    pub simulated: bool,
}

fn motion_template(template_id: &str) -> Option<&'static str> {
    match template_id {
        "title-card" => Some("title-card"),
        "lower-third" => Some("lower-third"),
        "end-card" => Some("end-card"),
        "stat-callout" => Some("stat-callout"),
        _ => None,
    }
}

fn motion_string(source: &Value, key: &str, max: usize, fallback: &str) -> String {
    let text = source.get(key).and_then(Value::as_str).unwrap_or("").trim();
    let cleaned: String = text.chars().take(max).collect();
    if cleaned.is_empty() {
        fallback.to_owned()
    } else {
        cleaned
    }
}

fn motion_color(source: &Value, key: &str, fallback: &str) -> String {
    let value = source.get(key).and_then(Value::as_str).unwrap_or("");
    let valid = value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit());
    if valid {
        value.to_owned()
    } else {
        fallback.to_owned()
    }
}

fn motion_enum(source: &Value, key: &str, allowed: &[&str], fallback: &str) -> String {
    let value = source.get(key).and_then(Value::as_str).unwrap_or("");
    if allowed.contains(&value) {
        value.to_owned()
    } else {
        fallback.to_owned()
    }
}

fn clean_motion_props(template_id: &str, value: &Value) -> Result<Value, String> {
    let source = value
        .get("props")
        .cloned()
        .or_else(|| value.as_object().map(|_| value.clone()))
        .ok_or_else(|| "el modelo no devolvió un objeto de props".to_owned())?;
    let source = source
        .as_object()
        .ok_or_else(|| "props debe ser un objeto".to_owned())?;
    let source = Value::Object(source.clone());
    let animations = ["none", "fade", "slide-up", "slide-left", "pop"];
    match motion_template(template_id) {
        Some("title-card") => {
            let title = motion_string(&source, "title", 120, "");
            if title.is_empty() {
                return Err("falta el título".to_owned());
            }
            Ok(json!({
                "title": title,
                "subtitle": motion_string(&source, "subtitle", 100, ""),
                "background": motion_color(&source, "background", "#0f172a"),
                "accent": motion_color(&source, "accent", "#7dd3c0"),
                "align": motion_enum(&source, "align", &["left", "center"], "left"),
                "animation": motion_enum(&source, "animation", &animations, "slide-up")
            }))
        }
        Some("lower-third") => {
            let name = motion_string(&source, "name", 80, "");
            if name.is_empty() {
                return Err("falta el nombre".to_owned());
            }
            Ok(json!({
                "name": name,
                "role": motion_string(&source, "role", 80, ""),
                "accent": motion_color(&source, "accent", "#7dd3c0"),
                "side": motion_enum(&source, "side", &["left", "right"], "left"),
                "animation": motion_enum(&source, "animation", &animations, "slide-left")
            }))
        }
        Some("end-card") => {
            let title = motion_string(&source, "title", 120, "");
            if title.is_empty() {
                return Err("falta el título de cierre".to_owned());
            }
            Ok(json!({
                "title": title,
                "cta": motion_string(&source, "cta", 100, ""),
                "background": motion_color(&source, "background", "#0f172a"),
                "accent": motion_color(&source, "accent", "#7dd3c0"),
                "animation": motion_enum(&source, "animation", &animations, "fade")
            }))
        }
        Some("stat-callout") => {
            let value = motion_string(&source, "value", 20, "");
            if value.is_empty() {
                return Err("falta el valor del dato".to_owned());
            }
            let label = motion_string(&source, "label", 60, "");
            if label.is_empty() {
                return Err("falta la etiqueta del dato".to_owned());
            }
            Ok(json!({
                "value": value,
                "label": label,
                "accent": motion_color(&source, "accent", "#7dd3c0"),
                "animation": motion_enum(&source, "animation", &animations, "pop")
            }))
        }
        _ => Err("plantilla de motion desconocida".to_owned()),
    }
}

fn mock_motion(template_id: &str, brief: &str) -> MotionSuggestion {
    let text: String = brief.trim().chars().take(60).collect();
    let props = match template_id {
        "lower-third" => json!({
            "name": text,
            "role": "Editor IA",
            "accent": "#7dd3c0",
            "side": "left",
            "animation": "slide-left"
        }),
        "end-card" => json!({
            "title": text,
            "cta": "Suscribite para más",
            "background": "#0f172a",
            "accent": "#7dd3c0",
            "animation": "fade"
        }),
        "stat-callout" => json!({
            "value": "+120%",
            "label": text,
            "accent": "#7dd3c0",
            "animation": "pop"
        }),
        _ => json!({
            "title": text,
            "subtitle": "Generado localmente",
            "background": "#0f172a",
            "accent": "#7dd3c0",
            "align": "left",
            "animation": "slide-up"
        }),
    };
    MotionSuggestion {
        template_id: template_id.to_owned(),
        props,
        provider_id: "mock".to_owned(),
        model: "mock".to_owned(),
        simulated: true,
    }
}

#[tauri::command]
pub async fn generate_motion(
    state: State<'_, AppState>,
    request: MotionRequest,
) -> Result<MotionSuggestion, ProjectError> {
    let brief = request.brief.trim().to_owned();
    if !(10..=500).contains(&brief.chars().count()) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "describí el motion con 10 a 500 caracteres",
        ));
    }
    let template = motion_template(&request.template_id).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la plantilla de motion no es válida",
        )
    })?;
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" {
        return Ok(mock_motion(template, &brief));
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
            "confirmá que esta llamada puede consumir cuota antes de generar el motion",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let schema = match template {
        "title-card" => "{title: string 1..120, subtitle: string 0..100, background: #rrggbb, accent: #rrggbb, align: left|center, animation: none|fade|slide-up|slide-left|pop}",
        "lower-third" => "{name: string 1..80, role: string 0..80, accent: #rrggbb, side: left|right, animation: none|fade|slide-up|slide-left|pop}",
        "end-card" => "{title: string 1..120, cta: string 0..100, background: #rrggbb, accent: #rrggbb, animation: none|fade|slide-up|slide-left|pop}",
        _ => "{value: string 1..20, label: string 1..60, accent: #rrggbb, animation: none|fade|slide-up|slide-left|pop}",
    };
    let system = format!(
        "Sos diseñador de motion graphics para video. Devolvés SOLO un objeto JSON válido, sin markdown: {{\"props\": {schema}}}. Usá textos breves y concretos en español, colores #rrggbb y sólo las props indicadas."
    );
    let body = json!({
        "model": provider.model,
        "temperature": 0.4,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": format!("Brief del video: {brief}") }
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
                "el proveedor rechazó el motion (HTTP {})",
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
            "el JSON del motion no se pudo parsear",
        )
    })?;
    let props = clean_motion_props(template, &value).map_err(|detail| {
        ProjectError::message(ProjectErrorCode::InvalidProviderResponse, &detail)
    })?;
    Ok(MotionSuggestion {
        template_id: template.to_owned(),
        props,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        simulated: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_props_and_fills_defaults() {
        let props = clean_motion_props(
            "lower-third",
            &json!({ "props": { "name": "Ana", "role": "Editora", "accent": "#7dd3c0", "side": "left", "animation": "fade" } }),
        )
        .expect("motion válido");
        assert_eq!(props["name"], "Ana");
        assert_eq!(props["role"], "Editora");
        assert_eq!(props["animation"], "fade");
    }

    #[test]
    fn rejects_a_missing_required_text() {
        let error = clean_motion_props("title-card", &json!({ "props": { "subtitle": "x" } }))
            .expect_err("debe rechazar");
        assert!(error.contains("título"));
    }

    #[test]
    fn replaces_invalid_colors_and_enums() {
        let props = clean_motion_props(
            "title-card",
            &json!({ "props": { "title": "Hola", "background": "rojo", "align": "arriba", "animation": "girar" } }),
        )
        .expect("motion válido");
        assert_eq!(props["background"], "#0f172a");
        assert_eq!(props["align"], "left");
        assert_eq!(props["animation"], "slide-up");
    }

    #[test]
    fn mock_motion_uses_the_brief() {
        let suggestion = mock_motion("title-card", "Una prueba de motion");
        assert!(suggestion.simulated);
        assert_eq!(suggestion.props["title"], "Una prueba de motion");
    }
}
