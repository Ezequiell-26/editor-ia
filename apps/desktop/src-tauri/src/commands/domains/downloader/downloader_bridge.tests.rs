use super::*;

#[test]
fn tokens_are_compared_without_early_exit() {
    assert!(token_matches("abc123", "abc123"));
    assert!(!token_matches("abc124", "abc123"));
    assert!(!token_matches("abc", "abc123"));
}

#[test]
fn legacy_token_file_is_validated_before_migration() {
    let valid = generate_bridge_token();
    assert_eq!(
        parse_legacy_bridge_token(&valid).as_deref(),
        Some(valid.as_str())
    );
    assert_eq!(
        parse_legacy_bridge_token(&format!("  {valid}\n")).as_deref(),
        Some(valid.as_str())
    );
    // Corto, con no-hex o vacío → no se adopta (se genera uno nuevo).
    assert!(parse_legacy_bridge_token("abc123").is_none());
    assert!(parse_legacy_bridge_token(&"z".repeat(64)).is_none());
    assert!(parse_legacy_bridge_token("").is_none());
    assert!(parse_legacy_bridge_token(&"a".repeat(31)).is_none());
}

#[test]
fn destinations_do_not_overwrite_existing_files() {
    let directory = std::env::temp_dir().join(format!("editor-ia-bridge-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("video.mp4"), b"old").unwrap();
    let destination = unique_destination(&directory, "video.mp4");
    assert_eq!(
        destination.file_name().unwrap().to_string_lossy(),
        "video (2).mp4"
    );
    let _ = std::fs::remove_dir_all(&directory);
}

#[test]
fn unsafe_file_names_are_sanitized() {
    let directory = std::env::temp_dir().join(format!("editor-ia-bridge-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory).unwrap();
    let destination = unique_destination(&directory, "a:b?c*d.mp4");
    assert_eq!(
        destination.file_name().unwrap().to_string_lossy(),
        "a_b_c_d.mp4"
    );
    let _ = std::fs::remove_dir_all(&directory);
}

#[test]
fn http_head_parses_method_path_and_body_bounds() {
    let raw = b"POST /v1/probe?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 4\r\n\r\nbody";
    let head = parse_http_head(raw).expect("head válido");
    assert_eq!(head.method, "POST");
    assert_eq!(head.path, "/v1/probe");
    assert_eq!(head.headers.get("host").map(String::as_str), Some("127.0.0.1"));
    assert_eq!(head.body_start, raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4);
    assert_eq!(head.content_length, 4);
    // Sin el terminador aún no hay head.
    assert!(parse_http_head(b"GET / HTTP/1.1\r\n").is_none());
    // Content-Length por encima del tope invalida el head.
    let huge = b"POST / HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n";
    assert!(parse_http_head(huge).is_none());
}

#[test]
fn direct_image_probe_builds_synthetic_dto() {
    let probe = direct_image_probe("https://cdn.example.com/foto.png?size=large");
    assert_eq!(probe.kind, "image");
    assert_eq!(probe.title, "foto.png");
    assert_eq!(probe.entry_count, 1);
    assert_eq!(probe.thumbnail.as_deref(), Some("https://cdn.example.com/foto.png?size=large"));
}

#[test]
fn image_file_name_completes_extension_from_content_type() {
    assert_eq!(
        image_file_name("https://x.test/a/b/foto", "image/png"),
        "foto.png"
    );
    assert_eq!(
        image_file_name("https://x.test/foto.webp?x=1", "image/png"),
        "foto.webp"
    );
    assert_eq!(
        image_file_name("https://x.test/", "image/jpeg"),
        "imagen.jpg"
    );
}
