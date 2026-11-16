//! Chroma key de la webcam durante la grabación (paridad
//! `gravar_webcam_chroma` de AlaukCut): la fuente `dshow` pasa por el filtro
//! `chromakey` de FFmpeg antes del escalado/PiP, así el fondo verde (u otro
//! color) sale transparente en la misma pasada de captura — sin postproceso.
//!
//! Alcance honesto: `similarity`/`blend` del filtro `chromakey`; el
//! `despill` (supresión de derrame) de la schema de clips no se aplica
//! porque el filtro equivalente en una sola pasada no existe en esta
//! versión — queda documentado como aproximación.

use serde::{Deserialize, Serialize};

use crate::projects::service::{ProjectError, ProjectErrorCode};

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// Parámetros del chroma key de webcam. Misma semántica que `ChromaKeySchema`
/// de la timeline (`#RRGGBB`, similarity 0.01–1, blend 0–1) para que el
/// usuario reconozca los controles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebcamChromaSpec {
    /// Color a keyear, `#RRGGBB`.
    pub color: String,
    /// 0.01–1: tolerancia del color.
    pub similarity: f64,
    /// 0–1: dureza del borde del recorte.
    pub blend: f64,
}

impl WebcamChromaSpec {
    pub fn validate(&self) -> Result<(), ProjectError> {
        let hex = self.color.trim_start_matches('#');
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(invalid("webcamChroma.color debe ser #RRGGBB"));
        }
        if !(0.01..=1.0).contains(&self.similarity) {
            return Err(invalid("webcamChroma.similarity debe estar entre 0.01 y 1"));
        }
        if !(0.0..=1.0).contains(&self.blend) {
            return Err(invalid("webcamChroma.blend debe estar entre 0 y 1"));
        }
        Ok(())
    }

    /// Fragmento `chromakey=…,format=yuva420p` listo para encadenar antes
    /// del `scale` de la webcam. `chromakey` acepta `0xRRGGBB`.
    pub fn ffmpeg_chain(&self) -> String {
        let hex = self.color.trim_start_matches('#');
        format!(
            "chromakey=color=0x{hex}:similarity={:.4}:blend={:.4},format=yuva420p",
            self.similarity.clamp(0.01, 1.0),
            self.blend.clamp(0.0, 1.0)
        )
    }
}
