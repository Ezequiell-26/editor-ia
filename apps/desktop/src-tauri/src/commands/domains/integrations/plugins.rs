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
//!
//! La lógica de manifiesto/estado/instalación vive en `application::plugins`;
//! estos comandos sólo resuelven la carpeta oficial vía AppHandle.

use std::path::PathBuf;

use tauri::State;

use crate::application::plugins::{self, PluginInfo};
use crate::projects::service::ProjectError;
use crate::state::AppState;

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

#[tauri::command]
pub fn list_plugins(app: tauri::AppHandle) -> Result<Vec<PluginInfo>, ProjectError> {
    Ok(plugins::list_plugins(&official_dir(&app)))
}

/// Instala copiando la carpeta indicada al directorio de plugins del usuario.
#[tauri::command]
pub fn install_plugin(
    _state: State<'_, AppState>,
    path: String,
) -> Result<PluginInfo, ProjectError> {
    plugins::install_plugin(&path)
}

#[tauri::command]
pub fn remove_plugin(_state: State<'_, AppState>, id: String) -> Result<(), ProjectError> {
    plugins::remove_plugin(&id)
}

#[tauri::command]
pub fn set_plugin_enabled(
    _state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<(), ProjectError> {
    plugins::set_plugin_enabled(&id, enabled)
}
