# 2026-11-08 — Catálogo de transiciones de VisualsView al día (Editor IA)

Pasada del protocolo del loop (Devin CLI). Sin cambios en el renderer:
`wipe-*`, `iris` y `slide-3d-*` ya exportaban y se previsualizaban; el hueco
era de catálogo/UI.

## Brecha

`catalog_transitions()` en `commands/visuals.rs` (la fuente medida que
consume `VisualsView` → `list_visual_catalog`) tenía 11 transiciones y no
incluía `slide-3d-*` (agregadas al renderer el mismo día), `wipe-*` ni
`iris`: la vista de aplicación por lote no podía ofrecer 10 de los 18 tipos
del `ClipTransitionSchema`. Además:

- `slide-3d-*.svg` e `iris.svg` no existían en
  `apps/desktop/public/thumbnails/transitions/` → las tarjetas pedían un
  fondo vacío.
- `FALLBACK_VISUAL_CATALOG` (`features/visuals/visuals.ts`, modo navegador /
  servicio caído) ni siquiera tenía las `slide-3d-*` (7 entradas vs 11 del
  backend).

## Cambio

- `visuals.rs`: +`wipe-left|right|up|down`, +`iris` (los 6 aplicables por
  lote con `{type, frames}`). `dip-color` y `luma-wipe` excluidos a
  propósito (exigen `color`/`mateClipId`); comentario en el código.
- `visuals.ts`: fallback espejo del backend → 17 transiciones.
- Tests: lista esperada del test de unicidad Rust y del test TS actualizadas
  a las 17.
- Thumbnails: `iris.svg` (círculo propio) + `slide-3d-{left,right,up,down}.svg`
  (placeholder idéntico al resto del directorio).

## Verificación

- `cargo test -p editor-ia-desktop --lib commands::visuals` → **6/6**.
- `npx vitest run src/features/visuals/visuals.test.ts` → **4/4**.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.
- `rustfmt --edition 2021 --check visuals.rs` → limpio.

## Pendiente honesto

`dip-color`/`luma-wipe` siguen Inspector-only; ofrecerlos en VisualsView
requiere selector de color y picker de mate por clip (trabajo aparte).
