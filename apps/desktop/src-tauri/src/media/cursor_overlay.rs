//! Cursor estilizado sobre la grabación de pantalla: spec validable, muestras
//! y generación del subtitle ASS que FFmpeg quema con `ass=`.
//!
//! La parte impura (muestreo Win32 `GetCursorPos`/`GetAsyncKeyState`) queda en
//! `commands/domains/integrations/screen_record/cursor_track.rs`; este módulo
//! es puro: muestras + spec → texto ASS.

use serde::{Deserialize, Serialize};

use crate::projects::service::{ProjectError, ProjectErrorCode};

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// Estilos de cursor propios (nombres en español, como el resto de la app).
/// `cheia`/`3d` son los equivalentes de los estilos `cheia`/`3d` de
/// `cursor_estilos.js` de AlaukCut.
pub const CURSOR_STYLES: [&str; 5] = ["flecha", "punto", "cruz", "cheia", "3d"];
pub const CURSOR_COLORS: [&str; 4] = ["blanco", "negro", "amarillo", "verde"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorOverlaySpec {
    pub style: String,
    pub color: String,
    /// 0.5 | 1.0 | 2.0
    pub scale: f64,
    /// Anillo expansivo en cada click.
    pub ripple: bool,
}

impl CursorOverlaySpec {
    pub fn validate(&self) -> Result<(), ProjectError> {
        if !CURSOR_STYLES.contains(&self.style.as_str()) {
            return Err(invalid("cursorStyle debe ser flecha, punto, cruz, cheia o 3d"));
        }
        if !CURSOR_COLORS.contains(&self.color.as_str()) {
            return Err(invalid("cursorColor debe ser blanco, negro, amarillo o verde"));
        }
        if ![0.5, 1.0, 2.0].contains(&self.scale) {
            return Err(invalid("cursorScale debe ser 0.5, 1 o 2"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickKind {
    Izquierdo,
    Derecho,
    Central,
}

#[derive(Debug, Clone, Copy)]
pub struct CursorSample {
    pub t_ms: u64,
    pub x: f64,
    pub y: f64,
    pub click: Option<ClickKind>,
}

/// Coordenada del cursor en píxeles de vídeo. `map` es el rectángulo del
/// escritorio que cubre el vídeo (origen x,y y tamaño w,h en coordenadas de
/// cursor); con mapa degenerado se usa la posición cruda.
fn to_video_xy(
    sample: &CursorSample,
    map: (i32, i32, i32, i32),
    vw: u32,
    vh: u32,
) -> (f64, f64) {
    let (mx, my, mw, mh) = map;
    if mw <= 0 || mh <= 0 {
        return (sample.x, sample.y);
    }
    let x = (sample.x - mx as f64) * vw as f64 / mw as f64;
    let y = (sample.y - my as f64) * vh as f64 / mh as f64;
    (x, y)
}

// ── Generador ASS ─────────────────────────────────────────────────────────

fn ass_time(ms: u64) -> String {
    let cs = (ms / 10) % 100;
    let secs = ms / 1000;
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = secs / 3600;
    format!("{h}:{m:02}:{s:02}.{cs:02}")
}

/// #RRGGBB → &H00BBGGRR& (alpha 00 = opaco).
fn ass_color(hex: &str) -> String {
    let h = hex.trim_start_matches('#');
    let r = u8::from_str_radix(h.get(0..2).unwrap_or("ff"), 16).unwrap_or(255);
    let g = u8::from_str_radix(h.get(2..4).unwrap_or("ff"), 16).unwrap_or(255);
    let b = u8::from_str_radix(h.get(4..6).unwrap_or("ff"), 16).unwrap_or(255);
    format!("&H00{b:02X}{g:02X}{r:02X}&")
}

/// Tinta + contorno que contrastan para que el cursor se lea sobre cualquier fondo.
fn colors_for(color: &str) -> (String, String) {
    let (ink, edge) = match color {
        "negro" => ("#16161A", "#FFFFFF"),
        "amarillo" => ("#FFD400", "#16161A"),
        "verde" => ("#22C55E", "#0B1220"),
        _ => ("#FFFFFF", "#16161A"),
    };
    (ass_color(ink), ass_color(edge))
}

fn fmt_f(v: f64) -> String {
    let s = format!("{v:.2}");
    let t = s.trim_end_matches('0').trim_end_matches('.');
    if t.is_empty() || t == "-" {
        "0".to_owned()
    } else {
        t.to_owned()
    }
}

/// Círculo por 4 cúbicas (kappa ≈ 0.5523). `reversed` invierte el winding
/// para que, combinado con el círculo exterior, quede un anillo con hueco.
fn circle_path(cx: f64, cy: f64, r: f64, reversed: bool) -> String {
    const K: f64 = 0.5523;
    let k = r * K;
    // 4 cúbicas; cada tupla es (c1, c2, fin). `reversed` da vuelta el winding.
    let pts: [(f64, f64); 12] = if reversed {
        [
            (cx + r, cy - k),
            (cx + k, cy - r),
            (cx, cy - r),
            (cx - k, cy - r),
            (cx - r, cy - k),
            (cx - r, cy),
            (cx - r, cy + k),
            (cx - k, cy + r),
            (cx, cy + r),
            (cx + k, cy + r),
            (cx + r, cy + k),
            (cx + r, cy),
        ]
    } else {
        [
            (cx + r, cy + k),
            (cx + k, cy + r),
            (cx, cy + r),
            (cx - k, cy + r),
            (cx - r, cy + k),
            (cx - r, cy),
            (cx - r, cy - k),
            (cx - k, cy - r),
            (cx, cy - r),
            (cx + k, cy - r),
            (cx + r, cy - k),
            (cx + r, cy),
        ]
    };
    let start = if reversed { (cx - r, cy) } else { (cx + r, cy) };
    let mut d = format!("m {} {}", fmt_f(start.0), fmt_f(start.1));
    for chunk in pts.chunks(3) {
        d.push_str(&format!(
            " c {} {} {} {} {} {}",
            fmt_f(chunk[0].0),
            fmt_f(chunk[0].1),
            fmt_f(chunk[1].0),
            fmt_f(chunk[1].1),
            fmt_f(chunk[2].0),
            fmt_f(chunk[2].1),
        ));
    }
    d
}

/// k = factor de escala del dibujo (base ~24 px de alto, como un cursor real).
fn shape_drawing(style: &str, scale: f64) -> String {
    let k = scale * 26.0 / 24.0;
    match style {
        "punto" => {
            // Anillo (outer CW + inner CCW = hueco) + punto central sólido
            // en el mismo path: dos subpaths con winding opuesto.
            let outer = circle_path(0.0, 0.0, 10.0 * k, false);
            let inner = circle_path(0.0, 0.0, 5.5 * k, true);
            let dot = circle_path(0.0, 0.0, 2.6 * k, false);
            format!("{outer}{inner}{dot}")
        }
        "cruz" => {
            // Cruz de mira: dos rectángulos que se cruzan en el centro.
            let a = 12.0 * k;
            let t = 1.6 * k;
            let rect = |hx: f64, hy: f64| {
                format!(
                    "m {} {} l {} {} l {} {} l {} {}",
                    fmt_f(-hx), fmt_f(-hy), fmt_f(hx), fmt_f(-hy),
                    fmt_f(hx), fmt_f(hy), fmt_f(-hx), fmt_f(hy),
                )
            };
            format!("{}{}", rect(a, t), rect(t, a))
        }
        "cheia" | "3d" => {
            // Flechas gruesa y 3D de `cursor_estilos.js` de AlaukCut:
            // mismos vértices normalizados (punta en el origen, escala
            // 0.9 respecto de la caja de 32 px del original).
            let p: &[(f64, f64)] = if style == "cheia" {
                &[
                    (0.0, 0.0),
                    (0.0, 20.25),
                    (7.47, 15.30),
                    (15.75, 13.23),
                ]
            } else {
                &[
                    (0.0, 0.0),
                    (0.0, 20.10),
                    (4.32, 14.31),
                    (7.38, 21.06),
                    (11.25, 19.35),
                    (8.19, 12.78),
                    (14.31, 12.42),
                ]
            };
            let mut d = format!("m {} {}", fmt_f(p[0].0 * k), fmt_f(p[0].1 * k));
            for (x, y) in &p[1..] {
                d.push_str(&format!(" l {} {}", fmt_f(x * k), fmt_f(y * k)));
            }
            d.push_str(" l 0 0");
            d
        }
        _ => {
            // Flecha: punta en (0,0), cola hacia abajo-derecha. Polígono
            // simple listo para fill.
            let p: [(f64, f64); 8] = [
                (0.0, 0.0),
                (0.0, 19.0),
                (5.5, 14.0),
                (9.0, 21.5),
                (12.5, 19.5),
                (8.7, 12.5),
                (16.0, 12.5),
                (16.0, 9.8),
            ];
            let mut d = format!("m {} {}", fmt_f(p[0].0 * k), fmt_f(p[0].1 * k));
            for (x, y) in &p[1..] {
                d.push_str(&format!(" l {} {}", fmt_f(x * k), fmt_f(y * k)));
            }
            d.push_str(" l 0 0");
            d
        }
    }
}

/// Anillo de click: círculo con hueco central que crece y se desvanece.
fn ripple_drawing(scale: f64, strength: f64) -> String {
    let k = scale * 26.0 / 24.0 * strength;
    let outer = circle_path(0.0, 0.0, 14.0 * k, false);
    let inner = circle_path(0.0, 0.0, 9.0 * k, true);
    format!("{outer}{inner}")
}

/// Reducimos muestras a keyframes: nuevo punto si se movió >=3 px o pasaron
/// >=80 ms. Mantiene el cursor suave sin inflar el .ass.
fn keyframes(samples: &[CursorSample], map: (i32, i32, i32, i32), vw: u32, vh: u32) -> Vec<(u64, f64, f64)> {
    let mut out: Vec<(u64, f64, f64)> = Vec::new();
    for s in samples {
        let (x, y) = to_video_xy(s, map, vw, vh);
        let (cx, cy) = (
            x.clamp(0.0, vw.saturating_sub(1) as f64),
            y.clamp(0.0, vh.saturating_sub(1) as f64),
        );
        match out.last() {
            Some(&(lt, lx, ly)) => {
                let dx = cx - lx;
                let dy = cy - ly;
                if dx * dx + dy * dy >= 9.0 || s.t_ms.saturating_sub(lt) >= 80 {
                    out.push((s.t_ms, cx, cy));
                }
            }
            None => out.push((s.t_ms, cx, cy)),
        }
    }
    out
}

/// Genera el contenido .ass completo. `map` = rect del escritorio que cubre
/// el vídeo (para desktop: virtual_screen()). Devuelve "" si no hay muestras.
pub fn generate_cursor_ass(
    samples: &[CursorSample],
    spec: &CursorOverlaySpec,
    vw: u32,
    vh: u32,
    map: (i32, i32, i32, i32),
    total_ms: u64,
) -> String {
    if samples.is_empty() || vw == 0 || vh == 0 {
        return String::new();
    }
    let (primary, outline) = colors_for(&spec.color);
    let shape = shape_drawing(&spec.style, spec.scale);
    let kf = keyframes(samples, map, vw, vh);

    let mut out = String::new();
    out.push_str("[Script Info]\n");
    out.push_str("Title: Olyvia cursor overlay\n");
    out.push_str("ScriptType: v4.00+\n");
    out.push_str(&format!("PlayResX: {vw}\nPlayResY: {vh}\n"));
    out.push_str("ScaledBorderAndShadow: yes\n\n");
    out.push_str("[V4+ Styles]\n");
    out.push_str("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");
    out.push_str(&format!(
        "Style: Cursor,Arial,0,{primary},&H000000FF,{outline},&H96000000,0,0,0,0,100,100,0,0,1,2.5,0,7,0,0,0,1\n\n"
    ));
    out.push_str("[Events]\n");
    out.push_str("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");

    // Eventos de movimiento: un Dialogue por tramo keyframe→keyframe.
    for (i, &(t0, x0, y0)) in kf.iter().enumerate() {
        let (t1, x1, y1) = kf.get(i + 1).copied().unwrap_or((total_ms, x0, y0));
        let end = t1.max(t0 + 10);
        if end <= t0 {
            continue;
        }
        let dur_cs = ((end - t0) / 10).max(1);
        let text = if i + 1 < kf.len() {
            format!(
                "{{\\pos({}, {})\\move({}, {}, {}, {}, {})\\p1}}{shape}",
                fmt_f(x0),
                fmt_f(y0),
                fmt_f(x0),
                fmt_f(y0),
                fmt_f(x1),
                fmt_f(y1),
                dur_cs,
            )
        } else {
            format!("{{\\pos({}, {})\\p1}}{shape}", fmt_f(x0), fmt_f(y0))
        };
        out.push_str(&format!(
            "Dialogue: 0,{}, {},Cursor,,0,0,0,,{}\n",
            ass_time(t0),
            ass_time(end),
            text
        ));
    }

    // Anillos de click.
    if spec.ripple {
        for s in samples {
            let Some(kind) = s.click else { continue };
            let (x, y) = to_video_xy(s, map, vw, vh);
            let strength = match kind {
                ClickKind::Izquierdo => 1.0,
                ClickKind::Derecho => 0.8,
                ClickKind::Central => 0.9,
            };
            let ring = ripple_drawing(spec.scale, strength);
            let t_end = (s.t_ms + 450).min(total_ms.max(s.t_ms + 450));
            out.push_str(&format!(
                "Dialogue: 1,{}, {},Cursor,,0,0,0,,{{\\pos({}, {})\\an5\\p1\\fad(0,350)\\t(0,350,\\fscx130\\fscy130)}}{}\n",
                ass_time(s.t_ms),
                ass_time(t_end),
                fmt_f(x.clamp(0.0, vw.saturating_sub(1) as f64)),
                fmt_f(y.clamp(0.0, vh.saturating_sub(1) as f64)),
                ring
            ));
        }
    }

    out
}

/// Escape del path para el filtro `ass=filename=...`: '/' en vez de '\\',
/// ':' escapado y comillas simples protegidas.
pub fn ass_filter_arg(path: &std::path::Path) -> String {
    let mut v = path.to_string_lossy().replace('\\', "/");
    v = v.replace(':', "\\:");
    v = v.replace('\'', "\\'");
    format!("ass=filename='{v}'")
}

#[cfg(test)]
#[path = "cursor_overlay.tests.rs"]
mod tests;
