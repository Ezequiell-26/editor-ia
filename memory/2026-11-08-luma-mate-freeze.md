# 2026-11-08 — Mate congelado para `luma-wipe` desde el Inspector

Pasada del loop (Devin CLI). Cierra la parte manual del pendiente «crear
un mate nuevo (freeze sobre el solape) sigue siendo manual».

## Qué se hizo

- `lumaMateFreezePlan(project, clip, fps)` en
  `apps/desktop/src/features/editor/luma-mate.ts`: elige el clip donor con
  la misma regla de cobertura que `lumaMateCandidates` (video habilitado,
  sin reverse ni speedCurve, asset local ready, ventana activa = inicio −
  lead propio, tope 2·fps) y prioriza el que termina justo en el corte.
  Calcula `seconds` del último frame compartido por solape y donor,
  aplicando `speed` del clip y clamp a `inFrame`/`outFrame` del source.
- `placeFreezeMate(project, frameAssetId, {startFrame, durationFrames,
  label})`: pista `video` nueva marcada `hidden` + clip `freeze` que
  cubre exactamente la ventana del lead.
- `Inspector.tsx`: botón «Crear mate congelado del clip saliente» dentro
  del bloque `luma-wipe`, visible sólo si hay plan. `createLumaMate`
  encadena `extractFreezeFrame` → `addAsset` → `markAssetReadyFrom`
  (hereda licencia del video fuente) → `placeFreezeMate` → `updateClip`
  con `mateClipId`, todo en una `store.mutate`.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/editor/luma-mate.test.ts` → 17/17.
- `npx vitest run src/features/editor src/state/project-actions.test.ts`
  → 356/357; único fallo `render-cost.test.tsx` flaky bajo carga
  (aislado: 10.5 ms/tick Timeline, 1.3 ms/tick Inspector — pasa).

## Pendiente honesto

El mate es un frame quieto: válido como máscara (el render usa luminancia)
y el export lo anima igual que cualquier mate, pero el preview del monitor
sigue congelando la máscara a un frame (`transitionFrozen`). Mate animado
en preview = brecha declarada siguiente.
