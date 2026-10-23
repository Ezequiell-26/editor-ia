//! Denoise Studio: reducción de ruido de imagen y video.
//!
//! El preview en tiempo real vive en el frontend (shader WebGL sobre un proxy
//! visual). Este módulo hace el render de calidad con FFmpeg sobre el archivo
//! original, escribe a un temporal, verifica y recién entonces publica.
//!
//! Filtros allowlisted (FFmpeg 9.0.1 de esta máquina):
//! `hqdn3d` rápido, `atadenoise` temporal y `nlmeans` de alta calidad.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DenoisePreset {
    Fast,
    Balanced,
    Quality,
}

impl DenoisePreset {
    fn parse(value: Option<&str>) -> Result<Self, ProjectError> {
        match value
            .unwrap_or("balanced")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "fast" => Ok(Self::Fast),
            "balanced" => Ok(Self::Balanced),
            "quality" => Ok(Self::Quality),
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "preajuste de denoise inválido: usá fast, balanced o quality",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DenoiseMode {
    Video,
    Image,
}

impl DenoiseMode {
    fn parse(value: Option<&str>) -> Result<Self, ProjectError> {
        match value
            .unwrap_or("video")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "video" => Ok(Self::Video),
            "image" | "imagen" => Ok(Self::Image),
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "modo de denoise inválido: usá video o image",
            )),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Video => "mp4",
            Self::Image => "png",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DenoiseRequest {
    pub input_path: String,
    pub output_dir: Option<String>,
    pub mode: Option<String>,
    pub preset: Option<String>,
    pub strength: Option<u8>,
    pub temporal: Option<bool>,
    pub preserve_detail: Option<bool>,
}

impl Default for DenoiseRequest {
    fn default() -> Self {
        Self {
            input_path: String::new(),
            output_dir: None,
            mode: None,
            preset: None,
            strength: None,
            temporal: None,
            preserve_detail: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DenoiseResult {
    pub path: String,
    pub bytes: u64,
    pub source_bytes: u64,
    pub filter: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_seconds: Option<f64>,
}

/// Construye la cadena de filtros. Es pura para poder testearla sin FFmpeg.
pub(crate) fn denoise_filter(
    preset: DenoisePreset,
    strength: u8,
    temporal: bool,
    preserve_detail: bool,
) -> String {
    let base = (strength.clamp(1, 100) as f32) / 100.0;
    // Preservar detalle reduce la agresividad; nunca la sube.
    let amount = if preserve_detail { base * 0.72 } else { base };
    match preset {
        DenoisePreset::Fast => {
            let luma = 0.6 + amount * 2.8;
            let chroma = 0.4 + amount * 2.2;
            let luma_tmp = if temporal { 1.0 + amount * 4.0 } else { 0.0 };
            let chroma_tmp = if temporal { 0.8 + amount * 3.0 } else { 0.0 };
            format!("hqdn3d={luma:.2}:{chroma:.2}:{luma_tmp:.2}:{chroma_tmp:.2}")
        }
        DenoisePreset::Balanced => {
            let luma = 1.0 + amount * 4.5;
            let chroma = 0.8 + amount * 3.5;
            let luma_tmp = if temporal { 3.0 + amount * 9.0 } else { 0.0 };
            let chroma_tmp = if temporal { 2.0 + amount * 7.0 } else { 0.0 };
            format!("hqdn3d={luma:.2}:{chroma:.2}:{luma_tmp:.2}:{chroma_tmp:.2}")
        }
        DenoisePreset::Quality => {
            // nlmeans: s = fuerza, p = tamaño de parche, r = ventana de búsqueda.
            let s = 1.0 + amount * 9.0;
            format!("nlmeans=s={s:.2}:p=7:r=15")
        }
    }
}

fn unique_output(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let safe_stem: String = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == ' ' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let stem = safe_stem.trim().trim_matches('-');
    let stem = if stem.is_empty() { "archivo" } else { stem };
    let mut candidate = dir.join(format!("{stem}-denoise.{extension}"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-denoise-{index}.{extension}"));
        index += 1;
    }
    candidate
}

fn probe_media(ffprobe: Option<&Path>, path: &Path) -> (Option<f64>, Option<u32>, Option<u32>) {
    let Some(ffprobe) = ffprobe else {
        return (None, None, None);
    };
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
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return (None, None, None);
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return (None, None, None);
    };
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok());
    let stream = value["streams"].as_array().and_then(|items| items.first());
    let width = stream
        .and_then(|item| item["width"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    let height = stream
        .and_then(|item| item["height"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    (duration, width, height)
}

/// Reduce el ruido de una imagen o video del disco.
///
/// El archivo se escribe primero en un temporal oculto; si FFmpeg falla, el
/// temporal se borra y el original nunca se toca.
#[tauri::command]
pub async fn denoise_media(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DenoiseRequest,
) -> Result<DenoiseResult, ProjectError> {
    let input_path = PathBuf::from(request.input_path.trim());
    if input_path.as_os_str().is_empty() || !input_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo para denoise no está en disco",
        ));
    }
    let mode = DenoiseMode::parse(request.mode.as_deref())?;
    let preset = DenoisePreset::parse(request.preset.as_deref())?;
    let strength = request.strength.unwrap_or(55).clamp(1, 100);
    let temporal = request.temporal.unwrap_or(true);
    let preserve_detail = request.preserve_detail.unwrap_or(false);
    let filter = denoise_filter(preset, strength, temporal, preserve_detail);

    let source_bytes = std::fs::metadata(&input_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let output_dir = match request.output_dir.as_deref() {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => input_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
    };
    if !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del denoise no existe",
        ));
    }
    let stem = input_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let final_path = unique_output(&output_dir, &stem, mode.extension());
    let temp_path = output_dir.join(format!(".denoise-{}.{}", Uuid::new_v4(), mode.extension()));

    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para reducir ruido",
        ));
    };
    let (duration, _, _) = probe_media(ffprobe.as_deref(), &input_path);

    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&input_path);
    command.arg("-vf").arg(&filter);
    match mode {
        DenoiseMode::Video => {
            command.args([
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
            ]);
        }
        DenoiseMode::Image => {
            command.args(["-frames:v", "1", "-update", "1"]);
        }
    }
    command.args(["-progress", "pipe:1", "-nostats"]);
    command.arg(&temp_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para denoise: {error}").as_str(),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso el progreso")
    })?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso el log"))?;

    let stderr_handle = thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stderr)
            .take(64 * 1024)
            .read_to_string(&mut text);
        text
    });

    let total_seconds = duration.unwrap_or(0.0);
    let emitter = app.clone();
    let progress_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(microseconds) = value.trim().parse::<f64>() {
                    if total_seconds > 0.0 {
                        let percent = (microseconds / (total_seconds * 1_000_000.0) * 100.0)
                            .clamp(0.0, 100.0);
                        let _ = emitter.emit(
                            "denoise-progress",
                            serde_json::json!({ "percent": percent }),
                        );
                    }
                }
            }
        }
    });

    let status = child.wait().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("FFmpeg de denoise no terminó: {error}").as_str(),
        )
    })?;
    let _ = progress_handle.join();
    let stderr_text = stderr_handle.join().unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(&temp_path);
        let sanitized = sanitize_log(&stderr_text, &output_dir, 24);
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!("el denoise falló: {sanitized}").as_str(),
        ));
    }
    if std::fs::metadata(&temp_path)
        .map(|meta| meta.len())
        .unwrap_or(0)
        == 0
    {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no produjo un archivo de denoise válido",
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el archivo de denoise: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(&final_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let (output_duration, width, height) = probe_media(ffprobe.as_deref(), &final_path);
    let _ = app.emit("denoise-progress", serde_json::json!({ "percent": 100.0 }));
    Ok(DenoiseResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        source_bytes,
        filter,
        width,
        height,
        duration_seconds: output_duration.or(duration),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_filter_scales_with_strength_and_respects_temporal() {
        let soft = denoise_filter(DenoisePreset::Fast, 10, false, false);
        let strong = denoise_filter(DenoisePreset::Fast, 90, false, false);
        let temporal = denoise_filter(DenoisePreset::Fast, 90, true, false);
        assert!(soft.starts_with("hqdn3d="));
        assert!(strong.starts_with("hqdn3d="));
        assert_ne!(soft, strong);
        assert!(soft.ends_with(":0.00"));
        assert!(!temporal.ends_with(":0.00"));
    }

    #[test]
    fn quality_filter_uses_nlmeans_and_preserves_detail_reduces_it() {
        let normal = denoise_filter(DenoisePreset::Quality, 80, false, false);
        let gentle = denoise_filter(DenoisePreset::Quality, 80, false, true);
        assert!(normal.starts_with("nlmeans="));
        assert_ne!(normal, gentle);
    }

    #[test]
    fn invalid_preset_is_rejected() {
        assert!(DenoisePreset::parse(Some("ultra")).is_err());
        assert!(DenoisePreset::parse(Some("fast")).is_ok());
    }

    #[test]
    fn output_names_are_safe_and_unique() {
        let dir = std::env::temp_dir().join(format!("editoria-denoise-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("carpeta temporal");
        let first = unique_output(&dir, "clip: raro/../uno", "mp4");
        assert!(first.to_string_lossy().ends_with("-denoise.mp4"));
        std::fs::write(&first, b"x").expect("archivo de prueba");
        let second = unique_output(&dir, "clip: raro/../uno", "mp4");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().contains("-denoise-2.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
