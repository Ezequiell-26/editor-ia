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

    let measured = {
        let ffmpeg = ffmpeg.clone();
        let path = path.clone();
        let kind = kind.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            measure_media(
                &ffmpeg,
                &path,
                &kind,
                duration_seconds,
                threshold,
                silence_db,
                min_silence,
                include_samples,
            )
        })
        .await
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                format!("no se pudo analizar el material: {error}").as_str(),
            )
        })?
    };
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

/// fps del stream de video del JSON de ffprobe (`avg_frame_rate` "30000/1001").
fn probe_fps(value: &serde_json::Value) -> (u32, u32) {
    let rate = value["streams"]
        .as_array()
        .and_then(|streams| {
            streams
                .iter()
                .find(|stream| stream["codec_type"] == "video")
        })
        .and_then(|stream| stream["avg_frame_rate"].as_str())
        .unwrap_or("");
    let mut parts = rate.split('/');
    let num = parts.next().and_then(|text| text.parse::<u32>().ok()).unwrap_or(30);
    let den = parts.next().and_then(|text| text.parse::<u32>().ok()).unwrap_or(1);
    (num.max(1), den.max(1))
}

/// QC de un archivo suelto (típicamente un MP4 recién exportado): corre las
/// mismas pasadas de detección que `analyze_media` — escenas, silencios,
/// negros, congelados y loudness — sin exigir proyecto abierto. La ruta pasa
/// por la política de lectura de `fs_*` (absoluta, fuera de credenciales).
#[tauri::command]
pub async fn qc_media_file(
    state: State<'_, AppState>,
    path: String,
    scene_threshold: Option<f64>,
    silence_db: Option<f64>,
    min_silence_seconds: Option<f64>,
) -> Result<MediaAnalysis, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg/ffprobe no están disponibles para el control de calidad",
        ));
    };
    let runner = state.media_runner();
    let threshold = scene_threshold.unwrap_or(0.35).clamp(0.05, 0.9);
    let silence_db = silence_db.unwrap_or(-32.0).clamp(-60.0, -10.0);
    let min_silence = min_silence_seconds.unwrap_or(0.35).clamp(0.15, 3.0);

    let measured = tauri::async_runtime::spawn_blocking(move || {
        let input = crate::application::fs::resolve_user_file_path(&path)?;
        if !input.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "el archivo no está en disco",
            ));
        }
        let json = crate::application::media::probe_file_json(
            &runner,
            Some(ffprobe.as_path()),
            &input,
        )?;
        let probe = crate::ports::media::MediaProbe::from_value(&input, &json);
        let kind = if probe.video_codec.is_some() {
            "video"
        } else if probe.audio_codec.is_some() {
            "audio"
        } else {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el archivo no tiene pistas de video ni de audio",
            ));
        };
        let duration_seconds = probe.duration_seconds.unwrap_or(0.0);
        let (fps_num, fps_den) = probe_fps(&json);
        let AnalysisMeasurements {
            scenes,
            silences,
            blacks,
            freezes,
            loudness,
            luma,
            saturation,
            warnings,
        } = measure_media(
            &ffmpeg,
            &input,
            kind,
            duration_seconds,
            threshold,
            silence_db,
            min_silence,
            false,
        );
        Ok::<_, ProjectError>((
            input.to_string_lossy().into_owned(),
            kind.to_string(),
            duration_seconds,
            fps_num,
            fps_den,
            scenes,
            silences,
            blacks,
            freezes,
            loudness,
            luma,
            saturation,
            warnings,
        ))
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo medir el archivo: {error}").as_str(),
        )
    })??;

    let (
        asset_id,
        kind,
        duration_seconds,
        fps_num,
        fps_den,
        scenes,
        silences,
        blacks,
        freezes,
        loudness,
        luma,
        saturation,
        warnings,
    ) = measured;
    let has_audio = kind == "audio" || loudness.is_some();
    Ok(MediaAnalysis {
        asset_id,
        kind,
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
        warnings,
    })
}
