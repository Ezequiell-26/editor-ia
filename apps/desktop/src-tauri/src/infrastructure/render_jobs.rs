//! Infraestructura del ciclo de vida del render.
//!
//! - `ChildRenderProcess`: `std::process::Child` + flag de cancelación.
//! - `SharedRenderRuntime`: registro de jobs sobre `AppState::render_jobs`.
//! - `LocalRenderFiles`: temporales, canonicalización, publicación y prune.
//! - `TauriRenderEvents`/`TauriRenderDialogs`: emisión y diálogos nativos.
//! - `SystemRenderEncoder`/`SystemRenderVerifier`: spawn FFmpeg y reporte
//!   FFprobe del archivo publicado.
//! - `StdioRenderLauncher`: worker con threads de progreso/stderr, espera,
//!   verificación y publicación — el mismo patrón `generate(job)` que usa
//!   `StdioProxyGenerator`.

use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

use crate::infrastructure::media::SystemMediaRunner;
use crate::infrastructure::render_lossless::LocalLosslessOutputs;
use crate::ports::media::MediaRunner;
use crate::ports::render::{
    LosslessOutputs, RenderDialogs, RenderEncoder, RenderEvents, RenderFiles, RenderLaunch,
    RenderLauncher, RenderProcess, RenderRuntime, RenderVerifier, SpawnedRender,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::export_tools::{parse_verification, ExportVerification};
use crate::render::ffmpeg::{self, sanitize_log, RenderPlan};
use crate::render::lifecycle::{ensure_mp4, RenderFinishedEvent, RenderProgressEvent};
use crate::state::SharedRenderJobs;

/// Hijo FFmpeg con su flag de cancelación (equivale al `RenderJob` viejo).
pub struct ChildRenderProcess {
    child: Mutex<Child>,
    cancelled: Arc<AtomicBool>,
}

impl ChildRenderProcess {
    pub fn new(child: Child) -> Self {
        Self {
            child: Mutex::new(child),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl RenderProcess for ChildRenderProcess {
    fn try_wait(&self) -> Option<bool> {
        let mut guard = self.child.lock().ok()?;
        match guard.try_wait() {
            Ok(Some(status)) => Some(status.success()),
            _ => None,
        }
    }

    fn request_cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            let _ = guard.kill();
        }
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Registro de renders activos sobre el mapa compartido de `AppState`.
#[derive(Clone)]
pub struct SharedRenderRuntime {
    jobs: SharedRenderJobs,
}

impl SharedRenderRuntime {
    pub fn new(jobs: SharedRenderJobs) -> Self {
        Self { jobs }
    }
}

fn io_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

impl RenderRuntime for SharedRenderRuntime {
    fn is_busy(&self) -> bool {
        self.jobs
            .lock()
            .map(|jobs| !jobs.is_empty())
            .unwrap_or(false)
    }

    fn first_id(&self) -> Option<String> {
        self.jobs
            .lock()
            .ok()
            .and_then(|jobs| jobs.keys().next().cloned())
    }

    fn register(&self, job_id: &str, process: Arc<dyn RenderProcess>) -> Result<(), ProjectError> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| io_error("el estado de render no está disponible"))?;
        if !jobs.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderBusy,
                "ya hay un render en curso; esperá a que termine o cancelalo",
            ));
        }
        jobs.insert(job_id.to_owned(), process);
        Ok(())
    }

    fn unregister(&self, job_id: &str) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.remove(job_id);
        }
    }

    fn cancel(&self, job_id: &str) -> Result<(), ProjectError> {
        let process = {
            let jobs = self
                .jobs
                .lock()
                .map_err(|_| io_error("el estado de render no está disponible"))?;
            jobs.get(job_id).cloned()
        };
        let Some(process) = process else {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "ese render ya no está en curso",
            ));
        };
        process.request_cancel();
        Ok(())
    }

    fn cancel_all(&self) {
        if let Ok(mut jobs) = self.jobs.lock() {
            for (_, process) in jobs.drain() {
                process.request_cancel();
            }
        }
    }
}

/// Filesystem del ciclo de vida del render.
pub struct LocalRenderFiles;

impl RenderFiles for LocalRenderFiles {
    fn canonical(&self, path: &Path) -> Option<PathBuf> {
        if path.exists() {
            return path.canonicalize().ok();
        }
        let parent = path.parent()?.canonicalize().ok()?;
        Some(parent.join(path.file_name()?))
    }

    fn temp_dir(&self, cache_dir: &Path, job_id: &str) -> Result<PathBuf, ProjectError> {
        let dir = cache_dir.join(format!("render-{}", job_id));
        std::fs::create_dir_all(&dir).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar la carpeta temporal del render",
            )
        })?;
        Ok(dir)
    }

    fn remove_dir(&self, path: &Path) {
        let _ = std::fs::remove_dir_all(path);
    }

    fn publish_output(&self, temporary: &Path, final_path: &Path) -> Result<(), ProjectError> {
        let parent = final_path.parent().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el archivo de salida no tiene una carpeta de destino",
            )
        })?;
        std::fs::create_dir_all(parent).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "no se pudo preparar la carpeta de salida",
            )
        })?;
        // Mover es instantáneo cuando origen y destino están en el mismo volumen;
        // sólo se copia si el sistema no puede renombrar entre carpetas/unidades.
        if std::fs::rename(temporary, final_path).is_err() {
            std::fs::copy(temporary, final_path).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "el render pasó la verificación pero no se pudo publicar el archivo final",
                )
            })?;
        }
        Ok(())
    }

    fn prune_cache(&self, cache_dir: &Path) -> u64 {
        let mut removed_count = 0u64;
        if let Ok(entries) = std::fs::read_dir(cache_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path
                    .file_name()
                    .map(|name| name.to_string_lossy().starts_with("render-"))
                    .unwrap_or(false)
                {
                    // Temporales son directorios; los `render-*.log` de fallo son archivos.
                    let removed = if path.is_dir() {
                        std::fs::remove_dir_all(&path).is_ok()
                    } else {
                        std::fs::remove_file(&path).is_ok()
                    };
                    if removed {
                        removed_count += 1;
                    }
                }
            }
        }
        removed_count
    }
}

/// Eventos `render-progress` / `render-finished` hacia la ventana.
pub struct TauriRenderEvents {
    app: AppHandle,
}

impl TauriRenderEvents {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl RenderEvents for TauriRenderEvents {
    fn progress(&self, event: &RenderProgressEvent) {
        let _ = self.app.emit("render-progress", event);
    }

    fn finished(&self, event: &RenderFinishedEvent) {
        let _ = self.app.emit("render-finished", event);
    }
}

/// Diálogos nativos de salida y carpeta del lote.
pub struct TauriRenderDialogs {
    app: AppHandle,
}

impl TauriRenderDialogs {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl RenderDialogs for TauriRenderDialogs {
    fn pick_output(&self, root: &Path, suggested: &str) -> Result<Option<PathBuf>, ProjectError> {
        let Some(picked) = self
            .app
            .dialog()
            .file()
            .set_title("Exportar video")
            .set_directory(root)
            .add_filter("Video MP4", &["mp4"])
            .set_file_name(suggested)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let picked = picked
            .into_path()
            .map_err(|_| io_error("no se pudo usar la ruta elegida"))?;
        let completed = ensure_mp4(picked.clone());
        if completed != picked && completed.exists() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "ya existe un MP4 con el nombre completo que se agregó automáticamente; elegí otro nombre",
            ));
        }
        Ok(Some(completed))
    }

    fn pick_directory(&self, root: &Path) -> Result<Option<PathBuf>, ProjectError> {
        let Some(folder) = self
            .app
            .dialog()
            .file()
            .set_title("Elegir carpeta para el lote de exportación")
            .set_directory(root)
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let folder = folder
            .into_path()
            .map_err(|_| io_error("no se pudo usar la carpeta elegida"))?;
        if !folder.is_dir() {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "la ruta elegida no es una carpeta",
            ));
        }
        Ok(Some(folder))
    }
}

/// Spawn del FFmpeg del render con pipes para el worker.
pub struct SystemRenderEncoder;

impl RenderEncoder for SystemRenderEncoder {
    fn spawn(&self, ffmpeg: &Path, plan: &RenderPlan) -> Result<SpawnedRender, ProjectError> {
        let mut child = ffmpeg::spawn(ffmpeg, plan)?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        Ok(SpawnedRender {
            process: Arc::new(ChildRenderProcess::new(child)),
            stdout,
            stderr,
        })
    }
}

/// Reporte FFprobe del archivo publicado, sobre los mismos adaptadores
/// que `application::export_tools::verify_export_file`.
pub struct SystemRenderVerifier;

impl RenderVerifier for SystemRenderVerifier {
    fn verify(&self, ffprobe: &Path, path: &Path) -> Result<ExportVerification, ProjectError> {
        let outputs = LocalLosslessOutputs;
        let bytes = outputs.file_bytes(path);
        if bytes == 0 {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "el archivo exportado no existe o está vacío",
            ));
        }
        let args = [
            "-v".to_owned(),
            "error".to_owned(),
            "-show_streams".to_owned(),
            "-show_format".to_owned(),
            "-of".to_owned(),
            "json".to_owned(),
            path.to_string_lossy().into_owned(),
        ];
        let runner = SystemMediaRunner;
        let output = runner.run_ffprobe(ffprobe, &args).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo iniciar FFprobe para verificar el archivo",
            )
        })?;
        let document: Value = serde_json::from_slice(&output.stdout).unwrap_or(Value::Null);
        if !output.status.success() || document["streams"].is_null() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "FFprobe no pudo leer el archivo exportado",
            ));
        }
        Ok(parse_verification(path, &document, bytes))
    }
}

fn finished_failed(
    job_id: &str,
    started: Instant,
    code: &str,
    message: &str,
    detail: Option<String>,
) -> RenderFinishedEvent {
    RenderFinishedEvent {
        job_id: job_id.to_owned(),
        status: "failed".to_owned(),
        code: Some(code.to_owned()),
        message: Some(message.to_owned()),
        detail,
        output_path: None,
        output_bytes: None,
        duration_seconds: None,
        width: None,
        height: None,
        elapsed_ms: started.elapsed().as_millis() as u64,
        verification: None,
    }
}

/// Worker del render: threads de progreso/stderr + espera + verify/publish.
pub struct StdioRenderLauncher {
    runtime: Arc<dyn RenderRuntime>,
    events: Arc<dyn RenderEvents>,
    files: Arc<dyn RenderFiles>,
    verifier: Arc<dyn RenderVerifier>,
}

impl StdioRenderLauncher {
    pub fn new(
        runtime: Arc<dyn RenderRuntime>,
        events: Arc<dyn RenderEvents>,
        files: Arc<dyn RenderFiles>,
        verifier: Arc<dyn RenderVerifier>,
    ) -> Self {
        Self {
            runtime,
            events,
            files,
            verifier,
        }
    }
}

impl RenderLauncher for StdioRenderLauncher {
    fn launch(&self, job: RenderLaunch) {
        let runtime = self.runtime.clone();
        let events = self.events.clone();
        let files = self.files.clone();
        let verifier = self.verifier.clone();
        std::thread::spawn(move || run_render_job(job, runtime, events, files, verifier));
    }
}

#[allow(clippy::too_many_arguments)]
fn run_render_job(
    job: RenderLaunch,
    runtime: Arc<dyn RenderRuntime>,
    events: Arc<dyn RenderEvents>,
    files: Arc<dyn RenderFiles>,
    verifier: Arc<dyn RenderVerifier>,
) {
    let RenderLaunch {
        job_id,
        plan,
        ffprobe,
        final_output,
        temp_dir,
        root,
        started,
        process,
        stdout,
        stderr,
    } = job;

    let total_seconds = plan.duration_seconds;
    let progress_job = job_id.clone();
    let progress_events = events.clone();
    let progress_thread = stdout.map(|stdout| {
        std::thread::spawn(move || {
            use std::io::BufRead;
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(progress) = ffmpeg::progress_from_line(&line, total_seconds) {
                    progress_events.progress(&RenderProgressEvent {
                        job_id: progress_job.clone(),
                        percent: progress.percent,
                        processed_seconds: progress.processed_seconds,
                        total_seconds: progress.total_seconds,
                        phase: "renderizando".to_owned(),
                    });
                }
            }
        })
    });

    let log_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer = log_buffer.clone();
    let stderr_thread = stderr.map(|mut stderr| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buffer: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 8_192];
            loop {
                match stderr.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => {
                        buffer.extend_from_slice(&chunk[..read]);
                        if buffer.len() > 65_536 {
                            let drain = buffer.len() - 65_536;
                            buffer.drain(..drain);
                        }
                    }
                    Err(_) => break,
                }
            }
            if let Ok(mut log) = stderr_buffer.lock() {
                *log = String::from_utf8_lossy(&buffer).into_owned();
            }
        })
    });

    // Espera activa: el registro permite cancelar desde otro thread.
    let exit_success = loop {
        if let Some(success) = process.try_wait() {
            break success;
        }
        std::thread::sleep(Duration::from_millis(120));
    };
    if let Some(handle) = progress_thread {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_thread {
        let _ = handle.join();
    }
    runtime.unregister(&job_id);
    let log = log_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let detail = sanitize_log(&log, &root, 600);
    let temp_render_dir = temp_dir;

    if process.is_cancelled() {
        files.remove_dir(&temp_render_dir);
        events.finished(&RenderFinishedEvent {
            job_id,
            status: "cancelled".to_owned(),
            code: Some("RENDER_CANCELLED".to_owned()),
            message: Some("el render se canceló; no se reporta ningún archivo".to_owned()),
            detail: None,
            output_path: None,
            output_bytes: None,
            duration_seconds: None,
            width: None,
            height: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
            verification: None,
        });
        return;
    }
    if !exit_success {
        persist_render_log(
            &temp_render_dir,
            "ffmpeg no pudo completar el render",
            &detail,
        );
        files.remove_dir(&temp_render_dir);
        events.finished(&finished_failed(
            &job_id,
            started,
            "RENDER_FAILED",
            "ffmpeg no pudo completar el render",
            (!detail.is_empty()).then_some(detail),
        ));
        return;
    }
    events.progress(&RenderProgressEvent {
        job_id: job_id.clone(),
        percent: 99.0,
        processed_seconds: plan.duration_seconds,
        total_seconds: plan.duration_seconds,
        phase: "verificando".to_owned(),
    });
    // ffprobe lee el temporal nada más salir ffmpeg; en Windows el archivo
    // puede seguir liberándose y la verificación falla de forma transitoria.
    // Un reintento tras una pausa cubre ese flake sin ocultar fallos reales
    // (el segundo intento vuelve a medir todo).
    let verify_and_publish = || {
        ffmpeg::verify_output(&ffprobe, &plan).and_then(|verification| {
            files.publish_output(&plan.output_path, &final_output)?;
            let published = std::fs::metadata(&final_output)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            if published != verification.output_bytes {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "el archivo publicado no coincide con el render verificado",
                ));
            }
            Ok(verification)
        })
    };
    let mut verified = verify_and_publish();
    if verified.is_err() {
        std::thread::sleep(Duration::from_millis(400));
        verified = verify_and_publish();
    }
    match verified {
        Ok(verification) => {
            let report = verifier.verify(&ffprobe, &final_output).ok();
            events.finished(&RenderFinishedEvent {
                job_id,
                status: "completed".to_owned(),
                code: None,
                message: None,
                detail: None,
                output_path: Some(final_output.to_string_lossy().into_owned()),
                output_bytes: Some(verification.output_bytes),
                duration_seconds: Some(verification.duration_seconds),
                width: Some(verification.width),
                height: Some(verification.height),
                elapsed_ms: started.elapsed().as_millis() as u64,
                verification: report,
            });
        }
        Err(error) => {
            persist_render_log(&temp_render_dir, &error.message, "");
            events.finished(&RenderFinishedEvent {
                job_id,
                status: "failed".to_owned(),
                code: Some(error.code.name().to_owned()),
                message: Some(error.message),
                detail: None,
                output_path: None,
                output_bytes: None,
                duration_seconds: None,
                width: None,
                height: None,
                elapsed_ms: started.elapsed().as_millis() as u64,
                verification: None,
            });
        }
    }
    files.remove_dir(&temp_render_dir);
}

/// Deja el motivo del fallo en `<cache>/render-<job>.log` para que el
/// consumidor del job (p.ej. el estudio autónomo, que sondea por archivo)
/// pueda reportar la causa real en vez de "terminó sin publicar".
fn persist_render_log(temp_dir: &Path, message: &str, detail: &str) {
    let body = if detail.trim().is_empty() {
        message.to_owned()
    } else {
        format!("{message}\n{}", detail.trim())
    };
    let _ = std::fs::write(temp_dir.with_extension("log"), body);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::render_lifecycle::ensure_output_is_safe;

    #[test]
    fn render_log_lands_next_to_the_temp_dir_with_the_job_name() {
        let base =
            std::env::temp_dir().join(format!("editor-ia-renderlog-{}", uuid::Uuid::new_v4()));
        let temp_dir = base.join("render-job-123");
        std::fs::create_dir_all(&temp_dir).unwrap();
        persist_render_log(&temp_dir, "ffmpeg falló", "Error at tail");
        let log = base.join("render-job-123.log");
        let body = std::fs::read_to_string(&log).unwrap();
        assert!(body.contains("ffmpeg falló"));
        assert!(body.contains("Error at tail"));
        // Sin detalle: sólo el mensaje.
        persist_render_log(&temp_dir, "verificación falló", "  ");
        let body = std::fs::read_to_string(&log).unwrap();
        assert_eq!(body, "verificación falló");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn publishing_moves_the_verified_temp_file_to_the_final_path() {
        let files = LocalRenderFiles;
        let base = std::env::temp_dir().join(format!("editor-ia-publish-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let temporary = base.join("temp.mp4");
        let final_path = base.join("final.mp4");
        std::fs::write(&temporary, b"verified-bytes").unwrap();
        files.publish_output(&temporary, &final_path).unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"verified-bytes");
        assert!(!temporary.exists(), "el temporal se movió, no se duplicó");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn publishing_replaces_an_existing_export_with_the_new_render() {
        let files = LocalRenderFiles;
        let base =
            std::env::temp_dir().join(format!("editor-ia-republish-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let temporary = base.join("temp.mp4");
        let final_path = base.join("final.mp4");
        std::fs::write(&temporary, b"nuevo").unwrap();
        std::fs::write(&final_path, b"viejo").unwrap();
        files.publish_output(&temporary, &final_path).unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"nuevo");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn output_cannot_overwrite_the_project_an_asset_or_the_temp_dir() {
        let files = LocalRenderFiles;
        let base = std::env::temp_dir().join(format!("editor-ia-safe-{}", uuid::Uuid::new_v4()));
        let root = base.join("project");
        let media = root.join("media");
        let cache = base.join("cache/render-job");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::create_dir_all(&cache).unwrap();
        let project_path = root.join("obra.json");
        let asset_path = media.join("clip.mp4");
        std::fs::write(&project_path, "{}").unwrap();
        std::fs::write(&asset_path, b"asset").unwrap();
        let project = serde_json::json!({
            "assets": [{ "id": "11111111-1111-4111-8111-111111111111", "source": { "path": "media/clip.mp4" } }]
        });
        assert!(ensure_output_is_safe(
            &project,
            &project_path,
            &root,
            &project_path,
            &cache,
            &files
        )
        .is_err());
        assert!(
            ensure_output_is_safe(&project, &project_path, &root, &asset_path, &cache, &files)
                .is_err()
        );
        assert!(ensure_output_is_safe(
            &project,
            &project_path,
            &root,
            &cache.join("out.mp4"),
            &cache,
            &files
        )
        .is_err());
        assert!(ensure_output_is_safe(
            &project,
            &project_path,
            &root,
            &base.join("export.mp4"),
            &cache,
            &files
        )
        .is_ok());
        let _ = std::fs::remove_dir_all(&base);
    }
}
