use super::*;
use crate::application::timeline_import::import_timeline_file;

#[test]
fn parses_our_edl_with_filename_and_clip_name() {
    let text = "TITLE: Demo\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:02:00 00:00:01:00 00:00:03:00\n* FROM CLIP NAME: Toma\n* FILENAME: media/toma.mp4\n";
    let parsed = parse_edl(text, 30.0);
    assert_eq!(parsed.tracks.len(), 1);
    assert_eq!(parsed.tracks[0].kind, TrackKind::Video);
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    assert_eq!(clip.label, "Toma");
    assert!((clip.start_seconds - 1.0).abs() < 0.001);
    assert!((clip.source_in_seconds - 0.0).abs() < 0.001);
    assert!((clip.duration_seconds - 2.0).abs() < 0.001);
    assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
}

#[test]
fn edl_drop_frame_skips_the_smpte_dropped_frames() {
    let text = "TITLE: DF\nFCM: DROP FRAME\n\n001  AX       V     C        00:10:00;00 00:10:01;00 00:10:00;00 00:10:01;00\n* FROM CLIP NAME: Toma\n";
    let fps = 30000.0 / 1001.0;
    let parsed = parse_edl(text, fps);
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    // 00:10:00;00 es el cuadro 17982, no 18000: dos por minuto salvo
    // cada décimo. Al volver al proyecto debe caer en el mismo cuadro.
    assert_eq!(seconds_to_frames(clip.start_seconds, fps), 17982);
    assert_eq!(seconds_to_frames(clip.source_in_seconds, fps), 17982);
    assert_eq!(seconds_to_frames(clip.duration_seconds, fps), 30);
    assert!(
        parsed.warnings.is_empty(),
        "el drop-frame no debe advertir: {:?}",
        parsed.warnings
    );
}

#[test]
fn edl_drop_frame_rejects_a_timecode_that_does_not_exist() {
    // 00:01:00;00 no existe en drop-frame: los cuadros 0 y 1 se saltean
    // al minuto 1, así que se descarta el evento en vez de inventarlo.
    let text = "TITLE: DF\nFCM: DROP FRAME\n\n001  AX       V     C        00:00:00;00 00:00:01;00 00:01:00;00 00:01:01;00\n";
    let parsed = parse_edl(text, 30000.0 / 1001.0);
    assert!(parsed.clips.is_empty());
    assert!(
        parsed
            .warnings
            .iter()
            .any(|warning| warning.contains("récord inválido")),
        "{:?}",
        parsed.warnings
    );
}

#[test]
fn edl_timecodes_without_drop_frame_convert_with_the_real_fps() {
    let text = "TITLE: NDF\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:10:00:00 00:10:01:00 00:10:00:00 00:10:01:00\n";
    let fps = 30000.0 / 1001.0;
    let parsed = parse_edl(text, fps);
    assert_eq!(parsed.clips.len(), 1);
    // NDF no saltea cuadros: 00:10:00:00 son 18000 cuadros reales.
    assert_eq!(seconds_to_frames(parsed.clips[0].start_seconds, fps), 18000);
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
}

#[test]
fn edl_drop_frame_warns_once_when_the_rate_cannot_drop() {
    let text = "TITLE: DF25\nFCM: DROP FRAME\n\n001  AX       V     C        00:00:00;00 00:00:01;00 00:00:00;00 00:00:01;00\n002  AX       V     C        00:00:01;00 00:00:02;00 00:00:01;00 00:00:02;00\n";
    let parsed = parse_edl(text, 25.0);
    assert_eq!(parsed.clips.len(), 2);
    assert_eq!(
        parsed
            .warnings
            .iter()
            .filter(|warning| warning.contains("drop-frame a 25 fps"))
            .count(),
        1,
        "el aviso debe salir una vez, no por evento: {:?}",
        parsed.warnings
    );
    assert!((parsed.clips[0].duration_seconds - 1.0).abs() < 0.001);
}

#[test]
fn parses_otio_track_with_gap() {
    let text = r#"{
          "OTIO_SCHEMA": "Timeline.1",
          "name": "Demo",
          "tracks": {
            "OTIO_SCHEMA": "Stack.1",
            "children": [{
              "OTIO_SCHEMA": "Track.1",
              "name": "V1",
              "kind": "Video",
              "children": [
                {"OTIO_SCHEMA":"Gap.1","source_range":{"start_time":{"value":0,"rate":30},"duration":{"value":15,"rate":30}}},
                {"OTIO_SCHEMA":"Clip.2","name":"Toma","source_range":{"start_time":{"value":30,"rate":30},"duration":{"value":60,"rate":30}},
                 "media_reference":{"OTIO_SCHEMA":"ExternalReference.1","target_url":"file:///media/toma.mp4",
                 "metadata":{"editor_ia":{"relative_path":"media/toma.mp4"}}}}
              ]
            }]
          }
        }"#;
    let parsed = parse_otio(text, 30.0).expect("OTIO");
    assert_eq!(parsed.tracks.len(), 1);
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    assert!((clip.start_seconds - 0.5).abs() < 0.001);
    assert!((clip.source_in_seconds - 1.0).abs() < 0.001);
    assert!((clip.duration_seconds - 2.0).abs() < 0.001);
    assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
}

fn otio_with_effect(effect: &str) -> String {
    format!(
        r#"{{
              "OTIO_SCHEMA": "Timeline.1",
              "tracks": {{
                "OTIO_SCHEMA": "Stack.1",
                "children": [{{
                  "OTIO_SCHEMA": "Track.1",
                  "name": "V1",
                  "kind": "Video",
                  "children": [{{
                    "OTIO_SCHEMA": "Clip.2",
                    "name": "Toma",
                    "source_range": {{"start_time": {{"value": 0, "rate": 30}}, "duration": {{"value": 60, "rate": 30}}}},
                    "media_reference": {{"OTIO_SCHEMA": "ExternalReference.1", "target_url": "file:///media/toma.mp4"}},
                    "effects": [{effect}]
                  }}]
                }}]
              }}
            }}"#
    )
}

#[test]
fn parses_otio_linear_time_warp_as_clip_speed() {
    let parsed = parse_otio(
        &otio_with_effect(
            r#"{"OTIO_SCHEMA": "LinearTimeWarp.1", "name": "2x", "time_scalar": 2.0}"#,
        ),
        30.0,
    )
    .expect("OTIO");
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    // 60 cuadros de medio a 2× duran 1 s en la timeline.
    assert!((clip.duration_seconds - 1.0).abs() < 0.001, "{clip:?}");
    assert_eq!((clip.speed_num, clip.speed_den), (2, 1));
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);

    let slow = parse_otio(
        &otio_with_effect(
            r#"{"OTIO_SCHEMA": "LinearTimeWarp.1", "name": "0.5x", "time_scalar": 0.5}"#,
        ),
        30.0,
    )
    .expect("OTIO");
    let clip = &slow.clips[0];
    assert!((clip.duration_seconds - 4.0).abs() < 0.001, "{clip:?}");
    assert_eq!((clip.speed_num, clip.speed_den), (1, 2));
}

#[test]
fn warns_about_otio_effects_it_cannot_import() {
    let parsed = parse_otio(
        &otio_with_effect(r#"{"OTIO_SCHEMA": "FreezeFrame.1", "name": "Freeze"}"#),
        30.0,
    )
    .expect("OTIO");
    assert_eq!(parsed.clips.len(), 1);
    assert!(
        parsed
            .warnings
            .iter()
            .any(|warning| warning.contains("FreezeFrame.1") && warning.contains("no se importa")),
        "{:?}",
        parsed.warnings
    );
    assert!((parsed.clips[0].duration_seconds - 2.0).abs() < 0.001);
    assert_eq!(
        (parsed.clips[0].speed_num, parsed.clips[0].speed_den),
        (1, 1)
    );
}

#[test]
fn imported_otio_speed_reaches_the_clip_json() {
    let dir = std::env::temp_dir().join(format!("editoria-otio-speed-{}", Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("media")).expect("media");
    std::fs::write(dir.join("media").join("toma.mp4"), b"").expect("medio");
    let timeline = dir.join("demo.otio");
    std::fs::write(
        &timeline,
        otio_with_effect(
            r#"{"OTIO_SCHEMA": "LinearTimeWarp.1", "name": "2x", "time_scalar": 2.0}"#,
        ),
    )
    .expect("otio");
    let project = json!({
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "status": "ready",
            "source": { "path": "media/toma.mp4" },
            "media": { "durationFrames": 300 }
        }],
        "timeline": { "tracks": [], "clips": [] }
    });
    let result =
        import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project).expect("importar");
    assert_eq!(result.clips.len(), 1);
    let clip = &result.clips[0];
    // 60 cuadros de medio a 2× → 30 en la timeline y 60 de medio consumido.
    assert_eq!(clip["durationFrames"], 30, "{clip}");
    assert_eq!(clip["source"]["inFrame"], 0);
    assert_eq!(clip["source"]["outFrame"], 60);
    assert_eq!(clip["speed"]["num"], 2);
    assert_eq!(clip["speed"]["den"], 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rejects_a_timeline_file_over_the_size_limit() {
    let dir = std::env::temp_dir().join(format!("editoria-import-big-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let path = dir.join("grande.edl");
    let file = std::fs::File::create(&path).expect("archivo");
    file.set_len(MAX_TIMELINE_BYTES + 1).expect("tamaño");
    drop(file);
    let project = json!({
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [],
        "timeline": { "tracks": [], "clips": [] }
    });
    let error = import_timeline_file(&dir, Path::new("ffprobe"), &path, &project)
        .expect_err("un archivo de 32 MB no debe leerse");
    assert!(
        error.message.contains("32 MB"),
        "mensaje inesperado: {}",
        error.message
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn empty_import_error_keeps_the_skip_reasons() {
    let dir = std::env::temp_dir().join(format!("editoria-import-empty-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let timeline = dir.join("demo.edl");
    std::fs::write(
            &timeline,
            "TITLE: Falta\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n* FROM CLIP NAME: Perdida\n* FILENAME: media/falta.mp4\n",
        )
        .expect("edl");
    let project = json!({
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [],
        "timeline": { "tracks": [], "clips": [] }
    });
    let error = import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project)
        .expect_err("sin medios no se importa nada");
    assert_eq!(error.code.name(), "EMPTY_TIMELINE");
    assert!(
        error.message.contains("no se encontró el medio"),
        "el error debe conservar el motivo: {}",
        error.message
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn parses_fcpxml_asset_gap_and_clip() {
    let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" start="0s" duration="2s" hasVideo="1">
            <media-rep kind="original-media" src="file:///media/toma.mp4"/>
          </asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <gap offset="0s" duration="1s"/>
            <clip offset="1s" duration="2s" name="Toma" start="0s">
              <video ref="r2" offset="0s" duration="2s"/>
            </clip>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
    let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    assert!((clip.start_seconds - 1.0).abs() < 0.001);
    assert!((clip.duration_seconds - 2.0).abs() < 0.001);
    assert_eq!(clip.media.as_deref(), Some("file:///media/toma.mp4"));
}

#[test]
fn parses_final_cut_asset_clips() {
    // Final Cut exporta la storyline con `<asset-clip ref=...>`; el
    // importador sólo leía `<clip><video ref=...>` y devolvía vacío.
    let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" start="0s" duration="3s" hasVideo="1" hasAudio="1">
            <media-rep kind="original-media" src="file:///media/toma.mp4"/>
          </asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <asset-clip ref="r2" offset="0s" duration="2s" start="1s" name="Toma"/>
            <gap offset="2s" duration="1s"/>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
    let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
    assert_eq!(parsed.clips.len(), 1);
    assert_eq!(parsed.tracks.len(), 1);
    assert_eq!(parsed.tracks[0].kind, TrackKind::Video);
    let clip = &parsed.clips[0];
    assert!((clip.start_seconds - 0.0).abs() < 0.001, "{clip:?}");
    assert!((clip.source_in_seconds - 1.0).abs() < 0.001, "{clip:?}");
    assert!((clip.duration_seconds - 2.0).abs() < 0.001, "{clip:?}");
    assert_eq!(clip.label, "Toma");
    assert_eq!(clip.media.as_deref(), Some("file:///media/toma.mp4"));
}

#[test]
fn parses_an_audio_only_asset_clip_into_an_audio_track() {
    let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Música" hasVideo="0" hasAudio="1"><media-rep src="file:///media/musica.wav"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <asset-clip ref="r2" offset="0s" duration="2s" name="Toma"/>
            <asset-clip ref="r3" offset="0s" duration="3s" name="Música"/>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
    let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
    assert_eq!(parsed.clips.len(), 2);
    assert_eq!(parsed.tracks.len(), 2);
    let video = &parsed.clips[0];
    let audio = &parsed.clips[1];
    assert_eq!(parsed.tracks[video.track_index].kind, TrackKind::Video);
    assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
    assert_eq!(audio.media.as_deref(), Some("file:///media/musica.wav"));
}

#[test]
fn imports_connected_audio_lanes_with_the_anchor_offset() {
    // Final Cut guarda la música en un lane conectado; su offset es
    // relativo al clip ancla y `audioStart` marca el origen del audio.
    let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Música" hasVideo="0" hasAudio="1"><media-rep src="file:///media/musica.wav"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <asset-clip ref="r2" offset="1s" duration="2s" name="Toma">
              <asset-clip lane="-1" ref="r3" offset="0.5s" duration="1s" start="0.25s" audioStart="0.25s" name="Música"/>
            </asset-clip>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
    let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
    assert_eq!(parsed.clips.len(), 2, "{:?}", parsed.warnings);
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    let audio = parsed
        .clips
        .iter()
        .find(|clip| clip.label == "Música")
        .expect("falta el clip de audio conectado");
    assert!((audio.start_seconds - 1.5).abs() < 0.001, "{audio:?}");
    assert!((audio.source_in_seconds - 0.25).abs() < 0.001, "{audio:?}");
    assert!((audio.duration_seconds - 1.0).abs() < 0.001, "{audio:?}");
    assert_eq!(audio.media.as_deref(), Some("file:///media/musica.wav"));
    assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
    let video = parsed
        .clips
        .iter()
        .find(|clip| clip.label == "Toma")
        .expect("falta el clip ancla");
    assert_eq!(parsed.tracks[video.track_index].kind, TrackKind::Video);
}

#[test]
fn imports_audio_lanes_anchored_to_a_gap() {
    // Una cortina musical puede arrancar sobre un hueco, antes del primer
    // clip; sin leer los lanes del gap esa música se perdía.
    let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Cortina" hasVideo="0" hasAudio="1"><media-rep src="file:///media/cortina.wav"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="3s"><spine>
            <gap offset="0s" duration="2s">
              <asset-clip lane="-1" ref="r3" offset="0.5s" duration="1s" start="0.2s" name="Cortina"/>
            </gap>
            <asset-clip ref="r2" offset="2s" duration="1s" name="Toma"/>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
    let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
    assert_eq!(parsed.clips.len(), 2, "{:?}", parsed.warnings);
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    let audio = parsed
        .clips
        .iter()
        .find(|clip| clip.label == "Cortina")
        .expect("falta la música anclada al hueco");
    assert!((audio.start_seconds - 0.5).abs() < 0.001, "{audio:?}");
    assert!((audio.source_in_seconds - 0.2).abs() < 0.001, "{audio:?}");
    assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
    let video = parsed
        .clips
        .iter()
        .find(|clip| clip.label == "Toma")
        .expect("falta el clip después del hueco");
    assert!((video.start_seconds - 2.0).abs() < 0.001, "{video:?}");
}

#[test]
fn warns_about_connected_video_lanes() {
    let text = r#"<?xml version="1.0" encoding="UTF-8"?>
        <fcpxml version="1.11"><resources>
          <format id="r1" frameDuration="1/30s" width="1920" height="1080"/>
          <asset id="r2" name="Toma" hasVideo="1"><media-rep src="file:///media/toma.mp4"/></asset>
          <asset id="r3" name="Overlay" hasVideo="1"><media-rep src="file:///media/overlay.mp4"/></asset>
        </resources><library><event name="E"><project name="P">
          <sequence format="r1" duration="2s"><spine>
            <asset-clip ref="r2" offset="0s" duration="2s" name="Toma">
              <asset-clip lane="1" ref="r3" offset="0s" duration="1s" name="Overlay"/>
            </asset-clip>
          </spine></sequence>
        </project></event></library></fcpxml>"#;
    let parsed = parse_fcpxml(text, 30.0).expect("FCPXML");
    assert_eq!(parsed.clips.len(), 1);
    assert_eq!(parsed.clips[0].label, "Toma");
    assert!(
        parsed
            .warnings
            .iter()
            .any(|warning| warning.contains("lanes conectados de video")),
        "{:?}",
        parsed.warnings
    );
}

#[test]
fn rejects_unsupported_extension() {
    assert!(detect_format(Path::new("demo.txt")).is_err());
    assert_eq!(detect_format(Path::new("demo.edl")).unwrap(), "edl");
    assert_eq!(detect_format(Path::new("demo.otio")).unwrap(), "otio");
    assert_eq!(detect_format(Path::new("demo.fcpxml")).unwrap(), "fcpxml");
}

#[test]
fn our_edl_export_round_trips_timing_and_media() {
    let project = serde_json::json!({
        "name": "Round",
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [{
            "id": "c", "kind": "video", "label": "Toma", "startFrame": 30,
            "durationFrames": 60,
            "source": { "type": "asset", "assetId": "a", "inFrame": 15, "outFrame": 75 }
        }] }
    });
    let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let exported = crate::commands::edl::export_edl_for_test(crate::commands::edl::EdlRequest {
        project,
        output_dir: dir.to_string_lossy().into_owned(),
    })
    .expect("exportar EDL");
    let text = std::fs::read_to_string(&exported.path).expect("leer");
    let parsed = parse_edl(&text, 30.0);
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    assert!((clip.start_seconds - 1.0).abs() < 0.001, "{clip:?}");
    assert!((clip.source_in_seconds - 0.5).abs() < 0.001, "{clip:?}");
    assert!((clip.duration_seconds - 2.0).abs() < 0.001, "{clip:?}");
    assert_eq!(clip.label, "Toma");
    assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn our_edl_export_round_trips_ntsc_frames() {
    let project = serde_json::json!({
        "name": "Ntsc",
        "video": { "frameRate": { "num": 30000, "den": 1001 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [{
            "id": "c", "kind": "video", "label": "Toma", "startFrame": 30,
            "durationFrames": 60,
            "source": { "type": "asset", "assetId": "a", "inFrame": 15, "outFrame": 75 }
        }] }
    });
    let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let exported = crate::commands::edl::export_edl_for_test(crate::commands::edl::EdlRequest {
        project,
        output_dir: dir.to_string_lossy().into_owned(),
    })
    .expect("exportar EDL");
    let text = std::fs::read_to_string(&exported.path).expect("leer");
    let fps = 30000.0 / 1001.0;
    let parsed = parse_edl(&text, fps);
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    // El EDL escribe NDF a 30 nominal; al leerlo con el fps real los
    // cuadros tienen que volver exactos, sin deriva de 3,6 s por hora.
    assert_eq!(seconds_to_frames(clip.start_seconds, fps), 30, "{clip:?}");
    assert_eq!(seconds_to_frames(clip.source_in_seconds, fps), 15);
    assert_eq!(seconds_to_frames(clip.duration_seconds, fps), 60);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn import_real_drop_frame_edl_from_resolve_or_premiere() {
    // EDL exportado por Resolve/Premiere con `FCM: DROP FRAME` y separador ;:
    // 00:10:00;00 es el cuadro 17982 (no 18000) porque faltan dos cuadros por
    // minuto salvo cada décimo: `(10*60 - 10/10)*2` = 11980 cuadros omitidos.
    let edl_text = r#"TITLE: Drop Frame Test
FCM: DROP FRAME

001  TEMA      V     C        00:10:00;00 00:10:02;00 00:10:00;00 00:10:02;00
* FROM CLIP NAME: Toma DF
* FILENAME: toma.mp4
"#;
    let fps_num = 30000u64;
    let fps_den = 1001u64;
    let fps = fps_num as f64 / fps_den as f64;
    let parsed = parse_edl(edl_text, fps);
    assert_eq!(parsed.clips.len(), 1, "{:?}", parsed.warnings);
    let clip = &parsed.clips[0];
    // La espera era 10 min * 30 fps ≈ 18000 frames, pero en DF faltan 18 cuadros:
    // el timecode correcto es **17982**.
    let expected_start_frame = 17982u64;
    let actual_start_frame = seconds_to_frames(clip.start_seconds, fps);
    assert_eq!(
        actual_start_frame, expected_start_frame,
        "DF debe dar 17982, no {}",
        actual_start_frame
    );
    // 60 frames a 29.97 = 2.002 s exactos (60/29.97); "2 segundos" de
    // timecode DF nunca son 2.000 s en segundos reales.
    assert!(
        (clip.duration_seconds - 60.0 / fps).abs() < 0.001,
        "duración 60 frames a 29.97 ≈ 2.002s: {:?}",
        clip.duration_seconds
    );
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
}

#[test]
fn warns_if_drop_frame_applies_to_non_29_97_rate() {
    // Drop-frame sólo existe en 29.97/59.94; en otro fps se lee NDF y avisa una vez.
    let edl_text = r#"TITLE: DF25
FCM: DROP FRAME

001  TEMA      V     C        00:00:00;00 00:00:01;00 00:00:00;00 00:00:01;00
"#;
    let parsed = parse_edl(edl_text, 25.0);
    assert_eq!(parsed.clips.len(), 1);
    assert!(
        parsed
            .warnings
            .iter()
            .any(|warning| warning.contains("drop-frame a 25 fps")
                && warning.contains("se interpreta NDF")),
        "debe avisar una sola vez: {:?}",
        parsed.warnings
    );
}

#[test]
fn our_otio_export_round_trips_gap_and_media() {
    let project = serde_json::json!({
        "name": "Round",
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": {
            "tracks": [{ "id": "v1", "name": "V1", "kind": "video", "hidden": false }],
            "clips": [{
                "id": "c", "kind": "video", "label": "Toma", "trackId": "v1",
                "startFrame": 30, "durationFrames": 60,
                "source": { "type": "asset", "assetId": "a", "inFrame": 15, "outFrame": 75 }
            }]
        }
    });
    let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let exported =
        crate::commands::otio::export_otio_for_test(crate::commands::otio::OtioRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar OTIO");
    let text = std::fs::read_to_string(&exported.path).expect("leer");
    let parsed = parse_otio(&text, 30.0).expect("parsear OTIO");
    assert_eq!(parsed.clips.len(), 1);
    let clip = &parsed.clips[0];
    assert!((clip.start_seconds - 1.0).abs() < 0.001, "{clip:?}");
    assert!((clip.source_in_seconds - 0.5).abs() < 0.001, "{clip:?}");
    assert!((clip.duration_seconds - 2.0).abs() < 0.001, "{clip:?}");
    assert_eq!(clip.media.as_deref(), Some("media/toma.mp4"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn our_otio_export_round_trips_speed() {
    let project = serde_json::json!({
        "name": "RoundSpeed",
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": {
            "tracks": [{ "id": "v1", "name": "V1", "kind": "video", "hidden": false }],
            "clips": [{
                "id": "c", "kind": "video", "label": "Rápida", "trackId": "v1",
                "startFrame": 0, "durationFrames": 30,
                "speed": { "num": 2, "den": 1 },
                "source": { "type": "asset", "assetId": "a", "inFrame": 5, "outFrame": 65 }
            }]
        }
    });
    let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let exported =
        crate::commands::otio::export_otio_for_test(crate::commands::otio::OtioRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar OTIO");
    let text = std::fs::read_to_string(&exported.path).expect("leer");
    let parsed = parse_otio(&text, 30.0).expect("parsear OTIO");
    assert_eq!(parsed.clips.len(), 1, "{:?}", parsed.warnings);
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    let clip = &parsed.clips[0];
    assert!((clip.start_seconds - 0.0).abs() < 0.001, "{clip:?}");
    assert!(
        (clip.source_in_seconds - 5.0 / 30.0).abs() < 0.001,
        "{clip:?}"
    );
    assert!((clip.duration_seconds - 1.0).abs() < 0.001, "{clip:?}");
    assert_eq!((clip.speed_num, clip.speed_den), (2, 1));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn our_fcpxml_export_round_trips_gaps_and_media() {
    let project = serde_json::json!({
        "name": "Round",
        "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [
            { "id": "first", "kind": "video", "label": "Primero",
              "startFrame": 0, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
            { "id": "second", "kind": "video", "label": "Segundo",
              "startFrame": 40, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 40, "outFrame": 70 } }
        ] }
    });
    let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let exported =
        crate::commands::fcpxml::export_fcpxml_for_test(crate::commands::fcpxml::FcpxmlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar FCPXML");
    let text = std::fs::read_to_string(&exported.path).expect("leer");
    let parsed = parse_fcpxml(&text, 30.0).expect("parsear FCPXML");
    assert_eq!(parsed.clips.len(), 2);
    assert!(
        parsed.clips[0].start_seconds.abs() < 0.001,
        "{:?}",
        parsed.clips[0]
    );
    assert!(
        (parsed.clips[1].start_seconds - 40.0 / 30.0).abs() < 0.001,
        "el gap no llegó al segundo clip: {:?}",
        parsed.clips[1]
    );
    assert!((parsed.clips[1].duration_seconds - 1.0).abs() < 0.001);
    assert_eq!(parsed.clips[1].label, "Segundo");
    assert_eq!(
        parsed.clips[1].media.as_deref(),
        Some("file:///media/toma.mp4")
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn edl_audio_track_reuses_the_video_asset_as_audio() {
    let dir = std::env::temp_dir().join(format!("editoria-audio-edl-{}", Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("media")).expect("media");
    std::fs::write(dir.join("media").join("toma.mp4"), b"").expect("medio");
    let timeline = dir.join("demo.edl");
    std::fs::write(
            &timeline,
            "TITLE: Audio\nFCM: NON-DROP FRAME\n\n001  toma     A     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n002  toma     V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n",
        )
        .expect("edl");
    let project = json!({
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [{
            "id": "a", "kind": "video", "status": "ready",
            "source": { "path": "media/toma.mp4" },
            "media": { "durationFrames": 300 }
        }],
        "timeline": { "tracks": [], "clips": [] }
    });
    let result =
        import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project).expect("importar");
    assert_eq!(result.imported_clips, 2, "{result:?}");
    assert_eq!(result.reused_assets, 1);
    let audio = result
        .clips
        .iter()
        .find(|clip| clip["kind"] == "audio")
        .expect("el evento A debe montar un clip de audio");
    let video = result
        .clips
        .iter()
        .find(|clip| clip["kind"] == "video")
        .expect("el evento V conserva el video");
    let audio_track = result
        .tracks
        .iter()
        .find(|track| track["id"] == audio["trackId"])
        .expect("pista del audio");
    assert_eq!(audio_track["kind"], "audio");
    let video_track = result
        .tracks
        .iter()
        .find(|track| track["id"] == video["trackId"])
        .expect("pista del video");
    assert_eq!(video_track["kind"], "video");
    assert_ne!(audio["trackId"], video["trackId"]);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn edl_audio_event_on_an_image_is_omitted() {
    let dir = std::env::temp_dir().join(format!("editoria-audio-img-{}", Uuid::new_v4()));
    std::fs::create_dir_all(dir.join("media")).expect("media");
    std::fs::write(dir.join("media").join("toma.mp4"), b"").expect("video");
    std::fs::write(dir.join("media").join("foto.png"), b"").expect("imagen");
    let timeline = dir.join("demo.edl");
    std::fs::write(
            &timeline,
            "TITLE: Audio\nFCM: NON-DROP FRAME\n\n001  foto     A     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n002  toma     V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n",
        )
        .expect("edl");
    let project = json!({
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [
            {
                "id": "video", "kind": "video", "status": "ready",
                "source": { "path": "media/toma.mp4" },
                "media": { "durationFrames": 300 }
            },
            {
                "id": "imagen", "kind": "image", "status": "ready",
                "source": { "path": "media/foto.png" },
                "media": { "width": 1920, "height": 1080 }
            }
        ],
        "timeline": { "tracks": [], "clips": [] }
    });
    let result =
        import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project).expect("importar");
    assert_eq!(result.imported_clips, 1);
    assert_eq!(result.clips[0]["kind"], "video");
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.contains("pista de audio apunta a una imagen")),
        "{:?}",
        result.warnings
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn our_fcpxml_export_round_trips_audio_lanes() {
    let project = serde_json::json!({
        "name": "RoundAudio",
        "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "hidden": false },
                { "id": "a1", "kind": "audio", "hidden": false }
            ],
            "clips": [
                { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma",
                  "startFrame": 0, "durationFrames": 90,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 90 } },
                { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música",
                  "startFrame": 15, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
            ]
        }
    });
    let dir = std::env::temp_dir().join(format!("editoria-roundtrip-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let exported =
        crate::commands::fcpxml::export_fcpxml_for_test(crate::commands::fcpxml::FcpxmlRequest {
            project,
            output_dir: dir.to_string_lossy().into_owned(),
        })
        .expect("exportar FCPXML con audio");
    assert_eq!(exported.clips, 2);
    let text = std::fs::read_to_string(&exported.path).expect("leer");
    let parsed = parse_fcpxml(&text, 30.0).expect("parsear FCPXML con audio");
    assert_eq!(parsed.clips.len(), 2, "{:?}", parsed.warnings);
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    let video = parsed
        .clips
        .iter()
        .find(|clip| clip.label == "Toma")
        .expect("falta el clip de video");
    assert_eq!(parsed.tracks[video.track_index].kind, TrackKind::Video);
    let audio = parsed
        .clips
        .iter()
        .find(|clip| clip.label == "Música")
        .expect("falta el lane de audio");
    assert!((audio.start_seconds - 0.5).abs() < 0.001, "{audio:?}");
    assert!((audio.source_in_seconds - 1.0).abs() < 0.001, "{audio:?}");
    assert!((audio.duration_seconds - 1.0).abs() < 0.001, "{audio:?}");
    assert_eq!(audio.media.as_deref(), Some("file:///media/toma.mp4"));
    assert_eq!(parsed.tracks[audio.track_index].kind, TrackKind::Audio);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere ffmpeg/ffprobe y un video de prueba"]
fn imports_real_otio_and_fcpxml_with_media() {
    let dir = std::env::temp_dir().join(format!("editoria-timeline-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("toma.mp4");
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg");
    assert!(generated.success());
    let project = json!({
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [],
        "timeline": { "tracks": [], "clips": [] }
    });
    let otio = dir.join("demo.otio");
    std::fs::write(
            &otio,
            r#"{"OTIO_SCHEMA":"Timeline.1","name":"Demo","tracks":{"OTIO_SCHEMA":"Stack.1","children":[{"OTIO_SCHEMA":"Track.1","name":"V1","kind":"Video","children":[{"OTIO_SCHEMA":"Clip.2","name":"Toma","source_range":{"start_time":{"value":0,"rate":30},"duration":{"value":60,"rate":30}},"media_reference":{"OTIO_SCHEMA":"ExternalReference.1","target_url":"file:///media/toma.mp4","metadata":{"editor_ia":{"relative_path":"media/toma.mp4"}}}}]}]}}"#,
        )
        .expect("otio");
    let fcpxml = dir.join("demo.fcpxml");
    std::fs::write(
        &fcpxml,
        r#"<?xml version="1.0" encoding="UTF-8"?>
            <fcpxml version="1.11"><resources>
              <format id="r1" frameDuration="1/30s" width="160" height="90"/>
              <asset id="r2" name="Toma" start="0s" duration="2s" hasVideo="1">
                <media-rep kind="original-media" src="file:///media/toma.mp4"/>
              </asset>
            </resources><library><event name="E"><project name="P">
              <sequence format="r1" duration="2s"><spine>
                <clip offset="0s" duration="2s" name="Toma" start="0s">
                  <video ref="r2" offset="0s" duration="2s"/>
                </clip>
              </spine></sequence>
            </project></event></library></fcpxml>"#,
    )
    .expect("fcpxml");
    for (path, format) in [(&otio, "otio"), (&fcpxml, "fcpxml")] {
        let result =
            import_timeline_file(&dir, Path::new("ffprobe"), path, &project).expect("importar");
        assert_eq!(result.format, format);
        assert_eq!(result.imported_clips, 1);
        assert_eq!(result.tracks.len(), 1);
        assert_eq!(result.clips.len(), 1);
        assert!(result.assets[0]["source"]["path"]
            .as_str()
            .unwrap()
            .starts_with("media/"));
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "requiere ffmpeg/ffprobe y un video de prueba"]
fn imports_a_real_edl_and_copies_media() {
    let dir = std::env::temp_dir().join(format!("editoria-timeline-{}", Uuid::new_v4()));
    let media = dir.join("media");
    std::fs::create_dir_all(&media).expect("media");
    let video = media.join("toma.mp4");
    let generated = std::process::Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x90:d=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&video)
        .status()
        .expect("ffmpeg");
    assert!(generated.success());
    let timeline = dir.join("demo.edl");
    std::fs::write(
            &timeline,
            "TITLE: Demo\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00\n* FROM CLIP NAME: Toma\n* FILENAME: media/toma.mp4\n",
        )
        .expect("edl");
    let project = json!({
        "video": { "frameRate": { "num": 30, "den": 1 } },
        "assets": [],
        "timeline": { "tracks": [], "clips": [] }
    });
    let result =
        import_timeline_file(&dir, Path::new("ffprobe"), &timeline, &project).expect("importar");
    assert_eq!(result.format, "edl");
    assert_eq!(result.imported_clips, 1);
    assert_eq!(result.new_assets, 1);
    assert_eq!(result.tracks.len(), 1);
    assert_eq!(result.clips.len(), 1);
    assert!(result.assets[0]["source"]["path"]
        .as_str()
        .unwrap()
        .starts_with("media/"));
    let _ = std::fs::remove_dir_all(&dir);
}
