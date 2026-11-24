# Pilar 5: Music Punchline Mutes y Ritmo Dinámico

**Fecha:** 2026-11-23  
**Estado:** Implementado, verificado y testeado con typecheck limpio (exit code 0).

## 1. Contexto y Problema

En la edición humana para YouTube (e.g. Ali Abdaal, MrBeast, Vox, Johnny Harris, Veritasium):
1. **Ritmo Dinámico (Dynamic Pacing Curve):** Un video nunca mantiene una cadencia de corte uniforme (ej. 3.0 s constante). El hook inicial (0–15%) requiere cortes rápidos (factor ~0.6×) para retención; el cuerpo (15–80%) mantiene el ritmo nominal (1.0×); el clímax (80–95%) acelera hacia la conclusión (0.7×); y el outro (95–100%) da aire para el cierre (1.2×).
2. **Music Punchline Mutes & Auto-Ducking:** La música de fondo debe bajar de volumen durante la voz activa (-18 dB), subir en silencios/B-roll (-10 dB), y sufrir una caída abrupta a silencio (-60 dB) durante 0.8–2.5 s en remates de chistes, silencios tras frases de alta energía o elipsis (`...`), entrando de nuevo con la siguiente frase.

## 2. Componentes Implementados

### `apps/desktop/src/state/dynamic-pacing.ts`
- **Pacing dinámico:**
  - `DEFAULT_PACING_ZONES`: Hook (0–15%, 0.6×), Body (15–80%, 1.0×), Climax (80–95%, 0.7×), Outro (95–100%, 1.2×).
  - `modulateCutSeconds(nominalSeconds, positionSeconds, totalDuration, zones)`: modula y clampea suavemente entre [0.8, 12] s con suavizado de bordes entre zonas.
  - `pacingZoneAt(positionSeconds, totalDuration)`: devuelve el nombre de la zona actual.
- **Punchline Moments:**
  - `detectPunchlineMoments(transcript, silences, minPauseDuration)`: detecta pausas dramáticas, elipsis textuales (`...`, `…`) y silencios tras segmentos de alta energía acústica/textual.
- **Music Ducking Automation:**
  - `buildDuckingKeyframes(...)`: genera keyframes en segundos con rampas `ease-out` y `ease-in`, deduplicando colisiones temporales.
  - `applyMusicDucking(project, options)`: identifica la pista de música (por ID o etiqueta con `music`/`música`/`bgm`), y aplica `TrackGainKeyframe` ordenados usando `setTrackGainKeyframe`.

### Integración en `autoedit-engine.ts` y `autoedit-apply.ts`
- `AutoEditRecipe`: soporte para `dynamicPacing?: boolean`.
- `clampRecipe`: preservación de `dynamicPacing`.
- `selectCuts`: modulación en tiempo real de la duración de corte de candidatos según el progreso temporal del montaje.
- `applyAutoEditVariant`: opción `musicDucking?: boolean` que aplica ducking y punchline mutes en la pista de música si existe en el proyecto.

### Herramienta MCP y Servidor Rust
- **Catálogo MCP (`apps/desktop/src/state/mcp-catalog.ts`):** herramienta `timeline_music_ducking`.
- **Ejecución MCP (`apps/desktop/src/state/mcp-tools.ts`):** `case 'timeline_music_ducking'`.
- **Whitelist Rust (`apps/desktop/src-tauri/src/mcp/server.rs`):** agregado `"timeline_music_ducking"` a la lista de herramientas permitidas.

## 3. Pruebas y Verificación

- `dynamic-pacing.test.ts`: 21 tests unitarios pasando (curva de modulación, zonas, detección de punchlines, ducking, keyframes de pista y ordenamiento estricto).
- `autoedit-engine.test.ts`: 32 tests pasando (+2 tests nuevos para dynamicPacing y musicDucking en autoedit).
- `mcp-tools.test.ts`: 72 tests pasando (+1 test de llamada MCP a `timeline_music_ducking`).
- `mcp-validation.test.ts`: 12 tests pasando.
- `npm run typecheck`: exit 0 en los 4 paquetes (`@editor-ia/project-schema`, `@editor-ia/effect-kit`, `apps/desktop`, `apps/render-worker`).
