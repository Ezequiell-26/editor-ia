# Contribuir a Olyvia / Editor IA

Guía mínima para trabajar en este repositorio. Para el detalle arquitectónico ver `docs/architecture/` (empezar por `CURRENT-STATE.md`, `TARGET-STRUCTURE.md` y `PDF-100-TRACKER.md`).

## Requisitos del entorno (Windows)

- **Node.js ≥ 22** y el package manager que use el repo (`npm`/`pnpm` según `package.json`).
- **Rust (stable)** vía `rustup`. **No correr `cargo` crudo**: usar siempre
  `node scripts/rust-env.mjs -- cargo <args>` desde la raíz. Ese wrapper exporta
  `FFMPEG_DIR`/`PKG_CONFIG_PATH`/libs de MSVC (sin eso falla `ffmpeg-sys-next` y
  `OLDNAMES.lib`), `LIBCLANG_PATH` para bindgen y `/STACK:67108864`.
- **MSVC Build Tools** (Visual Studio C++ workload) para linkear Rust.
- **FFmpeg dev**: `scripts/ci-ffmpeg-dev.sh` prepara los headers/libs; el wrapper
  `rust-env.mjs` los apunta.

### CARGO_HOME en esta máquina

`D:\DevCache\Rust\cargo` quedó **read-only** (no puede escribir index/src).
Workaround vigente: `CARGO_HOME=C:\Users\ofici\.cargo-w` (registry cache+index+git
copiados; `src` se re-extrae solo). `scripts/rust-env.mjs` ya resuelve el fallback.
Si un crate no está en el cache local, la red funciona: correr sin `--offline`.
Si `Cargo.lock` pinea una versión no cacheada, bajar con
`cargo update -p <crate> --precise <ver-cacheada> --offline`.

### node_modules / workspaces

Este es un **worktree** (`editor-ia-architecture`) del repo principal. Las
dependencias se enlazan, no se reinstalan en bloque. Verificar `npm run typecheck`
antes de asumir que el entorno está sano; junctions rotas de `node_modules` hacia
otro worktree son un fallo conocido ya resuelto una vez — si reaparece, revisar
los symlinks/junctions de `node_modules/@editor-ia/*`.

## Comandos habituales

| Tarea | Comando |
|---|---|
| Verificación amplia | `npm run verify` |
| Typecheck frontend | `npm run typecheck` |
| Tests frontend (serial) | `npm run test:serial` (o el script de vitest del workspace) |
| Tests Rust | `node scripts/rust-env.mjs -- cargo test --lib` (desde `apps/desktop/src-tauri`) |
| Check Rust | `node scripts/rust-env.mjs -- cargo check --tests` |
| Formato Rust (sólo archivos tocados) | `cargo fmt` selectivo; **nunca** `cargo fmt` global (hay formato preexistente divergente) |
| Reglas de arquitectura | `node --test scripts/architecture-rules.test.mjs` (incluido en verify) |
| Build | `npm run build` (ver `package.json` para el script exacto) |

> Regla del proyecto: no declarar tests/builds "en verde" sin evidencia de la
> sesión. `cargo test` puede bloquearse si falta el SDK FFmpeg dev — eso es un
> bloqueo de entorno, no un test fallido; dejarlo explícito.

## Capas de arquitectura (resumen)

- **Frontend:** `app/` (composición) → `features/` (UI por dominio, sin Tauri
  directo) → `application/`/`services/` (casos de uso y fachadas) →
  `platform/tauri/` (**único** lugar con `@tauri-apps/api`) → `state/` (estado
  por dominio). `shared/` sólo para lo transversal real.
- **Rust:** `commands/` = adaptadores IPC delgados (nada de lógica larga ni
  filtergraphs) → `application/` (casos de uso) → `domain/` (reglas puras) ←
  `ports/` (traits) ← `infrastructure/` (FFmpeg, fs, procesos, providers, MCP).
  `lib.rs` es composition root. Un solo crate Tauri; no crear crates por carpeta.
- **Reglas automatizadas:** `scripts/architecture-rules.test.mjs` corre en verify.
  Si una regla bloquea, se documenta la excepción en el propio test — no se evade.

## Prohibiciones (seguridad del trabajo del usuario)

- **No `git commit`, `push`, `reset --hard`, `clean`, merges ni operaciones
  destructivas sin autorización explícita** del usuario en ese momento.
- **Preservar el WIP existente**: hay cientos de archivos modificados que son
  trabajo del usuario/agentes; no limpiarlos, reformatearlos ni revertirlos.
- No instalar/reemplazar la app en uso ni cerrar procesos del usuario.
- No imprimir secretos, tokens, API keys ni credenciales.
- No marcar nada como `done` sin la evidencia de verificación que exige el
  mecanismo del proyecto (cola, ledger, docs).

## Flujo de trabajo sugerido

1. `git status --short --branch` y revisar diffs del área que vas a tocar.
2. Cambio pequeño y verificable; prueba específica durante el desarrollo.
3. `npm run verify` (o el chequeo amplio equivalente) antes de dar por cerrado.
4. Registrar lo hecho en `docs/IMPROVEMENT-QUEUE.md` / memoria del proyecto con
   archivos tocados, comandos y resultados reales.
