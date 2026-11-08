/// Tope de entrada por memoria y tiempo: cada frame se procesa por teselas
/// 128×128 en CPU, así que un clip 720p de ~50 s ya son ~40-90 minutos.
const MAX_VIDEO_PIXELS: u64 = 1280 * 720;
const MAX_VIDEO_FRAMES: u64 = 1_800;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpscaleVideoResult {
    pub path: String,
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub frames: u64,
    pub fps_num: u32,
    pub fps_den: u32,
}

/// Agranda un video ×4 con Real-ESRGAN local, frame por frame.
///
/// Decodifica con FFmpeg a RGB crudo, pasa cada frame por el mismo motor
/// por teselas del upscale de imagen y codifica a H.264 con el audio
/// original. Es un proceso pesado (minutos por segundo de video): la UI lo
/// corre con progreso y la función emite `upscale-progress` con `percent`.
#[tauri::command]
pub async fn upscale_video(
    app: AppHandle,
    state: State<'_, AppState>,
    input_path: String,
    output_path: Option<String>,
    max_seconds: Option<f64>,
) -> Result<UpscaleVideoResult, ProjectError> {
    let spec = model_by_id("real-esrgan-x4plus").ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "el modelo de upscale no existe")
    })?;
    if !is_model_downloaded(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "falta descargar el modelo de upscale (Ajustes → Capacidades)",
        ));
    }
    let model_path = model_dir(&state, spec).join(spec.files[0].file_name);
    let input = PathBuf::from(input_path.trim());
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video a agrandar no está en disco",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffmpeg = ffmpeg.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para leer y escribir el video",
        )
    })?;
    let ffprobe = ffprobe.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe es necesario para medir el video",
        )
    })?;
    let max_seconds = max_seconds
        .map(|value| value.clamp(0.5, 3600.0))
        .filter(|value| value.is_finite());

    let measure = probe_file(&ffprobe, &input, MediaKind::Video)?;
    let (width, height) = (measure.width.unwrap_or(0), measure.height.unwrap_or(0));
    if width == 0 || height == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "ffprobe no pudo medir la resolución del video",
        ));
    }
    if width as u64 * height as u64 > MAX_VIDEO_PIXELS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!(
                "por memoria y tiempo, el upscale local de video acepta hasta {}×{} ({:.1} MP); este video mide {}×{}",
                1280,
                720,
                MAX_VIDEO_PIXELS as f64 / 1_000_000.0,
                width,
                height
            )
            .as_str(),
        ));
    }
    let fps_num = measure.frame_rate_num.unwrap_or(30).max(1);
    let fps_den = measure.frame_rate_den.unwrap_or(1).max(1);
    let duration = measure.duration_seconds.unwrap_or(0.0);
    let estimated_frames = if duration > 0.0 {
        let capped = max_seconds.map_or(duration, |cap| duration.min(cap));
        (capped * fps_num as f64 / fps_den as f64).ceil() as u64
    } else {
        MAX_VIDEO_FRAMES
    };
    if estimated_frames > MAX_VIDEO_FRAMES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!(
                "el video estima ~{estimated_frames} frames (tope {MAX_VIDEO_FRAMES}); recortalo o usá «máx. segundos»"
            )
            .as_str(),
        ));
    }

    let output = match output_path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path.trim()),
        _ => {
            let stem = input
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_else(|| "video".to_owned());
            let mut candidate = input.with_file_name(format!("{stem}-x4.mp4"));
            let mut counter = 2u32;
            while candidate.exists() {
                candidate = input.with_file_name(format!("{stem}-x4-{counter}.mp4"));
                counter += 1;
            }
            candidate
        }
    };

    let result = tauri::async_runtime::spawn_blocking(move || {
        upscale_video_blocking(
            &app,
            &input,
            &output,
            &model_path,
            &ffmpeg,
            width,
            height,
            fps_num,
            fps_den,
            max_seconds,
            estimated_frames,
        )
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el upscale de video se cortó: {error}").as_str(),
        )
    })??;
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn upscale_video_blocking(
    app: &AppHandle,
    input: &Path,
    output: &Path,
    model_path: &Path,
    ffmpeg: &Path,
    width: u32,
    height: u32,
    fps_num: u32,
    fps_den: u32,
    max_seconds: Option<f64>,
    estimated_frames: u64,
) -> Result<UpscaleVideoResult, ProjectError> {
    let mut session = open_esrgan_session(model_path)?;

    // Decoder: la fuente entera (o el tope de segundos) a RGB crudo.
    let mut decoder = Command::new(ffmpeg);
    decoder.args(["-hide_banner", "-v", "error"]);
    if let Some(cap) = max_seconds {
        decoder.args(["-t", &format!("{cap:.3}")]);
    }
    decoder
        .args(["-i"])
        .arg(input)
        .args([
            "-vf",
            &format!("fps={fps_num}/{fps_den}"),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut decoder);
    let mut decoder_child = decoder.spawn().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para leer el video: {error}").as_str(),
        )
    })?;
    let mut stdout = decoder_child.stdout.take().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no expuso los frames del video",
        )
    })?;
    let decoder_log = decoder_child.stderr.take().map(drain_stderr);

    // Encoder: frames RGBA ya ampliados → H.264 + audio original.
    let out_width = width * SCALE;
    let out_height = height * SCALE;
    let mut encoder = Command::new(ffmpeg);
    encoder
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "-s",
            &format!("{out_width}x{out_height}"),
            "-r",
            &format!("{fps_num}/{fps_den}"),
            "-i",
            "pipe:0",
            "-i",
        ])
        .arg(input)
        .args([
            "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "libx264", "-preset", "medium", "-crf",
            "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        ]);
    if let Some(cap) = max_seconds {
        encoder.arg("-t").arg(format!("{cap:.3}"));
    }
    encoder
        .args(["-shortest", "-movflags", "+faststart", "-y"])
        .arg(output);
    hide_console(&mut encoder);
    let mut encoder_child = encoder.spawn().map_err(|error| {
        let _ = decoder_child.kill();
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar el codificador del upscale: {error}").as_str(),
        )
    })?;
    let mut stdin = encoder_child.stdin.take().ok_or_else(|| {
        let _ = decoder_child.kill();
        ProjectError::message(
            ProjectErrorCode::Io,
            "el codificador no aceptó el flujo de frames",
        )
    })?;
    let encoder_log = encoder_child.stderr.take().map(drain_stderr);

    let frame_bytes = width as usize * height as usize * 3;
    let mut rgb = vec![0u8; frame_bytes];
    let mut written = 0u64;
    let progress_every = (estimated_frames / 100).max(1);
    let mut failure: Option<ProjectError> = None;

    loop {
        match read_full_frame(&mut stdout, &mut rgb) {
            Ok(true) => {}
            Ok(false) => break,
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
        let Some(frame) = image::RgbImage::from_raw(width, height, rgb.clone()) else {
            failure = Some(ProjectError::message(
                ProjectErrorCode::Io,
                "el frame decodificado no coincide con el tamaño esperado",
            ));
            break;
        };
        match upscale_frame_tiled(&mut session, &frame) {
            Ok(upscaled) => {
                if stdin.write_all(upscaled.as_raw()).is_err() {
                    failure = Some(ProjectError::message(
                        ProjectErrorCode::Io,
                        "el codificador cerró el flujo antes de terminar el upscale",
                    ));
                    break;
                }
            }
            Err(error) => {
                failure = Some(error);
                break;
            }
        }
        written += 1;
        if written == 1 || written.is_multiple_of(progress_every) || written == estimated_frames {
            let _ = app.emit(
                "upscale-progress",
                json!({
                    "percent": (written as f64 / estimated_frames.max(1) as f64 * 100.0).min(100.0),
                    "frame": written,
                    "total": estimated_frames,
                }),
            );
        }
    }
    drop(stdin);
    if failure.is_none() {
        // Vaciar el pipe para que el decoder no termine con escritura rota.
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
    }
    drop(stdout);

    let encoder_status = encoder_child.wait();
    let decoder_status = decoder_child.wait();
    let encoder_text = encoder_log.map(|handle| handle.join().unwrap_or_default());
    let decoder_text = decoder_log.map(|handle| handle.join().unwrap_or_default());

    if let Some(error) = failure {
        let _ = std::fs::remove_file(output);
        let _ = encoder_child.kill();
        return Err(error);
    }
    if written == 0 {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el video no entregó ningún frame para procesar",
        ));
    }
    if !matches!(encoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "el codificador del upscale falló: {}",
                log_tail(encoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if !matches!(decoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "FFmpeg no pudo leer el video completo: {}",
                log_tail(decoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if std::fs::metadata(output)
        .map(|meta| meta.len())
        .unwrap_or(0)
        == 0
    {
        let _ = std::fs::remove_file(output);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el upscale se generó vacío",
        ));
    }
    Ok(UpscaleVideoResult {
        path: output.to_string_lossy().into_owned(),
        input_width: width,
        input_height: height,
        output_width: out_width,
        output_height: out_height,
        frames: written,
        fps_num,
        fps_den,
    })
}
