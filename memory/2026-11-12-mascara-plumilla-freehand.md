# Máscara de plumilla (freehand) en el editor

## Qué se implementó

- Nuevo `shape: 'freehand'` en `ClipMaskSchema` (`packages/project-schema/src/timeline.ts`):
  comparte `points` con `polygon`, pero admite hasta `MAX_FREEHAND_MASK_POINTS = 64`
  (polygon sigue en `MAX_POLYGON_MASK_POINTS = 16`, impuesto en `superRefine`).
- `state/mask-draw.ts`: `smoothMaskStroke(points, max)` — spline cerrada de
  Catmull–Rom → muestreo denso (8 pasos/segmento) → remuestreo uniforme por
  longitud de arco a ≤64 puntos, clamp 0..1. `simplifyMaskPoints` (Douglas–Peucker)
  sigue existiendo para polygon y para decimar freehand→polygon en el Inspector.
- `Preview.tsx`: el modo «dibujar máscara a mano» ahora guarda `freehand` (antes
  `polygon` de ≤16 puntos, muy dentado). Preview en vivo muestra el trazo ya
  suavizado. `maskPolygon`/`maskClipPath`/`maskImage`/`maskStrokeSvg` tratan
  `freehand` igual que `polygon` (puntos absolutos + offset x/y, sin expand,
  sin rotación, sin stroke).
- `Inspector.tsx`: opción «Plumilla (trazo libre)» en Forma (si no hay puntos arma
  el modo dibujo; si hay, conserva el contorno). Al volver a `polygon` decima a
  16 con `simplifyMaskPoints`. `maskSeedRect` incluye freehand (bbox para IA).
- `VfxView.tsx`: el overlay de keyframes/mask trata freehand como polygon.
- Rust `render/ffmpeg/visual/masks.rs`: `freehand` se agregó al `matches!` y al
  branch de polygon — IMPRESCINDIBLE: sin eso `mask_filter` devolvía `None` y la
  máscara se perdía en silencio en el export. `projects/service.rs` NO valida
  máscaras (0 matches de "mask"), así que no requirió cambios.

## Ojo / límites

- `motion.rs` (capas de texto/motion graphics, shapes `custom`/`line`) tiene su
  propio límite de 16 puntos — es OTRO schema, no tocar.
- Costo del `geq`: crece lineal con segmentos; 64 puntos ≈ 4× un polygon de 16.
  Aceptable para clips puntuales, no para mascar todo un timeline.
- `cargo test` del crate quedó bloqueado por un error PRE-EXISTENTE ajeno:
  `commands/domains/audio/transcribe.rs:687-688` — `(60.0*10.0).clamp(...)`
  ambiguo (float sin sufijo) en código WIP de otro frente. `cargo check` de la
  lib (sin cfg test) verifica masks.rs; el test nuevo `freehand_mask_shares_the_
  polygon_path` queda pendiente de correr cuando ese archivo compile.
