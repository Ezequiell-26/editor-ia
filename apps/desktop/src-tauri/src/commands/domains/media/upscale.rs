//! Upscale ×4 con Real-ESRGAN corriendo localmente vía ONNX Runtime.
//!
//! El modelo exportado por Qualcomm tiene entrada fija de 128×128: cualquier
//! imagen se procesa por teselas con un borde de solape (10 px, igual que el
//! CLI de referencia de Real-ESRGAN) para que las costuras sean mínimas. Cada
//! tesela entra como [1, 3, 128, 128] float 0–1 RGB y sale [1, 3, 512, 512].

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use image::{imageops::FilterType, DynamicImage, GenericImage, GenericImageView, RgbaImage};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::commands::background::{drain_stderr, log_tail, read_full_frame};
use crate::commands::hide_console;
use crate::commands::models::{is_model_downloaded, model_by_id, model_dir};
use crate::commands::system::resolve_tools;
use crate::media::{probe_file, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const TILE: usize = 128;
/// Solape entre teselas: el CLI de referencia usa `tile_pad = 10`.
const TILE_PAD: usize = 10;
const SCALE: u32 = 4;
/// Tope de memoria: una imagen más grande se rechaza con el motivo claro.
const MAX_INPUT_SIDE: u32 = 2048;

static ENVIRONMENT: OnceLock<ort::environment::Environment> = OnceLock::new();

include!("upscale/runtime.rs");
include!("upscale/image.rs");
include!("upscale/video.rs");
#[cfg(test)]
#[path = "upscale.tests.rs"]
mod tests;
