use super::*;

fn list(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[test]
fn prefers_libx264_when_the_build_has_it() {
    assert_eq!(
        choose_encoder(&list(&["libx264", "h264_mf"]), "h264"),
        "libx264"
    );
}

#[test]
fn falls_back_to_media_foundation_without_libx264() {
    let available = list(&["h264_mf", "libopenh264", "h264_nvenc"]);
    assert_eq!(choose_encoder(&available, "h264"), "h264_mf");
}

#[test]
fn uses_openh264_when_it_is_the_only_one() {
    assert_eq!(
        choose_encoder(&list(&["libopenh264"]), "h264"),
        "libopenh264"
    );
}

#[test]
fn keeps_the_historical_default_when_probing_fails() {
    assert_eq!(choose_encoder(&[], "h264"), "libx264");
    assert_eq!(choose_encoder(&[], "h265"), "libx265");
}

#[test]
fn picks_hevc_alternatives_for_h265() {
    assert_eq!(
        choose_encoder(&list(&["hevc_mf", "hevc_nvenc"]), "h265"),
        "hevc_mf"
    );
}
