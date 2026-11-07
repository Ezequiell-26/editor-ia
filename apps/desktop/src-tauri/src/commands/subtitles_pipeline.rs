//! Pipeline automático de subtítulos: video → transcripción → traducción →
//! ASS → MP4 con subtítulos quemados (libass de FFmpeg).
//!
//! Orquesta piezas que ya existían por separado: `transcribe_faster.py`
//! (faster-whisper), `providers::translate_subtitles` (proveedor IA real,
//! con resultado `simulated` honesto) y el filtro `subtitles` de FFmpeg.
//! Si no hay `targetLanguage` se omite la traducción; si no hay proveedor
//! configurado la traducción falla explícitamente (no se inventa texto).

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use super::system::resolve_tools;
use super::transcribe::{
    derive_hf_home, parse_result, validate_language, validate_model, whisper_status, SCRIPT,
};
use super::transcribe::TranscriptionResult;

const VIDEO_EXTS: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "m4v"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitlePipelineRequest {
    /// Archivo de video/audio a procesar (ruta absoluta).
    pub input_path: String,
    /// Salida .mp4 con subtítulos quemados; si se omite, sólo se genera el .ass.
    #[serde(default)]
    pub output_path: Option<String>,
    /// Idioma destino para traducir (ej. "en"). Vacío = sin traducción.
    #[serde(default)]
    pub target_language: Option<String>,
    /// Idioma fuente ("auto" por defecto).
    #[serde(default)]
    pub source_language: Option<String>,
    /// Modelo whisper (tiny/base/small/medium).
    #[serde(default = "default_model")]
    pub model: String,
    /// Quema los subtítulos en el video de salida.
    #[serde(default = "default_true")]
    pub burn: bool,
}

fn default_model() -> String {
    "small".into()
}
fn default_true() -> bool {
    true
}

fn ass_time(seconds: f64) -> String {
    let cs = (seconds * 100.0).round().max(0.0) as u64;
    let h = cs / 360000;
    let m = (cs / 6000) % 60;
    let s = (cs / 100) % 60;
    let c = cs % 100;
    format!("{h}:{m:02}:{s:02}.{c:02}")
}

/// Genera un ASS mínimo pero válido (una sola línea de estilo) con los cues.
fn cues_to_ass(cues: &[(f64, f64, String)], width: u32, height: u32) -> String {
    let mut out = String::from(
        "[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\n",
    );
    out.push_str(&format!("PlayResX: {width}\nPlayResY: {height}\n\n"));
    out.push_str("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n");
    out.push_str("Style: Default,Segoe UI,42,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,2,40,40,30,1\n\n");
    out.push_str("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    for (start, end, text) in cues {
        let safe = text.replace('\n', "\\N").replace('{', "").replace('}', "");
        out.push_str(&format!(
            "Dialogue: 0,{},{},Default,,0,0,0,,{}\n",
            ass_time(*start),
            ass_time(end.max(*start + 0.05)),
            safe
        ));
    }
    out
}

#[tauri::command]
pub async fn subtitles_pipeline(
    state: State<'_, AppState>,
    request: SubtitlePipelineRequest,
) -> Result<serde_json::Value, ProjectError> {
    let input = PathBuf::from(request.input_path.trim());
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de entrada no existe",
        ));
    }
    let ext = input
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !VIDEO_EXTS.contains(&ext.as_str()) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la entrada debe ser un video (mp4, mov, mkv, webm, avi, m4v)",
        ));
    }
    let burn = request.burn && request.output_path.is_some();
    if request.burn && request.output_path.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "burn=true requiere outputPath (.mp4)",
        ));
    }

    // Settings/tools se resuelven antes de mover `state` a la traducción.
    let settings = state.settings_snapshot()?;
    let (ffmpeg_opt, ffprobe_opt, _) = resolve_tools(&settings);

    // 1) Transcripción real con faster-whisper.
    let status = whisper_status();
    let Some(python) = status.python.clone() else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!(
                "transcripción no disponible: {}",
                status.reason.as_deref().unwrap_or("falta Python con faster-whisper")
            ),
        ));
    };
    let language = validate_language(
        request
            .source_language
            .as_deref()
            .unwrap_or("auto"),
    )?;
    let model = validate_model(&request.model)?;
    let script = state.cache_dir.join("transcribe_faster.py");
    std::fs::write(&script, SCRIPT).map_err(|e| {
        ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo preparar el script: {e}"))
    })?;
    let mut command = std::process::Command::new(&python);
    command
        .arg(&script)
        .arg(&input)
        .arg("--language")
        .arg(&language)
        .arg("--model")
        .arg(&model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(hf_home) = derive_hf_home(&python) {
        command.env("EDITORIA_HF_HOME", hf_home);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, "no se pudo iniciar Python")
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!("Faster-Whisper falló: {}", stderr.chars().take(400).collect::<String>()),
        ));
    }
    let transcription: TranscriptionResult = parse_result(&output.stdout)?;
    let mut cues: Vec<(f64, f64, String)> = transcription
        .segments
        .iter()
        .map(|s| (s.start, s.end, s.text.trim().to_owned()))
        .filter(|(_, _, t)| !t.is_empty())
        .collect();

    // 2) Traducción opcional con el proveedor configurado.
    let mut translated = false;
    let mut simulated = false;
    if let Some(target) = request.target_language.as_deref().filter(|t| !t.trim().is_empty()) {
        let texts: Vec<String> = cues.iter().map(|(_, _, t)| t.clone()).collect();
        let result = crate::commands::providers::translate_subtitles(
            state,
            crate::commands::providers::TranslateRequest {
                texts,
                source_language: request
                    .source_language
                    .clone()
                    .unwrap_or_else(|| "auto".into()),
                target_language: target.to_owned(),
                glossary: None,
                approved_cost: true,
            },
        )
        .await?;
        translated = true;
        simulated = result.simulated;
        for (cue, text) in cues.iter_mut().zip(result.texts.iter()) {
            cue.2 = text.clone();
        }
    }

    // 3) ASS junto al video de salida (o junto a la entrada si no hay burn).
    let ffmpeg = ffmpeg_opt.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se encontró FFmpeg configurado",
        )
    })?;
    let ffprobe = ffprobe_opt;

    let base = request
        .output_path
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| input.with_extension("es"));
    let ass_path = base.with_extension("ass");
    // Probe de dimensiones reales para el PlayRes del ASS.
    let (w, h) = probe_size(ffprobe.as_ref(), &input).unwrap_or((1920, 1080));
    let ass = cues_to_ass(&cues, w, h);
    if let Some(parent) = ass_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo crear la carpeta: {e}"))
        })?;
    }
    std::fs::write(&ass_path, &ass).map_err(|e| {
        ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo escribir el ASS: {e}"))
    })?;

    // 4) Burn opcional con el filtro subtitles (libass).
    let mut output_file: Option<String> = None;
    if burn {
        let out = PathBuf::from(request.output_path.as_deref().unwrap());
        if out.extension().and_then(|e| e.to_str()) != Some("mp4") {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "outputPath debe ser .mp4",
            ));
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo crear la carpeta: {e}"))
            })?;
        }
        let tmp = out.with_extension("tmp.mp4");
        // libass necesita la ruta escapada; en Windows se usa relative-to-cwd o /.
        let ass_arg = ass_path.to_string_lossy().replace('\\', "/");
        let mut encoded = false;
        let mut last_err = String::new();
        for encoder in ["libopenh264", "h264_mf"] {
            let run = std::process::Command::new(&ffmpeg)
                .args([
                    "-hide_banner", "-loglevel", "error", "-y",
                    "-i", &input.to_string_lossy(),
                    "-vf", &format!("subtitles={ass_arg}"),
                    "-c:v", encoder,
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-movflags", "+faststart",
                    &tmp.to_string_lossy(),
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output();
            match run {
                Ok(o) if o.status.success() => {
                    encoded = true;
                    break;
                }
                Ok(o) => {
                    last_err = String::from_utf8_lossy(&o.stderr).chars().take(300).collect();
                    let _ = std::fs::remove_file(&tmp);
                }
                Err(e) => {
                    last_err = e.to_string();
                    break;
                }
            }
        }
        if !encoded {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                &format!("FFmpeg no pudo quemar subtítulos: {last_err}"),
            ));
        }
        std::fs::rename(&tmp, &out).map_err(|e| {
            ProjectError::message(ProjectErrorCode::Io, &format!("no se pudo publicar el video: {e}"))
        })?;
        output_file = Some(out.to_string_lossy().to_string());
    }

    Ok(serde_json::json!({
        "ok": true,
        "assPath": ass_path.to_string_lossy(),
        "outputPath": output_file,
        "cues": cues.len(),
        "language": transcription.language,
        "translated": translated,
        "simulated": simulated,
        "burned": burn,
    }))
}

fn probe_size(ffprobe: Option<&PathBuf>, input: &Path) -> Option<(u32, u32)> {
    let ffprobe = ffprobe?;
    let out = std::process::Command::new(ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            &input.to_string_lossy(),
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let stream = &json["streams"][0];
    Some((
        stream["width"].as_u64()? as u32,
        stream["height"].as_u64()? as u32,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ass_time_formats_centiseconds() {
        assert_eq!(ass_time(0.0), "0:00:00.00");
        assert_eq!(ass_time(61.234), "0:01:01.23");
        assert_eq!(ass_time(3661.5), "1:01:01.50");
    }

    #[test]
    fn cues_to_ass_produces_valid_events() {
        let cues = vec![
            (0.0, 2.5, "Hola mundo".to_string()),
            (2.5, 5.0, "Segunda línea".to_string()),
        ];
        let ass = cues_to_ass(&cues, 1920, 1080);
        assert!(ass.contains("[Script Info]"));
        assert!(ass.contains("[V4+ Styles]"));
        assert!(ass.contains("[Events]"));
        assert_eq!(ass.matches("Dialogue:").count(), 2);
        assert!(ass.contains("0:00:00.00"));
        assert!(ass.contains("0:00:02.50"));
        // PlayRes refleja la resolución real del video.
        assert!(ass.contains("PlayResX: 1920"));
    }

    #[test]
    fn cues_to_ass_escapes_braces_and_newlines() {
        let cues = vec![(0.0, 1.0, "texto {raro}\ncon salto".to_string())];
        let ass = cues_to_ass(&cues, 640, 360);
        assert!(!ass.contains('{'));
        assert!(ass.contains(r"texto raro\Ncon salto"));
    }
}
