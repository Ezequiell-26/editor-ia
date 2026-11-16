use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};

use crate::projects::service::{
    create_project, create_project_with_video, open_project, save_project, ProjectError,
    ProjectErrorCode, PROJECT_SCHEMA_VERSION,
};

/// Scratch inside the repo's ignored `target/` tree, never under the user's home.
struct TempDir {
    path: PathBuf,
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

impl TempDir {
    fn new(tag: &str) -> Self {
        let unique = format!(
            "{}-{}-{}",
            tag,
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("editor-ia-tests")
            .join(&unique);
        fs::create_dir_all(&root).expect("no se pudo crear el directorio de prueba");
        Self { path: root }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    fn names(&self) -> Vec<String> {
        fs::read_dir(&self.path)
            .expect("el directorio de prueba desaparecio")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        // Only ever removes the uniquely named directory this test created.
        if self.path.is_dir() {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

fn fixture(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("packages")
        .join("project-schema")
        .join("fixtures")
        .join(name);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("falta el fixture {}: {}", path.display(), error));
    serde_json::from_str(&text).expect("el fixture no es JSON valido")
}

fn valid_project() -> Value {
    fixture("sample-vertical-slice.editoria.json")
}

fn ghost_id() -> String {
    "00000000-0000-4000-8000-000000000000".to_owned()
}

fn code_of<T>(result: Result<T, ProjectError>) -> ProjectErrorCode {
    match result {
        Ok(_) => panic!("se esperaba un rechazo y la operacion tuvo exito"),
        Err(error) => error.code,
    }
}

fn issue_paths(error: &ProjectError) -> Vec<String> {
    error
        .issues
        .iter()
        .map(|issue| issue.path.clone())
        .collect()
}

fn rejection(project: &Value) -> ProjectError {
    let dir = TempDir::new("reject");
    save_project(&dir.file("obra.editoria.json"), project)
        .expect_err("el documento deberia rechazarse")
}

fn rejected_with(project: &Value, needle: &str) -> ProjectError {
    let error = rejection(project);
    assert_eq!(
        error.code,
        ProjectErrorCode::InvalidProject,
        "codigo esperado para {}",
        needle
    );
    assert!(
        issue_paths(&error).iter().any(|path| path.contains(needle)),
        "ninguna incidencia apunta a {}: {:?}",
        needle,
        issue_paths(&error)
    );
    error
}

#[test]
fn abre_el_fixture_valido_del_paquete_de_esquema() {
    let dir = TempDir::new("fixture");
    let path = dir.file("sample.editoria.json");
    fs::write(&path, serde_json::to_vec_pretty(&valid_project()).unwrap()).unwrap();

    let opened = open_project(&path).expect("el fixture real deberia abrirse");
    assert_eq!(
        opened.project["schemaVersion"].as_u64(),
        Some(PROJECT_SCHEMA_VERSION)
    );
    assert_eq!(opened.project["id"], valid_project()["id"]);
    assert_eq!(opened.path, path.to_string_lossy());
}

#[test]
fn abre_el_proyecto_vacio() {
    let dir = TempDir::new("empty");
    let path = dir.file("vacio.editoria.json");
    fs::write(
        &path,
        serde_json::to_vec(&fixture("empty-project.editoria.json")).unwrap(),
    )
    .unwrap();
    assert!(open_project(&path).is_ok());
}

#[test]
fn rechaza_una_version_desconocida_con_el_numero_real_y_sin_cien_errores() {
    let mut project = valid_project();
    project["schemaVersion"] = json!(99);
    let dir = TempDir::new("version");
    let path = dir.file("obra.editoria.json");
    let error = save_project(&path, &project).expect_err("una version futura debe rechazarse");
    assert_eq!(error.code, ProjectErrorCode::UnsupportedSchemaVersion);
    assert!(
        error.message.contains("99"),
        "el mensaje debe decir 99: {}",
        error.message
    );
    assert_eq!(
        error.issues.len(),
        1,
        "no se debe inundar con errores de forma"
    );
    assert!(!path.exists(), "no se escribe nada al rechazar la version");
}

#[test]
fn rechaza_json_roto() {
    let dir = TempDir::new("roto");
    let path = dir.file("roto.editoria.json");
    fs::write(&path, b"{ \"id\": ").unwrap();
    assert_eq!(code_of(open_project(&path)), ProjectErrorCode::InvalidJson);
}

#[test]
fn round_trip_de_guardar_y_reabrir_conserva_el_documento() {
    let dir = TempDir::new("roundtrip");
    let path = dir.file("obra.editoria.json");
    let project = valid_project();
    let saved = save_project(&path, &project).expect("guardar deberia funcionar");
    assert_eq!(saved.path, path.to_string_lossy());
    assert!(saved.bytes > 1000);
    assert_eq!(saved.revision, project["revision"].as_u64().unwrap());

    let reopened = open_project(&path).unwrap();
    assert_eq!(reopened.project, project);
    let leftovers: Vec<String> = dir
        .names()
        .into_iter()
        .filter(|name| name.contains(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "quedaron temporales: {:?}", leftovers);
}

#[test]
fn guardar_un_documento_mas_chico_reemplaza_el_contenido_sin_dejar_colas() {
    let dir = TempDir::new("shrink");
    let path = dir.file("obra.editoria.json");
    save_project(&path, &valid_project()).unwrap();
    let big = fs::read(&path).unwrap().len();

    let mut small = fixture("empty-project.editoria.json");
    small["name"] = json!("Corto");
    let saved = save_project(&path, &small).expect("reemplazar deberia funcionar");
    let bytes = fs::read(&path).unwrap();
    assert!(
        bytes.len() < big,
        "el archivo no se achicó: {} vs {}",
        bytes.len(),
        big
    );
    assert_eq!(saved.bytes as usize, bytes.len());
    let reopened = open_project(&path).unwrap();
    assert_eq!(reopened.project, small);
    assert!(
        !dir.names().iter().any(|name| name.contains(".tmp")),
        "quedaron temporales: {:?}",
        dir.names()
    );
}

#[test]
fn crear_no_pisa_un_archivo_existente() {
    let dir = TempDir::new("overwrite");
    let path = dir.file("obra.editoria.json");
    fs::write(&path, b"contenido del usuario").unwrap();

    let error = create_project(&path, "Obra nueva")
        .expect_err("crear sobre un archivo existente debe rechazarse");
    assert_eq!(error.code, ProjectErrorCode::AlreadyExists);
    assert_eq!(fs::read(&path).unwrap(), b"contenido del usuario");
}

#[test]
fn crear_produce_un_documento_v1_valido_y_legible() {
    let dir = TempDir::new("create");
    let path = dir.file("nuevo.editoria.json");
    let opened = create_project(&path, "  Obra de prueba  ").expect("crear deberia funcionar");
    assert_eq!(opened.project["name"], json!("Obra de prueba"));
    assert_eq!(opened.project["schemaVersion"], json!(1));
    assert_eq!(opened.project["revision"], json!(0));
    assert_eq!(
        opened.project["timeline"]["tracks"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(opened.path, path.to_string_lossy());
    assert!(path.exists());
    assert!(
        !dir.names().iter().any(|name| name.contains(".tmp")),
        "el escrito atomico no deja temporales: {:?}",
        dir.names()
    );
}

#[test]
fn un_guardado_que_falla_deja_el_archivo_original_intacto() {
    let dir = TempDir::new("failed-save");
    let path = dir.file("obra.editoria.json");
    save_project(&path, &valid_project()).unwrap();
    let before = fs::read(&path).unwrap();

    let mut broken = valid_project();
    broken["assets"] = json!([]);
    let error = save_project(&path, &broken).expect_err("debe rechazar el clip huerfano");
    assert_eq!(error.code, ProjectErrorCode::InvalidProject);
    assert_eq!(
        fs::read(&path).unwrap(),
        before,
        "el guardado no debe tocar el original al fallar"
    );
    assert!(
        !dir.names().iter().any(|name| name.contains(".tmp")),
        "el temporal debe limpiarse: {:?}",
        dir.names()
    );
}

#[test]
fn rechaza_rutas_de_asset_que_escapan_o_absolutas() {
    for bad in [
        "../../etc/passwd",
        "../hermano.mp4",
        "/absoluta/media.mp4",
        "C:/Windows/media.mp4",
        "media\\demo.mp4",
        "~/media.mp4",
        "media//demo.mp4",
        "media/",
    ] {
        let mut project = valid_project();
        project["assets"][0]["source"]["path"] = json!(bad);
        let dir = TempDir::new("path");
        let error = save_project(&dir.file("obra.editoria.json"), &project)
            .err()
            .unwrap_or_else(|| panic!("la ruta {} deberia rechazarse", bad));
        assert_eq!(
            error.code,
            ProjectErrorCode::PathEscapesRoot,
            "ruta {}",
            bad
        );
        assert!(
            !error.message.contains("QODER-WORK"),
            "el mensaje no debe filtrar el directorio real: {}",
            error.message
        );
    }
}

#[test]
fn espejo_de_las_once_reglas_de_integridad() {
    let mut missing_asset = valid_project();
    missing_asset["assets"] = json!([]);
    rejected_with(&missing_asset, "timeline.clips");

    let mut missing_motion = valid_project();
    missing_motion["timeline"]["clips"][2]["source"]["motionId"] = json!(ghost_id());
    rejected_with(&missing_motion, "motionId");

    let mut bad_track = valid_project();
    bad_track["motion"][0]["targetTrackId"] = json!(ghost_id());
    rejected_with(&bad_track, "motion");

    let mut cue_track_not_caption = valid_project();
    cue_track_not_caption["captions"]["cues"][0]["trackId"] =
        json!("43434343-4343-4434-8434-434343434343");
    rejected_with(&cue_track_not_caption, "captions.cues");

    let mut cue_style_missing = valid_project();
    cue_style_missing["captions"]["cues"][0]["styleId"] = json!(ghost_id());
    rejected_with(&cue_style_missing, "styleId");

    let mut scene_clip_missing = valid_project();
    scene_clip_missing["scenes"][0]["clipIds"][2] = json!(ghost_id());
    rejected_with(&scene_clip_missing, "scenes");

    let mut variant_profile_missing = valid_project();
    variant_profile_missing["exportVariants"][0]["renderProfileId"] = json!(ghost_id());
    rejected_with(&variant_profile_missing, "exportVariants");

    let mut music_asset_missing = valid_project();
    music_asset_missing["audio"]["music"] = json!({ "assetId": ghost_id(), "gainDb": -6.0 });
    rejected_with(&music_asset_missing, "audio.music");

    let mut ducking_track_missing = valid_project();
    ducking_track_missing["audio"]["ducking"]["sourceTrackIds"][0] = json!(ghost_id());
    rejected_with(&ducking_track_missing, "audio.ducking");

    let mut claim_source_missing = valid_project();
    claim_source_missing["provenance"]["claims"][0]["sourceIds"][0] = json!(ghost_id());
    rejected_with(&claim_source_missing, "provenance.claims");

    let mut claim_scene_missing = valid_project();
    claim_scene_missing["provenance"]["claims"][0]["sceneId"] = json!(ghost_id());
    rejected_with(&claim_scene_missing, "sceneId");
}

#[test]
fn un_documento_coherente_pasa_las_once_reglas() {
    let dir = TempDir::new("all-rules-ok");
    let path = dir.file("obra.editoria.json");
    assert!(save_project(&path, &valid_project()).is_ok());
}

#[test]
fn ids_invalidos_duplicados_y_repetidos_entre_colecciones() {
    let dir = TempDir::new("id");

    let mut slug = valid_project();
    slug["id"] = json!("mi-obra");
    let error =
        save_project(&dir.file("obra.editoria.json"), &slug).expect_err("un slug no es un id");
    assert_eq!(error.code, ProjectErrorCode::InvalidProject);

    let mut duplicated = valid_project();
    let first_id = duplicated["timeline"]["tracks"][0]["id"].clone();
    duplicated["timeline"]["tracks"][1]["id"] = first_id;
    let error = save_project(&dir.file("dup.editoria.json"), &duplicated)
        .expect_err("ids repetidos dentro de la coleccion deben rechazarse");
    assert!(
        issue_paths(&error)
            .iter()
            .any(|path| path.contains("timeline.tracks")),
        "la incidencia debe señalar la coleccion: {:?}",
        issue_paths(&error)
    );

    let mut shared = valid_project();
    let asset_id = shared["assets"][0]["id"].clone();
    let track_id = shared["timeline"]["tracks"][0]["id"].clone();
    shared["timeline"]["clips"] = json!([
        { "id": asset_id, "trackId": track_id, "label": "clip",
          "startFrame": 0, "durationFrames": 30, "kind": "video",
          "source": { "type": "asset", "assetId": asset_id, "inFrame": 0, "outFrame": 30 } }
    ]);
    shared["scenes"][0]["clipIds"] = json!([asset_id]);
    let saved = save_project(&dir.file("shared.editoria.json"), &shared);
    assert!(
        saved.is_ok(),
        "reutilizar un id entre colecciones distintas es valido: {:?}",
        saved.err().map(|error| error.issues)
    );
}

#[test]
fn claves_desconocidas_en_el_nivel_raiz_solo_bajo_prefijo_x() {
    let dir = TempDir::new("root-keys");

    let mut stray = valid_project();
    stray["otraCosa"] = json!(1);
    let error = save_project(&dir.file("obra.editoria.json"), &stray)
        .expect_err("una clave raiz nueva debe rechazarse");
    assert_eq!(error.code, ProjectErrorCode::InvalidProject);

    let mut namespaced = valid_project();
    namespaced["x-experimento"] = json!({ "nota": "ok" });
    assert!(
        save_project(&dir.file("x.editoria.json"), &namespaced).is_ok(),
        "el namespace x- es la unica excepcion"
    );
}

#[test]
fn acepta_motion_sin_target_track_id_como_el_esquema_de_typescript() {
    let dir = TempDir::new("motion-no-target");
    let mut project = valid_project();
    project["motion"][0]
        .as_object_mut()
        .expect("el fixture debe tener motion")
        .remove("targetTrackId");
    assert!(
        save_project(&dir.file("sin-target.editoria.json"), &project).is_ok(),
        "targetTrackId es opcional y no debe bloquear el guardado"
    );
}

#[test]
fn acepta_markers_en_la_raiz_como_el_esquema_de_typescript() {
    let dir = TempDir::new("root-markers");

    let mut empty = valid_project();
    empty["markers"] = json!([]);
    assert!(
        save_project(&dir.file("sin-marcas.editoria.json"), &empty).is_ok(),
        "un proyecto con la coleccion markers vacia debe guardarse"
    );

    let mut marked = valid_project();
    marked["markers"] = json!([{
        "id": ghost_id(),
        "frame": 12,
        "label": "Corte de prueba",
        "color": "blue"
    }]);
    assert!(
        save_project(&dir.file("con-marca.editoria.json"), &marked).is_ok(),
        "markers es una clave raiz conocida desde la paridad con CapCut"
    );
}

#[test]
fn rechaza_credenciales_en_cualquier_nivel_incluso_dentro_de_x() {
    let mut at_root = valid_project();
    at_root["api_key"] = json!("no");

    let mut inside_x = valid_project();
    inside_x["x-experimento"] = json!({ "access_token": "no" });

    let mut deep = valid_project();
    deep["motion"][0]["props"]["password"] = json!("no");

    for (label, project) in [
        ("raiz", at_root),
        ("dentro de x-", inside_x),
        ("hondo", deep),
    ] {
        let dir = TempDir::new("cred");
        let error = save_project(&dir.file("obra.editoria.json"), &project)
            .err()
            .unwrap_or_else(|| panic!("una clave tipo credencial en {} debe rechazarse", label));
        assert_eq!(
            error.code,
            ProjectErrorCode::InvalidProject,
            "nivel {}",
            label
        );
        let text = format!("{} {:?}", error.message, issue_paths(&error));
        assert!(
            !text.contains("no\""),
            "el valor de la credencial nunca debe reproducirse: {}",
            text
        );
    }
}

#[test]
fn la_identidad_de_timing_se_exige_con_enteros_exactos() {
    let dir = TempDir::new("timing");

    let mut drifted = valid_project();
    drifted["timeline"]["clips"][0]["durationFrames"] = json!(299);
    let error = save_project(&dir.file("obra.editoria.json"), &drifted)
        .expect_err("un clip que no cierra la identidad debe rechazarse");
    assert!(
        issue_paths(&error)
            .iter()
            .any(|path| path.contains("durationFrames")),
        "la incidencia debe señalar durationFrames: {:?}",
        issue_paths(&error)
    );

    let mut slowed = valid_project();
    slowed["timeline"]["clips"][0]["durationFrames"] = json!(150);
    slowed["timeline"]["clips"][0]["source"]["inFrame"] = json!(0);
    slowed["timeline"]["clips"][0]["source"]["outFrame"] = json!(300);
    slowed["timeline"]["clips"][0]["speed"] = json!({ "num": 2, "den": 1 });
    assert!(
        save_project(&dir.file("slow.editoria.json"), &slowed).is_ok(),
        "150 x 2 = (300 - 0) x 1: media duracion de timeline sobre 2x velocidad es valido"
    );
}

#[test]
fn crea_entrega_nativa_para_formato_y_fps_personalizados() {
    let dir = TempDir::new("custom-format");
    let path = dir.file("custom.editoria.json");
    let opened = create_project_with_video(
        &path,
        "Formato raro",
        Some(json!({
            "width": 1440,
            "height": 1080,
            "frameRate": { "num": 24_000, "den": 1_001 },
            "backgroundColor": "#0b0e13"
        })),
    )
    .expect("el proyecto personalizado debería crearse");
    let profiles = opened.project["renderProfiles"]
        .as_array()
        .expect("perfiles");
    let native = profiles
        .iter()
        .find(|profile| {
            profile["name"]
                .as_str()
                .unwrap_or_default()
                .starts_with("Formato del proyecto")
        })
        .expect("debe existir un perfil nativo");
    assert_eq!(native["resolution"]["width"], 1440);
    assert_eq!(native["resolution"]["height"], 1080);
    assert_eq!(native["aspectRatio"], "4:3");
    assert_eq!(native["videoPreset"], "veryfast");
    assert_eq!(native["audioBitsPerSecond"], 128_000);
    assert_eq!(native["frameRate"]["num"], 24_000);
    assert!(profiles
        .iter()
        .any(|profile| profile["name"] == "YouTube 1080p"));
}

#[test]
fn rechaza_un_archivo_mas_grande_que_el_tope() {
    let dir = TempDir::new("size");
    let path = dir.file("gordo.editoria.json");
    let mut project = valid_project();
    project["x-relleno"] = json!("a".repeat(9_000_000));
    fs::write(&path, serde_json::to_vec(&project).unwrap()).unwrap();
    assert_eq!(code_of(open_project(&path)), ProjectErrorCode::FileTooLarge);
}

#[test]
fn los_mensajes_no_filtran_el_directorio_del_usuario() {
    let dir = TempDir::new("leak");
    let path = dir.file("faltante.editoria.json");
    let error = open_project(&path).expect_err("abrir un archivo inexistente debe fallar");
    assert_eq!(error.code, ProjectErrorCode::NotFound);
    let text = format!("{} {:?}", error.message, issue_paths(&error));
    assert!(
        !text.contains("QODER-WORK"),
        "se filtro la ruta real: {}",
        text
    );
    assert!(
        !text.contains("src-tauri"),
        "se filtro la ruta real: {}",
        text
    );
}

#[test]
fn acepta_compounds_y_clips_de_compuesto_como_typescript() {
    let dir = TempDir::new("compounds");
    let mut project = valid_project();
    let video_track = project["timeline"]["tracks"][0]["id"].clone();
    let asset_id = project["assets"][0]["id"].clone();
    let compound_id = ghost_id();
    project["compounds"] = json!([{
        "id": compound_id,
        "label": "Secuencia reutilizable",
        "durationFrames": 60,
        "clips": [{
            "id": "77777777-7777-4777-8777-777777777777",
            "trackId": video_track,
            "label": "Toma interna",
            "startFrame": 0,
            "durationFrames": 60,
            "kind": "video",
            "source": { "type": "asset", "assetId": asset_id, "inFrame": 0, "outFrame": 60 }
        }]
    }]);
    project["timeline"]["clips"]
        .as_array_mut()
        .expect("el fixture debe tener clips")
        .push(json!({
            "id": "88888888-8888-4888-8888-888888888888",
            "trackId": video_track,
            "label": "Compuesto en timeline",
            "startFrame": 0,
            "durationFrames": 60,
            "kind": "compound",
            "source": { "type": "compound", "compoundId": compound_id }
        }));
    assert!(
        save_project(&dir.file("compounds.editoria.json"), &project).is_ok(),
        "un proyecto con compounds debe abrirse igual que en TypeScript"
    );

    let mut ghost_compound = project.clone();
    let last = ghost_compound["timeline"]["clips"]
        .as_array()
        .unwrap()
        .len()
        - 1;
    ghost_compound["timeline"]["clips"][last]["source"]["compoundId"] =
        json!("99999999-9999-4999-8999-999999999999");
    rejected_with(&ghost_compound, "compoundId");

    let mut drifted = project;
    drifted["timeline"]["clips"]
        .as_array_mut()
        .unwrap()
        .last_mut()
        .unwrap()["durationFrames"] = json!(59);
    rejected_with(&drifted, "durationFrames");
}

#[test]
fn un_clip_dentro_de_un_compound_debe_caber_en_su_duracion() {
    let mut project = valid_project();
    let video_track = project["timeline"]["tracks"][0]["id"].clone();
    let asset_id = project["assets"][0]["id"].clone();
    project["compounds"] = json!([{
        "id": ghost_id(),
        "label": "Compound corto",
        "durationFrames": 30,
        "clips": [{
            "id": ghost_id(),
            "trackId": video_track,
            "label": "Se pasa",
            "startFrame": 0,
            "durationFrames": 60,
            "kind": "video",
            "source": { "type": "asset", "assetId": asset_id, "inFrame": 0, "outFrame": 60 }
        }]
    }]);
    rejected_with(&project, "compounds[0].clips[0]");
}

#[test]
fn un_asset_ready_exige_hash_media_y_licencia_resuelta() {
    // El fixture ya es un asset ready completo y pasa (ver
    // `un_documento_coherente_pasa_las_once_reglas`); aca van los rechazos.
    let mut sin_hash = valid_project();
    sin_hash["assets"][0]
        .as_object_mut()
        .expect("el fixture debe tener assets")
        .remove("integrity");
    rejected_with(&sin_hash, "assets[0].integrity");

    let mut hash_corto = valid_project();
    hash_corto["assets"][0]["integrity"]["sha256"] = json!("abcd");
    rejected_with(&hash_corto, "assets[0].integrity");

    let mut sin_media = valid_project();
    sin_media["assets"][0]
        .as_object_mut()
        .unwrap()
        .remove("media");
    rejected_with(&sin_media, "assets[0].media");

    let mut licencia_desconocida = valid_project();
    licencia_desconocida["assets"][0]["rights"]["license"]["commercialUse"] =
        json!("unknown");
    rejected_with(&licencia_desconocida, "assets[0].rights.license.commercialUse");

    // Un asset ready completo y nuevo tambien pasa: una fuente local.
    let dir = TempDir::new("asset-ready");
    let mut project = valid_project();
    project["assets"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id": ghost_id(),
            "label": "Grafico listo",
            "kind": "image",
            "source": { "type": "local", "path": "media/logo.png" },
            "status": "ready",
            "integrity": {
                "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                "bytes": 1024
            },
            "rights": {
                "license": { "id": "own-work", "commercialUse": "allowed" },
                "provenance": { "origin": "user-imported", "acquiredAt": "2026-10-18T10:00:00Z" }
            },
            "media": { "width": 512, "height": 512 }
        }));
    assert!(
        save_project(&dir.file("assets.editoria.json"), &project).is_ok(),
        "un asset ready con hash, media y licencia debe aceptarse"
    );
}

#[test]
fn un_asset_no_ready_no_exige_hash_ni_licencia() {
    let mut project = valid_project();
    project["assets"][0]["status"] = json!("unverified");
    project["assets"][0]
        .as_object_mut()
        .unwrap()
        .remove("integrity");
    project["assets"][0]["rights"]["license"]["commercialUse"] = json!("unknown");
    let dir = TempDir::new("asset-unverified");
    assert!(
        save_project(&dir.file("obra.editoria.json"), &project).is_ok(),
        "las reglas de ready solo aplican a assets verificados"
    );
}

#[test]
fn un_asset_downloaded_exige_registrar_su_url_de_origen() {
    let mut project = valid_project();
    project["assets"][0]["rights"]["provenance"]
        .as_object_mut()
        .expect("el fixture debe tener provenance")
        .remove("sourceUrl");
    rejected_with(&project, "assets[0].rights.provenance.sourceUrl");
}

#[test]
fn acepta_video_hasta_32768_pixeles_como_typescript() {
    let dir = TempDir::new("video-big");
    let mut project = valid_project();
    project["video"]["width"] = json!(20_000);
    project["video"]["height"] = json!(20_000);
    assert!(
        save_project(&dir.file("grande.editoria.json"), &project).is_ok(),
        "el tope del formato es 32768, igual que en TypeScript"
    );
}

#[test]
fn acepta_el_segmento_punto_en_rutas_relativas_como_typescript() {
    let dir = TempDir::new("dot-segment");
    let mut project = valid_project();
    project["assets"][0]["source"]["path"] = json!("media/./demo.mp4");
    assert!(
        save_project(&dir.file("punto.editoria.json"), &project).is_ok(),
        "TypeScript admite \".\" en segmentos; el espejo tambien"
    );
}
