use super::*;

#[test]
fn fast_filter_scales_with_strength_and_respects_temporal() {
    let soft = denoise_filter(DenoisePreset::Fast, 10, false, false);
    let strong = denoise_filter(DenoisePreset::Fast, 90, false, false);
    let temporal = denoise_filter(DenoisePreset::Fast, 90, true, false);
    // El FFmpeg empaquetado no trae hqdn3d: el espacial es dctdnoiz.
    assert!(soft.starts_with("dctdnoiz=sigma="));
    assert!(strong.starts_with("dctdnoiz=sigma="));
    assert_ne!(soft, strong);
    assert!(temporal.starts_with("atadenoise=s="));
    assert!(!soft.contains("hqdn3d"));
}

#[test]
fn balanced_adds_the_temporal_stage_before_the_spatial_one() {
    let balanced = denoise_filter(DenoisePreset::Balanced, 60, true, false);
    let pos_atadenoise = balanced.find("atadenoise=").expect("etapa temporal");
    let pos_dct = balanced.find("dctdnoiz=").expect("etapa espacial");
    // La limpieza temporal va antes: si no, el dctdnoiz fijaría el ruido.
    assert!(pos_atadenoise < pos_dct);
}

#[test]
fn temporal_window_is_always_an_odd_size_within_range() {
    for strength in [1u8, 25, 50, 75, 100] {
        let filter = denoise_filter(DenoisePreset::Fast, strength, true, false);
        let size = filter
            .split("atadenoise=s=")
            .nth(1)
            .and_then(|rest| rest.split(',').next())
            .and_then(|value| value.parse::<u32>().ok())
            .expect("ventana parseable");
        assert!((3..=9).contains(&size) && size % 2 == 1);
    }
}

#[test]
fn quality_filter_uses_nlmeans_and_preserves_detail_reduces_it() {
    let normal = denoise_filter(DenoisePreset::Quality, 80, false, false);
    let gentle = denoise_filter(DenoisePreset::Quality, 80, false, true);
    assert!(normal.starts_with("nlmeans="));
    assert_ne!(normal, gentle);
}

#[test]
fn invalid_preset_is_rejected() {
    assert!(DenoisePreset::parse(Some("ultra")).is_err());
    assert!(DenoisePreset::parse(Some("fast")).is_ok());
}

#[test]
fn output_names_are_safe_and_unique() {
    let dir = std::env::temp_dir().join(format!("editoria-denoise-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("carpeta temporal");
    let first = unique_output(&dir, "clip: raro/../uno", "mp4");
    assert!(first.to_string_lossy().ends_with("-denoise.mp4"));
    std::fs::write(&first, b"x").expect("archivo de prueba");
    let second = unique_output(&dir, "clip: raro/../uno", "mp4");
    assert_ne!(first, second);
    assert!(second.to_string_lossy().contains("-denoise-2.mp4"));
    let _ = std::fs::remove_dir_all(&dir);
}
