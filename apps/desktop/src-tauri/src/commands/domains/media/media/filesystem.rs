use crate::ports::media::AssetFileInfo;

/// Check that every asset still resolves inside the project root. The UI uses
/// this before rendering and shows a precise warning instead of a broken export.
#[tauri::command]
pub async fn check_asset_files(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<AssetFileInfo>, ProjectError> {
    let session = state.require_session()?;
    Ok(use_cases::check_asset_files(&session.root, paths))
}

/// Abre el selector nativo de imágenes y devuelve la ruta elegida.
///
/// Lo usa el comparador antes/después, pero es genérico: cualquier vista que
/// necesite una imagen suelta del disco.
#[tauri::command]
pub async fn choose_image_file(
    app: AppHandle,
    title: Option<String>,
) -> Result<Option<String>, ProjectError> {
    let mut dialog = app.dialog().file();
    dialog = match title.as_deref() {
        Some(text) if !text.trim().is_empty() => dialog.set_title(text.trim()),
        _ => dialog.set_title("Elegir imagen"),
    };
    let Some(picked) = dialog
        .add_filter(
            "Imágenes",
            &[
                "png", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "tif", "tiff",
            ],
        )
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "No se pudo usar la imagen elegida.")
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Selector nativo de videos sueltos (compresión, inspección).
#[tauri::command]
pub async fn choose_video_file(
    app: AppHandle,
    title: Option<String>,
) -> Result<Option<String>, ProjectError> {
    let mut dialog = app.dialog().file();
    dialog = match title.as_deref() {
        Some(text) if !text.trim().is_empty() => dialog.set_title(text.trim()),
        _ => dialog.set_title("Elegir video"),
    };
    let Some(picked) = dialog
        .add_filter(
            "Videos",
            &[
                "mp4", "mkv", "mov", "avi", "webm", "wmv", "flv", "ts", "m4v", "mpg", "mpeg",
                "3gp", "ogv",
            ],
        )
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "No se pudo usar el video elegido.")
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Selector nativo de audio suelto (mejora de voz, transcripción, análisis).
#[tauri::command]
pub async fn choose_audio_file(
    app: AppHandle,
    title: Option<String>,
) -> Result<Option<String>, ProjectError> {
    let mut dialog = app.dialog().file();
    dialog = match title.as_deref() {
        Some(text) if !text.trim().is_empty() => dialog.set_title(text.trim()),
        _ => dialog.set_title("Elegir audio"),
    };
    let Some(picked) = dialog
        .add_filter(
            "Audio",
            &[
                "wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "wma", "aiff", "aif", "caf",
                "mp4", "mov", "mkv",
            ],
        )
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "No se pudo usar el audio elegido.")
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
