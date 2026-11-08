//! Caso de uso `import_timeline`: parsea un EDL/OTIO/FCPXML, importa los
//! medios referenciados con `media::import_file` y devuelve tracks+clips
//! listos para que la UI los monte con undo.
//!
//! La lógica de parseo vive en `crate::media::timeline_import` (dominio
//! puro); aquí queda la orquestación que antes estaba en el comando IPC.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use uuid::Uuid;

use crate::application::media::confirm_generated_rights;
use crate::media::import_file;
use crate::media::timeline_import::{
    detect_format, ensure_track, parse_edl, parse_fcpxml, parse_otio, project_fps, resolve_media,
    seconds_to_frames, TrackKind, MAX_CLIPS, MAX_MEDIA, MAX_TIMELINE_BYTES,
};
use crate::ports::media::TimelineImportResult;
use crate::projects::service::{ProjectError, ProjectErrorCode};

pub fn import_timeline_file(
    root: &Path,
    ffprobe: &Path,
    path: &Path,
    project: &Value,
) -> Result<TimelineImportResult, ProjectError> {
    let format = detect_format(path)?;
    let size = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if size > MAX_TIMELINE_BYTES {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el archivo de timeline supera los 32 MB; verificá que sea un EDL, OTIO o FCPXML",
        ));
    }
    let text = std::fs::read_to_string(path).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo leer la timeline: {error}").as_str(),
        )
    })?;
    let (fps_num, fps_den, fps) = project_fps(project)?;
    let mut parsed = match format {
        "edl" => parse_edl(&text, fps),
        "otio" => parse_otio(&text, fps)?,
        _ => parse_fcpxml(&text, fps)?,
    };
    let timeline_dir = path.parent().unwrap_or(root);
    if let Some(source_fps) = parsed.fps {
        if (source_fps - fps).abs() > 0.01 {
            parsed.warnings.push(format!(
                "la timeline declara {source_fps:.3} fps y el proyecto usa {fps:.3}; los tiempos se convierten"
            ));
        }
    }
    if parsed.clips.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "la timeline no tiene clips con medios importables",
        ));
    }
    if parsed.clips.len() > MAX_CLIPS {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("la timeline supera el límite de {MAX_CLIPS} clips").as_str(),
        ));
    }

    let mut existing: HashMap<PathBuf, (String, Value)> = HashMap::new();
    for asset in project["assets"].as_array().cloned().unwrap_or_default() {
        let Some(id) = asset["id"].as_str() else {
            continue;
        };
        let Some(relative) = asset["source"]["path"].as_str() else {
            continue;
        };
        if let Ok(canonical) = root.join(relative).canonicalize() {
            existing.insert(canonical, (id.to_owned(), asset));
        }
    }

    let mut new_assets = Vec::new();
    let mut imported: HashMap<PathBuf, (String, Value)> = HashMap::new();
    let mut reused_ids: HashSet<String> = HashSet::new();
    let mut tracks = Vec::new();
    let mut clips = Vec::new();
    let mut track_ids: HashMap<(usize, String), String> = HashMap::new();
    let mut next_order = project["timeline"]["tracks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|track| track["order"].as_u64())
        .max()
        .map(|order| order + 1)
        .unwrap_or(0);
    let mut warnings = parsed.warnings.clone();

    for clip in &parsed.clips {
        let Some(resolved) = resolve_media(
            root,
            timeline_dir,
            clip.media.as_deref(),
            clip.media_hint.as_deref(),
        ) else {
            warnings.push(format!(
                "{}: no se encontró el medio referenciado ({})",
                clip.label,
                clip.media
                    .as_deref()
                    .or(clip.media_hint.as_deref())
                    .unwrap_or("sin ruta")
            ));
            continue;
        };
        let canonical = match resolved.canonicalize() {
            Ok(path) => path,
            Err(_) => {
                warnings.push(format!("{}: el medio ya no está disponible", clip.label));
                continue;
            }
        };
        let (asset_id, asset) = if let Some((id, asset)) = existing.get(&canonical) {
            if asset["status"].as_str() != Some("ready") {
                warnings.push(format!(
                    "{}: el asset existente no está listo para montar",
                    clip.label
                ));
                continue;
            }
            reused_ids.insert(id.clone());
            (id.clone(), asset.clone())
        } else if let Some((id, asset)) = imported.get(&canonical) {
            (id.clone(), asset.clone())
        } else {
            if imported.len() >= MAX_MEDIA {
                warnings.push(format!(
                    "{}: se alcanzó el límite de {MAX_MEDIA} medios por importación",
                    clip.label
                ));
                continue;
            }
            let mut asset =
                import_file(root, &canonical, ffprobe, fps_num, fps_den).map_err(|error| {
                    ProjectError::message(
                        error.code,
                        format!(
                            "no se pudo importar {}: {}",
                            canonical.file_name().unwrap_or_default().to_string_lossy(),
                            error.message
                        )
                        .as_str(),
                    )
                })?;
            confirm_generated_rights(&mut asset, Some("timeline-import"));
            let id = asset["id"]
                .as_str()
                .ok_or_else(|| {
                    ProjectError::message(
                        ProjectErrorCode::InvalidProviderResponse,
                        "el importador devolvió un asset sin id",
                    )
                })?
                .to_owned();
            imported.insert(canonical.clone(), (id.clone(), asset.clone()));
            new_assets.push(asset.clone());
            (id, asset)
        };
        let Some(kind) = asset["kind"].as_str() else {
            warnings.push(format!("{}: el asset no declara tipo", clip.label));
            continue;
        };
        // Una pista de audio del intercambio suele apuntar al mismo archivo
        // que la de video (EDL `A`, OTIO `kind: Audio`). Antes se montaba un
        // clip de video duplicado en una pista nueva en vez de usar su audio.
        let clip_kind = match (
            parsed.tracks.get(clip.track_index).map(|track| track.kind),
            kind,
        ) {
            (Some(TrackKind::Audio), "video") => "audio",
            (Some(TrackKind::Audio), "image") => {
                warnings.push(format!(
                    "{}: la pista de audio apunta a una imagen; se omite",
                    clip.label
                ));
                continue;
            }
            _ => kind,
        };
        let clip_kind = match clip_kind {
            "video" | "audio" | "image" => clip_kind,
            _ => {
                warnings.push(format!("{}: el tipo {kind} no se puede montar", clip.label));
                continue;
            }
        };
        let track_id = ensure_track(
            &parsed.tracks,
            clip.track_index,
            clip_kind,
            &mut track_ids,
            &mut tracks,
            &mut next_order,
            &mut warnings,
        )?;
        let start_frame = seconds_to_frames(clip.start_seconds, fps);
        let label: String = clip
            .label
            .chars()
            .take(200)
            .collect::<String>()
            .trim()
            .to_owned();
        let label = if label.is_empty() {
            asset["label"]
                .as_str()
                .unwrap_or("Clip importado")
                .to_owned()
        } else {
            label
        };
        let clip_json = if clip_kind == "image" {
            let duration = seconds_to_frames(clip.duration_seconds, fps).max(1);
            json!({
                "id": Uuid::new_v4().to_string(),
                "trackId": track_id,
                "label": label,
                "startFrame": start_frame,
                "durationFrames": duration,
                "kind": "image",
                "source": { "type": "asset", "assetId": asset_id }
            })
        } else {
            let Some(media_duration) = asset["media"]["durationFrames"].as_u64() else {
                warnings.push(format!(
                    "{}: el asset no declara duración de medios",
                    clip.label
                ));
                continue;
            };
            if media_duration == 0 {
                warnings.push(format!("{}: el medio tiene duración cero", clip.label));
                continue;
            }
            let source_in = seconds_to_frames(clip.source_in_seconds, fps);
            if source_in >= media_duration {
                warnings.push(format!(
                    "{}: el inicio de origen ({source_in}) queda fuera del medio",
                    clip.label
                ));
                continue;
            }
            let speed_num = clip.speed_num.max(1);
            let speed_den = clip.speed_den.max(1);
            let playback = speed_num as f64 / speed_den as f64;
            let mut duration = seconds_to_frames(clip.duration_seconds, fps);
            if duration == 0 {
                warnings.push(format!("{}: duración de clip cero", clip.label));
                continue;
            }
            // `duration` es tiempo de timeline; el medio consumido se escala por
            // la velocidad (un clip a 2× dura la mitad en la timeline).
            let mut source_frames = ((duration as f64) * playback).round().max(1.0) as u64;
            if source_in + source_frames > media_duration {
                let available = media_duration - source_in;
                let trimmed = ((available as f64) / playback).floor() as u64;
                if trimmed == 0 {
                    warnings.push(format!(
                        "{}: la ventana se recortó a los medios disponibles",
                        clip.label
                    ));
                    continue;
                }
                duration = trimmed;
                source_frames = ((duration as f64) * playback).round().max(1.0) as u64;
                warnings.push(format!(
                    "{}: la ventana se recortó a los medios disponibles",
                    clip.label
                ));
            }
            let mut clip_json = json!({
                "id": Uuid::new_v4().to_string(),
                "trackId": track_id,
                "label": label,
                "startFrame": start_frame,
                "durationFrames": duration,
                "kind": clip_kind,
                "source": {
                    "type": "asset",
                    "assetId": asset_id,
                    "inFrame": source_in,
                    "outFrame": source_in + source_frames
                }
            });
            if speed_num != speed_den {
                clip_json["speed"] = json!({ "num": speed_num, "den": speed_den });
            }
            clip_json
        };
        clips.push(clip_json);
    }

    if clips.is_empty() {
        // El usuario necesita saber por qué no entró nada: sin los motivos,
        // "ningún clip pudo importarse" es un callejón sin salida.
        let reasons: Vec<String> = warnings.iter().take(3).cloned().collect();
        let message = if reasons.is_empty() {
            "ningún clip de la timeline pudo importarse; revisá los medios referenciados".to_owned()
        } else {
            format!(
                "ningún clip de la timeline pudo importarse. Motivos: {}",
                reasons.join(" · ")
            )
        };
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            &message,
        ));
    }
    let used_tracks: HashSet<String> = clips
        .iter()
        .filter_map(|clip| clip["trackId"].as_str().map(str::to_owned))
        .collect();
    tracks.retain(|track| {
        track["id"]
            .as_str()
            .map(|id| used_tracks.contains(id))
            .unwrap_or(false)
    });
    let imported_clips = clips.len();
    Ok(TimelineImportResult {
        format: format.to_owned(),
        path: path.to_string_lossy().into_owned(),
        new_assets: new_assets.len(),
        reused_assets: reused_ids.len(),
        assets: new_assets,
        tracks,
        clips,
        imported_clips,
        warnings,
    })
}
