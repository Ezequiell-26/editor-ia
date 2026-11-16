# 2026-11-11 (noche 2) — MCP codebase-memory + clúster de keyframes ‹ ◇ ›

## MCP codebase-memory (cómo usarlo bien)
- `index_repository { repo_path, mode:'moderate', async:true }` → estado
  `queued`; luego `index_status` hasta `ready`. Resultado: 16.129 nodos /
  61.042 aristas; scope `apps/desktop/src`: 6.632 / 24.021; 424 archivos NO
  indexados (truncado) → los conteos son piso.
- `get_architecture` con `aspects:['hotspots','cycles','overview']` y
  `path:'apps/desktop/src'` da lo importante sin ruido: hotspots por fan-in,
  ciclos y clústeres.
- **Cypher**: la propiedad de archivo es `file_path`, NO `path`. El dialecto
  NO soporta `NOT (pattern)` ni comparaciones de strings en `WHERE`
  (`a.name < b.name` falla). `OPTIONAL MATCH … WITH f, count(g)` sí funciona.
  `ORDER BY lines DESC` funciona; `NOT fn.is_test` falló → filtrar después.
- Hallazgos: 0 ciclos front, 0 huérfanos, 0 TODO real (las coincidencias eran
  «todo» en español), 3 `console.*` justificados. Monstruos:
  `RegularClipInspector` 5.369 líneas / 157 de complejidad, `DownloadView`
  4.097/201, `ExportDialog` 1.994/97. Informe:
  `docs/ANALISIS-FRONTEND-MCP-2026-11-11.md`.

## Implementado
- `Timeline.tsx`: `◇` entre `‹` y `›` — toggle real del keyframe de
  transformación en el playhead:
  `snapshotTransformKeyframes` decide; `captureTransformKeyframe` +
  `setTransformKeyframe` crean; `removeTransformKeyframe` quita.
  `store.mutate` exige receta que devuelva `{ project }` (no el documento).
- `TimelineClip`: diamantes de 5px por keyframe **sólo en el clip
  seleccionado** (`clipKeyframeFrames(clip).slice(0,80)`), posicionados con
  `(frame - clip.startFrame) * pxPerFrame`, `title` con timecode.
- CSS en `editor-clarity.css` (20px de ancho, ◇/◆ teal activo, marcador 5px).

## Verificación
- `Timeline.test.tsx` 29/29 (+2) · `keyframe-nav` 9/9 · `npm run typecheck` 0.
- Probe en vivo 1360×768 y 1280×720: 3 → 2 → 3 marcas al alternar, `aria-pressed`
  y tooltip correctos, notice «Keyframe agregado/quitado en 0:00:05:00»,
  0 errores de consola, `scrollWidth == clientWidth`.

## Gotchas
- **`createDemoProject` no sirve para verificar mutaciones**: usa IDs legibles
  y `parseProject` rechaza cualquier edición («entity ids must be uuid v4»).
  El error aparece en `.banner-error` y la edición no se aplica; el notice
  manual sí se muestra, así que parece que funcionó. Para el arnés: armar el
  proyecto con `createEmptyProject` + `addClipFromAsset`.
- `rea search EffectPlatform.dll "keyframe"` quedó colgado >5 min sin salida;
  se mató el proceso. No usar ese binario/consulta como evidencia.
- Para el próximo ciclo, prioridad del informe MCP: partir
  `RegularClipInspector` por pestaña (fases, con tests como red), luego
  `DownloadView`, `ExportDialog`, `AssistantDock` y consolidar capas CSS.
