# ADR-0001: Comandos IPC como adaptadores delgados vía composition root

**Estado:** aceptada (implementada en la fase de maduración arquitectónica).
**Fecha:** 2026-02 (worktree `architecture/refactor-foundation`).

## Problema

Varios comandos Tauri construían adaptadores concretos de `infrastructure`
(`LocalSubtitleFiles`, `SystemMediaRunner`, `ReqwestProviderChat`, etc.) en
cada llamada. Eso violaba `DEPENDENCY-RULES.md` §2: `commands → application →
ports`, y `application` no debe conocer implementaciones.

## Alternativas

1. **Constructor por llamada en el comando** (estado anterior): simple pero
   acopla cada comando a la infraestructura concreta; imposible testear el
   comando sin Tauri.
2. **Registro de servicios tipados por dominio** (`ProjectServices`,
   `MediaServices`…): más limpio a largo plazo pero añade una capa de DI que
   hoy no existe y multiplica el composition root.
3. **Accessors prestados en `AppState`** (elegida): `state.rs` — que ya es el
   composition root — expone vistas (`timeline_export_files()`,
   `media_runner()`, `provider_settings()`) que toman `&self` y devuelven el
   adapter o una referencia con la vida del estado.

## Decisión

Los comandos reciben `State<'_, AppState>` (Tauri lo inyecta; el contrato IPC
no cambia) y obtienen los adaptadores vía accessors de `AppState`. Los casos de
uso de `application` siguen recibiendo `&dyn Port`. Los tests llaman a
`application` con adaptadores concretos en lugar de fabricar `State`.

## Motivo

- Elimina `commands → infrastructure` sin introducir un framework de DI.
- `AppState` ya era el dueño de los adaptadores; los accessors sólo formalizan
  el préstamo.
- Los contratos IPC (nombres, payloads, eventos) quedan intactos.

## Consecuencias

- ~20 dominios de comandos migrados; 2 comandos ganaron el parámetro `state`
  (inyección automática, sin cambio de firma IPC).
- Los accessors que devuelven tipos con vida (`StateProviderSettings<'a>`,
  `TauriProjectEnvironment<'a>`) toman `&'a self`; `AppState` guarda el
  `AppHandle` y lo presta por referencia.
- Tests de `media/timeline_export` e `timeline_import` migrados a la capa de
  aplicación.

## Cómo se valida

- `scripts/architecture-rules.test.mjs`: "commands/** no importa ni
  referencia infrastructure/**" — verde.
- `cargo test --lib`: suite completa verde tras la migración.
- `cargo check --tests`: 0 errores.

## Criterio de revisión

Si aparece un segundo composition root o si los accessors crecen hasta ser
confusos, reevaluar la opción 2 (servicios tipados por dominio).
