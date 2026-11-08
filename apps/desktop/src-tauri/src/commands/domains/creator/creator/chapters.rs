#[derive(Debug, Clone)]
struct Chapter {
    start: f64,
    end: f64,
    title: String,
}

fn probe_chapters(ffprobe: &Path, input: &Path) -> Result<Vec<Chapter>, CreatorError> {
    let mut command = Command::new(ffprobe);
    command
        .args(["-v", "error", "-show_chapters", "-of", "json"])
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        return Err(CreatorError::Probe(
            "No se pudieron leer los capítulos.".into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| CreatorError::Probe("FFprobe devolvió JSON inválido.".into()))?;
    let chapters = value["chapters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|chapter| {
            let start = chapter["start_time"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .or_else(|| chapter["start_time"].as_f64())?;
            let end = chapter["end_time"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .or_else(|| chapter["end_time"].as_f64())
                .unwrap_or(start);
            let title = chapter["tags"]["title"]
                .as_str()
                .or_else(|| chapter["title"].as_str())
                .unwrap_or("Capítulo")
                .trim()
                .to_owned();
            (end > start).then_some(Chapter { start, end, title })
        })
        .collect::<Vec<_>>();
    if chapters.is_empty() {
        return Err(CreatorError::Invalid(
            "El video no tiene capítulos para dividir.".into(),
        ));
    }
    if chapters.len() > 80 {
        return Err(CreatorError::Invalid(format!(
            "El video tiene {} capítulos; el máximo por división es 80.",
            chapters.len()
        )));
    }
    Ok(chapters)
}

fn safe_name(raw: &str) -> String {
    let mut value: String = raw
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    value = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let value = value
        .trim_matches([' ', '.'])
        .chars()
        .take(60)
        .collect::<String>();
    if value.is_empty() {
        "capitulo".to_owned()
    } else {
        value
    }
}

fn split_chapters_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output_dir: &Path,
) -> Result<Vec<CreatorOutput>, CreatorError> {
    let chapters = probe_chapters(ffprobe, input)?;
    std::fs::create_dir_all(output_dir)?;
    let info = probe_video(ffprobe, input)?;
    let stem = input
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".to_owned());
    let mut outputs = Vec::new();
    let workspace = TempWorkspace::new("chapters")?;
    for (index, chapter) in chapters.iter().enumerate() {
        let name = format!(
            "{stem}-cap-{:02}-{}.mp4",
            index + 1,
            safe_name(&chapter.title)
        );
        let output = output_dir.join(name);
        let duration = (chapter.end - chapter.start).max(0.1);
        let args = vec![
            "-ss".into(),
            format!("{:.3}", chapter.start),
            "-i".into(),
            input.to_string_lossy().into_owned(),
            "-t".into(),
            format!("{duration:.3}"),
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            "0:a?".into(),
            "-map_chapters".into(),
            "-1".into(),
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "20".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "160k".into(),
            "-movflags".into(),
            "+faststart".into(),
            output.to_string_lossy().into_owned(),
        ];
        run_ffmpeg(ffmpeg, &args, &workspace.path)?;
        outputs.push(metadata_output(
            output,
            "chapter",
            even(info.width),
            even(info.height),
            duration,
        )?);
    }
    Ok(outputs)
}

#[tauri::command]
pub async fn creator_split_chapters(
    state: State<'_, AppState>,
    input_path: String,
    output_dir: String,
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
    tauri::async_runtime::spawn_blocking(move || {
        split_chapters_blocking(&ffmpeg, &ffprobe, &input, &output_dir)
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "La división se interrumpió."))?
    .map_err(Into::into)
}
