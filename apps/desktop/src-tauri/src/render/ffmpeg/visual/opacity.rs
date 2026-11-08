pub(crate) fn opacity_commands(
    keyframes: &[Value],
    fps: f64,
    lead_seconds: f64,
) -> Option<(f64, Vec<(f64, f64)>)> {
    let rate = fps.max(1.0);
    let mut samples: Vec<(f64, f64, SegmentEasing)> = keyframes
        .iter()
        .filter_map(|keyframe| {
            let frame = keyframe["frame"].as_f64()?;
            let value = keyframe["opacity"]
                .as_f64()
                .map(sanitize_filter_number)?
                .clamp(0.0, 1.0);
            Some((frame / rate, value, parse_easing(keyframe)))
        })
        .collect();
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(|a, b| a.0.total_cmp(&b.0));

    let initial = samples[0].1;
    let total_ramp: f64 = samples
        .windows(2)
        .filter(|pair| (pair[1].1 - pair[0].1).abs() > 1e-6)
        .map(|pair| (pair[1].0 - pair[0].0).max(0.0))
        .sum();
    let step = if total_ramp <= 0.0 {
        1.0 / rate
    } else {
        (total_ramp / MAX_OPACITY_COMMANDS as f64).max(1.0 / rate)
    };

    let mut commands: Vec<(f64, f64)> = Vec::new();
    let mut last = initial;
    for pair in samples.windows(2) {
        let (start_t, start_v) = (pair[0].0, pair[0].1);
        let (end_t, end_v) = (pair[1].0, pair[1].1);
        if end_t <= start_t || (end_v - start_v).abs() <= 1e-6 {
            continue;
        }
        let start_easing = &pair[0].2;
        let mut t = start_t + step;
        while t < end_t - 1e-9 && commands.len() < MAX_OPACITY_COMMANDS {
            let progress = ((t - start_t) / (end_t - start_t)).clamp(0.0, 1.0);
            let eased = match start_easing {
                SegmentEasing::Bezier(cp1_x, cp1_y, cp2_x, cp2_y) => {
                    cubic_bezier_progress(progress, *cp1_x, *cp1_y, *cp2_x, *cp2_y)
                }
                SegmentEasing::Preset(easing) => eased_fraction(progress, easing),
            };
            let value = start_v + (end_v - start_v) * eased;
            if (value - last).abs() >= 0.002 {
                commands.push((lead_seconds + t, value));
                last = value;
            }
            t += step;
        }
        if commands.len() < MAX_OPACITY_COMMANDS && (end_v - last).abs() >= 0.002 {
            commands.push((lead_seconds + end_t, end_v));
            last = end_v;
        }
    }

    Some((initial, commands))
}

/// Overlap of an incoming dissolve. It never starts before the timeline and
/// never eats more than half of the clip.
pub(crate) fn transition_lead_seconds(
    clip: &Value,
    fps: f64,
    clip_seconds: f64,
    start_seconds: f64,
) -> f64 {
    let kind = clip["kind"].as_str().unwrap_or("");
    if kind != "video" && kind != "image" && kind != "freeze" {
        return 0.0;
    }
    let frames = clip["transitionIn"]["frames"].as_f64().unwrap_or(0.0);
    if frames <= 0.0 {
        return 0.0;
    }
    (frames / fps.max(1.0)).clamp(
        0.0,
        clip_seconds.max(0.0).min(start_seconds.max(0.0)).min(2.0),
    )
}

/// Even dimensions that preserve aspect ratio and fit inside the profile.
pub(crate) fn even_fit(width: u64, height: u64, max_width: u64, max_height: u64) -> (u32, u32) {
    let width = width.max(2) as f64;
    let height = height.max(2) as f64;
    let scale = (max_width.max(2) as f64 / width)
        .min(max_height.max(2) as f64 / height)
        .max(0.0001);
    let mut out_w = ((width * scale).round() as u64).max(2);
    let mut out_h = ((height * scale).round() as u64).max(2);
    if !out_w.is_multiple_of(2) {
        out_w -= 1;
    }
    if !out_h.is_multiple_of(2) {
        out_h -= 1;
    }
    (out_w.max(2) as u32, out_h.max(2) as u32)
}

/// Fuente TTF para `drawtext`. Se puede pisar con `EDITOR_IA_TEXT_MASK_FONT`.
pub(crate) fn text_mask_font() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("EDITOR_IA_TEXT_MASK_FONT") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }
    [
        "C:/Windows/Fonts/seguisb.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    .into_iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
}

/// `drawtext` usa dos niveles de escape. Para un texto creativo se descartan
/// los caracteres que pueden romper el filtergraph en vez de intentar
/// escaparlos; el resultado sigue siendo legible.
pub(crate) fn drawtext_text(raw: &str) -> String {
    let mut cleaned: String = raw
        .chars()
        .map(|character| match character {
            '\'' => '’',
            '\\' | ':' | '%' | ',' | '[' | ']' | ';' => ' ',
            character if character.is_control() => ' ',
            character => character,
        })
        .collect();
    while cleaned.contains("  ") {
        cleaned = cleaned.replace("  ", " ");
    }
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "TEXTO".to_owned()
    } else {
        trimmed.chars().take(200).collect()
    }
}
