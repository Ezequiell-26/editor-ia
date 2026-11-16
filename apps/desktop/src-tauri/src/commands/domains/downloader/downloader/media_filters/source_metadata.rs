// Los helpers puros (hashes, validadores de idiomas/categorías, youtube id,
// sponsor segments, decisión de enrutado, kind/extensión, progreso) viven en
// `application::downloads` y llegan por el `pub use` de control.rs.

fn input_has_audio(ffprobe: Option<&Path>, input: &Path) -> bool {
    let Some(ffprobe) = ffprobe else {
        return true;
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=index",
            "-of",
            "json",
        ])
        .arg(input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return true;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return true;
    };
    value["streams"]
        .as_array()
        .map(|streams| !streams.is_empty())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn list_audio_tracks(
    state: State<'_, AppState>,
    url: String,
) -> Result<Vec<AudioTrack>, ProjectError> {
    let url = validate_url(&url)?;
    let engine = resolve_engine(&state.config_dir)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&engine);
        command
            .args([
                "--no-warnings",
                "--ignore-config",
                "--dump-single-json",
                "--skip-download",
            ])
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::commands::hide_console(&mut command);
        let output = command
            .output()
            .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para el audio."))?;
        if !output.status.success() {
            return Err(provider_error(
                "yt-dlp no pudo analizar las pistas de audio; puede requerir cookies.",
            ));
        }
        let value: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| provider_error("yt-dlp devolvió un análisis de audio ilegible."))?;
        let tracks = parse_audio_tracks(&value);
        if tracks.is_empty() {
            return Err(invalid_error("La URL no ofrece pistas de audio separadas."));
        }
        Ok(tracks)
    })
    .await
    .map_err(|_| provider_error("El análisis de audio se interrumpió."))?
}

#[tauri::command]
pub async fn list_playlist_entries(
    state: State<'_, AppState>,
    url: String,
    limit: Option<u32>,
) -> Result<Vec<PlaylistEntry>, ProjectError> {
    let url = validate_url(&url)?;
    let engine = resolve_engine(&state.config_dir)?;
    let limit = limit.unwrap_or(500).clamp(1, 1000);
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&engine);
        command
            .args([
                "--no-warnings",
                "--ignore-config",
                "--flat-playlist",
                "--dump-single-json",
                "--skip-download",
                "--playlist-end",
                &limit.to_string(),
            ])
            .arg(&url)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::commands::hide_console(&mut command);
        let output = command
            .output()
            .map_err(|_| provider_error("No se pudo ejecutar yt-dlp para la playlist."))?;
        if !output.status.success() {
            return Err(provider_error(
                "yt-dlp no pudo leer la playlist; puede ser privada o requerir cookies.",
            ));
        }
        let value: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| provider_error("yt-dlp devolvió una playlist ilegible."))?;
        let entries = parse_playlist_entries(&value, limit as usize);
        if entries.is_empty() {
            return Err(invalid_error(
                "La URL no devolvió elementos de playlist reconocibles.",
            ));
        }
        Ok(entries)
    })
    .await
    .map_err(|_| provider_error("La lectura de la playlist se interrumpió."))?
}

fn fetch_sponsor_segments(
    video_id: &str,
    categories: &[String],
) -> Result<Vec<SponsorSegment>, ProjectError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| provider_error("No se pudo iniciar la consulta a SponsorBlock."))?;
    let categories_json = serde_json::to_string(categories).unwrap_or_else(|_| "[]".to_owned());
    let response = client
        .get("https://sponsor.ajay.app/api/skipSegments")
        .query(&[
            ("videoID", video_id),
            ("categories", categories_json.as_str()),
        ])
        .header("User-Agent", "Olyvia/0.1 (editor local)")
        .send()
        .map_err(|_| {
            provider_error("No se pudo consultar SponsorBlock. Revisá la conexión o el proxy.")
        })?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    if !response.status().is_success() {
        return Err(provider_error(format!(
            "SponsorBlock respondió {}.",
            response.status().as_u16()
        )));
    }
    let value: Value = response
        .json()
        .map_err(|_| provider_error("SponsorBlock devolvió una respuesta inválida."))?;
    Ok(parse_sponsor_segments(&value))
}

/// Consulta la API pública de SponsorBlock sin descargar el video. Devuelve
/// los tramos que yt-dlp quitaría con las mismas categorías.
#[tauri::command]
pub async fn sponsorblock_preview(
    url: String,
    categories: Option<String>,
) -> Result<Vec<SponsorSegment>, ProjectError> {
    let video_id = youtube_video_id(&url).ok_or_else(|| {
        invalid_error("Solo los enlaces de YouTube tienen segmentos de SponsorBlock.")
    })?;
    let categories = sponsorblock_category_list(categories.as_deref()).map_err(invalid_error)?;
    tauri::async_runtime::spawn_blocking(move || fetch_sponsor_segments(&video_id, &categories))
        .await
        .map_err(|_| provider_error("La consulta a SponsorBlock se interrumpió."))?
}
