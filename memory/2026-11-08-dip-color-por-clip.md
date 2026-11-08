# 2026-11-08 — dip-color con color por clip en VisualsView

Pasada del protocolo del loop (Devin CLI). Ledger cerrado
(`loop:preflight` → `idle`); el ítem salió del «Pendiente honesto» de la
entrada dip-color/luma-wipe en `docs/IMPROVEMENT-QUEUE.md` («el lote aplica
el mismo `color` a todos los clips»).

## Qué se hizo

`VisualsView` aplicaba el `dip-color` por lote con un único `ColorSwatch`
compartido. Ahora, con más de un clip seleccionado, cada clip tiene su
propia muestra de color:

- Estado `dipColorById: Record<string, string>` — override por clip, mismo
  patrón que `mateChoice` de `luma-wipe`.
- Filas `.visuals-dip-color-row` sólo cuando `selectedClips.length > 1`;
  el swatch de cada fila muestra `override ?? dipColor` y el botón
  «General» (sólo visible con override) borra la entrada del mapa.
- `applyTransition` resuelve `color: dipColorById[id] ?? dipColor` por clip;
  `batchTransitionIn` no cambió (ya recibía el color por llamada).
- Descripciones del catálogo actualizadas en `visuals.ts` (fallback) y
  `commands/visuals.rs` (catálogo medido) + comentario del catálogo.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/visuals` → 8/8. `VisualsView.test.tsx` nuevo
  (3 tests jsdom): proyecto real vía `addAsset`+`addClipFromAsset` (los ids
  de `createDemoProject` no son UUID y `parseProject` rechaza la edición —
  lección: para tests que escriben en el store hay que armar el proyecto
  con `project-actions`, no con el demo).
- `cargo test -p editor-ia-desktop --lib commands::visuals` → 6/6.
- `cargo fmt --check` limpio en `visuals.rs`.

## Archivos

`apps/desktop/src/features/visuals/{VisualsView.tsx,VisualsView.test.tsx,
visuals.ts,visuals-view.css}`, `apps/desktop/src-tauri/src/commands/
visuals.rs`, `docs/IMPROVEMENT-QUEUE.md`, esta nota.

## Pendiente honesto

- El override no se precarga desde un `transitionIn` existente: el swatch
  muestra el color general hasta que el usuario lo toca.
- `luma-wipe` sigue eligiendo un mate por clip (ya existía); no hay
  sugerencia automática de mate por tramo.
