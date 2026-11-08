//! Quitar fondo con U²-Net corriendo localmente vía ONNX Runtime.
//!
//! El flujo: se carga el modelo descargado (u2netp, 4,4 MB), la imagen se
//! re-escala a 320×320 y se normaliza igual que rembg, el modelo devuelve una
//! máscara de saliencia que se re-escala al tamaño original y se aplica como
//! canal alfa. El resultado es un PNG con transparencia, sin subir nada a
//! ningún lado.

use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;

use image::{imageops::FilterType, DynamicImage, GenericImageView, RgbImage, RgbaImage};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::commands::hide_console;
use crate::commands::models::{is_model_downloaded, model_by_id, model_dir};
use crate::commands::system::resolve_tools;
use crate::media::{import_file, probe_file, resolve_inside_root, MediaKind};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const U2NET_INPUT: usize = 320;
const U2NET_MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const U2NET_STD: [f32; 3] = [0.229, 0.224, 0.225];
/// Forma de la salida principal de u2netp (las otras salidas son mapas de
/// características intermedios con más canales).
const OUTPUT_SHAPE: [i64; 4] = [1, 1, 320, 320];

/// El entorno de ONNX Runtime se crea una sola vez y vive para siempre.
static ENVIRONMENT: OnceLock<ort::environment::Environment> = OnceLock::new();

/// ¿Se puede correr la inferencia en esta máquina? Medido: el DLL tiene que
/// estar junto al ejecutable (o en `ORT_DYLIB_PATH`).
include!("background/runtime.rs");
include!("background/image.rs");
include!("background/video.rs");
include!("background/command.rs");

#[cfg(test)]
#[path = "background.tests.rs"]
mod tests;
