//! Scopes reales con el motor de FilmCraft (`filmcraft-scopes`, MIT/Apache-2.0).
//!
//! Toma el PNG del preview real y calcula waveform de luma, vectorscopio YUV e
//! histograma RGB con las mismas matrices que usa el editor FilmCraft.

use std::path::PathBuf;

use filmcraft_scopes::{histogram, vectorscope_yuv, waveform, Params, Signal, WaveformType};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeFrameRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeGrid {
    pub columns: usize,
    pub rows: usize,
    pub data: Vec<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeFrameResult {
    pub width: u32,
    pub height: u32,
    pub samples: usize,
    pub waveform: ScopeGrid,
    pub vectorscope: ScopeGrid,
    pub histogram: [Vec<u32>; 3],
    pub histogram_y: Vec<u32>,
    pub mean_cb_cr: [f32; 2],
}

#[tauri::command]
pub fn analyze_scopes_frame(
    _state: State<'_, AppState>,
    request: ScopeFrameRequest,
) -> Result<ScopeFrameResult, ProjectError> {
    let path = PathBuf::from(request.path.trim());
    if path.as_os_str().is_empty() || !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el frame para los scopes no está en disco",
        ));
    }
    let image = image::open(&path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el frame para los scopes no es una imagen válida",
        )
    })?;
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 || width > 16_384 || height > 16_384 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el frame tiene dimensiones fuera de rango para los scopes",
        ));
    }
    let rgba = image.to_rgba8();
    let signal = Signal::from_rgba8(width as usize, height as usize, rgba.as_raw());
    if signal.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el frame no tiene píxeles para analizar",
        ));
    }
    let params = Params::default();
    let luma = waveform(&signal, WaveformType::Luma, &params);
    let luma_grid = luma.trace("Y").ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "FilmCraft no devolvió la traza de luma",
        )
    })?;
    let vectors = vectorscope_yuv(&signal, &params);
    let hist = histogram(&signal, &params);
    Ok(ScopeFrameResult {
        width,
        height,
        samples: signal.len(),
        waveform: ScopeGrid {
            columns: luma_grid.cols,
            rows: luma_grid.rows,
            data: luma_grid.data.clone(),
        },
        vectorscope: ScopeGrid {
            columns: vectors.size,
            rows: vectors.size,
            data: vectors.data.clone(),
        },
        histogram: [hist.r, hist.g, hist.b],
        histogram_y: hist.y,
        mean_cb_cr: vectors.mean,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filmcraft_scopes_read_rgba_samples() {
        let mut rgba = Vec::new();
        for y in 0..8 {
            for x in 0..8 {
                let value = if (x + y) % 2 == 0 { 20 } else { 230 };
                rgba.extend_from_slice(&[value, value, value, 255]);
            }
        }
        let signal = Signal::from_rgba8(8, 8, &rgba);
        assert_eq!(signal.len(), 64);
        let params = Params::default();
        let luma = waveform(&signal, WaveformType::Luma, &params);
        let trace = luma.trace("Y").expect("traza Y");
        assert_eq!(trace.total(), 64);
        let hist = histogram(&signal, &params);
        assert_eq!(hist.samples, 64);
        let vector = vectorscope_yuv(&signal, &params);
        assert!(vector.size > 0);
    }
}
