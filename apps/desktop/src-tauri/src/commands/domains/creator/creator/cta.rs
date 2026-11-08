fn qr_overlay_graph(qr_size: u32, start: f64, end: f64) -> String {
    format!(
        "[1:v]scale={qr_size}:{qr_size}:flags=neighbor[qr];[vc][qr]overlay=W-w-40:H-h-40:enable='between(t,{start:.3},{end:.3})'[v]"
    )
}

fn cta_blocking(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    text: &str,
    url: &str,
    seconds: f64,
    add_qr: bool,
) -> Result<CreatorOutput, CreatorError> {
    if text.trim().is_empty() {
        return Err(CreatorError::Invalid("Escribí el texto del CTA.".into()));
    }
    if add_qr && url.trim().is_empty() {
        return Err(CreatorError::Invalid(
            "El QR necesita una URL o un texto para codificar.".into(),
        ));
    }
    let info = probe_video(ffprobe, input)?;
    let workspace = TempWorkspace::new("cta")?;
    let width = even(info.width);
    let height = even(info.height);
    let start = (info.duration - seconds.clamp(3.0, 5.0)).max(0.0);
    let qr_size = ((height as f64 * 0.20).round() as u32).clamp(140, 260);
    write_cta_ass(
        &workspace.path.join("cta.ass"),
        width,
        height,
        text,
        start,
        info.duration,
        add_qr,
        qr_size,
    )?;
    let mut args = vec!["-i".into(), input.to_string_lossy().into_owned()];
    if add_qr {
        let qr_path = workspace.path.join("qr.png");
        write_qr_png(&qr_path, url.trim())?;
        args.push("-loop".into());
        args.push("1".into());
        args.push("-i".into());
        args.push(qr_path.to_string_lossy().into_owned());
    }
    let graph = if add_qr {
        format!(
            "[0:v]scale={width}:{height},ass=cta.ass[vc];{}",
            qr_overlay_graph(qr_size, start, info.duration)
        )
    } else {
        format!("[0:v]scale={width}:{height},ass=cta.ass[v]")
    };
    args.extend([
        "-filter_complex".into(),
        graph,
        "-map".into(),
        "[v]".into(),
        "-map".into(),
        "0:a?".into(),
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
        "-t".into(),
        format!("{:.3}", info.duration),
        output.to_string_lossy().into_owned(),
    ]);
    run_ffmpeg(ffmpeg, &args, &workspace.path)?;
    metadata_output(output.to_path_buf(), "cta", width, height, info.duration)
}

#[tauri::command]
pub async fn creator_inject_cta(
    state: State<'_, AppState>,
    input_path: String,
    output_path: String,
    cta_text: String,
    url: String,
    cta_seconds: Option<f64>,
    add_qr: Option<bool>,
) -> Result<CreatorOutput, ProjectError> {
    let (ffmpeg, ffprobe) = tools(&state)?;
    let input = require_file(&input_path, "El video de entrada")?;
    let output = output_mp4(&output_path)?;
    let seconds = cta_seconds.unwrap_or(4.0);
    let add_qr = add_qr.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        cta_blocking(
            &ffmpeg, &ffprobe, &input, &output, &cta_text, &url, seconds, add_qr,
        )
    })
    .await
    .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "El CTA se interrumpió."))?
    .map_err(Into::into)
}
