//! Social media downloader and post-download compression.
//!
//! The frontend never passes shell arguments: this module builds the yt-dlp and
//! FFmpeg argument vectors, validates the URL, caps galleries and verifies the
//! downloaded files before returning their paths. The engine is a separate
//! open-source executable; it is not bundled with Editor IA.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_URL_LENGTH: usize = 2_048;
const MAX_PROBE_BYTES: usize = 32 * 1024 * 1024;
const MAX_GALLERY_ITEMS: usize = 12;
const MAX_ENGINE_BYTES: usize = 200 * 1024 * 1024;
const MAX_HEIGHT: u32 = 4_320;
const ENGINE_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const ENGINE_SUMS_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";

const IMAGE_EXTENSIONS: [&str; 8] = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic"];
const VIDEO_EXTENSIONS: [&str; 9] = [
    "mp4", "mkv", "webm", "mov", "avi", "flv", "ts", "m4v", "3gp",
];
const AUDIO_EXTENSIONS: [&str; 6] = ["mp3", "m4a", "aac", "opus", "wav", "flac"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloaderStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub managed: bool,
    pub can_install: bool,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadQuality {
    pub height: u32,
    pub label: String,
    pub width: Option<u32>,
    pub fps: Option<f64>,
    pub ext: Option<String>,
    pub vcodec: Option<String>,
    pub filesize: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProbe {
    pub url: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_seconds: Option<f64>,
    pub thumbnail: Option<String>,
    pub kind: String,
    pub entry_count: usize,
    pub max_height: Option<u32>,
    pub estimated_bytes: Option<u64>,
    pub qualities: Vec<DownloadQuality>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub max_height: Option<u32>,
    pub compression: Option<String>,
    pub codec: Option<String>,
    pub kind: Option<String>,
    pub playlist: Option<bool>,
    pub cookies_file: Option<String>,
    pub format: Option<String>,
    pub save_to_downloads: Option<bool>,
    pub quality: Option<String>,
    pub destination_root: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub run_id: String,
    pub directory: String,
    pub files: Vec<DownloadedFile>,
    pub compressed: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    stage: String,
    percent: Option<f64>,
    message: String,
}

fn provider_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

fn invalid_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::InvalidProject, &message)
}

fn io_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::Io, &message)
}

fn emit_progress(app: &AppHandle, stage: &str, percent: Option<f64>, message: impl Into<String>) {
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            stage: stage.to_owned(),
            percent,
            message: message.into().chars().take(300).collect(),
        },
    );
}

fn managed_engine_path(config_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        config_dir.join("tools").join("yt-dlp.exe")
    } else {
        config_dir.join("tools").join("yt-dlp")
    }
}

/// Si el instalador trajo yt-dlp y la carpeta gestionada está vacía, lo copia
/// ahí. Así Descargar funciona recién instalada la app, sin pedir descarga.
pub(crate) fn ensure_bundled_engine(config_dir: &Path) {
    let managed = managed_engine_path(config_dir);
    if managed.is_file() {
        return;
    }
    let Some(base) = crate::commands::system::bundled_resource_dir() else {
        return;
    };
    let file_name = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    let bundled = base.join("tools").join(file_name);
    if !bundled.is_file() {
        return;
    }
    if let Some(parent) = managed.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::copy(&bundled, &managed);
}

fn engine_version(engine: &Path) -> Option<String> {
    let mut command = Command::new(engine);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

pub(crate) fn resolve_engine(config_dir: &Path) -> Result<PathBuf, ProjectError> {
    let managed = managed_engine_path(config_dir);
    if managed.is_file() && engine_version(&managed).is_some() {
        return Ok(managed);
    }
    let from_path = PathBuf::from("yt-dlp");
    if engine_version(&from_path).is_some() {
        return Ok(from_path);
    }
    Err(provider_error(
        "El motor de descargas (yt-dlp) no está instalado. Instalalo desde Descargar o agregá yt-dlp al PATH.",
    ))
}

fn status_from_config(config_dir: &Path) -> DownloaderStatus {
    let managed = managed_engine_path(config_dir);
    if managed.is_file() {
        if let Some(version) = engine_version(&managed) {
            return DownloaderStatus {
                available: true,
                version: Some(version),
                path: Some(managed.to_string_lossy().into_owned()),
                managed: true,
                can_install: true,
                hint: None,
            };
        }
    }
    let from_path = PathBuf::from("yt-dlp");
    if let Some(version) = engine_version(&from_path) {
        return DownloaderStatus {
            available: true,
            version: Some(version),
            path: Some("yt-dlp".to_owned()),
            managed: false,
            can_install: true,
            hint: None,
        };
    }
    DownloaderStatus {
        available: false,
        version: None,
        path: None,
        managed: false,
        can_install: cfg!(windows),
        hint: Some(
            "Instalá el motor para descargar de redes sociales. Sólo se baja el ejecutable oficial de yt-dlp desde GitHub."
                .to_owned(),
        ),
    }
}

/// `engine_version` lanza `yt-dlp --version` y espera el proceso. En Windows ese
/// arranque puede tardar segundos, y `downloader_status` se llama cada vez que se
/// abre la vista Descargar. Se cachea para que cambiar de pestaña no vuelva a
/// pagar ese costo.
fn status_cache() -> &'static Mutex<Option<(Instant, DownloaderStatus)>> {
    static CACHE: OnceLock<Mutex<Option<(Instant, DownloaderStatus)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

const STATUS_TTL: Duration = Duration::from_secs(60);

fn invalidate_status_cache() {
    if let Ok(mut guard) = status_cache().lock() {
        *guard = None;
    }
}

#[tauri::command]
pub async fn downloader_status(
    state: State<'_, AppState>,
) -> Result<DownloaderStatus, ProjectError> {
    if let Ok(guard) = status_cache().lock() {
        if let Some((at, cached)) = guard.as_ref() {
            if at.elapsed() < STATUS_TTL {
                return Ok(cached.clone());
            }
        }
    }
    let fresh = status_from_config(&state.config_dir);
    if let Ok(mut guard) = status_cache().lock() {
        *guard = Some((Instant::now(), fresh.clone()));
    }
    Ok(fresh)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn expected_engine_hash(sums: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?;
        if name
            .trim_start_matches('*')
            .eq_ignore_ascii_case("yt-dlp.exe")
        {
            Some(hash.to_ascii_lowercase())
        } else {
            None
        }
    })
}

#[tauri::command]
pub async fn install_downloader(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DownloaderStatus, ProjectError> {
    // El estado cacheado deja de valer apenas se intenta instalar el motor.
    invalidate_status_cache();
    if !cfg!(windows) {
        return Err(provider_error(
            "La instalación automática sólo está disponible en Windows. Instalá yt-dlp con tu gestor de paquetes.",
        ));
    }
    let config_dir = state.config_dir.clone();
    emit_progress(&app, "engine", None, "Descargando yt-dlp oficial…");
    let client = reqwest::Client::builder()
        .user_agent("EditorIA/0.1 yt-dlp-installer")
        .build()
        .map_err(|_| provider_error("No se pudo preparar la descarga del motor."))?;
    let exe = client
        .get(ENGINE_URL)
        .send()
        .await
        .map_err(|error| provider_error(format!("No se pudo descargar yt-dlp: {error}")))?
        .error_for_status()
        .map_err(|error| provider_error(format!("GitHub rechazó la descarga del motor: {error}")))?
        .bytes()
        .await
        .map_err(|error| provider_error(format!("La descarga del motor se cortó: {error}")))?;
    if exe.is_empty() || exe.len() > MAX_ENGINE_BYTES {
        return Err(provider_error(
            "El motor descargado tiene un tamaño inesperado; se canceló la instalación.",
        ));
    }
    emit_progress(&app, "engine", None, "Verificando el motor…");
    let sums = client
        .get(ENGINE_SUMS_URL)
        .send()
        .await
        .map_err(|error| provider_error(format!("No se pudo verificar el motor: {error}")))?
        .error_for_status()
        .map_err(|error| provider_error(format!("GitHub rechazó la verificación: {error}")))?
        .text()
        .await
        .map_err(|error| provider_error(format!("No se pudo leer la verificación: {error}")))?;
    let expected = expected_engine_hash(&sums)
        .ok_or_else(|| provider_error("El checksum oficial del motor no está disponible."))?;
    let actual = sha256_hex(&exe);
    if actual != expected {
        return Err(provider_error(
            "El checksum del motor no coincide con el oficial; no se instaló.",
        ));
    }
    let tools_dir = config_dir.join("tools");
    std::fs::create_dir_all(&tools_dir)
        .map_err(|_| io_error("No se pudo crear la carpeta de herramientas."))?;
    let target = managed_engine_path(&config_dir);
    let temporary = tools_dir.join("yt-dlp.exe.download");
    std::fs::write(&temporary, &exe)
        .map_err(|_| io_error("No se pudo escribir el motor descargado."))?;
    if target.exists() {
        let _ = std::fs::remove_file(&target);
    }
    std::fs::rename(&temporary, &target)
        .map_err(|_| io_error("No se pudo instalar el motor descargado."))?;
    if engine_version(&target).is_none() {
        let _ = std::fs::remove_file(&target);
        return Err(provider_error(
            "El motor se descargó pero no respondió a --version; se descartó.",
        ));
    }
    emit_progress(&app, "engine", None, "Motor instalado.");
    Ok(status_from_config(&config_dir))
}

pub(crate) fn validate_url(raw: &str) -> Result<String, ProjectError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_URL_LENGTH {
        return Err(invalid_error("Pegá una URL http(s) válida."));
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| {
        invalid_error("La URL no es válida. Tiene que empezar con http:// o https://.")
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(invalid_error("Sólo se aceptan URLs http o https."));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| invalid_error("La URL no tiene un host válido."))?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        return Err(invalid_error("La URL no tiene un host válido."));
    }
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") {
        return Err(invalid_error("No se permiten direcciones locales."));
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(value) => {
                value.is_private()
                    || value.is_loopback()
                    || value.is_link_local()
                    || value.is_unspecified()
            }
            IpAddr::V6(value) => {
                value.is_loopback()
                    || value.is_unspecified()
                    || value.is_unique_local()
                    || value.is_unicast_link_local()
            }
        };
        if private {
            return Err(invalid_error(
                "No se permiten direcciones privadas ni locales.",
            ));
        }
    }
    Ok(parsed.to_string())
}

fn validate_cookies_file(raw: Option<&str>) -> Result<Option<PathBuf>, ProjectError> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(raw);
    let metadata = std::fs::metadata(&path)
        .map_err(|_| invalid_error("El archivo de cookies no existe en esa ruta."))?;
    if !metadata.is_file() {
        return Err(invalid_error(
            "Las cookies tienen que ser un archivo de texto.",
        ));
    }
    if metadata.len() == 0 || metadata.len() > 10 * 1024 * 1024 {
        return Err(invalid_error(
            "El archivo de cookies está vacío o supera los 10 MB.",
        ));
    }
    Ok(Some(path))
}

#[tauri::command]
pub async fn choose_cookies_file(app: AppHandle) -> Result<Option<String>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Elegir cookies.txt exportadas del navegador")
        .add_filter("Cookies Netscape", &["txt", "cookies"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| io_error("No se pudo usar el archivo de cookies elegido."))?;
    validate_cookies_file(Some(&path.to_string_lossy()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn is_youtube_host(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    host == "youtu.be"
        || host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
}

fn host_matches(host: &str, domains: &[&str]) -> bool {
    domains
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

/// Fixed folder names used below Downloads/Videos descargados. The URL is
/// parsed, never used as a path, so a site cannot choose or escape the folder.
pub(crate) fn platform_folder(raw: &str) -> &'static str {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return "Otros";
    };
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if host_matches(&host, &["youtube.com", "youtu.be", "youtube-nocookie.com"]) {
        "YouTube"
    } else if host_matches(&host, &["tiktok.com"]) {
        "TikTok"
    } else if host_matches(&host, &["instagram.com"]) {
        "Instagram"
    } else if host_matches(&host, &["facebook.com", "fb.watch"]) {
        "Facebook"
    } else if host_matches(&host, &["x.com", "twitter.com"]) {
        "X"
    } else if host_matches(&host, &["vimeo.com"]) {
        "Vimeo"
    } else if host_matches(&host, &["twitch.tv"]) {
        "Twitch"
    } else if host_matches(&host, &["pinterest.com", "pin.it"]) {
        "Pinterest"
    } else if host_matches(&host, &["reddit.com", "redd.it"]) {
        "Reddit"
    } else if host_matches(&host, &["threads.net"]) {
        "Threads"
    } else if host_matches(&host, &["snapchat.com"]) {
        "Snapchat"
    } else {
        "Otros"
    }
}

fn video_format_selector(quality: &str, max_height: u32) -> String {
    if quality == "worst" {
        return "worstvideo[height>=144]+worstaudio/worst[height>=144]/worst".to_owned();
    }
    format!("bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best")
}

fn truncate(value: &str, limit: usize) -> String {
    value.trim().chars().take(limit).collect()
}

fn error_tail(stderr: &str, fallback: &str) -> String {
    let line = stderr
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(fallback);
    truncate(line, 320)
}

fn guess_kind(ext: &str, vcodec: &str, acodec: &str) -> &'static str {
    let ext = ext.to_ascii_lowercase();
    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return "image";
    }
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) && vcodec != "none" {
        return "video";
    }
    if AUDIO_EXTENSIONS.contains(&ext.as_str()) || (vcodec == "none" && acodec != "none") {
        return "audio";
    }
    "video"
}

fn format_size_from_json(format: &Value, duration: f64) -> Option<u64> {
    if let Some(size) = format["filesize"].as_u64() {
        return Some(size);
    }
    if let Some(size) = format["filesize_approx"].as_u64() {
        return Some(size);
    }
    let tbr = format["tbr"].as_f64().or_else(|| format["vbr"].as_f64())?;
    if duration <= 0.0 {
        return None;
    }
    Some((tbr * 1_000.0 * duration / 8.0).round().max(0.0) as u64)
}

fn height_label(height: u32) -> String {
    match height {
        4_320 => "4320p · 8K".to_owned(),
        2_880 => "2880p · 5K".to_owned(),
        2_160 => "2160p · 4K".to_owned(),
        1_440 => "1440p · 2K".to_owned(),
        1_080 => "1080p · Full HD".to_owned(),
        720 => "720p · HD".to_owned(),
        480 => "480p · SD".to_owned(),
        _ => format!("{height}p"),
    }
}

fn qualities_from_formats(
    formats: &[Value],
    duration: f64,
    with_sizes: bool,
) -> (Vec<DownloadQuality>, Option<u32>) {
    let mut best_audio_size: Option<u64> = None;
    for format in formats {
        let vcodec = format["vcodec"].as_str().unwrap_or("none");
        let acodec = format["acodec"].as_str().unwrap_or("none");
        if vcodec == "none" && acodec != "none" {
            if let Some(size) = format_size_from_json(format, duration) {
                best_audio_size = Some(best_audio_size.map_or(size, |current| current.max(size)));
            }
        }
    }
    let audio_estimate = best_audio_size.or_else(|| {
        if with_sizes && duration > 0.0 {
            Some((160_000.0 * duration / 8.0).round() as u64)
        } else {
            None
        }
    });

    let mut per_height: BTreeMap<u32, (DownloadQuality, f64)> = BTreeMap::new();
    for format in formats {
        let vcodec = format["vcodec"].as_str().unwrap_or("none");
        if vcodec == "none" {
            continue;
        }
        let Some(height) = format["height"].as_u64().map(|value| value as u32) else {
            continue;
        };
        if height == 0 || height > MAX_HEIGHT {
            continue;
        }
        let acodec = format["acodec"].as_str().unwrap_or("none");
        let own_size = format_size_from_json(format, duration);
        let total_size = if !with_sizes {
            None
        } else if acodec != "none" {
            own_size
        } else {
            match (own_size, audio_estimate) {
                (Some(video), Some(audio)) => Some(video.saturating_add(audio)),
                (Some(video), None) => Some(video),
                (None, Some(audio)) => Some(audio),
                (None, None) => None,
            }
        };
        let tbr = format["tbr"].as_f64().unwrap_or(0.0);
        let candidate = DownloadQuality {
            height,
            label: height_label(height),
            width: format["width"].as_u64().map(|value| value as u32),
            fps: format["fps"].as_f64(),
            ext: format["ext"].as_str().map(str::to_owned),
            vcodec: format["vcodec"].as_str().map(str::to_owned),
            filesize: total_size,
        };
        match per_height.get(&height) {
            Some((_, current_tbr)) if *current_tbr >= tbr => {}
            _ => {
                per_height.insert(height, (candidate, tbr));
            }
        }
    }
    let mut qualities: Vec<DownloadQuality> = per_height
        .into_values()
        .map(|(quality, _)| quality)
        .collect();
    qualities.sort_by(|a, b| b.height.cmp(&a.height));
    let max_height = qualities.first().map(|quality| quality.height);
    (qualities, max_height)
}

fn merge_gallery_qualities(entries: &[Value]) -> (Vec<DownloadQuality>, Option<u32>) {
    let mut heights: BTreeMap<u32, DownloadQuality> = BTreeMap::new();
    for entry in entries {
        let formats = entry["formats"].as_array().cloned().unwrap_or_default();
        let duration = entry["duration"].as_f64().unwrap_or(0.0);
        let (qualities, _) = qualities_from_formats(&formats, duration, false);
        for quality in qualities {
            heights.entry(quality.height).or_insert(quality);
        }
    }
    let mut qualities: Vec<DownloadQuality> = heights.into_values().collect();
    qualities.sort_by(|a, b| b.height.cmp(&a.height));
    let max_height = qualities.first().map(|quality| quality.height);
    (qualities, max_height)
}

fn probe_value(url: String, value: &Value) -> Result<DownloadProbe, ProjectError> {
    let entries = value["entries"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry.is_object())
                .cloned()
                .collect::<Vec<Value>>()
        })
        .filter(|entries| !entries.is_empty());
    if let Some(entries) = entries {
        if value["_type"].as_str() == Some("playlist") || entries.len() > 1 {
            if entries.len() > MAX_GALLERY_ITEMS {
                return Err(invalid_error(
                    "La URL parece una lista o un canal con demasiados elementos. Pegá la URL de un post individual.",
                ));
            }
            let images = entries
                .iter()
                .filter(|entry| {
                    let ext = entry["ext"].as_str().unwrap_or("");
                    IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
                })
                .count();
            let all_images = images == entries.len();
            let title = truncate(
                value["title"]
                    .as_str()
                    .or_else(|| entries.first().and_then(|entry| entry["title"].as_str()))
                    .unwrap_or("Publicación"),
                200,
            );
            let duration = entries
                .iter()
                .filter_map(|entry| entry["duration"].as_f64())
                .reduce(|left, right| left + right);
            let estimated = if all_images {
                entries.iter().try_fold(0u64, |total, entry| {
                    let size = format_size_from_json(entry, 0.0)?;
                    Some(total.saturating_add(size))
                })
            } else {
                None
            };
            let (qualities, max_height) = merge_gallery_qualities(&entries);
            return Ok(DownloadProbe {
                url,
                title,
                uploader: value["uploader"]
                    .as_str()
                    .or_else(|| value["channel"].as_str())
                    .map(|value| truncate(value, 120)),
                duration_seconds: duration,
                thumbnail: value["thumbnail"].as_str().map(str::to_owned).or_else(|| {
                    entries
                        .first()
                        .and_then(|entry| entry["thumbnail"].as_str())
                        .map(str::to_owned)
                }),
                kind: "gallery".to_owned(),
                entry_count: entries.len(),
                max_height,
                estimated_bytes: estimated,
                qualities,
            });
        }
    }

    let ext = value["ext"].as_str().unwrap_or("mp4");
    let vcodec = value["vcodec"].as_str().unwrap_or("none");
    let acodec = value["acodec"].as_str().unwrap_or("none");
    let kind = guess_kind(ext, vcodec, acodec);
    let formats = value["formats"].as_array().cloned().unwrap_or_default();
    let duration = value["duration"].as_f64();
    let (qualities, max_height) = if kind == "video" {
        qualities_from_formats(&formats, duration.unwrap_or(0.0), true)
    } else {
        (Vec::new(), None)
    };
    let estimated_bytes = if kind == "image" || kind == "audio" {
        format_size_from_json(value, duration.unwrap_or(0.0))
    } else {
        qualities.first().and_then(|quality| quality.filesize)
    };
    Ok(DownloadProbe {
        url,
        title: truncate(value["title"].as_str().unwrap_or("Sin título"), 200),
        uploader: value["uploader"]
            .as_str()
            .or_else(|| value["channel"].as_str())
            .or_else(|| value["creator"].as_str())
            .map(|value| truncate(value, 120)),
        duration_seconds: duration,
        thumbnail: value["thumbnail"].as_str().map(str::to_owned),
        kind: kind.to_owned(),
        entry_count: 1,
        max_height,
        estimated_bytes,
        qualities,
    })
}

fn probe_blocking(
    app: &AppHandle,
    engine: &Path,
    url: &str,
    cookies: Option<&Path>,
) -> Result<DownloadProbe, ProjectError> {
    emit_progress(app, "probing", None, "Consultando la URL…");
    probe_with_engine(engine, url, cookies)
}

pub(crate) fn probe_with_engine(
    engine: &Path,
    url: &str,
    cookies: Option<&Path>,
) -> Result<DownloadProbe, ProjectError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| invalid_error("La URL no es válida."))?;
    let mut command = Command::new(engine);
    command.args([
        "--dump-single-json",
        "--no-warnings",
        "--ignore-config",
        "--socket-timeout",
        "25",
        "--retries",
        "2",
        "--playlist-end",
        "13",
    ]);
    if is_youtube_host(&parsed) {
        command.arg("--no-playlist");
    }
    if let Some(cookies) = cookies {
        command.arg("--cookies").arg(cookies);
    }
    command.arg(url);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para analizar la URL."))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(provider_error(format!(
            "No se pudo analizar la URL: {}",
            error_tail(&stderr, "yt-dlp falló")
        )));
    }
    if output.stdout.len() > MAX_PROBE_BYTES {
        return Err(provider_error(
            "La respuesta del sitio es demasiado grande para analizarla.",
        ));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| provider_error("El sitio devolvió datos que no se pudieron interpretar."))?;
    probe_value(url.to_owned(), &value)
}

#[tauri::command]
pub async fn probe_download(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    cookies_file: Option<String>,
) -> Result<DownloadProbe, ProjectError> {
    let validated = validate_url(&url)?;
    let cookies = validate_cookies_file(cookies_file.as_deref())?;
    let engine = resolve_engine(&state.config_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        probe_blocking(&app, &engine, &validated, cookies.as_deref())
    })
    .await
    .map_err(|_| provider_error("El análisis de la URL se interrumpió."))?
}

fn media_extension(path: &Path) -> String {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn downloaded_kind(path: &Path) -> &'static str {
    let extension = media_extension(path);
    if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        "image"
    } else if AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        "audio"
    } else if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        "video"
    } else {
        "other"
    }
}

fn parse_progress_percent(line: &str) -> Option<f64> {
    let percent_index = line.find('%')?;
    let token = line[..percent_index].split_whitespace().last()?;
    token
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| (0.0..=100.0).contains(value))
}

fn read_download_output(
    progress: ProgressSink<'_>,
    child: &mut std::process::Child,
) -> (bool, String) {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_handle = stderr.map(|stderr| {
        thread::spawn(move || {
            BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<String>>()
                .join("\n")
        })
    });
    let mut last_percent: i32 = -1;
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(percent) = parse_progress_percent(&line) {
                let rounded = percent.floor() as i32;
                if rounded != last_percent {
                    last_percent = rounded;
                    progress("downloading", Some(percent), line.trim());
                }
            } else if !line.trim().is_empty() {
                progress("downloading", None, line.trim());
            }
        }
    }
    let status = child.wait();
    let stderr = stderr_handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    (status.map(|value| value.success()).unwrap_or(false), stderr)
}

fn dimensions(ffprobe: Option<&Path>, path: &Path) -> Option<(u32, u32)> {
    let ffprobe = ffprobe?;
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value: Value = serde_json::from_slice(&output.stdout).ok()?;
    let stream = value["streams"].as_array()?.first()?;
    Some((
        stream["width"].as_u64()? as u32,
        stream["height"].as_u64()? as u32,
    ))
}

pub(crate) type ProgressSink<'a> = &'a dyn Fn(&str, Option<f64>, &str);

fn compress_video(
    progress: ProgressSink<'_>,
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    input: &Path,
    crf: u32,
    codec: &str,
) -> Result<Option<PathBuf>, String> {
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let output = input.with_file_name(format!("{stem} - compacto.mp4"));
    let (width, height) = dimensions(ffprobe, input).unwrap_or((0, 0));
    let heavy = width > 3_840 || height > 2_160;
    let preset = if heavy { "fast" } else { "medium" };
    let codec_name = if codec == "h264" {
        "libx264"
    } else {
        "libx265"
    };
    progress(
        "compressing",
        None,
        &format!(
            "Comprimiendo {} con {codec}…",
            input
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default()
        ),
    );
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-v", "error", "-y", "-i"]);
    command.arg(input);
    command.args([
        "-map", "0:v:0", "-map", "0:a?", "-c:v", codec_name, "-preset", preset, "-crf",
    ]);
    command.arg(crf.to_string());
    command.args([
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
    ]);
    if codec == "h265" {
        command.args(["-tag:v", "hvc1"]);
    }
    command.arg(&output);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let result = command
        .output()
        .map_err(|_| "No se pudo ejecutar FFmpeg para comprimir.".to_owned())?;
    if !result.status.success() {
        let _ = std::fs::remove_file(&output);
        return Err(error_tail(
            &String::from_utf8_lossy(&result.stderr),
            "FFmpeg no pudo comprimir el video.",
        ));
    }
    let original_size = std::fs::metadata(input).map(|meta| meta.len()).unwrap_or(0);
    let compressed_size = std::fs::metadata(&output)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if compressed_size == 0 || compressed_size >= original_size {
        let _ = std::fs::remove_file(&output);
        return Ok(None);
    }
    std::fs::remove_file(input).map_err(|_| {
        "Se comprimió el video pero no se pudo reemplazar el archivo original.".to_owned()
    })?;
    Ok(Some(output))
}

pub(crate) fn download_blocking(
    progress: ProgressSink<'_>,
    engine: &Path,
    cache_dir: &Path,
    request: DownloadRequest,
    ffmpeg: Option<PathBuf>,
    ffprobe: Option<PathBuf>,
    cookies: Option<&Path>,
) -> Result<DownloadOutcome, ProjectError> {
    let validated = validate_url(&request.url)?;
    let kind = request.kind.as_deref().unwrap_or("video");
    if !matches!(kind, "video" | "image" | "audio" | "gallery") {
        return Err(invalid_error("El tipo de descarga no es válido."));
    }
    let compression = request.compression.as_deref().unwrap_or("none");
    let requested_crf = match compression {
        "none" => None,
        "high" => Some(20),
        "balanced" => Some(24),
        "compact" => Some(27),
        _ => return Err(invalid_error("El nivel de compresión no es válido.")),
    };
    let codec = match request.codec.as_deref().unwrap_or("h265") {
        "h265" | "h264" => request.codec.as_deref().unwrap_or("h265"),
        _ => return Err(invalid_error("El códec de compresión no es válido.")),
    };
    let quality = match request.quality.as_deref().unwrap_or("best") {
        "best" | "worst" | "height" => request.quality.as_deref().unwrap_or("best"),
        _ => return Err(invalid_error("La preferencia de calidad no es válida.")),
    };
    let requested_format = request
        .format
        .as_deref()
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let format = match requested_format.as_str() {
        "mp4" | "mkv" | "webm" | "mp3" | "m4a" => requested_format.as_str(),
        _ => return Err(invalid_error("El formato de salida no es válido.")),
    };
    let audio_only = matches!(format, "mp3" | "m4a");
    let compression_allowed = !audio_only && matches!(format, "mp4");
    if requested_crf.is_some() && !compression_allowed {
        return Err(invalid_error(
            "La compresión sólo se aplica al formato MP4. Elegí MP4 o desactivá la compresión.",
        ));
    }
    let crf = if compression_allowed {
        requested_crf
    } else {
        None
    };
    if crf.is_some() && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede comprimir. Elegí «Original» o configurá FFmpeg en Ajustes.",
        ));
    }
    let run_id = Uuid::new_v4().to_string();
    let directory = cache_dir.join("downloads").join(&run_id);
    std::fs::create_dir_all(&directory)
        .map_err(|_| io_error("No se pudo crear la carpeta temporal de descarga."))?;
    let output_template = download_output_template(&directory);
    let max_height = request
        .max_height
        .unwrap_or(MAX_HEIGHT)
        .clamp(144, MAX_HEIGHT);
    let playlist = request.playlist.unwrap_or(false);

    let mut command = Command::new(engine);
    command.args([
        "--no-warnings",
        "--newline",
        "--ignore-config",
        "--windows-filenames",
        "--socket-timeout",
        "30",
        "--retries",
        "5",
        "--fragment-retries",
        "5",
        "--concurrent-fragments",
        "4",
        "--no-overwrites",
    ]);
    if playlist {
        command.args(["--playlist-items", "1-12"]);
    } else {
        command.arg("--no-playlist");
    }
    if audio_only {
        command.args([
            "-f",
            "bestaudio/best",
            "-x",
            "--audio-format",
            format,
            "--audio-quality",
            "0",
        ]);
    } else if kind == "video" {
        command
            .arg("-f")
            .arg(video_format_selector(quality, max_height));
        command.args(["--merge-output-format", format, "--remux-video", format]);
    } else if kind == "audio" {
        command.args(["-f", "bestaudio/best"]);
    }
    if let Some(cookies) = cookies {
        command.arg("--cookies").arg(cookies);
    }
    command.arg("-o").arg(&output_template);
    command.arg(&validated);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    progress(
        "downloading",
        Some(0.0),
        if playlist {
            "Descargando el carrusel…"
        } else {
            "Iniciando la descarga…"
        },
    );
    let mut child = command
        .spawn()
        .map_err(|_| provider_error("No se pudo iniciar yt-dlp para descargar."))?;
    let (success, stderr) = read_download_output(progress, &mut child);
    if !success {
        return Err(provider_error(format!(
            "La descarga falló: {}",
            error_tail(&stderr, "yt-dlp terminó con error")
        )));
    }

    let mut entries = std::fs::read_dir(&directory)
        .map_err(|_| io_error("No se pudo leer la carpeta de descarga."))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.path())
        .filter(|path| {
            let extension = media_extension(path);
            !matches!(
                extension.as_str(),
                "part" | "ytdl" | "temp" | "json" | "description"
            )
        })
        .collect::<Vec<PathBuf>>();
    if entries.is_empty() {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(provider_error(
            "yt-dlp terminó sin archivos. Puede que el sitio requiera iniciar sesión o que el contenido sea privado.",
        ));
    }
    entries.sort();

    let mut warnings: Vec<String> = Vec::new();
    let mut compressed = false;
    if let (Some(crf), Some(ffmpeg)) = (crf, ffmpeg.as_deref()) {
        for path in entries.clone() {
            if downloaded_kind(&path) != "video" {
                continue;
            }
            match compress_video(progress, ffmpeg, ffprobe.as_deref(), &path, crf, codec) {
                Ok(Some(new_path)) => {
                    compressed = true;
                    entries.retain(|entry| entry != &path);
                    entries.push(new_path);
                }
                Ok(None) => warnings.push(
                    "Un video ya estaba bien comprimido: se conservó el original porque la recompresión no quedaba más chica."
                        .to_owned(),
                ),
                Err(message) => warnings.push(format!("No se pudo comprimir un video: {message}")),
            }
        }
        entries.sort();
    } else if kind == "image" && crf.is_some() {
        warnings.push(
            "Las imágenes no se recomprimen; se descargan en su formato original.".to_owned(),
        );
    }

    let files = entries
        .into_iter()
        .map(|path| {
            let bytes = std::fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            DownloadedFile {
                name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "archivo".to_owned()),
                path: path.to_string_lossy().into_owned(),
                bytes,
                kind: downloaded_kind(&path).to_owned(),
            }
        })
        .collect::<Vec<DownloadedFile>>();
    progress("done", Some(100.0), "Descarga terminada.");
    Ok(DownloadOutcome {
        run_id,
        directory: directory.to_string_lossy().into_owned(),
        files,
        compressed,
        warnings,
    })
}

fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("archivo");
    let direct = directory.join(file_name);
    if !direct.exists() {
        return direct;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 2..=999 {
        let candidate = directory.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let suffix = &Uuid::new_v4().to_string()[..8];
    directory.join(format!("{stem}-{suffix}{extension}"))
}

/// Turns the downloaded file stem into a folder name. Invalid Windows
/// characters are replaced, whitespace is collapsed and the name is capped so
/// the final path stays usable. The original file name remains untouched.
/// Windows still fails with OSError 22 when the temporary path + title +
/// yt-dlp suffixes cross MAX_PATH. Keep the readable title below 60 chars and
/// let yt-dlp produce Windows-safe names; the per-video folder is derived from
/// that short stem.
fn download_output_template(directory: &Path) -> String {
    directory
        .join("%(title).60s [%(id)s].%(ext)s")
        .to_string_lossy()
        .into_owned()
}

pub(crate) fn folder_from_file_name(name: &str) -> Option<String> {
    let raw_stem = Path::new(name).file_stem()?.to_string_lossy();
    let stem = raw_stem
        .strip_suffix(" - compacto")
        .unwrap_or(raw_stem.as_ref());
    let mut cleaned = String::with_capacity(stem.len());
    for character in stem.chars() {
        if character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        {
            cleaned.push('_');
        } else {
            cleaned.push(character);
        }
    }
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed
        .trim_matches([' ', '.'])
        .chars()
        .take(80)
        .collect::<String>();
    let trimmed = trimmed.trim_end_matches([' ', '.']).to_owned();
    if trimmed.is_empty() {
        return None;
    }
    let upper = trimmed.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|value| (1..=9).contains(&value))
        || upper
            .strip_prefix("LPT")
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|value| (1..=9).contains(&value));
    Some(if reserved {
        format!("_{trimmed}")
    } else {
        trimmed
    })
}

fn download_folder_name(files: &[DownloadedFile]) -> Option<String> {
    files
        .first()
        .and_then(|file| folder_from_file_name(&file.name))
}

/// The user can choose any existing folder, so downloads can live on another
/// disk. The default is Downloads/Videos descargados. The chosen folder stays
/// as typed (no `\\?\` prefix) and is validated before any file is moved.
fn resolve_destination_root(
    chosen: Option<&str>,
    default: PathBuf,
) -> Result<PathBuf, ProjectError> {
    let Some(chosen) = chosen.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(default);
    };
    let path = PathBuf::from(chosen);
    if !path.is_absolute() {
        return Err(invalid_error(
            "La carpeta de descarga debe ser una ruta absoluta.",
        ));
    }
    if !path.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "La carpeta de descarga ya no existe. Elegí otra carpeta.",
        ));
    }
    Ok(path)
}

#[tauri::command]
pub async fn choose_download_directory(app: AppHandle) -> Result<Option<String>, ProjectError> {
    let default = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("Elegir carpeta para las descargas")
        .set_directory(default)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "No se pudo usar la carpeta elegida.")
    })?;
    if !folder.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "La ruta elegida no es una carpeta.",
        ));
    }
    Ok(Some(folder.to_string_lossy().into_owned()))
}

fn move_download_to(outcome: &mut DownloadOutcome, destination: &Path) -> Result<(), ProjectError> {
    std::fs::create_dir_all(destination)
        .map_err(|_| io_error("No se pudo crear Videos descargados."))?;
    let mut moved = Vec::with_capacity(outcome.files.len());
    for file in &outcome.files {
        let source = PathBuf::from(&file.path);
        let target = unique_destination(destination, &file.name);
        if std::fs::rename(&source, &target).is_err() {
            std::fs::copy(&source, &target)
                .map_err(|_| io_error("No se pudo guardar el archivo en Descargas."))?;
            std::fs::remove_file(&source).map_err(|_| {
                io_error("Se copió el archivo pero no se pudo limpiar el temporal.")
            })?;
        }
        let bytes = std::fs::metadata(&target)
            .map(|metadata| metadata.len())
            .unwrap_or(file.bytes);
        moved.push(DownloadedFile {
            path: target.to_string_lossy().into_owned(),
            name: target
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| file.name.clone()),
            bytes,
            kind: file.kind.clone(),
        });
    }
    outcome.files = moved;
    outcome.directory = destination.to_string_lossy().into_owned();
    Ok(())
}

#[tauri::command]
pub async fn download_media(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> Result<DownloadOutcome, ProjectError> {
    let engine = resolve_engine(&state.config_dir)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let cache_dir = state.cache_dir.clone();
    let url = validate_url(&request.url)?;
    let cookies = validate_cookies_file(request.cookies_file.as_deref())?;
    let destination = if request.save_to_downloads.unwrap_or(true) {
        let base = app
            .path()
            .download_dir()
            .map_err(|_| provider_error("No se pudo ubicar la carpeta de Descargas de Windows."))?;
        let root = resolve_destination_root(
            request.destination_root.as_deref(),
            base.join("Videos descargados"),
        )?;
        Some(root.join(platform_folder(&url)))
    } else {
        None
    };
    let mut request = DownloadRequest {
        url,
        save_to_downloads: None,
        destination_root: None,
        ..request
    };
    request.cookies_file = None;
    let progress_app = app.clone();
    let progress = move |stage: &str, percent: Option<f64>, message: &str| {
        emit_progress(&progress_app, stage, percent, message.to_owned());
    };
    let mut outcome = tauri::async_runtime::spawn_blocking(move || {
        download_blocking(
            &progress,
            &engine,
            &cache_dir,
            request,
            ffmpeg,
            ffprobe,
            cookies.as_deref(),
        )
    })
    .await
    .map_err(|_| provider_error("La descarga se interrumpió."))??;
    if let Some(root) = destination {
        let original = PathBuf::from(&outcome.directory);
        let destination = download_folder_name(&outcome.files)
            .map(|folder| root.join(folder))
            .unwrap_or(root);
        move_download_to(&mut outcome, &destination)?;
        let _ = std::fs::remove_dir_all(original);
        let saved_in = outcome.directory.clone();
        outcome.warnings.push(format!("Guardado en {saved_in}."));
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn cleanup_download(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<(), ProjectError> {
    let id = Uuid::parse_str(&run_id)
        .map_err(|_| invalid_error("El identificador de descarga no es válido."))?;
    let downloads = state.cache_dir.join("downloads");
    let target = downloads.join(id.to_string());
    let Ok(canonical_downloads) = downloads.canonicalize() else {
        return Ok(());
    };
    let Ok(canonical_target) = target.canonicalize() else {
        return Ok(());
    };
    if !canonical_target.starts_with(&canonical_downloads) {
        return Err(ProjectError::message(
            ProjectErrorCode::PathEscapesRoot,
            "La carpeta de descarga cae fuera del caché de la app.",
        ));
    }
    std::fs::remove_dir_all(&canonical_target)
        .map_err(|_| io_error("No se pudo limpiar la descarga temporal."))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_and_local_urls() {
        assert!(validate_url("file:///C:/secreto.mp4").is_err());
        assert!(validate_url("http://localhost:8080/video").is_err());
        assert!(validate_url("http://127.0.0.1/video").is_err());
        assert!(validate_url("http://192.168.1.10/video").is_err());
        assert!(validate_url("https://www.youtube.com/watch?v=abc").is_ok());
    }

    #[test]
    fn output_template_keeps_windows_paths_short() {
        let template = download_output_template(Path::new("C:/cache"));
        assert!(template.contains("%(title).60s"));
        assert!(!template.contains("%(title).120s"));
        assert!(template.contains("[%(id)s]"));
    }

    #[test]
    fn validates_a_custom_destination_root() {
        let root = std::env::temp_dir().join(format!("editor-ia-root-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let default = root.join("default");
        assert_eq!(
            resolve_destination_root(Some(root.to_str().unwrap()), default.clone()).unwrap(),
            root
        );
        assert!(resolve_destination_root(Some("relative/folder"), default.clone()).is_err());
        assert!(resolve_destination_root(
            Some(&root.join("missing").to_string_lossy()),
            default.clone()
        )
        .is_err());
        assert_eq!(
            resolve_destination_root(None, default.clone()).unwrap(),
            default
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn builds_a_safe_video_folder_name() {
        let files = vec![DownloadedFile {
            path: "C:\\cache\\video.mp4".to_owned(),
            name: "Mi video_ capítulo 1_2_.mp4".to_owned(),
            bytes: 1,
            kind: "video".to_owned(),
        }];
        assert_eq!(
            download_folder_name(&files).as_deref(),
            Some("Mi video_ capítulo 1_2_")
        );
        assert_eq!(folder_from_file_name("Qué?.mp4").as_deref(), Some("Qué_"));
        assert_eq!(folder_from_file_name("CON.mp4").as_deref(), Some("_CON"));
        assert_eq!(
            folder_from_file_name("Toma principal - compacto.mp4").as_deref(),
            Some("Toma principal")
        );
        assert_eq!(download_folder_name(&[]), None);
    }

    #[test]
    fn maps_download_urls_to_platform_folders() {
        assert_eq!(
            platform_folder("https://www.youtube.com/watch?v=abc"),
            "YouTube"
        );
        assert_eq!(platform_folder("https://youtu.be/abc"), "YouTube");
        assert_eq!(
            platform_folder("https://www.tiktok.com/@a/video/1"),
            "TikTok"
        );
        assert_eq!(
            platform_folder("https://www.instagram.com/reel/abc"),
            "Instagram"
        );
        assert_eq!(platform_folder("https://x.com/user/status/1"), "X");
        assert_eq!(
            platform_folder("https://www.facebook.com/watch/?v=1"),
            "Facebook"
        );
        assert_eq!(platform_folder("https://vimeo.com/123"), "Vimeo");
        assert_eq!(platform_folder("https://www.twitch.tv/videos/1"), "Twitch");
        assert_eq!(platform_folder("https://example.com/video"), "Otros");
    }

    #[test]
    fn builds_best_worst_and_height_format_selectors() {
        assert_eq!(
            video_format_selector("best", 4_320),
            "bestvideo[height<=4320]+bestaudio/best[height<=4320]/best"
        );
        assert_eq!(
            video_format_selector("worst", 4_320),
            "worstvideo[height>=144]+worstaudio/worst[height>=144]/worst"
        );
        assert_eq!(
            video_format_selector("height", 720),
            "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
        );
    }

    #[test]
    fn moves_downloads_to_unique_names_in_destination() {
        let root = std::env::temp_dir().join(format!("editor-ia-move-{}", Uuid::new_v4()));
        let source = root.join("cache");
        let destination = root.join("downloads");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        let original = source.join("video.mp4");
        std::fs::write(&original, b"new video").unwrap();
        std::fs::write(destination.join("video.mp4"), b"existing").unwrap();
        let mut outcome = DownloadOutcome {
            run_id: "run".to_owned(),
            directory: source.to_string_lossy().into_owned(),
            files: vec![DownloadedFile {
                path: original.to_string_lossy().into_owned(),
                name: "video.mp4".to_owned(),
                bytes: 9,
                kind: "video".to_owned(),
            }],
            compressed: false,
            warnings: Vec::new(),
        };
        move_download_to(&mut outcome, &destination).unwrap();
        assert_eq!(outcome.directory, destination.to_string_lossy());
        assert!(destination.join("video (2).mp4").is_file());
        assert!(!original.exists());
        assert_eq!(outcome.files[0].name, "video (2).mp4");
        assert_eq!(outcome.files[0].bytes, 9);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn verifies_engine_checksum_format() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let sums = "aaaa  other.zip\nBBBB *yt-dlp.exe\ncccc  yt-dlp\n";
        assert_eq!(expected_engine_hash(sums).as_deref(), Some("bbbb"));
        assert!(expected_engine_hash("nada").is_none());
    }

    #[test]
    fn validates_optional_cookies_file() {
        assert!(validate_cookies_file(None).unwrap().is_none());
        assert!(validate_cookies_file(Some("  ")).unwrap().is_none());
        assert!(validate_cookies_file(Some("C:/no/existe/cookies.txt")).is_err());
        let file = std::env::temp_dir().join(format!("editor-ia-cookies-{}.txt", Uuid::new_v4()));
        std::fs::write(&file, "# Netscape HTTP Cookie File\n").unwrap();
        assert!(validate_cookies_file(Some(&file.to_string_lossy())).is_ok());
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn parses_download_percentages() {
        assert_eq!(
            parse_progress_percent("[download]  42.7% of 1.2GiB"),
            Some(42.7)
        );
        assert_eq!(
            parse_progress_percent("[download]   0.0% of ~ 10MiB"),
            Some(0.0)
        );
        assert_eq!(parse_progress_percent("Destination: video.mp4"), None);
    }

    #[test]
    fn builds_height_options_and_estimates() {
        let formats = serde_json::json!([
            { "format_id": "a", "height": 2160, "width": 3840, "fps": 60, "ext": "mp4", "vcodec": "avc1", "acodec": "none", "tbr": 20000.0 },
            { "format_id": "b", "height": 1080, "width": 1920, "fps": 30, "ext": "webm", "vcodec": "vp9", "acodec": "none", "filesize": 100000000u64 },
            { "format_id": "c", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "filesize": 10000000u64 }
        ]);
        let (qualities, max_height) =
            qualities_from_formats(formats.as_array().unwrap(), 600.0, true);
        assert_eq!(max_height, Some(2160));
        assert_eq!(qualities.len(), 2);
        assert_eq!(qualities[0].label, "2160p · 4K");
        assert!(qualities[0].filesize.unwrap() > 100_000_000);
        assert_eq!(qualities[1].height, 1080);
    }

    #[test]
    fn gallery_probes_multiple_entries() {
        let value = serde_json::json!({
            "_type": "playlist",
            "title": "Post con fotos",
            "entries": [
                { "ext": "jpg", "vcodec": "none", "acodec": "none", "filesize": 1000u64 },
                { "ext": "jpg", "vcodec": "none", "acodec": "none", "filesize": 2000u64 }
            ]
        });
        let probe = probe_value("https://example.com/post".to_owned(), &value).unwrap();
        assert_eq!(probe.kind, "gallery");
        assert_eq!(probe.entry_count, 2);
        assert_eq!(probe.estimated_bytes, Some(3000));
    }

    fn live_engine() -> Option<PathBuf> {
        let base = std::env::var_os("APPDATA").map(PathBuf::from)?;
        let engine = base
            .join("com.editoria.desktop")
            .join("tools")
            .join("yt-dlp.exe");
        engine.is_file().then_some(engine)
    }

    #[test]
    #[ignore = "requiere red y el motor yt-dlp instalado"]
    fn live_probe_and_download_public_video() {
        let Some(engine) = live_engine() else {
            return;
        };
        let probe = probe_with_engine(&engine, "https://www.youtube.com/watch?v=aqz-KE-bpKQ", None)
            .unwrap();
        assert_eq!(probe.kind, "video");
        assert!(!probe.title.is_empty());
        assert!(!probe.qualities.is_empty());
        let cache = std::env::temp_dir().join(format!("editor-ia-dl-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&cache).unwrap();
        let request = DownloadRequest {
            url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ".to_owned(),
            max_height: Some(360),
            compression: Some("compact".to_owned()),
            codec: Some("h264".to_owned()),
            kind: Some("video".to_owned()),
            playlist: Some(false),
            cookies_file: None,
            format: Some("mp4".to_owned()),
            save_to_downloads: None,
            quality: None,
            destination_root: None,
        };
        let progress = |_stage: &str, _percent: Option<f64>, _message: &str| {};
        let outcome = download_blocking(
            &progress,
            &engine,
            &cache,
            request,
            Some(PathBuf::from("ffmpeg")),
            Some(PathBuf::from("ffprobe")),
            None,
        )
        .unwrap();
        assert!(!outcome.files.is_empty());
        assert!(outcome
            .files
            .iter()
            .all(|file| Path::new(&file.path).is_file()));
        assert!(outcome.files.iter().all(|file| file.bytes > 0));
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[test]
    fn oversized_galleries_are_refused() {
        let entries = (0..13)
            .map(|_| serde_json::json!({ "ext": "jpg", "vcodec": "none", "acodec": "none" }))
            .collect::<Vec<_>>();
        let value =
            serde_json::json!({ "_type": "playlist", "title": "Canal", "entries": entries });
        assert!(probe_value("https://example.com/canal".to_owned(), &value).is_err());
    }
}
