// Importación de medios al proyecto: diálogo nativo o rutas explícitas de
// tool bridges. La orquestación (tope, warnings, derechos) vive en
// `application::media`; la copia+sondeo+hash en `media::import_file`.

use crate::application::media::{self as use_cases, ImportLimit};

#[tauri::command]
pub async fn import_assets(
    app: AppHandle,
    state: State<'_, AppState>,
    fps_num: u32,
    fps_den: u32,
) -> Result<Option<ImportOutcome>, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let ffprobe = use_cases::require_ffprobe(ffprobe)?;

    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Importar video, imagen o audio")
        .add_filter(
            "Medios",
            &[
                "mp4", "mov", "mkv", "webm", "avi", "m4v", "mts", "m2ts", "jpg", "jpeg", "png",
                "webp", "bmp", "gif", "tif", "tiff", "avif", "wav", "mp3", "m4a", "aac", "flac",
                "ogg", "opus", "wma",
            ],
        )
        .blocking_pick_files()
    else {
        return Ok(None);
    };

    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for file in picked {
        match file.into_path() {
            Ok(path) => files.push(path),
            Err(_) => skipped
                .push("Se salteó una selección que no era una ruta local.".to_owned()),
        }
    }
    let mut outcome = use_cases::import_local_files(
        &session.root,
        &ffprobe,
        files,
        fps_num,
        fps_den,
        false,
        None,
        false,
        ImportLimit::MaxAssets(crate::media::MAX_IMPORT_FILES),
    );
    // Los salteados por no ser ruta local van primero, como en el flujo
    // original donde se evaluaban antes del tope.
    if !skipped.is_empty() {
        skipped.append(&mut outcome.warnings);
        outcome.warnings = skipped;
    }
    Ok(Some(outcome))
}

/// Import media from explicit local paths. Used by tool bridges (Google Flow
/// MCP, converters) that already produced files on this machine. The dialog is
/// not involved, so the caller must have received the paths from an explicit
/// user action. Rights remain unverified unless `confirm_rights` is true.
#[tauri::command]
pub async fn import_media_paths(
    state: State<'_, AppState>,
    fps_num: u32,
    fps_den: u32,
    paths: Vec<String>,
    confirm_rights: Option<bool>,
    provider: Option<String>,
) -> Result<ImportOutcome, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let ffprobe = use_cases::require_ffprobe(ffprobe)?;
    let files: Vec<PathBuf> = paths
        .iter()
        .map(|raw| PathBuf::from(raw.trim()))
        .collect();
    let provenance_provider = provider
        .map(|value| value.trim().chars().take(80).collect::<String>())
        .filter(|value| !value.is_empty());
    Ok(use_cases::import_local_files(
        &session.root,
        &ffprobe,
        files,
        fps_num,
        fps_den,
        confirm_rights.unwrap_or(false),
        provenance_provider.as_deref(),
        true,
        ImportLimit::MaxPaths(crate::media::MAX_IMPORT_FILES),
    ))
}
