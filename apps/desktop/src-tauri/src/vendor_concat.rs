//! Seam de integración para los crates del engine de Concat vendorados en
//! `vendor/concat/` (AGPL-3.0-or-later — ver `vendor/concat/NOTICE.md`).
//!
//! Sólo expone lo que la app consume en producción: la transcripción
//! whisper.cpp in-process (`concat-speech-min`). `concat-core`,
//! `concat-project` y `concat-effects` no se re-exportan: el único uso
//! directo es `concat_effects::catalogue` en
//! `render/ffmpeg/visual/effects.rs`, y core/project entran por
//! transitividad de effects.
//!
//! `concat-text`, `concat-log` y `concat-render` quedaron vendorados pero
//! fuera del `Cargo.toml` de la app (ADR
//! `docs/decisions/2026-11-13-concat-vendor-scope.md`): ningún módulo de
//! producción los usaba y sus tests de seam se eliminaron porque el
//! workspace `vendor/concat` ya cubre `render_frame`, `plan_frame` y
//! `bytes()` con suites propias.

/// Transcripción whisper.cpp in-process (sólo `transcribe`; TTS/ONNX
/// quedaron afuera - ver vendor/concat/NOTICE.md).
pub use concat_speech_min as speech;
/// Carpeta `<data>/whisper-models` donde viven los `ggml-*.bin`
/// (re-exportado porque el crate no lo sube a su raíz).
pub use concat_speech_min::transcribe::whisper_models_dir;
