# 2026-11-08 — Receta FFmpeg para `blur.zoom` (Editor IA)

Pasada del loop de mejora (Devin CLI). Segundo efecto «sólo preview» del
catálogo en cerrar (`docs/DRIFT-PARITY.md` §5), tras `impact.zoom_pulse`.

## Qué se hizo

`blur.zoom` (desenfoque radial hacia `center`) ganó receta `ffmpeg.graph`
en `packages/effect-kit/src/catalog/video.ts`:

- El shader promedia `samples` lecturas `ek_sample(center + dir·(1-amount·t))`.
- FFmpeg no itera: se fijan **6 tomas** `t ∈ {0, 0.2, …, 1}`.
- `split=12` → 6 bases (WxH) + 6 copias escaladas por `1/(1-amount·t)`
  (`scale` con guarda `max(…,0.05)` para `amount=1`).
- Cada copia se monta con `overlay x='{center.x}*(W-w)'` — el mismo ancla
  deducida que `zoom_pulse` — y las 6 salidas WxH se promedian par a par
  con `blend=all_mode=average` (el modo `average` existe en `blend`,
  verificado con `ffmpeg -h filter=blend` del n9.0 empaquetado).
- `npm run effects:codegen` regeneró `effect_recipes.rs` → **72 recetas**.

## Verificación (ejecutada)

- FFmpeg real sobre `testsrc2` 320×180: 50 frames/25 fps sin error.
- Diff entrada/salida (`blend=difference` + `signalstats`): **YAVG 4,38**
  en el centro vs **78,65** (esquina sup-izq) y **54,75** (inf-der) — blur
  radial correcto (centro nítido, bordes movidos).
- `cargo test -p editor-ia-desktop --lib effect_stack` → **6/6**
  (+test `effect_stack_expands_blur_zoom_graph_with_filled_params`).
- vitest effect-kit **36/36** · vitest vfx desktop **26/26**.
- `tsc --noEmit` desktop **0**; `tsc` effect-kit: los **4 errores
  preexistentes** del WIP del usuario en `engine.test.ts` (sin relación).

## Límites honestos

- `fidelity: 'approximate'`: 6 tomas fijas (el parámetro `samples` sólo
  aplica al preview), remuestreo de `scale` y no de `ek_sample`.
- Coste por frame: 12 vías + 6 scale + 6 overlay + 5 blend — más caro que
  un filtro simple; aceptable para un efecto opt-in.
- Quedan **6 preview-only**: `light.leak`, `light.flare`,
  `stylize.halftone`, `glitch.wave`, `distort.ripple`, `distort.twirl`.
  `glitch.wave` es el próximo candidato natural (`geq` por fila);
  `distort.*` son los más difíciles.

## Estado del árbol

- **Commiteado**: `catalog/video.ts`, `effect_recipes.rs` (codegen),
  `docs/DRIFT-PARITY.md`, `docs/IMPROVEMENT-QUEUE.md`, esta memoria.
- **Sin commitear**: el test nuevo en `ffmpeg.rs` — el archivo mezcla
  ~1200 líneas de WIP concurrente del usuario (misma situación que la
  pasada de `zoom_pulse`).
