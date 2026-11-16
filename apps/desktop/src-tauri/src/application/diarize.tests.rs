use super::*;

#[test]
fn parses_deepgram_utterances() {
    let value: Value = serde_json::from_str(
        r#"{"results":{"utterances":[
            {"speaker":0,"start":0.1,"end":2.4,"transcript":"Hola"},
            {"speaker":1,"start":2.4,"end":5.0,"transcript":"Qué tal"}
        ]}}"#,
    )
    .unwrap();
    let segments = parse_deepgram(&value);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].speaker, "0");
    assert!((segments[1].end - 5.0).abs() < 1e-9);
}

#[test]
fn parses_assemblyai_utterances_in_seconds() {
    let value: Value = serde_json::from_str(
        r#"{"utterances":[
            {"speaker":"A","start":100,"end":2400,"text":"Hola"},
            {"speaker":"B","start":2400,"end":5000,"text":"Qué tal"}
        ]}"#,
    )
    .unwrap();
    let segments = parse_assemblyai(&value);
    assert_eq!(segments.len(), 2);
    assert!((segments[0].start - 0.1).abs() < 1e-9);
    assert_eq!(segments[1].speaker, "B");
}

#[test]
fn ignores_empty_or_inverted_segments() {
    let value: Value = serde_json::from_str(
        r#"{"results":{"utterances":[
            {"speaker":0,"start":2.0,"end":1.0,"transcript":"mal"},
            {"speaker":0,"start":0.0,"end":1.0,"transcript":"  "}
        ]}}"#,
    )
    .unwrap();
    assert!(parse_deepgram(&value).is_empty());
}

#[test]
fn normalize_config_maps_kind_and_defaults() {
    let config = normalize_diarize_config("deepgram", "https://api.deepgram.com/", "  ").unwrap();
    assert_eq!(config.kind, "deepgram");
    assert_eq!(config.base_url, "https://api.deepgram.com");
    assert_eq!(config.language, "es");

    // Cualquier kind desconocido cae a "none"; esquemas raros se rechazan.
    assert_eq!(
        normalize_diarize_config("raro", "", "en").unwrap().kind,
        "none"
    );
    assert!(normalize_diarize_config("deepgram", "ftp://x", "es").is_err());
    assert!(normalize_diarize_config("deepgram", "javascript:x", "es").is_err());
}

#[test]
fn base_url_requires_https_for_remote_and_allows_http_only_on_loopback() {
    // Remoto por http: la clave y el audio viajarían en claro.
    assert!(normalize_diarize_config("deepgram", "http://api.evil.example", "es").is_err());
    // Hosts con prefijo parecido no son loopback.
    assert!(normalize_diarize_config("deepgram", "http://127.0.0.1.evil.example", "es").is_err());
    // Credenciales embebidas en la URL se rechazan.
    assert!(
        normalize_diarize_config("deepgram", "https://user:pass@api.deepgram.com", "es").is_err()
    );
    // Loopback exacto sí admite http (motor local de diarización).
    assert!(normalize_diarize_config("deepgram", "http://127.0.0.1:8080", "es").is_ok());
    assert!(normalize_diarize_config("deepgram", "http://localhost:9000/", "es").is_ok());
    // Remoto por https sigue válido.
    assert!(normalize_diarize_config("deepgram", "https://api.deepgram.com", "es").is_ok());
}

#[test]
fn api_key_requires_minimum_length() {
    assert!(validate_api_key("1234567").is_err());
    assert!(validate_api_key("12345678").is_ok());
    assert!(validate_api_key("   ").is_err());
}
