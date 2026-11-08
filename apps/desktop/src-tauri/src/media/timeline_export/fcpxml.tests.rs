use super::*;
use crate::commands::fcpxml::{export_fcpxml_for_test, FcpxmlRequest};
use uuid::Uuid;

#[test]
fn fcpxml_has_resources_spine_and_clip() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [{ "id": "c", "kind": "video", "label": "Toma", "startFrame": 30,
            "durationFrames": 60, "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } }] }
    });
    let dir = std::env::temp_dir().join(format!("editoria-fcpxml-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let result = export_fcpxml_for_test(FcpxmlRequest {
        project,
        output_dir: dir.to_string_lossy().into_owned(),
    })
    .expect("fcpxml");
    let text = std::fs::read_to_string(&result.path).expect("leer");
    assert!(text.contains("<fcpxml version=\"1.11\">"));
    assert!(text.contains("frameDuration=\"1/30s\""), "{text}");
    assert!(text.contains("<spine>"));
    assert!(text.contains("name=\"Toma\""));
    assert!(
        text.contains("<asset-clip ref=\"r2\" offset=\"1.000000s\""),
        "la spine debería usar asset-clip como Final Cut: {text}"
    );
    assert!(!text.contains("<video ref="), "{text}");
    roxmltree::Document::parse_with_options(
        &text,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .expect("XML válido");
    assert_eq!(result.clips, 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fcpxml_skips_clips_on_hidden_tracks() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": {
            "tracks": [
                { "id": "v1", "kind": "video", "hidden": true },
                { "id": "v2", "kind": "video", "hidden": false }
            ],
            "clips": [
                { "id": "hidden", "trackId": "v1", "kind": "video", "label": "Oculta",
                  "startFrame": 0, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
                { "id": "visible", "trackId": "v2", "kind": "video", "label": "Visible",
                  "startFrame": 30, "durationFrames": 30,
                  "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
            ]
        }
    });
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 1);
    assert!(xml.contains("name=\"Visible\""), "{xml}");
    assert!(!xml.contains("Oculta"), "{xml}");
    assert!(warnings.is_empty(), "{warnings:?}");
}

#[test]
fn fcpxml_skips_disabled_clips() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [
            { "id": "off", "kind": "video", "label": "Apagado", "enabled": false,
              "startFrame": 0, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
            { "id": "on", "kind": "video", "label": "Activo", "enabled": true,
              "startFrame": 30, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
        ] }
    });
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 1);
    assert!(xml.contains("name=\"Activo\""), "{xml}");
    assert!(!xml.contains("Apagado"), "{xml}");
    assert!(warnings.is_empty(), "{warnings:?}");
}

#[test]
fn fcpxml_writes_a_gap_between_separated_clips() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
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
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 2);
    assert!(
        xml.contains("<gap offset=\"1.000000s\" duration=\"0.333333s\"/>"),
        "falta el hueco entre clips separados: {xml}"
    );
    roxmltree::Document::parse_with_options(
        &xml,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .expect("XML válido");
    assert!(warnings.is_empty(), "{warnings:?}");
}

#[test]
fn fcpxml_skips_clips_without_a_resolvable_asset() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [
            { "id": "orphan", "kind": "video", "label": "Huérfano",
              "startFrame": 0, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "missing", "inFrame": 0, "outFrame": 30 } },
            { "id": "ok", "kind": "video", "label": "Buena",
              "startFrame": 30, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
        ] }
    });
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 1);
    assert!(xml.contains("name=\"Buena\""), "{xml}");
    assert!(!xml.contains("Huérfano"), "{xml}");
    assert!(
        !xml.contains("src=\"file:///\""),
        "media rota en el XML: {xml}"
    );
    // El hueco de 0 a 30 sigue existiendo: el clip omitido no lo tapa.
    assert!(
        xml.contains("<gap offset=\"0.000000s\" duration=\"1.000000s\"/>"),
        "{xml}"
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("Huérfano") && warning.contains("asset")),
        "{warnings:?}"
    );
}

#[test]
fn fcpxml_warns_about_speed_reverse_and_transitions() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [{
            "id": "c", "kind": "video", "label": "Rápida",
            "startFrame": 0, "durationFrames": 30,
            "speed": { "num": 2, "den": 1 }, "reverse": true,
            "transitionIn": { "type": "dissolve", "frames": 6 },
            "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 }
        }] }
    });
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 1);
    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("velocidad/reverse")),
        "{warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("transición")),
        "{warnings:?}"
    );
    assert!(xml.contains("name=\"Rápida\""), "{xml}");
}

#[test]
fn fcpxml_rejects_a_timeline_with_only_zero_duration_clips() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [{ "id": "zero", "kind": "video", "label": "Cero",
            "startFrame": 0, "durationFrames": 0,
            "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 0 } }] }
    });
    let dir = std::env::temp_dir().join(format!("editoria-fcpxml-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let error = export_fcpxml_for_test(FcpxmlRequest {
        project,
        output_dir: dir.to_string_lossy().into_owned(),
    })
    .expect_err("una timeline sin clips escritos no debe exportarse");
    assert_eq!(error.code.name(), "EMPTY_TIMELINE");
    assert_eq!(std::fs::read_dir(&dir).expect("dir").count(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn fcpxml_exports_audio_as_a_connected_lane() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "tracks": [
            { "id": "v1", "kind": "video", "hidden": false },
            { "id": "a1", "kind": "audio", "hidden": false }
        ], "clips": [
            { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 90,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 90 } },
            { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música", "startFrame": 15, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 30, "outFrame": 60 } }
        ] }
    });
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 2, "{warnings:?}");
    assert!(warnings.is_empty(), "{warnings:?}");
    assert!(
        xml.contains(
            "lane=\"-1\" ref=\"r3\" offset=\"0.500000s\" duration=\"1.000000s\" name=\"Música\""
        ),
        "el audio debería ser un lane relativo al ancla: {xml}"
    );
    assert!(xml.contains("hasAudio=\"1\""), "{xml}");
    roxmltree::Document::parse_with_options(
        &xml,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .expect("XML válido");
}

#[test]
fn fcpxml_exports_audio_clips_on_hidden_audio_tracks_out() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "tracks": [
            { "id": "v1", "kind": "video", "hidden": false },
            { "id": "a1", "kind": "audio", "hidden": true }
        ], "clips": [
            { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 60,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } },
            { "id": "au", "trackId": "a1", "kind": "audio", "label": "Oculta", "startFrame": 0, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } }
        ] }
    });
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 1);
    assert!(!xml.contains("Oculta"), "{xml}");
    assert!(!xml.contains("lane=\"-1\""), "{xml}");
    assert!(warnings.is_empty(), "{warnings:?}");
}

#[test]
fn fcpxml_exports_an_audio_only_timeline_over_a_gap() {
    let project = serde_json::json!({
        "name": "SoloAudio", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/musica.wav" } }],
        "timeline": { "tracks": [
            { "id": "a1", "kind": "audio", "hidden": false }
        ], "clips": [
            { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música", "startFrame": 0, "durationFrames": 60,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 60 } }
        ] }
    });
    let (xml, clips, warnings) = build_xml(&project);
    assert_eq!(clips, 1, "{warnings:?}");
    assert!(xml.contains("lane=\"-1\""), "{xml}");
    assert!(
        xml.contains("<gap offset=\"0.000000s\" duration=\"2.000000s\""),
        "una timeline sólo de audio se ancla a un hueco: {xml}"
    );
    roxmltree::Document::parse_with_options(
        &xml,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .expect("XML válido");
}

#[test]
fn fcpxml_warns_about_graphics_and_adjustments_but_writes_audio() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "captions": { "cues": [
            { "id": "cue1", "trackId": "c1", "startFrame": 0, "endFrame": 30, "text": "Hola" },
            { "id": "cue2", "trackId": "c2", "startFrame": 0, "endFrame": 30, "text": "Oculto" }
        ] },
        "timeline": { "tracks": [
            { "id": "v1", "kind": "video", "hidden": false },
            { "id": "a1", "kind": "audio", "hidden": false },
            { "id": "c1", "kind": "caption", "hidden": false },
            { "id": "c2", "kind": "caption", "hidden": true }
        ], "clips": [
            { "id": "v", "trackId": "v1", "kind": "video", "label": "Toma", "startFrame": 0, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
            { "id": "g", "kind": "graphic", "label": "Título", "startFrame": 0, "durationFrames": 30,
              "source": { "type": "graphic" } },
            { "id": "adj", "kind": "adjustment", "label": "Look", "startFrame": 0, "durationFrames": 30 },
            { "id": "au", "trackId": "a1", "kind": "audio", "label": "Música", "startFrame": 0, "durationFrames": 30,
              "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } },
            { "id": "off", "kind": "adjustment", "label": "Apagada", "enabled": false,
              "startFrame": 0, "durationFrames": 30 }
        ] }
    });
    let (xml, clips, warnings) = build_xml(&project);
    // Video + audio: el audio ya no se pierde, viaja como lane conectado.
    assert_eq!(clips, 2);
    assert!(xml.contains("name=\"Toma\""), "{xml}");
    assert!(
        xml.contains("lane=\"-1\"") && xml.contains("hasAudio=\"1\""),
        "{xml}"
    );
    assert_eq!(warnings.len(), 3, "{warnings:?}");
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("1 clip(s) gráfico(s)")),
        "{warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("1 capa(s) de ajuste")),
        "{warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("1 subtítulo(s)")),
        "{warnings:?}"
    );
}

#[test]
fn fcpxml_writes_the_frame_duration_not_the_rate() {
    let project = serde_json::json!({
        "name": "NTSC", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30000, "den": 1001 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": { "clips": [{ "id": "c", "kind": "video", "label": "Toma",
            "startFrame": 0, "durationFrames": 30,
            "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 30 } }] }
    });
    let (xml, _, _) = build_xml(&project);
    assert!(xml.contains("frameDuration=\"1001/30000s\""), "{xml}");
    assert!(
        xml.contains("<asset-clip ref=\"r2\" offset=\"0.000000s\" duration=\"1.001000s\""),
        "30 frames a 29.97 son 1.001 s: {xml}"
    );
}

#[test]
fn fcpxml_expands_compound_clips() {
    let project = serde_json::json!({
        "name": "Demo", "video": { "width": 1920, "height": 1080, "frameRate": { "num": 30, "den": 1 } },
        "assets": [{ "id": "a", "source": { "path": "media/toma.mp4" } }],
        "timeline": {
            "clips": [{
                "id": "outer", "kind": "compound", "label": "Grupo",
                "startFrame": 10, "durationFrames": 20,
                "source": { "type": "compound", "compoundId": "c1" }
            }]
        },
        "compounds": [{
            "id": "c1", "label": "Grupo", "durationFrames": 20,
            "clips": [{
                "id": "inner", "kind": "video", "label": "Toma",
                "startFrame": 0, "durationFrames": 20,
                "source": { "type": "asset", "assetId": "a", "inFrame": 0, "outFrame": 20 }
            }]
        }]
    });
    let dir = std::env::temp_dir().join(format!("editoria-fcpxml-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).expect("dir");
    let result = export_fcpxml_for_test(FcpxmlRequest {
        project,
        output_dir: dir.to_string_lossy().into_owned(),
    })
    .expect("fcpxml");
    let text = std::fs::read_to_string(&result.path).expect("leer");
    assert_eq!(result.clips, 1);
    assert!(text.contains("name=\"Toma\""), "{text}");
    assert!(!text.contains("name=\"Grupo\""), "{text}");
    let _ = std::fs::remove_dir_all(&dir);
}
