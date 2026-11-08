use super::*;
use image::{Rgba, RgbaImage};

fn fixture_model() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/u2netp.onnx")
}

#[test]
fn output_frame_is_even_and_capped_at_1080p() {
    assert_eq!(fit_output_frame(3840, 2160).unwrap(), (1920, 1080));
    assert_eq!(fit_output_frame(1001, 563).unwrap(), (1000, 562));
    assert_eq!(fit_output_frame(640, 360).unwrap(), (640, 360));
    assert!(fit_output_frame(0, 0).is_err());
}

/// Prueba real del recorte de imagen: infiere, importa el PNG al proyecto y
/// conserva el alfa y la procedencia local.
#[test]
fn live_image_cutout_imports_a_transparent_asset() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el recorte de imagen real");
        return;
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let ffprobe = manifest.join("resources/ffmpeg/ffprobe.exe");
    let model = fixture_model();
    let runtime = manifest.join("resources/onnxruntime/onnxruntime.dll");
    if !ffprobe.is_file() || !model.is_file() || !runtime.is_file() {
        eprintln!("faltan binarios del recorte; se omite la prueba real");
        return;
    }
    std::env::set_var("ORT_DYLIB_PATH", &runtime);

    let root = std::env::temp_dir().join(format!("olyvia-imagen-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("media")).expect("carpeta media");
    let input = root.join("media/entrada.png");
    let mut source = RgbaImage::from_pixel(640, 360, Rgba([20, 24, 32, 255]));
    for y in 120..280 {
        for x in 220..420 {
            source.put_pixel(x, y, Rgba([235, 238, 245, 255]));
        }
    }
    source.save(&input).expect("imagen de entrada");

    let asset =
        remove_image_background(&root, &input, &ffprobe, &model, 30, 1).expect("recorte de imagen");
    let relative = asset["source"]["path"].as_str().expect("ruta del recorte");
    let output = root.join(relative);
    assert!(output.is_file(), "no se copió el recorte: {relative}");
    assert_eq!(asset["kind"], "image");
    assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");
    let decoded = image::open(&output).expect("leer el recorte").to_rgba8();
    let min = decoded
        .pixels()
        .map(|pixel| pixel.0[3])
        .min()
        .unwrap_or(255);
    let max = decoded.pixels().map(|pixel| pixel.0[3]).max().unwrap_or(0);
    assert!(
        max.saturating_sub(min) > 16,
        "el PNG importado no conservó el alfa: min={min} max={max}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Prueba real del pipeline de video: genera un clip sintético, lo procesa
/// frame por frame, importa el WebM con alfa y verifica que el fondo y el
/// sujeto tengan alfa distinta. Detrás de `EDITOR_IA_RUN_RENDER_TESTS`.
#[test]
fn live_video_cutout_keeps_duration_and_alpha() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el recorte de video real");
        return;
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let ffmpeg = manifest.join("resources/ffmpeg/ffmpeg.exe");
    let ffprobe = manifest.join("resources/ffmpeg/ffprobe.exe");
    let model = fixture_model();
    let runtime = manifest.join("resources/onnxruntime/onnxruntime.dll");
    if !ffmpeg.is_file() || !ffprobe.is_file() || !model.is_file() || !runtime.is_file() {
        eprintln!("faltan binarios del recorte; se omite la prueba real");
        return;
    }
    std::env::set_var("ORT_DYLIB_PATH", &runtime);

    let root = std::env::temp_dir().join(format!("olyvia-recorte-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("media")).expect("carpeta media");
    let input = root.join("media/entrada.mp4");
    let mut source = Command::new(&ffmpeg);
    source
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x141821:s=640x360:d=0.5:r=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=0.2",
            "-vf",
            "drawbox=x=220:y=80:w=200:h=200:color=white@1:t=fill",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-t",
            "0.5",
            "-y",
        ])
        .arg(&input);
    hide_console(&mut source);
    assert!(source.status().expect("ffmpeg de entrada").success());

    let asset = remove_video_background(
        &root,
        &input,
        &ffmpeg,
        &ffprobe,
        &model,
        0,
        15,
        30,
        1,
        |_| {},
    )
    .expect("recorte de video");
    let relative = asset["source"]["path"].as_str().expect("ruta del recorte");
    let output = root.join(relative);
    assert!(output.is_file(), "no se copió el recorte: {relative}");
    let frames = asset["media"]["durationFrames"].as_u64().expect("duración");
    assert_eq!(frames, 15, "duración declarada inesperada: {frames}");
    let real_frames = count_video_frames(&ffprobe, &output).expect("contar los frames reales");
    assert_eq!(
        real_frames, 15,
        "el archivo no tiene los 15 frames declarados"
    );
    assert_eq!(asset["kind"], "video");
    assert_eq!(asset["rights"]["provenance"]["origin"], "generated-locally");

    let mut decode = Command::new(&ffmpeg);
    decode
        .args(["-hide_banner", "-v", "error", "-c:v", "libvpx-vp9", "-i"])
        .arg(&output)
        .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut decode);
    let frame = decode.output().expect("decodificar el recorte").stdout;
    let width = asset["media"]["width"].as_u64().expect("ancho") as usize;
    let height = asset["media"]["height"].as_u64().expect("alto") as usize;
    assert_eq!(frame.len(), width * height * 4, "frame RGBA incompleto");
    let alpha_at = |x: usize, y: usize| frame[(y * width + x) * 4 + 3];
    let corner = alpha_at(4, 4);
    let center = alpha_at(width / 2, height / 2);
    assert!(
        corner.abs_diff(center) > 64,
        "el alfa no distingue fondo y sujeto: corner={corner} center={center}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

/// Prueba real de inferencia: el modelo del fixture procesa una imagen
/// sintética y la máscara tiene variación (distingue algo). Detrás de
/// `EDITOR_IA_RUN_RENDER_TESTS` como las pruebas que necesitan binarios.
#[test]
fn live_u2netp_produces_a_variance_mask() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite la inferencia real");
        return;
    }
    let model = fixture_model();
    assert!(model.is_file(), "falta el fixture del modelo u2netp");
    std::env::set_var(
        "ORT_DYLIB_PATH",
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/onnxruntime/onnxruntime.dll"),
    );

    // Sujeto claro sobre fondo oscuro: lo mínimo para que haya saliencia.
    let mut image = RgbaImage::from_pixel(640, 360, Rgba([20, 24, 32, 255]));
    for y in 120..280 {
        for x in 220..420 {
            image.put_pixel(x, y, Rgba([235, 238, 245, 255]));
        }
    }
    let dynamic = DynamicImage::ImageRgba8(image);

    let mask = run_u2netp(&model, &dynamic).expect("inferencia");
    assert_eq!(mask.width(), 640);
    assert_eq!(mask.height(), 360);

    let min = mask.pixels().map(|p| p.0[0]).min().expect("máscara vacía");
    let max = mask.pixels().map(|p| p.0[0]).max().expect("máscara vacía");
    assert!(
        max.saturating_sub(min) > 16,
        "la máscara no distingue nada: min={min} max={max}"
    );
}
