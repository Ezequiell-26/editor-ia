# 2026-11-08 — Verificación integral + fix PolygonEditor test

## Contexto

Pasada del loop tras la reconciliación 10 (main `408300b` + `42283fe`:
bezier por parámetro en plantillas de fábrica y aviso de mates luma-wipe
stale). El ledger está cerrado y la cola sin ítems internos ejecutables,
así que la pasada fue de verificación con evidencia fresca.

## Comandos y resultados

- `npm run typecheck` → **0 errores** en project-schema, effect-kit,
  desktop y render-worker.
- `npm run test:serial` → **2400 passed / 3 skipped / 1 failed**
  (273 archivos, ~381 s).

## Fallo encontrado

`apps/desktop/src/features/motion/PolygonEditor.test.tsx` — «arrastrar un
vértice lo mueve» esperaba `{x:0.4, y:0.6}` y recibía `NaN`.

**Causa raíz**: jsdom 25 no implementa `PointerEvent`. `fireEvent.pointerMove`
despacha un `Event` genérico sin `clientX/clientY`; el componente calcula
`(undefined - rect.left)/Math.max(1, rect.width)` → `NaN`. En navegadores
reales `PointerEvent.clientX` existe y el componente funciona — el bug es
del test, no del producto.

**Fix**: helper `pointerEvent(type, init)` en el test que crea un
`MouseEvent` con `type: 'pointerdown'|'pointermove'|'pointerup'` y
`bubbles/cancelable`. React escucha el tipo de evento nativo y lee las
coordenadas del `nativeEvent`, así que el gesto de arrastre se ejercita
de verdad.

**Verificación**: `PolygonEditor.test.tsx` 7/7 tras el cambio. Los otros
43 usos de `fireEvent.pointer*` en la suite no dependen de coordenadas y
siguen verdes — no se tocaron.

## Lección

`fireEvent.pointer*` en jsdom NO transporta `clientX/clientY` ni
`pointerId` (verificado: `window.PointerEvent === undefined` en jsdom 25).
Cualquier test que ejercite gestos de puntero con coordenadas debe
despachar `MouseEvent` con el type `pointer*` o mockear las coords.

## Pendiente honesto

`npm run verify` completo (con `test:extension` y `test:web-tts`) no se
corrió; la suite serial cubrió los paquetes del workspace.
