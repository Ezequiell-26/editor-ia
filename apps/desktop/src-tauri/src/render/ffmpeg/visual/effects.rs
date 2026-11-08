/// Formatea un parámetro del stack según el tipo declarado en el manifiesto.
/// `axis` sirve para `{color.r}` y `{vec2.x}`.
pub(crate) fn format_recipe_value(
    kind: ParamKind,
    value: Option<&Value>,
    axis: Option<&str>,
) -> String {
    match kind {
        ParamKind::Float => trim_number(value.and_then(Value::as_f64).unwrap_or(0.0)),
        ParamKind::Int | ParamKind::Enum => {
            let number = value.and_then(Value::as_f64).unwrap_or(0.0);
            format!("{}", number.round() as i64)
        }
        ParamKind::Bool => {
            if value.and_then(Value::as_bool).unwrap_or(false) {
                "1".to_owned()
            } else {
                "0".to_owned()
            }
        }
        ParamKind::Color => {
            let raw = value.and_then(Value::as_str).unwrap_or("#000000");
            let clean = raw.trim_start_matches('#');
            match axis {
                Some("r") | Some("g") | Some("b") => {
                    let channel = match axis {
                        Some("r") => 0,
                        Some("g") => 1,
                        _ => 2,
                    };
                    let start = channel * 2;
                    let part = clean.get(start..start + 2).unwrap_or("00");
                    let value = u8::from_str_radix(part, 16).unwrap_or(0) as f64 / 255.0;
                    trim_number(value)
                }
                _ => format!("0x{clean}"),
            }
        }
        ParamKind::Vec2 => {
            let array = value.and_then(Value::as_array);
            let x = array
                .and_then(|items| items.first())
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            let y = array
                .and_then(|items| items.get(1))
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            match axis {
                Some("x") => trim_number(x),
                Some("y") => trim_number(y),
                _ => format!("{}:{}", trim_number(x), trim_number(y)),
            }
        }
    }
}

/// Sustituye `{param}` y `{param.x}` / `{param.r}` en una plantilla de filtro.
pub(crate) fn fill_recipe_template(template: &str, recipe: &Recipe, params: &Value) -> String {
    let chars: Vec<char> = template.chars().collect();
    let mut out = String::with_capacity(template.len() + 16);
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '{' {
            if let Some(offset) = chars[index..]
                .iter()
                .position(|character| *character == '}')
            {
                let token: String = chars[index + 1..index + offset].iter().collect();
                let (id, axis) = match token.split_once('.') {
                    Some((id, axis)) => (id, Some(axis)),
                    None => (token.as_str(), None),
                };
                if let Some(param) = recipe.params.iter().find(|param| param.id == id) {
                    let value = params.get(id);
                    out.push_str(&format_recipe_value(param.kind, value, axis));
                    index += offset + 1;
                    continue;
                }
            }
        }
        out.push(chars[index]);
        index += 1;
    }
    out
}

/// Rellena una plantilla de audio.
///
/// Además de los `{param}` de siempre, resuelve dos macros que el catálogo usa
/// porque no conoce el perfil ni puede dividir:
/// - `%RATE%` → frecuencia de muestreo del perfil.
/// - `%INV:<param>%` → inverso del parámetro. `asetrate` cambia el tono y la
///   duración; `atempo` con el inverso devuelve el clip a su largo original.
pub(crate) fn fill_audio_template(
    template: &str,
    recipe: &Recipe,
    params: &Value,
    audio_rate: u32,
) -> String {
    let filled = fill_recipe_template(template, recipe, params);
    let with_rate = filled.replace("%RATE%", &audio_rate.to_string());
    let mut out = String::with_capacity(with_rate.len());
    let mut rest = with_rate.as_str();
    while let Some(start) = rest.find("%INV:") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 5..];
        match after.find('%') {
            Some(end) => {
                let id = &after[..end];
                let value = params.get(id).and_then(Value::as_f64).unwrap_or(1.0);
                let inverse = if value.abs() < f64::EPSILON {
                    1.0
                } else {
                    1.0 / value
                };
                out.push_str(&trim_number(inverse));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str("%INV:");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Agrega la cadena de audio del clip a la lista de filtros.
///
/// El stack de audio vive en `clip.effects.audioStack`, separado del stack de
/// video. Cada instancia aporta uno o más filtros; un efecto de video que se
/// cuele en la lista se saltea porque su `audio_chain` está vacía.
pub(crate) fn apply_audio_effect_stack(
    filters: &mut Vec<String>,
    effects: &Value,
    audio_rate: u32,
) {
    let Some(stack) = effects.get("audioStack").and_then(Value::as_array) else {
        return;
    };
    let empty = Value::Object(serde_json::Map::new());
    for instance in stack {
        if !instance
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            continue;
        }
        let Some(effect_id) = instance.get("effectId").and_then(Value::as_str) else {
            continue;
        };
        let Some(recipe) = find_recipe(effect_id) else {
            continue;
        };
        if recipe.audio_chain.is_empty() {
            continue;
        }
        let params = instance.get("params").unwrap_or(&empty);
        for template in recipe.audio_chain {
            let filled = fill_audio_template(template, recipe, params, audio_rate);
            if !filled.is_empty() {
                filters.push(filled);
            }
        }
    }
}

/// Tope de tramos del audioStack animado (mismo criterio que el video: el
/// grafo crece linealmente y pasado el tope se cae al valor estático).
pub(crate) const MAX_AUDIO_STACK_SEGMENTS: usize = 32;

/// Plan de tramos del audioStack animado: cortes en los frames de keyframes
/// más los extremos del clip, en samples del stream ya resampleado.
pub(crate) struct AudioStackPlan {
    /// (sample_inicio, sample_fin, frame_local_medio) por tramo.
    segments: Vec<(u64, u64, f64)>,
}

pub(crate) fn audio_stack_segment_plan(
    instances: &[(&Value, Vec<EffectParamTrack>)],
    clip_seconds: f64,
    project_fps: f64,
    audio_rate: u32,
) -> Option<AudioStackPlan> {
    let duration_frames = (clip_seconds * project_fps).round().max(2.0) as u32;
    let mut bounds = std::collections::BTreeSet::from([0u32, duration_frames]);
    for (_, tracks) in instances {
        for track in tracks.iter() {
            for (frame, _, _) in &track.keys {
                bounds.insert((*frame).min(duration_frames));
            }
        }
    }
    let bounds: Vec<u32> = bounds.into_iter().collect();
    if bounds.len() < 3 || bounds.len() - 1 > MAX_AUDIO_STACK_SEGMENTS {
        // Menos de 2 cortes útiles o grafo desbordado: el llamador cae al
        // stack estático.
        return None;
    }
    let factor = audio_rate as f64 / project_fps.max(1.0);
    let mut segments = Vec::with_capacity(bounds.len() - 1);
    for pair in bounds.windows(2) {
        let start = (pair[0] as f64 * factor).round() as u64;
        let end = (pair[1] as f64 * factor).round() as u64;
        if end <= start {
            continue;
        }
        segments.push((start, end, (pair[0] + pair[1]) as f64 / 2.0));
    }
    if segments.len() < 2 || segments.len() > MAX_AUDIO_STACK_SEGMENTS {
        return None;
    }
    Some(AudioStackPlan { segments })
}

/// Parámetros de una instancia de audio en un frame local: los keyframes
/// muestrean sólo los parámetros animados; el resto queda como está.
pub(crate) fn audio_params_at(instance: &Value, tracks: &[EffectParamTrack], frame: f64) -> Value {
    let empty = Value::Object(serde_json::Map::new());
    let base = instance.get("params").unwrap_or(&empty);
    if tracks.is_empty() {
        return base.clone();
    }
    let mut params = base.as_object().cloned().unwrap_or_default();
    for track in tracks {
        params.insert(
            track.param.clone(),
            Value::from(sample_effect_track(track, frame)),
        );
    }
    Value::Object(params)
}

/// Arma los grafos del audioStack segmentado: la cadena pre-stack termina en
/// `akp{input}`, `asplit` abre un tramo por segmento (`atrim` por samples +
/// `asetpts` + filtros de la instancia con parámetros muestreados en el
/// punto medio) y `concat` recompone en `astk{input}`.
pub(crate) fn build_audio_stack_graphs(
    input_index: usize,
    pre_filters: Vec<String>,
    instances: &[(&Value, Vec<EffectParamTrack>)],
    plan: &AudioStackPlan,
    audio_rate: u32,
) -> Vec<String> {
    let count = plan.segments.len();
    let mut graphs = Vec::with_capacity(count + 3);
    let split_in = if pre_filters.is_empty() {
        format!("{input_index}:a")
    } else {
        let label = format!("akp{input_index}");
        graphs.push(format!(
            "[{input_index}:a]{}[{label}]",
            pre_filters.join(",")
        ));
        label
    };
    let split_out: Vec<String> = (0..count)
        .map(|k| format!("aks{input_index}_{k}"))
        .collect();
    graphs.push(format!(
        "[{split_in}]asplit={count}{}",
        split_out
            .iter()
            .map(|label| format!("[{label}]"))
            .collect::<String>()
    ));
    let mut concat_ins: Vec<String> = Vec::with_capacity(count);
    for (k, (start, end, mid_frame)) in plan.segments.iter().enumerate() {
        let mut body = format!("atrim=start_sample={start}:end_sample={end},asetpts=PTS-STARTPTS");
        for (instance, tracks) in instances {
            let params = audio_params_at(instance, tracks, *mid_frame);
            let Some(effect_id) = instance.get("effectId").and_then(Value::as_str) else {
                continue;
            };
            let Some(recipe) = find_recipe(effect_id) else {
                continue;
            };
            for template in recipe.audio_chain {
                let filled = fill_audio_template(template, recipe, &params, audio_rate);
                if !filled.is_empty() {
                    body.push(',');
                    body.push_str(&filled);
                }
            }
        }
        let out = format!("akso{input_index}_{k}");
        graphs.push(format!("[{}]{body}[{out}]", split_out[k]));
        concat_ins.push(format!("[{out}]"));
    }
    graphs.push(format!(
        "{}concat=n={count}:v=0:a=1[astk{input_index}]",
        concat_ins.concat()
    ));
    graphs
}

/// Cuerpo de filtros que aporta una instancia de efecto: sus plantillas de
/// `chain` más el `graph` opcional (con `%A%` reemplazado por `token`, que debe
/// ser único dentro del filter_complex). Vacío si la receta no produce nada.
pub(crate) fn effect_instance_body(recipe: &Recipe, params: &Value, token: &str) -> String {
    let mut body = String::new();
    if !recipe.chain.is_empty() {
        let filters: Vec<String> = recipe
            .chain
            .iter()
            .map(|template| fill_recipe_template(template, recipe, params))
            .collect();
        body.push_str(&filters.join(","));
    }
    if let Some(graph) = recipe.graph {
        let filled = fill_recipe_template(graph, recipe, params).replace("%A%", token);
        if !body.is_empty() {
            body.push(',');
        }
        body.push_str(&filled);
    }
    body
}

/// Aplica el stack declarativo del clip sobre la cola de su cadena.
///
/// Cada paso termina en `[label]`, así el siguiente puede volver a recortar la
/// etiqueta y encadenarse. Un efecto sin receta en la tabla generada se saltea:
/// el preview lo muestra y el export no inventa un filtro que no existe.
pub(crate) fn apply_effect_stack(chain: String, label: &str, effects: &Value) -> String {
    let Some(stack) = effects.get("stack").and_then(Value::as_array) else {
        return chain;
    };
    if stack.is_empty() {
        return chain;
    }
    let output = format!("[{label}]");
    let empty = Value::Object(serde_json::Map::new());
    let mut chain = chain;

    for (index, instance) in stack.iter().enumerate() {
        if !instance
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            continue;
        }
        let Some(effect_id) = instance.get("effectId").and_then(Value::as_str) else {
            continue;
        };
        let Some(recipe) = find_recipe(effect_id) else {
            continue;
        };
        let params = instance.get("params").unwrap_or(&empty);
        let body = effect_instance_body(recipe, params, &format!("{label}_{index}"));
        if body.is_empty() {
            continue;
        }
        let Some(prefix) = chain.strip_suffix(&output).map(str::to_owned) else {
            break;
        };
        chain = format!("{prefix},{body}{output}");
    }
    chain
}

// ── Keyframes de efecto en export (render segmentado) ──────────────────────
//
// Los filtros de las recetas evalúan sus opciones una sola vez al init: no hay
// expresión `t` que los anime (verificado con el ffmpeg real; `sendcmd` tampoco
// comanda `eq`). La única vía general es renderizar el clip en tramos: se parte
// el stream en los frames donde cambian los keyframes, cada tramo aplica los
// parámetros estáticos evaluados en su punto medio y `concat` los recompone.
// Es el mismo truco que usa MLT por dentro y funciona para el 100% de recetas.

/// Tope de tramos por clip: cada keyframe extra parte el clip y agranda el
/// filter_complex. Con más de `MAX_EFFECT_SEGMENTS` tramos se cae al valor
/// estático (comportamiento anterior) en vez de generar un grafo inmanejable.
pub(crate) const MAX_EFFECT_SEGMENTS: usize = 32;

/// Pista de keyframes de un parámetro numérico de una instancia.
pub(crate) struct EffectParamTrack {
    pub(crate) param: String,
    /// (frame local del clip, valor, easing) ordenado por frame.
    pub(crate) keys: Vec<(u32, f64, SegmentEasing)>,
}

/// Pistas de keyframes de una instancia: `param -> [(frame, valor, easing)]`.
/// `require_audio_chain` exige que la receta tenga cadena de audio (para el
/// audioStack); el stack de video acepta cualquier receta renderizable.
pub(crate) fn instance_keyframe_tracks(
    instance: &Value,
    require_audio_chain: bool,
) -> Vec<EffectParamTrack> {
    let renderable = instance
        .get("effectId")
        .and_then(Value::as_str)
        .and_then(find_recipe)
        .map(|recipe| !require_audio_chain || !recipe.audio_chain.is_empty())
        .unwrap_or(false);
    if !renderable {
        return Vec::new();
    }
    let Some(tracks) = instance.get("keyframes").and_then(Value::as_object) else {
        return Vec::new();
    };
    tracks
        .iter()
        .filter_map(|(param, keys)| {
            let mut parsed: Vec<(u32, f64, SegmentEasing)> = keys
                .as_array()?
                .iter()
                .filter_map(|key| {
                    let frame = key["frame"].as_u64()?;
                    let value = key["value"].as_f64()?;
                    Some((frame.min(u32::MAX as u64) as u32, value, parse_easing(key)))
                })
                .collect();
            if parsed.len() < 2 {
                return None;
            }
            parsed.sort_by_key(|(frame, _, _)| *frame);
            Some(EffectParamTrack {
                param: param.clone(),
                keys: parsed,
            })
        })
        .collect()
}

/// Recolecta las pistas de keyframes de las instancias habilitadas del stack
/// de video. Una instancia sin receta FFmpeg no aporta cortes: sus keyframes
/// no cambian nada en el export.
pub(crate) fn effect_keyframe_tracks(effects: &Value) -> Vec<Vec<EffectParamTrack>> {
    let Some(stack) = effects.get("stack").and_then(Value::as_array) else {
        return Vec::new();
    };
    stack
        .iter()
        .map(|instance| {
            if !instance
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
            {
                return Vec::new();
            }
            instance_keyframe_tracks(instance, false)
        })
        .collect()
}

/// Instancias del `audioStack` con keyframes y su cadena de audio renderizable.
/// Devuelve `(instance, tracks)` para poder muestrear los parámetros por tramo.
pub(crate) fn audio_stack_keyframe_instances(
    effects: &Value,
) -> Vec<(&Value, Vec<EffectParamTrack>)> {
    let Some(stack) = effects.get("audioStack").and_then(Value::as_array) else {
        return Vec::new();
    };
    stack
        .iter()
        .filter(|instance| {
            instance
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        })
        .filter_map(|instance| {
            let tracks = instance_keyframe_tracks(instance, true);
            if tracks.is_empty() {
                None
            } else {
                Some((instance, tracks))
            }
        })
        .collect()
}

/// Easing de la preview (`effect-kit/params.ts::ease`), no el cúbico de los
/// keyframes de transform: son curvas distintas y el export tiene que seguir
/// a la preview.
pub(crate) fn effect_ease(t: f64, easing: &str) -> f64 {
    match easing {
        "hold" => 0.0,
        "ease-in" => t * t,
        "ease-out" => 1.0 - (1.0 - t) * (1.0 - t),
        "ease-in-out" => {
            if t < 0.5 {
                2.0 * t * t
            } else {
                1.0 - 2.0 * (1.0 - t) * (1.0 - t)
            }
        }
        _ => t,
    }
}

/// Port de `sampleKeyframes` (effect-kit/params.ts): sostiene los extremos y
/// interpola con el easing del keyframe anterior dentro de cada tramo.
pub(crate) fn sample_effect_track(track: &EffectParamTrack, frame: f64) -> f64 {
    let keys = &track.keys;
    let first = &keys[0];
    let last = &keys[keys.len() - 1];
    let frame = frame.max(0.0);
    if frame <= first.0 as f64 {
        return first.1;
    }
    if frame >= last.0 as f64 {
        return last.1;
    }
    for pair in keys.windows(2) {
        let prev = &pair[0];
        let next = &pair[1];
        if frame <= next.0 as f64 {
            let span = (next.0 - prev.0).max(1) as f64;
            let progress = (frame - prev.0 as f64) / span;
            let t = match &prev.2 {
                SegmentEasing::Bezier(cp1_x, cp1_y, cp2_x, cp2_y) => {
                    cubic_bezier_progress(progress, *cp1_x, *cp1_y, *cp2_x, *cp2_y)
                }
                SegmentEasing::Preset(easing) => effect_ease(progress, easing),
            };
            return prev.1 + (next.1 - prev.1) * t;
        }
    }
    last.1
}

/// Parámetros de una instancia evaluados en un frame local del clip: los
/// keyframes muestrean sólo los parámetros animados; el resto queda como está.
pub(crate) fn effect_params_at(
    instance: &Value,
    tracks: &[EffectParamTrack],
    local_frame: f64,
) -> Value {
    let empty = Value::Object(serde_json::Map::new());
    let base = instance.get("params").unwrap_or(&empty);
    if tracks.is_empty() {
        return base.clone();
    }
    let mut params = base.as_object().cloned().unwrap_or_default();
    for track in tracks {
        params.insert(
            track.param.clone(),
            Value::from(sample_effect_track(track, local_frame)),
        );
    }
    Value::Object(params)
}

/// Aplica el stack con keyframes mediante render segmentado.
///
/// `lead_seconds` es la ventana de transición que precede al inicio del clip
/// dentro del stream (los keyframes son locales al clip: el frame `f` del clip
/// vive en el frame `lead_frames + f` del stream). Devuelve `None` cuando no
/// hay keyframes útiles o los tramos superan el tope: el llamador cae al
/// stack estático.
pub(crate) fn apply_effect_stack_animated(
    chain: String,
    label: &str,
    effects: &Value,
    lead_seconds: f64,
    clip_seconds: f64,
    fps: f64,
) -> Option<String> {
    let stack = effects.get("stack").and_then(Value::as_array)?;
    if stack.is_empty() {
        return None;
    }
    let tracks_per_instance = effect_keyframe_tracks(effects);
    if !tracks_per_instance.iter().any(|tracks| !tracks.is_empty()) {
        return None;
    }
    let output = format!("[{label}]");
    let prefix = chain.strip_suffix(&output).map(str::to_owned)?;

    let rate = fps.max(1.0);
    let lead_frames = (lead_seconds.max(0.0) * rate).round() as i64;
    let total_frames = ((lead_seconds.max(0.0) + clip_seconds.max(0.0)) * rate)
        .round()
        .max(1.0) as u64;

    // Cortes del stream: 0, total y cada keyframe corrido por el lead.
    let mut cuts: Vec<u64> = vec![0, total_frames];
    for (instance_index, instance) in stack.iter().enumerate() {
        if !instance
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            continue;
        }
        for track in &tracks_per_instance[instance_index] {
            for (frame, _, _) in &track.keys {
                let stream_frame = lead_frames + *frame as i64;
                if stream_frame > 0 && (stream_frame as u64) < total_frames {
                    cuts.push(stream_frame as u64);
                }
            }
        }
    }
    cuts.sort_unstable();
    cuts.dedup();
    if cuts.len() < 3 {
        // Todos los keyframes caen fuera del clip: no hay nada que animar.
        return None;
    }
    let segment_count = cuts.len() - 1;
    if segment_count > MAX_EFFECT_SEGMENTS {
        return None;
    }

    let src = format!("kfsrc{label}");
    let mut graph = format!("{prefix}[{src}];[{src}]split={segment_count}");
    for index in 0..segment_count {
        graph.push_str(&format!("[k{index}]"));
    }

    for (index, window) in cuts.windows(2).enumerate() {
        let (start, end) = (window[0], window[1]);
        if end <= start {
            continue;
        }
        // Punto medio del tramo en frames locales del clip (puede ser
        // negativo durante el lead: la pista sostiene el primer valor).
        let local_mid = (start + end) as f64 / 2.0 - lead_frames as f64;
        let mut body = String::new();
        for (instance_index, instance) in stack.iter().enumerate() {
            if !instance
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true)
            {
                continue;
            }
            let Some(effect_id) = instance.get("effectId").and_then(Value::as_str) else {
                continue;
            };
            let Some(recipe) = find_recipe(effect_id) else {
                continue;
            };
            let params =
                effect_params_at(instance, &tracks_per_instance[instance_index], local_mid);
            let segment_body = effect_instance_body(
                recipe,
                &params,
                &format!("{label}s{index}_{instance_index}"),
            );
            if segment_body.is_empty() {
                continue;
            }
            if !body.is_empty() {
                body.push(',');
            }
            body.push_str(&segment_body);
        }
        if body.is_empty() {
            // Tramo sin efectos renderizables: passthrough.
            body.push_str("null");
        }
        graph.push_str(&format!(
            ";[k{index}]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS,{body}[seg{index}]"
        ));
    }

    graph.push(';');
    for index in 0..segment_count {
        graph.push_str(&format!("[seg{index}]"));
    }
    graph.push_str(&format!("concat=n={segment_count}:v=1:a=0{output}"));
    Some(graph)
}

pub(crate) fn motion_blur_weights(frames: usize, intensity: f64) -> String {
    let intensity = intensity.clamp(0.0, 1.0);
    let mut weights = Vec::with_capacity(frames);
    for index in 0..frames {
        // El frame actual (último) pesa 1; los anteriores decaen con la
        // intensidad. Con 0 sólo queda el actual; con 1 se promedian todos.
        weights.push(intensity.powi((frames - 1 - index) as i32));
    }
    let total: f64 = weights.iter().sum::<f64>().max(f64::EPSILON);
    weights
        .iter()
        .map(|weight| format!("{:.5}", weight / total))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Adjustment layers only exist inside their timeline window. The LUT branch
/// can keep running, but the blend that mixes it is gated so outside the
/// window the first (original) input passes through.
pub(crate) fn apply_lut_to_chain_gated(
    chain: String,
    label: &str,
    lut: &Path,
    intensity: f64,
    enable: Option<(f64, f64)>,
) -> String {
    let Some((start, end)) = enable else {
        return apply_lut_to_chain(chain, label, lut, intensity);
    };
    let intensity = if intensity.is_finite() {
        intensity.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let output = format!("[{label}]");
    let Some(prefix) = chain.strip_suffix(&output) else {
        return chain;
    };
    let gate = format!(":enable='between(t,{start:.6},{end:.6})'");
    if intensity <= 0.001 {
        return chain;
    }
    if intensity >= 0.999 {
        return format!("{prefix},{}{gate}[{label}]", lut_filter(lut));
    }
    let opacity = 1.0 - intensity;
    format!(
        "{prefix},format=rgba,split=2[{label}src][{label}lut];\
         [{label}lut]{}[{label}graded];\
         [{label}src][{label}graded]blend=all_mode=normal:all_opacity={opacity:.4}{gate}[{label}]",
        lut_filter(lut)
    )
}

/// Resolves the LUT path and its 0..1 intensity from a grade object.
pub(crate) fn effects_lut(
    effects: &Value,
    root: &Path,
) -> Result<Option<(PathBuf, f64)>, ProjectError> {
    let Some(relative) = effects["lutFile"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let path = resolve_inside_root(root, relative)?;
    let intensity = number(effects, "lutIntensity")
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    if intensity <= 0.001 {
        return Ok(None);
    }
    Ok(Some((path, intensity)))
}

/// Returns the same grade without its LUT, so the LUT can be mixed after the
/// color chain instead of being baked in at full strength.
pub(crate) fn without_lut(effects: &Value) -> Value {
    let mut grade = effects.clone();
    if let Some(object) = grade.as_object_mut() {
        object.remove("lutFile");
        object.remove("lutIntensity");
    }
    grade
}
