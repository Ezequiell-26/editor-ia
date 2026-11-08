# 2026-11-08 — stateRef eager en project-store

## Qué se hizo

`state/project-store.tsx`: los mutadores del documento (`applyRecipe`,
`undo`, `redo`, `adopt`, `closeProject`, `setIoPoint`, `clearIoRange`)
ahora adelantan `stateRef.current` de forma síncrona antes de pedir el
render — el mismo patrón que `playbackRef` ya usaba para playhead/playing.

## Por qué

`stateRef.current = state` corre en el cuerpo del provider, o sea recién
en el render. Todo lo que leía el ref entre el `setState` y el render veía
el documento viejo:

- Dos `store.update` en el mismo tick: la segunda receta partía del
  proyecto anterior y **pisaba la primera edición** (se perdía).
- `store.update` + `store.saveNow()` inmediato: guardaba el documento
  anterior (NodeGraphView lo parcheaba con `setTimeout(0)`; DownloadView
  con `withImportLock` + tick; el resto de callers —AssistantDock,
  ExportDialog, Inspector— no tenía protección).
- `closeProject` + `saveNow` podía guardar el proyecto recién cerrado.

## Contrato resultante

Todo mutador que toque `project`/`undo`/`redo`/`ioRange`/`opened` debe
adelantar `stateRef` (está documentado junto al ref). Los campos que no
leen lectores síncronos (selection, notice, exportRequested,
recoveryOffer, fase `saving`) siguen yendo sólo por `setState`.

## Verificación

- `tsc --noEmit` desktop: 0 errores.
- `project-store.test.tsx`: 9/9 (+2 regresiones que fallan en HEAD viejo:
  doble update → 1 pista en vez de 2; update+saveNow → documento sin el
  cue). Verificado restaurando el archivo de HEAD temporalmente.
- `src/state`: 776/776 · `features/nodes`: 13/13 · `App.test.tsx`: 77/77.

## Archivos

`state/project-store.tsx`, `state/project-store.test.tsx`,
`features/nodes/NodeGraphView.tsx` (sin los ticks), esta entrada,
`docs/IMPROVEMENT-QUEUE.md`.
