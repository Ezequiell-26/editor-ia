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
        format!("[0:a]anull[main];[main][whoosh]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]")
    } else {
        format!("{whoosh};[whoosh]apad,atrim=0:{duration:.3},asetpts=N/SR/TB[a]")
    }
}

fn hook_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    text: &str,
    zoom: f64,
    gain_db: f64,
) -> Result<CreatorOutput, CreatorError> {
    if text.trim().is_empty() {
        return Err(CreatorError::Invalid("Escribí el texto del hook.".into()));
    }
    let info = probe_video(ffprobe, input)?;
    let workspace = TempWorkspace::new("hook")?;
    write_hook_ass(
        &workspace.path.join("hook.ass"),
        even(info.width),
        even(info.height),
        text,
    )?;
    let hook_len = 3.0_f64.min(info.duration);
    let gain = 10f64
        .powf(gain_db.clamp(-36.0, -6.0) / 20.0)
        .clamp(0.02, 0.5);
    let graph = format!(
        "{};{}",
        hook_filter(info, hook_len, zoom),
        hook_audio_filter(info.has_audio, gain, info.duration)
    );
    let args = vec![
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "anoisesrc=color=pink:duration=3:sample_rate=48000".into(),
        "-filter_complex".into(),
        graph,
        "-map".into(),
        "[v]".into(),
        "-map".into(),
        "[a]".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "fast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-shortest".into(),
        output.to_string_lossy().into_owned(),
    ];
    run_ffmpeg(ffmpeg, &args, &workspace.path)?;
    metadata_output(
        output.to_path_buf(),
        "hook",
        even(info.width),
        even(info.height),
        info.duration,
    )
}

#[tauri::command]
pub async fn creator_inject_hook(
    state: State<'_, AppState>,
    input_path: String,
    output_path: String,
    hook_text: String,
    zoom_percent: Option<f64>,
    sound_gain_db: Option<f64>,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output = output_mp4(&output_path)?;
    let text = hook_text;
    let zoom = zoom_percent.unwrap_or(10.0) / 100.0;
    let gain = sound_gain_db.unwrap_or(-16.0);
    tauri::async_runtime::spawn_blocking(move || {
        hook_blocking(&ffmpeg, &ffprobe, &input, &output, &text, zoom, gain)
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El hook se interrumpió."))?
    .map_err(Into::into)
}

fn qr_overlay_graph(qr_size: u32, start: f64, end: f64) -> String {
    format!(
        "[1:v]scale={qr_size}:{qr_size}:flags=neighbor[qr];[vc][qr]overlay=W-w-40:H-h-40:enable='between(t,{start:.3},{end:.3})'[v]"
    )
}

fn cta_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    text: &str,
    url: &str,
    seconds: f64,
    add_qr: bool,
) -> Result<CreatorOutput, CreatorError> {
    if text.trim().is_empty() {
        return Err(CreatorError::Invalid("Escribí el texto del CTA.".into()));
    }
    if add_qr && url.trim().is_empty() {
        return Err(CreatorError::Invalid(
            "El QR necesita una URL o un texto para codificar.".into(),
        ));
    }
    let info = probe_video(ffprobe, input)?;
    let workspace = TempWorkspace::new("cta")?;
    let width = even(info.width);
    let height = even(info.height);
    let start = (info.duration - seconds.clamp(3.0, 5.0)).max(0.0);
    let qr_size = ((height as f64 * 0.20).round() as u32).clamp(140, 260);
    write_cta_ass(
        &workspace.path.join("cta.ass"),
        width,
        height,
        text,
        start,
        info.duration,
        add_qr,
        qr_size,
    )?;
    let mut args = vec!["-i".into(), input.to_string_lossy().into_owned()];
    if add_qr {
        let qr_path = workspace.path.join("qr.png");
        write_qr_png(&qr_path, url.trim())?;
        args.push("-loop".into());
        args.push("1".into());
        args.push("-i".into());
        args.push(qr_path.to_string_lossy().into_owned());
    }
    let graph = if add_qr {
        format!(
            "[0:v]scale={width}:{height},ass=cta.ass[vc];{}",
            qr_overlay_graph(qr_size, start, info.duration)
        )
    } else {
        format!("[0:v]scale={width}:{height},ass=cta.ass[v]")
    };
    args.extend([
        "-filter_complex".into(),
        graph,
        "-map".into(),
        "[v]".into(),
        "-map".into(),
        "0:a?".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "fast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-t".into(),
        format!("{:.3}", info.duration),
        output.to_string_lossy().into_owned(),
    ]);
    run_ffmpeg(ffmpeg, &args, &workspace.path)?;
    metadata_output(output.to_path_buf(), "cta", width, height, info.duration)
}

#[tauri::command]
pub async fn creator_inject_cta(
    state: State<'_, AppState>,
    input_path: String,
    output_path: String,
    cta_text: String,
    url: String,
    cta_seconds: Option<f64>,
    add_qr: Option<bool>,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output = output_mp4(&output_path)?;
    let seconds = cta_seconds.unwrap_or(4.0);
    let add_qr = add_qr.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        cta_blocking(
            &ffmpeg, &ffprobe, &input, &output, &cta_text, &url, seconds, add_qr,
        )
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El CTA se interrumpió."))?
    .map_err(Into::into)
}

#[derive(Debug, Clone, Copy)]
enum Aspect {
    Vertical,
    Horizontal,
    Square,
}

impl Aspect {
    fn from_key(key: &str) -> Option<Self> {
        match key.trim().to_ascii_lowercase().as_str() {
            "vertical" | "9:16" | "916" => Some(Self::Vertical),
            "horizontal" | "16:9" | "169" => Some(Self::Horizontal),
            "square" | "1:1" | "11" => Some(Self::Square),
            _ => None,
        }
    }

    fn dimensions(self) -> (u32, u32) {
        match self {
            Self::Vertical => (1080, 1920),
            Self::Horizontal => (1920, 1080),
            Self::Square => (1080, 1080),
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Vertical => "vertical",
            Self::Horizontal => "horizontal",
            Self::Square => "square",
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::Vertical => "vertical-9x16",
            Self::Horizontal => "horizontal-16x9",
            Self::Square => "square-1x1",
        }
    }
}

fn aspect_filter(aspect: Aspect) -> String {
    let (width, height) = aspect.dimensions();
    match aspect {
        Aspect::Horizontal => format!(
            "[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=yuv420p[v]"
        ),
        Aspect::Vertical | Aspect::Square => format!(
            "[0:v]split=2[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},gblur=sigma=28[bgv];[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[fgv];[bgv][fgv]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]"
        ),
    }
}

fn render_aspect(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    aspect: Aspect,
    duration: f64,
    audio_copy: bool,
    has_audio: bool,
) -> Result<CreatorOutput, CreatorError> {
    let (width, height) = aspect.dimensions();
    let mut args = vec![
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-filter_complex".into(),
        aspect_filter(aspect),
        "-map".into(),
        "[v]".into(),
    ];
    if has_audio {
        args.extend([
            "-map".into(),
            "0:a?".into(),
            "-c:a".into(),
            if audio_copy {
                "copy".into()
            } else {
                "aac".into()
            },
            "-b:a".into(),
            "192k".into(),
        ]);
    } else {
        args.push("-an".into());
    }
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        output.to_string_lossy().into_owned(),
    ]);
    run_ffmpeg(
        ffmpeg,
        &args,
        output.parent().unwrap_or_else(|| Path::new(".")),
    )?;
    metadata_output(output.to_path_buf(), aspect.key(), width, height, duration)
}

async fn aspect_blocking(
    ffmpeg: &Path,
    input: &Path,
    output_dir: &Path,
    aspects: Vec<Aspect>,
    duration: f64,
    has_audio: bool,
) -> Result<Vec<CreatorOutput>, CreatorError> {
    std::fs::create_dir_all(output_dir)?;
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let mut set: JoinSet<Result<CreatorOutput, CreatorError>> = JoinSet::new();
    for aspect in aspects {
        let ffmpeg = ffmpeg.to_path_buf();
        let input = input.to_path_buf();
        let output = output_dir.join(format!("{stem}-{}.mp4", aspect.suffix()));
        set.spawn_blocking(move || {
            let first = render_aspect(
                &ffmpeg, &input, &output, aspect, duration, has_audio, has_audio,
            );
            match first {
                Ok(output) => Ok(output),
                Err(_) if has_audio => {
                    render_aspect(&ffmpeg, &input, &output, aspect, duration, false, has_audio)
                }
                Err(error) => Err(error),
            }
        });
    }
    let mut outputs = Vec::new();
    while let Some(joined) = set.join_next().await {
        let output = joined
            .map_err(|_| CreatorError::Invalid("una exportación se interrumpió.".into()))??;
        outputs.push(output);
    }
    outputs.sort_by(|left, right| left.kind.cmp(&right.kind));
    if outputs.is_empty() {
        return Err(CreatorError::Invalid(
            "No se pidió ninguna relación de aspecto.".into(),
        ));
    }
    Ok(outputs)
}

#[tauri::command]
pub async fn creator_export_multi_aspect(
    state: State<'_, AppState>,
    input_path: String,
    output_dir: String,
    aspects: Option<Vec<String>>,
) -> Result<Vec<CreatorOutput>, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output_dir = PathBuf::from(output_dir.trim());
    if output_dir.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "Elegí una carpeta de salida.",
        ));
    }
    let wanted =
        aspects.unwrap_or_else(|| vec!["vertical".into(), "horizontal".into(), "square".into()]);
    let mut parsed = Vec::new();
    for key in wanted {
        let aspect = Aspect::from_key(&key).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("Relación de aspecto desconocida: {key}"),
            )
        })?;
        if !parsed
            .iter()
            .any(|item: &Aspect| item.key() == aspect.key())
        {
            parsed.push(aspect);
        }
    }
    let info = tauri::async_runtime::spawn_blocking(move || probe_video(&ffprobe, &input))
        .await
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "La medición se interrumpió."))?
        .map_err(ProjectError::from)?;
    let input = require_file(&input_path, "El video de entrada")?;
    aspect_blocking(
        &ffmpeg,
        &input,
        &output_dir,
        parsed,
        info.duration,
        info.has_audio,
    )
    .await
    .map_err(Into::into)
}

#[derive(Debug, Clone, Copy)]
struct Cut {
    start: f64,
    duration: f64,
    broll_index: usize,
}

fn plan_cuts(duration: f64, interval: f64, clip: f64, max: usize, broll_count: usize) -> Vec<Cut> {
    if broll_count == 0 || duration <= 2.0 {
        return Vec::new();
    }
    let interval = interval.clamp(2.0, 60.0);
    let clip = clip.clamp(1.0, 3.0);
    let mut cuts = Vec::new();
    let mut at = interval;
    while cuts.len() < max.min(20) && at + clip + 0.4 < duration {
        cuts.push(Cut {
            start: at,
            duration: clip,
            broll_index: cuts.len() % broll_count,
        });
        at += interval;
    }
    cuts
}

fn broll_filter(info: VideoInfo, cuts: &[Cut]) -> String {
    let width = even(info.width);
    let height = even(info.height);
    let fps = info.fps.clamp(1.0, 120.0);
    let mut graph = Vec::new();
    let mut video_inputs = Vec::new();
    let mut audio_inputs = Vec::new();
    let mut prev = 0.0;
    for (index, cut) in cuts.iter().enumerate() {
        let start = cut.start;
        let after = cut.start + cut.duration;
        graph.push(format!(
            "[0:v]trim=start={prev:.3}:end={start:.3},setpts=PTS-STARTPTS[v{index}]"
        ));
        video_inputs.push(format!("[v{index}]"));
        graph.push(format!(
            "[{}:v]trim=0:{:.3},setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},fps={fps:.3},setsar=1[b{index}]",
            index + 1,
            cut.duration
        ));
        video_inputs.push(format!("[b{index}]"));
        if info.has_audio {
            graph.push(format!(
                "[0:a]atrim=start={prev:.3}:end={start:.3},asetpts=PTS-STARTPTS[a{index}]"
            ));
            audio_inputs.push(format!("[a{index}]"));
            graph.push(format!(
                "[0:a]atrim=start={start:.3}:end={after:.3},asetpts=PTS-STARTPTS[ac{index}]"
            ));
            audio_inputs.push(format!("[ac{index}]"));
        }
        prev = after;
    }
    let last = cuts.len();
    if prev < info.duration - 0.05 {
        graph.push(format!(
            "[0:v]trim=start={prev:.3},setpts=PTS-STARTPTS[v{last}]"
        ));
        video_inputs.push(format!("[v{last}]"));
        if info.has_audio {
            graph.push(format!(
                "[0:a]atrim=start={prev:.3},asetpts=PTS-STARTPTS[a{last}]"
            ));
            audio_inputs.push(format!("[a{last}]"));
        }
    }
    graph.push(format!(
        "{}concat=n={}:v=1:a=0[v]",
        video_inputs.join(""),
        video_inputs.len()
    ));
    if info.has_audio && !audio_inputs.is_empty() {
        graph.push(format!(
            "{}concat=n={}:v=0:a=1[a]",
            audio_inputs.join(""),
            audio_inputs.len()
        ));
    }
    graph.join(";")
}

fn broll_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    broll_dir: &Path,
    output: &Path,
    interval: f64,
    clip: f64,
    max: usize,
) -> Result<CreatorOutput, CreatorError> {
    let info = probe_video(ffprobe, input)?;
    let mut clips = std::fs::read_dir(broll_dir)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        matches!(
                            extension.to_ascii_lowercase().as_str(),
                            "mp4" | "mov" | "mkv" | "webm" | "avi"
                        )
                    })
        })
        .collect::<Vec<_>>();
    clips.sort();
    if clips.is_empty() {
        return Err(CreatorError::Invalid(
            "La carpeta de B-roll no tiene videos compatibles.".into(),
        ));
    }
    let cuts = plan_cuts(info.duration, interval, clip, max, clips.len());
    if cuts.is_empty() {
        return Err(CreatorError::Invalid(
            "No hay margen para insertar B-roll con ese intervalo.".into(),
        ));
    }
    let workspace = TempWorkspace::new("broll")?;
    let graph = broll_filter(info, &cuts);
    std::fs::write(workspace.path.join("filter-graph.txt"), graph)?;
    let mut args = vec!["-i".into(), input.to_string_lossy().into_owned()];
    for cut in &cuts {
        args.push("-stream_loop".into());
        args.push("-1".into());
        args.push("-i".into());
        args.push(clips[cut.broll_index].to_string_lossy().into_owned());
    }
    args.extend([
        "-/filter_complex".into(),
        "filter-graph.txt".into(),
        "-map".into(),
        "[v]".into(),
    ]);
    if info.has_audio {
        args.extend([
            "-map".into(),
            "[a]".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
        ]);
    } else {
        args.push("-an".into());
    }
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-t".into(),
        format!("{:.3}", info.duration),
        output.to_string_lossy().into_owned(),
    ]);
    run_ffmpeg(ffmpeg, &args, &workspace.path)?;
    metadata_output(
        output.to_path_buf(),
        "broll",
        even(info.width),
        even(info.height),
        info.duration,
    )
}

#[tauri::command]
pub async fn creator_interleave_broll(
    state: State<'_, AppState>,
    input_path: String,
    broll_dir: String,
    output_path: String,
    interval_seconds: Option<f64>,
    clip_seconds: Option<f64>,
    max_insertions: Option<u32>,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let broll_dir = PathBuf::from(broll_dir.trim());
    if !broll_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "La carpeta de B-roll no existe.",
        ));
    }
    let output = output_mp4(&output_path)?;
    let interval = interval_seconds.unwrap_or(5.0);
    let clip = clip_seconds.unwrap_or(1.75);
    let max = max_insertions.unwrap_or(12) as usize;
    tauri::async_runtime::spawn_blocking(move || {
        broll_blocking(
            &ffmpeg, &ffprobe, &input, &broll_dir, &output, interval, clip, max,
        )
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El B-roll se interrumpió."))?
    .map_err(Into::into)
}

#[derive(Debug, Clone)]
struct Chapter {
    start: f64,
    end: f64,
    title: String,
}

fn probe_chapters(ffprobe: &Path, input: &Path) -> Result<Vec<Chapter>, CreatorError> {
    let mut command = Command::new(ffprobe);
    command
        .args(["-v", "error", "-show_chapters", "-of", "json"])
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        return Err(CreatorError::Probe(
            "No se pudieron leer los capítulos.".into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| CreatorError::Probe("FFprobe devolvió JSON inválido.".into()))?;
    let chapters = value["chapters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|chapter| {
            let start = chapter["start_time"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .or_else(|| chapter["start_time"].as_f64())?;
            let end = chapter["end_time"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .or_else(|| chapter["end_time"].as_f64())
                .unwrap_or(start);
            let title = chapter["tags"]["title"]
                .as_str()
                .or_else(|| chapter["title"].as_str())
                .unwrap_or("Capítulo")
                .trim()
                .to_owned();
            (end > start).then_some(Chapter { start, end, title })
        })
        .collect::<Vec<_>>();
    if chapters.is_empty() {
        return Err(CreatorError::Invalid(
            "El video no tiene capítulos para dividir.".into(),
        ));
    }
    if chapters.len() > 80 {
        return Err(CreatorError::Invalid(format!(
            "El video tiene {} capítulos; el máximo por división es 80.",
            chapters.len()
        )));
    }
    Ok(chapters)
}

fn safe_name(raw: &str) -> String {
    let mut value: String = raw
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = value.trim_matches([' ', '.']).chars().take(60).collect::<String>();
    if value.is_empty() {
        "capitulo".to_owned()
    } else {
        value
    }
}

fn split_chapters_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output_dir: &Path,
) -> Result<Vec<CreatorOutput>, CreatorError> {
    let chapters = probe_chapters(ffprobe, input)?;
    std::fs::create_dir_all(output_dir)?;
    let info = probe_video(ffprobe, input)?;
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let mut outputs = Vec::new();
    let workspace = TempWorkspace::new("chapters")?;
    for (index, chapter) in chapters.iter().enumerate() {
        let name = format!(
            "{stem}-cap-{:02}-{}.mp4",
            index + 1,
            safe_name(&chapter.title)
        );
        let output = output_dir.join(name);
        let duration = (chapter.end - chapter.start).max(0.1);
        let args = vec![
            "-ss".into(),
            format!("{:.3}", chapter.start),
            "-i".into(),
            input.to_string_lossy().into_owned(),
            "-t".into(),
            format!("{duration:.3}"),
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            "0:a?".into(),
            "-map_chapters".into(),
            "-1".into(),
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "20".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "160k".into(),
            "-movflags".into(),
            "+faststart".into(),
            output.to_string_lossy().into_owned(),
        ];
        run_ffmpeg(ffmpeg, &args, &workspace.path)?;
        outputs.push(metadata_output(
            output,
            "chapter",
            even(info.width),
            even(info.height),
            duration,
        )?);
    }
    Ok(outputs)
}

#[tauri::command]
pub async fn creator_split_chapters(
    state: State<'_, AppState>,
    input_path: String,
    output_dir: String,
) -> Result<Vec<CreatorOutput>, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output_dir = PathBuf::from(output_dir.trim());
    if output_dir.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "Elegí una carpeta de salida.",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        split_chapters_blocking(&ffmpeg, &ffprobe, &input, &output_dir)
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "La división se interrumpió."))?
    .map_err(Into::into)
}

fn burn_subtitles_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    subtitle_text: &str,
) -> Result<CreatorOutput, CreatorError> {
    if subtitle_text.trim().is_empty() {
        return Err(CreatorError::Invalid(
            "El archivo de subtítulos está vacío.".into(),
        ));
    }
    if subtitle_text.len() > 5_000_000 {
        return Err(CreatorError::Invalid(
            "Los subtítulos superan los 5 MB.".into(),
        ));
    }
    let info = probe_video(ffprobe, input)?;
    let workspace = TempWorkspace::new("burn")?;
    std::fs::write(workspace.path.join("subs.srt"), subtitle_text)?;
    let filter = "scale=trunc(iw/2)*2:trunc(ih/2)*2,subtitles=subs.srt:force_style='FontName=Segoe UI,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=48'";
    let args = vec![
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        filter.into(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "160k".into(),
        "-movflags".into(),
        "+faststart".into(),
        output.to_string_lossy().into_owned(),
    ];
    run_ffmpeg(ffmpeg, &args, &workspace.path)?;
    metadata_output(
        output.to_path_buf(),
        "subtitles",
        even(info.width),
        even(info.height),
        info.duration,
    )
}

#[tauri::command]
pub async fn creator_burn_subtitles(
    state: State<'_, AppState>,
    input_path: String,
    output_path: String,
    subtitle_text: String,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output = output_mp4(&output_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        burn_subtitles_blocking(&ffmpeg, &ffprobe, &input, &output, &subtitle_text)
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El burn-in se interrumpió."))?
    .map_err(Into::into)
}

// Compatibilidad con el frontend que aún no usa serde para algunos campos.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorAspectInfo {
    pub key: String,
    pub width: u32,
    pub height: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ass_escaping_removes_tags_and_keeps_lines() {
        let escaped = ass_text("Línea 1\n{Hack}: 100% \\ fin");
        assert!(!escaped.contains('{'));
        assert!(!escaped.contains('}'));
        assert!(!escaped.replace("\\N", "").contains('\\'));
        assert!(escaped.contains("\\N"));
    }

    #[test]
    fn plan_cuts_respects_interval_and_limit() {
        let cuts = plan_cuts(20.0, 5.0, 1.75, 10, 2);
        assert_eq!(cuts.len(), 3);
        assert_eq!(cuts[0].start, 5.0);
        assert_eq!(cuts[0].duration, 1.75);
        assert_eq!(cuts[1].broll_index, 1);
        assert_eq!(cuts[2].broll_index, 0);
        assert!(plan_cuts(2.0, 5.0, 1.75, 10, 1).is_empty());
    }

    #[test]
    fn aspect_filters_use_blur_for_vertical_and_square() {
        let vertical = aspect_filter(Aspect::Vertical);
        assert!(vertical.contains("gblur=sigma=28"));
        assert!(vertical.contains("1080:1920"));
        let horizontal = aspect_filter(Aspect::Horizontal);
        assert!(horizontal.contains("crop=1920:1080"));
        let square = aspect_filter(Aspect::Square);
        assert!(square.contains("1080:1080"));
    }

    #[test]
    fn qr_png_is_generated_offline() {
        let workspace = TempWorkspace::new("qr-test").unwrap();
        let path = workspace.path.join("qr.png");
        write_qr_png(&path, "https://olyvia.example/afiliado").unwrap();
        let image = image::open(&path).unwrap();
        assert!(image.width() > 100);
        assert_eq!(image.width(), image.height());
    }

    #[test]
    fn hook_filter_splits_and_zooms_the_first_three_seconds() {
        let info = VideoInfo {
            width: 640,
            height: 360,
            fps: 30.0,
            duration: 8.0,
            has_audio: true,
        };
        let filter = hook_filter(info, 3.0, 0.10);
        assert!(filter.contains("trim=0:3.000"));
        assert!(filter.contains("zoompan="));
        assert!(filter.contains("concat=n=2:v=1:a=0"));
        assert!(filter.contains("ass=hook.ass"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn creator_tools_live_optional() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("creator_tools_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
            return;
        }
        use crate::commands::system::find_executable;
        let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
        let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
        let workspace = TempWorkspace::new("creator-live").unwrap();
        let input = workspace.path.join("base.mp4");
        let made = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=30:duration=6",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=6",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&input)
            .status()
            .expect("generate input");
        assert!(made.success());
        let broll_dir = workspace.path.join("broll");
        std::fs::create_dir_all(&broll_dir).unwrap();
        for (index, color) in ["red", "blue"].iter().enumerate() {
            let clip = broll_dir.join(format!("clip-{index}.mp4"));
            let status = Command::new(&ffmpeg)
                .args([
                    "-hide_banner",
                    "-v",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    &format!("color=c={color}:size=320x180:rate=30:duration=1"),
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                ])
                .arg(&clip)
                .status()
                .unwrap();
            assert!(status.success());
        }

        let hook = hook_blocking(
            &ffmpeg,
            &ffprobe,
            &input,
            &workspace.path.join("hook.mp4"),
            "El secreto que nadie te contó",
            0.12,
            -15.0,
        )
        .unwrap();
        let info = probe_video(&ffprobe, Path::new(&hook.path)).unwrap();
        assert!((info.duration - 6.0).abs() < 0.35);
        assert!(info.has_audio);

        let cta = cta_blocking(
            &ffmpeg,
            &ffprobe,
            &input,
            &workspace.path.join("cta.mp4"),
            "Enlace en la biografía",
            "https://olyvia.example/afiliado",
            4.0,
            true,
        )
        .unwrap();
        let info = probe_video(&ffprobe, Path::new(&cta.path)).unwrap();
        assert!((info.duration - 6.0).abs() < 0.35);
        assert!(info.has_audio);

        let variants = aspect_blocking(
            &ffmpeg,
            &input,
            &workspace.path.join("variants"),
            vec![Aspect::Vertical, Aspect::Horizontal, Aspect::Square],
            6.0,
            true,
        )
        .await
        .unwrap();
        assert_eq!(variants.len(), 3);
        for variant in &variants {
            let info = probe_video(&ffprobe, Path::new(&variant.path)).unwrap();
            assert_eq!((info.width, info.height), (variant.width, variant.height));
            assert!(info.has_audio);
        }

        let broll = broll_blocking(
            &ffmpeg,
            &ffprobe,
            &input,
            &broll_dir,
            &workspace.path.join("broll.mp4"),
            4.0,
            1.5,
            4,
        )
        .unwrap();
        let info = probe_video(&ffprobe, Path::new(&broll.path)).unwrap();
        assert!((info.duration - 6.0).abs() < 0.35);
        assert!(info.has_audio);
        // El primer cut cae en 4.0–5.5 s y usa el clip rojo: el frame central
        // debe ser rojo, no el testsrc original.
        let sample = Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-ss", "4.75", "-i"])
            .arg(&broll.path)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale=1:1",
                "-pix_fmt",
                "rgb24",
                "-f",
                "rawvideo",
                "-",
            ])
            .output()
            .unwrap();
        assert!(sample.status.success());
        assert!(sample.stdout.len() >= 3);
        assert!(
            sample.stdout[0] > 150 && sample.stdout[1] < 100 && sample.stdout[2] < 100,
            "el B-roll rojo no reemplazó el tramo: {:?}",
            &sample.stdout[..3]
        );

        // Capítulos: se genera un MP4 de 6 s con dos capítulos embebidos.
        let chaptered = workspace.path.join("chaptered.mp4");
        let meta = workspace.path.join("chapters.txt");
        std::fs::write(
            &meta,
            ";FFMETADATA1\ntitle=Demo\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=Introducción\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=6000\ntitle=Cierre: preguntas\n",
        )
        .unwrap();
        let made = Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-y", "-i"])
            .arg(&input)
            .arg("-i")
            .arg(&meta)
            .args(["-map_metadata", "1", "-codec", "copy"])
            .arg(&chaptered)
            .status()
            .expect("chaptered input");
        assert!(made.success());
        let chapters_dir = workspace.path.join("chapters");
        let parts = split_chapters_blocking(&ffmpeg, &ffprobe, &chaptered, &chapters_dir).unwrap();
        assert_eq!(parts.len(), 2);
        let mut total = 0.0;
        for part in &parts {
            let info = probe_video(&ffprobe, Path::new(&part.path)).unwrap();
            assert!(info.has_audio);
            assert!(
                info.duration > 2.5 && info.duration < 3.6,
                "cada capítulo debe durar ~3 s, no {}",
                info.duration
            );
            total += info.duration;
        }
        assert!((total - 6.0).abs() < 0.6, "duración total {total}");
        assert!(
            Path::new(&parts[1].path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .contains("Cierre_ preguntas")
        );

        // Subtítulos quemados: filtro subtitles real sobre un frame claro.
        let srt = "1\n00:00:00,200 --> 00:00:05,500\nSubtítulo de prueba\n";
        let burned = burn_subtitles_blocking(
            &ffmpeg,
            &ffprobe,
            &input,
            &workspace.path.join("subtitled.mp4"),
            srt,
        )
        .unwrap();
        let info = probe_video(&ffprobe, Path::new(&burned.path)).unwrap();
        assert!((info.duration - 6.0).abs() < 0.35);
        assert!(info.has_audio);
        assert!(burned.bytes > 0);
        let empty = burn_subtitles_blocking(
            &ffmpeg,
            &ffprobe,
            &input,
            &workspace.path.join("empty.mp4"),
            "   ",
        );
        assert!(empty.is_err());
    }

    #[test]
    fn safe_name_removes_unsafe_characters() {
        assert_eq!(safe_name("Cierre: ¿preguntas?"), "Cierre_ ¿preguntas_");
        assert_eq!(safe_name("   "), "capitulo");
        assert_eq!(safe_name("a/b\\c"), "a_b_c");
    }

    #[test]
    fn broll_filter_keeps_main_audio_contiguous() {
        let info = VideoInfo {
            width: 640,
            height: 360,
            fps: 30.0,
            duration: 10.0,
            has_audio: true,
        };
        let cuts = plan_cuts(10.0, 5.0, 1.75, 4, 1);
        let graph = broll_filter(info, &cuts);
        assert!(graph.contains("atrim=start=5.000:end=6.750"));
        assert!(graph.contains("concat=n=3:v=0:a=1[a]"));
        assert!(graph.contains("trim=0:1.750"));
    }
}
