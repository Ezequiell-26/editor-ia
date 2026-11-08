# 2026-11-08 — dip-color y luma-wipe en el lote de VisualsView

Pasada del protocolo del loop (Devin CLI). Cierra el pendiente declarado en
la entrada «Catálogo de transiciones de VisualsView al día»: el catálogo por
lote dejaba fuera `dip-color` y `luma-wipe` porque exigían `color` /
`mateClipId` que el lote no podía elegir.

## Qué se hizo

- `catalog_transitions()` en `commands/visuals.rs` suma las dos
  transiciones (19 en total) con descripciones que declaran el requisito;
  `dip-color` entra con `overlaps_previous: false` (es un fade desde color,
  como `fade-black`) y `luma-wipe` con `true` (el saliente queda debajo
  durante el lead, como los wipe).
- `FALLBACK_VISUAL_CATALOG.transitions` en `features/visuals/visuals.ts`
  queda espejo del backend (mismo orden e ids).
- `VisualsView`:
  - `dip-color` → `ColorSwatch` (el componente de rueda HSL, no un
    `input[type=color]` nativo) con un color compartido `#1b2a4a` por
    defecto, igual que el Inspector.
  - `luma-wipe` → un `<select>` de mate **por clip seleccionado**. Los
    candidatos salen de `lumaMateCandidates` (`features/editor/luma-mate.ts`)
    calculados sobre un clip sonda que ya lleva la transición pendiente
    (`{type:'luma-wipe', frames}`), porque la ventana de solape que valida
    el render depende de `frames`. La elección se guarda en
    `mateChoice[clipId]`; si la elección queda inválida se cae al primer
    candidato, y si no hay candidatos el clip se omite.
- `batchTransitionIn` (nuevo helper puro en `visuals.ts`) construye el
  `transitionIn` por clip y devuelve `undefined` cuando falta `color` o
  `mateClipId`, para no escribir un documento que el schema rechaza; la
  vista cuenta los omitidos en el notice.
- Thumbnails `dip-color.svg` y `luma-wipe.svg` en
  `public/thumbnails/transitions/`.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest: `visuals.test.ts` 5/5, `luma-mate.test.ts` 5/5, `Timeline` 20/20,
  `project-actions` 108/108, `EditorAssets` 9/9.
- `cargo test -p editor-ia-desktop --lib commands::visuals` → 6/6.
- `cargo fmt --check` limpio en `visuals.rs` (hay diffs de fmt preexistentes
  en `background.rs`/`preview_frame.rs`, trabajo no confirmado del usuario;
  no se tocaron).

## Límites honestos

- `dip-color` aplica el mismo color a todo el lote (no hay color por clip).
- `luma-wipe` elige un mate por clip, pero no permite mates distintos dentro
  del mismo clip ni mates "por tramo"; el Inspector sigue siendo el camino
  fino.
- No se agregó preset de `luma-wipe` en `EditorAssets`: la aplicación masiva
  `applyTransitionToCuts` lo salta a propósito (no puede elegir mate) y un
  preset que no hace nada sería UI deshonesta.
