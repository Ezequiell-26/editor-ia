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

fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|window| window == b"\r\n\r\n")
}

fn read_http(stream: &mut TcpStream) -> Option<HttpRequest> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let mut data: Vec<u8> = Vec::with_capacity(8_192);
    let mut buffer = [0u8; 8_192];
    loop {
        if let Some(header_end) = find_header_end(&data) {
            let head = String::from_utf8_lossy(&data[..header_end]).into_owned();
            let mut lines = head.split("\r\n");
            let mut request_parts = lines.next()?.split_whitespace();
            let method = request_parts.next()?.to_ascii_uppercase();
            let path = request_parts.next()?.split('?').next()?.to_owned();
            let mut headers = BTreeMap::new();
            for line in lines {
                if let Some((key, value)) = line.split_once(':') {
                    headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
                }
            }
            let content_length = headers
                .get("content-length")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            if content_length > MAX_BODY_BYTES {
                return None;
            }
            let body_start = header_end + 4;
            while data.len() < body_start + content_length {
                let read = stream.read(&mut buffer).ok()?;
                if read == 0 {
                    break;
                }
                data.extend_from_slice(&buffer[..read]);
            }
            let body = data
                .get(body_start..body_start.saturating_add(content_length))
                .unwrap_or(&[])
                .to_vec();
            return Some(HttpRequest {
                method,
                path,
                headers,
                body,
            });
        }
        if data.len() > 128 * 1024 {
            return None;
        }
        let read = stream.read(&mut buffer).ok()?;
        if read == 0 {
            return None;
        }
        data.extend_from_slice(&buffer[..read]);
    }
}

fn respond(mut stream: TcpStream, status: u16, body: String) {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        409 => "Conflict",
        _ => "Error",
    };
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: content-type, x-editoria-token\r\nAccess-Control-Max-Age: 600\r\nConnection: close\r\n\r\n",
        body.as_bytes().len()
    );
    let _ = stream.write_all(headers.as_bytes());
    if status != 204 {
        let _ = stream.write_all(body.as_bytes());
    }
    let _ = stream.flush();
}

fn error_body(message: impl Into<String>) -> String {
    json!({ "error": message.into() }).to_string()
}

fn handle_connection(
    mut stream: TcpStream,
    app: &AppHandle,
    token: &str,
    job_state: &Arc<Mutex<Option<BridgeJob>>>,
    downloads_dir: &Path,
    cache_dir: &Path,
) {
    let Some(request) = read_http(&mut stream) else {
        respond(stream, 400, error_body("Solicitud local inválida."));
        return;
    };
    if request.method == "OPTIONS" {
        respond(stream, 204, String::new());
        return;
    }
    if request.method == "GET" && request.path == "/v1/health" {
        respond(
            stream,
            200,
            json!({
                "ok": true,
                "app": "editor-ia",
                "version": env!("CARGO_PKG_VERSION")
            })
            .to_string(),
        );
        return;
    }
    let authorized = request
        .headers
        .get("x-editoria-token")
        .map(|candidate| token_matches(candidate, token))
        .unwrap_or(false);
    if !authorized {
        respond(
            stream,
            401,
            error_body("Pegá el token de Editor IA en la extensión."),
        );
        return;
    }
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/v1/ping") => {
            respond(stream, 200, json!({ "ok": true }).to_string());
        }
        ("POST", "/v1/probe") => probe_route(stream, app, &request.body),
        ("POST", "/v1/download") => download_route(
            stream,
            app,
            job_state,
            downloads_dir,
            cache_dir,
            &request.body,
        ),
        ("GET", path) if path.starts_with("/v1/jobs/") => {
            let id = path.trim_start_matches("/v1/jobs/");
            let guard = match job_state.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    respond(
                        stream,
                        500,
                        error_body("El estado de descarga no está disponible."),
                    );
                    return;
                }
            };
            match guard.as_ref() {
                Some(job) if job.id == id => {
                    respond(
                        stream,
                        200,
                        serde_json::to_string(job)
                            .unwrap_or_else(|_| error_body("No se pudo leer el estado.")),
                    );
                }
                _ => respond(stream, 404, error_body("Esa descarga no existe.")),
            }
        }
        _ => respond(stream, 404, error_body("Ruta no encontrada.")),
    }
}

fn probe_route(stream: TcpStream, app: &AppHandle, body: &[u8]) {
    let request: BridgeProbeRequest = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(_) => {
            respond(
                stream,
                400,
                error_body("El pedido de análisis no es válido."),
            );
            return;
        }
    };
    let url = match validate_url(&request.url) {
        Ok(url) => url,
        Err(error) => {
            respond(stream, 400, error_body(error.message));
            return;
        }
    };
    if request.direct_image.unwrap_or(false) {
        respond(
            stream,
            200,
            serde_json::to_string(&direct_image_probe(&url))
                .unwrap_or_else(|_| error_body("No se pudo serializar.")),
        );
        return;
    }
    let state = app.state::<AppState>();
    let engine = match resolve_engine(&state.config_dir) {
        Ok(engine) => engine,
        Err(error) => {
            respond(stream, 400, error_body(error.message));
            return;
        }
    };
    match probe_with_engine(&engine, &url, None, None) {
        Ok(probe) => respond(
            stream,
            200,
            serde_json::to_string(&probe).unwrap_or_else(|_| error_body("No se pudo serializar.")),
        ),
        Err(error) => respond(stream, 400, error_body(error.message)),
    }
}

fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let safe: String = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => character,
        })
        .collect();
    let safe = if safe.trim().is_empty() {
        "archivo".to_owned()
    } else {
        safe
    };
    let candidate = directory.join(&safe);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(&safe);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned());
    for index in 2..10_000 {
        let name = match extension.as_deref() {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{}.bin", Uuid::new_v4()))
}

fn set_job(job_state: &Arc<Mutex<Option<BridgeJob>>>, update: impl FnOnce(&mut BridgeJob)) {
    if let Ok(mut guard) = job_state.lock() {
        if let Some(job) = guard.as_mut() {
            update(job);
        }
    }
}

fn download_route(
    stream: TcpStream,
    app: &AppHandle,
    job_state: &Arc<Mutex<Option<BridgeJob>>>,
    downloads_dir: &Path,
    cache_dir: &Path,
    body: &[u8],
) {
    let parsed: BridgeDownloadRequest = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(_) => {
            respond(stream, 400, error_body("La descarga pedida no es válida."));
            return;
        }
    };
    let mut request = parsed.download;
    let direct_image = parsed.direct_image.unwrap_or(false);
    let validated = match validate_url(&request.url) {
        Ok(url) => url,
        Err(error) => {
            respond(stream, 400, error_body(error.message));
            return;
        }
    };
    request.cookies_file = None;
    request.url = validated.clone();
    let busy = job_state
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|job| job.status == "running"))
        .unwrap_or(false);
    if busy {
        respond(
            stream,
            409,
            error_body("Ya hay una descarga en curso; esperá a que termine."),
        );
        return;
    }
    let id = Uuid::new_v4().to_string();
    let initial = BridgeJob {
        id: id.clone(),
        status: "running".to_owned(),
        stage: "starting".to_owned(),
        percent: None,
        message: "Preparando la descarga…".to_owned(),
        files: Vec::new(),
        error: None,
    };
    if let Ok(mut guard) = job_state.lock() {
        *guard = Some(initial.clone());
    }
    respond(
        stream,
        202,
        serde_json::to_string(&initial).unwrap_or_else(|_| "{}".to_owned()),
    );

    let app = app.clone();
    let job_state = job_state.clone();
    let downloads_dir = downloads_dir.to_path_buf();
    let cache_dir = cache_dir.to_path_buf();
    let _ = thread::Builder::new()
        .name("editor-ia-bridge-download".to_owned())
        .spawn(move || {
            if direct_image {
                run_direct_image(job_state, downloads_dir, validated);
            } else {
                run_job(app, job_state, downloads_dir, cache_dir, request);
            }
        });
}

fn image_file_name(url: &str, content_type: &str) -> String {
    let raw = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("imagen");
    let sanitized: String = raw
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => character,
        })
        .collect();
    let lower = sanitized.to_ascii_lowercase();
    let has_extension = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]
        .iter()
        .any(|extension| lower.ends_with(extension));
    if has_extension {
        return sanitized;
    }
    let extension = match content_type {
        value if value.contains("png") => ".png",
        value if value.contains("webp") => ".webp",
        value if value.contains("gif") => ".gif",
        value if value.contains("avif") => ".avif",
        _ => ".jpg",
    };
    format!("{sanitized}{extension}")
}

fn run_direct_image(job_state: Arc<Mutex<Option<BridgeJob>>>, downloads_dir: PathBuf, url: String) {
    let result = (|| -> Result<BridgeFile, ProjectError> {
        let client = reqwest::blocking::Client::builder()
            .user_agent("EditorIA/0.1")
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|_| provider_error("No se pudo preparar la descarga de la imagen."))?;
        let mut response = client
            .get(&url)
            .send()
            .map_err(|error| provider_error(format!("No se pudo abrir la imagen: {error}")))?;
        if !response.status().is_success() {
            return Err(provider_error(format!(
                "El servidor rechazó la imagen ({})",
                response.status()
            )));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if content_type.starts_with("text/html") {
            return Err(provider_error("El enlace no es una imagen directa."));
        }
        let total = response.content_length();
        if total.unwrap_or(0) > 100 * 1024 * 1024 {
            return Err(provider_error("La imagen supera los 100 MB."));
        }
        let platform_dir = downloads_dir.join(platform_folder(&url));
        let file_name = image_file_name(&url, &content_type);
        let destination_dir = folder_from_file_name(&file_name)
            .map(|folder| platform_dir.join(folder))
            .unwrap_or(platform_dir);
        std::fs::create_dir_all(&destination_dir)
            .map_err(|_| provider_error("No se pudo crear Videos descargados."))?;
        let destination = unique_destination(&destination_dir, &file_name);
        let mut file = std::fs::File::create(&destination)
            .map_err(|_| provider_error("No se pudo escribir la imagen en Descargas."))?;
        let mut buffer = [0u8; 64 * 1024];
        let mut written: u64 = 0;
        loop {
            let read = response
                .read(&mut buffer)
                .map_err(|error| provider_error(format!("La imagen se cortó: {error}")))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])
                .map_err(|_| provider_error("No se pudo guardar la imagen."))?;
            written += read as u64;
            if written > 100 * 1024 * 1024 {
                let _ = std::fs::remove_file(&destination);
                return Err(provider_error("La imagen supera los 100 MB."));
            }
            if let Some(total) = total.filter(|value| *value > 0) {
                let percent = (written as f64 / total as f64 * 100.0).min(99.0);
                set_job(&job_state, |job| {
                    job.stage = "downloading".to_owned();
                    job.percent = Some(percent);
                    job.message = "Descargando imagen…".to_owned();
                });
            }
        }
        if written == 0 {
            let _ = std::fs::remove_file(&destination);
            return Err(provider_error("La imagen llegó vacía."));
        }
        Ok(BridgeFile {
            name: destination
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "imagen".to_owned()),
            bytes: written,
            path: destination.to_string_lossy().into_owned(),
        })
    })();
    match result {
        Ok(file) => set_job(&job_state, |job| {
            job.status = "done".to_owned();
            job.stage = "done".to_owned();
            job.percent = Some(100.0);
            job.message = "Guardado en Videos descargados.".to_owned();
            job.files = vec![file];
            job.error = None;
        }),
        Err(error) => set_job(&job_state, |job| {
            job.status = "error".to_owned();
            job.stage = "error".to_owned();
            job.message = error.message.clone();
            job.error = Some(error.message);
        }),
    }
}

fn run_job(
    app: AppHandle,
    job_state: Arc<Mutex<Option<BridgeJob>>>,
    downloads_dir: PathBuf,
    cache_dir: PathBuf,
    request: DownloadRequest,
) {
    let result = (|| -> Result<Vec<BridgeFile>, ProjectError> {
        let (engine, ffmpeg, ffprobe) = {
            let state = app.state::<AppState>();
            let settings = state.settings_snapshot()?;
            let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
            (resolve_engine(&state.config_dir)?, ffmpeg, ffprobe)
        };
        let platform = platform_folder(&request.url);
        let progress_job = job_state.clone();
        let progress = move |stage: &str, percent: Option<f64>, message: &str| {
            set_job(&progress_job, |job| {
                job.stage = stage.to_owned();
                job.percent = percent;
                job.message = message.to_owned();
            });
        };
        let piper = crate::commands::piper::resolve_assets(&app);
        let watermark = crate::commands::piper::resolve_watermark(&app);
        let outcome = download_blocking(
            &progress,
            &engine,
            &cache_dir,
            request,
            ffmpeg,
            ffprobe,
            None,
            piper,
            watermark,
        )?;
        let platform_dir = downloads_dir.join(platform);
        let destination_dir = outcome
            .files
            .first()
            .and_then(|file| folder_from_file_name(&file.name))
            .map(|folder| platform_dir.join(folder))
            .unwrap_or(platform_dir);
        std::fs::create_dir_all(&destination_dir)
            .map_err(|_| provider_error("No se pudo crear Videos descargados."))?;
        let mut files: Vec<BridgeFile> = Vec::new();
        for file in &outcome.files {
            let source = Path::new(&file.path);
            if !source.is_file() {
                continue;
            }
            let destination = unique_destination(&destination_dir, &file.name);
            std::fs::copy(source, &destination)
                .map_err(|_| provider_error("Se descargó pero no se pudo copiar a Descargas."))?;
            let bytes = std::fs::metadata(&destination)
                .map(|metadata| metadata.len())
                .unwrap_or(file.bytes);
            files.push(BridgeFile {
                name: destination
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| file.name.clone()),
                bytes,
                path: destination.to_string_lossy().into_owned(),
            });
        }
        let cache_downloads = cache_dir.join("downloads");
        if let (Ok(root), Ok(directory)) = (
            cache_downloads.canonicalize(),
            Path::new(&outcome.directory).canonicalize(),
        ) {
            if directory.starts_with(root) {
                let _ = std::fs::remove_dir_all(directory);
            }
        }
        if files.is_empty() {
            return Err(provider_error(
                "La descarga terminó sin archivos utilizables.",
            ));
        }
        Ok(files)
    })();

    match result {
        Ok(files) => {
            set_job(&job_state, |job| {
                job.status = "done".to_owned();
                job.stage = "done".to_owned();
                job.percent = Some(100.0);
                job.message = "Guardado en Videos descargados.".to_owned();
                job.files = files;
                job.error = None;
            });
        }
        Err(error) => {
            set_job(&job_state, |job| {
                job.status = "error".to_owned();
                job.stage = "error".to_owned();
                job.message = error.message.clone();
                job.error = Some(error.message);
            });
        }
    }
}

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
