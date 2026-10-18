use super::storage::{
    validate_project, ProjectDocument, ProjectSettings, MAX_PROJECT_BYTES, PROJECT_SCHEMA_VERSION,
};
use chrono::{SecondsFormat, Utc};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use tempfile::NamedTempFile;
use uuid::Uuid;

fn validate_project_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Choose an absolute path for the project file.".to_owned());
    }
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !filename.ends_with(".editoria.json") {
        return Err("Project filenames must end with .editoria.json.".to_owned());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Project path has no parent directory.".to_owned())?;
    if !parent.is_dir() {
        return Err("The selected project directory does not exist.".to_owned());
    }
    Ok(())
}

pub fn create_project(path: &Path, name: &str) -> Result<ProjectDocument, String> {
    validate_project_path(path)?;
    if name.trim().is_empty() || name.chars().count() > 160 {
        return Err("Project name must contain between 1 and 160 characters.".to_owned());
    }
    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let project = ProjectDocument {
        schema_version: PROJECT_SCHEMA_VERSION,
        id: format!("project-{}", Uuid::new_v4()),
        name: name.trim().to_owned(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        settings: ProjectSettings {
            width: 1920,
            height: 1080,
            fps: 30,
            background_color: "#101319".to_owned(),
        },
        assets: Vec::new(),
        tracks: vec![super::storage::Track {
            id: "track-video-main".to_owned(),
            track_type: super::storage::TrackType::Video,
            name: "Video 1".to_owned(),
            order: 0,
        }],
        clips: Vec::new(),
        scenes: Vec::new(),
    };
    validate_project(&project)?;

    let mut temporary = NamedTempFile::new_in(path.parent().expect("validated parent"))
        .map_err(|error| format!("Could not create a temporary project file: {error}"))?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), &project)
        .map_err(|error| format!("Could not serialize the project: {error}"))?;
    temporary
        .write_all(b"\n")
        .map_err(|error| format!("Could not write project data: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Could not flush project data: {error}"))?;
    temporary.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            "A file already exists at this path. Open it or choose a new project filename."
                .to_owned()
        } else {
            format!("Could not create the project file: {}", error.error)
        }
    })?;
    Ok(project)
}

pub fn open_project(path: &Path) -> Result<ProjectDocument, String> {
    validate_project_path(path)?;
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not inspect project file: {error}"))?;
    if metadata.len() > MAX_PROJECT_BYTES {
        return Err(format!(
            "Project file exceeds the {} MiB safety limit.",
            MAX_PROJECT_BYTES / (1024 * 1024)
        ));
    }
    let mut file =
        File::open(path).map_err(|error| format!("Could not open project file: {error}"))?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|error| format!("Could not read project file: {error}"))?;
    let project: ProjectDocument = serde_json::from_str(&contents)
        .map_err(|error| format!("Project file is not valid Editor IA JSON: {error}"))?;
    validate_project(&project)?;
    Ok(project)
}

pub fn save_project(path: &Path, project: &ProjectDocument) -> Result<(), String> {
    validate_project_path(path)?;
    validate_project(project)?;
    if !path.is_file() {
        return Err("Project file does not exist. Use Create project before saving.".to_owned());
    }
    let mut temporary = NamedTempFile::new_in(path.parent().expect("validated parent"))
        .map_err(|error| format!("Could not create a temporary project file: {error}"))?;
    serde_json::to_writer_pretty(temporary.as_file_mut(), project)
        .map_err(|error| format!("Could not serialize the project: {error}"))?;
    temporary
        .write_all(b"\n")
        .map_err(|error| format!("Could not write project data: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Could not flush project data: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Could not atomically save the project: {}", error.error))?;
    Ok(())
}
