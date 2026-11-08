# 2026-11-08 · Transición `iris` + fix de borde en wipes

Pasada del loop de mejora (Devin CLI). Continúa la cola de transiciones
Kdenlive (`docs/KDENLIVE-REFERENCE.md` §4).

## Qué se hizo

- **`iris`**: transición nueva en `ClipTransitionSchema`. Reusa la
  infraestructura `geq` de los wipe: máscara circular que crece desde el
  centro (`dist² < p²·R²`) con guard `gt(p,0.999)` para abrir los
  vértices exactos al cerrar el lead. Export en `visual_filter`, preview
  congelado `mode:"wipe",kind:"iris"`, opción en Inspector, preset en
  EditorAssets (17 tarjetas, grupo «Iris» propio en el árbol), label en
  Timeline, whitelist de `visuals.rs`.
- **Fix**: `wipe-left`/`wipe-up` pasaron de `gt` a `gte` — con `p=1` la
  columna `X=0` / fila `Y=0` quedaba transparente para siempre.

## Verificación

- `cargo test --lib transition` → 8/8 (asserts nuevos de `geq` radial e
  iris congelado; bloque iris en `window_freezes_fades_and_transition_leads`).
- `tsc --noEmit` desktop → 0 errores.
- project-schema → 373/373 (JSON Schema regenerado).
- vitest `EditorAssets`/`Timeline`/`project-actions` → 137/137.
- Smoke FFmpeg real (build LGPL local): el `geq` parsea y corre; alfa
  medida YAVG=115,3/255 ≈ 45 % a progreso 0,5 en 64×36 (esperado ~46 %).
- `transition_leads_use_the_window_and_match_full` sigue `ignored`: el
  FFmpeg dev local no trae `libx264` (build LGPL shared).

## Archivos

`packages/project-schema/src/timeline.ts` + schema regenerado,
`render/ffmpeg.rs`, `commands/preview_frame.rs`, `commands/visuals.rs`,
`Inspector.tsx`, `Timeline.tsx`, `EditorAssets.tsx` (+test),
`docs/KDENLIVE-REFERENCE.md`, `docs/IMPROVEMENT-QUEUE.md`.

## Pendiente

`luma-wipe` sigue sólo en Inspector (no en presets ni catálogo);
mate animado en preview del monitor sigue congelado como el resto de
transiciones.
