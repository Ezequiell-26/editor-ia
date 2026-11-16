# Oleada 12 — production commands a UI, splits r5, snapshot preview, auditoría servicios

Fecha: 2026-11-13. Rama: `architecture/refactor-foundation`. Sin commit (pendiente autorización).

## 1. AutonomousRunsPanel + production commands (gap UX real cerrado)

Los 4 comandos backend-only ahora tienen consumidor frontend (4 capas por comando):

- Contratos: `services/contracts/studio.ts` (+`ProductionPlanBrief`), `services/studio.ts` → `productionPause`, `productionStart`, `productionPlanFromText(text,{approvedCost})`, `productionPlanFromBrief(brief)` → `ProductionPlan`.
- Wiring: `platform/tauri/shared.ts` STUDIO_COMMANDS + `platform/tauri/studio.ts` (arg único `request`, verificado contra `production.rs`).
- Implementaciones: `unavailable-service.ts` + `test/fake-service.ts` (fake ahora persiste corridas en Map con transiciones pause→paused/resume→running/start→running; `planFromBrief` construye ProductionPlan válido real).
- UI `AutonomousRunsPanel.tsx`: botón **Pausar** real en corridas running (antes "Detener" solo cortaba el loop local `advanceProductionRun`, backend quedaba running); sección "Describí tu video" con approvedCost → plan preview → crear corrida, con fallback "Plan simple (sin IA)" vía brief si el provider falla; botón "Correr autónomo" → `production_start` (driver backend, sobrevive cierre de ventana).
- Tests: `AutonomousRunsPanel.test.tsx` nuevo, 4 tests.

## 2. screen_record_snapshot → RecordView

- Contrato `screenRecordSnapshot(input)` → `ScreenRecordPreview`; adapter Tauri + fake + unavailable.
- `RecordView.tsx`: `formToSnapshotInput()` (espejo del payload de start menos campos no soportados) + botón "Vista previa" en grabación ad-hoc → frame PNG real en `obs-previews/`, mostrado con `absoluteFileSrc` igual que previews de escena.
- Errores honestos: `ok:false` → mensaje; excepciones → `cause.message`.
- Tests: RecordView 8/8.
- Limitación: snapshot no incluye cursor/audio/encoder (el comando no los acepta).

## 3. Splits ronda 5

- `project-actions.ts`: **3253 → 2660** (−593). Nuevo `overlay-actions.ts` (face/AI overlays + máscaras, ~571 líneas) + `addTrack` movido a `project-actions-core.ts` como primitiva compartida. API pública intacta (re-exports nominales). 940 tests state verdes.
- `Inspector.tsx`: **7132 → 6985** (−147). Nuevo `inspector/RelightSection.tsx` (única sección stateful cohesiva; las demás — Estabilización/Rostro, Máscara, Velocidad — descartadas por acoplamiento real de estados, documentado).
- Siguiente candidato project-actions: delivery/perfiles/compression (~225) o assets (~250). Remanente grande: clips/transitions/compounds (~1750, ya documentado no extraíble limpio).

## 4. Auditoría métodos de servicio muertos (solo lectura)

~192 métodos usados de ~200. Superficie muerta concentrada:
- **Alta**: `qualityGateReview()` (quality gate pre-export, comando vivo vía MCP, falta UI); `renderQueueClearFinished` (botón "limpiar finalizados" en ExportDialog).
- **Decisión**: `catalogSearch`/`catalogGet` (tríada muerta end-to-end: ¿UI o eliminar?); `mcpServerStop`, `flowEmbedNav/Eval`, `audioScopeAnalyze`, `cancelAssistantChat` — comandos Rust vivos, decisión de producto pendiente.
- **Eliminado (seguro, sin callers)**: `closeDualMonitorWindow`/`dualMonitorIsOpen` en `platform/tauri/dual-monitor.ts` (la dual se cierra desde adentro con `closeDualWindowSelf`; los comandos Rust `dual_monitor_close/is_open` quedan registrados sin wrapper); duplicado `chooseDownloadDirectory` en `contracts/services/downloader.ts` (firma idéntica a la de la línea 35; adapter `platform/tauri/downloader.ts` implementa una sola).

## Verificación consolidada

- `tsc --noEmit -p apps/desktop` → exit 0.
- Gates scripts: architecture 13/13, dependency 7/7, ci-workflows 12/12 (32/32).
- Vitest enfocado: project-actions 135, AutonomousRunsPanel 4, RecordView 8, ProductionView 3, Inspector.tab-request 6 → 156/156.

## Pendientes

1. Commit del WIP acumulado (~750+ archivos, 12 oleadas) — requiere autorización.
2. Install smoke real del bundle.
3. Checkout limpio post-commit.
4. Oleada 13 candidata: qualityGateReview UI + renderQueueClearFinished + decisión catalog/mcpServerStop cleanup.
5. ADR-0005 caduca 2026-12-11.
