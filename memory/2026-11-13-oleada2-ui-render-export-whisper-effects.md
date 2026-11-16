# 2026-11-13 — Oleada 2: UI de comandos nuevos, render_export, whisper UX, concat-effects

## Conectado en esta oleada

- **UI MCP audit + worker**: `McpAuditLog.tsx` en McpView (entries newest-first, filtros 25/50/100) + `ConcatWorkerCard.tsx` en Settings→Herramientas (ping real). Contratos completos en services/platform/fake-service. 19 tests.
- **`render_export` en concat-worker**: op real con clips (path/in/start/duration/x/y/w/h/fit/audio), canvas/fps/codec/preset/crf. Compositing CPU bilineal RGBA + audio mix AAC. Verificado: MP4 h264 320x240@15fps con ffprobe. SIN transiciones/efectos/keyframes (MVP honesto). `concat-export` no está vendorado (depende de vision/ONNX).
- **Whisper model UX backend**: `whisper_model_status` + `whisper_model_download(model_id)` con evento `whisper-model-download` (progreso real ~2MB del crate). `NativeDownloadTracker` cubre descargas implícitas. `capabilities` reporta ambos motores (whisper.cpp + faster-whisper). `subtitles_pipeline` usa nativo primero. 20/20 tests.
- **concat-effects → app**: 25 efectos de audio `concat.*` integrados end-to-end (TOML→codegen `generate-concat.ts`→catalog→compile TS→export FFmpeg vía `concat_effects::catalogue` del crate). Paridad exacta con 75 fixtures. 107 paquetes WGSL restantes inventariados en `concat-packages.ts` (sin backend FFmpeg ni preview WebGL2 — pendiente real).

## Verificación consolidada

- `cargo check --lib`: verde (4m43s full).
- `tsc` desktop + effect-kit: limpio.
- architecture-rules 13/13 + ci-workflows 12/12.
- Tests: worker 13/13, transcribe 20/20, concat audio 62, effect-kit 68, mcp/settings 74.

## Pendientes

- UI para `whisper_model_status`/`download` (event listener + panel) — comandos listos.
- `whisper_model_download_cancel` (~10 líneas sobre `cancel_download` del crate).
- concat-effects: preview Web Audio para `concat.*` (sonarán secos en preview); 107 paquetes WGSL (57 filtros + 28 efectos + 22 transiciones) sin camino FFmpeg.
- render_export: sin documento/efectos/transiciones; CPU-only; audio sin fades.
- concat-worker no está en tauri.conf resources (empaquetado pendiente).
