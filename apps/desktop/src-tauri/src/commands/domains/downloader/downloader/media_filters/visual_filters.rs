#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HdrTransfer {
    /// PQ / HDR10 (`smpte2084`).
    Pq,
    /// Hybrid Log-Gamma (`arib-std-b67`), habitual en iPhone y YouTube HDR.
    Hlg,
}

impl HdrTransfer {
    pub(crate) fn color_trc(self) -> &'static str {
        match self {
            HdrTransfer::Pq => "smpte2084",
            HdrTransfer::Hlg => "arib-std-b67",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct ColorProbe {
    pub transfer: Option<HdrTransfer>,
    pub ten_bit: bool,
}

impl ColorProbe {
    pub(crate) fn is_hdr(self) -> bool {
        self.transfer.is_some()
    }
}

pub(crate) const HDR_TONEMAP: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

fn probe_color(ffprobe: Option<&Path>, path: &Path) -> ColorProbe {
    let Some(ffprobe) = ffprobe else {
        return ColorProbe::default();
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=pix_fmt,color_transfer,color_primaries,color_space",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return ColorProbe::default();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return ColorProbe::default();
    };
    let Some(stream) = value["streams"]
        .as_array()
        .and_then(|streams| streams.first())
    else {
        return ColorProbe::default();
    };
    let transfer = match stream["color_transfer"].as_str().unwrap_or("") {
        "smpte2084" => Some(HdrTransfer::Pq),
        "arib-std-b67" => Some(HdrTransfer::Hlg),
        _ => None,
    };
    let pix_fmt = stream["pix_fmt"].as_str().unwrap_or("");
    ColorProbe {
        transfer,
        ten_bit: pix_fmt.contains("10") || pix_fmt.contains("12"),
    }
}

pub(crate) type ProgressSink<'a> = &'a dyn Fn(&str, Option<f64>, &str);

/// Rectángulo de `delogo` calculado sobre las dimensiones reales del archivo.
/// FFmpeg no acepta `main_w`/`main_h` dentro de `x`/`y` en `delogo`, así que se
/// resuelve en Rust una sola vez por video antes de armar el filtergraph.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DelogoRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelogoManualRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct UpscalePlan {
    pub width: u32,
    pub height: u32,
}

/// Normaliza las esquinas aceptadas por la UI y por la API.
pub(crate) fn delogo_corner(value: Option<&str>) -> Result<&'static str, String> {
    let key = value
        .unwrap_or("top-right")
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");
    match key.as_str() {
        "top-right" | "derecha-arriba" | "superior-derecha" => Ok("top-right"),
        "top-left" | "izquierda-arriba" | "superior-izquierda" => Ok("top-left"),
        "bottom-right" | "derecha-abajo" | "inferior-derecha" => Ok("bottom-right"),
        "bottom-left" | "izquierda-abajo" | "inferior-izquierda" => Ok("bottom-left"),
        _ => Err("La esquina del logo no es válida.".to_owned()),
    }
}

/// Parche proporcional inspirado en `x=main_w-160:y=20:w=140:h=50` para
/// 1920×1080: 140×50 con margen 20. Escala con el canvas y se mantiene dentro
/// del cuadro incluso en resoluciones chicas.
pub(crate) fn delogo_rect(width: u32, height: u32, corner: &str) -> Option<DelogoRect> {
    if width < 64 || height < 64 {
        return None;
    }
    let margin_x = ((width as f64) * (20.0 / 1920.0)).round().max(6.0) as u32;
    let margin_y = ((height as f64) * (20.0 / 1080.0)).round().max(6.0) as u32;
    let max_w = width.saturating_sub(margin_x.saturating_mul(2));
    let max_h = height.saturating_sub(margin_y.saturating_mul(2));
    if max_w < 16 || max_h < 16 {
        return None;
    }
    let w = (((width as f64) * (140.0 / 1920.0)).round() as u32).clamp(16, max_w);
    let h = (((height as f64) * (50.0 / 1080.0)).round() as u32).clamp(16, max_h);
    let (x, y) = match corner {
        "top-left" => (margin_x, margin_y),
        "bottom-left" => (margin_x, height - h - margin_y),
        "bottom-right" => (width - w - margin_x, height - h - margin_y),
        _ => (width - w - margin_x, margin_y),
    };
    Some(DelogoRect { x, y, w, h })
}

pub(crate) fn manual_delogo_rect(
    width: u32,
    height: u32,
    rect: DelogoManualRect,
) -> Option<DelogoRect> {
    if width < 16 || height < 16 {
        return None;
    }
    if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.w.is_finite()
        || !rect.h.is_finite()
        || rect.x < 0.0
        || rect.y < 0.0
        || rect.w <= 0.0
        || rect.h <= 0.0
        || rect.x + rect.w > 1.0001
        || rect.y + rect.h > 1.0001
    {
        return None;
    }
    let x = (rect.x * width as f64).round().max(0.0) as u32;
    let y = (rect.y * height as f64).round().max(0.0) as u32;
    let w = (rect.w * width as f64).round().max(8.0) as u32;
    let h = (rect.h * height as f64).round().max(8.0) as u32;
    let w = w.min(width.saturating_sub(x));
    let h = h.min(height.saturating_sub(y));
    (w >= 8 && h >= 8).then_some(DelogoRect { x, y, w, h })
}

/// Objetivo Lanczos. Mantiene la orientación del origen (un vertical va a
/// 1080×1920 y no se achica dentro de un canvas horizontal) y nunca reduce.
pub(crate) fn upscale_target(
    width: u32,
    height: u32,
    long_video: bool,
    mode: &str,
) -> Option<UpscalePlan> {
    if width == 0 || height == 0 {
        return None;
    }
    let (target_w, target_h) = match mode.trim().to_ascii_lowercase().as_str() {
        "1080" | "full-hd" | "fhd" => (1920, 1080),
        "2160" | "4k" | "uhd" => (3840, 2160),
        _ => {
            if long_video {
                (3840, 2160)
            } else {
                (1920, 1080)
            }
        }
    };
    let (target_w, target_h) = if height > width {
        (target_h, target_w)
    } else {
        (target_w, target_h)
    };
    if width >= target_w && height >= target_h {
        return None;
    }
    Some(UpscalePlan {
        width: target_w,
        height: target_h,
    })
}

fn spatial_effects(delogo: Option<DelogoRect>, upscale: Option<UpscalePlan>) -> String {
    let mut chain = String::new();
    if let Some(rect) = delogo {
        chain.push_str(&format!(
            "delogo=x={}:y={}:w={}:h={},",
            rect.x, rect.y, rect.w, rect.h
        ));
    }
    if let Some(plan) = upscale {
        // Se usa Lanczos en CPU porque `delogo`, `noise` y `eq` también corren
        // en CPU; `scale_cuda` exigiría hwupload/hwdownload y rompería la
        // pasada única. El encoder HEVC sí puede ser NVENC/AMF/QSV.
        chain.push_str(&format!(
            "scale={}:{}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,\
pad={}:{}:(ow-iw)/2:(oh-ih)/2:color=black,",
            plan.width, plan.height, plan.width, plan.height
        ));
    }
    chain
}

/// Zoom 4 %. Con un plan de escalado se usan dimensiones explícitas para que
/// el crop final sea exactamente 1920×1080 o 3840×2160, sin perder 2 px por el
/// redondeo par que necesita el codificador.
fn zoom_filters(focus: &str, upscale: Option<UpscalePlan>) -> String {
    let (x, y) = match focus {
        "left" => ("(iw-ow)*0.33", "(ih-oh)*0.5"),
        "right" => ("(iw-ow)*0.67", "(ih-oh)*0.5"),
        "top" => ("(iw-ow)*0.5", "(ih-oh)*0.33"),
        "bottom" => ("(iw-ow)*0.5", "(ih-oh)*0.67"),
        _ => ("(iw-ow)*0.5", "(ih-oh)*0.5"),
    };
    if let Some(plan) = upscale {
        let zoom_w = ((plan.width as f64 * 1.04) / 2.0).floor() as u32 * 2;
        let zoom_h = ((plan.height as f64 * 1.04) / 2.0).floor() as u32 * 2;
        format!(
            "scale={zoom_w}:{zoom_h},crop={}:{}:{x}:{y},",
            plan.width, plan.height
        )
    } else {
        format!(
            "scale=trunc(iw*1.04/2)*2:trunc(ih*1.04/2)*2,\
crop=trunc(iw/1.04/2)*2:trunc(ih/1.04/2)*2:{x}:{y},"
        )
    }
}

/// Cadena del look cinematográfico. Es pura para testear el orden y el foco.
/// El flujo óptico va después de estirar el tiempo para que el resultado sea
/// 60 fps reales y no 58,8 fps disfrazados.
#[cfg(test)]
pub(crate) fn cinematic_filter(focus: &str) -> String {
    cinematic_filter_with(focus, None, None)
}

pub(crate) fn cinematic_filter_with(
    focus: &str,
    delogo: Option<DelogoRect>,
    upscale: Option<UpscalePlan>,
) -> String {
    let effects = spatial_effects(delogo, upscale);
    let zoom = zoom_filters(focus, upscale);
    format!(
        "[0:v]{effects}setpts=PTS/0.98,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:vsbmc=1,\
eq=gamma=0.95:contrast=1.08:saturation=1.12,{zoom}\
hflip,noise=alls=8:allf=t+u,format=yuv420p[v]"
    )
}

pub(crate) fn cinematic_focus(value: Option<&str>) -> Result<&'static str, String> {
    match value
        .unwrap_or("center")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "center" | "centro" => Ok("center"),
        "left" | "izquierda" => Ok("left"),
        "right" | "derecha" => Ok("right"),
        "top" | "arriba" => Ok("top"),
        "bottom" | "abajo" => Ok("bottom"),
        _ => Err("El foco del reencuadre no es válido.".to_owned()),
    }
}

#[cfg(test)]
pub(crate) fn pipeline_filter(focus: &str) -> String {
    pipeline_filter_with(focus, None, None)
}

pub(crate) fn pipeline_filter_with(
    focus: &str,
    delogo: Option<DelogoRect>,
    upscale: Option<UpscalePlan>,
) -> String {
    // Denoise espacial+temporal antes del flujo óptico: si se aplicara después,
    // el grano sintético también se suavizaría. El `replacen` deja el orden
    // hqdn3d -> delogo -> Lanczos -> look.
    cinematic_filter_with(focus, delogo, upscale).replacen(
        "[0:v]",
        "[0:v]hqdn3d=1.86:1.39:2.80:2.15,",
        1,
    )
}
