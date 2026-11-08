#[derive(Serialize)]
pub struct LutImported {
    pub path: String,
    pub name: String,
}

/// Copies a user-picked `.cube` LUT into `<project>/media/luts` and returns a
/// project-relative path. Only the file header is inspected; the renderer lets
/// FFmpeg validate the full table.
#[tauri::command]
pub async fn import_lut(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<LutImported>, ProjectError> {
    let session = state.require_session()?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Importar LUT .cube")
        .add_filter("LUT 3D", &["cube"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    let metadata = std::fs::metadata(&source).map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "el LUT ya no está en esa ruta")
    })?;
    if !metadata.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el LUT elegido no es un archivo",
        ));
    }
    if metadata.len() > 32 * 1024 * 1024 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el LUT supera los 32 MB",
        ));
    }
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("lut.cube")
        .to_owned();
    if !name.to_ascii_lowercase().ends_with(".cube") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí un LUT con extensión .cube",
        ));
    }
    let text = std::fs::read_to_string(&source)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo leer el LUT"))?;
    filmcraft_color::Lut::parse_cube(&text).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("el LUT .cube no es válido: {error}").as_str(),
        )
    })?;
    let directory = session.root.join("media").join("luts");
    std::fs::create_dir_all(&directory)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/luts"))?;
    let file_name = format!("{}.cube", uuid::Uuid::new_v4());
    std::fs::copy(&source, directory.join(&file_name)).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo copiar el LUT al proyecto")
    })?;
    Ok(Some(LutImported {
        path: format!("media/luts/{file_name}"),
        name,
    }))
}

#[tauri::command]
pub async fn media_thumbnail(
    state: State<'_, AppState>,
    path: String,
    is_image: bool,
) -> Result<String, ProjectError> {
    let session = state.require_session()?;
    let source = resolve_inside_root(&session.root, &path)?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffmpeg no está disponible para generar miniaturas",
        ));
    };

    let metadata = std::fs::metadata(&source).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::NotFound,
            "el material ya no está en el proyecto",
        )
    })?;
    let cache_key = format!(
        "{}:{}:{}",
        source.to_string_lossy(),
        metadata.len(),
        metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    );
    if let Ok(cache) = state.thumbnails.lock() {
        if let Some(hit) = cache.get(&cache_key) {
            return Ok(hit.clone());
        }
    }

    let data_url = thumbnail_data_url(&ffmpeg, &source, is_image)?;
    if let Ok(mut cache) = state.thumbnails.lock() {
        cache.insert(cache_key, data_url.clone());
    }
    Ok(data_url)
}
