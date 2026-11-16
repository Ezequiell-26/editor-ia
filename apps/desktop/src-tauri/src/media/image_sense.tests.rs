use super::*;
use image::DynamicImage;

fn solid(r: u8, g: u8, b: u8, size: u32) -> RgbImage {
    RgbImage::from_pixel(size, size, image::Rgb([r, g, b]))
}

#[test]
fn hsv_reports_expected_primaries() {
    assert!((rgb_to_hsv(255, 0, 0).0 - 0.0).abs() < 0.01);
    assert!((rgb_to_hsv(0, 255, 0).0 - 120.0).abs() < 0.01);
    assert!((rgb_to_hsv(0, 0, 255).0 - 240.0).abs() < 0.01);
    let (_, saturation, value) = rgb_to_hsv(128, 128, 128);
    assert!(saturation < 0.01);
    assert!((value - 0.502).abs() < 0.01);
}

#[test]
fn flat_image_has_no_edges_and_no_sharpness() {
    let image = solid(120, 120, 120, 32);
    let gray = DynamicImage::ImageRgb8(image).to_luma8();
    assert!(edge_density_of(&gray) < 0.01);
    assert!(sharpness_of(&gray) < 0.01);
}

#[test]
fn checkerboard_has_high_edge_density() {
    let mut image = RgbImage::new(32, 32);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let value = if (x / 4 + y / 4) % 2 == 0 { 0 } else { 255 };
        *pixel = image::Rgb([value, value, value]);
    }
    let gray = DynamicImage::ImageRgb8(image).to_luma8();
    assert!(edge_density_of(&gray) > 0.5);
    assert!(sharpness_of(&gray) > 0.1);
}

#[test]
fn sky_bias_is_positive_when_top_is_brighter() {
    let mut image = RgbImage::new(40, 40);
    for (_, y, pixel) in image.enumerate_pixels_mut() {
        let value = if y < 10 { 240 } else { 30 };
        *pixel = image::Rgb([value, value, value]);
    }
    let gray = DynamicImage::ImageRgb8(image).to_luma8();
    assert!(sky_bias_of(&gray) > 0.5);
}

#[test]
fn warm_and_cool_temperature() {
    assert_eq!(temperature_of(30.0, 0.9, 0.2), "warm");
    assert_eq!(temperature_of(210.0, 0.9, -0.2), "cool");
    assert_eq!(temperature_of(120.0, 0.9, 0.0), "neutral");
    // Con poca concentración manda el sesgo rojo–azul.
    assert_eq!(temperature_of(120.0, 0.1, 0.2), "warm");
}

#[test]
fn orientation_thresholds() {
    assert_eq!(orientation_of(1920, 1080), "landscape");
    assert_eq!(orientation_of(1080, 1920), "portrait");
    assert_eq!(orientation_of(1000, 1000), "square");
}

#[test]
fn palette_returns_hex_colors() {
    let image = solid(200, 40, 40, 16);
    let palette = palette_of(&image);
    assert_eq!(palette.len(), 1);
    assert_eq!(palette[0], "#c82828");
}
