pub(crate) fn seconds(value: f64) -> String {
    format!("{:.6}", value.max(0.0))
}

pub(crate) fn hex_color(raw: &str) -> String {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|character| character.is_ascii_hexdigit()) {
        format!("0x{}", hex)
    } else {
        "0x0f1319".to_owned()
    }
}

/// `#rrggbb` → canales 0..1 para las curvas del dip-to-color congelado.
pub(crate) fn hex_rgb01(raw: &str) -> Option<(f64, f64, f64)> {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |at: usize| {
        u8::from_str_radix(&hex[at..at + 2], 16)
            .ok()
            .map(|byte| byte as f64 / 255.0)
    };
    Some((channel(0)?, channel(2)?, channel(4)?))
}

/// `wipe-*`: el clip entrante se revela por un borde que barre el cuadro
/// durante el lead (port Kdenlive wipe). `geq` modula el alfa por píxel:
/// progreso `p = min(1, N/lead_frames)` y cada dirección conserva el alfa
/// original sólo del lado ya barrido. El clip saliente queda intacto
/// debajo, igual que en Kdenlive.
pub(crate) fn wipe_alpha_expr(kind: &str, p: &str) -> String {
    let alpha = |condition: &str| format!("if({condition},alpha(X,Y),0)");
    match kind {
        // El barrido viaja hacia la izquierda: lo nuevo crece desde el
        // borde derecho (X > W*(1-p)), igual que slide-left entra desde
        // la derecha.
        "wipe-left" => alpha(&format!("gt(X,W*(1-({p})))")),
        "wipe-right" => alpha(&format!("lt(X,W*({p}))")),
        // Hacia arriba: desde abajo (Y > H*(1-p)); hacia abajo: desde arriba.
        "wipe-up" => alpha(&format!("gt(Y,H*(1-({p})))")),
        "wipe-down" => alpha(&format!("lt(Y,H*({p}))")),
        _ => "alpha(X,Y)".to_owned(),
    }
}

pub(crate) fn wipe_geq(expr: &str) -> String {
    format!("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{expr}'")
}

pub(crate) fn wipe_transition_filter(kind: &str, lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    // Progreso en frames del stream local (0 = inicio del solape).
    let p = format!("if(lt(N,{lead_frames:.0}),N/{lead_frames:.0},1)");
    wipe_geq(&wipe_alpha_expr(kind, &p))
}

/// Versión de una ventana de un frame: `p` llega ya resuelto por el preview.
pub(crate) fn wipe_frozen_filter(kind: &str, progress: f64) -> String {
    wipe_geq(&wipe_alpha_expr(kind, &format!("{progress:.6}")))
}

/// Fracción mínima del lienzo que ocupa el eje comprimido de un `slide-3d-*`
/// al inicio del lead: el cuadro entra casi de canto y abre hasta el 100 %.
const SLIDE3D_MIN_EXTENT: f64 = 0.15;

/// Eje que se comprime en perspectiva: el perpendicular al deslizamiento
/// (entradas laterales comprimen X = giro sobre eje vertical; las verticales
/// comprimen Y = giro sobre eje horizontal).
fn slide3d_axis(kind: &str) -> &'static str {
    if kind.ends_with("-up") || kind.ends_with("-down") {
        "y"
    } else {
        "x"
    }
}

/// `slide-3d-*`: además del desplazamiento del overlay (mismo `slide_axis`),
/// el clip entrante rota en perspectiva durante el lead. `perspective` con
/// `eval=frame` y `sense=destination` lleva las esquinas del fuente a un
/// quad comprimido simétrico sobre el centro; `extent` es la fracción de
/// progreso 0..1 ya expresada en las variables del filtro (`in` = frames
/// desde el inicio del solape) y `enable` apaga el remapeo al terminar el
/// lead para no pagarlo en todo el clip. Aproximación declarada: el giro es
/// simétrico sobre el centro, no una puerta anclada a un borde.
fn slide3d_perspective(axis: &str, extent: &str, enable: &str) -> String {
    let f = format!(
        "({SLIDE3D_MIN_EXTENT}+{:.2}*min(max(({extent}),0),1))",
        1.0 - SLIDE3D_MIN_EXTENT
    );
    let (x0, x1, x2, x3, y0, y1, y2, y3) = if axis == "y" {
        (
            "0".to_owned(),
            "W".to_owned(),
            "0".to_owned(),
            "W".to_owned(),
            format!("H*(1-({f}))/2"),
            format!("H*(1-({f}))/2"),
            format!("H*(1+({f}))/2"),
            format!("H*(1+({f}))/2"),
        )
    } else {
        (
            format!("W*(1-({f}))/2"),
            format!("W*(1+({f}))/2"),
            format!("W*(1-({f}))/2"),
            format!("W*(1+({f}))/2"),
            "0".to_owned(),
            "0".to_owned(),
            "H".to_owned(),
            "H".to_owned(),
        )
    };
    format!(
        "perspective=x0='{x0}':y0='{y0}':x1='{x1}':y1='{y1}':x2='{x2}':y2='{y2}':x3='{x3}':y3='{y3}':sense=destination:eval=frame:enable='{enable}'"
    )
}

pub(crate) fn slide3d_transition_filter(kind: &str, lead: f64, fps: f64) -> String {
    let lead_frames = (lead.max(0.0) * fps.max(1.0)).round().max(1.0);
    slide3d_perspective(
        slide3d_axis(kind),
        &format!("in/{lead_frames:.0}"),
        &format!("lt(n,{lead_frames:.0})"),
    )
}

/// Ventana de un frame: el progreso ya viene resuelto por el preview.
pub(crate) fn slide3d_frozen_filter(axis: &str, progress: f64) -> String {
    slide3d_perspective(axis, &format!("{progress:.6}"), "1")
}

pub(crate) fn has_audio_stream(ffprobe: &Path, path: &Path) -> bool {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .output()
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false)
}

pub(crate) fn sanitize_filter_number(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-100_000.0, 100_000.0)
    } else {
        0.0
    }
}

/// Tramos uniformes en x con los que se aproxima cada segmento Bézier
/// (16 tramos => 17 nudos, con x=0 e x=1 cerrando exactos en 0 y 1).
// 64 tramos reducen el error de la aproximación por cuerdas de ~0,05 a
// ~0,003 de progreso incluso con manejadores extremos (1,0)-(0,1), sin
// acercarse al límite de tamaño de expresión de FFmpeg para pocos keyframes.
pub(crate) const BEZIER_PIECES: usize = 64;

/// Progreso eased de una Bézier cúbica estilo CSS para el avance de segmento
/// `t`: resuelve el parámetro u con x(u) = t (Newton, 8 iteraciones, con
/// bisección de respaldo, 24) y devuelve y(u). Port de `cubicBezierProgress`
/// en packages/project-schema/src/keyframes.ts, para que el export evalúe
/// y(x=t) igual que la preview en lugar de la fórmula paramétrica x(u).
pub(crate) fn cubic_bezier_progress(t: f64, cp1_x: f64, cp1_y: f64, cp2_x: f64, cp2_y: f64) -> f64 {
    let clamped = t.clamp(0.0, 1.0);
    if clamped <= 0.0 {
        return 0.0;
    }
    if clamped >= 1.0 {
        return 1.0;
    }
    let cx = 3.0 * cp1_x;
    let bx = 3.0 * (cp2_x - cp1_x) - cx;
    let ax = 1.0 - cx - bx;
    let cy = 3.0 * cp1_y;
    let by = 3.0 * (cp2_y - cp1_y) - cy;
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

/// Expresión FFmpeg piecewise-lineal del segmento Bézier: pre-muestrea la
/// curva en Rust resolviendo y(x) con `cubic_bezier_progress` en nudos
/// uniformes de [0,1] y anida tramos lineales con 6 decimales:
/// if(lt(X,x1),y0+(y1-y0)*(X-x0)/(x1-x0), if(...)). En x=0 el primer tramo
/// evalúa y0=0 exacto y en x=1 el cierre es y=1 exacto.
pub(crate) fn bezier_segment_expression(
    progress_expr: &str,
    cp1_x: f64,
    cp1_y: f64,
    cp2_x: f64,
    cp2_y: f64,
) -> String {
    let mut expression = format!(
        "{:.6}",
        cubic_bezier_progress(1.0, cp1_x, cp1_y, cp2_x, cp2_y)
    );
    for i in (0..BEZIER_PIECES).rev() {
        let x0 = i as f64 / BEZIER_PIECES as f64;
        let x1 = (i + 1) as f64 / BEZIER_PIECES as f64;
        let y0 = cubic_bezier_progress(x0, cp1_x, cp1_y, cp2_x, cp2_y);
        let y1 = cubic_bezier_progress(x1, cp1_x, cp1_y, cp2_x, cp2_y);
        let piece = format!(
            "{:.6}+({:.6})*({}-{:.6})/({:.6})",
            y0,
            y1 - y0,
            progress_expr,
            x0,
            x1 - x0
        );
        expression = format!(
            "if(lt({},{:.6}),{},{})",
            progress_expr, x1, piece, expression
        );
    }
    expression
}

/// Piecewise-linear FFmpeg expression for one keyframed property with cubic-bezier support.
///
/// `time_var` is the expression that yields seconds relative to the clip
/// (`t` for filters that see the clip after `setpts`, `(t-start)` for overlay
/// coordinates). Values clamp to the first/last keyframe outside the range.
pub(crate) fn keyframe_expression(
    keyframes: &[Value],
    property: &str,
    fps: f64,
    time_var: &str,
) -> Option<String> {
    let rate = fps.max(1.0);
    // Sample format: (frame_normalized, value, easing_or_bezier)
    type Sample = (f64, f64, SegmentEasing);
    let mut samples: Vec<Sample> = keyframes
        .iter()
        .filter_map(|kf| {
            let frame = kf["frame"].as_f64()?;
            let value = kf[property].as_f64().map(sanitize_filter_number)?;
            Some((frame / rate, value, parse_easing(kf)))
        })
        .collect();
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(|a, b| a.0.total_cmp(&b.0));
    if samples.len() == 1 {
        return Some(format!("{:.4}", samples[0].1));
    }
    let last = samples.last()?;
    let mut expression = format!("{:.4}", last.1);
    for pair in samples.windows(2).rev() {
        let (start, end) = (&pair[0], &pair[1]);
        let delta = (end.0 - start.0).max(1e-6);
        let progress_expr = format!("(({time_var})-{:.6})/{:.6}", start.0, delta);
        // Cubic-bezier or preset easing for this segment
        let eased: String = match &start.2 {
            SegmentEasing::Bezier(cp1_x, cp1_y, cp2_x, cp2_y) => {
                // Resolver y(x=t) como la preview y emitir la curva
                // pre-muestreada como expresión piecewise-lineal (antes se
                // evaluaba la paramétrica x(u), que no es el progreso eased).
                bezier_segment_expression(&progress_expr, *cp1_x, *cp1_y, *cp2_x, *cp2_y)
            }
            SegmentEasing::Preset(easing) => match easing.as_str() {
                "ease-in" => format!("pow({},3)", progress_expr),
                "ease-out" => format!("(1-pow(1-({}),3))", progress_expr),
                "ease-in-out" => format!(
                    "(({})*({})*(3-2*({})))",
                    progress_expr, progress_expr, progress_expr
                ),
                "hold" => "0".to_owned(),
                _ => progress_expr.clone(),
            },
        };
        let slope = end.1 - start.1;
        let segment = format!("({:.4}+({:.4})*({}))", start.1, slope, eased);
        expression = format!("if(lt({time_var},{:.6}),{segment},{})", end.0, expression);
    }
    let first = &samples[0];
    Some(format!(
        "if(lt({time_var},{:.6}),{:.4},{})",
        first.0, first.1, expression
    ))
}

/// Easing for a segment: cubic-bezier control points or preset string
pub(crate) enum SegmentEasing {
    Bezier(f64, f64, f64, f64), // cp1X, cp1Y, cp2X, cp2Y
    Preset(String),
}

/// Easing de un keyframe: Bézier explícito (objeto {cp1X,cp1Y,cp2X,cp2Y} como
/// el esquema), preset nombrado, o linear por defecto. Nunca descarta la
/// muestra: un keyframe sin curva declarada interpola lineal, como el export
/// históricamente.
pub(crate) fn parse_easing(keyframe: &Value) -> SegmentEasing {
    if let Some(bezier) = keyframe["bezier"].as_object() {
        let coords = [
            bezier.get("cp1X").and_then(|v| v.as_f64()),
            bezier.get("cp1Y").and_then(|v| v.as_f64()),
            bezier.get("cp2X").and_then(|v| v.as_f64()),
            bezier.get("cp2Y").and_then(|v| v.as_f64()),
        ];
        if let [Some(cp1_x), Some(cp1_y), Some(cp2_x), Some(cp2_y)] = coords {
            return SegmentEasing::Bezier(cp1_x, cp1_y, cp2_x, cp2_y);
        }
    }
    SegmentEasing::Preset(keyframe["easing"].as_str().unwrap_or("linear").to_owned())
}

/// Expresión FFmpeg para una propiedad animada de posición del clip,
/// anclada al inicio del clip en segundos.
pub(crate) fn offset_expression(
    clip: &Value,
    property: &str,
    start_seconds: f64,
    fps: f64,
) -> Option<String> {
    let keyframes = clip["transform"]["keyframes"].as_array()?;
    keyframe_expression(
        keyframes,
        property,
        fps,
        &format!("(t-{:.6})", start_seconds.max(0.0)),
    )
}

pub(crate) fn scale_zoom_expression(
    clip: &Value,
    profile: &Profile,
    lead_seconds: f64,
) -> Option<(f64, String)> {
    if clip["scaleFrozen"].as_bool() == Some(true) {
        return None;
    }
    let transform = &clip["transform"];
    let keyframes = transform["keyframes"].as_array()?;
    if keyframes.is_empty() {
        return None;
    }
    let mut minimum = f64::INFINITY;
    let mut found = false;
    for keyframe in keyframes {
        if let Some(scale) = keyframe["scale"].as_f64() {
            if scale.is_finite() {
                minimum = minimum.min(scale);
                found = true;
            }
        }
    }
    if !found || minimum < 0.999 {
        return None;
    }
    // `on` cuenta frames ya retimados por la velocidad, así que su reloj es la
    // timeline del clip, no el tiempo de origen.
    let frame_rate = profile.fps();
    let expression = keyframe_expression(
        keyframes,
        "scale",
        profile.fps(),
        &format!(
            "((on-{:.0})/{:.6})",
            (lead_seconds * frame_rate).round(),
            frame_rate
        ),
    )?;
    Some((1.0, format!("max(1,({expression}))")))
}

/// Devuelve `(max, factor)` para una curva que baja de 1×. La capa se
/// pre-escala una vez al máximo (Lanczos) y cada frame se reduce dentro de un
/// lienzo fijo; así no se baja a 0,7 para volver a subir a 1,3, que perdía
/// nitidez. El factor es `escala/max <= 1` y `pad` centra el contenido.
pub(crate) fn scale_dynamic_expression(
    clip: &Value,
    profile: &Profile,
    lead_seconds: f64,
    speed_num: u32,
    speed_den: u32,
    is_image: bool,
) -> Option<(f64, String)> {
    if clip["scaleFrozen"].as_bool() == Some(true) {
        return None;
    }
    let transform = &clip["transform"];
    let keyframes = transform["keyframes"].as_array()?;
    if keyframes.is_empty() {
        return None;
    }
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    let mut found = false;
    for keyframe in keyframes {
        if let Some(scale) = keyframe["scale"].as_f64() {
            if scale.is_finite() {
                minimum = minimum.min(scale);
                maximum = maximum.max(scale);
                found = true;
            }
        }
    }
    if !found || minimum >= 0.999 || maximum <= 0.001 {
        return None;
    }
    // El `setpts` de velocidad cambia la cantidad de frames por segundo del
    // flujo; a diferencia de `zoompan`, este `scale` no lo re-muestrea, así que
    // el reloj de `n` debe usar la tasa retimada y no la fps nominal.
    let rate = if is_image {
        profile.fps()
    } else {
        profile.fps() * speed_num.max(1) as f64 / speed_den.max(1) as f64
    };
    let expression = keyframe_expression(
        keyframes,
        "scale",
        profile.fps(),
        &format!("((n-{:.0})/{:.6})", (lead_seconds * rate).round(), rate),
    )?;
    let factor = format!("max(0.001,min(1,(({expression})/{maximum:.6})))");
    Some((maximum, factor))
}

/// VP9 con alfa guarda el canal en un stream lateral que el decodificador
/// nativo de FFmpeg no expone; el de libvpx sí. Sólo se fuerza en los assets
/// marcados con `media.alpha`, para no cambiar el decoder de un WebM común.
pub(crate) fn alpha_video_decoder(asset: &Value) -> Option<&'static str> {
    if asset["media"]["alpha"].as_bool() == Some(true) {
        Some("libvpx-vp9")
    } else {
        None
    }
}

pub(crate) fn blend_mode_name(mode: &str) -> Option<&'static str> {
    match mode {
        "multiply" => Some("multiply"),
        "screen" => Some("screen"),
        // The base is the first blend input, so hardlight reproduces an
        // overlay with the clip on top.
        "overlay" => Some("hardlight"),
        "soft-light" => Some("softlight"),
        "darken" => Some("darken"),
        "lighten" => Some("lighten"),
        "color-dodge" => Some("dodge"),
        "color-burn" => Some("burn"),
        "hard-light" => Some("hardlight"),
        _ => None,
    }
}

/// Eje de deslizamiento de una transición `slide-*`/`slide-3d-*`:
/// `Some("x")` para entradas laterales, `Some("y")` para verticales.
pub(crate) fn slide_axis(transition: &str) -> Option<&'static str> {
    match transition {
        "slide-left" | "slide-right" | "slide-3d-left" | "slide-3d-right" => Some("x"),
        "slide-up" | "slide-down" | "slide-3d-up" | "slide-3d-down" => Some("y"),
        _ => None,
    }
}

pub(crate) fn overlay_x_expression(
    clip: &Value,
    start_seconds: f64,
    lead_seconds: f64,
    offset_x: &str,
) -> String {
    let center = format!("(W-overlay_w)/2+({offset_x})");
    if lead_seconds <= 0.001
        || slide_axis(clip["transitionIn"]["type"].as_str().unwrap_or("")) != Some("x")
    {
        return center;
    }
    let from = (start_seconds - lead_seconds).max(0.0);
    let transition = clip["transitionIn"]["type"].as_str().unwrap_or("");
    let direction = if transition == "slide-left" || transition == "slide-3d-left" {
        "W"
    } else {
        "-W"
    };
    format!(
        "if(lt(t,{start_seconds:.6}),{center}+({direction})*(1-((t-{from:.6})/{lead_seconds:.6})),{center})"
    )
}

pub(crate) fn overlay_y_expression(
    clip: &Value,
    start_seconds: f64,
    lead_seconds: f64,
    offset_y: &str,
    animation_y: Option<&str>,
) -> String {
    let base = format!("(H-overlay_h)/2+({offset_y})");
    let base = match animation_y {
        Some(term) => format!("({base})+({term})"),
        None => base,
    };
    let transition = clip["transitionIn"]["type"].as_str().unwrap_or("");
    if lead_seconds <= 0.001 || slide_axis(transition) != Some("y") {
        return base;
    }
    let from = (start_seconds - lead_seconds).max(0.0);
    // slide-up/slide-3d-up entran desde abajo y suben; slide-down/slide-3d-down
    // entran desde arriba.
    let direction = if transition == "slide-up" || transition == "slide-3d-up" {
        "H"
    } else {
        "-H"
    };
    format!(
        "if(lt(t,{start_seconds:.6}),({base})+({direction})*(1-((t-{from:.6})/{lead_seconds:.6})),({base}))"
    )
}
