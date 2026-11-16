# 2026-11-12 — Oleada de conexión: Concat worker, speech nativo, CI gates, timeline tools, máscara plumilla

## Qué se conectó (antes huérfano → ahora productivo)

- **concat-worker → app**: `apps/concat-worker` (proceso JSON-lines stdin/stdout, workspace propio por conflicto `links="ffmpeg"`) ahora tiene cliente en `infrastructure/concat_worker.rs` + port `ports/concat_worker.rs` (`ConcatWorkerBackend`/`ConcatWorkerSession`) + sesión global en `application/concat_worker.rs` + comandos `concat_worker_status` / `concat_worker_request` (allowlist: ping, probe, decode_frame, shutdown). Backend inyectado vía `state.concat_worker_backend()` (composition root en state.rs). Tests spawnean el worker real: 12/12 verdes.
- **concat-speech-min → transcribe**: `transcribe_asset` intenta whisper.cpp in-process (modelo ggml descargado con SHA-256 a `<config>/whisper-models`, FFmpeg→PCM 16kHz, VAD Silero) y cae a Python faster-whisper ante cualquier fallo. `TranscriptionResult.engine` = "native"/"python". Skip honesto >30min → Python. 14/14 tests, cargo check verde.
- **mcp_audit_tail**: comando que lee `mcp-audit.jsonl` (últimas N, re-sanitizado con `sanitize_audit_args`). Primer paso para hacer visible el audit MCP.
- **CI**: `audit:security` dentro de `verify`; `test:studio` alias; verify.yml corre 446 tests vendor/concat (core+project+effects+log) + Playwright e2e (24 tests, sin css-audit). Informe en `docs/verification/2026-11-12-quality-gates.md`.
- **Timeline**: herramientas slip (Y), slide (T), roll (N) con gestos de arrastre en Timeline.tsx — operaciones frontend puras sobre source.inFrame/outFrame que el render FFmpeg ya respeta. 230 tests verdes.
- **Máscara plumilla**: `shape:'freehand'` en schema (≤64 puntos), spline Catmull-Rom en `state/mask-draw.ts`, preview + Inspector + `render/ffmpeg/visual/masks.rs` (~5 líneas, sin eso se perdía en export).

## Decisiones y fixes del coordinador

- Refactor ports: `application/concat_worker` violaba la regla application↛infrastructure → se creó `ports/concat_worker.rs` y `SystemConcatWorker` en infrastructure, inyectado por `state.rs`. Patrón estándar del repo.
- `loudness.rs` violaba commands↛infrastructure → re-exports `crate::commands::{output_with_timeout, proportional_media_timeout}` (commands/mod.rs ya es excepción documentada).
- `architecture-rules.test.mjs` quedó 13/13 verde.

## Pendientes honestos

- concat-worker: `render_export` NO existe aún en el worker (allowlist lo rechaza); sin cancelación fina (timeout mata proceso); binario no está en tauri.conf resources; `shutdown()` no enganchado a RunEvent::Exit.
- concat-text (1 test falla por fuente emoji del sistema), concat-render/media/speech-min fuera del gate CI por peso de compilación.
- Speech nativo: sin UX de progreso de descarga del modelo (77-487MB); `language`/`words` no expuestos por el crate; `capabilities.rs`/`subtitles_pipeline` siguen reportando solo Python.
- Frontend no consume todavía `concat_worker_*` ni `mcp_audit_tail` (comandos listos, falta UI).
- css-audit.spec.ts sigue siendo gate local (pixel-perfect entre versiones de Chrome).
