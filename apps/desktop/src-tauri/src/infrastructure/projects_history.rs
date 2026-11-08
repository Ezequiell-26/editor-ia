//! Almacén de versiones del proyecto sobre el filesystem.
//!
//! Snapshots en `<raíz>/.olyvia-history/<savedAtMs>-<reason>.editoria.json`,
//! rotación de `HISTORY_LIMIT` archivos. Restaurar valida que el snapshot sea
//! un proyecto real (`service::open_project`) antes de pisar nada, guarda un
//! backup `before-restore` y escribe por temporal + rename.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::ports::projects::{ProjectVersionInfo, ProjectVersioning, RestoreProjectVersionResult};
use crate::projects::service::{self, ProjectError, ProjectErrorCode};

pub const HISTORY_DIR: &str = ".olyvia-history";
pub const HISTORY_LIMIT: usize = 20;
const AUTOSAVE_THROTTLE_MS: u64 = 60_000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn absolute(path: &Path) -> String {
    path.to_string_lossy().into_owned()
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
    versions.sort_by_key(|version| std::cmp::Reverse(version.saved_at_ms));
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
    versions.sort_by_key(|version| std::cmp::Reverse(version.0));
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

/// Almacén de versiones sobre el filesystem local.
pub struct LocalProjectVersioning;

impl ProjectVersioning for LocalProjectVersioning {
    fn snapshot_before_save(&self, project_path: &Path, reason: &str) {
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

    fn list_versions(&self, project_path: &Path) -> Vec<ProjectVersionInfo> {
        list_versions_of(project_path)
    }

    fn restore_version(
        &self,
        project_path: &Path,
        version_id: &str,
        copy: bool,
    ) -> Result<RestoreProjectVersionResult, ProjectError> {
        let project = project_path.to_path_buf();
        if !project.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "el proyecto indicado no está en disco",
            ));
        }
        let root = project.parent().map(Path::to_path_buf).ok_or_else(|| {
            ProjectError::message(ProjectErrorCode::Io, "ruta de proyecto inválida")
        })?;
        let safe_name = Path::new(version_id)
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
        if copy {
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
    fn cuenta_assets_y_clips_del_documento() {
        let document = serde_json::json!({
            "assets": [{ "id": "a" }, { "id": "b" }],
            "timeline": { "clips": [{ "id": "c" }] }
        });
        assert_eq!(project_counts(&document), (2, 1));
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
