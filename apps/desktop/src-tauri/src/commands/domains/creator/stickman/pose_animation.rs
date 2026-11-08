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
    pose.shin_r =
        pose.thigh_r + 0.4 + 0.9 * (0.5 - 0.5 * (w + std::f64::consts::PI + 1.0).sin()).max(0.0);
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
