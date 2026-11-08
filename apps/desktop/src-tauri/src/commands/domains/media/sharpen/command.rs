#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SharpenRequest {
    pub input_path: String,
    pub output_dir: Option<String>,
    pub mode: Option<String>,
    pub denoise: Option<u8>,
    pub deblock: Option<bool>,
    pub target_height: Option<u32>,
    pub high_precision: Option<bool>,
    pub unsharp_amount: Option<f32>,
    pub unsharp_size: Option<u32>,
    pub curve: Option<u8>,
    pub grain: Option<f32>,
    /// Etiqueta del preajuste aplicado, solo para el informe del resultado.
    pub preset: Option<String>,
}

impl Default for SharpenRequest {
    fn default() -> Self {
        Self {
            input_path: String::new(),
            output_dir: None,
            mode: None,
            denoise: None,
            deblock: None,
            target_height: None,
            high_precision: None,
            unsharp_amount: None,
            unsharp_size: None,
            curve: None,
            grain: None,
            preset: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharpenResult {
    pub path: String,
    pub bytes: u64,
    pub source_bytes: u64,
    /// La cadena realmente aplicada, tal como la ve FFmpeg.
    pub filter: String,
    pub encoder: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
    pub duration_seconds: Option<f64>,
    pub preset: Option<String>,
}

/// Aplica la cadena de definición a una imagen o un video del disco.
///
/// Se escribe primero en un temporal oculto; si FFmpeg falla, el temporal se
/// borra y el original nunca se toca.
#[tauri::command]
pub async fn sharpen_media(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SharpenRequest,
) -> Result<SharpenResult, ProjectError> {
    let input_path = PathBuf::from(request.input_path.trim());
    if input_path.as_os_str().is_empty() || !input_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo para definir nitidez no está en disco",
        ));
    }
    let mode = ClarityMode::parse(request.mode.as_deref())?;
    let config = ClarityConfig {
        denoise: request.denoise.unwrap_or(0).min(100),
        deblock: request.deblock.unwrap_or(false),
        target_height: request.target_height.unwrap_or(0).min(8192),
        high_precision: request.high_precision.unwrap_or(true),
        unsharp_amount: request.unsharp_amount.unwrap_or(0.0).clamp(0.0, 3.0),
        unsharp_size: request.unsharp_size.unwrap_or(5),
        curve: request.curve.unwrap_or(0).min(100),
        grain: request.grain.unwrap_or(0.0).clamp(0.0, 3.0),
        temporal: mode == ClarityMode::Video,
    };

    let source_bytes = std::fs::metadata(&input_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let output_dir = match request.output_dir.as_deref() {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => input_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(".")),
    };
    if !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino de la definición no existe",
        ));
    }

    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para aplicar definición",
        ));
    };

    let source = probe_media(ffprobe.as_deref(), &input_path);
    let filters = clarity_filters(&config, source.height.unwrap_or(0));
    if filters.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no hay ninguna etapa activa: activá al menos una mejora de definición",
        ));
    }
    let filter = filters.join(",");

    let encoder = resolve_encoder(&ffmpeg)?;
    let output_width = match (source.width, source.height) {
        (Some(width), Some(height)) if height > 0 && config.target_height > 0 => {
            // El mismo redondeo que hace `scale=-2:alto`.
            let scaled = f64::from(width) * f64::from(config.target_height) / f64::from(height);
            let even = ((scaled.round() as u32) / 2) * 2;
            even.max(2)
        }
        (Some(width), _) => width,
        _ => 0,
    };
    let output_height = if config.target_height > 0 {
        config.target_height
    } else {
        source.height.unwrap_or(0)
    };

    let stem = input_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let final_path = unique_output(&output_dir, &stem, mode.extension());
    let temp_path = output_dir.join(format!(
        ".definicion-{}.{}",
        Uuid::new_v4(),
        mode.extension()
    ));

    let mut command = Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&input_path)
        .arg("-vf")
        .arg(&filter);
    match mode {
        ClarityMode::Video => {
            command.args(["-map", "0:v:0", "-map", "0:a?"]);
            command.args(video_codec_args(
                &encoder,
                16,
                output_width,
                output_height,
                source.fps,
            ));
            command.args([
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
            ]);
        }
        ClarityMode::Image => {
            command.args(["-frames:v", "1", "-update", "1"]);
        }
    }
    command.args(["-progress", "pipe:1", "-nostats"]);
    command.arg(&temp_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command.spawn().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para la definición: {error}").as_str(),
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso el progreso")
    })?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso el log"))?;

    let stderr_handle = thread::spawn(move || {
        let mut text = String::new();
        let _ = BufReader::new(stderr)
            .take(64 * 1024)
            .read_to_string(&mut text);
        text
    });

    let total_seconds = source.duration.unwrap_or(0.0);
    let emitter = app.clone();
    let progress_handle = thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(microseconds) = value.trim().parse::<f64>() {
                    if total_seconds > 0.0 {
                        let percent = (microseconds / (total_seconds * 1_000_000.0) * 100.0)
                            .clamp(0.0, 100.0);
                        let _ = emitter.emit(
                            "sharpen-progress",
                            serde_json::json!({ "percent": percent }),
                        );
                    }
                }
            }
        }
    });

    let status = child.wait().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("FFmpeg de definición no terminó: {error}").as_str(),
        )
    })?;
    let _ = progress_handle.join();
    let stderr_text = stderr_handle.join().unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(&temp_path);
        let sanitized = sanitize_log(&stderr_text, &output_dir, 24);
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            format!("la definición falló: {sanitized}").as_str(),
        ));
    }
    if std::fs::metadata(&temp_path)
        .map(|meta| meta.len())
        .unwrap_or(0)
        == 0
    {
        let _ = std::fs::remove_file(&temp_path);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no produjo un archivo de definición válido",
        ));
    }
    std::fs::rename(&temp_path, &final_path).map_err(|error| {
        let _ = std::fs::remove_file(&temp_path);
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo publicar el archivo de definición: {error}").as_str(),
        )
    })?;
    let bytes = std::fs::metadata(&final_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let rendered = probe_media(ffprobe.as_deref(), &final_path);
    let _ = app.emit("sharpen-progress", serde_json::json!({ "percent": 100.0 }));
    Ok(SharpenResult {
        path: final_path.to_string_lossy().into_owned(),
        bytes,
        source_bytes,
        filter,
        encoder,
        width: rendered.width.or(Some(output_width)),
        height: rendered.height.or(Some(output_height)),
        source_width: source.width,
        source_height: source.height,
        duration_seconds: rendered.duration.or(source.duration),
        preset: request.preset,
    })
}
