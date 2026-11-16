//! Secuencias Lottie rasterizadas por el WebView — dominio puro.
//!
//! El frontend dibuja cada frame en un canvas y manda el PNG RGBA en base64;
//! acá viven la validación del token de sesión, los límites de la secuencia,
//! el layout de la carpeta temporal y la firma PNG. La escritura de lotes, la
//! codificación VP9 con alfa y el comando IPC quedan en
//! `commands/domains/media/lottie.rs`.

use std::path::{Path, PathBuf};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub(crate) const MAX_FRAMES: u32 = 3600;
pub(crate) const MAX_SIDE: u32 = 3840;
pub(crate) const MAX_FPS: u32 = 120;
pub(crate) const MAX_BATCH: usize = 24;
pub(crate) const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

pub(crate) fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// El token es un UUID v4 generado por el frontend: 36 caracteres hex y guiones.
/// Se usa como nombre de carpeta temporal, nunca como ruta.
pub(crate) fn sequence_dir(token: &str) -> Result<PathBuf, ProjectError> {
    let valid = token.len() == 36
        && token
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-');
    if !valid {
        return Err(invalid("el identificador de la secuencia no es válido"));
    }
    Ok(std::env::temp_dir().join(format!("olyvia-lottie-{token}")))
}

pub(crate) fn frame_path(dir: &Path, index: u32) -> PathBuf {
    dir.join(format!("frame-{index:05}.png"))
}

pub(crate) fn validate_sequence(
    width: u32,
    height: u32,
    frame_count: u32,
    fps_num: u32,
    fps_den: u32,
) -> Result<(), ProjectError> {
    if width < 2 || height < 2 || width > MAX_SIDE || height > MAX_SIDE {
        return Err(invalid(
            "las dimensiones de la secuencia están fuera de rango",
        ));
    }
    if !width.is_multiple_of(2) || !height.is_multiple_of(2) {
        return Err(invalid("las dimensiones de la secuencia deben ser pares"));
    }
    if frame_count == 0 || frame_count > MAX_FRAMES {
        return Err(invalid("la cantidad de frames está fuera de rango"));
    }
    if fps_num == 0 || fps_den == 0 {
        return Err(invalid("la tasa de la secuencia está fuera de rango"));
    }
    if fps_num > MAX_FPS.saturating_mul(fps_den) {
        return Err(invalid("la tasa de la secuencia está fuera de rango"));
    }
    Ok(())
}
