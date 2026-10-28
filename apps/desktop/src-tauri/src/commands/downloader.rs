//! Social media downloader and post-download compression.
//!
//! The frontend never passes shell arguments: this module builds the yt-dlp and
//! FFmpeg argument vectors, validates the URL, caps galleries and verifies the
//! downloaded files before returning their paths. The engine is a separate
//! open-source executable; it is not bundled with Editor IA.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use md5::Md5;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::license::{check_download, check_parallel, LicenseTier};
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
pub struct SponsorSegment {
    pub category: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub action: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub index: usize,
    pub title: String,
    pub url: Option<String>,
    pub duration_seconds: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub format_id: String,
    pub language: Option<String>,
    pub ext: Option<String>,
    pub abr: Option<f64>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    /// UUID estable para reanudar un trabajo y reutilizar sus `.part`.
    pub run_id: Option<String>,
    pub max_height: Option<u32>,
    pub compression: Option<String>,
    pub codec: Option<String>,
    /// `tonemap` (SDR) o `preserve` (HDR 10-bit HEVC).
    pub hdr_mode: Option<String>,
    /// Objetivo de tamaño final en MB; calcula bitrate y reemplaza al CRF.
    pub target_size_mb: Option<u64>,
    /// Conserva el archivo original además del procesado.
    pub keep_original: Option<bool>,
    pub kind: Option<String>,
    pub playlist: Option<bool>,
    pub cookies_file: Option<String>,
    /// `chrome`, `edge`, `firefox`, `brave`, `chromium`, `opera` o `vivaldi`.
    pub cookies_from_browser: Option<String>,
    pub format: Option<String>,
    pub save_to_downloads: Option<bool>,
    pub quality: Option<String>,
    pub destination_root: Option<String>,
    /// Look cinematográfico 35 mm: 60 fps por flujo óptico, 0.98×, grano,
    /// zoom 4 %, espejo y reemplazo o eliminación del audio.
    pub cinematic: Option<bool>,
    pub cinematic_focus: Option<String>,
    pub replacement_audio: Option<String>,
    /// Pipeline automático post-descarga: denoise + cine + H.265 CRF 22,
    /// hash MD5 nuevo y limpieza del original, antes de mover a destino.
    pub auto_pipeline: Option<bool>,
    /// Trata la pista original: 1.02× con atempo y ruido rosa a -50 dB.
    pub audio_speed_noise: Option<bool>,
    /// Genera una narración con Piper y la usa como audio final.
    pub voice_pipeline: Option<bool>,
    pub voice_script: Option<String>,
    /// Superpone resources/watermark.png sobre el video procesado.
    pub watermark: Option<bool>,
    /// Parche `delogo` proporcional en una esquina para marcas de agua fijas.
    pub delogo: Option<bool>,
    /// `top-right`, `top-left`, `bottom-right` o `bottom-left`.
    pub delogo_corner: Option<String>,
    /// Rectángulo manual en fracciones 0–1 del canvas; reemplaza la esquina.
    pub delogo_rect: Option<DelogoManualRect>,
    /// Escalado Lanczos sólo si el origen queda por debajo del objetivo.
    pub upscale: Option<bool>,
    /// `auto` (1080p cortos / 4K largos), `1080` o `2160`.
    pub upscale_target: Option<String>,
    /// Enrutamiento automático por duración y palabras clave del título.
    pub auto_route: Option<bool>,
    pub source_title: Option<String>,
    pub source_duration: Option<f64>,
    /// Proxy HTTP/SOCKS para yt-dlp.
    pub proxy: Option<String>,
    /// Límite de bajada de yt-dlp (por ejemplo `8M` o `500K`).
    pub limit_rate: Option<String>,
    pub download_subtitles: Option<bool>,
    /// Lista de idiomas para `--sub-langs` (por ejemplo `es.*,en.*`).
    pub subtitle_langs: Option<String>,
    pub download_thumbnail: Option<bool>,
    pub download_chapters: Option<bool>,
    pub sponsorblock: Option<bool>,
    /// Categorías de SponsorBlock separadas por coma.
    pub sponsorblock_categories: Option<String>,
    /// Categorías que se marcan en el capítulo en vez de quitarse.
    pub sponsorblock_mark: Option<String>,
    /// Categorías cuyos tramos se silencian después de descargar.
    pub sponsorblock_mute: Option<String>,
    /// Plantilla de nombre; acepta {title}, {id}, {platform}, {height} y {date}.
    pub filename_template: Option<String>,
    /// Lista de elementos de playlist, por ejemplo `1-10` o `1,3,5`.
    pub playlist_items: Option<String>,
    /// Idioma de audio preferido (`es`, `en`, `pt-BR`) o `all`.
    pub audio_language: Option<String>,
    /// format_id de audio elegido tras el análisis.
    pub audio_format_id: Option<String>,
    /// Metadatos que se escriben al contenedor final.
    pub metadata_title: Option<String>,
    pub metadata_artist: Option<String>,
    pub metadata_comment: Option<String>,
    /// Imagen que se incrusta como carátula.
    pub cover_path: Option<String>,
    /// Calcula MD5 y SHA-256 de todos los archivos descargados.
    pub hash_files: Option<bool>,
    /// SHA-256 esperado; si ningún archivo coincide, la descarga se marca como error.
    pub expected_sha256: Option<String>,
    /// Recorte previo a la descarga en segundos.
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    /// Tamaño estimado que devolvió el probe, para el chequeo de disco.
    pub estimated_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedChapter {
    pub start_seconds: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedSubtitle {
    pub path: String,
    pub name: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub kind: String,
    /// MD5 del archivo final. Sólo se informa para videos procesados.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub md5: Option<String>,
    /// SHA-256 del archivo final; identifica el asset reencodeado completo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    /// Capítulos leídos con FFprobe después de mover el archivo.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub chapters: Vec<DownloadedChapter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub run_id: String,
    pub directory: String,
    pub files: Vec<DownloadedFile>,
    pub compressed: bool,
    pub warnings: Vec<String>,
    /// Subtítulos SRT/VTT leídos del destino para importarlos al proyecto.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub subtitles: Vec<DownloadedSubtitle>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    run_id: String,
    stage: String,
    percent: Option<f64>,
    message: String,
}

/// Control del proceso activo para pausa, reanudación y cancelación reales.
/// En Windows se suspende el árbol de yt-dlp/FFmpeg con NtSuspendProcess.
pub struct DownloadControl {
    pid: Mutex<Option<u32>>,
    paused: AtomicBool,
    cancelled: AtomicBool,
}

impl DownloadControl {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            pid: Mutex::new(None),
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        })
    }

    fn child_started(&self, pid: u32) {
        if let Ok(mut guard) = self.pid.lock() {
            *guard = Some(pid);
        }
        if self.is_cancelled() {
            terminate_process(pid);
        } else if self.is_paused() {
            suspend_process(pid);
        }
    }

    fn child_finished(&self) {
        if let Ok(mut guard) = self.pid.lock() {
            *guard = None;
        }
    }

    fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn wait_until_running(&self) {
        while self.is_paused() && !self.is_cancelled() {
            thread::sleep(Duration::from_millis(120));
        }
    }

    fn current_pid(&self) -> Option<u32> {
        self.pid.lock().ok().and_then(|guard| *guard)
    }
}

fn active_controls() -> &'static Mutex<HashMap<String, Arc<DownloadControl>>> {
    static ACTIVE: OnceLock<Mutex<HashMap<String, Arc<DownloadControl>>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Cada descarga corre en su propio hilo bloqueante; el control vive ahí
/// mientras yt-dlp/FFmpeg están vivos. El mapa global permite pausar o
/// cancelar trabajos individuales desde la UI.
thread_local! {
    static THREAD_CONTROL: std::cell::RefCell<Option<Arc<DownloadControl>>> =
        const { std::cell::RefCell::new(None) };
}

struct ThreadControlGuard;

impl Drop for ThreadControlGuard {
    fn drop(&mut self) {
        THREAD_CONTROL.with(|slot| {
            *slot.borrow_mut() = None;
        });
    }
}

struct ControlRegistryGuard(String);

impl Drop for ControlRegistryGuard {
    fn drop(&mut self) {
        remove_control(&self.0);
    }
}

fn register_control(run_id: &str) -> Result<Arc<DownloadControl>, ProjectError> {
    let mut guard = active_controls()
        .lock()
        .map_err(|_| provider_error("No se pudo registrar la descarga."))?;
    if guard.contains_key(run_id) {
        return Err(provider_error(
            "Ya hay una descarga activa con ese identificador.",
        ));
    }
    let control = DownloadControl::new();
    guard.insert(run_id.to_owned(), control.clone());
    Ok(control)
}

fn remove_control(run_id: &str) {
    if let Ok(mut guard) = active_controls().lock() {
        guard.remove(run_id);
    }
}

fn control_for(run_id: Option<&str>) -> Result<Arc<DownloadControl>, ProjectError> {
    let guard = active_controls()
        .lock()
        .map_err(|_| provider_error("No se pudo acceder a la descarga."))?;
    if let Some(run_id) = run_id {
        return guard
            .get(run_id)
            .cloned()
            .ok_or_else(|| provider_error("Ese trabajo ya no está activo."));
    }
    match guard.len() {
        0 => Err(provider_error("No hay una descarga activa.")),
        1 => guard
            .values()
            .next()
            .cloned()
            .ok_or_else(|| provider_error("No hay una descarga activa.")),
        count => Err(provider_error(format!(
            "Hay {count} descargas activas; indicá el runId del trabajo."
        ))),
    }
}

fn current_control() -> Option<Arc<DownloadControl>> {
    THREAD_CONTROL.with(|slot| slot.borrow().clone())
}

fn set_thread_control(control: Arc<DownloadControl>) -> ThreadControlGuard {
    THREAD_CONTROL.with(|slot| {
        *slot.borrow_mut() = Some(control);
    });
    ThreadControlGuard
}

#[cfg(windows)]
fn suspend_process(pid: u32) {
    #[link(name = "ntdll")]
    extern "system" {
        fn NtSuspendProcess(handle: *mut std::ffi::c_void) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
    const PROCESS_SUSPEND_RESUME: u32 = 0x0800;
    unsafe {
        let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
        if !handle.is_null() {
            let _ = NtSuspendProcess(handle);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(windows)]
fn resume_process(pid: u32) {
    #[link(name = "ntdll")]
    extern "system" {
        fn NtResumeProcess(handle: *mut std::ffi::c_void) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
    const PROCESS_SUSPEND_RESUME: u32 = 0x0800;
    unsafe {
        let handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
        if !handle.is_null() {
            let _ = NtResumeProcess(handle);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(windows)]
fn terminate_process(pid: u32) {
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
        fn TerminateProcess(handle: *mut std::ffi::c_void, code: u32) -> i32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
    const PROCESS_TERMINATE: u32 = 0x0001;
    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if !handle.is_null() {
            let _ = TerminateProcess(handle, 1);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(not(windows))]
fn suspend_process(_pid: u32) {}

#[cfg(not(windows))]
fn resume_process(_pid: u32) {}

#[cfg(not(windows))]
fn terminate_process(_pid: u32) {}

#[cfg(windows)]
fn available_disk_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            free_to_caller: *mut u64,
            total: *mut u64,
            total_free: *mut u64,
        ) -> i32;
    }
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            return None;
        }
    }
    let wide: Vec<u16> = probe.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free = 0u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(free)
}

#[cfg(not(windows))]
fn available_disk_bytes(_path: &Path) -> Option<u64> {
    None
}

#[tauri::command]
pub fn pause_download(run_id: Option<String>) -> Result<bool, ProjectError> {
    let control = control_for(run_id.as_deref())?;
    control.paused.store(true, Ordering::SeqCst);
    if let Some(pid) = control.current_pid() {
        suspend_process(pid);
    }
    Ok(true)
}

#[tauri::command]
pub fn resume_download(run_id: Option<String>) -> Result<bool, ProjectError> {
    let control = control_for(run_id.as_deref())?;
    control.paused.store(false, Ordering::SeqCst);
    if let Some(pid) = control.current_pid() {
        resume_process(pid);
    }
    Ok(true)
}

/// Cancelación silenciosa al cerrar la app; no hay UI a la que responder.
pub fn cancel_active_download() {
    let controls: Vec<Arc<DownloadControl>> = active_controls()
        .lock()
        .map(|guard| guard.values().cloned().collect())
        .unwrap_or_default();
    for control in controls {
        control.cancelled.store(true, Ordering::SeqCst);
        control.paused.store(false, Ordering::SeqCst);
        if let Some(pid) = control.current_pid() {
            terminate_process(pid);
        }
    }
}

#[tauri::command]
pub fn cancel_download(run_id: Option<String>) -> Result<bool, ProjectError> {
    let control = control_for(run_id.as_deref())?;
    control.cancelled.store(true, Ordering::SeqCst);
    control.paused.store(false, Ordering::SeqCst);
    if let Some(pid) = control.current_pid() {
        terminate_process(pid);
    }
    Ok(true)
}

#[tauri::command]
pub fn notify_user(app: AppHandle, title: String, body: String) -> Result<(), ProjectError> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title.chars().take(120).collect::<String>())
        .body(body.chars().take(300).collect::<String>())
        .show()
        .map_err(|_| provider_error("No se pudo mostrar la notificación del sistema."))
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

fn emit_progress(
    app: &AppHandle,
    run_id: &str,
    stage: &str,
    percent: Option<f64>,
    message: impl Into<String>,
) {
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            run_id: run_id.to_owned(),
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

fn is_download_cancelled() -> bool {
    current_control().is_some_and(|control| control.is_cancelled())
}

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

#[tauri::command]
pub async fn update_downloader(
    state: State<'_, AppState>,
) -> Result<DownloaderStatus, ProjectError> {
    let engine = resolve_engine(&state.config_dir)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&engine);
        command
            .arg("-U")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::commands::hide_console(&mut command);
        command.output()
    })
    .await
    .map_err(|_| provider_error("La actualización del motor se interrumpió."))?
    .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para actualizarlo."))?;
    invalidate_status_cache();
    if !result.status.success() {
        return Err(provider_error(format!(
            "yt-dlp no pudo actualizarse: {}",
            error_tail(
                &String::from_utf8_lossy(&result.stderr),
                "el motor no aceptó la actualización"
            )
        )));
    }
    Ok(status_from_config(&state.config_dir))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// MD5 y SHA-256 en una sola pasada, sin cargar el archivo completo en RAM.
fn hash_file(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(mut file) = std::fs::File::open(path) else {
        return (None, None);
    };
    let mut md5 = Md5::new();
    let mut sha = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                md5.update(&buffer[..read]);
                sha.update(&buffer[..read]);
            }
            Err(_) => return (None, None),
        }
    }
    (
        Some(format!("{:x}", md5.finalize())),
        Some(format!("{:x}", sha.finalize())),
    )
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
    emit_progress(&app, "", "engine", None, "Descargando yt-dlp oficial…");
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
    emit_progress(&app, "", "engine", None, "Verificando el motor…");
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
    emit_progress(&app, "", "engine", None, "Motor instalado.");
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

fn cookies_browser(raw: Option<&str>) -> Result<Option<String>, ProjectError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let value = value.to_ascii_lowercase();
    if matches!(
        value.as_str(),
        "chrome" | "edge" | "firefox" | "brave" | "chromium" | "opera" | "vivaldi"
    ) {
        Ok(Some(value))
    } else {
        Err(invalid_error("El navegador de cookies no es compatible."))
    }
}

#[tauri::command]
pub async fn download_disk_space(
    app: AppHandle,
    path: Option<String>,
) -> Result<u64, ProjectError> {
    let target = path
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| app.path().download_dir().ok())
        .ok_or_else(|| provider_error("No se pudo ubicar la carpeta de Descargas."))?;
    available_disk_bytes(&target)
        .ok_or_else(|| provider_error("No se pudo medir el espacio libre del disco."))
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
    cookies_browser: Option<&str>,
) -> Result<DownloadProbe, ProjectError> {
    emit_progress(app, "", "probing", None, "Consultando la URL…");
    probe_with_engine(engine, url, cookies, cookies_browser)
}

pub(crate) fn probe_with_engine(
    engine: &Path,
    url: &str,
    cookies: Option<&Path>,
    cookies_browser: Option<&str>,
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
    } else if let Some(browser) = cookies_browser {
        command.args(["--cookies-from-browser", browser]);
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
    cookies_from_browser: Option<String>,
) -> Result<DownloadProbe, ProjectError> {
    let validated = validate_url(&url)?;
    let cookies = validate_cookies_file(cookies_file.as_deref())?;
    let browser = cookies_browser(cookies_from_browser.as_deref())?;
    let engine = resolve_engine(&state.config_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        probe_blocking(
            &app,
            &engine,
            &validated,
            cookies.as_deref(),
            browser.as_deref(),
        )
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
    let control = current_control();
    if let Some(control) = control.as_ref() {
        control.child_started(child.id());
    }
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
    if let Some(control) = control.as_ref() {
        control.child_finished();
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HdrTransfer {
    /// PQ / HDR10 (`smpte2084`).
    Pq,
    /// Hybrid Log-Gamma (`arib-std-b67`), habitual en iPhone y YouTube HDR.
    Hlg,
}

impl HdrTransfer {
    pub(crate) fn color_trc(self) -> &'static str {
        match self {
            HdrTransfer::Pq => "smpte2084",
            HdrTransfer::Hlg => "arib-std-b67",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct ColorProbe {
    pub transfer: Option<HdrTransfer>,
    pub ten_bit: bool,
}

impl ColorProbe {
    pub(crate) fn is_hdr(self) -> bool {
        self.transfer.is_some()
    }
}

pub(crate) const HDR_TONEMAP: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

fn probe_color(ffprobe: Option<&Path>, path: &Path) -> ColorProbe {
    let Some(ffprobe) = ffprobe else {
        return ColorProbe::default();
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=pix_fmt,color_transfer,color_primaries,color_space",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return ColorProbe::default();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return ColorProbe::default();
    };
    let Some(stream) = value["streams"]
        .as_array()
        .and_then(|streams| streams.first())
    else {
        return ColorProbe::default();
    };
    let transfer = match stream["color_transfer"].as_str().unwrap_or("") {
        "smpte2084" => Some(HdrTransfer::Pq),
        "arib-std-b67" => Some(HdrTransfer::Hlg),
        _ => None,
    };
    let pix_fmt = stream["pix_fmt"].as_str().unwrap_or("");
    ColorProbe {
        transfer,
        ten_bit: pix_fmt.contains("10") || pix_fmt.contains("12"),
    }
}

pub(crate) type ProgressSink<'a> = &'a dyn Fn(&str, Option<f64>, &str);

/// Rectángulo de `delogo` calculado sobre las dimensiones reales del archivo.
/// FFmpeg no acepta `main_w`/`main_h` dentro de `x`/`y` en `delogo`, así que se
/// resuelve en Rust una sola vez por video antes de armar el filtergraph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DelogoRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelogoManualRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct UpscalePlan {
    pub width: u32,
    pub height: u32,
}

/// Normaliza las esquinas aceptadas por la UI y por la API.
pub(crate) fn delogo_corner(value: Option<&str>) -> Result<&'static str, String> {
    let key = value
        .unwrap_or("top-right")
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");
    match key.as_str() {
        "top-right" | "derecha-arriba" | "superior-derecha" => Ok("top-right"),
        "top-left" | "izquierda-arriba" | "superior-izquierda" => Ok("top-left"),
        "bottom-right" | "derecha-abajo" | "inferior-derecha" => Ok("bottom-right"),
        "bottom-left" | "izquierda-abajo" | "inferior-izquierda" => Ok("bottom-left"),
        _ => Err("La esquina del logo no es válida.".to_owned()),
    }
}

/// Parche proporcional inspirado en `x=main_w-160:y=20:w=140:h=50` para
/// 1920×1080: 140×50 con margen 20. Escala con el canvas y se mantiene dentro
/// del cuadro incluso en resoluciones chicas.
pub(crate) fn delogo_rect(width: u32, height: u32, corner: &str) -> Option<DelogoRect> {
    if width < 64 || height < 64 {
        return None;
    }
    let margin_x = ((width as f64) * (20.0 / 1920.0)).round().max(6.0) as u32;
    let margin_y = ((height as f64) * (20.0 / 1080.0)).round().max(6.0) as u32;
    let max_w = width.saturating_sub(margin_x.saturating_mul(2));
    let max_h = height.saturating_sub(margin_y.saturating_mul(2));
    if max_w < 16 || max_h < 16 {
        return None;
    }
    let w = (((width as f64) * (140.0 / 1920.0)).round() as u32).clamp(16, max_w);
    let h = (((height as f64) * (50.0 / 1080.0)).round() as u32).clamp(16, max_h);
    let (x, y) = match corner {
        "top-left" => (margin_x, margin_y),
        "bottom-left" => (margin_x, height - h - margin_y),
        "bottom-right" => (width - w - margin_x, height - h - margin_y),
        _ => (width - w - margin_x, margin_y),
    };
    Some(DelogoRect { x, y, w, h })
}

pub(crate) fn manual_delogo_rect(
    width: u32,
    height: u32,
    rect: DelogoManualRect,
) -> Option<DelogoRect> {
    if width < 16 || height < 16 {
        return None;
    }
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.w.is_finite()
        || !rect.h.is_finite()
        || rect.x < 0.0
        || rect.y < 0.0
        || rect.w <= 0.0
        || rect.h <= 0.0
        || rect.x + rect.w > 1.0001
        || rect.y + rect.h > 1.0001
    {
        return None;
    }
    let x = (rect.x * width as f64).round().max(0.0) as u32;
    let y = (rect.y * height as f64).round().max(0.0) as u32;
    let w = (rect.w * width as f64).round().max(8.0) as u32;
    let h = (rect.h * height as f64).round().max(8.0) as u32;
    let w = w.min(width.saturating_sub(x));
    let h = h.min(height.saturating_sub(y));
    (w >= 8 && h >= 8).then_some(DelogoRect { x, y, w, h })
}

/// Objetivo Lanczos. Mantiene la orientación del origen (un vertical va a
/// 1080×1920 y no se achica dentro de un canvas horizontal) y nunca reduce.
pub(crate) fn upscale_target(
    width: u32,
    height: u32,
    long_video: bool,
    mode: &str,
) -> Option<UpscalePlan> {
    if width == 0 || height == 0 {
        return None;
    }
    let (target_w, target_h) = match mode.trim().to_ascii_lowercase().as_str() {
        "1080" | "full-hd" | "fhd" => (1920, 1080),
        "2160" | "4k" | "uhd" => (3840, 2160),
        _ => {
            if long_video {
                (3840, 2160)
            } else {
                (1920, 1080)
            }
        }
    };
    let (target_w, target_h) = if height > width {
        (target_h, target_w)
    } else {
        (target_w, target_h)
    };
    if width >= target_w && height >= target_h {
        return None;
    }
    Some(UpscalePlan {
        width: target_w,
        height: target_h,
    })
}

fn spatial_effects(delogo: Option<DelogoRect>, upscale: Option<UpscalePlan>) -> String {
    let mut chain = String::new();
    if let Some(rect) = delogo {
        chain.push_str(&format!(
            "delogo=x={}:y={}:w={}:h={},",
            rect.x, rect.y, rect.w, rect.h
        ));
    }
    if let Some(plan) = upscale {
        // Se usa Lanczos en CPU porque `delogo`, `noise` y `eq` también corren
        // en CPU; `scale_cuda` exigiría hwupload/hwdownload y rompería la
        // pasada única. El encoder HEVC sí puede ser NVENC/AMF/QSV.
        chain.push_str(&format!(
            "scale={}:{}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,\
pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,",
            plan.width, plan.height, plan.width, plan.height
        ));
    }
    chain
}

/// Zoom 4 %. Con un plan de escalado se usan dimensiones explícitas para que
/// el crop final sea exactamente 1920×1080 o 3840×2160, sin perder 2 px por el
/// redondeo par que necesita el codificador.
fn zoom_filters(focus: &str, upscale: Option<UpscalePlan>) -> String {
    let (x, y) = match focus {
        "left" => ("(iw-ow)*0.33", "(ih-oh)*0.5"),
        "right" => ("(iw-ow)*0.67", "(ih-oh)*0.5"),
        "top" => ("(iw-ow)*0.5", "(ih-oh)*0.33"),
        "bottom" => ("(iw-ow)*0.5", "(ih-oh)*0.67"),
        _ => ("(iw-ow)*0.5", "(ih-oh)*0.5"),
    };
    if let Some(plan) = upscale {
        let zoom_w = ((plan.width as f64 * 1.04) / 2.0).floor() as u32 * 2;
        let zoom_h = ((plan.height as f64 * 1.04) / 2.0).floor() as u32 * 2;
        format!(
            "scale={zoom_w}:{zoom_h},crop={}:{}:{x}:{y},",
            plan.width, plan.height
        )
    } else {
        format!(
            "scale=trunc(iw*1.04/2)*2:trunc(ih*1.04/2)*2,\
crop=trunc(iw/1.04/2)*2:trunc(ih/1.04/2)*2:{x}:{y},"
        )
    }
}

/// Cadena del look cinematográfico. Es pura para testear el orden y el foco.
/// El flujo óptico va después de estirar el tiempo para que el resultado sea
/// 60 fps reales y no 58,8 fps disfrazados.
pub(crate) fn cinematic_filter(focus: &str) -> String {
    cinematic_filter_with(focus, None, None)
}

pub(crate) fn cinematic_filter_with(
    focus: &str,
    delogo: Option<DelogoRect>,
    upscale: Option<UpscalePlan>,
) -> String {
    let effects = spatial_effects(delogo, upscale);
    let zoom = zoom_filters(focus, upscale);
    format!(
        "[0:v]{effects}setpts=PTS/0.98,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:vsbmc=1,\
eq=gamma=0.95:contrast=1.08:saturation=1.12,{zoom}\
hflip,noise=alls=8:allf=t+u,format=yuv420p[v]"
    )
}

pub(crate) fn cinematic_focus(value: Option<&str>) -> Result<&'static str, String> {
    match value
        .unwrap_or("center")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "center" | "centro" => Ok("center"),
        "left" | "izquierda" => Ok("left"),
        "right" | "derecha" => Ok("right"),
        "top" | "arriba" => Ok("top"),
        "bottom" | "abajo" => Ok("bottom"),
        _ => Err("El foco del reencuadre no es válido.".to_owned()),
    }
}

pub(crate) fn pipeline_filter(focus: &str) -> String {
    pipeline_filter_with(focus, None, None)
}

pub(crate) fn pipeline_filter_with(
    focus: &str,
    delogo: Option<DelogoRect>,
    upscale: Option<UpscalePlan>,
) -> String {
    // Denoise espacial+temporal antes del flujo óptico: si se aplicara después,
    // el grano sintético también se suavizaría. El `replacen` deja el orden
    // hqdn3d -> delogo -> Lanczos -> look.
    cinematic_filter_with(focus, delogo, upscale).replacen(
        "[0:v]",
        "[0:v]hqdn3d=1.86:1.39:2.80:2.15,",
        1,
    )
}

fn file_md5(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|_| "No se pudo abrir el archivo final para calcular su MD5.".to_owned())?;
    let mut hasher = Md5::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "No se pudo leer el archivo final para calcular su MD5.".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|_| "No se pudo abrir el archivo final para calcular su SHA-256.".to_owned())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "No se pudo leer el archivo final para calcular su SHA-256.".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn input_has_audio(ffprobe: Option<&Path>, input: &Path) -> bool {
    let Some(ffprobe) = ffprobe else {
        return true;
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "json",
        ])
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return true;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return true;
    };
    value["streams"]
        .as_array()
        .map(|streams| !streams.is_empty())
        .unwrap_or(false)
}

fn subtitle_languages(value: Option<&str>) -> Result<String, String> {
    let value = value.unwrap_or("es.*,en.*").trim();
    if value.is_empty() || value.len() > 120 {
        return Err("La lista de idiomas de subtítulos no es válida.".to_owned());
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | ',' | '*' | '-' | '_'))
    {
        return Err(
            "Los idiomas de subtítulos sólo pueden usar letras, números, ., *, , y -.".to_owned(),
        );
    }
    Ok(value.to_owned())
}

fn sponsorblock_categories(value: Option<&str>) -> Result<String, String> {
    const ALLOWED: [&str; 8] = [
        "sponsor",
        "selfpromo",
        "interaction",
        "intro",
        "outro",
        "preview",
        "filler",
        "music_offtopic",
    ];
    let raw = value.unwrap_or("sponsor,selfpromo,interaction");
    let mut selected: Vec<&str> = Vec::new();
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if !ALLOWED.contains(&item) {
            return Err(format!("Categoría de SponsorBlock desconocida: {item}."));
        }
        if !selected.contains(&item) {
            selected.push(item);
        }
    }
    if selected.is_empty() {
        return Err("Elegí al menos una categoría de SponsorBlock.".to_owned());
    }
    Ok(selected.join(","))
}

fn sponsorblock_category_list(value: Option<&str>) -> Result<Vec<String>, String> {
    Ok(sponsorblock_categories(value)?
        .split(',')
        .map(str::to_owned)
        .collect())
}

/// Extrae el ID de 11 caracteres de las formas habituales de YouTube.
pub(crate) fn youtube_video_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let (_, rest) = trimmed.split_once("://")?;
    let (host, path) = rest.split_once('/')?;
    let host = host
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    let mut candidate = None;
    if host == "youtu.be" {
        candidate = path.split(['?', '#', '/']).next();
    } else if host == "youtube.com" || host.ends_with(".youtube.com") {
        if let Some(query) = path.strip_prefix("watch?") {
            candidate = query
                .split('&')
                .find_map(|pair| pair.strip_prefix("v="));
        } else {
            candidate = path
                .split('/')
                .find(|part| {
                    !part.is_empty()
                        && !matches!(
                            *part,
                            "shorts" | "embed" | "live" | "v" | "e"
                        )
                });
        }
    }
    let id = candidate?.trim();
    (id.len() == 11
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    .then(|| id.to_owned())
}

fn parse_sponsor_segments(value: &Value) -> Vec<SponsorSegment> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let segment = item["segment"].as_array()?;
            let start = segment.first()?.as_f64()?;
            let end = segment.get(1)?.as_f64()?;
            if !start.is_finite() || !end.is_finite() || end <= start {
                return None;
            }
            Some(SponsorSegment {
                category: item["category"].as_str().unwrap_or("sponsor").to_owned(),
                start_seconds: start,
                end_seconds: end,
                action: item["actionType"].as_str().unwrap_or("skip").to_owned(),
            })
        })
        .take(200)
        .collect()
}

#[tauri::command]
pub async fn list_audio_tracks(
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<AudioTrack>, ProjectError> {
    let url = validate_url(&url)?;
    let engine = resolve_engine(&state.config_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&engine);
        command
            .args([
                "--no-warnings",
                "--ignore-config",
                "--dump-single-json",
                "--skip-download",
            ])
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::commands::hide_console(&mut command);
        let output = command
            .output()
            .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para el audio."))?;
        if !output.status.success() {
            return Err(provider_error(
                "yt-dlp no pudo analizar las pistas de audio; puede requerir cookies.",
            ));
        }
        let value: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| provider_error("yt-dlp devolvió un análisis de audio ilegible."))?;
        let tracks = parse_audio_tracks(&value);
        if tracks.is_empty() {
            return Err(invalid_error(
                "La URL no ofrece pistas de audio separadas.",
            ));
        }
        Ok(tracks)
    })
    .await
    .map_err(|_| provider_error("El análisis de audio se interrumpió."))?
}

#[tauri::command]
pub async fn list_playlist_entries(
    state: State<'_, AppState>,
    url: String,
    limit: Option<u32>,
) -> Result<Vec<PlaylistEntry>, ProjectError> {
    let url = validate_url(&url)?;
    let engine = resolve_engine(&state.config_dir)?;
    let limit = limit.unwrap_or(500).clamp(1, 1000);
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&engine);
        command
            .args([
                "--no-warnings",
                "--ignore-config",
                "--flat-playlist",
                "--dump-single-json",
                "--skip-download",
                "--playlist-end",
                &limit.to_string(),
            ])
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::commands::hide_console(&mut command);
        let output = command
            .output()
            .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para la playlist."))?;
        if !output.status.success() {
            return Err(provider_error(
                "yt-dlp no pudo leer la playlist; puede ser privada o requerir cookies.",
            ));
        }
        let value: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| provider_error("yt-dlp devolvió una playlist ilegible."))?;
        let entries = parse_playlist_entries(&value, limit as usize);
        if entries.is_empty() {
            return Err(invalid_error(
                "La URL no devolvió elementos de playlist reconocibles.",
            ));
        }
        Ok(entries)
    })
    .await
    .map_err(|_| provider_error("La lectura de la playlist se interrumpió."))?
}

fn fetch_sponsor_segments(
    video_id: &str,
    categories: &[String],
) -> Result<Vec<SponsorSegment>, ProjectError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| provider_error("No se pudo iniciar la consulta a SponsorBlock."))?;
    let categories_json =
        serde_json::to_string(categories).unwrap_or_else(|_| "[]".to_owned());
    let response = client
        .get("https://sponsor.ajay.app/api/skipSegments")
        .query(&[
            ("videoID", video_id),
            ("categories", categories_json.as_str()),
        ])
        .header("User-Agent", "Olyvia/0.1 (editor local)")
        .send()
        .map_err(|_| {
            provider_error("No se pudo consultar SponsorBlock. Revisá la conexión o el proxy.")
        })?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    if !response.status().is_success() {
        return Err(provider_error(format!(
            "SponsorBlock respondió {}.",
            response.status().as_u16()
        )));
    }
    let value: Value = response
        .json()
        .map_err(|_| provider_error("SponsorBlock devolvió una respuesta inválida."))?;
    Ok(parse_sponsor_segments(&value))
}

/// Consulta la API pública de SponsorBlock sin descargar el video. Devuelve
/// los tramos que yt-dlp quitaría con las mismas categorías.
#[tauri::command]
pub async fn sponsorblock_preview(
    url: String,
    categories: Option<String>,
) -> Result<Vec<SponsorSegment>, ProjectError> {
    let video_id = youtube_video_id(&url).ok_or_else(|| {
        invalid_error("Solo los enlaces de YouTube tienen segmentos de SponsorBlock.")
    })?;
    let categories =
        sponsorblock_category_list(categories.as_deref()).map_err(invalid_error)?;
    tauri::async_runtime::spawn_blocking(move || fetch_sponsor_segments(&video_id, &categories))
        .await
        .map_err(|_| provider_error("La consulta a SponsorBlock se interrumpió."))?
}

/// Tratamiento opcional de la pista original: acelera 2 % sin cambiar el
/// tono y suma ruido rosa a -50 dB antes de la normalización de emisión.
/// Los títulos de música conservan la pista original: el enrutador no debe
/// sustituirla por Piper ni por una banda, aunque el video sea corto.
pub(crate) fn title_prefers_original_audio(title: &str) -> bool {
    let lower = title.to_lowercase();
    [
        "music", "song", "lyrics", "cover", "música", "musica", "canción", "cancion",
    ]
    .iter()
    .any(|word| lower.contains(word))
}

/// Decisión estática del enrutador automático. No consulta IA ni red: sólo la
/// duración conocida y el título. Se resuelve una vez por archivo y se puede
/// recalcular después de descargar si la duración llegó vacía.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AutoRouteDecision {
    pub long_video: bool,
    pub music: bool,
}

impl AutoRouteDecision {
    pub fn pick(duration_seconds: f64, title: &str) -> Self {
        Self {
            long_video: duration_seconds > 60.0,
            music: title_prefers_original_audio(title),
        }
    }

    /// Sólo los videos cortos no musicales reciben narración Piper.
    /// Los cortos no musicales conservan y masterizan la pista original; la
    /// voz Piper queda como opción manual explícita, no automática.
    pub fn master_original_audio(self) -> bool {
        !self.music && !self.long_video
    }

    /// Los videos largos aceleran 2 % y suman ruido; la música nunca.
    pub fn speed_and_noise(self) -> bool {
        self.long_video && !self.music
    }

    /// La música conserva la pista sin filtros de velocidad ni ruido.
    pub fn preserves_original_audio_without_voice(self) -> bool {
        self.music
    }

    pub fn summary(self) -> &'static str {
        match (self.music, self.long_video) {
            (true, true) => "música larga: look rápido sin flujo óptico y audio original intacto",
            (true, false) => "música: look completo y audio original intacto",
            (false, true) => {
                "video largo: look rápido sin flujo óptico y audio 1,02× con ruido −50 dB"
            }
            (false, false) => {
                "video corto: look completo con flujo óptico y audio original masterizado"
            }
        }
    }
}

fn read_download_subtitles(files: &[DownloadedFile]) -> Vec<DownloadedSubtitle> {
    files
        .iter()
        .filter(|file| {
            matches!(
                media_extension(Path::new(&file.path)).as_str(),
                "srt" | "vtt" | "ass" | "ssa"
            )
        })
        .filter_map(|file| {
            let bytes = std::fs::metadata(&file.path).ok()?.len();
            if bytes == 0 || bytes > 2_000_000 {
                return None;
            }
            let text = std::fs::read_to_string(&file.path).ok()?;
            Some(DownloadedSubtitle {
                path: file.path.clone(),
                name: file.name.clone(),
                text,
            })
        })
        .collect()
}

fn probe_chapters(ffprobe: Option<&Path>, path: &Path) -> Vec<DownloadedChapter> {
    let Some(ffprobe) = ffprobe else {
        return Vec::new();
    };
    let mut command = Command::new(ffprobe);
    command
        .args(["-v", "error", "-show_chapters", "-of", "json"])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return Vec::new();
    };
    value["chapters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|chapter| {
            let start = chapter["start_time"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .or_else(|| chapter["start_time"].as_f64())?;
            let title = chapter["tags"]["title"]
                .as_str()
                .or_else(|| chapter["title"].as_str())
                .unwrap_or("Capítulo")
                .trim()
                .chars()
                .take(120)
                .collect::<String>();
            (!title.is_empty()).then_some(DownloadedChapter {
                start_seconds: start.max(0.0),
                title,
            })
        })
        .take(200)
        .collect()
}

fn probe_duration(ffprobe: Option<&Path>, input: &Path) -> Option<f64> {
    let ffprobe = ffprobe?;
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
}

/// Ruta rápida para videos largos: sin flujo óptico, denoise ni grano.
pub(crate) fn fast_cinematic_filter(focus: &str) -> String {
    fast_cinematic_filter_with(focus, None, None)
}

pub(crate) fn fast_cinematic_filter_with(
    focus: &str,
    delogo: Option<DelogoRect>,
    upscale: Option<UpscalePlan>,
) -> String {
    let effects = spatial_effects(delogo, upscale);
    let zoom = zoom_filters(focus, upscale);
    // En la ruta larga se evita el flujo óptico y el grano, pero si hay
    // upscaling se mantiene el denoise previo para no ampliar el pixelado.
    let denoise = if upscale.is_some() {
        "hqdn3d=1.86:1.39:2.80:2.15,"
    } else {
        ""
    };
    format!(
        "[0:v]{denoise}{effects}fps=60,setpts=PTS/0.98,eq=gamma=0.98:contrast=1.05:saturation=1.05,{zoom}\
hflip,format=yuv420p[v]"
    )
}

pub(crate) fn audio_treatment_filter() -> &'static str {
    "atempo=1.02,highpass=f=80,afftdn=nr=12:nf=-30,loudnorm=I=-14:TP=-1.5:LRA=11,apad"
}

/// Master transparente para conservar el audio original de un video corto:
/// sin cambiar velocidad ni tono, sólo limpieza suave y nivel de emisión.
/// No es un mecanismo para evadir Content ID; es mastering de material propio.
pub(crate) fn audio_master_filter() -> &'static str {
    "highpass=f=55,lowpass=f=18000,acompressor=threshold=-18dB:ratio=2:attack=5:release=120,loudnorm=I=-14:TP=-1.5:LRA=11,apad"
}

pub(crate) fn audio_noise_mix_filter() -> &'static str {
    "[0:a]atempo=1.02,highpass=f=80,afftdn=nr=12:nf=-30,loudnorm=I=-14:TP=-1.5:LRA=11,apad[voice];[1:a]volume=1.0[noise];[voice][noise]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.891[a]"
}

/// Ejecuta FFmpeg leyendo `-progress pipe:1` para mostrar porcentaje real.
/// El stderr se drena en otro hilo para que el pipe no bloquee el proceso.
fn run_ffmpeg_with_progress(
    progress: ProgressSink<'_>,
    message: &str,
    command: &mut Command,
    duration: Option<f64>,
) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(command);
    let mut child = command
        .spawn()
        .map_err(|_| "No se pudo ejecutar FFmpeg para el post-proceso.".to_owned())?;
    let control = current_control();
    if let Some(control) = control.as_ref() {
        control.child_started(child.id());
    }
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
    let mut speed: Option<String> = None;
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(raw) = line.strip_prefix("speed=") {
                let value = raw.trim();
                if !value.is_empty() && value != "N/A" {
                    speed = Some(value.to_owned());
                }
                continue;
            }
            let Some(raw) = line.strip_prefix("out_time_us=") else {
                continue;
            };
            let Ok(microseconds) = raw.trim().parse::<f64>() else {
                continue;
            };
            if microseconds < 0.0 {
                continue;
            }
            let percent = duration
                .filter(|duration| *duration > 0.0)
                .map(|duration| (microseconds / 1_000_000.0 / duration * 100.0).clamp(0.0, 99.0));
            if let Some(percent) = percent {
                let rounded = percent.floor() as i32;
                if rounded != last_percent {
                    last_percent = rounded;
                    let detail = speed
                        .as_ref()
                        .map(|speed| format!("{message} · {speed}"))
                        .unwrap_or_else(|| message.to_owned());
                    progress("compressing", Some(percent), &detail);
                }
            }
        }
    }
    let status = child
        .wait()
        .map_err(|_| "No se pudo esperar a FFmpeg.".to_owned())?;
    if let Some(control) = control.as_ref() {
        control.child_finished();
    }
    let stderr = stderr_handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    if !status.success() {
        return Err(error_tail(
            &stderr,
            "FFmpeg no pudo aplicar el post-proceso.",
        ));
    }
    Ok(())
}

fn process_video(
    progress: ProgressSink<'_>,
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    input: &Path,
    focus: &str,
    replacement_audio: Option<&Path>,
    auto_pipeline: bool,
    long_video: bool,
    audio_speed_noise: bool,
    preserve_original_audio: bool,
    audio_master: bool,
    delogo_corner: Option<&str>,
    manual_delogo: Option<DelogoManualRect>,
    upscale_mode: Option<&str>,
    watermark: Option<&Path>,
    profile: &crate::commands::pipeline_profile::PipelineProfile,
) -> Result<(PathBuf, Option<String>, Option<String>), String> {
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let output = input.with_file_name(format!("{stem} - cine analogico.mp4"));
    let (source_width, source_height) = dimensions(ffprobe, input).unwrap_or((0, 0));
    let source_duration = probe_duration(ffprobe, input);
    let delogo = manual_delogo
        .and_then(|rect| manual_delogo_rect(source_width, source_height, rect))
        .or_else(|| {
            delogo_corner.and_then(|corner| delogo_rect(source_width, source_height, corner))
        });
    let upscale =
        upscale_mode.and_then(|mode| upscale_target(source_width, source_height, long_video, mode));
    let color = probe_color(ffprobe, input);
    let mut filter = if auto_pipeline && long_video {
        fast_cinematic_filter_with(focus, delogo, upscale)
    } else if auto_pipeline {
        pipeline_filter_with(focus, delogo, upscale)
    } else {
        cinematic_filter_with(focus, delogo, upscale)
    };
    if color.is_hdr() {
        // El look manual y el pipeline cierran en yuv420p: sin tonemap, un
        // fuente HDR se vería lavada. Se convierte antes de cualquier efecto.
        filter = filter.replacen(
            "[0:v]",
            &format!("[0:v]{HDR_TONEMAP},"),
            1,
        );
    }
    let mut extras = Vec::new();
    if color.is_hdr() {
        extras.push("HDR → SDR".to_owned());
    }
    if let Some(rect) = delogo {
        extras.push(format!(
            "logo {}×{} en ({}, {})",
            rect.w, rect.h, rect.x, rect.y
        ));
    }
    if let Some(plan) = upscale {
        extras.push(format!("Lanczos a {}×{}", plan.width, plan.height));
    }
    let detail = if extras.is_empty() {
        String::new()
    } else {
        format!(" · {}", extras.join(" · "))
    };
    let progress_message = if auto_pipeline {
        format!(
            "Pipeline automático con {}: denoise, delogo, Lanczos, grano y HEVC{detail}…",
            profile.label
        )
    } else {
        format!("Aplicando look cine analógico 35 mm: flujo óptico, grano y espejo{detail}…")
    };
    progress("compressing", None, &progress_message);
    let has_audio = input_has_audio(ffprobe, input);
    let use_noise_audio = audio_speed_noise && replacement_audio.is_none() && has_audio;
    let filter_complex = if use_noise_audio {
        format!("{filter};{}", audio_noise_mix_filter())
    } else {
        filter.clone()
    };
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-v", "error", "-y"]);
    if auto_pipeline {
        if let Some(hwaccel) = profile.hwaccel.as_deref() {
            command.args(["-hwaccel", hwaccel]);
        }
    }
    command.arg("-i").arg(input);
    if let Some(audio) = replacement_audio {
        command.arg("-i").arg(audio);
    } else if use_noise_audio {
        // Ruido rosa a -50 dB de amplitud: se mezcla con la voz y se limita
        // para que nunca sature el master.
        command.args([
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=color=pink:amplitude=0.003162",
        ]);
    }
    let watermark_index =
        1 + usize::from(replacement_audio.is_some()) + usize::from(use_noise_audio);
    if let Some(mark) = watermark {
        command.arg("-i").arg(mark);
    }
    let (filter_complex, video_label) = if watermark.is_some() {
        (
            format!(
                "{filter_complex};[{watermark_index}:v]scale=iw*0.22:-1,format=rgba,colorchannelmixer=aa=0.7[wm];[v][wm]overlay=W-w-32:H-h-32:format=auto,format=yuv420p[vout]"
            ),
            "[vout]",
        )
    } else {
        (filter_complex, "[v]")
    };
    command
        .args(["-filter_complex", &filter_complex, "-map", video_label])
        .args(["-pix_fmt", "yuv420p", "-r", "60", "-movflags", "+faststart"]);
    if auto_pipeline {
        command.args(&profile.args);
        if profile
            .args
            .iter()
            .any(|arg| arg.contains("hevc") || arg.contains("265"))
        {
            command.args(["-tag:v", "hvc1"]);
        }
    } else {
        // El look manual también cierra en H.265 para que cualquier asset
        // postprocesado por el hook sea HEVC, no una mezcla de códecs.
        command.args([
            "-c:v", "libx265", "-preset", "fast", "-crf", "22", "-tag:v", "hvc1",
        ]);
    }
    let keep_clean_audio = auto_pipeline && replacement_audio.is_none();
    if use_noise_audio {
        command.args(["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
    } else if replacement_audio.is_some() {
        // La banda nueva se normaliza a -14 LUFS y se rellena para que no
        // corte el video si es más corta que la imagen.
        command.args([
            "-map",
            "1:a:0",
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=11,apad",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
        ]);
    } else if audio_master && has_audio {
        // Corto o look manual sin banda/voz: conserva el audio original y lo
        // masteriza sin cambiar velocidad ni tono.
        command.args([
            "-map",
            "0:a:0",
            "-af",
            audio_master_filter(),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
        ]);
    } else if preserve_original_audio && has_audio {
        // Música: no se toca velocidad, tono ni ruido. Se recodifica a AAC
        // sólo para garantizar compatibilidad con MP4.
        command.args(["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
    } else if keep_clean_audio && has_audio {
        // Sin banda elegida, el pipeline conserva el audio original limpio:
        // corte de graves, reducción de ruido y normalización de emisión.
        command.args([
            "-map",
            "0:a:0",
            "-af",
            audio_treatment_filter(),
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
        ]);
    } else {
        command.arg("-an");
    }
    command
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(&output);
    if let Err(message) =
        run_ffmpeg_with_progress(progress, &progress_message, &mut command, source_duration)
    {
        let _ = std::fs::remove_file(&output);
        return Err(message);
    }
    let bytes = std::fs::metadata(&output)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if bytes == 0 {
        let _ = std::fs::remove_file(&output);
        return Err("El post-proceso quedó vacío; se conservó el original.".to_owned());
    }
    // Todo asset postprocesado por el hook queda identificado con ambos
    // hashes: el archivo se reencodea por completo, no es el original.
    let md5 = match file_md5(&output) {
        Ok(hash) => hash,
        Err(message) => {
            let _ = std::fs::remove_file(&output);
            return Err(message);
        }
    };
    let sha256 = match file_sha256(&output) {
        Ok(hash) => hash,
        Err(message) => {
            let _ = std::fs::remove_file(&output);
            return Err(message);
        }
    };
    Ok((output, Some(md5), Some(sha256)))
}

fn cinematic_video(
    progress: ProgressSink<'_>,
    ffmpeg: &Path,
    input: &Path,
    focus: &str,
    replacement_audio: Option<&Path>,
) -> Result<PathBuf, String> {
    process_video(
        progress,
        ffmpeg,
        None,
        input,
        focus,
        replacement_audio,
        false,
        false,
        false,
        false,
        false,
        None,
        None,
        None,
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .map(|(path, _, _)| path)
}

fn compress_video(
    progress: ProgressSink<'_>,
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    input: &Path,
    crf: Option<u32>,
    target_size_mb: Option<u64>,
    codec: &str,
    hdr_mode: &str,
    keep_original: bool,
) -> Result<Option<PathBuf>, String> {
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let output = input.with_file_name(format!("{stem} - compacto.mp4"));
    let source_duration = probe_duration(ffprobe, input);
    let color = probe_color(ffprobe, input);
    let preserve_hdr = color.is_hdr() && hdr_mode == "preserve";
    if preserve_hdr && codec != "h265" && codec != "av1" {
        return Err(
            "Conservar HDR requiere H.265 o AV1: H.264 descarta la transferencia HDR."
                .to_owned(),
        );
    }
    // Medición sintética 1080p/5 s: medium 4,75 s · fast 4,35 s · faster
    // 3,41 s. `faster` recorta ~28 % con un tamaño casi igual; el CRF sigue
    // controlando la calidad y el peso final.
    let preset = "faster";
    let codec_name = if preserve_hdr {
        if codec == "av1" {
            "libaom-av1"
        } else {
            "libx265"
        }
    } else {
        match codec {
            "h264" => "libx264",
            "av1" => "libaom-av1",
            _ => "libx265",
        }
    };
    let codec_label = if preserve_hdr {
        "H.265 HDR"
    } else {
        match codec {
            "h264" => "H.264",
            "av1" => "AV1",
            _ => "H.265",
        }
    };
    let progress_message = format!(
        "Comprimiendo {} con {codec_label}…",
        input
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default(),
    );
    progress("compressing", Some(0.0), &progress_message);
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-v", "error", "-y", "-i"]);
    command.arg(input);
    if color.is_hdr() && !preserve_hdr {
        command.args(["-vf", HDR_TONEMAP]);
    }
    command.args([
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-map_metadata",
        "0",
        "-map_chapters",
        "0",
        "-c:v",
        codec_name,
    ]);
    if codec == "av1" {
        command.args(["-cpu-used", "6", "-row-mt", "1"]);
    } else if !preserve_hdr {
        command.args(["-preset", preset]);
    }
    if let Some(target_size_mb) = target_size_mb {
        let duration = source_duration
            .filter(|duration| *duration > 0.1)
            .ok_or_else(|| {
                "No se pudo medir la duración para calcular el tamaño objetivo.".to_owned()
            })?;
        let audio_kbps = 160.0;
        // MB decimales, igual que la UI (`formatBytes` divide por 1_000_000).
        let total_kbps = (target_size_mb as f64 * 8.0 * 1_000_000.0 / 1000.0) / duration;
        let video_kbps = total_kbps - audio_kbps;
        if video_kbps < 120.0 {
            let minimum_mb =
                ((120.0 + audio_kbps) * duration / 8.0 / 1_000.0).ceil().max(1.0);
            return Err(format!(
                "El tamaño objetivo ({target_size_mb} MB) es demasiado chico para {duration:.0} s. \
                 Elegí al menos {minimum_mb:.0} MB."
            ));
        }
        let video_kbps = video_kbps.min(100_000.0);
        command.args([
            "-b:v".into(),
            format!("{video_kbps:.0}k"),
            "-maxrate".into(),
            format!("{:.0}k", video_kbps * 1.35),
            "-bufsize".into(),
            format!("{:.0}k", video_kbps * 2.0),
        ]);
    } else if codec == "av1" {
        command.args(["-crf", "32", "-b:v", "0"]);
    } else {
        let crf_value = crf.unwrap_or(24).to_string();
        command.args(["-crf", &crf_value]);
    }
    if preserve_hdr {
        let transfer = color
            .transfer
            .map(HdrTransfer::color_trc)
            .unwrap_or("smpte2084");
        command.args([
            "-pix_fmt",
            "yuv420p10le",
            "-color_primaries",
            "bt2020",
            "-color_trc",
            transfer,
            "-colorspace",
            "bt2020nc",
        ]);
    } else {
        command.args(["-pix_fmt", "yuv420p"]);
    }
    command.args(["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]);
    if codec == "av1" {
        command.args(["-tag:v", "av01"]);
    } else if codec == "h265" || preserve_hdr {
        command.args(["-tag:v", "hvc1"]);
    }
    command
        .args(["-progress", "pipe:1", "-nostats"])
        .arg(&output);
    if let Err(message) =
        run_ffmpeg_with_progress(progress, &progress_message, &mut command, source_duration)
    {
        let _ = std::fs::remove_file(&output);
        return Err(message);
    }
    let original_size = std::fs::metadata(input).map(|meta| meta.len()).unwrap_or(0);
    let compressed_size = std::fs::metadata(&output)
        .map(|meta| meta.len())
        .unwrap_or(0);
    if compressed_size == 0 || compressed_size >= original_size {
        let _ = std::fs::remove_file(&output);
        return Ok(None);
    }
    if !keep_original {
        std::fs::remove_file(input).map_err(|_| {
            "Se comprimió el video pero no se pudo reemplazar el archivo original.".to_owned()
        })?;
    }
    Ok(Some(output))
}

fn apply_metadata_cover(
    ffmpeg: &Path,
    path: &Path,
    title: Option<&str>,
    artist: Option<&str>,
    comment: Option<&str>,
    cover: Option<&Path>,
) -> Result<(), String> {
    if title.is_none() && artist.is_none() && comment.is_none() && cover.is_none() {
        return Ok(());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".to_owned());
    let temp = path.with_file_name(format!("{stem}.meta.{extension}"));
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-v", "error", "-y", "-i"]).arg(path);
    let embed_cover = cover.is_some() && !matches!(extension.as_str(), "webm");
    if let Some(cover) = cover.filter(|_| embed_cover) {
        command.arg("-i").arg(cover);
    }
    if embed_cover {
        command.args([
            "-map",
            "0",
            "-map",
            "1",
            "-c",
            "copy",
            "-c:v:1",
            "mjpeg",
            "-disposition:v:1",
            "attached_pic",
        ]);
    } else {
        command.args(["-map", "0", "-c", "copy"]);
    }
    for (key, value) in [
        ("title", title),
        ("artist", artist),
        ("comment", comment),
    ] {
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            command.args(["-metadata", &format!("{key}={value}")]);
        }
    }
    if extension == "mp4" || extension == "mov" {
        command.args(["-movflags", "+faststart"]);
    }
    command
        .arg(&temp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|_| "No se pudo ejecutar FFmpeg para los metadatos.".to_owned())?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.chars().rev().take(2_000).collect::<String>().chars().rev().collect();
        return Err(tail);
    }
    std::fs::remove_file(path)
        .map_err(|_| "No se pudo reemplazar el archivo original.".to_owned())?;
    std::fs::rename(&temp, path)
        .map_err(|_| "No se pudo mover el archivo con metadatos.".to_owned())?;
    Ok(())
}

fn mute_audio_segments(
    ffmpeg: &Path,
    path: &Path,
    segments: &[SponsorSegment],
) -> Result<(), String> {
    let ranges = segments
        .iter()
        .map(|segment| {
            format!(
                "between(t,{:.3},{:.3})",
                segment.start_seconds.max(0.0),
                segment.end_seconds.max(segment.start_seconds + 0.05)
            )
        })
        .collect::<Vec<_>>()
        .join("+");
    if ranges.is_empty() {
        return Ok(());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "mp4" | "mkv" | "mov" | "webm") {
        return Err("El contenedor no permite silenciar sin reencodear el video.".to_owned());
    }
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let temp = path.with_file_name(format!("{stem}.muted.{extension}"));
    let audio_codec = if extension == "webm" { "libopus" } else { "aac" };
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-v", "error", "-y", "-i"])
        .arg(path)
        .args(["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy"])
        .args(["-c:a", audio_codec, "-b:a", "160k"])
        .args([
            "-af",
            &format!("volume=enable='{ranges}':volume=0"),
        ]);
    if extension == "mp4" || extension == "mov" {
        command.args(["-movflags", "+faststart"]);
    }
    command.arg(&temp).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| "No se pudo ejecutar FFmpeg.".to_owned())?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.chars().rev().take(2_000).collect::<String>().chars().rev().collect();
        return Err(tail);
    }
    std::fs::remove_file(path)
        .map_err(|_| "No se pudo reemplazar el video original.".to_owned())?;
    std::fs::rename(&temp, path)
        .map_err(|_| "No se pudo mover el video silenciado.".to_owned())?;
    Ok(())
}

pub(crate) fn download_blocking(
    progress: ProgressSink<'_>,
    engine: &Path,
    cache_dir: &Path,
    request: DownloadRequest,
    ffmpeg: Option<PathBuf>,
    ffprobe: Option<PathBuf>,
    cookies: Option<&Path>,
    piper: Option<crate::commands::piper::PiperAssets>,
    watermark: Option<PathBuf>,
) -> Result<DownloadOutcome, ProjectError> {
    let run_id = request
        .run_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let control = register_control(&run_id)?;
    let _registry_guard = ControlRegistryGuard(run_id.clone());
    let _thread_guard = set_thread_control(control.clone());
    control.wait_until_running();
    if control.is_cancelled() {
        return Err(provider_error("Descarga cancelada."));
    }
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
        "h265" | "h264" | "av1" => request.codec.as_deref().unwrap_or("h265"),
        _ => return Err(invalid_error("El códec de compresión no es válido.")),
    };
    let hdr_mode = match request.hdr_mode.as_deref().unwrap_or("tonemap") {
        "tonemap" => "tonemap",
        "preserve" => "preserve",
        _ => return Err(invalid_error("El modo HDR no es válido.")),
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
    let proxy = request
        .proxy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(proxy) = proxy {
        let lower = proxy.to_ascii_lowercase();
        if !(lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("socks4://")
            || lower.starts_with("socks5://"))
            || proxy.len() > 500
        {
            return Err(invalid_error(
                "El proxy debe ser http://, https://, socks4:// o socks5://.",
            ));
        }
    }
    let limit_rate = request
        .limit_rate
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(rate) = limit_rate {
        let valid = rate.len() <= 12
            && rate.chars().next().is_some_and(|ch| ch.is_ascii_digit())
            && rate
                .chars()
                .all(|ch| ch.is_ascii_digit() || matches!(ch, 'K' | 'M' | 'G' | 'k' | 'm' | 'g'));
        if !valid {
            return Err(invalid_error(
                "El límite de bajada debe ser un tamaño como 500K u 8M.",
            ));
        }
    }
    let download_subtitles = request.download_subtitles.unwrap_or(false);
    let subtitle_langs = subtitle_languages(request.subtitle_langs.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let download_thumbnail = request.download_thumbnail.unwrap_or(false);
    let download_chapters = request.download_chapters.unwrap_or(false);
    let sponsorblock = request.sponsorblock.unwrap_or(false);
    let keep_original = request.keep_original.unwrap_or(false);
    let sponsorblock_categories =
        sponsorblock_categories(request.sponsorblock_categories.as_deref())
            .map_err(|message| invalid_error(&message))?;
    let mut sponsorblock_mark = match request
        .sponsorblock_mark
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => sponsorblock_category_list(Some(value))
            .map_err(|message| invalid_error(&message))?,
        None => Vec::new(),
    };
    sponsorblock_mark.retain(|category| {
        !sponsorblock_categories
            .split(',')
            .any(|item| item == category.as_str())
    });
    let sponsorblock_mute = match request
        .sponsorblock_mute
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => sponsorblock_category_list(Some(value))
            .map_err(|message| invalid_error(&message))?,
        None => Vec::new(),
    };
    let cookies_from_browser = cookies_browser(request.cookies_from_browser.as_deref())?;
    let trim_start = request.trim_start.unwrap_or(0.0).max(0.0);
    let trim_end = request
        .trim_end
        .filter(|end| end.is_finite() && *end > trim_start);
    if request.trim_end.is_some() && trim_end.is_none() {
        return Err(invalid_error(
            "El recorte previo necesita un final mayor que el inicio.",
        ));
    }
    if trim_end.is_some() && matches!(kind, "image" | "gallery") {
        return Err(invalid_error(
            "El recorte previo sólo se aplica a videos o audio.",
        ));
    }
    let auto_route = request.auto_route.unwrap_or(false);
    if auto_route && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El enrutamiento automático sólo se aplica a videos.",
        ));
    }
    let delogo_enabled = request.delogo.unwrap_or(false);
    let manual_delogo = delogo_enabled.then_some(request.delogo_rect).flatten();
    if let Some(rect) = manual_delogo {
        if !rect.x.is_finite()
            || !rect.y.is_finite()
            || !rect.w.is_finite()
            || !rect.h.is_finite()
            || rect.x < 0.0
            || rect.y < 0.0
            || rect.w <= 0.0
            || rect.h <= 0.0
            || rect.x + rect.w > 1.0001
            || rect.y + rect.h > 1.0001
        {
            return Err(invalid_error(
                "El rectángulo del logo debe estar dentro del cuadro (fracciones 0–1).",
            ));
        }
    }
    let delogo_corner_value = if delogo_enabled {
        Some(
            delogo_corner(request.delogo_corner.as_deref())
                .map_err(|message| invalid_error(&message))?,
        )
    } else {
        None
    };
    let upscale_enabled = request.upscale.unwrap_or(false);
    let upscale_mode_value = if upscale_enabled {
        let mode = request
            .upscale_target
            .as_deref()
            .unwrap_or("auto")
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            mode.as_str(),
            "auto" | "1080" | "2160" | "full-hd" | "fhd" | "4k" | "uhd"
        ) {
            return Err(invalid_error(
                "El objetivo de escalado debe ser auto, 1080 o 2160.",
            ));
        }
        Some(mode)
    } else {
        None
    };
    if (delogo_enabled || upscale_enabled) && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El delogo y el escalado sólo se aplican a videos.",
        ));
    }
    let source_title = request.source_title.clone().unwrap_or_default();
    let source_duration = request.source_duration.unwrap_or(0.0);
    let route_decision =
        auto_route.then(|| AutoRouteDecision::pick(source_duration, &source_title));
    let long_video = route_decision
        .map(|route| route.long_video)
        .unwrap_or(source_duration > 60.0);
    let explicit_voice = request.voice_pipeline.unwrap_or(false);
    let mut voice_script = request.voice_script.clone().unwrap_or_default();
    if auto_route && voice_script.trim().is_empty() {
        voice_script = "Narración automática de Olyvia.".to_owned();
    }
    if explicit_voice && !auto_route && voice_script.trim().is_empty() {
        return Err(invalid_error(
            "Escribí el guion para la voz IA local antes de descargar.",
        ));
    }
    // La voz ya no es automática: el enrutador conserva y masteriza el audio
    // original del video corto. Piper sólo se usa si se pidió explícitamente.
    let voice_enabled = explicit_voice && !voice_script.trim().is_empty();
    let auto_pipeline = request.auto_pipeline.unwrap_or(false) || voice_enabled || auto_route;
    let has_replacement_audio = request
        .replacement_audio
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let mut audio_speed_noise = if let Some(route) = route_decision {
        route.speed_and_noise() && !has_replacement_audio && !voice_enabled
    } else {
        request.audio_speed_noise.unwrap_or(false)
    };
    let cinematic =
        request.cinematic.unwrap_or(false) || auto_pipeline || delogo_enabled || upscale_enabled;
    let watermark_enabled = request.watermark.unwrap_or(auto_route || voice_enabled);
    let cinematic_focus_value = if cinematic {
        Some(
            cinematic_focus(request.cinematic_focus.as_deref())
                .map_err(|message| invalid_error(&message))?,
        )
    } else {
        None
    };
    let replacement_audio = request
        .replacement_audio
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if cinematic && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El look cinematográfico sólo se aplica a videos. Elegí un video o desactivalo.",
        ));
    }
    if cinematic && format != "mp4" {
        return Err(invalid_error(
            "El look cinematográfico exporta MP4. Elegí MP4 o desactivalo.",
        ));
    }
    if cinematic && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede aplicar el look cinematográfico.",
        ));
    }
    if voice_enabled && piper.is_none() {
        return Err(provider_error(
            "La voz IA local no está instalada: falta el recurso piper/es_voice.onnx.",
        ));
    }
    if let Some(audio) = &replacement_audio {
        if !audio.is_file() {
            return Err(invalid_error(
                "La banda sonora elegida no está en disco. Volvé a seleccionarla.",
            ));
        }
    }
    let compression_allowed = !audio_only && matches!(format, "mp4");
    if (requested_crf.is_some() || request.target_size_mb.is_some()) && !compression_allowed {
        return Err(invalid_error(
            "La compresión sólo se aplica al formato MP4. Elegí MP4 o desactivá la compresión.",
        ));
    }
    let target_size_mb = request
        .target_size_mb
        .filter(|mb| *mb >= 5)
        .map(|mb| mb.min(100_000));
    if request.target_size_mb.is_some() && target_size_mb.is_none() {
        return Err(invalid_error(
            "El tamaño objetivo debe ser de al menos 5 MB.",
        ));
    }
    let should_compress =
        compression_allowed && !cinematic && (requested_crf.is_some() || target_size_mb.is_some());
    let crf = if should_compress { requested_crf } else { None };
    if should_compress && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede comprimir. Elegí «Original» o configurá FFmpeg en Ajustes.",
        ));
    }
    let directory = cache_dir.join("downloads").join(&run_id);
    std::fs::create_dir_all(&directory)
        .map_err(|_| io_error("No se pudo crear la carpeta temporal de descarga."))?;
    let filename_template = request.filename_template.as_deref();
    let audio_language = audio_language(request.audio_language.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let audio_format_id = request
        .audio_format_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if valid_format_id(value) {
                Ok(value.to_owned())
            } else {
                Err(invalid_error("El format_id de audio no es válido."))
            }
        })
        .transpose()?;
    let playlist_items = playlist_items(request.playlist_items.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let output_template = download_output_template(&directory, filename_template)
        .map_err(|message| invalid_error(&message))?;
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
        "8",
        // Menos pedidos por fragmento: en redes con latencia alta, descargar
        // bloques de 10 MB reduce el tiempo total sin cambiar el archivo.
        "--http-chunk-size",
        "10M",
        "--no-overwrites",
    ]);
    if let Some(proxy) = proxy {
        command.args(["--proxy", proxy]);
    }
    if let Some(limit_rate) = limit_rate {
        command.args(["--limit-rate", limit_rate]);
    }
    if download_subtitles {
        command.args([
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            &subtitle_langs,
            "--convert-subs",
            "srt",
        ]);
    }
    if download_thumbnail {
        command.args(["--write-thumbnail", "--convert-thumbnails", "jpg"]);
    }
    if download_chapters {
        command.args(["--embed-chapters"]);
    }
    if sponsorblock && !sponsorblock_categories.trim().is_empty() {
        command.args(["--sponsorblock-remove", &sponsorblock_categories]);
    }
    if !sponsorblock_mark.is_empty() {
        let marked = sponsorblock_mark.join(",");
        command.args(["--sponsorblock-mark", &marked]);
    }
    if let Some(end) = trim_end {
        let section = format!("*{trim_start:.3}-{end:.3}");
        command.args(["--download-sections", &section, "--force-keyframes-at-cuts"]);
    }
    if playlist {
        command.args([
            "--playlist-items",
            playlist_items.as_deref().unwrap_or("1-12"),
        ]);
    } else if let Some(items) = playlist_items.as_deref() {
        command.args(["--yes-playlist", "--playlist-items", items]);
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
        let selector = audio_format_id
            .as_deref()
            .map(|id| format!("bv*+{id}"))
            .unwrap_or_else(|| video_format_selector(quality, max_height));
        command.arg("-f").arg(selector);
        command.args(["--merge-output-format", format, "--remux-video", format]);
    } else if kind == "audio" {
        command.args([
            "-f",
            audio_format_id.as_deref().unwrap_or("bestaudio/best"),
        ]);
    }
    if let Some(cookies) = cookies {
        command.arg("--cookies").arg(cookies);
    } else if let Some(browser) = cookies_from_browser.as_deref() {
        command.args(["--cookies-from-browser", browser]);
    }
    if let Some(language) = audio_language.as_deref() {
        if language == "all" {
            command.args(["--audio-multistreams"]);
        } else {
            command.args(["-S", &format!("lang:{language}")]);
        }
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
    if is_download_cancelled() {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(provider_error("Descarga cancelada."));
    }
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

    let effective_long_video = if auto_route && source_duration <= 0.0 {
        entries
            .iter()
            .find(|path| downloaded_kind(path) == "video")
            .and_then(|path| probe_duration(ffprobe.as_deref(), path))
            .map(|duration| duration > 60.0)
            .unwrap_or(long_video)
    } else {
        long_video
    };
    // Si la duración llegó vacía, el enrutador se resuelve recién ahora con
    // la duración real del archivo descargado.
    let final_route = if auto_route && source_duration <= 0.0 {
        Some(AutoRouteDecision::pick(
            if effective_long_video { 61.0 } else { 30.0 },
            &source_title,
        ))
    } else {
        route_decision
    };
    if let Some(route) = final_route {
        audio_speed_noise = route.speed_and_noise() && !has_replacement_audio && !voice_enabled;
    }
    let preserve_original_audio = auto_route
        && final_route.is_some_and(|route| route.music)
        && !voice_enabled
        && !audio_speed_noise
        && !has_replacement_audio;
    let audio_master =
        !voice_enabled && !has_replacement_audio && !audio_speed_noise && !preserve_original_audio;
    let mut warnings: Vec<String> = Vec::new();
    if let Some(route) = final_route {
        warnings.push(format!("Enrutamiento automático: {}.", route.summary()));
    }
    if let Some(control) = current_control() {
        control.wait_until_running();
        if control.is_cancelled() {
            let _ = std::fs::remove_dir_all(&directory);
            return Err(provider_error("Descarga cancelada."));
        }
    }
    let mut voice_path: Option<PathBuf> = None;
    if voice_enabled {
        progress("compressing", None, "Generando voz IA local con Piper…");
        if let Some(assets) = piper.as_ref() {
            let voice_file = directory.join("voice_ia.wav");
            match crate::commands::piper::synthesize(assets, &voice_script, &voice_file) {
                Ok(()) => voice_path = Some(voice_file),
                Err(error) => warnings.push(format!(
                    "No se pudo generar la voz IA: {}. Se usará el audio disponible.",
                    error.message
                )),
            }
        }
    }
    let effective_audio = voice_path.as_deref().or(replacement_audio.as_deref());
    let watermark_path = if watermark_enabled {
        watermark.as_deref()
    } else {
        None
    };
    if watermark_enabled && watermark.is_none() {
        warnings.push(
            "No se encontró watermark.png; el video se procesó sin marca de agua.".to_owned(),
        );
    }
    let pipeline_profile = if cinematic {
        ffmpeg
            .as_deref()
            .map(crate::commands::pipeline_profile::detect)
            .unwrap_or_else(crate::commands::pipeline_profile::PipelineProfile::software)
    } else {
        crate::commands::pipeline_profile::PipelineProfile::software()
    };
    if cinematic {
        warnings.push(format!("Perfil de encode: {}.", pipeline_profile.label));
    }
    let mut md5s: HashMap<PathBuf, String> = HashMap::new();
    let mut sha256s: HashMap<PathBuf, String> = HashMap::new();
    let mut compressed = false;
    if cinematic {
        if requested_crf.is_some() {
            warnings.push(
                "El look cinematográfico reencodea el video: se omitió la compresión elegida."
                    .to_owned(),
            );
        }
        let ffmpeg = ffmpeg.as_deref().ok_or_else(|| {
            provider_error("FFmpeg no está disponible para el look cinematográfico.")
        })?;
        let focus = cinematic_focus_value.unwrap_or("center");
        let mut applied = false;
        for path in entries.clone() {
            if downloaded_kind(&path) != "video" {
                continue;
            }
            match process_video(
                progress,
                ffmpeg,
                ffprobe.as_deref(),
                &path,
                focus,
                effective_audio,
                auto_pipeline,
                effective_long_video,
                audio_speed_noise,
                preserve_original_audio,
                audio_master,
                delogo_corner_value,
                manual_delogo,
                upscale_mode_value.as_deref(),
                watermark_path,
                &pipeline_profile,
            ) {
                Ok((new_path, md5, sha256)) => {
                    applied = true;
                    // Si se pidió conservar el original, queda en la lista y
                    // se mueve junto al procesado. Si no, se elimina.
                    if !keep_original {
                        let _ = std::fs::remove_file(&path);
                        entries.retain(|entry| entry != &path);
                    }
                    if let Some(md5) = md5 {
                        md5s.insert(new_path.clone(), md5);
                    }
                    if let Some(sha256) = sha256 {
                        sha256s.insert(new_path.clone(), sha256);
                    }
                    entries.push(new_path);
                }
                Err(message) => {
                    warnings.push(format!("No se pudo aplicar el post-proceso: {message}"))
                }
            }
        }
        if applied {
            compressed = true;
        } else {
            warnings.push(
                "Ningún video pudo procesarse con el look cinematográfico; se conservaron los originales."
                    .to_owned(),
            );
        }
        entries.sort();
    } else if should_compress {
        let ffmpeg = ffmpeg
            .as_deref()
            .ok_or_else(|| provider_error("FFmpeg no está disponible para comprimir el video."))?;
        for path in entries.clone() {
            if downloaded_kind(&path) != "video" {
                continue;
            }
            match compress_video(
                progress,
                ffmpeg,
                ffprobe.as_deref(),
                &path,
                crf,
                target_size_mb,
                codec,
                hdr_mode,
                keep_original,
            ) {
                Ok(Some(new_path)) => {
                    compressed = true;
                    if !keep_original {
                        entries.retain(|entry| entry != &path);
                    }
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

    if !sponsorblock_mute.is_empty() {
        if let (Some(ffmpeg), Some(video_id)) = (ffmpeg.as_deref(), youtube_video_id(&request.url)) {
            progress("compressing", None, "Silenciando tramos de SponsorBlock…");
            match fetch_sponsor_segments(&video_id, &sponsorblock_mute) {
                Ok(segments) if !segments.is_empty() => {
                    for entry in entries.iter_mut() {
                        if downloaded_kind(entry) != "video"
                            || !input_has_audio(ffprobe.as_deref(), entry)
                        {
                            continue;
                        }
                        match mute_audio_segments(ffmpeg, entry, &segments) {
                            Ok(()) => warnings.push(format!(
                                "Se silenciaron {} tramo(s) de SponsorBlock en {}.",
                                segments.len(),
                                entry
                                    .file_name()
                                    .map(|value| value.to_string_lossy().into_owned())
                                    .unwrap_or_default()
                            )),
                            Err(message) => warnings.push(format!(
                                "No se pudieron silenciar los tramos de {}: {message}",
                                entry
                                    .file_name()
                                    .map(|value| value.to_string_lossy().into_owned())
                                    .unwrap_or_default()
                            )),
                        }
                    }
                }
                Ok(_) => warnings.push(
                    "SponsorBlock no devolvió tramos para las categorías de silencio.".to_owned(),
                ),
                Err(error) => warnings.push(format!(
                    "No se pudo consultar SponsorBlock para silenciar: {}",
                    error.message
                )),
            }
        } else {
            warnings.push(
                "El silencio de SponsorBlock sólo aplica a videos de YouTube con FFmpeg disponible."
                    .to_owned(),
            );
        }
    }
    if let Some(path) = voice_path.as_ref() {
        let _ = std::fs::remove_file(path);
    }
    if is_download_cancelled() {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(provider_error("Descarga cancelada."));
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
                md5: md5s.get(&path).cloned(),
                sha256: sha256s.get(&path).cloned(),
                chapters: Vec::new(),
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
        subtitles: Vec::new(),
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
fn parse_playlist_entries(value: &Value, limit: usize) -> Vec<PlaylistEntry> {
    value["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(position, entry)| {
            let title = entry["title"].as_str()?.trim();
            if title.is_empty() {
                return None;
            }
            let url = entry["webpage_url"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| entry["url"].as_str().map(str::to_owned))
                .or_else(|| {
                    entry["id"]
                        .as_str()
                        .map(|id| format!("https://www.youtube.com/watch?v={id}"))
                });
            Some(PlaylistEntry {
                index: entry["playlist_index"]
                    .as_u64()
                    .map(|value| value as usize)
                    .unwrap_or(position + 1),
                title: title.chars().take(200).collect(),
                url,
                duration_seconds: entry["duration"].as_f64(),
            })
        })
        .take(limit.clamp(1, 1000))
        .collect()
}

fn parse_audio_tracks(value: &Value) -> Vec<AudioTrack> {
    let mut tracks = Vec::new();
    for format in value["formats"].as_array().into_iter().flatten() {
        if format["acodec"].as_str().unwrap_or("none") == "none" {
            continue;
        }
        if format["vcodec"].as_str().unwrap_or("none") != "none" {
            continue;
        }
        let Some(format_id) = format["format_id"].as_str() else {
            continue;
        };
        if tracks.iter().any(|track: &AudioTrack| track.format_id == format_id) {
            continue;
        }
        tracks.push(AudioTrack {
            format_id: format_id.to_owned(),
            language: format["language"].as_str().map(str::to_owned),
            ext: format["ext"].as_str().map(str::to_owned),
            abr: format["abr"].as_f64(),
            note: format["format_note"].as_str().map(str::to_owned),
        });
        if tracks.len() >= 30 {
            break;
        }
    }
    tracks.sort_by(|a, b| {
        b.abr
            .unwrap_or(0.0)
            .partial_cmp(&a.abr.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    tracks
}

fn valid_format_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+'))
}

fn audio_language(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let lower = value.to_ascii_lowercase();
    if lower == "all" {
        return Ok(Some(lower));
    }
    let valid = lower
        .split('-')
        .enumerate()
        .all(|(index, part)| {
            let expected = if index == 0 { 2..=3 } else { 2..=2 };
            expected.contains(&part.len()) && part.chars().all(|ch| ch.is_ascii_alphabetic())
        });
    if !valid || lower.split('-').count() > 2 {
        return Err("El idioma de audio debe ser un código como es, en, pt-BR o all.".to_owned());
    }
    Ok(Some(lower))
}

fn download_output_template(directory: &Path, template: Option<&str>) -> Result<String, String> {
    let default = "%(title).60s [%(id)s]";
    let custom = template.map(str::trim).filter(|value| !value.is_empty());
    let mut name = if let Some(custom) = custom {
        if custom.len() > 120
            || custom.contains("..")
            || custom.chars().any(|character| {
                character.is_control()
                    || matches!(
                        character,
                        '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                    )
            })
        {
            return Err(
                "La plantilla de nombre no puede superar 120 caracteres ni incluir rutas o caracteres prohibidos."
                    .to_owned(),
            );
        }
        custom
            .replace("{title}", "%(title).60s")
            .replace("{id}", "%(id)s")
            .replace("{platform}", "%(extractor)s")
            .replace("{height}", "%(height)s")
            .replace("{date}", "%(upload_date)s")
    } else {
        default.to_owned()
    };
    if name.trim().is_empty() {
        name = default.to_owned();
    }
    Ok(directory
        .join(format!("{name}.%(ext)s"))
        .to_string_lossy()
        .into_owned())
}

fn playlist_items(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 100
        || !value
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, ',' | '-' | ':'))
    {
        return Err(
            "Los elementos de playlist sólo aceptan números, comas, guiones y dos puntos (ej. 1-10 o 1,3,5)."
                .to_owned(),
        );
    }
    Ok(Some(value.to_owned()))
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
            md5: file.md5.clone(),
            sha256: file.sha256.clone(),
            chapters: file.chapters.clone(),
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
    mut request: DownloadRequest,
) -> Result<DownloadOutcome, ProjectError> {
    let tier = state.license_tier();
    let active = active_controls()
        .lock()
        .map(|controls| controls.len())
        .unwrap_or(0);
    if let Err(error) = check_parallel(tier, active) {
        return Err(ProjectError::message(
            ProjectErrorCode::LicenseRequired,
            &error.message,
        ));
    }
    let upscale_target = request
        .upscale
        .unwrap_or(false)
        .then(|| request.upscale_target.as_deref().unwrap_or("auto"));
    if let Err(error) = check_download(
        tier,
        request.max_height,
        request.codec.as_deref(),
        request.format.as_deref(),
        request.hdr_mode.as_deref(),
        upscale_target,
        request.sponsorblock.unwrap_or(false),
    ) {
        return Err(ProjectError::message(
            ProjectErrorCode::LicenseRequired,
            &error.message,
        ));
    }
    if tier == LicenseTier::Free {
        if request.max_height.is_none() {
            request.max_height = Some(1080);
        }
        if request.codec.is_none() {
            request.codec = Some("h264".to_owned());
        }
    }
    let engine = resolve_engine(&state.config_dir)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffmpeg_outcome = ffmpeg.clone();
    let ffprobe_outcome = ffprobe.clone();
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
    if let Some(root) = destination.as_ref() {
        if let Some(free) = available_disk_bytes(root) {
            let estimate = request.estimated_bytes.unwrap_or(0);
            let multiplier = if request.upscale.unwrap_or(false) {
                3
            } else {
                2
            };
            let required = if estimate > 0 {
                estimate.saturating_mul(multiplier)
            } else {
                1_500_000_000
            };
            if free < required {
                return Err(provider_error(format!(
                    "Espacio insuficiente en disco: hay {} MB libres y se estiman {} MB para esta descarga.",
                    free / 1_000_000,
                    required / 1_000_000
                )));
            }
        }
    }
    let run_id = request
        .run_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut request = DownloadRequest {
        url,
        run_id: Some(run_id.clone()),
        save_to_downloads: None,
        destination_root: None,
        ..request
    };
    request.cookies_file = None;
    let metadata_title = request.metadata_title.as_deref().map(|value| value.chars().take(200).collect::<String>());
    let metadata_artist = request.metadata_artist.as_deref().map(|value| value.chars().take(200).collect::<String>());
    let metadata_comment = request.metadata_comment.as_deref().map(|value| value.chars().take(500).collect::<String>());
    let cover_path = request
        .cover_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if let Some(cover) = cover_path.as_ref() {
        let extension = cover.extension().and_then(|value| value.to_str()).unwrap_or("");
        if !cover.is_file() || !IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()) {
            return Err(invalid_error("La carátula elegida no es una imagen válida."));
        }
    }
    let hash_files = request.hash_files.unwrap_or(false);
    let expected_sha256 = match request
        .expected_sha256
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value)
            if value.len() == 64
                && value.chars().all(|ch| ch.is_ascii_hexdigit()) =>
        {
            Some(value.to_ascii_lowercase())
        }
        Some(_) => {
            return Err(invalid_error(
                "El SHA-256 esperado debe tener 64 caracteres hexadecimales.",
            ))
        }
        None => None,
    };
    let piper_assets = crate::commands::piper::resolve_assets(&app);
    let watermark_asset = crate::commands::piper::resolve_watermark(&app);
    let progress_app = app.clone();
    let progress_run = run_id.clone();
    let progress = move |stage: &str, percent: Option<f64>, message: &str| {
        emit_progress(&progress_app, &progress_run, stage, percent, message.to_owned());
    };
    let blocking_result = tauri::async_runtime::spawn_blocking(move || {
        download_blocking(
            &progress,
            &engine,
            &cache_dir,
            request,
            ffmpeg,
            ffprobe,
            cookies.as_deref(),
            piper_assets,
            watermark_asset,
        )
    })
    .await;
    let mut outcome =
        blocking_result.map_err(|_| provider_error("La descarga se interrumpió."))??;
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
    outcome.subtitles = read_download_subtitles(&outcome.files);
    if let Some(ffmpeg) = ffmpeg_outcome.as_deref() {
        for file in &mut outcome.files {
            if !matches!(file.kind.as_str(), "video" | "audio") {
                continue;
            }
            let extension = Path::new(&file.path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if cover_path.is_some() && extension == "webm" {
                outcome.warnings.push(
                    "WebM no admite carátula adjunta; se escribieron sólo los metadatos."
                        .to_owned(),
                );
            }
            match apply_metadata_cover(
                ffmpeg,
                Path::new(&file.path),
                metadata_title.as_deref(),
                metadata_artist.as_deref(),
                metadata_comment.as_deref(),
                cover_path.as_deref(),
            ) {
                Ok(()) => {
                    if let Ok(metadata) = std::fs::metadata(&file.path) {
                        file.bytes = metadata.len();
                    }
                }
                Err(message) => outcome
                    .warnings
                    .push(format!("No se pudieron escribir metadatos en {}: {message}", file.name)),
            }
        }
    }
    if hash_files || expected_sha256.is_some() {
        let mut matched = false;
        for file in &mut outcome.files {
            if file.sha256.is_none() {
                let (md5, sha256) = hash_file(Path::new(&file.path));
                if md5.is_some() {
                    file.md5 = md5;
                }
                file.sha256 = sha256;
            }
            if expected_sha256
                .as_deref()
                .is_some_and(|expected| file.sha256.as_deref() == Some(expected))
            {
                matched = true;
            }
        }
        if let Some(expected) = expected_sha256 {
            if matched {
                outcome
                    .warnings
                    .push("SHA-256 esperado verificado en un archivo descargado.".to_owned());
            } else {
                return Err(invalid_error(format!(
                    "Ningún archivo coincide con el SHA-256 esperado ({expected}). Los archivos quedaron en {}.",
                    outcome.directory
                )));
            }
        }
    }
    for file in &mut outcome.files {
        if file.kind == "video" {
            file.chapters = probe_chapters(ffprobe_outcome.as_deref(), Path::new(&file.path));
        }
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
        let template = download_output_template(Path::new("C:/cache"), None).unwrap();
        assert!(template.contains("%(title).60s"));
        assert!(!template.contains("%(title).120s"));
        assert!(template.contains("[%(id)s]"));
        let custom =
            download_output_template(Path::new("C:/cache"), Some("{date}-{title}-{height}"))
                .unwrap();
        assert!(custom.contains("%(upload_date)s"));
        assert!(custom.contains("%(title).60s"));
        assert!(custom.contains("%(height)s"));
        assert!(download_output_template(Path::new("C:/cache"), Some("../escape")).is_err());
        assert!(download_output_template(Path::new("C:/cache"), Some("a/b")).is_err());
    }

    #[test]
    fn playlist_entries_parse_flat_json() {
        let value: Value = serde_json::from_str(
            r#"{"entries":[
                {"id":"abc","title":"Primero","duration":12.5,"playlist_index":1},
                {"id":"def","title":"","playlist_index":2},
                {"id":"ghi","title":"Tercero","webpage_url":"https://example.com/v","playlist_index":3}
            ]}"#,
        )
        .unwrap();
        let entries = parse_playlist_entries(&value, 10);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].index, 1);
        assert_eq!(entries[0].title, "Primero");
        assert_eq!(entries[0].duration_seconds, Some(12.5));
        assert_eq!(
            entries[0].url.as_deref(),
            Some("https://www.youtube.com/watch?v=abc")
        );
        assert_eq!(entries[1].url.as_deref(), Some("https://example.com/v"));
    }

    #[test]
    fn audio_tracks_filter_video_and_sort_by_bitrate() {
        let value: Value = serde_json::from_str(
            r#"{"formats":[
                {"format_id":"140","acodec":"aac","vcodec":"none","abr":129,"ext":"m4a","language":"en","format_note":"medium"},
                {"format_id":"251","acodec":"opus","vcodec":"none","abr":160,"ext":"webm","language":"es"},
                {"format_id":"137","acodec":"none","vcodec":"avc1","abr":null},
                {"format_id":"140","acodec":"aac","vcodec":"none","abr":129}
            ]}"#,
        )
        .unwrap();
        let tracks = parse_audio_tracks(&value);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].format_id, "251");
        assert_eq!(tracks[0].language.as_deref(), Some("es"));
        assert!(valid_format_id("140-drc"));
        assert!(!valid_format_id("140; rm"));
    }

    #[test]
    fn audio_language_accepts_iso_and_all() {
        assert_eq!(audio_language(Some("ES")).unwrap().as_deref(), Some("es"));
        assert_eq!(audio_language(Some("pt-BR")).unwrap().as_deref(), Some("pt-br"));
        assert_eq!(audio_language(Some("all")).unwrap().as_deref(), Some("all"));
        assert!(audio_language(Some("es; rm")).is_err());
        assert!(audio_language(Some("english")).is_err());
        assert!(audio_language(None).unwrap().is_none());
    }

    #[test]
    fn playlist_items_validate_ranges_and_lists() {
        assert_eq!(playlist_items(Some("1-10")).unwrap().as_deref(), Some("1-10"));
        assert_eq!(playlist_items(Some("1,3,5")).unwrap().as_deref(), Some("1,3,5"));
        assert!(playlist_items(Some("1; rm -rf")).is_err());
        assert!(playlist_items(None).unwrap().is_none());
    }

    #[test]
    fn hash_file_matches_known_digests() {
        let path = std::env::temp_dir().join(format!("editoria-hash-{}", Uuid::new_v4()));
        std::fs::write(&path, b"abc").unwrap();
        let (md5, sha256) = hash_file(&path);
        assert_eq!(md5.as_deref(), Some("900150983cd24fb0d6963f7d28e17f72"));
        assert_eq!(
            sha256.as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        let _ = std::fs::remove_file(path);
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
            md5: None,
            sha256: None,
            chapters: Vec::new(),
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
                md5: None,
                sha256: None,
                chapters: Vec::new(),
            }],
            compressed: false,
            warnings: Vec::new(),
            subtitles: Vec::new(),
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
    fn validates_cookie_browsers() {
        assert_eq!(cookies_browser(None).unwrap(), None);
        assert_eq!(
            cookies_browser(Some("Chrome")).unwrap(),
            Some("chrome".to_owned())
        );
        assert_eq!(
            cookies_browser(Some("edge")).unwrap(),
            Some("edge".to_owned())
        );
        assert!(cookies_browser(Some("safari")).is_err());
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
        let probe = probe_with_engine(
            &engine,
            "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            None,
            None,
        )
        .unwrap();
        assert_eq!(probe.kind, "video");
        assert!(!probe.title.is_empty());
        assert!(!probe.qualities.is_empty());
        let cache = std::env::temp_dir().join(format!("editor-ia-dl-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&cache).unwrap();
        let request = DownloadRequest {
            url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ".to_owned(),
            run_id: None,
            max_height: Some(360),
            compression: Some("compact".to_owned()),
            codec: Some("h264".to_owned()),
            hdr_mode: None,
            target_size_mb: None,
            keep_original: None,
            kind: Some("video".to_owned()),
            playlist: Some(false),
            cookies_file: None,
            cookies_from_browser: None,
            format: Some("mp4".to_owned()),
            save_to_downloads: None,
            quality: None,
            destination_root: None,
            cinematic: None,
            cinematic_focus: None,
            replacement_audio: None,
            auto_pipeline: None,
            audio_speed_noise: None,
            voice_pipeline: None,
            voice_script: None,
            watermark: None,
            delogo: None,
            delogo_corner: None,
            delogo_rect: None,
            upscale: None,
            upscale_target: None,
            auto_route: None,
            source_title: None,
            source_duration: None,
            proxy: None,
            limit_rate: None,
            download_subtitles: None,
            subtitle_langs: None,
            download_thumbnail: None,
            download_chapters: None,
            sponsorblock: None,
            sponsorblock_categories: None,
            sponsorblock_mark: None,
            sponsorblock_mute: None,
            filename_template: None,
            playlist_items: None,
            audio_language: None,
            audio_format_id: None,
            metadata_title: None,
            metadata_artist: None,
            metadata_comment: None,
            cover_path: None,
            hash_files: None,
            expected_sha256: None,
            trim_start: None,
            trim_end: None,
            estimated_bytes: None,
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
            None,
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

    #[test]
    fn cinematic_filter_contains_the_full_recipe() {
        let filter = cinematic_filter("center");
        assert!(filter.contains("setpts=PTS/0.98"));
        assert!(filter.contains("minterpolate=fps=60"));
        assert!(filter.contains("mi_mode=mci"));
        assert!(filter.contains("eq=gamma=0.95:contrast=1.08:saturation=1.12"));
        assert!(filter.contains("scale=trunc(iw*1.04/2)*2"));
        assert!(filter.contains("hflip"));
        assert!(filter.contains("noise=alls=8:allf=t+u"));
        assert!(filter.contains("(iw-ow)*0.5:(ih-oh)*0.5"));
    }

    #[test]
    fn long_video_filter_avoids_optical_flow_and_keeps_geometry() {
        let filter = fast_cinematic_filter("right");
        assert!(filter.contains("fps=60"));
        assert!(!filter.contains("minterpolate"));
        assert!(!filter.contains("noise=alls"));
        assert!(!filter.contains("hqdn3d"));
        assert!(filter.contains("hflip"));
        assert!(filter.contains("(iw-ow)*0.67"));
    }

    #[test]
    fn delogo_rect_scales_to_canvas_and_stays_inside() {
        let hd = delogo_rect(1920, 1080, "top-right").unwrap();
        assert_eq!(
            hd,
            DelogoRect {
                x: 1760,
                y: 20,
                w: 140,
                h: 50
            }
        );
        let small = delogo_rect(320, 180, "top-right").unwrap();
        assert!(small.x + small.w <= 320);
        assert!(small.y + small.h <= 180);
        assert!(small.w >= 16 && small.h >= 16);
        let bottom = delogo_rect(1920, 1080, "bottom-left").unwrap();
        assert_eq!(bottom.x, 20);
        assert_eq!(bottom.y, 1080 - 50 - 20);
        assert!(delogo_rect(100, 50, "top-right").is_none());
    }

    #[test]
    fn manual_delogo_rect_scales_fractions_and_rejects_overflow() {
        let rect = manual_delogo_rect(
            1920,
            1080,
            DelogoManualRect {
                x: 0.10,
                y: 0.20,
                w: 0.25,
                h: 0.10,
            },
        )
        .expect("rect");
        assert_eq!(
            rect,
            DelogoRect {
                x: 192,
                y: 216,
                w: 480,
                h: 108
            }
        );
        assert!(manual_delogo_rect(
            1920,
            1080,
            DelogoManualRect {
                x: 0.9,
                y: 0.9,
                w: 0.2,
                h: 0.2
            }
        )
        .is_none());
    }

    #[test]
    fn delogo_corner_accepts_spanish_and_rejects_unknown() {
        assert_eq!(
            delogo_corner(Some("superior-derecha")).unwrap(),
            "top-right"
        );
        assert_eq!(delogo_corner(Some("bottom_left")).unwrap(), "bottom-left");
        assert!(delogo_corner(Some("diagonal")).is_err());
    }

    #[test]
    fn upscale_only_when_source_is_below_target() {
        assert!(upscale_target(1920, 1080, false, "auto").is_none());
        assert!(upscale_target(3840, 2160, false, "1080").is_none());
        let hd = upscale_target(1280, 720, false, "auto").unwrap();
        assert_eq!((hd.width, hd.height), (1920, 1080));
        let long = upscale_target(1920, 1080, true, "auto").unwrap();
        assert_eq!((long.width, long.height), (3840, 2160));
        let portrait = upscale_target(720, 1280, false, "auto").unwrap();
        assert_eq!((portrait.width, portrait.height), (1080, 1920));
        let explicit = upscale_target(1280, 720, false, "2160").unwrap();
        assert_eq!((explicit.width, explicit.height), (3840, 2160));
    }

    #[test]
    fn pipeline_filter_orders_denoise_delogo_lanczos_and_look() {
        let rect = DelogoRect {
            x: 160,
            y: 20,
            w: 140,
            h: 50,
        };
        let plan = UpscalePlan {
            width: 1920,
            height: 1080,
        };
        let filter = pipeline_filter_with("center", Some(rect), Some(plan));
        let denoise = filter.find("hqdn3d=").unwrap();
        let delogo = filter.find("delogo=x=160:y=20:w=140:h=50").unwrap();
        let lanczos = filter.find("flags=lanczos").unwrap();
        let look = filter.find("eq=gamma=0.95").unwrap();
        assert!(denoise < delogo);
        assert!(delogo < lanczos);
        assert!(lanczos < look);
        assert!(filter.contains("hflip"));
        assert!(filter.contains("noise=alls=8"));
        assert!(filter.contains("pad=1920:1080"));
    }

    #[test]
    fn upscaled_zoom_keeps_exact_target_dimensions() {
        let plan = UpscalePlan {
            width: 1920,
            height: 1080,
        };
        let filter = cinematic_filter_with("center", None, Some(plan));
        assert!(filter.contains("scale=1996:1122"));
        assert!(filter.contains("crop=1920:1080:"));
        let plan4k = UpscalePlan {
            width: 3840,
            height: 2160,
        };
        let filter4k = fast_cinematic_filter_with("center", None, Some(plan4k));
        assert!(filter4k.contains("scale=3992:2246"));
        assert!(filter4k.contains("crop=3840:2160:"));

        let portrait = UpscalePlan {
            width: 1080,
            height: 1920,
        };
        let filter_portrait = cinematic_filter_with("center", None, Some(portrait));
        assert!(filter_portrait.contains("scale=1122:1996"));
        assert!(filter_portrait.contains("crop=1080:1920:"));
    }

    #[test]
    fn fast_filter_keeps_delogo_and_lanczos_without_optical_flow() {
        let rect = DelogoRect {
            x: 0,
            y: 0,
            w: 16,
            h: 16,
        };
        let plan = UpscalePlan {
            width: 3840,
            height: 2160,
        };
        let filter = fast_cinematic_filter_with("right", Some(rect), Some(plan));
        assert!(filter.starts_with("[0:v]hqdn3d="));
        assert!(filter.contains("delogo=x=0:y=0:w=16:h=16"));
        assert!(filter.contains("scale=3840:2160"));
        assert!(filter.find("hqdn3d").unwrap() < filter.find("delogo").unwrap());
        assert!(filter.find("delogo").unwrap() < filter.find("scale=3840").unwrap());
        assert!(!filter.contains("minterpolate"));
        assert!(!filter.contains("noise=alls"));
    }

    #[test]
    fn reads_srt_downloaded_next_to_the_video() {
        let root = std::env::temp_dir().join(format!("editoria-srt-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let srt = root.join("video.es.srt");
        std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,000\nHola\n").unwrap();
        let file = DownloadedFile {
            path: srt.to_string_lossy().into_owned(),
            name: "video.es.srt".to_owned(),
            bytes: 40,
            kind: "other".to_owned(),
            md5: None,
            sha256: None,
            chapters: Vec::new(),
        };
        let subtitles = read_download_subtitles(&[file]);
        assert_eq!(subtitles.len(), 1);
        assert!(subtitles[0].text.contains("Hola"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn control_commands_require_an_active_download() {
        assert!(pause_download(None).is_err());
        assert!(resume_download(None).is_err());
        assert!(cancel_download(None).is_err());
    }

    #[test]
    fn parallel_downloads_have_independent_controls() {
        let first = Uuid::new_v4().to_string();
        let second = Uuid::new_v4().to_string();
        let control_a = register_control(&first).unwrap();
        let control_b = register_control(&second).unwrap();
        assert!(!Arc::ptr_eq(&control_a, &control_b));
        assert!(register_control(&first).is_err());
        assert!(control_for(None).is_err());
        assert!(pause_download(Some(first.clone())).unwrap());
        assert!(control_a.is_paused());
        assert!(!control_b.is_paused());
        assert!(resume_download(Some(first.clone())).unwrap());
        assert!(!control_a.is_paused());
        assert!(cancel_download(Some(second.clone())).unwrap());
        assert!(control_b.is_cancelled());
        assert!(!control_a.is_cancelled());
        remove_control(&first);
        remove_control(&second);
        assert!(control_for(Some(first.as_str())).is_err());
    }

    #[test]
    fn measures_free_disk_space_on_windows() {
        if !cfg!(windows) {
            return;
        }
        let free = available_disk_bytes(Path::new("C:\\")).expect("free space");
        assert!(free > 0);
    }

    #[test]
    fn validates_subtitle_languages_and_sponsor_categories() {
        assert_eq!(subtitle_languages(None).unwrap(), "es.*,en.*");
        assert!(subtitle_languages(Some("es.*,en.*")).is_ok());
        assert!(subtitle_languages(Some("es; rm -rf")).is_err());
        assert_eq!(
            sponsorblock_categories(None).unwrap(),
            "sponsor,selfpromo,interaction"
        );
        assert!(sponsorblock_categories(Some("sponsor,intro,outro")).is_ok());
        assert!(sponsorblock_categories(Some("sponsor,unknown")).is_err());
        assert!(sponsorblock_categories(Some(" , ")).is_err());
    }

    #[test]
    fn youtube_ids_are_extracted_from_common_urls() {
        for url in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://m.youtube.com/live/dQw4w9WgXcQ",
        ] {
            assert_eq!(
                youtube_video_id(url).as_deref(),
                Some("dQw4w9WgXcQ"),
                "{url}"
            );
        }
        assert!(youtube_video_id("https://vimeo.com/12345").is_none());
        assert!(youtube_video_id("https://youtube.com/watch?v=short").is_none());
        assert!(youtube_video_id("https://youtube.com/watch?v=bad!chars123").is_none());
    }

    #[test]
    fn sponsor_segments_parse_and_skip_invalid_ranges() {
        let value: Value = serde_json::from_str(
            r#"[
                {"category":"sponsor","actionType":"skip","segment":[12.5,25.0]},
                {"category":"intro","actionType":"skip","segment":[5,5]},
                {"category":"outro","actionType":"mute","segment":[30,40]},
                {"category":"broken"}
            ]"#,
        )
        .unwrap();
        let segments = parse_sponsor_segments(&value);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].category, "sponsor");
        assert_eq!(segments[0].start_seconds, 12.5);
        assert_eq!(segments[1].action, "mute");
    }

    #[test]
    fn sponsorblock_preview_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let result = tauri::async_runtime::block_on(sponsorblock_preview(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_owned(),
            Some("sponsor,intro,outro".to_owned()),
        ));
        match result {
            Ok(segments) => eprintln!("SponsorBlock segmentos: {}", segments.len()),
            Err(error) => panic!("SponsorBlock no respondió: {error:?}"),
        }
        assert!(tauri::async_runtime::block_on(sponsorblock_preview(
            "https://vimeo.com/123".to_owned(),
            None
        ))
        .is_err());
    }

    #[test]
    fn music_titles_keep_the_original_audio() {
        assert!(title_prefers_original_audio("My favorite song (cover)"));
        assert!(title_prefers_original_audio("Lyrics video"));
        assert!(!title_prefers_original_audio("Tutorial de edición"));
    }

    #[test]
    fn auto_route_short_video_keeps_and_masters_original_audio() {
        let route = AutoRouteDecision::pick(30.0, "Tutorial de edición");
        assert!(!route.long_video);
        assert!(route.master_original_audio());
        assert!(!route.speed_and_noise());
        assert!(!route.preserves_original_audio_without_voice());
        assert!(route.summary().contains("audio original masterizado"));
    }

    #[test]
    fn auto_route_long_video_uses_fast_path_and_audio_treatment() {
        let route = AutoRouteDecision::pick(61.0, "Documental completo");
        assert!(route.long_video);
        assert!(!route.master_original_audio());
        assert!(route.speed_and_noise());
        assert!(!route.preserves_original_audio_without_voice());
        assert!(route.summary().contains("sin flujo óptico"));
    }

    #[test]
    fn auto_route_music_keeps_the_original_audio_even_if_long() {
        let short = AutoRouteDecision::pick(45.0, "Official music video");
        assert!(!short.master_original_audio());
        assert!(!short.speed_and_noise());
        assert!(short.preserves_original_audio_without_voice());

        let long = AutoRouteDecision::pick(180.0, "Concierto en vivo · music");
        assert!(long.long_video);
        assert!(!long.master_original_audio());
        assert!(!long.speed_and_noise());
        assert!(long.preserves_original_audio_without_voice());
        assert!(long.summary().contains("audio original intacto"));
    }

    #[test]
    fn short_route_never_synthesizes_voice_automatically() {
        // La voz sólo entra si voice_pipeline=true explícito; el resumen debe
        // hablar de mastering, no de Piper.
        let route = AutoRouteDecision::pick(20.0, "Clip de producto");
        assert!(route.master_original_audio());
        assert!(!route.summary().contains("Piper"));
    }

    #[test]
    fn audio_treatment_speeds_and_noise_mixes() {
        assert!(audio_treatment_filter().contains("atempo=1.02"));
        assert!(audio_treatment_filter().contains("loudnorm=I=-14"));
        let mix = audio_noise_mix_filter();
        assert!(mix.contains("atempo=1.02"));
        assert!(mix.contains("amix=inputs=2"));
        assert!(mix.contains("alimiter"));
    }

    #[test]
    fn audio_master_keeps_pitch_and_speed() {
        let master = audio_master_filter();
        assert!(master.contains("highpass=f=55"));
        assert!(master.contains("loudnorm=I=-14"));
        assert!(!master.contains("atempo"));
        assert!(!master.contains("asetrate"));
        assert!(!master.contains("anoisesrc"));
    }

    #[test]
    fn pipeline_filter_puts_denoise_before_the_look() {
        let filter = pipeline_filter("center");
        assert!(filter.starts_with("[0:v]hqdn3d=1.86:1.39:2.80:2.15,setpts=PTS/0.98"));
        assert!(filter.contains("minterpolate=fps=60"));
        assert!(filter.contains("noise=alls=8"));
    }

    #[test]
    fn cinematic_focus_moves_the_third_crop() {
        let left = cinematic_filter("left");
        assert!(left.contains("(iw-ow)*0.33:(ih-oh)*0.5"));
        let top = cinematic_filter("top");
        assert!(top.contains("(iw-ow)*0.5:(ih-oh)*0.33"));
        assert!(cinematic_focus(Some("izquierda")).is_ok());
        assert!(cinematic_focus(Some("centro")).is_ok());
        assert!(cinematic_focus(Some("diagonal")).is_err());
    }

    /// Prueba real de FFmpeg, opcional para no depender de la red ni del tiempo
    /// de CI. Genera un clip sintético y verifica que el look salga a 60 fps.
    #[test]
    fn cinematic_render_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("cinematic_render_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let root = std::env::temp_dir().join(format!("editoria-cine-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("base.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=160x90:rate=30:duration=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let output = cinematic_video(&|_, _, _| {}, &ffmpeg, &input, "center", None).unwrap();
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=avg_frame_rate,width,height,codec_name",
                "-of",
                "json",
            ])
            .arg(&output)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["avg_frame_rate"].as_str(), Some("60/1"));
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
        // El zoom del 4 % se redondea a dimensiones pares para H.264; en
        // resoluciones chicas pierde hasta 2 px, en 1080p es imperceptible.
        let width = value["streams"][0]["width"].as_u64().unwrap_or(0);
        let height = value["streams"][0]["height"].as_u64().unwrap_or(0);
        assert!((156..=160).contains(&width), "ancho inesperado: {width}");
        assert!((86..=90).contains(&height), "alto inesperado: {height}");
        assert_eq!(width % 2, 0);
        assert_eq!(height % 2, 0);

        // Segunda pasada: reemplazo de audio masterizado a -14 LUFS.
        let audio = root.join("banda.wav");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=330:duration=2",
            ])
            .arg(&audio)
            .status()
            .unwrap();
        assert!(status.success());
        let with_audio =
            cinematic_video(&|_, _, _| {}, &ffmpeg, &input, "left", Some(&audio)).unwrap();
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
            ])
            .arg(&with_audio)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        let kinds = value["streams"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|stream| stream["codec_type"].as_str())
            .collect::<Vec<_>>();
        assert!(kinds.contains(&"video"));
        assert!(kinds.contains(&"audio"));

        // Pipeline automático: H.265 CRF 22, MD5 nuevo y audio limpio.
        let (pipeline_path, md5, sha256) = process_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input,
            "center",
            None,
            true,
            false,
            false,
            false,
            false,
            None,
            None,
            None,
            None,
            &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
        )
        .unwrap();
        let hash = md5.expect("el pipeline debe devolver MD5");
        assert_eq!(hash.len(), 32);
        assert!(hash.chars().all(|ch| ch.is_ascii_hexdigit()));
        let sha = sha256.expect("el pipeline debe devolver SHA-256");
        assert_eq!(sha.len(), 64);
        assert!(sha.chars().all(|ch| ch.is_ascii_hexdigit()));
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,avg_frame_rate",
                "-of",
                "json",
            ])
            .arg(&pipeline_path)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
        assert_eq!(value["streams"][0]["avg_frame_rate"].as_str(), Some("60/1"));

        // Audio original limpio: el pipeline lo conserva y normaliza si no
        // se eligió una banda nueva.
        let input_audio = root.join("base-con-audio.mp4");
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-y", "-i"])
            .arg(&input)
            .arg("-i")
            .arg(&audio)
            .args(["-c:v", "copy", "-c:a", "aac", "-shortest"])
            .arg(&input_audio)
            .status()
            .unwrap();
        assert!(status.success());
        let (clean_audio, _, _) = process_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input_audio,
            "center",
            None,
            true,
            false,
            true,
            false,
            false,
            None,
            None,
            None,
            None,
            &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
        )
        .unwrap();
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
            ])
            .arg(&clean_audio)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert!(value["streams"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|stream| stream["codec_type"].as_str() == Some("audio")));

        // Corto: audio original masterizado, sin voz ni 1,02×.
        let (mastered, _, _) = process_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input_audio,
            "center",
            None,
            true,
            false,
            false,
            false,
            true,
            None,
            None,
            None,
            None,
            &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
        )
        .unwrap();
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
            ])
            .arg(&mastered)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert!(value["streams"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|stream| stream["codec_type"].as_str() == Some("audio")));

        // Ruta larga simulada: sin flujo óptico, 60 fps y audio original sin
        // filtros de velocidad ni ruido (se conserva como AAC).
        let (fast_path, _, _) = process_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input_audio,
            "right",
            None,
            true,
            true,
            false,
            true,
            false,
            None,
            None,
            None,
            None,
            &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
        )
        .unwrap();
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,avg_frame_rate",
                "-of",
                "json",
            ])
            .arg(&fast_path)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        let streams = value["streams"].as_array().cloned().unwrap_or_default();
        assert!(streams
            .iter()
            .any(|stream| stream["codec_type"].as_str() == Some("audio")));
        let video = streams
            .iter()
            .find(|stream| stream["codec_type"].as_str() == Some("video"))
            .expect("video");
        assert_eq!(video["avg_frame_rate"].as_str(), Some("60/1"));

        // Voz Piper + marca de agua en una sola pasada.
        let piper_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/piper");
        let piper_assets = crate::commands::piper::PiperAssets::from_root(&piper_root)
            .expect("voz Piper empaquetada");
        let voice = root.join("voice_ia.wav");
        crate::commands::piper::synthesize(
            &piper_assets,
            "Hola, esta es la narración automática de Olyvia.",
            &voice,
        )
        .expect("Piper");
        let watermark = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/watermark.png");
        let (voiced, _, _) = process_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input,
            "center",
            Some(&voice),
            true,
            false,
            false,
            false,
            false,
            None,
            None,
            None,
            Some(&watermark),
            &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
        )
        .unwrap();
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,codec_name",
                "-of",
                "json",
            ])
            .arg(&voiced)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        let kinds = value["streams"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|stream| stream["codec_type"].as_str())
            .collect::<Vec<_>>();
        assert!(kinds.contains(&"video"));
        assert!(kinds.contains(&"audio"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Delogo + Lanczos con FFmpeg real. Mide YMAX en la zona del logo antes y
    /// después para demostrar que el parche interpola y que el escalado final
    /// conserva exactamente 1920×1080.
    #[test]
    fn delogo_and_lanczos_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("delogo_and_lanczos_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let root = std::env::temp_dir().join(format!("editoria-delogo-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("logo.mp4");
        let rect = delogo_rect(320, 180, "top-right").expect("rect");
        let draw = format!(
            "drawbox=x={}:y={}:w={}:h={}:color=white:t=fill",
            rect.x, rect.y, rect.w, rect.h
        );
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x202020:size=320x180:rate=30:duration=1",
                "-vf",
            ])
            .arg(&draw)
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());

        let ymax = |path: &Path, crop: &str| -> u32 {
            let filter = format!("{crop},signalstats,metadata=print:key=lavfi.signalstats.YMAX");
            let output = Command::new(&ffmpeg)
                .args(["-hide_banner", "-v", "info", "-i"])
                .arg(path)
                .args(["-vf", &filter, "-frames:v", "1", "-f", "null", "-"])
                .output()
                .unwrap();
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .filter_map(|line| line.split("lavfi.signalstats.YMAX=").nth(1))
                .filter_map(|value| value.trim().parse::<u32>().ok())
                .max()
                .unwrap_or(0)
        };
        let logo_crop = format!("crop={}:{}:{}:{}", rect.w, rect.h, rect.x, rect.y);
        let before = ymax(&input, &logo_crop);
        assert!(before > 200, "logo sintético ausente: YMAX={before}");

        let (output_path, md5, sha256) = process_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input,
            "center",
            None,
            false,
            false,
            false,
            false,
            false,
            Some("top-right"),
            None,
            Some("1080"),
            None,
            &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
        )
        .unwrap();
        let md5 = md5.expect("el look manual también debe devolver MD5");
        let sha256 = sha256.expect("el look manual también debe devolver SHA-256");
        assert_eq!(md5.len(), 32);
        assert_eq!(sha256.len(), 64);
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,codec_name",
                "-of",
                "json",
            ])
            .arg(&output_path)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["width"].as_u64(), Some(1920));
        assert_eq!(value["streams"][0]["height"].as_u64(), Some(1080));
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));

        // El hflip mueve el logo a la esquina superior izquierda; se mide una
        // zona amplia que incluye el parche después del zoom del 4 %.
        let after = ymax(&output_path, "crop=640:320:0:0");
        eprintln!("delogo YMAX: antes={before}, después={after}");
        assert!(
            after < 180,
            "delogo no atenuó el logo: YMAX antes={before}, después={after}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    fn mean_volume(ffmpeg: &Path, path: &Path, at: f64) -> f64 {
        let output = Command::new(ffmpeg)
            .args(["-hide_banner", "-v", "info", "-ss", &format!("{at:.2}"), "-t", "0.5", "-i"])
            .arg(path)
            .args(["-af", "volumedetect", "-f", "null", "-"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stderr)
            .lines()
            .find_map(|line| {
                line.split("mean_volume:")
                    .nth(1)
                    .and_then(|value| value.trim().trim_end_matches(" dB").parse::<f64>().ok())
            })
            .unwrap_or(-100.0)
    }

    #[test]
    fn metadata_and_cover_embed_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let root = std::env::temp_dir().join(format!("editoria-meta-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let video = root.join("meta.mp4");
        let cover = root.join("cover.jpg");
        assert!(Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(&video)
            .status()
            .unwrap()
            .success());
        assert!(Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=128x128:duration=1", "-frames:v", "1"])
            .arg(&cover)
            .status()
            .unwrap()
            .success());
        apply_metadata_cover(
            &ffmpeg,
            &video,
            Some("Título de prueba"),
            Some("Olyvia"),
            Some("Comentario"),
            Some(&cover),
        )
        .unwrap();
        let probe = Command::new(&ffprobe)
            .args([
                "-v", "error", "-show_entries",
                "stream=codec_name,codec_type:stream_disposition=attached_pic",
                "-show_entries", "format_tags=title,artist,comment",
                "-of", "json",
            ])
            .arg(&video)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["format"]["tags"]["title"].as_str(), Some("Título de prueba"));
        assert_eq!(value["format"]["tags"]["artist"].as_str(), Some("Olyvia"));
        let streams = value["streams"].as_array().unwrap();
        assert!(streams.iter().any(|stream| {
            stream["codec_name"].as_str() == Some("mjpeg")
                && stream["disposition"]["attached_pic"].as_u64() == Some(1)
        }));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn sponsorblock_mute_silences_only_the_segment_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let root = std::env::temp_dir().join(format!("editoria-mute-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("mute.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i",
                "testsrc2=size=320x180:rate=30:duration=6", "-f", "lavfi", "-i",
                "sine=frequency=440:duration=6", "-c:v", "libx264", "-preset", "ultrafast",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
            ])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let before = mean_volume(&ffmpeg, &input, 3.0);
        let segments = vec![SponsorSegment {
            category: "sponsor".to_owned(),
            start_seconds: 2.0,
            end_seconds: 4.0,
            action: "skip".to_owned(),
        }];
        mute_audio_segments(&ffmpeg, &input, &segments).unwrap();
        let after = mean_volume(&ffmpeg, &input, 3.0);
        let outside = mean_volume(&ffmpeg, &input, 4.5);
        eprintln!("mute: antes={before} después={after} fuera={outside}");
        assert!(before > -40.0, "el audio original no sonó: {before}");
        assert!(after < -60.0, "el tramo no quedó en silencio: {after}");
        assert!(outside > -40.0, "se silenció fuera del tramo: {outside}");
        let webm = root.join("mute.webm");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner", "-v", "error", "-y", "-f", "lavfi", "-i",
                "testsrc2=size=320x180:rate=30:duration=4", "-f", "lavfi", "-i",
                "sine=frequency=440:duration=4", "-c:v", "libvpx-vp9", "-b:v", "200k",
                "-c:a", "libopus", "-shortest",
            ])
            .arg(&webm)
            .status()
            .unwrap();
        assert!(status.success());
        mute_audio_segments(
            &ffmpeg,
            &webm,
            &[SponsorSegment {
                category: "sponsor".to_owned(),
                start_seconds: 1.0,
                end_seconds: 3.0,
                action: "skip".to_owned(),
            }],
        )
        .unwrap();
        let after_webm = mean_volume(&ffmpeg, &webm, 2.0);
        assert!(after_webm < -60.0, "WebM no quedó muteado: {after_webm}");
        let _ = std::fs::remove_dir_all(root);
    }

    /// Compresión 4K de un clip largo sintético; mide tiempo real.
    #[test]
    fn long_4k_compression_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let root = std::env::temp_dir().join(format!("editoria-4k-long-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("long-4k.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=3840x2160:rate=24:duration=12",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=12",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "30",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let started = Instant::now();
        let compressed = compress_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input,
            Some(30),
            None,
            "h265",
            "tonemap",
            true,
        )
        .unwrap()
        .expect("4K comprimido");
        let elapsed = started.elapsed();
        assert!(
            elapsed.as_secs() < 300,
            "la compresión 4K tardó demasiado: {elapsed:?}"
        );
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,codec_name",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
            ])
            .arg(&compressed)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["width"].as_u64(), Some(3840));
        assert_eq!(value["streams"][0]["height"].as_u64(), Some(2160));
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
        let duration = value["format"]["duration"]
            .as_str()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0);
        assert!((duration - 12.0).abs() < 0.6, "duración {duration}");
        eprintln!("4K 12 s comprimido en {elapsed:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// HDR a SDR por tonemap y encode AV1 real.
    #[test]
    fn hdr_tonemap_and_av1_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let root = std::env::temp_dir().join(format!("editoria-hdr-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let hdr = root.join("hdr.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
                "-c:v",
                "libx265",
                "-pix_fmt",
                "yuv420p10le",
                "-x265-params",
                "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
                "-color_primaries",
                "bt2020",
                "-color_trc",
                "smpte2084",
                "-colorspace",
                "bt2020nc",
                "-tag:v",
                "hvc1",
            ])
            .arg(&hdr)
            .status()
            .unwrap();
        assert!(status.success());
        assert!(probe_color(Some(&ffprobe), &hdr).is_hdr());
        let tonemapped = compress_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &hdr,
            Some(28),
            None,
            "h264",
            "tonemap",
            true,
        )
        .unwrap()
        .expect("tonemap");
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,pix_fmt",
                "-of",
                "json",
            ])
            .arg(&tonemapped)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("h264"));
        assert_eq!(value["streams"][0]["pix_fmt"].as_str(), Some("yuv420p"));

        let av1_input = root.join("av1-base.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&av1_input)
            .status()
            .unwrap();
        assert!(status.success());
        let av1 = compress_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &av1_input,
            Some(32),
            None,
            "av1",
            "tonemap",
            true,
        )
        .unwrap()
        .expect("av1");
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "json",
            ])
            .arg(&av1)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("av1"));

        // HLG (iPhone / YouTube HDR) debe conservar su transferencia real, no
        // reetiquetarse como PQ.
        let hlg = root.join("hlg.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
                "-c:v",
                "libx265",
                "-pix_fmt",
                "yuv420p10le",
                "-x265-params",
                "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
                "-color_primaries",
                "bt2020",
                "-color_trc",
                "arib-std-b67",
                "-colorspace",
                "bt2020nc",
                "-tag:v",
                "hvc1",
            ])
            .arg(&hlg)
            .status()
            .unwrap();
        assert!(status.success());
        let color = probe_color(Some(&ffprobe), &hlg);
        assert_eq!(color.transfer, Some(HdrTransfer::Hlg));
        let preserved = compress_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &hlg,
            Some(26),
            None,
            "h265",
            "preserve",
            true,
        )
        .unwrap()
        .expect("preserve HLG");
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,pix_fmt,color_transfer,color_primaries",
                "-of",
                "json",
            ])
            .arg(&preserved)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
        assert_eq!(
            value["streams"][0]["pix_fmt"].as_str(),
            Some("yuv420p10le")
        );
        assert_eq!(
            value["streams"][0]["color_transfer"].as_str(),
            Some("arib-std-b67")
        );
        assert_eq!(
            value["streams"][0]["color_primaries"].as_str(),
            Some("bt2020")
        );
        let av1_hdr = compress_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &hlg,
            Some(32),
            None,
            "av1",
            "preserve",
            true,
        )
        .unwrap()
        .expect("preserve AV1 HLG");
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,pix_fmt,color_transfer",
                "-of",
                "json",
            ])
            .arg(&av1_hdr)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("av1"));
        assert_eq!(
            value["streams"][0]["pix_fmt"].as_str(),
            Some("yuv420p10le")
        );
        assert_eq!(
            value["streams"][0]["color_transfer"].as_str(),
            Some("arib-std-b67")
        );
        let rejected = compress_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &hlg,
            Some(26),
            None,
            "h264",
            "preserve",
            true,
        );
        assert!(rejected.is_err(), "preserve + H.264 debe rechazarse");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Compresión por tamaño objetivo con conservación del original.
    #[test]
    fn target_size_compression_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let root = std::env::temp_dir().join(format!("editoria-target-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("base.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=30:duration=4",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=4",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let output = compress_video(
            &|_, _, _| {},
            &ffmpeg,
            Some(&ffprobe),
            &input,
            None,
            Some(1),
            "h264",
            "tonemap",
            true,
        )
        .unwrap()
        .expect("debería comprimir");
        assert!(input.is_file(), "keep_original debe conservar el original");
        let bytes = std::fs::metadata(&output).unwrap().len();
        assert!(bytes > 0 && bytes < 1_600_000, "tamaño inesperado: {bytes}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Encode real 4K (3840×2160) por la ruta larga + Lanczos, con x265
    /// ultrafast. Mide el costo real y confirma dimensiones/códec.
    #[test]
    fn upscale_4k_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("upscale_4k_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let root = std::env::temp_dir().join(format!("editoria-4k-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let input = root.join("base.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let started = Instant::now();
        let percents = std::sync::Mutex::new(Vec::new());
        let progress = |_stage: &str, percent: Option<f64>, _message: &str| {
            if let Some(percent) = percent {
                percents.lock().unwrap().push(percent);
            }
        };
        let (output, _, _) = process_video(
            &progress,
            &ffmpeg,
            Some(&ffprobe),
            &input,
            "center",
            None,
            true,
            true,
            false,
            false,
            false,
            None,
            None,
            Some("2160"),
            None,
            &crate::commands::pipeline_profile::PipelineProfile::software(),
        )
        .unwrap();
        let seen = percents.into_inner().unwrap();
        assert!(
            seen.iter().any(|percent| *percent > 0.0),
            "no se emitió progreso porcentual de FFmpeg"
        );
        let probe = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,codec_name",
                "-of",
                "json",
            ])
            .arg(&output)
            .output()
            .unwrap();
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(value["streams"][0]["width"].as_u64(), Some(3840));
        assert_eq!(value["streams"][0]["height"].as_u64(), Some(2160));
        assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
        eprintln!("4K upscale real: {:?}", started.elapsed());
        let _ = std::fs::remove_dir_all(&root);
    }
}
