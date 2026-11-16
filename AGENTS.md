# AGENTS.md — instrucciones para agentes

Editor de video local-first para Windows: **Olyvia** (Tauri + React/TypeScript + Rust).
Monorepo npm workspaces: `apps/desktop` (UI + src-tauri), `apps/render-worker`,
`apps/motion-mcp`, `apps/concat-worker`, `packages/project-schema`,
`packages/effect-kit`.

## Antes de tocar código

1. Leé `CLAUDE.md` (reglas de sesión, loop `.editoria-loop/` y toolchain Rust de esta máquina).
2. Leé `docs/architecture/DEPENDENCY-RULES.md` y los ADRs de `docs/architecture/adr/`.
3. `git status --short --branch`: el árbol puede tener WIP del usuario; se preserva.
4. Si tocás release/CI, leé `docs/RELEASE.md`.

## Comandos reales (verificados en este repo)

```bash
npm run typecheck        # tsc --noEmit de los 4 paquetes TS
npm run test:serial      # vitest run --no-file-parallelism (suite completa)
npm run verify           # typecheck + tests + extensión + web-tts + audit:security
npm test                 # vitest run (paralelo)
# Un test puntual de scripts/:
node node_modules/vitest/vitest.mjs run scripts/<archivo>.test.mjs
```

Rust **siempre** a través del wrapper (descubre MSVC/SDK, FFmpeg dev, libclang
y un `CARGO_HOME` escribible):

```bash
node scripts/rust-env.mjs -- cargo check -p editor-ia-desktop
node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop
node scripts/rust-env.mjs -- cargo fmt --all -- --check
```

- **Nunca `cargo` directo**: el `CARGO_HOME` configurado (`D:\DevCache\Rust\cargo`)
  es read-only para el usuario; `rust-env.mjs` detecta esto y usa
  `target/.cargo-home` con copia best-effort del registry.
- `npm run tauri:dev` / `npm run tauri:build` ya incluyen el wrapper y el setup de FFmpeg.
- Builds Tauri locales: `npm run tauri:build:debug` (sin bundle, más rápido).

## Arquitectura (gateada por tests en `scripts/`)

`scripts/architecture-rules.test.mjs` enforcea:

- Frontend `apps/desktop/src`: `@tauri-apps/api` sólo en `platform/tauri/**`;
  `state/` y `components/` no importan `features/` (deuda documentada en el test);
  sin ciclos nuevos entre features.
- Rust `src-tauri`: `commands/**` no importa `infrastructure/**` (excepciones con
  motivo documentadas); `application/**` y `ports/**` no conocen `commands`,
  `infrastructure` ni Tauri; `projects/`/`media/` no usan Tauri ni
  `std::process::Command`; el registry IPC no tiene handlers duplicados.

`scripts/dependency-rules.test.mjs` enforcea el resto de
`docs/architecture/DEPENDENCY-RULES.md` que es verificable sin baseline:

- `platform/**` no importa en runtime `components/`, `state/`, `features/`,
  `app/`, `hooks/` ni `lib/` (`import type` está permitido; la deuda de tipos se
  evalúa aparte).
- `shared/**` y `application/**` (si se crean en `apps/desktop/src`) no pueden
  importar features/state/app/platform ni React/Tauri.
- `features/**` y `packages/*/src` no usan barrel files `export *`.
- `packages/*` son librerías puras: sin React, sin `@tauri-apps/*`, sin imports a
  `apps/*` ni dependencias de workspace hacia la app.
- `application/**` y `ports/**` (Rust) no lanzan procesos.

Reglas de `DEPENDENCY-RULES.md` que quedan **manuales** (no gateadas, son deuda
conocida): imports privados entre features, dirección `platform -> contracts`,
regla de tamaño de módulos y "FFmpeg sólo vía `infrastructure/ffmpeg`" (los
comandos actuales lanzan procesos directamente: migración pendiente).

## Reglas duras

- **Sin `git commit`, `push`, merge, `reset --hard`, `clean` ni operaciones
  destructivas sin autorización explícita del usuario en ese momento.**
- Preservar el WIP: no borrar ni reformatear archivos ajenos a la tarea.
- No imprimir ni copiar secrets, tokens ni credenciales. Las claves viven en el
  credential manager del SO; nunca en logs, DTO de UI ni el repo.
- Tests primero cuando sea práctico; cambios incrementales, pequeños y
  reversibles. Un "funciona" exige evidencia: test verde o comando corrido.
- Excepciones de arquitectura: registrarlas con ruta, motivo y criterio de
  eliminación (patrón de los `KNOWN_*` en los tests de reglas).
- Al agregar una regla de dependencias, se agrega al test — no a la memoria.
- Documentá lo aprendido en `docs/` o `memory/` del proyecto, no sólo en el chat.
