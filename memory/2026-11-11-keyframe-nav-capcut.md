# 2026-11-11 (noche) — Navegación por keyframes ‹ › (patrón CapCut)

## Aprendizaje de CapCut
- `docs/reference/capcut/keyframe-types.txt` (extracción estática previa):
  **184 tipos `KFType*`** → los keyframes son un sistema de primera clase, con
  navegación dedicada en la UI.
- Intento de grounding nuevo: `rea search` sobre
  `D:\Users\ofici\_Migrado_de_C\AppData\Local\CapCut\Apps\9.7.1.4203\FusionUI.dll`
  con `"keyframe"` → **0 strings** (ev `ev_ff227ce243402969b1386a911d854245279449654ad9989b9cabb9cc77239de6`,
  Ghidra 12.1.4, 2,3 MB). La UI de CapCut es Qt/QML y sus textos están en
  recursos compilados, no en ese DLL. No repetir esa búsqueda ahí.
- Grounding válido: inventario `keyframe-types.txt` + patrón visual de las
  capturas (flechas junto al diamante/marcador).

## Implementado
- `features/editor/keyframe-nav.ts` (+9 tests):
  - Fuentes reales de keyframes por clip: `transform.keyframes`,
    `audio.gainKeyframes`, `mask.keyframes`, y **por instancia** en
    `effects.stack[]` / `effects.audioStack[]` (`EffectInstance.keyframes`).
    **OJO**: `ClipEffects` NO tiene un mapa `keyframes` de nivel superior.
  - Devuelve frames ABSOLUTOS (offset local + `clip.startFrame`), ordenados,
    sin duplicar, filtrados al tramo `[start, start+duration]`.
  - `previousKeyframe`/`nextKeyframe` estrictos (permiten avanzar estando
    sobre una clave) y `keyframePosition` 1-based.
- `Timeline.tsx`: dos botones ‹ › antes de «Marcador», `aria-label`, tooltip
  «N en el clip», `disabled` en extremos; al saltar `setPlayhead` + notice
  «Keyframe 2/3 · timecode». CSS en `editor-clarity.css` (20px, flecha 16px).

## Verificación
- `keyframe-nav.test.ts` 9/9 · `Timeline.test.tsx` 27/27 (2 casos nuevos) ·
  `npm run typecheck` exit 0.
- Probe en vivo (arnés temporal, 1360×768 y 1280×720): botones 20×24 px en
  x=522..563, **0 solapes** entre grupos de la barra, playhead 150→299,
  notice `role="status"` «Keyframe 3/3 · 0:00:09:29», 0 errores de consola,
  `scrollWidth == clientWidth`.
- Sin commit/push/deploy. Arnés, probe, capturas y evidencia JSON temporales
  borrados con rutas literales.

## Gotchas
- `exactOptionalPropertyTypes: true` en el monorepo: una propiedad opcional
  debe declararse `campo?: T | undefined` si se le pasa un valor que ya es
  `T | undefined`.
- `'stack' in effects` sobre una unión (`ClipEffects | AudioClipEffects`)
  estrecha a `unknown`; usar una vista tipada con cast (`as unknown as`).
- El arnés necesita inyectar keyframes (`updateClip` con `transform.keyframes`)
  porque el proyecto demo no trae ninguno: sin eso las flechas quedan
  deshabilitadas y no se puede verificar el estado habilitado.
