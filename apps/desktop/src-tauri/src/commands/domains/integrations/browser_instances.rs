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
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::State;

use crate::application::browser_instances::{
    sanitize_profile_id, validate_proxy, validate_web_url, BrowserInstanceInfo,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use super::flow_browser::{find_browser, free_port};
use crate::application::cdp;

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

/// Quita del mapa las instancias cuyo proceso ya terminó (cerradas a mano o
/// caídas). Devuelve los ids eliminados. AUD-026.
fn reap_dead_instances(map: &mut HashMap<String, Instance>) -> Vec<String> {
    let mut dead = Vec::new();
    map.retain(|id, inst| match inst.child.try_wait() {
        Ok(Some(_)) => {
            dead.push(id.clone());
            false
        }
        _ => true,
    });
    dead
}

fn profiles_root() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Olyvia").join("browser-profiles")
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
    let id = sanitize_profile_id(&profile_id)?;
    if let Some(proxy) = proxy_url.as_deref() {
        validate_proxy(proxy)?;
    }
    // AUD-019: la URL inicial pasa la misma validación http(s) que navigate;
    // file:// leería archivos locales y Runtime.evaluate podría exfiltrarlos.
    let initial_url = url
        .as_deref()
        .filter(|u| !u.trim().is_empty())
        .map(validate_web_url)
        .transpose()?;
    {
        let mut guard = instances();
        if let Some(map) = guard.as_mut() {
            // AUD-026: liberar entradas cuyo proceso ya murió antes de
            // bloquear el profile_id.
            reap_dead_instances(map);
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
        // AUD-021: CDP no tiene autenticación; al menos se fija el bind a
        // loopback explícito para que ningún adaptador de red lo exponga.
        // El puerto ya es efímero (free_port) y el proceso muere con la app.
        .arg(format!("--remote-debugging-port={port}"))
        .arg("--remote-debugging-address=127.0.0.1")
        .arg(format!("--user-data-dir={}", profile_dir.to_string_lossy()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-session-crashed-bubble")
        .arg("--hide-crash-restore-bubble")
        // Anti-automatización a nivel de flags. Site Isolation se mantiene
        // activo (AUD-020): desactivarlo ampliaba el alcance de un compromiso
        // de página sobre otros orígenes del mismo perfil.
        .arg("--disable-blink-features=AutomationControlled")
        .arg("--disable-infobars")
        .arg("--start-maximized");
    if let Some(proxy) = proxy_url.as_deref() {
        command.arg(format!("--proxy-server={proxy}"));
    }
    if let Some(target) = initial_url.as_deref() {
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

    let alive = tauri::async_runtime::spawn_blocking(move || {
        cdp::wait_cdp(
            port,
            std::time::Duration::from_secs(3),
            std::time::Duration::from_secs(15),
            std::time::Duration::from_millis(400),
        )
    })
    .await
    .unwrap_or(false);
    if !alive {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _ = child.kill();
            let _ = child.wait();
        })
        .await;
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
    let id = sanitize_profile_id(&profile_id)?;
    let instance = {
        let mut guard = instances();
        let Some(map) = guard.as_mut() else {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "no hay instancias abiertas",
            ));
        };
        let Some(instance) = map.remove(&id) else {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "no existe una instancia con ese profile_id",
            ));
        };
        instance
    };
    let mut child = instance.child;
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let _ = child.kill();
        let _ = child.wait();
    })
    .await;
    Ok(true)
}

/// Lista las instancias abiertas (las que ya murieron se podan antes).
#[tauri::command]
pub async fn browser_instance_list() -> Result<Vec<BrowserInstanceInfo>, ProjectError> {
    let mut guard = instances();
    if let Some(map) = guard.as_mut() {
        reap_dead_instances(map);
    }
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
    let id = sanitize_profile_id(&profile_id)?;
    let url = validate_web_url(&url)?;
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
    let id = sanitize_profile_id(&profile_id)?;
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
    // Chrome publica /json/version antes que /json/list durante el arranque
    // en frío; sin reintento las primeras llamadas eval/navigate fallaban.
    // El sondeo bloqueante va en spawn_blocking para no frenar el runtime.
    let fetched = tokio::task::spawn_blocking(move || {
        let mut last_err = String::new();
        for _ in 0..10 {
            match reqwest::blocking::get(&url) {
                Ok(resp) => match resp.text() {
                    Ok(text) => return Ok(text),
                    Err(e) => last_err = format!("no se pudo leer /json/list: {e}"),
                },
                Err(e) => last_err = format!("CDP no responde en /json/list: {e}"),
            }
            std::thread::sleep(std::time::Duration::from_millis(700));
        }
        Err(last_err)
    })
    .await
    .map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo consultar el CDP del navegador: {e}"),
        )
    })?;
    let text =
        fetched.map_err(|e| ProjectError::message(ProjectErrorCode::ProviderUnavailable, &e))?;
    let pages: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            &format!("CDP devolvió JSON inválido: {e}"),
        )
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

async fn ws_connect(
    url: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    ProjectError,
> {
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
    ws.send(tokio_tungstenite::tungstenite::Message::Text(
        msg.to_string().into(),
    ))
    .await
    .map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo enviar {method}: {e}"),
        )
    })?;
    // Lee hasta la respuesta de nuestro id (los eventos intermedios se ignoran).
    for _ in 0..50 {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(10), ws.next())
            .await
            .map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "CDP no respondió a tiempo",
                )
            })?
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "CDP cerró la conexión",
                )
            })?
            .map_err(|e| {
                ProjectError::message(ProjectErrorCode::Io, &format!("error leyendo CDP: {e}"))
            })?;
        let text = match frame {
            tokio_tungstenite::tungstenite::Message::Text(t) => t.to_string(),
            _ => continue,
        };
        let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                &format!("CDP devolvió frame inválido: {e}"),
            )
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
    cdp_call(port, "Page.enable", serde_json::json!({})).await?;
    cdp_call(
        port,
        "Page.addScriptToEvaluateOnNewDocument",
        serde_json::json!({ "source": STEALTH_JS }),
    )
    .await?;
    Ok(())
}

/// Mata todas las instancias abiertas. Lo invoca el hook de salida de la app
/// (AUD-024): sin esto, Chrome/Edge quedaba huérfano con el perfil
/// autenticado y el puerto CDP activo después de cerrar Olyvia.
pub fn stop_all_browser_instances() {
    let mut guard = instances();
    if let Some(map) = guard.as_mut() {
        for (_, mut inst) in map.drain() {
            let _ = inst.child.kill();
            let _ = inst.child.wait();
        }
    }
}

// Mantenido para diagnóstico: verifica que el puerto CDP siga vivo.
#[allow(dead_code)]
fn still_alive(port: u16) -> bool {
    cdp::cdp_alive(port, std::time::Duration::from_secs(3))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stealth_js_overrides_webdriver() {
        assert!(STEALTH_JS.contains("navigator, 'webdriver'"));
        assert!(STEALTH_JS.contains("UNMASKED_VENDOR_WEBGL"));
        assert!(!STEALTH_JS.contains("addScriptToEvaluateOnNewDocument"));
    }

    #[test]
    fn profile_root_is_under_local_appdata() {
        let root = profiles_root();
        let s = root.to_string_lossy();
        assert!(s.contains("Olyvia") && s.contains("browser-profiles"));
    }
}
