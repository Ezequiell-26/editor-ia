//! Local bridge for the Editor IA browser extension.
//!
//! It listens only on 127.0.0.1 and requires a random per-install token. The
//! browser extension calls it to analyze a page and to start a download that
//! lands in Downloads/Videos descargados/<Platform>. No arbitrary paths, no
//! shell, and the same yt-dlp/FFmpeg pipeline as the in-app downloader.
//!
//! DTOs del protocolo y helpers puros (token, naming, probe de imagen, parse
//! del head HTTP) viven en `application::downloader_bridge`; acá queda el
//! servidor TCP y los comandos.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::downloader::{
    download_blocking, folder_from_file_name, platform_folder, probe_with_engine, resolve_engine,
    validate_url, DownloadRequest,
};
use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

// DTOs, constantes y helpers puros del protocolo: `application::downloader_bridge`.
pub use crate::application::downloader_bridge::*;

pub struct BridgeRuntime {
    pub port: u16,
    pub token: String,
    pub downloads_dir: PathBuf,
}

fn provider_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

const BRIDGE_KEYRING_SERVICE: &str = "editor-ia.downloader-bridge";
const BRIDGE_KEYRING_USER: &str = "token";

fn bridge_key_entry() -> Result<keyring::Entry, ProjectError> {
    keyring::Entry::new(BRIDGE_KEYRING_SERVICE, BRIDGE_KEYRING_USER).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de claves de Windows no está disponible",
        )
    })
}

/// AUD-100: el token del puente vive en el Credential Manager — antes se
/// persistía en `downloader-bridge.token` en texto plano y el error de
/// escritura se descartaba (`let _ =`), así que un fallo de disco anunciaba
/// un emparejamiento que no sobrevivía al reinicio y la extensión quedaba
/// con un token viejo. Ahora cualquier fallo del llavero es error y el
/// puente no arranca (la UI lo reporta como no disponible).
///
/// Migración: si el llavero está vacío pero existe el archivo legado con
/// un token válido, se adopta ese token (la extensión guardada en
/// chrome.storage sigue funcionando) y el archivo en claro se borra.
fn stored_bridge_token(config_dir: &Path) -> Result<String, ProjectError> {
    let entry = bridge_key_entry()?;
    match entry.get_password() {
        Ok(token) if token.len() >= 32 => return Ok(token),
        Ok(_) => {}
        Err(keyring::Error::NoEntry) => {}
        Err(_) => {
            return Err(ProjectError::message(
                ProjectErrorCode::KeyringUnavailable,
                "no se pudo leer el token del puente del almacén de Windows",
            ));
        }
    }
    let legacy_path = config_dir.join("downloader-bridge.token");
    if let Ok(text) = std::fs::read_to_string(&legacy_path) {
        if let Some(token) = parse_legacy_bridge_token(&text) {
            entry.set_password(&token).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::KeyringUnavailable,
                    "no se pudo migrar el token del puente al almacén de Windows",
                )
            })?;
            let _ = std::fs::remove_file(&legacy_path);
            return Ok(token);
        }
    }
    let token = generate_bridge_token();
    entry.set_password(&token).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "no se pudo guardar el token del puente en el almacén de Windows",
        )
    })?;
    Ok(token)
}

fn bind_listener() -> Option<TcpListener> {
    for port in 47_615..=47_625 {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Some(listener);
        }
    }
    None
}

/// Starts the bridge once per app run. A failure to bind is non-fatal: the rest
/// of the editor keeps working and the UI reports the bridge as unavailable.
pub fn start(app: AppHandle) -> Option<BridgeRuntime> {
    let config_dir = app.state::<AppState>().config_dir.clone();
    let cache_dir = app.state::<AppState>().cache_dir.clone();
    let downloads_dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| config_dir.join("Downloads"))
        .join("Videos descargados");
    // AUD-100: sin token persistible no hay emparejamiento estable — el
    // puente no arranca y `downloader_bridge_info` lo reporta honesto.
    let token = stored_bridge_token(&config_dir).ok()?;
    let listener = bind_listener()?;
    let port = listener.local_addr().ok()?.port();
    let job = Arc::new(Mutex::new(None));
    let server_app = app.clone();
    let server_token = token.clone();
    let server_job = job.clone();
    let server_downloads = downloads_dir.clone();
    let server_cache = cache_dir.clone();
    thread::Builder::new()
        .name("editor-ia-downloader-bridge".to_owned())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else {
                    continue;
                };
                let app = server_app.clone();
                let token = server_token.clone();
                let job = server_job.clone();
                let downloads = server_downloads.clone();
                let cache = server_cache.clone();
                let _ = thread::Builder::new()
                    .name("editor-ia-bridge-request".to_owned())
                    .spawn(move || {
                        handle_connection(stream, &app, &token, &job, &downloads, &cache);
                    });
            }
        })
        .ok()?;
    Some(BridgeRuntime {
        port,
        token,
        downloads_dir,
    })
}

#[tauri::command]
pub async fn downloader_bridge_info(
    state: State<'_, AppState>,
) -> Result<BridgeInfo, ProjectError> {
    let guard = state
        .downloader_bridge
        .lock()
        .map_err(|_| provider_error("El puente local no está disponible."))?;
    let Some(runtime) = guard.as_ref() else {
        return Err(provider_error(
            "El puente para la extensión no pudo iniciarse; puede que el puerto local esté ocupado.",
        ));
    };
    Ok(BridgeInfo {
        port: runtime.port,
        token: runtime.token.clone(),
        downloads_dir: runtime.downloads_dir.to_string_lossy().into_owned(),
        running: true,
    })
}

include!("downloader_bridge/http.rs");
include!("downloader_bridge/routes.rs");
include!("downloader_bridge/jobs.rs");

#[cfg(test)]
#[path = "downloader_bridge.tests.rs"]
mod tests;
