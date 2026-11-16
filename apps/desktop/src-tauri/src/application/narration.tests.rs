use super::*;

#[test]
fn voices_parse_array_object_and_garbage() {
    let array = r#"[{"name":"Microsoft Helena","culture":"es-ES","gender":"Female"}]"#;
    assert_eq!(parse_voices(array).len(), 1);
    let single = r#"{"name":"Microsoft Sabina","culture":"es-MX","gender":"Female"}"#;
    assert_eq!(parse_voices(single)[0].name, "Microsoft Sabina");
    assert!(parse_voices("not json").is_empty());
}

#[test]
fn the_script_never_interpolates_user_text() {
    assert!(TTS_SCRIPT.contains("[Console]::In.ReadToEnd()"));
    assert!(!TTS_SCRIPT.contains("{{"));
    assert!(VOICES_SCRIPT.contains("GetInstalledVoices"));
}

#[test]
fn narration_text_is_bounded() {
    assert!(validate_narration_text("").is_err());
    assert!(validate_narration_text("   ").is_err());
    assert!(validate_narration_text(&"x".repeat(4001)).is_err());
    assert_eq!(validate_narration_text("  hola  ").unwrap(), "hola");
}

#[test]
fn voice_name_prefers_request_then_saved() {
    assert_eq!(
        resolve_voice_name(Some("  Ana "), Some("Beto")).as_deref(),
        Some("Ana")
    );
    assert_eq!(
        resolve_voice_name(None, Some("Beto")).as_deref(),
        Some("Beto")
    );
    assert_eq!(resolve_voice_name(Some("  "), None), None);
}

#[test]
fn elevenlabs_voices_parse_ids_and_labels() {
    let value: Value = serde_json::json!({
        "voices": [
            {"voice_id": "v1", "name": "Laura", "labels": {"language": "es", "gender": "female"}},
            {"voice_id": "", "name": "sin id"},
            {"voice_id": "v2", "name": "John", "labels": {"accent": "en-US"}}
        ]
    });
    let voices = parse_elevenlabs_voices(&value);
    assert_eq!(voices.len(), 2);
    assert_eq!(voices[0].id, "v1");
    assert_eq!(voices[0].culture, "es");
    assert_eq!(voices[1].culture, "en-US");
}
