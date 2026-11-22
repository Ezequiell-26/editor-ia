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
use std::process::{Child, ChildStderr, ChildStdout};
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
    RenderLauncher, RenderProcess, RenderRetry, RenderRuntime, RenderVerifier, SpawnedRender,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::export_tools::{parse_verification, ExportVerification};
use crate::render::ffmpeg::{
    self, build_plan_range, parse_profile, sanitize_log, BuildPlanInput, RenderPlan,
};
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

    fn replace(&self, job_id: &str, process: Arc<dyn RenderProcess>) -> Result<(), ProjectError> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| io_error("el estado de render no está disponible"))?;
        if !jobs.contains_key(job_id) {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "ese render ya no está en curso",
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

/// Reserva de nombres de salida (AUD-017): `reserve_output` anota si el
/// destino ya existía al empezar el render; `publish_output` la consume y
/// rechaza publicar sobre un archivo que apareció durante el render.
static OUTPUT_RESERVATIONS: Mutex<Option<std::collections::HashMap<PathBuf, bool>>> =
    Mutex::new(None);

fn reservations() -> std::sync::MutexGuard<'static, Option<std::collections::HashMap<PathBuf, bool>>>
{
    OUTPUT_RESERVATIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
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

    fn reserve_output(&self, final_path: &Path) -> Result<(), ProjectError> {
        let key = self
            .canonical(final_path)
            .unwrap_or_else(|| final_path.to_path_buf());
        let existed = final_path.exists();
        let mut guard = reservations();
        let map = guard.get_or_insert_with(std::collections::HashMap::new);
        map.insert(key, existed);
        Ok(())
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
        // AUD-017: si el nombre estaba libre al reservar y ahora existe un
        // archivo, alguien lo creó durante el render — no se pisa.
        let key = self
            .canonical(final_path)
            .unwrap_or_else(|| final_path.to_path_buf());
        let reserved_existed = reservations().as_mut().and_then(|map| map.remove(&key));
        if reserved_existed == Some(false) && final_path.exists() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el archivo de salida fue creado por otro proceso durante el render; elegí otro nombre",
            ));
        }
        // Mover es instantáneo cuando origen y destino están en el mismo volumen;
        // sólo se copia si el sistema no puede renombrar entre carpetas/unidades.
        if std::fs::rename(temporary, final_path).is_err() {
            // AUD-017: la copia va a un archivo hermano `.part` (mismo volumen
            // que el destino) y se publica con rename + backup del anterior,
            // en vez de truncar el destino existente durante la copia.
            let part = parent.join(format!(
                ".{}.part-{}",
                final_path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "render".to_owned()),
                uuid::Uuid::new_v4()
            ));
            if std::fs::copy(temporary, &part).is_err() {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "el render pasó la verificación pero no se pudo publicar el archivo final",
                ));
            }
            let backup = parent.join(format!(
                ".{}.bak-{}",
                final_path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "render".to_owned()),
                uuid::Uuid::new_v4()
            ));
            let had_existing = final_path.exists();
            if had_existing && std::fs::rename(final_path, &backup).is_err() {
                let _ = std::fs::remove_file(&part);
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "no se pudo apartar el archivo de salida existente",
                ));
            }
            match std::fs::rename(&part, final_path) {
                Ok(()) => {
                    if had_existing {
                        let _ = std::fs::remove_file(&backup);
                    }
                    Ok(())
                }
                Err(_) => {
                    if had_existing {
                        let _ = std::fs::rename(&backup, final_path);
                    }
                    let _ = std::fs::remove_file(&part);
                    Err(ProjectError::message(
                        ProjectErrorCode::RenderFailed,
                        "el render pasó la verificación pero no se pudo publicar el archivo final",
                    ))
                }
            }
        } else {
            Ok(())
        }
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
        // El runner distingue spawn de timeout; se propaga tal cual.
        let output = runner.run_ffprobe_with_timeout(
            ffprobe,
            &args,
            crate::infrastructure::process::MEDIA_PROBE_TIMEOUT,
        )?;
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

/// Firmas de fallo de GPU/encoder de hardware en el log de ffmpeg
/// (device-removed, CUDA, NVENC/QSV/AMF caídos). Devuelve un mensaje
/// accionable — versión acotada del `placa_perdida`/`tentados` de
/// AlaukCut: el render no se reintenta solo (reconstruir el plan es otra
/// iteración), pero el usuario sabe qué pasó y qué hacer.
fn gpu_failure_hint(log: &str) -> Option<&'static str> {
    let lower = log.to_lowercase();
    const NEEDLES: &[(&str, &str)] = &[
        (
            "device lost",
            "el dispositivo gráfico se desconectó durante el render",
        ),
        ("cuda_error", "falló CUDA durante el render"),
        ("nvcuda", "el driver NVIDIA no respondió"),
        (
            "no capable devices",
            "no hay dispositivos de hardware utilizables",
        ),
        ("out of memory", "la GPU se quedó sin memoria"),
        (
            "initializeencoder failed",
            "el encoder de hardware no pudo inicializarse",
        ),
        ("nvenc", "el encoder NVIDIA (NVENC) falló"),
        ("qsv", "el encoder Intel QuickSync falló"),
        ("amf", "el encoder AMD AMF falló"),
    ];
    NEEDLES
        .iter()
        .find(|(needle, _)| lower.contains(needle))
        .map(|(_, message)| *message)
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
        mut plan,
        profile_name,
        video_codec,
        hardware_encoder,
        encoder_fallback,
        ffprobe,
        final_output,
        temp_dir,
        root,
        started,
        process,
        stdout,
        stderr,
        mut retry,
    } = job;
    let mut process = process;
    let mut stdout = stdout;
    let mut stderr = stderr;

    // Bitácora de exports (`export_diario.js`): una línea JSONL por job
    // terminado en `<cache>/render-diary.jsonl`.
    let diary = |status: &str,
                 output_name: Option<String>,
                 output_bytes: Option<u64>,
                 duration_seconds: Option<f64>,
                 code: Option<String>,
                 message: Option<String>| {
        let cache_dir = temp_dir.parent().unwrap_or(temp_dir.as_path());
        crate::infrastructure::render_diary::append(
            cache_dir,
            &crate::infrastructure::render_diary::RenderDiaryEntry {
                job_id: job_id.clone(),
                project: root
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                profile_name: profile_name.clone(),
                codec: video_codec.clone(),
                encoder: hardware_encoder
                    .clone()
                    .unwrap_or_else(|| "software".to_owned()),
                encoder_fallback: encoder_fallback.clone(),
                status: status.to_owned(),
                output_name,
                output_bytes,
                duration_seconds,
                elapsed_ms: started.elapsed().as_millis() as u64,
                code,
                message,
            },
        );
    };

    // Si el encoder de hardware se cae a mitad del render por pérdida de
    // GPU (device-removed), se reconstruye el plan con encoder de software
    // y se reintenta UNA vez — el patrón `placa_perdida` de AlaukCut. Un
    // fallo sin firma de GPU o un segundo fallo se reportan como siempre.
    let (exit_success, log, timed_out) = loop {
        let total_seconds = plan.duration_seconds;
        let outcome = await_render_attempt(
            &job_id,
            &events,
            total_seconds,
            &process,
            stdout.take(),
            stderr.take(),
            crate::infrastructure::process::proportional_media_timeout(total_seconds),
        );

        // El job sigue registrado hasta que verify+publish termina: si se
        // desregistrara antes, un sondeo vería "job terminado + sin archivo"
        // mientras el worker aún publica, y declararía un fallo espurio.
        // `timed_out` va primero: vencer el deadline pide cancelación para
        // matar al hijo, y eso también prende `is_cancelled`.
        if outcome.timed_out {
            break (false, outcome.log, true);
        }
        if process.is_cancelled() {
            runtime.unregister(&job_id);
            files.remove_dir(&temp_dir);
            diary(
                "cancelled",
                None,
                None,
                None,
                Some("RENDER_CANCELLED".to_owned()),
                Some("el render se canceló; no se reporta ningún archivo".to_owned()),
            );
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
        if outcome.exit_success {
            break (true, outcome.log, false);
        }
        let gpu_retry = if gpu_failure_hint(&outcome.log).is_some() {
            retry.take()
        } else {
            None
        };
        if let Some(ctx) = gpu_retry {
            if let Ok((new_plan, spawned)) = rebuild_software_render(&ctx, &ffprobe) {
                // El log del intento con GPU queda como evidencia junto al
                // `render-<job>.log` que escribiría un fallo definitivo.
                let gpu_log = temp_dir.with_extension("gpu.log");
                let _ = std::fs::write(
                    &gpu_log,
                    format!(
                        "intento con encoder de hardware falló\n{}",
                        sanitize_log(&outcome.log, &root, 600)
                    ),
                );
                if runtime.replace(&job_id, spawned.process.clone()).is_ok() {
                    // Si la cancelación llegó en el lapso del reintento, el
                    // flag quedó en el proceso viejo: se propaga al nuevo.
                    if process.is_cancelled() {
                        spawned.process.request_cancel();
                    }
                    events.progress(&RenderProgressEvent {
                        job_id: job_id.clone(),
                        percent: 0.0,
                        processed_seconds: 0.0,
                        total_seconds: new_plan.duration_seconds,
                        phase: "reintentando con encoder de software".to_owned(),
                    });
                    plan = new_plan;
                    process = spawned.process;
                    stdout = spawned.stdout;
                    stderr = spawned.stderr;
                    continue;
                }
            }
        }
        break (false, outcome.log, outcome.timed_out);
    };

    let detail = sanitize_log(&log, &root, 600);

    if !exit_success {
        runtime.unregister(&job_id);
        // `GPU_RENDER_FAILED` distingue el fallo de placa del genérico: el
        // frontend cuenta caídas en ventana (paridad `placa_perdida.js`)
        // y al ≥2ª muestra instrucciones en vez de sólo el mensaje.
        // `RENDER_TIMEOUT` informa que el proceso fue matado por deadline:
        // no se publica nada y el usuario puede reintentar con menos carga.
        let (code, message) = if timed_out {
            (
                "RENDER_TIMEOUT",
                "el render superó el tiempo máximo y se detuvo; probá con un perfil más liviano o menos material".to_owned(),
            )
        } else {
            let gpu_hint = gpu_failure_hint(&log);
            let code = if gpu_hint.is_some() {
                "GPU_RENDER_FAILED"
            } else {
                "RENDER_FAILED"
            };
            let message = match gpu_hint {
                Some(hint) => format!(
                    "ffmpeg no pudo completar el render: {hint}. Probá exportar con el encoder de software."
                ),
                None => "ffmpeg no pudo completar el render".to_owned(),
            };
            (code, message)
        };
        persist_render_log(&temp_dir, &message, &detail);
        files.remove_dir(&temp_dir);
        diary(
            "failed",
            None,
            None,
            None,
            Some(code.to_owned()),
            Some(message.clone()),
        );
        events.finished(&finished_failed(
            &job_id,
            started,
            code,
            &message,
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
            runtime.unregister(&job_id);
            let report = verifier.verify(&ffprobe, &final_output).ok();
            diary(
                "completed",
                final_output
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned()),
                Some(verification.output_bytes),
                Some(verification.duration_seconds),
                None,
                None,
            );
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
            runtime.unregister(&job_id);
            persist_render_log(&temp_dir, &error.message, "");
            diary(
                "failed",
                None,
                None,
                None,
                Some(error.code.name().to_owned()),
                Some(error.message.clone()),
            );
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
    files.remove_dir(&temp_dir);
}

/// Un intento de render: threads de progreso (stdout) y captura de stderr,
/// espera activa del proceso y unión de los readers. Devuelve el éxito del
/// proceso, el log de stderr (recortado a 64 KiB por el reader) y si se
/// violó el deadline (el proceso fue matado).
struct AttemptOutcome {
    exit_success: bool,
    log: String,
    timed_out: bool,
}

#[allow(clippy::too_many_arguments)]
fn await_render_attempt(
    job_id: &str,
    events: &Arc<dyn RenderEvents>,
    total_seconds: f64,
    process: &Arc<dyn RenderProcess>,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
    timeout: Duration,
) -> AttemptOutcome {
    let progress_job = job_id.to_owned();
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

    // Espera activa: el registro permite cancelar desde otro thread. El
    // deadline evita que un FFmpeg colgado congele el job para siempre; al
    // vencer se pide cancelación (mata al hijo) y se espera el cierre.
    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let exit_success = loop {
        if let Some(success) = process.try_wait() {
            break success;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            process.request_cancel();
            // Margen para que el kill se concrete; si no, se corta igual.
            let reap_deadline = Instant::now() + Duration::from_secs(10);
            let mut success = false;
            loop {
                match process.try_wait() {
                    Some(status) => {
                        success = status;
                        break;
                    }
                    None if Instant::now() >= reap_deadline => break,
                    None => std::thread::sleep(Duration::from_millis(120)),
                }
            }
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
    let log = log_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    AttemptOutcome {
        exit_success,
        log,
        timed_out,
    }
}

/// Reconstruye el plan sin `hardwareEncoder` y relanza FFmpeg con el
/// encoder de software. El self-test previo ya descartó encoders rotos;
/// acá sólo cambia el codec de salida, el resto del plan es idéntico.
fn rebuild_software_render(
    retry: &RenderRetry,
    ffprobe: &Path,
) -> Result<(RenderPlan, SpawnedRender), ProjectError> {
    let mut profile_json = retry.profile_json.clone();
    if let Some(map) = profile_json.as_object_mut() {
        map.remove("hardwareEncoder");
    }
    let profile = parse_profile(&profile_json)?;
    let plan = build_plan_range(
        BuildPlanInput {
            audio_only: false,
            project: &retry.project,
            root: &retry.root,
            profile: &profile,
            output_path: &retry.render_output,
            include_captions: retry.include_captions,
            temp_dir: &retry.temp_dir,
            ffprobe,
            motion_ass: retry.motion_ass.as_deref(),
        },
        retry.range,
    )?;
    let spawned = SystemRenderEncoder.spawn(&retry.ffmpeg, &plan)?;
    Ok((plan, spawned))
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
    use std::sync::atomic::AtomicUsize;

    struct FakeProcess {
        cancelled: Arc<AtomicBool>,
        waits: Arc<AtomicUsize>,
        success: bool,
    }

    impl FakeProcess {
        fn new() -> Self {
            Self {
                cancelled: Arc::new(AtomicBool::new(false)),
                waits: Arc::new(AtomicUsize::new(0)),
                success: false,
            }
        }

        fn succeeding() -> Self {
            Self {
                success: true,
                ..Self::new()
            }
        }
    }

    impl RenderProcess for FakeProcess {
        fn try_wait(&self) -> Option<bool> {
            self.waits.fetch_add(1, Ordering::SeqCst);
            Some(self.success)
        }
        fn request_cancel(&self) {
            self.cancelled.store(true, Ordering::SeqCst);
        }
        fn is_cancelled(&self) -> bool {
            self.cancelled.load(Ordering::SeqCst)
        }
    }

    /// Proceso que nunca termina solo: `try_wait` da `None` hasta que
    /// `request_cancel` lo "mata" (como haría el kill de `ChildRenderProcess`).
    struct HangingProcess {
        cancelled: Arc<AtomicBool>,
    }

    impl HangingProcess {
        fn new() -> Self {
            Self {
                cancelled: Arc::new(AtomicBool::new(false)),
            }
        }
    }

    impl RenderProcess for HangingProcess {
        fn try_wait(&self) -> Option<bool> {
            if self.cancelled.load(Ordering::SeqCst) {
                Some(false)
            } else {
                None
            }
        }
        fn request_cancel(&self) {
            self.cancelled.store(true, Ordering::SeqCst);
        }
        fn is_cancelled(&self) -> bool {
            self.cancelled.load(Ordering::SeqCst)
        }
    }

    struct FakeEvents;

    impl RenderEvents for FakeEvents {
        fn progress(&self, _event: &RenderProgressEvent) {}
        fn finished(&self, _event: &RenderFinishedEvent) {}
    }

    #[test]
    fn await_render_attempt_reporta_timeout_y_mata_al_hijo() {
        let process = Arc::new(HangingProcess::new()) as Arc<dyn RenderProcess>;
        let events = Arc::new(FakeEvents) as Arc<dyn RenderEvents>;
        let started = Instant::now();
        let outcome = await_render_attempt(
            "job-1",
            &events,
            10.0,
            &process,
            None,
            None,
            Duration::from_millis(300),
        );
        assert!(outcome.timed_out);
        assert!(!outcome.exit_success);
        assert!(process.is_cancelled());
        // No puede quedar colgado esperando al proceso.
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn await_render_attempt_devuelve_exito_y_fallo_normales() {
        let events = Arc::new(FakeEvents) as Arc<dyn RenderEvents>;
        let ok = Arc::new(FakeProcess::succeeding()) as Arc<dyn RenderProcess>;
        let outcome = await_render_attempt(
            "job-1",
            &events,
            10.0,
            &ok,
            None,
            None,
            Duration::from_secs(30),
        );
        assert!(outcome.exit_success);
        assert!(!outcome.timed_out);

        let failed = Arc::new(FakeProcess::new()) as Arc<dyn RenderProcess>;
        let outcome = await_render_attempt(
            "job-2",
            &events,
            10.0,
            &failed,
            None,
            None,
            Duration::from_secs(30),
        );
        assert!(!outcome.exit_success);
        assert!(!outcome.timed_out);
    }

    #[test]
    fn runtime_replace_swaps_the_process_so_cancel_hits_the_retry() {
        let jobs: SharedRenderJobs = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let runtime = SharedRenderRuntime::new(jobs.clone());
        let first = Arc::new(FakeProcess::new()) as Arc<dyn RenderProcess>;
        let second = Arc::new(FakeProcess::new()) as Arc<dyn RenderProcess>;
        runtime.register("job-1", first.clone()).unwrap();
        // `register` rechaza un segundo render: el reemplazo es por job_id.
        assert!(runtime.register("job-2", second.clone()).is_err());
        runtime.replace("job-1", second.clone()).unwrap();
        runtime.cancel("job-1").unwrap();
        assert!(second.is_cancelled());
        assert!(!first.is_cancelled());
        // Un job desconocido no se puede reemplazar.
        assert!(runtime.replace("job-x", first).is_err());
        runtime.unregister("job-1");
        assert!(!runtime.is_busy());
    }

    #[test]
    fn gpu_failure_hint_detecta_firmas_de_device_loss() {
        assert!(gpu_failure_hint("CUDA_ERROR_INVALID_VALUE: ...").is_some());
        assert!(gpu_failure_hint("Device lost: ERROR_DEVICE_REMOVED").is_some());
        assert!(gpu_failure_hint("No NVENC capable devices present").is_some());
        assert!(gpu_failure_hint("Cannot load nvcuda.dll").is_some());
        assert!(gpu_failure_hint("QSV: no device available").is_some());
        assert!(gpu_failure_hint("AMF: failed to initialize").is_some());
        assert!(gpu_failure_hint("out of memory").is_some());
        // Un fallo genérico de decode no se confunde con GPU.
        assert!(gpu_failure_hint("Invalid data found when processing input").is_none());
        assert!(gpu_failure_hint("").is_none());
    }

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
