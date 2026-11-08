# Reconciliación main ↔ architecture/refactor-foundation

Medido el 2026-11-08 (worktree `editor-ia-architecture`). Base común:
`a7cff32638e670a1265d74e86e641abc7dc32764`.

## Números actuales

| Rama | Commits desde la base | Paths tocados |
|---|---|---|
| `architecture/refactor-foundation` | 47 | 553 |
| `main` | 73 | 165 |
| Paths tocados por ambas | — | **152** |

Las cifras históricas de la auditoría anterior (66/43 commits, ~149 paths)
quedaron viejas: main avanzó y la rama de arquitectura también.

## Commits de main posteriores al último sync (`cf943ef`)

| Commit | Tema | Estado en architecture |
|---|---|---|
| `cf943ef` | autoedit: preview por corte | **Ya portado** (`9c747cc`, CSS adaptado a `content-tools.css`) |
| `ea94355` | fix(preview): mate luma-wipe en pista oculta | **Portado** — `window_project` en `commands/domains/media/preview_frame/timeline.rs` + tests en `preview_frame.tests.rs` y `render/ffmpeg/tests.rs` |
| `1d4ab72` | docs(queue): verificación mate oculto | No portado — bookkeeping de la cola de main; architecture lleva su propia cola |
| `a9ee15b` | chore(loop): pasada noop en ledger | No portado — ledger de main es propio de ese worktree |
| `2c60004` | test(suite): timeouts Testing Library | **Portado** — `src/test/setup.ts` (`asyncUtilTimeout: 5000`) + `vite.config.ts` (`testTimeout`/`hookTimeout` 30s), aplicó limpio |
| `a252eb5` | docs(follow-ups): marcar resueltos | No portado — FOLLOW-UPS de main; revisar al integrar |
| `6a630e6` | perf(css): fase 2 splitting scopes/compliance | **Portado** — `main.tsx` ya no los importa críticos; `@import` en `entries/content.css` (compliance) y `entries/editor.css` (scopes), adaptado a los entries divergentes de architecture |
| `cf4ba59` | fix(render-queue): scope por proyecto | **Portado** — `render/queue.rs` (`projectId`/`projectName` serde default), `state/render-queue.ts` + test (diff aplicó limpio), `ExportDialog.tsx` adaptado a la versión refactorizada, `application/render_queue.rs` test legacy |

## Estado de los 152 paths compartidos

- La mayoría de las rutas compartidas ya fueron reconciliadas en syncs
  previos (`b308b58`, olas de port documentadas en `MIGRATION-ROADMAP.md`).
- Los commits de main listados arriba eran los pendientes reales; todos los
  cambios de código quedaron portados en esta pasada.
- Los commits docs-only (`1d4ab72`, `a9ee15b`, `a252eb5`) no se portan:
  `docs/IMPROVEMENT-QUEUE.md`, `docs/FOLLOW-UPS.md` y `.editoria-loop/LEDGER.json`
  son archivos de bookkeeping por worktree y divergieron legítimamente.

## Reglas de la reconciliación

- **No se mergeó ni cherry-pickeó nada**: cada cambio se aplicó como edición
  sobre la estructura nueva de architecture (módulos `commands/domains/*`,
  `render/ffmpeg/*`, entries CSS divergentes).
- WIP sin commit de main (`nul`, `vibe_videos/`, etc.) nunca se tocó.
- Si main avanza de nuevo, repetir: `git diff --name-only a7cff32..<main>`
  ∩ paths de esta rama, y portar commit a commit verificando tests.
