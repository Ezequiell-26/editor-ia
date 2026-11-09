//! Regenerador local para re-adquisición de assets `generated-locally`.
//!
//! Despacha por `provider_id` (el `sourceId` que la etapa acquire grabó
//! en `resources[]`) a los generadores ffmpeg/SAPI existentes. Nunca
//! invoca providers remotos: re-generar un asset remoto re-gastaría
//! presupuesto BYOK y la re-adquisición lo excluye por diseño.

use std::path::{Path, PathBuf};

use crate::application::studio_reacquire::LocalRegenerator;
use crate::ports::studio::{ContentGenerator, GenerationRequest, GenerationResult};
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub struct LocalAssetRegenerator {
    ffmpeg: Option<PathBuf>,
}

impl LocalAssetRegenerator {
    /// `ffmpeg` explícito; los generadores caen a `EDITOR_IA_FFMPEG`/PATH
    /// si es `None` (mismo contrato que en `project_executor`).
    pub fn new(ffmpeg: Option<PathBuf>) -> Self {
        Self { ffmpeg }
    }
}

impl LocalRegenerator for LocalAssetRegenerator {
    fn regenerate(
        &self,
        provider_id: &str,
        request: &GenerationRequest,
        project_root: &Path,
    ) -> Result<GenerationResult, ProjectError> {
        match provider_id {
            "windows-sapi" => {
                crate::infrastructure::studio::local_voice::LocalVoiceGenerator::new()
                    .generate(request, project_root)
            }
            "local-ffmpeg-ambient" => {
                crate::infrastructure::studio::local_music::LocalMusicGenerator::new(
                    self.ffmpeg.clone(),
                )
                .generate(request, project_root)
            }
            "local-ffmpeg-titlecard" => {
                crate::infrastructure::studio::local_titlecard::LocalTitleCardGenerator::new(
                    self.ffmpeg.clone(),
                )
                .generate(request, project_root)
            }
            "local-ffmpeg-pattern" => {
                crate::infrastructure::studio::local_pattern::LocalPatternGenerator::new(
                    self.ffmpeg.clone(),
                )
                .generate(request, project_root)
            }
            other => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("provider '{other}' no es re-generable localmente"),
            )),
        }
    }
}
