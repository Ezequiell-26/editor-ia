# Smart Face-Centered Zoom (Pilar 2)

**Fecha:** 2026-11-23
**Estado:** Completado y verificado

## Qué se hizo

Se implementó el sistema de **Zoom Inteligente Centrado en Rostro** para evitar
que los cortes con zoom (punch-ins) corten la cabeza o encuadren el pecho ciegamente
en el centro del lienzo. Ahora el editor encuadra de forma natural siguiendo la regla
de los tercios y manteniendo aire sobre la cabeza (headroom), al estilo de los editores
humanos profesionales de YouTube (Ali Abdaal, MrBeast, Vox).

### Archivos modificados y creados

| Archivo | Cambio |
|---|---|
| `apps/desktop/src/state/face-zoom.ts` | **Nuevo módulo puro**: tipos `FaceTarget`, `computeFaceCenteredOffsets`, heurística `TALKING_HEAD_DEFAULT_FACE`, y acción `applyFaceCenteredZoom` con estilos `punch-in`, `snap-settle` y `slow-push`. |
| `apps/desktop/src/state/face-zoom.test.ts` | 8 tests unitarios que verifican traslación, encuadre superior, paneo lateral, clampeo anti bordes negros y los 3 estilos. |
| `apps/desktop/src/state/project-actions.ts` | Re-exporta `applyFaceCenteredZoom`, `computeFaceCenteredOffsets`, `TALKING_HEAD_DEFAULT_FACE` y sus tipos. |
| `apps/desktop/src/state/autoedit-apply.ts` | Opciones `faceFraming` ('talking-head', 'face', 'center') y `faceTargets`. Al montar cortes con `cut.zoom`, calcula `offsetX` y `offsetY` apuntando al rostro. |
| `apps/desktop/src/state/autoedit-engine.test.ts` | Test que comprueba que `faceFraming: 'talking-head'` genera keyframes con `offsetY > 0` y enteros válidos en autoedit. |
| `apps/desktop/src/state/mcp-catalog.ts` | Herramienta `clip_face_zoom` registrada con parámetros `clipId`, `scale`, `zoomStrength`, `faceX`, `faceY`, `style`. |
| `apps/desktop/src/state/mcp-tools.ts` | Handler `case 'clip_face_zoom'` en el switch MCP. |
| `apps/desktop/src-tauri/src/mcp/server.rs` | `"clip_face_zoom"` agregada a la whitelist de herramientas de escritura. |
| `apps/desktop/src/state/mcp-tools.test.ts` | Test de integración verificando la ejecución de `clip_face_zoom` por MCP. |

### Matemática y Seguridad Visual

- Con escala $S > 1$ sobre un lienzo $W \times H$:
  - Margen libre antes de desbordar: $\text{maxOffsetX} = \lfloor(S - 1) W / 2\rfloor$, $\text{maxOffsetY} = \lfloor(S - 1) H / 2\rfloor$.
  - Con traslación $(tx, ty)$ y escala $S$:
    $\text{desiredOffsetX} = ((targetX - 0.5) - S \cdot (faceX - 0.5)) \cdot W$
    $\text{desiredOffsetY} = ((targetY - 0.5) - S \cdot (faceY - 0.5)) \cdot H$
  - Todos los offsets se redondean a enteros exactos (`Math.round`) para respetar el esquema Zod `ClipTransformKeyframeSchema` (`z.number().int()`).
  - Clampeo estricto a $\pm\text{maxOffsetX}$ y $\pm\text{maxOffsetY}$ garantiza que **nunca se muestren franjas negras**.

## Verificación

- `npm run typecheck` ✅ (exit 0 en los 4 paquetes)
- `face-zoom.test.ts` 8/8 ✅ (824 ms)
- `autoedit-engine.test.ts` 29/29 ✅ (907 ms)
- `mcp-tools.test.ts` 72/72 ✅ (8.73 s)
- `mcp-validation.test.ts` 12/12 ✅ (430 ms)
- `scripts/dependency-rules.test.mjs` 7/7 ✅ (7.29 s)
