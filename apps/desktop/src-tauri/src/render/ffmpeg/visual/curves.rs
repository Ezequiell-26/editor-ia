/// Builds `curves=master='x/y ...':red='...'` from the clip's custom points.
/// Points are sorted and clamped so a hand-edited project cannot inject filter
/// syntax or produce an unordered set.
pub(crate) fn custom_curves_filter(effects: &Value) -> Option<String> {
    let curves = effects.get("curves")?.as_object()?;
    let mut parts: Vec<String> = Vec::new();
    for channel in ["master", "red", "green", "blue"] {
        let Some(points) = curves.get(channel).and_then(Value::as_array) else {
            continue;
        };
        let mut parsed: Vec<(f64, f64)> = points
            .iter()
            .filter_map(|point| {
                let x = point.get("x")?.as_f64()?;
                let y = point.get("y")?.as_f64()?;
                if !x.is_finite() || !y.is_finite() {
                    return None;
                }
                Some((x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)))
            })
            .collect();
        parsed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        parsed.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-9);
        if parsed.len() < 2
            || (parsed[0].0 - 0.0).abs() > 1e-9
            || (parsed[parsed.len() - 1].0 - 1.0).abs() > 1e-9
        {
            continue;
        }
        let formatted = parsed
            .iter()
            .map(|(x, y)| format!("{x:.4}/{y:.4}"))
            .collect::<Vec<_>>()
            .join(" ");
        parts.push(format!("{channel}='{formatted}'"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(format!("curves={}", parts.join(":")))
    }
}

/// Builds a master tone curve for shadows, highlights and a filmic fade. The
/// points are fixed and every value is clamped, so no user text reaches the
/// filter syntax. Applied before any creative curve or preset.
pub(crate) fn tone_curve_filter(effects: &Value) -> Option<String> {
    let shadows = number(effects, "shadows").unwrap_or(0.0).clamp(-1.0, 1.0);
    let highlights = number(effects, "highlights")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let fade = number(effects, "fade").unwrap_or(0.0).clamp(0.0, 1.0);
    if shadows.abs() <= 0.001 && highlights.abs() <= 0.001 && fade <= 0.001 {
        return None;
    }
    let points = [
        (0.0, (fade * 0.10).clamp(0.0, 1.0)),
        (0.25, (0.25 + shadows * 0.12 + fade * 0.05).clamp(0.0, 1.0)),
        (0.5, (0.5 + fade * 0.02).clamp(0.0, 1.0)),
        (
            0.75,
            (0.75 + highlights * 0.12 - fade * 0.02).clamp(0.0, 1.0),
        ),
        (1.0, (1.0 - fade * 0.05).clamp(0.0, 1.0)),
    ];
    let formatted = points
        .iter()
        .map(|(x, y)| format!("{x:.4}/{y:.4}"))
        .collect::<Vec<_>>()
        .join(" ");
    Some(format!("curves=master='{formatted}'"))
}

/// Builds the FFmpeg chain for a grade. `enable` is appended to every filter so
/// an adjustment layer only exists inside its timeline window.
pub(crate) fn grade_filters(
    effects: &Value,
    root: &Path,
    enable: Option<(f64, f64)>,
) -> Result<Vec<String>, ProjectError> {
    if !effects.is_object() {
        return Ok(Vec::new());
    }
    let brightness = number(effects, "brightness")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let contrast = number(effects, "contrast").unwrap_or(1.0).clamp(0.0, 3.0);
    let saturation = number(effects, "saturation").unwrap_or(1.0).clamp(0.0, 3.0);
    let temperature = number(effects, "temperature")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let lift = &effects["lift"];
    let gamma = &effects["gamma"];
    let gain = &effects["gain"];
    // Cuarta rueda de Primaries (DaVinci): balance de medios tonos.
    let offset = &effects["offset"];
    let lift_rgb = [
        number(lift, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(lift, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(lift, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let gamma_rgb = [
        number(gamma, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gamma, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gamma, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let gain_rgb = [
        number(gain, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gain, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(gain, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let offset_rgb = [
        number(offset, "r").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(offset, "g").unwrap_or(0.0).clamp(-1.0, 1.0),
        number(offset, "b").unwrap_or(0.0).clamp(-1.0, 1.0),
    ];
    let mut filters = Vec::new();
    if brightness.abs() > 0.001
        || (contrast - 1.0).abs() > 0.001
        || (saturation - 1.0).abs() > 0.001
        || gamma_rgb.iter().any(|value| value.abs() > 0.001)
    {
        let mut eq = format!(
            "eq=brightness={brightness:.4}:contrast={contrast:.4}:saturation={saturation:.4}"
        );
        if gamma_rgb.iter().any(|value| value.abs() > 0.001) {
            eq.push_str(&format!(
                ":gamma_r={:.4}:gamma_g={:.4}:gamma_b={:.4}",
                (1.0 + gamma_rgb[0]).clamp(0.1, 10.0),
                (1.0 + gamma_rgb[1]).clamp(0.1, 10.0),
                (1.0 + gamma_rgb[2]).clamp(0.1, 10.0)
            ));
        }
        filters.push(eq);
    }
    if lift_rgb.iter().any(|value| value.abs() > 0.001)
        || gain_rgb.iter().any(|value| value.abs() > 0.001)
        || offset_rgb.iter().any(|value| value.abs() > 0.001)
    {
        filters.push(format!(
            "colorbalance=rs={:.4}:gs={:.4}:bs={:.4}:rm={:.4}:gm={:.4}:bm={:.4}:rh={:.4}:gh={:.4}:bh={:.4}",
            lift_rgb[0],
            lift_rgb[1],
            lift_rgb[2],
            offset_rgb[0],
            offset_rgb[1],
            offset_rgb[2],
            gain_rgb[0],
            gain_rgb[1],
            gain_rgb[2]
        ));
    }
    if temperature.abs() > 0.001 {
        filters.push(format!(
            "colorbalance=rs={:.4}:bs={:.4}",
            temperature * 0.25,
            -temperature * 0.25
        ));
    }
    let hue_rotate = number(effects, "hueRotateDeg")
        .unwrap_or(0.0)
        .clamp(-180.0, 180.0);
    if hue_rotate.abs() > 0.01 {
        filters.push(format!("hue=h={hue_rotate:.2}"));
    }
    // HSL por colores y color match también valen para capas de ajuste: antes
    // sólo se aplicaban en `visual_filter` y el MP4 las ignoraba.
    let hsl = &effects["hsl"];
    let hsl_hue = number(hsl, "hue").unwrap_or(0.0).clamp(-180.0, 180.0);
    let hsl_saturation = number(hsl, "saturation").unwrap_or(0.0).clamp(-1.0, 1.0);
    let hsl_intensity = number(hsl, "intensity").unwrap_or(0.0).clamp(-1.0, 1.0);
    if hsl_hue.abs() > 0.01 || hsl_saturation.abs() > 0.001 || hsl_intensity.abs() > 0.001 {
        let colors = hsl["colors"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str())
                    .filter(|value| matches!(*value, "r" | "y" | "g" | "c" | "b" | "m"))
                    .collect::<Vec<_>>()
                    .join("+")
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "a".to_owned());
        filters.push(format!(
            "huesaturation=hue={hsl_hue:.2}:saturation={hsl_saturation:.4}:intensity={hsl_intensity:.4}:colors={colors}:strength=100:lightness=true"
        ));
    }
    let color_match = &effects["colorMatch"];
    let match_strength = number(color_match, "strength")
        .unwrap_or(0.0)
        .clamp(0.0, 1.0);
    if match_strength > 0.001 {
        let gain = |key: &str| {
            1.0 + (number(color_match, key).unwrap_or(1.0).clamp(0.25, 4.0) - 1.0) * match_strength
        };
        let (r, g, b) = (gain("r"), gain("g"), gain("b"));
        if (r - 1.0).abs() > 0.001 || (g - 1.0).abs() > 0.001 || (b - 1.0).abs() > 0.001 {
            filters.push(format!("colorchannelmixer=rr={r:.4}:gg={g:.4}:bb={b:.4}"));
        }
    }
    if let Some(tone) = tone_curve_filter(effects) {
        filters.push(tone);
    }
    if let Some(custom) = custom_curves_filter(effects) {
        filters.push(custom);
    } else {
        let preset = effects["curvePreset"].as_str().unwrap_or("");
        if let Some(name) = match preset {
            "contrast-soft" => Some("linear_contrast"),
            "contrast-medium" => Some("medium_contrast"),
            "contrast-strong" => Some("strong_contrast"),
            "vintage" => Some("vintage"),
            "cross-process" => Some("cross_process"),
            "darker" => Some("darker"),
            "lighter" => Some("lighter"),
            _ => None,
        } {
            filters.push(format!("curves=preset={name}"));
        }
    }
    if effects["grayscale"].as_bool().unwrap_or(false) {
        filters.push("hue=s=0".to_owned());
    }
    if effects["sepia"].as_bool().unwrap_or(false) {
        filters.push(
            "colorchannelmixer=rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131"
                .to_owned(),
        );
    }
    let blur = number(effects, "blur").unwrap_or(0.0).clamp(0.0, 50.0);
    if blur > 0.001 {
        filters.push(format!("gblur=sigma={blur:.3}"));
    }
    let sharpen = number(effects, "sharpen").unwrap_or(0.0).clamp(0.0, 5.0);
    if sharpen > 0.001 {
        filters.push(format!("unsharp=5:5:{sharpen:.3}:5:5:0"));
    }
    let vignette = number(effects, "vignette").unwrap_or(0.0).clamp(0.0, 1.0);
    if vignette > 0.001 {
        let divisor = (5.0 - vignette * 4.0).max(1.0);
        filters.push(format!("vignette=PI/{divisor:.3}"));
    }
    if let Some(lens) = effects
        .get("lensCorrection")
        .filter(|value| value.is_object())
    {
        let k1 = number(lens, "k1").unwrap_or(0.0).clamp(-1.0, 1.0);
        let k2 = number(lens, "k2").unwrap_or(0.0).clamp(-1.0, 1.0);
        if k1.abs() > 0.0001 || k2.abs() > 0.0001 {
            let cx = number(lens, "cx").unwrap_or(0.5).clamp(0.0, 1.0);
            let cy = number(lens, "cy").unwrap_or(0.5).clamp(0.0, 1.0);
            filters.push(format!(
                "lenscorrection=k1={k1:.4}:k2={k2:.4}:cx={cx:.3}:cy={cy:.3}:i=bilinear"
            ));
        }
    }
    if let Some(relative) = effects["lutFile"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = resolve_inside_root(root, relative)?;
        filters.push(lut_filter(&path));
    }
    if let Some((start, end)) = enable {
        for filter in &mut filters {
            filter.push_str(&format!(":enable='between(t,{start:.6},{end:.6})'"));
        }
    }
    Ok(filters)
}

/// Project-wide grade applied to the final composite, after every clip and
/// before captions. The same fields as a clip look, minus clip-only animation.
pub(crate) fn project_look_filters(
    project: &Value,
    root: &Path,
) -> Result<Vec<String>, ProjectError> {
    grade_filters(&without_lut(&project["look"]), root, None)
}

/// Grade owned by a source-less adjustment clip. It targets the final composite
/// and is gated by the clip's own start and duration.
pub(crate) fn adjustment_filters(
    clip: &Value,
    root: &Path,
    start_seconds: f64,
    end_seconds: f64,
) -> Result<Vec<String>, ProjectError> {
    grade_filters(
        &without_lut(&clip["effects"]),
        root,
        Some((start_seconds, end_seconds)),
    )
}

/// Corrección de perspectiva estática a cuatro puntos. El schema guarda las
/// esquinas normalizadas en orden TL, TR, BR, BL; FFmpeg pide TL, TR, BL, BR
/// con `sense=source` (el cuadrilátero de origen se mapea al cuadro completo).
pub(crate) fn perspective_filter(clip: &Value, profile: &Profile) -> Option<String> {
    let perspective = clip["transform"]["perspective"].as_object()?;
    let corners = perspective["corners"].as_array()?;
    if corners.len() != 4 {
        return None;
    }
    let mut points: Vec<(f64, f64)> = Vec::with_capacity(4);
    for corner in corners {
        let x = corner["x"].as_f64()?.clamp(0.0, 1.0);
        let y = corner["y"].as_f64()?.clamp(0.0, 1.0);
        points.push((x * profile.width as f64, y * profile.height as f64));
    }
    let (tl, tr, br, bl) = (points[0], points[1], points[2], points[3]);
    let default = (
        (0.0, 0.0),
        (profile.width as f64, 0.0),
        (profile.width as f64, profile.height as f64),
        (0.0, profile.height as f64),
    );
    let close = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs() < 0.01 && (a.1 - b.1).abs() < 0.01;
    if close(tl, default.0) && close(tr, default.1) && close(br, default.2) && close(bl, default.3)
    {
        return None;
    }
    // `interpolation` es opcional en el esquema: indexar el Map paniquea si
    // el proyecto no lo trae.
    let interpolation = perspective
        .get("interpolation")
        .and_then(|value| value.as_str())
        .filter(|value| matches!(*value, "linear" | "cubic"))
        .unwrap_or("linear");
    Some(format!(
        "perspective=x0={:.3}:y0={:.3}:x1={:.3}:y1={:.3}:x2={:.3}:y2={:.3}:x3={:.3}:y3={:.3}:sense=source:interpolation={interpolation}:eval=init",
        tl.0, tl.1, tr.0, tr.1, bl.0, bl.1, br.0, br.1
    ))
}

// --- Curvas de velocidad continuas ------------------------------------------
//
// La curva vive en el tiempo de SALIDA normalizado: `speed` es el multiplicador
// (2 = doble de rápido). La ventana de origen se conserva completa, así que la
// duración es `source / media(speed)`. El render construye un `setpts` por
// tramos a partir de la integral acumulada; `speed-curve.ts` implementa la
// misma regla para el editor y los tests.

#[derive(Debug, Clone, Copy)]
pub(crate) struct CurveBezier {
    cp1x: f64,
    cp1y: f64,
    cp2x: f64,
    cp2y: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct CurvePoint {
    pub(crate) t: f64,
    pub(crate) speed: f64,
    pub(crate) easing: Option<String>,
    pub(crate) bezier: Option<CurveBezier>,
}

pub(crate) const CURVE_INTEGRAL_STEPS: usize = 1024;
pub(crate) const CURVE_MAX_KNOTS: usize = 64;
pub(crate) const CURVE_MAX_EXPRESSION_CHARS: usize = 28_000;

pub(crate) fn curve_ease(easing: Option<&str>, progress: f64) -> f64 {
    match easing.unwrap_or("linear") {
        "ease-in" => progress * progress * progress,
        "ease-out" => 1.0 - (1.0 - progress) * (1.0 - progress) * (1.0 - progress),
        "ease-in-out" => progress * progress * (3.0 - 2.0 * progress),
        "hold" => 0.0,
        _ => progress,
    }
}

/// Misma resolución de cubic-bezier que `keyframes.ts` (Newton + bisección).
pub(crate) fn curve_bezier_progress(progress: f64, bezier: CurveBezier) -> f64 {
    let clamped = progress.clamp(0.0, 1.0);
    if clamped <= 0.0 {
        return 0.0;
    }
    if clamped >= 1.0 {
        return 1.0;
    }
    let cx = 3.0 * bezier.cp1x;
    let bx = 3.0 * (bezier.cp2x - bezier.cp1x) - cx;
    let ax = 1.0 - cx - bx;
    let cy = 3.0 * bezier.cp1y;
    let by = 3.0 * (bezier.cp2y - bezier.cp1y) - cy;
    let ay = 1.0 - cy - by;
    let sample_x = |u: f64| ((ax * u + bx) * u + cx) * u;
    let sample_y = |u: f64| ((ay * u + by) * u + cy) * u;
    let derivative_x = |u: f64| (3.0 * ax * u + 2.0 * bx) * u + cx;

    let mut u = clamped;
    for _ in 0..8 {
        let x = sample_x(u) - clamped;
        if x.abs() < 1e-6 {
            return sample_y(u);
        }
        let d = derivative_x(u);
        if d.abs() < 1e-6 {
            break;
        }
        u -= x / d;
    }
    let mut low = 0.0;
    let mut high = 1.0;
    u = clamped;
    for _ in 0..24 {
        let x = sample_x(u);
        if (x - clamped).abs() < 1e-6 {
            break;
        }
        if x < clamped {
            low = u;
        } else {
            high = u;
        }
        u = (low + high) / 2.0;
    }
    sample_y(u)
}

pub(crate) fn curve_sample(points: &[CurvePoint], t: f64) -> f64 {
    let Some(first) = points.first() else {
        return 1.0;
    };
    let last = points.last().unwrap_or(first);
    let at = if t.is_finite() {
        t.clamp(0.0, 1.0)
    } else {
        0.0
    };
    if at <= first.t {
        return first.speed;
    }
    if at >= last.t {
        return last.speed;
    }
    for pair in points.windows(2) {
        let left = &pair[0];
        let right = &pair[1];
        if at >= left.t && at <= right.t {
            let span = right.t - left.t;
            if span <= 0.0 {
                return right.speed;
            }
            let local = (at - left.t) / span;
            let eased = match left.bezier {
                Some(bezier) => curve_bezier_progress(local, bezier),
                None => curve_ease(left.easing.as_deref(), local),
            };
            return left.speed + (right.speed - left.speed) * eased;
        }
    }
    last.speed
}

pub(crate) fn curve_mean(points: &[CurvePoint]) -> f64 {
    let steps = CURVE_INTEGRAL_STEPS;
    let mut total = 0.0;
    for index in 0..steps {
        total += curve_sample(points, (index as f64 + 0.5) / steps as f64);
    }
    let mean = total / steps as f64;
    if mean.is_finite() && mean > 0.0 {
        mean
    } else {
        1.0
    }
}

pub(crate) fn curve_source_fraction(points: &[CurvePoint], output: f64) -> f64 {
    let tau = output.clamp(0.0, 1.0);
    if tau <= 0.0 {
        return 0.0;
    }
    if tau >= 1.0 {
        return 1.0;
    }
    let steps = ((CURVE_INTEGRAL_STEPS as f64 * tau).round() as usize).max(16);
    let mut partial = 0.0;
    for index in 0..steps {
        partial += curve_sample(points, (index as f64 + 0.5) / steps as f64 * tau);
    }
    let mut total = 0.0;
    for index in 0..CURVE_INTEGRAL_STEPS {
        total += curve_sample(points, (index as f64 + 0.5) / CURVE_INTEGRAL_STEPS as f64);
    }
    if total <= 0.0 {
        return tau;
    }
    let fraction = partial / steps as f64 * tau / (total / CURVE_INTEGRAL_STEPS as f64);
    fraction.clamp(0.0, 1.0)
}

pub(crate) fn curve_knots(points: &[CurvePoint], count: usize) -> Vec<(f64, f64)> {
    let steps = count.clamp(2, CURVE_MAX_KNOTS);
    let mut knots = vec![(0.0, 0.0)];
    let mut previous_input = 0.0;
    for index in 1..steps {
        let output = index as f64 / steps as f64;
        let input = curve_source_fraction(points, output).max(previous_input);
        previous_input = input;
        knots.push((input, output));
    }
    knots.push((1.0, 1.0));
    knots
}

pub(crate) fn parse_curve_bezier(value: &Value) -> Option<CurveBezier> {
    Some(CurveBezier {
        cp1x: value.get("cp1X")?.as_f64()?,
        cp1y: value.get("cp1Y")?.as_f64()?,
        cp2x: value.get("cp2X")?.as_f64()?,
        cp2y: value.get("cp2Y")?.as_f64()?,
    })
}

pub(crate) fn parse_speed_curve(clip: &Value) -> Option<Vec<CurvePoint>> {
    let list = clip.get("speedCurve")?.get("points")?.as_array()?;
    if list.len() < 2 {
        return None;
    }
    let mut points = Vec::with_capacity(list.len());
    for value in list {
        points.push(CurvePoint {
            t: value.get("t")?.as_f64()?,
            speed: value.get("speed")?.as_f64()?,
            easing: value
                .get("easing")
                .and_then(Value::as_str)
                .map(str::to_owned),
            bezier: value.get("bezier").and_then(parse_curve_bezier),
        });
    }
    Some(points)
}

pub(crate) fn curve_has_slow(points: &[CurvePoint]) -> bool {
    points.iter().any(|point| point.speed < 0.999)
}

pub(crate) fn curve_optical_flow_fps(clip: &Value, profile: &Profile) -> Option<usize> {
    let curve = clip.get("speedCurve")?;
    if curve.get("opticalFlow").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let fps = curve
        .get("targetFps")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(profile.fps_num as usize);
    Some(fps.clamp(24, 120))
}

/// `setpts` por tramos para una curva. Devuelve `None` si el clip no tiene
/// curva, si hay lead de transición o si la expresión no cabe en el grafo.
pub(crate) fn curve_setpts(
    clip: &Value,
    duration_seconds: f64,
    source_seconds: f64,
    lead_seconds: f64,
) -> Option<String> {
    if lead_seconds > 0.001 || duration_seconds <= 0.0 || source_seconds <= 0.0 {
        return None;
    }
    let points = parse_speed_curve(clip)?;
    for knots in [CURVE_MAX_KNOTS, 32, 16] {
        if let Some(expression) =
            curve_setpts_with(&points, duration_seconds, source_seconds, knots)
        {
            if expression.len() <= CURVE_MAX_EXPRESSION_CHARS {
                return Some(expression);
            }
        }
    }
    None
}

pub(crate) fn curve_setpts_with(
    points: &[CurvePoint],
    duration_seconds: f64,
    source_seconds: f64,
    knots_count: usize,
) -> Option<String> {
    let knots = curve_knots(points, knots_count);
    if knots.len() < 2 {
        return None;
    }
    let x = "(PTS-STARTPTS)";
    let mut segments: Vec<(f64, String)> = Vec::new();
    for pair in knots.windows(2) {
        let (input, output) = pair[0];
        let (next_input, next_output) = pair[1];
        let span = next_input - input;
        if span <= 1e-9 {
            continue;
        }
        let slope = (next_output - output) / span;
        let multiplier = duration_seconds * slope / source_seconds;
        let constant = duration_seconds * (output - input * slope);
        segments.push((
            next_input * source_seconds,
            format!("{multiplier:.9}*{x}+{constant:.9}/TB"),
        ));
    }
    let mut body = segments.last()?.1.clone();
    for (limit, segment) in segments.iter().rev().skip(1) {
        body = format!("if(lt({x},{limit:.9}/TB),{segment},{body})");
    }
    Some(format!("setpts='{body}'"))
}
