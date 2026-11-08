# 2026-11-08 — Segunda pasada de clippy: fixes manuales

## Contexto

Continuación de `2026-11-08-clippy-fix-pasada1.md`. Tras el auto-fix
quedaban ~50 warnings no machine-applicable.

## Qué se hizo

Fixes manuales seguros (24 archivos):

- `sort_by` descendente → `sort_by_key(|x| Reverse(x.campo))` (7 sitios).
- `chunks_exact(N)`/`chunks_exact_mut(N)` → `as_chunks::<N>()` /
  `as_chunks_mut::<N>()` (8 sitios). Ojo: `as_chunks` devuelve
  `(&[[T; N]], &[T])` — iterar `.0.iter()`; las expresiones const en el
  genérico exigen llaves: `::<{ CHANNELS * 4 }>`.
- `type_complexity` → `type` aliases locales (4 sitios).
- `&PathBuf` → `&Path` en firma de trait `McpServerClients` + impl en
  infrastructure (verificar que el campo destino sea `PathBuf` y usar
  `.to_path_buf()` al clonar).
- `get(k).is_none()` → `!map.contains_key(k)` (sólo si el mapa es
  `HashMap`/`BTreeMap` con `contains_key`).
- `let...else` → `?` cuando la fn ya devuelve `Option`.
- `push_str(";")` → `push(';')`; `format!` anidado → interpolación
  directa; `if let` anidado → patrón combinado `Some(Ok(..))`;
  `min().max()` → `clamp()`; índice de loop → `.iter()`.
- Doc comments huérfanos: si el `///` quedó separado de su fn por una
  línea en blanco y el texto describe otra cosa, bajarlo a `//`; si
  describe la fn siguiente, quitar la línea en blanco para que el doc
  vuelva a adjuntarse.

## Verificación

- `cargo clippy --all-targets`: **28 warnings, todos
  `clippy::too_many_arguments`** — refactor de diseño (structs de
  entrada para funciones del pipeline con 8-16 params), fuera del
  alcance de higiene de lints.
- `cargo test --lib`: 698/698 · `cargo fmt --check`: limpio.

## Lección

`too_many_arguments` es el único lint restante y no es cosmético:
arreglarlo implica cambiar firmas públicas de puertos/commands y sus
callers. Si se ataca, hacerlo por módulo (ej. `RenderDeps`-style
structs), no por lint.
