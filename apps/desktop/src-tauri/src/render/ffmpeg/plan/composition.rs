pub fn build_plan(input: BuildPlanInput<'_>) -> Result<RenderPlan, ProjectError> {
    build_plan_range(input, None)
}

/// Igual que `build_plan`, pero limita la salida a `[start, end)` en frames del
/// proyecto. El grafo sigue construyendo la timeline completa y FFmpeg recorta
/// a la salida; el MP4 dura sólo el rango y la verificación usa esa duración.
/// Reemplaza cada clip compuesto por sus clips internos, conservando sus
/// pistas y desplazándolos a la posición actual del compuesto. Los compuestos
/// no se anidan: el esquema sólo admite clips simples dentro de la definición.
pub(crate) fn expand_compounds(project: &Value) -> Result<Value, ProjectError> {
    let tracks = project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let track_by_id: HashMap<String, Value> = tracks
        .iter()
        .filter_map(|track| Some((track["id"].as_str()?.to_owned(), track.clone())))
        .collect();
    expand_compounds_con_pistas(project, &track_by_id)
}

/// Igual que `expand_compounds`, con el mapa pista→pista provisto por el
/// caller (build_plan_range ya lo construye para el resto del grafo).
pub(crate) fn expand_compounds_con_pistas(
    project: &Value,
    track_by_id: &HashMap<String, Value>,
) -> Result<Value, ProjectError> {
    let compounds = project["compounds"].as_array().cloned().unwrap_or_default();
    if compounds.is_empty() {
        return Ok(project.clone());
    }
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    // Los clips internos vuelven a sus pistas originales, así que ocultar la
    // pista del compuesto no bastaba: la expansión los dejaba visibles. Lo
    // mismo pasa con el mute: el audio interno debe seguir a la pista exterior.
    let hidden_tracks: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| track["hidden"].as_bool().unwrap_or(false))
                .filter_map(|track| track["id"].as_str())
                .collect()
        })
        .unwrap_or_default();
    let muted_tracks: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| track["muted"].as_bool().unwrap_or(false))
                .filter_map(|track| track["id"].as_str())
                .collect()
        })
        .unwrap_or_default();
    // El solo de la pista exterior también tiene que seguir a los clips
    // internos: la mezcla decide por pista, y sin esto el compuesto solo
    // quedaría en silencio porque sus pistas internas no están en solo.
    let solo_tracks: HashSet<&str> = project["timeline"]["tracks"]
        .as_array()
        .map(|tracks| {
            tracks
                .iter()
                .filter(|track| track["solo"].as_bool().unwrap_or(false))
                .filter_map(|track| track["id"].as_str())
                .collect()
        })
        .unwrap_or_default();
    let mut expanded: Vec<Value> = Vec::with_capacity(clips.len());
    for clip in clips {
        if clip["kind"].as_str() != Some("compound") {
            expanded.push(clip);
            continue;
        }
        if clip["enabled"].as_bool() == Some(false) {
            continue;
        }
        if hidden_tracks.contains(clip["trackId"].as_str().unwrap_or("")) {
            continue;
        }
        let id = clip["source"]["compoundId"].as_str().unwrap_or("");
        let compound = compounds
            .iter()
            .find(|item| item["id"].as_str() == Some(id))
            .ok_or_else(|| {
                ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "el clip compuesto no tiene una definición en el proyecto",
                )
            })?;
        let base = clip["startFrame"].as_u64().unwrap_or(0);
        let duration = clip["durationFrames"].as_u64().unwrap_or(0);
        let host = clip["trackId"].as_str().unwrap_or("");
        let host_muted = muted_tracks.contains(host);
        let host_solo = solo_tracks.contains(host);
        let inner = compound["clips"].as_array().ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el compuesto no tiene clips internos",
            )
        })?;
        // Ganancia y estado de pista externa se aplican a todos los clips internos
        let host_track = track_by_id.get(host).cloned().unwrap_or_default();
        for item in inner {
            let start = item["startFrame"].as_u64().unwrap_or(0);
            let inner_duration = item["durationFrames"].as_u64().unwrap_or(0);
            if start + inner_duration > duration {
                return Err(ProjectError::message(
                    ProjectErrorCode::InvalidProject,
                    "un clip interno del compuesto no entra en su duración",
                ));
            }
            let mut copy = item.clone();
            copy["startFrame"] = Value::from(base + start);
            if matches!(copy["kind"].as_str(), Some("video" | "audio")) {
                if host_muted {
                    copy["audio"]["muted"] = Value::Bool(true);
                }
                if host_solo {
                    copy["audio"]["solo"] = Value::Bool(true);
                }
                // La ganancia de la pista externa se aplica a todos los clips
                // de audio internos; así el compuesto hereda el ajuste de nivel.
                // La ganancia propia del clip interno vive en `audio.gainDb`,
                // que es donde `audio_filter` la lee al armar el grafo.
                if let Some(gain) = host_track.get("gainDb").and_then(Value::as_f64) {
                    let gain_db =
                        (gain + number(&copy["audio"], "gainDb").unwrap_or(0.0)).clamp(-60.0, 12.0);
                    copy["audio"]["gainDb"] = Value::from(gain_db);
                }
            }
            expanded.push(copy);
        }
    }
    let mut next = project.clone();
    next["timeline"]["clips"] = Value::Array(expanded);
    Ok(next)
}
