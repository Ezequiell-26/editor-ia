# Paridad con Drift — auditoría, implementación y límites

Referencia auditada: `CutWire-Studios/Drift` (clon en `../drift-ref`), un editor de video
Qt/C++ con compositor GPU propio (MLT + GLSL) y licencia **GPL-3.0**.

Este documento dice qué estructura tiene Drift, qué tenía Olyvia antes, qué se implementó en
este ciclo y qué queda pendiente. Cada fila apunta al archivo donde vive el código.

## 1. Restricción legal (primera decisión de diseño)

Olyvia es **MIT**; Drift es **GPL-3.0**. Copiar shaders, manifiestos o código C++ de Drift
dentro de Olyvia relicenciaría todo el producto como GPL. Por eso este trabajo **no copia
código de Drift**: replica la *arquitectura* (manifiestos declarativos + stack ordenado +
pipeline GPU multipaso) con implementación propia.

Consecuencia práctica: los 69 efectos de Drift no se "portaron", se reimplementaron con las
mismas categorías y una cobertura equivalente. El formato de datos es compatible en espíritu
(JSON + shader por efecto), no byte a byte.

## 2. Matriz de estructuras

| Estructura de Drift | Dónde vive en Drift | Antes en Olyvia | Estado ahora |
|---|---|---|---|
| Efecto = paquete declarativo (`effect.json` + `main.frag`) | `effects/*/` | No existía | `EffectManifest` en `packages/effect-kit/src/types.ts` |
| Parámetros tipados con grupos | `docs/custom-effects.md` | Struct plano de ~30 campos | `ParamSpec` + `ParamControl` por tipo |
| Pipeline GPU multipaso | `pipeline.passes[]` | No existía | `GpuPass[]` + ping-pong de FBO en `webgl.ts` |
| Stack ordenado por clip | `core/effects` | No existía | `clip.effects.stack[]` + `stack.ts` |
| Keyframes por parámetro | `ui/keyframes` | No existía | `EffectKeyframe[]` + `sampleKeyframes` |
| Navegador con categorías y búsqueda | `src/qml` | 9 presets fijos | `EffectBrowser.tsx` |
| 69 efectos de video | `effects/` | ~12 equivalentes | **48 efectos** en `catalog/video.ts` |
| 28 transiciones GPU | `transitions/` | 7 fijas en el schema | **22 transiciones** en `catalog/transitions.ts` |
| 30 efectos de audio | `audio-effects/` | EQ/paneo/loudness por pista | **30 efectos** en `catalog/audio.ts` |
| 20 plantillas de efecto | `effect-templates/` | 9 presets de un objeto | **Pendiente**: el stack ya lo permite, falta la UI |
| Animaciones de texto (24 JSON) | `presets/text-animations/` | `caption-motion` propio | Sin cambios (ya cubierto) |
| Scopes | `src/ui/color` | `ScopesPanel` | Sin cambios |
| Seguimiento y máscaras | `core/tracking` | Máscaras + face track | Sin cambios |
| Ruedas de color, curvas, HSL | `color_grade` | Ya en el schema | Sin cambios |
| MCP para agentes | `src/app/mcp` | `commands/mcp.rs` | Sin cambios |

## 3. La brecha real, en una frase

Olyvia tenía **un conjunto cerrado de ajustes**; Drift tiene **un sistema abierto de
efectos**. La diferencia no es la cantidad: es que un efecto es un dato que se puede sumar,
ordenar, apagar, animar y exportar sin tocar el código del editor.

## 4. Qué se implementó

### 4.1 Motor (`packages/effect-kit`, MIT)

| Archivo | Responsabilidad |
|---|---|
| `src/types.ts` | Contrato: manifiesto, parámetros, passes, receta de export, instancia |
| `src/params.ts` | Defaults, coerción por tipo, grupos, plantillas FFmpeg, muestreo de keyframes |
| `src/stack.ts` | Operaciones inmutables: agregar, mover, duplicar, apagar, resetear, tope de 32 |
| `src/registry.ts` | Registro con búsqueda sin acentos y conteo por categoría |
| `src/ffmpeg.ts` | Compilación stack → pasos de filtro, con fidelidad agregada |
| `src/webgl.ts` | Renderer WebGL2: programas con caché, uniforms por tipo, multipaso, transiciones |
| `src/shaders/prelude.ts` | Vertex shader, encabezado y utilidades GLSL (`ek_*`) |

### 4.2 Catálogo

- **48 efectos de video** en 9 categorías: color, luz, desenfoque, estilo, glitch, retro,
  impacto, croma y distorsión. 137 parámetros en total.
- **22 transiciones**, 20 de ellas con nombre `xfade` equivalente (paridad exacta en export).
- De los 48 efectos, **42 exportan** (8 exactos, 34 aproximados) y **6 quedan en preview**
  (`light.leak`, `light.flare`, `stylize.halftone`, `glitch.wave`,
  `distort.ripple`, `distort.twirl`). `impact.zoom_pulse` exporta desde el
  2026-11-08 con receta de grafo (`split` + `scale eval=frame` + `overlay`):
  la misma curva `exp(-6·fract(rate·t))·amount` del shader, muestreo por
  remuestreo del frame completo (aproximado, no bilineal). `blur.zoom`
  exporta desde el 2026-11-08 con grafo de 6 tomas (`split=12` + `scale`
  por factor `1/(1-amount·t)` + `overlay` con el ancla del centro +
  `blend=all_mode=average` par a par): promedio radial hacia `center`,
  verificado con FFmpeg real (diff medio YAVG 4,4 en el centro vs 54–79 en
  las esquinas de `testsrc2`).
- 9 efectos usan receta de **grafo** (`split` + `blend`/`overlay`), no una lista de filtros sueltos:
  duotono, bloom, glow, halación, contorno, caleidoscopio, espejo, zoom punch y blur radial.
- Cada manifiesto declara `fidelity` (`exact` / `approximate` / `preview-only`) y, cuando es
  aproximado, el motivo.

### 4.3 Integración

- `packages/project-schema/src/timeline.ts`: `effects.stack` opcional, retrocompatible con
  proyectos viejos; el schema JSON regenerado queda en `packages/project-schema/schema/`.
- `apps/desktop/src/features/vfx/EffectStudio.tsx`: catálogo + pila + preview GPU.
- `apps/desktop/src-tauri/src/render/effect_recipes.rs`: tabla generada desde el catálogo.
- `apps/desktop/src-tauri/src/render/ffmpeg.rs`: `apply_effect_stack` aplica el stack sobre la
  cadena del clip, respetando el orden y salteando lo que no tiene receta.

### 4.4 Flujo de trabajo

```
catálogo (TS)  ──►  manifiesto  ──►  instancia en clip.effects.stack
                                          │
                     ┌────────────────────┴────────────────────┐
                     ▼                                         ▼
              WebGL2 (preview)                        FFmpeg (export)
              src/webgl.ts                            effect_recipes.rs
```

Regenerar la tabla de Rust después de tocar el catálogo:

```bash
npm run effects:codegen
```

### 4.5 Audio: mismo motor, otra cadena

Los 30 efectos de audio usan el mismo contrato que los de video (`EffectManifest` + parámetros
tipados + pila ordenada), pero su receta no va a la cadena de imagen: va a la cadena de audio
del clip. La diferencia está en `AudioRecipe.chain` y en dos macros que resuelven lo que una
plantilla estática no puede:

| Macro | Qué resuelve |
|---|---|
| `%RATE%` | Frecuencia de muestreo del perfil. `asetrate` exige un número y el catálogo no conoce el perfil. |
| `%INV:<param>%` | Inverso del parámetro. `asetrate` cambia tono **y** duración; `atempo` con el inverso devuelve el clip a su largo original sin pedir dos controles. |

Familias y cobertura:

| Familia | Efectos | Ejemplos |
|---|---|---|
| `space` | 8 | autopaneo, coro, eco, flanger, phaser, slapback, trémolo, ensanche |
| `texture` | 5 | bitcrush, cristal, 8 bits, cinta, vinilo |
| `transmission` | 5 | megáfono, amortiguado, teléfono, bajo el agua, walkie-talkie |
| `utility` | 6 | compresor, de-esser, EQ de dos bandas, puerta, nivelador, limitador |
| `voice` | 6 | alien, ardilla, grave, robot, oscuro, tambaleante |

- El stack vive en `clip.effects.audioStack` (máx. 32), separado de `effects.stack`: un clip
  puede tener look de imagen y cadena de voz sin consumir el tope del otro. Un clip de audio
  sólo acepta `audioStack` (`AudioClipEffectsSchema`); guardarle un `brightness` sería guardar
  datos que el render ignora.
- La cadena entra en el render como **insert antes del fader**: `apply_audio_effect_stack` se
  llama dentro de `audio_filter` después de los presets de voz y antes de `volume`. El stack es
  procesamiento, la ganancia es mezcla.
- La UI (`AudioEffectStack`) reutiliza el navegador y el panel de pila del estudio de video con
  `kind: 'audio'`, y muestra la cadena compilada para que se vea qué hará el export.

Verificación real (no declarativa):

- Las **30 cadenas** se ejecutan contra el FFmpeg empaquetado con salida limpia
  (`audio-live.test.ts`, 3,3 s).
- `audio.muffled` baja un tono de 6 kHz de **−21,1 dB a −56,9 dB** (35,8 dB de atenuación),
  medido con `volumedetect` en el test de TypeScript y en el test live de Rust.
- `audio.voice_deep` conserva la duración: 1,000 s de entrada → 1,000 s de salida (±0,05 s).

## 5. Lo que queda pendiente (y por qué)

- **Efectos de audio (30 en Drift).** Cerrado en §4.5. Límite: la preview no los simula; el
  panel lo dice y el MP4 los aplica. Un preview Web Audio por efecto queda como trabajo aparte.
- **Plantillas de efecto.** Resuelto (parcial): `state/effect-templates.ts` +
  `EffectTemplates` permiten guardar/aplicar/exportar/importar stacks de video
  y audio como JSON portable. Drift trae 23 de fábrica; acá las plantillas son
  del usuario (no hay catálogo curado).
- ~~**Keyframes en export.**~~ Resuelto: el export segmenta el clip en los frames de
  keyframe y aplica los parámetros estáticos por tramo (`atrim`/`concat` en audio,
  `split`/`trim`/`concat` en video), con muestreo por la misma curva que la preview.
- **Efectos sin receta** (`light.leak`, `light.flare`, `stylize.halftone`,
  `glitch.wave`, `distort.ripple`, `distort.twirl`): se ven en el preview
  y no se escriben en el MP4. El panel lo avisa antes de aplicarlos, con la etiqueta
  "Sólo preview". (`blur.zoom` salió de la lista el 2026-11-08: grafo
  split+scale+overlay+`blend=all_mode=average` de 6 tomas hacia el centro.)
- **Efectos que dependen de malla facial o profundidad** (`face_*`, `depth_*` en Drift):
  requieren geometría por frame; fuera del alcance de FFmpeg.
- **Carga de paquetes de terceros.** El motor está listo para leer manifiestos externos, pero
  falta el importador (`.driftfx` / carpeta) y la validación de seguridad de shaders.

## 6. Cómo agregar un efecto

1. Agregar una entrada en `packages/effect-kit/src/catalog/video.ts` con `params`, `passes` y
   `ffmpeg`.
2. Escribir el shader con el contrato fijo: `u_currentTexture`, `v_texCoord`, `fragColor` y un
   uniform `p_<id>` por parámetro.
3. `npm run effects:codegen` para regenerar la tabla de Rust.
4. `npx vitest run packages/effect-kit` — el test de integridad verifica que cada parámetro
   tenga su uniform y que la receta compile sin marcadores sin resolver.
