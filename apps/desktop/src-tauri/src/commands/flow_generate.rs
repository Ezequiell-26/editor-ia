//! Generación de imágenes en Google Flow desde el navegador embebido.
//!
//! Ejecuta `scripts/flow-generate.mjs` —un driver CDP sin dependencias
//! (WebSocket + fetch nativos de Node >= 22)— contra la sesión web "flow"
//! (o el slot indicado). El script se embebe en el binario con `include_str!`
//! y se materializa en %TEMP% en cada llamada, así la app instalada no
//! depende del repo en disco.
//!
//! Flujo: abre/reutiliza la sesión web → espera el endpoint CDP → corre el
//! script → devuelve las rutas de las imágenes descargadas. La importación
//! al proyecto la hace el frontend con `importMediaPaths`.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::projects::service::{ProjectError, ProjectErrorCode};

use super::flow_embed;

const SCRIPT: &str = include_str!("../../../scripts/flow-generate.mjs");
const SCRIPT_NAME: &str = "editoria-flow-generate.mjs";
const CDP_READY_TIMEOUT: Duration = Duration::from_secs(20);
/// Margen extra sobre el timeout del script para el proceso Node.
const HARD_TIMEOUT_MARGIN: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowGenerateFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowGenerateResult {
    pub ok: bool,
    #[serde(default)]
    pub files: Vec<FlowGenerateFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timed_out: Option<bool>,
}

fn validate_prompt(prompt: &str) -> Result<String, ProjectError> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() || trimmed.len() > 4000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el prompt debe tener entre 1 y 4000 caracteres",
        ));
    }
    Ok(trimmed.to_owned())
}

fn node_command() -> Result<std::process::Command, ProjectError> {
    if let Some(custom) = std::env::var_os("EDITORIA_NODE") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(std::process::Command::new(path));
        }
    }
    let mut probe = std::process::Command::new("node");
    probe.arg("--version");
    match probe.output() {
        Ok(output) if output.status.success() => Ok(std::process::Command::new("node")),
        _ => Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "no se encontró Node.js (>= 22) en el PATH; instalalo o definí EDITORIA_NODE",
        )),
    }
}

/// Puerto CDP de una sesión: lo deriva del registro de slots de flow_embed.
fn session_cdp_port(app: &AppHandle, slot: &str) -> Option<u16> {
    let info = flow_embed::web_sessions_status(app.clone());
    info.sessions
        .iter()
        .find(|s| s.name == slot)
        .and_then(|s| {
            s.cdp_url
                .as_deref()
                .and_then(|u| u.rsplit(':').next())
                .and_then(|p| p.parse::<u16>().ok())
        })
        .or_else(|| Some(flow_embed::slot_port_for(slot)))
}

fn cdp_alive(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/json/version");
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
        .and_then(|client| client.get(&url).send().ok())
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

fn wait_cdp(port: u16) -> bool {
    let deadline = Instant::now() + CDP_READY_TIMEOUT;
    while Instant::now() < deadline {
        if cdp_alive(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    false
}

fn materialize_script() -> Result<PathBuf, ProjectError> {
    // Nombre único por proceso: evita que otro proceso del mismo usuario
    // precree/sustituya el script en %TEMP% entre escritura y ejecución.
    let path = std::env::temp_dir().join(format!("{SCRIPT_NAME}.{}", std::process::id()));
    std::fs::write(&path, SCRIPT).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo escribir el script de Flow: {error}").as_str(),
        )
    })?;
    Ok(path)
}

/// Genera imágenes en Google Flow usando la sesión web embebida.
///
/// Abre/reutiliza la sesión `slot` (por defecto "flow") en `url`, corre el
/// driver CDP y devuelve las imágenes descargadas en `output_dir`.
#[tauri::command]
pub async fn flow_generate_image(
    app: AppHandle,
    prompt: String,
    output_dir: String,
    slot: Option<String>,
    url: Option<String>,
    timeout_secs: Option<u64>,
    reuse_project: Option<bool>,
) -> Result<FlowGenerateResult, ProjectError> {
    let prompt = validate_prompt(&prompt)?;
    let output_dir = {
        let trimmed = output_dir.trim();
        if trimmed.is_empty() || trimmed.len() > 32_768 {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "output_dir debe ser una ruta absoluta válida",
            ));
        }
        PathBuf::from(trimmed)
    };
    let name = flow_embed::sanitize_slot_pub(slot.as_deref().unwrap_or("flow"))?;
    let target_url = if name == "flow" {
        url.as_deref().unwrap_or("").trim().to_owned()
    } else {
        let trimmed = url.as_deref().unwrap_or("").trim().to_owned();
        if trimmed.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "las sesiones que no son flow requieren una URL http(s)",
            ));
        }
        trimmed
    };
    let timeout_secs = timeout_secs.unwrap_or(600).clamp(60, 3600);

    // 1) Sesión web abierta y CDP vivo.
    let app_for_open = app.clone();
    let open_url = if target_url.is_empty() {
        None
    } else {
        Some(target_url)
    };
    let open_slot = Some(name.clone());
    tauri::async_runtime::spawn_blocking(move || {
        flow_embed::web_session_open(app_for_open, open_url, open_slot)
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo abrir la sesión web: {error}").as_str(),
        )
    })??;

    let port = session_cdp_port(&app, &name).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la sesión web no expone endpoint CDP",
        )
    })?;
    let alive = tauri::async_runtime::spawn_blocking(move || wait_cdp(port))
        .await
        .unwrap_or(false);
    if !alive {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "el navegador embebido no respondió en su endpoint CDP; reintentá en unos segundos",
        ));
    }

    // 2) Script + directorio de salida + Node.
    let script_path = materialize_script()?;
    std::fs::create_dir_all(&output_dir).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo crear la carpeta de salida: {error}").as_str(),
        )
    })?;
    let mut command = node_command()?;
    command
        .arg(&script_path)
        .arg("--cdp")
        .arg(format!("http://127.0.0.1:{port}"))
        .arg("--prompt")
        .arg(&prompt)
        .arg("--out")
        .arg(&output_dir)
        .arg("--timeout")
        .arg(timeout_secs.to_string());
    if reuse_project.unwrap_or(false) {
        command.arg("--reuse-project");
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // 3) Ejecutar con timeout duro (el script ya tiene el suyo; esto cubre
    //    cuelgues de Node/WebSocket).
    let hard_timeout = Duration::from_secs(timeout_secs) + HARD_TIMEOUT_MARGIN;
    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut child = command.spawn()?;
        let deadline = Instant::now() + hard_timeout;
        loop {
            match child.try_wait()? {
                Some(_) => {
                    return child.wait_with_output().map_err(|e| {
                        std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
                    });
                }
                None if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "flow-generate excedió el tiempo máximo",
                    ));
                }
                None => std::thread::sleep(Duration::from_millis(300)),
            }
        }
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo ejecutar el generador de Flow: {error}").as_str(),
        )
    })?;

    let output = output.map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("falló la ejecución del generador de Flow: {error}").as_str(),
        )
    })?;

    // 4) El script imprime UN JSON en la última línea de stdout.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .unwrap_or("");
    if json_line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            format!(
                "el generador de Flow no devolvió resultado{}",
                if stderr.trim().is_empty() {
                    String::new()
                } else {
                    format!(": {}", stderr.trim().chars().take(300).collect::<String>())
                }
            )
            .as_str(),
        ));
    }
    let mut result: FlowGenerateResult = serde_json::from_str(json_line).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            format!("respuesta inválida del generador de Flow: {error}").as_str(),
        )
    })?;
    if !result.ok && result.error.is_none() {
        result.error = Some("Flow no pudo generar la imagen".to_owned());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_validacion_basica() {
        assert!(validate_prompt("").is_err());
        assert!(validate_prompt("   ").is_err());
        assert!(validate_prompt(&"x".repeat(4001)).is_err());
        assert_eq!(validate_prompt("  gato  ").unwrap(), "gato");
    }

    #[test]
    fn script_embebido_es_valido() {
        assert!(SCRIPT.contains("flow.google.com"));
        assert!(SCRIPT.contains("Runtime.evaluate"));
    }
}
