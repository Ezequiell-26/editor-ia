//! Tests de `application::concat_worker`: validación pura siempre; el smoke
//! contra el worker real sólo corre si el binario está compilado (en CI o en
//! una máquina sin `apps/concat-worker/target` se reporta y se omite).

use super::*;
use crate::infrastructure::concat_worker::SystemConcatWorker;
use serde_json::json;

fn backend() -> SystemConcatWorker {
    SystemConcatWorker
}

#[test]
fn allowlist_rechaza_ops_desconocidas() {
    assert!(build_request("eval", &json!({})).is_err());
    assert!(build_request("render", &json!({})).is_err());
    assert!(build_request("", &json!({})).is_err());
}

#[test]
fn render_export_exige_output_y_clips_con_path() {
    // Sin output.
    assert!(build_request(
        "render_export",
        &json!({"clips": [{"path": "a.mp4"}]})
    )
    .is_err());
    // Sin clips.
    assert!(build_request("render_export", &json!({"output": "o.mp4"})).is_err());
    // clips vacío o no-array.
    assert!(build_request(
        "render_export",
        &json!({"output": "o.mp4", "clips": []})
    )
    .is_err());
    assert!(build_request(
        "render_export",
        &json!({"output": "o.mp4", "clips": "a.mp4"})
    )
    .is_err());
    // Un clip sin path.
    assert!(build_request(
        "render_export",
        &json!({"output": "o.mp4", "clips": [{"path": "a.mp4"}, {"duration": "1"}]})
    )
    .is_err());
    // Mínimo válido: pasa la validación y llega al worker.
    let request = build_request(
        "render_export",
        &json!({
            "output": "o.mp4",
            "width": 640,
            "height": 360,
            "frame_rate": "30",
            "clips": [{"path": "a.mp4", "duration": "1", "audio": true}]
        }),
    )
    .unwrap();
    assert_eq!(request["op"], "render_export");
    assert_eq!(request["clips"][0]["path"], "a.mp4");
}

#[test]
fn render_export_valida_la_forma_de_transition_y_speed() {
    let base = |clip: Value| {
        json!({
            "output": "o.mp4",
            "clips": [{"path": "a.mp4", "duration": "1"}, clip]
        })
    };
    // transition válido pasa y llega intacto al worker.
    let ok = build_request(
        "render_export",
        &base(json!({
            "path": "b.mp4", "duration": "1",
            "transition": {"type": "wipeleft", "frames": 15},
            "speed": "3/2"
        })),
    )
    .unwrap();
    assert_eq!(ok["clips"][1]["transition"]["type"], "wipeleft");
    assert_eq!(ok["clips"][1]["speed"], "3/2");
    // Sin `type`, o con duration+frames juntos, o transition no-objeto.
    assert!(build_request(
        "render_export",
        &base(json!({"path": "b.mp4", "transition": {"duration": "0.5"}}))
    )
    .is_err());
    assert!(build_request(
        "render_export",
        &base(json!({
            "path": "b.mp4",
            "transition": {"type": "dissolve", "duration": "0.5", "frames": 10}
        }))
    )
    .is_err());
    assert!(build_request(
        "render_export",
        &base(json!({"path": "b.mp4", "transition": "dissolve"}))
    )
    .is_err());
    // speed de tipo grosero (objeto/array/bool) se rechaza; string y
    // número pasan (el rango/valor exacto lo valida el worker).
    assert!(build_request(
        "render_export",
        &base(json!({"path": "b.mp4", "speed": {"x": 1}}))
    )
    .is_err());
    assert!(build_request(
        "render_export",
        &base(json!({"path": "b.mp4", "speed": true}))
    )
    .is_err());
    assert!(build_request(
        "render_export",
        &base(json!({"path": "b.mp4", "speed": "2"}))
    )
    .is_ok());
}

#[test]
fn params_deben_ser_objeto() {
    assert!(build_request("ping", &json!([1, 2])).is_err());
    assert!(build_request("ping", &json!("x")).is_err());
    assert!(build_request("ping", &json!(null)).is_ok());
    assert!(build_request("ping", &json!({})).is_ok());
}

#[test]
fn el_request_mezcla_op_y_params_y_op_no_se_pisa() {
    let request = build_request("probe", &json!({"path": "a.mp4", "op": "ping"})).unwrap();
    assert_eq!(request["op"], "probe");
    assert_eq!(request["path"], "a.mp4");
}

#[test]
fn probe_y_decode_frame_exigen_path() {
    assert!(build_request("probe", &json!({})).is_err());
    assert!(build_request("probe", &json!({"path": "  "})).is_err());
    assert!(build_request("probe", &json!({"path": "clip.mp4"})).is_ok());
    assert!(build_request("decode_frame", &json!({"path": "c.mp4"})).is_err());
    assert!(
        build_request(
            "decode_frame",
            &json!({"path": "c.mp4", "time": "1", "out": "f.png"})
        )
        .is_ok()
    );
    // ping/shutdown no piden path.
    assert!(build_request("ping", &json!({})).is_ok());
    assert!(build_request("shutdown", &json!({})).is_ok());
}

#[test]
fn timeout_se_acota_a_rango_seguro() {
    assert_eq!(clamp_timeout(Some(1)), MIN_TIMEOUT);
    assert_eq!(clamp_timeout(Some(10_000_000)), MAX_TIMEOUT);
    assert_eq!(clamp_timeout(None), DEFAULT_TIMEOUT);
    assert_eq!(clamp_timeout(Some(5_000)), Duration::from_secs(5));
}

#[test]
fn status_reporta_ops_y_disponibilidad_sin_spawn() {
    let status = status(&backend());
    assert_eq!(status.ops, WORKER_OPS.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    // En dev el worker suele estar compilado; si no, reason lo explica.
    if status.available {
        assert!(status.path.is_some());
        assert!(status.reason.is_none());
    } else {
        assert!(status.reason.is_some());
    }
}

#[test]
fn request_ping_roundtrip_contra_worker_real() {
    let Some(path) = backend().worker_path() else {
        eprintln!("concat-worker no compilado: test omitido");
        return;
    };
    if !path.is_file() {
        eprintln!("concat-worker no compilado: test omitido");
        return;
    }
    let envelope = request(&backend(), "ping", &json!({}), Some(10_000)).expect("ping ok");
    assert_eq!(envelope["ok"], true, "{envelope}");
    // Un op inválido para el worker (pero válido en allowlist? no: ops
    // desconocidas ya las rechaza build_request). probe de archivo inexistente
    // devuelve ok:false del worker, no error de transporte.
    let probe = request(
        &backend(),
        "probe",
        &json!({"path": "definitely-missing.mp4"}),
        Some(10_000),
    )
    .expect("probe responde");
    assert_eq!(probe["ok"], false);
    shutdown();
}

#[test]
fn request_rechaza_op_fuera_de_allowlist_sin_spawnear() {
    let err = request(&backend(), "eval", &json!({}), None).unwrap_err();
    assert_eq!(err.code, ProjectErrorCode::InvalidProject);
}

// ── Cancelación ───────────────────────────────────────────────────────

#[test]
fn cancel_render_sin_worker_no_cuelga_ni_rompe() {
    // Sin sesión spawneada devuelve `false`; con una viva (de otro test en
    // paralelo) escribe el cancel: en ambos casos no cuelga ni paniquea.
    let _ = cancel_render();
}

#[test]
fn cancel_llega_al_worker_real_y_no_lo_mata() {
    let Some(path) = backend().worker_path() else {
        eprintln!("concat-worker no compilado: test omitido");
        return;
    };
    if !path.is_file() {
        eprintln!("concat-worker no compilado: test omitido");
        return;
    }
    // Spawnea la sesión global con un ping (registra el stdin activo).
    let pong = request(&backend(), "ping", &json!({}), Some(10_000)).expect("ping ok");
    assert_eq!(pong["ok"], true, "{pong}");

    // El cancel se escribe directo al stdin: `true` = llegó al pipe.
    assert!(cancel_render(), "el cancel tenía que escribirse al worker");

    // El worker sigue vivo y responde: el `cancel_ack` (evento sin `ok`)
    // que emitió se salta como evento y la respuesta real es la del ping.
    let pong2 = request(&backend(), "ping", &json!({}), Some(10_000)).expect("ping tras cancel");
    assert_eq!(pong2["ok"], true, "{pong2}");
    shutdown();
}
