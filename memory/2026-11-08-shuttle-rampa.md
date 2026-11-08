# Rampa de velocidad del shuttle L/J (2026-11-08)

Cierra el pendiente 2 de `docs/ATAJOS-PRO.md`: repetir `L`/`J` no cambiaba
la velocidad; ahora cada pulsación dentro de la ventana sube un escalón.

## Cambio

- `state/shuttle.ts` (nuevo, puro): `SHUTTLE_RATES = [1, 2, 4, 8]` (el tope
  es el clamp de `setPlaybackRate`), `SHUTTLE_WINDOW_MS = 1500`,
  `ShuttleState { direction, level, lastAt, active }`, `IDLE_SHUTTLE`,
  `shuttleStep` (fuera de ventana → nivel 0; dentro → nivel+1 tope 3;
  dirección = tecla pulsada), `shuttleRate`, `resetShuttle`.
- `App.tsx`: `shuttleRef` junto a `storeRef`; los casos
  `playback.shuttleForward`/`Reverse` comparten bloque — `shuttleStep` →
  `setPlaybackDirection` + `setPlaybackRate(shuttleRate)` + `setPlaying`.
  `endShuttleRamp()` devuelve la velocidad a 1× sólo si `active` (la rampa
  la fijó, no el selector) y se llama al pausar: Espacio cuando estaba
  reproduciendo, `K` (`shuttlePause`) y los saltos de frame
  (`framePrev/Next`, `goToStart/End`). Reanudar con Espacio no resetea.
- `Transport.tsx`: `PLAYBACK_RATES` gana `8` para que el selector muestre
  la velocidad rampada (y 8× queda elegible a mano, dentro del clamp 0.1–8).

## Semántica

- Alternar `L`/`J` rápido invierte el sentido **y** sube la velocidad
  (cada pulsación cuenta), como el shuttle de Premiere.
- Pausar corta la rampa: el próximo `L`/`J` arranca en 1×. Una velocidad
  manual del selector (p. ej. 0.5×) no se toca al pausar.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest `shuttle.test.ts` 8/8 (nuevo), `Transport.test.tsx` 4/4,
  `project-store.test.tsx` 7/7, `App.test.tsx` 77/77,
  `shortcuts-pro.test.ts` 5/5.

## Límites honestos

- La rampa es por pulsaciones, no por tiempo sostenido: mantener `L`
  apretada depende de la auto-repetición del SO (que sí llega como
  keydowns sucesivos y por tanto también escala).
- Pausar desde la UI (botón del transporte, scrub con puntero) no pasa por
  `endShuttleRamp`: la rampa queda "tibia" hasta que venza la ventana de
  1,5 s o llegue la próxima pulsación de shuttle.
- El estado vive en un ref de `App`: cambiar de proyecto no lo resetea,
  pero la ventana lo expira sola.
