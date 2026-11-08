fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("archivo");
    let direct = directory.join(file_name);
    if !direct.exists() {
        return direct;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 2..=999 {
        let candidate = directory.join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let suffix = &Uuid::new_v4().to_string()[..8];
    directory.join(format!("{stem}-{suffix}{extension}"))
}

/// Turns the downloaded file stem into a folder name. Invalid Windows
/// characters are replaced, whitespace is collapsed and the name is capped so
/// the final path stays usable. The original file name remains untouched.
/// Windows still fails with OSError 22 when the temporary path + title +
/// yt-dlp suffixes cross MAX_PATH. Keep the readable title below 60 chars and
/// let yt-dlp produce Windows-safe names; the per-video folder is derived from
/// that short stem.
fn parse_playlist_entries(value: &Value, limit: usize) -> Vec<PlaylistEntry> {
    value["entries"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(position, entry)| {
            let title = entry["title"].as_str()?.trim();
            if title.is_empty() {
                return None;
            }
            let url = entry["webpage_url"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| entry["url"].as_str().map(str::to_owned))
                .or_else(|| {
                    entry["id"]
                        .as_str()
                        .map(|id| format!("https://www.youtube.com/watch?v={id}"))
                });
            Some(PlaylistEntry {
                index: entry["playlist_index"]
                    .as_u64()
                    .map(|value| value as usize)
                    .unwrap_or(position + 1),
                title: title.chars().take(200).collect(),
                url,
                duration_seconds: entry["duration"].as_f64(),
            })
        })
        .take(limit.clamp(1, 1000))
        .collect()
}

fn parse_audio_tracks(value: &Value) -> Vec<AudioTrack> {
    let mut tracks = Vec::new();
    for format in value["formats"].as_array().into_iter().flatten() {
        if format["acodec"].as_str().unwrap_or("none") == "none" {
            continue;
        }
        if format["vcodec"].as_str().unwrap_or("none") != "none" {
            continue;
        }
        let Some(format_id) = format["format_id"].as_str() else {
            continue;
        };
        if tracks
            .iter()
            .any(|track: &AudioTrack| track.format_id == format_id)
        {
            continue;
        }
        tracks.push(AudioTrack {
            format_id: format_id.to_owned(),
            language: format["language"].as_str().map(str::to_owned),
            ext: format["ext"].as_str().map(str::to_owned),
            abr: format["abr"].as_f64(),
            note: format["format_note"].as_str().map(str::to_owned),
        });
        if tracks.len() >= 30 {
            break;
        }
    }
    tracks.sort_by(|a, b| {
        b.abr
            .unwrap_or(0.0)
            .partial_cmp(&a.abr.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    tracks
}

fn valid_format_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '+'))
}

fn audio_language(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let lower = value.to_ascii_lowercase();
    if lower == "all" {
        return Ok(Some(lower));
    }
    let valid = lower.split('-').enumerate().all(|(index, part)| {
        let expected = if index == 0 { 2..=3 } else { 2..=2 };
        expected.contains(&part.len()) && part.chars().all(|ch| ch.is_ascii_alphabetic())
    });
    if !valid || lower.split('-').count() > 2 {
        return Err("El idioma de audio debe ser un código como es, en, pt-BR o all.".to_owned());
    }
    Ok(Some(lower))
}

fn download_output_template(directory: &Path, template: Option<&str>) -> Result<String, String> {
    let default = "%(title).60s [%(id)s]";
    let custom = template.map(str::trim).filter(|value| !value.is_empty());
    let mut name = if let Some(custom) = custom {
        if custom.len() > 120
            || custom.contains("..")
            || custom.chars().any(|character| {
                character.is_control()
                    || matches!(
                        character,
                        '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                    )
            })
        {
            return Err(
                "La plantilla de nombre no puede superar 120 caracteres ni incluir rutas o caracteres prohibidos."
                    .to_owned(),
            );
        }
        custom
            .replace("{title}", "%(title).60s")
            .replace("{id}", "%(id)s")
            .replace("{platform}", "%(extractor)s")
            .replace("{height}", "%(height)s")
            .replace("{date}", "%(upload_date)s")
    } else {
        default.to_owned()
    };
    if name.trim().is_empty() {
        name = default.to_owned();
    }
    Ok(directory
        .join(format!("{name}.%(ext)s"))
        .to_string_lossy()
        .into_owned())
}

fn playlist_items(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 100
        || !value
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, ',' | '-' | ':'))
    {
        return Err(
            "Los elementos de playlist sólo aceptan números, comas, guiones y dos puntos (ej. 1-10 o 1,3,5)."
                .to_owned(),
        );
    }
    Ok(Some(value.to_owned()))
}

pub(crate) fn folder_from_file_name(name: &str) -> Option<String> {
    let raw_stem = Path::new(name).file_stem()?.to_string_lossy();
    let stem = raw_stem
        .strip_suffix(" - compacto")
        .unwrap_or(raw_stem.as_ref());
    let mut cleaned = String::with_capacity(stem.len());
    for character in stem.chars() {
        if character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        {
            cleaned.push('_');
        } else {
            cleaned.push(character);
        }
    }
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed
        .trim_matches([' ', '.'])
        .chars()
        .take(80)
        .collect::<String>();
    let trimmed = trimmed.trim_end_matches([' ', '.']).to_owned();
    if trimmed.is_empty() {
        return None;
    }
    let upper = trimmed.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|value| (1..=9).contains(&value))
        || upper
            .strip_prefix("LPT")
            .and_then(|value| value.parse::<u8>().ok())
            .is_some_and(|value| (1..=9).contains(&value));
    Some(if reserved {
        format!("_{trimmed}")
    } else {
        trimmed
    })
}

fn download_folder_name(files: &[DownloadedFile]) -> Option<String> {
    files
        .first()
        .and_then(|file| folder_from_file_name(&file.name))
}

/// The user can choose any existing folder, so downloads can live on another
/// disk. The default is Downloads/Videos descargados. The chosen folder stays
/// as typed (no `\\?\` prefix) and is validated before any file is moved.
fn resolve_destination_root(
    chosen: Option<&str>,
    default: PathBuf,
) -> Result<PathBuf, ProjectError> {
    let Some(chosen) = chosen.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(default);
    };
    let path = PathBuf::from(chosen);
    if !path.is_absolute() {
        return Err(invalid_error(
            "La carpeta de descarga debe ser una ruta absoluta.",
        ));
    }
    if !path.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "La carpeta de descarga ya no existe. Elegí otra carpeta.",
        ));
    }
    Ok(path)
}

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

fn move_download_to(outcome: &mut DownloadOutcome, destination: &Path) -> Result<(), ProjectError> {
    std::fs::create_dir_all(destination)
        .map_err(|_| io_error("No se pudo crear Videos descargados."))?;
    let mut moved = Vec::with_capacity(outcome.files.len());
    for file in &outcome.files {
        let source = PathBuf::from(&file.path);
        let target = unique_destination(destination, &file.name);
        if std::fs::rename(&source, &target).is_err() {
            std::fs::copy(&source, &target)
                .map_err(|_| io_error("No se pudo guardar el archivo en Descargas."))?;
            std::fs::remove_file(&source).map_err(|_| {
                io_error("Se copió el archivo pero no se pudo limpiar el temporal.")
            })?;
        }
        let bytes = std::fs::metadata(&target)
            .map(|metadata| metadata.len())
            .unwrap_or(file.bytes);
        moved.push(DownloadedFile {
            path: target.to_string_lossy().into_owned(),
            name: target
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| file.name.clone()),
            bytes,
            kind: file.kind.clone(),
            md5: file.md5.clone(),
            sha256: file.sha256.clone(),
            chapters: file.chapters.clone(),
        });
    }
    outcome.files = moved;
    outcome.directory = destination.to_string_lossy().into_owned();
    Ok(())
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
