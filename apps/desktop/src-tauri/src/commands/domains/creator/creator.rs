//! Módulos internos de creador: hooks, exportación multiplataforma, CTA con QR
//! y B-roll. Todo corre con FFmpeg local y devuelve salidas MP4 verificables.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use image::{GrayImage, Luma};
use qrcodegen::{QrCode, QrCodeEcc};
use serde::{Deserialize, Serialize};
use tauri::State;
use thiserror::Error;
use tokio::task::JoinSet;
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Error)]
enum CreatorError {
    #[error("{0}")]
    Invalid(String),
    #[error("no se pudo ejecutar FFmpeg: {0}")]
    Ffmpeg(String),
    #[error("no se pudo leer el video: {0}")]
    Probe(String),
    #[error("QR inválido: {0}")]
    Qr(String),
    #[error("error de E/S: {0}")]
    Io(#[from] std::io::Error),
}

impl From<CreatorError> for ProjectError {
    fn from(error: CreatorError) -> Self {
        let code = match &error {
            CreatorError::Ffmpeg(_) => ProjectErrorCode::ProviderUnavailable,
            CreatorError::Io(_) => ProjectErrorCode::Io,
            _ => ProjectErrorCode::InvalidProject,
        };
        ProjectError::message(code, &error.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorOutput {
    pub path: String,
    pub kind: String,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy)]
struct VideoInfo {
    width: u32,
    height: u32,
    fps: f64,
    duration: f64,
    has_audio: bool,
}

struct TempWorkspace {
    path: PathBuf,
}

impl TempWorkspace {
    fn new(prefix: &str) -> Result<Self, CreatorError> {
        let path = std::env::temp_dir().join(format!("olyvia-{prefix}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn tools(state: &AppState) -> Result<(PathBuf, PathBuf), CreatorError> {
    let settings = state
        .settings_snapshot()
        .map_err(|error| CreatorError::Invalid(error.message))?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        CreatorError::Invalid("FFmpeg no está disponible; configuralo en Ajustes.".into())
    })?;
    let ffprobe = ffprobe.ok_or_else(|| {
        CreatorError::Invalid("FFprobe no está disponible; configuralo en Ajustes.".into())
    })?;
    Ok((ffmpeg, ffprobe))
}

fn require_file(value: &str, label: &str) -> Result<PathBuf, CreatorError> {
    let path = PathBuf::from(value.trim());
    if !path.is_file() {
        return Err(CreatorError::Invalid(format!(
            "{label} no existe o no es un archivo: {}",
            path.display()
        )));
    }
    Ok(path)
}

fn output_mp4(value: &str) -> Result<PathBuf, CreatorError> {
    let raw = PathBuf::from(value.trim());
    if raw.as_os_str().is_empty() {
        return Err(CreatorError::Invalid("Falta la ruta de salida.".into()));
    }
    let path = if raw
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
    {
        raw
    } else {
        raw.with_extension("mp4")
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(path)
}

fn tail(text: &str) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    chars[chars.len().saturating_sub(1_600)..].iter().collect()
}

fn run_ffmpeg(ffmpeg: &Path, args: &[String], cwd: &Path) -> Result<(), CreatorError> {
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-v", "error", "-y"])
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        return Err(CreatorError::Ffmpeg(tail(&String::from_utf8_lossy(
            &output.stderr,
        ))));
    }
    Ok(())
}

fn probe_video(ffprobe: &Path, input: &Path) -> Result<VideoInfo, CreatorError> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
        ])
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        return Err(CreatorError::Probe("FFprobe rechazó el archivo.".into()));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| CreatorError::Probe("FFprobe devolvió JSON inválido.".into()))?;
    let streams = value["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|stream| stream["codec_type"].as_str() == Some("video"))
        .ok_or_else(|| CreatorError::Probe("el archivo no tiene pista de video.".into()))?;
    let width = video["width"].as_u64().unwrap_or(0) as u32;
    let height = video["height"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 {
        return Err(CreatorError::Probe(
            "no se pudieron medir las dimensiones.".into(),
        ));
    }
    let fps = video["avg_frame_rate"]
        .as_str()
        .and_then(parse_rate)
        .or_else(|| video["r_frame_rate"].as_str().and_then(parse_rate))
        .filter(|fps| *fps > 0.1)
        .unwrap_or(30.0)
        .clamp(1.0, 120.0);
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .or_else(|| {
            video["duration"]
                .as_str()
                .and_then(|value| value.parse().ok())
        })
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .ok_or_else(|| CreatorError::Probe("no se pudo medir la duración.".into()))?;
    let has_audio = streams
        .iter()
        .any(|stream| stream["codec_type"].as_str() == Some("audio"));
    Ok(VideoInfo {
        width,
        height,
        fps,
        duration,
        has_audio,
    })
}

fn parse_rate(value: &str) -> Option<f64> {
    let (num, den) = value.split_once('/')?;
    let num = num.parse::<f64>().ok()?;
    let den = den.parse::<f64>().ok()?;
    (den > 0.0).then_some(num / den)
}

fn metadata_output(
    path: PathBuf,
    kind: &str,
    width: u32,
    height: u32,
    duration: f64,
) -> Result<CreatorOutput, CreatorError> {
    let bytes = std::fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if bytes == 0 {
        return Err(CreatorError::Invalid(
            "FFmpeg terminó sin un archivo válido.".into(),
        ));
    }
    Ok(CreatorOutput {
        path: path.to_string_lossy().into_owned(),
        kind: kind.to_owned(),
        width,
        height,
        duration_seconds: duration,
        bytes,
    })
}

fn ass_text(raw: &str) -> String {
    let mut text = raw
        .replace('\\', "/")
        .replace('{', "（")
        .replace('}', "）")
        .replace('\n', "\\N")
        .replace('\r', "");
    while text.contains("  ") {
        text = text.replace("  ", " ");
    }
    text.trim().chars().take(220).collect()
}

fn ass_time(seconds: f64) -> String {
    let centis = (seconds.max(0.0) * 100.0).round() as u64;
    let hours = centis / 360_000;
    let minutes = (centis % 360_000) / 6_000;
    let secs = (centis % 6_000) / 100;
    let cs = centis % 100;
    format!("{hours}:{minutes:02}:{secs:02}.{cs:02}")
}

fn write_ass(
    path: &Path,
    width: u32,
    height: u32,
    style: &str,
    event: &str,
) -> Result<(), CreatorError> {
    let content = format!(
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: {style}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n{event}\n"
    );
    std::fs::write(path, content)?;
    Ok(())
}

fn write_hook_ass(path: &Path, width: u32, height: u32, text: &str) -> Result<(), CreatorError> {
    let size = ((height as f64) * 0.064).round().clamp(34.0, 96.0) as u32;
    let style = format!(
        "Hook,Segoe UI,{size},&H00FFFFFF,&H000000FF,&H00000000,&H78000000,-1,0,0,0,100,100,0,0,3,10,3,5,90,90,90,1"
    );
    let event = format!(
        "Dialogue: 0,{},{},Hook,,0,0,0,,{{\\an5\\pos({},{})\\fad(250,250)}}{}",
        ass_time(0.0),
        ass_time(3.0),
        width / 2,
        height / 2,
        ass_text(text)
    );
    write_ass(path, width, height, &style, &event)
}

fn write_cta_ass(
    path: &Path,
    width: u32,
    height: u32,
    text: &str,
    start: f64,
    end: f64,
    qr: bool,
    qr_size: u32,
) -> Result<(), CreatorError> {
    let size = ((height as f64) * 0.036).round().clamp(24.0, 56.0) as u32;
    let style = format!(
        "Cta,Segoe UI,{size},&H00FFFFFF,&H000000FF,&H00000000,&H70000000,-1,0,0,0,100,100,0,0,3,9,2,2,60,60,60,1"
    );
    let x = if qr {
        (width as i64 / 2 - qr_size as i64 / 2 - 24).max(60)
    } else {
        width as i64 / 2
    };
    let event = format!(
        "Dialogue: 0,{},{},Cta,,0,0,0,,{{\\an2\\pos({},{})\\fad(200,200)}}{}",
        ass_time(start),
        ass_time(end),
        x,
        height.saturating_sub(70),
        ass_text(text)
    );
    write_ass(path, width, height, &style, &event)
}

fn write_qr_png(path: &Path, data: &str) -> Result<(), CreatorError> {
    let code = QrCode::encode_text(data, QrCodeEcc::Medium)
        .map_err(|error| CreatorError::Qr(format!("{error:?}")))?;
    let border = 3i32;
    let scale = 8u32;
    let modules = code.size() + border * 2;
    let dimension = modules.max(1) as u32 * scale;
    let mut image = GrayImage::from_pixel(dimension, dimension, Luma([255]));
    for y in 0..code.size() {
        for x in 0..code.size() {
            if code.get_module(x, y) {
                for dy in 0..scale {
                    for dx in 0..scale {
                        let px = (x + border) as u32 * scale + dx;
                        let py = (y + border) as u32 * scale + dy;
                        image.put_pixel(px, py, Luma([0]));
                    }
                }
            }
        }
    }
    image
        .save(path)
        .map_err(|error| CreatorError::Qr(error.to_string()))?;
    Ok(())
}

fn even(value: u32) -> u32 {
    (value.max(2) / 2) * 2
}

fn hook_filter(info: VideoInfo, hook_len: f64, zoom: f64) -> String {
    let width = even(info.width);
    let height = even(info.height);
    let fps = info.fps.clamp(1.0, 120.0);
    let frames = (hook_len * fps).round().max(1.0);
    let zoom_max = 1.0 + zoom.clamp(0.02, 0.25);
    let zoompan = format!(
        "zoompan=z='min(1+{:.4}*on/{:.0},{:.4})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={width}x{height}:fps={fps:.3}",
        zoom_max - 1.0,
        frames,
        zoom_max
    );
    if info.duration > hook_len + 0.2 {
        format!(
            "[0:v]trim=0:{hook_len:.3},setpts=PTS-STARTPTS,{zoompan}[v0];[0:v]trim=start={hook_len:.3},setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[vc];[vc]ass=hook.ass[v]"
        )
    } else {
        format!("[0:v]{zoompan}[vc];[vc]ass=hook.ass[v]")
    }
}

fn hook_audio_filter(has_audio: bool, gain: f64, duration: f64) -> String {
    let whoosh = format!(
        "[1:a]highpass=f=260,lowpass=f=6200,afade=t=in:st=0:d=0.7,afade=t=out:st=1.1:d=1.9,volume={gain:.3}[whoosh]"
    );
    if has_audio {
        "[0:a]anull[main];[main][whoosh]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]".to_string()
    } else {
        format!("{whoosh};[whoosh]apad,atrim=0:{duration:.3},asetpts=N/SR/TB[a]")
    }
}

include!("creator/hook.rs");
include!("creator/cta.rs");
include!("creator/aspect.rs");
include!("creator/broll.rs");
include!("creator/chapters.rs");
include!("creator/subtitles.rs");

#[cfg(test)]
#[path = "creator.tests.rs"]
mod tests;
