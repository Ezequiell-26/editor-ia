//! Importación de timelines EDL, OTIO y FCPXML.
//!
//! Los formatos son un intercambio, no una promesa de paridad: se importan
//! pistas, cortes y ventanas de origen; las transiciones, efectos y clips
//! conectados que el formato no puede representar se avisan y no se inventan.
//! Los medios referenciados se copian al proyecto con el mismo importador que
//! usa Medios, y los assets se devuelven para que la UI los agregue con undo.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::commands::media::confirm_generated_rights;
use crate::commands::system::resolve_tools;
use crate::media::import_file;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const MAX_CLIPS: usize = 1_000;
const MAX_MEDIA: usize = 200;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineImportRequest {
    pub project: Value,
    pub path: String,
    #[serde(default)]
    pub confirm_rights: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineImportResult {
    pub format: String,
    pub path: String,
    pub assets: Vec<Value>,
    pub tracks: Vec<Value>,
    pub clips: Vec<Value>,
    pub warnings: Vec<String>,
    pub imported_clips: usize,
    pub new_assets: usize,
    pub reused_assets: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone)]
struct ParsedTrack {
    label: String,
    kind: TrackKind,
}

#[derive(Debug, Clone)]
struct ParsedClip {
    track_index: usize,
    label: String,
    start_seconds: f64,
    source_in_seconds: f64,
    duration_seconds: f64,
    media: Option<String>,
    media_hint: Option<String>,
}

#[derive(Debug, Default)]
struct ParsedTimeline {
    tracks: Vec<ParsedTrack>,
    clips: Vec<ParsedClip>,
    warnings: Vec<String>,
    fps: Option<f64>,
}

#[tauri::command]
pub async fn choose_timeline_file(app: AppHandle) -> Result<Option<String>, ProjectError> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Importar timeline EDL, OTIO o FCPXML")
        .add_filter("Intercambio de timeline", &["edl", "otio", "fcpxml", "xml"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| {
        ProjectError::message(ProjectErrorCode::Io, "no se pudo usar la ruta elegida")
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn import_timeline(
    state: State<'_, AppState>,
    request: TimelineImportRequest,
) -> Result<TimelineImportResult, ProjectError> {
    if !request.confirm_rights {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "confirmá que tenés derechos para importar los medios referenciados por la timeline",
        ));
    }
    let session = state.require_session()?;
    let settings = state.settings_snapshot()?;
    let (_, ffprobe, _) = resolve_tools(&settings);
    let Some(ffprobe) = ffprobe else {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFprobe no está disponible; sin medir los medios no se puede importar la timeline",
        ));
    };
    let root = session.root.clone();
    let path = PathBuf::from(request.path.trim());
    if !path.is_file() {
        return Err(ProjectError::message(
            ProjectErrorCode::NotFound,
            "el archivo de timeline elegido ya no existe",
        ));
    }
    let project = request.project;
    tauri::async_runtime::spawn_blocking(move || {
        import_timeline_file(&root, &ffprobe, &path, &project)
    })
    .await
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("la importación de la timeline se interrumpió: {error}").as_str(),
        )
    })?
}

fn import_timeline_file(
    root: &Path,
    ffprobe: &Path,
    path: &Path,
    project: &Value,
) -> Result<TimelineImportResult, ProjectError> {
    let format = detect_format(path)?;
    let text = std::fs::read_to_string(path).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::Io,
            format!("no se pudo leer la timeline: {error}").as_str(),
        )
    })?;
    let (fps_num, fps_den, fps) = project_fps(project)?;
    let mut parsed = match format {
        "edl" => parse_edl(
            &text,
            (fps_num as f64 / fps_den as f64).round().max(1.0) as u32,
        ),
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
        let clip_kind = match kind {
            "video" | "audio" | "image" => kind,
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
            let mut duration = seconds_to_frames(clip.duration_seconds, fps);
            if duration == 0 {
                warnings.push(format!("{}: duración de clip cero", clip.label));
                continue;
            }
            if duration > media_duration - source_in {
                duration = media_duration - source_in;
                warnings.push(format!(
                    "{}: la ventana se recortó a los medios disponibles",
                    clip.label
                ));
            }
            json!({
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
                    "outFrame": source_in + duration
                }
            })
        };
        clips.push(clip_json);
    }

    if clips.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "ningún clip de la timeline pudo importarse; revisá los medios referenciados",
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

fn ensure_track(
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

fn project_fps(project: &Value) -> Result<(u32, u32, f64), ProjectError> {
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

fn seconds_to_frames(seconds: f64, fps: f64) -> u64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }
    (seconds * fps.max(1.0)).round() as u64
}

fn detect_format(path: &Path) -> Result<&'static str, ProjectError> {
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

fn resolve_media(
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

fn parse_edl(text: &str, fps: u32) -> ParsedTimeline {
    let mut parsed = ParsedTimeline::default();
    let mut tracks: HashMap<String, usize> = HashMap::new();
    let mut events: Vec<EdlEvent> = Vec::new();
    let mut last: Option<EdlEvent> = None;
    let fps = fps.max(1) as f64;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("TITLE:")
            || trimmed.starts_with("FCM:")
            || trimmed.starts_with("AUDIO:")
            || trimmed.starts_with("VIDEO:")
        {
            continue;
        }
        if trimmed.starts_with('*') {
            if let Some(rest) = trimmed.strip_prefix("* FROM CLIP NAME:") {
                if let Some(event) = last.as_mut() {
                    event.label = Some(rest.trim().to_owned());
                }
            } else if let Some(rest) = trimmed
                .strip_prefix("* FILENAME:")
                .or_else(|| trimmed.strip_prefix("* SOURCE FILE:"))
            {
                if let Some(event) = last.as_mut() {
                    event.media = Some(rest.trim().to_owned());
                }
            }
            continue;
        }
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.len() < 8 || !tokens[0].chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        let Some(source_in) = parse_timecode(tokens[4], fps as u32) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de origen inválido", tokens[0]));
            continue;
        };
        let Some(source_out) = parse_timecode(tokens[5], fps as u32) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de origen inválido", tokens[0]));
            continue;
        };
        let Some(record_in) = parse_timecode(tokens[6], fps as u32) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de récord inválido", tokens[0]));
            continue;
        };
        let Some(record_out) = parse_timecode(tokens[7], fps as u32) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de récord inválido", tokens[0]));
            continue;
        };
        if record_out <= record_in {
            parsed
                .warnings
                .push(format!("evento {}: el récord está vacío", tokens[0]));
            continue;
        }
        if source_out <= source_in {
            parsed.warnings.push(format!(
                "evento {}: la ventana de origen está vacía",
                tokens[0]
            ));
            continue;
        }
        let transition = tokens[3].trim();
        if !matches!(transition, "C" | "c") {
            parsed.warnings.push(format!(
                "evento {}: la transición {transition} se importa como corte",
                tokens[0]
            ));
        }
        let track_token = tokens[2].trim().to_ascii_uppercase();
        let track_index = *tracks.entry(track_token.clone()).or_insert_with(|| {
            let kind = if track_token.starts_with('A') {
                TrackKind::Audio
            } else {
                TrackKind::Video
            };
            parsed.tracks.push(ParsedTrack {
                label: if track_token.is_empty() {
                    "V".to_owned()
                } else {
                    track_token.clone()
                },
                kind,
            });
            parsed.tracks.len() - 1
        });
        let event = EdlEvent {
            track_index,
            label: None,
            media: None,
            hint: Some(tokens[1].trim().to_owned()),
            source_in,
            source_out,
            record_in,
            record_out,
        };
        if let Some(previous) = last.take() {
            events.push(previous);
        }
        last = Some(event);
        if tokens[4].contains(';') || tokens[6].contains(';') {
            parsed
                .warnings
                .push("el EDL usa drop-frame; se interpreta como NDF".to_owned());
        }
    }
    if let Some(previous) = last {
        events.push(previous);
    }
    for (event_number, event) in events.into_iter().enumerate() {
        let source_frames = event.source_out - event.source_in;
        let record_frames = event.record_out - event.record_in;
        if source_frames != record_frames {
            parsed.warnings.push(format!(
                "evento {}: la ventana de origen y el récord difieren; se usó la fuente",
                event_number + 1
            ));
        }
        let duration = source_frames as f64 / fps;
        if duration <= 0.0 {
            continue;
        }
        let label = event
            .label
            .clone()
            .or_else(|| event.hint.clone())
            .unwrap_or_else(|| "Evento EDL".to_owned());
        parsed.clips.push(ParsedClip {
            track_index: event.track_index,
            label,
            start_seconds: event.record_in as f64 / fps,
            source_in_seconds: event.source_in as f64 / fps,
            duration_seconds: duration,
            media: event.media,
            media_hint: event.hint,
        });
    }
    parsed
}

struct EdlEvent {
    track_index: usize,
    label: Option<String>,
    media: Option<String>,
    hint: Option<String>,
    source_in: u64,
    source_out: u64,
    record_in: u64,
    record_out: u64,
}

fn parse_timecode(value: &str, fps: u32) -> Option<u64> {
    let cleaned = value.replace(';', ":");
    let parts: Vec<&str> = cleaned.split(':').collect();
    if parts.len() != 4 {
        return None;
    }
    let hours: u64 = parts[0].parse().ok()?;
    let minutes: u64 = parts[1].parse().ok()?;
    let seconds: u64 = parts[2].parse().ok()?;
    let frames: u64 = parts[3].parse().ok()?;
    let fps = fps.max(1) as u64;
    if frames >= fps {
        return None;
    }
    Some((((hours * 60 + minutes) * 60 + seconds) * fps) + frames)
}

fn parse_otio(text: &str, project_fps: f64) -> Result<ParsedTimeline, ProjectError> {
    let root: Value = serde_json::from_str(text).map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("el OTIO no es JSON válido: {error}").as_str(),
        )
    })?;
    let schema = root["OTIO_SCHEMA"].as_str().unwrap_or("");
    if !schema.starts_with("Timeline") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el JSON no declara una Timeline OTIO",
        ));
    }
    let mut parsed = ParsedTimeline {
        fps: root["metadata"]["editor_ia"]["fps"].as_f64(),
        ..Default::default()
    };
    collect_otio(&root["tracks"], project_fps, &mut parsed);
    Ok(parsed)
}

fn collect_otio(value: &Value, project_fps: f64, parsed: &mut ParsedTimeline) {
    let schema = value["OTIO_SCHEMA"].as_str().unwrap_or("");
    if schema.starts_with("Timeline") {
        collect_otio(&value["tracks"], project_fps, parsed);
        return;
    }
    if schema.starts_with("Stack") {
        for child in value["children"].as_array().into_iter().flatten() {
            collect_otio(child, project_fps, parsed);
        }
        return;
    }
    if !schema.starts_with("Track") {
        return;
    }
    let kind = if value["kind"].as_str() == Some("Audio") {
        TrackKind::Audio
    } else {
        TrackKind::Video
    };
    parsed.tracks.push(ParsedTrack {
        label: value["name"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| "Pista OTIO".to_owned()),
        kind,
    });
    let track_index = parsed.tracks.len() - 1;
    let mut cursor = 0.0;
    for child in value["children"].as_array().into_iter().flatten() {
        let child_schema = child["OTIO_SCHEMA"].as_str().unwrap_or("");
        if child_schema.starts_with("Gap") {
            if let Some(duration) = otio_duration(child, project_fps) {
                cursor += duration;
            }
            continue;
        }
        if child_schema.starts_with("Transition") {
            parsed
                .warnings
                .push("OTIO: una transición se importó como corte".to_owned());
            continue;
        }
        if !child_schema.starts_with("Clip") {
            if child_schema.starts_with("Stack") {
                parsed
                    .warnings
                    .push("OTIO: un stack anidado no se importó".to_owned());
            }
            continue;
        }
        let Some((source_in, duration)) = otio_range(child, project_fps) else {
            parsed
                .warnings
                .push("OTIO: un clip no declara source_range".to_owned());
            continue;
        };
        if duration <= 0.0 {
            continue;
        }
        let label = child["name"]
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or("Clip OTIO")
            .to_owned();
        let relative = child["media_reference"]["metadata"]["editor_ia"]["relative_path"]
            .as_str()
            .map(str::to_owned);
        let target = child["media_reference"]["target_url"]
            .as_str()
            .map(str::to_owned);
        let media = relative.or_else(|| target.clone());
        parsed.clips.push(ParsedClip {
            track_index,
            label: label.clone(),
            start_seconds: cursor,
            source_in_seconds: source_in,
            duration_seconds: duration,
            media,
            media_hint: Some(label),
        });
        cursor += duration;
    }
}

fn otio_duration(value: &Value, project_fps: f64) -> Option<f64> {
    otio_time(&value["source_range"]["duration"], project_fps)
}

fn otio_range(value: &Value, project_fps: f64) -> Option<(f64, f64)> {
    let duration = otio_duration(value, project_fps)?;
    let start = otio_time(&value["source_range"]["start_time"], project_fps).unwrap_or(0.0);
    Some((start, duration))
}

fn otio_time(value: &Value, project_fps: f64) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    let amount = value["value"].as_f64()?;
    let rate = value["rate"]
        .as_f64()
        .filter(|rate| *rate > 0.0)
        .unwrap_or(project_fps.max(1.0));
    Some(amount / rate)
}

fn parse_fcpxml(text: &str, project_fps: f64) -> Result<ParsedTimeline, ProjectError> {
    let document = roxmltree::Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("el FCPXML no es XML válido: {error}").as_str(),
        )
    })?;
    let root = document.root_element();
    let mut assets: HashMap<String, (String, String)> = HashMap::new();
    for node in root.descendants().filter(|node| node.has_tag_name("asset")) {
        let Some(id) = node.attribute("id") else {
            continue;
        };
        let Some(src) = node
            .descendants()
            .find(|child| child.has_tag_name("media-rep"))
            .and_then(|media| media.attribute("src"))
        else {
            continue;
        };
        let name = node.attribute("name").unwrap_or(id);
        assets.insert(id.to_owned(), (src.to_owned(), name.to_owned()));
    }
    let Some(spine) = root.descendants().find(|node| node.has_tag_name("spine")) else {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "el FCPXML no tiene una spine",
        ));
    };
    let mut parsed = ParsedTimeline {
        fps: root
            .descendants()
            .find(|node| node.has_tag_name("format"))
            .and_then(|node| node.attribute("frameDuration"))
            .and_then(|duration| fcpxml_time(duration, project_fps))
            .and_then(|duration| (duration > 0.0).then(|| 1.0 / duration)),
        ..Default::default()
    };
    parsed.tracks.push(ParsedTrack {
        label: "FCPXML".to_owned(),
        kind: TrackKind::Video,
    });
    let mut cursor = 0.0;
    for child in spine.children().filter(|node| node.is_element()) {
        if child.has_tag_name("gap") {
            let duration = child
                .attribute("duration")
                .and_then(|value| fcpxml_time(value, project_fps))
                .unwrap_or(0.0);
            cursor = child
                .attribute("offset")
                .and_then(|value| fcpxml_time(value, project_fps))
                .map(|offset| offset + duration)
                .unwrap_or(cursor + duration);
            continue;
        }
        if child.has_tag_name("transition") {
            parsed
                .warnings
                .push("FCPXML: una transición se importó como corte".to_owned());
            continue;
        }
        if !child.has_tag_name("clip") {
            continue;
        }
        let start = child
            .attribute("offset")
            .and_then(|value| fcpxml_time(value, project_fps))
            .unwrap_or(cursor);
        let duration = child
            .attribute("duration")
            .and_then(|value| fcpxml_time(value, project_fps))
            .unwrap_or(0.0);
        if duration <= 0.0 {
            continue;
        }
        let source_in = child
            .attribute("start")
            .and_then(|value| fcpxml_time(value, project_fps))
            .unwrap_or(0.0);
        let media_ref = child
            .descendants()
            .find(|node| node.has_tag_name("video") || node.has_tag_name("audio"))
            .and_then(|node| node.attribute("ref"));
        let Some(media_ref) = media_ref else {
            parsed
                .warnings
                .push("FCPXML: un clip no referencia un asset".to_owned());
            continue;
        };
        let Some((media, asset_name)) = assets.get(media_ref) else {
            parsed
                .warnings
                .push(format!("FCPXML: falta el asset {media_ref}"));
            continue;
        };
        let label = child
            .attribute("name")
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(asset_name.as_str())
            .to_owned();
        if child.descendants().any(|node| node.has_tag_name("spine")) {
            parsed.warnings.push(format!(
                "FCPXML: {label} tiene clips conectados; no se importaron"
            ));
        }
        parsed.clips.push(ParsedClip {
            track_index: 0,
            label: label.clone(),
            start_seconds: start,
            source_in_seconds: source_in,
            duration_seconds: duration,
            media: Some(media.clone()),
            media_hint: Some(asset_name.clone()),
        });
        cursor = start + duration;
    }
    Ok(parsed)
}

fn fcpxml_time(raw: &str, fps: f64) -> Option<f64> {
    let value = raw.trim();
    let value = value.strip_suffix('s').unwrap_or(value);
    if let Some((numerator, denominator)) = value.split_once('/') {
        let numerator: f64 = numerator.trim().parse().ok()?;
        let denominator: f64 = denominator.trim().parse().ok()?;
        if denominator <= 0.0 {
            return None;
        }
        return Some(numerator / denominator);
    }
    if value.contains(':') {
        let frames = parse_timecode(value, fps.max(1.0).round() as u32)?;
        return Some(frames as f64 / fps.max(1.0));
    }
    value.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_our_edl_with_filename_and_clip_name() {
        let text = "TITLE: Demo\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:02:00 00:00:01:00 00:00:03:00\n* FROM CLIP NAME: Toma\n* FILENAME: media/toma.mp4\n";
        let parsed = parse_edl(text, 30);
        assert_eq!(parsed.tracks.len(), 1);
        assert_eq!(parsed.tracks[0].kind, TrackKind::Video);
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        assert_eq!(clip.label, "Toma");
        assert!((clip.start_seconds - 1.0).abs() < 0.001);
        assert!((clip.source_in_seconds - 0.0).abs() < 0.001);
        assert!((clip.duration_seconds - 2.0).abs() < 0.001);
        assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
    }

    #[test]
    fn parses_otio_track_with_gap() {
        let text = r#"{
          "OTIO_SCHEMA": "Timeline.1",
          "name": "Demo",
          "tracks": {
            "OTIO_SCHEMA": "Stack.1",
            "children": [{
              "OTIO_SCHEMA": "Track.1",
              "name": "V1",
              "kind": "Video",
              "children": [
                {"OTIO_SCHEMA":"Gap.1","source_range":{"start_time":{"value":0,"rate":30},"duration":{"value":15,"rate":30}}},
                {"OTIO_SCHEMA":"Clip.2","name":"Toma","source_range":{"start_time":{"value":30,"rate":30},"duration":{"value":60,"rate":30}},
                 "media_reference":{"OTIO_SCHEMA":"ExternalReference.1","target_url":"file:///media/toma.mp4",
                 "metadata":{"editor_ia":{"relative_path":"media/toma.mp4"}}}}
              ]
            }]
          }
        }"#;
        let parsed = parse_otio(text, 30.0).expect("OTIO");
        assert_eq!(parsed.tracks.len(), 1);
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        assert!((clip.start_seconds - 0.5).abs() < 0.001);
        assert!((clip.source_in_seconds - 1.0).abs() < 0.001);
        assert!((clip.duration_seconds - 2.0).abs() < 0.001);
        assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
    }

    #[test]
    fn parses_fcpxml_asset_gap_and_clip() {
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" start="0s" duration="2s" hasVideo="1">
            <media-rep kind="original-media" src="file:///media/toma.mp4"/>
          </asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <gap offset="0s" duration="1s"/>
            <clip offset="1s" duration="2s" name="Toma" start="0s">
              <video ref="r2" offset="0s" duration="2s"/>
            </clip>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
        let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        assert!((clip.start_seconds - 1.0).abs() < 0.001);
        assert!((clip.duration_seconds - 2.0).abs() < 0.001);
        assert_eq!(clip.media.as_deref(), Some("file:///media/toma.mp4"));
    }

    #[test]
    fn rejects_unsupported_extension() {
        assert!(detect_format(Path::new("demo.txt")).is_err());
        assert_eq!(detect_format(Path::new("demo.edl")).unwrap(), "edl");
        assert_eq!(detect_format(Path::new("demo.otio")).unwrap(), "otio");
        assert_eq!(detect_format(Path::new("demo.fcpxml")).unwrap(), "fcpxml");
    }

    #[test]
    #[ignore = "requiere ffmpeg/ffprobe y un video de prueba"]
    fn imports_real_otio_and_fcpxml_with_media() {
        let dir = std::env::temp_dir().join(format!("editoria-timeline-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("toma.mp4");
        let generated = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=160x90:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg");
        assert!(generated.success());
        let project = json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [],
            "timeline": { "tracks": [], "clips": [] }
        });
        let otio = dir.join("demo.otio");
        std::fs::write(
            &otio,
            r#"{"OTIO_SCHEMA":"Timeline.1","name":"Demo","tracks":{"OTIO_SCHEMA":"Stack.1","children":[{"OTIO_SCHEMA":"Track.1","name":"V1","kind":"Video","children":[{"OTIO_SCHEMA":"Clip.2","name":"Toma","source_range":{"start_time":{"value":0,"rate":30},"duration":{"value":60,"rate":30}},"media_reference":{"OTIO_SCHEMA":"ExternalReference.1","target_url":"file:///media/toma.mp4","metadata":{"editor_ia":{"relative_path":"media/toma.mp4"}}}}]}]}}"#,
        )
        .expect("otio");
        let fcpxml = dir.join("demo.fcpxml");
        std::fs::write(
            &fcpxml,
            r#"<?xml version="1.0" encoding="UTF-8"?>
            <fcpxml version="1.11"><resources>
              <format id="r1" frameDuration="1/30s" width="160" height="90"/>
              <asset id="r2" name="Toma" start="0s" duration="2s" hasVideo="1">
                <media-rep kind="original-media" src="file:///media/toma.mp4"/>
              </asset>
            </resources><library><event name="E"><project name="P">
              <sequence format="r1" duration="2s"><spine>
                <clip offset="0s" duration="2s" name="Toma" start="0s">
                  <video ref="r2" offset="0s" duration="2s"/>
                </clip>
              </spine></sequence>
            </project></event></library></fcpxml>"#,
        )
        .expect("fcpxml");
        for (path, format) in [(&otio, "otio"), (&fcpxml, "fcpxml")] {
            let result =
                import_timeline_file(&dir, Path::new("ffprobe"), path, &project).expect("importar");
            assert_eq!(result.format, format);
            assert_eq!(result.imported_clips, 1);
            assert_eq!(result.tracks.len(), 1);
            assert_eq!(result.clips.len(), 1);
            assert!(result.assets[0]["source"]["path"]
                .as_str()
                .unwrap()
                .starts_with("media/"));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    #[ignore = "requiere ffmpeg/ffprobe y un video de prueba"]
    fn imports_a_real_edl_and_copies_media() {
        let dir = std::env::temp_dir().join(format!("editoria-timeline-{}", Uuid::new_v4()));
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media");
        let video = media.join("toma.mp4");
        let generated = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=160x90:d=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&video)
            .status()
            .expect("ffmpeg");
        assert!(generated.success());
        let timeline = dir.join("demo.edl");
        std::fs::write(
            &timeline,
            "TITLE: Demo\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n* FROM CLIP NAME: Toma\n* FILENAME: media/toma.mp4\n",
        )
        .expect("edl");
        let project = json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [],
            "timeline": { "tracks": [], "clips": [] }
        });
        let result = import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project)
            .expect("importar");
        assert_eq!(result.format, "edl");
        assert_eq!(result.imported_clips, 1);
        assert_eq!(result.new_assets, 1);
        assert_eq!(result.tracks.len(), 1);
        assert_eq!(result.clips.len(), 1);
        assert!(result.assets[0]["source"]["path"]
            .as_str()
            .unwrap()
            .starts_with("media/"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
