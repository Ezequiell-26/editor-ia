//! Cola de render persistente en el backend.
//!
//! La UI ya guarda su cola en `localStorage`; este módulo es la copia durable
//! del lado nativo (JSON en `%LOCALAPPDATA%\com.editoria.desktop`), pensada
//! para sobrevivir reinicios y servir de base a pausa/reanudación/reorden
//! cuando el worker de render las soporte.
//!
//! Reglas (espejo de `state/render-queue.ts` del frontend):
//! - La cola se capea en 50 entradas.
//! - Al cargar, lo que quedó `running` vuelve a `pending`: el archivo quedó
//!   incompleto y hay que repetirlo. Nunca se reporta como entregado.
//! - JSON corrupto o entradas basura se degradan, no tumban la carga.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

pub const RENDER_QUEUE_LIMIT: usize = 50;
const STATE_FILE: &str = "render-queue.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueStatus {
    Pending,
    Running,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub id: String,
    pub profile_id: String,
    pub profile_name: String,
    #[serde(default)]
    pub include_captions: bool,
    pub status: QueueStatus,
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    pub queued_at: String,
}

/// Lee la cola persistida aplicando la recuperación `running → pending`.
/// Tolera archivo inexistente, JSON inválido y entradas corruptas.
pub fn load_queue(path: &PathBuf) -> Vec<QueueEntry> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let parsed: Vec<serde_json::Value> = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let mut entries: Vec<QueueEntry> = parsed
        .into_iter()
        .filter_map(|item| serde_json::from_value::<QueueEntry>(item).ok())
        .map(|mut entry| {
            if entry.status == QueueStatus::Running {
                entry.status = QueueStatus::Pending;
                entry.output_path = None;
                entry.message = None;
            }
            entry
        })
        .collect();
    let start = entries.len().saturating_sub(RENDER_QUEUE_LIMIT);
    entries.drain(..start);
    entries
}

/// Persiste la cola (capeada). Devuelve error sólo si no se pudo escribir.
pub fn save_queue(path: &PathBuf, queue: &[QueueEntry]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("no se pudo crear el directorio: {e}"))?;
    }
    let start = queue.len().saturating_sub(RENDER_QUEUE_LIMIT);
    let payload = serde_json::to_string(&queue[start..]).map_err(|e| e.to_string())?;
    fs::write(path, payload).map_err(|e| format!("no se pudo escribir la cola: {e}"))?;
    Ok(())
}

fn queue_file() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(|base| {
            PathBuf::from(base)
                .join("com.editoria.desktop")
                .join(STATE_FILE)
        })
        .unwrap_or_else(|_| PathBuf::from(STATE_FILE))
}

/// Estado completo de la cola persistida (con recuperación aplicada).
#[tauri::command]
pub fn render_queue_load() -> Result<Vec<QueueEntry>, String> {
    Ok(load_queue(&queue_file()))
}

/// Reemplaza la cola persistida con la que manda la UI.
#[tauri::command]
pub fn render_queue_save(queue: Vec<QueueEntry>) -> Result<(), String> {
    save_queue(&queue_file(), &queue)
}

/// Descarta las entradas terminadas (`done`, `error`, `cancelled`).
#[tauri::command]
pub fn render_queue_clear_finished() -> Result<Vec<QueueEntry>, String> {
    let path = queue_file();
    let queue = load_queue(&path);
    let kept: Vec<QueueEntry> = queue
        .into_iter()
        .filter(|entry| matches!(entry.status, QueueStatus::Pending | QueueStatus::Running))
        .collect();
    save_queue(&path, &kept)?;
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn entry(id: &str, status: QueueStatus) -> QueueEntry {
        QueueEntry {
            id: id.to_string(),
            profile_id: "p1".to_string(),
            profile_name: "Perfil".to_string(),
            include_captions: false,
            status,
            output_path: None,
            message: None,
            queued_at: "2026-11-07T00:00:00Z".to_string(),
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("olyvia-rq-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        dir.join(name)
    }

    #[test]
    fn roundtrip_guarda_y_recupera_en_orden() {
        let path = temp_path("roundtrip.json");
        let queue = vec![
            entry("a", QueueStatus::Pending),
            entry("b", QueueStatus::Done),
        ];
        save_queue(&path, &queue).unwrap();
        let loaded = load_queue(&path);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "a");
        assert_eq!(loaded[1].status, QueueStatus::Done);
    }

    #[test]
    fn running_vuelve_a_pending_al_cargar() {
        let path = temp_path("running.json");
        let mut running = entry("r", QueueStatus::Running);
        running.output_path = Some("parcial.mp4".to_string());
        save_queue(&path, &[running]).unwrap();
        let loaded = load_queue(&path);
        assert_eq!(loaded[0].status, QueueStatus::Pending);
        assert_eq!(loaded[0].output_path, None);
    }

    #[test]
    fn json_corrupto_devuelve_vacia_sin_tumbar() {
        let path = temp_path("corrupto.json");
        let mut file = fs::File::create(&path).unwrap();
        write!(file, "{{no es json").unwrap();
        assert!(load_queue(&path).is_empty());
        assert!(load_queue(&temp_path("inexistente.json")).is_empty());
    }

    #[test]
    fn entradas_basura_se_descartan_y_las_buenas_sobreviven() {
        let path = temp_path("basura.json");
        fs::write(
            &path,
            r#"[{"basura":true},null,42,{"id":"x","profileId":"p","profileName":"n","queuedAt":"z","status":"done"}]"#,
        )
        .unwrap();
        let loaded = load_queue(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "x");
    }

    #[test]
    fn la_cola_se_capea_en_50() {
        let path = temp_path("capeo.json");
        let queue: Vec<QueueEntry> = (0..60)
            .map(|i| entry(&format!("e{i}"), QueueStatus::Pending))
            .collect();
        save_queue(&path, &queue).unwrap();
        let loaded = load_queue(&path);
        assert_eq!(loaded.len(), RENDER_QUEUE_LIMIT);
        assert_eq!(loaded[0].id, "e10");
        assert_eq!(loaded.last().unwrap().id, "e59");
    }
}
