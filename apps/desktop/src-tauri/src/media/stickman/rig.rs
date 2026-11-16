#[derive(Debug, Clone, Copy)]
struct V2 {
    x: f64,
    y: f64,
}

impl V2 {
    fn add(self, other: V2) -> V2 {
        V2 {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
    fn from_angle(len: f64, angle: f64) -> V2 {
        V2 {
            x: len * angle.cos(),
            y: len * angle.sin(),
        }
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
        let elbow = shoulder.add(V2::from_angle(
            rig.upper_arm,
            if side == "l" {
                pose.upper_arm_l
            } else {
                pose.upper_arm_r
            },
        ));
        let hand = elbow.add(V2::from_angle(
            rig.fore_arm,
            if side == "l" {
                pose.fore_arm_l
            } else {
                pose.fore_arm_r
            },
        ));
        let hip = V2 {
            x: pelvis.x + sign * rig.hip_half,
            y: pelvis.y,
        };
        let knee = hip.add(V2::from_angle(
            rig.thigh,
            if side == "l" {
                pose.thigh_l
            } else {
                pose.thigh_r
            },
        ));
        let foot = knee.add(V2::from_angle(
            rig.shin,
            if side == "l" {
                pose.shin_l
            } else {
                pose.shin_r
            },
        ));
        joints.insert(
            match side {
                "l" => "shoulder_l",
                _ => "shoulder_r",
            },
            shoulder,
        );
        joints.insert(
            match side {
                "l" => "elbow_l",
                _ => "elbow_r",
            },
            elbow,
        );
        joints.insert(
            match side {
                "l" => "hand_l",
                _ => "hand_r",
            },
            hand,
        );
        joints.insert(
            match side {
                "l" => "hip_l",
                _ => "hip_r",
            },
            hip,
        );
        joints.insert(
            match side {
                "l" => "knee_l",
                _ => "knee_r",
            },
            knee,
        );
        joints.insert(
            match side {
                "l" => "foot_l",
                _ => "foot_r",
            },
            foot,
        );
    }
    Skeleton { joints, rig }
}

// --------------------------------------------------------------------------- Rasterizado
// ---------------------------------------------------------------------------
