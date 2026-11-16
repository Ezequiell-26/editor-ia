//! Health-check del endpoint CDP (Chrome DevTools Protocol) en 127.0.0.1.
//! Usado por el navegador dedicado de Flow y por las sesiones web embebidas
//! para verificar que el puerto responde de verdad antes de manejar la página.

use std::time::{Duration, Instant};

/// URL del endpoint HTTP de versión de CDP.
pub fn cdp_version_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/json/version")
}

/// Pregunta al endpoint HTTP de CDP si el navegador responde de verdad.
/// `timeout` acota cada intento individual.
pub fn cdp_alive(port: u16, timeout: Duration) -> bool {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .ok()
        .and_then(|client| client.get(cdp_version_url(port)).send().ok())
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

/// Reintenta `cdp_alive` cada `poll` hasta `deadline` total.
pub fn wait_cdp(port: u16, timeout: Duration, deadline: Duration, poll: Duration) -> bool {
    let end = Instant::now() + deadline;
    while Instant::now() < end {
        if cdp_alive(port, timeout) {
            return true;
        }
        std::thread::sleep(poll);
    }
    false
}
