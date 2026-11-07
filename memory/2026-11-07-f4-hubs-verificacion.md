# 2026-11-07 — F4: hubs verificados como panel + fix «Volver al mapa»

Pasada del loop (Devin CLI). Slice de `docs/UNIFICATION-PLAN.md` fase F4:
la verificación medida de los 3 hubs (`download`/`creator`/`lab`) como panel
del editor con retorno persistente.

## Bug real encontrado

`App.tsx` → `clearTool` («Volver al mapa» del breadcrumb de una herramienta
embebida en modo `tools`) limpiaba `toolView`/`toolTab` pero NO restauraba
`activeId`. Quedaba en el host (`creator`, `lab`, `download`, `home`,
`projects`, `learn`, `mcp`) y `renderView` caía en el `case` standalone:
**el usuario salía del editor**, contra la unificación.

Fix: `setActiveId('editor')` en `clearTool`, igual que `openToolMap`.
Detectado porque el test nuevo midió 0 `.editor-tool-chip` tras volver.

Regla para futuras superficies embebidas: cualquier camino que "vuelva al
mapa/modo tools" debe dejar `activeId='editor'`; `renderView` decide la
superficie por `activeId`, no por `editorMode`.

## Verificación

- `npx tsc --noEmit -p apps/desktop` → 0 errores.
- `npx vitest run src/App.test.tsx` → **76/76** (74 antes + 2 nuevos).
- Tests nuevos en describe T2: hubs como panel con timeline + retorno
  (`Volver al mapa` → 35 chips; `Volver a Edición` → modo timeline), rail
  `aria-current` en el host, y aliases `factory`/`upscale` → pestaña
  inicial correcta vía `initialTab`+`requestId`. Timeouts de 20 s por los
  chunks lazy (convención del archivo).

## Estado F4

Queda sólo el cierre del onboarding de primera ejecución con el recorrido
único (`WORKSPACE_STEPS` de `app/workspace-map.ts`).
