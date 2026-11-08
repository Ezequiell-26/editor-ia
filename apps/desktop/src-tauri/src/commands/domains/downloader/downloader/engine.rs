fn provider_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::ProviderUnavailable, &message)
}

fn invalid_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::InvalidProject, &message)
}

fn io_error(message: impl Into<String>) -> ProjectError {
    let message = message.into();
    ProjectError::message(ProjectErrorCode::Io, &message)
}

fn emit_progress(
    app: &AppHandle,
    run_id: &str,
    stage: &str,
    percent: Option<f64>,
    message: impl Into<String>,
) {
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            run_id: run_id.to_owned(),
            stage: stage.to_owned(),
            percent,
            message: message.into().chars().take(300).collect(),
        },
    );
}

fn managed_engine_path(config_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        config_dir.join("tools").join("yt-dlp.exe")
    } else {
        config_dir.join("tools").join("yt-dlp")
    }
}

/// Si el instalador trajo yt-dlp y la carpeta gestionada está vacía, lo copia
/// ahí. Así Descargar funciona recién instalada la app, sin pedir descarga.
pub(crate) fn ensure_bundled_engine(config_dir: &Path) {
    let managed = managed_engine_path(config_dir);
    if managed.is_file() {
        return;
    }
    let Some(base) = crate::commands::system::bundled_resource_dir() else {
        return;
    };
    let file_name = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };
    let bundled = base.join("tools").join(file_name);
    if !bundled.is_file() {
        return;
    }
    if let Some(parent) = managed.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::copy(&bundled, &managed);
}

fn engine_version(engine: &Path) -> Option<String> {
    let mut command = Command::new(engine);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

pub(crate) fn resolve_engine(config_dir: &Path) -> Result<PathBuf, ProjectError> {
    let managed = managed_engine_path(config_dir);
    if managed.is_file() && engine_version(&managed).is_some() {
        return Ok(managed);
    }
    let from_path = PathBuf::from("yt-dlp");
    if engine_version(&from_path).is_some() {
        return Ok(from_path);
    }
    Err(provider_error(
        "El motor de descargas (yt-dlp) no está instalado. Instalalo desde Descargar o agregá yt-dlp al PATH.",
    ))
}

fn status_from_config(config_dir: &Path) -> DownloaderStatus {
    let managed = managed_engine_path(config_dir);
    if managed.is_file() {
        if let Some(version) = engine_version(&managed) {
            return DownloaderStatus {
                available: true,
                version: Some(version),
                path: Some(managed.to_string_lossy().into_owned()),
                managed: true,
                can_install: true,
                hint: None,
            };
        }
    }
    let from_path = PathBuf::from("yt-dlp");
    if let Some(version) = engine_version(&from_path) {
        return DownloaderStatus {
            available: true,
            version: Some(version),
            path: Some("yt-dlp".to_owned()),
            managed: false,
            can_install: true,
            hint: None,
        };
    }
    DownloaderStatus {
        available: false,
        version: None,
        path: None,
        managed: false,
        can_install: cfg!(windows),
        hint: Some(
            "Instalá el motor para descargar de redes sociales. Sólo se baja el ejecutable oficial de yt-dlp desde GitHub."
                .to_owned(),
        ),
    }
}

/// `engine_version` lanza `yt-dlp --version` y espera el proceso. En Windows ese
/// arranque puede tardar segundos, y `downloader_status` se llama cada vez que se
/// abre la vista Descargar. Se cachea para que cambiar de pestaña no vuelva a
/// pagar ese costo.
fn status_cache() -> &'static Mutex<Option<(Instant, DownloaderStatus)>> {
    static CACHE: OnceLock<Mutex<Option<(Instant, DownloaderStatus)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

const STATUS_TTL: Duration = Duration::from_secs(60);

fn is_download_cancelled() -> bool {
    current_control().is_some_and(|control| control.is_cancelled())
}

fn invalidate_status_cache() {
    if let Ok(mut guard) = status_cache().lock() {
        *guard = None;
    }
}

#[tauri::command]
pub async fn downloader_status(
    state: State<'_, AppState>,
) -> Result<DownloaderStatus, ProjectError> {
    if let Ok(guard) = status_cache().lock() {
        if let Some((at, cached)) = guard.as_ref() {
            if at.elapsed() < STATUS_TTL {
                return Ok(cached.clone());
            }
        }
    }
    let fresh = status_from_config(&state.config_dir);
    if let Ok(mut guard) = status_cache().lock() {
        *guard = Some((Instant::now(), fresh.clone()));
    }
    Ok(fresh)
}

#[tauri::command]
pub async fn update_downloader(
    state: State<'_, AppState>,
) -> Result<DownloaderStatus, ProjectError> {
    let engine = resolve_engine(&state.config_dir)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&engine);
        command
            .arg("-U")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::commands::hide_console(&mut command);
        command.output()
    })
    .await
    .map_err(|_| provider_error("La actualización del motor se interrumpió."))?
    .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para actualizarlo."))?;
    invalidate_status_cache();
    if !result.status.success() {
        return Err(provider_error(format!(
            "yt-dlp no pudo actualizarse: {}",
            error_tail(
                &String::from_utf8_lossy(&result.stderr),
                "el motor no aceptó la actualización"
            )
        )));
    }
    Ok(status_from_config(&state.config_dir))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// MD5 y SHA-256 en una sola pasada, sin cargar el archivo completo en RAM.
fn hash_file(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(mut file) = std::fs::File::open(path) else {
        return (None, None);
    };
    let mut md5 = Md5::new();
    let mut sha = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                md5.update(&buffer[..read]);
                sha.update(&buffer[..read]);
            }
            Err(_) => return (None, None),
        }
    }
    (
        Some(format!("{:x}", md5.finalize())),
        Some(format!("{:x}", sha.finalize())),
    )
}

fn expected_engine_hash(sums: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?;
        if name
            .trim_start_matches('*')
            .eq_ignore_ascii_case("yt-dlp.exe")
        {
            Some(hash.to_ascii_lowercase())
        } else {
            None
        }
    })
}

#[tauri::command]
pub async fn install_downloader(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DownloaderStatus, ProjectError> {
    // El estado cacheado deja de valer apenas se intenta instalar el motor.
    invalidate_status_cache();
    if !cfg!(windows) {
        return Err(provider_error(
            "La instalación automática sólo está disponible en Windows. Instalá yt-dlp con tu gestor de paquetes.",
        ));
    }
    let config_dir = state.config_dir.clone();
    emit_progress(&app, "", "engine", None, "Descargando yt-dlp oficial…");
    let client = reqwest::Client::builder()
        .user_agent("EditorIA/0.1 yt-dlp-installer")
        .build()
        .map_err(|_| provider_error("No se pudo preparar la descarga del motor."))?;
    let exe = client
        .get(ENGINE_URL)
        .send()
        .await
        .map_err(|error| provider_error(format!("No se pudo descargar yt-dlp: {error}")))?
        .error_for_status()
        .map_err(|error| provider_error(format!("GitHub rechazó la descarga del motor: {error}")))?
        .bytes()
        .await
        .map_err(|error| provider_error(format!("La descarga del motor se cortó: {error}")))?;
    if exe.is_empty() || exe.len() > MAX_ENGINE_BYTES {
        return Err(provider_error(
            "El motor descargado tiene un tamaño inesperado; se canceló la instalación.",
        ));
    }
    emit_progress(&app, "", "engine", None, "Verificando el motor…");
    let sums = client
        .get(ENGINE_SUMS_URL)
        .send()
        .await
        .map_err(|error| provider_error(format!("No se pudo verificar el motor: {error}")))?
        .error_for_status()
        .map_err(|error| provider_error(format!("GitHub rechazó la verificación: {error}")))?
        .text()
        .await
        .map_err(|error| provider_error(format!("No se pudo leer la verificación: {error}")))?;
    let expected = expected_engine_hash(&sums)
        .ok_or_else(|| provider_error("El checksum oficial del motor no está disponible."))?;
    let actual = sha256_hex(&exe);
    if actual != expected {
        return Err(provider_error(
            "El checksum del motor no coincide con el oficial; no se instaló.",
        ));
    }
    let tools_dir = config_dir.join("tools");
    std::fs::create_dir_all(&tools_dir)
        .map_err(|_| io_error("No se pudo crear la carpeta de herramientas."))?;
    let target = managed_engine_path(&config_dir);
    let temporary = tools_dir.join("yt-dlp.exe.download");
    std::fs::write(&temporary, &exe)
        .map_err(|_| io_error("No se pudo escribir el motor descargado."))?;
    if target.exists() {
        let _ = std::fs::remove_file(&target);
    }
    std::fs::rename(&temporary, &target)
        .map_err(|_| io_error("No se pudo instalar el motor descargado."))?;
    if engine_version(&target).is_none() {
        let _ = std::fs::remove_file(&target);
        return Err(provider_error(
            "El motor se descargó pero no respondió a --version; se descartó.",
        ));
    }
    emit_progress(&app, "", "engine", None, "Motor instalado.");
    Ok(status_from_config(&config_dir))
}
