// `media_extension`, `downloaded_kind` y `parse_progress_percent` viven en
// `application::downloads` (pub use de control.rs).

fn read_download_output(
    progress: ProgressSink<'_>,
    child: &mut std::process::Child,
) -> (bool, String) {
    let control = current_control();
    if let Some(control) = control.as_ref() {
        control.child_started(child.id());
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_handle = stderr.map(|stderr| {
        thread::spawn(move || {
            BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
                .collect::<Vec<String>>()
                .join("\n")
        })
    });
    let mut last_percent: i32 = -1;
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(percent) = parse_progress_percent(&line) {
                let rounded = percent.floor() as i32;
                if rounded != last_percent {
                    last_percent = rounded;
                    progress("downloading", Some(percent), line.trim());
                }
            } else if !line.trim().is_empty() {
                progress("downloading", None, line.trim());
            }
        }
    }
    let status = child.wait();
    if let Some(control) = control.as_ref() {
        control.child_finished();
    }
    let stderr = stderr_handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    (status.map(|value| value.success()).unwrap_or(false), stderr)
}

fn dimensions(ffprobe: Option<&Path>, path: &Path) -> Option<(u32, u32)> {
    let ffprobe = ffprobe?;
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
        ])
        .arg(path)
        .stdin(Stdio::null());
    crate::commands::hide_console(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value: Value = serde_json::from_slice(&output.stdout).ok()?;
    let stream = value["streams"].as_array()?.first()?;
    Some((
        stream["width"].as_u64()? as u32,
        stream["height"].as_u64()? as u32,
    ))
}
