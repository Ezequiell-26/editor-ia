#[tauri::command]
pub async fn choose_download_directory(app: AppHandle) -> Result<Option<String>, ProjectError> {
    let default = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let Some(folder) = app
        .dialog()
        .file()
        .set_title("Elegir carpeta para las descargas")
        .set_directory(default)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let folder = folder.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "No se pudo usar la carpeta elegida.")
    })?;
    if !folder.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "La ruta elegida no es una carpeta.",
        ));
    }
    Ok(Some(folder.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn download_media(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> Result<DownloadOutcome, ProjectError> {
    let engine = resolve_engine(&state.config_dir)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let ffmpeg_outcome = ffmpeg.clone();
    let ffprobe_outcome = ffprobe.clone();
    let cache_dir = state.cache_dir.clone();
    let url = validate_url(&request.url)?;
    let cookies = validate_cookies_file(request.cookies_file.as_deref())?;
    let destination = if request.save_to_downloads.unwrap_or(true) {
        let base = app
            .path()
            .download_dir()
            .map_err(|_| provider_error("No se pudo ubicar la carpeta de Descargas de Windows."))?;
        let root = resolve_destination_root(
            request.destination_root.as_deref(),
            base.join("Videos descargados"),
        )?;
        Some(root.join(platform_folder(&url)))
    } else {
        None
    };
    if let Some(root) = destination.as_ref() {
        if let Some(free) = available_disk_bytes(root) {
            let estimate = request.estimated_bytes.unwrap_or(0);
            let multiplier = if request.upscale.unwrap_or(false) {
                3
            } else {
                2
            };
            let required = if estimate > 0 {
                estimate.saturating_mul(multiplier)
            } else {
                1_500_000_000
            };
            if free < required {
                return Err(provider_error(format!(
                    "Espacio insuficiente en disco: hay {} MB libres y se estiman {} MB para esta descarga.",
                    free / 1_000_000,
                    required / 1_000_000
                )));
            }
        }
    }
    let run_id = request
        .run_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut request = DownloadRequest {
        url,
        run_id: Some(run_id.clone()),
        save_to_downloads: None,
        destination_root: None,
        ..request
    };
    request.cookies_file = None;
    let metadata_title = request
        .metadata_title
        .as_deref()
        .map(|value| value.chars().take(200).collect::<String>());
    let metadata_artist = request
        .metadata_artist
        .as_deref()
        .map(|value| value.chars().take(200).collect::<String>());
    let metadata_comment = request
        .metadata_comment
        .as_deref()
        .map(|value| value.chars().take(500).collect::<String>());
    let cover_path = request
        .cover_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if let Some(cover) = cover_path.as_ref() {
        let extension = cover
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if !cover.is_file() || !IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        {
            return Err(invalid_error(
                "La carátula elegida no es una imagen válida.",
            ));
        }
    }
    let hash_files = request.hash_files.unwrap_or(false);
    let expected_sha256 = match request
        .expected_sha256
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) if value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()) => {
            Some(value.to_ascii_lowercase())
        }
        Some(_) => {
            return Err(invalid_error(
                "El SHA-256 esperado debe tener 64 caracteres hexadecimales.",
            ))
        }
        None => None,
    };
    let piper_assets = crate::commands::piper::resolve_assets(&app);
    let watermark_asset = crate::commands::piper::resolve_watermark(&app);
    let progress_app = app.clone();
    let progress_run = run_id.clone();
    let progress = move |stage: &str, percent: Option<f64>, message: &str| {
        emit_progress(
            &progress_app,
            &progress_run,
            stage,
            percent,
            message.to_owned(),
        );
    };
    let blocking_result = tauri::async_runtime::spawn_blocking(move || {
        download_blocking(
            &progress,
            &engine,
            &cache_dir,
            request,
            ffmpeg,
            ffprobe,
            cookies.as_deref(),
            piper_assets,
            watermark_asset,
        )
    })
    .await;
    let mut outcome =
        blocking_result.map_err(|_| provider_error("La descarga se interrumpió."))??;
    if let Some(root) = destination {
        let original = PathBuf::from(&outcome.directory);
        let destination = download_folder_name(&outcome.files)
            .map(|folder| root.join(folder))
            .unwrap_or(root);
        move_download_to(&mut outcome, &destination)?;
        let _ = std::fs::remove_dir_all(original);
        let saved_in = outcome.directory.clone();
        outcome.warnings.push(format!("Guardado en {saved_in}."));
    }
    outcome.subtitles = read_download_subtitles(&outcome.files);
    if let Some(ffmpeg) = ffmpeg_outcome.as_deref() {
        for file in &mut outcome.files {
            if !matches!(file.kind.as_str(), "video" | "audio") {
                continue;
            }
            let extension = Path::new(&file.path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if cover_path.is_some() && extension == "webm" {
                outcome.warnings.push(
                    "WebM no admite carátula adjunta; se escribieron sólo los metadatos."
                        .to_owned(),
                );
            }
            match apply_metadata_cover(
                ffmpeg,
                Path::new(&file.path),
                metadata_title.as_deref(),
                metadata_artist.as_deref(),
                metadata_comment.as_deref(),
                cover_path.as_deref(),
            ) {
                Ok(()) => {
                    if let Ok(metadata) = std::fs::metadata(&file.path) {
                        file.bytes = metadata.len();
                    }
                }
                Err(message) => outcome.warnings.push(format!(
                    "No se pudieron escribir metadatos en {}: {message}",
                    file.name
                )),
            }
        }
    }
    if hash_files || expected_sha256.is_some() {
        let mut matched = false;
        for file in &mut outcome.files {
            if file.sha256.is_none() {
                let (md5, sha256) = hash_file(Path::new(&file.path));
                if md5.is_some() {
                    file.md5 = md5;
                }
                file.sha256 = sha256;
            }
            if expected_sha256
                .as_deref()
                .is_some_and(|expected| file.sha256.as_deref() == Some(expected))
            {
                matched = true;
            }
        }
        if let Some(expected) = expected_sha256 {
            if matched {
                outcome
                    .warnings
                    .push("SHA-256 esperado verificado en un archivo descargado.".to_owned());
            } else {
                return Err(invalid_error(format!(
                    "Ningún archivo coincide con el SHA-256 esperado ({expected}). Los archivos quedaron en {}.",
                    outcome.directory
                )));
            }
        }
    }
    for file in &mut outcome.files {
        if file.kind == "video" {
            file.chapters = probe_chapters(ffprobe_outcome.as_deref(), Path::new(&file.path));
        }
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn cleanup_download(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<(), ProjectError> {
    let id = Uuid::parse_str(&run_id)
        .map_err(|_| invalid_error("El identificador de descarga no es válido."))?;
    let downloads = state.cache_dir.join("downloads");
    let target = downloads.join(id.to_string());
    let Ok(canonical_downloads) = downloads.canonicalize() else {
        return Ok(());
    };
    let Ok(canonical_target) = target.canonicalize() else {
        return Ok(());
    };
    if !canonical_target.starts_with(&canonical_downloads) {
        return Err(ProjectError::message(
            ProjectErrorCode::PathEscapesRoot,
            "La carpeta de descarga cae fuera del caché de la app.",
        ));
    }
    std::fs::remove_dir_all(&canonical_target)
        .map_err(|_| io_error("No se pudo limpiar la descarga temporal."))?;
    Ok(())
}
