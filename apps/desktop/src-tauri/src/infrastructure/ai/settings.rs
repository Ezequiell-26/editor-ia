//! Configuración del proveedor sobre `AppState`.

use crate::ports::ai::{ProviderConfig, ProviderSettingsStore};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

/// Configuración del proveedor sobre `AppState`.
pub struct StateProviderSettings<'a> {
    state: &'a AppState,
}

impl<'a> StateProviderSettings<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl ProviderSettingsStore for StateProviderSettings<'_> {
    fn provider(&self) -> Result<ProviderConfig, ProjectError> {
        let settings = self.state.settings_snapshot()?;
        Ok(ProviderConfig {
            kind: settings.provider.kind,
            base_url: settings.provider.base_url,
            model: settings.provider.model,
        })
    }

    fn save_provider(&self, config: &ProviderConfig) -> Result<(), ProjectError> {
        let mut settings = self.state.settings.lock().map_err(|_| {
            ProjectError::message(ProjectErrorCode::Io, "el estado interno no está disponible")
        })?;
        settings.provider = crate::state::ProviderSettings {
            kind: config.kind.clone(),
            base_url: config.base_url.clone(),
            model: config.model.clone(),
        };
        self.state.save_settings(&settings)
    }
}
