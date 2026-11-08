# 2026-11-08 — Primera pasada de cargo clippy --fix

## Contexto

`cargo check` quedó en 0 warnings, pero `cargo clippy --all-targets`
reportaba ~100 warnings en lib y ~127 en lib-test (la mayoría
style-lints). Primera pasada de higiene clippy del crate.

## Qué pasó

1. `cargo clippy --fix --lib --all-targets` **abortó con error de
   compilación**: el lint `chunks_exact_to_as_chunks` sugiere
   `as_chunks::<CHANNELS * 4>` y en Rust actual los genéricos const con
   expresiones exigen llaves (`::<{ CHANNELS * 4 }>`). El fix automático
   deja el código roto y revierte todo.
2. Reintento con `-A clippy::chunks_exact_to_as_chunks`: aplicó ~50 fixes
   machine-applicable en **41 archivos** (neto 191+/261−): `err_expect`,
   `map_all_any_identity`, `trim_split_whitespace`,
   `double_ended_iterator_last`, `unnecessary_get_then_check`,
   `empty_line_after_doc_comments`, `collapsible_if`, etc.

## Verificación

- `cargo check --all-targets`: compila.
- `cargo test --lib`: **698/698** (21 s).
- `cargo fmt`: aplicado, `--check` limpio.

## Queda (no auto-fixable, honesto)

- `too_many_arguments` en funciones del pipeline (8-13 params):
  refactor con struct de entrada, no cosmético.
- `type_complexity`, `format_in_format_args`, `unnecessary_sort_by`,
  `ptr_arg`, `single_char_add_str`.
- `chunks_exact_to_as_chunks` abierto en 4 sitios hasta migrar a
  `as_chunks::<{ N }>` con llaves.

## Lección

`cargo clippy --fix` puede proponer código que no compila en la versión
de Rust del proyecto (genéricos const). Correr siempre con
`--allow-dirty`, revisar el resultado con `cargo check` y reintentar
excluyendo el lint problemático con `-A`.
