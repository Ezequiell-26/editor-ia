use super::*;

#[test]
fn stand_pose_has_vertical_limbs() {
    let p = stand_pose();
    let sk = solve_skeleton(&p, 640.0, 360.0);
    let j = &sk.joints;
    let thigh_l = j["knee_l"].y - j["hip_l"].y;
    assert!(
        thigh_l > 40.0,
        "el muslo debe apuntar hacia abajo: {thigh_l}"
    );
    // El pie queda por debajo de la rodilla.
    assert!(j["foot_l"].y > j["knee_l"].y);
}

#[test]
fn walk_cycle_differs_between_frames() {
    let a = walk_pose(0.0);
    let b = walk_pose(0.4);
    assert!(
        (a.thigh_l - b.thigh_l).abs() > 0.1,
        "la caminata debe mover los muslos"
    );
}

#[test]
fn keyframes_interpolate_between_poses() {
    let kfs = vec![
        PoseKeyframe {
            frame: 0,
            pose: stand_pose(),
        },
        PoseKeyframe {
            frame: 24,
            pose: Pose {
                upper_arm_r: -1.5,
                ..stand_pose()
            },
        },
    ];
    let mid = pose_from_keyframes(&kfs, 12);
    let end = pose_from_keyframes(&kfs, 24);
    // stand_pose().upper_arm_r = π/2; el keyframe final fija -1.5.
    let expected_mid = (DOWN + (-1.5)) / 2.0;
    assert!(
        (mid.upper_arm_r - expected_mid).abs() < 0.01,
        "interpolación lineal a mitad"
    );
    assert!((end.upper_arm_r - (-1.5)).abs() < 0.01, "pose final exacta");
    // Fuera de rango se mantiene el extremo.
    let over = pose_from_keyframes(&kfs, 100);
    assert!((over.upper_arm_r - (-1.5)).abs() < 0.01);
}

#[test]
fn render_frame_produces_non_empty_image() {
    let rgb = render_frame(
        &walk_pose(0.3),
        320,
        180,
        [255, 255, 255],
        [16, 19, 26],
        None,
        7,
        24,
    );
    assert_eq!(rgb.len(), 320 * 180 * 3);
    // El fondo domina; debe haber píxeles claros del cuerpo.
    let light = rgb.chunks_exact(3).filter(|p| p[0] > 200).count();
    assert!(
        light > 500,
        "el stickman debe dibujar muchos píxeles claros, hay {light}"
    );
}

#[test]
fn hex_parser_accepts_with_and_without_hash() {
    assert_eq!(parse_hex("#ff8000", [0, 0, 0]), [255, 128, 0]);
    assert_eq!(parse_hex("00ff00", [0, 0, 0]), [0, 255, 0]);
    assert_eq!(parse_hex("bad", [1, 2, 3]), [1, 2, 3]);
}
