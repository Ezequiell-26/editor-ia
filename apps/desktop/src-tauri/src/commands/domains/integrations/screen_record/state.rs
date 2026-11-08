fn status_inner() -> ScreenRecordStatus {
    let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
    let last = guard.as_mut().map(|rec| {
        let alive = matches!(rec.child.try_wait(), Ok(None));
        (
            alive,
            rec.output.to_string_lossy().into_owned(),
            rec.started.elapsed().as_secs(),
            rec.webcam.clone(),
            rec.streaming,
        )
    });
    let Some((alive, output, elapsed, webcam, streaming)) = last else {
        return ScreenRecordStatus {
            recording: false,
            output: None,
            elapsed_secs: None,
            bytes: None,
            webcam: None,
            streaming: None,
        };
    };
    if !alive {
        *guard = None;
    }
    // Stats en vivo estilo OBS: tamaño real del archivo creciendo.
    let bytes = if alive {
        std::fs::metadata(&output).map(|m| m.len()).ok()
    } else {
        None
    };
    ScreenRecordStatus {
        recording: alive,
        output: Some(output),
        elapsed_secs: alive.then_some(elapsed),
        bytes,
        webcam,
        streaming: alive.then_some(streaming),
    }
}

/// Estado de la grabación en curso.
#[tauri::command]
pub fn screen_record_status() -> ScreenRecordStatus {
    status_inner()
}
