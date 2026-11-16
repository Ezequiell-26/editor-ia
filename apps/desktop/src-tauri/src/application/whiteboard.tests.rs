use super::*;

#[test]
fn quality_defaults_to_medium_and_accepts_the_three_presets() {
    assert_eq!(validate_quality(None).unwrap(), "medium");
    assert_eq!(validate_quality(Some("low")).unwrap(), "low");
    assert_eq!(validate_quality(Some("high")).unwrap(), "high");
    assert!(validate_quality(Some("ultra")).is_err());
    assert!(validate_quality(Some("")).is_err());
}

#[test]
fn duration_defaults_to_eight_seconds() {
    assert_eq!(validate_duration(None).unwrap(), 8.0);
}

#[test]
fn duration_rejects_non_finite_and_non_positive_values() {
    for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(validate_duration(Some(bad)).is_err(), "{bad} debería fallar");
    }
}

#[test]
fn duration_caps_at_one_hour() {
    assert!(validate_duration(Some(3600.0)).is_ok());
    assert!(validate_duration(Some(3600.1)).is_err());
    assert!(validate_duration(Some(7200.0)).is_err());
}
