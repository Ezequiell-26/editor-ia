#[derive(Debug, Clone, Copy)]
enum Aspect {
    Vertical,
    Horizontal,
    Square,
}

impl Aspect {
    fn from_key(key: &str) -> Option<Self> {
        match key.trim().to_ascii_lowercase().as_str() {
            "vertical" | "9:16" | "916" => Some(Self::Vertical),
            "horizontal" | "16:9" | "169" => Some(Self::Horizontal),
            "square" | "1:1" | "11" => Some(Self::Square),
            _ => None,
        }
    }

    fn dimensions(self) -> (u32, u32) {
        match self {
            Self::Vertical => (1080, 1920),
            Self::Horizontal => (1920, 1080),
            Self::Square => (1080, 1080),
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Vertical => "vertical",
            Self::Horizontal => "horizontal",
            Self::Square => "square",
        }
    }

    fn suffix(self) -> &'static str {
        match self {
            Self::Vertical => "vertical-9x16",
            Self::Horizontal => "horizontal-16x9",
            Self::Square => "square-1x1",
        }
    }
}

fn aspect_filter(aspect: Aspect) -> String {
    let (width, height) = aspect.dimensions();
    match aspect {
        Aspect::Horizontal => format!(
            "[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=yuv420p[v]"
        ),
        Aspect::Vertical | Aspect::Square => format!(
            "[0:v]split=2[bg][fg];[bg]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},gblur=sigma=28[bgv];[fg]scale={width}:{height}:force_original_aspect_ratio=decrease[fgv];[bgv][fgv]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]"
        ),
    }
}

fn render_aspect(
    ffmpeg: &Path,
    input: &Path,
    output: &Path,
    aspect: Aspect,
    duration: f64,
    audio_copy: bool,
    has_audio: bool,
) -> Result<CreatorOutput, CreatorError> {
    let (width, height) = aspect.dimensions();
    let mut args = vec![
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-filter_complex".into(),
        aspect_filter(aspect),
        "-map".into(),
        "[v]".into(),
    ];
    if has_audio {
        args.extend([
            "-map".into(),
            "0:a?".into(),
            "-c:a".into(),
            if audio_copy {
                "copy".into()
            } else {
                "aac".into()
            },
            "-b:a".into(),
            "192k".into(),
        ]);
    } else {
        args.push("-an".into());
    }
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        output.to_string_lossy().into_owned(),
    ]);
    run_ffmpeg(
        ffmpeg,
        &args,
        output.parent().unwrap_or_else(|| Path::new(".")),
    )?;
    metadata_output(output.to_path_buf(), aspect.key(), width, height, duration)
}

async fn aspect_blocking(
    ffmpeg: &Path,
    input: &Path,
    output_dir: &Path,
    aspects: Vec<Aspect>,
    duration: f64,
    has_audio: bool,
) -> Result<Vec<CreatorOutput>, CreatorError> {
    std::fs::create_dir_all(output_dir)?;
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let mut set: JoinSet<Result<CreatorOutput, CreatorError>> = JoinSet::new();
    for aspect in aspects {
        let ffmpeg = ffmpeg.to_path_buf();
        let input = input.to_path_buf();
        let output = output_dir.join(format!("{stem}-{}.mp4", aspect.suffix()));
        set.spawn_blocking(move || {
            let first = render_aspect(
                &ffmpeg, &input, &output, aspect, duration, has_audio, has_audio,
            );
            match first {
                Ok(output) => Ok(output),
                Err(_) if has_audio => {
                    render_aspect(&ffmpeg, &input, &output, aspect, duration, false, has_audio)
                }
                Err(error) => Err(error),
            }
        });
    }
    let mut outputs = Vec::new();
    while let Some(joined) = set.join_next().await {
        let output = joined
            .map_err(|_| CreatorError::Invalid("una exportación se interrumpió.".into()))??;
        outputs.push(output);
    }
    outputs.sort_by(|left, right| left.kind.cmp(&right.kind));
    if outputs.is_empty() {
        return Err(CreatorError::Invalid(
            "No se pidió ninguna relación de aspecto.".into(),
        ));
    }
    Ok(outputs)
}

#[tauri::command]
pub async fn creator_export_multi_aspect(
    state: State<'_, AppState>,
    input_path: String,
    output_dir: String,
    aspects: Option<Vec<String>>,
) -> Result<Vec<CreatorOutput>, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output_dir = PathBuf::from(output_dir.trim());
    if output_dir.as_os_str().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "Elegí una carpeta de salida.",
        ));
    }
    let wanted =
        aspects.unwrap_or_else(|| vec!["vertical".into(), "horizontal".into(), "square".into()]);
    let mut parsed = Vec::new();
    for key in wanted {
        let aspect = Aspect::from_key(&key).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("Relación de aspecto desconocida: {key}"),
            )
        })?;
        if !parsed
            .iter()
            .any(|item: &Aspect| item.key() == aspect.key())
        {
            parsed.push(aspect);
        }
    }
    let info = tauri::async_runtime::spawn_blocking(move || probe_video(&ffprobe, &input))
        .await
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "La medición se interrumpió."))?
        .map_err(ProjectError::from)?;
    let input = require_file(&input_path, "El video de entrada")?;
    aspect_blocking(
        &ffmpeg,
        &input,
        &output_dir,
        parsed,
        info.duration,
        info.has_audio,
    )
    .await
    .map_err(Into::into)
}
