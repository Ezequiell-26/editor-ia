# F12 — Verificación del estado COMMITTEADO en checkout limpio

- **Fecha:** 2026-11-13
- **Repo auditado:** `D:\Users\ofici\QODER-WORK\editor-ia-architecture`
- **HEAD probado:** `c6a23a8` — `docs(deliver): rebuild 5 del instalador con re-adquisicion local-gen`
- **Rama:** `architecture/refactor-foundation` (754 archivos modificados/nuevos sin commitear en el working tree — NO tocados)
- **Worktree limpio:** `D:\Users\ofici\QODER-WORK\editor-ia-architecture-clean` (detach HEAD en `c6a23a8`, eliminado al finalizar)

## Veredicto

El estado commiteado **NO está verde**: 1 violación de arquitectura real y 2 tests sensibles a carga/tiempo que fallan de forma intermitente bajo la suite paralela completa.

## Procedimiento ejecutado

1. `git status` + `git log -3` → HEAD `c6a23a8`, 754 entradas WIP confirmadas.
2. `git worktree add ..\editor-ia-architecture-clean HEAD` → OK (1753 archivos).
3. **Intento 1 — junctions de `node_modules`:** se linkearon `node_modules` raíz y los 3 anidados (`apps/motion-mcp`, `packages/effect-kit`, `packages/project-schema`). **Contaminación detectada:** los symlinks de workspaces (`node_modules/@editor-ia/*`) son junctions absolutos al repo principal, así que `@editor-ia/project-schema` y `@editor-ia/effect-kit` resolvían al **WIP**, no al HEAD. Los resultados de ese intento se descartaron como evidencia de HEAD (ver abajo).
4. **Intento 2 — `npm ci` real en el worktree:** `npm ci --prefer-offline --no-audit --no-fund` → `added 214 packages in 45s`. Los junctions `@editor-ia/*` ahora apuntan a `editor-ia-architecture-clean\packages|apps`. Warning: `esbuild@0.21.5` postinstall no cubierto por allowScripts (los tests corrieron igual).
5. Tests corridos con deps limpias (resultados válidos abajo).

## Resultados reales (deps limpias, HEAD `c6a23a8`)

### `npm run typecheck` (4 tsconfig encadenados, ejecutado como `tsc --noEmit` por proyecto)

```
node node_modules/typescript/bin/tsc --noEmit -p packages/project-schema/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/effect-kit/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/desktop/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/render-worker/tsconfig.json
→ TYPECHECK_OK (exit 0)
```

### Suite vitest completa

```
node node_modules/vitest/vitest.mjs run
→ Test Files  3 failed | 272 passed | 1 skipped (276)
→ Tests       3 failed | 2433 passed | 3 skipped (2439)
→ Duration    113.07s
```

Fallos:

| Test | Resultado | Diagnóstico |
|---|---|---|
| `scripts/architecture-rules.test.mjs` › commands/** no importa infrastructure/** | **FALLO REAL en HEAD** | `apps/desktop/src-tauri/src/commands/domains/studio/production.rs` referencia `infrastructure/**`. La regla exige composición solo en `state.rs`/`lib.rs`. Reproducible aislado y en suite. Último commit que tocó el archivo: `2dbeebb`. |
| `apps/desktop/src/App.test.tsx` › "aplica cámara lenta suave y quita el fondo" | Timeout 5000ms bajo suite paralela | **Flaky por carga**: el archivo completo pasó 77/77 aislado (`vitest run apps/desktop/src/App.test.tsx`, 72.5s). En la suite paralela el mismo test tardó 5651ms. No es un bug funcional demostrable en HEAD. |
| `apps/desktop/src/features/editor/render-cost.test.tsx` › costo por tick de cabezal | `expected 36.35 to be less than 25` | **Sensible a carga**: aislado midió 12.92+2.31 ms/tick (pasa); bajo suite paralela 36.35 ms/tick. Umbral de perf sin margen para jsdom bajo paralelismo. |

### Datos del intento contaminado (solo referencia, NO son veredicto de HEAD)

Con junctions al `node_modules` del repo principal, la suite falló 5 tests. Dos de ellos eran falsos positivos por WIP:

- `effect-thumbnails.test.ts` (34 SVG faltantes): los manifiestos extra venían del `effect-kit` **WIP**; con deps limpias el test **pasa**.
- `render-cost.test.tsx` y los 2 timeouts de `App.test.tsx`: también fallaron aislados/limpios por carga, no por código.
- El error de `tsc` con `'prores'` (`ExportDialog.tsx` TS2345) era porque el schema WIP agrega `prores` a `VideoCodecSchema`; con schema de HEAD (`['h264','h265','vp9','av1']`) el typecheck pasa. **Dato útil:** el WIP introduce `prores` sin que el código commiteado de `ExportDialog` lo tolere — al commitear el WIP hay que verificar esa integración.

## Lo que NO se pudo correr y por qué

### `cargo test --lib -p editor-ia-desktop` — NO ejecutado

- El worktree no tiene `target/` → compilación fría estimada 30–60+ min solo para deps (ffmpeg-sys-next, etc.).
- Además `CARGO_HOME=D:\DevCache\Rust\cargo` es read-only en esta máquina; hay que usar `node scripts/rust-env.mjs -- cargo ...` (workaround documentado en CLAUDE.md).
- Evidencia parcial: `scripts/rust-workspace.test.mjs` (incluido en la suite) corre `cargo metadata` sobre el workspace y **pasó en 2.1s** → el toolchain y el manifiesto resuelven bien en limpio. Lo que falta es compilar, no resolver.
- Recomendación: correrlo en CI o en una sesión dedicada con `CARGO_TARGET_DIR` propio del worktree.

### Install smoke (`scripts/package-windows.ps1`) — NO ejecutado

El script hace `npm run verify` + `npm --workspace @editor-ia/desktop run tauri:build` (vía `scripts/rust-env.mjs`) y exige un `.exe` NSIS >1MB en `target\release\bundle\nsis`. Requiere el mismo build frío de Rust que arriba → inviable en esta sesión. **Ojo:** `npm run verify` incluye `test:serial` (suite completa serial) — con los fallos documentados arriba, el smoke hoy fallaría en el paso verify antes de llegar al bundle.

## Procedimiento para install smoke (cuando haya build Rust viable)

```powershell
# En un checkout con deps instaladas (npm ci) y toolchain Rust vía rust-env:
cd D:\Users\ofici\QODER-WORK\editor-ia-architecture-clean   # o repo principal
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-windows.ps1
```

Pasos internos del script: `npm run verify` (typecheck + vitest serial + tests de extensiones) → `tauri build` → verifica `target\release\bundle\nsis\*.exe` >1MB. Alternativa manual del build: `node scripts/rust-env.mjs -- npm --workspace @editor-ia/desktop run tauri:build` tras `node scripts/setup-ffmpeg-dev.mjs --quiet --runtime`.

## Limpieza realizada

- `git worktree remove --force ..\editor-ia-architecture-clean` (incluye el `node_modules` creado por `npm ci`; los junctions del intento 1 ya fueron removidos con `rmdir` antes, sin tocar el repo principal — verificado `node_modules/vitest/vitest.mjs` intacto).
- Repo principal y sus 754 archivos WIP: sin modificaciones (solo se agregó este reporte nuevo en `docs/verification/`, directorio ya untracked).

## Recomendaciones

1. **Arreglar la violación de arquitectura** en `commands/domains/studio/production.rs` (mover la referencia a `infrastructure/**` a `state.rs`/`lib.rs` o registrar excepción justificada en `COMMANDS_EXCEPTIONS`).
2. Los tests `App.test.tsx` (timeout 5s) y `render-cost.test.tsx` (umbral 25ms) son flaky bajo paralelismo: considerar `--no-file-parallelism` para CI (`npm run test:serial` ya existe) o subir timeout/umbral.
3. Antes de commitear el WIP: el schema gana `prores`; verificar que `ExportDialog.tsx` y el pipeline Rust acepten el nuevo codec (el typecheck con WIP completo es la prueba real).
