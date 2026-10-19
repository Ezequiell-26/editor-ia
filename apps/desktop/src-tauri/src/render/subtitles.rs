//! ASS subtitle generation for the render pipeline.
//!
//! The project stores captions in integer frames; FFmpeg burns them through
//! libass. The file is generated in a temporary directory and is never a user
//! file. Text is escaped so a caption cannot inject ASS override tags.

use serde_json::Value;

fn expand_hex(value: &str) -> Option<(u8, u8, u8)> {
    let hex = value.trim().trim_start_matches('#');
    let normalized = match hex.len() {
        3 => hex
            .chars()
            .flat_map(|character| [character, character])
            .collect::<String>(),
        6 => hex.to_owned(),
        _ => return None,
    };
    let red = u8::from_str_radix(&normalized[0..2], 16).ok()?;
    let green = u8::from_str_radix(&normalized[2..4], 16).ok()?;
    let blue = u8::from_str_radix(&normalized[4..6], 16).ok()?;
    Some((red, green, blue))
}

/// ASS stores colours as `&HAABBGGRR` in BGR order.
pub fn ass_color(value: &str, fallback: &str) -> String {
    let (red, green, blue) = expand_hex(value)
        .or_else(|| expand_hex(fallback))
        .unwrap_or((255, 255, 255));
    format!("&H00{:02X}{:02X}{:02X}", blue, green, red)
}

pub fn ass_time(seconds: f64) -> String {
    let total_centis = (seconds.max(0.0) * 100.0).round() as u64;
    let centis = total_centis % 100;
    let total_seconds = total_centis / 100;
    let secs = total_seconds % 60;
    let total_minutes = total_seconds / 60;
    let mins = total_minutes % 60;
    let hours = total_minutes / 60;
    format!("{}:{:02}:{:02}.{:02}", hours, mins, secs, centis)
}

fn escape_text(text: &str) -> String {
    let mut out = String::new();
    for character in text.trim().chars().take(500) {
        match character {
            '{' | '}' => out.push(' '),
            '\\' => out.push('/'),
            '\r' => {}
            '\n' => out.push_str("\\N"),
            other => out.push(other),
        }
    }
    out
}

fn style_name(raw: &str, index: usize) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(40)
        .collect();
    if cleaned.is_empty() {
        format!("Style{}", index + 1)
    } else {
        cleaned
    }
}

fn alignment_and_margin(position: &str, height: u32) -> (u8, i32) {
    let margin = ((height as f64) * 0.075).round().max(24.0) as i32;
    match position {
        "top" => (8, margin),
        "center" => (5, 0),
        _ => (2, margin),
    }
}

pub struct CaptionInput<'a> {
    pub project: &'a Value,
    pub render_width: u32,
    pub render_height: u32,
    pub project_width: u32,
    pub project_fps: f64,
}

pub fn build_ass(input: CaptionInput<'_>) -> String {
    let captions = &input.project["captions"];
    let styles = captions["styles"].as_array().cloned().unwrap_or_default();
    let cues = captions["cues"].as_array().cloned().unwrap_or_default();
    if cues.is_empty() {
        return String::new();
    }
    let tracks = input.project["timeline"]["tracks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let hidden_tracks: Vec<String> = tracks
        .iter()
        .filter(|track| {
            track["kind"].as_str() == Some("caption") && track["hidden"].as_bool() == Some(true)
        })
        .filter_map(|track| track["id"].as_str().map(str::to_owned))
        .collect();

    let scale = if input.project_width > 0 {
        input.render_width as f64 / input.project_width as f64
    } else {
        1.0
    }
    .clamp(0.25, 4.0);

    let mut header = String::from(
        "[Script Info]\nScriptType: v4.00+\nWrapStyle: 0\nScaledBorderAndShadow: yes\n",
    );
    header.push_str(&format!(
        "PlayResX: {}\nPlayResY: {}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n",
        input.render_width, input.render_height
    ));

    let mut names: Vec<(String, String)> = Vec::new();
    for (index, style) in styles.iter().enumerate() {
        let id = style["id"].as_str().unwrap_or("").to_owned();
        let raw_name = style["name"].as_str().unwrap_or("Principal");
        let mut name = style_name(raw_name, index);
        if names.iter().any(|(_, existing)| existing == &name) {
            name = format!("{}{}", name, index + 1);
        }
        let font = style["fontFamily"].as_str().unwrap_or("Segoe UI");
        let size = (style["fontSizePx"].as_f64().unwrap_or(54.0) * scale).clamp(10.0, 400.0);
        let color = ass_color(style["color"].as_str().unwrap_or("#ffffff"), "#ffffff");
        let outline = ass_color(
            style["outlineColor"].as_str().unwrap_or("#000000"),
            "#000000",
        );
        let (alignment, margin) = alignment_and_margin(
            style["position"].as_str().unwrap_or("bottom"),
            input.render_height,
        );
        header.push_str(&format!(
            "Style: {name},{font},{size:.1},{color},&H00FFFFFF,{outline},&H80000000,0,0,0,0,100,100,0,0,1,2.4,0,{alignment},70,70,{margin},1\n"
        ));
        names.push((id, name));
    }

    if names.is_empty() {
        let (alignment, margin) = alignment_and_margin("bottom", input.render_height);
        let size = (54.0 * scale).clamp(10.0, 400.0);
        header.push_str(&format!(
            "Style: Default,Segoe UI,{size:.1},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2.4,0,{alignment},70,70,{margin},1\n"
        ));
    }

    header.push_str(
        "\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
    );

    let mut visible: Vec<&Value> = cues
        .iter()
        .filter(|cue| {
            let track_id = cue["trackId"].as_str().unwrap_or("");
            !hidden_tracks.iter().any(|hidden| hidden == track_id)
        })
        .filter(|cue| {
            let text = cue["text"].as_str().unwrap_or("").trim();
            !text.is_empty()
        })
        .collect();
    visible.sort_by_key(|cue| cue["startFrame"].as_u64().unwrap_or(0));

    for cue in visible {
        let start = cue["startFrame"].as_u64().unwrap_or(0) as f64 / input.project_fps.max(1.0);
        let end = cue["endFrame"].as_u64().unwrap_or(0) as f64 / input.project_fps.max(1.0);
        if end <= start {
            continue;
        }
        let style_id = cue["styleId"].as_str().unwrap_or("");
        let style = names
            .iter()
            .find(|(id, _)| id == style_id)
            .map(|(_, name)| name.clone())
            .or_else(|| names.first().map(|(_, name)| name.clone()))
            .unwrap_or_else(|| "Default".to_owned());
        let text = escape_text(cue["text"].as_str().unwrap_or(""));
        header.push_str(&format!(
            "Dialogue: 0,{},{},{},,0,0,0,,{}\n",
            ass_time(start),
            ass_time(end),
            style,
            text
        ));
    }

    header
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project() -> Value {
        json!({
            "timeline": { "tracks": [
                { "id": "t1", "kind": "caption", "hidden": false },
                { "id": "t2", "kind": "caption", "hidden": true }
            ]},
            "captions": {
                "styles": [{
                    "id": "s1",
                    "name": "Principal",
                    "fontFamily": "Segoe UI",
                    "fontSizePx": 54,
                    "color": "#ff0000",
                    "outlineColor": "#000000",
                    "position": "bottom"
                }],
                "cues": [
                    { "id": "c1", "trackId": "t1", "styleId": "s1", "text": "Hola {\\pos(0,0)} mundo\nsegunda", "startFrame": 0, "endFrame": 30 },
                    { "id": "c2", "trackId": "t2", "styleId": "s1", "text": "No debe verse", "startFrame": 30, "endFrame": 60 }
                ]
            }
        })
    }

    #[test]
    fn colours_convert_to_ass_bgr() {
        assert_eq!(ass_color("#ff0000", "#000000"), "&H000000FF");
        assert_eq!(ass_color("#00ff00", "#000000"), "&H0000FF00");
        assert_eq!(ass_color("nope", "#0000ff"), "&H00FF0000");
    }

    #[test]
    fn times_use_centiseconds() {
        assert_eq!(ass_time(0.0), "0:00:00.00");
        assert_eq!(ass_time(65.5), "0:01:05.50");
        assert_eq!(ass_time(3661.234), "1:01:01.23");
    }

    #[test]
    fn captions_escape_injection_and_hide_hidden_tracks() {
        let ass = build_ass(CaptionInput {
            project: &project(),
            render_width: 1920,
            render_height: 1080,
            project_width: 1920,
            project_fps: 30.0,
        });
        assert!(ass.contains("Hola  /pos(0,0)  mundo\\Nsegunda"));
        assert!(!ass.contains("No debe verse"));
        assert!(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.00,Principal"));
        assert!(ass.contains("Style: Principal,Segoe UI,54.0,&H000000FF"));
    }

    #[test]
    fn empty_captions_generate_no_filter() {
        let project =
            json!({ "timeline": { "tracks": [] }, "captions": { "styles": [], "cues": [] } });
        let ass = build_ass(CaptionInput {
            project: &project,
            render_width: 1080,
            render_height: 1920,
            project_width: 1920,
            project_fps: 30.0,
        });
        assert!(ass.is_empty());
    }

    #[test]
    fn font_size_scales_with_the_render_profile() {
        let ass = build_ass(CaptionInput {
            project: &project(),
            render_width: 960,
            render_height: 540,
            project_width: 1920,
            project_fps: 30.0,
        });
        assert!(ass.contains("Segoe UI,27.0"));
    }
}
