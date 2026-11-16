# Matriz documento → decisión → módulo → test (Fase 1)

**Fecha:** 2026-11-11 · **Método:** inspección read-only, spot-checks ejecutados
esta sesión (wc -l, grep de símbolos, vitest, cargo). Sin mutaciones de código.

## 1. Documentos rectores

| Documento | Rol | Estado vs código | Evidencia |
|---|---|---|---|
| `CURRENT-STATE.md` | Bitácora del refactor (snapshot `a7cff32`) | **Vigente como historial**, con drift cosmético | `App.tsx` 139 líneas (doc dice 138), `contracts.ts` 11 (doc dice 10); `project-service.ts` 3 y `project-store.tsx` 7 exactos. Las tablas "Antes/Después" son fotos de cada ola, no spec viva |
| `TARGET-STRUCTURE.md` | Estructura destino aspiracional | **Parcialmente realizada** | Existen `app/`, `services/contracts/`, `platform/tauri/`; `application/` frontend y `state/` segmentado por dominio **no existen aún** (Fase 2/3 del manual). El propio doc prohíbe crear carpetas vacías |
| `DEPENDENCY-RULES.md` | 10 reglas TS + 8 reglas Rust | **Automatización parcial** | `architecture-rules.test.mjs` (12/12 verde) cubre: Tauri solo en `platform/tauri`, `features/` sin `@tauri-apps`, `commands/` sin `infrastructure/` en producción, `application/` sin commands/infra/Tauri, `ports/` sin dependencias ascendentes, dominio `projects/`/`media/` sin Tauri/procesos, `#[path]` válidos. **No automatizadas**: dirección `shared/`→features, imports privados cross-feature, barrel files globales, ciclos de importación (regla 10), reglas Rust 5-8 (FFmpeg solo vía infrastructure, cancelación propagada, args estructurados) |
| `PROJECT-FORMAT.md` | Contrato `.editoria.json` v1 | **Vigente** | Schema en `packages/project-schema/schema/project-document.v1.schema.json` + fixtures; prohibición de credenciales y namespace `x-` implementados en validación |
| `MIGRATION-ROADMAP.md` | Roadmap del refactor por fases | **Fases 0-1 cerradas; fase 2 pendiente** | Coincide con el estado real: fachadas extraídas, `native-service.ts` sigue >2.300 líneas pendiente de descomposición |
| `RECONCILIATION.md` | Reconciliación 2026-11-08 | **Superada** por `RECONCILIATION-2026-11-11.md` | Sus números (73 commits main) quedaron viejos (main tiene 149); conservar sólo como historial |
| `RECONCILIATION-2026-11-11.md` | Matriz main↔rama actual | **Vigente y completa** | G1–G12 portadas y verificadas esta semana (pasadas 12-19 de IMPROVEMENT-QUEUE) |
| `BASELINE-2026-11-11.md` | Baseline del manual 100 | **Vigente** | Gates: architecture-rules 12/12, cargo test 909+2, AUD-001..006 |
| `adr/0001` commands adaptadores IPC | Comandos delgados → application | **Aceptada; cumplimiento parcial** | `commands/domains/*` existen pero varios siguen con lógica (deuda Fase 3) |
| `adr/0002` fundación estudio autónomo | Contratos studio | **Aceptada; providers pendientes** | Coincide con APP-FEATURE-AUDIT (providers honestos) |
| `adr/0003` include!/#[path] | Conversión selectiva | **Aceptada; vigente** | `include!` sigue en uso justificado (tests hermanos, plan/visual); `#[path]` en `commands/mod.rs` es fachada documentada |
| `adr/0004` production orchestrator | Ciclo de vida de corridas | **Aceptada, E2E verificado** | `production.rs` sigue siendo composition root con excepción documentada en baseline |
| `adr/0005` comandos studio composition root | Comandos studio delgados | **Aceptada con fecha de caducidad** | Pendiente de revisión al cerrar Fase 3 |

## 2. Brechas doc↔código detectadas (honestas)

1. **CURRENT-STATE.md** no declara su carácter de snapshot fechado en el
   encabezado (sí lo hace en el cuerpo). Drift medido: ±1-2 líneas en tablas.
   Acción: ninguna funcional; considerar nota de "snapshot" si se retoma.
2. **DEPENDENCY-RULES**: 5 de 10 reglas TS y ~5 de 8 reglas Rust no tienen
   gate automatizado. Candidatas a agregar en `architecture-rules.test.mjs`
   (bajo costo): dirección `shared/`→features, imports `features/`→`features/`
   privados, `application/` frontend sin React.
3. **RECONCILIATION.md** viejo puede confundir: sus números ya no aplican.
   Acción: marcar como superseded o eliminar (decisión del usuario).
4. **MIGRATION-ROADMAP** fase 2+ sigue pendiente — es la cola real de Fases 2/3
   del manual (native-service, Provider actions, commands→application).

## 3. Conclusión Fase 1

La documentación rectora es **mayoritariamente fiel al código**; las
desviaciones son cosméticas o de cobertura de gates, no de decisiones
arquitectónicas incorrectas. La matriz de brechas real queda en
`RECONCILIATION-2026-11-11.md` (cerrada) y las fases pendientes en el manual.
