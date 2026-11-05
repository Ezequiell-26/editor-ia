# 2026-11-05 — corte de contexto de playback (rendimiento)

Pedido del usuario: «mejorá el rendimiento de la app completa, que funcione
rápida, que consuma lo mínimo y sea extremadamente eficiente».

## Problema medido en el código

`ProjectProvider` guardaba `playheadFrame` y `playing` dentro de `StoreState`.
Cada `setPlayhead` (~30-60/s durante reproducción) creaba un `state` nuevo →
nuevo `value` del contexto → re-render de los ~100 consumidores de
`useProjectStore()`: App, AppShell, MenuBar, Sidebar, AssistantDock,
WelcomeDialog y cualquier vista montada, aunque ninguno mostrara el frame.

## Cambio

- `StoreState` ya no tiene `playheadFrame` ni `playing`.
- Dos contextos propios en `project-store.tsx`: `PlayheadContext` (number) y
  `PlayingContext` (boolean), provistos por el mismo `ProjectProvider`.
- `playbackRef` se actualiza síncronamente en `setPlayhead`/`setPlaying` para
  que `getPlayhead()`/`getPlaying()` (nuevos, en `ProjectStoreValue`) devuelvan
  el valor recién fijado sin esperar al render.
- Hooks: `usePlayheadFrame()`, `useProjectPlaying()`, `useProjectPlayback()`
  ({frame, playing}); `useProjectPlayhead()` conserva su firma.
- `adopt()` y `closeProject()` reinician el playback a {0, false} como antes.
- Migradas 86 lecturas en 20 archivos: handlers → `getPlayhead()`/`getPlaying()`;
  render → hooks. `MenuBar`/`LiveMeters`/`Shell` (App) sólo usan `playing`.
- En `Timeline`, el drag de puntero lee `latest.current.store.getPlayhead()`.

## Resultado

Durante playback sólo se re-renderizan por frame los componentes que muestran
el frame: Timeline, Preview, Transport, MarkersPanel, TrackAutomationPanel,
VfxView, `RegularClipInspector` y el host de `usePlayback`. El cromo completo
(AppShell, MenuBar salvo play/pausa, Sidebar, AssistantDock, WelcomeDialog) ya
no se recalcula por tick.

## Verificación

- `tsc --noEmit` (apps/desktop): 0 errores.
- `vite build`: OK (6,8 s).
- Test nuevo `playback fuera del store principal` en
  `project-store.test.tsx`: un consumidor puro de `useProjectStore` registra
  **0 renders extra** tras `setPlayhead` y `setPlaying`. 3/3 del archivo.
- Suites: editor+App+components 306/311 y features varias 169/178; los 14
  fallos son los preexistentes documentados (ThumbnailBrowser roles,
  AssetsPanel `<main>` duplicado + filtro por carpeta). Sin regresiones.

## Pendiente honesto

- No se midió aún el delta de CPU/frames en la app instalada (CDP). La
  reducción de renders está probada por test; la ganancia en ms queda por
  medir en la próxima pasada.
- `main` chunk sigue en ~545 kB; `vendor-emojibase` ~499 kB (lazy, sólo al
  abrir el picker). CSS splitting fase 2 y microbenchmark LTO siguen en cola.
