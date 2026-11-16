# 2026-11-11 (noche 5) — Favoritos del catálogo + grilla de transiciones

## Grounding CapCut
- `EffectPlatform.dll` / `res_pool.dll` exponen favoritos a nivel plataforma:
  `favorite_count`, `has_favorited`, `_fav_scene`, tablas SQL de favoritos y
  búsqueda. Olyvia ya tenía favoritos de MEDIOS (dentro del `.editoria.json`,
  `toggleAssetFavorite`), no del catálogo de efectos/transiciones.

## Implementado
- `state/catalog-favorites.ts`:
  - Clave `kind:id` (`effect:soft`, `transition:iris`) para evitar colisiones.
  - Persistencia en `localStorage` con clave `olyvia.catalog-favorites.v1`.
  - `useSyncExternalStore` + `subscribeCatalogFavorites`; el snapshot se cachea
    y sólo cambia al alternar (referencia estable).
  - Tolera JSON corrupto, storage bloqueado o inexistente (SSR).
  - `resetCatalogFavoritesForTests()` para aislar tests.
- `EditorAssets.tsx`:
  - `catalogFavoritesOnly` + `useCatalogFavorites()`.
  - Chip «Favoritos» + contador «N de M» en Efectos y Transiciones.
  - Estrella por tarjeta: en Efectos la tarjeta se envuelve en
    `.preset-card-wrap` porque no se puede anidar un `<button>` dentro de otro.
  - Filtro independiente de `favoritesOnly` (medios). `changeView` lo resetea.
  - Empty state cuando el filtro no tiene favoritos.
- CSS en `editor-clarity.css`:
  - `.catalog-fav-bar`, `.catalog-fav-filter`, `.catalog-fav-count`.
  - `.preset-card-wrap`, `.catalog-fav` (18×18, `min-height:0` porque una regla
    global lo estiraba a 24).
  - **`.transition-grid` / `.transition-card` no existían en ninguna hoja**:
    las tarjetas se apilaban como bloques. Ahora grid de 2 columnas, preview
    `.tp` de 46px, descripción clamp 2 líneas, acciones compactas.

## Verificación
`npm run typecheck` exit 0 · `catalog-favorites.test.ts` 4/4 ·
`EditorAssets.test.tsx` 10/10 (+1: marcar, filtrar y persistir) · probe en vivo
1360×768 y 1280×720: 9 tarjetas/9 estrellas, filtro «1 de 9», localStorage
`["effect:soft"]`, 42 transiciones en 2 columnas de 100px, 0 errores de consola,
`scrollWidth == clientWidth`.

## Gotchas
- «A todos» no entra en la columna de 100px y se cortaba a «A»: se acortó a
  «Todos» (el `title` conserva la explicación).
- `.catalog-fav` necesitaba `height/min-height` con `!important`: una regla
  global de botones lo llevaba a 24px de alto.
- El `<button>` de la tarjeta de efecto no admite otro `<button>` dentro: de
  ahí el wrapper `.preset-card-wrap`.
- En el probe, el tooltip nativo del chip aparece en la captura si el mouse
  quedó encima; no es un solapamiento de CSS.

## Próximo
- Favoritos en Filtros/Ajustes/Plantillas (mismo módulo, sólo agregar kinds).
- Búsqueda dentro del catálogo de efectos (CapCut `search` 630 strings en
  `res_pool.dll`).
