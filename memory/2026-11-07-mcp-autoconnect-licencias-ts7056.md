# 2026-11-07 — MCP autoconnect, licencias eSpeak, TS7056 y CARGO_HOME de solo lectura

## MCP autoconnect (commit fc6498a + 9a82a62)

- `commands/mcp_server.rs`: `mcp_detect_clients` (Claude Desktop, Antigravity)
  y `mcp_server_autoconnect` — arranca el server MCP y mezcla
  `mcpServers.olyvia` en la config del cliente sin tocar otros servidores.
- La lógica de merge vive en `merge_olyvia_entry()` (testeable): 3 tests
  nuevos; 12/12 `mcp_server` verdes.
- UI en `McpView.tsx` + `project-service.ts` + `fake-service.ts`.

## Licencias comerciales

- eSpeak NG (GPL-3.0) dentro de piper.exe: licencia completa + oferta de
  fuente en `resources/piper/espeak-ng/{LICENSE,SOURCE}.txt`, ahora
  versionados (excepción al ignore de `resources/piper/`).
- `THIRD-PARTY-NOTICES.md` y `docs/LICENSES.md` actualizados.

## TS7056 en project-schema (commit 51c1d71)

- `color-grade.ts` (grafo de color por clip) hizo explotar el tipo inferido
  de `ProjectSchemaBase`/`ProjectDocumentSchema`. Fix: `ProjectBaseOutput`
  declarado campo a campo con `z.infer` de cada sub-schema + anotación
  explícita; `ProjectDocument = ProjectBaseOutput & {[key:string]: unknown}`
  (las claves x-* no pueden exigirse JsonValue por los `undefined` de
  campos opcionales).
- OJO: `git add -A` barrió trabajo ajeno en curso (color-grade, index,
  timeline, schema JSON, `features/color/color-engine.ts`). Quedó commiteado
  junto al fix — revisar si ese WIP está completo antes de seguir usándolo.

## CARGO_HOME de solo lectura (importante para futuras sesiones)

- `D:\DevCache\Rust\cargo` tiene ACL RX para usuarios (owner: Administrators);
  faltan fuentes de `rand 0.9.5`/`tungstenite 0.26.2` en `registry/src` y no se
  pueden desempaquetar → `cargo check/test/build` fallan con "Acceso denegado".
- Workaround usado: `CARGO_HOME=D:\Users\ofici\cargo-home` con junctions por
  crate en `registry/src` + copia de `registry/cache` + `git` propio.
  Alternativa oficial: `scripts/rust-env.mjs` ya detecta CARGO_HOME no
  escribible y copia a `target/.cargo-home` (más lento, automático).
- `scripts/rust-env.mjs -- cargo ...` sigue siendo obligatorio: exporta
  FFMPEG_DIR (D:\DevCache\ffmpeg-n9.0-lgpl), LIB/INCLUDE MSVC, LIBCLANG_PATH
  y RUSTFLAGS /STACK para bindgen.

## Pendiente

- Instalar el release cuando la app esté cerrada (estaba abierta el 07/11).
- Transiciones OBS en vivo, editor visual del rig, física 2D, scopes en
  preview, grafos dentro del `.olyp`, code signing, auditoría de modelos.
