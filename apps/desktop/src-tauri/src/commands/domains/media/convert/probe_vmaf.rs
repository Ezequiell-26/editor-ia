//! Inspección de archivos y medición VMAF — adaptador IPC.
//!
//! La orquestación vive en `application::media` (`probe_any_file`,
//! `probe_file_json`, `measure_vmaf`, `vmaf_available`) sobre los puertos
//! `MediaTools`/`MediaRunner`. Aquí quedan el comando IPC y las utilidades
//! públicas que otros módulos de comandos reutilizan.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tauri::State;

use crate::application::media as use_cases;
use crate::commands::hide_console;
use crate::ports::media::MediaProbe;
use crate::projects::service::ProjectError;
use crate::state::AppState;

/// Inspección completa de cualquier archivo que FFmpeg entienda.
///
/// Es el "inspector de medios" y también la puerta de entrada del convertidor
/// universal: se acepta por contenido, no por extensión.
#[tauri::command]
pub async fn probe_any_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<MediaProbe, ProjectError> {
    let tools = state.media_tools();
    let runner = state.media_runner();
    use_cases::probe_any_file(&tools, &runner, &path)
}

/// Resuelve las herramientas externas para otros módulos (capacidades).
pub fn resolve_tools_public(
    settings: &crate::state::Settings,
) -> (Option<PathBuf>, Option<PathBuf>, Option<PathBuf>) {
    crate::commands::system::resolve_tools(settings)
}

/// ¿Este build de FFmpeg trae el filtro libvmaf? Medido, no asumido.
pub fn vmaf_filter_available(ffmpeg: &Path) -> bool {
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-filters"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    hide_console(&mut command);
    command
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(" libvmaf "))
        .unwrap_or(false)
}

/// Mide la calidad objetiva (VMAF) entre el original y el comprimido.
///
/// Devuelve `None` si el build de FFmpeg no trae libvmaf: la UI lo muestra como
/// "no disponible" en lugar de fingir un número. El compressed se re-escala al
/// tamaño del original, porque libvmaf exige la misma geometría.
#[tauri::command]
pub async fn measure_vmaf(
    state: State<'_, AppState>,
    original: String,
    compressed: String,
) -> Result<Option<f64>, ProjectError> {
    let tools = state.media_tools();
    let runner = state.media_runner();
    use_cases::measure_vmaf(&tools, &runner, &original, &compressed)
}
