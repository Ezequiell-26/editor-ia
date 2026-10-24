//! Preview real de un frame del clip activo.
//!
//! No es el compuesto completo de todas las pistas: renderiza el clip visual
//! seleccionado con su color, máscara, relight, lente, LUT y transformación
//! usando el mismo `visual_filter` del render final. Sirve para comparar la
//! aproximación CSS con lo que FFmpeg va a producir, sin exportar el video.

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
use crate::render::ffmpeg::{apply_lut_to_chain, effects_lut, visual_filter, Profile};
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
        command
            .args(["-ss", &format!("{time:.3}"), "-i"])
            .arg(&source);
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
    })
}

/// Genera un PNG del clip activo en el frame pedido, con el renderer real.
#[tauri::command]
pub async fn render_preview_frame(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PreviewFrameRequest,
) -> Result<PreviewFrameResult, ProjectError> {
    let session = state.require_session()?;
    let root = session.root.clone();
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para el preview real",
        ));
    };
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
    tauri::async_runtime::spawn_blocking(move || {
        render_frame(
            &ffmpeg,
            &root,
            &project,
            &clip_id,
            frame,
            native,
            &output_dir,
        )
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
