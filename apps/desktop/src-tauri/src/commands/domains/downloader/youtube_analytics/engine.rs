fn run_engine(engine: &Path, args: &[String], target: &str) -> Result<Vec<u8>, String> {
    let mut command = Command::new(engine);
    command.args(args).arg(target);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("no se pudo ejecutar yt-dlp: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let last = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("yt-dlp falló sin detalle");
        return Err(last.chars().take(300).collect());
    }
    Ok(output.stdout)
}

fn base_args() -> Vec<String> {
    vec![
        "--no-warnings".into(),
        "--ignore-config".into(),
        "--socket-timeout".into(),
        "30".into(),
        "--retries".into(),
        "2".into(),
    ]
}
