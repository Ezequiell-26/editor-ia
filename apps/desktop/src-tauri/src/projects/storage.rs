use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

pub const PROJECT_SCHEMA_VERSION: u32 = 1;
pub const MAX_PROJECT_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProjectDocument {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub settings: ProjectSettings,
    pub assets: Vec<Asset>,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
    pub scenes: Vec<Scene>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProjectSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    #[serde(default = "default_background_color")]
    pub background_color: String,
}

fn default_background_color() -> String {
    "#101319".to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub kind: AssetKind,
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_frames: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Video,
    Image,
    Audio,
    Font,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    #[serde(rename = "type")]
    pub track_type: TrackType,
    pub name: String,
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TrackType {
    Video,
    Audio,
    Captions,
    Graphics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub asset_id: String,
    pub track_id: String,
    pub start_frame: u64,
    pub in_frame: u64,
    pub duration_frames: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub start_frame: u64,
    pub duration_frames: u64,
    #[serde(default)]
    pub clip_ids: Vec<String>,
}

pub fn validate_project(project: &ProjectDocument) -> Result<(), String> {
    if project.schema_version != PROJECT_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported project schema version {}. This version supports {}.",
            project.schema_version, PROJECT_SCHEMA_VERSION
        ));
    }
    if project.id.trim().is_empty() || project.name.trim().is_empty() {
        return Err("Project ID and name must not be empty.".to_owned());
    }
    if project.name.chars().count() > 160 {
        return Err("Project name exceeds the 160-character limit.".to_owned());
    }
    if project.created_at.trim().is_empty() || project.updated_at.trim().is_empty() {
        return Err("Project timestamps are required.".to_owned());
    }
    if !(16..=7680).contains(&project.settings.width)
        || !(16..=4320).contains(&project.settings.height)
        || !(1..=120).contains(&project.settings.fps)
    {
        return Err("Project dimensions or frame rate are outside supported limits.".to_owned());
    }
    if project.settings.background_color.len() != 7
        || !project.settings.background_color.starts_with('#')
        || !project.settings.background_color[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Project background color must use #RRGGBB format.".to_owned());
    }
    if project.tracks.is_empty() {
        return Err("Project must contain at least one track.".to_owned());
    }

    let mut ids = HashSet::new();
    for id in project
        .assets
        .iter()
        .map(|item| item.id.as_str())
        .chain(project.tracks.iter().map(|item| item.id.as_str()))
        .chain(project.clips.iter().map(|item| item.id.as_str()))
        .chain(project.scenes.iter().map(|item| item.id.as_str()))
    {
        if id.trim().is_empty() || !ids.insert(id) {
            return Err(format!("Project entity ID is empty or duplicated: {id}"));
        }
    }

    let asset_ids: HashSet<&str> = project
        .assets
        .iter()
        .map(|asset| asset.id.as_str())
        .collect();
    let track_ids: HashSet<&str> = project
        .tracks
        .iter()
        .map(|track| track.id.as_str())
        .collect();
    let clip_ids: HashSet<&str> = project.clips.iter().map(|clip| clip.id.as_str()).collect();

    for asset in &project.assets {
        if !is_safe_relative_uri(&asset.uri) {
            return Err(format!(
                "Asset URI must stay inside the project root: {}",
                asset.uri
            ));
        }
        if let Some(hash) = &asset.sha256 {
            if hash.len() != 64 || !hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err(format!("Asset {} has an invalid SHA-256 value.", asset.id));
            }
        }
    }
    for clip in &project.clips {
        if !asset_ids.contains(clip.asset_id.as_str()) {
            return Err(format!(
                "Clip {} references missing asset {}.",
                clip.id, clip.asset_id
            ));
        }
        if !track_ids.contains(clip.track_id.as_str()) {
            return Err(format!(
                "Clip {} references missing track {}.",
                clip.id, clip.track_id
            ));
        }
        if clip.duration_frames == 0 {
            return Err(format!("Clip {} must have a positive duration.", clip.id));
        }
        if let Some(volume) = clip.volume {
            if !volume.is_finite() || !(0.0..=2.0).contains(&volume) {
                return Err(format!("Clip {} has an invalid volume.", clip.id));
            }
        }
    }
    for scene in &project.scenes {
        if scene.title.trim().is_empty() || scene.duration_frames == 0 {
            return Err(format!(
                "Scene {} must have a title and positive duration.",
                scene.id
            ));
        }
        if scene
            .clip_ids
            .iter()
            .any(|id| !clip_ids.contains(id.as_str()))
        {
            return Err(format!("Scene {} references a missing clip.", scene.id));
        }
    }
    Ok(())
}

pub fn is_safe_relative_uri(uri: &str) -> bool {
    if uri.trim().is_empty() || uri.contains('\\') || uri.starts_with('/') || uri.contains(':') {
        return false;
    }
    let path = Path::new(uri);
    !path.is_absolute()
        && path.components().all(|part| {
            !matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
}
