//! Gestión de la VPN **del sistema** (Windows), no un cliente propio.
//!
//! La app no implementa crypto ni drivers TUN: enumera las conexiones VPN
//! nativas de Windows (`Get-VpnConnection`), muestra su estado y delega
//! conectar/desconectar en `rasdial`, que usa las credenciales ya guardadas
//! en el Administrador de credenciales (la app nunca ve ni pide contraseñas).
//! WireGuard se detecta como instalación aparte: su túnel lo activa el
//! usuario desde la app oficial con sus privilegios.
//!
//! DTOs, el parser JSON y la validación anti-inyección viven en
//! `application::vpn`; acá sólo queda la orquestación de procesos.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::projects::service::{ProjectError, ProjectErrorCode};

// DTOs, LIST_SCRIPT, parser y validación: `application::vpn`.
pub use crate::application::vpn::*;

#[cfg(not(windows))]
fn unsupported() -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        "la gestión de VPN del sistema sólo está implementada en Windows",
    )
}

/// Ejecuta un proceso con timeout y lo mata si no termina. Devuelve
/// (status_ok, stdout+stderr recortado) para que el caller decida el mensaje.
#[cfg(windows)]
fn run_with_timeout(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<(bool, String), ProjectError> {
    use std::os::windows::process::CommandExt;
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .spawn()
        .map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo ejecutar {program}: {error}"),
            )
        })?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut stdout) = child.stdout.take() {
                    use std::io::Read;
                    let _ = stdout.read_to_string(&mut out);
                }
                if let Some(mut stderr) = child.stderr.take() {
                    use std::io::Read;
                    let mut text = String::new();
                    let _ = stderr.read_to_string(&mut text);
                    out.push_str(&text);
                }
                let tail: String = out.trim().chars().rev().take(400).collect::<String>();
                let tail: String = tail.chars().rev().collect();
                return Ok((status.success(), tail));
            }
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ProjectError::message(
                        ProjectErrorCode::ProviderUnavailable,
                        &format!("{program} no respondió en {timeout:?}; se canceló"),
                    ));
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            Err(error) => {
                return Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo esperar {program}: {error}"),
                ));
            }
        }
    }
}

#[cfg(windows)]
fn powershell_json(script: &str) -> Result<String, ProjectError> {
    let (ok, output) = run_with_timeout(
        "powershell",
        &[
            "-NoProfile".to_owned(),
            "-NonInteractive".to_owned(),
            "-Command".to_owned(),
            script.to_owned(),
        ],
        Duration::from_secs(20),
    )?;
    if !ok && output.trim().is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "PowerShell no pudo consultar las conexiones VPN",
        ));
    }
    Ok(output)
}

/// Lista las conexiones VPN configuradas en el usuario actual de Windows.
#[tauri::command]
pub async fn vpn_list() -> Result<Vec<VpnConnection>, ProjectError> {
    #[cfg(windows)]
    {
        // AUD-129 (resto del barrido): PowerShell/rasdial bloquean hasta
        // su timeout; van a spawn_blocking.
        let output = tauri::async_runtime::spawn_blocking(|| powershell_json(LIST_SCRIPT))
            .await
            .map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "la consulta VPN se interrumpió antes de terminar",
                )
            })??;
        // PowerShell puede imprimir warnings antes del JSON: tomamos desde el
        // primer '{' o '['.
        let start = output.find(['{', '[']).unwrap_or(0);
        Ok(parse_vpn_connections(&output[start..]))
    }
    #[cfg(not(windows))]
    {
        Err(unsupported())
    }
}

/// Conecta una conexión VPN del sistema con `rasdial` (credenciales
/// guardadas; nunca se piden ni manejan contraseñas acá).
#[tauri::command]
pub async fn vpn_connect(name: String) -> Result<String, ProjectError> {
    #[cfg(windows)]
    {
        let connections = vpn_list().await?;
        require_known_connection(&connections, name.trim())?;
        let dial_name = name.trim().to_owned();
        let (ok, output) = tauri::async_runtime::spawn_blocking(move || {
            run_with_timeout("rasdial", &[dial_name], Duration::from_secs(90))
        })
        .await
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "la conexión VPN se interrumpió antes de terminar",
            )
        })??;
        if ok {
            Ok(if output.is_empty() {
                "conexión establecida".to_owned()
            } else {
                output
            })
        } else {
            Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                &format!(
                    "rasdial no pudo conectar «{}»: {}",
                    name.trim(),
                    if output.is_empty() {
                        "sin detalle"
                    } else {
                        &output
                    }
                ),
            ))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        Err(unsupported())
    }
}

/// Desconecta una conexión VPN del sistema.
#[tauri::command]
pub async fn vpn_disconnect(name: String) -> Result<String, ProjectError> {
    #[cfg(windows)]
    {
        let connections = vpn_list().await?;
        require_known_connection(&connections, name.trim())?;
        let dial_name = name.trim().to_owned();
        let (ok, output) = tauri::async_runtime::spawn_blocking(move || {
            run_with_timeout(
                "rasdial",
                &[dial_name, "/disconnect".to_owned()],
                Duration::from_secs(30),
            )
        })
        .await
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "la desconexión VPN se interrumpió antes de terminar",
            )
        })??;
        if ok {
            Ok("desconectada".to_owned())
        } else {
            Err(ProjectError::message(
                ProjectErrorCode::ProviderUnavailable,
                &format!(
                    "rasdial no pudo desconectar «{}»: {}",
                    name.trim(),
                    if output.is_empty() {
                        "sin detalle"
                    } else {
                        &output
                    }
                ),
            ))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        Err(unsupported())
    }
}

/// Ruta del ejecutable oficial de WireGuard si está instalado.
fn wireguard_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        paths.push(
            PathBuf::from(program_files)
                .join("WireGuard")
                .join("wireguard.exe"),
        );
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        paths.push(
            PathBuf::from(local)
                .join("Programs")
                .join("WireGuard")
                .join("wireguard.exe"),
        );
    }
    paths
}

/// Detecta la instalación de WireGuard (la app oficial maneja sus túneles).
#[tauri::command]
pub async fn vpn_wireguard() -> Result<WireGuardInfo, ProjectError> {
    #[cfg(windows)]
    {
        for candidate in wireguard_candidates() {
            if candidate.is_file() {
                return Ok(WireGuardInfo {
                    installed: true,
                    path: Some(candidate.to_string_lossy().to_string()),
                });
            }
        }
        Ok(WireGuardInfo {
            installed: false,
            path: None,
        })
    }
    #[cfg(not(windows))]
    {
        Err(unsupported())
    }
}

/// Abre la UI oficial de WireGuard si está instalada. El túnel lo activa el
/// usuario desde ahí (pide elevación propia); la app no la bypasea.
#[tauri::command]
pub async fn vpn_wireguard_open() -> Result<(), ProjectError> {
    #[cfg(windows)]
    {
        let info = vpn_wireguard().await?;
        let Some(path) = info.path else {
            return Err(ProjectError::message(
                ProjectErrorCode::NotFound,
                "WireGuard no está instalado en este equipo",
            ));
        };
        tauri::async_runtime::spawn_blocking(move || {
            Command::new(path).spawn().map(|_| ()).map_err(|error| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo abrir WireGuard: {error}"),
                )
            })
        })
        .await
        .map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::Io,
                "la apertura de WireGuard se interrumpió antes de terminar",
            )
        })?
    }
    #[cfg(not(windows))]
    {
        Err(unsupported())
    }
}
