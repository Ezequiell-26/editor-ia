use super::*;

#[test]
fn engine_urls_are_loopback_and_get_the_right_path() {
    assert_eq!(
        local_engine_url("http://127.0.0.1:8020", CloneEngine::Xtts).expect("xtts"),
        "http://127.0.0.1:8020/tts_to_audio/"
    );
    assert_eq!(
        local_engine_url("http://localhost:9880/tts", CloneEngine::GptSovits).expect("sovits"),
        "http://localhost:9880/tts"
    );
    assert!(local_engine_url("https://api.example.com", CloneEngine::Xtts).is_err());
    assert!(local_engine_url("http://user:pass@127.0.0.1:8020", CloneEngine::Xtts).is_err());
    assert!(local_engine_url("ftp://127.0.0.1", CloneEngine::Xtts).is_err());
    assert!(local_engine_url("http://127.0.0.1:8020?x=1", CloneEngine::Xtts).is_err());
}

#[test]
fn languages_and_text_are_bounded() {
    assert_eq!(normalize_language("es-AR").expect("es"), "es");
    assert_eq!(normalize_language("ZH-cn").expect("zh"), "zh");
    assert!(normalize_language("xx").is_err());
    assert!(validate_text("  ").is_err());
    assert!(validate_text(&"a".repeat(MAX_TEXT_CHARS + 1)).is_err());
    assert_eq!(
        validate_text("  Hola\nmundo  ").expect("texto"),
        "Hola mundo"
    );
}

#[test]
fn recognizes_a_riff_wav_without_trusting_the_header_alone() {
    let wav = b"RIFF\x24\x00\x00\x00WAVEfmt ";
    assert!(is_wav(wav));
    assert!(!is_wav(b"RIFF\x24\x00\x00\x00AVI "));
    assert!(!is_wav(b"<html></html>"));
}

#[test]
fn engine_parser_defaults_to_xtts() {
    assert_eq!(CloneEngine::parse(None), CloneEngine::Xtts);
    assert_eq!(
        CloneEngine::parse(Some("gpt-sovits")),
        CloneEngine::GptSovits
    );
    assert_eq!(CloneEngine::parse(Some("otro")), CloneEngine::Xtts);
    assert_eq!(CloneEngine::Xtts.name(), "xtts");
    assert_eq!(CloneEngine::GptSovits.name(), "gpt-sovits");
}
