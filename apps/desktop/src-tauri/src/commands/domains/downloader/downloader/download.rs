use crate::application::download_plan::normalize_download_request;

// clippy::too_many_arguments: orquesta una descarga completa; las rutas de
// herramientas y opciones son ejes ortogonales del pipeline.
#[allow(clippy::too_many_arguments)]
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
    // Validación y normalización pura del request (application::download_plan).
    let plan = normalize_download_request(&request)?;
    // Chequeos que dependen del runtime: binarios y archivo en disco.
    if plan.cinematic && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede aplicar el look cinematográfico.",
        ));
    }
    if plan.voice_enabled && piper.is_none() {
        return Err(provider_error(
            "La voz IA local no está instalada: falta el recurso piper/es_voice.onnx.",
        ));
    }
    if let Some(audio) = &plan.replacement_audio {
        if !audio.is_file() {
            return Err(invalid_error(
                "La banda sonora elegida no está en disco. Volvé a seleccionarla.",
            ));
        }
    }
    if plan.should_compress && ffmpeg.is_none() {
        return Err(provider_error(
            "FFmpeg no está disponible; sin él no se puede comprimir. Elegí «Original» o configurá FFmpeg en Ajustes.",
        ));
    }
    let directory = cache_dir.join("downloads").join(&run_id);
    std::fs::create_dir_all(&directory)
        .map_err(|_| io_error("No se pudo crear la carpeta temporal de descarga."))?;
    let output_template =
        download_output_template(&directory, plan.filename_template.as_deref())
            .map_err(|message| invalid_error(&message))?;

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
    if let Some(proxy) = plan.proxy.as_deref() {
        command.args(["--proxy", proxy]);
    }
    if let Some(limit_rate) = plan.limit_rate.as_deref() {
        command.args(["--limit-rate", limit_rate]);
    }
    if plan.download_subtitles {
        command.args([
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            &plan.subtitle_langs,
            "--convert-subs",
            "srt",
        ]);
    }
    if plan.download_thumbnail {
        command.args(["--write-thumbnail", "--convert-thumbnails", "jpg"]);
    }
    if plan.download_chapters {
        command.args(["--embed-chapters"]);
    }
    if plan.sponsorblock && !plan.sponsorblock_categories.trim().is_empty() {
        command.args(["--sponsorblock-remove", &plan.sponsorblock_categories]);
    }
    if !plan.sponsorblock_mark.is_empty() {
        let marked = plan.sponsorblock_mark.join(",");
        command.args(["--sponsorblock-mark", &marked]);
    }
    if let Some(end) = plan.trim_end {
        let section = format!("*{:.3}-{end:.3}", plan.trim_start);
        command.args(["--download-sections", &section, "--force-keyframes-at-cuts"]);
    }
    if plan.playlist {
        command.args([
            "--playlist-items",
            plan.playlist_items.as_deref().unwrap_or("1-12"),
        ]);
    } else if let Some(items) = plan.playlist_items.as_deref() {
        command.args(["--yes-playlist", "--playlist-items", items]);
    } else {
        command.arg("--no-playlist");
    }
    if plan.audio_only {
        command.args([
            "-f",
            "bestaudio/best",
            "-x",
            "--audio-format",
            &plan.format,
            "--audio-quality",
            "0",
        ]);
    } else if plan.kind == "video" {
        let selector = plan
            .audio_format_id
            .as_deref()
            .map(|id| format!("bv*+{id}"))
            .unwrap_or_else(|| video_format_selector(&plan.quality, plan.max_height));
        command.arg("-f").arg(selector);
        if plan.quality != "worst" {
            // A igual resolución elige el códec más eficiente (AV1/VP9 antes
            // que AVC): mismo detalle, menos peso, sin re-codificar. En
            // «worst» no aplica: el orden invertiría qué es "peor". El idioma
            // del audio, si se pidió, ya va dentro del mismo -S.
            command.args(["-S", &video_format_sort(plan.audio_language.as_deref())]);
        }
        command.args([
            "--merge-output-format",
            &plan.format,
            "--remux-video",
            &plan.format,
        ]);
    } else if plan.kind == "audio" {
        command.args([
            "-f",
            plan.audio_format_id.as_deref().unwrap_or("bestaudio/best"),
        ]);
    }
    if let Some(cookies) = cookies {
        command.arg("--cookies").arg(cookies);
    } else if let Some(browser) = plan.cookies_from_browser.as_deref() {
        command.args(["--cookies-from-browser", browser]);
    }
    if let Some(language) = plan.audio_language.as_deref() {
        if language == "all" {
            command.args(["--audio-multistreams"]);
        } else if !(plan.kind == "video" && plan.quality != "worst") {
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
        if plan.playlist {
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

    let effective_long_video = if plan.auto_route && plan.source_duration <= 0.0 {
        entries
            .iter()
            .find(|path| downloaded_kind(path) == "video")
            .and_then(|path| probe_duration(ffprobe.as_deref(), path))
            .map(|duration| duration > 60.0)
            .unwrap_or(plan.long_video)
    } else {
        plan.long_video
    };
    // Si la duración llegó vacía, el enrutador se resuelve recién ahora con
    // la duración real del archivo descargado.
    let final_route = if plan.auto_route && plan.source_duration <= 0.0 {
        Some(AutoRouteDecision::pick(
            if effective_long_video { 61.0 } else { 30.0 },
            &plan.source_title,
        ))
    } else {
        plan.route_decision
    };
    let mut audio_speed_noise = plan.audio_speed_noise;
    if let Some(route) = final_route {
        audio_speed_noise =
            route.speed_and_noise() && !plan.has_replacement_audio && !plan.voice_enabled;
    }
    let preserve_original_audio = plan.auto_route
        && final_route.is_some_and(|route| route.music)
        && !plan.voice_enabled
        && !audio_speed_noise
        && !plan.has_replacement_audio;
    let audio_master = !plan.voice_enabled
        && !plan.has_replacement_audio
        && !audio_speed_noise
        && !preserve_original_audio;
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
    if plan.voice_enabled {
        progress("compressing", None, "Generando voz IA local con Piper…");
        if let Some(assets) = piper.as_ref() {
            let voice_file = directory.join("voice_ia.wav");
            match crate::commands::piper::synthesize(assets, &plan.voice_script, &voice_file) {
                Ok(()) => voice_path = Some(voice_file),
                Err(error) => warnings.push(format!(
                    "No se pudo generar la voz IA: {}. Se usará el audio disponible.",
                    error.message
                )),
            }
        }
    }
    let effective_audio = voice_path.as_deref().or(plan.replacement_audio.as_deref());
    let watermark_path = if plan.watermark_enabled {
        watermark.as_deref()
    } else {
        None
    };
    if plan.watermark_enabled && watermark.is_none() {
        warnings.push(
            "No se encontró watermark.png; el video se procesó sin marca de agua.".to_owned(),
        );
    }
    let pipeline_profile = if plan.cinematic {
        ffmpeg
            .as_deref()
            .map(crate::commands::pipeline_profile::detect)
            .unwrap_or_else(crate::commands::pipeline_profile::PipelineProfile::software)
    } else {
        crate::commands::pipeline_profile::PipelineProfile::software()
    };
    if plan.cinematic {
        warnings.push(format!("Perfil de encode: {}.", pipeline_profile.label));
    }
    let mut md5s: HashMap<PathBuf, String> = HashMap::new();
    let mut sha256s: HashMap<PathBuf, String> = HashMap::new();
    let mut compressed = false;
    if plan.cinematic {
        if plan.requested_crf.is_some() {
            warnings.push(
                "El look cinematográfico reencodea el video: se omitió la compresión elegida."
                    .to_owned(),
            );
        }
        let ffmpeg = ffmpeg.as_deref().ok_or_else(|| {
            provider_error("FFmpeg no está disponible para el look cinematográfico.")
        })?;
        let focus = plan.cinematic_focus.unwrap_or("center");
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
                plan.auto_pipeline,
                effective_long_video,
                audio_speed_noise,
                preserve_original_audio,
                audio_master,
                plan.delogo_corner,
                plan.manual_delogo,
                plan.upscale_mode.as_deref(),
                watermark_path,
                &pipeline_profile,
            ) {
                Ok((new_path, md5, sha256)) => {
                    applied = true;
                    // Si se pidió conservar el original, queda en la lista y
                    // se mueve junto al procesado. Si no, se elimina.
                    if !plan.keep_original {
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
    } else if plan.should_compress {
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
                plan.crf,
                plan.target_size_mb,
                &plan.codec,
                &plan.hdr_mode,
                plan.keep_original,
            ) {
                Ok(Some(new_path)) => {
                    compressed = true;
                    if !plan.keep_original {
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
    } else if plan.kind == "image" && plan.crf.is_some() {
        warnings.push(
            "Las imágenes no se recomprimen; se descargan en su formato original.".to_owned(),
        );
    }

    if !plan.sponsorblock_mute.is_empty() {
        if let (Some(ffmpeg), Some(video_id)) = (ffmpeg.as_deref(), youtube_video_id(&request.url))
        {
            progress("compressing", None, "Silenciando tramos de SponsorBlock…");
            match fetch_sponsor_segments(&video_id, &plan.sponsorblock_mute) {
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
