/// Mate de un `luma-wipe`: el clip de la timeline cuyo video aporta la máscara
/// de luminancia durante el lead (port Kdenlive luma wipe con clip mate).
pub(super) struct LumaMate {
    /// Ruta ya validada dentro del root del proyecto.
    path: PathBuf,
    /// Segundos de fuente donde empieza la ventana de mate pedida.
    seek_seconds: f64,
    /// Segundos de fuente a leer (con margen para el redondeo de fps).
    source_seconds: f64,
    is_image: bool,
    /// `true` cuando el clip entra por `transitionFrozen` (ventana de un frame
    /// del preview): la máscara entera es un único frame del mate.
    frozen: bool,
}

/// Resuelve el mate declarado por `transitionIn.mateClipId` (render completo)
/// o `transitionFrozen.mateClipId` (ventana de un frame del preview). Devuelve
/// `None` cuando el clip no usa luma wipe o cuando el lead ya terminó.
pub(super) fn luma_mate(
    clips: &[Value],
    asset_by_id: &HashMap<String, Value>,
    root: &Path,
    clip: &Value,
    project_fps: f64,
    clip_seconds: f64,
    lead_seconds: f64,
    start_seconds: f64,
) -> Result<Option<LumaMate>, ProjectError> {
    let transition_luma =
        clip["transitionIn"]["type"].as_str() == Some("luma-wipe") && lead_seconds > 0.001;
    let frozen = clip["transitionFrozen"]["mode"].as_str() == Some("luma");
    if !transition_luma && !frozen {
        return Ok(None);
    }
    let mate_id = if frozen {
        clip["transitionFrozen"]["mateClipId"].as_str()
    } else {
        clip["transitionIn"]["mateClipId"].as_str()
    };
    let mate_id = mate_id.ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la transición luma wipe no tiene clip mate asignado",
        )
    })?;
    let mate = clips
        .iter()
        .find(|candidate| candidate["id"].as_str() == Some(mate_id))
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "la transición luma wipe apunta a un clip que ya no está en la timeline",
            )
        })?;
    if mate["id"] == clip["id"] {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la transición luma wipe no puede usar el mismo clip como mate",
        ));
    }
    let mate_kind = mate["kind"].as_str().unwrap_or("");
    if !matches!(mate_kind, "video" | "image" | "freeze") {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el mate de la transición luma wipe debe ser un clip de video o imagen",
        ));
    }
    if mate["enabled"].as_bool() == Some(false) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el mate de la transición luma wipe está deshabilitado",
        ));
    }
    if parse_speed_curve(mate).is_some() || mate["reverse"].as_bool() == Some(true) {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el mate de la transición luma wipe no admite curvas de velocidad ni reverse",
        ));
    }
    let mate_start = mate["startFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
    let mate_duration = mate["durationFrames"].as_u64().unwrap_or(0) as f64 / project_fps;
    if mate_duration <= 0.0 {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el mate de la transición luma wipe no tiene duración",
        ));
    }
    if !frozen {
        // La máscara cubre el solape: del inicio del lead al inicio del clip.
        let need_from = start_seconds - lead_seconds;
        let need_to = start_seconds;
        let mate_lead = transition_lead_seconds(mate, project_fps, mate_duration, mate_start);
        let mate_from = mate_start - mate_lead;
        let mate_to = mate_start + mate_duration;
        let fps_tolerance = 1.0 / project_fps.max(1.0);
        if mate_from > need_from + fps_tolerance || mate_to < need_to - fps_tolerance {
            return Err(ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el mate de la transición luma wipe no cubre el solape de la transición",
            ));
        }
    }
    let asset_id = mate["source"]["assetId"].as_str().unwrap_or("");
    let asset = asset_by_id.get(asset_id).ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el mate de la transición luma wipe apunta a un material que ya no está en el proyecto",
        )
    })?;
    if asset["status"].as_str() != Some("ready") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el mate de la transición luma wipe tiene material sin verificar",
        ));
    }
    if asset["rights"]["license"]["commercialUse"].as_str() == Some("unknown") {
        return Err(ProjectError::message(
            ProjectErrorCode::AssetNotReady,
            "el mate de la transición luma wipe tiene licencia desconocida",
        ));
    }
    let relative = asset["source"]["path"].as_str().unwrap_or("");
    let path = resolve_inside_root(root, relative)?;
    ensure_asset_unchanged(asset, &path)?;
    let is_image = mate_kind == "image" || mate_kind == "freeze";
    let (seek_seconds, source_seconds) = if is_image {
        let mask_seconds = if frozen { clip_seconds } else { lead_seconds };
        (0.0, mask_seconds + 0.25)
    } else {
        let mate_in = mate["source"]["inFrame"].as_u64().unwrap_or(0) as f64 / project_fps;
        let speed_num = mate["speed"]["num"].as_u64().unwrap_or(1) as f64;
        let speed_den = mate["speed"]["den"].as_u64().unwrap_or(1) as f64;
        let ratio = (speed_num / speed_den.max(1.0)).max(0.01);
        if frozen {
            // La ventana de un frame ya rebasó `source.inFrame` al frame pedido.
            (mate_in, clip_seconds + 0.25)
        } else {
            // source(t) = inFrame + (t - mateStart) * speed, igual que el clip.
            let src_at = |t: f64| mate_in + (t - mate_start) * ratio;
            let seek = src_at(start_seconds - lead_seconds).max(0.0);
            let end = src_at(start_seconds);
            (seek, (end - seek).max(0.05) + 0.25)
        }
    };
    Ok(Some(LumaMate {
        path,
        seek_seconds,
        source_seconds,
        is_image,
        frozen,
    }))
}

/// Grafo que aplica la máscara de luminancia del mate sobre el lead del clip
/// entrante. El clip se parte en dos por `lead_frames`: el tramo del solape
/// pasa por `alphamerge` (la luma del mate se copia al alfa) y el resto
/// conserva su alfa original; `concat` los vuelve a unir sin perder frames.
/// La máscara se escala al tamaño de la capa con `scale2ref` —su segundo
/// output es la referencia intacta—.
///
/// Los pts se normalizan a cero en cada tramo porque `concat` desplaza el
/// segundo segmento por la duración del primero y unos pts con offset
/// absoluto abrían un hueco temporal; el origen del clip se restaura una
/// sola vez con el `setpts` final. `alphamerge` estira su salida a la
/// duración de la máscara (repitiendo el último frame del lead), así que se
/// recorta a `lead_frames` antes de concatenar.
pub(super) fn luma_wipe_graph(
    clip_index: usize,
    mate_index: usize,
    fps: f64,
    fps_arg: &str,
    lead_seconds: f64,
    offset_seconds: f64,
) -> String {
    let lead_frames = (lead_seconds.max(0.0) * fps.max(1.0)).round().max(1.0) as u64;
    format!(
        "[v{clip_index}]split=2[v{clip_index}a][v{clip_index}b];\
         [v{clip_index}a]trim=start_frame=0:end_frame={lead_frames},setpts=PTS-STARTPTS[v{clip_index}lead];\
         [v{clip_index}b]trim=start_frame={lead_frames},setpts=PTS-STARTPTS[v{clip_index}rest];\
         [{mate_index}:v]fps={fps_arg},format=gray,setpts=PTS-STARTPTS[m{clip_index}raw];\
         [m{clip_index}raw][v{clip_index}lead]scale2ref=flags=fast_bilinear[m{clip_index}s][v{clip_index}ref];\
         [v{clip_index}ref][m{clip_index}s]alphamerge,trim=end_frame={lead_frames},setpts=PTS-STARTPTS[v{clip_index}lm];\
         [v{clip_index}lm][v{clip_index}rest]concat=n=2:v=1:a=0,setpts=PTS-STARTPTS+{offset_seconds:.6}/TB[v{clip_index}out]",
        offset_seconds = offset_seconds.max(0.0),
    )
}

/// Versión de un frame del preview: la máscara es un solo frame del mate y se
/// aplica a todo el clip ventaneado, sin split/concat.
pub(super) fn luma_frozen_graph(clip_index: usize, mate_index: usize, fps_arg: &str) -> String {
    format!(
        "[{mate_index}:v]fps={fps_arg},format=gray,setpts=PTS-STARTPTS[m{clip_index}raw];\
         [m{clip_index}raw][v{clip_index}]scale2ref=flags=fast_bilinear[m{clip_index}s][v{clip_index}ref];\
         [v{clip_index}ref][m{clip_index}s]alphamerge,trim=end_frame=1[v{clip_index}out]"
    )
}
