//! Navegador embebido de Olyvia: ventanas propias con WebView2 (Chromium real).
//!
//! A diferencia del Chrome dedicado de `flow_browser`, esto NO lanza procesos
//! externos: cada "sesión web" es una ventana de la app que renderiza la web
//! con el motor WebView2 y el perfil persistente de la app (las cookies/sesión
//! de Google u otros sitios sobreviven entre aperturas).
//!
//! Soporta MÚLTIPLES sesiones con nombre (`slot`): "flow", "canva", "free-tier-x"…
//! cada una es una ventana `web-<slot>` con su propio puerto CDP derivado del
//! nombre, así varias webs pueden estar activas a la vez.
//!
//! Para automatización cada ventana expone:
//! - `--remote-debugging-port` vía `additional_browser_args`: controlable por
//!   CDP (Playwright `--cdp-endpoint`), habilita clicks, screenshots, descargas.
//! - `eval_with_callback`: ejecutar JS en la página y recuperar el resultado.
//! - Comandos de navegación (atrás/adelante/recargar).
//!
//! Los comandos `flow_embed_*` son alias del slot "flow" por compatibilidad.
//!
//! Limitación honesta: Google puede rechazar el login dentro de webviews
//! embebidos ("navegador no seguro"). Si eso pasa, la alternativa es el
//! navegador dedicado por CDP de `flow_browser`.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::projects::service::{ProjectError, ProjectErrorCode};

const DEFAULT_SLOT: &str = "flow";
const DEFAULT_URL: &str = "https://flow.google.com";
const WINDOW_WIDTH: f64 = 1280.0;
const WINDOW_HEIGHT: f64 = 800.0;
const MIN_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 560.0;
const BASE_CDP_PORT: u16 = 19223;
const CDP_PORT_RANGE: u16 = 48;
const EVAL_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSessionInfo {
    /// Nombre del slot ("flow", "canva", …).
    pub name: String,
    /// URL que está cargando/mostrando.
    pub url: Option<String>,
    /// Endpoint CDP de la ventana (sólo cuando está abierta).
    pub cdp_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSessionsStatus {
    /// Todas las sesiones web abiertas, ordenadas por nombre.
    pub sessions: Vec<WebSessionInfo>,
}

/// Registro de slots abiertos: nombre → puerto CDP asignado. Mantiene el
/// puerto estable mientras la ventana exista y permite derivar uno por slot.
static SLOTS: Mutex<BTreeMap<String, u16>> = Mutex::new(BTreeMap::new());

fn sanitize_slot(slot: &str) -> Result<String, ProjectError> {
    let trimmed = slot.trim().to_lowercase();
    if trimmed.is_empty()
        || trimmed.len() > 32
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el nombre de la sesión web debe tener 1-32 caracteres (letras, números, - o _)",
        ));
    }
    Ok(trimmed)
}

fn window_label(slot: &str) -> String {
    format!("web-{slot}")
}

/// Puerto CDP estable por slot: "flow" siempre 19223; el resto deriva del
/// nombre dentro de un rango local para no pisarse entre sesiones.
fn slot_port(slot: &str) -> u16 {
    if slot == DEFAULT_SLOT {
        return BASE_CDP_PORT;
    }
    let mut hash: u32 = 0x811c_9dc5;
    for byte in slot.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    BASE_CDP_PORT + 1 + (hash % u32::from(CDP_PORT_RANGE - 1)) as u16
}

fn register_slot(slot: &str) -> u16 {
    let mut guard = SLOTS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(port) = guard.get(slot) {
        return *port;
    }
    let port = slot_port(slot);
    guard.insert(slot.to_owned(), port);
    port
}

fn unregister_slot(slot: &str) {
    let mut guard = SLOTS.lock().unwrap_or_else(|e| e.into_inner());
    guard.remove(slot);
}

fn slot_port_or_default(slot: &str) -> u16 {
    SLOTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(slot)
        .copied()
        .unwrap_or_else(|| slot_port(slot))
}

fn validate_url(url: &str) -> Result<String, ProjectError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_URL.to_owned());
    }
    if trimmed.len() > 2_048
        || !(trimmed.starts_with("https://") || trimmed.starts_with("http://"))
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del navegador debe ser http(s)",
        ));
    }
    Ok(trimmed.to_owned())
}

fn parse_url(url: &str) -> Result<Url, ProjectError> {
    Url::parse(url).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del navegador no es válida",
        )
    })
}

/// Directorio de datos WebView2 propio por sesión. Obligatorio: WebView2
/// exige que todos los controles que comparten user-data-folder usen los
/// MISMOS argumentos de navegador; la ventana principal usa
/// `--in-process-gpu`, así que cada sesión necesita su propio entorno (lo
/// que además aísla cookies/sesiones entre webs — ideal multi-cuenta).
fn session_data_dir(slot: &str) -> std::path::PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| {
            std::path::PathBuf::from(base)
                .join("com.editoria.desktop")
                .join("web-sessions")
                .join(slot)
        })
        .unwrap_or_else(|| std::path::PathBuf::from("web-sessions").join(slot))
}

fn embed_window(app: &AppHandle, slot: &str) -> Result<tauri::WebviewWindow, ProjectError> {
    app.get_webview_window(&window_label(slot)).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la sesión web no está abierta",
        )
    })
}

fn session_info(app: &AppHandle, name: String) -> Option<WebSessionInfo> {
    app.get_webview_window(&window_label(&name)).map(|window| WebSessionInfo {
        name: name.clone(),
        url: window.url().map(|u| u.to_string()).ok(),
        cdp_url: Some(format!(
            "http://127.0.0.1:{}",
            slot_port_or_default(&name)
        )),
    })
}

/// Estado de todas las sesiones web abiertas (multi-web).
#[tauri::command]
pub fn web_sessions_status(app: AppHandle) -> WebSessionsStatus {
    let mut sessions: Vec<WebSessionInfo> = app
        .webview_windows()
        .keys()
        .filter_map(|label| {
            label
                .strip_prefix("web-")
                .map(|slot| session_info(&app, slot.to_owned()))
                .flatten()
        })
        .collect();
    sessions.sort_by(|a, b| a.name.cmp(&b.name));
    WebSessionsStatus { sessions }
}

/// Abre (o reutiliza) una sesión web con nombre apuntando a `url` (http/https).
/// `slot` por defecto es "flow". Si ya está abierta con otra URL, la recrea.
#[tauri::command]
pub fn web_session_open(
    app: AppHandle,
    url: Option<String>,
    slot: Option<String>,
) -> Result<WebSessionsStatus, ProjectError> {
    let name = sanitize_slot(slot.as_deref().unwrap_or(DEFAULT_SLOT))?;
    let target = if name == DEFAULT_SLOT {
        validate_url(url.as_deref().unwrap_or(""))?
    } else {
        let trimmed = url.as_deref().unwrap_or("").trim();
        if trimmed.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "las sesiones que no son flow requieren una URL http(s)",
            ));
        }
        validate_url(trimmed)?
    };
    let parsed = parse_url(&target)?;
    let label = window_label(&name);

    if let Some(existing) = app.get_webview_window(&label) {
        let current = existing.url().map(|u| u.to_string()).unwrap_or_default();
        if current == parsed.as_str() {
            let _ = existing.unminimize();
            let _ = existing.show();
            let _ = existing.set_focus();
            return Ok(web_sessions_status(app));
        }
        let _ = existing.close();
    }

    let port = register_slot(&name);
    let title = if name == DEFAULT_SLOT {
        "Olyvia — Flow".to_owned()
    } else {
        format!("Olyvia — {name}")
    };

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(title)
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .center()
        .theme(Some(tauri::Theme::Dark))
        // CDP en localhost para que Playwright/agentes controlen la página.
        .additional_browser_args(&format!("--remote-debugging-port={port}"))
        .data_directory(session_data_dir(&name))
        .build()
        .map_err(|error| {
            unregister_slot(&name);
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo abrir la sesión web: {error}").as_str(),
            )
        })?;

    Ok(web_sessions_status(app))
}

/// Cierra una sesión web (`slot`, por defecto "flow").
#[tauri::command]
pub fn web_session_close(app: AppHandle, slot: Option<String>) -> Result<bool, ProjectError> {
    let name = sanitize_slot(slot.as_deref().unwrap_or(DEFAULT_SLOT))?;
    match app.get_webview_window(&window_label(&name)) {
        Some(window) => {
            let _ = window.close();
            unregister_slot(&name);
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Navegación histórica de una sesión web.
#[tauri::command]
pub fn web_session_nav(
    app: AppHandle,
    direction: String,
    slot: Option<String>,
) -> Result<bool, ProjectError> {
    let name = sanitize_slot(slot.as_deref().unwrap_or(DEFAULT_SLOT))?;
    let js = match direction.as_str() {
        "back" => "window.history.back()",
        "forward" => "window.history.forward()",
        "reload" => "window.location.reload()",
        _ => {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "dirección inválida: usá back, forward o reload",
            ))
        }
    };
    embed_window(&app, &name)?.eval(js).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo navegar: {error}").as_str(),
        )
    })?;
    Ok(true)
}

/// Ejecuta JS en la página de una sesión web y devuelve el resultado
/// serializado (JSON string, igual que `eval_with_callback` de Tauri).
#[tauri::command]
pub async fn web_session_eval(
    app: AppHandle,
    js: String,
    slot: Option<String>,
) -> Result<String, ProjectError> {
    if js.trim().is_empty() || js.len() > 65_536 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el script debe tener entre 1 y 65536 caracteres",
        ));
    }
    let name = sanitize_slot(slot.as_deref().unwrap_or(DEFAULT_SLOT))?;
    let window = embed_window(&app, &name)?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    window.eval_with_callback(js, move |result| {
        let _ = tx.send(result);
    })
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo evaluar el script: {error}").as_str(),
        )
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(EVAL_TIMEOUT).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "la página no devolvió el resultado a tiempo",
            )
        })
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo esperar el resultado: {error}").as_str(),
        )
    })?
}

// ── Alias flow_embed_* (slot "flow", compatibilidad con la UI/MCP previos) ──

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEmbedStatus {
    /// La ventana de Flow existe (abierta o minimizada).
    pub open: bool,
    /// URL que está cargando/mostrando, si la ventana existe.
    pub url: Option<String>,
    /// Endpoint CDP de la ventana (sólo cuando está abierta).
    pub cdp_url: Option<String>,
}

#[tauri::command]
pub fn flow_embed_status(app: AppHandle) -> FlowEmbedStatus {
    match session_info(&app, DEFAULT_SLOT.to_owned()) {
        Some(info) => FlowEmbedStatus {
            open: true,
            url: info.url,
            cdp_url: info.cdp_url,
        },
        None => FlowEmbedStatus {
            open: false,
            url: None,
            cdp_url: None,
        },
    }
}

#[tauri::command]
pub fn flow_embed_open(
    app: AppHandle,
    url: Option<String>,
) -> Result<FlowEmbedStatus, ProjectError> {
    web_session_open(app.clone(), url, Some(DEFAULT_SLOT.to_owned()))?;
    Ok(flow_embed_status(app))
}

#[tauri::command]
pub fn flow_embed_close(app: AppHandle) -> bool {
    web_session_close(app, Some(DEFAULT_SLOT.to_owned()))
        .unwrap_or(false)
}

#[tauri::command]
pub fn flow_embed_nav(app: AppHandle, direction: String) -> Result<bool, ProjectError> {
    web_session_nav(app, direction, Some(DEFAULT_SLOT.to_owned()))
}

#[tauri::command]
pub async fn flow_embed_eval(app: AppHandle, js: String) -> Result<String, ProjectError> {
    web_session_eval(app, js, Some(DEFAULT_SLOT.to_owned())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_rechaza_nombres_peligrosos() {
        assert!(sanitize_slot("").is_err());
        assert!(sanitize_slot("../etc").is_err());
        assert!(sanitize_slot("a b").is_err());
        assert!(sanitize_slot(&"x".repeat(40)).is_err());
        assert_eq!(sanitize_slot("Flow").unwrap(), "flow");
        assert_eq!(sanitize_slot("mi-web_1").unwrap(), "mi-web_1");
    }

    #[test]
    fn url_vacia_cae_al_default_y_rechaza_esquemas_raros() {
        assert_eq!(validate_url("").unwrap(), DEFAULT_URL);
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn flow_tiene_puerto_cdp_fijo_y_otros_slots_no_colisionan() {
        assert_eq!(slot_port("flow"), BASE_CDP_PORT);
        assert_ne!(slot_port("canva"), slot_port("flow"));
        assert_ne!(slot_port("canva"), slot_port("leonardo"));
        for slot in ["canva", "leonardo", "free-tier"] {
            let port = slot_port(slot);
            assert!(port > BASE_CDP_PORT && port < BASE_CDP_PORT + CDP_PORT_RANGE);
        }
    }

    #[test]
    fn window_label_prefija_web() {
        assert_eq!(window_label("flow"), "web-flow");
        assert_eq!(window_label("canva"), "web-canva");
    }
}
