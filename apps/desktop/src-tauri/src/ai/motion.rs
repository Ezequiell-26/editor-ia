//! Motion suggestions (dominio puro).
//!
//! El proveedor devuelve JSON no confiable; acá se limpia a la forma exacta de
//! props del template elegido. La UI sigue pidiendo "Agregar a la timeline".

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::projects::service::{ProjectError, ProjectErrorCode};

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

pub const MOTION_TEMPLATES: [&str; 4] = ["title-card", "lower-third", "end-card", "stat-callout"];

pub fn motion_template(template_id: &str) -> Option<&'static str> {
    MOTION_TEMPLATES
        .iter()
        .copied()
        .find(|template| *template == template_id)
}

/// Bounds del brief según el contrato del comando.
pub const MIN_BRIEF_CHARS: usize = 10;
pub const MAX_BRIEF_CHARS: usize = 500;

pub fn validate_brief(brief: &str) -> Result<String, ProjectError> {
    let trimmed = brief.trim();
    if !(MIN_BRIEF_CHARS..=MAX_BRIEF_CHARS).contains(&trimmed.chars().count()) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "describí el motion con 10 a 500 caracteres",
        ));
    }
    Ok(trimmed.to_owned())
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

/// Schema JSON que se le pide al modelo para cada plantilla.
pub fn motion_schema(template: &str) -> &'static str {
    match template {
        "title-card" => "{title: string 1..120, subtitle: string 0..100, background: #rrggbb, accent: #rrggbb, align: left|center, animation: none|fade|slide-up|slide-left|pop}",
        "lower-third" => "{name: string 1..80, role: string 0..80, accent: #rrggbb, side: left|right, animation: none|fade|slide-up|slide-left|pop}",
        "end-card" => "{title: string 1..120, cta: string 0..100, background: #rrggbb, accent: #rrggbb, animation: none|fade|slide-up|slide-left|pop}",
        _ => "{value: string 1..20, label: string 1..60, accent: #rrggbb, animation: none|fade|slide-up|slide-left|pop}",
    }
}

/// Mensaje system del prompt de motion.
pub fn motion_system_prompt(template: &str) -> String {
    format!(
        "Sos diseñador de motion graphics para video. Devolvés SOLO un objeto JSON válido, sin markdown: {{\"props\": {}}}. Usá textos breves y concretos en español, colores #rrggbb y sólo las props indicadas.",
        motion_schema(template)
    )
}

pub fn motion_user_prompt(brief: &str) -> String {
    format!("Brief del video: {brief}")
}

pub fn clean_motion_props(template_id: &str, value: &Value) -> Result<Value, String> {
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

/// Extrae `choices[0].message.content` del payload del proveedor.
pub fn extract_message_content(payload: &Value) -> Result<String, ProjectError> {
    payload["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la respuesta no trae choices[0].message.content",
            )
        })
}

pub fn mock_motion(template_id: &str, brief: &str) -> MotionSuggestion {
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

    #[test]
    fn brief_bounds_match_the_command_contract() {
        assert!(validate_brief("corto").is_err());
        assert!(validate_brief(&"x".repeat(501)).is_err());
        assert_eq!(
            validate_brief("  un brief válido  ").unwrap(),
            "un brief válido"
        );
    }

    #[test]
    fn extract_message_content_requires_the_openai_shape() {
        let ok = json!({"choices":[{"message":{"content":"{}"}}]});
        assert_eq!(extract_message_content(&ok).unwrap(), "{}");
        assert!(extract_message_content(&json!({"choices":[]})).is_err());
    }
}
