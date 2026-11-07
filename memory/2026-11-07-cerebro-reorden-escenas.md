# 2026-11-07 — Cerebro: reorden de escenas según la timeline

Pasada del loop de mejora (Devin CLI). Ítem: `[pending]` «el cerebro todavía
no reordena escenas» de `docs/IMPROVEMENT-QUEUE.md` (lote cerebro de edición).

## Qué se hizo

- `sceneOrderPolicy` en `apps/desktop/src/state/brain/script-policies.ts`:
  compara `scene.order` con el `startFrame` mínimo de los clips referenciados
  en `scene.clipIds`. Si difieren, propone `script:scene-order` con payload
  `scene-order` (lista completa de ids de escena en el orden del corte).
- Las escenas sin clips conservan sus posiciones: no están en el video.
- Primitiva `reorderScenes(project, orderedSceneIds)` en
  `state/project-actions.ts`: valida que la permutación cubra exactamente
  las escenas y renumera `order`; lanza `ProjectActionError` si no.
- `apply.ts`: caso `scene-order` → `reorderScenes`. Riesgo `moderate`
  (cambia orden narrativo; no entra en «Aplicar lo seguro»).

## Verificación

- `tsc --noEmit -p apps/desktop` → 0.
- `vitest run src/state/brain/brain.test.ts` → 36/36 (+3 tests).
- `vitest run src/state/project-actions.test.ts` → 101/101 (+2 tests).
- No se corrió la suite serial completa.

## Notas

- El invariante del test «las propuestas script no tienen payload» quedó
  con excepción declarada para `scene-order` (y `caption-text`, que ya la
  tenía por payload `caption-fixes` — el test ahora filtra por
  `payload?.kind === 'scene-order'`).
- Límite: la posición de escena = startFrame mínimo de sus clips; escenas
  entrelazadas se ordenan por su primer clip.
- La tarea 10 del ledger (política de silencios) seguía `blocked` por el
  WIP del usuario en `properties/`; el typecheck volvió a verde y el test
  que fallaba (`ColorPropertiesPanel.test.tsx`) pasa, así que se ejecutó
  el remedio: `loop-record --task 10 --status done`.
- Primer intento de verify: falló sólo en `scripts/ci-workflows.test.mjs`
  (el resto 2180/2181). Causa real en WIP sin commitear del usuario:
  `scripts/ci-bundle-resources.sh` llamaba a `download()` 7 veces sin
  definirla (refactor incompleto a helper con retry). Se agregó la función
  con los flags que exige el test (`--retry 5 --retry-delay 2
  --retry-max-time 120 --retry-connrefused`, un solo `curl`). El script
  queda en el árbol sin commitear junto al resto del WIP del usuario.
- Segundo `loop-record --task 10 --status done`: **verify en verde**,
  tarea 10 → done, ledger sin pendientes ni bloqueos
  (25 done / 0 blocked / 0 pending), consecutiveFailures en 0.
