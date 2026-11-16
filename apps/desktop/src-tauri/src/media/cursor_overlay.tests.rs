use super::*;

fn spec() -> CursorOverlaySpec {
    CursorOverlaySpec {
        style: "flecha".into(),
        color: "blanco".into(),
        scale: 1.0,
        ripple: true,
    }
}

fn sample(t: u64, x: f64, y: f64, click: Option<ClickKind>) -> CursorSample {
    CursorSample { t_ms: t, x, y, click }
}

#[test]
fn spec_rechaza_valores_invalidos() {
    let mut s = spec();
    s.style = "laser".into();
    assert!(s.validate().is_err());
    let mut s = spec();
    s.color = "rosa".into();
    assert!(s.validate().is_err());
    let mut s = spec();
    s.scale = 3.0;
    assert!(s.validate().is_err());
    assert!(spec().validate().is_ok());
}

#[test]
fn ass_vacio_sin_muestras() {
    assert!(generate_cursor_ass(&[], &spec(), 1920, 1080, (0, 0, 1920, 1080), 5000).is_empty());
    assert!(generate_cursor_ass(&[sample(0, 1.0, 1.0, None)], &spec(), 0, 1080, (0, 0, 1920, 1080), 5000).is_empty());
}

#[test]
fn ass_genera_eventos_de_movimiento_y_click() {
    let samples = vec![
        sample(0, 100.0, 100.0, None),
        sample(100, 300.0, 200.0, Some(ClickKind::Izquierdo)),
        sample(200, 500.0, 200.0, None),
    ];
    let ass = generate_cursor_ass(&samples, &spec(), 1920, 1080, (0, 0, 1920, 1080), 2000);
    assert!(ass.contains("PlayResX: 1920"));
    assert!(ass.contains("PlayResY: 1080"));
    assert!(ass.contains("\\move"));
    assert!(ass.contains("\\p1"));
    // 3 keyframes => 2 movimientos + 1 estático final + 1 anillo de click.
    assert_eq!(ass.matches("Dialogue:").count(), 4);
}

#[test]
fn ass_sin_ripple_no_genera_anillos() {
    let mut s = spec();
    s.ripple = false;
    let samples = vec![
        sample(0, 100.0, 100.0, None),
        sample(100, 300.0, 200.0, Some(ClickKind::Izquierdo)),
    ];
    let ass = generate_cursor_ass(&samples, &s, 1920, 1080, (0, 0, 1920, 1080), 2000);
    // 2 keyframes => 1 movimiento + 1 estático final; sin anillos.
    assert_eq!(ass.matches("Dialogue:").count(), 2);
    assert!(!ass.contains("\\fad"));
}

#[test]
fn spec_acepta_estilos_cheia_y_3d() {
    for style in ["cheia", "3d"] {
        let mut s = spec();
        s.style = style.into();
        assert!(s.validate().is_ok(), "{style} debe validar");
        let samples = vec![sample(0, 100.0, 100.0, None)];
        let ass = generate_cursor_ass(&samples, &s, 1920, 1080, (0, 0, 1920, 1080), 1000);
        assert!(ass.contains("\\p1"), "{style} debe emitir path");
    }
}

#[test]
fn dibujos_cheia_y_3d_tienen_geometria_distinta() {
    let cheia = shape_drawing("cheia", 1.0);
    let tresd = shape_drawing("3d", 1.0);
    // cheia: 4 vértices => 3 l internos + cierre; 3d: 7 => 6 + cierre.
    assert_eq!(cheia.matches(" l ").count(), 4);
    assert_eq!(tresd.matches(" l ").count(), 7);
    // Ambas cierran el path en el origen.
    assert!(cheia.ends_with("l 0 0"));
    assert!(tresd.ends_with("l 0 0"));
}

#[test]
fn ass_map_offset_traduce_coordenadas() {
    // Cursor en (1920,540) del escritorio virtual -> con map (0,0,3840,1080)
    // y vídeo 1920x1080 debe caer en x=960.
    let samples = vec![sample(0, 1920.0, 540.0, None), sample(100, 2880.0, 540.0, None)];
    let ass = generate_cursor_ass(&samples, &spec(), 1920, 1080, (0, 0, 3840, 1080), 1000);
    assert!(ass.contains("960"));
}

#[test]
fn ass_filter_arg_escapa_path() {
    let p = std::path::Path::new("C:\\Mis Videos\\rec.mp4");
    let arg = ass_filter_arg(p);
    assert!(arg.starts_with("ass=filename='"));
    assert!(arg.contains("C\\:/Mis Videos/rec.mp4"));
    // El único backslash permitido es el que escapa ':' del drive.
    assert_eq!(arg.matches('\\').count(), 1);
}

#[test]
fn ass_tiempos_formato() {
    assert_eq!(ass_time(0), "0:00:00.00");
    assert_eq!(ass_time(1234), "0:00:01.23");
    assert_eq!(ass_time(3723456), "1:02:03.45");
}

#[test]
fn estilos_generan_dibujos_distintos() {
    for style in CURSOR_STYLES {
        let mut s = spec();
        s.style = style.into();
        let samples = vec![sample(0, 10.0, 10.0, None), sample(50, 50.0, 50.0, None)];
        let ass = generate_cursor_ass(&samples, &s, 640, 480, (0, 0, 640, 480), 1000);
        assert!(!ass.is_empty(), "estilo {style} vacío");
        assert!(ass.contains("\\p1"));
    }
}
