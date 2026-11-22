//! Motor de texto profesional (`filmcraft-text`): shaping OpenType
//! (harfrust), bidi, corte de líneas UAX#14, fuentes bundled OFL (Inter,
//! JetBrains Mono, Noto Serif) + fuentes del sistema, y rasterizado propio
//! con máscaras de cobertura. La IA puede listar fuentes y **renderizar un
//! título a PNG** para verificarlo visualmente antes de aplicarlo.

use std::sync::Once;

use filmcraft_text::{layout, render};
use serde::Serialize;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_CANVAS: u32 = 8192;
const MAX_FONT_SIZE: f32 = 512.0;
const MIN_FONT_SIZE: f32 = 8.0;

static FONT_SCAN: Once = Once::new();

/// Escanea las fuentes del sistema una sola vez (idempotente y thread-safe
/// dentro del crate). Las bundled están siempre registradas.
fn ensure_fonts_scanned() {
    FONT_SCAN.call_once(|| {
        filmcraft_text::fonts::scan_system();
    });
}

/// Familia con sus estilos disponibles.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFontFamily {
    pub family: String,
    pub styles: Vec<String>,
}

/// Familias de fuentes disponibles (bundled + sistema), ordenadas.
#[tauri::command]
pub fn text_fonts_list() -> Vec<TextFontFamily> {
    ensure_fonts_scanned();
    filmcraft_text::fonts::families()
        .into_iter()
        .map(|(family, styles)| TextFontFamily { family, styles })
        .collect()
}

/// Request de renderizado de texto a PNG.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRenderRequest {
    pub text: String,
    /// Ruta .png de salida.
    pub output: String,
    /// Tamaño en px (8–512, default 64).
    #[serde(default)]
    pub font_size: Option<f32>,
    /// Familia (default "Inter"; ver `text_fonts_list`).
    #[serde(default)]
    pub family: Option<String>,
    /// Estilo ("Regular", "Bold", "Italic"…; default "Regular").
    #[serde(default)]
    pub style: Option<String>,
    /// Alineación de párrafo: left|center|right (default left).
    #[serde(default)]
    pub align: Option<String>,
    /// Ancho de wrap en px (None = point text sin wrap).
    #[serde(default)]
    pub wrap_width: Option<f32>,
    /// Interlineado extra en px.
    #[serde(default)]
    pub leading: Option<f32>,
    /// Canvas opcional: si se da, el bloque de texto se centra en él.
    /// Sin canvas la salida es el recorte ajustado al texto.
    #[serde(default)]
    pub canvas_width: Option<u32>,
    #[serde(default)]
    pub canvas_height: Option<u32>,
    /// Color "#RRGGBB" (default blanco).
    #[serde(default)]
    pub color: Option<String>,
}

/// Resultado del render: path + geometría real del layout.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRenderResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub lines: usize,
    /// Bounds del texto dentro del canvas [x, y, w, h].
    pub text_bounds: [f32; 4],
}

fn parse_color(input: &str) -> Option<(u8, u8, u8)> {
    let hex = input.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let v = u32::from_str_radix(hex, 16).ok()?;
    Some(((v >> 16) as u8, ((v >> 8) & 0xff) as u8, (v & 0xff) as u8))
}

/// Renderiza texto a PNG con el motor filmcraft-text. La máscara de
/// cobertura se compone sobre transparente (alpha = cobertura) con el
/// color pedido — sirve como preview verificable por `analyze_images`.
#[tauri::command]
pub async fn text_render_preview(
    state: State<'_, AppState>,
    request: TextRenderRequest,
) -> Result<TextRenderResult, ProjectError> {
    let _ = &state;
    let text = request.text.trim().to_string();
    if text.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el texto a renderizar está vacío",
        ));
    }
    if text.len() > 64 * 1024 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el texto supera 64 KB",
        ));
    }
    let dest = crate::commands::audio_tools::output_file(&request.output)?;
    if !dest.to_string_lossy().to_lowercase().ends_with(".png") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el preview de texto debe escribirse en un archivo .png",
        ));
    }
    let font_size = request
        .font_size
        .unwrap_or(64.0)
        .clamp(MIN_FONT_SIZE, MAX_FONT_SIZE);
    let family = request
        .family
        .filter(|f| !f.trim().is_empty())
        .unwrap_or_else(|| "Inter".to_string());
    let style = request
        .style
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Regular".to_string());
    let align = match request.align.as_deref().map(str::to_lowercase).as_deref() {
        Some("center") => filmcraft_text::Align::Center,
        Some("right") => filmcraft_text::Align::Right,
        _ => filmcraft_text::Align::Left,
    };
    let wrap_width = request
        .wrap_width
        .filter(|w| w.is_finite() && *w > 0.0)
        .map(|w| w.min(16384.0));
    let leading = request
        .leading
        .filter(|l| l.is_finite())
        .map(|l| l.clamp(-512.0, 512.0))
        .unwrap_or(0.0);
    let color = match request.color.as_deref() {
        Some(c) => parse_color(c).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "color inválido: usar #RRGGBB",
            )
        })?,
        None => (255, 255, 255),
    };
    let canvas_w = request.canvas_width.unwrap_or(0).min(MAX_CANVAS);
    let canvas_h = request.canvas_height.unwrap_or(0).min(MAX_CANVAS);
    if (canvas_w == 0) != (canvas_h == 0) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "canvas_width y canvas_height deben darse juntos (o ninguno)",
        ));
    }

    let style_cfg = filmcraft_text::TextStyle {
        family,
        style,
        size: font_size,
        ..Default::default()
    };
    let para_cfg = filmcraft_text::ParagraphStyle {
        align,
        width: wrap_width,
        leading,
        ..Default::default()
    };

    let result = tokio::task::spawn_blocking(move || {
        ensure_fonts_scanned();
        let layout = layout::layout(&text, &style_cfg, &para_cfg);
        let line_count = layout.lines.len();
        let bounds = render::device_bounds(&layout, &render::at(0.0, 0.0));
        let (mask, mask_x, mask_y) = render::rasterize(&layout, &render::at(0.0, 0.0));

        let (cw, ch) = if canvas_w > 0 && canvas_h > 0 {
            (canvas_w as usize, canvas_h as usize)
        } else {
            (mask.w.max(1), mask.h.max(1))
        };
        // Centro del bloque de texto en coordenadas de dispositivo.
        let text_cx = mask_x as f32 + mask.w as f32 * 0.5;
        let text_cy = mask_y as f32 + mask.h as f32 * 0.5;
        let origin_x = (cw as f32 * 0.5 - text_cx).round() as i64;
        let origin_y = (ch as f32 * 0.5 - text_cy).round() as i64;

        let mut rgba = vec![0u8; cw.saturating_mul(ch).saturating_mul(4)];
        for y in 0..mask.h {
            let dy = origin_y + y as i64;
            if dy < 0 || dy >= ch as i64 {
                continue;
            }
            for x in 0..mask.w {
                let dx = origin_x + x as i64;
                if dx < 0 || dx >= cw as i64 {
                    continue;
                }
                let coverage = mask.get(x, y);
                if coverage <= 0.0 {
                    continue;
                }
                let idx = ((dy as usize) * cw + dx as usize) * 4;
                let a = (coverage.clamp(0.0, 1.0) * 255.0).round() as u8;
                rgba[idx] = color.0;
                rgba[idx + 1] = color.1;
                rgba[idx + 2] = color.2;
                rgba[idx + 3] = a;
            }
        }
        let img = image::RgbaImage::from_raw(cw as u32, ch as u32, rgba)
            .ok_or_else(|| "canvas demasiado grande".to_string())?;
        let mut png = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png)
            .map_err(|e| format!("no se pudo codificar el PNG: {e}"))?;
        Ok::<(Vec<u8>, usize, u32, u32, [f32; 4]), String>((
            png.into_inner(),
            line_count,
            cw as u32,
            ch as u32,
            [
                bounds[0],
                bounds[1],
                (bounds[2] - bounds[0]).max(0.0),
                (bounds[3] - bounds[1]).max(0.0),
            ],
        ))
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::RenderFailed, "el render de texto falló"))?
    .map_err(|e| ProjectError::message(ProjectErrorCode::RenderFailed, &e))?;

    let (png, lines, w, h, text_bounds) = result;
    std::fs::write(&dest, png).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo escribir el PNG de texto: {e}"),
        )
    })?;
    Ok(TextRenderResult {
        path: dest.to_string_lossy().to_string(),
        width: w,
        height: h,
        lines,
        text_bounds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fonts_list_has_bundled_families() {
        let families = text_fonts_list();
        assert!(families.iter().any(|f| f.family == "Inter"));
        assert!(families.iter().any(|f| f.family == "JetBrains Mono"));
    }

    #[test]
    fn parse_color_accepts_hex() {
        assert_eq!(parse_color("#FF8800"), Some((255, 136, 0)));
        assert_eq!(parse_color("00ff00"), Some((0, 255, 0)));
        assert_eq!(parse_color("red"), None);
        assert_eq!(parse_color("#12345"), None);
    }

    #[test]
    fn layout_and_rasterize_produce_ink() {
        ensure_fonts_scanned();
        let st = filmcraft_text::TextStyle {
            family: "Inter".into(),
            style: "Bold".into(),
            size: 64.0,
            ..Default::default()
        };
        let ps = filmcraft_text::ParagraphStyle {
            align: filmcraft_text::Align::Center,
            width: Some(800.0),
            ..Default::default()
        };
        let l = layout::layout("Hola Olyvia\nSegunda línea", &st, &ps);
        assert_eq!(l.lines.len(), 2);
        let (mask, _, _) = render::rasterize(&l, &render::at(0.0, 0.0));
        let ink: f32 = mask.a.iter().sum();
        assert!(ink > 100.0, "la máscara debería tener tinta, ink={ink}");
    }
}
