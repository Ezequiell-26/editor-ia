fn download_thumbnail(url: &str) -> Option<ThumbnailStats> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Olyvia/0.1 channel-analyzer")
        .build()
        .ok()?;
    for candidate in [url.to_owned(), url.replace("maxresdefault", "hqdefault")] {
        let Ok(response) = client.get(&candidate).send() else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(bytes) = response.bytes() else {
            continue;
        };
        if let Some(stats) = thumbnail_from_bytes(&bytes) {
            return Some(stats);
        }
    }
    None
}

fn fetch_detail(engine: &Path, video: &RawVideo) -> Result<RawVideo, String> {
    let args = {
        let mut args = base_args();
        args.extend(["--dump-single-json".into(), "--skip-download".into()]);
        args
    };
    let url = format!("https://www.youtube.com/watch?v={}", video.id);
    let bytes = run_engine(engine, &args, &url)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "yt-dlp devolvió un detalle ilegible".to_owned())?;
    Ok(parse_detail(&value, video))
}

fn fetch_comments(engine: &Path, video: &RawVideo) -> Result<Vec<RawComment>, String> {
    let mut args = base_args();
    args.extend([
        "--skip-download".into(),
        "--write-comments".into(),
        "--dump-single-json".into(),
        "--extractor-args".into(),
        format!("youtube:comment_sort=top;max_comments={MAX_COMMENTS_PER_VIDEO}"),
    ]);
    let url = format!("https://www.youtube.com/watch?v={}", video.id);
    let bytes = run_engine(engine, &args, &url)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| "yt-dlp devolvió comentarios ilegibles".to_owned())?;
    Ok(parse_comments_payload(&value))
}
