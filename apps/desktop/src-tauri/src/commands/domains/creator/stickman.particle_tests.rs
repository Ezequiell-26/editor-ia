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
    assert!(
        (late - floor).abs() < 0.01,
        "a los 30s debe estar en el piso, y={late} floor={floor}"
    );
    // fps no influye: la simulación usa dt fijo.
    let (_, y24, _) = bounce_pos(3, 2.0, 640.0, 360.0, &spec);
    let (_, y60, _) = bounce_pos(3, 2.0, 640.0, 360.0, &spec);
    assert_eq!(y24, y60);
}

#[test]
fn bounce_kind_renders_pixels() {
    let rgb = render_frame(
        &stand_pose(),
        200,
        120,
        [255, 255, 255],
        [0, 0, 0],
        Some(&spec("bounce")),
        5,
        24,
    );
    let gold = rgb
        .as_chunks::<3>()
        .0
        .iter()
        .filter(|p| p[0] > 200 && p[1] > 150)
        .count();
    assert!(gold > 30, "bounce debe dibujar partículas, hay {gold}");
}

#[test]
fn particles_are_deterministic_across_frames() {
    let a = render_frame(
        &stand_pose(),
        200,
        120,
        [255, 255, 255],
        [0, 0, 0],
        Some(&spec("confetti")),
        10,
        24,
    );
    let b = render_frame(
        &stand_pose(),
        200,
        120,
        [255, 255, 255],
        [0, 0, 0],
        Some(&spec("confetti")),
        10,
        24,
    );
    assert_eq!(a, b, "mismo frame debe producir los mismos píxeles");
    let c = render_frame(
        &stand_pose(),
        200,
        120,
        [255, 255, 255],
        [0, 0, 0],
        Some(&spec("confetti")),
        11,
        24,
    );
    assert_ne!(a, c, "frames distintos deben diferir");
}

#[test]
fn each_particle_kind_renders_pixels() {
    for kind in ["confetti", "snow", "sparks", "bounce"] {
        let rgb = render_frame(
            &stand_pose(),
            200,
            120,
            [255, 255, 255],
            [0, 0, 0],
            Some(&spec(kind)),
            5,
            24,
        );
        let gold = rgb
            .as_chunks::<3>()
            .0
            .iter()
            .filter(|p| p[0] > 200 && p[1] > 150)
            .count();
        assert!(
            gold > 50,
            "{kind} debe dibujar partículas doradas, hay {gold}"
        );
    }
}
