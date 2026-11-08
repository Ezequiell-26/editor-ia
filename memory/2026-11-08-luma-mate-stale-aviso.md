# 2026-11-08 — Aviso de mate luma-wipe stale en VisualsView

Pasada del loop (Devin CLI). Ítem: pendiente honesto de la entrada
«VisualsView precarga» — «si el mate propio quedó inválido el selector
muestra el primer candidato pero no lo marca como "cambiado"».

## Cambio

`apps/desktop/src/features/visuals/VisualsView.tsx`: en el selector de mate
por clip de `luma-wipe`, se lee el `mateClipId` guardado en el
`transitionIn` del clip y, si no está entre los candidatos calculados con
los `frames` que se van a escribir (`mateCandidates`, mismo mapa que usa
`lumaMatePick`), la etiqueta muestra «· mate asignado ya no válido».

Por qué contra los candidatos del probe y no `lumaMateIsStale`: la
validez depende del lead que se va a aplicar (`transitionFrames` del
estado), no del `transitionIn` viejo del clip — `lumaMateIsStale` usa los
frames propios y podría dar un veredicto distinto al de la aplicación por
lote.

`lumaMatePick` no cambió: override válido > mate guardado válido > primer
candidato. El aviso es sólo etiqueta; «Aplicar» sigue escribiendo el mate
elegido (que es lo correcto: el guardado ya no sirve).

## Tests

`VisualsView.test.tsx` 6/6 (+2): `renderView` ganó `clipBAtFrame`
(default 300 → 200 en los tests nuevos para que A y B solapen y exista un
candidato de mate). Caso stale: `mateClipId: 'mate-que-no-existe'` muestra
la marca y el `<select>` cae al id real del clip A. Caso válido: mate = A
no marca y el valor del select es A.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/visuals/VisualsView.test.tsx` → 6/6.

No se tocó Rust ni el contrato del documento.

## Límite honesto

La marca es texto plano en la etiqueta (sin estilo warning ni agregado al
notice de «Aplicar»); el mate animado en preview sigue siendo la brecha
mayor declarada de `luma-wipe`.
