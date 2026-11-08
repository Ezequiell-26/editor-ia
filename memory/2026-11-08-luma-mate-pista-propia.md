# 2026-11-08 — Mate de luma-wipe a pista propia oculta

Pasada del loop de mejora (Devin CLI). Ítem: «Pendiente honesto» de la
entrada luma-mate-ocultar-pista — la UI avisaba «mové el mate a una pista
propia» pero no existía la acción.

## Cambio

- `apps/desktop/src/features/editor/luma-mate.ts`: helper nuevo
  `moveLumaMateToOwnTrack(project, mateClipId)` que compone
  `addTrack` (kind `image` si el mate es imagen, si no `video`; etiqueta
  `Mate · <label>` cortada a 120 chars) + `moveClip` conservando
  `startFrame` + `updateTrack(hidden:true)`. Devuelve `null` si el clip
  no existe o `moveClip` falla (pista de origen bloqueada).
- `apps/desktop/src/features/editor/Inspector.tsx`: en el bloque
  `luma-wipe` de la transición de entrada, botón «Mover el mate a una
  pista propia oculta» visible cuando `lumaMateSameTrack` o la pista del
  mate tiene más de un clip. Copy del `fine-print` actualizado para
  apuntar al botón.

## Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json` → 0 errores.
- `npx vitest run src/features/editor/luma-mate.test.ts` → 13/13
  (+3 tests del helper).
- `npx vitest run src/features/visuals` → 10/10.
- Sin cambios en Rust ni en el contrato del render: la pista oculta ya
  era soportada por `luma_mate`/`hidden_tracks` en `render/ffmpeg.rs`.

## Notas

- La pista nueva se crea con `addTrack` (orden al tope) y queda oculta;
  el mate conserva su ventana temporal, así que la máscara no cambia.
- Si la pista de origen está bloqueada, `moveClip` devuelve `null` y el
  botón lanza error visible en vez de simular el movimiento.
