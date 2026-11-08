# 2026-11-08 — VisualsView: precarga de color/mate desde transitionIn

Pasada del loop (Devin CLI). Cierra el pendiente honesto de la entrada
dip-color-por-clip: el lote de VisualsView pisaba con el color general los
`transitionIn.color` propios que los clips ya tenían, y para `luma-wipe`
ignoraba el `mateClipId` existente al elegir candidato.

## Decisión de diseño

Resolución en vivo, no estado sembrado: los helpers leen `clip.transitionIn`
en el momento de renderizar/aplicar, así que nunca quedan stale respecto al
documento. Cadena de prioridad:

- `dipColorForClip(transitionIn, override, general)`: override string >
  `null` (forzar general) > color propio del clip > general.
- `lumaMatePick(clip, choice, candidates)`: choice válido > mate existente
  válido > primer candidato.

`dipColorById` pasó a `Record<string, string | null>`: `null` expresa «usá el
general» de forma explícita (borrar la clave caería de nuevo al color propio
del clip). El botón «General» se muestra cuando el color efectivo difiere del
general, cubriendo tanto overrides como colores propios preexistentes.

Con un solo clip seleccionado no hay filas por clip, así que el swatch
«Color general» muestra el color efectivo de ese clip y al cambiarlo guarda un
override para él: lo que se ve es lo que se aplica.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest `features/visuals` + `features/editor/luma-mate.test.ts` → 20/20.
- Tests nuevos: `dipColorForClip` (4 casos), `lumaMatePick` (3 casos) y un
  test de vista que aplica el lote sobre un clip con `dip-color` `#123456`
  propio y verifica que lo conserva.

## Archivos

- `apps/desktop/src/features/visuals/visuals.ts` (+`dipColorForClip`)
- `apps/desktop/src/features/visuals/VisualsView.tsx`
- `apps/desktop/src/features/editor/luma-mate.ts` (+`lumaMatePick`)
- tests: `visuals.test.ts`, `luma-mate.test.ts`, `VisualsView.test.tsx`
