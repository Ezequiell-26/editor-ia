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
    for px in buf.as_chunks_mut::<3>().0.iter_mut() {
        px.copy_from_slice(&bg_color);
    }
    let sk = solve_skeleton(pose, width as f64, height as f64);
    let j = &sk.joints;
    let thick = (height as f64 / 360.0 * 7.0).max(3.0);
    let get = |name: &str| *j.get(name).unwrap_or(&V2 { x: 0.0, y: 0.0 });
    // Core: pelvis → chest → cabeza
    draw_bone(
        &mut buf,
        width,
        height,
        get("pelvis"),
        get("chest"),
        thick,
        bone_color,
    );
    draw_bone(
        &mut buf,
        width,
        height,
        get("chest"),
        get("head"),
        thick * 0.8,
        bone_color,
    );
    draw_head(&mut buf, width, height, get("head"), &sk.rig, bone_color);
    // Brazos y piernas
    for (up, mid, end) in [
        ("shoulder_l", "elbow_l", "hand_l"),
        ("shoulder_r", "elbow_r", "hand_r"),
    ] {
        draw_bone(
            &mut buf,
            width,
            height,
            get("chest"),
            get(up),
            thick * 0.75,
            bone_color,
        );
        // El hombro cuelga del pecho; lo dibujamos desde chest→shoulder→elbow→hand
        draw_bone(
            &mut buf,
            width,
            height,
            get(up),
            get(mid),
            thick * 0.7,
            bone_color,
        );
        draw_bone(
            &mut buf,
            width,
            height,
            get(mid),
            get(end),
            thick * 0.65,
            bone_color,
        );
    }
    for (hip, knee, foot) in [("hip_l", "knee_l", "foot_l"), ("hip_r", "knee_r", "foot_r")] {
        draw_bone(
            &mut buf,
            width,
            height,
            get("pelvis"),
            get(hip),
            thick * 0.8,
            bone_color,
        );
        draw_bone(
            &mut buf,
            width,
            height,
            get(hip),
            get(knee),
            thick * 0.75,
            bone_color,
        );
        draw_bone(
            &mut buf,
            width,
            height,
            get(knee),
            get(foot),
            thick * 0.7,
            bone_color,
        );
    }
    if let Some(spec) = particles {
        draw_particles(&mut buf, width, height, spec, frame, fps, bone_color);
    }
    buf
}
