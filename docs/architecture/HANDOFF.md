# Handoff — Scorecard de release-readiness

**Fecha:** 2026-11-13 · **Rama:** `architecture/refactor-foundation` · **Worktree:** `editor-ia-architecture` · **Base del análisis:** `docs/architecture/PDF-100-TRACKER.md` (auditoría F0-F12 re-verificada contra código el 2026-11-13).

Este documento resume el estado por fase del refactor arquitectónico y el riesgo residual para declarar una release candidate. **No es una certificación**: la batería de gates corre en CI (`verify.yml`) y corrió el 2026-11-13 una batería local sobre el working tree real (735 cambios sin commitear) en `docs/verification/2026-11-13-f12-gates.md` — typecheck/cargo test/extensiones en verde, pero vitest rojo en ambas corridas (`test:serial`: 3 fallos; `DownloadView` idiomas 12 vs 17 es el único consistente). La corrida desde un checkout limpio literal sigue pendiente (ver F12).

## Layout real de rutas (corrección 2026-11-13)

- Backend Rust: `apps/desktop/src-tauri/src/` (no existe `src-tauri/` en raíz).
- Comandos IPC: `apps/desktop/src-tauri/src/commands/domains/{projects,media,render,audio,ai,downloader,creator,integrations,system}`.
- Frontend: `apps/desktop/src/` — state en `apps/desktop/src/state/` (~205 módulos), NO en `features/editor/state/`.
- `state/project-actions.ts` tiene **5.468 líneas** (`wc -l`, 2026-11-13).

## Scorecard

| Fase PDF | Tema | Estado | Evidencia clave | Riesgo residual |
|---|---|---|---|---|
| F0 | Línea base | ✅ | `BASELINE-2026-11-11.md` | Ninguno |
| F1 | Contratos/composición frontend | 🟡 | fachadas services/state, `view-registry`, arch-rules cubre imports dinámicos | Deriva documental recurrente; re-auditar por ola |
| F2 | Servicios/estado por dominios | 🟡 | `state/` ~205 módulos; ciclo editor⇄visuals ROTO (`VisualsView.tsx:19` → `state/luma-mate`) | `project-actions.ts` 5.468 líneas monolítico |
| F3 | Backend Rust en capas | 🟡 | `commands/domains/*` 9 dominios, ~266 handlers en `registry.rs`; concat_worker + whisper.cpp nativo | creator/downloader/system/ONNX siguen en commands; `hide_console` re-export residual en `infrastructure/agent.rs:28`, `media.rs:52`, `proxies.rs:335` |
| F4 | Workers/paquetes/integraciones | 🟡 | `infrastructure/process.rs` `TimedOutput`+timeouts aplicados en render/probe/audio/conversion; cancelación real en concat-worker `render_export` | `RENDERING_IMPLEMENTED=false` (`apps/render-worker/src/capabilities.ts:43`); cancelación kill_tree sólo verificada en concat-worker |
| F5 | Validación formato/datos | 🟡 | **P0 compounds CERRADO** (`projects/service.rs:39,470,536,549-661`); rights gate `render/ffmpeg/plan/graph.rs:5-14` | Pixels 16384 vs 32768 y segmento `"."` divergentes — sin reverificar esta sesión |
| F6 | IA/proveedores/MCP | 🟡 | scopes MCP (`mcp/server.rs:146-357`), audit log (`application/mcp_audit.rs`), ContentGenerator: música/patrón/tarjeta/voz local+remota (`infrastructure/studio/*`), `max_cost_cents`, **`mcp_server_stop`** (`application::mcp_server::stop_server` + `McpServerRuntime`), **matriz `resourceKinds` honesta** en `studio_capabilities` (`unsupported_capability` explícito) | `cost_cents` None en remotos **documentado** (la API no lo reporta); sin generador video/SFX (declarado, no oculto) |
| F7 | Seguridad | 🟡 | política rutas absolutas `application/fs.rs:441-480` adoptada en ~12 comandos; `stderr_tail` redactado (`infrastructure/mcp.rs:320`); `audit:security` en verify | Sin SBOM; `cargo audit` opcional; `core:default` sin verificar |
| F8 | Calidad/tests/toolchain | 🟡 | toolchain pineado `1.98.1`; `test:inventory` (73 ignores); Playwright e2e + `cargo fmt --check` en `verify.yml`; `audit:licenses` en CI | Sin gate clippy; `css-audit` e2e sólo local |
| F9 | Rendimiento/a11y | 🟡 | `scripts/perf-baseline.mjs` + `docs/performance/baseline.json` (RSS muestreado) + `perf-nightly.yml`; `axe-core@4.14.0` | Sin baseline RSS de app en reposo ni export completo; spec axe no confirmada |
| F10 | Distribución/licencias | 🟡 | FFmpeg GPL empaqueta `FFMPEG-GPL-LICENSE.txt` (`ci-bundle-resources.sh:30-42`); `THIRD-PARTY-NOTICES.md` documenta GPL-3.0 estático + LGPL-3.0 shared | Sin SBOM; install smoke manual; firma depende de secrets GH |
| F11 | Documentación/gobierno | 🟡 | `CONTRIBUTING.md`, `docs/RUNBOOKS.md`, CAPABILITY-MATRIX con nota de snapshot | Sin `AGENTS.md`; DEPENDENCY-RULES sin gate; ADR-0005 revisión 2026-12-11; CARGO_HOME sin consolidar |
| F12 | Release readiness | 🟡 | `verify.yml` corre batería completa en CI; gates corridos localmente 2026-11-13 sobre working tree con WIP (`docs/verification/2026-11-13-f12-gates.md`): typecheck/Rust/ext OK, **vitest rojo (test:serial 3 fallos; DownloadView consistente)** | Sin checkout limpio literal; sin scorecard formal |

## Evaluación global

- **Listo para seguir iterando:** sí. La arquitectura por capas está mayormente migrada; las oleadas recientes agregaron concat-worker `render_export` end-to-end, whisper.cpp nativo, máscaras freehand y gates de CI.
- **Listo para release candidate:** **no todavía**. Bloqueantes mínimos antes de RC:
  1. **F12** — ~~correr gates~~ **hecho 2026-11-13 sobre working tree** (evidencia en `docs/verification/2026-11-13-f12-gates.md`; vitest rojo: resolver `DownloadView` idiomas y `schema-artifacts`, descartar flakes) y repetir desde **checkout limpio literal** (worktree/clone, procedimiento propuesto en el doc) + smoke de instalador. Archivar la evidencia aquí.
  2. **F10** — SBOM + install smoke desatendido (licencias FFmpeg ya resueltas).
  3. **F7** — SBOM compartido con F10; `cargo audit` obligatorio en CI.
  4. **F5** — reverificar y cerrar divergencias pixels/`"."` entre validadores Rust/TS.
  5. **F6** — ~~`mcp_server_stop`~~ **hecho 2026-11-13**; `cost_cents` queda `None` por contrato de la API (documentado); decisión pendiente: generador video/SFX como `ContentGenerator` o declararlo fuera de scope RC.
- **Deuda aceptable para RC con aviso:** `project-actions.ts` monolítico, clusters F3 sin migrar, `RENDERING_IMPLEMENTED=false`, clippy gate ausente, AGENTS.md pendiente, ADR-0005 vence 2026-12-11.

## Cómo buildear y probar (comandos reales del repo)

```bash
# Rust: NUNCA cargo pelado — hay que pasar por rust-env (exporta FFMPEG_DIR,
# PKG_CONFIG_PATH y MSVC LIB; sin eso falla ffmpeg-sys-next / OLDNAMES.lib).
# Además CARGO_HOME debe apuntar al registry writable (D:\DevCache es read-only):
#   CARGO_HOME=C:\Users\ofici\.cargo-w
node scripts/rust-env.mjs -- cargo check -p editor-ia-desktop
node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop          # suite lib
node scripts/rust-env.mjs -- cargo fmt --all -- --check              # gate de CI
node scripts/rust-env.mjs -- cargo build -p editor-ia-desktop        # binario Tauri

# Render real de humo (los tests render_live están #[ignore] por defecto):
set EDITOR_IA_RUN_RENDER_TESTS=1   # bash: EDITOR_IA_RUN_RENDER_TESTS=1 node ...
node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop render_live -- --ignored --nocapture

# Frontend / gates:
npm run verify            # typecheck + vitest serial + extensions + web-tts + audit:security
npm run typecheck         # solo typecheck
npm run test:serial       # vitest run --no-file-parallelism
npm run test:inventory    # inventario de #[ignore] vs baseline (techo)
npm run audit:licenses    # licencias del bundle (GPL/FFmpeg)
npm run audit:security    # npm audit --omit=dev + cargo audit (si está instalado)
npm run perf:baseline     # ver package.json / scripts/perf-baseline.mjs --help

# E2E (Playwright, Chrome del sistema, desde apps/desktop):
cd apps/desktop && npx playwright test --grep-invert css-audit   # igual que CI
cd apps/desktop && npm run test:e2e                              # incluye css-audit (gate local)

# Bundling de recursos CI (FFmpeg GPL+LGPL, yt-dlp, ONNX, Piper):
bash scripts/ci-bundle-resources.sh
```

Notas:
- `npm run verify` en raíz NO incluye cargo test ni e2e: esos corren en `verify.yml` aparte. Para paridad con CI local hay que correr los comandos de arriba manualmente.
- `cargo audit` sólo corre si está instalado (`cargo install cargo-audit`); si falta, `audit:security` lo omite con aviso.
- Los tests `#[ignore]` (live/GPU/SDK) tienen inventario con techo en `scripts/test-inventory.baseline.json`; agregar ignores nuevos sin actualizar el baseline rompe `npm run test:inventory`.

## Pendientes top (orden sugerido)

1. **F12**: ~~corrida documentada de gates~~ corrida 2026-11-13 en working tree (`docs/verification/2026-11-13-f12-gates.md`) — vitest rojo (3 fallos en serial; `DownloadView` consistente en ambas corridas); pendiente checkout limpio literal (worktree/clone) + resolver/descartar los fallos + smoke de instalador.
2. **F10/F7**: SBOM (compartido) + install smoke desatendido.
3. **F11**: `AGENTS.md`; revisar ADR-0005 antes de **2026-12-11**; gate para DEPENDENCY-RULES.
4. **F8**: gate de clippy en `verify.yml`.
5. **F5**: reverificar divergencias de validación (pixels, segmento `"."`).
6. **F6**: `mcp_server_stop` ✅ 2026-11-13; `cost_cents` documentado (API no reporta costo); decisión video/SFX como `ContentGenerator`.
7. **F2**: subdivisión de `project-actions.ts` (5.468 líneas).

## Cómo usar este documento

- Cada fase remite al detalle de brechas y evidencia `archivo:línea` en `PDF-100-TRACKER.md`.
- Al cerrar un ítem, actualizar ambos documentos con la evidencia del comando corrido (regla del proyecto: nada se marca hecho sin prueba real de la sesión).
- Antes de cualquier merge a `main`: revisar `git status` de ambos worktrees y repetir el diff de delta (ver `RECONCILIATION.md` / `RECONCILIATION-2026-11-11.md`).
