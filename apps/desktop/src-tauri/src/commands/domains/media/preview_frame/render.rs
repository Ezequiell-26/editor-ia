fn render_frame(
    ffmpeg: &Path,
    root: &Path,
    project: &Value,
    clip_id: &str,
    frame: u64,
    wants_native: bool,
    output_dir: &Path,
) -> Result<PreviewFrameResult, ProjectError> {
    let profile = profile_for(project)?;
    let clip = project["timeline"]["clips"]
        .as_array()
        .and_then(|clips| {
            clips
                .iter()
                .find(|clip| clip["id"].as_str() == Some(clip_id))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el clip del preview ya no está en la timeline",
            )
        })?;
    if !matches!(
        clip["kind"].as_str().unwrap_or(""),
        "video" | "image" | "freeze" | "graphic"
    ) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el preview real sólo aplica a clips visuales",
        ));
    }
    let asset_id = clip["kind"]
        .as_str()
        .filter(|kind| *kind != "graphic")
        .and_then(|_| clip["source"]["assetId"].as_str());
    let asset = asset_id.and_then(|id| {
        project["assets"].as_array().and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(id))
                .cloned()
        })
    });
    if clip["kind"].as_str() == Some("graphic") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el preview real de gráficos se agregará en otra pasada",
        ));
    }
    let asset = asset.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el clip no tiene un medio asociado",
        )
    })?;
    let relative = asset["source"]["path"].as_str().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el medio del clip no tiene una ruta válida",
        )
    })?;
    let input = resolve_inside_root(root, relative)?;
    let is_image = asset["kind"].as_str() != Some("video");
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del clip ya no está en el proyecto",
        ));
    }
    let fps = profile.fps();
    let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(1) as f64 / fps.max(1.0);
    let (time, image) = source_time(&clip, frame, fps);
    let is_image = is_image || image;
    let (view_profile, source, still, decoder, native, cleanup) = if wants_native {
        let source = native_input(&input, is_image, time, &profile, output_dir);
        (
            source.profile,
            source.path,
            source.still,
            source.decoder.to_owned(),
            source.native,
            source.cleanup,
        )
    } else {
        (
            profile.clone(),
            input.clone(),
            is_image,
            "ffmpeg".to_owned(),
            false,
            None,
        )
    };
    // El PNG decodificado en proceso sólo vive hasta que FFmpeg termina.
    let _cleanup = Cleanup(cleanup);
    let filters = visual_filter(
        0,
        &clip,
        &asset,
        &view_profile,
        clip_seconds,
        0.0,
        0.0,
        1,
        1,
        is_image,
    );
    let mut chain = filters;
    if let Some((lut, intensity)) = effects_lut(&clip["effects"], root)? {
        chain = apply_lut_to_chain(chain, "v0", &lut, intensity);
    }
    let output = output_dir.join(format!("frame-{}.png", Uuid::new_v4()));
    let mut command = Command::new(ffmpeg);
    if still {
        command.arg("-i").arg(&source);
    } else {
        command.args(["-ss", &format!("{time:.3}")]);
        if let Some(decoder) = alpha_video_decoder(&asset) {
            command.args(["-c:v", decoder]);
        }
        command.arg("-i").arg(&source);
    }
    command
        .args([
            "-frames:v",
            "1",
            "-filter_complex",
            &chain,
            "-map",
            "[v0]",
            "-an",
            "-y",
        ])
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
        eprintln!("preview command: {:?}", command);
    }
    let result = command.output().map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo iniciar FFmpeg para el preview: {error}").as_str(),
        )
    })?;
    if !result.status.success() || !output.is_file() {
        let detail = String::from_utf8_lossy(&result.stderr);
        let tail = detail
            .lines()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            format!(
                "FFmpeg no pudo generar el frame: {}",
                if tail.is_empty() {
                    "sin detalle"
                } else {
                    &tail
                }
            )
            .as_str(),
        ));
    }
    let (width, height) = image::image_dimensions(&output).map_err(|_| {
        let _ = std::fs::remove_file(&output);
        ProjectError::message(
            ProjectErrorCode::InvalidProviderResponse,
            "el frame generado no es una imagen válida",
        )
    })?;
    Ok(PreviewFrameResult {
        path: output.to_string_lossy().into_owned(),
        width,
        height,
        frame,
        time_seconds: (clip["startFrame"].as_u64().unwrap_or(0) as f64 / fps.max(1.0)
            + (frame.saturating_sub(clip["startFrame"].as_u64().unwrap_or(0)) as f64
                / fps.max(1.0))),
        clip_id: clip_id.to_owned(),
        clip_label: clip["label"].as_str().unwrap_or("Clip").to_owned(),
        native,
        decoder,
        composite: false,
        composite_mode: "none".to_owned(),
        visible_tracks: 0,
        captions_burned: false,
        fallback_reason: None,
    })
}
