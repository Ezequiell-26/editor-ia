#[tauri::command]
pub async fn analyze_media(
    state: State<'_, AppState>,
    asset_id: String,
    scene_threshold: Option<f64>,
    silence_db: Option<f64>,
    min_silence_seconds: Option<f64>,
    include_samples: Option<bool>,
) -> Result<MediaAnalysis, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para analizar el material",
        ));
    };
    let opened = service::open_project(&session.path)?;
    let asset = opened.project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|item| item["id"].as_str() == Some(asset_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el material que se quiere analizar no está en el proyecto",
            )
        })?;
    let kind = asset["kind"].as_str().unwrap_or("");
    if kind != "video" && kind != "audio" {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el Director automático analiza video o audio",
        ));
    }
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el material no está listo para analizar",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(&session.root, relative)?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del material no está en disco",
        ));
    }

    let fps_num = asset["media"]["frameRate"]["num"]
        .as_u64()
        .unwrap_or(30)
        .max(1) as u32;
    let fps_den = asset["media"]["frameRate"]["den"]
        .as_u64()
        .unwrap_or(1)
        .max(1) as u32;
    let duration_frames = asset["media"]["durationFrames"].as_u64().unwrap_or(0);
    let fps = fps_num as f64 / fps_den as f64;
    let duration_seconds = if duration_frames > 0 {
        duration_frames as f64 / fps.max(1.0)
    } else {
        0.0
    };
    let hash = asset["integrity"]["sha256"]
        .as_str()
        .unwrap_or(asset_id.as_str())
        .to_string();
    let threshold = scene_threshold.unwrap_or(0.35).clamp(0.05, 0.9);
    let silence_db = silence_db.unwrap_or(-32.0).clamp(-60.0, -10.0);
    let min_silence = min_silence_seconds.unwrap_or(0.35).clamp(0.15, 3.0);
    let include_samples = include_samples.unwrap_or(true);
    let cache_key = format!(
        "analysis-v{ANALYSIS_VERSION}:{hash}:{:.3}:{:.3}:{:.1}:{:.2}:{include_samples}",
        threshold, duration_seconds, silence_db, min_silence
    );
    if let Ok(cache) = state.analysis_cache.lock() {
        if let Some(hit) = cache.get(&cache_key) {
            return Ok(hit.clone());
        }
    }
    if let Some(hit) = load_disk_cache(&state.cache_dir, &cache_key) {
        if let Ok(mut cache) = state.analysis_cache.lock() {
            if cache.len() > 96 {
                cache.clear();
            }
            cache.insert(cache_key.clone(), hit.clone());
        }
        return Ok(hit);
    }

    let measured = measure_media(
        &ffmpeg,
        &path,
        kind,
        duration_seconds,
        threshold,
        silence_db,
        min_silence,
        include_samples,
    );
    let AnalysisMeasurements {
        scenes,
        silences,
        blacks,
        freezes,
        loudness,
        luma,
        saturation,
        warnings,
    } = measured;

    let has_audio = kind == "audio" || loudness.is_some();
    let analysis = MediaAnalysis {
        asset_id,
        kind: kind.to_string(),
        duration_seconds,
        fps_num,
        fps_den,
        has_audio,
        scenes,
        silences,
        blacks,
        freezes,
        loudness,
        luma_average: luma,
        saturation_average: saturation,
        warnings: warnings
            .into_iter()
            .map(|warning| sanitize_log(&warning, &session.root, 240))
            .collect(),
    };
    if let Ok(mut cache) = state.analysis_cache.lock() {
        if cache.len() > 96 {
            cache.clear();
        }
        cache.insert(cache_key.clone(), analysis.clone());
    }
    save_disk_cache(&state.cache_dir, &cache_key, &analysis);
    Ok(analysis)
}
