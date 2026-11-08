# 2026-11-08 — Idiomas de traducción de subtítulos alineados con Descargar

Pasada del protocolo del loop (Devin CLI). Brecha concreta medida en código:
`DownloadView` ya ofrecía traducir subtítulos a `fr`, `de`, `it` y `ja`, pero
`translate_subtitles` (`apps/desktop/src-tauri/src/commands/providers.rs`)
validaba contra una lista de ocho idiomas y rechazaba esos cuatro destinos.

## Cambio

- `language_name` ahora acepta 12 códigos: `es`, `en`, `zh`, `hi`, `ar`, `pt`,
  `bn`, `ru`, `fr`, `de`, `it`, `ja`, con nombre para el prompt del proveedor.
- El error de destino ya no fija el conteo («no está soportado»).
- Tests de `providers`: el caso de idiomas recorre los 12 soportados y el
  rechazo usa `tl`.

## Verificación ejecutada

- `node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop --lib providers`
  → **29/29** (compilación completa de la crate, ~19 min).
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**.
- `node scripts/rust-env.mjs -- rustfmt --edition 2021 --check
  apps/desktop/src-tauri/src/commands/providers.rs` → limpio.
- `cargo fmt --all -- --check` falla por diffs **preexistentes ajenos** en
  `background.rs`, `upscale.rs` y `render/motion.rs`; no se tocaron ni se
  reformateó el workspace.

## Pendiente honesto

- Localización Studio mantiene su lista curada de ocho idiomas
  (`features/localization/localization.ts`); Descargar usa su propia lista de
  ocho que ahora sí está cubierta por el backend. Si se quiere una sola fuente,
  unificar `LOCALIZATION_LANGUAGES` con `language_name` y revisar doblaje
  (`dubbing.rs`) y clonación (`voice_clone.rs`) por idioma antes de exponer más
  destinos en esa vista.
