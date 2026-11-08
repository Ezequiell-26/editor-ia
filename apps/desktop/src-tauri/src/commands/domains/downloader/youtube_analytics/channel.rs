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
    let (mut listed, subscribers, total_videos) = parse_listing(&value);
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
    listed.sort_by_key(|video| std::cmp::Reverse(video.views));
    let mut selected: Vec<RawVideo> = Vec::new();
    let mut seen = HashSet::new();
    let newest_limit = (detail_count / 2).max(1) as usize;
    let popular_limit = detail_count as usize - newest_limit.min(listed.len());
    for video in listed.iter().take(popular_limit) {
        if seen.insert(video.id.clone()) {
            selected.push(video.clone());
        }
    }
    // Los más nuevos están primero en el listado original; se recuperan desde
    // el payload para no depender del orden después de ordenar por vistas.
    for entry in value
        .get("entries")
        .and_then(|item| item.as_array())
        .into_iter()
        .flatten()
        .take(newest_limit)
    {
        let Some(id) = text_of(entry, "id") else {
            continue;
        };
        if let Some(video) = listed.iter().find(|item| item.id == id) {
            if seen.insert(id.clone()) {
                selected.push(video.clone());
            }
        }
    }
    if selected.len() < detail_count as usize {
        for video in listed.iter() {
            if selected.len() >= detail_count as usize {
                break;
            }
            if seen.insert(video.id.clone()) {
                selected.push(video.clone());
            }
        }
    }
    selected.truncate(detail_count as usize);

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
    let mut videos: Vec<ChannelVideo> = details
        .iter()
        .map(|video| {
            let age = video
                .timestamp
                .map(|epoch| ((now - epoch).max(0) as f64 / 86_400.0).max(0.1))
                .unwrap_or(1.0);
            ChannelVideo {
                id: video.id.clone(),
                title: video.title.clone(),
                url: format!("https://www.youtube.com/watch?v={}", video.id),
                views: video.views,
                likes: video.likes,
                comments: video.comments,
                duration_seconds: round1(video.duration),
                upload_date: video.upload_date.clone(),
                views_per_day: round1(video.views as f64 / age),
                engagement_rate: 0.0,
                score: 0.0,
                title_flags: title_flags(&video.title),
                reasons: Vec::new(),
                thumbnail_url: video.thumbnail_url.clone(),
                thumbnail: thumbnails.get(&video.id).cloned(),
                comment_analysis: None,
            }
        })
        .collect();
    score_videos(&mut videos, now);
    videos.sort_by(|a, b| b.score.total_cmp(&a.score));

    let median_views = median(videos.iter().map(|video| video.views as f64).collect());
    let median_duration = median(videos.iter().map(|video| video.duration_seconds).collect());
    let median_views_per_day = median(videos.iter().map(|video| video.views_per_day).collect());
    let average_engagement = videos
        .iter()
        .map(|video| video.engagement_rate)
        .sum::<f64>()
        / videos.len() as f64;
    let dated: Vec<i64> = details.iter().filter_map(|video| video.timestamp).collect();
    let uploads_per_week = if dated.len() >= 2 {
        let min = *dated.iter().min().unwrap_or(&0);
        let max = *dated.iter().max().unwrap_or(&0);
        let weeks = ((max - min).max(1) as f64) / (86_400.0 * 7.0);
        round1(details.len() as f64 / weeks.max(0.1))
    } else {
        0.0
    };
    let mut weekday_counts: HashMap<String, u32> = HashMap::new();
    let mut hour_counts: HashMap<u32, u32> = HashMap::new();
    for epoch in &dated {
        *weekday_counts.entry(weekday_name(*epoch)).or_insert(0) += 1;
        *hour_counts
            .entry((epoch.rem_euclid(86_400) / 3_600) as u32)
            .or_insert(0) += 1;
    }
    let best_weekday = weekday_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(name, _)| name);
    let best_hour_utc = hour_counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(hour, _)| hour);

    let titles: Vec<String> = videos.iter().map(|video| video.title.clone()).collect();
    let title_count = titles.len().max(1) as f64;
    let pct = |count: usize| round1(count as f64 / title_count * 100.0);
    let title_patterns = TitlePatterns {
        numbers_percent: pct(titles
            .iter()
            .filter(|title| title.chars().any(|ch| ch.is_ascii_digit()))
            .count()),
        questions_percent: pct(titles
            .iter()
            .filter(|title| title.contains('?') || title.contains('¿'))
            .count()),
        how_to_percent: pct(titles
            .iter()
            .filter(|title| {
                let lower = title.to_lowercase();
                lower.starts_with("cómo")
                    || lower.starts_with("como ")
                    || lower.starts_with("how to")
                    || lower.contains("tutorial")
            })
            .count()),
        lists_percent: pct(titles
            .iter()
            .filter(|title| title.contains('|') || title.contains(" vs ") || title.contains(" / "))
            .count()),
    };
    let common_title_words = keyword_counts(&titles, 8);
    let thumbnail_samples: Vec<&ThumbnailStats> = videos
        .iter()
        .filter_map(|video| video.thumbnail.as_ref())
        .collect();
    let thumbnail_average = if thumbnail_samples.is_empty() {
        None
    } else {
        let count = thumbnail_samples.len() as f64;
        Some(ThumbnailAverages {
            brightness: round1(
                thumbnail_samples
                    .iter()
                    .map(|item| item.brightness)
                    .sum::<f64>()
                    / count
                    * 100.0,
            ),
            saturation: round1(
                thumbnail_samples
                    .iter()
                    .map(|item| item.saturation)
                    .sum::<f64>()
                    / count
                    * 100.0,
            ),
            contrast: round1(
                thumbnail_samples
                    .iter()
                    .map(|item| item.contrast)
                    .sum::<f64>()
                    / count
                    * 100.0,
            ),
            samples: thumbnail_samples.len() as u32,
        })
    };

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

    let mut insights = ChannelInsights {
        median_views: median_views.round() as u64,
        average_engagement: round1(average_engagement),
        uploads_per_week,
        best_weekday,
        best_hour_utc,
        median_duration_seconds: round1(median_duration),
        common_title_words,
        title_patterns,
        thumbnail_average,
        comments: channel_comments,
        strengths: Vec::new(),
        opportunities: Vec::new(),
    };

    let best = videos.first().cloned().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "no quedaron videos analizados")
    })?;
    for video in videos.iter_mut() {
        video.reasons = build_reasons(video, &insights, median_views_per_day, video.id == best.id);
    }

    let mut strengths = Vec::new();
    let mut opportunities = Vec::new();
    if best.views_per_day > median_views_per_day * 1.5 && median_views_per_day > 0.0 {
        strengths.push(format!(
            "El mejor video rinde {:.1}× las vistas por día de la mediana del canal.",
            best.views_per_day / median_views_per_day
        ));
    }
    if insights.average_engagement >= 3.0 {
        strengths.push(format!(
            "Engagement medio alto: {:.1}% del canal.",
            insights.average_engagement
        ));
    } else if insights.average_engagement < 1.0 {
        opportunities.push(format!(
            "Engagement bajo: {:.1}%; probá llamados a comentar y preguntas al final.",
            insights.average_engagement
        ));
    }
    if uploads_per_week >= 1.0 {
        strengths.push(format!(
            "Cadencia constante: {:.1} videos por semana en la muestra.",
            uploads_per_week
        ));
    } else {
        opportunities.push(format!(
            "Cadencia baja: {:.1} videos por semana; una subida fija ayuda al algoritmo.",
            uploads_per_week
        ));
    }
    if let Some(thumbnail) = &insights.thumbnail_average {
        if thumbnail.brightness >= 55.0 && thumbnail.saturation >= 35.0 {
            strengths.push(format!(
                "Miniaturas visibles: brillo {:.0}% y saturación {:.0}%.",
                thumbnail.brightness, thumbnail.saturation
            ));
        } else if thumbnail.brightness < 42.0 {
            opportunities.push(format!(
                "Miniaturas oscuras (brillo {:.0}%); probá fondos más claros o un borde.",
                thumbnail.brightness
            ));
        }
    }
    let patterns = &insights.title_patterns;
    if patterns.numbers_percent >= 30.0
        || patterns.questions_percent >= 25.0
        || patterns.how_to_percent >= 25.0
    {
        strengths.push(format!(
            "Títulos con gancho: números {:.0}%, preguntas {:.0}%, tutoriales {:.0}%.",
            patterns.numbers_percent, patterns.questions_percent, patterns.how_to_percent
        ));
    } else {
        opportunities.push(
            "Los títulos no usan números, preguntas ni formato tutorial de forma consistente."
                .to_owned(),
        );
    }
    if let Some(comments) = &insights.comments {
        if comments.positive_percent >= 60.0 {
            strengths.push(format!(
                "Comunidad positiva: {:.0}% de comentarios positivos en {} analizados.",
                comments.positive_percent, comments.analyzed
            ));
        }
        if comments.negative_percent >= 25.0 {
            opportunities.push(format!(
                "{}% de comentarios negativos; revisá los temas repetidos.",
                comments.negative_percent
            ));
        }
    } else if include_comments {
        opportunities.push(
            "No se pudieron analizar comentarios; el video puede tenerlos deshabilitados."
                .to_owned(),
        );
    }
    if median_duration > 1_200.0 {
        opportunities.push(format!(
            "Duración mediana de {:.0} min; probá cortes cortos derivados para retención.",
            median_duration / 60.0
        ));
    }
    if strengths.is_empty() {
        strengths.push(
            "La muestra tiene datos suficientes para comparar vistas, engagement y miniaturas."
                .to_owned(),
        );
    }
    if opportunities.is_empty() {
        opportunities.push(
            "Sin oportunidades obvias en la muestra; medí más videos para confirmar.".to_owned(),
        );
    }
    insights.strengths = strengths;
    insights.opportunities = opportunities;

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
