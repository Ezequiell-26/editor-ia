//! Casos de uso del Production Orchestrator.
//!
//! La corrida (`ProductionRun`) persiste en `ProductionStore`; cada avance
//! delega UNA etapa al `StageExecutor` del port y traduce el `StageOutcome`
//! a checkpoints, presupuesto y estado. Nada de providers concretos aquí:
//! la composición decide qué ejecutor inyectar.
//!
//! Reglas duras:
//! - El presupuesto se chequea ANTES de ejecutar y el coste se acumula
//!   después; un gasto que excede el tope pausa la corrida, no la falla.
//! - Una etapa que devuelve `completed:false` no fatal vuelve a pendiente
//!   (reintento); agotados `max_stage_attempts` o con `fatal`, la corrida
//!   queda `failed` con `last_error`.
//! - `advance` es idempotente por etapa: sólo corre la primera pendiente.

use crate::ports::projects::ProjectDocuments;
use crate::ports::studio::{ProductionStore, StageContext, StageExecutor};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{ProductionPlan, StudioStage};
use crate::studio::run::{ProductionRun, RunStatus, StageOutcome, StageRecordStatus};

pub(crate) fn now() -> String {
    // Timestamp ISO sin dependencia nueva: segundos desde epoch no sirven
    // para auditoría humana; se usa el formato que ya usa el proyecto.
    chrono_lite_now()
}

fn chrono_lite_now() -> String {
    // Evita traer `chrono`: el proyecto ya serializa fechas en otros lados
    // con el mismo helper cuando existe; fallback determinista para tests.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| format!("unix:{}", d.as_secs()))
        .unwrap_or_else(|_| "unix:0".to_owned())
}

/// Crea una corrida `planned` para un plan ya validado. Devuelve la corrida
/// persistida.
pub fn create_run(
    store: &dyn ProductionStore,
    plan: &ProductionPlan,
    run_id: &str,
    max_cost_cents: Option<u64>,
) -> Result<ProductionRun, ProjectError> {
    let run = ProductionRun::new(plan, run_id, max_cost_cents, &now());
    store.save(&run)?;
    Ok(run)
}

/// Avanza la corrida una etapa: ejecuta la primera pendiente con el
/// ejecutor y persiste el resultado. Devuelve la corrida actualizada.
///
/// Errores de infraestructura (store, plan ilegible) son `ProjectError`;
/// los fallos de la etapa quedan DENTRO de la corrida (`failed`/`paused`),
/// no como error de la llamada.
pub fn advance(
    store: &dyn ProductionStore,
    executor: &dyn StageExecutor,
    run_id: &str,
    project_root: &std::path::Path,
    document_path: &std::path::Path,
) -> Result<ProductionRun, ProjectError> {
    let mut run = store.load(run_id)?.ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "corrida no encontrada")
    })?;
    if run.status.is_terminal() {
        return Ok(run);
    }
    if run.status == RunStatus::Paused || run.status == RunStatus::Planned {
        if !run.resume(&now()) {
            return Ok(run);
        }
        store.save(&run)?;
    }
    let Some(stage) = run.next_pending_stage() else {
        run.complete(&now());
        store.save(&run)?;
        return Ok(run);
    };
    if !executor.supported_stages().contains(&stage) {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("ningún ejecutor soporta la etapa {stage:?}"),
        ));
    }
    // Presupuesto: sin estimación previa se exige que quede algo de margen;
    // el coste real se cobra al cerrar la etapa.
    if let Some(max) = run.max_cost_cents {
        if run.spent_cents >= max {
            run.pause(&now());
            store.save(&run)?;
            return Ok(run);
        }
    }
    if !run.begin_stage(stage, &now()) {
        store.save(&run)?;
        return Ok(run);
    }
    store.save(&run)?;

    let attempt = run
        .stage_record(stage)
        .and_then(|record| record.attempts)
        .unwrap_or(1);
    let previous_output = run
        .stage_record(stage)
        .and_then(|record| record.output.clone());
    let mut stage_outputs = serde_json::Map::new();
    for record in &run.stages {
        if let (Some(output), Some(stage_name)) = (
            record.output.clone(),
            serde_json::to_value(record.stage)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned)),
        ) {
            stage_outputs.insert(stage_name, output);
        }
    }
    let remaining = run
        .max_cost_cents
        .map(|max| max.saturating_sub(run.spent_cents));
    let ctx = StageContext {
        project_root: project_root.to_path_buf(),
        document_path: document_path.to_path_buf(),
        plan: run.plan.clone(),
        remaining_budget_cents: remaining,
        attempt,
        previous_output,
        stage_outputs: serde_json::Value::Object(stage_outputs),
    };
    let outcome = executor
        .execute(stage, &ctx)
        .unwrap_or_else(|error| StageOutcome {
            completed: false,
            cost_cents: None,
            output: None,
            error: Some(error.message),
            fatal: false,
            in_progress: false,
        });
    let finished = run.finish_stage(stage, &outcome, &now());
    if finished && run.next_pending_stage().is_none() {
        run.complete(&now());
    }
    store.save(&run)?;
    Ok(run)
}

/// Ciclo de reparación acotado tras un `review` fallido por Quality Gate.
///
/// Si la etapa `review` dejó la corrida `failed` y quedan ciclos
/// (`studio_repair::MAX_REPAIR_ATTEMPTS`), repara mecánicamente el
/// documento del proyecto y verifica que el resultado pasa el gate
/// COMPLETO en memoria. Sólo entonces guarda vía `documents.save` y
/// resetea `render`+`review` a pendiente — nunca se re-renderiza un
/// documento que seguiría fallando. Si no hay nada reparable o el gate
/// sigue rojo, la corrida queda `failed` honestamente.
///
/// Devuelve la corrida (posiblemente reseteada) sin avanzar etapas: el
/// próximo `advance`/driver itera render→review de nuevo.
pub fn repair_review_failure(
    store: &dyn ProductionStore,
    mut run: ProductionRun,
    document_path: &std::path::Path,
    project_root: &std::path::Path,
    documents: &dyn ProjectDocuments,
) -> Result<ProductionRun, ProjectError> {
    use crate::studio::quality::QualitySeverity;

    if run.status != RunStatus::Failed
        || run.repair_attempts >= crate::application::studio_repair::MAX_REPAIR_ATTEMPTS
    {
        return Ok(run);
    }
    let review_failed = run.stages.iter().any(|record| {
        record.stage == StudioStage::Review && record.status == StageRecordStatus::Failed
    });
    if !review_failed {
        return Ok(run);
    }
    let opened = documents.open(document_path)?;
    let report = crate::application::quality_gate::review_project(project_root, &opened.project);
    let has_errors = report
        .findings
        .iter()
        .any(|f| f.severity == QualitySeverity::Error);
    if !has_errors {
        return Ok(run);
    }
    let mut fixed = opened.project;
    let repair = crate::application::studio_repair::repair_document(&mut fixed, &report.findings);
    if repair.applied.is_empty() {
        return Ok(run);
    }
    let post = crate::application::quality_gate::review_project(project_root, &fixed);
    if post.errors() > 0 {
        return Ok(run);
    }
    documents.save(document_path, &fixed)?;
    let note = format!(
        "repair #{}: {}",
        run.repair_attempts + 1,
        repair.applied.join("; ")
    );
    run.repair_reset(&[StudioStage::Render, StudioStage::Review], &note, &now());
    store.save(&run)?;
    Ok(run)
}

/// Cancela una corrida no terminal.
pub fn cancel_run(
    store: &dyn ProductionStore,
    run_id: &str,
) -> Result<ProductionRun, ProjectError> {
    let mut run = store.load(run_id)?.ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "corrida no encontrada")
    })?;
    run.cancel(&now());
    store.save(&run)?;
    Ok(run)
}

/// Pausa una corrida no terminal (entre etapas; una etapa async en curso
/// termina su sondeo actual y el próximo advance no la re-toma).
pub fn pause_run(store: &dyn ProductionStore, run_id: &str) -> Result<ProductionRun, ProjectError> {
    let mut run = store.load(run_id)?.ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "corrida no encontrada")
    })?;
    run.pause(&now());
    store.save(&run)?;
    Ok(run)
}

/// Reanuda una corrida pausada/fallida sin ejecutar todavía.
pub fn resume_run(
    store: &dyn ProductionStore,
    run_id: &str,
) -> Result<ProductionRun, ProjectError> {
    let mut run = store.load(run_id)?.ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::NotFound, "corrida no encontrada")
    })?;
    run.resume(&now());
    store.save(&run)?;
    Ok(run)
}

/// Reconcilia corridas `running` tras un reinicio de la app: sus etapas a
/// medias (jobs de render, descargas) murieron con el proceso anterior.
/// Las pasa a `paused` — estado seguro y reanudable — y devuelve cuántas.
/// NUNCA auto-reanuda trabajo pesado sin consentimiento del usuario.
pub fn reconcile_interrupted_runs(store: &dyn ProductionStore) -> Result<usize, ProjectError> {
    let mut reconciled = 0usize;
    for mut run in store.list()? {
        if run.status == RunStatus::Running {
            run.pause(&now());
            store.save(&run)?;
            reconciled += 1;
        }
    }
    Ok(reconciled)
}

/// Consulta el estado persistido.
pub fn run_status(
    store: &dyn ProductionStore,
    run_id: &str,
) -> Result<Option<ProductionRun>, ProjectError> {
    store.load(run_id)
}

/// Lista las corridas persistidas (más recientes primero si el store ordena).
pub fn list_runs(store: &dyn ProductionStore) -> Result<Vec<ProductionRun>, ProjectError> {
    store.list()
}

/// Elimina una corrida terminada (o abortada). Las activas no se borran.
pub fn remove_run(store: &dyn ProductionStore, run_id: &str) -> Result<(), ProjectError> {
    if let Some(run) = store.load(run_id)? {
        if !run.status.is_terminal() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "sólo se eliminan corridas terminadas o canceladas",
            ));
        }
    }
    store.remove(run_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::plan::{
        ProductionBrief, ProductionPlan, ProductionTarget, QualityCriteria, StudioStage,
    };
    use crate::studio::run::PIPELINE_STAGES;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn plan() -> ProductionPlan {
        ProductionPlan {
            schema_version: 1,
            id: "plan-1".to_owned(),
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

    struct MemStore {
        runs: Mutex<HashMap<String, ProductionRun>>,
    }

    impl MemStore {
        fn new() -> Self {
            Self {
                runs: Mutex::new(HashMap::new()),
            }
        }
    }

    impl ProductionStore for MemStore {
        fn save(&self, run: &ProductionRun) -> Result<(), ProjectError> {
            self.runs
                .lock()
                .unwrap()
                .insert(run.id.clone(), run.clone());
            Ok(())
        }
        fn load(&self, run_id: &str) -> Result<Option<ProductionRun>, ProjectError> {
            Ok(self.runs.lock().unwrap().get(run_id).cloned())
        }
        fn list(&self) -> Result<Vec<ProductionRun>, ProjectError> {
            Ok(self.runs.lock().unwrap().values().cloned().collect())
        }
        fn remove(&self, run_id: &str) -> Result<(), ProjectError> {
            self.runs.lock().unwrap().remove(run_id);
            Ok(())
        }
    }

    /// Ejecutor guionado: completa todo menos las etapas en `fail_at`.
    struct Scripted {
        fail_at: Option<StudioStage>,
        cost: u64,
    }

    impl StageExecutor for Scripted {
        fn supported_stages(&self) -> Vec<StudioStage> {
            PIPELINE_STAGES.to_vec()
        }
        fn execute(
            &self,
            stage: StudioStage,
            _ctx: &StageContext,
        ) -> Result<StageOutcome, ProjectError> {
            if self.fail_at == Some(stage) {
                return Ok(StageOutcome {
                    completed: false,
                    cost_cents: Some(1),
                    output: None,
                    error: Some("etapa falló".to_owned()),
                    fatal: false,
                    in_progress: false,
                });
            }
            Ok(StageOutcome {
                completed: true,
                cost_cents: Some(self.cost),
                output: Some(serde_json::json!({ "stage": format!("{stage:?}") })),
                error: None,
                fatal: false,
                in_progress: false,
            })
        }
    }

    #[test]
    fn full_pipeline_completes_with_checkpoints_and_spend() {
        let store = MemStore::new();
        let plan = plan();
        create_run(&store, &plan, "run-1", Some(100_000)).unwrap();
        let executor = Scripted {
            fail_at: None,
            cost: 10,
        };
        let mut run = store.load("run-1").unwrap().unwrap();
        // Avanza hasta done: cada advance corre una etapa.
        for _ in 0..PIPELINE_STAGES.len() + 1 {
            run = advance(
                &store,
                &executor,
                "run-1",
                std::path::Path::new("."),
                std::path::Path::new("project.json"),
            )
            .unwrap();
            if run.status == RunStatus::Done {
                break;
            }
        }
        assert_eq!(run.status, RunStatus::Done);
        assert!(run
            .stages
            .iter()
            .all(|s| s.status == crate::studio::run::StageRecordStatus::Done));
        assert_eq!(run.spent_cents, 10 * PIPELINE_STAGES.len() as u64);
    }

    #[test]
    fn failing_stage_pauses_then_fails_after_max_attempts() {
        let store = MemStore::new();
        let plan = plan();
        create_run(&store, &plan, "run-2", None).unwrap();
        let executor = Scripted {
            fail_at: Some(StudioStage::Analyze),
            cost: 0,
        };
        // Plan ok → Acquire ok → Analyze falla y reintenta hasta agotar
        // max_stage_attempts (3): hacen falta ~5 advances.
        for _ in 0..6 {
            let run = advance(
                &store,
                &executor,
                "run-2",
                std::path::Path::new("."),
                std::path::Path::new("project.json"),
            )
            .unwrap();
            if run.status == RunStatus::Failed {
                break;
            }
        }
        let run = store.load("run-2").unwrap().unwrap();
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(
            run.stage_record(StudioStage::Analyze).unwrap().attempts,
            Some(run.max_stage_attempts)
        );
        // Resume permite reintentar desde el fallo.
        resume_run(&store, "run-2").unwrap();
        assert_eq!(
            store.load("run-2").unwrap().unwrap().status,
            RunStatus::Running
        );
    }

    #[test]
    fn budget_exhaustion_pauses_the_run() {
        let store = MemStore::new();
        let plan = plan();
        // Tope menor que el coste de una etapa: la corrida no puede ni empezar
        // a gastar; advance la deja paused antes de ejecutar.
        create_run(&store, &plan, "run-3", Some(5)).unwrap();
        let executor = Scripted {
            fail_at: None,
            cost: 10,
        };
        let run = advance(
            &store,
            &executor,
            "run-3",
            std::path::Path::new("."),
            std::path::Path::new("project.json"),
        )
        .unwrap();
        // Plan cuesta 10 > tope 5: se ejecuta (spent 0 < max) y el resultado
        // deja spent=10 > max → la SIGUIENTE etapa pausa por presupuesto.
        assert!(run.spent_cents <= 10);
        let run = advance(
            &store,
            &executor,
            "run-3",
            std::path::Path::new("."),
            std::path::Path::new("project.json"),
        )
        .unwrap();
        assert_eq!(run.status, RunStatus::Paused);
    }

    #[test]
    fn cancel_blocks_further_advances() {
        let store = MemStore::new();
        let plan = plan();
        create_run(&store, &plan, "run-4", None).unwrap();
        let executor = Scripted {
            fail_at: None,
            cost: 0,
        };
        cancel_run(&store, "run-4").unwrap();
        let run = advance(
            &store,
            &executor,
            "run-4",
            std::path::Path::new("."),
            std::path::Path::new("project.json"),
        )
        .unwrap();
        assert_eq!(run.status, RunStatus::Cancelled);
        assert_eq!(run.spent_cents, 0);
    }

    #[test]
    fn pause_run_pauses_and_resume_continues() {
        let store = MemStore::new();
        let plan = plan();
        create_run(&store, &plan, "run-pause", None).unwrap();
        let run = pause_run(&store, "run-pause").unwrap();
        assert_eq!(run.status, RunStatus::Paused);
        // advance desde paused reanuda y corre la primera etapa.
        let executor = Scripted {
            fail_at: None,
            cost: 0,
        };
        let run = advance(
            &store,
            &executor,
            "run-pause",
            std::path::Path::new("."),
            std::path::Path::new("project.json"),
        )
        .unwrap();
        assert_eq!(run.status, RunStatus::Running);
    }

    #[test]
    fn reconcile_interrupted_runs_only_touches_running() {
        let store = MemStore::new();
        let plan = plan();
        create_run(&store, &plan, "run-rec-1", None).unwrap();
        create_run(&store, &plan, "run-rec-2", None).unwrap();
        // Una queda running (simula app cerrada a mitad), otra planned.
        let executor = Scripted {
            fail_at: None,
            cost: 0,
        };
        advance(
            &store,
            &executor,
            "run-rec-1",
            std::path::Path::new("."),
            std::path::Path::new("project.json"),
        )
        .unwrap();
        assert_eq!(reconcile_interrupted_runs(&store).unwrap(), 1);
        assert_eq!(
            store.load("run-rec-1").unwrap().unwrap().status,
            RunStatus::Paused
        );
        assert_eq!(
            store.load("run-rec-2").unwrap().unwrap().status,
            RunStatus::Planned
        );
        // Idempotente: una segunda pasada no pausa nada más.
        assert_eq!(reconcile_interrupted_runs(&store).unwrap(), 0);
    }

    #[test]
    fn remove_only_allows_terminal_runs() {
        let store = MemStore::new();
        let plan = plan();
        create_run(&store, &plan, "run-5", None).unwrap();
        assert!(remove_run(&store, "run-5").is_err());
        cancel_run(&store, "run-5").unwrap();
        remove_run(&store, "run-5").unwrap();
        assert!(store.load("run-5").unwrap().is_none());
    }

    #[test]
    fn executor_error_becomes_retryable_stage_failure() {
        struct Boom;
        impl StageExecutor for Boom {
            fn supported_stages(&self) -> Vec<StudioStage> {
                PIPELINE_STAGES.to_vec()
            }
            fn execute(
                &self,
                _stage: StudioStage,
                _ctx: &StageContext,
            ) -> Result<StageOutcome, ProjectError> {
                Err(ProjectError::message(
                    ProjectErrorCode::Io,
                    "executor caído",
                ))
            }
        }
        let store = MemStore::new();
        let plan = plan();
        create_run(&store, &plan, "run-6", None).unwrap();
        let run = advance(
            &store,
            &Boom,
            "run-6",
            std::path::Path::new("."),
            std::path::Path::new("project.json"),
        )
        .unwrap();
        assert_eq!(run.status, RunStatus::Paused);
        assert_eq!(
            run.stage_record(StudioStage::Plan).unwrap().status,
            crate::studio::run::StageRecordStatus::Pending
        );
    }

    // ---- repair_review_failure ----

    use crate::projects::service::{OpenedProject, SaveProjectResult};
    use crate::studio::run::StageRecordStatus;
    use std::path::{Path, PathBuf};

    /// Documents en memoria: `open` devuelve el JSON guardado, `save` lo
    /// pisa. Suficiente para probar el ciclo de reparación sin disco.
    struct MemDocs {
        docs: Mutex<HashMap<PathBuf, serde_json::Value>>,
    }

    impl MemDocs {
        fn new() -> Self {
            Self {
                docs: Mutex::new(HashMap::new()),
            }
        }
        fn put(&self, path: &Path, project: serde_json::Value) {
            self.docs
                .lock()
                .unwrap()
                .insert(path.to_path_buf(), project);
        }
        fn get(&self, path: &Path) -> serde_json::Value {
            self.docs.lock().unwrap().get(path).cloned().unwrap()
        }
    }

    impl ProjectDocuments for MemDocs {
        fn open(&self, path: &Path) -> Result<OpenedProject, ProjectError> {
            let project = self.get(path);
            Ok(OpenedProject {
                project,
                path: path.to_string_lossy().to_string(),
            })
        }
        fn create_with_video(
            &self,
            _path: &Path,
            _name: &str,
            _video: Option<serde_json::Value>,
        ) -> Result<OpenedProject, ProjectError> {
            unimplemented!()
        }
        fn save(
            &self,
            path: &Path,
            project: &serde_json::Value,
        ) -> Result<SaveProjectResult, ProjectError> {
            self.put(path, project.clone());
            Ok(SaveProjectResult {
                path: path.to_string_lossy().to_string(),
                revision: 1,
                bytes: 0,
            })
        }
    }

    /// Corrida con todas las etapas cerradas hasta `review`, que queda
    /// `failed` por Quality Gate (fatal). `deliver` sigue pendiente.
    fn run_failed_at_review(store: &MemStore, run_id: &str) -> ProductionRun {
        let plan = plan();
        create_run(store, &plan, run_id, None).unwrap();
        let mut run = store.load(run_id).unwrap().unwrap();
        for stage in PIPELINE_STAGES {
            if *stage == StudioStage::Deliver {
                break;
            }
            assert!(run.begin_stage(*stage, "t"));
            let outcome = if *stage == StudioStage::Review {
                StageOutcome {
                    completed: false,
                    cost_cents: None,
                    output: None,
                    error: Some("quality gate: 1 error(es)".to_owned()),
                    fatal: true,
                    in_progress: false,
                }
            } else {
                StageOutcome {
                    completed: true,
                    cost_cents: Some(0),
                    output: None,
                    error: None,
                    fatal: false,
                    in_progress: false,
                }
            };
            run.finish_stage(*stage, &outcome, "t");
        }
        store.save(&run).unwrap();
        run
    }

    /// Proyecto mínimo que pasa el gate salvo un clip fuera de rango
    /// (`clip-range` error, reparable por clamp).
    fn project_with_out_of_range_clip(media_file: &Path) -> serde_json::Value {
        std::fs::create_dir_all(media_file.parent().unwrap()).unwrap();
        std::fs::write(media_file, b"x").unwrap();
        serde_json::json!({
            "assets": [{
                "id": "a1", "kind": "video", "status": "ready",
                "source": { "type": "local", "path": "media/x.mp4" },
                "rights": {
                    "license": { "id": "l", "commercialUse": "allowed" },
                    "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                },
                "media": { "width": 1920, "height": 1080, "durationFrames": 100,
                           "frameRate": { "num": 30, "den": 1 } }
            }],
            "timeline": {
                "tracks": [{ "id": "t1", "kind": "video" }],
                "clips": [{
                    "id": "c1", "trackId": "t1", "kind": "video",
                    "startFrame": 0, "durationFrames": 999,
                    "source": { "type": "asset", "assetId": "a1", "inFrame": 0, "outFrame": 999 }
                }]
            },
            "captions": { "cues": [] },
            "renderProfiles": [{ "id": "p1" }]
        })
    }

    #[test]
    fn repair_resets_render_and_review_when_gate_turns_green() {
        let store = MemStore::new();
        let run = run_failed_at_review(&store, "run-rep-1");
        assert_eq!(run.status, RunStatus::Failed);

        let root = std::env::temp_dir().join(format!("rep-{}", std::process::id()));
        let doc_path = root.join("project.json");
        let docs = MemDocs::new();
        docs.put(
            &doc_path,
            project_with_out_of_range_clip(&root.join("media/x.mp4")),
        );

        let fixed = repair_review_failure(&store, run, &doc_path, &root, &docs).unwrap();
        assert_eq!(fixed.status, RunStatus::Running);
        assert_eq!(fixed.repair_attempts, 1);
        assert!(fixed.last_repair.as_deref().unwrap().contains("clip c1"));
        assert_eq!(
            fixed.stage_record(StudioStage::Render).unwrap().status,
            StageRecordStatus::Pending
        );
        assert_eq!(
            fixed.stage_record(StudioStage::Review).unwrap().status,
            StageRecordStatus::Pending
        );
        // El documento guardado tiene el rango clampeado a la duración real.
        let saved = docs.get(&doc_path);
        assert_eq!(saved["timeline"]["clips"][0]["source"]["outFrame"], 100);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn repair_refuses_when_gate_stays_red() {
        let store = MemStore::new();
        let run = run_failed_at_review(&store, "run-rep-2");

        let root = std::env::temp_dir().join(format!("rep2-{}", std::process::id()));
        let doc_path = root.join("project.json");
        let docs = MemDocs::new();
        // Clip fuera de rango (reparable) + asset cuyo archivo NO existe
        // (missing-resources, no reparable): el gate post-repair sigue rojo.
        let mut project = project_with_out_of_range_clip(&root.join("media/x.mp4"));
        project["assets"][0]["source"]["path"] = serde_json::json!("media/no-existe.mp4");
        docs.put(&doc_path, project);

        let fixed = repair_review_failure(&store, run, &doc_path, &root, &docs).unwrap();
        assert_eq!(fixed.status, RunStatus::Failed);
        assert_eq!(fixed.repair_attempts, 0);
        // El documento NO se guardó (sigue declarando la ruta rota original…
        // o la reparada en memoria sin persistir — en cualquier caso el
        // run no se reseteó).
        assert_eq!(
            fixed.stage_record(StudioStage::Review).unwrap().status,
            StageRecordStatus::Failed
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn repair_respects_the_attempt_cap() {
        let store = MemStore::new();
        let mut run = run_failed_at_review(&store, "run-rep-3");
        run.repair_attempts = crate::application::studio_repair::MAX_REPAIR_ATTEMPTS;
        store.save(&run).unwrap();

        let root = std::env::temp_dir().join(format!("rep3-{}", std::process::id()));
        let doc_path = root.join("project.json");
        let docs = MemDocs::new();
        docs.put(
            &doc_path,
            project_with_out_of_range_clip(&root.join("media/x.mp4")),
        );

        let fixed = repair_review_failure(&store, run, &doc_path, &root, &docs).unwrap();
        assert_eq!(fixed.status, RunStatus::Failed);
        assert_eq!(
            fixed.repair_attempts,
            crate::application::studio_repair::MAX_REPAIR_ATTEMPTS
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
