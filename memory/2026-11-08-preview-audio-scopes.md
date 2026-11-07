# Scopes de audio en vivo del bus master en el monitor (2026-11-08)

Pasada del loop de mejora (Devin CLI). Ítem del port Kdenlive
(`docs/KDENLIVE-REFERENCE.md` §1): «scopes del audio ya mezclado en
preview del monitor (bus master Web Audio)» — el último pendiente de la
fila `scopes/audioscopes`.

## Qué se hizo

- `apps/desktop/src/features/mixer/usePreviewAudio.ts`: el `MasterChain`
  gana `freqBuffer`/`timeBuffer` (Float32Array) y se exporta
  `readPreviewAudioMasterScope()`, que lee el `AnalyserNode` master con
  `getFloatFrequencyData`/`getFloatTimeDomainData`. Devuelve `null` si no
  hay grafo o el analizador no expone lectura float. Los buffers son
  internos: se reescriben en cada llamada.
- `apps/desktop/src/features/editor/PreviewAudioScopes.tsx` (nuevo):
  panel overlay `.scopes-panel--audio` (izquierda del monitor, así no
  pisa el `ScopesPanel` de color que va a la derecha) con oscilograma
  min/max arriba y espectro dBFS abajo, muestreado por `requestAnimationFrame`
  mientras está abierto. En pausa el analizador retiene el último bloque
  y la imagen queda quieta. Pie honesto: mide el bus Web Audio de la
  preview (pistas, EQ, fader, paneo y ganancia master); los efectos por
  clip (`audioStack`) y la cadena de exportación FFmpeg no pasan por ese
  bus y no aparecen.
- `Preview.tsx`: botón «Audio» en la toolbar del monitor que alterna el
  panel.
- `styles/scopes.css`: `.scopes-panel--audio` (left en vez de right) y
  `.scopes-note` para el aviso de degradación.

## Verificación

- `npx vitest run src/features/editor/PreviewAudioScopes.test.tsx
  src/features/mixer/LiveMeters.test.tsx` → **17/17** (3 nuevos: panel
  honesto sin Web Audio + cierre; con AudioContext falso lectura del
  scope 512 bins/1024 muestras a 48 kHz, dibujo y «Señal en vivo»; `null`
  sin grafo).
- `npx vitest run src/features/editor/ScopesPanel.test.tsx` → **1/1**.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.
- No se corrió `npm run verify` completo (cambio acotado a la preview).

## Límites honestos

- Espectro de 512 bins lineal en frecuencia (no logarítmico, como pide un
  scope de audio profesional).
- Oscilograma de la mezcla mono-del-bus: el bus master no separa canales.
- Mide la preview, no el export: si la cadena de efectos por clip crece en
  la preview Web Audio, este scope la reflejará solo cuando el grafo la
  incluya.

## Pendiente del port Kdenlive

Quedan: luma wipe y slide 3D (transiciones), forma custom y editor visual
del titler, editor visual del rig stickman, física 2D, transiciones OBS
en vivo, snapping por intervalo/cara más rico.
