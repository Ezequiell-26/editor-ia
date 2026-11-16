use super::*;

fn temp_python(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("olyvia-transcribe-tests");
    std::fs::create_dir_all(&dir).expect("carpeta temporal");
    let path = dir.join(name);
    std::fs::write(&path, b"# fixture").expect("fixture");
    path
}

#[test]
fn env_python_is_used_only_when_it_is_verified() {
    let env = temp_python("python-verificado.exe");
    let status = resolve_python_with(Some(env.clone()), &[], &|path| {
        if path == env {
            PythonProbe::Ready
        } else {
            PythonProbe::Missing
        }
    });
    assert!(status.available());
    assert_eq!(status.python, Some(env));
    assert!(status.reason.is_none());
}

#[test]
fn broken_env_python_reports_the_install_step() {
    let env = temp_python("python-sin-modulo.exe");
    let status = resolve_python_with(Some(env), &[], &|_| PythonProbe::WithoutFasterWhisper);
    assert!(!status.available());
    let reason = status.reason.expect("motivo");
    assert!(reason.contains("faster-whisper"), "{reason}");
    assert!(reason.contains("pip install"), "{reason}");
}

#[test]
fn missing_env_path_is_reported_and_path_python_still_works() {
    let missing = std::env::temp_dir().join("olyvia-python-fantasma-98765.exe");
    let status = resolve_python_with(Some(missing), &[PathBuf::from("python")], &|path| {
        if path == Path::new("python") {
            PythonProbe::Ready
        } else {
            PythonProbe::Missing
        }
    });
    assert!(status.available());
    assert_eq!(status.python, Some(PathBuf::from("python")));
}

#[test]
fn no_engine_reports_how_to_install_it() {
    let status =
        resolve_python_with(None, &[PathBuf::from("python")], &|_| PythonProbe::Missing);
    assert!(!status.available());
    let reason = status.reason.expect("motivo");
    assert!(reason.contains("faster-whisper"), "{reason}");
    assert!(reason.contains("EDITORIA_WHISPER_PYTHON"), "{reason}");
}

#[test]
fn path_python_without_the_module_is_not_reported_as_available() {
    let status = resolve_python_with(
        None,
        &[PathBuf::from("python"), PathBuf::from("python3")],
        &|path| {
            if path == Path::new("python3") {
                PythonProbe::WithoutFasterWhisper
            } else {
                PythonProbe::Missing
            }
        },
    );
    assert!(!status.available());
    let reason = status.reason.expect("motivo");
    assert!(reason.contains("PATH"), "{reason}");
    assert!(reason.contains("pip install"), "{reason}");
}

#[test]
fn parses_a_valid_transcription_and_bounds_segments() {
    let raw = br#"{"language":"es","languageProbability":0.99,"durationSeconds":2.5,"model":"small","segments":[{"start":0.0,"end":1.2,"text":"Hola mundo","words":[{"start":0.0,"end":0.4,"word":"Hola","probability":0.9}]}]}"#;
    let result = parse_result(raw).expect("valid");
    assert_eq!(result.language, "es");
    assert_eq!(result.segments.len(), 1);
    assert_eq!(result.segments[0].text, "Hola mundo");
    assert_eq!(result.segments[0].words.len(), 1);
}

#[test]
fn rejects_invalid_json_and_models() {
    assert!(parse_result(b"not json").is_err());
    assert!(validate_model("small").is_ok());
    assert!(validate_model("large-v3").is_err());
    assert_eq!(validate_language("ES").unwrap(), "es");
    assert_eq!(validate_language("auto").unwrap(), "auto");
}

#[test]
fn native_model_id_cubre_los_modelos_de_la_tabla() {
    assert_eq!(native_model_id("tiny"), Some("tiny"));
    assert_eq!(native_model_id("base"), Some("base"));
    assert_eq!(native_model_id("small"), Some("small"));
    // medium no existe en la tabla de concat-speech-min: va a Python.
    assert_eq!(native_model_id("medium"), None);
    assert_eq!(native_model_id("large-v3"), None);
}

#[test]
fn engine_plan_prefiere_nativo_y_cae_a_python() {
    assert_eq!(
        engine_plan(true, true),
        vec![TranscriptionEngine::Native, TranscriptionEngine::Python]
    );
    assert_eq!(
        engine_plan(true, false),
        vec![TranscriptionEngine::Native]
    );
    assert_eq!(
        engine_plan(false, true),
        vec![TranscriptionEngine::Python]
    );
    assert!(engine_plan(false, false).is_empty());
}

#[test]
fn native_segments_become_the_command_dto_with_engine_reported() {
    let segments = vec![
        crate::vendor_concat::speech::Segment {
            start: 0.5,
            end: 2.25,
            text: "  hola  ".to_owned(),
        },
        crate::vendor_concat::speech::Segment {
            start: 3.0,
            end: 4.0,
            text: "mundo".to_owned(),
        },
    ];
    let result = result_from_native_segments(&segments, "auto", "base", 12.5);
    assert_eq!(result.engine.as_deref(), Some("native"));
    assert_eq!(result.language, "auto");
    assert_eq!(result.model, "base");
    assert_eq!(result.duration_seconds, 12.5);
    assert_eq!(result.segments.len(), 2);
    assert_eq!(result.segments[0].start, 0.5);
    assert!(result.segments[0].words.is_empty());
    // El motor nativo no mide la confianza del idioma: 0.0, no inventado.
    assert_eq!(result.language_probability, 0.0);
    // El JSON serializado conserva el campo para el frontend.
    let json = serde_json::to_value(&result).expect("serializa");
    assert_eq!(json["engine"], "native");
}

#[test]
fn native_result_respects_the_same_segment_caps() {
    let long = "x".repeat(900);
    let segments = vec![crate::vendor_concat::speech::Segment {
        start: 0.0,
        end: 1.0,
        text: long,
    }];
    let result = result_from_native_segments(&segments, "es", "tiny", 1.0);
    assert_eq!(result.segments[0].text.chars().count(), 500);
}

#[test]
fn native_whisper_models_maps_crate_status_with_paths() {
    use crate::vendor_concat::speech::transcribe::ModelStatus;

    let status = crate::vendor_concat::speech::TranscriberStatus {
        models_dir: if cfg!(windows) {
            "C:\\cfg\\whisper-models".to_owned()
        } else {
            "/cfg/whisper-models".to_owned()
        },
        models: vec![
            ModelStatus {
                id: "tiny".to_owned(),
                label: "Tiny (Multilingual)".to_owned(),
                blurb: "Fastest draft, any language.".to_owned(),
                english_only: false,
                size_bytes: 77_691_713,
                downloaded: true,
            },
            ModelStatus {
                id: "base.en".to_owned(),
                label: "Base (English)".to_owned(),
                blurb: "The sweet spot.".to_owned(),
                english_only: true,
                size_bytes: 147_964_211,
                downloaded: false,
            },
        ],
    };
    let models = native_whisper_models(&status);
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "tiny");
    assert!(models[0].downloaded);
    assert!(models[0].path.as_deref().unwrap().ends_with("ggml-tiny.bin"));
    assert_eq!(models[1].id, "base.en");
    assert!(!models[1].downloaded);
    assert!(models[1].path.is_none(), "sin descarga no hay path");
    // El DTO serializa en camelCase para el frontend.
    let json = serde_json::to_value(&models[0]).expect("serializa");
    assert_eq!(json["sizeBytes"], 77_691_713u64);
    assert_eq!(json["englishOnly"], false);
}

#[test]
fn whisper_download_progress_maps_bytes_and_percent() {
    let progress = crate::vendor_concat::speech::DownloadProgress {
        id: "base".to_owned(),
        received: 50,
        total: 200,
        unpacking: false,
        done: false,
    };
    let dto = whisper_download_progress(&progress);
    assert_eq!(dto.model_id, "base");
    assert_eq!(dto.received, 50);
    assert_eq!(dto.total, 200);
    assert_eq!(dto.percent, Some(25.0));
    assert!(!dto.done);

    // Sin Content-Length ni estimación no hay porcentaje que inventar.
    let unknown = crate::vendor_concat::speech::DownloadProgress {
        id: "small".to_owned(),
        received: 10,
        total: 0,
        unpacking: true,
        done: false,
    };
    let dto = whisper_download_progress(&unknown);
    assert_eq!(dto.percent, None);
    assert!(dto.unpacking);

    // El porcentaje nunca pasa de 100 aunque received supere al total.
    let over = crate::vendor_concat::speech::DownloadProgress {
        id: "tiny".to_owned(),
        received: 300,
        total: 200,
        unpacking: false,
        done: true,
    };
    assert_eq!(whisper_download_progress(&over).percent, Some(100.0));
}
