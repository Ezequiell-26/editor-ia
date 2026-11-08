pub(crate) fn visual_filter(
    input_index: usize,
    clip: &Value,
    asset: &Value,
    profile: &Profile,
    clip_seconds: f64,
    lead_seconds: f64,
    start_seconds: f64,
    speed_num: u32,
    speed_den: u32,
    is_image: bool,
) -> String {
    let lead = lead_seconds.clamp(0.0, clip_seconds.max(0.0));
    let total_seconds = clip_seconds + lead;
    let transform = &clip["transform"];
    let scale_zoom = scale_zoom_expression(clip, profile, lead);
    let scale_dynamic =
        scale_dynamic_expression(clip, profile, lead, speed_num, speed_den, is_image);
    let scale_x = number(transform, "scaleX")
        .unwrap_or(1.0)
        .clamp(0.01, 100.0);
    let scale_y = number(transform, "scaleY")
        .unwrap_or(1.0)
        .clamp(0.01, 100.0);
    let opacity = number(transform, "opacity").unwrap_or(1.0).clamp(0.0, 1.0);
    let rotation = number(transform, "rotationDeg")
        .unwrap_or(0.0)
        .clamp(-360.0, 360.0);
    let scaled_width =
        (((profile.width as f64 * scale_x).ceil().clamp(2.0, 16_384.0) as u32) + 1) & !1;
    let scaled_height = (((profile.height as f64 * scale_y)
        .ceil()
        .clamp(2.0, 16_384.0) as u32)
        + 1)
        & !1;

    let mut filters = Vec::new();
    filters.push(format!("fps={}", profile.fps_arg()));
    if clip["reverse"].as_bool().unwrap_or(false) {
        filters.push("reverse".to_owned());
    }

    let motion = &clip["motion"];
    let motion_type = motion["type"].as_str().unwrap_or("");
    if !motion_type.is_empty() {
        let intensity = number(motion, "intensity").unwrap_or(0.12).clamp(0.02, 0.5);
        let source_seconds = (if is_image {
            clip_seconds
        } else {
            clip_seconds * speed_num as f64 / speed_den.max(1) as f64
        })
        .max(0.001);
        let media = &asset["media"];
        let source_width = media["width"]
            .as_u64()
            .or_else(|| asset["width"].as_u64())
            .unwrap_or(profile.width as u64);
        let source_height = media["height"]
            .as_u64()
            .or_else(|| asset["height"].as_u64())
            .unwrap_or(profile.height as u64);
        let (zoom_w, zoom_h) = even_fit(
            source_width,
            source_height,
            profile.width as u64,
            profile.height as u64,
        );
        let total_frames = (source_seconds * profile.fps()).max(1.0);
        if let Some(frozen) = motion.get("frozen").filter(|value| value.is_object()) {
            // `frozen` only exists in the single-frame preview project: the
            // Ken Burns crop is evaluated at the playhead, so the one frame
            // rendered matches the full render without decoding from 0.
            let z = number(frozen, "z").unwrap_or(1.0).clamp(1.0, 8.0);
            let x = text(frozen, "x").unwrap_or("(iw-iw/zoom)/2");
            let y = text(frozen, "y").unwrap_or("(ih-ih/zoom)/2");
            filters.push("setpts=PTS-STARTPTS".to_owned());
            filters.push(format!(
                "zoompan=z='{z:.6}':x='{x}':y='{y}':d=1:s={zoom_w}x{zoom_h}:fps={}",
                profile.fps_arg()
            ));
        } else {
            let center_x = "x='(iw-iw/zoom)/2'";
            let center_y = "y='(ih-ih/zoom)/2'";
            let z = match motion_type {
                "zoom-in" => format!("z='1+{intensity:.4}*on/{total_frames:.4}'"),
                "zoom-out" => format!("z='1+{intensity:.4}*(1-on/{total_frames:.4})'"),
                "pan-left" | "pan-right" | "pan-up" | "pan-down" => {
                    format!("z='{:.4}'", 1.0 + intensity)
                }
                _ => String::new(),
            };
            if !z.is_empty() {
                let position = match motion_type {
                    "pan-left" => {
                        format!("x='(iw-iw/zoom)*(1-on/{total_frames:.4})':{center_y}")
                    }
                    "pan-right" => format!("x='(iw-iw/zoom)*on/{total_frames:.4}':{center_y}"),
                    "pan-up" => format!("y='(ih-ih/zoom)*(1-on/{total_frames:.4})':{center_x}"),
                    "pan-down" => format!("y='(ih-ih/zoom)*on/{total_frames:.4}':{center_x}"),
                    _ => format!("{center_x}:{center_y}"),
                };
                // crop cannot animate its output size, so zoom uses zoompan's
                // frame-evaluated z. Output size preserves the asset aspect ratio.
                filters.push("setpts=PTS-STARTPTS".to_owned());
                filters.push(format!(
                    "zoompan={z}:{position}:d=1:s={zoom_w}x{zoom_h}:fps={}",
                    profile.fps_arg()
                ));
            }
        }
    }

    if profile.fit == "cover" {
        filters.push(format!(
            "scale=w={}:h={}:force_original_aspect_ratio=increase:force_divisible_by=2",
            profile.width, profile.height
        ));
        filters.push(format!("crop={}:{}", profile.width, profile.height));
    } else {
        filters.push(format!(
            "scale=w={}:h={}:force_original_aspect_ratio=decrease:force_divisible_by=2",
            profile.width, profile.height
        ));
    }
    if (scale_x - 1.0).abs() > 0.001 || (scale_y - 1.0).abs() > 0.001 {
        filters.push(format!("scale=iw*{scale_x:.6}:ih*{scale_y:.6}"));
    }
    if scale_zoom.is_none() && scale_dynamic.is_none() {
        if let Some(keyframes) = transform["keyframes"].as_array() {
            // Timestamps can be rebased by zoompan/reverse; the frame counter
            // is the only clock guaranteed to advance through this chain.
            let frame_base = (lead * profile.fps()).round();
            let time_var = format!("((n-{frame_base:.0})/{:.6})", profile.fps());
            if let Some(expression) =
                keyframe_expression(keyframes, "scale", profile.fps(), &time_var)
            {
                if let Ok(value) = expression.parse::<f64>() {
                    if (value - 1.0).abs() > 0.001 {
                        filters.push(format!("scale=iw*{value:.6}:ih*{value:.6}"));
                    }
                } else {
                    // The expression changes per frame; overlay re-centres the
                    // (variable-size) layer over the fixed-size base.
                    filters.push(format!(
                        "scale=w='iw*({expression})':h='ih*({expression})':eval=frame"
                    ));
                }
            }
        }
    }
    if transform["flipH"].as_bool().unwrap_or(false) {
        filters.push("hflip".to_owned());
    }
    if transform["flipV"].as_bool().unwrap_or(false) {
        filters.push("vflip".to_owned());
    }
    // The clip chain is rebased to zero by setpts before this point, so the
    // animation clock starts at the transition lead, not at the global start.
    filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0".to_owned());
    filters.push("format=rgba".to_owned());

    let chroma = &clip["chromaKey"];
    let chroma_color = chroma["color"].as_str().unwrap_or("").trim();
    if chroma_color.len() == 7
        && chroma_color.starts_with('#')
        && chroma_color[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        let similarity = number(chroma, "similarity").unwrap_or(0.3).clamp(0.01, 1.0);
        let blend = number(chroma, "blend").unwrap_or(0.1).clamp(0.0, 1.0);
        filters.push(format!(
            "chromakey=0x{}:similarity={similarity:.4}:blend={blend:.4}",
            &chroma_color[1..]
        ));
        // El derrame sólo tiene sentido en pantallas verde/azul; para una
        // pared de otro color se omite en vez de alterar el sujeto.
        let spill = number(chroma, "spill").unwrap_or(0.0).clamp(0.0, 1.0);
        if spill > 0.001 {
            let hex = &chroma_color[1..];
            let channel =
                |start: usize| u8::from_str_radix(&hex[start..start + 2], 16).unwrap_or(0);
            let (red, green, blue) = (channel(0), channel(2), channel(4));
            let screen = if green > red && green > blue {
                Some("green")
            } else if blue > red && blue > green {
                Some("blue")
            } else {
                None
            };
            if let Some(screen) = screen {
                filters.push(format!("despill=type={screen}:mix={spill:.4}:expand=0.15"));
            }
        }
    }
    if let Some(mask) = mask_filter(clip, profile.fps(), lead) {
        filters.push(mask);
    }

    let effects = &clip["effects"];
    let brightness = number(effects, "brightness")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let contrast = number(effects, "contrast").unwrap_or(1.0).clamp(0.0, 3.0);
    let saturation = number(effects, "saturation").unwrap_or(1.0).clamp(0.0, 3.0);
    let temperature = number(effects, "temperature")
        .unwrap_or(0.0)
        .clamp(-1.0, 1.0);
    let vignette = number(effects, "vignette").unwrap_or(0.0).clamp(0.0, 1.0);
    let sharpen = number(effects, "sharpen").unwrap_or(0.0).clamp(0.0, 5.0);
    let denoise = number(effects, "denoise").unwrap_or(0.0).clamp(0.0, 1.0);
    let blur = number(effects, "blur").unwrap_or(0.0).clamp(0.0, 50.0);
    let grayscale = effects["grayscale"].as_bool().unwrap_or(false);
    let sepia = effects["sepia"].as_bool().unwrap_or(false);
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
    let gamma_active = gamma_rgb.iter().any(|value| value.abs() > 0.001);
    if brightness.abs() > 0.001
        || (contrast - 1.0).abs() > 0.001
        || (saturation - 1.0).abs() > 0.001
        || gamma_active
    {
        let mut eq = format!(
            "eq=brightness={brightness:.4}:contrast={contrast:.4}:saturation={saturation:.4}"
        );
        if gamma_active {
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
    let curve = effects["curvePreset"].as_str().unwrap_or("");
    let curve_preset = match curve {
        "contrast-soft" => Some("linear_contrast"),
        "contrast-medium" => Some("medium_contrast"),
        "contrast-strong" => Some("strong_contrast"),
        "vintage" => Some("vintage"),
        "cross-process" => Some("cross_process"),
        "darker" => Some("darker"),
        "lighter" => Some("lighter"),
        _ => None,
    };
    if let Some(custom) = custom_curves_filter(effects) {
        filters.push(custom);
    } else if let Some(preset) = curve_preset {
        filters.push(format!("curves=preset={preset}"));
    }
    if grayscale {
        filters.push("hue=s=0".to_owned());
    }
    if sepia {
        filters.push(
            "colorchannelmixer=rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131"
                .to_owned(),
        );
    }
    if blur > 0.001 {
        filters.push(format!("gblur=sigma={blur:.3}"));
    }
    if denoise > 0.001 {
        // Mismos parámetros que el preset rápido de Denoise Studio: hqdn3d
        // espacial + temporal, acotado para no dejar ghosting.
        let luma = 0.6 + denoise * 2.8;
        let chroma = 0.4 + denoise * 2.2;
        let luma_tmp = 1.0 + denoise * 4.0;
        let chroma_tmp = 0.8 + denoise * 3.0;
        filters.push(format!(
            "hqdn3d={luma:.2}:{chroma:.2}:{luma_tmp:.2}:{chroma_tmp:.2}"
        ));
    }
    if sharpen > 0.001 {
        filters.push(format!("unsharp=5:5:{sharpen:.3}:5:5:0"));
    }
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
    if let Some(relight) = effects.get("relight").filter(|value| value.is_object()) {
        let strength = number(relight, "strength").unwrap_or(0.0).clamp(-1.0, 1.0);
        let warmth = number(relight, "warmth").unwrap_or(0.0).clamp(-1.0, 1.0);
        if strength.abs() > 0.0001 || warmth.abs() > 0.0001 {
            let x = number(relight, "x").unwrap_or(0.0).clamp(-1.0, 1.0);
            let y = number(relight, "y").unwrap_or(0.0).clamp(-1.0, 1.0);
            let radius = number(relight, "radius").unwrap_or(0.45).clamp(0.02, 1.0);
            let feather = number(relight, "feather").unwrap_or(0.35).clamp(0.01, 1.0);
            let dx = format!("((X/W)-0.5-({x:.4}))");
            let dy = format!("((Y/H)-0.5-({y:.4}))");
            let distance = format!("sqrt(({dx})*({dx})+({dy})*({dy}))");
            let edge = format!("({radius:.4}*{feather:.4})");
            let weight = format!("max(0,min(1,(({radius:.4})-({distance}))/{edge}))");
            let smooth = format!("(({weight})*({weight})*(3-2*({weight})))");
            let gain = strength * 92.0;
            let warm = warmth * 42.0;
            filters.push("format=rgba".to_owned());
            filters.push(format!(
                "geq=r='clip(r(X,Y)+({gain:.3})*({smooth})+({warm:.3})*({smooth}),0,255)':g='clip(g(X,Y)+({gain:.3})*({smooth}),0,255)':b='clip(b(X,Y)+({gain:.3})*({smooth})-({warm:.3})*({smooth}),0,255)':a='alpha(X,Y)'"
            ));
        }
    }

    if !is_image {
        let source_seconds = total_seconds * (speed_num as f64 / speed_den as f64);
        if let Some(expression) = curve_setpts(clip, total_seconds, source_seconds, lead) {
            filters.push(expression);
            if let (Some(points), Some(fps)) = (
                parse_speed_curve(clip),
                curve_optical_flow_fps(clip, profile),
            ) {
                if curve_has_slow(&points) {
                    filters.push("tpad=stop_mode=clone:stop_duration=0.5".to_owned());
                    filters.push(format!(
                        "minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none"
                    ));
                }
            }
        } else if speed_num != speed_den {
            filters.push(format!(
                "setpts=(PTS-STARTPTS)*{}/{}",
                speed_den.max(1),
                speed_num.max(1)
            ));
            // Cámara lenta suave: `setpts` estira los tiempos y deja huecos; la
            // interpolación de movimiento los rellena a la tasa del perfil. Sólo
            // se aplica al bajar de 1×, nunca al acelerar.
            if speed_num < speed_den && clip["slowMotionSmoothing"].as_bool() == Some(true) {
                // `tpad` clona el último frame para que la interpolación cubra
                // también el tramo final; sin eso el filtro entrega ~0,1 s menos.
                filters.push("tpad=stop_mode=clone:stop_duration=0.5".to_owned());
                filters.push(format!(
                    "minterpolate=fps={}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none",
                    profile.fps_arg()
                ));
            }
        }
    }
    if !is_image {
        if let Some(blur) = effects.get("motionBlur").filter(|value| value.is_object()) {
            let frames = number(blur, "frames")
                .unwrap_or(4.0)
                .round()
                .clamp(2.0, 12.0) as usize;
            let intensity = number(blur, "intensity").unwrap_or(0.5).clamp(0.0, 1.0);
            if intensity > 0.001 {
                filters.push(format!(
                    "tmix=frames={frames}:weights='{}'",
                    motion_blur_weights(frames, intensity)
                ));
            }
        }
    }
    filters.push(format!("trim=duration={}", seconds(total_seconds)));
    let fps = profile.fps();
    let fade_in =
        (number(effects, "fadeInFrames").unwrap_or(0.0).max(0.0) / fps).min(total_seconds);
    let fade_out =
        (number(effects, "fadeOutFrames").unwrap_or(0.0).max(0.0) / fps).min(total_seconds);
    if fade_in > 0.001 {
        filters.push(format!("fade=t=in:st=0:d={:.3}:alpha=1", fade_in));
    }
    if fade_out > 0.001 {
        let start = (total_seconds - fade_out).max(0.0);
        filters.push(format!(
            "fade=t=out:st={:.3}:d={:.3}:alpha=1",
            start, fade_out
        ));
    }
    filters.extend(animation_fade_filters(
        clip,
        lead,
        clip_seconds,
        total_seconds,
        fps,
    ));
    if lead > 0.001 {
        match clip["transitionIn"]["type"].as_str().unwrap_or("") {
            "dissolve" => filters.push(format!("fade=t=in:st=0:d={lead:.3}:alpha=1")),
            "fade-black" => filters.push(format!("fade=t=in:st=0:d={lead:.3}")),
            "fade-white" => filters.push(format!("fade=t=in:st=0:d={lead:.3}:color=white")),
            "dip-color" => {
                let color = clip["transitionIn"]["color"]
                    .as_str()
                    .map(hex_color)
                    .unwrap_or_else(|| "0x000000".to_owned());
                filters.push(format!("fade=t=in:st=0:d={lead:.3}:color={color}"));
            }
            wipe @ ("wipe-left" | "wipe-right" | "wipe-up" | "wipe-down" | "iris") => {
                filters.push(wipe_transition_filter(wipe, lead, fps));
            }
            slide3d @ ("slide-3d-left" | "slide-3d-right" | "slide-3d-up" | "slide-3d-down") => {
                filters.push(slide3d_transition_filter(slide3d, lead, fps));
            }
            _ => {}
        }
    }
    // `rotate` evalúa su ángulo con `t` (segundos locales), no con `n`; con `n`
    // los keyframes de rotación quedaban congelados en el primer valor.
    let rotation_time = format!("(t-{:.6})", lead);
    let rotation_keyframe = transform["keyframes"].as_array().and_then(|keyframes| {
        keyframe_expression(keyframes, "rotationDeg", profile.fps(), &rotation_time)
    });
    // La capa queda siempre del tamaño del lienzo: si `ow/oh` crecieran con
    // el bounding box, el overlay usaría el tamaño del primer frame y la
    // rotación animada se desplazaría.
    let rotate_fill = format!("c=black@0:ow={scaled_width}:oh={scaled_height}");
    if let Some(expression) = rotation_keyframe {
        if let Ok(value) = expression.parse::<f64>() {
            if value.abs() > 0.01 {
                filters.push(format!("rotate={value}*PI/180:{rotate_fill}"));
            }
        } else {
            filters.push(format!(
                "rotate=angle='({expression})*PI/180':{rotate_fill}"
            ));
        }
    } else if rotation.abs() > 0.01 {
        filters.push(format!("rotate={rotation}*PI/180:{rotate_fill}"));
    }
    let opacity_frozen = clip["opacityFrozen"]
        .as_f64()
        .map(|value| value.clamp(0.0, 1.0));
    let opacity_timeline = if opacity_frozen.is_some() {
        None
    } else {
        transform["keyframes"]
            .as_array()
            .and_then(|keyframes| opacity_commands(keyframes, profile.fps(), lead))
    };
    if let Some(frozen) = opacity_frozen {
        if frozen < 0.999 {
            filters.push(format!("colorchannelmixer=aa={frozen:.4}"));
        }
    } else if let Some((initial, commands)) = opacity_timeline {
        // `sendcmd` va antes del mixer para que el comando del frame se aplique
        // a ese frame y no al siguiente.
        if !commands.is_empty() {
            let script = commands
                .iter()
                .map(|(at, value)| {
                    format!("{at:.4} colorchannelmixer@kf{input_index} aa {value:.4}")
                })
                .collect::<Vec<_>>()
                .join(";");
            filters.push(format!("sendcmd=c='{script}'"));
        }
        filters.push(format!("colorchannelmixer@kf{input_index}=aa={initial:.4}"));
    } else if opacity < 0.999 {
        filters.push(format!("colorchannelmixer=aa={opacity:.4}"));
    }
    if let Some((maximum, factor)) = scale_dynamic.as_ref() {
        // Curvas que bajan de 1: se pre-escala una vez al máximo y cada frame
        // se reduce dentro de un lienzo fijo. Así no se baja a 0,7 para volver
        // a subir a 1,3, que perdía nitidez frente a una escala directa.
        let canvas_scale = maximum
            .min(16_384.0 / scaled_width.max(2) as f64)
            .min(16_384.0 / scaled_height.max(2) as f64)
            .max(0.01);
        let canvas_width = (((scaled_width as f64 * canvas_scale)
            .ceil()
            .clamp(2.0, 16_384.0) as u32)
            + 1)
            & !1;
        let canvas_height = (((scaled_height as f64 * canvas_scale)
            .ceil()
            .clamp(2.0, 16_384.0) as u32)
            + 1)
            & !1;
        let factor = if canvas_scale + 1e-9 < *maximum {
            format!("min(1,(({factor})*{:.6}))", maximum / canvas_scale)
        } else {
            factor.clone()
        };
        filters.push(format!(
            "scale=iw*{canvas_scale:.6}:ih*{canvas_scale:.6}:flags=lanczos"
        ));
        filters.push(format!(
            "scale=w='iw*({factor})':h='ih*({factor})':eval=frame:flags=lanczos"
        ));
        filters.push(format!(
            "pad={canvas_width}:{canvas_height}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame"
        ));
        filters.push("format=rgba".to_owned());
    } else if let Some((base, zoom)) = scale_zoom.as_ref() {
        // Curvas con mínimo >= 1: se centra la capa y `zoompan` completa la
        // animación con z >= 1 sobre una salida fija. El overlay nunca recibe
        // una capa de tamaño variable.
        if *base < 0.999 {
            filters.push(format!("scale=iw*{base:.6}:ih*{base:.6}:flags=lanczos"));
            filters.push(format!(
                "pad={scaled_width}:{scaled_height}:(ow-iw)/2:(oh-ih)/2:color=black@0"
            ));
        }
        filters.push("setpts=PTS-STARTPTS".to_owned());
        filters.push(format!(
            "zoompan=z='{zoom}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s={scaled_width}x{scaled_height}:fps={}",
            profile.fps_arg()
        ));
        filters.push("format=rgba".to_owned());
    }
    // Fade congelado por la ventana de un frame: multiplica alfa y conserva
    // RGB, igual que el `fade ...:alpha=1` del compuesto completo.
    if let Some(fade) = clip["fadeFrozen"]
        .as_f64()
        .map(|value| value.clamp(0.0, 1.0))
    {
        if fade < 0.999 {
            filters.push(format!("colorchannelmixer=aa={fade:.6}"));
        }
    }
    // Transición congelada en el lead: dissolve (alfa), fade-black (RGB+alfa),
    // fade-white (mezcla a blanco + alfa) o slide (sólo desplazamiento, que se
    // aplica en el overlay). El resto ya está en el recorte de origen.
    if let Some(frozen) = clip["transitionFrozen"].as_object() {
        let alpha = frozen
            .get("alpha")
            .and_then(Value::as_f64)
            .map(|value| value.clamp(0.0, 1.0))
            .unwrap_or(1.0);
        let mode = frozen.get("mode").and_then(Value::as_str).unwrap_or("");
        // Wipe congelado: el progreso ya viene resuelto por el preview; la
        // máscara es la misma `geq` del compuesto pero con `p` constante.
        if mode == "wipe" {
            if let Some(kind) = frozen.get("kind").and_then(Value::as_str) {
                let progress = frozen
                    .get("progress")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0)
                    .clamp(0.0, 1.0);
                filters.push(wipe_frozen_filter(kind, progress));
            }
        }
        // Slide 3D congelado: el quad en perspectiva usa el progreso que el
        // preview midió en el frame pedido; el desplazamiento llega por
        // `transitionFrozen.x/y` en el overlay, igual que el slide 2D.
        if mode == "slide3d" {
            if let Some(axis) = frozen.get("axis").and_then(Value::as_str) {
                let progress = frozen
                    .get("progress")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0)
                    .clamp(0.0, 1.0);
                filters.push(slide3d_frozen_filter(
                    if axis == "y" { "y" } else { "x" },
                    progress,
                ));
            }
        }
        if alpha < 0.999 {
            match mode {
                "black" => filters.push(format!(
                    "colorchannelmixer=rr={alpha:.6}:gg={alpha:.6}:bb={alpha:.6}:aa={alpha:.6}"
                )),
                "white" => {
                    // `fade=color=white` mezcla RGB pero conserva el alfa: es un
                    // barrido a blanco, no un crossfade. Curvas afines por canal
                    // (0->(1-p), 1->1) preservan el alfa de máscaras.
                    let floor = 1.0 - alpha;
                    filters.push(format!(
                        "curves=r='0/{floor:.6} 1/1':g='0/{floor:.6} 1/1':b='0/{floor:.6} 1/1'"
                    ));
                }
                "color" => {
                    // Dip to color: cada canal mezcla hacia el color del
                    // fundido (out = in*alpha + (1-alpha)*c) conservando el
                    // alfa, misma ley afín que el blanco pero con intercepto
                    // por canal.
                    if let Some((r, g, b)) = frozen
                        .get("color")
                        .and_then(Value::as_str)
                        .and_then(hex_rgb01)
                    {
                        let floor = 1.0 - alpha;
                        let (ir, ig, ib) = (floor * r, floor * g, floor * b);
                        let (yr, yg, yb) = (alpha + ir, alpha + ig, alpha + ib);
                        filters.push(format!(
                            "curves=r='0/{ir:.6} 1/{yr:.6}':g='0/{ig:.6} 1/{yg:.6}':b='0/{ib:.6} 1/{yb:.6}'"
                        ));
                    }
                }
                _ => filters.push(format!("colorchannelmixer=aa={alpha:.6}")),
            }
        }
    }
    if let Some(perspective) = perspective_filter(clip, profile) {
        filters.push(perspective);
    }
    // Asegura el canal alfa para los recortes VP9: `overlay` sólo compone
    // transparencia si la capa llega en un formato con alfa.
    filters.push("format=rgba".to_owned());
    if let Some(alpha) = clip["animationFrozen"]["alpha"]
        .as_f64()
        .map(|value| value.clamp(0.0, 1.0))
    {
        if alpha < 0.999 {
            filters.push(format!("colorchannelmixer=aa={alpha:.6}"));
        }
    }
    let text_mask = clip["mask"]["shape"].as_str() == Some("text")
        && clip["mask"]["text"]
            .as_str()
            .map(|text| !text.trim().is_empty())
            .unwrap_or(false);
    if text_mask {
        if let Some(font) = text_mask_font() {
            let mask = &clip["mask"];
            let font = font
                .to_string_lossy()
                .replace('\\', "/")
                .replace(':', "\\:");
            let font_size = (profile.height as f64
                * number(mask, "fontScale").unwrap_or(0.16).clamp(0.02, 0.5))
            .round()
            .clamp(4.0, 1000.0);
            let mask_x = number(mask, "x").unwrap_or(0.0).clamp(-1.0, 1.0);
            let mask_y = number(mask, "y").unwrap_or(0.0).clamp(-1.0, 1.0);
            let feather = number(mask, "feather").unwrap_or(0.0).clamp(0.0, 1.0);
            let feather_filter = if feather > 0.001 {
                format!(",gblur=sigma={:.3}", feather * 20.0)
            } else {
                String::new()
            };
            let invert_filter = if mask["invert"].as_bool().unwrap_or(false) {
                ",negate"
            } else {
                ""
            };
            let base_label = format!("tmaskbase{input_index}");
            let mask_label = format!("tmask{input_index}");
            let mask_text = drawtext_text(mask["text"].as_str().unwrap_or(""));
            let mask_start = seconds((start_seconds - lead).max(0.0));
            return format!(
                "[{input_index}:v]{} ,format=rgba[{base_label}];\
                 color=c=black@0.0:s={}x{}:r={}:d={},format=rgba,\
                 drawtext=fontfile='{}':text='{}':fontcolor=white:fontsize={:.0}:x=(w-text_w)/2+({:.6})*w:y=(h-text_h)/2+({:.6})*h:alpha=1:expansion=none,\
                 alphaextract{}{}[{mask_label}];\
                 [{base_label}][{mask_label}]alphamerge,format=rgba,setpts=PTS-STARTPTS+{}/TB[v{}]",
                filters.join(","),
                profile.width,
                profile.height,
                profile.fps_arg(),
                seconds(total_seconds.max(0.04)),
                font,
                mask_text,
                font_size,
                mask_x,
                mask_y,
                feather_filter,
                invert_filter,
                mask_start,
                input_index
            );
        }
    }
    filters.push(format!(
        "setpts=PTS-STARTPTS+{}/TB",
        seconds((start_seconds - lead).max(0.0))
    ));

    // Keep the asset read so a malformed source is caught by the compiler of
    // this function even if future transforms stop using it directly.
    let _ = asset;
    format!("[{input_index}:v]{}[v{input_index}]", filters.join(","))
}

/// Paneo animado de pista: ganancias por canal (balance lineal, la misma
/// convención del paneo estático). El filtro `pan` evalúa sus ganancias una
/// sola vez al inicio y no sigue el tiempo, así que el paneo animado necesita
/// `channelsplit` + `volume` (eval=frame) + `join`.
pub(crate) struct TrackPanAutomation {
    pub(crate) left: String,
    pub(crate) right: String,
}
