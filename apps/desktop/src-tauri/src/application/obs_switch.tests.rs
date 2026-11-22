use super::*;

fn spec() -> ObsSwitchSpec {
    ObsSwitchSpec::new(None, Some(1.0), None, None, Some(30)).unwrap()
}

#[test]
fn spec_defaults_and_validation() {
    let s = ObsSwitchSpec::new(None, None, None, None, None).unwrap();
    assert_eq!(s.kind, "fade");
    assert_eq!(s.transition_secs, 1.0);
    assert_eq!(s.width, 1920);
    assert_eq!(s.height, 1080);
    assert_eq!(s.fps, 30);

    assert!(ObsSwitchSpec::new(Some("no-existe".to_owned()), None, None, None, None).is_err());
    assert!(ObsSwitchSpec::new(None, Some(0.0), None, None, None).is_err());
    assert!(ObsSwitchSpec::new(None, Some(31.0), None, None, None).is_err());
    assert!(ObsSwitchSpec::new(None, None, Some(4), None, None).is_err());
    assert!(ObsSwitchSpec::new(None, None, None, None, Some(0)).is_err());
    assert!(ObsSwitchSpec::new(None, None, None, None, Some(61)).is_err());
    // Todos los kinds de xfade son aceptados.
    for kind in TRANSITION_KINDS {
        assert!(ObsSwitchSpec::new(Some((*kind).to_owned()), None, None, None, None).is_ok());
    }
}

#[test]
fn offsets_descuentan_una_transicion_por_union() {
    // d = [10, 8, 6], D = 1 → offsets: 9, 15, ... espera:
    // unión1: d0 - D = 9; acumulado = 10+8-1 = 17
    // unión2: 17 - 1 = 16
    let offsets = stitch_offsets(&[10.0, 8.0, 6.0], 1.0);
    assert_eq!(offsets, vec![9.0, 16.0]);
    // Total: 24 - 2*1 = 22
    assert!((stitched_total_secs(&[10.0, 8.0, 6.0], 1.0) - 22.0).abs() < 1e-9);
}

#[test]
fn stitch_plan_rejects_short_segments() {
    let s = spec();
    // offset = 5 - 1 = 4 ok; segunda unión: (5+4-1) -1 = 7 ok → válido.
    assert!(validate_stitch_plan(&[5.0, 4.0, 6.0], &[true, true, true], &s).is_ok());
    // Segmento de 0.5s con transición de 1s → offset negativo → error.
    assert!(validate_stitch_plan(&[0.5, 4.0], &[true, true], &s).is_err());
    // Un solo segmento no es un cosido.
    assert!(validate_stitch_plan(&[5.0], &[true], &s).is_err());
    // Duración no finita.
    assert!(validate_stitch_plan(&[f64::NAN, 4.0], &[true, true], &s).is_err());
    // has_audio desalineado.
    assert!(validate_stitch_plan(&[5.0, 4.0], &[true], &s).is_err());
}

#[test]
fn filtergraph_joins_three_segments_with_unique_labels() {
    let s = spec();
    let g = stitch_filtergraph(
        &[10.0, 8.0, 6.0],
        &[true, false, true],
        &[Some(2), None, Some(2)],
        &s,
    )
    .unwrap();
    // Cada entrada normalizada.
    assert!(g.contains("[0:v]scale=1920:1080"));
    assert!(g.contains("[2:v]scale=1920:1080"));
    // Dos xfade encadenados con offsets 9 y 16.
    assert!(g.contains("xfade=transition=fade:duration=1:offset=9.000"));
    assert!(g.contains("xfade=transition=fade:duration=1:offset=16.000"));
    // Etiquetas intermedias únicas y final [v].
    assert!(g.contains("[xj1]") || g.contains("[xj2]"));
    assert!(g.contains("[v]"));
    // Audio: seg con pista → aformat; seg sin pista → anullsrc del largo.
    assert!(g.contains("[0:a]aformat=sample_fmts=fltp"));
    assert!(g.contains("anullsrc=sample_rate=48000"));
    assert!(g.contains("atrim=duration=8.000"));
    assert!(g.contains("acrossfade=d=1.000"));
    // Cada entrada se consume una sola vez (sin labels duplicados).
    assert_eq!(g.matches("[0:v]").count(), 1);
    assert_eq!(g.matches("[1:v]").count(), 1);
    assert_eq!(g.matches("[2:v]").count(), 1);
}

#[test]
fn filtergraph_two_segments_no_audio_has_no_audio_chain() {
    let s = spec();
    let g = stitch_filtergraph(&[5.0, 4.0], &[false, false], &[None, None], &s).unwrap();
    assert!(g.contains("xfade=transition=fade:duration=1:offset=4.000[v]"));
    assert!(!g.contains("acrossfade"));
    assert!(!g.contains("anullsrc"));
    assert!(!g.contains("[a]"));
}

#[test]
fn filtergraph_rejects_degenerate_plan() {
    let s = spec();
    assert!(stitch_filtergraph(&[1.0], &[true], &[Some(2)], &s).is_err());
    assert!(stitch_filtergraph(&[0.2, 4.0], &[true, true], &[None, None], &s).is_err());
    // channels desalineado con durations → error honesto.
    assert!(stitch_filtergraph(&[5.0, 4.0], &[true, true], &[Some(2)], &s).is_err());
}

#[test]
fn filtergraph_mono_segment_uses_unity_gain_upmix() {
    // `aformat` mono→estéreo aplica la ley de rematrix (−3,01 dB/canal):
    // el segmento mono debe pasar por `pan` unity-gain antes del aformat.
    let s = spec();
    let g = stitch_filtergraph(&[5.0, 4.0], &[true, true], &[Some(1), Some(2)], &s).unwrap();
    assert!(g.contains("[0:a]pan=stereo|c0=c0|c1=c0,aformat="), "{g}");
    assert!(g.contains("[1:a]aformat=sample_fmts=fltp"), "{g}");
    assert!(!g.contains("[1:a]pan="), "{g}");
}

#[test]
fn total_acotado_rechaza_sesiones_extremas() {
    let s = spec();
    // 3000 segmentos de 10s = 30000s > 21600 → error aunque offsets sanos.
    let durations = vec![10.0; 3000];
    let audio = vec![true; 3000];
    assert!(validate_stitch_plan(&durations, &audio, &s).is_err());
    // 2000 × 10s = 20000s − 1999 ≈ 18001s → ok.
    let durations = vec![10.0; 2000];
    assert!(validate_stitch_plan(&durations, &audio[..2000], &s).is_ok());
}
