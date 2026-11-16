use super::*;

#[test]
fn filter_parser_reads_ffmpeg_filter_list() {
    let sample = "Filters:\n  T.. = Timeline support\n  TSC acompressor      A->A       Audio compressor.\n  ..C eq              V->V       Adjust brightness/contrast.\n  ... gblur           V->V       Gaussian blur.\n  T.. overlay         VV->V      Overlay.\n";
    let filters = parse_filters(sample);
    assert!(filters.contains("eq"));
    assert!(filters.contains("gblur"));
    assert!(filters.contains("overlay"));
    assert!(!filters.contains("Filters:"));
}

#[test]
fn catalog_has_unique_effects_presets_and_transitions() {
    let effects = catalog_effects();
    let presets = catalog_presets();
    let transitions = catalog_transitions();
    assert!(effects.len() >= 10);
    assert!(presets.len() >= 8);
    assert_eq!(
        transitions
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "dissolve",
            "fade-black",
            "fade-white",
            "slide-left",
            "slide-right",
            "slide-up",
            "slide-down",
            "slide-3d-left",
            "slide-3d-right",
            "slide-3d-up",
            "slide-3d-down",
            "wipe-left",
            "wipe-right",
            "wipe-up",
            "wipe-down",
            "iris",
            "blinds",
            "clock-wipe",
            "ink",
            "bolhas",
            "colmeia",
            "chuva",
            "vento",
            "triangulos",
            "persiana",
            "reflexo",
            "barrido-diagonal",
            "pixelar",
            "interferencia",
            "liquido",
            "caleidoscopio",
            "desenfoque-lineal",
            "warp-direccional",
            "glitch-digital",
            "zoom-suave",
            "zoom-rapido",
            "dip-color",
            "luma-wipe",
            "textura-luz",
            "textura-celular",
            "textura-fractal",
            "textura-vida"
        ]
    );
    for list in [effects.len(), presets.len(), transitions.len()] {
        let _ = list;
    }
    let mut ids: Vec<&str> = effects.iter().map(|item| item.id.as_str()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), effects.len());
    let mut preset_ids: Vec<&str> = presets.iter().map(|item| item.id.as_str()).collect();
    preset_ids.sort();
    preset_ids.dedup();
    assert_eq!(preset_ids.len(), presets.len());
}

#[test]
fn catalog_presets_match_the_frontend_names() {
    let presets = catalog_presets();
    let labels: Vec<&str> = presets.iter().map(|item| item.label.as_str()).collect();
    assert_eq!(
        labels,
        vec![
            "Suave",
            "Onírico",
            "Noir",
            "VHS",
            "Documental",
            "Alta clave",
            "Baja clave",
            "Neón"
        ]
    );
}

#[test]
fn transition_specs_are_bounded_and_labeled() {
    for transition in catalog_transitions() {
        assert!(!transition.label.is_empty());
        assert!(transition.default_frames > 0);
        assert!(transition.default_frames <= transition.max_frames);
    }
}
