//! Transcripción local — dominio puro: DTOs, validación, parseo del JSON de
//! Faster-Whisper y resolución del intérprete Python con sondeo inyectable.
//!
//! El motor no viene empaquetado: se instala en un Python del equipo.
//! `python` sólo se completa cuando el intérprete verificado puede importar
//! `faster_whisper`; sin motor la capacidad reporta el motivo exacto en vez
//! de afirmar que viene con la app. El audio/video nunca sale de la PC.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const INSTALL_HINT: &str =
    "instalá el motor con `python -m pip install faster-whisper` y reiniciá Olyvia";
pub const MAX_OUTPUT_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_SEGMENTS: usize = 2_000;

/// Resultado de sondear un Python candidato.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PythonProbe {
    /// El ejecutable no existe o no responde.
    Missing,
    /// Es un Python real pero no puede importar `faster_whisper`.
    WithoutFasterWhisper,
    /// Python con `faster_whisper` importable.
    Ready,
}

/// Estado medido del motor de transcripción: `python` sólo se completa cuando
/// el intérprete verificado puede importar el módulo.
#[derive(Debug, Clone)]
pub struct WhisperStatus {
    pub python: Option<PathBuf>,
    pub reason: Option<String>,
}

impl WhisperStatus {
    pub fn available(&self) -> bool {
        self.python.is_some()
    }
}

/// Resolución sobre un sondeo inyectable: ni ruta hardcodeada de la máquina del
/// autor ni atajos por nombre de archivo. Devuelve el primer intérprete
/// verificado y, si no hay ninguno, un motivo accionable.
pub fn resolve_python_with(
    env_python: Option<PathBuf>,
    candidates: &[PathBuf],
    probe: &dyn Fn(&Path) -> PythonProbe,
) -> WhisperStatus {
    let mut notes: Vec<String> = Vec::new();
    if let Some(env_path) = env_python {
        if !env_path.is_file() {
            notes.push(format!(
                "EDITORIA_WHISPER_PYTHON apunta a {} y ese archivo no existe",
                env_path.display()
            ));
        } else {
            match probe(&env_path) {
                PythonProbe::Ready => {
                    return WhisperStatus {
                        python: Some(env_path),
                        reason: None,
                    };
                }
                PythonProbe::WithoutFasterWhisper => notes.push(format!(
                    "el Python de EDITORIA_WHISPER_PYTHON no puede importar faster_whisper; {INSTALL_HINT}"
                )),
                PythonProbe::Missing => notes.push(
                    "EDITORIA_WHISPER_PYTHON no responde como un Python ejecutable; corregí la ruta"
                        .to_owned(),
                ),
            }
        }
    }
    for candidate in candidates {
        match probe(candidate) {
            PythonProbe::Ready => {
                return WhisperStatus {
                    python: Some(candidate.clone()),
                    reason: None,
                };
            }
            PythonProbe::WithoutFasterWhisper => notes.push(format!(
                "el Python de PATH ({}) no tiene faster-whisper; {INSTALL_HINT}",
                candidate.display()
            )),
            PythonProbe::Missing => {}
        }
    }
    let reason = if notes.is_empty() {
        "no se encontró Python en esta máquina. Instalá Python 3.9+ y faster-whisper, o definí EDITORIA_WHISPER_PYTHON con la ruta al python.exe de un entorno con el motor instalado".to_owned()
    } else {
        notes.join(". ")
    };
    WhisperStatus {
        python: None,
        reason: Some(reason),
    }
}

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
    /// Qué motor produjo el resultado: `"native"` (whisper.cpp in-process,
    /// concat-speech-min) o `"python"` (faster-whisper). `None` en salidas
    /// viejas o de pipelines que no lo informan; el frontend lo ignora si
    /// no lo conoce.
    #[serde(default)]
    pub engine: Option<String>,
}

/// Motor que puede producir una transcripción, en orden de preferencia.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptionEngine {
    /// whisper.cpp in-process vía `concat-speech-min` (vendor/concat).
    Native,
    /// Python externo con faster-whisper (el camino histórico).
    Python,
}

impl TranscriptionEngine {
    /// Valor que queda en `TranscriptionResult::engine`.
    pub fn label(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::Python => "python",
        }
    }
}

/// Modelo nativo equivalente al `model` ya validado del comando
/// (`tiny`/`base`/`small`/`medium`). La tabla de concat-speech-min no
/// ofrece `medium` ni variantes `.en` pedibles desde la UI: esos casos
/// devuelven `None` y el plan cae directo al motor Python.
pub fn native_model_id(model: &str) -> Option<&'static str> {
    match model.trim() {
        "tiny" => Some("tiny"),
        "base" => Some("base"),
        "small" => Some("small"),
        _ => None,
    }
}

/// Plan ordenado de motores a intentar para una transcripción.
///
/// `native_supported` significa que el modelo pedido tiene equivalente
/// nativo **y** que el intento puede correr (FFmpeg disponible para
/// decodificar; la descarga del modelo ocurre dentro del intento y su
/// fallo también dispara el fallback). `python_ready` es que el sondeo
/// encontró un Python con faster-whisper. Sin ninguno, el comando reporta
/// la ausencia de motor como antes.
pub fn engine_plan(native_supported: bool, python_ready: bool) -> Vec<TranscriptionEngine> {
    let mut plan = Vec::with_capacity(2);
    if native_supported {
        plan.push(TranscriptionEngine::Native);
    }
    if python_ready {
        plan.push(TranscriptionEngine::Python);
    }
    plan
}

/// Convierte los segmentos del motor nativo al DTO del comando, con los
/// mismos límites que `parse_result` (tope de segmentos, largo de texto).
///
/// El motor nativo no expone el idioma detectado ni su probabilidad ni
/// timestamps por palabra: `language` queda como el idioma pedido
/// (`"auto"` cuando se autodetecta) y `language_probability` en `0.0`
/// —no medido— en vez de inventar un número. `words` va vacío.
pub fn result_from_native_segments(
    segments: &[crate::vendor_concat::speech::Segment],
    language: &str,
    model: &str,
    duration_seconds: f64,
) -> TranscriptionResult {
    let mut result = TranscriptionResult {
        language: language.to_owned(),
        language_probability: 0.0,
        duration_seconds,
        model: model.to_owned(),
        segments: segments
            .iter()
            .map(|segment| TranscriptionSegment {
                start: segment.start,
                end: segment.end,
                text: segment.text.clone(),
                words: Vec::new(),
            })
            .collect(),
        engine: Some(TranscriptionEngine::Native.label().to_owned()),
    };
    sanitize_result(&mut result);
    result
}

// --------------------------------------------------------------------------- //
// Motor nativo: whisper.cpp in-process (concat-speech-min)
// --------------------------------------------------------------------------- //

/// Progreso de la descarga de un modelo whisper nativo, con los bytes reales
/// que reporta el crate (no un porcentaje inventado). `total` puede ser la
/// estimación de la tabla cuando el servidor no manda Content-Length.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelDownloadProgress {
    pub model_id: String,
    pub received: u64,
    pub total: u64,
    /// True mientras se verifica el SHA-256 o se adopta una copia local:
    /// los bytes pueden pausar y la descarga no está terminada.
    pub unpacking: bool,
    /// True en el último reporte.
    pub done: bool,
    /// `received / total * 100` cuando hay total conocido; `None` si no.
    pub percent: Option<f64>,
}

/// Estado de la descarga de modelo nativo en curso (o el último error).
/// El crate no expone si su `SingleFlight` de descargas está ocupado, así que
/// el comando que dispara la descarga mantiene este estado; una descarga
/// iniciada por `transcribe_asset` también lo actualiza.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperDownloadState {
    pub running: bool,
    pub model_id: Option<String>,
    pub progress: Option<WhisperModelDownloadProgress>,
    /// Último error de la descarga que ya terminó (se conserva hasta la
    /// próxima descarga para que la UI pueda explicarlo).
    pub error: Option<String>,
}

/// Un modelo `ggml-*.bin` del motor nativo, como lo muestra la UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWhisperModel {
    /// Id de la tabla del crate: `tiny`, `tiny.en`, `base`, `base.en`,
    /// `small`, `small.en`.
    pub id: String,
    pub label: String,
    pub blurb: String,
    pub english_only: bool,
    /// Tamaño aproximado de descarga en bytes.
    pub size_bytes: u64,
    pub downloaded: bool,
    /// Ruta absoluta del `.bin` cuando está descargado.
    pub path: Option<String>,
}

/// Estado completo del motor nativo de transcripción.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeWhisperStatus {
    /// whisper.cpp está compilado dentro del binario (whisper-rs): el motor
    /// existe siempre; la primera corrida carga los backends de CPU de ggml
    /// y un fallo ahí se reporta como intento fallido con fallback, no como
    /// capacidad ausente.
    pub engine_available: bool,
    /// Carpeta `<config>/whisper-models` donde viven los `ggml-*.bin`.
    pub models_dir: String,
    pub models: Vec<NativeWhisperModel>,
    /// Modelo cargado en memoria ahora (re-correr con el mismo no recarga).
    pub loaded_model: Option<String>,
    /// Una transcripción nativa está corriendo.
    pub busy: bool,
    pub download: WhisperDownloadState,
}

/// Traduce el estado de modelos del crate al DTO de la UI. `models_dir` es el
/// mismo que recibió `Transcriber::status`; `path` sólo se informa para los
/// modelos descargados.
pub fn native_whisper_models(
    status: &crate::vendor_concat::speech::TranscriberStatus,
) -> Vec<NativeWhisperModel> {
    let dir = std::path::Path::new(&status.models_dir);
    status
        .models
        .iter()
        .map(|model| {
            let downloaded = model.downloaded;
            NativeWhisperModel {
                id: model.id.clone(),
                label: model.label.clone(),
                blurb: model.blurb.clone(),
                english_only: model.english_only,
                size_bytes: model.size_bytes,
                downloaded,
                path: if downloaded {
                    Some(
                        dir.join(format!("ggml-{}.bin", model.id))
                            .to_string_lossy()
                            .into_owned(),
                    )
                } else {
                    None
                },
            }
        })
        .collect()
}

/// Progreso del crate (`DownloadProgress`) al DTO serializable de la UI.
pub fn whisper_download_progress(
    progress: &crate::vendor_concat::speech::DownloadProgress,
) -> WhisperModelDownloadProgress {
    WhisperModelDownloadProgress {
        model_id: progress.id.clone(),
        received: progress.received,
        total: progress.total,
        unpacking: progress.unpacking,
        done: progress.done,
        percent: (progress.total > 0)
            .then(|| (progress.received as f64 / progress.total as f64 * 100.0).min(100.0)),
    }
}

pub fn derive_hf_home(python: &Path) -> Option<PathBuf> {
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

pub fn validate_model(value: &str) -> Result<String, ProjectError> {
    match value.trim() {
        "tiny" | "base" | "small" | "medium" => Ok(value.trim().to_owned()),
        "" => Ok("small".to_owned()),
        _ => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "modelo de transcripción no permitido; usá tiny, base, small o medium",
        )),
    }
}

pub fn validate_language(value: &str) -> Result<String, ProjectError> {
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

pub fn parse_result(raw: &[u8]) -> Result<TranscriptionResult, ProjectError> {
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
    sanitize_result(&mut result);
    Ok(result)
}

/// Los límites que toda transcripción respeta, venga del JSON de
/// faster-whisper o de los segmentos nativos: tope de segmentos, texto por
/// segmento y palabras por segmento.
fn sanitize_result(result: &mut TranscriptionResult) {
    if result.segments.len() > MAX_SEGMENTS {
        result.segments.truncate(MAX_SEGMENTS);
    }
    for segment in &mut result.segments {
        if segment.text.chars().count() > 500 {
            segment.text = segment.text.chars().take(500).collect();
        }
        segment.words.truncate(200);
    }
}

#[cfg(test)]
#[path = "transcribe.tests.rs"]
mod tests;
