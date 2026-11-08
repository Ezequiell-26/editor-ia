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
    let graph = pip
        .then(|| "[1:v]scale='min(320,iw)':-2[cam];[0:v][cam]overlay=W-w-24:H-h-24[v]".to_owned());
    let single_map = format!("{}:v", webcam_idx.or(screen_idx).unwrap_or(0));

    let video_codec: Vec<String> = match encoder.as_str() {
        "nvenc" => vec![
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-cq",
            "23",
            "-pix_fmt",
            "yuv420p",
        ],
        "qsv" => vec![
            "-c:v",
            "h264_qsv",
            "-global_quality",
            "23",
            "-pix_fmt",
            "yuv420p",
        ],
        "amf" => vec![
            "-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "23", "-qp_p", "23",
        ],
        "mf" => vec!["-c:v", "h264_mf", "-rate_control", "quality"],
        _ => vec![
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        ],
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
        command
            .arg("-map")
            .arg(if pip { "[v]" } else { single_map });
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
