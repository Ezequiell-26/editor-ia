# 2026-11-08 — Primer provider externo real: Internet Archive + auto-avance UI

## InternetArchiveAcquisition

- `infrastructure/studio/internet_archive.rs`: `ResourceAcquisition` sobre archive.org (público, sin credenciales). `advancedsearch.php` (mediatype movies/audio, título/creador/descripción), `metadata/{id}` para elegir derivado (mp4/ogv/mkv, mp3/ogg/flac; el más liviano ≤ 400 MB, salta `_thumb`/`_meta`), descarga a `<root>/media/acquired/<id><ext>` con escritura `.part`→rename, idempotente si el archivo ya existe.
- Licencias: `publicdomain*`/`cc0` → `allowed`; `cc-by*`/`gfdl` → `requires-attribution`; resto → `unknown`. El piso `min_commercial_use` del plan filtra candidatos.
- `AcquisitionCandidate` ganó campo `kind: StudioResourceKind` (los dos providers lo fijan en `search`).

## acquire_stage en dos pisos + registro de assets

- `project_executor.rs`: `acquire` itera `LocalCatalogAcquisition` y luego `InternetArchiveAcquisition` (sólo si hay ffprobe — sin él no se pueden medir los archivos). Recursos remotos pasan por `register_remote_asset`: probe ffprobe → `media.*` a fps del proyecto → append a `doc.assets` con `rights` del candidato → escritura atómica → devuelve `assetId` en el output del stage. Idempotente por `source.path`.
- `ProjectStageExecutor::new(ffprobe)` / `CompositeStageExecutor::new(ffprobe)`; `state.rs` inyecta `media_tools().ffprobe_path()`.

## UI: auto-avance

- `state/production-runs.ts::advanceProductionRun`: bucle advance+sondeo para etapas async; `pollMs`/`maxSteps`/`shouldStop`/`onUpdate`.
- `AutonomousRunsPanel`: "Correr" + "Detener" + aviso `setNotice` al done/failed.

## Verificación

- `cargo test --lib`: **751 passed / 0 failed / 54 ignored**.
- `live_search_returns_licensed_candidates` con `EDITOR_IA_RUN_LIVE_TESTS=1`: **ok** (búsqueda real archive.org).
- `cargo check`/`fmt`: limpio. Frontend: tsc 0 errores, vitest producción 10/10, architecture-rules 12/12.

## E2E remoto verificado (misma fecha)

- `project_executor::tests::acquire_remote_downloads_and_registers_project_asset` (`#[ignore]`, `EDITOR_IA_RUN_LIVE_TESTS=1`): plan con requisito `video`/"big buck bunny"/piso `unknown` sobre proyecto vacío → acquire completó, descargó el derivado más liviano de archive.org a `media/acquired/`, `register_remote_asset` lo midió con ffprobe y lo agregó a `doc.assets`, y `LocalProjectCatalog::get(assetId)` devolvió la entrada con `durationFrames > 0`. **1/1 ok en ~147 s** (descarga real).

## E2E remoto completo verificado

- `render_executor::e2e_tests::production_e2e_remote_acquire_runs_all_stages` (`#[ignore]`, ambos flags): las 8 etapas con requisito remoto → `done`, MP4 entregado. Descargó `media/acquired/bigbuckdance.ogv` (CC-BY 3.0). ~83 s.
- **Bugs reales que el E2E destapó**:
  1. Quality gate bloquea licencia `unknown` → el test usa piso `requires-attribution` (los ítems CC-BY/PDM pasan; `unknown` se filtra en `search`).
  2. Con límite `max_count*4` no alcanzaban candidatos válidos → `limit` ahora `max_count*10` (tope 50).
  3. `scenes` buscaba el asset adquirido por texto y no lo encontraba → `candidates_for_scene` ahora recibe `stage_outputs` y prefiere el binding `acquire.resources[requirementId→assetId]` antes del texto.

## Pendiente honesto

- `ContentGenerator` sigue sin provider real.
