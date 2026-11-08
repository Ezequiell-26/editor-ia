# Plantillas de fábrica del stack de efectos (2026-11-08)

Pasada del loop de mejora (Devin CLI). Ítem del cotejo Drift
(`docs/DRIFT-PARITY.md` §5): «Drift trae 23 de fábrica; acá las plantillas
son del usuario (no hay catálogo curado)».

## Qué se hizo

- `apps/desktop/src/state/builtin-effect-templates.ts` (nuevo): catálogo
  curado de 12 plantillas de video + 15 de audio como datos
  (`{effectId, params}` por efecto). `builtinEffectTemplates(kind)` las
  resuelve contra `effectRegistry` en cada llamada con `createInstance`
  (ids nuevos siempre) y devuelve `EffectTemplate[]` — la misma forma que
  las del usuario, así `stackFromTemplate` las aplica con el mismo camino
  (normalización de params, efectos desconocidos fuera). Si un `effectId`
  deja de existir en el catálogo, la plantilla entera se omite.
- `features/vfx/EffectTemplates.tsx`: sección «De fábrica» arriba de la
  lista del usuario (que pasa a «Propias» cuando hay ambas), con Aplicar y
  Exportar por plantilla. El contador del `<summary>` suma ambas. Las de
  fábrica no se pueden borrar (son del catálogo, no del storage).
- `styles/effect-studio.css`: `.effect-templates-section` (rótulo de
  sección en versalitas).
- Copy honesto: el vacío del usuario ahora dice «Todavía no guardaste
  plantillas propias…» (antes sugería que no había plantillas en absoluto).

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.
- vitest `src/state/builtin-effect-templates.test.ts` **4/4** (catálogo por
  tipo, todas las recetas resuelven y se aplican completas con params
  normalizados, ids nuevos por resolución, separación video/audio) +
  `effect-templates.test.ts` **7/7** + `EffectTemplates.test.tsx` **6/6**
  (2 tests nuevos: aplicar «Look cine» con su stack y params de receta;
  sección «De fábrica» separada de «Propias»).
- Regresión dirigida: `features/vfx` + `AudioEffectStack` → **34/34**.

## Notas

- Las plantillas de audio aparecen en `AudioEffectStack` (misma pieza
  `EffectTemplates` con `kind="audio"`); las de video en `EffectStudio`.
- No se tocó Rust ni el contrato del servicio: es una capa de datos/UI
  sobre el registry que ya existía.
