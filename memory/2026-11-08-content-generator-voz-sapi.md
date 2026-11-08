# 2026-11-08 — ContentGenerator de voz local (SAPI) en el pipeline de producción

## Qué se hizo

- `infrastructure/studio/local_voice.rs`: `LocalVoiceGenerator` implementa el
  puerto `ContentGenerator` (ports/studio.rs) para `kind: voice`/`audio`.
  Sintetiza con System.Speech de Windows vía PowerShell (`-NoProfile`, texto
  por stdin, salida WAV en `EDITORIA_TTS_OUT`), sin red y coste 0.
- `project_executor.rs::acquire_stage`: los requisitos `kind: voice` se
  desvían del loop de adquisición y van a `acquire_voice`, que genera un WAV
  por `max_count` y lo registra con `register_generated_asset` (ffprobe para
  `media.*`, `sha256_file`, provenance `origin: generated-locally`,
  `provider: windows-sapi`, licencia `user-generated`/`commercialUse: allowed`).
- `assembly_executor.rs::candidates_for_scene`: el requisito `voice` busca en
  el catálogo como `Audio` (los assets de voz se registran `kind: audio`).
- `local_voice.rs::generate` acepta `voice`/`audio`; capabilities declara sólo
  `Voice` a coste 0, `requires_network: false`.

## Evidencia

- `cargo test --lib`: **753 passed / 0 failed / 58 ignored**.
- Live `live_synthesize_writes_a_real_wav` (`EDITOR_IA_RUN_LIVE_TESTS=1`):
  WAV RIFF real en 0,87 s.
- Live `acquire_voice_generates_registers_and_indexes_asset`
  (`EDITOR_IA_RUN_LIVE_TESTS=1` + `EDITOR_IA_FFPROBE` real): requisito voice →
  SAPI → ffprobe → asset `audio` en `project.json` → `LocalProjectCatalog`
  resuelve con `durationFrames > 0`. 3,42 s.

## Notas de entorno

- `cargo` directo falla por ACL en `D:\DevCache\Rust\cargo\registry\src`
  (sólo Administrators/SYSTEM escriben). Usar
  `node scripts/rust-env.mjs -- cargo ...`, que resuelve MSVC + FFmpeg dev +
  libclang y cae a un `CARGO_HOME` escribible.
- `ProjectError` no implementa `Display`; usar `.message` en asserts.

## E2E con narración (misma sesión)

- `production_e2e_voice_narration_runs_all_stages` en `render_executor.rs`
  (ignorado, `EDITOR_IA_RUN_RENDER_TESTS=1`): plan con `req-video` local +
  `req-voice` → 8 etapas → `done` en ~14 s. El WAV de SAPI quedó montado como
  clip `audio` y el MP4 se entregó con manifest.
- Ojo: para los E2E usar el `ffmpeg`/`ffprobe` del PATH (chocolatey, tiene
  libx264); el bundle LGPL de `D:\DevCache\ffmpeg-n9.0-lgpl` NO tiene libx264
  y el fixture lavfi falla con "Unknown encoder 'libx264'".

## Voz configurable por requisito (misma sesión)

- `ResourceRequirement` ganó `voice?: string` (TS `studio.ts` + espejo Rust
  `plan.rs`, serde camelCase, `skip_serializing_if`). `acquire_voice` lo pasa
  a `GenerationRequest.voice` → `EDITORIA_TTS_VOICE` → `SelectVoice` de SAPI.
  Las fuentes de adquisición lo ignoran. La UI todavía no lo expone.

## Selector de voz en UI + recurrencia del symlink (misma sesión)

- `AutonomousRunsPanel`: `<select>` de voces (`service.listVoices`, SAPI) +
  `buildProductionPlanFromProject(project, objective, now, { voice })`.
  Con voz elegida, cada escena con `narrationText` genera un requisito
  `req-voz-<scene>` kind `voice` y una `PlanScene` `voz-<scene>` adicional
  (una escena = un asset; la narración viaja como escena de audio propia,
  mismo patrón del E2E). Intent del enum es `explainer` (no existe
  'narración' en `SceneIntentSchema`).
- **El symlink `node_modules/@editor-ia/project-schema` volvió a apuntar al
  repo hermano** (cambio del 8/11 18:09, probablemente un `npm install`).
  Repuntado con junction de Windows a `packages/project-schema` de ESTE
  worktree. Si `tsc`/vitest vuelven a quejarse de exports faltantes
  (`createEmptyProductionPlan`, `StudioStage`), revisar ese enlace primero.

## Pendiente


- Selector de voz en la UI del plan (hoy el campo existe pero nadie lo setea).
- `ContentGenerator` para imagen/vídeo/música cuando haya providers reales.
- Voz/idioma configurables por plan (hoy `voice: None` = voz por defecto).
