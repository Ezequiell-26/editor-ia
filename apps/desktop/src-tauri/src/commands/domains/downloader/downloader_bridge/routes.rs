fn probe_route(stream: TcpStream, app: &AppHandle, body: &[u8]) {
    let request: BridgeProbeRequest = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(_) => {
            respond(
                stream,
                400,
                error_body("El pedido de análisis no es válido."),
            );
            return;
        }
    };
    let url = match validate_url(&request.url) {
        Ok(url) => url,
        Err(error) => {
            respond(stream, 400, error_body(error.message));
            return;
        }
    };
    if request.direct_image.unwrap_or(false) {
        respond(
            stream,
            200,
            serde_json::to_string(&direct_image_probe(&url))
                .unwrap_or_else(|_| error_body("No se pudo serializar.")),
        );
        return;
    }
    let state = app.state::<AppState>();
    let engine = match resolve_engine(&state.config_dir) {
        Ok(engine) => engine,
        Err(error) => {
            respond(stream, 400, error_body(error.message));
            return;
        }
    };
    match probe_with_engine(&engine, &url, None, None) {
        Ok(probe) => respond(
            stream,
            200,
            serde_json::to_string(&probe).unwrap_or_else(|_| error_body("No se pudo serializar.")),
        ),
        Err(error) => respond(stream, 400, error_body(error.message)),
    }
}

fn unique_destination(directory: &Path, name: &str) -> PathBuf {
    let safe: String = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => character,
        })
        .collect();
    let safe = if safe.trim().is_empty() {
        "archivo".to_owned()
    } else {
        safe
    };
    let candidate = directory.join(&safe);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(&safe);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archivo".to_owned());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned());
    for index in 2..10_000 {
        let name = match extension.as_deref() {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{}.bin", Uuid::new_v4()))
}

fn set_job(job_state: &Arc<Mutex<Option<BridgeJob>>>, update: impl FnOnce(&mut BridgeJob)) {
    if let Ok(mut guard) = job_state.lock() {
        if let Some(job) = guard.as_mut() {
            update(job);
        }
    }
}

fn download_route(
    stream: TcpStream,
    app: &AppHandle,
    job_state: &Arc<Mutex<Option<BridgeJob>>>,
    downloads_dir: &Path,
    cache_dir: &Path,
    body: &[u8],
) {
    let parsed: BridgeDownloadRequest = match serde_json::from_slice(body) {
        Ok(request) => request,
        Err(_) => {
            respond(stream, 400, error_body("La descarga pedida no es válida."));
            return;
        }
    };
    let mut request = parsed.download;
    let direct_image = parsed.direct_image.unwrap_or(false);
    let validated = match validate_url(&request.url) {
        Ok(url) => url,
        Err(error) => {
            respond(stream, 400, error_body(error.message));
            return;
        }
    };
    request.cookies_file = None;
    request.url = validated.clone();
    let busy = job_state
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|job| job.status == "running"))
        .unwrap_or(false);
    if busy {
        respond(
            stream,
            409,
            error_body("Ya hay una descarga en curso; esperá a que termine."),
        );
        return;
    }
    let id = Uuid::new_v4().to_string();
    let initial = BridgeJob {
        id: id.clone(),
        status: "running".to_owned(),
        stage: "starting".to_owned(),
        percent: None,
        message: "Preparando la descarga…".to_owned(),
        files: Vec::new(),
        error: None,
    };
    if let Ok(mut guard) = job_state.lock() {
        *guard = Some(initial.clone());
    }
    respond(
        stream,
        202,
        serde_json::to_string(&initial).unwrap_or_else(|_| "{}".to_owned()),
    );

    let app = app.clone();
    let job_state = job_state.clone();
    let downloads_dir = downloads_dir.to_path_buf();
    let cache_dir = cache_dir.to_path_buf();
    let _ = thread::Builder::new()
        .name("editor-ia-bridge-download".to_owned())
        .spawn(move || {
            if direct_image {
                run_direct_image(job_state, downloads_dir, validated);
            } else {
                run_job(app, job_state, downloads_dir, cache_dir, request);
            }
        });
}

fn image_file_name(url: &str, content_type: &str) -> String {
    let raw = url
        .split('?')
        .next()
        .unwrap_or(url)
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("imagen");
    let sanitized: String = raw
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => character,
        })
        .collect();
    let lower = sanitized.to_ascii_lowercase();
    let has_extension = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]
        .iter()
        .any(|extension| lower.ends_with(extension));
    if has_extension {
        return sanitized;
    }
    let extension = match content_type {
        value if value.contains("png") => ".png",
        value if value.contains("webp") => ".webp",
        value if value.contains("gif") => ".gif",
        value if value.contains("avif") => ".avif",
        _ => ".jpg",
    };
    format!("{sanitized}{extension}")
}
