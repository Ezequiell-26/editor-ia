//! VPN del sistema (Windows) — DTOs IPC y parsing puro de la salida de
//! PowerShell. Los procesos (`powershell`, `rasdial`) y la detección de
//! WireGuard quedan en `commands::vpn`.

use serde::Serialize;

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

/// Script único: una fila JSON por conexión. `.ToString()` en los enums para
/// que `TunnelType`/`ConnectionStatus` lleguen como texto, no como número.
pub const LIST_SCRIPT: &str = "Get-VpnConnection | ForEach-Object { [pscustomobject]@{ name=$_.Name; server=$_.ServerAddress; tunnel=$_.TunnelType.ToString(); status=$_.ConnectionStatus.ToString() } } | ConvertTo-Json -Compress";

/// Parsea la salida JSON de `Get-VpnConnection | ConvertTo-Json`.
/// Tolera objeto único (PowerShell no envuelve en array con 1 resultado),
/// array vacío y campos ausentes.
pub fn parse_vpn_connections(json: &str) -> Vec<VpnConnection> {
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
pub fn require_known_connection<'a>(
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

#[cfg(test)]
#[path = "vpn.tests.rs"]
mod tests;
