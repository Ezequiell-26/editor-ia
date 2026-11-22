use super::*;
use crate::media::cursor_overlay::CursorOverlaySpec;
use crate::media::webcam_chroma::WebcamChromaSpec;

fn scene(target: Option<&str>) -> ObsScene {
    ObsScene {
        id: String::new(),
        name: "Test".into(),
        fps: Some(30),
        capture_target: target.map(str::to_owned),
        window_title: None,
        region_x: None,
        region_y: None,
        region_width: None,
        region_height: None,
        webcam_device: None,
        audio_device: None,
        stream_url: None,
        stream_endpoint: None,
        stream_key_ref: None,
        encoder: None,
        capture_screen: None,
        cursor_overlay: None,
        webcam_chroma: None,
    }
}

#[test]
fn window_scene_requires_title() {
    assert!(validate_scene(&scene(Some("window"))).is_err());
    let mut s = scene(Some("window"));
    s.window_title = Some("Editor".into());
    assert!(validate_scene(&s).is_ok());
}

#[test]
fn region_scene_requires_size() {
    assert!(validate_scene(&scene(Some("region"))).is_err());
    let mut s = scene(Some("region"));
    s.region_width = Some(640);
    s.region_height = Some(360);
    assert!(validate_scene(&s).is_ok());
}

#[test]
fn rejects_bad_encoder_and_target() {
    let mut s = scene(None);
    s.encoder = Some("vp9".into());
    assert!(validate_scene(&s).is_err());
    assert!(validate_scene(&scene(Some("moon"))).is_err());
}

#[test]
fn scene_round_trips_webcam_chroma_and_cursor_overlay() {
    let mut s = scene(Some("desktop"));
    s.webcam_device = Some("Camera".into());
    s.webcam_chroma = Some(WebcamChromaSpec {
        color: "#00ff00".into(),
        similarity: 0.42,
        blend: 0.15,
    });
    s.cursor_overlay = Some(CursorOverlaySpec {
        style: "3d".into(),
        color: "amarillo".into(),
        scale: 2.0,
        ripple: false,
    });

    let json = serde_json::to_value(&s).unwrap();
    assert_eq!(json["webcamChroma"]["color"], "#00ff00");
    assert_eq!(json["webcamChroma"]["similarity"], 0.42);
    assert_eq!(json["cursorOverlay"]["style"], "3d");
    assert_eq!(json["cursorOverlay"]["ripple"], false);

    let restored: ObsScene = serde_json::from_value(json).unwrap();
    assert_eq!(restored.webcam_chroma.unwrap().blend, 0.15);
    assert_eq!(restored.cursor_overlay.unwrap().scale, 2.0);
}

#[test]
fn scene_rejects_chroma_without_webcam_and_cursor_outside_desktop() {
    let mut s = scene(Some("desktop"));
    s.webcam_chroma = Some(WebcamChromaSpec {
        color: "#00ff00".into(),
        similarity: 0.42,
        blend: 0.15,
    });
    assert!(validate_scene(&s).is_err());

    s.webcam_device = Some("Camera".into());
    assert!(validate_scene(&s).is_ok());

    let mut window = scene(Some("window"));
    window.window_title = Some("Editor".into());
    window.cursor_overlay = Some(CursorOverlaySpec {
        style: "flecha".into(),
        color: "blanco".into(),
        scale: 1.0,
        ripple: true,
    });
    assert!(validate_scene(&window).is_err());
}

#[test]
fn legacy_scene_json_without_new_settings_still_deserializes() {
    let legacy = serde_json::json!({
        "id": "legacy",
        "name": "Legacy scene",
        "captureTarget": "desktop",
        "webcamDevice": "Camera"
    });
    let restored: ObsScene = serde_json::from_value(legacy).unwrap();
    assert!(restored.cursor_overlay.is_none());
    assert!(restored.webcam_chroma.is_none());
}

#[test]
fn scene_serializes_camel_case() {
    let s = scene(Some("desktop"));
    let json = serde_json::to_value(&s).unwrap();
    assert!(json.get("captureTarget").is_some());
    assert!(json.get("window_title").is_none());
}

#[test]
fn stream_url_splits_endpoint_and_key_without_persisting_url() {
    // URL completa con clave larga → endpoint + clave separadas.
    let (ep, key) = split_stream_url("rtmp://a.rtmp.youtube.com/live2/AbCdEf-1234_XyZ9");
    assert_eq!(ep, "rtmp://a.rtmp.youtube.com/live2");
    assert_eq!(key.as_deref(), Some("AbCdEf-1234_XyZ9"));
    assert_eq!(
        merge_stream_url(&ep, key.as_deref().unwrap()),
        "rtmp://a.rtmp.youtube.com/live2/AbCdEf-1234_XyZ9"
    );

    // Endpoint sin clave (segmento final corto) → todo es endpoint.
    let (ep, key) = split_stream_url("rtmp://live.twitch.tv/app");
    assert_eq!(ep, "rtmp://live.twitch.tv/app");
    assert!(key.is_none());

    // Trailing slash no rompe el split.
    let (ep, key) = split_stream_url("rtmp://host:1935/app/CLAVE-1234567890/");
    assert_eq!(ep, "rtmp://host:1935/app");
    assert_eq!(key.as_deref(), Some("CLAVE-1234567890"));
}

#[test]
fn stream_url_is_never_serialized() {
    // AUD-096: stream_url es sólo entrada IPC — el JSON persistido no puede
    // contener la URL con clave aunque el struct la tenga en memoria.
    let mut s = scene(Some("desktop"));
    s.stream_url = Some("rtmp://host/app/CLAVE-SECRETA-123".into());
    s.stream_endpoint = Some("rtmp://host/app".into());
    s.stream_key_ref = Some("obs-scene:x".into());
    let json = serde_json::to_value(&s).unwrap();
    assert!(json.get("streamUrl").is_none());
    assert_eq!(json["streamEndpoint"], "rtmp://host/app");
    assert_eq!(json["streamKeyRef"], "obs-scene:x");
    // Y la escena vieja con streamUrl en JSON sí deserializa (migración).
    let legacy = serde_json::json!({
        "id": "old", "name": "Old", "streamUrl": "rtmp://h/app/K"
    });
    let restored: ObsScene = serde_json::from_value(legacy).unwrap();
    assert_eq!(restored.stream_url.as_deref(), Some("rtmp://h/app/K"));
}

#[test]
fn stream_url_validation_accepts_rtmp_and_rejects_others() {
    assert!(validate_stream_url("rtmp://host/app/CLAVE-12345678").is_ok());
    assert!(validate_stream_url("rtmps://host/app/CLAVE-12345678").is_ok());
    assert!(validate_stream_url("rtmp://host:1935/live").is_ok());
    assert!(validate_stream_url("https://host/app/key").is_err());
    assert!(validate_stream_url("rtmp://").is_ok()); // ffmpeg rechaza el resto
    assert!(validate_stream_url(&format!("rtmp://h/{}", "a".repeat(2050))).is_err());
}

#[test]
fn save_upsert_delete_round_trip_on_disk() {
    let dir = std::env::temp_dir().join(format!("editoria-obs-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();

    // Archivo ausente → lista vacía.
    assert!(list_obs_scenes(&dir).unwrap().is_empty());

    // Guardar sin id genera uuid; guardar con id existente actualiza.
    let mut s = scene(Some("desktop"));
    s.name = "Uno".into();
    let saved = save_obs_scene(&dir, s).unwrap();
    assert!(!saved.id.is_empty());
    let mut again = scene(Some("desktop"));
    again.id = saved.id.clone();
    again.name = "Renombrada".into();
    save_obs_scene(&dir, again).unwrap();
    let scenes = list_obs_scenes(&dir).unwrap();
    assert_eq!(scenes.len(), 1);
    assert_eq!(scenes[0].name, "Renombrada");

    // Borrar id inexistente → NotFound; existente → true.
    assert!(delete_obs_scene(&dir, "nope").is_err());
    assert!(delete_obs_scene(&dir, &saved.id).unwrap());
    assert!(list_obs_scenes(&dir).unwrap().is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}
