# 2026-11-08 — Rampa del shuttle en el store (corte de pausa universal)

Pasada del loop de mejora (Devin CLI). Cierra el pendiente honesto de la
entrada «rampa de velocidad del shuttle» del 2026-11-08.

## Problema

`shuttleRef` (estado de la rampa L/J) vivía en `App.tsx`. Sólo el dispatcher
de teclado lo conocía: `endShuttleRamp` se llamaba desde `playback.playPause`,
`playback.shuttlePause` y los saltos de frame — pero el botón play/pausa y el
scrub de `Transport.tsx` pausaban con `store.setPlaying(false)` sin tocar la
rampa. Resultado: tras pausar desde la UI la velocidad quedaba en 2×/4×/8× y
Espacio reanudaba a esa velocidad hasta que venciera la ventana de 1,5 s.

## Cambio

- `state/project-store.tsx`: `shuttleRef` interno + `shuttlePress(direction)`
  + `endShuttleRamp()` en `ProjectStoreValue`. `setPlaying(false)` corta la
  rampa automáticamente cuando `active` (antes del early-return). Velocidad
  manual intacta. Mismo patrón que `playbackRef`: ref síncrono + contextos
  propios para no re-renderizar el store por frame.
- `App.tsx`: eliminado `shuttleRef`, el import de `state/shuttle` y el helper
  local; los casos de teclado usan `store.shuttlePress` / `store.setPlaying`.
- `Transport.tsx`: sin cambios (botón y scrub ya pasan por `setPlaying`).
- `state/shortcuts-pro.test.ts`: evidencia de `shuttleForward`/`Reverse`
  actualizada a `store.shuttlePress`.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest `project-store.test.tsx` 12/12 (+3), `shuttle.test.ts` 8/8,
  `shortcuts-pro.test.ts` 5/5, `Transport.test.tsx` 4/4, `App.test.tsx` 77/77.

## Pendiente honesto

- Rampa por pulsaciones (auto-repeat del SO también escala).
- `endShuttleRamp` expuesto para pausas futuras que no sean `setPlaying`.
- Estado de sesión: no persiste ni va al documento; `adopt`/`closeProject` no
  lo resetean (la ventana lo expira).
