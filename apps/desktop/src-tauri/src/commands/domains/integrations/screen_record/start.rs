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
    cursor_overlay: Option<CursorOverlaySpec>,
    webcam_chroma: Option<WebcamChromaSpec>,
) -> Result<ScreenRecordStatus, ProjectError> {
    // AUD-094: la reserva del slot se toma más abajo, recién antes de
    // lanzar ffmpeg — todo lo anterior es validación pura y no toca estado.
    let dir = crate::application::fs::validate_user_write_path(&output_dir)?;
    if !dir.is_dir() {
        return Err(invalid("elegí una carpeta de destino válida"));
    }
    let fps = fps.unwrap_or(30).clamp(1, MAX_FPS);
    let screen = capture_screen.unwrap_or(true);
    let webcam = webcam_device.as_deref().map(sanitize_device).transpose()?;
    let audio = audio_device.as_deref().map(sanitize_device).transpose()?;
    let target = capture_target.unwrap_or_else(|| "desktop".to_owned());
    if !matches!(target.as_str(), "desktop" | "window" | "region") {
        return Err(invalid("captureTarget debe ser desktop, window o region"));
    }
    if !screen && webcam.is_none() {
        return Err(invalid(
            "elegí al menos una fuente de video: pantalla o webcam",
        ));
    }
    let window_title = window_title
        .as_deref()
        .map(|t| {
            let t = t.trim();
            // gdigrab parsea `-i title=...:offset_x=...` con ':' separador:
            // un título con ':' inyectaría opciones de captura extra.
            if t.is_empty()
                || t.len() > 300
                || t.contains('"')
                || t.contains(':')
                || t.contains(',')
                || t.contains(';')
            {
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
            return Err(invalid(
                "la región necesita regionWidth/regionHeight válidos",
            ));
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
            return Err(invalid(
                "streamUrl debe ser una URL rtmp:// o rtmps:// válida",
            ));
        }
    }
    // Codificador estilo OBS: auto = x264 (compatible siempre); nvenc/qsv/amf
    // usan el hardware y liberan CPU en PCs con GPU dedicada.
    let encoder = encoder.unwrap_or_else(|| "x264".to_owned());
    if !matches!(encoder.as_str(), "x264" | "nvenc" | "qsv" | "amf" | "mf") {
        return Err(invalid("encoder debe ser x264, nvenc, qsv, amf o mf"));
    }
    // Cursor estilizado: se muestrea durante la captura y se quema en un
    // segundo pase ffmpeg (ver cursor_track.rs). Sólo escritorio completo:
    // en ventana/región el origen del frame respecto al cursor no es fiable.
    if let Some(spec) = cursor_overlay.as_ref() {
        spec.validate()?;
        if !(screen && target == "desktop") {
            return Err(invalid(
                "el cursor estilizado sólo aplica a captura de escritorio completa",
            ));
        }
    }
    // Chroma key de la webcam en la misma pasada de captura (paridad
    // `gravar_webcam_chroma` de AlaukCut). Sólo tiene sentido con webcam.
    let chroma_chain = match webcam_chroma.as_ref() {
        Some(spec) => {
            spec.validate()?;
            if webcam.is_none() {
                return Err(invalid(
                    "webcamChroma requiere webcamDevice: no hay fuente que keyear",
                ));
            }
            Some(spec.ffmpeg_chain())
        }
        None => None,
    };

    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg no está disponible para grabar",
        ));
    };

    // AUD-094: reserva atómica ANTES de construir/lanzar ffmpeg. Un segundo
    // `start` concurrente ve `Starting`/`Active`/`Stopping` y se rechaza —
    // no hay ventana check-then-set donde dos procesos puedan lanzarse.
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

    // Todo el lanzamiento vive en un async block: cualquier `?`/`return
    // Err` interno devuelve `Err` acá (verificado: `return` en async block
    // sale del bloque, no de la función) y la reserva se libera a `Idle`
    // — nunca queda un slot trabado en `Starting` ni un ffmpeg huérfano.
    let outcome = (async move {
    let stamp = chrono_lite_stamp();
    // AUD-094: el timestamp tiene precisión de segundos — dos grabaciones
    // en la misma carpeta dentro del mismo segundo (o un reintento tras un
    // stop rápido) colisionaban y `-y` pisaba el MP4 anterior.
    let output = unique_screen_output(&dir, &stamp);

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
            // Con overlay de cursor el cursor del sistema no se graba: lo
            // dibuja el ASS en el postproceso.
            cursor_overlay.is_none(),
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
            .arg("-f")
            .arg("dshow")
            .arg("-audio_buffer_size")
            .arg("50")
            .arg("-i")
            .arg(format!("audio={device}"));
    }

    // Cadena de video: pantalla+webcam → PiP; una sola fuente → directo.
    // Cada salida lleva su propia copia del grafo porque -filter_complex se
    // vincula a la salida que le sigue (el encode x264 ya es por salida).
    let screen_idx = if screen { Some(0usize) } else { None };
    let webcam_idx = if screen {
        (webcam.is_some()).then_some(1usize)
    } else {
        webcam.is_some().then_some(0usize)
    };
    let pip = screen_idx.is_some() && webcam_idx.is_some();
    // `chroma_chain` ya es una lista de filtros separados por comas
    // (`chromakey=…,format=yuva420p`): se concatena directo antes del scale.
    let graph = if pip {
        let cam = match chroma_chain.as_deref() {
            Some(c) => format!("[1:v]{c},scale='min(320,iw)':-2[cam]"),
            None => "[1:v]scale='min(320,iw)':-2[cam]".to_owned(),
        };
        Some(format!("{cam};[0:v][cam]overlay=W-w-24:H-h-24[v]"))
    } else if let (Some(idx), Some(c)) = (webcam_idx, chroma_chain.as_deref()) {
        // Webcam como única fuente: el chroma sale por etiqueta [v].
        Some(format!("[{idx}:v]{c}[v]"))
    } else {
        None
    };
    let single_map = format!("{}:v", webcam_idx.or(screen_idx).unwrap_or(0));

    let to_args = |items: &[&str]| {
        items.iter().map(|s| s.to_string()).collect::<Vec<String>>()
    };
    let video_codec: Vec<String> = match encoder.as_str() {
        "nvenc" => to_args(&[
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-cq",
            "23",
            "-pix_fmt",
            "yuv420p",
        ]),
        "qsv" => to_args(&[
            "-c:v",
            "h264_qsv",
            "-global_quality",
            "23",
            "-pix_fmt",
            "yuv420p",
        ]),
        "amf" => to_args(&[
            "-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23",
        ]),
        "mf" => to_args(&["-c:v", "h264_mf", "-rate_control", "quality"]),
        // "x264" = mejor H.264 de software disponible: el bundle LGPL no
        // incluye libx264 y pedirlo fijo mataba ffmpeg tras el arranque.
        _ => h264_software_video_args(&ffmpeg, 23).map_err(|e| {
            ProjectError::message(ProjectErrorCode::ProviderUnavailable, e.as_str())
        })?,
    };

    fn push_output(
        command: &mut Command,
        graph: Option<&str>,
        map_v_label: bool,
        single_map: &str,
        audio_index: Option<usize>,
        video_codec: &[String],
        flv: bool,
        dest: &std::ffi::OsStr,
    ) {
        if let Some(g) = graph {
            command.arg("-filter_complex").arg(g);
        }
        command
            .arg("-map")
            .arg(if map_v_label { "[v]" } else { single_map });
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

    let map_v_label = graph.is_some();
    push_output(
        &mut command,
        graph.as_deref(),
        map_v_label,
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
            map_v_label,
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
            let mut tail: String = stderr
                .chars()
                .rev()
                .take(400)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            // ffmpeg eco-a la URL de salida en sus errores; la URL RTMP
            // lleva la clave del stream y no debe salir en errores/logs.
            if let Some(url) = stream_url.as_deref() {
                tail = tail.replace(url, "[stream-url-oculta]");
            }
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

    // Drain de stderr durante toda la vida del proceso: sin lector el pipe
    // se llena (~64 KB) y ffmpeg se bloquearía; la cola queda para el error
    // que `status` reporta si la grabación muere sola. AUD-098: ffmpeg
    // eco-a la URL RTMP con la stream key en stderr — la cola se redacta
    // en cada chunk para no conservar el secreto ni siquiera en memoria.
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

    // Tracker de cursor: arranca recién cuando ffmpeg ya demostró estar vivo,
    // así no hay muestras de una grabación que murió al iniciar.
    let cursor_tracker = if cursor_overlay.is_some() {
        Some(CursorTracker::start())
    } else {
        None
    };

    Ok(Recording {
        child: spawned,
        stdin,
        output,
        started: Instant::now(),
        webcam,
        streaming: stream_url.is_some(),
        cursor_tracker,
        cursor_spec: cursor_overlay,
        stderr_tail,
        stream_url,
    })
    })
    .await;

    match outcome {
        Ok(recording) => {
            *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = RecordState::Active(recording);
            Ok(status_inner())
        }
        Err(error) => {
            // Fallo de validación tardía, spawn o verificación de arranque:
            // el slot vuelve a Idle y cualquier Child ya fue matado en su
            // rama de error — no queda grabación fantasma.
            *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = RecordState::Idle;
            Err(error)
        }
    }
}

/// Medición real del MP4 generado con ffprobe (duración, resolución, audio).
fn probe_output(
    ffprobe: &std::path::Path,
    output: &std::path::Path,
) -> (Option<f64>, Option<u32>, Option<u32>, Option<bool>) {
    let probed = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height",
            "-of",
            "json",
            &output.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let Ok(out) = probed else {
        return (None, None, None, None);
    };
    if !out.status.success() {
        return (None, None, None, None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return (None, None, None, None),
    };
    let duration = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok());
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
