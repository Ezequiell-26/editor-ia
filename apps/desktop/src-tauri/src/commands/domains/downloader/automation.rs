//! Automatizaciones ligeras del descargador: carpeta vigilada, feeds RSS y
//! comprobación de proxies. No descargan nada por sí mismas; sólo entregan
//! entradas validadas a la cola de la UI.
//!
//! DTOs, parsers (URLs, checksum, RSS/Atom) y el traversal de la carpeta
//! vigilada viven en `application::download_automation`; acá queda la frontera
//! de red/comandos.

use std::io::Read;
use std::time::{Duration, Instant};

use crate::commands::downloader::{ssrf_redirect_policy, validate_url_network};
use crate::projects::service::{ProjectError, ProjectErrorCode};

// DTOs, constantes y parsers puros: `application::download_automation`.
pub use crate::application::download_automation::*;

fn automation_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::InvalidProject, &message)
}

fn provider_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

#[tauri::command]
pub async fn probe_source_checksum(url: String) -> Result<SourceChecksum, ProjectError> {
    // reqwest::blocking + DNS síncrono no pueden correr en el main thread:
    // un HEAD de hasta 10 s congelaría la UI (AUD-129).
    tauri::async_runtime::spawn_blocking(move || {
        let url = validate_url_network(&url)?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("Olyvia/0.1 (checksum probe)")
            .redirect(ssrf_redirect_policy())
            .build()
            .map_err(|_| provider_error("No se pudo iniciar la consulta de checksum."))?;
        let response = client
            .head(&url)
            .send()
            .map_err(|_| provider_error("No se pudo consultar la fuente para el checksum."))?;
        if !response.status().is_success() && !response.status().is_redirection() {
            return Err(provider_error(format!(
                "La fuente respondió {} al pedir el checksum.",
                response.status().as_u16()
            )));
        }
        Ok(checksum_from_headers(response.headers()))
    })
    .await
    .map_err(|_| provider_error("la consulta de checksum se interrumpió"))?
}

#[tauri::command]
pub async fn scan_watch_folder(path: String) -> Result<Vec<WatchFile>, ProjectError> {
    // El traversal lee el directorio y todos sus .txt: puede ser una
    // carpeta de red o con miles de archivos — fuera del main thread.
    tauri::async_runtime::spawn_blocking(move || {
        crate::application::download_automation::scan_watch_folder(path)
    })
    .await
    .map_err(|_| provider_error("el escaneo de la carpeta vigilada se interrumpió"))?
}

#[tauri::command]
pub async fn fetch_rss_feed(url: String, limit: Option<u32>) -> Result<Vec<RssItem>, ProjectError> {
    let limit = limit.unwrap_or(30) as usize;
    // Idem probe_source_checksum: fetch + DNS bloqueantes fuera del main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let url = validate_url_network(&url)?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(12))
            .redirect(ssrf_redirect_policy())
            .build()
            .map_err(|_| provider_error("No se pudo iniciar la consulta del feed."))?;
        let response = client
            .get(&url)
            .header("User-Agent", "Olyvia/0.1 (feed local)")
            .send()
            .map_err(|_| {
                provider_error("No se pudo leer el feed RSS. Revisá la URL o la conexión.")
            })?;
        if !response.status().is_success() {
            return Err(provider_error(format!(
                "El feed respondió {}.",
                response.status().as_u16()
            )));
        }
        let mut body = String::new();
        response
            .take(MAX_RSS_BYTES)
            .read_to_string(&mut body)
            .map_err(|_| provider_error("El feed devolvió un cuerpo ilegible."))?;
        let items = parse_feed(&body, limit);
        if items.is_empty() {
            return Err(automation_error(
                "El feed no tiene entradas RSS/Atom reconocibles.",
            ));
        }
        Ok(items)
    })
    .await
    .map_err(|_| provider_error("la consulta del feed se interrumpió"))?
}

#[tauri::command]
pub async fn test_proxy(proxy: String) -> Result<ProxyHealth, ProjectError> {
    let proxy = proxy.trim().to_owned();
    if !(proxy.starts_with("http://")
        || proxy.starts_with("https://")
        || proxy.starts_with("socks4://")
        || proxy.starts_with("socks5://"))
    {
        return Err(automation_error(
            "El proxy debe empezar con http://, https://, socks4:// o socks5://.",
        ));
    }
    // Parseo de URL, no bloqueante: se hace fuera del closure.
    let proxy_config = reqwest::Proxy::all(&proxy)
        .map_err(|_| automation_error("La URL del proxy no es válida."))?;
    let started = Instant::now();
    // La prueba pasa por red (hasta 10 s): fuera del main thread (AUD-129).
    let result = tauri::async_runtime::spawn_blocking(move || {
        reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .proxy(proxy_config)
            .build()
            .and_then(|client| {
                client
                    .get("https://www.youtube.com/generate_204")
                    .header("User-Agent", "Olyvia/0.1 (proxy check)")
                    .send()
            })
    })
    .await
    .map_err(|_| provider_error("la prueba del proxy se interrumpió"))?;
    match result {
        Ok(response) if response.status().is_success() || response.status().is_redirection() => {
            Ok(ProxyHealth {
                proxy,
                ok: true,
                latency_ms: Some(started.elapsed().as_millis() as u64),
                error: None,
            })
        }
        Ok(response) => Ok(ProxyHealth {
            proxy,
            ok: false,
            latency_ms: None,
            error: Some(format!("HTTP {}.", response.status().as_u16())),
        }),
        Err(error) => Ok(ProxyHealth {
            proxy,
            ok: false,
            latency_ms: None,
            error: Some(if error.is_timeout() {
                "Tiempo de espera agotado.".to_owned()
            } else {
                "Sin conexión a través del proxy.".to_owned()
            }),
        }),
    }
}

#[cfg(test)]
#[path = "automation.tests.rs"]
mod tests;
