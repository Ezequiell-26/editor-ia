/// Detiene la grabación enviando `q` a ffmpeg (cierre ordenado: el MP4
/// queda válido) y devuelve la medición real del archivo con ffprobe.
#[tauri::command]
pub async fn screen_record_stop(
    state: State<'_, AppState>,
) -> Result<ScreenRecordResult, ProjectError> {
    // Una sesión de switching OBS no se detiene por acá: sus segmentos se
    // cierran y cosen con `obs_switch_stop` — cortar el segmento vivo por
    // esta vía dejaría la sesión inconsistente.
    if switch_session_active() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderRejected,
            "hay una sesión de switching OBS activa; detenela con obs_switch_stop",
        ));
    }
    // AUD-094: `Active → Stopping` bajo el mismo lock — el slot queda
    // ocupado mientras ffmpeg cierra (y mientras se quema el cursor).
    let taken = take_active_for_stop();
    let Some(mut rec) = taken else {
        return Ok(ScreenRecordResult {
            ok: false,
            output: None,
            bytes: None,
            duration_secs: None,
            width: None,
            height: None,
            has_audio: None,
            cursor_burned: None,
            warning: None,
            error: Some("no hay una grabación en curso".to_owned()),
        });
    };
    // A partir de acá el slot está en `Stopping`: se libera a `Idle` sólo
    // cuando esta función retorna (proceso cerrado + cursor procesado), en
    // cualquier rama — incluidos los `?` de probe/settings.
    let _stop_guard = RecordingStopGuard;
    let output = rec.output.clone();
    // El tracker se cierra antes de mover `rec` al closure: `finish` une el
    // hilo (~15 ms) y devuelve las muestras de cursor/clicks.
    let cursor_spec = rec.cursor_spec.clone();
    let cursor_samples = rec
        .cursor_tracker
        .take()
        .map(CursorTracker::finish)
        .unwrap_or_default();
    let write_result = tauri::async_runtime::spawn_blocking(move || {
        let _ = rec.stdin.write_all(b"q\n");
        let _ = rec.stdin.flush();
        let deadline = Instant::now() + STOP_TIMEOUT;
        loop {
            match rec.child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) if Instant::now() >= deadline => {
                    let _ = rec.child.kill();
                    let _ = rec.child.wait();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "ffmpeg no cerró la grabación a tiempo",
                    ));
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(200)),
                Err(error) => {
                    // AUD-099: no soltar el Child sin intentar detenerlo —
                    // kill + confirmación acotada; si ni así se puede
                    // verificar, se devuelve el error original (peor caso:
                    // ffmpeg queda corriendo, pero no se miente sobre él).
                    let _ = rec.child.kill();
                    let deadline = Instant::now() + Duration::from_secs(2);
                    while let Ok(None) = rec.child.try_wait() {
                        if Instant::now() >= deadline {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    return Err(error);
                }
            }
        }
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo esperar ffmpeg: {e}")))?;

    match write_result {
        Ok(()) => {
            let mut bytes = output.metadata().map(|m| m.len()).ok();
            let settings = state.settings_snapshot()?;
            let (ffmpeg, ffprobe, _) = resolve_tools(&settings);
            let probe = match ffprobe.as_ref() {
                Some(p) => {
                    let ffprobe_path = p.clone();
                    let probe_path = output.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        probe_output(&ffprobe_path, &probe_path)
                    })
                    .await
                    .unwrap_or_default()
                }
                None => ProbeOutput::default(),
            };
            let (duration_secs, width, height, has_audio) =
                (probe.duration, probe.width, probe.height, probe.has_audio);

            // Cursor estilizado: segundo pase ffmpeg que quema el .ass
            // generado desde las muestras. Si falla, el MP4 original queda
            // intacto y se avisa en `warning` (nunca se reporta como fallida
            // la grabación en sí).
            let mut cursor_burned = None;
            let mut warning = None;
            if let (Some(spec), Some(ffmpeg)) = (cursor_spec.as_ref(), ffmpeg.as_ref()) {
                if bytes.unwrap_or(0) > 0 {
                    let ffmpeg = ffmpeg.clone();
                    let output_path = output.clone();
                    let samples = cursor_samples.clone();
                    let spec = spec.clone();
                    let burned = tauri::async_runtime::spawn_blocking(move || {
                        burn_cursor_overlay(
                            &ffmpeg,
                            &output_path,
                            &samples,
                            &spec,
                            duration_secs,
                            width,
                            height,
                        )
                    })
                    .await
                    .map_err(|error| {
                        format!("no se pudo quemar el cursor: {error}")
                    });
                    match burned {
                        Ok(Ok(true)) => {
                            cursor_burned = Some(true);
                            bytes = output.metadata().map(|m| m.len()).ok();
                        }
                        Ok(Ok(false)) => cursor_burned = Some(false),
                        Ok(Err(e)) => {
                            cursor_burned = Some(false);
                            warning = Some(format!(
                                "la grabación está bien pero el cursor no se pudo quemar: {e}"
                            ));
                        }
                        Err(e) => {
                            cursor_burned = Some(false);
                            warning = Some(format!(
                                "la grabación está bien pero el cursor no se pudo quemar: {e}"
                            ));
                        }
                    }
                }
            }

            Ok(ScreenRecordResult {
                ok: bytes.unwrap_or(0) > 0,
                output: Some(output.to_string_lossy().into_owned()),
                bytes,
                duration_secs,
                width,
                height,
                has_audio,
                cursor_burned,
                warning,
                error: if bytes.unwrap_or(0) == 0 {
                    Some("el archivo quedó vacío".to_owned())
                } else {
                    None
                },
            })
        }
        Err(error) => Ok(ScreenRecordResult {
            ok: false,
            output: Some(output.to_string_lossy().into_owned()),
            bytes: None,
            duration_secs: None,
            width: None,
            height: None,
            has_audio: None,
            cursor_burned: None,
            warning: None,
            error: Some(error.to_string()),
        }),
    }
}

/// Genera el .ass del cursor y lo quema con ffmpeg (`ass=` filter) sobre el
/// MP4 ya cerrado, re-codificando vídeo a x264 crf 18 y copiando el audio.
/// Devuelve Ok(true) si el archivo final tiene el cursor, Ok(false) si no
/// había nada que dibujar, Err si el pase falló (el original queda intacto).
fn burn_cursor_overlay(
    ffmpeg: &std::path::Path,
    output: &std::path::Path,
    samples: &[CursorSample],
    spec: &CursorOverlaySpec,
    duration_secs: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<bool, String> {
    let (Some(vw), Some(vh)) = (width, height) else {
        return Err("no se conocen las dimensiones del vídeo".to_owned());
    };
    if samples.is_empty() {
        return Ok(false);
    }
    let total_ms = duration_secs
        .map(|d| (d * 1000.0) as u64)
        .unwrap_or_else(|| samples.last().map(|s| s.t_ms + 1_000).unwrap_or(0));
    let ass = generate_cursor_ass(samples, spec, vw, vh, sys::virtual_screen(), total_ms);
    if ass.is_empty() {
        return Ok(false);
    }

    let stem = output
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "screen".to_owned());
    let ass_path = output.with_file_name(format!("{stem}-cursor.ass"));
    let tmp_path = output.with_file_name(format!("{stem}-cursor-tmp.mp4"));
    std::fs::write(&ass_path, ass)
        .map_err(|e| format!("no se pudo escribir el .ass del cursor: {e}"))?;

    let filter = ass_filter_arg(&ass_path);
    // Mismo sondeo que la captura: el bundle LGPL no trae libx264.
    let video_args = h264_software_video_args(ffmpeg, 18)?;
    let mut command = Command::new(ffmpeg);
    command
        .args(["-hide_banner", "-loglevel", "warning", "-y", "-i"])
        .arg(output)
        .args(["-vf", filter.as_str()]);
    for arg in &video_args {
        command.arg(arg);
    }
    command
        .args(["-c:a", "copy", "-movflags", "+faststart"])
        .arg(&tmp_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let result = command.output();
    match result {
        Ok(out) if out.status.success() && tmp_path.exists() => {
            // AUD-095: el original nunca se borra antes de que el reemplazo
            // exista — se aparta con rename y sólo se elimina cuando el tmp
            // ya ocupa su lugar; si el segundo rename falla se restaura
            // (mismo patrón transaccional que la extensión del navegador).
            // Antes era remove_file + rename: un fallo del rename dejaba la
            // grabación sin archivo.
            let backup = output.with_file_name(format!("{stem}-cursor-backup.mp4"));
            if let Err(e) = std::fs::rename(output, &backup) {
                let _ = std::fs::remove_file(&tmp_path);
                return Err(format!("no se pudo apartar el vídeo original: {e}"));
            }
            match std::fs::rename(&tmp_path, output) {
                Ok(()) => {
                    let _ = std::fs::remove_file(&backup);
                    Ok(true)
                }
                Err(e) => {
                    let _ = std::fs::rename(&backup, output);
                    let _ = std::fs::remove_file(&tmp_path);
                    Err(format!("no se pudo reemplazar el vídeo con el cursor: {e}"))
                }
            }
        }
        Ok(out) => {
            let _ = std::fs::remove_file(&tmp_path);
            let tail = String::from_utf8_lossy(&out.stderr)
                .chars()
                .rev()
                .take(300)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            Err(format!("ffmpeg no pudo quemar el cursor ({})", tail.trim()))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(format!("no se pudo ejecutar ffmpeg: {e}"))
        }
    }
}
