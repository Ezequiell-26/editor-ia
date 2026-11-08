/// Extrae frames muestreados y detecta el rostro más grande en cada uno.
/// Devuelve sólo las muestras con detección; la expresión de FFmpeg interpola
/// los huecos. El directorio temporal se borra siempre.
fn extract_face_samples(
    app: Option<&AppHandle>,
    ffmpeg: &Path,
    model_path: &Path,
    input: &Path,
    start_seconds: f64,
    duration: f64,
) -> Result<Vec<FaceSample>, ProjectError> {
    let directory = std::env::temp_dir().join(format!("editoria-faces-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el análisis de rostros: {error}").as_str(),
        )
    })?;
    let result = (|| -> Result<Vec<FaceSample>, ProjectError> {
        let target = ((duration * 1.5).ceil() as usize).clamp(6, 30);
        let fps = target as f64 / duration;
        let pattern = directory.join("frame-%04d.jpg");
        let fps_arg = format!("{fps:.4}");
        let mut command = Command::new(ffmpeg);
        command
            .args([
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                &format!("{start_seconds:.3}"),
                "-i",
            ])
            .arg(input)
            .args([
                "-t",
                &format!("{duration:.3}"),
                "-vf",
                &format!("fps={fps_arg},scale=480:-2"),
                "-q:v",
                "3",
                "-frames:v",
                &target.to_string(),
            ])
            .arg(&pattern)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        let output = command.output().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudieron extraer frames para rostros: {error}").as_str(),
            )
        })?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                detail
                    .lines()
                    .last()
                    .unwrap_or("FFmpeg no pudo extraer frames para el análisis facial")
                    .chars()
                    .take(240)
                    .collect::<String>()
                    .as_str(),
            ));
        }
        let mut frames: Vec<PathBuf> = std::fs::read_dir(&directory)
            .map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudo leer el directorio temporal de rostros",
                )
            })?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("jpg"))
                    .unwrap_or(false)
            })
            .collect();
        frames.sort();
        if frames.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "no se extrajeron frames para analizar rostros",
            ));
        }
        let mut detector = face::create_detector(model_path)
            .map_err(|detail| ProjectError::message(ProjectErrorCode::Io, &detail))?;
        let mut samples = Vec::new();
        for (index, path) in frames.iter().enumerate() {
            let image = match image::open(path) {
                Ok(image) => image,
                Err(_) => continue,
            };
            let time = ((index as f64 + 0.5) / fps).clamp(0.0, duration);
            if let Some(sample) = face::detect_in_image(detector.as_mut(), &image, time) {
                samples.push(sample);
            }
            if let Some(app) = app {
                let percent = 5.0 + (index as f64 + 1.0) / frames.len() as f64 * 25.0;
                let _ = app.emit("short-progress", serde_json::json!({ "percent": percent }));
            }
        }
        Ok(samples)
    })();
    let _ = std::fs::remove_dir_all(&directory);
    result
}

fn probe_result(ffprobe: Option<&Path>, path: &Path, fallback_duration: f64) -> (u32, u32, f64) {
    let Some(ffprobe) = ffprobe else {
        return (SHORT_WIDTH, SHORT_HEIGHT, fallback_duration);
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return (SHORT_WIDTH, SHORT_HEIGHT, fallback_duration);
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
        return (SHORT_WIDTH, SHORT_HEIGHT, fallback_duration);
    };
    let stream = value["streams"].as_array().and_then(|items| items.first());
    let width = stream
        .and_then(|item| item["width"].as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(SHORT_WIDTH);
    let height = stream
        .and_then(|item| item["height"].as_u64())
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(SHORT_HEIGHT);
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(fallback_duration);
    (width, height, duration)
}
