//! `ContentGenerator` local de imágenes: tarjetas de título con texto.
//!
//! Genera un PNG con ffmpeg (`color` + `drawtext`) para requisitos
//! `image` cuyo query empieza con `title:` o `card:` — la convención
//! explícita que distingue "quiero una tarjeta con este texto" de "quiero
//! una foto de X" (que debe venir de biblioteca o de un provider externo
//! con licencia real). Coste 0, sin red, licencia `user-generated`.
//!
//! Límite honesto: el texto se dibuja con la fuente por defecto de
//! ffmpeg/fontconfig; glifos fuera de esa fuente pueden salir mal.

use std::path::{Path, PathBuf};

use crate::ports::studio::{
    ContentGenerator, GenerationCapability, GenerationRequest, GenerationResult, ResourceLicense,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

const PROVIDER_ID: &str = "local-ffmpeg-titlecard";
const MODEL: &str = "drawtext";

/// Prefijos que marcan un requisito `image` como tarjeta de título.
pub const TITLE_PREFIXES: [&str; 2] = ["title:", "card:"];

/// Devuelve el texto de la tarjeta si el query usa la convención
/// `title:`/`card:`; `None` para cualquier otra cosa.
pub fn title_card_text(query: &str) -> Option<String> {
    let trimmed = query.trim();
    for prefix in TITLE_PREFIXES {
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

/// Escapa el texto para `drawtext=text='...'`: backslash y los caracteres
/// con significado en el filtergraph (`'`, `%`, `{`, `}`, `,`, `;`, `:`,
/// `[`, `]`) se prefijan con `\`; saltos de línea → espacio.
fn escape_drawtext(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        match c {
            '\n' | '\r' | '\t' => out.push(' '),
            '\\' | '\'' | '%' | '{' | '}' | ',' | ';' | ':' | '[' | ']' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

pub struct LocalTitleCardGenerator {
    ffmpeg: Option<PathBuf>,
}

impl LocalTitleCardGenerator {
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

impl ContentGenerator for LocalTitleCardGenerator {
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
                "sólo texto (convención title:/card:)".to_owned(),
                "PNG 1280x720 fondo sólido".to_owned(),
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
                "LocalTitleCardGenerator sólo genera imágenes",
            ));
        }
        let Some(ffmpeg) = &self.ffmpeg else {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "ffmpeg no está disponible para generar la tarjeta",
            ));
        };
        let text = title_card_text(&request.prompt).ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el generador de tarjetas exige el prefijo title: o card: en el prompt",
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
        let output = dir.join(format!("tarjeta-{safe_id}.png"));
        let escaped = escape_drawtext(&text);
        let filter = format!(
            "drawtext=text='{escaped}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2"
        );
        let status = std::process::Command::new(ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x14213d:size=1280x720",
                "-vf",
                &filter,
                "-frames:v",
                "1",
            ])
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
                "ffmpeg no pudo generar la tarjeta (¿fuente drawtext disponible?)",
            ));
        }
        let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        let relative = format!("media/generated/tarjeta-{safe_id}.png");
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
    fn title_card_text_requires_the_prefix() {
        assert_eq!(
            title_card_text("title:Hola mundo").as_deref(),
            Some("Hola mundo")
        );
        assert_eq!(
            title_card_text("CARD:  Cierre  ").as_deref(),
            Some("Cierre")
        );
        assert_eq!(title_card_text("foto de un perro"), None);
        assert_eq!(title_card_text("title:"), None);
    }

    #[test]
    fn rejects_non_image_kinds_and_unprefixed_prompts() {
        let generator = LocalTitleCardGenerator::new(None);
        let dir = std::env::temp_dir().join("editoria-card-test");
        let err = generator
            .generate(&request(StudioResourceKind::Video, "title:x"), &dir)
            .unwrap_err();
        assert!(err.message.contains("imágenes"));
        let err = generator
            .generate(&request(StudioResourceKind::Image, "sin prefijo"), &dir)
            .unwrap_err();
        assert!(err.message.contains("title:"));
    }

    #[test]
    fn capabilities_declare_image_at_zero_cost() {
        let generator = LocalTitleCardGenerator::new(None);
        let caps = generator.capabilities();
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].kind, StudioResourceKind::Image);
        assert_eq!(caps[0].estimated_cost_cents, Some(0));
        assert!(!caps[0].requires_network);
    }

    #[test]
    #[ignore = "requiere ffmpeg con drawtext; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_generate_writes_a_real_png() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let dir = std::env::temp_dir().join(format!("editoria-card-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let generator = LocalTitleCardGenerator::new(None);
        assert!(generator.ffmpeg.is_some(), "ffmpeg no disponible");
        let result = generator
            .generate(
                &request(StudioResourceKind::Image, "title:Apertura E2E"),
                &dir,
            )
            .expect("ffmpeg debería generar el PNG");
        assert_eq!(result.provider, PROVIDER_ID);
        let png = dir.join(&result.path);
        assert!(png.is_file(), "el PNG generado no existe: {png:?}");
        let header = std::fs::read(&png).unwrap();
        assert_eq!(&header[0..8], b"\x89PNG\r\n\x1a\n", "no es un PNG");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
