# 2026-11-05 — Pasada de limpieza del backend Rust

## Contexto

Segunda revisión del backend pedida por el usuario ("revisa de nuevo y mejora
todo el backend"). El árbol tenía trabajo de UI del usuario sin commitear
(rediseño Filmora en curso); sólo se tocaron archivos `src-tauri`.

## Cambios (sólo warnings, sin cambio de comportamiento)

- Imports sin usar eliminados: `automation.rs` (Path), `background.rs`
  (BufReader), `convert.rs` (Child), `diarize.rs` (Deserialize),
  `flow_profiles.rs` (json), `narration.rs` (PathBuf), `otio.rs` (PathBuf),
  `voice_clone.rs` (PathBuf y TcpStream en test), `image_sense.rs` (test).
- `unused_mut`: `downloader.rs` request, `proxies.rs` map.
- `private_interfaces`: `denoise_filter` y `build_dub_filter` pasaron de
  `pub(crate)` a `fn` (sólo se usan en su módulo).
- Dead code eliminado: `available_codecs`, `available_audio`, `text`
  (export_tools.rs), `safe_stem` (media_tools.rs), campos `kind`/`bytes` de
  structs internas en proxies.rs.
- `#[cfg(test)]` en helpers sólo usados por tests: `cinematic_filter`,
  `pipeline_filter`, `fast_cinematic_filter`, `cinematic_video` y los métodos
  `master_original_audio`/`preserves_original_audio_without_voice` — salen
  del binario release.
- Cosméticos: snake_case en bindings Bezier de ffmpeg.rs, paréntesis en
  upscale.rs, doc-comment en macro thread_local! (downloader.rs),
  `eq_ignore_ascii_case` (service.rs), `sort_by_key(Reverse)`
  (youtube_analytics.rs), `contents.len()` (storage.rs), forma equivalente
  de la guarda en `bitrate_for_target` (convert.rs).

## Verificación

- `cargo check`: **0 warnings** (antes ~35 en lib, 111 en clippy total).
- `cargo test --lib`: **568 passed / 0 failed / 49 ignored**.

## Notas

- `commands/voice-isolation.rs` sigue siendo código muerto fuera de
  compilación (nombre con guion no puede ser módulo; sólo referenciado en un
  comentario de lib.rs). `build_voice_isolation_filter` devuelve un filtro
  placeholder que no hace nada. Pendiente decisión: implementar de verdad o
  eliminar el archivo.
- Los warnings restantes en build de tests de lib.rs (single-instance/tray)
  son esperados: esas funciones sólo se usan en el binario real.
