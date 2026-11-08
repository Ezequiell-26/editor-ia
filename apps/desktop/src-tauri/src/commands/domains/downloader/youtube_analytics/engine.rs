fn run_engine(engine: &Path, args: &[String], target: &str) -> Result<Vec<u8>, String> {
    let mut command = Command::new(engine);
    command.args(args).arg(target);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("no se pudo ejecutar yt-dlp: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let last = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("yt-dlp falló sin detalle");
        return Err(last.chars().take(300).collect());
    }
    Ok(output.stdout)
}

fn base_args() -> Vec<String> {
    vec![
        "--no-warnings".into(),
        "--ignore-config".into(),
        "--socket-timeout".into(),
        "30".into(),
        "--retries".into(),
        "2".into(),
    ]
}

fn parse_listing(payload: &serde_json::Value) -> (Vec<RawVideo>, Option<u64>, Option<u64>) {
    let mut videos = Vec::new();
    for entry in payload
        .get("entries")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
    {
        let Some(id) = text_of(entry, "id") else {
            continue;
        };
        if id.len() != 11 {
            continue;
        }
        let title = text_of(entry, "title").unwrap_or_else(|| id.clone());
        videos.push(RawVideo {
            id: id.clone(),
            title,
            views: parse_u64(&entry["view_count"]).unwrap_or(0),
            duration: parse_f64(&entry["duration"]).unwrap_or(0.0),
            thumbnail_url: best_thumbnail(entry),
            likes: None,
            comments: None,
            timestamp: entry["timestamp"].as_i64(),
            upload_date: text_of(entry, "upload_date").and_then(|value| normalize_date(&value)),
        });
    }
    let subscribers = parse_u64(&payload["channel_follower_count"]);
    let total = parse_u64(&payload["playlist_count"]);
    (videos, subscribers, total)
}

fn parse_detail(value: &serde_json::Value, fallback: &RawVideo) -> RawVideo {
    let timestamp = value["timestamp"]
        .as_i64()
        .or_else(|| value["release_timestamp"].as_i64())
        .or_else(|| {
            text_of(value, "upload_date")
                .as_deref()
                .and_then(epoch_from_upload_date)
        });
    RawVideo {
        id: text_of(value, "id").unwrap_or_else(|| fallback.id.clone()),
        title: text_of(value, "title").unwrap_or_else(|| fallback.title.clone()),
        views: parse_u64(&value["view_count"]).unwrap_or(fallback.views),
        duration: parse_f64(&value["duration"])
            .filter(|duration| *duration > 0.0)
            .unwrap_or(fallback.duration),
        thumbnail_url: best_thumbnail(value).or_else(|| fallback.thumbnail_url.clone()),
        likes: parse_u64(&value["like_count"]),
        comments: parse_u64(&value["comment_count"]),
        timestamp,
        upload_date: text_of(value, "upload_date")
            .and_then(|date| normalize_date(&date))
            .or_else(|| timestamp.map(date_from_epoch))
            .or_else(|| fallback.upload_date.clone()),
    }
}
