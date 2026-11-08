fn burn_subtitles_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    subtitle_text: &str,
) -> Result<CreatorOutput, CreatorError> {
    if subtitle_text.trim().is_empty() {
        return Err(CreatorError::Invalid(
            "El archivo de subtítulos está vacío.".into(),
        ));
    }
    if subtitle_text.len() > 5_000_000 {
        return Err(CreatorError::Invalid(
            "Los subtítulos superan los 5 MB.".into(),
        ));
    }
    let info = probe_video(ffprobe, input)?;
    let workspace = TempWorkspace::new("burn")?;
    std::fs::write(workspace.path.join("subs.srt"), subtitle_text)?;
    let filter = "scale=trunc(iw/2)*2:trunc(ih/2)*2,subtitles=subs.srt:force_style='FontName=Segoe UI,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=48'";
    let args = vec![
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        filter.into(),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a?".into(),
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
    metadata_output(
        output.to_path_buf(),
        "subtitles",
        even(info.width),
        even(info.height),
        info.duration,
    )
}

#[tauri::command]
pub async fn creator_burn_subtitles(
    state: State<'_, AppState>,
    input_path: String,
    output_path: String,
    subtitle_text: String,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output = output_mp4(&output_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        burn_subtitles_blocking(&ffmpeg, &ffprobe, &input, &output, &subtitle_text)
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El burn-in se interrumpió."))?
    .map_err(Into::into)
}

// Compatibilidad con el frontend que aún no usa serde para algunos campos.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorAspectInfo {
    pub key: String,
    pub width: u32,
    pub height: u32,
}
