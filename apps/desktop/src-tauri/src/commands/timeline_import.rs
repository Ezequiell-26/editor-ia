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
/// Un EDL/OTIO/FCPXML real es de KB; el tope evita cargar un binario gigante
/// en memoria cuando el usuario elige el archivo equivocado.
const MAX_TIMELINE_BYTES: u64 = 32 * 1024 * 1024;

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
    /// Retime del clip en la timeline (OTIO `LinearTimeWarp`); 1/1 si no hay.
    speed_num: u32,
    speed_den: u32,
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

fn parse_edl(text: &str, fps: f64) -> ParsedTimeline {
    let mut parsed = ParsedTimeline::default();
    let mut tracks: HashMap<String, usize> = HashMap::new();
    let mut events: Vec<EdlEvent> = Vec::new();
    let mut last: Option<EdlEvent> = None;
    // El timecode cuenta cuadros al fps nominal (30 para 29.97), pero cada
    // cuadro dura 1/fps real: dividir por 30 desplazaba el proyecto 3,6 s
    // por hora en 29.97.
    let fps = fps.max(1.0);
    let nominal = fps.round().max(1.0) as u32;
    let mut header_drop_frame = false;
    let mut unsupported_drop_frame = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("TITLE:")
            || trimmed.starts_with("AUDIO:")
            || trimmed.starts_with("VIDEO:")
        {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("FCM:") {
            // `NON-DROP FRAME` contiene `DROP`; sólo cuenta si empieza con él.
            header_drop_frame = value.trim().to_ascii_uppercase().starts_with("DROP");
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
        // Drop-frame sólo existe en 29.97/59.94; en otro fps se lee NDF y
        // se avisa una sola vez, no por cada evento.
        let uses_drop_frame = (header_drop_frame
            || tokens[4..8].iter().any(|token| token.contains(';')))
            && matches!(nominal, 30 | 60);
        if (header_drop_frame || tokens[4..8].iter().any(|token| token.contains(';')))
            && !uses_drop_frame
        {
            unsupported_drop_frame = true;
        }
        let Some(source_in) = parse_timecode(tokens[4], nominal, uses_drop_frame) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de origen inválido", tokens[0]));
            continue;
        };
        let Some(source_out) = parse_timecode(tokens[5], nominal, uses_drop_frame) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de origen inválido", tokens[0]));
            continue;
        };
        let Some(record_in) = parse_timecode(tokens[6], nominal, uses_drop_frame) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de récord inválido", tokens[0]));
            continue;
        };
        let Some(record_out) = parse_timecode(tokens[7], nominal, uses_drop_frame) else {
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
    }
    if unsupported_drop_frame {
        parsed.warnings.push(format!(
            "el EDL usa drop-frame a {nominal} fps; sólo aplica a 29.97/59.94, se interpreta NDF"
        ));
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
            speed_num: 1,
            speed_den: 1,
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

fn parse_timecode(value: &str, fps: u32, drop_frame: bool) -> Option<u64> {
    let cleaned = value.replace(';', ":");
    let parts: Vec<&str> = cleaned.split(':').collect();
    if parts.len() != 4 {
        return None;
    }
    let hours: u64 = parts[0].parse().ok()?;
    let minutes: u64 = parts[1].parse().ok()?;
    let seconds: u64 = parts[2].parse().ok()?;
    let frames: u64 = parts[3].parse().ok()?;
    let nominal = fps.max(1) as u64;
    if minutes >= 60 || seconds >= 60 || frames >= nominal {
        return None;
    }
    let total_minutes = hours * 60 + minutes;
    let base = (total_minutes * 60 + seconds) * nominal + frames;
    if !drop_frame {
        return Some(base);
    }
    let dropped = if nominal >= 60 { 4 } else { 2 };
    // En drop-frame no existen los frames 0..dropped al inicio de cada
    // minuto, salvo cada 10 minutos; ese timecode está fuera de norma.
    if seconds == 0 && frames < dropped && total_minutes % 10 != 0 {
        return None;
    }
    Some(base - dropped * (total_minutes - total_minutes / 10))
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

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let rest = a % b;
        a = b;
        b = rest;
    }
    a.max(1)
}

/// Aproxima un retime a una fracción simple (2× → 2/1, 1,5× → 3/2).
fn rational_speed(value: f64) -> Option<(u32, u32)> {
    if !value.is_finite() || !(0.01..=100.0).contains(&value) {
        return None;
    }
    let numerator = (value * 1000.0).round().max(1.0) as u32;
    let divisor = gcd(numerator, 1000);
    Some((numerator / divisor, 1000 / divisor))
}

/// Lee el retime de un clip OTIO (`LinearTimeWarp.1`) y avisa de los efectos
/// que el importador no puede representar, para no perderlos en silencio.
fn otio_speed(child: &Value) -> (u32, u32, Vec<String>) {
    let label = child["name"].as_str().unwrap_or("clip");
    let mut speed = (1u32, 1u32);
    let mut warnings = Vec::new();
    for effect in child["effects"].as_array().into_iter().flatten() {
        let schema = effect["OTIO_SCHEMA"].as_str().unwrap_or("");
        if schema.starts_with("LinearTimeWarp") {
            match effect["time_scalar"].as_f64().and_then(rational_speed) {
                Some(pair) => speed = pair,
                None => warnings.push(format!(
                    "OTIO: {label} tiene un time warp inválido; se importa a 100%"
                )),
            }
        } else if !schema.is_empty() {
            warnings.push(format!("OTIO: el efecto {schema} de {label} no se importa"));
        }
    }
    (speed.0, speed.1, warnings)
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
        let (speed_num, speed_den, mut speed_warnings) = otio_speed(child);
        parsed.warnings.append(&mut speed_warnings);
        let timeline_duration = duration * speed_den as f64 / speed_num.max(1) as f64;
        parsed.clips.push(ParsedClip {
            track_index,
            label: label.clone(),
            start_seconds: cursor,
            source_in_seconds: source_in,
            duration_seconds: timeline_duration,
            speed_num,
            speed_den,
            media,
            media_hint: Some(label),
        });
        cursor += timeline_duration;
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

type FcpxmlAssets = HashMap<String, (String, String, bool)>;

fn fcpxml_track(
    parsed: &mut ParsedTimeline,
    slot: &mut Option<usize>,
    kind: TrackKind,
    label: &str,
) -> usize {
    if let Some(index) = *slot {
        return index;
    }
    parsed.tracks.push(ParsedTrack {
        label: label.to_owned(),
        kind,
    });
    let index = parsed.tracks.len() - 1;
    *slot = Some(index);
    index
}

/// Lee un `<clip>`/`<asset-clip>` de FCPXML. `Ok(None)` es un clip sin
/// duración que se ignora en silencio; `Err` es un aviso para el usuario.
fn read_fcpxml_item(
    node: roxmltree::Node<'_, '_>,
    start_seconds: f64,
    assets: &FcpxmlAssets,
    project_fps: f64,
) -> Result<Option<(ParsedClip, bool)>, String> {
    let duration = node
        .attribute("duration")
        .and_then(|value| fcpxml_time(value, project_fps))
        .unwrap_or(0.0);
    if duration <= 0.0 {
        return Ok(None);
    }
    let source_in = node
        .attribute("start")
        .or_else(|| node.attribute("audioStart"))
        .and_then(|value| fcpxml_time(value, project_fps))
        .unwrap_or(0.0);
    let media_ref = node.attribute("ref").or_else(|| {
        node.descendants()
            .find(|child| child.has_tag_name("video") || child.has_tag_name("audio"))
            .and_then(|child| child.attribute("ref"))
    });
    let Some(media_ref) = media_ref else {
        return Err("FCPXML: un clip no referencia un asset".to_owned());
    };
    let Some((media, asset_name, has_video)) = assets.get(media_ref) else {
        return Err(format!("FCPXML: falta el asset {media_ref}"));
    };
    let label = node
        .attribute("name")
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(asset_name.as_str())
        .to_owned();
    Ok(Some((
        ParsedClip {
            track_index: 0,
            label,
            start_seconds,
            source_in_seconds: source_in,
            duration_seconds: duration,
            speed_num: 1,
            speed_den: 1,
            media: Some(media.clone()),
            media_hint: Some(asset_name.clone()),
        },
        *has_video,
    )))
}

/// Importa los lanes conectados de audio de un ancla (clip o hueco). El
/// `offset` del lane es relativo al inicio del ancla. Devuelve `true` si había
/// lanes que no se pudieron importar (video, títulos u otros).
fn read_fcpxml_lanes(
    node: roxmltree::Node<'_, '_>,
    anchor_start: f64,
    assets: &FcpxmlAssets,
    project_fps: f64,
    parsed: &mut ParsedTimeline,
    audio_track: &mut Option<usize>,
) -> bool {
    let mut skipped = node
        .descendants()
        .any(|child| child.has_attribute("lane") && !child.has_tag_name("asset-clip"));
    for lane in node
        .children()
        .filter(|child| child.has_tag_name("asset-clip") && child.has_attribute("lane"))
    {
        let negative_lane = lane
            .attribute("lane")
            .and_then(|value| value.trim().parse::<i32>().ok())
            .map(|value| value < 0)
            .unwrap_or(false);
        let offset = lane
            .attribute("offset")
            .and_then(|value| fcpxml_time(value, project_fps))
            .unwrap_or(0.0);
        match read_fcpxml_item(lane, anchor_start + offset, assets, project_fps) {
            Ok(Some((mut item, lane_has_video))) if !lane_has_video && negative_lane => {
                item.track_index =
                    fcpxml_track(parsed, audio_track, TrackKind::Audio, "FCPXML audio");
                parsed.clips.push(item);
            }
            Ok(Some(_)) => skipped = true,
            Ok(None) => {}
            Err(message) => parsed.warnings.push(message),
        }
    }
    skipped
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
    // `hasVideo` decide si el clip va a la pista de video o a la de audio;
    // Final Cut exporta la storyline con `<asset-clip>`, no con `<clip>`.
    let mut assets: FcpxmlAssets = HashMap::new();
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
        let has_video = node
            .attribute("hasVideo")
            .map(|value| value != "0" && value != "false")
            .unwrap_or(true);
        assets.insert(id.to_owned(), (src.to_owned(), name.to_owned(), has_video));
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
    let mut video_track: Option<usize> = None;
    let mut audio_track: Option<usize> = None;
    let mut cursor = 0.0;
    for child in spine.children().filter(|node| node.is_element()) {
        if child.has_tag_name("gap") {
            let duration = child
                .attribute("duration")
                .and_then(|value| fcpxml_time(value, project_fps))
                .unwrap_or(0.0);
            let gap_start = child
                .attribute("offset")
                .and_then(|value| fcpxml_time(value, project_fps))
                .unwrap_or(cursor);
            // Un hueco también puede anclar música conectada (por ejemplo,
            // una cortina que arranca en negro antes del primer clip).
            if read_fcpxml_lanes(
                child,
                gap_start,
                &assets,
                project_fps,
                &mut parsed,
                &mut audio_track,
            ) {
                parsed.warnings.push(format!(
                    "FCPXML: el hueco en {gap_start:.2}s tiene lanes conectados de video o títulos; no se importaron"
                ));
            }
            cursor = gap_start + duration;
            continue;
        }
        if child.has_tag_name("transition") {
            parsed
                .warnings
                .push("FCPXML: una transición se importó como corte".to_owned());
            continue;
        }
        if !(child.has_tag_name("clip") || child.has_tag_name("asset-clip")) {
            continue;
        }
        let start = child
            .attribute("offset")
            .and_then(|value| fcpxml_time(value, project_fps))
            .unwrap_or(cursor);
        let (mut clip, has_video) = match read_fcpxml_item(child, start, &assets, project_fps) {
            Ok(Some(item)) => item,
            Ok(None) => continue,
            Err(message) => {
                parsed.warnings.push(message);
                continue;
            }
        };
        if child.descendants().any(|node| node.has_tag_name("spine")) {
            parsed.warnings.push(format!(
                "FCPXML: {} tiene un stack anidado; no se importó",
                clip.label
            ));
        }
        clip.track_index = if has_video {
            fcpxml_track(&mut parsed, &mut video_track, TrackKind::Video, "FCPXML")
        } else {
            fcpxml_track(
                &mut parsed,
                &mut audio_track,
                TrackKind::Audio,
                "FCPXML audio",
            )
        };
        let anchor_start = clip.start_seconds;
        let anchor_duration = clip.duration_seconds;
        parsed.clips.push(clip);
        // Los lanes conectados llevan la música y la voz; su `offset` es
        // relativo al inicio del clip ancla, no a la timeline.
        if read_fcpxml_lanes(
            child,
            anchor_start,
            &assets,
            project_fps,
            &mut parsed,
            &mut audio_track,
        ) {
            parsed.warnings.push(format!(
                "FCPXML: el clip {anchor_start:.2}s tiene lanes conectados de video o títulos; no se importaron"
            ));
        }
        cursor = anchor_start + anchor_duration;
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
        let frames = parse_timecode(value, fps.max(1.0).round() as u32, false)?;
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
        let parsed = parse_edl(text, 30.0);
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
    fn edl_drop_frame_skips_the_smpte_dropped_frames() {
        let text = "TITLE: DF\nFCM: DROP FRAME\n\n001  AX       V     C        00:10:00;00 00:10:01;00 00:10:00;00 00:10:01;00\n* FROM CLIP NAME: Toma\n";
        let fps = 30000.0 / 1001.0;
        let parsed = parse_edl(text, fps);
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        // 00:10:00;00 es el cuadro 17982, no 18000: dos por minuto salvo
        // cada décimo. Al volver al proyecto debe caer en el mismo cuadro.
        assert_eq!(seconds_to_frames(clip.start_seconds, fps), 17982);
        assert_eq!(seconds_to_frames(clip.source_in_seconds, fps), 17982);
        assert_eq!(seconds_to_frames(clip.duration_seconds, fps), 30);
        assert!(
            parsed.warnings.is_empty(),
            "el drop-frame no debe advertir: {:?}",
            parsed.warnings
        );
    }

    #[test]
    fn edl_drop_frame_rejects_a_timecode_that_does_not_exist() {
        // 00:01:00;00 no existe en drop-frame: los cuadros 0 y 1 se saltean
        // al minuto 1, así que se descarta el evento en vez de inventarlo.
        let text = "TITLE: DF\nFCM: DROP FRAME\n\n001  AX       V     C        00:00:00;00 00:00:01;00 00:01:00;00 00:01:01;00\n";
        let parsed = parse_edl(text, 30000.0 / 1001.0);
        assert!(parsed.clips.is_empty());
        assert!(
            parsed
                .warnings
                .iter()
                .any(|warning| warning.contains("récord inválido")),
            "{:?}",
            parsed.warnings
        );
    }

    #[test]
    fn edl_timecodes_without_drop_frame_convert_with_the_real_fps() {
        let text = "TITLE: NDF\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:10:00:00 00:10:01:00 00:10:00:00 00:10:01:00\n";
        let fps = 30000.0 / 1001.0;
        let parsed = parse_edl(text, fps);
        assert_eq!(parsed.clips.len(), 1);
        // NDF no saltea cuadros: 00:10:00:00 son 18000 cuadros reales.
        assert_eq!(seconds_to_frames(parsed.clips[0].start_seconds, fps), 18000);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    }

    #[test]
    fn edl_drop_frame_warns_once_when_the_rate_cannot_drop() {
        let text = "TITLE: DF25\nFCM: DROP FRAME\n\n001  AX       V     C        00:00:00;00 00:00:01;00 00:00:00;00 00:00:01;00\n002  AX       V     C        00:00:01;00 00:00:02;00 00:00:01;00 00:00:02;00\n";
        let parsed = parse_edl(text, 25.0);
        assert_eq!(parsed.clips.len(), 2);
        assert_eq!(
            parsed
                .warnings
                .iter()
                .filter(|warning| warning.contains("drop-frame a 25 fps"))
                .count(),
            1,
            "el aviso debe salir una vez, no por evento: {:?}",
            parsed.warnings
        );
        assert!((parsed.clips[0].duration_seconds - 1.0).abs() < 0.001);
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

    fn otio_with_effect(effect: &str) -> String {
        format!(
            r#"{{
              "OTIO_SCHEMA": "Timeline.1",
              "tracks": {{
                "OTIO_SCHEMA": "Stack.1",
                "children": [{{
                  "OTIO_SCHEMA": "Track.1",
                  "name": "V1",
                  "kind": "Video",
                  "children": [{{
                    "OTIO_SCHEMA": "Clip.2",
                    "name": "Toma",
                    "source_range": {{"start_time": {{"value": 0, "rate": 30}}, "duration": {{"value": 60, "rate": 30}}}},
                    "media_reference": {{"OTIO_SCHEMA": "ExternalReference.1", "target_url": "file:///media/toma.mp4"}},
                    "effects": [{effect}]
                  }}]
                }}]
              }}
            }}"#
        )
    }

    #[test]
    fn parses_otio_linear_time_warp_as_clip_speed() {
        let parsed = parse_otio(
            &otio_with_effect(
                r#"{"OTIO_SCHEMA": "LinearTimeWarp.1", "name": "2x", "time_scalar": 2.0}"#,
            ),
            30.0,
        )
        .expect("OTIO");
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        // 60 cuadros de medio a 2× duran 1 s en la timeline.
        assert!((clip.duration_seconds - 1.0).abs() < 0.001, "{clip:?}");
        assert_eq!((clip.speed_num, clip.speed_den), (2, 1));
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);

        let slow = parse_otio(
            &otio_with_effect(
                r#"{"OTIO_SCHEMA": "LinearTimeWarp.1", "name": "0.5x", "time_scalar": 0.5}"#,
            ),
            30.0,
        )
        .expect("OTIO");
        let clip = &slow.clips[0];
        assert!((clip.duration_seconds - 4.0).abs() < 0.001, "{clip:?}");
        assert_eq!((clip.speed_num, clip.speed_den), (1, 2));
    }

    #[test]
    fn warns_about_otio_effects_it_cannot_import() {
        let parsed = parse_otio(
            &otio_with_effect(r#"{"OTIO_SCHEMA": "FreezeFrame.1", "name": "Freeze"}"#),
            30.0,
        )
        .expect("OTIO");
        assert_eq!(parsed.clips.len(), 1);
        assert!(
            parsed
                .warnings
                .iter()
                .any(|warning| warning.contains("FreezeFrame.1")
                    && warning.contains("no se importa")),
            "{:?}",
            parsed.warnings
        );
        assert!((parsed.clips[0].duration_seconds - 2.0).abs() < 0.001);
        assert_eq!(
            (parsed.clips[0].speed_num, parsed.clips[0].speed_den),
            (1, 1)
        );
    }

    #[test]
    fn imported_otio_speed_reaches_the_clip_json() {
        let dir = std::env::temp_dir().join(format!("editoria-otio-speed-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).expect("media");
        std::fs::write(dir.join("media").join("toma.mp4"), b"").expect("medio");
        let timeline = dir.join("demo.otio");
        std::fs::write(
            &timeline,
            otio_with_effect(
                r#"{"OTIO_SCHEMA": "LinearTimeWarp.1", "name": "2x", "time_scalar": 2.0}"#,
            ),
        )
        .expect("otio");
        let project = json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "status": "ready",
                "source": { "path": "media/toma.mp4" },
                "media": { "durationFrames": 300 }
            }],
            "timeline": { "tracks": [], "clips": [] }
        });
        let result = import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project)
            .expect("importar");
        assert_eq!(result.clips.len(), 1);
        let clip = &result.clips[0];
        // 60 cuadros de medio a 2× → 30 en la timeline y 60 de medio consumido.
        assert_eq!(clip["durationFrames"], 30, "{clip}");
        assert_eq!(clip["source"]["inFrame"], 0);
        assert_eq!(clip["source"]["outFrame"], 60);
        assert_eq!(clip["speed"]["num"], 2);
        assert_eq!(clip["speed"]["den"], 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_timeline_file_over_the_size_limit() {
        let dir = std::env::temp_dir().join(format!("editoria-import-big-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let path = dir.join("grande.edl");
        let file = std::fs::File::create(&path).expect("archivo");
        file.set_len(MAX_TIMELINE_BYTES + 1).expect("tamaño");
        drop(file);
        let project = json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [],
            "timeline": { "tracks": [], "clips": [] }
        });
        let error = import_timeline_file(&dir, Path::new("ffprobe"), &path, &project)
            .expect_err("un archivo de 32 MB no debe leerse");
        assert!(
            error.message.contains("32 MB"),
            "mensaje inesperado: {}",
            error.message
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_import_error_keeps_the_skip_reasons() {
        let dir = std::env::temp_dir().join(format!("editoria-import-empty-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let timeline = dir.join("demo.edl");
        std::fs::write(
            &timeline,
            "TITLE: Falta\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n* FROM CLIP NAME: Perdida\n* FILENAME: media/falta.mp4\n",
        )
        .expect("edl");
        let project = json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [],
            "timeline": { "tracks": [], "clips": [] }
        });
        let error = import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project)
            .expect_err("sin medios no se importa nada");
        assert_eq!(error.code.name(), "EMPTY_TIMELINE");
        assert!(
            error.message.contains("no se encontró el medio"),
            "el error debe conservar el motivo: {}",
            error.message
        );
        let _ = std::fs::remove_dir_all(&dir);
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
    fn parses_final_cut_asset_clips() {
        // Final Cut exporta la storyline con `<asset-clip ref=...>`; el
        // importador sólo leía `<clip><video ref=...>` y devolvía vacío.
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" start="0s" duration="3s" hasVideo="1" hasAudio="1">
            <media-rep kind="original-media" src="file:///media/toma.mp4"/>
          </asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <asset-clip ref="r2" offset="0s" duration="2s" start="1s" name="Toma"/>
            <gap offset="2s" duration="1s"/>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
        let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
        assert_eq!(parsed.clips.len(), 1);
        assert_eq!(parsed.tracks.len(), 1);
        assert_eq!(parsed.tracks[0].kind, TrackKind::Video);
        let clip = &parsed.clips[0];
        assert!((clip.start_seconds - 0.0).abs() < 0.001, "{clip:?}");
        assert!((clip.source_in_seconds - 1.0).abs() < 0.001, "{clip:?}");
        assert!((clip.duration_seconds - 2.0).abs() < 0.001, "{clip:?}");
        assert_eq!(clip.label, "Toma");
        assert_eq!(clip.media.as_deref(), Some("file:///media/toma.mp4"));
    }

    #[test]
    fn parses_an_audio_only_asset_clip_into_an_audio_track() {
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Música" hasVideo="0" hasAudio="1"><media-rep src="file:///media/musica.wav"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <asset-clip ref="r2" offset="0s" duration="2s" name="Toma"/>
            <asset-clip ref="r3" offset="0s" duration="3s" name="Música"/>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
        let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
        assert_eq!(parsed.clips.len(), 2);
        assert_eq!(parsed.tracks.len(), 2);
        let video = &parsed.clips[0];
        let audio = &parsed.clips[1];
        assert_eq!(parsed.tracks[video.track_index].kind, TrackKind::Video);
        assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
        assert_eq!(audio.media.as_deref(), Some("file:///media/musica.wav"));
    }

    #[test]
    fn imports_connected_audio_lanes_with_the_anchor_offset() {
        // Final Cut guarda la música en un lane conectado; su offset es
        // relativo al clip ancla y `audioStart` marca el origen del audio.
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Música" hasVideo="0" hasAudio="1"><media-rep src="file:///media/musica.wav"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <asset-clip ref="r2" offset="1s" duration="2s" name="Toma">
              <asset-clip lane="-1" ref="r3" offset="0.5s" duration="1s" start="0.25s" audioStart="0.25s" name="Música"/>
            </asset-clip>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
        let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
        assert_eq!(parsed.clips.len(), 2, "{:?}", parsed.warnings);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
        let audio = parsed
            .clips
            .iter()
            .find(|clip| clip.label == "Música")
            .expect("falta el clip de audio conectado");
        assert!((audio.start_seconds - 1.5).abs() < 0.001, "{audio:?}");
        assert!((audio.source_in_seconds - 0.25).abs() < 0.001, "{audio:?}");
        assert!((audio.duration_seconds - 1.0).abs() < 0.001, "{audio:?}");
        assert_eq!(audio.media.as_deref(), Some("file:///media/musica.wav"));
        assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
        let video = parsed
            .clips
            .iter()
            .find(|clip| clip.label == "Toma")
            .expect("falta el clip ancla");
        assert_eq!(parsed.tracks[video.track_index].kind, TrackKind::Video);
    }

    #[test]
    fn imports_audio_lanes_anchored_to_a_gap() {
        // Una cortina musical puede arrancar sobre un hueco, antes del primer
        // clip; sin leer los lanes del gap esa música se perdía.
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Cortina" hasVideo="0" hasAudio="1"><media-rep src="file:///media/cortina.wav"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <gap offset="0s" duration="2s">
              <asset-clip lane="-1" ref="r3" offset="0.5s" duration="1s" start="0.2s" name="Cortina"/>
            </gap>
            <asset-clip ref="r2" offset="2s" duration="1s" name="Toma"/>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
        let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
        assert_eq!(parsed.clips.len(), 2, "{:?}", parsed.warnings);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
        let audio = parsed
            .clips
            .iter()
            .find(|clip| clip.label == "Cortina")
            .expect("falta la música anclada al hueco");
        assert!((audio.start_seconds - 0.5).abs() < 0.001, "{audio:?}");
        assert!((audio.source_in_seconds - 0.2).abs() < 0.001, "{audio:?}");
        assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
        let video = parsed
            .clips
            .iter()
            .find(|clip| clip.label == "Toma")
            .expect("falta el clip después del hueco");
        assert!((video.start_seconds - 2.0).abs() < 0.001, "{video:?}");
    }

    #[test]
    fn warns_about_connected_video_lanes() {
        let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Overlay" hasVideo="1"><media-rep src="file:///media/overlay.mp4"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="2s"><spine>
            <asset-clip ref="r2" offset="0s" duration="2s" name="Toma">
              <asset-clip lane="1" ref="r3" offset="0s" duration="1s" name="Overlay"/>
            </asset-clip>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
        let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
        assert_eq!(parsed.clips.len(), 1);
        assert_eq!(parsed.clips[0].label, "Toma");
        assert!(
            parsed
                .warnings
                .iter()
                .any(|warning| warning.contains("lanes conectados de video")),
            "{:?}",
            parsed.warnings
        );
    }

    #[test]
    fn rejects_unsupported_extension() {
        assert!(detect_format(Path::new("demo.txt")).is_err());
        assert_eq!(detect_format(Path::new("demo.edl")).unwrap(), "edl");
        assert_eq!(detect_format(Path::new("demo.otio")).unwrap(), "otio");
        assert_eq!(detect_format(Path::new("demo.fcpxml")).unwrap(), "fcpxml");
    }

    #[test]
    fn our_edl_export_round_trips_timing_and_media() {
        let project = serde_json::json!({
            "name": "Round",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "startFrame": 30,
                "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 15, "outFrame": 75 }
            }] }
        });
        let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let exported = crate::commands::edl::export_edl(crate::commands::edl::EdlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar EDL");
        let text = std::fs::read_to_string(&exported.path).expect("leer");
        let parsed = parse_edl(&text, 30.0);
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        assert!((clip.start_seconds - 1.0).abs() < 0.001, "{clip:?}");
        assert!((clip.source_in_seconds - 0.5).abs() < 0.001, "{clip:?}");
        assert!((clip.duration_seconds - 2.0).abs() < 0.001, "{clip:?}");
        assert_eq!(clip.label, "Toma");
        assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn our_edl_export_round_trips_ntsc_frames() {
        let project = serde_json::json!({
            "name": "Ntsc",
            "video": { "frameRate": { "num": 30000, "den": 1001 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "startFrame": 30,
                "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 15, "outFrame": 75 }
            }] }
        });
        let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let exported = crate::commands::edl::export_edl(crate::commands::edl::EdlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar EDL");
        let text = std::fs::read_to_string(&exported.path).expect("leer");
        let fps = 30000.0 / 1001.0;
        let parsed = parse_edl(&text, fps);
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        // El EDL escribe NDF a 30 nominal; al leerlo con el fps real los
        // cuadros tienen que volver exactos, sin deriva de 3,6 s por hora.
        assert_eq!(seconds_to_frames(clip.start_seconds, fps), 30, "{clip:?}");
        assert_eq!(seconds_to_frames(clip.source_in_seconds, fps), 15);
        assert_eq!(seconds_to_frames(clip.duration_seconds, fps), 60);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_real_drop_frame_edl_from_resolve_or_premiere() {
        // EDL exportado por Resolve/Premiere con `FCM: DROP FRAME` y separador ;:
        // 00:10:00;00 es el cuadro 17982 (no 18000) porque faltan dos cuadros por
        // minuto salvo cada décimo: `(10*60 - 10/10)*2` = 11980 cuadros omitidos.
        let edl_text = r#"TITLE: Drop Frame Test
FCM: DROP FRAME

001  TEMA      V     C        00:10:00;00 00:10:02;00 00:10:00;00 00:10:02;00
* FROM CLIP NAME: Toma DF
* FILENAME: toma.mp4
"#;
        let fps_num = 30000u64;
        let fps_den = 1001u64;
        let fps = fps_num as f64 / fps_den as f64;
        let parsed = parse_edl(edl_text, fps);
        assert_eq!(parsed.clips.len(), 1, "{:?}", parsed.warnings);
        let clip = &parsed.clips[0];
        // La espera era 10 min * 30 fps ≈ 18000 frames, pero en DF faltan 18 cuadros:
        // el timecode correcto es **17982**.
        let expected_start_frame = 17982u64;
        let actual_start_frame = seconds_to_frames(clip.start_seconds, fps);
        assert_eq!(
            actual_start_frame, expected_start_frame,
            "DF debe dar 17982, no {}",
            actual_start_frame
        );
        // 60 frames a 29.97 = 2.002 s exactos (60/29.97); "2 segundos" de
        // timecode DF nunca son 2.000 s en segundos reales.
        assert!(
            (clip.duration_seconds - 60.0 / fps).abs() < 0.001,
            "duración 60 frames a 29.97 ≈ 2.002s: {:?}",
            clip.duration_seconds
        );
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    }

    #[test]
    fn warns_if_drop_frame_applies_to_non_29_97_rate() {
        // Drop-frame sólo existe en 29.97/59.94; en otro fps se lee NDF y avisa una vez.
        let edl_text = r#"TITLE: DF25
FCM: DROP FRAME

001  TEMA      V     C        00:00:00;00 00:00:01;00 00:00:00;00 00:00:01;00
"#;
        let parsed = parse_edl(edl_text, 25.0);
        assert_eq!(parsed.clips.len(), 1);
        assert!(
            parsed
                .warnings
                .iter()
                .any(|warning| warning.contains("drop-frame a 25 fps")
                    && warning.contains("se interpreta NDF")),
            "debe avisar una sola vez: {:?}",
            parsed.warnings
        );
    }

    #[test]
    fn our_otio_export_round_trips_gap_and_media() {
        let project = serde_json::json!({
            "name": "Round",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": {
                "tracks": [{ "id": "v1", "name": "V1", "kind": "video", "hidden": false }],
                "clips": [{
                    "id": "c", "kind": "video", "label": "Toma", "trackId": "v1",
                    "startFrame": 30, "durationFrames": 60,
                    "source": { "type": "asset", "assetId": "a", "inFrame": 15, "outFrame": 75 }
                }]
            }
        });
        let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let exported = crate::commands::otio::export_otio(crate::commands::otio::OtioRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar OTIO");
        let text = std::fs::read_to_string(&exported.path).expect("leer");
        let parsed = parse_otio(&text, 30.0).expect("parsear OTIO");
        assert_eq!(parsed.clips.len(), 1);
        let clip = &parsed.clips[0];
        assert!((clip.start_seconds - 1.0).abs() < 0.001, "{clip:?}");
        assert!((clip.source_in_seconds - 0.5).abs() < 0.001, "{clip:?}");
        assert!((clip.duration_seconds - 2.0).abs() < 0.001, "{clip:?}");
        assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn our_otio_export_round_trips_speed() {
        let project = serde_json::json!({
            "name": "RoundSpeed",
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": {
                "tracks": [{ "id": "v1", "name": "V1", "kind": "video", "hidden": false }],
                "clips": [{
                    "id": "c", "kind": "video", "label": "Rápida", "trackId": "v1",
                    "startFrame": 0, "durationFrames": 30,
                    "speed": { "num": 2, "den": 1 },
                    "source": { "type": "asset", "assetId": "a", "inFrame": 5, "outFrame": 65 }
                }]
            }
        });
        let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let exported = crate::commands::otio::export_otio(crate::commands::otio::OtioRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar OTIO");
        let text = std::fs::read_to_string(&exported.path).expect("leer");
        let parsed = parse_otio(&text, 30.0).expect("parsear OTIO");
        assert_eq!(parsed.clips.len(), 1, "{:?}", parsed.warnings);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
        let clip = &parsed.clips[0];
        assert!((clip.start_seconds - 0.0).abs() < 0.001, "{clip:?}");
        assert!(
            (clip.source_in_seconds - 5.0 / 30.0).abs() < 0.001,
            "{clip:?}"
        );
        assert!((clip.duration_seconds - 1.0).abs() < 0.001, "{clip:?}");
        assert_eq!((clip.speed_num, clip.speed_den), (2, 1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn our_fcpxml_export_round_trips_gaps_and_media() {
        let project = serde_json::json!({
            "name": "Round",
            "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": { "clips": [
                { "id": "first", "kind": "video", "label": "Primero",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "second", "kind": "video", "label": "Segundo",
                  "startFrame": 40, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 40, "outFrame": 70 } }
            ] }
        });
        let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let exported =
            crate::commands::fcpxml::export_fcpxml(crate::commands::fcpxml::FcpxmlRequest {
                project,
                output_dir: dir.to_string_lossy().into_owned(),
            })
            .expect("exportar FCPXML");
        let text = std::fs::read_to_string(&exported.path).expect("leer");
        let parsed = parse_fcpxml(&text, 30.0).expect("parsear FCPXML");
        assert_eq!(parsed.clips.len(), 2);
        assert!(
            parsed.clips[0].start_seconds.abs() < 0.001,
            "{:?}",
            parsed.clips[0]
        );
        assert!(
            (parsed.clips[1].start_seconds - 40.0 / 30.0).abs() < 0.001,
            "el gap no llegó al segundo clip: {:?}",
            parsed.clips[1]
        );
        assert!((parsed.clips[1].duration_seconds - 1.0).abs() < 0.001);
        assert_eq!(parsed.clips[1].label, "Segundo");
        assert_eq!(
            parsed.clips[1].media.as_deref(),
            Some("file:///media/toma.mp4")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edl_audio_track_reuses_the_video_asset_as_audio() {
        let dir = std::env::temp_dir().join(format!("editoria-audio-edl-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).expect("media");
        std::fs::write(dir.join("media").join("toma.mp4"), b"").expect("medio");
        let timeline = dir.join("demo.edl");
        std::fs::write(
            &timeline,
            "TITLE: Audio\nFCM: NON-DROP FRAME\n\n001  toma     A     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n002  toma     V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n",
        )
        .expect("edl");
        let project = json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [{
                "id": "a", "kind": "video", "status": "ready",
                "source": { "path": "media/toma.mp4" },
                "media": { "durationFrames": 300 }
            }],
            "timeline": { "tracks": [], "clips": [] }
        });
        let result = import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project)
            .expect("importar");
        assert_eq!(result.imported_clips, 2, "{result:?}");
        assert_eq!(result.reused_assets, 1);
        let audio = result
            .clips
            .iter()
            .find(|clip| clip["kind"] == "audio")
            .expect("el evento A debe montar un clip de audio");
        let video = result
            .clips
            .iter()
            .find(|clip| clip["kind"] == "video")
            .expect("el evento V conserva el video");
        let audio_track = result
            .tracks
            .iter()
            .find(|track| track["id"] == audio["trackId"])
            .expect("pista del audio");
        assert_eq!(audio_track["kind"], "audio");
        let video_track = result
            .tracks
            .iter()
            .find(|track| track["id"] == video["trackId"])
            .expect("pista del video");
        assert_eq!(video_track["kind"], "video");
        assert_ne!(audio["trackId"], video["trackId"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn edl_audio_event_on_an_image_is_omitted() {
        let dir = std::env::temp_dir().join(format!("editoria-audio-img-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("media")).expect("media");
        std::fs::write(dir.join("media").join("toma.mp4"), b"").expect("video");
        std::fs::write(dir.join("media").join("foto.png"), b"").expect("imagen");
        let timeline = dir.join("demo.edl");
        std::fs::write(
            &timeline,
            "TITLE: Audio\nFCM: NON-DROP FRAME\n\n001  foto     A     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n002  toma     V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n",
        )
        .expect("edl");
        let project = json!({
            "video": { "frameRate": { "num": 30, "den": 1 } },
            "assets": [
                {
                    "id": "video", "kind": "video", "status": "ready",
                    "source": { "path": "media/toma.mp4" },
                    "media": { "durationFrames": 300 }
                },
                {
                    "id": "imagen", "kind": "image", "status": "ready",
                    "source": { "path": "media/foto.png" },
                    "media": { "width": 1920, "height": 1080 }
                }
            ],
            "timeline": { "tracks": [], "clips": [] }
        });
        let result = import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project)
            .expect("importar");
        assert_eq!(result.imported_clips, 1);
        assert_eq!(result.clips[0]["kind"], "video");
        assert!(
            result
                .warnings
                .iter()
                .any(|warning| warning.contains("pista de audio apunta a una imagen")),
            "{:?}",
            result.warnings
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn our_fcpxml_export_round_trips_audio_lanes() {
        let project = serde_json::json!({
            "name": "RoundAudio",
            "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
            "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
            "timeline": {
                "tracks": [
                    { "id": "v1", "kind": "video", "hidden": false },
                    { "id": "a1", "kind": "audio", "hidden": false }
                ],
                "clips": [
                    { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma",
                      "startFrame": 0, "durationFrames": 90,
                      "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 90 } },
                    { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música",
                      "startFrame": 15, "durationFrames": 30,
                      "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
                ]
            }
        });
        let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("dir");
        let exported =
            crate::commands::fcpxml::export_fcpxml(crate::commands::fcpxml::FcpxmlRequest {
                project,
                output_dir: dir.to_string_lossy().into_owned(),
            })
            .expect("exportar FCPXML con audio");
        assert_eq!(exported.clips, 2);
        let text = std::fs::read_to_string(&exported.path).expect("leer");
        let parsed = parse_fcpxml(&text, 30.0).expect("parsear FCPXML con audio");
        assert_eq!(parsed.clips.len(), 2, "{:?}", parsed.warnings);
        assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
        let video = parsed
            .clips
            .iter()
            .find(|clip| clip.label == "Toma")
            .expect("falta el clip de video");
        assert_eq!(parsed.tracks[video.track_index].kind, TrackKind::Video);
        let audio = parsed
            .clips
            .iter()
            .find(|clip| clip.label == "Música")
            .expect("falta el lane de audio");
        assert!((audio.start_seconds - 0.5).abs() < 0.001, "{audio:?}");
        assert!((audio.source_in_seconds - 1.0).abs() < 0.001, "{audio:?}");
        assert!((audio.duration_seconds - 1.0).abs() < 0.001, "{audio:?}");
        assert_eq!(audio.media.as_deref(), Some("file:///media/toma.mp4"));
        assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
        let _ = std::fs::remove_dir_all(&dir);
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
