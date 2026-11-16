use super::*;

#[test]
fn presets_build_the_expected_chain() {
    let dialogue = build_chain(DialoguePreset::Dialogue).expect("cadena diálogo");
    assert_eq!(dialogue.len(), 8);
    assert_eq!(dialogue[0].id(), "denoise");
    assert_eq!(dialogue.last().map(|fx| fx.id()), Some("limiter"));
    let soft = build_chain(DialoguePreset::Soft).expect("cadena suave");
    assert_eq!(soft.len(), 4);
    assert_eq!(soft[0].id(), "denoise");
}

#[test]
fn preset_parser_rejects_unknown_values() {
    assert_eq!(
        DialoguePreset::parse(Some("PODCAST")).expect("podcast"),
        DialoguePreset::Podcast
    );
    assert!(DialoguePreset::parse(Some("telefono")).is_err());
}

#[test]
fn dialogue_dsp_processes_finite_audio() {
    let mut chain = build_chain(DialoguePreset::Dialogue).expect("cadena");
    let mut left: Vec<f32> = (0..4800)
        .map(|index| 0.2 * (index as f32 * 0.05).sin() + 0.01)
        .collect();
    let mut right = left.clone();
    let mut channels = [&mut left[..], &mut right[..]];
    for fx in chain.iter_mut() {
        fx.process(&mut channels);
    }
    assert!(left
        .iter()
        .chain(right.iter())
        .all(|value| value.is_finite()));
    assert!(left.iter().any(|value| value.abs() > 0.0001));
}
