fn run_ffmpeg_with_progress(
    progress: ProgressSink<'_>,
    message: &str,
    command: &mut Command,
    duration: Option<f64>,
) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(command);
    let mut child = command
        .spawn()
        .map_err(|_| "No se pudo ejecutar FFmpeg para el post-proceso.".to_owned())?;
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
    let mut speed: Option<String> = None;
    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(raw) = line.strip_prefix("speed=") {
                let value = raw.trim();
                if !value.is_empty() && value != "N/A" {
                    speed = Some(value.to_owned());
                }
                continue;
            }
            let Some(raw) = line.strip_prefix("out_time_us=") else {
                continue;
            };
            let Ok(microseconds) = raw.trim().parse::<f64>() else {
                continue;
            };
            if microseconds < 0.0 {
                continue;
            }
            let percent = duration
                .filter(|duration| *duration > 0.0)
                .map(|duration| (microseconds / 1_000_000.0 / duration * 100.0).clamp(0.0, 99.0));
            if let Some(percent) = percent {
                let rounded = percent.floor() as i32;
                if rounded != last_percent {
                    last_percent = rounded;
                    let detail = speed
                        .as_ref()
                        .map(|speed| format!("{message} · {speed}"))
                        .unwrap_or_else(|| message.to_owned());
                    progress("compressing", Some(percent), &detail);
                }
            }
        }
    }
    let status = child
        .wait()
        .map_err(|_| "No se pudo esperar a FFmpeg.".to_owned())?;
    if let Some(control) = control.as_ref() {
        control.child_finished();
    }
    let stderr = stderr_handle
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    if !status.success() {
        return Err(error_tail(
            &stderr,
            "FFmpeg no pudo aplicar el post-proceso.",
        ));
    }
    Ok(())
}
