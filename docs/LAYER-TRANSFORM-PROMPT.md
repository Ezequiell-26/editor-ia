# Caja de manipulación por elemento de la timeline · estudio, prompt y plan

Fecha: 2026-11-07. Alcance: `apps/desktop` (React 19 + TS) y
`packages/project-schema`. Pedido del usuario: «cada cosa que pongo en la
línea de tiempo sea manipulable en el video; cuando meto una oración y la
apreto me marca el cuadro del video completo en vez de las palabras; también
si meto otro video, foto o logo, que el video sea customizable».

---

## 1. Estudio de arquitectura (medido, no inferido)

### 1.1 Dos modelos de capa distintos

| Concepto | Tipo | Selección | ¿Caja de transformación? |
| --- | --- | --- | --- |
| Clip de vídeo / imagen / freeze / graphic | `Clip` (`packages/project-schema/src/timeline.ts:32-40, 854-864`) | `selection.kind === 'clip'` | Sí, `PreviewTransformBox` |
| Oración, subtítulo, sticker, título | `CaptionCue` (`packages/project-schema/src/captions.ts:87-105`) | `selection.kind === 'cue'` | **No existe** |
| Audio / adjustment / compound | `Clip` | `clip` | No (`isTransformable` los excluye, no tienen capa visual) |

Los títulos y stickers de la biblioteca se insertan con
`addTitleFromTemplate` y dejan `selection = { kind:'cue', id: cueId }`
(`EditorAssets.tsx`): por eso al «apretar la oración» no hay ninguna caja
propia; lo que se ve es el recuadro del clip de vídeo seleccionado o el marco
del fotograma completo.

### 1.2 Causa raíz del recuadro completo

`features/editor/transform-overlay.ts:50-63`:

```ts
width:  project.width * transform.scaleX * factor,
height: project.height * transform.scaleY * factor,
```

`boxRect()` deriva SIEMPRE el tamaño de `project.video.width/height`, no del
elemento. El esquema de clips **no tiene** `width`, `height` ni `position`:
sólo `offsetX/offsetY`, `scaleX/scaleY`, `rotationDeg`, `opacity`, `flip`,
`perspective`, `keyframes` (`timeline.ts:265-279`). Con `transform` vacío la
caja mide exactamente el fotograma: 1920×1080 escalado al monitor.

`PreviewTransformBox.tsx:100` llama a `boxRect(transform, project.video, canvas)`
sin consultar el DOM de la capa. Con dos clips superpuestos, la caja no se
diferencia por capa: sólo cambia por su `transform`.

### 1.3 Geometría real del texto

`CaptionOverlay` vive dentro de `Preview.tsx:879-997`. Renderiza:

- `<div class="preview-caption caption-{top|center|bottom}" data…>` con
  `position:absolute; left:6%; right:6%; display:flex; justify-content:center;
  pointer-events:none` (`styles/app.css:4523-4550`).
- Un `<span>` interior con `fontSize = max(10, fontSizePx * scale)`, y
  `transform: translate(...) scale(...) rotate(...)` cuando hay `motion`.
- Desplazamiento manual `cue.offsetX/offsetY` en píxeles de proyecto
  (`captions.ts:100-102`), ya persistido y aplicado en `Preview.tsx:957-967`.

Es decir: **el ancho real de las palabras ya existe en el DOM**, pero nunca se
mide. No hay `measureText`, `getClientRects` ni ningún helper de límites de
texto en `features/editor`.

### 1.4 Campos disponibles para persistir (sin migración de esquema)

- Cue: `offsetX`, `offsetY` (mover) y `motion.keyframes` con exactamente 2
  keyframes (`frame 0` y `frame <= endFrame-startFrame`) y campos `scale`
  (0.2–4), `rotationDeg` (−180..180), `opacity` (0..1), `x`, `y`
  (`captions.ts:67-85`). `captionMotionAt()` interpola; con el mismo valor en
  ambos keyframes el resultado es constante y apto para transformación estática.
- `updateCaptionCue` (`project-actions.ts:4177`) **no acepta** `offsetX/Y` en su
  `patch`, así que la escritura se hace con `store.update(recipe)` y un helper
  puro nuevo.
- Clip: `transform` vía `store.update` (ya lo hace `PreviewTransformBox.apply`).

### 1.5 Escritura y arrastre

`PreviewTransformBox.apply()` (`102-137`) usa `store.update` y normaliza a
`undefined` los valores por defecto. Los tiradores (`233-264`) cubren
`move`, `scale` (esquinas), `scale-x/y` (bordes), `rotate` y un slider de
opacidad. `hasKeyframes` bloquea la caja. Toda la aritmética de drag está en
`transform-overlay.ts` y es reutilizable para cues: `movePatch` ya expresa el
delta en píxeles de proyecto, que es exactamente la unidad de
`cue.offsetX/offsetY`.

### 1.6 Contratos frágiles

- `transform-overlay.test.ts` fija `boxRect` identidad → 960×540 completos.
  **No se cambia `boxRect`**: se añade una ruta alternativa con `bounds`.
- `PreviewTransformBox.test.tsx` (7 tests) renderiza con `clip/project/…` y
  mockea `store.update`. **Se preserva la API actual** con props opcionales.
- `packages/project-schema` valida el JSON Schema comprometido
  (`schema-artifacts.test.ts`). **No se toca el esquema**: se reutilizan
  `offsetX/Y` y `motion`.
- `CaptionOverlay`, la selección de cues y la geometría del texto no tienen
  tests; se añaden.

---

## 2. Prompt maestro (copiar y pegar)

```
# Objetivo
Que CADA elemento de la timeline tenga su PROPIA caja de manipulación en el
vídeo, dibujada sobre los límites reales de ese elemento (las palabras de una
oración, el logo, la foto, el segundo vídeo), y que mover / escalar / rotar /
opacidad escriban en ESA capa. Prohibido seguir marcando el fotograma completo
del proyecto cuando lo seleccionado es un texto u otra capa acotada.

# Repo y estado verificado
D:\Users\ofici\QODER-WORK\editor-ia · apps/desktop + packages/project-schema.
- transform-overlay.ts:50-63 boxRect() usa project.width/height → frame completo.
- PreviewTransformBox.tsx:100 lo consume; apply() escribe clip.transform con
  store.update; isTransformable() excluye audio/adjustment/compound.
- Preview.tsx:879-997 CaptionOverlay (texto real en un <span>), :1137-1141
  selectedClip sólo si selection.kind==='clip', :1608-1615 sólo renderiza caja
  para clips, :1541-1545 click en el vídeo sólo busca [data-clip-id].
- selection.kind==='cue' para oraciones/subtítulos/stickers; NO tiene caja.
- CaptionCue ya tiene offsetX/offsetY y motion.keyframes(2) con scale,
  rotationDeg, opacity. captionMotionAt() los interpola.
- updateCaptionCue no acepta offsetX/Y → usar store.update con helper puro.

# Reglas inviolables
1. Preservar TODO el trabajo no confirmado (git status al inicio). Sin commit,
   push, reset --hard, clean ni reconstruir el instalador.
2. NO cambiar el esquema: sin migración, sin schema:generate, sin tocar Rust.
   Reutilizar offsetX/offsetY y motion con 2 keyframes válidos
   (from.frame=0, to.frame>0 y <= endFrame-startFrame, scale 0.2..4,
   rotationDeg -180..180, opacity 0..1).
3. NO cambiar boxRect ni la API actual de PreviewTransformBox: los 7 tests
   existentes y transform-overlay.test.ts deben seguir verdes sin editarlos.
   Extender con props OPCIONALES (bounds, transformOverride, onApply, label,
   locked, clip opcional).
4. Conservar toda la funcionalidad real. Lo que no tiene capa visual
   (audio/adjustment/compound) se documenta, no se simula.
5. Sin dependencias nuevas. Sin emojis. Tokens --fm* para el verde.
   Una sola fuente de verdad por concepto.

# Arquitectura objetivo: UNA CAJA · UNA CAPA · UN DESTINO DE ESCRITURA
1. features/editor/layer-bounds.ts (NUEVO, puro y testeable):
   - boundsFromMeasurement(canvasRect, element, scaleX, scaleY, rotationDeg):
     centro desde el AABB medido (getBoundingClientRect, ya incluye transform),
     tamaño base desde offsetWidth/offsetHeight (layout, SIN transform)
     multiplicado por la escala, rotación aparte. Así la caja dibujada con
     rotate() coincide con el contenido vivo.
   - cueBoxTransform(cue, motion): BoxTransform con offsetX/Y del cue y
     scale/rotation/opacity del motion.
   - patchCueTransform(project, cueId, patch): escribe offsetX/Y (0 → delete)
     y construye/destruye motion con 2 keyframes del mismo valor; respeta
     pista bloqueada; clamp a los rangos del schema; función PURA.
2. Preview.tsx:
   - canvasRef en .preview-canvas; useLayoutEffect mide la capa seleccionada
     tras cada render (deps: id, playhead, frameWidth/Height, transform) y
     guarda bounds con comparación de igualdad para no loopear.
   - selectedCue cuando selection.kind==='cue' y el playhead lo muestra.
   - data-cue-id en .preview-caption y data-cue-content en el <span> de texto
     (ambos casos: palabras y texto plano).
   - click en el vídeo: además de [data-clip-id], resolver [data-cue-id] →
     setSelection({kind:'cue'}). pointer-events:auto SÓLO en el span del texto.
   - Renderizar PreviewTransformBox para clip O cue; para cue pasar
     transformOverride + onApply(patchCueTransform) + label con el texto.
   - Para clips pasar bounds medido del layer [data-clip-id] cuando exista.
3. PreviewTransformBox.tsx: clip opcional; bounds/transformOverride/onApply/
   labelOverride/lockedOverride opcionales. Sin ellos, comportamiento idéntico.
   movePatch/scalePatch/rotatePatch se reutilizan tal cual (sus unidades ya
   son píxeles de proyecto, igual que cue.offsetX/Y).
4. CSS: la caja verde ya existe (filmora-polish.css § monitor); asegurar que
   el span de caption sea clickeable y que la caja no quede detrás del texto.

# Criterios de aceptación (medibles)
- Al seleccionar una oración, .transform-box envuelve el <span> de las palabras
  (ancho muy menor que el frame) y NO el fotograma completo.
- Arrastrar esa caja cambia cue.offsetX/offsetY; escalar/rotar escribe motion
  con 2 keyframes válidos; Restablecer limpia ambos; la caja sigue al texto.
- Hacer clic sobre las palabras EN EL VÍDEO selecciona ese cue.
- Al seleccionar un clip, la caja se mide sobre SU layer [data-clip-id]; con
  dos clips superpuestos y transforms distintos las cajas difieren.
- typecheck 0 · build 0 · tests nuevos + los 7 de PreviewTransformBox +
  transform-overlay.test.ts en verde · suite serial sin regresiones nuevas ·
  medición en navegador real con números de antes/después.

# Proceso y entrega
Estudiar → este documento → implementar → medir → verificar → informar en
español, con tabla de hallazgos, archivos, comandos, métricas y deuda honesta.
```

---

## 3. Decisiones de diseño

1. **Medir, no inventar**: el ancho de las palabras ya está en el DOM. No se
   añade un modelo de cajas al esquema (evita migración, Rust, JSON Schema y
   export FFmpeg).
2. **`boxRect` intacto**: sigue siendo el fallback para clips sin medición y
   para los tests. La ruta nueva es `bounds` medido.
3. **`motion` como transformación estática**: dos keyframes con el mismo valor
   producen un `captionMotionAt` constante. Es un campo ya soportado por el
   render y por el export.
4. **Límite honesto**: con `cue.words` (revelado por palabra) `CaptionOverlay`
   ignora `motion` por diseño; en ese caso la caja permite mover y muestra
   escala/rotación bloqueadas, en lugar de fingir que funcionan.
5. **Clips a pantalla completa**: un vídeo sin `transform` ocupa el fotograma,
   así que su caja coincide con el frame. Eso es correcto; lo que cambia es que
   ahora la caja pertenece a ESA capa y se puede escalar para hacer PiP/logo.

---

## 4. Riesgos y límites

- `getBoundingClientRect()` de un elemento rotado es un AABB; por eso el tamaño
  se toma de `offsetWidth/offsetHeight` y la rotación se aplica aparte.
- Medir en `useLayoutEffect` añade una lectura de layout por frame cuando hay
  selección durante la reproducción; se compara el resultado antes de setear
  estado para evitar renders en bucle.
- `CaptionMotionSchema` exige `to.frame <= endFrame-startFrame`; cues de 1 frame
  usan `to.frame = 1`.
- No se declara «todo manipulable» para audio/adjustment/compound: no tienen
  capa visual en el visor.
