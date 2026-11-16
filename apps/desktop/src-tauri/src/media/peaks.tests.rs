use super::*;

#[test]
fn buckets_quedan_en_rango() {
    assert_eq!(clamp_buckets(0), MIN_BUCKETS);
    assert_eq!(clamp_buckets(1), MIN_BUCKETS);
    assert_eq!(clamp_buckets(600), 600);
    assert_eq!(clamp_buckets(999_999), MAX_BUCKETS);
}

#[test]
fn el_contrato_json_de_picos_es_camel_case_y_min_max() {
    // Contrato que consume `useWaveform`/`audioPeaks` en el frontend:
    // { assetId, durationSeconds, buckets, peaks: [{ min, max }] }.
    let response = AudioPeaks {
        asset_id: "asset-1".to_owned(),
        duration_seconds: 12.5,
        buckets: 600,
        peaks: vec![
            PeakPair {
                min: -0.5,
                max: 0.25,
            },
            PeakPair {
                min: -1.0,
                max: 1.0,
            },
        ],
    };
    let json = serde_json::to_value(&response).expect("serializa el contrato");
    assert_eq!(json["assetId"], "asset-1");
    assert_eq!(json["durationSeconds"], 12.5);
    assert_eq!(json["buckets"], 600);
    assert_eq!(json["peaks"][0]["min"], -0.5);
    assert_eq!(json["peaks"][0]["max"], 0.25);
    assert_eq!(json["peaks"][1]["min"], -1.0);
    assert_eq!(json["peaks"][1]["max"], 1.0);
    // Sin campos viejos/snake_case en el wire.
    assert!(json.get("asset_id").is_none());
    assert!(json.get("duration_seconds").is_none());
}

#[test]
fn los_picos_quedan_entre_menos_uno_y_uno() {
    // Muestras de prueba: silencio, pico positivo y negativo.
    let samples = [0.0f32, 0.5, -0.75, 1.0, -1.0, 0.25];
    let mut reducer = PeakReducer::new(2.0, MAX_BUCKETS);
    for sample in samples {
        reducer.push(sample);
    }
    let peaks = reducer.finish();
    assert_eq!(peaks.len(), 3);
    assert!((peaks[0].max - 0.5).abs() < f32::EPSILON);
    assert!((peaks[1].min + 0.75).abs() < f32::EPSILON);
    assert!((peaks[1].max - 1.0).abs() < f32::EPSILON);
    for peak in &peaks {
        assert!(peak.min >= -1.0 && peak.max <= 1.0);
    }
}

#[test]
fn el_reductor_ignora_muestras_no_finitas_y_corta_en_el_tope() {
    let mut reducer = PeakReducer::new(2.0, 2);
    assert!(reducer.push(f32::NAN));
    assert!(reducer.push(0.5));
    assert!(reducer.push(-0.5));
    assert!(reducer.push(0.9));
    assert!(!reducer.push(0.1), "el tope de buckets corta el push");
    let peaks = reducer.finish();
    assert_eq!(peaks.len(), 2);
    assert_eq!(peaks[0].min, -0.5);
    assert_eq!(peaks[0].max, 0.5);
    assert_eq!(peaks[1].min, 0.1);
    assert_eq!(peaks[1].max, 0.9);
}

#[test]
fn parse_audio_probe_lee_rate_y_duration_con_defaults() {
    let json = r#"{"streams":[{"sample_rate":"44100","duration":"12.5"}]}"#;
    assert_eq!(parse_audio_probe(json), (12.5, 44100.0));
    assert_eq!(parse_audio_probe("basura"), (0.0, 48_000.0));
    assert_eq!(parse_audio_probe(r#"{"streams":[]}"#), (0.0, 48_000.0));
}
