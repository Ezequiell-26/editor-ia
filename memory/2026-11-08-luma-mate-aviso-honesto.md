# 2026-11-08 — Mate luma-wipe stale: aviso honesto en VisualsView

Pasada del loop de mejora (Devin CLI). Cerró el «Pendiente honesto» de la
entrada «aviso de mate luma-wipe stale»: la marca era sólo texto y el notice
de «Aplicar» no contaba los mates reemplazados.

## Hallazgo real

`applyTransition` (`features/visuals/VisualsView.tsx`) contaba `clamped` y
`skipped` en variables externas mutadas por la receta, pero el `notice` se
pasaba como `options.notice` — un string **ya evaluado** antes de que
`store.update` corriera la receta. Resultado: los sufijos «se acotaron a su
duración» y «se omitieron por falta de mate válido» **nunca aparecieron**;
eran código muerto desde la entrada `dip-color`/`luma-wipe` del lote.

Lección reutilizable: en `project-store`, `update(recipe, {notice})` recibe
el string resuelto — cualquier contador que dependa de la receta hay que
componerlo después (`store.setNotice`) o calcularlo fuera.

## Cambio

- `stats = { clamped, skipped, staleMates }` mutado dentro de la receta
  (síncrona en `applyRecipe`); el notice se arma con `store.setNotice`
  después del `update` exitoso.
- `staleMates`: clips con `transitionIn.mateClipId` guardado que ya no es
  candidato válido (`lumaMateCandidates` con los frames a escribir) y que
  reciben otro mate → el notice dice cuántos.
- Marca stale en `<span className="visuals-stale-mate">` con
  `var(--color-warning)` (fallback `#f59e0b`).

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest `src/features/visuals` → 14/14 (VisualsView.test.tsx 8/8: +2 tests
  de notice/reemplazo y +aserción de la clase de warning).
- vitest `luma-mate.test.ts` → 17/17.

Sin cambios en Rust ni en el contrato del documento.
