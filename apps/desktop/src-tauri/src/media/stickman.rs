//! Motor de animación 2D: stickman articulado con huesos y keyframes.
//!
//! Es un rig paramétrico propio (sin dependencias nuevas): el esqueleto se
//! define como segmentos con longitudes y el "pose" son ángulos absolutos por
//! hueso. La cinemática directa (FK) resuelve las posiciones de las
//! articulaciones y el rasterizador dibuja líneas gruesas y articulaciones
//! sobre un framebuffer RGB. Los cuadros se escriben como PNG en un temporal
//! y FFmpeg los codifica a MP4 (el spawn queda en `commands::stickman`).
//!
//! Acciones procedurales incluidas: `idle`, `walk`, `run`, `wave` y `jump`.
//! Además el pose admite `keyframes`: lista de `{frame, pose}` con
//! interpolación lineal por hueso, así la IA o el usuario puede animar
//! cualquier articulación fotograma a fotograma.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::projects::service::{ProjectError, ProjectErrorCode};

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

/// Emisor de partículas procedural: `kind` = confetti | snow | sparks | bounce.
/// `gravity` (px/s²) y `bounce` (restitución 0..1) aplican a `bounce`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleSpec {
    #[serde(default = "default_particle_kind")]
    pub kind: String,
    #[serde(default = "default_particle_count")]
    pub count: u32,
    #[serde(default)]
    pub color_hex: Option<String>,
    #[serde(default)]
    pub gravity: Option<f64>,
    #[serde(default)]
    pub bounce: Option<f64>,
}

fn default_particle_kind() -> String {
    "confetti".into()
}
fn default_particle_count() -> u32 {
    60
}

pub const ACTIONS: &[&str] = &["idle", "walk", "run", "wave", "jump"];
pub const PARTICLE_KINDS: &[&str] = &["confetti", "snow", "sparks", "bounce"];

pub fn parse_hex(hex: &str, fallback: [u8; 3]) -> [u8; 3] {
    let clean = hex.trim().trim_start_matches('#');
    if clean.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&clean[0..2], 16),
            u8::from_str_radix(&clean[2..4], 16),
            u8::from_str_radix(&clean[4..6], 16),
        ) {
            return [r, g, b];
        }
    }
    fallback
}

/// Valida acción/keyframes, partículas y la ruta de salida `.mp4`.
/// Devuelve los valores normalizados que usa el render.
pub struct StickmanPlan {
    pub action: String,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub total_frames: u64,
    pub bone: [u8; 3],
    pub bg: [u8; 3],
}

// clippy::too_many_arguments: API pública del módulo compartida por el
// comando IPC y los tests; los parámetros describen la escena completa.
#[allow(clippy::too_many_arguments)]
pub fn plan_stickman_render(
    action: &str,
    has_keyframes: bool,
    keyframes_max_frame: u64,
    keyframes_len: usize,
    particles: Option<&ParticleSpec>,
    fps: u32,
    width: u32,
    height: u32,
    duration_seconds: f64,
    output_path: &str,
    bone_hex: Option<&str>,
    bg_hex: Option<&str>,
) -> Result<StickmanPlan, ProjectError> {
    let action = action.trim().to_ascii_lowercase();
    if !ACTIONS.contains(&action.as_str()) && !has_keyframes {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!(
                "acción desconocida «{}»; opciones: {} o keyframes",
                action,
                ACTIONS.join(", ")
            ),
        ));
    }
    let fps = fps.clamp(1, 60);
    let width = width.clamp(64, 1920);
    let height = height.clamp(64, 1080);
    let duration = duration_seconds.clamp(0.5, 120.0);
    let total_frames = (duration * fps as f64).round() as u64;
    if total_frames == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "duración demasiado corta",
        ));
    }
    if let Some(spec) = particles {
        if !PARTICLE_KINDS.contains(&spec.kind.as_str()) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "particles.kind debe ser confetti, snow, sparks o bounce",
            ));
        }
        if let Some(g) = spec.gravity {
            if !(g.is_finite() && (0.0..=5000.0).contains(&g)) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "particles.gravity debe estar entre 0 y 5000 px/s²",
                ));
            }
        }
        if let Some(b) = spec.bounce {
            if !(b.is_finite() && (0.0..=1.0).contains(&b)) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "particles.bounce debe estar entre 0 y 1",
                ));
            }
        }
    }
    if has_keyframes && keyframes_max_frame == 0 && keyframes_len == 1 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "los keyframes necesitan al menos un frame > 0 para interpolar",
        ));
    }
    if std::path::Path::new(output_path.trim())
        .extension()
        .and_then(|e| e.to_str())
        != Some("mp4")
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la salida debe ser un archivo .mp4",
        ));
    }
    Ok(StickmanPlan {
        action,
        fps,
        width,
        height,
        duration,
        total_frames,
        bone: parse_hex(bone_hex.unwrap_or("#e8eaf0"), [232, 234, 240]),
        bg: parse_hex(bg_hex.unwrap_or("#10131a"), [16, 19, 26]),
    })
}

include!("stickman/pose_animation.rs");
include!("stickman/rig.rs");
include!("stickman/draw.rs");
include!("stickman/render.rs");
include!("stickman/particles.rs");

#[cfg(test)]
#[path = "stickman.tests.rs"]
mod tests;
#[cfg(test)]
#[path = "stickman.particles.tests.rs"]
mod particle_tests;

#[cfg(test)]
mod plan_tests {
    use super::*;

    fn plan(
        action: &str,
        out: &str,
        particles: Option<&ParticleSpec>,
    ) -> Result<StickmanPlan, ProjectError> {
        plan_stickman_render(
            action, false, 0, 0, particles, 24, 640, 360, 4.0, out, None, None,
        )
    }

    #[test]
    fn valid_idle_produces_clamped_plan() {
        let p = plan("IDLE", "out.mp4", None).unwrap();
        assert_eq!(p.action, "idle");
        assert_eq!(p.fps, 24);
        assert_eq!(p.total_frames, 96);
        assert_eq!(p.bone, [232, 234, 240]);
        assert_eq!(p.bg, [16, 19, 26]);
    }

    #[test]
    fn unknown_action_without_keyframes_is_rejected() {
        assert!(plan("fly", "out.mp4", None).is_err());
    }

    #[test]
    fn keyframes_allow_unknown_action() {
        let p = plan_stickman_render(
            "custom", true, 30, 2, None, 24, 640, 360, 4.0, "out.mp4", None, None,
        )
        .unwrap();
        assert_eq!(p.action, "custom");
    }

    #[test]
    fn single_zero_frame_keyframe_is_rejected() {
        let err = plan_stickman_render(
            "idle", true, 0, 1, None, 24, 640, 360, 4.0, "out.mp4", None, None,
        )
        .err()
        .expect("debe rechazarse");
        assert!(err.message.contains("keyframes"));
    }

    #[test]
    fn non_mp4_output_is_rejected() {
        assert!(plan("idle", "out.mov", None).is_err());
        assert!(plan("idle", "out", None).is_err());
    }

    #[test]
    fn invalid_particle_kind_and_ranges_are_rejected() {
        let bad_kind = ParticleSpec {
            kind: "nuke".into(),
            count: 10,
            color_hex: None,
            gravity: None,
            bounce: None,
        };
        assert!(plan("idle", "out.mp4", Some(&bad_kind)).is_err());
        let bad_gravity = ParticleSpec {
            kind: "bounce".into(),
            count: 10,
            color_hex: None,
            gravity: Some(-1.0),
            bounce: None,
        };
        assert!(plan("idle", "out.mp4", Some(&bad_gravity)).is_err());
        let bad_bounce = ParticleSpec {
            kind: "bounce".into(),
            count: 10,
            color_hex: None,
            gravity: None,
            bounce: Some(1.5),
        };
        assert!(plan("idle", "out.mp4", Some(&bad_bounce)).is_err());
    }

    #[test]
    fn hex_colors_parse_with_fallback() {
        let p = plan_stickman_render(
            "idle", false, 0, 0, None, 24, 640, 360, 4.0, "out.mp4",
            Some("#FF8800"), Some("zzz"),
        )
        .unwrap();
        assert_eq!(p.bone, [255, 136, 0]);
        assert_eq!(p.bg, [16, 19, 26]);
    }
}
