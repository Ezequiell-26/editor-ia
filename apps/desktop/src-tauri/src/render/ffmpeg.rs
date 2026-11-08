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

pub use audio::BuildPlanInput;
pub(super) use audio::{audio_filter, track_audio_filters};
pub(super) use execution::{
    effective_min_output_bytes, parse_progress_time, probe_output, verify_probe_payload,
};
pub use execution::{execute_sync, progress_from_line, sanitize_log, spawn, verify_output};
pub use plan::build_plan;
pub(crate) use plan::{build_plan_range, expand_compounds, expand_compounds_con_pistas};
pub(crate) use probe::encoder_works;
pub use probe::{detect_hardware, detect_hardware_cached, hardware_h264, HardwareEncoders};
pub(super) use profile::{
    audio_encoder_for, available_encoders, choose_encoder, encoder_probe_target,
    hardware_encoder_args, number, pixel_format_for, sibling_ffmpeg, software_encoder_for,
    software_video_args, text, validate_hardware_encoder, ENCODER_CACHE, HARDWARE_AV1,
    HARDWARE_H264, HARDWARE_HEVC, HARDWARE_VP9, SOFTWARE_AV1, SOFTWARE_H264, SOFTWARE_H265,
    SOFTWARE_VP9,
};
pub(crate) use profile::{encoder_names, software_encoder};
pub use profile::{parse_profile, Profile, RenderPlan, RenderProgress, RenderVerification};
pub(super) use visual::{
    adjustment_filters, animation_duration_seconds, animation_fade_filters,
    animation_overlay_terms, animation_progress, apply_lut_to_chain_gated, audio_params_at,
    audio_stack_keyframe_instances, audio_stack_segment_plan, bezier_segment_expression,
    blend_mode_name, build_audio_stack_graphs, cubic_bezier_progress, curve_bezier_progress,
    curve_ease, curve_has_slow, curve_knots, curve_mean, curve_optical_flow_fps, curve_sample,
    curve_setpts, curve_setpts_with, curve_source_fraction, custom_curves_filter, effect_ease,
    effect_instance_body, effect_keyframe_tracks, effect_params_at, even_fit, fill_audio_template,
    fill_recipe_template, format_recipe_value, grade_filters, has_audio_stream, hex_color,
    hex_rgb01, instance_keyframe_tracks, keyframe_expression, lut_filter, mask_filter,
    motion_blur_weights, offset_expression, opacity_commands, overlay_x_expression,
    overlay_y_expression, parse_curve_bezier, parse_easing, parse_speed_curve, perspective_filter,
    project_look_filters, resolve_stabilization, sample_effect_track, sanitize_filter_number,
    scale_dynamic_expression, scale_zoom_expression, seconds, stabilization_filter, text_mask_font,
    tone_curve_filter, trim_number, wipe_alpha_expr, wipe_frozen_filter, wipe_geq,
    wipe_transition_filter, with_stabilization, without_lut, AudioStackPlan, CurveBezier,
    CurvePoint, EffectParamTrack, SegmentEasing, TrackPanAutomation, BEZIER_PIECES,
    CURVE_INTEGRAL_STEPS, CURVE_MAX_EXPRESSION_CHARS, CURVE_MAX_KNOTS, MAX_AUDIO_STACK_SEGMENTS,
    MAX_EFFECT_SEGMENTS, MAX_OPACITY_COMMANDS,
};
pub(crate) use visual::{
    alpha_video_decoder, apply_audio_effect_stack, apply_effect_stack, apply_effect_stack_animated,
    apply_glow_to_chain, apply_lut_to_chain, drawtext_text, eased_fraction, effects_lut,
    transition_lead_seconds, visual_filter,
};

#[cfg(test)]
mod tests;

#[cfg(test)]
mod encoder_tests;
