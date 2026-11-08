use super::*;

#[test]
fn ass_escaping_removes_tags_and_keeps_lines() {
    let escaped = ass_text("Línea 1\n{Hack}: 100% \\ fin");
    assert!(!escaped.contains('{'));
    assert!(!escaped.contains('}'));
    assert!(!escaped.replace("\\N", "").contains('\\'));
    assert!(escaped.contains("\\N"));
}

#[test]
fn plan_cuts_respects_interval_and_limit() {
    let cuts = plan_cuts(20.0, 5.0, 1.75, 10, 2);
    assert_eq!(cuts.len(), 3);
    assert_eq!(cuts[0].start, 5.0);
    assert_eq!(cuts[0].duration, 1.75);
    assert_eq!(cuts[1].broll_index, 1);
    assert_eq!(cuts[2].broll_index, 0);
    assert!(plan_cuts(2.0, 5.0, 1.75, 10, 1).is_empty());
}

#[test]
fn aspect_filters_use_blur_for_vertical_and_square() {
    let vertical = aspect_filter(Aspect::Vertical);
    assert!(vertical.contains("gblur=sigma=28"));
    assert!(vertical.contains("1080:1920"));
    let horizontal = aspect_filter(Aspect::Horizontal);
    assert!(horizontal.contains("crop=1920:1080"));
    let square = aspect_filter(Aspect::Square);
    assert!(square.contains("1080:1080"));
}

#[test]
fn qr_png_is_generated_offline() {
    let workspace = TempWorkspace::new("qr-test").unwrap();
    let path = workspace.path.join("qr.png");
    write_qr_png(&path, "https://olyvia.example/afiliado").unwrap();
    let image = image::open(&path).unwrap();
    assert!(image.width() > 100);
    assert_eq!(image.width(), image.height());
}

#[test]
fn hook_filter_splits_and_zooms_the_first_three_seconds() {
    let info = VideoInfo {
        width: 640,
        height: 360,
        fps: 30.0,
        duration: 8.0,
        has_audio: true,
    };
    let filter = hook_filter(info, 3.0, 0.10);
    assert!(filter.contains("trim=0:3.000"));
    assert!(filter.contains("zoompan="));
    assert!(filter.contains("concat=n=2:v=1:a=0"));
    assert!(filter.contains("ass=hook.ass"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn creator_tools_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("creator_tools_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let workspace = TempWorkspace::new("creator-live").unwrap();
    let input = workspace.path.join("base.mp4");
    let made = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30:duration=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=6",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(&input)
        .status()
        .expect("generate input");
    assert!(made.success());
    let broll_dir = workspace.path.join("broll");
    std::fs::create_dir_all(&broll_dir).unwrap();
    for (index, color) in ["red", "blue"].iter().enumerate() {
        let clip = broll_dir.join(format!("clip-{index}.mp4"));
        let status = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c={color}:size=320x180:rate=30:duration=1"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&clip)
            .status()
            .unwrap();
        assert!(status.success());
    }

    let hook = hook_blocking(
        &ffmpeg,
        &ffprobe,
        &input,
        &workspace.path.join("hook.mp4"),
        "El secreto que nadie te contó",
        0.12,
        -15.0,
    )
    .unwrap();
    let info = probe_video(&ffprobe, Path::new(&hook.path)).unwrap();
    assert!((info.duration - 6.0).abs() < 0.35);
    assert!(info.has_audio);

    let cta = cta_blocking(
        &ffmpeg,
        &ffprobe,
        &input,
        &workspace.path.join("cta.mp4"),
        "Enlace en la biografía",
        "https://olyvia.example/afiliado",
        4.0,
        true,
    )
    .unwrap();
    let info = probe_video(&ffprobe, Path::new(&cta.path)).unwrap();
    assert!((info.duration - 6.0).abs() < 0.35);
    assert!(info.has_audio);

    let variants = aspect_blocking(
        &ffmpeg,
        &input,
        &workspace.path.join("variants"),
        vec![Aspect::Vertical, Aspect::Horizontal, Aspect::Square],
        6.0,
        true,
    )
    .await
    .unwrap();
    assert_eq!(variants.len(), 3);
    for variant in &variants {
        let info = probe_video(&ffprobe, Path::new(&variant.path)).unwrap();
        assert_eq!((info.width, info.height), (variant.width, variant.height));
        assert!(info.has_audio);
    }

    let broll = broll_blocking(
        &ffmpeg,
        &ffprobe,
        &input,
        &broll_dir,
        &workspace.path.join("broll.mp4"),
        4.0,
        1.5,
        4,
    )
    .unwrap();
    let info = probe_video(&ffprobe, Path::new(&broll.path)).unwrap();
    assert!((info.duration - 6.0).abs() < 0.35);
    assert!(info.has_audio);
    // El primer cut cae en 4.0–5.5 s y usa el clip rojo: el frame central
    // debe ser rojo, no el testsrc original.
    let sample = Command::new(&ffmpeg)
        .args(["-hide_banner", "-v", "error", "-ss", "4.75", "-i"])
        .arg(&broll.path)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=1:1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-",
        ])
        .output()
        .unwrap();
    assert!(sample.status.success());
    assert!(sample.stdout.len() >= 3);
    assert!(
        sample.stdout[0] > 150 && sample.stdout[1] < 100 && sample.stdout[2] < 100,
        "el B-roll rojo no reemplazó el tramo: {:?}",
        &sample.stdout[..3]
    );

    // Capítulos: se genera un MP4 de 6 s con dos capítulos embebidos.
    let chaptered = workspace.path.join("chaptered.mp4");
    let meta = workspace.path.join("chapters.txt");
    std::fs::write(
            &meta,
            ";FFMETADATA1\ntitle=Demo\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=Introducción\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=6000\ntitle=Cierre: preguntas\n",
        )
        .unwrap();
    let made = Command::new(&ffmpeg)
        .args(["-hide_banner", "-v", "error", "-y", "-i"])
        .arg(&input)
        .arg("-i")
        .arg(&meta)
        .args(["-map_metadata", "1", "-codec", "copy"])
        .arg(&chaptered)
        .status()
        .expect("chaptered input");
    assert!(made.success());
    let chapters_dir = workspace.path.join("chapters");
    let parts = split_chapters_blocking(&ffmpeg, &ffprobe, &chaptered, &chapters_dir).unwrap();
    assert_eq!(parts.len(), 2);
    let mut total = 0.0;
    for part in &parts {
        let info = probe_video(&ffprobe, Path::new(&part.path)).unwrap();
        assert!(info.has_audio);
        assert!(
            info.duration > 2.5 && info.duration < 3.6,
            "cada capítulo debe durar ~3 s, no {}",
            info.duration
        );
        total += info.duration;
    }
    assert!((total - 6.0).abs() < 0.6, "duración total {total}");
    assert!(Path::new(&parts[1].path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .contains("Cierre_ preguntas"));

    // Subtítulos quemados: filtro subtitles real sobre un frame claro.
    let srt = "1\n00:00:00,200 --> 00:00:05,500\nSubtítulo de prueba\n";
    let burned = burn_subtitles_blocking(
        &ffmpeg,
        &ffprobe,
        &input,
        &workspace.path.join("subtitled.mp4"),
        srt,
    )
    .unwrap();
    let info = probe_video(&ffprobe, Path::new(&burned.path)).unwrap();
    assert!((info.duration - 6.0).abs() < 0.35);
    assert!(info.has_audio);
    assert!(burned.bytes > 0);
    let empty = burn_subtitles_blocking(
        &ffmpeg,
        &ffprobe,
        &input,
        &workspace.path.join("empty.mp4"),
        "   ",
    );
    assert!(empty.is_err());
}

#[test]
fn safe_name_removes_unsafe_characters() {
    assert_eq!(safe_name("Cierre: ¿preguntas?"), "Cierre_ ¿preguntas_");
    assert_eq!(safe_name("   "), "capitulo");
    assert_eq!(safe_name("a/b\\c"), "a_b_c");
}

#[test]
fn broll_filter_keeps_main_audio_contiguous() {
    let info = VideoInfo {
        width: 640,
        height: 360,
        fps: 30.0,
        duration: 10.0,
        has_audio: true,
    };
    let cuts = plan_cuts(10.0, 5.0, 1.75, 4, 1);
    let graph = broll_filter(info, &cuts);
    assert!(graph.contains("atrim=start=5.000:end=6.750"));
    assert!(graph.contains("concat=n=3:v=0:a=1[a]"));
    assert!(graph.contains("trim=0:1.750"));
}
