# Smart reframe desde la timeline + tools MCP (pasadas 339–341)

Fecha: 2026-11-23 · Rama: architecture/refactor-foundation (sin commitear)

## Qué se construyó

El smart reframe (crop vertical 1080×1920 siguiendo al rostro con
SeetaFace + expresiones FFmpeg) ya existía para **archivo→short**
(`export_short`, usado por Director). Faltaba el puente desde la
timeline: editar un clip y exportarlo como vertical sin re-seleccionar
el rango crudo.

- `state/clip-short-export.ts`: `clipShortExportRange(project, clip,
  limits?)` mapea `source.inFrame/outFrame` → segundos del medio
  (`/fps` del proyecto — misma convención que
  `render/ffmpeg/plan/range.rs`). Guards: video, fuente asset,
  speed 1×, no reverse. Límites parametrizables:
  `SHORT_LIMITS` (3–90 s, los de `export_short`) y
  `FACE_TRACK_LIMITS` (0.1–600 s, los de `analyze_face_track`).
- `Timeline.tsx`: menú contextual del clip → «Exportar como Short…»
  (deshabilitado con tooltip=razón). Detecta `seeta-face` vía
  `listModels`, elige carpeta, llama `exportShort`, reporta el modo
  real (`result.reframe`).
- Tools MCP nuevas:
  - `clip_export_short {clipId, outputDir?, label?, smartReframe?}`
    (destructive) — exporta el clip como short vertical.
  - `clip_face_track {clipId}` (read) — track de caras de la ventana
    fuente, para planear el reframe antes de exportar.

## Límites honestos (importantes)

- Exporta el **footage fuente** del clip (inFrame..outFrame), NO el
  clip compuesto: overlays, títulos y efectos de la timeline no viajan
  al short.
- Speed ≠1× y reverse quedan rechazados: la ventana fuente no coincide
  con lo que se ve.
- Smart reframe sobre la **timeline completa** en el export principal
  sigue pendiente: exige inyectar crop x/y por clip en
  `render/ffmpeg/visual/filter.rs` (hoy `fit=cover` hace crop centrado
  estático) + orquestar `analyze_face_track` por fuente/ventana +
  rebase de expresiones a frames del clip. Feature de sesión dedicada.

## Verificación

- `clip-short-export.test.ts`: 6/6 (mapeo de segundos, límites,
  speed, reverse, sin fuente).
- mcp-tools + clip-short-export: 78/78 · typecheck exit 0 ·
  cargo check/fmt limpios · builds debug OK · app relanzada con MCP UP.

## Lecciones

- `inFrame`/`outFrame` están en frames de fps de proyecto; segundos =
  frames / fps_proyecto (convención compartida por preview, inspector
  y render plan).
- `clipShortExportRange` con `limits` parametrizable evita duplicar el
  mapeo clip→rango para análisis (600 s) vs exportación (90 s).
