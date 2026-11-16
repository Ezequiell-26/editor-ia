# Auditoría de quality gates — 2026-11-12

Informe consolidado del estado de las puertas de verificación del repo
(`architecture/refactor-foundation`, WIP grande preservado). Complementa
`docs/verification/` existentes y la auditoría que motivó este cambio.

## Volumen de tests (medido)

| Suite | Volumen | Dónde corre |
|---|---|---|
| Vitest (TS/TSX/MJS, workspaces root) | ~2.300 tests | `npm run test:serial` (dentro de `npm run verify`) |
| Rust `editor-ia-desktop` (src-tauri) | ~1.086 tests | `cargo test -p editor-ia-desktop` (CI) |
| Rust vendor `concat/*` | ~816 tests | `vendor/concat` workspace propio |
| Tests `#[ignore]` baseline | 73 en 22 archivos | techo fijado por `npm run test:inventory` |
| Playwright e2e | 8 specs / ~37 tests | `apps/desktop/e2e` (Chrome del sistema) |

Conteo vendor por crate (`#[test]`/`#[tokio::test]`): concat-core ~92,
concat-project ~248, concat-effects ~74, concat-media ~160,
concat-render ~111, concat-text ~81, concat-log ~32, concat-speech-min ~18.

## Estado de CI antes de este cambio

`.github/workflows/verify.yml` corría: `npm ci` → `npm run verify`
(typecheck + vitest serial + extensions + web-tts) → `audit:licenses` →
`test:inventory` → build Vite → `cargo fmt --check` → `cargo build` →
`cargo test -p editor-ia-desktop` → `render_live` con FFmpeg real.

Brechas detectadas:

1. `npm run audit:security` existía en `package.json` pero no corría ni en
   `verify` ni en CI.
2. Los ~816 tests de `vendor/concat` nunca corrían en CI (workspace propio,
   excluido del root por diseño).
3. Playwright e2e no corría en CI.
4. `scripts/verify-studio.mjs` no tenía alias npm.
5. El informe de auditoría no se persistía en `docs/verification/`.

## Cambios aplicados

- `package.json`: `verify` ahora incluye `npm run audit:security` (es rápido:
  `npm audit --omit=dev` + `cargo audit` si está instalado; sólo falla ante
  vulnerabilidades `critical`). Nuevo alias `test:studio` →
  `node scripts/verify-studio.mjs`.
- `verify.yml`: nuevo step "Tests de los crates livianos de
  vendor/concat" (`concat-core`, `concat-project`, `concat-effects`,
  `concat-log` — 446 tests medidos en verde) vía
  `node scripts/rust-env.mjs -- cargo test --manifest-path vendor/concat/Cargo.toml -p ...`.
  Nuevo step final "E2E de la interfaz con Playwright"
  (`npx playwright test --grep-invert css-audit` en `apps/desktop`).
- `scripts/verify.ps1`: mismos dos pasos agregados para mantener la paridad
  local↔CI que el script declara.

### Qué quedó fuera de CI y por qué

- `concat-render` (111 tests): depende de `wgpu` — decenas de crates GPU que
  duplicarían tiempo de compilación del job.
- `concat-media` (160 tests): `ffmpeg-the-third` + `resvg`; linkea FFmpeg y
  rasteriza SVG, riesgo de toolchain en el runner.
- `concat-speech-min` (18 tests): `whisper-rs` compila whisper.cpp con cmake —
  build nativo pesado y frágil en CI.
- `concat-text` (81 tests): `emoji_tests::emoji_sequences_draw_as_one_picture`
  **falla en esta máquina** (`🇯🇵 in colour`, panics en
  `crates/concat-text/src/emoji_tests.rs:877`) — depende de la fuente emoji a
  color disponible en el sistema. Se excluyó del gate de CI hasta investigar;
  los otros 80 tests pasan (74 s por rasterizado de fuentes).
- Spec `css-audit` de Playwright: `toHaveScreenshot` con
  `maxDiffPixelRatio: 0` contra snapshots `*-chrome-win32.png` generados con la
  Chrome local; el render no es portable entre builds de Chrome. Sigue siendo
  gate local. Los otros specs (24 tests) corren en CI contra el dev server de
  Vite en el puerto 3000 y el Chrome preinstalado del runner windows-2022,
  sin servicios externos ni `playwright install`.

## Scores por dimensión (auditoría previa, sin cambios)

| Dimensión | Score | Nota |
|---|---|---|
| Tests | 78% | buen volumen; faltaban vendor y e2e en CI |
| CI / quality gates | 80% → ~90% | audit:security, vendor y e2e ahora cubiertos |
| Reglas de arquitectura | 90% | `architecture-rules.test.mjs` + excepciones explícitas |
| Performance | 30% | sin baseline ni budgets medidos |
| Accesibilidad | 45% | sin axe-core ni auditoría automática |
| Deuda técnica | 55% | god-files conocidos (ver abajo) |
| Documentación | 85% | este informe persiste el estado |

## Gaps abiertos

- **Coverage**: no hay coverage de vitest ni de cargo; no se sabe qué % de
  líneas ejecutan los tests.
- **Performance**: sin baseline ni presupuesto (render times, bundle size,
  memoria) — score 30%.
- **Accesibilidad**: axe-core no está integrado; a11y se valida a mano en e2e.
- **God-files**: `Inspector` (~8k líneas) y `project-actions` (~5k) siguen
  concentrando lógica — deuda conocida del refactor en curso.
- **Vendor tests**: 4 crates (~370 tests) quedan fuera de CI por costo de
  toolchain nativo o un test dependiente del sistema; evaluar job separado o
  caché de cmake/wgpu y fijar la fuente emoji para cobertura completa.
- **css-audit**: los 13 screenshots pixel-perfect sólo corren en la máquina
  de desarrollo; si se quiere en CI hay que fijar la versión de Chrome del
  runner o relajar `maxDiffPixelRatio`.
- **cargo-audit**: no está en el toolchain de CI; el paso se omite con aviso.
  Si se quiere, agregar `cargo install cargo-audit` al workflow.

## Evidencia de verificación (esta sesión)

- `npx vitest run scripts/ci-workflows.test.mjs` → **12/12 passed**
  (el test exige que todo `cargo` del workflow pase por
  `scripts/rust-env.mjs --`; se cumplió).
- `npm run audit:security` → OK: `critical=0 high=1` (zod, advisory conocido,
  no bloquea); `cargo audit` omitido (no instalado).
- `npm run test:inventory` → OK: 73 ignored en 22 archivos (= baseline).
- `npx playwright test --grep-invert css-audit --list` → 24 tests en 7
  archivos seleccionados correctamente.
- `node scripts/rust-env.mjs -- cargo test --manifest-path
  vendor/concat/Cargo.toml -p concat-core -p concat-project -p
  concat-effects -p concat-log` → **verde: 446 tests, 0 fallos**
  (92 + 74 + 32 + 248). Con `-p concat-text` agregado: 80/81 ok y
  `emoji_sequences_draw_as_one_picture` FAILED (ver exclusión arriba).
- `npx vitest run scripts/architecture-rules.test.mjs` → **1 fallo
  preexistente** no relacionado con este cambio:
  `commands/** no importa infrastructure/**` marca
  `apps/desktop/src-tauri/src/commands/domains/audio/loudness.rs`
  (archivo ya modificado en el WIP antes de esta tarea; src-tauri no fue
  tocado).

`npm run verify` completo no se corrió en esta sesión por su costo
(~2.300 tests seriales + typecheck de 4 paquetes); se verificaron las partes
afectadas por el cambio y los tests de consistencia CI↔local.

## Fix posterior: `eq_compat` / FFmpeg 9 `lutyuv` (mismo día)

El gate `render_live` de CI fallaba de forma determinista en
`render_live_pipeline_produces_a_verified_mp4`. Diagnóstico con stderr
completo: la reescritura `eq`→`lutyuv` de
`apps/desktop/src-tauri/src/render/ffmpeg/eq_compat.rs` generaba
`clip(EXPR)*255,0,255)` — el `*255` quedaba **fuera** del primer argumento
de `clip()`, y el eval de ffmpeg lo parseaba como `clip` de un argumento
seguido de cola inválida (`Invalid chars ',0,255)'`, EINVAL en el
filtergraph, que arrastraba a ambos encoders con errores secundarios).

Fix: `clip(((pos)/255*lw+pow((pos)/255,1/g)*gw)*255,0,255)` — el `*255`
queda dentro del primer argumento. Verificado primero contra el binario
FFmpeg real (la expresión parsea sin error), luego:

- `cargo test --lib -p editor-ia-desktop eq_compat` → **6/6** (incluye
  nueva aserción de regresión sobre la forma `clip(((clip(`).
- `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test --lib -p editor-ia-desktop
  render_live -- --ignored` → **12/12 en verde**, incluido
  `render_live_pipeline_produces_a_verified_mp4` (MP4 320×180@30fps
  h264+aac verificado, 4.27 s).
- `cargo test --lib -p editor-ia-desktop render::ffmpeg` → **174/174**
  tras corregir además dos tests de máscara de polígono que quedaron con
  expectativas del formato viejo: el path polygon/freehand ahora respeta
  `feather` (antes lo ignoraba y el frontend ya enviaba 0.08 por defecto)
  y el alpha invertido quedó sin doble paréntesis
  (`alpha(X,Y)*(1-(…))`). Comportamiento nuevo verificado como mejora,
  no como regresión: coincide con el control de feather del Inspector.

Los cambios temporales de diagnóstico en `execution.rs` (límites de log)
fueron revertidos; el diff restante es WIP preexistente (`hide_console`).

## Oleada 4 (mismo día, continuación)

- `render_export` del concat-worker expuesto en ExportDialog
  (`ConcatWorkerExportPanel`): 19/19 vitest, tsc limpio.
- Speed curves + audio crossfade en el worker (34/34 tests del crate,
  renders reales verificados con volumedigest/SSIM).
- `.github/workflows/perf-nightly.yml`: job nocturno que mide dos veces
  en el mismo runner y compara (baseline.json de otra máquina no es
  comparable). `ci-workflows` 12/12.
- Suite completa `cargo test --lib -p editor-ia-desktop`: 1050/1050.
- ADR en `docs/decisions/2026-11-13-concat-export-vision.md`.

## Oleada 5 (mismo día, continuación)

- **Progreso + cancelación de `render_export`**: worker emite
  `render_export_progress` por fase/frames, `cancel_ack` y error
  `render_export cancelled` con limpieza del MP4 parcial; E2E real con
  80 eventos en vivo y worker vivo tras cancelar. Desktop: token de
  cancelación por port (`ConcatWorkerCancel`) — la app ya NO importa
  `infrastructure` desde `application` (regla de capas restaurada,
  architecture-rules 13/13). Comando `concat_worker_cancel_render` +
  evento `concat-worker-progress` + barra de progreso y botón cancelar
  en el panel. `cargo test --lib concat_worker` → 18/18.
- **Escenas → marcadores**: la detección `detect_scenes` ya existía
  (FFmpeg `select='gt(scene,X)'`); se agregó `markersFromCuts` + botón
  "Crear N marcador(es)" en Inspector. 137 vitest + media_analysis 6/6
  con test live gated (cortes exactos frames [60,150] en video sintético).
- **Extracción Inspector**: `ClipAudioFxSections.tsx` + `inspector/fields.tsx`;
  Inspector.tsx −379 líneas (8422→8043).
- `App.teclado.test.tsx` 9/9 — ambigüedad aria-label "Pausar" resuelta.

## Oleadas 6-7 (mismo día, continuación)

- **speed_curve UI** en ConcatWorkerExportPanel: toggle por clip,
  validación local, serialización al protocolo. 12/12 vitest.
- **Timeouts FFmpeg por llamada**: `MediaRunner::run_*_with_timeout`;
  deadlines proporcionales en todos los callers de análisis (180/180
  tests del área). Política de constantes movida a `ports/media.rs`
  (architecture-rules 13/13).
- **F7 rutas IPC**: denylist de credenciales/sistema aplicada a 13 entry
  points; tests negativos por comando (50+221 verdes).
- **F8**: toolchain pineado 1.98.1 + `RUSTUP_TOOLCHAIN` en rust-env +
  step clippy baseline (59 warnings preexistentes, sin -D).
- **F2**: `project-actions.ts` 5468→4704 (caption-actions + core
  extraídos); 267 tests verdes, API intacta.
- **Auditoría PDF**: matriz F0-F12 verificada; tracker/HANDOFF
  reescritos con evidencia real.

## Oleada 8 (mismo día, continuación)

- **F7 residual**: política de rutas aplicada a ~27 entry points más
  (denoise, dialogue, sharpen, upscale×2, lip_sync, dubbing, stickman,
  variants, shorts, screen_record, whiteboard, plugins, timeline_export,
  toolbox, import, creator tools, downloader…). `cargo test --lib`
  **1076/1076**, architecture-rules 13/13.
- **F6**: `mcp_server_stop` implementado (runtime abort + cleanup
  automation.json) con `McpServerRuntime` port; `studio_capabilities`
  ahora devuelve matriz `resourceKinds` honesta
  (`unsupported_capability` para video/sfx/etc.); `cost_cents` remoto
  queda `None` documentado (la API no lo devuelve). 11+4+18 tests.
- **F9**: perf-baseline mide `idleRssBytes` (~66 MB proxy documentado)
  y latencia MCP (gateada `--with-mcp`+token). Baseline regenerado.
- **F12**: batería de gates corrida y documentada en
  `docs/verification/2026-11-13-f12-gates.md`. **2 fallos
  deterministas reparados por mí**: DownloadView esperaba 12 idiomas
  (backend soporta 17 → test actualizado, 12/12) y schema-artifacts
  drift (regenerado con `schema:generate`, 5/5). Resto: flakes de carga
  documentados. `cargo test --lib` 1072/1072.
- Verificación post-consolidación: architecture-rules 13/13,
  ci-workflows 12/12.

## Oleada 9 (mismo día, continuación)

- **Clippy 59→0**: lints mecánicos arreglados + 2 refactors reales
  (`SequenceSpec`, `NativeRunSpec`); 32 `#[allow(too_many_arguments)]`
  justificados por sitio (contrato IPC, traits de ports, helpers
  invasivos). Gate endurecido a `-D warnings` en verify.yml. 613 tests
  de módulos tocados verdes.
- **F10/F11**: `AGENTS.md` creado; `dependency-rules.test.mjs` (7
  checks nuevos); SBOM CycloneDX en release.yml (rust+npm → artifact +
  release, primera ejecución real pendiente del primer tag).
- **F12 checkout limpio**: worktree HEAD `c6a23a8` con `npm ci` real —
  typecheck OK, vitest 3 fallos, **architecture-rules fallaba en HEAD**
  por `commands/studio/production.rs` → infraestructura. **Reparado por
  mí**: provider/driver ahora vía `state.*()` (composition root) y
  excepción stale limpiada del test. Reporte:
  `docs/verification/2026-11-13-f12-clean-checkout.md`.
- **ADR concat vendor**: `docs/decisions/2026-11-13-concat-vendor-scope.md`
  — quitar concat-render/text/log del Cargo.toml de la app (~150-190
  crates menos, wgpu); local_sfx + Graphic como generators; video/audio/
  animation permanently unsupported.
- **project-actions ronda 2**: keyframe-actions.ts extraído
  (4704→3797 líneas, −907). 940 tests state verdes.

## Oleada 10 (mismo día, continuación)

- **Vendor deps muertas eliminadas** (ADR ejecutado): concat-render/
  text/log/core/project fuera del Cargo.toml de la app — Cargo.lock
  645→590 paquetes, subárbol wgpu/naga/rustybuzz/tiny-skia eliminado.
  Quedan concat-effects + concat-speech-min (uso real). Seam
  vendor_concat.rs 174→23 líneas. Tests del seam cubiertos por suites
  vendor. `cargo test --lib` 1071/1071.
- **local_sfx generator**: port 1:1 de generate-sfx.mjs a Rust (std
  only) — 8 presets, WAV 44.1kHz mono, determinista, `sfx` ahora
  `supported` en capability matrix. `graphic` soportado vía
  titlecard/pattern. video/audio/animation permanently unsupported.
  6/6 tests generador + 111 studio.
- **project-actions ronda 3**: scene-actions.ts (scenes+narration).
  3797→3599 líneas. 940 tests state.
- **Inspector ronda 3**: ClipAnimationSection.tsx (1 prop). 7999→7741.
  100 tests.
- Consolidación: cargo check limpio, arch-rules 13/13, ci-workflows 12/12.

## Oleada 11 (mismo día, continuación)

- **project-actions ronda 4**: trim-actions.ts (trim/slip/slide/roll).
  3599→3253 líneas. 940 tests.
- **Inspector ronda 4**: TransformSection.tsx (transform+perspectiva+
  keyframes Bézier, ~550 líneas JSX). 7741→7132 (−609). 48 tests.
- **SpeedCurvePreview**: SVG fiel a SpeedCurve::with_tangents del worker
  (Hermite+Fritsch-Carlson). 17/17 tests.
- **Auditoría comandos**: 0 huérfanos de ~234; 5 backend-only con valor
  UI (production_plan_from_text/brief, production_pause/start,
  screen_record_snapshot) → candidato oleada 12.
- **Install smoke readiness**: 4 gaps corregidos (resources/sfx en CI,
  --no-sign, check-bundle-resources.mjs estático, -Provision en PS1).
  Procedimiento smoke documentado en install-smoke-pending.md.
- Scripts gates: 32/32 (arch-rules 13, ci-workflows 12, dep-rules 7).
