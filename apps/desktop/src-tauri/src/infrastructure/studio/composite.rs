//! Enruta cada etapa del pipeline al `StageExecutor` que la implementa.
//!
//! Es el ejecutor que `AppState` inyecta en `production_advance`: combina
//! `ProjectStageExecutor` (plan/acquire/analyze) y `AssemblyStageExecutor`
//! (scenes/edit). Cuando lleguen los executors de render/review/deliver se
//! agregan aquí sin tocar el orquestador.

use crate::infrastructure::studio::assembly_executor::AssemblyStageExecutor;
use crate::infrastructure::studio::project_executor::ProjectStageExecutor;
use crate::ports::studio::{StageContext, StageExecutor};
use crate::projects::service::ProjectError;
use crate::studio::plan::StudioStage;
use crate::studio::run::StageOutcome;

/// Enruta cada etapa al primer ejecutor que la soporta: los built-in
/// (`project`, `assembly`) más los `extra` prestados por el comando
/// (render/review/deliver necesitan `RenderDeps` con sesión y tools del
/// `AppState`, así que llegan por referencia con lifetime).
pub struct CompositeStageExecutor<'a> {
    project: ProjectStageExecutor,
    assembly: AssemblyStageExecutor,
    extra: Vec<&'a dyn StageExecutor>,
}

impl<'a> CompositeStageExecutor<'a> {
    pub fn new(ffprobe: Option<std::path::PathBuf>) -> Self {
        Self {
            project: ProjectStageExecutor::new(ffprobe),
            assembly: AssemblyStageExecutor::new(),
            extra: Vec::new(),
        }
    }

    /// Propaga ffmpeg al ejecutor de proyecto (thumbnails en `analyze`).
    pub fn with_ffmpeg(self, ffmpeg: Option<std::path::PathBuf>) -> Self {
        Self {
            project: self.project.with_ffmpeg(ffmpeg),
            assembly: self.assembly,
            extra: self.extra,
        }
    }

    /// Propaga el generador remoto de imágenes BYOK al ejecutor de
    /// proyecto (requisitos `image` con convención `gen:`).
    pub fn with_remote_image(
        self,
        generator: Option<crate::infrastructure::studio::remote_image::RemoteImageGenerator>,
    ) -> Self {
        Self {
            project: self.project.with_remote_image(generator),
            assembly: self.assembly,
            extra: self.extra,
        }
    }

    /// Propaga el generador remoto de voz BYOK al ejecutor de proyecto
    /// (requisitos `voice` con convención `remote:` en `req.voice`).
    pub fn with_remote_voice(
        self,
        generator: Option<crate::infrastructure::studio::remote_voice::RemoteVoiceGenerator>,
    ) -> Self {
        Self {
            project: self.project.with_remote_voice(generator),
            assembly: self.assembly,
            extra: self.extra,
        }
    }

    /// Agrega un ejecutor extra (se consulta después de los built-in).
    /// El lifetime del resultado es el más corto entre el del composite y
    /// el del extra prestado.
    pub fn with_extra<'b>(self, executor: &'b dyn StageExecutor) -> CompositeStageExecutor<'b>
    where
        'a: 'b,
    {
        let mut extra: Vec<&'b dyn StageExecutor> = self
            .extra
            .into_iter()
            .map(|e| e as &'b dyn StageExecutor)
            .collect();
        extra.push(executor);
        CompositeStageExecutor {
            project: self.project,
            assembly: self.assembly,
            extra,
        }
    }

    fn for_stage(&self, stage: StudioStage) -> Option<&dyn StageExecutor> {
        if self.project.supported_stages().contains(&stage) {
            Some(&self.project)
        } else if self.assembly.supported_stages().contains(&stage) {
            Some(&self.assembly)
        } else {
            self.extra
                .iter()
                .find(|executor| executor.supported_stages().contains(&stage))
                .copied()
        }
    }
}

impl<'a> StageExecutor for CompositeStageExecutor<'a> {
    fn supported_stages(&self) -> Vec<StudioStage> {
        let mut stages = self.project.supported_stages();
        stages.extend(self.assembly.supported_stages());
        for executor in &self.extra {
            stages.extend(executor.supported_stages());
        }
        stages
    }

    fn execute(
        &self,
        stage: StudioStage,
        ctx: &StageContext,
    ) -> Result<StageOutcome, ProjectError> {
        match self.for_stage(stage) {
            Some(executor) => executor.execute(stage, ctx),
            None => Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some(format!("la etapa {stage:?} no tiene ejecutor real todavía")),
                fatal: true,
                in_progress: false,
            }),
        }
    }
}
