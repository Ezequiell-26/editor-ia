//! Denoise Studio: especificación del filtro FFmpeg y nombres de salida.
//!
//! El preview en tiempo real vive en el frontend (shader WebGL sobre un proxy
//! visual). El render de calidad corre en el comando `denoise_media` con
//! FFmpeg sobre el archivo original; este módulo es puro y testeable.
//!
//! Filtros allowlisted (FFmpeg 9.0.1 de esta máquina):
//! `hqdn3d` rápido, `atadenoise` temporal y `nlmeans` de alta calidad.

use std::path::{Path, PathBuf};

use crate::projects::service::{ProjectError, ProjectErrorCode};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenoisePreset {
    Fast,
    Balanced,
    Quality,
}

impl DenoisePreset {
    pub fn parse(value: Option<&str>) -> Result<Self, ProjectError> {
        match value
            .unwrap_or("balanced")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "fast" => Ok(Self::Fast),
            "balanced" => Ok(Self::Balanced),
            "quality" => Ok(Self::Quality),
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "preajuste de denoise inválido: usá fast, balanced o quality",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenoiseMode {
    Video,
    Image,
}

impl DenoiseMode {
    pub fn parse(value: Option<&str>) -> Result<Self, ProjectError> {
        match value
            .unwrap_or("video")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "video" => Ok(Self::Video),
            "image" | "imagen" => Ok(Self::Image),
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "modo de denoise inválido: usá video o image",
            )),
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Video => "mp4",
            Self::Image => "png",
        }
    }
}

/// Construye la cadena de filtros. Es pura para poder testearla sin FFmpeg.
///
/// El FFmpeg empaquetado es LGPL y **no trae `hqdn3d`** (tampoco `vaguedenoiser`
/// ni `owdenoise`), así que el denoise espacial va con `dctdnoiz` (rápido) o
/// `nlmeans` (calidad), y el temporal con `atadenoise`. Todos verificados contra
/// el binario que viaja con el instalador.
pub fn denoise_filter(
    preset: DenoisePreset,
    strength: u8,
    temporal: bool,
    preserve_detail: bool,
) -> String {
    let base = (strength.clamp(1, 100) as f32) / 100.0;
    // Preservar detalle reduce la agresividad; nunca la sube.
    let amount = if preserve_detail { base * 0.72 } else { base };
    // `atadenoise` solo acepta tamaños de ventana impares entre 3 y 9.
    let window = (3 + ((amount * 6.0).round() as u32)) | 1;
    let temporal_stage = if temporal {
        format!("atadenoise=s={window},")
    } else {
        String::new()
    };
    match preset {
        DenoisePreset::Fast => {
            // dctdnoiz: DCT 8×8, sigma alto = más limpieza.
            let sigma = 1.5 + amount * 4.5;
            format!("{temporal_stage}dctdnoiz=sigma={sigma:.2}")
        }
        DenoisePreset::Balanced => {
            let sigma = 2.5 + amount * 7.5;
            format!("{temporal_stage}dctdnoiz=sigma={sigma:.2}")
        }
        DenoisePreset::Quality => {
            // nlmeans: s = fuerza, p = tamaño de parche, r = ventana de búsqueda.
            let s = 1.0 + amount * 9.0;
            format!("{temporal_stage}nlmeans=s={s:.2}:p=7:r=15")
        }
    }
}

pub fn unique_output(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let safe_stem: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let stem = safe_stem.trim().trim_matches('-');
    let stem = if stem.is_empty() { "archivo" } else { stem };
    let mut candidate = dir.join(format!("{stem}-denoise.{extension}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-denoise-{index}.{extension}"));
        index += 1;
    }
    candidate
}

#[cfg(test)]
#[path = "denoise.tests.rs"]
mod tests;
