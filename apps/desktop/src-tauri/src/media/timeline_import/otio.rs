pub(crate) fn parse_edl(text: &str, fps: f64) -> ParsedTimeline {
    let mut parsed = ParsedTimeline::default();
    let mut tracks: HashMap<String, usize> = HashMap::new();
    let mut events: Vec<EdlEvent> = Vec::new();
    let mut last: Option<EdlEvent> = None;
    // El timecode cuenta cuadros al fps nominal (30 para 29.97), pero cada
    // cuadro dura 1/fps real: dividir por 30 desplazaba el proyecto 3,6 s
    // por hora en 29.97.
    let fps = fps.max(1.0);
    let nominal = fps.round().max(1.0) as u32;
    let mut header_drop_frame = false;
    let mut unsupported_drop_frame = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("TITLE:")
            || trimmed.starts_with("AUDIO:")
            || trimmed.starts_with("VIDEO:")
        {
            continue;
        }
        if let Some(value) = trimmed.strip_prefix("FCM:") {
            // `NON-DROP FRAME` contiene `DROP`; sólo cuenta si empieza con él.
            header_drop_frame = value.trim().to_ascii_uppercase().starts_with("DROP");
            continue;
        }
        if trimmed.starts_with('*') {
            if let Some(rest) = trimmed.strip_prefix("* FROM CLIP NAME:") {
                if let Some(event) = last.as_mut() {
                    event.label = Some(rest.trim().to_owned());
                }
            } else if let Some(rest) = trimmed
                .strip_prefix("* FILENAME:")
                .or_else(|| trimmed.strip_prefix("* SOURCE FILE:"))
            {
                if let Some(event) = last.as_mut() {
                    event.media = Some(rest.trim().to_owned());
                }
            }
            continue;
        }
        let tokens: Vec<&str> = trimmed.split_whitespace().collect();
        if tokens.len() < 8 || !tokens[0].chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        // Drop-frame sólo existe en 29.97/59.94; en otro fps se lee NDF y
        // se avisa una sola vez, no por cada evento.
        let uses_drop_frame = (header_drop_frame
            || tokens[4..8].iter().any(|token| token.contains(';')))
            && matches!(nominal, 30 | 60);
        if (header_drop_frame || tokens[4..8].iter().any(|token| token.contains(';')))
            && !uses_drop_frame
        {
            unsupported_drop_frame = true;
        }
        let Some(source_in) = parse_timecode(tokens[4], nominal, uses_drop_frame) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de origen inválido", tokens[0]));
            continue;
        };
        let Some(source_out) = parse_timecode(tokens[5], nominal, uses_drop_frame) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de origen inválido", tokens[0]));
            continue;
        };
        let Some(record_in) = parse_timecode(tokens[6], nominal, uses_drop_frame) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de récord inválido", tokens[0]));
            continue;
        };
        let Some(record_out) = parse_timecode(tokens[7], nominal, uses_drop_frame) else {
            parsed
                .warnings
                .push(format!("evento {}: timecode de récord inválido", tokens[0]));
            continue;
        };
        if record_out <= record_in {
            parsed
                .warnings
                .push(format!("evento {}: el récord está vacío", tokens[0]));
            continue;
        }
        if source_out <= source_in {
            parsed.warnings.push(format!(
                "evento {}: la ventana de origen está vacía",
                tokens[0]
            ));
            continue;
        }
        let transition = tokens[3].trim();
        if !matches!(transition, "C" | "c") {
            parsed.warnings.push(format!(
                "evento {}: la transición {transition} se importa como corte",
                tokens[0]
            ));
        }
        let track_token = tokens[2].trim().to_ascii_uppercase();
        let track_index = *tracks.entry(track_token.clone()).or_insert_with(|| {
            let kind = if track_token.starts_with('A') {
                TrackKind::Audio
            } else {
                TrackKind::Video
            };
            parsed.tracks.push(ParsedTrack {
                label: if track_token.is_empty() {
                    "V".to_owned()
                } else {
                    track_token.clone()
                },
                kind,
            });
            parsed.tracks.len() - 1
        });
        let event = EdlEvent {
            track_index,
            label: None,
            media: None,
            hint: Some(tokens[1].trim().to_owned()),
            source_in,
            source_out,
            record_in,
            record_out,
        };
        if let Some(previous) = last.take() {
            events.push(previous);
        }
        last = Some(event);
    }
    if unsupported_drop_frame {
        parsed.warnings.push(format!(
            "el EDL usa drop-frame a {nominal} fps; sólo aplica a 29.97/59.94, se interpreta NDF"
        ));
    }
    if let Some(previous) = last {
        events.push(previous);
    }
    for (event_number, event) in events.into_iter().enumerate() {
        let source_frames = event.source_out - event.source_in;
        let record_frames = event.record_out - event.record_in;
        if source_frames != record_frames {
            parsed.warnings.push(format!(
                "evento {}: la ventana de origen y el récord difieren; se usó la fuente",
                event_number + 1
            ));
        }
        let duration = source_frames as f64 / fps;
        if duration <= 0.0 {
            continue;
        }
        let label = event
            .label
            .clone()
            .or_else(|| event.hint.clone())
            .unwrap_or_else(|| "Evento EDL".to_owned());
        parsed.clips.push(ParsedClip {
            track_index: event.track_index,
            label,
            start_seconds: event.record_in as f64 / fps,
            source_in_seconds: event.source_in as f64 / fps,
            duration_seconds: duration,
            speed_num: 1,
            speed_den: 1,
            media: event.media,
            media_hint: event.hint,
        });
    }
    parsed
}

struct EdlEvent {
    track_index: usize,
    label: Option<String>,
    media: Option<String>,
    hint: Option<String>,
    source_in: u64,
    source_out: u64,
    record_in: u64,
    record_out: u64,
}

fn parse_timecode(value: &str, fps: u32, drop_frame: bool) -> Option<u64> {
    let cleaned = value.replace(';', ":");
    let parts: Vec<&str> = cleaned.split(':').collect();
    if parts.len() != 4 {
        return None;
    }
    let hours: u64 = parts[0].parse().ok()?;
    let minutes: u64 = parts[1].parse().ok()?;
    let seconds: u64 = parts[2].parse().ok()?;
    let frames: u64 = parts[3].parse().ok()?;
    let nominal = fps.max(1) as u64;
    if minutes >= 60 || seconds >= 60 || frames >= nominal {
        return None;
    }
    let total_minutes = hours * 60 + minutes;
    let base = (total_minutes * 60 + seconds) * nominal + frames;
    if !drop_frame {
        return Some(base);
    }
    let dropped = if nominal >= 60 { 4 } else { 2 };
    // En drop-frame no existen los frames 0..dropped al inicio de cada
    // minuto, salvo cada 10 minutos; ese timecode está fuera de norma.
    if seconds == 0 && frames < dropped && total_minutes % 10 != 0 {
        return None;
    }
    Some(base - dropped * (total_minutes - total_minutes / 10))
}
