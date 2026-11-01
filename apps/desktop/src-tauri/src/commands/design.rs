//! Generación de diseños autocontenidos con el proveedor configurado.
//!
//! El modelo devuelve un único documento HTML5 sin scripts ni recursos
//! externos. Antes de entregarlo a la interfaz se extrae, se acota y se
//! valida: un diseño no puede ejecutar código ni pedir archivos remotos.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::providers::{
    chat_endpoint, extract_json, is_local_endpoint, read_key, validate_provider_base_url,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_BRIEF_CHARS: usize = 4_000;
const MAX_TOKENS_CHARS: usize = 20_000;
const MAX_CRAFT_CHARS: usize = 24_000;
const MAX_RECIPE_CHARS: usize = 80_000;
const MAX_HTML_CHARS: usize = 160_000;
const MAX_CONTEXT_BYTES: usize = 128 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignRequest {
    pub brief: String,
    pub format: String,
    pub system_name: String,
    #[serde(default)]
    pub tokens_css: String,
    #[serde(default)]
    pub craft: Vec<String>,
    #[serde(default)]
    pub recipe: Option<String>,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignReply {
    pub html: String,
    pub provider_id: String,
    pub model: String,
    pub format: String,
}

fn take(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

fn format_instruction(format: &str) -> &'static str {
    match format {
        "dashboard" => {
            "Un dashboard de producto a pantalla completa de 1440×900: barra lateral, cabecera, KPIs y gráficos CSS puros. Sin controles falsos."
        }
        "deck" => {
            "Una presentación HTML de 3 a 6 diapositivas de 1280×720. Cada diapositiva va en <section data-slide> de 1280×720, apiladas verticalmente; jerarquía editorial, títulos fuertes y datos legibles. Sin JavaScript."
        }
        "card" => {
            "Una tarjeta social cuadrada de 1080×1080 que ocupe todo el lienzo: composición vertical equilibrada, contenido principal arriba o al centro, pie con marca y llamada; sin bloques vacíos."
        }
        "thumbnail" => {
            "Una miniatura de video de 1280×720 con título enorme, subtítulo corto y una composición que se entienda en el feed."
        }
        _ => {
            "Una página o prototipo web responsive con cabecera, contenido principal, prueba y cierre. Debe verse bien entre 360 px y 1440 px."
        }
    }
}

fn system_prompt(format: &str) -> String {
    format!(
        concat!(
            "Sos un director de diseño senior. Devolvés SOLO un documento HTML5 completo ",
            "y autocontenido, sin markdown, sin explicaciones y sin bloques de código.\n",
            "Reglas obligatorias:\n",
            "- Prohibido <script>, <iframe>, <object>, <embed>, formularios con action y cualquier ",
            "atributo on* (onclick, onload, etc.).\n",
            "- Prohibido pedir recursos externos: sin http(s), sin CDN, sin @import, sin fuentes ",
            "remotas, sin <link>. Usá system-ui o familias del sistema y CSS puro.\n",
            "- Todo el CSS va en un <style> dentro del documento. Las imágenes, si hacen falta, ",
            "sólo pueden ser data:image o SVG inline.\n",
            "- Usá las variables CSS del sistema de diseño provisto; no inventes otro acento.\n",
            "- Usá flexbox para el layout; evitá CSS grid y posiciones que dependan de scripts, ",
            "porque el rasterizador PNG de Olyvia no las reproduce.\n",
            "- Podés incluir animaciones CSS simples de entrada (opacidad o desplazamiento) sin ",
            "scripts; Olyvia las reproduce en el video corto.\n",
            "- Contenido real y específico en español rioplatense, nunca 'Lorem ipsum' ni ",
            "'Metric A'.\n",
            "- No inventes fechas, precios, nombres propios, testimonios ni cifras que el brief ",
            "no dé; si hacen falta, usá marcadores neutros visibles.\n",
            "- El resultado debe ser visualmente terminado y legible sin JavaScript.\n",
            "- Formato pedido: ",
            "{}",
            "\n"
        ),
        format_instruction(format)
    )
}

fn extract_html(content: &str) -> Option<String> {
    let mut text = content.trim();
    if text.starts_with("```") {
        if let Some(line_end) = text.find('\n') {
            text = text[line_end + 1..].trim_start();
        }
        if let Some(end) = text.rfind("```") {
            text = text[..end].trim_end();
        }
    }
    let lower = text.to_ascii_lowercase();
    let start = lower
        .find("<!doctype")
        .or_else(|| lower.find("<html"))
        .unwrap_or(0);
    let end = lower
        .rfind("</html>")
        .map(|index| index + "</html>".len())
        .unwrap_or(text.len());
    let html = text[start..end].trim();
    if html.is_empty() {
        None
    } else {
        Some(html.to_owned())
    }
}

fn contains_event_handler(lower: &str) -> bool {
    let bytes = lower.as_bytes();
    let mut index = 0;
    while let Some(found) = lower[index..].find(' ') {
        let start = index + found + 1;
        if lower[start..].starts_with("on") {
            let rest = &lower[start + 2..];
            let letters = rest
                .chars()
                .take_while(|character| character.is_ascii_alphabetic())
                .count();
            if letters >= 3 {
                let after = &rest[letters..];
                if after.trim_start().starts_with('=') {
                    return true;
                }
            }
        }
        index = start;
        if index >= bytes.len() {
            break;
        }
    }
    false
}

fn validate_html(html: &str) -> Result<(), String> {
    if html.chars().count() > MAX_HTML_CHARS {
        return Err("el diseño supera el límite de 160 000 caracteres".to_owned());
    }
    let lower = html.to_ascii_lowercase();
    for tag in [
        "<script",
        "<iframe",
        "<object",
        "<embed",
        "<applet",
        "<base",
        "<link",
        "<meta http-equiv",
    ] {
        if lower.contains(tag) {
            return Err(format!("el diseño incluye {tag}, que no está permitido"));
        }
    }
    if lower.contains("javascript:") || lower.contains("vbscript:") {
        return Err("el diseño incluye una URL ejecutable".to_owned());
    }
    if lower.contains("@import") {
        return Err("el diseño intenta importar CSS externo".to_owned());
    }
    if lower.contains("url(http") || lower.contains("url( http") || lower.contains("url('http") {
        return Err("el diseño intenta cargar un recurso externo".to_owned());
    }
    if lower.contains("src=\"http")
        || lower.contains("src='http")
        || lower.contains("href=\"http")
        || lower.contains("href='http")
        || lower.contains("action=\"http")
        || lower.contains("action='http")
    {
        return Err("el diseño enlaza a un recurso externo".to_owned());
    }
    if contains_event_handler(&lower) {
        return Err("el diseño incluye un manejador de eventos".to_owned());
    }
    Ok(())
}

fn clean_format(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "dashboard" => "dashboard".to_owned(),
        "deck" => "deck".to_owned(),
        "card" => "card".to_owned(),
        "thumbnail" => "thumbnail".to_owned(),
        _ => "page".to_owned(),
    }
}

fn build_user_message(request: &DesignRequest, format: &str) -> String {
    let mut message = String::new();
    message.push_str("Sistema de diseño: ");
    message.push_str(&take(&request.system_name, 120));
    message.push_str("\n\nTokens CSS del sistema:\n");
    message.push_str(&take(&request.tokens_css, MAX_TOKENS_CHARS));
    if !request.craft.is_empty() {
        message.push_str("\n\nReglas de craft a respetar:\n");
        let joined = request.craft.join("\n\n");
        message.push_str(&take(&joined, MAX_CRAFT_CHARS));
    }
    if let Some(recipe) = request.recipe.as_ref() {
        message.push_str("\n\nReceta de referencia:\n");
        message.push_str(&take(recipe, MAX_RECIPE_CHARS));
    }
    message.push_str("\n\nFormato: ");
    message.push_str(format);
    message.push_str("\n\nBrief:\n");
    message.push_str(&take(&request.brief, MAX_BRIEF_CHARS));
    message
}

async fn call_provider(
    base_url: &str,
    model: &str,
    system: &str,
    user: &str,
    key: Option<String>,
) -> Result<String, ProjectError> {
    call_provider_tuned(base_url, model, system, user, key, 8_192, 0.35, "el diseño").await
}

async fn call_provider_tuned(
    base_url: &str,
    model: &str,
    system: &str,
    user: &str,
    key: Option<String>,
    max_tokens: u32,
    temperature: f64,
    label: &str,
) -> Result<String, ProjectError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let body = json!({
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });
    let mut call = client
        .post(chat_endpoint(base_url))
        .json(&body)
        .header("Accept", "application/json");
    if let Some(secret) = key {
        call = call.bearer_auth(secret);
    }
    let response = call.send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            "el proveedor no respondió en 180 segundos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el proveedor; revisá que esté encendido".to_owned()
        } else {
            "la llamada al proveedor falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó {label} (HTTP {})",
                response.status().as_u16()
            ),
        ));
    }
    let payload: serde_json::Value = response.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor no devolvió JSON legible",
        )
    })?;
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

#[tauri::command]
pub async fn design_generate(
    state: State<'_, AppState>,
    request: DesignRequest,
) -> Result<DesignReply, ProjectError> {
    let brief = request.brief.trim();
    if brief.chars().count() < 20 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "escribí un brief de al menos 20 caracteres",
        ));
    }
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor real en Ajustes → IA antes de generar",
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
    let format = clean_format(&request.format);
    let system = system_prompt(&format);
    let user = build_user_message(&request, &format);
    if user.len() > MAX_CONTEXT_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el contexto del diseño es demasiado grande",
        ));
    }
    let content = call_provider(&provider.base_url, &provider.model, &system, &user, key).await?;
    let html = extract_html(&content).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor no devolvió un documento HTML",
        )
    })?;
    validate_html(&html).map_err(|reason| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            &format!("el diseño generado no es seguro: {reason}"),
        )
    })?;
    Ok(DesignReply {
        html,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
        format,
    })
}

const MAX_DIRECTION_BRIEF_CHARS: usize = 4_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDirectionsRequest {
    pub brief: String,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDirection {
    pub name: String,
    pub concept: String,
    pub bg: String,
    pub surface: String,
    pub fg: String,
    pub accent: String,
    pub accent_on: String,
    pub display_font: String,
    pub body_font: String,
    pub layout: String,
    pub why: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDirectionsReply {
    pub directions: Vec<DesignDirection>,
    pub provider_id: String,
    pub model: String,
}

fn hex_color(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    let hex = raw.strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", hex.to_ascii_lowercase()))
}

fn clean_direction_text(value: Option<&str>, max: usize, fallback: &str) -> String {
    let text = value.unwrap_or(fallback).trim();
    let taken: String = text.chars().take(max).collect();
    if taken.is_empty() {
        fallback.to_owned()
    } else {
        taken
    }
}

fn parse_directions(content: &str) -> Result<Vec<DesignDirection>, String> {
    // Algunos modelos razonan antes de responder y pueden incluir ejemplos en
    // prosa. Se prueban los objetos JSON desde cada llave hasta la última, y se
    // acepta el primero que tenga un array `directions` válido.
    let mut payload = None;
    for (index, _) in content.match_indices('{') {
        let candidate = &content[index..];
        let Some(end) = candidate.rfind('}') else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&candidate[..=end]) {
            if value["directions"].is_array() {
                payload = Some(value);
                break;
            }
        }
    }
    let payload = payload.ok_or("el JSON de direcciones no es válido")?;
    let items = payload["directions"]
        .as_array()
        .ok_or("la respuesta no trae directions")?;
    let mut directions = Vec::new();
    for item in items.iter().take(3) {
        let palette = &item["palette"];
        let fonts = &item["fonts"];
        let bg = hex_color(palette["bg"].as_str())
            .ok_or("una dirección no trae un palette.bg hexadecimal")?;
        let fg = hex_color(palette["fg"].as_str())
            .ok_or("una dirección no trae un palette.fg hexadecimal")?;
        let accent = hex_color(palette["accent"].as_str())
            .ok_or("una dirección no trae un palette.accent hexadecimal")?;
        let surface = hex_color(palette["surface"].as_str()).unwrap_or_else(|| bg.clone());
        let accent_on = hex_color(palette["accentOn"].as_str())
            .or_else(|| hex_color(palette["accent-on"].as_str()))
            .unwrap_or_else(|| fg.clone());
        directions.push(DesignDirection {
            name: clean_direction_text(item["name"].as_str(), 80, "Dirección"),
            concept: clean_direction_text(item["concept"].as_str(), 600, "Sin concepto"),
            bg,
            surface,
            fg,
            accent,
            accent_on,
            display_font: clean_direction_text(fonts["display"].as_str(), 80, "Inter"),
            body_font: clean_direction_text(fonts["body"].as_str(), 80, "Inter"),
            layout: clean_direction_text(item["layout"].as_str(), 600, "Composición editorial"),
            why: clean_direction_text(item["why"].as_str(), 600, "Diferencia visual clara"),
        });
    }
    if directions.is_empty() {
        return Err("la respuesta no trajo direcciones utilizables".to_owned());
    }
    Ok(directions)
}

fn directions_system_prompt() -> &'static str {
    "Sos un director de arte. A partir del brief, proponé exactamente 3 direcciones visuales distintas y defendibles. Devolvé SOLO JSON válido con esta forma: {\"directions\":[{\"name\":\"…\",\"concept\":\"…\",\"palette\":{\"bg\":\"#rrggbb\",\"surface\":\"#rrggbb\",\"fg\":\"#rrggbb\",\"accent\":\"#rrggbb\",\"accentOn\":\"#rrggbb\"},\"fonts\":{\"display\":\"…\",\"body\":\"…\"},\"layout\":\"…\",\"why\":\"…\"}]}. Usá colores hexadecimales de seis dígitos, fuentes web seguras, layouts CSS sin grid, y explicá en una frase por qué cada dirección resuelve el brief. No inventes marcas ni datos, no uses recursos externos ni scripts. Respondé únicamente con el JSON, sin explicaciones ni markdown."
}

/// Propone tres direcciones visuales distintas con el proveedor real.
#[tauri::command]
pub async fn design_directions(
    state: State<'_, AppState>,
    request: DesignDirectionsRequest,
) -> Result<DesignDirectionsReply, ProjectError> {
    let brief = request.brief.trim();
    if brief.chars().count() < 20 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "escribí un brief de al menos 20 caracteres",
        ));
    }
    let brief = take(brief, MAX_DIRECTION_BRIEF_CHARS);
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor real en Ajustes → IA antes de proponer direcciones",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de proponer direcciones",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let content = call_provider_tuned(
        &provider.base_url,
        &provider.model,
        directions_system_prompt(),
        &brief,
        key,
        6_000,
        0.6,
        "las direcciones",
    )
    .await?;
    let directions = parse_directions(&content).map_err(|reason| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            &format!("el proveedor no devolvió direcciones utilizables: {reason}"),
        )
    })?;
    Ok(DesignDirectionsReply {
        directions,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
    })
}

const MAX_CRITIQUE_HTML_CHARS: usize = 60_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignCritiqueRequest {
    pub html: String,
    #[serde(default)]
    pub brief: String,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignCritiqueReply {
    pub critique: String,
    pub provider_id: String,
    pub model: String,
}

fn critique_system_prompt() -> &'static str {
    "Sos un revisor de diseño senior. Evaluá el HTML entregado contra cinco dimensiones: craft (layout, jerarquía, espaciado, ritmo), problema (¿resuelve el brief?), marca (tokens, tipografía y voz del sistema), accesibilidad (contraste, foco, etiquetas, orden de encabezados) y copy (específico, legible, sin relleno). Respondé en español rioplatense, en prosa clara y breve: qué revisaste, los hallazgos concretos ordenados por severidad y el arreglo sugerido para cada uno. No inventes datos, no devuelvas JSON, no elogies por rellenar y no propongas ejecutar scripts ni recursos externos."
}

/// Revisa el HTML generado con el proveedor real y devuelve hallazgos en prosa.
#[tauri::command]
pub async fn design_critique(
    state: State<'_, AppState>,
    request: DesignCritiqueRequest,
) -> Result<DesignCritiqueReply, ProjectError> {
    let html = request.html.trim();
    let html_len = html.chars().count();
    if html_len < 20 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el diseño está vacío o es demasiado corto para revisar",
        ));
    }
    if html_len > MAX_CRITIQUE_HTML_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el diseño supera los 60 000 caracteres para revisar",
        ));
    }
    let brief = take(&request.brief, MAX_BRIEF_CHARS);
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor real en Ajustes → IA antes de revisar",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de revisar",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let user = format!(
        "Brief:
{brief}

HTML a revisar:
{html}"
    );
    let critique = call_provider_tuned(
        &provider.base_url,
        &provider.model,
        critique_system_prompt(),
        &user,
        key,
        1_600,
        0.2,
        "la crítica",
    )
    .await?;
    Ok(DesignCritiqueReply {
        critique,
        provider_id: "openai-compatible".to_owned(),
        model: provider.model,
    })
}

fn sanitize_file_name(value: &str) -> String {
    let mapped: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let stem = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .to_lowercase();
    let stem: String = stem.chars().take(60).collect();
    if stem.is_empty() {
        "diseno-olyvia.html".to_owned()
    } else {
        format!("{stem}.html")
    }
}

#[tauri::command]
pub async fn save_design_html(
    app: AppHandle,
    html: String,
    file_name: String,
) -> Result<Option<String>, ProjectError> {
    if html.trim().is_empty() || html.chars().count() > MAX_HTML_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el diseño está vacío o supera el tamaño permitido",
        ));
    }
    let suggested = sanitize_file_name(&file_name);
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Guardar diseño HTML")
        .add_filter("Documento HTML", &["html"])
        .set_file_name(&suggested)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let output = if picked.extension().is_none() {
        picked.with_extension("html")
    } else {
        picked
    };
    std::fs::write(&output, html.as_bytes()).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo guardar el HTML: {error}"),
        )
    })?;
    Ok(Some(output.to_string_lossy().into_owned()))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let signature = [0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes[..8] != signature || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    Some((width, height))
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut index = 2;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        if marker == 0xd8 || marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            index += 2;
            continue;
        }
        let length = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
        if length < 2 {
            return None;
        }
        let is_sof = matches!(
            marker,
            0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
        );
        if is_sof {
            if index + 9 > bytes.len() {
                return None;
            }
            let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]) as u32;
            let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]) as u32;
            return Some((width, height));
        }
        index += 2 + length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 30 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    match &bytes[12..16] {
        b"VP8X" => {
            let width = 1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]);
            let height = 1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]);
            Some((width, height))
        }
        b"VP8 " => {
            if bytes.len() < 30 || &bytes[23..26] != b"\x9d\x01\x2a" {
                return None;
            }
            let width = u16::from_le_bytes([bytes[26], bytes[27]]) as u32 & 0x3fff;
            let height = u16::from_le_bytes([bytes[28], bytes[29]]) as u32 & 0x3fff;
            Some((width, height))
        }
        b"VP8L" => {
            if bytes[20] != 0x2f {
                return None;
            }
            let bits = u32::from_le_bytes([bytes[21], bytes[22], bytes[23], bytes[24]]);
            let width = 1 + (bits & 0x3fff);
            let height = 1 + ((bits >> 14) & 0x3fff);
            Some((width, height))
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImageKind {
    Png,
    Jpeg,
    Webp,
}

impl ImageKind {
    fn extension(self) -> &'static str {
        match self {
            ImageKind::Png => "png",
            ImageKind::Jpeg => "jpg",
            ImageKind::Webp => "webp",
        }
    }

    fn mime(self) -> &'static str {
        match self {
            ImageKind::Png => "image/png",
            ImageKind::Jpeg => "image/jpeg",
            ImageKind::Webp => "image/webp",
        }
    }

    fn label(self) -> &'static str {
        match self {
            ImageKind::Png => "Imagen PNG",
            ImageKind::Jpeg => "Imagen JPEG",
            ImageKind::Webp => "Imagen WebP",
        }
    }

    fn from_extension(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "png" => Some(ImageKind::Png),
            "jpg" | "jpeg" => Some(ImageKind::Jpeg),
            "webp" => Some(ImageKind::Webp),
            _ => None,
        }
    }
}

fn detect_image(bytes: &[u8]) -> Option<(ImageKind, u32, u32)> {
    if let Some((width, height)) = png_dimensions(bytes) {
        return Some((ImageKind::Png, width, height));
    }
    if let Some((width, height)) = jpeg_dimensions(bytes) {
        return Some((ImageKind::Jpeg, width, height));
    }
    if let Some((width, height)) = webp_dimensions(bytes) {
        return Some((ImageKind::Webp, width, height));
    }
    None
}

/// Guarda un PNG generado por el rasterizador de la interfaz (WebView2).
fn is_mp4(bytes: &[u8]) -> bool {
    bytes.len() > 12 && &bytes[4..8] == b"ftyp"
}

/// Guarda el MP4 generado por WebCodecs en la interfaz.
/// Escribe un PNG/MP4 generado dentro de `<proyecto>/media` para importarlo
/// como material real, sin pasar por el diálogo de guardado.
pub(crate) fn stage_media_file(
    root: &Path,
    bytes: &[u8],
    extension: &str,
) -> Result<PathBuf, ProjectError> {
    let extension = extension.trim().to_ascii_lowercase();
    let (valid, extension) = if extension == "mp4" {
        (is_mp4(bytes), "mp4")
    } else if extension == "png" {
        (bytes.len() >= 24 && png_dimensions(bytes).is_some(), "png")
    } else if matches!(extension.as_str(), "jpg" | "jpeg" | "webp") {
        match detect_image(bytes) {
            Some((kind, _, _)) => (true, kind.extension()),
            None => (false, "jpg"),
        }
    } else {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "extensión de diseño no soportada",
        ));
    };
    if !valid {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no tiene la firma esperada",
        ));
    }
    let media_dir = root.join("media");
    std::fs::create_dir_all(&media_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo preparar la carpeta media: {error}"),
        )
    })?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let path = media_dir.join(format!("diseno-{stamp}.{extension}"));
    std::fs::write(&path, bytes).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el diseño en Medios: {error}"),
        )
    })?;
    Ok(path)
}

#[tauri::command]
pub async fn stage_design_media(
    state: State<'_, AppState>,
    bytes_base64: String,
    extension: String,
) -> Result<String, ProjectError> {
    let session = state.require_session()?;
    let bytes = STANDARD.decode(bytes_base64).map_err(|_| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "el archivo no es válido")
    })?;
    let path = stage_media_file(&session.root, &bytes, &extension)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn save_design_video(
    app: AppHandle,
    video_base64: String,
    file_name: String,
) -> Result<Option<String>, ProjectError> {
    let bytes = STANDARD.decode(video_base64).map_err(|_| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "el video no es válido")
    })?;
    if !is_mp4(&bytes) || bytes.len() > 200 * 1024 * 1024 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no es un MP4 válido o supera los 200 MB",
        ));
    }
    let mut suggested = sanitize_file_name(&file_name);
    for extension in [".html", ".png", ".mp4"] {
        if suggested.ends_with(extension) {
            suggested.truncate(suggested.len() - extension.len());
        }
    }
    suggested.push_str(".mp4");
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Guardar diseño MP4")
        .add_filter("Video MP4", &["mp4"])
        .set_file_name(&suggested)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let output = if picked.extension().is_none() {
        picked.with_extension("mp4")
    } else {
        picked
    };
    std::fs::write(&output, bytes).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo guardar el MP4: {error}"),
        )
    })?;
    Ok(Some(output.to_string_lossy().into_owned()))
}

fn is_pdf(bytes: &[u8]) -> bool {
    bytes.len() > 8 && bytes.starts_with(b"%PDF-")
}

/// Guarda el PDF del deck generado por la interfaz.
#[tauri::command]
pub async fn save_design_pdf(
    app: AppHandle,
    pdf_base64: String,
    file_name: String,
) -> Result<Option<String>, ProjectError> {
    let bytes = STANDARD.decode(pdf_base64).map_err(|_| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "el PDF no es válido")
    })?;
    if !is_pdf(&bytes) || bytes.len() > 100 * 1024 * 1024 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no es un PDF válido o supera los 100 MB",
        ));
    }
    let mut suggested = sanitize_file_name(&file_name);
    for extension in [".html", ".png", ".mp4", ".pdf"] {
        if suggested.ends_with(extension) {
            suggested.truncate(suggested.len() - extension.len());
        }
    }
    suggested.push_str(".pdf");
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Guardar deck PDF")
        .add_filter("Documento PDF", &["pdf"])
        .set_file_name(&suggested)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let output = if picked.extension().is_none() {
        picked.with_extension("pdf")
    } else {
        picked
    };
    std::fs::write(&output, bytes).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo guardar el PDF: {error}"),
        )
    })?;
    Ok(Some(output.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn save_design_png(
    app: AppHandle,
    png_base64: String,
    file_name: String,
) -> Result<Option<String>, ProjectError> {
    let bytes = STANDARD.decode(png_base64).map_err(|_| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "el PNG no es válido")
    })?;
    if bytes.len() < 24 || png_dimensions(&bytes).is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no es un PNG válido",
        ));
    }
    let mut suggested = sanitize_file_name(&file_name);
    if suggested.ends_with(".html") {
        suggested.truncate(suggested.len() - 5);
    }
    suggested.push_str(".png");
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Guardar diseño PNG")
        .add_filter("Imagen PNG", &["png"])
        .set_file_name(&suggested)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let output = if picked.extension().is_none() {
        picked.with_extension("png")
    } else {
        picked
    };
    std::fs::write(&output, bytes).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo guardar el PNG: {error}"),
        )
    })?;
    Ok(Some(output.to_string_lossy().into_owned()))
}

const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;
const POLLINATIONS_ENDPOINT: &str = "https://image.pollinations.ai/prompt";
const MAX_IMAGE_PROMPT_CHARS: usize = 1_200;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignImageRequest {
    pub prompt: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub approved_cost: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignImageReply {
    pub bytes_base64: String,
    pub mime: String,
    pub extension: String,
    pub width: u32,
    pub height: u32,
    pub source: String,
    pub model: String,
}

fn clean_image_source(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "gateway" => "gateway",
        _ => "pollinations",
    }
}

fn images_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/images/generations") {
        trimmed.to_owned()
    } else {
        format!("{trimmed}/images/generations")
    }
}

fn encode_prompt(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len() * 3);
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn provider_message(body: &str) -> String {
    let parsed: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let message = parsed["error"]["message"]
        .as_str()
        .or_else(|| parsed["error"].as_str())
        .or_else(|| parsed["message"].as_str())
        .unwrap_or(body);
    let clean: String = message
        .chars()
        .filter(|character| !character.is_control())
        .take(320)
        .collect();
    if clean.trim().is_empty() {
        "el proveedor rechazó la imagen".to_owned()
    } else {
        clean.trim().to_owned()
    }
}

async fn download_image(url: &str, key: Option<String>) -> Result<Vec<u8>, ProjectError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let mut call = client.get(url).header("Accept", "image/*");
    if let Some(secret) = key {
        call = call.bearer_auth(secret);
    }
    let response = call.send().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se pudo descargar la imagen generada",
        )
    })?;
    if !response.status().is_success() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó la descarga (HTTP {})",
                response.status().as_u16()
            ),
        ));
    }
    let bytes = response.bytes().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la imagen llegó incompleta",
        )
    })?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la imagen supera los 24 MB",
        ));
    }
    Ok(bytes.to_vec())
}

async fn generate_gateway_image(
    base_url: &str,
    model: &str,
    prompt: &str,
    width: u32,
    height: u32,
    key: Option<String>,
) -> Result<Vec<u8>, ProjectError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(240))
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let body = json!({
        "model": if model.trim().is_empty() { "auto" } else { model.trim() },
        "prompt": prompt,
        "n": 1,
        "size": format!("{width}x{height}"),
        "response_format": "b64_json"
    });
    let mut call = client
        .post(images_endpoint(base_url))
        .json(&body)
        .header("Accept", "application/json");
    if let Some(secret) = key.clone() {
        call = call.bearer_auth(secret);
    }
    let response = call.send().await.map_err(|error| {
        let safe = if error.is_timeout() {
            "el proveedor de imágenes no respondió en 240 segundos".to_owned()
        } else if error.is_connect() {
            "no se pudo conectar con el proveedor de imágenes".to_owned()
        } else {
            "la llamada de imágenes falló".to_owned()
        };
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
    })?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "el proveedor rechazó la imagen (HTTP {}): {}",
                status.as_u16(),
                provider_message(&text)
            ),
        ));
    }
    let payload: serde_json::Value = response.json().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor no devolvió JSON legible",
        )
    })?;
    let entry = &payload["data"][0];
    if let Some(encoded) = entry["b64_json"].as_str() {
        if encoded.len() > MAX_IMAGE_BYTES / 3 * 4 + 8 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la imagen supera los 24 MB",
            ));
        }
        return STANDARD.decode(encoded).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "la imagen devuelta no es base64 válido",
            )
        });
    }
    if let Some(url) = entry["url"].as_str() {
        return download_image(url, key).await;
    }
    if let Some(encoded) = entry["image"].as_str() {
        if let Some((_, data)) = encoded.split_once("base64,") {
            return STANDARD.decode(data).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProviderResponse,
                    "la imagen devuelta no es base64 válido",
                )
            });
        }
    }
    Err(ProjectError::message(
        ProjectErrorCode::InvalidProviderResponse,
        "la respuesta de imágenes no trae data[0].b64_json ni data[0].url",
    ))
}

async fn generate_pollinations_image(
    prompt: &str,
    width: u32,
    height: u32,
    seed: Option<u64>,
    model: &str,
) -> Result<Vec<u8>, ProjectError> {
    let mut url = format!(
        "{POLLINATIONS_ENDPOINT}/{}?width={width}&height={height}&nologo=true",
        encode_prompt(prompt)
    );
    if let Some(value) = seed {
        url.push_str(&format!("&seed={value}"));
    }
    let model = model.trim();
    if !model.is_empty() && model != "auto" {
        url.push_str(&format!("&model={}", encode_prompt(model)));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent("Olyvia/0.4 (image generation)")
        .build()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se pudo preparar la conexión",
            )
        })?;
    let response = client
        .get(&url)
        .header("Accept", "image/*")
        .send()
        .await
        .map_err(|error| {
            let safe = if error.is_timeout() {
                "Pollinations no respondió en 120 segundos".to_owned()
            } else {
                "no se pudo conectar con Pollinations".to_owned()
            };
            ProjectError::message(ProjectErrorCode::ProviderUnavailable, &safe)
        })?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            &format!(
                "Pollinations rechazó la imagen (HTTP {}): {}",
                status.as_u16(),
                provider_message(&text)
            ),
        ));
    }
    let bytes = response.bytes().await.map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la imagen llegó incompleta",
        )
    })?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la imagen supera los 24 MB",
        ));
    }
    Ok(bytes.to_vec())
}

/// Genera una imagen real con el proveedor configurado o con la API libre de
/// Pollinations. Devuelve los bytes originales junto con sus dimensiones
/// medidas, sin inventar un formato ni un tamaño que el archivo no tenga.
#[tauri::command]
pub async fn design_generate_image(
    state: State<'_, AppState>,
    request: DesignImageRequest,
) -> Result<DesignImageReply, ProjectError> {
    let prompt = request.prompt.trim();
    let prompt_len = prompt.chars().count();
    if prompt_len < 8 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "escribí un prompt de al menos 8 caracteres",
        ));
    }
    if prompt_len > MAX_IMAGE_PROMPT_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el prompt supera los 1200 caracteres",
        ));
    }
    let width = request.width.clamp(256, 2048);
    let height = request.height.clamp(256, 2048);
    let source = clean_image_source(&request.source);
    let (bytes, model) = if source == "gateway" {
        let settings = state.settings_snapshot()?;
        let provider = settings.provider.clone();
        if provider.base_url.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "configurá un proveedor real en Ajustes → IA antes de generar imágenes",
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
        let model = if request.model.trim().is_empty() {
            "auto".to_owned()
        } else {
            request.model.trim().to_owned()
        };
        let bytes =
            generate_gateway_image(&provider.base_url, &model, prompt, width, height, key).await?;
        (bytes, model)
    } else {
        let model = if request.model.trim().is_empty() {
            "sana".to_owned()
        } else {
            request.model.trim().to_owned()
        };
        let bytes =
            generate_pollinations_image(prompt, width, height, request.seed, &model).await?;
        (bytes, model)
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "la imagen supera los 24 MB",
        ));
    }
    let (kind, measured_width, measured_height) = detect_image(&bytes).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el proveedor devolvió un archivo que no es PNG, JPEG ni WebP",
        )
    })?;
    Ok(DesignImageReply {
        bytes_base64: STANDARD.encode(&bytes),
        mime: kind.mime().to_owned(),
        extension: kind.extension().to_owned(),
        width: measured_width,
        height: measured_height,
        source: source.to_owned(),
        model,
    })
}

fn sanitize_image_file_name(value: &str, extension: &str) -> String {
    let mapped: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    let stem = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .to_lowercase();
    let stem: String = stem.chars().take(60).collect();
    if stem.is_empty() {
        format!("imagen-olyvia.{extension}")
    } else {
        format!("{stem}.{extension}")
    }
}

/// Guarda la imagen generada con el formato real que devolvió el proveedor.
#[tauri::command]
pub async fn save_design_image(
    app: AppHandle,
    image_base64: String,
    file_name: String,
) -> Result<Option<String>, ProjectError> {
    let bytes = STANDARD.decode(image_base64).map_err(|_| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "la imagen no es válida")
    })?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la imagen supera los 24 MB",
        ));
    }
    let (kind, _, _) = detect_image(&bytes).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no es una imagen PNG, JPEG ni WebP",
        )
    })?;
    let suggested = sanitize_image_file_name(&file_name, kind.extension());
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Guardar imagen generada")
        .add_filter(kind.label(), &[kind.extension()])
        .set_file_name(&suggested)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let picked = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let matches_kind = picked
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(kind.extension()))
        .unwrap_or(false);
    let output = if matches_kind {
        picked
    } else {
        picked.with_extension(kind.extension())
    };
    std::fs::write(&output, bytes).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo guardar la imagen: {error}"),
        )
    })?;
    Ok(Some(output.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_a_fenced_document() {
        let content = "```html\n<!doctype html>\n<html><body>Hola</body></html>\n```";
        assert_eq!(
            extract_html(content).as_deref(),
            Some("<!doctype html>\n<html><body>Hola</body></html>")
        );
    }

    #[test]
    fn extracts_html_with_surrounding_text() {
        let content = "Aquí está:\n<html><body>Diseño</body></html>\nListo.";
        assert_eq!(
            extract_html(content).as_deref(),
            Some("<html><body>Diseño</body></html>")
        );
    }

    #[test]
    fn rejects_scripts_external_assets_and_handlers() {
        for html in [
            "<html><script>alert(1)</script></html>",
            "<html><img src=\"https://example.com/a.png\"></html>",
            "<html><style>@import url('https://x')</style></html>",
            "<html><body onclick=\"alert(1)\">x</body></html>",
            "<html><iframe src=\"x\"></iframe></html>",
        ] {
            assert!(validate_html(html).is_err(), "{html} debería rechazarse");
        }
    }

    #[test]
    fn accepts_a_self_contained_design() {
        let html = "<!doctype html><html><head><style>:root{--accent:#1f5eff}body{background:#0f1115;color:#fff}</style></head><body><main><h1>Hola</h1><svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\" fill=\"#1f5eff\"/></svg></main></body></html>";
        assert!(validate_html(html).is_ok());
    }

    #[test]
    fn sanitizes_the_suggested_file_name() {
        assert_eq!(sanitize_file_name("Mi diseño: café"), "mi-dise-o-caf.html");
        assert_eq!(sanitize_file_name("  "), "diseno-olyvia.html");
    }

    #[test]
    fn normalizes_the_format() {
        assert_eq!(clean_format("DASHBOARD"), "dashboard");
        assert_eq!(clean_format("otro"), "page");
    }

    #[test]
    #[ignore = "escribe un proyecto temporal y llama a ffprobe; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_stage_and_import_png_into_a_project() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la importación real");
            return;
        }
        const PIXEL: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=";
        let png = STANDARD.decode(PIXEL).expect("PNG de prueba");
        let root = std::env::temp_dir().join(format!(
            "olyvia-stage-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|value| value.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&root).expect("carpeta temporal");
        let staged = stage_media_file(&root, &png, "png").expect("stage del PNG");
        assert!(staged.starts_with(root.join("media")));
        let ffprobe = std::env::var("EDITOR_IA_FFPROBE").unwrap_or_else(|_| "ffprobe".to_owned());
        let asset = crate::media::import_file(&root, &staged, Path::new(&ffprobe), 30, 1)
            .expect("ffprobe debe importar el PNG");
        assert_eq!(asset["kind"], serde_json::json!("image"));
        assert_eq!(asset["media"]["width"], serde_json::json!(1));
        let relative = asset["source"]["path"].as_str().expect("ruta relativa");
        assert!(relative.starts_with("media/"), "{relative}");
        eprintln!("stage+import PNG real: {relative}");

        const JPEG: &str = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
        let jpeg = STANDARD.decode(JPEG).expect("JPEG de prueba");
        let staged_jpeg = stage_media_file(&root, &jpeg, "jpg").expect("stage del JPEG");
        assert_eq!(
            staged_jpeg.extension().and_then(|value| value.to_str()),
            Some("jpg")
        );
        let imported_jpeg =
            crate::media::import_file(&root, &staged_jpeg, Path::new(&ffprobe), 30, 1)
                .expect("ffprobe debe importar el JPEG");
        assert_eq!(imported_jpeg["kind"], serde_json::json!("image"));
        eprintln!(
            "stage+import JPEG real: {}",
            imported_jpeg["source"]["path"].as_str().unwrap_or("?")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn accepts_mp4_ftyp_signature() {
        let mut bytes = vec![0, 0, 0, 24];
        bytes.extend_from_slice(b"ftyp");
        bytes.extend_from_slice(&[0; 20]);
        assert!(is_mp4(&bytes));
        assert!(!is_mp4(b"no es un video"));
    }

    #[test]
    #[ignore = "consulta el proveedor configurado; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_list_provider_models() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let base = std::env::var("EDITOR_IA_ASSISTANT_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:31415/v1".to_owned());
        let url = format!("{}/models", base.trim_end_matches('/'));
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let client = reqwest::Client::new();
        let response = runtime
            .block_on(async {
                let mut request = client.get(&url).header("Accept", "application/json");
                if let Some(key) = read_key() {
                    request = request.bearer_auth(key);
                }
                request.send().await
            })
            .expect("proveedor");
        let payload: serde_json::Value = runtime.block_on(response.json()).expect("json");
        let ids = payload["data"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item["id"].as_str().map(str::to_owned))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        eprintln!("modelos disponibles ({}): {}", ids.len(), ids.join(", "));
    }

    #[test]
    fn parses_three_direction_cards() {
        let content = r##"{"directions":[
          {"name":"Cobalto editorial","concept":"Papel y tinta","palette":{"bg":"#F5F2EF","surface":"#FFFFFF","fg":"#1C1410","accent":"#D8000F","accentOn":"#FFFFFF"},"fonts":{"display":"Fraunces","body":"Inter"},"layout":"Columna editorial","why":"Contraste cálido"},
          {"name":"Señal nocturna","concept":"Interfaz de datos","palette":{"bg":"#0B0F14","surface":"#111820","fg":"#E6EDF7","accent":"#5B8CFF"},"fonts":{"display":"Space Grotesk","body":"Inter"},"layout":"Panel lateral","why":"Lectura rápida"},
          {"name":"Campo abierto","concept":"Fotografía y aire","palette":{"bg":"#F4F7F2","surface":"#E8EFE5","fg":"#1A2A1E","accent":"#3E7C4A"},"fonts":{"display":"DM Serif Display","body":"Source Sans 3"},"layout":"Hero asimétrico","why":"Calma y confianza"}
        ]}"##;
        let directions = parse_directions(content).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(directions.len(), 3);
        assert_eq!(directions[0].bg, "#f5f2ef");
        assert_eq!(directions[1].accent_on, "#e6edf7");
        assert_eq!(directions[2].display_font, "DM Serif Display");
    }

    #[test]
    fn rejects_directions_without_valid_palette() {
        assert!(
            parse_directions(r##"{"directions":[{"name":"x","palette":{"bg":"red"}}]}"##).is_err()
        );
        assert!(parse_directions("no json").is_err());
    }

    #[test]
    #[ignore = "llama al proveedor configurado; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_directions_provider_round_trip() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let base = std::env::var("EDITOR_IA_ASSISTANT_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:31415/v1".to_owned());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let content = runtime
            .block_on(call_provider_tuned(
                &base,
                &std::env::var("EDITOR_IA_DIRECTIONS_MODEL")
                    .unwrap_or_else(|_| "auto".to_owned()),
                directions_system_prompt(),
                "Landing para un estudio de edición de video que vende piezas cortas a marcas; público de marketing; debe mostrar tres ejemplos y cerrar con una llamada.",
                read_key(),
                1_800,
                0.6,
                "las direcciones",
            ))
            .expect("direcciones reales");
        let directions = parse_directions(&content).expect("direcciones parseables");
        eprintln!(
            "direcciones reales: {} ({})",
            directions.len(),
            directions
                .iter()
                .map(|direction| direction.name.as_str())
                .collect::<Vec<_>>()
                .join(" · ")
        );
    }

    #[test]
    fn critique_prompt_covers_the_five_dimensions() {
        let prompt = critique_system_prompt();
        for dimension in ["craft", "problema", "marca", "accesibilidad", "copy"] {
            assert!(prompt.contains(dimension), "falta {dimension}");
        }
        assert!(prompt.contains("prosa"), "la crítica se pide en prosa");
    }

    #[test]
    #[ignore = "llama al proveedor configurado; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_critique_provider_round_trip() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let base = std::env::var("EDITOR_IA_ASSISTANT_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:31415/v1".to_owned());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let html = "<!doctype html><html><body><main><h1>Hola</h1><p>Un párrafo de prueba con poco contraste.</p></main></body></html>";
        let user = format!(
            "Brief:
Una landing simple.

HTML a revisar:
{html}"
        );
        let reply = runtime
            .block_on(call_provider_tuned(
                &base,
                "auto",
                critique_system_prompt(),
                &user,
                read_key(),
                800,
                0.2,
                "la crítica",
            ))
            .expect("crítica real");
        eprintln!("crítica real: {} caracteres", reply.chars().count());
    }

    #[test]
    fn measures_real_image_headers() {
        const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=";
        const JPEG: &str = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";
        const WEBP: &str = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA=";
        for (encoded, kind) in [
            (PNG, ImageKind::Png),
            (JPEG, ImageKind::Jpeg),
            (WEBP, ImageKind::Webp),
        ] {
            let bytes = STANDARD.decode(encoded).expect("fixture");
            let (detected, width, height) = detect_image(&bytes).expect("cabecera de imagen");
            assert_eq!(detected, kind);
            assert_eq!((width, height), (1, 1));
        }
        assert!(detect_image(b"no es una imagen").is_none());
    }

    #[test]
    fn encodes_image_prompts_for_urls() {
        assert_eq!(
            encode_prompt("fondo azul cobalto/ámbar"),
            "fondo%20azul%20cobalto%2F%C3%A1mbar"
        );
        assert_eq!(encode_prompt("safe-._~"), "safe-._~");
    }

    #[test]
    fn builds_image_endpoints_and_names() {
        assert_eq!(
            images_endpoint("http://127.0.0.1:31415/v1/"),
            "http://127.0.0.1:31415/v1/images/generations"
        );
        assert_eq!(
            images_endpoint("https://api.example.com/v1/images/generations"),
            "https://api.example.com/v1/images/generations"
        );
        assert_eq!(
            sanitize_image_file_name("Mi retrato: café", "jpg"),
            "mi-retrato-caf.jpg"
        );
        assert_eq!(sanitize_image_file_name("  ", "png"), "imagen-olyvia.png");
    }

    #[test]
    fn extracts_provider_error_messages() {
        assert_eq!(
            provider_message(
                r#"{"error":{"message":"Free limit reached: 1 image every 45 seconds"}}"#
            ),
            "Free limit reached: 1 image every 45 seconds"
        );
        assert_eq!(provider_message(r#"{"error":"sin cupo"}"#), "sin cupo");
        assert_eq!(provider_message(""), "el proveedor rechazó la imagen");
    }

    #[test]
    #[ignore = "consume una generación real; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_pollinations_image_generation() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let outcome = runtime.block_on(generate_pollinations_image(
            "fondo abstracto geométrico azul cobalto y ámbar",
            512,
            512,
            Some(11),
            "sana",
        ));
        let bytes = match outcome {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!("Pollinations no generó en esta corrida: {error:?}");
                return;
            }
        };
        let (kind, width, height) = detect_image(&bytes).expect("imagen real medible");
        assert_eq!((width, height), (512, 512));
        let output = std::env::temp_dir().join("olyvia-pollinations-live.jpg");
        std::fs::write(&output, &bytes).expect("guardar la imagen live");
        eprintln!(
            "Pollinations real: {:?} {}×{} {} bytes en {}",
            kind,
            width,
            height,
            bytes.len(),
            output.display()
        );
    }

    #[test]
    fn accepts_pdf_signature() {
        assert!(is_pdf(
            b"%PDF-1.7
..."
        ));
        assert!(!is_pdf(b"no es un pdf"));
    }

    #[test]
    fn reads_png_dimensions_from_the_header() {
        const PIXEL: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=";
        let bytes = STANDARD.decode(PIXEL).expect("PNG de prueba");
        assert_eq!(png_dimensions(&bytes), Some((1, 1)));
        assert!(png_dimensions(b"no es un png").is_none());
    }

    /// Ronda real contra el proveedor configurado (FreeLLMAPI por defecto).
    /// Requiere `EDITOR_IA_RUN_RENDER_TESTS=1`, el servicio encendido y la
    /// clave guardada en el Credential Manager. Verifica el camino completo
    /// del comando: prompt, respuesta, extracción y validación.
    #[test]
    #[ignore = "llamada real al proveedor; requiere EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_design_round_trip_generates_safe_html() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la llamada real");
            return;
        }
        let base_url = std::env::var("EDITOR_IA_ASSISTANT_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:31415/v1".to_owned());
        let model =
            std::env::var("EDITOR_IA_ASSISTANT_MODEL").unwrap_or_else(|_| "auto".to_owned());
        let request = DesignRequest {
            brief: "Tarjeta cuadrada para anunciar un taller de edición de video de 3 horas. Público: creadores que ya publican pero editan lento. Debe mostrar el título del taller, la duración, la fecha y una llamada a reservar.".to_owned(),
            format: "card".to_owned(),
            system_name: "Agentic".to_owned(),
            tokens_css: ":root{--bg:#0b1020;--surface:#131b2f;--fg:#f8fafc;--muted:#8ea0b8;--border:#293653;--accent:#60a5fa;--font-display:Inter,system-ui,sans-serif;--font-body:Inter,system-ui,sans-serif;}".to_owned(),
            craft: Vec::new(),
            recipe: None,
            approved_cost: true,
        };
        let user = build_user_message(&request, "card");
        let started = std::time::Instant::now();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime de tokio");
        let content = runtime
            .block_on(call_provider(
                &base_url,
                &model,
                &system_prompt("card"),
                &user,
                read_key(),
            ))
            .expect("el proveedor local debe responder");
        let elapsed = started.elapsed();
        let html = extract_html(&content).expect("la respuesta debe traer HTML");
        validate_html(&html).expect("el HTML debe ser seguro");
        let artifact = std::env::temp_dir().join("olyvia-design-live.html");
        let _ = std::fs::write(&artifact, html.as_bytes());
        eprintln!(
            "diseño real {model} en {elapsed:.1?}: {} caracteres, {} bytes · {}",
            html.chars().count(),
            html.len(),
            artifact.display()
        );
        assert!(html.contains("<html") || html.contains("<!doctype html"));
        assert!(!html.to_ascii_lowercase().contains("<script"));
    }
}
