# 2026-11-08 — Reproductor del material compartido (Editor IA)

Pasada del loop de mejora (Devin CLI). Cierra el «pendiente honesto» de la
pasada del scrub del metraje (`2026-11-08-preview-material-autoedit-scrub.md`):
cada variante montaba su propia copia del `<video>` por fuente (hasta 24
elementos en el peor caso).

## Qué se hizo

- `AutoEditView.tsx`: `SourceUsageRow` ya no renderiza `<video>`; la barra
  temporal llama `onPreviewSeek(assetId, segundos)`. Nueva sección
  `Reproductor del material` fuera de las tarjetas con un `<video>` por
  fuente que aporta cortes a alguna variante (`previewSources` = unión de
  `cuts[].assetId` de `finalVariants` ∩ `sources`, máx. 6 por
  `MAX_SOURCES`). `seekPreviewSource` hace seek + `scrollIntoView` (guarda
  para jsdom/WebViews sin implementar) + `play()` con la misma política de
  autoplay de antes. Sin URL reproducible la sección no se monta y las
  filas conservan sus avisos honestos.
- `styles/app.css`: `.auto-src-player*`, `.auto-src-shared-hint`.
- Test actualizado: exige 1 solo `.auto-src-video` con 4 mapas, 0 dentro de
  `.auto-src-map`, y verifica seek a ~5 s + `play()`.

## Verificación (ejecutada)

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.
- `npx vitest run src/features/autoedit` → **43/43** (13 en la vista).

## Límites

- El reproductor es por fuente, no por variante: el usuario ve el metraje
  original completo con sus controles; el mapa de cada tarjeta sigue
  mostrando qué tramos entran (la barra salta al segundo clicado).
- `scrollIntoView` puede no existir en jsdom/WebView viejas: guardado con
  try/catch, el seek ya ocurrió antes.
- **No se commiteó el WIP ajeno**: `Cargo.toml` y
  `commands/audio_scopes.rs` (microbenchmark `release-nolto`) quedaron
  intactos y fuera del commit.
