# 2026-11-09 · Aislamiento de node_modules y verificación frontend

## Contexto

`editor-ia-architecture/node_modules` era un junction al `node_modules` del repo
hermano (`D:\Users\ofici\QODER-WORK\editor-ia`). Cada `npm install` en cualquiera
de los dos worktrees reescribía los links `@editor-ia/*` y rompía builds/tests del
otro (3+ incidentes en la sesión de release).

## Acción

Con autorización explícita del usuario ("Sí, aislalo"), se corrió
`npm install --no-audit --no-fund` en `editor-ia-architecture`: **214 paquetes,
33 s, cero dependencias nuevas** (mismo lockfile). `node_modules` ahora es
directorio real propio del worktree y los links `@editor-ia/*` apuntan a los
packages locales de ESTE worktree de forma permanente. El `node_modules` del
repo hermano quedó intacto (verificado).

## Resultados verificados esta sesión

| Verificación | Resultado |
|---|---|
| `vitest run` completo (`apps/desktop`) | **1931/1932** — 241 archivos OK; único fallo `render-cost.test.tsx` (47.8 ms/tick vs <25 ms, flake de perf en jsdom) |
| `production-plan.test.ts` | 9/9 ✓ (los 9 fallos previos eran los junctions al repo hermano) |
| `vite build` post-aislamiento | OK, 510 módulos, 13.6 s |
| `npm run typecheck` | **FALLA sólo en `apps/desktop/src/studio/**`** (código HY4 en desarrollo): `OfflineState`/`PermissionNotice` sin definir, errores `exactOptionalPropertyTypes`, union media sin `.name`/`.path`. Nada de esto es scope SWE2. |

## Lecciones

- Jamás crear junctions/symlinks de `node_modules` entre worktrees: cualquier
  install del otro lado los repunta. Si hace falta compartir, `npm install` por
  worktree es la única forma estable.
- Los junctions `@editor-ia/*` deben crearse como NTFS junctions reales vía
  PowerShell (`New-Item -ItemType Junction`), nunca `ln -s` de MSYS (copia el
  directorio completo).
- npm avisó que el install script de `esbuild@0.21.5` no está aprobado por
  allowScripts — es preexistente del lockfile; no se aprobó indiscriminadamente.
- Builds Rust: siempre vía `node scripts/rust-env.mjs -- cargo ...` con
  `CARGO_HOME=D:\Users\ofici\cargo-home` (ACL en `D:\DevCache\Rust\cargo`).

## Pendiente

- `render-cost.test.tsx`: **confirmado flake de entorno**. Aislado pasa con
  14.4 ms/tick (Timeline 12.39 + Inspector 1.45); en la suite completa con 242
  archivos en paralelo mide ~48 ms por contención de CPU en jsdom. No es
  regresión de código ni del aislamiento — es límite del harness de test.
  Decisión para HY4: subir el umbral o serializar ese archivo en CI.
- Typecheck frontend: bloqueado por código HY4 en `src/studio/**`.
- Decisiones del usuario: push de la rama, faster-whisper, providers remotos
  vídeo/música, re-acquire de assets en repair loop.
