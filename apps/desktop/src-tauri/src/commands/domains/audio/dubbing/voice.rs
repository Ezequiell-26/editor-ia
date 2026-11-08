fn pick_voice(voices: &[VoiceInfo], language: &str) -> Result<VoiceInfo, ProjectError> {
    if let Some(found) = voices.iter().find(|voice| {
        voice
            .culture
            .to_ascii_lowercase()
            .starts_with(&language.to_ascii_lowercase())
    }) {
        return Ok(found.clone());
    }
    let installed = voices
        .iter()
        .map(|voice| format!("{} ({})", voice.name, voice.culture))
        .collect::<Vec<_>>()
        .join(", ");
    Err(ProjectError::message(
        ProjectErrorCode::ProviderUnavailable,
        &format!(
            "Windows no tiene una voz instalada para {}; instalá una voz en Configuración → Voz. Voces disponibles: {}",
            language_label(language),
            if installed.is_empty() { "ninguna".to_owned() } else { installed }
        ),
    ))
}
