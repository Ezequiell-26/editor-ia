use super::*;

#[test]
fn filter_fills_and_center_crops_the_vertical_canvas() {
    let filter = vertical_short_filter();
    assert!(filter.contains("scale=1080:1920"));
    assert!(filter.contains("force_original_aspect_ratio=increase"));
    assert!(filter.contains("crop=1080:1920"));
    assert!(filter.contains("setsar=1"));
}

#[test]
fn range_is_bounded_between_three_and_ninety_seconds() {
    assert!(validate_short_range(0.0, 30.0).is_ok());
    assert!(validate_short_range(10.0, 13.0).is_ok());
    assert!(validate_short_range(-1.0, 30.0).is_err());
    assert!(validate_short_range(10.0, 5.0).is_err());
    assert!(validate_short_range(0.0, 120.0).is_err());
    assert!(validate_short_range(f64::NAN, 30.0).is_err());
}

#[test]
fn face_range_accepts_short_and_long_clips() {
    assert!(validate_face_range(0.0, 1.0).is_ok());
    assert!(validate_face_range(10.0, 250.0).is_ok());
    assert!(validate_face_range(0.0, 0.05).is_err());
    assert!(validate_face_range(0.0, 601.0).is_err());
    assert!(validate_face_range(-1.0, 10.0).is_err());
}

#[test]
#[ignore = "requiere SEETA_MODEL y FACE_VIDEO para verificar con un video real"]
fn detects_faces_in_a_moving_video() {
    let model = std::env::var("SEETA_MODEL").expect("SEETA_MODEL");
    let video = std::env::var("FACE_VIDEO").expect("FACE_VIDEO");
    let samples = extract_face_samples(
        None,
        Path::new("ffmpeg"),
        Path::new(&model),
        Path::new(&video),
        0.0,
        4.0,
    )
    .expect("muestras");
    assert!(samples.len() >= 3, "muestras: {}", samples.len());
    assert!(samples.iter().any(|sample| sample.center_x < 0.4));
    assert!(samples.iter().any(|sample| sample.center_x > 0.6));
    let track = face::smooth_track(&samples);
    let (width, height) = face::scaled_cover(1280, 720);
    let expression = face::crop_expression(
        &track,
        f64::from(width),
        f64::from(height),
        1080.0,
        1920.0,
        'x',
    );
    println!(
        "rostros: {}, track: {}, x: {}",
        samples.len(),
        track.len(),
        expression
    );
    assert!(expression.contains("if(lt(t,"));
}

#[test]
fn names_are_safe_and_never_overwrite() {
    assert_eq!(
        safe_stem("Mi Short: ñandú / 2026", "x"),
        "mi-short-nandu-2026"
    );
    assert_eq!(safe_stem("...", "video"), "video");
    let dir = std::env::temp_dir().join(format!("editoria-short-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("carpeta");
    let first = unique_path(&dir, "demo");
    std::fs::write(&first, b"x").expect("archivo");
    let second = unique_path(&dir, "demo");
    assert_ne!(first, second);
    assert!(second.to_string_lossy().contains("demo-vertical-2.mp4"));
    let _ = std::fs::remove_dir_all(&dir);
}
