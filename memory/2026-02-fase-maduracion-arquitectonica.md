# 2026-02 — Fase de maduración arquitectónica y fundación del estudio

## Qué se hizo

Worktree `editor-ia-architecture`, rama `architecture/refactor-foundation`, SIN commits (prohibido por el encargo).

1. **Comandos → composition root**: ~20 dominios de `commands/` migrados de constructores de `infrastructure` a accessors de `AppState` (`state.rs`). Comandos sin `State` lo ganaron como parámetro (Tauri lo inyecta; IPC intacto). Tests de timeline_export/import migrados a llamar `application` con adaptadores concretos.
2. **Reglas automatizadas**: `architecture-rules.test.mjs` 12 checks; excluye `target/` y `*.tests.rs`. Excepciones documentadas: ciclos `color↔editor`, `editor↔vfx`.
3. **Splits**: `application/media.rs`→3 módulos (fachada+re-export); `infrastructure/ai.rs`→`infrastructure/ai/` con mod.rs fachada.
4. **Estudio autónomo (fundación)**: `ProductionPlanSchema` (project-schema `studio.ts`, zod v1), espejo `src/studio/plan.rs`, puertos `ports/studio.rs`, Quality Gate puro `src/studio/quality.rs` + caso de uso `application/quality_gate.rs` (incluye chequeo de archivos en disco con `resolve_inside_root`).
5. **Docs**: CURRENT-STATE, DEPENDENCY-RULES §6, MIGRATION-ROADMAP, ADR-0001/0002/0003, IMPROVEMENT-QUEUE.

## Lecciones

- En Rust, los submódulos hermanos NO ven items privados del padre: `pub use super::x` en la fachada + `mod` declarado en `mod.rs` (no dentro del archivo fachada).
- `z.input<typeof Schema>` en tests cuando el schema aplica `.default()`: los campos opcionales en input dan error TS si se asignan objetos parciales con tipo inferido del literal.
- `include!`/`#[path]` (99+99) no son deuda per se: la mayoría preserva scope/visibilidad deliberadamente (tests hermanos, fachadas `commands::`). Convertir sólo donde hay responsabilidades independientes.
- `cargo test --lib` con múltiples filtros funciona: `cargo test --lib -- a:: b:: c::`.

## Verificación

- architecture-rules.test.mjs: 12/12 (16s).
- project-schema: tsc 0 errores, studio.test.ts 10/10.
- cargo check dev+tests: 0 errores. cargo test --lib: 698 base + 16 media/ai + 14 studio = verde por tandas.
- Pendiente al cierre: npm run typecheck/test:serial/verify/build completos.

## Siguiente paso

Exponer Quality Gate por IPC y primer provider real (MediaCatalog local sobre assets del proyecto es el candidato de menor riesgo).

## Cierre (misma fase, segunda pasada)

- **Validaciones completas**: `npm run verify` verde (typecheck 4 paquetes, test:serial 2418/3 skipped, extensiones 31+10), `npm run build` OK 10.9s, `cargo test --lib` 712/712, `cargo check --tests` 0 errores, `cargo fmt --check` limpio, `git diff --check` limpio.
- **Quality Gate por IPC**: comando `quality_gate_review` (`commands/domains/projects/quality_gate.rs`) → caso de uso `application::quality_gate::review_open_project` → `QualityReportSummary` serializable (`passed`/`errors`/`warnings`/`findings`). Contrato TS `service.qualityGateReview()` en `DesktopService` (contracts + platform/tauri + unavailable + fake). Evalúa el último estado **persistido**: la UI debe guardar antes.
- **Reconciliación main↔arch**: matriz en `docs/architecture/RECONCILIATION.md` (base `a7cff32`; arch 47 commits/553 paths, main 73/165, 152 compartidos). Portados sin merge: `ea94355` (mate luma-wipe en pista oculta → `preview_frame/timeline.rs` + 2 tests), `cf4ba59` (scope por proyecto en cola de render → `render/queue.rs` + `state/render-queue.ts` + `ExportDialog.tsx`), `6a630e6` (compliance.css→content entry, scopes.css→editor entry), `2c60004` (asyncUtilTimeout 5s + testTimeout 30s). `cf943ef` ya estaba portado; commits docs-only de main no se portan.
- **Flaky conocido**: `render-cost.test.tsx` falla bajo carga paralela (34ms > 25ms) y pasa aislado (~12ms/tick) — test de timing, no regresión.

## Siguiente paso real

Production Orchestrator sobre `ProductionPlan` + `AgentOperation`, y `LocalProjectCatalog` como primer `MediaCatalog` real.
