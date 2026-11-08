pub(crate) fn normalize_channel_url(raw: &str) -> Result<String, ProjectError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "pegá la URL del canal de YouTube",
        ));
    }
    let candidate = if trimmed.starts_with('@') {
        format!("https://www.youtube.com/{trimmed}")
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_owned()
    } else if trimmed.contains("youtube.com") || trimmed.contains("youtu.be") {
        format!("https://{trimmed}")
    } else {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL debe ser de youtube.com",
        ));
    };
    let lower = candidate.to_ascii_lowercase();
    if !lower.contains("youtube.com/") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL debe ser de un canal de youtube.com",
        ));
    }
    if lower.contains("watch?") || lower.contains("youtu.be/") || lower.contains("/shorts/") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "pegá la URL del canal, no la de un video",
        ));
    }
    Ok(candidate)
}

fn parse_u64(value: &serde_json::Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
        .or_else(|| value.as_f64().map(|number| number.max(0.0) as u64))
}

fn parse_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_u64().map(|number| number as f64))
}

fn text_of(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_owned())
        .filter(|item| !item.is_empty())
}

fn best_thumbnail(value: &serde_json::Value) -> Option<String> {
    if let Some(thumbnail) = text_of(value, "thumbnail") {
        return Some(thumbnail);
    }
    let mut best: Option<(u64, String)> = None;
    for thumb in value
        .get("thumbnails")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
    {
        let Some(url) = thumb.get("url").and_then(|item| item.as_str()) else {
            continue;
        };
        let width = parse_u64(&thumb["width"]).unwrap_or(0);
        if best
            .as_ref()
            .map(|(known, _)| width > *known)
            .unwrap_or(true)
        {
            best = Some((width, url.to_owned()));
        }
    }
    best.map(|(_, url)| url)
}

fn normalize_date(value: &str) -> Option<String> {
    if value.len() != 8 || !value.chars().all(|ch| ch.is_ascii_digit()) {
        return None;
    }
    Some(format!(
        "{}-{}-{}",
        &value[0..4],
        &value[4..6],
        &value[6..8]
    ))
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let yoe = year - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    (year + i64::from(month <= 2), month, day)
}

fn weekday_name(epoch: i64) -> String {
    const NAMES: [&str; 7] = [
        "lunes",
        "martes",
        "miércoles",
        "jueves",
        "viernes",
        "sábado",
        "domingo",
    ];
    let days = epoch.div_euclid(86_400);
    let index = (days + 3).rem_euclid(7) as usize;
    NAMES[index].to_owned()
}

fn date_from_epoch(epoch: i64) -> String {
    let (year, month, day) = civil_from_days(epoch.div_euclid(86_400));
    format!("{year:04}-{month:02}-{day:02}")
}

fn epoch_from_upload_date(value: &str) -> Option<i64> {
    let normalized = if value.len() == 10 && value.as_bytes().get(4) == Some(&b'-') {
        value.to_owned()
    } else {
        normalize_date(value)?
    };
    let year: i64 = normalized[0..4].parse().ok()?;
    let month: i64 = normalized[5..7].parse().ok()?;
    let day: i64 = normalized[8..10].parse().ok()?;
    Some(days_from_civil(year, month, day) * 86_400)
}

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}
