# 2026-10-13 — Oleada 10: vendor deps, local_sfx, splits ronda 3

## Resultados

1. **Vendor deps** (`6af53d4b`): concat-render/text/log/core/project
   fuera del Cargo.toml app → Cargo.lock 645→590 (−55, wgpu/naga/
   rustybuzz/tiny-skia fuera). vendor_concat.rs 174→23 (solo speech).
   Tests seam cubiertos por suites vendor. 1071/1071 lib tests.
   Fallos vendor preexistentes: concat-media (encoder FFmpeg entorno),
   concat-text (fuente emoji sistema).

2. **local_sfx + Graphic** (`e09b76fd`): port 1:1 de generate-sfx.mjs a
   Rust std-only (LCG, osciladores, filtros, WAV 44.1kHz). 8 presets,
   `sfx` → supported en capability matrix. `graphic` soportado vía
   titlecard/pattern (2 capabilities por generator). video/audio/
   animation permanently unsupported. 6/6 + 111 studio tests.
   Límite: presets de catálogo, no síntesis libre por prompt.

3. **project-actions ronda 3** (`d4aa1d40`): scene-actions.ts. 3797→3599.

4. **Inspector ronda 3** (`1be980a7`): ClipAnimationSection.tsx. 7999→7741.

## Estado

- Build graph sin wgpu → compiles más rápido.
- Capability matrix: solo video/audio/animation unsupported (decisión ADR).
- God-files: project-actions 3599, Inspector 7741 — siguen siendo grandes
  pero cada extracción es más difícil (clips/trims ~1750 líneas es el
  bloque grande restante en project-actions).
- Pendiente: commit (WIP ~740 archivos), install smoke, checkout limpio
  post-commit, ADR-0005 caduca 2026-12-11.
