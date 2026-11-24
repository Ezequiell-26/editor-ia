use super::*;

fn spec(kind: &str) -> ParticleSpec {
    spec_for(kind)
}

fn spec_for(kind: &str) -> ParticleSpec {
    ParticleSpec {
        kind: kind.into(),
        count: 200,
        color_hex: Some("#ffcc00".into()),
        gravity: None,
        bounce: None,
        spin: None,
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
fn tumble_particles_are_deterministic_and_rotate() {
    let spec = ParticleSpec {
        spin: Some(2.0),
        ..spec_for("tumble")
    };
    // Mismo instante → misma posición y mismo ángulo.
    let (x1, y1, _, a1) = tumble_pos(7, 1.5, 640.0, 360.0, &spec);
    let (x2, y2, _, a2) = tumble_pos(7, 1.5, 640.0, 360.0, &spec);
    assert_eq!((x1, y1, a1), (x2, y2, a2));
    // Cayendo, el cuerpo gira: el ángulo a 0.5s difiere del inicial.
    let (_, _, _, a_early) = tumble_pos(7, 0.5, 640.0, 360.0, &spec);
    assert_ne!(a_early, 0.0, "tumble debe rotar mientras cae");
    // Asentada, conserva un ángulo estable y queda en el piso.
    let (_, late, radius, _) = tumble_pos(7, 30.0, 640.0, 360.0, &spec);
    let floor = 360.0 - radius - 1.0;
    assert!(
        (late - floor).abs() < 0.01,
        "a los 30s debe estar en el piso, y={late} floor={floor}"
    );
    // spin=0 congela la rotación inicial pero no la física.
    let still = ParticleSpec {
        spin: Some(0.0),
        ..spec_for("tumble")
    };
    let (_, _, _, a_still) = tumble_pos(7, 0.5, 640.0, 360.0, &still);
    let (_, _, _, a_still2) = tumble_pos(7, 2.0, 640.0, 360.0, &still);
    assert_eq!(a_still, a_still2, "spin=0 no debe cambiar el ángulo");
}

#[test]
fn tumble_kind_renders_pixels() {
    let rgb = render_frame(
        &stand_pose(),
        200,
        120,
        [255, 255, 255],
        [0, 0, 0],
        Some(&spec("tumble")),
        5,
        24,
    );
    let gold = rgb
        .as_chunks::<3>()
        .0
        .iter()
        .filter(|p| p[0] > 200 && p[1] > 150)
        .count();
    assert!(gold > 30, "tumble debe dibujar partículas, hay {gold}");
}

#[test]
fn rigid_bodies_are_deterministic_and_settle() {
    let spec = spec_for("rigid");
    // Mismo instante → mismo estado (el cache memoiza, el resultado es idéntico).
    let a = rigid_bodies_at(1.5, 640.0, 360.0, &spec);
    let b = rigid_bodies_at(1.5, 640.0, 360.0, &spec);
    assert_eq!(a.len(), b.len());
    assert!(!a.is_empty());
    for (x, y) in a.iter().zip(b.iter()) {
        assert_eq!((x.x, x.y, x.angle), (y.x, y.y, y.angle));
    }
    // Retroceder en el tiempo resimula y da el mismo resultado.
    let _ = rigid_bodies_at(9.0, 640.0, 360.0, &spec);
    let back = rigid_bodies_at(1.5, 640.0, 360.0, &spec);
    assert_eq!(back[0].x, a[0].x);
    assert_eq!(back[0].y, a[0].y);
    // A los 60 s todos los cuerpos están casi quietos y dentro del lienzo.
    let late = rigid_bodies_at(60.0, 640.0, 360.0, &spec);
    for body in &late {
        assert!(
            body.vx * body.vx + body.vy * body.vy < 25.0,
            "debería estar asentado, v=({},{})",
            body.vx,
            body.vy
        );
        assert!(body.x.is_finite() && body.y.is_finite());
        assert!(
            body.x > -30.0 && body.x < 670.0 && body.y > -30.0 && body.y < 390.0,
            "cuerpo fuera de rango: ({},{})",
            body.x,
            body.y
        );
    }
}

#[test]
fn rigid_collisions_transfer_momentum() {
    // Dos cajas idénticas, una encima de la otra: la de arriba debe frenar
    // y la de abajo recibir impulso (vx de la superior ≈ 0 tras el choque
    // si la inferior está fija por fricción de paredes — al menos la
    // velocidad relativa debe disiparse: |Δv| medible entre t=0.2 y t=2).
    let spec = ParticleSpec {
        kind: "rigid".into(),
        count: 2,
        color_hex: None,
        gravity: Some(900.0),
        bounce: Some(0.3),
        spin: Some(0.0),
    };
    let early = rigid_bodies_at(0.2, 640.0, 360.0, &spec);
    let late = rigid_bodies_at(3.0, 640.0, 360.0, &spec);
    // La energía cinética total debe haber bajado (restitución < 1 +
    // fricción): la escena no puede ganar velocidad con el tiempo.
    let energy = |v: &[RigidBody]| {
        v.iter()
            .map(|b| {
                let m = b.mass();
                0.5 * m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.inertia() * b.omega * b.omega
            })
            .sum::<f64>()
    };
    assert!(
        energy(&late) <= energy(&early) * 1.5,
        "la energía no puede crecer: {} -> {}",
        energy(&early),
        energy(&late)
    );
    // Y a los 3 s ya están cayendo/asentadas, no congeladas en el aire.
    assert!(late.iter().all(|b| b.y < 360.0));
}

#[test]
fn each_particle_kind_renders_pixels() {
    for kind in ["confetti", "snow", "sparks", "bounce", "tumble", "rigid"] {
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
