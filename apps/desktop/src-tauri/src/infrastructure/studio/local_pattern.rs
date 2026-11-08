//! `ContentGenerator` local de imágenes sin texto: patrones y texturas.
//!
//! Genera un PNG con ffmpeg (fuentes lavfi `gradients`, `mandelbrot`,
//! `cellauto`, `testsrc2`) para requisitos `image` cuyo query empieza con
//! `pattern:`, `gradient:` o `texture:` — la convención explícita que
//! distingue "quiero un fondo/patrón generado" de "quiero una foto de X"
//! (que debe venir de biblioteca o de un provider externo con licencia
//! real). Coste 0, sin red, licencia `user-generated`.
//!
//! Límite honesto: son fuentes de test/degradados sintéticos, no arte
//! generado semánticamente. Sirven de fondo, placeholder honesto o capa
//! de textura — no sustituyen fotografía.

use std::path::{Path, PathBuf};

use crate::ports::studio::{
    ContentGenerator, GenerationCapability, GenerationRequest, GenerationResult, ResourceLicense,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

const PROVIDER_ID: &str = "local-ffmpeg-pattern";
const MODEL: &str = "lavfi-sources";

/// Prefijos que marcan un requisito `image` como patrón/textura generada.
pub const PATTERN_PREFIXES: [&str; 3] = ["pattern:", "gradient:", "texture:"];

/// Devuelve el motivo si el query usa la convención `pattern:`/
/// `gradient:`/`texture:`; `None` para cualquier otra cosa.
pub fn pattern_prompt(query: &str) -> Option<String> {
    let trimmed = query.trim();
    for prefix in PATTERN_PREFIXES {
        if let Some(rest) = trimmed
            .get(..prefix.len())
            .filter(|head| head.eq_ignore_ascii_case(prefix))
            .and_then(|_| trimmed.get(prefix.len()..))
        {
            let text = rest.trim();
            if !text.is_empty() {
                return Some(text.to_owned());
            }
        }
    }
    None
}

/// Elige la fuente lavfi según el motivo del prompt. Devuelve el `-i`
/// completo (sin comillas externas: va como argumento único).
fn lavfi_source(prompt: &str) -> &'static str {
    let p = prompt.to_lowercase();
    if p.contains("fractal") || p.contains("mandelbrot") {
        "mandelbrot=size=1280x720:rate=25:duration=1"
    } else if p.contains("celular") || p.contains("cellular") || p.contains("autómata") {
        "cellauto=size=1280x720:rate=25:duration=1"
    } else if p.contains("barras") || p.contains("test") {
        "testsrc2=size=1280x720:rate=25:duration=1"
    } else {
        // Default: degradado animado, primer frame.
        "gradients=size=1280x720:rate=25:duration=1:speed=0.02"
    }
}

pub struct LocalPatternGenerator {
    ffmpeg: Option<PathBuf>,
}

impl LocalPatternGenerator {
    /// `ffmpeg` explícito, `EDITOR_IA_FFMPEG` o resolución por PATH.
    pub fn new(ffmpeg: Option<PathBuf>) -> Self {
        let ffmpeg = ffmpeg.or_else(|| {
            std::env::var_os("EDITOR_IA_FFMPEG")
                .map(PathBuf::from)
                .filter(|p| p.is_file())
                .or_else(|| {
                    ["ffmpeg", "ffmpeg.exe"]
                        .iter()
                        .map(PathBuf::from)
                        .find(|p| which_exists(p))
                })
        });
        Self { ffmpeg }
    }
}

fn which_exists(name: &Path) -> bool {
    if name.components().count() > 1 {
        return name.is_file();
    }
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(name).is_file()))
        == Some(true)
}

impl ContentGenerator for LocalPatternGenerator {
    fn provider_id(&self) -> &str {
        PROVIDER_ID
    }

    fn capabilities(&self) -> Vec<GenerationCapability> {
        vec![GenerationCapability {
            provider: PROVIDER_ID.to_owned(),
            model: MODEL.to_owned(),
            kind: StudioResourceKind::Image,
            estimated_cost_cents: Some(0),
            limits: vec![
                "sólo patrones (convención pattern:/gradient:/texture:)".to_owned(),
                "PNG 1280x720 de fuentes lavfi sintéticas".to_owned(),
            ],
            requires_network: false,
        }]
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        project_root: &Path,
    ) -> Result<GenerationResult, ProjectError> {
        if request.kind != StudioResourceKind::Image {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "LocalPatternGenerator sólo genera imágenes",
            ));
        }
        let Some(ffmpeg) = &self.ffmpeg else {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "ffmpeg no está disponible para generar el patrón",
            ));
        };
        let prompt = pattern_prompt(&request.prompt).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el generador de patrones exige el prefijo pattern:, gradient: o texture:",
            )
        })?;
        let dir = project_root.join("media").join("generated");
        std::fs::create_dir_all(&dir).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("no se pudo crear media/generated: {e}"),
            )
        })?;
        let safe_id: String = request
            .request_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .take(60)
            .collect();
        let output = dir.join(format!("patron-{safe_id}.png"));
        let source = lavfi_source(&prompt);
        let status = std::process::Command::new(ffmpeg)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", source])
            .args(["-frames:v", "1"])
            .arg(&output)
            .status()
            .map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("ffmpeg no se pudo ejecutar: {e}"),
                )
            })?;
        if !status.success() || !output.is_file() {
            let _ = std::fs::remove_file(&output);
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "ffmpeg no pudo generar el patrón",
            ));
        }
        let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        let relative = format!("media/generated/patron-{safe_id}.png");
        Ok(GenerationResult {
            path: relative,
            bytes,
            provider: PROVIDER_ID.to_owned(),
            model: MODEL.to_owned(),
            cost_cents: Some(0),
            license: Some(ResourceLicense {
                id: "user-generated".to_owned(),
                commercial_use: CommercialUseRequirement::Allowed,
                url: None,
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: StudioResourceKind, prompt: &str) -> GenerationRequest {
        GenerationRequest {
            request_id: "test-req".to_owned(),
            kind,
            prompt: prompt.to_owned(),
            duration_seconds: None,
            voice: None,
            params: serde_json::json!({}),
        }
    }

    #[test]
    fn pattern_prompt_requires_the_prefix() {
        assert_eq!(pattern_prompt("pattern:fondo").as_deref(), Some("fondo"));
        assert_eq!(
            pattern_prompt("GRADIENT:  suave  ").as_deref(),
            Some("suave")
        );
        assert_eq!(pattern_prompt("texture:ruido"), Some("ruido".to_owned()));
        assert_eq!(pattern_prompt("foto de un perro"), None);
        assert_eq!(pattern_prompt("pattern:"), None);
    }

    #[test]
    fn lavfi_source_matches_the_prompt_keyword() {
        assert!(lavfi_source("fractal").starts_with("mandelbrot"));
        assert!(lavfi_source("celular").starts_with("cellauto"));
        assert!(lavfi_source("barras de test").starts_with("testsrc2"));
        assert!(lavfi_source("cualquier otra cosa").starts_with("gradients"));
    }

    #[test]
    fn rejects_non_image_kinds_and_unprefixed_prompts() {
        let generator = LocalPatternGenerator::new(None);
        let dir = std::env::temp_dir().join("editoria-pattern-test");
        let err = generator
            .generate(&request(StudioResourceKind::Video, "pattern:x"), &dir)
            .unwrap_err();
        assert!(err.message.contains("imágenes"));
        let err = generator
            .generate(&request(StudioResourceKind::Image, "sin prefijo"), &dir)
            .unwrap_err();
        assert!(err.message.contains("pattern:"));
    }

    #[test]
    #[ignore = "requiere ffmpeg con fuentes lavfi; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_generate_writes_a_real_png() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let dir =
            std::env::temp_dir().join(format!("editoria-pattern-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let generator = LocalPatternGenerator::new(None);
        assert!(generator.ffmpeg.is_some(), "ffmpeg no disponible");
        let result = generator
            .generate(&request(StudioResourceKind::Image, "gradient:suave"), &dir)
            .expect("ffmpeg debería generar el PNG");
        assert_eq!(result.provider, PROVIDER_ID);
        let png = dir.join(&result.path);
        assert!(png.is_file(), "el PNG generado no existe: {png:?}");
        let header = std::fs::read(&png).unwrap();
        assert_eq!(&header[0..8], b"\x89PNG\r\n\x1a\n", "no es un PNG");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
