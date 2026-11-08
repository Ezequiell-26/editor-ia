# 2026-11-08 — dead_code del arranque en lib-test a cero

## Contexto

Continuación de la limpieza de warnings (`9df0f0c`). Quedaban ~15 warnings
`dead_code` en el target lib-test.

## Causa raíz

`lib.rs` define dos `run()`:

```rust
#[cfg(test)]
pub fn run() {}          // stub para tests
#[cfg(not(test))]
pub fn run() { /* arranque real */ }
```

Todo el andamiaje que sólo el `run()` real ejerce —single-instance
(`claim_single_instance`, `QUIT_REQUESTED`, `BACKGROUND_START`), splash y
reveal (`REVEAL`, `MIN_SPLASH_MS`, `maybe_reveal_after_page_load`,
`reveal_after_ready`, `emit_splash_progress`, `hide_splash_for_background`,
`show_main_window`, `setup_tray`, `background_start_mode`), y
`commands/registry.rs::register`— queda inalcanzable en el build de tests.

## Fix

`#[cfg_attr(test, allow(dead_code))]` en los 14 ítems de `lib.rs` y en
`registry::register`. Se eligió `allow` y no `#[cfg(not(test))]` porque
`generate_handler!` en `registry.rs` referencia `background_start_mode`
también cuando se compila el target de tests — sacarlo rompería el build.

## Verificación

- `cargo check -p editor-ia-desktop --all-targets`: **0 warnings** total
  (lib y lib-test).
- `cargo test --lib`: 698/698.
- `cargo fmt --check`: limpio.

## Estado final de warnings Rust

El crate `editor-ia-desktop` compila **sin un solo warning** en todos los
targets. Fin de la higiene de warnings pendiente.
