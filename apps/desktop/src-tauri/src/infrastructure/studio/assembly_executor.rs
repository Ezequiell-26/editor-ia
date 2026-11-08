//! Etapas `scenes` y `edit` del pipeline: convierten `ProductionPlan.scenes`
//! en un artefacto de montaje y ese artefacto en clips reales del timeline.
//!
//! - `scenes`: resuelve cada escena contra el `LocalProjectCatalog` (los
//!   `requirement_ids` de la escena buscan en el catálogo por kind+query y
//!   piso de licencia) y escribe `.olyvia/production/<planId>.scenes.json`
//!   con el asset elegido por escena. Idempotente: reescribe el artefacto.
//! - `edit`: lee el artefacto, crea pistas dedicadas "Producción" si no
//!   existen y añade los clips en secuencia desde el frame 0. Soporta las
//!   specs del plan: `transition` (transitionIn en clips visuales),
//!   `subtitles` (cues sobre pista caption con estilo propio) y `music`
//!   (asset de audio del catálogo en "Producción Música", atenuado). Es
//!   idempotente: primero retira los clips y cues que la corrida anterior
//!   hubiera añadido (ids guardados en el artefacto) y luego re-monta.
//!
//! Límites honestos de esta versión:
//! - Un clip por escena; la música se resuelve sólo desde la biblioteca
//!   local (sin provider externo; si no hay candidato se reporta warning).
//! - Los subtítulos usan el texto de narración de la escena (o su título);
//!   la generación de texto por IA es etapa posterior.
//! - La edición escribe el documento del proyecto directamente (atómico);
//!   la UI debe tener el proyecto guardado — mismo caveat que Quality Gate.
//! - Escenas sin recurso resoluble bloquean `edit` con error fatal que
//!   nombra las escenas pendientes.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::infrastructure::studio::local_catalog::LocalProjectCatalog;
use crate::media::resolve_inside_root;
use crate::ports::studio::CatalogEntry;
use crate::ports::studio::{CatalogQuery, MediaCatalog, StageContext, StageExecutor};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::studio::plan::{ProductionPlan, StudioStage};
use crate::studio::run::StageOutcome;

const FALLBACK_SCENE_FRAMES: u64 = 150;
const PRODUCTION_VIDEO_TRACK: &str = "Producción Video";
const PRODUCTION_AUDIO_TRACK: &str = "Producción Audio";
const PRODUCTION_IMAGE_TRACK: &str = "Producción Imagen";

/// Artefacto de montaje por plan: qué asset resuelve cada escena.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScenesArtifact {
    version: u32,
    plan_id: String,
    scenes: Vec<SceneResolution>,
    /// Clips que `edit` añadió la última vez (para idempotencia).
    #[serde(default)]
    clip_ids: Vec<String>,
    /// Cues de subtítulo que `edit` añadió la última vez (idempotencia).
    #[serde(default)]
    cue_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SceneResolution {
    scene_id: String,
    order: u32,
    title: String,
    /// Asset del catálogo elegido; `None` si la escena quedó sin resolver.
    asset_id: Option<String>,
    asset_kind: Option<String>,
    /// Duración pedida por la escena o por defecto.
    duration_frames: u64,
    /// Frames de medio disponibles (video/audio); `None` en imágenes.
    media_frames: Option<u64>,
    /// Texto de narración declarado por la escena (para subtítulos).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    narration_text: Option<String>,
    /// Cortes de escena detectados por `analyze` en el asset elegido
    /// (segundos); base para edición por contenido.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    scene_cuts: Vec<f64>,
    warnings: Vec<String>,
}

pub struct AssemblyStageExecutor;

impl AssemblyStageExecutor {
    pub fn new() -> Self {
        Self
    }

    fn artifact_path(&self, ctx: &StageContext, plan_id: &str) -> PathBuf {
        let safe: String = plan_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        ctx.project_root
            .join(".olyvia")
            .join("production")
            .join(format!("{safe}.scenes.json"))
    }

    fn read_plan(&self, ctx: &StageContext) -> Result<ProductionPlan, ProjectError> {
        serde_json::from_value(ctx.plan.clone()).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el plan embebido en la corrida no es válido: {e}"),
            )
        })
    }

    fn read_artifact(&self, path: &Path) -> Result<Option<ScenesArtifact>, ProjectError> {
        let Ok(raw) = fs::read_to_string(path) else {
            return Ok(None);
        };
        serde_json::from_str(&raw).map(Some).map_err(|e| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                &format!("el artefacto de escenas está corrupto: {e}"),
            )
        })
    }

    fn write_artifact(&self, path: &Path, artifact: &ScenesArtifact) -> Result<(), ProjectError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        }
        let payload = serde_json::to_string_pretty(artifact)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, payload)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        fs::rename(&tmp, path)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))
    }

    /// Candidatos del catálogo para una escena: busca por cada
    /// `requirement_id`, dedup por id, exige archivo en disco y licencia que
    /// satisfaga el piso del requisito.
    fn candidates_for_scene(
        &self,
        catalog: &LocalProjectCatalog,
        plan: &ProductionPlan,
        scene: &crate::studio::plan::PlanScene,
        root: &Path,
        stage_outputs: &serde_json::Value,
    ) -> Vec<CatalogEntry> {
        let mut seen = BTreeSet::new();
        let mut out = Vec::new();
        for req_id in &scene.requirement_ids {
            let Some(req) = plan.requirements.iter().find(|r| &r.id == req_id) else {
                continue;
            };
            // Primero los recursos que `acquire` trajo PARA este requisito:
            // el binding requirementId→assetId es más preciso que volver a
            // buscar por texto en el catálogo.
            if let Some(resources) = stage_outputs["acquire"]["resources"].as_array() {
                for res in resources
                    .iter()
                    .filter(|r| r["requirementId"].as_str() == Some(req_id.as_str()))
                {
                    let Some(asset_id) = res["assetId"].as_str() else {
                        continue;
                    };
                    let Ok(Some(entry)) = catalog.get(asset_id) else {
                        continue;
                    };
                    if !seen.insert(entry.id.clone()) {
                        continue;
                    }
                    let on_disk = resolve_inside_root(root, &entry.reference)
                        .map(|p| p.is_file())
                        .unwrap_or(false);
                    if !on_disk || !entry.source.license.satisfies(req.min_commercial_use) {
                        continue;
                    }
                    out.push(entry);
                }
            }
            // Los requisitos `voice` se materializan como assets `audio`
            // (WAV de narración); el catálogo no distingue el origen.
            let catalog_kind = match req.kind {
                crate::studio::plan::StudioResourceKind::Voice => {
                    crate::studio::plan::StudioResourceKind::Audio
                }
                other => other,
            };
            let query = CatalogQuery {
                kind: Some(catalog_kind),
                text: if req.query.trim().is_empty() {
                    None
                } else {
                    Some(req.query.clone())
                },
                tags: vec![],
                limit: req.max_count.max(1),
            };
            let Ok(entries) = catalog.search(&query) else {
                continue;
            };
            for entry in entries {
                if !seen.insert(entry.id.clone()) {
                    continue;
                }
                // El recurso tiene que existir en disco.
                let on_disk = resolve_inside_root(root, &entry.reference)
                    .map(|p| p.is_file())
                    .unwrap_or(false);
                if !on_disk {
                    continue;
                }
                // Y su licencia tiene que cubrir el piso del requisito.
                if !entry.source.license.satisfies(req.min_commercial_use) {
                    continue;
                }
                out.push(entry);
            }
        }
        out
    }

    fn scenes_stage(&self, ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        let plan = self.read_plan(ctx)?;
        if plan.scenes.is_empty() {
            return Ok(StageOutcome {
                completed: true,
                cost_cents: Some(0),
                output: Some(json!({ "scenes": 0, "note": "el plan no declara escenas" })),
                error: None,
                fatal: false,
                in_progress: false,
            });
        }
        let catalog = LocalProjectCatalog::new(&ctx.document_path, &ctx.project_root);
        let mut resolutions = Vec::with_capacity(plan.scenes.len());
        let mut unresolved = Vec::new();
        for scene in &plan.scenes {
            let duration = scene
                .target_duration_frames
                .unwrap_or(FALLBACK_SCENE_FRAMES)
                .max(1);
            let candidates = self.candidates_for_scene(
                &catalog,
                &plan,
                scene,
                &ctx.project_root,
                &ctx.stage_outputs,
            );
            let chosen = candidates.first();
            let mut warnings = Vec::new();
            let mut scene_cuts: Vec<f64> = Vec::new();
            let (asset_id, asset_kind, media_frames) = match chosen {
                Some(entry) => {
                    scene_cuts = entry
                        .analysis
                        .as_ref()
                        .and_then(|a| a.get("scenes"))
                        .and_then(|s| s.as_array())
                        .map(|arr| arr.iter().filter_map(|v| v.as_f64()).collect())
                        .unwrap_or_default();
                    let kind = format!("{:?}", entry.kind).to_lowercase();
                    let media = entry.duration_frames;
                    // Video/audio sin duración declarada no se puede windowear.
                    if matches!(
                        entry.kind,
                        crate::studio::plan::StudioResourceKind::Video
                            | crate::studio::plan::StudioResourceKind::Audio
                    ) && media.is_none()
                    {
                        warnings.push("el asset no declara duración de medios".to_owned());
                        (None, None, None)
                    } else {
                        (Some(entry.id.clone()), Some(kind), media)
                    }
                }
                None => {
                    warnings
                        .push("sin recurso del catálogo que satisfaga los requisitos".to_owned());
                    (None, None, None)
                }
            };
            if asset_id.is_none() {
                unresolved.push(scene.id.clone());
            }
            resolutions.push(SceneResolution {
                scene_id: scene.id.clone(),
                order: scene.order,
                title: scene.title.clone(),
                asset_id,
                asset_kind,
                duration_frames: duration,
                media_frames,
                narration_text: scene.narration_text.clone(),
                scene_cuts,
                warnings,
            });
        }
        resolutions.sort_by_key(|r| r.order);
        let artifact = ScenesArtifact {
            version: 1,
            plan_id: plan.id.clone(),
            scenes: resolutions.clone(),
            clip_ids: Vec::new(),
            cue_ids: Vec::new(),
        };
        let path = self.artifact_path(ctx, &plan.id);
        self.write_artifact(&path, &artifact)?;
        let resolved = resolutions.iter().filter(|r| r.asset_id.is_some()).count();
        Ok(StageOutcome {
            completed: true,
            cost_cents: Some(0),
            output: Some(json!({
                "scenes": resolutions.len(),
                "resolved": resolved,
                "unresolved": unresolved,
                "sceneCuts": resolutions.iter().map(|r| r.scene_cuts.len()).sum::<usize>(),
                "artifact": path.file_name().map(|n| n.to_string_lossy().to_string()),
            })),
            error: None,
            fatal: false,
            in_progress: false,
        })
    }

    /// Elige la ventana `[in, out)` de `duration` frames dentro del medio
    /// que contiene más cortes de plano detectados (segundos → frames por
    /// `fps`). Los candidatos son `0` y cada corte que deja entrar la
    /// ventana completa; empates → el inicio más temprano. Sin cortes que
    /// aporten, devuelve `(0, duration)`.
    fn content_window(
        scene_cuts: &[f64],
        duration: u64,
        media_frames: u64,
        fps: f64,
    ) -> (u64, u64) {
        if scene_cuts.is_empty() || duration == 0 {
            return (0, duration);
        }
        let mut cut_frames: Vec<u64> = scene_cuts
            .iter()
            .map(|t| (t * fps).round().max(0.0) as u64)
            .collect();
        cut_frames.sort_unstable();
        cut_frames.dedup();
        let max_start = media_frames.saturating_sub(duration);
        let mut starts: Vec<u64> = vec![0];
        starts.extend(cut_frames.iter().copied().filter(|c| *c <= max_start));
        starts.sort_unstable();
        starts.dedup();
        let mut best: Option<(u64, usize)> = None;
        for start in starts {
            let end = start + duration;
            let count = cut_frames
                .iter()
                .filter(|c| **c > start && **c < end)
                .count();
            if best.map(|(_, b)| count > b).unwrap_or(count > 0) {
                best = Some((start, count));
            }
        }
        match best {
            Some((start, _)) if start + duration <= media_frames => (start, start + duration),
            _ => (0, duration.min(media_frames)),
        }
    }

    fn ensure_track(doc: &mut Value, kind: &str, label: &str, next_order: &mut u64) -> String {
        let tracks = doc["timeline"]["tracks"]
            .as_array_mut()
            .expect("timeline.tracks existe en el documento");
        if let Some(track) = tracks.iter().find(|t| t["label"].as_str() == Some(label)) {
            return track["id"].as_str().unwrap_or_default().to_owned();
        }
        let id = Uuid::new_v4().to_string();
        tracks.push(json!({
            "id": id,
            "kind": kind,
            "label": label,
            "order": *next_order,
            "muted": false,
            "hidden": false,
            "locked": false,
        }));
        *next_order += 1;
        id
    }

    fn edit_stage(&self, ctx: &StageContext) -> Result<StageOutcome, ProjectError> {
        let plan = self.read_plan(ctx)?;
        let artifact_path = self.artifact_path(ctx, &plan.id);
        let mut artifact = self.read_artifact(&artifact_path)?.ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "no hay artefacto de escenas: ejecutá la etapa scenes primero",
            )
        })?;
        let unresolved: Vec<&str> = artifact
            .scenes
            .iter()
            .filter(|s| s.asset_id.is_none())
            .map(|s| s.scene_id.as_str())
            .collect();
        if !unresolved.is_empty() {
            return Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some(format!(
                    "escenas sin recurso resuelto: {}",
                    unresolved.join(", ")
                )),
                fatal: true,
                in_progress: false,
            });
        }

        // Lee el documento y retira los clips de la corrida anterior.
        let mut doc: Value = serde_json::from_str(
            &fs::read_to_string(&ctx.document_path)
                .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?,
        )
        .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
        if doc["timeline"].is_null() {
            doc["timeline"] = json!({ "tracks": [], "clips": [] });
        }
        let previous: BTreeSet<String> = artifact.clip_ids.iter().cloned().collect();
        if let Some(clips) = doc["timeline"]["clips"].as_array_mut() {
            clips.retain(|clip| {
                clip["id"]
                    .as_str()
                    .map(|id| !previous.contains(id))
                    .unwrap_or(true)
            });
        }
        // Los cues de subtítulos también se retiran para re-montarlos.
        let previous_cues: BTreeSet<String> = artifact.cue_ids.iter().cloned().collect();
        if !previous_cues.is_empty() {
            if let Some(cues) = doc["captions"]["cues"].as_array_mut() {
                cues.retain(|cue| {
                    cue["id"]
                        .as_str()
                        .map(|id| !previous_cues.contains(id))
                        .unwrap_or(true)
                });
            }
        }

        let mut next_order = doc["timeline"]["tracks"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|t| t["order"].as_u64())
            .max()
            .map(|o| o + 1)
            .unwrap_or(0);
        let video_track =
            Self::ensure_track(&mut doc, "video", PRODUCTION_VIDEO_TRACK, &mut next_order);
        let image_track =
            Self::ensure_track(&mut doc, "image", PRODUCTION_IMAGE_TRACK, &mut next_order);
        let audio_track =
            Self::ensure_track(&mut doc, "audio", PRODUCTION_AUDIO_TRACK, &mut next_order);
        // Pistas extra sólo si el plan las pide: subtítulos y música.
        let want_captions = plan.subtitles.enabled;
        let want_music = plan.music.enabled;
        let mut caption_track = String::new();
        let mut music_track = String::new();
        if want_captions {
            caption_track = Self::ensure_track(
                &mut doc,
                "caption",
                "Producción Subtítulos",
                &mut next_order,
            );
        }
        if want_music {
            music_track =
                Self::ensure_track(&mut doc, "audio", "Producción Música", &mut next_order);
        }

        let fps_num = doc["video"]["frameRate"]["num"].as_u64().unwrap_or(30) as f64;
        let fps_den = doc["video"]["frameRate"]["den"]
            .as_u64()
            .unwrap_or(1)
            .max(1) as f64;
        let fps = if fps_den > 0.0 {
            fps_num / fps_den
        } else {
            30.0
        };
        let mut cursor = 0u64;
        let mut clip_ids = Vec::new();
        // (posición en timeline.clips, trackId, durationFrames) de clips
        // visuales, para aplicar la transición del plan después.
        let mut visual_positions: Vec<(usize, String, u64)> = Vec::new();
        // (start, end, texto) de las escenas para los cues de subtítulos.
        let mut subtitle_ranges: Vec<(u64, u64, String)> = Vec::new();
        for scene in &artifact.scenes {
            let Some(asset_id) = &scene.asset_id else {
                continue;
            };
            let kind = scene.asset_kind.as_deref().unwrap_or("video");
            let clip_id = Uuid::new_v4().to_string();
            let clip_track = match kind {
                "image" => image_track.as_str(),
                "audio" => audio_track.as_str(),
                _ => video_track.as_str(),
            };
            let start = cursor;
            let duration = match kind {
                "image" => scene.duration_frames.max(1),
                "audio" => scene
                    .duration_frames
                    .min(scene.media_frames.unwrap_or(scene.duration_frames))
                    .max(1),
                _ => scene
                    .duration_frames
                    .min(scene.media_frames.unwrap_or(u64::MAX))
                    .max(1),
            };
            // Auto-edición por contenido: si `analyze` detectó cortes en el
            // asset, la ventana del clip es el tramo de `duration` frames
            // que contiene más cortes de plano (empates → el más temprano).
            let (in_frame, out_frame) = if kind == "video" && !scene.scene_cuts.is_empty() {
                Self::content_window(
                    &scene.scene_cuts,
                    duration,
                    scene.media_frames.unwrap_or(u64::MAX),
                    fps,
                )
            } else {
                (0, duration)
            };
            let clip = match kind {
                "image" => json!({
                    "id": clip_id,
                    "trackId": clip_track,
                    "label": scene.title,
                    "startFrame": start,
                    "durationFrames": duration,
                    "kind": "image",
                    "source": { "type": "asset", "assetId": asset_id }
                }),
                "audio" => json!({
                    "id": clip_id,
                    "trackId": clip_track,
                    "label": scene.title,
                    "startFrame": start,
                    "durationFrames": duration,
                    "kind": "audio",
                    "source": {
                        "type": "asset",
                        "assetId": asset_id,
                        "inFrame": 0,
                        "outFrame": duration
                    }
                }),
                _ => json!({
                    "id": clip_id,
                    "trackId": clip_track,
                    "label": scene.title,
                    "startFrame": start,
                    "durationFrames": duration,
                    "kind": "video",
                    "source": {
                        "type": "asset",
                        "assetId": asset_id,
                        "inFrame": in_frame,
                        "outFrame": out_frame
                    }
                }),
            };
            let position = doc["timeline"]["clips"].as_array().unwrap().len();
            doc["timeline"]["clips"]
                .as_array_mut()
                .expect("timeline.clips existe")
                .push(clip);
            clip_ids.push(clip_id);
            if matches!(kind, "video" | "image") {
                visual_positions.push((position, clip_track.to_owned(), duration));
            }
            // Los cues son para escenas visuales: las de audio (voz
            // generada, música) no llevan caption propio.
            if want_captions && matches!(kind, "video" | "image") {
                let text = scene
                    .narration_text
                    .clone()
                    .filter(|t| !t.trim().is_empty())
                    .unwrap_or_else(|| scene.title.clone());
                if !text.trim().is_empty() {
                    subtitle_ranges.push((start, start + duration, text));
                }
            }
            cursor += scene.duration_frames.max(1);
        }

        // Transición del plan: todos los clips visuales después del primero
        // en cada pista reciben `transitionIn` (frames clampeados a la
        // duración del clip y al máximo del schema: 120).
        let mut transitions_applied = 0u32;
        if let Some(transition) = &plan.transition {
            let mut by_track: std::collections::BTreeMap<String, Vec<(usize, u64)>> =
                std::collections::BTreeMap::new();
            for (position, track, duration) in visual_positions {
                by_track
                    .entry(track)
                    .or_default()
                    .push((position, duration));
            }
            if let Some(clips) = doc["timeline"]["clips"].as_array_mut() {
                for (_, positions) in by_track {
                    for (position, duration) in positions.iter().skip(1) {
                        let frames = transition.frames.min(*duration).min(120).max(1);
                        if let Some(clip) = clips.get_mut(*position) {
                            clip["transitionIn"] = json!({
                                "type": transition.transition_type,
                                "frames": frames,
                            });
                            transitions_applied += 1;
                        }
                    }
                }
            }
        }

        // Subtítulos: un cue por escena sobre la pista caption, con el texto
        // de narración (o el título como fallback) y el idioma del plan.
        let mut cues_added = 0u32;
        if want_captions && !subtitle_ranges.is_empty() {
            if doc["captions"].is_null() {
                doc["captions"] = json!({ "styles": [], "cues": [] });
            }
            if doc["captions"]["styles"].is_null() {
                doc["captions"]["styles"] = json!([]);
            }
            if doc["captions"]["cues"].is_null() {
                doc["captions"]["cues"] = json!([]);
            }
            // La validación v1 exige styleId existente en cada cue: se
            // reutiliza el primer estilo o se crea uno por defecto.
            let style_id = {
                let styles = doc["captions"]["styles"].as_array_mut().unwrap();
                if let Some(existing) = styles
                    .first()
                    .and_then(|s| s["id"].as_str().map(str::to_owned))
                {
                    existing
                } else {
                    let id = Uuid::new_v4().to_string();
                    styles.push(json!({
                        "id": id,
                        "name": "Producción",
                        "fontFamily": "Inter",
                        "fontSizePx": 48,
                        "color": "#ffffff",
                        "position": "bottom"
                    }));
                    id
                }
            };
            let language = plan
                .subtitles
                .language
                .clone()
                .unwrap_or_else(|| "und".to_owned());
            let cues = doc["captions"]["cues"].as_array_mut().unwrap();
            for (start, end, text) in subtitle_ranges {
                let cue_id = Uuid::new_v4().to_string();
                cues.push(json!({
                    "id": cue_id,
                    "trackId": caption_track,
                    "styleId": style_id,
                    "text": text,
                    "language": language,
                    "startFrame": start,
                    "endFrame": end,
                }));
                artifact.cue_ids.push(cue_id);
                cues_added += 1;
            }
        }

        // Música de fondo: busca un asset de audio del catálogo que
        // satisfaga la query y lo monta en "Producción Música" a lo largo de
        // toda la corrida, atenuado y con fades. Si no hay candidato se
        // reporta el warning en el output — no se simula ni se falla.
        let mut music_note = Value::Null;
        if want_music {
            let catalog = LocalProjectCatalog::new(&ctx.document_path, &ctx.project_root);
            let query = CatalogQuery {
                kind: Some(crate::studio::plan::StudioResourceKind::Audio),
                text: plan.music.query.clone().filter(|q| !q.trim().is_empty()),
                tags: vec![],
                limit: 8,
            };
            let mut chosen: Option<CatalogEntry> = None;
            if let Ok(entries) = catalog.search(&query) {
                for entry in entries {
                    let on_disk = resolve_inside_root(&ctx.project_root, &entry.reference)
                        .map(|p| p.is_file())
                        .unwrap_or(false);
                    if on_disk && entry.duration_frames.is_some() {
                        chosen = Some(entry);
                        break;
                    }
                }
            }
            match chosen {
                Some(entry) => {
                    let media = entry.duration_frames.unwrap_or(cursor);
                    let duration = cursor.min(media).max(1);
                    let clip_id = Uuid::new_v4().to_string();
                    doc["timeline"]["clips"]
                        .as_array_mut()
                        .expect("timeline.clips existe")
                        .push(json!({
                            "id": clip_id,
                            "trackId": music_track,
                            "label": format!("Música — {}", entry.reference),
                            "startFrame": 0,
                            "durationFrames": duration,
                            "kind": "audio",
                            "source": {
                                "type": "asset",
                                "assetId": entry.id,
                                "inFrame": 0,
                                "outFrame": duration
                            },
                            "audio": {
                                "gainDb": -12,
                                "fadeInFrames": 30,
                                "fadeOutFrames": 30
                            }
                        }));
                    clip_ids.push(clip_id);
                    music_note = json!({
                        "resolved": true,
                        "assetId": entry.id,
                        "reference": entry.reference,
                    });
                }
                None => {
                    music_note = json!({
                        "resolved": false,
                        "reason": "sin asset de audio en el catálogo que satisfaga la búsqueda",
                    });
                }
            }
        }

        // Escritura atómica del documento.
        let tmp = ctx.document_path.with_extension("json.tmp");
        let payload = serde_json::to_string_pretty(&doc)
            .map_err(|e| ProjectError::message(ProjectErrorCode::InvalidProject, &e.to_string()))?;
        fs::write(&tmp, &payload)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;
        fs::rename(&tmp, &ctx.document_path)
            .map_err(|e| ProjectError::message(ProjectErrorCode::Io, &e.to_string()))?;

        artifact.clip_ids = clip_ids.clone();
        self.write_artifact(&artifact_path, &artifact)?;

        Ok(StageOutcome {
            completed: true,
            cost_cents: Some(0),
            output: Some(json!({
                "clipsAdded": clip_ids.len(),
                "totalFrames": cursor,
                "tracks": [PRODUCTION_VIDEO_TRACK, PRODUCTION_IMAGE_TRACK, PRODUCTION_AUDIO_TRACK],
                "transitionsApplied": transitions_applied,
                "subtitleCues": cues_added,
                "music": music_note,
            })),
            error: None,
            fatal: false,
            in_progress: false,
        })
    }
}

impl StageExecutor for AssemblyStageExecutor {
    fn supported_stages(&self) -> Vec<StudioStage> {
        vec![StudioStage::Scenes, StudioStage::Edit]
    }

    fn execute(
        &self,
        stage: StudioStage,
        ctx: &StageContext,
    ) -> Result<StageOutcome, ProjectError> {
        match stage {
            StudioStage::Scenes => self.scenes_stage(ctx),
            StudioStage::Edit => self.edit_stage(ctx),
            other => Ok(StageOutcome {
                completed: false,
                cost_cents: None,
                output: None,
                error: Some(format!("el ejecutor de ensamblaje no soporta {other:?}")),
                fatal: true,
                in_progress: false,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::studio::plan::{
        PlanScene, ProductionBrief, ProductionPlan, ProductionTarget, QualityCriteria,
        ResourceRequirement, StudioResourceKind,
    };

    fn fixture(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("assembly-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("media")).unwrap();
        fs::write(dir.join("media/clip.mp4"), b"fake").unwrap();
        fs::write(
            dir.join("project.json"),
            serde_json::json!({
                "schemaVersion": 1,
                "name": "asm",
                "assets": [{
                    "id": "a1", "label": "Clip A", "kind": "video", "status": "ready",
                    "source": { "type": "local", "path": "media/clip.mp4" },
                    "rights": {
                        "license": { "id": "user-declared", "commercialUse": "allowed" },
                        "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
                    },
                    "media": { "width": 1920, "height": 1080, "durationFrames": 600, "frameRate": 30 },
                    "tags": ["intro"]
                }],
                "timeline": { "tracks": [], "clips": [] }
            })
            .to_string(),
        )
        .unwrap();
        dir
    }

    fn plan_with_scene(requirement_query: &str) -> ProductionPlan {
        ProductionPlan {
            schema_version: 1,
            id: "plan-asm".to_owned(),
            created_at: String::new(),
            updated_at: String::new(),
            brief: ProductionBrief {
                objective: "test".to_owned(),
                audience: None,
                tone: None,
                key_points: vec![],
            },
            target: ProductionTarget {
                platform: Default::default(),
                aspect_ratio: "16:9".to_owned(),
                target_duration_frames: 300,
                render_profile_id: None,
            },
            requirements: vec![ResourceRequirement {
                id: "req-1".to_owned(),
                kind: StudioResourceKind::Video,
                query: requirement_query.to_owned(),
                max_count: 3,
                min_commercial_use: Default::default(),
                prefer_local: true,
                optional: false,
                voice: None,
            }],
            scenes: vec![PlanScene {
                id: "scene-1".to_owned(),
                order: 1,
                title: "Escena 1".to_owned(),
                intent: "apertura".to_owned(),
                target_duration_frames: Some(120),
                narration_text: None,
                requirement_ids: vec!["req-1".to_owned()],
                notes: None,
            }],
            subtitles: Default::default(),
            music: Default::default(),
            transition: None,
            quality: QualityCriteria {
                required_checks: vec![],
                min_vmaf: None,
                loudness_target_lufs: None,
            },
            max_cost_cents: None,
            stage: Default::default(),
        }
    }

    fn ctx(plan: &ProductionPlan, root: &Path) -> StageContext {
        StageContext {
            project_root: root.to_path_buf(),
            document_path: root.join("project.json"),
            plan: serde_json::to_value(plan).unwrap(),
            remaining_budget_cents: None,
            attempt: 1,
            previous_output: None,
            stage_outputs: serde_json::json!({}),
        }
    }

    #[test]
    fn scenes_resolves_catalog_asset_and_edit_writes_real_clips() {
        let dir = fixture("e2e");
        let executor = AssemblyStageExecutor::new();
        let plan = plan_with_scene("");
        let ctx = ctx(&plan, &dir);

        let scenes = executor.execute(StudioStage::Scenes, &ctx).unwrap();
        assert!(scenes.completed, "scenes falló: {:?}", scenes.error);
        assert_eq!(scenes.output.as_ref().unwrap()["resolved"], 1);

        let edit = executor.execute(StudioStage::Edit, &ctx).unwrap();
        assert!(edit.completed, "edit falló: {:?}", edit.error);
        assert_eq!(edit.output.as_ref().unwrap()["clipsAdded"], 1);

        let doc: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        let clips = doc["timeline"]["clips"].as_array().unwrap();
        assert_eq!(clips.len(), 1);
        let clip = &clips[0];
        assert_eq!(clip["kind"], "video");
        assert_eq!(clip["source"]["assetId"], "a1");
        assert_eq!(clip["startFrame"], 0);
        assert_eq!(clip["durationFrames"], 120);
        assert_eq!(clip["source"]["outFrame"], 120);
        let track_id = clip["trackId"].as_str().unwrap();
        let tracks = doc["timeline"]["tracks"].as_array().unwrap();
        assert!(tracks.iter().any(|t| t["id"] == track_id));
        let _ = fs::remove_dir_all(&dir);
    }

    /// Los cortes detectados por `analyze` viajan en la resolución de la
    /// escena hasta el artefacto `scenes.json` (base para auto-edición).
    #[test]
    fn scenes_resolution_carries_detected_scene_cuts() {
        let dir = fixture("cuts");
        let catalog = LocalProjectCatalog::new(&dir.join("project.json"), &dir);
        let mut entry = catalog.get("a1").unwrap().expect("a1 en catálogo");
        entry.analysis = Some(json!({ "scenes": [1.5, 3.0] }));
        catalog.upsert(&entry).unwrap();

        let executor = AssemblyStageExecutor::new();
        let plan = plan_with_scene("");
        let ctx = ctx(&plan, &dir);
        let scenes = executor.execute(StudioStage::Scenes, &ctx).unwrap();
        assert!(scenes.completed, "scenes falló: {:?}", scenes.error);
        assert_eq!(scenes.output.as_ref().unwrap()["sceneCuts"], 2);

        let artifact: Value = serde_json::from_str(
            &fs::read_to_string(dir.join(".olyvia/production/plan-asm.scenes.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(artifact["scenes"][0]["sceneCuts"], json!([1.5, 3.0]));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn edit_is_idempotent_across_reruns() {
        let dir = fixture("idem");
        let executor = AssemblyStageExecutor::new();
        let plan = plan_with_scene("");
        let ctx = ctx(&plan, &dir);
        executor.execute(StudioStage::Scenes, &ctx).unwrap();
        executor.execute(StudioStage::Edit, &ctx).unwrap();
        executor.execute(StudioStage::Edit, &ctx).unwrap();
        let doc: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        assert_eq!(doc["timeline"]["clips"].as_array().unwrap().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unresolved_scene_blocks_edit_with_fatal_error() {
        let dir = fixture("unresolved");
        // Plan con requisito que no matchea nada (kind image, query imposible).
        let mut plan = plan_with_scene("");
        plan.requirements[0].kind = StudioResourceKind::Image;
        plan.requirements[0].query = "zzz-no-existe".to_owned();
        let ctx = ctx(&plan, &dir);
        let executor = AssemblyStageExecutor::new();
        executor.execute(StudioStage::Scenes, &ctx).unwrap();
        let edit = executor.execute(StudioStage::Edit, &ctx).unwrap();
        assert!(!edit.completed);
        assert!(edit.fatal);
        assert!(edit.error.unwrap().contains("scene-1"));
        // El documento no fue tocado.
        let doc: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        assert_eq!(doc["timeline"]["clips"].as_array().unwrap().len(), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Fixture con un asset de audio extra para las specs de música.
    fn fixture_with_audio(tag: &str) -> PathBuf {
        let dir = fixture(tag);
        fs::write(dir.join("media/narracion.wav"), b"audio").unwrap();
        let doc_path = dir.join("project.json");
        let mut doc: Value = serde_json::from_str(&fs::read_to_string(&doc_path).unwrap()).unwrap();
        doc["assets"].as_array_mut().unwrap().push(json!({
            "id": "a2", "label": "Música", "kind": "audio", "status": "ready",
            "source": { "type": "local", "path": "media/narracion.wav" },
            "rights": {
                "license": { "id": "user-declared", "commercialUse": "allowed" },
                "provenance": { "origin": "user-imported", "acquiredAt": "2026-01-01T00:00:00Z" }
            },
            "media": { "sampleRate": 48000, "channels": 2, "durationFrames": 900 }
        }));
        fs::write(&doc_path, serde_json::to_string_pretty(&doc).unwrap()).unwrap();
        dir
    }

    #[test]
    fn edit_materializes_subtitles_music_and_transitions() {
        use crate::studio::plan::{PlanTransition, PlanTransitionType};
        let dir = fixture_with_audio("specs");
        let executor = AssemblyStageExecutor::new();
        let mut plan = plan_with_scene("");
        plan.scenes.push(PlanScene {
            id: "scene-2".to_owned(),
            order: 2,
            title: "Escena 2".to_owned(),
            intent: "cierre".to_owned(),
            target_duration_frames: Some(90),
            narration_text: Some("Y esto cierra la idea".to_owned()),
            requirement_ids: vec!["req-1".to_owned()],
            notes: None,
        });
        plan.scenes[0].narration_text = Some("Hola, esto es la apertura".to_owned());
        plan.subtitles = crate::studio::plan::SubtitleSpec {
            enabled: true,
            language: Some("es".to_owned()),
        };
        plan.music = crate::studio::plan::MusicSpec {
            enabled: true,
            query: Some("narracion".to_owned()),
        };
        plan.transition = Some(PlanTransition {
            transition_type: PlanTransitionType::Dissolve,
            frames: 24,
        });
        let ctx = ctx(&plan, &dir);
        executor.execute(StudioStage::Scenes, &ctx).unwrap();
        let edit = executor.execute(StudioStage::Edit, &ctx).unwrap();
        assert!(edit.completed, "edit falló: {:?}", edit.error);
        let output = edit.output.unwrap();
        assert_eq!(output["subtitleCues"], 2);
        assert_eq!(output["transitionsApplied"], 1);
        assert_eq!(output["music"]["resolved"], true);

        let doc: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        let clips = doc["timeline"]["clips"].as_array().unwrap();
        // 2 clips de escena + 1 de música.
        assert_eq!(clips.len(), 3);
        let video_clips: Vec<&Value> = clips.iter().filter(|c| c["kind"] == "video").collect();
        assert_eq!(video_clips.len(), 2);
        // El segundo clip visual lleva la transición disolve de 24 frames.
        let second = video_clips
            .iter()
            .find(|c| c["startFrame"] == 120)
            .expect("segundo clip de vídeo");
        assert_eq!(second["transitionIn"]["type"], "dissolve");
        assert_eq!(second["transitionIn"]["frames"], 24);
        // Música: clip de audio en su propia pista, atenuado.
        let music = clips
            .iter()
            .find(|c| c["label"].as_str().unwrap_or("").starts_with("Música"))
            .expect("clip de música");
        assert_eq!(music["audio"]["gainDb"], -12);
        let music_track = doc["timeline"]["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == music["trackId"])
            .unwrap();
        assert_eq!(music_track["label"], "Producción Música");
        // Cues: 2, en pista caption, idioma es, estilo existente.
        let cues = doc["captions"]["cues"].as_array().unwrap();
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0]["language"], "es");
        assert_eq!(cues[0]["text"], "Hola, esto es la apertura");
        let cue_track = doc["timeline"]["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == cues[0]["trackId"])
            .unwrap();
        assert_eq!(cue_track["kind"], "caption");
        assert!(doc["captions"]["styles"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["id"] == cues[0]["styleId"]));

        // Idempotencia: re-edit no duplica clips ni cues.
        executor.execute(StudioStage::Edit, &ctx).unwrap();
        let doc2: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        assert_eq!(doc2["timeline"]["clips"].as_array().unwrap().len(), 3);
        assert_eq!(doc2["captions"]["cues"].as_array().unwrap().len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn content_window_picks_the_segment_with_most_cuts() {
        // 30 fps, ventana de 90 frames (3 s), medio de 300 frames (10 s).
        // Cortes en 1 s (30f), 4 s (120f), 7 s (210f), 9 s (270f).
        // Ventana 0-90 contiene sólo el corte de 30f; ventana 120-210
        // contiene 120f? no: (start, end) exclusivo — 120..210 contiene
        // 210f? no. Contiene sólo... evaluemos: start=90? no es corte.
        // Candidatos: 0 y cortes ≤ 210 (media-duration=210).
        // start=0: cortes en (0,90) = {30} → 1
        // start=30: (30,120) = {} → 0... 120 no es <120. → 0? también 30 excl.
        // start=120: (120,210) = {} (210 excl) → 0? hmm 210<210 false.
        // Mejor: start=0 con 1 corte vs empates 0 → gana (0,90)? Eso daría
        // sólo 1 corte; start=30 da (30,120): cortes 120? no. → 0.
        // En realidad el máximo es ambiguo; usamos un caso claro:
        let cuts = vec![1.0, 4.0, 4.5, 7.0, 9.0];
        // fps 30: 30f,120f,135f,210f,270f. duration=90, media=300, max_start=210.
        // start=120: (120,210) contiene 135 → 1. start=30: (30,120)={}→0? 30 excl,120 excl → 0.
        // start=0: (0,90)={30}→1. Empate 1 → gana el más temprano (0,90).
        assert_eq!(
            AssemblyStageExecutor::content_window(&cuts, 90, 300, 30.0),
            (0, 90)
        );
        // Caso donde un inicio tardío gana: cortes densos al final.
        let dense = vec![6.0, 6.5, 7.0, 7.5, 8.0];
        // 180f,195f,210f,225f,240f; duration=90 → max_start=210.
        // start=180: (180,270) = {195,210,225,240} → 4. start=0: (0,90)={}→0(no best).
        assert_eq!(
            AssemblyStageExecutor::content_window(&dense, 90, 300, 30.0),
            (180, 270)
        );
        // Sin cortes útiles → default.
        assert_eq!(
            AssemblyStageExecutor::content_window(&[0.5], 90, 300, 30.0),
            (0, 90)
        );
    }

    /// Una escena que resuelve a un asset de AUDIO (voz generada, música)
    /// monta su clip pero no genera cue de subtítulo: los captions son para
    /// escenas visuales.
    #[test]
    fn audio_scene_mounts_clip_but_skips_subtitle_cues() {
        let dir = fixture_with_audio("audio-cues");
        let executor = AssemblyStageExecutor::new();
        let mut plan = plan_with_scene("");
        plan.requirements[0].kind = StudioResourceKind::Audio;
        plan.requirements[0].query = "narracion".to_owned();
        plan.scenes[0].narration_text = Some("Texto que no debe quemarse".to_owned());
        plan.subtitles = crate::studio::plan::SubtitleSpec {
            enabled: true,
            language: Some("es".to_owned()),
        };
        let ctx = ctx(&plan, &dir);
        let scenes = executor.execute(StudioStage::Scenes, &ctx).unwrap();
        assert!(scenes.completed, "scenes falló: {:?}", scenes.error);
        let edit = executor.execute(StudioStage::Edit, &ctx).unwrap();
        assert!(edit.completed, "edit falló: {:?}", edit.error);
        assert_eq!(edit.output.as_ref().unwrap()["subtitleCues"], 0);

        let doc: Value =
            serde_json::from_str(&fs::read_to_string(dir.join("project.json")).unwrap()).unwrap();
        let clips = doc["timeline"]["clips"].as_array().unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0]["kind"], "audio");
        let cues = doc["captions"]["cues"].as_array();
        assert!(
            cues.map(|c| c.is_empty()).unwrap_or(true),
            "una escena de audio no debe generar cues"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn music_without_catalog_candidate_reports_warning_not_failure() {
        let dir = fixture("nomusic");
        let executor = AssemblyStageExecutor::new();
        let mut plan = plan_with_scene("");
        plan.music = crate::studio::plan::MusicSpec {
            enabled: true,
            query: Some("zzz-nada".to_owned()),
        };
        let ctx = ctx(&plan, &dir);
        executor.execute(StudioStage::Scenes, &ctx).unwrap();
        let edit = executor.execute(StudioStage::Edit, &ctx).unwrap();
        assert!(edit.completed, "edit falló: {:?}", edit.error);
        assert_eq!(edit.output.unwrap()["music"]["resolved"], false);
        let _ = fs::remove_dir_all(&dir);
    }
}
