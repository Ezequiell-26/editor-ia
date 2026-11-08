use super::*;

#[test]
fn rejects_non_http_and_local_urls() {
    assert!(validate_url("file:///C:/secreto.mp4").is_err());
    assert!(validate_url("http://localhost:8080/video").is_err());
    assert!(validate_url("http://127.0.0.1/video").is_err());
    assert!(validate_url("http://192.168.1.10/video").is_err());
    assert!(validate_url("https://www.youtube.com/watch?v=abc").is_ok());
}

#[test]
fn output_template_keeps_windows_paths_short() {
    let template = download_output_template(Path::new("C:/cache"), None).unwrap();
    assert!(template.contains("%(title).60s"));
    assert!(!template.contains("%(title).120s"));
    assert!(template.contains("[%(id)s]"));
    let custom =
        download_output_template(Path::new("C:/cache"), Some("{date}-{title}-{height}")).unwrap();
    assert!(custom.contains("%(upload_date)s"));
    assert!(custom.contains("%(title).60s"));
    assert!(custom.contains("%(height)s"));
    assert!(download_output_template(Path::new("C:/cache"), Some("../escape")).is_err());
    assert!(download_output_template(Path::new("C:/cache"), Some("a/b")).is_err());
}

#[test]
fn playlist_entries_parse_flat_json() {
    let value: Value = serde_json::from_str(
            r#"{"entries":[
                {"id":"abc","title":"Primero","duration":12.5,"playlist_index":1},
                {"id":"def","title":"","playlist_index":2},
                {"id":"ghi","title":"Tercero","webpage_url":"https://example.com/v","playlist_index":3}
            ]}"#,
        )
        .unwrap();
    let entries = parse_playlist_entries(&value, 10);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].index, 1);
    assert_eq!(entries[0].title, "Primero");
    assert_eq!(entries[0].duration_seconds, Some(12.5));
    assert_eq!(
        entries[0].url.as_deref(),
        Some("https://www.youtube.com/watch?v=abc")
    );
    assert_eq!(entries[1].url.as_deref(), Some("https://example.com/v"));
}

#[test]
fn audio_tracks_filter_video_and_sort_by_bitrate() {
    let value: Value = serde_json::from_str(
            r#"{"formats":[
                {"format_id":"140","acodec":"aac","vcodec":"none","abr":129,"ext":"m4a","language":"en","format_note":"medium"},
                {"format_id":"251","acodec":"opus","vcodec":"none","abr":160,"ext":"webm","language":"es"},
                {"format_id":"137","acodec":"none","vcodec":"avc1","abr":null},
                {"format_id":"140","acodec":"aac","vcodec":"none","abr":129}
            ]}"#,
        )
        .unwrap();
    let tracks = parse_audio_tracks(&value);
    assert_eq!(tracks.len(), 2);
    assert_eq!(tracks[0].format_id, "251");
    assert_eq!(tracks[0].language.as_deref(), Some("es"));
    assert!(valid_format_id("140-drc"));
    assert!(!valid_format_id("140; rm"));
}

#[test]
fn audio_language_accepts_iso_and_all() {
    assert_eq!(audio_language(Some("ES")).unwrap().as_deref(), Some("es"));
    assert_eq!(
        audio_language(Some("pt-BR")).unwrap().as_deref(),
        Some("pt-br")
    );
    assert_eq!(audio_language(Some("all")).unwrap().as_deref(), Some("all"));
    assert!(audio_language(Some("es; rm")).is_err());
    assert!(audio_language(Some("english")).is_err());
    assert!(audio_language(None).unwrap().is_none());
}

#[test]
fn playlist_items_validate_ranges_and_lists() {
    assert_eq!(
        playlist_items(Some("1-10")).unwrap().as_deref(),
        Some("1-10")
    );
    assert_eq!(
        playlist_items(Some("1,3,5")).unwrap().as_deref(),
        Some("1,3,5")
    );
    assert!(playlist_items(Some("1; rm -rf")).is_err());
    assert!(playlist_items(None).unwrap().is_none());
}

#[test]
fn hash_file_matches_known_digests() {
    let path = std::env::temp_dir().join(format!("editoria-hash-{}", Uuid::new_v4()));
    std::fs::write(&path, b"abc").unwrap();
    let (md5, sha256) = hash_file(&path);
    assert_eq!(md5.as_deref(), Some("900150983cd24fb0d6963f7d28e17f72"));
    assert_eq!(
        sha256.as_deref(),
        Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    );
    let _ = std::fs::remove_file(path);
}

#[test]
fn validates_a_custom_destination_root() {
    let root = std::env::temp_dir().join(format!("editor-ia-root-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let default = root.join("default");
    assert_eq!(
        resolve_destination_root(Some(root.to_str().unwrap()), default.clone()).unwrap(),
        root
    );
    assert!(resolve_destination_root(Some("relative/folder"), default.clone()).is_err());
    assert!(resolve_destination_root(
        Some(&root.join("missing").to_string_lossy()),
        default.clone()
    )
    .is_err());
    assert_eq!(
        resolve_destination_root(None, default.clone()).unwrap(),
        default
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn builds_a_safe_video_folder_name() {
    let files = vec![DownloadedFile {
        path: "C:\\cache\\video.mp4".to_owned(),
        name: "Mi video_ capítulo 1_2_.mp4".to_owned(),
        bytes: 1,
        kind: "video".to_owned(),
        md5: None,
        sha256: None,
        chapters: Vec::new(),
    }];
    assert_eq!(
        download_folder_name(&files).as_deref(),
        Some("Mi video_ capítulo 1_2_")
    );
    assert_eq!(folder_from_file_name("Qué?.mp4").as_deref(), Some("Qué_"));
    assert_eq!(folder_from_file_name("CON.mp4").as_deref(), Some("_CON"));
    assert_eq!(
        folder_from_file_name("Toma principal - compacto.mp4").as_deref(),
        Some("Toma principal")
    );
    assert_eq!(download_folder_name(&[]), None);
}

#[test]
fn maps_download_urls_to_platform_folders() {
    assert_eq!(
        platform_folder("https://www.youtube.com/watch?v=abc"),
        "YouTube"
    );
    assert_eq!(platform_folder("https://youtu.be/abc"), "YouTube");
    assert_eq!(
        platform_folder("https://www.tiktok.com/@a/video/1"),
        "TikTok"
    );
    assert_eq!(
        platform_folder("https://www.instagram.com/reel/abc"),
        "Instagram"
    );
    assert_eq!(platform_folder("https://x.com/user/status/1"), "X");
    assert_eq!(
        platform_folder("https://www.facebook.com/watch/?v=1"),
        "Facebook"
    );
    assert_eq!(platform_folder("https://vimeo.com/123"), "Vimeo");
    assert_eq!(platform_folder("https://www.twitch.tv/videos/1"), "Twitch");
    assert_eq!(platform_folder("https://example.com/video"), "Otros");
}

#[test]
fn builds_best_worst_and_height_format_selectors() {
    assert_eq!(
        video_format_selector("best", 4_320),
        "bestvideo[height<=4320]+bestaudio/best[height<=4320]/best"
    );
    assert_eq!(
        video_format_selector("worst", 4_320),
        "worstvideo[height>=144]+worstaudio/worst[height>=144]/worst"
    );
    assert_eq!(
        video_format_selector("height", 720),
        "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
    );
}

#[test]
fn video_sort_prefers_resolution_then_codec_and_keeps_audio_lang() {
    assert_eq!(
        video_format_sort(None),
        "res,fps,vcodec,acodec,ext,proto,hasaud"
    );
    // «all» no es un idioma: no debe aparecer como filtro lang.
    assert_eq!(video_format_sort(Some("all")), video_format_sort(None));
    // El idioma va tras vcodec: desempata el audio sin tocar el video.
    assert_eq!(
        video_format_sort(Some("es")),
        "res,fps,vcodec,lang:es,acodec,ext,proto,hasaud"
    );
}

#[test]
fn moves_downloads_to_unique_names_in_destination() {
    let root = std::env::temp_dir().join(format!("editor-ia-move-{}", Uuid::new_v4()));
    let source = root.join("cache");
    let destination = root.join("downloads");
    std::fs::create_dir_all(&source).unwrap();
    std::fs::create_dir_all(&destination).unwrap();
    let original = source.join("video.mp4");
    std::fs::write(&original, b"new video").unwrap();
    std::fs::write(destination.join("video.mp4"), b"existing").unwrap();
    let mut outcome = DownloadOutcome {
        run_id: "run".to_owned(),
        directory: source.to_string_lossy().into_owned(),
        files: vec![DownloadedFile {
            path: original.to_string_lossy().into_owned(),
            name: "video.mp4".to_owned(),
            bytes: 9,
            kind: "video".to_owned(),
            md5: None,
            sha256: None,
            chapters: Vec::new(),
        }],
        compressed: false,
        warnings: Vec::new(),
        subtitles: Vec::new(),
    };
    move_download_to(&mut outcome, &destination).unwrap();
    assert_eq!(outcome.directory, destination.to_string_lossy());
    assert!(destination.join("video (2).mp4").is_file());
    assert!(!original.exists());
    assert_eq!(outcome.files[0].name, "video (2).mp4");
    assert_eq!(outcome.files[0].bytes, 9);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn verifies_engine_checksum_format() {
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let sums = "aaaa  other.zip\nBBBB *yt-dlp.exe\ncccc  yt-dlp\n";
    assert_eq!(expected_engine_hash(sums).as_deref(), Some("bbbb"));
    assert!(expected_engine_hash("nada").is_none());
}

#[test]
fn validates_optional_cookies_file() {
    assert!(validate_cookies_file(None).unwrap().is_none());
    assert!(validate_cookies_file(Some("  ")).unwrap().is_none());
    assert!(validate_cookies_file(Some("C:/no/existe/cookies.txt")).is_err());
    let file = std::env::temp_dir().join(format!("editor-ia-cookies-{}.txt", Uuid::new_v4()));
    std::fs::write(&file, "# Netscape HTTP Cookie File\n").unwrap();
    assert!(validate_cookies_file(Some(&file.to_string_lossy())).is_ok());
    let _ = std::fs::remove_file(&file);
}

#[test]
fn validates_cookie_browsers() {
    assert_eq!(cookies_browser(None).unwrap(), None);
    assert_eq!(
        cookies_browser(Some("Chrome")).unwrap(),
        Some("chrome".to_owned())
    );
    assert_eq!(
        cookies_browser(Some("edge")).unwrap(),
        Some("edge".to_owned())
    );
    assert!(cookies_browser(Some("safari")).is_err());
}

#[test]
fn parses_download_percentages() {
    assert_eq!(
        parse_progress_percent("[download]  42.7% of 1.2GiB"),
        Some(42.7)
    );
    assert_eq!(
        parse_progress_percent("[download]   0.0% of ~ 10MiB"),
        Some(0.0)
    );
    assert_eq!(parse_progress_percent("Destination: video.mp4"), None);
}

#[test]
fn builds_height_options_and_estimates() {
    let formats = serde_json::json!([
        { "format_id": "a", "height": 2160, "width": 3840, "fps": 60, "ext": "mp4", "vcodec": "avc1", "acodec": "none", "tbr": 20000.0 },
        { "format_id": "b", "height": 1080, "width": 1920, "fps": 30, "ext": "webm", "vcodec": "vp9", "acodec": "none", "filesize": 100000000u64 },
        { "format_id": "c", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "filesize": 10000000u64 }
    ]);
    let (qualities, max_height) = qualities_from_formats(formats.as_array().unwrap(), 600.0, true);
    assert_eq!(max_height, Some(2160));
    assert_eq!(qualities.len(), 2);
    assert_eq!(qualities[0].label, "2160p · 4K");
    assert!(qualities[0].filesize.unwrap() > 100_000_000);
    assert_eq!(qualities[1].height, 1080);
}

#[test]
fn gallery_probes_multiple_entries() {
    let value = serde_json::json!({
        "_type": "playlist",
        "title": "Post con fotos",
        "entries": [
            { "ext": "jpg", "vcodec": "none", "acodec": "none", "filesize": 1000u64 },
            { "ext": "jpg", "vcodec": "none", "acodec": "none", "filesize": 2000u64 }
        ]
    });
    let probe = probe_value("https://example.com/post".to_owned(), &value).unwrap();
    assert_eq!(probe.kind, "gallery");
    assert_eq!(probe.entry_count, 2);
    assert_eq!(probe.estimated_bytes, Some(3000));
}

fn live_engine() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA").map(PathBuf::from)?;
    let engine = base
        .join("com.editoria.desktop")
        .join("tools")
        .join("yt-dlp.exe");
    engine.is_file().then_some(engine)
}

#[test]
#[ignore = "requiere red y el motor yt-dlp instalado"]
fn live_probe_and_download_public_video() {
    let Some(engine) = live_engine() else {
        return;
    };
    let probe = probe_with_engine(
        &engine,
        "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
        None,
        None,
    )
    .unwrap();
    assert_eq!(probe.kind, "video");
    assert!(!probe.title.is_empty());
    assert!(!probe.qualities.is_empty());
    let cache = std::env::temp_dir().join(format!("editor-ia-dl-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&cache).unwrap();
    let request = DownloadRequest {
        url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ".to_owned(),
        run_id: None,
        max_height: Some(360),
        compression: Some("compact".to_owned()),
        codec: Some("h264".to_owned()),
        hdr_mode: None,
        target_size_mb: None,
        keep_original: None,
        kind: Some("video".to_owned()),
        playlist: Some(false),
        cookies_file: None,
        cookies_from_browser: None,
        format: Some("mp4".to_owned()),
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
    };
    let progress = |_stage: &str, _percent: Option<f64>, _message: &str| {};
    let outcome = download_blocking(
        &progress,
        &engine,
        &cache,
        request,
        Some(PathBuf::from("ffmpeg")),
        Some(PathBuf::from("ffprobe")),
        None,
        None,
        None,
    )
    .unwrap();
    assert!(!outcome.files.is_empty());
    assert!(outcome
        .files
        .iter()
        .all(|file| Path::new(&file.path).is_file()));
    assert!(outcome.files.iter().all(|file| file.bytes > 0));
    let _ = std::fs::remove_dir_all(&cache);
}

#[test]
fn oversized_galleries_are_refused() {
    let entries = (0..13)
        .map(|_| serde_json::json!({ "ext": "jpg", "vcodec": "none", "acodec": "none" }))
        .collect::<Vec<_>>();
    let value = serde_json::json!({ "_type": "playlist", "title": "Canal", "entries": entries });
    assert!(probe_value("https://example.com/canal".to_owned(), &value).is_err());
}

#[test]
fn cinematic_filter_contains_the_full_recipe() {
    let filter = cinematic_filter("center");
    assert!(filter.contains("setpts=PTS/0.98"));
    assert!(filter.contains("minterpolate=fps=60"));
    assert!(filter.contains("mi_mode=mci"));
    assert!(filter.contains("eq=gamma=0.95:contrast=1.08:saturation=1.12"));
    assert!(filter.contains("scale=trunc(iw*1.04/2)*2"));
    assert!(filter.contains("hflip"));
    assert!(filter.contains("noise=alls=8:allf=t+u"));
    assert!(filter.contains("(iw-ow)*0.5:(ih-oh)*0.5"));
}

#[test]
fn long_video_filter_avoids_optical_flow_and_keeps_geometry() {
    let filter = fast_cinematic_filter("right");
    assert!(filter.contains("fps=60"));
    assert!(!filter.contains("minterpolate"));
    assert!(!filter.contains("noise=alls"));
    assert!(!filter.contains("hqdn3d"));
    assert!(filter.contains("hflip"));
    assert!(filter.contains("(iw-ow)*0.67"));
}

#[test]
fn delogo_rect_scales_to_canvas_and_stays_inside() {
    let hd = delogo_rect(1920, 1080, "top-right").unwrap();
    assert_eq!(
        hd,
        DelogoRect {
            x: 1760,
            y: 20,
            w: 140,
            h: 50
        }
    );
    let small = delogo_rect(320, 180, "top-right").unwrap();
    assert!(small.x + small.w <= 320);
    assert!(small.y + small.h <= 180);
    assert!(small.w >= 16 && small.h >= 16);
    let bottom = delogo_rect(1920, 1080, "bottom-left").unwrap();
    assert_eq!(bottom.x, 20);
    assert_eq!(bottom.y, 1080 - 50 - 20);
    assert!(delogo_rect(100, 50, "top-right").is_none());
}

#[test]
fn manual_delogo_rect_scales_fractions_and_rejects_overflow() {
    let rect = manual_delogo_rect(
        1920,
        1080,
        DelogoManualRect {
            x: 0.10,
            y: 0.20,
            w: 0.25,
            h: 0.10,
        },
    )
    .expect("rect");
    assert_eq!(
        rect,
        DelogoRect {
            x: 192,
            y: 216,
            w: 480,
            h: 108
        }
    );
    assert!(manual_delogo_rect(
        1920,
        1080,
        DelogoManualRect {
            x: 0.9,
            y: 0.9,
            w: 0.2,
            h: 0.2
        }
    )
    .is_none());
}

#[test]
fn delogo_corner_accepts_spanish_and_rejects_unknown() {
    assert_eq!(
        delogo_corner(Some("superior-derecha")).unwrap(),
        "top-right"
    );
    assert_eq!(delogo_corner(Some("bottom_left")).unwrap(), "bottom-left");
    assert!(delogo_corner(Some("diagonal")).is_err());
}

#[test]
fn upscale_only_when_source_is_below_target() {
    assert!(upscale_target(1920, 1080, false, "auto").is_none());
    assert!(upscale_target(3840, 2160, false, "1080").is_none());
    let hd = upscale_target(1280, 720, false, "auto").unwrap();
    assert_eq!((hd.width, hd.height), (1920, 1080));
    let long = upscale_target(1920, 1080, true, "auto").unwrap();
    assert_eq!((long.width, long.height), (3840, 2160));
    let portrait = upscale_target(720, 1280, false, "auto").unwrap();
    assert_eq!((portrait.width, portrait.height), (1080, 1920));
    let explicit = upscale_target(1280, 720, false, "2160").unwrap();
    assert_eq!((explicit.width, explicit.height), (3840, 2160));
}

#[test]
fn pipeline_filter_orders_denoise_delogo_lanczos_and_look() {
    let rect = DelogoRect {
        x: 160,
        y: 20,
        w: 140,
        h: 50,
    };
    let plan = UpscalePlan {
        width: 1920,
        height: 1080,
    };
    let filter = pipeline_filter_with("center", Some(rect), Some(plan));
    let denoise = filter.find("hqdn3d=").unwrap();
    let delogo = filter.find("delogo=x=160:y=20:w=140:h=50").unwrap();
    let lanczos = filter.find("flags=lanczos").unwrap();
    let look = filter.find("eq=gamma=0.95").unwrap();
    assert!(denoise < delogo);
    assert!(delogo < lanczos);
    assert!(lanczos < look);
    assert!(filter.contains("hflip"));
    assert!(filter.contains("noise=alls=8"));
    assert!(filter.contains("pad=1920:1080"));
}

#[test]
fn upscaled_zoom_keeps_exact_target_dimensions() {
    let plan = UpscalePlan {
        width: 1920,
        height: 1080,
    };
    let filter = cinematic_filter_with("center", None, Some(plan));
    assert!(filter.contains("scale=1996:1122"));
    assert!(filter.contains("crop=1920:1080:"));
    let plan4k = UpscalePlan {
        width: 3840,
        height: 2160,
    };
    let filter4k = fast_cinematic_filter_with("center", None, Some(plan4k));
    assert!(filter4k.contains("scale=3992:2246"));
    assert!(filter4k.contains("crop=3840:2160:"));

    let portrait = UpscalePlan {
        width: 1080,
        height: 1920,
    };
    let filter_portrait = cinematic_filter_with("center", None, Some(portrait));
    assert!(filter_portrait.contains("scale=1122:1996"));
    assert!(filter_portrait.contains("crop=1080:1920:"));
}

#[test]
fn fast_filter_keeps_delogo_and_lanczos_without_optical_flow() {
    let rect = DelogoRect {
        x: 0,
        y: 0,
        w: 16,
        h: 16,
    };
    let plan = UpscalePlan {
        width: 3840,
        height: 2160,
    };
    let filter = fast_cinematic_filter_with("right", Some(rect), Some(plan));
    assert!(filter.starts_with("[0:v]hqdn3d="));
    assert!(filter.contains("delogo=x=0:y=0:w=16:h=16"));
    assert!(filter.contains("scale=3840:2160"));
    assert!(filter.find("hqdn3d").unwrap() < filter.find("delogo").unwrap());
    assert!(filter.find("delogo").unwrap() < filter.find("scale=3840").unwrap());
    assert!(!filter.contains("minterpolate"));
    assert!(!filter.contains("noise=alls"));
}

#[test]
fn reads_srt_downloaded_next_to_the_video() {
    let root = std::env::temp_dir().join(format!("editoria-srt-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let srt = root.join("video.es.srt");
    std::fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,000\nHola\n").unwrap();
    let file = DownloadedFile {
        path: srt.to_string_lossy().into_owned(),
        name: "video.es.srt".to_owned(),
        bytes: 40,
        kind: "other".to_owned(),
        md5: None,
        sha256: None,
        chapters: Vec::new(),
    };
    let subtitles = read_download_subtitles(&[file]);
    assert_eq!(subtitles.len(), 1);
    assert!(subtitles[0].text.contains("Hola"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn control_commands_require_an_active_download() {
    assert!(pause_download(None).is_err());
    assert!(resume_download(None).is_err());
    assert!(cancel_download(None).is_err());
}

#[test]
fn parallel_downloads_have_independent_controls() {
    let first = Uuid::new_v4().to_string();
    let second = Uuid::new_v4().to_string();
    let control_a = register_control(&first).unwrap();
    let control_b = register_control(&second).unwrap();
    assert!(!Arc::ptr_eq(&control_a, &control_b));
    assert!(register_control(&first).is_err());
    assert!(control_for(None).is_err());
    assert!(pause_download(Some(first.clone())).unwrap());
    assert!(control_a.is_paused());
    assert!(!control_b.is_paused());
    assert!(resume_download(Some(first.clone())).unwrap());
    assert!(!control_a.is_paused());
    assert!(cancel_download(Some(second.clone())).unwrap());
    assert!(control_b.is_cancelled());
    assert!(!control_a.is_cancelled());
    remove_control(&first);
    remove_control(&second);
    assert!(control_for(Some(first.as_str())).is_err());
}

#[test]
fn measures_free_disk_space_on_windows() {
    if !cfg!(windows) {
        return;
    }
    let free = available_disk_bytes(Path::new("C:\\")).expect("free space");
    assert!(free > 0);
}

#[test]
fn validates_subtitle_languages_and_sponsor_categories() {
    assert_eq!(subtitle_languages(None).unwrap(), "es.*,en.*");
    assert!(subtitle_languages(Some("es.*,en.*")).is_ok());
    assert!(subtitle_languages(Some("es; rm -rf")).is_err());
    assert_eq!(
        sponsorblock_categories(None).unwrap(),
        "sponsor,selfpromo,interaction"
    );
    assert!(sponsorblock_categories(Some("sponsor,intro,outro")).is_ok());
    assert!(sponsorblock_categories(Some("sponsor,unknown")).is_err());
    assert!(sponsorblock_categories(Some(" , ")).is_err());
}

#[test]
fn youtube_ids_are_extracted_from_common_urls() {
    for url in [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
        "https://youtu.be/dQw4w9WgXcQ?si=abc",
        "https://youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "https://m.youtube.com/live/dQw4w9WgXcQ",
    ] {
        assert_eq!(
            youtube_video_id(url).as_deref(),
            Some("dQw4w9WgXcQ"),
            "{url}"
        );
    }
    assert!(youtube_video_id("https://vimeo.com/12345").is_none());
    assert!(youtube_video_id("https://youtube.com/watch?v=short").is_none());
    assert!(youtube_video_id("https://youtube.com/watch?v=bad!chars123").is_none());
}

#[test]
fn sponsor_segments_parse_and_skip_invalid_ranges() {
    let value: Value = serde_json::from_str(
        r#"[
                {"category":"sponsor","actionType":"skip","segment":[12.5,25.0]},
                {"category":"intro","actionType":"skip","segment":[5,5]},
                {"category":"outro","actionType":"mute","segment":[30,40]},
                {"category":"broken"}
            ]"#,
    )
    .unwrap();
    let segments = parse_sponsor_segments(&value);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].category, "sponsor");
    assert_eq!(segments[0].start_seconds, 12.5);
    assert_eq!(segments[1].action, "mute");
}

#[test]
fn sponsorblock_preview_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    let result = tauri::async_runtime::block_on(sponsorblock_preview(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_owned(),
        Some("sponsor,intro,outro".to_owned()),
    ));
    match result {
        Ok(segments) => eprintln!("SponsorBlock segmentos: {}", segments.len()),
        Err(error) => panic!("SponsorBlock no respondió: {error:?}"),
    }
    assert!(tauri::async_runtime::block_on(sponsorblock_preview(
        "https://vimeo.com/123".to_owned(),
        None
    ))
    .is_err());
}

#[test]
fn music_titles_keep_the_original_audio() {
    assert!(title_prefers_original_audio("My favorite song (cover)"));
    assert!(title_prefers_original_audio("Lyrics video"));
    assert!(!title_prefers_original_audio("Tutorial de edición"));
}

#[test]
fn auto_route_short_video_keeps_and_masters_original_audio() {
    let route = AutoRouteDecision::pick(30.0, "Tutorial de edición");
    assert!(!route.long_video);
    assert!(route.master_original_audio());
    assert!(!route.speed_and_noise());
    assert!(!route.preserves_original_audio_without_voice());
    assert!(route.summary().contains("audio original masterizado"));
}

#[test]
fn auto_route_long_video_uses_fast_path_and_audio_treatment() {
    let route = AutoRouteDecision::pick(61.0, "Documental completo");
    assert!(route.long_video);
    assert!(!route.master_original_audio());
    assert!(route.speed_and_noise());
    assert!(!route.preserves_original_audio_without_voice());
    assert!(route.summary().contains("sin flujo óptico"));
}

#[test]
fn auto_route_music_keeps_the_original_audio_even_if_long() {
    let short = AutoRouteDecision::pick(45.0, "Official music video");
    assert!(!short.master_original_audio());
    assert!(!short.speed_and_noise());
    assert!(short.preserves_original_audio_without_voice());

    let long = AutoRouteDecision::pick(180.0, "Concierto en vivo · music");
    assert!(long.long_video);
    assert!(!long.master_original_audio());
    assert!(!long.speed_and_noise());
    assert!(long.preserves_original_audio_without_voice());
    assert!(long.summary().contains("audio original intacto"));
}

#[test]
fn short_route_never_synthesizes_voice_automatically() {
    // La voz sólo entra si voice_pipeline=true explícito; el resumen debe
    // hablar de mastering, no de Piper.
    let route = AutoRouteDecision::pick(20.0, "Clip de producto");
    assert!(route.master_original_audio());
    assert!(!route.summary().contains("Piper"));
}

#[test]
fn audio_treatment_speeds_and_noise_mixes() {
    assert!(audio_treatment_filter().contains("atempo=1.02"));
    assert!(audio_treatment_filter().contains("loudnorm=I=-14"));
    let mix = audio_noise_mix_filter();
    assert!(mix.contains("atempo=1.02"));
    assert!(mix.contains("amix=inputs=2"));
    assert!(mix.contains("alimiter"));
}

#[test]
fn audio_master_keeps_pitch_and_speed() {
    let master = audio_master_filter();
    assert!(master.contains("highpass=f=55"));
    assert!(master.contains("loudnorm=I=-14"));
    assert!(!master.contains("atempo"));
    assert!(!master.contains("asetrate"));
    assert!(!master.contains("anoisesrc"));
}

#[test]
fn pipeline_filter_puts_denoise_before_the_look() {
    let filter = pipeline_filter("center");
    assert!(filter.starts_with("[0:v]hqdn3d=1.86:1.39:2.80:2.15,setpts=PTS/0.98"));
    assert!(filter.contains("minterpolate=fps=60"));
    assert!(filter.contains("noise=alls=8"));
}

#[test]
fn cinematic_focus_moves_the_third_crop() {
    let left = cinematic_filter("left");
    assert!(left.contains("(iw-ow)*0.33:(ih-oh)*0.5"));
    let top = cinematic_filter("top");
    assert!(top.contains("(iw-ow)*0.5:(ih-oh)*0.33"));
    assert!(cinematic_focus(Some("izquierda")).is_ok());
    assert!(cinematic_focus(Some("centro")).is_ok());
    assert!(cinematic_focus(Some("diagonal")).is_err());
}

/// Prueba real de FFmpeg, opcional para no depender de la red ni del tiempo
/// de CI. Genera un clip sintético y verifica que el look salga a 60 fps.
#[test]
fn cinematic_render_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("cinematic_render_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let root = std::env::temp_dir().join(format!("editoria-cine-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let input = root.join("base.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=160x90:rate=30:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&input)
        .status()
        .unwrap();
    assert!(status.success());
    let output = cinematic_video(&|_, _, _| {}, &ffmpeg, &input, "center", None).unwrap();
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=avg_frame_rate,width,height,codec_name",
            "-of",
            "json",
        ])
        .arg(&output)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["avg_frame_rate"].as_str(), Some("60/1"));
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
    // El zoom del 4 % se redondea a dimensiones pares para H.264; en
    // resoluciones chicas pierde hasta 2 px, en 1080p es imperceptible.
    let width = value["streams"][0]["width"].as_u64().unwrap_or(0);
    let height = value["streams"][0]["height"].as_u64().unwrap_or(0);
    assert!((156..=160).contains(&width), "ancho inesperado: {width}");
    assert!((86..=90).contains(&height), "alto inesperado: {height}");
    assert_eq!(width % 2, 0);
    assert_eq!(height % 2, 0);

    // Segunda pasada: reemplazo de audio masterizado a -14 LUFS.
    let audio = root.join("banda.wav");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=330:duration=2",
        ])
        .arg(&audio)
        .status()
        .unwrap();
    assert!(status.success());
    let with_audio = cinematic_video(&|_, _, _| {}, &ffmpeg, &input, "left", Some(&audio)).unwrap();
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "json",
        ])
        .arg(&with_audio)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    let kinds = value["streams"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|stream| stream["codec_type"].as_str())
        .collect::<Vec<_>>();
    assert!(kinds.contains(&"video"));
    assert!(kinds.contains(&"audio"));

    // Pipeline automático: H.265 CRF 22, MD5 nuevo y audio limpio.
    let (pipeline_path, md5, sha256) = process_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input,
        "center",
        None,
        true,
        false,
        false,
        false,
        false,
        None,
        None,
        None,
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .unwrap();
    let hash = md5.expect("el pipeline debe devolver MD5");
    assert_eq!(hash.len(), 32);
    assert!(hash.chars().all(|ch| ch.is_ascii_hexdigit()));
    let sha = sha256.expect("el pipeline debe devolver SHA-256");
    assert_eq!(sha.len(), 64);
    assert!(sha.chars().all(|ch| ch.is_ascii_hexdigit()));
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,avg_frame_rate",
            "-of",
            "json",
        ])
        .arg(&pipeline_path)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
    assert_eq!(value["streams"][0]["avg_frame_rate"].as_str(), Some("60/1"));

    // Audio original limpio: el pipeline lo conserva y normaliza si no
    // se eligió una banda nueva.
    let input_audio = root.join("base-con-audio.mp4");
    let status = Command::new(&ffmpeg)
        .args(["-hide_banner", "-v", "error", "-y", "-i"])
        .arg(&input)
        .arg("-i")
        .arg(&audio)
        .args(["-c:v", "copy", "-c:a", "aac", "-shortest"])
        .arg(&input_audio)
        .status()
        .unwrap();
    assert!(status.success());
    let (clean_audio, _, _) = process_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input_audio,
        "center",
        None,
        true,
        false,
        true,
        false,
        false,
        None,
        None,
        None,
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .unwrap();
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "json",
        ])
        .arg(&clean_audio)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert!(value["streams"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|stream| stream["codec_type"].as_str() == Some("audio")));

    // Corto: audio original masterizado, sin voz ni 1,02×.
    let (mastered, _, _) = process_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input_audio,
        "center",
        None,
        true,
        false,
        false,
        false,
        true,
        None,
        None,
        None,
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .unwrap();
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "json",
        ])
        .arg(&mastered)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert!(value["streams"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|stream| stream["codec_type"].as_str() == Some("audio")));

    // Ruta larga simulada: sin flujo óptico, 60 fps y audio original sin
    // filtros de velocidad ni ruido (se conserva como AAC).
    let (fast_path, _, _) = process_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input_audio,
        "right",
        None,
        true,
        true,
        false,
        true,
        false,
        None,
        None,
        None,
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .unwrap();
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,avg_frame_rate",
            "-of",
            "json",
        ])
        .arg(&fast_path)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    let streams = value["streams"].as_array().cloned().unwrap_or_default();
    assert!(streams
        .iter()
        .any(|stream| stream["codec_type"].as_str() == Some("audio")));
    let video = streams
        .iter()
        .find(|stream| stream["codec_type"].as_str() == Some("video"))
        .expect("video");
    assert_eq!(video["avg_frame_rate"].as_str(), Some("60/1"));

    // Voz Piper + marca de agua en una sola pasada.
    let piper_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/piper");
    let piper_assets =
        crate::commands::piper::PiperAssets::from_root(&piper_root).expect("voz Piper empaquetada");
    let voice = root.join("voice_ia.wav");
    crate::commands::piper::synthesize(
        &piper_assets,
        "Hola, esta es la narración automática de Olyvia.",
        &voice,
    )
    .expect("Piper");
    let watermark = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/watermark.png");
    let (voiced, _, _) = process_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input,
        "center",
        Some(&voice),
        true,
        false,
        false,
        false,
        false,
        None,
        None,
        None,
        Some(&watermark),
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .unwrap();
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name",
            "-of",
            "json",
        ])
        .arg(&voiced)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    let kinds = value["streams"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|stream| stream["codec_type"].as_str())
        .collect::<Vec<_>>();
    assert!(kinds.contains(&"video"));
    assert!(kinds.contains(&"audio"));
    let _ = std::fs::remove_dir_all(&root);
}

/// Delogo + Lanczos con FFmpeg real. Mide YMAX en la zona del logo antes y
/// después para demostrar que el parche interpola y que el escalado final
/// conserva exactamente 1920×1080.
#[test]
fn delogo_and_lanczos_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("delogo_and_lanczos_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let root = std::env::temp_dir().join(format!("editoria-delogo-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let input = root.join("logo.mp4");
    let rect = delogo_rect(320, 180, "top-right").expect("rect");
    let draw = format!(
        "drawbox=x={}:y={}:w={}:h={}:color=white:t=fill",
        rect.x, rect.y, rect.w, rect.h
    );
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x202020:size=320x180:rate=30:duration=1",
            "-vf",
        ])
        .arg(&draw)
        .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
        .arg(&input)
        .status()
        .unwrap();
    assert!(status.success());

    let ymax = |path: &Path, crop: &str| -> u32 {
        let filter = format!("{crop},signalstats,metadata=print:key=lavfi.signalstats.YMAX");
        let output = Command::new(&ffmpeg)
            .args(["-hide_banner", "-v", "info", "-i"])
            .arg(path)
            .args(["-vf", &filter, "-frames:v", "1", "-f", "null", "-"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&output.stderr)
            .lines()
            .filter_map(|line| line.split("lavfi.signalstats.YMAX=").nth(1))
            .filter_map(|value| value.trim().parse::<u32>().ok())
            .max()
            .unwrap_or(0)
    };
    let logo_crop = format!("crop={}:{}:{}:{}", rect.w, rect.h, rect.x, rect.y);
    let before = ymax(&input, &logo_crop);
    assert!(before > 200, "logo sintético ausente: YMAX={before}");

    let (output_path, md5, sha256) = process_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input,
        "center",
        None,
        false,
        false,
        false,
        false,
        false,
        Some("top-right"),
        None,
        Some("1080"),
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software_hq(),
    )
    .unwrap();
    let md5 = md5.expect("el look manual también debe devolver MD5");
    let sha256 = sha256.expect("el look manual también debe devolver SHA-256");
    assert_eq!(md5.len(), 32);
    assert_eq!(sha256.len(), 64);
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,codec_name",
            "-of",
            "json",
        ])
        .arg(&output_path)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["width"].as_u64(), Some(1920));
    assert_eq!(value["streams"][0]["height"].as_u64(), Some(1080));
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));

    // El hflip mueve el logo a la esquina superior izquierda; se mide una
    // zona amplia que incluye el parche después del zoom del 4 %.
    let after = ymax(&output_path, "crop=640:320:0:0");
    eprintln!("delogo YMAX: antes={before}, después={after}");
    assert!(
        after < 180,
        "delogo no atenuó el logo: YMAX antes={before}, después={after}"
    );
    let _ = std::fs::remove_dir_all(&root);
}

fn mean_volume(ffmpeg: &Path, path: &Path, at: f64) -> f64 {
    let output = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "info",
            "-ss",
            &format!("{at:.2}"),
            "-t",
            "0.5",
            "-i",
        ])
        .arg(path)
        .args(["-af", "volumedetect", "-f", "null", "-"])
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stderr)
        .lines()
        .find_map(|line| {
            line.split("mean_volume:")
                .nth(1)
                .and_then(|value| value.trim().trim_end_matches(" dB").parse::<f64>().ok())
        })
        .unwrap_or(-100.0)
}

#[test]
fn metadata_and_cover_embed_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let root = std::env::temp_dir().join(format!("editoria-meta-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let video = root.join("meta.mp4");
    let cover = root.join("cover.jpg");
    assert!(Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p"
        ])
        .arg(&video)
        .status()
        .unwrap()
        .success());
    assert!(Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:size=128x128:duration=1",
            "-frames:v",
            "1"
        ])
        .arg(&cover)
        .status()
        .unwrap()
        .success());
    apply_metadata_cover(
        &ffmpeg,
        &video,
        Some("Título de prueba"),
        Some("Olyvia"),
        Some("Comentario"),
        Some(&cover),
    )
    .unwrap();
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type:stream_disposition=attached_pic",
            "-show_entries",
            "format_tags=title,artist,comment",
            "-of",
            "json",
        ])
        .arg(&video)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(
        value["format"]["tags"]["title"].as_str(),
        Some("Título de prueba")
    );
    assert_eq!(value["format"]["tags"]["artist"].as_str(), Some("Olyvia"));
    let streams = value["streams"].as_array().unwrap();
    assert!(streams.iter().any(|stream| {
        stream["codec_name"].as_str() == Some("mjpeg")
            && stream["disposition"]["attached_pic"].as_u64() == Some(1)
    }));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn sponsorblock_mute_silences_only_the_segment_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let root = std::env::temp_dir().join(format!("editoria-mute-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let input = root.join("mute.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=6",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(&input)
        .status()
        .unwrap();
    assert!(status.success());
    let before = mean_volume(&ffmpeg, &input, 3.0);
    let segments = vec![SponsorSegment {
        category: "sponsor".to_owned(),
        start_seconds: 2.0,
        end_seconds: 4.0,
        action: "skip".to_owned(),
    }];
    mute_audio_segments(&ffmpeg, &input, &segments).unwrap();
    let after = mean_volume(&ffmpeg, &input, 3.0);
    let outside = mean_volume(&ffmpeg, &input, 4.5);
    eprintln!("mute: antes={before} después={after} fuera={outside}");
    assert!(before > -40.0, "el audio original no sonó: {before}");
    assert!(after < -60.0, "el tramo no quedó en silencio: {after}");
    assert!(outside > -40.0, "se silenció fuera del tramo: {outside}");
    let webm = root.join("mute.webm");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4",
            "-c:v",
            "libvpx-vp9",
            "-b:v",
            "200k",
            "-c:a",
            "libopus",
            "-shortest",
        ])
        .arg(&webm)
        .status()
        .unwrap();
    assert!(status.success());
    mute_audio_segments(
        &ffmpeg,
        &webm,
        &[SponsorSegment {
            category: "sponsor".to_owned(),
            start_seconds: 1.0,
            end_seconds: 3.0,
            action: "skip".to_owned(),
        }],
    )
    .unwrap();
    let after_webm = mean_volume(&ffmpeg, &webm, 2.0);
    assert!(after_webm < -60.0, "WebM no quedó muteado: {after_webm}");
    let _ = std::fs::remove_dir_all(root);
}

/// Compresión 4K de un clip largo sintético; mide tiempo real.
#[test]
fn long_4k_compression_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let root = std::env::temp_dir().join(format!("editoria-4k-long-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let input = root.join("long-4k.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=3840x2160:rate=24:duration=12",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=12",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "30",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(&input)
        .status()
        .unwrap();
    assert!(status.success());
    let started = Instant::now();
    let compressed = compress_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input,
        Some(30),
        None,
        "h265",
        "tonemap",
        true,
    )
    .unwrap()
    .expect("4K comprimido");
    let elapsed = started.elapsed();
    assert!(
        elapsed.as_secs() < 300,
        "la compresión 4K tardó demasiado: {elapsed:?}"
    );
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,codec_name",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
        ])
        .arg(&compressed)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["width"].as_u64(), Some(3840));
    assert_eq!(value["streams"][0]["height"].as_u64(), Some(2160));
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    assert!((duration - 12.0).abs() < 0.6, "duración {duration}");
    eprintln!("4K 12 s comprimido en {elapsed:?}");
    let _ = std::fs::remove_dir_all(&root);
}

/// HDR a SDR por tonemap y encode AV1 real.
#[test]
fn hdr_tonemap_and_av1_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let root = std::env::temp_dir().join(format!("editoria-hdr-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let hdr = root.join("hdr.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=1",
            "-c:v",
            "libx265",
            "-pix_fmt",
            "yuv420p10le",
            "-x265-params",
            "colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
            "-color_primaries",
            "bt2020",
            "-color_trc",
            "smpte2084",
            "-colorspace",
            "bt2020nc",
            "-tag:v",
            "hvc1",
        ])
        .arg(&hdr)
        .status()
        .unwrap();
    assert!(status.success());
    assert!(probe_color(Some(&ffprobe), &hdr).is_hdr());
    let tonemapped = compress_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &hdr,
        Some(28),
        None,
        "h264",
        "tonemap",
        true,
    )
    .unwrap()
    .expect("tonemap");
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,pix_fmt",
            "-of",
            "json",
        ])
        .arg(&tonemapped)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("h264"));
    assert_eq!(value["streams"][0]["pix_fmt"].as_str(), Some("yuv420p"));

    let av1_input = root.join("av1-base.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&av1_input)
        .status()
        .unwrap();
    assert!(status.success());
    let av1 = compress_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &av1_input,
        Some(32),
        None,
        "av1",
        "tonemap",
        true,
    )
    .unwrap()
    .expect("av1");
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "json",
        ])
        .arg(&av1)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("av1"));

    // HLG (iPhone / YouTube HDR) debe conservar su transferencia real, no
    // reetiquetarse como PQ.
    let hlg = root.join("hlg.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=1",
            "-c:v",
            "libx265",
            "-pix_fmt",
            "yuv420p10le",
            "-x265-params",
            "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
            "-color_primaries",
            "bt2020",
            "-color_trc",
            "arib-std-b67",
            "-colorspace",
            "bt2020nc",
            "-tag:v",
            "hvc1",
        ])
        .arg(&hlg)
        .status()
        .unwrap();
    assert!(status.success());
    let color = probe_color(Some(&ffprobe), &hlg);
    assert_eq!(color.transfer, Some(HdrTransfer::Hlg));
    let preserved = compress_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &hlg,
        Some(26),
        None,
        "h265",
        "preserve",
        true,
    )
    .unwrap()
    .expect("preserve HLG");
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,pix_fmt,color_transfer,color_primaries",
            "-of",
            "json",
        ])
        .arg(&preserved)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
    assert_eq!(value["streams"][0]["pix_fmt"].as_str(), Some("yuv420p10le"));
    assert_eq!(
        value["streams"][0]["color_transfer"].as_str(),
        Some("arib-std-b67")
    );
    assert_eq!(
        value["streams"][0]["color_primaries"].as_str(),
        Some("bt2020")
    );
    let av1_hdr = compress_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &hlg,
        Some(32),
        None,
        "av1",
        "preserve",
        true,
    )
    .unwrap()
    .expect("preserve AV1 HLG");
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,pix_fmt,color_transfer",
            "-of",
            "json",
        ])
        .arg(&av1_hdr)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("av1"));
    assert_eq!(value["streams"][0]["pix_fmt"].as_str(), Some("yuv420p10le"));
    assert_eq!(
        value["streams"][0]["color_transfer"].as_str(),
        Some("arib-std-b67")
    );
    let rejected = compress_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &hlg,
        Some(26),
        None,
        "h264",
        "preserve",
        true,
    );
    assert!(rejected.is_err(), "preserve + H.264 debe rechazarse");
    let _ = std::fs::remove_dir_all(&root);
}

/// Compresión por tamaño objetivo con conservación del original.
#[test]
fn target_size_compression_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let root = std::env::temp_dir().join(format!("editoria-target-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let input = root.join("base.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30:duration=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(&input)
        .status()
        .unwrap();
    assert!(status.success());
    let output = compress_video(
        &|_, _, _| {},
        &ffmpeg,
        Some(&ffprobe),
        &input,
        None,
        Some(1),
        "h264",
        "tonemap",
        true,
    )
    .unwrap()
    .expect("debería comprimir");
    assert!(input.is_file(), "keep_original debe conservar el original");
    let bytes = std::fs::metadata(&output).unwrap().len();
    assert!(bytes > 0 && bytes < 1_600_000, "tamaño inesperado: {bytes}");
    let _ = std::fs::remove_dir_all(&root);
}

/// Encode real 4K (3840×2160) por la ruta larga + Lanczos, con x265
/// ultrafast. Mide el costo real y confirma dimensiones/códec.
#[test]
fn upscale_4k_live_optional() {
    if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
        eprintln!("upscale_4k_live omitido: definí EDITOR_IA_RUN_RENDER_TESTS=1");
        return;
    }
    use crate::commands::system::find_executable;
    let ffmpeg = find_executable("ffmpeg", None).expect("ffmpeg");
    let ffprobe = find_executable("ffprobe", None).expect("ffprobe");
    let root = std::env::temp_dir().join(format!("editoria-4k-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let input = root.join("base.mp4");
    let status = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=30:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&input)
        .status()
        .unwrap();
    assert!(status.success());
    let started = Instant::now();
    let percents = std::sync::Mutex::new(Vec::new());
    let progress = |_stage: &str, percent: Option<f64>, _message: &str| {
        if let Some(percent) = percent {
            percents.lock().unwrap().push(percent);
        }
    };
    let (output, _, _) = process_video(
        &progress,
        &ffmpeg,
        Some(&ffprobe),
        &input,
        "center",
        None,
        true,
        true,
        false,
        false,
        false,
        None,
        None,
        Some("2160"),
        None,
        &crate::commands::pipeline_profile::PipelineProfile::software(),
    )
    .unwrap();
    let seen = percents.into_inner().unwrap();
    assert!(
        seen.iter().any(|percent| *percent > 0.0),
        "no se emitió progreso porcentual de FFmpeg"
    );
    let probe = Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,codec_name",
            "-of",
            "json",
        ])
        .arg(&output)
        .output()
        .unwrap();
    let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
    assert_eq!(value["streams"][0]["width"].as_u64(), Some(3840));
    assert_eq!(value["streams"][0]["height"].as_u64(), Some(2160));
    assert_eq!(value["streams"][0]["codec_name"].as_str(), Some("hevc"));
    eprintln!("4K upscale real: {:?}", started.elapsed());
    let _ = std::fs::remove_dir_all(&root);
}
