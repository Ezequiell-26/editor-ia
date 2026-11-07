# 2026-11-07 — Preview OBS + UIs faltantes (RecordView, StickmanPanel, SubtitlePipeline)

## Cambios

- `screen_record_snapshot` + `obs_scene_preview`: frame PNG real de una escena
  OBS reutilizando los helpers de args de captura de `screen_record`
  (`gdigrab_input_args`, `dshow_video_args`). `-update 1` para salida de 1 frame.
  Verificado con ffmpeg real: PNG 1360×768 + ffprobe OK.
- `features/record/RecordView.tsx`: pestaña «Grabar» del hub Laboratorio
  (ViewId `record` → alias `lab/record`). UI real de screen_record + obs_scenes:
  captura desktop/ventana/región, FPS, webcam PiP, mic, encoder, RTMP,
  start/stop con cronómetro, escenas CRUD + preview + start.
- `features/motion/StickmanPanel.tsx`: UI del motor stickman (acción, duración,
  fps, tamaño, colores, partículas) → `stickman_render` → MP4 ffprobe.
- `features/localization/SubtitlePipelineCard.tsx`: pipeline automático
  video → whisper → traducción → .ass → burn-in en LocalizationView.

## Verificación

- cargo test screen_record: 7/7 · cargo check limpio
- vitest: RecordView 4/4, StickmanPanel 2/2, SubtitlePipelineCard 2/2,
  motion 40/40, localization 8/8, workspace-map 4/4
- tsc --noEmit limpio
- Commits: 64ee694, 1e9fe17, 7281595, 84116c8, bae671f, d80b8cd

## Hallazgo

Varios backends existían solo para MCP/agente sin UI (screen_record,
obs_scenes, stickman, subtitles_pipeline). Se cerraron los 4 con paneles
reales. Quedan sin UI directa: browser_instances, flow_generate,
voice_isolation (parcial via denoise), media_analyze — la mayoría son
superficies de agente por diseño.

## Pendiente

- Transiciones OBS en vivo (filtergraph multi-inputo)
- Editor visual del rig, física 2D, scopes en preview
- Grafos dentro del .olyp
- CARGO_HOME overlay en D:\Users\ofici\cargo-home (D:\DevCache\Rust\cargo
  sigue con ACL de solo lectura)
