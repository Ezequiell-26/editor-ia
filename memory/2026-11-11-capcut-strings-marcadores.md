# 2026-11-11 (noche 4) — Strings de CapCut 9.7.1 + navegación por marcadores

## CapCut: qué binario tiene qué
- Barrido ASCII + UTF-16LE de 6 binarios (<64 MB). Mapa completo en
  `docs/reference/capcut/03-ui-strings-2026-11-11.md`.
- `FusionUI.dll` (2,3 MB): 17.745 strings; `subtitle` 102, `wheel` 53,
  `marker` 39, `template` 10, `adjust` 6, `matting` 3. **No** hay keyframes ni
  marcadores de timeline: es UI Qt/QML y los «marker» son de `QUITreeView`.
- `EffectPlatform.dll` (1,5 MB): `favorite` 130, `search` 55, `sticker` 13,
  `template` 10, `beat` 9 → API de efectos con favoritos/búsqueda.
- `res_pool.dll` (8,8 MB): `search` 630, `favorite` 498, `template` 166,
  `nested` 139, `sticker` 30, `beat` 26, `beauty` 9, `avatar` 17 → pool de
  recursos con SQL (`_fav_scene`, `has_favorited`, `favorite_count`).
- `audioeffect.dll` (14 MB): `noise` 185, `beat` 102, `tracking` 93,
  `loudness` 69, `denoise` 64, `tts` 40.
- `CapCut.exe` (90 KB): launcher mínimo. `Qt6Qml.dll`: runtime Qt, no app.

## REA/Ghidra
- `rea search FusionUI.dll "Marker"` → 39 strings, ev
  `ev_8b6529c12f7d88b3531d3ecda1a255178bc6447884635cc59e506ab4af2f43f8`.
  Todas `QUITreeView` (`markerShowed`, `markerWidth`,
  `indentationMarkerFollowsCell`) → **resultado negativo** para timeline.
- `rea search EffectPlatform.dll "keyframe"` → colgado >5 min, descartado.
- `rea search res_pool.dll "favorite"` → lanzado; si no termina, el vocabulario
  de strings ya prueba la existencia de favoritos/búsqueda (no comportamiento).

## Grounding real de marcadores: AlaukCut
`frontend/js/marcadores.js`:
- API `proximo: () => irPara_(1)` / `anterior: () => irPara_(-1)`.
- `.marcador-regua` sobre la regla, arrastrables, estado `selecionado`,
  borrado con Delete, tooltip con tiempo.
- Sin colores por marcador (Olyvia ya tiene 8 + panel).

## Implementado
- `Timeline.tsx`: `‹` y `›` a los lados de «Marcador» con
  `previousMarker`/`nextMarker`, `title` con nombre + timecode, `disabled` en
  extremos, `setPlayhead` + notice. CSS: `.marker-step` comparte la métrica de
  `.kf-step` en `editor-clarity.css`.
- Tests nuevos en `Timeline.test.tsx`: salto 0→60→180→60 y flechas
  deshabilitadas sin marcadores.

## Verificación
`Timeline.test.tsx` 31/31 · `keyframe-nav` 9/9 · `npm run typecheck` exit 0 ·
probe en vivo 1360×768 y 1280×720: botones 20×24, 0→60→180→60, extremos
deshabilitados, notice correcto, 0 errores de consola, sin overflow.

## Próximo
Favoritos de efectos/transiciones (CapCut `EffectPlatform`/`res_pool`). Olyvia
tiene búsqueda en el rail, no favoritos de catálogo. Persistencia local +
filtro «Favoritos» en el panel de efectos/transiciones.
