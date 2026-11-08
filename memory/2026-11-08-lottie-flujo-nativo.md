# 2026-11-08 — Ítem 22: flujo Lottie nativo ejercitado de punta a punta

## Estado encontrado

- `.lottie` (ZIP): ya implementado en `features/motion/lottie.ts`
  (`extractLottieZip` con `fflate`, búsqueda en `animation.json`,
  `animations/*.json`, `data.json` y cualquier `.json` raíz) y cubierto
  por `lottie.test.ts` (18 tests) + `LottiePanel.test.tsx` (3).
- Rust: `write_alpha_frames` / `alpha_frames_to_asset` /
  `encode_sequence` / `build_asset` existían; el live
  `encodes_a_sequence_with_real_alpha` ya codificaba y probeaba un WebM
  pero sin pasar por el comando ni por la importación al proyecto.

## Cambio

`commands/domains/media/lottie.rs`: la lógica de
`alpha_frames_to_asset` se movió a `alpha_frames_to_asset_impl(&AppState,
…)`; el `#[tauri::command]` queda como wrapper que desreferencia
`State<AppState>`. Mismo patrón que el resto de la arquitectura
hexagonal: la costura permite testear sin levantar Tauri.

Test nuevo `converts_written_frames_into_an_imported_webm_asset`
(`#[tokio::test]`, gated por `EDITOR_IA_RUN_RENDER_TESTS=1`):

1. Construye un `AppState` real (sesión con `Session::new`, settings por
   defecto, dirs temporales).
2. Escribe 6 frames PNG por `write_alpha_frames` en dos lotes (el mismo
   comando IPC que usa el frontend).
3. Llama `alpha_frames_to_asset_impl` → devuelve el asset JSON.
4. Verifica `kind=video`, `media.alpha=true`, `durationFrames=6`,
   `provenance.origin=generated-locally`, y que `source.path` existe en
   el `media/` del proyecto.
5. Probea el WebM importado con ffprobe real: `alpha_mode=1`,
   `width=64`, `height=64`, `nb_read_frames=6`.
6. Verifica que la secuencia temporal y el WebM intermedio se borraron.

## Verificación

- `cargo test --lib lottie` con `EDITOR_IA_RUN_RENDER_TESTS=1`:
  **5/5** (1.24 s).
- `cargo check --tests`: 0 errores (21 warnings preexistentes).
- `cargo fmt --check`: limpio.
- vitest `lottie.test.ts` + `LottiePanel.test.tsx`: **21/21**.

## Límite honesto

El transporte IPC serde del comando (serialización de `State` y del
`Value` de retorno por el bridge de Tauri) no se ejercitó — eso requiere
la app nativa corriendo. Todo lo que hay detrás del wrapper quedó
cubierto con FFmpeg y ffprobe reales.
