use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::State;

use crate::media::stickman::{
    plan_stickman_render, pose_at, render_frame, ParticleSpec, PoseKeyframe,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use crate::commands::system::resolve_tools;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickmanRenderRequest {
    pub output_path: String,
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default = "default_duration")]
    pub duration_seconds: f64,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default)]
    pub keyframes: Vec<PoseKeyframe>,
    #[serde(default)]
    pub bone_hex: Option<String>,
    #[serde(default)]
    pub bg_hex: Option<String>,
    /// Sistema de partículas opcional sobre la animación.
    #[serde(default)]
    pub particles: Option<ParticleSpec>,
}

fn default_action() -> String {
    "idle".into()
}
fn default_duration() -> f64 {
    4.0
}
fn default_fps() -> u32 {
    24
}
fn default_width() -> u32 {
    640
}
fn default_height() -> u32 {
    360
}

fn resolve_ffmpeg(settings: &crate::state::Settings) -> Result<PathBuf, ProjectError> {
    resolve_tools(settings).0.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se encontró FFmpeg configurado",
        )
    })
}

/// Medición real del MP4 con ffprobe (mismo helper que screen_record).
fn probe_output(
    ffprobe: &Path,
    output: &Path,
) -> (Option<f64>, Option<u32>, Option<u32>, Option<bool>) {
    let probed = std::process::Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height",
            "-of",
            "json",
            &output.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(out) = probed else {
        return (None, None, None, None);
    };
    if !out.status.success() {
        return (None, None, None, None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return (None, None, None, None),
    };
    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok());
    let streams = json["streams"].as_array();
    let mut width = None;
    let mut height = None;
    let mut has_audio = false;
    for stream in streams.into_iter().flatten() {
        match stream["codec_type"].as_str() {
            Some("video") => {
                width = stream["width"].as_u64().map(|v| v as u32);
                height = stream["height"].as_u64().map(|v| v as u32);
            }
            Some("audio") => has_audio = true,
            _ => {}
        }
    }
    (duration, width, height, Some(has_audio))
}

/// Genera un video MP4 de un personaje stickman articulado.
///
/// Escribe los cuadros PNG en `<temp>/stickman-frames`, codifica con el
/// FFmpeg del proyecto (`libopenh264`/`h264_mf` según disponibilidad) y
/// verifica el resultado con ffprobe antes de responder.
#[tauri::command]
pub async fn stickman_render(
    state: State<'_, AppState>,
    request: StickmanRenderRequest,
) -> Result<serde_json::Value, ProjectError> {
    let max_keyframe = request
        .keyframes
        .iter()
        .map(|k| k.frame)
        .max()
        .unwrap_or(0);
    let plan = plan_stickman_render(
        &request.action,
        !request.keyframes.is_empty(),
        max_keyframe,
        request.keyframes.len(),
        request.particles.as_ref(),
        request.fps,
        request.width,
        request.height,
        request.duration_seconds,
        &request.output_path,
        request.bone_hex.as_deref(),
        request.bg_hex.as_deref(),
    )?;
    let action = plan.action;
    let fps = plan.fps;
    let width = plan.width;
    let height = plan.height;
    let duration = plan.duration;
    let total_frames = plan.total_frames;
    let bone = plan.bone;
    let bg = plan.bg;

    let output = crate::application::fs::validate_user_write_path(&request.output_path)?;
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo crear la carpeta de salida: {e}"),
            )
        })?;
    }

    let frames_dir = std::env::temp_dir().join(format!("stickman-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&frames_dir).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo crear el temporal: {e}"),
        )
    })?;

    // 1) Rasterizar cada cuadro a PNG.
    for frame in 0..total_frames {
        let pose = pose_at(&action, frame, fps as f64, &request.keyframes);
        let rgb = render_frame(
            &pose,
            width as usize,
            height as usize,
            bone,
            bg,
            request.particles.as_ref(),
            frame,
            fps,
        );
        let path = frames_dir.join(format!("frame_{frame:05}.png"));
        image::save_buffer(&path, &rgb, width, height, image::ColorType::Rgb8).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo escribir el cuadro {frame}: {e}"),
            )
        })?;
    }

    // 2) Codificar con FFmpeg del proyecto.
    let settings = state.settings_snapshot()?;
    let ffmpeg = resolve_ffmpeg(&settings)?;
    let pattern = frames_dir.join("frame_%05d.png");
    let tmp_out = output.with_extension("tmp.mp4");
    // libopenh264 es el default LGPL-safe del bundle; si el runtime no puede
    // cargarlo se reintenta con MediaFoundation (patrón usado por render).
    let mut encoded = false;
    let mut last_err = String::new();
    for encoder in ["libopenh264", "h264_mf"] {
        let out = std::process::Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-framerate",
                &fps.to_string(),
                "-i",
                &pattern.to_string_lossy(),
                "-c:v",
                encoder,
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                &tmp_out.to_string_lossy(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo ejecutar FFmpeg: {e}"),
                )
            })?;
        if out.status.success() {
            encoded = true;
            break;
        }
        last_err = String::from_utf8_lossy(&out.stderr)
            .chars()
            .take(400)
            .collect();
        let _ = std::fs::remove_file(&tmp_out);
    }
    if !encoded {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("FFmpeg no pudo codificar la animación stickman: {last_err}"),
        ));
    }
    std::fs::rename(&tmp_out, &output).map_err(|e| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo publicar el video: {e}"),
        )
    })?;

    // 3) Verificar con ffprobe real (mismo patrón que screen_record).
    let (ffprobe, _, _) = (resolve_tools(&settings).1, (), ());
    let ffprobe = ffprobe.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se encontró FFprobe",
        )
    })?;
    let (duration_s, w_s, h_s, has_audio) = probe_output(&ffprobe, &output);
    let _ = std::fs::remove_dir_all(&frames_dir);

    Ok(serde_json::json!({
        "ok": true,
        "path": output.to_string_lossy(),
        "action": if request.keyframes.is_empty() { action } else { "custom".to_string() },
        "frames": total_frames,
        "fps": fps,
        "width": width,
        "height": height,
        "durationSeconds": duration_s.unwrap_or(duration),
        "probeWidth": w_s,
        "probeHeight": h_s,
        "hasAudio": has_audio.unwrap_or(false),
        "verified": duration_s.is_some(),
    }))
}
