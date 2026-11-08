//! Exporta un rango de un asset como short vertical 1080×1920.
//!
//! El encuadre es un recorte central (sin detección de rostro): escala el video
//! para cubrir el lienzo y recorta los lados o el alto que sobran. El audio se
//! conserva; si el material no tiene audio, el MP4 se publica sin pista de audio.
//! La salida se escribe en un temporal oculto, se verifica con FFprobe y recién
//! entonces se renombra.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::face::{self, FaceSample};
use crate::commands::hide_console;
use crate::commands::models::{is_model_downloaded, model_by_id, model_file, verify_model_hash};
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const SHORT_WIDTH: u32 = 1080;
const SHORT_HEIGHT: u32 = 1920;
const MIN_SECONDS: f64 = 3.0;
const MAX_SECONDS: f64 = 90.0;
/// El análisis de rostros no es un short: acepta clips cortos y ventanas
/// largas (hasta 10 minutos) porque sólo muestrea 6–30 frames.
const FACE_MIN_SECONDS: f64 = 0.1;
const FACE_MAX_SECONDS: f64 = 600.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportShortRequest {
    /// Ruta del asset relativa a la carpeta del proyecto.
    pub path: String,
    pub output_dir: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    #[serde(default)]
    pub label: Option<String>,
    /// Sigue el rostro más grande con el modelo SeetaFace local.
    #[serde(default)]
    pub smart_reframe: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportShortResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    /// `smart` si el encuadre siguió rostros; `center` si fue recorte fijo.
    pub reframe: String,
    /// Cantidad de frames muestreados en los que se encontró al menos un rostro.
    pub faces_detected: u32,
}

include!("shorts/validation.rs");
include!("shorts/face_analysis.rs");
include!("shorts/export.rs");
include!("shorts/face_track.rs");
#[cfg(test)]
#[path = "shorts.tests.rs"]
mod tests;
