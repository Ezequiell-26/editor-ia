# AlaukCut → Olyvia: gap analysis + safe-area presets (2026-11-09)

## Qué se hizo
- Análisis estático completo de AlaukCut (ver `memory/2026-11-09-alaukcut-architecture.md`):
  PyWebView + 105 JS vanilla + 57 `.pyc` (Api: 252 métodos RPC) + `motorcpp.pyd`
  (~100 exports nativos) + ffmpeg/whisper/RIFE/YuNet/MediaPipe bundled.
- Gap analysis documentado en `docs/reference/ALAUKCUT-GAP-ANALYSIS-2026-11-09.md`
  con matriz feature-by-feature y prioridades.
- **Implementado**: guías de área segura por plataforma en el monitor
  (`state/safe-area-presets.ts`, presets youtube/tiktok/reels/stories/shorts/feed,
  geometría normalizada cover+safe+title, aviso de desvío de aspecto).
  Preferencia `safeAreaPreset` persistida; select en toolbar del Preview.
  Tests: `safe-area-presets.test.ts` 6/6 + `editor-preferences.test.ts` 10/10;
  `npm run typecheck` OK. Entrada `[done]` al tope de IMPROVEMENT-QUEUE.md.

## Hallazgos clave de AlaukCut (para futuras pasadas)
- Firma para tutoriales: `cursor_mouse.js`/`cursor_estilos.js` (cursor
  estilizado 3 estilos × 4 colores + onda), `maozinha.js`/`tracado` (mano
  dibujando), `camera_inteligente.js` (auto-reframe con tracking, zoom ≤6×,
  curvas de suavizado), `rastreamento.js`+YuNet (tracking cabeza/región con
  blur de fondo), `molduras.js` (marcos de monitor).
- `rife-ncnn-vulkan.exe` bundled → interpolación de frames (MIT).
- Motor nativo C++/HLSL propio (`motorcpp.pyd`): preview por texturas crudas
  vía HTTP/WS local; shaders HLSL portados pixel-exacto del GLSL del front.
- Backend .pyc legible con marshal+dis (scripts en `.tmp-ref/alauk/`):
  `pycmap.py` (mapa de 57 módulos), `pycdetail.py` (Api 252 métodos + rutas
  servidor), `pycmotor.py` (exports motorcpp), `pycmain.py` (arranque).

## Spec detallada: cursor estilizado (próxima feature)

AlaukCut lo tiene en DOS modos (`frontend/js/cursor_mouse.js`,
`cursor_estilos.js`, usado por `gravar_tela.js` y `menu_topo.js`):
- `cursor_editar`: reemplaza el cursor de la propia app — CSS `image-set`
  con PNG generado por canvas (3 estilos: classico/cheia/3d × 4 colores ×
  tamaño × onda de click al pointerdown).
- `cursor_gravar`: al grabar pantalla empaqueta `{lado, px, py, bgra(b64),
  onda, cor_onda, borda_clara, raio_onda}` y el motor nativo quema el
  cursor + anillos de click en el video.
- En Olyvia: estilo de cursor en `RecordView` → overlay en el pipeline de
  captura o clip overlay en post. Assets de cursor propios (no copiar los
  PNG/SVG de AlaukCut). Schema: quizás `ClipKind` nuevo o efecto
  `cursor-overlay` con params (estilo, color, tamaño, onda).

## Layout AlaukCut (referencia para paridad de UX)
Región 0 top bar (menús Archivo/Versión/Atualização + tabs proyecto) ·
columna izquierda tabs (mídia/audio/texto/stickers/efeitos/transições/
legendas/filtros/animações/templates) · centro preview · derecha inspector
· región 4 timeline · columna IA derecha. Home = tarjetas de proyecto.
Detalle en `docs/reference/ALAUKCUT-GAP-ANALYSIS-2026-11-09.md`.

## Próximos candidatos (ordenados)
1. Cursor estilizado + indicador de clicks (overlay preview + export FFmpeg).
2. Tracking de objeto/cabeza (ONNX YuNet + tracker → keyframes/pin de efecto).
3. Auto-reframe (deriva del tracking).
4. Marcos de monitor (overlay PNG/SVG, el más barato).
5. Interpolación RIFE (evaluar binario externo vs `minterpolate`).

## Límites
- No se copió código ni assets propietarios; sólo patrones/features.
- Las zonas seguras son estimaciones de UI pública, no garantías de plataforma.
- Los overlays de guía son de preview; no afectan el render de exportación.
