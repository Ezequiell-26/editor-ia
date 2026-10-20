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
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
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

fn engine_version(engine: &Path) -> Option<String> {
    let output = Command::new(engine)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
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

fn resolve_engine(config_dir: &Path) -> Result<PathBuf, ProjectError> {
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

#[tauri::command]
pub fn downloader_status(state: State<'_, AppState>) -> DownloaderStatus {
    status_from_config(&state.config_dir)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[tauri::command]
pub async fn install_downloader(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DownloaderStatus, ProjectError> {
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
    let expected = sums
        .lines()
        .find_map(|line| {
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

fn validate_url(raw: &str) -> Result<String, ProjectError> {
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

fn is_youtube_host(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    host == "youtu.be"
        || host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
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
) -> Result<DownloadProbe, ProjectError> {
    emit_progress(app, "probing", None, "Consultando la URL…");
    probe_with_engine(engine, url)
}

fn probe_with_engine(engine: &Path, url: &str) -> Result<DownloadProbe, ProjectError> {
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
    command.arg(url);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
) -> Result<DownloadProbe, ProjectError> {
    let validated = validate_url(&url)?;
    let engine = resolve_engine(&state.config_dir)?;
    tauri::async_runtime::spawn_blocking(move || probe_blocking(&app, &engine, &validated))
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
    let output = Command::new(ffprobe)
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
        .stdin(Stdio::null())
        .output()
        .ok()?;
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

type ProgressSink<'a> = &'a dyn Fn(&str, Option<f64>, &str);

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

fn download_blocking(
    progress: ProgressSink<'_>,
    engine: &Path,
    cache_dir: &Path,
    request: DownloadRequest,
    ffmpeg: Option<PathBuf>,
    ffprobe: Option<PathBuf>,
) -> Result<DownloadOutcome, ProjectError> {
    let validated = validate_url(&request.url)?;
    let kind = request.kind.as_deref().unwrap_or("video");
    if !matches!(kind, "video" | "image" | "audio" | "gallery") {
        return Err(invalid_error("El tipo de descarga no es válido."));
    }
    let compression = request.compression.as_deref().unwrap_or("none");
    let crf = match compression {
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
    if crf.is_some() && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede comprimir. Elegí «Original» o configurá FFmpeg en Ajustes.",
        ));
    }
    let run_id = Uuid::new_v4().to_string();
    let directory = cache_dir.join("downloads").join(&run_id);
    std::fs::create_dir_all(&directory)
        .map_err(|_| io_error("No se pudo crear la carpeta temporal de descarga."))?;
    let output_template = directory
        .join("%(title).120s [%(id)s].%(ext)s")
        .to_string_lossy()
        .into_owned();
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
    if kind == "video" {
        command.arg("-f").arg(format!(
            "bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best"
        ));
        command.args(["--merge-output-format", "mp4"]);
    } else if kind == "audio" {
        command.args(["-f", "bestaudio/best"]);
    }
    command.arg("-o").arg(&output_template);
    command.arg(&validated);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
    let request = DownloadRequest { url, ..request };
    let progress_app = app.clone();
    let progress = move |stage: &str, percent: Option<f64>, message: &str| {
        emit_progress(&progress_app, stage, percent, message.to_owned());
    };
    tauri::async_runtime::spawn_blocking(move || {
        download_blocking(&progress, &engine, &cache_dir, request, ffmpeg, ffprobe)
    })
    .await
    .map_err(|_| provider_error("La descarga se interrumpió."))?
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
        let probe =
            probe_with_engine(&engine, "https://www.youtube.com/watch?v=BaW_jenozKc").unwrap();
        assert_eq!(probe.kind, "video");
        assert!(!probe.title.is_empty());
        assert!(!probe.qualities.is_empty());
        let cache = std::env::temp_dir().join(format!("editor-ia-dl-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&cache).unwrap();
        let request = DownloadRequest {
            url: "https://www.youtube.com/watch?v=BaW_jenozKc".to_owned(),
            max_height: Some(360),
            compression: Some("compact".to_owned()),
            codec: Some("h264".to_owned()),
            kind: Some("video".to_owned()),
            playlist: Some(false),
        };
        let progress = |_stage: &str, _percent: Option<f64>, _message: &str| {};
        let outcome = download_blocking(
            &progress,
            &engine,
            &cache,
            request,
            Some(PathBuf::from("ffmpeg")),
            Some(PathBuf::from("ffprobe")),
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
