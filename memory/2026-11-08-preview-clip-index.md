# 2026-11-08 — Ítem 19: índice de clips del Preview por proyecto

## Contexto

La cola pedía «playhead fuera del contexto + memoizar mapas de clips en
Preview + medir frames >16 ms en 10 s de playback». La separación del
playhead ya existía (contextos propios desde el 2026-11-05); el costo
real por tick estaba en la selección de clips del monitor.

## Cambio

`features/editor/preview-index.ts` (nuevo): `buildPreviewClipIndex`
resuelve una vez por proyecto (documento inmutable durante playback):

- `Map` de tracks y assets (antes `find` por clip y por comparación de
  sort, en cada tick);
- tres listas pre-clasificadas con los **mismos predicados** del
  `useMemo` anterior: `visual` (track visible de kind video/image/
  graphic, clip enabled, ordenada por `track.order` estable), `audio`
  (track audible por `isTrackAudible` + kind audio/narration, orden de
  clips) y `adjustment` (kind adjustment + track no oculta, ordenada).

`Preview.tsx`: los tres `useMemo` por frame pasaron a
`useMemo(() => activeAt(index.X, playhead))` — filtro numérico de rango.
Los consumidores reciben `PreviewClipEntry {clip, track, asset}` y el
render usa los campos ya resueltos (se eliminó `assetById`; `trackById`
sólo queda para un cue de subtítulo fuera del camino caliente).

## Verificación

- `preview-index.test.ts` (6 tests): clasificación, orden, solo de
  audio, paridad **frame a frame** (161 frames) contra la implementación
  naive de referencia, y benchmark.
- Benchmark medido (240 clips, 6 pistas, 300 ticks ≈ 10 s @30fps):
  **0,004 ms/tick** con índice vs **0,045 ms/tick** naive (~11×).
- `tsc --noEmit`: 0 errores · vitest: preview-index 6/6, PreviewFit 3/3,
  PreviewTransformBox 8/8, project-store 14/14.

## Límite honesto

La capa de selección nunca fue el cuello del frame (>16 ms viene del
render React de las capas y del decode de video). La medición de frames
reales durante playback (CDP sobre la app instalada con proyecto y
medios) sigue pendiente — anotado en la cola.
