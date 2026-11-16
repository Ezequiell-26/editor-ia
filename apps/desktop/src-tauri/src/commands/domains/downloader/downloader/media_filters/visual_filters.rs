// Los builders puros de filtergraphs (look cine, pipeline, delogo, upscale,
// audio) viven en `media::download_filters`. Este archivo conserva el sondeo
// ffprobe de color y el alias ProgressSink.
pub(crate) use crate::media::download_filters::*;

fn probe_color(ffprobe: Option<&Path>, path: &Path) -> ColorProbe {
    let Some(ffprobe) = ffprobe else {
        return ColorProbe::default();
    };
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=pix_fmt,color_transfer,color_primaries,color_space",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null());
    crate::commands::hide_console(&mut command);
    let Ok(output) = command.output() else {
        return ColorProbe::default();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return ColorProbe::default();
    };
    let Some(stream) = value["streams"]
        .as_array()
        .and_then(|streams| streams.first())
    else {
        return ColorProbe::default();
    };
    let transfer = match stream["color_transfer"].as_str().unwrap_or("") {
        "smpte2084" => Some(HdrTransfer::Pq),
        "arib-std-b67" => Some(HdrTransfer::Hlg),
        _ => None,
    };
    let pix_fmt = stream["pix_fmt"].as_str().unwrap_or("");
    ColorProbe {
        transfer,
        ten_bit: pix_fmt.contains("10") || pix_fmt.contains("12"),
    }
}

pub(crate) type ProgressSink<'a> = &'a dyn Fn(&str, Option<f64>, &str);
