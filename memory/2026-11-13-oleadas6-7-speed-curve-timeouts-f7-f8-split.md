# 2026-11-13 — Oleadas 6+7: speed_curve UI, timeouts FFmpeg, F7 paths, F8 toolchain, split project-actions, auditoría PDF

## Oleada 6

1. **speed_curve UI** (`9e5cc3a2`): toggle constante/curva por clip en
   `ConcatWorkerExportPanel` — puntos at/speed/slope, validación local
   (≥2, ≤16, at creciente 0-1, speed>0), serialización `speed_curve`.
   12/12 tests, tsc limpio. Sin preview visual de la curva (pendiente).

2. **Timeouts FFmpeg** (`4c13e307`): `MediaRunner` ganó
   `run_ffmpeg_with_timeout`/`run_ffprobe_with_timeout`; deadlines
   proporcionales (5× realtime, piso 2min, techo 3h análisis / 120s probe /
   30s tool-check). Migrados: detect_scenes, VMAF, stabilization,
   intelligence, probes, conversion. Exports largos SIN deadline a
   propósito. **Regresión que corregí yo**: las constantes quedaron en
   `infrastructure/process.rs` y `application` las importaba directo →
   movidas a `ports/media.rs` (re-export en infra para sus callers).
   180/180 tests del área.

3. **Inspector ronda 2** (`d9be7fa2`): sección chroma key →
   `inspector/ChromaKeySection.tsx`. Inspector.tsx 8072→7999.

4. **Auditoría PDF** (`384a232b`): matriz F0-F12 verificada contra código.
   F5 P0 compounds CERRADO. Top 10 priorizado generado.

## Oleada 7 (top 10 del audit)

5. **F7 rutas absolutas IPC** (`db6b8482`): política denylist de
   credenciales/sistema (`resolve_user_file_path` /
   `validate_user_write_path` en `application/fs.rs`) aplicada a 13
   puntos de entrada (conversion, media_analysis, loudness, peaks,
   scopes, diarize, voice_isolate, subtitles_pipeline, best_frame,
   timeline_import, thumbnail). Tests negativos por comando. 50+221
   tests verdes. Deuda residual: ~14 comandos más con rutas absolutas
   (denoise, dialogue, upscale, lip_sync, etc.) — segunda pasada.

6. **F8 toolchain+clippy** (`95bf7687`): `rust-toolchain.toml` pineado a
   1.98.1; `rust-env.mjs` resuelve `RUSTUP_TOOLCHAIN` (rustup home
   read-only); step clippy en verify.yml SIN `-D warnings` (59 warnings
   preexistentes — baseline visible, endurecer a 0). ci-workflows 12/12.

7. **F2 split project-actions** (`0b6b5083`): captions/títulos →
   `state/caption-actions.ts` + primitivas → `project-actions-core.ts`.
   5468→4704 líneas (−764). API pública intacta. 267 tests verdes.

8. **Tracker/HANDOFF** (`c8f1b3fe`): `PDF-100-TRACKER.md` y `HANDOFF.md`
   reescritos con evidencia archivo:línea verificada.

## Verificación de consolidación

- architecture-rules: **13/13** (tras mi fix de ports/timeouts)
- cargo check --lib: limpio
- cargo test filtrado (media_analysis/process/conversion/export_tools/
  lossless): **59/59** incl. live FFmpeg y tests negativos de paths
- App.teclado 9/9, project-actions+relacionados 267, ConcatWorkerExport
  Panel 12/12

## Pendientes top (del audit, sin hacer)

- F12: gates en checkout limpio + install smoke.
- F6: cost_cents en providers remotos, video/SFX providers, mcp_server_stop.
- F7 residual: ~14 comandos con rutas absolutas sin política.
- F8: bajar los 59 warnings clippy a 0 → luego `-D warnings`.
- F9: baseline RSS idle/arranque + latencia MCP.
- F10: SBOM + install smoke desatendido.
- F11: AGENTS.md, gate DEPENDENCY-RULES, ADR-0005 (caduca 2026-12-11).
- F2: project-actions.ts sigue en 4704 líneas (más subdominios
  extraíbles: clips, tracks, effects, markers).
- Concat vendor crates sin consumidor productivo (concat-render wgpu,
  concat-text, concat-log, concat-project, concat-core) — decisión ADR.
- Preview visual de speed_curve en el panel.
- run_ffmpeg/run_ffprobe largos (transcodes/conversión) aún sin timeout.
