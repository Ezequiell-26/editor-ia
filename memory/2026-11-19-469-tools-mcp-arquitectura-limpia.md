# 2026-11-19 · 469 tools MCP + arquitectura sin aristas ascendentes + gates verdes

Sesión larga de cierre: se pasó de ~146 a **469 tools MCP** y se saldó toda
la deuda de arquitectura frontend. Repo: `editor-ia-architecture`.

## Lo hecho (pasadas 161–166 del IMPROVEMENT-QUEUE)

- **Catálogo MCP por niveles**: el AssistantDock enviaba las 468 tools con
  JSON Schema completo (~191 KB) y el presupuesto Rust (48 KB) sólo incluía
  ~117 — la IA veía menos de un tercio del catálogo. Ahora envía un índice
  compacto `{name, description ≤160 chars, h}` de las 469 (~64.6 KB, entra
  en el nuevo presupuesto de 96 KB) y `mcp_tool_schema` (tool read-only
  nueva) devuelve el schema exacto bajo demanda.
- **0 aristas ascendentes**: `KNOWN_UPWARD_EDGES` y `KNOWN_CYCLES` quedaron
  vacíos. Dominio puro bajado de `features/` a `state/` (ai-hub,
  custom-skills, nodes, text-edit, color-looks, export/grade-presets,
  sfx-actions, transcribe-project, lottie-core). `components/` ya no importa
  `features/`: `AppShell` recibe `assistantDock`/`featureDialogs` inyectados
  y `MenuBar` recibe los diálogos por prop tipada desde `app/Shell.tsx`.
- **Lottie split**: `state/lottie.ts` (parse/plan/puro + registro de
  rasterizador) vs `features/motion/lottie.ts` (DOM/canvas). Shell registra
  la fábrica DOM al arrancar.
- **Menú Herramientas AI-only** (cambio del usuario + fix): cajón de
  herramientas no-edición movido de la topbar global a
  `components/UtilityToolsMenu` dentro de `AlaukTopBar`. El drawer usa
  `position: fixed` (porque `.editor-grid` tiene `overflow:hidden`) y se
  ancla al botón con `getBoundingClientRect`.
- **Gate clippy verde**: 27 lints mecánicos corregidos en 12 archivos Rust
  (allows justificados en `too_many_arguments`/`large_enum_variant`/
  `items_after_test_module`; fixes directos en el resto).

## Verificación en vivo del MCP (contra la app corriendo)

- `tools/list` = 469 · `mcp_tool_schema clip_add` devuelve schema real.
- Ciclo write completo: `custom_skill_save` → `ai_skills_list` →
  `custom_skill_delete`.
- Scopes: `marker_delete` con `x-olyvia-scopes: read,write,destructive` OK;
  `run_command` sin `admin` → denegado -32004.
- Fix de panic real: `StudioMcpInvoker::invoke` ahora corre `studio_result`
  en `spawn_blocking` (el runtime blocking de reqwest se soltaba dentro del
  contexto async del accept loop → tokio panic, conexión TCP cerrada).

## Estado de gates (todo verde)

- `npm run verify`: typecheck ✅ · test:serial **356 archivos / 3229 tests**
  ✅ · extension 33/33 · web-tts 10/10 · audit:security PASS.
- Rust: `cargo fmt --check` ✅ · `cargo clippy --workspace --all-targets --
  -D warnings` ✅ · `cargo test -p editor-ia-desktop` **1134/1134**.
- architecture-rules + dependency-rules **20/20**.

## Pendiente

- **Commit**: ~319 archivos sin commitear (85 untracked, 217 modified,
  17 deleted — los deletes son moves del refactor). Basura a excluir:
  `nul` (0 bytes), `test-cdp.editoria.json`, `scripts/_batch_*.mjs`,
  `_disp_*.mjs`, `_text_front.mjs` (codemods one-shot). Requiere
  autorización explícita del usuario.
- Rebuild del exe para que la app instalada corra el refactor de frontend
  (el MCP ya responde 469 tools en la build debug actual).

## Actualización — pasadas 170c–172 (mismo día, sesión continuación)

- **170c**: `obs_switch_start.streamUrl` — cada segmento graba a MP4 **y** RTMP en el mismo proceso ffmpeg (segunda salida `-f flv`); renegocia por escena (gap documentado); stderr redactado por chunk (AUD-098); `validate_stream_url` extraído a `application::obs_scenes` y compartido con `screen_record_start`.
- **170d**: `obs_switch_start.encoder` (x264/nvenc/qsv/amf/mf) para segmentos **y** cosido; match extraído a `h264_encoder_video_args` en `devices.rs` compartido con `screen_record_start`.
- **170e**: `obs_switch_preview` — frame PNG del programa en vivo (escena activa) vía `screen_record_snapshot`; `obs_switch_current_scene_id` en switch.rs.
- **171**: `maskFromFaceTrack` movido a `state/face-mask.ts` (puro); tool MCP `clip_mask_from_face` — la IA encadena analyze_face_track→máscara poligonal animada. Matriz face mask 🟡→✅.
- **172**: tools `render_queue_move`/`render_queue_retry`/`render_queue_remove` (movePending+renderQueueScope, retryEntry, removeEntry; running no se quita).

Gates por pasada: cargo check/fmt/clippy -D warnings, typecheck, vitest dirigidos — todos verdes. Frente OBS completo salvo mixer RTMP persistente (arquitectura mayor). Matriz: solo queda 🟡 el catálogo GL de effect-kit (cobertura abierta).
