fn finding(
    severity: &str,
    code: &str,
    message: String,
    clip_id: Option<&str>,
    clip_label: Option<&str>,
) -> VisualFinding {
    VisualFinding {
        severity: severity.to_owned(),
        code: code.to_owned(),
        message,
        clip_id: clip_id.map(str::to_owned),
        clip_label: clip_label.map(str::to_owned),
    }
}

/// Audita un proyecto ya cargado. No escribe ni repara: devuelve hallazgos
/// accionables para que el editor decida.
#[tauri::command]
pub fn audit_visuals(
    state: State<'_, AppState>,
    project: Value,
) -> Result<VisualAudit, ProjectError> {
    let session = state.require_session()?;
    let root = PathBuf::from(&session.root);
    let settings = state.settings_snapshot()?;
    let (ffmpeg, _, _) = resolve_tools(&settings);
    let filters = available_filters(ffmpeg.as_deref());
    Ok(audit_project(&project, &root, &filters))
}

pub(crate) fn audit_project(
    project: &Value,
    root: &Path,
    filters: &BTreeSet<String>,
) -> VisualAudit {
    let fps = project["video"]["frameRate"]["num"]
        .as_f64()
        .unwrap_or(30.0)
        / project["video"]["frameRate"]["den"]
            .as_f64()
            .unwrap_or(1.0)
            .max(1.0);
    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut findings = Vec::new();
    let mut transitions = 0u32;
    let mut effects_clips = 0u32;
    let mut scan_clip = |clip: &Value| {
        let kind = clip["kind"].as_str().unwrap_or("");
        if !matches!(kind, "video" | "image" | "freeze") {
            return;
        }
        let clip_id = clip["id"].as_str();
        let label = clip["label"].as_str();
        let duration = clip["durationFrames"].as_f64().unwrap_or(0.0);
        let start = clip["startFrame"].as_f64().unwrap_or(0.0);
        if let Some(transition) = clip.get("transitionIn").filter(|value| value.is_object()) {
            transitions += 1;
            let kind = transition["type"].as_str().unwrap_or("");
            let allowed = [
                "dissolve",
                "fade-black",
                "fade-white",
                "dip-color",
                "slide-left",
                "slide-right",
                "slide-up",
                "slide-down",
                "slide-3d-left",
                "slide-3d-right",
                "slide-3d-up",
                "slide-3d-down",
                "wipe-left",
                "wipe-right",
                "wipe-up",
                "wipe-down",
            ];
            if !allowed.contains(&kind) {
                findings.push(finding(
                    "error",
                    "transition-unknown",
                    format!("Transición desconocida: {kind}."),
                    clip_id,
                    label,
                ));
            }
            let frames = transition["frames"].as_f64().unwrap_or(0.0);
            if frames <= 0.0 || frames > 120.0 {
                findings.push(finding(
                    "error",
                    "transition-frames",
                    "La transición debe durar entre 1 y 120 frames.".to_owned(),
                    clip_id,
                    label,
                ));
            } else if frames > duration {
                findings.push(finding(
                    "error",
                    "transition-longer-than-clip",
                    "La transición es más larga que el clip que entra.".to_owned(),
                    clip_id,
                    label,
                ));
            }
            if start <= 0.0 {
                findings.push(finding(
                    "warning",
                    "transition-no-previous",
                    "El clip empieza en 0: no hay clip anterior que mezclar.".to_owned(),
                    clip_id,
                    label,
                ));
            }
            let max_useful = (fps * 2.0).max(1.0);
            if frames > max_useful {
                findings.push(finding(
                    "warning",
                    "transition-renderer-clamp",
                    format!(
                        "El renderer limita el solape a 2 s ({max_useful:.1} frames a {fps:.1} fps)."
                    ),
                    clip_id,
                    label,
                ));
            }
        }
        if let Some(effects) = clip.get("effects").filter(|value| value.is_object()) {
            effects_clips += 1;
            for (key, (min, max)) in [
                ("brightness", (-1.0, 1.0)),
                ("contrast", (0.0, 3.0)),
                ("saturation", (0.0, 3.0)),
                ("temperature", (-1.0, 1.0)),
                ("shadows", (-1.0, 1.0)),
                ("highlights", (-1.0, 1.0)),
                ("fade", (0.0, 1.0)),
                ("vignette", (0.0, 1.0)),
                ("sharpen", (0.0, 5.0)),
                ("blur", (0.0, 50.0)),
                ("hueRotateDeg", (-180.0, 180.0)),
            ] {
                if let Some(value) = effects.get(key).and_then(Value::as_f64) {
                    if value < min || value > max {
                        findings.push(finding(
                            "error",
                            "effect-out-of-range",
                            format!("{key}={value} está fuera del rango [{min}, {max}]."),
                            clip_id,
                            label,
                        ));
                    }
                }
            }
            if effects.get("blur").and_then(Value::as_f64).unwrap_or(0.0) > 0.0
                && !filters.contains("gblur")
            {
                findings.push(finding(
                    "error",
                    "filter-missing-gblur",
                    "El proyecto usa desenfoque, pero este FFmpeg no tiene gblur.".to_owned(),
                    clip_id,
                    label,
                ));
            }
            if let Some(lut) = effects.get("lutFile").and_then(Value::as_str) {
                if !filters.contains("lut3d") {
                    findings.push(finding(
                        "error",
                        "filter-missing-lut3d",
                        "El proyecto usa una LUT, pero este FFmpeg no tiene lut3d.".to_owned(),
                        clip_id,
                        label,
                    ));
                }
                match resolve_inside_root(root, lut) {
                    Ok(path) if path.is_file() => {}
                    Ok(_) => findings.push(finding(
                        "error",
                        "lut-missing",
                        format!("La LUT no existe en el proyecto: {lut}."),
                        clip_id,
                        label,
                    )),
                    Err(error) => {
                        let outside = error.code == ProjectErrorCode::PathEscapesRoot;
                        findings.push(finding(
                            "error",
                            if outside {
                                "lut-outside-project"
                            } else {
                                "lut-missing"
                            },
                            if outside {
                                "La ruta de la LUT sale de la carpeta del proyecto.".to_owned()
                            } else {
                                format!("La LUT no existe en el proyecto: {lut}.")
                            },
                            clip_id,
                            label,
                        ));
                    }
                }
            }
        }
    };
    for clip in &clips {
        scan_clip(clip);
    }
    VisualAudit {
        clips_scanned: clips.len() as u32,
        transitions,
        effects_clips,
        findings,
    }
}
