/// Núcleo testeable del doblaje. No valida la ruta del proyecto: eso lo hace
/// el comando antes de llamarlo.
#[allow(clippy::too_many_arguments)]
pub(crate) fn synthesize_dub_file(
    app: Option<&AppHandle>,
    powershell: &Path,
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output_dir: &Path,
    language: &str,
    voice: &str,
    cues: &[DubCue],
    end_seconds: f64,
    bed_volume: Option<f64>,
) -> Result<DubResult, ProjectError> {
    let temp = std::env::temp_dir().join(format!("editoria-dub-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&temp).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el doblaje: {error}").as_str(),
        )
    })?;
    let result = (|| -> Result<DubResult, ProjectError> {
        let mut segments: Vec<DubSegment> = Vec::with_capacity(cues.len());
        for (index, cue) in cues.iter().enumerate() {
            let wav = temp.join(format!("cue-{index:04}.wav"));
            synthesize_sapi_wav(powershell, &cue.text, voice, &wav)?;
            let duration = probe_audio_duration(ffprobe, &wav).ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "no se pudo medir la voz generada para un subtítulo",
                )
            })?;
            segments.push(DubSegment {
                start: cue.start_seconds,
                end: cue.end_seconds,
                wav,
                duration,
            });
            if let Some(app) = app {
                let percent = ((index + 1) as f64 / cues.len() as f64 * 70.0).min(70.0);
                let _ = app.emit("dub-progress", serde_json::json!({ "percent": percent }));
            }
        }
        let requested_bed = bed_volume
            .filter(|volume| volume.is_finite() && *volume > 0.0)
            .map(|volume| volume.clamp(0.0, 1.0));
        let has_audio = source_has_audio(ffprobe, input);
        let effective_bed = requested_bed.filter(|_| has_audio);
        let (filter, mut warnings) = build_dub_filter(&segments, end_seconds, effective_bed);
        if requested_bed.is_some() && !has_audio {
            warnings
                .push("El video no tiene audio original; se dobló sin cama musical.".to_owned());
        }
        let stem = input
            .file_stem()
            .map(|value| safe_stem(&value.to_string_lossy()))
            .unwrap_or_else(|| "video".to_owned());
        let final_path = unique_output(output_dir, &stem, language);
        let temp_path = output_dir.join(format!(".dub-{}.mp4", Uuid::new_v4()));
        let mut command = Command::new(ffmpeg);
        command
            .args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
            .arg(input);
        for segment in &segments {
            command.arg("-i").arg(&segment.wav);
        }
        command
            .args([
                "-filter_complex",
                &filter,
                "-map",
                "0:v:0",
                "-map",
                "[aout]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-t",
                &format!("{end_seconds:.3}"),
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
                format!("no se pudo iniciar FFmpeg para el doblaje: {error}").as_str(),
            )
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::Io, "FFmpeg no expuso su progreso")
        })?;
        let progress_app = app.cloned();
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
                let percent = (70.0 + micros / 1_000_000.0 / end_seconds * 30.0).clamp(70.0, 99.0);
                if let Some(app) = progress_app.as_ref() {
                    let _ = app.emit("dub-progress", serde_json::json!({ "percent": percent }));
                }
            }
        });
        let status = child.wait();
        let mut stderr = String::new();
        if let Some(mut handle) = child.stderr.take() {
            let _ = handle.read_to_string(&mut stderr);
        }
        let _ = progress_thread.join();
        if !matches!(status, Ok(status) if status.success()) {
            let _ = std::fs::remove_file(&temp_path);
            let safe = stderr
                .lines()
                .last()
                .unwrap_or("FFmpeg no pudo mezclar el doblaje")
                .chars()
                .take(240)
                .collect::<String>();
            return Err(ProjectError::message(ProjectErrorCode::RenderFailed, &safe));
        }
        let bytes = std::fs::metadata(&temp_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if bytes == 0 {
            let _ = std::fs::remove_file(&temp_path);
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el doblaje quedó vacío; no se publicó",
            ));
        }
        let (width, height, measured) = probe_video(ffprobe, &temp_path);
        let width = width.unwrap_or(0);
        let height = height.unwrap_or(0);
        if width == 0 || height == 0 {
            let _ = std::fs::remove_file(&temp_path);
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el doblaje no tiene una pista de video legible",
            ));
        }
        std::fs::rename(&temp_path, &final_path).map_err(|error| {
            let _ = std::fs::remove_file(&temp_path);
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo publicar el doblaje: {error}").as_str(),
            )
        })?;
        let published = std::fs::metadata(&final_path)
            .map(|metadata| metadata.len())
            .unwrap_or(bytes);
        if let Some(app) = app {
            let _ = app.emit("dub-progress", serde_json::json!({ "percent": 100.0 }));
        }
        Ok(DubResult {
            path: final_path.to_string_lossy().into_owned(),
            bytes: published,
            width,
            height,
            duration_seconds: measured.unwrap_or(end_seconds),
            language: language.to_owned(),
            voice: voice.to_owned(),
            cues: cues.len() as u32,
            replaced_original_audio: effective_bed.is_none(),
            original_audio_volume: effective_bed.unwrap_or(0.0),
            warnings,
        })
    })();
    let _ = std::fs::remove_dir_all(&temp);
    result
}
