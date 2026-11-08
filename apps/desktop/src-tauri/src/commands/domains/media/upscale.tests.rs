use super::*;
use image::{Rgba, RgbaImage};

fn fixture_model() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/realesrgan/real_esrgan_x4plus.onnx")
}

/// Prueba real: el modelo del fixture agranda una tesela 128×128 a
/// 512×512 con variación de contenido. Detrás de
/// `EDITOR_IA_RUN_RENDER_TESTS` como las pruebas que necesitan binarios.
#[test]
fn live_realesrgan_upscales_a_tile() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("sin EDITOR_IA_RUN_RENDER_TESTS; se omite el upscale real");
        return;
    }
    let model = fixture_model();
    assert!(model.is_file(), "falta el fixture del modelo Real-ESRGAN");
    std::env::set_var(
        "ORT_DYLIB_PATH",
        Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/onnxruntime/onnxruntime.dll"),
    );

    // Una imagen con un cuadrado claro: el upscale debe preservar la
    // estructura (variación de brillo en la salida).
    let mut image = RgbaImage::from_pixel(128, 128, Rgba([30, 30, 40, 255]));
    for y in 32..96 {
        for x in 32..96 {
            image.put_pixel(x, y, Rgba([220, 224, 235, 255]));
        }
    }
    let dynamic = DynamicImage::ImageRgba8(image);

    let output = run_realesrgan(&model, &dynamic).expect("upscale");
    assert_eq!(output.width(), 512);
    assert_eq!(output.height(), 512);

    let min = output.pixels().map(|p| p.0[0]).min().expect("salida vacía");
    let max = output.pixels().map(|p| p.0[0]).max().expect("salida vacía");
    assert!(
        max.saturating_sub(min) > 32,
        "el upscale aplastó el contenido: min={min} max={max}"
    );
}
