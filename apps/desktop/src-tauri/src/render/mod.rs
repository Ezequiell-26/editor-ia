//! Native render pipeline. The desktop app uses this module directly; the
//! TypeScript worker remains the independently tested wire contract.

pub mod effect_recipes;
pub mod export_tools;
pub mod ffmpeg;
pub mod lifecycle;
pub mod lossless;
pub mod motion;
pub mod queue;
pub mod subtitles;
