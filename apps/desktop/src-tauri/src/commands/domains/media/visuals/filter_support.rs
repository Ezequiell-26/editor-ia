fn required_filters() -> Vec<(&'static str, &'static str)> {
    vec![
        ("eq", "Ajustes de color"),
        ("curves", "Curvas"),
        ("colorbalance", "Balance de color"),
        ("hue", "Tono y saturación"),
        ("vignette", "Viñeta"),
        ("gblur", "Desenfoque gaussiano"),
        ("unsharp", "Nitidez"),
        ("lut3d", "LUT 3D"),
        ("colorkey", "Chroma key"),
        ("geq", "Máscaras"),
        ("blend", "Mezcla"),
    ]
}

pub(crate) fn parse_filters(output: &str) -> BTreeSet<String> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            let name = parts.next()?;
            if !flags.starts_with('.') {
                // Línea de cabecera: "Filters:" o " .. = ...".
                if !flags.contains('.') {
                    return None;
                }
            }
            if name.starts_with('.') || name == "=" || name.eq_ignore_ascii_case("name") {
                return None;
            }
            Some(name.to_owned())
        })
        .collect()
}

fn available_filters(ffmpeg: Option<&Path>) -> BTreeSet<String> {
    let Some(ffmpeg) = ffmpeg else {
        return BTreeSet::new();
    };
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-filters"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    hide_console(&mut command);
    let Ok(output) = command.output() else {
        return BTreeSet::new();
    };
    parse_filters(&String::from_utf8_lossy(&output.stdout))
}
