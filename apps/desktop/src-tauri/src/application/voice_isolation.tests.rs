use super::*;

#[test]
fn isolation_stem_path_is_deterministic() {
    let root = Path::new("D:\\proyecto");
    let stem = isolation_stem_path(root, "asset-123");
    assert!(stem.ends_with("media\\isolation\\asset-123\\vocals.wav"));
}

#[test]
fn validate_quality_rejects_unknown() {
    assert!(validate_quality(Some("ultra")).is_err());
    assert_eq!(validate_quality(None).unwrap(), "medium");
    assert_eq!(validate_quality(Some("best")).unwrap(), "best");
}

#[test]
fn validate_model_accepts_demucs_names() {
    assert_eq!(validate_model(None).unwrap(), "htdemucs");
    assert!(validate_model(Some("htdemucs_ft")).is_ok());
    assert!(validate_model(Some("mdx_extra")).is_ok());
    assert!(validate_model(Some("../etc")).is_err());
    assert!(validate_model(Some("model with spaces")).is_err());
}

#[test]
fn cached_outcome_requires_marker_match() {
    let dir = std::env::temp_dir().join(format!("editoria-isolation-{}", uuid::Uuid::new_v4()));
    let asset_dir = dir.join("media").join("isolation").join("asset-1");
    std::fs::create_dir_all(&asset_dir).expect("dirs");
    let source = dir.join("fuente.wav");
    std::fs::write(&source, b"RIFF-fuente").expect("source");
    let vocals = asset_dir.join("vocals.wav");
    let accompaniment = asset_dir.join("accompaniment.wav");
    std::fs::write(&vocals, vec![0u8; 100]).expect("vocals");
    std::fs::write(&accompaniment, vec![0u8; 100]).expect("accompaniment");

    // Sin marcador: no hay caché válida.
    assert!(cached_outcome(&dir, "asset-1", &source, "medium", "htdemucs").is_none());

    let outcome = VoiceIsolationOutcome {
        vocals_path: vocals.clone(),
        accompaniment_path: Some(accompaniment),
        duration_seconds: 12.5,
        sample_rate: 44_100,
        channels: 2,
        processing_time_ms: 0,
        cached: false,
    };
    write_marker(&dir, "asset-1", &source, "medium", "htdemucs", &outcome);

    let cached =
        cached_outcome(&dir, "asset-1", &source, "medium", "htdemucs").expect("stem cacheado");
    assert!(cached.cached);
    assert_eq!(cached.duration_seconds, 12.5);

    // Otra calidad u otro modelo invalidan el caché.
    assert!(cached_outcome(&dir, "asset-1", &source, "high", "htdemucs").is_none());
    assert!(cached_outcome(&dir, "asset-1", &source, "medium", "mdx_extra").is_none());

    let _ = std::fs::remove_dir_all(&dir);
}
