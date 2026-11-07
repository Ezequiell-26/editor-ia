# 2026-11-07 — Unificación F4 (2ª parte): atajos del cheat sheet por grupo (Editor IA)

## Qué se hizo

Pasada del loop de mejora (Devin CLI), segundo slice de la fase **F4** de
`docs/UNIFICATION-PLAN.md`:

- **`ShortcutsCheatSheet` agrupa los atajos `nav.*` por el mapa del estudio.**
  Antes los 9 atajos de navegación vivían bajo una única sección plana
  «Navegación». Ahora cada `nav.<view>` resuelve su `ViewId` con
  `workspaceGroupFor` (la misma fuente que usa la paleta de comandos en
  `app/commands.ts`) y se muestra como «Navegación · Preparar»,
  «Navegación · Editar», «Navegación · Potenciar» o
  «Navegación · Aprender y ajustar». El prefijo «Navegación ·» evita la
  colisión con la categoría «Editar» de los atajos `edit.*` (ambos grupos se
  llamarían «Editar» sin él).
- El filtro por categoría «Navegación» (9 atajos) y la búsqueda no cambian:
  `categoryKey` sigue siendo `nav`; sólo cambia la clave de agrupación visual.

## Archivos

- `apps/desktop/src/components/ShortcutsCheatSheet.tsx` — campo
  `workspaceGroup` en `ExtraShortcutItem`, resolución vía
  `workspaceGroupFor`, clave de grupo `Categoría · Grupo`.
- `apps/desktop/src/components/ShortcutsCheatSheet.test.tsx` — test nuevo,
  4 casos: subdivisión por grupo, ausencia de la sección plana, filtro
  «Navegación» completo y búsqueda.
- `docs/IMPROVEMENT-QUEUE.md`, `docs/UNIFICATION-PLAN.md` — estado y
  evidencia.

## Verificación (ejecutada, no supuesta)

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/components/ShortcutsCheatSheet.test.tsx` → **4/4**.
- `npx vitest run` workspace-map + commands + navigation + view-routing →
  **21/21**.
- No se corrió la suite serial completa ni e2e (cambio acotado a un
  componente lazy de UI; los tests de App no referencian el cheat sheet).

## Detalle de diseño

- `workspaceGroupFor` devuelve `undefined` para vistas fuera del mapa; en ese
  caso el item cae a la sección de su categoría (comportamiento anterior).
- El orden dentro de cada grupo sigue el orden de `DEFAULT_SHORTCUTS`
  (Ctrl+1…Ctrl+9), que coincide con el orden relativo de `WORKSPACE_GROUPS`.

## Siguiente paso (F4 restante)

- Verificación medida de los 3 hubs (`download`/`creator`/`lab`) como panel
  del editor con retorno persistente: T1 ya los monta vía
  `EDITOR_TOOL_HOSTS` → modo `tools` en `view-routing.ts`; falta la evidencia
  (test/e2e o medición).
- Cierre del onboarding de primera ejecución con el recorrido único.
