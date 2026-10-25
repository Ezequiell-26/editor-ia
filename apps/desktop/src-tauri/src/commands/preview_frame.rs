//! Preview real de un frame.
//!
//! Por defecto compone el frame con el mismo plan del render final: todas las
//! pistas visuales, capas de ajuste, look global y subtítulos. Si el compuesto
//! no se puede armar (por ejemplo, clips gráficos sin plan de motion) cae al
//! clip visual seleccionado, que conserva color, máscara, relight, lente, LUT y
//! transformación. En ambos casos se usa el mismo `visual_filter` del export,
//! sin escribir un MP4. El frame nativo (`native: true`) sigue siendo el clip
//! a la resolución del medio para inspección 1:1.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{
    alpha_video_decoder, apply_lut_to_chain, build_plan, eased_fraction, effects_lut,
    expand_compounds, transition_lead_seconds, visual_filter, BuildPlanInput, Profile,
};
use crate::render::motion::has_visible_graphic_clips;
use crate::state::AppState;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameRequest {
    pub project: Value,
    pub clip_id: String,
    pub frame: u64,
    /// Pide el frame a la resolución nativa del medio, no a la del lienzo.
    #[serde(default)]
    pub native: bool,
    /// Compone todas las pistas y subtítulos. Por defecto sí; `false` fuerza
    /// el clip aislado y `native` siempre usa el clip a su resolución.
    #[serde(default)]
    pub composite: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub frame: u64,
    pub time_seconds: f64,
    pub clip_id: String,
    pub clip_label: String,
    /// `true` si el PNG quedó a la resolución real del medio.
    pub native: bool,
    /// `video-rs` cuando el frame se decodificó en proceso; `ffmpeg` cuando
    /// se usó el ejecutable (rotación, SAR no cuadrado o fallback).
    pub decoder: String,
    /// `true` si el PNG es el compuesto de todas las pistas visibles.
    pub composite: bool,
    /// `window` renderiza sólo el frame activo; `full` recorre la timeline
    /// completa (transiciones no congelables, como un tipo desconocido);
    /// `none` es el clip suelto.
    pub composite_mode: String,
    /// Pistas visuales con al menos un clip activo en el frame.
    pub visible_tracks: usize,
    /// `true` si hay un cue de subtítulos activo en el frame.
    pub captions_burned: bool,
    /// Explica por qué se devolvió el clip suelto en lugar del compuesto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
}

fn profile_for(project: &Value) -> Result<Profile, ProjectError> {
    let width = project["video"]["width"].as_u64().unwrap_or(0);
    let height = project["video"]["height"].as_u64().unwrap_or(0);
    let fps_num = project["video"]["frameRate"]["num"].as_u64().unwrap_or(0) as u32;
    let fps_den = project["video"]["frameRate"]["den"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 || fps_num == 0 || fps_den == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto no tiene resolución o fps válidos para el preview",
        ));
    }
    Ok(Profile {
        id: "preview".to_owned(),
        name: "preview".to_owned(),
        width: width as u32,
        height: height as u32,
        fps_num,
        fps_den,
        crf: None,
        target_bps: None,
        video_preset: "veryfast".to_owned(),
        fit: "contain".to_owned(),
        audio_bps: 128_000,
        video_codec: "h264".to_owned(),
        audio_codec: "aac".to_owned(),
        container: "mp4".to_owned(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1,
        duration_tolerance_frames: 1,
        hardware_encoder: None,
    })
}

fn source_time(clip: &Value, frame: u64, fps: f64) -> (f64, bool) {
    let start = clip["startFrame"].as_u64().unwrap_or(0);
    let duration = clip["durationFrames"].as_u64().unwrap_or(1).max(1);
    let local = frame.saturating_sub(start).min(duration.saturating_sub(1));
    let source = &clip["source"];
    let kind = clip["kind"].as_str().unwrap_or("video");
    if kind == "image" || kind == "graphic" || source["type"].as_str() != Some("asset") {
        return (0.0, true);
    }
    let in_frame = source["inFrame"].as_u64().unwrap_or(0) as f64;
    let out_frame = source["outFrame"].as_u64().unwrap_or(0) as f64;
    let speed_num = clip["speed"]["num"].as_f64().unwrap_or(1.0).max(0.01);
    let speed_den = clip["speed"]["den"].as_f64().unwrap_or(1.0).max(0.01);
    let local_seconds = local as f64 / fps.max(1.0);
    let reverse = clip["reverse"].as_bool().unwrap_or(false);
    let time = if reverse {
        out_frame / fps.max(1.0) - local_seconds * speed_num / speed_den
    } else {
        in_frame / fps.max(1.0) + local_seconds * speed_num / speed_den
    };
    (time.max(0.0), false)
}

/// Metadatos medidos del contenedor: dimensiones codificadas, rotación de
/// presentación y relación de aspecto de píxel. Se leen con libavformat, sin
/// lanzar ffprobe, para decidir si el frame nativo se puede decodificar en
/// proceso o si conviene delegar en el ejecutable.
#[derive(Debug, Clone, Copy)]
struct SourceProbe {
    width: u32,
    height: u32,
    rotation_degrees: f64,
    sample_aspect: f64,
}

/// Resuelve las dimensiones visibles del medio: aplica SAR y sólo intercambia
/// ancho/alto para rotaciones de 90°/270°.
fn display_dimensions(probe: &SourceProbe) -> (u32, u32) {
    let rotation = probe.rotation_degrees.abs();
    let swapped = rotation > 45.0 && rotation < 135.0;
    let mut width = (probe.width as f64 * probe.sample_aspect).round() as u32;
    let mut height = probe.height;
    if swapped {
        std::mem::swap(&mut width, &mut height);
    }
    (width, height)
}

fn probe_source(input: &Path) -> Option<SourceProbe> {
    use video_rs::ffmpeg;

    let context = ffmpeg::format::input(input).ok()?;
    let stream = context.streams().best(ffmpeg::media::Type::Video)?;
    let parameters = stream.parameters();
    let raw = unsafe { &*parameters.as_ptr() };
    if raw.width <= 0 || raw.height <= 0 {
        return None;
    }
    let sample_aspect = if raw.sample_aspect_ratio.num > 0 && raw.sample_aspect_ratio.den > 0 {
        raw.sample_aspect_ratio.num as f64 / raw.sample_aspect_ratio.den as f64
    } else {
        1.0
    };
    let rotation_degrees = stream
        .side_data()
        .find(|side| {
            matches!(
                side.kind(),
                ffmpeg::codec::packet::side_data::Type::DisplayMatrix
            )
        })
        .and_then(|side| {
            let data = side.data();
            if data.len() < 36 {
                return None;
            }
            let mut matrix = [0_i32; 9];
            for (index, slot) in matrix.iter_mut().enumerate() {
                let offset = index * 4;
                *slot = i32::from_le_bytes([
                    data[offset],
                    data[offset + 1],
                    data[offset + 2],
                    data[offset + 3],
                ]);
            }
            let radians = (matrix[1] as f64).atan2(matrix[0] as f64);
            radians.is_finite().then(|| radians.to_degrees())
        })
        .unwrap_or(0.0);
    Some(SourceProbe {
        width: raw.width as u32,
        height: raw.height as u32,
        rotation_degrees,
        sample_aspect,
    })
}

/// PTS del primer frame del stream. `video-rs` entrega timestamps absolutos;
/// sumar este desfase evita elegir un frame equivocado en contenedores con
/// edit lists o start_time distinto de cero.
fn stream_start_seconds(input: &Path) -> Option<f64> {
    use video_rs::ffmpeg;

    let context = ffmpeg::format::input(input).ok()?;
    let stream = context.streams().best(ffmpeg::media::Type::Video)?;
    let start = stream.start_time();
    if start <= 0 || start == i64::MIN {
        return Some(0.0);
    }
    let base = stream.time_base();
    Some(start as f64 * base.numerator() as f64 / base.denominator() as f64)
}

fn ensure_video_rs() -> Result<(), String> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| video_rs::init().map_err(|error| error.to_string()))
        .clone()
}

struct DecodedFrame {
    path: PathBuf,
    width: u32,
    height: u32,
}

/// Decodifica un frame en proceso y lo guarda como PNG RGB. Devuelve un error
/// explicable para que el llamador pueda caer al ejecutable de FFmpeg.
fn decode_native_frame(input: &Path, time: f64, output_dir: &Path) -> Result<DecodedFrame, String> {
    ensure_video_rs()?;
    let mut decoder = video_rs::decode::Decoder::new(input)
        .map_err(|error| format!("video-rs no pudo abrir el medio: {error}"))?;
    let target = stream_start_seconds(input).unwrap_or(0.0) + time.max(0.0);
    if target > 0.05 {
        let milliseconds = (target * 1000.0).round().clamp(0.0, i64::MAX as f64) as i64;
        decoder
            .seek(milliseconds)
            .map_err(|error| format!("video-rs no pudo buscar el frame: {error}"))?;
    }
    let mut best: Option<(f64, video_rs::Frame)> = None;
    for _ in 0..900 {
        match decoder.decode() {
            Ok((timestamp, frame)) => {
                let seconds = timestamp.as_secs_f64();
                let better = best
                    .as_ref()
                    .is_none_or(|(current, _)| (seconds - target).abs() < (current - target).abs());
                if better {
                    best = Some((seconds, frame));
                }
                if seconds + 0.0005 >= target {
                    break;
                }
            }
            Err(video_rs::Error::DecodeExhausted) => break,
            Err(error) => {
                return Err(format!("video-rs no pudo decodificar el frame: {error}"));
            }
        }
    }
    let (_, frame) = best.ok_or_else(|| "video-rs no devolvió ningún frame".to_owned())?;
    let (height, width, _) = frame.dim();
    if width == 0 || height == 0 {
        return Err("video-rs devolvió un frame vacío".to_owned());
    }
    let pixels = frame
        .as_slice()
        .ok_or_else(|| "video-rs devolvió un frame no contiguo".to_owned())?;
    let path = output_dir.join(format!("native-{}.png", Uuid::new_v4()));
    image::save_buffer_with_format(
        &path,
        pixels,
        width as u32,
        height as u32,
        image::ColorType::Rgb8,
        image::ImageFormat::Png,
    )
    .map_err(|error| format!("no se pudo escribir el frame nativo: {error}"))?;
    Ok(DecodedFrame {
        path,
        width: width as u32,
        height: height as u32,
    })
}

/// Copia el perfil del proyecto con las dimensiones reales del medio. La
/// cadena de efectos vuelve a escalar a este tamaño, así que el resultado
/// conserva el grade y la máscara sin perder píxeles.
fn at_dimensions(profile: &Profile, width: u32, height: u32) -> Profile {
    let mut native = profile.clone();
    native.id = "preview-native".to_owned();
    native.name = "preview-native".to_owned();
    native.width = (width.max(2)) & !1;
    native.height = (height.max(2)) & !1;
    native
}

struct NativeInput {
    profile: Profile,
    path: PathBuf,
    /// El path de entrada ya es una imagen: no se le aplica `-ss`.
    still: bool,
    decoder: &'static str,
    native: bool,
    cleanup: Option<PathBuf>,
}

/// Resuelve la entrada del preview nativo. Para videos sin rotación y con
/// píxeles cuadrados se decodifica en proceso con `video-rs`; el resto usa el
/// ejecutable, que aplica autorrotación y SAR, o vuelve al perfil del lienzo
/// si el contenedor no se puede sondear.
fn native_input(
    input: &Path,
    is_image: bool,
    time: f64,
    base: &Profile,
    output_dir: &Path,
) -> NativeInput {
    if is_image {
        let (width, height) = image::image_dimensions(input).unwrap_or((base.width, base.height));
        return NativeInput {
            profile: at_dimensions(base, width, height),
            path: input.to_path_buf(),
            still: true,
            decoder: "ffmpeg",
            native: true,
            cleanup: None,
        };
    }
    if let Some(probe) = probe_source(input) {
        let rotation = probe.rotation_degrees.abs();
        let rotated = rotation > 45.0;
        let square_pixels = (probe.sample_aspect - 1.0).abs() < 0.01;
        if !rotated && square_pixels {
            match decode_native_frame(input, time, output_dir) {
                Ok(decoded) => {
                    if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
                        eprintln!(
                            "preview nativo: video-rs {}x{} en {:.3}s",
                            decoded.width, decoded.height, time
                        );
                    }
                    return NativeInput {
                        profile: at_dimensions(base, decoded.width, decoded.height),
                        path: decoded.path.clone(),
                        still: true,
                        decoder: "video-rs",
                        native: true,
                        cleanup: Some(decoded.path),
                    };
                }
                Err(error) => {
                    if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
                        eprintln!("preview nativo: video-rs falló, uso FFmpeg: {error}");
                    }
                }
            }
        }
        let (width, height) = display_dimensions(&probe);
        return NativeInput {
            profile: at_dimensions(base, width, height),
            path: input.to_path_buf(),
            still: false,
            decoder: "ffmpeg",
            native: true,
            cleanup: None,
        };
    }
    NativeInput {
        profile: base.clone(),
        path: input.to_path_buf(),
        still: false,
        decoder: "ffmpeg",
        native: false,
        cleanup: None,
    }
}

/// Borra el PNG intermedio aunque el render falle a mitad de camino.
struct Cleanup(Option<PathBuf>);

impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn timeline_frames(project: &Value) -> u64 {
    let clips = project["timeline"]["clips"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut total = 0u64;
    for clip in clips {
        total = total.max(
            clip["startFrame"].as_u64().unwrap_or(0) + clip["durationFrames"].as_u64().unwrap_or(0),
        );
    }
    for cue in project["captions"]["cues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        total = total.max(cue["endFrame"].as_u64().unwrap_or(0));
    }
    total
}

/// Pistas visuales y subtítulos que el frame compuesto va a incluir. Se mide
/// sobre el proyecto, sin tocar FFmpeg, para poder informarlo y testearlo;
/// incluye el clip entrante durante el lead de su transición.
fn composite_metadata(project: &Value, frame: u64) -> (usize, bool) {
    let tracks: HashMap<&str, (bool, &str)> = project["timeline"]["tracks"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?,
                (
                    track["hidden"].as_bool().unwrap_or(false),
                    track["kind"].as_str().unwrap_or(""),
                ),
            ))
        })
        .collect();
    let fps = project_fps(project).max(1.0);
    let mut visible: HashSet<&str> = HashSet::new();
    for clip in project["timeline"]["clips"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        if clip["enabled"].as_bool() == Some(false) {
            continue;
        }
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        let end = start + duration;
        let clip_seconds = duration as f64 / fps;
        let lead = transition_lead_seconds(clip, fps, clip_seconds, start as f64 / fps);
        let active_from = start as f64 - lead * fps;
        if (frame as f64) < active_from || frame >= end {
            continue;
        }
        let track_id = clip["trackId"].as_str().unwrap_or("");
        if let Some((hidden, kind)) = tracks.get(track_id) {
            if !hidden && matches!(*kind, "video" | "image" | "graphic") {
                visible.insert(track_id);
            }
        }
    }
    let hidden_captions: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter(|track| {
            track["kind"].as_str() == Some("caption") && track["hidden"].as_bool() == Some(true)
        })
        .filter_map(|track| track["id"].as_str())
        .collect();
    let captions = project["captions"]["cues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .any(|cue| {
            let start = cue["startFrame"].as_u64().unwrap_or(0);
            let end = cue["endFrame"].as_u64().unwrap_or(0);
            !hidden_captions.contains(cue["trackId"].as_str().unwrap_or(""))
                && start <= frame
                && frame < end
                && cue["text"]
                    .as_str()
                    .map(str::trim)
                    .is_some_and(|text| !text.is_empty())
        });
    (visible.len(), captions)
}

const PREVIEW_EPSILON: f64 = 0.0005;

fn project_fps(project: &Value) -> f64 {
    let numerator = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0);
    let denominator = project["video"]["frameRate"]["den"]
        .as_f64()
        .unwrap_or(1.0)
        .max(1.0);
    (numerator / denominator).max(1.0)
}

/// Copia en memoria para el frame de preview: sin audio y sin las puertas de
/// exportación (derechos/estado). No se persiste ni se usa para exportar; el
/// render final sigue exigiendo materiales listos y derechos resueltos.
fn preview_copy(project: &Value) -> Value {
    let mut preview = project.clone();
    if let Some(tracks) = preview["timeline"]["tracks"].as_array_mut() {
        tracks.retain(|track| !matches!(track["kind"].as_str(), Some("audio" | "narration")));
    }
    if let Some(clips) = preview["timeline"]["clips"].as_array_mut() {
        clips.retain(|clip| !matches!(clip["kind"].as_str(), Some("audio" | "narration")));
        for clip in clips.iter_mut() {
            clip["audio"] = serde_json::json!({ "muted": true });
        }
    }
    if let Some(assets) = preview["assets"].as_array_mut() {
        for asset in assets.iter_mut() {
            if asset["status"].as_str() != Some("ready") {
                asset["status"] = serde_json::json!("ready");
            }
            if asset["rights"]["license"]["commercialUse"].as_str() == Some("unknown") {
                asset["rights"]["license"]["commercialUse"] = serde_json::json!("preview-only");
            }
        }
    }
    preview
}

fn shift_keyframes(clip: &mut Value, field: &str, delta_frames: i64) {
    if let Some(items) = clip[field]["keyframes"].as_array_mut() {
        for keyframe in items {
            if let Some(frame) = keyframe["frame"].as_i64() {
                keyframe["frame"] = serde_json::json!(frame - delta_frames);
            }
        }
    }
}

/// Opacidad interpolada en `time_seconds` (relativa al inicio nominal del
/// clip), con el mismo easing que `opacity_commands` del render completo.
fn opacity_at(clip: &Value, time_seconds: f64, fps: f64) -> Option<f64> {
    let keyframes = clip["transform"]["keyframes"].as_array()?;
    let rate = fps.max(1.0);
    let mut samples: Vec<(f64, f64, String)> = keyframes
        .iter()
        .filter_map(|keyframe| {
            let frame = keyframe["frame"].as_f64()?;
            let value = keyframe["opacity"].as_f64()?.clamp(0.0, 1.0);
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
    if time_seconds <= samples[0].0 {
        return Some(samples[0].1);
    }
    for pair in samples.windows(2) {
        let (start_t, start_v, easing) = (pair[0].0, pair[0].1, pair[0].2.as_str());
        let (end_t, end_v) = (pair[1].0, pair[1].1);
        if time_seconds < end_t {
            if end_t <= start_t {
                return Some(end_v);
            }
            let progress = ((time_seconds - start_t) / (end_t - start_t)).clamp(0.0, 1.0);
            return Some(start_v + (end_v - start_v) * eased_fraction(progress, easing));
        }
    }
    samples.last().map(|sample| sample.1)
}

fn animation_duration(animation: &Value, clip_seconds: f64, fps: f64) -> Option<f64> {
    let kind = animation["type"].as_str()?.trim();
    if kind.is_empty() {
        return None;
    }
    let requested = animation["durationFrames"].as_u64().unwrap_or(15).max(1) as f64;
    let frames = requested.min((clip_seconds * fps).max(1.0));
    Some((frames / fps.max(1.0)).clamp(1.0 / fps.max(1.0), clip_seconds.max(1.0 / fps.max(1.0))))
}

/// Desplazamiento y alfa congelados de las animaciones de entrada/salida.
fn animation_freeze(
    clip: &Value,
    delta_seconds: f64,
    clip_seconds: f64,
    fps: f64,
    width: f64,
    height: f64,
) -> Option<(f64, f64, f64)> {
    let mut x = 0.0;
    let mut y = 0.0;
    let mut alpha = 1.0;
    let mut found = false;
    for outgoing in [false, true] {
        let animation = if outgoing {
            &clip["animationOut"]
        } else {
            &clip["animationIn"]
        };
        let Some(duration) = animation_duration(animation, clip_seconds, fps) else {
            continue;
        };
        let Some(kind) = animation["type"]
            .as_str()
            .map(str::trim)
            .filter(|kind| !kind.is_empty())
        else {
            continue;
        };
        let from = if outgoing {
            (clip_seconds - duration).max(0.0)
        } else {
            0.0
        };
        let progress = ((delta_seconds - from) / duration).clamp(0.0, 1.0);
        found = true;
        match kind {
            "fade" => {
                alpha *= if outgoing { 1.0 - progress } else { progress };
            }
            "slide-left" => {
                x += if outgoing {
                    -width * progress
                } else {
                    width * (1.0 - progress)
                };
            }
            "slide-right" => {
                x += if outgoing {
                    width * progress
                } else {
                    -width * (1.0 - progress)
                };
            }
            "slide-up" => {
                y += if outgoing {
                    -height * progress
                } else {
                    height * (1.0 - progress)
                };
            }
            "slide-down" => {
                y += if outgoing {
                    height * progress
                } else {
                    -height * (1.0 - progress)
                };
            }
            _ => {}
        }
    }
    found.then_some((x, y, alpha.clamp(0.0, 1.0)))
}

/// Factor de fade del clip en el frame pedido. El compuesto completo aplica
/// los fades sobre la duración real del clip; la ventana de un frame los
/// reemplaza por una multiplicación constante, porque su duración recortada
/// haría que el filtro `fade` evaluara el factor equivocado.
fn frozen_fade(clip: &Value, delta_seconds: f64, clip_seconds: f64, fps: f64) -> Option<f64> {
    let seconds = |key: &str| {
        (clip["effects"][key].as_f64().unwrap_or(0.0).max(0.0) / fps.max(1.0)).min(clip_seconds)
    };
    let fade_in = seconds("fadeInFrames");
    let fade_out = seconds("fadeOutFrames");
    if fade_in <= PREVIEW_EPSILON && fade_out <= PREVIEW_EPSILON {
        return None;
    }
    let enter = if fade_in > PREVIEW_EPSILON {
        (delta_seconds / fade_in).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let leave = if fade_out > PREVIEW_EPSILON {
        ((clip_seconds - delta_seconds) / fade_out).clamp(0.0, 1.0)
    } else {
        1.0
    };
    Some((enter * leave).clamp(0.0, 1.0))
}

/// Ken Burns evaluado en el frame pedido. `visual_filter` lo consume como un
/// crop estático (`frozen`) para no decodificar todo el clip desde el inicio.
fn frozen_motion(clip: &Value, delta_seconds: f64, clip_seconds: f64) -> Option<Value> {
    let motion = &clip["motion"];
    let kind = motion["type"].as_str()?.trim();
    if kind.is_empty() {
        return None;
    }
    let intensity = motion["intensity"]
        .as_f64()
        .unwrap_or(0.12)
        .clamp(0.02, 0.5);
    // El progreso de Ken Burns es clip-local: la velocidad cambia cuántos
    // frames de origen se consumen, pero no la fracción del clip recorrida.
    // Un lead puede llevar el tiempo local más allá del clip; el zoompan del
    // full sigue creciendo y la ventana congela la misma fracción.
    let fraction = (delta_seconds / clip_seconds.max(0.001)).max(0.0);
    let center_x = "(iw-iw/zoom)/2".to_owned();
    let center_y = "(ih-ih/zoom)/2".to_owned();
    let (zoom, x, y) = match kind {
        "zoom-in" => (1.0 + intensity * fraction, center_x, center_y),
        "zoom-out" => (1.0 + intensity * (1.0 - fraction), center_x, center_y),
        "pan-left" => (
            1.0 + intensity,
            format!("(iw-iw/zoom)*(1-{fraction:.6})"),
            center_y,
        ),
        "pan-right" => (
            1.0 + intensity,
            format!("(iw-iw/zoom)*{fraction:.6}"),
            center_y,
        ),
        "pan-up" => (
            1.0 + intensity,
            center_x,
            format!("(ih-ih/zoom)*(1-{fraction:.6})"),
        ),
        "pan-down" => (
            1.0 + intensity,
            center_x,
            format!("(ih-ih/zoom)*{fraction:.6}"),
        ),
        _ => return None,
    };
    Some(serde_json::json!({
        "type": kind,
        "intensity": intensity,
        "frozen": { "z": zoom, "x": x, "y": y }
    }))
}

fn preview_window_error(reason: &str) -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::RenderFailed,
        format!("el frame pide el compuesto completo: {reason}").as_str(),
    )
}

fn freezable_transition(kind: &str) -> bool {
    matches!(
        kind,
        "dissolve"
            | "fade-black"
            | "fade-white"
            | "slide-left"
            | "slide-right"
            | "slide-up"
            | "slide-down"
    )
}

/// Reencuadra el proyecto a un único frame. Conserva el contenido visual de
/// los clips activos (fuente, keyframes y Ken Burns rebasados) y descarta el
/// resto del tiempo, para que FFmpeg no decodifique la timeline entera.
fn window_project(project: &Value, frame: u64) -> Result<Value, ProjectError> {
    // Los compuestos se expanden a sus clips internos, igual que en el render
    // completo; si no, la ventana los ignoraba y perdía esas capas.
    let expanded = expand_compounds(project)?;
    let project = &expanded;
    let fps = project_fps(project);
    let frame_width = project["video"]["width"].as_u64().unwrap_or(0) as f64;
    let frame_height = project["video"]["height"].as_u64().unwrap_or(0) as f64;
    let tracks = project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let track_info: HashMap<String, (String, bool)> = tracks
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?.to_owned(),
                (
                    track["kind"].as_str().unwrap_or("").to_owned(),
                    track["hidden"].as_bool().unwrap_or(false),
                ),
            ))
        })
        .collect();
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let visible = |clip: &Value| -> Option<String> {
        if clip["enabled"].as_bool() == Some(false) {
            return None;
        }
        let (kind, hidden) = track_info.get(clip["trackId"].as_str().unwrap_or(""))?;
        (!*hidden).then(|| kind.clone())
    };

    // Los leads de dissolve, fade-black/white y slide se congelan con su alfa
    // o desplazamiento; los tipos desconocidos se delegan. Desde el corte la
    // transición ya terminó y la ventana compone ambos clips.
    for clip in &clips {
        let Some(kind) = visible(clip) else {
            continue;
        };
        if !matches!(kind.as_str(), "video" | "image" | "freeze") {
            continue;
        }
        let start = clip["startFrame"].as_u64().unwrap_or(0) as f64;
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        if duration == 0 {
            continue;
        }
        let clip_seconds = duration as f64 / fps;
        let lead = transition_lead_seconds(clip, fps, clip_seconds, start / fps);
        let lead_frames = lead * fps;
        let position = frame as f64;
        if lead > PREVIEW_EPSILON && position >= start - lead_frames && position < start {
            let kind = clip["transitionIn"]["type"].as_str().unwrap_or("");
            if !freezable_transition(kind) {
                return Err(preview_window_error("transición no congelable"));
            }
        }
    }

    let mut kept: Vec<Value> = Vec::new();
    let mut kept_captions: Vec<Value> = Vec::new();
    let mut omitted_graphic = false;
    for clip in &clips {
        let Some(track_kind) = visible(clip) else {
            continue;
        };
        if clip["kind"].as_str() == Some("graphic") {
            let start = clip["startFrame"].as_u64().unwrap_or(0);
            let duration = clip["durationFrames"].as_u64().unwrap_or(0);
            if duration > 0 && frame >= start && frame < start + duration {
                omitted_graphic = true;
            }
            continue;
        }
        if !matches!(track_kind.as_str(), "video" | "image" | "adjustment") {
            continue;
        }
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        let clip_seconds = duration as f64 / fps;
        let lead = transition_lead_seconds(clip, fps, clip_seconds, start as f64 / fps);
        let active_from = start as f64 - lead * fps;
        if duration == 0 || (frame as f64) < active_from || frame >= start + duration {
            continue;
        }
        let clip_kind = clip["kind"].as_str().unwrap_or("");
        match clip_kind {
            "graphic" => {
                // El compuesto no puede quemar el gráfico sin su plan de
                // motion, pero el resto de las capas sí se puede mostrar.
                omitted_graphic = true;
            }
            "adjustment" => {
                let mut fast = clip.clone();
                fast["startFrame"] = serde_json::json!(0);
                fast["durationFrames"] = serde_json::json!(1);
                kept.push(fast);
            }
            "video" | "image" | "freeze" => {
                let reverse = clip["reverse"].as_bool().unwrap_or(false);
                let delta_frames = frame as i64 - start as i64;
                let delta_seconds = delta_frames as f64 / fps;
                let local_seconds = delta_seconds + lead;
                let total_seconds = clip_seconds + lead;
                let transition_type = clip["transitionIn"]["type"].as_str().unwrap_or("");
                let transition_progress = if lead > PREVIEW_EPSILON {
                    (local_seconds / lead).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                let remaining = (1.0 - transition_progress).max(0.0);
                let frozen_transition = match transition_type {
                    "dissolve" if remaining > 0.0005 => {
                        Some(serde_json::json!({ "alpha": transition_progress }))
                    }
                    "fade-black" if remaining > 0.0005 => Some(serde_json::json!({
                        "mode": "black", "alpha": transition_progress
                    })),
                    "fade-white" if remaining > 0.0005 => Some(serde_json::json!({
                        "mode": "white", "alpha": transition_progress
                    })),
                    "slide-left" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": frame_width * remaining, "y": 0.0
                    })),
                    "slide-right" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": -frame_width * remaining, "y": 0.0
                    })),
                    "slide-up" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": 0.0, "y": frame_height * remaining
                    })),
                    "slide-down" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": 0.0, "y": -frame_height * remaining
                    })),
                    _ => None,
                };
                // El Ken Burns se mide desde el inicio del solape; si un lead
                // lleva el tiempo local más allá del clip, se congela la misma
                // fracción creciente que usa el zoompan del full.
                let fade = frozen_fade(clip, local_seconds, total_seconds, fps);
                let frozen_animation = animation_freeze(
                    clip,
                    delta_seconds,
                    clip_seconds,
                    fps,
                    frame_width,
                    frame_height,
                );
                let frozen_opacity = opacity_at(clip, delta_seconds, fps);
                let mut fast = clip.clone();
                if let Some(effects) = fast["effects"].as_object_mut() {
                    effects.insert("fadeInFrames".to_owned(), serde_json::json!(0));
                    effects.insert("fadeOutFrames".to_owned(), serde_json::json!(0));
                }
                if let Some(fade) = fade.filter(|value| *value < 0.999) {
                    fast["fadeFrozen"] = serde_json::json!(fade);
                }
                if let Some(opacity) = frozen_opacity {
                    fast["opacityFrozen"] = serde_json::json!(opacity);
                }
                if let Some((x, y, alpha)) = frozen_animation {
                    if x.abs() > 0.0005 || y.abs() > 0.0005 || alpha < 0.999 {
                        fast["animationFrozen"] =
                            serde_json::json!({ "x": x, "y": y, "alpha": alpha });
                    }
                }
                if let Some(frozen_transition) = frozen_transition {
                    fast["transitionFrozen"] = frozen_transition;
                }
                fast["animationIn"] = serde_json::json!({});
                fast["animationOut"] = serde_json::json!({});
                fast["transitionIn"] = serde_json::json!({});
                fast["motion"] = frozen_motion(&fast, local_seconds, clip_seconds)
                    .unwrap_or_else(|| serde_json::json!({}));
                shift_keyframes(&mut fast, "transform", delta_frames);
                shift_keyframes(&mut fast, "mask", delta_frames);
                if reverse {
                    fast["reverse"] = serde_json::json!(false);
                }
                if clip_kind == "video" {
                    let speed_num = fast["speed"]["num"].as_f64().unwrap_or(1.0).max(0.01);
                    let speed_den = fast["speed"]["den"].as_f64().unwrap_or(1.0).max(0.01);
                    let speed = speed_num / speed_den;
                    // El plan completo busca `in - lead*speed` (sin bajar de 0)
                    // y avanza `local` segundos; el recorte debe copiar ese
                    // frame, no sólo `delta`, o tras un corte muestra el inicio.
                    let in_frames = fast["source"]["inFrame"].as_u64().unwrap_or(0);
                    let in_seconds = in_frames as f64 / fps;
                    let input_start = (in_seconds - lead * speed).max(0.0);
                    if reverse {
                        // `reverse` da la vuelta al bloque de entrada: el frame
                        // local se cuenta desde el último fotograma de ese bloque.
                        let input_frames = ((clip_seconds + lead) * speed * fps).max(1.0);
                        let last_frame = (input_start * fps).round() + input_frames - 1.0;
                        let source_frame =
                            (last_frame - (local_seconds * speed * fps).round()).max(0.0) as u64;
                        fast["source"]["inFrame"] = serde_json::json!(source_frame);
                        fast["source"]["outFrame"] = serde_json::json!(source_frame + 1);
                    } else {
                        let source_frame = ((input_start + local_seconds * speed) * fps)
                            .round()
                            .max(0.0) as i64;
                        let shift = source_frame - in_frames as i64;
                        for key in ["inFrame", "outFrame"] {
                            if let Some(frame) = fast["source"][key].as_u64() {
                                fast["source"][key] =
                                    serde_json::json!((frame as i64 + shift).max(0) as u64);
                            }
                        }
                    }
                }
                fast["startFrame"] = serde_json::json!(0);
                fast["durationFrames"] = serde_json::json!(1);
                fast["audio"] = serde_json::json!({ "muted": true });
                // La escala ya está congelada en el frame pedido: el overlay
                // no necesita la corrección de tamaño dinámico.
                fast["scaleFrozen"] = serde_json::json!(true);
                kept.push(fast);
            }
            _ => {}
        }
    }

    let hidden_captions: HashSet<&str> = track_info
        .iter()
        .filter(|(_, (kind, hidden))| kind == "caption" && *hidden)
        .map(|(id, _)| id.as_str())
        .collect();
    for cue in project["captions"]["cues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let start = cue["startFrame"].as_u64().unwrap_or(0);
        let end = cue["endFrame"].as_u64().unwrap_or(0);
        if frame < start
            || frame >= end
            || hidden_captions.contains(cue["trackId"].as_str().unwrap_or(""))
            || !cue["text"]
                .as_str()
                .map(str::trim)
                .is_some_and(|text| !text.is_empty())
        {
            continue;
        }
        if cue["wordReveal"].as_bool() == Some(true)
            && cue["words"].as_array().is_some_and(|words| words.len() > 1)
        {
            return Err(preview_window_error("subtítulo con revelado por palabra"));
        }
        let mut fast = cue.clone();
        fast["startFrame"] = serde_json::json!(0);
        fast["endFrame"] = serde_json::json!((end - frame).max(1));
        kept_captions.push(fast);
    }

    if omitted_graphic && kept.is_empty() && kept_captions.is_empty() {
        return Err(preview_window_error("clip gráfico sin otras capas"));
    }
    let mut window = project.clone();
    window["timeline"]["tracks"] = Value::Array(
        tracks
            .into_iter()
            .filter(|track| !matches!(track["kind"].as_str(), Some("audio" | "narration")))
            .collect(),
    );
    if kept.is_empty() {
        // Un hueco sin clips igual debe renderizar el fondo y los subtítulos.
        let track_id = "preview-background";
        window["timeline"]["tracks"]
            .as_array_mut()
            .expect("tracks")
            .push(serde_json::json!({
                "id": track_id, "kind": "adjustment", "order": 0,
                "hidden": false, "muted": false
            }));
        kept.push(serde_json::json!({
            "id": "preview-background-clip", "trackId": track_id,
            "kind": "adjustment", "startFrame": 0, "durationFrames": 1,
            "source": { "type": "adjustment" }, "effects": {}
        }));
    }
    window["timeline"]["clips"] = Value::Array(kept);
    window["captions"]["cues"] = Value::Array(kept_captions);
    if omitted_graphic {
        window["previewGraphicOmitted"] = serde_json::json!(true);
    }
    Ok(window)
}

/// Etiqueta de salida de una cadena de audio: `[a3]`, `[aout]`. Las cadenas
/// visuales usan `[v3]`, `[base0]`, `[adj0]`, etc., que no colisionan.
fn audio_output_label(chain: &str) -> Option<&str> {
    let trimmed = chain.trim();
    let label = trimmed
        .strip_suffix(']')?
        .rsplit_once('[')
        .map(|(_, label)| label)?;
    let audio = label == "aout"
        || label
            .strip_prefix('a')
            .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()));
    audio.then_some(label)
}

/// FFmpeg falla si un `-filter_complex` deja salidas sin conectar, así que el
/// compuesto descarta las cadenas de audio y conserva el grafo visual.
fn strip_audio_chains(graph: &str) -> String {
    graph
        .split(';')
        .filter(|chain| audio_output_label(chain).is_none())
        .collect::<Vec<_>>()
        .join(";")
}

/// Conserva las entradas y el grafo de composición del plan de render y
/// reemplaza sólo la cola de salida: un PNG en el tiempo pedido, sin audio.
fn frame_args_from_plan(plan_args: &[String], time: f64, output: &Path) -> Option<Vec<String>> {
    let position = plan_args.iter().position(|arg| arg == "-filter_complex")?;
    let graph = plan_args.get(position + 1)?;
    if graph.trim().is_empty() {
        return None;
    }
    let graph = strip_audio_chains(graph);
    if !graph.contains("[vout]") {
        return None;
    }
    // El seek de salida (`-ss`) reinicia contadores internos (`n`, `N`) y
    // evalúa mal los keyframes. `trim` al final del grafo conserva el tiempo
    // real del frame aunque obligue a procesar los anteriores.
    let graph = format!("{graph};[vout]trim=start={time:.6},setpts=PTS-STARTPTS[frame]");
    let mut args = plan_args[..position + 1].to_vec();
    args.push(graph);
    args.extend([
        "-map".to_owned(),
        "[frame]".to_owned(),
        "-frames:v".to_owned(),
        "1".to_owned(),
        "-an".to_owned(),
        "-sn".to_owned(),
        "-dn".to_owned(),
        "-f".to_owned(),
        "image2".to_owned(),
        "-update".to_owned(),
        "1".to_owned(),
        "-y".to_owned(),
    ]);
    args.push(output.to_string_lossy().into_owned());
    Some(args)
}

fn composite_frame(
    ffmpeg: &Path,
    ffprobe: &Path,
    root: &Path,
    project: &Value,
    clip_id: &str,
    frame: u64,
    output_dir: &Path,
) -> Result<PreviewFrameResult, ProjectError> {
    // Un clip gráfico fuera del frame no impide componer; si está activo, la
    // ventana lo rechaza y el comando cae al preview de clip.
    let total = timeline_frames(project);
    if total == 0 || frame >= total {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el playhead está fuera de la timeline; se muestra el clip seleccionado",
        ));
    }
    let silent = preview_copy(project);
    let debug = std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some();
    let (mode, mut result) = match window_project(&silent, frame) {
        Ok(window) => {
            let graphic_omitted = window["previewGraphicOmitted"].as_bool() == Some(true);
            match render_composite_project(ffmpeg, ffprobe, root, &window, clip_id, 0, output_dir) {
                Ok(mut fast) => {
                    if debug {
                        eprintln!("preview compuesto: ventana de un frame");
                    }
                    if graphic_omitted {
                        fast.fallback_reason =
                            Some("clip gráfico omitido: falta el plan de motion".to_owned());
                    }
                    ("window", fast)
                }
                Err(error) => {
                    if debug {
                        eprintln!(
                            "preview ventana falló: {}; uso el compuesto completo",
                            error.message
                        );
                    }
                    (
                        "full",
                        render_composite_project(
                            ffmpeg, ffprobe, root, &silent, clip_id, frame, output_dir,
                        )?,
                    )
                }
            }
        }
        Err(error) => {
            if debug {
                eprintln!(
                    "preview ventana no aplica: {}; uso el compuesto completo",
                    error.message
                );
            }
            (
                "full",
                render_composite_project(
                    ffmpeg, ffprobe, root, &silent, clip_id, frame, output_dir,
                )?,
            )
        }
    };
    result.frame = frame;
    result.time_seconds = frame as f64 / project_fps(project);
    result.composite_mode = mode.to_owned();
    let (visible_tracks, captions_burned) = composite_metadata(project, frame);
    result.visible_tracks = visible_tracks;
    result.captions_burned = captions_burned;
    if let Some(label) = project["timeline"]["clips"]
        .as_array()
        .and_then(|clips| {
            clips
                .iter()
                .find(|clip| clip["id"].as_str() == Some(clip_id))
        })
        .and_then(|clip| clip["label"].as_str())
    {
        result.clip_label = label.to_owned();
    }
    Ok(result)
}

fn render_composite_project(
    ffmpeg: &Path,
    ffprobe: &Path,
    root: &Path,
    project: &Value,
    clip_id: &str,
    frame: u64,
    output_dir: &Path,
) -> Result<PreviewFrameResult, ProjectError> {
    if has_visible_graphic_clips(project) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el compuesto todavía no incluye clips gráficos; se muestra el clip seleccionado",
        ));
    }
    let profile = profile_for(project)?;
    let total = timeline_frames(project);
    if total == 0 || frame >= total {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el playhead está fuera de la timeline; se muestra el clip seleccionado",
        ));
    }
    let fps = profile.fps();
    let time = frame as f64 / fps;
    let temp_dir = output_dir.join(format!("composite-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el compuesto: {error}").as_str(),
        )
    })?;
    let output = output_dir.join(format!("composite-{}.png", Uuid::new_v4()));
    let result = (|| -> Result<PreviewFrameResult, ProjectError> {
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root,
            profile: &profile,
            output_path: &output,
            include_captions: true,
            temp_dir: &temp_dir,
            ffprobe,
            motion_ass: None,
        })?;
        let args = frame_args_from_plan(&plan.args, time, &output).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el plan del compuesto no tiene grafo de video",
            )
        })?;
        let mut command = Command::new(ffmpeg);
        command
            .args(&args)
            .current_dir(&temp_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
            eprintln!("preview compuesto: {command:?}");
        }
        let finished = command.output().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo iniciar FFmpeg para el compuesto: {error}").as_str(),
            )
        })?;
        if !finished.status.success() || !output.is_file() {
            let detail = String::from_utf8_lossy(&finished.stderr);
            let tail = detail
                .lines()
                .rev()
                .take(6)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                format!(
                    "FFmpeg no pudo componer el frame: {}",
                    if tail.is_empty() {
                        "sin detalle"
                    } else {
                        &tail
                    }
                )
                .as_str(),
            ));
        }
        let (width, height) = image::image_dimensions(&output).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el compuesto generado no es una imagen válida",
            )
        })?;
        let clip = project["timeline"]["clips"]
            .as_array()
            .and_then(|clips| {
                clips
                    .iter()
                    .find(|clip| clip["id"].as_str() == Some(clip_id))
            })
            .cloned();
        let (visible_tracks, captions_burned) = composite_metadata(project, frame);
        Ok(PreviewFrameResult {
            path: output.to_string_lossy().into_owned(),
            width,
            height,
            frame,
            time_seconds: time,
            clip_id: clip_id.to_owned(),
            clip_label: clip
                .as_ref()
                .and_then(|clip| clip["label"].as_str())
                .unwrap_or("Composición")
                .to_owned(),
            native: false,
            decoder: "ffmpeg".to_owned(),
            composite: true,
            composite_mode: "full".to_owned(),
            visible_tracks,
            captions_burned,
            fallback_reason: None,
        })
    })();
    let _ = std::fs::remove_dir_all(&temp_dir);
    if result.is_err() {
        let _ = std::fs::remove_file(&output);
    }
    result
}

fn render_frame(
    ffmpeg: &Path,
    root: &Path,
    project: &Value,
    clip_id: &str,
    frame: u64,
    wants_native: bool,
    output_dir: &Path,
) -> Result<PreviewFrameResult, ProjectError> {
    let profile = profile_for(project)?;
    let clip = project["timeline"]["clips"]
        .as_array()
        .and_then(|clips| {
            clips
                .iter()
                .find(|clip| clip["id"].as_str() == Some(clip_id))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el clip del preview ya no está en la timeline",
            )
        })?;
    if !matches!(
        clip["kind"].as_str().unwrap_or(""),
        "video" | "image" | "freeze" | "graphic"
    ) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el preview real sólo aplica a clips visuales",
        ));
    }
    let asset_id = clip["kind"]
        .as_str()
        .filter(|kind| *kind != "graphic")
        .and_then(|_| clip["source"]["assetId"].as_str());
    let asset = asset_id.and_then(|id| {
        project["assets"].as_array().and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(id))
                .cloned()
        })
    });
    if clip["kind"].as_str() == Some("graphic") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el preview real de gráficos se agregará en otra pasada",
        ));
    }
    let asset = asset.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el clip no tiene un medio asociado",
        )
    })?;
    let relative = asset["source"]["path"].as_str().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el medio del clip no tiene una ruta válida",
        )
    })?;
    let input = resolve_inside_root(root, relative)?;
    let is_image = asset["kind"].as_str() != Some("video");
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del clip ya no está en el proyecto",
        ));
    }
    let fps = profile.fps();
    let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(1) as f64 / fps.max(1.0);
    let (time, image) = source_time(&clip, frame, fps);
    let is_image = is_image || image;
    let (view_profile, source, still, decoder, native, cleanup) = if wants_native {
        let source = native_input(&input, is_image, time, &profile, output_dir);
        (
            source.profile,
            source.path,
            source.still,
            source.decoder.to_owned(),
            source.native,
            source.cleanup,
        )
    } else {
        (
            profile.clone(),
            input.clone(),
            is_image,
            "ffmpeg".to_owned(),
            false,
            None,
        )
    };
    // El PNG decodificado en proceso sólo vive hasta que FFmpeg termina.
    let _cleanup = Cleanup(cleanup);
    let filters = visual_filter(
        0,
        &clip,
        &asset,
        &view_profile,
        clip_seconds,
        0.0,
        0.0,
        1,
        1,
        is_image,
    );
    let mut chain = filters;
    if let Some((lut, intensity)) = effects_lut(&clip["effects"], root)? {
        chain = apply_lut_to_chain(chain, "v0", &lut, intensity);
    }
    let output = output_dir.join(format!("frame-{}.png", Uuid::new_v4()));
    let mut command = Command::new(ffmpeg);
    if still {
        command.arg("-i").arg(&source);
    } else {
        command.args(["-ss", &format!("{time:.3}")]);
        if let Some(decoder) = alpha_video_decoder(&asset) {
            command.args(["-c:v", decoder]);
        }
        command.arg("-i").arg(&source);
    }
    command
        .args([
            "-frames:v",
            "1",
            "-filter_complex",
            &chain,
            "-map",
            "[v0]",
            "-an",
            "-y",
        ])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
        eprintln!("preview command: {:?}", command);
    }
    let result = command.output().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para el preview: {error}").as_str(),
        )
    })?;
    if !result.status.success() || !output.is_file() {
        let detail = String::from_utf8_lossy(&result.stderr);
        let tail = detail
            .lines()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo generar el frame: {}",
                if tail.is_empty() {
                    "sin detalle"
                } else {
                    &tail
                }
            )
            .as_str(),
        ));
    }
    let (width, height) = image::image_dimensions(&output).map_err(|_| {
        let _ = std::fs::remove_file(&output);
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el frame generado no es una imagen válida",
        )
    })?;
    Ok(PreviewFrameResult {
        path: output.to_string_lossy().into_owned(),
        width,
        height,
        frame,
        time_seconds: (clip["startFrame"].as_u64().unwrap_or(0) as f64 / fps.max(1.0)
            + (frame.saturating_sub(clip["startFrame"].as_u64().unwrap_or(0)) as f64
                / fps.max(1.0))),
        clip_id: clip_id.to_owned(),
        clip_label: clip["label"].as_str().unwrap_or("Clip").to_owned(),
        native,
        decoder,
        composite: false,
        composite_mode: "none".to_owned(),
        visible_tracks: 0,
        captions_burned: false,
        fallback_reason: None,
    })
}

/// Genera un PNG del frame pedido con el renderer real. Por defecto compone
/// todas las pistas visibles, el look y los subtítulos; si eso no es posible,
/// devuelve el clip seleccionado e informa el motivo en `fallbackReason`.
#[tauri::command]
pub async fn render_preview_frame(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PreviewFrameRequest,
) -> Result<PreviewFrameResult, ProjectError> {
    let session = state.require_session()?;
    let root = session.root.clone();
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para el preview real",
        ));
    };
    let ffprobe = ffprobe.unwrap_or_else(|| PathBuf::from("ffprobe"));
    let output_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo resolver la caché del preview",
            )
        })?
        .join("preview");
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo crear la caché del preview: {error}").as_str(),
        )
    })?;
    let project = request.project;
    let clip_id = request.clip_id;
    let frame = request.frame;
    let native = request.native;
    let wants_composite = request.composite.unwrap_or(true) && !native;
    tauri::async_runtime::spawn_blocking(move || {
        let mut fallback_reason = None;
        if wants_composite {
            match composite_frame(
                &ffmpeg,
                &ffprobe,
                &root,
                &project,
                &clip_id,
                frame,
                &output_dir,
            ) {
                Ok(result) => return Ok(result),
                Err(error) => fallback_reason = Some(error.message),
            }
        }
        let mut result = render_frame(
            &ffmpeg,
            &root,
            &project,
            &clip_id,
            frame,
            native,
            &output_dir,
        )?;
        result.fallback_reason = fallback_reason;
        Ok(result)
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el preview real se interrumpió: {error}").as_str(),
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_time_honours_trim_and_speed() {
        let clip = serde_json::json!({
            "kind": "video",
            "startFrame": 30,
            "durationFrames": 60,
            "source": { "type": "asset", "inFrame": 15, "outFrame": 75 },
            "speed": { "num": 1, "den": 1 }
        });
        let (time, image) = source_time(&clip, 30, 30.0);
        assert!(!image);
        assert!((time - 0.5).abs() < 0.001);
        let mut fast = clip.clone();
        fast["speed"] = serde_json::json!({ "num": 2, "den": 1 });
        let (time, _) = source_time(&fast, 60, 30.0);
        assert!((time - 2.5).abs() < 0.001);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_renders_a_clip_frame_with_effects() {
        let dir = std::env::temp_dir().join(format!("editoria-preview-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("clip.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg");
        assert!(generated.success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Toma",
                "source": { "path": "media/clip.mp4" }
            }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "startFrame": 0,
                "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
                "effects": {
                    "brightness": 0.1,
                    "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 },
                    "relight": { "x": 0, "y": 0, "radius": 0.4, "strength": 0.3, "warmth": 0.1 }
                }
            }] }
        });
        let result = render_frame(Path::new("ffmpeg"), &dir, &project, "c", 10, false, &dir)
            .expect("frame real");
        assert!(Path::new(&result.path).is_file());
        assert_eq!((result.width, result.height), (320, 180));
        assert!(!result.native);
        assert_eq!(result.decoder, "ffmpeg");
        println!(
            "preview real: {} {}x{}",
            result.path, result.width, result.height
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe y las DLLs de FFmpeg en PATH"]
    fn live_native_frame_uses_video_rs_at_source_size() {
        let dir = std::env::temp_dir().join(format!("editoria-native-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("clip.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=640x360:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg");
        assert!(generated.success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Toma",
                "source": { "path": "media/clip.mp4" },
                "media": { "width": 640, "height": 360 }
            }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "startFrame": 0,
                "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
                "effects": { "brightness": 0.05 }
            }] }
        });
        let result = render_frame(Path::new("ffmpeg"), &dir, &project, "c", 10, true, &dir)
            .expect("frame nativo");
        assert!(Path::new(&result.path).is_file());
        assert!(result.native, "el frame debía quedar a resolución nativa");
        assert_eq!((result.width, result.height), (640, 360));
        assert_eq!(result.decoder, "video-rs");
        println!(
            "preview nativo: {} {}x{} con {}",
            result.path, result.width, result.height, result.decoder
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn frame_args_keep_the_graph_and_replace_the_audio_tail() {
        let plan: Vec<String> = [
            "-hide_banner",
            "-f",
            "lavfi",
            "-i",
            "color=black:s=320x180:r=30:d=3",
            "-filter_complex",
            "[0:v]format=rgba[base0];[base0]format=yuv420p[vout];[0:a]anull[aout]",
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-t",
            "3.000000",
            "out.mp4",
        ]
        .iter()
        .map(|arg| (*arg).to_owned())
        .collect();
        let output = Path::new("frame.png");
        let args = frame_args_from_plan(&plan, 1.25, output).expect("args");
        let has_pair = |left: &str, right: &str| {
            args.windows(2)
                .any(|pair| pair[0].as_str() == left && pair[1].as_str() == right)
        };
        assert!(has_pair("-frames:v", "1"));
        assert!(has_pair("-map", "[frame]"));
        assert!(!has_pair("-ss", "1.250000"));
        assert!(args.iter().any(|arg| arg.as_str() == "-an"));
        assert!(
            !has_pair("-map", "[aout]"),
            "el compuesto no debe mapear audio"
        );
        assert!(!args.iter().any(|arg| arg.as_str() == "libx264"));
        assert!(!args.iter().any(|arg| arg.as_str() == "-t"));
        assert_eq!(args.last().map(String::as_str), Some("frame.png"));
        let graph_position = args
            .iter()
            .position(|arg| arg.as_str() == "-filter_complex")
            .expect("filter_complex");
        assert_eq!(graph_position, 5);
        let graph = &args[graph_position + 1];
        assert!(graph.contains("[vout]"));
        assert!(graph.contains("trim=start=1.250000"));
        assert!(graph.contains("[frame]"));
        assert!(!graph.contains("[aout]"));
        assert!(!graph.contains("anull"));
        assert_eq!(
            frame_args_from_plan(&["-i".into(), "x".into()], 0.0, output),
            None
        );
    }

    #[test]
    fn audio_chain_detection_does_not_drop_adjustment_layers() {
        assert_eq!(audio_output_label("[0:a]anull[a1]"), Some("a1"));
        assert_eq!(audio_output_label("[0:a]anull[aout]"), Some("aout"));
        assert_eq!(audio_output_label("[base0]eq=brightness=0.2[adj0]"), None);
        assert_eq!(audio_output_label("[base0]format=yuv420p[vout]"), None);
        assert_eq!(
            strip_audio_chains("[0:a]anull[a1];[a1]amix[aout];[base0]null[vout]"),
            "[base0]null[vout]"
        );
    }

    #[test]
    fn composite_metadata_counts_active_tracks_and_captions() {
        let project = serde_json::json!({
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "hidden": false },
                    { "id": "v2", "kind": "image", "hidden": false },
                    { "id": "v3", "kind": "video", "hidden": true },
                    { "id": "a1", "kind": "audio", "hidden": false },
                    { "id": "c1", "kind": "caption", "hidden": true }
                ],
                "clips": [
                    { "id": "base", "trackId": "v1", "startFrame": 0, "durationFrames": 90 },
                    { "id": "over", "trackId": "v2", "startFrame": 30, "durationFrames": 60 },
                    { "id": "hidden", "trackId": "v3", "startFrame": 0, "durationFrames": 90 },
                    { "id": "voice", "trackId": "a1", "startFrame": 0, "durationFrames": 90 }
                ]
            },
            "captions": {
                "cues": [
                    { "startFrame": 0, "endFrame": 40, "text": "Hola" },
                    { "startFrame": 40, "endFrame": 80, "text": "   " },
                    { "trackId": "c1", "startFrame": 90, "endFrame": 100, "text": "Oculto" }
                ]
            }
        });
        assert_eq!(composite_metadata(&project, 10), (1, true));
        assert_eq!(composite_metadata(&project, 35), (2, true));
        assert_eq!(composite_metadata(&project, 50), (2, false));
        assert_eq!(composite_metadata(&project, 85), (2, false));
        assert_eq!(
            composite_metadata(&project, 95),
            (0, false),
            "un cue en pista oculta no se quema"
        );
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_composite_frame_includes_tracks_and_pixels() {
        let dir = std::env::temp_dir().join(format!("editoria-composite-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("red.mp4");
        let image = media.join("blue.png");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg video")
            .success());
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=120x60",
                "-frames:v",
                "1",
            ])
            .arg(&image)
            .status()
            .expect("ffmpeg image")
            .success());
        let rights = serde_json::json!({ "license": { "commercialUse": "allowed" } });
        let project = serde_json::json!({
            "video": {
                "width": 320, "height": 180,
                "frameRate": { "num": 30, "den": 1 },
                "backgroundColor": "#000000"
            },
            "assets": [
                {
                    "id": "base", "kind": "video", "label": "Base",
                    "source": { "path": "media/red.mp4" },
                    "status": "ready", "rights": rights.clone()
                },
                {
                    "id": "over", "kind": "image", "label": "Overlay",
                    "source": { "path": "media/blue.png" },
                    "status": "ready", "rights": rights
                }
            ],
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 1 },
                    { "id": "v2", "kind": "image", "order": 2 }
                ],
                "clips": [
                    {
                        "id": "baseClip", "trackId": "v1", "kind": "video", "label": "Base",
                        "startFrame": 0, "durationFrames": 60,
                        "source": { "type": "asset", "assetId": "base", "inFrame": 0, "outFrame": 60 },
                        "speed": { "num": 1, "den": 1 }
                    },
                    {
                        "id": "overClip", "trackId": "v2", "kind": "image", "label": "Overlay",
                        "startFrame": 0, "durationFrames": 60,
                        "source": { "type": "asset", "assetId": "over" }
                    }
                ]
            },
            "captions": {
                "cues": [
                    { "id": "c1", "startFrame": 0, "endFrame": 60, "text": "Hola" }
                ]
            }
        });
        let started = std::time::Instant::now();
        let result = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "baseClip",
            30,
            &dir,
        )
        .expect("frame compuesto");
        assert!(result.composite);
        assert_eq!(result.composite_mode, "window");
        assert_eq!((result.width, result.height), (320, 180));
        assert_eq!(result.visible_tracks, 2);
        assert!(result.captions_burned);
        assert!(!result.native);
        let pixel = image::open(&result.path)
            .expect("png")
            .to_rgb8()
            .get_pixel(160, 90)
            .0;
        assert!(
            pixel[2] > 180 && pixel[0] < 80,
            "el centro debe ser el overlay azul, fue {pixel:?}"
        );
        println!(
            "compuesto real: {} {}x{} en {:.2}s ({})",
            result.path,
            result.width,
            result.height,
            started.elapsed().as_secs_f64(),
            result.clip_label
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "comparación manual ventana vs compuesto completo"]
    fn compare_window_with_full_from_env() {
        let Ok(path) = std::env::var("EDITORIA_BENCH_PROJECT") else {
            return;
        };
        let project_path = PathBuf::from(path);
        let root = project_path.parent().expect("raíz").to_path_buf();
        let project: Value =
            serde_json::from_str(&std::fs::read_to_string(&project_path).expect("proyecto"))
                .expect("json");
        let silent = preview_copy(&project);
        let out = std::env::temp_dir().join(format!("editoria-compare-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&out).expect("salida");
        let frames: Vec<u64> = std::env::var("EDITORIA_BENCH_FRAMES")
            .unwrap_or_else(|_| "30,300,600".to_owned())
            .split(',')
            .filter_map(|value| value.trim().parse().ok())
            .collect();
        for frame in frames {
            let started = std::time::Instant::now();
            let fast = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &root,
                &project,
                "bench",
                frame,
                &out,
            )
            .expect("ventana");
            let fast_elapsed = started.elapsed().as_secs_f64();
            let started = std::time::Instant::now();
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &root,
                &silent,
                "bench",
                frame,
                &out,
            )
            .expect("completo");
            let full_elapsed = started.elapsed().as_secs_f64();
            let fast_image = image::open(&fast.path).expect("png ventana").to_rgb8();
            let full_image = image::open(&full.path).expect("png completo").to_rgb8();
            assert_eq!(fast_image.dimensions(), full_image.dimensions());
            let mut total = 0u64;
            let mut worst = 0u64;
            for (left, right) in fast_image.pixels().zip(full_image.pixels()) {
                for channel in 0..3 {
                    let difference =
                        (left.0[channel] as i32 - right.0[channel] as i32).unsigned_abs() as u64;
                    total += difference;
                    worst = worst.max(difference);
                }
            }
            let pixels = (fast_image.width() * fast_image.height()) as u64;
            let mean = total as f64 / (pixels * 3) as f64;
            println!(
                "frame {frame}: ventana {fast_elapsed:.2}s ({}) · completo {full_elapsed:.2}s ({}) · diff media {mean:.3} · peor {worst}",
                fast.composite_mode, full.composite_mode
            );
            let _ = std::fs::remove_file(&fast.path);
            let _ = std::fs::remove_file(&full.path);
        }
        let _ = std::fs::remove_dir_all(&out);
    }

    fn preview_project() -> Value {
        serde_json::json!({
            "video": {
                "width": 320, "height": 180,
                "frameRate": { "num": 30, "den": 1 },
                "backgroundColor": "#000000"
            },
            "assets": [
                {
                    "id": "video", "kind": "video", "label": "Toma",
                    "source": { "path": "media/red.mp4" },
                    "status": "ready",
                    "rights": { "license": { "commercialUse": "allowed" } }
                },
                {
                    "id": "image", "kind": "image", "label": "Imagen",
                    "source": { "path": "media/blue.png" },
                    "status": "ready",
                    "rights": { "license": { "commercialUse": "allowed" } }
                }
            ],
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 1 },
                    { "id": "v2", "kind": "video", "order": 2 },
                    { "id": "a1", "kind": "audio", "order": 3 }
                ],
                "clips": [
                    {
                        "id": "main", "trackId": "v1", "kind": "video", "label": "Toma",
                        "startFrame": 10, "durationFrames": 30,
                        "source": { "type": "asset", "assetId": "video", "inFrame": 0, "outFrame": 30 },
                        "speed": { "num": 1, "den": 1 },
                        "transform": { "keyframes": [
                            { "frame": 0, "scale": 1 },
                            { "frame": 30, "scale": 1.2 }
                        ] },
                        "motion": { "type": "zoom-in", "intensity": 0.2 },
                        "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.8,
                            "keyframes": [
                                { "frame": 0, "x": 0 },
                                { "frame": 30, "x": 0.2 }
                            ] }
                    },
                    {
                        "id": "later", "trackId": "v2", "kind": "image", "label": "Después",
                        "startFrame": 100, "durationFrames": 30,
                        "source": { "type": "asset", "assetId": "image" },
                        "transform": {}
                    },
                    {
                        "id": "voice", "trackId": "a1", "kind": "audio", "label": "Voz",
                        "startFrame": 0, "durationFrames": 120,
                        "source": { "type": "asset", "assetId": "video" }
                    }
                ]
            },
            "captions": { "cues": [
                { "id": "c1", "startFrame": 10, "endFrame": 40, "text": "Hola" }
            ] }
        })
    }

    #[test]
    fn window_keeps_only_the_active_frame() {
        let project = preview_project();
        let window = window_project(&preview_copy(&project), 20).expect("ventana");
        let clips = window["timeline"]["clips"].as_array().expect("clips");
        assert_eq!(clips.len(), 1, "sólo el clip activo");
        let clip = &clips[0];
        assert_eq!(clip["id"], "main");
        assert_eq!(clip["startFrame"], 0);
        assert_eq!(clip["durationFrames"], 1);
        assert_eq!(clip["source"]["inFrame"], 10);
        assert_eq!(clip["source"]["outFrame"], 40);
        assert_eq!(clip["audio"]["muted"], true);
        let motion = &clip["motion"]["frozen"];
        assert!(motion["z"].as_f64().is_some_and(|zoom| zoom > 1.0));
        assert!(motion["x"].is_string() && motion["y"].is_string());
        let transform = clip["transform"]["keyframes"]
            .as_array()
            .expect("transform");
        assert_eq!(transform[0]["frame"], -10);
        assert_eq!(transform[1]["frame"], 20);
        let mask = clip["mask"]["keyframes"].as_array().expect("mask");
        assert_eq!(mask[0]["frame"], -10);
        assert_eq!(mask[1]["frame"], 20);
        let cues = window["captions"]["cues"].as_array().expect("cues");
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0]["startFrame"], 0);
        assert_eq!(cues[0]["endFrame"], 20);
        assert!(
            window["timeline"]["tracks"]
                .as_array()
                .expect("tracks")
                .iter()
                .all(|track| track["kind"] != "audio"),
            "el audio no entra al preview"
        );
    }

    #[test]
    fn preview_copy_relaxes_rights_without_mutating_the_project() {
        let mut project = preview_project();
        project["assets"][0]["status"] = serde_json::json!("unverified");
        project["assets"][0]["rights"]["license"]["commercialUse"] = serde_json::json!("unknown");
        let preview = preview_copy(&project);
        assert_eq!(preview["assets"][0]["status"], "ready");
        assert_ne!(
            preview["assets"][0]["rights"]["license"]["commercialUse"],
            "unknown"
        );
        assert_eq!(project["assets"][0]["status"], "unverified");
        assert_eq!(
            project["assets"][0]["rights"]["license"]["commercialUse"],
            "unknown"
        );
        assert!(preview["timeline"]["tracks"]
            .as_array()
            .expect("tracks")
            .iter()
            .all(|track| track["kind"] != "audio"));
    }

    #[test]
    fn window_rejects_word_reveal_and_omits_active_graphics() {
        let mut project = preview_project();
        project["captions"]["cues"][0]["wordReveal"] = serde_json::json!(true);
        project["captions"]["cues"][0]["words"] = serde_json::json!([
            { "text": "Ho", "startFrame": 10, "endFrame": 20 },
            { "text": "la", "startFrame": 20, "endFrame": 30 }
        ]);
        assert!(
            window_project(&preview_copy(&project), 20).is_err(),
            "el revelado por palabra debe caer al compuesto completo"
        );

        let mut project = preview_project();
        project["timeline"]["tracks"]
            .as_array_mut()
            .expect("tracks")
            .push(serde_json::json!({
                "id": "g1", "kind": "video", "order": 3
            }));
        project["timeline"]["clips"]
            .as_array_mut()
            .expect("clips")
            .push(serde_json::json!({
                "id": "graphic", "trackId": "g1", "kind": "graphic",
                "label": "Gráfico", "startFrame": 100, "durationFrames": 10,
                "source": { "type": "graphic" }
            }));
        let window = window_project(&preview_copy(&project), 20).expect("gráfico inactivo");
        assert_eq!(window["previewGraphicOmitted"], serde_json::Value::Null);
        project["timeline"]["clips"][3]["startFrame"] = serde_json::json!(20);
        let window = window_project(&preview_copy(&project), 20).expect("gráfico activo omitido");
        assert_eq!(window["previewGraphicOmitted"], serde_json::json!(true));
        assert!(
            window["timeline"]["clips"]
                .as_array()
                .expect("clips")
                .iter()
                .all(|clip| clip["id"] != "graphic"),
            "el clip gráfico no debe entrar en el plan de la ventana"
        );
    }

    #[test]
    fn window_freezes_fades_and_transition_leads() {
        let mut project = preview_project();
        project["timeline"]["clips"][0]["effects"] =
            serde_json::json!({ "fadeInFrames": 12, "fadeOutFrames": 12 });
        let window = window_project(&preview_copy(&project), 13).expect("fade de entrada");
        let clip = &window["timeline"]["clips"][0];
        assert_eq!(clip["effects"]["fadeInFrames"], 0);
        assert_eq!(clip["effects"]["fadeOutFrames"], 0);
        let enter = clip["fadeFrozen"].as_f64().expect("factor de entrada");
        assert!((enter - 0.25).abs() < 1e-6, "factor {enter}");
        let window = window_project(&preview_copy(&project), 34).expect("fade de salida");
        let leave = window["timeline"]["clips"][0]["fadeFrozen"]
            .as_f64()
            .expect("factor de salida");
        assert!((leave - 0.5).abs() < 1e-6, "factor {leave}");
        assert!(window_project(&preview_copy(&project), 40).is_ok());

        let later_clip = |window: &Value| -> Value {
            window["timeline"]["clips"]
                .as_array()
                .expect("clips")
                .iter()
                .find(|clip| clip["id"] == "later")
                .expect("clip entrante")
                .clone()
        };
        let mut project = preview_project();
        project["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
        project["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
            "type": "dissolve", "frames": 12
        });
        // El frame 16 cae en el lead: alfa 0,5. El 22 ya es el corte.
        let window = window_project(&preview_copy(&project), 16).expect("dissolve en lead");
        let later = later_clip(&window);
        assert_eq!(later["transitionIn"], serde_json::json!({}));
        let alpha = later["transitionFrozen"]["alpha"]
            .as_f64()
            .expect("alfa de transición");
        assert!((alpha - 0.5).abs() < 1e-6, "alfa {alpha}");
        assert_eq!(
            composite_metadata(&project, 16).0,
            2,
            "el clip entrante cuenta durante su lead"
        );
        assert!(window_project(&preview_copy(&project), 22).is_ok());

        for (kind, axis, expected) in [
            ("slide-left", "x", 160.0_f64),
            ("slide-right", "x", -160.0),
            ("slide-up", "y", 90.0),
            ("slide-down", "y", -90.0),
        ] {
            let mut slide = preview_project();
            slide["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
            slide["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
                "type": kind, "frames": 12
            });
            let window = window_project(&preview_copy(&slide), 16).expect("slide en lead");
            let later = later_clip(&window);
            let value = later["transitionFrozen"][axis]
                .as_f64()
                .expect("desplazamiento congelado");
            assert!((value - expected).abs() < 1e-6, "{kind}: {axis} {value}");
            assert!(window_project(&preview_copy(&slide), 22).is_ok());
        }

        let mut fade = preview_project();
        fade["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
        fade["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
            "type": "fade-black", "frames": 12
        });
        let window = window_project(&preview_copy(&fade), 16).expect("fade-black en lead");
        let later = later_clip(&window);
        assert_eq!(later["transitionFrozen"]["mode"], "black");
        assert!((later["transitionFrozen"]["alpha"].as_f64().unwrap() - 0.5).abs() < 1e-6);
        assert!(window_project(&preview_copy(&fade), 22).is_ok());

        let mut motion = preview_project();
        motion["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
        motion["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
            "type": "dissolve", "frames": 12
        });
        motion["timeline"]["clips"][1]["motion"] =
            serde_json::json!({ "type": "zoom-in", "intensity": 0.2 });
        let window = window_project(&preview_copy(&motion), 16).expect("motion en lead");
        let later = later_clip(&window);
        let zoom = later["motion"]["frozen"]["z"]
            .as_f64()
            .expect("zoom congelado");
        assert!((zoom - 1.04).abs() < 1e-6, "zoom {zoom}");
        assert!(window_project(&preview_copy(&motion), 22).is_ok());
        let window = window_project(&preview_copy(&motion), 46).expect("motion posterior al clip");
        let later = later_clip(&window);
        let zoom = later["motion"]["frozen"]["z"]
            .as_f64()
            .expect("zoom posterior");
        assert!((zoom - 1.24).abs() < 1e-6, "zoom posterior {zoom}");

        let mut animated = preview_project();
        animated["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
        animated["timeline"]["clips"][1]["animationIn"] =
            serde_json::json!({ "type": "slide-left", "durationFrames": 12 });
        animated["timeline"]["clips"][1]["animationOut"] =
            serde_json::json!({ "type": "fade", "durationFrames": 12 });
        let window = window_project(&preview_copy(&animated), 25).expect("animación de entrada");
        let later = later_clip(&window);
        let x = later["animationFrozen"]["x"]
            .as_f64()
            .expect("desplazamiento animado");
        assert!((x - 240.0).abs() < 1e-6, "x {x}");
        let window = window_project(&preview_copy(&animated), 46).expect("animación de salida");
        let later = later_clip(&window);
        let alpha = later["animationFrozen"]["alpha"]
            .as_f64()
            .expect("alfa animado");
        assert!((alpha - 0.5).abs() < 1e-6, "alfa {alpha}");

        let mut unknown = preview_project();
        unknown["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
        unknown["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
            "type": "wipe", "frames": 12
        });
        assert!(window_project(&preview_copy(&unknown), 16).is_err());

        let mut project = preview_project();
        project["timeline"]["clips"][0]["transform"]["keyframes"][1]["opacity"] =
            serde_json::json!(0.5);
        let window = window_project(&preview_copy(&project), 20).expect("opacidad congelada");
        let main = window["timeline"]["clips"]
            .as_array()
            .expect("clips")
            .iter()
            .find(|clip| clip["id"] == "main")
            .expect("clip principal");
        let opacity = main["opacityFrozen"].as_f64().expect("opacidad");
        assert!((opacity - 0.5).abs() < 1e-6, "opacidad {opacity}");
    }

    #[test]
    fn frozen_opacity_interpolates_with_easing() {
        let clip = serde_json::json!({
            "transform": { "keyframes": [
                { "frame": 0, "opacity": 0 },
                { "frame": 30, "opacity": 1 }
            ] }
        });
        let value = opacity_at(&clip, 0.5, 30.0).expect("lineal");
        assert!((value - 0.5).abs() < 1e-9, "lineal {value}");
        let mut eased = clip.clone();
        eased["transform"]["keyframes"][0]["easing"] = serde_json::json!("ease-in");
        let value = opacity_at(&eased, 0.5, 30.0).expect("ease-in");
        assert!((value - 0.125).abs() < 1e-9, "ease-in {value}");
        let mut hold = clip.clone();
        hold["transform"]["keyframes"][0]["easing"] = serde_json::json!("hold");
        let value = opacity_at(&hold, 0.5, 30.0).expect("hold");
        assert!(value.abs() < 1e-9, "hold {value}");
        let value = opacity_at(&hold, 1.0, 30.0).expect("final");
        assert!((value - 1.0).abs() < 1e-9, "final {value}");
    }

    #[test]
    fn window_expands_compound_clips() {
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Toma",
                "source": { "path": "media/red.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "outer", "trackId": "v1", "kind": "compound",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "compound", "compoundId": "c1" }
                }]
            },
            "compounds": [{
                "id": "c1", "durationFrames": 30,
                "clips": [{
                    "id": "inner", "trackId": "v1", "kind": "video",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
                }]
            }],
            "captions": { "cues": [] }
        });
        let window = window_project(&preview_copy(&project), 10).expect("compuesto expandido");
        let ids: Vec<&str> = window["timeline"]["clips"]
            .as_array()
            .expect("clips")
            .iter()
            .filter_map(|clip| clip["id"].as_str())
            .collect();
        assert!(ids.contains(&"inner"), "clips: {ids:?}");
        assert!(!ids.contains(&"outer"), "clips: {ids:?}");
    }

    #[test]
    fn window_skips_compounds_on_hidden_tracks() {
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Toma",
                "source": { "path": "media/red.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": true },
                    { "id": "v2", "kind": "video", "order": 1, "hidden": false }
                ],
                "clips": [{
                    "id": "outer", "trackId": "v1", "kind": "compound",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "compound", "compoundId": "c1" }
                }]
            },
            "compounds": [{
                "id": "c1", "durationFrames": 30,
                "clips": [{
                    "id": "inner", "trackId": "v2", "kind": "video",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
                }]
            }],
            "captions": { "cues": [] }
        });
        let window = window_project(&preview_copy(&project), 10).expect("ventana oculta");
        let ids: Vec<&str> = window["timeline"]["clips"]
            .as_array()
            .expect("clips")
            .iter()
            .filter_map(|clip| clip["id"].as_str())
            .collect();
        assert!(
            !ids.contains(&"inner"),
            "la pista oculta del compuesto no debe revelar sus clips internos: {ids:?}"
        );
    }

    #[test]
    fn reverse_clip_uses_the_reversed_source_frame() {
        let mut project = preview_project();
        project["timeline"]["clips"][0]["reverse"] = serde_json::json!(true);
        let window = window_project(&preview_copy(&project), 20).expect("clip invertido");
        let main = window["timeline"]["clips"]
            .as_array()
            .expect("clips")
            .iter()
            .find(|clip| clip["id"] == "main")
            .expect("clip principal");
        assert_eq!(main["reverse"], serde_json::json!(false));
        // in=0, out=30, clip de 30 frames, delta=10: el reverso muestra 19.
        assert_eq!(main["source"]["inFrame"], serde_json::json!(19));
        assert_eq!(main["source"]["outFrame"], serde_json::json!(20));
    }

    #[test]
    fn frozen_ken_burns_fraction_is_independent_of_speed() {
        let base = serde_json::json!({
            "kind": "video",
            "motion": { "type": "zoom-in", "intensity": 0.2 }
        });
        let normal = frozen_motion(&base, 2.5, 5.0).expect("normal");
        let mut fast = base;
        fast["speed"] = serde_json::json!({ "num": 2, "den": 1 });
        let doubled = frozen_motion(&fast, 2.5, 5.0).expect("velocidad");
        let zoom = |value: &Value| value["frozen"]["z"].as_f64().expect("z");
        assert!((zoom(&normal) - 1.1).abs() < 1e-9);
        assert!((zoom(&normal) - zoom(&doubled)).abs() < 1e-9);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn window_matches_full_with_motion_keyframes_and_mask() {
        let dir = std::env::temp_dir().join(format!("editoria-window-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("bars.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "smptebars=s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Barras",
                "source": { "path": "media/bars.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Barras",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 },
                    "motion": { "type": "zoom-in", "intensity": 0.2 },
                    "effects": { "brightness": 0.08 },
                    "transform": {
                        "opacity": 1,
                        "keyframes": [
                            { "frame": 0, "offsetX": 0 },
                            { "frame": 60, "offsetX": 0.1 }
                        ]
                    },
                    "mask": {
                        "shape": "ellipse", "x": 0, "y": 0, "width": 0.9,
                        "height": 0.9, "feather": 0.1,
                        "keyframes": [
                            { "frame": 0, "x": 0 },
                            { "frame": 60, "x": 0.1 }
                        ]
                    }
                }]
            }
        });
        let fast = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "c",
            30,
            &dir,
        )
        .expect("ventana");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&project),
            "c",
            30,
            &dir,
        )
        .expect("completo");
        assert_eq!(fast.composite_mode, "window");
        let fast_image = image::open(&fast.path).expect("png ventana").to_rgb8();
        let full_image = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        for (left, right) in fast_image.pixels().zip(full_image.pixels()) {
            for channel in 0..3 {
                total += (left.0[channel] as i32 - right.0[channel] as i32).unsigned_abs() as u64;
            }
        }
        let mean = total as f64 / (fast_image.width() * fast_image.height() * 3) as f64;
        println!("ventana vs completo (motion/offset/máscara): diff media {mean:.3}");
        assert!(
            mean < 1.0,
            "la ventana debe coincidir con el compuesto completo, diff {mean:.3}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn window_scale_keyframe_matches_the_static_target() {
        // El overlay del compuesto completo centra una capa que cambia de
        // tamaño con el tamaño inicial; la ventana congela la escala del frame
        // y coincide con el equivalente estático.
        let dir = std::env::temp_dir().join(format!("editoria-scale-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("bars.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "smptebars=s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg")
            .success());
        let project = |transform: Value| {
            serde_json::json!({
                "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
                "assets": [{
                    "id": "a", "kind": "video", "label": "Barras",
                    "source": { "path": "media/bars.mp4" },
                    "status": "ready",
                    "rights": { "license": { "commercialUse": "allowed" } }
                }],
                "timeline": {
                    "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                    "clips": [{
                        "id": "c", "trackId": "v1", "kind": "video", "label": "Barras",
                        "startFrame": 0, "durationFrames": 60,
                        "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                        "speed": { "num": 1, "den": 1 },
                        "effects": { "brightness": 0.08 },
                        "transform": transform
                    }]
                }
            })
        };
        let keyed = project(serde_json::json!({ "keyframes": [
            { "frame": 0, "scale": 1 },
            { "frame": 60, "scale": 1.3 }
        ] }));
        let static_target = project(serde_json::json!({ "scaleX": 1.15, "scaleY": 1.15 }));
        let fast = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &keyed,
            "c",
            30,
            &dir,
        )
        .expect("ventana");
        assert_eq!(fast.composite_mode, "window");
        let reference = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&static_target),
            "c",
            30,
            &dir,
        )
        .expect("estático");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&keyed),
            "c",
            30,
            &dir,
        )
        .expect("completo keyed");
        let mean_diff = |left: &image::RgbImage, right: &image::RgbImage| {
            let mut total = 0u64;
            for (a, b) in left.pixels().zip(right.pixels()) {
                for channel in 0..3 {
                    total += (a.0[channel] as i32 - b.0[channel] as i32).unsigned_abs() as u64;
                }
            }
            total as f64 / (left.width() * left.height() * 3) as f64
        };
        let fast_image = image::open(&fast.path).expect("png ventana").to_rgb8();
        let reference_image = image::open(&reference.path)
            .expect("png estático")
            .to_rgb8();
        let full_image = image::open(&full.path).expect("png completo").to_rgb8();
        let mean = mean_diff(&fast_image, &reference_image);
        let full_mean = mean_diff(&full_image, &reference_image);
        println!("scale kf vs estático 1.15: ventana {mean:.3} · completo {full_mean:.3}");
        assert!(
            mean < 5.0,
            "la escala congelada debe ser 1.15, diff {mean:.3}"
        );
        assert!(
            full_mean < 8.0,
            "el compuesto completo debe recentrar la escala, diff {full_mean:.3}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_scale_keyframe_export_stays_centered() {
        let dir = std::env::temp_dir().join(format!("editoria-scale-export-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let source = media.join("square.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=30:d=2",
                "-vf",
                "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let bbox = |image: &image::RgbImage| -> Option<(u32, u32, u32, u32)> {
            let (width, height) = image.dimensions();
            let mut bounds = (width, height, 0u32, 0u32);
            let mut found = false;
            for y in 0..height {
                for x in 0..width {
                    let pixel = image.get_pixel(x, y).0;
                    if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                        found = true;
                        bounds = (
                            bounds.0.min(x),
                            bounds.1.min(y),
                            bounds.2.max(x),
                            bounds.3.max(y),
                        );
                    }
                }
            }
            found.then_some(bounds)
        };
        for (label, start_scale, end_scale, expected_start, expected_mid) in [
            ("arriba", 1.0, 1.3, 100u32, 115u32),
            ("abajo", 1.0, 0.7, 100u32, 85u32),
            ("cruce", 0.8, 1.3, 80u32, 105u32),
        ] {
            let project = serde_json::json!({
                "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
                "assets": [{
                    "id": "a", "kind": "video", "label": "Cuadrado",
                    "source": { "path": "media/square.mp4" },
                    "status": "ready",
                    "rights": { "license": { "commercialUse": "allowed" } }
                }],
                "timeline": {
                    "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                    "clips": [{
                        "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                        "startFrame": 0, "durationFrames": 60,
                        "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                        "speed": { "num": 1, "den": 1 },
                        "transform": { "keyframes": [
                            { "frame": 0, "scale": start_scale },
                            { "frame": 60, "scale": end_scale }
                        ] }
                    }]
                }
            });
            let output = dir.join(format!("scale-{label}.mp4"));
            let profile = profile_for(&project).expect("perfil");
            let plan = build_plan(BuildPlanInput {
                audio_only: false,
                project: &project,
                root: &dir,
                profile: &profile,
                output_path: &output,
                include_captions: false,
                temp_dir: &render_dir,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("plan de export");
            assert!(Command::new("ffmpeg")
                .args(&plan.args)
                .current_dir(&render_dir)
                .status()
                .expect("ffmpeg export")
                .success());
            assert!(output.is_file());
            for (time, frame_label, expected) in [
                (0.05, "inicio", expected_start),
                (1.0, "medio", expected_mid),
            ] {
                let frame = dir.join(format!("frame-{label}-{frame_label}.png"));
                assert!(Command::new("ffmpeg")
                    .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                    .arg(&output)
                    .args(["-frames:v", "1"])
                    .arg(&frame)
                    .status()
                    .expect("ffmpeg frame")
                    .success());
                let image = image::open(&frame).expect("png frame").to_rgb8();
                let (left, _top, right, _bottom) = bbox(&image).expect("cuadrado rojo");
                let width = right - left + 1;
                let center = (left + right) / 2;
                println!(
                    "{label}/{frame_label}: ancho {width} · centro {center} (esperado {expected}/160)"
                );
                assert!(
                    width.abs_diff(expected) <= 4,
                    "{label}/{frame_label}: ancho {width}, esperado {expected}"
                );
                assert!(
                    center.abs_diff(160) <= 4,
                    "{label}/{frame_label}: centro {center}, esperado 160"
                );
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_rotation_keyframe_export_stays_centered() {
        let dir = std::env::temp_dir().join(format!("editoria-rotation-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let source = media.join("square.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=30:d=2",
                "-vf",
                "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Cuadrado",
                "source": { "path": "media/square.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 },
                    "transform": { "keyframes": [
                        { "frame": 0, "rotationDeg": 0 },
                        { "frame": 60, "rotationDeg": 90 }
                    ] }
                }]
            }
        });
        let output = dir.join("rotation.mp4");
        let profile = profile_for(&project).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan de rotación");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg rotación")
            .success());
        for time in [0.05_f64, 1.0] {
            let frame = dir.join(format!("rotation-{time:.3}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                .arg(&output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame")
                .success());
            let image = image::open(&frame).expect("png").to_rgb8();
            let mut bounds = (320u32, 180u32, 0u32, 0u32);
            let mut found = false;
            for y in 0..180 {
                for x in 0..320 {
                    let pixel = image.get_pixel(x, y).0;
                    if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                        found = true;
                        bounds = (
                            bounds.0.min(x),
                            bounds.1.min(y),
                            bounds.2.max(x),
                            bounds.3.max(y),
                        );
                    }
                }
            }
            assert!(found, "el cuadrado rotado debe verse");
            let width = bounds.2 - bounds.0 + 1;
            let center_x = (bounds.0 + bounds.2) / 2;
            let center_y = (bounds.1 + bounds.3) / 2;
            println!("rotación {time:.2}s: ancho {width} · centro {center_x},{center_y}");
            assert!(
                center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
                "la rotación debe quedar centrada, fue {center_x},{center_y}"
            );
            let expected_width = if time > 0.5 { 141 } else { 104 };
            assert!(
                width.abs_diff(expected_width) <= 6,
                "la rotación debe animarse: ancho {width}, esperado {expected_width}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_scale_rotation_export_combines_both() {
        let dir = std::env::temp_dir().join(format!("editoria-scale-rot-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let source = media.join("square.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=30:d=2",
                "-vf",
                "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Cuadrado",
                "source": { "path": "media/square.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 },
                    "transform": { "keyframes": [
                        { "frame": 0, "scale": 1, "rotationDeg": 0 },
                        { "frame": 60, "scale": 1.3, "rotationDeg": 90 }
                    ] }
                }]
            }
        });
        let output = dir.join("scale-rotation.mp4");
        let profile = profile_for(&project).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan escala+rotación");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg escala+rotación")
            .success());
        for (time, expected_width) in [(0.05_f64, 104u32), (1.0, 163u32)] {
            let frame = dir.join(format!("scale-rotation-{time:.3}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                .arg(&output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame")
                .success());
            let image = image::open(&frame).expect("png").to_rgb8();
            let mut bounds = (320u32, 180u32, 0u32, 0u32);
            let mut found = false;
            for y in 0..180 {
                for x in 0..320 {
                    let pixel = image.get_pixel(x, y).0;
                    if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                        found = true;
                        bounds = (
                            bounds.0.min(x),
                            bounds.1.min(y),
                            bounds.2.max(x),
                            bounds.3.max(y),
                        );
                    }
                }
            }
            assert!(found, "el cuadrado debe verse");
            let width = bounds.2 - bounds.0 + 1;
            let center_x = (bounds.0 + bounds.2) / 2;
            let center_y = (bounds.1 + bounds.3) / 2;
            println!("escala+rotación {time:.2}s: ancho {width} · centro {center_x},{center_y}");
            assert!(
                width.abs_diff(expected_width) <= 6,
                "ancho {width}, esperado {expected_width}"
            );
            assert!(
                center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
                "centro {center_x},{center_y}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_static_scale_with_keyframes_export() {
        let dir = std::env::temp_dir().join(format!("editoria-static-scale-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let source = media.join("square.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=30:d=2",
                "-vf",
                "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Cuadrado",
                "source": { "path": "media/square.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 },
                    "transform": {
                        "scaleX": 1.15, "scaleY": 1.15,
                        "keyframes": [
                            { "frame": 0, "scale": 1 },
                            { "frame": 60, "scale": 1.3 }
                        ]
                    }
                }]
            }
        });
        let output = dir.join("static-scale.mp4");
        let profile = profile_for(&project).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan escala estática");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg escala estática")
            .success());
        for (time, expected_width) in [(0.05_f64, 115u32), (1.0, 132u32)] {
            let frame = dir.join(format!("static-scale-{time:.3}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                .arg(&output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame")
                .success());
            let image = image::open(&frame).expect("png").to_rgb8();
            let mut bounds = (320u32, 180u32, 0u32, 0u32);
            let mut found = false;
            for y in 0..180 {
                for x in 0..320 {
                    let pixel = image.get_pixel(x, y).0;
                    if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                        found = true;
                        bounds = (
                            bounds.0.min(x),
                            bounds.1.min(y),
                            bounds.2.max(x),
                            bounds.3.max(y),
                        );
                    }
                }
            }
            assert!(found, "el cuadrado debe verse");
            let width = bounds.2 - bounds.0 + 1;
            let center_x = (bounds.0 + bounds.2) / 2;
            let center_y = (bounds.1 + bounds.3) / 2;
            println!("escala estática+keyframes {time:.2}s: ancho {width} · centro {center_x},{center_y}");
            assert!(
                width.abs_diff(expected_width) <= 6,
                "ancho {width}, esperado {expected_width}"
            );
            assert!(
                center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
                "centro {center_x},{center_y}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_motion_scale_export_combines_both() {
        let dir = std::env::temp_dir().join(format!("editoria-motion-scale-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let source = media.join("square.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=30:d=2",
                "-vf",
                "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Cuadrado",
                "source": { "path": "media/square.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 },
                    "motion": { "type": "zoom-in", "intensity": 0.2 },
                    "transform": { "keyframes": [
                        { "frame": 0, "scale": 1 },
                        { "frame": 60, "scale": 1.3 }
                    ] }
                }]
            }
        });
        let output = dir.join("motion-scale.mp4");
        let profile = profile_for(&project).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan movimiento+escala");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg movimiento+escala")
            .success());
        for (time, expected_width) in [(0.05_f64, 101u32), (1.0, 126u32)] {
            let frame = dir.join(format!("motion-scale-{time:.3}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                .arg(&output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame")
                .success());
            let image = image::open(&frame).expect("png").to_rgb8();
            let mut bounds = (320u32, 180u32, 0u32, 0u32);
            let mut found = false;
            for y in 0..180 {
                for x in 0..320 {
                    let pixel = image.get_pixel(x, y).0;
                    if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                        found = true;
                        bounds = (
                            bounds.0.min(x),
                            bounds.1.min(y),
                            bounds.2.max(x),
                            bounds.3.max(y),
                        );
                    }
                }
            }
            assert!(found, "el cuadrado debe verse");
            let width = bounds.2 - bounds.0 + 1;
            let center_x = (bounds.0 + bounds.2) / 2;
            let center_y = (bounds.1 + bounds.3) / 2;
            println!("movimiento+escala {time:.2}s: ancho {width} · centro {center_x},{center_y}");
            assert!(
                width.abs_diff(expected_width) <= 6,
                "ancho {width}, esperado {expected_width}"
            );
            assert!(
                center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
                "centro {center_x},{center_y}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_speed_scale_export_rebases_keyframes() {
        let dir = std::env::temp_dir().join(format!("editoria-speed-scale-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let source = media.join("square.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=30:d=2",
                "-vf",
                "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        for (label, start_scale, end_scale, expected_start, expected_mid) in [
            ("arriba", 1.0, 1.3, 101u32, 115u32),
            ("cruce", 0.8, 1.3, 82u32, 105u32),
        ] {
            let project = serde_json::json!({
                "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
                "assets": [{
                    "id": "a", "kind": "video", "label": "Cuadrado",
                    "source": { "path": "media/square.mp4" },
                    "status": "ready",
                    "rights": { "license": { "commercialUse": "allowed" } }
                }],
                "timeline": {
                    "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                    "clips": [{
                        "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                        "startFrame": 0, "durationFrames": 30,
                        "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                        "speed": { "num": 2, "den": 1 },
                        "transform": { "keyframes": [
                            { "frame": 0, "scale": start_scale },
                            { "frame": 30, "scale": end_scale }
                        ] }
                    }]
                }
            });
            let output = dir.join(format!("speed-scale-{label}.mp4"));
            let profile = profile_for(&project).expect("perfil");
            let plan = build_plan(BuildPlanInput {
                audio_only: false,
                project: &project,
                root: &dir,
                profile: &profile,
                output_path: &output,
                include_captions: false,
                temp_dir: &render_dir,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("plan velocidad+escala");
            assert!(Command::new("ffmpeg")
                .args(&plan.args)
                .current_dir(&render_dir)
                .status()
                .expect("ffmpeg velocidad+escala")
                .success());
            for (time, expected_width) in [(0.05_f64, expected_start), (0.5, expected_mid)] {
                let frame = dir.join(format!("speed-scale-{label}-{time:.3}.png"));
                assert!(Command::new("ffmpeg")
                    .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                    .arg(&output)
                    .args(["-frames:v", "1"])
                    .arg(&frame)
                    .status()
                    .expect("ffmpeg frame")
                    .success());
                let image = image::open(&frame).expect("png").to_rgb8();
                let mut bounds = (320u32, 180u32, 0u32, 0u32);
                let mut found = false;
                for y in 0..180 {
                    for x in 0..320 {
                        let pixel = image.get_pixel(x, y).0;
                        if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                            found = true;
                            bounds = (
                                bounds.0.min(x),
                                bounds.1.min(y),
                                bounds.2.max(x),
                                bounds.3.max(y),
                            );
                        }
                    }
                }
                assert!(found, "el cuadrado debe verse");
                let width = bounds.2 - bounds.0 + 1;
                let center_x = (bounds.0 + bounds.2) / 2;
                let center_y = (bounds.1 + bounds.3) / 2;
                println!(
                    "velocidad+escala/{label} {time:.2}s: ancho {width} · centro {center_x},{center_y}"
                );
                assert!(
                    width.abs_diff(expected_width) <= 6,
                    "ancho {width}, esperado {expected_width}"
                );
                assert!(
                    center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
                    "centro {center_x},{center_y}"
                );
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn active_fade_uses_the_window_and_matches_the_full_composite() {
        let dir = std::env::temp_dir().join(format!("editoria-fade-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let image = media.join("gray.png");
        let pixels = vec![180u8; 320 * 180 * 3];
        image::save_buffer(&image, &pixels, 320, 180, image::ColorType::Rgb8).expect("png");
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "image", "label": "Gris",
                "source": { "path": "media/gray.png" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "image", "label": "Gris",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a" },
                    "effects": { "fadeInFrames": 12, "fadeOutFrames": 12 }
                }]
            }
        });
        // frame 3: 25% de opacidad; frame 24: 50%. El fondo #0f1319 se mezcla
        // con el gris 180 según el alfa, sin oscurecer el RGB del clip.
        for (frame, factor) in [(3u64, 0.25_f64), (24, 0.5)] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con fade");
            assert_eq!(window.composite_mode, "window", "frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo con fade");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let center_fast = fast.get_pixel(160, 90).0;
            let center_full = reference.get_pixel(160, 90).0;
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!(
                "fade frame {frame}: ventana {center_fast:?} · completo {center_full:?} · diff {mean_diff:.3}/255"
            );
            for (channel, base) in [15.0_f64, 19.0, 25.0].into_iter().enumerate() {
                let expected = base + (180.0 - base) * factor;
                assert!(
                    (center_fast[channel] as f64 - expected).abs() <= 4.0,
                    "ventana {center_fast:?}, canal {channel}, esperado {expected:.1}"
                );
                assert!(
                    (center_full[channel] as f64 - expected).abs() <= 4.0,
                    "completo {center_full:?}, canal {channel}, esperado {expected:.1}"
                );
            }
            assert!(mean_diff <= 3.0, "diferencia media {mean_diff:.3}/255");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn active_fade_with_speed_and_rotation_matches_full() {
        let dir = std::env::temp_dir().join(format!("editoria-fade-speed-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("gray.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0xB4B4B4:s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": {
                "width": 320, "height": 180,
                "frameRate": { "num": 30, "den": 1 },
                "backgroundColor": "#0f1319"
            },
            "assets": [{
                "id": "a", "kind": "video", "label": "Gris",
                "source": { "path": "media/gray.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Gris",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 2, "den": 1 },
                    "effects": { "fadeInFrames": 12, "fadeOutFrames": 12 },
                    "transform": { "keyframes": [
                        { "frame": 0, "rotationDeg": 0 },
                        { "frame": 30, "rotationDeg": 90 }
                    ] }
                }]
            }
        });
        for (frame, factor) in [(3u64, 0.25_f64), (24, 0.5)] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con fade, velocidad y rotación");
            assert_eq!(window.composite_mode, "window", "frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let center_fast = fast.get_pixel(160, 90).0;
            let center_full = reference.get_pixel(160, 90).0;
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!(
                "fade+velocidad+rotación frame {frame}: ventana {center_fast:?} · completo {center_full:?} · diff {mean_diff:.3}/255"
            );
            for (channel, base) in [15.0_f64, 19.0, 25.0].into_iter().enumerate() {
                let expected = base + (180.0 - base) * factor;
                assert!(
                    (center_fast[channel] as f64 - expected).abs() <= 5.0,
                    "ventana {center_fast:?}, canal {channel}, esperado {expected:.1}"
                );
                assert!(
                    (center_full[channel] as f64 - expected).abs() <= 5.0,
                    "completo {center_full:?}, canal {channel}, esperado {expected:.1}"
                );
            }
            assert!(mean_diff <= 3.0, "diferencia media {mean_diff:.3}/255");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn transition_leads_use_the_window_and_match_full() {
        let dir = std::env::temp_dir().join(format!("editoria-transition-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        for (name, source) in [
            ("red", "color=c=red:s=320x180:r=30:d=2"),
            ("pattern", "testsrc2=s=320x180:r=30:d=2"),
        ] {
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-f", "lavfi", "-i", source])
                .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
                .arg(media.join(format!("{name}.mp4")))
                .status()
                .expect("ffmpeg fuente")
                .success());
        }
        let base = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [
                { "id": "a", "kind": "video", "label": "Rojo",
                  "source": { "path": "media/red.mp4" }, "status": "ready",
                  "rights": { "license": { "commercialUse": "allowed" } } },
                { "id": "b", "kind": "video", "label": "Patrón",
                  "source": { "path": "media/pattern.mp4" }, "status": "ready",
                  "rights": { "license": { "commercialUse": "allowed" } } }
            ],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [
                    { "id": "a", "trackId": "v1", "kind": "video", "label": "Rojo",
                      "startFrame": 0, "durationFrames": 30,
                      "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } },
                    { "id": "b", "trackId": "v1", "kind": "video", "label": "Patrón",
                      "startFrame": 24, "durationFrames": 30,
                      "source": { "type": "asset", "assetId": "b", "inFrame": 0, "outFrame": 60 },
                      "transitionIn": { "type": "dissolve", "frames": 12 },
                      "transform": { "keyframes": [
                        { "frame": 0, "rotationDeg": 0 },
                        { "frame": 30, "rotationDeg": 90 }
                      ] } }
                ]
            }
        });
        for (kind, label) in [
            ("dissolve", "dissolve"),
            ("fade-black", "fade-black"),
            ("fade-white", "fade-white"),
            ("slide-left", "slide-left"),
        ] {
            let mut project = base.clone();
            project["timeline"]["clips"][1]["transitionIn"]["type"] = serde_json::json!(kind);
            for frame in [12u64, 18, 24, 30] {
                let window = composite_frame(
                    Path::new("ffmpeg"),
                    Path::new("ffprobe"),
                    &dir,
                    &project,
                    "b",
                    frame,
                    &dir,
                )
                .expect("ventana con transición");
                assert_eq!(window.composite_mode, "window", "{label} frame {frame}");
                let full = render_composite_project(
                    Path::new("ffmpeg"),
                    Path::new("ffprobe"),
                    &dir,
                    &preview_copy(&project),
                    "b",
                    frame,
                    &dir,
                )
                .expect("compuesto completo");
                let fast = image::open(&window.path).expect("png ventana").to_rgb8();
                let reference = image::open(&full.path).expect("png completo").to_rgb8();
                let mut total = 0u64;
                let mut count = 0u64;
                for (left, right) in fast.pixels().zip(reference.pixels()) {
                    for channel in 0..3 {
                        total += left.0[channel].abs_diff(right.0[channel]) as u64;
                        count += 1;
                    }
                }
                let mean_diff = total as f64 / count.max(1) as f64;
                println!("transición {label} frame {frame}: diff {mean_diff:.3}/255");
                assert!(
                    mean_diff <= 5.0,
                    "{label} frame {frame}: diff {mean_diff:.3}/255"
                );
            }
        }
        for (kind, motion_type, label) in [
            ("dissolve", "zoom-in", "dissolve+motion"),
            ("slide-left", "zoom-in", "slide-left+motion"),
            ("dissolve", "zoom-out", "dissolve+zoom-out"),
            ("dissolve", "pan-right", "dissolve+pan-right"),
        ] {
            let mut project = base.clone();
            project["timeline"]["clips"][1]["transitionIn"]["type"] = serde_json::json!(kind);
            project["timeline"]["clips"][1]["motion"] =
                serde_json::json!({ "type": motion_type, "intensity": 0.2 });
            for frame in [12u64, 18, 24, 30, 46] {
                let window = composite_frame(
                    Path::new("ffmpeg"),
                    Path::new("ffprobe"),
                    &dir,
                    &project,
                    "b",
                    frame,
                    &dir,
                )
                .expect("ventana con motion");
                assert_eq!(window.composite_mode, "window", "{label} frame {frame}");
                let full = render_composite_project(
                    Path::new("ffmpeg"),
                    Path::new("ffprobe"),
                    &dir,
                    &preview_copy(&project),
                    "b",
                    frame,
                    &dir,
                )
                .expect("compuesto completo");
                let fast = image::open(&window.path).expect("png ventana").to_rgb8();
                let reference = image::open(&full.path).expect("png completo").to_rgb8();
                let mut total = 0u64;
                let mut count = 0u64;
                for (left, right) in fast.pixels().zip(reference.pixels()) {
                    for channel in 0..3 {
                        total += left.0[channel].abs_diff(right.0[channel]) as u64;
                        count += 1;
                    }
                }
                let mean_diff = total as f64 / count.max(1) as f64;
                println!("transición {label} frame {frame}: diff {mean_diff:.3}/255");
                assert!(
                    mean_diff <= 5.0,
                    "{label} frame {frame}: diff {mean_diff:.3}/255"
                );
            }
        }
        let mut reversed = base.clone();
        reversed["timeline"]["clips"][1]["reverse"] = serde_json::json!(true);
        for frame in [12u64, 18, 24, 30] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &reversed,
                "b",
                frame,
                &dir,
            )
            .expect("ventana con reverse y transición");
            assert_eq!(window.composite_mode, "window", "reverse frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&reversed),
                "b",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("transición reverse frame {frame}: diff {mean_diff:.3}/255");
            assert!(
                mean_diff <= 5.0,
                "reverse frame {frame}: diff {mean_diff:.3}/255"
            );
        }
        for (label, opacity, animation) in [
            ("dissolve+opacity", Some((1.0, 0.5)), false),
            ("dissolve+animation", None, true),
        ] {
            let mut project = base.clone();
            if let Some((start, end)) = opacity {
                project["timeline"]["clips"][1]["transform"]["keyframes"][0]["opacity"] =
                    serde_json::json!(start);
                project["timeline"]["clips"][1]["transform"]["keyframes"][1]["opacity"] =
                    serde_json::json!(end);
            }
            if animation {
                project["timeline"]["clips"][1]["animationIn"] =
                    serde_json::json!({ "type": "slide-left", "durationFrames": 12 });
            }
            for frame in [12u64, 18, 24, 30] {
                let window = composite_frame(
                    Path::new("ffmpeg"),
                    Path::new("ffprobe"),
                    &dir,
                    &project,
                    "b",
                    frame,
                    &dir,
                )
                .expect("ventana combinada");
                assert_eq!(window.composite_mode, "window", "{label} frame {frame}");
                let full = render_composite_project(
                    Path::new("ffmpeg"),
                    Path::new("ffprobe"),
                    &dir,
                    &preview_copy(&project),
                    "b",
                    frame,
                    &dir,
                )
                .expect("compuesto completo");
                let fast = image::open(&window.path).expect("png ventana").to_rgb8();
                let reference = image::open(&full.path).expect("png completo").to_rgb8();
                let mut total = 0u64;
                let mut count = 0u64;
                for (left, right) in fast.pixels().zip(reference.pixels()) {
                    for channel in 0..3 {
                        total += left.0[channel].abs_diff(right.0[channel]) as u64;
                        count += 1;
                    }
                }
                let mean_diff = total as f64 / count.max(1) as f64;
                println!("transición {label} frame {frame}: diff {mean_diff:.3}/255");
                assert!(
                    mean_diff <= 5.0,
                    "{label} frame {frame}: diff {mean_diff:.3}/255"
                );
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn opacity_keyframes_use_the_window_and_match_full() {
        let dir = std::env::temp_dir().join(format!("editoria-opacity-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let source = media.join("gray.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0xB4B4B4:s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": {
                "width": 320, "height": 180,
                "frameRate": { "num": 30, "den": 1 },
                "backgroundColor": "#0f1319"
            },
            "assets": [{
                "id": "a", "kind": "video", "label": "Gris",
                "source": { "path": "media/gray.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Patrón",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
                    "transform": { "keyframes": [
                        { "frame": 0, "opacity": 0, "scale": 1, "rotationDeg": 0 },
                        { "frame": 30, "opacity": 1, "scale": 1.3, "rotationDeg": 90 }
                    ] }
                }]
            }
        });
        for frame in [3u64, 15, 24] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con opacidad");
            assert_eq!(window.composite_mode, "window", "frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("opacidad frame {frame}: diff {mean_diff:.3}/255");
            assert!(mean_diff <= 3.0, "frame {frame}: diff {mean_diff:.3}/255");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn clip_animations_use_the_window_and_match_full() {
        let dir = std::env::temp_dir().join(format!("editoria-animation-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let source = media.join("pattern.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": {
                "width": 320, "height": 180,
                "frameRate": { "num": 30, "den": 1 },
                "backgroundColor": "#0f1319"
            },
            "assets": [{
                "id": "a", "kind": "video", "label": "Patrón",
                "source": { "path": "media/pattern.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Patrón",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
                    "animationIn": { "type": "slide-left", "durationFrames": 12 },
                    "animationOut": { "type": "fade", "durationFrames": 12 }
                }]
            }
        });
        for frame in [3u64, 6, 24, 27] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con animación");
            assert_eq!(window.composite_mode, "window", "frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("animación frame {frame}: diff {mean_diff:.3}/255");
            assert!(mean_diff <= 3.0, "frame {frame}: diff {mean_diff:.3}/255");
        }
        let mut slide_out = project.clone();
        slide_out["timeline"]["clips"][0]["animationIn"] = serde_json::json!({});
        slide_out["timeline"]["clips"][0]["animationOut"] =
            serde_json::json!({ "type": "slide-right", "durationFrames": 12 });
        for frame in [24u64, 27] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &slide_out,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con slide de salida");
            assert_eq!(window.composite_mode, "window", "slide-out frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&slide_out),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("animación slide-out frame {frame}: diff {mean_diff:.3}/255");
            assert!(
                mean_diff <= 3.0,
                "slide-out frame {frame}: diff {mean_diff:.3}/255"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn reverse_clip_uses_the_window_and_matches_full() {
        let dir = std::env::temp_dir().join(format!("editoria-reverse-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let source = media.join("pattern.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Patrón",
                "source": { "path": "media/pattern.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Patrón",
                    "startFrame": 0, "durationFrames": 30, "reverse": true,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
                }]
            }
        });
        for frame in [0u64, 3, 15, 29] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con reverse");
            assert_eq!(window.composite_mode, "window", "frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("reverse frame {frame}: diff {mean_diff:.3}/255");
            assert!(mean_diff <= 3.0, "frame {frame}: diff {mean_diff:.3}/255");
        }
        let mut combined = project.clone();
        combined["timeline"]["clips"][0]["motion"] =
            serde_json::json!({ "type": "zoom-in", "intensity": 0.2 });
        combined["timeline"]["clips"][0]["transform"] = serde_json::json!({ "keyframes": [
            { "frame": 0, "scale": 1, "rotationDeg": 0 },
            { "frame": 30, "scale": 1.3, "rotationDeg": 90 }
        ] });
        for frame in [1u64, 15, 29] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &combined,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con reverse y transformación");
            assert_eq!(
                window.composite_mode, "window",
                "reverse+transform frame {frame}"
            );
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&combined),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("reverse+transform frame {frame}: diff {mean_diff:.3}/255");
            assert!(
                mean_diff <= 6.0,
                "reverse+transform frame {frame}: diff {mean_diff:.3}/255"
            );
        }
        let mut transformed = combined.clone();
        transformed["timeline"]["clips"][0]["reverse"] = serde_json::json!(false);
        for frame in [1u64, 15, 29] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &transformed,
                "c",
                frame,
                &dir,
            )
            .expect("ventana con transformación sin reverse");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&transformed),
                "c",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("transform sin reverse frame {frame}: diff {mean_diff:.3}/255");
            assert!(
                mean_diff <= 6.0,
                "transform sin reverse frame {frame}: diff {mean_diff:.3}/255"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn active_graphic_is_omitted_but_other_layers_compose() {
        let dir = std::env::temp_dir().join(format!("editoria-graphic-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let source = media.join("gray.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0xB4B4B4:s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Gris",
                "source": { "path": "media/gray.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 1 },
                    { "id": "g1", "kind": "graphic", "order": 2 }
                ],
                "clips": [
                    { "id": "v", "trackId": "v1", "kind": "video", "label": "Gris",
                      "startFrame": 0, "durationFrames": 30,
                      "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                    { "id": "g", "trackId": "g1", "kind": "graphic", "label": "Gráfico",
                      "startFrame": 0, "durationFrames": 30,
                      "source": { "type": "graphic" } }
                ]
            },
            "captions": { "cues": [] }
        });
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "v",
            15,
            &dir,
        )
        .expect("ventana con gráfico omitido");
        assert_eq!(window.composite_mode, "window");
        assert!(
            window
                .fallback_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("gráfico omitido")),
            "fallback: {:?}",
            window.fallback_reason
        );
        let mut reference_project = project.clone();
        reference_project["timeline"]["clips"] = serde_json::json!([{
            "id": "v", "trackId": "v1", "kind": "video", "label": "Gris",
            "startFrame": 0, "durationFrames": 30,
            "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
        }]);
        let reference = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&reference_project),
            "v",
            15,
            &dir,
        )
        .expect("compuesto sin gráfico");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let expected = image::open(&reference.path)
            .expect("png referencia")
            .to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(expected.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("gráfico omitido: diff {mean_diff:.3}/255");
        assert!(mean_diff <= 2.0, "diff {mean_diff:.3}/255");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn compound_clip_uses_the_window_and_matches_full() {
        let dir = std::env::temp_dir().join(format!("editoria-compound-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let source = media.join("gray.mp4");
        assert!(Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0xB4B4B4:s=320x180:r=30:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg fuente")
            .success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Gris",
                "source": { "path": "media/gray.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "outer", "trackId": "v1", "kind": "compound",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "compound", "compoundId": "c1" }
                }]
            },
            "compounds": [{
                "id": "c1", "durationFrames": 30,
                "clips": [{
                    "id": "inner", "trackId": "v1", "kind": "video",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
                }]
            }],
            "captions": { "cues": [] }
        });
        for frame in [3u64, 15, 29] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "outer",
                frame,
                &dir,
            )
            .expect("ventana con compuesto");
            assert_eq!(window.composite_mode, "window", "frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "outer",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("compuesto frame {frame}: diff {mean_diff:.3}/255");
            assert!(mean_diff <= 2.0, "frame {frame}: diff {mean_diff:.3}/255");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_scale_below_one_keeps_sharpness() {
        let dir = std::env::temp_dir().join(format!("editoria-scale-sharp-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let checker = media.join("checker.png");
        let mut pixels = Vec::with_capacity(320 * 180 * 3);
        for y in 0..180 {
            for x in 0..320 {
                let value = if ((x / 8) + (y / 8)) % 2 == 0 {
                    235u8
                } else {
                    20u8
                };
                pixels.extend_from_slice(&[value, value, value]);
            }
        }
        image::save_buffer(&checker, &pixels, 320, 180, image::ColorType::Rgb8).expect("png");
        let project = |transform: serde_json::Value| {
            serde_json::json!({
                "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
                "assets": [{
                    "id": "a", "kind": "image", "label": "Tablero",
                    "source": { "path": "media/checker.png" },
                    "status": "ready",
                    "rights": { "license": { "commercialUse": "allowed" } }
                }],
                "timeline": {
                    "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                    "clips": [{
                        "id": "c", "trackId": "v1", "kind": "image", "label": "Tablero",
                        "startFrame": 0, "durationFrames": 30,
                        "source": { "type": "asset", "assetId": "a" },
                        "transform": transform
                    }]
                }
            })
        };
        let dynamic = project(serde_json::json!({
            "keyframes": [
                { "frame": 0, "scale": 0.8 },
                { "frame": 30, "scale": 1.3 }
            ]
        }));
        // La curva en el frame 29 vale 0,8 + 0,5·29/30; la referencia estática
        // usa esa misma escala para comparar nitidez sin cambiar el tamaño.
        let reference_scale = 0.8 + 0.5 * (29.0 / 30.0);
        let reference = project(serde_json::json!({
            "scaleX": reference_scale,
            "scaleY": reference_scale
        }));
        let mut outputs = Vec::new();
        for (name, current) in [("dynamic", &dynamic), ("reference", &reference)] {
            let output = dir.join(format!("sharp-{name}.mp4"));
            let profile = profile_for(current).expect("perfil");
            let plan = build_plan(BuildPlanInput {
                audio_only: false,
                project: current,
                root: &dir,
                profile: &profile,
                output_path: &output,
                include_captions: false,
                temp_dir: &render_dir,
                ffprobe: Path::new("ffprobe"),
                motion_ass: None,
            })
            .expect("plan de nitidez");
            assert!(Command::new("ffmpeg")
                .args(&plan.args)
                .current_dir(&render_dir)
                .status()
                .expect("ffmpeg nitidez")
                .success());
            outputs.push(output);
        }
        let lapvar = |output: &Path, label: &str| -> f64 {
            let frame = dir.join(format!("sharp-{label}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", "0.966", "-i"])
                .arg(output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame nitidez")
                .success());
            let image = image::open(&frame).expect("png nitidez").to_rgb8();
            let mut count = 0.0;
            let mut sum = 0.0;
            let mut sum2 = 0.0;
            for y in 21..159 {
                for x in 41..279 {
                    let luma = |x: u32, y: u32| -> f64 {
                        let pixel = image.get_pixel(x, y).0;
                        (pixel[0] as f64 + pixel[1] as f64 + pixel[2] as f64) / 3.0
                    };
                    let center = luma(x, y);
                    let laplacian = -4.0 * center
                        + luma(x - 1, y)
                        + luma(x + 1, y)
                        + luma(x, y - 1)
                        + luma(x, y + 1);
                    count += 1.0;
                    sum += laplacian;
                    sum2 += laplacian * laplacian;
                }
            }
            sum2 / count - (sum / count).powi(2)
        };
        let dynamic_var = lapvar(&outputs[0], "dynamic");
        let reference_var = lapvar(&outputs[1], "reference");
        println!(
            "nitidez escala <1: dinámica {dynamic_var:.1} · referencia {reference_var:.1} · ratio {:.3}",
            dynamic_var / reference_var.max(1.0)
        );
        assert!(
            dynamic_var > reference_var * 0.7,
            "la escala dinámica perdió nitidez: {dynamic_var:.1} vs {reference_var:.1}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe en PATH"]
    fn live_fade_export_is_linear_and_blends_with_background() {
        let dir = std::env::temp_dir().join(format!("editoria-fade-export-{}", Uuid::new_v4()));
        let media = dir.join("media");
        let render_dir = dir.join("render");
        std::fs::create_dir_all(&media).expect("media");
        std::fs::create_dir_all(&render_dir).expect("render");
        let image_path = media.join("gray.png");
        image::save_buffer(
            &image_path,
            &vec![180u8; 320 * 180 * 3],
            320,
            180,
            image::ColorType::Rgb8,
        )
        .expect("png");
        let project = serde_json::json!({
            "video": {
                "width": 320, "height": 180,
                "frameRate": { "num": 30, "den": 1 },
                "backgroundColor": "#0f1319"
            },
            "assets": [{
                "id": "a", "kind": "image", "label": "Gris",
                "source": { "path": "media/gray.png" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "image", "label": "Gris",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a" },
                    "effects": { "fadeInFrames": 12, "fadeOutFrames": 12 }
                }]
            }
        });
        let output = dir.join("fade.mp4");
        let profile = profile_for(&project).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan de fade");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg fade")
            .success());
        // 12 frames de fade: 25% de alfa en el frame 3, 100% al terminar y 50%
        // en el 24, mezclando el gris 180 con el fondo #0f1319.
        for (time, expected) in [(0.1_f64, 56.0), (0.4, 180.0), (0.8, 98.0)] {
            let frame = dir.join(format!("fade-{time:.3}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                .arg(&output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame")
                .success());
            let image = image::open(&frame).expect("png").to_rgb8();
            let pixel = image.get_pixel(160, 90).0;
            println!("fade export {time:.2}s: {pixel:?}, esperado {expected:.0}");
            assert!(
                (pixel[0] as f64 - expected).abs() <= 4.0,
                "frame {time:.2}s: {pixel:?}, esperado {expected:.0}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn native_profile_keeps_even_dimensions() {
        let profile = Profile {
            id: "p".into(),
            name: "p".into(),
            width: 1920,
            height: 1080,
            fps_num: 30,
            fps_den: 1,
            crf: None,
            target_bps: None,
            video_preset: "veryfast".into(),
            fit: "contain".into(),
            audio_bps: 128_000,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1,
            duration_tolerance_frames: 1,
            hardware_encoder: None,
        };
        let native = at_dimensions(&profile, 3841, 2161);
        assert_eq!((native.width, native.height), (3840, 2160));
        assert_eq!(native.id, "preview-native");
    }

    #[test]
    #[ignore = "requiere FFmpeg/FFprobe y las DLLs de FFmpeg en PATH"]
    fn live_native_frame_honours_display_rotation() {
        let dir = std::env::temp_dir().join(format!("editoria-rotated-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let base = media.join("base.mp4");
        let rotated = media.join("rotated.mp4");
        let generated = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=640x360:d=1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&base)
            .status()
            .expect("ffmpeg");
        assert!(generated.success());
        let rotated_ok = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-display_rotation", "90", "-i"])
            .arg(&base)
            .args(["-c", "copy"])
            .arg(&rotated)
            .status()
            .expect("ffmpeg rotation");
        assert!(rotated_ok.success());
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Toma",
                "source": { "path": "media/rotated.mp4" },
                "media": { "width": 640, "height": 360 }
            }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "startFrame": 0,
                "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
            }] }
        });
        let result = render_frame(Path::new("ffmpeg"), &dir, &project, "c", 10, true, &dir)
            .expect("frame rotado");
        assert!(result.native);
        assert_eq!((result.width, result.height), (360, 640));
        assert_eq!(result.decoder, "ffmpeg");
        println!(
            "preview rotado: {} {}x{} con {}",
            result.path, result.width, result.height, result.decoder
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn display_dimensions_apply_sar_and_quarter_turns() {
        let base = SourceProbe {
            width: 1920,
            height: 1080,
            rotation_degrees: 0.0,
            sample_aspect: 1.0,
        };
        assert_eq!(display_dimensions(&base), (1920, 1080));
        let quarter = SourceProbe {
            rotation_degrees: 90.0,
            ..base
        };
        assert_eq!(display_dimensions(&quarter), (1080, 1920));
        let negative = SourceProbe {
            rotation_degrees: -90.0,
            ..base
        };
        assert_eq!(display_dimensions(&negative), (1080, 1920));
        let half = SourceProbe {
            rotation_degrees: 180.0,
            ..base
        };
        assert_eq!(display_dimensions(&half), (1920, 1080));
        let anamorphic = SourceProbe {
            width: 720,
            height: 480,
            rotation_degrees: 0.0,
            sample_aspect: 4.0 / 3.0,
        };
        assert_eq!(display_dimensions(&anamorphic), (960, 480));
        let rotated_anamorphic = SourceProbe {
            rotation_degrees: 90.0,
            ..anamorphic
        };
        assert_eq!(display_dimensions(&rotated_anamorphic), (480, 960));
    }

    #[test]
    fn graphic_clips_are_rejected() {
        let project = serde_json::json!({
            "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "timeline": { "clips": [{ "id": "g", "kind": "graphic", "startFrame": 0, "durationFrames": 30 }] },
            "assets": []
        });
        let result = render_frame(
            Path::new("ffmpeg"),
            Path::new("."),
            &project,
            "g",
            0,
            false,
            Path::new("."),
        );
        assert!(result.is_err());
    }
}
