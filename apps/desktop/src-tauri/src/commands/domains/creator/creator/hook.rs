fn hook_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    text: &str,
    zoom: f64,
    gain_db: f64,
) -> Result<CreatorOutput, CreatorError> {
    if text.trim().is_empty() {
        return Err(CreatorError::Invalid("Escribí el texto del hook.".into()));
    }
    let info = probe_video(ffprobe, input)?;
    let workspace = TempWorkspace::new("hook")?;
    write_hook_ass(
        &workspace.path.join("hook.ass"),
        even(info.width),
        even(info.height),
        text,
    )?;
    let hook_len = 3.0_f64.min(info.duration);
    let gain = 10f64
        .powf(gain_db.clamp(-36.0, -6.0) / 20.0)
        .clamp(0.02, 0.5);
    let graph = format!(
        "{};{}",
        hook_filter(info, hook_len, zoom),
        hook_audio_filter(info.has_audio, gain, info.duration)
    );
    let args = vec![
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "anoisesrc=color=pink:duration=3:sample_rate=48000".into(),
        "-filter_complex".into(),
        graph,
        "-map".into(),
        "[v]".into(),
        "-map".into(),
        "[a]".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "fast".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-shortest".into(),
        output.to_string_lossy().into_owned(),
    ];
    run_ffmpeg(ffmpeg, &args, &workspace.path)?;
    metadata_output(
        output.to_path_buf(),
        "hook",
        even(info.width),
        even(info.height),
        info.duration,
    )
}

#[tauri::command]
pub async fn creator_inject_hook(
    state: State<'_, AppState>,
    input_path: String,
    output_path: String,
    hook_text: String,
    zoom_percent: Option<f64>,
    sound_gain_db: Option<f64>,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output = output_mp4(&output_path)?;
    let text = hook_text;
    let zoom = zoom_percent.unwrap_or(10.0) / 100.0;
    let gain = sound_gain_db.unwrap_or(-16.0);
    tauri::async_runtime::spawn_blocking(move || {
        hook_blocking(&ffmpeg, &ffprobe, &input, &output, &text, zoom, gain)
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El hook se interrumpió."))?
    .map_err(Into::into)
}
