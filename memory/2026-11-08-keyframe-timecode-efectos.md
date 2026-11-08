# 2026-11-08 — Timecode en la lista de keyframes de efectos

Pasada del loop (Devin CLI). Cierra el «las filas muestran frame local del
clip, no timecode» del pendiente honesto de `keyframe-seek-efectos`.

## Qué se hizo

- `EffectStackPanel` (`features/vfx/EffectStackPanel.tsx`): prop nueva
  opcional `frameRate?: number`. Si está presente, la `.keyframe-list` del
  popover «Curva» etiqueta cada clave con `formatTimecode` (el mismo helper
  del Inspector para transformaciones/máscaras); si no, conserva `frame N`.
  `ParamAnimation` gana `frameRate`; `StackRow` y el panel lo reenvían.
- `EffectStudio` ya recibía `frameRate` del clip y ahora lo pasa al panel.
- `AudioEffectStack` expone `frameRate` y `Inspector` le pasa `fps` del
  proyecto, así el stack de audio del Inspector también muestra timecode.

## Verificación

- `node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json`
  → 0 errores.
- `node node_modules/vitest/vitest.mjs run
  apps/desktop/src/features/editor/AudioEffectStack.test.tsx
  apps/desktop/src/features/vfx/EffectStudio.test.tsx` → 17/17
  (AudioEffectStack 11/11 con el test nuevo: `frameRate={30}` muestra
  `0:00:00:15` y `0:00:01:00`; EffectStudio 6/6).

## Pendiente honesto

El click-to-seek salta al frame pero no reproduce hasta ahí. El timecode es
local al clip (frame 0 del clip = `0:00:00:00`), no al timeline.
