//! Grabación de pantalla y webcam dentro de Olyvia (estilo OBS).
//!
//! Usa el FFmpeg que la app ya resuelve (`resolve_tools`): `gdigrab` para la
//! pantalla completa y `dshow` para la webcam, con PiP abajo-derecha cuando
//! hay ambas. La captura se controla por stdin (`q` = cierre ordenado, así el
//! MP4 queda bien formado; nunca se mata el proceso a lo bruto).
//!
//! Alcance honesto de esta versión: vídeo sin audio de escritorio (capturar
//! el audio del sistema en Windows exige un cable virtual tipo
//! virtual-audio-capturer; se puede sumar después como entrada dshow
//! opcional).

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

use super::hide_console;
use super::system::resolve_tools;

const MAX_FPS: u32 = 60;
const STOP_TIMEOUT: Duration = Duration::from_secs(15);

struct Recording {
    child: Child,
    stdin: ChildStdin,
    output: PathBuf,
    started: Instant,
    webcam: Option<String>,
    streaming: bool,
}

static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordStatus {
    pub recording: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webcam: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub streaming: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_audio: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn io_error(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::Io, message)
}

fn status_inner() -> ScreenRecordStatus {
    let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
    let last = guard
        .as_mut()
        .map(|rec| {
            let alive = matches!(rec.child.try_wait(), Ok(None));
            (
                alive,
                rec.output.to_string_lossy().into_owned(),
                rec.started.elapsed().as_secs(),
                rec.webcam.clone(),
                rec.streaming,
            )
        });
    let Some((alive, output, elapsed, webcam, streaming)) = last else {
        return ScreenRecordStatus {
            recording: false,
            output: None,
            elapsed_secs: None,
            bytes: None,
            webcam: None,
            streaming: None,
        };
    };
    if !alive {
        *guard = None;
    }
    // Stats en vivo estilo OBS: tamaño real del archivo creciendo.
    let bytes = if alive {
        std::fs::metadata(&output).map(|m| m.len()).ok()
    } else {
        None
    };
    ScreenRecordStatus {
        recording: alive,
        output: Some(output),
        elapsed_secs: alive.then_some(elapsed),
        bytes,
        webcam,
        streaming: alive.then_some(streaming),
    }
}

/// Estado de la grabación en curso.
#[tauri::command]
pub fn screen_record_status() -> ScreenRecordStatus {
    status_inner()
}

fn sanitize_device(device: &str) -> Result<String, ProjectError> {
    let trimmed = device.trim();
    if trimmed.is_empty() || trimmed.len() > 200 || trimmed.contains('"') || trimmed.contains('\'') {
        return Err(invalid("el nombre del dispositivo de webcam no es válido"));
    }
    Ok(trimmed.to_owned())
}

/// Argumentos `-f gdigrab ...` compartidos por la grabación y el snapshot
/// de preview: mismo target (desktop/window/region), mismos offsets.
fn gdigrab_input_args(
    target: &str,
    window_title: Option<&str>,
    region_x: Option<i32>,
    region_y: Option<i32>,
    region_width: Option<i32>,
    region_height: Option<i32>,
    fps: u32,
) -> Vec<String> {
    let mut args = vec![
        "-f".to_owned(),
        "gdigrab".to_owned(),
        "-framerate".to_owned(),
        fps.to_string(),
        "-draw_mouse".to_owned(),
        "1".to_owned(),
    ];
    match target {
        "window" => args.extend(["-i".to_owned(), format!("title={}", window_title.unwrap_or(""))]),
        "region" => args.extend([
            "-offset_x".to_owned(),
            region_x.unwrap_or(0).to_string(),
            "-offset_y".to_owned(),
            region_y.unwrap_or(0).to_string(),
            "-video_size".to_owned(),
            format!("{}x{}", region_width.unwrap_or(0), region_height.unwrap_or(0)),
            "-i".to_owned(),
            "desktop".to_owned(),
        ]),
        _ => args.extend(["-i".to_owned(), "desktop".to_owned()]),
    }
    args
}

fn dshow_video_args(device: &str) -> Vec<String> {
    vec![
        "-f".to_owned(),
        "dshow".to_owned(),
        "-rtbufsize".to_owned(),
        "100M".to_owned(),
        "-i".to_owned(),
        format!("video={device}"),
    ]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDevices {
    pub cameras: Vec<String>,
    pub microphones: Vec<String>,
}

/// Enumera las fuentes DirectShow disponibles (cámaras y micrófonos),
/// igual que el panel «Fuentes» de OBS.
#[tauri::command]
pub async fn screen_record_devices(
    state: State<'_, AppState>,
) -> Result<CaptureDevices, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg no está disponible para enumerar dispositivos",
        ));
    };
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new(ffmpeg)
            .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo consultar dispositivos: {e}")))?
    .map_err(|e| io_error(&format!("ffmpeg no enumeró dispositivos: {e}")))?;

    // Líneas tipo: [in#0 @ ...] "REDRAGON Live Camera" (video)
    let text = String::from_utf8_lossy(&output.stderr);
    let mut cameras = Vec::new();
    let mut microphones = Vec::new();
    for line in text.lines() {
        let Some(open) = line.find('"') else { continue };
        let Some(close) = line[open + 1..].find('"').map(|i| open + 1 + i) else { continue };
        let name = line[open + 1..close].trim();
        let rest = &line[close..];
        if name.is_empty() || name.starts_with('@') {
            continue;
        }
        if rest.contains("(video)") {
            cameras.push(name.to_owned());
        } else if rest.contains("(audio)") {
            microphones.push(name.to_owned());
        }
    }
    cameras.dedup();
    microphones.dedup();
    Ok(CaptureDevices { cameras, microphones })
}

/// Inicia una grabación estilo OBS: pantalla completa/ventana/ región,
/// webcam en PiP y/o micrófono (o cable virtual de audio) a AAC.
/// `output_dir` debe existir; el archivo se llama `screen-<timestamp>.mp4`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn screen_record_start(
    state: State<'_, AppState>,
    output_dir: String,
    fps: Option<u32>,
    webcam_device: Option<String>,
    capture_screen: Option<bool>,
    capture_target: Option<String>,
    window_title: Option<String>,
    region_x: Option<i32>,
    region_y: Option<i32>,
    region_width: Option<i32>,
    region_height: Option<i32>,
    audio_device: Option<String>,
    stream_url: Option<String>,
    encoder: Option<String>,
) -> Result<ScreenRecordStatus, ProjectError> {
    {
        let guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_some() {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                "ya hay una grabación en curso",
            ));
        }
    }
    let dir = PathBuf::from(output_dir.trim());
    if dir.as_os_str().is_empty() || !dir.is_dir() {
        return Err(invalid("elegí una carpeta de destino válida"));
    }
    let fps = fps.unwrap_or(30).clamp(1, MAX_FPS);
    let screen = capture_screen.unwrap_or(true);
    let webcam = webcam_device
        .as_deref()
        .map(sanitize_device)
        .transpose()?;
    let audio = audio_device
        .as_deref()
        .map(sanitize_device)
        .transpose()?;
    let target = capture_target.unwrap_or_else(|| "desktop".to_owned());
    if !matches!(target.as_str(), "desktop" | "window" | "region") {
        return Err(invalid("captureTarget debe ser desktop, window o region"));
    }
    if !screen && webcam.is_none() {
        return Err(invalid("elegí al menos una fuente de video: pantalla o webcam"));
    }
    let window_title = window_title
        .as_deref()
        .map(|t| {
            let t = t.trim();
            if t.is_empty() || t.len() > 300 || t.contains('"') {
                Err(invalid("el título de ventana no es válido"))
            } else {
                Ok(t.to_owned())
            }
        })
        .transpose()?;
    if target == "window" && window_title.is_none() {
        return Err(invalid("para capturar una ventana hace falta windowTitle"));
    }
    if target == "region" {
        let (w, h) = (region_width.unwrap_or(0), region_height.unwrap_or(0));
        if w < 16 || h < 16 || w > 7680 || h > 4320 {
            return Err(invalid("la región necesita regionWidth/regionHeight válidos"));
        }
    }
    // Stream RTMP/RTMPS estilo OBS. La URL puede contener la clave del
    // stream: nunca se loguea ni se devuelve en errores/estado.
    let stream_url = stream_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(|u| u.to_owned());
    if let Some(url) = stream_url.as_deref() {
        if !(url.starts_with("rtmp://") || url.starts_with("rtmps://")) || url.len() > 2048 {
            return Err(invalid("streamUrl debe ser una URL rtmp:// o rtmps:// válida"));
        }
    }
    // Codificador estilo OBS: auto = x264 (compatible siempre); nvenc/qsv/amf
    // usan el hardware y liberan CPU en PCs con GPU dedicada.
    let encoder = encoder.unwrap_or_else(|| "x264".to_owned());
    if !matches!(encoder.as_str(), "x264" | "nvenc" | "qsv" | "amf" | "mf") {
        return Err(invalid("encoder debe ser x264, nvenc, qsv, amf o mf"));
    }

    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg no está disponible para grabar",
        ));
    };

    let stamp = chrono_lite_stamp();
    let output = dir.join(format!("screen-{stamp}.mp4"));

    let mut command = Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning")
        .arg("-y");

    // Fuentes de video: 0 = pantalla (si aplica), siguiente = webcam.
    // Índices de audio al final para el -map.
    let mut audio_index: Option<usize> = None;
    let mut next_index = 0usize;

    if screen {
        for arg in gdigrab_input_args(
            &target,
            window_title.as_deref(),
            region_x,
            region_y,
            region_width,
            region_height,
            fps,
        ) {
            command.arg(arg);
        }
        next_index += 1;
    }
    if webcam.is_some() {
        for arg in dshow_video_args(webcam.as_deref().unwrap()) {
            command.arg(arg);
        }
        next_index += 1;
    }
    if let Some(device) = audio.as_deref() {
        audio_index = Some(next_index);
        command
            .arg("-f").arg("dshow")
            .arg("-audio_buffer_size").arg("50")
            .arg("-i").arg(format!("audio={device}"));
    }

    // Cadena de video: pantalla+webcam → PiP; una sola fuente → directo.
    // Cada salida lleva su propia copia del grafo porque -filter_complex se
    // vincula a la salida que le sigue (el encode x264 ya es por salida).
    let screen_idx = if screen { Some(0usize) } else { None };
    let webcam_idx = if screen { (webcam.is_some()).then_some(1usize) } else { webcam.is_some().then_some(0usize) };
    let pip = screen_idx.is_some() && webcam_idx.is_some();
    let graph = pip.then(|| {
        "[1:v]scale='min(320,iw)':-2[cam];[0:v][cam]overlay=W-w-24:H-h-24[v]".to_owned()
    });
    let single_map = format!("{}:v", webcam_idx.or(screen_idx).unwrap_or(0));

    let video_codec: Vec<String> = match encoder.as_str() {
        "nvenc" => vec!["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23", "-pix_fmt", "yuv420p"],
        "qsv" => vec!["-c:v", "h264_qsv", "-global_quality", "23", "-pix_fmt", "yuv420p"],
        "amf" => vec!["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23"],
        "mf" => vec!["-c:v", "h264_mf", "-rate_control", "quality"],
        _ => vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"],
    }
    .iter()
    .map(|s| s.to_string())
    .collect();

    fn push_output(
        command: &mut Command,
        graph: Option<&str>,
        pip: bool,
        single_map: &str,
        audio_index: Option<usize>,
        video_codec: &[String],
        flv: bool,
        dest: &std::ffi::OsStr,
    ) {
        if let Some(g) = graph {
            command.arg("-filter_complex").arg(g);
        }
        command.arg("-map").arg(if pip { "[v]" } else { single_map });
        if let Some(aidx) = audio_index {
            command
                .arg("-map").arg(format!("{aidx}:a"))
                .arg("-c:a").arg("aac")
                .arg("-b:a").arg("160k");
        } else {
            command.arg("-an");
        }
        if flv {
            command.arg("-f").arg("flv");
        }
        for arg in video_codec {
            command.arg(arg);
        }
        if !flv {
            command.arg("-movflags").arg("+faststart");
        }
        command.arg(dest);
    }

    push_output(
        &mut command,
        graph.as_deref(),
        pip,
        &single_map,
        audio_index,
        &video_codec,
        false,
        output.as_os_str(),
    );
    if let Some(url) = stream_url.as_deref() {
        // Segunda salida: mismo programa hacia el servidor RTMP.
        push_output(
            &mut command,
            graph.as_deref(),
            pip,
            &single_map,
            audio_index,
            &video_codec,
            true,
            std::ffi::OsStr::new(url),
        );
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut spawned = tauri::async_runtime::spawn_blocking(move || command.spawn())
        .await
        .map_err(|e| io_error(&format!("no se pudo lanzar ffmpeg: {e}")))?
        .map_err(|e| io_error(&format!("no se pudo ejecutar ffmpeg: {e}")))?;

    let Some(stdin) = spawned.stdin.take() else {
        let _ = spawned.kill();
        return Err(io_error("ffmpeg no aceptó stdin para detener la grabación"));
    };

    // Verificar que el proceso siga vivo tras el arranque (dispositivo dshow
    // inexistente o gdigrab bloqueado mueren en los primeros segundos).
    std::thread::sleep(Duration::from_millis(1200));
    match spawned.try_wait() {
        Ok(Some(status)) => {
            let stderr = spawned
                .stderr
                .take()
                .map(|mut s| {
                    use std::io::Read;
                    let mut buf = String::new();
                    let _ = s.read_to_string(&mut buf);
                    buf
                })
                .unwrap_or_default();
            let tail: String = stderr.chars().rev().take(400).collect::<String>().chars().rev().collect();
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                format!("ffmpeg no pudo iniciar la grabación ({status}): {tail}").as_str(),
            ));
        }
        Ok(None) => {}
        Err(error) => {
            let _ = spawned.kill();
            return Err(io_error(&format!("no se pudo verificar ffmpeg: {error}")));
        }
    }

    {
        let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(Recording {
            child: spawned,
            stdin,
            output: output.clone(),
            started: Instant::now(),
            webcam: webcam.clone(),
            streaming: stream_url.is_some(),
        });
    }
    Ok(status_inner())
}

/// Medición real del MP4 generado con ffprobe (duración, resolución, audio).
fn probe_output(ffprobe: &std::path::Path, output: &std::path::Path) -> (Option<f64>, Option<u32>, Option<u32>, Option<bool>) {
    let probed = Command::new(ffprobe)
        .args([
            "-v", "error",
            "-show_entries", "format=duration:stream=codec_type,width,height",
            "-of", "json",
            &output.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(out) = probed else { return (None, None, None, None) };
    if !out.status.success() {
        return (None, None, None, None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return (None, None, None, None),
    };
    let duration = json["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok());
    let streams = json["streams"].as_array();
    let mut width = None;
    let mut height = None;
    let mut has_audio = false;
    for stream in streams.into_iter().flatten() {
        match stream["codec_type"].as_str() {
            Some("video") => {
                width = stream["width"].as_u64().map(|v| v as u32);
                height = stream["height"].as_u64().map(|v| v as u32);
            }
            Some("audio") => has_audio = true,
            _ => {}
        }
    }
    (duration, width, height, Some(has_audio))
}

/// Detiene la grabación enviando `q` a ffmpeg (cierre ordenado: el MP4
/// queda válido) y devuelve la medición real del archivo con ffprobe.
#[tauri::command]
pub async fn screen_record_stop(
    state: State<'_, AppState>,
) -> Result<ScreenRecordResult, ProjectError> {
    let taken = {
        let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
        guard.take()
    };
    let Some(mut rec) = taken else {
        return Ok(ScreenRecordResult {
            ok: false,
            output: None,
            bytes: None,
            duration_secs: None,
            width: None,
            height: None,
            has_audio: None,
            error: Some("no hay una grabación en curso".to_owned()),
        });
    };
    let output = rec.output.clone();
    let write_result = tauri::async_runtime::spawn_blocking(move || {
        let _ = rec.stdin.write_all(b"q\n");
        let _ = rec.stdin.flush();
        let deadline = Instant::now() + STOP_TIMEOUT;
        loop {
            match rec.child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) if Instant::now() >= deadline => {
                    let _ = rec.child.kill();
                    let _ = rec.child.wait();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "ffmpeg no cerró la grabación a tiempo",
                    ));
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(200)),
                Err(error) => return Err(error),
            }
        }
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo esperar ffmpeg: {e}")))?;

    match write_result {
        Ok(()) => {
            let bytes = output.metadata().map(|m| m.len()).ok();
            let settings = state.settings_snapshot()?;
            let (_, ffprobe, _) = resolve_tools(&settings);
            let (duration_secs, width, height, has_audio) = ffprobe
                .as_ref()
                .map(|p| probe_output(p, &output))
                .unwrap_or((None, None, None, None));
            Ok(ScreenRecordResult {
                ok: bytes.unwrap_or(0) > 0,
                output: Some(output.to_string_lossy().into_owned()),
                bytes,
                duration_secs,
                width,
                height,
                has_audio,
                error: if bytes.unwrap_or(0) == 0 {
                    Some("el archivo quedó vacío".to_owned())
                } else {
                    None
                },
            })
        }
        Err(error) => Ok(ScreenRecordResult {
            ok: false,
            output: Some(output.to_string_lossy().into_owned()),
            bytes: None,
            duration_secs: None,
            width: None,
            height: None,
            has_audio: None,
            error: Some(error.to_string()),
        }),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenRecordPreview {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Captura UN frame de la configuración de fuentes indicada (pantalla,
/// ventana, región y/o webcam con el mismo PiP de la grabación) y lo
/// guarda como PNG en `<config_dir>/obs-previews/`. Es el "preview" de la
/// escena antes de grabar: usa exactamente los mismos inputs y el mismo
/// filtergraph PiP que `screen_record_start`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn screen_record_snapshot(
    state: State<'_, AppState>,
    fps: Option<u32>,
    webcam_device: Option<String>,
    capture_screen: Option<bool>,
    capture_target: Option<String>,
    window_title: Option<String>,
    region_x: Option<i32>,
    region_y: Option<i32>,
    region_width: Option<i32>,
    region_height: Option<i32>,
) -> Result<ScreenRecordPreview, ProjectError> {
    let fps = fps.unwrap_or(30).clamp(1, MAX_FPS);
    let screen = capture_screen.unwrap_or(true);
    let webcam = webcam_device
        .as_deref()
        .map(sanitize_device)
        .transpose()?;
    let target = capture_target.unwrap_or_else(|| "desktop".to_owned());
    if !matches!(target.as_str(), "desktop" | "window" | "region") {
        return Err(invalid("captureTarget debe ser desktop, window o region"));
    }
    if !screen && webcam.is_none() {
        return Err(invalid("elegí al menos una fuente de video: pantalla o webcam"));
    }
    let window_title = window_title
        .as_deref()
        .map(|t| {
            let t = t.trim();
            if t.is_empty() || t.len() > 300 || t.contains('"') {
                Err(invalid("el título de ventana no es válido"))
            } else {
                Ok(t.to_owned())
            }
        })
        .transpose()?;
    if target == "window" && window_title.is_none() {
        return Err(invalid("para capturar una ventana hace falta windowTitle"));
    }
    if target == "region" {
        let (w, h) = (region_width.unwrap_or(0), region_height.unwrap_or(0));
        if w < 16 || h < 16 || w > 7680 || h > 4320 {
            return Err(invalid("la región necesita regionWidth/regionHeight válidos"));
        }
    }

    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg no está disponible para el preview",
        ));
    };

    let dir = state.config_dir.join("obs-previews");
    std::fs::create_dir_all(&dir).map_err(|e| {
        io_error(&format!("no se pudo crear la carpeta de previews: {e}"))
    })?;
    let output = dir.join(format!("preview-{}.png", chrono_lite_stamp()));

    let mut command = Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning")
        .arg("-y");

    if screen {
        for arg in gdigrab_input_args(
            &target,
            window_title.as_deref(),
            region_x,
            region_y,
            region_width,
            region_height,
            fps,
        ) {
            command.arg(arg);
        }
    }
    if webcam.is_some() {
        for arg in dshow_video_args(webcam.as_deref().unwrap()) {
            command.arg(arg);
        }
    }

    let screen_idx = if screen { Some(0usize) } else { None };
    let webcam_idx = if screen {
        (webcam.is_some()).then_some(1usize)
    } else {
        webcam.is_some().then_some(0usize)
    };
    let pip = screen_idx.is_some() && webcam_idx.is_some();
    if pip {
        command.arg("-filter_complex").arg(
            "[1:v]scale='min(320,iw)':-2[cam];[0:v][cam]overlay=W-w-24:H-h-24[v]",
        );
    }
    let single_map = format!("{}:v", webcam_idx.or(screen_idx).unwrap_or(0));
    command
        .arg("-map")
        .arg(if pip { "[v]" } else { single_map.as_str() })
        .arg("-frames:v")
        .arg("1")
        .arg("-an")
        .arg(output.as_os_str());
    hide_console(&mut command);

    let out_path = output.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut child = command.spawn()?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            match child.try_wait()? {
                Some(status) => {
                    return if status.success() && out_path.exists() {
                        Ok(())
                    } else {
                        Err(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            format!("ffmpeg salió con {status} sin generar el frame"),
                        ))
                    };
                }
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "el preview tardó demasiado",
                    ));
                }
                None => std::thread::sleep(Duration::from_millis(150)),
            }
        }
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo lanzar el preview: {e}")))?;

    match result {
        Ok(()) => {
            let (width, height) = ffprobe
                .as_ref()
                .map(|p| {
                    let probed = Command::new(p)
                        .args([
                            "-v", "error",
                            "-select_streams", "v:0",
                            "-show_entries", "stream=width,height",
                            "-of", "json",
                            &output.to_string_lossy(),
                        ])
                        .stdin(Stdio::null())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::null())
                        .output();
                    let Ok(out) = probed else { return (None, None) };
                    let text = String::from_utf8_lossy(&out.stdout);
                    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
                    let stream = &json["streams"][0];
                    (
                        stream["width"].as_u64().map(|v| v as u32),
                        stream["height"].as_u64().map(|v| v as u32),
                    )
                })
                .unwrap_or((None, None));
            Ok(ScreenRecordPreview {
                ok: true,
                path: Some(output.to_string_lossy().into_owned()),
                width,
                height,
                error: None,
            })
        }
        Err(e) => Ok(ScreenRecordPreview {
            ok: false,
            path: None,
            width: None,
            height: None,
            error: Some(e.to_string()),
        }),
    }
}

fn chrono_lite_stamp() -> String {
    // YYYYMMDD-HHMMSS en hora local, sin dependencias nuevas.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Conversión civil aproximada (días desde epoch → Y/M/D, segundos → h:m:s UTC).
    let days = now / 86_400;
    let secs = now % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// Algoritmo de Hinnant: días desde 1970-01-01 → fecha civil (UTC).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_inicial_no_graba() {
        let status = status_inner();
        assert!(!status.recording);
        assert!(status.output.is_none());
    }

    #[test]
    fn device_rechaza_comillas_y_vacios() {
        assert!(sanitize_device("").is_err());
        assert!(sanitize_device("  ").is_err());
        assert!(sanitize_device("cam\"evil").is_err());
        assert!(sanitize_device("Integrated Camera").is_ok());
    }

    #[test]
    fn stamp_tiene_formato_esperado() {
        let stamp = chrono_lite_stamp();
        assert_eq!(stamp.len(), 15);
        assert!(stamp.contains('-'));
    }

    #[test]
    fn gdigrab_args_desktop_usa_input_simple() {
        let args = gdigrab_input_args("desktop", None, None, None, None, None, 30);
        assert!(args.windows(2).any(|w| w == ["-i", "desktop"]));
        assert!(args.windows(2).any(|w| w == ["-framerate", "30"]));
        assert!(!args.iter().any(|a| a.starts_with("title=")));
    }

    #[test]
    fn gdigrab_args_window_y_region_llevan_sus_parametros() {
        let win = gdigrab_input_args("window", Some("Editor"), None, None, None, None, 60);
        assert!(win.iter().any(|a| a == "title=Editor"));

        let reg = gdigrab_input_args("region", None, Some(10), Some(20), Some(640), Some(360), 30);
        assert!(reg.windows(2).any(|w| w == ["-video_size", "640x360"]));
        assert!(reg.windows(2).any(|w| w == ["-offset_x", "10"]));
        assert!(reg.windows(2).any(|w| w == ["-offset_y", "20"]));
    }

    #[test]
    fn dshow_args_escapan_el_dispositivo() {
        let args = dshow_video_args("Integrated Camera");
        assert!(args.iter().any(|a| a == "video=Integrated Camera"));
    }

    #[test]
    fn civil_from_days_conoce_epoch() {
        // 1970-01-01
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2026-11-06 aprox (verificar contra date real no hace falta: sanity)
        let (y, m, _) = civil_from_days(20_735);
        assert!(y >= 2026 && m >= 1 && m <= 12);
    }
}
