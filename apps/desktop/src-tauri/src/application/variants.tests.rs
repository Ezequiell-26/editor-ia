use super::*;

#[test]
fn safe_stem_normaliza_nombres() {
    assert_eq!(safe_stem("Mi Video: Ep.1!"), "mi-video-ep-1");
    assert_eq!(safe_stem("  ---  "), "variante");
    assert_eq!(safe_stem("A/B\\C D"), "a-b-c-d");
    assert!(safe_stem(&"x".repeat(200)).len() <= 80);
}

#[test]
fn variant_file_name_siempre_termina_en_json() {
    assert_eq!(variant_file_name("promo"), "promo.editoria.json");
    // Nombre que ya trae la extensión completa: se conserva, no se duplica.
    assert_eq!(
        variant_file_name("promo.editoria.json"),
        "promo.editoria.json"
    );
    assert_eq!(
        variant_file_name("Mi Corte.editoria.json"),
        "mi-corte.editoria.json"
    );
    // `safe_stem` convierte '.' en '-', así que el sufijo `.editoria` nunca
    // llega literal: el nombre saneado termina en "-editoria" y se le agrega
    // la extensión completa (comportamiento preexistente, preservado).
    assert_eq!(
        variant_file_name("promo.editoria"),
        "promo-editoria.editoria.json"
    );
    assert_eq!(variant_file_name("promo.json"), "promo-json.editoria.json");
    assert_eq!(
        variant_file_name("Mi Corte.mp4"),
        "mi-corte-mp4.editoria.json"
    );
}

#[test]
fn relative_asset_paths_rechaza_escape() {
    let project = serde_json::json!({
        "assets": [{ "source": { "path": "../fuera.mp4" } }]
    });
    let error = relative_asset_paths(&project).expect_err("debió fallar");
    assert_eq!(error.code, ProjectErrorCode::PathEscapesRoot);
    assert!(error.message.contains("salir de la carpeta"));
}

#[test]
fn relative_asset_paths_acepta_relativas() {
    let project = serde_json::json!({
        "assets": [
            { "source": { "path": "media/a.mp4" } },
            { "kind": "audio" }
        ]
    });
    let paths = relative_asset_paths(&project).expect("debió pasar");
    assert_eq!(paths, vec!["media/a.mp4".to_string()]);
}

#[test]
fn copy_media_files_aplica_politica_a_fuentes_y_destino() {
    let root = std::env::temp_dir().join(format!("olyvia-variants-{}", uuid::Uuid::new_v4()));
    let entrega = root.join("entrega");
    std::fs::create_dir_all(&entrega).unwrap();
    let source = root.join("clip.mp4");
    std::fs::write(&source, b"video").unwrap();

    // Una fuente relativa se rechaza: la política de `fs_*` exige absoluta.
    assert!(copy_media_files(&entrega.to_string_lossy(), &["clip.mp4".to_owned()]).is_err());
    // Una fuente dentro de una carpeta de credenciales también.
    let ssh = root.join(".ssh");
    std::fs::create_dir_all(&ssh).unwrap();
    let secret = ssh.join("id_rsa");
    std::fs::write(&secret, b"CLAVE-FALSA").unwrap();
    assert!(copy_media_files(
        &entrega.to_string_lossy(),
        &[secret.to_string_lossy().into_owned()]
    )
    .is_err());
    // Y la carpeta de entrega no puede vivir dentro de `.ssh`.
    assert!(
        write_project_document(&ssh.to_string_lossy(), "proyecto", &serde_json::json!({})).is_err()
    );

    // El camino feliz sigue copiando el archivo real.
    let copied = copy_media_files(
        &entrega.to_string_lossy(),
        &[source.to_string_lossy().into_owned()],
    )
    .expect("copia válida");
    assert_eq!(copied.len(), 1);
    assert_eq!(copied[0].bytes, 5);
    // AUD-135: el hash es el digest real del archivo copiado, no un relleno.
    assert_eq!(copied[0].sha256.len(), 64);
    assert!(copied[0].sha256.bytes().all(|b| b.is_ascii_hexdigit()));
    let destino = entrega.join("media").join("clip.mp4");
    let (esperado, _) = crate::media::sha256_file(&destino).expect("hash del destino");
    assert_eq!(copied[0].sha256, esperado);
    let _ = std::fs::remove_dir_all(&root);
}

fn variant_fixture() -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("olyvia-mirror-{}", uuid::Uuid::new_v4()));
    let source_root = root.join("proyecto");
    let new_root = root.join("variantes");
    std::fs::create_dir_all(source_root.join("media")).unwrap();
    std::fs::create_dir_all(&new_root).unwrap();
    // `mirror_assets` espera la raíz de variantes canonicalizada, igual que
    // la entrega `write_project_variant_file`.
    let new_root = new_root.canonicalize().unwrap();
    (root, source_root, new_root)
}

#[test]
fn write_project_document_no_pisa_un_proyecto_existente() {
    let root = std::env::temp_dir().join(format!("olyvia-doc-{}", uuid::Uuid::new_v4()));
    let entrega = root.join("entrega");
    std::fs::create_dir_all(&entrega).unwrap();
    // Semilla válida: `create_project` ya rechaza destinos existentes.
    let semilla_path = root.join("semilla.editoria.json");
    let project = service::create_project(&semilla_path, "semilla")
        .expect("proyecto semilla")
        .project;

    let escrito = write_project_document(&entrega.to_string_lossy(), " entrega ", &project)
        .expect("primera escritura");
    let bytes_antes = std::fs::read(&escrito.path).unwrap();

    // AUD-136: otro documento con el mismo nombre saneado NO pisa el primero.
    let mut otro = project.clone();
    otro["name"] = serde_json::json!("otro proyecto");
    let error = write_project_document(&entrega.to_string_lossy(), "entrega!", &otro)
        .expect_err("debió rechazar la colisión");
    assert_eq!(error.code, ProjectErrorCode::AlreadyExists);
    assert_eq!(std::fs::read(&escrito.path).unwrap(), bytes_antes);

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn mirror_assets_rechaza_destino_del_mismo_tamano_pero_distinto_contenido() {
    let (root, source_root, new_root) = variant_fixture();
    std::fs::write(source_root.join("media/a.mp4"), b"AAAA").unwrap();
    // AUD-138: destino existente con el MISMO tamaño pero OTRO contenido.
    std::fs::create_dir_all(new_root.join("media")).unwrap();
    std::fs::write(new_root.join("media/a.mp4"), b"BBBB").unwrap();
    let project = serde_json::json!({
        "assets": [{ "source": { "path": "media/a.mp4" } }]
    });
    let error = mirror_assets(&project, &source_root, &new_root).expect_err("debió fallar");
    assert_eq!(error.code, ProjectErrorCode::AlreadyExists);
    // El destino ajeno no se tocó.
    assert_eq!(
        std::fs::read(new_root.join("media/a.mp4")).unwrap(),
        b"BBBB"
    );

    // Mismo tamaño Y mismo contenido → reutilización verificada por hash.
    std::fs::write(new_root.join("media/a.mp4"), b"AAAA").unwrap();
    let copied = mirror_assets(&project, &source_root, &new_root)
        .expect("debió reutilizar")
        .0;
    assert_eq!(copied, 0);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn mirror_assets_revierte_las_copias_hechas_si_una_falla() {
    let (root, source_root, new_root) = variant_fixture();
    std::fs::write(source_root.join("media/a.mp4"), b"primero").unwrap();
    // b.mp4 no existe en el origen: la copia de a.mp4 ya se hizo y debe revertirse.
    let project = serde_json::json!({
        "assets": [
            { "source": { "path": "media/a.mp4" } },
            { "source": { "path": "media/b.mp4" } }
        ]
    });
    let error = mirror_assets(&project, &source_root, &new_root).expect_err("debió fallar");
    assert_eq!(error.code, ProjectErrorCode::NotFound);
    assert!(!new_root.join("media/a.mp4").exists());
    let _ = std::fs::remove_dir_all(&root);
}
