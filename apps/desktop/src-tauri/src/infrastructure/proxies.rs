//! Adaptadores de infraestructura para proxies de vista previa.
//!
//! - `LocalProxyRuntime`: registro en memoria de jobs por asset (flag de
//!   cancelación + último estado publicado).
//! - `LocalProxyFiles`: cache `media/proxies` en disco.
//! - `TauriProxyEvents`: publica `proxy-progress` hacia la ventana.
//! - `StdioProxyGenerator`: worker FFmpeg con `-progress pipe:1`, cola de
//!   stderr y cancelación — el mismo patrón de ciclo de vida que usarán el
//!   render y la conversión sobre el port de Jobs unificado.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter};

use crate::media::proxy::{
    self, normalized, parse_proxy_name, progress_percent_from_line, proxy_video_args, scale_for,
    ExistingProxy, ProxyCleanupResult, ProxyProgressEvent, ProxyStatus, PROXY_DIR,
};
use crate::media::{probe_file, MediaKind};
use crate::ports::proxies::{
    ProxyEvents, ProxyFileEntry, ProxyFiles, ProxyGenerator, ProxyJob, ProxyRuntime,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::hardware_h264;

struct RuntimeEntry {
    cancelled: Arc<AtomicBool>,
    status: ProxyStatus,
}

static RUNTIMES: OnceLock<Mutex<HashMap<String, RuntimeEntry>>> = OnceLock::new();

fn runtimes() -> &'static Mutex<HashMap<String, RuntimeEntry>> {
    RUNTIMES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registro global de jobs de proxy (uno por asset).
pub struct LocalProxyRuntime;

impl ProxyRuntime for LocalProxyRuntime {
    fn status(&self, asset_id: &str) -> Option<ProxyStatus> {
        runtimes()
            .lock()
            .ok()
            .and_then(|map| map.get(asset_id).map(|entry| entry.status.clone()))
    }

    fn flag(&self, asset_id: &str) -> Option<Arc<AtomicBool>> {
        runtimes()
            .lock()
            .ok()
            .and_then(|map| map.get(asset_id).map(|entry| entry.cancelled.clone()))
    }

    fn begin(&self, asset_id: &str, status: ProxyStatus) -> Arc<AtomicBool> {
        let cancelled = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = runtimes().lock() {
            map.insert(
                asset_id.to_owned(),
                RuntimeEntry {
                    cancelled: cancelled.clone(),
                    status,
                },
            );
        }
        cancelled
    }

    fn update(&self, asset_id: &str, status: ProxyStatus) {
        if let Ok(mut map) = runtimes().lock() {
            let cancelled = map
                .get(asset_id)
                .map(|entry| entry.cancelled.clone())
                .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
            map.insert(asset_id.to_owned(), RuntimeEntry { cancelled, status });
        }
    }
}

/// Filesystem local del cache de proxies.
pub struct LocalProxyFiles;

impl ProxyFiles for LocalProxyFiles {
    fn ensure_dir(&self, dir: &Path) -> Result<(), ProjectError> {
        std::fs::create_dir_all(dir).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/proxies")
        })
    }

    fn fingerprint(&self, path: &Path) -> Option<(u64, u64)> {
        let metadata = std::fs::metadata(path).ok()?;
        let mtime = metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_millis() as u64;
        Some((mtime, metadata.len()))
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn file_len(&self, path: &Path) -> Option<u64> {
        std::fs::metadata(path).ok().map(|meta| meta.len())
    }

    fn candidates(
        &self,
        root: &Path,
        asset_id: &str,
        source_mtime_ms: u64,
        source_bytes: u64,
    ) -> Vec<ExistingProxy> {
        let directory = root.join(PROXY_DIR.replace('/', "\\"));
        let Ok(entries) = std::fs::read_dir(&directory) else {
            return Vec::new();
        };
        let prefix = format!("proxy-{asset_id}-");
        let mut out = Vec::new();
        for entry in entries.filter_map(Result::ok) {
            let file = entry.path();
            let Some(name) = file.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !name.starts_with(&prefix) {
                continue;
            }
            let Some((quality, mtime, bytes)) = parse_proxy_name(name) else {
                continue;
            };
            out.push(ExistingProxy {
                file,
                quality,
                mtime_ms: mtime,
                up_to_date: mtime == source_mtime_ms && bytes == source_bytes,
            });
        }
        out
    }

    fn remove_file(&self, path: &Path) -> bool {
        std::fs::remove_file(path).is_ok()
    }

    fn rename(&self, from: &Path, to: &Path) -> bool {
        std::fs::rename(from, to).is_ok()
    }

    fn cleanup(&self, root: &Path, asset_id: Option<&str>) -> ProxyCleanupResult {
        let directory = root.join(PROXY_DIR.replace('/', "\\"));
        let Ok(entries) = std::fs::read_dir(&directory) else {
            return ProxyCleanupResult {
                removed: 0,
                bytes_freed: 0,
            };
        };
        let keep_prefix = asset_id.map(|id| format!("proxy-{id}-"));
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
        ProxyCleanupResult {
            removed,
            bytes_freed,
        }
    }
    fn proxy_entries(&self, root: &Path) -> Vec<ProxyFileEntry> {
        let directory = root.join(PROXY_DIR.replace('/', "\\"));
        let Ok(entries) = std::fs::read_dir(&directory) else {
            return Vec::new();
        };
        entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                if !path.is_file() {
                    return None;
                }
                let name = path.file_name()?.to_str()?.to_owned();
                let bytes = entry.metadata().ok()?.len();
                Some(ProxyFileEntry { path, name, bytes })
            })
            .collect()
    }
}

/// Eventos `proxy-progress` hacia la ventana de Tauri.
pub struct TauriProxyEvents {
    app: AppHandle,
}

impl TauriProxyEvents {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

fn event_from_status(status: &ProxyStatus) -> ProxyProgressEvent {
    ProxyProgressEvent {
        asset_id: status.asset_id.clone(),
        quality: status
            .quality
            .clone()
            .unwrap_or_else(|| proxy::DEFAULT_QUALITY.to_owned()),
        state: status.state.clone(),
        percent: status.percent,
        phase: status.phase.clone(),
    }
}

impl ProxyEvents for TauriProxyEvents {
    fn progress(&self, event: ProxyProgressEvent) {
        let _ = self.app.emit("proxy-progress", event);
    }
}

/// Worker FFmpeg de proxies: spawn con `-progress pipe:1`, lectura de
/// stdout/stderr en threads y publicación de estados por el runtime.
pub struct StdioProxyGenerator {
    runtime: Arc<dyn ProxyRuntime>,
    events: Arc<dyn ProxyEvents>,
    files: Arc<dyn ProxyFiles>,
}

impl StdioProxyGenerator {
    pub fn new(
        runtime: Arc<dyn ProxyRuntime>,
        events: Arc<dyn ProxyEvents>,
        files: Arc<dyn ProxyFiles>,
    ) -> Self {
        Self {
            runtime,
            events,
            files,
        }
    }
}

impl ProxyGenerator for StdioProxyGenerator {
    fn generate(&self, job: ProxyJob) {
        let runtime = self.runtime.clone();
        let events = self.events.clone();
        let files = self.files.clone();
        std::thread::spawn(move || run_proxy_job(job, runtime, events, files));
    }
}

fn report(runtime: &Arc<dyn ProxyRuntime>, events: &Arc<dyn ProxyEvents>, status: &ProxyStatus) {
    runtime.update(&status.asset_id, status.clone());
    events.progress(event_from_status(status));
}

fn run_proxy_job(
    job: ProxyJob,
    runtime: Arc<dyn ProxyRuntime>,
    events: Arc<dyn ProxyEvents>,
    files: Arc<dyn ProxyFiles>,
) {
    let ProxyJob {
        asset_id,
        quality,
        root,
        source,
        target,
        ffmpeg,
        ffprobe,
        cancelled,
    } = job;
    let temporary = target.with_file_name(format!(
        "{}.part.mp4",
        target
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("proxy")
    ));
    let (filter, _max_width, _max_height) = scale_for(&quality);
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
    crate::infrastructure::process::hide_console(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let mut status = proxy::empty_status(&asset_id);
            status.state = "failed".to_owned();
            status.quality = Some(quality.clone());
            status.error = Some(format!("no se pudo iniciar FFmpeg: {error}"));
            report(&runtime, &events, &status);
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
    let mut status = proxy::empty_status(&asset_id);
    status.state = "generating".to_owned();
    status.quality = Some(quality.clone());
    status.path = Some(
        target
            .strip_prefix(&root)
            .map(normalized)
            .unwrap_or_else(|_| normalized(&target)),
    );
    status.phase = "encoding".to_owned();
    report(&runtime, &events, &status);
    let mut last_percent = -1.0f64;
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if cancelled.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = files.remove_file(&temporary);
                status.state = "cancelled".to_owned();
                status.phase = "cancelled".to_owned();
                status.percent = 0.0;
                report(&runtime, &events, &status);
                return;
            }
            let Some(percent) = progress_percent_from_line(&line, duration) else {
                continue;
            };
            let elapsed = SystemTime::now()
                .duration_since(last_emit)
                .unwrap_or_default();
            if percent - last_percent < 2.0 && elapsed < Duration::from_millis(500) {
                continue;
            }
            last_percent = percent;
            last_emit = SystemTime::now();
            status.percent = (percent * 10.0).round() / 10.0;
            report(&runtime, &events, &status);
        }
    }
    let exit = child.wait();
    if cancelled.load(Ordering::SeqCst) {
        let _ = files.remove_file(&temporary);
        status.state = "cancelled".to_owned();
        status.phase = "cancelled".to_owned();
        status.percent = 0.0;
        report(&runtime, &events, &status);
        return;
    }
    let ok = exit.map(|value| value.success()).unwrap_or(false) && files.is_file(&temporary);
    if !ok {
        let _ = files.remove_file(&temporary);
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
        report(&runtime, &events, &status);
        return;
    }
    status.phase = "verifying".to_owned();
    status.percent = 99.0;
    report(&runtime, &events, &status);
    let measure = probe_file(&ffprobe, &temporary, MediaKind::Video);
    let verified = measure
        .as_ref()
        .map(|measure| measure.width.is_some() && measure.height.is_some())
        .unwrap_or(false);
    if !verified {
        let _ = files.remove_file(&temporary);
        status.state = "failed".to_owned();
        status.phase = "failed".to_owned();
        status.error = Some("FFprobe no pudo leer el proxy generado".to_owned());
        report(&runtime, &events, &status);
        return;
    }
    if !files.rename(&temporary, &target) {
        let _ = files.remove_file(&temporary);
        status.state = "failed".to_owned();
        status.phase = "failed".to_owned();
        status.error = Some("no se pudo mover el proxy al cache".to_owned());
        report(&runtime, &events, &status);
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
    status.bytes = files.file_len(&target);
    report(&runtime, &events, &status);
}
