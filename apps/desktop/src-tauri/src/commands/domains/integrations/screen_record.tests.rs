use super::*;

/// `RECORDING` es global del proceso: los tests que lo tocan se serializan
/// con este lock para no pisarse entre sí ni con `status_inicial_no_graba`.
static RECORDING_TEST_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn status_inicial_no_graba() {
    let _guard = RECORDING_TEST_LOCK.lock().unwrap();
    let status = status_inner();
    assert!(!status.recording);
    assert!(status.output.is_none());
}

#[test]
fn device_rechaza_comillas_y_vacios() {
    assert!(sanitize_device("").is_err());
    assert!(sanitize_device("  ").is_err());
    assert!(sanitize_device("cam\"evil").is_err());
    // ':' ',' ';' permitirían inyectar opciones dentro del arg -i de
    // ffmpeg (dshow separa video=/audio= con ':').
    assert!(sanitize_device("cam:audio=Mic").is_err());
    assert!(sanitize_device("cam,evil").is_err());
    assert!(sanitize_device("cam;evil").is_err());
    assert!(sanitize_device("Integrated Camera").is_ok());
}

#[test]
fn stamp_tiene_formato_esperado() {
    let stamp = chrono_lite_stamp();
    assert_eq!(stamp.len(), 15);
    assert!(stamp.contains('-'));
}

#[test]
fn gdigrab_args_desktop_usa_input_simple() {
    let args = gdigrab_input_args("desktop", None, None, None, None, None, 30, true);
    assert!(args.windows(2).any(|w| w == ["-i", "desktop"]));
    assert!(args.windows(2).any(|w| w == ["-framerate", "30"]));
    assert!(!args.iter().any(|a| a.starts_with("title=")));
}

#[test]
fn gdigrab_args_window_y_region_llevan_sus_parametros() {
    let win = gdigrab_input_args("window", Some("Editor"), None, None, None, None, 60, true);
    assert!(win.iter().any(|a| a == "title=Editor"));

    let reg = gdigrab_input_args(
        "region",
        None,
        Some(10),
        Some(20),
        Some(640),
        Some(360),
        30,
        true,
    );
    assert!(reg.windows(2).any(|w| w == ["-video_size", "640x360"]));
    assert!(reg.windows(2).any(|w| w == ["-offset_x", "10"]));
    assert!(reg.windows(2).any(|w| w == ["-offset_y", "20"]));
}

#[test]
fn dshow_args_escapan_el_dispositivo() {
    let args = dshow_video_args("Integrated Camera");
    assert!(args.iter().any(|a| a == "video=Integrated Camera"));
}

#[test]
fn civil_from_days_conoce_epoch() {
    // 1970-01-01
    assert_eq!(civil_from_days(0), (1970, 1, 1));
    // 2026-11-06 aprox (verificar contra date real no hace falta: sanity)
    let (y, m, _) = civil_from_days(20_735);
    assert!(y >= 2026 && (1..=12).contains(&m));
}

#[test]
fn webcam_chroma_valida_y_emite_cadena_ffmpeg() {
    let spec = WebcamChromaSpec {
        color: "#00ff00".into(),
        similarity: 0.3,
        blend: 0.1,
    };
    spec.validate().unwrap();
    assert_eq!(
        spec.ffmpeg_chain(),
        "chromakey=color=0x00ff00:similarity=0.3000:blend=0.1000,format=yuva420p"
    );

    for bad in ["#fff", "green", "#gggggg", ""] {
        let mut s = spec.clone();
        s.color = bad.into();
        assert!(s.validate().is_err(), "color {bad} debería fallar");
    }
    let mut s = spec.clone();
    s.similarity = 0.0;
    assert!(s.validate().is_err());
    let mut s = spec.clone();
    s.blend = 1.5;
    assert!(s.validate().is_err());
}

#[test]
fn unique_screen_output_avoids_second_collisions() {
    let dir = std::env::temp_dir().join(format!("editor-ia-rec-name-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let stamp = "20261113-120000";
    assert_eq!(
        unique_screen_output(&dir, stamp),
        dir.join(format!("screen-{stamp}.mp4"))
    );
    // Colisión en el mismo segundo: sufijo incremental, nunca pisa.
    std::fs::write(dir.join(format!("screen-{stamp}.mp4")), b"x").unwrap();
    std::fs::write(dir.join(format!("screen-{stamp}-2.mp4")), b"x").unwrap();
    assert_eq!(
        unique_screen_output(&dir, stamp),
        dir.join(format!("screen-{stamp}-3.mp4"))
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stop_transition_keeps_slot_busy_until_process_ends() {
    let _guard = RECORDING_TEST_LOCK.lock().unwrap();
    // Grabación real mínima: un `ping` de 30 s hace de ffmpeg dormido.
    let mut child = Command::new("cmd")
        .args(["/c", "ping", "-n", "30", "127.0.0.1"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("cmd/ping disponible en Windows");
    let stdin = child.stdin.take().expect("stdin piped");
    let rec = Recording {
        child,
        stdin,
        output: PathBuf::from("screen-test.mp4"),
        started: Instant::now(),
        webcam: None,
        streaming: false,
        cursor_tracker: None,
        cursor_spec: None,
        stderr_tail: Arc::new(Mutex::new(Vec::new())),
        stream_url: None,
    };
    *RECORDING.lock().unwrap() = RecordState::Active(rec);

    // Active → Stopping: el slot sigue ocupado mientras el proceso cierra.
    let taken = take_active_for_stop().expect("había una grabación activa");
    assert!(matches!(*RECORDING.lock().unwrap(), RecordState::Stopping));
    // Un segundo stop ve Stopping (no Active) y no saca nada.
    assert!(take_active_for_stop().is_none());
    assert!(matches!(*RECORDING.lock().unwrap(), RecordState::Stopping));
    // Y status reporta "grabando" — la UI no ofrece un start paralelo.
    assert!(status_inner().recording);

    // Fin del stop: el guard devuelve el slot a Idle y el proceso se mata.
    let _stop_guard = RecordingStopGuard;
    let mut taken = taken;
    let _ = taken.child.kill();
    let _ = taken.child.wait();
    drop(_stop_guard);
    assert!(matches!(*RECORDING.lock().unwrap(), RecordState::Idle));
    assert!(!status_inner().recording);
}

#[test]
fn stream_secrets_are_redacted_from_stderr_text() {
    let url = "rtmp://a.rtmp.youtube.com/live2/ClaveSecreta-1234567890";
    let err = format!("Connection to {url} refused by peer; retrying");
    let out = redact_stream_secrets(&err, Some(url));
    assert!(!out.contains(url));
    assert!(!out.contains("ClaveSecreta-1234567890"));
    assert!(out.contains(STREAM_URL_REDACTED));
    // La clave suelta también se redacta (fragmento sin la URL completa).
    let frag = "peer said: ClaveSecreta-1234567890 timeout";
    assert!(!redact_stream_secrets(frag, Some(url)).contains("ClaveSecreta"));
    // Sin streaming no se toca nada.
    assert_eq!(redact_stream_secrets("error común", None), "error común");
}

#[test]
fn stream_secrets_bytes_cover_chunk_boundaries() {
    let url = "rtmp://h/app/ClaveLarga-00001111";
    let secrets = stream_secret_bytes(Some(url));
    // URL completa + clave suelta.
    assert_eq!(secrets.len(), 2);
    // Simula el drain: la URL partida en dos chunks queda redactada igual
    // porque la búsqueda corre sobre el buffer acumulado completo.
    let mut stored = Vec::new();
    let (a, b) = url.as_bytes().split_at(url.len() / 2);
    stored.extend_from_slice(b"err: abre ");
    stored.extend_from_slice(a);
    for s in &secrets {
        redact_secret_bytes(&mut stored, s, STREAM_URL_REDACTED.as_bytes());
    }
    stored.extend_from_slice(b);
    for s in &secrets {
        redact_secret_bytes(&mut stored, s, STREAM_URL_REDACTED.as_bytes());
    }
    let text = String::from_utf8_lossy(&stored);
    assert!(!text.contains(url));
    assert!(!text.contains("ClaveLarga-00001111"));
}
