// DTOs y límites del subsistema: viven en `application::downloads` (contrato
// IPC + reglas puras). El `pub use` mantiene los nombres visibles en este
// módulo para todos los `include!` hermanos y los tests.
pub use crate::application::downloads::*;

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
