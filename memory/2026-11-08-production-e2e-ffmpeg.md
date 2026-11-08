# 2026-11-08 — Pipeline de producción E2E real con FFmpeg

Continuación de la rama `architecture/refactor-foundation` (worktree
`editor-ia-architecture`). Fase: conversión del pipeline de 8 etapas en una
corrida real verificable de punta a punta.

## Qué se hizo

- **`LocalCatalogAcquisition`** (`infrastructure/studio/local_acquisition.rs`):
  primer `ResourceAcquisition` real. Fuente `project-assets` (coste 0):
  `search` traduce `AcquisitionQuery` → `CatalogQuery` sobre el
  `LocalProjectCatalog` y filtra por piso `min_commercial_use`;
  `acquire` exige asset en catálogo + ruta dentro del root
  (`resolve_inside_root`) + archivo en disco; devuelve bytes reales.
- **`acquire` real en `ProjectStageExecutor`**: con requisitos, resuelve cada
  uno contra la biblioteca local (hasta `max_count` por requisito, dedup por
  fuente+externo). Lo no satisfecho ⇒ `fatal` + `requires_provider` (nunca
  simula providers externos).
- **Test E2E `production_e2e_runs_all_stages_to_deliverables`**
  (`render_executor.rs::e2e_tests`, gated `EDITOR_IA_RUN_RENDER_TESTS=1`):
  fixture `sample-vertical-slice` + medios lavfi (testsrc 640x360@30 10 s,
  sine 48 kHz), `ProductionPlan` con requisito de vídeo y una escena.
  Corre `production::advance` hasta `Done`.

## Bugs reales que el E2E destapó

1. `acquire` fallaba `requires_provider` aunque el asset existiera →
   resuelto con `LocalCatalogAcquisition`.
2. `studio/quality.rs::collect_clips` leía `timeline.tracks[].clips[]`,
   forma inexistente en el schema v1 (clips planos en `timeline.clips` con
   `trackId`). El Quality Gate marcaba error en TODO proyecto real. Los tests
   unitarios usaban la forma equivocada — corregidos ambos helpers.
3. El fixture declara `integrity.bytes`/metadata que no coinciden con medios
   reales → el test parchea `integrity.bytes`, `media.*` y elimina el clip
   `graphic` + su track + motion + referencias en `scenes[].clipIds` (el
   render exige motion plans para clips gráficos).

## Evidencia

- `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test --lib production_e2e -- --ignored`:
  1/1 — `done` en ~13 s; `deliverables/e2e-plan.mp4` 1 223 384 bytes
  (1920x1080 h264/aac 30 fps 15 s, verificación ffprobe en stage output),
  `e2e-plan.manifest.json` con `quality.passed=true`, clip "Escena E2E" en
  `timeline.clips`.
- `cargo test --lib`: 747 passed / 0 failed / 53 ignored.
- `npx vitest run scripts/architecture-rules.test.mjs`: 12/12.
- `cargo check --tests`: limpio; `cargo fmt` aplicado.

## Pendiente

- Providers externos reales (`ResourceAcquisition` remoto, `ContentGenerator`).
- Subtítulos (`subtitleSpec`) y música (`musicSpec`) consumidos por
  scenes/edit; transiciones entre clips.
- Contratos TS + UI de producciones.
