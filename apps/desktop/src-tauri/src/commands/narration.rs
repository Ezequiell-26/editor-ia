//! Local narration with the Windows speech synthesizer.
//!
//! This is the free-first path: no API key and no network. The script is fixed
//! and lives in the app cache; the narration text travels through stdin, never
//! through a command line, so model or user text cannot become a shell command.
//! Generated audio is imported as an asset with measured metadata and an
//! unresolved licence until the user declares its rights.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::commands::system::resolve_tools;
use crate::media::{probe_file, sha256_file, MediaKind};
use crate::projects::service::{now_rfc3339, ProjectError, ProjectErrorCode};
use crate::state::AppState;

const TTS_SCRIPT: &str = r#"Add-Type -AssemblyName System.Speech
$ErrorActionPreference = 'Stop'
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:EDITORIA_TTS_VOICE) { $synth.SelectVoice($env:EDITORIA_TTS_VOICE) }
$synth.SetOutputToWaveFile($env:EDITORIA_TTS_OUT)
$text = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($text)) { throw 'empty narration' }
$synth.Speak($text)
$synth.Dispose()
"#;

const VOICES_SCRIPT: &str = r#"Add-Type -AssemblyName System.Speech
$ErrorActionPreference = 'Stop'
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($synth.GetInstalledVoices() | ForEach-Object {
  $info = $_.VoiceInfo
  [pscustomobject]@{ name = $info.Name; culture = $info.Culture.Name; gender = $info.Gender.ToString() }
})
$synth.Dispose()
ConvertTo-Json -InputObject $voices -Compress
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    /// Provider-specific identifier. For SAPI it is the installed voice name.
    pub id: String,
    pub name: String,
    pub culture: String,
    pub gender: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrationResult {
    pub asset: Value,
    pub voice: String,
    pub provider: String,
}

// La paleta de comandos vive en `commands::hide_console`; acá se reexporta con
// el nombre local que ya usaba el módulo.
use crate::commands::hide_console;

fn run_powershell(
    powershell: &Path,
    script: &str,
    envs: &[(&str, &str)],
    stdin: Option<&str>,
) -> Result<String, ProjectError> {
    let mut command = Command::new(powershell);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in envs {
        command.env(key, value);
    }
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "Windows PowerShell no se pudo iniciar para la narración local",
        )
    })?;
    if let Some(text) = stdin {
        if let Some(mut handle) = child.stdin.take() {
            handle.write_all(text.as_bytes()).map_err(|_| {
                ProjectError::message(
                    ProjectErrorCode::Io,
                    "no se pudo enviar el texto al sintetizador",
                )
            })?;
        }
    }
    let output = child.wait_with_output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "el sintetizador local no terminó correctamente",
        )
    })?;
    if !output.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "la voz local de Windows no pudo generar el audio; probá otra voz en Ajustes",
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_voices(raw: &str) -> Vec<VoiceInfo> {
    let value: Value = match serde_json::from_str(raw.trim()) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let entries = match value {
        Value::Array(values) => values,
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    };
    entries
        .into_iter()
        .filter_map(|entry| {
            let name = entry["name"].as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(VoiceInfo {
                id: name.to_owned(),
                name: name.to_owned(),
                culture: entry["culture"].as_str().unwrap_or("").to_owned(),
                gender: entry["gender"].as_str().unwrap_or("").to_owned(),
            })
        })
        .take(100)
        .collect()
}

/// Sintetiza texto a WAV con la voz SAPI indicada y valida que el archivo
/// exista. La usan la narración y el doblaje; el texto viaja por stdin.
pub(crate) fn synthesize_sapi_wav(
    powershell: &Path,
    text: &str,
    voice: &str,
    output: &Path,
) -> Result<(), ProjectError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el texto para la voz está vacío",
        ));
    }
    let output_text = output.to_string_lossy().into_owned();
    let result = run_powershell(
        powershell,
        TTS_SCRIPT,
        &[
            ("EDITORIA_TTS_OUT", &output_text),
            ("EDITORIA_TTS_VOICE", voice),
        ],
        Some(trimmed),
    );
    if let Err(error) = result {
        let _ = std::fs::remove_file(output);
        return Err(error);
    }
    if !output.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el sintetizador terminó sin escribir el archivo de voz",
        ));
    }
    Ok(())
}

pub(crate) async fn sapi_voices(state: &AppState) -> Result<Vec<VoiceInfo>, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (_, _, powershell) = resolve_tools(&settings);
    let Some(powershell) = powershell else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "Windows PowerShell no está disponible para enumerar las voces",
        ));
    };
    let raw = run_powershell(&powershell, VOICES_SCRIPT, &[], None)?;
    Ok(parse_voices(&raw))
}

#[tauri::command]
pub async fn list_voices(state: State<'_, AppState>) -> Result<Vec<VoiceInfo>, ProjectError> {
    let settings = state.settings_snapshot()?;
    match settings.audio_provider.kind.as_str() {
        "elevenlabs" => crate::commands::audio_providers::list_elevenlabs_voices(&state).await,
        "external-web" => Ok(Vec::new()),
        _ => sapi_voices(&state).await,
    }
}

#[tauri::command]
pub async fn synthesize_narration(
    state: State<'_, AppState>,
    text: String,
    voice: Option<String>,
    fps_num: u32,
    fps_den: u32,
    provider: Option<String>,
) -> Result<NarrationResult, ProjectError> {
    let settings = state.settings_snapshot()?;
    let forced_local = provider.as_deref() == Some("windows-sapi");
    if !forced_local {
        match settings.audio_provider.kind.as_str() {
            "elevenlabs" => {
                return crate::commands::audio_providers::synthesize_elevenlabs(
                    &state, text, voice, fps_num, fps_den,
                )
                .await;
            }
            "external-web" => {
                return Err(ProjectError::message(
                    ProjectErrorCode::ProviderUnavailable,
                    "el proveedor de audio externo es manual: abrí la web en Ajustes, generá el audio, descargalo e importalo desde Medios",
                ));
            }
            _ => {}
        }
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la narración está vacía",
        ));
    }
    if trimmed.chars().count() > 4_000 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la narración supera los 4000 caracteres",
        ));
    }
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, powershell) = resolve_tools(&settings);
    let Some(powershell) = powershell else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "Windows PowerShell no está disponible para la narración local",
        ));
    };
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "ffprobe no está disponible para medir la narración generada",
        ));
    };

    let media_dir = session.root.join("media");
    std::fs::create_dir_all(&media_dir).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo crear la carpeta media del proyecto",
        )
    })?;
    let output = media_dir.join(format!("narracion-{}.wav", Uuid::new_v4()));
    let voice_name = voice
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or(settings.tts_voice.clone());
    let voice_arg = voice_name.clone().unwrap_or_default();
    synthesize_sapi_wav(&powershell, trimmed, &voice_arg, &output)?;

    let measure = probe_file(&ffprobe, &output, MediaKind::Audio)?;
    let (sha256, bytes) = sha256_file(&output)?;
    let relative = format!(
        "media/{}",
        output
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "narracion.wav".to_owned())
    );
    let seconds = measure.duration_seconds.unwrap_or(0.0);
    let frames = if seconds > 0.0 {
        ((seconds * fps_num.max(1) as f64 / fps_den.max(1) as f64).round() as u64).max(1)
    } else {
        1
    };
    let acquired_at = now_rfc3339();
    let label = output
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Narración".to_owned());
    let asset = json!({
        "id": Uuid::new_v4().to_string(),
        "label": label,
        "kind": "audio",
        "source": { "type": "generated", "provider": { "id": "windows-sapi", "model": voice_name.clone().unwrap_or_else(|| "voz local".to_owned()) }, "path": relative, "generatedAt": acquired_at.clone() },
        "status": "unverified",
        "integrity": { "sha256": sha256, "bytes": bytes },
        "rights": {
            "license": { "id": "unknown", "commercialUse": "unknown" },
            "provenance": {
                "origin": "generated-locally",
                "acquiredAt": acquired_at,
                "provider": "windows-sapi",
                "termsSnapshot": "Voz instalada en Windows; verificá los términos de la voz antes de publicar."
            }
        },
        "media": {
            "sampleRate": measure.sample_rate.unwrap_or(48_000),
            "channels": measure.channels.unwrap_or(1),
            "durationFrames": frames
        }
    });

    if let Some(voice) = voice_name {
        if let Ok(mut settings) = state.settings.lock() {
            settings.tts_voice = Some(voice.clone());
            let _ = state.save_settings(&settings);
        }
    }

    Ok(NarrationResult {
        asset,
        voice: voice_arg,
        provider: "windows-sapi".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voices_parse_array_object_and_garbage() {
        let array = r#"[{"name":"Microsoft Helena","culture":"es-ES","gender":"Female"}]"#;
        assert_eq!(parse_voices(array).len(), 1);
        let single = r#"{"name":"Microsoft Sabina","culture":"es-MX","gender":"Female"}"#;
        assert_eq!(parse_voices(single)[0].name, "Microsoft Sabina");
        assert!(parse_voices("not json").is_empty());
    }

    #[test]
    fn the_script_never_interpolates_user_text() {
        assert!(TTS_SCRIPT.contains("[Console]::In.ReadToEnd()"));
        assert!(!TTS_SCRIPT.contains("{{"));
        assert!(VOICES_SCRIPT.contains("GetInstalledVoices"));
    }
}
