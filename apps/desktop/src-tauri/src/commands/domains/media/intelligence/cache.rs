struct PassOutput {
    stderr: String,
    success: bool,
}

/// Una pasada de medición sobre el medio completo con deadline: si FFmpeg se
/// cuelga a mitad del stream, el `kill` del timeout libera el hilo en vez de
/// dejar el comando de análisis esperando para siempre.
fn run_pass(
    ffmpeg: &Path,
    path: &Path,
    args: &[&str],
    timeout: std::time::Duration,
) -> Result<PassOutput, ProjectError> {
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::commands::hide_console(&mut command);
    let timed = crate::commands::output_with_timeout(&mut command, timeout).map_err(|_| {
        ProjectError::message(
            ProjectErrorCode::Io,
            "no se pudo iniciar FFmpeg para analizar el material",
        )
    })?;
    if timed.timed_out {
        return Err(ProjectError::message(
            ProjectErrorCode::Io,
            "FFmpeg no terminó a tiempo al analizar el material; el proceso fue interrumpido",
        ));
    }
    let output = timed.into_output().ok_or_else(|| {
        ProjectError::message(ProjectErrorCode::Io, "FFmpeg no devolvió la medición")
    })?;
    Ok(PassOutput {
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        success: output.status.success(),
    })
}

fn disk_cache_path(cache_dir: &Path, key: &str) -> PathBuf {
    let digest = format!("{:x}", Sha256::digest(key.as_bytes()));
    cache_dir.join("analysis").join(format!("{digest}.json"))
}

fn load_disk_cache(cache_dir: &Path, key: &str) -> Option<MediaAnalysis> {
    let path = disk_cache_path(cache_dir, key);
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_disk_cache(cache_dir: &Path, key: &str, analysis: &MediaAnalysis) {
    let path = disk_cache_path(cache_dir, key);
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(bytes) = serde_json::to_vec(analysis) else {
        return;
    };
    // Escritura atómica para que un cierre a mitad de guardado no deje JSON roto.
    let temp = path.with_extension("json.tmp");
    if std::fs::write(&temp, bytes).is_ok() {
        let _ = std::fs::rename(temp, path);
    }
}

fn analyze_luma(ffmpeg: &Path, path: &Path, duration: f64) -> (Option<f64>, Option<f64>) {
    let mut luma = 0.0;
    let mut luma_count = 0.0;
    let mut saturation = 0.0;
    let mut sat_count = 0.0;
    for fraction in [0.2_f64, 0.5, 0.8] {
        let seconds = (duration * fraction).max(0.0);
        let seek = format!("{seconds:.3}");
        let filter = "scale=96:-2,signalstats,metadata=print:file=-";
        let mut command = Command::new(ffmpeg);
        command
            .args(["-hide_banner", "-nostats", "-ss", &seek, "-i"])
            .arg(path)
            .args(["-frames:v", "1", "-vf", filter, "-an", "-f", "null", "-"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        crate::commands::hide_console(&mut command);
        // Un frame suelto debe ser instantáneo; el deadline sólo cubre un
        // seek sobre disco colgado. Timeout o fallo → se salta la muestra.
        let Ok(timed) = crate::commands::output_with_timeout(
            &mut command,
            crate::commands::MEDIA_PROBE_TIMEOUT,
        ) else {
            continue;
        };
        if timed.timed_out {
            continue;
        }
        let Some(output) = timed.into_output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let (found_luma, found_sat) = parse_signalstats(&text);
        if let Some(value) = found_luma {
            luma += value;
            luma_count += 1.0;
        }
        if let Some(value) = found_sat {
            saturation += value;
            sat_count += 1.0;
        }
    }
    (
        (luma_count > 0.0).then_some(luma / luma_count),
        (sat_count > 0.0).then_some(saturation / sat_count),
    )
}
