# Rust env sancionado + fs_* → application::fs

## Cómo correr cargo en esta máquina (IMPORTANTE)

`cargo`/`cargo test` crudos FALLAN en esta sesión por tres motivos de entorno:
1. `CARGO_HOME=D:\DevCache\Rust\cargo` tiene ACL de sólo-lectura para el usuario
   (solo Administrators/SYSTEM escriben) → "failed to download" / "Acceso denegado".
2. Faltan `FFMPEG_DIR` (dev libs en `D:\DevCache\ffmpeg-n9.0-lgpl\ffmpeg-n9.0-latest-win64-lgpl-shared-9.0`), `LIBCLANG_PATH` (`D:\DevCache\py-libclang\clang\native`) y el entorno MSVC (vcvars).
3. `ffmpeg-sys-next` corre bindgen en el build script → STATUS_STACK_OVERFLOW sin `/STACK:` grande.

**Usar siempre**: `node scripts/rust-env.mjs -- cargo <args>` desde la raíz del repo.
Resuelve todo: MSVC que linkea (verifica msvcrt.lib+link.exe, no hardcodea versión),
FFMPEG_DIR, LIBCLANG_PATH, `CARGO_HOME` fallback `target/.cargo-home`, y
`RUSTFLAGS=-C link-arg=/STACK:67108864`.

El `C:\Users\ofici\.cargo-devin` que creé tiene los crates descargados pero
NO resuelve MSVC/FFMPEG/LIBCLANG — no usarlo directo.

## Refactor fs_* → application::fs

- `commands/domains/projects/files.rs`: 818→54 líneas, sólo `#[tauri::command]`
  + re-export de tipos. La lógica vive en `application/fs.rs` (+`fs.tests.rs`,
  convención `#[cfg(test)] #[path]`).
- Reglas de seguridad intactas: sensitive components, system dirs por env,
  app-owned dirs, canonicalización anti-traversal/junction, topes de tamaño.
- 15/15 tests, cargo check limpio, arch-rules 12/12.
