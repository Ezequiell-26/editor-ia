---
name: editor-ia-architecture
description: Mapa de arquitectura y comandos de Editor IA / Olyvia. Usar antes de cualquier cambio no trivial en el repo para ubicar módulos, convenciones y verificaciones correctas.
triggers:
  - user
  - model
---

# Arquitectura de Editor IA (Olyvia)

Editor de video local-first para Windows, asistido por IA. Monorepo npm workspaces + Cargo workspace.

## Layout

- `apps/desktop` — app principal: frontend React+TS+Vite (`src/`) y backend Tauri 2 (`src-tauri/`).
  - `src/features/*` — dominios (editor, color, ai, creator, director, etc.).
  - `src/components` — shell y componentes compartidos; `src/styles` — capas CSS `filmora*`.
  - `src-tauri/src/commands/*` — comandos IPC Tauri (~60 módulos); `render/`, `media/`, `projects/`.
- `packages/project-schema` — formato de proyecto versionado (Zod + JSON Schema + fixtures). Cambios de esquema exigen migración.
- `packages/effect-kit` — catálogo de efectos con codegen (`effects:codegen`).
- `apps/render-worker` — protocolo de render separado; no puede representar renders no verificados en disco.
- `apps/motion-mcp`, `apps/project-mcp` — servidores MCP propios del proyecto.
- `extensions/` — flow-queue, web-tts-bridge, editor-ia-downloader.
- `docs/` — CAPABILITY-MATRIX (estado real por funcionalidad), IMPROVEMENT-QUEUE, architecture/, automation/, memory en `memory/`.
- `.editoria-loop/LEDGER.json` — ledger del loop de mejora (preflight/record).

## Comandos esenciales (desde la raíz)

- Typecheck: `npm run typecheck` · Tests: `npm test` / `npm run test:serial` · Todo: `npm run verify`
- Un test: `npx vitest run <archivo>` en `apps/desktop`
- Rust (OBLIGATORIO vía wrapper MSVC): `node scripts/rust-env.mjs -- cargo check|test|clippy`
  - Cargo home alternativo si hay ACL: `CARGO_HOME=D:\Users\ofici\cargo-home`
- Fixtures/schema: `npm run fixtures:write`, `npm run schema:generate`, `npm run effects:codegen`
- Loop interno: `npm run loop:preflight` / `npm run loop:record` (leer `scripts/loop-preflight.mjs` y `loop-record.mjs` antes de usar)
- Licencias: `npm run audit:licenses`

## Convenciones duras

- Nada de UI falsa ni renders "completados" sin verificación en disco.
- FFmpeg es la fuente de verdad del render; video-rs para decodificación en proceso.
- Crates filmcraft-* fijados a commit `abf44fda...` (git dep); licencias en THIRD-PARTY-NOTICES.md.
- Estilos: `filmora-polish.css` va AL FINAL de la cascada; métrica mínima AA 4.5:1, clicks ≥24px, tipografía escala entera.
- Trabajo sin commitear = del usuario: preservar, no limpiar, no commitear/pushear sin autorización.
- Dependencias nuevas: justificar licencia y necesidad; nada de installs indiscriminados.
