//! Casos de uso de la cola de render persistida.
//!
//! La UI manda su cola completa; el caso de uso aplica las reglas del
//! dominio (`render::queue::recover_entries`, cap, `running → pending`) y
//! delega la persistencia al port `RenderQueueStore`.

use crate::ports::render::RenderQueueStore;
use crate::render::queue::{self, QueueEntry};

/// Estado completo de la cola persistida (con recuperación aplicada).
pub fn load_render_queue(store: &dyn RenderQueueStore) -> Vec<QueueEntry> {
    queue::recover_entries(store.read_entries())
}

/// Reemplaza la cola persistida con la que manda la UI (capeada).
pub fn save_render_queue(
    store: &dyn RenderQueueStore,
    queue: Vec<QueueEntry>,
) -> Result<(), String> {
    store.write_entries(&queue)
}

/// Descarta las entradas terminadas (`done`, `error`, `cancelled`).
pub fn clear_finished_render_queue(
    store: &dyn RenderQueueStore,
) -> Result<Vec<QueueEntry>, String> {
    let queue = load_render_queue(store);
    let kept: Vec<QueueEntry> = queue
        .into_iter()
        .filter(|entry| queue::is_unfinished(entry.status))
        .collect();
    store.write_entries(&kept)?;
    Ok(kept)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::render_queue::LocalRenderQueueStore;
    use crate::render::queue::QueueStatus;
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
            project_id: None,
            project_name: None,
        }
    }

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("olyvia-rq-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    fn temp_store(name: &str) -> LocalRenderQueueStore {
        LocalRenderQueueStore::at(temp_dir().join(name))
    }

    #[test]
    fn roundtrip_guarda_y_recupera_en_orden() {
        let store = temp_store("roundtrip.json");
        let queue = vec![
            entry("a", QueueStatus::Pending),
            entry("b", QueueStatus::Done),
        ];
        save_render_queue(&store, queue).unwrap();
        let loaded = load_render_queue(&store);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "a");
        assert_eq!(loaded[1].status, QueueStatus::Done);
    }

    #[test]
    fn running_vuelve_a_pending_al_cargar() {
        let store = temp_store("running.json");
        let mut running = entry("r", QueueStatus::Running);
        running.output_path = Some("parcial.mp4".to_string());
        save_render_queue(&store, vec![running]).unwrap();
        let loaded = load_render_queue(&store);
        assert_eq!(loaded[0].status, QueueStatus::Pending);
        assert_eq!(loaded[0].output_path, None);
    }

    #[test]
    fn json_corrupto_devuelve_vacia_sin_tumbar() {
        let name = "corrupto.json";
        let store = temp_store(name);
        let mut file = std::fs::File::create(temp_dir().join(name)).unwrap();
        write!(file, "{{no es json").unwrap();
        assert!(load_render_queue(&store).is_empty());
        assert!(load_render_queue(&temp_store("inexistente.json")).is_empty());
    }

    #[test]
    fn entradas_basura_se_descartan_y_las_buenas_sobreviven() {
        let name = "basura.json";
        let store = temp_store(name);
        std::fs::write(
            temp_dir().join(name),
            r#"[{"basura":true},null,42,{"id":"x","profileId":"p","profileName":"n","queuedAt":"z","status":"done"}]"#,
        )
        .unwrap();
        let loaded = load_render_queue(&store);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "x");
    }

    #[test]
    fn entradas_sin_proyecto_cargan_como_legacy() {
        let name = "legacy.json";
        let store = temp_store(name);
        std::fs::write(
            temp_dir().join(name),
            r#"[{"id":"l1","profileId":"p","profileName":"n","queuedAt":"z","status":"pending"},
                {"id":"l2","profileId":"p2","profileName":"n2","queuedAt":"z","status":"pending","projectId":"proj-a","projectName":"Alpha"}]"#,
        )
        .unwrap();
        let loaded = load_render_queue(&store);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].project_id, None);
        assert_eq!(loaded[1].project_id.as_deref(), Some("proj-a"));
        assert_eq!(loaded[1].project_name.as_deref(), Some("Alpha"));
    }

    #[test]
    fn la_cola_se_capea_en_50() {
        let store = temp_store("capeo.json");
        let queue: Vec<QueueEntry> = (0..60)
            .map(|i| entry(&format!("e{i}"), QueueStatus::Pending))
            .collect();
        save_render_queue(&store, queue).unwrap();
        let loaded = load_render_queue(&store);
        assert_eq!(loaded.len(), queue::RENDER_QUEUE_LIMIT);
        assert_eq!(loaded[0].id, "e10");
        assert_eq!(loaded.last().unwrap().id, "e59");
    }

    #[test]
    fn clear_finished_conserva_lo_que_puede_correr() {
        let store = temp_store("clear.json");
        save_render_queue(
            &store,
            vec![
                entry("pend", QueueStatus::Pending),
                entry("done", QueueStatus::Done),
                entry("err", QueueStatus::Error),
            ],
        )
        .unwrap();
        let kept = clear_finished_render_queue(&store).unwrap();
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "pend");
    }
}
