//! Command para aislar voz humana usando Demucs v4 (model AI local).
//!
//! Ejecuta el wrapper Python `scripts/ai-voice-isolation/demucs-wrapper.py` con el modelo
//! HTDemucs pretrained de Facebook AI Research, y devuelve las rutas a los stems extraídos.
//!
//! Uso desde la UI:
//! 1. Seleccionar clip(s) de audio en timeline
//! 2. Habilitar "Aislar voz" en inspector de audio
//! 3. Render del clip ejecuta aislamiento antes de aplicar otros efectos
//!
//! Requisitos previos:
//! - Python 3.10+ disponible en PATH
//! - Paquetes: torch, torchaudio, demucs, soundfile
//! - Modelo pre-descargado (~2GB) cacheado en ~/.cache/demucs/

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::Profile;

/// Job de aislamiento de voz.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceIsolationJob {
    pub id: String,
    pub input_path: PathBuf,
    pub output_dir: PathBuf,
    pub model: String,
    pub quality: String,
    pub status: VoiceIsolationStatus,
    pub progress: f64, // 0.0–1.0
    pub result: Option<VoiceIsolationResult>,
}

/// Estado del job de aislamiento.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceIsolationStatus {
    Pending,
    Running,
    Completed,
    Failed(String),
}

/// Resultado exitoso del aislamiento.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceIsolationResult {
    pub vocals_path: PathBuf,
    pub accompaniment_path: Option<PathBuf>,
    pub duration_seconds: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub processing_time_ms: u64,
}

impl Default for VoiceIsolationJob {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            input_path: PathBuf::new(),
            output_dir: PathBuf::new(),
            model: "htdemucs".to_owned(),
            quality: "medium".to_owned(),
            status: VoiceIsolationStatus::Pending,
            progress: 0.0,
            result: None,
        }
    }
}

/// Ejecuta aislamiento de voz para un clip individual.
pub fn isolate_voice(
    input_path: &Path,
    output_dir: &Path,
    model: Option<&str>,
    quality: Option<&str>,
) -> Result<VoiceIsolationResult, ProjectError> {
    let model_name = model.unwrap_or("htdemucs");
    let quality_level = quality.unwrap_or("medium");

    // Asegurar directorio de salida
    std::fs::create_dir_all(output_dir).map_err(|e| {
        ProjectError::with_context(
            ProjectErrorCode::Io,
            format!("Failed to create output directory: {}", e),
        )
    })?;

    // Preparar argumento para Python
    let python_script = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("scripts")
        .join("ai-voice-isolation")
        .join("demucs-wrapper.py");

    if !python_script.exists() {
        return Err(ProjectError::with_context(
            ProjectErrorCode::NotFound,
            format!(
                "Voice isolation script not found: {}",
                python_script.display()
            ),
        ));
    }

    // Construir comando Python
    let mut cmd = Command::new("python");
    cmd.arg(python_script)
        .arg("--input")
        .arg(input_path)
        .arg("--output-dir")
        .arg(output_dir)
        .arg("--mode")
        .arg("isolate")
        .arg("--model")
        .arg(model_name)
        .arg("--quality")
        .arg(quality_level)
        .arg("--device")
        .arg("auto")
        .arg("--stdout-json")
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());

    eprintln!("[Voice Isolation] Executing: {:?}", cmd);

    let output = cmd.output().map_err(|e| {
        ProjectError::with_context(
            ProjectErrorCode::Io,
            format!("Failed to execute Python process: {}", e),
        )
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[Voice Isolation] Error output: {}", stderr);
        
        return Err(ProjectError::with_context(
            ProjectErrorCode::ValidationError,
            format!("Python script failed: {}", stderr),
        ));
    }

    // Parse JSON resultado
    let json_str = String::from_utf8(output.stdout).map_err(|e| {
        ProjectError::with_context(
            ProjectErrorCode::Io,
            format!("Invalid UTF-8 from Python: {}", e),
        )
    })?;

    let raw_result: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| {
        ProjectError::with_context(
            ProjectErrorCode::ValidationError,
            format!("Invalid JSON from Python: {}", e),
        )
    })?;

    if let Some(error) = raw_result.get("error") {
        return Err(ProjectError::with_context(
            ProjectErrorCode::ProcessingError,
            error
                .as_str()
                .unwrap_or("Unknown error from Python script")
                .to_owned(),
        ));
    }

    // Extraer campos necesarios
    let output_files = raw_result
        .get("output_files")
        .ok_or_else(|| {
            ProjectError::with_context(
                ProjectErrorCode::ValidationError,
                "Missing 'output_files' in Python response".to_owned(),
            )
        })?;

    let vocals_path = output_files
        .get("vocals")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            ProjectError::with_context(
                ProjectErrorCode::ValidationError,
                "Missing 'vocals' path in output_files".to_owned(),
            )
        })?;

    let accompaniment_path = output_files
        .get("accompaniment")
        .and_then(|v| v.as_str())
        .map(PathBuf::from);

    Ok(VoiceIsolationResult {
        vocals_path: PathBuf::from(vocals_path),
        accompaniment_path,
        duration_seconds: raw_result
            .get("duration_seconds")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        sample_rate: raw_result
            .get("sample_rate")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(44100),
        channels: raw_result
            .get("channels")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .unwrap_or(1),
        processing_time_ms: raw_result
            .get("processing_time_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
    })
}

/// Genera filtros FFmpeg basados en stem aislado de voces.
///
/// Cuando voice_isolation.enabled=true, renderiza primero el stem de voces,
/// luego lo usa como sidechain o reemplaza el audio original.
pub fn build_voice_isolation_filter(
    clip_id: &str,
    project_root: &Path,
    audio: &serde_json::Value,
    profile: &Profile,
) -> Result<Option<String>, ProjectError> {
    // Verificar si voice isolation está habilitada
    let voice_iso = audio.get("voiceIsolation").ok_or_else(|| {
        ProjectError::with_context(
            ProjectErrorCode::ValidationError,
            "Missing voiceIsolation field in audio".to_owned(),
        )
    })?;

    if !voice_iso.get("enabled").unwrap_or(&false).as_bool().unwrap_or(false) {
        return Ok(None);
    }

    // Determinar ruta de input/output
    let isolation_dir = project_root.join("media").join("isolation").join(clip_id);
    
    // Para producción real, esto necesitaría resolver la ruta del asset del clip
    // Por ahora solo retornamos un placeholder para documentación
    Ok(Some(format!(
        "[audio_input]silence=0:s=1[vocals_raw]; [vocals_raw]volume=1[vocals_clean]",
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_voice_isolation_error_handling() {
        // Test with non-existent input file
        let result = isolate_voice(
            Path::new("/nonexistent/audio.wav"),
            Path::new("/tmp/test-output"),
            Some("htdemucs"),
            Some("medium"),
        );
        
        assert!(result.is_err());
    }

    #[test]
    fn test_default_job_state() {
        let job: VoiceIsolationJob = VoiceIsolationJob::default();
        
        assert_eq!(job.status, VoiceIsolationStatus::Pending);
        assert_eq!(job.progress, 0.0);
        assert!(job.result.is_none());
        assert!(!job.id.is_empty());
    }
}
