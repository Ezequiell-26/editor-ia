# 2026-11-11 (noche 9) — Plantillas: búsqueda + favoritos

## Implementado
- `catalog-favorites`: kind `template` (`template:split-4`).
- `FilmoraStates.tsx` → `SplitScreenTemplates`:
  - Nuevo prop `templates?: readonly SplitScreenTemplate[]` (default
    `SPLIT_SCREEN_TEMPLATES`), así el filtro vive en `EditorAssets`.
  - Cada tarjeta va en `.fm-split-template-wrap` con la tarjeta
    (`.fm-split-template-card`) + estrella `.catalog-fav`. No se puede anidar
    un `<button>` dentro de otro.
  - La estrella arranca con `opacity: 0` y aparece al hover/focus o si está
    activa, para no tapar la mini-previa.
  - Singular/plural: «1 plantilla» / «N plantillas».
- `EditorAssets.tsx`:
  - `visibleSplitTemplates` (búsqueda por label + filtro de favoritos).
  - Buscador + chip «Favoritos» + contador en la vista Plantillas.
  - `moduleCount` de Plantillas usa la lista filtrada.

## Bug visual que destapó el probe
`.catalog-search` se estiraba a ~180 px de alto en Plantillas: el contenedor
`.fm-rail-templates` es flex column y el buscador crecía. Se fijó con
`flex: 0 0 auto !important` + `height/min-height/max-height: 26px !important`.

## CSS
- `filmora-states.css`: `.fm-split-templates-grid > button` ya no aplica (hay
  wrapper). Se agregaron reglas equivalentes para `.fm-split-template-wrap` y
  `.fm-split-template-card`, y la opacidad de la estrella.
- `editor-clarity.css`: `.catalog-search` con altura fija.

## Verificación
`npm run typecheck` exit 0 · `EditorAssets` 13/13 (+1: buscar «simple» → 1,
marcar, limpiar, filtrar → 1) · `catalog-favorites` 4/4 · probe en vivo
1360×768 y 1280×720: 6 tarjetas + 6 estrellas, «simple» → 1 de 6, filtro → 1,
`localStorage` = `["template:split-4"]`, 0 errores de consola, sin overflow.

## Gotchas
- Al envolver las tarjetas, los selectores CSS `> button` dejan de matchear:
  hay que replicarlos para la clase nueva.
- El tooltip nativo del chip aparece en las capturas si el mouse queda encima;
  mover el mouse a (5,5) antes del screenshot.
- La composición real de la plantilla en la timeline sigue **pendiente**
  (motor de plantillas): esta vista sólo selecciona y ahora busca/favorece.

## Próximo
- Aplicar la plantilla split-screen a la timeline (N clips con máscaras por
  celda) — feature grande, no sólo UI.
- Partir `RegularClipInspector` (5.369 líneas) por pestaña, en fases.
