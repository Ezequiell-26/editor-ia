# Split Edits: J-Cut y L-Cut

**Fecha:** 2026-11-23
**Estado:** Completado y verificado

## Qué se hizo

Se implementaron J-Cuts y L-Cuts como herramienta de edición y como opción
automática en el auto-edit pipeline.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `apps/desktop/src/state/project-actions.ts` | `applySplitEdit()` — separa audio y lo desplaza en el tiempo |
| `apps/desktop/src/state/autoedit-apply.ts` | Modo `splitEdits` en auto-edit: 'j-cut', 'l-cut', 'auto' |
| `apps/desktop/src/state/mcp-catalog.ts` | Entrada `clip_split_edit` en el catálogo MCP |
| `apps/desktop/src/state/mcp-tools.ts` | Handler `clip_split_edit` en el switch |
| `apps/desktop/src-tauri/src/mcp/server.rs` | `"clip_split_edit"` en la whitelist de write tools |
| `apps/desktop/src/state/project-actions.test.ts` | 4 tests para `applySplitEdit` |
| `apps/desktop/src/state/autoedit-engine.test.ts` | 2 tests para split edits en auto-edit |

### Comportamiento

- **J-cut:** Audio del clip siguiente comienza antes que el video — shift de
  `inFrame`/`startFrame` hacia atrás.
- **L-cut:** Audio del clip actual se extiende más allá del corte de video —
  extensión de `outFrame`.
- **Auto mode:** J-cut en cortes de speech, L-cut en transiciones speech→scene/fill.
- Fade-in/out automáticos.
- Manejo de colisiones: audio se mueve a track alternativo si hay overlap.

### Notas técnicas

- `updateClip` no acepta `source` ni `durationFrames` en su patch type.
  Para L-cut se muta directamente `targetClip.source.outFrame` en el proyecto
  clonado.
- Clip source union (`WindowedAssetSource | StillAssetSource | ...`) requiere
  narrowing con `'inFrame' in source` además de `source.type === 'asset'`.
- El render pipeline de Rust ya maneja clips de audio en tracks separados
  sin cambios adicionales.

## Verificación

- typecheck ✅
- mcp-tools.test.ts 72/72 ✅
- mcp-validation.test.ts 12/12 ✅
- autoedit-engine.test.ts 28/28 ✅
- project-actions.test.ts (split) 4/4 ✅
- architecture-rules 15/15 ✅
- dependency-rules 7/7 ✅
