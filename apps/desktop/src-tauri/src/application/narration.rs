//! Narración local (Windows SAPI) — DTOs IPC, scripts de PowerShell y
//! parsers/validadores puros. La ejecución del sintetizador, el keyring y el
//! alta del asset quedan en `commands::narration`.

use serde::Serialize;
use serde_json::Value;

use crate::projects::service::{ProjectError, ProjectErrorCode};

pub const TTS_SCRIPT: &str = r#"Add-Type -AssemblyName System.Speech
$ErrorActionPreference = 'Stop'
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:EDITORIA_TTS_VOICE) { $synth.SelectVoice($env:EDITORIA_TTS_VOICE) }
$synth.SetOutputToWaveFile($env:EDITORIA_TTS_OUT)
$text = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($text)) { throw 'empty narration' }
$synth.Speak($text)
$synth.Dispose()
"#;

pub const VOICES_SCRIPT: &str = r#"Add-Type -AssemblyName System.Speech
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

/// Texto de narración válido: no vacío y hasta 4000 caracteres.
pub fn validate_narration_text(text: &str) -> Result<&str, ProjectError> {
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
    Ok(trimmed)
}

/// Voz pedida por el usuario o la guardada en ajustes; `None` = default del
/// sistema.
pub fn resolve_voice_name(requested: Option<&str>, saved: Option<&str>) -> Option<String> {
    requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| saved.map(str::to_owned))
}

/// Parsea el JSON de `GetInstalledVoices` (array u objeto único).
pub fn parse_voices(raw: &str) -> Vec<VoiceInfo> {
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

/// Parsea la lista de voces de ElevenLabs (`voices[].voice_id/name/labels`).
pub fn parse_elevenlabs_voices(value: &Value) -> Vec<VoiceInfo> {
    value["voices"]
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry["voice_id"].as_str()?.trim();
                    let name = entry["name"].as_str()?.trim();
                    if id.is_empty() || name.is_empty() {
                        return None;
                    }
                    let labels = &entry["labels"];
                    let culture = labels["language"]
                        .as_str()
                        .or_else(|| labels["accent"].as_str())
                        .unwrap_or("")
                        .to_owned();
                    let gender = labels["gender"].as_str().unwrap_or("").to_owned();
                    Some(VoiceInfo {
                        id: id.to_owned(),
                        name: name.to_owned(),
                        culture,
                        gender,
                    })
                })
                .take(200)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "narration.tests.rs"]
mod tests;
