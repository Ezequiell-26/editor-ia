pub(crate) fn download_blocking(
    progress: ProgressSink<'_>,
    engine: &Path,
    cache_dir: &Path,
    request: DownloadRequest,
    ffmpeg: Option<PathBuf>,
    ffprobe: Option<PathBuf>,
    cookies: Option<&Path>,
    piper: Option<crate::commands::piper::PiperAssets>,
    watermark: Option<PathBuf>,
) -> Result<DownloadOutcome, ProjectError> {
    let run_id = request
        .run_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let control = register_control(&run_id)?;
    let _registry_guard = ControlRegistryGuard(run_id.clone());
    let _thread_guard = set_thread_control(control.clone());
    control.wait_until_running();
    if control.is_cancelled() {
        return Err(provider_error("Descarga cancelada."));
    }
    let validated = validate_url(&request.url)?;
    let kind = request.kind.as_deref().unwrap_or("video");
    if !matches!(kind, "video" | "image" | "audio" | "gallery") {
        return Err(invalid_error("El tipo de descarga no es válido."));
    }
    let compression = request.compression.as_deref().unwrap_or("none");
    let requested_crf = match compression {
        "none" => None,
        "high" => Some(20),
        "balanced" => Some(24),
        "compact" => Some(27),
        _ => return Err(invalid_error("El nivel de compresión no es válido.")),
    };
    let codec = match request.codec.as_deref().unwrap_or("h265") {
        "h265" | "h264" | "av1" => request.codec.as_deref().unwrap_or("h265"),
        _ => return Err(invalid_error("El códec de compresión no es válido.")),
    };
    let hdr_mode = match request.hdr_mode.as_deref().unwrap_or("tonemap") {
        "tonemap" => "tonemap",
        "preserve" => "preserve",
        _ => return Err(invalid_error("El modo HDR no es válido.")),
    };
    let quality = match request.quality.as_deref().unwrap_or("best") {
        "best" | "worst" | "height" => request.quality.as_deref().unwrap_or("best"),
        _ => return Err(invalid_error("La preferencia de calidad no es válida.")),
    };
    let requested_format = request
        .format
        .as_deref()
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let format = match requested_format.as_str() {
        "mp4" | "mkv" | "webm" | "mp3" | "m4a" => requested_format.as_str(),
        _ => return Err(invalid_error("El formato de salida no es válido.")),
    };
    let audio_only = matches!(format, "mp3" | "m4a");
    let proxy = request
        .proxy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(proxy) = proxy {
        let lower = proxy.to_ascii_lowercase();
        if !(lower.starts_with("http://")
            || lower.starts_with("https://")
            || lower.starts_with("socks4://")
            || lower.starts_with("socks5://"))
            || proxy.len() > 500
        {
            return Err(invalid_error(
                "El proxy debe ser http://, https://, socks4:// o socks5://.",
            ));
        }
    }
    let limit_rate = request
        .limit_rate
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(rate) = limit_rate {
        let valid = rate.len() <= 12
            && rate.chars().next().is_some_and(|ch| ch.is_ascii_digit())
            && rate
                .chars()
                .all(|ch| ch.is_ascii_digit() || matches!(ch, 'K' | 'M' | 'G' | 'k' | 'm' | 'g'));
        if !valid {
            return Err(invalid_error(
                "El límite de bajada debe ser un tamaño como 500K u 8M.",
            ));
        }
    }
    let download_subtitles = request.download_subtitles.unwrap_or(false);
    let subtitle_langs = subtitle_languages(request.subtitle_langs.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let download_thumbnail = request.download_thumbnail.unwrap_or(false);
    let download_chapters = request.download_chapters.unwrap_or(false);
    let sponsorblock = request.sponsorblock.unwrap_or(false);
    let keep_original = request.keep_original.unwrap_or(false);
    let sponsorblock_categories =
        sponsorblock_categories(request.sponsorblock_categories.as_deref())
            .map_err(|message| invalid_error(&message))?;
    let mut sponsorblock_mark = match request
        .sponsorblock_mark
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            sponsorblock_category_list(Some(value)).map_err(|message| invalid_error(&message))?
        }
        None => Vec::new(),
    };
    sponsorblock_mark.retain(|category| {
        !sponsorblock_categories
            .split(',')
            .any(|item| item == category.as_str())
    });
    let sponsorblock_mute = match request
        .sponsorblock_mute
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            sponsorblock_category_list(Some(value)).map_err(|message| invalid_error(&message))?
        }
        None => Vec::new(),
    };
    let cookies_from_browser = cookies_browser(request.cookies_from_browser.as_deref())?;
    let trim_start = request.trim_start.unwrap_or(0.0).max(0.0);
    let trim_end = request
        .trim_end
        .filter(|end| end.is_finite() && *end > trim_start);
    if request.trim_end.is_some() && trim_end.is_none() {
        return Err(invalid_error(
            "El recorte previo necesita un final mayor que el inicio.",
        ));
    }
    if trim_end.is_some() && matches!(kind, "image" | "gallery") {
        return Err(invalid_error(
            "El recorte previo sólo se aplica a videos o audio.",
        ));
    }
    let auto_route = request.auto_route.unwrap_or(false);
    if auto_route && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El enrutamiento automático sólo se aplica a videos.",
        ));
    }
    let delogo_enabled = request.delogo.unwrap_or(false);
    let manual_delogo = delogo_enabled.then_some(request.delogo_rect).flatten();
    if let Some(rect) = manual_delogo {
        if !rect.x.is_finite()
            || !rect.y.is_finite()
            || !rect.w.is_finite()
            || !rect.h.is_finite()
            || rect.x < 0.0
            || rect.y < 0.0
            || rect.w <= 0.0
            || rect.h <= 0.0
            || rect.x + rect.w > 1.0001
            || rect.y + rect.h > 1.0001
        {
            return Err(invalid_error(
                "El rectángulo del logo debe estar dentro del cuadro (fracciones 0–1).",
            ));
        }
    }
    let delogo_corner_value = if delogo_enabled {
        Some(
            delogo_corner(request.delogo_corner.as_deref())
                .map_err(|message| invalid_error(&message))?,
        )
    } else {
        None
    };
    let upscale_enabled = request.upscale.unwrap_or(false);
    let upscale_mode_value = if upscale_enabled {
        let mode = request
            .upscale_target
            .as_deref()
            .unwrap_or("auto")
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            mode.as_str(),
            "auto" | "1080" | "2160" | "full-hd" | "fhd" | "4k" | "uhd"
        ) {
            return Err(invalid_error(
                "El objetivo de escalado debe ser auto, 1080 o 2160.",
            ));
        }
        Some(mode)
    } else {
        None
    };
    if (delogo_enabled || upscale_enabled) && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El delogo y el escalado sólo se aplican a videos.",
        ));
    }
    let source_title = request.source_title.clone().unwrap_or_default();
    let source_duration = request.source_duration.unwrap_or(0.0);
    let route_decision =
        auto_route.then(|| AutoRouteDecision::pick(source_duration, &source_title));
    let long_video = route_decision
        .map(|route| route.long_video)
        .unwrap_or(source_duration > 60.0);
    let explicit_voice = request.voice_pipeline.unwrap_or(false);
    let mut voice_script = request.voice_script.clone().unwrap_or_default();
    if auto_route && voice_script.trim().is_empty() {
        voice_script = "Narración automática de Olyvia.".to_owned();
    }
    if explicit_voice && !auto_route && voice_script.trim().is_empty() {
        return Err(invalid_error(
            "Escribí el guion para la voz IA local antes de descargar.",
        ));
    }
    // La voz ya no es automática: el enrutador conserva y masteriza el audio
    // original del video corto. Piper sólo se usa si se pidió explícitamente.
    let voice_enabled = explicit_voice && !voice_script.trim().is_empty();
    let auto_pipeline = request.auto_pipeline.unwrap_or(false) || voice_enabled || auto_route;
    let has_replacement_audio = request
        .replacement_audio
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let mut audio_speed_noise = if let Some(route) = route_decision {
        route.speed_and_noise() && !has_replacement_audio && !voice_enabled
    } else {
        request.audio_speed_noise.unwrap_or(false)
    };
    let cinematic =
        request.cinematic.unwrap_or(false) || auto_pipeline || delogo_enabled || upscale_enabled;
    let watermark_enabled = request.watermark.unwrap_or(auto_route || voice_enabled);
    let cinematic_focus_value = if cinematic {
        Some(
            cinematic_focus(request.cinematic_focus.as_deref())
                .map_err(|message| invalid_error(&message))?,
        )
    } else {
        None
    };
    let replacement_audio = request
        .replacement_audio
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    if cinematic && matches!(kind, "image" | "audio") {
        return Err(invalid_error(
            "El look cinematográfico sólo se aplica a videos. Elegí un video o desactivalo.",
        ));
    }
    if cinematic && format != "mp4" {
        return Err(invalid_error(
            "El look cinematográfico exporta MP4. Elegí MP4 o desactivalo.",
        ));
    }
    if cinematic && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede aplicar el look cinematográfico.",
        ));
    }
    if voice_enabled && piper.is_none() {
        return Err(provider_error(
            "La voz IA local no está instalada: falta el recurso piper/es_voice.onnx.",
        ));
    }
    if let Some(audio) = &replacement_audio {
        if !audio.is_file() {
            return Err(invalid_error(
                "La banda sonora elegida no está en disco. Volvé a seleccionarla.",
            ));
        }
    }
    let compression_allowed = !audio_only && matches!(format, "mp4");
    if (requested_crf.is_some() || request.target_size_mb.is_some()) && !compression_allowed {
        return Err(invalid_error(
            "La compresión sólo se aplica al formato MP4. Elegí MP4 o desactivá la compresión.",
        ));
    }
    let target_size_mb = request
        .target_size_mb
        .filter(|mb| *mb >= 5)
        .map(|mb| mb.min(100_000));
    if request.target_size_mb.is_some() && target_size_mb.is_none() {
        return Err(invalid_error(
            "El tamaño objetivo debe ser de al menos 5 MB.",
        ));
    }
    let should_compress =
        compression_allowed && !cinematic && (requested_crf.is_some() || target_size_mb.is_some());
    let crf = if should_compress { requested_crf } else { None };
    if should_compress && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede comprimir. Elegí «Original» o configurá FFmpeg en Ajustes.",
        ));
    }
    let directory = cache_dir.join("downloads").join(&run_id);
    std::fs::create_dir_all(&directory)
        .map_err(|_| io_error("No se pudo crear la carpeta temporal de descarga."))?;
    let filename_template = request.filename_template.as_deref();
    let audio_language = audio_language(request.audio_language.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let audio_format_id = request
        .audio_format_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if valid_format_id(value) {
                Ok(value.to_owned())
            } else {
                Err(invalid_error("El format_id de audio no es válido."))
            }
        })
        .transpose()?;
    let playlist_items = playlist_items(request.playlist_items.as_deref())
        .map_err(|message| invalid_error(&message))?;
    let output_template = download_output_template(&directory, filename_template)
        .map_err(|message| invalid_error(&message))?;
    let max_height = request
        .max_height
        .unwrap_or(MAX_HEIGHT)
        .clamp(144, MAX_HEIGHT);
    let playlist = request.playlist.unwrap_or(false);

    let mut command = Command::new(engine);
    command.args([
        "--no-warnings",
        "--newline",
        "--ignore-config",
        "--windows-filenames",
        "--socket-timeout",
        "30",
        "--retries",
        "5",
        "--fragment-retries",
        "5",
        "--concurrent-fragments",
        "8",
        // Menos pedidos por fragmento: en redes con latencia alta, descargar
        // bloques de 10 MB reduce el tiempo total sin cambiar el archivo.
        "--http-chunk-size",
        "10M",
        "--no-overwrites",
    ]);
    if let Some(proxy) = proxy {
        command.args(["--proxy", proxy]);
    }
    if let Some(limit_rate) = limit_rate {
        command.args(["--limit-rate", limit_rate]);
    }
    if download_subtitles {
        command.args([
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            &subtitle_langs,
            "--convert-subs",
            "srt",
        ]);
    }
    if download_thumbnail {
        command.args(["--write-thumbnail", "--convert-thumbnails", "jpg"]);
    }
    if download_chapters {
        command.args(["--embed-chapters"]);
    }
    if sponsorblock && !sponsorblock_categories.trim().is_empty() {
        command.args(["--sponsorblock-remove", &sponsorblock_categories]);
    }
    if !sponsorblock_mark.is_empty() {
        let marked = sponsorblock_mark.join(",");
        command.args(["--sponsorblock-mark", &marked]);
    }
    if let Some(end) = trim_end {
        let section = format!("*{trim_start:.3}-{end:.3}");
        command.args(["--download-sections", &section, "--force-keyframes-at-cuts"]);
    }
    if playlist {
        command.args([
            "--playlist-items",
            playlist_items.as_deref().unwrap_or("1-12"),
        ]);
    } else if let Some(items) = playlist_items.as_deref() {
        command.args(["--yes-playlist", "--playlist-items", items]);
    } else {
        command.arg("--no-playlist");
    }
    if audio_only {
        command.args([
            "-f",
            "bestaudio/best",
            "-x",
            "--audio-format",
            format,
            "--audio-quality",
            "0",
        ]);
    } else if kind == "video" {
        let selector = audio_format_id
            .as_deref()
            .map(|id| format!("bv*+{id}"))
            .unwrap_or_else(|| video_format_selector(quality, max_height));
        command.arg("-f").arg(selector);
        if quality != "worst" {
            // A igual resolución elige el códec más eficiente (AV1/VP9 antes
            // que AVC): mismo detalle, menos peso, sin re-codificar. En
            // «worst» no aplica: el orden invertiría qué es "peor". El idioma
            // del audio, si se pidió, ya va dentro del mismo -S.
            command.args(["-S", &video_format_sort(audio_language.as_deref())]);
        }
        command.args(["--merge-output-format", format, "--remux-video", format]);
    } else if kind == "audio" {
        command.args(["-f", audio_format_id.as_deref().unwrap_or("bestaudio/best")]);
    }
    if let Some(cookies) = cookies {
        command.arg("--cookies").arg(cookies);
    } else if let Some(browser) = cookies_from_browser.as_deref() {
        command.args(["--cookies-from-browser", browser]);
    }
    if let Some(language) = audio_language.as_deref() {
        if language == "all" {
            command.args(["--audio-multistreams"]);
        } else if !(kind == "video" && quality != "worst") {
            // En video ya va dentro del -S combinado (lang tras vcodec).
            command.args(["-S", &format!("lang:{language}")]);
        }
    }
    command.arg("-o").arg(&output_template);
    command.arg(&validated);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    progress(
        "downloading",
        Some(0.0),
        if playlist {
            "Descargando el carrusel…"
        } else {
            "Iniciando la descarga…"
        },
    );
    let mut child = command
        .spawn()
        .map_err(|_| provider_error("No se pudo iniciar yt-dlp para descargar."))?;
    let (success, stderr) = read_download_output(progress, &mut child);
    if is_download_cancelled() {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(provider_error("Descarga cancelada."));
    }
    if !success {
        return Err(provider_error(format!(
            "La descarga falló: {}",
            error_tail(&stderr, "yt-dlp terminó con error")
        )));
    }

    let mut entries = std::fs::read_dir(&directory)
        .map_err(|_| io_error("No se pudo leer la carpeta de descarga."))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.path())
        .filter(|path| {
            let extension = media_extension(path);
            !matches!(
                extension.as_str(),
                "part" | "ytdl" | "temp" | "json" | "description"
            )
        })
        .collect::<Vec<PathBuf>>();
    if entries.is_empty() {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(provider_error(
            "yt-dlp terminó sin archivos. Puede que el sitio requiera iniciar sesión o que el contenido sea privado.",
        ));
    }
    entries.sort();

    let effective_long_video = if auto_route && source_duration <= 0.0 {
        entries
            .iter()
            .find(|path| downloaded_kind(path) == "video")
            .and_then(|path| probe_duration(ffprobe.as_deref(), path))
            .map(|duration| duration > 60.0)
            .unwrap_or(long_video)
    } else {
        long_video
    };
    // Si la duración llegó vacía, el enrutador se resuelve recién ahora con
    // la duración real del archivo descargado.
    let final_route = if auto_route && source_duration <= 0.0 {
        Some(AutoRouteDecision::pick(
            if effective_long_video { 61.0 } else { 30.0 },
            &source_title,
        ))
    } else {
        route_decision
    };
    if let Some(route) = final_route {
        audio_speed_noise = route.speed_and_noise() && !has_replacement_audio && !voice_enabled;
    }
    let preserve_original_audio = auto_route
        && final_route.is_some_and(|route| route.music)
        && !voice_enabled
        && !audio_speed_noise
        && !has_replacement_audio;
    let audio_master =
        !voice_enabled && !has_replacement_audio && !audio_speed_noise && !preserve_original_audio;
    let mut warnings: Vec<String> = Vec::new();
    if let Some(route) = final_route {
        warnings.push(format!("Enrutamiento automático: {}.", route.summary()));
    }
    if let Some(control) = current_control() {
        control.wait_until_running();
        if control.is_cancelled() {
            let _ = std::fs::remove_dir_all(&directory);
            return Err(provider_error("Descarga cancelada."));
        }
    }
    let mut voice_path: Option<PathBuf> = None;
    if voice_enabled {
        progress("compressing", None, "Generando voz IA local con Piper…");
        if let Some(assets) = piper.as_ref() {
            let voice_file = directory.join("voice_ia.wav");
            match crate::commands::piper::synthesize(assets, &voice_script, &voice_file) {
                Ok(()) => voice_path = Some(voice_file),
                Err(error) => warnings.push(format!(
                    "No se pudo generar la voz IA: {}. Se usará el audio disponible.",
                    error.message
                )),
            }
        }
    }
    let effective_audio = voice_path.as_deref().or(replacement_audio.as_deref());
    let watermark_path = if watermark_enabled {
        watermark.as_deref()
    } else {
        None
    };
    if watermark_enabled && watermark.is_none() {
        warnings.push(
            "No se encontró watermark.png; el video se procesó sin marca de agua.".to_owned(),
        );
    }
    let pipeline_profile = if cinematic {
        ffmpeg
            .as_deref()
            .map(crate::commands::pipeline_profile::detect)
            .unwrap_or_else(crate::commands::pipeline_profile::PipelineProfile::software)
    } else {
        crate::commands::pipeline_profile::PipelineProfile::software()
    };
    if cinematic {
        warnings.push(format!("Perfil de encode: {}.", pipeline_profile.label));
    }
    let mut md5s: HashMap<PathBuf, String> = HashMap::new();
    let mut sha256s: HashMap<PathBuf, String> = HashMap::new();
    let mut compressed = false;
    if cinematic {
        if requested_crf.is_some() {
            warnings.push(
                "El look cinematográfico reencodea el video: se omitió la compresión elegida."
                    .to_owned(),
            );
        }
        let ffmpeg = ffmpeg.as_deref().ok_or_else(|| {
            provider_error("FFmpeg no está disponible para el look cinematográfico.")
        })?;
        let focus = cinematic_focus_value.unwrap_or("center");
        let mut applied = false;
        for path in entries.clone() {
            if downloaded_kind(&path) != "video" {
                continue;
            }
            match process_video(
                progress,
                ffmpeg,
                ffprobe.as_deref(),
                &path,
                focus,
                effective_audio,
                auto_pipeline,
                effective_long_video,
                audio_speed_noise,
                preserve_original_audio,
                audio_master,
                delogo_corner_value,
                manual_delogo,
                upscale_mode_value.as_deref(),
                watermark_path,
                &pipeline_profile,
            ) {
                Ok((new_path, md5, sha256)) => {
                    applied = true;
                    // Si se pidió conservar el original, queda en la lista y
                    // se mueve junto al procesado. Si no, se elimina.
                    if !keep_original {
                        let _ = std::fs::remove_file(&path);
                        entries.retain(|entry| entry != &path);
                    }
                    if let Some(md5) = md5 {
                        md5s.insert(new_path.clone(), md5);
                    }
                    if let Some(sha256) = sha256 {
                        sha256s.insert(new_path.clone(), sha256);
                    }
                    entries.push(new_path);
                }
                Err(message) => {
                    warnings.push(format!("No se pudo aplicar el post-proceso: {message}"))
                }
            }
        }
        if applied {
            compressed = true;
        } else {
            warnings.push(
                "Ningún video pudo procesarse con el look cinematográfico; se conservaron los originales."
                    .to_owned(),
            );
        }
        entries.sort();
    } else if should_compress {
        let ffmpeg = ffmpeg
            .as_deref()
            .ok_or_else(|| provider_error("FFmpeg no está disponible para comprimir el video."))?;
        for path in entries.clone() {
            if downloaded_kind(&path) != "video" {
                continue;
            }
            match compress_video(
                progress,
                ffmpeg,
                ffprobe.as_deref(),
                &path,
                crf,
                target_size_mb,
                codec,
                hdr_mode,
                keep_original,
            ) {
                Ok(Some(new_path)) => {
                    compressed = true;
                    if !keep_original {
                        entries.retain(|entry| entry != &path);
                    }
                    entries.push(new_path);
                }
                Ok(None) => warnings.push(
                    "Un video ya estaba bien comprimido: se conservó el original porque la recompresión no quedaba más chica."
                        .to_owned(),
                ),
                Err(message) => warnings.push(format!("No se pudo comprimir un video: {message}")),
            }
        }
        entries.sort();
    } else if kind == "image" && crf.is_some() {
        warnings.push(
            "Las imágenes no se recomprimen; se descargan en su formato original.".to_owned(),
        );
    }

    if !sponsorblock_mute.is_empty() {
        if let (Some(ffmpeg), Some(video_id)) = (ffmpeg.as_deref(), youtube_video_id(&request.url))
        {
            progress("compressing", None, "Silenciando tramos de SponsorBlock…");
            match fetch_sponsor_segments(&video_id, &sponsorblock_mute) {
                Ok(segments) if !segments.is_empty() => {
                    for entry in entries.iter_mut() {
                        if downloaded_kind(entry) != "video"
                            || !input_has_audio(ffprobe.as_deref(), entry)
                        {
                            continue;
                        }
                        match mute_audio_segments(ffmpeg, entry, &segments) {
                            Ok(()) => warnings.push(format!(
                                "Se silenciaron {} tramo(s) de SponsorBlock en {}.",
                                segments.len(),
                                entry
                                    .file_name()
                                    .map(|value| value.to_string_lossy().into_owned())
                                    .unwrap_or_default()
                            )),
                            Err(message) => warnings.push(format!(
                                "No se pudieron silenciar los tramos de {}: {message}",
                                entry
                                    .file_name()
                                    .map(|value| value.to_string_lossy().into_owned())
                                    .unwrap_or_default()
                            )),
                        }
                    }
                }
                Ok(_) => warnings.push(
                    "SponsorBlock no devolvió tramos para las categorías de silencio.".to_owned(),
                ),
                Err(error) => warnings.push(format!(
                    "No se pudo consultar SponsorBlock para silenciar: {}",
                    error.message
                )),
            }
        } else {
            warnings.push(
                "El silencio de SponsorBlock sólo aplica a videos de YouTube con FFmpeg disponible."
                    .to_owned(),
            );
        }
    }
    if let Some(path) = voice_path.as_ref() {
        let _ = std::fs::remove_file(path);
    }
    if is_download_cancelled() {
        let _ = std::fs::remove_dir_all(&directory);
        return Err(provider_error("Descarga cancelada."));
    }
    let files = entries
        .into_iter()
        .map(|path| {
            let bytes = std::fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            DownloadedFile {
                name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "archivo".to_owned()),
                path: path.to_string_lossy().into_owned(),
                bytes,
                kind: downloaded_kind(&path).to_owned(),
                md5: md5s.get(&path).cloned(),
                sha256: sha256s.get(&path).cloned(),
                chapters: Vec::new(),
            }
        })
        .collect::<Vec<DownloadedFile>>();
    progress("done", Some(100.0), "Descarga terminada.");
    Ok(DownloadOutcome {
        run_id,
        directory: directory.to_string_lossy().into_owned(),
        files,
        compressed,
        warnings,
        subtitles: Vec::new(),
    })
}
