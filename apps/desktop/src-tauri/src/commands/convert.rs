//! Guarded media conversion, compression and batch export.
//!
//! The frontend picks project assets and one of the allowlisted targets. This
//! module builds the FFmpeg argument vector itself; no shell, no arbitrary
//! codec flags. Output is written to a hidden temporary file in the selected
//! folder, verified with FFprobe and only then renamed. An existing file is
//! never overwritten silently: single conversions refuse, batches pick a free
//! name.
//!
//! Three entry points share the same machinery:
//! - `convert_media`: one asset to one allowlisted format.
//! - `compress_media`: one asset to MP4/MKV/HEVC with a quality (CRF) or a
//!   target size in megabytes, which becomes a bitrate budget.
//! - `convert_media_batch`: many assets in one call, reporting per item and
//!   emitting `convert-progress` so the interface can show real progress.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::audio::HardwareEncoders;
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConversionTarget {
    Png,
    Jpg,
    Webp,
    Bmp,
    Tiff,
    Mp4,
    Mkv,
    Webm,
    Mov,
    Avi,
    Flv,
    Ts,
    Gif,
    Hevc,
    Mp3,
    Wav,
    M4a,
    Aac,
    Ogg,
    Opus,
    Flac,
}

impl ConversionTarget {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpg),
            "webp" => Some(Self::Webp),
            "bmp" => Some(Self::Bmp),
            "tiff" | "tif" => Some(Self::Tiff),
            "mp4" => Some(Self::Mp4),
            "mkv" => Some(Self::Mkv),
            "webm" => Some(Self::Webm),
            "mov" => Some(Self::Mov),
            "avi" => Some(Self::Avi),
            "flv" => Some(Self::Flv),
            "ts" => Some(Self::Ts),
            "gif" => Some(Self::Gif),
            "hevc" | "mp4-hevc" => Some(Self::Hevc),
            "mp3" => Some(Self::Mp3),
            "wav" => Some(Self::Wav),
            "m4a" => Some(Self::M4a),
            "aac" => Some(Self::Aac),
            "ogg" => Some(Self::Ogg),
            "opus" => Some(Self::Opus),
            "flac" => Some(Self::Flac),
            _ => None,
        }
    }

    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpg => "jpg",
            Self::Webp => "webp",
            Self::Bmp => "bmp",
            Self::Tiff => "tiff",
            Self::Mp4 => "mp4",
            Self::Mkv => "mkv",
            Self::Webm => "webm",
            Self::Mov => "mov",
            Self::Avi => "avi",
            Self::Flv => "flv",
            Self::Ts => "ts",
            Self::Gif => "gif",
            Self::Hevc => "mp4",
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
            Self::M4a => "m4a",
            Self::Aac => "aac",
            Self::Ogg => "ogg",
            Self::Opus => "opus",
            Self::Flac => "flac",
        }
    }

    pub(crate) fn is_image(self) -> bool {
        matches!(
            self,
            Self::Png | Self::Jpg | Self::Webp | Self::Bmp | Self::Tiff
        )
    }

    pub(crate) fn is_video(self) -> bool {
        matches!(
            self,
            Self::Mp4
                | Self::Mkv
                | Self::Webm
                | Self::Mov
                | Self::Avi
                | Self::Flv
                | Self::Ts
                | Self::Gif
                | Self::Hevc
        )
    }

    pub(crate) fn is_audio(self) -> bool {
        matches!(
            self,
            Self::Mp3 | Self::Wav | Self::M4a | Self::Aac | Self::Ogg | Self::Opus | Self::Flac
        )
    }

    pub(crate) fn accepts(self, asset_kind: &str) -> bool {
        if self.is_image() {
            return asset_kind == "image" || asset_kind == "video";
        }
        if self.is_video() {
            return asset_kind == "video";
        }
        if self.is_audio() {
            return asset_kind == "video" || asset_kind == "audio";
        }
        false
    }
}

/// Preferencia de encoder del usuario. `Auto` usa hardware si la máquina lo
/// tiene; `Hardware` lo exige (si no hay, cae a software); `Software` fuerza
/// libx264/libx265.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EncoderPref {
    Auto,
    Hardware,
    Software,
}

impl EncoderPref {
    pub(crate) fn parse(value: Option<&str>) -> Self {
        match value.map(|item| item.trim().to_ascii_lowercase()) {
            Some(ref item) if item == "hardware" => Self::Hardware,
            Some(ref item) if item == "software" => Self::Software,
            _ => Self::Auto,
        }
    }
}

/// Mejoras opcionales aplicadas con filtros allowlisted de FFmpeg.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EnhanceOptions {
    pub denoise: bool,
    pub sharpen: bool,
    pub normalize_audio: bool,
}

/// Todo lo que el constructor de argumentos necesita además del destino.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ConvertOptions {
    pub quality: u8,
    pub max_width: Option<u32>,
    pub encoder: EncoderPref,
    pub enhance: EnhanceOptions,
    /// CRF explícito (modo calidad). Gana sobre `quality`.
    pub crf: Option<u32>,
    /// Presupuesto de video en kbps (modo tamaño objetivo).
    pub video_bitrate_kbps: Option<u32>,
    /// Bitrate de audio en kbps; por defecto 192 en video y 128 en audio.
    pub audio_bitrate_kbps: Option<u32>,
}

impl ConvertOptions {
    pub(crate) fn simple(quality: u8, max_width: Option<u32>) -> Self {
        Self {
            quality,
            max_width,
            encoder: EncoderPref::Auto,
            enhance: EnhanceOptions::default(),
            crf: None,
            video_bitrate_kbps: None,
            audio_bitrate_kbps: None,
        }
    }

    fn audio_kbps(self, fallback: u32) -> u32 {
        self.audio_bitrate_kbps.unwrap_or(fallback).clamp(32, 512)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionResult {
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: Option<f64>,
    pub format_name: String,
    /// Tamaño del archivo de origen, para mostrar el ahorro en la interfaz.
    pub source_bytes: u64,
    /// Encoder de video realmente usado (libx264, h264_nvenc, …).
    pub encoder: String,
}

fn quality_clamp(value: Option<u8>) -> u8 {
    value.unwrap_or(78).clamp(1, 100)
}

pub(crate) fn crf_for_quality(quality: u8) -> u32 {
    let quality = quality.clamp(1, 100) as f64 / 100.0;
    (34.0 - quality * 18.0).round().clamp(14.0, 35.0) as u32
}

pub(crate) fn jpeg_qscale(quality: u8) -> u32 {
    let quality = quality.clamp(1, 100) as f64 / 100.0;
    (31.0 - quality * 29.0).round().clamp(2.0, 31.0) as u32
}

pub(crate) fn webp_quality(quality: u8) -> u32 {
    (40.0 + quality.clamp(1, 100) as f64 * 0.55)
        .round()
        .clamp(40.0, 95.0) as u32
}

/// Escalera de bitrate usada cuando el encoder es de hardware (donde `-crf` no
/// es portable) o cuando el usuario pide un tamaño objetivo.
pub(crate) fn quality_bitrate_kbps(quality: u8) -> u32 {
    let quality = quality.clamp(1, 100) as f64 / 100.0;
    (400.0 + quality * 15_600.0).round() as u32
}

/// Bitrate de video que deja el archivo dentro de `target_megabytes`.
/// `duration_seconds` sale de FFprobe; si no se conoce, se usa un valor
/// conservador en lugar de inventar una duración.
pub(crate) fn video_bitrate_for_target(
    target_megabytes: f64,
    duration_seconds: f64,
    audio_kbps: u32,
) -> u32 {
    if !(target_megabytes > 0.0) || !(duration_seconds > 0.0) {
        return 2_000;
    }
    let total_kbps = (target_megabytes * 1024.0 * 1024.0 * 8.0) / (duration_seconds * 1000.0);
    (total_kbps - audio_kbps as f64)
        .round()
        .clamp(50.0, 60_000.0) as u32
}

fn scale_filter(max_width: Option<u32>) -> Option<String> {
    let width = max_width?;
    let width = width.clamp(64, 16_384);
    Some(format!("scale='min({width},iw)':-2:flags=lanczos"))
}

/// Cadena de filtros de video: escala, denoise y sharpen, en ese orden.
pub(crate) fn video_filter_chain(
    max_width: Option<u32>,
    enhance: EnhanceOptions,
) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(scale) = scale_filter(max_width) {
        parts.push(scale);
    }
    if enhance.denoise {
        parts.push("hqdn3d=1.5:1.5:6:6".to_string());
    }
    if enhance.sharpen {
        parts.push("unsharp=5:5:0.8:5:5:0.0".to_string());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(","))
    }
}

/// Normalización de loudness (EBU R128) en una sola pasada.
pub(crate) fn audio_filter_chain(enhance: EnhanceOptions) -> Option<String> {
    if enhance.normalize_audio {
        Some("loudnorm=I=-16:TP=-1.5:LRA=11".to_string())
    } else {
        None
    }
}

fn h264_encoder(hardware: &HardwareEncoders, pref: EncoderPref) -> String {
    match pref {
        EncoderPref::Software => "libx264".to_string(),
        EncoderPref::Hardware | EncoderPref::Auto => hardware
            .h264
            .clone()
            .unwrap_or_else(|| "libx264".to_string()),
    }
}

fn hevc_encoder(hardware: &HardwareEncoders, pref: EncoderPref) -> String {
    match pref {
        EncoderPref::Software => "libx265".to_string(),
        EncoderPref::Hardware | EncoderPref::Auto => hardware
            .hevc
            .clone()
            .unwrap_or_else(|| "libx265".to_string()),
    }
}

/// ¿El encoder elegido es de hardware? Los flags de rate control no son los
/// mismos que en x264/x265, así que se ramifica en un solo lugar.
fn is_hardware_encoder(encoder: &str) -> bool {
    !(encoder.starts_with("libx264") || encoder.starts_with("libx265"))
}

fn push_bitrate(args: &mut Vec<String>, kbps: u32) {
    args.extend([
        "-b:v".into(),
        format!("{kbps}k"),
        "-maxrate".into(),
        format!("{}k", (kbps as f64 * 1.5).round() as u32),
        "-bufsize".into(),
        format!("{}k", kbps * 2),
    ]);
}

fn push_rate_control(args: &mut Vec<String>, options: ConvertOptions, encoder: &str) {
    if is_hardware_encoder(encoder) {
        // Los encoders de GPU no comparten `-crf`: se usa bitrate constante.
        let kbps = options
            .video_bitrate_kbps
            .unwrap_or_else(|| quality_bitrate_kbps(options.quality));
        push_bitrate(args, kbps);
        return;
    }
    if let Some(kbps) = options.video_bitrate_kbps {
        push_bitrate(args, kbps);
        return;
    }
    let crf = options
        .crf
        .unwrap_or_else(|| crf_for_quality(options.quality));
    args.extend(["-crf".into(), crf.to_string()]);
}

pub(crate) fn build_args(
    input: &Path,
    output: &Path,
    target: ConversionTarget,
    asset_kind: &str,
    options: ConvertOptions,
    hardware: &HardwareEncoders,
) -> Result<(Vec<String>, String), ProjectError> {
    if !target.accepts(asset_kind) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato elegido no acepta este tipo de material",
        ));
    }
    let input_text = input.to_string_lossy().into_owned();
    let output_text = output.to_string_lossy().into_owned();
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-y".into(),
        "-i".into(),
        input_text,
    ];
    let encoder_used: String;

    if let Some(chain) = video_filter_chain(options.max_width, options.enhance) {
        args.extend(["-vf".into(), chain]);
    }
    if let Some(chain) = audio_filter_chain(options.enhance) {
        args.extend(["-af".into(), chain]);
    }

    match target {
        ConversionTarget::Png
        | ConversionTarget::Jpg
        | ConversionTarget::Webp
        | ConversionTarget::Bmp
        | ConversionTarget::Tiff => {
            if asset_kind == "video" {
                args.extend(["-frames:v".into(), "1".into()]);
            }
            match target {
                ConversionTarget::Png => args.extend(["-c:v".into(), "png".into()]),
                ConversionTarget::Jpg => args.extend([
                    "-c:v".into(),
                    "mjpeg".into(),
                    "-q:v".into(),
                    jpeg_qscale(options.quality).to_string(),
                ]),
                ConversionTarget::Webp => args.extend([
                    "-c:v".into(),
                    "libwebp".into(),
                    "-quality".into(),
                    webp_quality(options.quality).to_string(),
                ]),
                ConversionTarget::Bmp => args.extend(["-c:v".into(), "bmp".into()]),
                ConversionTarget::Tiff => args.extend(["-c:v".into(), "tiff".into()]),
                _ => unreachable!(),
            }
            encoder_used = "image".into();
            args.extend(["-an".into(), output_text]);
        }
        ConversionTarget::Gif => {
            let width = options.max_width.unwrap_or(960).clamp(64, 1920);
            let filter = format!(
                "fps=15,scale='min({width},iw)':-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3"
            );
            args.extend([
                "-vf".into(),
                filter,
                "-an".into(),
                "-loop".into(),
                "0".into(),
                output_text,
            ]);
            encoder_used = "gif".into();
        }
        ConversionTarget::Webm => {
            args.extend([
                "-c:v".into(),
                "libvpx-vp9".into(),
                "-crf".into(),
                options
                    .crf
                    .unwrap_or_else(|| crf_for_quality(options.quality))
                    .to_string(),
                "-b:v".into(),
                "0".into(),
                "-row-mt".into(),
                "1".into(),
                "-c:a".into(),
                "libopus".into(),
                "-b:a".into(),
                format!("{}k", options.audio_kbps(128)),
                output_text,
            ]);
            encoder_used = "libvpx-vp9".into();
        }
        ConversionTarget::Mp4
        | ConversionTarget::Mkv
        | ConversionTarget::Mov
        | ConversionTarget::Avi
        | ConversionTarget::Flv
        | ConversionTarget::Ts
        | ConversionTarget::Hevc => {
            let encoder = if target == ConversionTarget::Hevc {
                hevc_encoder(hardware, options.encoder)
            } else {
                h264_encoder(hardware, options.encoder)
            };
            encoder_used = encoder.clone();
            args.extend(["-c:v".into(), encoder]);
            if !is_hardware_encoder(&encoder_used) {
                args.extend(["-preset".into(), "faster".into()]);
            }
            push_rate_control(&mut args, options, &encoder_used);
            args.extend([
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                format!("{}k", options.audio_kbps(192)),
                output_text,
            ]);
            if target == ConversionTarget::Mp4 || target == ConversionTarget::Hevc {
                args.extend(["-movflags".into(), "+faststart".into()]);
            }
        }
        ConversionTarget::Mp3 => {
            args.extend([
                "-vn".into(),
                "-c:a".into(),
                "libmp3lame".into(),
                "-b:a".into(),
                format!("{}k", options.audio_kbps(192)),
                output_text,
            ]);
            encoder_used = "libmp3lame".into();
        }
        ConversionTarget::Wav => {
            args.extend(["-vn".into(), "-c:a".into(), "pcm_s16le".into(), output_text]);
            encoder_used = "pcm_s16le".into();
        }
        ConversionTarget::M4a | ConversionTarget::Aac => {
            args.extend([
                "-vn".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                format!("{}k", options.audio_kbps(192)),
                output_text,
            ]);
            encoder_used = "aac".into();
        }
        ConversionTarget::Ogg | ConversionTarget::Opus => {
            args.extend([
                "-vn".into(),
                "-c:a".into(),
                "libopus".into(),
                "-b:a".into(),
                format!("{}k", options.audio_kbps(128)),
                output_text,
            ]);
            encoder_used = "libopus".into();
        }
        ConversionTarget::Flac => {
            args.extend(["-vn".into(), "-c:a".into(), "flac".into(), output_text]);
            encoder_used = "flac".into();
        }
    }
    Ok((args, encoder_used))
}

fn safe_stem(label: &str) -> String {
    let file = label.rsplit(['/', '\\']).next().unwrap_or(label);
    let stem = file.rsplit_once('.').map(|(name, _)| name).unwrap_or(file);
    let mut cleaned: String = stem
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | ' ') {
                character
            } else {
                '-'
            }
        })
        .collect();
    cleaned = cleaned.trim().trim_matches('-').to_string();
    if cleaned.is_empty() {
        "medio".to_string()
    } else {
        cleaned.chars().take(80).collect()
    }
}

/// Primer nombre libre en la carpeta de destino: `toma.mp4`, `toma-1.mp4`, …
/// Un lote nunca pisa un archivo anterior ni aborta por un nombre tomado.
pub(crate) fn unique_output_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{extension}"));
    if !first.exists() {
        return first;
    }
    for index in 1..1_000 {
        let candidate = dir.join(format!("{stem}-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}.{extension}", Uuid::new_v4()))
}

fn probe_result(ffprobe: Option<&Path>, path: &Path) -> (u64, Option<f64>, String) {
    let bytes = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    let Some(ffprobe) = ffprobe else {
        return (bytes, None, String::new());
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration,size",
            "-of",
            "json",
        ])
        .arg(path);
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return (bytes, None, String::new());
    };
    if !output.status.success() {
        return (bytes, None, String::new());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let format = parsed["format"].clone();
    let duration = format["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok());
    let format_name = format["format_name"].as_str().unwrap_or("").to_string();
    let size = format["size"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(bytes);
    (size, duration, format_name)
}

struct AssetInput {
    kind: String,
    label: String,
    path: PathBuf,
    source_bytes: u64,
}

/// Resuelve un asset del proyecto abierto a un archivo real en disco. Comparte
/// las reglas de siempre: el material tiene que estar `ready` y vivir dentro de
/// la carpeta del proyecto.
fn resolve_asset_input(
    session: &crate::state::Session,
    asset_id: &str,
) -> Result<AssetInput, ProjectError> {
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|item| item["id"].as_str() == Some(asset_id))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material que se quiere convertir no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("").to_string();
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "confirmá los derechos del material antes de convertirlo",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }
    let source_bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    Ok(AssetInput {
        kind,
        label: asset["label"].as_str().unwrap_or("medio").to_string(),
        path,
        source_bytes,
    })
}

/// Corre FFmpeg, verifica el resultado y lo publica con rename atómico.
/// `out_time_us=1234567` de las líneas `-progress`: microsegundos procesados.
fn parse_out_time_us(line: &str) -> Option<u64> {
    let value = line.strip_prefix("out_time_us=")?;
    value.trim().parse::<u64>().ok()
}

/// `VMAF score: 93.24` en el stderr del filtro libvmaf.
fn parse_vmaf_score(stderr: &str) -> Option<f64> {
    let marker = "VMAF score:";
    let start = stderr.find(marker)? + marker.len();
    let rest = &stderr[start..];
    let number: String = rest
        .chars()
        .skip_while(|c| c.is_whitespace())
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    number.parse::<f64>().ok()
}

/// Progreso de una compresión: fracción 0–1 que la UI muestra en vivo.
///
/// `emit` se guarda como `Arc` porque el hilo que lee `-progress` vive aparte
/// del que lo crea; `Sync + Send` es lo que ese hilo necesita.
pub struct LiveProgress {
    pub total_seconds: f64,
    pub emit: std::sync::Arc<dyn Fn(f64) + Send + Sync>,
}

fn run_conversion(
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    args: &[String],
    temp_path: &Path,
    final_path: &Path,
    root: &Path,
    progress: Option<&LiveProgress>,
) -> Result<(u64, Option<f64>, String), ProjectError> {
    // `-progress pipe:1` escribe líneas clave=valor en stdout (`out_time_us`,
    // `progress=continue/end`): es lo que hace posible el porcentaje real
    // durante la compresión. `-nostats` silencia el stderr ruidoso.
    let mut full_args: Vec<String> = Vec::with_capacity(args.len() + 3);
    full_args.push("-nostats".to_owned());
    full_args.push("-progress".to_owned());
    full_args.push("pipe:1".to_owned());
    full_args.extend_from_slice(args);
    let mut command = Command::new(ffmpeg);
    command
        .args(&full_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let mut child = command.spawn().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para convertir el material",
        )
    })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_handle = thread::spawn(move || {
        let Some(stderr) = stderr else {
            return Vec::new();
        };
        let mut collected: Vec<u8> = Vec::with_capacity(8 * 1024);
        let mut reader = BufReader::new(stderr);
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if collected.len() < 256 * 1024 {
                        collected.extend_from_slice(&buffer[..read]);
                    }
                }
            }
        }
        collected
    });
    // El cierre se clona (Arc) FUERA del hilo: así el hilo es dueño de su copia
    // y nada con el lifetime del que llama lo cruza.
    let live = progress.map(|live| (live.total_seconds, live.emit.clone()));
    let progress_handle = thread::spawn(move || {
        let Some(stdout) = stdout else { return };
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Some(micros) = parse_out_time_us(&line) else {
                continue;
            };
            let Some((total_seconds, emit)) = &live else {
                continue;
            };
            if *total_seconds > 0.0 {
                let fraction = (micros as f64 / 1_000_000.0) / total_seconds;
                emit(fraction.clamp(0.0, 0.99) * 100.0);
            }
        }
    });
    let status = child.wait().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo seguir el proceso de FFmpeg",
        )
    })?;
    let stderr_bytes: Vec<u8> = stderr_handle.join().unwrap_or_default();
    let _ = progress_handle.join();
    if !status.success() {
        let _ = std::fs::remove_file(temp_path);
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo convertir el material: {}",
                sanitize_log(&stderr, root, 300)
            )
            .as_str(),
        ));
    }
    let metadata = std::fs::metadata(temp_path).map_err(|_| {
        let _ = std::fs::remove_file(temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            "la conversión terminó pero el archivo no existe",
        )
    })?;
    if metadata.len() == 0 {
        let _ = std::fs::remove_file(temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "la conversión produjo un archivo vacío",
        ));
    }
    if final_path.exists() {
        let _ = std::fs::remove_file(temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "el archivo de destino apareció durante la conversión; no se sobrescribió",
        ));
    }
    std::fs::rename(temp_path, final_path).map_err(|_| {
        let _ = std::fs::remove_file(temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo publicar el archivo convertido",
        )
    })?;
    Ok(probe_result(ffprobe, final_path))
}

#[tauri::command]
pub async fn convert_media(
    state: State<'_, AppState>,
    asset_id: String,
    target: String,
    output_dir: String,
    quality: Option<u8>,
    max_width: Option<u32>,
    encoder: Option<String>,
    enhance: Option<EnhanceOptions>,
) -> Result<ConversionResult, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para convertir material",
        ));
    };
    let target = ConversionTarget::parse(&target).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato de salida no está permitido",
        )
    })?;
    let output_root = PathBuf::from(output_dir.trim());
    if output_root.as_os_str().is_empty() || !output_root.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    let input = resolve_asset_input(&session, &asset_id)?;
    if !target.accepts(&input.kind) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato elegido no acepta este tipo de material",
        ));
    }
    let final_path = output_root.join(format!(
        "{}.{}",
        safe_stem(&input.label),
        target.extension()
    ));
    if final_path.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un archivo con ese nombre en la carpeta de destino",
        ));
    }
    let temp_path = output_root.join(format!(
        ".editoria-convert-{}.{}",
        Uuid::new_v4(),
        target.extension()
    ));
    let options = ConvertOptions {
        encoder: EncoderPref::parse(encoder.as_deref()),
        enhance: enhance.unwrap_or_default(),
        ..ConvertOptions::simple(quality_clamp(quality), max_width)
    };
    let hardware = crate::commands::audio::hardware_encoders(state).await?;
    let (args, encoder_used) = build_args(
        &input.path,
        &temp_path,
        target,
        &input.kind,
        options,
        &hardware,
    )?;
    let (bytes, duration_seconds, format_name) = run_conversion(
        &ffmpeg,
        ffprobe.as_deref(),
        &args,
        &temp_path,
        &final_path,
        &session.root,
        None,
    )?;
    Ok(ConversionResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        duration_seconds,
        format_name,
        source_bytes: input.source_bytes,
        encoder: encoder_used,
    })
}

/// Progreso emitido por `convert_media_batch` para la barra del lote.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertProgress {
    pub index: usize,
    pub total: usize,
    pub label: String,
    /// "start" cuando arranca el archivo, "done" cuando terminó.
    pub phase: String,
    pub ok: bool,
}

/// Un ítem del lote: nunca aborta la cola, siempre devuelve qué pasó.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchConversionItem {
    pub asset_id: String,
    pub label: String,
    pub ok: bool,
    pub path: Option<String>,
    pub bytes: Option<u64>,
    pub source_bytes: u64,
    pub duration_seconds: Option<f64>,
    pub format_name: Option<String>,
    pub encoder: Option<String>,
    pub message: Option<String>,
}

#[tauri::command]
pub async fn convert_media_batch(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
    target: String,
    output_dir: String,
    quality: Option<u8>,
    max_width: Option<u32>,
    encoder: Option<String>,
    enhance: Option<EnhanceOptions>,
) -> Result<Vec<BatchConversionItem>, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para convertir material",
        ));
    };
    let target = ConversionTarget::parse(&target).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato de salida no está permitido",
        )
    })?;
    let output_root = PathBuf::from(output_dir.trim());
    if output_root.as_os_str().is_empty() || !output_root.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    if asset_ids.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí al menos un medio para convertir",
        ));
    }
    if asset_ids.len() > 200 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "un lote acepta hasta 200 medios por corrida",
        ));
    }

    let options = ConvertOptions {
        encoder: EncoderPref::parse(encoder.as_deref()),
        enhance: enhance.unwrap_or_default(),
        ..ConvertOptions::simple(quality_clamp(quality), max_width)
    };
    let hardware = crate::commands::audio::hardware_encoders(state).await?;
    let total = asset_ids.len();
    let mut items: Vec<BatchConversionItem> = Vec::with_capacity(total);

    for (index, asset_id) in asset_ids.iter().enumerate() {
        let input = match resolve_asset_input(&session, asset_id) {
            Ok(input) => input,
            Err(error) => {
                items.push(BatchConversionItem {
                    asset_id: asset_id.clone(),
                    label: asset_id.clone(),
                    ok: false,
                    path: None,
                    bytes: None,
                    source_bytes: 0,
                    duration_seconds: None,
                    format_name: None,
                    encoder: None,
                    message: Some(error.message),
                });
                continue;
            }
        };
        let _ = app.emit(
            "convert-progress",
            ConvertProgress {
                index,
                total,
                label: input.label.clone(),
                phase: "start".into(),
                ok: true,
            },
        );

        let outcome = (|| {
            if !target.accepts(&input.kind) {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el formato elegido no acepta este tipo de material",
                ));
            }
            let final_path =
                unique_output_path(&output_root, &safe_stem(&input.label), target.extension());
            let temp_path = output_root.join(format!(
                ".editoria-convert-{}.{}",
                Uuid::new_v4(),
                target.extension()
            ));
            let (args, encoder_used) = build_args(
                &input.path,
                &temp_path,
                target,
                &input.kind,
                options,
                &hardware,
            )?;
            let (bytes, duration_seconds, format_name) = run_conversion(
                &ffmpeg,
                ffprobe.as_deref(),
                &args,
                &temp_path,
                &final_path,
                &session.root,
                None,
            )?;
            Ok((
                final_path,
                bytes,
                duration_seconds,
                format_name,
                encoder_used,
            ))
        })();

        let item = match outcome {
            Ok((path, bytes, duration_seconds, format_name, encoder_used)) => BatchConversionItem {
                asset_id: asset_id.clone(),
                label: input.label.clone(),
                ok: true,
                path: Some(path.to_string_lossy().into_owned()),
                bytes: Some(bytes),
                source_bytes: input.source_bytes,
                duration_seconds,
                format_name: Some(format_name),
                encoder: Some(encoder_used),
                message: None,
            },
            Err(error) => BatchConversionItem {
                asset_id: asset_id.clone(),
                label: input.label.clone(),
                ok: false,
                path: None,
                bytes: None,
                source_bytes: input.source_bytes,
                duration_seconds: None,
                format_name: None,
                encoder: None,
                message: Some(error.message),
            },
        };
        let _ = app.emit(
            "convert-progress",
            ConvertProgress {
                index,
                total,
                label: item.label.clone(),
                phase: "done".into(),
                ok: item.ok,
            },
        );
        items.push(item);
    }

    Ok(items)
}

/// Petición de compresión: calidad (CRF) o tamaño objetivo en megabytes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressRequest {
    pub asset_id: String,
    pub output_dir: String,
    /// mp4, mkv o hevc.
    pub target: String,
    /// quality o size.
    pub mode: String,
    pub quality: Option<u8>,
    pub target_megabytes: Option<f64>,
    pub max_width: Option<u32>,
    pub audio_kbps: Option<u32>,
    pub encoder: Option<String>,
    pub enhance: Option<EnhanceOptions>,
}

/// Los ajustes de compresión que comparten el flujo por asset y por archivo.
struct CompressParams<'a> {
    target: ConversionTarget,
    mode: &'a str,
    quality: Option<u8>,
    target_megabytes: Option<f64>,
    audio_kbps: Option<u32>,
    encoder: Option<&'a str>,
    max_width: Option<u32>,
    enhance: Option<EnhanceOptions>,
}

/// El material a comprimir, ya resuelto a una ruta real en disco.
struct CompressInput {
    path: PathBuf,
    kind: String,
    label: String,
    source_bytes: u64,
}

fn validate_compress_params(
    request_target: &str,
    request_mode: &str,
    output_dir: &str,
) -> Result<(ConversionTarget, String, PathBuf), ProjectError> {
    let target = ConversionTarget::parse(request_target)
        .filter(|item| {
            matches!(
                item,
                ConversionTarget::Mp4 | ConversionTarget::Mkv | ConversionTarget::Hevc
            )
        })
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "la compresión sólo escribe MP4, MKV o MP4 HEVC",
            )
        })?;
    let mode = request_mode.trim().to_ascii_lowercase();
    if mode != "quality" && mode != "size" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el modo de compresión es «quality» o «size»",
        ));
    }
    let output_root = PathBuf::from(output_dir.trim());
    if output_root.as_os_str().is_empty() || !output_root.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    Ok((target, mode, output_root))
}

/// El tramo común de toda compresión: parámetros, FFmpeg y publicación.
///
/// Las herramientas y los encoders de hardware llegan resueltos: así el mismo
/// tramo sirve al comando con proyecto, al comando por ruta y a la prueba real.
#[allow(clippy::too_many_arguments)]
fn compress_input(
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    hardware: &crate::commands::audio::HardwareEncoders,
    input: &CompressInput,
    params: &CompressParams<'_>,
    output_root: &Path,
    sanitize_root: &Path,
    progress: Option<&LiveProgress>,
) -> Result<ConversionResult, ProjectError> {
    if !params.target.accepts(&input.kind) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "sólo se pueden comprimir videos",
        ));
    }
    let audio_kbps = params.audio_kbps.unwrap_or(128).clamp(32, 512);
    let quality = quality_clamp(params.quality);
    let mut options = ConvertOptions {
        encoder: EncoderPref::parse(params.encoder),
        enhance: params.enhance.unwrap_or_default(),
        max_width: params.max_width,
        audio_bitrate_kbps: Some(audio_kbps),
        ..ConvertOptions::simple(quality, params.max_width)
    };
    if params.mode == "size" {
        let target_megabytes = params.target_megabytes.unwrap_or(0.0);
        if !(0.1..=20_000.0).contains(&target_megabytes) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el tamaño objetivo va de 0,1 MB a 20 GB",
            ));
        }
        let duration = probe_result(ffprobe.as_deref(), &input.path).1;
        options.video_bitrate_kbps = Some(video_bitrate_for_target(
            target_megabytes,
            duration.unwrap_or(0.0),
            audio_kbps,
        ));
    } else {
        options.crf = Some(crf_for_quality(quality));
    }

    let final_path = output_root.join(format!(
        "{}.{}",
        safe_stem(&input.label),
        params.target.extension()
    ));
    if final_path.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "ya existe un archivo con ese nombre en la carpeta de destino",
        ));
    }
    let temp_path = output_root.join(format!(
        ".editoria-compress-{}.{}",
        Uuid::new_v4(),
        params.target.extension()
    ));
    let (args, encoder_used) = build_args(
        &input.path,
        &temp_path,
        params.target,
        &input.kind,
        options,
        &hardware,
    )?;
    let (bytes, duration_seconds, format_name) = run_conversion(
        &ffmpeg,
        ffprobe.as_deref(),
        &args,
        &temp_path,
        &final_path,
        sanitize_root,
        progress,
    )?;
    Ok(ConversionResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        duration_seconds,
        format_name,
        source_bytes: input.source_bytes,
        encoder: encoder_used,
    })
}

#[tauri::command]
pub async fn compress_media(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CompressRequest,
) -> Result<ConversionResult, ProjectError> {
    let session = state.require_session()?;
    let (target, mode, output_root) =
        validate_compress_params(&request.target, &request.mode, &request.output_dir)?;
    let input = resolve_asset_input(&session, &request.asset_id)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para comprimir material",
        ));
    };
    let hardware = crate::commands::audio::hardware_encoders(state).await?;
    let params = CompressParams {
        target,
        mode: &mode,
        quality: request.quality,
        target_megabytes: request.target_megabytes,
        audio_kbps: request.audio_kbps,
        encoder: request.encoder.as_deref(),
        max_width: request.max_width,
        enhance: request.enhance,
    };
    let total_seconds = probe_result(ffprobe.as_deref(), &input.path)
        .1
        .unwrap_or(0.0);
    let emitter = app.clone();
    let progress = LiveProgress {
        total_seconds,
        emit: std::sync::Arc::new(move |percent| {
            let _ = emitter.emit(
                "compress-progress",
                serde_json::json!({ "percent": percent }),
            );
        }),
    };
    compress_input(
        &ffmpeg,
        ffprobe.as_deref(),
        &hardware,
        &CompressInput {
            kind: input.kind,
            label: input.label,
            path: input.path,
            source_bytes: input.source_bytes,
        },
        &params,
        &output_root,
        &session.root,
        Some(&progress),
    )
}

/// Compresión de un archivo suelto del disco, sin proyecto abierto.
///
/// Es el corazón del modo "Comprimir como pro": cualquier video que FFmpeg
/// lea, con el número verificable (antes → después) en el resultado.
#[tauri::command]
pub async fn compress_any_file(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CompressAnyRequest,
) -> Result<ConversionResult, ProjectError> {
    let (target, mode, output_root) =
        validate_compress_params(&request.target, &request.mode, &request.output_dir)?;
    let input_path = PathBuf::from(request.input_path.trim());
    if input_path.as_os_str().is_empty() || !input_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo a comprimir no está en disco",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para comprimir material",
        ));
    };
    // Sondeo: se acepta por contenido, no por extensión. Si FFmpeg no ve una
    // pista de video, no es material de compresión.
    let probe = probe_any_file_value(ffprobe.as_deref(), &input_path)?;
    if probe["video"].is_null() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "ese archivo no tiene pista de video: la compresión es para video",
        ));
    }
    let source_bytes = std::fs::metadata(&input_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let label = input_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let input = CompressInput {
        path: input_path,
        kind: "video".to_owned(),
        label,
        source_bytes,
    };
    let params = CompressParams {
        target,
        mode: &mode,
        quality: request.quality,
        target_megabytes: request.target_megabytes,
        audio_kbps: request.audio_kbps,
        encoder: request.encoder.as_deref(),
        max_width: request.max_width,
        enhance: request.enhance,
    };
    let hardware = crate::commands::audio::hardware_encoders(state).await?;
    let total_seconds = probe["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .unwrap_or(0.0);
    let emitter = app.clone();
    let progress = LiveProgress {
        total_seconds,
        emit: std::sync::Arc::new(move |percent| {
            let _ = emitter.emit(
                "compress-progress",
                serde_json::json!({ "percent": percent }),
            );
        }),
    };
    // El log se sanea contra la carpeta de salida: el origen puede estar en
    // cualquier lado y no conviene filtrar rutas del usuario en el error.
    let sanitize_root = output_root.clone();
    compress_input(
        &ffmpeg,
        ffprobe.as_deref(),
        &hardware,
        &input,
        &params,
        &output_root,
        &sanitize_root,
        Some(&progress),
    )
}

/// Inspección completa de cualquier archivo que FFmpeg entienda.
///
/// Es el "inspector de medios" y también la puerta de entrada del convertidor
/// universal: se acepta por contenido, no por extensión.
#[tauri::command]
pub async fn probe_any_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<MediaProbe, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let input_path = PathBuf::from(path.trim());
    if input_path.as_os_str().is_empty() || !input_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo no está en disco",
        ));
    }
    let value = probe_any_file_value(ffprobe.as_deref(), &input_path)?;
    Ok(MediaProbe::from_value(&input_path, &value))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: Option<f64>,
    pub format_name: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    /// Timecode de inicio SMPTE (NDF) del stream de video o del contenedor,
    /// tal como lo reporta ffprobe. `None` si la fuente no lo trae.
    pub timecode: Option<String>,
}

impl MediaProbe {
    pub(crate) fn from_value(path: &Path, value: &serde_json::Value) -> Self {
        let bytes = value["format"]["size"]
            .as_str()
            .and_then(|text| text.parse::<u64>().ok())
            .unwrap_or_else(|| std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0));
        let duration_seconds = value["format"]["duration"]
            .as_str()
            .and_then(|text| text.parse::<f64>().ok());
        let streams = value["streams"].as_array();
        let video =
            streams.and_then(|items| items.iter().find(|item| item["codec_type"] == "video"));
        let audio =
            streams.and_then(|items| items.iter().find(|item| item["codec_type"] == "audio"));
        Self {
            path: path.to_string_lossy().into_owned(),
            bytes,
            duration_seconds,
            format_name: value["format"]["format_name"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            width: video
                .and_then(|item| item["width"].as_u64())
                .map(|v| v as u32),
            height: video
                .and_then(|item| item["height"].as_u64())
                .map(|v| v as u32),
            video_codec: video
                .and_then(|item| item["codec_name"].as_str())
                .map(str::to_owned),
            audio_codec: audio
                .and_then(|item| item["codec_name"].as_str())
                .map(str::to_owned),
            // El timecode vive en los tags del stream de video (MXF/ProRes) o
            // del contenedor (MOV/MP4). Preferimos el del stream.
            timecode: video
                .and_then(|item| item["tags"]["timecode"].as_str())
                .or_else(|| value["format"]["tags"]["timecode"].as_str())
                .map(str::to_owned),
        }
    }
}

/// Corre ffprobe completo sobre un archivo. Falla si FFmpeg no puede leerlo:
/// ésa es la condición de aceptación del convertidor universal.
fn probe_any_file_value(
    ffprobe: Option<&Path>,
    path: &Path,
) -> Result<serde_json::Value, ProjectError> {
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible para inspeccionar el archivo",
        ));
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path);
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar ffprobe para inspeccionar el archivo",
        )
    })?;
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "FFmpeg no puede leer ese archivo: no es un medio soportado",
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "ffprobe devolvió una respuesta ilegible",
        )
    })?;
    Ok(value)
}

static VMAF_CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// ¿El build de FFmpeg trae el filtro libvmaf? Se consulta una sola vez por
/// proceso. Sin el filtro, la medición se oculta con el motivo en la UI.
fn vmaf_available(ffmpeg: &Path) -> bool {
    *VMAF_CACHE.get_or_init(|| vmaf_filter_available(ffmpeg))
}

/// ¿Este build de FFmpeg trae el filtro libvmaf? Medido, no asumido.
/// Resuelve las herramientas externas para otros módulos (capacidades).
pub fn resolve_tools_public(
    settings: &crate::state::Settings,
) -> (Option<PathBuf>, Option<PathBuf>, Option<PathBuf>) {
    crate::commands::system::resolve_tools(settings)
}

pub fn vmaf_filter_available(ffmpeg: &Path) -> bool {
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-filters"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    command
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(" libvmaf "))
        .unwrap_or(false)
}

/// Mide la calidad objetiva (VMAF) entre el original y el comprimido.
///
/// Devuelve `None` si el build de FFmpeg no trae libvmaf: la UI lo muestra como
/// "no disponible" en lugar de fingir un número. El compressed se re-escala al
/// tamaño del original, porque libvmaf exige la misma geometría.
#[tauri::command]
pub async fn measure_vmaf(
    state: State<'_, AppState>,
    original: String,
    compressed: String,
) -> Result<Option<f64>, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (Some(ffmpeg), Some(ffprobe), _) = resolve_tools(&settings) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para medir la calidad",
        ));
    };
    measure_vmaf_inner(&ffmpeg, Some(ffprobe.as_path()), &original, &compressed).await
}

async fn measure_vmaf_inner(
    ffmpeg: &Path,
    ffprobe: Option<&Path>,
    original: &str,
    compressed: &str,
) -> Result<Option<f64>, ProjectError> {
    if !vmaf_available(ffmpeg) {
        return Ok(None);
    }
    let original_path = PathBuf::from(original.trim());
    let compressed_path = PathBuf::from(compressed.trim());
    if !original_path.is_file() || !compressed_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el original o el comprimido no están en disco",
        ));
    }
    let value = probe_any_file_value(ffprobe, &original_path)?;
    let streams = value["streams"]
        .as_array()
        .and_then(|items| items.iter().find(|item| item["codec_type"] == "video"));
    let width = streams.and_then(|item| item["width"].as_u64()).unwrap_or(0);
    let height = streams
        .and_then(|item| item["height"].as_u64())
        .unwrap_or(0);
    if width == 0 || height == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el original no expone su resolución: no se puede medir VMAF",
        ));
    }

    let mut command = Command::new(&ffmpeg);
    command
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(&original_path)
        .args(["-i"])
        .arg(&compressed_path)
        .args([
            "-filter_complex",
            &format!("[1:v]scale={width}:{height}[comp];[0:v][comp]libvmaf"),
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para medir VMAF",
        )
    })?;
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "FFmpeg no pudo medir VMAF entre los dos archivos",
        ));
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let score = parse_vmaf_score(&stderr).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "FFmpeg terminó sin reportar un puntaje VMAF",
        )
    })?;
    Ok(Some((score * 100.0).round() / 100.0))
}

#[derive(Debug, Deserialize)]
pub struct CompressAnyRequest {
    /// Ruta absoluta del archivo a comprimir.
    pub input_path: String,
    pub output_dir: String,
    /// mp4, mkv o hevc.
    pub target: String,
    /// quality o size.
    pub mode: String,
    pub quality: Option<u8>,
    pub target_megabytes: Option<f64>,
    pub max_width: Option<u32>,
    pub audio_kbps: Option<u32>,
    pub encoder: Option<String>,
    pub enhance: Option<EnhanceOptions>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_hardware() -> HardwareEncoders {
        HardwareEncoders {
            h264: None,
            hevc: None,
            checked: true,
        }
    }

    #[test]
    fn media_probe_reads_format_and_streams() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{
                "streams": [
                    { "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080 },
                    { "codec_type": "audio", "codec_name": "aac" }
                ],
                "format": { "format_name": "mov,mp4,m4a", "duration": "12.5", "size": "10485760" }
            }"#,
        )
        .expect("json");
        let path = std::path::Path::new("C:////media////toma.mp4");
        let probe = MediaProbe::from_value(path, &value);
        assert_eq!(probe.bytes, 10_485_760);
        assert_eq!(probe.duration_seconds, Some(12.5));
        assert_eq!(probe.format_name, "mov,mp4,m4a");
        assert_eq!(probe.width, Some(1920));
        assert_eq!(probe.height, Some(1080));
        assert_eq!(probe.video_codec.as_deref(), Some("h264"));
        assert_eq!(probe.audio_codec.as_deref(), Some("aac"));
    }

    #[test]
    fn media_probe_sin_pistas_no_inventa_datos() {
        let value: serde_json::Value =
            serde_json::from_str(r#"{ "streams": [], "format": {} }"#).expect("json");
        let probe = MediaProbe::from_value(std::path::Path::new("x.mp4"), &value);
        assert_eq!(probe.video_codec, None);
        assert_eq!(probe.audio_codec, None);
        assert_eq!(probe.width, None);
        assert_eq!(probe.duration_seconds, None);
        assert_eq!(probe.format_name, "");
    }

    /// Prueba real de extremo a extremo: FFmpeg genera un video de prueba, la
    /// compresión por ruta lo reduce y el sondeo lo describe. Se activa con
    /// `EDITOR_IA_RUN_RENDER_TESTS=1` porque necesita FFmpeg y segundos de CPU.
    #[test]
    fn live_compress_any_file_reduces_a_generated_clip() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la compresión real");
            return;
        }
        let settings = crate::state::Settings::default();
        let (Some(ffmpeg), Some(ffprobe), _) = resolve_tools(&settings) else {
            eprintln!("FFmpeg no está disponible; se omite");
            return;
        };
        let dir = std::env::temp_dir().join(format!("editoria-compress-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta temporal");
        let source = dir.join("clip-fuente.mp4");
        let mut command = Command::new(&ffmpeg);
        command
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=1280x720:rate=30:duration=2",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source);
        crate::commands::hide_console(&mut command);
        let built = command.output().expect("correr ffmpeg");
        assert!(built.status.success(), "ffmpeg no generó el clip de prueba");
        let source_bytes = std::fs::metadata(&source).expect("metadata").len();
        assert!(source_bytes > 0);

        // El sondeo describe el clip.
        let value = probe_any_file_value(Some(&ffprobe), &source).expect("sondeo");
        let probe = MediaProbe::from_value(&source, &value);
        assert_eq!(probe.video_codec.as_deref(), Some("h264"));
        assert_eq!(probe.width, Some(1280));

        // Y la compresión por ruta produce un MP4 más liviano.
        let output_dir = dir.join("salida");
        std::fs::create_dir_all(&output_dir).expect("salida");
        let request = CompressAnyRequest {
            input_path: source.to_string_lossy().into_owned(),
            output_dir: output_dir.to_string_lossy().into_owned(),
            target: "mp4".to_owned(),
            mode: "quality".to_owned(),
            quality: Some(45),
            target_megabytes: None,
            max_width: None,
            audio_kbps: None,
            encoder: None,
            enhance: None,
        };
        let hardware = crate::commands::audio::HardwareEncoders {
            h264: None,
            hevc: None,
            checked: true,
        };
        let params = CompressParams {
            target: ConversionTarget::parse(&request.target).expect("mp4"),
            mode: &request.mode,
            quality: request.quality,
            target_megabytes: request.target_megabytes,
            audio_kbps: request.audio_kbps,
            encoder: request.encoder.as_deref(),
            max_width: request.max_width,
            enhance: request.enhance,
        };
        let input = CompressInput {
            path: source.clone(),
            kind: "video".to_owned(),
            label: source
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default(),
            source_bytes,
        };
        let result = compress_input(
            &ffmpeg,
            Some(&ffprobe),
            &hardware,
            &input,
            &params,
            &output_dir,
            &output_dir,
            None,
        )
        .expect("compresión");
        assert!(result.bytes > 0);
        assert!(result.bytes <= source_bytes, "no se redujo el peso");
        assert!(result.path.ends_with(".mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn progress_line_parsing_only_accepts_out_time() {
        assert_eq!(parse_out_time_us("out_time_us=1234567"), Some(1_234_567));
        assert_eq!(parse_out_time_us("out_time_us= 42 "), Some(42));
        assert_eq!(parse_out_time_us("progress=continue"), None);
        assert_eq!(parse_out_time_us("out_time_us=no"), None);
        assert_eq!(parse_out_time_us(""), None);
    }

    #[test]
    fn vmaf_score_extraction_from_stderr() {
        let stderr = "[libvmaf @ 0x0] VMAF score: 93.24\n otros datos";
        assert_eq!(parse_vmaf_score(stderr), Some(93.24));
        assert_eq!(parse_vmaf_score("sin puntaje"), None);
        assert_eq!(parse_vmaf_score("VMAF score: "), None);
    }

    /// VMAF real: genera original y comprimido, mide, y comprueba un puntaje
    /// razonable. Detrás de `EDITOR_IA_RUN_RENDER_TESTS` como las demás pruebas
    /// que necesitan FFmpeg.
    #[test]
    fn live_measure_vmaf_between_two_clips() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la medición VMAF");
            return;
        }
        let settings = crate::state::Settings::default();
        let (Some(ffmpeg), Some(ffprobe), _) = resolve_tools(&settings) else {
            eprintln!("FFmpeg no está disponible; se omite");
            return;
        };
        if !vmaf_available(&ffmpeg) {
            eprintln!("este build de FFmpeg no trae libvmaf; se omite");
            return;
        }
        let dir = std::env::temp_dir().join(format!("editoria-vmaf-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta temporal");
        let original = dir.join("original.mp4");
        let mut command = Command::new(&ffmpeg);
        command
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=640x360:rate=30:duration=1",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&original);
        crate::commands::hide_console(&mut command);
        assert!(command.output().expect("ffmpeg").status.success());
        let compressed = dir.join("comprimido.mp4");
        let mut command = Command::new(&ffmpeg);
        command
            .args(["-y", "-i"])
            .arg(&original)
            .args([
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "40",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&compressed);
        crate::commands::hide_console(&mut command);
        assert!(command.output().expect("ffmpeg").status.success());

        let score = tauri::async_runtime::block_on(measure_vmaf_inner(
            &ffmpeg,
            Some(&ffprobe),
            &original.to_string_lossy(),
            &compressed.to_string_lossy(),
        ))
        .expect("medición");
        let score = score.expect("el build tiene libvmaf");
        assert!(
            (0.0..=100.0).contains(&score),
            "puntaje fuera de rango: {score}"
        );
        // Un CRF 40 sobre el mismo material no debería destruirlo.
        assert!(score > 50.0, "puntaje sospechosamente bajo: {score}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn target_allowlist_maps_extensions_and_kinds() {
        assert_eq!(
            ConversionTarget::parse("JPEG").map(|t| t.extension()),
            Some("jpg")
        );
        assert_eq!(ConversionTarget::parse("exe"), None);
        assert_eq!(
            ConversionTarget::parse("mp4-hevc"),
            Some(ConversionTarget::Hevc)
        );
        assert!(ConversionTarget::Png.accepts("image"));
        assert!(ConversionTarget::Png.accepts("video"));
        assert!(!ConversionTarget::Png.accepts("audio"));
        assert!(ConversionTarget::Mp4.accepts("video"));
        assert!(!ConversionTarget::Mp4.accepts("image"));
        assert!(ConversionTarget::Mp3.accepts("audio"));
        assert!(ConversionTarget::Mp3.accepts("video"));
        assert!(ConversionTarget::Opus.accepts("audio"));
        assert!(ConversionTarget::Flac.accepts("audio"));
        assert!(!ConversionTarget::Flac.accepts("image"));
        assert!(ConversionTarget::Mkv.accepts("video"));
        assert!(!ConversionTarget::Mkv.accepts("audio"));
    }

    #[test]
    fn quality_maps_to_bounded_codec_values() {
        assert_eq!(crf_for_quality(1), 34);
        assert_eq!(crf_for_quality(100), 16);
        assert!(crf_for_quality(100) < crf_for_quality(1));
        assert_eq!(jpeg_qscale(100), 2);
        assert_eq!(jpeg_qscale(1), 31);
        assert!(webp_quality(100) > webp_quality(1));
        assert!(quality_bitrate_kbps(100) > quality_bitrate_kbps(1));
    }

    #[test]
    fn target_size_becomes_a_bitrate_budget() {
        // 10 MB en 60 s con audio a 128 kbps ⇒ ~1350 kbps de video.
        let kbps = video_bitrate_for_target(10.0, 60.0, 128);
        assert!((1_200..1_500).contains(&kbps), "kbps calculados: {kbps}");
        // Sin duración medida no se inventa nada: valor conservador.
        assert_eq!(video_bitrate_for_target(10.0, 0.0, 128), 2_000);
        assert_eq!(video_bitrate_for_target(0.0, 60.0, 128), 2_000);
    }

    #[test]
    fn stems_are_safe_and_keep_readable_names() {
        assert_eq!(safe_stem("Card verde.png"), "Card verde");
        assert_eq!(safe_stem("../../etc/passwd"), "passwd");
        assert_eq!(safe_stem("???"), "medio");
    }

    #[test]
    fn batch_names_never_collide() {
        let dir = std::env::temp_dir().join(format!("editoria-nombres-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let first = unique_output_path(&dir, "toma", "mp4");
        assert_eq!(first.file_name().unwrap(), "toma.mp4");
        std::fs::write(&first, b"x").expect("write");
        let second = unique_output_path(&dir, "toma", "mp4");
        assert_eq!(second.file_name().unwrap(), "toma-1.mp4");
        std::fs::write(&second, b"x").expect("write");
        let third = unique_output_path(&dir, "toma", "mp4");
        assert_eq!(third.file_name().unwrap(), "toma-2.mp4");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn enhance_filters_are_allowlisted() {
        let plain = EnhanceOptions::default();
        assert_eq!(video_filter_chain(None, plain), None);
        assert_eq!(audio_filter_chain(plain), None);

        let mejorado = EnhanceOptions {
            denoise: true,
            sharpen: true,
            normalize_audio: true,
        };
        let chain = video_filter_chain(Some(1280), mejorado).expect("cadena");
        assert!(chain.contains("min(1280,iw)"));
        assert!(chain.contains("hqdn3d"));
        assert!(chain.contains("unsharp"));
        assert_eq!(
            audio_filter_chain(mejorado).as_deref(),
            Some("loudnorm=I=-16:TP=-1.5:LRA=11")
        );
    }

    #[test]
    fn mp4_args_use_h264_and_never_the_shell() {
        let hardware = no_hardware();
        let (args, encoder) = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            ConversionTarget::Mp4,
            "video",
            ConvertOptions::simple(80, Some(1280)),
            &hardware,
        )
        .expect("args");
        assert_eq!(encoder, "libx264");
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.iter().any(|arg| arg.contains("min(1280,iw)")));
        assert!(args.contains(&"-crf".to_string()));
        assert!(!args.iter().any(|arg| arg == "sh" || arg == "-c"));
    }

    #[test]
    fn hardware_encoder_switches_to_bitrate_control() {
        let hardware = HardwareEncoders {
            h264: Some("h264_nvenc".into()),
            hevc: Some("hevc_nvenc".into()),
            checked: true,
        };
        let (args, encoder) = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            ConversionTarget::Mp4,
            "video",
            ConvertOptions {
                encoder: EncoderPref::Hardware,
                ..ConvertOptions::simple(80, None)
            },
            &hardware,
        )
        .expect("args");
        assert_eq!(encoder, "h264_nvenc");
        assert!(args.contains(&"h264_nvenc".to_string()));
        assert!(args.contains(&"-b:v".to_string()));
        assert!(!args.contains(&"-crf".to_string()));
    }

    #[test]
    fn hevc_target_uses_the_hevc_encoder_and_faststart() {
        let hardware = no_hardware();
        let (args, encoder) = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            ConversionTarget::Hevc,
            "video",
            ConvertOptions::simple(70, None),
            &hardware,
        )
        .expect("args");
        assert_eq!(encoder, "libx265");
        assert!(args.contains(&"libx265".to_string()));
        assert!(args.contains(&"+faststart".to_string()));
        assert_eq!(ConversionTarget::Hevc.extension(), "mp4");
    }

    #[test]
    fn audio_targets_map_to_their_codecs() {
        let hardware = no_hardware();
        for (target, codec) in [
            (ConversionTarget::Opus, "libopus"),
            (ConversionTarget::Flac, "flac"),
            (ConversionTarget::M4a, "aac"),
            (ConversionTarget::Mp3, "libmp3lame"),
        ] {
            let (args, encoder) = build_args(
                Path::new("in.mkv"),
                Path::new("out.bin"),
                target,
                "audio",
                ConvertOptions::simple(80, None),
                &hardware,
            )
            .expect("args");
            assert_eq!(encoder, codec);
            assert!(
                args.contains(&codec.to_string()),
                "{codec} faltaba en {args:?}"
            );
            assert!(args.contains(&"-vn".to_string()));
        }
    }

    #[test]
    fn image_targets_grab_a_single_frame_from_video() {
        let hardware = no_hardware();
        let (args, _) = build_args(
            Path::new("in.mp4"),
            Path::new("out.png"),
            ConversionTarget::Png,
            "video",
            ConvertOptions::simple(80, Some(640)),
            &hardware,
        )
        .expect("args");
        assert!(args.contains(&"-frames:v".to_string()));
        assert!(args.contains(&"png".to_string()));
    }

    #[test]
    fn live_conversion_produces_real_files() {
        if std::env::var("EDITORIA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let dir = std::env::temp_dir().join(format!("editoria-convert-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let input = dir.join("input.mp4");
        let source = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=64x64:d=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
            ])
            .arg(&input)
            .status()
            .expect("ffmpeg source");
        assert!(source.success());
        let hardware = no_hardware();
        let targets = [
            ConversionTarget::Png,
            ConversionTarget::Jpg,
            ConversionTarget::Webp,
            ConversionTarget::Mp4,
            ConversionTarget::Mkv,
            ConversionTarget::Webm,
            ConversionTarget::Mov,
            ConversionTarget::Gif,
            ConversionTarget::Mp3,
            ConversionTarget::Wav,
            ConversionTarget::Opus,
            ConversionTarget::Flac,
        ];
        for target in targets {
            let output = dir.join(format!("salida.{}", target.extension()));
            let (args, _) = build_args(
                &input,
                &output,
                target,
                "video",
                ConvertOptions::simple(70, Some(64)),
                &hardware,
            )
            .expect("build conversion args");
            let result = Command::new("ffmpeg")
                .args(&args)
                .output()
                .expect("ffmpeg run");
            assert!(
                result.status.success(),
                "{:?} falló: {}",
                target,
                String::from_utf8_lossy(&result.stderr)
            );
            let bytes = std::fs::metadata(&output).expect("output").len();
            assert!(bytes > 0, "{:?} produjo un archivo vacío", target);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
