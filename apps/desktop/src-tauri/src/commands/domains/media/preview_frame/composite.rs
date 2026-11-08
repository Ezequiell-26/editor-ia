fn composite_frame(
    ffmpeg: &Path,
    ffprobe: &Path,
    root: &Path,
    project: &Value,
    clip_id: &str,
    frame: u64,
    output_dir: &Path,
) -> Result<PreviewFrameResult, ProjectError> {
    // Un clip gráfico fuera del frame no impide componer; si está activo, la
    // ventana lo rechaza y el comando cae al preview de clip.
    let total = timeline_frames(project);
    if total == 0 || frame >= total {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el playhead está fuera de la timeline; se muestra el clip seleccionado",
        ));
    }
    let silent = preview_copy(project);
    let debug = std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some();
    let (mode, mut result) = match window_project(&silent, frame) {
        Ok(window) => {
            let graphic_omitted = window["previewGraphicOmitted"].as_bool() == Some(true);
            match render_composite_project(ffmpeg, ffprobe, root, &window, clip_id, 0, output_dir) {
                Ok(mut fast) => {
                    if debug {
                        eprintln!("preview compuesto: ventana de un frame");
                    }
                    if graphic_omitted {
                        fast.fallback_reason =
                            Some("clip gráfico omitido: falta el plan de motion".to_owned());
                    }
                    ("window", fast)
                }
                Err(error) => {
                    if debug {
                        eprintln!(
                            "preview ventana falló: {}; uso el compuesto completo",
                            error.message
                        );
                    }
                    (
                        "full",
                        render_composite_project(
                            ffmpeg, ffprobe, root, &silent, clip_id, frame, output_dir,
                        )?,
                    )
                }
            }
        }
        Err(error) => {
            if debug {
                eprintln!(
                    "preview ventana no aplica: {}; uso el compuesto completo",
                    error.message
                );
            }
            (
                "full",
                render_composite_project(
                    ffmpeg, ffprobe, root, &silent, clip_id, frame, output_dir,
                )?,
            )
        }
    };
    result.frame = frame;
    result.time_seconds = frame as f64 / project_fps(project);
    result.composite_mode = mode.to_owned();
    let (visible_tracks, captions_burned) = composite_metadata(project, frame);
    result.visible_tracks = visible_tracks;
    result.captions_burned = captions_burned;
    if let Some(label) = project["timeline"]["clips"]
        .as_array()
        .and_then(|clips| {
            clips
                .iter()
                .find(|clip| clip["id"].as_str() == Some(clip_id))
        })
        .and_then(|clip| clip["label"].as_str())
    {
        result.clip_label = label.to_owned();
    }
    Ok(result)
}

fn render_composite_project(
    ffmpeg: &Path,
    ffprobe: &Path,
    root: &Path,
    project: &Value,
    clip_id: &str,
    frame: u64,
    output_dir: &Path,
) -> Result<PreviewFrameResult, ProjectError> {
    if has_visible_graphic_clips(project) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el compuesto todavía no incluye clips gráficos; se muestra el clip seleccionado",
        ));
    }
    let profile = profile_for(project)?;
    let total = timeline_frames(project);
    if total == 0 || frame >= total {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el playhead está fuera de la timeline; se muestra el clip seleccionado",
        ));
    }
    let fps = profile.fps();
    let time = frame as f64 / fps;
    let temp_dir = output_dir.join(format!("composite-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo preparar el compuesto: {error}").as_str(),
        )
    })?;
    let output = output_dir.join(format!("composite-{}.png", Uuid::new_v4()));
    let result = (|| -> Result<PreviewFrameResult, ProjectError> {
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root,
            profile: &profile,
            output_path: &output,
            include_captions: true,
            temp_dir: &temp_dir,
            ffprobe,
            motion_ass: None,
        })?;
        let args = frame_args_from_plan(&plan.args, time, &output).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el plan del compuesto no tiene grafo de video",
            )
        })?;
        let mut command = Command::new(ffmpeg);
        command
            .args(&args)
            .current_dir(&temp_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut command);
        if std::env::var_os("EDITOR_IA_PREVIEW_DEBUG").is_some() {
            eprintln!("preview compuesto: {command:?}");
        }
        let finished = command.output().map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo iniciar FFmpeg para el compuesto: {error}").as_str(),
            )
        })?;
        if !finished.status.success() || !output.is_file() {
            let detail = String::from_utf8_lossy(&finished.stderr);
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
                    "FFmpeg no pudo componer el frame: {}",
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
            ProjectError::message(
                ProjectErrorCode::InvalidProviderResponse,
                "el compuesto generado no es una imagen válida",
            )
        })?;
        let clip = project["timeline"]["clips"]
            .as_array()
            .and_then(|clips| {
                clips
                    .iter()
                    .find(|clip| clip["id"].as_str() == Some(clip_id))
            })
            .cloned();
        let (visible_tracks, captions_burned) = composite_metadata(project, frame);
        Ok(PreviewFrameResult {
            path: output.to_string_lossy().into_owned(),
            width,
            height,
            frame,
            time_seconds: time,
            clip_id: clip_id.to_owned(),
            clip_label: clip
                .as_ref()
                .and_then(|clip| clip["label"].as_str())
                .unwrap_or("Composición")
                .to_owned(),
            native: false,
            decoder: "ffmpeg".to_owned(),
            composite: true,
            composite_mode: "full".to_owned(),
            visible_tracks,
            captions_burned,
            fallback_reason: None,
        })
    })();
    let _ = std::fs::remove_dir_all(&temp_dir);
    if result.is_err() {
        let _ = std::fs::remove_file(&output);
    }
    result
}
