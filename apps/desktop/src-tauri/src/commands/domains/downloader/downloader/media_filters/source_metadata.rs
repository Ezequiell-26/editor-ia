fn file_md5(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|_| "No se pudo abrir el archivo final para calcular su MD5.".to_owned())?;
    let mut hasher = Md5::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "No se pudo leer el archivo final para calcular su MD5.".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|_| "No se pudo abrir el archivo final para calcular su SHA-256.".to_owned())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "No se pudo leer el archivo final para calcular su SHA-256.".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

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

fn subtitle_languages(value: Option<&str>) -> Result<String, String> {
    let value = value.unwrap_or("es.*,en.*").trim();
    if value.is_empty() || value.len() > 120 {
        return Err("La lista de idiomas de subtítulos no es válida.".to_owned());
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | ',' | '*' | '-' | '_'))
    {
        return Err(
            "Los idiomas de subtítulos sólo pueden usar letras, números, ., *, , y -.".to_owned(),
        );
    }
    Ok(value.to_owned())
}

fn sponsorblock_categories(value: Option<&str>) -> Result<String, String> {
    const ALLOWED: [&str; 8] = [
        "sponsor",
        "selfpromo",
        "interaction",
        "intro",
        "outro",
        "preview",
        "filler",
        "music_offtopic",
    ];
    let raw = value.unwrap_or("sponsor,selfpromo,interaction");
    let mut selected: Vec<&str> = Vec::new();
    for item in raw
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if !ALLOWED.contains(&item) {
            return Err(format!("Categoría de SponsorBlock desconocida: {item}."));
        }
        if !selected.contains(&item) {
            selected.push(item);
        }
    }
    if selected.is_empty() {
        return Err("Elegí al menos una categoría de SponsorBlock.".to_owned());
    }
    Ok(selected.join(","))
}

fn sponsorblock_category_list(value: Option<&str>) -> Result<Vec<String>, String> {
    Ok(sponsorblock_categories(value)?
        .split(',')
        .map(str::to_owned)
        .collect())
}

/// Extrae el ID de 11 caracteres de las formas habituales de YouTube.
pub(crate) fn youtube_video_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let (_, rest) = trimmed.split_once("://")?;
    let (host, path) = rest.split_once('/')?;
    let host = host
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    let mut candidate = None;
    if host == "youtu.be" {
        candidate = path.split(['?', '#', '/']).next();
    } else if host == "youtube.com" || host.ends_with(".youtube.com") {
        if let Some(query) = path.strip_prefix("watch?") {
            candidate = query.split('&').find_map(|pair| pair.strip_prefix("v="));
        } else {
            candidate = path.split('/').find(|part| {
                !part.is_empty() && !matches!(*part, "shorts" | "embed" | "live" | "v" | "e")
            });
        }
    }
    let id = candidate?.trim();
    (id.len() == 11
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
    .then(|| id.to_owned())
}

fn parse_sponsor_segments(value: &Value) -> Vec<SponsorSegment> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let segment = item["segment"].as_array()?;
            let start = segment.first()?.as_f64()?;
            let end = segment.get(1)?.as_f64()?;
            if !start.is_finite() || !end.is_finite() || end <= start {
                return None;
            }
            Some(SponsorSegment {
                category: item["category"].as_str().unwrap_or("sponsor").to_owned(),
                start_seconds: start,
                end_seconds: end,
                action: item["actionType"].as_str().unwrap_or("skip").to_owned(),
            })
        })
        .take(200)
        .collect()
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

/// Tratamiento opcional de la pista original: acelera 2 % sin cambiar el
/// tono y suma ruido rosa a -50 dB antes de la normalización de emisión.
/// Los títulos de música conservan la pista original: el enrutador no debe
/// sustituirla por Piper ni por una banda, aunque el video sea corto.
pub(crate) fn title_prefers_original_audio(title: &str) -> bool {
    let lower = title.to_lowercase();
    [
        "music", "song", "lyrics", "cover", "música", "musica", "canción", "cancion",
    ]
    .iter()
    .any(|word| lower.contains(word))
}

/// Decisión estática del enrutador automático. No consulta IA ni red: sólo la
/// duración conocida y el título. Se resuelve una vez por archivo y se puede
/// recalcular después de descargar si la duración llegó vacía.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AutoRouteDecision {
    pub long_video: bool,
    pub music: bool,
}

impl AutoRouteDecision {
    pub fn pick(duration_seconds: f64, title: &str) -> Self {
        Self {
            long_video: duration_seconds > 60.0,
            music: title_prefers_original_audio(title),
        }
    }

    /// Sólo los videos cortos no musicales reciben narración Piper.
    /// Los cortos no musicales conservan y masterizan la pista original; la
    /// voz Piper queda como opción manual explícita, no automática.
    #[cfg(test)]
    pub fn master_original_audio(self) -> bool {
        !self.music && !self.long_video
    }

    /// Los videos largos aceleran 2 % y suman ruido; la música nunca.
    pub fn speed_and_noise(self) -> bool {
        self.long_video && !self.music
    }

    /// La música conserva la pista sin filtros de velocidad ni ruido.
    #[cfg(test)]
    pub fn preserves_original_audio_without_voice(self) -> bool {
        self.music
    }

    pub fn summary(self) -> &'static str {
        match (self.music, self.long_video) {
            (true, true) => "música larga: look rápido sin flujo óptico y audio original intacto",
            (true, false) => "música: look completo y audio original intacto",
            (false, true) => {
                "video largo: look rápido sin flujo óptico y audio 1,02× con ruido −50 dB"
            }
            (false, false) => {
                "video corto: look completo con flujo óptico y audio original masterizado"
            }
        }
    }
}
