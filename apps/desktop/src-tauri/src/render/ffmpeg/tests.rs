use super::*;
use crate::render::subtitles::ass_time;

#[test]
fn perspective_filter_uses_source_corners_in_ffmpeg_order() {
    let clip = serde_json::json!({
        "transform": {
            "perspective": {
                "corners": [
                    { "x": 0.1, "y": 0.1 },
                    { "x": 0.9, "y": 0.2 },
                    { "x": 0.8, "y": 0.9 },
                    { "x": 0.2, "y": 0.8 }
                ]
            }
        }
    });
    let filter = perspective_filter(&clip, &profile()).expect("perspectiva");
    // FFmpeg recibe TL, TR, BL, BR; la tercera esquina del schema es BR.
    assert!(filter.contains("x0=192.000:y0=108.000"));
    assert!(filter.contains("x1=1728.000:y1=216.000"));
    assert!(filter.contains("x2=384.000:y2=864.000"));
    assert!(filter.contains("x3=1536.000:y3=972.000"));
    assert!(filter.contains("sense=source"));

    let identity = serde_json::json!({
        "transform": {
            "perspective": {
                "corners": [
                    { "x": 0.0, "y": 0.0 },
                    { "x": 1.0, "y": 0.0 },
                    { "x": 1.0, "y": 1.0 },
                    { "x": 0.0, "y": 1.0 }
                ]
            }
        }
    });
    assert!(perspective_filter(&identity, &profile()).is_none());
}

#[test]
fn curve_math_matches_the_editor() {
    let points = vec![
        CurvePoint {
            t: 0.0,
            speed: 0.5,
            easing: None,
            bezier: None,
        },
        CurvePoint {
            t: 1.0,
            speed: 2.0,
            easing: None,
            bezier: None,
        },
    ];
    assert!((curve_mean(&points) - 1.25).abs() < 1e-4);
    // Rampa lineal 0.5→2: la mitad de la salida consume 35 % de la fuente.
    assert!((curve_source_fraction(&points, 0.5) - 0.35).abs() < 0.01);
    let knots = curve_knots(&points, 8);
    assert_eq!(knots.len(), 9);
    assert_eq!(knots[0], (0.0, 0.0));
    assert_eq!(knots[8], (1.0, 1.0));
    assert!(knots.windows(2).all(|pair| pair[1].0 >= pair[0].0));
}

#[test]
fn curve_setpts_builds_a_bounded_piecewise_expression() {
    let clip = serde_json::json!({
        "speedCurve": {
            "points": [
                { "t": 0.0, "speed": 0.5 },
                { "t": 1.0, "speed": 2.0 }
            ]
        }
    });
    let expression = curve_setpts(&clip, 8.0, 10.0, 0.0).expect("expresión");
    assert!(expression.starts_with("setpts='"));
    assert!(expression.contains("if(lt((PTS-STARTPTS)"));
    assert!(expression.len() <= CURVE_MAX_EXPRESSION_CHARS);
    // Con lead de transición se cae al camino constante.
    assert!(curve_setpts(&clip, 8.0, 10.0, 0.4).is_none());

    let many = serde_json::json!({
        "speedCurve": {
            "points": (0..50)
                .map(|index| serde_json::json!({
                    "t": index as f64 / 49.0,
                    "speed": 0.5 + (index % 5) as f64 * 0.75
                }))
                .collect::<Vec<_>>()
        }
    });
    let long = curve_setpts(&many, 8.0, 10.0, 0.0).expect("expresión larga");
    assert!(long.len() <= CURVE_MAX_EXPRESSION_CHARS);
}

#[test]
fn curve_optical_flow_respects_the_toggle_and_caps_fps() {
    let points = serde_json::json!([
        { "t": 0.0, "speed": 0.5 },
        { "t": 1.0, "speed": 2.0 }
    ]);
    let enabled = serde_json::json!({
        "speedCurve": { "points": points, "opticalFlow": true, "targetFps": 240 }
    });
    assert_eq!(curve_optical_flow_fps(&enabled, &profile()), Some(120));
    let disabled = serde_json::json!({
        "speedCurve": { "points": points, "opticalFlow": false }
    });
    assert_eq!(curve_optical_flow_fps(&disabled, &profile()), None);
}

#[test]
fn effect_stack_reaches_the_filter_chain_in_order() {
    let effects = serde_json::json!({
        "stack": [
            { "id": "a", "effectId": "color.exposure", "enabled": true, "params": { "exposure": 0.5 } },
            { "id": "b", "effectId": "light.vignette", "enabled": true, "params": { "angle": 0.785 } }
        ]
    });
    let chain = apply_effect_stack("[0:v]scale=1920:1080[v0]".to_owned(), "v0", &effects);
    assert!(chain.contains("eq=brightness=0.5"));
    assert!(chain.contains("vignette=angle=0.785"));
    // El orden importa: exposición antes que viñeta.
    let exposure = chain.find("eq=brightness").unwrap_or(usize::MAX);
    let vignette = chain.find("vignette=angle").unwrap_or(0);
    assert!(exposure < vignette);
    assert!(chain.ends_with("[v0]"));
}

#[test]
fn effect_stack_skips_disabled_and_unknown_effects() {
    let effects = serde_json::json!({
        "stack": [
            { "id": "a", "effectId": "color.exposure", "enabled": false, "params": { "exposure": 1 } },
            { "id": "b", "effectId": "inventado.que.no.existe", "enabled": true, "params": {} },
            { "id": "c", "effectId": "color.contrast", "enabled": true, "params": { "contrast": 1.4 } }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(!chain.contains("brightness"));
    assert!(chain.contains("eq=contrast=1.4"));
}

#[test]
fn effect_stack_expands_graphs_with_a_unique_token() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "color.duotone",
                "enabled": true,
                "params": { "shadow": "#1b2a4a", "highlight": "#ffd166", "amount": 1 }
            }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(chain.contains("split=2[v0_0s][v0_0h]"));
    assert!(!chain.contains("%A%"));
    assert!(chain.contains("colorchannelmixer=rr=0.1059"));
    assert!(chain.ends_with("[v0]"));
}

#[test]
fn effect_stack_expands_zoom_pulse_graph_with_filled_params() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "impact.zoom_pulse",
                "enabled": true,
                "params": { "amount": 0.2, "rate": 3, "center": [0.5, 0.5] }
            }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(!chain.contains("%A%"));
    assert!(!chain.contains("{amount}"));
    assert!(chain.contains("split=2[v0_0o][v0_0z]"));
    assert!(chain.contains("eval=frame"));
    assert!(chain.contains("overlay=x='0.5*(W-w)':y='0.5*(H-h)'"));
    assert!(chain.contains("1+0.2*exp(-6*(t*3-floor(t*3)))"));
    assert!(chain.ends_with("[v0]"));
}

#[test]
fn effect_stack_expands_blur_zoom_graph_with_filled_params() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "blur.zoom",
                "enabled": true,
                "params": { "amount": 0.4, "samples": 12, "center": [0.5, 0.5] }
            }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(!chain.contains("%A%"));
    assert!(!chain.contains("{amount}"));
    assert!(chain.contains("split=12[v0_0b0]"));
    assert!(chain.contains("scale=w='trunc(iw/max(1-0.4*1,0.05)/2)*2'"));
    assert!(chain.contains("overlay=x='0.5*(W-w)':y='0.5*(H-h)':format=auto[v0_0t5]"));
    assert!(chain.contains("blend=all_mode=average[v0_0m1]"));
    assert!(chain.ends_with("blend=all_mode=average[v0]"));
}

#[test]
fn effect_stack_expands_glitch_wave_graph_with_filled_params() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "glitch.wave",
                "enabled": true,
                "params": { "amplitude": 0.1, "frequency": 4, "speed": 1.5 }
            }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(!chain.contains("%A%"));
    assert!(!chain.contains("{amplitude}"));
    assert!(chain.contains("format=gbrp,geq="));
    assert!(chain.contains("r='r(clip(X+sin(Y/H*4*6.28318530718+T*1.5)*0.1*W,0,W-1),Y)'"));
    assert!(chain.contains("g='g(clip(X+sin(Y/H*4*6.28318530718+T*1.5)*0.1*W,0,W-1),Y)'"));
    assert!(chain.contains("b='b(clip(X+sin(Y/H*4*6.28318530718+T*1.5)*0.1*W,0,W-1),Y)'"));
    assert!(chain.ends_with("[v0]"));
}

#[test]
fn effect_stack_expands_halftone_graph_with_filled_params() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "stylize.halftone",
                "enabled": true,
                "params": { "scale": 8, "angle": 45, "contrast": 1.4 }
            }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(!chain.contains("%A%"));
    assert!(!chain.contains("{scale}"));
    assert!(!chain.contains("{angle}"));
    assert!(!chain.contains("{contrast}"));
    assert!(chain.contains("format=gbrp,geq="));
    assert!(chain.contains("cos(45*0.017453292519943295)"));
    assert!(chain.contains("sin(45*0.017453292519943295)"));
    assert!(chain.contains("(X+0.5)/max(8,1)"));
    assert!(chain.contains("0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y)"));
    assert!(chain.ends_with("[v0]"));
}

#[test]
fn effect_stack_expands_twirl_graph_with_filled_params() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "distort.twirl",
                "enabled": true,
                "params": { "angle": 90, "radius": 0.5, "center": [0.5, 0.5] }
            }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(!chain.contains("%A%"));
    assert!(!chain.contains("{angle}"));
    assert!(!chain.contains("{radius}"));
    assert!(!chain.contains("{center"));
    assert!(chain.contains("format=gbrp,geq="));
    assert!(chain.contains("cos((90*0.017453292519943295)"));
    assert!(chain.contains("sin((90*0.017453292519943295)"));
    assert!(chain.contains("(X+0.5-0.5*W)"));
    assert!(chain.contains("(Y+0.5-0.5*H)"));
    assert!(chain.contains("max(0.5,0.000001)"));
    assert!(chain.ends_with("[v0]"));
}

#[test]
fn effect_stack_expands_flare_graph_with_filled_params() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "light.flare",
                "enabled": true,
                "params": { "position": [0.72, 0.28], "size": 0.18, "intensity": 0.4, "tint": "#ffd9a0" }
            }
        ]
    });
    let chain = apply_effect_stack("[0:v]null[v0]".to_owned(), "v0", &effects);
    assert!(!chain.contains("%A%"));
    assert!(!chain.contains("{position"));
    assert!(!chain.contains("{size}"));
    assert!(!chain.contains("{intensity}"));
    assert!(!chain.contains("{tint"));
    assert!(chain.contains("split=2[v0_0b][v0_0l]"));
    assert!(chain.contains("format=gbrp,geq="));
    assert!(chain.contains("clip(1*((clip(1-sqrt("));
    assert!(chain.contains("(1-0.72)*W"));
    assert!(chain.contains("*0.4*255,0,255)"));
    assert!(chain.contains("blend=all_mode=screen"));
    assert!(chain.ends_with("[v0]"));
}

fn keyframed_exposure(value_start: f64, value_end: f64) -> serde_json::Value {
    serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "color.exposure",
                "enabled": true,
                "params": { "exposure": 0.9 },
                "keyframes": {
                    "exposure": [
                        { "frame": 0, "value": value_start },
                        { "frame": 20, "value": value_end }
                    ]
                }
            }
        ]
    })
}

#[test]
fn effect_keyframes_sample_holds_ends_and_eases() {
    let effects = keyframed_exposure(-0.5, 0.5);
    let tracks = effect_keyframe_tracks(&effects);
    assert_eq!(tracks.len(), 1);
    let track = &tracks[0][0];
    assert_eq!(track.param, "exposure");
    assert_eq!(sample_effect_track(track, -10.0), -0.5);
    assert_eq!(sample_effect_track(track, 0.0), -0.5);
    assert_eq!(sample_effect_track(track, 10.0), 0.0);
    assert_eq!(sample_effect_track(track, 20.0), 0.5);
    assert_eq!(sample_effect_track(track, 999.0), 0.5);
}

#[test]
fn effect_keyframes_hold_easing_keeps_previous_value() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "color.exposure",
                "enabled": true,
                "params": {},
                "keyframes": {
                    "exposure": [
                        { "frame": 0, "value": 0.0, "easing": "hold" },
                        { "frame": 10, "value": 1.0 }
                    ]
                }
            }
        ]
    });
    let track = &effect_keyframe_tracks(&effects)[0][0];
    // 'hold' devuelve el valor anterior durante todo el tramo.
    assert_eq!(sample_effect_track(track, 5.0), 0.0);
    assert_eq!(sample_effect_track(track, 15.0), 1.0);
}

#[test]
fn effect_keyframes_bezier_governs_the_segment() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "color.exposure",
                "enabled": true,
                "params": {},
                "keyframes": {
                    "exposure": [
                        // Bezier lineal (0,0)-(1,1): identidad en el tramo.
                        { "frame": 0, "value": 0.0, "bezier": { "cp1X": 0.0, "cp1Y": 0.0, "cp2X": 1.0, "cp2Y": 1.0 } },
                        { "frame": 10, "value": 1.0 },
                        // Segundo tramo sin bezier: lineal por defecto.
                        { "frame": 20, "value": 2.0 }
                    ]
                }
            }
        ]
    });
    let track = &effect_keyframe_tracks(&effects)[0][0];
    assert_eq!(sample_effect_track(track, 5.0), 0.5);
    assert_eq!(sample_effect_track(track, 15.0), 1.5);
}

#[test]
fn effect_keyframes_bezier_slow_start_stays_below_linear() {
    let effects = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "color.exposure",
                "enabled": true,
                "params": {},
                "keyframes": {
                    "exposure": [
                        { "frame": 0, "value": 0.0, "bezier": { "cp1X": 0.9, "cp1Y": 0.1, "cp2X": 0.9, "cp2Y": 0.1 } },
                        { "frame": 10, "value": 1.0 }
                    ]
                }
            }
        ]
    });
    let track = &effect_keyframe_tracks(&effects)[0][0];
    let mid = sample_effect_track(track, 5.0);
    assert!(mid < 0.5, "bezier lento debe quedar bajo la recta: {mid}");
    assert!(mid > 0.0 && mid < 1.0);
}

#[test]
fn effect_keyframes_build_a_segmented_concat_graph() {
    // 30 frames a 30 fps: cortes en los keyframes 0 y 20 → 3 tramos.
    let effects = keyframed_exposure(-0.5, 0.5);
    let graph =
        apply_effect_stack_animated("[0:v]null[v0]".to_owned(), "v0", &effects, 0.0, 1.0, 30.0)
            .expect("grafo segmentado");
    assert!(graph.contains("[0:v]null[kfsrcv0]"), "{graph}");
    // Keyframes en 0 y 20 → cortes {0,20,30} → 2 tramos.
    assert!(graph.contains("[kfsrcv0]split=2[k0][k1]"), "{graph}");
    assert!(graph.contains("trim=start_frame=0:end_frame=20"), "{graph}");
    assert!(
        graph.contains("trim=start_frame=20:end_frame=30"),
        "{graph}"
    );
    assert!(graph.contains("concat=n=2:v=1:a=0[v0]"), "{graph}");
    // Tramo 1 (frames 0-19, medio en 10): keyframe lineal → 0.0.
    assert!(graph.contains("eq=brightness=0[seg0]"), "{graph}");
    // Tramo 2 sostiene el último keyframe (0.5), no el param estático (0.9).
    assert!(graph.contains("eq=brightness=0.5[seg1]"), "{graph}");
    assert!(!graph.contains("eq=brightness=0.9"), "{graph}");
}

#[test]
fn effect_keyframes_shift_cuts_by_the_transition_lead() {
    // Lead de 10 frames: keyframes locales 0 y 20 → cortes de stream 10 y
    // 30 sobre un total de 40 → 3 tramos (lead, medio, cola).
    let effects = keyframed_exposure(-0.5, 0.5);
    let graph = apply_effect_stack_animated(
        "[0:v]null[v0]".to_owned(),
        "v0",
        &effects,
        10.0 / 30.0,
        30.0 / 30.0,
        30.0,
    )
    .expect("grafo segmentado con lead");
    assert!(graph.contains("split=3"), "{graph}");
    assert!(graph.contains("trim=start_frame=0:end_frame=10"), "{graph}");
    assert!(
        graph.contains("trim=start_frame=10:end_frame=30"),
        "{graph}"
    );
    assert!(
        graph.contains("trim=start_frame=30:end_frame=40"),
        "{graph}"
    );
}

#[test]
fn effect_keyframes_fall_back_without_keys_or_over_the_cap() {
    // Sin keyframes: la rama segmentada no aplica.
    let static_effects = serde_json::json!({
        "stack": [
            { "id": "a", "effectId": "color.exposure", "enabled": true, "params": { "exposure": 0.5 } }
        ]
    });
    assert!(apply_effect_stack_animated(
        "[0:v]null[v0]".to_owned(),
        "v0",
        &static_effects,
        0.0,
        1.0,
        30.0,
    )
    .is_none());
    // Instancia deshabilitada: sus keyframes no cuentan.
    let mut disabled = keyframed_exposure(-0.5, 0.5);
    disabled["stack"][0]["enabled"] = serde_json::json!(false);
    assert!(apply_effect_stack_animated(
        "[0:v]null[v0]".to_owned(),
        "v0",
        &disabled,
        0.0,
        1.0,
        30.0,
    )
    .is_none());
    // 40 keyframes → 39 cortes > 32 tramos: fallback al estático.
    let many_keys: Vec<serde_json::Value> = (0..40)
        .map(|frame| serde_json::json!({ "frame": frame, "value": frame as f64 / 40.0 }))
        .collect();
    let crowded = serde_json::json!({
        "stack": [
            {
                "id": "a",
                "effectId": "color.exposure",
                "enabled": true,
                "params": {},
                "keyframes": { "exposure": many_keys }
            }
        ]
    });
    assert!(apply_effect_stack_animated(
        "[0:v]null[v0]".to_owned(),
        "v0",
        &crowded,
        0.0,
        4.0,
        30.0,
    )
    .is_none());
}

#[test]
fn effect_stack_leaves_the_chain_untouched_without_a_stack() {
    let chain = "[0:v]null[v0]".to_owned();
    assert_eq!(
        apply_effect_stack(chain.clone(), "v0", &serde_json::json!({})),
        chain
    );
    assert_eq!(
        apply_effect_stack(chain.clone(), "v0", &serde_json::json!({ "stack": [] })),
        chain
    );
}

fn profile() -> Profile {
    Profile {
        id: "p".into(),
        name: "YouTube 1080p".into(),
        width: 1920,
        height: 1080,
        fps_num: 30,
        fps_den: 1,
        crf: Some(20),
        target_bps: None,
        video_preset: "veryfast".into(),
        fit: "contain".into(),
        audio_bps: 128_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 100,
        duration_tolerance_frames: 10,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    }
}

#[test]
fn visual_effects_reach_the_filter_chain() {
    let profile = profile();
    let clip = serde_json::json!({
        "effects": {
            "brightness": 0.2,
            "contrast": 1.1,
            "saturation": 1.2,
            "temperature": 0.3,
            "vignette": 0.4,
            "sharpen": 1.0,
            "denoise": 0.5,
            "blur": 2.0,
            "sepia": true,
            "hueRotateDeg": 25,
            "shadows": 0.2,
            "highlights": -0.3,
            "fade": 0.1,
            "curvePreset": "vintage",
            "fadeInFrames": 15,
            "fadeOutFrames": 30,
            "lift": { "r": 0.05, "g": 0.0, "b": 0.08 },
            "gamma": { "r": 0.1, "g": 0.0, "b": -0.05 },
            "gain": { "r": 0.08, "g": 0.0, "b": -0.03 },
            "hsl": { "hue": 8, "saturation": 0.1, "intensity": 0.05, "colors": ["r", "y"] },
            "colorMatch": { "r": 1.1, "g": 1.0, "b": 0.95, "strength": 0.8 },
            "lensCorrection": { "k1": -0.12, "k2": 0.04, "cx": 0.5, "cy": 0.5 },
            "relight": { "x": 0.0, "y": -0.1, "radius": 0.45, "strength": 0.4, "warmth": 0.2, "feather": 0.35 }
        }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile,
        3.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(filter.contains("eq=brightness=0.2000"));
    assert!(filter.contains("colorbalance=rs=0.0750"));
    assert!(filter.contains("gblur=sigma=2.000"));
    assert!(filter.contains("hqdn3d=2.00:1.50:3.00:2.30"));
    assert!(filter.contains("unsharp=5:5:1.000"));
    assert!(filter.contains("vignette=PI/"));
    assert!(filter.contains("lenscorrection=k1=-0.1200:k2=0.0400:cx=0.500:cy=0.500:i=bilinear"));
    assert!(filter.contains("geq=r='clip(r(X,Y)+"));
    assert!(filter.contains(":a='alpha(X,Y)'"));
    assert!(filter.contains("colorchannelmixer=rr=0.393"));
    assert!(filter.contains("hue=h=25.00"));
    assert!(filter.contains("curves=master='0.0000/0.0100"));
    assert!(filter.contains("0.7500/0.7120"));
    assert!(filter.contains("curves=preset=vintage"));
    assert!(filter.contains("gamma_r="));
    assert!(filter.contains("colorbalance=rs="));
    assert!(filter.contains("huesaturation="));
    assert!(filter.contains("colors=r+y"));
    assert!(filter.contains("colorchannelmixer=rr="));
    assert!(filter.contains("fade=t=in:st=0:d=0.500:alpha=1"));
    assert!(filter.contains("fade=t=out:st=2.000:d=1.000:alpha=1"));
}

#[test]
fn offset_wheel_maps_to_colorbalance_mids() {
    let profile = profile();
    let clip = serde_json::json!({
        "assetId": "a1",
        "effects": {
            "lift": { "r": 0.0, "g": 0.0, "b": 0.0 },
            "offset": { "r": 0.10, "g": -0.20, "b": 0.05 }
        }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile,
        3.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(
        filter
            .contains("colorbalance=rs=0.0000:gs=0.0000:bs=0.0000:rm=0.1000:gm=-0.2000:bm=0.0500"),
        "la rueda Offset debe mapear a los mids de colorbalance: {filter}"
    );
}

#[test]
fn alpha_assets_use_the_libvpx_decoder() {
    let cutout = serde_json::json!({ "media": { "alpha": true } });
    assert_eq!(alpha_video_decoder(&cutout), Some("libvpx-vp9"));
    let normal = serde_json::json!({ "media": { "width": 320 } });
    assert_eq!(alpha_video_decoder(&normal), None);
}

#[test]
fn text_mask_builds_a_drawtext_alpha_graph() {
    assert_eq!(drawtext_text("a'b:c"), "a’b c");
    assert_eq!(drawtext_text("  HOLA   MUNDO  "), "HOLA MUNDO");
    if text_mask_font().is_none() {
        eprintln!("sin fuente TTF; se omite la comprobación de drawtext");
        return;
    }
    let clip = serde_json::json!({
        "mask": {
            "shape": "text",
            "x": 0.0,
            "y": 0.0,
            "width": 1,
            "height": 1,
            "feather": 0.2,
            "invert": false,
            "text": "HOLA: MUNDO",
            "fontScale": 0.25
        }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(filter.contains("drawtext=fontfile='"), "cadena: {filter}");
    assert!(filter.contains("text='HOLA MUNDO'"), "cadena: {filter}");
    assert!(filter.contains("alphaextract,gblur=sigma=4.000"));
    assert!(filter.contains("alphamerge,format=rgba"));
    assert!(filter.contains("setpts=PTS-STARTPTS+0.000000/TB[v0]"));
}

#[test]
fn glow_and_motion_blur_reach_the_render_chain() {
    let clip = serde_json::json!({
        "effects": {
            "motionBlur": { "frames": 4, "intensity": 0.6 },
            "glow": { "intensity": 0.7, "radius": 24, "threshold": 0.5 }
        }
    });
    let filter = visual_filter(
        2,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(
        filter.contains("tmix=frames=4:weights='"),
        "cadena: {filter}"
    );
    let glow = apply_glow_to_chain(filter, "v2", &clip["effects"]);
    assert!(
        glow.contains("split=3[v2base][v2glow][v2alpha]"),
        "glow: {glow}"
    );
    assert!(glow.contains("alphaextract[v2amask]"));
    assert!(glow.contains("colorlevels=rimin=0.5000"));
    assert!(glow.contains("gblur=sigma=24.000"));
    assert!(glow.contains("blend=all_mode=screen:all_opacity=0.7000[v2blended]"));
    assert!(glow.contains("alphamerge,format=rgba[v2]"));

    let plain = visual_filter(
        2,
        &serde_json::json!({}),
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert_eq!(
        apply_glow_to_chain(plain.clone(), "v2", &serde_json::json!({})),
        plain
    );
}

#[test]
fn slow_motion_smoothing_interpolates_only_below_one_x() {
    let profile = profile();
    let clip = serde_json::json!({
        "assetId": "a1",
        "speed": { "num": 1, "den": 2 },
        "slowMotionSmoothing": true,
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile,
        2.0,
        0.0,
        0.0,
        1,
        2,
        false,
    );
    let setpts = filter
        .find("setpts=(PTS-STARTPTS)*2/1")
        .expect("setpts de 0.5×");
    let interpolation = filter.find("minterpolate=fps=").expect("interpolación");
    assert!(
        interpolation > setpts,
        "la interpolación va después de setpts"
    );
    assert!(filter.contains("mi_mode=mci"));
    assert!(filter.contains("mc_mode=aobmc"));

    let fast = serde_json::json!({
        "speed": { "num": 2, "den": 1 },
        "slowMotionSmoothing": true,
    });
    let filter = visual_filter(
        0,
        &fast,
        &serde_json::json!({}),
        &profile,
        1.0,
        0.0,
        0.0,
        2,
        1,
        false,
    );
    assert!(!filter.contains("minterpolate"), "acelerar no interpola");

    let plain = serde_json::json!({ "speed": { "num": 1, "den": 2 } });
    let filter = visual_filter(
        0,
        &plain,
        &serde_json::json!({}),
        &profile,
        2.0,
        0.0,
        0.0,
        1,
        2,
        false,
    );
    assert!(
        !filter.contains("minterpolate"),
        "sin la marca no interpola"
    );
}

#[test]
fn project_look_builds_a_global_grade_without_clips() {
    let project = serde_json::json!({
        "look": {
            "brightness": 0.15,
            "contrast": 1.2,
            "saturation": 1.3,
            "temperature": 0.4,
            "vignette": 0.3,
            "sharpen": 1.2,
            "curvePreset": "contrast-strong",
            "shadows": -0.2,
            "highlights": 0.3,
            "fade": 0.1,
            "grayscale": true
        }
    });
    let root = Path::new("C:/obra");
    let filters = project_look_filters(&project, root).unwrap();
    let joined = filters.join(",");
    assert!(joined.contains("eq=brightness=0.1500:contrast=1.2000:saturation=1.3000"));
    assert!(joined.contains("colorbalance=rs=0.1000:bs=-0.1000"));
    assert!(joined.contains("curves=master='"));
    assert!(joined.contains("curves=preset=strong_contrast"));
    assert!(joined.contains("unsharp=5:5:1.200"));
    assert!(joined.contains("vignette=PI/"));
    assert!(joined.contains("hue=s=0"));
    assert!(project_look_filters(&serde_json::json!({}), root)
        .unwrap()
        .is_empty());
    assert!(
        project_look_filters(&serde_json::json!({ "look": {} }), root)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn project_look_resolves_lut_and_rejects_escapes() {
    let root = std::env::temp_dir().join(format!("editor-ia-look-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("media/luts")).unwrap();
    std::fs::write(root.join("media/luts/x.cube"), b"LUT_3D_SIZE 2\n").unwrap();
    let project = serde_json::json!({
        "look": { "lutFile": "media/luts/x.cube", "lutIntensity": 0.4 }
    });
    let (path, intensity) = effects_lut(&project["look"], &root).unwrap().unwrap();
    assert!(path.ends_with("x.cube"));
    assert!((intensity - 0.4).abs() < 1e-9);
    let escaping = serde_json::json!({ "look": { "lutFile": "../x.cube" } });
    assert!(effects_lut(&escaping["look"], &root).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

fn project_with_adjustment(hidden: bool) -> Value {
    let mut project = project();
    project["timeline"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "adj1", "kind": "adjustment", "order": 2,
            "hidden": hidden, "muted": false
        }));
    project["timeline"]["clips"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "adjclip", "trackId": "adj1", "kind": "adjustment",
            "startFrame": 15, "durationFrames": 30,
            "source": { "type": "adjustment" },
            "effects": { "contrast": 1.3, "curvePreset": "vintage" }
        }));
    project
}

#[test]
fn adjustment_layers_grade_the_composite_inside_their_window() {
    let project = project_with_adjustment(false);
    let root = std::env::temp_dir().join(format!("editor-ia-adj-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan con capa de ajuste debería construirse");
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("curves=preset=vintage"))
        .expect("falta el grade de la capa de ajuste");
    assert!(graph.contains("eq=brightness=0.0000:contrast=1.3000"));
    assert!(graph.contains("curves=preset=vintage:enable='between(t,0.500000,1.500000)'"));
    assert!(
        graph.contains("[adj0]"),
        "la cadena ajustada no se conectó: {graph}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn muted_clip_audio_leaves_the_mix() {
    let root = std::env::temp_dir().join(format!("editor-ia-mute-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan_for = |project: &Value| {
        build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan debería construirse")
    };
    let mut project = project();
    project["timeline"]["clips"][1]["audio"] = serde_json::json!({ "muted": true });
    assert_eq!(
        project["timeline"]["clips"][1]["id"],
        serde_json::json!("c2")
    );
    assert_eq!(
        project["timeline"]["clips"][1]["audio"]["muted"],
        serde_json::json!(true)
    );
    let muted = plan_for(&project);
    let muted_args = muted.args.join(" ");
    let muted_graph = muted
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio");
    assert!(
        muted_args.contains("anullsrc"),
        "el clip mudo debería dejar sólo el silencio: {muted_args}"
    );
    assert!(
        !muted_graph.contains("amix"),
        "el clip mudo no debería entrar al mix: {muted_graph}"
    );

    project["timeline"]["clips"][1]["audio"] = serde_json::json!({ "gainDb": -3 });
    let sounding = plan_for(&project);
    let sounding_graph = sounding
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio");
    assert!(
        sounding_graph.contains("volume=-3.00dB"),
        "sin mute el audio debería conservar su ganancia: {sounding_graph}"
    );
    assert!(
        !muted_graph.contains("volume=-3.00dB"),
        "el mute no debería dejar pasar la ganancia del clip: {muted_graph}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn compound_audio_track_gain_applies_to_inner_clips() {
    // La ganancia de la pista externa se suma a la ganancia de los clips internos
    // del compuesto; si el clip interno tiene -3 dB y la pista +6 dB, el audio total
    // debe ser +3 dB (no 6 + (-3) duplicado).
    let root =
        std::env::temp_dir().join(format!("editor-ia-compound-gain-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let mut project = project();
    // Clip interno con ganancia propia de -3 dB
    project["timeline"]["clips"] = serde_json::json!([{
        "id": "inner-audio", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 20,
        "source": { "type": "asset", "assetId": "audio" },
        "audio": { "gainDb": -3.0 }
    }]);
    project["compounds"] = serde_json::json!([{
        "id": "99999999-9999-4999-8999-999999999999",
        "label": "Grupo", "durationFrames": 20, "clips": project["timeline"]["clips"].clone()
    }]);
    // Pista externa con ganancia de +6 dB
    project["timeline"]["tracks"][1]["gainDb"] = serde_json::json!(6.0);
    project["timeline"]["clips"] = serde_json::json!([{
        "id": "outer", "trackId": "a1", "kind": "compound",
        "startFrame": 0, "durationFrames": 20,
        "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" }
    }]);
    // Expansión debe sumar: pista externa (+6) + clip interno (-3) = +3 dB
    let tracks: HashMap<String, Value> = project["timeline"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .filter_map(|t| t["id"].as_str().map(|id| (id.to_owned(), t.clone())))
        .collect();
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let inner_expanded = expanded["timeline"]["clips"]
        .as_array()
        .expect("debería haber clips expandidos")
        .iter()
        .find(|c| c["id"] == "inner-audio")
        .expect("falta el clip interno expandido");
    // La herencia escribe en `audio.gainDb` del clip interno, que es donde
    // `audio_filter` lee la ganancia de clip al armar el grafo.
    let gain_db = inner_expanded["audio"]["gainDb"].as_f64().unwrap_or(0.0);
    assert_eq!(
        gain_db, 3.0,
        "ganancia expandida debe ser pista externa (+6) + clip interno (-3) = +3, no {}",
        gain_db
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn compound_audio_is_muted_by_its_outer_track_in_the_plan() {
    let root =
        std::env::temp_dir().join(format!("editor-ia-compound-mute-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan_for = |project: &Value| {
        build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan debería construirse")
    };
    let mut project = project();
    let inner = project["timeline"]["clips"].clone();
    project["timeline"]["clips"] = serde_json::json!([{
        "id": "outer", "trackId": "v1", "kind": "compound",
        "startFrame": 0, "durationFrames": 30,
        "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" }
    }]);
    project["compounds"] = serde_json::json!([{
        "id": "99999999-9999-4999-8999-999999999999",
        "label": "Grupo", "durationFrames": 30, "clips": inner
    }]);

    project["timeline"]["tracks"][0]["muted"] = serde_json::json!(true);
    let tracks: HashMap<String, Value> = project["timeline"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .filter_map(|t| t["id"].as_str().map(|id| (id.to_owned(), t.clone())))
        .collect();
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let muted_args = expanded["timeline"]["clips"]
        .as_array()
        .unwrap()
        .iter()
        .all(|c| c["audio"]["muted"].as_bool().unwrap_or(false));
    assert!(muted_args, "todos los clips internos deben estar muteados");

    project["timeline"]["tracks"][0]["muted"] = serde_json::json!(false);
    let sounding = plan_for(&project);
    let sounding_args = sounding.args.join(" ");
    assert!(
        !sounding_args.contains("anullsrc"),
        "sin mute el audio interno debería conservarse: {sounding_args}"
    );
    assert!(
        sounding_args.contains("audio.wav"),
        "sin mute el clip de audio interno debería ser un input: {sounding_args}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn compound_audio_is_soloed_by_its_outer_track_in_the_plan() {
    let root =
        std::env::temp_dir().join(format!("editor-ia-compound-solo-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    std::fs::write(media.join("music.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan_for = |project: &Value| {
        build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan debería construirse")
    };
    let mut project = project();
    let inner = project["timeline"]["clips"].clone();
    project["timeline"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "a2", "kind": "audio", "order": 2, "hidden": false, "muted": false
        }));
    project["timeline"]["clips"] = serde_json::json!([
        {
            "id": "outer", "trackId": "v1", "kind": "compound",
            "startFrame": 0, "durationFrames": 30,
            "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" }
        },
        {
            "id": "music", "trackId": "a2", "kind": "audio",
            "startFrame": 0, "durationFrames": 30,
            "source": { "type": "asset", "assetId": "asset3", "inFrame": 0, "outFrame": 30 }
        }
    ]);
    project["assets"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "asset3", "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/music.wav" }
        }));
    project["compounds"] = serde_json::json!([{
        "id": "99999999-9999-4999-8999-999999999999",
        "label": "Grupo", "durationFrames": 30, "clips": inner
    }]);

    project["timeline"]["tracks"][0]["solo"] = serde_json::json!(true);
    let soloed = plan_for(&project);
    let soloed_args = soloed.args.join(" ");
    assert!(
        soloed_args.contains("audio.wav"),
        "el audio interno debería sonar con el solo de la pista exterior: {soloed_args}"
    );
    assert!(
        !soloed_args.contains("music.wav"),
        "el solo del compuesto debería excluir la música: {soloed_args}"
    );

    project["timeline"]["tracks"][0]["solo"] = serde_json::json!(false);
    let both = plan_for(&project);
    let both_args = both.args.join(" ");
    assert!(
        both_args.contains("audio.wav") && both_args.contains("music.wav"),
        "sin solo deberían mezclarse el audio interno y la música: {both_args}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn disabled_clips_are_skipped_by_the_render_graph() {
    let mut project = project();
    project["timeline"]["clips"][0]["enabled"] = serde_json::json!(false);
    let root = std::env::temp_dir().join(format!("editor-ia-off-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan con clip desactivado debería construirse");
    let joined = plan.args.join(" ");
    assert!(
        !joined.contains("media/video.mp4"),
        "el clip desactivado no debería entrar como input: {joined}"
    );
    assert!(plan.args.iter().any(|arg| arg.contains("[aout]")));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn freeze_clips_render_as_looped_stills_inside_the_video_track() {
    let mut project = project();
    project["timeline"]["clips"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "freeze1", "trackId": "v1", "kind": "freeze",
            "label": "Congelado", "startFrame": 30, "durationFrames": 30,
            "source": { "type": "asset", "assetId": "asset3" },
            "transitionIn": { "type": "dissolve", "frames": 6 },
            "effects": { "brightness": 0.1, "saturation": 1.1 }
        }));
    project["assets"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "asset3", "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/frame.png" }
        }));
    let root = std::env::temp_dir().join(format!("editor-ia-freeze-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    std::fs::write(media.join("frame.png"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan con freeze debería construirse");
    let freeze_index = plan
        .args
        .iter()
        .position(|arg| arg.ends_with("frame.png"))
        .expect("el PNG del freeze no entró como input");
    assert_eq!(plan.args[freeze_index - 7], "-loop");
    assert_eq!(plan.args[freeze_index - 6], "1");
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("brightness=0.1000"))
        .expect("falta el filtro del freeze");
    assert!(graph.contains("saturation=1.1000"));
    assert!(
        graph.contains("between(t,0.800000,2.000000)"),
        "el freeze no respeta el solape de entrada: {graph}"
    );
    assert_eq!(
        transition_lead_seconds(
            &serde_json::json!({
                "kind": "freeze",
                "transitionIn": { "type": "dissolve", "frames": 6 }
            }),
            30.0,
            1.0,
            1.0
        ),
        0.2
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn hidden_adjustment_layers_do_not_grade_the_composite() {
    let project = project_with_adjustment(true);
    let root = std::env::temp_dir().join(format!("editor-ia-adj-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan debería construirse");
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("[base"))
        .map(String::as_str)
        .unwrap_or("");
    assert!(!graph.contains("contrast=1.3000"));
    assert!(!graph.contains("curves=preset=vintage"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn compounds_on_hidden_tracks_do_not_reveal_their_inner_clips() {
    let mut project = serde_json::json!({
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": true, "muted": false },
                { "id": "g1", "kind": "graphic", "order": 1, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "outer", "trackId": "v1", "kind": "compound", "startFrame": 10, "durationFrames": 20, "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" } },
                { "id": "base", "trackId": "g1", "kind": "image", "startFrame": 0, "durationFrames": 30 }
            ]
        },
        "compounds": [
            { "id": "99999999-9999-4999-8999-999999999999", "label": "Grupo", "durationFrames": 20,
              "clips": [{ "id": "inner", "trackId": "g1", "kind": "image", "startFrame": 0, "durationFrames": 20 }] }
        ]
    });
    // Crear track_by_id antes de la expansión
    let tracks: HashMap<String, Value> = project["timeline"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .filter_map(|t| t["id"].as_str().map(|id| (id.to_owned(), t.clone())))
        .collect();
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let clips = expanded["timeline"]["clips"].as_array().unwrap();
    assert!(
        clips.iter().all(|clip| clip["id"] != "inner"),
        "una pista oculta no debe revelar los clips internos del compuesto"
    );
    assert!(clips.iter().all(|clip| clip["id"] != "outer"));
    assert!(clips.iter().any(|clip| clip["id"] == "base"));

    project["timeline"]["tracks"][0]["hidden"] = serde_json::json!(false);
    let tracks: HashMap<String, Value> = project["timeline"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .filter_map(|t| t["id"].as_str().map(|id| (id.to_owned(), t.clone())))
        .collect();
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let clips = expanded["timeline"]["clips"].as_array().unwrap();
    let inner = clips
        .iter()
        .find(|clip| clip["id"] == "inner")
        .expect("un compuesto visible debe expandirse");
    assert_eq!(inner["startFrame"], serde_json::json!(10));
}

#[test]
fn compound_audio_follows_the_outer_track_mute() {
    let mut project = serde_json::json!({
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": true },
                { "id": "v2", "kind": "video", "order": 1, "hidden": false, "muted": false },
                { "id": "a1", "kind": "audio", "order": 2, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "outer", "trackId": "v1", "kind": "compound", "startFrame": 0, "durationFrames": 20, "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" } }
            ]
        },
        "compounds": [
            { "id": "99999999-9999-4999-8999-999999999999", "label": "Grupo", "durationFrames": 20,
              "clips": [
                { "id": "inner-video", "trackId": "v2", "kind": "video", "startFrame": 0, "durationFrames": 20 },
                { "id": "inner-audio", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 20 }
              ] }
        ]
    });
    let tracks: HashMap<String, Value> = project["timeline"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .filter_map(|t| t["id"].as_str().map(|id| (id.to_owned(), t.clone())))
        .collect();
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let clips = expanded["timeline"]["clips"].as_array().unwrap();
    for id in ["inner-video", "inner-audio"] {
        let clip = clips
            .iter()
            .find(|clip| clip["id"] == id)
            .unwrap_or_else(|| panic!("falta {id} en la expansión"));
        assert_eq!(
            clip["audio"]["muted"],
            serde_json::json!(true),
            "{id} debe heredar el mute de la pista exterior"
        );
    }

    project["timeline"]["tracks"][0]["muted"] = serde_json::json!(false);
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let clips = expanded["timeline"]["clips"].as_array().unwrap();
    for id in ["inner-video", "inner-audio"] {
        let clip = clips
            .iter()
            .find(|clip| clip["id"] == id)
            .expect("clip interno");
        assert_ne!(
            clip["audio"]["muted"],
            serde_json::json!(true),
            "{id} no debe quedar mudo si la pista exterior no lo está"
        );
    }
}

#[test]
fn compound_audio_follows_the_outer_track_solo() {
    let mut project = serde_json::json!({
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false, "solo": true },
                { "id": "v2", "kind": "video", "order": 1, "hidden": false, "muted": false },
                { "id": "a1", "kind": "audio", "order": 2, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "outer", "trackId": "v1", "kind": "compound", "startFrame": 0, "durationFrames": 20, "source": { "type": "compound", "compoundId": "99999999-9999-4999-8999-999999999999" } }
            ]
        },
        "compounds": [
            { "id": "99999999-9999-4999-8999-999999999999", "label": "Grupo", "durationFrames": 20,
              "clips": [
                { "id": "inner-video", "trackId": "v2", "kind": "video", "startFrame": 0, "durationFrames": 20 },
                { "id": "inner-audio", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 20 }
              ] }
        ]
    });
    let tracks: HashMap<String, Value> = project["timeline"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .filter_map(|t| t["id"].as_str().map(|id| (id.to_owned(), t.clone())))
        .collect();
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let clips = expanded["timeline"]["clips"].as_array().unwrap();
    for id in ["inner-video", "inner-audio"] {
        let clip = clips
            .iter()
            .find(|clip| clip["id"] == id)
            .unwrap_or_else(|| panic!("falta {id} en la expansión"));
        assert_eq!(
            clip["audio"]["solo"],
            serde_json::json!(true),
            "{id} debe heredar el solo de la pista exterior"
        );
    }

    project["timeline"]["tracks"][0]["solo"] = serde_json::json!(false);
    let expanded =
        expand_compounds_con_pistas(&project, &tracks).expect("la expansión no debería fallar");
    let clips = expanded["timeline"]["clips"].as_array().unwrap();
    for id in ["inner-video", "inner-audio"] {
        let clip = clips
            .iter()
            .find(|clip| clip["id"] == id)
            .expect("clip interno");
        assert_ne!(
            clip["audio"]["solo"],
            serde_json::json!(true),
            "{id} no debe quedar en solo si la pista exterior no lo está"
        );
    }
}

#[test]
fn tone_curve_is_neutral_when_unset_and_clamps_values() {
    assert!(tone_curve_filter(&serde_json::json!({})).is_none());
    assert!(tone_curve_filter(&serde_json::json!({
        "shadows": 0.0,
        "highlights": 0.0,
        "fade": 0.0
    }))
    .is_none());
    let curve = tone_curve_filter(&serde_json::json!({
        "shadows": 2,
        "highlights": -2,
        "fade": 2
    }))
    .expect("la curva de tono debería existir");
    assert!(curve.contains("0.0000/0.1000"));
    assert!(curve.contains("0.2500/0.4200"));
    assert!(curve.contains("0.7500/0.6100"));
    assert!(curve.contains("1.0000/0.9500"));
}

#[test]
fn custom_curves_reach_the_filter_chain_and_override_the_preset() {
    let clip = serde_json::json!({
        "effects": {
            "curvePreset": "vintage",
            "curves": {
                "master": [
                    { "x": 0, "y": 0 },
                    { "x": 0.25, "y": 0.18 },
                    { "x": 0.5, "y": 0.55 },
                    { "x": 1, "y": 1 }
                ],
                "red": [
                    { "x": 0, "y": 0.02 },
                    { "x": 1, "y": 0.98 }
                ]
            }
        }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        3.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(
            filter.contains(
                "curves=master='0.0000/0.0000 0.2500/0.1800 0.5000/0.5500 1.0000/1.0000':red='0.0000/0.0200 1.0000/0.9800'"
            ),
            "curvas inesperadas: {filter}"
        );
    assert!(
        !filter.contains("curves=preset="),
        "la curva personalizada debe tener prioridad sobre el preset"
    );
}

#[test]
fn custom_curves_sort_clamp_and_ignore_short_channels() {
    let clip = serde_json::json!({
        "effects": {
            "curvePreset": "darker",
            "curves": {
                "master": [
                    { "x": 1, "y": 2 },
                    { "x": 0.5, "y": -1 },
                    { "x": 0, "y": 0 }
                ],
                "blue": [{ "x": 0, "y": 0 }]
            }
        }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(
        filter.contains("curves=master='0.0000/0.0000 0.5000/0.0000 1.0000/1.0000'"),
        "curvas sin ordenar ni acotar: {filter}"
    );
    assert!(!filter.contains("blue='"), "un canal corto no se emite");
}

#[test]
fn an_invalid_custom_curve_falls_back_to_the_preset() {
    let clip = serde_json::json!({
        "effects": {
            "curvePreset": "darker",
            "curves": { "master": [{ "x": 0.2, "y": 0.2 }, { "x": 1, "y": 1 }] }
        }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(filter.contains("curves=preset=darker"));
    assert!(!filter.contains("curves=master="));
}

#[test]
fn clip_animations_reach_the_filters_and_overlay_terms() {
    let profile = profile();
    let slide = serde_json::json!({
        "animationIn": { "type": "slide-left", "durationFrames": 15 },
        "animationOut": { "type": "slide-up", "durationFrames": 15 }
    });
    let (x, y) = animation_overlay_terms(&slide, 2.0, 4.0, profile.fps());
    assert!(x.unwrap().contains("W*(1-"));
    assert!(y.unwrap().contains("-H*("));

    let fade = serde_json::json!({
        "animationIn": { "type": "fade", "durationFrames": 12 },
        "animationOut": { "type": "fade", "durationFrames": 12 }
    });
    let filter = visual_filter(
        0,
        &fade,
        &serde_json::json!({}),
        &profile,
        4.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(filter.contains("fade=t=in:st=0.000000:d="));
    assert!(filter.contains("fade=t=out:st="));
    assert!(filter.contains("alpha=1"));
}

#[test]
fn cover_fit_scales_up_and_center_crops() {
    let mut profile = profile();
    profile.width = 1080;
    profile.height = 1920;
    profile.fit = "cover".into();
    let clip = serde_json::json!({});
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile,
        3.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(filter.contains("force_original_aspect_ratio=increase"));
    assert!(filter.contains("crop=1080:1920"));
    assert!(!filter.contains("force_original_aspect_ratio=decrease"));
}

#[test]
fn photo_motion_reaches_the_filter_chain() {
    let profile = profile();
    let zoom = serde_json::json!({
        "motion": { "type": "zoom-in", "intensity": 0.15 }
    });
    let zoom_filter = visual_filter(
        0,
        &zoom,
        &serde_json::json!({}),
        &profile,
        3.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(zoom_filter.contains("setpts=PTS-STARTPTS"));
    assert!(zoom_filter.contains("zoompan=z='1+0.1500*on/"));
    assert!(zoom_filter.contains("x='(iw-iw/zoom)/2'"));
    assert!(zoom_filter.contains("scale=w=1920"));

    let pan = serde_json::json!({
        "motion": { "type": "pan-right", "intensity": 0.2 }
    });
    let pan_filter = visual_filter(
        0,
        &pan,
        &serde_json::json!({}),
        &profile,
        3.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(pan_filter.contains("zoompan=z='1.2000'"));
    assert!(pan_filter.contains("x='(iw-iw/zoom)*on/"));
}

#[test]
fn profile_parses_compression_and_rejects_unknown_presets() {
    let value = serde_json::json!({
        "id": "p",
        "name": "Compacto",
        "resolution": { "width": 1280, "height": 720 },
        "frameRate": { "num": 24_000, "den": 1_001 },
        "bitrate": { "mode": "crf", "crf": 27 },
        "videoPreset": "faster",
        "audioBitsPerSecond": 96_000,
        "qualityGate": { "minOutputBytes": 50_000 }
    });
    let parsed = parse_profile(&value).expect("perfil válido");
    assert_eq!(parsed.crf, Some(27));
    assert_eq!(parsed.video_preset, "faster");
    assert_eq!(parsed.fit, "contain");
    assert_eq!(parsed.audio_bps, 96_000);
    assert_eq!(parsed.fps(), 24_000.0 / 1_001.0);

    let defaults = serde_json::json!({
        "id": "p",
        "name": "Default",
        "resolution": { "width": 1920, "height": 1080 },
        "frameRate": { "num": 30, "den": 1 },
        "bitrate": { "mode": "crf", "crf": 22 },
        "qualityGate": { "minOutputBytes": 1 }
    });
    let parsed = parse_profile(&defaults).expect("defaults válidos");
    assert_eq!(parsed.video_preset, "veryfast");
    assert_eq!(parsed.audio_bps, 128_000);

    let mut unknown = value;
    unknown["videoPreset"] = serde_json::json!("turbo");
    assert!(parse_profile(&unknown).is_err());

    let h264_32k = serde_json::json!({
        "id": "p",
        "name": "32K H.264",
        "resolution": { "width": 32_768, "height": 4_320 },
        "frameRate": { "num": 120, "den": 1 },
        "bitrate": { "mode": "crf", "crf": 22 },
        "qualityGate": { "minOutputBytes": 1 }
    });
    assert!(parse_profile(&h264_32k).is_err());
    let mut h265_32k = h264_32k;
    h265_32k["videoCodec"] = serde_json::json!("h265");
    let parsed = parse_profile(&h265_32k).expect("H.265 acepta 32K");
    assert_eq!(parsed.width, 32_768);
    assert_eq!(parsed.fps(), 120.0);
}

#[test]
fn hardware_encoder_args_match_each_api() {
    let mut amf = profile();
    amf.hardware_encoder = Some("h264_amf".into());
    let args = hardware_encoder_args(&amf).expect("AMF");
    let text = args.join(" ");
    assert!(text.contains("h264_amf") && text.contains("-rc cqp") && text.contains("-qp_i 20"));
    assert!(!text.contains("libx264"));

    let mut nvenc = profile();
    nvenc.hardware_encoder = Some("h264_nvenc".into());
    let text = hardware_encoder_args(&nvenc).expect("NVENC").join(" ");
    assert!(text.contains("h264_nvenc") && text.contains("-cq 20") && text.contains("p6"));

    let mut qsv = profile();
    qsv.video_codec = "h265".into();
    qsv.hardware_encoder = Some("hevc_qsv".into());
    let text = hardware_encoder_args(&qsv).expect("QSV").join(" ");
    assert!(text.contains("hevc_qsv") && text.contains("-global_quality 20"));

    let mut bitrate = profile();
    bitrate.crf = None;
    bitrate.target_bps = Some(8_000_000);
    bitrate.hardware_encoder = Some("h264_amf".into());
    let text = hardware_encoder_args(&bitrate)
        .expect("AMF por bitrate")
        .join(" ");
    assert!(text.contains("-b:v 8000000") && !text.contains("-rc cqp"));

    assert!(hardware_encoder_args(&profile()).is_none());
}

#[test]
fn profile_validates_the_optional_hardware_encoder() {
    let mut value = serde_json::json!({
        "id": "p",
        "name": "GPU",
        "resolution": { "width": 1920, "height": 1080 },
        "frameRate": { "num": 30, "den": 1 },
        "videoCodec": "h264",
        "bitrate": { "mode": "crf", "crf": 20 },
        "qualityGate": { "minOutputBytes": 1 },
        "hardwareEncoder": "h264_amf"
    });
    let parsed = parse_profile(&value).expect("AMF es un encoder conocido");
    assert_eq!(parsed.hardware_encoder.as_deref(), Some("h264_amf"));

    value["hardwareEncoder"] = serde_json::json!("encoder-inventado");
    assert!(parse_profile(&value).is_err());

    value["hardwareEncoder"] = serde_json::json!("hevc_amf");
    assert!(
        parse_profile(&value).is_err(),
        "no se puede codificar HEVC en un perfil H.264"
    );

    value["videoCodec"] = serde_json::json!("h265");
    let parsed = parse_profile(&value).expect("HEVC AMF coincide con H.265");
    assert_eq!(parsed.hardware_encoder.as_deref(), Some("hevc_amf"));

    value["resolution"] = serde_json::json!({ "width": 32_768, "height": 4_320 });
    assert!(
        parse_profile(&value).is_err(),
        "AMF HEVC no debe aceptar 32K"
    );
}

fn webm_profile() -> serde_json::Value {
    serde_json::json!({
        "id": "w",
        "name": "WebM VP9",
        "container": "webm",
        "videoCodec": "vp9",
        "audioCodec": "opus",
        "resolution": { "width": 1920, "height": 1080 },
        "frameRate": { "num": 30, "den": 1 },
        "bitrate": { "mode": "crf", "crf": 30 },
        "qualityGate": { "minOutputBytes": 1 }
    })
}

#[test]
fn webm_profile_follows_the_container_matrix() {
    let parsed = parse_profile(&webm_profile()).expect("WebM VP9 + Opus es válido");
    assert_eq!(parsed.container, "webm");
    assert_eq!(parsed.video_codec, "vp9");
    assert_eq!(parsed.audio_codec, "opus");

    let mut bad = webm_profile();
    bad["videoCodec"] = serde_json::json!("h264");
    assert!(parse_profile(&bad).is_err(), "WebM no lleva H.264");

    let mut bad = webm_profile();
    bad["audioCodec"] = serde_json::json!("aac");
    assert!(parse_profile(&bad).is_err(), "WebM no lleva AAC");

    let mut bad = webm_profile();
    bad["container"] = serde_json::json!("mp4");
    assert!(parse_profile(&bad).is_err(), "MP4 no lleva VP9+Opus");

    let mut av1 = webm_profile();
    av1["videoCodec"] = serde_json::json!("av1");
    let parsed = parse_profile(&av1).expect("WebM AV1 + Opus es válido");
    assert_eq!(parsed.video_codec, "av1");

    let mut bad = webm_profile();
    bad["container"] = serde_json::json!("mkv");
    assert!(parse_profile(&bad).is_err());
}

#[test]
fn pixel_format_sigue_la_matriz_real_del_pipeline() {
    // yuv420p es el default y viaja aunque el perfil no lo declare.
    let parsed = parse_profile(&webm_profile()).expect("VP9 por defecto");
    assert_eq!(parsed.pixel_format, "yuv420p");

    // 4:4:4 es válido en WebM VP9 y AV1 por software.
    let mut vp9_444 = webm_profile();
    vp9_444["pixelFormat"] = serde_json::json!("yuv444p");
    let parsed = parse_profile(&vp9_444).expect("VP9 4:4:4");
    assert_eq!(parsed.pixel_format, "yuv444p");

    let mut av1_444 = webm_profile();
    av1_444["videoCodec"] = serde_json::json!("av1");
    av1_444["pixelFormat"] = serde_json::json!("yuv444p");
    assert_eq!(
        parse_profile(&av1_444).expect("AV1 4:4:4").pixel_format,
        "yuv444p"
    );

    // H.264/H.265 y el hardware son 4:2:0: se rechaza con motivo.
    let mut mp4_444 = webm_profile();
    mp4_444["container"] = serde_json::json!("mp4");
    mp4_444["videoCodec"] = serde_json::json!("h264");
    mp4_444["audioCodec"] = serde_json::json!("aac");
    mp4_444["pixelFormat"] = serde_json::json!("yuv444p");
    assert!(parse_profile(&mp4_444).is_err(), "MP4/H.264 no emite 4:4:4");

    let mut hw_444 = webm_profile();
    hw_444["pixelFormat"] = serde_json::json!("yuv444p");
    hw_444["hardwareEncoder"] = serde_json::json!("vp9_qsv");
    assert!(parse_profile(&hw_444).is_err(), "VP9 hardware es 4:2:0");

    // rgb24 no lo acepta ningún encoder de entrega.
    let mut rgb = webm_profile();
    rgb["pixelFormat"] = serde_json::json!("rgb24");
    assert!(
        parse_profile(&rgb).is_err(),
        "rgb24 es intermedio, no de entrega"
    );

    let mut bogus = webm_profile();
    bogus["pixelFormat"] = serde_json::json!("yuv411p");
    assert!(parse_profile(&bogus).is_err());
}

#[test]
fn pixel_444_exige_el_encoder_software_que_lo_emite() {
    // En tests no hay FFmpeg sondeable: 4:4:4 debe fallar con un motivo
    // claro en vez de degradar a 4:2:0 en silencio.
    let mut vp9 = profile();
    vp9.video_codec = "vp9".into();
    vp9.audio_codec = "opus".into();
    vp9.container = "webm".into();
    vp9.pixel_format = "yuv444p".into();
    let error = software_encoder_for(Path::new("ffprobe"), &vp9)
        .expect_err("sin libvpx-vp9 no hay VP9 4:4:4");
    assert!(error.message.contains("libvpx-vp9"), "{}", error.message);

    let mut av1 = vp9.clone();
    av1.video_codec = "av1".into();
    let error = software_encoder_for(Path::new("ffprobe"), &av1)
        .expect_err("sin libaom-av1 no hay AV1 4:4:4");
    assert!(error.message.contains("libaom-av1"), "{}", error.message);

    // 4:2:0 conserva el comportamiento histórico aunque no haya sondeo.
    vp9.pixel_format = "yuv420p".into();
    assert_eq!(
        software_encoder_for(Path::new("ffprobe"), &vp9).expect("VP9 4:2:0"),
        "libvpx-vp9"
    );
}

#[test]
fn software_video_args_match_each_encoder_family() {
    let mut vp9 = profile();
    vp9.video_codec = "vp9".into();
    vp9.audio_codec = "opus".into();
    vp9.container = "webm".into();
    let args = software_video_args("libvpx-vp9", &vp9).join(" ");
    assert!(args.contains("-c:v libvpx-vp9"));
    assert!(args.contains("-cpu-used"), "VP9 usa cpu-used: {args}");
    assert!(args.contains("-row-mt 1"));
    assert!(
        args.contains("-crf 20") && args.contains("-b:v 0"),
        "VP9 CRF exige -b:v 0: {args}"
    );
    assert!(
        !args.contains("-preset"),
        "libvpx-vp9 no acepta -preset: {args}"
    );

    let mut svt = vp9.clone();
    let args = software_video_args("libsvtav1", &svt).join(" ");
    assert!(
        args.contains("-preset"),
        "SVT-AV1 usa su escala de presets: {args}"
    );
    assert!(args.contains("-crf 20"));

    svt.target_bps = Some(4_000_000);
    svt.crf = None;
    let args = software_video_args("libsvtav1", &svt).join(" ");
    assert!(args.contains("-b:v 4000000"));

    let args = software_video_args("libaom-av1", &vp9).join(" ");
    assert!(args.contains("-cpu-used") && args.contains("-crf 20") && args.contains("-b:v 0"));

    // Las familias viejas no cambian.
    let args = software_video_args("libx264", &profile()).join(" ");
    assert!(args.contains("-preset veryfast") && args.contains("-crf 20"));
    let args = software_video_args("h264_mf", &profile()).join(" ");
    assert!(args.contains("-b:v 8000000") && !args.contains("-crf"));
}

#[test]
fn choose_encoder_picks_by_codec() {
    let available = |names: &[&str]| names.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let list = available(&["libx264", "libvpx-vp9", "libsvtav1", "libaom-av1"]);
    assert_eq!(choose_encoder(&list, "vp9"), "libvpx-vp9");
    // SVT-AV1 encabeza la preferencia AV1.
    assert_eq!(choose_encoder(&list, "av1"), "libsvtav1");
    let no_svt = available(&["libaom-av1"]);
    assert_eq!(choose_encoder(&no_svt, "av1"), "libaom-av1");
    let empty = Vec::new();
    // Sin encoders disponibles devuelve el primero de la lista igual
    // (el binario fallará y el error será honesto), no entra en pánico.
    assert_eq!(choose_encoder(&empty, "vp9"), "libvpx-vp9");
}

#[test]
fn opus_forces_libopus_and_48k() {
    let mut vp9 = profile();
    vp9.video_codec = "vp9".into();
    vp9.audio_codec = "opus".into();
    vp9.container = "webm".into();
    vp9.audio_rate = 44_100; // Opus fuerza 48 kHz igual.
    assert_eq!(audio_encoder_for(&vp9), ("libopus", 48_000));
    assert_eq!(audio_encoder_for(&profile()), ("aac", 48_000));
}

#[test]
fn audio_suite_reaches_the_filter_chain() {
    let audio = serde_json::json!({
        "gainDb": -3,
        "highPassHz": 80,
        "lowPassHz": 12000,
        "eqLowDb": -2,
        "eqMidDb": 3,
        "eqHighDb": 2,
        "compressor": true,
        "deesser": true,
        "gateDb": -38,
        "denoise": 0.2,
        "fadeInFrames": 15,
        "fadeOutFrames": 30
    });
    let filter = audio_filter(
        0,
        &profile(),
        30.0,
        3.0,
        0.0,
        0.0,
        &audio,
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &serde_json::json!({}),
    );
    assert!(filter.contains("highpass=f=80.0"));
    assert!(filter.contains("lowpass=f=12000.0"));
    assert!(filter.contains("equalizer=f=100.0"));
    assert!(filter.contains("equalizer=f=1000.0"));
    assert!(filter.contains("equalizer=f=8000.0"));
    assert!(filter.contains("afftdn=nr="));
    assert!(filter.contains("deesser="));
    assert!(filter.contains("agate=threshold=-38.0dB"));
    assert!(filter.contains("acompressor="));
    assert!(filter.contains("afade=t=in"));
    assert!(filter.contains("afade=t=out"));
}

#[test]
fn audio_stack_keyframes_build_a_segmented_concat_graph() {
    // 3 s a 30 fps = 90 frames; keyframes en 0 y 45 → 2 tramos.
    // 45 frames * 48000/30 = 72000 samples por tramo.
    let effects = serde_json::json!({
        "audioStack": [
            {
                "id": "a",
                "effectId": "audio.tremolo",
                "enabled": true,
                "params": { "rate": 2.0, "depth": 0.5 },
                "keyframes": {
                    "rate": [
                        { "frame": 0, "value": 2.0 },
                        { "frame": 45, "value": 8.0 }
                    ]
                }
            }
        ]
    });
    let filter = audio_filter(
        0,
        &profile(),
        30.0,
        3.0,
        0.0,
        0.0,
        &serde_json::json!({}),
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &effects,
    );
    assert!(filter.contains("asplit=2"), "{filter}");
    assert!(
        filter.contains("atrim=start_sample=0:end_sample=72000"),
        "{filter}"
    );
    assert!(
        filter.contains("atrim=start_sample=72000:end_sample=144000"),
        "{filter}"
    );
    assert!(filter.contains("concat=n=2:v=0:a=1[astk0]"), "{filter}");
    // Tramo 1 (medio en frame 22.5, lineal 2→8): rate ≈ 5; tramo 2 sostiene 8.
    assert!(filter.contains("tremolo=f=5"), "{filter}");
    assert!(filter.contains("tremolo=f=8"), "{filter}");
    // La ganancia y el resto de la cadena siguen detrás del concat.
    assert!(filter.contains("[astk0]"), "{filter}");
}

#[test]
fn audio_stack_without_keyframes_keeps_the_linear_chain() {
    let effects = serde_json::json!({
        "audioStack": [
            {
                "id": "a",
                "effectId": "audio.tremolo",
                "enabled": true,
                "params": { "rate": 4.0, "depth": 0.5 }
            }
        ]
    });
    let filter = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &serde_json::json!({}),
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &effects,
    );
    assert!(!filter.contains("asplit"), "{filter}");
    assert!(filter.contains("tremolo=f=4"), "{filter}");
    assert!(filter.contains("[0:a]"), "{filter}");
}

#[test]
fn track_pan_and_eq_reach_the_audio_chain() {
    let track = serde_json::json!({
        "pan": -0.5,
        "eqLowDb": 4,
        "eqMidDb": 0,
        "eqHighDb": -3
    });
    let filters = track_audio_filters(&track, 0.0, 30.0, false);
    let chain = filters.0.join(",");
    assert!(chain.contains("equalizer=f=120.0:t=q:w=1:g=4.00"));
    assert!(!chain.contains("equalizer=f=1000.0"));
    assert!(chain.contains("equalizer=f=8000.0:t=q:w=1:g=-3.00"));
    assert!(chain.contains("pan=stereo|c0=1.0000*c0|c1=0.5000*c1"));
    assert!(filters.1.is_none());

    let audio = serde_json::json!({});
    let integrated = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &audio,
        false,
        1,
        1,
        0.0,
        &track,
        &serde_json::json!({}),
    );
    assert!(integrated.contains("equalizer=f=120.0"));
    assert!(integrated.contains("pan=stereo|c0=1.0000*c0|c1=0.5000*c1"));

    assert!(
        track_audio_filters(&serde_json::json!({ "pan": 0 }), 0.0, 30.0, false)
            .0
            .is_empty()
    );
    let clamped = track_audio_filters(
        &serde_json::json!({
            "pan": 3,
            "eqLowDb": 20
        }),
        0.0,
        30.0,
        false,
    )
    .0
    .join(",");
    assert!(clamped.contains("g=12.00"));
    assert!(clamped.contains("0.0000*c0|c1=1.0000*c1"));
}

#[test]
fn clip_pan_overrides_track_pan_and_uses_the_same_linear_law() {
    let track = serde_json::json!({ "pan": -1.0 });
    let audio = serde_json::json!({ "pan": 0.5 });
    let chain = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &audio,
        false,
        1,
        1,
        0.0,
        &track,
        &serde_json::json!({}),
    );
    assert!(
        chain.contains("pan=stereo|c0=0.5000*c0|c1=1.0000*c1"),
        "clip pan debe atenuar sólo el canal izquierdo: {chain}"
    );
    assert_eq!(
        chain.matches("pan=stereo").count(),
        1,
        "el paneo de pista no debe apilarse sobre el de clip"
    );

    let left = serde_json::json!({ "pan": -0.25 });
    let centered = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &left,
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &serde_json::json!({}),
    );
    assert!(centered.contains("pan=stereo|c0=1.0000*c0|c1=0.7500*c1"));
}

#[test]
#[ignore]
fn live_track_pan_and_eq_change_the_audio() {
    let ffmpeg = std::env::var("EDITOR_IA_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_owned());
    let dir = std::env::temp_dir().join(format!("editor-ia-audio-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("temp audio");
    let pan_file = dir.join("pan.wav");
    let status = std::process::Command::new(&ffmpeg)
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1:sample_rate=48000",
            "-af",
            "aformat=sample_fmts=fltp:channel_layouts=stereo,pan=stereo|c0=1.0000*c0|c1=0.5000*c1",
            "-c:a",
            "pcm_s16le",
            pan_file.to_string_lossy().as_ref(),
        ])
        .status()
        .expect("ffmpeg disponible");
    assert!(status.success(), "FFmpeg rechazó el paneo");

    let mean_db = |channel: &str| -> f64 {
        let filter = format!("pan=mono|c0={channel},volumedetect");
        let output = std::process::Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-i",
                pan_file.to_string_lossy().as_ref(),
                "-af",
                &filter,
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("ffmpeg volumedetect");
        let text = String::from_utf8_lossy(&output.stderr);
        let line = text
            .lines()
            .find(|line| line.contains("mean_volume:"))
            .expect("mean_volume");
        line.split(':')
            .nth(1)
            .and_then(|value| value.trim().strip_suffix(" dB"))
            .and_then(|value| value.parse::<f64>().ok())
            .expect("dB")
    };
    let left = mean_db("c0");
    let right = mean_db("c1");
    assert!(
        (left - right - 6.02).abs() < 0.2,
        "paneo -0.5: izquierda {left} dB, derecha {right} dB"
    );

    let eq_file = dir.join("eq.wav");
    let status = std::process::Command::new(&ffmpeg)
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=120:duration=1:sample_rate=48000",
            "-af",
            "aformat=sample_fmts=fltp:channel_layouts=stereo,equalizer=f=120.0:t=q:w=1:g=-12.00",
            "-c:a",
            "pcm_s16le",
            eq_file.to_string_lossy().as_ref(),
        ])
        .status()
        .expect("ffmpeg disponible");
    assert!(status.success(), "FFmpeg rechazó el EQ");
    let flat_file = dir.join("flat.wav");
    let _ = std::process::Command::new(&ffmpeg)
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=120:duration=1:sample_rate=48000",
            "-af",
            "aformat=sample_fmts=fltp:channel_layouts=stereo",
            "-c:a",
            "pcm_s16le",
            flat_file.to_string_lossy().as_ref(),
        ])
        .status();
    let file_mean = |path: &std::path::Path| -> f64 {
        let filter = "pan=mono|c0=c0,volumedetect";
        let output = std::process::Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-i",
                path.to_string_lossy().as_ref(),
                "-af",
                filter,
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("ffmpeg volumedetect");
        let text = String::from_utf8_lossy(&output.stderr);
        let line = text
            .lines()
            .find(|line| line.contains("mean_volume:"))
            .expect("mean_volume");
        line.split(':')
            .nth(1)
            .and_then(|value| value.trim().strip_suffix(" dB"))
            .and_then(|value| value.parse::<f64>().ok())
            .expect("dB")
    };
    let flat = file_mean(&flat_file);
    let equalized = file_mean(&eq_file);
    assert!(
        flat - equalized > 10.0,
        "EQ -12 dB a 120 Hz: plano {flat} dB, con EQ {equalized} dB"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn chroma_key_reaches_the_filter_chain() {
    let clip = serde_json::json!({
        "chromaKey": { "color": "#00ff00", "similarity": 0.3, "blend": 0.1, "spill": 0.6 }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        3.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(filter.contains("chromakey=0x00ff00:similarity=0.3000:blend=0.1000"));
    assert!(filter.contains("despill=type=green:mix=0.6000"));
}

#[test]
fn chroma_key_on_a_non_screen_color_skips_despill() {
    let clip = serde_json::json!({
        "chromaKey": { "color": "#cc8844", "similarity": 0.3, "blend": 0.1, "spill": 0.8 }
    });
    let filter = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        3.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(filter.contains("chromakey=0xcc8844"));
    assert!(!filter.contains("despill="));
}

#[test]
fn voice_effects_reach_the_audio_chain() {
    let deep = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &serde_json::json!({ "voiceEffect": "deep" }),
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &serde_json::json!({}),
    );
    assert!(deep.contains("asetrate="));
    let echo = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &serde_json::json!({ "voiceEffect": "echo" }),
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &serde_json::json!({}),
    );
    assert!(echo.contains("aecho="));
    let radio = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &serde_json::json!({ "voiceEffect": "radio" }),
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &serde_json::json!({}),
    );
    assert!(radio.contains("lowpass=f=3200"));
}

#[test]
fn audio_stack_reaches_the_audio_chain() {
    let effects = serde_json::json!({
        "audioStack": [
            {
                "id": "tel",
                "effectId": "audio.telephone",
                "enabled": true,
                "params": { "low": 350.0, "high": 3200.0 }
            },
            {
                "id": "deep",
                "effectId": "audio.voice_deep",
                "enabled": true,
                "params": { "pitch": 0.8 }
            },
            {
                "id": "off",
                "effectId": "audio.muffled",
                "enabled": false,
                "params": { "cutoff": 800.0, "level": 0.0 }
            },
            {
                "id": "video",
                "effectId": "color.exposure",
                "enabled": true,
                "params": { "exposure": 0.2 }
            }
        ]
    });
    let audio = serde_json::json!({ "gainDb": -3.0 });
    let chain = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &audio,
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &effects,
    );
    assert!(chain.contains("highpass=f=350"), "{chain}");
    assert!(chain.contains("lowpass=f=3200"), "{chain}");
    assert!(chain.contains("asetrate=48000*0.8"), "{chain}");
    assert!(chain.contains("atempo=1.25"), "{chain}");
    assert!(!chain.contains("lowpass=f=800"), "apagado: {chain}");
    assert!(!chain.contains("eq=brightness"), "efecto de video: {chain}");
    let stack_at = chain.find("highpass=f=350").expect("stack");
    let fader_at = chain.find("volume=-3.00dB").expect("fader");
    assert!(
        stack_at < fader_at,
        "el stack es un insert y va antes del fader: {chain}"
    );
}

#[test]
fn audio_stack_without_instances_leaves_the_chain_untouched() {
    let mut filters = vec!["aformat=sample_fmts=fltp".to_owned()];
    apply_audio_effect_stack(&mut filters, &serde_json::json!({}), 48_000);
    apply_audio_effect_stack(
        &mut filters,
        &serde_json::json!({ "audioStack": [] }),
        48_000,
    );
    assert_eq!(filters, vec!["aformat=sample_fmts=fltp".to_owned()]);
}

/// Render real de la cadena de audio con un stack: un tono de 6 kHz debe
/// caer al menos 20 dB después de `audio.muffled`.
///
/// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test live_audio_stack -- --ignored`
#[test]
#[ignore]
fn live_audio_stack_muffles_a_high_tone() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("live_audio_stack omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let effects = serde_json::json!({
        "audioStack": [{
            "id": "muffled",
            "effectId": "audio.muffled",
            "enabled": true,
            "params": { "cutoff": 800.0, "level": 0.0 }
        }]
    });
    let mut filters = vec!["aformat=sample_fmts=fltp:channel_layouts=stereo".to_owned()];
    apply_audio_effect_stack(&mut filters, &effects, 48_000);
    let chain = filters.join(",");
    let mean_db = |filter: &str| -> f64 {
        let output = std::process::Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=6000:sample_rate=48000:duration=0.3",
                "-af",
                &format!("{filter},volumedetect"),
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("ffmpeg volumedetect");
        let text = String::from_utf8_lossy(&output.stderr);
        let line = text
            .lines()
            .find(|line| line.contains("mean_volume:"))
            .expect("mean_volume");
        line.split(':')
            .nth(1)
            .and_then(|value| value.trim().strip_suffix(" dB"))
            .and_then(|value| value.parse::<f64>().ok())
            .expect("dB")
    };
    let before = mean_db("anull");
    let after = mean_db(&chain);
    assert!(
        before - after > 20.0,
        "amortiguado: {before} dB → {after} dB con {chain}"
    );
}

#[test]
fn extra_transitions_change_the_filter_chain() {
    let dissolve = serde_json::json!({ "transitionIn": { "type": "dissolve", "frames": 6 } });
    let dissolve_filter = visual_filter(
        0,
        &dissolve,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(dissolve_filter.contains("alpha=1"));

    let fade = serde_json::json!({ "transitionIn": { "type": "fade-black", "frames": 6 } });
    let fade_filter = visual_filter(
        0,
        &fade,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(fade_filter.contains("fade=t=in:st=0:d=0.200"));
    assert!(!fade_filter.contains("alpha=1"));

    let white = serde_json::json!({ "transitionIn": { "type": "fade-white", "frames": 6 } });
    let white_filter = visual_filter(
        0,
        &white,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(white_filter.contains("color=white"));

    let slide = serde_json::json!({ "transitionIn": { "type": "slide-left", "frames": 6 } });
    let x = overlay_x_expression(&slide, 2.0, 0.2, "0.000");
    assert!(x.contains("+(W)*(1-"));
    assert!(x.contains("if(lt(t,2.000000)"));

    let up = serde_json::json!({ "transitionIn": { "type": "slide-up", "frames": 6 } });
    let y = overlay_y_expression(&up, 2.0, 0.2, "0.000", None);
    assert!(y.contains("+(H)*(1-"));
    assert!(y.contains("if(lt(t,2.000000)"));
    let down = serde_json::json!({ "transitionIn": { "type": "slide-down", "frames": 6 } });
    let y_down = overlay_y_expression(&down, 2.0, 0.2, "0.000", None);
    assert!(y_down.contains("+(-H)*(1-"));

    // Dip to color: el clip entrante funde desde el color elegido.
    let dip = serde_json::json!({
        "transitionIn": { "type": "dip-color", "frames": 6, "color": "#123456" }
    });
    let dip_filter = visual_filter(
        0,
        &dip,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(dip_filter.contains("fade=t=in:st=0:d=0.200:color=0x123456"));

    // Sin color cae a negro (default seguro).
    let dip_plain = serde_json::json!({
        "transitionIn": { "type": "dip-color", "frames": 6 }
    });
    let dip_plain_filter = visual_filter(
        0,
        &dip_plain,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(dip_plain_filter.contains("color=0x000000"));

    // Wipe: máscara geq progresiva por frame sobre el clip entrante.
    // `wipe-left`/`wipe-up` usan `gte` para que el borde opuesto quede
    // abierto al llegar a p=1 (con `gt` la columna/fila X=0/Y=0 quedaba
    // transparente para siempre).
    for (kind, needle) in [
        ("wipe-left", "gte(X,W*(1-("),
        ("wipe-right", "lt(X,W*("),
        ("wipe-up", "gte(Y,H*(1-("),
        ("wipe-down", "lt(Y,H*("),
    ] {
        let wipe = serde_json::json!({
            "transitionIn": { "type": kind, "frames": 6 }
        });
        let wipe_filter = visual_filter(
            0,
            &wipe,
            &serde_json::json!({}),
            &profile(),
            2.0,
            0.2,
            0.0,
            1,
            1,
            true,
        );
        assert!(
            wipe_filter.contains("geq=r='r(X,Y)'") && wipe_filter.contains(needle),
            "{kind} debería emitir su máscara geq, filtro: {wipe_filter}"
        );
    }

    // Iris: óvalo que crece desde el centro; el guard `gt(p,0.999)`
    // abre los vértices exactos al cerrar el lead.
    let iris = serde_json::json!({
        "transitionIn": { "type": "iris", "frames": 6 }
    });
    let iris_filter = visual_filter(
        0,
        &iris,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(
        iris_filter.contains("geq=r='r(X,Y)'")
            && iris_filter.contains("gt((if(lt(N,")
            && iris_filter.contains("(X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)"),
        "iris debería emitir su máscara geq radial: {iris_filter}"
    );

    // Iris congelado: progreso constante, sin `in`/`n`.
    let iris_frozen = serde_json::json!({
        "transitionFrozen": { "mode": "wipe", "kind": "iris", "progress": 0.5 }
    });
    let iris_frozen_filter = visual_filter(
        0,
        &iris_frozen,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(
        iris_frozen_filter.contains("geq=r='r(X,Y)'")
            && iris_frozen_filter.contains("(0.500000)*(0.500000)")
            && !iris_frozen_filter.contains("N/"),
        "iris congelado debería usar progreso constante: {iris_frozen_filter}"
    );

    // Slide 3D: desplazamiento del overlay igual que slide-* más un
    // `perspective` eval=frame que comprime el eje perpendicular al lead.
    for (kind, axis) in [
        ("slide-3d-left", "x"),
        ("slide-3d-right", "x"),
        ("slide-3d-up", "y"),
        ("slide-3d-down", "y"),
    ] {
        let clip = serde_json::json!({
            "transitionIn": { "type": kind, "frames": 6 }
        });
        let filter = visual_filter(
            0,
            &clip,
            &serde_json::json!({}),
            &profile(),
            2.0,
            0.2,
            0.0,
            1,
            1,
            true,
        );
        assert!(
            filter.contains("perspective=")
                && filter.contains("eval=frame")
                && filter.contains("sense=destination")
                && filter.contains("enable='lt(n,6)'"),
            "{kind} debería emitir perspective por frame, filtro: {filter}"
        );
        let progress_expr = "0.15+0.85*min(max((in/6),0),1)";
        if axis == "x" {
            assert!(
                filter.contains("x0='W*(1-(")
                    && filter.contains(progress_expr)
                    && filter.contains("y0='0'")
                    && filter.contains("y2='H'"),
                "{kind} debería comprimir X, filtro: {filter}"
            );
        } else {
            assert!(
                filter.contains("y0='H*(1-(")
                    && filter.contains(progress_expr)
                    && filter.contains("x0='0'")
                    && filter.contains("x2='0'"),
                "{kind} debería comprimir Y, filtro: {filter}"
            );
        }
        // El desplazamiento del overlay usa la misma fórmula que slide-*.
        let slide_clip = serde_json::json!({
            "transitionIn": { "type": kind, "frames": 6 }
        });
        let ox = overlay_x_expression(&slide_clip, 2.0, 0.2, "0.000");
        let oy = overlay_y_expression(&slide_clip, 2.0, 0.2, "0.000", None);
        if axis == "x" {
            assert!(
                ox.contains("if(lt(t,2.000000)"),
                "{kind} sin desplazamiento x"
            );
            assert!(!oy.contains("if(lt(t,2.000000)"), "{kind} con y animada");
        } else {
            assert!(
                oy.contains("if(lt(t,2.000000)"),
                "{kind} sin desplazamiento y"
            );
        }
    }

    // Congelado: el preview resuelve el progreso y el filtro usa la
    // constante, sin `in`/`n`.
    let frozen = serde_json::json!({
        "transitionFrozen": { "mode": "slide3d", "axis": "x", "progress": 0.5, "x": 160.0, "y": 0.0 }
    });
    let frozen_filter = visual_filter(
        0,
        &frozen,
        &serde_json::json!({}),
        &profile(),
        2.0,
        0.2,
        0.0,
        1,
        1,
        true,
    );
    assert!(
        frozen_filter.contains("perspective=")
            && frozen_filter.contains("min(max((0.500000),0),1)")
            && !frozen_filter.contains("in/"),
        "slide3d congelado debería usar progreso constante: {frozen_filter}"
    );
}

#[test]
fn luma_wipe_wires_the_mate_as_a_mask_input() {
    let root = std::env::temp_dir().join(format!("editor-ia-luma-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("mate.mp4"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let project = || {
        serde_json::json!({
            "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                    { "id": "v2", "kind": "video", "order": 1, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "c2", "trackId": "v1", "kind": "video", "startFrame": 30, "durationFrames": 60,
                      "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 60 },
                      "transitionIn": { "type": "luma-wipe", "frames": 12, "mateClipId": "c1" } },
                    { "id": "c1", "trackId": "v2", "kind": "video", "startFrame": 0, "durationFrames": 60,
                      "source": { "type": "asset", "assetId": "asset3", "inFrame": 0, "outFrame": 60 } }
                ]
            },
            "assets": [
                { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" } },
                { "id": "asset3", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/mate.mp4" } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        })
    };
    let plan_for = |project: &Value| {
        build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
    };
    let plan = plan_for(&project()).expect("el plan del luma wipe debería construirse");
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("alphamerge"))
        .cloned()
        .unwrap_or_else(|| plan.args.join(" "));
    assert!(
        graph.contains("alphamerge")
            && graph.contains("scale2ref")
            && graph.contains("concat=n=2:v=1:a=0"),
        "falta el grafo de máscara del mate: {graph}"
    );
    assert!(
        graph.contains("format=gray"),
        "la máscara debe ser luminancia: {graph}"
    );
    // c2 es el primer clip visual (v1 order 0): su cadena es v1 y el
    // overlay consume la salida ya mascarada, no la original.
    assert!(
        graph.contains("[base0][v1out]overlay"),
        "el overlay debería usar la salida del wipe: {graph}"
    );
    // El mate es el clip c1 (asset3): su ventana de fuente arranca en el
    // inicio del solape (frame 18 = 0.6 s) y dura el lead (0.4 s + margen).
    let mate_uses = plan
        .args
        .iter()
        .zip(plan.args.iter().skip(1))
        .filter(|(flag, value)| flag.as_str() == "-i" && value.contains("mate.mp4"))
        .count();
    assert_eq!(
        mate_uses, 2,
        "el mate entra como clip y como máscara: {:?}",
        plan.args
    );
    let seek_at = plan
        .args
        .iter()
        .position(|arg| arg == "0.600000")
        .expect("seek del mate");
    assert_eq!(plan.args[seek_at - 1], "-ss");

    // Sin mate el documento no puede renderizar: error honesto.
    let mut broken = project();
    broken["timeline"]["clips"][0]["transitionIn"]
        .as_object_mut()
        .unwrap()
        .remove("mateClipId");
    assert!(
        plan_for(&broken).is_err(),
        "luma-wipe sin mate debería fallar"
    );

    // Un mate que no cubre el solape también falla.
    let mut uncovered = project();
    uncovered["timeline"]["clips"][1]["durationFrames"] = serde_json::json!(10);
    assert!(
        plan_for(&uncovered).is_err(),
        "mate sin cobertura debería fallar"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// Render real del luma wipe: la luminancia del mate decide qué clip se
/// ve durante el solape. Mate mitad negra/mitad blanca → durante el lead
/// la mitad izquierda muestra el clip de abajo (rojo) y la derecha el
/// entrante (azul); terminado el lead el cuadro queda azul parejo.
#[test]
#[ignore]
fn render_luma_wipe_uses_the_mate_luminance() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_luma_wipe omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-luma-render-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    for (name, color) in [("base.mp4", "red"), ("wipe.mp4", "blue")] {
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c={color}:s=320x180:d=2:r=30"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-an",
                "-y",
            ])
            .arg(media.join(name))
            .status()
            .expect("generar el clip de color");
        assert!(status.success());
    }
    // Mate estático: mitad izquierda negra, mitad derecha blanca.
    let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:d=2:r=30,drawbox=x=160:y=0:w=160:h=180:c=white:t=fill,format=yuv420p",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-an",
                "-y",
            ])
            .arg(media.join("mate.mp4"))
            .status()
            .expect("generar el mate de luminancia");
    assert!(status.success());

    let asset = |id: &str, file: &str| {
        serde_json::json!({
            "id": id, "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": format!("media/{file}") },
            "media": { "width": 320, "height": 180, "durationFrames": 60,
                       "frameRate": { "num": 30, "den": 1 } }
        })
    };
    let clip = |id: &str, track: &str, start: u64, asset_id: &str| {
        serde_json::json!({
            "id": id, "trackId": track, "kind": "video",
            "startFrame": start, "durationFrames": 60,
            "source": { "type": "asset", "assetId": asset_id, "inFrame": 0, "outFrame": 60 }
        })
    };
    let mut wipe = clip("wipe", "v2", 30, "asset-wipe");
    wipe["transitionIn"] = serde_json::json!({
        "type": "luma-wipe", "frames": 12, "mateClipId": "mask"
    });
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                { "id": "v2", "kind": "video", "order": 1, "hidden": false, "muted": false },
                { "id": "v3", "kind": "video", "order": 2, "hidden": true, "muted": false }
            ],
            "clips": [
                clip("base", "v1", 0, "asset-base"),
                wipe,
                clip("mask", "v3", 0, "asset-mate")
            ]
        },
        "assets": [
            asset("asset-base", "base.mp4"),
            asset("asset-wipe", "wipe.mp4"),
            asset("asset-mate", "mate.mp4")
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test luma 320x180".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1_000,
        duration_tolerance_frames: 10,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("luma-out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan del luma wipe debería construirse");
    execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render del luma wipe debería verificarse");

    // t=0.8 s está dentro del lead (0.6–1.0 s): mitad roja / mitad azul.
    let left = region_luma(&ffmpeg, &output, 0.8, 0, 0, 160, 180);
    let right = region_luma(&ffmpeg, &output, 0.8, 160, 0, 160, 180);
    eprintln!("luma wipe a mitad del lead: izq={left:.2} der={right:.2}");
    assert!(
        left > right + 15.0,
        "la máscara no reveló el clip de abajo a la izquierda: {left:.2} vs {right:.2}"
    );
    // t=1.5 s ya pasó el lead: cuadro parejo del clip entrante.
    let left_after = region_luma(&ffmpeg, &output, 1.5, 0, 0, 160, 180);
    let right_after = region_luma(&ffmpeg, &output, 1.5, 160, 0, 160, 180);
    eprintln!("luma wipe después del lead: izq={left_after:.2} der={right_after:.2}");
    assert!(
        (left_after - right_after).abs() < 8.0,
        "terminado el lead el cuadro no quedó parejo: {left_after:.2} vs {right_after:.2}"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn lut_is_appended_before_the_output_label() {
    let chain = "[0:v]fps=30,format=rgba[v0]".to_owned();
    let with = apply_lut_to_chain(chain, "v0", Path::new("C:/obra/media/luts/x.cube"), 1.0);
    assert!(with.ends_with("[v0]"));
    assert!(with.contains("lut3d=file='C\\:/obra/media/luts/x.cube'"));
}

#[test]
fn partial_lut_intensity_mixes_original_and_graded() {
    let chain = "[0:v]fps=30,format=rgba[v0]".to_owned();
    let mixed = apply_lut_to_chain(chain, "v0", Path::new("C:/obra/media/luts/x.cube"), 0.35);
    assert!(mixed.ends_with("[v0]"));
    assert!(mixed.contains(",format=rgba,split=2[v0src][v0lut]"));
    assert!(!mixed.contains("rgbaformat"));
    assert!(mixed.contains("[v0lut]lut3d=file='C\\:/obra/media/luts/x.cube'[v0graded]"));
    // FFmpeg's blend opacity is the weight of the first input, so an
    // intensity of 0.35 keeps 65% of the original and 35% of the LUT.
    assert!(mixed.contains("[v0src][v0graded]blend=all_mode=normal:all_opacity=0.6500[v0]"));
    assert!(!mixed.contains(",lut3d=file="));
}

#[test]
fn adjustment_lut_blend_is_gated_to_its_window() {
    let chain = "[base0]null[adj0]".to_owned();
    let gated = apply_lut_to_chain_gated(
        chain,
        "adj0",
        Path::new("C:/obra/media/luts/x.cube"),
        0.5,
        Some((1.0, 2.5)),
    );
    assert!(gated.contains(",format=rgba,split=2[adj0src][adj0lut]"));
    assert!(gated.contains(
        "blend=all_mode=normal:all_opacity=0.5000:enable='between(t,1.000000,2.500000)'[adj0]"
    ));
    let full = apply_lut_to_chain_gated(
        "[base0]eq=contrast=1.1[adj0]".to_owned(),
        "adj0",
        Path::new("C:/obra/media/luts/x.cube"),
        1.0,
        Some((1.0, 2.5)),
    );
    assert!(full.contains("eq=contrast=1.1,lut3d=file="));
    assert!(full.contains(":enable='between(t,1.000000,2.500000)'[adj0]"));
    assert!(!full.contains("blend="));
}

#[test]
fn full_and_zero_lut_intensity_avoid_the_blend_graph() {
    let chain = "[0:v]fps=30,format=rgba[v0]".to_owned();
    let full = apply_lut_to_chain(
        chain.clone(),
        "v0",
        Path::new("C:/obra/media/luts/x.cube"),
        1.0,
    );
    assert!(full.ends_with("[v0]"));
    assert!(full.contains(",lut3d=file='C\\:/obra/media/luts/x.cube'[v0]"));
    assert!(!full.contains("blend="));
    let zero = apply_lut_to_chain(chain, "v0", Path::new("C:/obra/media/luts/x.cube"), 0.0);
    assert_eq!(zero, "[0:v]fps=30,format=rgba[v0]");
}

#[test]
fn blend_modes_map_to_ffmpeg() {
    assert_eq!(blend_mode_name("multiply"), Some("multiply"));
    assert_eq!(blend_mode_name("overlay"), Some("hardlight"));
    assert_eq!(blend_mode_name("soft-light"), Some("softlight"));
    assert_eq!(blend_mode_name("color-dodge"), Some("dodge"));
    assert_eq!(blend_mode_name("desconocido"), None);
}

#[test]
fn mask_reaches_the_filter_chain() {
    let ellipse = serde_json::json!({
        "mask": { "shape": "ellipse", "x": 0.1, "y": -0.1, "width": 0.8, "height": 0.9, "feather": 0.2, "invert": false }
    });
    let filter = visual_filter(
        0,
        &ellipse,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(filter.contains("geq=r='r(X,Y)'"));
    assert!(filter.contains("alpha(X,Y)*("));
    assert!(filter.contains("sqrt("));

    let rectangle = serde_json::json!({
        "mask": { "shape": "rectangle", "x": 0, "y": 0, "width": 0.6, "height": 0.6, "feather": 0, "invert": true }
    });
    let inverted = visual_filter(
        0,
        &rectangle,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(inverted.contains("(1-("));

    let rotated = serde_json::json!({
        "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.6, "rotationDeg": 45 }
    });
    let rotated_chain =
        mask_filter(&rotated, 30.0, 0.0).expect("la máscara rotada debería generarse");
    assert!(rotated_chain.contains("cos((45.000000)*PI/180)"));
    assert!(rotated_chain.contains("sin((45.000000)*PI/180)"));
    assert!(rotated_chain.contains("(H/W)"));
    assert!(rotated_chain.contains("(W/H)"));

    let animated = serde_json::json!({
        "mask": {
            "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.6,
            "keyframes": [
                { "frame": 0, "x": -0.2 },
                { "frame": 30, "x": 0.2 }
            ]
        }
    });
    let animated_chain =
        mask_filter(&animated, 30.0, 0.0).expect("la máscara animada debería generar expresiones");
    assert!(animated_chain.contains("if(lt("));
    assert!(animated_chain.contains("(N-0)/30.000000"));
    assert!(inverted.contains("abs("));

    let plain = serde_json::json!({});
    let none = visual_filter(
        0,
        &plain,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(!none.contains("geq="));
}

#[test]
#[ignore]
fn live_polygon_mask_filter_is_renderable() {
    let clip = serde_json::json!({
        "mask": {
            "shape": "polygon",
            "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0,
            "points": [
                { "x": 0.35, "y": 0.3 }, { "x": 0.65, "y": 0.3 },
                { "x": 0.65, "y": 0.7 }, { "x": 0.35, "y": 0.7 }
            ]
        }
    });
    let filter = mask_filter(&clip, 30.0, 0.0).expect("polygon filter");
    let output = std::env::temp_dir().join(format!("editor-ia-poly-{}.png", uuid::Uuid::new_v4()));
    let chain = format!("format=rgba,{filter}");
    let status = std::process::Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=320x180:d=1",
            "-vf",
            &chain,
            "-frames:v",
            "1",
            "-update",
            "1",
            output.to_string_lossy().as_ref(),
        ])
        .status()
        .expect("ffmpeg disponible");
    assert!(status.success(), "FFmpeg rechazó el filtro poligonal");
    assert!(output.is_file() && std::fs::metadata(&output).unwrap().len() > 100);
    let _ = std::fs::remove_file(&output);
}

#[test]
fn polygon_mask_reaches_the_alpha_expression() {
    let polygon = serde_json::json!({
        "mask": {
            "shape": "polygon",
            "x": 0.0,
            "y": 0.0,
            "width": 1.0,
            "height": 1.0,
            "points": [
                { "x": 0.2, "y": 0.2 },
                { "x": 0.8, "y": 0.2 },
                { "x": 0.7, "y": 0.8 },
                { "x": 0.3, "y": 0.75 }
            ]
        }
    });
    let filter = mask_filter(&polygon, 30.0, 0.0).expect("la máscara poligonal debe generarse");
    assert!(filter.contains("mod("));
    assert!(filter.contains("alpha(X,Y)*("));

    let mut inverted = polygon;
    inverted["mask"]["invert"] = serde_json::json!(true);
    let filter = mask_filter(&inverted, 30.0, 0.0).expect("la máscara invertida debe generarse");
    assert!(filter.contains("1-(mod("));

    let mut animated = inverted;
    animated["mask"]["keyframes"] = serde_json::json!([
        { "frame": 0, "x": -0.1 },
        { "frame": 30, "x": 0.1 }
    ]);
    let filter = mask_filter(&animated, 30.0, 0.0).expect("la máscara animada debe generarse");
    assert!(filter.contains("-0.1") && filter.contains("0.1"));
}

#[test]
fn short_render_byte_gate_scales_with_duration() {
    // Un clip corto enmascarado puede ser válido y pesar menos que el
    // mínimo pensado para contenido lleno; el guardia baja con la duración.
    assert_eq!(effective_min_output_bytes(500_000, 5.0), 50_000);
    assert_eq!(effective_min_output_bytes(500_000, 0.2), 10_000);
    assert_eq!(effective_min_output_bytes(500_000, 60.0), 500_000);
    assert_eq!(effective_min_output_bytes(1_000, 5.0), 1_000);
}

#[test]
fn extra_mask_shapes_reach_the_alpha_expression() {
    let diamond = serde_json::json!({
        "mask": { "shape": "diamond", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 }
    });
    let diamond_chain =
        mask_filter(&diamond, 30.0, 0.0).expect("la máscara diamante debe generarse");
    assert!(diamond_chain.contains("abs("));
    assert!(diamond_chain.contains("geq=r='r(X,Y)'"));

    let triangle = serde_json::json!({
        "mask": { "shape": "triangle", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 }
    });
    let triangle_chain =
        mask_filter(&triangle, 30.0, 0.0).expect("la máscara triángulo debe generarse");
    assert!(triangle_chain.contains("max(0,min(1,"));

    let rounded = serde_json::json!({
        "mask": { "shape": "rounded", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 }
    });
    let rounded_chain =
        mask_filter(&rounded, 30.0, 0.0).expect("la máscara redondeada debe generarse");
    assert!(rounded_chain.contains("pow("));
    assert!(rounded_chain.contains("sqrt("));

    let unknown = serde_json::json!({
        "mask": { "shape": "heart", "x": 0, "y": 0, "width": 1, "height": 1 }
    });
    assert!(mask_filter(&unknown, 30.0, 0.0).is_none());
}

#[test]
fn reverse_reaches_both_filter_chains() {
    let clip = serde_json::json!({ "reverse": true });
    let visual = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(visual.contains("reverse"));

    let audio = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &serde_json::json!({}),
        true,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &serde_json::json!({}),
    );
    assert!(audio.contains("areverse"));
}

#[test]
fn scale_zoom_handles_up_down_and_crossing_curves() {
    let clip = serde_json::json!({
        "transform": { "keyframes": [
            { "frame": 0, "scale": 1, "rotationDeg": 0 },
            { "frame": 30, "scale": 1.4, "rotationDeg": 0 }
        ] }
    });
    let (base, expression) =
        scale_zoom_expression(&clip, &profile(), 0.0).expect("curva de escala");
    assert!((base - 1.0).abs() < 1e-9);
    assert!(expression.contains("max(1,("));
    assert!(expression.contains("on-"));

    let mut down = clip.clone();
    down["transform"]["keyframes"][1]["scale"] = serde_json::json!(0.8);
    assert!(scale_zoom_expression(&down, &profile(), 0.0).is_none());
    let (base, expression) =
        scale_dynamic_expression(&down, &profile(), 0.0, 1, 1, false).expect("bajada");
    assert!((base - 1.0).abs() < 1e-9);
    assert!(expression.contains("min(1,("));
    assert!(expression.contains("/1.000000"));

    let mut crossing = clip.clone();
    crossing["transform"]["keyframes"][0]["scale"] = serde_json::json!(0.8);
    crossing["transform"]["keyframes"][1]["scale"] = serde_json::json!(1.3);
    assert!(scale_zoom_expression(&crossing, &profile(), 0.0).is_none());
    let (base, expression) =
        scale_dynamic_expression(&crossing, &profile(), 0.0, 1, 1, false).expect("cruce");
    assert!((base - 1.3).abs() < 1e-9);
    assert!(expression.contains("/1.300000"));
    let (_, fast) = scale_dynamic_expression(&crossing, &profile(), 0.0, 2, 1, false).expect("2×");
    assert!(fast.contains("/60.000000"), "reloj de velocidad: {fast}");
    let (_, still) =
        scale_dynamic_expression(&crossing, &profile(), 0.0, 2, 1, true).expect("imagen");
    assert!(still.contains("/30.000000"), "imagen sin retime: {still}");
    crossing["transform"]["rotationDeg"] = serde_json::json!(10);
    assert!(scale_dynamic_expression(&crossing, &profile(), 0.0, 1, 1, false).is_some());

    let mut rotated = clip.clone();
    rotated["transform"]["keyframes"][1]["rotationDeg"] = serde_json::json!(4);
    assert!(scale_zoom_expression(&rotated, &profile(), 0.0).is_some());

    let mut static_rotation = clip.clone();
    static_rotation["transform"]["rotationDeg"] = serde_json::json!(10);
    assert!(scale_zoom_expression(&static_rotation, &profile(), 0.0).is_some());

    let mut motion = clip.clone();
    motion["motion"] = serde_json::json!({ "type": "zoom-in" });
    assert!(scale_zoom_expression(&motion, &profile(), 0.0).is_some());

    let mut frozen = clip.clone();
    frozen["scaleFrozen"] = serde_json::json!(true);
    assert!(scale_zoom_expression(&frozen, &profile(), 0.0).is_none());

    let mut static_scale = clip.clone();
    static_scale["transform"]["scaleX"] = serde_json::json!(1.2);
    assert!(scale_zoom_expression(&static_scale, &profile(), 0.0).is_some());
}

#[test]
fn static_scale_combines_with_keyframed_scale() {
    let clip = serde_json::json!({
        "transform": {
            "scaleX": 1.15,
            "scaleY": 1.15,
            "keyframes": [
                { "frame": 0, "scale": 1 },
                { "frame": 30, "scale": 1.3 }
            ]
        }
    });
    let visual = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(visual.contains("scale=iw*1.150000:ih*1.150000"));
    assert!(visual.contains("zoompan"));
    assert!(visual.contains("s=2208x1242"));
}

#[test]
fn rotation_keyframes_use_local_time_and_fixed_canvas() {
    let clip = serde_json::json!({
        "transform": { "keyframes": [
            { "frame": 0, "rotationDeg": 0 },
            { "frame": 30, "rotationDeg": 45 }
        ] }
    });
    let visual = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    let rotate = visual
        .split("rotate=angle=")
        .nth(1)
        .expect("rotación animada");
    assert!(rotate.contains("(t-0.000000)"));
    assert!(!rotate.contains("((n-"));
    assert!(rotate.contains("c=black@0:ow=1920:oh=1080"));
    assert!(!rotate.contains("rotw("));
}

#[test]
fn transform_and_gain_keyframes_reach_the_filter_chain() {
    let clip = serde_json::json!({
        "transform": {
            "keyframes": [
                { "frame": 0, "scale": 1.0, "offsetX": 0, "rotationDeg": 0, "easing": "ease-in-out" },
                { "frame": 15, "scale": 1.4, "offsetX": 120, "rotationDeg": 6, "easing": "ease-out" },
                { "frame": 29, "scale": 1.0, "offsetX": 0, "rotationDeg": 0 }
            ]
        },
        "audio": {
            "gainKeyframes": [
                { "frame": 0, "gainDb": -12, "easing": "ease-in" },
                { "frame": 30, "gainDb": 0 }
            ]
        }
    });
    let visual = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        true,
    );
    assert!(visual.contains("zoompan"));
    assert!(visual.contains("rotate=angle='("));
    assert!(visual.contains("c=black@0:ow=1920:oh=1080"));
    assert!(!visual.contains("rotw("));
    let audio = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &clip["audio"],
        false,
        1,
        1,
        0.0,
        &serde_json::json!({}),
        &clip["effects"],
    );
    assert!(audio.contains("volume=volume='pow(10,"));
    assert!(audio.contains("eval=frame"));
}

#[test]
fn offset_keyframes_use_global_time() {
    let clip = serde_json::json!({
        "transform": {
            "keyframes": [
                { "frame": 0, "offsetX": 0 },
                { "frame": 15, "offsetX": 90 }
            ]
        }
    });
    let expression = offset_expression(&clip, "offsetX", 2.0, 30.0).expect("expresión");
    assert!(expression.contains("(t-2.000000)"));
    assert!(expression.contains("90.0000"));
    assert!(expression.contains("if(lt((t-2.000000),0.000000)"));
}

#[test]
fn opacity_keyframes_emit_frame_sampled_commands() {
    let clip = serde_json::json!({
        "transform": {
            "keyframes": [
                { "frame": 0, "opacity": 0.2 },
                { "frame": 30, "opacity": 1.0 }
            ]
        }
    });
    let visual = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(visual.contains("colorchannelmixer@kf0=aa=0.2000"));
    assert!(visual.contains("sendcmd=c='"));
    assert!(visual.contains("colorchannelmixer@kf0 aa 1.0000"));
    assert!(
        !visual.contains("colorchannelmixer=aa="),
        "la opacidad animada no debe convivir con el mezclador estático"
    );
    let commands = visual.matches("colorchannelmixer@kf0 aa").count();
    assert!(
        commands > 2,
        "deberían muestrearse varios frames: {commands}"
    );
    assert!(commands <= 301, "los comandos están acotados: {commands}");
}

#[test]
fn static_opacity_still_uses_a_constant_mixer() {
    let clip = serde_json::json!({ "transform": { "opacity": 0.5 } });
    let visual = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    assert!(visual.contains("colorchannelmixer=aa=0.5000"));
    assert!(!visual.contains("sendcmd="));
}

#[test]
fn opacity_keyframes_shift_commands_by_the_dissolve_lead() {
    let clip = serde_json::json!({
        "transitionIn": { "type": "dissolve", "frames": 6 },
        "transform": {
            "keyframes": [
                { "frame": 0, "opacity": 0.3 },
                { "frame": 9, "opacity": 0.9 }
            ]
        }
    });
    let visual = visual_filter(
        0,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.2,
        1.0,
        1,
        1,
        false,
    );
    // 6 frames a 30 fps = 0.2 s de solape: el último valor cae en 0.2+0.3.
    assert!(visual.contains("sendcmd=c='"));
    assert!(
        visual.contains("colorchannelmixer@kf0 aa 0.9000"),
        "falta el valor final: {visual}"
    );
    let first_command = visual
        .split("sendcmd=c='")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|value| value.parse::<f64>().ok())
        .expect("primer comando con tiempo");
    assert!(
        (first_command - 0.2333).abs() < 0.02,
        "el primer comando debe caer después del lead: {first_command}"
    );
}

fn project() -> Value {
    serde_json::json!({
        "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                { "id": "a1", "kind": "narration", "order": 1, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "c1", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 30 } },
                { "id": "c2", "trackId": "a1", "kind": "audio", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset2", "inFrame": 0, "outFrame": 30 } }
            ]
        },
        "assets": [
            { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" } },
            { "id": "asset2", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/audio.wav" } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    })
}

#[test]
fn track_gain_and_solo_shape_the_audio_mix() {
    let root = std::env::temp_dir().join(format!("editor-ia-mix-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    std::fs::write(media.join("music.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan_for = |project: &Value| {
        build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan debería construirse")
    };
    let mut project = project();
    project["timeline"]["tracks"][1]["gainDb"] = serde_json::json!(-7.5);
    let with_gain = plan_for(&project);
    let gain_graph = with_gain
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio");
    assert!(
        gain_graph.contains("volume=-7.50dB"),
        "la ganancia de pista no llega al mix: {gain_graph}"
    );

    project["timeline"]["tracks"][1]["pan"] = serde_json::json!(-0.5);
    project["timeline"]["tracks"][1]["eqLowDb"] = serde_json::json!(4);
    project["timeline"]["tracks"][1]["eqHighDb"] = serde_json::json!(-3);
    let with_pan = plan_for(&project);
    let pan_graph = with_pan
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio con paneo");
    assert!(
        pan_graph.contains("pan=stereo|c0=1.0000*c0|c1=0.5000*c1"),
        "el paneo de pista no llega al mix: {pan_graph}"
    );
    assert!(
        pan_graph.contains("equalizer=f=120.0:t=q:w=1:g=4.00"),
        "el EQ de pista no llega al mix: {pan_graph}"
    );
    assert!(pan_graph.contains("equalizer=f=8000.0:t=q:w=1:g=-3.00"));

    project["timeline"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "a2", "kind": "narration", "order": 2, "hidden": false, "muted": false
        }));
    project["timeline"]["clips"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "c3", "trackId": "a2", "kind": "audio",
            "startFrame": 0, "durationFrames": 30,
            "source": { "type": "asset", "assetId": "asset3", "inFrame": 0, "outFrame": 30 },
            "audio": { "gainDb": -4.25 }
        }));
    project["assets"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "asset3", "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/music.wav" }
        }));
    let both = plan_for(&project);
    let both_graph = both
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio");
    assert!(
        both_graph.contains("amix=inputs=2") && both_graph.contains("volume=-4.25dB"),
        "sin solo deberían mezclarse las dos pistas: {both_graph}"
    );

    project["timeline"]["tracks"][1]["solo"] = serde_json::json!(true);
    let solo = plan_for(&project);
    let solo_graph = solo
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio");
    assert!(
        !solo_graph.contains("volume=-4.25dB"),
        "el solo de la pista A debería excluir la música: {solo_graph}"
    );
    assert!(
        solo_graph.contains("volume=-7.50dB") && !solo_graph.contains("amix"),
        "el solo debería dejar sólo la pista A: {solo_graph}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn ducking_pads_the_sidechain_so_the_bed_survives_the_voice() {
    let root = std::env::temp_dir().join(format!("editor-ia-duck-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    for name in ["video.mp4", "audio.wav", "music.wav"] {
        std::fs::write(media.join(name), b"x").unwrap();
    }
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan_for = |project: &Value| {
        build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan debería construirse")
    };
    let mut project = project();
    project["timeline"]["tracks"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "a2", "kind": "audio", "order": 2, "hidden": false, "muted": false
        }));
    project["timeline"]["clips"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "c3", "trackId": "a2", "kind": "audio",
            "startFrame": 0, "durationFrames": 30,
            "source": { "type": "asset", "assetId": "asset3", "inFrame": 0, "outFrame": 30 }
        }));
    project["assets"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "asset3", "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/music.wav" }
        }));
    project["audio"]["ducking"] = serde_json::json!({
        "enabled": true, "amountDb": -12,
        "sourceTrackIds": ["a1"], "targetTrackIds": ["a2"]
    });
    let plan = plan_for(&project);
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio");
    assert!(
        graph.contains("[duck_side]apad[duck_side_padded]"),
        "el sidechain necesita apad o corta la música: {graph}"
    );
    assert!(
        graph.contains("[duck_target][duck_side_padded]sidechaincompress"),
        "el compresor debe usar el sidechain rellenado: {graph}"
    );
    assert!(
        graph.contains("sidechaincompress=threshold=0.03:ratio=8.0:attack=20:release=350"),
        "la reducción de -12 dB debería dar ratio 8: {graph}"
    );

    project["audio"]["ducking"]["enabled"] = serde_json::json!(false);
    let off_graph = plan_for(&project)
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .cloned()
        .expect("falta el grafo de audio");
    assert!(
        !off_graph.contains("sidechaincompress"),
        "sin ducking no debe haber compresor: {off_graph}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn render_external_project_when_requested() {
    let Some(project_path) = std::env::var("EDITORIA_RENDER_PROJECT").ok() else {
        return;
    };
    let project_text = std::fs::read_to_string(&project_path).expect("proyecto externo");
    let project: Value = serde_json::from_str(&project_text).expect("json externo");
    let project_path = PathBuf::from(&project_path);
    let root = project_path.parent().expect("raíz").to_path_buf();
    let profile_value = project["renderProfiles"]
        .as_array()
        .and_then(|profiles| profiles.first())
        .cloned()
        .expect("perfil");
    let mut profile = parse_profile(&profile_value).expect("perfil válido");
    profile.min_output_bytes = profile.min_output_bytes.min(50_000);
    let temp_dir = std::env::temp_dir().join(format!("editoria-ext-{}", std::process::id()));
    std::fs::create_dir_all(&temp_dir).expect("temp");
    let output = temp_dir.join("out.mp4");
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: true,
        temp_dir: &temp_dir,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("plan externo");
    let verification = execute_sync(Path::new("ffmpeg"), Path::new("ffprobe"), &plan, |_| {})
        .expect("render externo");
    assert!(output.is_file());
    assert!(verification.output_bytes > 10_000);
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn script_number_precision_is_renderable() {
    assert_eq!(seconds(1.5), "1.500000");
    assert_eq!(hex_color("#101014"), "0x101014");
    assert_eq!(hex_color("nope"), "0x0f1319");
}

#[test]
fn progress_accepts_microseconds_and_timecodes() {
    let progress = progress_from_line("out_time_us=5000000", 10.0).unwrap();
    assert!((progress.percent - 50.0).abs() < 0.01);
    let progress = progress_from_line("out_time=00:00:05.000000", 10.0).unwrap();
    assert!((progress.percent - 50.0).abs() < 0.01);
    assert!(progress_from_line("fps=30", 10.0).is_none());
}

#[test]
fn ass_time_is_reused_for_the_render_clock() {
    assert_eq!(ass_time(1.5), "0:00:01.50");
}

#[test]
fn sanitize_log_removes_private_roots() {
    let root = Path::new("C:/Users/private/obra");
    let log = "error en C:/Users/private/obra/media/a.mp4";
    let sanitized = sanitize_log(log, root, 200);
    assert!(!sanitized.contains("Users/private"));
    assert!(sanitized.contains("<proyecto>"));
}

#[test]
fn a_graphic_clip_is_refused_instead_of_silently_skipped() {
    let mut project = project();
    project["timeline"]["tracks"][0]["kind"] = serde_json::json!("graphic");
    project["timeline"]["clips"][0]["kind"] = serde_json::json!("graphic");
    project["timeline"]["clips"][0]["source"] =
        serde_json::json!({ "type": "graphic", "motionId": "m" });
    let temp = std::env::temp_dir().join("editor-ia-unit-temp");
    let _ = std::fs::create_dir_all(&temp);
    let result = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: Path::new("C:/obra"),
        profile: &profile(),
        output_path: Path::new("C:/obra/salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    });
    assert!(result.is_err());
}

#[test]
fn a_graphic_clip_with_a_motion_ass_is_composited_before_captions() {
    let mut project = project();
    project["timeline"]["tracks"][0]["kind"] = serde_json::json!("graphic");
    project["timeline"]["clips"][0]["kind"] = serde_json::json!("graphic");
    project["timeline"]["clips"][0]["source"] =
        serde_json::json!({ "type": "graphic", "motionId": "m" });
    project["captions"] = serde_json::json!({
        "styles": [],
        "cues": [{ "trackId": "cap", "startFrame": 0, "endFrame": 30, "text": "hola" }]
    });
    let root = std::env::temp_dir().join(format!("editor-ia-motion-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: true,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: Some("Dialogue: 0,0:00:00.00,0:00:02.00,Motion,,0,0,0,,hola\n"),
    })
    .expect("el clip gráfico con plan debe construir el plan");
    let graph = plan.args.join(";");
    assert!(graph.contains("ass=motion.ass"));
    assert!(graph.contains("ass=captions.ass"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn empty_timelines_are_refused() {
    let mut project = project();
    project["timeline"]["clips"] = serde_json::json!([]);
    let temp = std::env::temp_dir().join("editor-ia-unit-temp");
    let result = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: Path::new("C:/obra"),
        profile: &profile(),
        output_path: Path::new("C:/obra/salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    });
    assert!(matches!(result, Err(error) if error.code == ProjectErrorCode::EmptyTimeline));
}

#[test]
fn export_range_limits_the_output_without_changing_the_graph() {
    let root = std::env::temp_dir().join(format!("editor-ia-range-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("small.mp4"), b"x").unwrap();
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "timeline": {
            "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
            "clips": [{ "id": "22222222-2222-4222-8222-222222222222", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 60 } }]
        },
        "assets": [{
            "id": "33333333-3333-4333-8333-333333333333",
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/small.mp4" },
            "media": { "durationFrames": 60 }
        }],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let output = root.join("out.mp4");
    let profile = profile();
    let input = || BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    };
    let full = build_plan(input()).expect("plan completo");
    assert!((full.duration_seconds - 2.0).abs() < 0.001);
    assert_eq!(full.args[full.args.len() - 3], "-t");
    assert_eq!(full.args[full.args.len() - 2], "2.000000");
    let ranged = build_plan_range(input(), Some((30, 60))).expect("plan con rango");
    assert!((ranged.duration_seconds - 1.0).abs() < 0.001);
    assert_eq!(ranged.args[ranged.args.len() - 5], "-ss");
    assert_eq!(ranged.args[ranged.args.len() - 4], "1.000000");
    assert_eq!(ranged.args[ranged.args.len() - 3], "-t");
    assert_eq!(ranged.args[ranged.args.len() - 2], "1.000000");
    assert!(build_plan_range(input(), Some((30, 30))).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_modified_asset_is_refused_before_ffmpeg_runs() {
    let root = std::env::temp_dir().join(format!("editor-ia-size-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("small.mp4"), b"changed").unwrap();
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "timeline": {
            "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
            "clips": [{ "id": "22222222-2222-4222-8222-222222222222", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 } }]
        },
        "assets": [{
            "id": "33333333-3333-4333-8333-333333333333",
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/small.mp4" },
            "integrity": { "bytes": 999 },
            "media": { "durationFrames": 30 }
        }],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let result = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("out.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    });
    assert!(matches!(result, Err(error) if error.code == ProjectErrorCode::AssetNotReady));
    let _ = std::fs::remove_dir_all(&root);
}

fn stabilized_clip() -> Value {
    serde_json::json!({
        "kind": "video",
        "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 },
        "stabilization": {
            "smoothing": 12,
            "transformFile": "media/stabilizers/move.trf",
            "inFrame": 0,
            "outFrame": 30
        }
    })
}

#[test]
fn stabilization_is_prepended_to_the_visual_chain() {
    let clip = serde_json::json!({ "effects": { "brightness": 0.2 } });
    let chain = visual_filter(
        3,
        &clip,
        &serde_json::json!({}),
        &profile(),
        1.0,
        0.0,
        0.0,
        1,
        1,
        false,
    );
    let chain = with_stabilization(chain, 3, Path::new("media/stabilizers/move.trf"), 12);
    assert!(
        chain.starts_with(
            "[3:v]vidstabtransform=input='media/stabilizers/move.trf':smoothing=12:crop=black,"
        ),
        "cadena inesperada: {chain}"
    );
    let transform = chain.find("vidstabtransform").expect("transform");
    let color = chain.find("eq=brightness").expect("color");
    assert!(
        transform < color,
        "la estabilización debe ver los frames crudos antes que el color"
    );
    assert!(chain.contains("setpts=PTS-STARTPTS"));
}

#[test]
fn stabilization_refuses_a_window_it_did_not_analyze() {
    let root = std::env::temp_dir().join(format!("editor-ia-stab-{}", uuid::Uuid::new_v4()));
    let stabilizers = root.join("media").join("stabilizers");
    std::fs::create_dir_all(&stabilizers).unwrap();
    std::fs::write(stabilizers.join("move.trf"), b"").unwrap();

    let mut trimmed = stabilized_clip();
    trimmed["source"]["outFrame"] = serde_json::json!(20);
    let error = resolve_stabilization(&trimmed, &root).expect_err("ventana recortada");
    assert_eq!(error.code, ProjectErrorCode::InvalidProject);
    assert!(error.message.contains("recorte"));

    let mut retimed = stabilized_clip();
    retimed["speed"] = serde_json::json!({ "num": 2, "den": 1 });
    let error = resolve_stabilization(&retimed, &root).expect_err("velocidad 2x");
    assert_eq!(error.code, ProjectErrorCode::InvalidProject);
    assert!(error.message.contains("velocidad"));

    let mut reversed = stabilized_clip();
    reversed["reverse"] = serde_json::json!(true);
    assert_eq!(
        resolve_stabilization(&reversed, &root)
            .expect_err("reverse")
            .code,
        ProjectErrorCode::InvalidProject
    );

    let mut transition = stabilized_clip();
    transition["transitionIn"] = serde_json::json!({ "type": "dissolve", "frames": 6 });
    assert_eq!(
        resolve_stabilization(&transition, &root)
            .expect_err("transición de entrada")
            .code,
        ProjectErrorCode::InvalidProject
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn stabilization_requires_its_transform_file() {
    let root = std::env::temp_dir().join(format!("editor-ia-stab-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("media")).unwrap();
    let error = resolve_stabilization(&stabilized_clip(), &root)
        .expect_err("sin archivo de transformación");
    assert_eq!(error.code, ProjectErrorCode::NotFound);
    assert!(error.message.contains("volvé a analizarla"));
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn build_plan_wires_stabilization_into_the_render_graph() {
    let root = std::env::temp_dir().join(format!("editor-ia-stab-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(media.join("stabilizers")).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("stabilizers").join("move.trf"), b"").unwrap();
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "timeline": {
            "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
            "clips": [{
                "id": "22222222-2222-4222-8222-222222222222",
                "trackId": "11111111-1111-4111-8111-111111111111",
                "kind": "video",
                "startFrame": 0,
                "durationFrames": 30,
                "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 },
                "stabilization": { "smoothing": 12, "transformFile": "media/stabilizers/move.trf", "inFrame": 0, "outFrame": 30 }
            }]
        },
        "assets": [{
            "id": "33333333-3333-4333-8333-333333333333",
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/video.mp4" },
            "media": { "durationFrames": 30 }
        }],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("out.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan con estabilización debería construirse");
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("vidstabtransform"))
        .expect("falta vidstabtransform en el grafo");
    assert!(graph.contains("media/stabilizers/move.trf"));
    assert!(graph.contains("smoothing=12"));
    assert!(graph.contains("crop=black"));
    let _ = std::fs::remove_dir_all(&root);
}

/// Real end-to-end render. It is ignored by default because it needs
/// FFmpeg/FFprobe and writes a temporary MP4. Run it explicitly with:
/// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live -- --ignored`.
/// Live freeze: generates a clip, extracts a PNG and renders the video plus
/// the 2 s still through `build_plan`. Ignored by default; run with
/// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live_freeze -- --ignored`.
#[test]
#[ignore]
fn render_live_freeze_produces_a_verified_mp4() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_freeze omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-freeze-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let video_path = media.join("video.mp4");
    let frame_path = media.join("frame.png");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner".to_string(),
            "-y".into(),
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            "testsrc=size=320x180:rate=30:duration=1".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            path_to_string(&video_path),
        ])
        .status()
        .unwrap();
    assert!(status.success(), "no se pudo generar el video base");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner".to_string(),
            "-y".into(),
            "-ss".into(),
            "0.5".into(),
            "-i".into(),
            path_to_string(&video_path),
            "-frames:v".into(),
            "1".into(),
            path_to_string(&frame_path),
        ])
        .status()
        .unwrap();
    assert!(status.success(), "no se pudo extraer el frame");
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false }],
            "clips": [
                { "id": "c1", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 30 } },
                { "id": "f1", "trackId": "v1", "kind": "freeze", "label": "Congelado", "startFrame": 30, "durationFrames": 30, "source": { "type": "asset", "assetId": "asset2" }, "effects": { "saturation": 1.1 }, "transitionIn": { "type": "dissolve", "frames": 6 } }
            ]
        },
        "assets": [
            { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" }, "media": { "durationFrames": 30 } },
            { "id": "asset2", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/frame.png" } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let output = root.join("out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan con freeze debería construirse");
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render real del freeze debería verificarse");
    eprintln!(
        "freeze render: {} bytes, {}x{}, {:.3}s",
        verification.output_bytes,
        verification.width,
        verification.height,
        verification.duration_seconds
    );
    assert!(output.is_file());
    assert!(verification.output_bytes > 1_000);
    assert_eq!(verification.width, 320);
    assert_eq!(verification.height, 180);
    assert!(
        (verification.duration_seconds - 2.0).abs() < 0.4,
        "duración inesperada: {}",
        verification.duration_seconds
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real de una curva de velocidad 0.5×→2× sobre 3 s de testsrc.
/// La ventana de 90 frames tiene media 1.25×, así que la salida debe durar
/// 72 frames (2,4 s) y el grafo debe usar el `setpts` por tramos. Correr
/// con `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live_speed_curve -- --ignored`.
#[test]
#[ignore]
fn render_live_speed_curve_produces_a_verified_mp4() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_speed_curve omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-curve-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let video_path = media.join("video.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner".to_string(),
            "-y".into(),
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            "testsrc=size=320x180:rate=30:duration=3".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            path_to_string(&video_path),
        ])
        .status()
        .unwrap();
    assert!(status.success(), "no se pudo generar el video base");
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false }],
            "clips": [{
                "id": "c1",
                "trackId": "v1",
                "kind": "video",
                "startFrame": 0,
                "durationFrames": 72,
                "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 90 },
                "speedCurve": { "points": [
                    { "t": 0.0, "speed": 0.5 },
                    { "t": 1.0, "speed": 2.0 }
                ] }
            }]
        },
        "assets": [
            { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" }, "media": { "durationFrames": 90 } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let output = root.join("out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan con curva debería construirse");
    let graph = plan.args.join(" ");
    assert!(graph.contains("setpts='"), "falta el setpts por tramos");
    assert!(
        graph.contains("if(lt((PTS-STARTPTS)"),
        "falta la expresión por tramos"
    );
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render real de la curva debería verificarse");
    eprintln!(
        "speed curve render: {} bytes, {}x{}, {:.3}s",
        verification.output_bytes,
        verification.width,
        verification.height,
        verification.duration_seconds
    );
    assert!(output.is_file());
    assert!(verification.output_bytes > 1_000);
    assert_eq!(verification.width, 320);
    assert_eq!(verification.height, 180);
    assert!(
        (verification.duration_seconds - 2.4).abs() < 0.3,
        "duración inesperada: {}",
        verification.duration_seconds
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Overlay real: un WebM VP9 con alfa generado por el pipeline de Lottie
/// sobre un video azul. La esquina transparente debe mostrar el azul del
/// fondo y el centro opaco el rojo de la animación. Ignorado por defecto;
/// se corre con `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live_alpha_webm`.
#[test]
#[ignore]
fn render_live_alpha_webm_shows_the_base_through_transparency() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_alpha_webm omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    use image::{ImageFormat, Rgba, RgbaImage};
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-alpha-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let base = media.join("base.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x0000ff:s=320x180:r=30:d=1",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(path_to_string(&base))
        .status()
        .unwrap();
    assert!(status.success(), "no se pudo generar el video base");

    let frames = root.join("frames");
    std::fs::create_dir_all(&frames).unwrap();
    let mut frame = RgbaImage::from_pixel(320, 180, Rgba([0, 0, 0, 0]));
    for y in 60..120 {
        for x in 120..200 {
            frame.put_pixel(x, y, Rgba([255, 0, 0, 255]));
        }
    }
    for index in 0..30u32 {
        frame
            .save_with_format(
                frames.join(format!("frame-{index:05}.png")),
                ImageFormat::Png,
            )
            .unwrap();
    }
    let sequence = root.join("lottie.webm");
    crate::commands::lottie::encode_sequence(&ffmpeg, &frames, &sequence, 30, 30, 1)
        .expect("la secuencia con alfa debería codificarse");
    std::fs::rename(&sequence, media.join("lottie.webm")).unwrap();

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#000000" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                { "id": "v2", "kind": "video", "order": 1, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "base", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "base", "inFrame": 0, "outFrame": 30 } },
                { "id": "alpha", "trackId": "v2", "kind": "video", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "alpha", "inFrame": 0, "outFrame": 30 } }
            ]
        },
        "assets": [
            { "id": "base", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/base.mp4" }, "media": { "durationFrames": 30, "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } } },
            { "id": "alpha", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/lottie.webm" }, "media": { "durationFrames": 30, "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "alpha": true } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let output = root.join("out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan del overlay debería construirse");
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render del overlay debería verificarse");
    assert!(output.is_file());
    assert_eq!(verification.width, 320);
    assert_eq!(verification.height, 180);
    assert!(
        (verification.duration_seconds - 1.0).abs() < 0.3,
        "duración inesperada: {}",
        verification.duration_seconds
    );

    let raw = Command::new(&ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(&output)
        .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .output()
        .unwrap();
    assert_eq!(raw.stdout.len(), 320 * 180 * 3);
    let pixel = |x: usize, y: usize| {
        let index = (y * 320 + x) * 3;
        (
            raw.stdout[index],
            raw.stdout[index + 1],
            raw.stdout[index + 2],
        )
    };
    let center = pixel(160, 90);
    assert!(
        center.0 > 170 && center.1 < 100 && center.2 < 100,
        "el centro debe ser el rojo de la animación: {center:?}"
    );
    let corner = pixel(10, 10);
    assert!(
        corner.2 > 150 && corner.0 < 100 && corner.1 < 100,
        "la esquina transparente debe mostrar el azul del fondo: {corner:?}"
    );
    eprintln!(
        "overlay alfa: {} bytes, {:.3}s, centro {center:?}, esquina {corner:?}",
        verification.output_bytes, verification.duration_seconds
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
#[ignore]
fn render_live_pipeline_produces_a_verified_mp4() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");

    let root = std::env::temp_dir().join(format!("editor-ia-render-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let video_path = media.join("video.mp4");
    let audio_path = media.join("audio.wav");
    for (args, path) in [
        (
            vec![
                "-hide_banner".to_string(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "testsrc2=size=320x180:rate=30".into(),
                "-t".into(),
                "2".into(),
                "-pix_fmt".into(),
                "yuv420p".into(),
                path_to_string(&video_path),
            ],
            &video_path,
        ),
        (
            vec![
                "-hide_banner".to_string(),
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=440:sample_rate=48000".into(),
                "-t".into(),
                "2.5".into(),
                path_to_string(&audio_path),
            ],
            &audio_path,
        ),
    ] {
        let status = Command::new(&ffmpeg).args(&args).status().unwrap();
        assert!(status.success(), "no se pudo generar {}", path.display());
    }
    std::fs::write(
            media.join("identity.cube"),
            "TITLE \"identity\"\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n",
        )
        .unwrap();

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false },
                { "id": "22222222-2222-4222-8222-222222222222", "kind": "narration", "label": "N1", "order": 1, "hidden": false, "muted": false },
                { "id": "33333333-3333-4333-8333-333333333333", "kind": "caption", "label": "C1", "order": 2, "hidden": false, "muted": false },
                { "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "kind": "adjustment", "label": "Ajustes", "order": 3, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Toma", "startFrame": 15, "durationFrames": 60, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 60 }, "motion": { "type": "zoom-in", "intensity": 0.15 }, "reverse": true, "transitionIn": { "type": "dissolve", "frames": 6 }, "transform": { "keyframes": [{ "frame": 0, "scale": 1.0, "offsetX": 0, "rotationDeg": 0, "opacity": 0.2, "easing": "ease-in" }, { "frame": 30, "scale": 1.25, "offsetX": 20, "rotationDeg": 3, "opacity": 0.6, "easing": "ease-out" }, { "frame": 59, "scale": 1.05, "offsetX": -10, "rotationDeg": 0, "opacity": 1.0 }] }, "effects": { "fadeInFrames": 6, "fadeOutFrames": 6, "lutFile": "media/identity.cube", "lift": { "r": 0.05, "g": 0, "b": 0.08 }, "gamma": { "r": 0.1, "g": 0, "b": -0.05 }, "gain": { "r": 0.08, "g": 0, "b": -0.03 }, "hsl": { "hue": 8, "saturation": 0.1, "intensity": 0.04, "colors": ["r", "y"] }, "colorMatch": { "r": 1.08, "g": 1.0, "b": 0.96, "strength": 0.7 }, "shadows": 0.1, "highlights": -0.1, "fade": 0.05 }, "chromaKey": { "color": "#00ff00", "similarity": 0.2, "blend": 0.1 }, "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.82, "height": 0.92, "rotationDeg": 25, "feather": 0.18, "invert": false, "keyframes": [{ "frame": 0, "x": -0.15 }, { "frame": 30, "x": 0 }, { "frame": 59, "x": 0.15 }] }, "animationIn": { "type": "slide-down", "durationFrames": 12 }, "animationOut": { "type": "fade", "durationFrames": 12 }, "blendMode": "screen" },
                { "id": "66666666-6666-4666-8666-666666666666", "trackId": "22222222-2222-4222-8222-222222222222", "kind": "audio", "label": "Voz", "startFrame": 0, "durationFrames": 75, "reverse": true, "source": { "type": "asset", "assetId": "77777777-7777-4777-8777-777777777777", "inFrame": 0, "outFrame": 75 }, "audio": { "gainDb": -3, "highPassHz": 80, "lowPassHz": 12000, "eqMidDb": 3, "compressor": true, "deesser": true, "gateDb": -38, "denoise": 0.1, "voiceEffect": "radio", "gainKeyframes": [{ "frame": 0, "gainDb": -3, "easing": "ease-in" }, { "frame": 30, "gainDb": -12 }, { "frame": 59, "gainDb": -3 }] } },
                { "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "trackId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "kind": "adjustment", "label": "Look del tramo", "startFrame": 0, "durationFrames": 75, "source": { "type": "adjustment" }, "effects": { "contrast": 1.08, "curvePreset": "contrast-soft", "lutFile": "media/identity.cube" } }
            ]
        },
        "assets": [
            { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" }, "media": { "durationFrames": 60 } },
            { "id": "77777777-7777-4777-8777-777777777777", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/audio.wav" }, "media": { "durationFrames": 75 } }
        ],
        "captions": {
            "styles": [{ "id": "88888888-8888-4888-8888-888888888888", "name": "Principal", "fontFamily": "Arial", "fontSizePx": 30, "color": "#ffffff", "outlineColor": "#000000", "position": "bottom", "bold": true, "borderStyle": "outline", "depth3d": 5, "depthColor": "#f43f5e" }],
            "cues": [{ "id": "99999999-9999-4999-8999-999999999999", "trackId": "33333333-3333-4333-8333-333333333333", "styleId": "88888888-8888-4888-8888-888888888888", "text": "Hola desde Editor IA", "startFrame": 6, "endFrame": 50, "words": [{ "text": "Hola", "startFrame": 6, "endFrame": 18 }, { "text": "desde", "startFrame": 18, "endFrame": 30 }, { "text": "Editor", "startFrame": 30, "endFrame": 42 }, { "text": "IA", "startFrame": 42, "endFrame": 50 }], "wordReveal": true, "animation": "pop" }, { "id": "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", "trackId": "33333333-3333-4333-8333-333333333333", "styleId": "88888888-8888-4888-8888-888888888888", "text": "Título animado", "startFrame": 52, "endFrame": 74, "motion": { "preset": "slide-left", "keyframes": [{ "frame": 0, "x": -0.8, "scale": 0.85, "rotationDeg": -8, "opacity": 0 }, { "frame": 22, "x": 0, "scale": 1, "rotationDeg": 0, "opacity": 1 }] } }]
        },
        "audio": { "master": { "gainDb": 0 }, "loudnessTarget": { "platform": "youtube", "integratedLufs": -14, "truePeakDb": -1.5, "toleranceDb": 1.5 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test 320x180".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1_000,
        duration_tolerance_frames: 10,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: true,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan debería construirse");
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair[0] == "-preset" && pair[1] == "faster"));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair[0] == "-crf" && pair[1] == "27"));
    assert!(plan
        .args
        .windows(2)
        .any(|pair| pair[0] == "-b:a" && pair[1] == "96000"));
    let mut events = 0;
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_progress| events += 1)
        .expect("el render real debería completarse y verificarse");
    eprintln!(
        "render compacto: {} bytes, {}x{}, {:.3}s",
        verification.output_bytes,
        verification.width,
        verification.height,
        verification.duration_seconds
    );
    assert!(events > 0, "ffmpeg debería reportar progreso");
    assert_eq!(verification.width, 320);
    assert_eq!(verification.height, 180);
    assert!((verification.duration_seconds - 2.5).abs() < 0.5);
    assert!(output.is_file());

    // The clip fades from 20% to 100% opacity over a dark background. Sample
    // before the exit animation (last 0.4 s) and the fade-out (last 0.2 s)
    // so the change is attributable to the keyframed opacity.
    let early = average_luma(&ffmpeg, &output, 0.6);
    let late = average_luma(&ffmpeg, &output, 2.0);
    eprintln!("opacidad animada: YAVG 0.6s={early:.2} 2.1s={late:.2}");
    assert!(
        late > early + 20.0,
        "la opacidad animada no cambió la luminancia: {early:.2} -> {late:.2}"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// Render real de un WebM VP9 con alfa: verifica que el decodificador
/// forzado conserve la transparencia y el fondo del proyecto se vea.
#[test]
#[ignore]
fn render_live_alpha_cutout_composites_transparency() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_alpha omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-alpha-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let alpha_path = media.join("alpha.webm");
    let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "nullsrc=s=320x180:d=1:r=30,format=rgba,geq=r='if(between(X,110,209)*between(Y,40,139),255,0)':g=0:b=0:a='if(between(X,110,209)*between(Y,40,139),255,0)'",
                "-c:v",
                "libvpx-vp9",
                "-pix_fmt",
                "yuva420p",
                "-b:v",
                "0",
                "-crf",
                "30",
                "-y",
            ])
            .arg(&alpha_path)
            .status()
            .expect("generar el WebM con alfa");
    assert!(status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#1010ff" },
        "timeline": {
            "tracks": [
                { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Recorte", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 30 }, "effects": { "glow": { "intensity": 0.8, "radius": 12, "threshold": 0.4 } } }
            ]
        },
        "assets": [
            { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/alpha.webm" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 }, "alpha": true } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test alfa 320x180".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1_000,
        duration_tolerance_frames: 10,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("alpha-out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan con alfa debería construirse");
    assert!(
        plan.args
            .windows(2)
            .any(|pair| pair[0] == "-c:v" && pair[1] == "libvpx-vp9"),
        "el plan debe forzar el decoder de libvpx para el WebM"
    );
    assert!(
        plan.args.iter().any(|arg| arg.contains("alphamerge")),
        "el glow debe restaurar el alfa de la rama base"
    );
    execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("render con alfa");

    let frame_path = root.join("frame.png");
    let status = Command::new(&ffmpeg)
        .args(["-hide_banner", "-v", "error", "-ss", "0.5", "-i"])
        .arg(&output)
        .args(["-frames:v", "1", "-y"])
        .arg(&frame_path)
        .status()
        .expect("extraer el frame");
    assert!(status.success());
    let frame = image::open(&frame_path).expect("leer el frame").to_rgb8();
    let corner = frame.get_pixel(8, 8).0;
    let center = frame.get_pixel(160, 90).0;
    eprintln!("alfa: corner={corner:?} center={center:?}");
    assert!(
        corner[2] > 140 && corner[0] < 90,
        "el fondo transparente debería mostrar el azul del proyecto: {corner:?}"
    );
    assert!(
        center[0] > 140 && center[2] < 100,
        "el sujeto debería verse rojo: {center:?}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real de una máscara de texto: un clip rojo sólo se ve a través
/// de las letras sobre el fondo azul del proyecto.
#[test]
#[ignore]
fn render_live_text_mask_clips_the_clip_to_the_glyphs() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_text_mask omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-textmask-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let source = media.join("red.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=320x180:d=1:r=30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
        ])
        .arg(&source)
        .status()
        .expect("generar el clip rojo");
    assert!(status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#0000ff" },
        "timeline": {
            "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }],
            "clips": [{
                "id": "22222222-2222-4222-8222-222222222222",
                "trackId": "11111111-1111-4111-8111-111111111111",
                "kind": "video",
                "label": "Texto",
                "startFrame": 0,
                "durationFrames": 30,
                "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 30 },
                "mask": { "shape": "text", "x": 0, "y": 0, "width": 1, "height": 1, "feather": 0, "invert": false, "text": "HOLA", "fontScale": 0.4 }
            }]
        },
        "assets": [{
            "id": "33333333-3333-4333-8333-333333333333",
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/red.mp4" },
            "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } }
        }],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test text mask".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 500,
        duration_tolerance_frames: 5,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("textmask-out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan con máscara de texto debería construirse");
    assert!(plan.args.iter().any(|arg| arg.contains("drawtext")));
    execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("render con máscara de texto");

    let frame_path = root.join("frame.png");
    let status = Command::new(&ffmpeg)
        .args(["-hide_banner", "-v", "error", "-ss", "0.4", "-i"])
        .arg(&output)
        .args(["-frames:v", "1", "-y"])
        .arg(&frame_path)
        .status()
        .expect("extraer el frame");
    assert!(status.success());
    let frame = image::open(&frame_path).expect("leer el frame").to_rgb8();
    let mut red = 0;
    let mut blue = 0;
    for pixel in frame.pixels() {
        let [r, g, b] = pixel.0;
        if r > 150 && g < 100 && b < 100 {
            red += 1;
        }
        if b > 150 && r < 100 && g < 100 {
            blue += 1;
        }
    }
    eprintln!("máscara de texto: {red} píxeles rojos, {blue} azules");
    assert!(red > 100, "no se ven los glifos rojos: {red}");
    assert!(blue > 500, "el fondo azul no domina: {blue}");
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real con glow y desenfoque de movimiento: valida la rama
/// split/blend y el filtro temporal dentro del plan completo.
#[test]
#[ignore]
fn render_live_glow_and_motion_blur_produces_a_verified_mp4() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_glow omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-glow-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let source = media.join("source.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
        ])
        .arg(&source)
        .status()
        .expect("generar el clip de entrada");
    assert!(status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Glow", "startFrame": 0, "durationFrames": 30, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 30 }, "effects": { "glow": { "intensity": 0.7, "radius": 12, "threshold": 0.5 }, "motionBlur": { "frames": 4, "intensity": 0.5 } } }
            ]
        },
        "assets": [
            { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/source.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test glow 320x180".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1_000,
        duration_tolerance_frames: 10,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("glow-out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan con glow debería construirse");
    assert!(
        plan.args.iter().any(|arg| {
            arg.contains("split=3[")
                && arg.contains("alphaextract")
                && arg.contains("alphamerge")
                && arg.contains("blend=all_mode=screen")
        }),
        "el plan debe incluir la rama de glow"
    );
    assert!(
        plan.args.iter().any(|arg| arg.contains("tmix=frames=4")),
        "el plan debe incluir el desenfoque de movimiento"
    );
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render con glow debería completarse");
    assert!((verification.duration_seconds - 1.0).abs() < 0.25);
    assert!(output.is_file());
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real de un rango I/O: de un clip de 2 s sale sólo el tramo 1–2 s.
#[test]
#[ignore]
fn render_live_export_range_produces_only_the_selected_frames() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_range omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-range-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let source = media.join("source.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
        ])
        .arg(&source)
        .status()
        .expect("generar el clip de entrada");
    assert!(status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }],
            "clips": [{ "id": "22222222-2222-4222-8222-222222222222", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Rango", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 60 } }]
        },
        "assets": [{
            "id": "33333333-3333-4333-8333-333333333333",
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/source.mp4" },
            "media": { "width": 320, "height": 180, "durationFrames": 60, "frameRate": { "num": 30, "den": 1 } }
        }],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test rango 320x180".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 500,
        duration_tolerance_frames: 5,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("range-out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan_range(
        BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        },
        Some((30, 60)),
    )
    .expect("el plan con rango debería construirse");
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render con rango debería verificarse");
    assert!((verification.duration_seconds - 1.0).abs() < 0.2);
    let count = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(&output)
        .output()
        .expect("contar frames");
    let frames = String::from_utf8_lossy(&count.stdout)
        .trim()
        .parse::<u64>()
        .unwrap_or(0);
    assert!((29..=31).contains(&frames), "frames del rango: {frames}");
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real con ducking: la música sigue sonando después de la voz y
/// baja mientras la voz habla. Se mide la banda de 300 Hz dentro y fuera de
/// la locución, con y sin ducking, para separar la atenuación del contenido.
#[test]
fn render_live_ducking_keeps_the_bed_and_lowers_it_under_the_voice() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_ducking omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-duck-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    for (name, frequency, seconds) in [("cama.wav", 300, 3), ("voz.wav", 1_000, 1)] {
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "error", "-f", "lavfi", "-i"])
            .arg(format!("sine=frequency={frequency}:duration={seconds}"))
            .args(["-ac", "2", "-c:a", "pcm_s16le", "-y"])
            .arg(media.join(name))
            .status()
            .expect("generar el audio de prueba");
        assert!(status.success());
    }

    let mut project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "voz", "kind": "narration", "label": "Voz", "order": 0, "hidden": false, "muted": false },
                { "id": "musica", "kind": "audio", "label": "Música", "order": 1, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "cama", "trackId": "musica", "kind": "audio", "label": "Cama", "startFrame": 0, "durationFrames": 90,
                  "source": { "type": "asset", "assetId": "cama", "inFrame": 0, "outFrame": 90 } },
                { "id": "locucion", "trackId": "voz", "kind": "audio", "label": "Locución", "startFrame": 30, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "voz", "inFrame": 0, "outFrame": 30 } }
            ]
        },
        "assets": [
            { "id": "cama", "kind": "audio", "status": "ready",
              "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/cama.wav" },
              "media": { "durationFrames": 90, "sampleRate": 48_000, "channels": 2 } },
            { "id": "voz", "kind": "audio", "status": "ready",
              "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/voz.wav" },
              "media": { "durationFrames": 30, "sampleRate": 48_000, "channels": 2 } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test ducking 320x180".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 500,
        duration_tolerance_frames: 5,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let render = |project: &Value, name: &str| {
        let output = root.join(name);
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan con audio debería construirse");
        execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("el render debería verificarse");
        output
    };
    project["audio"]["ducking"] = serde_json::json!({
        "enabled": true, "amountDb": -12,
        "sourceTrackIds": ["voz"], "targetTrackIds": ["musica"]
    });
    let ducked = render(&project, "ducked.mp4");
    project["audio"]["ducking"]["enabled"] = serde_json::json!(false);
    let plain = render(&project, "plain.mp4");

    let duration_of = |file: &std::path::Path| -> f64 {
        let output = Command::new(&ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nw=1:nk=1",
            ])
            .arg(file)
            .output()
            .expect("probar duración");
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .unwrap_or(0.0)
    };
    // Sin apad el filtro terminaba con la voz y la música se cortaba a 1 s.
    assert!(
        (duration_of(&ducked) - 3.0).abs() < 0.25,
        "la cama debe seguir hasta el final: {} s",
        duration_of(&ducked)
    );

    let music_band = |file: &std::path::Path, start: &str, seconds: &str| -> f64 {
        let output = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-nostats",
                "-ss",
                start,
                "-t",
                seconds,
                "-i",
            ])
            .arg(file)
            .args([
                "-af",
                "bandpass=f=300:width_type=h:w=50,volumedetect",
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("medir la banda de la música");
        let text = String::from_utf8_lossy(&output.stderr);
        text.lines()
            .find_map(|line| line.split("mean_volume:").nth(1))
            .and_then(|value| value.split_whitespace().next())
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| panic!("volumedetect no informó mean_volume: {text}"))
    };
    let inside = music_band(&ducked, "1.2", "0.6");
    let outside = music_band(&ducked, "2.5", "0.4");
    assert!(
        outside - inside >= 4.0,
        "la música debería bajar con la voz: dentro {inside} dB, fuera {outside} dB"
    );
    let plain_inside = music_band(&plain, "1.2", "0.6");
    let plain_outside = music_band(&plain, "2.5", "0.4");
    assert!(
        (plain_outside - plain_inside).abs() <= 1.5,
        "sin ducking la banda no debe cambiar: dentro {plain_inside} dB, fuera {plain_outside} dB"
    );
    eprintln!(
            "ducking medido: dentro {inside:.1} dB, fuera {outside:.1} dB; sin ducking {plain_inside:.1}/{plain_outside:.1} dB"
        );
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real de una cámara lenta con interpolación: el clip dura el doble
/// y el MP4 conserva la duración y los frames esperados.
#[test]
#[ignore]
fn render_live_slow_motion_interpolation_keeps_duration() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_slow omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-slow-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let source = media.join("source.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
        ])
        .arg(&source)
        .status()
        .expect("generar el clip de entrada");
    assert!(status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "44444444-4444-4444-8444-444444444444", "trackId": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "Lenta", "startFrame": 0, "durationFrames": 60, "speed": { "num": 1, "den": 2 }, "slowMotionSmoothing": true, "source": { "type": "asset", "assetId": "55555555-5555-4555-8555-555555555555", "inFrame": 0, "outFrame": 30 } }
            ]
        },
        "assets": [
            { "id": "55555555-5555-4555-8555-555555555555", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/source.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let profile = Profile {
        id: "p".into(),
        name: "Test lento 320x180".into(),
        width: 320,
        height: 180,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1_000,
        duration_tolerance_frames: 10,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("slow-out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan lento debería construirse");
    let filter = plan
        .args
        .iter()
        .find(|arg| arg.contains("minterpolate"))
        .expect("el plan debe incluir minterpolate");
    assert!(filter.contains("setpts=(PTS-STARTPTS)*2/1"));
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("render lento");
    assert!((verification.duration_seconds - 2.0).abs() < 0.25);
    let frames = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-count_frames",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(&output)
        .output()
        .expect("contar frames");
    let count = String::from_utf8_lossy(&frames.stdout)
        .trim()
        .parse::<u64>()
        .unwrap_or(0);
    eprintln!(
        "cámara lenta: {:.3}s, {count} frames",
        verification.duration_seconds
    );
    assert!((58..=62).contains(&count), "frames inesperados: {count}");
    let _ = std::fs::remove_dir_all(&root);
}

/// Live stabilization: generates a shaky clip, analyzes it with
/// `vidstabdetect`, renders through `build_plan` and verifies the MP4 with
/// FFprobe. Ignored by default; run with
/// `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test render_live_stabilization -- --ignored`.
#[test]
#[ignore]
fn render_live_stabilization_produces_a_verified_mp4() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_stabilization omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");

    let root = std::env::temp_dir().join(format!("editor-ia-stab-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    let stabilizers = media.join("stabilizers");
    std::fs::create_dir_all(&stabilizers).unwrap();
    let shaky = media.join("shaky.mp4");
    let source = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=240x136:rate=30",
            "-t",
            "1.5",
            "-vf",
            "crop=200:112:x='20+12*sin(2*PI*t*2)':y='12+8*cos(2*PI*t*2)'",
            "-pix_fmt",
            "yuv420p",
            &path_to_string(&shaky),
        ])
        .status()
        .unwrap();
    assert!(
        source.success(),
        "no se pudo generar el clip con movimiento"
    );

    let transform = stabilizers.join("shaky.trf");
    let analyze = Command::new(&ffmpeg)
        .current_dir(&stabilizers)
        .args([
            "-hide_banner",
            "-nostats",
            "-ss",
            "0.000000",
            "-t",
            "1.500000",
            "-i",
            &path_to_string(&shaky),
            "-vf",
            "vidstabdetect=shakiness=5:accuracy=15:result=shaky.trf",
            "-an",
            "-f",
            "null",
            "-",
        ])
        .output()
        .unwrap();
    assert!(
        analyze.status.success(),
        "vidstabdetect falló: {}",
        String::from_utf8_lossy(&analyze.stderr)
    );
    assert!(
        transform.is_file() && std::fs::metadata(&transform).unwrap().len() > 0,
        "vidstabdetect no escribió el .trf"
    );

    let project = serde_json::json!({
        "video": { "width": 200, "height": 112, "frameRate": { "num": 30, "den": 1 } },
        "timeline": {
            "tracks": [{ "id": "11111111-1111-4111-8111-111111111111", "kind": "video", "label": "V1", "order": 0 }],
            "clips": [{
                "id": "22222222-2222-4222-8222-222222222222",
                "trackId": "11111111-1111-4111-8111-111111111111",
                "kind": "video",
                "startFrame": 0,
                "durationFrames": 45,
                "source": { "type": "asset", "assetId": "33333333-3333-4333-8333-333333333333", "inFrame": 0, "outFrame": 45 },
                "stabilization": { "smoothing": 12, "transformFile": "media/stabilizers/shaky.trf", "inFrame": 0, "outFrame": 45 }
            }]
        },
        "assets": [{
            "id": "33333333-3333-4333-8333-333333333333",
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } },
            "source": { "path": "media/shaky.mp4" },
            "media": { "durationFrames": 45 }
        }],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let live_profile = Profile {
        id: "stab".into(),
        name: "Estabilización 200x112".into(),
        width: 200,
        height: 112,
        fps_num: 30,
        fps_den: 1,
        crf: Some(27),
        target_bps: None,
        video_preset: "faster".into(),
        fit: "contain".into(),
        audio_bps: 96_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        min_output_bytes: 1_000,
        duration_tolerance_frames: 10,
        hardware_encoder: None,
        pixel_format: "yuv420p".into(),
    };
    let output = root.join("out.mp4");
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &live_profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan estabilizado debería construirse");
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render estabilizado debería verificarse");
    eprintln!(
        "render estabilizado: {} bytes, {}x{}, {:.3}s",
        verification.output_bytes,
        verification.width,
        verification.height,
        verification.duration_seconds
    );
    assert_eq!(verification.width, 200);
    assert_eq!(verification.height, 112);
    assert!((verification.duration_seconds - 1.5).abs() < 0.4);
    assert!(output.is_file());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
#[ignore]
fn render_live_motion_graphics_produces_visible_pixels() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_motion omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    use crate::render::motion::{build_motion_ass, MotionAssInput};

    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-motion-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let base = media.join("base.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            &path_to_string(&base),
        ])
        .status()
        .expect("ffmpeg debería crear el video base");
    assert!(status.success(), "no se pudo crear el video base");

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                { "id": "g1", "kind": "graphic", "order": 1, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "vclip", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "base", "inFrame": 0, "outFrame": 60 } },
                { "id": "gclip", "trackId": "g1", "kind": "graphic", "startFrame": 0, "durationFrames": 60, "source": { "type": "graphic", "motionId": "m" } }
            ]
        },
        "assets": [
            { "id": "base", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/base.mp4" }, "media": { "durationFrames": 60 } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let plans = serde_json::json!({
        "gclip": {
            "version": 1,
            "width": 320,
            "height": 180,
            "fps": { "num": 30, "den": 1 },
            "durationFrames": 60,
            "layers": [
                { "kind": "rect", "x": 0.05, "y": 0.05, "width": 0.9, "height": 0.9, "color": "#ff0000", "opacity": 1, "animation": { "kind": "none" } },
                { "kind": "text", "x": 0.2, "y": 0.4, "width": 0.6, "height": 0.2, "text": "MOTION", "fontFamily": "Segoe UI", "fontSizePx": 40, "weight": 700, "color": "#ffffff", "align": "center", "animation": { "kind": "fade", "inFrames": 5 } }
            ]
        }
    });
    let ass = build_motion_ass(MotionAssInput {
        project: &project,
        plans: &plans,
        render_width: 320,
        render_height: 180,
        project_width: 320,
        project_height: 180,
        project_fps: 30.0,
    })
    .expect("el ASS de motion debería generarse");
    assert!(ass.contains("MOTION"));

    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let output = root.join("out.mp4");
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: Some(&ass),
    })
    .expect("el plan de motion debería construirse");
    let verification = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render real de motion debería verificarse");
    assert!(output.is_file());
    assert!(verification.output_bytes > 1_000);
    assert_eq!(verification.width, 320);
    assert_eq!(verification.height, 180);
    assert!(
        (verification.duration_seconds - 2.0).abs() < 0.4,
        "duración inesperada: {}",
        verification.duration_seconds
    );

    let frame = root.join("frame.png");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            "1",
            "-i",
            &path_to_string(&output),
            "-frames:v",
            "1",
            &path_to_string(&frame),
        ])
        .status()
        .expect("ffmpeg debería extraer un frame");
    assert!(status.success(), "no se pudo extraer el frame");
    let image = image::open(&frame)
        .expect("el frame debería abrirse")
        .to_rgba8();
    let mut red = 0usize;
    for pixel in image.pixels() {
        if pixel[0] > 200 && pixel[1] < 80 && pixel[2] < 100 {
            red += 1;
        }
    }
    eprintln!(
        "motion render: {} bytes, {:.3}s, {} píxeles rojos",
        verification.output_bytes, verification.duration_seconds, red
    );
    assert!(
        red > 1_000,
        "el overlay de motion no aparece: {red} píxeles rojos"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real de un compuesto: dos clips internos sólidos deben aparecer
/// en el MP4 en su ventana, con la posición del compuesto como base.
#[test]
fn render_live_compound_shows_its_inner_clips() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_compound omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;

    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root =
        std::env::temp_dir().join(format!("editoria-compound-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    for (name, color) in [("rojo.mp4", "red"), ("azul.mp4", "blue")] {
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c={color}:s=320x180:r=30:d=1"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                &path_to_string(&media.join(name)),
            ])
            .status()
            .expect("ffmpeg debería crear el color");
        assert!(status.success(), "no se pudo crear {name}");
    }
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#000000" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false }
            ],
            "clips": [{
                "id": "outer", "trackId": "v1", "kind": "compound", "label": "Grupo",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "compound", "compoundId": "c1" }
            }]
        },
        "compounds": [{
            "id": "c1", "label": "Grupo", "durationFrames": 60,
            "clips": [
                { "id": "rojo", "trackId": "v1", "kind": "video", "label": "Rojo",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "rojo", "inFrame": 0, "outFrame": 30 } },
                { "id": "azul", "trackId": "v1", "kind": "video", "label": "Azul",
                  "startFrame": 30, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "azul", "inFrame": 0, "outFrame": 30 } }
            ]
        }],
        "assets": [
            { "id": "rojo", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/rojo.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } } },
            { "id": "azul", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/azul.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 30, "frameRate": { "num": 30, "den": 1 } } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let output = root.join("out.mp4");
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan del compuesto debería construirse");
    let verification =
        execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("el render debería verificarse");
    assert!(
        (verification.duration_seconds - 2.0).abs() < 0.4,
        "duración inesperada: {}",
        verification.duration_seconds
    );

    let frame_at = |seconds: &str, color: &str| -> usize {
        let frame = root.join(format!("frame-{seconds}.png"));
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                seconds,
                "-i",
                &path_to_string(&output),
                "-frames:v",
                "1",
                &path_to_string(&frame),
            ])
            .status()
            .expect("ffmpeg debería extraer un frame");
        assert!(status.success(), "no se pudo extraer el frame {seconds}");
        let image = image::open(&frame)
            .expect("el frame debería abrirse")
            .to_rgba8();
        image
            .pixels()
            .filter(|pixel| match color {
                "red" => pixel[0] > 200 && pixel[1] < 80 && pixel[2] < 80,
                _ => pixel[2] > 200 && pixel[0] < 80 && pixel[1] < 80,
            })
            .count()
    };
    let red = frame_at("0.5", "red");
    let blue = frame_at("1.5", "blue");
    eprintln!(
        "compound render: {} bytes, {:.3}s, rojo {red} px, azul {blue} px",
        verification.output_bytes, verification.duration_seconds
    );
    let total = 320 * 180;
    assert!(
        red > total / 2,
        "el primer clip interno no aparece (rojo {red}/{total})"
    );
    assert!(
        blue > total / 2,
        "el segundo clip interno no aparece (azul {blue}/{total})"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Render real de un compuesto con audio interno: la pista externa a +6 dB
/// debe subir el audio del compuesto ~6 dB, y el MP4 debe traer audio.
#[test]
fn render_live_compound_audio_follows_the_host_track_gain() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_compound_audio omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;

    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root =
        std::env::temp_dir().join(format!("editoria-compound-audio-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let video_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            &path_to_string(&media.join("base.mp4")),
        ])
        .status()
        .expect("ffmpeg debería crear el video");
    assert!(video_status.success());
    let tone_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            &path_to_string(&media.join("tono.wav")),
        ])
        .status()
        .expect("ffmpeg debería crear el tono");
    assert!(tone_status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#000000" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                { "id": "a1", "kind": "audio", "order": 1, "hidden": false, "muted": false }
            ],
            "clips": [{
                "id": "outer", "trackId": "v1", "kind": "compound", "label": "Grupo",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "compound", "compoundId": "c1" }
            }]
        },
        "compounds": [{
            "id": "c1", "label": "Grupo", "durationFrames": 60,
            "clips": [
                { "id": "video", "trackId": "v1", "kind": "video", "label": "Fondo",
                  "startFrame": 0, "durationFrames": 60,
                  "source": { "type": "asset", "assetId": "base", "inFrame": 0, "outFrame": 60 } },
                { "id": "audio", "trackId": "a1", "kind": "audio", "label": "Tono",
                  "startFrame": 0, "durationFrames": 60,
                  "source": { "type": "asset", "assetId": "tono", "inFrame": 0, "outFrame": 60 } }
            ]
        }],
        "assets": [
            { "id": "base", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/base.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 60, "frameRate": { "num": 30, "den": 1 } } },
            { "id": "tono", "kind": "audio", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/tono.wav" }, "media": { "durationFrames": 60, "sampleRate": 48_000, "channels": 2 } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let render = |project: &Value, name: &str| -> PathBuf {
        let output = root.join(name);
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan del compuesto con audio debería construirse");
        execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
            .expect("el render con audio debería verificarse");
        output
    };
    let mut plain_project = project.clone();
    let plain = render(&plain_project, "plain.mp4");
    plain_project["timeline"]["tracks"][0]["gainDb"] = serde_json::json!(6.0);
    let boosted = render(&plain_project, "boosted.mp4");

    let mean_volume = |file: &Path| -> f64 {
        let output = Command::new(&ffmpeg)
            .args(["-hide_banner", "-nostats", "-i"])
            .arg(file)
            .args(["-map", "0:a", "-af", "volumedetect", "-f", "null", "-"])
            .output()
            .expect("volumedetect debería correr");
        let text = String::from_utf8_lossy(&output.stderr);
        text.lines()
            .find_map(|line| line.split("mean_volume:").nth(1))
            .and_then(|value| value.split_whitespace().next())
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| panic!("volumedetect no informó mean_volume: {text}"))
    };
    let plain_db = mean_volume(&plain);
    let boosted_db = mean_volume(&boosted);
    eprintln!(
        "compound audio: sin gain {plain_db:.1} dB, con +6 dB {boosted_db:.1} dB (Δ {:.1})",
        boosted_db - plain_db
    );
    assert!(
        plain_db > -60.0,
        "el compuesto no aportó audio: {plain_db} dB"
    );
    assert!(
        ((boosted_db - plain_db) - 6.0).abs() < 1.0,
        "la ganancia de la pista externa no llegó al audio: Δ {:.2} dB",
        boosted_db - plain_db
    );
    let _ = std::fs::remove_dir_all(&root);
}

fn probe_plan() -> RenderPlan {
    RenderPlan {
        args: Vec::new(),
        output_path: PathBuf::from("salida.mp4"),
        working_dir: PathBuf::from("."),
        duration_seconds: 5.0,
        min_output_bytes: 1_000,
        duration_tolerance_seconds: 0.4,
        width: 1920,
        height: 1080,
        fps: 30.0,
        profile_name: "prueba".into(),
    }
}

fn probe_value(container: &str, video: Option<&str>, audio: Option<&str>) -> Value {
    let mut streams = vec![serde_json::json!({
        "codec_type": "video",
        "width": 1920,
        "height": 1080,
        "duration": video,
    })];
    if let Some(audio) = audio {
        streams.push(serde_json::json!({
            "codec_type": "audio",
            "duration": audio,
        }));
    }
    serde_json::json!({
        "format": { "duration": container },
        "streams": streams,
    })
}

#[test]
fn probe_payload_accepts_a_complete_render() {
    let result = verify_probe_payload(&probe_value("5.0", Some("5.0"), Some("5.0")), &probe_plan())
        .expect("un render completo debería verificarse");
    assert!((result.0 - 5.0).abs() < f64::EPSILON);
    assert_eq!((result.1, result.2), (1920, 1080));
}

#[test]
fn probe_payload_rejects_a_short_video_track() {
    let error = verify_probe_payload(&probe_value("5.0", Some("2.0"), Some("5.0")), &probe_plan())
        .expect_err("un video cortado no debería pasar");
    assert!(
        error.message.contains("pista de video"),
        "mensaje inesperado: {}",
        error.message
    );
}

#[test]
fn probe_payload_rejects_a_short_audio_track() {
    let error = verify_probe_payload(&probe_value("5.0", Some("5.0"), Some("2.0")), &probe_plan())
        .expect_err("un audio cortado no debería pasar");
    assert!(
        error.message.contains("pista de audio"),
        "mensaje inesperado: {}",
        error.message
    );
}

#[test]
fn probe_payload_rejects_a_render_without_audio_stream() {
    let error = verify_probe_payload(&probe_value("5.0", Some("5.0"), None), &probe_plan())
        .expect_err("sin audio no debería pasar");
    assert!(
        error.message.contains("pista de audio"),
        "mensaje inesperado: {}",
        error.message
    );
}

/// Un MP4 sin pista de audio no debe pasar la verificación del render.
#[test]
fn verify_output_rejects_a_render_without_audio() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("verify_output_sin_audio omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editoria-verify-audio-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let silent = root.join("silent.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            &path_to_string(&silent),
        ])
        .status()
        .expect("ffmpeg debería crear el video sin audio");
    assert!(status.success());
    let plan = RenderPlan {
        args: Vec::new(),
        output_path: silent.clone(),
        working_dir: root.clone(),
        duration_seconds: 2.0,
        min_output_bytes: 100,
        duration_tolerance_seconds: 0.4,
        width: 320,
        height: 180,
        fps: 30.0,
        profile_name: "verificación".into(),
    };
    let error = verify_output(&ffprobe, &plan).expect_err("sin audio debe fallar");
    assert!(
        error.message.contains("pista de audio"),
        "mensaje inesperado: {}",
        error.message
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// El paneo por clip debe separar los canales en el MP4: con pan 0,5 el
/// canal derecho queda ~6 dB por encima del izquierdo.
#[test]
fn render_live_clip_pan_separates_channels() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_pan omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editoria-pan-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let video_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            &path_to_string(&media.join("base.mp4")),
        ])
        .status()
        .expect("ffmpeg debería crear el video");
    assert!(video_status.success());
    // Tono distinto por canal: 440 Hz a la izquierda, 880 Hz a la derecha.
    let audio_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=0.125*sin(2*PI*440*t)|0.125*sin(2*PI*880*t):s=48000:d=2",
            "-c:a",
            "pcm_s16le",
            &path_to_string(&media.join("estereo.wav")),
        ])
        .status()
        .expect("ffmpeg debería crear el estéreo");
    assert!(audio_status.success());
    let project = |pan: f64| {
        serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#000000" },
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                    { "id": "a1", "kind": "audio", "order": 1, "hidden": false, "muted": false }
                ],
                "clips": [
                    { "id": "v", "trackId": "v1", "kind": "video", "label": "Fondo", "startFrame": 0, "durationFrames": 60,
                      "source": { "type": "asset", "assetId": "base", "inFrame": 0, "outFrame": 60 } },
                    { "id": "a", "trackId": "a1", "kind": "audio", "label": "Estéreo", "startFrame": 0, "durationFrames": 60,
                      "source": { "type": "asset", "assetId": "estereo", "inFrame": 0, "outFrame": 60 },
                      "audio": { "pan": pan } }
                ]
            },
            "assets": [
                { "id": "base", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
                  "source": { "path": "media/base.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 60, "frameRate": { "num": 30, "den": 1 } } },
                { "id": "estereo", "kind": "audio", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
                  "source": { "path": "media/estereo.wav" }, "media": { "durationFrames": 60, "sampleRate": 48_000, "channels": 2 } }
            ],
            "captions": { "styles": [], "cues": [] },
            "audio": { "master": { "gainDb": 0 } }
        })
    };
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let render = |project: &Value, name: &str| -> PathBuf {
        let output = root.join(name);
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &temp,
            ffprobe: &ffprobe,
            motion_ass: None,
        })
        .expect("el plan con paneo debería construirse");
        execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
            .expect("el render con paneo debería verificarse");
        output
    };
    let band = |file: &Path, channel: &str, frequency: u32| -> f64 {
        let output = Command::new(&ffmpeg)
            .args(["-hide_banner", "-nostats", "-i"])
            .arg(file)
            .args([
                "-map",
                "0:a",
                "-af",
                &format!(
                    "pan=mono|c0={channel},bandpass=f={frequency}:width_type=h:w=50,volumedetect"
                ),
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("volumedetect debería correr");
        let text = String::from_utf8_lossy(&output.stderr);
        text.lines()
            .find_map(|line| line.split("mean_volume:").nth(1))
            .and_then(|value| value.split_whitespace().next())
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| panic!("volumedetect no informó mean_volume: {text}"))
    };
    let centered = render(&project(0.0), "centro.mp4");
    let center_left = band(&centered, "c0", 440);
    let center_right = band(&centered, "c1", 880);
    assert!(
        (center_right - center_left).abs() < 1.5,
        "sin paneo los canales deben quedar parejos: L {center_left} dB, R {center_right} dB"
    );
    let panned = render(&project(0.5), "paneado.mp4");
    let panned_left = band(&panned, "c0", 440);
    let panned_right = band(&panned, "c1", 880);
    eprintln!(
            "pan medido: centro L {center_left:.1}/R {center_right:.1} dB; pan 0.5 L {panned_left:.1}/R {panned_right:.1} dB"
        );
    assert!(
        (panned_right - panned_left - 6.0).abs() < 1.5,
        "pan 0,5 debe atenuar el izquierdo ~6 dB: L {panned_left} dB, R {panned_right} dB"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Keyframes de opacidad: el rojo debe bajar de forma monótona en el MP4.
#[test]
fn render_live_opacity_keyframes_fade_the_clip() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_opacity omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editoria-opacity-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            &path_to_string(&media.join("rojo.mp4")),
        ])
        .status()
        .expect("ffmpeg debería crear el rojo");
    assert!(status.success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#000000" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false }
            ],
            "clips": [{
                "id": "v", "trackId": "v1", "kind": "video", "label": "Rojo",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "asset", "assetId": "rojo", "inFrame": 0, "outFrame": 60 },
                "transform": { "keyframes": [
                    { "frame": 0, "opacity": 1.0 },
                    { "frame": 60, "opacity": 0.0 }
                ] }
            }]
        },
        "assets": [
            { "id": "rojo", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/rojo.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 60, "frameRate": { "num": 30, "den": 1 } } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let output = root.join("out.mp4");
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan con opacidad debería construirse");
    execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render con opacidad debería verificarse");
    let mean_red = |seconds: &str| -> f64 {
        let frame = root.join(format!("op-{seconds}.png"));
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                seconds,
                "-i",
                &path_to_string(&output),
                "-frames:v",
                "1",
                &path_to_string(&frame),
            ])
            .status()
            .expect("ffmpeg debería extraer un frame");
        assert!(status.success());
        let image = image::open(&frame)
            .expect("el frame debería abrirse")
            .to_rgba8();
        let total: f64 = image.pixels().map(|pixel| pixel[0] as f64).sum();
        total / image.pixels().len() as f64
    };
    let start = mean_red("0.1");
    let middle = mean_red("0.9");
    let end = mean_red("1.9");
    eprintln!("opacidad medida: rojo inicial {start:.1}, medio {middle:.1}, final {end:.1}");
    assert!(
        start > 200.0,
        "el clip debería arrancar casi opaco: {start}"
    );
    assert!(
        middle < start - 30.0,
        "la opacidad no bajó a mitad del clip: {start} → {middle}"
    );
    assert!(
        end < middle - 30.0,
        "la opacidad no siguió bajando: {middle} → {end}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Export real de 5 s a 24 fps: el MP4 debe seguir las dos leyes que la
/// preview ya aplica. Paneo por clip medido con `astats` (la ley lineal de
/// `panGains`: pan 0,5 deja el derecho 6,0206 dB arriba) y opacidad Bézier
/// en los frames 0/64/119 contra `cubicBezierProgress` (1 → 0 con
/// ease-in-out (0.42,0,0.58,1) sobre 119 frames).
#[test]
fn render_live_5s_pan_astats_and_bezier_opacity_match_preview() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_5s omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editoria-5s-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();

    let video_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=320x180:r=24:d=5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            &path_to_string(&media.join("rojo.mp4")),
        ])
        .status()
        .expect("ffmpeg debería crear el rojo");
    assert!(video_status.success());
    // Tono parejo en ambos canales: la única diferencia entre L y R es el paneo.
    let audio_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=0.125*sin(2*PI*440*t)|0.125*sin(2*PI*440*t):s=48000:d=5",
            "-c:a",
            "pcm_s16le",
            &path_to_string(&media.join("tono.wav")),
        ])
        .status()
        .expect("ffmpeg debería crear el tono");
    assert!(audio_status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 24, "den": 1 }, "backgroundColor": "#000000" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                { "id": "a1", "kind": "audio", "order": 1, "hidden": false, "muted": false }
            ],
            "clips": [
                { "id": "v", "trackId": "v1", "kind": "video", "label": "Rojo", "startFrame": 0, "durationFrames": 120,
                  "source": { "type": "asset", "assetId": "rojo", "inFrame": 0, "outFrame": 120 },
                  "transform": { "keyframes": [
                      { "frame": 0, "opacity": 1.0,
                        "bezier": { "cp1X": 0.42, "cp1Y": 0.0, "cp2X": 0.58, "cp2Y": 1.0 } },
                      { "frame": 119, "opacity": 0.0 }
                  ] } },
                { "id": "a", "trackId": "a1", "kind": "audio", "label": "Tono", "startFrame": 0, "durationFrames": 120,
                  "source": { "type": "asset", "assetId": "tono", "inFrame": 0, "outFrame": 120 },
                  "audio": { "pan": 0.5 } }
            ]
        },
        "assets": [
            { "id": "rojo", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/rojo.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 120, "frameRate": { "num": 24, "den": 1 } } },
            { "id": "tono", "kind": "audio", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/tono.wav" }, "media": { "durationFrames": 120, "sampleRate": 48_000, "channels": 2 } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });

    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let output = root.join("cinco-segundos.mp4");
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    profile.fps_num = 24;
    profile.fps_den = 1;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan de 5 s debería construirse");
    execute_sync(&ffmpeg, &ffprobe, &plan, |_| {}).expect("el render de 5 s debería verificarse");

    let rms_db = |channel: &str| -> f64 {
        let probe = Command::new(&ffmpeg)
            .args(["-hide_banner", "-nostats", "-i"])
            .arg(&output)
            .args([
                "-map",
                "0:a",
                "-af",
                &format!("pan=mono|c0={channel},astats=metadata=0:reset=0"),
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("astats debería correr");
        let text = String::from_utf8_lossy(&probe.stderr);
        text.lines()
            .filter_map(|line| line.split("RMS level dB:").nth(1))
            .next_back()
            .and_then(|value| value.split_whitespace().next())
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| panic!("astats no informó RMS: {text}"))
    };
    // Preview: `panGains(0.5)` deja left 0.5 y right 1.0.
    let preview_pan_db = 20.0 * (1.0f64 / 0.5).log10();
    let left = rms_db("c0");
    let right = rms_db("c1");
    let pan_db = right - left;
    eprintln!(
            "paneo astats 5 s: L {left:.2} dB, R {right:.2} dB, diferencia {pan_db:.2} dB (preview {preview_pan_db:.2} dB)"
        );
    assert!(
            (pan_db - preview_pan_db).abs() <= 1.0,
            "el paneo exportado debe seguir la ley lineal: medido {pan_db:.2} dB, preview {preview_pan_db:.2} dB"
        );

    let frame_mean_red = |index: u32| -> f64 {
        let frame = root.join(format!("bz-{index}.png"));
        let status = Command::new(&ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(&output)
            .args(["-vf", &format!("select=eq(n\\,{index})"), "-frames:v", "1"])
            .arg(&frame)
            .status()
            .expect("ffmpeg debería extraer el frame");
        assert!(status.success());
        let image = image::open(&frame)
            .expect("el frame debería abrirse")
            .to_rgba8();
        let total: f64 = image.pixels().map(|pixel| pixel[0] as f64).sum();
        total / image.pixels().len() as f64
    };
    // Golden de la preview: cubicBezierProgress(64/119, .42, 0, .58, 1) =
    // 0.564961, medido con node sobre packages/project-schema/src/keyframes.ts.
    let preview_eased = cubic_bezier_progress(64.0 / 119.0, 0.42, 0.0, 0.58, 1.0);
    assert!(
        (preview_eased - 0.564_961).abs() < 1e-6,
        "el port de Rust debe reproducir la curva de la preview: {preview_eased}"
    );
    let preview_middle = 255.0 * (1.0 - preview_eased);
    let start = frame_mean_red(0);
    let middle = frame_mean_red(64);
    let end = frame_mean_red(119);
    eprintln!(
            "opacidad Bézier 5 s: rojo frame 0 {start:.1} (preview 255.0), frame 64 {middle:.1} (preview {preview_middle:.2}), frame 119 {end:.1} (preview 0.0)"
        );
    assert!(
        start >= 245.0,
        "el frame 0 debería estar casi opaco: {start}"
    );
    assert!(
            (middle - preview_middle).abs() <= 12.0,
            "el frame 64 debe coincidir con la Bézier de la preview: medido {middle:.1}, esperado {preview_middle:.2}"
        );
    assert!(end <= 12.0, "el frame 119 debería quedar en negro: {end}");
    let _ = std::fs::remove_dir_all(&root);
}

/// Paneo animado de pista en el MP4: mesetas −0,8 y +0,36 unidas por un
/// tramo Bézier. El export parte el estéreo y aplica `volume` por frame; la
/// preview muestrea `panKeyframes` con `sampleTrackPan` y aplica `panGains`.
/// Las ventanas caen dentro de cada meseta, así el priming de AAC no sesga
/// la medición; los goldens salen de la ley lineal de la preview.
#[test]
fn render_live_5s_animated_track_pan_astats_matches_preview() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_5s_animated_track_pan omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root =
        std::env::temp_dir().join(format!("editoria-5s-animated-pan-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();

    let video_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=320x180:r=24:d=5",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            &path_to_string(&media.join("rojo.mp4")),
        ])
        .status()
        .expect("ffmpeg debería crear el rojo");
    assert!(video_status.success());
    // Tono parejo en ambos canales: la única diferencia entre L y R es el paneo.
    let audio_status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc=0.125*sin(2*PI*440*t)|0.125*sin(2*PI*440*t):s=48000:d=5",
            "-c:a",
            "pcm_s16le",
            &path_to_string(&media.join("tono.wav")),
        ])
        .status()
        .expect("ffmpeg debería crear el tono");
    assert!(audio_status.success());

    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 24, "den": 1 }, "backgroundColor": "#000000" },
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false },
                {
                    "id": "a1", "kind": "audio", "order": 1, "hidden": false, "muted": false,
                    "panKeyframes": [
                        { "frame": 0, "value": -0.8, "easing": "hold" },
                        {
                            "frame": 36, "value": -0.8, "easing": "linear",
                            "bezier": { "cp1X": 0.42, "cp1Y": 0.0, "cp2X": 0.58, "cp2Y": 1.0 }
                        },
                        { "frame": 95, "value": 0.36, "easing": "hold" },
                        { "frame": 119, "value": 0.36, "easing": "linear" }
                    ]
                }
            ],
            "clips": [
                { "id": "v", "trackId": "v1", "kind": "video", "label": "Rojo", "startFrame": 0, "durationFrames": 120,
                  "source": { "type": "asset", "assetId": "rojo", "inFrame": 0, "outFrame": 120 } },
                { "id": "a", "trackId": "a1", "kind": "audio", "label": "Tono", "startFrame": 0, "durationFrames": 120,
                  "source": { "type": "asset", "assetId": "tono", "inFrame": 0, "outFrame": 120 } }
            ]
        },
        "assets": [
            { "id": "rojo", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/rojo.mp4" }, "media": { "width": 320, "height": 180, "durationFrames": 120, "frameRate": { "num": 24, "den": 1 } } },
            { "id": "tono", "kind": "audio", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } },
              "source": { "path": "media/tono.wav" }, "media": { "durationFrames": 120, "sampleRate": 48_000, "channels": 2 } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });

    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let output = root.join("paneo-animado.mp4");
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    profile.fps_num = 24;
    profile.fps_den = 1;
    // El canal atenuado queda a −14 dB: con 128 kbps la cuantización AAC
    // sesga su RMS. El test mide la ley de paneo, no el códec.
    profile.audio_bps = 320_000;
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan de paneo animado debería construirse");
    // El grafo con la Bézier duplicada supera el límite de línea de
    // comandos de Windows: debe viajar en archivo, no en `args`.
    assert!(
        plan.args.iter().any(|arg| arg == "-/filter_complex"),
        "el grafo largo debe leerse del archivo: {:?}",
        plan.args.iter().find(|arg| arg.contains("filter_complex"))
    );
    assert!(
        plan.args.iter().map(|arg| arg.len()).sum::<usize>() < 8_000,
        "la línea de comandos no debe acercarse al límite de Windows"
    );
    execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render de paneo animado debería verificarse");

    let window_db = |start: f64, end: f64, channel: &str| -> f64 {
        let probe = Command::new(&ffmpeg)
                .args(["-hide_banner", "-nostats", "-i"])
                .arg(&output)
                .args([
                    "-map",
                    "0:a",
                    "-af",
                    &format!(
                        "atrim=start={start:.3}:end={end:.3},asetpts=PTS-STARTPTS,pan=mono|c0={channel},astats=metadata=0:reset=0"
                    ),
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .expect("astats debería correr");
        let text = String::from_utf8_lossy(&probe.stderr);
        text.lines()
            .filter_map(|line| line.split("RMS level dB:").nth(1))
            .next_back()
            .and_then(|value| value.split_whitespace().next())
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| panic!("astats no informó RMS: {text}"))
    };

    // Goldens de la preview: meseta −0,8 (R−L −13,979 dB) y meseta +0,36
    // (R−L +3,876 dB). El tramo central interpola con la Bézier
    // (.42,0,.58,1), así que el grafo largo se ejerce igual.
    let first_left = window_db(0.3, 0.7, "c0");
    let first_right = window_db(0.3, 0.7, "c1");
    let last_left = window_db(4.2, 4.6, "c0");
    let last_right = window_db(4.2, 4.6, "c1");
    let first_diff = first_right - first_left;
    let last_diff = last_right - last_left;
    eprintln!(
            "paneo animado 5 s: ventana 0,3–0,7 s R−L {first_diff:.2} dB (preview −13,98 dB); ventana 4,2–4,6 s R−L {last_diff:.2} dB (preview +3,88 dB)"
        );
    // La curva de la preview en el frame 84 (Bézier .42,0,.58,1) es
    // 0,929319: mismo golden que usa el port de Rust.
    let preview_eased = cubic_bezier_progress((84.0 - 36.0) / 59.0, 0.42, 0.0, 0.58, 1.0);
    assert!(
        (preview_eased - 0.929_319).abs() < 1e-5,
        "la Bézier del paneo debe ser la de la preview: {preview_eased}"
    );
    assert!(
            (first_diff + 13.979).abs() <= 1.0,
            "la meseta izquierda debe seguir la ley de la preview: medido {first_diff:.2} dB, esperado −13,98 dB"
        );
    assert!(
            (last_diff - 3.876).abs() <= 1.0,
            "la meseta derecha debe seguir la ley de la preview: medido {last_diff:.2} dB, esperado +3,88 dB"
        );
    // Control de movimiento: un paneo estático daría la misma diferencia en
    // ambas ventanas; el barrido debe alejarse ≥10 dB de punta a punta.
    assert!(
        first_diff < -8.0 && last_diff > 1.0 && last_diff - first_diff >= 10.0,
        "el paneo debe moverse de izquierda a derecha: {first_diff:.2} → {last_diff:.2} dB"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// El grafo de un proyecto con automatización Bézier supera el límite de
/// línea de comandos de Windows: debe viajar en un archivo, y los grafos
/// cortos deben seguir inline. Sin FFmpeg: sólo se construye el plan.
#[test]
fn long_filter_graphs_use_a_file_and_short_ones_stay_inline() {
    let root = std::env::temp_dir().join(format!("editor-ia-graph-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let mut animated = project();
    animated["timeline"]["tracks"][1]["panKeyframes"] = serde_json::json!([
        {
            "frame": 0, "value": -0.8, "easing": "linear",
            "bezier": { "cp1X": 0.42, "cp1Y": 0.0, "cp2X": 0.58, "cp2Y": 1.0 }
        },
        {
            "frame": 10, "value": 0.2, "easing": "linear",
            "bezier": { "cp1X": 0.42, "cp1Y": 0.0, "cp2X": 0.58, "cp2Y": 1.0 }
        },
        {
            "frame": 20, "value": -0.2, "easing": "linear",
            "bezier": { "cp1X": 0.2, "cp1Y": 0.0, "cp2X": 0.8, "cp2Y": 1.0 }
        },
        { "frame": 30, "value": 0.4, "easing": "linear" }
    ]);
    let plan_for = |project: &Value| {
        build_plan(BuildPlanInput {
            audio_only: false,
            project,
            root: &root,
            profile: &profile(),
            output_path: &root.join("salida.mp4"),
            include_captions: false,
            temp_dir: &temp,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("el plan debería construirse")
    };
    let long = plan_for(&animated);
    let index = long
        .args
        .iter()
        .position(|arg| arg == "-/filter_complex")
        .expect("el grafo largo debe ir a archivo");
    assert!(
        !long.args.iter().any(|arg| arg == "-filter_complex"),
        "el grafo largo no debe ir inline"
    );
    let graph_path = PathBuf::from(&long.args[index + 1]);
    assert!(graph_path.ends_with("filter-graph.txt"), "{graph_path:?}");
    let graph = std::fs::read_to_string(&graph_path).expect("el grafo debe existir");
    assert!(
        graph.len() > 8_000,
        "el fixture debe superar el umbral: {}",
        graph.len()
    );
    assert!(graph.contains("channelsplit=channel_layout=stereo"));
    assert!(graph.contains("join=inputs=2:channel_layout=stereo"));
    assert!(
        long.args.iter().map(|arg| arg.len()).sum::<usize>() < 8_000,
        "la línea de comandos debe quedar lejos del límite de Windows"
    );

    let short = plan_for(&project());
    assert!(short.args.iter().any(|arg| arg == "-filter_complex"));
    assert!(!short.args.iter().any(|arg| arg == "-/filter_complex"));
    let _ = std::fs::remove_dir_all(&root);
}

fn average_luma(ffmpeg: &Path, path: &Path, seconds: f64) -> f64 {
    let probe = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{seconds:.3}"),
            "-i",
            &path_to_string(path),
            "-frames:v",
            "1",
            "-vf",
            "signalstats,metadata=print:file=-",
            "-f",
            "null",
            "-",
        ])
        .output()
        .expect("ffmpeg debería medir la luminancia");
    let stdout = String::from_utf8_lossy(&probe.stdout);
    stdout
        .lines()
        .find_map(|line| line.strip_prefix("lavfi.signalstats.YAVG="))
        .and_then(|value| value.trim().parse::<f64>().ok())
        .expect("ffmpeg debería reportar lavfi.signalstats.YAVG")
}

fn region_luma(ffmpeg: &Path, path: &Path, seconds: f64, x: u32, y: u32, w: u32, h: u32) -> f64 {
    let probe = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{seconds:.3}"),
            "-i",
            &path_to_string(path),
            "-frames:v",
            "1",
            "-vf",
            &format!("crop={w}:{h}:{x}:{y},signalstats,metadata=print:file=-"),
            "-f",
            "null",
            "-",
        ])
        .output()
        .expect("ffmpeg debería medir la luminancia regional");
    let stdout = String::from_utf8_lossy(&probe.stdout);
    stdout
        .lines()
        .find_map(|line| line.strip_prefix("lavfi.signalstats.YAVG="))
        .and_then(|value| value.trim().parse::<f64>().ok())
        .expect("ffmpeg debería reportar lavfi.signalstats.YAVG")
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// ------------------------------------------------------------------
// Bézier exacta en el export: la expresión FFmpeg debe evaluar y(x=t)
// como la preview (port de cubicBezierProgress), no x(u) paramétrica.
// ------------------------------------------------------------------

/// Evaluador numérico mínimo (solo tests) para las expresiones que genera
/// `keyframe_expression`: números, la variable `t`, `+ - * /`,
/// paréntesis, `if(lt(a,b),x,y)` y `pow(a,b)`.
fn eval_ffmpeg_expression(expr: &str, t: f64) -> f64 {
    let chars: Vec<char> = expr.chars().collect();
    let mut pos = 0usize;
    let value = parse_additive(&chars, &mut pos, t);
    assert_eq!(pos, chars.len(), "no se consumió toda la expresión: {expr}");
    value
}

fn skip_spaces(chars: &[char], pos: &mut usize) {
    while *pos < chars.len() && chars[*pos].is_whitespace() {
        *pos += 1;
    }
}

fn parse_additive(chars: &[char], pos: &mut usize, t: f64) -> f64 {
    let mut value = parse_multiplicative(chars, pos, t);
    loop {
        skip_spaces(chars, pos);
        match chars.get(*pos) {
            Some('+') => {
                *pos += 1;
                value += parse_multiplicative(chars, pos, t);
            }
            Some('-') => {
                *pos += 1;
                value -= parse_multiplicative(chars, pos, t);
            }
            _ => return value,
        }
    }
}

fn parse_multiplicative(chars: &[char], pos: &mut usize, t: f64) -> f64 {
    let mut value = parse_unary(chars, pos, t);
    loop {
        skip_spaces(chars, pos);
        match chars.get(*pos) {
            Some('*') => {
                *pos += 1;
                value *= parse_unary(chars, pos, t);
            }
            Some('/') => {
                *pos += 1;
                value /= parse_unary(chars, pos, t);
            }
            _ => return value,
        }
    }
}

fn parse_unary(chars: &[char], pos: &mut usize, t: f64) -> f64 {
    skip_spaces(chars, pos);
    if chars.get(*pos) == Some(&'-') {
        *pos += 1;
        return -parse_unary(chars, pos, t);
    }
    parse_primary(chars, pos, t)
}

fn parse_primary(chars: &[char], pos: &mut usize, t: f64) -> f64 {
    skip_spaces(chars, pos);
    match chars.get(*pos) {
        Some('(') => {
            *pos += 1;
            let value = parse_additive(chars, pos, t);
            expect(chars, pos, ')');
            value
        }
        Some(c) if c.is_ascii_digit() => parse_number(chars, pos),
        Some(c) if c.is_ascii_alphabetic() => {
            let start = *pos;
            while chars.get(*pos).is_some_and(|c| c.is_ascii_alphabetic()) {
                *pos += 1;
            }
            let name: String = chars[start..*pos].iter().collect();
            match name.as_str() {
                "t" => t,
                "if" => {
                    expect(chars, pos, '(');
                    let cond = parse_additive(chars, pos, t);
                    expect(chars, pos, ',');
                    let then_value = parse_additive(chars, pos, t);
                    expect(chars, pos, ',');
                    let else_value = parse_additive(chars, pos, t);
                    expect(chars, pos, ')');
                    if cond != 0.0 {
                        then_value
                    } else {
                        else_value
                    }
                }
                "lt" => {
                    expect(chars, pos, '(');
                    let a = parse_additive(chars, pos, t);
                    expect(chars, pos, ',');
                    let b = parse_additive(chars, pos, t);
                    expect(chars, pos, ')');
                    if a < b {
                        1.0
                    } else {
                        0.0
                    }
                }
                "pow" => {
                    expect(chars, pos, '(');
                    let base = parse_additive(chars, pos, t);
                    expect(chars, pos, ',');
                    let exponent = parse_additive(chars, pos, t);
                    expect(chars, pos, ')');
                    base.powf(exponent)
                }
                other => panic!("identificador inesperado en la expresión: {other}"),
            }
        }
        other => panic!("carácter inesperado {other:?} en la expresión"),
    }
}

fn parse_number(chars: &[char], pos: &mut usize) -> f64 {
    let start = *pos;
    while chars
        .get(*pos)
        .is_some_and(|c| c.is_ascii_digit() || *c == '.')
    {
        *pos += 1;
    }
    let text: String = chars[start..*pos].iter().collect();
    text.parse::<f64>()
        .unwrap_or_else(|_| panic!("número inválido: {text}"))
}

fn expect(chars: &[char], pos: &mut usize, expected: char) {
    skip_spaces(chars, pos);
    assert_eq!(
        chars.get(*pos),
        Some(&expected),
        "se esperaba '{expected}' en la posición {pos}"
    );
    *pos += 1;
}

/// Proyecto mínimo de dos keyframes 0→1 en 30 frames (1 segundo a 30 fps):
/// el easing/Bézier del primer keyframe define el segmento completo.
fn keyframes_easing(primer_keyframe: Value) -> Vec<Value> {
    serde_json::json!([primer_keyframe, { "frame": 30, "scale": 1.0 }])
        .as_array()
        .expect("keyframes")
        .clone()
}

/// (a) La Bézier (0,0,1,1) es la identidad: su expresión FFmpeg debe
/// evaluar igual que el preset linear en todas las muestras.
#[test]
fn bezier_identidad_evalua_igual_que_linear() {
    let lineal = keyframe_expression(
        &keyframes_easing(serde_json::json!({
            "frame": 0, "scale": 0.0, "easing": "linear"
        })),
        "scale",
        30.0,
        "t",
    )
    .expect("expresión linear");
    let bezier = keyframe_expression(
        &keyframes_easing(serde_json::json!({
            "frame": 0, "scale": 0.0,
            "bezier": { "cp1X": 0.0, "cp1Y": 0.0, "cp2X": 1.0, "cp2Y": 1.0 }
        })),
        "scale",
        30.0,
        "t",
    )
    .expect("expresión bezier");
    assert!(
        bezier.contains("if(lt("),
        "la Bézier emite piecewise: {bezier}"
    );
    for i in 0..=20 {
        let t = i as f64 / 20.0;
        let esperado = eval_ffmpeg_expression(&lineal, t);
        let obtenido = eval_ffmpeg_expression(&bezier, t);
        assert!(
            (obtenido - esperado).abs() < 1e-4,
            "y({t}) bezier={obtenido} vs linear={esperado}"
        );
    }
}

/// (b) La Bézier (0.42,0,0.58,1) es la curva canónica de ease-in-out: la
/// expresión piecewise-lineal la reproduce dentro de ±0.01 en 9 puntos
/// (el error de cuerda con 16 sub-muestras mide 0.0021 como máximo).
/// Frente al preset `ease-in-out` (smoothstep) la desviación real de esa
/// Bézier llega a 0.0271 (medida en t=0.25), así que solo se exige que
/// quede cerca (±0.03): los presets se mantienen intactos.
#[test]
fn bezier_ease_in_out_coincide_con_la_curva_canonica() {
    let bezier = keyframe_expression(
        &keyframes_easing(serde_json::json!({
            "frame": 0, "scale": 0.0,
            "bezier": { "cp1X": 0.42, "cp1Y": 0.0, "cp2X": 0.58, "cp2Y": 1.0 }
        })),
        "scale",
        30.0,
        "t",
    )
    .expect("expresión bezier");
    for i in 0..9 {
        let t = i as f64 / 8.0;
        let esperado = cubic_bezier_progress(t, 0.42, 0.0, 0.58, 1.0);
        let obtenido = eval_ffmpeg_expression(&bezier, t);
        assert!(
            (obtenido - esperado).abs() <= 0.01,
            "y({t}) = {obtenido} vs curva canónica {esperado}"
        );
    }
    let preset = keyframe_expression(
        &keyframes_easing(serde_json::json!({
            "frame": 0, "scale": 0.0, "easing": "ease-in-out"
        })),
        "scale",
        30.0,
        "t",
    )
    .expect("expresión ease-in-out");
    for i in 0..9 {
        let t = i as f64 / 8.0;
        let bezier_y = eval_ffmpeg_expression(&bezier, t);
        let preset_y = eval_ffmpeg_expression(&preset, t);
        assert!(
            (bezier_y - preset_y).abs() <= 0.03,
            "y({t}) bezier={bezier_y} vs ease-in-out={preset_y}"
        );
    }
}

/// (c) La Bézier (0.9,0,1,1) arranca lenta: en t=0.5 debe quedar por
/// debajo de la recta linear.
#[test]
fn bezier_acelerada_queda_debajo_de_linear_en_el_centro() {
    let lineal = keyframe_expression(
        &keyframes_easing(serde_json::json!({
            "frame": 0, "scale": 0.0, "easing": "linear"
        })),
        "scale",
        30.0,
        "t",
    )
    .expect("expresión linear");
    let bezier = keyframe_expression(
        &keyframes_easing(serde_json::json!({
            "frame": 0, "scale": 0.0,
            "bezier": { "cp1X": 0.9, "cp1Y": 0.0, "cp2X": 1.0, "cp2Y": 1.0 }
        })),
        "scale",
        30.0,
        "t",
    )
    .expect("expresión bezier");
    let lineal_y = eval_ffmpeg_expression(&lineal, 0.5);
    let bezier_y = eval_ffmpeg_expression(&bezier, 0.5);
    assert!(
        bezier_y < lineal_y,
        "y(0.5) bezier={bezier_y} debería quedar por debajo de linear={lineal_y}"
    );
}

// ---------- Automatización de fader/paneo por keyframes de pista ----------

/// Expresión dB dentro del `volume=volume='pow(10,(EXPR)/20)':eval=frame`
/// que emite el fader animado de pista.
fn expresion_db_de_pista(chain: &str) -> &str {
    let marca = "volume=volume='pow(10,(";
    let start = chain
        .find(marca)
        .expect("el fader animado debe envolver la expresión en pow(10,..)");
    let from = start + marca.len();
    let end = chain[from..]
        .find(")/20)")
        .expect("cierre del pow del fader animado");
    &chain[from..from + end]
}

/// Expresión de ganancia de un canal del paneo animado (`tplN`/`tprN`).
fn expresion_canal(chain: &str, etiqueta: &str) -> String {
    let marca = format!("[{etiqueta}]volume=volume='");
    let start = chain
        .find(&marca)
        .expect("el canal del paneo animado debe existir");
    let from = start + marca.len();
    let cierre: char = '\'';
    let end = chain[from..]
        .find(cierre)
        .expect("cierre de la expresión del canal");
    chain[from..from + end].to_owned()
}

#[test]
fn los_keyframes_de_fader_de_pista_reemplazan_al_fader_estatico() {
    let track = serde_json::json!({
        "gainDb": 3.0,
        "gainKeyframes": [
            { "frame": 0, "gainDb": -6.0 },
            { "frame": 60, "gainDb": 6.0 }
        ]
    });
    // Clip de 2 s que arranca en el frame 30 (1 s): el grafo ve `t` local.
    let chain = audio_filter(
        0,
        &profile(),
        30.0,
        2.0,
        0.0,
        1.0,
        &serde_json::json!({}),
        false,
        1,
        1,
        3.0,
        &track,
        &serde_json::json!({}),
    );
    assert!(
        chain.contains("volume=volume='pow(10,(") && chain.contains(")/20)':eval=frame"),
        "el fader animado debe evaluarse por frame en dB→lineal: {chain}"
    );
    assert!(
        !chain.contains("volume=3.00dB"),
        "el fader estático no debe convivir con sus keyframes: {chain}"
    );
    // En t=1.0 (frame 60 absoluto) se alcanza la última clave: +6 dB.
    let fin = eval_ffmpeg_expression(expresion_db_de_pista(&chain), 1.0);
    assert!((fin - 6.0).abs() < 1e-3, "t=1 dio {fin}");
    // En t=0 el tiempo absoluto es 1 s (mitad del segmento -6→6): 0 dB.
    let inicio = eval_ffmpeg_expression(expresion_db_de_pista(&chain), 0.0);
    assert!((inicio - 0.0).abs() < 1e-3, "t=0 dio {inicio}");
    // En t=0.5 (frame 45 absoluto, 3/4 del segmento -6→6): +3 dB.
    let medio = eval_ffmpeg_expression(expresion_db_de_pista(&chain), 0.5);
    assert!((medio - 3.0).abs() < 1e-3, "t=0.5 dio {medio}");
    // Después de la última clave el valor queda clampeado.
    let despues = eval_ffmpeg_expression(expresion_db_de_pista(&chain), 1.5);
    assert!((despues - 6.0).abs() < 1e-3, "t=1.5 dio {despues}");
}

#[test]
fn el_fader_estatico_de_pista_se_mantiene_sin_keyframes() {
    let chain = audio_filter(
        0,
        &profile(),
        30.0,
        2.0,
        0.0,
        1.0,
        &serde_json::json!({}),
        false,
        1,
        1,
        3.0,
        &serde_json::json!({ "gainDb": 3.0 }),
        &serde_json::json!({}),
    );
    assert!(
        chain.contains("volume=3.00dB"),
        "sin keyframes el fader estático se aplica: {chain}"
    );
    assert!(
        !chain.contains("eval=frame"),
        "sin keyframes no hay volumen por frame: {chain}"
    );
    assert!(chain.ends_with("[a0]"));
}

#[test]
fn los_keyframes_de_paneo_de_pista_parten_la_cadena_por_canal() {
    let track = serde_json::json!({
        "pan": 0.5,
        "panKeyframes": [
            { "frame": 0, "value": -1.0 },
            { "frame": 30, "value": 1.0 }
        ]
    });
    let chain = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &serde_json::json!({ "fadeInFrames": 15 }),
        false,
        1,
        1,
        0.0,
        &track,
        &serde_json::json!({}),
    );
    assert!(
        !chain.contains("pan=stereo|c0="),
        "el paneo estático no debe convivir con sus keyframes: {chain}"
    );
    assert!(
        chain.contains("channelsplit=channel_layout=stereo"),
        "{chain}"
    );
    assert!(
        chain.contains("join=inputs=2:channel_layout=stereo"),
        "{chain}"
    );
    // El fade del clip se aplica al estéreo recompuesto y la cadena cierra
    // con la etiqueta que el mezclador espera.
    assert!(
        chain.contains("join=inputs=2:channel_layout=stereo,afade=t=in:st=0:d=0.5"),
        "el resto de la cadena debe seguir al join: {chain}"
    );
    assert!(chain.ends_with("[a0]"), "{chain}");

    // Balance lineal evaluado por frame: a 1/4 del barrido -1→1 el pan es
    // -0.5 (izquierdo 1.0, derecho 0.5); a 3/4, 0.5 (al revés).
    let left = expresion_canal(&chain, "tpl0");
    let right = expresion_canal(&chain, "tpr0");
    let left_cuarto = eval_ffmpeg_expression(&left, 0.25);
    let right_cuarto = eval_ffmpeg_expression(&right, 0.25);
    assert!(
        (left_cuarto - 1.0).abs() < 1e-6,
        "izq(0.25) = {left_cuarto}"
    );
    assert!(
        (right_cuarto - 0.5).abs() < 1e-3,
        "der(0.25) = {right_cuarto}"
    );
    let left_tres = eval_ffmpeg_expression(&left, 0.75);
    let right_tres = eval_ffmpeg_expression(&right, 0.75);
    assert!((left_tres - 0.5).abs() < 1e-3, "izq(0.75) = {left_tres}");
    assert!((right_tres - 1.0).abs() < 1e-6, "der(0.75) = {right_tres}");
    // En el extremo izquierdo el canal derecho queda mudo, como el paneo
    // estático.
    assert!((eval_ffmpeg_expression(&left, 0.0) - 1.0).abs() < 1e-6);
    assert!((eval_ffmpeg_expression(&right, 0.0) - 0.0).abs() < 1e-6);
}

#[test]
fn los_keyframes_de_paneo_se_anclan_al_frame_absoluto_del_clip() {
    let track = serde_json::json!({
        "panKeyframes": [
            { "frame": 30, "value": -1.0 },
            { "frame": 60, "value": 1.0 }
        ]
    });
    // Clip que arranca en el frame 30 (1 s) y dura 2 s: los keyframes
    // caen en t local 0 y 1.
    let chain = audio_filter(
        0,
        &profile(),
        30.0,
        2.0,
        0.0,
        1.0,
        &serde_json::json!({}),
        false,
        1,
        1,
        0.0,
        &track,
        &serde_json::json!({}),
    );
    let left = expresion_canal(&chain, "tpl0");
    let right = expresion_canal(&chain, "tpr0");
    // t local 0 = frame 30 absoluto: pan -1 (izquierdo 1.0, derecho mudo).
    assert!((eval_ffmpeg_expression(&left, 0.0) - 1.0).abs() < 1e-6);
    assert!((eval_ffmpeg_expression(&right, 0.0) - 0.0).abs() < 1e-6);
    // t local 0.5 = frame 45 absoluto: pan 0 (centro, ambos a 1.0).
    assert!((eval_ffmpeg_expression(&left, 0.5) - 1.0).abs() < 1e-6);
    assert!((eval_ffmpeg_expression(&right, 0.5) - 1.0).abs() < 1e-6);
    // t local 1.5 = frame 75 absoluto: después de la última clave, pan 1.
    assert!((eval_ffmpeg_expression(&left, 1.5) - 0.0).abs() < 1e-6);
    assert!((eval_ffmpeg_expression(&right, 1.5) - 1.0).abs() < 1e-6);
}

#[test]
fn los_keyframes_de_paneo_pre_muestrean_la_curva_bezier() {
    let track = serde_json::json!({
        "panKeyframes": [
            {
                "frame": 0,
                "value": -1.0,
                "bezier": { "cp1X": 0.42, "cp1Y": 0.0, "cp2X": 1.0, "cp2Y": 1.0 }
            },
            { "frame": 30, "value": 1.0 }
        ]
    });
    let chain = audio_filter(
        0,
        &profile(),
        30.0,
        1.0,
        0.0,
        0.0,
        &serde_json::json!({}),
        false,
        1,
        1,
        0.0,
        &track,
        &serde_json::json!({}),
    );
    let right = expresion_canal(&chain, "tpr0");
    // La Bézier se emite como 16 tramos lineales anidados (el mismo enfoque
    // Newton del resto del render), no como la paramétrica x(u).
    let tramos = right.matches("if(lt(").count();
    assert!(
        tramos >= 16,
        "la curva debe venir pre-muestreada en tramos, hay {tramos}: {right}"
    );
    // ease-in (0.42,0,1,1): a mitad del barrido el progreso va por debajo
    // del lineal, así que el pan no llegó a 0 y el derecho sigue atenuado.
    let mitad = eval_ffmpeg_expression(&right, 0.5);
    assert!(
        mitad < 1.0 && mitad > 0.0,
        "der(0.5) debe estar entre 0 y 1 para una ease-in, dio {mitad}"
    );
}
#[test]
fn voice_isolation_routes_the_generated_stem_instead_of_the_source() {
    let root = std::env::temp_dir().join(format!("editor-ia-voice-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    // Solo existe el stem del asset de video: el clip de audio con
    // voiceIsolation enabled debe caer al source original.
    let stem_dir = media.join("isolation").join("asset1");
    std::fs::create_dir_all(&stem_dir).unwrap();
    std::fs::write(stem_dir.join("vocals.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();

    let mut project = project();
    for clip_id in ["c1", "c2"] {
        let clip = project["timeline"]["clips"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|clip| clip["id"].as_str() == Some(clip_id))
            .unwrap();
        clip["audio"] = serde_json::json!({
            "voiceIsolation": { "enabled": true, "model": "demucs-v4", "quality": "medium" }
        });
    }
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan deberia construirse");

    // Los -i del plan: el stem del asset1 entra como input extra del clip
    // de video; el clip de audio (asset2, sin stem) sigue con audio.wav.
    let inputs: Vec<&str> = plan
        .args
        .iter()
        .zip(plan.args.iter().skip(1))
        .filter(|(flag, _)| *flag == "-i")
        .map(|(_, value)| value.as_str())
        .collect();
    assert!(
        inputs.iter().any(|value| value.contains("vocals.wav")),
        "falta el stem en los inputs: {:?}",
        inputs
    );
    assert!(
        inputs.iter().any(|value| value.ends_with("audio.wav")),
        "el clip sin stem debe usar el source original: {:?}",
        inputs
    );
    // El clip de video (index 1) toma su audio del stem (index 2); el clip
    // de audio (index 3) del source. Sin stem, el probe de ffprobe falla y
    // no habria cadena de audio para el video.
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("[aout]"))
        .expect("falta el grafo de audio");
    assert!(
        graph.contains("[2:a]"),
        "el audio del video debe venir del stem: {}",
        graph
    );
    assert!(
        graph.contains("[3:a]"),
        "el clip de audio debe seguir sonando: {}",
        graph
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn voice_isolation_without_stem_falls_back_to_source_audio() {
    let root = std::env::temp_dir().join(format!("editor-ia-voice2-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();

    let mut project = project();
    let clip = project["timeline"]["clips"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|clip| clip["id"].as_str() == Some("c2"))
        .unwrap();
    clip["audio"] = serde_json::json!({
        "voiceIsolation": { "enabled": true, "model": "demucs-v4", "quality": "medium" }
    });
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan deberia construirse");

    // Sin stem generado el clip de audio usa el source original: no debe
    // aparecer ningun vocals.wav en los inputs.
    let joined = plan.args.join("\n");
    assert!(
        !joined.contains("vocals.wav"),
        "sin stem no debe haber input extra"
    );
    assert!(joined.contains("audio.wav"));
    let _ = std::fs::remove_dir_all(&root);
}

// --- Composición opaca en yuv420p -------------------------------------------
//
// `composition_needs_alpha` decide si el grafo puede componer sin plano alfa.
// Estas pruebas cubren las dos direcciones: una timeline de cortes simples va
// en yuv420p y cualquier feature que produzca o consuma alfa vuelve a rgba.

fn plan_video_graph(project: &Value) -> String {
    let root = std::env::temp_dir().join(format!("editor-ia-alpha-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    std::fs::write(media.join("video.mp4"), b"x").unwrap();
    std::fs::write(media.join("audio.wav"), b"x").unwrap();
    std::fs::create_dir_all(media.join("luts")).unwrap();
    std::fs::write(media.join("luts/x.cube"), b"LUT_3D_SIZE 2\n").unwrap();
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project,
        root: &root,
        profile: &profile(),
        output_path: &root.join("salida.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("el plan debería construirse");
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("[vout]"))
        .expect("falta el grafo de video")
        .clone();
    let _ = std::fs::remove_dir_all(&root);
    graph
}

fn clip_graph_with(mutate: impl Fn(&mut Value)) -> String {
    let mut project = project();
    mutate(&mut project["timeline"]["clips"][0]);
    plan_video_graph(&project)
}

#[test]
fn opaque_cuts_compose_in_yuv420p_without_rgba() {
    let graph = plan_video_graph(&project());
    assert!(
        graph.contains("[0:v]format=yuv420p"),
        "la base debería componer en yuv420p: {graph}"
    );
    assert!(
        graph.contains("format=yuv420p,setpts=PTS-STARTPTS+"),
        "la cadena del clip debería cerrar en yuv420p: {graph}"
    );
    assert!(
        !graph.contains("format=rgba"),
        "una timeline opaca no debería tener ningún format=rgba: {graph}"
    );
}

#[test]
fn alpha_features_keep_the_rgba_composition() {
    let cases: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        (
            "opacidad",
            Box::new(|c| c["transform"] = serde_json::json!({"opacity": 0.5})),
        ),
        (
            "opacityFrozen",
            Box::new(|c| c["opacityFrozen"] = serde_json::json!(0.5)),
        ),
        (
            "blendMode",
            Box::new(|c| c["blendMode"] = serde_json::json!("multiply")),
        ),
        (
            "máscara",
            Box::new(|c| c["mask"] = serde_json::json!({"shape": "rectangle"})),
        ),
        (
            "chromaKey",
            Box::new(|c| c["chromaKey"] = serde_json::json!({"color": "#00ff00"})),
        ),
        (
            "rotación",
            Box::new(|c| c["transform"] = serde_json::json!({"rotationDeg": 15})),
        ),
        (
            "keyframes de opacidad",
            Box::new(|c| {
                c["transform"] = serde_json::json!({
                    "keyframes": [{"frame": 0, "opacity": 0.0}, {"frame": 30, "opacity": 1.0}]
                })
            }),
        ),
        (
            "keyframes de escala bajo 1",
            Box::new(|c| {
                c["transform"] = serde_json::json!({
                    "keyframes": [{"frame": 0, "scale": 0.8}, {"frame": 30, "scale": 1.2}]
                })
            }),
        ),
        (
            "glow",
            Box::new(|c| c["effects"] = serde_json::json!({"glow": {"intensity": 0.5}})),
        ),
        (
            "fadeInFrames",
            Box::new(|c| c["effects"] = serde_json::json!({"fadeInFrames": 15})),
        ),
        (
            "animación fade",
            Box::new(|c| c["animationIn"] = serde_json::json!({"type": "fade"})),
        ),
        (
            "perspectiva",
            Box::new(|c| {
                c["transform"] = serde_json::json!({
                    "perspective": {"corners": [
                        {"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
                        {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}
                    ]}
                })
            }),
        ),
        (
            "LUT parcial",
            Box::new(|c| {
                c["effects"] = serde_json::json!({
                    "lutFile": "media/luts/x.cube", "lutIntensity": 0.5
                })
            }),
        ),
    ];
    for (name, mutate) in cases {
        let graph = clip_graph_with(|clip| mutate(clip));
        assert!(
            graph.contains("format=rgba"),
            "{name} debería forzar la composición RGBA: {graph}"
        );
    }
}

#[test]
fn transitions_and_assets_decide_the_composition_format() {
    // Dissolve con lead real (el clip no puede empezar en el frame 0).
    let mut dissolve = project();
    dissolve["timeline"]["clips"][0]["startFrame"] = serde_json::json!(15);
    dissolve["timeline"]["clips"][0]["transitionIn"] =
        serde_json::json!({"type": "dissolve", "frames": 15});
    let graph = plan_video_graph(&dissolve);
    assert!(graph.contains("format=rgba"), "dissolve: {graph}");

    // Wipe e iris escriben alfa. `luma-wipe` también, pero exige clip mate y
    // el plan falla antes de llegar al formato.
    for kind in ["wipe-left", "iris", "slide-3d-left"] {
        let mut case = project();
        case["timeline"]["clips"][0]["startFrame"] = serde_json::json!(15);
        case["timeline"]["clips"][0]["transitionIn"] =
            serde_json::json!({"type": kind, "frames": 15});
        let graph = plan_video_graph(&case);
        assert!(graph.contains("format=rgba"), "{kind}: {graph}");
    }

    // Clip imagen: puede traer alfa propio.
    let graph = clip_graph_with(|c| c["kind"] = serde_json::json!("image"));
    assert!(graph.contains("format=rgba"), "imagen: {graph}");

    // Asset de video con canal alpha (VP9).
    let mut alpha_asset = project();
    alpha_asset["assets"][0]["media"] = serde_json::json!({"alpha": true});
    let graph = plan_video_graph(&alpha_asset);
    assert!(graph.contains("format=rgba"), "media.alpha: {graph}");
}

#[test]
fn non_alpha_transitions_and_safe_keyframes_stay_in_yuv420p() {
    // Fades a color y slide 2D no tocan el plano alfa.
    for kind in ["fade-black", "fade-white", "dip-color", "slide-left"] {
        let mut case = project();
        case["timeline"]["clips"][0]["startFrame"] = serde_json::json!(15);
        case["timeline"]["clips"][0]["transitionIn"] =
            serde_json::json!({"type": kind, "frames": 15});
        let graph = plan_video_graph(&case);
        assert!(
            !graph.contains("format=rgba"),
            "{kind} no debería exigir RGBA: {graph}"
        );
    }
    // Keyframes de escala que nunca bajan de 1 van por zoompan: sin alfa.
    let graph = clip_graph_with(|c| {
        c["transform"] = serde_json::json!({
            "keyframes": [{"frame": 0, "scale": 1.0}, {"frame": 30, "scale": 1.5}]
        })
    });
    assert!(
        !graph.contains("format=rgba"),
        "zoompan no necesita alfa: {graph}"
    );
    // Keyframes de posición se resuelven en el overlay: sin alfa.
    let graph = clip_graph_with(|c| {
        c["transform"] = serde_json::json!({
            "keyframes": [
                {"frame": 0, "offsetX": 0.0, "offsetY": 0.0},
                {"frame": 30, "offsetX": 0.2, "offsetY": 0.1}
            ]
        })
    });
    assert!(
        !graph.contains("format=rgba"),
        "offset keyframes no necesitan alfa: {graph}"
    );
}

/// Render real A/B: la misma timeline opaca por el camino yuv420p y por el
/// forzado rgba tiene que dar el mismo video (PSNR alto, misma duración).
#[test]
#[ignore]
fn render_live_opaque_composition_matches_the_rgba_path() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("render_live_opaque omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg debería estar instalado");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe debería estar instalado");
    let root = std::env::temp_dir().join(format!("editor-ia-opaque-live-{}", uuid::Uuid::new_v4()));
    let media = root.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let video_path = media.join("video.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner".to_string(),
            "-y".into(),
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            "testsrc=size=320x180:rate=30:duration=2".into(),
            "-pix_fmt".into(),
            "yuv420p".into(),
            path_to_string(&video_path),
        ])
        .status()
        .unwrap();
    assert!(status.success(), "no se pudo generar el video base");
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 }, "backgroundColor": "#101014" },
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 0, "hidden": false, "muted": false }],
            "clips": [
                { "id": "c1", "trackId": "v1", "kind": "video", "startFrame": 0, "durationFrames": 60, "source": { "type": "asset", "assetId": "asset1", "inFrame": 0, "outFrame": 60 } }
            ]
        },
        "assets": [
            { "id": "asset1", "status": "ready", "rights": { "license": { "commercialUse": "allowed" } }, "source": { "path": "media/video.mp4" } }
        ],
        "captions": { "styles": [], "cues": [] },
        "audio": { "master": { "gainDb": 0 } }
    });
    let mut profile = profile();
    profile.width = 320;
    profile.height = 180;
    let temp = root.join("temp");
    std::fs::create_dir_all(&temp).unwrap();
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &root,
        profile: &profile,
        output_path: &root.join("opaque.mp4"),
        include_captions: false,
        temp_dir: &temp,
        ffprobe: &ffprobe,
        motion_ass: None,
    })
    .expect("el plan debería construirse");
    let graph = plan
        .args
        .iter()
        .find(|arg| arg.contains("[vout]"))
        .cloned()
        .unwrap_or_default();
    assert!(
        graph.contains("format=yuv420p") && !graph.contains("format=rgba"),
        "la timeline de prueba debería componer en yuv420p: {graph}"
    );
    let opaque = root.join("opaque.mp4");
    let v_opaque = execute_sync(&ffmpeg, &ffprobe, &plan, |_| {})
        .expect("el render yuv420p debería verificarse");
    // Variante de referencia: el mismo plan con el formato de composición
    // forzado a rgba (equivale al pipeline anterior a la optimización).
    let mut rgba_plan = plan.clone();
    rgba_plan.output_path = root.join("rgba.mp4");
    for arg in &mut rgba_plan.args {
        if arg.contains("format=yuv420p") {
            *arg = arg.replace("format=yuv420p", "format=rgba");
        }
        if arg.contains("opaque.mp4") {
            *arg = arg.replace("opaque.mp4", "rgba.mp4");
        }
    }
    let rgba = root.join("rgba.mp4");
    let v_rgba = execute_sync(&ffmpeg, &ffprobe, &rgba_plan, |_| {})
        .expect("el render rgba debería verificarse");
    assert!(
        (v_opaque.duration_seconds - v_rgba.duration_seconds).abs() < 0.1,
        "duraciones distintas: {} vs {}",
        v_opaque.duration_seconds,
        v_rgba.duration_seconds
    );
    // PSNR entre ambas salidas: el yuv directo y el pase por RGBA difieren sólo
    // por el redondeo de la conversión de color.
    let output = Command::new(&ffmpeg)
        .args([
            "-hide_banner".to_string(),
            "-i".into(),
            path_to_string(&opaque),
            "-i".into(),
            path_to_string(&rgba),
            "-lavfi".into(),
            "psnr".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ])
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let average = stderr
        .lines()
        .find_map(|line| {
            line.split("average:").nth(1).and_then(|rest| {
                rest.split_whitespace()
                    .next()
                    .and_then(|value| value.parse::<f64>().ok())
            })
        })
        .expect("ffmpeg no reportó PSNR");
    eprintln!("PSNR yuv420p vs rgba: {average:.2} dB");
    assert!(
        average > 40.0,
        "las salidas divergen demasiado: {average} dB\n{stderr}"
    );
    let _ = std::fs::remove_dir_all(&root);
}
