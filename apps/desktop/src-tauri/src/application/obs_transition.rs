//! Transiciones OBS: spec pura y filtergraph para conmutar entre dos
//! escenas en vivo dentro de UN proceso ffmpeg.
//!
//! Modelo: cada escena es una "rama" de fuentes (pantalla gdigrab y/o
//! webcam dshow con PiP y chroma key opcional) capturada en simultáneo,
//! compuesta a un canvas común y unida con `xfade` — la transición
//! arranca a los `lead_secs` y dura `duration_secs`; `tail_secs` define
//! cuánto de la escena destino queda grabada. La salida es un MP4 finito
//! (`-t total`), no una sesión abierta.
//!
//! Alcance honesto: cursor overlay y streaming RTMP no aplican (el
//! comando que los use debe rechazarlos); el audio es una entrada única
//! opcional decidida por el comando.

use crate::projects::service::{ProjectError, ProjectErrorCode};

/// Transiciones soportadas por `xfade` de ffmpeg (subset curado y
/// estable entre versiones — los nombres son los del filtro, no inventados).
pub const TRANSITION_KINDS: &[&str] = &[
    "fade",
    "fadeblack",
    "fadewhite",
    "wipeleft",
    "wiperight",
    "wipeup",
    "wipedown",
    "slideleft",
    "slideright",
    "slideup",
    "slidedown",
    "circleopen",
    "circleclose",
    "vertopen",
    "vertclose",
    "horzopen",
    "horzclose",
    "diagtl",
    "diagtr",
    "diagbl",
    "diagbr",
    "hlslice",
    "hrslice",
    "vuslice",
    "vdslice",
    "dissolve",
    "pixelize",
    "radial",
    "smoothleft",
    "smoothright",
    "smoothup",
    "smoothdown",
];

pub const DEFAULT_TRANSITION_KIND: &str = "fade";
pub const MIN_TRANSITION_SECS: f64 = 0.1;
pub const MAX_TRANSITION_SECS: f64 = 30.0;
pub const MAX_LEAD_SECS: f64 = 3600.0;
pub const MAX_TAIL_SECS: f64 = 3600.0;
pub const MAX_TOTAL_SECS: f64 = 7200.0;
pub const DEFAULT_WIDTH: u32 = 1920;
pub const DEFAULT_HEIGHT: u32 = 1080;
pub const MIN_CANVAS: u32 = 16;
pub const MAX_CANVAS_W: u32 = 7680;
pub const MAX_CANVAS_H: u32 = 4320;

/// Una rama de la transición: los índices de entrada ffmpeg de sus
/// fuentes y la cadena de chroma key ya validada de la webcam (si hay).
/// `screen`/`webcam` son `None` cuando la escena no usa esa fuente.
#[derive(Debug, Clone, Default)]
pub struct TransitionBranch {
    pub screen: Option<usize>,
    pub webcam: Option<usize>,
    /// Cadena `chromakey=…,format=yuva420p` de `WebcamChromaSpec`, ya
    /// validada — se inserta antes del scale de la webcam.
    pub webcam_chroma: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ObsTransitionSpec {
    pub kind: String,
    /// Segundos de escena A antes de que arranque la transición.
    pub lead_secs: f64,
    /// Duración del fundido/wipe entre A y B.
    pub duration_secs: f64,
    /// Segundos de escena B después de la transición.
    pub tail_secs: f64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

fn invalid(message: &str) -> ProjectError {
    ProjectError::message(ProjectErrorCode::InvalidProject, message)
}

impl ObsTransitionSpec {
    pub fn new(
        kind: Option<String>,
        lead_secs: Option<f64>,
        duration_secs: Option<f64>,
        tail_secs: Option<f64>,
        width: Option<u32>,
        height: Option<u32>,
        fps: Option<u32>,
    ) -> Result<Self, ProjectError> {
        let spec = Self {
            kind: kind.unwrap_or_else(|| DEFAULT_TRANSITION_KIND.to_owned()),
            lead_secs: lead_secs.unwrap_or(2.0),
            duration_secs: duration_secs.unwrap_or(1.0),
            tail_secs: tail_secs.unwrap_or(2.0),
            width: width.unwrap_or(DEFAULT_WIDTH),
            height: height.unwrap_or(DEFAULT_HEIGHT),
            fps: fps.unwrap_or(30),
        };
        spec.validate()?;
        Ok(spec)
    }

    pub fn validate(&self) -> Result<(), ProjectError> {
        if !TRANSITION_KINDS.contains(&self.kind.as_str()) {
            return Err(invalid(&format!(
                "transición no soportada; usá una de: {}",
                TRANSITION_KINDS.join(", ")
            )));
        }
        let finite = |v: f64| v.is_finite();
        if !finite(self.lead_secs) || self.lead_secs < 0.0 || self.lead_secs > MAX_LEAD_SECS {
            return Err(invalid("leadSecs debe ser un número entre 0 y 3600"));
        }
        if !finite(self.duration_secs)
            || !(MIN_TRANSITION_SECS..=MAX_TRANSITION_SECS).contains(&self.duration_secs)
        {
            return Err(invalid("durationSecs debe ser un número entre 0.1 y 30"));
        }
        if !finite(self.tail_secs) || self.tail_secs < 0.0 || self.tail_secs > MAX_TAIL_SECS {
            return Err(invalid("tailSecs debe ser un número entre 0 y 3600"));
        }
        if self.total_secs() > MAX_TOTAL_SECS {
            return Err(invalid(
                "la transición completa no puede superar 7200 segundos",
            ));
        }
        if self.width < MIN_CANVAS
            || self.height < MIN_CANVAS
            || self.width > MAX_CANVAS_W
            || self.height > MAX_CANVAS_H
        {
            return Err(invalid("width/height del canvas no son válidos"));
        }
        if !(1..=60).contains(&self.fps) {
            return Err(invalid("fps debe ser un entero entre 1 y 60"));
        }
        Ok(())
    }

    /// Duración total del MP4: lead + transición + tail.
    pub fn total_secs(&self) -> f64 {
        self.lead_secs + self.duration_secs + self.tail_secs
    }

    /// `-t` para acotar la salida (redondeo hacia arriba a centésimas para
    /// no cortar el último frame de la transición).
    pub fn total_arg(&self) -> String {
        format!("{:.2}", (self.total_secs() * 100.0).ceil() / 100.0)
    }

    /// Cadena que normaliza una rama ya compuesta al canvas/fps/formato
    /// que `xfade` exige (mismo tamaño, fps, pix_fmt y timebase).
    fn normalize_suffix(&self) -> String {
        format!(",setsar=1,fps={},format=yuv420p,settb=AVTB", self.fps)
    }

    /// Filtergraph de UNA rama: compone pantalla+webcam (PiP abajo-derecha,
    /// igual que `screen_record_start`) o una sola fuente, y la deja
    /// normalizada con la etiqueta `[tag]`.
    fn branch_chain(&self, branch: &TransitionBranch, tag: &str) -> Result<String, ProjectError> {
        let w = self.width;
        let h = self.height;
        let screen_scale = format!(
            "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2"
        );
        let suffix = self.normalize_suffix();
        match (branch.screen, branch.webcam) {
            (Some(s), Some(c)) => {
                // La coma separadora del chroma sólo existe si hay cadena:
                // `[c:v],scale=…` sin chroma sería un filtro vacío inválido.
                let cam = match branch.webcam_chroma.as_deref() {
                    Some(chroma) => {
                        format!("[{c}:v]{chroma},scale='min(320,iw)':-2[bw{tag}]")
                    }
                    None => format!("[{c}:v]scale='min(320,iw)':-2[bw{tag}]"),
                };
                Ok(format!(
                    "[{s}:v]{screen_scale}[bs{tag}];{cam};[bs{tag}][bw{tag}]overlay=W-w-24:H-h-24{suffix}[{tag}]"
                ))
            }
            (Some(s), None) => Ok(format!("[{s}:v]{screen_scale}{suffix}[{tag}]")),
            (None, Some(c)) => {
                let cam = match branch.webcam_chroma.as_deref() {
                    Some(chroma) => format!("[{c}:v]{chroma},{screen_scale}"),
                    None => format!("[{c}:v]{screen_scale}"),
                };
                Ok(format!("{cam}{suffix}[{tag}]"))
            }
            (None, None) => Err(invalid(
                "una escena de la transición no tiene ninguna fuente de video",
            )),
        }
    }

    /// `filter_complex` completo para dos ramas: cada una compuesta y
    /// normalizada, unidas por `xfade` con salida etiquetada `[v]`.
    pub fn filtergraph(
        &self,
        from: &TransitionBranch,
        to: &TransitionBranch,
    ) -> Result<String, ProjectError> {
        let a = self.branch_chain(from, "a")?;
        let b = self.branch_chain(to, "b")?;
        Ok(format!(
            "{a};{b};[a][b]xfade=transition={kind}:duration={dur}:offset={off}[v]",
            kind = self.kind,
            dur = self.duration_secs,
            off = self.lead_secs,
        ))
    }
}

#[cfg(test)]
#[path = "obs_transition.tests.rs"]
mod tests;
