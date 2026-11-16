/// Genera un PNG del frame pedido con el renderer real. Por defecto compone
/// todas las pistas visibles, el look y los subtítulos; si eso no es posible,
/// devuelve el clip seleccionado e informa el motivo en `fallbackReason`.
#[tauri::command]
pub async fn render_preview_frame(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PreviewFrameRequest,
) -> Result<PreviewFrameResult, ProjectError> {
    let session = state.require_session()?;
    let root = session.root.clone();
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para el preview real",
        ));
    };
    let ffprobe = ffprobe.unwrap_or_else(|| PathBuf::from("ffprobe"));
    let output_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo resolver la caché del preview",
            )
        })?
        .join("preview");
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo crear la caché del preview: {error}").as_str(),
        )
    })?;
    let project = request.project;
    let clip_id = request.clip_id;
    let frame = request.frame;
    let native = request.native;
    let wants_composite = request.composite.unwrap_or(true) && !native;
    // Firma del frame (prerender/agendador): misma firma → mismo PNG.
    let signature = frame_signature(&project, &clip_id, frame, native, wants_composite);
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(cached) = cache_lookup(&output_dir, &signature) {
            return Ok(cached);
        }
        let mut fallback_reason = None;
        let rendered = if wants_composite {
            match composite_frame(
                &ffmpeg,
                &ffprobe,
                &root,
                &project,
                &clip_id,
                frame,
                &output_dir,
            ) {
                Ok(result) => Some(result),
                Err(error) => {
                    fallback_reason = Some(error.message);
                    None
                }
            }
        } else {
            None
        };
        let mut result = match rendered {
            Some(result) => result,
            None => {
                let mut result = render_frame(
                    &ffmpeg,
                    &root,
                    &project,
                    &clip_id,
                    frame,
                    native,
                    &output_dir,
                )?;
                result.fallback_reason = fallback_reason;
                result
            }
        };
        result = cache_store(&output_dir, &signature, &result);
        Ok(result)
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("el preview real se interrumpió: {error}").as_str(),
        )
    })?
}
