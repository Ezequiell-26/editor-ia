# 2026-11-08 — Contratos TS + UI de corridas de producción

## Qué se hizo

- `services/contracts/studio.ts`: tipos `ProductionRun`, `StageRecord`, `ProductionRunStatus`, `StageRecordStatus`, `CatalogEntry`, `CatalogQuery`, `ResourceLicense` (espejo camelCase del serde de `studio/run.rs` y `ports/studio.rs`).
- `services/contracts/services/studio.ts`: `DesktopServiceStudio` con `productionCreate/Status/List/Resume/Cancel/Remove/Advance` + `catalogSearch/catalogGet`. Compuesto en `DesktopService` (`contracts/service.ts`) y re-exportado por `contracts.ts` → `services/project-service.ts`.
- `platform/tauri/shared.ts`: `STUDIO_COMMANDS` con los 9 comandos IPC.
- `platform/tauri/studio.ts`: adaptador `createStudioService(call)`; registrado en `native-service.ts`.
- Stubs: `unavailable-service.ts` (unavailable()) y `test/fake-service.ts` (run fake + listas vacías).
- `state/production-plan.ts::buildProductionPlanFromProject(project, objective)`: plan desde el proyecto abierto — un `ResourceRequirement` por asset único usado en `scene.clipIds` (kind mapeado, query=assetId que el catálogo matchea contra `entry.id`, `minCommercialUse:'unknown'`, `preferLocal`), `PlanScene` por escena del proyecto (intent/narrationText heredados), subtítulos `es` si hay narración, target desde `renderProfiles[0]` y duración = fin del último clip (mínimo 60 s).
- `features/production/AutonomousRunsPanel.tsx`: panel "Corridas de producción" dentro de ProductionView — crea corrida, lista runs con marca por etapa (✓/…/✗/–/·), muestra `lastError`/errores de etapa, botones Avanzar/Reanudar/Cancelar/Eliminar según estado. Montado entre `FolderQueuePanel` y `PublicationReadiness`.

## Gotcha importante

`node_modules/@editor-ia/project-schema` era un symlink absoluto al worktree hermano `D:\Users\ofici\QODER-WORK\editor-ia` (sin `studio.ts`). Se repuntó a `packages/project-schema` local; sin eso `import type { ProductionPlan }` no compilaba en apps/desktop. Los demás links (`desktop`, `effect-kit`, `render-worker`) siguen apuntando al hermano — estado preexistente, no tocar sin revisar.

## Verificación

- `tsc --noEmit -p apps/desktop/tsconfig.json`: 0 errores.
- `vitest run state/production-plan.test.ts features/production/ProductionView.test.tsx`: 6/6.
- `vitest run scripts/architecture-rules.test.mjs`: 12/12.

## Auto-avance (misma fecha, continuación)

- `state/production-runs.ts::advanceProductionRun(service, runId, opts)`: bucle que llama `productionAdvance` por etapa y sondea `productionStatus` cuando la etapa queda `running` (render async). Parámetros: `pollMs` (1.5 s), `maxSteps` (60), `shouldStop`, `onUpdate`. Nunca inventa progreso: estados terminales o `failed` salen del bucle.
- Panel: botón "Correr" por corrida no terminal (primario) junto a "Avanzar etapa"; `onUpdate` actualiza la lista en vivo.
- Tests: `production-runs.test.ts` 4/4 (avance secuencial, sondeo sin gastar advances, shouldStop, terminal inmediato). Typecheck 0 errores.

- Botón "Detener" durante el auto-avance (`shouldStop`) y `store.setNotice` al terminar/fallar la corrida.

## Pendiente

- **Provider externo real (siguiente fase grande)**: `reqwest` blocking ya está en Cargo. Plan: `InternetArchiveAcquisition` (advancedsearch + metadata + descarga de derivado mp4, filtro de licencia) → `CompositeAcquisition` (local primero, externo después) en `acquire_stage` → **registrar el archivo adquirido como `project.assets`** (vía `import_local_files` de `application/media.rs` o ficha mínima + ffprobe para `durationFrames`, requisito para que `scenes` lo resuelva) → tests con HTTP gated.
- UI de creación de plan más rica (editor de brief/requirements).
