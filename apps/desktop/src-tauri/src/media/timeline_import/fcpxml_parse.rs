type FcpxmlAssets = HashMap<String, (String, String, bool)>;

fn fcpxml_track(
    parsed: &mut ParsedTimeline,
    slot: &mut Option<usize>,
    kind: TrackKind,
    label: &str,
) -> usize {
    if let Some(index) = *slot {
        return index;
    }
    parsed.tracks.push(ParsedTrack {
        label: label.to_owned(),
        kind,
    });
    let index = parsed.tracks.len() - 1;
    *slot = Some(index);
    index
}

/// Lee un `<clip>`/`<asset-clip>` de FCPXML. `Ok(None)` es un clip sin
/// duración que se ignora en silencio; `Err` es un aviso para el usuario.
fn read_fcpxml_item(
    node: roxmltree::Node<'_, '_>,
    start_seconds: f64,
    assets: &FcpxmlAssets,
    project_fps: f64,
) -> Result<Option<(ParsedClip, bool)>, String> {
    let duration = node
        .attribute("duration")
        .and_then(|value| fcpxml_time(value, project_fps))
        .unwrap_or(0.0);
    if duration <= 0.0 {
        return Ok(None);
    }
    let source_in = node
        .attribute("start")
        .or_else(|| node.attribute("audioStart"))
        .and_then(|value| fcpxml_time(value, project_fps))
        .unwrap_or(0.0);
    let media_ref = node.attribute("ref").or_else(|| {
        node.descendants()
            .find(|child| child.has_tag_name("video") || child.has_tag_name("audio"))
            .and_then(|child| child.attribute("ref"))
    });
    let Some(media_ref) = media_ref else {
        return Err("FCPXML: un clip no referencia un asset".to_owned());
    };
    let Some((media, asset_name, has_video)) = assets.get(media_ref) else {
        return Err(format!("FCPXML: falta el asset {media_ref}"));
    };
    let label = node
        .attribute("name")
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(asset_name.as_str())
        .to_owned();
    Ok(Some((
        ParsedClip {
            track_index: 0,
            label,
            start_seconds,
            source_in_seconds: source_in,
            duration_seconds: duration,
            speed_num: 1,
            speed_den: 1,
            media: Some(media.clone()),
            media_hint: Some(asset_name.clone()),
        },
        *has_video,
    )))
}

/// Importa los lanes conectados de audio de un ancla (clip o hueco). El
/// `offset` del lane es relativo al inicio del ancla. Devuelve `true` si había
/// lanes que no se pudieron importar (video, títulos u otros).
fn read_fcpxml_lanes(
    node: roxmltree::Node<'_, '_>,
    anchor_start: f64,
    assets: &FcpxmlAssets,
    project_fps: f64,
    parsed: &mut ParsedTimeline,
    audio_track: &mut Option<usize>,
) -> bool {
    let mut skipped = node
        .descendants()
        .any(|child| child.has_attribute("lane") && !child.has_tag_name("asset-clip"));
    for lane in node
        .children()
        .filter(|child| child.has_tag_name("asset-clip") && child.has_attribute("lane"))
    {
        let negative_lane = lane
            .attribute("lane")
            .and_then(|value| value.trim().parse::<i32>().ok())
            .map(|value| value < 0)
            .unwrap_or(false);
        let offset = lane
            .attribute("offset")
            .and_then(|value| fcpxml_time(value, project_fps))
            .unwrap_or(0.0);
        match read_fcpxml_item(lane, anchor_start + offset, assets, project_fps) {
            Ok(Some((mut item, lane_has_video))) if !lane_has_video && negative_lane => {
                item.track_index =
                    fcpxml_track(parsed, audio_track, TrackKind::Audio, "FCPXML audio");
                parsed.clips.push(item);
            }
            Ok(Some(_)) => skipped = true,
            Ok(None) => {}
            Err(message) => parsed.warnings.push(message),
        }
    }
    skipped
}

pub(crate) fn parse_fcpxml(text: &str, project_fps: f64) -> Result<ParsedTimeline, ProjectError> {
    let document = roxmltree::Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .map_err(|error| {
        ProjectError::message(
            ProjectErrorCode::InvalidProject,
            format!("el FCPXML no es XML válido: {error}").as_str(),
        )
    })?;
    let root = document.root_element();
    // `hasVideo` decide si el clip va a la pista de video o a la de audio;
    // Final Cut exporta la storyline con `<asset-clip>`, no con `<clip>`.
    let mut assets: FcpxmlAssets = HashMap::new();
    for node in root.descendants().filter(|node| node.has_tag_name("asset")) {
        let Some(id) = node.attribute("id") else {
            continue;
        };
        let Some(src) = node
            .descendants()
            .find(|child| child.has_tag_name("media-rep"))
            .and_then(|media| media.attribute("src"))
        else {
            continue;
        };
        let name = node.attribute("name").unwrap_or(id);
        let has_video = node
            .attribute("hasVideo")
            .map(|value| value != "0" && value != "false")
            .unwrap_or(true);
        assets.insert(id.to_owned(), (src.to_owned(), name.to_owned(), has_video));
    }
    let Some(spine) = root.descendants().find(|node| node.has_tag_name("spine")) else {
        return Err(ProjectError::message(
            ProjectErrorCode::EmptyTimeline,
            "el FCPXML no tiene una spine",
        ));
    };
    let mut parsed = ParsedTimeline {
        fps: root
            .descendants()
            .find(|node| node.has_tag_name("format"))
            .and_then(|node| node.attribute("frameDuration"))
            .and_then(|duration| fcpxml_time(duration, project_fps))
            .and_then(|duration| (duration > 0.0).then(|| 1.0 / duration)),
        ..Default::default()
    };
    let mut video_track: Option<usize> = None;
    let mut audio_track: Option<usize> = None;
    let mut cursor = 0.0;
    for child in spine.children().filter(|node| node.is_element()) {
        if child.has_tag_name("gap") {
            let duration = child
                .attribute("duration")
                .and_then(|value| fcpxml_time(value, project_fps))
                .unwrap_or(0.0);
            let gap_start = child
                .attribute("offset")
                .and_then(|value| fcpxml_time(value, project_fps))
                .unwrap_or(cursor);
            // Un hueco también puede anclar música conectada (por ejemplo,
            // una cortina que arranca en negro antes del primer clip).
            if read_fcpxml_lanes(
                child,
                gap_start,
                &assets,
                project_fps,
                &mut parsed,
                &mut audio_track,
            ) {
                parsed.warnings.push(format!(
                    "FCPXML: el hueco en {gap_start:.2}s tiene lanes conectados de video o títulos; no se importaron"
                ));
            }
            cursor = gap_start + duration;
            continue;
        }
        if child.has_tag_name("transition") {
            parsed
                .warnings
                .push("FCPXML: una transición se importó como corte".to_owned());
            continue;
        }
        if !(child.has_tag_name("clip") || child.has_tag_name("asset-clip")) {
            continue;
        }
        let start = child
            .attribute("offset")
            .and_then(|value| fcpxml_time(value, project_fps))
            .unwrap_or(cursor);
        let (mut clip, has_video) = match read_fcpxml_item(child, start, &assets, project_fps) {
            Ok(Some(item)) => item,
            Ok(None) => continue,
            Err(message) => {
                parsed.warnings.push(message);
                continue;
            }
        };
        if child.descendants().any(|node| node.has_tag_name("spine")) {
            parsed.warnings.push(format!(
                "FCPXML: {} tiene un stack anidado; no se importó",
                clip.label
            ));
        }
        clip.track_index = if has_video {
            fcpxml_track(&mut parsed, &mut video_track, TrackKind::Video, "FCPXML")
        } else {
            fcpxml_track(
                &mut parsed,
                &mut audio_track,
                TrackKind::Audio,
                "FCPXML audio",
            )
        };
        let anchor_start = clip.start_seconds;
        let anchor_duration = clip.duration_seconds;
        parsed.clips.push(clip);
        // Los lanes conectados llevan la música y la voz; su `offset` es
        // relativo al inicio del clip ancla, no a la timeline.
        if read_fcpxml_lanes(
            child,
            anchor_start,
            &assets,
            project_fps,
            &mut parsed,
            &mut audio_track,
        ) {
            parsed.warnings.push(format!(
                "FCPXML: el clip {anchor_start:.2}s tiene lanes conectados de video o títulos; no se importaron"
            ));
        }
        cursor = anchor_start + anchor_duration;
    }
    Ok(parsed)
}

fn fcpxml_time(raw: &str, fps: f64) -> Option<f64> {
    let value = raw.trim();
    let value = value.strip_suffix('s').unwrap_or(value);
    if let Some((numerator, denominator)) = value.split_once('/') {
        let numerator: f64 = numerator.trim().parse().ok()?;
        let denominator: f64 = denominator.trim().parse().ok()?;
        if denominator <= 0.0 {
            return None;
        }
        return Some(numerator / denominator);
    }
    if value.contains(':') {
        let frames = parse_timecode(value, fps.max(1.0).round() as u32, false)?;
        return Some(frames as f64 / fps.max(1.0));
    }
    value.parse().ok()
}
