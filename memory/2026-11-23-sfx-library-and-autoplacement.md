# SFX Library & Auto-Placement (Pilar 3)

**Fecha:** 2026-11-23
**Estado:** Completado y verificado

## Qué se hizo

Se implementó el motor de **Auto-colocación y Catálogo de Efectos de Sonido (SFX)**
para enriquecer los videos de YouTube automáticamente con audio cues de impacto
y atención (wooshes, dings, pops, booms) al estilo de edición humana profesional
(Ali Abdaal, MrBeast, Vox).

### Archivos creados y modificados

| Archivo | Cambio |
|---|---|
| `apps/desktop/src/state/sfx-placer.ts` | **Nuevo módulo puro**: catálogo de los 8 presets sintetizados (`sfx-woosh`, `sfx-boom`, `sfx-ding`, `sfx-pop`, `sfx-click`, `sfx-riser`, `sfx-glitch`, `sfx-subdrop`), función `ensureSfxAsset` con UUID v4 y etiquetas, y motor `autoPlaceSfx` con espaciado inteligente (`minIntervalFrames`) y niveles en dB. |
| `apps/desktop/src/state/sfx-placer.test.ts` | 4 tests unitarios: registro y deduplicación de assets, colocación de wooshes en zooms/transiciones, dings en cifras/estadísticas, pops en emojis, y respeto de ventana mínima de espaciado. |
| `apps/desktop/src/state/project-actions.ts` | Re-exporta `autoPlaceSfx`, `ensureSfxAsset`, `SFX_CATALOG` y sus tipos. |
| `apps/desktop/src/state/autoedit-apply.ts` | Opciones `sfx?: boolean` y resultado `sfxCount?: number`. Al activarse, crea pista dedicada de SFX y monta efectos sincronizados. |
| `apps/desktop/src/state/autoedit-engine.test.ts` | Test que comprueba que `sfx: true` en el autoedit genera una pista de audio "SFX" con clips válidos y esquema de proyecto íntegro. |
| `apps/desktop/src/state/mcp-catalog.ts` | Herramienta `timeline_auto_sfx` registrada en catálogo MCP con parámetros `zooms`, `transitions`, `captions`, `hook`, `gainDb`, `trackName`. |
| `apps/desktop/src/state/mcp-tools.ts` | Handler `case 'timeline_auto_sfx'` en el switch MCP. |
| `apps/desktop/src-tauri/src/mcp/server.rs` | `"timeline_auto_sfx"` agregada a la allowlist de Rust MCP. |
| `apps/desktop/src/state/mcp-tools.test.ts` | Test de integración para `timeline_auto_sfx`. |

### Reglas de Auto-Colocación

1. **Gancho inicial (Hook, Frame 0):** `sfx-boom` para captar la atención de inmediato.
2. **Zooms punch-in y transiciones:** `sfx-woosh` sincronizado con el inicio del acercamiento o corte.
3. **Subtítulos con datos / cifras / palabras clave:** `sfx-ding` al inicio del cue (detecta números, %, $, exclamaciones o palabras de alto impacto).
4. **Emojis y stickers gráficos:** `sfx-pop` para dar sensación táctil y orgánica.
5. **Control de saturación (`minIntervalFrames`):** Ventana de descanso (por defecto ~1.2 s) que previene la acumulación cacofónica de sonidos seguidos.
6. **Mezcla automática:** Ganancia atenuada por defecto (-5 dB a -8 dB) para sentarse de forma limpia debajo del habla principal sin tapar la voz.

## Verificación

- `npm run typecheck` ✅ (exit 0 en los 4 paquetes)
- `sfx-placer.test.ts` 4/4 ✅ (862 ms)
- `autoedit-engine.test.ts` 30/30 ✅ (762 ms)
- `mcp-tools.test.ts` 72/72 ✅ (7.08 s)
- `mcp-validation.test.ts` 12/12 ✅ (1.63 s)
