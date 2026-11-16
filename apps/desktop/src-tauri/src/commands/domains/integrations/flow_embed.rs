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
//!
//! La lógica de slots/puertos/URLs vive en `application::web_sessions`.

use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::application::web_sessions::{
    parse_url, register_slot, sanitize_slot, session_data_dir, slot_port_for, unregister_slot,
    validate_url, window_label, FlowEmbedStatus, WebSessionInfo, WebSessionsStatus, DEFAULT_SLOT,
    MIN_HEIGHT, MIN_WIDTH, WINDOW_HEIGHT, WINDOW_WIDTH,
};
use crate::commands::flow_browser::free_port;
use crate::projects::service::{ProjectError, ProjectErrorCode};

const EVAL_TIMEOUT: Duration = Duration::from_secs(15);

fn embed_window(app: &AppHandle, slot: &str) -> Result<tauri::WebviewWindow, ProjectError> {
    app.get_webview_window(&window_label(slot)).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la sesión web no está abierta",
        )
    })
}

fn session_info(app: &AppHandle, name: String) -> Option<WebSessionInfo> {
    app.get_webview_window(&window_label(&name))
        .map(|window| WebSessionInfo {
            name: name.clone(),
            url: window.url().map(|u| u.to_string()).ok(),
            cdp_url: Some(format!("http://127.0.0.1:{}", slot_port_for(&name))),
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
                .and_then(|slot| session_info(&app, slot.to_owned()))
        })
        .collect();
    sessions.sort_by(|a, b| a.name.cmp(&b.name));
    WebSessionsStatus { sessions }
}

/// Abre (o reutiliza) una sesión web con nombre apuntando a `url` (http/https).
/// `slot` por defecto es "flow". Si ya está abierta con otra URL, la recrea.
///
/// Las ventanas WebView2 sólo se construyen en el hilo principal: este
/// comando valida fuera del hilo de UI y delega el `build()` a
/// `run_on_main_thread`. Antes era síncrono y, invocado por IPC/MCP desde un
/// hilo del runtime, `build()` bloqueaba el loop y colgaba todo el bridge.
#[tauri::command]
pub async fn web_session_open(
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

    let port = register_slot(&name, &free_port);
    let title = if name == DEFAULT_SLOT {
        "Olyvia — Flow".to_owned()
    } else {
        format!("Olyvia — {name}")
    };

    let app_for_build = app.clone();
    let build_name = name.clone();
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let result = WebviewWindowBuilder::new(
            &app_for_build,
            &label,
            WebviewUrl::External(parsed),
        )
        .title(title)
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .center()
        .theme(Some(tauri::Theme::Dark))
        // CDP en localhost para que Playwright/agentes controlen la página.
        .additional_browser_args(&format!("--remote-debugging-port={port}"))
        .data_directory(session_data_dir(&build_name))
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string());
        let _ = tx.send(result);
    })
    .map_err(|error| {
        unregister_slot(&name);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo despachar la apertura de la sesión web: {error}").as_str(),
        )
    })?;

    match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(())) => Ok(web_sessions_status(app)),
        Ok(Err(error)) => {
            unregister_slot(&name);
            Err(ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo abrir la sesión web: {error}").as_str(),
            ))
        }
        Err(_) => {
            unregister_slot(&name);
            Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "el hilo de ventanas no respondió al abrir la sesión web",
            ))
        }
    }
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
    window
        .eval_with_callback(js, move |result| {
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
pub async fn flow_embed_open(
    app: AppHandle,
    url: Option<String>,
) -> Result<FlowEmbedStatus, ProjectError> {
    web_session_open(app.clone(), url, Some(DEFAULT_SLOT.to_owned())).await?;
    Ok(flow_embed_status(app))
}

#[tauri::command]
pub fn flow_embed_close(app: AppHandle) -> bool {
    web_session_close(app, Some(DEFAULT_SLOT.to_owned())).unwrap_or(false)
}

#[tauri::command]
pub fn flow_embed_nav(app: AppHandle, direction: String) -> Result<bool, ProjectError> {
    web_session_nav(app, direction, Some(DEFAULT_SLOT.to_owned()))
}

#[tauri::command]
pub async fn flow_embed_eval(app: AppHandle, js: String) -> Result<String, ProjectError> {
    web_session_eval(app, js, Some(DEFAULT_SLOT.to_owned())).await
}
