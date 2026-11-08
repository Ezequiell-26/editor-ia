//! The FFmpeg render pipeline.
//!
//! The timeline is turned into one filter graph: a background canvas, every
//! visible visual clip composited in track order, every audible clip mixed and
//! delayed, and the project captions burned through libass. The output is only
//! reported as completed after FFprobe verifies its existence, size, duration
//! and resolution.
//!
//! There is no shell: FFmpeg is spawned with an argument vector built here,
//! from validated project values and project-relative media paths.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use serde::Serialize;
use serde_json::Value;

use crate::commands::voice_isolation::isolation_stem_path;
use crate::media::resolve_inside_root;
use crate::projects::service::{ProjectError, ProjectErrorCode};
use crate::render::effect_recipes::{find as find_recipe, ParamKind, Recipe};
use crate::render::subtitles::{build_ass, CaptionInput};

mod audio;
mod execution;
mod plan;
mod probe;
mod profile;
mod visual;

pub(super) use audio::audio_filter;
pub use audio::BuildPlanInput;
pub use execution::{execute_sync, progress_from_line, sanitize_log, spawn, verify_output};
pub use plan::build_plan;
pub(crate) use plan::{build_plan_range, expand_compounds};
pub(crate) use probe::encoder_works;
pub use probe::{detect_hardware, detect_hardware_cached, hardware_h264, HardwareEncoders};
pub(super) use profile::{
    audio_encoder_for, hardware_encoder_args, number, software_encoder_for, software_video_args,
    text,
};
pub(crate) use profile::{encoder_names, software_encoder};
pub use profile::{parse_profile, Profile, RenderPlan, RenderProgress, RenderVerification};
pub(super) use visual::{
    adjustment_filters, animation_overlay_terms, apply_lut_to_chain_gated,
    audio_stack_keyframe_instances, audio_stack_segment_plan, blend_mode_name,
    build_audio_stack_graphs, curve_mean, has_audio_stream, hex_color, keyframe_expression,
    offset_expression, overlay_x_expression, overlay_y_expression, parse_speed_curve,
    perspective_filter, project_look_filters, resolve_stabilization, sanitize_filter_number,
    seconds, text_mask_font, with_stabilization, TrackPanAutomation,
};
pub(crate) use visual::{
    alpha_video_decoder, apply_audio_effect_stack, apply_effect_stack, apply_effect_stack_animated,
    apply_glow_to_chain, apply_lut_to_chain, eased_fraction, effects_lut, transition_lead_seconds,
    visual_filter, visual_filter_with_format,
};

// La superficie que consumen los tests vía `use super::*` (`tests.rs`,
// `encoder_tests.rs`): en el build de lib estos nombres no se usan y por eso
// viven bajo `cfg(test)` — así el lib queda sin warnings sin romper la suite.
#[cfg(test)]
pub(super) use audio::track_audio_filters;
#[cfg(test)]
pub(super) use execution::{effective_min_output_bytes, verify_probe_payload};
#[cfg(test)]
pub(crate) use plan::expand_compounds_con_pistas;
#[cfg(test)]
pub(super) use profile::choose_encoder;
#[cfg(test)]
pub(super) use visual::{
    cubic_bezier_progress, curve_knots, curve_optical_flow_fps, curve_setpts,
    curve_source_fraction, drawtext_text, effect_keyframe_tracks, mask_filter, sample_effect_track,
    scale_dynamic_expression, scale_zoom_expression, tone_curve_filter, CurvePoint,
    CURVE_MAX_EXPRESSION_CHARS,
};

#[cfg(test)]
mod tests;

#[cfg(test)]
mod encoder_tests;
