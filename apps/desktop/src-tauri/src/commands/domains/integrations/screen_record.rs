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
use std::sync::Mutex;
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
}

static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);

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
