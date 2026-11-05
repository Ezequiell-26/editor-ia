# 2026-11-05 — Visibilidad total de la PC para la IA (fs_list / fs_read)

## Pedido

«Que la IA pueda modificar, crear, editar y VER TODO» — complemento del
`media_folder_list` anterior: ver cualquier archivo, no sólo medios.

## Cambio

**Rust** (`apps/desktop/src-tauri/src/commands/files.rs`, nuevo):

- `fs_list(path)` → `FsListing { directory, entries[], truncated }`.
  Listado no recursivo: subcarpetas primero, archivos después, orden por
  nombre. Cada entrada: name, path, kind (`dir|image|audio|video|subtitle|
  text|other`), bytes. Tope 500 entradas.
- `fs_read(path)` → `FsFileContent { path, bytes, truncated, content }`.
  Lee hasta 512 KiB como texto UTF-8 lossy; rechaza carpetas y lo marca
  `truncated` si el archivo es más grande.
- Ambos `#[tauri::command]`, registrados en `mod.rs` y `lib.rs`.
- Tests unitarios: clasificación de kinds, orden dirs-first, rechazo de
  rutas inválidas, truncamiento de lectura, rechazo de directorios.

**Frontend**:

- `services/project-service.ts`: tipos `FsEntry`/`FsListing`/`FsFileContent`,
  comandos `fs_list`/`fs_read`, métodos `listDirectory`/`readTextFile` en
  `DesktopService` (impl real + stub `unavailable`).
- `test/fake-service.ts`: stubs.
- `state/mcp-catalog.ts`: tools `fs_list` y `fs_read` con `readOnlyHint:
  true` → entran en el conjunto de lecturas paralelas del bridge MCP.
- `state/mcp-tools.ts`: casos que devuelven JSON.
- `state/mcp-tools.test.ts`: test nuevo (24/24 total).

## Verificación

- `npx vitest run src/state/mcp-tools.test.ts`: 24/24.
- `npx tsc --noEmit -p apps/desktop`: 0 errores.
- `node scripts/rust-env.mjs -- cargo check --manifest-path
  apps/desktop/src-tauri/Cargo.toml`: 0 errores (35 warnings preexistentes).
- `node scripts/rust-env.mjs -- cargo test --manifest-path
  apps/desktop/src-tauri/Cargo.toml --lib commands::files`: 4/4.
- `npm run build` (apps/desktop): OK, 7,9 s.

Nota: `cargo check`/`test` requieren `scripts/rust-env.mjs` (FFMPEG_DIR +
LIB/INCLUDE/PATH de MSVC). Sin él falla el build script de ffmpeg-sys-next
y el linker (`OLDNAMES.lib`). El test binario Rust corrió bien esta vez;
el `STATUS_ENTRYPOINT_NOT_FOUND` documentado no se reprodujo.

## Límites

- Sólo lectura de disco: no hay `fs_write`/`fs_delete` — los cambios de
  archivos siguen pasando por los comandos de proyecto/exportación.
- `fs_read` puede leer cualquier archivo legible por el usuario (secretos
  en texto plano incluidos); mitigado por MCP en 127.0.0.1 + Bearer token.
- No hay búsqueda por contenido ni por nombre en todo el disco (sólo
  listado por carpeta); si se necesita, evaluar `media_search`/`fs_find`.
