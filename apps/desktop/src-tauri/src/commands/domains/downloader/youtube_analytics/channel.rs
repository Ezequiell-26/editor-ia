fn analyze_channel_blocking(
    app: Option<&AppHandle>,
    config_dir: &Path,
    request: ChannelAnalysisRequest,
) -> Result<ChannelReport, ProjectError> {
    let url = normalize_channel_url(&request.channel_url)?;
    let engine = resolve_engine(config_dir)?;
    let max_listed = request
        .max_videos
        .unwrap_or(DEFAULT_LISTED)
        .clamp(5, MAX_LISTED);
    let detail_count = request
        .detail_count
        .unwrap_or(DEFAULT_DETAILS)
        .clamp(4, MAX_DETAILS);
    let include_comments = request.include_comments.unwrap_or(true);
    let comment_videos = request
        .comment_videos
        .unwrap_or(DEFAULT_COMMENT_VIDEOS)
        .clamp(1, MAX_COMMENT_VIDEOS);
    emit_progress(app, "listing", 0, 1, "Listando videos del canal…");

    let mut listing_args = base_args();
    listing_args.extend([
        "--flat-playlist".into(),
        "--dump-single-json".into(),
        "--playlist-end".into(),
        max_listed.to_string(),
    ]);
    let payload = run_engine(&engine, &listing_args, &url).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            &format!("no se pudo listar el canal: {error}"),
        )
    })?;
    let value: serde_json::Value = serde_json::from_slice(&payload).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "yt-dlp devolvió un listado de canal ilegible",
        )
    })?;
    let (listed, subscribers, total_videos) = parse_listing(&value);
    if listed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el canal no devolvió videos; revisá la URL o si el canal es privado",
        ));
    }
    let channel_name = text_of(&value, "channel")
        .or_else(|| text_of(&value, "uploader"))
        .or_else(|| text_of(&value, "title"))
        .unwrap_or_else(|| "Canal de YouTube".to_owned());
    // Los más nuevos están primeros en el payload; sus ids preservan el orden
    // original del listado para la selección.
    let entry_ids: Vec<String> = value
        .get("entries")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
        .filter_map(|entry| text_of(entry, "id"))
        .collect();
    let selected = select_detail_videos(&listed, &entry_ids, detail_count);

    let mut warnings = Vec::new();
    let mut details: Vec<RawVideo> = Vec::new();
    for (index, video) in selected.iter().enumerate() {
        emit_progress(
            app,
            "details",
            index as u32 + 1,
            selected.len() as u32,
            &format!(
                "Leyendo “{}”…",
                video.title.chars().take(60).collect::<String>()
            ),
        );
        match fetch_detail(&engine, video) {
            Ok(detail) => details.push(detail),
            Err(error) => warnings.push(format!(
                "No se pudo leer “{}”: {error}",
                video.title.chars().take(60).collect::<String>()
            )),
        }
    }
    if details.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "yt-dlp no pudo leer los detalles de ningún video",
        ));
    }

    let mut thumbnails: HashMap<String, ThumbnailStats> = HashMap::new();
    for (index, video) in details.iter().enumerate() {
        emit_progress(
            app,
            "thumbnails",
            index as u32 + 1,
            details.len() as u32,
            "Midiendo miniaturas…",
        );
        if let Some(url) = &video.thumbnail_url {
            match download_thumbnail(url) {
                Some(stats) => {
                    thumbnails.insert(video.id.clone(), stats);
                }
                None => warnings.push(format!(
                    "No se pudo medir la miniatura de “{}”.",
                    video.title.chars().take(50).collect::<String>()
                )),
            }
        }
    }

    let now = now_epoch();
    let mut videos = build_channel_videos(&details, &thumbnails, now);
    score_videos(&mut videos, now);
    videos.sort_by(|a, b| b.score.total_cmp(&a.score));

    // Comentarios de los mejores candidatos; el score no depende de ellos para
    // no premiar videos con comentarios deshabilitados.
    let mut channel_comments: Option<CommentAnalysis> = None;
    if include_comments {
        let mut all_comments: Vec<RawComment> = Vec::new();
        let mut all_comment_titles: Vec<String> = Vec::new();
        let comment_total = comment_videos.min(videos.len() as u32);
        for (index, video) in videos.iter_mut().take(comment_total as usize).enumerate() {
            emit_progress(
                app,
                "comments",
                index as u32 + 1,
                comment_total,
                "Leyendo comentarios principales…",
            );
            let raw = RawVideo {
                id: video.id.clone(),
                title: video.title.clone(),
                views: video.views,
                duration: video.duration_seconds,
                thumbnail_url: None,
                likes: video.likes,
                comments: video.comments,
                timestamp: None,
                upload_date: video.upload_date.clone(),
            };
            match fetch_comments(&engine, &raw) {
                Ok(comments) => {
                    if !comments.is_empty() {
                        let mut normalized = comments.clone();
                        for comment in &mut normalized {
                            if comment.author.trim().is_empty() {
                                comment.author = "Anónimo".to_owned();
                            }
                        }
                        let titles = vec![video.title.clone(); normalized.len()];
                        let analysis = analyze_comments(&normalized, &titles);
                        video.comment_analysis = Some(analysis);
                        for comment in normalized {
                            all_comment_titles.push(video.title.clone());
                            all_comments.push(comment);
                        }
                    }
                }
                Err(error) => warnings.push(format!(
                    "No se pudieron leer comentarios de “{}”: {error}",
                    video.title.chars().take(50).collect::<String>()
                )),
            }
        }
        if !all_comments.is_empty() {
            channel_comments = Some(analyze_comments(&all_comments, &all_comment_titles));
        }
    }

    let stats = compute_channel_stats(&details, &videos);
    let best = videos.first().cloned().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "no quedaron videos analizados")
    })?;
    let (strengths, opportunities) = derive_strengths_opportunities(
        &stats,
        &best,
        channel_comments.as_ref(),
        include_comments,
    );
    let insights = ChannelInsights {
        median_views: stats.median_views.round() as u64,
        average_engagement: round1(stats.average_engagement),
        uploads_per_week: stats.uploads_per_week,
        best_weekday: stats.best_weekday,
        best_hour_utc: stats.best_hour_utc,
        median_duration_seconds: round1(stats.median_duration),
        common_title_words: stats.common_title_words,
        title_patterns: stats.title_patterns,
        thumbnail_average: stats.thumbnail_average,
        comments: channel_comments,
        strengths,
        opportunities,
    };

    for video in videos.iter_mut() {
        video.reasons =
            build_reasons(video, &insights, stats.median_views_per_day, video.id == best.id);
    }

    if videos.len() < listed.len() {
        warnings.push(format!(
            "Se detallaron {} de {} videos listados; el resto solo se usó para elegir la muestra, no se puntúa.",
            videos.len(),
            listed.len()
        ));
    }
    let best_reason_summary = format!(
        "Mejor score {:.0}/100: {} vistas/día, {:.1}% de engagement y {} vistas.",
        best.score, best.views_per_day, best.engagement_rate, best.views
    );

    Ok(ChannelReport {
        channel_name,
        channel_url: url,
        subscribers,
        listed_videos: listed.len() as u32,
        analyzed_videos: videos.len() as u32,
        total_videos,
        best_video_id: best.id,
        best_reason_summary,
        videos,
        insights,
        warnings,
        fetched_at: date_from_epoch(now_epoch()),
    })
}
