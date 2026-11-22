//! Reglas de dominio de las instancias aisladas de navegador.
//!
//! Validación de entradas IPC (profile_id, URLs http(s), proxy) y el DTO de
//! estado. El spawn del navegador, el registro de instancias y el control CDP
//! son infraestructura/procesos y quedan fuera de esta capa.

use serde::Serialize;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub fn sanitize_profile_id(id: &str) -> Result<String, ProjectError> {
    let id = id.trim();
    if id.is_empty() || id.len() > 64 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "profile_id debe tener entre 1 y 64 caracteres",
        ));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "profile_id solo admite letras, números, '-' y '_'",
        ));
    }
    // Windows compara nombres de carpeta sin distinguir mayúsculas: dos IDs
    // que sólo difieren en capitalización apuntarían al mismo perfil físico.
    Ok(id.to_ascii_lowercase())
}

/// Misma regla que `browser_instance_navigate`: sólo http(s). `file://`
/// expondría archivos locales al contexto de la página y `Runtime.evaluate`
/// podría exfiltrarlos; `javascript:` ejecutaría script arbitrario.
pub fn validate_web_url(url: &str) -> Result<String, ProjectError> {
    let url = url.trim();
    if url.len() > 2_048 || !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la URL debe ser http(s)",
        ));
    }
    Ok(url.to_owned())
}

pub fn validate_proxy(proxy: &str) -> Result<(), ProjectError> {
    // Esquema permitido + autoridad con host y puerto válidos; nada de
    // credenciales en la URL para no filtrar secretos en logs/args visibles.
    let invalid = || {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "proxy_url debe ser http(s):// o socks5://host[:puerto], sin credenciales",
        )
    };
    let scheme_len = if let Some(rest) = proxy.strip_prefix("http://") {
        rest
    } else if let Some(rest) = proxy.strip_prefix("https://") {
        rest
    } else if let Some(rest) = proxy.strip_prefix("socks5://") {
        rest
    } else {
        return Err(invalid());
    };
    if proxy.contains('@') || proxy.len() > 300 {
        return Err(invalid());
    }
    // Autoridad = hasta el primer '/', '?', '#' o fin.
    let authority = scheme_len.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Err(invalid());
    }
    // Puerto opcional tras el último ':' (IPv6 literal entre corchetes).
    let (host, port) = if let Some(rest) = authority.strip_prefix('[') {
        // [::1]:8080 o [::1]
        let close = rest.find(']').ok_or_else(invalid)?;
        let host = &rest[..close];
        let after = &rest[close + 1..];
        if !after.is_empty() && !after.starts_with(':') {
            return Err(invalid());
        }
        let port = after
            .strip_prefix(':')
            .map(str::parse::<u16>)
            .transpose()
            .map_err(|_| invalid())?;
        if port == Some(0) {
            return Err(invalid());
        }
        (format!("[{host}]"), port)
    } else {
        match authority.rsplit_once(':') {
            Some((h, p)) => {
                if h.is_empty() || !p.chars().all(|c| c.is_ascii_digit()) {
                    return Err(invalid());
                }
                let port: u16 = p.parse().map_err(|_| invalid())?;
                if port == 0 {
                    return Err(invalid());
                }
                (h.to_owned(), Some(port))
            }
            None => (authority.to_owned(), None),
        }
    };
    let _ = port;
    // Host no vacío y sin espacios/caracteres de control.
    if host.is_empty()
        || host
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '@')
    {
        return Err(invalid());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInstanceInfo {
    pub id: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub cdp_url: String,
    pub profile_dir: String,
    pub proxy: Option<String>,
    pub browser: String,
}

#[cfg(test)]
#[path = "browser_instances.tests.rs"]
mod tests;
