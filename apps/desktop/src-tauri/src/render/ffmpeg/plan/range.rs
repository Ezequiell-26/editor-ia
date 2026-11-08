pub(crate) fn build_plan_range(
    input: BuildPlanInput<'_>,
    range: Option<(u64, u64)>,
) -> Result<RenderPlan, ProjectError> {
    let expanded_project;
    let project = if input
        .project
        .get("compounds")
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false)
    {
        expanded_project = expand_compounds(input.project)?;
        &expanded_project
    } else {
        input.project
    };
    let profile = input.profile;
    let project_fps_num = project["video"]["frameRate"]["num"].as_u64().unwrap_or(30) as f64;
    let project_fps_den = project["video"]["frameRate"]["den"].as_u64().unwrap_or(1) as f64;
    let project_fps = (project_fps_num / project_fps_den.max(1.0)).max(1.0);
    let project_width = project["video"]["width"].as_u64().unwrap_or(1920) as u32;
    let background = hex_color(text(&project["video"], "backgroundColor").unwrap_or("#0f1319"));

    let tracks = project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let track_info: HashMap<String, (String, u64, bool, bool)> = tracks
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?.to_owned(),
                (
                    track["kind"].as_str().unwrap_or("").to_owned(),
                    track["order"].as_u64().unwrap_or(0),
                    track["hidden"].as_bool().unwrap_or(false),
                    track["muted"].as_bool().unwrap_or(false),
                ),
            ))
        })
        .collect();
    // Mezcla por pista: la ganancia se aplica a todo su audio y el solo
    // silencia las demás pistas con señal (video, audio y narración).
    let track_mix: HashMap<String, (f64, bool)> = tracks
        .iter()
        .filter_map(|track| {
            Some((
                track["id"].as_str()?.to_owned(),
                (
                    number(track, "gainDb").unwrap_or(0.0).clamp(-60.0, 12.0),
                    track["solo"].as_bool().unwrap_or(false),
                ),
            ))
        })
        .collect();
    let any_solo = tracks.iter().any(|track| {
        track["solo"].as_bool().unwrap_or(false)
            && !track["muted"].as_bool().unwrap_or(false)
            && matches!(
                track["kind"].as_str().unwrap_or(""),
                "video" | "audio" | "narration"
            )
    });
    let assets = project["assets"].as_array().cloned().unwrap_or_default();
    let asset_by_id: HashMap<String, Value> = assets
        .iter()
        .filter_map(|asset| Some((asset["id"].as_str()?.to_owned(), asset.clone())))
        .collect();
    let tracks = project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut track_by_id: HashMap<String, Value> = tracks
        .iter()
        .filter_map(|track| Some((track["id"].as_str()?.to_owned(), track.clone())))
        .collect();
    // Misma regla que la preview: si algún clip de la pista define paneo por
    // clip, el paneo de pista se omite para toda la pista (los clips sin
    // paneo propio quedan centrados). Evita apilar dos balances distintos.
    let clip_pan_tracks: HashSet<String> = project["timeline"]["clips"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|clip| {
            clip["audio"]["pan"]
                .as_f64()
                .map(|pan| pan.abs() > 0.001)
                .unwrap_or(false)
        })
        .filter_map(|clip| clip["trackId"].as_str().map(str::to_owned))
        .collect();
    for (track_id, track) in track_by_id.iter_mut() {
        if !clip_pan_tracks.contains(track_id) {
            continue;
        }
        if let Some(object) = track.as_object_mut() {
            object.insert("pan".to_owned(), serde_json::json!(0.0));
            object.remove("panKeyframes");
        }
    }
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    if clips
        .iter()
        .any(|clip| clip["mask"]["shape"].as_str() == Some("text"))
        && text_mask_font().is_none()
    {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "no se encontró una fuente TTF para la máscara de texto (seguisb.ttf, arialbd.ttf, segoeui.ttf o arial.ttf)",
        ));
    }
    if clips.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "la timeline no tiene clips para renderizar",
        ));
    }

    let mut total_frames = 0u64;
    for clip in &clips {
        let start = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        total_frames = total_frames.max(start + duration);
    }
    for cue in project["captions"]["cues"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        total_frames = total_frames.max(cue["endFrame"].as_u64().unwrap_or(0));
    }
    if total_frames == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "la timeline no tiene duración para renderizar",
        ));
    }
    let duration_seconds = total_frames as f64 / project_fps;
    let (output_start_seconds, output_duration_seconds) = match range {
        Some((start, end)) => {
            let start = start.min(total_frames);
            let end = end.min(total_frames);
            if end <= start {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el rango de exportación está vacío; elegí un inicio menor al final",
                ));
            }
            (
                start as f64 / project_fps,
                (end - start) as f64 / project_fps,
            )
        }
        None => (0.0, duration_seconds),
    };

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-y".into(),
        "-nostdin".into(),
        "-loglevel".into(),
        "error".into(),
    ];
    // En modo medición stdout lleva el PCM decodificado: `-progress pipe:1`
    // escribiría su informe sobre las muestras y las corrompería.
    if !input.audio_only {
        args.extend(["-progress".into(), "pipe:1".into(), "-nostats".into()]);
    }
    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!(
            "color=c={}:s={}x{}:r={}:d={}",
            background,
            profile.width,
            profile.height,
            profile.fps_arg(),
            seconds(duration_seconds)
        ),
    ]);
    let mut visual_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
            if clip["enabled"].as_bool() == Some(false) {
                return false;
            }
            let track_id = clip["trackId"].as_str().unwrap_or("");
            track_info
                .get(track_id)
                .map(|(kind, _, hidden, _)| {
                    matches!(kind.as_str(), "video" | "image" | "graphic") && !hidden
                })
                .unwrap_or(false)
        })
        .collect();
    visual_clips.sort_by_key(|clip| {
        let track_id = clip["trackId"].as_str().unwrap_or("");
        let order = track_info.get(track_id).map(|info| info.1).unwrap_or(0);
        (order, clip["startFrame"].as_u64().unwrap_or(0))
    });

    // Composición sin alfa: si ningún clip, máscara, transición, blend ni
    // efecto produce o consume transparencia, el grafo compone en yuv420p y
    // cada capa evita las conversiones RGBA por frame.
    let compose_format = if composition_needs_alpha(
        &visual_clips,
        &asset_by_id,
        &track_info,
        project,
        profile,
        project_fps,
    ) {
        "rgba"
    } else {
        "yuv420p"
    };
    let mut inputs = 1usize;
    let mut filters: Vec<String> = vec![format!(
        "[0:v]format={compose_format},setpts=PTS-STARTPTS[base0]"
    )];
    let mut base_label = "base0".to_owned();
    let mut audio_labels: Vec<String> = Vec::new();
    // Gemelo de `filters` con sólo las cadenas de audio: en modo medición el
    // grafo final se arma desde acá, sin las cadenas de video.
    let mut audio_filters: Vec<String> = Vec::new();
    let mut audio_track_ids: Vec<String> = Vec::new();

    let mut probed_audio: HashMap<String, bool> = HashMap::new();
    for clip in visual_clips {
        let kind = text(clip, "kind").unwrap_or("video");
        let track_id = text(clip, "trackId").unwrap_or("");
        let (_, _, _, muted) =
            track_info
                .get(track_id)
                .cloned()
                .unwrap_or(("video".to_owned(), 0, false, false));
        let (track_gain, track_solo) = track_mix.get(track_id).copied().unwrap_or((0.0, false));
        let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        if clip_seconds <= 0.0 {
            continue;
        }
        let lead_seconds = transition_lead_seconds(clip, project_fps, clip_seconds, start_seconds);
        if kind == "graphic" {
            if input.motion_ass.is_none() || input.motion_ass == Some("") {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    "el clip gráfico no tiene un plan de motion; volvé a exportar desde el editor",
                ));
            }
            // The graphic is burned by the motion ASS generated from the plan
            // before the caption pass; it owns no media input here.
            continue;
        }
        let asset_id = clip["source"]["assetId"].as_str().unwrap_or("");
        let asset = asset_by_id.get(asset_id).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "un clip apunta a un material que ya no está en el proyecto",
            )
        })?;
        if asset["status"].as_str() != Some("ready") {
            return Err(ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "hay material sin verificar; confirmá sus derechos y marcalo listo antes de exportar",
            ));
        }
        if asset["rights"]["license"]["commercialUse"].as_str() == Some("unknown") {
            return Err(ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "hay material con licencia desconocida; resolvé sus derechos antes de exportar",
            ));
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let path = resolve_inside_root(input.root, relative)?;
        ensure_asset_unchanged(asset, &path)?;
        let clip_lut = effects_lut(&clip["effects"], input.root)?;
        let stabilization = resolve_stabilization(clip, input.root)?;
        let is_image = kind == "image" || kind == "freeze";
        let speed = clip["speed"].clone();
        let speed_num = speed["num"].as_u64().unwrap_or(1) as u32;
        let speed_den = speed["den"].as_u64().unwrap_or(1) as u32;
        let speed_den = speed_den.max(1);
        let speed_num = speed_num.max(1);
        // Con curva, la velocidad constante que usan el audio, el seek y la
        // ventana de origen es la media de la curva; el video se retima por
        // frame con el `setpts` por tramos.
        let (speed_num, speed_den) = match parse_speed_curve(&clip) {
            Some(points) => {
                let den = 1_000u32;
                let num = (curve_mean(&points) * den as f64)
                    .round()
                    .clamp(1.0, 4_000.0) as u32;
                (num, den)
            }
            None => (speed_num, speed_den),
        };
        let blend = clip["blendMode"].as_str().and_then(blend_mode_name);
        let layer_index = if blend.is_some() {
            let index = inputs;
            inputs += 1;
            args.extend([
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                format!(
                    "color=c=black@0.0:s={}x{}:r={}:d={}",
                    profile.width,
                    profile.height,
                    profile.fps_arg(),
                    seconds(duration_seconds)
                ),
            ]);
            Some(index)
        } else {
            None
        };

        if is_image {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-framerate".into(),
                profile.fps_arg(),
                "-t".into(),
                seconds(clip_seconds + lead_seconds),
                "-i".into(),
                path.to_string_lossy().into_owned(),
            ]);
        } else {
            let in_seconds = clip["source"]["inFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
            let source_seconds =
                (clip_seconds + lead_seconds) * (speed_num as f64 / speed_den as f64);
            let seek_seconds =
                (in_seconds - lead_seconds * (speed_num as f64 / speed_den as f64)).max(0.0);
            args.extend([
                "-ss".into(),
                seconds(seek_seconds),
                "-t".into(),
                seconds(source_seconds),
            ]);
            if let Some(decoder) = alpha_video_decoder(asset) {
                args.extend(["-c:v".into(), decoder.into()]);
            }
            args.push("-i".into());
            args.push(path.to_string_lossy().into_owned());
        }
        let index = inputs;
        inputs += 1;
        // Aislamiento de voz: si el clip lo pide y `prepare_voice_isolation`
        // ya generó el stem, su audio reemplaza al del material. El stem es el
        // wav del archivo completo, así que se le aplica la misma ventana
        // -ss/-t que al input de video para alinear el in-point del clip.
        let stem_index =
            if !is_image && clip["audio"]["voiceIsolation"]["enabled"].as_bool() == Some(true) {
                let stem = isolation_stem_path(input.root, asset_id);
                if stem.is_file() {
                    let in_seconds =
                        clip["source"]["inFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
                    let ratio = speed_num as f64 / speed_den as f64;
                    let source_seconds = (clip_seconds + lead_seconds) * ratio;
                    let seek_seconds = (in_seconds - lead_seconds * ratio).max(0.0);
                    args.extend([
                        "-ss".into(),
                        seconds(seek_seconds),
                        "-t".into(),
                        seconds(source_seconds),
                        "-i".into(),
                        stem.to_string_lossy().into_owned(),
                    ]);
                    let stem_index = inputs;
                    inputs += 1;
                    Some(stem_index)
                } else {
                    None
                }
            } else {
                None
            };
        // `luma-wipe`: el mate es una entrada extra que sólo alimenta la
        // máscara de luminancia; nunca se compone como capa visible.
        let luma = luma_mate(
            &clips,
            &asset_by_id,
            input.root,
            clip,
            project_fps,
            clip_seconds,
            lead_seconds,
            start_seconds,
        )?;
        let luma_index = if let Some(mate) = luma {
            let mate_index = inputs;
            inputs += 1;
            if mate.is_image {
                args.extend([
                    "-loop".into(),
                    "1".into(),
                    "-framerate".into(),
                    profile.fps_arg(),
                    "-t".into(),
                    seconds(mate.source_seconds),
                    "-i".into(),
                    mate.path.to_string_lossy().into_owned(),
                ]);
            } else {
                args.extend([
                    "-ss".into(),
                    seconds(mate.seek_seconds),
                    "-t".into(),
                    seconds(mate.source_seconds),
                    "-i".into(),
                    mate.path.to_string_lossy().into_owned(),
                ]);
            }
            Some((mate_index, mate.frozen))
        } else {
            None
        };
        filters.push(visual_filter_with_format(
            index,
            clip,
            asset,
            profile,
            clip_seconds,
            lead_seconds,
            start_seconds,
            speed_num,
            speed_den,
            is_image,
            compose_format,
        ));
        if let Some((transform, smoothing)) = stabilization.as_ref() {
            let position = filters.len() - 1;
            let chain = filters[position].clone();
            filters[position] = with_stabilization(chain, index, transform, *smoothing);
        }
        if let Some((lut, intensity)) = clip_lut {
            let position = filters.len() - 1;
            let chain = filters[position].clone();
            filters[position] = apply_lut_to_chain(chain, &format!("v{index}"), &lut, intensity);
        }
        let position = filters.len() - 1;
        let chain = filters[position].clone();
        filters[position] = apply_glow_to_chain(chain, &format!("v{index}"), &clip["effects"]);
        let chain = filters[position].clone();
        // Con keyframes de efecto el stack se hornea por tramos (split+trim+
        // concat); sin ellos —o si los tramos superan el tope— queda el
        // comportamiento estático de siempre.
        filters[position] = apply_effect_stack_animated(
            chain.clone(),
            &format!("v{index}"),
            &clip["effects"],
            lead_seconds,
            clip_seconds,
            profile.fps(),
        )
        .unwrap_or_else(|| apply_effect_stack(chain, &format!("v{index}"), &clip["effects"]));
        // El wipe por luminancia se aplica después de toda la cadena del clip
        // (máscara, keyframes, LUT, glow): el alfa que escriba `alphamerge`
        // reemplaza al de la entrada durante el lead.
        let mut overlay_source = format!("v{index}");
        if let Some((mate_index, mate_frozen)) = luma_index {
            if mate_frozen {
                filters.push(luma_frozen_graph(index, mate_index, &profile.fps_arg()));
            } else {
                filters.push(luma_wipe_graph(
                    index,
                    mate_index,
                    profile.fps(),
                    &profile.fps_arg(),
                    lead_seconds,
                    (start_seconds - lead_seconds).max(0.0),
                ));
            }
            overlay_source = format!("v{index}out");
        }
        let transform = &clip["transform"];
        let offset_x = offset_expression(clip, "offsetX", start_seconds, project_fps)
            .unwrap_or_else(|| {
                format!(
                    "{:.3}",
                    sanitize_filter_number(number(transform, "offsetX").unwrap_or(0.0))
                )
            });
        let offset_y = offset_expression(clip, "offsetY", start_seconds, project_fps)
            .unwrap_or_else(|| {
                format!(
                    "{:.3}",
                    sanitize_filter_number(number(transform, "offsetY").unwrap_or(0.0))
                )
            });
        let next_label = format!("base{}", index);
        let (animation_x, animation_y) =
            animation_overlay_terms(clip, start_seconds, clip_seconds, profile.fps());
        let overlay_x = match animation_x {
            Some(term) => format!(
                "({})+({term})",
                overlay_x_expression(clip, start_seconds, lead_seconds, &offset_x)
            ),
            None => overlay_x_expression(clip, start_seconds, lead_seconds, &offset_x),
        };
        let overlay_y = overlay_y_expression(
            clip,
            start_seconds,
            lead_seconds,
            &offset_y,
            animation_y.as_deref(),
        );
        // Desplazamiento de un slide congelado por la ventana de un frame.
        let overlay_x = match clip["transitionFrozen"]["x"].as_f64() {
            Some(x) => format!("({overlay_x})+({x:.6})"),
            None => overlay_x,
        };
        let overlay_y = match clip["transitionFrozen"]["y"].as_f64() {
            Some(y) => format!("({overlay_y})+({y:.6})"),
            None => overlay_y,
        };
        let overlay_x = match clip["animationFrozen"]["x"].as_f64() {
            Some(x) => format!("({overlay_x})+({x:.6})"),
            None => overlay_x,
        };
        let overlay_y = match clip["animationFrozen"]["y"].as_f64() {
            Some(y) => format!("({overlay_y})+({y:.6})"),
            None => overlay_y,
        };
        if let (Some(mode), Some(layer)) = (blend, layer_index) {
            filters.push(format!(
                "[{layer}:v]format={compose_format},setpts=PTS-STARTPTS[layer{index}]"
            ));
            filters.push(format!(
                "[layer{index}][{overlay_source}]overlay=x='{overlay_x}':y='{overlay_y}':enable='between(t,{:.6},{:.6})':eof_action=pass:shortest=0[blended{index}]",
                (start_seconds - lead_seconds).max(0.0),
                start_seconds + clip_seconds
            ));
            filters.push(format!(
                "[{base_label}][blended{index}]blend=all_mode={mode}:enable='between(t,{:.6},{:.6})'[{next_label}]",
                (start_seconds - lead_seconds).max(0.0),
                start_seconds + clip_seconds
            ));
        } else {
            filters.push(format!(
                "[{base_label}][{overlay_source}]overlay=x='{overlay_x}':y='{overlay_y}':enable='between(t,{:.6},{:.6})':eof_action=pass:shortest=0[{next_label}]",
                (start_seconds - lead_seconds).max(0.0),
                start_seconds + clip_seconds
            ));
        }
        base_label = next_label;

        let has_audio = if is_image {
            false
        } else {
            stem_index.is_some()
                || *probed_audio
                    .entry(asset_id.to_owned())
                    .or_insert_with(|| has_audio_stream(input.ffprobe, &path))
        };
        if has_audio
            && !muted
            && (!any_solo || track_solo || clip["audio"]["solo"].as_bool().unwrap_or(false))
            && clip["audio"]["muted"].as_bool() != Some(true)
        {
            let audio_source_index = stem_index.unwrap_or(index);
            let track = track_by_id.get(track_id).cloned().unwrap_or(Value::Null);
            let chain = audio_filter(
                audio_source_index,
                profile,
                project_fps,
                clip_seconds,
                lead_seconds,
                start_seconds,
                &clip["audio"],
                clip["reverse"].as_bool().unwrap_or(false),
                speed_num,
                speed_den,
                track_gain,
                &track,
                &clip["effects"],
            );
            filters.push(chain.clone());
            audio_filters.push(chain);
            audio_labels.push(format!("[a{audio_source_index}]"));
            audio_track_ids.push(track_id.to_owned());
        }
    }

    // Adjustment layers grade the composite, not one clip. Each chain gets the
    // same `enable` window, so the grade appears only while its clip is active.
    let mut adjustment_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
            if clip["enabled"].as_bool() == Some(false) {
                return false;
            }
            let track_id = clip["trackId"].as_str().unwrap_or("");
            track_info
                .get(track_id)
                .map(|(kind, _, hidden, _)| kind == "adjustment" && !hidden)
                .unwrap_or(false)
        })
        .collect();
    adjustment_clips.sort_by_key(|clip| {
        let track_id = clip["trackId"].as_str().unwrap_or("");
        let order = track_info.get(track_id).map(|info| info.1).unwrap_or(0);
        (order, clip["startFrame"].as_u64().unwrap_or(0))
    });
    for (index, clip) in adjustment_clips.iter().enumerate() {
        let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        if clip_seconds <= 0.0 {
            continue;
        }
        let grade = adjustment_filters(
            clip,
            input.root,
            start_seconds,
            start_seconds + clip_seconds,
        )?;
        let lut = effects_lut(&clip["effects"], input.root)?;
        if grade.is_empty() && lut.is_none() {
            continue;
        }
        let next_label = format!("adj{}", index);
        let grade_chain = if grade.is_empty() {
            "null".to_owned()
        } else {
            grade.join(",")
        };
        let mut chain = format!("[{base_label}]{grade_chain}[{next_label}]");
        if let Some((lut, intensity)) = lut {
            chain = apply_lut_to_chain_gated(
                chain,
                &next_label,
                &lut,
                intensity,
                Some((start_seconds, start_seconds + clip_seconds)),
            );
        }
        filters.push(chain);
        base_label = next_label;
    }

    let audio_clips: Vec<&Value> = clips
        .iter()
        .filter(|clip| {
            if clip["enabled"].as_bool() == Some(false) {
                return false;
            }
            let track_id = clip["trackId"].as_str().unwrap_or("");
            let audible = track_info
                .get(track_id)
                .map(|(kind, _, _, muted)| matches!(kind.as_str(), "audio" | "narration") && !muted)
                .unwrap_or(false);
            let solo = track_mix
                .get(track_id)
                .map(|(_, solo)| *solo)
                .unwrap_or(false);
            audible && (!any_solo || solo || clip["audio"]["solo"].as_bool().unwrap_or(false))
        })
        .collect();
    for clip in audio_clips {
        let track_id = clip["trackId"].as_str().unwrap_or("");
        let asset_id = clip["source"]["assetId"].as_str().unwrap_or("");
        let asset = asset_by_id.get(asset_id).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "un clip de audio apunta a un material que ya no está en el proyecto",
            )
        })?;
        if asset["status"].as_str() != Some("ready")
            || asset["rights"]["license"]["commercialUse"].as_str() == Some("unknown")
        {
            return Err(ProjectError::message(
                ProjectErrorCode::AssetNotReady,
                "hay audio sin derechos verificados; no se puede exportar todavía",
            ));
        }
        let relative = asset["source"]["path"].as_str().unwrap_or("");
        let path = resolve_inside_root(input.root, relative)?;
        ensure_asset_unchanged(asset, &path)?;
        // Aislamiento de voz: el stem generado por `prepare_voice_isolation`
        // reemplaza al audio original cuando el clip lo pide.
        let mut audio_path = path.clone();
        if clip["audio"]["voiceIsolation"]["enabled"].as_bool() == Some(true) {
            let stem = isolation_stem_path(input.root, asset_id);
            if stem.is_file() {
                audio_path = stem;
            }
        }
        let start_seconds = clip["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let clip_seconds = clip["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
        if clip_seconds <= 0.0 {
            continue;
        }
        if clip["audio"]["muted"].as_bool() == Some(true) {
            continue;
        }
        let speed = clip["speed"].clone();
        let speed_num = speed["num"].as_u64().unwrap_or(1).max(1) as u32;
        let speed_den = speed["den"].as_u64().unwrap_or(1).max(1) as u32;
        let in_seconds = clip["source"]["inFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let source_seconds = clip_seconds * (speed_num as f64 / speed_den as f64);
        args.extend([
            "-ss".into(),
            seconds(in_seconds),
            "-t".into(),
            seconds(source_seconds),
            "-i".into(),
            audio_path.to_string_lossy().into_owned(),
        ]);
        let index = inputs;
        inputs += 1;
        let (track_gain, _) = track_mix.get(track_id).copied().unwrap_or((0.0, false));
        let track = track_by_id.get(track_id).cloned().unwrap_or(Value::Null);
        let chain = audio_filter(
            index,
            profile,
            project_fps,
            clip_seconds,
            0.0,
            start_seconds,
            &clip["audio"],
            clip["reverse"].as_bool().unwrap_or(false),
            speed_num,
            speed_den,
            track_gain,
            &track,
            &clip["effects"],
        );
        filters.push(chain.clone());
        audio_filters.push(chain);
        audio_labels.push(format!("[a{index}]"));
        audio_track_ids.push(track_id.to_owned());
    }

    let master_gain = number(&project["audio"]["master"], "gainDb").unwrap_or(0.0);
    let loudness = &project["audio"]["loudnessTarget"];
    // En modo medición no se aplica loudnorm: se mide la mezcla cruda (con su
    // ganancia master) y el delta contra el objetivo se calcula aparte.
    let loudness_filter = if input.audio_only {
        String::new()
    } else if loudness.is_object() {
        let integrated = number(loudness, "integratedLufs")
            .unwrap_or(-14.0)
            .clamp(-33.0, -9.0);
        let true_peak = number(loudness, "truePeakDb")
            .unwrap_or(-1.5)
            .clamp(-9.0, 0.0);
        format!(",loudnorm=I={integrated:.1}:TP={true_peak:.1}:LRA=11")
    } else {
        String::new()
    };
    // Cola de entrega (normalización + limitador): sólo en el export real.
    let delivery_tail = if input.audio_only {
        String::new()
    } else {
        format!("{loudness_filter},alimiter=limit=0.95")
    };
    let silent_index;
    let audio_out_filter;
    if audio_labels.is_empty() {
        silent_index = inputs;
        args.extend([
            "-f".into(),
            "lavfi".into(),
            "-t".into(),
            seconds(duration_seconds),
            "-i".into(),
            format!(
                "anullsrc=channel_layout=stereo:sample_rate={}",
                profile.audio_rate
            ),
        ]);
        audio_out_filter = format!(
            "[{silent_index}:a]aresample={},aformat=sample_fmts=fltp:channel_layouts=stereo,volume={master_gain:.2}dB{delivery_tail}[aout]",
            profile.audio_rate
        );
    } else if audio_labels.len() == 1 {
        audio_out_filter = format!(
            "{}volume={master_gain:.2}dB{delivery_tail}[aout]",
            audio_labels[0]
        );
    } else {
        let ducking = &project["audio"]["ducking"];
        let ducking_enabled = ducking["enabled"].as_bool().unwrap_or(false);
        let source_tracks: Vec<String> = ducking["sourceTrackIds"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let target_tracks: Vec<String> = ducking["targetTrackIds"]
            .as_array()
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let mut source_labels: Vec<String> = Vec::new();
        let mut target_labels: Vec<String> = Vec::new();
        let mut other_labels: Vec<String> = Vec::new();
        for (index, label) in audio_labels.iter().enumerate() {
            let track = audio_track_ids.get(index).map(String::as_str).unwrap_or("");
            if target_tracks.iter().any(|id| id == track) {
                target_labels.push(label.clone());
            } else if source_tracks.iter().any(|id| id == track) {
                source_labels.push(label.clone());
            } else {
                other_labels.push(label.clone());
            }
        }
        if ducking_enabled && !source_labels.is_empty() && !target_labels.is_empty() {
            // Cadenas de audio del ducking: van a ambos grafos (video y
            // medición) porque ambas necesitan el lado y el objetivo unidos.
            let mut ducking_filters: Vec<String> = Vec::new();
            if source_labels.len() == 1 {
                ducking_filters.push(format!("{}asplit=2[duck_side][duck_src]", source_labels[0]));
            } else {
                ducking_filters.push(format!(
                    "{}amix=inputs={}:duration=longest:normalize=0,asplit=2[duck_side][duck_src]",
                    source_labels.join(""),
                    source_labels.len()
                ));
            }
            if target_labels.len() == 1 {
                ducking_filters.push(format!("{}anull[duck_target]", target_labels[0]));
            } else {
                ducking_filters.push(format!(
                    "{}amix=inputs={}:duration=longest:normalize=0[duck_target]",
                    target_labels.join(""),
                    target_labels.len()
                ));
            }
            // sidechaincompress termina con la entrada más corta: sin este
            // apad, la música se cortaba justo cuando terminaba la voz.
            ducking_filters.push("[duck_side]apad[duck_side_padded]".to_owned());
            let amount = number(ducking, "amountDb")
                .unwrap_or(-12.0)
                .clamp(-60.0, 0.0);
            let ratio = (-amount / 1.5).clamp(2.0, 20.0);
            ducking_filters.push(format!(
                "[duck_target][duck_side_padded]sidechaincompress=threshold=0.03:ratio={ratio:.1}:attack=20:release=350[ducked]"
            ));
            filters.extend(ducking_filters.iter().cloned());
            audio_filters.extend(ducking_filters);
            let mut final_labels = vec!["[ducked]".to_owned(), "[duck_src]".to_owned()];
            final_labels.extend(other_labels.iter().cloned());
            audio_out_filter = format!(
                "{}amix=inputs={}:duration=longest:normalize=0,volume={master_gain:.2}dB{delivery_tail}[aout]",
                final_labels.join(""),
                final_labels.len()
            );
        } else {
            audio_out_filter = format!(
                "{}amix=inputs={}:duration=longest:normalize=0,volume={master_gain:.2}dB{delivery_tail}[aout]",
                audio_labels.join(""),
                audio_labels.len()
            );
        }
    }
    filters.push(audio_out_filter.clone());
    audio_filters.push(audio_out_filter);

    // Modo medición: el grafo es sólo audio y la salida es PCM f32le por
    // stdout. Sin cadena de video, sin subtítulos, sin LUT: lo que se mide es
    // exactamente la mezcla que el export entrega antes de loudnorm.
    if input.audio_only {
        push_filter_complex(&mut args, audio_filters.join(";"), input.temp_dir)?;
        args.extend(["-map".into(), "[aout]".into()]);
        args.extend([
            "-ar".into(),
            profile.audio_rate.to_string(),
            "-ac".into(),
            profile.audio_channels.to_string(),
            "-f".into(),
            "f32le".into(),
        ]);
        if output_start_seconds > 0.0001 {
            args.extend(["-ss".into(), seconds(output_start_seconds)]);
        }
        args.extend(["-t".into(), seconds(output_duration_seconds)]);
        args.push("-".into());
        return Ok(RenderPlan {
            args,
            output_path: PathBuf::new(),
            working_dir: input.temp_dir.to_path_buf(),
            duration_seconds: output_duration_seconds,
            min_output_bytes: 0,
            duration_tolerance_seconds: (profile.duration_tolerance_frames as f64 / profile.fps())
                .max(0.25),
            width: profile.width,
            height: profile.height,
            fps: profile.fps(),
            profile_name: profile.name.clone(),
        });
    }

    let ass = if input.include_captions {
        build_ass(CaptionInput {
            project,
            render_width: profile.width,
            render_height: profile.height,
            project_width,
            project_fps,
        })
    } else {
        String::new()
    };
    let look_filters = project_look_filters(project, input.root)?;
    let look_lut = effects_lut(&project["look"], input.root)?;
    let graded_label = if look_filters.is_empty() && look_lut.is_none() {
        base_label.clone()
    } else {
        let grade_chain = if look_filters.is_empty() {
            "null".to_owned()
        } else {
            look_filters.join(",")
        };
        let mut chain = format!("[{base_label}]{grade_chain}[look]");
        if let Some((lut, intensity)) = look_lut {
            chain = apply_lut_to_chain(chain, "look", &lut, intensity);
        }
        filters.push(chain);
        "look".to_owned()
    };
    let mut video_label = graded_label.clone();
    if let Some(motion_ass) = input.motion_ass.filter(|value| !value.is_empty()) {
        std::fs::write(input.temp_dir.join("motion.ass"), motion_ass).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar el motion graphics del render",
            )
        })?;
        filters.push(format!("[{video_label}]ass=motion.ass[motion]"));
        video_label = "motion".to_owned();
    }
    if ass.is_empty() {
        filters.push(format!(
            "[{video_label}]format={}[vout]",
            profile.pixel_format
        ));
    } else {
        std::fs::write(input.temp_dir.join("captions.ass"), ass).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo preparar el archivo de subtítulos para el render",
            )
        })?;
        filters.push(format!(
            "[{video_label}]ass=captions.ass,format={}[vout]",
            profile.pixel_format
        ));
    }

    push_filter_complex(&mut args, filters.join(";"), input.temp_dir)?;
    args.extend([
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[aout]".into(),
    ]);
    if let Some(mut hardware) = hardware_encoder_args(&profile) {
        args.append(&mut hardware);
    } else {
        let encoder = software_encoder_for(input.ffprobe, &profile)?;
        args.extend(software_video_args(&encoder, &profile));
    }
    if profile.video_codec == "h265" {
        args.extend(["-tag:v".into(), "hvc1".into()]);
    }
    let (audio_encoder, audio_rate) = audio_encoder_for(&profile);
    args.extend([
        "-pix_fmt".into(),
        profile.pixel_format.clone(),
        "-r".into(),
        profile.fps_arg(),
        "-c:a".into(),
        audio_encoder.to_owned(),
        "-b:a".into(),
        profile.audio_bps.to_string(),
        "-ar".into(),
        audio_rate.to_string(),
        "-ac".into(),
        profile.audio_channels.to_string(),
        "-map_metadata".into(),
        "-1".into(),
    ]);
    // `-movflags` es del muxer MP4/MOV; en WebM se omite (la extensión .webm
    // ya define el muxer Matroska).
    if profile.container != "webm" {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    if output_start_seconds > 0.0001 {
        args.extend(["-ss".into(), seconds(output_start_seconds)]);
    }
    args.extend([
        "-t".into(),
        seconds(output_duration_seconds),
        input.output_path.to_string_lossy().into_owned(),
    ]);

    Ok(RenderPlan {
        args,
        output_path: input.output_path.to_path_buf(),
        working_dir: input.temp_dir.to_path_buf(),
        duration_seconds: output_duration_seconds,
        min_output_bytes: profile.min_output_bytes,
        duration_tolerance_seconds: (profile.duration_tolerance_frames as f64 / profile.fps())
            .max(0.25),
        width: profile.width,
        height: profile.height,
        fps: profile.fps(),
        profile_name: profile.name.clone(),
    })
}
