//! Cola de render persistida en `%LOCALAPPDATA%\com.editoria.desktop\render-queue.json`.

use std::fs;
use std::io::Write;
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
        // Escritura atómica: un corte a mitad de `fs::write` truncaba
        // render-queue.json y `read_entries` devolvía cola vacía — los
        // renders pendientes desaparecían sin error. Mismo patrón que
        // settings.json/plugins.json: tmp + fsync + rename.
        let tmp = self.path.with_extension("json.tmp");
        let write_result = (|| -> std::io::Result<()> {
            let mut file = fs::File::create(&tmp)?;
            file.write_all(payload.as_bytes())?;
            file.sync_all()?;
            drop(file);
            fs::rename(&tmp, &self.path)
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        write_result.map_err(|e| format!("no se pudo escribir la cola: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::queue::QueueStatus;

    fn entry(id: &str) -> QueueEntry {
        QueueEntry {
            id: id.to_owned(),
            profile_id: "p".to_owned(),
            profile_name: "profile".to_owned(),
            include_captions: false,
            status: QueueStatus::Pending,
            output_path: None,
            message: None,
            queued_at: "2026-11-14T00:00:00Z".to_owned(),
            project_id: None,
            project_name: None,
        }
    }

    #[test]
    fn write_entries_round_trips_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join(format!(
            "render-queue-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("tmp dir");
        let path = dir.join("render-queue.json");
        let store = LocalRenderQueueStore::at(path.clone());

        store.write_entries(&[entry("a")]).expect("write");
        assert_eq!(store.read_entries().len(), 1);
        // La escritura atómica no deja el temporal atrás.
        assert!(!path.with_extension("json.tmp").exists());

        // Una segunda escritura reemplaza el estado sin corromperlo.
        store
            .write_entries(&[entry("a"), entry("b")])
            .expect("rewrite");
        assert_eq!(store.read_entries().len(), 2);
        assert!(!path.with_extension("json.tmp").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
