# 2026-11-08 — Unificación F3: puertas únicas en «Más» (Editor IA)

## Qué se hizo

Pasada del loop de mejora (Devin CLI) cerrando la fase **F3** de
`docs/UNIFICATION-PLAN.md`: las vistas que `resolveViewRoute` resuelve a
modo del editor (`text-edit`, `multicam`, `mixer`, `vfx`, `motion`,
`visuals`) ya no aparecen en `SECONDARY_NAV_VIEWS` («Más»). Sus etiquetas
colisionaban con las tabs del editor (Texto, Multicámara, Mezcla, VFX,
Motion, Efectos).

Decisión de diseño: la exclusión se deriva de `resolveViewRoute(...).editorMode`
en `app/navigation.ts` — una sola fuente de verdad, sin lista paralela.
Quedan 5 puertas: Nodos, Director, Automático, AI Hub, MCP. Director /
Automático / AI Hub se conservaron porque tienen pantalla standalone
cuando no hay proyecto (F2); no son duplicados puros.

## Archivos

- `apps/desktop/src/app/navigation.ts` — import de `resolveViewRoute` +
  filtro en `SECONDARY_NAV_VIEWS`.
- `apps/desktop/src/app/navigation.test.ts` — test nuevo F3 (no-duplicación
  + colisiones permitidas sólo en las 3 duales).
- `apps/desktop/src/components/Sidebar.tsx` — tooltip de «Más» actualizado.
- `apps/desktop/src/App.test.tsx` — Motion/Efectos navegan por tab del
  editor; aserción de que Motion no está en «Más».
- `apps/desktop/src/features/motion/{MotionView,LottiePanel}.test.tsx` —
  `nav('Motion')` → click en tab del editor.
- `apps/desktop/e2e/app.spec.ts` + `e2e/helpers.ts` — aserciones negativas
  de las 6 etiquetas y comentario actualizado.
- `docs/UNIFICATION-PLAN.md`, `docs/IMPROVEMENT-QUEUE.md` — estado y evidencia.

## Verificación (ejecutada, no supuesta)

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run` navigation + view-routing + workspace-map + MotionView +
  LottiePanel → **24/24**.
- `npx vitest run src/App.test.tsx` → **74/74** (un fallo intermedio:
  «Efectos» matcheaba 2 tabs —el del editor y otra del inspector—;
  resuelto acotando al `tablist` «Modos de edición»).
- `npx playwright test e2e/app.spec.ts` → **4/4** en Chrome real.

## Siguiente paso

F4 del plan de unificación: hubs como panel del editor con retorno
persistente, paleta de comandos y atajos generados desde
`app/workspace-map.ts`, y onboarding de primera ejecución único.
