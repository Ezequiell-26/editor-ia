# Shuttle inverso `J` (2026-11-08)

Cierra el pendiente 1 de `docs/ATAJOS-PRO.md`: el motor de reproducción
sólo avanzaba y `playing` era booleano; no existía dirección.

## Cambio

- `state/project-store.tsx`: `playbackRef` gana `direction: 1 | -1`;
  `PlaybackDirectionContext` + `useProjectPlaybackDirection()` +
  `useProjectPlayback().direction`; `setPlaybackDirection`/`getPlaybackDirection`
  en la interfaz del store (ref síncrono + estado de contexto, igual que
  `rate`). `adopt`/`closeProject` reinician la dirección a `1`.
- `features/editor/usePlayback.ts`: el tick multiplica
  `delta·fps·rate·direction` (dirección leída por tick vía getter, como la
  velocidad). Bordes simétricos: `dir<0` frena en frame 0 o, con
  `loopPlayback`, salta a `total−1`; al arrancar, dirección −1 con
  playhead en 0 inicia desde `total−1` (espejo del forward que vuelve a 0
  al final).
- `App.tsx`: `playback.shuttleForward` (`L`) fija dirección `1` y
  reproduce; nuevo `playback.shuttleReverse` (`J`) fija `−1` y reproduce.
  `K`/Espacio sólo pausan/reanudan y conservan la dirección.
- `Preview.tsx`: `VideoLayer`/`AudioLayer` reciben
  `playbackRate = rate × direction` (con signo) y el clamp de
  `elementRate` preserva el signo con la misma magnitud 0.1–8.
- `state/shortcuts.ts`: id `playback.shuttleReverse`, label/categoría y
  default `J` (reasignable como cualquier atajo pro).
- `components/Icon.tsx`: icono nuevo `playReverse`; el botón play/pausa
  del transporte lo usa al reproducir en reversa y su `title` declara el
  sentido.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest: `project-store.test.tsx` 7/7 (+1 dirección en contexto propio),
  `shortcuts-pro.test.ts` 5/5, `Transport.test.tsx` 4/4 (+1 indicador de
  reversa), `App.test.tsx` 77/77, `render-cost` 1/1,
  `PreviewAudioScopes` 3/3.

## Límites honestos

- Reversa = `playbackRate` negativo del elemento HTML. Chromium lo
  soporta; si un motor lo ignorara, el playhead retrocede y la corrección
  de deriva por `sourceSeconds` reconduce el `currentTime` (seek por
  frame — más entrecortado que la reversa nativa).
- `preservesPitch` puede no aplicar en reversa; el audio invertido es
  revisión, no referencia.
- Sin rampa de velocidad por teclas repetidas (sigue pendiente 2 de
  ATAJOS-PRO): repetir `L`/`J` no cambia la velocidad.
- Bucle inverso: envuelve al último frame (decisión de esta pasada para
  simetría con el forward).
