use super::*;

#[test]
fn sanitize_profile_id_rejects_bad_chars() {
    assert!(sanitize_profile_id("perfil-1_ok").is_ok());
    assert!(sanitize_profile_id("perfil con espacios").is_err());
    assert!(sanitize_profile_id("..").is_err());
    assert!(sanitize_profile_id("").is_err());
    assert!(sanitize_profile_id(&"x".repeat(65)).is_err());
    // AUD-025: mayúsculas se normalizan a minúsculas (Windows no distingue).
    assert_eq!(sanitize_profile_id("PerfilA").unwrap(), "perfila");
    assert_eq!(sanitize_profile_id("PERFIL-A_1").unwrap(), "perfil-a_1");
}

#[test]
fn proxy_validation() {
    assert!(validate_proxy("http://127.0.0.1:8080").is_ok());
    assert!(validate_proxy("socks5://10.0.0.2:1080").is_ok());
    assert!(validate_proxy("https://proxy.example.com:443").is_ok());
    assert!(validate_proxy("http://[::1]:3128").is_ok());
    assert!(validate_proxy("ftp://x").is_err());
    assert!(validate_proxy("http://user:pass@host").is_err()); // sin credenciales en args
    assert!(validate_proxy("http://").is_err());
    assert!(validate_proxy("http://host:abc").is_err());
    assert!(validate_proxy("http://host:99999").is_err());
    assert!(validate_proxy("http://host:0").is_err());
    assert!(validate_proxy("socks5://").is_err());
}

#[test]
fn launch_url_requires_http() {
    assert!(validate_web_url("https://example.com").is_ok());
    assert!(validate_web_url("http://example.com/x").is_ok());
    assert!(validate_web_url("file:///C:/Windows/win.ini").is_err());
    assert!(validate_web_url("javascript:alert(1)").is_err());
    assert!(validate_web_url("data:text/html,<h1>x</h1>").is_err());
    assert!(validate_web_url("chrome://settings").is_err());
}
