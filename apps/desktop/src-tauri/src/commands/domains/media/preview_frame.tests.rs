use super::*;

#[test]
fn source_time_honours_trim_and_speed() {
    let clip = serde_json::json!({
        "kind": "video",
        "startFrame": 30,
        "durationFrames": 60,
        "source": { "type": "asset", "inFrame": 15, "outFrame": 75 },
        "speed": { "num": 1, "den": 1 }
    });
    let (time, image) = source_time(&clip, 30, 30.0);
    assert!(!image);
    assert!((time - 0.5).abs() < 0.001);
    let mut fast = clip.clone();
    fast["speed"] = serde_json::json!({ "num": 2, "den": 1 });
    let (time, _) = source_time(&fast, 60, 30.0);
    assert!((time - 2.5).abs() < 0.001);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_renders_a_clip_frame_with_effects() {
    let dir = std::env::temp_dir().join(format!("editoria-preview-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("clip.mp4");
    let generated = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg");
    assert!(generated.success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Toma",
            "source": { "path": "media/clip.mp4" }
        }],
        "timeline": { "clips": [{
            "id": "c", "kind": "video", "label": "Toma", "startFrame": 0,
            "durationFrames": 30,
            "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
            "effects": {
                "brightness": 0.1,
                "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.8, "feather": 0.1 },
                "relight": { "x": 0, "y": 0, "radius": 0.4, "strength": 0.3, "warmth": 0.1 }
            }
        }] }
    });
    let result = render_frame(Path::new("ffmpeg"), &dir, &project, "c", 10, false, &dir)
        .expect("frame real");
    assert!(Path::new(&result.path).is_file());
    assert_eq!((result.width, result.height), (320, 180));
    assert!(!result.native);
    assert_eq!(result.decoder, "ffmpeg");
    println!(
        "preview real: {} {}x{}",
        result.path, result.width, result.height
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe y las DLLs de FFmpeg en PATH"]
fn live_native_frame_uses_video_rs_at_source_size() {
    let dir = std::env::temp_dir().join(format!("editoria-native-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("clip.mp4");
    let generated = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=640x360:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg");
    assert!(generated.success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Toma",
            "source": { "path": "media/clip.mp4" },
            "media": { "width": 640, "height": 360 }
        }],
        "timeline": { "clips": [{
            "id": "c", "kind": "video", "label": "Toma", "startFrame": 0,
            "durationFrames": 30,
            "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
            "effects": { "brightness": 0.05 }
        }] }
    });
    let result = render_frame(Path::new("ffmpeg"), &dir, &project, "c", 10, true, &dir)
        .expect("frame nativo");
    assert!(Path::new(&result.path).is_file());
    assert!(result.native, "el frame debía quedar a resolución nativa");
    assert_eq!((result.width, result.height), (640, 360));
    assert_eq!(result.decoder, "video-rs");
    println!(
        "preview nativo: {} {}x{} con {}",
        result.path, result.width, result.height, result.decoder
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn frame_args_keep_the_graph_and_replace_the_audio_tail() {
    let plan: Vec<String> = [
        "-hide_banner",
        "-f",
        "lavfi",
        "-i",
        "color=black:s=320x180:r=30:d=3",
        "-filter_complex",
        "[0:v]format=rgba[base0];[base0]format=yuv420p[vout];[0:a]anull[aout]",
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-t",
        "3.000000",
        "out.mp4",
    ]
    .iter()
    .map(|arg| (*arg).to_owned())
    .collect();
    let output = Path::new("frame.png");
    let args = frame_args_from_plan(&plan, 1.25, output).expect("args");
    let has_pair = |left: &str, right: &str| {
        args.windows(2)
            .any(|pair| pair[0].as_str() == left && pair[1].as_str() == right)
    };
    assert!(has_pair("-frames:v", "1"));
    assert!(has_pair("-map", "[frame]"));
    assert!(!has_pair("-ss", "1.250000"));
    assert!(args.iter().any(|arg| arg.as_str() == "-an"));
    assert!(
        !has_pair("-map", "[aout]"),
        "el compuesto no debe mapear audio"
    );
    assert!(!args.iter().any(|arg| arg.as_str() == "libx264"));
    assert!(!args.iter().any(|arg| arg.as_str() == "-t"));
    assert_eq!(args.last().map(String::as_str), Some("frame.png"));
    let graph_position = args
        .iter()
        .position(|arg| arg.as_str() == "-filter_complex")
        .expect("filter_complex");
    assert_eq!(graph_position, 5);
    let graph = &args[graph_position + 1];
    assert!(graph.contains("[vout]"));
    assert!(graph.contains("trim=start=1.250000"));
    assert!(graph.contains("[frame]"));
    assert!(!graph.contains("[aout]"));
    assert!(!graph.contains("anull"));
    assert_eq!(
        frame_args_from_plan(&["-i".into(), "x".into()], 0.0, output),
        None
    );
}

#[test]
fn audio_chain_detection_does_not_drop_adjustment_layers() {
    assert_eq!(audio_output_label("[0:a]anull[a1]"), Some("a1"));
    assert_eq!(audio_output_label("[0:a]anull[aout]"), Some("aout"));
    assert_eq!(audio_output_label("[base0]eq=brightness=0.2[adj0]"), None);
    assert_eq!(audio_output_label("[base0]format=yuv420p[vout]"), None);
    assert_eq!(
        strip_audio_chains("[0:a]anull[a1];[a1]amix[aout];[base0]null[vout]"),
        "[base0]null[vout]"
    );
}

#[test]
fn composite_metadata_counts_active_tracks_and_captions() {
    let project = serde_json::json!({
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "hidden": false },
                { "id": "v2", "kind": "image", "hidden": false },
                { "id": "v3", "kind": "video", "hidden": true },
                { "id": "a1", "kind": "audio", "hidden": false },
                { "id": "c1", "kind": "caption", "hidden": true }
            ],
            "clips": [
                { "id": "base", "trackId": "v1", "startFrame": 0, "durationFrames": 90 },
                { "id": "over", "trackId": "v2", "startFrame": 30, "durationFrames": 60 },
                { "id": "hidden", "trackId": "v3", "startFrame": 0, "durationFrames": 90 },
                { "id": "voice", "trackId": "a1", "startFrame": 0, "durationFrames": 90 }
            ]
        },
        "captions": {
            "cues": [
                { "startFrame": 0, "endFrame": 40, "text": "Hola" },
                { "startFrame": 40, "endFrame": 80, "text": "   " },
                { "trackId": "c1", "startFrame": 90, "endFrame": 100, "text": "Oculto" }
            ]
        }
    });
    assert_eq!(composite_metadata(&project, 10), (1, true));
    assert_eq!(composite_metadata(&project, 35), (2, true));
    assert_eq!(composite_metadata(&project, 50), (2, false));
    assert_eq!(composite_metadata(&project, 85), (2, false));
    assert_eq!(
        composite_metadata(&project, 95),
        (0, false),
        "un cue en pista oculta no se quema"
    );
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_composite_frame_includes_tracks_and_pixels() {
    let dir = std::env::temp_dir().join(format!("editoria-composite-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("red.mp4");
    let image = media.join("blue.png");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
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
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg video")
        .success());
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=120x60",
            "-frames:v",
            "1",
        ])
        .arg(&image)
        .status()
        .expect("ffmpeg image")
        .success());
    let rights = serde_json::json!({ "license": { "commercialUse": "allowed" } });
    let project = serde_json::json!({
        "video": {
            "width": 320, "height": 180,
            "frameRate": { "num": 30, "den": 1 },
            "backgroundColor": "#000000"
        },
        "assets": [
            {
                "id": "base", "kind": "video", "label": "Base",
                "source": { "path": "media/red.mp4" },
                "status": "ready", "rights": rights.clone()
            },
            {
                "id": "over", "kind": "image", "label": "Overlay",
                "source": { "path": "media/blue.png" },
                "status": "ready", "rights": rights
            }
        ],
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 1 },
                { "id": "v2", "kind": "image", "order": 2 }
            ],
            "clips": [
                {
                    "id": "baseClip", "trackId": "v1", "kind": "video", "label": "Base",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "base", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 }
                },
                {
                    "id": "overClip", "trackId": "v2", "kind": "image", "label": "Overlay",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "over" }
                }
            ]
        },
        "captions": {
            "cues": [
                { "id": "c1", "startFrame": 0, "endFrame": 60, "text": "Hola" }
            ]
        }
    });
    let started = std::time::Instant::now();
    let result = composite_frame(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &project,
        "baseClip",
        30,
        &dir,
    )
    .expect("frame compuesto");
    assert!(result.composite);
    assert_eq!(result.composite_mode, "window");
    assert_eq!((result.width, result.height), (320, 180));
    assert_eq!(result.visible_tracks, 2);
    assert!(result.captions_burned);
    assert!(!result.native);
    let pixel = image::open(&result.path)
        .expect("png")
        .to_rgb8()
        .get_pixel(160, 90)
        .0;
    assert!(
        pixel[2] > 180 && pixel[0] < 80,
        "el centro debe ser el overlay azul, fue {pixel:?}"
    );
    println!(
        "compuesto real: {} {}x{} en {:.2}s ({})",
        result.path,
        result.width,
        result.height,
        started.elapsed().as_secs_f64(),
        result.clip_label
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "comparación manual ventana vs compuesto completo"]
fn compare_window_with_full_from_env() {
    let Ok(path) = std::env::var("EDITORIA_BENCH_PROJECT") else {
        return;
    };
    let project_path = PathBuf::from(path);
    let root = project_path.parent().expect("raíz").to_path_buf();
    let project: Value =
        serde_json::from_str(&std::fs::read_to_string(&project_path).expect("proyecto"))
            .expect("json");
    let silent = preview_copy(&project);
    let out = std::env::temp_dir().join(format!("editoria-compare-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&out).expect("salida");
    let frames: Vec<u64> = std::env::var("EDITORIA_BENCH_FRAMES")
        .unwrap_or_else(|_| "30,300,600".to_owned())
        .split(',')
        .filter_map(|value| value.trim().parse().ok())
        .collect();
    for frame in frames {
        let started = std::time::Instant::now();
        let fast = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &root,
            &project,
            "bench",
            frame,
            &out,
        )
        .expect("ventana");
        let fast_elapsed = started.elapsed().as_secs_f64();
        let started = std::time::Instant::now();
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &root,
            &silent,
            "bench",
            frame,
            &out,
        )
        .expect("completo");
        let full_elapsed = started.elapsed().as_secs_f64();
        let fast_image = image::open(&fast.path).expect("png ventana").to_rgb8();
        let full_image = image::open(&full.path).expect("png completo").to_rgb8();
        assert_eq!(fast_image.dimensions(), full_image.dimensions());
        let mut total = 0u64;
        let mut worst = 0u64;
        for (left, right) in fast_image.pixels().zip(full_image.pixels()) {
            for channel in 0..3 {
                let difference =
                    (left.0[channel] as i32 - right.0[channel] as i32).unsigned_abs() as u64;
                total += difference;
                worst = worst.max(difference);
            }
        }
        let pixels = (fast_image.width() * fast_image.height()) as u64;
        let mean = total as f64 / (pixels * 3) as f64;
        println!(
                "frame {frame}: ventana {fast_elapsed:.2}s ({}) · completo {full_elapsed:.2}s ({}) · diff media {mean:.3} · peor {worst}",
                fast.composite_mode, full.composite_mode
            );
        let _ = std::fs::remove_file(&fast.path);
        let _ = std::fs::remove_file(&full.path);
    }
    let _ = std::fs::remove_dir_all(&out);
}

fn preview_project() -> Value {
    serde_json::json!({
        "video": {
            "width": 320, "height": 180,
            "frameRate": { "num": 30, "den": 1 },
            "backgroundColor": "#000000"
        },
        "assets": [
            {
                "id": "video", "kind": "video", "label": "Toma",
                "source": { "path": "media/red.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            },
            {
                "id": "image", "kind": "image", "label": "Imagen",
                "source": { "path": "media/blue.png" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }
        ],
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 1 },
                { "id": "v2", "kind": "video", "order": 2 },
                { "id": "a1", "kind": "audio", "order": 3 }
            ],
            "clips": [
                {
                    "id": "main", "trackId": "v1", "kind": "video", "label": "Toma",
                    "startFrame": 10, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "video", "inFrame": 0, "outFrame": 30 },
                    "speed": { "num": 1, "den": 1 },
                    "transform": { "keyframes": [
                        { "frame": 0, "scale": 1 },
                        { "frame": 30, "scale": 1.2 }
                    ] },
                    "motion": { "type": "zoom-in", "intensity": 0.2 },
                    "mask": { "shape": "ellipse", "x": 0, "y": 0, "width": 0.8, "height": 0.8,
                        "keyframes": [
                            { "frame": 0, "x": 0 },
                            { "frame": 30, "x": 0.2 }
                        ] }
                },
                {
                    "id": "later", "trackId": "v2", "kind": "image", "label": "Después",
                    "startFrame": 100, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "image" },
                    "transform": {}
                },
                {
                    "id": "voice", "trackId": "a1", "kind": "audio", "label": "Voz",
                    "startFrame": 0, "durationFrames": 120,
                    "source": { "type": "asset", "assetId": "video" }
                }
            ]
        },
        "captions": { "cues": [
            { "id": "c1", "startFrame": 10, "endFrame": 40, "text": "Hola" }
        ] }
    })
}

#[test]
fn window_keeps_only_the_active_frame() {
    let project = preview_project();
    let window = window_project(&preview_copy(&project), 20).expect("ventana");
    let clips = window["timeline"]["clips"].as_array().expect("clips");
    assert_eq!(clips.len(), 1, "sólo el clip activo");
    let clip = &clips[0];
    assert_eq!(clip["id"], "main");
    assert_eq!(clip["startFrame"], 0);
    assert_eq!(clip["durationFrames"], 1);
    assert_eq!(clip["source"]["inFrame"], 10);
    assert_eq!(clip["source"]["outFrame"], 40);
    assert_eq!(clip["audio"]["muted"], true);
    let motion = &clip["motion"]["frozen"];
    assert!(motion["z"].as_f64().is_some_and(|zoom| zoom > 1.0));
    assert!(motion["x"].is_string() && motion["y"].is_string());
    let transform = clip["transform"]["keyframes"]
        .as_array()
        .expect("transform");
    assert_eq!(transform[0]["frame"], -10);
    assert_eq!(transform[1]["frame"], 20);
    let mask = clip["mask"]["keyframes"].as_array().expect("mask");
    assert_eq!(mask[0]["frame"], -10);
    assert_eq!(mask[1]["frame"], 20);
    let cues = window["captions"]["cues"].as_array().expect("cues");
    assert_eq!(cues.len(), 1);
    assert_eq!(cues[0]["startFrame"], 0);
    assert_eq!(cues[0]["endFrame"], 20);
    assert!(
        window["timeline"]["tracks"]
            .as_array()
            .expect("tracks")
            .iter()
            .all(|track| track["kind"] != "audio"),
        "el audio no entra al preview"
    );
}

#[test]
fn preview_copy_relaxes_rights_without_mutating_the_project() {
    let mut project = preview_project();
    project["assets"][0]["status"] = serde_json::json!("unverified");
    project["assets"][0]["rights"]["license"]["commercialUse"] = serde_json::json!("unknown");
    let preview = preview_copy(&project);
    assert_eq!(preview["assets"][0]["status"], "ready");
    assert_ne!(
        preview["assets"][0]["rights"]["license"]["commercialUse"],
        "unknown"
    );
    assert_eq!(project["assets"][0]["status"], "unverified");
    assert_eq!(
        project["assets"][0]["rights"]["license"]["commercialUse"],
        "unknown"
    );
    assert!(preview["timeline"]["tracks"]
        .as_array()
        .expect("tracks")
        .iter()
        .all(|track| track["kind"] != "audio"));
}

#[test]
fn window_rejects_word_reveal_and_omits_active_graphics() {
    let mut project = preview_project();
    project["captions"]["cues"][0]["wordReveal"] = serde_json::json!(true);
    project["captions"]["cues"][0]["words"] = serde_json::json!([
        { "text": "Ho", "startFrame": 10, "endFrame": 20 },
        { "text": "la", "startFrame": 20, "endFrame": 30 }
    ]);
    assert!(
        window_project(&preview_copy(&project), 20).is_err(),
        "el revelado por palabra debe caer al compuesto completo"
    );

    let mut project = preview_project();
    project["timeline"]["tracks"]
        .as_array_mut()
        .expect("tracks")
        .push(serde_json::json!({
            "id": "g1", "kind": "video", "order": 3
        }));
    project["timeline"]["clips"]
        .as_array_mut()
        .expect("clips")
        .push(serde_json::json!({
            "id": "graphic", "trackId": "g1", "kind": "graphic",
            "label": "Gráfico", "startFrame": 100, "durationFrames": 10,
            "source": { "type": "graphic" }
        }));
    let window = window_project(&preview_copy(&project), 20).expect("gráfico inactivo");
    assert_eq!(window["previewGraphicOmitted"], serde_json::Value::Null);
    project["timeline"]["clips"][3]["startFrame"] = serde_json::json!(20);
    let window = window_project(&preview_copy(&project), 20).expect("gráfico activo omitido");
    assert_eq!(window["previewGraphicOmitted"], serde_json::json!(true));
    assert!(
        window["timeline"]["clips"]
            .as_array()
            .expect("clips")
            .iter()
            .all(|clip| clip["id"] != "graphic"),
        "el clip gráfico no debe entrar en el plan de la ventana"
    );
}

#[test]
fn window_freezes_fades_and_transition_leads() {
    let mut project = preview_project();
    project["timeline"]["clips"][0]["effects"] =
        serde_json::json!({ "fadeInFrames": 12, "fadeOutFrames": 12 });
    let window = window_project(&preview_copy(&project), 13).expect("fade de entrada");
    let clip = &window["timeline"]["clips"][0];
    assert_eq!(clip["effects"]["fadeInFrames"], 0);
    assert_eq!(clip["effects"]["fadeOutFrames"], 0);
    let enter = clip["fadeFrozen"].as_f64().expect("factor de entrada");
    assert!((enter - 0.25).abs() < 1e-6, "factor {enter}");
    let window = window_project(&preview_copy(&project), 34).expect("fade de salida");
    let leave = window["timeline"]["clips"][0]["fadeFrozen"]
        .as_f64()
        .expect("factor de salida");
    assert!((leave - 0.5).abs() < 1e-6, "factor {leave}");
    assert!(window_project(&preview_copy(&project), 40).is_ok());

    let later_clip = |window: &Value| -> Value {
        window["timeline"]["clips"]
            .as_array()
            .expect("clips")
            .iter()
            .find(|clip| clip["id"] == "later")
            .expect("clip entrante")
            .clone()
    };
    let mut project = preview_project();
    project["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    project["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "dissolve", "frames": 12
    });
    // El frame 16 cae en el lead: alfa 0,5. El 22 ya es el corte.
    let window = window_project(&preview_copy(&project), 16).expect("dissolve en lead");
    let later = later_clip(&window);
    assert_eq!(later["transitionIn"], serde_json::json!({}));
    let alpha = later["transitionFrozen"]["alpha"]
        .as_f64()
        .expect("alfa de transición");
    assert!((alpha - 0.5).abs() < 1e-6, "alfa {alpha}");
    assert_eq!(
        composite_metadata(&project, 16).0,
        2,
        "el clip entrante cuenta durante su lead"
    );
    assert!(window_project(&preview_copy(&project), 22).is_ok());

    for (kind, axis, expected) in [
        ("slide-left", "x", 160.0_f64),
        ("slide-right", "x", -160.0),
        ("slide-up", "y", 90.0),
        ("slide-down", "y", -90.0),
    ] {
        let mut slide = preview_project();
        slide["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
        slide["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
            "type": kind, "frames": 12
        });
        let window = window_project(&preview_copy(&slide), 16).expect("slide en lead");
        let later = later_clip(&window);
        let value = later["transitionFrozen"][axis]
            .as_f64()
            .expect("desplazamiento congelado");
        assert!((value - expected).abs() < 1e-6, "{kind}: {axis} {value}");
        assert!(window_project(&preview_copy(&slide), 22).is_ok());
    }

    // Slide 3D: desplazamiento congelado + quad en perspectiva con el
    // progreso del frame (frame 16 de un lead de 12 que empieza en 10:
    // progreso 0,5).
    for (kind, axis, move_axis, move_expected) in [
        ("slide-3d-left", "x", "x", 160.0_f64),
        ("slide-3d-right", "x", "x", -160.0),
        ("slide-3d-up", "y", "y", 90.0),
        ("slide-3d-down", "y", "y", -90.0),
    ] {
        let mut slide = preview_project();
        slide["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
        slide["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
            "type": kind, "frames": 12
        });
        let window = window_project(&preview_copy(&slide), 16).expect("slide-3d en lead");
        let later = later_clip(&window);
        let frozen = &later["transitionFrozen"];
        assert_eq!(frozen["mode"], "slide3d", "{kind}");
        assert_eq!(frozen["axis"], axis, "{kind}");
        assert!(
            (frozen["progress"].as_f64().unwrap() - 0.5).abs() < 1e-6,
            "{kind}: progreso {}",
            frozen["progress"]
        );
        let moved = frozen[move_axis].as_f64().expect("desplazamiento");
        assert!(
            (moved - move_expected).abs() < 1e-6,
            "{kind}: {move_axis} {moved}"
        );
        assert!(window_project(&preview_copy(&slide), 22).is_ok());
    }

    let mut fade = preview_project();
    fade["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    fade["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "fade-black", "frames": 12
    });
    let window = window_project(&preview_copy(&fade), 16).expect("fade-black en lead");
    let later = later_clip(&window);
    assert_eq!(later["transitionFrozen"]["mode"], "black");
    assert!((later["transitionFrozen"]["alpha"].as_f64().unwrap() - 0.5).abs() < 1e-6);
    assert!(window_project(&preview_copy(&fade), 22).is_ok());

    let mut dip = preview_project();
    dip["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    dip["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "dip-color", "frames": 12, "color": "#2244aa"
    });
    let window = window_project(&preview_copy(&dip), 16).expect("dip-color en lead");
    let later = later_clip(&window);
    assert_eq!(later["transitionFrozen"]["mode"], "color");
    assert_eq!(later["transitionFrozen"]["color"], "#2244aa");
    assert!((later["transitionFrozen"]["alpha"].as_f64().unwrap() - 0.5).abs() < 1e-6);
    assert!(window_project(&preview_copy(&dip), 22).is_ok());

    let mut iris = preview_project();
    iris["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    iris["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "iris", "frames": 12
    });
    let window = window_project(&preview_copy(&iris), 16).expect("iris en lead");
    let later = later_clip(&window);
    assert_eq!(later["transitionFrozen"]["mode"], "wipe");
    assert_eq!(later["transitionFrozen"]["kind"], "iris");
    assert!(
        (later["transitionFrozen"]["progress"].as_f64().unwrap() - 0.5).abs() < 1e-6,
        "progreso {}",
        later["transitionFrozen"]["progress"]
    );
    assert!(window_project(&preview_copy(&iris), 22).is_ok());

    // Luma wipe: el mate ("main", activo en el frame 16) queda en la
    // ventana como clip normal y el entrante congela `mode: luma` con su
    // id para que el render tome su frame como máscara.
    let mut luma = preview_project();
    luma["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    luma["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "luma-wipe", "frames": 12, "mateClipId": "main"
    });
    let window = window_project(&preview_copy(&luma), 16).expect("luma-wipe en lead");
    let later = later_clip(&window);
    assert_eq!(later["transitionFrozen"]["mode"], "luma");
    assert_eq!(later["transitionFrozen"]["mateClipId"], "main");
    let clips = window["timeline"]["clips"].as_array().expect("clips");
    assert!(
        clips.iter().any(|clip| clip["id"] == "main"),
        "el mate debe seguir en la ventana como clip visible"
    );
    assert!(window_project(&preview_copy(&luma), 22).is_ok());

    // Mate en pista oculta (el caso que recomienda la UI): el clip
    // entra a la ventana sólo como fuente de máscara —su pista sigue
    // oculta, así que el render no lo compone— y su `inFrame` queda
    // rebasado al frame del playhead, que es el frame que la máscara
    // debe mostrar.
    let mut hidden_mate = preview_project();
    hidden_mate["timeline"]["tracks"][0]["hidden"] = serde_json::json!(true);
    hidden_mate["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    hidden_mate["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "luma-wipe", "frames": 12, "mateClipId": "main"
    });
    let window = window_project(&preview_copy(&hidden_mate), 16)
        .expect("luma-wipe con mate en pista oculta");
    let clips = window["timeline"]["clips"].as_array().expect("clips");
    let mate = clips
        .iter()
        .find(|clip| clip["id"] == "main")
        .expect("el mate oculto debe entrar a la ventana");
    assert_eq!(mate["source"]["inFrame"], 6, "mate al frame del playhead");
    let later = later_clip(&window);
    assert_eq!(later["transitionFrozen"]["mode"], "luma");
    assert_eq!(later["transitionFrozen"]["mateClipId"], "main");
    assert!(
        window["timeline"]["tracks"]
            .as_array()
            .expect("tracks")
            .iter()
            .any(|track| track["id"] == "v1" && track["hidden"] == true),
        "la pista del mate sigue oculta en la ventana"
    );

    let mut motion = preview_project();
    motion["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    motion["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "dissolve", "frames": 12
    });
    motion["timeline"]["clips"][1]["motion"] =
        serde_json::json!({ "type": "zoom-in", "intensity": 0.2 });
    let window = window_project(&preview_copy(&motion), 16).expect("motion en lead");
    let later = later_clip(&window);
    let zoom = later["motion"]["frozen"]["z"]
        .as_f64()
        .expect("zoom congelado");
    assert!((zoom - 1.04).abs() < 1e-6, "zoom {zoom}");
    assert!(window_project(&preview_copy(&motion), 22).is_ok());
    let window = window_project(&preview_copy(&motion), 46).expect("motion posterior al clip");
    let later = later_clip(&window);
    let zoom = later["motion"]["frozen"]["z"]
        .as_f64()
        .expect("zoom posterior");
    assert!((zoom - 1.24).abs() < 1e-6, "zoom posterior {zoom}");

    let mut animated = preview_project();
    animated["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    animated["timeline"]["clips"][1]["animationIn"] =
        serde_json::json!({ "type": "slide-left", "durationFrames": 12 });
    animated["timeline"]["clips"][1]["animationOut"] =
        serde_json::json!({ "type": "fade", "durationFrames": 12 });
    let window = window_project(&preview_copy(&animated), 25).expect("animación de entrada");
    let later = later_clip(&window);
    let x = later["animationFrozen"]["x"]
        .as_f64()
        .expect("desplazamiento animado");
    assert!((x - 240.0).abs() < 1e-6, "x {x}");
    let window = window_project(&preview_copy(&animated), 46).expect("animación de salida");
    let later = later_clip(&window);
    let alpha = later["animationFrozen"]["alpha"]
        .as_f64()
        .expect("alfa animado");
    assert!((alpha - 0.5).abs() < 1e-6, "alfa {alpha}");

    let mut unknown = preview_project();
    unknown["timeline"]["clips"][1]["startFrame"] = serde_json::json!(22);
    unknown["timeline"]["clips"][1]["transitionIn"] = serde_json::json!({
        "type": "wipe", "frames": 12
    });
    assert!(window_project(&preview_copy(&unknown), 16).is_err());

    let mut project = preview_project();
    project["timeline"]["clips"][0]["transform"]["keyframes"][1]["opacity"] =
        serde_json::json!(0.5);
    let window = window_project(&preview_copy(&project), 20).expect("opacidad congelada");
    let main = window["timeline"]["clips"]
        .as_array()
        .expect("clips")
        .iter()
        .find(|clip| clip["id"] == "main")
        .expect("clip principal");
    let opacity = main["opacityFrozen"].as_f64().expect("opacidad");
    assert!((opacity - 0.5).abs() < 1e-6, "opacidad {opacity}");
}

#[test]
fn frozen_opacity_interpolates_with_easing() {
    let clip = serde_json::json!({
        "transform": { "keyframes": [
            { "frame": 0, "opacity": 0 },
            { "frame": 30, "opacity": 1 }
        ] }
    });
    let value = opacity_at(&clip, 0.5, 30.0).expect("lineal");
    assert!((value - 0.5).abs() < 1e-9, "lineal {value}");
    let mut eased = clip.clone();
    eased["transform"]["keyframes"][0]["easing"] = serde_json::json!("ease-in");
    let value = opacity_at(&eased, 0.5, 30.0).expect("ease-in");
    assert!((value - 0.125).abs() < 1e-9, "ease-in {value}");
    let mut hold = clip.clone();
    hold["transform"]["keyframes"][0]["easing"] = serde_json::json!("hold");
    let value = opacity_at(&hold, 0.5, 30.0).expect("hold");
    assert!(value.abs() < 1e-9, "hold {value}");
    let value = opacity_at(&hold, 1.0, 30.0).expect("final");
    assert!((value - 1.0).abs() < 1e-9, "final {value}");
}

#[test]
fn window_expands_compound_clips() {
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Toma",
            "source": { "path": "media/red.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "outer", "trackId": "v1", "kind": "compound",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "compound", "compoundId": "c1" }
            }]
        },
        "compounds": [{
            "id": "c1", "durationFrames": 30,
            "clips": [{
                "id": "inner", "trackId": "v1", "kind": "video",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
            }]
        }],
        "captions": { "cues": [] }
    });
    let window = window_project(&preview_copy(&project), 10).expect("compuesto expandido");
    let ids: Vec<&str> = window["timeline"]["clips"]
        .as_array()
        .expect("clips")
        .iter()
        .filter_map(|clip| clip["id"].as_str())
        .collect();
    assert!(ids.contains(&"inner"), "clips: {ids:?}");
    assert!(!ids.contains(&"outer"), "clips: {ids:?}");
}

#[test]
fn window_skips_compounds_on_hidden_tracks() {
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Toma",
            "source": { "path": "media/red.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 0, "hidden": true },
                { "id": "v2", "kind": "video", "order": 1, "hidden": false }
            ],
            "clips": [{
                "id": "outer", "trackId": "v1", "kind": "compound",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "compound", "compoundId": "c1" }
            }]
        },
        "compounds": [{
            "id": "c1", "durationFrames": 30,
            "clips": [{
                "id": "inner", "trackId": "v2", "kind": "video",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
            }]
        }],
        "captions": { "cues": [] }
    });
    let window = window_project(&preview_copy(&project), 10).expect("ventana oculta");
    let ids: Vec<&str> = window["timeline"]["clips"]
        .as_array()
        .expect("clips")
        .iter()
        .filter_map(|clip| clip["id"].as_str())
        .collect();
    assert!(
        !ids.contains(&"inner"),
        "la pista oculta del compuesto no debe revelar sus clips internos: {ids:?}"
    );
}

#[test]
fn reverse_clip_uses_the_reversed_source_frame() {
    let mut project = preview_project();
    project["timeline"]["clips"][0]["reverse"] = serde_json::json!(true);
    let window = window_project(&preview_copy(&project), 20).expect("clip invertido");
    let main = window["timeline"]["clips"]
        .as_array()
        .expect("clips")
        .iter()
        .find(|clip| clip["id"] == "main")
        .expect("clip principal");
    assert_eq!(main["reverse"], serde_json::json!(false));
    // in=0, out=30, clip de 30 frames, delta=10: el reverso muestra 19.
    assert_eq!(main["source"]["inFrame"], serde_json::json!(19));
    assert_eq!(main["source"]["outFrame"], serde_json::json!(20));
}

#[test]
fn frozen_ken_burns_fraction_is_independent_of_speed() {
    let base = serde_json::json!({
        "kind": "video",
        "motion": { "type": "zoom-in", "intensity": 0.2 }
    });
    let normal = frozen_motion(&base, 2.5, 5.0).expect("normal");
    let mut fast = base;
    fast["speed"] = serde_json::json!({ "num": 2, "den": 1 });
    let doubled = frozen_motion(&fast, 2.5, 5.0).expect("velocidad");
    let zoom = |value: &Value| value["frozen"]["z"].as_f64().expect("z");
    assert!((zoom(&normal) - 1.1).abs() < 1e-9);
    assert!((zoom(&normal) - zoom(&doubled)).abs() < 1e-9);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn window_matches_full_with_motion_keyframes_and_mask() {
    let dir = std::env::temp_dir().join(format!("editoria-window-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("bars.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "smptebars=s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Barras",
            "source": { "path": "media/bars.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Barras",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                "speed": { "num": 1, "den": 1 },
                "motion": { "type": "zoom-in", "intensity": 0.2 },
                "effects": { "brightness": 0.08 },
                "transform": {
                    "opacity": 1,
                    "keyframes": [
                        { "frame": 0, "offsetX": 0 },
                        { "frame": 60, "offsetX": 0.1 }
                    ]
                },
                "mask": {
                    "shape": "ellipse", "x": 0, "y": 0, "width": 0.9,
                    "height": 0.9, "feather": 0.1,
                    "keyframes": [
                        { "frame": 0, "x": 0 },
                        { "frame": 60, "x": 0.1 }
                    ]
                }
            }]
        }
    });
    let fast = composite_frame(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &project,
        "c",
        30,
        &dir,
    )
    .expect("ventana");
    let full = render_composite_project(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &preview_copy(&project),
        "c",
        30,
        &dir,
    )
    .expect("completo");
    assert_eq!(fast.composite_mode, "window");
    let fast_image = image::open(&fast.path).expect("png ventana").to_rgb8();
    let full_image = image::open(&full.path).expect("png completo").to_rgb8();
    let mut total = 0u64;
    for (left, right) in fast_image.pixels().zip(full_image.pixels()) {
        for channel in 0..3 {
            total += (left.0[channel] as i32 - right.0[channel] as i32).unsigned_abs() as u64;
        }
    }
    let mean = total as f64 / (fast_image.width() * fast_image.height() * 3) as f64;
    println!("ventana vs completo (motion/offset/máscara): diff media {mean:.3}");
    assert!(
        mean < 1.0,
        "la ventana debe coincidir con el compuesto completo, diff {mean:.3}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn window_scale_keyframe_matches_the_static_target() {
    // El overlay del compuesto completo centra una capa que cambia de
    // tamaño con el tamaño inicial; la ventana congela la escala del frame
    // y coincide con el equivalente estático.
    let dir = std::env::temp_dir().join(format!("editoria-scale-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("bars.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "smptebars=s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg")
        .success());
    let project = |transform: Value| {
        serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Barras",
                "source": { "path": "media/bars.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Barras",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 },
                    "effects": { "brightness": 0.08 },
                    "transform": transform
                }]
            }
        })
    };
    let keyed = project(serde_json::json!({ "keyframes": [
            { "frame": 0, "scale": 1 },
            { "frame": 60, "scale": 1.3 }
        ] }));
    let static_target = project(serde_json::json!({ "scaleX": 1.15, "scaleY": 1.15 }));
    let fast = composite_frame(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &keyed,
        "c",
        30,
        &dir,
    )
    .expect("ventana");
    assert_eq!(fast.composite_mode, "window");
    let reference = render_composite_project(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &preview_copy(&static_target),
        "c",
        30,
        &dir,
    )
    .expect("estático");
    let full = render_composite_project(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &preview_copy(&keyed),
        "c",
        30,
        &dir,
    )
    .expect("completo keyed");
    let mean_diff = |left: &image::RgbImage, right: &image::RgbImage| {
        let mut total = 0u64;
        for (a, b) in left.pixels().zip(right.pixels()) {
            for channel in 0..3 {
                total += (a.0[channel] as i32 - b.0[channel] as i32).unsigned_abs() as u64;
            }
        }
        total as f64 / (left.width() * left.height() * 3) as f64
    };
    let fast_image = image::open(&fast.path).expect("png ventana").to_rgb8();
    let reference_image = image::open(&reference.path)
        .expect("png estático")
        .to_rgb8();
    let full_image = image::open(&full.path).expect("png completo").to_rgb8();
    let mean = mean_diff(&fast_image, &reference_image);
    let full_mean = mean_diff(&full_image, &reference_image);
    println!("scale kf vs estático 1.15: ventana {mean:.3} · completo {full_mean:.3}");
    assert!(
        mean < 5.0,
        "la escala congelada debe ser 1.15, diff {mean:.3}"
    );
    assert!(
        full_mean < 8.0,
        "el compuesto completo debe recentrar la escala, diff {full_mean:.3}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_scale_keyframe_export_stays_centered() {
    let dir = std::env::temp_dir().join(format!("editoria-scale-export-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let source = media.join("square.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-vf",
            "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let bbox = |image: &image::RgbImage| -> Option<(u32, u32, u32, u32)> {
        let (width, height) = image.dimensions();
        let mut bounds = (width, height, 0u32, 0u32);
        let mut found = false;
        for y in 0..height {
            for x in 0..width {
                let pixel = image.get_pixel(x, y).0;
                if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                    found = true;
                    bounds = (
                        bounds.0.min(x),
                        bounds.1.min(y),
                        bounds.2.max(x),
                        bounds.3.max(y),
                    );
                }
            }
        }
        found.then_some(bounds)
    };
    for (label, start_scale, end_scale, expected_start, expected_mid) in [
        ("arriba", 1.0, 1.3, 100u32, 115u32),
        ("abajo", 1.0, 0.7, 100u32, 85u32),
        ("cruce", 0.8, 1.3, 80u32, 105u32),
    ] {
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Cuadrado",
                "source": { "path": "media/square.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                    "startFrame": 0, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 1, "den": 1 },
                    "transform": { "keyframes": [
                        { "frame": 0, "scale": start_scale },
                        { "frame": 60, "scale": end_scale }
                    ] }
                }]
            }
        });
        let output = dir.join(format!("scale-{label}.mp4"));
        let profile = profile_for(&project).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan de export");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg export")
            .success());
        assert!(output.is_file());
        for (time, frame_label, expected) in [
            (0.05, "inicio", expected_start),
            (1.0, "medio", expected_mid),
        ] {
            let frame = dir.join(format!("frame-{label}-{frame_label}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                .arg(&output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame")
                .success());
            let image = image::open(&frame).expect("png frame").to_rgb8();
            let (left, _top, right, _bottom) = bbox(&image).expect("cuadrado rojo");
            let width = right - left + 1;
            let center = (left + right) / 2;
            println!(
                "{label}/{frame_label}: ancho {width} · centro {center} (esperado {expected}/160)"
            );
            assert!(
                width.abs_diff(expected) <= 4,
                "{label}/{frame_label}: ancho {width}, esperado {expected}"
            );
            assert!(
                center.abs_diff(160) <= 4,
                "{label}/{frame_label}: centro {center}, esperado 160"
            );
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_rotation_keyframe_export_stays_centered() {
    let dir = std::env::temp_dir().join(format!("editoria-rotation-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let source = media.join("square.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-vf",
            "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Cuadrado",
            "source": { "path": "media/square.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                "speed": { "num": 1, "den": 1 },
                "transform": { "keyframes": [
                    { "frame": 0, "rotationDeg": 0 },
                    { "frame": 60, "rotationDeg": 90 }
                ] }
            }]
        }
    });
    let output = dir.join("rotation.mp4");
    let profile = profile_for(&project).expect("perfil");
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &dir,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &render_dir,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("plan de rotación");
    assert!(Command::new("ffmpeg")
        .args(&plan.args)
        .current_dir(&render_dir)
        .status()
        .expect("ffmpeg rotación")
        .success());
    for time in [0.05_f64, 1.0] {
        let frame = dir.join(format!("rotation-{time:.3}.png"));
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
            .arg(&output)
            .args(["-frames:v", "1"])
            .arg(&frame)
            .status()
            .expect("ffmpeg frame")
            .success());
        let image = image::open(&frame).expect("png").to_rgb8();
        let mut bounds = (320u32, 180u32, 0u32, 0u32);
        let mut found = false;
        for y in 0..180 {
            for x in 0..320 {
                let pixel = image.get_pixel(x, y).0;
                if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                    found = true;
                    bounds = (
                        bounds.0.min(x),
                        bounds.1.min(y),
                        bounds.2.max(x),
                        bounds.3.max(y),
                    );
                }
            }
        }
        assert!(found, "el cuadrado rotado debe verse");
        let width = bounds.2 - bounds.0 + 1;
        let center_x = (bounds.0 + bounds.2) / 2;
        let center_y = (bounds.1 + bounds.3) / 2;
        println!("rotación {time:.2}s: ancho {width} · centro {center_x},{center_y}");
        assert!(
            center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
            "la rotación debe quedar centrada, fue {center_x},{center_y}"
        );
        let expected_width = if time > 0.5 { 141 } else { 104 };
        assert!(
            width.abs_diff(expected_width) <= 6,
            "la rotación debe animarse: ancho {width}, esperado {expected_width}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_scale_rotation_export_combines_both() {
    let dir = std::env::temp_dir().join(format!("editoria-scale-rot-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let source = media.join("square.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-vf",
            "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Cuadrado",
            "source": { "path": "media/square.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                "speed": { "num": 1, "den": 1 },
                "transform": { "keyframes": [
                    { "frame": 0, "scale": 1, "rotationDeg": 0 },
                    { "frame": 60, "scale": 1.3, "rotationDeg": 90 }
                ] }
            }]
        }
    });
    let output = dir.join("scale-rotation.mp4");
    let profile = profile_for(&project).expect("perfil");
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &dir,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &render_dir,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("plan escala+rotación");
    assert!(Command::new("ffmpeg")
        .args(&plan.args)
        .current_dir(&render_dir)
        .status()
        .expect("ffmpeg escala+rotación")
        .success());
    for (time, expected_width) in [(0.05_f64, 104u32), (1.0, 163u32)] {
        let frame = dir.join(format!("scale-rotation-{time:.3}.png"));
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
            .arg(&output)
            .args(["-frames:v", "1"])
            .arg(&frame)
            .status()
            .expect("ffmpeg frame")
            .success());
        let image = image::open(&frame).expect("png").to_rgb8();
        let mut bounds = (320u32, 180u32, 0u32, 0u32);
        let mut found = false;
        for y in 0..180 {
            for x in 0..320 {
                let pixel = image.get_pixel(x, y).0;
                if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                    found = true;
                    bounds = (
                        bounds.0.min(x),
                        bounds.1.min(y),
                        bounds.2.max(x),
                        bounds.3.max(y),
                    );
                }
            }
        }
        assert!(found, "el cuadrado debe verse");
        let width = bounds.2 - bounds.0 + 1;
        let center_x = (bounds.0 + bounds.2) / 2;
        let center_y = (bounds.1 + bounds.3) / 2;
        println!("escala+rotación {time:.2}s: ancho {width} · centro {center_x},{center_y}");
        assert!(
            width.abs_diff(expected_width) <= 6,
            "ancho {width}, esperado {expected_width}"
        );
        assert!(
            center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
            "centro {center_x},{center_y}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_static_scale_with_keyframes_export() {
    let dir = std::env::temp_dir().join(format!("editoria-static-scale-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let source = media.join("square.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-vf",
            "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Cuadrado",
            "source": { "path": "media/square.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                "speed": { "num": 1, "den": 1 },
                "transform": {
                    "scaleX": 1.15, "scaleY": 1.15,
                    "keyframes": [
                        { "frame": 0, "scale": 1 },
                        { "frame": 60, "scale": 1.3 }
                    ]
                }
            }]
        }
    });
    let output = dir.join("static-scale.mp4");
    let profile = profile_for(&project).expect("perfil");
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &dir,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &render_dir,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("plan escala estática");
    assert!(Command::new("ffmpeg")
        .args(&plan.args)
        .current_dir(&render_dir)
        .status()
        .expect("ffmpeg escala estática")
        .success());
    for (time, expected_width) in [(0.05_f64, 115u32), (1.0, 132u32)] {
        let frame = dir.join(format!("static-scale-{time:.3}.png"));
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
            .arg(&output)
            .args(["-frames:v", "1"])
            .arg(&frame)
            .status()
            .expect("ffmpeg frame")
            .success());
        let image = image::open(&frame).expect("png").to_rgb8();
        let mut bounds = (320u32, 180u32, 0u32, 0u32);
        let mut found = false;
        for y in 0..180 {
            for x in 0..320 {
                let pixel = image.get_pixel(x, y).0;
                if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                    found = true;
                    bounds = (
                        bounds.0.min(x),
                        bounds.1.min(y),
                        bounds.2.max(x),
                        bounds.3.max(y),
                    );
                }
            }
        }
        assert!(found, "el cuadrado debe verse");
        let width = bounds.2 - bounds.0 + 1;
        let center_x = (bounds.0 + bounds.2) / 2;
        let center_y = (bounds.1 + bounds.3) / 2;
        println!(
            "escala estática+keyframes {time:.2}s: ancho {width} · centro {center_x},{center_y}"
        );
        assert!(
            width.abs_diff(expected_width) <= 6,
            "ancho {width}, esperado {expected_width}"
        );
        assert!(
            center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
            "centro {center_x},{center_y}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_motion_scale_export_combines_both() {
    let dir = std::env::temp_dir().join(format!("editoria-motion-scale-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let source = media.join("square.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-vf",
            "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Cuadrado",
            "source": { "path": "media/square.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                "startFrame": 0, "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                "speed": { "num": 1, "den": 1 },
                "motion": { "type": "zoom-in", "intensity": 0.2 },
                "transform": { "keyframes": [
                    { "frame": 0, "scale": 1 },
                    { "frame": 60, "scale": 1.3 }
                ] }
            }]
        }
    });
    let output = dir.join("motion-scale.mp4");
    let profile = profile_for(&project).expect("perfil");
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &dir,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &render_dir,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("plan movimiento+escala");
    assert!(Command::new("ffmpeg")
        .args(&plan.args)
        .current_dir(&render_dir)
        .status()
        .expect("ffmpeg movimiento+escala")
        .success());
    for (time, expected_width) in [(0.05_f64, 101u32), (1.0, 126u32)] {
        let frame = dir.join(format!("motion-scale-{time:.3}.png"));
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
            .arg(&output)
            .args(["-frames:v", "1"])
            .arg(&frame)
            .status()
            .expect("ffmpeg frame")
            .success());
        let image = image::open(&frame).expect("png").to_rgb8();
        let mut bounds = (320u32, 180u32, 0u32, 0u32);
        let mut found = false;
        for y in 0..180 {
            for x in 0..320 {
                let pixel = image.get_pixel(x, y).0;
                if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                    found = true;
                    bounds = (
                        bounds.0.min(x),
                        bounds.1.min(y),
                        bounds.2.max(x),
                        bounds.3.max(y),
                    );
                }
            }
        }
        assert!(found, "el cuadrado debe verse");
        let width = bounds.2 - bounds.0 + 1;
        let center_x = (bounds.0 + bounds.2) / 2;
        let center_y = (bounds.1 + bounds.3) / 2;
        println!("movimiento+escala {time:.2}s: ancho {width} · centro {center_x},{center_y}");
        assert!(
            width.abs_diff(expected_width) <= 6,
            "ancho {width}, esperado {expected_width}"
        );
        assert!(
            center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
            "centro {center_x},{center_y}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_speed_scale_export_rebases_keyframes() {
    let dir = std::env::temp_dir().join(format!("editoria-speed-scale-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let source = media.join("square.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=30:d=2",
            "-vf",
            "drawbox=x=110:y=40:w=100:h=100:color=red:t=fill",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    for (label, start_scale, end_scale, expected_start, expected_mid) in [
        ("arriba", 1.0, 1.3, 101u32, 115u32),
        ("cruce", 0.8, 1.3, 82u32, 105u32),
    ] {
        let project = serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "label": "Cuadrado",
                "source": { "path": "media/square.mp4" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "video", "label": "Cuadrado",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                    "speed": { "num": 2, "den": 1 },
                    "transform": { "keyframes": [
                        { "frame": 0, "scale": start_scale },
                        { "frame": 30, "scale": end_scale }
                    ] }
                }]
            }
        });
        let output = dir.join(format!("speed-scale-{label}.mp4"));
        let profile = profile_for(&project).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: &project,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan velocidad+escala");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg velocidad+escala")
            .success());
        for (time, expected_width) in [(0.05_f64, expected_start), (0.5, expected_mid)] {
            let frame = dir.join(format!("speed-scale-{label}-{time:.3}.png"));
            assert!(Command::new("ffmpeg")
                .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
                .arg(&output)
                .args(["-frames:v", "1"])
                .arg(&frame)
                .status()
                .expect("ffmpeg frame")
                .success());
            let image = image::open(&frame).expect("png").to_rgb8();
            let mut bounds = (320u32, 180u32, 0u32, 0u32);
            let mut found = false;
            for y in 0..180 {
                for x in 0..320 {
                    let pixel = image.get_pixel(x, y).0;
                    if pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80 {
                        found = true;
                        bounds = (
                            bounds.0.min(x),
                            bounds.1.min(y),
                            bounds.2.max(x),
                            bounds.3.max(y),
                        );
                    }
                }
            }
            assert!(found, "el cuadrado debe verse");
            let width = bounds.2 - bounds.0 + 1;
            let center_x = (bounds.0 + bounds.2) / 2;
            let center_y = (bounds.1 + bounds.3) / 2;
            println!(
                "velocidad+escala/{label} {time:.2}s: ancho {width} · centro {center_x},{center_y}"
            );
            assert!(
                width.abs_diff(expected_width) <= 6,
                "ancho {width}, esperado {expected_width}"
            );
            assert!(
                center_x.abs_diff(160) <= 4 && center_y.abs_diff(90) <= 4,
                "centro {center_x},{center_y}"
            );
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn active_fade_uses_the_window_and_matches_the_full_composite() {
    let dir = std::env::temp_dir().join(format!("editoria-fade-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let image = media.join("gray.png");
    let pixels = vec![180u8; 320 * 180 * 3];
    image::save_buffer(&image, &pixels, 320, 180, image::ColorType::Rgb8).expect("png");
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "image", "label": "Gris",
            "source": { "path": "media/gray.png" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "image", "label": "Gris",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a" },
                "effects": { "fadeInFrames": 12, "fadeOutFrames": 12 }
            }]
        }
    });
    // frame 3: 25% de opacidad; frame 24: 50%. El fondo #0f1319 se mezcla
    // con el gris 180 según el alfa, sin oscurecer el RGB del clip.
    for (frame, factor) in [(3u64, 0.25_f64), (24, 0.5)] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con fade");
        assert_eq!(window.composite_mode, "window", "frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&project),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo con fade");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let center_fast = fast.get_pixel(160, 90).0;
        let center_full = reference.get_pixel(160, 90).0;
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!(
                "fade frame {frame}: ventana {center_fast:?} · completo {center_full:?} · diff {mean_diff:.3}/255"
            );
        for (channel, base) in [15.0_f64, 19.0, 25.0].into_iter().enumerate() {
            let expected = base + (180.0 - base) * factor;
            assert!(
                (center_fast[channel] as f64 - expected).abs() <= 4.0,
                "ventana {center_fast:?}, canal {channel}, esperado {expected:.1}"
            );
            assert!(
                (center_full[channel] as f64 - expected).abs() <= 4.0,
                "completo {center_full:?}, canal {channel}, esperado {expected:.1}"
            );
        }
        assert!(mean_diff <= 3.0, "diferencia media {mean_diff:.3}/255");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn active_fade_with_speed_and_rotation_matches_full() {
    let dir = std::env::temp_dir().join(format!("editoria-fade-speed-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("gray.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0xB4B4B4:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": {
            "width": 320, "height": 180,
            "frameRate": { "num": 30, "den": 1 },
            "backgroundColor": "#0f1319"
        },
        "assets": [{
            "id": "a", "kind": "video", "label": "Gris",
            "source": { "path": "media/gray.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Gris",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 },
                "speed": { "num": 2, "den": 1 },
                "effects": { "fadeInFrames": 12, "fadeOutFrames": 12 },
                "transform": { "keyframes": [
                    { "frame": 0, "rotationDeg": 0 },
                    { "frame": 30, "rotationDeg": 90 }
                ] }
            }]
        }
    });
    for (frame, factor) in [(3u64, 0.25_f64), (24, 0.5)] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con fade, velocidad y rotación");
        assert_eq!(window.composite_mode, "window", "frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&project),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let center_fast = fast.get_pixel(160, 90).0;
        let center_full = reference.get_pixel(160, 90).0;
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!(
                "fade+velocidad+rotación frame {frame}: ventana {center_fast:?} · completo {center_full:?} · diff {mean_diff:.3}/255"
            );
        for (channel, base) in [15.0_f64, 19.0, 25.0].into_iter().enumerate() {
            let expected = base + (180.0 - base) * factor;
            assert!(
                (center_fast[channel] as f64 - expected).abs() <= 5.0,
                "ventana {center_fast:?}, canal {channel}, esperado {expected:.1}"
            );
            assert!(
                (center_full[channel] as f64 - expected).abs() <= 5.0,
                "completo {center_full:?}, canal {channel}, esperado {expected:.1}"
            );
        }
        assert!(mean_diff <= 3.0, "diferencia media {mean_diff:.3}/255");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn transition_leads_use_the_window_and_match_full() {
    let dir = std::env::temp_dir().join(format!("editoria-transition-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    for (name, source) in [
        ("red", "color=c=red:s=320x180:r=30:d=2"),
        ("pattern", "testsrc2=s=320x180:r=30:d=2"),
    ] {
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", source])
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(media.join(format!("{name}.mp4")))
            .status()
            .expect("ffmpeg fuente")
            .success());
    }
    let base = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [
            { "id": "a", "kind": "video", "label": "Rojo",
              "source": { "path": "media/red.mp4" }, "status": "ready",
              "rights": { "license": { "commercialUse": "allowed" } } },
            { "id": "b", "kind": "video", "label": "Patrón",
              "source": { "path": "media/pattern.mp4" }, "status": "ready",
              "rights": { "license": { "commercialUse": "allowed" } } }
        ],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [
                { "id": "a", "trackId": "v1", "kind": "video", "label": "Rojo",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } },
                { "id": "b", "trackId": "v1", "kind": "video", "label": "Patrón",
                  "startFrame": 24, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "b", "inFrame": 0, "outFrame": 60 },
                  "transitionIn": { "type": "dissolve", "frames": 12 },
                  "transform": { "keyframes": [
                    { "frame": 0, "rotationDeg": 0 },
                    { "frame": 30, "rotationDeg": 90 }
                  ] } }
            ]
        }
    });
    for (kind, label) in [
        ("dissolve", "dissolve"),
        ("fade-black", "fade-black"),
        ("fade-white", "fade-white"),
        ("slide-left", "slide-left"),
    ] {
        let mut project = base.clone();
        project["timeline"]["clips"][1]["transitionIn"]["type"] = serde_json::json!(kind);
        for frame in [12u64, 18, 24, 30] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "b",
                frame,
                &dir,
            )
            .expect("ventana con transición");
            assert_eq!(window.composite_mode, "window", "{label} frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "b",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("transición {label} frame {frame}: diff {mean_diff:.3}/255");
            assert!(
                mean_diff <= 5.0,
                "{label} frame {frame}: diff {mean_diff:.3}/255"
            );
        }
    }
    for (kind, motion_type, label) in [
        ("dissolve", "zoom-in", "dissolve+motion"),
        ("slide-left", "zoom-in", "slide-left+motion"),
        ("dissolve", "zoom-out", "dissolve+zoom-out"),
        ("dissolve", "pan-right", "dissolve+pan-right"),
    ] {
        let mut project = base.clone();
        project["timeline"]["clips"][1]["transitionIn"]["type"] = serde_json::json!(kind);
        project["timeline"]["clips"][1]["motion"] =
            serde_json::json!({ "type": motion_type, "intensity": 0.2 });
        for frame in [12u64, 18, 24, 30, 46] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "b",
                frame,
                &dir,
            )
            .expect("ventana con motion");
            assert_eq!(window.composite_mode, "window", "{label} frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "b",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("transición {label} frame {frame}: diff {mean_diff:.3}/255");
            assert!(
                mean_diff <= 5.0,
                "{label} frame {frame}: diff {mean_diff:.3}/255"
            );
        }
    }
    let mut reversed = base.clone();
    reversed["timeline"]["clips"][1]["reverse"] = serde_json::json!(true);
    for frame in [12u64, 18, 24, 30] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &reversed,
            "b",
            frame,
            &dir,
        )
        .expect("ventana con reverse y transición");
        assert_eq!(window.composite_mode, "window", "reverse frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&reversed),
            "b",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("transición reverse frame {frame}: diff {mean_diff:.3}/255");
        assert!(
            mean_diff <= 5.0,
            "reverse frame {frame}: diff {mean_diff:.3}/255"
        );
    }
    for (label, opacity, animation) in [
        ("dissolve+opacity", Some((1.0, 0.5)), false),
        ("dissolve+animation", None, true),
    ] {
        let mut project = base.clone();
        if let Some((start, end)) = opacity {
            project["timeline"]["clips"][1]["transform"]["keyframes"][0]["opacity"] =
                serde_json::json!(start);
            project["timeline"]["clips"][1]["transform"]["keyframes"][1]["opacity"] =
                serde_json::json!(end);
        }
        if animation {
            project["timeline"]["clips"][1]["animationIn"] =
                serde_json::json!({ "type": "slide-left", "durationFrames": 12 });
        }
        for frame in [12u64, 18, 24, 30] {
            let window = composite_frame(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &project,
                "b",
                frame,
                &dir,
            )
            .expect("ventana combinada");
            assert_eq!(window.composite_mode, "window", "{label} frame {frame}");
            let full = render_composite_project(
                Path::new("ffmpeg"),
                Path::new("ffprobe"),
                &dir,
                &preview_copy(&project),
                "b",
                frame,
                &dir,
            )
            .expect("compuesto completo");
            let fast = image::open(&window.path).expect("png ventana").to_rgb8();
            let reference = image::open(&full.path).expect("png completo").to_rgb8();
            let mut total = 0u64;
            let mut count = 0u64;
            for (left, right) in fast.pixels().zip(reference.pixels()) {
                for channel in 0..3 {
                    total += left.0[channel].abs_diff(right.0[channel]) as u64;
                    count += 1;
                }
            }
            let mean_diff = total as f64 / count.max(1) as f64;
            println!("transición {label} frame {frame}: diff {mean_diff:.3}/255");
            assert!(
                mean_diff <= 5.0,
                "{label} frame {frame}: diff {mean_diff:.3}/255"
            );
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn opacity_keyframes_use_the_window_and_match_full() {
    let dir = std::env::temp_dir().join(format!("editoria-opacity-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let source = media.join("gray.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0xB4B4B4:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": {
            "width": 320, "height": 180,
            "frameRate": { "num": 30, "den": 1 },
            "backgroundColor": "#0f1319"
        },
        "assets": [{
            "id": "a", "kind": "video", "label": "Gris",
            "source": { "path": "media/gray.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Patrón",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
                "transform": { "keyframes": [
                    { "frame": 0, "opacity": 0, "scale": 1, "rotationDeg": 0 },
                    { "frame": 30, "opacity": 1, "scale": 1.3, "rotationDeg": 90 }
                ] }
            }]
        }
    });
    for frame in [3u64, 15, 24] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con opacidad");
        assert_eq!(window.composite_mode, "window", "frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&project),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("opacidad frame {frame}: diff {mean_diff:.3}/255");
        assert!(mean_diff <= 3.0, "frame {frame}: diff {mean_diff:.3}/255");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn clip_animations_use_the_window_and_match_full() {
    let dir = std::env::temp_dir().join(format!("editoria-animation-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let source = media.join("pattern.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": {
            "width": 320, "height": 180,
            "frameRate": { "num": 30, "den": 1 },
            "backgroundColor": "#0f1319"
        },
        "assets": [{
            "id": "a", "kind": "video", "label": "Patrón",
            "source": { "path": "media/pattern.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Patrón",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 },
                "animationIn": { "type": "slide-left", "durationFrames": 12 },
                "animationOut": { "type": "fade", "durationFrames": 12 }
            }]
        }
    });
    for frame in [3u64, 6, 24, 27] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con animación");
        assert_eq!(window.composite_mode, "window", "frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&project),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("animación frame {frame}: diff {mean_diff:.3}/255");
        assert!(mean_diff <= 3.0, "frame {frame}: diff {mean_diff:.3}/255");
    }
    let mut slide_out = project.clone();
    slide_out["timeline"]["clips"][0]["animationIn"] = serde_json::json!({});
    slide_out["timeline"]["clips"][0]["animationOut"] =
        serde_json::json!({ "type": "slide-right", "durationFrames": 12 });
    for frame in [24u64, 27] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &slide_out,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con slide de salida");
        assert_eq!(window.composite_mode, "window", "slide-out frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&slide_out),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("animación slide-out frame {frame}: diff {mean_diff:.3}/255");
        assert!(
            mean_diff <= 3.0,
            "slide-out frame {frame}: diff {mean_diff:.3}/255"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn reverse_clip_uses_the_window_and_matches_full() {
    let dir = std::env::temp_dir().join(format!("editoria-reverse-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let source = media.join("pattern.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Patrón",
            "source": { "path": "media/pattern.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "video", "label": "Patrón",
                "startFrame": 0, "durationFrames": 30, "reverse": true,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
            }]
        }
    });
    for frame in [0u64, 3, 15, 29] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con reverse");
        assert_eq!(window.composite_mode, "window", "frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&project),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("reverse frame {frame}: diff {mean_diff:.3}/255");
        assert!(mean_diff <= 3.0, "frame {frame}: diff {mean_diff:.3}/255");
    }
    let mut combined = project.clone();
    combined["timeline"]["clips"][0]["motion"] =
        serde_json::json!({ "type": "zoom-in", "intensity": 0.2 });
    combined["timeline"]["clips"][0]["transform"] = serde_json::json!({ "keyframes": [
            { "frame": 0, "scale": 1, "rotationDeg": 0 },
            { "frame": 30, "scale": 1.3, "rotationDeg": 90 }
        ] });
    for frame in [1u64, 15, 29] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &combined,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con reverse y transformación");
        assert_eq!(
            window.composite_mode, "window",
            "reverse+transform frame {frame}"
        );
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&combined),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("reverse+transform frame {frame}: diff {mean_diff:.3}/255");
        assert!(
            mean_diff <= 6.0,
            "reverse+transform frame {frame}: diff {mean_diff:.3}/255"
        );
    }
    let mut transformed = combined.clone();
    transformed["timeline"]["clips"][0]["reverse"] = serde_json::json!(false);
    for frame in [1u64, 15, 29] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &transformed,
            "c",
            frame,
            &dir,
        )
        .expect("ventana con transformación sin reverse");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&transformed),
            "c",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("transform sin reverse frame {frame}: diff {mean_diff:.3}/255");
        assert!(
            mean_diff <= 6.0,
            "transform sin reverse frame {frame}: diff {mean_diff:.3}/255"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn active_graphic_is_omitted_but_other_layers_compose() {
    let dir = std::env::temp_dir().join(format!("editoria-graphic-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let source = media.join("gray.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0xB4B4B4:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Gris",
            "source": { "path": "media/gray.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "order": 1 },
                { "id": "g1", "kind": "graphic", "order": 2 }
            ],
            "clips": [
                { "id": "v", "trackId": "v1", "kind": "video", "label": "Gris",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "g", "trackId": "g1", "kind": "graphic", "label": "Gráfico",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "graphic" } }
            ]
        },
        "captions": { "cues": [] }
    });
    let window = composite_frame(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &project,
        "v",
        15,
        &dir,
    )
    .expect("ventana con gráfico omitido");
    assert_eq!(window.composite_mode, "window");
    assert!(
        window
            .fallback_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("gráfico omitido")),
        "fallback: {:?}",
        window.fallback_reason
    );
    let mut reference_project = project.clone();
    reference_project["timeline"]["clips"] = serde_json::json!([{
        "id": "v", "trackId": "v1", "kind": "video", "label": "Gris",
        "startFrame": 0, "durationFrames": 30,
        "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
    }]);
    let reference = render_composite_project(
        Path::new("ffmpeg"),
        Path::new("ffprobe"),
        &dir,
        &preview_copy(&reference_project),
        "v",
        15,
        &dir,
    )
    .expect("compuesto sin gráfico");
    let fast = image::open(&window.path).expect("png ventana").to_rgb8();
    let expected = image::open(&reference.path)
        .expect("png referencia")
        .to_rgb8();
    let mut total = 0u64;
    let mut count = 0u64;
    for (left, right) in fast.pixels().zip(expected.pixels()) {
        for channel in 0..3 {
            total += left.0[channel].abs_diff(right.0[channel]) as u64;
            count += 1;
        }
    }
    let mean_diff = total as f64 / count.max(1) as f64;
    println!("gráfico omitido: diff {mean_diff:.3}/255");
    assert!(mean_diff <= 2.0, "diff {mean_diff:.3}/255");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn compound_clip_uses_the_window_and_matches_full() {
    let dir = std::env::temp_dir().join(format!("editoria-compound-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let source = media.join("gray.mp4");
    assert!(Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0xB4B4B4:s=320x180:r=30:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&source)
        .status()
        .expect("ffmpeg fuente")
        .success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Gris",
            "source": { "path": "media/gray.mp4" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "outer", "trackId": "v1", "kind": "compound",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "compound", "compoundId": "c1" }
            }]
        },
        "compounds": [{
            "id": "c1", "durationFrames": 30,
            "clips": [{
                "id": "inner", "trackId": "v1", "kind": "video",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
            }]
        }],
        "captions": { "cues": [] }
    });
    for frame in [3u64, 15, 29] {
        let window = composite_frame(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &project,
            "outer",
            frame,
            &dir,
        )
        .expect("ventana con compuesto");
        assert_eq!(window.composite_mode, "window", "frame {frame}");
        let full = render_composite_project(
            Path::new("ffmpeg"),
            Path::new("ffprobe"),
            &dir,
            &preview_copy(&project),
            "outer",
            frame,
            &dir,
        )
        .expect("compuesto completo");
        let fast = image::open(&window.path).expect("png ventana").to_rgb8();
        let reference = image::open(&full.path).expect("png completo").to_rgb8();
        let mut total = 0u64;
        let mut count = 0u64;
        for (left, right) in fast.pixels().zip(reference.pixels()) {
            for channel in 0..3 {
                total += left.0[channel].abs_diff(right.0[channel]) as u64;
                count += 1;
            }
        }
        let mean_diff = total as f64 / count.max(1) as f64;
        println!("compuesto frame {frame}: diff {mean_diff:.3}/255");
        assert!(mean_diff <= 2.0, "frame {frame}: diff {mean_diff:.3}/255");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_scale_below_one_keeps_sharpness() {
    let dir = std::env::temp_dir().join(format!("editoria-scale-sharp-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let checker = media.join("checker.png");
    let mut pixels = Vec::with_capacity(320 * 180 * 3);
    for y in 0..180 {
        for x in 0..320 {
            let value = if ((x / 8) + (y / 8)) % 2 == 0 {
                235u8
            } else {
                20u8
            };
            pixels.extend_from_slice(&[value, value, value]);
        }
    }
    image::save_buffer(&checker, &pixels, 320, 180, image::ColorType::Rgb8).expect("png");
    let project = |transform: serde_json::Value| {
        serde_json::json!({
            "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "image", "label": "Tablero",
                "source": { "path": "media/checker.png" },
                "status": "ready",
                "rights": { "license": { "commercialUse": "allowed" } }
            }],
            "timeline": {
                "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
                "clips": [{
                    "id": "c", "trackId": "v1", "kind": "image", "label": "Tablero",
                    "startFrame": 0, "durationFrames": 30,
                    "source": { "type": "asset", "assetId": "a" },
                    "transform": transform
                }]
            }
        })
    };
    let dynamic = project(serde_json::json!({
        "keyframes": [
            { "frame": 0, "scale": 0.8 },
            { "frame": 30, "scale": 1.3 }
        ]
    }));
    // La curva en el frame 29 vale 0,8 + 0,5·29/30; la referencia estática
    // usa esa misma escala para comparar nitidez sin cambiar el tamaño.
    let reference_scale = 0.8 + 0.5 * (29.0 / 30.0);
    let reference = project(serde_json::json!({
        "scaleX": reference_scale,
        "scaleY": reference_scale
    }));
    let mut outputs = Vec::new();
    for (name, current) in [("dynamic", &dynamic), ("reference", &reference)] {
        let output = dir.join(format!("sharp-{name}.mp4"));
        let profile = profile_for(current).expect("perfil");
        let plan = build_plan(BuildPlanInput {
            audio_only: false,
            project: current,
            root: &dir,
            profile: &profile,
            output_path: &output,
            include_captions: false,
            temp_dir: &render_dir,
            ffprobe: Path::new("ffprobe"),
            motion_ass: None,
        })
        .expect("plan de nitidez");
        assert!(Command::new("ffmpeg")
            .args(&plan.args)
            .current_dir(&render_dir)
            .status()
            .expect("ffmpeg nitidez")
            .success());
        outputs.push(output);
    }
    let lapvar = |output: &Path, label: &str| -> f64 {
        let frame = dir.join(format!("sharp-{label}.png"));
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-ss", "0.966", "-i"])
            .arg(output)
            .args(["-frames:v", "1"])
            .arg(&frame)
            .status()
            .expect("ffmpeg frame nitidez")
            .success());
        let image = image::open(&frame).expect("png nitidez").to_rgb8();
        let mut count = 0.0;
        let mut sum = 0.0;
        let mut sum2 = 0.0;
        for y in 21..159 {
            for x in 41..279 {
                let luma = |x: u32, y: u32| -> f64 {
                    let pixel = image.get_pixel(x, y).0;
                    (pixel[0] as f64 + pixel[1] as f64 + pixel[2] as f64) / 3.0
                };
                let center = luma(x, y);
                let laplacian = -4.0 * center
                    + luma(x - 1, y)
                    + luma(x + 1, y)
                    + luma(x, y - 1)
                    + luma(x, y + 1);
                count += 1.0;
                sum += laplacian;
                sum2 += laplacian * laplacian;
            }
        }
        sum2 / count - (sum / count).powi(2)
    };
    let dynamic_var = lapvar(&outputs[0], "dynamic");
    let reference_var = lapvar(&outputs[1], "reference");
    println!(
            "nitidez escala <1: dinámica {dynamic_var:.1} · referencia {reference_var:.1} · ratio {:.3}",
            dynamic_var / reference_var.max(1.0)
        );
    assert!(
        dynamic_var > reference_var * 0.7,
        "la escala dinámica perdió nitidez: {dynamic_var:.1} vs {reference_var:.1}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe en PATH"]
fn live_fade_export_is_linear_and_blends_with_background() {
    let dir = std::env::temp_dir().join(format!("editoria-fade-export-{}", Uuid::new_v4()));
    let media = dir.join("media");
    let render_dir = dir.join("render");
    std::fs::create_dir_all(&media).expect("media");
    std::fs::create_dir_all(&render_dir).expect("render");
    let image_path = media.join("gray.png");
    image::save_buffer(
        &image_path,
        &vec![180u8; 320 * 180 * 3],
        320,
        180,
        image::ColorType::Rgb8,
    )
    .expect("png");
    let project = serde_json::json!({
        "video": {
            "width": 320, "height": 180,
            "frameRate": { "num": 30, "den": 1 },
            "backgroundColor": "#0f1319"
        },
        "assets": [{
            "id": "a", "kind": "image", "label": "Gris",
            "source": { "path": "media/gray.png" },
            "status": "ready",
            "rights": { "license": { "commercialUse": "allowed" } }
        }],
        "timeline": {
            "tracks": [{ "id": "v1", "kind": "video", "order": 1 }],
            "clips": [{
                "id": "c", "trackId": "v1", "kind": "image", "label": "Gris",
                "startFrame": 0, "durationFrames": 30,
                "source": { "type": "asset", "assetId": "a" },
                "effects": { "fadeInFrames": 12, "fadeOutFrames": 12 }
            }]
        }
    });
    let output = dir.join("fade.mp4");
    let profile = profile_for(&project).expect("perfil");
    let plan = build_plan(BuildPlanInput {
        audio_only: false,
        project: &project,
        root: &dir,
        profile: &profile,
        output_path: &output,
        include_captions: false,
        temp_dir: &render_dir,
        ffprobe: Path::new("ffprobe"),
        motion_ass: None,
    })
    .expect("plan de fade");
    assert!(Command::new("ffmpeg")
        .args(&plan.args)
        .current_dir(&render_dir)
        .status()
        .expect("ffmpeg fade")
        .success());
    // 12 frames de fade: 25% de alfa en el frame 3, 100% al terminar y 50%
    // en el 24, mezclando el gris 180 con el fondo #0f1319.
    for (time, expected) in [(0.1_f64, 56.0), (0.4, 180.0), (0.8, 98.0)] {
        let frame = dir.join(format!("fade-{time:.3}.png"));
        assert!(Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
            .arg(&output)
            .args(["-frames:v", "1"])
            .arg(&frame)
            .status()
            .expect("ffmpeg frame")
            .success());
        let image = image::open(&frame).expect("png").to_rgb8();
        let pixel = image.get_pixel(160, 90).0;
        println!("fade export {time:.2}s: {pixel:?}, esperado {expected:.0}");
        assert!(
            (pixel[0] as f64 - expected).abs() <= 4.0,
            "frame {time:.2}s: {pixel:?}, esperado {expected:.0}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn native_profile_keeps_even_dimensions() {
    let profile = Profile {
        id: "p".into(),
        name: "p".into(),
        width: 1920,
        height: 1080,
        fps_num: 30,
        fps_den: 1,
        crf: None,
        target_bps: None,
        video_preset: "veryfast".into(),
        fit: "contain".into(),
        audio_bps: 128_000,
        video_codec: "h264".into(),
        audio_codec: "aac".into(),
        container: "mp4".into(),
        audio_rate: 48_000,
        audio_channels: 2,
        pixel_format: "yuv420p".into(),
        min_output_bytes: 1,
        duration_tolerance_frames: 1,
        hardware_encoder: None,
    };
    let native = at_dimensions(&profile, 3841, 2161);
    assert_eq!((native.width, native.height), (3840, 2160));
    assert_eq!(native.id, "preview-native");
}

#[test]
#[ignore = "requiere FFmpeg/FFprobe y las DLLs de FFmpeg en PATH"]
fn live_native_frame_honours_display_rotation() {
    let dir = std::env::temp_dir().join(format!("editoria-rotated-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let base = media.join("base.mp4");
    let rotated = media.join("rotated.mp4");
    let generated = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=640x360:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&base)
        .status()
        .expect("ffmpeg");
    assert!(generated.success());
    let rotated_ok = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-display_rotation", "90", "-i"])
        .arg(&base)
        .args(["-c", "copy"])
        .arg(&rotated)
        .status()
        .expect("ffmpeg rotation");
    assert!(rotated_ok.success());
    let project = serde_json::json!({
        "video": { "width": 320, "height": 180, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "label": "Toma",
            "source": { "path": "media/rotated.mp4" },
            "media": { "width": 640, "height": 360 }
        }],
        "timeline": { "clips": [{
            "id": "c", "kind": "video", "label": "Toma", "startFrame": 0,
            "durationFrames": 30,
            "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 }
        }] }
    });
    let result = render_frame(Path::new("ffmpeg"), &dir, &project, "c", 10, true, &dir)
        .expect("frame rotado");
    assert!(result.native);
    assert_eq!((result.width, result.height), (360, 640));
    assert_eq!(result.decoder, "ffmpeg");
    println!(
        "preview rotado: {} {}x{} con {}",
        result.path, result.width, result.height, result.decoder
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn display_dimensions_apply_sar_and_quarter_turns() {
    let base = SourceProbe {
        width: 1920,
        height: 1080,
        rotation_degrees: 0.0,
        sample_aspect: 1.0,
    };
    assert_eq!(display_dimensions(&base), (1920, 1080));
    let quarter = SourceProbe {
        rotation_degrees: 90.0,
        ..base
    };
    assert_eq!(display_dimensions(&quarter), (1080, 1920));
    let negative = SourceProbe {
        rotation_degrees: -90.0,
        ..base
    };
    assert_eq!(display_dimensions(&negative), (1080, 1920));
    let half = SourceProbe {
        rotation_degrees: 180.0,
        ..base
    };
    assert_eq!(display_dimensions(&half), (1920, 1080));
    let anamorphic = SourceProbe {
        width: 720,
        height: 480,
        rotation_degrees: 0.0,
        sample_aspect: 4.0 / 3.0,
    };
    assert_eq!(display_dimensions(&anamorphic), (960, 480));
    let rotated_anamorphic = SourceProbe {
        rotation_degrees: 90.0,
        ..anamorphic
    };
    assert_eq!(display_dimensions(&rotated_anamorphic), (480, 960));
}

#[test]
fn graphic_clips_are_rejected() {
    let project = serde_json::json!({
        "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "timeline": { "clips": [{ "id": "g", "kind": "graphic", "startFrame": 0, "durationFrames": 30 }] },
        "assets": []
    });
    let result = render_frame(
        Path::new("ffmpeg"),
        Path::new("."),
        &project,
        "g",
        0,
        false,
        Path::new("."),
    );
    assert!(result.is_err());
}
