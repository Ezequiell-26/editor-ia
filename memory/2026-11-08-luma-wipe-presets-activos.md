# 2026-11-08 — `luma-wipe` en TRANSITION_PRESETS de Activos

Pasada del loop de mejora (Devin CLI). Ítem: el «Pendiente» de la entrada
iris declaraba que `luma-wipe` seguía fuera de `TRANSITION_PRESETS`
(`EditorAssets`) y del catálogo Rust, aplicable sólo desde el Inspector.

## Qué se hizo

- `applyTransitionToCuts` (`state/project-actions.ts`) gana la opción
  `mateClipIdFor?: (clip, frames) => string | undefined`: el resolvedor
  elige el `mateClipId` de cada corte (los candidatos dependen de los
  `frames` que se van a escribir) y los cortes sin mate se saltan,
  contados en el nuevo campo `skipped` del resultado. Sin resolvedor el
  comportamiento es el anterior (todo se salta), así que el caller del
  brain no cambia.
- `EditorAssets.tsx`: `TRANSITION_PRESETS` suma «Barrido Luma» (18
  tarjetas). Helper `lumaMateForCut` reutiliza `lumaMateCandidates` +
  `lumaMatePick` (`features/editor/luma-mate.ts`): probe con el
  `transitionIn` pendiente para calcular el solape real, mate propio
  válido > primer candidato — la misma regla que el lote de VisualsView.
  Clip único: escribe `transitionIn` con `mateClipId` o avisa que no hay
  mate. Lotes: notice con «N sin clip mate válido» o aviso de que ningún
  corte tiene mate.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest `project-actions.test.ts` 109/109 (+1: sin resolvedor salta los
  cortes; con resolvedor escribe `mateClipId` sólo donde hay mate y
  `skipped` cuenta el resto; `validated()` pasa el schema).
- `EditorAssets.test.tsx` 9/9 (conteo 17→18), `luma-mate.test.ts` 17/17.
- Regresión `Timeline.test.tsx` + `features/visuals` + `state/brain`
  70/70.

## Límites honestos

- El mate se elige solo; no hay selector de mate en esta pestaña (está
  en el Inspector y en el lote de VisualsView).
- Un corte sin mate válido queda sin transición en el lote; se reporta,
  no se inventa mate.
- Sin cambios en Rust ni en el contrato del documento.
