/// Detiene la grabación enviando `q` a ffmpeg (cierre ordenado: el MP4
/// queda válido) y devuelve la medición real del archivo con ffprobe.
#[tauri::command]
pub async fn screen_record_stop(
    state: State<'_, AppState>,
) -> Result<ScreenRecordResult, ProjectError> {
    let taken = {
        let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
        guard.take()
    };
    let Some(mut rec) = taken else {
        return Ok(ScreenRecordResult {
            ok: false,
            output: None,
            bytes: None,
            duration_secs: None,
            width: None,
            height: None,
            has_audio: None,
            error: Some("no hay una grabación en curso".to_owned()),
        });
    };
    let output = rec.output.clone();
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
                Err(error) => return Err(error),
            }
        }
    })
    .await
    .map_err(|e| io_error(&format!("no se pudo esperar ffmpeg: {e}")))?;

    match write_result {
        Ok(()) => {
            let bytes = output.metadata().map(|m| m.len()).ok();
            let settings = state.settings_snapshot()?;
            let (_, ffprobe, _) = resolve_tools(&settings);
            let (duration_secs, width, height, has_audio) = ffprobe
                .as_ref()
                .map(|p| probe_output(p, &output))
                .unwrap_or((None, None, None, None));
            Ok(ScreenRecordResult {
                ok: bytes.unwrap_or(0) > 0,
                output: Some(output.to_string_lossy().into_owned()),
                bytes,
                duration_secs,
                width,
                height,
                has_audio,
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
            error: Some(error.to_string()),
        }),
    }
}
