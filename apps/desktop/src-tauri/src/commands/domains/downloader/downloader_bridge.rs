//! Local bridge for the Editor IA browser extension.
//!
//! It listens only on 127.0.0.1 and requires a random per-install token. The
//! browser extension calls it to analyze a page and to start a download that
//! lands in Downloads/Videos descargados/<Platform>. No arbitrary paths, no
//! shell, and the same yt-dlp/FFmpeg pipeline as the in-app downloader.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::downloader::{
    download_blocking, folder_from_file_name, platform_folder, probe_with_engine, resolve_engine,
    validate_url, DownloadProbe, DownloadRequest,
};
use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_BODY_BYTES: usize = 1_500_000;

pub struct BridgeRuntime {
    pub port: u16,
    pub token: String,
    pub downloads_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
    pub downloads_dir: String,
    pub running: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeFile {
    name: String,
    bytes: u64,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeJob {
    id: String,
    status: String,
    stage: String,
    percent: Option<f64>,
    message: String,
    files: Vec<BridgeFile>,
    error: Option<String>,
}

struct HttpRequest {
    method: String,
    path: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeProbeRequest {
    url: String,
    direct_image: Option<bool>,
}

fn direct_image_probe(url: &str) -> DownloadProbe {
    let title = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("Imagen");
    DownloadProbe {
        url: url.to_owned(),
        title: title.chars().take(200).collect(),
        uploader: None,
        duration_seconds: None,
        thumbnail: Some(url.to_owned()),
        kind: "image".to_owned(),
        entry_count: 1,
        max_height: None,
        estimated_bytes: None,
        qualities: Vec::new(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeDownloadRequest {
    #[serde(flatten)]
    download: DownloadRequest,
    direct_image: Option<bool>,
}

fn provider_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

fn token_matches(candidate: &str, expected: &str) -> bool {
    if candidate.len() != expected.len() {
        return false;
    }
    candidate
        .bytes()
        .zip(expected.bytes())
        .fold(0u8, |accumulator, (left, right)| {
            accumulator | (left ^ right)
        })
        == 0
}

fn bridge_token(config_dir: &Path) -> String {
    let path = config_dir.join("downloader-bridge.token");
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let token = existing.trim().to_owned();
        if token.len() >= 32 && token.chars().all(|value| value.is_ascii_hexdigit()) {
            return token;
        }
    }
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let _ = std::fs::write(&path, &token);
    token
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
    let token = bridge_token(&config_dir);
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
mod tests {
    use super::*;

    #[test]
    fn tokens_are_compared_without_early_exit() {
        assert!(token_matches("abc123", "abc123"));
        assert!(!token_matches("abc124", "abc123"));
        assert!(!token_matches("abc", "abc123"));
    }

    #[test]
    fn destinations_do_not_overwrite_existing_files() {
        let directory = std::env::temp_dir().join(format!("editor-ia-bridge-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("video.mp4"), b"old").unwrap();
        let destination = unique_destination(&directory, "video.mp4");
        assert_eq!(
            destination.file_name().unwrap().to_string_lossy(),
            "video (2).mp4"
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn unsafe_file_names_are_sanitized() {
        let directory = std::env::temp_dir().join(format!("editor-ia-bridge-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let destination = unique_destination(&directory, "a:b?c*d.mp4");
        assert_eq!(
            destination.file_name().unwrap().to_string_lossy(),
            "a_b_c_d.mp4"
        );
        let _ = std::fs::remove_dir_all(&directory);
    }
}
