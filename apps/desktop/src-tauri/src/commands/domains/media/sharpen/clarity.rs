#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClarityMode {
    Video,
    Image,
}

impl ClarityMode {
    fn parse(value: Option<&str>) -> Result<Self, ProjectError> {
        match value
            .unwrap_or("video")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "video" => Ok(Self::Video),
            "image" | "imagen" => Ok(Self::Image),
            _ => Err(ProjectError::message(
                ProjectErrorCode::InvalidProject,
                "modo de definición inválido: usá video o image",
            )),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Video => "mp4",
            Self::Image => "png",
        }
    }
}

/// Parámetros ya resueltos de la cadena. Los presets los resuelve el frontend
/// para que los controles muestren el valor real que se va a aplicar.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ClarityConfig {
    /// Fuerza de limpieza, 0–100. 0 apaga el suavizado temporal.
    pub denoise: u8,
    /// De-blocking de compresión (independiente de `denoise`).
    pub deblock: bool,
    /// Altura destino. 0 deja la resolución original.
    pub target_height: u32,
    /// Escalar en un espacio de trabajo de 16 bits por canal.
    pub high_precision: bool,
    /// Cantidad de la máscara de enfoque, 0–3.
    pub unsharp_amount: f32,
    /// Tamaño de la matriz de la máscara: 3, 5, 7 o 9.
    pub unsharp_size: u32,
    /// Fuerza de la curva S, 0–100.
    pub curve: u8,
    /// Intensidad del grano, 0–3 (%).
    pub grain: f32,
    /// El suavizado temporal necesita varios cuadros: en una imagen no aplica.
    pub temporal: bool,
}

impl Default for ClarityConfig {
    fn default() -> Self {
        Self {
            denoise: 0,
            deblock: false,
            target_height: 0,
            high_precision: true,
            unsharp_amount: 0.0,
            unsharp_size: 5,
            curve: 0,
            grain: 0.0,
            temporal: true,
        }
    }
}

/// Cadena de filtros, en el orden en que debe ejecutarse. Es pura para poder
/// probarla sin FFmpeg.
pub(crate) fn clarity_filters(config: &ClarityConfig, source_height: u32) -> Vec<String> {
    let mut filters: Vec<String> = Vec::new();

    // 1. Limpieza: primero el artefacto, después el detalle.
    if config.deblock {
        let strength = if config.denoise >= 60 {
            "strong"
        } else {
            "weak"
        };
        filters.push(format!("deblock=filter={strength}:block=8"));
    }
    if config.denoise > 0 && config.temporal {
        let base = f32::from(config.denoise.clamp(1, 100)) / 100.0;
        // atadenoise compara el cuadro con su vecindad temporal: umbrales bajos
        // conservan el detalle, altos borronean el movimiento.
        let luma_a = 0.005 + base * 0.045;
        let luma_b = 0.010 + base * 0.090;
        let chroma_a = 0.005 + base * 0.040;
        let chroma_b = 0.010 + base * 0.080;
        filters.push(format!(
            "atadenoise=0a={luma_a:.4}:0b={luma_b:.4}:1a={chroma_a:.4}:1b={chroma_b:.4}"
        ));
    }

    // 2. Escalado Lanczos3. El ancho se deriva del alto para no deformar.
    let needs_scale =
        config.target_height > 0 && (source_height == 0 || config.target_height != source_height);
    if needs_scale {
        if config.high_precision {
            // 16 bits por canal durante el remuestreo: menos cuantización en
            // los bordes que se están inventando.
            filters.push("format=gbrp16le".to_owned());
        }
        filters.push(format!(
            "scale=-2:{}:flags=lanczos+accurate_rnd+full_chroma_int",
            config.target_height
        ));
        filters.push("format=yuv420p".to_owned());
    }

    // 3. Máscara de enfoque sobre la resolución final. Solo luma: enfocar la
    // croma agrega flecos de color en los bordes duros.
    if config.unsharp_amount > 0.001 {
        let size = normalize_unsharp_size(config.unsharp_size);
        let amount = config.unsharp_amount.clamp(0.0, 3.0);
        filters.push(format!(
            "unsharp=luma_msize_x={size}:luma_msize_y={size}:luma_amount={amount:.2}"
        ));
    }

    // 4. Curva S de micro-contraste. Los extremos quedan fijos (0/0 y 1/1)
    // para no recortar información; se mueven los cuartos.
    if config.curve > 0 {
        let strength = f32::from(config.curve.clamp(1, 100)) / 100.0;
        let shadow = 0.25 - 0.12 * strength;
        let highlight = 0.75 + 0.12 * strength;
        filters.push(format!(
            "curves=master='0/0 0.2500/{shadow:.4} 0.7500/{highlight:.4} 1/1'"
        ));
    }

    // 5. Grano de película, al final: así el enfoque no lo amplifica.
    if config.grain > 0.05 {
        let amount = (config.grain.clamp(0.0, 3.0) * 2.2).round().clamp(1.0, 8.0);
        filters.push(format!("noise=alls={amount:.0}:allf=t+u"));
    }

    filters
}
