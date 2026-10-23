//! Doblaje local de un video con voces SAPI.
//!
//! El flujo es deliberadamente local y acotado: se sintetiza cada subtítulo a
//! WAV, se ajusta su duración a la ventana del cue con `atempo`/`atrim`, se
//! coloca en una base silenciosa con `adelay` y se mezcla con `amix`. El video
//! se copia sin re-encodear; el audio original se reemplaza. No hay clonación
//! de voz ni traducción: las cues llegan ya traducidas.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::narration::{sapi_voices, synthesize_sapi_wav, VoiceInfo};
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_CUES: usize = 60;
const MAX_TOTAL_CHARS: usize = 20_000;
const MAX_CUE_CHARS: usize = 1_000;
const MAX_DURATION_SECONDS: f64 = 900.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DubCue {
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynthesizeDubRequest {
    /// Ruta del video relativa a la carpeta del proyecto.
    pub path: String,
    pub output_dir: String,
    pub language: String,
    #[serde(default)]
    pub voice: Option<String>,
    pub cues: Vec<DubCue>,
    /// Fin del video doblado. Si se omite, termina en la última cue + 0,4 s.
    #[serde(default)]
    pub end_seconds: Option<f64>,
    /// Volumen 0–1 del audio original como cama (música/SFX). 0 lo reemplaza.
    #[serde(default)]
    pub bed_volume: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DubResult {
    pub path: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    pub duration_seconds: f64,
    pub language: String,
    pub voice: String,
    pub cues: u32,
    pub replaced_original_audio: bool,
    pub original_audio_volume: f64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct DubSegment {
    start: f64,
    end: f64,
    wav: PathBuf,
    duration: f64,
}

pub(crate) fn normalize_language(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "es" | "es-ar" | "es-mx" | "es-es" => Some("es"),
        "en" | "en-us" | "en-gb" => Some("en"),
        "pt" | "pt-br" | "pt-pt" => Some("pt"),
        "fr" | "fr-fr" => Some("fr"),
        "de" | "de-de" => Some("de"),
        "it" | "it-it" => Some("it"),
        "zh" | "zh-cn" | "zh-tw" => Some("zh"),
        "hi" | "hi-in" => Some("hi"),
        "ar" | "ar-sa" => Some("ar"),
        "bn" | "bn-bd" | "bn-in" => Some("bn"),
        "ru" | "ru-ru" => Some("ru"),
        _ => None,
    }
}

fn language_label(code: &str) -> String {
    match code {
        "es" => "español",
        "en" => "inglés",
        "pt" => "portugués",
        "fr" => "francés",
        "de" => "alemán",
        "it" => "italiano",
        "zh" => "chino",
        "hi" => "hindi",
        "ar" => "árabe",
        "bn" => "bengalí",
        "ru" => "ruso",
        _ => code,
    }
    .to_owned()
}

/// Valida, normaliza y ordena las cues. Rechaza solapamientos grandes para no
/// mezclar dos voces hablando a la vez.
pub(crate) fn validate_cues(cues: &[DubCue]) -> Result<Vec<DubCue>, ProjectError> {
    if cues.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no hay subtítulos para doblar",
        ));
    }
    if cues.len() > MAX_CUES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("el doblaje admite hasta {MAX_CUES} subtítulos por corrida"),
        ));
    }
    let mut total = 0usize;
    let mut cleaned = Vec::with_capacity(cues.len());
    for (index, cue) in cues.iter().enumerate() {
        let text = cue.text.replace('\n', " ").trim().to_owned();
        if text.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el subtítulo {} llegó vacío", index + 1),
            ));
        }
        if text.chars().count() > MAX_CUE_CHARS {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!(
                    "el subtítulo {} supera los {MAX_CUE_CHARS} caracteres",
                    index + 1
                ),
            ));
        }
        total += text.chars().count();
        if !cue.start_seconds.is_finite()
            || !cue.end_seconds.is_finite()
            || cue.start_seconds < 0.0
            || cue.end_seconds <= cue.start_seconds
        {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el subtítulo {} tiene tiempos inválidos", index + 1),
            ));
        }
        if cue.end_seconds > MAX_DURATION_SECONDS {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!(
                    "el subtítulo {} termina después de los {MAX_DURATION_SECONDS:.0} s",
                    index + 1
                ),
            ));
        }
        cleaned.push(DubCue {
            start_seconds: cue.start_seconds,
            end_seconds: cue.end_seconds,
            text,
        });
    }
    if total > MAX_TOTAL_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("el doblaje supera los {MAX_TOTAL_CHARS} caracteres"),
        ));
    }
    cleaned.sort_by(|a, b| a.start_seconds.total_cmp(&b.start_seconds));
    for pair in cleaned.windows(2) {
        let previous = &pair[0];
        let next = &pair[1];
        if next.start_seconds < previous.end_seconds - 0.10 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "hay subtítulos solapados; separalos antes de doblar",
            ));
        }
    }
    Ok(cleaned)
}

pub(crate) fn dub_end_seconds(
    cues: &[DubCue],
    requested: Option<f64>,
    source_duration: Option<f64>,
) -> f64 {
    let last = cues
        .iter()
        .map(|cue| cue.end_seconds)
        .fold(0.0_f64, f64::max);
    let mut end = requested
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(last + 0.4)
        .max(last + 0.05);
    if let Some(source) = source_duration.filter(|value| value.is_finite() && *value > 0.0) {
        end = end.min(source);
    }
    end.max(0.2)
}

/// Construye el filtro de mezcla. `segments` ya tiene los WAV medidos. Si una
/// voz no entra en su ventana se acelera hasta 1.35× y, si aún no entra, se
/// recorta con un fade corto; el motivo se devuelve en `warnings`.
pub(crate) fn build_dub_filter(
    segments: &[DubSegment],
    end_seconds: f64,
    bed_volume: Option<f64>,
) -> (String, Vec<String>) {
    let mut parts = vec![format!(
        "anullsrc=channel_layout=stereo:sample_rate=48000:duration={end_seconds:.3}[base]"
    )];
    let mut warnings = Vec::new();
    let bed = bed_volume
        .filter(|volume| volume.is_finite() && *volume > 0.0)
        .map(|volume| volume.clamp(0.0, 1.0));
    if let Some(volume) = bed {
        parts.push(format!(
            "[0:a]aformat=channel_layouts=stereo:sample_rates=48000,volume={volume:.3}[bed]"
        ));
    }
    for (index, segment) in segments.iter().enumerate() {
        let window = (segment.end - segment.start).max(0.2);
        let mut chain = String::from("aformat=channel_layouts=stereo:sample_rates=48000");
        let mut duration = segment.duration;
        if duration > window * 1.02 {
            let tempo = (duration / window).clamp(1.01, 1.35);
            chain.push_str(&format!(",atempo={tempo:.3}"));
            duration /= tempo;
            if duration > window + 0.02 {
                let fade_start = (window - 0.06).max(0.0);
                chain.push_str(&format!(
                    ",atrim=duration={window:.3},afade=t=out:st={fade_start:.3}:d=0.06"
                ));
                warnings.push(format!(
                    "La voz {} se acortó para entrar en su ventana de {window:.1} s.",
                    index + 1
                ));
            }
        }
        let delay_ms = (segment.start * 1000.0).round().max(0.0) as i64;
        chain.push_str(&format!(
            ",asetpts=PTS-STARTPTS,adelay={delay_ms}|{delay_ms}"
        ));
        parts.push(format!("[{}:a]{chain}[a{index}]", index + 1));
    }
    let labels: String = (0..segments.len())
        .map(|index| format!("[a{index}]"))
        .collect();
    let bed_label = if bed.is_some() { "[bed]" } else { "" };
    parts.push(format!(
        "[base]{bed_label}{labels}amix=inputs={}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]",
        segments.len() + 1 + usize::from(bed.is_some())
    ));
    (parts.join(";"), warnings)
}

fn probe_json(ffprobe: &Path, path: &Path) -> Option<serde_json::Value> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=width,height,codec_type:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let output = command.output().ok()?;
    serde_json::from_slice(&output.stdout).ok()
}

pub(crate) fn probe_audio_duration(ffprobe: &Path, path: &Path) -> Option<f64> {
    let value = probe_json(ffprobe, path)?;
    value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
}

fn probe_video(ffprobe: &Path, path: &Path) -> (Option<u32>, Option<u32>, Option<f64>) {
    let Some(value) = probe_json(ffprobe, path) else {
        return (None, None, None);
    };
    let stream = value["streams"].as_array().and_then(|items| {
        items
            .iter()
            .find(|item| item["codec_type"].as_str() == Some("video"))
    });
    let width = stream
        .and_then(|item| item["width"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    let height = stream
        .and_then(|item| item["height"].as_u64())
        .and_then(|value| u32::try_from(value).ok());
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0);
    (width, height, duration)
}

fn unique_output(dir: &Path, stem: &str, language: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}-dub-{language}.mp4"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-dub-{language}-{index}.mp4"));
        index += 1;
    }
    candidate
}

fn safe_stem(value: &str) -> String {
    let mapped: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if trimmed.is_empty() {
        "video".to_owned()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn source_has_audio(ffprobe: &Path, path: &Path) -> bool {
    let Some(value) = probe_json(ffprobe, path) else {
        return false;
    };
    value["streams"]
        .as_array()
        .map(|streams| {
            streams
                .iter()
                .any(|stream| stream["codec_type"].as_str() == Some("audio"))
        })
        .unwrap_or(false)
}

/// Núcleo testeable del doblaje. No valida la ruta del proyecto: eso lo hace
/// el comando antes de llamarlo.
#[allow(clippy::too_many_arguments)]
pub(crate) fn synthesize_dub_file(
    app: Option<&AppHandle>,
    powershell: &Path,
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output_dir: &Path,
    language: &str,
    voice: &str,
    cues: &[DubCue],
    end_seconds: f64,
    bed_volume: Option<f64>,
) -> Result<DubResult, ProjectError> {
    let temp = std::env::temp_dir().join(format!("editoria-dub-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&temp).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el doblaje: {error}").as_str(),
        )
    })?;
    let result = (|| -> Result<DubResult, ProjectError> {
        let mut segments: Vec<DubSegment> = Vec::with_capacity(cues.len());
        for (index, cue) in cues.iter().enumerate() {
            let wav = temp.join(format!("cue-{index:04}.wav"));
            synthesize_sapi_wav(powershell, &cue.text, voice, &wav)?;
            let duration = probe_audio_duration(ffprobe, &wav).ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "no se pudo medir la voz generada para un subtítulo",
                )
            })?;
            segments.push(DubSegment {
                start: cue.start_seconds,
                end: cue.end_seconds,
                wav,
                duration,
            });
            if let Some(app) = app {
                let percent = ((index + 1) as f64 / cues.len() as f64 * 70.0).min(70.0);
                let _ = app.emit("dub-progress", serde_json::json!({ "percent": percent }));
            }
        }
        let requested_bed = bed_volume
            .filter(|volume| volume.is_finite() && *volume > 0.0)
            .map(|volume| volume.clamp(0.0, 1.0));
        let has_audio = source_has_audio(ffprobe, input);
        let effective_bed = requested_bed.filter(|_| has_audio);
        let (filter, mut warnings) = build_dub_filter(&segments, end_seconds, effective_bed);
        if requested_bed.is_some() && !has_audio {
            warnings
                .push("El video no tiene audio original; se dobló sin cama musical.".to_owned());
        }
        let stem = input
            .file_stem()
            .map(|value| safe_stem(&value.to_string_lossy()))
            .unwrap_or_else(|| "video".to_owned());
        let final_path = unique_output(output_dir, &stem, language);
        let temp_path = output_dir.join(format!(".dub-{}.mp4", Uuid::new_v4()));
        let mut command = Command::new(ffmpeg);
        command
            .args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
            .arg(input);
        for segment in &segments {
            command.arg("-i").arg(&segment.wav);
        }
        command
            .args([
                "-filter_complex",
                &filter,
                "-map",
                "0:v:0",
                "-map",
                "[aout]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-t",
                &format!("{end_seconds:.3}"),
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
            ])
            .arg(&temp_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let mut child = command.spawn().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo iniciar FFmpeg para el doblaje: {error}").as_str(),
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso su progreso")
        })?;
        let progress_app = app.cloned();
        let progress_thread = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let raw = line
                    .strip_prefix("out_time_us=")
                    .or_else(|| line.strip_prefix("out_time_ms="));
                let Some(raw) = raw else { continue };
                let Ok(micros) = raw.trim().parse::<f64>() else {
                    continue;
                };
                if micros < 0.0 {
                    continue;
                }
                let percent = (70.0 + micros / 1_000_000.0 / end_seconds * 30.0).clamp(70.0, 99.0);
                if let Some(app) = progress_app.as_ref() {
                    let _ = app.emit("dub-progress", serde_json::json!({ "percent": percent }));
                }
            }
        });
        let status = child.wait();
        let mut stderr = String::new();
        if let Some(mut handle) = child.stderr.take() {
            let _ = handle.read_to_string(&mut stderr);
        }
        let _ = progress_thread.join();
        if !matches!(status, Ok(status) if status.success()) {
            let _ = std::fs::remove_file(&temp_path);
            let safe = stderr
                .lines()
                .last()
                .unwrap_or("FFmpeg no pudo mezclar el doblaje")
                .chars()
                .take(240)
                .collect::<String>();
            return Err(ProjectError::message(ProjectErrorCode::RenderFailed, &safe));
        }
        let bytes = std::fs::metadata(&temp_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if bytes == 0 {
            let _ = std::fs::remove_file(&temp_path);
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el doblaje quedó vacío; no se publicó",
            ));
        }
        let (width, height, measured) = probe_video(ffprobe, &temp_path);
        let width = width.unwrap_or(0);
        let height = height.unwrap_or(0);
        if width == 0 || height == 0 {
            let _ = std::fs::remove_file(&temp_path);
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el doblaje no tiene una pista de video legible",
            ));
        }
        std::fs::rename(&temp_path, &final_path).map_err(|error| {
            let _ = std::fs::remove_file(&temp_path);
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo publicar el doblaje: {error}").as_str(),
            )
        })?;
        let published = std::fs::metadata(&final_path)
            .map(|metadata| metadata.len())
            .unwrap_or(bytes);
        if let Some(app) = app {
            let _ = app.emit("dub-progress", serde_json::json!({ "percent": 100.0 }));
        }
        Ok(DubResult {
            path: final_path.to_string_lossy().into_owned(),
            bytes: published,
            width,
            height,
            duration_seconds: measured.unwrap_or(end_seconds),
            language: language.to_owned(),
            voice: voice.to_owned(),
            cues: cues.len() as u32,
            replaced_original_audio: effective_bed.is_none(),
            original_audio_volume: effective_bed.unwrap_or(0.0),
            warnings,
        })
    })();
    let _ = std::fs::remove_dir_all(&temp);
    result
}

fn pick_voice(voices: &[VoiceInfo], language: &str) -> Result<VoiceInfo, ProjectError> {
    if let Some(found) = voices.iter().find(|voice| {
        voice
            .culture
            .to_ascii_lowercase()
            .starts_with(&language.to_ascii_lowercase())
    }) {
        return Ok(found.clone());
    }
    let installed = voices
        .iter()
        .map(|voice| format!("{} ({})", voice.name, voice.culture))
        .collect::<Vec<_>>()
        .join(", ");
    Err(ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        &format!(
            "Windows no tiene una voz instalada para {}; instalá una voz en Configuración → Voz. Voces disponibles: {}",
            language_label(language),
            if installed.is_empty() { "ninguna".to_owned() } else { installed }
        ),
    ))
}

/// Dobla un video con las cues ya traducidas. Reemplaza el audio original y
/// conserva el video sin re-encodear.
#[tauri::command]
pub async fn synthesize_dub(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SynthesizeDubRequest,
) -> Result<DubResult, ProjectError> {
    let language = normalize_language(&request.language).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el idioma del doblaje no está soportado",
        )
    })?;
    let cues = validate_cues(&request.cues)?;
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para doblar ya no está en el proyecto",
        ));
    }
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del doblaje no existe",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, powershell) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe), Some(powershell)) = (ffmpeg, ffprobe, powershell) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg, FFprobe y PowerShell son necesarios para doblar",
        ));
    };
    let voices = sapi_voices(&state).await?;
    let voice = match request
        .voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(requested) => voices
            .iter()
            .find(|voice| voice.name == requested)
            .cloned()
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::NotFound,
                    "la voz elegida no está instalada en Windows",
                )
            })?,
        None => pick_voice(&voices, language)?,
    };
    let bed_volume = match request.bed_volume {
        Some(volume) if volume.is_finite() && (0.0..=1.0).contains(&volume) => Some(volume),
        Some(_) => {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el volumen del audio original debe estar entre 0 y 1",
            ));
        }
        None => None,
    };
    let source_duration = probe_video(&ffprobe, &input).2;
    let end_seconds = dub_end_seconds(&cues, request.end_seconds, source_duration);
    synthesize_dub_file(
        Some(&app),
        &powershell,
        &ffmpeg,
        &ffprobe,
        &input,
        &output_dir,
        language,
        &voice.name,
        &cues,
        end_seconds,
        bed_volume,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: f64, end: f64, text: &str) -> DubCue {
        DubCue {
            start_seconds: start,
            end_seconds: end,
            text: text.to_owned(),
        }
    }

    #[test]
    fn normalizes_supported_languages_and_rejects_unknown() {
        assert_eq!(normalize_language("es-AR"), Some("es"));
        assert_eq!(normalize_language("EN-us"), Some("en"));
        assert_eq!(normalize_language("zh-CN"), Some("zh"));
        assert_eq!(normalize_language("fr"), Some("fr"));
        assert_eq!(normalize_language("xx"), None);
    }

    #[test]
    fn validates_and_sorts_cues_without_large_overlaps() {
        let cues = validate_cues(&[
            cue(2.5, 4.0, " Segundo "),
            cue(0.0, 2.0, "Primero\ncon salto"),
        ])
        .expect("cues");
        assert_eq!(cues[0].text, "Primero con salto");
        assert_eq!(cues[1].text, "Segundo");
        assert!(validate_cues(&[cue(0.0, 2.0, "A"), cue(1.0, 3.0, "B")]).is_err());
        assert!(validate_cues(&[cue(0.0, 0.0, "A")]).is_err());
        assert!(validate_cues(&[cue(0.0, 1.0, "   ")]).is_err());
        assert!(validate_cues(&[cue(0.0, 1.0, &"x".repeat(MAX_CUE_CHARS + 1))]).is_err());
    }

    #[test]
    fn end_respects_cues_source_and_request() {
        let cues = vec![cue(0.0, 4.0, "A")];
        assert!((dub_end_seconds(&cues, None, Some(10.0)) - 4.4).abs() < 0.001);
        assert_eq!(dub_end_seconds(&cues, Some(8.0), Some(10.0)), 8.0);
        assert_eq!(dub_end_seconds(&cues, Some(80.0), Some(10.0)), 10.0);
    }

    #[test]
    fn filter_uses_silence_delay_and_limits_clipping() {
        let segments = vec![
            DubSegment {
                start: 0.5,
                end: 2.5,
                wav: PathBuf::from("a.wav"),
                duration: 1.2,
            },
            DubSegment {
                start: 3.0,
                end: 4.0,
                wav: PathBuf::from("b.wav"),
                duration: 2.0,
            },
        ];
        let (filter, warnings) = build_dub_filter(&segments, 5.0, None);
        assert!(filter.contains("anullsrc"));
        assert!(filter.contains("adelay=500|500"));
        assert!(filter.contains("adelay=3000|3000"));
        assert!(filter.contains("atempo="));
        assert!(filter.contains("alimiter=limit=0.95"));
        assert!(filter.contains("amix=inputs=3"));
        assert_eq!(warnings.len(), 1);
        let (with_bed, _) = build_dub_filter(&segments, 5.0, Some(0.15));
        assert!(with_bed.contains("[0:a]"));
        assert!(with_bed.contains("[bed]"));
        assert!(with_bed.contains("amix=inputs=4"));
    }

    #[test]
    fn picks_a_voice_for_the_language_and_explains_when_missing() {
        let voices = vec![
            VoiceInfo {
                id: "Sabina".to_owned(),
                name: "Microsoft Sabina Desktop".to_owned(),
                culture: "es-MX".to_owned(),
                gender: "Female".to_owned(),
            },
            VoiceInfo {
                id: "Zira".to_owned(),
                name: "Microsoft Zira Desktop".to_owned(),
                culture: "en-US".to_owned(),
                gender: "Female".to_owned(),
            },
        ];
        assert_eq!(
            pick_voice(&voices, "es").expect("es").name,
            "Microsoft Sabina Desktop"
        );
        assert_eq!(
            pick_voice(&voices, "en").expect("en").name,
            "Microsoft Zira Desktop"
        );
        let error = pick_voice(&voices, "ja").expect_err("sin voz");
        assert!(error.message.contains("no tiene una voz instalada"));
    }

    #[test]
    #[ignore = "requiere SAPI y un video sintético; se ejecuta a mano"]
    fn dubs_a_synthetic_video_end_to_end() {
        let voice = std::env::var("DUB_VOICE").expect("DUB_VOICE");
        let ffmpeg = Path::new("ffmpeg");
        let ffprobe = Path::new("ffprobe");
        let powershell = Path::new("powershell");
        let dir = std::env::temp_dir().join(format!("editoria-dub-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("source.mp4");
        assert!(Command::new(ffmpeg)
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=30:duration=5",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=5",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&input)
            .status()
            .expect("ffmpeg")
            .success());
        let result = synthesize_dub_file(
            None,
            powershell,
            ffmpeg,
            ffprobe,
            &input,
            &dir,
            "en",
            &voice,
            &[
                cue(0.3, 2.0, "Hello from the local dub."),
                cue(2.4, 4.5, "This audio was generated on this machine."),
            ],
            5.0,
            Some(0.15),
        )
        .expect("doblaje");
        assert_eq!(result.cues, 2);
        assert!(!result.replaced_original_audio);
        assert!((result.original_audio_volume - 0.15).abs() < 0.001);
        assert!(result.bytes > 0);
        assert_eq!((result.width, result.height), (320, 180));
        assert!((result.duration_seconds - 5.0).abs() < 0.6);
        assert!(std::path::Path::new(&result.path).is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
