//! Grabación de pantalla y webcam dentro de Olyvia (estilo OBS).
//!
//! Usa el FFmpeg que la app ya resuelve (`resolve_tools`): `gdigrab` para la
//! pantalla completa y `dshow` para la webcam, con PiP abajo-derecha cuando
//! hay ambas. La captura se controla por stdin (`q` = cierre ordenado, así el
//! MP4 queda bien formado; nunca se mata el proceso a lo bruto).
//!
//! Alcance honesto de esta versión: vídeo sin audio de escritorio (capturar
//! el audio del sistema en Windows exige un cable virtual tipo
//! virtual-audio-capturer; se puede sumar después como entrada dshow
//! opcional).

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use super::hide_console;
use super::system::resolve_tools;

const MAX_FPS: u32 = 60;
const STOP_TIMEOUT: Duration = Duration::from_secs(15);

struct Recording {
    child: Child,
    stdin: ChildStdin,
    output: PathBuf,
    started: Instant,
    webcam: Option<String>,
    streaming: bool,
    cursor_tracker: Option<CursorTracker>,
    cursor_spec: Option<CursorOverlaySpec>,
    /// Cola de stderr de ffmpeg: un hilo la drena durante toda la grabación
    /// (un pipe sin leer se llena a ~64 KB y bloquearía a ffmpeg) y `status`
    /// la reporta cuando el proceso muere solo, en vez de un «no graba» mudo.
    stderr_tail: Arc<Mutex<Vec<u8>>>,
    /// URL RTMP completa cuando hay streaming (AUD-098): ffmpeg la eco-a en
    /// stderr y la cola se redacta con ella — la clave nunca sale por IPC.
    stream_url: Option<String>,
}

/// Reserva de la grabación (AUD-094): el slot se toma ANTES de lanzar
/// ffmpeg y se mantiene ocupado hasta que el proceso terminó de cerrar.
/// Sin `Starting`/`Stopping`, dos `start` concurrentes pasaban el chequeo
/// y lanzaban dos ffmpeg (el segundo pisaba `RECORDING` y quedaba
/// inalcanzable para `stop`), y un `start` podía colarse en la ventana en
/// que `stop` ya había tomado el `Child` pero ffmpeg seguía escribiendo.
enum RecordState {
    Idle,
    /// `start` en curso: ffmpeg todavía no se lanzó o está verificando su
    /// arranque. Bloquea cualquier otro `start`/`stop`.
    Starting,
    Active(Recording),
    /// `stop` en curso: el proceso ya no está en el slot pero sigue
    /// cerrando (o re-codificando el cursor). Un `start` nuevo debe esperar.
    Stopping,
}

static RECORDING: Mutex<RecordState> = Mutex::new(RecordState::Idle);

/// Devuelve el slot a `Idle` al soltarse (AUD-094): cubre todos los `?` y
/// retornos tempranos de `screen_record_stop` una vez que el `Recording`
/// salió del slot — el proceso ya terminó o fue matado, así que la reserva
/// siempre se libera, incluso si el probe/burn falla.
struct RecordingStopGuard;

impl Drop for RecordingStopGuard {
    fn drop(&mut self) {
        *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = RecordState::Idle;
    }
}

/// `stop` toma la grabación activa y deja el slot en `Stopping` hasta que
/// el proceso terminó de cerrar (AUD-094): un `start` concurrente no puede
/// colarse en la ventana en que ffmpeg ya no está en el slot pero sigue
/// escribiendo el MP4. Devuelve `None` si no hay nada que parar —
/// Idle/Starting/Stopping se restauran sin tocarse.
fn take_active_for_stop() -> Option<Recording> {
    let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
    match std::mem::replace(&mut *guard, RecordState::Stopping) {
        RecordState::Active(rec) => Some(rec),
        other => {
            *guard = other;
            None
        }
    }
}

const STREAM_URL_REDACTED: &str = "[stream-url-oculta]";
const STREAM_KEY_REDACTED: &str = "[stream-key-oculta]";

/// AUD-098: la URL RTMP lleva la stream key y ffmpeg la repite en stderr.
/// Todo texto de error que salga del proceso pasa por acá: se redacta la
/// URL completa y la clave suelta (por si quedó un fragmento del buffer).
fn redact_stream_secrets(text: &str, stream_url: Option<&str>) -> String {
    let Some(url) = stream_url else {
        return text.to_owned();
    };
    let mut out = text.replace(url, STREAM_URL_REDACTED);
    if let Some(pos) = url.rfind('/') {
        let key = &url[pos + 1..];
        if key.len() >= crate::application::obs_scenes::MIN_STREAM_KEY_LEN {
            out = out.replace(key, STREAM_KEY_REDACTED);
        }
    }
    out
}

/// Variante sobre bytes para el hilo que drena stderr: reemplaza `secret`
/// por `placeholder` en todo el buffer acumulado — correrla en cada chunk
/// cubre secretos partidos entre lecturas consecutivas del pipe.
fn redact_secret_bytes(buf: &mut Vec<u8>, secret: &[u8], placeholder: &[u8]) {
    if secret.is_empty() {
        return;
    }
    let mut out: Vec<u8> = Vec::with_capacity(buf.len());
    let mut i = 0;
    while i < buf.len() {
        if buf.len() - i >= secret.len() && &buf[i..i + secret.len()] == secret {
            out.extend_from_slice(placeholder);
            i += secret.len();
        } else {
            out.push(buf[i]);
            i += 1;
        }
    }
    *buf = out;
}

/// Secretos a redactar del stderr de una grabación con streaming: la URL
/// completa y la clave suelta (último segmento >= MIN_STREAM_KEY_LEN).
fn stream_secret_bytes(stream_url: Option<&str>) -> Vec<Vec<u8>> {
    let Some(url) = stream_url else {
        return Vec::new();
    };
    let mut secrets = vec![url.as_bytes().to_vec()];
    if let Some(pos) = url.rfind('/') {
        let key = &url[pos + 1..];
        if key.len() >= crate::application::obs_scenes::MIN_STREAM_KEY_LEN {
            secrets.push(key.as_bytes().to_vec());
        }
    }
    secrets
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordStatus {
    pub recording: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webcam: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
    /// Últimas líneas de stderr de ffmpeg cuando la grabación murió sola.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor_burned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn io_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

include!("screen_record/state.rs");
include!("screen_record/devices.rs");
include!("screen_record/list_devices.rs");
include!("screen_record/start.rs");
include!("screen_record/stop.rs");
include!("screen_record/preview.rs");
include!("screen_record/snapshot.rs");
include!("screen_record/cursor_track.rs");
include!("screen_record/webcam_chroma.rs");

/// Nombre de salida sin colisiones (AUD-094): el timestamp tiene precisión
/// de segundos y `-y` pisaría un MP4 previo en la misma carpeta — se agrega
/// `-2`, `-3`… hasta encontrar un nombre libre.
fn unique_screen_output(dir: &std::path::Path, stamp: &str) -> PathBuf {
    let mut output = dir.join(format!("screen-{stamp}.mp4"));
    let mut suffix = 2u32;
    while output.exists() {
        output = dir.join(format!("screen-{stamp}-{suffix}.mp4"));
        suffix += 1;
    }
    output
}

fn chrono_lite_stamp() -> String {
    // YYYYMMDD-HHMMSS en hora local, sin dependencias nuevas.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Conversión civil aproximada (días desde epoch → Y/M/D, segundos → h:m:s UTC).
    let days = now / 86_400;
    let secs = now % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// Algoritmo de Hinnant: días desde 1970-01-01 → fecha civil (UTC).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
#[path = "screen_record.tests.rs"]
mod tests;
