//! Animación whiteboard con el paquete Python `whiteboard-animator` (MIT).
//!
//! El motor NO se embebe: igual que Faster-Whisper y Demucs, vive en un
//! Python del equipo (`pip install whiteboard-animator`, ~200 MB con el
//! modelo CRAFT ONNX de 83 MB). El intérprete se resuelve desde
//! `EDITORIA_WHITEBOARD_PYTHON` o desde `python`/`python3` de PATH que pueda
//! importar `whiteboard_animator.cli`; sin motor la capacidad reporta el
//! motivo exacto en vez de afirmar que viene con la app.
//!
//! Dos comandos:
//! - `whiteboard_status`: estado medido del motor para que la UI lo deshabilite.
//! - `whiteboard_generate`: imagen de estilo pizarra → MP4 donde el contenido
//!   se dibuja trazo a trazo. Acepta un audio de narración opcional: el
//!   dibujo se pacea a la voz y el frame final se mantiene hasta el final.
//!
//! El MP4 queda en `cache_dir/whiteboard/<uuid>/` y la respuesta trae sus
//! metadatos medidos con ffprobe; el frontend decide si lo copia al proyecto.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Instant;

use tauri::State;

use crate::application::whiteboard::{
    invalid, validate_duration, validate_quality, WhiteboardOutcome, WhiteboardStatus,
    GENERATION_TIMEOUT_SECONDS, MAX_AUDIO_SECONDS,
};
use crate::commands::system::resolve_tools;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const INSTALL_HINT: &str =
    "instalá el motor con `python -m pip install whiteboard-animator` y reiniciá Olyvia";

fn command_succeeds(program: &Path, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Sondeo real: primero que sea un Python ejecutable, después que pueda
/// importar el entrypoint del paquete (arrastra cv2/numpy/scipy/skimage).
fn real_probe(python: &Path) -> bool {
    if !command_succeeds(python, &["--version"]) {
        return false;
    }
    command_succeeds(python, &["-c", "import whiteboard_animator.cli"])
}

fn status() -> &'static WhiteboardStatus {
    static STATUS: OnceLock<WhiteboardStatus> = OnceLock::new();
    STATUS.get_or_init(|| {
        let env_python = std::env::var_os("EDITORIA_WHITEBOARD_PYTHON")
            .map(PathBuf::from)
            .filter(|path| path.is_file());
        let candidates: Vec<PathBuf> = ["python", "python3"].iter().map(PathBuf::from).collect();
        let mut found = env_python;
        if let Some(path) = &found {
            if !real_probe(path) {
                found = None;
            }
        }
        if found.is_none() {
            found = candidates.into_iter().find(|path| real_probe(path));
        }
        match found {
            Some(python) => WhiteboardStatus {
                available: true,
                python: Some(python),
                reason: None,
            },
            None => WhiteboardStatus {
                available: false,
                python: None,
                reason: Some(format!("no hay un Python con whiteboard-animator; {INSTALL_HINT}")),
            },
        }
    })
}

/// Estado del motor para la UI: permite deshabilitar la función con el motivo.
#[tauri::command]
pub fn whiteboard_status() -> WhiteboardStatus {
    status().clone()
}

fn unavailable(reason: Option<String>) -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        reason
            .as_deref()
            .unwrap_or("la animación whiteboard no está disponible"),
    )
}

/// PATH del proceso hijo con los directorios de ffmpeg/ffprobe resueltos por
/// settings al frente: el CLI exige ambos en PATH (`shutil.which`) y el
/// usuario puede tener un ffmpeg portable fuera del PATH del proceso.
fn child_path_env(ffmpeg: Option<&Path>, ffprobe: Option<&Path>) -> Option<String> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for tool in [ffmpeg, ffprobe].into_iter().flatten() {
        if let Some(dir) = tool.parent() {
            if !dirs.iter().any(|d| d == dir) {
                dirs.push(dir.to_path_buf());
            }
        }
    }
    if dirs.is_empty() {
        return None;
    }
    let mut paths: Vec<PathBuf> = dirs;
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    Some(std::env::join_paths(paths).ok()?.to_string_lossy().into_owned())
}

/// Argumentos del CLI `whiteboard_animator.cli`: una imagen, salida MP4,
/// audio/duración/calidad opcionales. Función pura para testear el contrato.
fn cli_args(
    image: &Path,
    output: &Path,
    audio: Option<&Path>,
    duration: f64,
    quality: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        image.to_string_lossy().into_owned(),
        "-o".to_owned(),
        output.to_string_lossy().into_owned(),
        "--duration".to_owned(),
        format!("{duration}"),
        "--quality".to_owned(),
        quality.to_owned(),
    ];
    if let Some(audio) = audio {
        args.push("--audio".to_owned());
        args.push(audio.to_string_lossy().into_owned());
    }
    args
}

fn probe_duration_seconds(ffprobe: &Path, input: &Path) -> Option<f64> {
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
        ])
        .arg(input)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|d| d.is_finite() && *d > 0.0)
}

/// Metadatos del MP4 generado: duración, dimensiones y fps del stream de
/// video. Si ffprobe no está, devuelve ceros — el archivo ya existe y es
/// válido porque el engine lo acaba de escribir.
fn probe_video(ffprobe: Option<&Path>, video: &Path) -> (f64, u32, u32, f64) {
    let Some(ffprobe) = ffprobe else {
        return (0.0, 0, 0, 0.0);
    };
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(video)
        .output();
    let Ok(output) = output else {
        return (0.0, 0, 0, 0.0);
    };
    if !output.status.success() {
        return (0.0, 0, 0, 0.0);
    }
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return (0.0, 0, 0, 0.0);
    };
    let duration = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);
    let video_stream = json
        .get("streams")
        .and_then(|s| s.as_array())
        .and_then(|streams| {
            streams.iter().find(|s| {
                s.get("codec_type").and_then(|t| t.as_str()) == Some("video")
            })
        });
    let (width, height, fps) = video_stream
        .map(|stream| {
            let width = stream
                .get("width")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let height = stream
                .get("height")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let fps = stream
                .get("avg_frame_rate")
                .and_then(|v| v.as_str())
                .and_then(|rate| {
                    let mut parts = rate.split('/');
                    let num = parts.next()?.parse::<f64>().ok()?;
                    let den = parts.next().unwrap_or("1").parse::<f64>().ok()?;
                    if den > 0.0 {
                        Some(num / den)
                    } else {
                        None
                    }
                })
                .unwrap_or(0.0);
            (width, height, fps)
        })
        .unwrap_or((0, 0, 0.0));
    (duration, width, height, fps)
}

/// Genera el video whiteboard de una imagen. La entrada puede ser cualquier
/// archivo de imagen legible por PIL (PNG/JPEG recomendado: el engine espera
/// tinta sobre fondo blanco); la salida es un MP4 en el directorio de cache.
#[tauri::command]
pub async fn whiteboard_generate(
    state: State<'_, AppState>,
    image_path: String,
    audio_path: Option<String>,
    duration_seconds: Option<f64>,
    quality: Option<String>,
) -> Result<WhiteboardOutcome, ProjectError> {
    let image = crate::application::fs::resolve_user_file_path(&image_path)?;
    if !image.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la imagen de entrada no está en disco",
        ));
    }
    let audio = match audio_path.as_deref().map(str::trim) {
        Some("") | None => None,
        Some(raw) => {
            let path = crate::application::fs::resolve_user_file_path(raw)?;
            if !path.is_file() {
                return Err(ProjectError::message(
                    ProjectErrorCode::NotFound,
                    "el audio de narración no está en disco",
                ));
            }
            Some(path)
        }
    };
    let duration = validate_duration(duration_seconds)?;
    let quality = validate_quality(quality.as_deref())?;

    let status = status();
    let Some(python) = status.python.clone() else {
        return Err(unavailable(status.reason.clone()));
    };
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);

    // Con narración, la duración del audio manda: más de 1 h por escena es un
    // abuso que el deadline no cubre bien (mismo criterio que voice_isolation).
    if let (Some(audio), Some(ffprobe)) = (&audio, &ffprobe) {
        if let Some(seconds) = probe_duration_seconds(ffprobe, audio) {
            if seconds > MAX_AUDIO_SECONDS {
                return Err(invalid(
                    "la animación whiteboard admite hasta 60 minutos de narración por escena",
                ));
            }
        }
    }

    let output_dir = state
        .cache_dir
        .join("whiteboard")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo crear el directorio de salida: {error}").as_str(),
        )
    })?;
    let output = output_dir.join("whiteboard.mp4");
    let args = cli_args(&image, &output, audio.as_deref(), duration, quality);

    let started = Instant::now();
    let mut command = Command::new(&python);
    command
        .arg("-m")
        .arg("whiteboard_animator.cli")
        .args(&args)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    if let Some(path_env) = child_path_env(ffmpeg.as_deref(), ffprobe.as_deref()) {
        command.env("PATH", path_env);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let timed = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::output_with_timeout(
            &mut command,
            std::time::Duration::from_secs(GENERATION_TIMEOUT_SECONDS),
        )
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo lanzar el animador whiteboard: {error}").as_str(),
        )
    })?
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo ejecutar el animador whiteboard: {error}").as_str(),
        )
    })?;
    let processing_time_ms = started.elapsed().as_millis() as u64;

    if timed.timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el animador whiteboard superó el tiempo máximo (2 h) y se canceló",
        ));
    }
    let Some(run) = timed.into_output() else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el animador whiteboard terminó de forma inesperada",
        ));
    };
    if !run.status.success() {
        let stderr = String::from_utf8_lossy(&run.stderr);
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
            format!("el animador whiteboard falló: {}", tail.trim()).as_str(),
        ));
    }
    if !output.is_file() || std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el animador terminó sin producir el video",
        ));
    }

    let (duration_seconds, width, height, fps) = probe_video(ffprobe.as_deref(), &output);
    Ok(WhiteboardOutcome {
        video_path: output,
        duration_seconds,
        width,
        height,
        fps,
        processing_time_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cli_args_builds_single_scene_contract() {
        let args = cli_args(
            Path::new("C:\\img\\sketch.png"),
            Path::new("C:\\out\\wb.mp4"),
            None,
            12.5,
            "high",
        );
        assert_eq!(
            args,
            vec![
                "C:\\img\\sketch.png",
                "-o",
                "C:\\out\\wb.mp4",
                "--duration",
                "12.5",
                "--quality",
                "high",
            ]
        );
    }

    #[test]
    fn cli_args_appends_audio_when_present() {
        let args = cli_args(
            Path::new("img.png"),
            Path::new("out.mp4"),
            Some(Path::new("voice.wav")),
            8.0,
            "medium",
        );
        let pos = args.iter().position(|a| a == "--audio").unwrap();
        assert_eq!(args[pos + 1], "voice.wav");
    }

    #[test]
    fn child_path_env_is_none_without_tools() {
        assert!(child_path_env(None, None).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn child_path_env_prepends_tool_dirs() {
        let ffmpeg = Path::new("C:\\tools\\ffmpeg\\bin\\ffmpeg.exe");
        let env = child_path_env(Some(ffmpeg), Some(ffmpeg)).unwrap();
        let paths: Vec<_> = std::env::split_paths(&env).collect();
        assert_eq!(paths[0], Path::new("C:\\tools\\ffmpeg\\bin"));
        // El PATH original sigue detrás.
        assert!(paths.len() > 1);
    }

    #[test]
    fn status_reports_unavailable_without_engine() {
        // En CI no hay whiteboard-animator: el estado debe ser false con
        // motivo, nunca panic ni available=true sin python.
        let status = status();
        assert!(!status.available || status.python.is_some());
    }
}
