# 2026-11-07 — OnboardingTour sobre el recorrido único (cierre F4)

Pasada del loop de mejora (Devin CLI). Último ítem de F4 de
`docs/UNIFICATION-PLAN.md`: el onboarding tenía que usar el recorrido único.

## Cambio

- `apps/desktop/src/components/OnboardingTour.tsx`: `TOUR_STEPS` ya no es una
  lista literal de 6 pasos propios (welcome/assets/timeline/preview/ai-tools/
  export). Ahora se deriva con `map` de `WORKSPACE_STEPS`
  (`app/workspace-map.ts`): ids, label→title, action→subtitle,
  detail→content, tip→proTip y `view`→navegación canónica por etapa
  (projects → script → assets → production → editor → production).
- Lo único que queda propio es `TOUR_TARGETS`: anclas visuales por
  `PipelineStageId` (toolbar de `.projects-view`/`.script-view`/
  `.assets-view`/`.production-view`, `[data-tour="timeline"]` del editor y
  `[data-tour="export"]` del topbar, que es global).
- Test nuevo `OnboardingTour.test.tsx` (3 tests): derivación campo por campo
  contra `WORKSPACE_STEPS`, primer paso + navegación por etapa, y marcado de
  `TOUR_COMPLETED_KEY` al finalizar.

## Verificación real

- `npx tsc --noEmit -p apps/desktop` → 0 errores.
- `npx vitest run` dirigido: OnboardingTour 3/3, WorkspaceGuide 4/4,
  LearnView 2/2, workspace-map 4/4 → 13/13.
- `npx vitest run src/App.test.tsx` → 76/76.
- No se corrió la suite serial completa ni e2e (cambio acotado a un
  componente lazy de UI).

## Estado

F1–F4 del plan de unificación completadas y registradas en
`docs/UNIFICATION-PLAN.md` §6 y `docs/IMPROVEMENT-QUEUE.md`. El siguiente
trabajo sale de la cola de mejora o de una brecha demostrable en
`docs/CAPABILITY-MATRIX.md` §7.
