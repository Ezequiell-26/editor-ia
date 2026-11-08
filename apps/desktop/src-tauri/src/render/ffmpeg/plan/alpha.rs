/// Decisión del formato de composición del grafo de video.
///
/// El pipeline histórico compone siempre en `rgba` porque las máscaras, el
/// chroma key, la opacidad, los blend modes, las transiciones con alfa y los
/// assets con canal alpha lo necesitan. Pero una timeline sin ninguna de esas
/// condiciones puede componer directo en `yuv420p`: `overlay` copia la región
/// del clip igual que haría con alfa=255, y cada clip evita dos conversiones
/// por frame (yuv→rgb→yuv).
///
/// La regla es conservadora: cualquier duda sobre una feature que produzca o
/// consuma alfa fuerza `rgba`. Un falso positivo sólo pierde la optimización;
/// un falso negativo rompería la transparencia.
///
/// `true` cuando la composición necesita un plano alfa real.
pub(crate) fn composition_needs_alpha(
    visual_clips: &[&Value],
    asset_by_id: &HashMap<String, Value>,
    track_info: &HashMap<String, (String, u64, bool, bool)>,
    project: &Value,
    profile: &Profile,
    project_fps: f64,
) -> bool {
    for clip in visual_clips {
        let asset_id = clip["source"]["assetId"].as_str().unwrap_or("");
        if clip_needs_alpha(clip, asset_by_id.get(asset_id), profile, project_fps) {
            return true;
        }
    }
    // El look global y las capas de ajuste se aplican sobre el compuesto; una
    // LUT con intensidad parcial se mezcla con `blend`, que necesita alfa.
    if lut_needs_alpha(&project["look"]) {
        return true;
    }
    for clip in project["timeline"]["clips"]
        .as_array()
        .into_iter()
        .flatten()
    {
        if clip["enabled"].as_bool() == Some(false) {
            continue;
        }
        let track_id = clip["trackId"].as_str().unwrap_or("");
        let is_adjustment = track_info
            .get(track_id)
            .map(|(kind, _, hidden, _)| kind == "adjustment" && !hidden)
            .unwrap_or(false);
        if is_adjustment && lut_needs_alpha(&clip["effects"]) {
            return true;
        }
    }
    false
}

/// LUT presente con intensidad intermedia: `apply_lut_to_chain` la mezcla con
/// `blend` sobre una copia `format=rgba` del stream.
fn lut_needs_alpha(effects: &Value) -> bool {
    if effects["lutFile"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return false;
    }
    let intensity = number(effects, "lutIntensity").unwrap_or(1.0);
    intensity > 0.001 && intensity < 0.999
}

fn clip_needs_alpha(
    clip: &Value,
    asset: Option<&Value>,
    profile: &Profile,
    project_fps: f64,
) -> bool {
    let kind = clip["kind"].as_str().unwrap_or("video");
    // Los gráficos se queman por ASS después del compuesto; no pasan por el
    // overlay y no condicionan el formato.
    if kind == "graphic" {
        return false;
    }
    // Una imagen fija puede traer alfa propio (PNG/WebP con transparencia).
    if kind == "image" {
        return true;
    }
    if asset
        .map(|asset| asset["media"]["alpha"].as_bool() == Some(true))
        .unwrap_or(false)
    {
        return true;
    }
    if clip["blendMode"]
        .as_str()
        .and_then(blend_mode_name)
        .is_some()
    {
        return true;
    }
    // Misma validación de color que `visual_filter`: sólo un #RRGGBB válido
    // dispara el chromakey.
    let chroma_color = clip["chromaKey"]["color"].as_str().unwrap_or("").trim();
    if chroma_color.len() == 7
        && chroma_color.starts_with('#')
        && chroma_color[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return true;
    }
    // Cualquier máscara con forma (texto incluido) escribe alfa con geq o
    // alphamerge dentro de la cadena del clip.
    if clip["mask"]["shape"]
        .as_str()
        .map(|shape| !shape.is_empty())
        .unwrap_or(false)
    {
        return true;
    }
    let transform = &clip["transform"];
    if number(transform, "opacity").unwrap_or(1.0) < 0.999 {
        return true;
    }
    if clip["opacityFrozen"].as_f64().is_some() {
        return true;
    }
    if clip["animationFrozen"]["alpha"]
        .as_f64()
        .map(|value| value < 0.999)
        .unwrap_or(false)
    {
        return true;
    }
    if clip["fadeFrozen"]
        .as_f64()
        .map(|value| value < 0.999)
        .unwrap_or(false)
    {
        return true;
    }
    if clip["transitionFrozen"].is_object() {
        return true;
    }
    if clip["animationIn"]["type"].as_str() == Some("fade")
        || clip["animationOut"]["type"].as_str() == Some("fade")
    {
        return true;
    }
    if let Some(keyframes) = transform["keyframes"].as_array() {
        let mut scale_found = false;
        let mut scale_min = f64::INFINITY;
        for keyframe in keyframes {
            if keyframe["opacity"].as_f64().is_some()
                || keyframe["rotationDeg"].as_f64().is_some()
            {
                return true;
            }
            if let Some(scale) = keyframe["scale"].as_f64() {
                if scale.is_finite() {
                    scale_found = true;
                    scale_min = scale_min.min(scale);
                }
            }
        }
        // Una curva de escala que baja de 1× se renderiza con `pad` sobre un
        // lienzo transparente; por encima de 1× el `zoompan` llena el marco.
        if scale_found && scale_min < 0.999 {
            return true;
        }
    }
    if number(transform, "rotationDeg")
        .unwrap_or(0.0)
        .abs()
        > 0.01
    {
        return true;
    }
    // `perspective` puede dejar esquinas fuera del quad; en RGBA quedan
    // transparentes y dejan ver la base.
    if perspective_filter(clip, profile).is_some() {
        return true;
    }
    // Transición de entrada con lead: disolven, wipes, iris, slide-3d y
    // luma-wipe escriben alfa. Los fades a color y el slide 2D no lo tocan.
    let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
    let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
    if transition_lead_seconds(clip, project_fps, clip_seconds, start_seconds) > 0.001 {
        let safe = matches!(
            clip["transitionIn"]["type"].as_str().unwrap_or(""),
            "fade-black"
                | "fade-white"
                | "dip-color"
                | "slide-left"
                | "slide-right"
                | "slide-up"
                | "slide-down"
        );
        if !safe {
            return true;
        }
    }
    let effects = &clip["effects"];
    if let Some(glow) = effects.get("glow").filter(|value| value.is_object()) {
        if number(glow, "intensity").unwrap_or(0.6) > 0.001 {
            return true;
        }
    }
    if let Some(relight) = effects.get("relight").filter(|value| value.is_object()) {
        if number(relight, "strength").unwrap_or(0.0).abs() > 0.0001
            || number(relight, "warmth").unwrap_or(0.0).abs() > 0.0001
        {
            return true;
        }
    }
    if number(effects, "fadeInFrames").unwrap_or(0.0) > 0.0
        || number(effects, "fadeOutFrames").unwrap_or(0.0) > 0.0
    {
        return true;
    }
    lut_needs_alpha(effects)
}
