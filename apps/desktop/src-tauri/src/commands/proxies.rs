//! Fase 1 · proxies de vista previa.
//!
//! Contrato frontend (camelCase, ver `ProxyStatus` en `services/project-service.ts`):
//! - `proxy_status(assetId)` → ProxyStatus (nunca genera)
//! - `ensure_proxy(assetId, quality?)` → ProxyStatus (arranca en background)
//! - `cancel_proxy(assetId)` → ProxyStatus
//! - `cleanup_proxies(assetId?)` → { removed, bytesFreed }
//! - evento `proxy-progress` con `{ assetId, quality, state, percent, phase }`
//!
//! El proxy es un MP4 H.264/AAC de 960×540 o 1280×720 en
//! `<root>/media/proxies/proxy-<assetId>-<quality>-<mtimeMs>-<bytes>.mp4`.
//! La huella (mtime+bytes) en el nombre es la invalidación de caché: si el
//! origen cambia, el proxy viejo queda `upToDate: false` y se regenera.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::commands::audio::{hardware_h264, proxy_video_args};
use crate::commands::system::resolve_tools;
use crate::media::{probe_file, resolve_inside_root, MediaKind};
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::state::AppState;

const PROXY_DIR: &str = "media/proxies";
const MAX_BUCKETS_NOTE: &str = "";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub asset_id: String,
    pub state: String,
    pub quality: Option<String>,
    pub path: Option<String>,
    pub exists: bool,
    pub up_to_date: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: Option<u64>,
    pub duration_seconds: Option<f64>,
    pub percent: f64,
    pub phase: String,
    pub error: Option<String>,
    pub source_mtime_ms: Option<u64>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProgressEvent {
    pub asset_id: String,
    pub quality: String,
    pub state: String,
    pub percent: f64,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyCleanupResult {
    pub removed: u64,
    pub bytes_freed: u64,
}

struct Runtime {
    cancelled: Arc<AtomicBool>,
    status: ProxyStatus,
}

static RUNTIMES: OnceLock<Mutex<HashMap<String, Runtime>>> = OnceLock::new();

fn runtimes() -> &'static Mutex<HashMap<String, Runtime>> {
    RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn normalized(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn fingerprint(path: &Path) -> Option<(u64, u64)> {
    let metadata = std::fs::metadata(path).ok()?;
    let mtime = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((mtime, metadata.len()))
}

fn parse_quality(value: &str) -> Option<&'static str> {
    match value {
        "540p" => Some("540p"),
        "720p" => Some("720p"),
        _ => None,
    }
}

fn scale_for(quality: &str) -> (&'static str, u32, u32) {
    if quality == "720p" {
        ("scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", 1280, 720)
    } else {
        ("scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", 960, 540)
    }
}

/// Nombre canónico del proxy; el orden lo fija el contrato del backend.
fn proxy_file_name(asset_id: &str, quality: &str, mtime_ms: u64, bytes: u64) -> String {
    format!("proxy-{asset_id}-{quality}-{mtime_ms}-{bytes}.mp4")
}

/// (quality, mtime, bytes) desde el nombre, o None si no es un proxy nuestro.
fn parse_proxy_name(name: &str) -> Option<(String, u64, u64)> {
    let stem = name.strip_suffix(".mp4")?;
    let mut parts = stem.rsplitn(4, '-');
    let bytes = parts.next()?.parse::<u64>().ok()?;
    let mtime = parts.next()?.parse::<u64>().ok()?;
    let quality = parse_quality(parts.next()?)?;
    Some((quality.to_owned(), mtime, bytes))
}

struct ResolvedAsset {
    root: PathBuf,
    source: PathBuf,
    mtime_ms: u64,
    bytes: u64,
    kind: String,
}

fn resolve_asset(state: &AppState, asset_id: &str) -> Result<ResolvedAsset, ProjectError> {
    let session = state.require_session()?;
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id))
        })
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el medio no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("").to_owned();
    if kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "sólo los videos pueden tener proxy de vista previa",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let source = resolve_inside_root(&session.root, relative)?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del proxy no está en disco",
        ));
    }
    let (mtime_ms, bytes) = fingerprint(&source).ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo leer la huella del video")
    })?;
    Ok(ResolvedAsset {
        root: session.root,
        source,
        mtime_ms,
        bytes,
        kind,
    })
}

struct ExistingProxy {
    file: PathBuf,
    quality: String,
    mtime_ms: u64,
    bytes: u64,
    up_to_date: bool,
}

fn existing_proxy(root: &Path, asset_id: &str, mtime_ms: u64, bytes: u64) -> Option<ExistingProxy> {
    let directory = root.join(PROXY_DIR.replace('/', "\\"));
    let entries = std::fs::read_dir(&directory).ok()?;
    let prefix = format!("proxy-{asset_id}-");
    let mut best: Option<ExistingProxy> = None;
    for entry in entries.filter_map(Result::ok) {
        let file = entry.path();
        let name = match file.file_name().and_then(|value| value.to_str()) {
            Some(name) if name.starts_with(&prefix) => name.to_owned(),
            _ => continue,
        };
        let Some((quality, file_mtime, file_bytes)) = parse_proxy_name(&name) else {
            continue;
        };
        // Prefiere el proxy cuya huella coincide; si no, deja el más reciente.
        let candidate = ExistingProxy {
            file,
            quality,
            mtime_ms: file_mtime,
            bytes: file_bytes,
            up_to_date: file_mtime == mtime_ms && file_bytes == bytes,
        };
        let replace = match &best {
            None => true,
            Some(current) => {
                (!current.up_to_date && candidate.up_to_date)
                    || (current.up_to_date == candidate.up_to_date
                        && candidate.mtime_ms > current.mtime_ms)
            }
        };
        if replace {
            best = Some(candidate);
        }
    }
    best
}

fn empty_status(asset_id: &str) -> ProxyStatus {
    ProxyStatus {
        asset_id: asset_id.to_owned(),
        state: "missing".to_owned(),
        quality: None,
        path: None,
        exists: false,
        up_to_date: false,
        width: None,
        height: None,
        bytes: None,
        duration_seconds: None,
        percent: 0.0,
        phase: "missing".to_owned(),
        error: None,
        source_mtime_ms: None,
        updated_at_ms: now_ms(),
    }
}

fn runtime_status(asset_id: &str) -> Option<ProxyStatus> {
    runtimes()
        .lock()
        .ok()
        .and_then(|map| map.get(asset_id).map(|runtime| runtime.status.clone()))
}

fn current_status(state: &AppState, asset_id: &str) -> Result<ProxyStatus, ProjectError> {
    if let Some(status) = runtime_status(asset_id) {
        // Un job terminado queda en el mapa hasta el próximo status: si ya no
        // está generando, se recalcula desde el disco.
        if status.state == "queued" || status.state == "generating" {
            return Ok(status);
        }
    }
    let asset = resolve_asset(state, asset_id)?;
    let Some(existing) = existing_proxy(&asset.root, asset_id, asset.mtime_ms, asset.bytes) else {
        return Ok(empty_status(asset_id));
    };
    let relative = existing
        .file
        .strip_prefix(&asset.root)
        .map(normalized)
        .unwrap_or_else(|_| normalized(&existing.file));
    let metadata = std::fs::metadata(&existing.file).ok();
    Ok(ProxyStatus {
        asset_id: asset_id.to_owned(),
        state: "ready".to_owned(),
        quality: Some(existing.quality.clone()),
        path: Some(relative),
        exists: true,
        up_to_date: existing.up_to_date,
        width: None,
        height: None,
        bytes: metadata.map(|value| value.len()),
        duration_seconds: None,
        percent: 100.0,
        phase: "ready".to_owned(),
        error: None,
        source_mtime_ms: Some(asset.mtime_ms),
        updated_at_ms: now_ms(),
    })
}

fn publish(app: &AppHandle, status: &ProxyStatus) {
    if let Ok(mut map) = runtimes().lock() {
        let cancelled = map
            .get(&status.asset_id)
            .map(|runtime| runtime.cancelled.clone())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        map.insert(
            status.asset_id.clone(),
            Runtime {
                cancelled,
                status: status.clone(),
            },
        );
    }
    let _ = app.emit(
        "proxy-progress",
        ProxyProgressEvent {
            asset_id: status.asset_id.clone(),
            quality: status.quality.clone().unwrap_or_else(|| "540p".to_owned()),
            state: status.state.clone(),
            percent: status.percent,
            phase: status.phase.clone(),
        },
    );
}

fn finish_runtime(app: &AppHandle, status: ProxyStatus, cancel_flag: Arc<AtomicBool>) {
    if let Ok(mut map) = runtimes().lock() {
        map.insert(
            status.asset_id.clone(),
            Runtime {
                cancelled: cancel_flag,
                status: status.clone(),
            },
        );
    }
    let _ = app.emit(
        "proxy-progress",
        ProxyProgressEvent {
            asset_id: status.asset_id.clone(),
            quality: status.quality.clone().unwrap_or_else(|| "540p".to_owned()),
            state: status.state.clone(),
            percent: status.percent,
            phase: status.phase.clone(),
        },
    );
}

#[tauri::command]
pub async fn proxy_status(
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<ProxyStatus, ProjectError> {
    current_status(&state, &asset_id)
}

#[tauri::command]
pub async fn ensure_proxy(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
    quality: Option<String>,
) -> Result<ProxyStatus, ProjectError> {
    let quality = quality
        .as_deref()
        .and_then(parse_quality)
        .unwrap_or("540p")
        .to_owned();
    if let Some(status) = runtime_status(&asset_id) {
        if status.state == "queued" || status.state == "generating" {
            return Ok(status);
        }
    }
    let asset = resolve_asset(&state, &asset_id)?;
    if let Some(existing) = existing_proxy(&asset.root, &asset_id, asset.mtime_ms, asset.bytes) {
        if existing.up_to_date {
            return current_status(&state, &asset_id);
        }
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para generar un proxy",
        ));
    };
    let directory = asset.root.join(PROXY_DIR.replace('/', "\\"));
    std::fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/proxies")
    })?;
    let target = directory.join(proxy_file_name(
        &asset_id,
        &quality,
        asset.mtime_ms,
        asset.bytes,
    ));
    let cancelled = Arc::new(AtomicBool::new(false));
    let queued = ProxyStatus {
        asset_id: asset_id.clone(),
        state: "queued".to_owned(),
        quality: Some(quality.clone()),
        path: Some(normalized(
            &target.strip_prefix(&asset.root).unwrap_or(&target),
        )),
        exists: false,
        up_to_date: false,
        width: None,
        height: None,
        bytes: None,
        duration_seconds: None,
        percent: 0.0,
        phase: "queued".to_owned(),
        error: None,
        source_mtime_ms: Some(asset.mtime_ms),
        updated_at_ms: now_ms(),
    };
    if let Ok(mut map) = runtimes().lock() {
        map.insert(
            asset_id.clone(),
            Runtime {
                cancelled: cancelled.clone(),
                status: queued.clone(),
            },
        );
    }
    let _ = app.emit(
        "proxy-progress",
        ProxyProgressEvent {
            asset_id: asset_id.clone(),
            quality: quality.clone(),
            state: "queued".to_owned(),
            percent: 0.0,
            phase: "queued".to_owned(),
        },
    );
    let thread_app = app.clone();
    let thread_id = asset_id.clone();
    std::thread::spawn(move || {
        generate_proxy(
            thread_app,
            thread_id,
            asset_id,
            asset.root,
            asset.source,
            quality,
            target,
            ffmpeg,
            ffprobe,
            cancelled,
        );
    });
    Ok(queued)
}

fn generate_proxy(
    app: AppHandle,
    thread_id: String,
    asset_id: String,
    root: PathBuf,
    source: PathBuf,
    quality: String,
    target: PathBuf,
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    cancelled: Arc<AtomicBool>,
) {
    let _ = thread_id;
    let temporary = target.with_file_name(format!(
        "{}.part.mp4",
        target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("proxy")
    ));
    let (filter, max_width, max_height) = scale_for(&quality);
    let _ = (max_width, max_height);
    let hardware = hardware_h264(&ffmpeg);
    let mut command = std::process::Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-nostats")
        .arg("-y")
        .arg("-progress")
        .arg("pipe:1")
        .arg("-i")
        .arg(&source)
        .args(["-map", "0:v:0", "-map", "0:a?"])
        .args(["-vf", filter])
        .args(proxy_video_args(hardware.as_deref()))
        .args(["-c:a", "aac", "-b:a", "96000", "-movflags", "+faststart"])
        .arg(&temporary)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    crate::commands::hide_console(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let mut status = empty_status(&asset_id);
            status.state = "failed".to_owned();
            status.quality = Some(quality.clone());
            status.error = Some(format!("no se pudo iniciar FFmpeg: {error}"));
            finish_runtime(&app, status, cancelled);
            return;
        }
    };
    let stderr_tail: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    if let Some(mut stderr) = child.stderr.take() {
        let buffer = stderr_tail.clone();
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            if let Ok(mut guard) = buffer.lock() {
                let start = text.len().saturating_sub(600);
                *guard = text[start..].to_owned();
            }
        });
    }
    let duration = probe_file(&ffprobe, &source, MediaKind::Video)
        .ok()
        .and_then(|measure| measure.duration_seconds)
        .unwrap_or(0.0);
    let mut last_emit = SystemTime::now();
    let mut status = empty_status(&asset_id);
    status.state = "generating".to_owned();
    status.quality = Some(quality.clone());
    status.path = Some(
        target
            .strip_prefix(&root)
            .map(normalized)
            .unwrap_or_else(|_| normalized(&target)),
    );
    status.phase = "encoding".to_owned();
    publish(&app, &status);
    let mut last_percent = -1.0f64;
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if cancelled.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&temporary);
                status.state = "cancelled".to_owned();
                status.phase = "cancelled".to_owned();
                status.percent = 0.0;
                finish_runtime(&app, status, cancelled);
                return;
            }
            let Some(raw) = line.strip_prefix("out_time_us=") else {
                continue;
            };
            let Ok(micros) = raw.trim().parse::<f64>() else {
                continue;
            };
            if duration <= 0.0 {
                continue;
            }
            let percent = (micros / 1_000_000.0 / duration * 100.0).clamp(0.0, 99.0);
            let elapsed = SystemTime::now()
                .duration_since(last_emit)
                .unwrap_or_default();
            if percent - last_percent < 2.0 && elapsed < Duration::from_millis(500) {
                continue;
            }
            last_percent = percent;
            last_emit = SystemTime::now();
            status.percent = (percent * 10.0).round() / 10.0;
            publish(&app, &status);
        }
    }
    let exit = child.wait();
    if cancelled.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&temporary);
        status.state = "cancelled".to_owned();
        status.phase = "cancelled".to_owned();
        status.percent = 0.0;
        finish_runtime(&app, status, cancelled);
        return;
    }
    let ok = exit.map(|value| value.success()).unwrap_or(false) && temporary.is_file();
    if !ok {
        let _ = std::fs::remove_file(&temporary);
        status.state = "failed".to_owned();
        status.phase = "failed".to_owned();
        let detail = stderr_tail
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default();
        status.error = Some(if detail.trim().is_empty() {
            "FFmpeg no pudo generar el proxy".to_owned()
        } else {
            format!("FFmpeg no pudo generar el proxy: {detail}")
        });
        finish_runtime(&app, status, cancelled);
        return;
    }
    status.phase = "verifying".to_owned();
    status.percent = 99.0;
    publish(&app, &status);
    let measure = probe_file(&ffprobe, &temporary, MediaKind::Video);
    let verified = measure
        .as_ref()
        .map(|measure| measure.width.is_some() && measure.height.is_some())
        .unwrap_or(false);
    if !verified {
        let _ = std::fs::remove_file(&temporary);
        status.state = "failed".to_owned();
        status.phase = "failed".to_owned();
        status.error = Some("FFprobe no pudo leer el proxy generado".to_owned());
        finish_runtime(&app, status, cancelled);
        return;
    }
    if std::fs::rename(&temporary, &target).is_err() {
        let _ = std::fs::remove_file(&temporary);
        status.state = "failed".to_owned();
        status.phase = "failed".to_owned();
        status.error = Some("no se pudo mover el proxy al cache".to_owned());
        finish_runtime(&app, status, cancelled);
        return;
    }
    let measure = measure.ok();
    status.state = "ready".to_owned();
    status.phase = "ready".to_owned();
    status.exists = true;
    status.up_to_date = true;
    status.percent = 100.0;
    status.width = measure.as_ref().and_then(|measure| measure.width);
    status.height = measure.as_ref().and_then(|measure| measure.height);
    status.duration_seconds = measure
        .as_ref()
        .and_then(|measure| measure.duration_seconds);
    status.bytes = std::fs::metadata(&target).ok().map(|meta| meta.len());
    finish_runtime(&app, status, cancelled);
}

#[tauri::command]
pub async fn cancel_proxy(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<ProxyStatus, ProjectError> {
    let mut cancelled_status = None;
    if let Ok(mut map) = runtimes().lock() {
        if let Some(runtime) = map.get(&asset_id) {
            runtime.cancelled.store(true, Ordering::SeqCst);
            let mut status = runtime.status.clone();
            status.state = "cancelled".to_owned();
            status.phase = "cancelled".to_owned();
            status.percent = 0.0;
            cancelled_status = Some(status);
        }
    }
    if let Some(status) = cancelled_status {
        let _ = app.emit(
            "proxy-progress",
            ProxyProgressEvent {
                asset_id: asset_id.clone(),
                quality: status.quality.clone().unwrap_or_else(|| "540p".to_owned()),
                state: status.state.clone(),
                percent: 0.0,
                phase: status.phase.clone(),
            },
        );
        return Ok(status);
    }
    current_status(&state, &asset_id)
}

#[tauri::command]
pub async fn apply_proxy_to_asset(
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<Option<Value>, ProjectError> {
    let status = current_status(&state, &asset_id)?;
    if status.state != "ready" || !status.exists || !status.up_to_date {
        return Ok(None);
    }
    let Some(relative) = status.path.clone() else {
        return Ok(None);
    };
    let session = state.require_session()?;
    let proxy_file = resolve_inside_root(&session.root, &relative)?;
    if !proxy_file.is_file() {
        return Ok(None);
    }
    let settings = state.settings_snapshot()?;
    let (_ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe no está configurado para validar el proxy",
        ));
    };
    let measure = probe_file(&ffprobe, &proxy_file, MediaKind::Video)?;
    let (Some(width), Some(height)) = (measure.width, measure.height) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el proxy no tiene dimensiones legibles",
        ));
    };
    let bytes = std::fs::metadata(&proxy_file)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let mut opened = service::open_project(&session.path)?;
    let index = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .position(|asset| asset["id"].as_str() == Some(&asset_id))
        })
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el medio no está en el proyecto",
            )
        })?;
    let updated = {
        let asset = &mut opened.project["assets"][index];
        asset["proxy"] = serde_json::json!({
            "path": relative,
            "width": width,
            "height": height,
            "bytes": bytes,
        });
        asset.clone()
    };
    service::save_project(&session.path, &opened.project)?;
    Ok(Some(updated))
}

#[tauri::command]
pub async fn cleanup_proxies(
    state: State<'_, AppState>,
    asset_id: Option<String>,
) -> Result<ProxyCleanupResult, ProjectError> {
    let session = state.require_session()?;
    let directory = session.root.join(PROXY_DIR.replace('/', "\\"));
    let entries = match std::fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(_) => {
            return Ok(ProxyCleanupResult {
                removed: 0,
                bytes_freed: 0,
            })
        }
    };
    let keep_prefix = asset_id.as_deref().map(|id| format!("proxy-{id}-"));
    let mut removed = 0u64;
    let mut bytes_freed = 0u64;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_owned();
        if !name.starts_with("proxy-") || !name.ends_with(".mp4") {
            continue;
        }
        if let Some(prefix) = keep_prefix.as_deref() {
            if !name.starts_with(prefix) {
                continue;
            }
        }
        let bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        if std::fs::remove_file(&path).is_ok() {
            removed += 1;
            bytes_freed += bytes;
        }
    }
    let _ = MAX_BUCKETS_NOTE;
    Ok(ProxyCleanupResult {
        removed,
        bytes_freed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nombre_y_parseo_de_proxy() {
        let name = proxy_file_name("11111111-2222-4333-8444-555555555555", "720p", 100, 200);
        assert_eq!(
            name,
            "proxy-11111111-2222-4333-8444-555555555555-720p-100-200.mp4"
        );
        let parsed = parse_proxy_name(&name).expect("parsea");
        assert_eq!(parsed.0, "720p");
        assert_eq!(parsed.1, 100);
        assert_eq!(parsed.2, 200);
        assert!(parse_proxy_name("otro.mp4").is_none());
        assert!(parse_proxy_name(&name.replace("720p", "999p")).is_none());
    }

    #[test]
    fn calidad_y_escala_estan_acotadas() {
        assert_eq!(parse_quality("540p"), Some("540p"));
        assert_eq!(parse_quality("1080p"), None);
        let (filter, width, height) = scale_for("720p");
        assert!(filter.contains("1280"));
        assert_eq!((width, height), (1280, 720));
        let (filter, width, height) = scale_for("540p");
        assert!(filter.contains("960"));
        assert_eq!((width, height), (960, 540));
    }

    #[test]
    fn la_huella_del_origen_se_lee_del_nombre() {
        let name = proxy_file_name("a", "540p", 1_700_000_000_000, 42);
        let (quality, mtime, bytes) = parse_proxy_name(&name).expect("parsea");
        assert_eq!(quality, "540p");
        assert_eq!(mtime, 1_700_000_000_000);
        assert_eq!(bytes, 42);
    }
}
