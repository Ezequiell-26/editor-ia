//! Plugins de la app: manifiesto declarativo, estado enabled/disabled e
//! instalación por copia de carpeta.
//!
//! Un plugin es una carpeta con `plugin.json` (manifiesto) y, opcionalmente,
//! recursos. Se instala copiándola al directorio de datos del usuario; los
//! oficiales viven en `resources/plugins` y no se pueden borrar.
//!
//! El manifiesto es **declarativo**: un plugin aporta presets (efectos, perfiles
//! de exportación, estilos de subtítulo) y comandos con pasos que la app ya sabe
//! ejecutar. No se ejecuta código de terceros: un plugin no puede leer archivos
//! ni tocar la red, sólo describir lo que la app debe hacer.
//!
//! Este módulo es la lógica de filesystem/JSON; los comandos IPC sólo
//! resuelven el AppHandle (carpeta oficial) y delegan.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};

const MANIFEST: &str = "plugin.json";
const STATE_FILE: &str = "plugins.json";
const STATE_BACKUP: &str = "plugins.json.bak";
const STATE_TMP: &str = "plugins.json.tmp";
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

pub fn data_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(|base| {
            PathBuf::from(base)
                .join("com.editoria.desktop")
                .join("plugins")
        })
        .unwrap_or_else(|_| PathBuf::from("plugins"))
}

/// Estado persistido de plugins. `corrupted` marca que ni `plugins.json`
/// ni su backup se pudieron leer: la lista de deshabilitados se perdió y
/// la app no habilita extensiones por defecto (AUD-091).
struct PluginState {
    map: serde_json::Map<String, Value>,
    corrupted: bool,
}

fn read_json_object(path: &Path) -> Option<serde_json::Map<String, Value>> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|value| value.as_object().cloned())
}

fn read_state_in(directory: &Path) -> PluginState {
    let path = directory.join(STATE_FILE);
    if let Some(map) = read_json_object(&path) {
        return PluginState {
            map,
            corrupted: false,
        };
    }
    if !path.exists() {
        // Nunca hubo estado: instalación nueva, habilitar por defecto vale.
        return PluginState {
            map: serde_json::Map::new(),
            corrupted: false,
        };
    }
    // Archivo presente pero ilegible o corrupto: se intenta el backup antes
    // de declarar el estado perdido.
    match read_json_object(&directory.join(STATE_BACKUP)) {
        Some(map) => PluginState {
            map,
            corrupted: false,
        },
        None => PluginState {
            map: serde_json::Map::new(),
            corrupted: true,
        },
    }
}

fn read_state() -> PluginState {
    read_state_in(&data_dir())
}

/// Escritura atómica (AUD-091): temporal + fsync + rename, con backup del
/// estado anterior. Un corte a mitad de escritura ya no deja un
/// `plugins.json` truncado que reactiva todo.
fn write_state_in(
    directory: &Path,
    map: &serde_json::Map<String, Value>,
) -> Result<(), ProjectError> {
    std::fs::create_dir_all(directory).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude crear la carpeta de plugins")
    })?;
    let text = serde_json::to_string_pretty(map).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no pude serializar plugins.json")
    })?;
    let path = directory.join(STATE_FILE);
    if path.is_file() {
        // Backup del estado previo: si el nuevo quedara corrupto, la
        // próxima lectura lo recupera.
        let _ = std::fs::copy(&path, directory.join(STATE_BACKUP));
    }
    let tmp = directory.join(STATE_TMP);
    let write_result = (|| -> Result<(), ProjectError> {
        let mut file = std::fs::File::create(&tmp).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no pude escribir plugins.json")
        })?;
        file.write_all(text.as_bytes()).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no pude escribir plugins.json")
        })?;
        file.sync_all().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no pude escribir plugins.json")
        })?;
        drop(file);
        std::fs::rename(&tmp, &path).map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "no pude escribir plugins.json")
        })
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    write_result
}

fn write_state(map: &serde_json::Map<String, Value>) -> Result<(), ProjectError> {
    write_state_in(&data_dir(), map)
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

fn scan(directory: &Path, official: bool, state: &PluginState) -> Vec<PluginInfo> {
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
            .map
            .get("disabled")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .any(|item| item.as_str() == path.file_name().and_then(|name| name.to_str()))
            })
            .unwrap_or(false);
        // AUD-091: con el estado corrupto no se habilita nada por defecto —
        // el usuario decide plugin por plugin.
        let enabled = !state.corrupted && !disabled;
        match read_manifest(&path) {
            Ok(mut manifest) => {
                manifest.official = official;
                plugins.push(PluginInfo {
                    manifest,
                    enabled,
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

/// Lista los plugins oficiales y de usuario con su estado enabled.
pub fn list_plugins(official_directory: &Path) -> Vec<PluginInfo> {
    let state = read_state();
    let mut plugins = scan(official_directory, true, &state);
    plugins.extend(scan(&data_dir(), false, &state));
    plugins
}

/// Instala copiando la carpeta indicada al directorio de plugins del usuario.
/// La ruta llega por IPC: se valida con la política de lectura de `fs_*`
/// (absoluta, sin credenciales ni secretos de la app) antes de copiar.
pub fn install_plugin(source_raw: &str) -> Result<PluginInfo, ProjectError> {
    let source = crate::application::fs::resolve_user_file_path(source_raw)?;
    let source = source.as_path();
    let source_metadata = std::fs::symlink_metadata(source).map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "plugin folder does not exist")
    })?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "plugin folder must be a real directory, not a link",
        ));
    }
    let manifest = read_manifest(source)
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
    if let Err(error) = copy_dir(source, &target) {
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

pub fn remove_plugin(id: &str) -> Result<(), ProjectError> {
    if !valid_id(id) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "id inválido",
        ));
    }
    let target = data_dir().join(id);
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

pub fn set_plugin_enabled(id: &str, enabled: bool) -> Result<(), ProjectError> {
    if !valid_id(id) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "id inválido",
        ));
    }
    let mut state = read_state().map;
    let mut disabled: Vec<String> = state
        .get("disabled")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    disabled.retain(|item| item.as_str() != id);
    if !enabled {
        disabled.push(id.to_owned());
    }
    state.insert(
        "disabled".to_owned(),
        Value::Array(disabled.into_iter().map(Value::String).collect()),
    );
    write_state(&state)
}

#[cfg(test)]
#[path = "plugins.tests.rs"]
mod tests;
