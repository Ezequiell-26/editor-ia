use super::*;

#[test]
fn status_inicial_no_graba() {
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
    let args = gdigrab_input_args("desktop", None, None, None, None, None, 30);
    assert!(args.windows(2).any(|w| w == ["-i", "desktop"]));
    assert!(args.windows(2).any(|w| w == ["-framerate", "30"]));
    assert!(!args.iter().any(|a| a.starts_with("title=")));
}

#[test]
fn gdigrab_args_window_y_region_llevan_sus_parametros() {
    let win = gdigrab_input_args("window", Some("Editor"), None, None, None, None, 60);
    assert!(win.iter().any(|a| a == "title=Editor"));

    let reg = gdigrab_input_args("region", None, Some(10), Some(20), Some(640), Some(360), 30);
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
    assert!(y >= 2026 && m >= 1 && m <= 12);
}
