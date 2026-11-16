use super::*;

#[test]
fn accepts_safe_ids() {
    assert!(valid_id("cleanup.rapido"));
    assert!(valid_id("mi-plugin_2"));
    assert!(!valid_id("Mi Plugin"));
    assert!(!valid_id(""));
    assert!(!valid_id("../../etc"));
}

#[test]
fn reads_a_valid_manifest() {
    let dir = std::env::temp_dir().join(format!("plugin-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(
        dir.join(MANIFEST),
        r#"{"id":"demo","name":"Demo","version":"1.0.0","official":true,"commands":[{"id":"run","label":"Correr","steps":["cortá los silencios"]}]}"#,
    )
    .unwrap();
    let manifest = read_manifest(&dir).expect("manifiesto válido");
    assert_eq!(manifest.id, "demo");
    assert_eq!(manifest.commands.len(), 1);
    assert!(!manifest.official);
    assert_eq!(manifest.kind, "plugin");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rejects_a_manifest_with_bad_id() {
    let dir = std::env::temp_dir().join(format!("plugin-bad-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(
        dir.join(MANIFEST),
        r#"{"id":"ID INVALIDO","name":"X","version":"1"}"#,
    )
    .unwrap();
    assert!(read_manifest(&dir).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn install_plugin_aplica_politica_de_lectura_a_la_fuente() {
    // Ruta relativa: la política de `fs_*` exige absoluta.
    assert!(install_plugin("mi-plugin").is_err());
    // Dentro de una carpeta de credenciales: rechazada antes de copiar.
    let root = std::env::temp_dir().join(format!("olyvia-plugin-{}", uuid::Uuid::new_v4()));
    let ssh = root.join(".ssh").join("plugin");
    std::fs::create_dir_all(&ssh).unwrap();
    std::fs::write(ssh.join(MANIFEST), r#"{"id":"demo","name":"D","version":"1"}"#).unwrap();
    assert!(install_plugin(&ssh.to_string_lossy()).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

/// AUD-091: un `plugins.json` corrupto no reactiva los deshabilitados —
/// el estado queda marcado como corrupto y el backup lo rescata.
#[test]
fn corrupt_state_fails_safe_and_backup_recovers() {
    let dir = std::env::temp_dir().join(format!("olyvia-state-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    // Sin archivo: instalación nueva, no corrupto.
    let state = read_state_in(&dir);
    assert!(!state.corrupted);
    assert!(state.map.is_empty());

    // JSON truncado sin backup: corrupto.
    std::fs::write(dir.join(STATE_FILE), "{\"disabled\":[\"a\"").unwrap();
    let state = read_state_in(&dir);
    assert!(state.corrupted);
    assert!(state.map.is_empty());

    // Con backup válido: se recupera la lista de deshabilitados.
    std::fs::write(
        dir.join(STATE_BACKUP),
        r#"{"disabled":["mi-plugin"]}"#,
    )
    .unwrap();
    let state = read_state_in(&dir);
    assert!(!state.corrupted);
    let disabled: Vec<&str> = state
        .map
        .get("disabled")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|item| item.as_str()).collect())
        .unwrap_or_default();
    assert_eq!(disabled, vec!["mi-plugin"]);

    let _ = std::fs::remove_dir_all(&dir);
}

/// AUD-091: la escritura es tmp+rename y conserva el estado previo como
/// backup; no quedan temporales.
#[test]
fn write_state_is_atomic_and_keeps_backup() {
    let dir = std::env::temp_dir().join(format!("olyvia-state-{}", uuid::Uuid::new_v4()));
    let mut first = serde_json::Map::new();
    first.insert(
        "disabled".to_owned(),
        Value::Array(vec![Value::String("primero".to_owned())]),
    );
    write_state_in(&dir, &first).expect("primera escritura");
    assert!(dir.join(STATE_FILE).is_file());
    assert!(!dir.join(STATE_TMP).exists());

    let mut second = serde_json::Map::new();
    second.insert(
        "disabled".to_owned(),
        Value::Array(vec![Value::String("segundo".to_owned())]),
    );
    write_state_in(&dir, &second).expect("segunda escritura");

    // El backup conserva el estado anterior.
    let backup = std::fs::read_to_string(dir.join(STATE_BACKUP)).expect("backup");
    assert!(backup.contains("primero"));
    // El actual tiene el nuevo.
    let current = read_state_in(&dir);
    assert!(!current.corrupted);
    let text = serde_json::to_string(&current.map).unwrap();
    assert!(text.contains("segundo"));
    assert!(!dir.join(STATE_TMP).exists());

    let _ = std::fs::remove_dir_all(&dir);
}
