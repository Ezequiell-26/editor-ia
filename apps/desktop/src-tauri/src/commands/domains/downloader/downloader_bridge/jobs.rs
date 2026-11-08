fn run_direct_image(job_state: Arc<Mutex<Option<BridgeJob>>>, downloads_dir: PathBuf, url: String) {
    let result = (|| -> Result<BridgeFile, ProjectError> {
        let client = reqwest::blocking::Client::builder()
            .user_agent("EditorIA/0.1")
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|_| provider_error("No se pudo preparar la descarga de la imagen."))?;
        let mut response = client
            .get(&url)
            .send()
            .map_err(|error| provider_error(format!("No se pudo abrir la imagen: {error}")))?;
        if !response.status().is_success() {
            return Err(provider_error(format!(
                "El servidor rechazó la imagen ({})",
                response.status()
            )));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if content_type.starts_with("text/html") {
            return Err(provider_error("El enlace no es una imagen directa."));
        }
        let total = response.content_length();
        if total.unwrap_or(0) > 100 * 1024 * 1024 {
            return Err(provider_error("La imagen supera los 100 MB."));
        }
        let platform_dir = downloads_dir.join(platform_folder(&url));
        let file_name = image_file_name(&url, &content_type);
        let destination_dir = folder_from_file_name(&file_name)
            .map(|folder| platform_dir.join(folder))
            .unwrap_or(platform_dir);
        std::fs::create_dir_all(&destination_dir)
            .map_err(|_| provider_error("No se pudo crear Videos descargados."))?;
        let destination = unique_destination(&destination_dir, &file_name);
        let mut file = std::fs::File::create(&destination)
            .map_err(|_| provider_error("No se pudo escribir la imagen en Descargas."))?;
        let mut buffer = [0u8; 64 * 1024];
        let mut written: u64 = 0;
        loop {
            let read = response
                .read(&mut buffer)
                .map_err(|error| provider_error(format!("La imagen se cortó: {error}")))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])
                .map_err(|_| provider_error("No se pudo guardar la imagen."))?;
            written += read as u64;
            if written > 100 * 1024 * 1024 {
                let _ = std::fs::remove_file(&destination);
                return Err(provider_error("La imagen supera los 100 MB."));
            }
            if let Some(total) = total.filter(|value| *value > 0) {
                let percent = (written as f64 / total as f64 * 100.0).min(99.0);
                set_job(&job_state, |job| {
                    job.stage = "downloading".to_owned();
                    job.percent = Some(percent);
                    job.message = "Descargando imagen…".to_owned();
                });
            }
        }
        if written == 0 {
            let _ = std::fs::remove_file(&destination);
            return Err(provider_error("La imagen llegó vacía."));
        }
        Ok(BridgeFile {
            name: destination
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "imagen".to_owned()),
            bytes: written,
            path: destination.to_string_lossy().into_owned(),
        })
    })();
    match result {
        Ok(file) => set_job(&job_state, |job| {
            job.status = "done".to_owned();
            job.stage = "done".to_owned();
            job.percent = Some(100.0);
            job.message = "Guardado en Videos descargados.".to_owned();
            job.files = vec![file];
            job.error = None;
        }),
        Err(error) => set_job(&job_state, |job| {
            job.status = "error".to_owned();
            job.stage = "error".to_owned();
            job.message = error.message.clone();
            job.error = Some(error.message);
        }),
    }
}

fn run_job(
    app: AppHandle,
    job_state: Arc<Mutex<Option<BridgeJob>>>,
    downloads_dir: PathBuf,
    cache_dir: PathBuf,
    request: DownloadRequest,
) {
    let result = (|| -> Result<Vec<BridgeFile>, ProjectError> {
        let (engine, ffmpeg, ffprobe) = {
            let state = app.state::<AppState>();
            let settings = state.settings_snapshot()?;
            let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
            (resolve_engine(&state.config_dir)?, ffmpeg, ffprobe)
        };
        let platform = platform_folder(&request.url);
        let progress_job = job_state.clone();
        let progress = move |stage: &str, percent: Option<f64>, message: &str| {
            set_job(&progress_job, |job| {
                job.stage = stage.to_owned();
                job.percent = percent;
                job.message = message.to_owned();
            });
        };
        let piper = crate::commands::piper::resolve_assets(&app);
        let watermark = crate::commands::piper::resolve_watermark(&app);
        let outcome = download_blocking(
            &progress, &engine, &cache_dir, request, ffmpeg, ffprobe, None, piper, watermark,
        )?;
        let platform_dir = downloads_dir.join(platform);
        let destination_dir = outcome
            .files
            .first()
            .and_then(|file| folder_from_file_name(&file.name))
            .map(|folder| platform_dir.join(folder))
            .unwrap_or(platform_dir);
        std::fs::create_dir_all(&destination_dir)
            .map_err(|_| provider_error("No se pudo crear Videos descargados."))?;
        let mut files: Vec<BridgeFile> = Vec::new();
        for file in &outcome.files {
            let source = Path::new(&file.path);
            if !source.is_file() {
                continue;
            }
            let destination = unique_destination(&destination_dir, &file.name);
            std::fs::copy(source, &destination)
                .map_err(|_| provider_error("Se descargó pero no se pudo copiar a Descargas."))?;
            let bytes = std::fs::metadata(&destination)
                .map(|metadata| metadata.len())
                .unwrap_or(file.bytes);
            files.push(BridgeFile {
                name: destination
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or_else(|| file.name.clone()),
                bytes,
                path: destination.to_string_lossy().into_owned(),
            });
        }
        let cache_downloads = cache_dir.join("downloads");
        if let (Ok(root), Ok(directory)) = (
            cache_downloads.canonicalize(),
            Path::new(&outcome.directory).canonicalize(),
        ) {
            if directory.starts_with(root) {
                let _ = std::fs::remove_dir_all(directory);
            }
        }
        if files.is_empty() {
            return Err(provider_error(
                "La descarga terminó sin archivos utilizables.",
            ));
        }
        Ok(files)
    })();

    match result {
        Ok(files) => {
            set_job(&job_state, |job| {
                job.status = "done".to_owned();
                job.stage = "done".to_owned();
                job.percent = Some(100.0);
                job.message = "Guardado en Videos descargados.".to_owned();
                job.files = files;
                job.error = None;
            });
        }
        Err(error) => {
            set_job(&job_state, |job| {
                job.status = "error".to_owned();
                job.stage = "error".to_owned();
                job.message = error.message.clone();
                job.error = Some(error.message);
            });
        }
    }
}
