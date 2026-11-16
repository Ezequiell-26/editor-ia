// Quemado de `clip.monitorFrame` en el export MP4.
//
// Paridad funcional con las «molduras» de AlaukCut (`molduras.js`): los 19
// presets se rasterizan a PNG RGBA en el espacio local del clip (justo
// después del fit-scale, antes de scaleX/keyframes/rotate/perspectiva), así
// el marco hereda todo el transform de la capa igual que el overlay SVG del
// preview. La geometría y los 6 estilos son una reimplementación propia del
// modelo documentado en `docs/reference/alaukcut/10-lecturas-profesas.md`.

use std::path::Path;

const SUPERSAMPLE: usize = 3;

type Rgb = [f64; 3];

struct FramePreset {
    prop: f64,
    /// Radios por esquina en fracción del lado menor: [tl, tr, br, bl].
    radii: [f64; 4],
    thickness: f64,
    color: Rgb,
    color2: Rgb,
    /// 1 simple · 2 doble · 3 órbita · 4 neón · 5 flotante · 6 polaroid.
    style: u8,
    hexagon: bool,
    margin: f64,
}

const fn uniform(v: f64) -> [f64; 4] {
    [v, v, v, v]
}

const PRESETS: &[(&str, FramePreset)] = &[
    (
        "circle-thin",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.5),
            thickness: 0.014,
            color: [1.0, 1.0, 1.0],
            color2: [1.0, 1.0, 1.0],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "circle-halo",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.5),
            thickness: 0.022,
            color: [0.27, 0.88, 0.83],
            color2: [0.27, 0.88, 0.83],
            style: 2,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "rounded-soft",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.16),
            thickness: 0.013,
            color: [1.0, 1.0, 1.0],
            color2: [1.0, 1.0, 1.0],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "rounded-glass",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.22),
            thickness: 0.018,
            color: [0.82, 0.86, 0.95],
            color2: [0.82, 0.86, 0.95],
            style: 2,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "portrait-tall",
        FramePreset {
            prop: 0.75,
            radii: uniform(0.12),
            thickness: 0.013,
            color: [1.0, 1.0, 1.0],
            color2: [1.0, 1.0, 1.0],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "portrait-ribbon",
        FramePreset {
            prop: 0.5625,
            radii: uniform(0.14),
            thickness: 0.021,
            color: [0.98, 0.82, 0.35],
            color2: [0.98, 0.82, 0.35],
            style: 2,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "landscape-soft",
        FramePreset {
            prop: 16.0 / 9.0,
            radii: uniform(0.1),
            thickness: 0.013,
            color: [1.0, 1.0, 1.0],
            color2: [1.0, 1.0, 1.0],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "landscape-neon",
        FramePreset {
            prop: 16.0 / 9.0,
            radii: uniform(0.12),
            thickness: 0.014,
            color: [0.35, 0.88, 1.0],
            color2: [
                0x8b as f64 / 255.0,
                0x5c as f64 / 255.0,
                0xf6 as f64 / 255.0,
            ],
            style: 4,
            hexagon: false,
            margin: 0.045,
        },
    ),
    (
        "circle-aurora",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.5),
            thickness: 0.03,
            color: [
                0x8b as f64 / 255.0,
                0x5c as f64 / 255.0,
                0xf6 as f64 / 255.0,
            ],
            color2: [
                0x22 as f64 / 255.0,
                0xd3 as f64 / 255.0,
                0xee as f64 / 255.0,
            ],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "circle-sunset",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.5),
            thickness: 0.026,
            color: [1.0, 0xa6 as f64 / 255.0, 0x3d as f64 / 255.0],
            color2: [1.0, 0x4d as f64 / 255.0, 0x8d as f64 / 255.0],
            style: 2,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "circle-orbit",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.5),
            thickness: 0.018,
            color: [
                0x45 as f64 / 255.0,
                0xe0 as f64 / 255.0,
                0xd4 as f64 / 255.0,
            ],
            color2: [
                0x3b as f64 / 255.0,
                0x82 as f64 / 255.0,
                0xf6 as f64 / 255.0,
            ],
            style: 3,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "circle-neon",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.5),
            thickness: 0.012,
            color: [
                0x45 as f64 / 255.0,
                0xe0 as f64 / 255.0,
                0xd4 as f64 / 255.0,
            ],
            color2: [
                0x45 as f64 / 255.0,
                0xe0 as f64 / 255.0,
                0xd4 as f64 / 255.0,
            ],
            style: 4,
            hexagon: false,
            margin: 0.05,
        },
    ),
    (
        "rounded-floating",
        FramePreset {
            prop: 1.0,
            radii: uniform(0.18),
            thickness: 0.006,
            color: [1.0, 1.0, 1.0],
            color2: [1.0, 1.0, 1.0],
            style: 5,
            hexagon: false,
            margin: 0.06,
        },
    ),
    (
        "hexagon",
        FramePreset {
            prop: 1.1547005,
            radii: uniform(0.09),
            thickness: 0.016,
            color: [1.0, 1.0, 1.0],
            color2: [1.0, 1.0, 1.0],
            style: 2,
            hexagon: true,
            margin: 0.0,
        },
    ),
    (
        "arch",
        FramePreset {
            prop: 0.75,
            radii: [0.5, 0.5, 0.08, 0.08],
            thickness: 0.016,
            color: [
                0xf6 as f64 / 255.0,
                0xd3 as f64 / 255.0,
                0x65 as f64 / 255.0,
            ],
            color2: [
                0xfd as f64 / 255.0,
                0xa0 as f64 / 255.0,
                0x85 as f64 / 255.0,
            ],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "leaf",
        FramePreset {
            prop: 1.0,
            radii: [0.5, 0.12, 0.5, 0.12],
            thickness: 0.02,
            color: [
                0x34 as f64 / 255.0,
                0xd3 as f64 / 255.0,
                0x99 as f64 / 255.0,
            ],
            color2: [
                0x22 as f64 / 255.0,
                0xd3 as f64 / 255.0,
                0xee as f64 / 255.0,
            ],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "balloon",
        FramePreset {
            prop: 1.0,
            radii: [0.5, 0.5, 0.5, 0.07],
            thickness: 0.016,
            color: [1.0, 1.0, 1.0],
            color2: [1.0, 1.0, 1.0],
            style: 2,
            hexagon: false,
            margin: 0.0,
        },
    ),
    (
        "polaroid",
        FramePreset {
            prop: 0.86,
            radii: uniform(0.025),
            thickness: 0.035,
            color: [0.98, 0.98, 0.96],
            color2: [0.98, 0.98, 0.96],
            style: 6,
            hexagon: false,
            margin: 0.05,
        },
    ),
    (
        "capsule",
        FramePreset {
            prop: 0.5625,
            radii: uniform(0.5),
            thickness: 0.02,
            color: [
                0xf4 as f64 / 255.0,
                0x72 as f64 / 255.0,
                0xb6 as f64 / 255.0,
            ],
            color2: [
                0x8b as f64 / 255.0,
                0x5c as f64 / 255.0,
                0xf6 as f64 / 255.0,
            ],
            style: 1,
            hexagon: false,
            margin: 0.0,
        },
    ),
];

fn preset_by_id(id: &str) -> Option<&'static FramePreset> {
    PRESETS.iter().find(|(name, _)| *name == id).map(|(_, p)| p)
}

fn hex_rgb(hex: &str) -> Option<Rgb> {
    let value = hex.trim().strip_prefix('#').unwrap_or(hex.trim());
    if value.len() != 6 || !value.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let byte = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&value[range], 16).unwrap_or(0) as f64 / 255.0
    };
    Some([byte(0..2), byte(2..4), byte(4..6)])
}

/// Caja del marco dentro del content-box (réplica de `frameBox` de
/// `monitor-frames.ts`): aspecto `prop` centrado, margen descontado.
/// Devuelve (x0, y0, x1, y1).
fn frame_box(preset: &FramePreset, width: f64, height: f64) -> (f64, f64, f64, f64) {
    let clip_aspect = width / height.max(1e-6);
    let (mut half_u, mut half_v) = (0.5, 0.5);
    if preset.prop <= clip_aspect {
        half_u = 0.5 * (preset.prop / clip_aspect);
    } else {
        half_v = 0.5 * (clip_aspect / preset.prop);
    }
    let minor = width.min(height);
    let bx0 = half_u * (width / minor);
    let by0 = half_v * (height / minor);
    let reach = preset.margin * 2.0 * bx0.min(by0);
    let bx = (bx0 - reach).max(0.01);
    let by = (by0 - reach).max(0.01);
    let half_w = bx * minor;
    let half_h = by * minor;
    (
        width / 2.0 - half_w,
        height / 2.0 - half_h,
        width / 2.0 + half_w,
        height / 2.0 + half_h,
    )
}

/// Geometría del contorno: rect redondeado con radios por esquina o hexágono.
#[derive(Clone)]
enum Shape {
    Round {
        cx: f64,
        cy: f64,
        hx: f64,
        hy: f64,
        /// [tl, tr, br, bl] en px.
        radii: [f64; 4],
    },
    Hex {
        cx: f64,
        cy: f64,
        verts: [(f64, f64); 6],
        /// Distancia mínima del centro a cada arista (para bandas de trazo).
        inradius: f64,
        /// signo del winding para el test de semiplanos.
        winding: f64,
    },
}

fn shape_from_box(preset: &FramePreset, x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    let cx = (x0 + x1) / 2.0;
    let cy = (y0 + y1) / 2.0;
    let hx = (x1 - x0) / 2.0;
    let hy = (y1 - y0) / 2.0;
    if preset.hexagon {
        let q = (x1 - x0) / 4.0;
        let verts = [
            (x0 + q, y0),
            (x1 - q, y0),
            (x1, cy),
            (x1 - q, y1),
            (x0 + q, y1),
            (x0, cy),
        ];
        // inradius = mínima distancia del centro a las aristas.
        let mut inradius = f64::INFINITY;
        for i in 0..6 {
            let (ax, ay) = verts[i];
            let (bx, by) = verts[(i + 1) % 6];
            let ex = bx - ax;
            let ey = by - ay;
            let len = (ex * ex + ey * ey).sqrt().max(1e-6);
            let dist = ((cx - ax) * ey - (cy - ay) * ex).abs() / len;
            inradius = inradius.min(dist);
        }
        // winding: signo del área (coords y-down).
        let mut area2 = 0.0;
        for i in 0..6 {
            let (ax, ay) = verts[i];
            let (bx, by) = verts[(i + 1) % 6];
            area2 += ax * by - bx * ay;
        }
        let winding = if area2 >= 0.0 { 1.0 } else { -1.0 };
        return Shape::Hex {
            cx,
            cy,
            verts,
            inradius,
            winding,
        };
    }
    let side = (x1 - x0).min(y1 - y0);
    let radii = preset.radii.map(|r| r.clamp(0.0, 0.5) * side);
    Shape::Round {
        cx,
        cy,
        hx,
        hy,
        radii,
    }
}

/// Test de punto dentro de la forma. `inflate` expande/contrae la silueta
/// (positivo = hacia afuera) reproduciendo el offset de trazo SVG.
fn inside(shape: &Shape, x: f64, y: f64, inflate: f64) -> bool {
    match shape {
        Shape::Round {
            cx,
            cy,
            hx,
            hy,
            radii,
        } => {
            let hx = hx + inflate;
            let hy = hy + inflate;
            if hx <= 0.0 || hy <= 0.0 {
                return false;
            }
            let dx = x - cx;
            let dy = y - cy;
            if dx.abs() > hx || dy.abs() > hy {
                return false;
            }
            let radii = radii.map(|r| (r + inflate).max(0.0).min(hx.min(hy)));
            // Esquinas [tl(-,-), tr(+,-), br(+,+), bl(-,+)] con y hacia abajo.
            const CORNERS: [(f64, f64, usize); 4] = [
                (-1.0, -1.0, 0),
                (1.0, -1.0, 1),
                (1.0, 1.0, 2),
                (-1.0, 1.0, 3),
            ];
            for (sx, sy, idx) in CORNERS {
                let r = radii[idx];
                if r <= 0.0 {
                    continue;
                }
                // Zona de la esquina: cuadrados de lado r en cada punta.
                if sx * dx > hx - r && sy * dy > hy - r {
                    let ax = cx + sx * (hx - r);
                    let ay = cy + sy * (hy - r);
                    let ddx = x - ax;
                    let ddy = y - ay;
                    if ddx * ddx + ddy * ddy > r * r {
                        return false;
                    }
                }
            }
            true
        }
        Shape::Hex {
            cx,
            cy,
            verts,
            inradius,
            winding,
        } => {
            let k = (inradius + inflate) / inradius.max(1e-6);
            if k <= 0.0 {
                return false;
            }
            let mut sign = 0.0f64;
            for i in 0..6 {
                let (ax, ay) = verts[i];
                let (bx, by) = verts[(i + 1) % 6];
                let ax = cx + (ax - cx) * k;
                let ay = cy + (ay - cy) * k;
                let bx = cx + (bx - cx) * k;
                let by = cy + (by - cy) * k;
                let ex = bx - ax;
                let ey = by - ay;
                let cross = ex * (y - ay) - ey * (x - ax);
                let s = cross.signum();
                if s != 0.0 {
                    if sign == 0.0 {
                        sign = s;
                    } else if s != sign {
                        return false;
                    }
                }
            }
            // `winding` se usa sólo como documentación del orden; el test por
            // consistencia de signo ya cubre ambos vientos.
            let _ = winding;
            true
        }
    }
}

/// Cobertura de la banda de trazo de ancho `width` centrada en el contorno.
fn stroke_cover(shape: &Shape, x: f64, y: f64, width: f64) -> f64 {
    let half = width.max(0.0) / 2.0;
    (inside(shape, x, y, half) as i32 - inside(shape, x, y, -half) as i32) as f64
}

/// source-over sobre RGBA recta (no premultiplicada).
fn over(dst: &mut [f64; 4], rgb: Rgb, alpha: f64) {
    let sa = alpha.clamp(0.0, 1.0);
    if sa <= 0.0 {
        return;
    }
    let da = dst[3];
    let out_a = sa + da * (1.0 - sa);
    if out_a <= 0.0 {
        return;
    }
    for c in 0..3 {
        dst[c] = (rgb[c] * sa + dst[c] * da * (1.0 - sa)) / out_a;
    }
    dst[3] = out_a;
}

const WHITE: Rgb = [1.0, 1.0, 1.0];

/// Pinta los estilos 1-6 sobre `dst` para un subpíxel en (px, py).
/// `unit` = px del PNG por px de perfil (para el translate del estilo 5).
// clippy::too_many_arguments: pintado de un estilo de marco; dst, formas y
// paleta son la entrada completa del painter.
#[allow(clippy::too_many_arguments)]
fn paint_styles(
    dst: &mut [f64; 4],
    preset: &FramePreset,
    outer: &Shape,
    inner: Option<&Shape>,
    box_rect: (f64, f64, f64, f64),
    color: Rgb,
    color2: Rgb,
    gradient: bool,
    px: f64,
    py: f64,
    unit: f64,
) {
    // strokeWidth = max(0.5, thickness * side) con side = lado menor de la caja.
    let side = (box_rect.2 - box_rect.0).min(box_rect.3 - box_rect.1);
    let sw = (preset.thickness * side).max(0.5);

    match preset.style {
        1 => {
            over(
                dst,
                pick_at(&box_rect, px, py, gradient, color, color2),
                stroke_cover(outer, px, py, sw * 0.55),
            );
        }
        2 | 3 => {
            let factor = if preset.style == 2 { 0.7 } else { 0.55 };
            over(
                dst,
                pick_at(&box_rect, px, py, gradient, color, color2),
                stroke_cover(outer, px, py, sw * factor),
            );
            if let Some(inner_shape) = inner {
                let iw = (sw * if preset.style == 2 { 0.35 } else { 0.28 }).max(0.4);
                let ia = if preset.style == 2 { 0.45 } else { 0.5 };
                over(dst, WHITE, stroke_cover(inner_shape, px, py, iw) * ia);
            }
        }
        4 => {
            let glow = pick_at(&box_rect, px, py, gradient, color, color2);
            over(dst, glow, stroke_cover(outer, px, py, sw * 3.2) * 0.28);
            over(dst, glow, stroke_cover(outer, px, py, sw * 0.55));
        }
        5 => {
            // Sombra desplazada 3 px de perfil hacia abajo.
            let shadow = pick_at(&box_rect, px, py - 3.0 * unit, gradient, color, color2);
            over(
                dst,
                shadow,
                stroke_cover(outer, px, py - 3.0 * unit, sw * 0.55) * 0.7,
            );
            // Relleno de vidrio sobre el interior de la forma.
            if inside(outer, px, py, 0.0) {
                over(dst, WHITE, 0.14);
            }
            let core = pick_at(&box_rect, px, py, gradient, color, color2);
            over(dst, core, stroke_cover(outer, px, py, sw * 0.4) * 0.7);
        }
        6 => {
            // Polaroid: banda rellena entre la forma externa y la interna.
            if let Some(inner_shape) = inner {
                if inside(outer, px, py, 0.0) && !inside(inner_shape, px, py, 0.0) {
                    over(dst, color, 1.0);
                }
            }
        }
        _ => {}
    }
}

fn pick_at(
    box_rect: &(f64, f64, f64, f64),
    px: f64,
    py: f64,
    gradient: bool,
    color: Rgb,
    color2: Rgb,
) -> Rgb {
    if !gradient {
        return color;
    }
    let (x0, y0, x1, y1) = *box_rect;
    let u = ((px - x0) / (x1 - x0).max(1e-6) + (py - y0) / (y1 - y0).max(1e-6)) / 2.0;
    let t = u.clamp(0.0, 1.0);
    [
        color[0] + (color2[0] - color[0]) * t,
        color[1] + (color2[1] - color[1]) * t,
        color[2] + (color2[2] - color[2]) * t,
    ]
}

/// Rasteriza el marco a PNG RGBA en `path` (tamaño = layer del clip).
// clippy::too_many_arguments: renderiza un PNG de marco de monitor; path,
// lienzo, preset y paleta son la entrada completa.
#[allow(clippy::too_many_arguments)]
fn render_frame_png(
    path: &Path,
    width: u32,
    height: u32,
    preset: &FramePreset,
    color: Rgb,
    color2: Rgb,
    gradient: bool,
    unit: f64,
) -> Result<(), ProjectError> {
    let (w, h) = (width.max(2), height.max(2));
    let wf = w as f64;
    let hf = h as f64;
    let (bx0, by0, bx1, by1) = frame_box(preset, wf, hf);
    let outer = shape_from_box(preset, bx0, by0, bx1, by1);
    let side = (bx1 - bx0).min(by1 - by0);
    let sw = (preset.thickness * side).max(0.5);
    let inner_inset = sw * 1.7;
    let inner_box = (
        bx0 + inner_inset,
        by0 + inner_inset,
        (bx1 - inner_inset).max(bx0 + inner_inset + 1.0),
        (by1 - inner_inset).max(by0 + inner_inset + 1.0),
    );
    let inner = if inner_box.2 > inner_box.0 && inner_box.3 > inner_box.1 {
        Some(shape_from_box(
            preset,
            inner_box.0,
            inner_box.1,
            inner_box.2,
            inner_box.3,
        ))
    } else {
        None
    };
    // Alcance máximo pintado: glow neón (1.6*sw) + sombra (3*unit) + holgura.
    let reach = sw * 1.7 + 3.0 * unit + 2.0;
    let (rx0, ry0) = (bx0 - reach, by0 - reach);
    let (rx1, ry1) = (bx1 + reach, by1 + reach);

    let ss = SUPERSAMPLE as f64;
    let mut rgba = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            // Rechazo rápido por pixel fuera del alcance del marco.
            let pcx = x as f64 + 0.5;
            let pcy = y as f64 + 0.5;
            if pcx < rx0 || pcx > rx1 || pcy < ry0 || pcy > ry1 {
                continue;
            }
            let mut acc = [0.0f64; 4]; // premultiplicado
            for sy in 0..SUPERSAMPLE {
                for sx in 0..SUPERSAMPLE {
                    let px = x as f64 + (sx as f64 + 0.5) / ss;
                    let py = y as f64 + (sy as f64 + 0.5) / ss;
                    let mut dst = [0.0f64; 4];
                    paint_styles(
                        &mut dst,
                        preset,
                        &outer,
                        inner.as_ref(),
                        (bx0, by0, bx1, by1),
                        color,
                        color2,
                        gradient,
                        px,
                        py,
                        unit,
                    );
                    for c in 0..3 {
                        acc[c] += dst[c] * dst[3];
                    }
                    acc[3] += dst[3];
                }
            }
            let n = ss * ss;
            let a = acc[3] / n;
            let base = ((y * w + x) * 4) as usize;
            if a > 0.001 {
                for c in 0..3 {
                    rgba[base + c] = (acc[c] / acc[3].max(1e-6) * 255.0)
                        .round()
                        .clamp(0.0, 255.0) as u8;
                }
                rgba[base + 3] = (a * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    let image = image::RgbaImage::from_raw(w, h, rgba).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo rasterizar el marco del monitor",
        )
    })?;
    image.save(path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo escribir el PNG del marco del monitor",
        )
    })?;
    Ok(())
}

/// Prepara el input PNG del marco y devuelve su índice de input FFmpeg.
/// `None` cuando el clip no tiene `monitorFrame` o el preset es inválido.
pub(crate) fn prepare_frame_input(
    clip: &Value,
    asset: &Value,
    profile: &Profile,
    temp_dir: &Path,
    args: &mut Vec<String>,
    inputs: &mut usize,
) -> Result<Option<usize>, ProjectError> {
    let frame = match clip.get("monitorFrame") {
        Some(value) if value.is_object() => value,
        _ => return Ok(None),
    };
    let preset = match frame["preset"].as_str().and_then(preset_by_id) {
        Some(preset) => preset,
        None => return Ok(None),
    };
    // Tamaño del layer en el punto de inyección (post fit-scale):
    // cover => lienzo del perfil; contain => media ajustada (even_fit).
    let media = &asset["media"];
    let source_w = media["width"]
        .as_u64()
        .or_else(|| asset["width"].as_u64())
        .unwrap_or(profile.width as u64);
    let source_h = media["height"]
        .as_u64()
        .or_else(|| asset["height"].as_u64())
        .unwrap_or(profile.height as u64);
    // `blur` compone sobre el lienzo completo (fondo + primer plano), así
    // que el marco quemado usa el tamaño del canvas igual que `cover`.
    let (w, h) = if profile.fit == "cover" || profile.fit == "blur" {
        (profile.width, profile.height)
    } else {
        even_fit(
            source_w,
            source_h,
            profile.width as u64,
            profile.height as u64,
        )
    };
    let color = frame["color"]
        .as_str()
        .and_then(hex_rgb)
        .unwrap_or(preset.color);
    let color2 = frame["color2"]
        .as_str()
        .and_then(hex_rgb)
        .unwrap_or(preset.color2);
    let gradient = color != color2;
    let unit = h as f64 / profile.height.max(1) as f64;
    let index = *inputs;
    *inputs += 1;
    let path = temp_dir.join(format!("monitor-frame-{index}.png"));
    render_frame_png(&path, w, h, preset, color, color2, gradient, unit)?;
    args.extend([
        "-loop".into(),
        "1".into(),
        "-framerate".into(),
        profile.fps_arg(),
        "-i".into(),
        path.to_string_lossy().into_owned(),
    ]);
    Ok(Some(index))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_box_centra_y_respeta_aspecto() {
        let preset = preset_by_id("circle-thin").unwrap();
        let (x0, y0, x1, y1) = frame_box(preset, 1920.0, 1080.0);
        assert!((x1 - x0) - (y1 - y0) < 1.0, "prop=1 debe dar caja cuadrada");
        assert!((x0 + x1) / 2.0 - 960.0 < 0.01);
    }

    #[test]
    fn inside_circle_y_rect_redondeado() {
        let round = Shape::Round {
            cx: 0.0,
            cy: 0.0,
            hx: 50.0,
            hy: 50.0,
            radii: [50.0; 4],
        };
        assert!(inside(&round, 0.0, 0.0, 0.0));
        assert!(
            !inside(&round, 49.0, 49.0, 0.0),
            "esquina de círculo queda fuera"
        );
        assert!(inside(&round, 35.0, 35.0, 0.0));
        let rect = Shape::Round {
            cx: 0.0,
            cy: 0.0,
            hx: 50.0,
            hy: 50.0,
            radii: [0.0; 4],
        };
        assert!(
            inside(&rect, 49.9, 49.9, 0.0),
            "rect sin radios incluye la esquina"
        );
        // inflate negativo (interior del trazo) encoge la silueta.
        assert!(inside(&round, 40.0, 0.0, 0.0));
        assert!(
            !inside(&round, 40.0, 0.0, -15.0),
            "inflate -15 deja radio 35"
        );
    }

    #[test]
    fn hex_inside_y_banda() {
        let preset = preset_by_id("hexagon").unwrap();
        let shape = shape_from_box(preset, 100.0, 0.0, 300.0, 200.0);
        assert!(inside(&shape, 200.0, 100.0, 0.0), "centro dentro");
        assert!(
            !inside(&shape, 105.0, 5.0, 0.0),
            "esquina fuera del hexágono"
        );
        let cover = stroke_cover(&shape, 200.0, 0.0, 10.0);
        assert_eq!(cover, 1.0, "borde superior debe quedar cubierto");
        let cover_out = stroke_cover(&shape, 200.0, -30.0, 10.0);
        assert_eq!(cover_out, 0.0, "lejos del borde no hay trazo");
    }

    #[test]
    fn png_tiene_trazo_visible() {
        let dir = std::env::temp_dir().join(format!("mf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("frame.png");
        let preset = preset_by_id("circle-thin").unwrap();
        render_frame_png(
            &path,
            400,
            400,
            preset,
            preset.color,
            preset.color2,
            false,
            1.0,
        )
        .unwrap();
        let img = image::open(&path).unwrap().to_rgba8();
        let painted = img.pixels().filter(|p| p[3] > 40).count();
        assert!(
            painted > 500,
            "el PNG debe tener trazo visible, got {painted}"
        );
        // El centro debe quedar transparente (el marco no tapa el monitor).
        assert_eq!(img.get_pixel(200, 200)[3], 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn polaroid_pinta_banda_sin_trazo() {
        let dir = std::env::temp_dir().join(format!("mf-pol-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pol.png");
        let preset = preset_by_id("polaroid").unwrap();
        render_frame_png(
            &path,
            400,
            400,
            preset,
            preset.color,
            preset.color2,
            false,
            1.0,
        )
        .unwrap();
        let img = image::open(&path).unwrap().to_rgba8();
        // La banda polaroid es ancha: debe haber muchos px pintados.
        let painted = img.pixels().filter(|p| p[3] > 200).count();
        assert!(
            painted > 20_000,
            "la banda polaroid debe ser gruesa, got {painted}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
