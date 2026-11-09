# 2026-11-09 — Quality Gate verifica el MP4 renderizado

## Qué se hizo

`review_stage` (render_executor.rs) ya no valida sólo el documento del
proyecto: `media_findings` sondea el MP4 real con ffprobe/ffmpeg.

Checks emitidos (taxonomía `QualityCheckKind` existente):

- `resolution` (error): dimensiones del render vs `video.width/height`.
- `render-verify` (error >2 s, warning >0.5 s): duración del render vs
  fin de la última clip de la timeline (`max(start+duration)/fps`).
- `loudness` (error >3 LU, warning >1 LU): loudness integrado LUFS via
  `ffmpeg -af ebur128` vs `quality.loudnessTargetLufs` del plan.
- Herramienta ausente o medición imposible => warning honesto, nunca
  medición simulada.

`parse_integrated_lufs` es función pura con 3 tests unitarios
(render_executor::unit_tests).

## Evidencia

- `cargo check --tests`: 0 errores · `cargo fmt --check`: limpio.
- E2E `production_e2e_runs_all_stages_to_deliverables` con ffmpeg real:
  ok (sin falsos positivos de resolución ni duración).
- verify-studio.mjs completo tras media_findings: TODO VERDE
  (12/12 live + 7/7 E2E).

## Notas de entorno

- `cargo test`/`check` DEBEN ir por `node scripts/rust-env.mjs --` con
  `CARGO_HOME=D:\Users\ofici\cargo-home`; el CARGO_HOME default
  (`D:\DevCache\Rust\cargo`) tiene ACL que niega escritura.
- Un `cargo test` con CARGO_HOME distinto invalida fingerprints y
  recompila todo el árbol (~9 min). No mezclar.

## Pendiente

- Check `color` (pix_fmt/color space) sin definir aún qué medir.
- Providers remotos de vídeo/música: requieren decisión de endpoint.
- Rebuild del instalador para incluir estos cambios (deliverables/final
  tiene el build anterior al quality gate de media).

## Addendum — check `color` + tags BT.709 en el render

- `MediaMeasure` ahora expone `pixFmt`, `colorSpace`, `colorTransfer`,
  `colorPrimaries` (parse_probe, aditivo en serde).
- `media_findings` emite `color` (warning): pix_fmt fuera de la lista de
  entrega habitual, pix_fmt ausente, o stream sin tags de color.
- El render MP4/MOV en 4:2:0 de 8 bits ahora escribe tags BT.709:
  `-color_primaries/-color_trc/-colorspace bt709` + bitstream filter
  `h264_metadata`/`hevc_metadata` (los encoders del bundle LGPL no
  escriben el VUI completo; verificado contra ffmpeg real:
  pix_fmt=yuv420p, color_space/transfer/primaries=bt709).
- WebM y formatos 10-bit/444 no se taggean (fuera del perfil SDR).
- Evidencia: render::ffmpeg 138/138 · E2E producción ok ·
  ffmpeg manual con los mismos args produce los 3 tags.

## Verificación E2E de tags BT.709

- `render_live_pipeline_produces_a_verified_mp4` (live, EDITOR_IA_RUN_RENDER_TESTS=1):
  ok — el build_plan produce MP4 verificado con los nuevos args.
- Prueba manual ffmpeg+libopenh264 con los mismos args: los 3 tags
  (color_space/transfer/primaries) quedan en bt709.
- El ffmpeg de DEV sí tiene libx264; el bundle LGPL usa openh264/MF —
  por eso el bsf h264_metadata es necesario en producción.
- Limitación honesta: el taggeado se verificó con ffmpeg manual y el
  camino de args está cubierto por tests; el MP4 del E2E se borra al
  terminar el test, no se probeó el archivo final del pipeline.

## node_modules aislado (2026-11-09 noche)

`editor-ia-architecture/node_modules` era junction al repo hermano —
causa raíz de los drift de @editor-ia/*. Resuelto con `npm ci` tras
confirmación del usuario: node_modules real propio, links correctos
permanentes. Ya no hace falta re-verificar junctions antes de buildear.
