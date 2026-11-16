//! Local speech-to-text: motor nativo in-process (whisper.cpp vía
//! `concat-speech-min`, vendor/concat) con fallback al puente Python de
//! Faster-Whisper.
//!
//! Orden de motores ([`engine_plan`]):
//! 1. **Nativo** — whisper.cpp corre dentro del proceso: no hay Python que
//!    instalar, el modelo se descarga on-demand con SHA-256 verificado a
//!    `<config>/whisper-models` y la inferencia usa FFmpeg del equipo para
//!    decodificar a PCM f32 16 kHz mono. Se intenta cuando el modelo pedido
//!    tiene equivalente en la tabla del crate y FFmpeg/FFprobe están
//!    disponibles; la descarga del modelo ocurre dentro del intento y su
//!    fallo también dispara el fallback.
//! 2. **Python** — el camino histórico: `transcribe_faster.py` embebido,
//!    Python resuelto sólo desde `EDITORIA_WHISPER_PYTHON` o un `python` de
//!    PATH que pueda `import faster_whisper`. Sin motor verificado la
//!    capacidad reporta `available: false` con el paso de instalación.
//!
//! El resultado informa qué motor produjo la transcripción en
//! `TranscriptionResult.engine` (`"native"`/`"python"`); la firma del
//! comando Tauri no cambia.
//!
//! El audio/video nunca sale de la computadora.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use crate::application::transcribe::{
    derive_hf_home, engine_plan, native_model_id, native_whisper_models, parse_result,
    resolve_python_with, result_from_native_segments, validate_language, validate_model,
    whisper_download_progress, NativeWhisperModel, NativeWhisperStatus, PythonProbe,
    TranscriptionEngine, TranscriptionResult, WhisperDownloadState, WhisperStatus,
};
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;
use crate::vendor_concat::speech::Transcriber;

pub(crate) const SCRIPT: &str = include_str!("../../../../scripts/transcribe_faster.py");

/// Mismo deadline que el camino Python: la transcripción de archivos largos
/// puede tardar minutos y un motor colgado no debe dejar el comando esperando
/// para siempre (AUD-007/008).
const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Techo de audio para el motor nativo: whisper.cpp carga la ventana entera
/// como `f32` en RAM (~230 MB por hora de audio a 16 kHz) y en CPU el
/// deadline de 30 min ya es justo más allá de la hora. Un archivo más largo
/// se salta el intento nativo y va directo al fallback Python, que streamea.
const NATIVE_MAX_SECONDS: f64 = 1800.0;

static STATUS: OnceLock<WhisperStatus> = OnceLock::new();

/// Estado del motor Python, medido una sola vez por proceso: el sondeo
/// importa el módulo y puede tardar uno o dos segundos la primera vez, así
/// que no se repite en cada consulta de capacidades. Si falta, el motivo
/// pide reiniciar la app después de instalarlo (la caché es de proceso, no
/// de disco). El motor nativo no depende de este sondeo: corre in-process.
pub(crate) fn whisper_status() -> &'static WhisperStatus {
    STATUS.get_or_init(resolve_python_status)
}

/// Un solo transcriber por proceso: conserva el modelo whisper cargado entre
/// transcripciones (cargarlo cuesta segundos) y el `SingleFlight` que
/// serializa corridas nativas concurrentes.
fn native_transcriber() -> &'static Transcriber {
    static TRANSCRIBER: OnceLock<Transcriber> = OnceLock::new();
    TRANSCRIBER.get_or_init(Transcriber::new)
}

fn command_succeeds(program: &Path, args: &[&str]) -> bool {
    let mut probe = Command::new(program);
    probe
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut probe);
    probe
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Sondeo real de un candidato: primero que sea un Python ejecutable, después
/// que pueda importar el módulo. Comprobar sólo `--version` daba falsos
/// positivos en equipos sin faster-whisper.
fn real_probe(python: &Path) -> PythonProbe {
    if !command_succeeds(python, &["--version"]) {
        return PythonProbe::Missing;
    }
    if command_succeeds(python, &["-c", "import faster_whisper"]) {
        PythonProbe::Ready
    } else {
        PythonProbe::WithoutFasterWhisper
    }
}

fn resolve_python_status() -> WhisperStatus {
    let env_python = std::env::var_os("EDITORIA_WHISPER_PYTHON")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let candidates: Vec<PathBuf> = ["python", "python3"]
        .into_iter()
        .map(PathBuf::from)
        .collect();
    resolve_python_with(env_python, &candidates, &real_probe)
}

// --------------------------------------------------------------------------- //
// Motor nativo: concat-speech-min (whisper.cpp in-process)
// --------------------------------------------------------------------------- //

/// Resultado de un intento de transcripción nativa.
pub(crate) enum NativeRun {
    /// Transcripción completa, ya en el DTO del comando.
    Done(TranscriptionResult),
    /// El archivo no entra en el presupuesto del motor in-process (demasiado
    /// largo): no es un fallo, el plan sigue con el siguiente motor.
    Skip,
    /// El motor no pudo completar el trabajo; el plan cae al siguiente.
    Failed(String),
    /// El deadline de 30 min venció y se pidió cancelar a whisper.
    TimedOut,
}

/// Decodifica el audio del archivo a PCM `f32` mono 16 kHz — el formato que
/// `Transcriber::transcribe_samples` espera — streameando stdout de FFmpeg a
/// un `Vec<f32>` sin pasar por el tope de captura de `output_with_timeout`
/// (64 MB ≈ 17 min de audio; acá entran hasta [`NATIVE_MAX_SECONDS`]).
fn decode_pcm_16k(ffmpeg: &Path, source: &Path, timeout: Duration) -> Result<Vec<f32>, String> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-nostats")
        .arg("-i")
        .arg(source)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-f")
        .arg("f32le")
        .arg("pipe:1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("no se pudo iniciar FFmpeg para decodificar: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "FFmpeg no expuso el audio decodificado".to_owned())?;

    // stdout se drena en un thread hacia un canal acotado: el consumo PCM
    // queda en este hilo y el deadline se chequea entre chunks, así una
    // lectura bloqueada no puede congelar el comando.
    let (tx, rx) = sync_channel::<Vec<u8>>(32);
    let reader = std::thread::spawn(move || {
        let mut buffer = [0u8; 256 * 1024];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if tx.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let deadline = Instant::now() + timeout;
    let mut samples: Vec<f32> = Vec::new();
    let mut carry: Vec<u8> = Vec::with_capacity(4);
    let mut timed_out = false;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => {
                carry.extend_from_slice(&chunk);
                let usable = carry.len() / 4 * 4;
                for bytes in carry[..usable].as_chunks::<4>().0 {
                    samples.push(f32::from_le_bytes(*bytes));
                }
                carry.drain(..usable);
            }
            Err(RecvTimeoutError::Timeout) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    // Si cortamos antes de que FFmpeg termine hay que matarlo: si no, queda
    // bloqueado escribiendo al pipe sin lector y `wait()` nunca vuelve.
    if timed_out {
        let _ = child.kill();
    }
    let _ = reader.join();
    let status = child
        .wait()
        .map_err(|error| format!("FFmpeg no terminó de decodificar: {error}"))?;
    if timed_out {
        return Err("la decodificación del audio tardó demasiado".to_owned());
    }
    if !status.success() && samples.is_empty() {
        return Err("FFmpeg no pudo decodificar el audio de este material".to_owned());
    }
    Ok(samples)
}

/// Deadline de la decodificación PCM para el motor nativo: ~10× la duración
/// del archivo (el decode corre ~50× realtime), con piso de 2 min y techo de
/// 30 min — el mismo techo que el deadline global del intento.
fn decode_timeout_for(duration_seconds: f64) -> Duration {
    Duration::from_secs_f64((duration_seconds.max(0.0) * 10.0).clamp(120.0, 1800.0))
}

/// Intento nativo completo (corre dentro de `spawn_blocking`): modelo
/// on-demand → FFprobe (duración) → FFmpeg a PCM 16 kHz → whisper.cpp.
/// `timed_out` lo marca el watchdog externo cuando vence el deadline.
#[allow(clippy::too_many_arguments)]
fn run_native_blocking(
    transcriber: &Transcriber,
    timed_out: &AtomicBool,
    ffmpeg: &Path,
    ffprobe: &Path,
    source: &Path,
    models_dir: &Path,
    model_id: &str,
    language: Option<&str>,
    requested_language: &str,
    requested_model: &str,
) -> NativeRun {
    // 1. Modelo: si no está en disco se descarga on-demand (mirror de
    //    Concat → Hugging Face pineado → hf-mirror, con SHA-256). Cualquier
    //    fallo — sin red, digest distinto, cancelación — cae al fallback.
    //    La descarga actualiza el tracker compartido para que
    //    `whisper_model_status` la reporte aunque la haya disparado una
    //    transcripción.
    let model_file = models_dir.join(format!("ggml-{model_id}.bin"));
    if !model_file.is_file() {
        native_download_begin(model_id);
        let outcome = transcriber.download_model(models_dir, model_id, |progress| {
            native_download_progress(progress);
        });
        native_download_finish(model_id, outcome.as_ref().err().map(String::as_str));
        if let Err(error) = outcome {
            return NativeRun::Failed(format!("no se pudo descargar el modelo {model_id}: {error}"));
        }
    }
    if timed_out.load(Ordering::Relaxed) {
        return NativeRun::TimedOut;
    }

    // 2. Duración: decide si el archivo entra en el presupuesto del motor
    //    in-process y calibra el deadline de la decodificación.
    let (duration, _rate) = match crate::commands::audio::probe_audio(ffprobe, source) {
        Ok(probed) => probed,
        Err(error) => {
            return NativeRun::Failed(format!(
                "FFprobe no pudo medir el audio: {}",
                error.message
            ))
        }
    };
    if duration > NATIVE_MAX_SECONDS {
        return NativeRun::Skip;
    }

    // 3. PCM f32 16 kHz mono. El decode corre ~50× realtime; el timeout es
    //    proporcional a la duración con piso y techo generosos.
    let samples = match decode_pcm_16k(ffmpeg, source, decode_timeout_for(duration)) {
        Ok(samples) => samples,
        Err(error) => return NativeRun::Failed(error),
    };
    if samples.is_empty() {
        return NativeRun::Failed("el archivo no tiene audio que transcribir".to_owned());
    }
    if timed_out.load(Ordering::Relaxed) {
        return NativeRun::TimedOut;
    }

    // 4. whisper.cpp in-process. `language`: `None` = autodetectar.
    let segments = match transcriber.transcribe_samples(
        models_dir,
        model_id,
        language,
        &samples,
        |_| {},
    ) {
        Ok(segments) => segments,
        Err(error) => {
            return if timed_out.load(Ordering::Relaxed) {
                NativeRun::TimedOut
            } else {
                NativeRun::Failed(format!("whisper.cpp no pudo transcribir: {error}"))
            };
        }
    };
    if timed_out.load(Ordering::Relaxed) {
        return NativeRun::TimedOut;
    }

    let duration_seconds = if duration > 0.0 {
        duration
    } else {
        samples.len() as f64 / 16_000.0
    };
    NativeRun::Done(result_from_native_segments(
        &segments,
        requested_language,
        requested_model,
        duration_seconds,
    ))
}

/// Parámetros de una corrida del motor nativo (whisper.cpp): rutas de
/// trabajo, modelo y preferencias de idioma pedidas por el usuario.
pub(crate) struct NativeRunSpec {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub source: PathBuf,
    pub models_dir: PathBuf,
    pub model_id: &'static str,
    pub language: Option<String>,
    pub requested_language: String,
    pub requested_model: String,
}

/// Envuelve `run_native_blocking` con el watchdog de 30 min: a diferencia
/// del camino Python no hay proceso externo que matar, así que el deadline
/// se aplica pidiendo la cancelación a whisper (`Transcriber::cancel`,
/// callback abort de whisper.cpp) y a la descarga en curso.
pub(crate) async fn run_native(spec: NativeRunSpec) -> NativeRun {
    let NativeRunSpec {
        ffmpeg,
        ffprobe,
        source,
        models_dir,
        model_id,
        language,
        requested_language,
        requested_model,
    } = spec;
    let transcriber = native_transcriber();
    let timed_out = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let watchdog = {
        let timed_out = Arc::clone(&timed_out);
        let finished = Arc::clone(&finished);
        std::thread::spawn(move || {
            let deadline = Instant::now() + TRANSCRIBE_TIMEOUT;
            while !finished.load(Ordering::Relaxed) {
                if Instant::now() >= deadline {
                    timed_out.store(true, Ordering::Relaxed);
                    transcriber.cancel();
                    transcriber.cancel_download();
                    return;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        })
    };

    let outcome = tokio::task::spawn_blocking({
        let timed_out = Arc::clone(&timed_out);
        move || {
            run_native_blocking(
                transcriber,
                &timed_out,
                &ffmpeg,
                &ffprobe,
                &source,
                &models_dir,
                model_id,
                language.as_deref(),
                &requested_language,
                &requested_model,
            )
        }
    })
    .await;

    finished.store(true, Ordering::Relaxed);
    let _ = watchdog.join();
    match outcome {
        Ok(run) => run,
        Err(_) => {
            if timed_out.load(Ordering::Relaxed) {
                NativeRun::TimedOut
            } else {
                NativeRun::Failed("el hilo de transcripción nativa se interrumpió".to_owned())
            }
        }
    }
}

// --------------------------------------------------------------------------- //
// Estado del motor nativo: modelos ggml y descarga bajo demanda
// --------------------------------------------------------------------------- //

/// Tracker de la descarga de modelo nativo en curso. El crate serializa las
/// descargas con su `SingleFlight` pero no expone si está ocupado, así que el
/// estado "running/progress/error" lo mantiene esta capa: tanto el comando
/// `whisper_model_download` como la descarga implícita de `transcribe_asset`
/// lo alimentan.
#[derive(Default)]
struct NativeDownloadTracker {
    running: bool,
    model_id: Option<String>,
    progress: Option<crate::application::transcribe::WhisperModelDownloadProgress>,
    error: Option<String>,
}

impl NativeDownloadTracker {
    fn begin(&mut self, model_id: &str) {
        *self = Self {
            running: true,
            model_id: Some(model_id.to_owned()),
            progress: None,
            error: None,
        };
    }

    fn progress(&mut self, progress: crate::vendor_concat::speech::DownloadProgress) {
        self.progress = Some(whisper_download_progress(&progress));
    }

    fn finish(&mut self, model_id: &str, error: Option<&str>) {
        // Sólo el dueño de la corrida limpia el estado: una descarga
        // implícita y una explícita no pueden correr a la vez (SingleFlight),
        // pero el guard evita pisar el estado de otra si eso cambiara.
        if self.model_id.as_deref() != Some(model_id) {
            return;
        }
        self.running = false;
        if let Some(error) = error {
            self.error = Some(error.to_owned());
        }
    }

    fn snapshot(&self) -> WhisperDownloadState {
        WhisperDownloadState {
            running: self.running,
            model_id: self.model_id.clone(),
            progress: self.progress.clone(),
            error: self.error.clone(),
        }
    }
}

static NATIVE_DOWNLOAD: std::sync::Mutex<NativeDownloadTracker> =
    std::sync::Mutex::new(NativeDownloadTracker {
        running: false,
        model_id: None,
        progress: None,
        error: None,
    });

fn native_download_begin(model_id: &str) {
    if let Ok(mut tracker) = NATIVE_DOWNLOAD.lock() {
        tracker.begin(model_id);
    }
}

fn native_download_progress(progress: crate::vendor_concat::speech::DownloadProgress) {
    if let Ok(mut tracker) = NATIVE_DOWNLOAD.lock() {
        tracker.progress(progress);
    }
}

fn native_download_finish(model_id: &str, error: Option<&str>) {
    if let Ok(mut tracker) = NATIVE_DOWNLOAD.lock() {
        tracker.finish(model_id, error);
    }
}

/// Estado del motor nativo para la UI: tabla de modelos del crate con su
/// estado en disco, descarga en curso y transcripción activa.
pub(crate) fn native_whisper_status(
    config_dir: &std::path::Path,
) -> Result<NativeWhisperStatus, ProjectError> {
    let models_dir = crate::vendor_concat::whisper_models_dir(config_dir);
    let status = Transcriber::status(&models_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo leer el estado de los modelos whisper: {error}").as_str(),
        )
    })?;
    let transcriber = native_transcriber();
    let download = NATIVE_DOWNLOAD
        .lock()
        .map(|tracker| tracker.snapshot())
        .unwrap_or_default();
    Ok(NativeWhisperStatus {
        engine_available: true,
        models_dir: status.models_dir.clone(),
        models: native_whisper_models(&status),
        loaded_model: transcriber.loaded_model(),
        busy: transcriber.is_busy(),
        download,
    })
}

/// La entrada de un modelo concreto dentro del estado nativo (para responder
/// `whisper_model_download` con el modelo ya actualizado).
fn native_whisper_model_entry(
    config_dir: &std::path::Path,
    model_id: &str,
) -> Result<NativeWhisperModel, ProjectError> {
    let status = native_whisper_status(config_dir)?;
    status
        .models
        .into_iter()
        .find(|model| model.id == model_id)
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "ese modelo whisper no existe en la tabla del motor nativo",
            )
        })
}

/// Evento Tauri con el progreso real de la descarga del modelo nativo.
const WHISPER_DOWNLOAD_EVENT: &str = "whisper-model-download";

/// Estado de los modelos del motor nativo (whisper.cpp in-process): qué hay
/// en `<config>/whisper-models`, cuál está cargado y si hay una descarga en
/// curso. No descarga nada ni toca red.
#[tauri::command]
pub fn whisper_model_status(
    state: State<'_, AppState>,
) -> Result<NativeWhisperStatus, ProjectError> {
    native_whisper_status(&state.config_dir)
}

/// Descarga un modelo `ggml` del motor nativo (mirror de Concat → Hugging
/// Face pineado → hf-mirror, con verificación SHA-256 y resume por Range).
///
/// El `model_id` es el de la tabla del crate (`tiny`, `tiny.en`, `base`,
/// `base.en`, `small`, `small.en`), no el alias de `transcribe_asset`.
/// Emite `whisper-model-download` con `{ modelId, received, total,
/// unpacking, done, percent }` a medida que llegan los bytes — progreso
/// real, no una estimación. Si el modelo ya está en disco responde al
/// instante; una segunda descarga concurrente se rechaza (el crate
/// serializa con SingleFlight y el tracker lo reporta como `running`).
#[tauri::command]
pub async fn whisper_model_download(
    app: AppHandle,
    state: State<'_, AppState>,
    model_id: String,
) -> Result<NativeWhisperModel, ProjectError> {
    let model_id = model_id.trim().to_owned();
    // Validación sin red: la tabla del crate decide qué ids existen.
    if Transcriber::model_sources(&model_id).is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "ese modelo whisper no existe; usá tiny, tiny.en, base, base.en, small o small.en",
        ));
    }
    let config_dir = state.config_dir.clone();
    let models_dir = crate::vendor_concat::whisper_models_dir(&config_dir);
    if models_dir.join(format!("ggml-{model_id}.bin")).is_file() {
        return native_whisper_model_entry(&config_dir, &model_id);
    }
    {
        let tracker = NATIVE_DOWNLOAD.lock().map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "el estado de descarga de modelos no está disponible",
            )
        })?;
        if tracker.running {
            return Err(ProjectError::message(
                ProjectErrorCode::AlreadyExists,
                &format!(
                    "ya hay una descarga de modelo en curso ({})",
                    tracker
                        .model_id
                        .as_deref()
                        .unwrap_or("desconocido")
                ),
            ));
        }
    }

    let transcriber = native_transcriber();
    let app_handle = app.clone();
    let download_id = model_id.clone();
    let outcome = tokio::task::spawn_blocking(move || -> Result<(), ProjectError> {
        native_download_begin(&download_id);
        let result = transcriber.download_model(&models_dir, &download_id, |progress| {
            native_download_progress(progress.clone());
            if let Ok(payload) = serde_json::to_value(whisper_download_progress(&progress)) {
                let _ = app_handle.emit(WHISPER_DOWNLOAD_EVENT, payload);
            }
        });
        let error_text = result.as_ref().err().map(String::as_str);
        native_download_finish(&download_id, error_text);
        if let Err(error) = &result {
            let _ = app_handle.emit(
                WHISPER_DOWNLOAD_EVENT,
                serde_json::json!({
                    "modelId": download_id,
                    "received": 0,
                    "total": 0,
                    "unpacking": false,
                    "done": true,
                    "percent": null,
                    "error": error,
                }),
            );
        }
        result.map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                format!("no se pudo descargar el modelo {download_id}: {error}").as_str(),
            )
        })
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el hilo de descarga del modelo se interrumpió",
        )
    })?;
    outcome?;
    native_whisper_model_entry(&config_dir, &model_id)
}

/// Cancela la descarga de modelo nativo en curso. No-op si no hay ninguna:
/// `cancel_download` del crate es seguro siempre y el tracker se limpia acá
/// para que `whisper_model_status` deje de reportar `running` apenas el
/// hilo de descarga termina de deshacerse (su propio `finish` pisa el error
/// con el motivo real si difiere).
#[tauri::command]
pub fn whisper_model_download_cancel() -> Result<(), ProjectError> {
    native_transcriber().cancel_download();
    if let Ok(mut tracker) = NATIVE_DOWNLOAD.lock() {
        if tracker.running {
            if let Some(model_id) = tracker.model_id.clone() {
                tracker.finish(&model_id, Some("descarga cancelada por el usuario"));
            }
        }
    }
    Ok(())
}

// --------------------------------------------------------------------------- //
// Motor Python: faster-whisper (camino histórico)
// --------------------------------------------------------------------------- //

/// Transcribe con el puente Python. Es el último recurso del plan: si falla,
/// su error es el que se reporta.
#[allow(clippy::too_many_arguments)]
async fn transcribe_with_python(
    cache_dir: PathBuf,
    root: PathBuf,
    python: PathBuf,
    path: PathBuf,
    language: String,
    model: String,
) -> Result<TranscriptionResult, ProjectError> {
    let script = cache_dir.join("transcribe_faster.py");
    if let Err(error) = std::fs::write(&script, SCRIPT) {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el script de transcripción: {error}").as_str(),
        ));
    }
    let hf_home = derive_hf_home(&python);
    // AUD-007/008: la transcripción puede tardar varios minutos; corre en un
    // hilo bloqueante del pool de Tokio y con deadline para que un Python
    // colgado no deje el comando esperando para siempre.
    let output = tokio::task::spawn_blocking(move || {
        let mut command = Command::new(&python);
        command
            .arg(&script)
            .arg(&path)
            .arg("--language")
            .arg(&language)
            .arg("--model")
            .arg(&model)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1");
        if let Some(hf_home) = hf_home {
            command.env("EDITORIA_HF_HOME", hf_home);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        crate::commands::output_with_timeout(&mut command, TRANSCRIBE_TIMEOUT)
    })
    .await
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el hilo de transcripción se interrumpió",
        )
    })?
    .map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se pudo iniciar Python para transcribir",
        )
    })?;
    if output.timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la transcripción superó el tiempo máximo (30 min) y se canceló",
        ));
    }
    let Some(output) = output.into_output() else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la transcripción terminó de forma inesperada",
        ));
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!(
                "Faster-Whisper no pudo transcribir: {}",
                sanitize_log(&stderr, &root, 400)
            )
            .as_str(),
        ));
    }
    let mut result = parse_result(&output.stdout)?;
    result.engine = Some(TranscriptionEngine::Python.label().to_owned());
    Ok(result)
}

#[tauri::command]
pub async fn transcribe_asset(
    state: State<'_, AppState>,
    asset_id: String,
    language: Option<String>,
    model: Option<String>,
) -> Result<TranscriptionResult, ProjectError> {
    let session = state.require_session()?;
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el audio que se quiere transcribir no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("");
    if kind != "audio" && kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la transcripción sólo se aplica a audio o video",
        ));
    }
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el material no está listo para transcribir",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de audio no está en disco",
        ));
    }

    let language = validate_language(
        language
            .as_deref()
            .or_else(|| opened.project["language"].as_str())
            .unwrap_or("auto"),
    )?;
    let model = validate_model(model.as_deref().unwrap_or("small"))?;

    // Plan de motores: nativo primero (si el modelo tiene equivalente y hay
    // FFmpeg para decodificar), Python después. La descarga del modelo
    // nativo ocurre dentro del intento; su fallo también cae al fallback.
    let status = whisper_status();
    let python = status.python.clone();
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let models_dir = crate::vendor_concat::whisper_models_dir(&state.config_dir);
    let native_model = native_model_id(&model);
    let native_supported =
        native_model.is_some() && ffmpeg.is_some() && ffprobe.is_some();
    let engines = engine_plan(native_supported, python.is_some());
    if engines.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!(
                "la transcripción no está disponible: {}",
                status
                    .reason
                    .as_deref()
                    .unwrap_or("falta un Python con faster-whisper y FFmpeg para el motor nativo")
            ),
        ));
    }

    let root = session.root.clone();
    let mut failures: Vec<String> = Vec::new();
    for engine in engines {
        match engine {
            TranscriptionEngine::Native => {
                let (Some(ffmpeg), Some(ffprobe), Some(model_id)) =
                    (ffmpeg.clone(), ffprobe.clone(), native_model)
                else {
                    continue;
                };
                let language_opt = if language.eq_ignore_ascii_case("auto") {
                    None
                } else {
                    Some(language.clone())
                };
                match run_native(NativeRunSpec {
                    ffmpeg,
                    ffprobe,
                    source: path.clone(),
                    models_dir: models_dir.clone(),
                    model_id,
                    language: language_opt,
                    requested_language: language.clone(),
                    requested_model: model.clone(),
                })
                .await
                {
                    NativeRun::Done(result) => return Ok(result),
                    NativeRun::Skip => {
                        failures.push(
                            "el motor nativo no cubre archivos de más de 30 min".to_owned(),
                        );
                    }
                    NativeRun::Failed(error) => {
                        failures.push(format!("motor nativo (whisper.cpp): {error}"));
                    }
                    NativeRun::TimedOut => {
                        return Err(ProjectError::message(
                            ProjectErrorCode::ProviderUnavailable,
                            "la transcripción superó el tiempo máximo (30 min) y se canceló",
                        ));
                    }
                }
            }
            TranscriptionEngine::Python => {
                let Some(python) = python.clone() else {
                    continue;
                };
                return transcribe_with_python(
                    state.cache_dir.clone(),
                    root.clone(),
                    python,
                    path.clone(),
                    language.clone(),
                    model.clone(),
                )
                .await;
            }
        }
    }

    Err(ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        format!(
            "ningún motor de transcripción pudo completar el trabajo ({})",
            failures.join("; ")
        )
        .as_str(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ejecutable real de la máquina que **no** puede importar faster-whisper:
    /// sirve como Python falso sin depender de que el equipo de tests tenga
    /// Python instalado.
    #[cfg(windows)]
    fn fake_python() -> PathBuf {
        let root = std::env::var_os("SystemRoot").expect("SystemRoot en Windows");
        PathBuf::from(root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    #[cfg(not(windows))]
    fn fake_python() -> PathBuf {
        PathBuf::from("/bin/sh")
    }

    #[cfg(windows)]
    fn shell_program() -> PathBuf {
        std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .expect("ComSpec")
    }

    #[cfg(not(windows))]
    fn shell_program() -> PathBuf {
        PathBuf::from("/bin/sh")
    }

    #[test]
    fn command_probe_distinguishes_success_and_failure() {
        let shell = shell_program();
        let (ok, bad): (&[&str], &[&str]) = if cfg!(windows) {
            (&["/D", "/C", "exit 0"], &["/D", "/C", "exit 1"])
        } else {
            (&["-c", "exit 0"], &["-c", "exit 1"])
        };
        assert!(command_succeeds(&shell, ok));
        assert!(!command_succeeds(&shell, bad));
        assert!(!command_succeeds(
            &PathBuf::from("olyvia-python-que-no-existe-98765"),
            &["--version"]
        ));
    }

    #[test]
    fn a_fake_python_that_cannot_import_the_module_is_not_ready() {
        let fake = fake_python();
        assert!(fake.is_file(), "el fixture debe existir");
        // El chequeo clave no es `--version`, es la importación del módulo:
        // un ejecutable real que no importa faster_whisper nunca es Ready.
        assert!(!command_succeeds(&fake, &["-c", "import faster_whisper"]));
        assert_ne!(real_probe(&fake), PythonProbe::Ready);
    }

    #[test]
    fn decode_timeout_is_proportional_and_bounded() {
        assert_eq!(decode_timeout_for(0.0), Duration::from_secs(120));
        assert_eq!(decode_timeout_for(60.0), Duration::from_secs(600));
        assert_eq!(decode_timeout_for(7200.0), Duration::from_secs(1800));
    }

    fn download_progress(received: u64, total: u64, done: bool) -> crate::vendor_concat::speech::DownloadProgress {
        crate::vendor_concat::speech::DownloadProgress {
            id: "base".to_owned(),
            received,
            total,
            unpacking: false,
            done,
        }
    }

    #[test]
    fn native_download_tracker_reports_running_progress_then_done() {
        let mut tracker = NativeDownloadTracker::default();
        assert!(!tracker.snapshot().running);

        tracker.begin("base");
        let snapshot = tracker.snapshot();
        assert!(snapshot.running);
        assert_eq!(snapshot.model_id.as_deref(), Some("base"));
        assert!(snapshot.error.is_none());

        tracker.progress(download_progress(1_000, 4_000, false));
        let snapshot = tracker.snapshot();
        assert!(snapshot.running);
        let progress = snapshot.progress.expect("progreso");
        assert_eq!(progress.received, 1_000);
        assert_eq!(progress.percent, Some(25.0));

        tracker.finish("base", None);
        let snapshot = tracker.snapshot();
        assert!(!snapshot.running);
        assert!(snapshot.error.is_none());
        // El último progreso queda para que la UI muestre el resultado.
        assert!(snapshot.progress.is_some());
    }

    #[test]
    fn native_download_tracker_keeps_the_error_of_a_failed_run() {
        let mut tracker = NativeDownloadTracker::default();
        tracker.begin("small.en");
        tracker.finish("small.en", Some("could not download: every source failed"));
        let snapshot = tracker.snapshot();
        assert!(!snapshot.running);
        let error = snapshot.error.expect("error guardado");
        assert!(error.contains("every source failed"), "{error}");
        // Una nueva corrida limpia el error anterior.
        tracker.begin("tiny");
        assert!(tracker.snapshot().error.is_none());
    }

    #[test]
    fn native_download_tracker_ignores_a_finish_from_another_model() {
        let mut tracker = NativeDownloadTracker::default();
        tracker.begin("base");
        // El SingleFlight del crate impide dos descargas a la vez; si un
        // finish ajeno llegara igual, no debe apagar la corrida real.
        tracker.finish("tiny", Some("fallo ajeno"));
        let snapshot = tracker.snapshot();
        assert!(snapshot.running);
        assert_eq!(snapshot.model_id.as_deref(), Some("base"));
        assert!(snapshot.error.is_none());
    }

    #[test]
    fn native_whisper_status_reports_models_on_disk() {
        let config_dir = std::env::temp_dir().join(format!(
            "olyvia-whisper-status-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let models_dir = crate::vendor_concat::whisper_models_dir(&config_dir);
        std::fs::create_dir_all(&models_dir).expect("carpeta de modelos");
        // Un .bin vacío alcanza: `Transcriber::status` sólo mira is_file.
        std::fs::write(models_dir.join("ggml-tiny.bin"), b"fake").expect("modelo fake");

        let status = native_whisper_status(&config_dir).expect("status nativo");
        assert!(status.engine_available);
        assert!(!status.models.is_empty());
        assert!(!status.busy);
        let tiny = status
            .models
            .iter()
            .find(|model| model.id == "tiny")
            .expect("tiny en la tabla");
        assert!(tiny.downloaded);
        assert!(tiny.path.as_deref().unwrap().ends_with("ggml-tiny.bin"));
        let base = status
            .models
            .iter()
            .find(|model| model.id == "base")
            .expect("base en la tabla");
        assert!(!base.downloaded);
        assert!(base.path.is_none());

        let _ = std::fs::remove_dir_all(&config_dir);
    }
}
