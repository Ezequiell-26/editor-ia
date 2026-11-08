//! Adaptador de recuperación de assets sobre el filesystem local.
//!
//! Implementa `ProjectAssetRecovery`: detección de medios faltantes, copia a
//! `media/relink` cuando el origen está fuera de la raíz, validación por
//! SHA-256 declarado, escaneo acotado de carpetas de origen y agrupación de
//! duplicados por contenido. No conoce Tauri ni la sesión: recibe el
//! documento y la raíz del proyecto.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::media::{resolve_inside_root, sha256_file};
use crate::ports::projects::{
    DuplicateAssetGroup, MissingAssetInfo, ProjectAssetRecovery, RelinkResult,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};

const MAX_FOLDER_FILES: usize = 5_000;
const FOLDER_SCAN_DEPTH: usize = 4;

/// Recuperación de assets del proyecto sobre el disco local.
pub struct LocalProjectAssetRecovery;

fn normalized_relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// (assetId, label, kind, source path) de los assets con fuente local.
fn asset_paths(project: &Value) -> Vec<(String, String, String, String)> {
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

fn ensure_asset(project: &Value, asset_id: &str) -> Result<usize, ProjectError> {
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

/// Valida y repunta un asset del documento. Devuelve el resultado para la
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

impl ProjectAssetRecovery for LocalProjectAssetRecovery {
    fn missing_assets(&self, project: &Value, root: &Path) -> Vec<MissingAssetInfo> {
        missing_from(project, root)
    }

    fn scan_source_folder(&self, folder: &Path) -> Result<Vec<PathBuf>, ProjectError> {
        if !folder.is_dir() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "la carpeta elegida no existe",
            ));
        }
        Ok(collect_files(folder, FOLDER_SCAN_DEPTH, MAX_FOLDER_FILES))
    }

    fn file_size(&self, path: &Path) -> Option<u64> {
        fs::metadata(path).ok().map(|meta| meta.len())
    }

    fn relink_asset(
        &self,
        project: &mut Value,
        root: &Path,
        asset_id: &str,
        source: &Path,
    ) -> Result<RelinkResult, ProjectError> {
        relink_asset_in_project(project, root, asset_id, source)
    }

    fn duplicate_groups(&self, project: &Value, root: &Path) -> Vec<DuplicateAssetGroup> {
        type GroupKey = (String, u64);
        type GroupItem = (String, String, String, Vec<String>);
        let mut groups: HashMap<GroupKey, Vec<GroupItem>> = HashMap::new();
        for (asset_id, label, _kind, relative) in asset_paths(project) {
            let Ok(resolved) = resolve_inside_root(root, &relative) else {
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
                clips_for_asset(project, &asset_id),
            ));
        }
        groups
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
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
