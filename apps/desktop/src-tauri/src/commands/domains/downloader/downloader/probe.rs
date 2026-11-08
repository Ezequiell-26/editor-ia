pub(crate) fn validate_url(raw: &str) -> Result<String, ProjectError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_URL_LENGTH {
        return Err(invalid_error("Pegá una URL http(s) válida."));
    }
    let parsed = reqwest::Url::parse(trimmed).map_err(|_| {
        invalid_error("La URL no es válida. Tiene que empezar con http:// o https://.")
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(invalid_error("Sólo se aceptan URLs http o https."));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| invalid_error("La URL no tiene un host válido."))?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        return Err(invalid_error("La URL no tiene un host válido."));
    }
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") {
        return Err(invalid_error("No se permiten direcciones locales."));
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        let private = match ip {
            IpAddr::V4(value) => {
                value.is_private()
                    || value.is_loopback()
                    || value.is_link_local()
                    || value.is_unspecified()
            }
            IpAddr::V6(value) => {
                value.is_loopback()
                    || value.is_unspecified()
                    || value.is_unique_local()
                    || value.is_unicast_link_local()
            }
        };
        if private {
            return Err(invalid_error(
                "No se permiten direcciones privadas ni locales.",
            ));
        }
    }
    Ok(parsed.to_string())
}

fn validate_cookies_file(raw: Option<&str>) -> Result<Option<PathBuf>, ProjectError> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(raw);
    let metadata = std::fs::metadata(&path)
        .map_err(|_| invalid_error("El archivo de cookies no existe en esa ruta."))?;
    if !metadata.is_file() {
        return Err(invalid_error(
            "Las cookies tienen que ser un archivo de texto.",
        ));
    }
    if metadata.len() == 0 || metadata.len() > 10 * 1024 * 1024 {
        return Err(invalid_error(
            "El archivo de cookies está vacío o supera los 10 MB.",
        ));
    }
    Ok(Some(path))
}

fn cookies_browser(raw: Option<&str>) -> Result<Option<String>, ProjectError> {
    let Some(value) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let value = value.to_ascii_lowercase();
    if matches!(
        value.as_str(),
        "chrome" | "edge" | "firefox" | "brave" | "chromium" | "opera" | "vivaldi"
    ) {
        Ok(Some(value))
    } else {
        Err(invalid_error("El navegador de cookies no es compatible."))
    }
}

#[tauri::command]
pub async fn download_disk_space(
    app: AppHandle,
    path: Option<String>,
) -> Result<u64, ProjectError> {
    let target = path
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| app.path().download_dir().ok())
        .ok_or_else(|| provider_error("No se pudo ubicar la carpeta de Descargas."))?;
    available_disk_bytes(&target)
        .ok_or_else(|| provider_error("No se pudo medir el espacio libre del disco."))
}

#[tauri::command]
pub async fn choose_cookies_file(app: AppHandle) -> Result<Option<String>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Elegir cookies.txt exportadas del navegador")
        .add_filter("Cookies Netscape", &["txt", "cookies"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|_| io_error("No se pudo usar el archivo de cookies elegido."))?;
    validate_cookies_file(Some(&path.to_string_lossy()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn is_youtube_host(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    host == "youtu.be"
        || host == "youtube.com"
        || host.ends_with(".youtube.com")
        || host == "youtube-nocookie.com"
        || host.ends_with(".youtube-nocookie.com")
}

fn host_matches(host: &str, domains: &[&str]) -> bool {
    domains
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

/// Fixed folder names used below Downloads/Videos descargados. The URL is
/// parsed, never used as a path, so a site cannot choose or escape the folder.
pub(crate) fn platform_folder(raw: &str) -> &'static str {
    let Ok(url) = reqwest::Url::parse(raw) else {
        return "Otros";
    };
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if host_matches(&host, &["youtube.com", "youtu.be", "youtube-nocookie.com"]) {
        "YouTube"
    } else if host_matches(&host, &["tiktok.com"]) {
        "TikTok"
    } else if host_matches(&host, &["instagram.com"]) {
        "Instagram"
    } else if host_matches(&host, &["facebook.com", "fb.watch"]) {
        "Facebook"
    } else if host_matches(&host, &["x.com", "twitter.com"]) {
        "X"
    } else if host_matches(&host, &["vimeo.com"]) {
        "Vimeo"
    } else if host_matches(&host, &["twitch.tv"]) {
        "Twitch"
    } else if host_matches(&host, &["pinterest.com", "pin.it"]) {
        "Pinterest"
    } else if host_matches(&host, &["reddit.com", "redd.it"]) {
        "Reddit"
    } else if host_matches(&host, &["threads.net"]) {
        "Threads"
    } else if host_matches(&host, &["snapchat.com"]) {
        "Snapchat"
    } else {
        "Otros"
    }
}

fn video_format_selector(quality: &str, max_height: u32) -> String {
    if quality == "worst" {
        return "worstvideo[height>=144]+worstaudio/worst[height>=144]/worst".to_owned();
    }
    format!("bestvideo[height<={max_height}]+bestaudio/best[height<={max_height}]/best")
}

/// Orden de selección para `-S` (yt-dlp `--format-sort`): máxima resolución
/// primero; a igual resolución y fps gana el códec más eficiente — el orden
/// interno de `vcodec` de yt-dlp ya es av01 > vp9 > h265 > h264, así que a
/// igual píxel se baja el peso sin tocar la imagen (nunca se re-codifica,
/// sólo se elige el stream). `lang` va después de `vcodec` para no tocar la
/// elección de video pero sí desempatar el audio por idioma. `acodec`
/// prefiere opus/mp4a sobre el resto.
fn video_format_sort(audio_language: Option<&str>) -> String {
    match audio_language.filter(|lang| *lang != "all") {
        Some(lang) => format!("res,fps,vcodec,lang:{lang},acodec,ext,proto,hasaud"),
        None => "res,fps,vcodec,acodec,ext,proto,hasaud".to_owned(),
    }
}

fn truncate(value: &str, limit: usize) -> String {
    value.trim().chars().take(limit).collect()
}

fn error_tail(stderr: &str, fallback: &str) -> String {
    let line = stderr
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(fallback);
    truncate(line, 320)
}

fn guess_kind(ext: &str, vcodec: &str, acodec: &str) -> &'static str {
    let ext = ext.to_ascii_lowercase();
    if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return "image";
    }
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) && vcodec != "none" {
        return "video";
    }
    if AUDIO_EXTENSIONS.contains(&ext.as_str()) || (vcodec == "none" && acodec != "none") {
        return "audio";
    }
    "video"
}

fn format_size_from_json(format: &Value, duration: f64) -> Option<u64> {
    if let Some(size) = format["filesize"].as_u64() {
        return Some(size);
    }
    if let Some(size) = format["filesize_approx"].as_u64() {
        return Some(size);
    }
    let tbr = format["tbr"].as_f64().or_else(|| format["vbr"].as_f64())?;
    if duration <= 0.0 {
        return None;
    }
    Some((tbr * 1_000.0 * duration / 8.0).round().max(0.0) as u64)
}

fn height_label(height: u32) -> String {
    match height {
        4_320 => "4320p · 8K".to_owned(),
        2_880 => "2880p · 5K".to_owned(),
        2_160 => "2160p · 4K".to_owned(),
        1_440 => "1440p · 2K".to_owned(),
        1_080 => "1080p · Full HD".to_owned(),
        720 => "720p · HD".to_owned(),
        480 => "480p · SD".to_owned(),
        _ => format!("{height}p"),
    }
}

fn qualities_from_formats(
    formats: &[Value],
    duration: f64,
    with_sizes: bool,
) -> (Vec<DownloadQuality>, Option<u32>) {
    let mut best_audio_size: Option<u64> = None;
    for format in formats {
        let vcodec = format["vcodec"].as_str().unwrap_or("none");
        let acodec = format["acodec"].as_str().unwrap_or("none");
        if vcodec == "none" && acodec != "none" {
            if let Some(size) = format_size_from_json(format, duration) {
                best_audio_size = Some(best_audio_size.map_or(size, |current| current.max(size)));
            }
        }
    }
    let audio_estimate = best_audio_size.or_else(|| {
        if with_sizes && duration > 0.0 {
            Some((160_000.0 * duration / 8.0).round() as u64)
        } else {
            None
        }
    });

    let mut per_height: BTreeMap<u32, (DownloadQuality, f64)> = BTreeMap::new();
    for format in formats {
        let vcodec = format["vcodec"].as_str().unwrap_or("none");
        if vcodec == "none" {
            continue;
        }
        let Some(height) = format["height"].as_u64().map(|value| value as u32) else {
            continue;
        };
        if height == 0 || height > MAX_HEIGHT {
            continue;
        }
        let acodec = format["acodec"].as_str().unwrap_or("none");
        let own_size = format_size_from_json(format, duration);
        let total_size = if !with_sizes {
            None
        } else if acodec != "none" {
            own_size
        } else {
            match (own_size, audio_estimate) {
                (Some(video), Some(audio)) => Some(video.saturating_add(audio)),
                (Some(video), None) => Some(video),
                (None, Some(audio)) => Some(audio),
                (None, None) => None,
            }
        };
        let tbr = format["tbr"].as_f64().unwrap_or(0.0);
        let candidate = DownloadQuality {
            height,
            label: height_label(height),
            width: format["width"].as_u64().map(|value| value as u32),
            fps: format["fps"].as_f64(),
            ext: format["ext"].as_str().map(str::to_owned),
            vcodec: format["vcodec"].as_str().map(str::to_owned),
            filesize: total_size,
        };
        match per_height.get(&height) {
            Some((_, current_tbr)) if *current_tbr >= tbr => {}
            _ => {
                per_height.insert(height, (candidate, tbr));
            }
        }
    }
    let mut qualities: Vec<DownloadQuality> = per_height
        .into_values()
        .map(|(quality, _)| quality)
        .collect();
    qualities.sort_by_key(|quality| std::cmp::Reverse(quality.height));
    let max_height = qualities.first().map(|quality| quality.height);
    (qualities, max_height)
}

fn merge_gallery_qualities(entries: &[Value]) -> (Vec<DownloadQuality>, Option<u32>) {
    let mut heights: BTreeMap<u32, DownloadQuality> = BTreeMap::new();
    for entry in entries {
        let formats = entry["formats"].as_array().cloned().unwrap_or_default();
        let duration = entry["duration"].as_f64().unwrap_or(0.0);
        let (qualities, _) = qualities_from_formats(&formats, duration, false);
        for quality in qualities {
            heights.entry(quality.height).or_insert(quality);
        }
    }
    let mut qualities: Vec<DownloadQuality> = heights.into_values().collect();
    qualities.sort_by_key(|quality| std::cmp::Reverse(quality.height));
    let max_height = qualities.first().map(|quality| quality.height);
    (qualities, max_height)
}

fn probe_value(url: String, value: &Value) -> Result<DownloadProbe, ProjectError> {
    let entries = value["entries"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry.is_object())
                .cloned()
                .collect::<Vec<Value>>()
        })
        .filter(|entries| !entries.is_empty());
    if let Some(entries) = entries {
        if value["_type"].as_str() == Some("playlist") || entries.len() > 1 {
            if entries.len() > MAX_GALLERY_ITEMS {
                return Err(invalid_error(
                    "La URL parece una lista o un canal con demasiados elementos. Pegá la URL de un post individual.",
                ));
            }
            let images = entries
                .iter()
                .filter(|entry| {
                    let ext = entry["ext"].as_str().unwrap_or("");
                    IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
                })
                .count();
            let all_images = images == entries.len();
            let title = truncate(
                value["title"]
                    .as_str()
                    .or_else(|| entries.first().and_then(|entry| entry["title"].as_str()))
                    .unwrap_or("Publicación"),
                200,
            );
            let duration = entries
                .iter()
                .filter_map(|entry| entry["duration"].as_f64())
                .reduce(|left, right| left + right);
            let estimated = if all_images {
                entries.iter().try_fold(0u64, |total, entry| {
                    let size = format_size_from_json(entry, 0.0)?;
                    Some(total.saturating_add(size))
                })
            } else {
                None
            };
            let (qualities, max_height) = merge_gallery_qualities(&entries);
            return Ok(DownloadProbe {
                url,
                title,
                uploader: value["uploader"]
                    .as_str()
                    .or_else(|| value["channel"].as_str())
                    .map(|value| truncate(value, 120)),
                duration_seconds: duration,
                thumbnail: value["thumbnail"].as_str().map(str::to_owned).or_else(|| {
                    entries
                        .first()
                        .and_then(|entry| entry["thumbnail"].as_str())
                        .map(str::to_owned)
                }),
                kind: "gallery".to_owned(),
                entry_count: entries.len(),
                max_height,
                estimated_bytes: estimated,
                qualities,
            });
        }
    }

    let ext = value["ext"].as_str().unwrap_or("mp4");
    let vcodec = value["vcodec"].as_str().unwrap_or("none");
    let acodec = value["acodec"].as_str().unwrap_or("none");
    let kind = guess_kind(ext, vcodec, acodec);
    let formats = value["formats"].as_array().cloned().unwrap_or_default();
    let duration = value["duration"].as_f64();
    let (qualities, max_height) = if kind == "video" {
        qualities_from_formats(&formats, duration.unwrap_or(0.0), true)
    } else {
        (Vec::new(), None)
    };
    let estimated_bytes = if kind == "image" || kind == "audio" {
        format_size_from_json(value, duration.unwrap_or(0.0))
    } else {
        qualities.first().and_then(|quality| quality.filesize)
    };
    Ok(DownloadProbe {
        url,
        title: truncate(value["title"].as_str().unwrap_or("Sin título"), 200),
        uploader: value["uploader"]
            .as_str()
            .or_else(|| value["channel"].as_str())
            .or_else(|| value["creator"].as_str())
            .map(|value| truncate(value, 120)),
        duration_seconds: duration,
        thumbnail: value["thumbnail"].as_str().map(str::to_owned),
        kind: kind.to_owned(),
        entry_count: 1,
        max_height,
        estimated_bytes,
        qualities,
    })
}

fn probe_blocking(
    app: &AppHandle,
    engine: &Path,
    url: &str,
    cookies: Option<&Path>,
    cookies_browser: Option<&str>,
) -> Result<DownloadProbe, ProjectError> {
    emit_progress(app, "", "probing", None, "Consultando la URL…");
    probe_with_engine(engine, url, cookies, cookies_browser)
}

pub(crate) fn probe_with_engine(
    engine: &Path,
    url: &str,
    cookies: Option<&Path>,
    cookies_browser: Option<&str>,
) -> Result<DownloadProbe, ProjectError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| invalid_error("La URL no es válida."))?;
    let mut command = Command::new(engine);
    command.args([
        "--dump-single-json",
        "--no-warnings",
        "--ignore-config",
        "--socket-timeout",
        "25",
        "--retries",
        "2",
        "--playlist-end",
        "13",
    ]);
    if is_youtube_host(&parsed) {
        command.arg("--no-playlist");
    }
    if let Some(cookies) = cookies {
        command.arg("--cookies").arg(cookies);
    } else if let Some(browser) = cookies_browser {
        command.args(["--cookies-from-browser", browser]);
    }
    command.arg(url);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let output = command
        .output()
        .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para analizar la URL."))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(provider_error(format!(
            "No se pudo analizar la URL: {}",
            error_tail(&stderr, "yt-dlp falló")
        )));
    }
    if output.stdout.len() > MAX_PROBE_BYTES {
        return Err(provider_error(
            "La respuesta del sitio es demasiado grande para analizarla.",
        ));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| provider_error("El sitio devolvió datos que no se pudieron interpretar."))?;
    probe_value(url.to_owned(), &value)
}

#[tauri::command]
pub async fn probe_download(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    cookies_file: Option<String>,
    cookies_from_browser: Option<String>,
) -> Result<DownloadProbe, ProjectError> {
    let validated = validate_url(&url)?;
    let cookies = validate_cookies_file(cookies_file.as_deref())?;
    let browser = cookies_browser(cookies_from_browser.as_deref())?;
    let engine = resolve_engine(&state.config_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        probe_blocking(
            &app,
            &engine,
            &validated,
            cookies.as_deref(),
            browser.as_deref(),
        )
    })
    .await
    .map_err(|_| provider_error("El análisis de la URL se interrumpió."))?
}
