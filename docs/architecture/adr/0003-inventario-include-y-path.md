# ADR-0003: Inventario de `include!` y `#[path]` — conversión selectiva

**Estado:** aceptada.
**Fecha:** 2026-02 (worktree `architecture/refactor-foundation`).

## Problema

La primera migración preservó scope y visibilidad usando `include!` (99 usos
en 21 archivos) y `#[path]` (99 atributos). La pregunta era si seguían siendo
necesarios o eran deuda a eliminar.

## Inventario y clasificación

| Categoría | Tratamiento |
|---|---|
| Tests como módulos hermanos (`foo.tests.rs` incluido desde `foo.rs`) | **Correcto y justificado**: mantiene el scope del módulo bajo prueba sin duplicar imports. |
| Submódulos de comandos gigantes (`downloader/`, `creator/stickman/`, `media/visuals/`) | **Provisional**: `include!` preserva nombres `commands::x` públicos; la conversión a `mod` real exige revisar visibilidad `pub(super)` caso a caso. |
| `#[path]` en `commands/mod.rs`, `mcp/*`, `media/timeline_*` | **Correcto**: fachadas de compatibilidad documentadas en TARGET-STRUCTURE §4; eliminarlas rompería rutas `commands::projects` etc. que consumen tests y plugins. |
| `include!` dentro de `render/ffmpeg/{plan,visual}.rs` y `media/timeline_import.rs` | **Candidato futuro**: partes de un mismo archivo lógico; convertir cuando se toque ese módulo por otra razón. |

## Decisión

No se hace conversión masiva. Se dividieron los módulos grandes con
responsabilidades independientes reales (`application/media.rs` → 3 módulos;
`infrastructure/ai.rs` → 5) y el resto queda clasificado arriba. La regla
arquitectónica (`#[path]` debe apuntar a archivos existentes) ya está
automatizada en `architecture-rules.test.mjs`.

## Motivo

- `include!`/`#[path]` no son incorrectos per se: son la herramienta que
  preservó contratos durante la migración.
- Convertir por estética rompe visibilidad y tests sin reducir acoplamiento.
- La división se justifica por responsabilidades, no por cantidad de líneas.

## Cómo se valida

- `cargo test --lib` verde tras los splits.
- El test de reglas falla si un `#[path]` apunta a un archivo inexistente.
