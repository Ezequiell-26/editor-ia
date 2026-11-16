use super::*;

#[test]
fn loopback_endpoint_is_enforced() {
    assert!(loopback_endpoint("http://127.0.0.1:8000/lipsync").is_ok());
    assert!(loopback_endpoint("http://localhost:8000/lipsync").is_ok());
    assert!(loopback_endpoint("https://example.com/lipsync").is_err());
    assert!(loopback_endpoint("http://user:pass@127.0.0.1:8000").is_err());
    assert!(loopback_endpoint("http://127.0.0.1:8000/lipsync?x=1").is_err());
}

#[test]
fn mp4_signature_is_checked() {
    assert!(is_mp4(b"\x00\x00\x00\x20ftypisom"));
    assert!(is_mp4(b"\x00\x00\x00\x08free\x00\x00\x00\x20ftypisom"));
    assert!(!is_mp4(b"<html>no</html>"));
    assert!(!is_mp4(b"RIFF0000WAVE"));
}

#[test]
fn durations_are_bounded() {
    assert!(validate_audio_duration(0.0).is_err());
    assert!(validate_audio_duration(901.0).is_err());
    assert!(validate_audio_duration(12.5).is_ok());
    assert!(validate_output_probe(0, 1080, 10.0).is_err());
    assert!(validate_output_probe(1920, 1080, 901.0).is_err());
    assert!(validate_output_probe(1920, 1080, 10.0).is_ok());
}

#[test]
fn output_path_is_unique_and_sanitized() {
    let dir = std::env::temp_dir().join(format!("lipsync-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let video = dir.join("Mi Video!!.mp4");
    let first = lipsync_output_path(&dir, &video);
    assert_eq!(first.file_name().unwrap(), "mi-video-lipsync.mp4");
    std::fs::write(&first, b"x").unwrap();
    let second = lipsync_output_path(&dir, &video);
    assert_eq!(second.file_name().unwrap(), "mi-video-lipsync-2.mp4");
    let _ = std::fs::remove_dir_all(&dir);
}
