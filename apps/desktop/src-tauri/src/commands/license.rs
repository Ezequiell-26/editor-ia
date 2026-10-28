//! Comandos de licencia: estado, activación y desactivación.
//!
//! El archivo que entrega el vendedor está firmado con Ed25519. La copia local
//! se guarda cifrada con AES-256-GCM y una clave derivada de la máquina. Esto
//! no es un sistema DRM: la comprobación fuerte es la firma; el cifrado local
//! evita copiar el estado entre equipos.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::license::{
    check_download, check_render, decrypt_store, encrypt_store, parse_license_file, store_key,
    LicenseError, LicensePayload, LicenseTier,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Clave pública de producción. La privada vive fuera del repositorio y la usa
/// el servidor de licencias de la Fase 4.
const LICENSE_PUBLIC_KEY_B64: &str = "IgitR6AvrdQGzB7OMdscoYXgIQLE0fCO1X+NRdUsmEk=";
/// Secreto de la aplicación para cifrar el estado local. No es una clave
/// criptográfica de confianza: está en el binario y sólo protege el archivo
/// contra copia casual. La firma Ed25519 es la validación real.
const LICENSE_STORE_SECRET: &str =
    "4407185b89686e512d189742a9e6cb982d0f0f03ac08cdaaa71427db39bd3ebd";
const LICENSE_FILE_NAME: &str = "license.bin";
const MAX_LICENSE_BYTES: u64 = 64 * 1024;
const TRIAL_FILE_NAME: &str = "trial.bin";
const TRIAL_DAYS: u64 = 14;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub tier: LicenseTier,
    pub is_pro: bool,
    pub email: Option<String>,
    pub license_id: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at_unix: Option<u64>,
    pub trial_ends_at_unix: Option<u64>,
    pub trial_days_left: Option<u64>,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct LicenseState {
    pub tier: LicenseTier,
    pub payload: Option<LicensePayload>,
    pub trial_ends_at_unix: Option<u64>,
    pub error: Option<String>,
}

impl LicenseState {
    pub fn free(error: Option<String>) -> Self {
        Self {
            tier: LicenseTier::Free,
            payload: None,
            trial_ends_at_unix: None,
            error,
        }
    }

    pub fn status(&self) -> LicenseStatus {
        let payload = self.payload.as_ref();
        LicenseStatus {
            tier: self.tier,
            is_pro: self.tier == LicenseTier::Pro,
            email: payload.map(|value| value.email.clone()),
            license_id: payload.map(|value| value.license_id.clone()),
            issued_at: payload.map(|value| value.issued_at.clone()),
            expires_at_unix: payload.and_then(|value| value.expires_at_unix),
            trial_ends_at_unix: self.trial_ends_at_unix,
            trial_days_left: self.trial_ends_at_unix.and_then(|ends| {
                let now = now_unix();
                (ends > now).then(|| (ends - now + 86_399) / 86_400)
            }),
            source: if payload.is_some() {
                "license-file".to_owned()
            } else if self.tier == LicenseTier::Pro {
                "trial".to_owned()
            } else {
                "none".to_owned()
            },
            error: self.error.clone(),
        }
    }

    pub fn load(config_dir: &Path) -> Self {
        Self::load_with(config_dir, &license_public_key(), &machine_id())
    }

    pub fn load_with(config_dir: &Path, public_key: &[u8], machine: &str) -> Self {
        let path = config_dir.join(LICENSE_FILE_NAME);
        let blob = match std::fs::read(&path) {
            Ok(blob) => blob,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Self::load_trial(config_dir, machine).unwrap_or_else(|| Self::free(None))
            }
            Err(error) => {
                return Self::free(Some(format!(
                    "No se pudo leer la licencia local: {error}"
                )))
            }
        };
        let key = store_key(LICENSE_STORE_SECRET, machine);
        let text = decrypt_store(&key, &blob).and_then(|bytes| {
            String::from_utf8(bytes)
                .map_err(|_| LicenseError::new("la licencia local no contiene texto UTF-8 válido"))
        });
        match text.and_then(|value| parse_license_file(&value, public_key)) {
            Ok(payload) => Self {
                tier: LicenseTier::Pro,
                payload: Some(payload),
                trial_ends_at_unix: None,
                error: None,
            },
            Err(error) => Self::load_trial(config_dir, machine).unwrap_or_else(|| {
                Self::free(Some(error.message))
            }),
        }
    }

    fn load_trial(config_dir: &Path, machine: &str) -> Option<Self> {
        let blob = std::fs::read(config_dir.join(TRIAL_FILE_NAME)).ok()?;
        let key = store_key(LICENSE_STORE_SECRET, machine);
        let bytes = decrypt_store(&key, &blob).ok()?;
        let record: TrialRecord = serde_json::from_slice(&bytes).ok()?;
        let ends = record.started_at_unix.saturating_add(TRIAL_DAYS * 86_400);
        if now_unix() < ends {
            Some(Self {
                tier: LicenseTier::Pro,
                payload: None,
                trial_ends_at_unix: Some(ends),
                error: None,
            })
        } else {
            Some(Self {
                tier: LicenseTier::Free,
                payload: None,
                trial_ends_at_unix: Some(ends),
                error: Some("La prueba de 14 días terminó. Activá Pro para continuar con las funciones avanzadas.".to_owned()),
            })
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrialRecord {
    started_at_unix: u64,
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub fn start_trial_at(
    config_dir: &Path,
    machine: &str,
    now: u64,
) -> Result<LicenseState, LicenseError> {
    let trial_path = config_dir.join(TRIAL_FILE_NAME);
    if trial_path.exists() {
        return Err(LicenseError::new("La prueba de 14 días ya se usó en este equipo."));
    }
    let record = TrialRecord { started_at_unix: now };
    let bytes = serde_json::to_vec(&record)
        .map_err(|_| LicenseError::new("no se pudo serializar la prueba"))?;
    let key = store_key(LICENSE_STORE_SECRET, machine);
    let encrypted = encrypt_store(&key, &bytes)?;
    std::fs::create_dir_all(config_dir)
        .map_err(|_| LicenseError::new("no se pudo preparar la carpeta de licencias"))?;
    std::fs::write(&trial_path, encrypted)
        .map_err(|_| LicenseError::new("no se pudo guardar la prueba local"))?;
    let ends = now.saturating_add(TRIAL_DAYS * 86_400);
    Ok(LicenseState {
        tier: LicenseTier::Pro,
        payload: None,
        trial_ends_at_unix: Some(ends),
        error: None,
    })
}

/// Activa un archivo firmado y deja una copia cifrada en `config_dir`.
pub fn activate_license_text(
    text: &str,
    config_dir: &Path,
    public_key: &[u8],
    machine: &str,
) -> Result<LicenseState, LicenseError> {
    let payload = parse_license_file(text, public_key)?;
    let key = store_key(LICENSE_STORE_SECRET, machine);
    let encrypted = encrypt_store(&key, text.as_bytes())?;
    std::fs::create_dir_all(config_dir)
        .map_err(|_| LicenseError::new("no se pudo preparar la carpeta de licencias"))?;
    let final_path = config_dir.join(LICENSE_FILE_NAME);
    let temp_path = config_dir.join(format!("license-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, &encrypted)
        .map_err(|_| LicenseError::new("no se pudo escribir la licencia local"))?;
    std::fs::rename(&temp_path, &final_path)
        .map_err(|_| LicenseError::new("no se pudo instalar la licencia local"))?;
    Ok(LicenseState {
        tier: LicenseTier::Pro,
        payload: Some(payload),
        trial_ends_at_unix: None,
        error: None,
    })
}

pub fn clear_license_file(config_dir: &Path) -> LicenseState {
    let path = config_dir.join(LICENSE_FILE_NAME);
    if let Err(error) = std::fs::remove_file(&path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return LicenseState::free(Some(format!(
                "No se pudo borrar la licencia local: {error}"
            )));
        }
    }
    LicenseState::free(None)
}

fn license_public_key() -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(LICENSE_PUBLIC_KEY_B64)
        .unwrap_or_default()
}

fn machine_id() -> String {
    let name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown-machine".to_owned());
    let cpu = std::env::var("PROCESSOR_IDENTIFIER").unwrap_or_default();
    format!("{name}|{cpu}")
}

fn license_error(error: LicenseError) -> ProjectError {
    ProjectError::message(ProjectErrorCode::LicenseInvalid, &error.message)
}

#[tauri::command]
pub async fn start_trial(state: State<'_, AppState>) -> Result<LicenseStatus, ProjectError> {
    if state.license_tier() == LicenseTier::Pro {
        return Err(ProjectError::message(
            ProjectErrorCode::LicenseInvalid,
            "Este equipo ya tiene una licencia Pro o una prueba activa.",
        ));
    }
    let next = start_trial_at(&state.config_dir, &machine_id(), now_unix()).map_err(license_error)?;
    let status = next.status();
    if let Ok(mut license) = state.license.lock() {
        *license = next;
    }
    Ok(status)
}

#[tauri::command]
pub fn license_status(state: State<'_, AppState>) -> LicenseStatus {
    match state.license.lock() {
        Ok(license) => license.status(),
        Err(_) => LicenseState::free(Some(
            "el estado de licencia no está disponible".to_owned(),
        ))
        .status(),
    }
}

#[tauri::command]
pub async fn choose_license_file(app: AppHandle) -> Result<Option<String>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Activar Olyvia Pro")
        .add_filter("Licencia de Olyvia", &["json", "olic", "license"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la licencia elegida")
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn activate_license(
    state: State<'_, AppState>,
    path: String,
) -> Result<LicenseStatus, ProjectError> {
    let file = PathBuf::from(path.trim());
    let metadata = std::fs::metadata(&file).map_err(|_| {
        ProjectError::message(ProjectErrorCode::NotFound, "no se encontró el archivo de licencia")
    })?;
    if !metadata.is_file() || metadata.len() > MAX_LICENSE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::LicenseInvalid,
            "el archivo elegido no es una licencia válida",
        ));
    }
    let text = std::fs::read_to_string(&file).map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo leer el archivo de licencia")
    })?;
    let next = activate_license_text(&text, &state.config_dir, &license_public_key(), &machine_id())
        .map_err(license_error)?;
    let status = next.status();
    if let Ok(mut license) = state.license.lock() {
        *license = next;
    }
    Ok(status)
}

#[tauri::command]
pub async fn deactivate_license(state: State<'_, AppState>) -> Result<LicenseStatus, ProjectError> {
    clear_license_file(&state.config_dir);
    let next = LicenseState::load(&state.config_dir);
    let status = next.status();
    if let Ok(mut license) = state.license.lock() {
        *license = next;
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PUBLIC: &str = "j64kkprKyzGztX5Tqje/qPrZ5xyqDL9A8vvJt65VJhQ=";
    const GOOD_LICENSE: &str = r#"{"payload":"eyJ2IjoxLCJwcm9kdWN0Ijoib2x5dmlhIiwidGllciI6InBybyIsImxpY2Vuc2VJZCI6ImxpYy10ZXN0IiwiZW1haWwiOiJ0ZXN0ZXJAZXhhbXBsZS5jb20iLCJpc3N1ZWRBdCI6IjIwMjYtMTAtMjhUMDA6MDA6MDBaIiwiZXhwaXJlc0F0VW5peCI6bnVsbH0=","signature":"Sl64u3L5docrlkp9mAAw8+pxU/f4kzC3DQV5c3WJ7pMRlMmvxNuKGaDQxHAMhWTvizrT/5Hq1jydZDi0F4zTAQ=="}"#;

    fn dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("olyvia-license-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn key() -> Vec<u8> {
        base64::engine::general_purpose::STANDARD
            .decode(TEST_PUBLIC)
            .unwrap()
    }

    #[test]
    fn activa_carga_y_desactiva_una_licencia() {
        let config = dir();
        let state = activate_license_text(GOOD_LICENSE, &config, &key(), "MAQUINA-A").unwrap();
        assert_eq!(state.tier, LicenseTier::Pro);
        assert!(config.join(LICENSE_FILE_NAME).is_file());

        let loaded = LicenseState::load_with(&config, &key(), "MAQUINA-A");
        assert_eq!(loaded.tier, LicenseTier::Pro);
        assert_eq!(loaded.payload.unwrap().email, "tester@example.com");

        let other = LicenseState::load_with(&config, &key(), "MAQUINA-B");
        assert_eq!(other.tier, LicenseTier::Free);
        assert!(other.error.is_some());

        let off = clear_license_file(&config);
        assert_eq!(off.tier, LicenseTier::Free);
        assert!(!config.join(LICENSE_FILE_NAME).exists());
        let _ = std::fs::remove_dir_all(config);
    }

    #[test]
    fn la_prueba_activa_pro_una_sola_vez_y_vencida_vuelve_a_free() {
        let config = dir();
        let start = start_trial_at(&config, "MAQUINA-A", 1_000).unwrap();
        assert_eq!(start.tier, LicenseTier::Pro);
        assert!(start_trial_at(&config, "MAQUINA-A", 2_000).is_err());
        let expired = LicenseState::load_with(&config, &key(), "MAQUINA-A");
        assert_eq!(expired.tier, LicenseTier::Free);
        assert!(expired.error.unwrap().contains("prueba"));
        let _ = std::fs::remove_dir_all(config);
    }

    #[test]
    fn rechaza_un_archivo_manipulado() {
        let config = dir();
        let mut file: serde_json::Value = serde_json::from_str(GOOD_LICENSE).unwrap();
        file["payload"] = serde_json::json!(
            base64::engine::general_purpose::STANDARD.encode(
                br#"{"v":1,"product":"olyvia","tier":"pro","licenseId":"forged","email":"x","issuedAt":"x","expiresAtUnix":null}"#
            )
        );
        assert!(activate_license_text(&file.to_string(), &config, &key(), "MAQUINA-A").is_err());
        assert!(!config.join(LICENSE_FILE_NAME).exists());
        let _ = std::fs::remove_dir_all(config);
    }
}
