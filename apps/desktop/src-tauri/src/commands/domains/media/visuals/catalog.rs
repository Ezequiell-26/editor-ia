fn parameter(key: &str, label: &str, min: f64, max: f64, default: f64) -> EffectParameter {
    EffectParameter {
        key: key.to_owned(),
        label: label.to_owned(),
        min,
        max,
        default,
        unit: "range".to_owned(),
    }
}

fn effect(
    id: &str,
    label: &str,
    category: &str,
    description: &str,
    filters: &[&str],
    parameters: Vec<EffectParameter>,
) -> VisualEffectSpec {
    VisualEffectSpec {
        id: id.to_owned(),
        label: label.to_owned(),
        category: category.to_owned(),
        description: description.to_owned(),
        filters: filters.iter().map(|value| (*value).to_owned()).collect(),
        available: true,
        parameters,
    }
}

fn preset(id: &str, label: &str, description: &str, settings: Value) -> VisualPresetSpec {
    VisualPresetSpec {
        id: id.to_owned(),
        label: label.to_owned(),
        description: description.to_owned(),
        settings,
    }
}

fn catalog_effects() -> Vec<VisualEffectSpec> {
    vec![
        effect(
            "brightness",
            "Brillo",
            "color",
            "Sube o baja la exposición general del clip.",
            &["eq"],
            vec![parameter("brightness", "Brillo", -1.0, 1.0, 0.0)],
        ),
        effect(
            "contrast",
            "Contraste",
            "color",
            "Separa luces y sombras.",
            &["eq"],
            vec![parameter("contrast", "Contraste", 0.0, 3.0, 1.0)],
        ),
        effect(
            "saturation",
            "Saturación",
            "color",
            "Intensifica o desatura el color.",
            &["eq"],
            vec![parameter("saturation", "Saturación", 0.0, 3.0, 1.0)],
        ),
        effect(
            "temperature",
            "Temperatura",
            "color",
            "Enfría o calienta la imagen.",
            &["colorbalance"],
            vec![parameter("temperature", "Temperatura", -1.0, 1.0, 0.0)],
        ),
        effect(
            "shadows",
            "Sombras",
            "color",
            "Levanta o hunde las sombras.",
            &["curves"],
            vec![parameter("shadows", "Sombras", -1.0, 1.0, 0.0)],
        ),
        effect(
            "highlights",
            "Altas luces",
            "color",
            "Recupera o quema las altas luces.",
            &["curves"],
            vec![parameter("highlights", "Altas luces", -1.0, 1.0, 0.0)],
        ),
        effect(
            "vignette",
            "Viñeta",
            "stylize",
            "Oscurece los bordes para concentrar la mirada.",
            &["vignette"],
            vec![parameter("vignette", "Intensidad", 0.0, 1.0, 0.25)],
        ),
        effect(
            "blur",
            "Desenfoque",
            "stylize",
            "Desenfoque gaussiano en píxeles.",
            &["gblur"],
            vec![parameter("blur", "Radio", 0.0, 50.0, 2.0)],
        ),
        effect(
            "sharpen",
            "Nitidez",
            "stylize",
            "Aumenta el detalle sin cambiar el color.",
            &["unsharp"],
            vec![parameter("sharpen", "Intensidad", 0.0, 5.0, 1.0)],
        ),
        effect(
            "hueRotate",
            "Giro de tono",
            "color",
            "Rota el matiz en grados.",
            &["hue"],
            vec![parameter("hueRotateDeg", "Grados", -180.0, 180.0, 0.0)],
        ),
        effect(
            "lut",
            "LUT .cube",
            "color",
            "Aplica una LUT 3D del proyecto con intensidad.",
            &["lut3d", "blend"],
            vec![parameter("lutIntensity", "Intensidad", 0.0, 1.0, 1.0)],
        ),
        effect(
            "curves",
            "Curvas",
            "color",
            "Curva RGB con preset o puntos propios.",
            &["curves"],
            Vec::new(),
        ),
        effect(
            "colorWheels",
            "Ruedas de color",
            "color",
            "Lift, gamma, gain y offset por canal.",
            &["colorbalance"],
            Vec::new(),
        ),
        effect(
            "hsl",
            "HSL selectivo",
            "color",
            "Ajusta matiz, saturación e intensidad por color.",
            &["hue"],
            Vec::new(),
        ),
        effect(
            "chromaKey",
            "Chroma key",
            "composite",
            "Quita un color de fondo con tolerancia y mezcla.",
            &["colorkey"],
            Vec::new(),
        ),
        effect(
            "mask",
            "Máscara",
            "composite",
            "Recorta con rectángulo o elipse, feather y keyframes.",
            &["geq"],
            Vec::new(),
        ),
    ]
}

fn catalog_presets() -> Vec<VisualPresetSpec> {
    vec![
        preset(
            "soft",
            "Suave",
            "Color limpio con desenfoque mínimo.",
            serde_json::json!({ "blur": 1.2, "brightness": 0.03, "contrast": 0.98, "saturation": 1.04 }),
        ),
        preset(
            "dream",
            "Onírico",
            "Suavidad y viñeta cálida.",
            serde_json::json!({ "blur": 2.4, "brightness": 0.05, "saturation": 1.1, "vignette": 0.12 }),
        ),
        preset(
            "noir",
            "Noir",
            "Blanco y negro con contraste alto.",
            serde_json::json!({ "grayscale": true, "contrast": 1.25, "vignette": 0.35, "curvePreset": "contrast-strong" }),
        ),
        preset(
            "vhs",
            "VHS",
            "Color analógico, ligero desenfoque y viñeta.",
            serde_json::json!({ "contrast": 1.08, "saturation": 0.85, "hueRotateDeg": 6, "blur": 0.5, "vignette": 0.2, "curvePreset": "vintage" }),
        ),
        preset(
            "documentary",
            "Documental",
            "Nitidez y color sobrio.",
            serde_json::json!({ "sharpen": 1.2, "contrast": 1.05, "saturation": 0.95 }),
        ),
        preset(
            "high-key",
            "Alta clave",
            "Luminoso y aireado.",
            serde_json::json!({ "brightness": 0.12, "contrast": 0.95, "saturation": 1.05, "shadows": 0.1, "fade": 0.08 }),
        ),
        preset(
            "low-key",
            "Baja clave",
            "Sombras profundas y contraste.",
            serde_json::json!({ "brightness": -0.1, "contrast": 1.15, "shadows": -0.12, "highlights": 0.08, "vignette": 0.22 }),
        ),
        preset(
            "neon",
            "Neón",
            "Saturación alta y tono desplazado.",
            serde_json::json!({ "saturation": 1.35, "hueRotateDeg": -10, "contrast": 1.1, "vignette": 0.18 }),
        ),
    ]
}

fn transition(
    id: &str,
    label: &str,
    description: &str,
    default_frames: u32,
    overlaps: bool,
) -> TransitionSpec {
    TransitionSpec {
        id: id.to_owned(),
        label: label.to_owned(),
        description: description.to_owned(),
        default_frames,
        max_frames: 120,
        overlaps_previous: overlaps,
        available: true,
    }
}

fn catalog_transitions() -> Vec<TransitionSpec> {
    vec![
        transition(
            "dissolve",
            "Disolvencia",
            "El clip entrante aparece con alfa sobre el anterior.",
            12,
            true,
        ),
        transition(
            "fade-black",
            "Fundido a negro",
            "Entra desde negro sin mezclar la imagen anterior.",
            12,
            false,
        ),
        transition(
            "fade-white",
            "Fundido a blanco",
            "Entra desde blanco sin mezclar la imagen anterior.",
            12,
            false,
        ),
        transition(
            "slide-left",
            "Deslizar desde la derecha",
            "El clip entra desde el borde derecho.",
            15,
            true,
        ),
        transition(
            "slide-right",
            "Deslizar desde la izquierda",
            "El clip entra desde el borde izquierdo.",
            15,
            true,
        ),
        transition(
            "slide-up",
            "Deslizar desde abajo",
            "El clip entra desde el borde inferior.",
            15,
            true,
        ),
        transition(
            "slide-down",
            "Deslizar desde arriba",
            "El clip entra desde el borde superior.",
            15,
            true,
        ),
        transition(
            "slide-3d-left",
            "Deslizar 3D desde la derecha",
            "El clip entra rotando en perspectiva sobre el eje vertical.",
            15,
            true,
        ),
        transition(
            "slide-3d-right",
            "Deslizar 3D desde la izquierda",
            "El clip entra rotando en perspectiva sobre el eje vertical.",
            15,
            true,
        ),
        transition(
            "slide-3d-up",
            "Deslizar 3D desde abajo",
            "El clip entra rotando en perspectiva sobre el eje horizontal.",
            15,
            true,
        ),
        transition(
            "slide-3d-down",
            "Deslizar 3D desde arriba",
            "El clip entra rotando en perspectiva sobre el eje horizontal.",
            15,
            true,
        ),
    ]
}
