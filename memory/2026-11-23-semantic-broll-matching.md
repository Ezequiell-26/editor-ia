# B-Roll Semántico por Keywords de Whisper (Pilar 4)

**Fecha:** 2026-11-23
**Estado:** Completado y verificado

## Qué se hizo

Se implementó el motor de **B-Roll Semántico guiado por transcripción de Whisper**.
En lugar de insertar planos de apoyo (B-roll) a intervalos ciegos y mecánicos (e.g. cada 5 s),
el editor ahora analiza qué está diciendo el orador, extrae palabras clave semánticas
(descartando stopwords en español e inglés), y empareja de forma inteligente los
planos B-roll en los instantes precisos en que se mencionan los conceptos (estilo
YouTube / documentales).

### Archivos creados y modificados

| Archivo | Cambio |
|---|---|
| `apps/desktop/src/state/broll-matcher.ts` | **Nuevo módulo puro**: funciones `normalizeText`, `extractKeywords`, `assetKeywords`, `scoreBrollMatch`, `planSemanticBroll` y `applySemanticBroll`. |
| `apps/desktop/src/state/broll-matcher.test.ts` | 7 tests unitarios: normalización de texto, filtrado de stopwords, extracción de descriptores de assets (etiquetas, tags, bin, stem), puntuación semántica, planificación temporal respetando `minIntervalSeconds`, y montaje en pista de video superpuesta con audio silenciado. |
| `apps/desktop/src/state/project-actions.ts` | Re-exporta las funciones y tipos de `broll-matcher`. |
| `apps/desktop/src/state/mcp-catalog.ts` | Herramienta `timeline_apply_broll` registrada en catálogo MCP con parámetros `brollAssetIds`, `minDurationSeconds`, `maxDurationSeconds`, `minIntervalSeconds`, `minScore`, `trackName`, `transition`. |
| `apps/desktop/src/state/mcp-tools.ts` | Handler `case 'timeline_apply_broll'` en el switch MCP. |
| `apps/desktop/src-tauri/src/mcp/server.rs` | `"timeline_apply_broll"` agregada a la allowlist de Rust MCP. |
| `apps/desktop/src/state/mcp-tools.test.ts` | Test de integración para `timeline_apply_broll`. |

### Reglas del Motor Semántico

1. **Extracción y normalización:** Elimina acentos, diacríticos y puntuación; filtra más de 100 stopwords bilingües.
2. **Descriptores enriquecidos:** Asocia a cada asset B-roll los tokens derivados de su etiqueta, sus tags, su carpeta (bin) y su nombre de archivo.
3. **Puntaje de afinidad (0..100):** Valora coincidencias directas y por raíz/prefijo (e.g. "computad" con "computadora").
4. **Montaje profesional no destructivo:** Coloca los planos en una pista de video superior ("B-Roll"), silencia su audio (`audio.muted = true`) para no tapar la voz del plano inferior, y aplica disoluciones suaves.
5. **Control de ritmo humano (`minIntervalSeconds`):** Garantiza que los planos B-roll respiren (por defecto mínimo 5 s entre inserciones) para no cansar al espectador.

## Verificación

- `npm run typecheck` ✅ (exit 0 en los 4 paquetes)
- `broll-matcher.test.ts` 7/7 ✅ (738 ms)
- `sfx-placer.test.ts` 4/4 ✅ (862 ms)
- `autoedit-engine.test.ts` 30/30 ✅ (762 ms)
- `mcp-tools.test.ts` 72/72 ✅ (6.99 s)
- `mcp-validation.test.ts` 12/12 ✅ (1.63 s)
