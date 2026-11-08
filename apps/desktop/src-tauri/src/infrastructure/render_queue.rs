//! Cola de render persistida en `%LOCALAPPDATA%\com.editoria.desktop\render-queue.json`.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use crate::ports::render::RenderQueueStore;
use crate::render::queue::{persisted_slice, QueueEntry};

const STATE_FILE: &str = "render-queue.json";

pub struct LocalRenderQueueStore {
    path: PathBuf,
}

impl LocalRenderQueueStore {
    /// Ruta por defecto del estado de la app (LOCALAPPDATA o cwd).
    pub fn local() -> Self {
        let path = std::env::var("LOCALAPPDATA")
            .map(|base| {
                PathBuf::from(base)
                    .join("com.editoria.desktop")
                    .join(STATE_FILE)
            })
            .unwrap_or_else(|_| PathBuf::from(STATE_FILE));
        Self { path }
    }

    #[cfg(test)]
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }
}

impl RenderQueueStore for LocalRenderQueueStore {
    fn read_entries(&self) -> Vec<Value> {
        let Ok(raw) = fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    fn write_entries(&self, entries: &[QueueEntry]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("no se pudo crear el directorio: {e}"))?;
        }
        let payload = serde_json::to_string(persisted_slice(entries)).map_err(|e| e.to_string())?;
        fs::write(&self.path, payload).map_err(|e| format!("no se pudo escribir la cola: {e}"))
    }
}
