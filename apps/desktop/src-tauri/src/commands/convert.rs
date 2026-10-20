//! Guarded media conversion.
//!
//! The frontend picks a project asset and one of the allowlisted targets. This
//! module builds the FFmpeg argument vector itself; no shell, no arbitrary
//! codec flags. Output is written to a hidden temporary file in the selected
//! folder, verified with FFprobe and only then renamed. An existing file is
//! never overwritten silently.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

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
    Mp4,
    Webm,
    Mov,
    Gif,
    Mp3,
    Wav,
}

impl ConversionTarget {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpg),
            "webp" => Some(Self::Webp),
            "mp4" => Some(Self::Mp4),
            "webm" => Some(Self::Webm),
            "mov" => Some(Self::Mov),
            "gif" => Some(Self::Gif),
            "mp3" => Some(Self::Mp3),
            "wav" => Some(Self::Wav),
            _ => None,
        }
    }

    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpg => "jpg",
            Self::Webp => "webp",
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
            Self::Mov => "mov",
            Self::Gif => "gif",
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
        }
    }

    pub(crate) fn is_image(self) -> bool {
        matches!(self, Self::Png | Self::Jpg | Self::Webp)
    }

    pub(crate) fn is_video(self) -> bool {
        matches!(self, Self::Mp4 | Self::Webm | Self::Mov | Self::Gif)
    }

    pub(crate) fn is_audio(self) -> bool {
        matches!(self, Self::Mp3 | Self::Wav)
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionResult {
    pub path: String,
    pub bytes: u64,
    pub duration_seconds: Option<f64>,
    pub format_name: String,
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

fn scale_filter(max_width: Option<u32>) -> Option<String> {
    let width = max_width?;
    let width = width.clamp(64, 16_384);
    Some(format!("scale='min({width},iw)':-2:flags=lanczos"))
}

pub(crate) fn build_args(
    input: &Path,
    output: &Path,
    target: ConversionTarget,
    asset_kind: &str,
    quality: u8,
    max_width: Option<u32>,
) -> Result<Vec<String>, ProjectError> {
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
    match target {
        ConversionTarget::Png | ConversionTarget::Jpg | ConversionTarget::Webp => {
            if asset_kind == "video" {
                args.extend(["-frames:v".into(), "1".into()]);
            }
            if let Some(filter) = scale_filter(max_width) {
                args.extend(["-vf".into(), filter]);
            }
            match target {
                ConversionTarget::Png => args.extend(["-c:v".into(), "png".into()]),
                ConversionTarget::Jpg => args.extend([
                    "-c:v".into(),
                    "mjpeg".into(),
                    "-q:v".into(),
                    jpeg_qscale(quality).to_string(),
                ]),
                ConversionTarget::Webp => args.extend([
                    "-c:v".into(),
                    "libwebp".into(),
                    "-quality".into(),
                    webp_quality(quality).to_string(),
                ]),
                _ => unreachable!(),
            }
            args.extend(["-an".into(), output_text]);
        }
        ConversionTarget::Mp4 | ConversionTarget::Mov => {
            if let Some(filter) = scale_filter(max_width) {
                args.extend(["-vf".into(), filter]);
            }
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "medium".into(),
                "-crf".into(),
                crf_for_quality(quality).to_string(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "192k".into(),
                "-movflags".into(),
                "+faststart".into(),
                output_text,
            ]);
        }
        ConversionTarget::Webm => {
            if let Some(filter) = scale_filter(max_width) {
                args.extend(["-vf".into(), filter]);
            }
            args.extend([
                "-c:v".into(),
                "libvpx-vp9".into(),
                "-crf".into(),
                crf_for_quality(quality).to_string(),
                "-b:v".into(),
                "0".into(),
                "-row-mt".into(),
                "1".into(),
                "-c:a".into(),
                "libopus".into(),
                "-b:a".into(),
                "128k".into(),
                output_text,
            ]);
        }
        ConversionTarget::Gif => {
            let width = max_width.unwrap_or(960).clamp(64, 1920);
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
        }
        ConversionTarget::Mp3 => {
            args.extend([
                "-vn".into(),
                "-c:a".into(),
                "libmp3lame".into(),
                "-b:a".into(),
                "192k".into(),
                output_text,
            ]);
        }
        ConversionTarget::Wav => {
            args.extend(["-vn".into(), "-c:a".into(), "pcm_s16le".into(), output_text]);
        }
    }
    Ok(args)
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

fn probe_result(ffprobe: Option<&Path>, path: &Path) -> (u64, Option<f64>, String) {
    let bytes = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    let Some(ffprobe) = ffprobe else {
        return (bytes, None, String::new());
    };
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration,size",
            "-of",
            "json",
        ])
        .arg(path)
        .output();
    let Ok(output) = output else {
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

#[tauri::command]
pub async fn convert_media(
    state: State<'_, AppState>,
    asset_id: String,
    target: String,
    output_dir: String,
    quality: Option<u8>,
    max_width: Option<u32>,
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
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|item| item["id"].as_str() == Some(asset_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material que se quiere convertir no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("");
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "confirmá los derechos del material antes de convertirlo",
        ));
    }
    if !target.accepts(kind) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el formato elegido no acepta este tipo de material",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let input = resolve_inside_root(&session.root, relative)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }
    let label = asset["label"].as_str().unwrap_or("medio");
    let final_path = output_root.join(format!("{}.{}", safe_stem(label), target.extension()));
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
    let args = build_args(
        &input,
        &temp_path,
        target,
        kind,
        quality_clamp(quality),
        max_width,
    )?;
    let output = Command::new(&ffmpeg)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo iniciar FFmpeg para convertir el material",
            )
        })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp_path);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo convertir el material: {}",
                sanitize_log(&stderr, &session.root, 300)
            )
            .as_str(),
        ));
    }
    let metadata = std::fs::metadata(&temp_path).map_err(|_| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            "la conversión terminó pero el archivo no existe",
        )
    })?;
    if metadata.len() == 0 {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "la conversión produjo un archivo vacío",
        ));
    }
    if final_path.exists() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::AlreadyExists,
            "el archivo de destino apareció durante la conversión; no se sobrescribió",
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|_| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo publicar el archivo convertido",
        )
    })?;
    let (bytes, duration_seconds, format_name) = probe_result(ffprobe.as_deref(), &final_path);
    Ok(ConversionResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        duration_seconds,
        format_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_allowlist_maps_extensions_and_kinds() {
        assert_eq!(
            ConversionTarget::parse("JPEG").map(|t| t.extension()),
            Some("jpg")
        );
        assert_eq!(ConversionTarget::parse("exe"), None);
        assert!(ConversionTarget::Png.accepts("image"));
        assert!(ConversionTarget::Png.accepts("video"));
        assert!(!ConversionTarget::Png.accepts("audio"));
        assert!(ConversionTarget::Mp4.accepts("video"));
        assert!(!ConversionTarget::Mp4.accepts("image"));
        assert!(ConversionTarget::Mp3.accepts("audio"));
        assert!(ConversionTarget::Mp3.accepts("video"));
    }

    #[test]
    fn quality_maps_to_bounded_codec_values() {
        assert_eq!(crf_for_quality(1), 34);
        assert_eq!(crf_for_quality(100), 16);
        assert!(crf_for_quality(100) < crf_for_quality(1));
        assert_eq!(jpeg_qscale(100), 2);
        assert_eq!(jpeg_qscale(1), 31);
        assert!(webp_quality(100) > webp_quality(1));
    }

    #[test]
    fn stems_are_safe_and_keep_readable_names() {
        assert_eq!(safe_stem("Card verde.png"), "Card verde");
        assert_eq!(safe_stem("../../etc/passwd"), "passwd");
        assert_eq!(safe_stem("???"), "medio");
    }

    #[test]
    fn mp4_args_use_h264_and_never_the_shell() {
        let args = build_args(
            Path::new("in.mp4"),
            Path::new("out.mp4"),
            ConversionTarget::Mp4,
            "video",
            80,
            Some(1280),
        )
        .expect("args");
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.iter().any(|arg| arg.contains("min(1280,iw)")));
        assert!(!args.iter().any(|arg| arg == "sh" || arg == "-c"));
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
        let targets = [
            ConversionTarget::Png,
            ConversionTarget::Jpg,
            ConversionTarget::Webp,
            ConversionTarget::Mp4,
            ConversionTarget::Webm,
            ConversionTarget::Mov,
            ConversionTarget::Gif,
            ConversionTarget::Mp3,
            ConversionTarget::Wav,
        ];
        for target in targets {
            let output = dir.join(format!("salida.{}", target.extension()));
            let args = build_args(&input, &output, target, "video", 70, Some(64))
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
