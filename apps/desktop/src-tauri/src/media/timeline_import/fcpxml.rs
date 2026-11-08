pub(crate) fn parse_otio(text: &str, project_fps: f64) -> Result<ParsedTimeline, ProjectError> {
    let root: Value = serde_json::from_str(text).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("el OTIO no es JSON válido: {error}").as_str(),
        )
    })?;
    let schema = root["OTIO_SCHEMA"].as_str().unwrap_or("");
    if !schema.starts_with("Timeline") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el JSON no declara una Timeline OTIO",
        ));
    }
    let mut parsed = ParsedTimeline {
        fps: root["metadata"]["editor_ia"]["fps"].as_f64(),
        ..Default::default()
    };
    collect_otio(&root["tracks"], project_fps, &mut parsed);
    Ok(parsed)
}

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let rest = a % b;
        a = b;
        b = rest;
    }
    a.max(1)
}

/// Aproxima un retime a una fracción simple (2× → 2/1, 1,5× → 3/2).
fn rational_speed(value: f64) -> Option<(u32, u32)> {
    if !value.is_finite() || !(0.01..=100.0).contains(&value) {
        return None;
    }
    let numerator = (value * 1000.0).round().max(1.0) as u32;
    let divisor = gcd(numerator, 1000);
    Some((numerator / divisor, 1000 / divisor))
}

/// Lee el retime de un clip OTIO (`LinearTimeWarp.1`) y avisa de los efectos
/// que el importador no puede representar, para no perderlos en silencio.
fn otio_speed(child: &Value) -> (u32, u32, Vec<String>) {
    let label = child["name"].as_str().unwrap_or("clip");
    let mut speed = (1u32, 1u32);
    let mut warnings = Vec::new();
    for effect in child["effects"].as_array().into_iter().flatten() {
        let schema = effect["OTIO_SCHEMA"].as_str().unwrap_or("");
        if schema.starts_with("LinearTimeWarp") {
            match effect["time_scalar"].as_f64().and_then(rational_speed) {
                Some(pair) => speed = pair,
                None => warnings.push(format!(
                    "OTIO: {label} tiene un time warp inválido; se importa a 100%"
                )),
            }
        } else if !schema.is_empty() {
            warnings.push(format!("OTIO: el efecto {schema} de {label} no se importa"));
        }
    }
    (speed.0, speed.1, warnings)
}

fn collect_otio(value: &Value, project_fps: f64, parsed: &mut ParsedTimeline) {
    let schema = value["OTIO_SCHEMA"].as_str().unwrap_or("");
    if schema.starts_with("Timeline") {
        collect_otio(&value["tracks"], project_fps, parsed);
        return;
    }
    if schema.starts_with("Stack") {
        for child in value["children"].as_array().into_iter().flatten() {
            collect_otio(child, project_fps, parsed);
        }
        return;
    }
    if !schema.starts_with("Track") {
        return;
    }
    let kind = if value["kind"].as_str() == Some("Audio") {
        TrackKind::Audio
    } else {
        TrackKind::Video
    };
    parsed.tracks.push(ParsedTrack {
        label: value["name"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| "Pista OTIO".to_owned()),
        kind,
    });
    let track_index = parsed.tracks.len() - 1;
    let mut cursor = 0.0;
    for child in value["children"].as_array().into_iter().flatten() {
        let child_schema = child["OTIO_SCHEMA"].as_str().unwrap_or("");
        if child_schema.starts_with("Gap") {
            if let Some(duration) = otio_duration(child, project_fps) {
                cursor += duration;
            }
            continue;
        }
        if child_schema.starts_with("Transition") {
            parsed
                .warnings
                .push("OTIO: una transición se importó como corte".to_owned());
            continue;
        }
        if !child_schema.starts_with("Clip") {
            if child_schema.starts_with("Stack") {
                parsed
                    .warnings
                    .push("OTIO: un stack anidado no se importó".to_owned());
            }
            continue;
        }
        let Some((source_in, duration)) = otio_range(child, project_fps) else {
            parsed
                .warnings
                .push("OTIO: un clip no declara source_range".to_owned());
            continue;
        };
        if duration <= 0.0 {
            continue;
        }
        let label = child["name"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Clip OTIO")
            .to_owned();
        let relative = child["media_reference"]["metadata"]["editor_ia"]["relative_path"]
            .as_str()
            .map(str::to_owned);
        let target = child["media_reference"]["target_url"]
            .as_str()
            .map(str::to_owned);
        let media = relative.or_else(|| target.clone());
        let (speed_num, speed_den, mut speed_warnings) = otio_speed(child);
        parsed.warnings.append(&mut speed_warnings);
        let timeline_duration = duration * speed_den as f64 / speed_num.max(1) as f64;
        parsed.clips.push(ParsedClip {
            track_index,
            label: label.clone(),
            start_seconds: cursor,
            source_in_seconds: source_in,
            duration_seconds: timeline_duration,
            speed_num,
            speed_den,
            media,
            media_hint: Some(label),
        });
        cursor += timeline_duration;
    }
}

fn otio_duration(value: &Value, project_fps: f64) -> Option<f64> {
    otio_time(&value["source_range"]["duration"], project_fps)
}

fn otio_range(value: &Value, project_fps: f64) -> Option<(f64, f64)> {
    let duration = otio_duration(value, project_fps)?;
    let start = otio_time(&value["source_range"]["start_time"], project_fps).unwrap_or(0.0);
    Some((start, duration))
}

fn otio_time(value: &Value, project_fps: f64) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    let amount = value["value"].as_f64()?;
    let rate = value["rate"]
        .as_f64()
        .filter(|rate| *rate > 0.0)
        .unwrap_or(project_fps.max(1.0));
    Some(amount / rate)
}
