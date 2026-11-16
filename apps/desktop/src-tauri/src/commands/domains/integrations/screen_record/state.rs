fn status_inner() -> ScreenRecordStatus {
    let mut guard = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
    // Reserva sin proceso todavía (AUD-094): reportar "grabando" evita que
    // la UI ofrezca un segundo start mientras ffmpeg arranca.
    if matches!(*guard, RecordState::Starting | RecordState::Stopping) {
        return ScreenRecordStatus {
            recording: true,
            output: None,
            elapsed_secs: None,
            bytes: None,
            webcam: None,
            streaming: None,
            error: None,
        };
    }
    let RecordState::Active(rec) = &mut *guard else {
        return ScreenRecordStatus {
            recording: false,
            output: None,
            elapsed_secs: None,
            bytes: None,
            webcam: None,
            streaming: None,
            error: None,
        };
    };
    let mut dead_error: Option<String> = None;
    let mut verify_error = false;
    // AUD-099: distinguir Ok(Some)/Ok(None)/Err — un error de try_wait no
    // significa proceso muerto. Se intenta kill y se confirma acotado; si
    // no se puede confirmar la muerte, el estado se conserva (un start
    // nuevo no puede colarse) y se avisa en `error`.
    let alive = match rec.child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) => false,
        Err(_) => {
            verify_error = true;
            let _ = rec.child.kill();
            let deadline = Instant::now() + Duration::from_millis(750);
            loop {
                match rec.child.try_wait() {
                    Ok(Some(_)) => break false,
                    Ok(None) => {
                        if Instant::now() >= deadline {
                            break true;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break true,
                }
            }
        }
    };
    if !alive {
        // ffmpeg murió solo: la cola de stderr explica por qué en vez
        // de un «no hay grabación» sin contexto.
        let tail = rec
            .stderr_tail
            .lock()
            .map(|bytes| String::from_utf8_lossy(&bytes).trim().to_owned())
            .unwrap_or_default();
        // AUD-098: segunda línea de defensa — el drain ya redacta al
        // escribir, pero si un fragmento de la URL cruzó el borde del
        // buffer se redacta también acá antes de devolver el error por IPC.
        let tail = redact_stream_secrets(&tail, rec.stream_url.as_deref());
        let tail: String = tail
            .chars()
            .rev()
            .take(400)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        if !tail.is_empty() {
            dead_error = Some(format!("ffmpeg terminó la grabación: {tail}"));
        }
    }
    let output = rec.output.to_string_lossy().into_owned();
    let elapsed = rec.started.elapsed().as_secs();
    let webcam = rec.webcam.clone();
    let streaming = rec.streaming;
    if !alive {
        *guard = RecordState::Idle;
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
        error: dead_error.or_else(|| {
            verify_error.then(|| {
                "no se pudo verificar el estado de ffmpeg; se intentó detenerlo".to_owned()
            })
        }),
    }
}

/// Estado de la grabación en curso.
#[tauri::command]
pub fn screen_record_status() -> ScreenRecordStatus {
    status_inner()
}
