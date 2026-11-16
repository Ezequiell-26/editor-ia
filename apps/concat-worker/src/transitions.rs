// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jareer Abdullah
//
// Portado de vendor/concat/crates/concat-render/src/transitions.rs (mismo
// proyecto AGPL): las formas de transición que el compositor de Concat
// dibuja sin shaders WGSL. El worker no tiene GPU, así que usa exactamente
// este fallback CPU para que un export del worker se vea como el monitor
// de Concat sin GPU.

//! Las transiciones que un compositor sin shaders puede dibujar igual.
//!
//! Un paquete de transición de Concat es un cuerpo WGSL; lo que el
//! reference CPU corre en su lugar es la forma que el paquete nombra como
//! su `xfade` — el nombre de la transición FFmpeg a la que el manifiesto
//! dice que degrada — dibujada acá en aritmética sobre las dos imágenes
//! ya terminadas. Cada forma sigue al shader que la nombra más que a la
//! lectura de FFmpeg, así un export sin GPU y el monitor muestran el corte
//! como lo hace el GPU, menos el adorno que el shader suma encima.
//!
//! Las imágenes se samplean nearest, con clamp en los bordes, como clampean
//! los samplers de los shaders: un slide que sacó una imagen por un lado
//! muestra sus píxeles de borde smeared, no negro.

use concat_core::frame::Frame;

/// `a` hacia `b` por `amount`, en el gamma almacenado: la misma mezcla que
/// usa el compositor de referencia de Concat (`mix_frames` de
/// concat-render/src/reference.rs).
fn mix_frames(a: &Frame, b: &Frame, amount: f32) -> Frame {
    let amount = amount.clamp(0.0, 1.0);
    let mut out = a.clone();
    for (pixel, over) in out.pixels_mut().iter_mut().zip(b.pixels().iter()) {
        let base = f32::from(*pixel);
        *pixel = (base + (f32::from(*over) - base) * amount).round() as u8;
    }
    out
}

/// Las dos imágenes combinadas en `progress` a través de la forma que
/// `xfade` nombra, o `None` para una forma que este archivo no sabe dibujar
/// o imágenes que no coinciden en tamaño.
pub(crate) fn combine(from: &Frame, to: &Frame, xfade: &str, progress: f32) -> Option<Frame> {
    let (width, height) = (from.width(), from.height());
    if width == 0 || height == 0 || to.width() != width || to.height() != height {
        return None;
    }
    let p = progress.clamp(0.0, 1.0);
    // La mayoría de las formas suavizan como lo hacen sus shaders; los
    // crossfade viajan sobre el progreso crudo, que ya es la rampa que el
    // export planeó.
    let s = smoothstep(0.0, 1.0, p);
    let shape = Shape::named(xfade)?;

    let pick = |at: &dyn Fn(f32, f32) -> [f32; 4]| -> Frame {
        let mut out = Frame::black(width, height);
        for y in 0..height {
            let v = (y as f32 + 0.5) / height as f32;
            for x in 0..width {
                let u = (x as f32 + 0.5) / width as f32;
                out.set_pixel(x, y, to_bytes(at(u, v)));
            }
        }
        out
    };
    let from_at = |u: f32, v: f32| sample(from, u, v);
    let to_at = |u: f32, v: f32| sample(to, u, v);

    Some(match shape {
        Shape::Cross => mix_frames(from, to, p),
        Shape::ThroughBlack => {
            // Hacia negro hasta la mitad, y de vuelta.
            let base = if p < 0.5 { from } else { to };
            let dark = if p < 0.5 { 2.0 * p } else { 2.0 - 2.0 * p };
            mix_frames(base, &Frame::black(width, height), dark)
        }
        Shape::ThroughWhite => {
            // La familia film-burn: un crossfade con un flash cálido que
            // pica en el medio del corte, como suma cada shader que nombra
            // esto sobre `mix(from, to, progress)`.
            let base = mix_frames(from, to, p);
            let flash = (1.0 - (2.0 * p - 1.0).abs()) * 0.6;
            let warm = [1.0, 0.85, 0.6];
            let mut out = base.clone();
            for pixel in out.pixels_mut().chunks_exact_mut(4) {
                for (channel, tint) in pixel.iter_mut().zip(warm) {
                    let lit = f32::from(*channel) / 255.0 + tint * flash;
                    *channel = (lit.clamp(0.0, 1.0) * 255.0).round() as u8;
                }
            }
            out
        }
        Shape::Clock => pick(&|u, v| {
            // Las doce en punto es recto para arriba; la aguja barre en
            // sentido horario.
            let (cx, cy) = (u - 0.5, v - 0.5);
            let mut angle = cx.atan2(-cy);
            if angle < 0.0 {
                angle += std::f32::consts::TAU;
            }
            if angle < s * std::f32::consts::TAU {
                to_at(u, v)
            } else {
                from_at(u, v)
            }
        }),
        Shape::Iris { closing } => pick(&|u, v| {
            let d =
                ((u - 0.5).powi(2) + (v - 0.5).powi(2)).sqrt() / std::f32::consts::FRAC_1_SQRT_2;
            // El borde sobrepasa su suavidad en ambos extremos, así el
            // progreso 0 es exactamente la imagen saliente y 1 la entrante.
            let radius = edge(if closing { 1.0 - s } else { s }, 1.15, 0.05);
            let m = smoothstep(radius - 0.05, radius + 0.05, d);
            // Adentro del círculo va la imagen entrante mientras abre, y
            // la saliente mientras cierra.
            let (inside, outside) = if closing {
                (from_at(u, v), to_at(u, v))
            } else {
                (to_at(u, v), from_at(u, v))
            };
            mix(inside, outside, m)
        }),
        Shape::Box { closing } => pick(&|u, v| {
            let d = (u - 0.5).abs().max((v - 0.5).abs()) * 2.0;
            let radius = edge(if closing { 1.0 - s } else { s }, 1.05, 0.03);
            let m = smoothstep(radius - 0.03, radius + 0.03, d);
            let (inside, outside) = if closing {
                (from_at(u, v), to_at(u, v))
            } else {
                (to_at(u, v), from_at(u, v))
            };
            mix(inside, outside, m)
        }),
        Shape::Wipe { coord, soft } => pick(&|u, v| {
            // La imagen entrante queda descubierta donde la coordenada está
            // detrás del borde; el borde es tan suave como dice la forma.
            let at = edge(s, 1.0, soft);
            let m = smoothstep(at - soft, at + soft, coord.of(u, v));
            mix(to_at(u, v), from_at(u, v), m)
        }),
        Shape::Bars { axis, closing } => pick(&|u, v| {
            let d = match axis {
                Axis::X => (u - 0.5).abs() * 2.0,
                Axis::Y => (v - 0.5).abs() * 2.0,
            };
            let at = edge(if closing { 1.0 - s } else { s }, 1.0, 0.02);
            let m = smoothstep(at - 0.02, at + 0.02, d);
            let (inside, outside) = if closing {
                (from_at(u, v), to_at(u, v))
            } else {
                (to_at(u, v), from_at(u, v))
            };
            mix(inside, outside, m)
        }),
        Shape::Slide { dx, dy, moving } => pick(&|u, v| {
            // La imagen entrante llega desde el lado hacia donde apunta la
            // dirección; en un push la saliente se va por el otro lado, en
            // un cover se queda quieta, en un reveal se mueve sólo ella.
            // Las dos imágenes viajan por (dx, dy): la entrante todavía le
            // falta `1 - s` para su lugar, la saliente ya pasó `s` por el
            // suyo, así que cada una se lee de donde estaba.
            let (tu, tv) = (u + dx * (1.0 - s), v + dy * (1.0 - s));
            let (fu, fv) = (u - dx * s, v - dy * s);
            let arrived = (0.0..=1.0).contains(&tu) && (0.0..=1.0).contains(&tv);
            match moving {
                Moving::Both => {
                    if arrived {
                        to_at(tu, tv)
                    } else {
                        from_at(fu, fv)
                    }
                }
                Moving::Incoming => {
                    if arrived {
                        to_at(tu, tv)
                    } else {
                        from_at(u, v)
                    }
                }
                Moving::Outgoing => {
                    if (0.0..=1.0).contains(&fu) && (0.0..=1.0).contains(&fv) {
                        from_at(fu, fv)
                    } else {
                        to_at(u, v)
                    }
                }
            }
        }),
        Shape::Zoom => pick(&|u, v| {
            // La imagen saliente se aleja mientras se va; la entrante llega
            // agrandada y se asienta a su tamaño.
            let zoom =
                |u: f32, v: f32, scale: f32| ((u - 0.5) / scale + 0.5, (v - 0.5) / scale + 0.5);
            let (fu, fv) = zoom(u, v, 1.0 + s * 1.6);
            let (tu, tv) = zoom(u, v, 1.6 - s * 0.6);
            mix(from_at(fu, fv), to_at(tu, tv), s)
        }),
        Shape::Blocks => {
            // Un crossfade a través de un mosaico que es más grueso en el
            // medio del corte y desaparece en los extremos.
            let k = (p * std::f32::consts::PI).sin();
            let block = (1.0 + k * 0.05 * width.min(height) as f32).floor().max(1.0) as u32;
            pick(&|u, v| {
                let x = ((u * width as f32) as u32 / block * block) as f32 + 0.5;
                let y = ((v * height as f32) as u32 / block * block) as f32 + 0.5;
                let (bu, bv) = (x / width as f32, y / height as f32);
                mix(from_at(bu, bv), to_at(bu, bv), p)
            })
        }
    })
}

/// `true` si `xfade` nombra una forma que este archivo sabe dibujar.
/// Lo usa `render_export` para rechazar un `transition.type` inválido
/// antes de abrir decoders.
pub(crate) fn known(xfade: &str) -> bool {
    Shape::named(xfade).is_some()
}

/// Qué dibuja un nombre.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Shape {
    Cross,
    ThroughBlack,
    ThroughWhite,
    Clock,
    Iris { closing: bool },
    Box { closing: bool },
    Wipe { coord: Coord, soft: f32 },
    Bars { axis: Axis, closing: bool },
    Slide { dx: f32, dy: f32, moving: Moving },
    Zoom,
    Blocks,
}

/// Hacia qué lado viaja el borde de un wipe, como la coordenada que queda
/// detrás de él.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Coord {
    /// desde el borde derecho hacia la izquierda
    Left,
    /// desde el borde izquierdo hacia la derecha
    Right,
    /// desde el borde inferior hacia arriba
    Up,
    /// desde el borde superior hacia abajo
    Down,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Coord {
    fn of(self, u: f32, v: f32) -> f32 {
        match self {
            Coord::Left => 1.0 - u,
            Coord::Right => u,
            Coord::Up => 1.0 - v,
            Coord::Down => v,
            Coord::TopLeft => (u + v) / 2.0,
            Coord::TopRight => (1.0 - u + v) / 2.0,
            Coord::BottomLeft => (u + 1.0 - v) / 2.0,
            Coord::BottomRight => (2.0 - u - v) / 2.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Axis {
    X,
    Y,
}

/// Qué imágenes mueve un slide.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Moving {
    /// un push: las dos, a la par
    Both,
    /// un cover: la entrante sobre una saliente quieta
    Incoming,
    /// un reveal: la saliente fuera sobre una entrante quieta
    Outgoing,
}

impl Shape {
    /// La forma que un nombre `xfade` de FFmpeg significa acá; ver el
    /// módulo. Es la misma tabla que usa el reference de concat-render.
    fn named(xfade: &str) -> Option<Shape> {
        use Coord::*;
        let hard = 0.004;
        let soft = 0.15;
        let slide = |dx, dy, moving| Shape::Slide { dx, dy, moving };
        Some(match xfade {
            "fade" | "dissolve" | "fadegrays" | "fadefast" | "fadeslow" | "distance" | "hblur" => {
                Shape::Cross
            }
            "fadeblack" => Shape::ThroughBlack,
            "fadewhite" => Shape::ThroughWhite,
            "radial" => Shape::Clock,
            "circleopen" => Shape::Iris { closing: false },
            "circleclose" | "circlecrop" => Shape::Iris { closing: true },
            "rectcrop" => Shape::Box { closing: true },
            "wipeleft" => Shape::Wipe {
                coord: Left,
                soft: hard,
            },
            "wiperight" => Shape::Wipe {
                coord: Right,
                soft: hard,
            },
            "wipeup" => Shape::Wipe {
                coord: Up,
                soft: hard,
            },
            "wipedown" => Shape::Wipe {
                coord: Down,
                soft: hard,
            },
            "wipetl" | "diagtl" => Shape::Wipe {
                coord: TopLeft,
                soft: hard,
            },
            "wipetr" | "diagtr" => Shape::Wipe {
                coord: TopRight,
                soft: hard,
            },
            "wipebl" | "diagbl" => Shape::Wipe {
                coord: BottomLeft,
                soft: hard,
            },
            "wipebr" | "diagbr" => Shape::Wipe {
                coord: BottomRight,
                soft: hard,
            },
            "smoothleft" => Shape::Wipe { coord: Left, soft },
            "smoothright" => Shape::Wipe { coord: Right, soft },
            "smoothup" => Shape::Wipe { coord: Up, soft },
            "smoothdown" => Shape::Wipe { coord: Down, soft },
            "horzopen" => Shape::Bars {
                axis: Axis::Y,
                closing: false,
            },
            "horzclose" => Shape::Bars {
                axis: Axis::Y,
                closing: true,
            },
            "vertopen" => Shape::Bars {
                axis: Axis::X,
                closing: false,
            },
            "vertclose" => Shape::Bars {
                axis: Axis::X,
                closing: true,
            },
            // La dirección de un slide es a dónde van las imágenes: left
            // significa que la entrante llega desde la derecha, así que su
            // punto de muestreo se empuja a la derecha por lo que aún no
            // llegó.
            "slideleft" => slide(-1.0, 0.0, Moving::Both),
            "slideright" => slide(1.0, 0.0, Moving::Both),
            "slideup" => slide(0.0, -1.0, Moving::Both),
            "slidedown" => slide(0.0, 1.0, Moving::Both),
            "coverleft" => slide(-1.0, 0.0, Moving::Incoming),
            "coverright" => slide(1.0, 0.0, Moving::Incoming),
            "coverup" => slide(0.0, -1.0, Moving::Incoming),
            "coverdown" => slide(0.0, 1.0, Moving::Incoming),
            "revealleft" => slide(-1.0, 0.0, Moving::Outgoing),
            "revealright" => slide(1.0, 0.0, Moving::Outgoing),
            "revealup" => slide(0.0, -1.0, Moving::Outgoing),
            "revealdown" => slide(0.0, 1.0, Moving::Outgoing),
            "zoomin" => Shape::Zoom,
            "pixelize" => Shape::Blocks,
            _ => return None,
        })
    }
}

/// El color de la imagen en `(u, v)` en `0..=1`, nearest y clampeado.
fn sample(picture: &Frame, u: f32, v: f32) -> [f32; 4] {
    let x = ((u * picture.width() as f32).floor().max(0.0) as u32).min(picture.width() - 1);
    let y = ((v * picture.height() as f32).floor().max(0.0) as u32).min(picture.height() - 1);
    let [r, g, b, a] = picture.pixel(x, y).unwrap_or([0, 0, 0, 255]);
    [
        f32::from(r) / 255.0,
        f32::from(g) / 255.0,
        f32::from(b) / 255.0,
        f32::from(a) / 255.0,
    ]
}

fn to_bytes(rgba: [f32; 4]) -> [u8; 4] {
    rgba.map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8)
}

/// El `mix` de WGSL: `a` hacia `b` por `t`.
fn mix(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    let t = t.clamp(0.0, 1.0);
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

/// Dónde se sienta un borde suave en `progress`: viaja de `-soft` a
/// `reach + soft`, así todo su blend queda fuera de la imagen en ambos
/// extremos y el progreso 0 y 1 son las dos imágenes mismas.
fn edge(progress: f32, reach: f32, soft: f32) -> f32 {
    progress * (reach + 2.0 * soft) - soft
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [u8; 4] = [255, 0, 0, 255];
    const BLUE: [u8; 4] = [0, 0, 255, 255];

    fn solid(rgba: [u8; 4]) -> Frame {
        let mut frame = Frame::black(16, 16);
        frame.fill(rgba);
        frame
    }

    fn at(xfade: &str, progress: f32) -> Frame {
        combine(&solid(RED), &solid(BLUE), xfade, progress).expect("a known shape")
    }

    /// Toda forma arranca como la imagen saliente y termina como la
    /// entrante, haga lo que haga en el medio.
    #[test]
    fn every_shape_runs_from_one_picture_to_the_other() {
        let names = [
            "fade",
            "fadeblack",
            "fadewhite",
            "radial",
            "circleopen",
            "circleclose",
            "rectcrop",
            "wipeleft",
            "wiperight",
            "wipeup",
            "wipedown",
            "wipetl",
            "diagbr",
            "smoothleft",
            "horzopen",
            "horzclose",
            "vertopen",
            "vertclose",
            "slideleft",
            "slideright",
            "slideup",
            "slidedown",
            "coverleft",
            "revealright",
            "zoomin",
            "pixelize",
        ];
        for name in names {
            let start = at(name, 0.0);
            let end = at(name, 1.0);
            for (x, y) in [(0, 0), (8, 8), (15, 15), (3, 12)] {
                assert_eq!(start.pixel(x, y), Some(RED), "{name} at 0, ({x},{y})");
                assert_eq!(end.pixel(x, y), Some(BLUE), "{name} at 1, ({x},{y})");
            }
        }
    }

    /// Un nombre que el archivo no dibuja se declina, y también imágenes de
    /// dos tamaños; el caller conserva su dissolve.
    #[test]
    fn an_unknown_shape_or_a_mismatch_is_declined() {
        assert!(combine(&solid(RED), &solid(BLUE), "hlslice", 0.5).is_none());
        assert!(combine(&solid(RED), &solid(BLUE), "", 0.5).is_none());
        let small = Frame::black(4, 4);
        assert!(combine(&solid(RED), &small, "fade", 0.5).is_none());
        assert!(combine(&Frame::black(0, 0), &Frame::black(0, 0), "fade", 0.5).is_none());
    }

    /// A la mitad de un crossfade es la mitad entre las dos, y un progreso
    /// fuera de rango queda sostenido en el extremo.
    #[test]
    fn a_crossfade_is_the_mean_at_the_middle() {
        let mid = at("fade", 0.5);
        let [r, _, b, a] = mid.pixel(5, 5).unwrap();
        assert!((126..=129).contains(&r) && (126..=129).contains(&b) && a == 255);
        assert_eq!(at("fade", -3.0).pixel(0, 0), Some(RED));
        assert_eq!(at("fade", 7.0).pixel(0, 0), Some(BLUE));
    }

    /// Through black: oscuro en el medio, camino a la otra imagen.
    #[test]
    fn a_fade_through_black_is_black_at_the_middle() {
        assert_eq!(at("fadeblack", 0.5).pixel(4, 4), Some([0, 0, 0, 255]));
        let [r, _, _, _] = at("fadeblack", 0.25).pixel(4, 4).unwrap();
        assert!((120..=135).contains(&r), "half the red left: {r}");
    }

    /// El reloj barre en sentido horario desde las doce: a la mitad del
    /// corte la mitad derecha ya giró y la izquierda no.
    #[test]
    fn a_clock_wipe_sweeps_clockwise_from_twelve() {
        let mid = at("radial", 0.5);
        assert_eq!(mid.pixel(12, 2), Some(BLUE), "top right has turned");
        assert_eq!(mid.pixel(12, 13), Some(BLUE), "bottom right has turned");
        assert_eq!(mid.pixel(3, 13), Some(RED), "bottom left has not");
        assert_eq!(mid.pixel(3, 2), Some(RED), "top left has not");
    }

    /// Un iris abre desde el centro, así que el medio gira antes que las
    /// esquinas; cerrando, las esquinas giran primero.
    #[test]
    fn an_iris_opens_from_the_centre() {
        let opening = at("circleopen", 0.5);
        assert_eq!(opening.pixel(8, 8), Some(BLUE));
        assert_eq!(opening.pixel(0, 0), Some(RED));
        let closing = at("circleclose", 0.5);
        assert_eq!(closing.pixel(8, 8), Some(RED));
        assert_eq!(closing.pixel(0, 0), Some(BLUE));
    }

    /// Un wipe descubre la imagen entrante detrás de un borde en
    /// movimiento, desde el lado que dice el nombre.
    #[test]
    fn a_wipe_uncovers_from_the_named_side() {
        let left = at("wipeleft", 0.5);
        assert_eq!(left.pixel(15, 8), Some(BLUE), "right edge went first");
        assert_eq!(left.pixel(0, 8), Some(RED));
        let right = at("wiperight", 0.5);
        assert_eq!(right.pixel(0, 8), Some(BLUE), "left edge went first");
        assert_eq!(right.pixel(15, 8), Some(RED));
        let down = at("wipedown", 0.5);
        assert_eq!(down.pixel(8, 0), Some(BLUE), "top went first");
        assert_eq!(down.pixel(8, 15), Some(RED));
        let corner = at("wipetl", 0.5);
        assert_eq!(
            corner.pixel(0, 0),
            Some(BLUE),
            "the top-left corner went first"
        );
        assert_eq!(corner.pixel(15, 15), Some(RED));
    }

    /// Las barras abren desde la línea central hacia afuera, o cierran
    /// sobre ella.
    #[test]
    fn bars_open_from_the_middle_and_close_onto_it() {
        let open = at("horzopen", 0.5);
        assert_eq!(open.pixel(8, 8), Some(BLUE));
        assert_eq!(open.pixel(8, 0), Some(RED));
        let close = at("vertclose", 0.5);
        assert_eq!(close.pixel(8, 8), Some(RED));
        assert_eq!(close.pixel(0, 8), Some(BLUE));
    }

    /// Un slide a la izquierda trae la imagen entrante desde la derecha
    /// mientras la saliente se va por la izquierda; un cover deja quieta
    /// la saliente; un reveal mueve sólo la saliente.
    #[test]
    fn a_slide_arrives_from_the_far_side() {
        let left = at("slideleft", 0.5);
        assert_eq!(left.pixel(15, 8), Some(BLUE), "arrived on the right");
        assert_eq!(left.pixel(0, 8), Some(RED), "still leaving on the left");
        let up = at("slideup", 0.5);
        assert_eq!(up.pixel(8, 15), Some(BLUE), "arrived from below");
        assert_eq!(up.pixel(8, 0), Some(RED));
        let cover = at("coverright", 0.5);
        assert_eq!(
            cover.pixel(0, 8),
            Some(BLUE),
            "the cover came in from the left"
        );
        assert_eq!(cover.pixel(15, 8), Some(RED));
        let reveal = at("revealdown", 0.5);
        assert_eq!(
            reveal.pixel(8, 0),
            Some(BLUE),
            "the outgoing picture dropped away"
        );
        assert_eq!(reveal.pixel(8, 15), Some(RED));
    }

    /// Un mosaico a la mitad de un pixelize sigue siendo la media de las
    /// dos imágenes para imágenes de un solo color, y un zoom igual: las
    /// formas mueven píxeles, y una imagen plana no tiene cuáles mover.
    #[test]
    fn a_zoom_and_a_mosaic_over_flat_pictures_are_a_crossfade() {
        for name in ["pixelize", "zoomin"] {
            let [r, _, b, _] = at(name, 0.5).pixel(8, 8).unwrap();
            assert!(
                (100..=155).contains(&r) && (100..=155).contains(&b),
                "{name}: {r} {b}"
            );
        }
    }

    /// El fade a blanco levanta el medio del corte hacia blanco en vez de
    /// mezclar sólo las dos imágenes.
    #[test]
    fn a_fade_through_white_is_lit_at_the_middle() {
        let [r, g, b, _] = at("fadewhite", 0.5).pixel(8, 8).unwrap();
        let [pr, pg, pb, _] = at("fade", 0.5).pixel(8, 8).unwrap();
        assert!(
            r > pr && g > pg && b >= pb,
            "lit: {r} {g} {b} over {pr} {pg} {pb}"
        );
    }

    /// El muestreo clampea en los bordes: una imagen corrida fuera de un
    /// lado muestra sus píxeles de borde, nunca un agujero.
    #[test]
    fn samples_clamp_at_the_edges() {
        let picture = solid(RED);
        assert_eq!(sample(&picture, -2.0, 0.5), [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(sample(&picture, 0.5, 9.0), [1.0, 0.0, 0.0, 1.0]);
    }
}
