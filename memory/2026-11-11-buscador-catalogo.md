# 2026-11-11 (noche 6) — Buscador del catálogo + favoritos en Filtros

## Implementado
- `EditorAssets.tsx`:
  - `catalogQuery` independiente de `query` (medios). `changeView` lo resetea.
  - Componente `CatalogSearch` (icono, `aria-label`, botón «Limpiar búsqueda»),
    reutiliza `.rail-search` + `.catalog-search`.
  - Filtros: Efectos por `label`; Transiciones por `label + description`;
    Filtros/Ajustes por `label`.
  - Favoritos en Filtros: nuevo kind `look` (`CatalogFavoriteKind`), estrella
    por tarjeta con wrapper `.preset-card-wrap`, chip + contador «N de 6».
  - Ajustes reutiliza `visibleLooks` y suma el mismo buscador (sin chip de
    favoritos: el foco de esa vista es la capa).
- CSS en `editor-clarity.css`: `.catalog-search` (26px, borde, focus teal).

## Bug real que encontró el test
`visibleLooks` sólo filtraba por `treeFilter` + `catalogTerm`; faltaba
`catalogFavoritesOnly`, así que el chip «Favoritos» no filtraba los looks.
El test `marca un filtro como favorito y lo filtra` falló con 6 en vez de 1 y
lo destapó. Corregido agregando la condición y las deps
`[catalogFavorites, catalogFavoritesOnly, catalogTerm, treeFilter]`.

## Verificación
`npm run typecheck` exit 0 · `catalog-favorites` 4/4 · `EditorAssets` 12/12
(+2: búsqueda de transiciones con limpiar, y favorito de filtro) · probe en
vivo 1360×768 y 1280×720: «noir» → 1 de 9, Filtros 6 → 1, «iris» → 1 de 42,
`.catalog-search` 24px, 0 errores de consola, `scrollWidth == clientWidth`.

## Gotchas
- El tooltip nativo del chip aparece en las capturas si el mouse quedó encima;
  no es solapamiento de CSS.
- `getByRole('searchbox', { name: /Buscar transición/i })` funciona porque el
  `aria-label` es igual al placeholder.
- Los tests de `EditorAssets` deben limpiar `localStorage` y llamar a
  `resetCatalogFavoritesForTests()` en `afterEach`.

## Próximo
- Favoritos en Plantillas (split-screen) y en el catálogo de títulos.
- Búsqueda por descripción en Efectos (hoy sólo label).
