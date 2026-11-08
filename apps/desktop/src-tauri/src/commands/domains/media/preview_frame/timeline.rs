fn timeline_frames(project: &Value) -> u64 {
    let clips = project["timeline"]["clips"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut total = 0u64;
    for clip in clips {
        total = total.max(
            clip["startFrame"].as_u64().unwrap_or(0) + clip["durationFrames"].as_u64().unwrap_or(0),
        );
    }
    for cue in project["captions"]["cues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        total = total.max(cue["endFrame"].as_u64().unwrap_or(0));
    }
    total
}

/// Pistas visuales y subtítulos que el frame compuesto va a incluir. Se mide
/// sobre el proyecto, sin tocar FFmpeg, para poder informarlo y testearlo;
/// incluye el clip entrante durante el lead de su transición.
fn composite_metadata(project: &Value, frame: u64) -> (usize, bool) {
    let tracks: HashMap<&str, (bool, &str)> = project["timeline"]["tracks"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?,
                (
                    track["hidden"].as_bool().unwrap_or(false),
                    track["kind"].as_str().unwrap_or(""),
                ),
            ))
        })
        .collect();
    let fps = project_fps(project).max(1.0);
    let mut visible: HashSet<&str> = HashSet::new();
    for clip in project["timeline"]["clips"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        if clip["enabled"].as_bool() == Some(false) {
            continue;
        }
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        let end = start + duration;
        let clip_seconds = duration as f64 / fps;
        let lead = transition_lead_seconds(clip, fps, clip_seconds, start as f64 / fps);
        let active_from = start as f64 - lead * fps;
        if (frame as f64) < active_from || frame >= end {
            continue;
        }
        let track_id = clip["trackId"].as_str().unwrap_or("");
        if let Some((hidden, kind)) = tracks.get(track_id) {
            if !hidden && matches!(*kind, "video" | "image" | "graphic") {
                visible.insert(track_id);
            }
        }
    }
    let hidden_captions: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter(|track| {
            track["kind"].as_str() == Some("caption") && track["hidden"].as_bool() == Some(true)
        })
        .filter_map(|track| track["id"].as_str())
        .collect();
    let captions = project["captions"]["cues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .any(|cue| {
            let start = cue["startFrame"].as_u64().unwrap_or(0);
            let end = cue["endFrame"].as_u64().unwrap_or(0);
            !hidden_captions.contains(cue["trackId"].as_str().unwrap_or(""))
                && start <= frame
                && frame < end
                && cue["text"]
                    .as_str()
                    .map(str::trim)
                    .is_some_and(|text| !text.is_empty())
        });
    (visible.len(), captions)
}

const PREVIEW_EPSILON: f64 = 0.0005;

fn project_fps(project: &Value) -> f64 {
    let numerator = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0);
    let denominator = project["video"]["frameRate"]["den"]
        .as_f64()
        .unwrap_or(1.0)
        .max(1.0);
    (numerator / denominator).max(1.0)
}

/// Copia en memoria para el frame de preview: sin audio y sin las puertas de
/// exportación (derechos/estado). No se persiste ni se usa para exportar; el
/// render final sigue exigiendo materiales listos y derechos resueltos.
fn preview_copy(project: &Value) -> Value {
    let mut preview = project.clone();
    if let Some(tracks) = preview["timeline"]["tracks"].as_array_mut() {
        tracks.retain(|track| !matches!(track["kind"].as_str(), Some("audio" | "narration")));
    }
    if let Some(clips) = preview["timeline"]["clips"].as_array_mut() {
        clips.retain(|clip| !matches!(clip["kind"].as_str(), Some("audio" | "narration")));
        for clip in clips.iter_mut() {
            clip["audio"] = serde_json::json!({ "muted": true });
        }
    }
    if let Some(assets) = preview["assets"].as_array_mut() {
        for asset in assets.iter_mut() {
            if asset["status"].as_str() != Some("ready") {
                asset["status"] = serde_json::json!("ready");
            }
            if asset["rights"]["license"]["commercialUse"].as_str() == Some("unknown") {
                asset["rights"]["license"]["commercialUse"] = serde_json::json!("preview-only");
            }
        }
    }
    preview
}

fn shift_keyframes(clip: &mut Value, field: &str, delta_frames: i64) {
    if let Some(items) = clip[field]["keyframes"].as_array_mut() {
        for keyframe in items {
            if let Some(frame) = keyframe["frame"].as_i64() {
                keyframe["frame"] = serde_json::json!(frame - delta_frames);
            }
        }
    }
}

/// Opacidad interpolada en `time_seconds` (relativa al inicio nominal del
/// clip), con el mismo easing que `opacity_commands` del render completo.
fn opacity_at(clip: &Value, time_seconds: f64, fps: f64) -> Option<f64> {
    let keyframes = clip["transform"]["keyframes"].as_array()?;
    let rate = fps.max(1.0);
    let mut samples: Vec<(f64, f64, String)> = keyframes
        .iter()
        .filter_map(|keyframe| {
            let frame = keyframe["frame"].as_f64()?;
            let value = keyframe["opacity"].as_f64()?.clamp(0.0, 1.0);
            let easing = keyframe["easing"]
                .as_str()
                .filter(|value| {
                    matches!(
                        *value,
                        "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold"
                    )
                })
                .unwrap_or("linear")
                .to_owned();
            Some((frame / rate, value, easing))
        })
        .collect();
    if samples.is_empty() {
        return None;
    }
    samples.sort_by(|a, b| a.0.total_cmp(&b.0));
    if time_seconds <= samples[0].0 {
        return Some(samples[0].1);
    }
    for pair in samples.windows(2) {
        let (start_t, start_v, easing) = (pair[0].0, pair[0].1, pair[0].2.as_str());
        let (end_t, end_v) = (pair[1].0, pair[1].1);
        if time_seconds < end_t {
            if end_t <= start_t {
                return Some(end_v);
            }
            let progress = ((time_seconds - start_t) / (end_t - start_t)).clamp(0.0, 1.0);
            return Some(start_v + (end_v - start_v) * eased_fraction(progress, easing));
        }
    }
    samples.last().map(|sample| sample.1)
}

fn animation_duration(animation: &Value, clip_seconds: f64, fps: f64) -> Option<f64> {
    let kind = animation["type"].as_str()?.trim();
    if kind.is_empty() {
        return None;
    }
    let requested = animation["durationFrames"].as_u64().unwrap_or(15).max(1) as f64;
    let frames = requested.min((clip_seconds * fps).max(1.0));
    Some((frames / fps.max(1.0)).clamp(1.0 / fps.max(1.0), clip_seconds.max(1.0 / fps.max(1.0))))
}

/// Desplazamiento y alfa congelados de las animaciones de entrada/salida.
fn animation_freeze(
    clip: &Value,
    delta_seconds: f64,
    clip_seconds: f64,
    fps: f64,
    width: f64,
    height: f64,
) -> Option<(f64, f64, f64)> {
    let mut x = 0.0;
    let mut y = 0.0;
    let mut alpha = 1.0;
    let mut found = false;
    for outgoing in [false, true] {
        let animation = if outgoing {
            &clip["animationOut"]
        } else {
            &clip["animationIn"]
        };
        let Some(duration) = animation_duration(animation, clip_seconds, fps) else {
            continue;
        };
        let Some(kind) = animation["type"]
            .as_str()
            .map(str::trim)
            .filter(|kind| !kind.is_empty())
        else {
            continue;
        };
        let from = if outgoing {
            (clip_seconds - duration).max(0.0)
        } else {
            0.0
        };
        let progress = ((delta_seconds - from) / duration).clamp(0.0, 1.0);
        found = true;
        match kind {
            "fade" => {
                alpha *= if outgoing { 1.0 - progress } else { progress };
            }
            "slide-left" => {
                x += if outgoing {
                    -width * progress
                } else {
                    width * (1.0 - progress)
                };
            }
            "slide-right" => {
                x += if outgoing {
                    width * progress
                } else {
                    -width * (1.0 - progress)
                };
            }
            "slide-up" => {
                y += if outgoing {
                    -height * progress
                } else {
                    height * (1.0 - progress)
                };
            }
            "slide-down" => {
                y += if outgoing {
                    height * progress
                } else {
                    -height * (1.0 - progress)
                };
            }
            _ => {}
        }
    }
    found.then_some((x, y, alpha.clamp(0.0, 1.0)))
}

/// Factor de fade del clip en el frame pedido. El compuesto completo aplica
/// los fades sobre la duración real del clip; la ventana de un frame los
/// reemplaza por una multiplicación constante, porque su duración recortada
/// haría que el filtro `fade` evaluara el factor equivocado.
fn frozen_fade(clip: &Value, delta_seconds: f64, clip_seconds: f64, fps: f64) -> Option<f64> {
    let seconds = |key: &str| {
        (clip["effects"][key].as_f64().unwrap_or(0.0).max(0.0) / fps.max(1.0)).min(clip_seconds)
    };
    let fade_in = seconds("fadeInFrames");
    let fade_out = seconds("fadeOutFrames");
    if fade_in <= PREVIEW_EPSILON && fade_out <= PREVIEW_EPSILON {
        return None;
    }
    let enter = if fade_in > PREVIEW_EPSILON {
        (delta_seconds / fade_in).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let leave = if fade_out > PREVIEW_EPSILON {
        ((clip_seconds - delta_seconds) / fade_out).clamp(0.0, 1.0)
    } else {
        1.0
    };
    Some((enter * leave).clamp(0.0, 1.0))
}

/// Ken Burns evaluado en el frame pedido. `visual_filter` lo consume como un
/// crop estático (`frozen`) para no decodificar todo el clip desde el inicio.
fn frozen_motion(clip: &Value, delta_seconds: f64, clip_seconds: f64) -> Option<Value> {
    let motion = &clip["motion"];
    let kind = motion["type"].as_str()?.trim();
    if kind.is_empty() {
        return None;
    }
    let intensity = motion["intensity"]
        .as_f64()
        .unwrap_or(0.12)
        .clamp(0.02, 0.5);
    // El progreso de Ken Burns es clip-local: la velocidad cambia cuántos
    // frames de origen se consumen, pero no la fracción del clip recorrida.
    // Un lead puede llevar el tiempo local más allá del clip; el zoompan del
    // full sigue creciendo y la ventana congela la misma fracción.
    let fraction = (delta_seconds / clip_seconds.max(0.001)).max(0.0);
    let center_x = "(iw-iw/zoom)/2".to_owned();
    let center_y = "(ih-ih/zoom)/2".to_owned();
    let (zoom, x, y) = match kind {
        "zoom-in" => (1.0 + intensity * fraction, center_x, center_y),
        "zoom-out" => (1.0 + intensity * (1.0 - fraction), center_x, center_y),
        "pan-left" => (
            1.0 + intensity,
            format!("(iw-iw/zoom)*(1-{fraction:.6})"),
            center_y,
        ),
        "pan-right" => (
            1.0 + intensity,
            format!("(iw-iw/zoom)*{fraction:.6}"),
            center_y,
        ),
        "pan-up" => (
            1.0 + intensity,
            center_x,
            format!("(ih-ih/zoom)*(1-{fraction:.6})"),
        ),
        "pan-down" => (
            1.0 + intensity,
            center_x,
            format!("(ih-ih/zoom)*{fraction:.6}"),
        ),
        _ => return None,
    };
    Some(serde_json::json!({
        "type": kind,
        "intensity": intensity,
        "frozen": { "z": zoom, "x": x, "y": y }
    }))
}

fn preview_window_error(reason: &str) -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::RenderFailed,
        format!("el frame pide el compuesto completo: {reason}").as_str(),
    )
}

fn freezable_transition(kind: &str) -> bool {
    matches!(
        kind,
        "dissolve"
            | "fade-black"
            | "fade-white"
            | "dip-color"
            | "slide-left"
            | "slide-right"
            | "slide-up"
            | "slide-down"
            | "slide-3d-left"
            | "slide-3d-right"
            | "slide-3d-up"
            | "slide-3d-down"
            | "wipe-left"
            | "wipe-right"
            | "wipe-up"
            | "wipe-down"
    )
}

/// Reencuadra el proyecto a un único frame. Conserva el contenido visual de
/// los clips activos (fuente, keyframes y Ken Burns rebasados) y descarta el
/// resto del tiempo, para que FFmpeg no decodifique la timeline entera.
fn window_project(project: &Value, frame: u64) -> Result<Value, ProjectError> {
    // Los compuestos se expanden a sus clips internos, igual que en el render
    // completo; si no, la ventana los ignoraba y perdía esas capas.
    let expanded = expand_compounds(project)?;
    let project = &expanded;
    let fps = project_fps(project);
    let frame_width = project["video"]["width"].as_u64().unwrap_or(0) as f64;
    let frame_height = project["video"]["height"].as_u64().unwrap_or(0) as f64;
    let tracks = project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let track_info: HashMap<String, (String, bool)> = tracks
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?.to_owned(),
                (
                    track["kind"].as_str().unwrap_or("").to_owned(),
                    track["hidden"].as_bool().unwrap_or(false),
                ),
            ))
        })
        .collect();
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let visible = |clip: &Value| -> Option<String> {
        if clip["enabled"].as_bool() == Some(false) {
            return None;
        }
        let (kind, hidden) = track_info.get(clip["trackId"].as_str().unwrap_or(""))?;
        (!*hidden).then(|| kind.clone())
    };

    // Los leads de dissolve, fade-black/white y slide se congelan con su alfa
    // o desplazamiento; los tipos desconocidos se delegan. Desde el corte la
    // transición ya terminó y la ventana compone ambos clips.
    for clip in &clips {
        let Some(kind) = visible(clip) else {
            continue;
        };
        if !matches!(kind.as_str(), "video" | "image" | "freeze") {
            continue;
        }
        let start = clip["startFrame"].as_u64().unwrap_or(0) as f64;
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        if duration == 0 {
            continue;
        }
        let clip_seconds = duration as f64 / fps;
        let lead = transition_lead_seconds(clip, fps, clip_seconds, start / fps);
        let lead_frames = lead * fps;
        let position = frame as f64;
        if lead > PREVIEW_EPSILON && position >= start - lead_frames && position < start {
            let kind = clip["transitionIn"]["type"].as_str().unwrap_or("");
            if !freezable_transition(kind) {
                return Err(preview_window_error("transición no congelable"));
            }
        }
    }

    let mut kept: Vec<Value> = Vec::new();
    let mut kept_captions: Vec<Value> = Vec::new();
    let mut omitted_graphic = false;
    for clip in &clips {
        let Some(track_kind) = visible(clip) else {
            continue;
        };
        if clip["kind"].as_str() == Some("graphic") {
            let start = clip["startFrame"].as_u64().unwrap_or(0);
            let duration = clip["durationFrames"].as_u64().unwrap_or(0);
            if duration > 0 && frame >= start && frame < start + duration {
                omitted_graphic = true;
            }
            continue;
        }
        if !matches!(track_kind.as_str(), "video" | "image" | "adjustment") {
            continue;
        }
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        let clip_seconds = duration as f64 / fps;
        let lead = transition_lead_seconds(clip, fps, clip_seconds, start as f64 / fps);
        let active_from = start as f64 - lead * fps;
        if duration == 0 || (frame as f64) < active_from || frame >= start + duration {
            continue;
        }
        let clip_kind = clip["kind"].as_str().unwrap_or("");
        match clip_kind {
            "graphic" => {
                // El compuesto no puede quemar el gráfico sin su plan de
                // motion, pero el resto de las capas sí se puede mostrar.
                omitted_graphic = true;
            }
            "adjustment" => {
                let mut fast = clip.clone();
                fast["startFrame"] = serde_json::json!(0);
                fast["durationFrames"] = serde_json::json!(1);
                kept.push(fast);
            }
            "video" | "image" | "freeze" => {
                let reverse = clip["reverse"].as_bool().unwrap_or(false);
                let delta_frames = frame as i64 - start as i64;
                let delta_seconds = delta_frames as f64 / fps;
                let local_seconds = delta_seconds + lead;
                let total_seconds = clip_seconds + lead;
                let transition_type = clip["transitionIn"]["type"].as_str().unwrap_or("");
                let transition_progress = if lead > PREVIEW_EPSILON {
                    (local_seconds / lead).clamp(0.0, 1.0)
                } else {
                    1.0
                };
                let remaining = (1.0 - transition_progress).max(0.0);
                let frozen_transition = match transition_type {
                    "dissolve" if remaining > 0.0005 => {
                        Some(serde_json::json!({ "alpha": transition_progress }))
                    }
                    "fade-black" if remaining > 0.0005 => Some(serde_json::json!({
                        "mode": "black", "alpha": transition_progress
                    })),
                    "fade-white" if remaining > 0.0005 => Some(serde_json::json!({
                        "mode": "white", "alpha": transition_progress
                    })),
                    "dip-color" if remaining > 0.0005 => {
                        let color = clip["transitionIn"]["color"].as_str().unwrap_or("#000000");
                        Some(serde_json::json!({
                            "mode": "color", "color": color, "alpha": transition_progress
                        }))
                    }
                    "slide-left" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": frame_width * remaining, "y": 0.0
                    })),
                    "slide-right" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": -frame_width * remaining, "y": 0.0
                    })),
                    "slide-up" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": 0.0, "y": frame_height * remaining
                    })),
                    wipe @ ("wipe-left" | "wipe-right" | "wipe-up" | "wipe-down")
                        if remaining > 0.0005 =>
                    {
                        Some(serde_json::json!({
                            "mode": "wipe",
                            "kind": wipe,
                            "progress": transition_progress
                        }))
                    }
                    "slide-down" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": 0.0, "y": -frame_height * remaining
                    })),
                    // Slide 3D: mismo desplazamiento que el slide 2D más el
                    // quad en perspectiva congelado al progreso del frame.
                    "slide-3d-left" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": frame_width * remaining, "y": 0.0,
                        "mode": "slide3d", "axis": "x", "progress": transition_progress
                    })),
                    "slide-3d-right" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": -frame_width * remaining, "y": 0.0,
                        "mode": "slide3d", "axis": "x", "progress": transition_progress
                    })),
                    "slide-3d-up" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": 0.0, "y": frame_height * remaining,
                        "mode": "slide3d", "axis": "y", "progress": transition_progress
                    })),
                    "slide-3d-down" if remaining > 0.0005 => Some(serde_json::json!({
                        "x": 0.0, "y": -frame_height * remaining,
                        "mode": "slide3d", "axis": "y", "progress": transition_progress
                    })),
                    wipe @ ("wipe-left" | "wipe-right" | "wipe-up" | "wipe-down")
                        if remaining > 0.0005 =>
                    {
                        Some(serde_json::json!({
                            "mode": "wipe",
                            "kind": wipe,
                            "progress": transition_progress
                        }))
                    }
                    _ => None,
                };
                // El Ken Burns se mide desde el inicio del solape; si un lead
                // lleva el tiempo local más allá del clip, se congela la misma
                // fracción creciente que usa el zoompan del full.
                let fade = frozen_fade(clip, local_seconds, total_seconds, fps);
                let frozen_animation = animation_freeze(
                    clip,
                    delta_seconds,
                    clip_seconds,
                    fps,
                    frame_width,
                    frame_height,
                );
                let frozen_opacity = opacity_at(clip, delta_seconds, fps);
                let mut fast = clip.clone();
                if let Some(effects) = fast["effects"].as_object_mut() {
                    effects.insert("fadeInFrames".to_owned(), serde_json::json!(0));
                    effects.insert("fadeOutFrames".to_owned(), serde_json::json!(0));
                }
                if let Some(fade) = fade.filter(|value| *value < 0.999) {
                    fast["fadeFrozen"] = serde_json::json!(fade);
                }
                if let Some(opacity) = frozen_opacity {
                    fast["opacityFrozen"] = serde_json::json!(opacity);
                }
                if let Some((x, y, alpha)) = frozen_animation {
                    if x.abs() > 0.0005 || y.abs() > 0.0005 || alpha < 0.999 {
                        fast["animationFrozen"] =
                            serde_json::json!({ "x": x, "y": y, "alpha": alpha });
                    }
                }
                if let Some(frozen_transition) = frozen_transition {
                    fast["transitionFrozen"] = frozen_transition;
                }
                fast["animationIn"] = serde_json::json!({});
                fast["animationOut"] = serde_json::json!({});
                fast["transitionIn"] = serde_json::json!({});
                fast["motion"] = frozen_motion(&fast, local_seconds, clip_seconds)
                    .unwrap_or_else(|| serde_json::json!({}));
                shift_keyframes(&mut fast, "transform", delta_frames);
                shift_keyframes(&mut fast, "mask", delta_frames);
                if reverse {
                    fast["reverse"] = serde_json::json!(false);
                }
                if clip_kind == "video" {
                    let speed_num = fast["speed"]["num"].as_f64().unwrap_or(1.0).max(0.01);
                    let speed_den = fast["speed"]["den"].as_f64().unwrap_or(1.0).max(0.01);
                    let speed = speed_num / speed_den;
                    // El plan completo busca `in - lead*speed` (sin bajar de 0)
                    // y avanza `local` segundos; el recorte debe copiar ese
                    // frame, no sólo `delta`, o tras un corte muestra el inicio.
                    let in_frames = fast["source"]["inFrame"].as_u64().unwrap_or(0);
                    let in_seconds = in_frames as f64 / fps;
                    let input_start = (in_seconds - lead * speed).max(0.0);
                    if reverse {
                        // `reverse` da la vuelta al bloque de entrada: el frame
                        // local se cuenta desde el último fotograma de ese bloque.
                        let input_frames = ((clip_seconds + lead) * speed * fps).max(1.0);
                        let last_frame = (input_start * fps).round() + input_frames - 1.0;
                        let source_frame =
                            (last_frame - (local_seconds * speed * fps).round()).max(0.0) as u64;
                        fast["source"]["inFrame"] = serde_json::json!(source_frame);
                        fast["source"]["outFrame"] = serde_json::json!(source_frame + 1);
                    } else {
                        let source_frame = ((input_start + local_seconds * speed) * fps)
                            .round()
                            .max(0.0) as i64;
                        let shift = source_frame - in_frames as i64;
                        for key in ["inFrame", "outFrame"] {
                            if let Some(frame) = fast["source"][key].as_u64() {
                                fast["source"][key] =
                                    serde_json::json!((frame as i64 + shift).max(0) as u64);
                            }
                        }
                    }
                }
                fast["startFrame"] = serde_json::json!(0);
                fast["durationFrames"] = serde_json::json!(1);
                fast["audio"] = serde_json::json!({ "muted": true });
                // La escala ya está congelada en el frame pedido: el overlay
                // no necesita la corrección de tamaño dinámico.
                fast["scaleFrozen"] = serde_json::json!(true);
                kept.push(fast);
            }
            _ => {}
        }
    }

    let hidden_captions: HashSet<&str> = track_info
        .iter()
        .filter(|(_, (kind, hidden))| kind == "caption" && *hidden)
        .map(|(id, _)| id.as_str())
        .collect();
    for cue in project["captions"]["cues"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let start = cue["startFrame"].as_u64().unwrap_or(0);
        let end = cue["endFrame"].as_u64().unwrap_or(0);
        if frame < start
            || frame >= end
            || hidden_captions.contains(cue["trackId"].as_str().unwrap_or(""))
            || !cue["text"]
                .as_str()
                .map(str::trim)
                .is_some_and(|text| !text.is_empty())
        {
            continue;
        }
        if cue["wordReveal"].as_bool() == Some(true)
            && cue["words"].as_array().is_some_and(|words| words.len() > 1)
        {
            return Err(preview_window_error("subtítulo con revelado por palabra"));
        }
        let mut fast = cue.clone();
        fast["startFrame"] = serde_json::json!(0);
        fast["endFrame"] = serde_json::json!((end - frame).max(1));
        kept_captions.push(fast);
    }

    if omitted_graphic && kept.is_empty() && kept_captions.is_empty() {
        return Err(preview_window_error("clip gráfico sin otras capas"));
    }
    let mut window = project.clone();
    window["timeline"]["tracks"] = Value::Array(
        tracks
            .into_iter()
            .filter(|track| !matches!(track["kind"].as_str(), Some("audio" | "narration")))
            .collect(),
    );
    if kept.is_empty() {
        // Un hueco sin clips igual debe renderizar el fondo y los subtítulos.
        let track_id = "preview-background";
        window["timeline"]["tracks"]
            .as_array_mut()
            .expect("tracks")
            .push(serde_json::json!({
                "id": track_id, "kind": "adjustment", "order": 0,
                "hidden": false, "muted": false
            }));
        kept.push(serde_json::json!({
            "id": "preview-background-clip", "trackId": track_id,
            "kind": "adjustment", "startFrame": 0, "durationFrames": 1,
            "source": { "type": "adjustment" }, "effects": {}
        }));
    }
    window["timeline"]["clips"] = Value::Array(kept);
    window["captions"]["cues"] = Value::Array(kept_captions);
    if omitted_graphic {
        window["previewGraphicOmitted"] = serde_json::json!(true);
    }
    Ok(window)
}
