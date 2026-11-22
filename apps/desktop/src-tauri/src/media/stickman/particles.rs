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
        let seed = i.wrapping_mul(2654435761) % 1000;
        let fx = (seed % 100) as f64 / 100.0;
        let phase = ((seed / 100) % 100) as f64 / 100.0;
        let (x, y, size, angle) = match spec.kind.as_str() {
            "bounce" => {
                let (x, y, s) = bounce_pos(i, t, w as f64, h as f64, spec);
                (x, y, s, 0.0)
            }
            "tumble" => tumble_pos(i, t, w as f64, h as f64, spec),
            "snow" => {
                let x = fx * w as f64 + (t * 12.0 * (phase + 0.3)).sin() * 14.0;
                let y = ((phase + t * 0.12) % 1.0) * h as f64;
                (x, y, 2.0, 0.0)
            }
            "sparks" => {
                let life = (t * 1.4 + phase) % 1.0;
                let x = w as f64 * (0.5 + (phase - 0.5) * 0.6) + (phase - 0.5) * 220.0 * life;
                let y = h as f64 * 0.8 - life * h as f64 * 0.6;
                (x, y, (2.4 - life).max(0.6), 0.0)
            }
            _ => {
                // confetti: cae con vaivén
                let speed = 60.0 + phase * 90.0;
                let x = fx * w as f64 + (t * 40.0 * (phase + 0.2)).sin() * 22.0;
                let y = ((phase + t * speed / h.max(1) as f64) % 1.0) * h as f64;
                (x, y, 2.2 + (phase * 3.0) % 2.0, 0.0)
            }
        };
        let r = size.max(1.0) as i64;
        // `tumble` dibuja un cuerpo rígido (rectángulo o triángulo según la
        // semilla) rotado por `angle`; el resto sigue siendo un disco.
        let is_tumble = spec.kind == "tumble";
        let is_tri = is_tumble && seed % 2 == 1;
        for dy in -r..=r {
            for dx in -r..=r {
                let hit = if is_tumble {
                    // Coordenadas locales: desrotar el offset del píxel.
                    let (c, s) = (angle.cos(), angle.sin());
                    let lx = dx as f64 * c + dy as f64 * s;
                    let ly = -dx as f64 * s + dy as f64 * c;
                    if is_tri {
                        // Triángulo equilátero con vértice arriba, radio circunscripto r.
                        point_in_triangle(lx, ly, r as f64)
                    } else {
                        // Rectángulo 2:1 (ancho = diámetro, alto = radio).
                        lx.abs() <= r as f64 && ly.abs() <= (r as f64 * 0.5)
                    }
                } else {
                    dx * dx + dy * dy <= r * r
                };
                if hit {
                    blend_px(
                        buf,
                        w,
                        h,
                        x.round() as i64 + dx,
                        y.round() as i64 + dy,
                        color,
                    );
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

/// Punto dentro de un triángulo equilátero de radio circunscripto `r`
/// (vértice superior). Test por signos de producto cruz.
fn point_in_triangle(x: f64, y: f64, r: f64) -> bool {
    let verts = [
        (0.0, -r),
        (r * 0.866_025_4, r * 0.5),
        (-r * 0.866_025_4, r * 0.5),
    ];
    let mut sign = 0i32;
    for k in 0..3 {
        let (x1, y1) = verts[k];
        let (x2, y2) = verts[(k + 1) % 3];
        let cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
        let s = if cross > 0.0 {
            1
        } else if cross < 0.0 {
            -1
        } else {
            0
        };
        if s != 0 {
            if sign == 0 {
                sign = s;
            } else if s != sign {
                return false;
            }
        }
    }
    true
}

/// Simula una partícula `bounce` desde t=0 hasta `t` segundos: gravedad,
/// restitución en el suelo y rebote en paredes. Determinista por semilla.
/// Sale temprano cuando la partícula se asienta (gravedad < 1 px/s² y
/// velocidad casi nula), así clips largos no pagan el costo de simular
/// partículas quietas en el piso.
fn bounce_pos(i: u64, t: f64, w: f64, h: f64, spec: &ParticleSpec) -> (f64, f64, f64) {
    let seed = i.wrapping_mul(2654435761) % 1000;
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

/// Simula una partícula `tumble` (cuerpo rígido lite): misma física que
/// `bounce` más velocidad angular `omega`. La rotación se integra con dt
/// fijo; en cada rebote `omega` pierde energía (fricción) y puede invertir
/// sentido levemente según la semilla. Devuelve (x, y, radio, ángulo).
fn tumble_pos(i: u64, t: f64, w: f64, h: f64, spec: &ParticleSpec) -> (f64, f64, f64, f64) {
    let seed = i.wrapping_mul(2654435761) % 1000;
    let fx = (seed % 100) as f64 / 100.0;
    let phase = ((seed / 100) % 100) as f64 / 100.0;
    let gravity = spec.gravity.unwrap_or(900.0).clamp(0.0, 5000.0);
    let restitution = spec.bounce.unwrap_or(0.72).clamp(0.0, 1.0);
    let spin_scale = spec.spin.unwrap_or(1.0).clamp(-8.0, 8.0);
    let radius = 3.0 + phase * 3.0;
    let floor = (h - radius - 1.0).max(radius);
    let mut x = fx * w;
    let mut y = phase * h * 0.35;
    let mut vx = (phase - 0.5) * 160.0;
    let mut vy = 80.0 + phase * 320.0;
    // Velocidad angular inicial derivada de la semilla (rad/s), escalada
    // por `spin` (negativo = giro horario).
    let mut omega = (phase - 0.35) * 10.0 * spin_scale;
    let mut angle = phase * std::f64::consts::TAU;
    let mut tt = 0.0;
    let mut steps = 0u64;
    while tt + PHYS_DT <= t && steps < PHYS_MAX_STEPS {
        vy += gravity * PHYS_DT;
        x += vx * PHYS_DT;
        y += vy * PHYS_DT;
        angle += omega * PHYS_DT;
        if x < radius {
            x = radius;
            vx = -vx * 0.9;
            omega *= 0.9;
        } else if x > w - radius {
            x = w - radius;
            vx = -vx * 0.9;
            omega *= 0.9;
        }
        if y >= floor && vy > 0.0 {
            y = floor;
            vy = -vy * restitution;
            vx *= 0.985;
            // Al tocar el piso el cuerpo rueda: la fricción disipa giro y
            // la rotación tiende a acompañar la traslación residual.
            omega *= 0.86;
            if spin_scale != 0.0 {
                omega += vx * 0.002;
            }
        }
        tt += PHYS_DT;
        steps += 1;
        if y >= floor - 0.01 && vy.abs() < 1.0 && vx.abs() < 1.0 && omega.abs() < 0.05 {
            break;
        }
    }
    (x, y.min(floor), radius, angle)
}

// ---------------------------------------------------------------- Comando IPC
