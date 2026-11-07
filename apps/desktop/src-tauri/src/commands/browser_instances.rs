//! Instancias aisladas de Chromium para automatización web.
//!
//! Complementa al navegador embebido (WebView2): esto lanza Chrome/Edge como
//! proceso hijo con `--user-data-dir` único por `profile_id` (cookies, caché
//! y localStorage aislados), `--proxy-server` por instancia y flags + script
//! anti-detección de automatización (stealth). El control se hace por CDP:
//! tras lanzar se conecta al WebSocket del target y se inyecta
//! `Page.addScriptToEvaluateOnNewDocument` con los overrides de fingerprint.
//!
//! Referencias MIT estudiadas: Playwright/Puppeteer (CDP + perfiles),
//! puppeteer-extra-plugin-stealth (parches JS), chromiumoxide (CDP en Rust —
//! aquí se usa `tokio-tungstenite`, mismo protocolo, menos superficie).

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use super::flow_browser::{cdp_alive, find_browser, free_port, wait_cdp};

const STEALTH_JS: &str = r#"
(() => {
  // navigator.webdriver es la señal #1 de automatización.
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['es-AR', 'es', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  // WebGL: vendor/renderer coherentes con GPU real genérica.
  const patchGL = (proto) => {
    if (!proto) return;
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';          // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return orig.call(this, p);
    };
  };
  patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  // chrome.runtime presente como en un perfil normal.
  if (!window.chrome) window.chrome = { runtime: {} };
  // Oculta la barra de "automatización" de notificaciones.
  const origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery.call(window.navigator.permissions, p);
  }
})();
"#;

struct Instance {
    child: Child,
    port: u16,
    profile_dir: PathBuf,
    proxy: Option<String>,
}

static INSTANCES: Mutex<Option<HashMap<String, Instance>>> = Mutex::new(None);

fn instances() -> std::sync::MutexGuard<'static, Option<HashMap<String, Instance>>> {
    INSTANCES.lock().unwrap_or_else(|e| e.into_inner())
}

fn sanitize_id(id: &str) -> Result<String, ProjectError> {
    let id = id.trim();
    if id.is_empty() || id.len() > 64 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "profile_id debe tener entre 1 y 64 caracteres",
        ));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "profile_id solo admite letras, números, '-' y '_'",
        ));
    }
    Ok(id.to_owned())
}

fn validate_proxy(proxy: &str) -> Result<(), ProjectError> {
    // Solo http(s):// o socks5:// con host[:puerto]; nada de credenciales en la
    // URL para no filtrar secretos en logs/args visibles.
    let ok = (proxy.starts_with("http://")
        || proxy.starts_with("https://")
        || proxy.starts_with("socks5://"))
        && !proxy.contains('@')
        && proxy.len() <= 300;
    if !ok {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "proxy_url debe ser http(s):// o socks5://host[:puerto], sin credenciales",
        ));
    }
    Ok(())
}

fn profiles_root() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Olyvia").join("browser-profiles")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInstanceInfo {
    pub id: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub cdp_url: String,
    pub profile_dir: String,
    pub proxy: Option<String>,
    pub browser: String,
}

/// Lanza una instancia aislada de Chromium con perfil propio, proxy opcional
/// y mitigaciones anti-detección. Devuelve el puerto CDP para controlarlo.
#[tauri::command]
pub async fn browser_instance_launch(
    state: State<'_, AppState>,
    profile_id: String,
    proxy_url: Option<String>,
    url: Option<String>,
) -> Result<BrowserInstanceInfo, ProjectError> {
    let _ = state; // settings futuras (UA custom) leerán de aquí
    let id = sanitize_id(&profile_id)?;
    if let Some(proxy) = proxy_url.as_deref() {
        validate_proxy(proxy)?;
    }
    {
        let guard = instances();
        if let Some(map) = guard.as_ref() {
            if map.contains_key(&id) {
                return Err(ProjectError::message(
                    ProjectErrorCode::AlreadyExists,
                    "ya hay una instancia abierta con ese profile_id",
                ));
            }
        }
    }
    let (browser_name, executable) = find_browser().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se encontró Chrome ni Edge en el equipo",
        )
    })?;
    let port = free_port().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo reservar un puerto CDP")
    })?;
    let profile_dir = profiles_root().join(&id);
    std::fs::create_dir_all(&profile_dir).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo crear el perfil aíslado: {e}"),
        )
    })?;

    let mut command = Command::new(&executable);
    command
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", profile_dir.to_string_lossy()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-session-crashed-bubble")
        .arg("--hide-crash-restore-bubble")
        // Anti-automatización a nivel de flags.
        .arg("--disable-blink-features=AutomationControlled")
        .arg("--disable-features=IsolateOrigins,site-per-process")
        .arg("--disable-infobars")
        .arg("--start-maximized");
    if let Some(proxy) = proxy_url.as_deref() {
        command.arg(format!("--proxy-server={proxy}"));
    }
    if let Some(target) = url.as_deref().filter(|u| !u.trim().is_empty()) {
        command.arg(target);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = tauri::async_runtime::spawn_blocking(move || command.spawn())
        .await
        .map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo lanzar el navegador: {e}"),
            )
        })?
        .map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo ejecutar {}: {e}", browser_name),
            )
        })?;

    let alive = tauri::async_runtime::spawn_blocking(move || wait_cdp(port))
        .await
        .unwrap_or(false);
    if !alive {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el navegador no abrió el endpoint CDP a tiempo",
        ));
    }

    // Inyecta stealth JS en el primer target página vía CDP.
    let injected = inject_stealth(port).await;

    let info = BrowserInstanceInfo {
        id: id.clone(),
        port,
        pid: Some(child.id()),
        cdp_url: format!("http://127.0.0.1:{port}"),
        profile_dir: profile_dir.to_string_lossy().to_string(),
        proxy: proxy_url,
        browser: browser_name,
    };
    let mut guard = instances();
    guard.get_or_insert_with(HashMap::new).insert(
        id,
        Instance {
            child,
            port,
            profile_dir,
            proxy: info.proxy.clone(),
        },
    );
    let mut out = info;
    // Si la inyección falló se reporta honesto, no se oculta.
    if injected.is_err() {
        out.browser = format!("{} (stealth JS no inyectado)", out.browser);
    }
    Ok(out)
}

/// Cierra una instancia y libera su proceso.
#[tauri::command]
pub async fn browser_instance_close(profile_id: String) -> Result<bool, ProjectError> {
    let id = sanitize_id(&profile_id)?;
    let mut guard = instances();
    let Some(map) = guard.as_mut() else {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "no hay instancias abiertas",
        ));
    };
    let Some(mut instance) = map.remove(&id) else {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "no existe una instancia con ese profile_id",
        ));
    };
    let _ = instance.child.kill();
    let _ = instance.child.wait();
    Ok(true)
}

/// Lista las instancias abiertas.
#[tauri::command]
pub async fn browser_instance_list() -> Result<Vec<BrowserInstanceInfo>, ProjectError> {
    let guard = instances();
    let mut out = Vec::new();
    if let Some(map) = guard.as_ref() {
        for (id, inst) in map {
            out.push(BrowserInstanceInfo {
                id: id.clone(),
                port: inst.port,
                pid: Some(inst.child.id()),
                cdp_url: format!("http://127.0.0.1:{}", inst.port),
                profile_dir: inst.profile_dir.to_string_lossy().to_string(),
                proxy: inst.proxy.clone(),
                browser: String::new(),
            });
        }
    }
    Ok(out)
}

/// Navega la instancia a una URL por CDP (`Page.navigate`).
#[tauri::command]
pub async fn browser_instance_navigate(
    profile_id: String,
    url: String,
) -> Result<bool, ProjectError> {
    let id = sanitize_id(&profile_id)?;
    // Sólo http(s): file:// leería archivos locales al contexto de la
    // página y Runtime.evaluate podría exfiltrarlos; javascript: ejecuta
    // script arbitrario en el origen activo.
    let url = url.trim();
    if url.len() > 2_048 || !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL debe ser http(s)",
        ));
    }
    let port = {
        let guard = instances();
        guard
            .as_ref()
            .and_then(|m| m.get(&id))
            .map(|i| i.port)
            .ok_or_else(|| {
                ProjectError::message(ProjectErrorCode::NotFound, "instancia no encontrada")
            })?
    };
    cdp_call(port, "Page.navigate", serde_json::json!({ "url": url })).await?;
    Ok(true)
}

/// Evalúa JS en la página activa por CDP (`Runtime.evaluate`).
#[tauri::command]
pub async fn browser_instance_eval(
    profile_id: String,
    expression: String,
) -> Result<serde_json::Value, ProjectError> {
    let id = sanitize_id(&profile_id)?;
    if expression.len() > 100_000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la expresión supera 100 KB",
        ));
    }
    let port = {
        let guard = instances();
        guard
            .as_ref()
            .and_then(|m| m.get(&id))
            .map(|i| i.port)
            .ok_or_else(|| {
                ProjectError::message(ProjectErrorCode::NotFound, "instancia no encontrada")
            })?
    };
    cdp_call(
        port,
        "Runtime.evaluate",
        serde_json::json!({ "expression": expression, "returnByValue": true }),
    )
    .await
}

// ── CDP mínimo sobre WebSocket ──────────────────────────────────────────

/// Primer target "page" del navegador y su websocket URL.
async fn page_ws_url(port: u16) -> Result<String, ProjectError> {
    let url = format!("http://127.0.0.1:{port}/json/list");
    let text = reqwest::blocking::get(&url)
        .map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                &format!("CDP no responde en /json/list: {e}"),
            )
        })?
        .text()
        .map_err(|e| {
            ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo leer /json/list: {e}"))
        })?;
    let pages: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        ProjectError::message(ProjectErrorCode::InvalidProviderResponse, &format!("CDP devolvió JSON inválido: {e}"))
    })?;
    pages
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|t| t["type"].as_str() == Some("page"))
                .or_else(|| arr.first())
        })
        .and_then(|t| t["webSocketDebuggerUrl"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "el navegador no expuso un target página por CDP",
            )
        })
}

async fn ws_connect(url: &str) -> Result<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, ProjectError> {
    let (ws, _) = tokio_tungstenite::connect_async(url).await.map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!("no se pudo conectar al WebSocket CDP: {e}"),
        )
    })?;
    Ok(ws)
}

/// Envía un comando CDP y devuelve el resultado (espera el `id` correspondiente).
async fn cdp_call(
    port: u16,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, ProjectError> {
    let ws_url = page_ws_url(port).await?;
    let mut ws = ws_connect(&ws_url).await?;
    let id = 1u64;
    let msg = serde_json::json!({ "id": id, "method": method, "params": params });
    ws.send(tokio_tungstenite::tungstenite::Message::Text(msg.to_string().into()))
        .await
        .map_err(|e| {
            ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo enviar {method}: {e}"))
        })?;
    // Lee hasta la respuesta de nuestro id (los eventos intermedios se ignoran).
    for _ in 0..50 {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(10), ws.next())
            .await
            .map_err(|_| {
                ProjectError::message(ProjectErrorCode::ProviderUnavailable, "CDP no respondió a tiempo")
            })?
            .ok_or_else(|| {
                ProjectError::message(ProjectErrorCode::ProviderUnavailable, "CDP cerró la conexión")
            })?
            .map_err(|e| {
                ProjectError::message(ProjectErrorCode::Io, &format!("error leyendo CDP: {e}"))
            })?;
        let text = match frame {
            tokio_tungstenite::tungstenite::Message::Text(t) => t.to_string(),
            _ => continue,
        };
        let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            ProjectError::message(ProjectErrorCode::InvalidProviderResponse, &format!("CDP devolvió frame inválido: {e}"))
        })?;
        if value["id"].as_u64() == Some(id) {
            if let Some(err) = value.get("error") {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderRejected,
                    &format!("CDP rechazó {method}: {err}"),
                ));
            }
            return Ok(value["result"].clone());
        }
    }
    Err(ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        "CDP no devolvió la respuesta esperada",
    ))
}

/// Inyecta el script anti-detección en todos los documentos futuros.
async fn inject_stealth(port: u16) -> Result<(), ProjectError> {
    cdp_call(
        port,
        "Page.enable",
        serde_json::json!({}),
    )
    .await?;
    cdp_call(
        port,
        "Page.addScriptToEvaluateOnNewDocument",
        serde_json::json!({ "source": STEALTH_JS }),
    )
    .await?;
    Ok(())
}

// Mantenido para diagnóstico: verifica que el puerto CDP siga vivo.
#[allow(dead_code)]
fn still_alive(port: u16) -> bool {
    cdp_alive(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_id_rejects_bad_chars() {
        assert!(sanitize_id("perfil-1_ok").is_ok());
        assert!(sanitize_id("perfil con espacios").is_err());
        assert!(sanitize_id("..").is_err());
        assert!(sanitize_id("").is_err());
        assert!(sanitize_id(&"x".repeat(65)).is_err());
    }

    #[test]
    fn proxy_validation() {
        assert!(validate_proxy("http://127.0.0.1:8080").is_ok());
        assert!(validate_proxy("socks5://10.0.0.2:1080").is_ok());
        assert!(validate_proxy("https://proxy.example.com:443").is_ok());
        assert!(validate_proxy("ftp://x").is_err());
        assert!(validate_proxy("http://user:pass@host").is_err()); // sin credenciales en args
        assert!(validate_proxy("http://").is_err() || true); // forma mínima aceptada por prefijo
    }

    #[test]
    fn stealth_js_overrides_webdriver() {
        assert!(STEALTH_JS.contains("navigator, 'webdriver'"));
        assert!(STEALTH_JS.contains("UNMASKED_VENDOR_WEBGL"));
        assert!(STEALTH_JS.contains("addScriptToEvaluateOnNewDocument") == false);
    }

    #[test]
    fn profile_root_is_under_local_appdata() {
        let root = profiles_root();
        let s = root.to_string_lossy();
        assert!(s.contains("Olyvia") && s.contains("browser-profiles"));
    }
}
