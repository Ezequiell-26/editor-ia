//! Secretos del proveedor sobre el Credential Manager de Windows.

use crate::ports::ai::ProviderSecrets;
use crate::projects::service::{ProjectError, ProjectErrorCode};

const KEYRING_SERVICE: &str = "editor-ia.provider";
const KEYRING_USER: &str = "openai-compatible";

fn keyring_entry() -> Result<keyring::Entry, ProjectError> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de credenciales de Windows no está disponible",
        )
    })
}

/// Secretos del proveedor sobre el Credential Manager de Windows.
pub struct KeyringProviderSecrets;

impl ProviderSecrets for KeyringProviderSecrets {
    fn read_key(&self) -> Option<String> {
        keyring_entry()
            .ok()
            .and_then(|entry| entry.get_password().ok())
            .filter(|secret| !secret.trim().is_empty())
    }

    fn set_key(&self, secret: &str) -> Result<(), ProjectError> {
        keyring_entry()?.set_password(secret).map_err(|_| {
            ProjectError::message(
                ProjectErrorCode::KeyringUnavailable,
                "no se pudo guardar la clave en el almacén de Windows",
            )
        })
    }

    fn clear_key(&self) {
        if let Ok(entry) = keyring_entry() {
            let _ = entry.delete_credential();
        }
    }

    fn available(&self) -> bool {
        keyring_entry().is_ok()
    }
}
