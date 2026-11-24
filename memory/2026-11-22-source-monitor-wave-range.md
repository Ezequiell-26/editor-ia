# 2026-11-22 — Source monitor: rango I/O sombreado sobre la waveform

## Cambio

`MediaSpyOverlay`: con pin activo y waveform decodificada, las marcas
in/out sombrean la tira — selección tintada cyan, resto atenuado.
Proyección `t / durationSeconds * N` buckets (la onda cubre el asset
completo). Sólo-I → [in, fin]; sólo-O → [0, out].

## Detalles

- Rects de rango renderizados antes que los picos → barras encima.
- Clases `media-spy-wave-dim` / `media-spy-wave-sel` en
  `editor-tools.css` (especificidad clase+clase > `.media-spy-wave rect`).
- No testeable en jsdom (useWaveform no decodifica sin servicio real);
  verificación visual queda para la app.

## Evidencia

- vitest overlay+media-spy **23/23** · typecheck 0 · rebuild 6m49s ·
  app PID 36300 · MCP OK.
