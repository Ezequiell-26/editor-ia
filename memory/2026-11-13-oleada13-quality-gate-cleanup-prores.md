# Oleada 13 — quality gate UI, limpieza dead code, project-actions r6, fix prores, suite completa

Fecha: 2026-11-13. Rama: `architecture/refactor-foundation`. Sin commit.

## 1. qualityGateReview + renderQueueClearFinished → ExportDialog

- "Revisar calidad" en bloque de entrega: `saveNow()` antes (el gate evalúa estado persistido — verificado en `quality_gate.rs`), renderiza passed/errors/warnings + findings por severidad con `QUALITY_GATE_CHECK_LABELS` (8 checks = `QualityCheckKind`). Informativo, no bloqueante (política documentada).
- "Limpiar finalizadas del equipo": vacía cola durable de TODOS los proyectos (semántica del comando), `confirm` si ≥5, fallback `clearSettled` en memoria si runtime no soporta. Botón scoped "Limpiar terminadas" se mantiene.
- fake-service ya implementaba ambos correctamente; ExportDialog.test.tsx +5 tests → 14/14.

## 2. Limpieza código muerto frontend

- `platform/tauri/dual-monitor.ts`: borrados `closeDualMonitorWindow()` + `dualMonitorIsOpen()` (0 callers; la dual se cierra vía `closeDualWindowSelf`). Comentario deja constancia de que `dual_monitor_close`/`dual_monitor_is_open` quedan en Rust sin wrapper.
- `contracts/services/downloader.ts`: eliminado `chooseDownloadDirectory()` duplicado (firma idéntica, ~20 callers intactos).
- NO eliminados (decisión producto pendiente, documentado): `mcpServerStop`, `flowEmbedNav/Eval`, `audioScopeAnalyze`, `cancelAssistantChat`, `catalogSearch/Get`.

## 3. project-actions ronda 6

- Nuevo `delivery-actions.ts` (240 líneas): perfiles de render + presets compresión + fit/pixel-format. `project-actions.ts`: ~2674 → **2463** (−211). Solo dependía de core + video-format. API intacta.
- Siguientes candidatos limpios: assets (~250), tracks/motion graphics (~145). Bloque clips/transitions/compounds (~1500) sigue sin ser extraíble limpio.

## 4. Fix prores en ExportDialog (bug real)

- `prores` ES codec de export real (ProRes 422/4444 MOV masters): schema `delivery.ts` (solo MOV, exige yuv422p10le/yuva444p10le), Rust `render/ffmpeg/profile.rs` (`prores_ks`, matrices), worker tiene `prores-4444` propio.
- **Bug**: el select Pixel format permitía yuv420p/yuv444p con codec prores → perfil que schema+FFmpeg rechazan. Ahora esas opciones `disabled` con prores.
- `fake-service.ts`: `exportCapabilities` ahora reporta prores/prores_ks/pixel formats 10-bit (paridad con `matrix_from_encoders`).
- Tests: ExportDialog 14/14 (2 nuevos), delivery.test 24/24.

## 5. Suite vitest completa

- **2418/2419 tests, 295/296 archivos** (~192s). Único fallo: `render-cost.test.tsx` (37.8ms vs umbral 25ms) — **flake de contención CPU ya documentado**; pasa aislado (~17ms/tick). Cero regresiones reales del WIP.
- Warning cosmético: `getContext` no implementado en jsdom desde ThumbnailView (tests pasan igual).

## Verificación consolidada

- tsc --noEmit → exit 0. ExportDialog 14/14, project-actions 135/135.

## Pendientes

1. Commit del WIP (~13 oleadas) — autorización pendiente, cada vez más urgente.
2. Install smoke real + checkout limpio post-commit.
3. Oleada 14 candidata: assets/tracks splits, conectar catalogSearch/Get o eliminar, mcpServerStop UI/decisión.
4. ADR-0005 caduca 2026-12-11.
