//! Catálogo de efectos visuales, presets, transiciones y filtros FFmpeg.
//!
//! Datos y DTOs del catálogo que la UI consume vía `list_visual_catalog`:
//! qué efectos/presets/transiciones existen, sus parámetros y límites, y el
//! conjunto de filtros que el render requiere. La disponibilidad real se mide
//! en commands (FFmpeg del equipo); este módulo es puro y testeable.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectParameter {
    pub key: String,
    pub label: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualEffectSpec {
    pub id: String,
    pub label: String,
    pub category: String,
    pub description: String,
    pub filters: Vec<String>,
    pub available: bool,
    pub parameters: Vec<EffectParameter>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualPresetSpec {
    pub id: String,
    pub label: String,
    pub description: String,
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionSpec {
    pub id: String,
    pub label: String,
    pub description: String,
    pub default_frames: u32,
    pub max_frames: u32,
    pub overlaps_previous: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterSupport {
    pub name: String,
    pub label: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualCatalog {
    pub ffmpeg_available: bool,
    pub effects: Vec<VisualEffectSpec>,
    pub presets: Vec<VisualPresetSpec>,
    pub transitions: Vec<TransitionSpec>,
    pub filters: Vec<FilterSupport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualFinding {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub clip_id: Option<String>,
    pub clip_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualAudit {
    pub clips_scanned: u32,
    pub transitions: u32,
    pub effects_clips: u32,
    pub findings: Vec<VisualFinding>,
}

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

pub fn catalog_effects() -> Vec<VisualEffectSpec> {
    vec![
        effect(
            "brightness",
            "Brillo",
            "color",
            "Sube o baja la exposición general del clip.",
            &["lutyuv"],
            vec![parameter("brightness", "Brillo", -1.0, 1.0, 0.0)],
        ),
        effect(
            "contrast",
            "Contraste",
            "color",
            "Separa luces y sombras.",
            &["lutyuv"],
            vec![parameter("contrast", "Contraste", 0.0, 3.0, 1.0)],
        ),
        effect(
            "saturation",
            "Saturación",
            "color",
            "Intensifica o desatura el color.",
            &["lutyuv"],
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

pub fn catalog_presets() -> Vec<VisualPresetSpec> {
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

pub fn catalog_transitions() -> Vec<TransitionSpec> {
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
        transition(
            "wipe-left",
            "Barrido hacia la izquierda",
            "El clip entrante se revela barriendo desde la derecha.",
            15,
            true,
        ),
        transition(
            "wipe-right",
            "Barrido hacia la derecha",
            "El clip entrante se revela barriendo desde la izquierda.",
            15,
            true,
        ),
        transition(
            "wipe-up",
            "Barrido hacia arriba",
            "El clip entrante se revela barriendo desde abajo.",
            15,
            true,
        ),
        transition(
            "wipe-down",
            "Barrido hacia abajo",
            "El clip entrante se revela barriendo desde arriba.",
            15,
            true,
        ),
        transition(
            "iris",
            "Iris circular",
            "El clip entrante abre desde el centro en círculo.",
            15,
            true,
        ),
        transition(
            "blinds",
            "Persianas",
            "El clip entrante se revela en diez listones que abren en cascada.",
            15,
            true,
        ),
        transition(
            "clock-wipe",
            "Reloj",
            "El clip entrante barre en sentido horario desde el borde superior.",
            15,
            true,
        ),
        transition(
            "ink",
            "Tinta",
            "El clip entrante se expande desde el centro como una mancha de tinta.",
            15,
            true,
        ),
        transition(
            "bolhas",
            "Burbujas",
            "El clip entrante nace en burbujas que crecen en retardo desde cada celda.",
            15,
            true,
        ),
        transition(
            "colmeia",
            "Colmena",
            "Los favos hexagonales se revelan del centro hacia los bordes.",
            15,
            true,
        ),
        transition(
            "chuva",
            "Lluvia digital",
            "Columnas de lluvia revelan el clip entrante de abajo hacia arriba.",
            15,
            true,
        ),
        transition(
            "vento",
            "Viento",
            "Los granos del clip saliente son arrastrados por el viento.",
            15,
            true,
        ),
        transition(
            "triangulos",
            "Triángulos",
            "Los triángulos del clip saliente se encogen de izquierda a derecha.",
            15,
            true,
        ),
        transition(
            "persiana",
            "Cortina de listones",
            "Diez listones horizontales abren en cascada sobre el clip entrante.",
            15,
            true,
        ),
        transition(
            "reflexo",
            "Reflejo",
            "Un frente de luz diagonal cruza el cuadro revelando el clip entrante.",
            15,
            true,
        ),
        transition(
            "barrido-diagonal",
            "Barrido diagonal",
            "Un borde recto a 45° cruza el cuadro revelando el clip entrante.",
            15,
            true,
        ),
        transition(
            "pixelar",
            "Pixelado",
            "El clip entrante aparece en bloques grandes y se resuelve a cuadro completo.",
            15,
            true,
        ),
        transition(
            "interferencia",
            "Interferencia",
            "El clip entrante entra con aberración cromática y ruido de señal que se disuelve.",
            15,
            true,
        ),
        transition(
            "liquido",
            "Líquido",
            "El clip entrante entra deformado por un campo de ruido que se calma hasta quedar nítido.",
            15,
            true,
        ),
        transition(
            "caleidoscopio",
            "Caleidoscopio",
            "El clip entrante aparece plegado en sectores espejados que se abren hasta quedar normal.",
            15,
            true,
        ),
        transition(
            "desenfoque-lineal",
            "Desenfoque lineal",
            "El clip entrante entra con estelas direccionales que se acortan hasta quedar nítido.",
            15,
            true,
        ),
        transition(
            "warp-direccional",
            "Warp direccional",
            "El clip entrante aparece abombado hacia un lado y se endereza con el progreso.",
            15,
            true,
        ),
        transition(
            "glitch-digital",
            "Glitch digital",
            "El clip entrante entra con bloques desplazados y aberración cromática que se resuelven.",
            15,
            true,
        ),
        transition(
            "zoom-suave",
            "Zoom suave",
            "El clip entrante asienta desde un acercamiento del 18 % hasta el tamaño natural.",
            15,
            true,
        ),
        transition(
            "zoom-rapido",
            "Zoom rápido",
            "El clip entrante acerca desde un 15 % alejado hasta el tamaño natural.",
            15,
            true,
        ),
        transition(
            "dip-color",
            "Fundido a color",
            "El clip entra fundiéndose desde un color; color general para todos, personalizable por clip.",
            12,
            false,
        ),
        transition(
            "luma-wipe",
            "Barrido por luminancia",
            "El clip entrante se revela por la luminancia de un clip mate elegido por clip.",
            15,
            true,
        ),
        transition(
            "textura-luz",
            "Textura de luz",
            "Un destello de luz cálido generado por FFmpeg lava el corte mientras el clip entrante disuelve debajo.",
            15,
            true,
        ),
        transition(
            "textura-celular",
            "Textura celular",
            "Una lluvia digital generada por autómata celular tiñe el corte de azul noche.",
            15,
            true,
        ),
        transition(
            "textura-fractal",
            "Textura fractal",
            "Un túnel fractal generado por mandelbrot hace zoom lento sobre el corte.",
            15,
            true,
        ),
        transition(
            "textura-vida",
            "Textura viva",
            "Un autómata de Game of Life con paleta cálida propia late sobre el corte.",
            15,
            true,
        ),
        // `dip-color` y `luma-wipe` sí están en el catálogo por lote: la vista
        // ofrece el selector de color general con override por clip y un
        // selector de mate por clip (los candidatos salen de `luma-mate.ts`,
        // la misma regla que valida el render). Los clips sin mate válido se
        // saltan y se avisan.
    ]
}
pub fn required_filters() -> Vec<(&'static str, &'static str)> {
    vec![
        ("lutyuv", "Ajustes de color"),
        ("curves", "Curvas"),
        ("colorbalance", "Balance de color"),
        ("hue", "Tono y saturación"),
        ("vignette", "Viñeta"),
        ("gblur", "Desenfoque gaussiano"),
        ("unsharp", "Nitidez"),
        ("lut3d", "LUT 3D"),
        ("colorkey", "Chroma key"),
        ("geq", "Máscaras"),
        ("blend", "Mezcla"),
    ]
}

pub fn parse_filters(output: &str) -> BTreeSet<String> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            let name = parts.next()?;
            if !flags.starts_with('.') {
                // Línea de cabecera: "Filters:" o " .. = ...".
                if !flags.contains('.') {
                    return None;
                }
            }
            if name.starts_with('.') || name == "=" || name.eq_ignore_ascii_case("name") {
                return None;
            }
            Some(name.to_owned())
        })
        .collect()
}

#[cfg(test)]
#[path = "visuals_catalog.tests.rs"]
mod tests;
