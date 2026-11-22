// Adaptador `filmcraft-interchange`: AAF, OMF y FCP7 XML (xmeml), además de
// EDL/OTIO/FCPXML que ya cubren los parsers nativos. Convierte el `Project`
// de filmcraft a `ParsedTimeline`; la orquestación (importar assets,
// construir tracks y clips) es exactamente la misma que para los formatos
// nativos.
//
// Lo que el formato no puede representar (transiciones, efectos, clips
// anidados más allá de subclips de un nivel, generadores) se avisa en
// `warnings` y no se inventa.

use filmcraft_interchange as interchange;
use filmcraft_project::{ItemKind, MediaRef};

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

/// Parsea bytes de un documento de intercambio (binario o texto) con
/// detección por contenido + extensión.
pub(crate) fn parse_interchange(
    bytes: &[u8],
    path: &Path,
    _fps: f64,
) -> Result<ParsedTimeline, ProjectError> {
    let ext = path.extension().and_then(|value| value.to_str());
    let format = interchange::detect(bytes, ext).ok_or_else(|| {
        invalid("formato de intercambio no reconocido (aaf/omf/edl/otio/fcpxml/fcp7xml)")
    })?;
    let base_dir = path
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned());
    let options = interchange::ImportOptions {
        base_dir,
        ..Default::default()
    };
    let (imported, report) = interchange::import_with(bytes, format, &options).map_err(|error| {
        invalid(&format!("no se pudo importar la timeline: {error}"))
    })?;

    let mut parsed = ParsedTimeline::default();
    for entry in report.warnings() {
        parsed
            .warnings
            .push(format!("{} (×{})", entry.message, entry.count.max(1)));
    }

    // La primera secuencia del documento es la que se monta (los formatos de
    // intercambio rarely traen más de una; las demás se avisan).
    let Some(sequence_id) = imported.sequences.first().copied() else {
        return Err(invalid("el documento no contiene ninguna secuencia"));
    };
    if imported.sequences.len() > 1 {
        parsed.warnings.push(format!(
            "el documento tiene {} secuencias; se importa la primera",
            imported.sequences.len()
        ));
    }
    let Some(sequence_item) = imported.project.items.get(&sequence_id) else {
        return Err(invalid("la secuencia referenciada no está en el proyecto importado"));
    };
    let ItemKind::Sequence(sequence) = &sequence_item.kind else {
        return Err(invalid("el elemento principal no es una secuencia"));
    };
    let rate = sequence.settings.frame_rate;
    parsed.fps = Some(rate.num as f64 / rate.den.max(1) as f64);

    // Tracks: primero video, después audio (mismo orden que el motor).
    for (kind, tracks) in [
        (TrackKind::Video, &sequence.video_tracks),
        (TrackKind::Audio, &sequence.audio_tracks),
    ] {
        for track in tracks {
            let track_index = parsed.tracks.len();
            parsed.tracks.push(ParsedTrack {
                label: if track.name.is_empty() {
                    format!("{:?} {}", kind, track_index + 1)
                } else {
                    track.name.clone()
                },
                kind,
            });
            for item in &track.items {
                let Some(project_item) = imported.project.items.get(&item.item) else {
                    parsed.warnings.push(format!(
                        "clip «{}»: el ítem de origen no está en el proyecto",
                        item.name
                    ));
                    continue;
                };
                // Resuelve el medio: un subclip usa el padre y su rango;
                // secuencias anidadas y generadores no se montan.
                let (media_path, source_in) = match &project_item.kind {
                    ItemKind::Media(media) => match &media.media {
                        MediaRef::File { path } => (Some(path.clone()), item.source_in.seconds()),
                        MediaRef::Generator(_) => {
                            parsed.warnings.push(format!(
                                "clip «{}»: generadores sintéticos no se importan",
                                item.name
                            ));
                            continue;
                        }
                    },
                    ItemKind::Subclip { parent, range, .. } => {
                        match imported.project.items.get(parent).map(|p| &p.kind) {
                            Some(ItemKind::Media(media)) => match &media.media {
                                MediaRef::File { path } => (
                                    Some(path.clone()),
                                    range.start.seconds().max(0.0),
                                ),
                                MediaRef::Generator(_) => {
                                    parsed.warnings.push(format!(
                                        "clip «{}»: generadores sintéticos no se importan",
                                        item.name
                                    ));
                                    continue;
                                }
                            },
                            _ => {
                                parsed.warnings.push(format!(
                                    "clip «{}»: subclip sin medio resoluble",
                                    item.name
                                ));
                                continue;
                            }
                        }
                    }
                    ItemKind::Sequence(_) => {
                        parsed.warnings.push(format!(
                            "clip «{}»: secuencia anidada no se aplana (se omite)",
                            item.name
                        ));
                        continue;
                    }
                    ItemKind::AdjustmentLayer { .. } | ItemKind::Graphic { .. } => {
                        parsed.warnings.push(format!(
                            "clip «{}»: capas de gráfico no se importan",
                            item.name
                        ));
                        continue;
                    }
                };
                let Some(media) = media_path else {
                    continue;
                };
                // Speed: f64 → racional aprox (milésimas). Reverse no tiene
                // campo en ParsedClip: se avisa y se monta a velocidad positiva.
                let (speed_num, speed_den) = if (item.speed - 1.0).abs() < 0.0005 {
                    (1u32, 1u32)
                } else {
                    let scaled = (item.speed.abs() * 1000.0).round().clamp(1.0, 4_000_000.0) as u32;
                    if item.speed < 0.0 {
                        parsed.warnings.push(format!(
                            "clip «{}»: reproducción inversa no se importa",
                            item.name
                        ));
                    }
                    (scaled, 1000u32)
                };
                parsed.clips.push(ParsedClip {
                    track_index,
                    label: if item.name.is_empty() {
                        project_item.name.clone()
                    } else {
                        item.name.clone()
                    },
                    start_seconds: item.start.seconds().max(0.0),
                    source_in_seconds: source_in,
                    duration_seconds: item.duration.seconds().max(0.0),
                    speed_num,
                    speed_den,
                    media: Some(media),
                    media_hint: None,
                });
            }
        }
    }
    Ok(parsed)
}

#[cfg(test)]
mod filmcraft_tests {
    use super::*;

    #[test]
    fn rejects_unknown_bytes() {
        let result = parse_interchange(b"not a timeline at all", Path::new("x.aaf"), 25.0);
        assert!(result.is_err());
    }

    #[test]
    fn imports_fcp7_xml_sequence() {
        // xmeml mínimo con un clip de vídeo y el audio linkeado.
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="5">
  <sequence id="seq1">
    <name>Test</name>
    <media>
      <video>
        <track><clipitem id="c1"><name>clipA</name><file id="f1"><pathurl>file:///C:/media/a.mov</pathurl></file><start>0</start><end>100</end><in>0</in><out>100</out></clipitem></track>
      </video>
      <audio>
        <track><clipitem id="c2"><name>clipA</name><file id="f1"><pathurl>file:///C:/media/a.mov</pathurl></file><start>0</start><end>100</end><in>0</in><out>100</out></clipitem></track>
      </audio>
    </media>
  </sequence>
</xmeml>"#;
        let dir = std::env::temp_dir().join(format!("olyvia-xmeml-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("timeline.xml");
        std::fs::write(&path, xml).unwrap();
        let result = parse_interchange(xml.as_bytes(), &path, 25.0);
        let _ = std::fs::remove_dir_all(&dir);
        let parsed = result.expect("xmeml debe parsear");
        assert!(!parsed.tracks.is_empty());
        assert!(!parsed.clips.is_empty());
    }
}
