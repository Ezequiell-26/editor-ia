# 2026-11-07 — Sub-pestañas de audio del Inspector con controles reales

Pasada del protocolo del loop (Devin CLI). La cola del ledger estaba
cerrada (`loop:preflight` → idle, código 10); se buscó una brecha
demostrable en `IMPROVEMENT-QUEUE`/`CAPABILITY-MATRIX`.

## Hallazgo

Las sub-pestañas de audio del Inspector de clip (`SUB_TABS.audio`)
declaraban `noise` («Eliminar Ruido») y `voice` («Filtros de voz») como
`pending`, o sea visibles pero deshabilitadas «porque el backend no
existe». **Era stale**: todo ese backend ya estaba implementado y
cableado dentro de la única sección «Audio del clip»
(`subtab="basic noise voice"`):

- `audio.denoise` → `afftdn` en el render (`render/ffmpeg.rs`).
- `audio.gateDb` → puerta de ruido.
- `audio.voiceIsolation` → stem Demucs real (`voiceIsolationPrepare`).
- `audio.voiceEffect`, `eqLow/Mid/HighDb`, `highPassHz`/`lowPassHz`,
  `compressor`, `deesser`, presets «Voz clara»/«Música».
- `AudioEffectStack` (los ~30 FX de audio del effect-kit).

Además `styles/filmora/filmora.css` ya tenía las reglas
`[data-subtab='noise']`/`'voice'` listas: la infraestructura estaba
completa y sólo faltaba repartir el JSX.

## Cambio

- `Inspector.tsx`: `pending` fuera de `noise`/`voice` (se conserva en el
  `ia` de speed — no hay backend de rampas por IA). La sección
  monolítica se partió en tres `InspectorSection` con tokens `subtab`
  distintos: «Audio del clip» (basic), «Reducción de ruido» (noise) y
  «Filtros de voz» (voice). Mismo JSX, mismo comportamiento; la
  visibilidad por sub-pestaña la resuelve el CSS de Filmora
  (`display:none` por `data-subtab`), en otros temas todo sigue montado.
- `App.test.tsx`: test nuevo que siembra un clip de audio, verifica las
  dos pestañas habilitadas, el cambio de `data-subtab` y el contenido de
  cada sección.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/App.test.tsx` → 77/77.
- `npx vitest run src/features/editor/AudioEffectStack.test.tsx
  src/features/editor/render-cost.test.tsx` → 7/7.

## Estado de la cola al cerrar

- Items «Pendientes priorizados» #19 (playhead fuera de contexto) y
  #22 (`.lottie` + IPC) ya estaban hechos en pasadas/lotes anteriores;
  #20 (denoise preview) quedó cubierto honestamente por los prints de la
  UI (`afftdn` sólo en export). #18 (composición opaca yuv420p) sigue
  siendo el pendiente técnico grande: exige verificación PSNR/SSIM y
  tests live, no es de una pasada.
- «Rampas de IA» (speed `ia`) sigue `pending` a propósito.
