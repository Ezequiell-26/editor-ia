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
use tauri::State;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

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

/// Pose de "de pie": piernas casi verticales, brazos colgando.
fn stand_pose() -> Pose {
    Pose {
        spine: std::f64::consts::FRAC_PI_2,
        head: std::f64::consts::FRAC_PI_2,
        upper_arm_l: std::f64::consts::FRAC_PI_2,
        fore_arm_l: std::f64::consts::FRAC_PI_2,
        upper_arm_r: std::f64::consts::FRAC_PI_2,
        fore_arm_r: std::f64::consts::FRAC_PI_2,
        thigh_l: std::f64::consts::FRAC_PI_2,
        shin_l: std::f64::consts::FRAC_PI_2,
        thigh_r: std::f64::consts::FRAC_PI_2,
        shin_r: std::f64::consts::FRAC_PI_2,
        pelvis_dy: 0.0,
    }
}

/// Un fotograma clave de pose para la animación `custom`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoseKeyframe {
    pub frame: u64,
    #[serde(flatten)]
    pub pose: Pose,
}

// ---------------------------------------------------------------------------
// Acciones procedurales
// ---------------------------------------------------------------------------

const DOWN: f64 = std::f64::consts::FRAC_PI_2;

fn pose_at(action: &str, frame: u64, fps: f64, keyframes: &[PoseKeyframe]) -> Pose {
    if !keyframes.is_empty() {
        return pose_from_keyframes(keyframes, frame);
    }
    let t = frame as f64 / fps.max(1.0);
    match action {
        "walk" => walk_pose(t),
        "run" => run_pose(t),
        "wave" => wave_pose(t),
        "jump" => jump_pose(t),
        _ => idle_pose(t),
    }
}

fn pose_from_keyframes(keyframes: &[PoseKeyframe], frame: u64) -> Pose {
    let mut sorted = keyframes.to_vec();
    sorted.sort_by_key(|k| k.frame);
    if frame <= sorted[0].frame {
        return sorted[0].pose.clone();
    }
    let last = sorted.last().unwrap();
    if frame >= last.frame {
        return last.pose.clone();
    }
    for pair in sorted.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if frame >= a.frame && frame <= b.frame {
            let span = (b.frame - a.frame).max(1) as f64;
            let t = (frame - a.frame) as f64 / span;
            return a.pose.lerp(&b.pose, t);
        }
    }
    sorted.last().unwrap().pose.clone()
}

/// Idle: respiración sutil y balanceo de brazos.
fn idle_pose(t: f64) -> Pose {
    let mut pose = stand_pose();
    let breath = (t * 1.6).sin() * 0.035;
    pose.spine += breath;
    pose.head += breath * 0.5;
    pose.upper_arm_l += (t * 1.6).sin() * 0.05;
    pose.upper_arm_r -= (t * 1.6).sin() * 0.05;
    pose
}

/// Caminar: zancadas alternas con balanceo de brazos opuesto.
fn walk_pose(t: f64) -> Pose {
    let mut pose = stand_pose();
    let w = t * 4.4; // ~0.7 zancadas por segundo
    let swing = 0.62;
    pose.thigh_l = DOWN + swing * w.sin();
    pose.thigh_r = DOWN - swing * w.sin();
    // La rodilla se flexiona más cuando la pierna va hacia atrás.
    let knee = |ph: f64| 0.25 + 0.75 * (0.5 - 0.5 * (ph + 1.2).sin()).max(0.0);
    pose.shin_l = pose.thigh_l + knee(w);
    pose.shin_r = pose.thigh_r + knee(w + std::f64::consts::PI);
    pose.upper_arm_l = DOWN - 0.55 * w.sin();
    pose.upper_arm_r = DOWN + 0.55 * w.sin();
    pose.fore_arm_l = DOWN + 0.15;
    pose.fore_arm_r = DOWN + 0.15;
    pose.pelvis_dy = -6.0 * (2.0 * w).sin().abs();
    pose.spine += 0.04;
    pose
}

/// Correr: mayor amplitud, inclinación al frente y rodillas muy flexionadas.
fn run_pose(t: f64) -> Pose {
    let mut pose = walk_pose(t * 1.7);
    let w = t * 7.5;
    pose.thigh_l = DOWN + 0.95 * w.sin();
    pose.thigh_r = DOWN - 0.95 * w.sin();
    pose.shin_l = pose.thigh_l + 0.4 + 0.9 * (0.5 - 0.5 * (w + 1.0).sin()).max(0.0);
    pose.shin_r = pose.thigh_r + 0.4 + 0.9 * (0.5 - 0.5 * (w + std::f64::consts::PI + 1.0).sin()).max(0.0);
    pose.upper_arm_l = DOWN - 0.9 * w.sin();
    pose.upper_arm_r = DOWN + 0.9 * w.sin();
    pose.fore_arm_l = DOWN + 0.9;
    pose.fore_arm_r = DOWN + 0.9;
    pose.spine += 0.28; // torso inclinado al correr
    pose.pelvis_dy = -10.0 * (2.0 * w).sin().abs();
    pose
}

/// Saludo: brazo derecho arriba con la mano oscilando.
fn wave_pose(t: f64) -> Pose {
    let mut pose = idle_pose(t);
    let w = t * 7.0;
    pose.upper_arm_r = -0.35 + 0.18 * w.sin(); // brazo arriba
    pose.fore_arm_r = -1.15 + 0.5 * w.sin(); // antebrazo ondeando
    pose.head += 0.06 * w.sin();
    pose
}

/// Salto: cuclillas, estiramiento aéreo y caída.
fn jump_pose(t: f64) -> Pose {
    let cycle = t % 1.2;
    let mut pose = stand_pose();
    if cycle < 0.35 {
        // despegue
        let k = cycle / 0.35;
        pose.thigh_l = DOWN - 0.9 * k;
        pose.thigh_r = DOWN - 0.7 * k;
        pose.shin_l = pose.thigh_l + 1.5 * k;
        pose.shin_r = pose.thigh_r + 1.4 * k;
        pose.pelvis_dy = 26.0 * k;
    } else if cycle < 0.8 {
        // aire: piernas recogidas
        pose.thigh_l = DOWN - 1.1;
        pose.thigh_r = DOWN - 0.9;
        pose.shin_l = pose.thigh_l + 1.9;
        pose.shin_r = pose.thigh_r + 1.7;
        pose.upper_arm_l = DOWN - 2.4;
        pose.upper_arm_r = DOWN - 2.4;
        pose.pelvis_dy = 40.0;
    } else {
        // aterrizaje suave
        let k = (cycle - 0.8) / 0.4;
        pose = idle_pose(t);
        pose.thigh_l = DOWN - 0.5 * (1.0 - k);
        pose.thigh_r = DOWN - 0.4 * (1.0 - k);
        pose.pelvis_dy = 14.0 * (1.0 - k);
    }
    pose
}

// ---------------------------------------------------------------------------
// Geometría FK
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct V2 {
    x: f64,
    y: f64,
}

impl V2 {
    fn add(self, other: V2) -> V2 {
        V2 { x: self.x + other.x, y: self.y + other.y }
    }
    fn from_angle(len: f64, angle: f64) -> V2 {
        V2 { x: len * angle.cos(), y: len * angle.sin() }
    }
}

/// Dimensiones del rig en píxeles relativos a la altura total.
struct Rig {
    spine_len: f64,
    neck_len: f64,
    head_r: f64,
    upper_arm: f64,
    fore_arm: f64,
    thigh: f64,
    shin: f64,
    hip_half: f64,
    shoulder_half: f64,
}

impl Rig {
    fn for_height(height: f64) -> Self {
        let u = height / 360.0; // unidad de escala
        Rig {
            spine_len: 62.0 * u,
            neck_len: 14.0 * u,
            head_r: 16.0 * u,
            upper_arm: 40.0 * u,
            fore_arm: 38.0 * u,
            thigh: 66.0 * u,
            shin: 62.0 * u,
            hip_half: 9.0 * u,
            shoulder_half: 20.0 * u,
        }
    }
}

/// Puntos del esqueleto resueltos por FK para un frame concreto.
struct Skeleton {
    joints: BTreeMap<&'static str, V2>,
    rig: Rig,
}

fn solve_skeleton(pose: &Pose, width: f64, height: f64) -> Skeleton {
    let rig = Rig::for_height(height);
    let ground_y = height * 0.88;
    // El pie toca el suelo cuando las piernas están extendidas: la altura del
    // pelvis es la suma de muslo+espinilla menos la flexión implícita en ángulo.
    let leg_reach = rig.thigh + rig.shin;
    let pelvis = V2 {
        x: width * 0.5,
        y: ground_y - leg_reach * 0.92 + pose.pelvis_dy,
    };
    let mut joints = BTreeMap::new();
    joints.insert("pelvis", pelvis);

    let chest = pelvis.add(V2::from_angle(rig.spine_len, pose.spine));
    joints.insert("chest", chest);
    let head = chest.add(V2::from_angle(rig.neck_len + rig.head_r, pose.head));
    joints.insert("head", head);

    for (side, sign) in [("l", -1.0_f64), ("r", 1.0_f64)] {
        let shoulder = V2 {
            x: chest.x + sign * rig.shoulder_half,
            y: chest.y,
        };
        let elbow = shoulder.add(V2::from_angle(rig.upper_arm, if side == "l" { pose.upper_arm_l } else { pose.upper_arm_r }));
        let hand = elbow.add(V2::from_angle(
            rig.fore_arm,
            if side == "l" { pose.fore_arm_l } else { pose.fore_arm_r },
        ));
        let hip = V2 { x: pelvis.x + sign * rig.hip_half, y: pelvis.y };
        let knee = hip.add(V2::from_angle(rig.thigh, if side == "l" { pose.thigh_l } else { pose.thigh_r }));
        let foot = knee.add(V2::from_angle(rig.shin, if side == "l" { pose.shin_l } else { pose.shin_r }));
        joints.insert(match side { "l" => "shoulder_l", _ => "shoulder_r" }, shoulder);
        joints.insert(match side { "l" => "elbow_l", _ => "elbow_r" }, elbow);
        joints.insert(match side { "l" => "hand_l", _ => "hand_r" }, hand);
        joints.insert(match side { "l" => "hip_l", _ => "hip_r" }, hip);
        joints.insert(match side { "l" => "knee_l", _ => "knee_r" }, knee);
        joints.insert(match side { "l" => "foot_l", _ => "foot_r" }, foot);
    }
    Skeleton { joints, rig }
}

// --------------------------------------------------------------------------- Rasterizado
// ---------------------------------------------------------------------------

fn blend_px(buf: &mut [u8], w: usize, h: usize, x: i64, y: i64, color: [u8; 3]) {
    if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
        return;
    }
    let idx = ((y as usize) * w + (x as usize)) * 3;
    buf[idx] = color[0];
    buf[idx + 1] = color[1];
    buf[idx + 2] = color[2];
}

/// Línea gruesa por interpolación lineal con sello circular.
fn draw_bone(buf: &mut [u8], w: usize, h: usize, a: V2, b: V2, thick: f64, color: [u8; 3]) {
    let dist = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
    let steps = (dist.ceil() as usize).max(1);
    let r = (thick / 2.0).max(1.0) as i64;
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let x = a.x + (b.x - a.x) * t;
        let y = a.y + (b.y - a.y) * t;
        for dy in -r..=r {
            for dx in -r..=r {
                if dx * dx + dy * dy <= r * r + r {
                    blend_px(buf, w, h, x.round() as i64 + dx, y.round() as i64 + dy, color);
                }
            }
        }
    }
}

fn draw_head(buf: &mut [u8], w: usize, h: usize, head: V2, rig: &Rig, color: [u8; 3]) {
    let r = rig.head_r as i64;
    for dy in -r..=r {
        for dx in -r..=r {
            if dx * dx + dy * dy <= r * r {
                blend_px(buf, w, h, head.x.round() as i64 + dx, head.y.round() as i64 + dy, color);
            }
        }
    }
    // Ojos: dos puntos oscuros para que se lea como personaje.
    let eye = [20, 20, 24];
    let er = (rig.head_r * 0.16).max(1.0) as i64;
    for sx in [-1.0_f64, 1.0] {
        let ex = head.x + sx * rig.head_r * 0.38;
        let ey = head.y - rig.head_r * 0.15;
        for dy in -er..=er {
            for dx in -er..=er {
                if dx * dx + dy * dy <= er * er {
                    blend_px(buf, w, h, ex.round() as i64 + dx, ey.round() as i64 + dy, eye);
                }
            }
        }
    }
}

fn render_frame(
    pose: &Pose,
    width: usize,
    height: usize,
    bone_color: [u8; 3],
    bg_color: [u8; 3],
    particles: Option<&ParticleSpec>,
    frame: u64,
    fps: u32,
) -> Vec<u8> {
    let mut buf = vec![0u8; width * height * 3];
    for px in buf.chunks_exact_mut(3) {
        px.copy_from_slice(&bg_color);
    }
    let sk = solve_skeleton(pose, width as f64, height as f64);
    let j = &sk.joints;
    let thick = (height as f64 / 360.0 * 7.0).max(3.0);
    let get = |name: &str| *j.get(name).unwrap_or(&V2 { x: 0.0, y: 0.0 });
    // Core: pelvis → chest → cabeza
    draw_bone(&mut buf, width, height, get("pelvis"), get("chest"), thick, bone_color);
    draw_bone(&mut buf, width, height, get("chest"), get("head"), thick * 0.8, bone_color);
    draw_head(&mut buf, width, height, get("head"), &sk.rig, bone_color);
    // Brazos y piernas
    for (up, mid, end) in [
        ("shoulder_l", "elbow_l", "hand_l"),
        ("shoulder_r", "elbow_r", "hand_r"),
    ] {
        draw_bone(&mut buf, width, height, get("chest"), get(up), thick * 0.75, bone_color);
        // El hombro cuelga del pecho; lo dibujamos desde chest→shoulder→elbow→hand
        draw_bone(&mut buf, width, height, get(up), get(mid), thick * 0.7, bone_color);
        draw_bone(&mut buf, width, height, get(mid), get(end), thick * 0.65, bone_color);
    }
    for (hip, knee, foot) in [("hip_l", "knee_l", "foot_l"), ("hip_r", "knee_r", "foot_r")] {
        draw_bone(&mut buf, width, height, get("pelvis"), get(hip), thick * 0.8, bone_color);
        draw_bone(&mut buf, width, height, get(hip), get(knee), thick * 0.75, bone_color);
        draw_bone(&mut buf, width, height, get(knee), get(foot), thick * 0.7, bone_color);
    }
    if let Some(spec) = particles {
        draw_particles(&mut buf, width, height, spec, frame, fps, bone_color);
    }
    buf
}

/// Partículas deterministas por frame (misma partícula = misma trayectoria en
/// cada render: la animación es reproducible frame a frame).
fn draw_particles(
    buf: &mut [u8],
    w: usize,
    h: usize,
    spec: &ParticleSpec,
    frame: u64,
    fps: u32,
    fallback_color: [u8; 3],
) {
    let t = frame as f64 / fps.max(1) as f64;
    let color = spec
        .color_hex
        .as_deref()
        .map(|c| parse_hex(c, fallback_color))
        .unwrap_or(fallback_color);
    let count = spec.count.clamp(1, 2000) as u64;
    for i in 0..count {
        // Semilla determinista por partícula.
        let seed = (i as u64).wrapping_mul(2654435761) % 1000;
        let fx = (seed % 100) as f64 / 100.0;
        let phase = ((seed / 100) % 100) as f64 / 100.0;
        let (x, y, size) = match spec.kind.as_str() {
            "bounce" => {
                let (x, y, s) = bounce_pos(i, t, w as f64, h as f64, spec);
                (x, y, s)
            }
            "snow" => {
                let x = fx * w as f64 + (t * 12.0 * (phase + 0.3)).sin() * 14.0;
                let y = ((phase + t * 0.12) % 1.0) * h as f64;
                (x, y, 2.0)
            }
            "sparks" => {
                let life = (t * 1.4 + phase) % 1.0;
                let x = w as f64 * (0.5 + (phase - 0.5) * 0.6) + (phase - 0.5) * 220.0 * life;
                let y = h as f64 * 0.8 - life * h as f64 * 0.6;
                (x, y, (2.4 - life).max(0.6))
            }
            _ => {
                // confetti: cae con vaivén
                let speed = 60.0 + phase * 90.0;
                let x = fx * w as f64 + (t * 40.0 * (phase + 0.2)).sin() * 22.0;
                let y = ((phase + t * speed / h.max(1) as f64) % 1.0) * h as f64;
                (x, y, 2.2 + (phase * 3.0) % 2.0)
            }
        };
        let r = size.max(1.0) as i64;
        for dy in -r..=r {
            for dx in -r..=r {
                if dx * dx + dy * dy <= r * r {
                    blend_px(buf, w, h, x.round() as i64 + dx, y.round() as i64 + dy, color);
                }
            }
        }
    }
}

/// Paso fijo de la simulación de partículas con física: independiente del
/// fps de salida, así la trayectoria es idéntica a 24, 30 o 60 fps.
const PHYS_DT: f64 = 1.0 / 60.0;
/// Tope de pasos por partícula por frame (~2 min simulados).
const PHYS_MAX_STEPS: u64 = 7200;

/// Simula una partícula `bounce` desde t=0 hasta `t` segundos: gravedad,
/// restitución en el suelo y rebote en paredes. Determinista por semilla.
/// Sale temprano cuando la partícula se asienta (gravedad < 1 px/s² y
/// velocidad casi nula), así clips largos no pagan el costo de simular
/// partículas quietas en el piso.
fn bounce_pos(i: u64, t: f64, w: f64, h: f64, spec: &ParticleSpec) -> (f64, f64, f64) {
    let seed = (i as u64).wrapping_mul(2654435761) % 1000;
    let fx = (seed % 100) as f64 / 100.0;
    let phase = ((seed / 100) % 100) as f64 / 100.0;
    let gravity = spec.gravity.unwrap_or(900.0).clamp(0.0, 5000.0);
    let restitution = spec.bounce.unwrap_or(0.72).clamp(0.0, 1.0);
    let radius = 2.0 + phase * 3.5;
    let floor = (h - radius - 1.0).max(radius);
    let mut x = fx * w;
    let mut y = phase * h * 0.35;
    let mut vx = (phase - 0.5) * 160.0;
    let mut vy = 80.0 + phase * 320.0;
    let mut tt = 0.0;
    let mut steps = 0u64;
    while tt + PHYS_DT <= t && steps < PHYS_MAX_STEPS {
        vy += gravity * PHYS_DT;
        x += vx * PHYS_DT;
        y += vy * PHYS_DT;
        if x < radius {
            x = radius;
            vx = -vx * 0.9;
        } else if x > w - radius {
            x = w - radius;
            vx = -vx * 0.9;
        }
        if y >= floor && vy > 0.0 {
            y = floor;
            vy = -vy * restitution;
            vx *= 0.985;
        }
        tt += PHYS_DT;
        steps += 1;
        if y >= floor - 0.01 && vy.abs() < 1.0 && vx.abs() < 1.0 {
            break;
        }
    }
    (x, y.min(floor), radius)
}

// ---------------------------------------------------------------- Comando IPC

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickmanRenderRequest {
    pub output_path: String,
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default = "default_duration")]
    pub duration_seconds: f64,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default)]
    pub keyframes: Vec<PoseKeyframe>,
    #[serde(default)]
    pub bone_hex: Option<String>,
    #[serde(default)]
    pub bg_hex: Option<String>,
    /// Sistema de partículas opcional sobre la animación.
    #[serde(default)]
    pub particles: Option<ParticleSpec>,
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

fn default_action() -> String {
    "idle".into()
}
fn default_duration() -> f64 {
    4.0
}
fn default_fps() -> u32 {
    24
}
fn default_width() -> u32 {
    640
}
fn default_height() -> u32 {
    360
}

const ACTIONS: &[&str] = &["idle", "walk", "run", "wave", "jump"];

fn parse_hex(hex: &str, fallback: [u8; 3]) -> [u8; 3] {
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

fn resolve_ffmpeg(settings: &crate::state::Settings) -> Result<PathBuf, ProjectError> {
    resolve_tools(settings)
        .0
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                "no se encontró FFmpeg configurado",
            )
        })
}

/// Medición real del MP4 con ffprobe (mismo helper que screen_record).
fn probe_output(ffprobe: &Path, output: &Path) -> (Option<f64>, Option<u32>, Option<u32>, Option<bool>) {
    let probed = std::process::Command::new(ffprobe)
        .args([
            "-v", "error",
            "-show_entries", "format=duration:stream=codec_type,width,height",
            "-of", "json",
            &output.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(out) = probed else { return (None, None, None, None) };
    if !out.status.success() {
        return (None, None, None, None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return (None, None, None, None),
    };
    let duration = json["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok());
    let streams = json["streams"].as_array();
    let mut width = None;
    let mut height = None;
    let mut has_audio = false;
    for stream in streams.into_iter().flatten() {
        match stream["codec_type"].as_str() {
            Some("video") => {
                width = stream["width"].as_u64().map(|v| v as u32);
                height = stream["height"].as_u64().map(|v| v as u32);
            }
            Some("audio") => has_audio = true,
            _ => {}
        }
    }
    (duration, width, height, Some(has_audio))
}

/// Genera un video MP4 de un personaje stickman articulado.
///
/// Escribe los cuadros PNG en `<temp>/stickman-frames`, codifica con el
/// FFmpeg del proyecto (`h264_mf`/software según disponibilidad) y verifica
/// el resultado con ffprobe antes de responder.
#[tauri::command]
pub async fn stickman_render(
    state: State<'_, AppState>,
    request: StickmanRenderRequest,
) -> Result<serde_json::Value, ProjectError> {
    let action = request.action.trim().to_ascii_lowercase();
    if !ACTIONS.contains(&action.as_str()) && request.keyframes.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("acción desconocida «{}»; opciones: {} o keyframes", request.action, ACTIONS.join(", ")),
        ));
    }
    let fps = request.fps.clamp(1, 60);
    let width = request.width.clamp(64, 1920);
    let height = request.height.clamp(64, 1080);
    let duration = request.duration_seconds.clamp(0.5, 120.0);
    let total_frames = (duration * fps as f64).round() as u64;
    if total_frames == 0 {
        return Err(ProjectError::message(ProjectErrorCode::InvalidProject, "duración demasiado corta"));
    }
    if let Some(spec) = &request.particles {
        if !matches!(spec.kind.as_str(), "confetti" | "snow" | "sparks" | "bounce") {
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
    if !request.keyframes.is_empty() {
        let max_frame = request.keyframes.iter().map(|k| k.frame).max().unwrap_or(0);
        if max_frame == 0 && request.keyframes.len() == 1 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "los keyframes necesitan al menos un frame > 0 para interpolar",
            ));
        }
    }

    let output = PathBuf::from(request.output_path.trim());
    if output.extension().and_then(|e| e.to_str()) != Some("mp4") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la salida debe ser un archivo .mp4",
        ));
    }
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo crear la carpeta de salida: {e}"))
        })?;
    }

    let bone = parse_hex(request.bone_hex.as_deref().unwrap_or("#e8eaf0"), [232, 234, 240]);
    let bg = parse_hex(request.bg_hex.as_deref().unwrap_or("#10131a"), [16, 19, 26]);

    let frames_dir = std::env::temp_dir().join(format!("stickman-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&frames_dir).map_err(|e| {
        ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo crear el temporal: {e}"))
    })?;

    // 1) Rasterizar cada cuadro a PNG.
    for frame in 0..total_frames {
        let pose = pose_at(&action, frame, fps as f64, &request.keyframes);
        let rgb = render_frame(
            &pose,
            width as usize,
            height as usize,
            bone,
            bg,
            request.particles.as_ref(),
            frame,
            fps,
        );
        let path = frames_dir.join(format!("frame_{frame:05}.png"));
        image::save_buffer(&path, &rgb, width, height, image::ColorType::Rgb8)
            .map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo escribir el cuadro {frame}: {e}"),
                )
            })?;
    }

    // 2) Codificar con FFmpeg del proyecto.
    let settings = state.settings_snapshot()?;
    let ffmpeg = resolve_ffmpeg(&settings)?;
    let pattern = frames_dir.join("frame_%05d.png");
    let tmp_out = output.with_extension("tmp.mp4");
    // libopenh264 es el default LGPL-safe del bundle; si el runtime no puede
    // cargarlo se reintenta con MediaFoundation (patrón usado por render).
    let mut encoded = false;
    let mut last_err = String::new();
    for encoder in ["libopenh264", "h264_mf"] {
        let out = std::process::Command::new(&ffmpeg)
            .args([
                "-hide_banner", "-loglevel", "error", "-y",
                "-framerate", &fps.to_string(),
                "-i", &pattern.to_string_lossy(),
                "-c:v", encoder,
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                &tmp_out.to_string_lossy(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| {
                ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo ejecutar FFmpeg: {e}"))
            })?;
        if out.status.success() {
            encoded = true;
            break;
        }
        last_err = String::from_utf8_lossy(&out.stderr).chars().take(400).collect();
        let _ = std::fs::remove_file(&tmp_out);
    }
    if !encoded {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("FFmpeg no pudo codificar la animación stickman: {last_err}"),
        ));
    }
    std::fs::rename(&tmp_out, &output).map_err(|e| {
        ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo publicar el video: {e}"))
    })?;

    // 3) Verificar con ffprobe real (mismo patrón que screen_record).
    let (ffprobe, _, _) = (resolve_tools(&settings).1, (), ());
    let ffprobe = ffprobe.ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, "no se encontró FFprobe")
    })?;
    let (duration_s, w_s, h_s, has_audio) = probe_output(&ffprobe, &output);
    let _ = std::fs::remove_dir_all(&frames_dir);

    Ok(serde_json::json!({
        "ok": true,
        "path": output.to_string_lossy(),
        "action": if request.keyframes.is_empty() { action } else { "custom".to_string() },
        "frames": total_frames,
        "fps": fps,
        "width": width,
        "height": height,
        "durationSeconds": duration_s.unwrap_or(duration),
        "probeWidth": w_s,
        "probeHeight": h_s,
        "hasAudio": has_audio.unwrap_or(false),
        "verified": duration_s.is_some(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stand_pose_has_vertical_limbs() {
        let p = stand_pose();
        let sk = solve_skeleton(&p, 640.0, 360.0);
        let j = &sk.joints;
        let thigh_l = j["knee_l"].y - j["hip_l"].y;
        assert!(thigh_l > 40.0, "el muslo debe apuntar hacia abajo: {thigh_l}");
        // El pie queda por debajo de la rodilla.
        assert!(j["foot_l"].y > j["knee_l"].y);
    }

    #[test]
    fn walk_cycle_differs_between_frames() {
        let a = walk_pose(0.0);
        let b = walk_pose(0.4);
        assert!((a.thigh_l - b.thigh_l).abs() > 0.1, "la caminata debe mover los muslos");
    }

    #[test]
    fn keyframes_interpolate_between_poses() {
        let kfs = vec![
            PoseKeyframe { frame: 0, pose: stand_pose() },
            PoseKeyframe { frame: 24, pose: Pose { upper_arm_r: -1.5, ..stand_pose() } },
        ];
        let mid = pose_from_keyframes(&kfs, 12);
        let end = pose_from_keyframes(&kfs, 24);
        // stand_pose().upper_arm_r = π/2; el keyframe final fija -1.5.
        let expected_mid = (DOWN + (-1.5)) / 2.0;
        assert!((mid.upper_arm_r - expected_mid).abs() < 0.01, "interpolación lineal a mitad");
        assert!((end.upper_arm_r - (-1.5)).abs() < 0.01, "pose final exacta");
        // Fuera de rango se mantiene el extremo.
        let over = pose_from_keyframes(&kfs, 100);
        assert!((over.upper_arm_r - (-1.5)).abs() < 0.01);
    }

    #[test]
    fn render_frame_produces_non_empty_image() {
        let rgb = render_frame(&walk_pose(0.3), 320, 180, [255, 255, 255], [16, 19, 26], None, 7, 24);
        assert_eq!(rgb.len(), 320 * 180 * 3);
        // El fondo domina; debe haber píxeles claros del cuerpo.
        let light = rgb.chunks_exact(3).filter(|p| p[0] > 200).count();
        assert!(light > 500, "el stickman debe dibujar muchos píxeles claros, hay {light}");
    }

    #[test]
    fn hex_parser_accepts_with_and_without_hash() {
        assert_eq!(parse_hex("#ff8000", [0, 0, 0]), [255, 128, 0]);
        assert_eq!(parse_hex("00ff00", [0, 0, 0]), [0, 255, 0]);
        assert_eq!(parse_hex("bad", [1, 2, 3]), [1, 2, 3]);
    }
}

#[cfg(test)]
mod particle_tests {
    use super::*;

    fn spec(kind: &str) -> ParticleSpec {
        ParticleSpec {
            kind: kind.into(),
            count: 200,
            color_hex: Some("#ffcc00".into()),
            gravity: None,
            bounce: None,
        }
    }

    #[test]
    fn bounce_particles_are_deterministic_and_settle() {
        let spec = spec("bounce");
        // Mismo instante → misma posición, sin importar el frame de partida.
        let (x1, y1, _) = bounce_pos(7, 1.5, 640.0, 360.0, &spec);
        let (x2, y2, _) = bounce_pos(7, 1.5, 640.0, 360.0, &spec);
        assert_eq!((x1, y1), (x2, y2));
        // A t=0.1 la partícula está en caída; a t=30 ya se asentó en el piso.
        let (_, early, _) = bounce_pos(7, 0.1, 640.0, 360.0, &spec);
        let (_, late, radius) = bounce_pos(7, 30.0, 640.0, 360.0, &spec);
        assert!(early < 300.0, "a 0.1s debería seguir cayendo, y={early}");
        let floor = 360.0 - radius - 1.0;
        assert!((late - floor).abs() < 0.01, "a los 30s debe estar en el piso, y={late} floor={floor}");
        // fps no influye: la simulación usa dt fijo.
        let (_, y24, _) = bounce_pos(3, 2.0, 640.0, 360.0, &spec);
        let (_, y60, _) = bounce_pos(3, 2.0, 640.0, 360.0, &spec);
        assert_eq!(y24, y60);
    }

    #[test]
    fn bounce_kind_renders_pixels() {
        let rgb = render_frame(&stand_pose(), 200, 120, [255, 255, 255], [0, 0, 0], Some(&spec("bounce")), 5, 24);
        let gold = rgb.chunks_exact(3).filter(|p| p[0] > 200 && p[1] > 150).count();
        assert!(gold > 30, "bounce debe dibujar partículas, hay {gold}");
    }

    #[test]
    fn particles_are_deterministic_across_frames() {
        let a = render_frame(&stand_pose(), 200, 120, [255, 255, 255], [0, 0, 0], Some(&spec("confetti")), 10, 24);
        let b = render_frame(&stand_pose(), 200, 120, [255, 255, 255], [0, 0, 0], Some(&spec("confetti")), 10, 24);
        assert_eq!(a, b, "mismo frame debe producir los mismos píxeles");
        let c = render_frame(&stand_pose(), 200, 120, [255, 255, 255], [0, 0, 0], Some(&spec("confetti")), 11, 24);
        assert_ne!(a, c, "frames distintos deben diferir");
    }

    #[test]
    fn each_particle_kind_renders_pixels() {
        for kind in ["confetti", "snow", "sparks", "bounce"] {
            let rgb = render_frame(&stand_pose(), 200, 120, [255, 255, 255], [0, 0, 0], Some(&spec(kind)), 5, 24);
            let gold = rgb.chunks_exact(3).filter(|p| p[0] > 200 && p[1] > 150).count();
            assert!(gold > 50, "{kind} debe dibujar partículas doradas, hay {gold}");
        }
    }
}
