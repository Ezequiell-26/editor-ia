# 2026-11-08 — Preview por corte en el editor automático

Pasada del loop de mejora (Devin CLI). Ledger cerrado; ítem elegido del
«Pendiente honesto» «preview antes de aplicar» de `docs/IMPROVEMENT-QUEUE.md`
(declarado en los lotes de umbrales configurables y de exportación por lote).

## Cambio

`AutoEditView.tsx`: la lista «Ver los cortes» de cada variante gana un botón
«Ver el corte N» por fila que llama a `seekPreviewSource(cut.assetId,
cut.startSeconds)` — el mismo reproductor `<video>` compartido por fuente
que ya usan el mapa del material y su barra clickeable. Sin copias extra de
video, sin backend nuevo. Sólo aparece cuando el asset tiene URL de preview;
la `<ol>` lleva `watchable` y un `fine-print` explica el botón.

`app.css`: `.auto-cut-list.watchable` (y `.watchable.with-src`) reserva la
columna del botón; `.auto-cut-watch` ghost 20 px; `span:last-child` →
`span:last-of-type` para que el puntaje siga alineado a la derecha.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/autoedit` → 44/44 (+1 test nuevo en
  `AutoEditView.test.tsx`: botones presentes, `data-start`/`data-end` del
  corte real, click → `currentTime` al inicio del corte + `play()`).

## Límite

Seek al inicio del corte con el video compartido; no hay reproducción
continua de la variante completa ni ventana limitada al corte.
