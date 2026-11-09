# 2026-11-08 — Driver de corridas backend + tools MCP del estudio (SWE 2)

## Qué se hizo

- `infrastructure/studio/run_driver.rs`: driver por corrida en `spawn_blocking`
  que llama `AppState::advance_production_run` hasta estado terminal/paused/failed.
  Límite 2 drivers, lock por corrida (`advance_guard`) serializa advance entre
  driver, IPC y MCP. Al ver `cancelled` mata el job FFmpeg del render.
- `AppState::advance_production_run`: camino único de avance (antes vivía sólo
  en el comando `production_advance`).
- IPC: `production_start`, `production_pause` nuevos; `production_resume` arranca
  driver; `production_cancel` cancela el render activo.
- Reconciliación al arranque en `lib.rs`: runs `running` → `paused`
  (`reconcile_interrupted_runs`), nunca auto-reanuda.
- Evento Tauri `production-run` por cambio real de corrida.
- MCP: `StudioMcpInvoker` ejecuta 9 tools de estudio en backend sin React
  (`production_*` + `studio_capabilities`); `tools/list` las mezcla siempre.
  Errores JSON con `ProjectErrorCode::name()`.

## Verificación

- cargo check --tests: 0 errores · fmt limpio
- Tests: run_driver 3/3, mcp_studio 2/2, mcp 28/28, studio:: 62/62, production 10/10
- App debug rebuildeada y lanzada OK (PID 15432). E2E del driver dentro de la
  app real: PENDIENTE (no hay hook externo para invocar IPC sin UI).

## Decisiones

- Driver = proceso de la app: ocultar ventana NO lo detiene; cerrar app SÍ.
  Documentado en handoff §15 — no afirmar continuidad tras salida sin servicio.
- `Failed` no es terminal (`is_terminal` = Done|Cancelled): el driver se detiene
  y `resume`/`production_start` lo rearma.
- Catálogo MCP fallback creció a 34 tools; test de contrato actualizado.

## Pendiente

- Planner NL→ProductionPlan (Fase 1), providers BYOK (Fase 3), instalador NSIS.
- HY4 puede migrar a `production_start` + evento `production-run`.
