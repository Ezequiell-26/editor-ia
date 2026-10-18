# Editor IA

Editor de video local-first con asistencia de IA, para Windows. **Todavía está en
fase de fundación**: existe el contrato de datos, el esqueleto de build y una UI que
navega cuatro vistas vacías; no existe la edición, el guardado ni el render.

## Qué existe hoy (verificado)

- **Formato canónico de proyecto v1** en [`packages/project-schema`](packages/project-schema):
  validación Zod de 12 entidades y 11 reglas de integridad referencial, fixtures y
  JSON Schema generado. Contrato descrito en
  [docs/architecture/PROJECT-FORMAT.md](docs/architecture/PROJECT-FORMAT.md).
- **Workspace de Cargo** en la raíz, con un único miembro `editor-ia-desktop`
  (`apps/desktop/src-tauri`). El crate compila y linkea, pero **no trae Tauri ni
  dependencias**: es un punto de entrada vacío hasta la tarea 4.
- **Loop de construcción automatizado** ([docs/automation/BUILD-LOOP.md](docs/automation/BUILD-LOOP.md)),
  con ledger en `.editoria-loop/LEDGER.json`, preflight con guardas de RAM/lock y
  cierre obligatorio contra `npm run verify`.
- **Shell de escritorio React** en [`apps/desktop`](apps/desktop): barra lateral con
  Projects, Editor, Assets y Settings; timeline, preview e inspector **visiblemente
  vacíos**. La UI navega y está probada (smoke test Vitest + jsdom); no edita, no guarda
  y no renderiza.
- **Protocolo del render-worker** en [`apps/render-worker`](apps/render-worker): pedido
  y resultado validados, y descubrimiento de capacidades por ejecutable inyectado. Un
  resultado `completed` es **inexpresable** sin una verificación post-render del archivo
  (bytes reales en la ruta verificada), y sin pipeline montado el worker responde
  `unsupported`. Medido en esta máquina: `ffmpeg` disponible en
  `C:\ProgramData\chocolatey\bin\ffmpeg.exe`, `remotion` no, y `canRender: false` igual.
- **Documentos de producto y arquitectura**:
  [PRODUCT-SPEC.md](docs/product/PRODUCT-SPEC.md), PROJECT-FORMAT.md, BUILD-LOOP.md.

## Qué todavía no existe

- **Edición ni guardado nativo**: `create`/`open`/`save` en Rust no están (tarea 4). El shell
  no tiene botones porque no hay nada que esos botones puedan hacer todavía.
- **Render real**: el worker tiene contrato y capacidades, pero no decodifica ni codifica.
  Hoy responde `unsupported` con `RENDERER_UNIMPLEMENTED` incluso con FFmpeg instalado, y
  ningún resultado se produce ni se reporta como terminado (tarea 5 dejó la frontera, no el motor).
- **IA**: no hay proveedores, ni generación, ni integración de modelos.
- **CI y empaquetado Windows**: todavía no (tarea 7).
- **Almacén de credenciales**: no implementado; hoy solo se garantiza que el formato
  de proyecto **no** las acepta (ver [SECURITY.md](SECURITY.md)).

`dev` y `build` existen solo dentro del workspace de escritorio
(`npm --workspace @editor-ia/desktop run dev` levanta Vite en `:5173`; `run build` emite
`apps/desktop/dist`). No hay `tauri:dev` ni `tauri:build`: el crate todavía no tiene comandos
ni ventana nativa (tarea 4).

## Requisitos medidos

- Node.js `>= 22` (lo fija `package.json`; `.nvmrc` usa 24).
- Rust toolchain `stable`, fijado en [`rust-toolchain.toml`](rust-toolchain.toml).
- Windows con un toolchain MSVC que tenga `link.exe` **y** `lib/x64/msvcrt.lib`.
  Sin esas variables el link falla con `LNK1104`. `scripts/rust-env.mjs` descubre
  ese toolchain y exporta `LIB`/`INCLUDE`/`PATH`; **todo** `cargo` o `rustc` se corre
  por ese prefijo:

  ```
  node scripts/rust-env.mjs -- cargo check --workspace
  ```

## Comandos soportados

| Comando | Qué hace |
| --- | --- |
| `npm run verify` | typecheck + todos los tests. Es la puerta de cierre del loop. |
| `npm run typecheck` | `tsc --noEmit` sobre `packages/project-schema` y `apps/desktop`, ambos en estricto. |
| `npm run test` | suite Vitest (esquema de proyecto + shell de escritorio + contrato del workspace Rust + docs). |
| `npm run schema:generate` | regenera `packages/project-schema/schema/project-document.v1.schema.json`. |
| `npm run fixtures:write` | regenera los fixtures `.editoria.json` de prueba. |
| `npm run loop:preflight` | decide la próxima tarea del ledger o por qué la pasada se saltea. |
| `npm run loop:record` | cierra la pasada; exige archivos reales y `verify` en verde. |
| `node apps/render-worker/src/index.ts --capabilities` | qué renderizadores ve esta máquina y si se puede renderizar (`canRender`). Sin el flag, lee un pedido JSON por stdin. |

## Licencia

[MIT](LICENSE), solo sobre el código fuente propio de Editor IA. La licencia MIT **no**
implica derechos sobre dependencias de terceros, medios de stock, ni sobre Remotion.
Los derechos de cada material se declaran por proyecto en `assets[].rights.license`
y `assets[].rights.provenance`, y se verifican antes de exportar.
