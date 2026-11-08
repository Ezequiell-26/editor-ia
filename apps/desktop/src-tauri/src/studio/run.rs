//! Ciclo de vida de una producción autónoma: tipos y reglas puras.
//!
//! Una `ProductionRun` es la ejecución persistible de un `ProductionPlan`:
//! en qué etapa va, qué etapas ya cerró (checkpoints), cuánto presupuesto se
//! autorizó y gastó, y por qué terminó si falló. No toca filesystem, red ni
//! procesos — eso vive en `application::production` y los ports.

use serde::{Deserialize, Serialize};

use super::plan::StudioStage;

/// Orden canónico de las etapas del pipeline. `Brief` es la entrada del
/// plan (no se ejecuta); el resto se recorre en este orden.
pub const PIPELINE_STAGES: &[StudioStage] = &[
    StudioStage::Plan,
    StudioStage::Acquire,
    StudioStage::Analyze,
    StudioStage::Scenes,
    StudioStage::Edit,
    StudioStage::Render,
    StudioStage::Review,
    StudioStage::Deliver,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    /// Creada, todavía no arrancó.
    Planned,
    Running,
    /// Pausada por el usuario o por presupuesto; se puede reanudar.
    Paused,
    Cancelled,
    Done,
    Failed,
}

impl RunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Cancelled)
    }

    /// Estados desde los que se puede cancelar.
    pub fn can_cancel(self) -> bool {
        matches!(self, Self::Planned | Self::Running | Self::Paused)
    }

    /// Estados desde los que se puede reanudar/avanzar.
    pub fn can_resume(self) -> bool {
        matches!(self, Self::Planned | Self::Paused | Self::Failed)
    }
}

/// Resultado de ejecutar una etapa, informado por el `StageExecutor`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageOutcome {
    /// `true` si la etapa cerró; `false` si quedó a medias (reintentable).
    pub completed: bool,
    /// Coste real de la etapa en centavos, si el ejecutor lo sabe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_cents: Option<u64>,
    /// Datos producidos por la etapa (recursos, decisiones, artefactos).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    /// Error legible si `completed == false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Fallo definitivo: no reintentar esta etapa.
    #[serde(default)]
    pub fatal: bool,
    /// La etapa sigue trabajando (p.ej. un render en curso): NO es un
    /// intento fallido ni un cierre — la etapa queda `running` y el próximo
    /// `advance` la sondea de nuevo con `previous_output` como estado.
    #[serde(default)]
    pub in_progress: bool,
}

/// Estado de una etapa dentro de la corrida.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageRecord {
    pub stage: StudioStage,
    pub status: StageRecordStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempts: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_cents: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    /// Último `output` informado por el ejecutor (jobId, rutas, reportes…).
    /// Las etapas async lo usan para reanudar sondeos entre `advance`s.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StageRecordStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

/// Ejecución persistible de un plan de producción.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductionRun {
    pub id: String,
    pub plan_id: String,
    /// Plan completo serializado: la corrida es autosuficiente y el
    /// ejecutor de etapas no necesita que el llamador lo re-suministre.
    #[serde(default)]
    pub plan: serde_json::Value,
    pub status: RunStatus,
    /// Etapa actual (la primera no completada del pipeline).
    pub current_stage: StudioStage,
    pub stages: Vec<StageRecord>,
    /// Presupuesto autorizado en centavos (`None` = sin límite declarado).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_cents: Option<u64>,
    /// Coste acumulado informado por los ejecutores.
    pub spent_cents: u64,
    /// Intentos máximos por etapa antes de declarar la corrida fallida.
    pub max_stage_attempts: u32,
    /// Veces que ya se reanudó la corrida (para auditoría).
    pub resumes: u32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// Límites por defecto: sin gasto autorizado no hay generación de pago, y
/// 3 intentos por etapa evitan ciclos de reparación infinitos.
pub const DEFAULT_MAX_STAGE_ATTEMPTS: u32 = 3;

impl ProductionRun {
    /// Crea la corrida en `planned` con todas las etapas del pipeline
    /// registradas como pendientes. El plan queda embebido en la corrida.
    pub fn new(
        plan: &super::plan::ProductionPlan,
        run_id: &str,
        max_cost_cents: Option<u64>,
        now: &str,
    ) -> Self {
        Self {
            id: run_id.to_owned(),
            plan_id: plan.id.clone(),
            plan: serde_json::to_value(plan).unwrap_or(serde_json::Value::Null),
            status: RunStatus::Planned,
            current_stage: *PIPELINE_STAGES.first().unwrap_or(&StudioStage::Plan),
            stages: PIPELINE_STAGES
                .iter()
                .map(|stage| StageRecord {
                    stage: *stage,
                    status: StageRecordStatus::Pending,
                    attempts: None,
                    cost_cents: None,
                    error: None,
                    finished_at: None,
                    output: None,
                })
                .collect(),
            max_cost_cents,
            spent_cents: 0,
            max_stage_attempts: DEFAULT_MAX_STAGE_ATTEMPTS,
            resumes: 0,
            created_at: now.to_owned(),
            updated_at: now.to_owned(),
            last_error: None,
        }
    }

    fn stage_record_mut(&mut self, stage: StudioStage) -> Option<&mut StageRecord> {
        self.stages.iter_mut().find(|record| record.stage == stage)
    }

    pub fn stage_record(&self, stage: StudioStage) -> Option<&StageRecord> {
        self.stages.iter().find(|record| record.stage == stage)
    }

    /// Primera etapa por ejecutar: `pending` o `running` (una etapa async
    /// que quedó a medias se re-sondea, no se da por fallida).
    /// `None` si todas cerraron.
    pub fn next_pending_stage(&self) -> Option<StudioStage> {
        self.stages
            .iter()
            .find(|record| {
                matches!(
                    record.status,
                    StageRecordStatus::Pending | StageRecordStatus::Running
                )
            })
            .map(|record| record.stage)
    }

    /// Marca una etapa como en curso y actualiza `current_stage`.
    /// Devuelve `false` si la corrida no puede avanzar.
    pub fn begin_stage(&mut self, stage: StudioStage, now: &str) -> bool {
        if self.status.is_terminal() {
            return false;
        }
        let Some(record) = self.stage_record_mut(stage) else {
            return false;
        };
        if record.status == StageRecordStatus::Done
            || record.status == StageRecordStatus::Skipped
            || record.status == StageRecordStatus::Failed
        {
            return false;
        }
        // Re-entrada a una etapa `running` (sondeo async): no suma intento.
        if record.status == StageRecordStatus::Pending {
            record.attempts = Some(record.attempts.unwrap_or(0) + 1);
        }
        record.status = StageRecordStatus::Running;
        self.current_stage = stage;
        self.status = RunStatus::Running;
        self.updated_at = now.to_owned();
        true
    }

    /// Registra el resultado de una etapa. Devuelve `true` si la corrida
    /// quedó `done` (todas las etapas cerradas).
    pub fn finish_stage(&mut self, stage: StudioStage, outcome: &StageOutcome, now: &str) -> bool {
        let attempts = self
            .stage_record(stage)
            .and_then(|record| record.attempts)
            .unwrap_or(1);
        let Some(idx) = self.stages.iter().position(|r| r.stage == stage) else {
            return false;
        };
        let cost = outcome.cost_cents.unwrap_or(0);
        self.spent_cents = self.spent_cents.saturating_add(cost);

        // Decide el nuevo estado del registro y de la corrida sin mantener
        // el borrow del record mientras se tocan campos del run.
        // Sondeo async: la etapa sigue trabajando; queda `running` con su
        // output como estado para el próximo advance. No es intento fallido.
        if outcome.in_progress {
            if let Some(record) = self.stage_record_mut(stage) {
                record.status = StageRecordStatus::Running;
                record.output = outcome.output.clone();
            }
            self.status = RunStatus::Running;
            self.updated_at = now.to_owned();
            return false;
        }
        let fatal = !outcome.completed && (outcome.fatal || attempts >= self.max_stage_attempts);
        let (record_status, record_error, record_finished) = if outcome.completed {
            self.last_error = None;
            (StageRecordStatus::Done, None, Some(now.to_owned()))
        } else if fatal {
            self.status = RunStatus::Failed;
            self.last_error = outcome
                .error
                .clone()
                .or_else(|| Some(format!("la etapa {stage:?} falló {attempts} veces")));
            (StageRecordStatus::Failed, outcome.error.clone(), None)
        } else {
            // Reintentable: vuelve a pendiente para el próximo advance.
            self.status = RunStatus::Paused;
            (StageRecordStatus::Pending, outcome.error.clone(), None)
        };
        {
            let record = &mut self.stages[idx];
            if outcome.cost_cents.is_some() {
                record.cost_cents = Some(cost);
            }
            record.status = record_status;
            record.error = record_error;
            record.finished_at = record_finished;
            record.output = outcome.output.clone();
        }
        self.updated_at = now.to_owned();
        if fatal {
            return false;
        }
        self.next_pending_stage().is_none()
    }

    /// Salta una etapa (p.ej. `acquire` cuando el plan no pide recursos
    /// externos). Sólo etapas pendientes.
    pub fn skip_stage(&mut self, stage: StudioStage, now: &str) -> bool {
        let Some(record) = self.stage_record_mut(stage) else {
            return false;
        };
        if record.status != StageRecordStatus::Pending {
            return false;
        }
        record.status = StageRecordStatus::Skipped;
        record.finished_at = Some(now.to_owned());
        self.updated_at = now.to_owned();
        true
    }

    /// ¿El presupuesto permite gastar `additional` centavos más?
    pub fn budget_allows(&self, additional: u64) -> bool {
        match self.max_cost_cents {
            Some(max) => self.spent_cents.saturating_add(additional) <= max,
            None => true,
        }
    }

    pub fn cancel(&mut self, now: &str) -> bool {
        if !self.status.can_cancel() {
            return false;
        }
        self.status = RunStatus::Cancelled;
        self.updated_at = now.to_owned();
        true
    }

    /// Pausa manual o por presupuesto. `Paused`/`Failed`/`Planned` → `Paused`;
    /// desde `Running` también se puede pausar entre etapas.
    pub fn pause(&mut self, now: &str) -> bool {
        if self.status.is_terminal() || self.status == RunStatus::Paused {
            return false;
        }
        self.status = RunStatus::Paused;
        self.updated_at = now.to_owned();
        true
    }

    /// Reanuda una corrida pausada/fallida/planeada. Las etapas que quedaron
    /// `failed` vuelven a `pending` para reintentarlas desde el punto de
    /// fallo. Devuelve `false` si el presupuesto ya está agotado.
    pub fn resume(&mut self, now: &str) -> bool {
        if !self.status.can_resume() {
            return false;
        }
        for record in &mut self.stages {
            if record.status == StageRecordStatus::Failed {
                record.status = StageRecordStatus::Pending;
            }
        }
        self.status = RunStatus::Running;
        self.resumes = self.resumes.saturating_add(1);
        self.updated_at = now.to_owned();
        true
    }

    /// Marca la corrida como terminada con éxito (lo llama el orquestador
    /// cuando la última etapa cierra).
    pub fn complete(&mut self, now: &str) {
        self.status = RunStatus::Done;
        self.updated_at = now.to_owned();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_plan() -> crate::studio::plan::ProductionPlan {
        use crate::studio::plan::{
            ProductionBrief, ProductionPlan, ProductionTarget, QualityCriteria,
        };
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

    fn run() -> ProductionRun {
        ProductionRun::new(&test_plan(), "run-1", Some(1000), "2026-02-20T00:00:00Z")
    }

    fn ok(cost: Option<u64>) -> StageOutcome {
        StageOutcome {
            completed: true,
            cost_cents: cost,
            output: None,
            error: None,
            fatal: false,
            in_progress: false,
        }
    }

    #[test]
    fn new_run_registers_all_pipeline_stages_as_pending() {
        let run = run();
        assert_eq!(run.status, RunStatus::Planned);
        assert_eq!(run.stages.len(), PIPELINE_STAGES.len());
        assert_eq!(run.next_pending_stage(), Some(StudioStage::Plan));
    }

    #[test]
    fn completing_every_stage_marks_the_run_done() {
        let mut run = run();
        let mut done = false;
        for stage in PIPELINE_STAGES {
            assert!(run.begin_stage(*stage, "t"));
            done = run.finish_stage(*stage, &ok(None), "t");
        }
        assert!(done);
        run.complete("t");
        assert_eq!(run.status, RunStatus::Done);
        assert!(run.status.is_terminal());
    }

    #[test]
    fn failed_stage_pauses_and_resumes_until_max_attempts() {
        let mut run = run();
        run.max_stage_attempts = 2;
        run.begin_stage(StudioStage::Plan, "t");
        let fail = StageOutcome {
            completed: false,
            cost_cents: None,
            output: None,
            error: Some("boom".to_owned()),
            fatal: false,
            in_progress: false,
        };
        assert!(!run.finish_stage(StudioStage::Plan, &fail, "t"));
        assert_eq!(run.status, RunStatus::Paused);
        // El stage vuelve a pending: se puede reintentar.
        assert_eq!(
            run.stage_record(StudioStage::Plan).unwrap().status,
            StageRecordStatus::Pending
        );
        run.resume("t");
        run.begin_stage(StudioStage::Plan, "t");
        assert!(!run.finish_stage(StudioStage::Plan, &fail, "t"));
        assert_eq!(run.status, RunStatus::Failed);
        assert_eq!(run.last_error.as_deref(), Some("boom"));
    }

    #[test]
    fn fatal_outcome_fails_immediately() {
        let mut run = run();
        run.begin_stage(StudioStage::Plan, "t");
        let fatal = StageOutcome {
            completed: false,
            cost_cents: None,
            output: None,
            error: Some("fatal".to_owned()),
            fatal: true,
            in_progress: false,
        };
        run.finish_stage(StudioStage::Plan, &fatal, "t");
        assert_eq!(run.status, RunStatus::Failed);
    }

    #[test]
    fn budget_blocks_spending_beyond_the_cap() {
        let mut run = run();
        assert!(run.budget_allows(1000));
        assert!(!run.budget_allows(1001));
        run.begin_stage(StudioStage::Plan, "t");
        run.finish_stage(StudioStage::Plan, &ok(Some(1000)), "t");
        assert_eq!(run.spent_cents, 1000);
        assert!(!run.budget_allows(1));
    }

    #[test]
    fn cancel_and_terminal_states() {
        let mut run = run();
        assert!(run.cancel("t"));
        assert_eq!(run.status, RunStatus::Cancelled);
        assert!(!run.cancel("t"));
        assert!(!run.resume("t"));
    }

    #[test]
    fn in_progress_keeps_the_stage_running_without_consuming_attempts() {
        let mut run = run();
        run.begin_stage(StudioStage::Plan, "t");
        let poll = StageOutcome {
            completed: false,
            cost_cents: None,
            output: Some(serde_json::json!({ "jobId": "j1" })),
            error: None,
            fatal: false,
            in_progress: true,
        };
        assert!(!run.finish_stage(StudioStage::Plan, &poll, "t"));
        assert_eq!(run.status, RunStatus::Running);
        let record = run.stage_record(StudioStage::Plan).unwrap();
        assert_eq!(record.status, StageRecordStatus::Running);
        assert_eq!(record.attempts, Some(1));
        assert_eq!(record.output, Some(serde_json::json!({ "jobId": "j1" })));
        // El próximo advance re-sondea la MISMA etapa sin sumar intento.
        assert!(run.begin_stage(StudioStage::Plan, "t"));
        assert_eq!(
            run.stage_record(StudioStage::Plan).unwrap().attempts,
            Some(1)
        );
        // Y puede cerrar después.
        run.finish_stage(StudioStage::Plan, &ok(None), "t");
        assert_eq!(
            run.stage_record(StudioStage::Plan).unwrap().status,
            StageRecordStatus::Done
        );
    }

    #[test]
    fn resume_re_pends_failed_stages_for_retry() {
        let mut run = run();
        run.begin_stage(StudioStage::Plan, "t");
        let fatal = StageOutcome {
            completed: false,
            cost_cents: None,
            output: None,
            error: Some("fatal".to_owned()),
            fatal: true,
            in_progress: false,
        };
        run.finish_stage(StudioStage::Plan, &fatal, "t");
        assert_eq!(run.status, RunStatus::Failed);
        run.resume("t");
        // La etapa fallida vuelve a pending: el resume reintenta desde ahí.
        assert_eq!(run.next_pending_stage(), Some(StudioStage::Plan));
        assert_eq!(
            run.stage_record(StudioStage::Plan).unwrap().status,
            StageRecordStatus::Pending
        );
    }

    #[test]
    fn skip_stage_moves_the_pipeline_forward() {
        let mut run = run();
        assert!(run.skip_stage(StudioStage::Acquire, "t"));
        assert_eq!(
            run.stage_record(StudioStage::Acquire).unwrap().status,
            StageRecordStatus::Skipped
        );
        // Plan sigue pendiente: no es la siguiente.
        assert_eq!(run.next_pending_stage(), Some(StudioStage::Plan));
    }
}
