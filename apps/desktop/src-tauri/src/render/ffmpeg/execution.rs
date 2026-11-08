use super::*;

pub fn spawn(ffmpeg: &Path, plan: &RenderPlan) -> Result<Child, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .args(&plan.args)
        .current_dir(&plan.working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Sin consola y en prioridad baja: el render cede CPU a la UI, al
        // preview y a la IA mientras la persona sigue trabajando.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        command.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    command.spawn().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo iniciar ffmpeg; revisá la ruta en Ajustes → Herramientas",
        )
    })
}

pub(crate) fn parse_progress_time(line: &str) -> Option<f64> {
    let (key, value) = line.split_once('=')?;
    match key.trim() {
        "out_time_us" | "out_time_ms" => value
            .trim()
            .parse::<f64>()
            .ok()
            .map(|micros| micros / 1_000_000.0),
        "out_time" => {
            let parts: Vec<&str> = value.trim().split(':').collect();
            if parts.len() != 3 {
                return None;
            }
            let hours: f64 = parts[0].parse().ok()?;
            let minutes: f64 = parts[1].parse().ok()?;
            let secs: f64 = parts[2].parse().ok()?;
            Some(hours * 3600.0 + minutes * 60.0 + secs)
        }
        _ => None,
    }
}

pub fn progress_from_line(line: &str, total_seconds: f64) -> Option<RenderProgress> {
    let processed = parse_progress_time(line)?;
    let total = total_seconds.max(0.001);
    Some(RenderProgress {
        percent: ((processed / total) * 100.0).clamp(0.0, 99.9),
        processed_seconds: processed.max(0.0),
        total_seconds,
    })
}

pub(crate) fn probe_output(
    ffprobe: &Path,
    output: &Path,
    plan: &RenderPlan,
) -> Result<(f64, u32, u32), ProjectError> {
    let mut command = Command::new(ffprobe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,width,height,duration:format=duration",
            "-of",
            "json",
        ])
        .arg(output)
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let payload = command.output().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "no se pudo verificar el archivo exportado con ffprobe",
        )
    })?;
    if !payload.status.success() {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffprobe no pudo leer el archivo exportado",
        ));
    }
    let value: Value = serde_json::from_slice(&payload.stdout).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la verificación del archivo exportado no se pudo interpretar",
        )
    })?;
    verify_probe_payload(&value, plan)
}

/// Valida el JSON de `ffprobe` contra el plan. El contenedor puede declarar la
/// duración correcta aunque una de sus pistas se haya cortado antes: por eso
/// se exige que existan video y audio, y que la duración declarada de cada
/// pista coincida con la timeline dentro de la tolerancia del perfil.
pub(crate) fn verify_probe_payload(
    value: &Value,
    plan: &RenderPlan,
) -> Result<(f64, u32, u32), ProjectError> {
    let duration = value["format"]["duration"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .ok_or_else(|| {
            ProjectError::message(
                ProjectErrorCode::RenderFailed,
                "el archivo exportado no declara duración",
            )
        })?;
    if (duration - plan.duration_seconds).abs() > plan.duration_tolerance_seconds {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la duración del archivo exportado no coincide con la timeline",
        ));
    }
    let streams = value["streams"].as_array();
    let stream_of = |kind: &str| {
        streams.and_then(|items| {
            items
                .iter()
                .find(|stream| stream["codec_type"].as_str() == Some(kind))
        })
    };
    let video = stream_of("video").ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo exportado no tiene pista de video",
        )
    })?;
    let width = video["width"].as_u64().unwrap_or(0) as u32;
    let height = video["height"].as_u64().unwrap_or(0) as u32;
    if width != plan.width || height != plan.height {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "la resolución del archivo exportado no coincide con el perfil",
        ));
    }
    let audio = stream_of("audio").ok_or_else(|| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo exportado no tiene pista de audio; revisá la mezcla antes de publicarlo",
        )
    })?;
    for (stream, label) in [(video, "video"), (audio, "audio")] {
        let stream_duration = stream["duration"]
            .as_str()
            .and_then(|text| text.parse::<f64>().ok());
        if let Some(stream_duration) = stream_duration {
            if (stream_duration - plan.duration_seconds).abs() > plan.duration_tolerance_seconds {
                return Err(ProjectError::message(
                    ProjectErrorCode::RenderFailed,
                    &format!("la pista de {label} termina antes que la timeline"),
                ));
            }
        }
    }
    Ok((duration, width, height))
}

/// El mínimo del perfil es un guardia contra archivos vacíos, pensado para
/// contenido lleno. Un clip corto con máscara poligonal puede ser válido y
/// pesar mucho menos que ese mínimo porque la mayor parte del cuadro es fondo;
/// el umbral se escala con la duración (10 KB por segundo) sin superar el valor
/// configurado. Un clip de 5 s exige 50 KB en vez de 500 KB; uno de 60 s
/// conserva el umbral completo.
pub(crate) fn effective_min_output_bytes(configured: u64, duration_seconds: f64) -> u64 {
    let scaled = (duration_seconds.max(1.0) * 10_000.0).round() as u64;
    configured.min(scaled)
}

pub fn verify_output(
    ffprobe: &Path,
    plan: &RenderPlan,
) -> Result<RenderVerification, ProjectError> {
    let metadata = std::fs::metadata(&plan.output_path).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg terminó pero el archivo exportado no existe",
        )
    })?;
    let minimum = effective_min_output_bytes(plan.min_output_bytes, plan.duration_seconds);
    if metadata.len() < minimum {
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "el archivo exportado es más chico que el mínimo del perfil",
        ));
    }
    let (duration, width, height) = probe_output(ffprobe, &plan.output_path, plan)?;
    Ok(RenderVerification {
        output_bytes: metadata.len(),
        duration_seconds: duration,
        width,
        height,
    })
}

/// Synchronous execution used by tests and by the single non-cancellable path.
pub fn execute_sync(
    ffmpeg: &Path,
    ffprobe: &Path,
    plan: &RenderPlan,
    mut on_progress: impl FnMut(RenderProgress),
) -> Result<RenderVerification, ProjectError> {
    let mut child = spawn(ffmpeg, plan)?;
    let stderr_reader = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            use std::io::Read;
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        })
    });
    if let Some(stdout) = child.stdout.take() {
        let reader = std::io::BufReader::new(stdout);
        use std::io::BufRead;
        for line in reader.lines().map_while(Result::ok) {
            if let Some(progress) = progress_from_line(&line, plan.duration_seconds) {
                on_progress(progress);
            }
        }
    }
    let status = child.wait().map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::RenderFailed,
            "ffmpeg no terminó correctamente",
        )
    })?;
    let stderr_text = stderr_reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default();
    if !status.success() {
        let tail = sanitize_log(&stderr_text, &plan.working_dir, 500);
        return Err(ProjectError::message(
            ProjectErrorCode::RenderFailed,
            &format!("ffmpeg devolvió un error durante el render: {tail}"),
        ));
    }
    verify_output(ffprobe, plan)
}

pub fn sanitize_log(text: &str, root: &Path, limit: usize) -> String {
    let root_text = root.to_string_lossy();
    let mut sanitized = text.replace(root_text.as_ref(), "<proyecto>");
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let home = home.to_string_lossy();
        sanitized = sanitized.replace(home.as_ref(), "<usuario>");
    }
    let lines: Vec<&str> = sanitized
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let tail = lines
        .iter()
        .rev()
        .take(8)
        .rev()
        .copied()
        .collect::<Vec<_>>()
        .join(" | ");
    tail.chars().take(limit).collect()
}
