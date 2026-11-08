#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceTrackRequest {
    pub path: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceTrackResult {
    pub model: String,
    pub duration_seconds: f64,
    pub detections: u32,
    pub samples: Vec<FaceSample>,
    pub track: Vec<face::FaceTrackPoint>,
    pub scaled_width: u32,
    pub scaled_height: u32,
    /// Expresiones listas para `crop` en FFmpeg; si no hay rostros, centran.
    pub x_expression: String,
    pub y_expression: String,
}

/// Analiza rostros de un rango sin exportar video. Es la API que usa el
/// smart reframe y la que puede consumir una preview futura.
#[tauri::command]
pub async fn analyze_face_track(
    app: AppHandle,
    state: State<'_, AppState>,
    request: FaceTrackRequest,
) -> Result<FaceTrackResult, ProjectError> {
    let session = state.require_session()?;
    let input = resolve_inside_root(&session.root, &request.path)?;
    if !input.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video para analizar rostros ya no está en el proyecto",
        ));
    }
    let duration = validate_face_range(request.start_seconds, request.end_seconds)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no está disponible para analizar rostros",
        ));
    };
    let spec = model_by_id("seeta-face").ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el catálogo no tiene el modelo de rostros",
        )
    })?;
    if !is_model_downloaded(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "descargá el modelo de rostros (1,2 MB) en Ajustes → Capacidades",
        ));
    }
    if !verify_model_hash(&state, spec) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el modelo de rostros no coincide con su checksum; volvé a descargarlo",
        ));
    }
    let model_path = spec
        .files
        .first()
        .map(|file| model_file(&state, spec, file))
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el modelo de rostros no declara archivos",
            )
        })?;
    let samples = extract_face_samples(
        Some(&app),
        &ffmpeg,
        &model_path,
        &input,
        request.start_seconds,
        duration,
    )?;
    let track = face::smooth_track(&samples);
    let (source_width, source_height, _) = probe_result(ffprobe.as_deref(), &input, duration);
    let (scaled_width, scaled_height) = face::scaled_cover(source_width, source_height);
    let x_expression = face::crop_expression(
        &track,
        f64::from(scaled_width),
        f64::from(scaled_height),
        f64::from(SHORT_WIDTH),
        f64::from(SHORT_HEIGHT),
        'x',
    );
    let y_expression = face::crop_expression(
        &track,
        f64::from(scaled_width),
        f64::from(scaled_height),
        f64::from(SHORT_WIDTH),
        f64::from(SHORT_HEIGHT),
        'y',
    );
    Ok(FaceTrackResult {
        model: "seeta-face".to_owned(),
        duration_seconds: duration,
        detections: samples.len() as u32,
        samples,
        track,
        scaled_width,
        scaled_height,
        x_expression,
        y_expression,
    })
}
