//! Export de la timeline a formatos de intercambio vía `filmcraft-interchange`:
//! AAF, OMF, FCP7 XML, FCPXML, EDL y OTIO. Construye un `filmcraft_project::Project`
//! equivalente y delega la serialización al exportador del crate — la app no
//! reimplementa contenedores AAF/OMF.
//!
//! Se montan clips `video`/`audio` con fuente `asset` (los demás kinds —
//! image, graphic, freeze, adjustment, compound — no tienen representación
//! en estos formatos y se avisan). Transiciones, efectos, keyframes y
//! speed curves no viajan: el formato no los soporta y no se inventan.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use filmcraft_interchange as interchange;
use filmcraft_media::{AudioStreamInfo, MediaInfo, MediaKind, VideoStreamInfo};
use filmcraft_project::{
    ClipId, ItemId, ItemKind, Label, MediaClip, MediaRef, Project, Sequence, SequenceSettings,
    SplitMarks, Track, TrackId, TrackItem, TrackKind,
};
use filmcraft_time::{FrameRate, Tick};
use serde_json::Value;

use crate::media::timeline_import::project_fps;
use crate::projects::service::{ProjectError, ProjectErrorCode};

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

fn u64_field(value: &Value, key: &str) -> Option<u64> {
    value[key].as_u64()
}

fn f64_field(value: &Value, key: &str) -> Option<f64> {
    value[key].as_f64().filter(|v| v.is_finite())
}

/// Resuelve la ruta absoluta de un asset: `source.path` es relativo al root
/// del proyecto; si el archivo existe se canonicaliza, si no se usa el join.
fn asset_path(root: &Path, asset: &Value) -> Option<PathBuf> {
    let relative = asset["source"]["path"].as_str()?;
    let joined = root.join(relative);
    Some(joined.canonicalize().unwrap_or(joined))
}

fn asset_fps(asset: &Value, project_fps_f64: f64) -> f64 {
    let n = asset["media"]["frameRate"]["num"].as_u64().unwrap_or(0) as f64;
    let d = asset["media"]["frameRate"]["den"].as_u64().unwrap_or(0) as f64;
    if n > 0.0 && d > 0.0 {
        n / d
    } else {
        project_fps_f64
    }
}

fn asset_rate(asset: &Value, seq_rate: FrameRate) -> FrameRate {
    let n = asset["media"]["frameRate"]["num"].as_u64().unwrap_or(0) as i64;
    let d = asset["media"]["frameRate"]["den"].as_u64().unwrap_or(0) as i64;
    if n > 0 && d > 0 {
        FrameRate { num: n, den: d }
    } else {
        seq_rate
    }
}

fn media_info(asset: &Value, path: &Path, project_fps_f64: f64, seq_rate: FrameRate) -> MediaInfo {
    let kind_str = asset["kind"].as_str().unwrap_or("");
    let media = &asset["media"];
    let duration_frames = u64_field(media, "durationFrames").unwrap_or(0);
    let asset_fps = asset_fps(asset, project_fps_f64);
    let duration = if duration_frames > 0 && asset_fps > 0.0 {
        Tick::from_seconds_f64(duration_frames as f64 / asset_fps)
    } else {
        Tick::ZERO
    };
    let video = match kind_str {
        "video" | "image" => {
            let width = u64_field(media, "width").unwrap_or(0) as u32;
            let height = u64_field(media, "height").unwrap_or(0) as u32;
            if width == 0 || height == 0 {
                None
            } else {
                Some(VideoStreamInfo {
                    width,
                    height,
                    frame_rate: asset_rate(asset, seq_rate),
                    par: (1, 1),
                    codec: String::new(),
                    pixel_format: String::new(),
                    color: filmcraft_color::ColorInfo::REC709,
                    has_alpha: media["alpha"].as_bool().unwrap_or(false),
                    bitrate: None,
                    hdr: None,
                })
            }
        }
        _ => None,
    };
    let audio_streams = match kind_str {
        "audio" => vec![AudioStreamInfo {
            sample_rate: u64_field(media, "sampleRate").unwrap_or(48_000) as u32,
            channels: u64_field(media, "channels").unwrap_or(2) as u32,
            codec: String::new(),
            bits_per_sample: None,
        }],
        "video" => {
            // Los clips de video pueden tener pista de audio; sin datos de
            // stream declaramos estéreo 48k para que el AAF/OMF no quede mudo.
            vec![AudioStreamInfo {
                sample_rate: 48_000,
                channels: 2,
                codec: String::new(),
                bits_per_sample: None,
            }]
        }
        _ => Vec::new(),
    };
    let kind = match kind_str {
        "audio" => MediaKind::AudioOnly,
        "image" => MediaKind::Still,
        _ => MediaKind::Movie,
    };
    MediaInfo {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "media".into()),
        kind,
        duration,
        video,
        audio_streams,
        container: path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default(),
        start_timecode: None,
        file_size: None,
    }
}

/// Construye el `Project` de filmcraft equivalente a nuestro `ProjectDocument`
/// y devuelve `(project, sequence_id, warnings)`. Sólo clips video/audio con
/// fuente asset; el resto se cuenta en warnings.
pub fn build_interchange_project(
    project: &Value,
    root: &Path,
) -> Result<(Project, ItemId, Vec<String>), ProjectError> {
    let (fps_num, fps_den, fps) = project_fps(project)?;
    let rate = FrameRate {
        num: i64::from(fps_num),
        den: i64::from(fps_den),
    };

    // Assets indexados por id.
    let mut assets: HashMap<String, &Value> = HashMap::new();
    for asset in project["assets"].as_array().into_iter().flatten() {
        if let Some(id) = asset["id"].as_str() {
            assets.insert(id.to_owned(), asset);
        }
    }

    let mut fc = Project::new(project["name"].as_str().unwrap_or("Sequence"));
    let mut warnings = Vec::new();
    let mut item_by_asset: HashMap<String, ItemId> = HashMap::new();

    // Tracks del proyecto ordenadas por `order`.
    let mut sorted_tracks: Vec<&Value> = project["timeline"]["tracks"]
        .as_array()
        .into_iter()
        .flatten()
        .collect();
    sorted_tracks.sort_by_key(|t| t["order"].as_u64().unwrap_or(0));
    let track_label = |track_id: &str| -> String {
        sorted_tracks
            .iter()
            .find(|t| t["id"].as_str() == Some(track_id))
            .and_then(|t| t["label"].as_str())
            .unwrap_or("")
            .to_owned()
    };

    let mut video_tracks: Vec<Track> = Vec::new();
    let mut audio_tracks: Vec<Track> = Vec::new();
    // trackId propio -> (TrackId fc, es_audio)
    let mut fc_track_ids: HashMap<String, (TrackId, bool)> = HashMap::new();
    let mut skipped = 0usize;

    let clips = project["timeline"]["clips"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for clip in &clips {
        let kind = clip["kind"].as_str().unwrap_or("");
        if kind != "video" && kind != "audio" {
            skipped += 1;
            continue;
        }
        let source = &clip["source"];
        if source["type"].as_str() != Some("asset") {
            skipped += 1;
            continue;
        }
        let clip_id = clip["id"].as_str().unwrap_or("?");
        let Some(asset_id) = source["assetId"].as_str() else {
            skipped += 1;
            continue;
        };
        let Some(asset) = assets.get(asset_id) else {
            warnings.push(format!("clip {clip_id}: asset {asset_id} no existe"));
            continue;
        };
        let Some(path) = asset_path(root, asset) else {
            warnings.push(format!("clip {clip_id}: asset {asset_id} sin ruta"));
            continue;
        };

        let item_id = if let Some(id) = item_by_asset.get(asset_id) {
            *id
        } else {
            let media = MediaClip {
                media: MediaRef::File {
                    path: path.to_string_lossy().into_owned(),
                },
                info: media_info(asset, &path, fps, rate),
                interpret: Default::default(),
                mark_in: None,
                mark_out: None,
                markers: Vec::new(),
                offline: false,
                proxy: None,
                identity: None,
            };
            let name = asset["label"].as_str().unwrap_or("media");
            let id = fc.add_item(name, Label::Violet, ItemKind::Media(media), None);
            item_by_asset.insert(asset_id.to_owned(), id);
            id
        };

        // Track fc para este clip (por trackId del proyecto).
        let is_audio = kind == "audio";
        let track_kind = if is_audio {
            TrackKind::Audio
        } else {
            TrackKind::Video
        };
        let track_key = clip["trackId"].as_str().unwrap_or("").to_owned();
        if !fc_track_ids.contains_key(&track_key) {
            let label = {
                let own = track_label(&track_key);
                if own.is_empty() {
                    if is_audio {
                        "Audio".to_owned()
                    } else {
                        "Video".to_owned()
                    }
                } else {
                    own
                }
            };
            let id = TrackId(fc.alloc_id());
            let track = Track::new(id, track_kind, label);
            if is_audio {
                audio_tracks.push(track);
            } else {
                video_tracks.push(track);
            }
            fc_track_ids.insert(track_key.clone(), (id, is_audio));
        }
        let (fc_track_id, _) = fc_track_ids[&track_key];
        let vec = if is_audio {
            &mut audio_tracks
        } else {
            &mut video_tracks
        };
        let Some(track) = vec.iter_mut().find(|t| t.id == fc_track_id) else {
            continue;
        };

        // Tiempos: frames de timeline a Tick vía fps del proyecto.
        let start_frames = clip["startFrame"].as_u64().unwrap_or(0);
        let duration_frames = clip["durationFrames"].as_u64().unwrap_or(0);
        let start = Tick::from_seconds_f64(start_frames as f64 / fps);
        let duration = Tick::from_seconds_f64(duration_frames as f64 / fps);
        if duration <= Tick::ZERO {
            continue;
        }
        // inFrame/outFrame están en frames del asset (a su propio fps).
        let asset_fps = asset_fps(asset, fps);
        let in_frame = u64_field(source, "inFrame").unwrap_or(0);
        let source_in = Tick::from_seconds_f64(in_frame as f64 / asset_fps.max(1.0));
        // speed {num,den} o 1; reverse no viaja (el formato no lo distingue).
        let speed_num = f64_field(&clip["speed"], "num").unwrap_or(1.0);
        let speed_den = f64_field(&clip["speed"], "den").unwrap_or(1.0);
        let speed = if speed_den > 0.0 {
            speed_num / speed_den
        } else {
            1.0
        };
        if clip["reverse"].as_bool().unwrap_or(false) {
            warnings.push(format!(
                "clip {clip_id}: reverse se exporta como velocidad positiva"
            ));
        }
        let gain_db = f64_field(&clip["audio"], "gainDb").unwrap_or(0.0);
        let name = clip["label"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| asset["label"].as_str().unwrap_or("clip"))
            .to_owned();
        track.items.push(TrackItem {
            id: ClipId(fc.alloc_id()),
            item: item_id,
            name,
            label: Label::Violet,
            start,
            duration,
            source_in,
            speed,
            reverse: false,
            enabled: clip["enabled"].as_bool().unwrap_or(true),
            link: None,
            group: None,
            effects: Vec::new(),
            markers: Vec::new(),
            gain_db,
            frame_hold: None,
            scale_to_frame: false,
            essential: None,
            multicam: None,
            time_interpolation: Default::default(),
            hold_filters: false,
            field_options: None,
            source_channels: Vec::new(),
            audio_stream: 0,
            graphic: None,
        });
    }

    if skipped > 0 {
        warnings.push(format!(
            "{skipped} clip(s) de otro tipo (imagen/graphic/compound) no se exportan"
        ));
    }

    let settings = SequenceSettings {
        width: u64_field(&project["video"], "width").unwrap_or(1920) as u32,
        height: u64_field(&project["video"], "height").unwrap_or(1080) as u32,
        frame_rate: rate,
        ..Default::default()
    };
    let sequence = Sequence {
        settings,
        video_tracks,
        audio_tracks,
        markers: Vec::new(),
        mark_in: None,
        mark_out: None,
        work_area: None,
        start_timecode: 0,
        master_volume_db: 0.0,
        master_effects: Vec::new(),
        master_mixer: Default::default(),
        submix_tracks: Vec::new(),
        caption_tracks: Vec::new(),
        multicam: None,
        merged: None,
        split: SplitMarks::default(),
    };
    let seq_id = fc.add_item(
        project["name"].as_str().unwrap_or("Sequence"),
        Label::Violet,
        ItemKind::Sequence(Arc::new(sequence)),
        None,
    );
    Ok((fc, seq_id, warnings))
}

/// Formato de intercambio pedido (por extensión o nombre).
pub fn interchange_format(name_or_ext: &str) -> Option<interchange::Format> {
    interchange::Format::from_extension(name_or_ext).or_else(|| {
        interchange::Format::ALL
            .into_iter()
            .find(|f| f.name().eq_ignore_ascii_case(name_or_ext))
    })
}

/// Exporta la timeline del proyecto `project` (JSON) al formato indicado y
/// devuelve los bytes + warnings del reporte.
pub fn export_interchange_bytes(
    project: &Value,
    root: &Path,
    format: interchange::Format,
) -> Result<(Vec<u8>, Vec<String>), ProjectError> {
    let (fc, seq_id, mut warnings) = build_interchange_project(project, root)?;
    let options = interchange::ExportOptions {
        name: project["name"].as_str().map(str::to_owned),
        ..Default::default()
    };
    let (bytes, report) = interchange::export(&fc, seq_id, format, &options)
        .map_err(|e| invalid(&format!("no se pudo exportar la timeline: {e}")))?;
    for entry in report.entries.iter() {
        if entry.level == interchange::Level::Warning {
            warnings.push(format!("{} (×{})", entry.message, entry.count.max(1)));
        }
    }
    Ok((bytes, warnings))
}

#[cfg(test)]
mod interchange_tests {
    use super::*;

    fn sample_project() -> Value {
        serde_json::json!({
            "name": "Test",
            "video": { "width": 1920, "height": 1080, "frameRate": { "num": 25, "den": 1 } },
            "assets": [
                {
                    "id": "a1", "label": "clip", "kind": "video",
                    "source": { "type": "local", "path": "media/a.mp4" },
                    "media": { "width": 1920, "height": 1080, "durationFrames": 250, "frameRate": { "num": 25, "den": 1 } }
                },
                {
                    "id": "a2", "label": "voz", "kind": "audio",
                    "source": { "type": "local", "path": "media/v.wav" },
                    "media": { "sampleRate": 48000, "channels": 2, "durationFrames": 250 }
                }
            ],
            "timeline": {
                "tracks": [
                    { "id": "t1", "kind": "video", "label": "V1", "order": 0 },
                    { "id": "t2", "kind": "audio", "label": "A1", "order": 1 }
                ],
                "clips": [
                    {
                        "id": "c1", "trackId": "t1", "kind": "video",
                        "startFrame": 0, "durationFrames": 100, "label": "c1",
                        "source": { "type": "asset", "assetId": "a1", "inFrame": 0, "outFrame": 100 }
                    },
                    {
                        "id": "c2", "trackId": "t2", "kind": "audio",
                        "startFrame": 0, "durationFrames": 100, "label": "c2",
                        "source": { "type": "asset", "assetId": "a2", "inFrame": 0, "outFrame": 100 }
                    }
                ]
            }
        })
    }

    #[test]
    fn builds_project_with_two_tracks() {
        let project = sample_project();
        let (fc, seq, warnings) =
            build_interchange_project(&project, Path::new("C:/proj")).unwrap();
        let seq_ref = fc.sequence(seq).expect("sequence");
        assert_eq!(seq_ref.video_tracks.len(), 1);
        assert_eq!(seq_ref.audio_tracks.len(), 1);
        assert_eq!(seq_ref.video_tracks[0].items.len(), 1);
        assert_eq!(seq_ref.audio_tracks[0].items.len(), 1);
        assert!(warnings.is_empty());
    }

    #[test]
    fn exports_all_formats() {
        for format in interchange::Format::ALL {
            let project = sample_project();
            let (bytes, warnings) =
                export_interchange_bytes(&project, Path::new("C:/proj"), format)
                    .unwrap_or_else(|e| panic!("{format:?} falló: {e:?}"));
            assert!(!bytes.is_empty(), "{format:?} produjo 0 bytes");
            match format {
                interchange::Format::Fcp7Xml => {
                    let text = String::from_utf8_lossy(&bytes);
                    assert!(text.contains("xmeml"), "{format:?} sin xmeml");
                }
                interchange::Format::Fcpxml => {
                    let text = String::from_utf8_lossy(&bytes);
                    assert!(text.contains("fcpxml"), "{format:?} sin fcpxml");
                }
                interchange::Format::Aaf | interchange::Format::Omf => {
                    assert_ne!(bytes[0], b'<', "{format:?} parece texto");
                }
                _ => {}
            }
            let _ = warnings;
        }
    }

    #[test]
    fn exports_edl_bytes() {
        let project = sample_project();
        let (bytes, _) =
            export_interchange_bytes(&project, Path::new("C:/proj"), interchange::Format::Edl)
                .unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("TITLE:"));
    }
}
