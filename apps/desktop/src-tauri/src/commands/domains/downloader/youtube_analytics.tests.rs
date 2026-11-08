use super::*;

#[test]
fn normalizes_channel_urls_and_rejects_videos() {
    assert_eq!(
        normalize_channel_url("@Computerphile").unwrap(),
        "https://www.youtube.com/@Computerphile"
    );
    assert!(normalize_channel_url("https://youtube.com/watch?v=abc").is_err());
    assert!(normalize_channel_url("https://example.com/canal").is_err());
}

#[test]
fn title_flags_detect_hooks() {
    let flags = title_flags("¿Cómo funciona? 5 errores | Guía 2026");
    assert!(flags.contains(&"número".to_owned()));
    assert!(flags.contains(&"pregunta".to_owned()));
    assert!(flags.contains(&"tutorial".to_owned()));
    assert!(flags.contains(&"comparación/lista".to_owned()));
    assert!(flags.contains(&"curiosidad".to_owned()));
}

#[test]
fn sentiment_counts_positive_and_negative_words() {
    assert!(sentiment("Excelente video, gracias, muy útil") > 0);
    assert!(sentiment("Terrible, aburrido y confuso") < 0);
    assert_eq!(sentiment("El video dura diez minutos"), 0);
}

#[test]
fn scoring_prefers_fast_performing_recent_video() {
    let video = |id: &str, views: u64, likes: u64, date: &str| ChannelVideo {
        id: id.to_owned(),
        title: id.to_owned(),
        url: String::new(),
        views,
        likes: Some(likes),
        comments: Some(10),
        duration_seconds: 300.0,
        upload_date: Some(date.to_owned()),
        views_per_day: 0.0,
        engagement_rate: 0.0,
        score: 0.0,
        title_flags: Vec::new(),
        reasons: Vec::new(),
        thumbnail_url: None,
        thumbnail: None,
        comment_analysis: None,
    };
    let now = days_from_civil(2026, 10, 27) * 86_400;
    let mut videos = vec![
        video("viejo", 1_000_000, 10_000, "2024-01-01"),
        video("nuevo", 200_000, 20_000, "2026-10-01"),
    ];
    score_videos(&mut videos, now);
    assert!(videos[1].views_per_day > videos[0].views_per_day);
    assert!(videos[1].engagement_rate > videos[0].engagement_rate);
    assert!(videos[1].score > videos[0].score);
}

#[test]
fn thumbnail_stats_measure_color_and_preview() {
    let image = image::RgbImage::from_pixel(320, 180, image::Rgb([255, 0, 0]));
    let mut bytes = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    let stats = thumbnail_from_bytes(&bytes).expect("la miniatura debería medirse");
    assert_eq!(stats.width, 320);
    assert_eq!(stats.height, 180);
    assert!(stats.brightness > 20.0 && stats.brightness < 23.0);
    assert!(stats.saturation > 99.0);
    assert!(stats.palette.iter().any(|color| color == "#f01010"));
    assert!(stats.preview.starts_with("data:image/jpeg;base64,"));
}

#[test]
fn weekday_names_match_known_dates() {
    let epoch = days_from_civil(2026, 10, 27) * 86_400;
    assert_eq!(weekday_name(epoch), "martes");
    assert_eq!(date_from_epoch(epoch), "2026-10-27");
}
