//! Delivery package: a user-saved `.zip` with the portable project, subtitles,
//! rights table and manifest. The archive is built by the interface, but the
//! bytes cross the boundary only through this command: it validates the
//! base64 payload, the ZIP signature, the suggested file name and the output
//! path before writing atomically.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::commands::publish::ensure_path_is_safe;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// A package carries JSON, CSV, SRT and a readme, never media. 64 MB leaves
/// room for a project with thousands of clips without allowing a runaway IPC.
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
/// Largo máximo del base64 que puede decodificar a <= MAX_PACKAGE_BYTES
/// (mismo patrón que `decode_import_bytes`, AUD-142): un payload IPC
/// sobredimensionado se rechaza por longitud antes de reservar el Vec.
const MAX_PACKAGE_BASE64_CHARS: usize = MAX_PACKAGE_BYTES.div_ceil(3) * 4 + 8;
const ZIP_MAGIC: [u8; 4] = [0x50, 0x4b, 0x03, 0x04];

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn sanitize_file_name(value: &str) -> Result<String, ProjectError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(invalid("el paquete necesita un nombre de archivo"));
    }
    if trimmed.len() > 120 {
        return Err(invalid("el nombre del paquete es demasiado largo"));
    }
    if trimmed.starts_with('.') {
        return Err(invalid("el nombre del paquete no puede empezar con punto"));
    }
    for character in trimmed.chars() {
        let allowed =
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ' ' | '.');
        if !allowed {
            return Err(invalid(
                "el nombre del paquete sólo admite letras, números, guiones, guiones bajos, espacios y puntos",
            ));
        }
    }
    if !trimmed.to_ascii_lowercase().ends_with(".zip") {
        return Err(invalid("el paquete debe terminar en .zip"));
    }
    if trimmed.len() == 4 {
        return Err(invalid("el paquete necesita un nombre antes de .zip"));
    }
    Ok(trimmed.to_string())
}

fn decode_package(encoded: &str) -> Result<Vec<u8>, ProjectError> {
    if encoded.trim().is_empty() {
        return Err(invalid("el paquete llegó vacío"));
    }
    // AUD-071: rechazar por largo codificado antes de decodificar — el
    // STANDARD.decode reservaba el buffer completo antes del chequeo de
    // MAX_PACKAGE_BYTES.
    if encoded.len() > MAX_PACKAGE_BASE64_CHARS {
        return Err(invalid("el paquete supera 64 MB"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| invalid("el paquete no es base64 válido"))?;
    if bytes.is_empty() {
        return Err(invalid("el paquete llegó vacío"));
    }
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(invalid("el paquete supera 64 MB"));
    }
    if bytes.len() < ZIP_MAGIC.len() || bytes[..ZIP_MAGIC.len()] != ZIP_MAGIC {
        return Err(invalid("el paquete no es un archivo ZIP"));
    }
    Ok(bytes)
}

fn ensure_zip_extension(mut path: PathBuf) -> PathBuf {
    if !path
        .extension()
        .map(|value| value.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
    {
        path.set_extension("zip");
    }
    path
}

fn write_atomic(output: &Path, bytes: &[u8]) -> Result<(), ProjectError> {
    let parent = output.parent().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "la ruta elegida no tiene carpeta")
    })?;
    let temp = parent.join(format!(".paquete-{}.tmp", Uuid::new_v4()));
    std::fs::write(&temp, bytes).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo escribir el paquete temporal",
        )
    })?;
    // AUD-016: el destino existente se aparta como backup en vez de borrarse;
    // si el rename final falla se restaura, así un error nunca deja al
    // usuario sin el paquete anterior.
    let had_existing = output.exists();
    let backup = parent.join(format!(
        ".{}.bak-{}",
        output
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "paquete".to_owned()),
        Uuid::new_v4()
    ));
    if had_existing && std::fs::rename(output, &backup).is_err() {
        let _ = std::fs::remove_file(&temp);
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo apartar el paquete existente para reemplazarlo",
        ));
    }
    match std::fs::rename(&temp, output) {
        Ok(()) => {
            if had_existing {
                let _ = std::fs::remove_file(&backup);
            }
            Ok(())
        }
        Err(_) => {
            if had_existing {
                let _ = std::fs::rename(&backup, output);
            }
            let _ = std::fs::remove_file(&temp);
            Err(ProjectError::message(
                ProjectErrorCode::Io,
                "no se pudo publicar el paquete",
            ))
        }
    }
}

#[tauri::command]
pub async fn save_delivery_package(
    app: AppHandle,
    state: State<'_, AppState>,
    bytes_base64: String,
    file_name: String,
    output_path: Option<String>,
) -> Result<Option<String>, ProjectError> {
    let session = state.require_session()?;
    let bytes = decode_package(&bytes_base64)?;
    let suggested = sanitize_file_name(&file_name)?;
    // Con ruta explícita (MCP/automatización) no hay diálogo que contestar:
    // se escribe directo dentro del root del proyecto.
    let picked = match output_path {
        // Ruta explícita por IPC (MCP/automatización): política de escritura.
        Some(raw) => crate::application::fs::validate_user_write_path(&raw)?,
        None => {
            let Some(picked) = app
                .dialog()
                .file()
                .set_title("Guardar paquete de entrega")
                .set_directory(&session.root)
                .add_filter("Paquete Editor IA", &["zip"])
                .set_file_name(&suggested)
                .blocking_save_file()
            else {
                return Ok(None);
            };
            picked.into_path().map_err(|_| {
                ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
            })?
        }
    };
    let output = ensure_zip_extension(picked);
    ensure_path_is_safe(&session.path, &session.root, &output)?;
    write_atomic(&output, &bytes)?;
    Ok(Some(output.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(bytes: &[u8]) -> String {
        STANDARD.encode(bytes)
    }

    #[test]
    fn accepts_a_plain_zip_name() {
        assert_eq!(
            sanitize_file_name("obra-nandu-1-paquete.zip").unwrap(),
            "obra-nandu-1-paquete.zip"
        );
        assert_eq!(
            sanitize_file_name("  mi proyecto.ZIP  ").unwrap(),
            "mi proyecto.ZIP"
        );
    }

    #[test]
    fn rejects_paths_traversal_and_other_extensions() {
        let long_name = "a".repeat(121);
        for name in [
            "",
            "   ",
            ".zip",
            ".oculto.zip",
            "../fuera.zip",
            "carpeta/paquete.zip",
            "carpeta\\paquete.zip",
            "C:paquete.zip",
            "paquete.tar",
            "paquete.zip.exe",
            long_name.as_str(),
        ] {
            assert!(sanitize_file_name(name).is_err(), "debió rechazar {name:?}");
        }
    }

    #[test]
    fn decodes_only_real_zip_bytes() {
        let zip = [0x50, 0x4b, 0x03, 0x04, 0x00];
        assert_eq!(decode_package(&encoded(&zip)).unwrap(), zip);
        assert!(decode_package("").is_err());
        assert!(decode_package("no-es-base64!!").is_err());
        assert!(decode_package(&encoded(b"PK")).is_err());
        assert!(decode_package(&encoded(b"not a zip at all")).is_err());
    }

    #[test]
    fn rejects_oversized_base64_before_decoding() {
        // AUD-071: el rechazo por largo codificado ocurre antes de
        // STANDARD.decode — 'A' repetido es base64 válido, así que sólo
        // el tope de tamaño puede rechazarlo.
        let oversized = "A".repeat(MAX_PACKAGE_BASE64_CHARS + 1);
        assert!(decode_package(&oversized).is_err());
    }

    #[test]
    fn appends_the_zip_extension_without_touching_the_stem() {
        assert_eq!(
            ensure_zip_extension(PathBuf::from("C:\\salida\\paquete")),
            PathBuf::from("C:\\salida\\paquete.zip")
        );
        assert_eq!(
            ensure_zip_extension(PathBuf::from("C:\\salida\\paquete.ZIP")),
            PathBuf::from("C:\\salida\\paquete.ZIP")
        );
    }
}
