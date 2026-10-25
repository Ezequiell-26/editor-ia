//! The FFmpeg render pipeline.
//!
//! The timeline is turned into one filter graph: a background canvas, every
//! visible visual clip composited in track order, every audible clip mixed and
//! delayed, and the project captions burned through libass. The output is only
//! reported as completed after FFprobe verifies its existence, size, duration
//! and resolution.
//!
//! There is no shell: FFmpeg is spawned with an argument vector built here,
//! from validated project values and project-relative media paths.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use serde::Serialize;
use serde_json::Value;

use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::subtitles::{build_ass, CaptionInput};

#[derive(Debug, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub crf: Option<u8>,
    pub target_bps: Option<u64>,
    pub video_preset: String,
    pub fit: String,
    pub audio_bps: u32,
    pub video_codec: String,
    pub audio_codec: String,
    pub container: String,
    pub audio_rate: u32,
    pub audio_channels: u32,
    pub min_output_bytes: u64,
    pub duration_tolerance_frames: u32,
    pub hardware_encoder: Option<String>,
}

const HARDWARE_H264: [&str; 3] = ["h264_amf", "h264_nvenc", "h264_qsv"];
const HARDWARE_HEVC: [&str; 3] = ["hevc_amf", "hevc_nvenc", "hevc_qsv"];

fn validate_hardware_encoder(
    video_codec: &str,
    encoder: &str,
    width: u32,
    height: u32,
) -> Result<(), ProjectError> {
    let supported = if video_codec == "h265" {
        HARDWARE_HEVC.contains(&encoder)
    } else {
        HARDWARE_H264.contains(&encoder)
    };
    if !supported {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el encoder de hardware no coincide con el códec del perfil",
        ));
    }
    // Los encoders de hardware tienen límites más chicos que libx264/libx265.
    let max_side = if video_codec == "h265" { 8192 } else { 4096 };
    if width > max_side || height > max_side {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ese encoder de hardware no admite esta resolución; exportá con software",
        ));
    }
    Ok(())
}

impl Profile {
    pub fn fps(&self) -> f64 {
        if self.fps_den == 0 {
            30.0
        } else {
            self.fps_num as f64 / self.fps_den as f64
        }
    }

    fn fps_arg(&self) -> String {
        format!("{}/{}", self.fps_num.max(1), self.fps_den.max(1))
    }
}

#[derive(Debug, Clone)]
pub struct RenderPlan {
    pub args: Vec<String>,
    pub output_path: PathBuf,
    pub working_dir: PathBuf,
    pub duration_seconds: f64,
    pub min_output_bytes: u64,
    pub duration_tolerance_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub profile_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProgress {
    pub percent: f64,
    pub processed_seconds: f64,
    pub total_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderVerification {
    pub output_bytes: u64,
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

pub fn parse_profile(value: &Value) -> Result<Profile, ProjectError> {
    let width = value["resolution"]["width"].as_u64().unwrap_or(0);
    let height = value["resolution"]["height"].as_u64().unwrap_or(0);
    let fps_num = value["frameRate"]["num"].as_u64().unwrap_or(0) as u32;
    let fps_den = value["frameRate"]["den"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 || fps_num == 0 || fps_den == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el perfil de render no declara resolución y tasa de cuadros válidas",
        ));
    }
    let container = text(value, "container").unwrap_or("mp4").to_owned();
    let video_codec = text(value, "videoCodec").unwrap_or("h264").to_owned();
    let audio_codec = text(value, "audioCodec").unwrap_or("aac").to_owned();
    if container != "mp4" && container != "mov" {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "esta versión exporta MP4/MOV; el perfil pide otro contenedor",
        ));
    }
    if video_codec != "h264" && video_codec != "h265" {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "esta versión exporta H.264/H.265; el perfil pide otro códec",
        ));
    }
    // libx264 rechaza anchos/altos de más de 16 384; libx265 sí acepta 32K.
    // Se avisa antes de lanzar FFmpeg para no perder el render.
    if video_codec == "h264" && (width > 16_384 || height > 16_384) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "H.264 no admite más de 16 384 px por lado; para 32K elegí H.265",
        ));
    }
    if audio_codec != "aac" {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "esta versión exporta audio AAC; el perfil pide otro códec",
        ));
    }
    let bitrate_mode = value["bitrate"]["mode"].as_str().unwrap_or("crf");
    let crf = (bitrate_mode == "crf")
        .then(|| {
            value["bitrate"]["crf"]
                .as_u64()
                .map(|value| value.clamp(0, 51) as u8)
        })
        .flatten()
        .or_else(|| (bitrate_mode != "target").then_some(20));
    let target_bps = (bitrate_mode == "target")
        .then(|| value["bitrate"]["videoBitsPerSecond"].as_u64())
        .flatten();
    const PRESETS: [&str; 8] = [
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
    ];
    let requested_preset = text(value, "videoPreset").unwrap_or("veryfast");
    if !PRESETS.contains(&requested_preset) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el perfil pide un preset de encoder desconocido",
        ));
    }
    let fit = text(value, "fit").unwrap_or("contain");
    if fit != "contain" && fit != "cover" {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el perfil pide un encuadre desconocido",
        ));
    }
    let hardware_encoder = text(value, "hardwareEncoder").map(str::to_owned);
    if let Some(encoder) = hardware_encoder.as_deref() {
        validate_hardware_encoder(&video_codec, encoder, width as u32, height as u32)?;
    }
    Ok(Profile {
        id: text(value, "id").unwrap_or_default().to_owned(),
        name: text(value, "name").unwrap_or("Render").to_owned(),
        width: width as u32,
        height: height as u32,
        fps_num,
        fps_den,
        crf,
        target_bps,
        video_preset: requested_preset.to_owned(),
        fit: fit.to_owned(),
        audio_bps: value["audioBitsPerSecond"]
            .as_u64()
            .unwrap_or(128_000)
            .clamp(16_000, 512_000) as u32,
        video_codec,
        audio_codec,
        container,
        audio_rate: value["audioSampleRate"].as_u64().unwrap_or(48_000) as u32,
        audio_channels: value["audioChannels"].as_u64().unwrap_or(2).clamp(1, 8) as u32,
        min_output_bytes: value["qualityGate"]["minOutputBytes"]
            .as_u64()
            .unwrap_or(100_000),
        duration_tolerance_frames: value["qualityGate"]["durationToleranceFrames"]
            .as_u64()
            .unwrap_or(10) as u32,
        hardware_encoder,
    })
}

fn hardware_encoder_args(profile: &Profile) -> Option<Vec<String>> {
    let encoder = profile.hardware_encoder.as_deref()?;
    let quality = profile.crf.unwrap_or(20).clamp(0, 51).to_string();
    let mut args = vec!["-c:v".to_owned(), encoder.to_owned()];
    if let Some(bps) = profile.target_bps {
        args.extend(["-b:v".to_owned(), bps.to_string()]);
    } else if encoder.ends_with("_amf") {
        args.extend([
            "-rc".to_owned(),
            "cqp".to_owned(),
            "-qp_i".to_owned(),
            quality.clone(),
            "-qp_p".to_owned(),
            quality,
            "-quality".to_owned(),
            "quality".to_owned(),
        ]);
    } else if encoder.ends_with("_nvenc") {
        args.extend([
            "-rc".to_owned(),
            "vbr".to_owned(),
            "-cq".to_owned(),
            quality,
            "-b:v".to_owned(),
            "0".to_owned(),
            "-preset".to_owned(),
            "p5".to_owned(),
        ]);
    } else if encoder.ends_with("_qsv") {
        args.extend(["-global_quality".to_owned(), quality]);
    }
    Some(args)
}

fn seconds(value: f64) -> String {
    format!("{:.6}", value.max(0.0))
}

fn hex_color(raw: &str) -> String {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|character| character.is_ascii_hexdigit()) {
        format!("0x{}", hex)
    } else {
        "0x0f1319".to_owned()
    }
}

fn has_audio_stream(ffprobe: &Path, path: &Path) -> bool {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .output()
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false)
}

fn sanitize_filter_number(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-100_000.0, 100_000.0)
    } else {
        0.0
    }
}

/// Piecewise-linear FFmpeg expression for one keyframed property.
///
/// `time_var` is the expression that yields seconds relative to the clip
/// (`t` for filters that see the clip after `setpts`, `(t-start)` for overlay
/// coordinates). Values clamp to the first/last keyframe outside the range.
fn keyframe_expression(
    keyframes: &[Value],
    property: &str,
    fps: f64,
    time_var: &str,
) -> Option<String> {
    let rate = fps.max(1.0);
    let mut samples: Vec<(f64, f64, String)> = keyframes
        .iter()
        .filter_map(|keyframe| {
            let frame = keyframe["frame"].as_f64()?;
            let value = keyframe[property].as_f64().map(sanitize_filter_number)?;
            let easing = keyframe["easing"]
                .as_str()
                .filter(|value| {
                    matches!(
                        *value,
                        "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold"
                    )
                })
                .unwrap_or("linear")
                .to_owned();
            Some((frame / rate, value, easing))
        })
        .collect();
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(|a, b| a.0.total_cmp(&b.0));
    if samples.len() == 1 {
        return Some(format!("{:.4}", samples[0].1));
    }
    let last = samples.last()?;
    let mut expression = format!("{:.4}", last.1);
    for pair in samples.windows(2).rev() {
        let (start, end) = (pair[0].clone(), pair[1].clone());
        let delta = (end.0 - start.0).max(1e-6);
        let slope = end.1 - start.1;
        let progress = format!("(({time_var})-{:.6})/{:.6}", start.0, delta);
        let eased = match start.2.as_str() {
            "ease-in" => format!("pow({progress},3)"),
            "ease-out" => format!("(1-pow(1-({progress}),3))"),
            "ease-in-out" => format!("(({progress})*({progress})*(3-2*({progress})))"),
            "hold" => "0".to_owned(),
            _ => progress,
        };
        let segment = format!("({:.4}+({:.4})*({eased}))", start.1, slope);
        expression = format!("if(lt({time_var},{:.6}),{segment},{})", end.0, expression);
    }
    let first = samples[0].clone();
    Some(format!(
        "if(lt({time_var},{:.6}),{:.4},{})",
        first.0, first.1, expression
    ))
}

fn offset_expression(clip: &Value, property: &str, start_seconds: f64, fps: f64) -> Option<String> {
    let keyframes = clip["transform"]["keyframes"].as_array()?;
    keyframe_expression(
        keyframes,
        property,
        fps,
        &format!("(t-{:.6})", start_seconds.max(0.0)),
    )
}

/// Devuelve `(base, z)` para una curva de escala cuya mínimo es >= 1. La capa
/// se centra con `pad` y `zoompan` completa la animación con `z >= 1` y salida
/// fija, sin que el overlay reciba un tamaño variable. Las curvas que bajan de
/// 1 usan `scale_dynamic_expression`, que evita el doble remuestreo.
/// Se omite con un frame congelado. La rotación, la escala estática y el
/// movimiento Ken Burns ya tienen salida fija y pueden combinarse.
fn scale_zoom_expression(
    clip: &Value,
    profile: &Profile,
    lead_seconds: f64,
) -> Option<(f64, String)> {
    if clip["scaleFrozen"].as_bool() == Some(true) {
        return None;
    }
    let transform = &clip["transform"];
    let keyframes = transform["keyframes"].as_array()?;
    if keyframes.is_empty() {
        return None;
    }
    let mut minimum = f64::INFINITY;
    let mut found = false;
    for keyframe in keyframes {
        if let Some(scale) = keyframe["scale"].as_f64() {
            if scale.is_finite() {
                minimum = minimum.min(scale);
                found = true;
            }
        }
    }
    if !found || minimum < 0.999 {
        return None;
    }
    // `on` cuenta frames ya retimados por la velocidad, así que su reloj es la
    // timeline del clip, no el tiempo de origen.
    let frame_rate = profile.fps();
    let expression = keyframe_expression(
        keyframes,
        "scale",
        profile.fps(),
        &format!(
            "((on-{:.0})/{:.6})",
            (lead_seconds * frame_rate).round(),
            frame_rate
        ),
    )?;
    Some((1.0, format!("max(1,({expression}))")))
}

/// Devuelve `(max, factor)` para una curva que baja de 1×. La capa se
/// pre-escala una vez al máximo (Lanczos) y cada frame se reduce dentro de un
/// lienzo fijo; así no se baja a 0,7 para volver a subir a 1,3, que perdía
/// nitidez. El factor es `escala/max <= 1` y `pad` centra el contenido.
fn scale_dynamic_expression(
    clip: &Value,
    profile: &Profile,
    lead_seconds: f64,
    speed_num: u32,
    speed_den: u32,
    is_image: bool,
) -> Option<(f64, String)> {
    if clip["scaleFrozen"].as_bool() == Some(true) {
        return None;
    }
    let transform = &clip["transform"];
    let keyframes = transform["keyframes"].as_array()?;
    if keyframes.is_empty() {
        return None;
    }
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    let mut found = false;
    for keyframe in keyframes {
        if let Some(scale) = keyframe["scale"].as_f64() {
            if scale.is_finite() {
                minimum = minimum.min(scale);
                maximum = maximum.max(scale);
                found = true;
            }
        }
    }
    if !found || minimum >= 0.999 || maximum <= 0.001 {
        return None;
    }
    // El `setpts` de velocidad cambia la cantidad de frames por segundo del
    // flujo; a diferencia de `zoompan`, este `scale` no lo re-muestrea, así que
    // el reloj de `n` debe usar la tasa retimada y no la fps nominal.
    let rate = if is_image {
        profile.fps()
    } else {
        profile.fps() * speed_num.max(1) as f64 / speed_den.max(1) as f64
    };
    let expression = keyframe_expression(
        keyframes,
        "scale",
        profile.fps(),
        &format!("((n-{:.0})/{:.6})", (lead_seconds * rate).round(), rate),
    )?;
    let factor = format!("max(0.001,min(1,(({expression})/{maximum:.6})))");
    Some((maximum, factor))
}

/// VP9 con alfa guarda el canal en un stream lateral que el decodificador
/// nativo de FFmpeg no expone; el de libvpx sí. Sólo se fuerza en los assets
/// marcados con `media.alpha`, para no cambiar el decoder de un WebM común.
pub(crate) fn alpha_video_decoder(asset: &Value) -> Option<&'static str> {
    if asset["media"]["alpha"].as_bool() == Some(true) {
        Some("libvpx-vp9")
    } else {
        None
    }
}

fn blend_mode_name(mode: &str) -> Option<&'static str> {
    match mode {
        "multiply" => Some("multiply"),
        "screen" => Some("screen"),
        // The base is the first blend input, so hardlight reproduces an
        // overlay with the clip on top.
        "overlay" => Some("hardlight"),
        "soft-light" => Some("softlight"),
        "darken" => Some("darken"),
        "lighten" => Some("lighten"),
        "color-dodge" => Some("dodge"),
        "color-burn" => Some("burn"),
        "hard-light" => Some("hardlight"),
        _ => None,
    }
}

fn overlay_x_expression(
    clip: &Value,
    start_seconds: f64,
    lead_seconds: f64,
    offset_x: &str,
) -> String {
    let center = format!("(W-overlay_w)/2+({offset_x})");
    let transition = clip["transitionIn"]["type"].as_str().unwrap_or("");
    if lead_seconds <= 0.001 || (transition != "slide-left" && transition != "slide-right") {
        return center;
    }
    let from = (start_seconds - lead_seconds).max(0.0);
    let direction = if transition == "slide-left" {
        "W"
    } else {
        "-W"
    };
    format!(
        "if(lt(t,{start_seconds:.6}),{center}+({direction})*(1-((t-{from:.6})/{lead_seconds:.6})),{center})"
    )
}

fn overlay_y_expression(
    clip: &Value,
    start_seconds: f64,
    lead_seconds: f64,
    offset_y: &str,
    animation_y: Option<&str>,
) -> String {
    let base = format!("(H-overlay_h)/2+({offset_y})");
    let base = match animation_y {
        Some(term) => format!("({base})+({term})"),
        None => base,
    };
    let transition = clip["transitionIn"]["type"].as_str().unwrap_or("");
    if lead_seconds <= 0.001 || (transition != "slide-up" && transition != "slide-down") {
        return base;
    }
    let from = (start_seconds - lead_seconds).max(0.0);
    // slide-up entra desde abajo y sube; slide-down entra desde arriba.
    let direction = if transition == "slide-up" { "H" } else { "-H" };
    format!(
        "if(lt(t,{start_seconds:.6}),({base})+({direction})*(1-((t-{from:.6})/{lead_seconds:.6})),({base}))"
    )
}

fn animation_duration_seconds(animation: &Value, clip_seconds: f64, fps: f64) -> Option<f64> {
    let kind = animation["type"].as_str()?.trim();
    if kind.is_empty() {
        return None;
    }
    let requested = animation["durationFrames"].as_u64().unwrap_or(15).max(1) as f64;
    let frames = requested.min((clip_seconds * fps).max(1.0));
    Some((frames / fps.max(1.0)).clamp(1.0 / fps.max(1.0), clip_seconds.max(1.0 / fps.max(1.0))))
}

/// `(progress expression, type)` for one side of a clip animation. Progress is
/// clamped to 0..1 and evaluated against the global output clock, matching the
/// overlay filter's `t`.
fn animation_progress(
    animation: &Value,
    side: &str,
    start_seconds: f64,
    clip_seconds: f64,
    fps: f64,
) -> Option<(String, String)> {
    let kind = animation["type"].as_str()?.trim().to_owned();
    if kind.is_empty() {
        return None;
    }
    let duration = animation_duration_seconds(animation, clip_seconds, fps)?;
    let from = if side == "in" {
        start_seconds
    } else {
        (start_seconds + clip_seconds - duration).max(start_seconds)
    };
    Some((format!("min(max((t-{from:.6})/{duration:.6},0),1)"), kind))
}

/// Extra overlay displacement caused by slide animations. Entrance slides move
/// towards the named direction; exit slides keep travelling the same way.
fn animation_overlay_terms(
    clip: &Value,
    start_seconds: f64,
    clip_seconds: f64,
    fps: f64,
) -> (Option<String>, Option<String>) {
    let mut x_terms: Vec<String> = Vec::new();
    let mut y_terms: Vec<String> = Vec::new();
    if let Some((progress, kind)) =
        animation_progress(&clip["animationIn"], "in", start_seconds, clip_seconds, fps)
    {
        match kind.as_str() {
            "slide-left" => x_terms.push(format!("W*(1-({progress}))")),
            "slide-right" => x_terms.push(format!("-W*(1-({progress}))")),
            "slide-up" => y_terms.push(format!("H*(1-({progress}))")),
            "slide-down" => y_terms.push(format!("-H*(1-({progress}))")),
            _ => {}
        }
    }
    if let Some((progress, kind)) = animation_progress(
        &clip["animationOut"],
        "out",
        start_seconds,
        clip_seconds,
        fps,
    ) {
        match kind.as_str() {
            "slide-left" => x_terms.push(format!("-W*({progress})")),
            "slide-right" => x_terms.push(format!("W*({progress})")),
            "slide-up" => y_terms.push(format!("-H*({progress})")),
            "slide-down" => y_terms.push(format!("H*({progress})")),
            _ => {}
        }
    }
    let join = |terms: Vec<String>| {
        if terms.is_empty() {
            None
        } else {
            Some(terms.join("+"))
        }
    };
    (join(x_terms), join(y_terms))
}

fn animation_fade_filters(
    clip: &Value,
    lead_seconds: f64,
    clip_seconds: f64,
    total_seconds: f64,
    fps: f64,
) -> Vec<String> {
    let mut filters = Vec::new();
    if clip["animationIn"]["type"].as_str() == Some("fade") {
        if let Some(duration) = animation_duration_seconds(&clip["animationIn"], clip_seconds, fps)
        {
            filters.push(format!(
                "fade=t=in:st={:.6}:d={:.6}:alpha=1",
                lead_seconds.max(0.0),
                duration
            ));
        }
    }
    if clip["animationOut"]["type"].as_str() == Some("fade") {
        if let Some(duration) = animation_duration_seconds(&clip["animationOut"], clip_seconds, fps)
        {
            filters.push(format!(
                "fade=t=out:st={:.6}:d={:.6}:alpha=1",
                (total_seconds - duration).max(0.0),
                duration
            ));
        }
    }
    filters
}

fn lut_filter(path: &Path) -> String {
    let escaped = path
        .to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:");
    format!("lut3d=file='{escaped}'")
}

/// Applies an optional mix between the original chain and its LUT-graded
/// branch. A full-intensity LUT stays a single appended filter; partial
/// intensity splits the stream and blends both branches with the same alpha
/// so the grade keeps the clip's masks and opacity untouched.
pub(crate) fn apply_lut_to_chain(chain: String, label: &str, lut: &Path, intensity: f64) -> String {
    let intensity = if intensity.is_finite() {
        intensity.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let output = format!("[{label}]");
    if intensity <= 0.001 {
        return chain;
    }
    if intensity >= 0.999 {
        return match chain.rfind(&output) {
            Some(position) => format!("{},{}[{}]", &chain[..position], lut_filter(lut), label),
            None => chain,
        };
    }
    let Some(prefix) = chain.strip_suffix(&output) else {
        return chain;
    };
    // `blend` weights the first input, so the original keeps 1 - intensity.
    let opacity = 1.0 - intensity;
    format!(
        "{prefix},format=rgba,split=2[{label}src][{label}lut];\
         [{label}lut]{}[{label}graded];\
         [{label}src][{label}graded]blend=all_mode=normal:all_opacity={opacity:.4}[{label}]",
        lut_filter(lut)
    )
}

/// Añade un halo tipo bloom: separa las zonas claras, las desenfoca y las
/// vuelve a mezclar con `screen`. El canal alfa del clip se conserva en la
/// rama base; el halo se calcula sobre el resultado ya graduado.
pub(crate) fn apply_glow_to_chain(chain: String, label: &str, effects: &Value) -> String {
    let Some(glow) = effects.get("glow").filter(|value| value.is_object()) else {
        return chain;
    };
    let intensity = number(glow, "intensity").unwrap_or(0.6).clamp(0.0, 1.0);
    if intensity <= 0.001 {
        return chain;
    }
    let radius = number(glow, "radius").unwrap_or(18.0).clamp(1.0, 80.0);
    let threshold = number(glow, "threshold").unwrap_or(0.55).clamp(0.0, 0.95);
    let output = format!("[{label}]");
    let Some(prefix) = chain.strip_suffix(&output) else {
        return chain;
    };
    format!(
        "{prefix},format=rgba,split=3[{label}base][{label}glow][{label}alpha];\
         [{label}alpha]alphaextract[{label}amask];\
         [{label}glow]colorlevels=rimin={threshold:.4}:gimin={threshold:.4}:bimin={threshold:.4},gblur=sigma={radius:.3}[{label}blur];\
         [{label}base][{label}blur]blend=all_mode=screen:all_opacity={intensity:.4}[{label}blended];\
         [{label}blended][{label}amask]alphamerge,format=rgba[{label}]"
    )
}

fn motion_blur_weights(frames: usize, intensity: f64) -> String {
    let intensity = intensity.clamp(0.0, 1.0);
    let mut weights = Vec::with_capacity(frames);
    for index in 0..frames {
        // El frame actual (último) pesa 1; los anteriores decaen con la
        // intensidad. Con 0 sólo queda el actual; con 1 se promedian todos.
        weights.push(intensity.powi((frames - 1 - index) as i32));
    }
    let total: f64 = weights.iter().sum::<f64>().max(f64::EPSILON);
    weights
        .iter()
        .map(|weight| format!("{:.5}", weight / total))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Adjustment layers only exist inside their timeline window. The LUT branch
/// can keep running, but the blend that mixes it is gated so outside the
/// window the first (original) input passes through.
fn apply_lut_to_chain_gated(
    chain: String,
    label: &str,
    lut: &Path,
    intensity: f64,
    enable: Option<(f64, f64)>,
) -> String {
    let Some((start, end)) = enable else {
        return apply_lut_to_chain(chain, label, lut, intensity);
    };
    let intensity = if intensity.is_finite() {
        intensity.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let output = format!("[{label}]");
    let Some(prefix) = chain.strip_suffix(&output) else {
        return chain;
    };
    let gate = format!(":enable='between(t,{start:.6},{end:.6})'");
    if intensity <= 0.001 {
        return chain;
    }
    if intensity >= 0.999 {
        return format!("{prefix},{}{gate}[{label}]", lut_filter(lut));
    }
    let opacity = 1.0 - intensity;
    format!(
        "{prefix},format=rgba,split=2[{label}src][{label}lut];\
         [{label}lut]{}[{label}graded];\
         [{label}src][{label}graded]blend=all_mode=normal:all_opacity={opacity:.4}{gate}[{label}]",
        lut_filter(lut)
    )
}

/// Resolves the LUT path and its 0..1 intensity from a grade object.
pub(crate) fn effects_lut(
    effects: &Value,
    root: &Path,
) -> Result<Option<(PathBuf, f64)>, ProjectError> {
    let Some(relative) = effects["lutFile"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let path = resolve_inside_root(root, relative)?;
    let intensity = number(effects, "lutIntensity")
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    if intensity <= 0.001 {
        return Ok(None);
    }
    Ok(Some((path, intensity)))
}

/// Returns the same grade without its LUT, so the LUT can be mixed after the
/// color chain instead of being baked in at full strength.
fn without_lut(effects: &Value) -> Value {
    let mut grade = effects.clone();
    if let Some(object) = grade.as_object_mut() {
        object.remove("lutFile");
        object.remove("lutIntensity");
    }
    grade
}

fn stabilization_filter(path: &Path, smoothing: u32) -> String {
    let escaped = path
        .to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'");
    format!("vidstabtransform=input='{escaped}':smoothing={smoothing}:crop=black")
}

/// Prepends `vidstabtransform` so it sees the same frames the analysis saw.
fn with_stabilization(chain: String, index: usize, transform: &Path, smoothing: u32) -> String {
    let prefix = format!("[{index}:v]");
    match chain.strip_prefix(&prefix) {
        Some(rest) => format!(
            "{prefix}{},{rest}",
            stabilization_filter(transform, smoothing)
        ),
        None => chain,
    }
}

/// Validates that the analyzed transform still matches the clip. Trimming,
/// retiming, reversing or overlapping an entrance transition changes which
/// frames reach the filter, so the renderer refuses instead of applying a
/// misaligned stabilization.
fn resolve_stabilization(
    clip: &Value,
    root: &Path,
) -> Result<Option<(PathBuf, u32)>, ProjectError> {
    let Some(stabilization) = clip["stabilization"].as_object() else {
        return Ok(None);
    };
    if clip["kind"].as_str() != Some("video") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización sólo se aplica a clips de video",
        ));
    }
    let source = &clip["source"];
    if stabilization["inFrame"].as_u64() != source["inFrame"].as_u64()
        || stabilization["outFrame"].as_u64() != source["outFrame"].as_u64()
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización no coincide con el recorte actual del clip; volvé a analizarla",
        ));
    }
    let speed = &clip["speed"];
    if speed.is_object()
        && (speed["num"].as_u64().unwrap_or(1) != 1 || speed["den"].as_u64().unwrap_or(1) != 1)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización requiere velocidad 1×; quitá la velocidad o volvé a analizar",
        ));
    }
    if clip["reverse"].as_bool().unwrap_or(false) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización no se puede combinar con reverse",
        ));
    }
    if clip["transitionIn"]
        .as_object()
        .map(|transition| !transition.is_empty())
        .unwrap_or(false)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización no se puede combinar con la transición de entrada",
        ));
    }
    let relative = stabilization["transformFile"].as_str().unwrap_or("");
    let path = resolve_inside_root(root, relative).map_err(|error| {
        if error.code == ProjectErrorCode::NotFound {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "falta el archivo de estabilización; volvé a analizarla",
            )
        } else {
            error
        }
    })?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "falta el archivo de estabilización; volvé a analizarla",
        ));
    }
    let smoothing = stabilization["smoothing"]
        .as_u64()
        .unwrap_or(10)
        .clamp(1, 60) as u32;
    Ok(Some((path, smoothing)))
}

/// Frame-sampled opacity timeline for `sendcmd`.
///
/// `colorchannelmixer` accepts timeline commands but not expressions, so the
/// ramp is emitted as one command per sampled frame. The count is capped and
/// the step never shrinks below one frame: for a full-range ramp inside the cap
/// each step is smaller than one 8-bit alpha level, so the stair is invisible.
const MAX_OPACITY_COMMANDS: usize = 300;

pub(crate) fn eased_fraction(progress: f64, easing: &str) -> f64 {
    match easing {
        "ease-in" => progress.powi(3),
        "ease-out" => 1.0 - (1.0 - progress).powi(3),
        "ease-in-out" => progress * progress * (3.0 - 2.0 * progress),
        "hold" => 0.0,
        _ => progress,
    }
}

fn opacity_commands(
    keyframes: &[Value],
    fps: f64,
    lead_seconds: f64,
) -> Option<(f64, Vec<(f64, f64)>)> {
    let rate = fps.max(1.0);
    let mut samples: Vec<(f64, f64, String)> = keyframes
        .iter()
        .filter_map(|keyframe| {
            let frame = keyframe["frame"].as_f64()?;
            let value = keyframe["opacity"]
                .as_f64()
                .map(sanitize_filter_number)?
                .clamp(0.0, 1.0);
            let easing = keyframe["easing"]
                .as_str()
                .filter(|value| {
                    matches!(
                        *value,
                        "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold"
                    )
                })
                .unwrap_or("linear")
                .to_owned();
            Some((frame / rate, value, easing))
        })
        .collect();
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(|a, b| a.0.total_cmp(&b.0));

    let initial = samples[0].1;
    let total_ramp: f64 = samples
        .windows(2)
        .filter(|pair| (pair[1].1 - pair[0].1).abs() > 1e-6)
        .map(|pair| (pair[1].0 - pair[0].0).max(0.0))
        .sum();
    let step = if total_ramp <= 0.0 {
        1.0 / rate
    } else {
        (total_ramp / MAX_OPACITY_COMMANDS as f64).max(1.0 / rate)
    };

    let mut commands: Vec<(f64, f64)> = Vec::new();
    let mut last = initial;
    for pair in samples.windows(2) {
        let (start_t, start_v, easing) = (pair[0].0, pair[0].1, pair[0].2.as_str());
        let (end_t, end_v) = (pair[1].0, pair[1].1);
        if end_t <= start_t || (end_v - start_v).abs() <= 1e-6 {
            continue;
        }
        let mut t = start_t + step;
        while t < end_t - 1e-9 && commands.len() < MAX_OPACITY_COMMANDS {
            let progress = ((t - start_t) / (end_t - start_t)).clamp(0.0, 1.0);
            let value = start_v + (end_v - start_v) * eased_fraction(progress, easing);
            if (value - last).abs() >= 0.002 {
                commands.push((lead_seconds + t, value));
                last = value;
            }
            t += step;
        }
        if commands.len() < MAX_OPACITY_COMMANDS && (end_v - last).abs() >= 0.002 {
            commands.push((lead_seconds + end_t, end_v));
            last = end_v;
        }
    }

    Some((initial, commands))
}

/// Overlap of an incoming dissolve. It never starts before the timeline and
/// never eats more than half of the clip.
pub(crate) fn transition_lead_seconds(
    clip: &Value,
    fps: f64,
    clip_seconds: f64,
    start_seconds: f64,
) -> f64 {
    let kind = clip["kind"].as_str().unwrap_or("");
    if kind != "video" && kind != "image" && kind != "freeze" {
        return 0.0;
    }
    let frames = clip["transitionIn"]["frames"].as_f64().unwrap_or(0.0);
    if frames <= 0.0 {
        return 0.0;
    }
    (frames / fps.max(1.0)).clamp(
        0.0,
        clip_seconds.max(0.0).min(start_seconds.max(0.0)).min(2.0),
    )
}

/// Even dimensions that preserve aspect ratio and fit inside the profile.
fn even_fit(width: u64, height: u64, max_width: u64, max_height: u64) -> (u32, u32) {
    let width = width.max(2) as f64;
    let height = height.max(2) as f64;
    let scale = (max_width.max(2) as f64 / width)
        .min(max_height.max(2) as f64 / height)
        .max(0.0001);
    let mut out_w = ((width * scale).round() as u64).max(2);
    let mut out_h = ((height * scale).round() as u64).max(2);
    if out_w % 2 != 0 {
        out_w -= 1;
    }
    if out_h % 2 != 0 {
        out_h -= 1;
    }
    (out_w.max(2) as u32, out_h.max(2) as u32)
}

/// Fuente TTF para `drawtext`. Se puede pisar con `EDITOR_IA_TEXT_MASK_FONT`.
fn text_mask_font() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("EDITOR_IA_TEXT_MASK_FONT") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    [
        "C:/Windows/Fonts/seguisb.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
}

/// `drawtext` usa dos niveles de escape. Para un texto creativo se descartan
/// los caracteres que pueden romper el filtergraph en vez de intentar
/// escaparlos; el resultado sigue siendo legible.
pub(crate) fn drawtext_text(raw: &str) -> String {
    let mut cleaned: String = raw
        .chars()
        .map(|character| match character {
            '\'' => '’',
            '\\' | ':' | '%' | ',' | '[' | ']' | ';' => ' ',
            character if character.is_control() => ' ',
            character => character,
        })
        .collect();
    while cleaned.contains("  ") {
        cleaned = cleaned.replace("  ", " ");
    }
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "TEXTO".to_owned()
    } else {
        trimmed.chars().take(200).collect()
    }
}

#[allow(clippy::too_many_arguments)]
fn mask_filter(clip: &Value, fps: f64, lead_seconds: f64) -> Option<String> {
    let mask = &clip["mask"];
    let shape = mask["shape"].as_str()?;
    if !matches!(
        shape,
        "rectangle" | "ellipse" | "diamond" | "triangle" | "rounded" | "polygon"
    ) {
        return None;
    }
    let keyframes = mask["keyframes"]
        .as_array()
        .filter(|items| !items.is_empty());
    // The mask runs after zoompan, whose timestamps may be rebased; the frame
    // counter N is the reliable clock, expressed in seconds since the clip's
    // nominal start (the lead belongs to the incoming transition).
    let time_var = format!(
        "((N-{:.0})/{:.6})",
        (lead_seconds * fps).round(),
        fps.max(1.0)
    );
    let expression = |property: &str, fallback: f64| -> String {
        keyframes
            .and_then(|items| keyframe_expression(items, property, fps, &time_var))
            .unwrap_or_else(|| format!("{fallback:.6}"))
    };
    let x = expression("x", number(mask, "x").unwrap_or(0.0).clamp(-1.0, 1.0));
    let y = expression("y", number(mask, "y").unwrap_or(0.0).clamp(-1.0, 1.0));
    let width = expression(
        "width",
        number(mask, "width").unwrap_or(1.0).clamp(0.01, 2.0),
    );
    let height = expression(
        "height",
        number(mask, "height").unwrap_or(1.0).clamp(0.01, 2.0),
    );
    let feather = expression(
        "feather",
        number(mask, "feather").unwrap_or(0.08).clamp(0.0, 1.0),
    );
    let rotation = expression(
        "rotationDeg",
        number(mask, "rotationDeg")
            .unwrap_or(0.0)
            .clamp(-180.0, 180.0),
    );
    let invert = mask["invert"].as_bool().unwrap_or(false);
    if shape == "polygon" {
        let points: Vec<(f64, f64)> = mask["points"]
            .as_array()?
            .iter()
            .filter_map(|point| {
                let px = point["x"].as_f64()?;
                let py = point["y"].as_f64()?;
                if px.is_finite() && py.is_finite() {
                    Some((px.clamp(0.0, 1.0), py.clamp(0.0, 1.0)))
                } else {
                    None
                }
            })
            .collect();
        if points.len() < 3 {
            return None;
        }
        let px = "(X/W)".to_owned();
        let py = "(Y/H)".to_owned();
        let mut crossings = Vec::new();
        for index in 0..points.len() {
            let (x1, y1) = points[index];
            let (x2, y2) = points[(index + 1) % points.len()];
            let x1 = format!("({x1:.6}+({x}))");
            let y1 = format!("({y1:.6}+({y}))");
            let x2 = format!("({x2:.6}+({x}))");
            let y2 = format!("({y2:.6}+({y}))");
            let crosses_y = format!(
                "(if(gt({y1},{py}),1,0)*if(lte({y2},{py}),1,0))+(if(gt({y2},{py}),1,0)*if(lte({y1},{py}),1,0))"
            );
            let x_at_y =
                format!("(({x1})+((({x2})-({x1}))*((({py})-({y1}))/((({y2})-({y1}))+0.000001))))");
            let condition = format!("(({crosses_y})*if(lt({px},{x_at_y}),1,0))");
            crossings.push(format!("if({condition},1,0)"));
        }
        let inside = format!("mod(({}),2)", crossings.join("+"));
        let alpha = if invert {
            format!("(1-({inside}))")
        } else {
            inside
        };
        return Some(format!(
            "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})'"
        ));
    }
    let dx = format!("((X/W)-0.5-({x}))");
    let dy = format!("((Y/H)-0.5-({y}))");
    let rotating = keyframes.is_some() || rotation != "0.000000";
    let (nx, ny) = if !rotating {
        (
            format!("({dx}/(({width})/2))"),
            format!("({dy}/(({height})/2))"),
        )
    } else {
        // Rotate in pixel space even though the centre and size are
        // normalised: H/W converts the vertical component before mixing.
        let cos = format!("cos(({rotation})*PI/180)");
        let sin = format!("sin(({rotation})*PI/180)");
        (
            format!("((({cos})*({dx})+({sin})*({dy})*(H/W))/(({width})/2))"),
            format!("((({cos})*({dy})-({sin})*({dx})*(W/H))/(({height})/2))"),
        )
    };
    let feather_expr = format!("max(({feather}),0.0001)");
    let soft = |value: &str| format!("max(0,min(1,(1-abs({value}))/{feather_expr}))");
    let coverage = match shape {
        "ellipse" => {
            let radius = format!("sqrt(({nx})*({nx})+({ny})*({ny}))");
            format!("max(0,min(1,(1-({radius}))/{feather_expr}))")
        }
        "diamond" => {
            let distance = format!("abs({nx})+abs({ny})");
            format!("max(0,min(1,(1-({distance}))/{feather_expr}))")
        }
        "triangle" => {
            // Triángulo con vértice arriba: ancho permitido = v, donde v va de
            // 0 en el vértice a 1 en la base. El borde superior también se
            // suaviza para que el vértice no quede duro.
            let v = format!("max(0,min(1,(({ny})+1)/2))");
            let inside = format!("(({v})-abs({nx}))");
            format!(
                "max(0,min(1,({inside})/{feather_expr}))*max(0,min(1,({v})/{feather_expr}))*max(0,min(1,(1-({v}))/{feather_expr}))"
            )
        }
        "rounded" => {
            // SDF de una caja redondeada: los centros de esquina quedan en
            // 1-radio y el borde exterior sigue en 1. Radio fijo de 0.25.
            let radius = 0.25;
            let qx = format!("(abs({nx})-{:.6})", 1.0 - radius);
            let qy = format!("(abs({ny})-{:.6})", 1.0 - radius);
            let outside = format!("sqrt(pow(max({qx},0),2)+pow(max({qy},0),2))");
            let inside = format!("min(max({qx},{qy}),0)");
            let distance = format!("(({outside})+({inside})-{radius:.6})");
            format!("max(0,min(1,(-({distance}))/{feather_expr}))")
        }
        _ => format!("({})*({})", soft(&nx), soft(&ny)),
    };
    let alpha = if invert {
        format!("(1-({coverage}))")
    } else {
        coverage
    };
    Some(format!(
        "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})'"
    ))
}

/// Builds `curves=master='x/y ...':red='...'` from the clip's custom points.
/// Points are sorted and clamped so a hand-edited project cannot inject filter
/// syntax or produce an unordered set.
fn custom_curves_filter(effects: &Value) -> Option<String> {
    let curves = effects.get("curves")?.as_object()?;
    let mut parts: Vec<String> = Vec::new();
    for channel in ["master", "red", "green", "blue"] {
        let Some(points) = curves.get(channel).and_then(Value::as_array) else {
            continue;
        };
        let mut parsed: Vec<(f64, f64)> = points
            .iter()
            .filter_map(|point| {
                let x = point.get("x")?.as_f64()?;
                let y = point.get("y")?.as_f64()?;
                if !x.is_finite() || !y.is_finite() {
                    return None;
                }
                Some((x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)))
            })
            .collect();
        parsed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        parsed.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-9);
        if parsed.len() < 2
            || (parsed[0].0 - 0.0).abs() > 1e-9
            || (parsed[parsed.len() - 1].0 - 1.0).abs() > 1e-9
        {
            continue;
        }
        let formatted = parsed
            .iter()
            .map(|(x, y)| format!("{x:.4}/{y:.4}"))
            .collect::<Vec<_>>()
            .join(" ");
        parts.push(format!("{channel}='{formatted}'"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(format!("curves={}", parts.join(":")))
    }
}

/// Builds a master tone curve for shadows, highlights and a filmic fade. The
/// points are fixed and every value is clamped, so no user text reaches the
/// filter syntax. Applied before any creative curve or preset.
fn tone_curve_filter(effects: &Value) -> Option<String> {
    let shadows = number(effects, "shadows").unwrap_or(0.0).clamp(-1.0, 1.0);
    let highlights = number(effects, "highlights")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let fade = number(effects, "fade").unwrap_or(0.0).clamp(0.0, 1.0);
    if shadows.abs() <= 0.001 && highlights.abs() <= 0.001 && fade <= 0.001 {
        return None;
    }
    let points = [
        (0.0, (fade * 0.10).clamp(0.0, 1.0)),
        (0.25, (0.25 + shadows * 0.12 + fade * 0.05).clamp(0.0, 1.0)),
        (0.5, (0.5 + fade * 0.02).clamp(0.0, 1.0)),
        (
            0.75,
            (0.75 + highlights * 0.12 - fade * 0.02).clamp(0.0, 1.0),
        ),
        (1.0, (1.0 - fade * 0.05).clamp(0.0, 1.0)),
    ];
    let formatted = points
        .iter()
        .map(|(x, y)| format!("{x:.4}/{y:.4}"))
        .collect::<Vec<_>>()
        .join(" ");
    Some(format!("curves=master='{formatted}'"))
}

/// Builds the FFmpeg chain for a grade. `enable` is appended to every filter so
/// an adjustment layer only exists inside its timeline window.
fn grade_filters(
    effects: &Value,
    root: &Path,
    enable: Option<(f64, f64)>,
) -> Result<Vec<String>, ProjectError> {
    if !effects.is_object() {
        return Ok(Vec::new());
    }
    let brightness = number(effects, "brightness")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let contrast = number(effects, "contrast").unwrap_or(1.0).clamp(0.0, 3.0);
    let saturation = number(effects, "saturation").unwrap_or(1.0).clamp(0.0, 3.0);
    let temperature = number(effects, "temperature")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let lift = &effects["lift"];
    let gamma = &effects["gamma"];
    let gain = &effects["gain"];
    // Cuarta rueda de Primaries (DaVinci): balance de medios tonos.
    let offset = &effects["offset"];
    let lift_rgb = [
        number(lift, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(lift, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(lift, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let gamma_rgb = [
        number(gamma, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gamma, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gamma, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let gain_rgb = [
        number(gain, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gain, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gain, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let offset_rgb = [
        number(offset, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(offset, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(offset, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let mut filters = Vec::new();
    if brightness.abs() > 0.001
        || (contrast - 1.0).abs() > 0.001
        || (saturation - 1.0).abs() > 0.001
        || gamma_rgb.iter().any(|value| value.abs() > 0.001)
    {
        let mut eq = format!(
            "eq=brightness={brightness:.4}:contrast={contrast:.4}:saturation={saturation:.4}"
        );
        if gamma_rgb.iter().any(|value| value.abs() > 0.001) {
            eq.push_str(&format!(
                ":gamma_r={:.4}:gamma_g={:.4}:gamma_b={:.4}",
                (1.0 + gamma_rgb[0]).clamp(0.1, 10.0),
                (1.0 + gamma_rgb[1]).clamp(0.1, 10.0),
                (1.0 + gamma_rgb[2]).clamp(0.1, 10.0)
            ));
        }
        filters.push(eq);
    }
    if lift_rgb.iter().any(|value| value.abs() > 0.001)
        || gain_rgb.iter().any(|value| value.abs() > 0.001)
        || offset_rgb.iter().any(|value| value.abs() > 0.001)
    {
        filters.push(format!(
            "colorbalance=rs={:.4}:gs={:.4}:bs={:.4}:rm={:.4}:gm={:.4}:bm={:.4}:rh={:.4}:gh={:.4}:bh={:.4}",
            lift_rgb[0],
            lift_rgb[1],
            lift_rgb[2],
            offset_rgb[0],
            offset_rgb[1],
            offset_rgb[2],
            gain_rgb[0],
            gain_rgb[1],
            gain_rgb[2]
        ));
    }
    if temperature.abs() > 0.001 {
        filters.push(format!(
            "colorbalance=rs={:.4}:bs={:.4}",
            temperature * 0.25,
            -temperature * 0.25
        ));
    }
    let hue_rotate = number(effects, "hueRotateDeg")
        .unwrap_or(0.0)
        .clamp(-180.0, 180.0);
    if hue_rotate.abs() > 0.01 {
        filters.push(format!("hue=h={hue_rotate:.2}"));
    }
    if let Some(tone) = tone_curve_filter(effects) {
        filters.push(tone);
    }
    if let Some(custom) = custom_curves_filter(effects) {
        filters.push(custom);
    } else {
        let preset = effects["curvePreset"].as_str().unwrap_or("");
        if let Some(name) = match preset {
            "contrast-soft" => Some("linear_contrast"),
            "contrast-medium" => Some("medium_contrast"),
            "contrast-strong" => Some("strong_contrast"),
            "vintage" => Some("vintage"),
            "cross-process" => Some("cross_process"),
            "darker" => Some("darker"),
            "lighter" => Some("lighter"),
            _ => None,
        } {
            filters.push(format!("curves=preset={name}"));
        }
    }
    if effects["grayscale"].as_bool().unwrap_or(false) {
        filters.push("hue=s=0".to_owned());
    }
    if effects["sepia"].as_bool().unwrap_or(false) {
        filters.push(
            "colorchannelmixer=rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131"
                .to_owned(),
        );
    }
    let blur = number(effects, "blur").unwrap_or(0.0).clamp(0.0, 50.0);
    if blur > 0.001 {
        filters.push(format!("gblur=sigma={blur:.3}"));
    }
    let sharpen = number(effects, "sharpen").unwrap_or(0.0).clamp(0.0, 5.0);
    if sharpen > 0.001 {
        filters.push(format!("unsharp=5:5:{sharpen:.3}:5:5:0"));
    }
    let vignette = number(effects, "vignette").unwrap_or(0.0).clamp(0.0, 1.0);
    if vignette > 0.001 {
        let divisor = (5.0 - vignette * 4.0).max(1.0);
        filters.push(format!("vignette=PI/{divisor:.3}"));
    }
    if let Some(lens) = effects
        .get("lensCorrection")
        .filter(|value| value.is_object())
    {
        let k1 = number(lens, "k1").unwrap_or(0.0).clamp(-1.0, 1.0);
        let k2 = number(lens, "k2").unwrap_or(0.0).clamp(-1.0, 1.0);
        if k1.abs() > 0.0001 || k2.abs() > 0.0001 {
            let cx = number(lens, "cx").unwrap_or(0.5).clamp(0.0, 1.0);
            let cy = number(lens, "cy").unwrap_or(0.5).clamp(0.0, 1.0);
            filters.push(format!(
                "lenscorrection=k1={k1:.4}:k2={k2:.4}:cx={cx:.3}:cy={cy:.3}:i=bilinear"
            ));
        }
    }
    if let Some(relative) = effects["lutFile"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = resolve_inside_root(root, relative)?;
        filters.push(lut_filter(&path));
    }
    if let Some((start, end)) = enable {
        for filter in &mut filters {
            filter.push_str(&format!(":enable='between(t,{start:.6},{end:.6})'"));
        }
    }
    Ok(filters)
}

/// Project-wide grade applied to the final composite, after every clip and
/// before captions. The same fields as a clip look, minus clip-only animation.
fn project_look_filters(project: &Value, root: &Path) -> Result<Vec<String>, ProjectError> {
    grade_filters(&without_lut(&project["look"]), root, None)
}

/// Grade owned by a source-less adjustment clip. It targets the final composite
/// and is gated by the clip's own start and duration.
fn adjustment_filters(
    clip: &Value,
    root: &Path,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<Vec<String>, ProjectError> {
    grade_filters(
        &without_lut(&clip["effects"]),
        root,
        Some((start_seconds, end_seconds)),
    )
}

pub(crate) fn visual_filter(
    input_index: usize,
    clip: &Value,
    asset: &Value,
    profile: &Profile,
    clip_seconds: f64,
    lead_seconds: f64,
    start_seconds: f64,
    speed_num: u32,
    speed_den: u32,
    is_image: bool,
) -> String {
    let lead = lead_seconds.clamp(0.0, clip_seconds.max(0.0));
    let total_seconds = clip_seconds + lead;
    let transform = &clip["transform"];
    let scale_zoom = scale_zoom_expression(clip, profile, lead);
    let scale_dynamic =
        scale_dynamic_expression(clip, profile, lead, speed_num, speed_den, is_image);
    let scale_x = number(transform, "scaleX")
        .unwrap_or(1.0)
        .clamp(0.01, 100.0);
    let scale_y = number(transform, "scaleY")
        .unwrap_or(1.0)
        .clamp(0.01, 100.0);
    let opacity = number(transform, "opacity").unwrap_or(1.0).clamp(0.0, 1.0);
    let rotation = number(transform, "rotationDeg")
        .unwrap_or(0.0)
        .clamp(-360.0, 360.0);
    let scaled_width =
        (((profile.width as f64 * scale_x).ceil().clamp(2.0, 16_384.0) as u32) + 1) & !1;
    let scaled_height = (((profile.height as f64 * scale_y)
        .ceil()
        .clamp(2.0, 16_384.0) as u32)
        + 1)
        & !1;

    let mut filters = Vec::new();
    filters.push(format!("fps={}", profile.fps_arg()));
    if clip["reverse"].as_bool().unwrap_or(false) {
        filters.push("reverse".to_owned());
    }

    let motion = &clip["motion"];
    let motion_type = motion["type"].as_str().unwrap_or("");
    if !motion_type.is_empty() {
        let intensity = number(motion, "intensity").unwrap_or(0.12).clamp(0.02, 0.5);
        let source_seconds = (if is_image {
            clip_seconds
        } else {
            clip_seconds * speed_num as f64 / speed_den.max(1) as f64
        })
        .max(0.001);
        let media = &asset["media"];
        let source_width = media["width"]
            .as_u64()
            .or_else(|| asset["width"].as_u64())
            .unwrap_or(profile.width as u64);
        let source_height = media["height"]
            .as_u64()
            .or_else(|| asset["height"].as_u64())
            .unwrap_or(profile.height as u64);
        let (zoom_w, zoom_h) = even_fit(
            source_width,
            source_height,
            profile.width as u64,
            profile.height as u64,
        );
        let total_frames = (source_seconds * profile.fps()).max(1.0);
        if let Some(frozen) = motion.get("frozen").filter(|value| value.is_object()) {
            // `frozen` only exists in the single-frame preview project: the
            // Ken Burns crop is evaluated at the playhead, so the one frame
            // rendered matches the full render without decoding from 0.
            let z = number(frozen, "z").unwrap_or(1.0).clamp(1.0, 8.0);
            let x = text(frozen, "x").unwrap_or("(iw-iw/zoom)/2");
            let y = text(frozen, "y").unwrap_or("(ih-ih/zoom)/2");
            filters.push("setpts=PTS-STARTPTS".to_owned());
            filters.push(format!(
                "zoompan=z='{z:.6}':x='{x}':y='{y}':d=1:s={zoom_w}x{zoom_h}:fps={}",
                profile.fps_arg()
            ));
        } else {
            let center_x = "x='(iw-iw/zoom)/2'";
            let center_y = "y='(ih-ih/zoom)/2'";
            let z = match motion_type {
                "zoom-in" => format!("z='1+{intensity:.4}*on/{total_frames:.4}'"),
                "zoom-out" => format!("z='1+{intensity:.4}*(1-on/{total_frames:.4})'"),
                "pan-left" | "pan-right" | "pan-up" | "pan-down" => {
                    format!("z='{:.4}'", 1.0 + intensity)
                }
                _ => String::new(),
            };
            if !z.is_empty() {
                let position = match motion_type {
                    "pan-left" => {
                        format!("x='(iw-iw/zoom)*(1-on/{total_frames:.4})':{center_y}")
                    }
                    "pan-right" => format!("x='(iw-iw/zoom)*on/{total_frames:.4}':{center_y}"),
                    "pan-up" => format!("y='(ih-ih/zoom)*(1-on/{total_frames:.4})':{center_x}"),
                    "pan-down" => format!("y='(ih-ih/zoom)*on/{total_frames:.4}':{center_x}"),
                    _ => format!("{center_x}:{center_y}"),
                };
                // crop cannot animate its output size, so zoom uses zoompan's
                // frame-evaluated z. Output size preserves the asset aspect ratio.
                filters.push("setpts=PTS-STARTPTS".to_owned());
                filters.push(format!(
                    "zoompan={z}:{position}:d=1:s={zoom_w}x{zoom_h}:fps={}",
                    profile.fps_arg()
                ));
            }
        }
    }

    if profile.fit == "cover" {
        filters.push(format!(
            "scale=w={}:h={}:force_original_aspect_ratio=increase:force_divisible_by=2",
            profile.width, profile.height
        ));
        filters.push(format!("crop={}:{}", profile.width, profile.height));
    } else {
        filters.push(format!(
            "scale=w={}:h={}:force_original_aspect_ratio=decrease:force_divisible_by=2",
            profile.width, profile.height
        ));
    }
    if (scale_x - 1.0).abs() > 0.001 || (scale_y - 1.0).abs() > 0.001 {
        filters.push(format!("scale=iw*{scale_x:.6}:ih*{scale_y:.6}"));
    }
    if scale_zoom.is_none() && scale_dynamic.is_none() {
        if let Some(keyframes) = transform["keyframes"].as_array() {
            // Timestamps can be rebased by zoompan/reverse; the frame counter
            // is the only clock guaranteed to advance through this chain.
            let frame_base = (lead * profile.fps()).round();
            let time_var = format!("((n-{frame_base:.0})/{:.6})", profile.fps());
            if let Some(expression) =
                keyframe_expression(keyframes, "scale", profile.fps(), &time_var)
            {
                if let Ok(value) = expression.parse::<f64>() {
                    if (value - 1.0).abs() > 0.001 {
                        filters.push(format!("scale=iw*{value:.6}:ih*{value:.6}"));
                    }
                } else {
                    // The expression changes per frame; overlay re-centres the
                    // (variable-size) layer over the fixed-size base.
                    filters.push(format!(
                        "scale=w='iw*({expression})':h='ih*({expression})':eval=frame"
                    ));
                }
            }
        }
    }
    if transform["flipH"].as_bool().unwrap_or(false) {
        filters.push("hflip".to_owned());
    }
    if transform["flipV"].as_bool().unwrap_or(false) {
        filters.push("vflip".to_owned());
    }
    // The clip chain is rebased to zero by setpts before this point, so the
    // animation clock starts at the transition lead, not at the global start.
    filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0".to_owned());
    filters.push("format=rgba".to_owned());

    let chroma = &clip["chromaKey"];
    let chroma_color = chroma["color"].as_str().unwrap_or("").trim();
    if chroma_color.len() == 7
        && chroma_color.starts_with('#')
        && chroma_color[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        let similarity = number(chroma, "similarity").unwrap_or(0.3).clamp(0.01, 1.0);
        let blend = number(chroma, "blend").unwrap_or(0.1).clamp(0.0, 1.0);
        filters.push(format!(
            "chromakey=0x{}:similarity={similarity:.4}:blend={blend:.4}",
            &chroma_color[1..]
        ));
    }
    if let Some(mask) = mask_filter(clip, profile.fps(), lead) {
        filters.push(mask);
    }

    let effects = &clip["effects"];
    let brightness = number(effects, "brightness")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let contrast = number(effects, "contrast").unwrap_or(1.0).clamp(0.0, 3.0);
    let saturation = number(effects, "saturation").unwrap_or(1.0).clamp(0.0, 3.0);
    let temperature = number(effects, "temperature")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let vignette = number(effects, "vignette").unwrap_or(0.0).clamp(0.0, 1.0);
    let sharpen = number(effects, "sharpen").unwrap_or(0.0).clamp(0.0, 5.0);
    let blur = number(effects, "blur").unwrap_or(0.0).clamp(0.0, 50.0);
    let grayscale = effects["grayscale"].as_bool().unwrap_or(false);
    let sepia = effects["sepia"].as_bool().unwrap_or(false);
    let lift = &effects["lift"];
    let gamma = &effects["gamma"];
    let gain = &effects["gain"];
    // Cuarta rueda de Primaries (DaVinci): balance de medios tonos.
    let offset = &effects["offset"];
    let lift_rgb = [
        number(lift, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(lift, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(lift, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let gamma_rgb = [
        number(gamma, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gamma, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gamma, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let gain_rgb = [
        number(gain, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gain, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gain, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let offset_rgb = [
        number(offset, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(offset, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(offset, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let gamma_active = gamma_rgb.iter().any(|value| value.abs() > 0.001);
    if brightness.abs() > 0.001
        || (contrast - 1.0).abs() > 0.001
        || (saturation - 1.0).abs() > 0.001
        || gamma_active
    {
        let mut eq = format!(
            "eq=brightness={brightness:.4}:contrast={contrast:.4}:saturation={saturation:.4}"
        );
        if gamma_active {
            eq.push_str(&format!(
                ":gamma_r={:.4}:gamma_g={:.4}:gamma_b={:.4}",
                (1.0 + gamma_rgb[0]).clamp(0.1, 10.0),
                (1.0 + gamma_rgb[1]).clamp(0.1, 10.0),
                (1.0 + gamma_rgb[2]).clamp(0.1, 10.0)
            ));
        }
        filters.push(eq);
    }
    if lift_rgb.iter().any(|value| value.abs() > 0.001)
        || gain_rgb.iter().any(|value| value.abs() > 0.001)
        || offset_rgb.iter().any(|value| value.abs() > 0.001)
    {
        filters.push(format!(
            "colorbalance=rs={:.4}:gs={:.4}:bs={:.4}:rm={:.4}:gm={:.4}:bm={:.4}:rh={:.4}:gh={:.4}:bh={:.4}",
            lift_rgb[0],
            lift_rgb[1],
            lift_rgb[2],
            offset_rgb[0],
            offset_rgb[1],
            offset_rgb[2],
            gain_rgb[0],
            gain_rgb[1],
            gain_rgb[2]
        ));
    }
    if temperature.abs() > 0.001 {
        filters.push(format!(
            "colorbalance=rs={:.4}:bs={:.4}",
            temperature * 0.25,
            -temperature * 0.25
        ));
    }
    let hue_rotate = number(effects, "hueRotateDeg")
        .unwrap_or(0.0)
        .clamp(-180.0, 180.0);
    if hue_rotate.abs() > 0.01 {
        filters.push(format!("hue=h={hue_rotate:.2}"));
    }
    let hsl = &effects["hsl"];
    let hsl_hue = number(hsl, "hue").unwrap_or(0.0).clamp(-180.0, 180.0);
    let hsl_saturation = number(hsl, "saturation").unwrap_or(0.0).clamp(-1.0, 1.0);
    let hsl_intensity = number(hsl, "intensity").unwrap_or(0.0).clamp(-1.0, 1.0);
    if hsl_hue.abs() > 0.01 || hsl_saturation.abs() > 0.001 || hsl_intensity.abs() > 0.001 {
        let colors = hsl["colors"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str())
                    .filter(|value| matches!(*value, "r" | "y" | "g" | "c" | "b" | "m"))
                    .collect::<Vec<_>>()
                    .join("+")
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "a".to_owned());
        filters.push(format!(
            "huesaturation=hue={hsl_hue:.2}:saturation={hsl_saturation:.4}:intensity={hsl_intensity:.4}:colors={colors}:strength=100:lightness=true"
        ));
    }
    let color_match = &effects["colorMatch"];
    let match_strength = number(color_match, "strength")
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    if match_strength > 0.001 {
        let gain = |key: &str| {
            1.0 + (number(color_match, key).unwrap_or(1.0).clamp(0.25, 4.0) - 1.0) * match_strength
        };
        let (r, g, b) = (gain("r"), gain("g"), gain("b"));
        if (r - 1.0).abs() > 0.001 || (g - 1.0).abs() > 0.001 || (b - 1.0).abs() > 0.001 {
            filters.push(format!("colorchannelmixer=rr={r:.4}:gg={g:.4}:bb={b:.4}"));
        }
    }
    if let Some(tone) = tone_curve_filter(effects) {
        filters.push(tone);
    }
    let curve = effects["curvePreset"].as_str().unwrap_or("");
    let curve_preset = match curve {
        "contrast-soft" => Some("linear_contrast"),
        "contrast-medium" => Some("medium_contrast"),
        "contrast-strong" => Some("strong_contrast"),
        "vintage" => Some("vintage"),
        "cross-process" => Some("cross_process"),
        "darker" => Some("darker"),
        "lighter" => Some("lighter"),
        _ => None,
    };
    if let Some(custom) = custom_curves_filter(effects) {
        filters.push(custom);
    } else if let Some(preset) = curve_preset {
        filters.push(format!("curves=preset={preset}"));
    }
    if grayscale {
        filters.push("hue=s=0".to_owned());
    }
    if sepia {
        filters.push(
            "colorchannelmixer=rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131"
                .to_owned(),
        );
    }
    if blur > 0.001 {
        filters.push(format!("gblur=sigma={blur:.3}"));
    }
    if sharpen > 0.001 {
        filters.push(format!("unsharp=5:5:{sharpen:.3}:5:5:0"));
    }
    if vignette > 0.001 {
        let divisor = (5.0 - vignette * 4.0).max(1.0);
        filters.push(format!("vignette=PI/{divisor:.3}"));
    }
    if let Some(lens) = effects
        .get("lensCorrection")
        .filter(|value| value.is_object())
    {
        let k1 = number(lens, "k1").unwrap_or(0.0).clamp(-1.0, 1.0);
        let k2 = number(lens, "k2").unwrap_or(0.0).clamp(-1.0, 1.0);
        if k1.abs() > 0.0001 || k2.abs() > 0.0001 {
            let cx = number(lens, "cx").unwrap_or(0.5).clamp(0.0, 1.0);
            let cy = number(lens, "cy").unwrap_or(0.5).clamp(0.0, 1.0);
            filters.push(format!(
                "lenscorrection=k1={k1:.4}:k2={k2:.4}:cx={cx:.3}:cy={cy:.3}:i=bilinear"
            ));
        }
    }
    if let Some(relight) = effects.get("relight").filter(|value| value.is_object()) {
        let strength = number(relight, "strength").unwrap_or(0.0).clamp(-1.0, 1.0);
        let warmth = number(relight, "warmth").unwrap_or(0.0).clamp(-1.0, 1.0);
        if strength.abs() > 0.0001 || warmth.abs() > 0.0001 {
            let x = number(relight, "x").unwrap_or(0.0).clamp(-1.0, 1.0);
            let y = number(relight, "y").unwrap_or(0.0).clamp(-1.0, 1.0);
            let radius = number(relight, "radius").unwrap_or(0.45).clamp(0.02, 1.0);
            let feather = number(relight, "feather").unwrap_or(0.35).clamp(0.01, 1.0);
            let dx = format!("((X/W)-0.5-({x:.4}))");
            let dy = format!("((Y/H)-0.5-({y:.4}))");
            let distance = format!("sqrt(({dx})*({dx})+({dy})*({dy}))");
            let edge = format!("({radius:.4}*{feather:.4})");
            let weight = format!("max(0,min(1,(({radius:.4})-({distance}))/{edge}))");
            let smooth = format!("(({weight})*({weight})*(3-2*({weight})))");
            let gain = strength * 92.0;
            let warm = warmth * 42.0;
            filters.push("format=rgba".to_owned());
            filters.push(format!(
                "geq=r='clip(r(X,Y)+({gain:.3})*({smooth})+({warm:.3})*({smooth}),0,255)':g='clip(g(X,Y)+({gain:.3})*({smooth}),0,255)':b='clip(b(X,Y)+({gain:.3})*({smooth})-({warm:.3})*({smooth}),0,255)':a='alpha(X,Y)'"
            ));
        }
    }

    if !is_image && speed_num != speed_den {
        filters.push(format!(
            "setpts=(PTS-STARTPTS)*{}/{}",
            speed_den.max(1),
            speed_num.max(1)
        ));
        // Cámara lenta suave: `setpts` estira los tiempos y deja huecos; la
        // interpolación de movimiento los rellena a la tasa del perfil. Sólo
        // se aplica al bajar de 1×, nunca al acelerar.
        if speed_num < speed_den && clip["slowMotionSmoothing"].as_bool() == Some(true) {
            // `tpad` clona el último frame para que la interpolación cubra
            // también el tramo final; sin eso el filtro entrega ~0,1 s menos.
            filters.push("tpad=stop_mode=clone:stop_duration=0.5".to_owned());
            filters.push(format!(
                "minterpolate=fps={}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none",
                profile.fps_arg()
            ));
        }
    }
    if !is_image {
        if let Some(blur) = effects.get("motionBlur").filter(|value| value.is_object()) {
            let frames = number(blur, "frames")
                .unwrap_or(4.0)
                .round()
                .clamp(2.0, 12.0) as usize;
            let intensity = number(blur, "intensity").unwrap_or(0.5).clamp(0.0, 1.0);
            if intensity > 0.001 {
                filters.push(format!(
                    "tmix=frames={frames}:weights='{}'",
                    motion_blur_weights(frames, intensity)
                ));
            }
        }
    }
    filters.push(format!("trim=duration={}", seconds(total_seconds)));
    let fps = profile.fps();
    let fade_in =
        (number(effects, "fadeInFrames").unwrap_or(0.0).max(0.0) / fps).min(total_seconds);
    let fade_out =
        (number(effects, "fadeOutFrames").unwrap_or(0.0).max(0.0) / fps).min(total_seconds);
    if fade_in > 0.001 {
        filters.push(format!("fade=t=in:st=0:d={:.3}:alpha=1", fade_in));
    }
    if fade_out > 0.001 {
        let start = (total_seconds - fade_out).max(0.0);
        filters.push(format!(
            "fade=t=out:st={:.3}:d={:.3}:alpha=1",
            start, fade_out
        ));
    }
    filters.extend(animation_fade_filters(
        clip,
        lead,
        clip_seconds,
        total_seconds,
        fps,
    ));
    if lead > 0.001 {
        match clip["transitionIn"]["type"].as_str().unwrap_or("") {
            "dissolve" => filters.push(format!("fade=t=in:st=0:d={lead:.3}:alpha=1")),
            "fade-black" => filters.push(format!("fade=t=in:st=0:d={lead:.3}")),
            "fade-white" => filters.push(format!("fade=t=in:st=0:d={lead:.3}:color=white")),
            _ => {}
        }
    }
    // `rotate` evalúa su ángulo con `t` (segundos locales), no con `n`; con `n`
    // los keyframes de rotación quedaban congelados en el primer valor.
    let rotation_time = format!("(t-{:.6})", lead);
    let rotation_keyframe = transform["keyframes"].as_array().and_then(|keyframes| {
        keyframe_expression(keyframes, "rotationDeg", profile.fps(), &rotation_time)
    });
    // La capa queda siempre del tamaño del lienzo: si `ow/oh` crecieran con
    // el bounding box, el overlay usaría el tamaño del primer frame y la
    // rotación animada se desplazaría.
    let rotate_fill = format!("c=black@0:ow={scaled_width}:oh={scaled_height}");
    if let Some(expression) = rotation_keyframe {
        if let Ok(value) = expression.parse::<f64>() {
            if value.abs() > 0.01 {
                filters.push(format!("rotate={value}*PI/180:{rotate_fill}"));
            }
        } else {
            filters.push(format!(
                "rotate=angle='({expression})*PI/180':{rotate_fill}"
            ));
        }
    } else if rotation.abs() > 0.01 {
        filters.push(format!("rotate={rotation}*PI/180:{rotate_fill}"));
    }
    let opacity_frozen = clip["opacityFrozen"]
        .as_f64()
        .map(|value| value.clamp(0.0, 1.0));
    let opacity_timeline = if opacity_frozen.is_some() {
        None
    } else {
        transform["keyframes"]
            .as_array()
            .and_then(|keyframes| opacity_commands(keyframes, profile.fps(), lead))
    };
    if let Some(frozen) = opacity_frozen {
        if frozen < 0.999 {
            filters.push(format!("colorchannelmixer=aa={frozen:.4}"));
        }
    } else if let Some((initial, commands)) = opacity_timeline {
        // `sendcmd` va antes del mixer para que el comando del frame se aplique
        // a ese frame y no al siguiente.
        if !commands.is_empty() {
            let script = commands
                .iter()
                .map(|(at, value)| {
                    format!("{at:.4} colorchannelmixer@kf{input_index} aa {value:.4}")
                })
                .collect::<Vec<_>>()
                .join(";");
            filters.push(format!("sendcmd=c='{script}'"));
        }
        filters.push(format!("colorchannelmixer@kf{input_index}=aa={initial:.4}"));
    } else if opacity < 0.999 {
        filters.push(format!("colorchannelmixer=aa={opacity:.4}"));
    }
    if let Some((maximum, factor)) = scale_dynamic.as_ref() {
        // Curvas que bajan de 1: se pre-escala una vez al máximo y cada frame
        // se reduce dentro de un lienzo fijo. Así no se baja a 0,7 para volver
        // a subir a 1,3, que perdía nitidez frente a una escala directa.
        let canvas_scale = maximum
            .min(16_384.0 / scaled_width.max(2) as f64)
            .min(16_384.0 / scaled_height.max(2) as f64)
            .max(0.01);
        let canvas_width = (((scaled_width as f64 * canvas_scale)
            .ceil()
            .clamp(2.0, 16_384.0) as u32)
            + 1)
            & !1;
        let canvas_height = (((scaled_height as f64 * canvas_scale)
            .ceil()
            .clamp(2.0, 16_384.0) as u32)
            + 1)
            & !1;
        let factor = if canvas_scale + 1e-9 < *maximum {
            format!("min(1,(({factor})*{:.6}))", maximum / canvas_scale)
        } else {
            factor.clone()
        };
        filters.push(format!(
            "scale=iw*{canvas_scale:.6}:ih*{canvas_scale:.6}:flags=lanczos"
        ));
        filters.push(format!(
            "scale=w='iw*({factor})':h='ih*({factor})':eval=frame:flags=lanczos"
        ));
        filters.push(format!(
            "pad={canvas_width}:{canvas_height}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame"
        ));
        filters.push("format=rgba".to_owned());
    } else if let Some((base, zoom)) = scale_zoom.as_ref() {
        // Curvas con mínimo >= 1: se centra la capa y `zoompan` completa la
        // animación con z >= 1 sobre una salida fija. El overlay nunca recibe
        // una capa de tamaño variable.
        if *base < 0.999 {
            filters.push(format!("scale=iw*{base:.6}:ih*{base:.6}:flags=lanczos"));
            filters.push(format!(
                "pad={scaled_width}:{scaled_height}:(ow-iw)/2:(oh-ih)/2:color=black@0"
            ));
        }
        filters.push("setpts=PTS-STARTPTS".to_owned());
        filters.push(format!(
            "zoompan=z='{zoom}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s={scaled_width}x{scaled_height}:fps={}",
            profile.fps_arg()
        ));
        filters.push("format=rgba".to_owned());
    }
    // Fade congelado por la ventana de un frame: multiplica alfa y conserva
    // RGB, igual que el `fade ...:alpha=1` del compuesto completo.
    if let Some(fade) = clip["fadeFrozen"]
        .as_f64()
        .map(|value| value.clamp(0.0, 1.0))
    {
        if fade < 0.999 {
            filters.push(format!("colorchannelmixer=aa={fade:.6}"));
        }
    }
    // Transición congelada en el lead: dissolve (alfa), fade-black (RGB+alfa),
    // fade-white (mezcla a blanco + alfa) o slide (sólo desplazamiento, que se
    // aplica en el overlay). El resto ya está en el recorte de origen.
    if let Some(frozen) = clip["transitionFrozen"].as_object() {
        let alpha = frozen
            .get("alpha")
            .and_then(Value::as_f64)
            .map(|value| value.clamp(0.0, 1.0))
            .unwrap_or(1.0);
        let mode = frozen.get("mode").and_then(Value::as_str).unwrap_or("");
        if alpha < 0.999 {
            match mode {
                "black" => filters.push(format!(
                    "colorchannelmixer=rr={alpha:.6}:gg={alpha:.6}:bb={alpha:.6}:aa={alpha:.6}"
                )),
                "white" => {
                    // `fade=color=white` mezcla RGB pero conserva el alfa: es un
                    // barrido a blanco, no un crossfade. Curvas afines por canal
                    // (0->(1-p), 1->1) preservan el alfa de máscaras.
                    let floor = 1.0 - alpha;
                    filters.push(format!(
                        "curves=r='0/{floor:.6} 1/1':g='0/{floor:.6} 1/1':b='0/{floor:.6} 1/1'"
                    ));
                }
                _ => filters.push(format!("colorchannelmixer=aa={alpha:.6}")),
            }
        }
    }
    // Asegura el canal alfa para los recortes VP9: `overlay` sólo compone
    // transparencia si la capa llega en un formato con alfa.
    filters.push("format=rgba".to_owned());
    if let Some(alpha) = clip["animationFrozen"]["alpha"]
        .as_f64()
        .map(|value| value.clamp(0.0, 1.0))
    {
        if alpha < 0.999 {
            filters.push(format!("colorchannelmixer=aa={alpha:.6}"));
        }
    }
    let text_mask = clip["mask"]["shape"].as_str() == Some("text")
        && clip["mask"]["text"]
            .as_str()
            .map(|text| !text.trim().is_empty())
            .unwrap_or(false);
    if text_mask {
        if let Some(font) = text_mask_font() {
            let mask = &clip["mask"];
            let font = font
                .to_string_lossy()
                .replace('\\', "/")
                .replace(':', "\\:");
            let font_size = (profile.height as f64
                * number(mask, "fontScale").unwrap_or(0.16).clamp(0.02, 0.5))
            .round()
            .clamp(4.0, 1000.0);
            let mask_x = number(mask, "x").unwrap_or(0.0).clamp(-1.0, 1.0);
            let mask_y = number(mask, "y").unwrap_or(0.0).clamp(-1.0, 1.0);
            let feather = number(mask, "feather").unwrap_or(0.0).clamp(0.0, 1.0);
            let feather_filter = if feather > 0.001 {
                format!(",gblur=sigma={:.3}", feather * 20.0)
            } else {
                String::new()
            };
            let invert_filter = if mask["invert"].as_bool().unwrap_or(false) {
                ",negate"
            } else {
                ""
            };
            let base_label = format!("tmaskbase{input_index}");
            let mask_label = format!("tmask{input_index}");
            let mask_text = drawtext_text(mask["text"].as_str().unwrap_or(""));
            let mask_start = seconds((start_seconds - lead).max(0.0));
            return format!(
                "[{input_index}:v]{} ,format=rgba[{base_label}];\
                 color=c=black@0.0:s={}x{}:r={}:d={},format=rgba,\
                 drawtext=fontfile='{}':text='{}':fontcolor=white:fontsize={:.0}:x=(w-text_w)/2+({:.6})*w:y=(h-text_h)/2+({:.6})*h:alpha=1:expansion=none,\
                 alphaextract{}{}[{mask_label}];\
                 [{base_label}][{mask_label}]alphamerge,format=rgba,setpts=PTS-STARTPTS+{}/TB[v{}]",
                filters.join(","),
                profile.width,
                profile.height,
                profile.fps_arg(),
                seconds(total_seconds.max(0.04)),
                font,
                mask_text,
                font_size,
                mask_x,
                mask_y,
                feather_filter,
                invert_filter,
                mask_start,
                input_index
            );
        }
    }
    filters.push(format!(
        "setpts=PTS-STARTPTS+{}/TB",
        seconds((start_seconds - lead).max(0.0))
    ));

    // Keep the asset read so a malformed source is caught by the compiler of
    // this function even if future transforms stop using it directly.
    let _ = asset;
    format!("[{input_index}:v]{}[v{input_index}]", filters.join(","))
}

/// Filtros lineales de la pista: EQ de 3 bandas antes del fader y paneo de
/// balance lineal. El centro deja ambos canales a 1.0; un paneo extremo deja
/// mudo el canal opuesto.
fn track_audio_filters(track: &Value) -> Vec<String> {
    let mut filters = Vec::new();
    for (frequency, key) in [
        (120.0, "eqLowDb"),
        (1_000.0, "eqMidDb"),
        (8_000.0, "eqHighDb"),
    ] {
        let gain = number(track, key).unwrap_or(0.0).clamp(-12.0, 12.0);
        if gain.abs() > 0.01 {
            filters.push(format!("equalizer=f={frequency:.1}:t=q:w=1:g={gain:.2}"));
        }
    }
    let pan = number(track, "pan").unwrap_or(0.0).clamp(-1.0, 1.0);
    if pan.abs() > 0.001 {
        let left = if pan <= 0.0 { 1.0 } else { 1.0 - pan };
        let right = if pan >= 0.0 { 1.0 } else { 1.0 + pan };
        filters.push(format!("pan=stereo|c0={left:.4}*c0|c1={right:.4}*c1"));
    }
    filters
}

fn audio_filter(
    input_index: usize,
    profile: &Profile,
    clip_seconds: f64,
    lead_seconds: f64,
    start_seconds: f64,
    audio: &Value,
    reverse: bool,
    speed_num: u32,
    speed_den: u32,
    track_gain_db: f64,
    track: &Value,
) -> String {
    let lead = lead_seconds.max(0.0);
    let gain_db = number(audio, "gainDb").unwrap_or(0.0).clamp(-60.0, 12.0);
    let mut filters = vec![
        format!("aresample={}", profile.audio_rate),
        "aformat=sample_fmts=fltp:channel_layouts=stereo".to_owned(),
        "asetpts=PTS-STARTPTS".to_owned(),
    ];
    if speed_num != speed_den {
        let factor = speed_num as f64 / speed_den as f64;
        let mut remaining = factor;
        while remaining > 2.0 {
            filters.push("atempo=2.0".to_owned());
            remaining /= 2.0;
        }
        while remaining < 0.5 {
            filters.push("atempo=0.5".to_owned());
            remaining /= 0.5;
        }
        filters.push(format!("atempo={remaining:.5}"));
    }
    if lead > 0.001 {
        filters.push(format!(
            "atrim=start={}:duration={}",
            seconds(lead),
            seconds(clip_seconds)
        ));
    } else {
        filters.push(format!("atrim=duration={}", seconds(clip_seconds)));
    }
    filters.push("asetpts=PTS-STARTPTS".to_owned());
    if reverse {
        filters.push("areverse".to_owned());
    }

    let high_pass = number(audio, "highPassHz")
        .unwrap_or(0.0)
        .clamp(20.0, 2_000.0);
    if high_pass > 20.0 {
        filters.push(format!("highpass=f={high_pass:.1}"));
    }
    let low_pass = number(audio, "lowPassHz")
        .unwrap_or(0.0)
        .clamp(1_000.0, 20_000.0);
    if low_pass > 1_000.0 {
        filters.push(format!("lowpass=f={low_pass:.1}"));
    }
    for (frequency, key) in [
        (100.0, "eqLowDb"),
        (1_000.0, "eqMidDb"),
        (8_000.0, "eqHighDb"),
    ] {
        let gain = number(audio, key).unwrap_or(0.0).clamp(-12.0, 12.0);
        if gain.abs() > 0.01 {
            filters.push(format!("equalizer=f={frequency:.1}:t=q:w=1:g={gain:.2}"));
        }
    }
    let denoise = number(audio, "denoise").unwrap_or(0.0).clamp(0.0, 1.0);
    if denoise > 0.001 {
        filters.push(format!("afftdn=nr={:.1}:nf=-25", denoise * 30.0));
    }
    if audio["deesser"].as_bool().unwrap_or(false) {
        filters.push("deesser=i=0.4:m=0.5:f=0.5".to_owned());
    }
    if let Some(gate) = number(audio, "gateDb") {
        let threshold = gate.clamp(-60.0, -10.0);
        filters.push(format!(
            "agate=threshold={threshold:.1}dB:ratio=2:attack=5:release=120"
        ));
    }
    if audio["compressor"].as_bool().unwrap_or(false) {
        filters
            .push("acompressor=threshold=-18dB:ratio=3:attack=5:release=100:makeup=2".to_owned());
    }
    match audio["voiceEffect"].as_str().unwrap_or("") {
        "deep" => filters.push(format!(
            "asetrate={}*0.86,aresample={},atempo={:.5}",
            profile.audio_rate,
            profile.audio_rate,
            1.0 / 0.86
        )),
        "chipmunk" => filters.push(format!(
            "asetrate={}*1.22,aresample={},atempo={:.5}",
            profile.audio_rate,
            profile.audio_rate,
            1.0 / 1.22
        )),
        "robot" => filters.push("vibrato=f=32:d=0.45,aecho=0.8:0.8:18:0.25".to_owned()),
        "echo" => filters.push("aecho=0.8:0.9:500|1000:0.4|0.25".to_owned()),
        "cave" => filters.push("aecho=0.8:0.9:1200|1800:0.35|0.2".to_owned()),
        "radio" => filters.push(
            "highpass=f=350,lowpass=f=3200,acompressor=threshold=-18dB:ratio=4:attack=5:release=80"
                .to_owned(),
        ),
        _ => {}
    }

    let gain_keyframes = audio["gainKeyframes"]
        .as_array()
        .and_then(|keyframes| keyframe_expression(keyframes, "gainDb", profile.fps(), "t"));
    if let Some(expression) = gain_keyframes {
        if let Ok(value) = expression.parse::<f64>() {
            if value.abs() > 0.001 {
                filters.push(format!("volume={value:.2}dB"));
            }
        } else {
            filters.push(format!(
                "volume=volume='pow(10,({expression})/20)':eval=frame"
            ));
        }
    } else if gain_db.abs() > 0.001 {
        filters.push(format!("volume={gain_db:.2}dB"));
    }
    let track_gain = track_gain_db.clamp(-60.0, 12.0);
    filters.extend(track_audio_filters(track));
    if track_gain.abs() > 0.001 {
        filters.push(format!("volume={track_gain:.2}dB"));
    }
    let fade_in = (audio["fadeInFrames"].as_u64().unwrap_or(0) as f64 / profile.fps())
        .clamp(0.0, clip_seconds);
    let fade_out = (audio["fadeOutFrames"].as_u64().unwrap_or(0) as f64 / profile.fps())
        .clamp(0.0, clip_seconds);
    if fade_in > 0.001 {
        filters.push(format!("afade=t=in:st=0:d={}", seconds(fade_in)));
    }
    if fade_out > 0.001 {
        filters.push(format!(
            "afade=t=out:st={}:d={}",
            seconds((clip_seconds - fade_out).max(0.0)),
            seconds(fade_out)
        ));
    }
    if start_seconds > 0.001 {
        filters.push(format!(
            "adelay=delays={}:all=1",
            (start_seconds * 1000.0).round() as u64
        ));
    }
    format!("[{input_index}:a]{}[a{input_index}]", filters.join(","))
}

pub struct BuildPlanInput<'a> {
    pub project: &'a Value,
    pub root: &'a Path,
    pub profile: &'a Profile,
    pub output_path: &'a Path,
    pub include_captions: bool,
    pub temp_dir: &'a Path,
    pub ffprobe: &'a Path,
    /// ASS generated from the motion plans; `None` means the caller did not
    /// provide plans. A visible graphic clip without a plan is an error.
    pub motion_ass: Option<&'a str>,
    /// Modo medición: arma sólo el grafo de audio de la mezcla (PCM f32le por
    /// stdout) sin cadena de video y sin loudnorm/limitador de entrega, para
    /// medir el loudness real de la mezcla con `filmcraft-audio-dsp`.
    pub audio_only: bool,
}

fn ensure_asset_unchanged(asset: &Value, path: &Path) -> Result<(), ProjectError> {
    let Some(expected) = asset["integrity"]["bytes"].as_u64() else {
        return Ok(());
    };
    let actual = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if actual != expected {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el material cambió de tamaño desde la importación; volvé a importarlo antes de exportar",
        ));
    }
    Ok(())
}

pub fn build_plan(input: BuildPlanInput<'_>) -> Result<RenderPlan, ProjectError> {
    build_plan_range(input, None)
}

/// Igual que `build_plan`, pero limita la salida a `[start, end)` en frames del
/// proyecto. El grafo sigue construyendo la timeline completa y FFmpeg recorta
/// a la salida; el MP4 dura sólo el rango y la verificación usa esa duración.
/// Reemplaza cada clip compuesto por sus clips internos, conservando sus
/// pistas y desplazándolos a la posición actual del compuesto. Los compuestos
/// no se anidan: el esquema sólo admite clips simples dentro de la definición.
pub(crate) fn expand_compounds(project: &Value) -> Result<Value, ProjectError> {
    let compounds = project["compounds"].as_array().cloned().unwrap_or_default();
    if compounds.is_empty() {
        return Ok(project.clone());
    }
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    // Los clips internos vuelven a sus pistas originales, así que ocultar la
    // pista del compuesto no bastaba: la expansión los dejaba visibles. Lo
    // mismo pasa con el mute: el audio interno debe seguir a la pista exterior.
    let hidden_tracks: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| track["hidden"].as_bool().unwrap_or(false))
                .filter_map(|track| track["id"].as_str())
                .collect()
        })
        .unwrap_or_default();
    let muted_tracks: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| track["muted"].as_bool().unwrap_or(false))
                .filter_map(|track| track["id"].as_str())
                .collect()
        })
        .unwrap_or_default();
    // El solo de la pista exterior también tiene que seguir a los clips
    // internos: la mezcla decide por pista, y sin esto el compuesto solo
    // quedaría en silencio porque sus pistas internas no están en solo.
    let solo_tracks: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| track["solo"].as_bool().unwrap_or(false))
                .filter_map(|track| track["id"].as_str())
                .collect()
        })
        .unwrap_or_default();
    let mut expanded: Vec<Value> = Vec::with_capacity(clips.len());
    for clip in clips {
        if clip["kind"].as_str() != Some("compound") {
            expanded.push(clip);
            continue;
        }
        if clip["enabled"].as_bool() == Some(false) {
            continue;
        }
        if hidden_tracks.contains(clip["trackId"].as_str().unwrap_or("")) {
            continue;
        }
        let id = clip["source"]["compoundId"].as_str().unwrap_or("");
        let compound = compounds
            .iter()
            .find(|item| item["id"].as_str() == Some(id))
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el clip compuesto no tiene una definición en el proyecto",
                )
            })?;
        let base = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        let host = clip["trackId"].as_str().unwrap_or("");
        let host_muted = muted_tracks.contains(host);
        let host_solo = solo_tracks.contains(host);
        let inner = compound["clips"].as_array().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el compuesto no tiene clips internos",
            )
        })?;
        for item in inner {
            let start = item["startFrame"].as_u64().unwrap_or(0);
            let inner_duration = item["durationFrames"].as_u64().unwrap_or(0);
            if start + inner_duration > duration {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "un clip interno del compuesto no entra en su duración",
                ));
            }
            let mut copy = item.clone();
            copy["startFrame"] = Value::from(base + start);
            if matches!(copy["kind"].as_str(), Some("video" | "audio")) {
                if host_muted {
                    copy["audio"]["muted"] = Value::Bool(true);
                }
                if host_solo {
                    copy["audio"]["solo"] = Value::Bool(true);
                }
            }
            expanded.push(copy);
        }
    }
    let mut next = project.clone();
    next["timeline"]["clips"] = Value::Array(expanded);
    Ok(next)
}

pub(crate) fn build_plan_range(
    input: BuildPlanInput<'_>,
    range: Option<(u64, u64)>,
) -> Result<RenderPlan, ProjectError> {
    let expanded_project;
    let project = if input
        .project
        .get("compounds")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false)
    {
        expanded_project = expand_compounds(input.project)?;
        &expanded_project
    } else {
        input.project
    };
    let profile = input.profile;
    let project_fps_num = project["video"]["frameRate"]["num"].as_u64().unwrap_or(30) as f64;
    let project_fps_den = project["video"]["frameRate"]["den"].as_u64().unwrap_or(1) as f64;
    let project_fps = (project_fps_num / project_fps_den.max(1.0)).max(1.0);
    let project_width = project["video"]["width"].as_u64().unwrap_or(1920) as u32;
    let background = hex_color(text(&project["video"], "backgroundColor").unwrap_or("#0f1319"));

    let tracks = project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let track_info: HashMap<String, (String, u64, bool, bool)> = tracks
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?.to_owned(),
                (
                    track["kind"].as_str().unwrap_or("").to_owned(),
                    track["order"].as_u64().unwrap_or(0),
                    track["hidden"].as_bool().unwrap_or(false),
                    track["muted"].as_bool().unwrap_or(false),
                ),
            ))
        })
        .collect();
    // Mezcla por pista: la ganancia se aplica a todo su audio y el solo
    // silencia las demás pistas con señal (video, audio y narración).
    let track_mix: HashMap<String, (f64, bool)> = tracks
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?.to_owned(),
                (
                    number(track, "gainDb").unwrap_or(0.0).clamp(-60.0, 12.0),
                    track["solo"].as_bool().unwrap_or(false),
                ),
            ))
        })
        .collect();
    let track_by_id: HashMap<String, Value> = tracks
        .iter()
        .filter_map(|track| Some((track["id"].as_str()?.to_owned(), track.clone())))
        .collect();
    let any_solo = tracks.iter().any(|track| {
        track["solo"].as_bool().unwrap_or(false)
            && !track["muted"].as_bool().unwrap_or(false)
            && matches!(
                track["kind"].as_str().unwrap_or(""),
                "video" | "audio" | "narration"
            )
    });
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    let asset_by_id: HashMap<String, Value> = assets
        .iter()
        .filter_map(|asset| Some((asset["id"].as_str()?.to_owned(), asset.clone())))
        .collect();
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if clips
        .iter()
        .any(|clip| clip["mask"]["shape"].as_str() == Some("text"))
        && text_mask_font().is_none()
    {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "no se encontró una fuente TTF para la máscara de texto (seguisb.ttf, arialbd.ttf, segoeui.ttf o arial.ttf)",
        ));
    }
    if clips.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "la timeline no tiene clips para renderizar",
        ));
    }

    let mut total_frames = 0u64;
    for clip in &clips {
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        total_frames = total_frames.max(start + duration);
    }
    for cue in project["captions"]["cues"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        total_frames = total_frames.max(cue["endFrame"].as_u64().unwrap_or(0));
    }
    if total_frames == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "la timeline no tiene duración para renderizar",
        ));
    }
    let duration_seconds = total_frames as f64 / project_fps;
    let (output_start_seconds, output_duration_seconds) = match range {
        Some((start, end)) => {
            let start = start.min(total_frames);
            let end = end.min(total_frames);
            if end <= start {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el rango de exportación está vacío; elegí un inicio menor al final",
                ));
            }
            (
                start as f64 / project_fps,
                (end - start) as f64 / project_fps,
            )
        }
        None => (0.0, duration_seconds),
    };

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
    ];
    // En modo medición stdout lleva el PCM decodificado: `-progress pipe:1`
    // escribiría su informe sobre las muestras y las corrompería.
    if !input.audio_only {
        args.extend(["-progress".into(), "pipe:1".into(), "-nostats".into()]);
    }
    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!(
            "color=c={}:s={}x{}:r={}:d={}",
            background,
            profile.width,
            profile.height,
            profile.fps_arg(),
            seconds(duration_seconds)
        ),
    ]);
    let mut inputs = 1usize;
    let mut filters: Vec<String> = vec!["[0:v]format=rgba,setpts=PTS-STARTPTS[base0]".to_owned()];
    let mut base_label = "base0".to_owned();
    let mut audio_labels: Vec<String> = Vec::new();
    // Gemelo de `filters` con sólo las cadenas de audio: en modo medición el
    // grafo final se arma desde acá, sin las cadenas de video.
    let mut audio_filters: Vec<String> = Vec::new();
    let mut audio_track_ids: Vec<String> = Vec::new();

    let mut visual_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
            if clip["enabled"].as_bool() == Some(false) {
                return false;
            }
            let track_id = clip["trackId"].as_str().unwrap_or("");
            track_info
                .get(track_id)
                .map(|(kind, _, hidden, _)| {
                    matches!(kind.as_str(), "video" | "image" | "graphic") && !hidden
                })
                .unwrap_or(false)
        })
        .collect();
    visual_clips.sort_by_key(|clip| {
        let track_id = clip["trackId"].as_str().unwrap_or("");
        let order = track_info.get(track_id).map(|info| info.1).unwrap_or(0);
        (order, clip["startFrame"].as_u64().unwrap_or(0))
    });

    let mut probed_audio: HashMap<String, bool> = HashMap::new();
    for clip in visual_clips {
        let kind = text(clip, "kind").unwrap_or("video");
        let track_id = text(clip, "trackId").unwrap_or("");
        let (_, _, _, muted) =
            track_info
                .get(track_id)
                .cloned()
                .unwrap_or(("video".to_owned(), 0, false, false));
        let (track_gain, track_solo) = track_mix.get(track_id).copied().unwrap_or((0.0, false));
        let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        if clip_seconds <= 0.0 {
            continue;
        }
        let lead_seconds = transition_lead_seconds(clip, project_fps, clip_seconds, start_seconds);
        if kind == "graphic" {
            if input.motion_ass.is_none() || input.motion_ass == Some("") {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "el clip gráfico no tiene un plan de motion; volvé a exportar desde el editor",
                ));
            }
            // The graphic is burned by the motion ASS generated from the plan
            // before the caption pass; it owns no media input here.
            continue;
        }
        let asset_id = clip["source"]["assetId"].as_str().unwrap_or("");
        let asset = asset_by_id.get(asset_id).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "un clip apunta a un material que ya no está en el proyecto",
            )
        })?;
        if asset["status"].as_str() != Some("ready") {
            return Err(ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "hay material sin verificar; confirmá sus derechos y marcalo listo antes de exportar",
            ));
        }
        if asset["rights"]["license"]["commercialUse"].as_str() == Some("unknown") {
            return Err(ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "hay material con licencia desconocida; resolvé sus derechos antes de exportar",
            ));
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let path = resolve_inside_root(input.root, relative)?;
        ensure_asset_unchanged(asset, &path)?;
        let clip_lut = effects_lut(&clip["effects"], input.root)?;
        let stabilization = resolve_stabilization(clip, input.root)?;
        let is_image = kind == "image" || kind == "freeze";
        let speed = clip["speed"].clone();
        let speed_num = speed["num"].as_u64().unwrap_or(1) as u32;
        let speed_den = speed["den"].as_u64().unwrap_or(1) as u32;
        let speed_den = speed_den.max(1);
        let speed_num = speed_num.max(1);
        let blend = clip["blendMode"].as_str().and_then(blend_mode_name);
        let layer_index = if blend.is_some() {
            let index = inputs;
            inputs += 1;
            args.extend([
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                format!(
                    "color=c=black@0.0:s={}x{}:r={}:d={}",
                    profile.width,
                    profile.height,
                    profile.fps_arg(),
                    seconds(duration_seconds)
                ),
            ]);
            Some(index)
        } else {
            None
        };

        if is_image {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-framerate".into(),
                profile.fps_arg(),
                "-t".into(),
                seconds(clip_seconds + lead_seconds),
                "-i".into(),
                path.to_string_lossy().into_owned(),
            ]);
        } else {
            let in_seconds = clip["source"]["inFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
            let source_seconds =
                (clip_seconds + lead_seconds) * (speed_num as f64 / speed_den as f64);
            let seek_seconds =
                (in_seconds - lead_seconds * (speed_num as f64 / speed_den as f64)).max(0.0);
            args.extend([
                "-ss".into(),
                seconds(seek_seconds),
                "-t".into(),
                seconds(source_seconds),
            ]);
            if let Some(decoder) = alpha_video_decoder(asset) {
                args.extend(["-c:v".into(), decoder.into()]);
            }
            args.push("-i".into());
            args.push(path.to_string_lossy().into_owned());
        }
        let index = inputs;
        inputs += 1;
        filters.push(visual_filter(
            index,
            clip,
            asset,
            profile,
            clip_seconds,
            lead_seconds,
            start_seconds,
            speed_num,
            speed_den,
            is_image,
        ));
        if let Some((transform, smoothing)) = stabilization.as_ref() {
            let position = filters.len() - 1;
            let chain = filters[position].clone();
            filters[position] = with_stabilization(chain, index, transform, *smoothing);
        }
        if let Some((lut, intensity)) = clip_lut {
            let position = filters.len() - 1;
            let chain = filters[position].clone();
            filters[position] = apply_lut_to_chain(chain, &format!("v{index}"), &lut, intensity);
        }
        let position = filters.len() - 1;
        let chain = filters[position].clone();
        filters[position] = apply_glow_to_chain(chain, &format!("v{index}"), &clip["effects"]);
        let transform = &clip["transform"];
        let offset_x = offset_expression(clip, "offsetX", start_seconds, project_fps)
            .unwrap_or_else(|| {
                format!(
                    "{:.3}",
                    sanitize_filter_number(number(transform, "offsetX").unwrap_or(0.0))
                )
            });
        let offset_y = offset_expression(clip, "offsetY", start_seconds, project_fps)
            .unwrap_or_else(|| {
                format!(
                    "{:.3}",
                    sanitize_filter_number(number(transform, "offsetY").unwrap_or(0.0))
                )
            });
        let next_label = format!("base{}", index);
        let (animation_x, animation_y) =
            animation_overlay_terms(clip, start_seconds, clip_seconds, profile.fps());
        let overlay_x = match animation_x {
            Some(term) => format!(
                "({})+({term})",
                overlay_x_expression(clip, start_seconds, lead_seconds, &offset_x)
            ),
            None => overlay_x_expression(clip, start_seconds, lead_seconds, &offset_x),
        };
        let overlay_y = overlay_y_expression(
            clip,
            start_seconds,
            lead_seconds,
            &offset_y,
            animation_y.as_deref(),
        );
        // Desplazamiento de un slide congelado por la ventana de un frame.
        let overlay_x = match clip["transitionFrozen"]["x"].as_f64() {
            Some(x) => format!("({overlay_x})+({x:.6})"),
            None => overlay_x,
        };
        let overlay_y = match clip["transitionFrozen"]["y"].as_f64() {
            Some(y) => format!("({overlay_y})+({y:.6})"),
            None => overlay_y,
        };
        let overlay_x = match clip["animationFrozen"]["x"].as_f64() {
            Some(x) => format!("({overlay_x})+({x:.6})"),
            None => overlay_x,
        };
        let overlay_y = match clip["animationFrozen"]["y"].as_f64() {
            Some(y) => format!("({overlay_y})+({y:.6})"),
            None => overlay_y,
        };
        if let (Some(mode), Some(layer)) = (blend, layer_index) {
            filters.push(format!(
                "[{layer}:v]format=rgba,setpts=PTS-STARTPTS[layer{index}]"
            ));
            filters.push(format!(
                "[layer{index}][v{index}]overlay=x='{overlay_x}':y='{overlay_y}':enable='between(t,{:.6},{:.6})':eof_action=pass:shortest=0[blended{index}]",
                (start_seconds - lead_seconds).max(0.0),
                start_seconds + clip_seconds
            ));
            filters.push(format!(
                "[{base_label}][blended{index}]blend=all_mode={mode}:enable='between(t,{:.6},{:.6})'[{next_label}]",
                (start_seconds - lead_seconds).max(0.0),
                start_seconds + clip_seconds
            ));
        } else {
            filters.push(format!(
                "[{base_label}][v{index}]overlay=x='{overlay_x}':y='{overlay_y}':enable='between(t,{:.6},{:.6})':eof_action=pass:shortest=0[{next_label}]",
                (start_seconds - lead_seconds).max(0.0),
                start_seconds + clip_seconds
            ));
        }
        base_label = next_label;

        let has_audio = if is_image {
            false
        } else {
            *probed_audio
                .entry(asset_id.to_owned())
                .or_insert_with(|| has_audio_stream(input.ffprobe, &path))
        };
        if has_audio
            && !muted
            && (!any_solo || track_solo || clip["audio"]["solo"].as_bool().unwrap_or(false))
            && clip["audio"]["muted"].as_bool() != Some(true)
        {
            let track = track_by_id.get(track_id).cloned().unwrap_or(Value::Null);
            let chain = audio_filter(
                index,
                profile,
                clip_seconds,
                lead_seconds,
                start_seconds,
                &clip["audio"],
                clip["reverse"].as_bool().unwrap_or(false),
                speed_num,
                speed_den,
                track_gain,
                &track,
            );
            filters.push(chain.clone());
            audio_filters.push(chain);
            audio_labels.push(format!("[a{index}]"));
            audio_track_ids.push(track_id.to_owned());
        }
    }

    // Adjustment layers grade the composite, not one clip. Each chain gets the
    // same `enable` window, so the grade appears only while its clip is active.
    let mut adjustment_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
            if clip["enabled"].as_bool() == Some(false) {
                return false;
            }
            let track_id = clip["trackId"].as_str().unwrap_or("");
            track_info
                .get(track_id)
                .map(|(kind, _, hidden, _)| kind == "adjustment" && !hidden)
                .unwrap_or(false)
        })
        .collect();
    adjustment_clips.sort_by_key(|clip| {
        let track_id = clip["trackId"].as_str().unwrap_or("");
        let order = track_info.get(track_id).map(|info| info.1).unwrap_or(0);
        (order, clip["startFrame"].as_u64().unwrap_or(0))
    });
    for (index, clip) in adjustment_clips.iter().enumerate() {
        let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        if clip_seconds <= 0.0 {
            continue;
        }
        let grade = adjustment_filters(
            clip,
            input.root,
            start_seconds,
            start_seconds + clip_seconds,
        )?;
        let lut = effects_lut(&clip["effects"], input.root)?;
        if grade.is_empty() && lut.is_none() {
            continue;
        }
        let next_label = format!("adj{}", index);
        let grade_chain = if grade.is_empty() {
            "null".to_owned()
        } else {
            grade.join(",")
        };
        let mut chain = format!("[{base_label}]{grade_chain}[{next_label}]");
        if let Some((lut, intensity)) = lut {
            chain = apply_lut_to_chain_gated(
                chain,
                &next_label,
                &lut,
                intensity,
                Some((start_seconds, start_seconds + clip_seconds)),
            );
        }
        filters.push(chain);
        base_label = next_label;
    }

    let audio_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
            if clip["enabled"].as_bool() == Some(false) {
                return false;
            }
            let track_id = clip["trackId"].as_str().unwrap_or("");
            let audible = track_info
                .get(track_id)
                .map(|(kind, _, _, muted)| matches!(kind.as_str(), "audio" | "narration") && !muted)
                .unwrap_or(false);
            let solo = track_mix
                .get(track_id)
                .map(|(_, solo)| *solo)
                .unwrap_or(false);
            audible && (!any_solo || solo || clip["audio"]["solo"].as_bool().unwrap_or(false))
        })
        .collect();
    for clip in audio_clips {
        let track_id = clip["trackId"].as_str().unwrap_or("");
        let asset_id = clip["source"]["assetId"].as_str().unwrap_or("");
        let asset = asset_by_id.get(asset_id).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "un clip de audio apunta a un material que ya no está en el proyecto",
            )
        })?;
        if asset["status"].as_str() != Some("ready")
            || asset["rights"]["license"]["commercialUse"].as_str() == Some("unknown")
        {
            return Err(ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "hay audio sin derechos verificados; no se puede exportar todavía",
            ));
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let path = resolve_inside_root(input.root, relative)?;
        ensure_asset_unchanged(asset, &path)?;
        let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        if clip_seconds <= 0.0 {
            continue;
        }
        if clip["audio"]["muted"].as_bool() == Some(true) {
            continue;
        }
        let speed = clip["speed"].clone();
        let speed_num = speed["num"].as_u64().unwrap_or(1).max(1) as u32;
        let speed_den = speed["den"].as_u64().unwrap_or(1).max(1) as u32;
        let in_seconds = clip["source"]["inFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let source_seconds = clip_seconds * (speed_num as f64 / speed_den as f64);
        args.extend([
            "-ss".into(),
            seconds(in_seconds),
            "-t".into(),
            seconds(source_seconds),
            "-i".into(),
            path.to_string_lossy().into_owned(),
        ]);
        let index = inputs;
        inputs += 1;
        let (track_gain, _) = track_mix.get(track_id).copied().unwrap_or((0.0, false));
        let track = track_by_id.get(track_id).cloned().unwrap_or(Value::Null);
        let chain = audio_filter(
            index,
            profile,
            clip_seconds,
            0.0,
            start_seconds,
            &clip["audio"],
            clip["reverse"].as_bool().unwrap_or(false),
            speed_num,
            speed_den,
            track_gain,
            &track,
        );
        filters.push(chain.clone());
        audio_filters.push(chain);
        audio_labels.push(format!("[a{index}]"));
        audio_track_ids.push(track_id.to_owned());
    }

    let master_gain = number(&project["audio"]["master"], "gainDb").unwrap_or(0.0);
    let loudness = &project["audio"]["loudnessTarget"];
    // En modo medición no se aplica loudnorm: se mide la mezcla cruda (con su
    // ganancia master) y el delta contra el objetivo se calcula aparte.
    let loudness_filter = if input.audio_only {
        String::new()
    } else if loudness.is_object() {
        let integrated = number(loudness, "integratedLufs")
            .unwrap_or(-14.0)
            .clamp(-33.0, -9.0);
        let true_peak = number(loudness, "truePeakDb")
            .unwrap_or(-1.5)
            .clamp(-9.0, 0.0);
        format!(",loudnorm=I={integrated:.1}:TP={true_peak:.1}:LRA=11")
    } else {
        String::new()
    };
    // Cola de entrega (normalización + limitador): sólo en el export real.
    let delivery_tail = if input.audio_only {
        String::new()
    } else {
        format!("{loudness_filter},alimiter=limit=0.95")
    };
    let silent_index;
    let audio_out_filter;
    if audio_labels.is_empty() {
        silent_index = inputs;
        args.extend([
            "-f".into(),
            "lavfi".into(),
            "-t".into(),
            seconds(duration_seconds),
            "-i".into(),
            format!(
                "anullsrc=channel_layout=stereo:sample_rate={}",
                profile.audio_rate
            ),
        ]);
        audio_out_filter = format!(
            "[{silent_index}:a]aresample={},aformat=sample_fmts=fltp:channel_layouts=stereo,volume={master_gain:.2}dB{delivery_tail}[aout]",
            profile.audio_rate
        );
    } else if audio_labels.len() == 1 {
        audio_out_filter = format!(
            "{}volume={master_gain:.2}dB{delivery_tail}[aout]",
            audio_labels[0]
        );
    } else {
        let ducking = &project["audio"]["ducking"];
        let ducking_enabled = ducking["enabled"].as_bool().unwrap_or(false);
        let source_tracks: Vec<String> = ducking["sourceTrackIds"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let target_tracks: Vec<String> = ducking["targetTrackIds"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let mut source_labels: Vec<String> = Vec::new();
        let mut target_labels: Vec<String> = Vec::new();
        let mut other_labels: Vec<String> = Vec::new();
        for (index, label) in audio_labels.iter().enumerate() {
            let track = audio_track_ids.get(index).map(String::as_str).unwrap_or("");
            if target_tracks.iter().any(|id| id == track) {
                target_labels.push(label.clone());
            } else if source_tracks.iter().any(|id| id == track) {
                source_labels.push(label.clone());
            } else {
                other_labels.push(label.clone());
            }
        }
        if ducking_enabled && !source_labels.is_empty() && !target_labels.is_empty() {
            // Cadenas de audio del ducking: van a ambos grafos (video y
            // medición) porque ambas necesitan el lado y el objetivo unidos.
            let mut ducking_filters: Vec<String> = Vec::new();
            if source_labels.len() == 1 {
                ducking_filters.push(format!("{}asplit=2[duck_side][duck_src]", source_labels[0]));
            } else {
                ducking_filters.push(format!(
                    "{}amix=inputs={}:duration=longest:normalize=0,asplit=2[duck_side][duck_src]",
                    source_labels.join(""),
                    source_labels.len()
                ));
            }
            if target_labels.len() == 1 {
                ducking_filters.push(format!("{}anull[duck_target]", target_labels[0]));
            } else {
                ducking_filters.push(format!(
                    "{}amix=inputs={}:duration=longest:normalize=0[duck_target]",
                    target_labels.join(""),
                    target_labels.len()
                ));
            }
            // sidechaincompress termina con la entrada más corta: sin este
            // apad, la música se cortaba justo cuando terminaba la voz.
            ducking_filters.push("[duck_side]apad[duck_side_padded]".to_owned());
            let amount = number(ducking, "amountDb")
                .unwrap_or(-12.0)
                .clamp(-60.0, 0.0);
            let ratio = (-amount / 1.5).clamp(2.0, 20.0);
            ducking_filters.push(format!(
                "[duck_target][duck_side_padded]sidechaincompress=threshold=0.03:ratio={ratio:.1}:attack=20:release=350[ducked]"
            ));
            filters.extend(ducking_filters.iter().cloned());
            audio_filters.extend(ducking_filters);
            let mut final_labels = vec!["[ducked]".to_owned(), "[duck_src]".to_owned()];
            final_labels.extend(other_labels.iter().cloned());
            audio_out_filter = format!(
                "{}amix=inputs={}:duration=longest:normalize=0,volume={master_gain:.2}dB{delivery_tail}[aout]",
                final_labels.join(""),
                final_labels.len()
            );
        } else {
            audio_out_filter = format!(
                "{}amix=inputs={}:duration=longest:normalize=0,volume={master_gain:.2}dB{delivery_tail}[aout]",
                audio_labels.join(""),
                audio_labels.len()
            );
        }
    }
    filters.push(audio_out_filter.clone());
    audio_filters.push(audio_out_filter);

    // Modo medición: el grafo es sólo audio y la salida es PCM f32le por
    // stdout. Sin cadena de video, sin subtítulos, sin LUT: lo que se mide es
    // exactamente la mezcla que el export entrega antes de loudnorm.
    if input.audio_only {
        args.push("-filter_complex".into());
        args.push(audio_filters.join(";"));
        args.extend(["-map".into(), "[aout]".into()]);
        args.extend([
            "-ar".into(),
            profile.audio_rate.to_string(),
            "-ac".into(),
            profile.audio_channels.to_string(),
            "-f".into(),
            "f32le".into(),
        ]);
        if output_start_seconds > 0.0001 {
            args.extend(["-ss".into(), seconds(output_start_seconds)]);
        }
        args.extend(["-t".into(), seconds(output_duration_seconds)]);
        args.push("-".into());
        return Ok(RenderPlan {
            args,
            output_path: PathBuf::new(),
            working_dir: input.temp_dir.to_path_buf(),
            duration_seconds: output_duration_seconds,
            min_output_bytes: 0,
            duration_tolerance_seconds: (profile.duration_tolerance_frames as f64 / profile.fps())
                .max(0.25),
            width: profile.width,
            height: profile.height,
            fps: profile.fps(),
            profile_name: profile.name.clone(),
        });
    }

    let ass = if input.include_captions {
        build_ass(CaptionInput {
            project,
            render_width: profile.width,
            render_height: profile.height,
            project_width,
            project_fps,
        })
    } else {
        String::new()
    };
    let look_filters = project_look_filters(project, input.root)?;
    let look_lut = effects_lut(&project["look"], input.root)?;
    let graded_label = if look_filters.is_empty() && look_lut.is_none() {
        base_label.clone()
    } else {
        let grade_chain = if look_filters.is_empty() {
            "null".to_owned()
        } else {
            look_filters.join(",")
        };
        let mut chain = format!("[{base_label}]{grade_chain}[look]");
        if let Some((lut, intensity)) = look_lut {
            chain = apply_lut_to_chain(chain, "look", &lut, intensity);
        }
        filters.push(chain);
        "look".to_owned()
    };
    let mut video_label = graded_label.clone();
    if let Some(motion_ass) = input.motion_ass.filter(|value| !value.is_empty()) {
        std::fs::write(input.temp_dir.join("motion.ass"), motion_ass).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar el motion graphics del render",
            )
        })?;
        filters.push(format!("[{video_label}]ass=motion.ass[motion]"));
        video_label = "motion".to_owned();
    }
    if ass.is_empty() {
        filters.push(format!("[{video_label}]format=yuv420p[vout]"));
    } else {
        std::fs::write(input.temp_dir.join("captions.ass"), ass).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar el archivo de subtítulos para el render",
            )
        })?;
        filters.push(format!(
            "[{video_label}]ass=captions.ass,format=yuv420p[vout]"
        ));
    }

    args.push("-filter_complex".into());
    args.push(filters.join(";"));
    args.extend([
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[aout]".into(),
    ]);
    if let Some(mut hardware) = hardware_encoder_args(&profile) {
        args.append(&mut hardware);
    } else {
        args.extend([
            "-c:v".into(),
            if profile.video_codec == "h265" {
                "libx265"
            } else {
                "libx264"
            }
            .into(),
            "-preset".into(),
            profile.video_preset.clone(),
        ]);
        if let Some(crf) = profile.crf {
            args.extend(["-crf".into(), crf.to_string()]);
        }
        if let Some(bps) = profile.target_bps {
            args.extend(["-b:v".into(), bps.to_string()]);
        }
    }
    if profile.video_codec == "h265" {
        args.extend(["-tag:v".into(), "hvc1".into()]);
    }
    args.extend([
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-r".into(),
        profile.fps_arg(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        profile.audio_bps.to_string(),
        "-ar".into(),
        profile.audio_rate.to_string(),
        "-ac".into(),
        profile.audio_channels.to_string(),
        "-map_metadata".into(),
        "-1".into(),
        "-movflags".into(),
        "+faststart".into(),
    ]);
    if output_start_seconds > 0.0001 {
        args.extend(["-ss".into(), seconds(output_start_seconds)]);
    }
    args.extend([
        "-t".into(),
        seconds(output_duration_seconds),
        input.output_path.to_string_lossy().into_owned(),
    ]);

    Ok(RenderPlan {
        args,
        output_path: input.output_path.to_path_buf(),
        working_dir: input.temp_dir.to_path_buf(),
        duration_seconds: output_duration_seconds,
        min_output_bytes: profile.min_output_bytes,
        duration_tolerance_seconds: (profile.duration_tolerance_frames as f64 / profile.fps())
            .max(0.25),
        width: profile.width,
        height: profile.height,
        fps: profile.fps(),
        profile_name: profile.name.clone(),
    })
}

pub fn spawn(ffmpeg: &Path, plan: &RenderPlan) -> Result<Child, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .args(&plan.args)
        .current_dir(&plan.working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Sin consola y en prioridad baja: el render cede CPU a la UI, al
        // preview y a la IA mientras la persona sigue trabajando.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    command.spawn().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo iniciar ffmpeg; revisá la ruta en Ajustes → Herramientas",
        )
    })
}

fn parse_progress_time(line: &str) -> Option<f64> {
    let (key, value) = line.split_once('=')?;
    match key.trim() {
        "out_time_us" | "out_time_ms" => value
            .trim()
            .parse::<f64>()
            .ok()
            .map(|micros| micros / 1_000_000.0),
        "out_time" => {
            let parts: Vec<&str> = value.trim().split(':').collect();
            if parts.len() != 3 {
                return None;
            }
            let hours: f64 = parts[0].parse().ok()?;
            let minutes: f64 = parts[1].parse().ok()?;
            let secs: f64 = parts[2].parse().ok()?;
            Some(hours * 3600.0 + minutes * 60.0 + secs)
        }
        _ => None,
    }
}

pub fn progress_from_line(line: &str, total_seconds: f64) -> Option<RenderProgress> {
    let processed = parse_progress_time(line)?;
    let total = total_seconds.max(0.001);
    Some(RenderProgress {
        percent: ((processed / total) * 100.0).clamp(0.0, 99.9),
        processed_seconds: processed.max(0.0),
        total_seconds,
    })
}

fn probe_output(ffprobe: &Path, output: &Path) -> Result<(f64, u32, u32), ProjectError> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(output)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let payload = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo verificar el archivo exportado con ffprobe",
        )
    })?;
    if !payload.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffprobe no pudo leer el archivo exportado",
        ));
    }
    let value: Value = serde_json::from_slice(&payload.stdout).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la verificación del archivo exportado no se pudo interpretar",
        )
    })?;
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el archivo exportado no declara duración",
            )
        })?;
    let width = value["streams"][0]["width"].as_u64().unwrap_or(0) as u32;
    let height = value["streams"][0]["height"].as_u64().unwrap_or(0) as u32;
    Ok((duration, width, height))
}

/// El mínimo del perfil es un guardia contra archivos vacíos, pensado para
/// contenido lleno. Un clip corto con máscara poligonal puede ser válido y
/// pesar mucho menos que ese mínimo porque la mayor parte del cuadro es fondo;
/// el umbral se escala con la duración (10 KB por segundo) sin superar el valor
/// configurado. Un clip de 5 s exige 50 KB en vez de 500 KB; uno de 60 s
/// conserva el umbral completo.
fn effective_min_output_bytes(configured: u64, duration_seconds: f64) -> u64 {
    let scaled = (duration_seconds.max(1.0) * 10_000.0).round() as u64;
    configured.min(scaled)
}

pub fn verify_output(
    ffprobe: &Path,
    plan: &RenderPlan,
) -> Result<RenderVerification, ProjectError> {
    let metadata = std::fs::metadata(&plan.output_path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg terminó pero el archivo exportado no existe",
        )
    })?;
    let minimum = effective_min_output_bytes(plan.min_output_bytes, plan.duration_seconds);
    if metadata.len() < minimum {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo exportado es más chico que el mínimo del perfil",
        ));
    }
    let (duration, width, height) = probe_output(ffprobe, &plan.output_path)?;
    if (duration - plan.duration_seconds).abs() > plan.duration_tolerance_seconds {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la duración del archivo exportado no coincide con la timeline",
        ));
    }
    if width != plan.width || height != plan.height {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la resolución del archivo exportado no coincide con el perfil",
        ));
    }
    Ok(RenderVerification {
        output_bytes: metadata.len(),
        duration_seconds: duration,
        width,
        height,
    })
}

/// Synchronous execution used by tests and by the single non-cancellable path.
pub fn execute_sync(
    ffmpeg: &Path,
    ffprobe: &Path,
    plan: &RenderPlan,
    mut on_progress: impl FnMut(RenderProgress),
) -> Result<RenderVerification, ProjectError> {
    let mut child = spawn(ffmpeg, plan)?;
    let stderr_reader = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        })
    });
    if let Some(stdout) = child.stdout.take() {
        let reader = std::io::BufReader::new(stdout);
        use std::io::BufRead;
        for line in reader.lines().map_while(Result::ok) {
            if let Some(progress) = progress_from_line(&line, plan.duration_seconds) {
                on_progress(progress);
            }
        }
    }
    let status = child.wait().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg no terminó correctamente",
        )
    })?;
    let stderr_text = stderr_reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    if !status.success() {
        let tail = sanitize_log(&stderr_text, &plan.working_dir, 500);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("ffmpeg devolvió un error durante el render: {tail}"),
        ));
    }
    verify_output(ffprobe, plan)
}

pub fn sanitize_log(text: &str, root: &Path, limit: usize) -> String {
    let root_text = root.to_string_lossy();
    let mut sanitized = text.replace(root_text.as_ref(), "<proyecto>");
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home = home.to_string_lossy();
        sanitized = sanitized.replace(home.as_ref(), "<usuario>");
    }
    let lines: Vec<&str> = sanitized
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail = lines
        .iter()
        .rev()
        .take(8)
        .rev()
        .copied()
        .collect::<Vec<_>>()
        .join(" | ");
    tail.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::subtitles::ass_time;

    fn profile() -> Profile {
        Profile {
            id: "p".into(),
            name: "YouTube 1080p".into(),
            width: 1920,
            height: 1080,
            fps_num: 30,
            fps_den: 1,
            crf: Some(20),
            target_bps: None,
            video_preset: "veryfast".into(),
            fit: "contain".into(),
            audio_bps: 128_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 100,
            duration_tolerance_frames: 10,
            hardware_encoder: None,
        }
    }

    #[test]
    fn visual_effects_reach_the_filter_chain() {
        let profile = profile();
        let clip = serde_json::json!({
            "effects": {
                "brightness": 0.2,
                "contrast": 1.1,
                "saturation": 1.2,
                "temperature": 0.3,
                "vignette": 0.4,
                "sharpen": 1.0,
                "blur": 2.0,
                "sepia": true,
                "hueRotateDeg": 25,
                "shadows": 0.2,
                "highlights": -0.3,
                "fade": 0.1,
                "curvePreset": "vintage",
                "fadeInFrames": 15,
                "fadeOutFrames": 30,
                "lift": { "r": 0.05, "g": 0.0, "b": 0.08 },
                "gamma": { "r": 0.1, "g": 0.0, "b": -0.05 },
                "gain": { "r": 0.08, "g": 0.0, "b": -0.03 },
                "hsl": { "hue": 8, "saturation": 0.1, "intensity": 0.05, "colors": ["r", "y"] },
                "colorMatch": { "r": 1.1, "g": 1.0, "b": 0.95, "strength": 0.8 },
                "lensCorrection": { "k1": -0.12, "k2": 0.04, "cx": 0.5, "cy": 0.5 },
                "relight": { "x": 0.0, "y": -0.1, "radius": 0.45, "strength": 0.4, "warmth": 0.2, "feather": 0.35 }
            }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile,
            3.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(filter.contains("eq=brightness=0.2000"));
        assert!(filter.contains("colorbalance=rs=0.0750"));
        assert!(filter.contains("gblur=sigma=2.000"));
        assert!(filter.contains("unsharp=5:5:1.000"));
        assert!(filter.contains("vignette=PI/"));
        assert!(filter.contains("lenscorrection=k1=-0.1200:k2=0.0400:cx=0.500:cy=0.500:i=bilinear"));
        assert!(filter.contains("geq=r='clip(r(X,Y)+"));
        assert!(filter.contains(":a='alpha(X,Y)'"));
        assert!(filter.contains("colorchannelmixer=rr=0.393"));
        assert!(filter.contains("hue=h=25.00"));
        assert!(filter.contains("curves=master='0.0000/0.0100"));
        assert!(filter.contains("0.7500/0.7120"));
        assert!(filter.contains("curves=preset=vintage"));
        assert!(filter.contains("gamma_r="));
        assert!(filter.contains("colorbalance=rs="));
        assert!(filter.contains("huesaturation="));
        assert!(filter.contains("colors=r+y"));
        assert!(filter.contains("colorchannelmixer=rr="));
        assert!(filter.contains("fade=t=in:st=0:d=0.500:alpha=1"));
        assert!(filter.contains("fade=t=out:st=2.000:d=1.000:alpha=1"));
    }

    #[test]
    fn offset_wheel_maps_to_colorbalance_mids() {
        let profile = profile();
        let clip = serde_json::json!({
            "assetId": "a1",
            "effects": {
                "lift": { "r": 0.0, "g": 0.0, "b": 0.0 },
                "offset": { "r": 0.10, "g": -0.20, "b": 0.05 }
            }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile,
            3.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(
            filter.contains(
                "colorbalance=rs=0.0000:gs=0.0000:bs=0.0000:rm=0.1000:gm=-0.2000:bm=0.0500"
            ),
            "la rueda Offset debe mapear a los mids de colorbalance: {filter}"
        );
    }

    #[test]
    fn alpha_assets_use_the_libvpx_decoder() {
        let cutout = serde_json::json!({ "media": { "alpha": true } });
        assert_eq!(alpha_video_decoder(&cutout), Some("libvpx-vp9"));
        let normal = serde_json::json!({ "media": { "width": 320 } });
        assert_eq!(alpha_video_decoder(&normal), None);
    }

    #[test]
    fn text_mask_builds_a_drawtext_alpha_graph() {
        assert_eq!(drawtext_text("a'b:c"), "a’b c");
        assert_eq!(drawtext_text("  HOLA   MUNDO  "), "HOLA MUNDO");
        if text_mask_font().is_none() {
            eprintln!("sin fuente TTF; se omite la comprobación de drawtext");
            return;
        }
        let clip = serde_json::json!({
            "mask": {
                "shape": "text",
                "x": 0.0,
                "y": 0.0,
                "width": 1,
                "height": 1,
                "feather": 0.2,
                "invert": false,
                "text": "HOLA: MUNDO",
                "fontScale": 0.25
            }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(filter.contains("drawtext=fontfile='"), "cadena: {filter}");
        assert!(filter.contains("text='HOLA MUNDO'"), "cadena: {filter}");
        assert!(filter.contains("alphaextract,gblur=sigma=4.000"));
        assert!(filter.contains("alphamerge,format=rgba"));
        assert!(filter.contains("setpts=PTS-STARTPTS+0.000000/TB[v0]"));
    }

    #[test]
    fn glow_and_motion_blur_reach_the_render_chain() {
        let clip = serde_json::json!({
            "effects": {
                "motionBlur": { "frames": 4, "intensity": 0.6 },
                "glow": { "intensity": 0.7, "radius": 24, "threshold": 0.5 }
            }
        });
        let filter = visual_filter(
            2,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(
            filter.contains("tmix=frames=4:weights='"),
            "cadena: {filter}"
        );
        let glow = apply_glow_to_chain(filter, "v2", &clip["effects"]);
        assert!(
            glow.contains("split=3[v2base][v2glow][v2alpha]"),
            "glow: {glow}"
        );
        assert!(glow.contains("alphaextract[v2amask]"));
        assert!(glow.contains("colorlevels=rimin=0.5000"));
        assert!(glow.contains("gblur=sigma=24.000"));
        assert!(glow.contains("blend=all_mode=screen:all_opacity=0.7000[v2blended]"));
        assert!(glow.contains("alphamerge,format=rgba[v2]"));

        let plain = visual_filter(
            2,
            &serde_json::json!({}),
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert_eq!(
            apply_glow_to_chain(plain.clone(), "v2", &serde_json::json!({})),
            plain
        );
    }

    #[test]
    fn slow_motion_smoothing_interpolates_only_below_one_x() {
        let profile = profile();
        let clip = serde_json::json!({
            "assetId": "a1",
            "speed": { "num": 1, "den": 2 },
            "slowMotionSmoothing": true,
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile,
            2.0,
            0.0,
            0.0,
            1,
            2,
            false,
        );
        let setpts = filter
            .find("setpts=(PTS-STARTPTS)*2/1")
            .expect("setpts de 0.5×");
        let interpolation = filter.find("minterpolate=fps=").expect("interpolación");
        assert!(
            interpolation > setpts,
            "la interpolación va después de setpts"
        );
        assert!(filter.contains("mi_mode=mci"));
        assert!(filter.contains("mc_mode=aobmc"));

        let fast = serde_json::json!({
            "speed": { "num": 2, "den": 1 },
            "slowMotionSmoothing": true,
        });
        let filter = visual_filter(
            0,
            &fast,
            &serde_json::json!({}),
            &profile,
            1.0,
            0.0,
            0.0,
            2,
            1,
            false,
        );
        assert!(!filter.contains("minterpolate"), "acelerar no interpola");

        let plain = serde_json::json!({ "speed": { "num": 1, "den": 2 } });
        let filter = visual_filter(
            0,
            &plain,
            &serde_json::json!({}),
            &profile,
            2.0,
            0.0,
            0.0,
            1,
            2,
            false,
        );
        assert!(
            !filter.contains("minterpolate"),
            "sin la marca no interpola"
        );
    }

    #[test]
    fn project_look_builds_a_global_grade_without_clips() {
        let project = serde_json::json!({
            "look": {
                "brightness": 0.15,
                "contrast": 1.2,
                "saturation": 1.3,
                "temperature": 0.4,
                "vignette": 0.3,
                "sharpen": 1.2,
                "curvePreset": "contrast-strong",
                "shadows": -0.2,
                "highlights": 0.3,
                "fade": 0.1,
                "grayscale": true
            }
        });
        let root = Path::new("C:/obra");
        let filters = project_look_filters(&project, root).unwrap();
        let joined = filters.join(",");
        assert!(joined.contains("eq=brightness=0.1500:contrast=1.2000:saturation=1.3000"));
        assert!(joined.contains("colorbalance=rs=0.1000:bs=-0.1000"));
        assert!(joined.contains("curves=master='"));
        assert!(joined.contains("curves=preset=strong_contrast"));
        assert!(joined.contains("unsharp=5:5:1.200"));
        assert!(joined.contains("vignette=PI/"));
        assert!(joined.contains("hue=s=0"));
        assert!(project_look_filters(&serde_json::json!({}), root)
            .unwrap()
            .is_empty());
        assert!(
            project_look_filters(&serde_json::json!({ "look": {} }), root)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn project_look_resolves_lut_and_rejects_escapes() {
        let root = std::env::temp_dir().join(format!("editor-ia-look-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("media/luts")).unwrap();
        std::fs::write(root.join("media/luts/x.cube"), b"LUT_3D_SIZE 2\n").unwrap();
        let project = serde_json::json!({
            "look": { "lutFile": "media/luts/x.cube", "lutIntensity": 0.4 }
        });
        let (path, intensity) = effects_lut(&project["look"], &root).unwrap().unwrap();
        assert!(path.ends_with("x.cube"));
        assert!((intensity - 0.4).abs() < 1e-9);
        let escaping = serde_json::json!({ "look": { "lutFile": "../x.cube" } });
        assert!(effects_lut(&escaping["look"], &root).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    fn project_with_adjustment(hidden: bool) -> Value {
        let mut project = project();
        project["timeline"]["tracks"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "adj1", "kind": "adjustment", "order": 2,
                "hidden": hidden, "muted": false
            }));
        project["timeline"]["clips"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "adjclip", "trackId": "adj1", "kind": "adjustment",
                "startFrame": 15, "durationFrames": 30,
                "source": { "type": "adjustment" },
                "effects": { "contrast": 1.3, "curvePreset": "vintage" }
            }));
        project
    }

    #[test]
    fn adjustment_layers_grade_the_composite_inside_their_window() {
        let project = project_with_adjustment(false);
        let root = std::env::temp_dir().join(format!("editor-ia-adj-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan con capa de ajuste debería construirse");
        let graph = plan
            .args
            .iter()
            .find(|arg| arg.contains("curves=preset=vintage"))
            .expect("falta el grade de la capa de ajuste");
        assert!(graph.contains("eq=brightness=0.0000:contrast=1.3000"));
        assert!(graph.contains("curves=preset=vintage:enable='between(t,0.500000,1.500000)'"));
        assert!(
            graph.contains("[adj0]"),
            "la cadena ajustada no se conectó: {graph}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn muted_clip_audio_leaves_the_mix() {
        let root = std::env::temp_dir().join(format!("editor-ia-mute-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan_for = |project: &Value| {
            build_plan(BuildPlanInput {
                audio_only: false,
                project,
                root: &root,
                profile: &profile(),
                output_path: &root.join("salida.mp4"),
                include_captions: false,
                temp_dir: &temp,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("el plan debería construirse")
        };
        let mut project = project();
        project["timeline"]["clips"][1]["audio"] = serde_json::json!({ "muted": true });
        assert_eq!(
            project["timeline"]["clips"][1]["id"],
            serde_json::json!("c2")
        );
        assert_eq!(
            project["timeline"]["clips"][1]["audio"]["muted"],
            serde_json::json!(true)
        );
        let muted = plan_for(&project);
        let muted_args = muted.args.join(" ");
        let muted_graph = muted
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .expect("falta el grafo de audio");
        assert!(
            muted_args.contains("anullsrc"),
            "el clip mudo debería dejar sólo el silencio: {muted_args}"
        );
        assert!(
            !muted_graph.contains("amix"),
            "el clip mudo no debería entrar al mix: {muted_graph}"
        );

        project["timeline"]["clips"][1]["audio"] = serde_json::json!({ "gainDb": -3 });
        let sounding = plan_for(&project);
        let sounding_graph = sounding
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .expect("falta el grafo de audio");
        assert!(
            sounding_graph.contains("volume=-3.00dB"),
            "sin mute el audio debería conservar su ganancia: {sounding_graph}"
        );
        assert!(
            !muted_graph.contains("volume=-3.00dB"),
            "el mute no debería dejar pasar la ganancia del clip: {muted_graph}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn compound_audio_is_muted_by_its_outer_track_in_the_plan() {
        let root =
            std::env::temp_dir().join(format!("editor-ia-compound-mute-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan_for = |project: &Value| {
            build_plan(BuildPlanInput {
                audio_only: false,
                project,
                root: &root,
                profile: &profile(),
                output_path: &root.join("salida.mp4"),
                include_captions: false,
                temp_dir: &temp,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("el plan debería construirse")
        };
        let mut project = project();
        let inner = project["timeline"]["clips"].clone();
        project["timeline"]["clips"] = serde_json::json!([{
            "id": "outer", "trackId": "v1", "kind": "compound",
            "startFrame": 0, "durationFrames": 30,
            "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" }
        }]);
        project["compounds"] = serde_json::json!([{
            "id": "99999999-9999-4999-8999-999999999999",
            "label": "Grupo", "durationFrames": 30, "clips": inner
        }]);

        project["timeline"]["tracks"][0]["muted"] = serde_json::json!(true);
        let muted = plan_for(&project);
        let muted_args = muted.args.join(" ");
        assert!(
            muted_args.contains("anullsrc"),
            "el compuesto en una pista muda no debería aportar audio: {muted_args}"
        );
        assert!(
            !muted_args.contains("audio.wav"),
            "el clip de audio interno no debería entrar al grafo: {muted_args}"
        );

        project["timeline"]["tracks"][0]["muted"] = serde_json::json!(false);
        let sounding = plan_for(&project);
        let sounding_args = sounding.args.join(" ");
        assert!(
            !sounding_args.contains("anullsrc"),
            "sin mute el audio interno debería conservarse: {sounding_args}"
        );
        assert!(
            sounding_args.contains("audio.wav"),
            "sin mute el clip de audio interno debería ser un input: {sounding_args}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn compound_audio_is_soloed_by_its_outer_track_in_the_plan() {
        let root =
            std::env::temp_dir().join(format!("editor-ia-compound-solo-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        std::fs::write(media.join("music.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan_for = |project: &Value| {
            build_plan(BuildPlanInput {
                audio_only: false,
                project,
                root: &root,
                profile: &profile(),
                output_path: &root.join("salida.mp4"),
                include_captions: false,
                temp_dir: &temp,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("el plan debería construirse")
        };
        let mut project = project();
        let inner = project["timeline"]["clips"].clone();
        project["timeline"]["tracks"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "a2", "kind": "audio", "order": 2, "hidden": false, "muted": false
            }));
        project["timeline"]["clips"] = serde_json::json!([
            {
                "id": "outer", "trackId": "v1", "kind": "compound",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" }
            },
            {
                "id": "music", "trackId": "a2", "kind": "audio",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "asset3", "inFrame": 0, "outFrame": 30 }
            }
        ]);
        project["assets"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "asset3", "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/music.wav" }
            }));
        project["compounds"] = serde_json::json!([{
            "id": "99999999-9999-4999-8999-999999999999",
            "label": "Grupo", "durationFrames": 30, "clips": inner
        }]);

        project["timeline"]["tracks"][0]["solo"] = serde_json::json!(true);
        let soloed = plan_for(&project);
        let soloed_args = soloed.args.join(" ");
        assert!(
            soloed_args.contains("audio.wav"),
            "el audio interno debería sonar con el solo de la pista exterior: {soloed_args}"
        );
        assert!(
            !soloed_args.contains("music.wav"),
            "el solo del compuesto debería excluir la música: {soloed_args}"
        );

        project["timeline"]["tracks"][0]["solo"] = serde_json::json!(false);
        let both = plan_for(&project);
        let both_args = both.args.join(" ");
        assert!(
            both_args.contains("audio.wav") && both_args.contains("music.wav"),
            "sin solo deberían mezclarse el audio interno y la música: {both_args}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn disabled_clips_are_skipped_by_the_render_graph() {
        let mut project = project();
        project["timeline"]["clips"][0]["enabled"] = serde_json::json!(false);
        let root = std::env::temp_dir().join(format!("editor-ia-off-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan con clip desactivado debería construirse");
        let joined = plan.args.join(" ");
        assert!(
            !joined.contains("media/video.mp4"),
            "el clip desactivado no debería entrar como input: {joined}"
        );
        assert!(plan.args.iter().any(|arg| arg.contains("[aout]")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn freeze_clips_render_as_looped_stills_inside_the_video_track() {
        let mut project = project();
        project["timeline"]["clips"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "freeze1", "trackId": "v1", "kind": "freeze",
                "label": "Congelado", "startFrame": 30, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "asset3" },
                "transitionIn": { "type": "dissolve", "frames": 6 },
                "effects": { "brightness": 0.1, "saturation": 1.1 }
            }));
        project["assets"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "asset3", "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/frame.png" }
            }));
        let root = std::env::temp_dir().join(format!("editor-ia-freeze-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        std::fs::write(media.join("frame.png"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan con freeze debería construirse");
        let freeze_index = plan
            .args
            .iter()
            .position(|arg| arg.ends_with("frame.png"))
            .expect("el PNG del freeze no entró como input");
        assert_eq!(plan.args[freeze_index - 7], "-loop");
        assert_eq!(plan.args[freeze_index - 6], "1");
        let graph = plan
            .args
            .iter()
            .find(|arg| arg.contains("brightness=0.1000"))
            .expect("falta el filtro del freeze");
        assert!(graph.contains("saturation=1.1000"));
        assert!(
            graph.contains("between(t,0.800000,2.000000)"),
            "el freeze no respeta el solape de entrada: {graph}"
        );
        assert_eq!(
            transition_lead_seconds(
                &serde_json::json!({
                    "kind": "freeze",
                    "transitionIn": { "type": "dissolve", "frames": 6 }
                }),
                30.0,
                1.0,
                1.0
            ),
            0.2
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn hidden_adjustment_layers_do_not_grade_the_composite() {
        let project = project_with_adjustment(true);
        let root = std::env::temp_dir().join(format!("editor-ia-adj-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan debería construirse");
        let graph = plan
            .args
            .iter()
            .find(|arg| arg.contains("[base"))
            .map(String::as_str)
            .unwrap_or("");
        assert!(!graph.contains("contrast=1.3000"));
        assert!(!graph.contains("curves=preset=vintage"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn compounds_on_hidden_tracks_do_not_reveal_their_inner_clips() {
        let mut project = serde_json::json!({
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": true, "muted": false },
                    { "id": "g1", "kind": "graphic", "order": 1, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "outer", "trackId": "v1", "kind": "compound", "startFrame": 10, "durationFrames": 20, "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" } },
                    { "id": "base", "trackId": "g1", "kind": "image", "startFrame": 0, "durationFrames": 30 }
                ]
            },
            "compounds": [
                { "id": "99999999-9999-4999-8999-999999999999", "label": "Grupo", "durationFrames": 20,
                  "clips": [{ "id": "inner", "trackId": "g1", "kind": "image", "startFrame": 0, "durationFrames": 20 }] }
            ]
        });
        let expanded = expand_compounds(&project).expect("la expansión no debería fallar");
        let clips = expanded["timeline"]["clips"].as_array().unwrap();
        assert!(
            clips.iter().all(|clip| clip["id"] != "inner"),
            "una pista oculta no debe revelar los clips internos del compuesto"
        );
        assert!(clips.iter().all(|clip| clip["id"] != "outer"));
        assert!(clips.iter().any(|clip| clip["id"] == "base"));

        project["timeline"]["tracks"][0]["hidden"] = serde_json::json!(false);
        let expanded = expand_compounds(&project).expect("la expansión no debería fallar");
        let clips = expanded["timeline"]["clips"].as_array().unwrap();
        let inner = clips
            .iter()
            .find(|clip| clip["id"] == "inner")
            .expect("un compuesto visible debe expandirse");
        assert_eq!(inner["startFrame"], serde_json::json!(10));
    }

    #[test]
    fn compound_audio_follows_the_outer_track_mute() {
        let mut project = serde_json::json!({
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": true },
                    { "id": "v2", "kind": "video", "order": 1, "hidden": false, "muted": false },
                    { "id": "a1", "kind": "audio", "order": 2, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "outer", "trackId": "v1", "kind": "compound", "startFrame": 0, "durationFrames": 20, "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" } }
                ]
            },
            "compounds": [
                { "id": "99999999-9999-4999-8999-999999999999", "label": "Grupo", "durationFrames": 20,
                  "clips": [
                    { "id": "inner-video", "trackId": "v2", "kind": "video", "startFrame": 0, "durationFrames": 20 },
                    { "id": "inner-audio", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 20 }
                  ] }
            ]
        });
        let expanded = expand_compounds(&project).expect("la expansión no debería fallar");
        let clips = expanded["timeline"]["clips"].as_array().unwrap();
        for id in ["inner-video", "inner-audio"] {
            let clip = clips
                .iter()
                .find(|clip| clip["id"] == id)
                .unwrap_or_else(|| panic!("falta {id} en la expansión"));
            assert_eq!(
                clip["audio"]["muted"],
                serde_json::json!(true),
                "{id} debe heredar el mute de la pista exterior"
            );
        }

        project["timeline"]["tracks"][0]["muted"] = serde_json::json!(false);
        let expanded = expand_compounds(&project).expect("la expansión no debería fallar");
        let clips = expanded["timeline"]["clips"].as_array().unwrap();
        for id in ["inner-video", "inner-audio"] {
            let clip = clips
                .iter()
                .find(|clip| clip["id"] == id)
                .expect("clip interno");
            assert_ne!(
                clip["audio"]["muted"],
                serde_json::json!(true),
                "{id} no debe quedar mudo si la pista exterior no lo está"
            );
        }
    }

    #[test]
    fn compound_audio_follows_the_outer_track_solo() {
        let mut project = serde_json::json!({
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false, "solo": true },
                    { "id": "v2", "kind": "video", "order": 1, "hidden": false, "muted": false },
                    { "id": "a1", "kind": "audio", "order": 2, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "outer", "trackId": "v1", "kind": "compound", "startFrame": 0, "durationFrames": 20, "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" } }
                ]
            },
            "compounds": [
                { "id": "99999999-9999-4999-8999-999999999999", "label": "Grupo", "durationFrames": 20,
                  "clips": [
                    { "id": "inner-video", "trackId": "v2", "kind": "video", "startFrame": 0, "durationFrames": 20 },
                    { "id": "inner-audio", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 20 }
                  ] }
            ]
        });
        let expanded = expand_compounds(&project).expect("la expansión no debería fallar");
        let clips = expanded["timeline"]["clips"].as_array().unwrap();
        for id in ["inner-video", "inner-audio"] {
            let clip = clips
                .iter()
                .find(|clip| clip["id"] == id)
                .unwrap_or_else(|| panic!("falta {id} en la expansión"));
            assert_eq!(
                clip["audio"]["solo"],
                serde_json::json!(true),
                "{id} debe heredar el solo de la pista exterior"
            );
        }

        project["timeline"]["tracks"][0]["solo"] = serde_json::json!(false);
        let expanded = expand_compounds(&project).expect("la expansión no debería fallar");
        let clips = expanded["timeline"]["clips"].as_array().unwrap();
        for id in ["inner-video", "inner-audio"] {
            let clip = clips
                .iter()
                .find(|clip| clip["id"] == id)
                .expect("clip interno");
            assert_ne!(
                clip["audio"]["solo"],
                serde_json::json!(true),
                "{id} no debe quedar en solo si la pista exterior no lo está"
            );
        }
    }

    #[test]
    fn tone_curve_is_neutral_when_unset_and_clamps_values() {
        assert!(tone_curve_filter(&serde_json::json!({})).is_none());
        assert!(tone_curve_filter(&serde_json::json!({
            "shadows": 0.0,
            "highlights": 0.0,
            "fade": 0.0
        }))
        .is_none());
        let curve = tone_curve_filter(&serde_json::json!({
            "shadows": 2,
            "highlights": -2,
            "fade": 2
        }))
        .expect("la curva de tono debería existir");
        assert!(curve.contains("0.0000/0.1000"));
        assert!(curve.contains("0.2500/0.4200"));
        assert!(curve.contains("0.7500/0.6100"));
        assert!(curve.contains("1.0000/0.9500"));
    }

    #[test]
    fn custom_curves_reach_the_filter_chain_and_override_the_preset() {
        let clip = serde_json::json!({
            "effects": {
                "curvePreset": "vintage",
                "curves": {
                    "master": [
                        { "x": 0, "y": 0 },
                        { "x": 0.25, "y": 0.18 },
                        { "x": 0.5, "y": 0.55 },
                        { "x": 1, "y": 1 }
                    ],
                    "red": [
                        { "x": 0, "y": 0.02 },
                        { "x": 1, "y": 0.98 }
                    ]
                }
            }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            3.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(
            filter.contains(
                "curves=master='0.0000/0.0000 0.2500/0.1800 0.5000/0.5500 1.0000/1.0000':red='0.0000/0.0200 1.0000/0.9800'"
            ),
            "curvas inesperadas: {filter}"
        );
        assert!(
            !filter.contains("curves=preset="),
            "la curva personalizada debe tener prioridad sobre el preset"
        );
    }

    #[test]
    fn custom_curves_sort_clamp_and_ignore_short_channels() {
        let clip = serde_json::json!({
            "effects": {
                "curvePreset": "darker",
                "curves": {
                    "master": [
                        { "x": 1, "y": 2 },
                        { "x": 0.5, "y": -1 },
                        { "x": 0, "y": 0 }
                    ],
                    "blue": [{ "x": 0, "y": 0 }]
                }
            }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(
            filter.contains("curves=master='0.0000/0.0000 0.5000/0.0000 1.0000/1.0000'"),
            "curvas sin ordenar ni acotar: {filter}"
        );
        assert!(!filter.contains("blue='"), "un canal corto no se emite");
    }

    #[test]
    fn an_invalid_custom_curve_falls_back_to_the_preset() {
        let clip = serde_json::json!({
            "effects": {
                "curvePreset": "darker",
                "curves": { "master": [{ "x": 0.2, "y": 0.2 }, { "x": 1, "y": 1 }] }
            }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(filter.contains("curves=preset=darker"));
        assert!(!filter.contains("curves=master="));
    }

    #[test]
    fn clip_animations_reach_the_filters_and_overlay_terms() {
        let profile = profile();
        let slide = serde_json::json!({
            "animationIn": { "type": "slide-left", "durationFrames": 15 },
            "animationOut": { "type": "slide-up", "durationFrames": 15 }
        });
        let (x, y) = animation_overlay_terms(&slide, 2.0, 4.0, profile.fps());
        assert!(x.unwrap().contains("W*(1-"));
        assert!(y.unwrap().contains("-H*("));

        let fade = serde_json::json!({
            "animationIn": { "type": "fade", "durationFrames": 12 },
            "animationOut": { "type": "fade", "durationFrames": 12 }
        });
        let filter = visual_filter(
            0,
            &fade,
            &serde_json::json!({}),
            &profile,
            4.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(filter.contains("fade=t=in:st=0.000000:d="));
        assert!(filter.contains("fade=t=out:st="));
        assert!(filter.contains("alpha=1"));
    }

    #[test]
    fn cover_fit_scales_up_and_center_crops() {
        let mut profile = profile();
        profile.width = 1080;
        profile.height = 1920;
        profile.fit = "cover".into();
        let clip = serde_json::json!({});
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile,
            3.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(filter.contains("force_original_aspect_ratio=increase"));
        assert!(filter.contains("crop=1080:1920"));
        assert!(!filter.contains("force_original_aspect_ratio=decrease"));
    }

    #[test]
    fn photo_motion_reaches_the_filter_chain() {
        let profile = profile();
        let zoom = serde_json::json!({
            "motion": { "type": "zoom-in", "intensity": 0.15 }
        });
        let zoom_filter = visual_filter(
            0,
            &zoom,
            &serde_json::json!({}),
            &profile,
            3.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(zoom_filter.contains("setpts=PTS-STARTPTS"));
        assert!(zoom_filter.contains("zoompan=z='1+0.1500*on/"));
        assert!(zoom_filter.contains("x='(iw-iw/zoom)/2'"));
        assert!(zoom_filter.contains("scale=w=1920"));

        let pan = serde_json::json!({
            "motion": { "type": "pan-right", "intensity": 0.2 }
        });
        let pan_filter = visual_filter(
            0,
            &pan,
            &serde_json::json!({}),
            &profile,
            3.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(pan_filter.contains("zoompan=z='1.2000'"));
        assert!(pan_filter.contains("x='(iw-iw/zoom)*on/"));
    }

    #[test]
    fn profile_parses_compression_and_rejects_unknown_presets() {
        let value = serde_json::json!({
            "id": "p",
            "name": "Compacto",
            "resolution": { "width": 1280, "height": 720 },
            "frameRate": { "num": 24_000, "den": 1_001 },
            "bitrate": { "mode": "crf", "crf": 27 },
            "videoPreset": "faster",
            "audioBitsPerSecond": 96_000,
            "qualityGate": { "minOutputBytes": 50_000 }
        });
        let parsed = parse_profile(&value).expect("perfil válido");
        assert_eq!(parsed.crf, Some(27));
        assert_eq!(parsed.video_preset, "faster");
        assert_eq!(parsed.fit, "contain");
        assert_eq!(parsed.audio_bps, 96_000);
        assert_eq!(parsed.fps(), 24_000.0 / 1_001.0);

        let defaults = serde_json::json!({
            "id": "p",
            "name": "Default",
            "resolution": { "width": 1920, "height": 1080 },
            "frameRate": { "num": 30, "den": 1 },
            "bitrate": { "mode": "crf", "crf": 22 },
            "qualityGate": { "minOutputBytes": 1 }
        });
        let parsed = parse_profile(&defaults).expect("defaults válidos");
        assert_eq!(parsed.video_preset, "veryfast");
        assert_eq!(parsed.audio_bps, 128_000);

        let mut unknown = value;
        unknown["videoPreset"] = serde_json::json!("turbo");
        assert!(parse_profile(&unknown).is_err());

        let h264_32k = serde_json::json!({
            "id": "p",
            "name": "32K H.264",
            "resolution": { "width": 32_768, "height": 4_320 },
            "frameRate": { "num": 120, "den": 1 },
            "bitrate": { "mode": "crf", "crf": 22 },
            "qualityGate": { "minOutputBytes": 1 }
        });
        assert!(parse_profile(&h264_32k).is_err());
        let mut h265_32k = h264_32k;
        h265_32k["videoCodec"] = serde_json::json!("h265");
        let parsed = parse_profile(&h265_32k).expect("H.265 acepta 32K");
        assert_eq!(parsed.width, 32_768);
        assert_eq!(parsed.fps(), 120.0);
    }

    #[test]
    fn hardware_encoder_args_match_each_api() {
        let mut amf = profile();
        amf.hardware_encoder = Some("h264_amf".into());
        let args = hardware_encoder_args(&amf).expect("AMF");
        let text = args.join(" ");
        assert!(text.contains("h264_amf") && text.contains("-rc cqp") && text.contains("-qp_i 20"));
        assert!(!text.contains("libx264"));

        let mut nvenc = profile();
        nvenc.hardware_encoder = Some("h264_nvenc".into());
        let text = hardware_encoder_args(&nvenc).expect("NVENC").join(" ");
        assert!(text.contains("h264_nvenc") && text.contains("-cq 20") && text.contains("p5"));

        let mut qsv = profile();
        qsv.video_codec = "h265".into();
        qsv.hardware_encoder = Some("hevc_qsv".into());
        let text = hardware_encoder_args(&qsv).expect("QSV").join(" ");
        assert!(text.contains("hevc_qsv") && text.contains("-global_quality 20"));

        let mut bitrate = profile();
        bitrate.crf = None;
        bitrate.target_bps = Some(8_000_000);
        bitrate.hardware_encoder = Some("h264_amf".into());
        let text = hardware_encoder_args(&bitrate)
            .expect("AMF por bitrate")
            .join(" ");
        assert!(text.contains("-b:v 8000000") && !text.contains("-rc cqp"));

        assert!(hardware_encoder_args(&profile()).is_none());
    }

    #[test]
    fn profile_validates_the_optional_hardware_encoder() {
        let mut value = serde_json::json!({
            "id": "p",
            "name": "GPU",
            "resolution": { "width": 1920, "height": 1080 },
            "frameRate": { "num": 30, "den": 1 },
            "videoCodec": "h264",
            "bitrate": { "mode": "crf", "crf": 20 },
            "qualityGate": { "minOutputBytes": 1 },
            "hardwareEncoder": "h264_amf"
        });
        let parsed = parse_profile(&value).expect("AMF es un encoder conocido");
        assert_eq!(parsed.hardware_encoder.as_deref(), Some("h264_amf"));

        value["hardwareEncoder"] = serde_json::json!("encoder-inventado");
        assert!(parse_profile(&value).is_err());

        value["hardwareEncoder"] = serde_json::json!("hevc_amf");
        assert!(
            parse_profile(&value).is_err(),
            "no se puede codificar HEVC en un perfil H.264"
        );

        value["videoCodec"] = serde_json::json!("h265");
        let parsed = parse_profile(&value).expect("HEVC AMF coincide con H.265");
        assert_eq!(parsed.hardware_encoder.as_deref(), Some("hevc_amf"));

        value["resolution"] = serde_json::json!({ "width": 32_768, "height": 4_320 });
        assert!(
            parse_profile(&value).is_err(),
            "AMF HEVC no debe aceptar 32K"
        );
    }

    #[test]
    fn audio_suite_reaches_the_filter_chain() {
        let audio = serde_json::json!({
            "gainDb": -3,
            "highPassHz": 80,
            "lowPassHz": 12000,
            "eqLowDb": -2,
            "eqMidDb": 3,
            "eqHighDb": 2,
            "compressor": true,
            "deesser": true,
            "gateDb": -38,
            "denoise": 0.2,
            "fadeInFrames": 15,
            "fadeOutFrames": 30
        });
        let filter = audio_filter(
            0,
            &profile(),
            3.0,
            0.0,
            0.0,
            &audio,
            false,
            1,
            1,
            0.0,
            &serde_json::json!({}),
        );
        assert!(filter.contains("highpass=f=80.0"));
        assert!(filter.contains("lowpass=f=12000.0"));
        assert!(filter.contains("equalizer=f=100.0"));
        assert!(filter.contains("equalizer=f=1000.0"));
        assert!(filter.contains("equalizer=f=8000.0"));
        assert!(filter.contains("afftdn=nr="));
        assert!(filter.contains("deesser="));
        assert!(filter.contains("agate=threshold=-38.0dB"));
        assert!(filter.contains("acompressor="));
        assert!(filter.contains("afade=t=in"));
        assert!(filter.contains("afade=t=out"));
    }

    #[test]
    fn track_pan_and_eq_reach_the_audio_chain() {
        let track = serde_json::json!({
            "pan": -0.5,
            "eqLowDb": 4,
            "eqMidDb": 0,
            "eqHighDb": -3
        });
        let filters = track_audio_filters(&track);
        let chain = filters.join(",");
        assert!(chain.contains("equalizer=f=120.0:t=q:w=1:g=4.00"));
        assert!(!chain.contains("equalizer=f=1000.0"));
        assert!(chain.contains("equalizer=f=8000.0:t=q:w=1:g=-3.00"));
        assert!(chain.contains("pan=stereo|c0=1.0000*c0|c1=0.5000*c1"));

        let audio = serde_json::json!({});
        let integrated = audio_filter(
            0,
            &profile(),
            1.0,
            0.0,
            0.0,
            &audio,
            false,
            1,
            1,
            0.0,
            &track,
        );
        assert!(integrated.contains("equalizer=f=120.0"));
        assert!(integrated.contains("pan=stereo|c0=1.0000*c0|c1=0.5000*c1"));

        assert!(track_audio_filters(&serde_json::json!({ "pan": 0 })).is_empty());
        let clamped = track_audio_filters(&serde_json::json!({
            "pan": 3,
            "eqLowDb": 20
        }))
        .join(",");
        assert!(clamped.contains("g=12.00"));
        assert!(clamped.contains("0.0000*c0|c1=1.0000*c1"));
    }

    #[test]
    #[ignore]
    fn live_track_pan_and_eq_change_the_audio() {
        let ffmpeg = std::env::var("EDITOR_IA_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_owned());
        let dir = std::env::temp_dir().join(format!("editor-ia-audio-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp audio");
        let pan_file = dir.join("pan.wav");
        let status = std::process::Command::new(&ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1:sample_rate=48000",
                "-af",
                "aformat=sample_fmts=fltp:channel_layouts=stereo,pan=stereo|c0=1.0000*c0|c1=0.5000*c1",
                "-c:a",
                "pcm_s16le",
                pan_file.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("ffmpeg disponible");
        assert!(status.success(), "FFmpeg rechazó el paneo");

        let mean_db = |channel: &str| -> f64 {
            let filter = format!("pan=mono|c0={channel},volumedetect");
            let output = std::process::Command::new(&ffmpeg)
                .args([
                    "-hide_banner",
                    "-i",
                    pan_file.to_string_lossy().as_ref(),
                    "-af",
                    &filter,
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .expect("ffmpeg volumedetect");
            let text = String::from_utf8_lossy(&output.stderr);
            let line = text
                .lines()
                .find(|line| line.contains("mean_volume:"))
                .expect("mean_volume");
            line.split(':')
                .nth(1)
                .and_then(|value| value.trim().strip_suffix(" dB"))
                .and_then(|value| value.parse::<f64>().ok())
                .expect("dB")
        };
        let left = mean_db("c0");
        let right = mean_db("c1");
        assert!(
            (left - right - 6.02).abs() < 0.2,
            "paneo -0.5: izquierda {left} dB, derecha {right} dB"
        );

        let eq_file = dir.join("eq.wav");
        let status = std::process::Command::new(&ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=120:duration=1:sample_rate=48000",
                "-af",
                "aformat=sample_fmts=fltp:channel_layouts=stereo,equalizer=f=120.0:t=q:w=1:g=-12.00",
                "-c:a",
                "pcm_s16le",
                eq_file.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("ffmpeg disponible");
        assert!(status.success(), "FFmpeg rechazó el EQ");
        let flat_file = dir.join("flat.wav");
        let _ = std::process::Command::new(&ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=120:duration=1:sample_rate=48000",
                "-af",
                "aformat=sample_fmts=fltp:channel_layouts=stereo",
                "-c:a",
                "pcm_s16le",
                flat_file.to_string_lossy().as_ref(),
            ])
            .status();
        let file_mean = |path: &std::path::Path| -> f64 {
            let filter = "pan=mono|c0=c0,volumedetect";
            let output = std::process::Command::new(&ffmpeg)
                .args([
                    "-hide_banner",
                    "-i",
                    path.to_string_lossy().as_ref(),
                    "-af",
                    filter,
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .expect("ffmpeg volumedetect");
            let text = String::from_utf8_lossy(&output.stderr);
            let line = text
                .lines()
                .find(|line| line.contains("mean_volume:"))
                .expect("mean_volume");
            line.split(':')
                .nth(1)
                .and_then(|value| value.trim().strip_suffix(" dB"))
                .and_then(|value| value.parse::<f64>().ok())
                .expect("dB")
        };
        let flat = file_mean(&flat_file);
        let equalized = file_mean(&eq_file);
        assert!(
            flat - equalized > 10.0,
            "EQ -12 dB a 120 Hz: plano {flat} dB, con EQ {equalized} dB"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn chroma_key_reaches_the_filter_chain() {
        let clip = serde_json::json!({
            "chromaKey": { "color": "#00ff00", "similarity": 0.3, "blend": 0.1 }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            3.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(filter.contains("chromakey=0x00ff00:similarity=0.3000:blend=0.1000"));
    }

    #[test]
    fn voice_effects_reach_the_audio_chain() {
        let deep = audio_filter(
            0,
            &profile(),
            1.0,
            0.0,
            0.0,
            &serde_json::json!({ "voiceEffect": "deep" }),
            false,
            1,
            1,
            0.0,
            &serde_json::json!({}),
        );
        assert!(deep.contains("asetrate="));
        let echo = audio_filter(
            0,
            &profile(),
            1.0,
            0.0,
            0.0,
            &serde_json::json!({ "voiceEffect": "echo" }),
            false,
            1,
            1,
            0.0,
            &serde_json::json!({}),
        );
        assert!(echo.contains("aecho="));
        let radio = audio_filter(
            0,
            &profile(),
            1.0,
            0.0,
            0.0,
            &serde_json::json!({ "voiceEffect": "radio" }),
            false,
            1,
            1,
            0.0,
            &serde_json::json!({}),
        );
        assert!(radio.contains("lowpass=f=3200"));
    }

    #[test]
    fn extra_transitions_change_the_filter_chain() {
        let dissolve = serde_json::json!({ "transitionIn": { "type": "dissolve", "frames": 6 } });
        let dissolve_filter = visual_filter(
            0,
            &dissolve,
            &serde_json::json!({}),
            &profile(),
            2.0,
            0.2,
            0.0,
            1,
            1,
            true,
        );
        assert!(dissolve_filter.contains("alpha=1"));

        let fade = serde_json::json!({ "transitionIn": { "type": "fade-black", "frames": 6 } });
        let fade_filter = visual_filter(
            0,
            &fade,
            &serde_json::json!({}),
            &profile(),
            2.0,
            0.2,
            0.0,
            1,
            1,
            true,
        );
        assert!(fade_filter.contains("fade=t=in:st=0:d=0.200"));
        assert!(!fade_filter.contains("alpha=1"));

        let white = serde_json::json!({ "transitionIn": { "type": "fade-white", "frames": 6 } });
        let white_filter = visual_filter(
            0,
            &white,
            &serde_json::json!({}),
            &profile(),
            2.0,
            0.2,
            0.0,
            1,
            1,
            true,
        );
        assert!(white_filter.contains("color=white"));

        let slide = serde_json::json!({ "transitionIn": { "type": "slide-left", "frames": 6 } });
        let x = overlay_x_expression(&slide, 2.0, 0.2, "0.000");
        assert!(x.contains("+(W)*(1-"));
        assert!(x.contains("if(lt(t,2.000000)"));

        let up = serde_json::json!({ "transitionIn": { "type": "slide-up", "frames": 6 } });
        let y = overlay_y_expression(&up, 2.0, 0.2, "0.000", None);
        assert!(y.contains("+(H)*(1-"));
        assert!(y.contains("if(lt(t,2.000000)"));
        let down = serde_json::json!({ "transitionIn": { "type": "slide-down", "frames": 6 } });
        let y_down = overlay_y_expression(&down, 2.0, 0.2, "0.000", None);
        assert!(y_down.contains("+(-H)*(1-"));
    }

    #[test]
    fn lut_is_appended_before_the_output_label() {
        let chain = "[0:v]fps=30,format=rgba[v0]".to_owned();
        let with = apply_lut_to_chain(chain, "v0", Path::new("C:/obra/media/luts/x.cube"), 1.0);
        assert!(with.ends_with("[v0]"));
        assert!(with.contains("lut3d=file='C\\:/obra/media/luts/x.cube'"));
    }

    #[test]
    fn partial_lut_intensity_mixes_original_and_graded() {
        let chain = "[0:v]fps=30,format=rgba[v0]".to_owned();
        let mixed = apply_lut_to_chain(chain, "v0", Path::new("C:/obra/media/luts/x.cube"), 0.35);
        assert!(mixed.ends_with("[v0]"));
        assert!(mixed.contains(",format=rgba,split=2[v0src][v0lut]"));
        assert!(!mixed.contains("rgbaformat"));
        assert!(mixed.contains("[v0lut]lut3d=file='C\\:/obra/media/luts/x.cube'[v0graded]"));
        // FFmpeg's blend opacity is the weight of the first input, so an
        // intensity of 0.35 keeps 65% of the original and 35% of the LUT.
        assert!(mixed.contains("[v0src][v0graded]blend=all_mode=normal:all_opacity=0.6500[v0]"));
        assert!(!mixed.contains(",lut3d=file="));
    }

    #[test]
    fn adjustment_lut_blend_is_gated_to_its_window() {
        let chain = "[base0]null[adj0]".to_owned();
        let gated = apply_lut_to_chain_gated(
            chain,
            "adj0",
            Path::new("C:/obra/media/luts/x.cube"),
            0.5,
            Some((1.0, 2.5)),
        );
        assert!(gated.contains(",format=rgba,split=2[adj0src][adj0lut]"));
        assert!(gated.contains(
            "blend=all_mode=normal:all_opacity=0.5000:enable='between(t,1.000000,2.500000)'[adj0]"
        ));
        let full = apply_lut_to_chain_gated(
            "[base0]eq=contrast=1.1[adj0]".to_owned(),
            "adj0",
            Path::new("C:/obra/media/luts/x.cube"),
            1.0,
            Some((1.0, 2.5)),
        );
        assert!(full.contains("eq=contrast=1.1,lut3d=file="));
        assert!(full.contains(":enable='between(t,1.000000,2.500000)'[adj0]"));
        assert!(!full.contains("blend="));
    }

    #[test]
    fn full_and_zero_lut_intensity_avoid_the_blend_graph() {
        let chain = "[0:v]fps=30,format=rgba[v0]".to_owned();
        let full = apply_lut_to_chain(
            chain.clone(),
            "v0",
            Path::new("C:/obra/media/luts/x.cube"),
            1.0,
        );
        assert!(full.ends_with("[v0]"));
        assert!(full.contains(",lut3d=file='C\\:/obra/media/luts/x.cube'[v0]"));
        assert!(!full.contains("blend="));
        let zero = apply_lut_to_chain(chain, "v0", Path::new("C:/obra/media/luts/x.cube"), 0.0);
        assert_eq!(zero, "[0:v]fps=30,format=rgba[v0]");
    }

    #[test]
    fn blend_modes_map_to_ffmpeg() {
        assert_eq!(blend_mode_name("multiply"), Some("multiply"));
        assert_eq!(blend_mode_name("overlay"), Some("hardlight"));
        assert_eq!(blend_mode_name("soft-light"), Some("softlight"));
        assert_eq!(blend_mode_name("color-dodge"), Some("dodge"));
        assert_eq!(blend_mode_name("desconocido"), None);
    }

    #[test]
    fn mask_reaches_the_filter_chain() {
        let ellipse = serde_json::json!({
            "mask": { "shape": "ellipse", "x": 0.1, "y": -0.1, "width": 0.8, "height": 0.9, "feather": 0.2, "invert": false }
        });
        let filter = visual_filter(
            0,
            &ellipse,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(filter.contains("geq=r='r(X,Y)'"));
        assert!(filter.contains("alpha(X,Y)*("));
        assert!(filter.contains("sqrt("));

        let rectangle = serde_json::json!({
            "mask": { "shape": "rectangle", "x": 0, "y": 0, "width": 0.6, "height": 0.6, "feather": 0, "invert": true }
        });
        let inverted = visual_filter(
            0,
            &rectangle,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(inverted.contains("(1-("));

        let rotated = serde_json::json!({
            "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.6, "rotationDeg": 45 }
        });
        let rotated_chain =
            mask_filter(&rotated, 30.0, 0.0).expect("la máscara rotada debería generarse");
        assert!(rotated_chain.contains("cos((45.000000)*PI/180)"));
        assert!(rotated_chain.contains("sin((45.000000)*PI/180)"));
        assert!(rotated_chain.contains("(H/W)"));
        assert!(rotated_chain.contains("(W/H)"));

        let animated = serde_json::json!({
            "mask": {
                "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.6,
                "keyframes": [
                    { "frame": 0, "x": -0.2 },
                    { "frame": 30, "x": 0.2 }
                ]
            }
        });
        let animated_chain = mask_filter(&animated, 30.0, 0.0)
            .expect("la máscara animada debería generar expresiones");
        assert!(animated_chain.contains("if(lt("));
        assert!(animated_chain.contains("(N-0)/30.000000"));
        assert!(inverted.contains("abs("));

        let plain = serde_json::json!({});
        let none = visual_filter(
            0,
            &plain,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(!none.contains("geq="));
    }

    #[test]
    #[ignore]
    fn live_polygon_mask_filter_is_renderable() {
        let clip = serde_json::json!({
            "mask": {
                "shape": "polygon",
                "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0,
                "points": [
                    { "x": 0.35, "y": 0.3 }, { "x": 0.65, "y": 0.3 },
                    { "x": 0.65, "y": 0.7 }, { "x": 0.35, "y": 0.7 }
                ]
            }
        });
        let filter = mask_filter(&clip, 30.0, 0.0).expect("polygon filter");
        let output =
            std::env::temp_dir().join(format!("editor-ia-poly-{}.png", uuid::Uuid::new_v4()));
        let chain = format!("format=rgba,{filter}");
        let status = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x180:d=1",
                "-vf",
                &chain,
                "-frames:v",
                "1",
                "-update",
                "1",
                output.to_string_lossy().as_ref(),
            ])
            .status()
            .expect("ffmpeg disponible");
        assert!(status.success(), "FFmpeg rechazó el filtro poligonal");
        assert!(output.is_file() && std::fs::metadata(&output).unwrap().len() > 100);
        let _ = std::fs::remove_file(&output);
    }

    #[test]
    fn polygon_mask_reaches_the_alpha_expression() {
        let polygon = serde_json::json!({
            "mask": {
                "shape": "polygon",
                "x": 0.0,
                "y": 0.0,
                "width": 1.0,
                "height": 1.0,
                "points": [
                    { "x": 0.2, "y": 0.2 },
                    { "x": 0.8, "y": 0.2 },
                    { "x": 0.7, "y": 0.8 },
                    { "x": 0.3, "y": 0.75 }
                ]
            }
        });
        let filter = mask_filter(&polygon, 30.0, 0.0).expect("la máscara poligonal debe generarse");
        assert!(filter.contains("mod("));
        assert!(filter.contains("alpha(X,Y)*("));

        let mut inverted = polygon;
        inverted["mask"]["invert"] = serde_json::json!(true);
        let filter =
            mask_filter(&inverted, 30.0, 0.0).expect("la máscara invertida debe generarse");
        assert!(filter.contains("1-(mod("));

        let mut animated = inverted;
        animated["mask"]["keyframes"] = serde_json::json!([
            { "frame": 0, "x": -0.1 },
            { "frame": 30, "x": 0.1 }
        ]);
        let filter = mask_filter(&animated, 30.0, 0.0).expect("la máscara animada debe generarse");
        assert!(filter.contains("-0.1") && filter.contains("0.1"));
    }

    #[test]
    fn short_render_byte_gate_scales_with_duration() {
        // Un clip corto enmascarado puede ser válido y pesar menos que el
        // mínimo pensado para contenido lleno; el guardia baja con la duración.
        assert_eq!(effective_min_output_bytes(500_000, 5.0), 50_000);
        assert_eq!(effective_min_output_bytes(500_000, 0.2), 10_000);
        assert_eq!(effective_min_output_bytes(500_000, 60.0), 500_000);
        assert_eq!(effective_min_output_bytes(1_000, 5.0), 1_000);
    }

    #[test]
    fn extra_mask_shapes_reach_the_alpha_expression() {
        let diamond = serde_json::json!({
            "mask": { "shape": "diamond", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 }
        });
        let diamond_chain =
            mask_filter(&diamond, 30.0, 0.0).expect("la máscara diamante debe generarse");
        assert!(diamond_chain.contains("abs("));
        assert!(diamond_chain.contains("geq=r='r(X,Y)'"));

        let triangle = serde_json::json!({
            "mask": { "shape": "triangle", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 }
        });
        let triangle_chain =
            mask_filter(&triangle, 30.0, 0.0).expect("la máscara triángulo debe generarse");
        assert!(triangle_chain.contains("max(0,min(1,"));

        let rounded = serde_json::json!({
            "mask": { "shape": "rounded", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 }
        });
        let rounded_chain =
            mask_filter(&rounded, 30.0, 0.0).expect("la máscara redondeada debe generarse");
        assert!(rounded_chain.contains("pow("));
        assert!(rounded_chain.contains("sqrt("));

        let unknown = serde_json::json!({
            "mask": { "shape": "heart", "x": 0, "y": 0, "width": 1, "height": 1 }
        });
        assert!(mask_filter(&unknown, 30.0, 0.0).is_none());
    }

    #[test]
    fn reverse_reaches_both_filter_chains() {
        let clip = serde_json::json!({ "reverse": true });
        let visual = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(visual.contains("reverse"));

        let audio = audio_filter(
            0,
            &profile(),
            1.0,
            0.0,
            0.0,
            &serde_json::json!({}),
            true,
            1,
            1,
            0.0,
            &serde_json::json!({}),
        );
        assert!(audio.contains("areverse"));
    }

    #[test]
    fn scale_zoom_handles_up_down_and_crossing_curves() {
        let clip = serde_json::json!({
            "transform": { "keyframes": [
                { "frame": 0, "scale": 1, "rotationDeg": 0 },
                { "frame": 30, "scale": 1.4, "rotationDeg": 0 }
            ] }
        });
        let (base, expression) =
            scale_zoom_expression(&clip, &profile(), 0.0).expect("curva de escala");
        assert!((base - 1.0).abs() < 1e-9);
        assert!(expression.contains("max(1,("));
        assert!(expression.contains("on-"));

        let mut down = clip.clone();
        down["transform"]["keyframes"][1]["scale"] = serde_json::json!(0.8);
        assert!(scale_zoom_expression(&down, &profile(), 0.0).is_none());
        let (base, expression) =
            scale_dynamic_expression(&down, &profile(), 0.0, 1, 1, false).expect("bajada");
        assert!((base - 1.0).abs() < 1e-9);
        assert!(expression.contains("min(1,("));
        assert!(expression.contains("/1.000000"));

        let mut crossing = clip.clone();
        crossing["transform"]["keyframes"][0]["scale"] = serde_json::json!(0.8);
        crossing["transform"]["keyframes"][1]["scale"] = serde_json::json!(1.3);
        assert!(scale_zoom_expression(&crossing, &profile(), 0.0).is_none());
        let (base, expression) =
            scale_dynamic_expression(&crossing, &profile(), 0.0, 1, 1, false).expect("cruce");
        assert!((base - 1.3).abs() < 1e-9);
        assert!(expression.contains("/1.300000"));
        let (_, fast) =
            scale_dynamic_expression(&crossing, &profile(), 0.0, 2, 1, false).expect("2×");
        assert!(fast.contains("/60.000000"), "reloj de velocidad: {fast}");
        let (_, still) =
            scale_dynamic_expression(&crossing, &profile(), 0.0, 2, 1, true).expect("imagen");
        assert!(still.contains("/30.000000"), "imagen sin retime: {still}");
        crossing["transform"]["rotationDeg"] = serde_json::json!(10);
        assert!(scale_dynamic_expression(&crossing, &profile(), 0.0, 1, 1, false).is_some());

        let mut rotated = clip.clone();
        rotated["transform"]["keyframes"][1]["rotationDeg"] = serde_json::json!(4);
        assert!(scale_zoom_expression(&rotated, &profile(), 0.0).is_some());

        let mut static_rotation = clip.clone();
        static_rotation["transform"]["rotationDeg"] = serde_json::json!(10);
        assert!(scale_zoom_expression(&static_rotation, &profile(), 0.0).is_some());

        let mut motion = clip.clone();
        motion["motion"] = serde_json::json!({ "type": "zoom-in" });
        assert!(scale_zoom_expression(&motion, &profile(), 0.0).is_some());

        let mut frozen = clip.clone();
        frozen["scaleFrozen"] = serde_json::json!(true);
        assert!(scale_zoom_expression(&frozen, &profile(), 0.0).is_none());

        let mut static_scale = clip.clone();
        static_scale["transform"]["scaleX"] = serde_json::json!(1.2);
        assert!(scale_zoom_expression(&static_scale, &profile(), 0.0).is_some());
    }

    #[test]
    fn static_scale_combines_with_keyframed_scale() {
        let clip = serde_json::json!({
            "transform": {
                "scaleX": 1.15,
                "scaleY": 1.15,
                "keyframes": [
                    { "frame": 0, "scale": 1 },
                    { "frame": 30, "scale": 1.3 }
                ]
            }
        });
        let visual = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(visual.contains("scale=iw*1.150000:ih*1.150000"));
        assert!(visual.contains("zoompan"));
        assert!(visual.contains("s=2208x1242"));
    }

    #[test]
    fn rotation_keyframes_use_local_time_and_fixed_canvas() {
        let clip = serde_json::json!({
            "transform": { "keyframes": [
                { "frame": 0, "rotationDeg": 0 },
                { "frame": 30, "rotationDeg": 45 }
            ] }
        });
        let visual = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        let rotate = visual
            .split("rotate=angle=")
            .nth(1)
            .expect("rotación animada");
        assert!(rotate.contains("(t-0.000000)"));
        assert!(!rotate.contains("((n-"));
        assert!(rotate.contains("c=black@0:ow=1920:oh=1080"));
        assert!(!rotate.contains("rotw("));
    }

    #[test]
    fn transform_and_gain_keyframes_reach_the_filter_chain() {
        let clip = serde_json::json!({
            "transform": {
                "keyframes": [
                    { "frame": 0, "scale": 1.0, "offsetX": 0, "rotationDeg": 0, "easing": "ease-in-out" },
                    { "frame": 15, "scale": 1.4, "offsetX": 120, "rotationDeg": 6, "easing": "ease-out" },
                    { "frame": 29, "scale": 1.0, "offsetX": 0, "rotationDeg": 0 }
                ]
            },
            "audio": {
                "gainKeyframes": [
                    { "frame": 0, "gainDb": -12, "easing": "ease-in" },
                    { "frame": 30, "gainDb": 0 }
                ]
            }
        });
        let visual = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            true,
        );
        assert!(visual.contains("zoompan"));
        assert!(visual.contains("rotate=angle='("));
        assert!(visual.contains("c=black@0:ow=1920:oh=1080"));
        assert!(!visual.contains("rotw("));
        let audio = audio_filter(
            0,
            &profile(),
            1.0,
            0.0,
            0.0,
            &clip["audio"],
            false,
            1,
            1,
            0.0,
            &serde_json::json!({}),
        );
        assert!(audio.contains("volume=volume='pow(10,"));
        assert!(audio.contains("eval=frame"));
    }

    #[test]
    fn offset_keyframes_use_global_time() {
        let clip = serde_json::json!({
            "transform": {
                "keyframes": [
                    { "frame": 0, "offsetX": 0 },
                    { "frame": 15, "offsetX": 90 }
                ]
            }
        });
        let expression = offset_expression(&clip, "offsetX", 2.0, 30.0).expect("expresión");
        assert!(expression.contains("(t-2.000000)"));
        assert!(expression.contains("90.0000"));
        assert!(expression.contains("if(lt((t-2.000000),0.000000)"));
    }

    #[test]
    fn opacity_keyframes_emit_frame_sampled_commands() {
        let clip = serde_json::json!({
            "transform": {
                "keyframes": [
                    { "frame": 0, "opacity": 0.2 },
                    { "frame": 30, "opacity": 1.0 }
                ]
            }
        });
        let visual = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(visual.contains("colorchannelmixer@kf0=aa=0.2000"));
        assert!(visual.contains("sendcmd=c='"));
        assert!(visual.contains("colorchannelmixer@kf0 aa 1.0000"));
        assert!(
            !visual.contains("colorchannelmixer=aa="),
            "la opacidad animada no debe convivir con el mezclador estático"
        );
        let commands = visual.matches("colorchannelmixer@kf0 aa").count();
        assert!(
            commands > 2,
            "deberían muestrearse varios frames: {commands}"
        );
        assert!(commands <= 301, "los comandos están acotados: {commands}");
    }

    #[test]
    fn static_opacity_still_uses_a_constant_mixer() {
        let clip = serde_json::json!({ "transform": { "opacity": 0.5 } });
        let visual = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        assert!(visual.contains("colorchannelmixer=aa=0.5000"));
        assert!(!visual.contains("sendcmd="));
    }

    #[test]
    fn opacity_keyframes_shift_commands_by_the_dissolve_lead() {
        let clip = serde_json::json!({
            "transitionIn": { "type": "dissolve", "frames": 6 },
            "transform": {
                "keyframes": [
                    { "frame": 0, "opacity": 0.3 },
                    { "frame": 9, "opacity": 0.9 }
                ]
            }
        });
        let visual = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.2,
            1.0,
            1,
            1,
            false,
        );
        // 6 frames a 30 fps = 0.2 s de solape: el último valor cae en 0.2+0.3.
        assert!(visual.contains("sendcmd=c='"));
        assert!(
            visual.contains("colorchannelmixer@kf0 aa 0.9000"),
            "falta el valor final: {visual}"
        );
        let first_command = visual
            .split("sendcmd=c='")
            .nth(1)
            .and_then(|rest| rest.split(' ').next())
            .and_then(|value| value.parse::<f64>().ok())
            .expect("primer comando con tiempo");
        assert!(
            (first_command - 0.2333).abs() < 0.02,
            "el primer comando debe caer después del lead: {first_command}"
        );
    }

    fn project() -> Value {
        serde_json::json!({
            "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                    { "id": "a1", "kind": "narration", "order": 1, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "c1", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 30 } },
                    { "id": "c2", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset2", "inFrame": 0, "outFrame": 30 } }
                ]
            },
            "assets": [
                { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" } },
                { "id": "asset2", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/audio.wav" } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        })
    }

    #[test]
    fn track_gain_and_solo_shape_the_audio_mix() {
        let root = std::env::temp_dir().join(format!("editor-ia-mix-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        std::fs::write(media.join("music.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan_for = |project: &Value| {
            build_plan(BuildPlanInput {
                audio_only: false,
                project,
                root: &root,
                profile: &profile(),
                output_path: &root.join("salida.mp4"),
                include_captions: false,
                temp_dir: &temp,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("el plan debería construirse")
        };
        let mut project = project();
        project["timeline"]["tracks"][1]["gainDb"] = serde_json::json!(-7.5);
        let with_gain = plan_for(&project);
        let gain_graph = with_gain
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .expect("falta el grafo de audio");
        assert!(
            gain_graph.contains("volume=-7.50dB"),
            "la ganancia de pista no llega al mix: {gain_graph}"
        );

        project["timeline"]["tracks"][1]["pan"] = serde_json::json!(-0.5);
        project["timeline"]["tracks"][1]["eqLowDb"] = serde_json::json!(4);
        project["timeline"]["tracks"][1]["eqHighDb"] = serde_json::json!(-3);
        let with_pan = plan_for(&project);
        let pan_graph = with_pan
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .expect("falta el grafo de audio con paneo");
        assert!(
            pan_graph.contains("pan=stereo|c0=1.0000*c0|c1=0.5000*c1"),
            "el paneo de pista no llega al mix: {pan_graph}"
        );
        assert!(
            pan_graph.contains("equalizer=f=120.0:t=q:w=1:g=4.00"),
            "el EQ de pista no llega al mix: {pan_graph}"
        );
        assert!(pan_graph.contains("equalizer=f=8000.0:t=q:w=1:g=-3.00"));

        project["timeline"]["tracks"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "a2", "kind": "narration", "order": 2, "hidden": false, "muted": false
            }));
        project["timeline"]["clips"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "c3", "trackId": "a2", "kind": "audio",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "asset3", "inFrame": 0, "outFrame": 30 },
                "audio": { "gainDb": -4.25 }
            }));
        project["assets"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "asset3", "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/music.wav" }
            }));
        let both = plan_for(&project);
        let both_graph = both
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .expect("falta el grafo de audio");
        assert!(
            both_graph.contains("amix=inputs=2") && both_graph.contains("volume=-4.25dB"),
            "sin solo deberían mezclarse las dos pistas: {both_graph}"
        );

        project["timeline"]["tracks"][1]["solo"] = serde_json::json!(true);
        let solo = plan_for(&project);
        let solo_graph = solo
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .expect("falta el grafo de audio");
        assert!(
            !solo_graph.contains("volume=-4.25dB"),
            "el solo de la pista A debería excluir la música: {solo_graph}"
        );
        assert!(
            solo_graph.contains("volume=-7.50dB") && !solo_graph.contains("amix"),
            "el solo debería dejar sólo la pista A: {solo_graph}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ducking_pads_the_sidechain_so_the_bed_survives_the_voice() {
        let root = std::env::temp_dir().join(format!("editor-ia-duck-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        for name in ["video.mp4", "audio.wav", "music.wav"] {
            std::fs::write(media.join(name), b"x").unwrap();
        }
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan_for = |project: &Value| {
            build_plan(BuildPlanInput {
                audio_only: false,
                project,
                root: &root,
                profile: &profile(),
                output_path: &root.join("salida.mp4"),
                include_captions: false,
                temp_dir: &temp,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("el plan debería construirse")
        };
        let mut project = project();
        project["timeline"]["tracks"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "a2", "kind": "audio", "order": 2, "hidden": false, "muted": false
            }));
        project["timeline"]["clips"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "c3", "trackId": "a2", "kind": "audio",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "asset3", "inFrame": 0, "outFrame": 30 }
            }));
        project["assets"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "asset3", "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/music.wav" }
            }));
        project["audio"]["ducking"] = serde_json::json!({
            "enabled": true, "amountDb": -12,
            "sourceTrackIds": ["a1"], "targetTrackIds": ["a2"]
        });
        let plan = plan_for(&project);
        let graph = plan
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .expect("falta el grafo de audio");
        assert!(
            graph.contains("[duck_side]apad[duck_side_padded]"),
            "el sidechain necesita apad o corta la música: {graph}"
        );
        assert!(
            graph.contains("[duck_target][duck_side_padded]sidechaincompress"),
            "el compresor debe usar el sidechain rellenado: {graph}"
        );
        assert!(
            graph.contains("sidechaincompress=threshold=0.03:ratio=8.0:attack=20:release=350"),
            "la reducción de -12 dB debería dar ratio 8: {graph}"
        );

        project["audio"]["ducking"]["enabled"] = serde_json::json!(false);
        let off_graph = plan_for(&project)
            .args
            .iter()
            .find(|arg| arg.contains("[aout]"))
            .cloned()
            .expect("falta el grafo de audio");
        assert!(
            !off_graph.contains("sidechaincompress"),
            "sin ducking no debe haber compresor: {off_graph}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn render_external_project_when_requested() {
        let Some(project_path) = std::env::var("EDITORIA_RENDER_PROJECT").ok() else {
            return;
        };
        let project_text = std::fs::read_to_string(&project_path).expect("proyecto externo");
        let project: Value = serde_json::from_str(&project_text).expect("json externo");
        let project_path = PathBuf::from(&project_path);
        let root = project_path.parent().expect("raíz").to_path_buf();
        let profile_value = project["renderProfiles"]
            .as_array()
            .and_then(|profiles| profiles.first())
            .cloned()
            .expect("perfil");
        let mut profile = parse_profile(&profile_value).expect("perfil válido");
        profile.min_output_bytes = profile.min_output_bytes.min(50_000);
        let temp_dir = std::env::temp_dir().join(format!("editoria-ext-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).expect("temp");
        let output = temp_dir.join("out.mp4");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: true,
            temp_dir: &temp_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan externo");
        let verification = execute_sync(Path::new("ffmpeg"), Path::new("ffprobe"), &plan, |_| {})
            .expect("render externo");
        assert!(output.is_file());
        assert!(verification.output_bytes > 10_000);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn script_number_precision_is_renderable() {
        assert_eq!(seconds(1.5), "1.500000");
        assert_eq!(hex_color("#101014"), "0x101014");
        assert_eq!(hex_color("nope"), "0x0f1319");
    }

    #[test]
    fn progress_accepts_microseconds_and_timecodes() {
        let progress = progress_from_line("out_time_us=5000000", 10.0).unwrap();
        assert!((progress.percent - 50.0).abs() < 0.01);
        let progress = progress_from_line("out_time=00:00:05.000000", 10.0).unwrap();
        assert!((progress.percent - 50.0).abs() < 0.01);
        assert!(progress_from_line("fps=30", 10.0).is_none());
    }

    #[test]
    fn ass_time_is_reused_for_the_render_clock() {
        assert_eq!(ass_time(1.5), "0:00:01.50");
    }

    #[test]
    fn sanitize_log_removes_private_roots() {
        let root = Path::new("C:/Users/private/obra");
        let log = "error en C:/Users/private/obra/media/a.mp4";
        let sanitized = sanitize_log(log, root, 200);
        assert!(!sanitized.contains("Users/private"));
        assert!(sanitized.contains("<proyecto>"));
    }

    #[test]
    fn a_graphic_clip_is_refused_instead_of_silently_skipped() {
        let mut project = project();
        project["timeline"]["tracks"][0]["kind"] = serde_json::json!("graphic");
        project["timeline"]["clips"][0]["kind"] = serde_json::json!("graphic");
        project["timeline"]["clips"][0]["source"] =
            serde_json::json!({ "type": "graphic", "motionId": "m" });
        let temp = std::env::temp_dir().join("editor-ia-unit-temp");
        let _ = std::fs::create_dir_all(&temp);
        let result = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: Path::new("C:/obra"),
            profile: &profile(),
            output_path: Path::new("C:/obra/salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        });
        assert!(result.is_err());
    }

    #[test]
    fn a_graphic_clip_with_a_motion_ass_is_composited_before_captions() {
        let mut project = project();
        project["timeline"]["tracks"][0]["kind"] = serde_json::json!("graphic");
        project["timeline"]["clips"][0]["kind"] = serde_json::json!("graphic");
        project["timeline"]["clips"][0]["source"] =
            serde_json::json!({ "type": "graphic", "motionId": "m" });
        project["captions"] = serde_json::json!({
            "styles": [],
            "cues": [{ "trackId": "cap", "startFrame": 0, "endFrame": 30, "text": "hola" }]
        });
        let root = std::env::temp_dir().join(format!("editor-ia-motion-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("audio.wav"), b"x").unwrap();
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: true,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: Some("Dialogue: 0,0:00:00.00,0:00:02.00,Motion,,0,0,0,,hola\n"),
        })
        .expect("el clip gráfico con plan debe construir el plan");
        let graph = plan.args.join(";");
        assert!(graph.contains("ass=motion.ass"));
        assert!(graph.contains("ass=captions.ass"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_timelines_are_refused() {
        let mut project = project();
        project["timeline"]["clips"] = serde_json::json!([]);
        let temp = std::env::temp_dir().join("editor-ia-unit-temp");
        let result = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: Path::new("C:/obra"),
            profile: &profile(),
            output_path: Path::new("C:/obra/salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        });
        assert!(matches!(result, Err(error) if error.code == ProjectErrorCode::EmptyTimeline));
    }

    #[test]
    fn export_range_limits_the_output_without_changing_the_graph() {
        let root = std::env::temp_dir().join(format!("editor-ia-range-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("small.mp4"), b"x").unwrap();
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "timeline": {
                "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
                "clips": [{ "id": "22222222-2222-4222-8222-222222222222", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 60 } }]
            },
            "assets": [{
                "id": "33333333-3333-4333-8333-333333333333",
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/small.mp4" },
                "media": { "durationFrames": 60 }
            }],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let output = root.join("out.mp4");
        let profile = profile();
        let input = || BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        };
        let full = build_plan(input()).expect("plan completo");
        assert!((full.duration_seconds - 2.0).abs() < 0.001);
        assert_eq!(full.args[full.args.len() - 3], "-t");
        assert_eq!(full.args[full.args.len() - 2], "2.000000");
        let ranged = build_plan_range(input(), Some((30, 60))).expect("plan con rango");
        assert!((ranged.duration_seconds - 1.0).abs() < 0.001);
        assert_eq!(ranged.args[ranged.args.len() - 5], "-ss");
        assert_eq!(ranged.args[ranged.args.len() - 4], "1.000000");
        assert_eq!(ranged.args[ranged.args.len() - 3], "-t");
        assert_eq!(ranged.args[ranged.args.len() - 2], "1.000000");
        assert!(build_plan_range(input(), Some((30, 30))).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_modified_asset_is_refused_before_ffmpeg_runs() {
        let root = std::env::temp_dir().join(format!("editor-ia-size-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::write(media.join("small.mp4"), b"changed").unwrap();
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "timeline": {
                "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
                "clips": [{ "id": "22222222-2222-4222-8222-222222222222", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 } }]
            },
            "assets": [{
                "id": "33333333-3333-4333-8333-333333333333",
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/small.mp4" },
                "integrity": { "bytes": 999 },
                "media": { "durationFrames": 30 }
            }],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let result = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("out.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        });
        assert!(matches!(result, Err(error) if error.code == ProjectErrorCode::AssetNotReady));
        let _ = std::fs::remove_dir_all(&root);
    }

    fn stabilized_clip() -> Value {
        serde_json::json!({
            "kind": "video",
            "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 },
            "stabilization": {
                "smoothing": 12,
                "transformFile": "media/stabilizers/move.trf",
                "inFrame": 0,
                "outFrame": 30
            }
        })
    }

    #[test]
    fn stabilization_is_prepended_to_the_visual_chain() {
        let clip = serde_json::json!({ "effects": { "brightness": 0.2 } });
        let chain = visual_filter(
            3,
            &clip,
            &serde_json::json!({}),
            &profile(),
            1.0,
            0.0,
            0.0,
            1,
            1,
            false,
        );
        let chain = with_stabilization(chain, 3, Path::new("media/stabilizers/move.trf"), 12);
        assert!(
            chain.starts_with(
                "[3:v]vidstabtransform=input='media/stabilizers/move.trf':smoothing=12:crop=black,"
            ),
            "cadena inesperada: {chain}"
        );
        let transform = chain.find("vidstabtransform").expect("transform");
        let color = chain.find("eq=brightness").expect("color");
        assert!(
            transform < color,
            "la estabilización debe ver los frames crudos antes que el color"
        );
        assert!(chain.contains("setpts=PTS-STARTPTS"));
    }

    #[test]
    fn stabilization_refuses_a_window_it_did_not_analyze() {
        let root = std::env::temp_dir().join(format!("editor-ia-stab-{}", uuid::Uuid::new_v4()));
        let stabilizers = root.join("media").join("stabilizers");
        std::fs::create_dir_all(&stabilizers).unwrap();
        std::fs::write(stabilizers.join("move.trf"), b"").unwrap();

        let mut trimmed = stabilized_clip();
        trimmed["source"]["outFrame"] = serde_json::json!(20);
        let error = resolve_stabilization(&trimmed, &root).expect_err("ventana recortada");
        assert_eq!(error.code, ProjectErrorCode::InvalidProject);
        assert!(error.message.contains("recorte"));

        let mut retimed = stabilized_clip();
        retimed["speed"] = serde_json::json!({ "num": 2, "den": 1 });
        let error = resolve_stabilization(&retimed, &root).expect_err("velocidad 2x");
        assert_eq!(error.code, ProjectErrorCode::InvalidProject);
        assert!(error.message.contains("velocidad"));

        let mut reversed = stabilized_clip();
        reversed["reverse"] = serde_json::json!(true);
        assert_eq!(
            resolve_stabilization(&reversed, &root)
                .expect_err("reverse")
                .code,
            ProjectErrorCode::InvalidProject
        );

        let mut transition = stabilized_clip();
        transition["transitionIn"] = serde_json::json!({ "type": "dissolve", "frames": 6 });
        assert_eq!(
            resolve_stabilization(&transition, &root)
                .expect_err("transición de entrada")
                .code,
            ProjectErrorCode::InvalidProject
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn stabilization_requires_its_transform_file() {
        let root = std::env::temp_dir().join(format!("editor-ia-stab-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("media")).unwrap();
        let error = resolve_stabilization(&stabilized_clip(), &root)
            .expect_err("sin archivo de transformación");
        assert_eq!(error.code, ProjectErrorCode::NotFound);
        assert!(error.message.contains("volvé a analizarla"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_plan_wires_stabilization_into_the_render_graph() {
        let root = std::env::temp_dir().join(format!("editor-ia-stab-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(media.join("stabilizers")).unwrap();
        std::fs::write(media.join("video.mp4"), b"x").unwrap();
        std::fs::write(media.join("stabilizers").join("move.trf"), b"").unwrap();
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "timeline": {
                "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
                "clips": [{
                    "id": "22222222-2222-4222-8222-222222222222",
                    "trackId": "11111111-1111-4111-8111-111111111111",
                    "kind": "video",
                    "startFrame": 0,
                    "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 },
                    "stabilization": { "smoothing": 12, "transformFile": "media/stabilizers/move.trf", "inFrame": 0, "outFrame": 30 }
                }]
            },
            "assets": [{
                "id": "33333333-3333-4333-8333-333333333333",
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/video.mp4" },
                "media": { "durationFrames": 30 }
            }],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("out.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan con estabilización debería construirse");
        let graph = plan
            .args
            .iter()
            .find(|arg| arg.contains("vidstabtransform"))
            .expect("falta vidstabtransform en el grafo");
        assert!(graph.contains("media/stabilizers/move.trf"));
        assert!(graph.contains("smoothing=12"));
        assert!(graph.contains("crop=black"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Real end-to-end render. It is ignored by default because it needs
    /// FFmpeg/FFprobe and writes a temporary MP4. Run it explicitly with:
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live -- --ignored`.
    /// Live freeze: generates a clip, extracts a PNG and renders the video plus
    /// the 2 s still through `build_plan`. Ignored by default; run with
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live_freeze -- --ignored`.
    #[test]
    #[ignore]
    fn render_live_freeze_produces_a_verified_mp4() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_freeze omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root =
            std::env::temp_dir().join(format!("editor-ia-freeze-live-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let video_path = media.join("video.mp4");
        let frame_path = media.join("frame.png");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner".to_string(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc=size=320x180:rate=30:duration=1".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                path_to_string(&video_path),
            ])
            .status()
            .unwrap();
        assert!(status.success(), "no se pudo generar el video base");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner".to_string(),
                "-y".into(),
                "-ss".into(),
                "0.5".into(),
                "-i".into(),
                path_to_string(&video_path),
                "-frames:v".into(),
                "1".into(),
                path_to_string(&frame_path),
            ])
            .status()
            .unwrap();
        assert!(status.success(), "no se pudo extraer el frame");
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false }],
                "clips": [
                    { "id": "c1", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 30 } },
                    { "id": "f1", "trackId": "v1", "kind": "freeze", "label": "Congelado", "startFrame": 30, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset2" }, "effects": { "saturation": 1.1 }, "transitionIn": { "type": "dissolve", "frames": 6 } }
                ]
            },
            "assets": [
                { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" }, "media": { "durationFrames": 30 } },
                { "id": "asset2", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/frame.png" } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let output = root.join("out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let mut profile = profile();
        profile.width = 320;
        profile.height = 180;
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan con freeze debería construirse");
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
            .expect("el render real del freeze debería verificarse");
        eprintln!(
            "freeze render: {} bytes, {}x{}, {:.3}s",
            verification.output_bytes,
            verification.width,
            verification.height,
            verification.duration_seconds
        );
        assert!(output.is_file());
        assert!(verification.output_bytes > 1_000);
        assert_eq!(verification.width, 320);
        assert_eq!(verification.height, 180);
        assert!(
            (verification.duration_seconds - 2.0).abs() < 0.4,
            "duración inesperada: {}",
            verification.duration_seconds
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    #[ignore]
    fn render_live_pipeline_produces_a_verified_mp4() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");

        let root = std::env::temp_dir().join(format!("editor-ia-render-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let video_path = media.join("video.mp4");
        let audio_path = media.join("audio.wav");
        for (args, path) in [
            (
                vec![
                    "-hide_banner".to_string(),
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    "testsrc2=size=320x180:rate=30".into(),
                    "-t".into(),
                    "2".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    path_to_string(&video_path),
                ],
                &video_path,
            ),
            (
                vec![
                    "-hide_banner".to_string(),
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    "sine=frequency=440:sample_rate=48000".into(),
                    "-t".into(),
                    "2".into(),
                    path_to_string(&audio_path),
                ],
                &audio_path,
            ),
        ] {
            let status = Command::new(&ffmpeg).args(&args).status().unwrap();
            assert!(status.success(), "no se pudo generar {}", path.display());
        }
        std::fs::write(
            media.join("identity.cube"),
            "TITLE \"identity\"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n",
        )
        .unwrap();

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false },
                    { "id": "22222222-2222-4222-8222-222222222222", "kind": "narration", "label": "N1", "order": 1, "hidden": false, "muted": false },
                    { "id": "33333333-3333-4333-8333-333333333333", "kind": "caption", "label": "C1", "order": 2, "hidden": false, "muted": false },
                    { "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "kind": "adjustment", "label": "Ajustes", "order": 3, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Toma", "startFrame": 15, "durationFrames": 60, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 60 }, "motion": { "type": "zoom-in", "intensity": 0.15 }, "reverse": true, "transitionIn": { "type": "dissolve", "frames": 6 }, "transform": { "keyframes": [{ "frame": 0, "scale": 1.0, "offsetX": 0, "rotationDeg": 0, "opacity": 0.2, "easing": "ease-in" }, { "frame": 30, "scale": 1.25, "offsetX": 20, "rotationDeg": 3, "opacity": 0.6, "easing": "ease-out" }, { "frame": 59, "scale": 1.05, "offsetX": -10, "rotationDeg": 0, "opacity": 1.0 }] }, "effects": { "fadeInFrames": 6, "fadeOutFrames": 6, "lutFile": "media/identity.cube", "lift": { "r": 0.05, "g": 0, "b": 0.08 }, "gamma": { "r": 0.1, "g": 0, "b": -0.05 }, "gain": { "r": 0.08, "g": 0, "b": -0.03 }, "hsl": { "hue": 8, "saturation": 0.1, "intensity": 0.04, "colors": ["r", "y"] }, "colorMatch": { "r": 1.08, "g": 1.0, "b": 0.96, "strength": 0.7 }, "shadows": 0.1, "highlights": -0.1, "fade": 0.05 }, "chromaKey": { "color": "#00ff00", "similarity": 0.2, "blend": 0.1 }, "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.82, "height": 0.92, "rotationDeg": 25, "feather": 0.18, "invert": false, "keyframes": [{ "frame": 0, "x": -0.15 }, { "frame": 30, "x": 0 }, { "frame": 59, "x": 0.15 }] }, "animationIn": { "type": "slide-down", "durationFrames": 12 }, "animationOut": { "type": "fade", "durationFrames": 12 }, "blendMode": "screen" },
                    { "id": "66666666-6666-4666-8666-666666666666", "trackId": "22222222-2222-4222-8222-222222222222", "kind": "audio", "label": "Voz", "startFrame": 0, "durationFrames": 60, "reverse": true, "source": { "type": "asset", "assetId": "77777777-7777-4777-8777-777777777777", "inFrame": 0, "outFrame": 60 }, "audio": { "gainDb": -3, "highPassHz": 80, "lowPassHz": 12000, "eqMidDb": 3, "compressor": true, "deesser": true, "gateDb": -38, "denoise": 0.1, "voiceEffect": "radio", "gainKeyframes": [{ "frame": 0, "gainDb": -3, "easing": "ease-in" }, { "frame": 30, "gainDb": -12 }, { "frame": 59, "gainDb": -3 }] } },
                    { "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "trackId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "kind": "adjustment", "label": "Look del tramo", "startFrame": 0, "durationFrames": 75, "source": { "type": "adjustment" }, "effects": { "contrast": 1.08, "curvePreset": "contrast-soft", "lutFile": "media/identity.cube" } }
                ]
            },
            "assets": [
                { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" }, "media": { "durationFrames": 60 } },
                { "id": "77777777-7777-4777-8777-777777777777", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/audio.wav" }, "media": { "durationFrames": 60 } }
            ],
            "captions": {
                "styles": [{ "id": "88888888-8888-4888-8888-888888888888", "name": "Principal", "fontFamily": "Arial", "fontSizePx": 30, "color": "#ffffff", "outlineColor": "#000000", "position": "bottom", "bold": true, "borderStyle": "outline", "depth3d": 5, "depthColor": "#f43f5e" }],
                "cues": [{ "id": "99999999-9999-4999-8999-999999999999", "trackId": "33333333-3333-4333-8333-333333333333", "styleId": "88888888-8888-4888-8888-888888888888", "text": "Hola desde Editor IA", "startFrame": 6, "endFrame": 50, "words": [{ "text": "Hola", "startFrame": 6, "endFrame": 18 }, { "text": "desde", "startFrame": 18, "endFrame": 30 }, { "text": "Editor", "startFrame": 30, "endFrame": 42 }, { "text": "IA", "startFrame": 42, "endFrame": 50 }], "wordReveal": true, "animation": "pop" }, { "id": "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "trackId": "33333333-3333-4333-8333-333333333333", "styleId": "88888888-8888-4888-8888-888888888888", "text": "Título animado", "startFrame": 52, "endFrame": 74, "motion": { "preset": "slide-left", "keyframes": [{ "frame": 0, "x": -0.8, "scale": 0.85, "rotationDeg": -8, "opacity": 0 }, { "frame": 22, "x": 0, "scale": 1, "rotationDeg": 0, "opacity": 1 }] } }]
            },
            "audio": { "master": { "gainDb": 0 }, "loudnessTarget": { "platform": "youtube", "integratedLufs": -14, "truePeakDb": -1.5, "toleranceDb": 1.5 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test 320x180".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1_000,
            duration_tolerance_frames: 10,
            hardware_encoder: None,
        };
        let output = root.join("out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: true,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan debería construirse");
        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair[0] == "-preset" && pair[1] == "faster"));
        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair[0] == "-crf" && pair[1] == "27"));
        assert!(plan
            .args
            .windows(2)
            .any(|pair| pair[0] == "-b:a" && pair[1] == "96000"));
        let mut events = 0;
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_progress| events += 1)
            .expect("el render real debería completarse y verificarse");
        eprintln!(
            "render compacto: {} bytes, {}x{}, {:.3}s",
            verification.output_bytes,
            verification.width,
            verification.height,
            verification.duration_seconds
        );
        assert!(events > 0, "ffmpeg debería reportar progreso");
        assert_eq!(verification.width, 320);
        assert_eq!(verification.height, 180);
        assert!((verification.duration_seconds - 2.5).abs() < 0.5);
        assert!(output.is_file());

        // The clip fades from 20% to 100% opacity over a dark background. Sample
        // before the exit animation (last 0.4 s) and the fade-out (last 0.2 s)
        // so the change is attributable to the keyframed opacity.
        let early = average_luma(&ffmpeg, &output, 0.6);
        let late = average_luma(&ffmpeg, &output, 2.0);
        eprintln!("opacidad animada: YAVG 0.6s={early:.2} 2.1s={late:.2}");
        assert!(
            late > early + 20.0,
            "la opacidad animada no cambió la luminancia: {early:.2} -> {late:.2}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Render real de un WebM VP9 con alfa: verifica que el decodificador
    /// forzado conserve la transparencia y el fondo del proyecto se vea.
    #[test]
    #[ignore]
    fn render_live_alpha_cutout_composites_transparency() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_alpha omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root = std::env::temp_dir().join(format!("editor-ia-alpha-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let alpha_path = media.join("alpha.webm");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "nullsrc=s=320x180:d=1:r=30,format=rgba,geq=r='if(between(X,110,209)*between(Y,40,139),255,0)':g=0:b=0:a='if(between(X,110,209)*between(Y,40,139),255,0)'",
                "-c:v",
                "libvpx-vp9",
                "-pix_fmt",
                "yuva420p",
                "-b:v",
                "0",
                "-crf",
                "30",
                "-y",
            ])
            .arg(&alpha_path)
            .status()
            .expect("generar el WebM con alfa");
        assert!(status.success());

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#1010ff" },
            "timeline": {
                "tracks": [
                    { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Recorte", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 30 }, "effects": { "glow": { "intensity": 0.8, "radius": 12, "threshold": 0.4 } } }
                ]
            },
            "assets": [
                { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/alpha.webm" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 }, "alpha": true } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test alfa 320x180".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1_000,
            duration_tolerance_frames: 10,
            hardware_encoder: None,
        };
        let output = root.join("alpha-out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan con alfa debería construirse");
        assert!(
            plan.args
                .windows(2)
                .any(|pair| pair[0] == "-c:v" && pair[1] == "libvpx-vp9"),
            "el plan debe forzar el decoder de libvpx para el WebM"
        );
        assert!(
            plan.args.iter().any(|arg| arg.contains("alphamerge")),
            "el glow debe restaurar el alfa de la rama base"
        );
        execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("render con alfa");

        let frame_path = root.join("frame.png");
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-ss", "0.5", "-i"])
            .arg(&output)
            .args(["-frames:v", "1", "-y"])
            .arg(&frame_path)
            .status()
            .expect("extraer el frame");
        assert!(status.success());
        let frame = image::open(&frame_path).expect("leer el frame").to_rgb8();
        let corner = frame.get_pixel(8, 8).0;
        let center = frame.get_pixel(160, 90).0;
        eprintln!("alfa: corner={corner:?} center={center:?}");
        assert!(
            corner[2] > 140 && corner[0] < 90,
            "el fondo transparente debería mostrar el azul del proyecto: {corner:?}"
        );
        assert!(
            center[0] > 140 && center[2] < 100,
            "el sujeto debería verse rojo: {center:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Render real de una máscara de texto: un clip rojo sólo se ve a través
    /// de las letras sobre el fondo azul del proyecto.
    #[test]
    #[ignore]
    fn render_live_text_mask_clips_the_clip_to_the_glyphs() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_text_mask omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root =
            std::env::temp_dir().join(format!("editor-ia-textmask-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let source = media.join("red.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x180:d=1:r=30",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&source)
            .status()
            .expect("generar el clip rojo");
        assert!(status.success());

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#0000ff" },
            "timeline": {
                "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }],
                "clips": [{
                    "id": "22222222-2222-4222-8222-222222222222",
                    "trackId": "11111111-1111-4111-8111-111111111111",
                    "kind": "video",
                    "label": "Texto",
                    "startFrame": 0,
                    "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 },
                    "mask": { "shape": "text", "x": 0, "y": 0, "width": 1, "height": 1, "feather": 0, "invert": false, "text": "HOLA", "fontScale": 0.4 }
                }]
            },
            "assets": [{
                "id": "33333333-3333-4333-8333-333333333333",
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/red.mp4" },
                "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } }
            }],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test text mask".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 500,
            duration_tolerance_frames: 5,
            hardware_encoder: None,
        };
        let output = root.join("textmask-out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan con máscara de texto debería construirse");
        assert!(plan.args.iter().any(|arg| arg.contains("drawtext")));
        execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("render con máscara de texto");

        let frame_path = root.join("frame.png");
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-ss", "0.4", "-i"])
            .arg(&output)
            .args(["-frames:v", "1", "-y"])
            .arg(&frame_path)
            .status()
            .expect("extraer el frame");
        assert!(status.success());
        let frame = image::open(&frame_path).expect("leer el frame").to_rgb8();
        let mut red = 0;
        let mut blue = 0;
        for pixel in frame.pixels() {
            let [r, g, b] = pixel.0;
            if r > 150 && g < 100 && b < 100 {
                red += 1;
            }
            if b > 150 && r < 100 && g < 100 {
                blue += 1;
            }
        }
        eprintln!("máscara de texto: {red} píxeles rojos, {blue} azules");
        assert!(red > 100, "no se ven los glifos rojos: {red}");
        assert!(blue > 500, "el fondo azul no domina: {blue}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Render real con glow y desenfoque de movimiento: valida la rama
    /// split/blend y el filtro temporal dentro del plan completo.
    #[test]
    #[ignore]
    fn render_live_glow_and_motion_blur_produces_a_verified_mp4() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_glow omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root = std::env::temp_dir().join(format!("editor-ia-glow-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let source = media.join("source.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:r=30:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&source)
            .status()
            .expect("generar el clip de entrada");
        assert!(status.success());

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Glow", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 30 }, "effects": { "glow": { "intensity": 0.7, "radius": 12, "threshold": 0.5 }, "motionBlur": { "frames": 4, "intensity": 0.5 } } }
                ]
            },
            "assets": [
                { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/source.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test glow 320x180".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1_000,
            duration_tolerance_frames: 10,
            hardware_encoder: None,
        };
        let output = root.join("glow-out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan con glow debería construirse");
        assert!(
            plan.args
                .iter()
                .any(|arg| arg.contains("split=2[v1base][v1glow]")),
            "el plan debe incluir la rama de glow"
        );
        assert!(
            plan.args.iter().any(|arg| arg.contains("tmix=frames=4")),
            "el plan debe incluir el desenfoque de movimiento"
        );
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
            .expect("el render con glow debería completarse");
        assert!((verification.duration_seconds - 1.0).abs() < 0.25);
        assert!(output.is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Render real de un rango I/O: de un clip de 2 s sale sólo el tramo 1–2 s.
    #[test]
    #[ignore]
    fn render_live_export_range_produces_only_the_selected_frames() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_range omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root = std::env::temp_dir().join(format!("editor-ia-range-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let source = media.join("source.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&source)
            .status()
            .expect("generar el clip de entrada");
        assert!(status.success());

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }],
                "clips": [{ "id": "22222222-2222-4222-8222-222222222222", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Rango", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 60 } }]
            },
            "assets": [{
                "id": "33333333-3333-4333-8333-333333333333",
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/source.mp4" },
                "media": { "width": 320, "height": 180, "durationFrames": 60, "frameRate": { "num": 30, "den": 1 } }
            }],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test rango 320x180".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 500,
            duration_tolerance_frames: 5,
            hardware_encoder: None,
        };
        let output = root.join("range-out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan_range(
            BuildPlanInput {
                audio_only: false,
                project: &project,
                root: &root,
                profile: &profile,
                output_path: &output,
                include_captions: false,
                temp_dir: &temp,
                ffprobe: &ffprobe,
                motion_ass: None,
            },
            Some((30, 60)),
        )
        .expect("el plan con rango debería construirse");
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
            .expect("el render con rango debería verificarse");
        assert!((verification.duration_seconds - 1.0).abs() < 0.2);
        let count = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=nb_read_frames",
                "-of",
                "default=nw=1:nk=1",
            ])
            .arg(&output)
            .output()
            .expect("contar frames");
        let frames = String::from_utf8_lossy(&count.stdout)
            .trim()
            .parse::<u64>()
            .unwrap_or(0);
        assert!((29..=31).contains(&frames), "frames del rango: {frames}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Render real con ducking: la música sigue sonando después de la voz y
    /// baja mientras la voz habla. Se mide la banda de 300 Hz dentro y fuera de
    /// la locución, con y sin ducking, para separar la atenuación del contenido.
    #[test]
    fn render_live_ducking_keeps_the_bed_and_lowers_it_under_the_voice() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_ducking omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root = std::env::temp_dir().join(format!("editor-ia-duck-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        for (name, frequency, seconds) in [("cama.wav", 300, 3), ("voz.wav", 1_000, 1)] {
            let status = Command::new(&ffmpeg)
                .args(["-hide_banner", "-v", "error", "-f", "lavfi", "-i"])
                .arg(format!("sine=frequency={frequency}:duration={seconds}"))
                .args(["-ac", "2", "-c:a", "pcm_s16le", "-y"])
                .arg(media.join(name))
                .status()
                .expect("generar el audio de prueba");
            assert!(status.success());
        }

        let mut project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "voz", "kind": "narration", "label": "Voz", "order": 0, "hidden": false, "muted": false },
                    { "id": "musica", "kind": "audio", "label": "Música", "order": 1, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "cama", "trackId": "musica", "kind": "audio", "label": "Cama", "startFrame": 0, "durationFrames": 90,
                      "source": { "type": "asset", "assetId": "cama", "inFrame": 0, "outFrame": 90 } },
                    { "id": "locucion", "trackId": "voz", "kind": "audio", "label": "Locución", "startFrame": 30, "durationFrames": 30,
                      "source": { "type": "asset", "assetId": "voz", "inFrame": 0, "outFrame": 30 } }
                ]
            },
            "assets": [
                { "id": "cama", "kind": "audio", "status": "ready",
                  "rights": { "license": { "commercialUse": "allowed" } },
                  "source": { "path": "media/cama.wav" },
                  "media": { "durationFrames": 90, "sampleRate": 48_000, "channels": 2 } },
                { "id": "voz", "kind": "audio", "status": "ready",
                  "rights": { "license": { "commercialUse": "allowed" } },
                  "source": { "path": "media/voz.wav" },
                  "media": { "durationFrames": 30, "sampleRate": 48_000, "channels": 2 } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test ducking 320x180".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 500,
            duration_tolerance_frames: 5,
            hardware_encoder: None,
        };
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let render = |project: &Value, name: &str| {
            let output = root.join(name);
            let plan = build_plan(BuildPlanInput {
                audio_only: false,
                project,
                root: &root,
                profile: &profile,
                output_path: &output,
                include_captions: false,
                temp_dir: &temp,
                ffprobe: &ffprobe,
                motion_ass: None,
            })
            .expect("el plan con audio debería construirse");
            execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("el render debería verificarse");
            output
        };
        project["audio"]["ducking"] = serde_json::json!({
            "enabled": true, "amountDb": -12,
            "sourceTrackIds": ["voz"], "targetTrackIds": ["musica"]
        });
        let ducked = render(&project, "ducked.mp4");
        project["audio"]["ducking"]["enabled"] = serde_json::json!(false);
        let plain = render(&project, "plain.mp4");

        let duration_of = |file: &std::path::Path| -> f64 {
            let output = Command::new(&ffprobe)
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=nw=1:nk=1",
                ])
                .arg(file)
                .output()
                .expect("probar duración");
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse()
                .unwrap_or(0.0)
        };
        // Sin apad el filtro terminaba con la voz y la música se cortaba a 1 s.
        assert!(
            (duration_of(&ducked) - 3.0).abs() < 0.25,
            "la cama debe seguir hasta el final: {} s",
            duration_of(&ducked)
        );

        let music_band = |file: &std::path::Path, start: &str, seconds: &str| -> f64 {
            let output = Command::new(&ffmpeg)
                .args([
                    "-hide_banner",
                    "-nostats",
                    "-ss",
                    start,
                    "-t",
                    seconds,
                    "-i",
                ])
                .arg(file)
                .args([
                    "-af",
                    "bandpass=f=300:width_type=h:w=50,volumedetect",
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .expect("medir la banda de la música");
            let text = String::from_utf8_lossy(&output.stderr);
            text.lines()
                .find_map(|line| line.split("mean_volume:").nth(1))
                .and_then(|value| value.trim().split_whitespace().next())
                .and_then(|value| value.parse().ok())
                .unwrap_or_else(|| panic!("volumedetect no informó mean_volume: {text}"))
        };
        let inside = music_band(&ducked, "1.2", "0.6");
        let outside = music_band(&ducked, "2.5", "0.4");
        assert!(
            outside - inside >= 4.0,
            "la música debería bajar con la voz: dentro {inside} dB, fuera {outside} dB"
        );
        let plain_inside = music_band(&plain, "1.2", "0.6");
        let plain_outside = music_band(&plain, "2.5", "0.4");
        assert!(
            (plain_outside - plain_inside).abs() <= 1.5,
            "sin ducking la banda no debe cambiar: dentro {plain_inside} dB, fuera {plain_outside} dB"
        );
        eprintln!(
            "ducking medido: dentro {inside:.1} dB, fuera {outside:.1} dB; sin ducking {plain_inside:.1}/{plain_outside:.1} dB"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Render real de una cámara lenta con interpolación: el clip dura el doble
    /// y el MP4 conserva la duración y los frames esperados.
    #[test]
    #[ignore]
    fn render_live_slow_motion_interpolation_keeps_duration() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_slow omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root = std::env::temp_dir().join(format!("editor-ia-slow-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let source = media.join("source.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:r=30:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&source)
            .status()
            .expect("generar el clip de entrada");
        assert!(status.success());

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Lenta", "startFrame": 0, "durationFrames": 60, "speed": { "num": 1, "den": 2 }, "slowMotionSmoothing": true, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 30 } }
                ]
            },
            "assets": [
                { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/source.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test lento 320x180".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1_000,
            duration_tolerance_frames: 10,
            hardware_encoder: None,
        };
        let output = root.join("slow-out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan lento debería construirse");
        let filter = plan
            .args
            .iter()
            .find(|arg| arg.contains("minterpolate"))
            .expect("el plan debe incluir minterpolate");
        assert!(filter.contains("setpts=(PTS-STARTPTS)*2/1"));
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("render lento");
        assert!((verification.duration_seconds - 2.0).abs() < 0.25);
        let frames = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-count_frames",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=nb_read_frames",
                "-of",
                "default=nw=1:nk=1",
            ])
            .arg(&output)
            .output()
            .expect("contar frames");
        let count = String::from_utf8_lossy(&frames.stdout)
            .trim()
            .parse::<u64>()
            .unwrap_or(0);
        eprintln!(
            "cámara lenta: {:.3}s, {count} frames",
            verification.duration_seconds
        );
        assert!((58..=62).contains(&count), "frames inesperados: {count}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Live stabilization: generates a shaky clip, analyzes it with
    /// `vidstabdetect`, renders through `build_plan` and verifies the MP4 with
    /// FFprobe. Ignored by default; run with
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live_stabilization -- --ignored`.
    #[test]
    #[ignore]
    fn render_live_stabilization_produces_a_verified_mp4() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_stabilization omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");

        let root =
            std::env::temp_dir().join(format!("editor-ia-stab-live-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        let stabilizers = media.join("stabilizers");
        std::fs::create_dir_all(&stabilizers).unwrap();
        let shaky = media.join("shaky.mp4");
        let source = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=240x136:rate=30",
                "-t",
                "1.5",
                "-vf",
                "crop=200:112:x='20+12*sin(2*PI*t*2)':y='12+8*cos(2*PI*t*2)'",
                "-pix_fmt",
                "yuv420p",
                &path_to_string(&shaky),
            ])
            .status()
            .unwrap();
        assert!(
            source.success(),
            "no se pudo generar el clip con movimiento"
        );

        let transform = stabilizers.join("shaky.trf");
        let analyze = Command::new(&ffmpeg)
            .current_dir(&stabilizers)
            .args([
                "-hide_banner",
                "-nostats",
                "-ss",
                "0.000000",
                "-t",
                "1.500000",
                "-i",
                &path_to_string(&shaky),
                "-vf",
                "vidstabdetect=shakiness=5:accuracy=15:result=shaky.trf",
                "-an",
                "-f",
                "null",
                "-",
            ])
            .output()
            .unwrap();
        assert!(
            analyze.status.success(),
            "vidstabdetect falló: {}",
            String::from_utf8_lossy(&analyze.stderr)
        );
        assert!(
            transform.is_file() && std::fs::metadata(&transform).unwrap().len() > 0,
            "vidstabdetect no escribió el .trf"
        );

        let project = serde_json::json!({
            "video": { "width": 200, "height": 112, "frameRate": { "num": 30, "den": 1 } },
            "timeline": {
                "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
                "clips": [{
                    "id": "22222222-2222-4222-8222-222222222222",
                    "trackId": "11111111-1111-4111-8111-111111111111",
                    "kind": "video",
                    "startFrame": 0,
                    "durationFrames": 45,
                    "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 45 },
                    "stabilization": { "smoothing": 12, "transformFile": "media/stabilizers/shaky.trf", "inFrame": 0, "outFrame": 45 }
                }]
            },
            "assets": [{
                "id": "33333333-3333-4333-8333-333333333333",
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } },
                "source": { "path": "media/shaky.mp4" },
                "media": { "durationFrames": 45 }
            }],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let live_profile = Profile {
            id: "stab".into(),
            name: "Estabilización 200x112".into(),
            width: 200,
            height: 112,
            fps_num: 30,
            fps_den: 1,
            crf: Some(27),
            target_bps: None,
            video_preset: "faster".into(),
            fit: "contain".into(),
            audio_bps: 96_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1_000,
            duration_tolerance_frames: 10,
            hardware_encoder: None,
        };
        let output = root.join("out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &live_profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan estabilizado debería construirse");
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
            .expect("el render estabilizado debería verificarse");
        eprintln!(
            "render estabilizado: {} bytes, {}x{}, {:.3}s",
            verification.output_bytes,
            verification.width,
            verification.height,
            verification.duration_seconds
        );
        assert_eq!(verification.width, 200);
        assert_eq!(verification.height, 112);
        assert!((verification.duration_seconds - 1.5).abs() < 0.4);
        assert!(output.is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    #[ignore]
    fn render_live_motion_graphics_produces_visible_pixels() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("render_live_motion omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        use crate::render::motion::{build_motion_ass, MotionAssInput};

        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
        let root =
            std::env::temp_dir().join(format!("editor-ia-motion-live-{}", uuid::Uuid::new_v4()));
        let media = root.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let base = media.join("base.mp4");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                &path_to_string(&base),
            ])
            .status()
            .expect("ffmpeg debería crear el video base");
        assert!(status.success(), "no se pudo crear el video base");

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                    { "id": "g1", "kind": "graphic", "order": 1, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "vclip", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "base", "inFrame": 0, "outFrame": 60 } },
                    { "id": "gclip", "trackId": "g1", "kind": "graphic", "startFrame": 0, "durationFrames": 60, "source": { "type": "graphic", "motionId": "m" } }
                ]
            },
            "assets": [
                { "id": "base", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/base.mp4" }, "media": { "durationFrames": 60 } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        });
        let plans = serde_json::json!({
            "gclip": {
                "version": 1,
                "width": 320,
                "height": 180,
                "fps": { "num": 30, "den": 1 },
                "durationFrames": 60,
                "layers": [
                    { "kind": "rect", "x": 0.05, "y": 0.05, "width": 0.9, "height": 0.9, "color": "#ff0000", "opacity": 1, "animation": { "kind": "none" } },
                    { "kind": "text", "x": 0.2, "y": 0.4, "width": 0.6, "height": 0.2, "text": "MOTION", "fontFamily": "Segoe UI", "fontSizePx": 40, "weight": 700, "color": "#ffffff", "align": "center", "animation": { "kind": "fade", "inFrames": 5 } }
                ]
            }
        });
        let ass = build_motion_ass(MotionAssInput {
            project: &project,
            plans: &plans,
            render_width: 320,
            render_height: 180,
            project_width: 320,
            project_height: 180,
            project_fps: 30.0,
        })
        .expect("el ASS de motion debería generarse");
        assert!(ass.contains("MOTION"));

        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let output = root.join("out.mp4");
        let mut profile = profile();
        profile.width = 320;
        profile.height = 180;
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: Some(&ass),
        })
        .expect("el plan de motion debería construirse");
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
            .expect("el render real de motion debería verificarse");
        assert!(output.is_file());
        assert!(verification.output_bytes > 1_000);
        assert_eq!(verification.width, 320);
        assert_eq!(verification.height, 180);
        assert!(
            (verification.duration_seconds - 2.0).abs() < 0.4,
            "duración inesperada: {}",
            verification.duration_seconds
        );

        let frame = root.join("frame.png");
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                "1",
                "-i",
                &path_to_string(&output),
                "-frames:v",
                "1",
                &path_to_string(&frame),
            ])
            .status()
            .expect("ffmpeg debería extraer un frame");
        assert!(status.success(), "no se pudo extraer el frame");
        let image = image::open(&frame)
            .expect("el frame debería abrirse")
            .to_rgba8();
        let mut red = 0usize;
        for pixel in image.pixels() {
            if pixel[0] > 200 && pixel[1] < 80 && pixel[2] < 100 {
                red += 1;
            }
        }
        eprintln!(
            "motion render: {} bytes, {:.3}s, {} píxeles rojos",
            verification.output_bytes, verification.duration_seconds, red
        );
        assert!(
            red > 1_000,
            "el overlay de motion no aparece: {red} píxeles rojos"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    fn average_luma(ffmpeg: &Path, path: &Path, seconds: f64) -> f64 {
        let probe = Command::new(ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                &format!("{seconds:.3}"),
                "-i",
                &path_to_string(path),
                "-frames:v",
                "1",
                "-vf",
                "signalstats,metadata=print:file=-",
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("ffmpeg debería medir la luminancia");
        let stdout = String::from_utf8_lossy(&probe.stdout);
        stdout
            .lines()
            .find_map(|line| line.strip_prefix("lavfi.signalstats.YAVG="))
            .and_then(|value| value.trim().parse::<f64>().ok())
            .expect("ffmpeg debería reportar lavfi.signalstats.YAVG")
    }

    fn path_to_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }
}
