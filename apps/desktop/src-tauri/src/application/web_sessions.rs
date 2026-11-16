//! Sesiones web embebidas — dominio puro: slots, puertos CDP, URLs y DTOs.
//!
//! Las ventanas WebView2 se construyen en commands (hilo de UI); este módulo
//! tiene la lógica determinista: nombre de slot válido, hash FNV-1a → puerto
//! CDP estable por slot (AUD-022: colisiones se resuelven con un puerto libre
//! real inyectado), URL http(s), directorio de datos por sesión y el registro
//! `nombre → puerto` que vive mientras la ventana existe.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const DEFAULT_SLOT: &str = "flow";
pub const DEFAULT_URL: &str = "https://flow.google.com";
pub const WINDOW_WIDTH: f64 = 1280.0;
pub const WINDOW_HEIGHT: f64 = 800.0;
pub const MIN_WIDTH: f64 = 720.0;
pub const MIN_HEIGHT: f64 = 560.0;
pub const BASE_CDP_PORT: u16 = 19223;
pub const CDP_PORT_RANGE: u16 = 48;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSessionInfo {
    /// Nombre del slot ("flow", "canva", …).
    pub name: String,
    /// URL que está cargando/mostrando.
    pub url: Option<String>,
    /// Endpoint CDP de la ventana (sólo cuando está abierta).
    pub cdp_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSessionsStatus {
    /// Todas las sesiones web abiertas, ordenadas por nombre.
    pub sessions: Vec<WebSessionInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowEmbedStatus {
    /// La ventana de Flow existe (abierta o minimizada).
    pub open: bool,
    /// URL que está cargando/mostrando, si la ventana existe.
    pub url: Option<String>,
    /// Endpoint CDP de la ventana (sólo cuando está abierta).
    pub cdp_url: Option<String>,
}

/// Registro de slots abiertos: nombre → puerto CDP asignado. Mantiene el
/// puerto estable mientras la ventana exista y permite derivar uno por slot.
static SLOTS: Mutex<BTreeMap<String, u16>> = Mutex::new(BTreeMap::new());

pub fn sanitize_slot(slot: &str) -> Result<String, ProjectError> {
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

pub fn window_label(slot: &str) -> String {
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

/// Registra el slot y devuelve su puerto CDP. `free_port` se inyecta desde la
/// capa de comandos (bind :0 del SO) para resolver colisiones del hash sin
/// que application conozca sockets.
pub fn register_slot(slot: &str, free_port: &dyn Fn() -> Option<u16>) -> u16 {
    let mut guard = SLOTS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(port) = guard.get(slot) {
        return *port;
    }
    let mut port = slot_port(slot);
    // AUD-022: el hash % 47 puede dar el mismo puerto a dos slots distintos
    // (p.ej. «capcut» y «kling» → 19243). Si choca con otro slot registrado
    // se busca un puerto libre real; el mapa siempre refleja el puerto
    // efectivo que usa `slot_port_or_default`.
    if guard.values().any(|p| *p == port) {
        // Puerto libre del SO (bind :0) si está disponible; si no, avanza
        // dentro del rango CDP hasta encontrar un hueco no registrado.
        let mut candidate = free_port().filter(|p| !guard.values().any(|g| g == p));
        while candidate.is_none() {
            port = port.wrapping_add(1);
            if port <= BASE_CDP_PORT || port >= BASE_CDP_PORT + CDP_PORT_RANGE {
                port = BASE_CDP_PORT + 1;
            }
            if !guard.values().any(|p| *p == port) {
                candidate = Some(port);
            } else if port == slot_port(slot) {
                break; // rango agotado: se mantiene el hash original
            }
        }
        if let Some(free) = candidate {
            port = free;
        }
    }
    guard.insert(slot.to_owned(), port);
    port
}

pub fn unregister_slot(slot: &str) {
    let mut guard = SLOTS.lock().unwrap_or_else(|e| e.into_inner());
    guard.remove(slot);
}

/// Puerto CDP que le corresponde a un slot (registrado o derivado del nombre).
pub fn slot_port_for(slot: &str) -> u16 {
    SLOTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(slot)
        .copied()
        .unwrap_or_else(|| slot_port(slot))
}

pub fn validate_url(url: &str) -> Result<String, ProjectError> {
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

pub fn parse_url(url: &str) -> Result<reqwest::Url, ProjectError> {
    reqwest::Url::parse(url).map_err(|_| {
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
pub fn session_data_dir(slot: &str) -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(|base| {
            PathBuf::from(base)
                .join("com.editoria.desktop")
                .join("web-sessions")
                .join(slot)
        })
        .unwrap_or_else(|| PathBuf::from("web-sessions").join(slot))
}

#[cfg(test)]
#[path = "web_sessions.tests.rs"]
mod tests;
