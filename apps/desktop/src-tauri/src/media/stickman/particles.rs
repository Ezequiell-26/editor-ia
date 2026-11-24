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
    if spec.kind == "rigid" {
        draw_rigid_particles(buf, w, h, spec, t, color);
        return;
    }
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

// ---------------------------------------------------------------- Cuerpos rígidos
//
// `rigid`: cajas OBB (rectángulos) con dinámica completa — gravedad,
// contacto con paredes/piso con punto de aplicación real (genera torque),
// colisiones caja-caja por SAT y fricción. A diferencia de `bounce`/`tumble`
// (partículas independientes), acá los cuerpos interactúan entre sí: la
// simulación es conjunta y se memoiza por hilo para no resimular desde t=0
// en cada frame (el render pide tiempos crecientes).

use std::cell::RefCell;

/// Tope de cuerpos por escena `rigid`: el costo por paso es O(n²) en
/// colisiones y una pila densa nunca disipa el jitter del solver lite —
/// 40 mantiene la escena en ~una capa sobre lienzos de 640px, que sí se
/// asienta de forma creíble.
const RIGID_MAX_BODIES: usize = 40;
/// Fricción tangencial de los contactos (coeficiente de Coulomb).
const RIGID_MU: f64 = 0.45;
/// Velocidad máxima (px/s) para evitar tunelización a dt fijo.
const RIGID_MAX_SPEED: f64 = 4000.0;

#[derive(Clone)]
struct RigidBody {
    x: f64,
    y: f64,
    angle: f64,
    vx: f64,
    vy: f64,
    omega: f64,
    /// Medias dimensiones del rectángulo local (ejes rotados por `angle`).
    hw: f64,
    hh: f64,
    /// Sleep: cuerpo en reposo soportado (piso u otro cuerpo). No integra
    /// gravedad; despierta con un impacto real o si pierde el apoyo.
    asleep: bool,
}

impl RigidBody {
    fn mass(&self) -> f64 {
        // Densidad superficial constante: masa ∝ área.
        (self.hw * self.hh * 4.0).max(1e-3)
    }
    /// Inercia de un rectángulo 2·hw × 2·hh respecto del centro.
    fn inertia(&self) -> f64 {
        let m = self.mass();
        (m * (self.hw * self.hw + self.hh * self.hh) / 3.0).max(1e-3)
    }
    /// Esquinas en coordenadas de mundo.
    fn corners(&self) -> [(f64, f64); 4] {
        let (c, s) = (self.angle.cos(), self.angle.sin());
        [
            (-self.hw, -self.hh),
            (self.hw, -self.hh),
            (self.hw, self.hh),
            (-self.hw, self.hh),
        ]
        .map(|(lx, ly)| (self.x + lx * c - ly * s, self.y + lx * s + ly * c))
    }
    /// Eje local X rotado a mundo (uno de los dos ejes de la caja).
    fn axis_x(&self) -> (f64, f64) {
        (self.angle.cos(), self.angle.sin())
    }
    /// Eje local Y rotado a mundo.
    fn axis_y(&self) -> (f64, f64) {
        (-self.angle.sin(), self.angle.cos())
    }
}

fn rigid_initial_bodies(w: f64, h: f64, spec: &ParticleSpec) -> Vec<RigidBody> {
    let spin_scale = spec.spin.unwrap_or(1.0).clamp(-8.0, 8.0);
    let count = spec.count.clamp(1, RIGID_MAX_BODIES as u32) as u64;
    (0..count)
        .map(|i| {
            // Dos hashes independientes para no correlacionar tamaño/posición.
            let s1 = i.wrapping_mul(2654435761) % 1000;
            let s2 = i.wrapping_mul(2246822519) % 1000;
            let fx = (s1 % 100) as f64 / 100.0;
            let p1 = ((s1 / 100) % 10) as f64 / 10.0;
            let p2 = (s2 % 100) as f64 / 100.0;
            let hw = 4.0 + p2 * 9.0;
            let hh = (2.0 + ((s2 / 100) % 60) as f64 / 10.0).min(hw);
            RigidBody {
                x: fx * w,
                y: p1 * h * 0.3,
                angle: ((s2 / 10) % 100) as f64 / 100.0 * std::f64::consts::TAU,
                vx: (p1 - 0.5) * 220.0,
                vy: 60.0 + p2 * 220.0,
                omega: (p1 - 0.35) * 10.0 * spin_scale,
                hw,
                hh,
                asleep: false,
            }
        })
        .collect()
}

/// Un paso PHYS_DT: integra, luego 3 iteraciones de contactos
/// (paredes + pares). Mismo esquema para cualquier fps de salida.
fn rigid_step(bodies: &mut [RigidBody], w: f64, h: f64, gravity: f64, restitution: f64) {
    for b in bodies.iter_mut() {
        if b.asleep {
            continue;
        }
        b.vy += gravity * PHYS_DT;
        b.x += b.vx * PHYS_DT;
        b.y += b.vy * PHYS_DT;
        b.angle += b.omega * PHYS_DT;
        let sp = (b.vx * b.vx + b.vy * b.vy).sqrt();
        if sp > RIGID_MAX_SPEED {
            let k = RIGID_MAX_SPEED / sp;
            b.vx *= k;
            b.vy *= k;
        }
        b.omega = b.omega.clamp(-40.0, 40.0);
    }
    for _ in 0..3 {
        // Pares primero, paredes después: si las paredes van últimas, el
        // peso de la pila no puede re-inyectar velocidad descendente
        // después de que el piso la canceló (causa de jitter perpetuo).
        for i in 0..bodies.len() {
            for j in (i + 1)..bodies.len() {
                let (lo, hi) = bodies.split_at_mut(j);
                rigid_pair(&mut lo[i], &mut hi[0], restitution);
            }
        }
        for b in bodies.iter_mut() {
            rigid_wall(b, w, h, restitution);
        }
    }
    // Creep damping: los cuerpos lentos disipan el jitter residual del
    // solver (balanceo sobre una arista, deslizamiento en pilas).
    for b in bodies.iter_mut() {
        let sp2 = b.vx * b.vx + b.vy * b.vy;
        if sp2 < 3600.0 && !b.asleep {
            let k = if sp2 < 400.0 { 0.6 } else { 0.85 };
            b.vx *= k;
            b.vy *= k;
            b.omega *= if b.omega.abs() < 2.0 { k } else { 0.95 };
        }
    }
    // Sleep: cuerpo lento, casi sin giro y CON apoyo (piso u otro cuerpo,
    // dormido o no) se duerme. Sin requisito de apoyo se dormiría en el
    // ápice de un rebote (vy≈0 momentáneo) y flotar�a.
    let mut sleep_flags = vec![false; bodies.len()];
    for i in 0..bodies.len() {
        let b = &bodies[i];
        if b.asleep {
            continue;
        }
        let sp2 = b.vx * b.vx + b.vy * b.vy;
        if sp2 >= 144.0 || b.omega.abs() >= 1.0 {
            continue;
        }
        let on_floor = b.corners().iter().any(|&(_, cy)| cy >= h - 0.5);
        let supported = on_floor
            || (0..bodies.len()).any(|j| {
                j != i && rigid_near(b, &bodies[j], 2.0)
            });
        sleep_flags[i] = supported;
    }
    for (b, flag) in bodies.iter_mut().zip(sleep_flags) {
        if flag {
            b.asleep = true;
            b.vx = 0.0;
            b.vy = 0.0;
            b.omega = 0.0;
        }
    }
}

/// Solape por SAT con tolerancia de gap: para el chequeo de "apoyo" del
/// sleep, dos cuerpos en contacto de reposo pueden estar separados por el
/// slop del solver (~0.5px) sin solapar de verdad.
fn rigid_near(a: &RigidBody, b: &RigidBody, gap: f64) -> bool {
    let axes = [a.axis_x(), a.axis_y(), b.axis_x(), b.axis_y()];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    for axis in axes {
        let ra = rigid_project_radius(a, axis);
        let rb = rigid_project_radius(b, axis);
        let dist = dx * axis.0 + dy * axis.1;
        if ra + rb + gap - dist.abs() <= 0.0 {
            return false;
        }
    }
    true
}

/// Todos los cuerpos dormidos o casi quietos: se puede congelar el resto
/// de la simulación (equivale al early-exit de `bounce`/`tumble`).
fn rigid_all_settled(bodies: &[RigidBody]) -> bool {
    // El solver lite no disipa del todo el creep de los últimos cuerpos
    // "exprimidos" por la pila: con ≥90% dormidos se considera asentada
    // (el remanente se mueve a <15 px/s, imperceptible a 24-60 fps).
    let asleep = bodies.iter().filter(|b| b.asleep).count();
    if asleep * 10 >= bodies.len() * 9 {
        return true;
    }
    bodies.iter().all(|b| {
        b.asleep
            || (b.vx * b.vx + b.vy * b.vy < 9.0 && b.omega.abs() < 0.15)
    })
}

/// Resuelve un contacto sobre un cuerpo: impulso normal + fricción +
/// corrección posicional. `nx,ny` es la normal hacia adentro del cuerpo.
fn rigid_apply_contact(
    b: &mut RigidBody,
    px: f64,
    py: f64,
    nx: f64,
    ny: f64,
    depth: f64,
    restitution: f64,
) {
    let inv_m = 1.0 / b.mass();
    let inv_i = 1.0 / b.inertia();
    let rx = px - b.x;
    let ry = py - b.y;
    // Velocidad del punto de contacto: v + ω×r.
    let vcx = b.vx - b.omega * ry;
    let vcy = b.vy + b.omega * rx;
    let vn = vcx * nx + vcy * ny;
    // Impacto real: despierta al cuerpo dormido.
    if vn < -15.0 {
        b.asleep = false;
    }
    if vn < 0.0 {
        let rn = rx * ny - ry * nx;
        let kn = inv_m + rn * rn * inv_i;
        let j = -(1.0 + restitution) * vn / kn;
        b.vx += j * nx * inv_m;
        b.vy += j * ny * inv_m;
        b.omega += rn * j * inv_i;
        // Fricción tangente (Coulomb), con la velocidad ya actualizada.
        let vcx2 = b.vx - b.omega * ry;
        let vcy2 = b.vy + b.omega * rx;
        let tx = -ny;
        let ty = nx;
        let vt = vcx2 * tx + vcy2 * ty;
        let rt = rx * ty - ry * tx;
        let kt = inv_m + rt * rt * inv_i;
        let jt = (-vt / kt).clamp(-RIGID_MU * j, RIGID_MU * j);
        b.vx += jt * tx * inv_m;
        b.vy += jt * ty * inv_m;
        b.omega += rt * jt * inv_i;
    }
    // Corrección posicional directa (slop para no vibrar en reposo).
    let corr = (depth - 0.5).max(0.0) * 0.8;
    if corr > 0.0 {
        b.x += nx * corr;
        b.y += ny * corr;
        if corr > 1.0 {
            b.asleep = false;
        }
    }
}

/// Colisión caja vs paredes del lienzo: para cada pared se toma la esquina
/// más penetrante como punto de contacto (genera torque real al rebotar).
fn rigid_wall(b: &mut RigidBody, w: f64, h: f64, restitution: f64) {
    let corners = b.corners();
    // (depth, corner_index, normal) por pared: bottom, top, left, right.
    let mut deepest = [f64::NEG_INFINITY; 4];
    let mut corner_idx = [0usize; 4];
    for (k, &(cx, cy)) in corners.iter().enumerate() {
        let depths = [cy - h, -cy, -cx, cx - w];
        for (p, d) in depths.iter().enumerate() {
            if *d > deepest[p] {
                deepest[p] = *d;
                corner_idx[p] = k;
            }
        }
    }
    const NORMALS: [(f64, f64); 4] = [(0.0, -1.0), (0.0, 1.0), (1.0, 0.0), (-1.0, 0.0)];
    for p in 0..4 {
        if deepest[p] > 0.0 {
            let (px, py) = corners[corner_idx[p]];
            let (nx, ny) = NORMALS[p];
            rigid_apply_contact(b, px, py, nx, ny, deepest[p], restitution);
            // Fricción de rodadura: un cuerpo apoyado en una pared pierde
            // giro rápido (si no, las cajas planas oscilan sobre una
            // arista para siempre — rocking perpetuo).
            b.omega *= 0.82;
        }
    }
}

/// Solape de una caja sobre un eje de proyección.
fn rigid_project_radius(b: &RigidBody, axis: (f64, f64)) -> f64 {
    let (ax, ay) = b.axis_x();
    let (bx, by) = b.axis_y();
    b.hw * (axis.0 * ax + axis.1 * ay).abs() + b.hh * (axis.0 * bx + axis.1 * by).abs()
}

/// Colisión caja-caja por SAT (4 ejes: los dos de cada cuerpo). El punto de
/// contacto se aproxima con las esquinas incidentes más profundas.
fn rigid_pair(a: &mut RigidBody, b: &mut RigidBody, restitution: f64) {
    let axes = [a.axis_x(), a.axis_y(), b.axis_x(), b.axis_y()];
    let mut min_overlap = f64::INFINITY;
    let mut normal = (1.0, 0.0);
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    for axis in axes {
        let ra = rigid_project_radius(a, axis);
        let rb = rigid_project_radius(b, axis);
        let dist = dx * axis.0 + dy * axis.1;
        let overlap = ra + rb - dist.abs();
        if overlap <= 0.0 {
            return; // Separadas en este eje: sin colisión.
        }
        if overlap < min_overlap {
            min_overlap = overlap;
            // Normal de A hacia B.
            let s = if dist >= 0.0 { 1.0 } else { -1.0 };
            normal = (axis.0 * s, axis.1 * s);
        }
    }
    // Punto de contacto: esquina de A más hacia B y de B más hacia A.
    let (nx, ny) = normal;
    let mut best_a = (a.x, a.y);
    let mut best_d = f64::NEG_INFINITY;
    for (cx, cy) in a.corners() {
        let d = (cx - a.x) * nx + (cy - a.y) * ny;
        if d > best_d {
            best_d = d;
            best_a = (cx, cy);
        }
    }
    let mut best_b = (b.x, b.y);
    let mut best_d = f64::INFINITY;
    for (cx, cy) in b.corners() {
        let d = (cx - b.x) * nx + (cy - b.y) * ny;
        if d < best_d {
            best_d = d;
            best_b = (cx, cy);
        }
    }
    let contact = ((best_a.0 + best_b.0) * 0.5, (best_a.1 + best_b.1) * 0.5);

    // Impulso con masa reducida e inercia en el punto de contacto.
    let inv_ma = 1.0 / a.mass();
    let inv_mb = 1.0 / b.mass();
    let inv_ia = 1.0 / a.inertia();
    let inv_ib = 1.0 / b.inertia();
    let rax = contact.0 - a.x;
    let ray = contact.1 - a.y;
    let rbx = contact.0 - b.x;
    let rby = contact.1 - b.y;
    let vcax = a.vx - a.omega * ray;
    let vcay = a.vy + a.omega * rax;
    let vcbx = b.vx - b.omega * rby;
    let vcby = b.vy + b.omega * rbx;
    let rvn = (vcbx - vcax) * nx + (vcby - vcay) * ny;
    if rvn < -15.0 {
        a.asleep = false;
        b.asleep = false;
    }
    if rvn < 0.0 {
        let ran = rax * ny - ray * nx;
        let rbn = rbx * ny - rby * nx;
        let kn = inv_ma + inv_mb + ran * ran * inv_ia + rbn * rbn * inv_ib;
        let j = -(1.0 + restitution) * rvn / kn;
        a.vx -= j * nx * inv_ma;
        a.vy -= j * ny * inv_ma;
        a.omega -= ran * j * inv_ia;
        b.vx += j * nx * inv_mb;
        b.vy += j * ny * inv_mb;
        b.omega += rbn * j * inv_ib;
        // Fricción tangente combinada.
        let vcax2 = a.vx - a.omega * ray;
        let vcay2 = a.vy + a.omega * rax;
        let vcbx2 = b.vx - b.omega * rby;
        let vcby2 = b.vy + b.omega * rbx;
        let tx = -ny;
        let ty = nx;
        let rvt = (vcbx2 - vcax2) * tx + (vcby2 - vcay2) * ty;
        let rat = rax * ty - ray * tx;
        let rbt = rbx * ty - rby * tx;
        let kt = inv_ma + inv_mb + rat * rat * inv_ia + rbt * rbt * inv_ib;
        let jt = (-rvt / kt).clamp(-RIGID_MU * j, RIGID_MU * j);
        a.vx -= jt * tx * inv_ma;
        a.vy -= jt * ty * inv_ma;
        a.omega -= rat * jt * inv_ia;
        b.vx += jt * tx * inv_mb;
        b.vy += jt * ty * inv_mb;
        b.omega += rbt * jt * inv_ib;
    }
    // Separación posicional proporcional a la penetración mínima.
    let corr = (min_overlap - 0.5).max(0.0) * 0.4;
    if corr > 0.0 {
        let wa = inv_ma / (inv_ma + inv_mb);
        let wb = 1.0 - wa;
        a.x -= nx * corr * wa;
        a.y -= ny * corr * wa;
        b.x += nx * corr * wb;
        b.y += ny * corr * wb;
        if corr > 1.0 {
            a.asleep = false;
            b.asleep = false;
        }
    }
}

/// Estado de la escena rígida en el instante `t`, memoizado por hilo: el
/// render pide tiempos crecientes, así que se avanza desde la última
/// posición en vez de resimular. Si el tiempo retrocede o cambia la
/// spec, se reinicia (sigue siendo determinista: mismos pasos dt).
fn rigid_bodies_at(t: f64, w: f64, h: f64, spec: &ParticleSpec) -> Vec<RigidBody> {
    #[derive(Clone, PartialEq)]
    struct Key {
        n: u32,
        w: usize,
        h: usize,
        g: u64,
        e: u64,
        s: u64,
    }
    let key = Key {
        n: spec.count.clamp(1, RIGID_MAX_BODIES as u32),
        w: w as usize,
        h: h as usize,
        g: spec.gravity.unwrap_or(900.0).clamp(0.0, 5000.0).to_bits(),
        e: spec.bounce.unwrap_or(0.72).clamp(0.0, 1.0).to_bits(),
        s: spec.spin.unwrap_or(1.0).clamp(-8.0, 8.0).to_bits(),
    };
    let gravity = f64::from_bits(key.g);
    let restitution = f64::from_bits(key.e);
    thread_local! {
        static RIGID_SCENE: RefCell<Option<(Key, f64, Vec<RigidBody>)>> = const { RefCell::new(None) };
    }
    RIGID_SCENE.with(|slot| {
        let mut slot = slot.borrow_mut();
        let restart = match slot.as_ref() {
            Some((k, tt, _)) => *k != key || *tt > t + 1e-9,
            None => true,
        };
        if restart {
            *slot = Some((key.clone(), 0.0, rigid_initial_bodies(w, h, spec)));
        }
        let (_, tt, bodies) = slot.as_mut().expect("scene inicializada");
        let mut sim_t = *tt;
        let mut steps = 0u64;
        while sim_t + PHYS_DT <= t && steps < PHYS_MAX_STEPS {
            rigid_step(bodies, w, h, gravity, restitution);
            sim_t += PHYS_DT;
            steps += 1;
            if rigid_all_settled(bodies) {
                // Congela también el creep residual de los últimos
                // cuerpos "exprimidos" por la pila: quedan dormidos con
                // velocidad cero y la escena sigue determinista.
                for b in bodies.iter_mut() {
                    b.asleep = true;
                    b.vx = 0.0;
                    b.vy = 0.0;
                    b.omega = 0.0;
                }
                // Congelado: se adelanta el reloj para no resimular.
                sim_t = t;
                break;
            }
        }
        *tt = sim_t;
        bodies.clone()
    })
}

/// Dibuja la escena rígida: cada caja se rasteriza rotada (mismo test de
/// punto-en-polígono local que `tumble`, pero con semiextents reales).
fn draw_rigid_particles(
    buf: &mut [u8],
    w: usize,
    h: usize,
    spec: &ParticleSpec,
    t: f64,
    color: [u8; 3],
) {
    let bodies = rigid_bodies_at(t, w as f64, h as f64, spec);
    for b in &bodies {
        let (c, s) = (b.angle.cos(), b.angle.sin());
        let rx = b.hw.ceil() as i64 + 1;
        let ry = b.hh.ceil() as i64 + 1;
        let cx = b.x.round() as i64;
        let cy = b.y.round() as i64;
        for dy in -ry..=ry {
            for dx in -rx..=rx {
                // Desrotar el offset del píxel a coordenadas locales.
                let lx = dx as f64 * c + dy as f64 * s;
                let ly = -dx as f64 * s + dy as f64 * c;
                if lx.abs() <= b.hw && ly.abs() <= b.hh {
                    blend_px(buf, w, h, cx + dx, cy + dy, color);
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Comando IPC
