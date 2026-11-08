//! Dominio puro de conversión, compresión y lote de exportación.
//!
//! Reglas de negocio sin I/O: allowlist de formatos, opciones de codec,
//! construcción del vector de argumentos de FFmpeg (nunca shell), nombres
//! seguros de salida, escalas de calidad/bitrate y parsing de progreso.
//! Los procesos, archivos y eventos viven en ports/infrastructure.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::HardwareEncoders;

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

pub(crate) fn quality_clamp(value: Option<u8>) -> u8 {
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
    if !(target_megabytes > 0.0 && duration_seconds > 0.0) {
        return 2_000;
    }
    let total_kbps = (target_megabytes * 1024.0 * 1024.0 * 8.0) / (duration_seconds * 1000.0);
    (total_kbps - audio_kbps as f64)
        .round()
        .clamp(50.0, 60_000.0) as u32
}

pub(crate) fn scale_filter(max_width: Option<u32>) -> Option<String> {
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

pub(crate) fn h264_encoder(hardware: &HardwareEncoders, pref: EncoderPref) -> String {
    match pref {
        EncoderPref::Software => "libx264".to_string(),
        EncoderPref::Hardware | EncoderPref::Auto => hardware
            .h264
            .clone()
            .unwrap_or_else(|| "libx264".to_string()),
    }
}

pub(crate) fn hevc_encoder(hardware: &HardwareEncoders, pref: EncoderPref) -> String {
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
pub(crate) fn is_hardware_encoder(encoder: &str) -> bool {
    !(encoder.starts_with("libx264") || encoder.starts_with("libx265"))
}

pub(crate) fn push_bitrate(args: &mut Vec<String>, kbps: u32) {
    args.extend([
        "-b:v".into(),
        format!("{kbps}k"),
        "-maxrate".into(),
        format!("{}k", (kbps as f64 * 1.5).round() as u32),
        "-bufsize".into(),
        format!("{}k", kbps * 2),
    ]);
}

pub(crate) fn push_rate_control(args: &mut Vec<String>, options: ConvertOptions, encoder: &str) {
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
pub(crate) fn safe_stem(label: &str) -> String {
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
/// `out_time_us=1234567` de las líneas `-progress`: microsegundos procesados.
pub(crate) fn parse_out_time_us(line: &str) -> Option<u64> {
    let value = line.strip_prefix("out_time_us=")?;
    value.trim().parse::<u64>().ok()
}
pub struct LiveProgress {
    pub total_seconds: f64,
    pub emit: std::sync::Arc<dyn Fn(f64) + Send + Sync>,
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
pub(crate) struct CompressParams<'a> {
    pub(crate) target: ConversionTarget,
    pub(crate) mode: &'a str,
    pub(crate) quality: Option<u8>,
    pub(crate) target_megabytes: Option<f64>,
    pub(crate) audio_kbps: Option<u32>,
    pub(crate) encoder: Option<&'a str>,
    pub(crate) max_width: Option<u32>,
    pub(crate) enhance: Option<EnhanceOptions>,
}

/// El material a comprimir, ya resuelto a una ruta real en disco.
pub(crate) struct CompressInput {
    pub(crate) path: PathBuf,
    pub(crate) kind: String,
    pub(crate) label: String,
    pub(crate) source_bytes: u64,
}

/// Valida target y modo de compresión (la carpeta se chequea aparte: es I/O).
pub(crate) fn validate_compress_target_mode(
    request_target: &str,
    request_mode: &str,
) -> Result<(ConversionTarget, String), ProjectError> {
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
    Ok((target, mode))
}

/// Parsea la salida JSON de ffprobe `-show_entries format=...` a
/// (bytes, duración, nombre de formato). Pura: el proceso lo corre el runner.
pub(crate) fn parse_probe_result(stdout: &[u8], fallback_bytes: u64) -> (u64, Option<f64>, String) {
    let text = String::from_utf8_lossy(stdout);
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let format = parsed["format"].clone();
    let duration = format["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok());
    let format_name = format["format_name"].as_str().unwrap_or("").to_string();
    let size = format["size"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(fallback_bytes);
    (size, duration, format_name)
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

/// Petición de compresión de un archivo suelto del disco (sin proyecto).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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
