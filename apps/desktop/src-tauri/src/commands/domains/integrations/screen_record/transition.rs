// Render de transición OBS entre dos escenas.
//
// A diferencia de `screen_record_start` (sesión abierta controlada por
// stdin), esto es un render FINITO: las fuentes de cada escena (pantalla
// gdigrab y/o webcam dshow con PiP y chroma) se capturan en simultáneo,
// se componen por rama y se unen con `xfade`, acotadas con `-t`. El
// proceso se espera con un deadline (total + margen); si ffmpeg se
// cuelga se mata y se reporta. Si la escena origen trae `cursorOverlay`,
// el cursor se samplea durante el render y se quema en un segundo pase
// (mismo mecanismo que `screen_record_stop`).
//
// La reserva `RECORDING` se toma como `Starting` durante todo el render:
// `status` reporta "grabando" y un `start`/`stop` concurrente se rechaza,
// igual que con una captura normal (AUD-094).

use crate::application::obs_transition::ObsTransitionSpec;
use crate::application::obs_transition::TransitionBranch;

// Captura de una escena dentro de la transición: pantalla (gdigrab) y/o
// webcam (dshow), ya validadas por el comando llamador.
#[derive(Debug, Clone)]
pub(crate) struct TransitionCapture {
    /// `None` cuando la escena no captura pantalla (`captureScreen=false`).
    pub screen: Option<ScreenTarget>,
    pub webcam_device: Option<String>,
    /// Cadena ffmpeg del chroma key ya validada (`chromakey=…,format=yuva420p`).
    pub webcam_chroma: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ScreenTarget {
    pub target: String,
    pub window_title: Option<String>,
    pub region_x: Option<i32>,
    pub region_y: Option<i32>,
    pub region_width: Option<i32>,
    pub region_height: Option<i32>,
}

const TRANSITION_WAIT_MARGIN: Duration = Duration::from_secs(90);

// Lanza ffmpeg con las fuentes de ambas escenas + xfade y espera el
// archivo finito. Devuelve `ScreenRecordResult` con las medidas ffprobe.
pub(crate) async fn run_obs_transition(
    state: &AppState,
    captures: [TransitionCapture; 2],
    spec: &ObsTransitionSpec,
    audio_device: Option<String>,
    output_dir: &std::path::Path,
    cursor_overlay: Option<CursorOverlaySpec>,
) -> Result<ScreenRecordResult, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg/ffprobe no están disponibles para la transición",
        ));
    };

    // Reserva del slot durante todo el render (ver doc del módulo).
    {
        let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
        if !matches!(*guard, RecordState::Idle) {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                "ya hay una grabación en curso",
            ));
        }
        *guard = RecordState::Starting;
    }
    let _release = RecordingStopGuard;

    let stamp = chrono_lite_stamp();
    let mut output = output_dir.join(format!("transition-{stamp}.mp4"));
    let mut suffix = 2u32;
    while output.exists() {
        output = output_dir.join(format!("transition-{stamp}-{suffix}.mp4"));
        suffix += 1;
    }

    let spec = spec.clone();
    let audio_device = audio_device
        .as_deref()
        .map(sanitize_device)
        .transpose()?;
    let ffmpeg_path = ffmpeg.clone();
    let ffprobe_path = ffprobe.clone();
    let output_path = output.clone();

    tauri::async_runtime::spawn_blocking(move || {
        run_ffmpeg_transition(
            &ffmpeg_path,
            &ffprobe_path,
            &captures,
            &spec,
            audio_device.as_deref(),
            &output_path,
            cursor_overlay,
        )
    })
    .await
    .map_err(|e| io_error(&format!("la transición falló: {e}")))?
}

fn run_ffmpeg_transition(
    ffmpeg: &std::path::Path,
    ffprobe: &std::path::Path,
    captures: &[TransitionCapture; 2],
    spec: &ObsTransitionSpec,
    audio_device: Option<&str>,
    output: &std::path::Path,
    cursor_overlay: Option<CursorOverlaySpec>,
) -> Result<ScreenRecordResult, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning")
        .arg("-y");

    // Índices de entrada: por escena, pantalla primero y webcam después;
    // el audio opcional cierra la lista.
    let mut branches = [TransitionBranch::default(), TransitionBranch::default()];
    let mut next_index = 0usize;
    for (slot, cap) in captures.iter().enumerate() {
        if let Some(screen) = cap.screen.as_ref() {
            branches[slot].screen = Some(next_index);
            for arg in gdigrab_input_args(
                &screen.target,
                screen.window_title.as_deref(),
                screen.region_x,
                screen.region_y,
                screen.region_width,
                screen.region_height,
                spec.fps,
                false,
            ) {
                command.arg(arg);
            }
            next_index += 1;
        }
        if let Some(device) = cap.webcam_device.as_deref() {
            branches[slot].webcam = Some(next_index);
            branches[slot].webcam_chroma = cap.webcam_chroma.clone();
            for arg in dshow_video_args(device) {
                command.arg(arg);
            }
            next_index += 1;
        }
    }

    // Audio opcional (dshow) como última entrada.
    let audio_index = if let Some(device) = audio_device {
        command
            .arg("-f")
            .arg("dshow")
            .arg("-audio_buffer_size")
            .arg("50")
            .arg("-i")
            .arg(format!("audio={device}"));
        Some(next_index)
    } else {
        None
    };

    let graph = spec.filtergraph(&branches[0], &branches[1])?;
    command
        .arg("-filter_complex")
        .arg(graph)
        .arg("-map")
        .arg("[v]");
    if let Some(aidx) = audio_index {
        command
            .arg("-map")
            .arg(format!("{aidx}:a"))
            .arg("-c:a")
            .arg("aac")
            .arg("-b:a")
            .arg("160k");
    } else {
        command.arg("-an");
    }
    // `-t` antes del destino acota la salida al total de la transición.
    command.arg("-t").arg(spec.total_arg());
    match h264_software_video_args(ffmpeg, 23) {
        Ok(args) => {
            for arg in args {
                command.arg(arg);
            }
        }
        Err(e) => {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                format!("no hay encoder H.264 de software: {e}").as_str(),
            ));
        }
    }
    command
        .arg("-movflags")
        .arg("+faststart")
        .arg(output.as_os_str());
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    // Tracker de cursor: arranca con el render y se cierra al terminar
    // para generar las muestras del segundo pase (ass → burn).
    let cursor_tracker = cursor_overlay
        .as_ref()
        .map(|_| CursorTracker::start());

    let mut child = command.spawn().map_err(|e| {
        io_error(&format!("no se pudo lanzar ffmpeg para la transición: {e}"))
    })?;

    // Drena stderr en un hilo (pipe de 64 KB) y junta la cola para el error.
    use std::io::Read;
    let stderr_tail = Arc::new(Mutex::new(Vec::<u8>::new()));
    if let Some(mut stderr) = child.stderr.take() {
        let tail = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut stored) = tail.lock() {
                            stored.extend_from_slice(&buf[..n]);
                            if stored.len() > 16_384 {
                                let keep_from = stored.len() - 8_192;
                                stored.drain(..keep_from);
                            }
                        }
                    }
                }
            }
        });
    }

    // Espera acotada: total + margen. Un ffmpeg colgado se mata, no bloquea.
    let deadline = Instant::now()
        + Duration::from_secs_f64(spec.total_secs().max(1.0))
        + TRANSITION_WAIT_MARGIN;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err(invalid(
                        "ffmpeg no terminó la transición dentro del tiempo esperado",
                    ));
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => {
                let _ = child.kill();
                break Err(io_error(&format!("no se pudo verificar ffmpeg: {e}")));
            }
        }
    };

    let status = status?;
    if !status.success() {
        let tail = stderr_tail
            .lock()
            .map(|bytes| {
                let text = String::from_utf8_lossy(&bytes).trim().to_owned();
                text.chars()
                    .rev()
                    .take(400)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>()
            })
            .unwrap_or_default();
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            format!("ffmpeg no pudo renderizar la transición ({status}): {tail}").as_str(),
        ));
    }

    let cursor_samples = cursor_tracker
        .map(CursorTracker::finish)
        .unwrap_or_default();

    let probe = probe_output(ffprobe, output);
    let (duration, width, height, has_audio) =
        (probe.duration, probe.width, probe.height, probe.has_audio);
    let mut bytes = std::fs::metadata(output).map(|m| m.len()).ok();

    // Cursor estilizado: mismo segundo pase que screen_record_stop — si
    // falla, el MP4 de la transición queda intacto y se avisa en warning.
    let mut cursor_burned = None;
    let mut warning = None;
    if let (Some(spec), true) = (cursor_overlay.as_ref(), bytes.unwrap_or(0) > 0) {
        match burn_cursor_overlay(
            ffmpeg,
            output,
            &cursor_samples,
            spec,
            duration,
            width,
            height,
        ) {
            Ok(true) => {
                cursor_burned = Some(true);
                bytes = std::fs::metadata(output).map(|m| m.len()).ok();
            }
            Ok(false) => cursor_burned = Some(false),
            Err(e) => {
                cursor_burned = Some(false);
                warning = Some(format!(
                    "la transición está bien pero el cursor no se pudo quemar: {e}"
                ));
            }
        }
    }

    Ok(ScreenRecordResult {
        ok: true,
        output: Some(output.to_string_lossy().into_owned()),
        bytes,
        duration_secs: duration,
        width,
        height,
        has_audio,
        cursor_burned,
        warning,
        error: None,
    })
}
