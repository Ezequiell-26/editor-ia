# 2026-11-22 — Source monitor: insert al final (append)

## Cambio

`MediaSpyOverlay` suma el botón **`＋Fin`** junto a `Insertar`: monta el
rango marcado (o el still) **al final de la timeline**
(`atFrame = totalFrames(project)` dentro de `mutate`) en vez del
playhead. Mismo pin persistente, mismas marcas limpiadas, mismo
selector de pista.

## Detalles de implementación

- `insertMarkedRange(atEnd)` / `insertWholeAsset(atEnd)` — el flag
  elige `totalFrames(current)` vs `store.getPlayhead()`.
- `findGap` sigue ubicando dentro de la pista destino: append = primer
  hueco ≥ fin global en ESA pista.
- Tests existentes intactos: `querySelector('.media-spy-insert')`
  devuelve siempre el primero (playhead); los nuevos usan
  `querySelectorAll[1]` para `＋Fin`.

## Evidencia

- vitest `MediaSpyOverlay.test.tsx` **17/17** (test nuevo: clips en
  0–60 y 200–260 → `＋Fin` cae en 260, `Insertar` en 60).
- typecheck exit 0 · rebuild 8m37s · app PID 23016 · MCP OK.

## Residuales honestos del source monitor

- Sin modo overwrite (trim de clips existentes) — destructivo, queda
  como decisión de producto.
- Las marcas no se dibujan sobre la timeline (sólo ticks en el video).
