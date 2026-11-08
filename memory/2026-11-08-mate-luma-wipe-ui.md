# 2026-11-08 · UI honesta del clip mate del `luma-wipe`

Pasada del loop de mejora (Devin CLI). Cierra el pendiente declarado al
cerrar la transición luma-wipe: «el mate en pista oculta funciona pero no
hay UI para sugerirla».

## Qué se hizo

- `features/editor/luma-mate.ts` (nuevo): `lumaMateCandidates` extrae la
  lógica inline del Inspector (ventana activa = inicio − lead propio,
  tope `2·fps`, tolerancia de un frame, mismos filtros de kind/enabled
  que `luma_mate` en `render/ffmpeg.rs`), devolviendo `{clip, track,
  trackHidden}`. `lumaMateOptionLabel` arma la etiqueta visible
  (nombre · frame · pista · «pista oculta»). `lumaMateIsStale` detecta
  un `mateClipId` asignado que ya no es candidato válido.
- `Inspector.tsx`: el selector de mate muestra pista y marca «pista
  oculta» (válida: el render sólo usa luminancia), conserva una opción
  «Mate actual (ya no cubre el solape)» cuando el mate quedó inválido y
  muestra `notice-warning`; sin candidatos muestra un `fine-print` con
  qué puede ser mate.

## Verificación

- vitest `luma-mate.test.ts` → 5/5.
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- vitest `EditorAssets`/`Timeline`/`project-actions` → 137/137.
- Sin cambios en Rust: `luma_mate` ya aceptaba mates en pistas ocultas.

## Archivos

`apps/desktop/src/features/editor/luma-mate.ts` (+test),
`apps/desktop/src/features/editor/Inspector.tsx`,
`docs/IMPROVEMENT-QUEUE.md`.

## Pendiente

Mate animado sigue congelado en preview (frame único, como el resto de
transiciones); crear un mate sigue siendo manual.
