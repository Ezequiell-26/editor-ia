//! Persistencia local de `ProductionRun` en el directorio de configuración
//! de la app (`config_dir` que ya usa `AppState`).
//!
//! Layout: `<config_dir>/productions/<run-id>.json`, un archivo por corrida,
//! escritura atómica vía archivo temporal + rename para no dejar JSON roto
//! si la app muere a mitad de guardado.

use std::fs;
use std::path::PathBuf;

use crate::ports::studio::ProductionStore;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::run::ProductionRun;

pub struct LocalProductionStore {
    dir: PathBuf,
}

impl LocalProductionStore {
    pub fn new(config_dir: &std::path::Path) -> Self {
        Self {
            dir: config_dir.join("productions"),
        }
    }

    fn run_path(&self, run_id: &str) -> PathBuf {
        // Sanitiza el id: sólo [A-Za-z0-9_-], evita path traversal.
        let safe: String = run_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(format!("{safe}.json"))
    }
}

impl ProductionStore for LocalProductionStore {
    fn save(&self, run: &ProductionRun) -> Result<(), ProjectError> {
        fs::create_dir_all(&self.dir)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        let path = self.run_path(&run.id);
        let tmp = path.with_extension("json.tmp");
        let payload = serde_json::to_string_pretty(run)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
        fs::write(&tmp, payload)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        fs::rename(&tmp, &path)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        Ok(())
    }

    fn load(&self, run_id: &str) -> Result<Option<ProductionRun>, ProjectError> {
        let path = self.run_path(run_id);
        let Ok(raw) = fs::read_to_string(&path) else {
            return Ok(None);
        };
        let run = serde_json::from_str(&raw)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
        Ok(Some(run))
    }

    fn list(&self) -> Result<Vec<ProductionRun>, ProjectError> {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return Ok(Vec::new());
        };
        let mut runs = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(run) = serde_json::from_str::<ProductionRun>(&raw) {
                    runs.push(run);
                }
            }
        }
        // Más recientes primero por `updated_at`.
        runs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(runs)
    }

    fn remove(&self, run_id: &str) -> Result<(), ProjectError> {
        let path = self.run_path(run_id);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(ProjectError::message(ProjectErrorCode::Io, &e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::plan::{
        ProductionBrief, ProductionPlan, ProductionTarget, QualityCriteria, StudioStage,
    };

    fn test_plan(id: &str) -> ProductionPlan {
        ProductionPlan {
            schema_version: 1,
            id: id.to_owned(),
            created_at: String::new(),
            updated_at: String::new(),
            brief: ProductionBrief {
                objective: "test".to_owned(),
                audience: None,
                tone: None,
                key_points: vec![],
            },
            target: ProductionTarget {
                platform: Default::default(),
                aspect_ratio: "16:9".to_owned(),
                target_duration_frames: 300,
                render_profile_id: None,
            },
            requirements: vec![],
            scenes: vec![],
            subtitles: Default::default(),
            music: Default::default(),
            transition: None,
            quality: QualityCriteria {
                required_checks: vec![],
                min_vmaf: None,
                loudness_target_lufs: None,
            },
            max_cost_cents: None,
            stage: Default::default(),
        }
    }

    #[test]
    fn save_load_list_remove_roundtrip() {
        let dir = std::env::temp_dir().join(format!("prod-store-{}", std::process::id()));
        let store = LocalProductionStore::new(&dir);
        let mut run = ProductionRun::new(&test_plan("plan-x"), "run-1", Some(500), "t0");
        run.begin_stage(StudioStage::Plan, "t1");
        store.save(&run).unwrap();
        let loaded = store.load("run-1").unwrap().unwrap();
        assert_eq!(loaded.plan_id, "plan-x");
        assert_eq!(loaded.current_stage, StudioStage::Plan);
        assert_eq!(store.list().unwrap().len(), 1);
        store.remove("run-1").unwrap();
        assert!(store.load("run-1").unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn run_id_cannot_escape_the_store_dir() {
        let dir = std::env::temp_dir().join(format!("prod-store-sec-{}", std::process::id()));
        let store = LocalProductionStore::new(&dir);
        let run = ProductionRun::new(&test_plan("p"), "../../etc/passwd", None, "t");
        store.save(&run).unwrap();
        // El archivo quedó dentro del dir de productions, sanitizado.
        assert!(store.load("../../etc/passwd").unwrap().is_some());
        assert!(!dir.join("..\\..\\etc\\passwd.json").exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
