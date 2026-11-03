//! Plugins de la app.
//!
//! Un plugin es una carpeta con `plugin.json` (manifiesto) y, opcionalmente,
//! recursos. Se instala copiándola al directorio de datos del usuario; los
//! oficiales viven en `resources/plugins` y no se pueden borrar.
//!
//! El manifiesto es **declarativo**: un plugin aporta presets (efectos, perfiles
//! de exportación, estilos de subtítulo) y comandos con pasos que la app ya sabe
//! ejecutar. No se ejecuta código de terceros: un plugin no puede leer archivos
//! ni tocar la red, sólo describir lo que la app debe hacer.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MANIFEST: &str = "plugin.json";
const STATE_FILE: &str = "plugins.json";
const MAX_PLUGIN_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_PLUGIN_COMMANDS: usize = 64;
const MAX_PLUGIN_COMMAND_STEPS: usize = 32;
const MAX_PLUGIN_PRESETS: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    /// Los oficiales vienen con la app y no se pueden desinstalar.
    #[serde(default)]
    pub official: bool,
    /// `plugin`, `skill` o `connector`.
    #[serde(default = "default_kind")]
    pub kind: String,
    /// Sólo para conectores: servidor MCP que la app registra.
    #[serde(default)]
    pub mcp: Option<PluginMcp>,
    #[serde(default)]
    pub presets: PluginPresets,
    #[serde(default)]
    pub commands: Vec<PluginCommand>,
}

fn default_kind() -> String {
    "plugin".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginMcp {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPresets {
    #[serde(default)]
    pub effects: Vec<Value>,
    #[serde(default)]
    pub export_profiles: Vec<Value>,
    #[serde(default)]
    pub caption_styles: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommand {
    pub id: String,
    pub label: String,
    /// Pasos en lenguaje del operador («cortá los silencios», «limpiá el video»).
    #[serde(default)]
    pub steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub directory: String,
    pub error: Option<String>,
}

fn data_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(|base| {
            PathBuf::from(base)
                .join("com.editoria.desktop")
                .join("plugins")
        })
        .unwrap_or_else(|_| PathBuf::from("plugins"))
}

/// Carpeta de plugins oficiales: los recursos que Tauri copia al instalar.
/// Si no existen (build de desarrollo), se usa la del repositorio.
fn official_dir(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    if let Ok(directory) = app.path().resource_dir() {
        let candidate = directory.join("plugins");
        if candidate.is_dir() {
            return candidate;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("plugins")
}

fn state_path() -> PathBuf {
    data_dir().join(STATE_FILE)
}

fn read_state() -> serde_json::Map<String, Value> {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_state(map: &serde_json::Map<String, Value>) -> Result<(), ProjectError> {
    let directory = data_dir();
    std::fs::create_dir_all(&directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude crear la carpeta de plugins")
    })?;
    let text = serde_json::to_string_pretty(map).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude serializar plugins.json")
    })?;
    std::fs::write(state_path(), text)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no pude escribir plugins.json"))
}

/// Un id seguro: letras minúsculas, números, guiones y puntos.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '-' | '.' | '_')
        })
}

fn read_manifest(directory: &Path) -> Result<PluginManifest, String> {
    let path = directory.join(MANIFEST);
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| format!("missing {MANIFEST}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("plugin manifest must be a regular file".to_owned());
    }
    if metadata.len() > MAX_PLUGIN_MANIFEST_BYTES {
        return Err("plugin manifest exceeds 256 KiB".to_owned());
    }
    let text = std::fs::read_to_string(&path).map_err(|_| format!("could not read {MANIFEST}"))?;
    let mut manifest: PluginManifest =
        serde_json::from_str(&text).map_err(|error| format!("invalid manifest: {error}"))?;
    if !valid_id(&manifest.id) {
        return Err("el id sólo admite minúsculas, números, guiones y puntos".to_owned());
    }
    if manifest.name.trim().is_empty() || manifest.name.len() > 120 {
        return Err("plugin name must contain at most 120 bytes".to_owned());
    }
    if manifest.version.trim().is_empty() || manifest.version.len() > 64 {
        return Err("plugin version is invalid".to_owned());
    }
    if manifest.description.len() > 2048 || manifest.author.len() > 120 {
        return Err("plugin description or author is too long".to_owned());
    }
    if !matches!(manifest.kind.as_str(), "plugin" | "skill" | "connector") {
        return Err("unsupported plugin kind".to_owned());
    }
    if manifest.commands.len() > MAX_PLUGIN_COMMANDS
        || manifest.presets.effects.len() > MAX_PLUGIN_PRESETS
        || manifest.presets.export_profiles.len() > MAX_PLUGIN_PRESETS
        || manifest.presets.caption_styles.len() > MAX_PLUGIN_PRESETS
    {
        return Err("plugin manifest declares too many commands or presets".to_owned());
    }
    for command in &manifest.commands {
        if !valid_id(&command.id)
            || command.label.trim().is_empty()
            || command.label.len() > 120
            || command.steps.len() > MAX_PLUGIN_COMMAND_STEPS
            || command
                .steps
                .iter()
                .any(|step| step.len() > 512 || step.chars().any(char::is_control))
        {
            return Err("plugin command contains invalid fields".to_owned());
        }
    }
    if let Some(mcp) = &manifest.mcp {
        if mcp.command.trim().is_empty()
            || mcp.command.len() > 512
            || mcp.command.chars().any(char::is_control)
            || mcp.args.len() > 32
            || mcp
                .args
                .iter()
                .any(|arg| arg.len() > 1024 || arg.chars().any(char::is_control))
            || mcp.env.len() > 32
            || mcp.env.iter().any(|key| {
                let mut chars = key.chars();
                !chars
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                    || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
            })
        {
            return Err("MCP connector configuration is invalid".to_owned());
        }
    }
    // Trust is derived from the packaged resource folder, never from user JSON.
    manifest.official = false;
    Ok(manifest)
}

fn scan(
    directory: &Path,
    official: bool,
    state: &serde_json::Map<String, Value>,
) -> Vec<PluginInfo> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut plugins = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        let disabled = state
            .get("disabled")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .any(|item| item.as_str() == path.file_name().and_then(|name| name.to_str()))
            })
            .unwrap_or(false);
        match read_manifest(&path) {
            Ok(mut manifest) => {
                manifest.official = official;
                plugins.push(PluginInfo {
                    manifest,
                    enabled: !disabled,
                    directory: path.to_string_lossy().to_string(),
                    error: None,
                });
            }
            Err(error) => {
                let id = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("desconocido")
                    .to_owned();
                plugins.push(PluginInfo {
                    manifest: PluginManifest {
                        id,
                        name: "Plugin con errores".to_owned(),
                        version: "0".to_owned(),
                        description: String::new(),
                        author: String::new(),
                        official: false,
                        kind: "plugin".to_owned(),
                        mcp: None,
                        presets: PluginPresets::default(),
                        commands: Vec::new(),
                    },
                    enabled: false,
                    directory: path.to_string_lossy().to_string(),
                    error: Some(error),
                });
            }
        }
    }
    plugins.sort_by(|a, b| {
        b.manifest
            .official
            .cmp(&a.manifest.official)
            .then(a.manifest.name.cmp(&b.manifest.name))
    });
    plugins
}

#[tauri::command]
pub fn list_plugins(app: tauri::AppHandle) -> Result<Vec<PluginInfo>, ProjectError> {
    let state = read_state();
    let mut plugins = scan(&official_dir(&app), true, &state);
    plugins.extend(scan(&data_dir(), false, &state));
    Ok(plugins)
}

/// Instala copiando la carpeta indicada al directorio de plugins del usuario.
#[tauri::command]
pub fn install_plugin(
    _state: State<'_, AppState>,
    path: String,
) -> Result<PluginInfo, ProjectError> {
    let source = PathBuf::from(path.trim());
    let source_metadata = std::fs::symlink_metadata(&source).map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "plugin folder does not exist")
    })?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "plugin folder must be a real directory, not a link",
        ));
    }
    let manifest = read_manifest(&source)
        .map_err(|error| ProjectError::message(ProjectErrorCode::InvalidProject, &error))?;
    let plugin_root = data_dir();
    std::fs::create_dir_all(&plugin_root).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "could not create plugin directory")
    })?;
    let target = plugin_root.join(&manifest.id);
    if target.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "ya hay un plugin instalado con ese id",
        ));
    }
    if let Err(error) = copy_dir(&source, &target) {
        let _ = std::fs::remove_dir_all(&target);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            &format!("could not copy plugin: {error}"),
        ));
    }
    Ok(PluginInfo {
        manifest,
        enabled: true,
        directory: target.to_string_lossy().to_string(),
        error: None,
    })
}

fn copy_dir(source: &Path, target: &Path) -> std::io::Result<()> {
    let source_metadata = std::fs::symlink_metadata(source)?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "linked plugin directory",
        ));
    }
    std::fs::create_dir(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let entry_type = entry.file_type()?;
        if entry_type.is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "plugin contains a symbolic link",
            ));
        }
        let path = entry.path();
        let destination = target.join(entry.file_name());
        if entry_type.is_dir() {
            copy_dir(&path, &destination)?;
        } else if entry_type.is_file() {
            std::fs::copy(&path, &destination)?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "plugin contains a special file",
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn remove_plugin(_state: State<'_, AppState>, id: String) -> Result<(), ProjectError> {
    if !valid_id(&id) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "id inválido",
        ));
    }
    let target = data_dir().join(&id);
    if !target.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "ese plugin no está instalado",
        ));
    }
    let metadata = std::fs::symlink_metadata(&target).map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "plugin is not installed")
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "plugin path is not a safe directory",
        ));
    }
    std::fs::remove_dir_all(&target)
        .map_err(|_| ProjectError::message(ProjectErrorCode::Io, "no pude borrar el plugin"))
}

#[tauri::command]
pub fn set_plugin_enabled(
    _state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), ProjectError> {
    if !valid_id(&id) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "id inválido",
        ));
    }
    let mut state = read_state();
    let mut disabled: Vec<String> = state
        .get("disabled")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    disabled.retain(|item| item != &id);
    if !enabled {
        disabled.push(id);
    }
    state.insert(
        "disabled".to_owned(),
        Value::Array(disabled.into_iter().map(Value::String).collect()),
    );
    write_state(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_safe_ids() {
        assert!(valid_id("cleanup.rapido"));
        assert!(valid_id("mi-plugin_2"));
        assert!(!valid_id("Mi Plugin"));
        assert!(!valid_id(""));
        assert!(!valid_id("../../etc"));
    }

    #[test]
    fn reads_a_valid_manifest() {
        let dir = std::env::temp_dir().join(format!("plugin-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(
            dir.join(MANIFEST),
            r#"{"id":"demo","name":"Demo","version":"1.0.0","official":true,"commands":[{"id":"run","label":"Correr","steps":["cortá los silencios"]}]}"#,
        )
        .unwrap();
        let manifest = read_manifest(&dir).expect("manifiesto válido");
        assert_eq!(manifest.id, "demo");
        assert_eq!(manifest.commands.len(), 1);
        assert!(!manifest.official);
        assert_eq!(manifest.kind, "plugin");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_manifest_with_bad_id() {
        let dir = std::env::temp_dir().join(format!("plugin-bad-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(
            dir.join(MANIFEST),
            r#"{"id":"ID INVALIDO","name":"X","version":"1"}"#,
        )
        .unwrap();
        assert!(read_manifest(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
