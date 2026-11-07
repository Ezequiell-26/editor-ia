# 2026-11-07 — Cerebro: política de silencios medida

Pasada del loop de mejora (Devin CLI). Ítem: `[pending]` «el cerebro mide
huecos, no silencios» del lote cerebro de edición
(`docs/IMPROVEMENT-QUEUE.md`).

## Qué se hizo

- `state/brain/types.ts`: `SilenceCutSpan`, `SilenceCutSignal`, `ProposalKind`
  `cut-silences` y payload `cut-spans` (clipId + spans + cutFrames +
  removedSeconds).
- `state/brain/policies.ts`: `silencePolicy` — convierte planes de silencio
  medidos en propuestas (≥0,3 s y ≥2 % del clip, tope 3, riesgo `moderate`).
- `state/brain/apply.ts`: `cut-spans` se ejecuta con `applyCutSpans`
  (`state/silence-cuts`), orden de ejecución 1.
- `state/brain/plan.ts` + `index.ts`: `PlanOptions.silences` y exports.
- `features/brain/BrainPanel.tsx`: botón «Medir silencios» que corre
  `silenceCutCandidates` (tope 12) + `service.audioPeaks` (caché por asset) +
  `planSilenceCutsForProject`; limpia la medición tras cada aplicación porque
  el ripple corre los frames.
- `state/brain/brain.test.ts`: +5 tests (28 total).

## Decisión de diseño

Mismo patrón que `BeatGrid`: el cerebro es puro y no decodifica audio; recibe
señales ya medidas. Sin señal no propone nada — no inventa silencios.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → exit 0.
- `npx vitest run src/state/brain src/features/brain src/state/silence-cuts.test.ts`
  → **46/46** (brain.test 28, BrainPanel 6, silence-cuts 12).
- Suite serial completa no corrida (cambio acotado a estado puro + panel).

## Cierre del ledger

`loop:record --status done` fue **rechazado**: `npm run verify` quedó en rojo
por WIP del usuario **en curso** — `apps/desktop/src/state/shortcuts-pro.test.ts`
(se modificó sin commitear durante la pasada) importa `deleteClips` y
`moveClipsBy`, que `project-actions` todavía no exporta. Es ajeno al cambio;
la tarea 10 del ledger quedó `blocked` con el remedy escrito. Cuando el
typecheck vuelva a verde hay que re-correr `loop:record --task 10 --status
done --files ...`.

## Extra

El `[pending]` «UI del export lossless» ya estaba implementado
(`LosslessCutCard` en `Inspector.tsx`, desde 2026-11-03); se marcó resuelto
en la cola sin código nuevo.
