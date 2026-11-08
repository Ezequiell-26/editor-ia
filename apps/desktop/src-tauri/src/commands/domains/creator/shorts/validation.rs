pub(crate) fn vertical_short_filter() -> String {
    format!(
        "scale={SHORT_WIDTH}:{SHORT_HEIGHT}:force_original_aspect_ratio=increase,crop={SHORT_WIDTH}:{SHORT_HEIGHT},setsar=1"
    )
}

pub(crate) fn validate_short_range(start: f64, end: f64) -> Result<f64, ProjectError> {
    if !start.is_finite() || !end.is_finite() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el rango del short no es numérico",
        ));
    }
    if start < 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el short no puede empezar antes de cero",
        ));
    }
    let duration = end - start;
    if duration < MIN_SECONDS || duration > MAX_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("un short debe durar entre {MIN_SECONDS:.0} y {MAX_SECONDS:.0} segundos"),
        ));
    }
    Ok(duration)
}

pub(crate) fn validate_face_range(start: f64, end: f64) -> Result<f64, ProjectError> {
    if !start.is_finite() || !end.is_finite() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el rango para analizar rostros no es numérico",
        ));
    }
    if start < 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el análisis de rostros no puede empezar antes de cero",
        ));
    }
    let duration = end - start;
    if duration < FACE_MIN_SECONDS || duration > FACE_MAX_SECONDS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!(
                "el tramo para rostros debe durar entre {FACE_MIN_SECONDS:.1} y {FACE_MAX_SECONDS:.0} segundos"
            ),
        ));
    }
    Ok(duration)
}

fn fold_accent(ch: char) -> char {
    match ch {
        'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ë' | 'ê' => 'e',
        'í' | 'ì' | 'ï' | 'î' => 'i',
        'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
        'ú' | 'ù' | 'ü' | 'û' => 'u',
        'ñ' => 'n',
        'ç' => 'c',
        _ => ch,
    }
}

fn safe_stem(value: &str, fallback: &str) -> String {
    let mapped: String = value
        .trim()
        .chars()
        .map(|ch| {
            let lower = ch.to_lowercase().next().unwrap_or(ch);
            let folded = fold_accent(lower);
            if folded.is_ascii_alphanumeric() || folded == '-' || folded == '_' {
                folded
            } else {
                '-'
            }
        })
        .collect();
    let collapsed = mapped
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let trimmed = collapsed.trim_matches('-').trim_matches('_').to_owned();
    if trimmed.is_empty() {
        fallback.to_owned()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn unique_path(dir: &Path, stem: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}-vertical.mp4"));
    let mut index = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-vertical-{index}.mp4"));
        index += 1;
    }
    candidate
}
