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
    let webcam = webcam_device.as_deref().map(sanitize_device).transpose()?;
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

    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg no está disponible para el preview",
        ));
    };

    let dir = state.config_dir.join("obs-previews");
    std::fs::create_dir_all(&dir)
        .map_err(|e| io_error(&format!("no se pudo crear la carpeta de previews: {e}")))?;
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
        command
            .arg("-filter_complex")
            .arg("[1:v]scale='min(320,iw)':-2[cam];[0:v][cam]overlay=W-w-24:H-h-24[v]");
    }
    let single_map = format!("{}:v", webcam_idx.or(screen_idx).unwrap_or(0));
    command
        .arg("-map")
        .arg(if pip { "[v]" } else { single_map.as_str() })
        .arg("-frames:v")
        .arg("1")
        .arg("-an")
        .arg("-update")
        .arg("1")
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
                            "-v",
                            "error",
                            "-select_streams",
                            "v:0",
                            "-show_entries",
                            "stream=width,height",
                            "-of",
                            "json",
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
