//! `ContentGenerator` local de música: cama ambiental sintetizada con
//! ffmpeg (capas de senos + lowpass + fades → MP3).
//!
//! Se activa con la convención explícita `music:`/`ambient:`/`pad:` en el
//! query del requisito `music` — no pretende ser música compuesta ni
//! reemplaza material con licencia real; es un fondo armónico neutro,
//! coste 0 y sin red, para planes que piden música y no hay biblioteca.
//!
//! Límite honesto: el resultado es un pad de acordes sostenidos, no un
//! tema musical con estructura.

use std::path::{Path, PathBuf};

use crate::ports::studio::{
    ContentGenerator, GenerationCapability, GenerationRequest, GenerationResult, ResourceLicense,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

const PROVIDER_ID: &str = "local-ffmpeg-ambient";
const MODEL: &str = "sine-pad";
const DEFAULT_SECONDS: f64 = 30.0;

/// Prefijos que marcan un requisito `music` como generación local.
pub const MUSIC_PREFIXES: [&str; 3] = ["music:", "ambient:", "pad:"];

/// Devuelve `true` si el query usa la convención de música generada.
pub fn is_music_prompt(query: &str) -> bool {
    let trimmed = query.trim();
    MUSIC_PREFIXES
        .iter()
        .any(|p| trimmed.len() > p.len() && trimmed[..p.len()].eq_ignore_ascii_case(p))
}

pub struct LocalMusicGenerator {
    ffmpeg: Option<PathBuf>,
}

impl LocalMusicGenerator {
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

impl ContentGenerator for LocalMusicGenerator {
    fn provider_id(&self) -> &str {
        PROVIDER_ID
    }

    fn capabilities(&self) -> Vec<GenerationCapability> {
        vec![GenerationCapability {
            provider: PROVIDER_ID.to_owned(),
            model: MODEL.to_owned(),
            kind: StudioResourceKind::Music,
            estimated_cost_cents: Some(0),
            limits: vec![
                "pad ambiental de senos (no es un tema musical)".to_owned(),
                "MP3 ~30 s por defecto".to_owned(),
            ],
            requires_network: false,
        }]
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        project_root: &Path,
    ) -> Result<GenerationResult, ProjectError> {
        if request.kind != StudioResourceKind::Music {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "LocalMusicGenerator sólo genera música",
            ));
        }
        if !is_music_prompt(&request.prompt) {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el generador de música exige el prefijo music:/ambient:/pad:",
            ));
        }
        let Some(ffmpeg) = &self.ffmpeg else {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "ffmpeg no está disponible para generar la música",
            ));
        };
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
        let seconds = request
            .duration_seconds
            .unwrap_or(DEFAULT_SECONDS)
            .clamp(5.0, 300.0);
        let output = dir.join(format!("musica-{safe_id}.mp3"));
        // Acorde de La mayor (La2, Mi3, La3, Do#4) en senos suaves,
        // mezclados, con lowpass y fades de entrada/salida.
        let fade_out_start = (seconds - 2.0).max(0.0);
        let filter = format!(
            "[0:a][1:a][2:a][3:a]amix=inputs=4:normalize=0,lowpass=f=900,volume=0.22,afade=t=in:d=2,afade=t=out:st={fade_out_start}:d=2[a]"
        );
        let status = std::process::Command::new(ffmpeg)
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=110:duration={seconds}:sample_rate=44100"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=164.81:duration={seconds}:sample_rate=44100"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=220:duration={seconds}:sample_rate=44100"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=frequency=277.18:duration={seconds}:sample_rate=44100"),
                "-filter_complex",
                &filter,
                "-map",
                "[a]",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "6",
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
                "ffmpeg no pudo generar la música (¿libmp3lame disponible?)",
            ));
        }
        let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        let relative = format!("media/generated/musica-{safe_id}.mp3");
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
    fn is_music_prompt_requires_the_prefix() {
        assert!(is_music_prompt("music:ambient"));
        assert!(is_music_prompt("Ambient: chill"));
        assert!(is_music_prompt("pad: relax"));
        assert!(!is_music_prompt("lofi beats"));
        assert!(!is_music_prompt("music:"));
    }

    #[test]
    fn rejects_non_music_kinds_and_unprefixed_prompts() {
        let generator = LocalMusicGenerator::new(None);
        let dir = std::env::temp_dir().join("editoria-music-test");
        let err = generator
            .generate(&request(StudioResourceKind::Voice, "music:x"), &dir)
            .unwrap_err();
        assert!(err.message.contains("música"));
        let err = generator
            .generate(&request(StudioResourceKind::Music, "sin prefijo"), &dir)
            .unwrap_err();
        assert!(err.message.contains("music:"));
    }

    #[test]
    fn capabilities_declare_music_at_zero_cost() {
        let generator = LocalMusicGenerator::new(None);
        let caps = generator.capabilities();
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].kind, StudioResourceKind::Music);
        assert_eq!(caps[0].estimated_cost_cents, Some(0));
        assert!(!caps[0].requires_network);
    }

    #[test]
    #[ignore = "requiere ffmpeg con libmp3lame; correr con EDITOR_IA_RUN_RENDER_TESTS=1"]
    fn live_generate_writes_a_real_mp3() {
        if std::env::var("EDITOR_IA_RUN_RENDER_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let dir =
            std::env::temp_dir().join(format!("editoria-music-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let generator = LocalMusicGenerator::new(None);
        assert!(generator.ffmpeg.is_some(), "ffmpeg no disponible");
        let mut req = request(StudioResourceKind::Music, "music:ambient");
        req.duration_seconds = Some(6.0);
        let result = generator
            .generate(&req, &dir)
            .expect("ffmpeg debería generar el MP3");
        assert_eq!(result.provider, PROVIDER_ID);
        let mp3 = dir.join(&result.path);
        assert!(mp3.is_file(), "el MP3 generado no existe: {mp3:?}");
        assert!(result.bytes > 10_000, "MP3 sospechosamente vacío");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
