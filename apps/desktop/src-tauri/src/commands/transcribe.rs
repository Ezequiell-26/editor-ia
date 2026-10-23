//! Local speech-to-text with Faster-Whisper.
//!
//! The bridge script is embedded in the binary and written to the app cache.
//! Python is resolved from `EDITORIA_WHISPER_PYTHON`, the known local venv on
//! this machine, or PATH. The audio/video never leaves the computer.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

const SCRIPT: &str = include_str!("../../scripts/transcribe_faster.py");
const KNOWN_PYTHON: &str =
    r"D:\Users\ofici\MCPs\Video-Editing\Transcription-Whisper\.venv\Scripts\python.exe";
const MAX_OUTPUT_BYTES: usize = 20 * 1024 * 1024;
const MAX_SEGMENTS: usize = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionWord {
    pub start: f64,
    pub end: f64,
    pub word: String,
    pub probability: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(default)]
    pub words: Vec<TranscriptionWord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub language: String,
    pub language_probability: f64,
    pub duration_seconds: f64,
    pub model: String,
    pub segments: Vec<TranscriptionSegment>,
}

pub(crate) fn resolve_python() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("EDITORIA_WHISPER_PYTHON") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    let known = PathBuf::from(KNOWN_PYTHON);
    if known.is_file() {
        return Some(known);
    }
    for candidate in ["python", "python3"] {
        let mut probe = Command::new(candidate);
        probe
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        crate::commands::hide_console(&mut probe);
        if probe
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return Some(PathBuf::from(candidate));
        }
    }
    None
}

fn derive_hf_home(python: &Path) -> Option<PathBuf> {
    if let Some(value) = std::env::var_os("EDITORIA_HF_HOME") {
        let path = PathBuf::from(value);
        if path.is_dir() {
            return Some(path);
        }
    }
    let venv = python.parent()?.parent()?;
    let base = venv.parent()?;
    let cache = base.join("models").join("huggingface");
    if cache.is_dir() {
        Some(cache)
    } else {
        None
    }
}

fn validate_model(value: &str) -> Result<String, ProjectError> {
    match value.trim() {
        "tiny" | "base" | "small" | "medium" => Ok(value.trim().to_owned()),
        "" => Ok("small".to_owned()),
        _ => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "modelo de transcripción no permitido; usá tiny, base, small o medium",
        )),
    }
}

fn validate_language(value: &str) -> Result<String, ProjectError> {
    let value = value.trim();
    if value.is_empty() {
        return Ok("auto".to_owned());
    }
    if value.eq_ignore_ascii_case("auto") {
        return Ok("auto".to_owned());
    }
    if value.len() > 10
        || !value
            .chars()
            .all(|character| character.is_ascii_alphabetic() || character == '-')
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el idioma de transcripción no es válido",
        ));
    }
    Ok(value.to_lowercase())
}

fn parse_result(raw: &[u8]) -> Result<TranscriptionResult, ProjectError> {
    if raw.len() > MAX_OUTPUT_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la transcripción supera el límite de 20 MB",
        ));
    }
    let mut result: TranscriptionResult = serde_json::from_slice(raw).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "Faster-Whisper devolvió una transcripción ilegible",
        )
    })?;
    if result.segments.len() > MAX_SEGMENTS {
        result.segments.truncate(MAX_SEGMENTS);
    }
    for segment in &mut result.segments {
        if segment.text.chars().count() > 500 {
            segment.text = segment.text.chars().take(500).collect();
        }
        segment.words.truncate(200);
    }
    Ok(result)
}

#[tauri::command]
pub async fn transcribe_asset(
    state: State<'_, AppState>,
    asset_id: String,
    language: Option<String>,
    model: Option<String>,
) -> Result<TranscriptionResult, ProjectError> {
    let session = state.require_session()?;
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el audio que se quiere transcribir no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("");
    if kind != "audio" && kind != "video" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la transcripción sólo se aplica a audio o video",
        ));
    }
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el material no está listo para transcribir",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de audio no está en disco",
        ));
    }

    let Some(python) = resolve_python() else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se encontró Python con faster-whisper; definí EDITORIA_WHISPER_PYTHON o instalá faster-whisper",
        ));
    };
    let script = state.cache_dir.join("transcribe_faster.py");
    if let Err(error) = std::fs::write(&script, SCRIPT) {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el script de transcripción: {error}").as_str(),
        ));
    }
    let language = validate_language(
        language
            .as_deref()
            .or_else(|| opened.project["language"].as_str())
            .unwrap_or("auto"),
    )?;
    let model = validate_model(model.as_deref().unwrap_or("small"))?;

    let mut command = Command::new(&python);
    command
        .arg(&script)
        .arg(&path)
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
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se pudo iniciar Python para transcribir",
        )
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!(
                "Faster-Whisper no pudo transcribir: {}",
                sanitize_log(&stderr, &session.root, 400)
            )
            .as_str(),
        ));
    }
    parse_result(&output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_valid_transcription_and_bounds_segments() {
        let raw = br#"{"language":"es","languageProbability":0.99,"durationSeconds":2.5,"model":"small","segments":[{"start":0.0,"end":1.2,"text":"Hola mundo","words":[{"start":0.0,"end":0.4,"word":"Hola","probability":0.9}]}]}"#;
        let result = parse_result(raw).expect("valid");
        assert_eq!(result.language, "es");
        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].text, "Hola mundo");
        assert_eq!(result.segments[0].words.len(), 1);
    }

    #[test]
    fn rejects_invalid_json_and_models() {
        assert!(parse_result(b"not json").is_err());
        assert!(validate_model("small").is_ok());
        assert!(validate_model("large-v3").is_err());
        assert_eq!(validate_language("ES").unwrap(), "es");
        assert_eq!(validate_language("auto").unwrap(), "auto");
    }
}
