//! Local speech-to-text with Faster-Whisper.
//!
//! The bridge script is embedded in the binary and written to the app cache.
//! Python is resolved **only** from `EDITORIA_WHISPER_PYTHON` or from a `python`
//! found on PATH that can actually `import faster_whisper`: a plain
//! `python --version` is not enough. Without a verified engine the capability
//! reports `available: false` and the exact install step instead of claiming
//! the engine ships with the app. The audio/video never leaves the computer.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::media::resolve_inside_root;
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::sanitize_log;
use crate::state::AppState;

const SCRIPT: &str = include_str!("../../scripts/transcribe_faster.py");
/// El motor no viene empaquetado: se instala en un Python del equipo.
const INSTALL_HINT: &str =
    "instalá el motor con `python -m pip install faster-whisper` y reiniciá Olyvia";
const MAX_OUTPUT_BYTES: usize = 20 * 1024 * 1024;
const MAX_SEGMENTS: usize = 2_000;

/// Resultado de sondear un Python candidato.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PythonProbe {
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
pub(crate) struct WhisperStatus {
    pub python: Option<PathBuf>,
    pub reason: Option<String>,
}

impl WhisperStatus {
    pub fn available(&self) -> bool {
        self.python.is_some()
    }
}

static STATUS: OnceLock<WhisperStatus> = OnceLock::new();

/// Estado del motor, medido una sola vez por proceso: el sondeo importa el
/// módulo y puede tardar uno o dos segundos la primera vez, así que no se
/// repite en cada consulta de capacidades. Si falta, el motivo pide reiniciar
/// la app después de instalarlo (la caché es de proceso, no de disco).
pub(crate) fn whisper_status() -> &'static WhisperStatus {
    STATUS.get_or_init(resolve_python_status)
}

fn command_succeeds(program: &Path, args: &[&str]) -> bool {
    let mut probe = Command::new(program);
    probe
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut probe);
    probe.status().map(|status| status.success()).unwrap_or(false)
}

/// Sondeo real de un candidato: primero que sea un Python ejecutable, después
/// que pueda importar el módulo. Comprobar sólo `--version` daba falsos
/// positivos en equipos sin faster-whisper.
fn real_probe(python: &Path) -> PythonProbe {
    if !command_succeeds(python, &["--version"]) {
        return PythonProbe::Missing;
    }
    if command_succeeds(python, &["-c", "import faster_whisper"]) {
        PythonProbe::Ready
    } else {
        PythonProbe::WithoutFasterWhisper
    }
}

fn resolve_python_status() -> WhisperStatus {
    let env_python = std::env::var_os("EDITORIA_WHISPER_PYTHON")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let candidates: Vec<PathBuf> = ["python", "python3"]
        .into_iter()
        .map(PathBuf::from)
        .collect();
    resolve_python_with(env_python, &candidates, &real_probe)
}

/// Resolución sobre un sondeo inyectable: ni ruta hardcodeada de la máquina del
/// autor ni atajos por nombre de archivo. Devuelve el primer intérprete
/// verificado y, si no hay ninguno, un motivo accionable.
fn resolve_python_with(
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

    let status = whisper_status();
    let Some(python) = status.python.clone() else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            &format!(
                "la transcripción no está disponible: {}",
                status
                    .reason
                    .as_deref()
                    .unwrap_or("falta un Python con faster-whisper")
            ),
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

    fn temp_python(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("olyvia-transcribe-tests");
        std::fs::create_dir_all(&dir).expect("carpeta temporal");
        let path = dir.join(name);
        std::fs::write(&path, b"# fixture").expect("fixture");
        path
    }

    /// Ejecutable real de la máquina que **no** puede importar faster-whisper:
    /// sirve como Python falso sin depender de que el equipo de tests tenga
    /// Python instalado.
    #[cfg(windows)]
    fn fake_python() -> PathBuf {
        let root = std::env::var_os("SystemRoot").expect("SystemRoot en Windows");
        PathBuf::from(root)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    #[cfg(not(windows))]
    fn fake_python() -> PathBuf {
        PathBuf::from("/bin/sh")
    }

    #[cfg(windows)]
    fn shell_program() -> PathBuf {
        std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .expect("ComSpec")
    }

    #[cfg(not(windows))]
    fn shell_program() -> PathBuf {
        PathBuf::from("/bin/sh")
    }

    #[test]
    fn command_probe_distinguishes_success_and_failure() {
        let shell = shell_program();
        let (ok, bad): (&[&str], &[&str]) = if cfg!(windows) {
            (&["/D", "/C", "exit 0"], &["/D", "/C", "exit 1"])
        } else {
            (&["-c", "exit 0"], &["-c", "exit 1"])
        };
        assert!(command_succeeds(&shell, ok));
        assert!(!command_succeeds(&shell, bad));
        assert!(!command_succeeds(
            &PathBuf::from("olyvia-python-que-no-existe-98765"),
            &["--version"]
        ));
    }

    #[test]
    fn a_fake_python_that_cannot_import_the_module_is_not_ready() {
        let fake = fake_python();
        assert!(fake.is_file(), "el fixture debe existir");
        // El chequeo clave no es `--version`, es la importación del módulo:
        // un ejecutable real que no importa faster_whisper nunca es Ready.
        assert!(!command_succeeds(&fake, &["-c", "import faster_whisper"]));
        assert_ne!(real_probe(&fake), PythonProbe::Ready);
    }

    #[test]
    fn env_python_is_used_only_when_it_is_verified() {
        let env = temp_python("python-verificado.exe");
        let status = resolve_python_with(Some(env.clone()), &[], &|path| {
            if path == env {
                PythonProbe::Ready
            } else {
                PythonProbe::Missing
            }
        });
        assert!(status.available());
        assert_eq!(status.python, Some(env));
        assert!(status.reason.is_none());
    }

    #[test]
    fn broken_env_python_reports_the_install_step() {
        let env = temp_python("python-sin-modulo.exe");
        let status = resolve_python_with(Some(env), &[], &|_| PythonProbe::WithoutFasterWhisper);
        assert!(!status.available());
        let reason = status.reason.expect("motivo");
        assert!(reason.contains("faster-whisper"), "{reason}");
        assert!(reason.contains("pip install"), "{reason}");
    }

    #[test]
    fn missing_env_path_is_reported_and_path_python_still_works() {
        let missing = std::env::temp_dir().join("olyvia-python-fantasma-98765.exe");
        let status = resolve_python_with(Some(missing), &[PathBuf::from("python")], &|path| {
            if path == Path::new("python") {
                PythonProbe::Ready
            } else {
                PythonProbe::Missing
            }
        });
        assert!(status.available());
        assert_eq!(status.python, Some(PathBuf::from("python")));
    }

    #[test]
    fn no_engine_reports_how_to_install_it() {
        let status = resolve_python_with(None, &[PathBuf::from("python")], &|_| PythonProbe::Missing);
        assert!(!status.available());
        let reason = status.reason.expect("motivo");
        assert!(reason.contains("faster-whisper"), "{reason}");
        assert!(reason.contains("EDITORIA_WHISPER_PYTHON"), "{reason}");
    }

    #[test]
    fn path_python_without_the_module_is_not_reported_as_available() {
        let status = resolve_python_with(
            None,
            &[PathBuf::from("python"), PathBuf::from("python3")],
            &|path| {
                if path == Path::new("python3") {
                    PythonProbe::WithoutFasterWhisper
                } else {
                    PythonProbe::Missing
                }
            },
        );
        assert!(!status.available());
        let reason = status.reason.expect("motivo");
        assert!(reason.contains("PATH"), "{reason}");
        assert!(reason.contains("pip install"), "{reason}");
    }

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
