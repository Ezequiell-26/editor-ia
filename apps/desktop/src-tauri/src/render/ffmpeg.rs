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

use std::collections::HashMap;
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
    pub video_codec: String,
    pub audio_codec: String,
    pub container: String,
    pub audio_rate: u32,
    pub audio_channels: u32,
    pub min_output_bytes: u64,
    pub duration_tolerance_frames: u32,
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
    Ok(Profile {
        id: text(value, "id").unwrap_or_default().to_owned(),
        name: text(value, "name").unwrap_or("Render").to_owned(),
        width: width as u32,
        height: height as u32,
        fps_num,
        fps_den,
        crf,
        target_bps,
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
    })
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

#[allow(clippy::too_many_arguments)]
fn visual_filter(
    input_index: usize,
    clip: &Value,
    asset: &Value,
    profile: &Profile,
    clip_seconds: f64,
    start_seconds: f64,
    speed_num: u32,
    speed_den: u32,
    is_image: bool,
) -> String {
    let transform = &clip["transform"];
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

    let mut filters = Vec::new();
    filters.push(format!("fps={}", profile.fps_arg()));
    filters.push(format!(
        "scale=w={}:h={}:force_original_aspect_ratio=decrease:force_divisible_by=2",
        profile.width, profile.height
    ));
    if (scale_x - 1.0).abs() > 0.001 || (scale_y - 1.0).abs() > 0.001 {
        filters.push(format!("scale=iw*{scale_x:.6}:ih*{scale_y:.6}"));
    }
    filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0".to_owned());
    filters.push("format=rgba".to_owned());
    if !is_image && speed_num != speed_den {
        filters.push(format!(
            "setpts=(PTS-STARTPTS)*{}/{}",
            speed_den.max(1),
            speed_num.max(1)
        ));
    }
    filters.push(format!("trim=duration={}", seconds(clip_seconds)));
    if rotation.abs() > 0.01 {
        filters.push(format!(
            "rotate={rotation}*PI/180:ow=rotw(iw):oh=roth(ih):c=none"
        ));
    }
    if opacity < 0.999 {
        filters.push(format!("colorchannelmixer=aa={opacity:.4}"));
    }
    filters.push(format!("setpts=PTS-STARTPTS+{}/TB", seconds(start_seconds)));

    // Keep the asset read so a malformed source is caught by the compiler of
    // this function even if future transforms stop using it directly.
    let _ = asset;
    format!("[{input_index}:v]{}[v{input_index}]", filters.join(","))
}

fn audio_filter(
    input_index: usize,
    profile: &Profile,
    clip_seconds: f64,
    start_seconds: f64,
    gain_db: f64,
    fade_in: f64,
    fade_out: f64,
    speed_num: u32,
    speed_den: u32,
) -> String {
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
    filters.push(format!("atrim=duration={}", seconds(clip_seconds)));
    filters.push("asetpts=PTS-STARTPTS".to_owned());
    if gain_db.abs() > 0.001 {
        filters.push(format!("volume={gain_db:.2}dB"));
    }
    let fade_in = fade_in.clamp(0.0, clip_seconds);
    let fade_out = fade_out.clamp(0.0, clip_seconds);
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
    let project = input.project;
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
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    let asset_by_id: HashMap<String, Value> = assets
        .iter()
        .filter_map(|asset| Some((asset["id"].as_str()?.to_owned(), asset.clone())))
        .collect();
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
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

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
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
    ];
    let mut inputs = 1usize;
    let mut filters: Vec<String> = vec!["[0:v]format=rgba,setpts=PTS-STARTPTS[base0]".to_owned()];
    let mut base_label = "base0".to_owned();
    let mut audio_labels: Vec<String> = Vec::new();

    let mut visual_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
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
        let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        if clip_seconds <= 0.0 {
            continue;
        }
        if kind == "graphic" {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "los clips gráficos todavía no tienen un renderizador nativo; quitálos o reemplazalos por medios",
            ));
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
        let is_image = kind == "image";
        let speed = clip["speed"].clone();
        let speed_num = speed["num"].as_u64().unwrap_or(1) as u32;
        let speed_den = speed["den"].as_u64().unwrap_or(1) as u32;
        let speed_den = speed_den.max(1);
        let speed_num = speed_num.max(1);

        if is_image {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-framerate".into(),
                profile.fps_arg(),
                "-t".into(),
                seconds(clip_seconds),
                "-i".into(),
                path.to_string_lossy().into_owned(),
            ]);
        } else {
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
        }
        let index = inputs;
        inputs += 1;
        filters.push(visual_filter(
            index,
            clip,
            asset,
            profile,
            clip_seconds,
            start_seconds,
            speed_num,
            speed_den,
            is_image,
        ));
        let transform = &clip["transform"];
        let offset_x = sanitize_filter_number(number(transform, "offsetX").unwrap_or(0.0));
        let offset_y = sanitize_filter_number(number(transform, "offsetY").unwrap_or(0.0));
        let next_label = format!("base{}", index);
        filters.push(format!(
            "[{base_label}][v{index}]overlay=x=(W-overlay_w)/2+{offset_x:.3}:y=(H-overlay_h)/2+{offset_y:.3}:enable='between(t,{:.6},{:.6})':eof_action=pass:shortest=0[{next_label}]",
            start_seconds,
            start_seconds + clip_seconds
        ));
        base_label = next_label;

        let has_audio = if is_image {
            false
        } else {
            *probed_audio
                .entry(asset_id.to_owned())
                .or_insert_with(|| has_audio_stream(input.ffprobe, &path))
        };
        if has_audio && !muted {
            let gain = number(&clip["audio"], "gainDb").unwrap_or(0.0);
            let fade_in = clip["audio"]["fadeInFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
            let fade_out =
                clip["audio"]["fadeOutFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
            filters.push(audio_filter(
                index,
                profile,
                clip_seconds,
                start_seconds,
                gain,
                fade_in,
                fade_out,
                speed_num,
                speed_den,
            ));
            audio_labels.push(format!("[a{index}]"));
        }
    }

    let audio_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
            let track_id = clip["trackId"].as_str().unwrap_or("");
            track_info
                .get(track_id)
                .map(|(kind, _, _, muted)| matches!(kind.as_str(), "audio" | "narration") && !muted)
                .unwrap_or(false)
        })
        .collect();
    for clip in audio_clips {
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
        let gain = number(&clip["audio"], "gainDb").unwrap_or(0.0);
        let fade_in = clip["audio"]["fadeInFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        let fade_out = clip["audio"]["fadeOutFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        filters.push(audio_filter(
            index,
            profile,
            clip_seconds,
            start_seconds,
            gain,
            fade_in,
            fade_out,
            speed_num,
            speed_den,
        ));
        audio_labels.push(format!("[a{index}]"));
    }

    let master_gain = number(&project["audio"]["master"], "gainDb").unwrap_or(0.0);
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
            "[{silent_index}:a]aresample={},aformat=sample_fmts=fltp:channel_layouts=stereo,volume={master_gain:.2}dB[aout]",
            profile.audio_rate
        );
    } else if audio_labels.len() == 1 {
        audio_out_filter = format!(
            "{}volume={master_gain:.2}dB,alimiter=limit=0.95[aout]",
            audio_labels[0]
        );
    } else {
        audio_out_filter = format!(
            "{}amix=inputs={}:duration=longest:normalize=0,volume={master_gain:.2}dB,alimiter=limit=0.95[aout]",
            audio_labels.join(""),
            audio_labels.len()
        );
    }
    filters.push(audio_out_filter);

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
    if ass.is_empty() {
        filters.push(format!("[{base_label}]format=yuv420p[vout]"));
    } else {
        std::fs::write(input.temp_dir.join("captions.ass"), ass).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar el archivo de subtítulos para el render",
            )
        })?;
        filters.push(format!(
            "[{base_label}]ass=captions.ass,format=yuv420p[vout]"
        ));
    }

    args.push("-filter_complex".into());
    args.push(filters.join(";"));
    args.extend([
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[aout]".into(),
        "-c:v".into(),
        if profile.video_codec == "h265" {
            "libx265"
        } else {
            "libx264"
        }
        .into(),
        "-preset".into(),
        "veryfast".into(),
    ]);
    if let Some(crf) = profile.crf {
        args.extend(["-crf".into(), crf.to_string()]);
    }
    if let Some(bps) = profile.target_bps {
        args.extend(["-b:v".into(), bps.to_string()]);
    }
    args.extend([
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-r".into(),
        profile.fps_arg(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-ar".into(),
        profile.audio_rate.to_string(),
        "-ac".into(),
        profile.audio_channels.to_string(),
        "-movflags".into(),
        "+faststart".into(),
        "-t".into(),
        seconds(duration_seconds),
        input.output_path.to_string_lossy().into_owned(),
    ]);

    Ok(RenderPlan {
        args,
        output_path: input.output_path.to_path_buf(),
        working_dir: input.temp_dir.to_path_buf(),
        duration_seconds,
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
        command.creation_flags(0x0800_0000);
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
    if metadata.len() < plan.min_output_bytes {
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
    if !status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg devolvió un error durante el render",
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
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 100,
            duration_tolerance_frames: 10,
        }
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
            project: &project,
            root: Path::new("C:/obra"),
            profile: &profile(),
            output_path: Path::new("C:/obra/salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
        });
        assert!(result.is_err());
    }

    #[test]
    fn empty_timelines_are_refused() {
        let mut project = project();
        project["timeline"]["clips"] = serde_json::json!([]);
        let temp = std::env::temp_dir().join("editor-ia-unit-temp");
        let result = build_plan(BuildPlanInput {
            project: &project,
            root: Path::new("C:/obra"),
            profile: &profile(),
            output_path: Path::new("C:/obra/salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
        });
        assert!(matches!(result, Err(error) if error.code == ProjectErrorCode::EmptyTimeline));
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
            project: &project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("out.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
        });
        assert!(matches!(result, Err(error) if error.code == ProjectErrorCode::AssetNotReady));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Real end-to-end render. It is ignored by default because it needs
    /// FFmpeg/FFprobe and writes a temporary MP4. Run it explicitly with:
    /// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live -- --ignored`.
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

        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false },
                    { "id": "22222222-2222-4222-8222-222222222222", "kind": "narration", "label": "N1", "order": 1, "hidden": false, "muted": false },
                    { "id": "33333333-3333-4333-8333-333333333333", "kind": "caption", "label": "C1", "order": 2, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 60 } },
                    { "id": "66666666-6666-4666-8666-666666666666", "trackId": "22222222-2222-4222-8222-222222222222", "kind": "audio", "label": "Voz", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "77777777-7777-4777-8777-777777777777", "inFrame": 0, "outFrame": 60 } }
                ]
            },
            "assets": [
                { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" }, "media": { "durationFrames": 60 } },
                { "id": "77777777-7777-4777-8777-777777777777", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/audio.wav" }, "media": { "durationFrames": 60 } }
            ],
            "captions": {
                "styles": [{ "id": "88888888-8888-4888-8888-888888888888", "name": "Principal", "fontFamily": "Arial", "fontSizePx": 30, "color": "#ffffff", "outlineColor": "#000000", "position": "bottom" }],
                "cues": [{ "id": "99999999-9999-4999-8999-999999999999", "trackId": "33333333-3333-4333-8333-333333333333", "styleId": "88888888-8888-4888-8888-888888888888", "text": "Hola desde Editor IA", "startFrame": 6, "endFrame": 50 }]
            },
            "audio": { "master": { "gainDb": 0 } }
        });
        let profile = Profile {
            id: "p".into(),
            name: "Test 320x180".into(),
            width: 320,
            height: 180,
            fps_num: 30,
            fps_den: 1,
            crf: Some(26),
            target_bps: None,
            video_codec: "h264".into(),
            audio_codec: "aac".into(),
            container: "mp4".into(),
            audio_rate: 48_000,
            audio_channels: 2,
            min_output_bytes: 1_000,
            duration_tolerance_frames: 10,
        };
        let output = root.join("out.mp4");
        let temp = root.join("temp");
        std::fs::create_dir_all(&temp).unwrap();
        let plan = build_plan(BuildPlanInput {
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: true,
            temp_dir: &temp,
            ffprobe: &ffprobe,
        })
        .expect("el plan debería construirse");
        let mut events = 0;
        let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_progress| events += 1)
            .expect("el render real debería completarse y verificarse");
        assert!(events > 0, "ffmpeg debería reportar progreso");
        assert_eq!(verification.width, 320);
        assert_eq!(verification.height, 180);
        assert!((verification.duration_seconds - 2.0).abs() < 0.5);
        assert!(output.is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    fn path_to_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }
}
