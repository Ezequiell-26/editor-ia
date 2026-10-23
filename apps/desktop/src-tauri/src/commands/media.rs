//! Media ingestion and thumbnails. The dialog chooses files; the native side
//! copies, hashes and measures them, and the UI declares the rights afterwards.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::system::resolve_tools;
use crate::media::{
    import_file, probe_file, resolve_inside_root, thumbnail_data_url, ImportOutcome, MediaKind,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

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
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible; sin medir el material no se puede importar",
        ));
    };

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

    let mut outcome = ImportOutcome {
        assets: Vec::new(),
        warnings: Vec::new(),
    };
    for file in picked {
        if outcome.assets.len() >= crate::media::MAX_IMPORT_FILES {
            outcome.warnings.push(format!(
                "Se importaron solo los primeros {} archivos.",
                crate::media::MAX_IMPORT_FILES
            ));
            break;
        }
        let path = match file.into_path() {
            Ok(path) => path,
            Err(_) => {
                outcome
                    .warnings
                    .push("Se salteó una selección que no era una ruta local.".to_owned());
                continue;
            }
        };
        match import_file(
            &session.root,
            &path,
            &ffprobe,
            fps_num.max(1),
            fps_den.max(1),
        ) {
            Ok(asset) => outcome.assets.push(asset),
            Err(error) => outcome.warnings.push(format!(
                "{}: {}",
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "archivo".to_owned()),
                error.message
            )),
        }
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
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible; sin medir el material no se puede importar",
        ));
    };
    let mut outcome = ImportOutcome {
        assets: Vec::new(),
        warnings: Vec::new(),
    };
    let confirmed = confirm_rights.unwrap_or(false);
    let provenance_provider = provider
        .map(|value| value.trim().chars().take(80).collect::<String>())
        .filter(|value| !value.is_empty());
    for raw in paths.into_iter().take(crate::media::MAX_IMPORT_FILES) {
        let path = PathBuf::from(raw.trim());
        if !path.is_file() {
            outcome
                .warnings
                .push("Se salteó un artefacto que ya no existe en esa ruta.".to_owned());
            continue;
        }
        match import_file(
            &session.root,
            &path,
            &ffprobe,
            fps_num.max(1),
            fps_den.max(1),
        ) {
            Ok(mut asset) => {
                if confirmed {
                    confirm_generated_rights(&mut asset, provenance_provider.as_deref());
                }
                outcome.assets.push(asset);
            }
            Err(error) => outcome.warnings.push(format!(
                "{}: {}",
                path.file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "archivo".to_owned()),
                error.message
            )),
        }
    }
    Ok(outcome)
}

fn confirm_generated_rights(asset: &mut Value, provider: Option<&str>) {
    asset["status"] = json!("ready");
    if let Some(rights) = asset.get_mut("rights").and_then(Value::as_object_mut) {
        rights.insert(
            "license".to_owned(),
            json!({ "id": "user-declared", "commercialUse": "allowed" }),
        );
        if let Some(provenance) = rights.get_mut("provenance").and_then(Value::as_object_mut) {
            provenance.insert("origin".to_owned(), json!("generated-by-provider"));
            if let Some(provider) = provider {
                provenance.insert("provider".to_owned(), json!(provider));
            }
        }
    }
}

#[derive(Serialize)]
pub struct SampledColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

/// Averages a small frame from a video or image. Used by color match; the
/// frontend turns the two samples into bounded per-channel gains.
#[tauri::command]
pub async fn sample_asset_color(
    state: State<'_, AppState>,
    path: String,
    seconds: f64,
) -> Result<SampledColor, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg es necesario para muestrear el color",
        ));
    };
    if !seconds.is_finite() || !(0.0..=86_400.0).contains(&seconds) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tiempo del muestreo no es válido",
        ));
    }
    let source = resolve_inside_root(&session.root, path.trim())?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo del muestreo no está en disco",
        ));
    }
    let mut command = std::process::Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg(format!("{seconds:.6}"))
        .arg("-i")
        .arg(&source)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=8:8",
            "-an",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar el muestreo de color",
        )
    })?;
    if !output.status.success() || output.stdout.len() < 8 * 8 * 3 {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo muestrear un frame de color",
        ));
    }
    let mut sums = [0u64; 3];
    for pixel in output.stdout.chunks_exact(3).take(8 * 8) {
        sums[0] += pixel[0] as u64;
        sums[1] += pixel[1] as u64;
        sums[2] += pixel[2] as u64;
    }
    let count = 8.0 * 8.0;
    Ok(SampledColor {
        r: (sums[0] as f64 / count * 10.0).round() / 10.0,
        g: (sums[1] as f64 / count * 10.0).round() / 10.0,
        b: (sums[2] as f64 / count * 10.0).round() / 10.0,
    })
}

#[derive(Serialize)]
pub struct ProxyCreated {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
}

#[tauri::command]
pub async fn create_video_proxy(
    state: State<'_, AppState>,
    path: String,
) -> Result<ProxyCreated, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para crear un proxy",
        ));
    };
    let source = resolve_inside_root(&session.root, path.trim())?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del proxy ya no está en disco",
        ));
    }
    let directory = session.root.join("media").join("proxies");
    std::fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/proxies")
    })?;
    let file_name = format!("proxy-{}.mp4", uuid::Uuid::new_v4());
    let target = directory.join(&file_name);
    // Proxy con GPU si la máquina tiene encoder de hardware: es material de
    // vista previa, donde la velocidad pesa más que la máxima calidad.
    let hw = crate::commands::audio::hardware_h264(&ffmpeg);
    let mut command = std::process::Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .args(["-map", "0:v:0", "-map", "0:a?"])
        .args([
            "-vf",
            "scale=w='min(854,iw)':h='min(854,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        ])
        .args(crate::commands::audio::proxy_video_args(hw.as_deref()))
        .args([
            "-c:a",
            "aac",
            "-b:a",
            "96000",
            "-movflags",
            "+faststart",
        ])
        .arg(&target);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para el proxy",
        )
    })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&target);
        let message = String::from_utf8_lossy(&output.stderr);
        let tail: String = message
            .chars()
            .rev()
            .take(300)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("FFmpeg no pudo crear el proxy: {tail}"),
        ));
    }
    let measure = probe_file(&ffprobe, &target, MediaKind::Video)?;
    let width = measure.width.unwrap_or(0);
    let height = measure.height.unwrap_or(0);
    if width == 0 || height == 0 {
        let _ = std::fs::remove_file(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "el proxy se generó sin dimensiones legibles",
        ));
    }
    let bytes = std::fs::metadata(&target)
        .map(|value| value.len())
        .unwrap_or(0);
    Ok(ProxyCreated {
        path: format!("media/proxies/{file_name}"),
        width,
        height,
        bytes,
    })
}

#[tauri::command]
pub async fn extract_freeze_frame(
    state: State<'_, AppState>,
    path: String,
    seconds: f64,
    fps_num: u32,
    fps_den: u32,
) -> Result<Value, ProjectError> {
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
    let (Some(ffmpeg), Some(ffprobe)) = (ffmpeg, ffprobe) else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg y FFprobe son necesarios para congelar un frame",
        ));
    };
    if !seconds.is_finite() || !(0.0..=86_400.0).contains(&seconds) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el tiempo del frame no es válido",
        ));
    }
    let source = resolve_inside_root(&session.root, path.trim())?;
    if !source.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el video del frame ya no está en disco",
        ));
    }
    let temp = std::env::temp_dir().join(format!("freeze-{}.png", uuid::Uuid::new_v4()));
    let mut command = std::process::Command::new(&ffmpeg);
    command
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .arg("-ss")
        .arg(format!("{seconds:.6}"))
        .arg("-frames:v")
        .arg("1")
        .arg("-an")
        .arg(&temp);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para congelar",
        )
    })?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp);
        let message = String::from_utf8_lossy(&output.stderr);
        let tail: String = message
            .chars()
            .rev()
            .take(300)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("FFmpeg no pudo extraer el frame: {tail}"),
        ));
    }
    let imported = import_file(
        &session.root,
        &temp,
        &ffprobe,
        fps_num.max(1),
        fps_den.max(1),
    );
    let _ = std::fs::remove_file(&temp);
    imported
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetFileInfo {
    pub path: String,
    pub exists: bool,
    pub bytes: u64,
}

/// Check that every asset still resolves inside the project root. The UI uses
/// this before rendering and shows a precise warning instead of a broken export.
#[tauri::command]
pub async fn check_asset_files(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<AssetFileInfo>, ProjectError> {
    let session = state.require_session()?;
    let mut out = Vec::new();
    for path in paths.into_iter().take(2_000) {
        match resolve_inside_root(&session.root, &path) {
            Ok(resolved) => {
                let bytes = std::fs::metadata(&resolved).map(|m| m.len()).unwrap_or(0);
                out.push(AssetFileInfo {
                    path,
                    exists: bytes > 0,
                    bytes,
                });
            }
            Err(_) => out.push(AssetFileInfo {
                path,
                exists: false,
                bytes: 0,
            }),
        }
    }
    Ok(out)
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

#[allow(dead_code)]
fn _assert_pathbuf_send(_: PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmed_generated_rights_become_ready_with_provider_provenance() {
        let mut asset = json!({
            "id": "a",
            "status": "unverified",
            "rights": {
                "license": { "id": "unknown", "commercialUse": "unknown" },
                "provenance": { "origin": "user-imported", "acquiredAt": "2026-10-20T00:00:00Z" }
            }
        });
        confirm_generated_rights(&mut asset, Some("google-flow-image"));
        assert_eq!(asset["status"], "ready");
        assert_eq!(asset["rights"]["license"]["commercialUse"], "allowed");
        assert_eq!(
            asset["rights"]["provenance"]["origin"],
            "generated-by-provider"
        );
        assert_eq!(
            asset["rights"]["provenance"]["provider"],
            "google-flow-image"
        );
    }
}
