//! `ContentGenerator` local: narración con la voz SAPI de Windows.
//!
//! Es el mismo mecanismo que `commands::domains::audio::narration` (script
//! System.Speech por PowerShell), expuesto como puerto del estudio para que
//! `acquire` pueda satisfacer requisitos `voice`/`audio` de narración sin
//! proveedor externo. Sólo corre en Windows con PowerShell disponible; en
//! otro caso `generate` devuelve error honesto.

use std::path::{Path, PathBuf};

use crate::ports::studio::{
    ContentGenerator, GenerationCapability, GenerationRequest, GenerationResult, ResourceLicense,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{CommercialUseRequirement, StudioResourceKind};

const PROVIDER_ID: &str = "windows-sapi";
const MODEL: &str = "system-speech";

const TTS_SCRIPT: &str = r#"Add-Type -AssemblyName System.Speech
$text = [Console]::In.ReadToEnd()
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $env:EDITORIA_TTS_VOICE
if ($voice) { $synth.SelectVoice($voice) }
$synth.SetOutputToWaveFile($env:EDITORIA_TTS_OUT)
$synth.Speak($text)
$synth.Dispose()
"#;

pub struct LocalVoiceGenerator {
    powershell: Option<PathBuf>,
}

impl LocalVoiceGenerator {
    /// `powershell` explícito o resolución por PATH; `None` si no hay.
    pub fn new() -> Self {
        let powershell = ["powershell.exe", "powershell"]
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_absolute() || which_exists(p));
        Self { powershell }
    }

    fn synthesize(
        &self,
        text: &str,
        voice: Option<&str>,
        output: &Path,
    ) -> Result<(), ProjectError> {
        let Some(ps) = &self.powershell else {
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "PowerShell no está disponible para la voz local",
            ));
        };
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el texto para la voz está vacío",
            ));
        }
        let mut command = std::process::Command::new(ps);
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                TTS_SCRIPT,
            ])
            .env("EDITORIA_TTS_OUT", output.to_string_lossy().as_ref())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped());
        if let Some(voice) = voice {
            command.env("EDITORIA_TTS_VOICE", voice);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn().map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("PowerShell no se pudo iniciar: {e}"),
            )
        })?;
        use std::io::Write;
        if let Some(mut handle) = child.stdin.take() {
            handle.write_all(trimmed.as_bytes()).map_err(|e| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    &format!("no se pudo enviar el texto: {e}"),
                )
            })?;
        }
        let out = child.wait_with_output().map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::Io,
                &format!("el sintetizador no terminó: {e}"),
            )
        })?;
        if !out.status.success() {
            let _ = std::fs::remove_file(output);
            return Err(ProjectError::message(
                ProjectErrorCode::Io,
                "la voz local de Windows no pudo generar el audio",
            ));
        }
        if !output.is_file() {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el sintetizador terminó sin escribir el archivo de voz",
            ));
        }
        Ok(())
    }
}

fn which_exists(name: &Path) -> bool {
    // Resolución mínima por PATH: `where` no es portable en tests; usamos
    // la búsqueda estándar de Windows.
    if name.components().count() > 1 {
        return name.is_file();
    }
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(name).is_file()))
        == Some(true)
}

impl ContentGenerator for LocalVoiceGenerator {
    fn provider_id(&self) -> &str {
        PROVIDER_ID
    }

    fn capabilities(&self) -> Vec<GenerationCapability> {
        vec![GenerationCapability {
            provider: PROVIDER_ID.to_owned(),
            model: MODEL.to_owned(),
            kind: StudioResourceKind::Voice,
            estimated_cost_cents: Some(0),
            limits: vec!["texto libre por stdin".to_owned()],
            requires_network: false,
        }]
    }

    fn generate(
        &self,
        request: &GenerationRequest,
        project_root: &Path,
    ) -> Result<GenerationResult, ProjectError> {
        if request.kind != StudioResourceKind::Voice && request.kind != StudioResourceKind::Audio {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "LocalVoiceGenerator sólo genera voz/audio narrado",
            ));
        }
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
        let output = dir.join(format!("narracion-{safe_id}.wav"));
        self.synthesize(&request.prompt, request.voice.as_deref(), &output)?;
        let bytes = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
        let relative = format!("media/generated/narracion-{safe_id}.wav");
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
    use crate::ports::studio::GenerationCapability;

    fn request(kind: StudioResourceKind) -> GenerationRequest {
        GenerationRequest {
            request_id: "test-req".to_owned(),
            kind,
            prompt: "hola".to_owned(),
            duration_seconds: None,
            voice: None,
            params: serde_json::json!({}),
        }
    }

    #[test]
    fn rejects_non_voice_kinds_before_touching_powershell() {
        let generator = LocalVoiceGenerator::new();
        let dir = std::env::temp_dir().join("editoria-voice-test");
        let err = generator
            .generate(&request(StudioResourceKind::Video), &dir)
            .unwrap_err();
        assert!(err.message.contains("voz/audio"));
        let err = generator
            .generate(&request(StudioResourceKind::Image), &dir)
            .unwrap_err();
        assert!(err.message.contains("voz/audio"));
    }

    #[test]
    fn capabilities_declare_voice_at_zero_cost() {
        let generator = LocalVoiceGenerator::new();
        let caps: Vec<GenerationCapability> = generator.capabilities();
        assert_eq!(caps.len(), 1);
        assert_eq!(caps[0].kind, StudioResourceKind::Voice);
        assert_eq!(caps[0].estimated_cost_cents, Some(0));
        assert!(!caps[0].requires_network);
        assert_eq!(generator.provider_id(), "windows-sapi");
    }

    #[test]
    #[ignore = "requiere Windows SAPI; correr con EDITOR_IA_RUN_LIVE_TESTS=1"]
    fn live_synthesize_writes_a_real_wav() {
        if std::env::var("EDITOR_IA_RUN_LIVE_TESTS").ok().as_deref() != Some("1") {
            return;
        }
        let dir =
            std::env::temp_dir().join(format!("editoria-voice-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let generator = LocalVoiceGenerator::new();
        assert!(
            generator.powershell.is_some(),
            "PowerShell no está disponible en esta máquina"
        );
        let result = generator
            .generate(&request(StudioResourceKind::Voice), &dir)
            .expect("SAPI debería sintetizar el WAV");
        assert_eq!(result.provider, "windows-sapi");
        assert_eq!(result.cost_cents, Some(0));
        assert_eq!(
            result.license.as_ref().map(|l| l.commercial_use),
            Some(CommercialUseRequirement::Allowed)
        );
        let wav = dir.join(&result.path);
        assert!(wav.is_file(), "el WAV generado no existe: {wav:?}");
        assert!(result.bytes > 44, "WAV sospechosamente vacío");
        let header = std::fs::read(&wav).unwrap();
        assert_eq!(&header[0..4], b"RIFF");
        assert_eq!(&header[8..12], b"WAVE");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
