# 2026-11-08 — Scrub del metraje real en el mapa del material (autoedit)

Pasada del protocolo del loop (Devin CLI). Cierra el pendiente honesto de la
pasada del 2026-11-07 («un scrub de preview por corte queda como mejora
futura si se quiere ver el footage real»).

## Cambio

- `features/autoedit/AutoEditView.tsx`: la fila de cada fuente del «Mapa del
  material por video» pasó a `SourceUsageRow`. La barra temporal es un
  `<button>`: clic = seek al segundo (`clientX/ancho × duraciónSeconds`) +
  `play()` guardado (autoplay policy / jsdom). Debajo, un
  `<video controls preload="metadata" playsInline>` con
  `service.mediaUrl(root, proxy?.path ?? asset.source.path)` — el mismo
  criterio que `Preview.tsx`.
- `previewUrls` (useMemo): assetId → URL o null. `mediaUrl` devuelve `''`
  en modo navegador → la fila muestra «La vista previa del video está
  disponible en la app de escritorio.»; si el asset ya no está en
  `videoAssets` → «El medio ya no está en el proyecto.» Sin archivo
  reproducible no se monta `<video>`.
- `styles/app.css`: `.auto-src-map-track` como botón (reset + hover +
  focus-visible), `.auto-src-video` (máx. 140 px), `.auto-src-no-preview`.

## Verificación

- `npx vitest run src/features/autoedit/` → **43/43** (3 archivos).
  `AutoEditView.test.tsx` 13/13: test del mapa actualizado (`img`→`button`,
  mismo nombre accesible base) + test nuevo que verifica `src` del `<video>`,
  `currentTime ≈ 5` tras clic al 50 % de una barra de 10 s y llamada a
  `play()` (spy sobre `HTMLMediaElement.prototype.play`).
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.

## Pendiente honesto

- Cada variante monta su propia copia del `<video>` por fuente (hasta 4×6 en
  el peor caso) con `preload="metadata"`; si el coste se nota, compartir un
  único reproductor por fuente fuera de las tarjetas.
- El seek reproduce el metraje ORIGINAL del asset (con proxy si existe), no
  la variante con sus cortes/zoom/transition — es vista del material, no del
  montaje.
