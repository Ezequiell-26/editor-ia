# 2026-11-07 — Unificación F4 parcial: paleta desde el mapa (Editor IA)

## Qué se hizo

Pasada del loop de mejora (Devin CLI), slice acotado de la fase **F4** de
`docs/UNIFICATION-PLAN.md`:

1. **Paleta de comandos generada desde `workspace-map`.** `app/commands.ts`
   mantenía una lista manual de 15 vistas «principales» con etiquetas propias
   («Editor de video», «Guion y escenas», «Biblioteca») y el resto de las 18
   restantes salía de `NAV_VIEWS` plano, todo bajo la categoría «Navegar».
   Ahora los 33 comandos `nav.*` se generan desde `WORKSPACE_GROUPS`: orden
   por los 4 grupos (Preparar → Editar → Potenciar → Configurar),
   `category` = etiqueta del grupo (buscar «editar» encuentra las
   herramientas del grupo), `label` = etiqueta de `NAV_VIEWS`. Los 9 atajos
   `nav.*` personalizables se conservan en `NAV_SHORTCUTS`.
2. **Copy de primera ejecución corregido.** `WelcomeDialog` decía «Cinco
   pasos» desde antes de F1; ahora usa `WORKSPACE_STEP_COUNT` (6), el
   recorrido canónico único.

## Archivos

- `apps/desktop/src/app/commands.ts` — `NAV_BY_ID`, `NAV_SHORTCUTS`,
  generación desde `WORKSPACE_GROUPS`; helper `nav()` eliminado.
- `apps/desktop/src/app/commands.test.ts` — test nuevo: orden/categoría/
  etiqueta de los `nav.*` contra `WORKSPACE_GROUPS`.
- `apps/desktop/src/components/WelcomeDialog.tsx` — `WORKSPACE_STEP_COUNT`.
- `apps/desktop/src/components/WelcomeDialog.test.tsx` — fija «6 pasos».
- `docs/IMPROVEMENT-QUEUE.md`, `docs/UNIFICATION-PLAN.md` — estado y evidencia.

## Verificación (ejecutada, no supuesta)

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run` commands + workspace-map + navigation + view-routing +
  WelcomeDialog + CommandPalette (×2) → **34/34**.
- `npx vitest run src/App.test.tsx` → **74/74** (errores `canvas` de jsdom
  preexistentes, sin relación).
- Consumidores de la paleta usan ids `nav.*` (`CommandPalette`, `App.tsx`
  NAV_TARGET), no etiquetas ni la categoría «Navegar» — grep verificado.
- No se corrió la suite serial completa ni e2e en esta pasada.

## Siguiente paso (F4 restante)

- Hubs `download`/`creator`/`lab` como panel del editor con retorno
  persistente (T2 ya monta herramientas como panel: falta verificar
  cobertura de los 3 hubs).
- Atajos del cheat sheet agrupados por los grupos del mapa (hoy la categoría
  es «Navegación»/«Archivo»/etc. en `state/shortcuts.ts`, lista manual).
- Cierre del onboarding de primera ejecución con el recorrido único.
