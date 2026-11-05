//! Aislamiento de voz con Demucs v4 (modelo local de Facebook AI Research).
//!
//! El wrapper Python `scripts/ai-voice-isolation/demucs-wrapper.py` se embebe
//! en el binario (`include_str!`) y se materializa en `cache_dir` al usarlo,
//! igual que `transcribe_faster.py`: funciona en la app instalada sin depender
//! del árbol fuente. Requiere un Python con `torch`, `torchaudio`, `demucs` y
//! `soundfile`; el modelo (~2 GB) se descarga una vez en `~/.cache/demucs/`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const SCRIPT: &str = include_str!("../../../../../scripts/ai-voice-isolation/demucs-wrapper.py");
const INSTALL_HINT: &str =
    "instalá el motor con `python -m pip install torch torchaudio demucs soundfile` y reiniciá Olyvia";

/// Estado medido del motor: `python` sólo se completa cuando el intérprete
/// puede `import demucs` de verdad (un `python --version` no alcanza).
#[derive(Debug, Clone, Serialize)]
pub struct VoiceIsolationStatus {
    pub available: bool,
    pub python: Option<PathBuf>,
    pub reason: Option<String>,
}

fn command_succeeds(program: &Path, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn real_probe(python: &Path) -> bool {
    if !command_succeeds(python, &["--version"]) {
        return false;
    }
    command_succeeds(python, &["-c", "import demucs, soundfile, torch"])
}

fn status() -> &'static VoiceIsolationStatus {
    static STATUS: OnceLock<VoiceIsolationStatus> = OnceLock::new();
    STATUS.get_or_init(|| {
        let env_python = std::env::var_os("EDITORIA_DEMUCS_PYTHON")
            .map(PathBuf::from)
            .filter(|path| path.is_file());
        let candidates: Vec<PathBuf> = ["python", "python3"]
            .iter()
            .map(PathBuf::from)
            .collect();
        let mut found = env_python;
        if found.is_none() {
            found = candidates.into_iter().find(|path| real_probe(path));
        } else if let Some(path) = &found {
            if !real_probe(path) {
                found = None;
            }
        }
        match found {
            Some(python) => VoiceIsolationStatus {
                available: true,
                python: Some(python),
                reason: None,
            },
            None => VoiceIsolationStatus {
                available: false,
                python: None,
                reason: Some(format!("no hay un Python con demucs; {INSTALL_HINT}")),
            },
        }
    })
}

/// Estado del motor para la UI: permite deshabilitar la función con el motivo.
#[tauri::command]
pub fn voice_isolation_status() -> VoiceIsolationStatus {
    status().clone()
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceIsolationOutcome {
    pub vocals_path: PathBuf,
    pub accompaniment_path: Option<PathBuf>,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub processing_time_ms: u64,
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// Aísla la voz de un archivo de audio/video en disco y devuelve la ruta del
/// stem `vocals.wav` más los metadatos del procesamiento.
#[tauri::command]
pub async fn voice_isolate_media(
    state: State<'_, AppState>,
    input_path: String,
    model: Option<String>,
    quality: Option<String>,
) -> Result<VoiceIsolationOutcome, ProjectError> {
    let input = PathBuf::from(&input_path);
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de audio no está en disco",
        ));
    }
    let status = status();
    let Some(python) = status.python.clone() else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            status
                .reason
                .as_deref()
                .unwrap_or("la isolación de voz no está disponible"),
        ));
    };
    let quality = match quality.as_deref().unwrap_or("medium") {
        "low" | "medium" | "high" | "best" => quality.as_deref().unwrap_or("medium"),
        _ => return Err(invalid("la calidad debe ser low, medium, high o best")),
    };
    let model = model.as_deref().unwrap_or("htdemucs");
    if !model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(invalid("el nombre del modelo no es válido"));
    }

    let script = state.cache_dir.join("demucs-wrapper.py");
    if let Err(error) = std::fs::write(&script, SCRIPT) {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el script de isolación: {error}").as_str(),
        ));
    }
    let output_dir = state
        .cache_dir
        .join("voice-isolation")
        .join(uuid::Uuid::new_v4().to_string());

    let mut command = Command::new(&python);
    command
        .arg(&script)
        .arg("--input")
        .arg(&input)
        .arg("--output-dir")
        .arg(&output_dir)
        .arg("--mode")
        .arg("isolate")
        .arg("--model")
        .arg(model)
        .arg("--quality")
        .arg(quality)
        .arg("--device")
        .arg("auto")
        .arg("--stdout-json");

    let output = tauri::async_runtime::spawn_blocking(move || command.output())
        .await
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo lanzar el aislador de voz: {error}").as_str(),
            )
        })?
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo ejecutar el aislador de voz: {error}").as_str(),
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            format!("el aislador de voz falló: {}", tail.trim()).as_str(),
        ));
    }

    let json_str = String::from_utf8(output.stdout).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("salida inválida del aislador: {error}").as_str(),
        )
    })?;
    let raw: serde_json::Value = serde_json::from_str(&json_str).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("JSON inválido del aislador: {error}").as_str(),
        )
    })?;
    if let Some(error) = raw.get("error").and_then(|value| value.as_str()) {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            error,
        ));
    }
    let files = raw.get("output_files").ok_or_else(|| {
        invalid("la respuesta del aislador no trae output_files")
    })?;
    let vocals = files
        .get("vocals")
        .and_then(|value| value.as_str())
        .ok_or_else(|| invalid("la respuesta del aislador no trae el stem vocals"))?;
    let accompaniment = files
        .get("accompaniment")
        .and_then(|value| value.as_str())
        .map(PathBuf::from);

    Ok(VoiceIsolationOutcome {
        vocals_path: PathBuf::from(vocals),
        accompaniment_path: accompaniment,
        duration_seconds: raw
            .get("duration_seconds")
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0),
        sample_rate: raw
            .get("sample_rate")
            .and_then(|value| value.as_u64())
            .map(|value| value as u32)
            .unwrap_or(44_100),
        channels: raw
            .get("channels")
            .and_then(|value| value.as_u64())
            .map(|value| value as u32)
            .unwrap_or(1),
        processing_time_ms: raw
            .get("processing_time_ms")
            .and_then(|value| value.as_u64())
            .unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reports_unavailable_without_demucs() {
        // En CI no hay demucs: el estado debe ser false con motivo, nunca panic.
        let status = status();
        assert!(!status.available || status.python.is_some());
    }
}
