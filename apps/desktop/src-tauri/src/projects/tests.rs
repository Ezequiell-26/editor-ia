use super::service::{create_project, open_project, save_project};
use super::storage::{is_safe_relative_uri, validate_project, ProjectDocument};
use std::fs;
use tempfile::tempdir;

const FIXTURE: &str = include_str!("../../../../../packages/project-schema/fixtures/empty-project.editoria.json");

fn fixture() -> ProjectDocument {
    serde_json::from_str(FIXTURE).expect("fixture JSON should deserialize")
}

#[test]
fn fixture_deserializes_and_passes_domain_validation() {
    let project = fixture();
    validate_project(&project).expect("fixture should be valid");
    assert_eq!(project.settings.width, 1920);
    assert_eq!(project.settings.height, 1080);
    assert_eq!(project.settings.fps, 30);
}

#[test]
fn create_open_and_save_round_trip_preserves_project() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("round-trip.editoria.json");
    let created = create_project(&path, "Round trip").expect("create should succeed");
    let loaded = open_project(&path).expect("open should succeed");
    assert_eq!(created, loaded);

    let mut changed = loaded.clone();
    changed.name = "Saved title".to_owned();
    save_project(&path, &changed).expect("save should succeed");
    assert_eq!(open_project(&path).expect("open saved file").name, "Saved title");
}

#[test]
fn create_refuses_to_overwrite_existing_file() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("existing.editoria.json");
    fs::write(&path, "preserve this").expect("write sentinel");
    assert!(create_project(&path, "No overwrite").is_err());
    assert_eq!(fs::read_to_string(path).expect("read sentinel"), "preserve this");
}

#[test]
fn malformed_json_is_rejected() {
    let directory = tempdir().expect("temporary directory");
    let path = directory.path().join("bad.editoria.json");
    fs::write(&path, "{ not json").expect("write invalid JSON");
    assert!(open_project(&path).unwrap_err().contains("not valid Editor IA JSON"));
}

#[test]
fn unsupported_schema_and_unknown_secret_fields_are_rejected() {
    let mut value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    value["schemaVersion"] = serde_json::json!(2);
    let project: ProjectDocument = serde_json::from_value(value).unwrap();
    assert!(validate_project(&project).unwrap_err().contains("Unsupported project schema"));

    let mut value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    value["apiKey"] = serde_json::json!("never-persist-this");
    assert!(serde_json::from_value::<ProjectDocument>(value).is_err());
}

#[test]
fn asset_paths_cannot_escape_the_project_root() {
    for path in ["../private.mp4", "/absolute.mp4", "C:/private.mp4", "media/../../private.mp4", "media\\private.mp4"] {
        assert!(!is_safe_relative_uri(path), "path should be rejected: {path}");
    }
    for path in ["media/clip.mp4", "assets/title.png"] {
        assert!(is_safe_relative_uri(path), "path should be allowed: {path}");
    }
}

#[test]
fn save_rejects_nonexistent_target_and_invalid_project() {
    let directory = tempdir().expect("temporary directory");
    let missing = directory.path().join("missing.editoria.json");
    assert!(save_project(&missing, &fixture()).unwrap_err().contains("does not exist"));

    let path = directory.path().join("valid.editoria.json");
    create_project(&path, "Valid project").unwrap();
    let mut invalid = open_project(&path).unwrap();
    invalid.settings.fps = 0;
    assert!(save_project(&path, &invalid).is_err());
}
