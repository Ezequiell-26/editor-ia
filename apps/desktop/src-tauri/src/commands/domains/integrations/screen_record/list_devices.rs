/// Enumera las fuentes DirectShow disponibles (cámaras y micrófonos),
/// igual que el panel «Fuentes» de OBS.
#[tauri::command]
pub async fn screen_record_devices(
    state: State<'_, AppState>,
) -> Result<CaptureDevices, ProjectError> {
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let Some(ffmpeg) = ffmpeg else {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "ffmpeg no está disponible para enumerar dispositivos",
        ));
    };
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new(ffmpeg)
            .args([
                "-hide_banner",
                "-list_devices",
                "true",
                "-f",
                "dshow",
                "-i",
                "dummy",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo consultar dispositivos: {e}")))?
    .map_err(|e| io_error(&format!("ffmpeg no enumeró dispositivos: {e}")))?;

    // Líneas tipo: [in#0 @ ...] "REDRAGON Live Camera" (video)
    let text = String::from_utf8_lossy(&output.stderr);
    let mut cameras = Vec::new();
    let mut microphones = Vec::new();
    for line in text.lines() {
        let Some(open) = line.find('"') else { continue };
        let Some(close) = line[open + 1..].find('"').map(|i| open + 1 + i) else {
            continue;
        };
        let name = line[open + 1..close].trim();
        let rest = &line[close..];
        if name.is_empty() || name.starts_with('@') {
            continue;
        }
        if rest.contains("(video)") {
            cameras.push(name.to_owned());
        } else if rest.contains("(audio)") {
            microphones.push(name.to_owned());
        }
    }
    cameras.dedup();
    microphones.dedup();
    Ok(CaptureDevices {
        cameras,
        microphones,
    })
}
