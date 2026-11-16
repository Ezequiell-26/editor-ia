# Tracker del PDF "Olyvia_Manual_Maestro_Arquitectura_100" (Fases 0-12)

**Fecha de la última auditoría de código:** 2026-11-13 (re-auditoría sobre el árbol real; la auditoría original era 2026-11-12) · **Rama:** `architecture/refactor-foundation` · **Worktree:** `editor-ia-architecture`.

Estados: ✅ cumplida · 🟡 parcial · ⬜ pendiente. Cada fase lista brechas concretas con evidencia (`archivo:línea`) verificada contra el código en esta sesión. Este documento es la fuente de verdad del avance del PDF; `HANDOFF.md` resume el scorecard de release-readiness.

> **Corrección de rutas (2026-11-13):** la auditoría anterior citaba rutas pre-reorganización (`src-tauri/src/...` en raíz, `features/editor/state/...`, `commands/*.rs` planos). El layout real es:
> - Backend Rust: `apps/desktop/src-tauri/src/` (no existe `src-tauri/` en raíz).
> - Frontend: `apps/desktop/src/` (state en `apps/desktop/src/state/`, no en `features/editor/state/`).
> - Comandos IPC: `apps/desktop/src-tauri/src/commands/domains/{projects,media,render,audio,ai,downloader,creator,integrations,system}`.
> Todas las evidencias de este documento usan las rutas reales verificadas.

> **Nota de numeración:** los "cortes verticales" Fase 3-7 documentados en `CURRENT-STATE.md` y `MIGRATION-ROADMAP.md` usan otra numeración que el PDF. Este tracker usa exclusivamente F0-F12 del PDF.

---

## F0 — Línea base y preservación

**Estado: ✅ cumplida.**

- Evidencia: `docs/architecture/BASELINE-2026-11-11.md`.
- Worktree aislado, rama desde snapshot limpio, dependencias enlazadas.

**Siguiente acción:** ninguna; mantener el baseline como referencia de regresión.

## F1 — Contratos y composición del frontend

**Estado: 🟡 parcial (~85% — estimación de auditoría; la parte documental fue corregida en olas previas).**

- Hecho: fachadas `apps/desktop/src/services/project-service.ts`, `state/` segmentado (~205 módulos en `apps/desktop/src/state/`), `app/view-registry.tsx`, composition root.
- **Brecha residual:** la deriva documental es recurrente (este mismo tracker quedó stale una vez); mitigar con re-auditorías por ola.

**Siguiente acción:** mantener la regla "código y pruebas mandan sobre documentos"; re-correr esta auditoría al cierre de cada ola.

## F2 — Servicios y estado por dominios (frontend)

**Estado: 🟡 parcial (~85%).**

- Hecho: `state/` con ~205 módulos; lazy imports por vista en `apps/desktop/src/features/editor/EditorWorkspace.tsx:64-93`; `scripts/architecture-rules.test.mjs` ahora **sí cubre imports dinámicos** `import('...')` (ver comentario en líneas 80-83 del script) y `KNOWN_CYCLES` quedó vacío (`:152`).
- **Ciclo editor⇄visuals RESUELTO:** `apps/desktop/src/features/visuals/VisualsView.tsx` ya no importa `../editor/luma-mate`; importa `../../state/luma-mate` (`VisualsView.tsx:19`) y `../../state/project-actions` (`:11`). El ciclo está roto.
- **Brecha — `state/project-actions.ts` sigue con 5.468 líneas** (verificado con `wc -l`; la ruta correcta es `apps/desktop/src/state/project-actions.ts`, no `features/editor/state/`). Coordinador monolítico; subdivisión por subdominio pendiente.

**Siguiente acción:** plan de subdivisión de `project-actions.ts` por subdominio (clips/pistas/captions/assets).

## F3 — Backend Rust en capas

**Estado: 🟡 parcial (~75%).**

- Hecho: `commands/domains/*` (9 dominios: ai, audio, creator, downloader, integrations, media, projects, render, system), `commands/registry.rs` (~266 referencias `crate::commands::` = handlers), ports/application/infrastructure para projects, media/timeline, render queue/lossless/export, AI/providers/assistant/MCP, proxies, conversion, studio/production. Nuevos: `application/concat_worker.rs` + `infrastructure/concat_worker.rs` (worker concat con `render_export`), transcripción whisper.cpp nativa (`commands/domains/audio/transcribe.rs:1` — motor in-process vía concat-speech-min, con fallback Python faster-whisper).
- **Brecha — clusters que siguen bajo `commands/` sin capas:** `creator` (shorts/stickman), `downloader`, `system` (toolchain), ONNX/upscale dentro de `commands/domains/media/`, orquestación de audio.
- **Brecha residual de capas — `hide_console`:** la función ya vive en `infrastructure/process.rs:15` y se reexporta por `commands/mod.rs:5`, pero varios archivos de `infrastructure/` siguen llamando `crate::commands::hide_console` (reexport), ej. `infrastructure/agent.rs:28`, `infrastructure/media.rs:52`, `infrastructure/proxies.rs:335`. En `render/` ya se migró (`render/ffmpeg/probe.rs:89,111,169` usan `crate::infrastructure::process::hide_console`).

**Siguiente acción:** repuntar los `infrastructure/*` restantes a `crate::infrastructure::process::hide_console` directo; migrar clusters creator/downloader/system/ONNX un caso de uso por vez; ampliar arch-rules Rust para prohibir `commands::` desde `infrastructure/`/`render/`/`media/`.

## F4 — Workers, paquetes e integraciones (robustez de procesos)

**Estado: 🟡 parcial→mejorado (~85% estimado).**

- Hecho (cierre mayoritario de la brecha de timeouts): `infrastructure/process.rs` tiene `TimedOutput` + `proportional_media_timeout` + `probe_timeout` + drenado con tope `MAX_CAPTURE_BYTES` (`process.rs:31-80`, comentario cita AUD-008/028), aplicado en `infrastructure/render_jobs.rs` (13 usos), `render/ffmpeg/probe.rs:92,124,175`, `render/ffmpeg/execution.rs:91`, `commands/domains/audio/audio.rs:114-252`, `loudness.rs:135,316`, `dubbing/probe.rs:23`, `infrastructure/conversion.rs`, `infrastructure/media.rs`, `application/transcribe.rs`, `commands/domains/creator/subtitles_pipeline.rs`, `commands/domains/integrations/flow_generate.rs`, etc.
- **Cancelación real implementada para concat-worker:** `application/concat_worker.rs` soporta `render_export` con progreso por eventos (`render_export_progress`), `cancel_ack` y validación de `transition`/`speed`/`speed_curve` (tests en `application/concat_worker.tests.rs:21-115`); `infrastructure/concat_worker.rs:413-516` usa `request_with_events`.
- **Brecha residual:** `apps/render-worker/src/capabilities.ts:43` sigue con `RENDERING_IMPLEMENTED = false` (el worker no implementa render; la carga real sigue en el proceso principal). La cancelación real para los demás workers stdio (proxies, conversión) está parcialmente cubierta por timeouts pero no equivalente a kill_tree verificable.

**Siguiente acción:** decidir si render-worker implementa render o se retira honestamente; verificar cancelación kill_tree en proxies/conversion.

## F5 — Validación de formato y datos (project-schema)

**Estado: 🟡 parcial (~95% — el BUG P0 está CERRADO).**

- **P0 compounds CERRADO:** `apps/desktop/src-tauri/src/projects/service.rs:39` incluye `"compounds"` en `KNOWN_ROOT_KEYS`, `:470` lo registra como colección, `:536` admite source type `"compound"`, y `:549-661` valida ids, `compoundId` de clips, duración esperada y clips internos (espejo del validador TS). Tests de round-trip en `projects/tests.rs` (compounds cubiertos; conteo exacto de líneas sin reverificar en esta sesión).
- **Brecha rights/integrity CERRADA en render:** `render/ffmpeg/plan/graph.rs:5-14` define `rights_block_reason` (commercialUse) y chequeo de `integrity.bytes`; aplicada en `plan/luma.rs:116` y `plan/range.rs:277,750`; tests extensos en `render/ffmpeg/tests.rs` (~55 matches de `rights`, incl. test `rights_block_reason_cubre_licencias_que_impiden_exportar` en `:9880`).
- **Brechas sin verificar en esta sesión:** divergencia de límite de pixels Rust 16384 vs TS 32768 y regla divergente del segmento `"."` — no re-verificadas; quedan como pendientes hasta nueva comprobación.

**Siguiente acción:** re-verificar y unificar límite de pixels y segmento `"."` entre validadores Rust/TS.

## F6 — IA, proveedores y MCP (capacidades y economía)

**Estado: 🟡 parcial (~80%).**

- Hecho: providers IA con secrets en keyring; assistant SSE con cancelación; cliente MCP y servidor MCP embebido; catálogo ~108 tools; autoconnect. **Nuevo desde la auditoría anterior:**
  - **Scopes MCP:** `mcp/server.rs:146-357` — jerarquía `read < write < destructive < admin`, header `X-Olyvia-Scopes` (`MCP_SCOPES_HEADER:150`), `tool_required_scope` (`:309`), `scopes_satisfy` por rango (`:355`); autoconnect nunca otorga `admin` (test `server.tests.rs:327`).
  - **Audit log MCP:** `application/mcp_audit.rs` lee/escribe `<config_dir>/mcp-audit.jsonl`; comando `mcp_audit_tail` en `commands/domains/media/concat_worker.rs:79`; sanitización de args (`sanitize_audit_args`, `redact_sensitive_text` en `mcp/server.rs:401-555`).
  - **ContentGenerator con providers reales:** `ports/studio.rs:267` (trait) con implementaciones `infrastructure/studio/local_music.rs` (música ambiental sintetizada), `local_pattern.rs`, `local_titlecard.rs`, `local_voice.rs` (SAPI), `remote_voice.rs` (TTS OpenAI-compatible), `remote_image.rs`, `local_regenerator.rs`. Registro en `infrastructure/mcp_studio.rs:236-242`.
  - **Control de presupuesto:** `max_cost_cents` en `studio/run.rs:125`, `application/production.rs:43,88,313`, `commands/domains/studio/production.rs:27-33`.
  - **`mcp_server_stop` (2026-11-13):** comando IPC + `application::mcp_server::stop_server` que aborta el accept loop real (`ports/mcp_server.rs::McpServerRuntime`, `infrastructure/mcp_server.rs::McpListenerHandle`), limpia `automation.json` y es idempotente; expuesto al frontend como `service.mcpServerStop()`.
  - **Matriz de capabilities honesta (2026-11-13):** `studio_capabilities` ahora devuelve `resourceKinds` con los 8 `StudioResourceKind`: los kinds sin `ContentGenerator` (`video`, `audio`, `sfx`, `animation`, `graphic`) se declaran `generation.status: "unsupported_capability"` con `providers: []` y sólo adquisición (`project-assets` siempre; `internet-archive` sólo donde `mediatype_for` mapea mediatype real). Derivado de capabilities declaradas, no hardcodeado.
- **Brechas residuales:** `cost_cents` sigue `None` en providers remotos **a propósito**: `/images/generations` y `/audio/speech` no devuelven coste por llamada (documentado en `remote_image.rs`/`remote_voice.rs`); el gasto se acota con `maxCostCents` del plan — es un límite de la API, no un dato faltante; **sin generador de vídeo** ni `ContentGenerator` SFX (existe `scripts/generate-sfx.mjs` pero no es un `ContentGenerator`; ahora se reporta `unsupported_capability` explícito en vez de fallar crípticamente).

**Siguiente acción (decidida 2026-11-13, `docs/decisions/2026-11-13-concat-vendor-scope.md`):** implementar `local_sfx` sobre el catálogo WAV ya sintetizado por `scripts/generate-sfx.mjs` y declarar `Graphic` en los providers de imagen existentes; `video`, `audio` y `animation` quedan `unsupported_capability` permanente salvo nuevo provider. Además el ADR decide sacar `concat-render`/`concat-text`/`concat-log` del `Cargo.toml` de la app (vendorados, sin consumidor productivo; ~150-190 crates menos de build, wgpu afuera) — ejecución de código pendiente. `cost_cents` remoto queda `None` por contrato de la API (documentado).

## F7 — Seguridad y superficie de ataque

**Estado: 🟡 parcial (~80%).**

- Hecho: AUD-001..006 cerrados; **política común de rutas absolutas IMPLEMENTADA** — `application/fs.rs:441-480` define `resolve_user_file_path` (lectura: exige absoluta, normaliza, rechaza credenciales y secretos de app) y `validate_user_write_path` (escritura: además rechaza sistema y carpetas de la app), con `system_roots`/`sensitive_component`/`app_owned_dirs` (`fs.rs:246-430`). Adoptada por `commands/domains/audio/diarize.rs:271`, `voice_isolation.rs:268`, `audio_scopes.rs:119`, `audio.rs:324`, `loudness.rs:279`, `creator/subtitles_pipeline.rs:63,87,316`, `application/media_analysis.rs:332,386`, `application/conversion.rs:98,273,664`, `media/timeline_import.rs`, `media/thumbnail.rs:103`, `media/best_frame.rs:163`.
- **`stderr_tail` del MCP sanitizado:** `infrastructure/mcp.rs:320-322` aplica `redact_sensitive_text` con los secrets inyectados; `mcp/server.rs:448-555` redacta bearer tokens y pares `key=value` sensibles.
- **Auditorías en CI:** `npm run verify` incluye `audit:security` (`package.json:27` → `scripts/security-audit.mjs`: `npm audit --omit=dev` + `cargo audit` si está instalado); `verify.yml:61` corre `audit:licenses`; `windows-package.yml:57` también.
- **Brechas residuales:** `cargo audit` es opcional (se omite si no está instalado, `security-audit.mjs:83`); **sin SBOM** (sin referencias en repo); `core:default` del audit — sin verificar en esta sesión.

**Siguiente acción:** generar SBOM (p.ej. `cargo auditable`/`cyclonedx` + `npm sbom`); evaluar fijar `cargo-audit` en CI; verificar el punto `core:default`.

## F8 — Calidad, tests y toolchain

**Estado: 🟡 parcial (~85%).**

- Hecho: `scripts/architecture-rules.test.mjs` en `npm run verify`; vitest serial (`package.json:18`); `verify.yml` corre typecheck, `audit:licenses`, `test:inventory`, build Vite, `cargo fmt --all -- --check` (`:70-71`), `cargo build`/`cargo test -p editor-ia-desktop`, tests de crates livianos de `vendor/concat`, `render_live` con FFmpeg real (`EDITOR_IA_RUN_RENDER_TESTS=1`) y **Playwright e2e en CI** (`verify.yml:104-105`, excluye `css-audit` por snapshots pixel-perfect no portables).
- **Toolchain pineado:** `rust-toolchain.toml` → `channel = "1.98.1"` (antes `"stable"`).
- **Inventario de `#[ignore]`:** `scripts/test-inventory.mjs` + `scripts/test-inventory.baseline.json`; corre en CI (`verify.yml:64-65`). Baseline documentado: 73 ignores en 22 archivos (`docs/verification/2026-11-12-quality-gates.md:14`).
- **`audit:licenses` en verify/CI:** `verify.yml:61` y `windows-package.yml:57`.
- **Brechas residuales:** **sin gate de clippy** (sin referencias a clippy en workflows ni package.json); `cargo audit` opcional (ver F7); e2e corre en CI pero `css-audit` sigue siendo sólo gate local.

**Siguiente acción:** gate `cargo clippy -- -D warnings` (o al menos `-D warnings` por workspace) en `verify.yml`; fijar `cargo-audit` en CI.

## F9 — Rendimiento y accesibilidad

**Estado: 🟡 parcial (~75%).**

- Hecho: **harness de performance commiteado** — `scripts/perf-baseline.mjs` mide wall time + `peakRssBytes` (RSS sumado del árbol muestreado vía PowerShell, `perf-baseline.mjs:14,154-188`) con umbrales de regresión; baseline fechado en `docs/performance/baseline.json` (fixture `render_live_5s_pan_astats_and_bezier_opacity_match_preview`, 2026-11-13, commit `c6a23a8`, ~203 MB RSS pico) y metodología en `docs/performance/README.md`. **Job nocturno:** `.github/workflows/perf-nightly.yml`.
- **axe/a11y:** dependencia `axe-core@4.14.0` en `apps/desktop/package.json:43`; specs e2e en `apps/desktop/e2e/` (8 specs). Cobertura axe específica: parcialmente verificada (dep presente; spec dedicado no confirmado en esta sesión).
- **Brechas residuales:** el baseline RSS cubre el test de render, no un baseline de RSS de la app en reposo ni de export completo; la referencia rota a `memory/editor-ia-performance-optimizations.md` no fue re-verificada.

**Siguiente acción:** extender baseline a RSS de la app en reposo y a un export representativo; confirmar spec axe en e2e.

## F10 — Distribución, licencias y firma

**Estado: 🟡 parcial (~80%).**

- Hecho (riesgo GPL mitigado): `scripts/ci-bundle-resources.sh:30-42` descarga el build `ffmpeg-release-essentials` de gyan.dev y **empaqueta `FFMPEG-GPL-LICENSE.txt` + `FFMPEG-GPL-README.txt`** junto a los `.exe`; `THIRD-PARTY-NOTICES.md` ahora documenta los DOS builds (estático GPL-3.0 de gyan.dev + DLLs LGPL-3.0 de BtbN) con sus textos de licencia (`:59-73,172-197`).
- **Brechas residuales:** **sin SBOM**; firma del instalador depende de secrets de GitHub (no verificable fuera de CI); **install smoke manual** (sin smoke test desatendido post-instalación — `docs/RUNBOOKS.md:13` lo lista como gate manual).

**Siguiente acción:** SBOM; smoke de instalación desatendido; documentar firma.

## F11 — Documentación y gobierno

**Estado: 🟡 parcial (~80%).**

- Hecho: `CONTRIBUTING.md` y `docs/RUNBOOKS.md` existen; correcciones documentales de la auditoría 2026-11-12 aplicadas; `docs/CAPABILITY-MATRIX.md` tiene nota de snapshot (`:5-10`) — actualizada en esta sesión para apuntar a este tracker.
- **Brechas residuales:** **sin `AGENTS.md` en raíz** (verificado: no existe); **~10 reglas de `docs/architecture/DEPENDENCY-RULES.md` sin gate automatizado** (sólo referencias documentales, ningún test/script las enforcea); **ADR-0005 con revisión obligatoria 2026-12-11** (`docs/architecture/adr/0005-comandos-studio-composicion-temporal.md:4`); las "3 verdades de CARGO_HOME" siguen pendientes de consolidar en docs antiguos (workaround vigente: `node scripts/rust-env.mjs -- cargo ...` con `CARGO_HOME=C:\Users\ofici\.cargo-w`).

**Siguiente acción:** crear `AGENTS.md`; gate para DEPENDENCY-RULES; revisar ADR-0005 antes de 2026-12-11; consolidar nota de CARGO_HOME.

## F12 — Release readiness y cierre

**Estado: 🟡 parcial (~20% — mejoró: CI corre la batería completa en cada push/PR).**

- Hecho: `verify.yml` ejecuta en CI (push a main, PRs, dispatch) la batería completa: `npm ci` → `npm run verify` (typecheck + vitest serial + extensions + web-tts + audit:security) → `audit:licenses` → `test:inventory` → build → `cargo fmt --check` → `cargo build` → `cargo test` → tests vendor concat → `render_live` con FFmpeg real → Playwright e2e. `windows-package.yml` y `perf-nightly.yml` complementan. Evidencia de auditoría de gates: `docs/verification/2026-11-12-quality-gates.md`.
- **Brecha residual:** los gates **no están documentados corridos desde un checkout limpio local** del worktree en esta rama (CI corre sobre el commit pusheado, no sobre un clone limpio local con dependencias enlazadas); no hay scorecard formal de release candidate con evidencia archivada.

**Siguiente acción:** correr `npm run verify` + typecheck + `cargo test` + smoke de instalador desde un checkout limpio local y archivar la evidencia en `HANDOFF.md`.

---

## Funcionalidad agregada en oleadas recientes (fuera del scope F0-F12, para contexto)

Verificado en código: concat-worker `render_export` end-to-end con transiciones/`speed`/`speed_curve`/crossfade/progreso/cancelación (`application/concat_worker.rs`, `application/concat_worker.tests.rs:64-115`); transcripción whisper.cpp nativa (`commands/domains/audio/transcribe.rs`); máscaras freehand (`apps/desktop/src/state/mask-draw.ts`, `features/editor/PreviewMask.test.ts`); panel de export concat (`features/editor/ConcatWorkerExportPanel.tsx`); escenas→marcadores y slip/slide/roll: parcialmente verificados (existen `markers.ts`, `preview-transition.ts`, `FilmoraStates.tsx`; detalle fino sin reverificar).

## Resumen

| Fase | Estado | Avance estimado | Riesgo residual principal |
|---|---|---|---|
| F0 | ✅ | 100% | — |
| F1 | 🟡 | ~85% (estimado auditoría) | deriva documental recurrente |
| F2 | 🟡 | ~85% | `project-actions.ts` 5.468 líneas; ciclo editor⇄visuals ya roto |
| F3 | 🟡 | ~75% | clusters creator/downloader/system/ONNX en commands; `hide_console` re-export residual en infrastructure |
| F4 | 🟡 | ~85% | timeouts aplicados; cancelación real sólo en concat-worker; `RENDERING_IMPLEMENTED=false` |
| F5 | 🟡 | ~95% | P0 compounds CERRADO; rights gate en render; pendientes: pixels 16384/32768 y segmento "." (sin reverificar) |
| F6 | 🟡 | ~85% | scopes+audit log MCP, `mcp_server_stop`, matriz `resourceKinds` honesta; `cost_cents` None documentado (API no lo reporta); scope decidido en ADR 2026-11-13-concat-vendor-scope (local_sfx+Graphic sí, video/audio/animation no); falta implementación |
| F7 | 🟡 | ~80% | política rutas absolutas + stderr redactado + npm audit en CI; falta SBOM, cargo-audit obligatorio |
| F8 | 🟡 | ~85% | toolchain pineado 1.98.1, ignores inventariados, e2e en CI, fmt gate; falta clippy gate |
| F9 | 🟡 | ~75% | perf baseline con RSS + nightly + axe-core; falta baseline RSS app/exports |
| F10 | 🟡 | ~80% | licencias FFmpeg empaquetadas y notices actualizados; falta SBOM e install smoke |
| F11 | 🟡 | ~80% | CONTRIBUTING/RUNBOOKS; falta AGENTS.md, gates DEPENDENCY-RULES, ADR-0005 vence 2026-12-11 |
| F12 | 🟡 | ~20% | CI corre batería completa; falta corrida documentada desde checkout limpio local |

*Los porcentajes ~ son estimaciones de la auditoría 2026-11-13; cada fase lista la evidencia `archivo:línea` verificada en esta sesión. Ítems marcados "sin verificar" requieren comprobación antes de citarse como cerrados.*
