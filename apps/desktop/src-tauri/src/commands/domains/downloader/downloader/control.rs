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

// Cada descarga corre en su propio hilo bloqueante; el control vive ahí
// mientras yt-dlp/FFmpeg están vivos. El mapa global permite pausar o
// cancelar trabajos individuales desde la UI.
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
