pub(crate) fn stabilization_filter(path: &Path, smoothing: u32) -> String {
    let escaped = path
        .to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'");
    format!("vidstabtransform=input='{escaped}':smoothing={smoothing}:crop=black")
}

/// Prepends `vidstabtransform` so it sees the same frames the analysis saw.
pub(crate) fn with_stabilization(
    chain: String,
    index: usize,
    transform: &Path,
    smoothing: u32,
) -> String {
    let prefix = format!("[{index}:v]");
    match chain.strip_prefix(&prefix) {
        Some(rest) => format!(
            "{prefix}{},{rest}",
            stabilization_filter(transform, smoothing)
        ),
        None => chain,
    }
}

/// Validates that the analyzed transform still matches the clip. Trimming,
/// retiming, reversing or overlapping an entrance transition changes which
/// frames reach the filter, so the renderer refuses instead of applying a
/// misaligned stabilization.
pub(crate) fn resolve_stabilization(
    clip: &Value,
    root: &Path,
) -> Result<Option<(PathBuf, u32)>, ProjectError> {
    let Some(stabilization) = clip["stabilization"].as_object() else {
        return Ok(None);
    };
    if clip["kind"].as_str() != Some("video") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización sólo se aplica a clips de video",
        ));
    }
    let source = &clip["source"];
    if stabilization["inFrame"].as_u64() != source["inFrame"].as_u64()
        || stabilization["outFrame"].as_u64() != source["outFrame"].as_u64()
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización no coincide con el recorte actual del clip; volvé a analizarla",
        ));
    }
    let speed = &clip["speed"];
    if speed.is_object()
        && (speed["num"].as_u64().unwrap_or(1) != 1 || speed["den"].as_u64().unwrap_or(1) != 1)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización requiere velocidad 1×; quitá la velocidad o volvé a analizar",
        ));
    }
    if clip["reverse"].as_bool().unwrap_or(false) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización no se puede combinar con reverse",
        ));
    }
    if clip["transitionIn"]
        .as_object()
        .map(|transition| !transition.is_empty())
        .unwrap_or(false)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la estabilización no se puede combinar con la transición de entrada",
        ));
    }
    let relative = stabilization["transformFile"].as_str().unwrap_or("");
    let path = resolve_inside_root(root, relative).map_err(|error| {
        if error.code == ProjectErrorCode::NotFound {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "falta el archivo de estabilización; volvé a analizarla",
            )
        } else {
            error
        }
    })?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "falta el archivo de estabilización; volvé a analizarla",
        ));
    }
    let smoothing = stabilization["smoothing"]
        .as_u64()
        .unwrap_or(10)
        .clamp(1, 60) as u32;
    Ok(Some((path, smoothing)))
}

/// Frame-sampled opacity timeline for `sendcmd`.
///
/// `colorchannelmixer` accepts timeline commands but not expressions, so the
/// ramp is emitted as one command per sampled frame. The count is capped and
/// the step never shrinks below one frame: for a full-range ramp inside the cap
/// each step is smaller than one 8-bit alpha level, so the stair is invisible.
pub(crate) const MAX_OPACITY_COMMANDS: usize = 300;

pub(crate) fn eased_fraction(progress: f64, easing: &str) -> f64 {
    match easing {
        "ease-in" => progress.powi(3),
        "ease-out" => 1.0 - (1.0 - progress).powi(3),
        "ease-in-out" => progress * progress * (3.0 - 2.0 * progress),
        "hold" => 0.0,
        _ => progress,
    }
}
