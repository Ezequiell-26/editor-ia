#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameRequest {
    pub project: Value,
    pub clip_id: String,
    pub frame: u64,
    /// Pide el frame a la resolución nativa del medio, no a la del lienzo.
    #[serde(default)]
    pub native: bool,
    /// Compone todas las pistas y subtítulos. Por defecto sí; `false` fuerza
    /// el clip aislado y `native` siempre usa el clip a su resolución.
    #[serde(default)]
    pub composite: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub frame: u64,
    pub time_seconds: f64,
    pub clip_id: String,
    pub clip_label: String,
    /// `true` si el PNG quedó a la resolución real del medio.
    pub native: bool,
    /// `video-rs` cuando el frame se decodificó en proceso; `ffmpeg` cuando
    /// se usó el ejecutable (rotación, SAR no cuadrado o fallback).
    pub decoder: String,
    /// `true` si el PNG es el compuesto de todas las pistas visibles.
    pub composite: bool,
    /// `window` renderiza sólo el frame activo; `full` recorre la timeline
    /// completa (transiciones no congelables, como un tipo desconocido);
    /// `none` es el clip suelto.
    pub composite_mode: String,
    /// Pistas visuales con al menos un clip activo en el frame.
    pub visible_tracks: usize,
    /// `true` si hay un cue de subtítulos activo en el frame.
    pub captions_burned: bool,
    /// Explica por qué se devolvió el clip suelto en lugar del compuesto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
}
