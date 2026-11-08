/// Exporta el rango como MP4 vertical. La ruta de entrada se resuelve dentro del
/// proyecto para que el frontend no pueda leer archivos arbitrarios.
#[tauri::command]
pub async fn export_short(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ExportShortRequest,
) -> Result<ExportShortResult, ProjectError> {
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del short ya no está en el proyecto",
        ));
    }
    let duration = validate_short_range(request.start_seconds, request.end_seconds)?;
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del short no existe",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para exportar el short",
        ));
    };
    let source_stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let stem = request
        .label
        .as_deref()
        .map(|label| safe_stem(label, &safe_stem(&source_stem, "video")))
        .unwrap_or_else(|| format!("{}-short", safe_stem(&source_stem, "video")));
    let final_path = unique_path(&output_dir, &stem);
    let temp_path = output_dir.join(format!(".short-{}.mp4", Uuid::new_v4()));
    let (source_width, source_height, _) = probe_result(ffprobe.as_deref(), &input, duration);
    let mut faces_detected = 0u32;
    let mut reframe = "center";
    let filter = if request.smart_reframe {
        let spec = model_by_id("seeta-face").ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el catálogo no tiene el modelo de rostros",
            )
        })?;
        if !is_model_downloaded(&state, spec) {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "descargá el modelo de rostros (1,2 MB) en Ajustes → Capacidades para usar smart reframe",
            ));
        }
        if !verify_model_hash(&state, spec) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el modelo de rostros no coincide con su checksum; volvé a descargarlo en Ajustes → Capacidades",
            ));
        }
        let model_path = spec
            .files
            .first()
            .map(|file| model_file(&state, spec, file))
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::NotFound,
                    "el modelo de rostros no declara archivos",
                )
            })?;
        let samples = extract_face_samples(
            Some(&app),
            &ffmpeg,
            &model_path,
            &input,
            request.start_seconds,
            duration,
        )?;
        faces_detected = samples.len() as u32;
        let track = face::smooth_track(&samples);
        if track.is_empty() {
            vertical_short_filter()
        } else {
            reframe = "smart";
            let (scaled_width, scaled_height) = face::scaled_cover(source_width, source_height);
            let x = face::crop_expression(
                &track,
                f64::from(scaled_width),
                f64::from(scaled_height),
                f64::from(SHORT_WIDTH),
                f64::from(SHORT_HEIGHT),
                'x',
            );
            let y = face::crop_expression(
                &track,
                f64::from(scaled_width),
                f64::from(scaled_height),
                f64::from(SHORT_WIDTH),
                f64::from(SHORT_HEIGHT),
                'y',
            );
            format!(
                "setpts=PTS-STARTPTS,scale={scaled_width}:{scaled_height},crop={SHORT_WIDTH}:{SHORT_HEIGHT}:x='{x}':y='{y}',setsar=1"
            )
        }
    } else {
        vertical_short_filter()
    };
    let progress_base = if request.smart_reframe { 30.0 } else { 0.0 };
    let progress_scale = 100.0 - progress_base;
    let start = format!("{:.3}", request.start_seconds);
    let length = format!("{duration:.3}");

    let mut command = Command::new(ffmpeg);
    command
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &start,
            "-i",
        ])
        .arg(&input)
        .args([
            "-t",
            &length,
            "-vf",
            &filter,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(&temp_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para el short: {error}").as_str(),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso su progreso")
    })?;
    let progress_app = app.clone();
    let progress_thread = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let raw = line
                .strip_prefix("out_time_us=")
                .or_else(|| line.strip_prefix("out_time_ms="));
            let Some(raw) = raw else { continue };
            let Ok(micros) = raw.trim().parse::<f64>() else {
                continue;
            };
            if micros < 0.0 {
                continue;
            }
            let percent =
                (progress_base + micros / 1_000_000.0 / duration * progress_scale).clamp(0.0, 99.0);
            let _ = progress_app.emit("short-progress", serde_json::json!({ "percent": percent }));
        }
    });
    let status = child.wait();
    let mut stderr = String::new();
    if let Some(mut handle) = child.stderr.take() {
        let _ = handle.read_to_string(&mut stderr);
    }
    let _ = progress_thread.join();

    if !matches!(status, Ok(status) if status.success()) {
        let safe = stderr
            .lines()
            .last()
            .unwrap_or("FFmpeg no pudo exportar el short")
            .chars()
            .take(240)
            .collect::<String>();
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(ProjectErrorCode::Io, &safe));
    }
    let bytes = std::fs::metadata(&temp_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if bytes == 0 {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el short quedó vacío; no se publicó",
        ));
    }
    let (width, height, measured) = probe_result(ffprobe.as_deref(), &temp_path, duration);
    if width != SHORT_WIDTH || height != SHORT_HEIGHT {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            &format!(
                "el short salió en {width}×{height} y se esperaba {SHORT_WIDTH}×{SHORT_HEIGHT}"
            ),
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el short: {error}").as_str(),
        )
    })?;
    let published = std::fs::metadata(&final_path)
        .map(|metadata| metadata.len())
        .unwrap_or(bytes);
    let _ = app.emit("short-progress", serde_json::json!({ "percent": 100.0 }));
    Ok(ExportShortResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes: published,
        width,
        height,
        duration_seconds: measured,
        reframe: reframe.to_owned(),
        faces_detected,
    })
}
