use super::*;

#[test]
fn validates_provider_inputs() {
    assert!(validate_kind("elevenlabs").is_ok());
    assert!(validate_kind("whatever").is_err());
    assert!(validate_voice_id("21m00Tcm4TlvDq8ikWAM").is_ok());
    assert!(validate_voice_id("voice id with spaces").is_err());
    assert!(validate_model_id("eleven_multilingual_v2").is_ok());
    assert!(validate_model_id("bad model!").is_err());
    assert!(validate_external_url("http://example.com").is_err());
    assert!(validate_external_url("https://example.com/tts").is_ok());
    assert!(validate_external_url("https://user:pass@example.com").is_err());
    assert!(validate_text("  hola  ").is_ok());
    assert!(validate_text("   ").is_err());
}

#[test]
fn extracts_bounded_api_errors() {
    let raw = r#"{"detail":{"message":"invalid api key"}}"#;
    assert_eq!(extract_api_error(raw).as_deref(), Some("invalid api key"));
    assert_eq!(extract_api_error("not json"), None);
    let long =
        extract_api_error(&format!(r#"{{"message":"{}"}}"#, "x".repeat(500))).expect("mensaje");
    assert!(long.chars().count() <= 300);
}
