// Switching OBS en vivo: sesión de segmentos + cosido con transiciones.
//
// A diferencia de `run_obs_transition` (render finito de una vez), acá la
// sesión queda ABIERTA: la escena activa se graba en un segmento MP4; cada
// `obs_switch_scene` cierra el segmento actual con `q` (cierre ordenado,
// MP4 válido) y abre otro con la escena nueva. `obs_switch_stop` cierra el
// último segmento y re-codifica todos en UN MP4 con `xfade`/`acrossfade`
// en cada unión (ver `application::obs_switch`).
//
// Estado: `SWITCH_SESSION` guarda la metadata de la sesión; el proceso
// ffmpeg vivo del segmento actual vive en `RECORDING::Active` como una
// grabación normal — así `screen_record_status` reporta la captura en
// curso y cualquier `start`/`transition` concurrente se rechaza por el
// slot. Entre segmentos (cerrando/abriendo) el slot queda `Stopping`, que
// también bloquea — nunca hay dos capturas a la vez.
//
// Alcance honesto v1: la conmutación es por comando (IA/usuario), no hay
// mixer preview en vivo, el cursor estilizado no aplica (se graba el
// cursor del sistema) y los segmentos re-negocian su salida RTMP por
// escena cuando `streamUrl` está definido (conexión persistente sin
// renegociar queda pendiente — exige un mixer propio).

use std::path::Path;

use crate::application::obs_switch::{self, ObsSwitchSpec};

/// Metadata de un segmento ya cerrado (archivo + escena que lo generó).
#[derive(Debug, Clone)]
struct SwitchSegmentRec {
    scene_id: String,
    path: PathBuf,
    duration_secs: Option<f64>,
    has_audio: bool,
    /// Canales de la pista de audio medidos por ffprobe (`None` = sin dato).
    channels: Option<u32>,
}

/// Sesión de switching abierta: spec de cosido + segmentos cerrados +
/// escena/path del segmento en curso (espejo de `RECORDING::Active`).
#[derive(Debug)]
struct ObsSwitchSession {
    dir: PathBuf,
    stamp: String,
    spec: ObsSwitchSpec,
    segments: Vec<SwitchSegmentRec>,
    /// `None` mientras se cierra un segmento y antes de abrir el siguiente.
    current_scene: Option<String>,
    /// `audioDevice` explícito de `obs_switch_start`: si existe gana sobre
    /// el `audioDevice` de cada escena en TODOS los segmentos.
    audio_override: Option<String>,
    /// Avisos no fatales de la sesión (p.ej. cursor que no se pudo quemar
    /// en un segmento) — se reportan en status y en el resultado final.
    warnings: Vec<String>,
    /// URL RTMP completa de la sesión (si hay streaming): vive sólo en
    /// memoria, nunca se serializa ni se persiste; el stderr de ffmpeg se
    /// redacta con ella (AUD-098).
    stream_url: Option<String>,
    /// Encoder H.264 de los segmentos y del cosido final ("x264"|"nvenc"|
    /// "qsv"|"amf"|"mf") — el mismo set que `screen_record_start`.
    encoder: String,
    started: Instant,
}

static SWITCH_SESSION: Mutex<Option<ObsSwitchSession>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsSwitchStatus {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<String>,
    /// Escenas de los segmentos ya cerrados, en orden (el actual no entra).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub segment_scenes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    pub segments: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn switch_lock() -> std::sync::MutexGuard<'static, Option<ObsSwitchSession>> {
    SWITCH_SESSION.lock().unwrap_or_else(|e| e.into_inner())
}

fn switch_status_inner() -> ObsSwitchStatus {
    let guard = switch_lock();
    match guard.as_ref() {
        None => ObsSwitchStatus {
            active: false,
            scene_id: None,
            segment_scenes: Vec::new(),
            warnings: Vec::new(),
            segments: 0,
            elapsed_secs: None,
            output_dir: None,
            error: None,
        },
        Some(s) => ObsSwitchStatus {
            active: true,
            scene_id: s.current_scene.clone(),
            segment_scenes: s.segments.iter().map(|g| g.scene_id.clone()).collect(),
            warnings: s.warnings.clone(),
            segments: s.segments.len(),
            elapsed_secs: Some(s.started.elapsed().as_secs()),
            output_dir: Some(s.dir.to_string_lossy().into_owned()),
            error: None,
        },
    }
}

/// `true` si hay una sesión de switching abierta (con o sin segmento vivo).
pub(crate) fn switch_session_active() -> bool {
    switch_lock().is_some()
}

/// Nombre único del segmento N de la sesión.
fn segment_output(dir: &Path, stamp: &str, index: usize) -> PathBuf {
    let base = format!("switch-{stamp}-seg{index:02}");
    let mut output = dir.join(format!("{base}.mp4"));
    let mut suffix = 2u32;
    while output.exists() {
        output = dir.join(format!("{base}-{suffix}.mp4"));
        suffix += 1;
    }
    output
}

/// Lanza ffmpeg grabando UN segmento de la sesión: mismas fuentes que una
/// escena (pantalla gdigrab y/o webcam dshow en PiP con chroma) con salida
/// a archivo fijo y, si la sesión tiene `stream_url`, una segunda salida
/// RTMP en el mismo proceso (estilo OBS: el directo y la grabación son el
/// mismo programa). En cada cambio de escena el nuevo segmento renegocia
/// la conexión — gap breve documentado. Devuelve un `Recording` normal
/// que se guarda en `RECORDING::Active`.
#[allow(clippy::too_many_arguments)]
fn launch_segment(
    ffmpeg: &Path,
    capture: &TransitionCapture,
    fps: u32,
    audio_device: Option<&str>,
    cursor_overlay: Option<CursorOverlaySpec>,
    stream_url: Option<String>,
    encoder: &str,
    output: &Path,
) -> Result<Recording, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning")
        .arg("-y");

    let mut next_index = 0usize;
    let screen_idx = capture.screen.as_ref().map(|screen| {
        let idx = next_index;
        for arg in gdigrab_input_args(
            &screen.target,
            screen.window_title.as_deref(),
            screen.region_x,
            screen.region_y,
            screen.region_width,
            screen.region_height,
            fps,
            // Con cursor overlay el cursor del sistema no se graba: lo
            // dibuja el ASS en el segundo pase al cerrar el segmento.
            cursor_overlay.is_none(),
        ) {
            command.arg(arg);
        }
        next_index += 1;
        idx
    });
    let webcam_idx = capture.webcam_device.as_deref().map(|device| {
        let idx = next_index;
        for arg in dshow_video_args(device) {
            command.arg(arg);
        }
        next_index += 1;
        idx
    });
    let audio_idx = audio_device.map(|device| {
        let idx = next_index;
        command
            .arg("-f")
            .arg("dshow")
            .arg("-audio_buffer_size")
            .arg("50")
            .arg("-i")
            .arg(format!("audio={device}"));
        next_index += 1;
        idx
    });

    // Grafo de composición: idéntico al de `screen_record_start` (PiP
    // abajo-derecha, chroma sobre la webcam). La normalización al canvas
    // común NO va acá: cada segmento conserva su resolución nativa y el
    // cosido la iguala (así escenas con targets distintos conviven).
    let graph = match (screen_idx, webcam_idx) {
        (Some(s), Some(c)) => {
            let cam = match capture.webcam_chroma.as_deref() {
                Some(chain) => format!("[{c}:v]{chain},scale='min(320,iw)':-2[cam]"),
                None => format!("[{c}:v]scale='min(320,iw)':-2[cam]"),
            };
            let _ = s;
            Some(format!("{cam};[0:v][cam]overlay=W-w-24:H-h-24[v]"))
        }
        (None, Some(c)) => capture
            .webcam_chroma
            .as_deref()
            .map(|chain| format!("[{c}:v]{chain}[v]")),
        _ => None,
    };
    let video_map = screen_idx
        .or(webcam_idx)
        .map(|i| format!("{i}:v"))
        .unwrap_or_else(|| "0:v".to_owned());

    if let Some(g) = graph.as_deref() {
        command.arg("-filter_complex").arg(g);
        command.arg("-map").arg("[v]");
    } else {
        command.arg("-map").arg(&video_map);
    }
    if let Some(aidx) = audio_idx {
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
    let video_args = h264_encoder_video_args(ffmpeg, encoder, 23).map_err(|e| {
        ProjectError::message(ProjectErrorCode::ProviderUnavailable, e.as_str())
    })?;
    for arg in &video_args {
        command.arg(arg);
    }
    command
        .arg("-movflags")
        .arg("+faststart")
        .arg(output.as_os_str());

    // Segunda salida: el mismo programa (mismas entradas y filtergraph)
    // hacia el servidor RTMP en FLV. La URL lleva la stream key — nunca
    // se loguea y el stderr se redacta con ella (AUD-098).
    if let Some(url) = stream_url.as_deref() {
        command.arg("-map").arg(if graph.is_some() {
            "[v]"
        } else {
            video_map.as_str()
        });
        if let Some(aidx) = audio_idx {
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
        for arg in &video_args {
            command.arg(arg);
        }
        command.arg("-f").arg("flv").arg(url);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut spawned = command.spawn().map_err(|e| {
        io_error(&format!("no se pudo lanzar ffmpeg para el segmento: {e}"))
    })?;
    let Some(stdin) = spawned.stdin.take() else {
        let _ = spawned.kill();
        return Err(io_error("ffmpeg no aceptó stdin para cerrar el segmento"));
    };

    // Verificación de arranque igual que screen_record_start: un dispositivo
    // dshow inexistente o gdigrab bloqueado mueren en los primeros segundos.
    std::thread::sleep(Duration::from_millis(1200));
    match spawned.try_wait() {
        Ok(Some(status)) => {
            let _ = spawned.kill();
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                format!("ffmpeg no pudo iniciar el segmento ({status})").as_str(),
            ));
        }
        Ok(None) => {}
        Err(error) => {
            let _ = spawned.kill();
            return Err(io_error(&format!("no se pudo verificar ffmpeg: {error}")));
        }
    }

    // Drain de stderr durante toda la vida del segmento (pipe de 64 KB).
    // Con streaming, ffmpeg eco-a la URL con la clave: la cola se redacta
    // por chunk con los mismos helpers de screen_record_start (AUD-098).
    let stderr_tail = Arc::new(Mutex::new(Vec::<u8>::new()));
    if let Some(mut stderr) = spawned.stderr.take() {
        let tail = Arc::clone(&stderr_tail);
        let secrets = stream_secret_bytes(stream_url.as_deref());
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = [0u8; 8192];
            loop {
                match stderr.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut stored) = tail.lock() {
                            stored.extend_from_slice(&buf[..n]);
                            for secret in &secrets {
                                redact_secret_bytes(
                                    &mut stored,
                                    secret,
                                    STREAM_URL_REDACTED.as_bytes(),
                                );
                            }
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

    // Tracker de cursor: arranca sólo si el segmento trae overlay.
    let cursor_tracker = cursor_overlay
        .as_ref()
        .map(|_| CursorTracker::start());

    Ok(Recording {
        child: spawned,
        stdin,
        output: output.to_path_buf(),
        started: Instant::now(),
        webcam: capture.webcam_device.clone(),
        streaming: stream_url.is_some(),
        cursor_tracker,
        cursor_spec: cursor_overlay,
        stderr_tail,
        stream_url,
    })
}

/// Resultado del cierre de un segmento: muestras de cursor y spec del
/// overlay (si la escena las traía) para el segundo pase de quemado.
struct ClosedSegment {
    cursor_samples: Vec<CursorSample>,
    cursor_spec: Option<CursorOverlaySpec>,
}

/// Cierre ordenado de un segmento: `q` por stdin + espera acotada con kill
/// de respaldo (mismo contrato que `screen_record_stop`). Devuelve las
/// muestras de cursor para quemarlas antes de registrar el segmento.
fn close_segment_blocking(mut rec: Recording) -> Result<ClosedSegment, ProjectError> {
    use std::io::Write;
    let _ = rec.stdin.write_all(b"q\n");
    let _ = rec.stdin.flush();
    let cursor_spec = rec.cursor_spec.clone();
    let deadline = Instant::now() + STOP_TIMEOUT;
    loop {
        match rec.child.try_wait() {
            Ok(Some(_)) => {
                let cursor_samples = rec
                    .cursor_tracker
                    .take()
                    .map(CursorTracker::finish)
                    .unwrap_or_default();
                return Ok(ClosedSegment {
                    cursor_samples,
                    cursor_spec,
                });
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = rec.child.kill();
                let _ = rec.child.wait();
                return Err(invalid("ffmpeg no cerró el segmento a tiempo"));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => {
                let _ = rec.child.kill();
                let deadline = Instant::now() + Duration::from_secs(2);
                while let Ok(None) = rec.child.try_wait() {
                    if Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                return Err(io_error(&format!("no se pudo verificar ffmpeg: {error}")));
            }
        }
    }
}

/// Cierra el segmento vivo (si lo hay), lo mide con ffprobe y lo registra
/// en la sesión. Los locks se toman por tramos cortos — nunca un guard
/// cruzando un `await` (el future de un comando Tauri debe ser `Send`).
/// Devuelve `true` si se cerró un segmento.
async fn close_current_segment(state: &AppState) -> Result<bool, ProjectError> {
    // 1) Scene_id del segmento vivo + el Recording del slot (locks breves).
    let (scene_id, rec) = {
        let scene_id = switch_lock()
            .as_ref()
            .and_then(|s| s.current_scene.clone());
        let rec = take_active_for_stop();
        match rec {
            Some(rec) => (scene_id.unwrap_or_default(), rec),
            None => {
                if scene_id.is_none() {
                    return Ok(false);
                }
                // Había escena marcada pero el slot no tenía proceso
                // (estado inconsistente): limpiar la marca y seguir.
                if let Some(s) = switch_lock().as_mut() {
                    s.current_scene = None;
                }
                return Ok(false);
            }
        }
    };
    let path = rec.output.clone();
    let (ffmpeg, ffprobe) = {
        let settings = state.settings_snapshot()?;
        let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
        (ffmpeg, ffprobe)
    };
    // 2) Cierre + espera fuera de todo lock.
    let closed = tauri::async_runtime::spawn_blocking(move || close_segment_blocking(rec))
        .await
        .map_err(|e| io_error(&format!("no se pudo cerrar el segmento: {e}")))??;
    // 3) Medir y registrar (lock breve).
    let probe = match ffprobe.as_ref() {
        Some(p) => {
            let ffprobe_path = p.clone();
            let probe_path = path.clone();
            tauri::async_runtime::spawn_blocking(move || {
                probe_output(&ffprobe_path, &probe_path)
            })
            .await
            .unwrap_or_default()
        }
        None => ProbeOutput::default(),
    };
    let (duration, width, height, has_audio, channels) = (
        probe.duration,
        probe.width,
        probe.height,
        probe.has_audio,
        probe.channels,
    );

    // Cursor estilizado: mismo segundo pase ASS que screen_record_stop,
    // por segmento — si falla, el MP4 queda intacto y se avisa en warnings.
    let mut warning = None;
    if let (Some(spec), Some(ff)) = (closed.cursor_spec.as_ref(), ffmpeg.as_ref()) {
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if bytes > 0 && !closed.cursor_samples.is_empty() {
            let ffmpeg = ff.clone();
            let segment_path = path.clone();
            let samples = closed.cursor_samples.clone();
            let spec = spec.clone();
            let burned = tauri::async_runtime::spawn_blocking(move || {
                burn_cursor_overlay(
                    &ffmpeg,
                    &segment_path,
                    &samples,
                    &spec,
                    duration,
                    width,
                    height,
                )
            })
            .await;
            match burned {
                Ok(Ok(_)) => {}
                Ok(Err(e)) => {
                    warning = Some(format!(
                        "el cursor no se pudo quemar en el segmento de la escena {scene_id}: {e}"
                    ));
                }
                Err(e) => {
                    warning = Some(format!(
                        "el cursor no se pudo quemar en el segmento de la escena {scene_id}: {e}"
                    ));
                }
            }
        }
    }

    if let Some(s) = switch_lock().as_mut() {
        s.segments.push(SwitchSegmentRec {
            scene_id,
            path,
            duration_secs: duration,
            has_audio: has_audio.unwrap_or(false),
            channels,
        });
        if let Some(w) = warning {
            s.warnings.push(w);
        }
        s.current_scene = None;
    }
    Ok(true)
}

/// Abre la sesión: valida que no haya otra, reserva el slot de grabación
/// y lanza el primer segmento con la escena indicada.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn obs_switch_begin(
    state: &AppState,
    capture: &TransitionCapture,
    scene_id: &str,
    spec: &ObsSwitchSpec,
    audio_device: Option<String>,
    audio_override: Option<String>,
    cursor_overlay: Option<CursorOverlaySpec>,
    stream_url: Option<String>,
    encoder: String,
    dir: &Path,
) -> Result<ObsSwitchStatus, ProjectError> {
    if switch_session_active() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            "ya hay una sesión de switching OBS activa",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg/ffprobe no están disponibles para el switching",
        ));
    };

    // Reserva del slot antes de lanzar (mismo contrato que start/transition).
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

    let stamp = chrono_lite_stamp();
    let audio = audio_device
        .as_deref()
        .map(sanitize_device)
        .transpose()?;
    let ffmpeg_path = ffmpeg.clone();
    let output = segment_output(dir, &stamp, 0);
    let capture = capture.clone();
    let fps = spec.fps;
    let stream = stream_url.clone();
    let encoder_launch = encoder.clone();

    let launch = tauri::async_runtime::spawn_blocking(move || {
        launch_segment(
            &ffmpeg_path,
            &capture,
            fps,
            audio.as_deref(),
            cursor_overlay,
            stream,
            &encoder_launch,
            &output,
        )
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo lanzar el segmento: {e}")))?;

    match launch {
        Ok(recording) => {
            *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = RecordState::Active(recording);
            *switch_lock() = Some(ObsSwitchSession {
                dir: dir.to_path_buf(),
                stamp,
                spec: spec.clone(),
                segments: Vec::new(),
                current_scene: Some(scene_id.to_owned()),
                audio_override,
                warnings: Vec::new(),
                stream_url,
                encoder,
                started: Instant::now(),
            });
            Ok(switch_status_inner())
        }
        Err(error) => {
            *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = RecordState::Idle;
            Err(error)
        }
    }
}

/// Cambia la escena activa: cierra el segmento actual, lo mide y abre el
/// siguiente con la nueva escena. `audio_device` es el audio de ESTE
/// segmento (el comando resuelve sesión→escena); si difiere entre
/// segmentos el cosido rellena los silenciosos con `anullsrc`.
/// Si el lanzamiento del nuevo segmento falla, la sesión queda abierta
/// sin escena activa — se puede reintentar el cambio o detener la sesión
/// (los segmentos cerrados se cosen igual).
pub(crate) async fn obs_switch_to_scene(
    state: &AppState,
    capture: &TransitionCapture,
    scene_id: &str,
    audio_device: Option<String>,
    cursor_overlay: Option<CursorOverlaySpec>,
) -> Result<ObsSwitchStatus, ProjectError> {
    {
        let guard = switch_lock();
        if guard.is_none() {
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                "no hay una sesión de switching OBS activa",
            ));
        }
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg no está disponible para el switching",
        ));
    };

    // Cerrar el segmento vivo (si lo hay) y registrarlo. El slot queda
    // `Stopping` entre el cierre y la apertura — nunca Idle con sesión viva.
    if !switch_session_active() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            "no hay una sesión de switching OBS activa",
        ));
    }
    close_current_segment(state).await?;

    // Lanzar el nuevo segmento con la escena destino.
    let (index, fps, dir, stamp, audio_override, stream, encoder) = {
        let guard = switch_lock();
        let session = guard.as_ref().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                "la sesión de switching se cerró durante el cambio",
            )
        })?;
        (
            session.segments.len(),
            session.spec.fps,
            session.dir.clone(),
            session.stamp.clone(),
            session.audio_override.clone(),
            session.stream_url.clone(),
            session.encoder.clone(),
        )
    };
    let output = segment_output(&dir, &stamp, index);
    let ffmpeg_path = ffmpeg.clone();
    let capture = capture.clone();
    // El override de sesión gana; si no, el audioDevice de la escena.
    let audio = audio_override
        .or(audio_device)
        .as_deref()
        .map(sanitize_device)
        .transpose()?;

    let launch = tauri::async_runtime::spawn_blocking(move || {
        launch_segment(
            &ffmpeg_path,
            &capture,
            fps,
            audio.as_deref(),
            cursor_overlay,
            stream,
            &encoder,
            &output,
        )
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo lanzar el segmento: {e}")))?;

    match launch {
        Ok(recording) => {
            *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = RecordState::Active(recording);
            if let Some(session) = switch_lock().as_mut() {
                session.current_scene = Some(scene_id.to_owned());
            }
            Ok(switch_status_inner())
        }
        Err(error) => {
            // El slot sigue en `Stopping` (bloquea starts ajenos) y la
            // sesión sigue abierta sin escena activa: `obs_switch_stop`
            // coserá lo cerrado y `obs_switch_scene` puede reintentarse.
            Err(error)
        }
    }
}

/// Detiene la sesión: cierra el último segmento, coser todos con
/// transiciones y devuelve la medición del MP4 final. Los segmentos
/// intermedios quedan en `output_dir` (nunca se borran sin pedido).
pub(crate) async fn obs_switch_finish(
    state: &AppState,
) -> Result<ScreenRecordResult, ProjectError> {
    // Cerrar el segmento vivo primero (si lo hay) — locks breves, nada
    // de guards cruzando el await.
    if !switch_session_active() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            "no hay una sesión de switching OBS activa",
        ));
    }
    close_current_segment(state).await?;

    // Sacar la sesión completa: a partir de acá es un render de archivos,
    // no una captura — el slot queda `Stopping` hasta terminar el cosido.
    let (session, stamp) = {
        let mut guard = switch_lock();
        match guard.take() {
            Some(s) => {
                let stamp = s.stamp.clone();
                (s, stamp)
            }
            None => {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderRejected,
                    "no hay una sesión de switching OBS activa",
                ))
            }
        }
    };
    // Asegurar que el slot no quede Idle mientras se coser (bloquea starts).
    {
        let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(*guard, RecordState::Idle) {
            *guard = RecordState::Stopping;
        }
    }
    let _release = RecordingStopGuard;

    let session_warnings = session.warnings.clone();
    let segments = session.segments;
    if segments.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la sesión no produjo ningún segmento",
        ));
    }

    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg/ffprobe no están disponibles para coser la sesión",
        ));
    };

    // Caso de un solo segmento: no hay nada que coser — se renombra al
    // nombre final de sesión y se reporta como resultado.
    if segments.len() == 1 {
        let seg = &segments[0];
        let final_path = session.dir.join(format!("switch-{stamp}.mp4"));
        if seg.path != final_path {
            std::fs::rename(&seg.path, &final_path).map_err(|e| {
                io_error(&format!("no se pudo renombrar el segmento final: {e}"))
            })?;
        }
        let probe = {
            let ffprobe_path = ffprobe.clone();
            let probe_path = final_path.clone();
            tauri::async_runtime::spawn_blocking(move || {
                probe_output(&ffprobe_path, &probe_path)
            })
            .await
            .unwrap_or_default()
        };
        let (duration, width, height, has_audio) =
            (probe.duration, probe.width, probe.height, probe.has_audio);
        return Ok(ScreenRecordResult {
            ok: true,
            output: Some(final_path.to_string_lossy().into_owned()),
            bytes: std::fs::metadata(&final_path).map(|m| m.len()).ok(),
            duration_secs: duration,
            width,
            height,
            has_audio,
            cursor_burned: None,
            warning: merged_warnings(
                &session_warnings,
                Some(format!(
                    "la sesión tuvo un solo segmento (sin cambios de escena); no hubo transiciones que coser. Segmento original renombrado a {}",
                    final_path.file_name().unwrap_or_default().to_string_lossy()
                )),
            ),
            error: None,
        });
    }

    // Plan de cosido: duraciones y flags de audio medidos por segmento.
    let durations: Vec<f64> = segments
        .iter()
        .map(|s| s.duration_secs.unwrap_or(0.0))
        .collect();
    let has_audio: Vec<bool> = segments.iter().map(|s| s.has_audio).collect();
    let channels: Vec<Option<u32>> = segments.iter().map(|s| s.channels).collect();
    obs_switch::validate_stitch_plan(&durations, &has_audio, &session.spec)?;
    let graph = obs_switch::stitch_filtergraph(&durations, &has_audio, &channels, &session.spec)?;

    let mut output = session.dir.join(format!("switch-{stamp}.mp4"));
    let mut suffix = 2u32;
    while output.exists() {
        output = session
            .dir
            .join(format!("switch-{stamp}-{suffix}.mp4"));
        suffix += 1;
    }

    let ffmpeg_path = ffmpeg.clone();
    let ffprobe_path = ffprobe.clone();
    let output_path = output.clone();
    let spec = session.spec.clone();
    let stitch_encoder = session.encoder.clone();
    let any_audio = has_audio.iter().any(|a| *a);
    let stitch_warning = merged_warnings(
        &session_warnings,
        Some(format!(
            "sesión de {} segmentos cosida con transiciones de {}s; los segmentos intermedios quedaron en la carpeta",
            segments.len(),
            spec.transition_secs
        )),
    );

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&ffmpeg_path);
        command
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("warning")
            .arg("-y");
        for seg in &segments {
            command.arg("-i").arg(seg.path.as_os_str());
        }
        command.arg("-filter_complex").arg(&graph);
        command.arg("-map").arg("[v]");
        if any_audio {
            command
                .arg("-map")
                .arg("[a]")
                .arg("-c:a")
                .arg("aac")
                .arg("-b:a")
                .arg("160k");
        } else {
            command.arg("-an");
        }
        let video_args = h264_encoder_video_args(&ffmpeg_path, &stitch_encoder, 23).map_err(|e| {
            ProjectError::message(ProjectErrorCode::ProviderUnavailable, e.as_str())
        })?;
        for arg in &video_args {
            command.arg(arg);
        }
        command
            .arg("-movflags")
            .arg("+faststart")
            .arg(output_path.as_os_str());
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_console(&mut command);

        let mut child = command.spawn().map_err(|e| {
            io_error(&format!("no se pudo lanzar ffmpeg para el cosido: {e}"))
        })?;
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
        // Espera acotada: el cosido re-codifica con xfade — en la práctica
        // varios x realtime. Antes el deadline era total/2 con techo de
        // 1 h: una sesión de ~3 h garantizaba un falso timeout. Ahora
        // escala con la duración total (peor caso ~1x + 5 min de margen,
        // techo 4 h — para el máximo de 6 h sigue asumiendo >1.4x, holgado
        // para x264); un ffmpeg realmente colgado igual se mata, sólo que
        // más tarde.
        let total = obs_switch::stitched_total_secs(&durations, spec.transition_secs);
        let deadline = Instant::now()
            + Duration::from_secs_f64(total.clamp(300.0, 14_400.0))
            + Duration::from_secs(300);
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        break Err(invalid(
                            "ffmpeg no terminó el cosido dentro del tiempo esperado",
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
        let exit = status?;
        if !exit.success() || !output_path.exists() {
            let detail = stderr_tail
                .lock()
                .map(|tail| String::from_utf8_lossy(&tail).trim().to_owned())
                .unwrap_or_default();
            let detail = if detail.is_empty() {
                format!("código de salida {exit}")
            } else {
                detail
            };
            return Err(ProjectError::message(
                ProjectErrorCode::ProviderRejected,
                format!("ffmpeg no pudo coser la sesión: {detail}").as_str(),
            ));
        }
        let probe = probe_output(&ffprobe_path, &output_path);
        let (duration, width, height, has_audio) =
            (probe.duration, probe.width, probe.height, probe.has_audio);
        Ok::<_, ProjectError>(ScreenRecordResult {
            ok: true,
            output: Some(output_path.to_string_lossy().into_owned()),
            bytes: std::fs::metadata(&output_path).map(|m| m.len()).ok(),
            duration_secs: duration,
            width,
            height,
            has_audio,
            cursor_burned: None,
            warning: stitch_warning,
            error: None,
        })
    })
    .await
    .map_err(|e| io_error(&format!("el cosido falló: {e}")))??;

    Ok(result)
}

/// Combina los warnings acumulados de la sesión con el aviso base del
/// resultado final (un solo string separado por "; ").
fn merged_warnings(warnings: &[String], base: Option<String>) -> Option<String> {
    let mut parts: Vec<String> = warnings.to_vec();
    if let Some(b) = base {
        parts.push(b);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

/// Estado de la sesión para IPC/MCP (el comando Tauri vive en
/// `obs_scenes::obs_switch_status`, que delega acá).
pub(crate) fn obs_switch_status() -> ObsSwitchStatus {
    switch_status_inner()
}

/// Escena activa de la sesión de switching (`None` si no hay sesión o si
/// está entre segmentos). La usa `obs_switch_preview` para componer el
/// frame del programa en vivo.
pub(crate) fn obs_switch_current_scene_id() -> Option<String> {
    switch_lock()
        .as_ref()
        .and_then(|s| s.current_scene.clone())
}
