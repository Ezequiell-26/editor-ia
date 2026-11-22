//! Escenas OBS: presets persistentes de fuentes y streaming.
//!
//! Una "escena" es una configuración con nombre de lo que `screen_record`
//! graba/streamea: target de captura (pantalla/ventana/región), webcam,
//! micrófono, URL RTMP, fps y encoder. Se guardan en
//! `<config_dir>/obs-scenes.json` y `obs_scene_start` aplica la escena
//! llamando directamente al motor de grabación — una sola fuente de verdad,
//! sin duplicar lógica de captura.
//!
//! DTO, validación y persistencia JSON viven en `application::obs_scenes`;
//! la spec de chroma key de webcam en `media::webcam_chroma`. Acá quedan los
//! comandos IPC, el llavero de claves de streaming y la delegación al motor.
//!
//! AUD-096: la stream key NUNCA se persiste en obs-scenes.json — el usuario
//! pega la URL RTMP completa, el backend separa endpoint+clave
//! (`split_stream_url`), guarda la clave en el Credential Manager bajo una
//! cuenta por escena y persiste sólo endpoint + referencia. Las escenas
//! viejas con la URL completa se migran perezosamente al primer acceso.
//! AUD-097: `SCENES_LOCK` serializa los ciclos leer→modificar→escribir.

use std::path::Path;
use std::sync::Mutex;

use keyring::Entry;
use tauri::State;

use crate::application::obs_scenes::{
    delete_obs_scene, find_obs_scene, list_obs_scenes, merge_stream_url, read_scenes,
    save_obs_scene, split_stream_url, write_scenes, ObsScene,
};
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::state::AppState;

const KEYRING_SERVICE: &str = "editor-ia.obs-scenes";

/// Serializa listar/guardar/borrar/arrancar escenas (AUD-097): sin él, dos
/// saves concurrentes leían la misma lista y la última escritura borraba
/// los cambios de la otra (lost update).
static SCENES_LOCK: Mutex<()> = Mutex::new(());

fn scenes_lock() -> std::sync::MutexGuard<'static, ()> {
    SCENES_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Cuenta del llavero por escena: la stream key vive en
/// `editor-ia.obs-scenes` / `obs-scene:<id>`.
fn keyring_account(scene_id: &str) -> String {
    format!("obs-scene:{scene_id}")
}

fn key_entry(scene_id: &str) -> Result<Entry, ProjectError> {
    Entry::new(KEYRING_SERVICE, &keyring_account(scene_id)).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "el almacén de claves de Windows no está disponible",
        )
    })
}

fn store_scene_key(scene_id: &str, key: &str) -> Result<(), ProjectError> {
    key_entry(scene_id)?.set_password(key).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "no se pudo guardar la clave de streaming en el almacén de Windows",
        )
    })
}

fn load_scene_key(scene_id: &str) -> Result<Option<String>, ProjectError> {
    match key_entry(scene_id)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(ProjectError::message(
            ProjectErrorCode::KeyringUnavailable,
            "no se pudo leer la clave de streaming del almacén de Windows",
        )),
    }
}

fn delete_scene_key(scene_id: &str) {
    if let Ok(entry) = key_entry(scene_id) {
        let _ = entry.delete_credential();
    }
}

/// AUD-096: las escenas guardadas por versiones anteriores persistían
/// `streamUrl` con la clave dentro del JSON. Migración perezosa e
/// idempotente: extrae la clave al llavero, deja endpoint+referencia y
/// limpia `stream_url` (que además ya no se serializa). Llamar con
/// `SCENES_LOCK` tomado.
fn migrate_legacy_stream_secrets(config_dir: &Path) -> Result<(), ProjectError> {
    let mut scenes = read_scenes(config_dir)?;
    let mut changed = false;
    for scene in &mut scenes {
        let Some(url) = scene.stream_url.take() else {
            continue;
        };
        changed = true;
        if scene.id.trim().is_empty() {
            scene.id = uuid::Uuid::new_v4().to_string();
        }
        let (endpoint, key) = split_stream_url(&url);
        scene.stream_endpoint = Some(endpoint);
        match key {
            Some(key) => {
                store_scene_key(&scene.id, &key)?;
                scene.stream_key_ref = Some(keyring_account(&scene.id));
            }
            None => scene.stream_key_ref = None,
        }
    }
    if changed {
        write_scenes(config_dir, &scenes)?;
    }
    Ok(())
}

/// AUD-096: normaliza la escena entrante antes de persistirla.
///
/// - `stream_url` (URL completa, sólo entrada): se separa en endpoint +
///   clave; la clave va al llavero y NUNCA al JSON. Si el llavero falla,
///   el guardado aborta — preferible un error a persistir el secreto.
/// - `stream_endpoint` explícito sin URL: ediciones que re-envían sólo el
///   endpoint conservan la clave ya guardada.
/// - Ninguno de los dos: se preserva la config de stream existente (el
///   formulario no tocó el campo).
/// - `stream_endpoint: ""`: el usuario vació el campo a propósito → se
///   limpia endpoint y clave del llavero.
/// - `stream_key_ref` entrante se ignora: la referencia la decide el
///   backend, nunca el cliente.
fn prepare_scene_for_save(
    config_dir: &Path,
    mut scene: ObsScene,
) -> Result<ObsScene, ProjectError> {
    if scene.id.trim().is_empty() {
        scene.id = uuid::Uuid::new_v4().to_string();
    }
    let incoming_url = scene.stream_url.take().filter(|u| !u.trim().is_empty());
    let incoming_endpoint = scene.stream_endpoint.take();
    scene.stream_key_ref = None;
    let existing = read_scenes(config_dir)?
        .into_iter()
        .find(|s| s.id == scene.id);

    match (incoming_url, incoming_endpoint) {
        (Some(url), _) => {
            let (endpoint, key) = split_stream_url(&url);
            if let Some(key) = key {
                store_scene_key(&scene.id, &key)?;
                scene.stream_key_ref = Some(keyring_account(&scene.id));
            } else {
                // URL sin clave (endpoint solo): conservar la referencia
                // previa sólo si el endpoint no cambió.
                scene.stream_key_ref = existing
                    .filter(|e| e.stream_endpoint.as_deref() == Some(endpoint.as_str()))
                    .and_then(|e| e.stream_key_ref);
            }
            scene.stream_endpoint = Some(endpoint);
        }
        (None, Some(ep)) if ep.trim().is_empty() => {
            scene.stream_endpoint = None;
            delete_scene_key(&scene.id);
        }
        (None, Some(ep)) => {
            scene.stream_endpoint = Some(ep);
            scene.stream_key_ref = existing.and_then(|e| e.stream_key_ref);
        }
        (None, None) => {
            if let Some(e) = existing {
                scene.stream_endpoint = e.stream_endpoint;
                scene.stream_key_ref = e.stream_key_ref;
            }
        }
    }
    Ok(scene)
}

/// Resuelve la URL RTMP completa que ffmpeg necesita: endpoint persistido
/// + clave del llavero. Las escenas legadas aún no migradas pueden traer
///   `stream_url` — se usan tal cual (la migración las limpia después).
fn resolve_scene_stream_url(scene: &ObsScene) -> Result<Option<String>, ProjectError> {
    if let Some(url) = scene.stream_url.as_deref() {
        return Ok(Some(url.to_owned()));
    }
    let Some(endpoint) = scene.stream_endpoint.as_deref() else {
        return Ok(None);
    };
    if scene.stream_key_ref.is_none() {
        return Ok(Some(endpoint.to_owned()));
    }
    match load_scene_key(&scene.id)? {
        Some(key) => Ok(Some(merge_stream_url(endpoint, &key))),
        None => Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "la escena tiene una clave de streaming que no está en el almacén de Windows",
        )),
    }
}

#[tauri::command]
pub async fn obs_scene_list(state: State<'_, AppState>) -> Result<Vec<ObsScene>, ProjectError> {
    let _guard = scenes_lock();
    migrate_legacy_stream_secrets(&state.config_dir)?;
    list_obs_scenes(&state.config_dir)
}

#[tauri::command]
pub async fn obs_scene_save(
    state: State<'_, AppState>,
    scene: ObsScene,
) -> Result<ObsScene, ProjectError> {
    let _guard = scenes_lock();
    migrate_legacy_stream_secrets(&state.config_dir)?;
    let scene = prepare_scene_for_save(&state.config_dir, scene)?;
    save_obs_scene(&state.config_dir, scene)
}

#[tauri::command]
pub async fn obs_scene_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, ProjectError> {
    let _guard = scenes_lock();
    delete_scene_key(&id);
    delete_obs_scene(&state.config_dir, &id)
}

/// Aplica una escena guardada y arranca la grabación/streaming con sus
/// parámetros. Delega en `screen_record_start` (misma validación y motor).
#[tauri::command]
pub async fn obs_scene_start(
    state: State<'_, AppState>,
    id: String,
    output_dir: String,
) -> Result<crate::commands::screen_record::ScreenRecordStatus, ProjectError> {
    let scene = {
        let _guard = scenes_lock();
        migrate_legacy_stream_secrets(&state.config_dir)?;
        let scene = find_obs_scene(read_scenes(&state.config_dir)?, &id)?;
        let stream_url = resolve_scene_stream_url(&scene)?;
        (scene, stream_url)
    };
    let (scene, stream_url) = scene;
    crate::commands::screen_record::screen_record_start(
        state,
        output_dir,
        scene.fps,
        scene.webcam_device,
        scene.capture_screen,
        scene.capture_target,
        scene.window_title,
        scene.region_x,
        scene.region_y,
        scene.region_width,
        scene.region_height,
        scene.audio_device,
        stream_url,
        scene.encoder,
        scene.cursor_overlay,
        scene.webcam_chroma,
    )
    .await
}

/// Render de transición OBS entre dos escenas guardadas: captura las
/// fuentes de ambas (pantalla y/o webcam con PiP y chroma) en
/// simultáneo y las une con `xfade` en un MP4 finito. v1: sin cursor
/// overlay ni streaming; el audio es un único dispositivo opcional.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn obs_transition_record(
    state: State<'_, AppState>,
    from_id: String,
    to_id: String,
    output_dir: String,
    kind: Option<String>,
    lead_secs: Option<f64>,
    duration_secs: Option<f64>,
    tail_secs: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    audio_device: Option<String>,
) -> Result<crate::commands::screen_record::ScreenRecordResult, ProjectError> {
    let spec = crate::application::obs_transition::ObsTransitionSpec::new(
        kind,
        lead_secs,
        duration_secs,
        tail_secs,
        width,
        height,
        fps,
    )?;
    let dir = crate::application::fs::validate_user_write_path(&output_dir)?;
    if !dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    if from_id == to_id {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "la transición necesita dos escenas distintas",
        ));
    }
    let (from_scene, to_scene) = {
        let _guard = scenes_lock();
        migrate_legacy_stream_secrets(&state.config_dir)?;
        let scenes = read_scenes(&state.config_dir)?;
        let from = find_obs_scene(scenes.clone(), &from_id)?;
        let to = find_obs_scene(scenes, &to_id)?;
        (from, to)
    };
    let from = scene_capture_or_err(&from_scene, "origen")?;
    let to = scene_capture_or_err(&to_scene, "destino")?;
    let cursor = from_scene.cursor_overlay.clone();
    crate::commands::screen_record::run_obs_transition(
        &state,
        [from, to],
        &spec,
        audio_device,
        &dir,
        // El cursor se samplea una sola vez sobre el canvas final: la spec
        // de la escena origen es la que manda (documentado en la tool).
        cursor,
    )
    .await
}

/// Valida una escena para captura compositing (transición/switching) y
/// devuelve sus fuentes como `TransitionCapture`: al menos una fuente de
/// video, chroma sólo con webcam, windowTitle/región válidos y cursor
/// overlay bien formado.
fn scene_capture_or_err(
    scene: &ObsScene,
    label: &str,
) -> Result<crate::commands::screen_record::TransitionCapture, ProjectError> {
    if let Some(cursor) = scene.cursor_overlay.as_ref() {
        cursor.validate()?;
    }
    let has_screen = scene.capture_screen.unwrap_or(true);
    let has_webcam = scene
        .webcam_device
        .as_deref()
        .is_some_and(|d| !d.trim().is_empty());
    if !has_screen && !has_webcam {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("la escena {label} no tiene ninguna fuente de video"),
        ));
    }
    if scene.webcam_chroma.is_some() && !has_webcam {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("la escena {label} tiene webcamChroma sin webcamDevice"),
        ));
    }
    if let Some(chroma) = scene.webcam_chroma.as_ref() {
        chroma.validate()?;
    }
    let target = scene.capture_target.as_deref().unwrap_or("desktop");
    if has_screen
        && target == "window"
        && scene
            .window_title
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("la escena {label} es de ventana pero no tiene windowTitle"),
        ));
    }
    if has_screen
        && target == "region"
        && (scene.region_width.unwrap_or(0) < 16 || scene.region_height.unwrap_or(0) < 16)
    {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            &format!("la escena {label} es de región con medidas inválidas"),
        ));
    }
    Ok(crate::commands::screen_record::TransitionCapture {
        screen: has_screen.then(|| crate::commands::screen_record::ScreenTarget {
            target: scene
                .capture_target
                .clone()
                .unwrap_or_else(|| "desktop".to_owned()),
            window_title: scene.window_title.clone(),
            region_x: scene.region_x,
            region_y: scene.region_y,
            region_width: scene.region_width,
            region_height: scene.region_height,
        }),
        webcam_device: if has_webcam {
            scene.webcam_device.clone()
        } else {
            None
        },
        webcam_chroma: scene.webcam_chroma.as_ref().map(|c| c.ffmpeg_chain()),
    })
}

/// Carga una escena por id con la misma serialización/migración que el
/// resto de comandos OBS.
fn load_scene(state: &AppState, id: &str) -> Result<ObsScene, ProjectError> {
    let _guard = scenes_lock();
    migrate_legacy_stream_secrets(&state.config_dir)?;
    find_obs_scene(read_scenes(&state.config_dir)?, id)
}

/// Regla del cursor overlay en switching: igual que `screen_record_start`,
/// sólo aplica a captura de escritorio completa (el origen del frame
/// respecto al cursor no es fiable en ventana/región/webcam-only).
fn check_switch_cursor(scene: &ObsScene) -> Result<(), ProjectError> {
    if let Some(cursor) = scene.cursor_overlay.as_ref() {
        cursor.validate()?;
        let desktop = scene.capture_screen.unwrap_or(true)
            && scene.capture_target.as_deref().unwrap_or("desktop") == "desktop";
        if !desktop {
            return Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "el cursor estilizado sólo aplica a captura de escritorio completa",
            ));
        }
    }
    Ok(())
}

/// Abre una sesión de switching OBS en vivo: la escena indicada queda
/// grabando como segmento 0 y cada `obs_switch_scene` la reemplaza por
/// otra escena; `obs_switch_stop` cierra el último segmento y coser todos
/// con transiciones xfade/acrossfade en un MP4. `stream_url` (opcional)
/// streamea cada segmento a RTMP en el mismo proceso ffmpeg — en cada
/// cambio de escena la conexión se renegocia (gap breve). `encoder`
/// elige el H.264 de segmentos y cosido (x264 por defecto; nvenc/qsv/
/// amf/mf usan hardware); el cursor overlay se quema por segmento al
/// cerrarlo.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn obs_switch_start(
    state: State<'_, AppState>,
    scene_id: String,
    output_dir: String,
    kind: Option<String>,
    transition_secs: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    audio_device: Option<String>,
    stream_url: Option<String>,
    encoder: Option<String>,
) -> Result<crate::commands::screen_record::ObsSwitchStatus, ProjectError> {
    let spec = crate::application::obs_switch::ObsSwitchSpec::new(
        kind,
        transition_secs,
        width,
        height,
        fps,
    )?;
    let dir = crate::application::fs::validate_user_write_path(&output_dir)?;
    if !dir.is_dir() {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "elegí una carpeta de destino válida",
        ));
    }
    let scene = load_scene(&state, &scene_id)?;
    check_switch_cursor(&scene)?;
    let capture = scene_capture_or_err(&scene, "la escena inicial")?;
    // Audio: el parámetro explícito gana para TODOS los segmentos; si no,
    // cada escena usa su propio audioDevice.
    let override_audio = audio_device.clone();
    let effective_audio = audio_device.or(scene.audio_device);
    // Streaming RTMP de sesión: misma URL para todos los segmentos (cada
    // cambio de escena renegocia la conexión — gap breve documentado).
    // La clave viaja en la URL: nunca se persiste ni se loguea.
    let stream = stream_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(|u| u.to_owned());
    if let Some(url) = stream.as_deref() {
        crate::application::obs_scenes::validate_stream_url(url)?;
    }
    // Encoder de captura: mismo set que `screen_record_start` (x264 por
    // defecto = mejor H.264 de software detectado).
    let encoder = encoder.unwrap_or_else(|| "x264".to_owned());
    if !matches!(encoder.as_str(), "x264" | "nvenc" | "qsv" | "amf" | "mf") {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "encoder debe ser x264, nvenc, qsv, amf o mf",
        ));
    }
    crate::commands::screen_record::obs_switch_begin(
        &state,
        &capture,
        &scene.id,
        &spec,
        effective_audio,
        override_audio,
        scene.cursor_overlay,
        stream,
        encoder,
        &dir,
    )
    .await
}

/// Cambia la escena activa de la sesión de switching: cierra el segmento
/// actual (MP4 válido) y abre uno nuevo con la escena indicada.
#[tauri::command]
pub async fn obs_switch_scene(
    state: State<'_, AppState>,
    scene_id: String,
) -> Result<crate::commands::screen_record::ObsSwitchStatus, ProjectError> {
    let scene = load_scene(&state, &scene_id)?;
    check_switch_cursor(&scene)?;
    let capture = scene_capture_or_err(&scene, "la escena destino")?;
    let cursor = scene.cursor_overlay.clone();
    crate::commands::screen_record::obs_switch_to_scene(
        &state,
        &capture,
        &scene.id,
        scene.audio_device,
        cursor,
    )
    .await
}

/// Detiene la sesión de switching: cierra el último segmento y coser
/// todos con transiciones en un MP4 verificado con ffprobe.
#[tauri::command]
pub async fn obs_switch_stop(
    state: State<'_, AppState>,
) -> Result<crate::commands::screen_record::ScreenRecordResult, ProjectError> {
    crate::commands::screen_record::obs_switch_finish(&state).await
}

/// Estado de la sesión de switching (escena activa, segmentos, elapsed).
#[tauri::command]
pub fn obs_switch_status() -> crate::commands::screen_record::ObsSwitchStatus {
    crate::commands::screen_record::obs_switch_status()
}

/// Preview del programa EN VIVO durante una sesión de switching: captura
/// UN frame de la escena activa con la misma composición de fuentes
/// (pantalla/ventana/región + webcam PiP + chroma) que graba el segmento
/// actual. No toca la sesión — es el monitor del directo.
#[tauri::command]
pub async fn obs_switch_preview(
    state: State<'_, AppState>,
) -> Result<crate::commands::screen_record::ScreenRecordPreview, ProjectError> {
    let scene_id = crate::commands::screen_record::obs_switch_current_scene_id().ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            "no hay una sesión de switching activa (o está entre escenas); abrí una con obs_switch_start",
        )
    })?;
    let scene = {
        let _guard = scenes_lock();
        migrate_legacy_stream_secrets(&state.config_dir)?;
        find_obs_scene(read_scenes(&state.config_dir)?, &scene_id)?
    };
    crate::commands::screen_record::screen_record_snapshot(
        state,
        scene.fps,
        scene.webcam_device,
        scene.capture_screen,
        scene.capture_target,
        scene.window_title,
        scene.region_x,
        scene.region_y,
        scene.region_width,
        scene.region_height,
        scene.webcam_chroma,
    )
    .await
}

/// Preview de una escena guardada: captura UN frame con la misma
/// configuración de fuentes (pantalla/ventana/región + webcam PiP) y lo
/// devuelve como PNG en `<config_dir>/obs-previews/`. No graba ni
/// streamea nada — es el monitor de preview antes de empezar.
#[tauri::command]
pub async fn obs_scene_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::commands::screen_record::ScreenRecordPreview, ProjectError> {
    let scene = {
        let _guard = scenes_lock();
        migrate_legacy_stream_secrets(&state.config_dir)?;
        find_obs_scene(read_scenes(&state.config_dir)?, &id)?
    };
    crate::commands::screen_record::screen_record_snapshot(
        state,
        scene.fps,
        scene.webcam_device,
        scene.capture_screen,
        scene.capture_target,
        scene.window_title,
        scene.region_x,
        scene.region_y,
        scene.region_width,
        scene.region_height,
        scene.webcam_chroma,
    )
    .await
}
