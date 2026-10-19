//! External tool discovery and app-level system information.
//!
//! A missing binary is reported as unavailable with its measured search result;
//! nothing is assumed to be installed because a feature would like it to be.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutableInfo {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub hint: Option<String>,
}

fn path_directories() -> Vec<PathBuf> {
    let Some(raw) = std::env::var_os("PATH") else {
        return Vec::new();
    };
    std::env::split_paths(&raw)
        .filter(|path| !path.as_os_str().is_empty())
        .collect()
}

fn common_candidates(name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(program_data) = std::env::var_os("ProgramData") {
        let base = PathBuf::from(program_data);
        candidates.push(
            base.join("chocolatey")
                .join("bin")
                .join(format!("{name}.exe")),
        );
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let base = PathBuf::from(local_app_data);
        candidates.push(
            base.join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join(format!("{name}.exe")),
        );
    }
    if let Some(system_root) = std::env::var_os("SystemRoot") {
        let base = PathBuf::from(system_root);
        if name == "powershell" {
            candidates.push(
                base.join("System32")
                    .join("WindowsPowerShell")
                    .join("v1.0")
                    .join("powershell.exe"),
            );
        }
    }
    candidates
}

pub fn find_executable(name: &str, override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(candidate) = override_path {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    let suffixes: &[&str] = if cfg!(windows) {
        &["", ".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    for directory in path_directories() {
        for suffix in suffixes {
            let candidate = directory.join(format!("{name}{suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    common_candidates(name)
        .into_iter()
        .find(|path| path.is_file())
}

fn run_version(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    if line.is_empty() {
        None
    } else {
        Some(line.chars().take(160).collect())
    }
}

pub fn describe_ffmpeg(path: Option<PathBuf>) -> ExecutableInfo {
    match path {
        Some(path) => {
            let version = run_version(&path, &["-version"]);
            let available = version.is_some();
            ExecutableInfo {
                available,
                path: Some(path.to_string_lossy().into_owned()),
                version,
                hint: if available {
                    None
                } else {
                    Some("el archivo existe pero no respondió a -version".to_owned())
                },
            }
        }
        None => ExecutableInfo {
            available: false,
            path: None,
            version: None,
            hint: Some(
                "Instalá FFmpeg y reiniciá la app, o elegí ffmpeg.exe en Ajustes → Herramientas."
                    .to_owned(),
            ),
        },
    }
}

pub fn describe_ffprobe(path: Option<PathBuf>) -> ExecutableInfo {
    match path {
        Some(path) => {
            let version = run_version(&path, &["-version"]);
            let available = version.is_some();
            ExecutableInfo {
                available,
                path: Some(path.to_string_lossy().into_owned()),
                version,
                hint: if available {
                    None
                } else {
                    Some("el archivo existe pero no respondió a -version".to_owned())
                },
            }
        }
        None => ExecutableInfo {
            available: false,
            path: None,
            version: None,
            hint: Some(
                "FFprobe se instala junto con FFmpeg; elegí ffprobe.exe en Ajustes → Herramientas."
                    .to_owned(),
            ),
        },
    }
}

pub fn describe_powershell(path: Option<PathBuf>) -> ExecutableInfo {
    match path {
        Some(path) => {
            let version = run_version(
                &path,
                &[
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$PSVersionTable.PSVersion.ToString()",
                ],
            );
            ExecutableInfo {
                available: version.is_some(),
                path: Some(path.to_string_lossy().into_owned()),
                version,
                hint: None,
            }
        }
        None => ExecutableInfo {
            available: false,
            path: None,
            version: None,
            hint: Some("Windows PowerShell no está disponible para la narración local.".to_owned()),
        },
    }
}

pub fn resolve_tools(
    settings: &crate::state::Settings,
) -> (Option<PathBuf>, Option<PathBuf>, Option<PathBuf>) {
    let ffmpeg = find_executable("ffmpeg", settings.ffmpeg_path.as_deref());
    let ffprobe = find_executable("ffprobe", settings.ffprobe_path.as_deref());
    let powershell = find_executable("powershell", None);
    (ffmpeg, ffprobe, powershell)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub ffmpeg: ExecutableInfo,
    pub ffprobe: ExecutableInfo,
    pub powershell: ExecutableInfo,
    pub config_dir: String,
    pub cache_dir: String,
}

#[tauri::command]
pub async fn system_info(state: State<'_, AppState>) -> Result<SystemInfo, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, ffprobe, powershell) = resolve_tools(&settings);
    Ok(SystemInfo {
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        os: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        arch: std::env::consts::ARCH.to_owned(),
        ffmpeg: describe_ffmpeg(ffmpeg),
        ffprobe: describe_ffprobe(ffprobe),
        powershell: describe_powershell(powershell),
        config_dir: state.config_dir.to_string_lossy().into_owned(),
        cache_dir: state.cache_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn choose_tool(
    app: AppHandle,
    state: State<'_, AppState>,
    tool: String,
) -> Result<Option<SystemInfo>, ProjectError> {
    let filter = if tool == "ffprobe" {
        "ffprobe.exe"
    } else {
        "ffmpeg.exe"
    };
    let Some(picked) = app
        .dialog()
        .file()
        .set_title(format!("Elegir {}", filter))
        .add_filter("Ejecutable", &["exe"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo usar el ejecutable elegido",
        )
    })?;
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el ejecutable elegido no existe",
        ));
    }
    {
        let mut settings = state.settings.lock().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
        })?;
        if tool == "ffprobe" {
            settings.ffprobe_path = Some(path.to_string_lossy().into_owned());
        } else {
            settings.ffmpeg_path = Some(path.to_string_lossy().into_owned());
        }
        state.save_settings(&settings)?;
    }
    system_info(state).await.map(Some)
}

#[tauri::command]
pub async fn reveal_output(app: AppHandle, path: String) -> Result<(), ProjectError> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo exportado ya no está en esa ruta",
        ));
    }
    let directory = path.parent().unwrap_or_else(|| Path::new("."));
    app.opener()
        .open_path(directory.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo abrir la carpeta de exportación",
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_ffmpeg_is_reported_with_actionable_hint() {
        let info = describe_ffmpeg(None);
        assert!(!info.available);
        assert!(info.hint.unwrap_or_default().contains("FFmpeg"));
    }

    #[test]
    fn an_override_that_does_not_exist_falls_back_to_path_search() {
        let found = find_executable(
            "definitely-not-a-real-binary-editoria",
            Some("C:/no/existe.exe"),
        );
        assert!(found.is_none());
    }
}
