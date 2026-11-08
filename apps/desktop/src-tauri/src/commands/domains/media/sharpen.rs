//! Definición: nitidez perceptual en cinco etapas sobre FFmpeg.
//!
//! El orden de la cadena no es arbitrario; cada etapa prepara la siguiente:
//!
//! 1. **Limpieza** (`deblock` + `atadenoise`). Se saca el artefacto de
//!    compresión antes de tocar el contraste de borde: si se enfoca primero, el
//!    `unsharp` amplifica los cuadritos y el ruido.
//! 2. **Escalado** (`scale` con Lanczos3 en un espacio de trabajo de 16 bits).
//!    Se escala antes de enfocar para que el radio de la máscara caiga sobre la
//!    resolución final y no sobre la de origen.
//! 3. **Máscara de enfoque** (`unsharp`). Sube el contraste justo en el borde.
//! 4. **Curva S** (`curves`). Micro-contraste: negros más profundos y altas
//!    luces levantadas, sin recortar.
//! 5. **Grano** (`noise`). Última, para que el enfoque no lo amplifique.
//!
//! Filtros allowlisted y presentes tanto en el FFmpeg LGPL que se empaqueta
//! como en un FFmpeg completo del sistema: `deblock`, `atadenoise`, `scale`,
//! `format`, `unsharp`, `curves`, `noise`. Deliberadamente **no** se usa
//! `hqdn3d` ni `zscale`: el build LGPL empaquetado no los trae.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

/// Encoders H.264 en orden de preferencia. `libx264` es el mejor, pero el
/// FFmpeg LGPL que viaja con el instalador no puede incluirlo (es GPL): en una
/// instalación limpia el encoder real es `libopenh264` o el de la GPU.
const H264_CANDIDATES: &[&str] = &[
    "libx264",
    "h264_nvenc",
    "h264_amf",
    "h264_qsv",
    "libopenh264",
];

/// El binario de FFmpeg no cambia durante la sesión: se mide una vez.
static ENCODER_CACHE: Mutex<Option<(PathBuf, String)>> = Mutex::new(None);

include!("sharpen/clarity.rs");
include!("sharpen/filters.rs");
include!("sharpen/probe.rs");
include!("sharpen/command.rs");

#[cfg(test)]
#[path = "sharpen.tests.rs"]
mod tests;
