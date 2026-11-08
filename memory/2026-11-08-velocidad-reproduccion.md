# 2026-11-08 — Velocidad de reproducción 0.25–4×

Pasada del protocolo del loop (Devin CLI). Cierra la parte «no existe
control de velocidad de reproducción» del pendiente 2 de
`docs/ATAJOS-PRO.md` (shuttle/rampa).

## Qué se hizo

- `state/project-store.tsx`: `playbackRef` gana `rate`; `PlaybackRateContext`
  + `setPlaybackRate`/`getPlaybackRate` (clamp 0.1–8) +
  `useProjectPlaybackRate()`; `useProjectPlayback()` devuelve `{frame,
  playing, rate}`. La velocidad NO vive en el store principal ni por frame:
  contexto propio, mismo patrón que playhead/playing.
- `features/editor/usePlayback.ts`: `frame += delta·fps·getPlaybackRate()` —
  lectura del ref por tick, cambiar velocidad no reinicia el rAF.
- `features/editor/Transport.tsx`: `<select>` «Velocidad de reproducción»
  (0.25/0.5/1/2/4×) + `.transport-rate` en `app.css`.
- `features/editor/Preview.tsx`: `VideoLayer`/`AudioLayer` reciben
  `playbackRate` y aplican `element.playbackRate = clipSpeed × rate` +
  `preservesPitch = true`. Efecto secundario positivo: los clips con
  `speed ≠ 1` ya no re-buscan `currentTime` cada ~0.12 s de deriva.

## Verificación

- `tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest: `project-store.test.tsx` 6/6 (+1: contexto propio, sin renders
  del store, clamp), `render-cost` 1/1, `PreviewAudioScopes` 3/3,
  `LiveMeters` 23/23, `App.test.tsx` 77/77, `Timeline` 20/20,
  `Timeline.pro` 7/7, shortcuts 12/12.

## Límites honestos

- Velocidad de sesión: no persiste ni entra al documento.
- Sin rampa por teclas repetidas ni dirección inversa (J); el motor sólo
  avanza.
- A 4× el avance por rAF salta ~2 frames/tick a 30 fps: revisa rápido,
  no frame-exacto.
- `preservesPitch` depende del motor del WebView2 (Chromium: soportado);
  en jsdom el assert es sólo de propiedad.
