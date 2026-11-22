// Importación de medios al proyecto: diálogo nativo o rutas explícitas de
// tool bridges. La orquestación (tope, warnings, derechos) vive en
// `application::media`; la copia+sondeo+hash en `media::import_file`.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

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
    // Cada archivo llega por IPC: política de lectura de `fs_*`.
    let files: Vec<PathBuf> = paths
        .iter()
        .map(|raw| crate::application::fs::resolve_user_file_path(raw))
        .collect::<Result<_, _>>()?;
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

// ─────────────── import_media_bytes ───────────────
// Voz grabada en el webview (MediaRecorder → WAV/PCM): el audio llega como
// base64 porque la webview no toca el filesystem. Se decodifica, se escribe
// un temporal y se importa por el MISMO pipeline que un archivo elegido a
// mano (`import_local_files`: copia a media/, ffprobe, sha256, asset).

/// Tope del audio recibido por IPC (voz: minutos de WAV 48 kHz stereo sobran).
const MAX_IMPORT_BYTES_BYTES: usize = 256 * 1024 * 1024;
/// Largo máximo del base64 que puede decodificar a <= MAX_IMPORT_BYTES_BYTES
/// (4 chars por cada 3 bytes, más holgura de padding). Se valida ANTES de
/// decodificar para no reservar el buffer de una entrada sobredimensionada.
const MAX_IMPORT_BASE64_CHARS: usize = MAX_IMPORT_BYTES_BYTES.div_ceil(3) * 4 + 8;
/// Extensiones de audio que el comando acepta; el probe de ffprobe valida
/// después que el contenido sea realmente audio.
const IMPORT_BYTE_EXTENSIONS: &[&str] =
    &["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "webm"];

/// Nombre de archivo seguro para el temporal: sólo el basename, sin
/// separadores ni caracteres raros, y con extensión de audio conocida.
fn sanitize_import_file_name(raw: &str) -> Result<String, ProjectError> {
    let trimmed = raw.trim();
    let name = trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el nombre del audio no es válido",
        ));
    }
    if name.len() > 120
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el nombre del audio sólo admite letras, números, guiones, puntos y espacios",
        ));
    }
    let extension = name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !IMPORT_BYTE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio tiene que ser wav, mp3, m4a, aac, flac, ogg, opus o webm",
        ));
    }
    Ok(name.to_string())
}

fn decode_import_bytes(encoded: &str) -> Result<Vec<u8>, ProjectError> {
    if encoded.trim().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio llegó vacío",
        ));
    }
    // AUD-142: rechazar por largo codificado antes de decodificar — un
    // payload IPC sobredimensionado no debe reservar el Vec decodificado.
    if encoded.len() > MAX_IMPORT_BASE64_CHARS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio supera 256 MB",
        ));
    }
    let bytes = BASE64_STANDARD.decode(encoded).map_err(|_| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "el audio no es base64 válido")
    })?;
    if bytes.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio llegó vacío",
        ));
    }
    if bytes.len() > MAX_IMPORT_BYTES_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el audio supera 256 MB",
        ));
    }
    Ok(bytes)
}

/// Importa audio binario (voz grabada,/blob del webview) al proyecto.
/// `file_name` es sólo una etiqueta (se sanea); `data_base64` es el contenido.
/// Los derechos quedan `unverified` como en una importación manual: la UI
/// declara `user-declared` al montar (el usuario grabó su propia voz).
#[tauri::command]
pub async fn import_media_bytes(
    state: State<'_, AppState>,
    file_name: String,
    data_base64: String,
    fps_num: u32,
    fps_den: u32,
) -> Result<ImportOutcome, ProjectError> {
    let session_root = state.require_session()?.root;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let ffprobe = use_cases::require_ffprobe(ffprobe)?;
    let name = sanitize_import_file_name(&file_name)?;
    let bytes = decode_import_bytes(&data_base64)?;

    // Escribir el archivo completo + import_local_files (ffprobe) puede
    // tardar con medios grandes: fuera del runtime async (AUD-129).
    let outcome = tauri::async_runtime::spawn_blocking(
        move || -> Result<ImportOutcome, ProjectError> {
            let temp_dir =
                std::env::temp_dir().join(format!("olyvia-import-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&temp_dir).map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo crear el temporal de audio")
            })?;
            let temp_file = temp_dir.join(&name);
            if std::fs::write(&temp_file, &bytes).is_err() {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudo escribir el audio temporal",
                ));
            }
            let outcome = use_cases::import_local_files(
                &session_root,
                &ffprobe,
                vec![temp_file],
                fps_num,
                fps_den,
                false,
                None,
                false,
                ImportLimit::MaxPaths(1),
            );
            let _ = std::fs::remove_dir_all(&temp_dir);
            Ok(outcome)
        },
    )
    .await
    .map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "la importación de medios se interrumpió")
    })??;
    Ok(outcome)
}

