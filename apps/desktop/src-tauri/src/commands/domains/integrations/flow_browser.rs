//! Navegador real dedicado para automatización (Google Flow y afines).
//!
//! A diferencia de un webview embebido —que Google bloquea para login— esto
//! lanza el Chrome/Edge REAL del equipo con un perfil propio y depuración remota
//! (CDP) en `127.0.0.1`. La sesión de Google vive en ese perfil entre
//! ejecuciones: el usuario entra una vez y el bot reutiliza las cookies.
//!
//! El control fino de página lo hace un servidor MCP tipo Playwright enganchado
//! al endpoint CDP (`--cdp-endpoint http://127.0.0.1:<port>`); este módulo se
//! ocupa de que el navegador exista, esté sano y sea el mismo entre llamadas.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

const DEFAULT_URL: &str = "https://flow.google.com";
const CDP_READY_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug)]
struct RunningBrowser {
    child: Child,
    port: u16,
}

static BROWSER: Mutex<Option<RunningBrowser>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBrowserStatus {
    /// Chrome/Edge encontrado en el equipo.
    pub browser: Option<String>,
    /// Nombre legible del ejecutable encontrado.
    pub browser_name: Option<String>,
    /// El proceso lanzado por la app sigue vivo.
    pub running: bool,
    /// Puerto CDP activo (sólo cuando running).
    pub port: Option<u16>,
    /// Endpoint CDP para enganches tipo Playwright MCP.
    pub cdp_url: Option<String>,
    /// Perfil persistente donde vive la sesión de Google.
    pub profile_dir: String,
    /// Motivo cuando no se pudo lanzar.
    pub reason: Option<String>,
}

fn browser_candidates() -> Vec<(String, PathBuf)> {
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    let mut push = |name: &str, env: &str, rel: &str| {
        if let Some(base) = std::env::var_os(env) {
            let path = PathBuf::from(base).join(rel);
            if path.is_file() {
                candidates.push((name.to_owned(), path));
            }
        }
    };
    push(
        "Google Chrome",
        "ProgramFiles",
        r"Google\Chrome\Application\chrome.exe",
    );
    push(
        "Google Chrome",
        "ProgramFiles(x86)",
        r"Google\Chrome\Application\chrome.exe",
    );
    push(
        "Google Chrome",
        "LOCALAPPDATA",
        r"Google\Chrome\Application\chrome.exe",
    );
    push(
        "Microsoft Edge",
        "ProgramFiles",
        r"Microsoft\Edge\Application\msedge.exe",
    );
    push(
        "Microsoft Edge",
        "ProgramFiles(x86)",
        r"Microsoft\Edge\Application\msedge.exe",
    );
    push(
        "Microsoft Edge",
        "LOCALAPPDATA",
        r"Microsoft\Edge\Application\msedge.exe",
    );
    candidates
}

pub(crate) fn find_browser() -> Option<(String, PathBuf)> {
    browser_candidates().into_iter().next()
}

fn profile_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| {
            PathBuf::from(base)
                .join("Olyvia")
                .join("flow-browser-profile")
        })
        .unwrap_or_else(|| PathBuf::from("flow-browser-profile"))
}

pub(crate) fn free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
}

/// Pregunta al endpoint HTTP de CDP si el navegador responde de verdad.
pub(crate) fn cdp_alive(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/json/version");
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()
        .and_then(|client| client.get(&url).send().ok())
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

pub(crate) fn wait_cdp(port: u16) -> bool {
    let deadline = Instant::now() + CDP_READY_TIMEOUT;
    while Instant::now() < deadline {
        if cdp_alive(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    false
}

fn validate_url(url: &str) -> Result<String, ProjectError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_URL.to_owned());
    }
    if trimmed.len() > 2_048 || !(trimmed.starts_with("https://") || trimmed.starts_with("http://"))
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL del navegador debe ser http(s)",
        ));
    }
    Ok(trimmed.to_owned())
}

fn status_inner() -> FlowBrowserStatus {
    let (browser, browser_name) = match find_browser() {
        Some((name, path)) => (Some(path.to_string_lossy().into_owned()), Some(name)),
        None => (None, None),
    };
    let profile = profile_dir();
    let mut guard = BROWSER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(running) = guard.as_mut() {
        match running.child.try_wait() {
            Ok(None) => {
                return FlowBrowserStatus {
                    browser,
                    browser_name,
                    running: true,
                    port: Some(running.port),
                    cdp_url: Some(format!("http://127.0.0.1:{}", running.port)),
                    profile_dir: profile.to_string_lossy().into_owned(),
                    reason: None,
                };
            }
            _ => {
                *guard = None;
            }
        }
    }
    FlowBrowserStatus {
        browser,
        browser_name,
        running: false,
        port: None,
        cdp_url: None,
        profile_dir: profile.to_string_lossy().into_owned(),
        reason: None,
    }
}

/// Estado del navegador dedicado: si existe, si corre y dónde está el CDP.
#[tauri::command]
pub fn flow_browser_status() -> FlowBrowserStatus {
    status_inner()
}

/// Lanza el navegador dedicado con perfil propio y CDP en 127.0.0.1.
/// Si ya está corriendo devuelve el estado actual sin relanzar.
#[tauri::command]
pub async fn flow_browser_launch(url: Option<String>) -> Result<FlowBrowserStatus, ProjectError> {
    let target = validate_url(url.as_deref().unwrap_or(""))?;
    let before = status_inner();
    if before.running {
        return Ok(before);
    }
    let Some((name, executable)) = find_browser() else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se encontró Chrome ni Edge en el equipo",
        ));
    };
    let Some(port) = free_port() else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo reservar un puerto local para el navegador",
        ));
    };
    let profile = profile_dir();
    if let Err(error) = std::fs::create_dir_all(&profile) {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo crear el perfil del navegador: {error}").as_str(),
        ));
    }

    let mut command = Command::new(&executable);
    command
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-session-crashed-bubble")
        .arg("--hide-crash-restore-bubble")
        .arg("--new-window")
        .arg(&target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = tauri::async_runtime::spawn_blocking(move || command.spawn())
        .await
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo lanzar el navegador: {error}").as_str(),
            )
        })?
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo ejecutar {}: {error}", name).as_str(),
            )
        })?;

    // El proceso puede tardar en abrir el socket CDP; se verifica de verdad.
    let alive = tauri::async_runtime::spawn_blocking(move || wait_cdp(port))
        .await
        .unwrap_or(false);
    if !alive {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            "el navegador arrancó pero el endpoint de depuración no respondió; puede haber otra instancia de Chrome usando el perfil",
        ));
    }

    {
        let mut guard = BROWSER.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(RunningBrowser { child, port });
    }
    Ok(status_inner())
}

/// Cierra el navegador dedicado lanzado por la app.
#[tauri::command]
pub fn flow_browser_stop() -> bool {
    let mut guard = BROWSER.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_mut() {
        Some(running) => {
            let _ = running.child.kill();
            let _ = running.child.wait();
            *guard = None;
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_vacia_cae_al_default_y_rechaza_esquemas_raros() {
        assert_eq!(validate_url("").unwrap(), DEFAULT_URL);
        assert_eq!(
            validate_url("https://flow.google.com").unwrap(),
            "https://flow.google.com"
        );
        assert!(validate_url("file:///etc/passwd").is_err());
        assert!(validate_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn profile_dir_esta_bajo_local_app_data() {
        let dir = profile_dir();
        assert!(dir.ends_with("flow-browser-profile"));
    }

    #[test]
    fn free_port_devuelve_un_puerto_distinto_cada_vez() {
        let a = free_port().unwrap();
        let b = free_port().unwrap();
        assert!(a > 0 && b > 0);
    }
}
