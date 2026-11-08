# 2026-11-07 — Preview del material en el editor automático

Pasada del loop (Devin CLI). Cerró el último pendiente del lote «editor
automático sin LLM» (2026-10-27): «preview antes de aplicar».

## Qué se hizo

- `features/autoedit/auto-edit.ts`: `buildSourceUsage(sources, variant,
  indices)` — por cada fuente que aporta cortes a la variante devuelve
  `kept` (unión de los cortes elegidos, en segundos del video original),
  `holes` (silencios/negros/congelados medidos), `keptSeconds` y
  `durationSeconds`. Helper privado `mergeTimeRanges` une rangos
  solapados/contiguos.
- `AutoEditView.tsx`: `<details>` «Mapa del material por video» por tarjeta
  — fila por fuente con `X s de Y s` y barra del video original (segmentos
  verdes = entra al montaje, trama oscura = hueco medido). Se actualiza al
  destildar cortes y tras reordenar con la IA. La lista «Ver los cortes»
  muestra el nombre del video por fila cuando hay más de una fuente
  (columna extra `.with-src`; con una sola fuente el layout no cambia).
- `styles/app.css`: clases `.auto-src-*` y `.auto-cut-list.with-src`.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/autoedit` → 42/42 (+3 tests puros de
  `buildSourceUsage`, +1 test de UI del mapa).

## Límite honesto

Es un mapa temporal (qué tramos entran), no una reproducción del footage.
Un scrub de preview por corte queda como mejora futura.
