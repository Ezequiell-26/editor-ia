//! Preview real de un frame.
//!
//! Por defecto compone el frame con el mismo plan del render final: todas las
//! pistas visuales, capas de ajuste, look global y subtítulos. Si el compuesto
//! no se puede armar (por ejemplo, clips gráficos sin plan de motion) cae al
//! clip visual seleccionado, que conserva color, máscara, relight, lente, LUT y
//! transformación. En ambos casos se usa el mismo `visual_filter` del export,
//! sin escribir un MP4. El frame nativo (`native: true`) sigue siendo el clip
//! a la resolución del medio para inspección 1:1.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::hide_console;
use crate::commands::system::resolve_tools;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::ffmpeg::{
    alpha_video_decoder, apply_lut_to_chain, build_plan, camera_lut_path, effects_lut,
    prepare_frame_input, visual_filter_with_format,
    BuildPlanInput, Profile,
};
use crate::render::motion::has_visible_graphic_clips;
use crate::state::AppState;

// La ventana de un frame (reencuadre de timeline, transiciones/animaciones
// congeladas) es dominio puro y vive en `render::preview_window`; este
// re-export mantiene los nombres para composite.rs y los tests.
pub(crate) use crate::render::preview_window::{
    composite_metadata, preview_copy, project_fps, timeline_frames, window_project,
};
include!("preview_frame/types.rs");
include!("preview_frame/cache.rs");
include!("preview_frame/decode.rs");
include!("preview_frame/graph.rs");
include!("preview_frame/composite.rs");
include!("preview_frame/render.rs");
include!("preview_frame/command.rs");

#[cfg(test)]
#[path = "preview_frame.tests.rs"]
mod tests;
