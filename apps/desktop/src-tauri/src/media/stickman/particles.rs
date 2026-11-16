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

// ---------------------------------------------------------------- Comando IPC
