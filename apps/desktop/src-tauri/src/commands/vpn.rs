//! Gestión de la VPN **del sistema** (Windows), no un cliente propio.
//!
//! La app no implementa crypto ni drivers TUN: enumera las conexiones VPN
//! nativas de Windows (`Get-VpnConnection`), muestra su estado y delega
//! conectar/desconectar en `rasdial`, que usa las credenciales ya guardadas
//! en el Administrador de credenciales (la app nunca ve ni pide contraseñas).
//! WireGuard se detecta como instalación aparte: su túnel lo activa el
//! usuario desde la app oficial con sus privilegios.
//!
//! Todo el parsing vive en funciones puras testeables; los comandos sólo
//! orquestan procesos.

use serde::Serialize;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Una conexión VPN configurada en Windows.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VpnConnection {
    pub name: String,
    pub server_address: String,
    pub tunnel_type: String,
    /// `Connected` / `Disconnected` / `Connecting` (texto de Windows).
    pub status: String,
}

/// Dónde quedó instalada la app oficial de WireGuard, si existe.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireGuardInfo {
    pub installed: bool,
    pub path: Option<String>,
}

#[cfg(not(windows))]
fn unsupported() -> ProjectError {
    ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        "la gestión de VPN del sistema sólo está implementada en Windows",
    )
}

/// Parsea la salida JSON de `Get-VpnConnection | ConvertTo-Json`.
/// Tolera objeto único (PowerShell no envuelve en array con 1 resultado),
/// array vacío y campos ausentes.
fn parse_vpn_connections(json: &str) -> Vec<VpnConnection> {
    let trimmed = json.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Vec::new();
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let items: Vec<&serde_json::Value> = match &value {
        serde_json::Value::Array(list) => list.iter().collect(),
        serde_json::Value::Object(_) => vec![&value],
        _ => Vec::new(),
    };
    items
        .into_iter()
        .filter_map(|item| {
            let name = item["name"].as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(VpnConnection {
                name,
                server_address: item["server"].as_str().unwrap_or("").to_string(),
                tunnel_type: item["tunnel"].as_str().unwrap_or("").to_string(),
                status: item["status"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect()
}

/// El nombre debe ser exactamente una conexión listada: evita inyección en
/// `rasdial` y que la app marque conexiones arbitrarias del sistema.
fn require_known_connection<'a>(
    connections: &'a [VpnConnection],
    name: &str,
) -> Result<&'a VpnConnection, ProjectError> {
    connections
        .iter()
        .find(|connection| connection.name == name)
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::NotFound,
                "la conexión VPN no existe en el sistema o no se pudo listar",
            )
        })
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

/// Script único: una fila JSON por conexión. `.ToString()` en los enums para
/// que `TunnelType`/`ConnectionStatus` lleguen como texto, no como número.
#[cfg(windows)]
const LIST_SCRIPT: &str = "Get-VpnConnection | ForEach-Object { [pscustomobject]@{ name=$_.Name; server=$_.ServerAddress; tunnel=$_.TunnelType.ToString(); status=$_.ConnectionStatus.ToString() } } | ConvertTo-Json -Compress";

/// Lista las conexiones VPN configuradas en el usuario actual de Windows.
#[tauri::command]
pub async fn vpn_list() -> Result<Vec<VpnConnection>, ProjectError> {
    #[cfg(windows)]
    {
        let output = powershell_json(LIST_SCRIPT)?;
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
        let (ok, output) = run_with_timeout(
            "rasdial",
            &[name.trim().to_owned()],
            Duration::from_secs(90),
        )?;
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
        let (ok, output) = run_with_timeout(
            "rasdial",
            &[name.trim().to_owned(), "/disconnect".to_owned()],
            Duration::from_secs(30),
        )?;
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
        Command::new(path).spawn().map(|_| ()).map_err(|error| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo abrir WireGuard: {error}"),
            )
        })
    }
    #[cfg(not(windows))]
    {
        Err(unsupported())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parsea_array_y_objeto_unico() {
        let array = r#"[{"name":"Casa","server":"vpn.ejemplo.com","tunnel":"IKEv2","status":"Disconnected"}]"#;
        let list = parse_vpn_connections(array);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Casa");
        assert_eq!(list[0].server_address, "vpn.ejemplo.com");
        assert_eq!(list[0].tunnel_type, "IKEv2");
        assert_eq!(list[0].status, "Disconnected");

        let single =
            r#"{"name":"Oficina","server":"10.0.0.1","tunnel":"L2tp","status":"Connected"}"#;
        let list = parse_vpn_connections(single);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].status, "Connected");
    }

    #[test]
    fn tolera_vacio_null_y_basura() {
        assert!(parse_vpn_connections("").is_empty());
        assert!(parse_vpn_connections("null").is_empty());
        assert!(parse_vpn_connections("esto no es json").is_empty());
        assert!(parse_vpn_connections("[]").is_empty());
    }

    #[test]
    fn descarta_entradas_sin_nombre() {
        let json =
            r#"[{"name":"","server":"x"},{"server":"y"},{"name":"Ok","status":"Disconnected"}]"#;
        let list = parse_vpn_connections(json);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Ok");
    }

    #[test]
    fn require_known_connection_rechaza_desconocidas() {
        let connections = vec![VpnConnection {
            name: "Casa".to_owned(),
            server_address: String::new(),
            tunnel_type: String::new(),
            status: "Disconnected".to_owned(),
        }];
        assert!(require_known_connection(&connections, "Casa").is_ok());
        assert!(require_known_connection(&connections, "Otra").is_err());
        // Inyección tipo "Casa; rm -rf" no matchea nada.
        assert!(require_known_connection(&connections, "Casa\" /disconnect").is_err());
    }
}
