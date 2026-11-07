# 2026-11-07 — Cerebro: alinear cortes existentes al pulso (roll)

Pasada del loop de mejora (Devin CLI), ítem pendiente de la cola: «el cerebro no
usa la grilla de beats para alinear cortes ya existentes».

## Qué se hizo

- Nueva política `beatAlignPolicy` en `apps/desktop/src/state/brain/policies.ts`:
  recorre los cortes contiguos por pista (shots visuales que se tocan exacto),
  busca el beat más cercano y propone un roll si el corrimiento está entre la
  tolerancia (~80 ms, la misma del métrico `beatAlignment`) y
  `min(medio pulso / 2, 0,25 s)`.
- Para no proponer rolls imposibles, la política replica los guardas de
  `trimGuards`/`rollClip`: clip `video|audio`, velocidad 1×, sin
  transform/gain/mask keyframes ni estabilización, pista desbloqueada, vecino
  real del roll, `outFrame + delta <= duración medida del asset` y
  `inFrame + delta >= 0`.
- `types.ts`: `ProposalKind` nuevo `beat-align` y payload
  `{ kind: 'roll', clipId, edge, deltaFrames }` (el payload `trim` sigue sin
  implementación: se ajusta a mano).
- `apply.ts`: `EXECUTION_ORDER['beat-align'] = 0` y caso `roll` que llama a
  `rollClip` (primitiva existente en `project-actions.ts`). Riesgo `moderate`:
  aplicable con «Aplicar», excluido de «Aplicar lo seguro».

## Verificación

- `npx tsc --noEmit -p apps/desktop` → 0 errores.
- `npx vitest run src/state/brain src/features/brain src/state/project-actions.test.ts`
  → 128/128 (incluye 4 tests nuevos en `brain.test.ts`).
- `npm run verify` completo NO corrido: la suite serial tiene ~13 fallos
  preexistentes documentados en IMPROVEMENT-QUEUE; la evidencia de la pasada es
  typecheck + módulos tocados.

## Contexto de la pasada

- Preflight inicial bloqueó por RAM (362–513 MB < piso 700 MB); al reintentar tras
  ~90 s había 2347 MB libres y el ledger reportó `idle` (todas las tareas done).
- El árbol tenía trabajo del usuario sin commitear (unificación F3, navegación,
  tests e2e): se preservó; el commit de la pasada incluye sólo los 4 archivos del
  cerebro + esta memoria. `docs/IMPROVEMENT-QUEUE.md` quedó editado pero SIN
  commitear porque ya tenía cambios del usuario (entrada F3).

## Siguiente

- Del mismo pendiente del cerebro: reescritura de texto y reorden de escenas
  (siguen siendo recomendaciones sin payload).
- Brechas de la matriz pendientes: transiciones OBS en vivo, editor visual del
  rig stickman, física 2D, grafos dentro del `.olyp` (scopes en preview ya están:
  `ScopesPanel` en ColorStudio y Preview).
