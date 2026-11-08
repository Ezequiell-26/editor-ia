/// Dobla un video con las cues ya traducidas. Reemplaza el audio original y
/// conserva el video sin re-encodear.
#[tauri::command]
pub async fn synthesize_dub(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SynthesizeDubRequest,
) -> Result<DubResult, ProjectError> {
    let language = normalize_language(&request.language).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el idioma del doblaje no está soportado",
        )
    })?;
    let cues = validate_cues(&request.cues)?;
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para doblar ya no está en el proyecto",
        ));
    }
    let output_dir = PathBuf::from(request.output_dir.trim());
    if output_dir.as_os_str().is_empty() || !output_dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta de destino del doblaje no existe",
        ));
    }
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, powershell) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe), Some(powershell)) = (ffmpeg, ffprobe, powershell) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg, FFprobe y PowerShell son necesarios para doblar",
        ));
    };
    let voices = sapi_voices(&state).await?;
    let voice = match request
        .voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(requested) => voices
            .iter()
            .find(|voice| voice.name == requested)
            .cloned()
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::NotFound,
                    "la voz elegida no está instalada en Windows",
                )
            })?,
        None => pick_voice(&voices, language)?,
    };
    let bed_volume = match request.bed_volume {
        Some(volume) if volume.is_finite() && (0.0..=1.0).contains(&volume) => Some(volume),
        Some(_) => {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el volumen del audio original debe estar entre 0 y 1",
            ));
        }
        None => None,
    };
    let source_duration = probe_video(&ffprobe, &input).2;
    let end_seconds = dub_end_seconds(&cues, request.end_seconds, source_duration);
    synthesize_dub_file(
        Some(&app),
        &powershell,
        &ffmpeg,
        &ffprobe,
        &input,
        &output_dir,
        language,
        &voice.name,
        &cues,
        end_seconds,
        bed_volume,
    )
}
