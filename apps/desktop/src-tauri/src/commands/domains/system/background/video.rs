pub(crate) fn drain_stderr<R: Read + Send + 'static>(mut reader: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut collected = Vec::new();
        let mut buffer = [0u8; 8 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if collected.len() < 64 * 1024 {
                        let room = 64 * 1024 - collected.len();
                        collected.extend_from_slice(&buffer[..read.min(room)]);
                    }
                }
            }
        }
        String::from_utf8_lossy(&collected).into_owned()
    })
}

pub(crate) fn read_full_frame(
    reader: &mut impl Read,
    buffer: &mut [u8],
) -> Result<bool, ProjectError> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => return Ok(false),
            Ok(read) => filled += read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => {
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    "FFmpeg dejó de entregar frames durante el recorte",
                ))
            }
        }
    }
    Ok(true)
}

pub(crate) fn count_video_frames(ffprobe: &Path, path: &Path) -> Result<u64, ProjectError> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no pudo contar los frames del recorte",
        )
    })?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().parse::<u64>().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no informó los frames del recorte",
        )
    })
}

pub(crate) fn log_tail(text: &str) -> String {
    text.chars()
        .rev()
        .take(300)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

/// Quita el fondo de un tramo de video frame por frame y devuelve un WebM VP9
/// con canal alfa y el audio original. El tramo se expresa en frames del
/// proyecto para que la ventana del clip siga siendo exacta.
fn remove_video_background<F>(
    root: &Path,
    input: &Path,
    ffmpeg: &Path,
    ffprobe: &Path,
    model_path: &Path,
    in_frame: u64,
    out_frame: u64,
    fps_num: u32,
    fps_den: u32,
    mut progress: F,
) -> Result<Value, ProjectError>
where
    F: FnMut(f64),
{
    let frames = out_frame.saturating_sub(in_frame);
    if frames == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tramo del clip no tiene frames para procesar",
        ));
    }
    if frames > 3_600 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tramo supera los 3.600 frames (unos 2 minutos a 30 fps); procesalo en partes más cortas",
        ));
    }
    let measure = probe_file(ffprobe, input, MediaKind::Video)?;
    let (width, height) =
        fit_output_frame(measure.width.unwrap_or(0), measure.height.unwrap_or(0))?;
    let fps = fps_num.max(1) as f64 / fps_den.max(1) as f64;
    if !fps.is_finite() || fps <= 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la tasa del proyecto no es válida",
        ));
    }
    let start_seconds = in_frame as f64 / fps;
    let duration_seconds = frames as f64 / fps;
    let temp = std::env::temp_dir().join(format!("olyvia-recorte-{}.webm", uuid::Uuid::new_v4()));
    // La sesión se abre antes de lanzar procesos: si falta el modelo o el DLL,
    // no queda ningún hijo ni temporal que limpiar.
    let mut session = open_session(model_path)?;

    let mut decoder = Command::new(ffmpeg);
    decoder
        .args(["-hide_banner", "-v", "error", "-ss"])
        .arg(format!("{start_seconds:.6}"))
        .arg("-i")
        .arg(input)
        .args([
            "-vf",
            &format!(
                "fps={}/{},scale={}:{}:flags=lanczos",
                fps_num.max(1),
                fps_den.max(1),
                width,
                height
            ),
            "-frames:v",
            &frames.to_string(),
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
            &format!("{width}x{height}"),
            "-r",
            &format!("{}/{}", fps_num.max(1), fps_den.max(1)),
            "-i",
            "pipe:0",
            "-ss",
        ])
        .arg(format!("{start_seconds:.6}"))
        .arg("-i")
        .arg(input)
        .args([
            "-t",
            &format!("{duration_seconds:.6}"),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-c:v",
            "libvpx-vp9",
            "-pix_fmt",
            "yuva420p",
            "-b:v",
            "0",
            "-crf",
            "30",
            "-cpu-used",
            "2",
            "-row-mt",
            "1",
            "-c:a",
            "libopus",
            "-b:a",
            "160k",
            "-frames:v",
            &frames.to_string(),
            "-y",
        ])
        .arg(&temp)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut encoder);
    let mut encoder_child = encoder.spawn().map_err(|error| {
        let _ = decoder_child.kill();
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar el codificador del recorte: {error}").as_str(),
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
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    let mut last_rgb: Option<Vec<u8>> = None;
    let step = (frames / 100).max(1);
    let mut written = 0u64;
    let mut failure: Option<ProjectError> = None;

    for index in 0..frames {
        let complete = match read_full_frame(&mut stdout, &mut rgb) {
            Ok(value) => value,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };
        if complete {
            last_rgb = Some(rgb.clone());
        } else if let Some(last) = &last_rgb {
            // Si el decoder termina antes, se repite el último frame: el clip
            // conserva su ventana exacta en vez de quedar corto.
            rgb.copy_from_slice(last);
        } else {
            failure = Some(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el video no entregó ningún frame en ese tramo",
            ));
            break;
        }
        let Some(frame) = RgbImage::from_raw(width, height, rgb.clone()) else {
            failure = Some(ProjectError::message(
                ProjectErrorCode::Io,
                "el frame decodificado no coincide con el tamaño esperado",
            ));
            break;
        };
        let dynamic = DynamicImage::ImageRgb8(frame);
        let mask = match run_u2netp_session(&mut session, &dynamic) {
            Ok(mask) => mask,
            Err(error) => {
                failure = Some(error);
                break;
            }
        };
        let cutout = composite_with_alpha(&dynamic, &mask);
        rgba.copy_from_slice(cutout.as_raw());
        if stdin.write_all(&rgba).is_err() {
            failure = Some(ProjectError::message(
                ProjectErrorCode::Io,
                "el codificador cerró el flujo antes de terminar el recorte",
            ));
            break;
        }
        written += 1;
        if index == 0 || index + 1 == frames || (index + 1) % step == 0 {
            progress(written as f64 / frames as f64 * 100.0);
        }
    }
    drop(stdin);
    if failure.is_none() {
        // El decoder puede haber emitido un frame extra por redondeo; vaciar
        // el pipe evita que termine con un error de escritura rota.
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
    }
    drop(stdout);

    let encoder_status = encoder_child.wait();
    let decoder_status = decoder_child.wait();
    let encoder_text = encoder_log.map(|handle| handle.join().unwrap_or_default());
    let decoder_text = decoder_log.map(|handle| handle.join().unwrap_or_default());

    if let Some(error) = failure {
        let _ = std::fs::remove_file(&temp);
        let _ = encoder_child.kill();
        return Err(error);
    }
    if !matches!(encoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "el codificador del recorte falló: {}",
                log_tail(encoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if !matches!(decoder_status, Ok(status) if status.success()) {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "FFmpeg no pudo leer el tramo del video: {}",
                log_tail(decoder_text.as_deref().unwrap_or(""))
            ),
        ));
    }
    if std::fs::metadata(&temp).map(|meta| meta.len()).unwrap_or(0) == 0 {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el recorte se generó vacío",
        ));
    }
    let encoded_frames = match count_video_frames(ffprobe, &temp) {
        Ok(count) => count,
        Err(error) => {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
    };
    if encoded_frames != frames {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!(
                "el recorte quedó con {encoded_frames} de {frames} frames; probá un tramo más corto"
            ),
        ));
    }
    progress(100.0);
    let stem = source_stem(input);
    let result = import_derived_asset(root, &temp, ffprobe, fps_num, fps_den, &stem);
    let _ = std::fs::remove_file(&temp);
    let mut asset = result?;
    // El WebM contiene exactamente `frames` frames a la tasa del proyecto.
    // Se fija la medición al conteo real para que la ventana del clip siga
    // siendo exacta aunque el contenedor redondee la duración.
    if let Some(media) = asset.get_mut("media").and_then(Value::as_object_mut) {
        media.insert("width".into(), json!(width));
        media.insert("height".into(), json!(height));
        media.insert("durationFrames".into(), json!(frames));
        media.insert(
            "frameRate".into(),
            json!({ "num": fps_num, "den": fps_den }),
        );
        media.insert("alpha".into(), json!(true));
    }
    Ok(asset)
}
