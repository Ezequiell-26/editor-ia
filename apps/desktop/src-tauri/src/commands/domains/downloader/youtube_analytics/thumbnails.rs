fn thumbnail_from_bytes(bytes: &[u8]) -> Option<ThumbnailStats> {
    let image = image::load_from_memory(bytes).ok()?;
    let (width, height) = image.dimensions();
    let small = image.resize_exact(64, 64, image::imageops::FilterType::Triangle);
    let mut luma_sum = 0.0;
    let mut sat_sum = 0.0;
    let mut luma_values = Vec::with_capacity(64 * 64);
    let mut palette: HashMap<(u8, u8, u8), u32> = HashMap::new();
    for pixel in small.pixels() {
        let rgba = pixel.2;
        let [r, g, b, _] = rgba.0;
        let max = f64::from(r.max(g).max(b));
        let min = f64::from(r.min(g).min(b));
        let luma = (0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b)) / 255.0;
        let saturation = if max > 0.0 { (max - min) / max } else { 0.0 };
        luma_sum += luma;
        sat_sum += saturation;
        luma_values.push(luma);
        let bucket = (r >> 5, g >> 5, b >> 5);
        *palette.entry(bucket).or_insert(0) += 1;
    }
    let count = luma_values.len() as f64;
    let mean = luma_sum / count;
    let variance = luma_values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / count;
    let mut palette_items: Vec<((u8, u8, u8), u32)> = palette.into_iter().collect();
    palette_items.sort_by(|a, b| b.1.cmp(&a.1));
    let palette = palette_items
        .into_iter()
        .take(3)
        .map(|((r, g, b), _)| {
            format!(
                "#{:02x}{:02x}{:02x}",
                (u32::from(r) * 32 + 16).min(255),
                (u32::from(g) * 32 + 16).min(255),
                (u32::from(b) * 32 + 16).min(255)
            )
        })
        .collect();
    let preview_image = image.resize_to_fill(320, 180, image::imageops::FilterType::Triangle);
    let mut preview_bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut preview_bytes, 78);
    encoder.encode_image(&preview_image).ok()?;
    let preview = format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(preview_bytes)
    );
    Some(ThumbnailStats {
        width,
        height,
        brightness: (mean * 1000.0).round() / 10.0,
        saturation: (sat_sum / count * 1000.0).round() / 10.0,
        contrast: (variance.sqrt() * 1000.0).round() / 10.0,
        palette,
        preview,
    })
}

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
    let mut comments = Vec::new();
    for comment in value
        .get("comments")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
    {
        let Ok(parsed) = serde_json::from_value::<RawComment>(comment.clone()) else {
            continue;
        };
        if !parsed.text.trim().is_empty() {
            comments.push(parsed);
        }
    }
    Ok(comments)
}

fn median(mut values: Vec<f64>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

pub(crate) fn score_videos(videos: &mut [ChannelVideo], now: i64) {
    let max_views_per_day = videos
        .iter()
        .map(|video| video.views_per_day)
        .fold(0.0f64, f64::max);
    let max_engagement = videos
        .iter()
        .map(|video| video.engagement_rate)
        .fold(0.0f64, f64::max);
    let max_age = videos
        .iter()
        .filter_map(|video| video.upload_date.as_deref())
        .filter_map(epoch_from_upload_date)
        .map(|epoch| ((now - epoch).max(0) as f64 / 86_400.0).max(1.0))
        .fold(1.0f64, f64::max);
    for video in videos.iter_mut() {
        let age = video
            .upload_date
            .as_deref()
            .and_then(epoch_from_upload_date)
            .map(|epoch| ((now - epoch).max(0) as f64 / 86_400.0).max(0.1))
            .unwrap_or(max_age);
        video.views_per_day = (video.views as f64 / age * 10.0).round() / 10.0;
        video.engagement_rate = if video.views > 0 {
            ((video.likes.unwrap_or(0) + video.comments.unwrap_or(0) * 2) as f64
                / video.views as f64
                * 1000.0)
                .round()
                / 10.0
        } else {
            0.0
        };
        let recency = (1.0 - age / max_age).clamp(0.0, 1.0);
        let part_views = if max_views_per_day > 0.0 {
            video.views_per_day / max_views_per_day
        } else {
            0.0
        };
        let part_engagement = if max_engagement > 0.0 {
            video.engagement_rate / max_engagement
        } else {
            0.0
        };
        video.score =
            ((part_views * 45.0 + part_engagement * 35.0 + recency * 20.0) * 10.0).round() / 10.0;
    }
}

fn build_reasons(
    video: &ChannelVideo,
    insights: &ChannelInsights,
    median_views_per_day: f64,
    best: bool,
) -> Vec<String> {
    let mut reasons = Vec::new();
    if median_views_per_day > 0.0 {
        let ratio = video.views_per_day / median_views_per_day;
        if ratio >= 1.3 {
            reasons.push(format!(
                "{:.1}× las vistas por día de la mediana del canal",
                ratio
            ));
        }
    }
    if insights.average_engagement > 0.0 {
        let diff = video.engagement_rate - insights.average_engagement;
        if diff.abs() >= 0.2 {
            reasons.push(format!(
                "Engagement {:.1}% ({:+.1} puntos vs la media {:.1}%)",
                video.engagement_rate, diff, insights.average_engagement
            ));
        }
    }
    if let Some(comments) = &video.comment_analysis {
        if comments.analyzed > 0 {
            reasons.push(format!(
                "{}% de comentarios positivos en {} analizados",
                comments.positive_percent, comments.analyzed
            ));
        }
    }
    if let Some(thumbnail) = &video.thumbnail {
        if let Some(average) = &insights.thumbnail_average {
            let bright = thumbnail.brightness - average.brightness;
            let sat = thumbnail.saturation - average.saturation;
            if bright.abs() >= 5.0 || sat.abs() >= 5.0 {
                reasons.push(format!(
                    "Miniatura {:+.0}% de brillo y {:+.0}% de saturación vs el promedio",
                    bright, sat
                ));
            }
        }
        reasons.push(format!(
            "Miniatura {}×{}",
            thumbnail.width, thumbnail.height
        ));
    }
    if !video.title_flags.is_empty() {
        reasons.push(format!("Título con {}", video.title_flags.join(", ")));
    }
    if video.duration_seconds >= 60.0 {
        reasons.push(format!("Duración {:.0} min", video.duration_seconds / 60.0));
    }
    if best && reasons.is_empty() {
        reasons.push("Mayor score combinado de vistas/día, engagement y recencia".to_owned());
    }
    reasons
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}
