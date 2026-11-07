# 2026-11-06 — Profiling con carga real (tarea 9g)

Mediciones reales en el equipo (Windows, Ryzen, 1360×768 de escritorio):

## Codificación x264 (proxy del render)
- `testsrc 1920x1080@30`, 10 s de vídeo:
  - ultrafast: 2038 ms wall (~4.9× realtime)
  - veryfast: 2207 ms (~4.5×)
  - superfast: 2112 ms (~4.7×)
- Conclusión: los presets están dentro del ruido a 1080p; `veryfast` (default del render) es correcto. No se justifica cambiar preset sin una escena con filtros pesados.

## Grabación de pantalla (gdigrab, feature 9e)
- 30 fps durante 10 s: 298/300 frames entregados, wall 10.27 s → captura realtime real.
- ffmpeg RSS ~300 MB durante la captura. Sin audio de escritorio (requiere virtual cable).

## Navegador embebido WebView2
- Flota típica con app + sesión Flow: ~500 MB en 8 procesos msedgewebview2 (main, GPU, renderers). Costo Chromium esperado; cada sesión web tiene su propio user-data-dir (aislamiento + fix del bug 0x8007139F).

## Optimización evidenciada
- Payload `mcpTools` al proveedor: 49435 B (fallaba budget 49152) → **46373 B** tras compactar `annotations` (sólo flags en true) + recorte de descripciones MCP.
- Ahorro ~3 KB por llamada al LLM (~6% del payload de tools), verificado por `AssistantDock.test` y `assistant-budget.test`.

## Sin acción (evidencia en contra de cambios especulativos)
- Presets x264: diferencia <8% → no tocar.
- gdigrab: 99.3% frames → no tocar.
