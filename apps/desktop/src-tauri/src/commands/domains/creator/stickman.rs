//! Motor de animación 2D: stickman articulado con huesos y keyframes.
//!
//! Es un rig paramétrico propio (sin dependencias nuevas): el esqueleto se
//! define como segmentos con longitudes y el "pose" son ángulos absolutos por
//! hueso. La cinemática directa (FK) resuelve las posiciones de las
//! articulaciones y el rasterizador (`image`, MIT/Apache-2.0) dibuja líneas
//! gruesas y articulaciones sobre un framebuffer RGB. Los cuadros se escriben
//! como PNG en un temporal y FFmpeg los codifica a MP4 (mismo camino que el
//! resto de la app: sin shell, args validados).
//!
//! Acciones procedurales incluidas: `idle`, `walk`, `run`, `wave` y `jump`.
//! Además el pose admite `keyframes`: lista de `{frame, pose}` con
//! interpolación lineal por hueso, así la IA o el usuario puede animar
//! cualquier articulación fotograma a fotograma.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use super::system::resolve_tools;

// ---------------------------------------------------------------------------
// Pose y esqueleto
// ---------------------------------------------------------------------------

/// Ángulos absolutos por hueso, en radianes. `0` apunta a la derecha y el
/// eje Y crece hacia abajo (coordenadas de pantalla).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Pose {
    #[serde(default)]
    pub spine: f64,
    #[serde(default)]
    pub head: f64,
    #[serde(default)]
    pub upper_arm_l: f64,
    #[serde(default)]
    pub fore_arm_l: f64,
    #[serde(default)]
    pub upper_arm_r: f64,
    #[serde(default)]
    pub fore_arm_r: f64,
    #[serde(default)]
    pub thigh_l: f64,
    #[serde(default)]
    pub shin_l: f64,
    #[serde(default)]
    pub thigh_r: f64,
    #[serde(default)]
    pub shin_r: f64,
    /// Desplazamiento vertical del pelvis (saltar, agacharse). En píxeles.
    #[serde(default)]
    pub pelvis_dy: f64,
}

impl Pose {
    /// Interpolación lineal por hueso entre dos poses.
    fn lerp(&self, other: &Pose, t: f64) -> Pose {
        let mix = |a: f64, b: f64| a + (b - a) * t;
        Pose {
            spine: mix(self.spine, other.spine),
            head: mix(self.head, other.head),
            upper_arm_l: mix(self.upper_arm_l, other.upper_arm_l),
            fore_arm_l: mix(self.fore_arm_l, other.fore_arm_l),
            upper_arm_r: mix(self.upper_arm_r, other.upper_arm_r),
            fore_arm_r: mix(self.fore_arm_r, other.fore_arm_r),
            thigh_l: mix(self.thigh_l, other.thigh_l),
            shin_l: mix(self.shin_l, other.shin_l),
            thigh_r: mix(self.thigh_r, other.thigh_r),
            shin_r: mix(self.shin_r, other.shin_r),
            pelvis_dy: mix(self.pelvis_dy, other.pelvis_dy),
        }
    }
}

include!("stickman/pose_animation.rs");
include!("stickman/rig.rs");
include!("stickman/draw.rs");
include!("stickman/render.rs");
include!("stickman/particles.rs");
include!("stickman/command.rs");

#[cfg(test)]
#[path = "stickman.tests.rs"]
mod tests;
