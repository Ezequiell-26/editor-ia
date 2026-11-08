pub(crate) fn animation_duration_seconds(
    animation: &Value,
    clip_seconds: f64,
    fps: f64,
) -> Option<f64> {
    let kind = animation["type"].as_str()?.trim();
    if kind.is_empty() {
        return None;
    }
    let requested = animation["durationFrames"].as_u64().unwrap_or(15).max(1) as f64;
    let frames = requested.min((clip_seconds * fps).max(1.0));
    Some((frames / fps.max(1.0)).clamp(1.0 / fps.max(1.0), clip_seconds.max(1.0 / fps.max(1.0))))
}

/// `(progress expression, type)` for one side of a clip animation. Progress is
/// clamped to 0..1 and evaluated against the global output clock, matching the
/// overlay filter's `t`.
pub(crate) fn animation_progress(
    animation: &Value,
    side: &str,
    start_seconds: f64,
    clip_seconds: f64,
    fps: f64,
) -> Option<(String, String)> {
    let kind = animation["type"].as_str()?.trim().to_owned();
    if kind.is_empty() {
        return None;
    }
    let duration = animation_duration_seconds(animation, clip_seconds, fps)?;
    let from = if side == "in" {
        start_seconds
    } else {
        (start_seconds + clip_seconds - duration).max(start_seconds)
    };
    Some((format!("min(max((t-{from:.6})/{duration:.6},0),1)"), kind))
}

/// Extra overlay displacement caused by slide animations. Entrance slides move
/// towards the named direction; exit slides keep travelling the same way.
pub(crate) fn animation_overlay_terms(
    clip: &Value,
    start_seconds: f64,
    clip_seconds: f64,
    fps: f64,
) -> (Option<String>, Option<String>) {
    let mut x_terms: Vec<String> = Vec::new();
    let mut y_terms: Vec<String> = Vec::new();
    if let Some((progress, kind)) =
        animation_progress(&clip["animationIn"], "in", start_seconds, clip_seconds, fps)
    {
        match kind.as_str() {
            "slide-left" => x_terms.push(format!("W*(1-({progress}))")),
            "slide-right" => x_terms.push(format!("-W*(1-({progress}))")),
            "slide-up" => y_terms.push(format!("H*(1-({progress}))")),
            "slide-down" => y_terms.push(format!("-H*(1-({progress}))")),
            _ => {}
        }
    }
    if let Some((progress, kind)) = animation_progress(
        &clip["animationOut"],
        "out",
        start_seconds,
        clip_seconds,
        fps,
    ) {
        match kind.as_str() {
            "slide-left" => x_terms.push(format!("-W*({progress})")),
            "slide-right" => x_terms.push(format!("W*({progress})")),
            "slide-up" => y_terms.push(format!("-H*({progress})")),
            "slide-down" => y_terms.push(format!("H*({progress})")),
            _ => {}
        }
    }
    let join = |terms: Vec<String>| {
        if terms.is_empty() {
            None
        } else {
            Some(terms.join("+"))
        }
    };
    (join(x_terms), join(y_terms))
}

pub(crate) fn animation_fade_filters(
    clip: &Value,
    lead_seconds: f64,
    clip_seconds: f64,
    total_seconds: f64,
    fps: f64,
) -> Vec<String> {
    let mut filters = Vec::new();
    if clip["animationIn"]["type"].as_str() == Some("fade") {
        if let Some(duration) = animation_duration_seconds(&clip["animationIn"], clip_seconds, fps)
        {
            filters.push(format!(
                "fade=t=in:st={:.6}:d={:.6}:alpha=1",
                lead_seconds.max(0.0),
                duration
            ));
        }
    }
    if clip["animationOut"]["type"].as_str() == Some("fade") {
        if let Some(duration) = animation_duration_seconds(&clip["animationOut"], clip_seconds, fps)
        {
            filters.push(format!(
                "fade=t=out:st={:.6}:d={:.6}:alpha=1",
                (total_seconds - duration).max(0.0),
                duration
            ));
        }
    }
    filters
}

pub(crate) fn lut_filter(path: &Path) -> String {
    let escaped = path
        .to_string_lossy()
        .replace('\\', "/")
        .replace(':', "\\:");
    format!("lut3d=file='{escaped}'")
}

/// Applies an optional mix between the original chain and its LUT-graded
/// branch. A full-intensity LUT stays a single appended filter; partial
/// intensity splits the stream and blends both branches with the same alpha
/// so the grade keeps the clip's masks and opacity untouched.
pub(crate) fn apply_lut_to_chain(chain: String, label: &str, lut: &Path, intensity: f64) -> String {
    let intensity = if intensity.is_finite() {
        intensity.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let output = format!("[{label}]");
    if intensity <= 0.001 {
        return chain;
    }
    if intensity >= 0.999 {
        return match chain.rfind(&output) {
            Some(position) => format!("{},{}[{}]", &chain[..position], lut_filter(lut), label),
            None => chain,
        };
    }
    let Some(prefix) = chain.strip_suffix(&output) else {
        return chain;
    };
    // `blend` weights the first input, so the original keeps 1 - intensity.
    let opacity = 1.0 - intensity;
    format!(
        "{prefix},format=rgba,split=2[{label}src][{label}lut];\
         [{label}lut]{}[{label}graded];\
         [{label}src][{label}graded]blend=all_mode=normal:all_opacity={opacity:.4}[{label}]",
        lut_filter(lut)
    )
}

/// Añade un halo tipo bloom: separa las zonas claras, las desenfoca y las
/// vuelve a mezclar con `screen`. El canal alfa del clip se conserva en la
/// rama base; el halo se calcula sobre el resultado ya graduado.
pub(crate) fn apply_glow_to_chain(chain: String, label: &str, effects: &Value) -> String {
    let Some(glow) = effects.get("glow").filter(|value| value.is_object()) else {
        return chain;
    };
    let intensity = number(glow, "intensity").unwrap_or(0.6).clamp(0.0, 1.0);
    if intensity <= 0.001 {
        return chain;
    }
    let radius = number(glow, "radius").unwrap_or(18.0).clamp(1.0, 80.0);
    let threshold = number(glow, "threshold").unwrap_or(0.55).clamp(0.0, 0.95);
    let output = format!("[{label}]");
    let Some(prefix) = chain.strip_suffix(&output) else {
        return chain;
    };
    format!(
        "{prefix},format=rgba,split=3[{label}base][{label}glow][{label}alpha];\
         [{label}alpha]alphaextract[{label}amask];\
         [{label}glow]colorlevels=rimin={threshold:.4}:gimin={threshold:.4}:bimin={threshold:.4},gblur=sigma={radius:.3}[{label}blur];\
         [{label}base][{label}blur]blend=all_mode=screen:all_opacity={intensity:.4}[{label}blended];\
         [{label}blended][{label}amask]alphamerge,format=rgba[{label}]"
    )
}

/// Número con hasta cuatro decimales y sin ceros de cola. `-0` se normaliza a
/// `0` porque FFmpeg rechaza algunos valores negativos cero en expresiones.
pub(crate) fn trim_number(value: f64) -> String {
    if !value.is_finite() {
        return "0".to_owned();
    }
    let mut text = format!("{value:.4}");
    if text.contains('.') {
        while text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    if text == "-0" {
        return "0".to_owned();
    }
    text
}
