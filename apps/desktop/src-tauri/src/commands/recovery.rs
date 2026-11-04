//! Fase 1 · recuperación de proyectos, historial y duplicados.
//!
//! Contrato expuesto al frontend (camelCase):
//! - `choose_media_folder` → `Option<String>`
//! - `find_missing_assets(projectPath?)` → `MissingAssetInfo[]`
//! - `relink_asset(assetId, newPath)` → `RelinkResult`
//! - `relink_assets_from_folder(projectPath?, folder)` → `RelinkFolderResult`
//! - `list_project_versions(projectPath?)` → `ProjectVersionInfo[]`
//! - `restore_project_version(projectPath, versionId, mode?)` → `RestoreProjectVersionResult`
//! - `find_duplicate_assets(projectPath?)` → `DuplicateAssetGroup[]`
//!
//! Los snapshots viven en `<raíz del proyecto>/.olyvia-history/` con nombre
//! `<savedAtMs>-<reason>.editoria.json`; rotación de 20 archivos. El guardado
//! normal crea un snapshot previo (`snapshot_before_save`, autosave con throttle
//! de 60 s) y restaurar guarda antes un `before-restore`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::media::{resolve_inside_root, sha256_file};
use crate::projects::service::{self, ProjectError, ProjectErrorCode};
use crate::state::AppState;

pub const HISTORY_DIR: &str = ".olyvia-history";
pub const HISTORY_LIMIT: usize = 20;
const AUTOSAVE_THROTTLE_MS: u64 = 60_000;
const MAX_FOLDER_FILES: usize = 5_000;
const FOLDER_SCAN_DEPTH: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingAssetInfo {
    pub asset_id: String,
    pub label: String,
    pub kind: String,
    pub path: String,
    pub used_by_clip_ids: Vec<String>,
    pub proxy_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkResult {
    pub ok: bool,
    pub asset_id: Option<String>,
    pub path: Option<String>,
    pub copied: Option<bool>,
    pub validated_by: Option<String>,
    pub bytes: Option<u64>,
    pub sha256: Option<String>,
    pub reason: Option<String>,
    pub missing: Option<MissingAssetInfo>,
}

impl RelinkResult {
    fn failed(asset_id: &str, reason: &str) -> Self {
        Self {
            ok: false,
            asset_id: Some(asset_id.to_owned()),
            path: None,
            copied: None,
            validated_by: None,
            bytes: None,
            sha256: None,
            reason: Some(reason.to_owned()),
            missing: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkFolderRejected {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkFolderResult {
    pub relinked: Vec<RelinkResult>,
    pub still_missing: Vec<MissingAssetInfo>,
    pub rejected: Vec<RelinkFolderRejected>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectVersionInfo {
    pub id: String,
    pub project_path: String,
    pub path: String,
    pub saved_at_ms: u64,
    pub bytes: u64,
    pub reason: String,
    pub project_name: Option<String>,
    pub asset_count: u64,
    pub clip_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreProjectVersionResult {
    pub restore_mode: String,
    pub project_path: String,
    pub backup_path: Option<String>,
    pub version: ProjectVersionInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateAssetGroup {
    pub sha256: String,
    pub bytes: u64,
    pub asset_ids: Vec<String>,
    pub labels: Vec<String>,
    pub paths: Vec<String>,
    pub used_by_clip_ids: HashMap<String, Vec<String>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn absolute(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Proyecto pedido explícitamente o el abierto en la sesión.
fn project_location(
    state: &AppState,
    project_path: Option<&str>,
) -> Result<(PathBuf, PathBuf), ProjectError> {
    if let Some(raw) = project_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(raw);
        let root = path.parent().map(Path::to_path_buf).ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::Io, "ruta de proyecto inválida")
        })?;
        if !path.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "el proyecto indicado no está en disco",
            ));
        }
        return Ok((path, root));
    }
    let session = state.require_session()?;
    Ok((session.path, session.root))
}

/// Proyecto abierto en la sesión (necesario para mutar y guardar).
fn open_project_location(state: &AppState) -> Result<(PathBuf, PathBuf), ProjectError> {
    let session = state.require_session()?;
    Ok((session.path, session.root))
}

fn normalized_relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn asset_paths(project: &Value) -> Vec<(String, String, String, String)> {
    // (assetId, label, kind, source path)
    project["assets"]
        .as_array()
        .map(|assets| {
            assets
                .iter()
                .filter_map(|asset| {
                    let id = asset["id"].as_str()?.to_owned();
                    let label = asset["label"].as_str().unwrap_or("Medio").to_owned();
                    let kind = asset["kind"].as_str().unwrap_or("video").to_owned();
                    let source = &asset["source"];
                    if source["type"].as_str() != Some("asset")
                        && source["type"].as_str() != Some("local")
                    {
                        return None;
                    }
                    let path = source["path"].as_str().unwrap_or("").to_owned();
                    Some((id, label, kind, path))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn clips_for_asset(project: &Value, asset_id: &str) -> Vec<String> {
    project["timeline"]["clips"]
        .as_array()
        .map(|clips| {
            clips
                .iter()
                .filter(|clip| clip["source"]["assetId"].as_str() == Some(asset_id))
                .filter_map(|clip| clip["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn proxy_candidates(root: &Path, asset_id: &str) -> Vec<PathBuf> {
    let directory = root.join("media").join("proxies");
    let Ok(entries) = fs::read_dir(&directory) else {
        return Vec::new();
    };
    let needle = format!("proxy-{asset_id}-");
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with(&needle))
                .unwrap_or(false)
        })
        .collect()
}

fn proxy_for_asset(root: &Path, asset_id: &str) -> Option<String> {
    proxy_candidates(root, asset_id)
        .into_iter()
        .max_by_key(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok())
        .map(|path| {
            path.strip_prefix(root)
                .map(normalized_relative)
                .unwrap_or_else(|_| normalized_relative(&path))
        })
}

fn missing_asset_info(
    project: &Value,
    root: &Path,
    asset_id: &str,
    label: &str,
    kind: &str,
    path: &str,
) -> MissingAssetInfo {
    MissingAssetInfo {
        asset_id: asset_id.to_owned(),
        label: label.to_owned(),
        kind: kind.to_owned(),
        path: path.to_owned(),
        used_by_clip_ids: clips_for_asset(project, asset_id),
        proxy_path: proxy_for_asset(root, asset_id),
    }
}

fn missing_from(project: &Value, root: &Path) -> Vec<MissingAssetInfo> {
    let mut missing = Vec::new();
    for (asset_id, label, kind, path) in asset_paths(project) {
        if path.trim().is_empty() {
            continue;
        }
        let exists = resolve_inside_root(root, &path)
            .map(|resolved| resolved.is_file())
            .unwrap_or(false);
        if !exists {
            missing.push(missing_asset_info(
                project, root, &asset_id, &label, &kind, &path,
            ));
        }
    }
    missing
}

fn unique_target(directory: &Path, file_name: &str) -> PathBuf {
    let candidate = directory.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("medio");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    for index in 2..=9_999 {
        let name = if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let next = directory.join(name);
        if !next.exists() {
            return next;
        }
    }
    candidate
}

fn copy_into_project(root: &Path, source: &Path) -> Result<String, ProjectError> {
    let directory = root.join("media").join("relink");
    fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo crear media/relink")
    })?;
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, "archivo sin nombre"))?;
    let target = unique_target(&directory, name);
    fs::copy(source, &target).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo copiar el medio a la carpeta del proyecto",
        )
    })?;
    let relative = target
        .strip_prefix(root)
        .map(normalized_relative)
        .unwrap_or_else(|_| normalized_relative(&target));
    Ok(relative)
}

/// Copia un archivo a la carpeta del proyecto si está fuera de la raíz.
fn place_inside_project(root: &Path, source: &Path) -> Result<(String, bool), ProjectError> {
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let canonical_source = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    if canonical_source.starts_with(&canonical_root) {
        let relative = canonical_source
            .strip_prefix(&canonical_root)
            .map(normalized_relative)
            .unwrap_or_else(|_| normalized_relative(source));
        return Ok((relative, false));
    }
    Ok((copy_into_project(root, source)?, true))
}

fn ensure_asset(project: &mut Value, asset_id: &str) -> Result<usize, ProjectError> {
    let assets = project["assets"].as_array().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::InvalidProject, "proyecto sin assets")
    })?;
    assets
        .iter()
        .position(|asset| asset["id"].as_str() == Some(asset_id))
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "el medio no está en el proyecto",
            )
        })
}

fn set_asset_path(project: &mut Value, index: usize, relative: &str) {
    if let Some(asset) = project["assets"].get_mut(index) {
        asset["source"]["path"] = Value::String(relative.to_owned());
    }
}

fn sha256_of(path: &Path) -> Option<String> {
    sha256_file(path).ok().map(|(sha256, _)| sha256)
}

fn asset_declared_sha(project: &Value, index: usize) -> Option<String> {
    project["assets"]
        .get(index)
        .and_then(|asset| asset["integrity"]["sha256"].as_str())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| value.len() == 64)
}

/// Valida y repunta un asset del proyecto abierto. Devuelve el resultado para la
/// UI; no copia archivos si ya están dentro de la raíz.
fn relink_asset_in_project(
    project: &mut Value,
    root: &Path,
    asset_id: &str,
    new_path: &Path,
) -> Result<RelinkResult, ProjectError> {
    if !new_path.is_file() {
        return Ok(RelinkResult::failed(
            asset_id,
            "el archivo elegido no existe",
        ));
    }
    let index = match ensure_asset(project, asset_id) {
        Ok(index) => index,
        Err(error) => return Ok(RelinkResult::failed(asset_id, &error.message)),
    };
    if new_path
        .components()
        .any(|component| component.as_os_str() == "proxies")
    {
        return Ok(RelinkResult::failed(
            asset_id,
            "un proxy de vista previa no sirve como origen; elegí el archivo original",
        ));
    }
    let bytes = fs::metadata(new_path).map(|meta| meta.len()).unwrap_or(0);
    let (relative, copied) = match place_inside_project(root, new_path) {
        Ok(value) => value,
        Err(error) => return Ok(RelinkResult::failed(asset_id, &error.message)),
    };
    let declared = asset_declared_sha(project, index);
    let mut validated_by = "name-size".to_owned();
    let mut sha256 = None;
    if let Some(expected) = declared {
        let actual = sha256_of(new_path).unwrap_or_default();
        if actual.is_empty() || actual != expected {
            return Ok(RelinkResult::failed(
                asset_id,
                "el archivo no coincide con el SHA-256 registrado del medio",
            ));
        }
        validated_by = "hash".to_owned();
        sha256 = Some(actual);
    }
    set_asset_path(project, index, &relative);
    Ok(RelinkResult {
        ok: true,
        asset_id: Some(asset_id.to_owned()),
        path: Some(relative),
        copied: Some(copied),
        validated_by: Some(validated_by),
        bytes: Some(bytes),
        sha256,
        reason: None,
        missing: None,
    })
}

#[tauri::command]
pub async fn choose_media_folder(
    app: tauri::AppHandle,
    title: Option<String>,
) -> Result<Option<String>, ProjectError> {
    let mut dialog = app.dialog().file();
    if let Some(title) = title.as_deref().filter(|value| !value.trim().is_empty()) {
        dialog = dialog.set_title(title);
    }
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la carpeta elegida")
    })?;
    Ok(Some(absolute(&path)))
}

#[tauri::command]
pub async fn find_missing_assets(
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<MissingAssetInfo>, ProjectError> {
    let (path, root) = project_location(&state, project_path.as_deref())?;
    let opened = service::open_project(&path)?;
    Ok(missing_from(&opened.project, &root))
}

#[tauri::command]
pub async fn relink_asset(
    state: State<'_, AppState>,
    asset_id: String,
    new_path: String,
) -> Result<RelinkResult, ProjectError> {
    let (project_path, root) = open_project_location(&state)?;
    let mut opened = service::open_project(&project_path)?;
    let raw = PathBuf::from(new_path.trim());
    let source = if raw.is_absolute() {
        raw
    } else {
        root.join(raw)
    };
    let result = relink_asset_in_project(&mut opened.project, &root, &asset_id, &source)?;
    if result.ok {
        service::save_project(&project_path, &opened.project)?;
    }
    Ok(result)
}

fn asset_expected_bytes(project: &Value, asset_id: &str) -> Option<u64> {
    project["assets"]
        .as_array()
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset["id"].as_str() == Some(asset_id))
        })
        .and_then(|asset| {
            asset["integrity"]["bytes"]
                .as_u64()
                .or_else(|| asset["source"]["bytes"].as_u64())
                .or_else(|| asset["sizeBytes"].as_u64())
        })
}

fn file_matches(file: &Path, name: &str, expected_bytes: Option<u64>) -> bool {
    let Some(file_name) = file.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if file_name != name {
        return false;
    }
    match expected_bytes {
        Some(expected) => fs::metadata(file)
            .map(|meta| meta.len() == expected)
            .unwrap_or(false),
        None => true,
    }
}

fn repository_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

#[tauri::command]
pub async fn relink_assets_from_folder(
    state: State<'_, AppState>,
    project_path: Option<String>,
    folder: String,
) -> Result<RelinkFolderResult, ProjectError> {
    let (path, root) = project_location(&state, project_path.as_deref())?;
    let mut opened = service::open_project(&path)?;
    let directory = PathBuf::from(folder.trim());
    if !directory.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "la carpeta elegida no existe",
        ));
    }
    let files = collect_files(&directory, FOLDER_SCAN_DEPTH, MAX_FOLDER_FILES);
    let missing = missing_from(&opened.project, &root);
    let mut relinked = Vec::new();
    let mut rejected = Vec::new();
    let mut still_missing = Vec::new();
    for item in missing {
        let expected = asset_expected_bytes(&opened.project, &item.asset_id);
        let name = repository_name(&item.path);
        let candidates: Vec<&PathBuf> = files
            .iter()
            .filter(|file| file_matches(file, name, expected))
            .collect();
        if candidates.is_empty() {
            still_missing.push(item);
            continue;
        }
        if candidates.len() > 1 {
            rejected.push(RelinkFolderRejected {
                path: item.path.clone(),
                reason: "hay más de un archivo con ese nombre (y tamaño) en la carpeta".to_owned(),
            });
            still_missing.push(item);
            continue;
        }
        match relink_asset_in_project(&mut opened.project, &root, &item.asset_id, candidates[0]) {
            Ok(result) if result.ok => relinked.push(result),
            Ok(result) => {
                rejected.push(RelinkFolderRejected {
                    path: item.path.clone(),
                    reason: result
                        .reason
                        .unwrap_or_else(|| "no se pudo repuntar".to_owned()),
                });
                still_missing.push(item);
            }
            Err(error) => {
                rejected.push(RelinkFolderRejected {
                    path: item.path.clone(),
                    reason: error.message,
                });
                still_missing.push(item);
            }
        }
    }
    if !relinked.is_empty() {
        service::save_project(&path, &opened.project)?;
    }
    Ok(RelinkFolderResult {
        relinked,
        still_missing,
        rejected,
    })
}

fn collect_files(root: &Path, depth: usize, limit: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![(root.to_path_buf(), depth)];
    while let Some((directory, remaining)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                if remaining > 0 {
                    stack.push((path, remaining - 1));
                }
            } else if path.is_file() {
                files.push(path);
                if files.len() >= limit {
                    return files;
                }
            }
        }
    }
    files
}

fn history_directory(root: &Path) -> PathBuf {
    root.join(HISTORY_DIR)
}

fn parse_reason(id: &str) -> String {
    let stem = id.trim_end_matches(".editoria.json");
    stem.split_once('-')
        .map(|(_, reason)| reason.to_owned())
        .unwrap_or_else(|| "snapshot".to_owned())
}

fn version_saved_at(id: &str) -> u64 {
    id.split_once('-')
        .and_then(|(timestamp, _)| timestamp.parse::<u64>().ok())
        .unwrap_or(0)
}

fn project_counts(document: &Value) -> (u64, u64) {
    let assets = document["assets"].as_array().map(Vec::len).unwrap_or(0) as u64;
    let clips = document["timeline"]["clips"]
        .as_array()
        .map(Vec::len)
        .unwrap_or(0) as u64;
    (assets, clips)
}

fn version_info(project_path: &Path, version_path: &Path) -> ProjectVersionInfo {
    let id = version_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_owned();
    let bytes = fs::metadata(version_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let document = fs::read_to_string(version_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let (asset_count, clip_count) = document.as_ref().map(project_counts).unwrap_or((0, 0));
    ProjectVersionInfo {
        id: id.clone(),
        project_path: absolute(project_path),
        path: absolute(version_path),
        saved_at_ms: version_saved_at(&id),
        bytes,
        reason: parse_reason(&id),
        project_name: document
            .as_ref()
            .and_then(|doc| doc["name"].as_str().map(str::to_owned)),
        asset_count,
        clip_count,
    }
}

fn list_versions_of(project_path: &Path) -> Vec<ProjectVersionInfo> {
    let root = project_path.parent().unwrap_or_else(|| Path::new("."));
    let directory = history_directory(root);
    let Ok(entries) = fs::read_dir(&directory) else {
        return Vec::new();
    };
    let mut versions: Vec<ProjectVersionInfo> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|value| value.to_str()) == Some("json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.ends_with(".editoria.json"))
                    .unwrap_or(false)
        })
        .map(|path| version_info(project_path, &path))
        .collect();
    versions.sort_by(|a, b| b.saved_at_ms.cmp(&a.saved_at_ms));
    versions
}

fn prune_history(root: &Path) {
    let directory = history_directory(root);
    let Ok(entries) = fs::read_dir(&directory) else {
        return;
    };
    let mut versions: Vec<(u64, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.ends_with(".editoria.json"))
                .unwrap_or(false)
        })
        .map(|path| {
            let saved_at = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(version_saved_at)
                .unwrap_or(0);
            (saved_at, path)
        })
        .collect();
    if versions.len() <= HISTORY_LIMIT {
        return;
    }
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in versions.into_iter().skip(HISTORY_LIMIT) {
        let _ = fs::remove_file(path);
    }
}

/// Guarda una copia del proyecto en `.olyvia-history/` (snapshot).
pub fn snapshot_project(project_path: &Path, reason: &str) -> Option<PathBuf> {
    if !project_path.is_file() {
        return None;
    }
    let root = project_path.parent()?;
    let directory = history_directory(root);
    fs::create_dir_all(&directory).ok()?;
    let timestamp = now_ms();
    let id = format!("{timestamp}-{reason}.editoria.json");
    let target = directory.join(id);
    fs::copy(project_path, &target).ok()?;
    prune_history(root);
    Some(target)
}

/// Snapshot previo a guardar: autosave con throttle de 60 s, manual siempre.
pub fn snapshot_before_save(project_path: &Path, reason: &str) {
    if !project_path.is_file() {
        return;
    }
    let Some(root) = project_path.parent() else {
        return;
    };
    if reason == "autosave" {
        if let Some(newest) = list_versions_of(project_path)
            .into_iter()
            .find(|version| version.reason == "autosave")
        {
            if now_ms().saturating_sub(newest.saved_at_ms) < AUTOSAVE_THROTTLE_MS {
                return;
            }
        }
    }
    let _ = snapshot_project(project_path, reason);
    let _ = root;
}

#[tauri::command]
pub async fn list_project_versions(
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<ProjectVersionInfo>, ProjectError> {
    let (path, _root) = project_location(&state, project_path.as_deref())?;
    Ok(list_versions_of(&path))
}

#[tauri::command]
pub async fn restore_project_version(
    _state: State<'_, AppState>,
    project_path: String,
    version_id: String,
    mode: Option<String>,
) -> Result<RestoreProjectVersionResult, ProjectError> {
    let project = PathBuf::from(project_path.trim());
    if !project.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el proyecto indicado no está en disco",
        ));
    }
    let root = project
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, "ruta de proyecto inválida"))?;
    let safe_name = Path::new(&version_id)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ProjectError::message(ProjectErrorCode::Io, "versión inválida"))?;
    let version_path = history_directory(&root).join(safe_name);
    if !version_path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "esa versión del proyecto ya no existe",
        ));
    }
    // Valida que el snapshot sea un proyecto real antes de pisar nada.
    service::open_project(&version_path)?;
    let version = version_info(&project, &version_path);
    let copy_mode = mode.as_deref() == Some("copy");
    if copy_mode {
        let stem = project
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("proyecto");
        let restored = unique_target(
            &root,
            &format!("{stem}-restored-{}.editoria.json", version.saved_at_ms),
        );
        fs::copy(&version_path, &restored).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no se pudo crear la copia restaurada")
        })?;
        return Ok(RestoreProjectVersionResult {
            restore_mode: "copy".to_owned(),
            project_path: absolute(&restored),
            backup_path: None,
            version,
        });
    }
    let backup = snapshot_project(&project, "before-restore");
    let temporary = project.with_extension("editoria.restore.tmp");
    fs::copy(&version_path, &temporary).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo preparar la restauración")
    })?;
    fs::rename(&temporary, &project).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        ProjectError::message(ProjectErrorCode::Io, "no se pudo restaurar el proyecto")
    })?;
    Ok(RestoreProjectVersionResult {
        restore_mode: "in-place".to_owned(),
        project_path: absolute(&project),
        backup_path: backup.map(|path| absolute(&path)),
        version,
    })
}

#[tauri::command]
pub async fn find_duplicate_assets(
    state: State<'_, AppState>,
    project_path: Option<String>,
) -> Result<Vec<DuplicateAssetGroup>, ProjectError> {
    let (path, root) = project_location(&state, project_path.as_deref())?;
    let opened = service::open_project(&path)?;
    let mut groups: HashMap<(String, u64), Vec<(String, String, String, Vec<String>)>> =
        HashMap::new();
    for (asset_id, label, _kind, relative) in asset_paths(&opened.project) {
        let Ok(resolved) = resolve_inside_root(&root, &relative) else {
            continue;
        };
        if !resolved.is_file() {
            continue;
        }
        let Ok((sha256, bytes)) = sha256_file(&resolved) else {
            continue;
        };
        groups.entry((sha256, bytes)).or_default().push((
            asset_id.clone(),
            label,
            relative,
            clips_for_asset(&opened.project, &asset_id),
        ));
    }
    Ok(groups
        .into_iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|((sha256, bytes), items)| DuplicateAssetGroup {
            sha256,
            bytes,
            asset_ids: items.iter().map(|item| item.0.clone()).collect(),
            labels: items.iter().map(|item| item.1.clone()).collect(),
            paths: items.iter().map(|item| item.2.clone()).collect(),
            used_by_clip_ids: items.into_iter().map(|item| (item.0, item.3)).collect(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsea_el_nombre_de_una_version() {
        assert_eq!(
            parse_reason("1700000000000-before-restore.editoria.json"),
            "before-restore"
        );
        assert_eq!(
            version_saved_at("1700000000000-autosave.editoria.json"),
            1_700_000_000_000
        );
        assert_eq!(version_saved_at("sin-formato"), 0);
    }

    #[test]
    fn normaliza_rutas_relativas() {
        assert_eq!(
            normalized_relative(Path::new("media\\clip.mp4")),
            "media/clip.mp4"
        );
    }

    #[test]
    fn cuenta_assets_y_clips_del_documento() {
        let document = serde_json::json!({
            "assets": [{ "id": "a" }, { "id": "b" }],
            "timeline": { "clips": [{ "id": "c" }] }
        });
        assert_eq!(project_counts(&document), (2, 1));
    }

    #[test]
    fn el_target_unico_no_pisa_archivos() {
        let directory =
            std::env::temp_dir().join(format!("olyvia-relink-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("tmp");
        fs::write(directory.join("clip.mp4"), b"a").expect("write");
        let target = unique_target(&directory, "clip.mp4");
        assert_eq!(
            target.file_name().and_then(|value| value.to_str()),
            Some("clip-2.mp4")
        );
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn un_snapshot_se_copia_y_se_lista() {
        let directory =
            std::env::temp_dir().join(format!("olyvia-history-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("tmp");
        let project = directory.join("obra.editoria.json");
        fs::write(
            &project,
            serde_json::json!({
                "name": "Obra",
                "assets": [{ "id": "a" }],
                "timeline": { "clips": [] }
            })
            .to_string(),
        )
        .expect("write");
        let snapshot = snapshot_project(&project, "manual").expect("snapshot");
        assert!(snapshot.is_file());
        let versions = list_versions_of(&project);
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].reason, "manual");
        assert_eq!(versions[0].project_name.as_deref(), Some("Obra"));
        let _ = fs::remove_dir_all(&directory);
    }
}
