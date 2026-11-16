use super::*;
use crate::application::downloads::DownloadRequest;

fn request() -> DownloadRequest {
    DownloadRequest {
        url: "https://www.youtube.com/watch?v=abc123".to_owned(),
        run_id: None,
        max_height: None,
        compression: None,
        codec: None,
        hdr_mode: None,
        target_size_mb: None,
        keep_original: None,
        kind: None,
        playlist: None,
        cookies_file: None,
        cookies_from_browser: None,
        format: None,
        save_to_downloads: None,
        quality: None,
        destination_root: None,
        cinematic: None,
        cinematic_focus: None,
        replacement_audio: None,
        auto_pipeline: None,
        audio_speed_noise: None,
        voice_pipeline: None,
        voice_script: None,
        watermark: None,
        delogo: None,
        delogo_corner: None,
        delogo_rect: None,
        upscale: None,
        upscale_target: None,
        auto_route: None,
        source_title: None,
        source_duration: None,
        proxy: None,
        limit_rate: None,
        download_subtitles: None,
        subtitle_langs: None,
        download_thumbnail: None,
        download_chapters: None,
        sponsorblock: None,
        sponsorblock_categories: None,
        sponsorblock_mark: None,
        sponsorblock_mute: None,
        filename_template: None,
        playlist_items: None,
        audio_language: None,
        audio_format_id: None,
        metadata_title: None,
        metadata_artist: None,
        metadata_comment: None,
        cover_path: None,
        hash_files: None,
        expected_sha256: None,
        trim_start: None,
        trim_end: None,
        estimated_bytes: None,
    }
}

#[test]
fn defaults_normalize_to_mp4_video_without_compression() {
    let plan = normalize_download_request(&request()).unwrap();
    assert_eq!(plan.kind, "video");
    assert_eq!(plan.format, "mp4");
    assert_eq!(plan.codec, "h265");
    assert_eq!(plan.quality, "best");
    assert!(plan.compression_allowed);
    assert!(!plan.should_compress);
    assert!(!plan.cinematic);
    assert!(!plan.voice_enabled);
    assert_eq!(plan.max_height, MAX_HEIGHT);
}

#[test]
fn compression_levels_map_to_crf_only_when_allowed() {
    let mut req = request();
    req.compression = Some("compact".to_owned());
    let plan = normalize_download_request(&req).unwrap();
    assert_eq!(plan.requested_crf, Some(27));
    assert_eq!(plan.crf, Some(27));
    assert!(plan.should_compress);

    // mp3 es audio-only: la compresión no aplica y el request se rechaza.
    req.format = Some("mp3".to_owned());
    assert!(normalize_download_request(&req).is_err());
}

#[test]
fn invalid_kind_codec_hdr_and_format_are_rejected() {
    for mutate in [
        (|r: &mut DownloadRequest| r.kind = Some("doc".to_owned())) as fn(&mut DownloadRequest),
        |r| r.codec = Some("vp9".to_owned()),
        |r| r.hdr_mode = Some("wild".to_owned()),
        |r| r.format = Some("avi".to_owned()),
        |r| r.quality = Some("huge".to_owned()),
    ] {
        let mut req = request();
        mutate(&mut req);
        assert!(normalize_download_request(&req).is_err());
    }
}

#[test]
fn proxy_and_rate_limit_are_validated() {
    let mut req = request();
    req.proxy = Some("ftp://nope".to_owned());
    assert!(normalize_download_request(&req).is_err());
    req.proxy = Some("socks5://127.0.0.1:1080".to_owned());
    req.limit_rate = Some("8M".to_owned());
    let plan = normalize_download_request(&req).unwrap();
    assert_eq!(plan.proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
    assert_eq!(plan.limit_rate.as_deref(), Some("8M"));

    req.limit_rate = Some("rápido".to_owned());
    assert!(normalize_download_request(&req).is_err());
}

#[test]
fn auto_route_short_video_disables_voice_but_keeps_original_audio() {
    let mut req = request();
    req.auto_route = Some(true);
    req.source_duration = Some(30.0);
    req.source_title = Some("clip familiar".to_owned());
    let plan = normalize_download_request(&req).unwrap();
    assert!(plan.auto_route);
    assert!(!plan.long_video);
    assert!(!plan.voice_enabled);
    // El video corto no musical masteriza el audio original.
    assert!(!plan.audio_speed_noise);

    // El mismo pedido en video largo sí acelera y mezcla ruido.
    req.source_duration = Some(600.0);
    let plan = normalize_download_request(&req).unwrap();
    assert!(plan.long_video);
    assert!(plan.audio_speed_noise);
}

#[test]
fn explicit_voice_requires_a_script() {
    let mut req = request();
    req.voice_pipeline = Some(true);
    assert!(normalize_download_request(&req).is_err());
    req.voice_script = Some("  guion  ".to_owned());
    let plan = normalize_download_request(&req).unwrap();
    assert!(plan.voice_enabled);
    assert!(plan.cinematic || plan.auto_pipeline);
}

#[test]
fn delogo_and_upscale_are_video_only() {
    let mut req = request();
    req.kind = Some("audio".to_owned());
    req.delogo = Some(true);
    assert!(normalize_download_request(&req).is_err());

    req.kind = None;
    req.delogo = Some(true);
    req.delogo_corner = Some("inferior-derecha".to_owned());
    let plan = normalize_download_request(&req).unwrap();
    assert!(plan.cinematic);
    assert_eq!(plan.delogo_corner, Some("bottom-right"));
}
