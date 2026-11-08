pub(crate) fn normalize_language(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "es" | "es-ar" | "es-mx" | "es-es" => Some("es"),
        "en" | "en-us" | "en-gb" => Some("en"),
        "pt" | "pt-br" | "pt-pt" => Some("pt"),
        "fr" | "fr-fr" => Some("fr"),
        "de" | "de-de" => Some("de"),
        "it" | "it-it" => Some("it"),
        "zh" | "zh-cn" | "zh-tw" => Some("zh"),
        "hi" | "hi-in" => Some("hi"),
        "ar" | "ar-sa" => Some("ar"),
        "bn" | "bn-bd" | "bn-in" => Some("bn"),
        "ru" | "ru-ru" => Some("ru"),
        _ => None,
    }
}

fn language_label(code: &str) -> String {
    match code {
        "es" => "español",
        "en" => "inglés",
        "pt" => "portugués",
        "fr" => "francés",
        "de" => "alemán",
        "it" => "italiano",
        "zh" => "chino",
        "hi" => "hindi",
        "ar" => "árabe",
        "bn" => "bengalí",
        "ru" => "ruso",
        _ => code,
    }
    .to_owned()
}

/// Valida, normaliza y ordena las cues. Rechaza solapamientos grandes para no
/// mezclar dos voces hablando a la vez.
pub(crate) fn validate_cues(cues: &[DubCue]) -> Result<Vec<DubCue>, ProjectError> {
    if cues.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "no hay subtítulos para doblar",
        ));
    }
    if cues.len() > MAX_CUES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("el doblaje admite hasta {MAX_CUES} subtítulos por corrida"),
        ));
    }
    let mut total = 0usize;
    let mut cleaned = Vec::with_capacity(cues.len());
    for (index, cue) in cues.iter().enumerate() {
        let text = cue.text.replace('\n', " ").trim().to_owned();
        if text.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el subtítulo {} llegó vacío", index + 1),
            ));
        }
        if text.chars().count() > MAX_CUE_CHARS {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!(
                    "el subtítulo {} supera los {MAX_CUE_CHARS} caracteres",
                    index + 1
                ),
            ));
        }
        total += text.chars().count();
        if !cue.start_seconds.is_finite()
            || !cue.end_seconds.is_finite()
            || cue.start_seconds < 0.0
            || cue.end_seconds <= cue.start_seconds
        {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el subtítulo {} tiene tiempos inválidos", index + 1),
            ));
        }
        if cue.end_seconds > MAX_DURATION_SECONDS {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!(
                    "el subtítulo {} termina después de los {MAX_DURATION_SECONDS:.0} s",
                    index + 1
                ),
            ));
        }
        cleaned.push(DubCue {
            start_seconds: cue.start_seconds,
            end_seconds: cue.end_seconds,
            text,
        });
    }
    if total > MAX_TOTAL_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("el doblaje supera los {MAX_TOTAL_CHARS} caracteres"),
        ));
    }
    cleaned.sort_by(|a, b| a.start_seconds.total_cmp(&b.start_seconds));
    for pair in cleaned.windows(2) {
        let previous = &pair[0];
        let next = &pair[1];
        if next.start_seconds < previous.end_seconds - 0.10 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "hay subtítulos solapados; separalos antes de doblar",
            ));
        }
    }
    Ok(cleaned)
}

pub(crate) fn dub_end_seconds(
    cues: &[DubCue],
    requested: Option<f64>,
    source_duration: Option<f64>,
) -> f64 {
    let last = cues
        .iter()
        .map(|cue| cue.end_seconds)
        .fold(0.0_f64, f64::max);
    let mut end = requested
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(last + 0.4)
        .max(last + 0.05);
    if let Some(source) = source_duration.filter(|value| value.is_finite() && *value > 0.0) {
        end = end.min(source);
    }
    end.max(0.2)
}
