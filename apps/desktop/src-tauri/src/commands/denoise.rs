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
///
/// El FFmpeg empaquetado es LGPL y **no trae `hqdn3d`** (tampoco `vaguedenoiser`
/// ni `owdenoise`), así que el denoise espacial va con `dctdnoiz` (rápido) o
/// `nlmeans` (calidad), y el temporal con `atadenoise`. Todos verificados contra
/// el binario que viaja con el instalador.
pub(crate) fn denoise_filter(
    preset: DenoisePreset,
    strength: u8,
    temporal: bool,
    preserve_detail: bool,
) -> String {
    let base = (strength.clamp(1, 100) as f32) / 100.0;
    // Preservar detalle reduce la agresividad; nunca la sube.
    let amount = if preserve_detail { base * 0.72 } else { base };
    // `atadenoise` solo acepta tamaños de ventana impares entre 3 y 9.
    let window = (3 + ((amount * 6.0).round() as u32)) | 1;
    let temporal_stage = if temporal {
        format!("atadenoise=s={window},")
    } else {
        String::new()
    };
    match preset {
        DenoisePreset::Fast => {
            // dctdnoiz: DCT 8×8, sigma alto = más limpieza.
            let sigma = 1.5 + amount * 4.5;
            format!("{temporal_stage}dctdnoiz=sigma={sigma:.2}")
        }
        DenoisePreset::Balanced => {
            let sigma = 2.5 + amount * 7.5;
            format!("{temporal_stage}dctdnoiz=sigma={sigma:.2}")
        }
        DenoisePreset::Quality => {
            // nlmeans: s = fuerza, p = tamaño de parche, r = ventana de búsqueda.
            let s = 1.0 + amount * 9.0;
            format!("{temporal_stage}nlmeans=s={s:.2}:p=7:r=15")
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

fn probe_media(
    ffprobe: Option<&Path>,
    path: &Path,
) -> (Option<f64>, Option<u32>, Option<u32>, Option<f64>) {
    let Some(ffprobe) = ffprobe else {
        return (None, None, None, None);
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return (None, None, None, None);
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return (None, None, None, None);
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
    let fps = stream
        .and_then(|item| item["r_frame_rate"].as_str())
        .and_then(|ratio| {
            let (num, den) = ratio.split_once('/')?;
            let den = den.parse::<f64>().ok()?;
            if den <= 0.0 {
                return None;
            }
            let num = num.parse::<f64>().ok()?;
            if num <= 0.0 {
                return None;
            }
            Some(num / den)
        });
    (duration, width, height, fps)
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
    let (duration, width, height, fps) = probe_media(ffprobe.as_deref(), &input_path);

    let mut command = Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&input_path);
    command.arg("-vf").arg(&filter);
    match mode {
        DenoiseMode::Video => {
            // El FFmpeg empaquetado no tiene libx264: se elige el primer encoder
            // H.264 que realmente funcione (NVENC, AMF, QSV u OpenH264).
            let encoder = crate::commands::sharpen::resolve_encoder(&ffmpeg)?;
            command.args([
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
            ]);
            command.args(crate::commands::sharpen::video_codec_args(
                &encoder,
                18,
                width.unwrap_or(1920),
                height.unwrap_or(1080),
                fps.unwrap_or(30.0),
            ));
            command.args([
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
    let (output_duration, width, height, _) = probe_media(ffprobe.as_deref(), &final_path);
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
        // El FFmpeg empaquetado no trae hqdn3d: el espacial es dctdnoiz.
        assert!(soft.starts_with("dctdnoiz=sigma="));
        assert!(strong.starts_with("dctdnoiz=sigma="));
        assert_ne!(soft, strong);
        assert!(temporal.starts_with("atadenoise=s="));
        assert!(!soft.contains("hqdn3d"));
    }

    #[test]
    fn balanced_adds_the_temporal_stage_before_the_spatial_one() {
        let balanced = denoise_filter(DenoisePreset::Balanced, 60, true, false);
        let pos_atadenoise = balanced.find("atadenoise=").expect("etapa temporal");
        let pos_dct = balanced.find("dctdnoiz=").expect("etapa espacial");
        // La limpieza temporal va antes: si no, el dctdnoiz fijaría el ruido.
        assert!(pos_atadenoise < pos_dct);
    }

    #[test]
    fn temporal_window_is_always_an_odd_size_within_range() {
        for strength in [1u8, 25, 50, 75, 100] {
            let filter = denoise_filter(DenoisePreset::Fast, strength, true, false);
            let size = filter
                .split("atadenoise=s=")
                .nth(1)
                .and_then(|rest| rest.split(',').next())
                .and_then(|value| value.parse::<u32>().ok())
                .expect("ventana parseable");
            assert!((3..=9).contains(&size) && size % 2 == 1);
        }
    }

    #[test]
    fn quality_filter_uses_nlmeans_and_preserves_detail_reduces_it() {
        let normal = denoise_filter(DenoisePreset::Quality, 80, false, false);
        let gentle = denoise_filter(DenoisePreset::Quality, 80, false, true);
        assert!(normal.starts_with("nlmeans="));
        assert_ne!(normal, gentle);
    }

    /// Render real con el FFmpeg empaquetado: la cadena no debe nombrar filtros
    /// que no existen (`hqdn3d` no está en el build LGPL) y el encoder se
    /// resuelve igual que en Definición. Detrás de `EDITOR_IA_RUN_RENDER_TESTS`.
    #[test]
    fn live_chain_renders_without_missing_filters() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el render real");
            return;
        }
        let ffmpeg = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("ffmpeg")
            .join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
        assert!(ffmpeg.is_file(), "falta el FFmpeg de recursos");

        let encoder = crate::commands::sharpen::resolve_encoder(&ffmpeg).expect("encoder H.264 disponible");
        let output =
            std::env::temp_dir().join(format!("editoria-denoise-{}.mp4", Uuid::new_v4()));
        let mut status_ok = true;
        let mut log = String::new();
        for preset in [DenoisePreset::Fast, DenoisePreset::Balanced, DenoisePreset::Quality] {
            let filter = denoise_filter(preset, 55, true, false);
            let mut command = Command::new(&ffmpeg);
            command.args([
                "-hide_banner",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=1280x720:r=25:d=0.4",
                "-vf",
                &filter,
                "-map",
                "0:v:0",
            ]);
            command.args(crate::commands::sharpen::video_codec_args(&encoder, 18, 1280, 720, 25.0));
            command.args(["-an", "-movflags", "+faststart"]);
            command.arg(&output);
            command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped());
            hide_console(&mut command);
            let result = command.output().expect("FFmpeg arrancó");
            log = String::from_utf8_lossy(&result.stderr).into_owned();
            status_ok = result.status.success();
            assert!(
                status_ok,
                "el preset {preset:?} falló con encoder {encoder}: {log}"
            );
        }

        let info = probe_media(
            Some(&ffmpeg.with_file_name(if cfg!(windows) {
                "ffprobe.exe"
            } else {
                "ffprobe"
            })),
            &output,
        );
        assert_eq!(info.1, Some(1280), "ancho inesperado");
        assert_eq!(info.2, Some(720), "alto inesperado");
        assert!(
            std::fs::metadata(&output).map(|meta| meta.len()).unwrap_or(0) > 5_000,
            "el archivo salió vacío"
        );
        let _ = std::fs::remove_file(&output);
        assert!(status_ok, "log final: {log}");
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
