use super::*;

/// Filtros lineales de la pista: EQ de 3 bandas antes del fader y paneo de
/// balance lineal. El centro deja ambos canales a 1.0; un paneo extremo deja
/// mudo el canal opuesto.
///
/// Los keyframes de `panKeyframes` reemplazan al paneo estático (capturan el
/// knob, igual que el fader). Sus frames son absolutos de la timeline y el
/// grafo de cada clip ve `t` en segundos desde el inicio del clip, así que el
/// muestreo compara contra `frame/fps` pasando `(t+start_seconds)` como
/// variable de tiempo a `keyframe_expression` (el mismo anclaje de las curvas
/// Bézier pre-muestreadas con Newton). Devuelve los filtros inline y, si el
/// paneo es animado, las ganancias por canal que el caller convierte en
/// grafos extra.

pub(crate) fn track_audio_filters(
    track: &Value,
    start_seconds: f64,
    fps: f64,
    skip_pan: bool,
) -> (Vec<String>, Option<TrackPanAutomation>) {
    let mut filters = Vec::new();
    for (frequency, key) in [
        (120.0, "eqLowDb"),
        (1_000.0, "eqMidDb"),
        (8_000.0, "eqHighDb"),
    ] {
        let gain = number(track, key).unwrap_or(0.0).clamp(-12.0, 12.0);
        if gain.abs() > 0.01 {
            filters.push(format!("equalizer=f={frequency:.1}:t=q:w=1:g={gain:.2}"));
        }
    }
    // El paneo por clip tiene prioridad: el llamador pide omitir el de pista
    // para no multiplicar dos balances.
    if skip_pan {
        return (filters, None);
    }
    if let Some(keyframes) = track["panKeyframes"].as_array() {
        let time_var = format!("(t+{:.6})", start_seconds.max(0.0));
        if let Some(pan) = keyframe_expression(keyframes, "value", fps, &time_var) {
            // Balance lineal animado: el mismo mapeo del paneo estático
            // (izquierdo 1-max(pan,0); derecho 1+min(pan,0)), evaluado por
            // frame. La condición del izquierdo se escribe con `lt` invertido
            // para que la expresión no dependa de otro comparador.
            let left = format!("if(lt(0,{pan}),1-({pan}),1)");
            let right = format!("if(lt({pan},0),1+({pan}),1)");
            return (filters, Some(TrackPanAutomation { left, right }));
        }
    }
    let pan = number(track, "pan").unwrap_or(0.0).clamp(-1.0, 1.0);
    if pan.abs() > 0.001 {
        let left = if pan <= 0.0 { 1.0 } else { 1.0 - pan };
        let right = if pan >= 0.0 { 1.0 } else { 1.0 + pan };
        filters.push(format!("pan=stereo|c0={left:.4}*c0|c1={right:.4}*c1"));
    }
    (filters, None)
}

pub(crate) fn audio_filter(
    input_index: usize,
    profile: &Profile,
    project_fps: f64,
    clip_seconds: f64,
    lead_seconds: f64,
    start_seconds: f64,
    audio: &Value,
    reverse: bool,
    speed_num: u32,
    speed_den: u32,
    track_gain_db: f64,
    track: &Value,
    effects: &Value,
) -> String {
    let lead = lead_seconds.max(0.0);
    let gain_db = number(audio, "gainDb").unwrap_or(0.0).clamp(-60.0, 12.0);
    let mut filters = vec![
        format!("aresample={}", profile.audio_rate),
        "aformat=sample_fmts=fltp:channel_layouts=stereo".to_owned(),
        "asetpts=PTS-STARTPTS".to_owned(),
    ];
    if speed_num != speed_den {
        let factor = speed_num as f64 / speed_den as f64;
        let mut remaining = factor;
        while remaining > 2.0 {
            filters.push("atempo=2.0".to_owned());
            remaining /= 2.0;
        }
        while remaining < 0.5 {
            filters.push("atempo=0.5".to_owned());
            remaining /= 0.5;
        }
        filters.push(format!("atempo={remaining:.5}"));
    }
    if lead > 0.001 {
        filters.push(format!(
            "atrim=start={}:duration={}",
            seconds(lead),
            seconds(clip_seconds)
        ));
    } else {
        filters.push(format!("atrim=duration={}", seconds(clip_seconds)));
    }
    filters.push("asetpts=PTS-STARTPTS".to_owned());
    if reverse {
        filters.push("areverse".to_owned());
    }

    let high_pass = number(audio, "highPassHz")
        .unwrap_or(0.0)
        .clamp(20.0, 2_000.0);
    if high_pass > 20.0 {
        filters.push(format!("highpass=f={high_pass:.1}"));
    }
    let low_pass = number(audio, "lowPassHz")
        .unwrap_or(0.0)
        .clamp(1_000.0, 20_000.0);
    if low_pass > 1_000.0 {
        filters.push(format!("lowpass=f={low_pass:.1}"));
    }
    for (frequency, key) in [
        (100.0, "eqLowDb"),
        (1_000.0, "eqMidDb"),
        (8_000.0, "eqHighDb"),
    ] {
        let gain = number(audio, key).unwrap_or(0.0).clamp(-12.0, 12.0);
        if gain.abs() > 0.01 {
            filters.push(format!("equalizer=f={frequency:.1}:t=q:w=1:g={gain:.2}"));
        }
    }
    let denoise = number(audio, "denoise").unwrap_or(0.0).clamp(0.0, 1.0);
    if denoise > 0.001 {
        filters.push(format!("afftdn=nr={:.1}:nf=-25", denoise * 30.0));
    }
    if audio["deesser"].as_bool().unwrap_or(false) {
        filters.push("deesser=i=0.4:m=0.5:f=0.5".to_owned());
    }
    if let Some(gate) = number(audio, "gateDb") {
        let threshold = gate.clamp(-60.0, -10.0);
        filters.push(format!(
            "agate=threshold={threshold:.1}dB:ratio=2:attack=5:release=120"
        ));
    }
    if audio["compressor"].as_bool().unwrap_or(false) {
        filters
            .push("acompressor=threshold=-18dB:ratio=3:attack=5:release=100:makeup=2".to_owned());
    }

    // Paneo por clip: misma ley lineal que el paneo de pista y prioridad sobre
    // él (el llamador omite el paneo de pista para no multiplicar balances).
    let clip_pan = number(audio, "pan").unwrap_or(0.0).clamp(-1.0, 1.0);
    let has_clip_pan = clip_pan.abs() > 0.001;
    if has_clip_pan {
        let left_gain = if clip_pan <= 0.0 { 1.0 } else { 1.0 - clip_pan };
        let right_gain = if clip_pan >= 0.0 { 1.0 } else { 1.0 + clip_pan };
        filters.push(format!(
            "pan=stereo|c0={left_gain:.4}*c0|c1={right_gain:.4}*c1"
        ));
    }

    match audio["voiceEffect"].as_str().unwrap_or("") {
        "deep" => filters.push(format!(
            "asetrate={}*0.86,aresample={},atempo={:.5}",
            profile.audio_rate,
            profile.audio_rate,
            1.0 / 0.86
        )),
        "chipmunk" => filters.push(format!(
            "asetrate={}*1.22,aresample={},atempo={:.5}",
            profile.audio_rate,
            profile.audio_rate,
            1.0 / 1.22
        )),
        "robot" => filters.push("vibrato=f=32:d=0.45,aecho=0.8:0.8:18:0.25".to_owned()),
        "echo" => filters.push("aecho=0.8:0.9:500|1000:0.4|0.25".to_owned()),
        "cave" => filters.push("aecho=0.8:0.9:1200|1800:0.35|0.2".to_owned()),
        "radio" => filters.push(
            "highpass=f=350,lowpass=f=3200,acompressor=threshold=-18dB:ratio=4:attack=5:release=80"
                .to_owned(),
        ),
        _ => {}
    }

    // Cadena declarativa de audio del clip. Va después de los presets de voz
    // (que son un atajo del mismo tipo de procesamiento) y antes del fader:
    // el stack es un insert, la ganancia es el control de mezcla.
    // Con keyframes el stack se renderiza segmentado (los filtros de audio
    // evalúan opciones al init, igual que los de video): la cadena pre-stack
    // cierra en `akp`, `asplit` abre un tramo por corte de keyframe y `concat`
    // recompone en `astk`. El resto de la cadena (ganancia, pista, fades,
    // paneo) sigue detrás del concat con el mismo `t` local del clip.
    let anim_instances = audio_stack_keyframe_instances(effects);
    let (stack_graphs, audio_head) = match audio_stack_segment_plan(
        &anim_instances,
        clip_seconds,
        project_fps,
        profile.audio_rate,
    ) {
        Some(plan) if !anim_instances.is_empty() => {
            let pre = std::mem::take(&mut filters);
            (
                build_audio_stack_graphs(
                    input_index,
                    pre,
                    &anim_instances,
                    &plan,
                    profile.audio_rate,
                ),
                format!("astk{input_index}"),
            )
        }
        _ => {
            apply_audio_effect_stack(&mut filters, effects, profile.audio_rate);
            (Vec::new(), format!("{input_index}:a"))
        }
    };

    let gain_keyframes = audio["gainKeyframes"]
        .as_array()
        .and_then(|keyframes| keyframe_expression(keyframes, "gainDb", profile.fps(), "t"));
    if let Some(expression) = gain_keyframes {
        if let Ok(value) = expression.parse::<f64>() {
            if value.abs() > 0.001 {
                filters.push(format!("volume={value:.2}dB"));
            }
        } else {
            filters.push(format!(
                "volume=volume='pow(10,({expression})/20)':eval=frame"
            ));
        }
    } else if gain_db.abs() > 0.001 {
        filters.push(format!("volume={gain_db:.2}dB"));
    }
    let track_gain = track_gain_db.clamp(-60.0, 12.0);
    let (track_filters, track_pan_graph) =
        track_audio_filters(track, start_seconds, project_fps, has_clip_pan);
    filters.extend(track_filters);
    // El fader animado reemplaza al estático, igual que las claves de ganancia
    // de clip: `volume` evaluado por frame en dB→lineal. Los frames son
    // absolutos de la timeline, así que el tiempo del grafo (`t` desde el
    // inicio del clip) se compara en segundos absolutos con `(t+start)`.
    let track_time_var = format!("(t+{:.6})", start_seconds.max(0.0));
    let track_gain_expression = track["gainKeyframes"].as_array().and_then(|keyframes| {
        keyframe_expression(keyframes, "gainDb", project_fps, &track_time_var)
    });
    let mut after_pan: Vec<String> = Vec::new();
    match track_gain_expression {
        Some(expression) => {
            after_pan.push(format!(
                "volume=volume='pow(10,({expression})/20)':eval=frame"
            ));
        }
        None => {
            if track_gain.abs() > 0.001 {
                after_pan.push(format!("volume={track_gain:.2}dB"));
            }
        }
    }
    let fade_in = (audio["fadeInFrames"].as_u64().unwrap_or(0) as f64 / profile.fps())
        .clamp(0.0, clip_seconds);
    let fade_out = (audio["fadeOutFrames"].as_u64().unwrap_or(0) as f64 / profile.fps())
        .clamp(0.0, clip_seconds);
    if fade_in > 0.001 {
        after_pan.push(format!("afade=t=in:st=0:d={}", seconds(fade_in)));
    }
    if fade_out > 0.001 {
        after_pan.push(format!(
            "afade=t=out:st={}:d={}",
            seconds((clip_seconds - fade_out).max(0.0)),
            seconds(fade_out)
        ));
    }
    if start_seconds > 0.001 {
        after_pan.push(format!(
            "adelay=delays={}:all=1",
            (start_seconds * 1000.0).round() as u64
        ));
    }
    if let Some(pan_graph) = track_pan_graph {
        // Paneo animado: la cadena se parte por canal porque `pan` no sigue el
        // tiempo. El EQ y el resto de filtros lineales quedan antes del split;
        // la ganancia de pista, los fades y el delay se aplican al estéreo
        // recompuesto, en el mismo orden que la cadena sin paneo animado.
        let split_label = format!("tp{input_index}");
        let left_label = format!("tpl{input_index}");
        let right_label = format!("tpr{input_index}");
        let left_gained = format!("tpgl{input_index}");
        let right_gained = format!("tpgr{input_index}");
        let tail = if after_pan.is_empty() {
            String::new()
        } else {
            format!(",{}", after_pan.join(","))
        };
        let mut graphs: Vec<String> = stack_graphs;
        graphs.extend([
            format!("[{audio_head}]{}[{split_label}]", filters.join(",")),
            format!("[{split_label}]channelsplit=channel_layout=stereo[{left_label}][{right_label}]"),
            format!(
                "[{left_label}]volume=volume='{}':eval=frame[{left_gained}]",
                pan_graph.left
            ),
            format!(
                "[{right_label}]volume=volume='{}':eval=frame[{right_gained}]",
                pan_graph.right
            ),
            format!("[{left_gained}][{right_gained}]join=inputs=2:channel_layout=stereo{tail}[a{input_index}]"),
        ]);
        return graphs.join(";");
    }
    filters.extend(after_pan);
    let tail = format!("[{audio_head}]{}[a{input_index}]", filters.join(","));
    if stack_graphs.is_empty() {
        tail
    } else {
        let mut graphs = stack_graphs;
        graphs.push(tail);
        graphs.join(";")
    }
}

pub struct BuildPlanInput<'a> {
    pub project: &'a Value,
    pub root: &'a Path,
    pub profile: &'a Profile,
    pub output_path: &'a Path,
    pub include_captions: bool,
    pub temp_dir: &'a Path,
    pub ffprobe: &'a Path,
    /// ASS generated from the motion plans; `None` means the caller did not
    /// provide plans. A visible graphic clip without a plan is an error.
    pub motion_ass: Option<&'a str>,
    /// Modo medición: arma sólo el grafo de audio de la mezcla (PCM f32le por
    /// stdout) sin cadena de video y sin loudnorm/limitador de entrega, para
    /// medir el loudness real de la mezcla con `filmcraft-audio-dsp`.
    pub audio_only: bool,
}
