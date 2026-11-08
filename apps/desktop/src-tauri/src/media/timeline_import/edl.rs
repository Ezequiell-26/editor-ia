pub(crate) fn ensure_track(
    parsed_tracks: &[ParsedTrack],
    index: usize,
    clip_kind: &str,
    track_ids: &mut HashMap<(usize, String), String>,
    tracks: &mut Vec<Value>,
    next_order: &mut u64,
    warnings: &mut Vec<String>,
) -> Result<String, ProjectError> {
    let key = (index, clip_kind.to_owned());
    if let Some(id) = track_ids.get(&key) {
        return Ok(id.clone());
    }
    if *next_order > 63 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la timeline importada supera el límite de 64 pistas",
        ));
    }
    let parsed = parsed_tracks.get(index);
    let base = parsed
        .map(|track| track.label.as_str())
        .unwrap_or("Importada");
    let suffix = match parsed.map(|track| track.kind) {
        Some(TrackKind::Video) if clip_kind == "video" => "",
        Some(TrackKind::Audio) if clip_kind == "audio" => "",
        Some(TrackKind::Video) => match clip_kind {
            "audio" => " · audio",
            "image" => " · imágenes",
            _ => "",
        },
        Some(TrackKind::Audio) => " · video",
        None => "",
    };
    if !suffix.is_empty() {
        warnings.push(format!(
            "la pista {base} mezclaba tipos; los clips de {clip_kind} se separaron en otra pista"
        ));
    }
    let label: String = format!("{base}{suffix}").chars().take(120).collect();
    let id = Uuid::new_v4().to_string();
    tracks.push(json!({
        "id": id,
        "kind": clip_kind,
        "label": label,
        "order": *next_order,
        "muted": false,
        "hidden": false,
        "locked": false
    }));
    *next_order += 1;
    track_ids.insert(key, id.clone());
    Ok(id)
}

pub(crate) fn project_fps(project: &Value) -> Result<(u32, u32, f64), ProjectError> {
    let num = project["video"]["frameRate"]["num"].as_u64().unwrap_or(0) as u32;
    let den = project["video"]["frameRate"]["den"].as_u64().unwrap_or(0) as u32;
    if num == 0 || den == 0 {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el proyecto no declara un frame rate válido",
        ));
    }
    Ok((num, den, num as f64 / den as f64))
}

pub(crate) fn seconds_to_frames(seconds: f64, fps: f64) -> u64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds * fps.max(1.0)).round() as u64
}

pub(crate) fn detect_format(path: &Path) -> Result<&'static str, ProjectError> {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "edl" => Ok("edl"),
        "otio" => Ok("otio"),
        "fcpxml" | "xml" => Ok("fcpxml"),
        _ => Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo no es una timeline .edl, .otio o .fcpxml/.xml",
        )),
    }
}

pub(crate) fn resolve_media(
    root: &Path,
    timeline_dir: &Path,
    media: Option<&str>,
    hint: Option<&str>,
) -> Option<PathBuf> {
    let mut raw_values = Vec::new();
    if let Some(value) = media.map(str::trim).filter(|value| !value.is_empty()) {
        raw_values.push(value.to_owned());
    }
    if let Some(value) = hint.map(str::trim).filter(|value| !value.is_empty()) {
        raw_values.push(value.to_owned());
    }
    for raw in raw_values {
        for candidate in candidate_paths(root, timeline_dir, &raw) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let hint = hint?.trim();
    find_media_by_hint(&root.join("media"), hint)
}

fn candidate_paths(root: &Path, base: &Path, raw: &str) -> Vec<PathBuf> {
    let mut cleaned = raw.trim().trim_matches('"').to_owned();
    if let Some(rest) = cleaned.strip_prefix("file://") {
        cleaned = rest.to_owned();
    }
    if cleaned.starts_with('/') && cleaned.len() > 2 && cleaned.as_bytes()[2] == b':' {
        cleaned = cleaned[1..].to_owned();
    } else if cleaned.starts_with('/') && !cleaned.starts_with("//") {
        cleaned = cleaned.trim_start_matches('/').to_owned();
    }
    let path = PathBuf::from(cleaned.replace('\\', "/"));
    let mut candidates = Vec::new();
    if path.is_absolute() {
        candidates.push(path.clone());
    } else {
        candidates.push(root.join(&path));
        candidates.push(base.join(&path));
        candidates.push(path.clone());
    }
    if let Some(name) = path.file_name() {
        candidates.push(root.join("media").join(name));
        candidates.push(base.join("media").join(name));
    }
    // Seguridad: un EDL/OTIO/FCPXML de terceros no puede sacar archivos de
    // fuera del proyecto o de la carpeta del propio archivo importado con
    // rutas absolutas o `..`. Sólo se aceptan archivos existentes y contenidos
    // en `root` o en `base`; el resto se ignora.
    candidates.retain(|candidate| {
        let Ok(canonical) = candidate.canonicalize() else {
            return false;
        };
        let inside = |dir: &Path| {
            dir.canonicalize()
                .map(|root| canonical.starts_with(root))
                .unwrap_or(false)
        };
        inside(root) || inside(base)
    });
    candidates
}

fn find_media_by_hint(directory: &Path, hint: &str) -> Option<PathBuf> {
    let wanted = hint.trim().to_ascii_lowercase();
    if wanted.is_empty() {
        return None;
    }
    let mut matches = Vec::new();
    collect_media_matches(directory, &wanted, 0, &mut matches);
    if matches.len() == 1 {
        matches.pop()
    } else {
        None
    }
}

fn collect_media_matches(directory: &Path, wanted: &str, depth: usize, matches: &mut Vec<PathBuf>) {
    if depth > 2 || matches.len() > 1 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let stem = path
                .file_stem()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            if name == wanted || stem == wanted {
                matches.push(path);
            }
        } else if path.is_dir() {
            collect_media_matches(&path, wanted, depth + 1, matches);
        }
    }
}
