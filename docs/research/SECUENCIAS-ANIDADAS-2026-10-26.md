# Diseño: secuencias anidadas / clips compuestos (P2)

**Estado**: propuesta (2026-10-26). Documento de investigación, cero código.
**Base real**: todo lo que sigue fue verificado leyendo, en la rama
`feat/motion-graphics` (con los cambios sin commitear vigentes),
`packages/project-schema/src/` (`project.ts`, `timeline.ts`, `assets.ts`,
`time.ts`, `production.ts`, `schema-document.ts`, `scripts/generate-json-schema.ts`),
`apps/desktop/src/state/` (`project-actions.ts`, `project-store.tsx`),
`apps/desktop/src/features/editor/` (`Timeline.tsx`, `Inspector.tsx`, `Preview.tsx`),
`apps/desktop/src-tauri/src/` (`render/ffmpeg.rs`, `commands/preview_frame.rs`,
`commands/fcpxml.rs`, `commands/otio.rs`, `commands/edl.rs`, `commands/loudness.rs`,
`commands/projects.rs`, `projects/service.rs`), `apps/render-worker/src/protocol.ts`,
`docs/AUDIT.md` (P2 #7) y `docs/research/TIME-REMAP-FRAME-2026-10-26.md`.
No se ejecutó la app ni el render: los hallazgos de comportamiento son lecturas de
código, no ejecuciones.

## Por qué

El ítem P2 #7 de `docs/AUDIT.md:95` pide **secuencias anidadas / clips
compuestos**: una secuencia usada como clip dentro de otra, como en Premiere
(anidación) o Resolve (clips compuestos). El compuesto plano v1 ya existe de
punta a punta, pero **no se puede anidar**: el esquema lo prohíbe a propósito.

Hoy (verificado):

- `packages/project-schema/src/timeline.ts:30-38`: `ClipKindSchema` incluye
  `'compound'`. `timeline.ts:907-918` define `CompoundClipSchema` con
  `source: { type: 'compound', compoundId }`.
- `timeline.ts:861-876`: `CompoundInnerClipSchema` sólo acepta video, audio,
  imagen, gráfico, congelado y ajuste; el comentario lo dice explícito:
  *"Nested compounds are deliberately not allowed"*.
- `timeline.ts:878-905`: `CompoundSchema` es `{ id, label, durationFrames,
  clips[1..200] }`. Los clips internos **mantienen su `trackId` original y su
  `startFrame` relativo**, y sus ids viven en el mismo espacio global que la
  timeline (`project.ts:244-249` exige unicidad "across the timeline and its
  compounds").
- `project.ts:127`: `compounds: z.array(CompoundSchema).max(100).optional()`.
- `project.ts:209-226`: integridad de compuestos — el clip de timeline debe
  referenciar un compuesto existente y **`durationFrames` del clip debe ser
  exactamente `compound.durationFrames`**.
- Acciones (`apps/desktop/src/state/project-actions.ts`): `createCompound`
  (3190-3271) agrupa todos los clips que se solapan con el ancla en cualquier
  pista y **rechaza** agrupar un compuesto (3197-3198) o un rango que contenga
  uno (3219-3223); `expandCompound` (3275-3319) devuelve los clips internos a
  sus pistas y borra la definición, y se niega si hay más de una instancia
  (3296-3300); duplicar/pegar clona la definición con ids nuevos
  (`cloneCompoundForClip`, 3321-3336); los compuestos no se recortan
  (`trimClip`, 1253-1257) ni se dividen (`splitClip`, 1583-1586).
- Render (`apps/desktop/src-tauri/src/render/ffmpeg.rs:2526-2629`):
  `expand_compounds` **aplaña** cada clip compuesto antes de armar el grafo:
  reinserta los clips internos desplazados a la posición del compuesto,
  propaga `hidden` de la pista contenedora (descarta el compuesto entero),
  propaga `muted`/`solo` al audio interno, y da error si falta la definición o
  un interno excede la duración. `build_plan_range` lo invoca si hay compuestos
  (2635-2647) y arma **una sola invocación FFmpeg** con fondo de color
  (2772-2789), capas por `order` de pista (2668-2681) y mezcla de audio por
  pista (2684-2695).
- El mismo punto de aplanado sirve a todo: preview de un frame
  (`commands/preview_frame.rs:776`) y los cuatro exportadores
  (`commands/fcpxml.rs:334`, `commands/otio.rs:138`, `commands/edl.rs:182`,
  `commands/loudness.rs:250`).
- UI: el Inspector tiene `CompoundInspector` con nombre, duración, lista de
  internos y "Deshacer compuesto" (`features/editor/Inspector.tsx:389-436`);
  el botón "Agrupar en compuesto" vive en el Inspector (`Inspector.tsx:1493`,
  etiqueta en 1510). La timeline no tiene manejo de compuestos propio ni
  doble clic (no hay `onDoubleClick` en `Timeline.tsx` — búsqueda sin
  resultados); el menú contextual existe (`Timeline.tsx:596-602`) pero no
  tiene entradas de compuesto.

**El hueco**: el aplanado actual funciona porque los clips internos referencian
pistas de la timeline raíz. El día que una secuencia puede contener otra, "sus
pistas" ya no son las de la raíz: hace falta un modelo que tenga pistas propias
por nivel (o decidir que nunca las tendrá), una regla anti-ciclos, y una
política de cómo se componen transform/zoom/audio entre niveles.

**Hallazgo previo que bloquea todo esto** (verificado leyendo, no ejecutado):
la clave raíz `compounds` **no** está en `KNOWN_ROOT_KEYS` del validador Rust
(`projects/service.rs:27-48`, 20 claves, sin `compounds`), mientras que el
validador TS sí la tiene (`project.ts:45`). `save_project` del comando Tauri
(`commands/projects.rs:323-329`) llama a `service::save_project`
(`service.rs:1045-1046`), que valida con `validate_document` (`service.rs:753`),
y ese rechaza claves raíz desconocidas con "clave raiz desconocida; solo se
admite el prefijo x-" (`service.rs:799-804`). Conclusión: **hoy, guardar un
proyecto que contenga `compounds` falla en la frontera Rust** (open/save en
`service.rs:1014/1037/1046`). No hay ningún test Rust que cubra compuestos
(búsqueda sin resultados en `projects/tests.rs` y `src-tauri/tests/`). Esto no
impide renderizar ni editar, pero sí persistir; es la Fase 0 del plan.

## Decisión de diseño (resumen)

1. **Nueva colección raíz `sequences` con pistas propias** (modelo "secuencia
   anidada" tipo Premiere), no compuestos anidados dentro del espacio único de
   pistas. `compounds` v1 queda intacto.
2. **Recursión con prohibición de ciclos en el validador** (DFS sobre las
   aristas secuencia→secuencia en `integrityIssues`) más tope de profundidad.
3. **El clip contenedor es una sola capa**: su transform/opacity/blend se
   aplican al compuesto interno ya aplanado, no se distribuyen a los internos.
4. **Render por composición en línea** (expansión recursiva en el plan, un
   sub-grafo por nivel), reutilizando el patrón de `expand_compounds`. El
   pre-render a archivo queda como acción explícita futura, no como mecanismo.
5. **UI con ruta de edición** (breadcrumb) en el estado de la vista, no en el
   documento; doble clic para entrar.
6. **Migración aditiva**: `sequences` es opcional; los `compounds` existentes
   no se convierten; se agrega la clave a ambas listas de claves raíz y se
   regenera el artefacto JSON Schema.

## 1. Modelo de datos: recursión y prohibición de ciclos

### 1.1 Modelo elegido: secuencia con pistas propias

Nueva colección opcional en la raíz, espejo de `compounds`
(`project.ts:127`):

| Campo de `SequenceSchema` | Tipo / regla | Espejo de |
|---|---|---|
| `id` | `EntityIdSchema`, único en el proyecto | `CompoundSchema.id` (`timeline.ts:880`) |
| `label` | 1–200 caracteres | `timeline.ts:881` |
| `durationFrames` | `DurationSchema` (entero > 0, tope `TOTAL_DURATION_MAX_FRAMES`, `time.ts:11-19`) | `timeline.ts:882` |
| `tracks` | `Track[]` (sin pista `caption`: los subtítulos son globales, `project.ts:286-293` exige pista caption de la raíz) | propio |
| `clips` | `Clip[]` (1–200), con `trackId` referenciando **las pistas de la propia secuencia** | `timeline.ts:883`, pero con espacio de pistas local |

Y en `ClipSchema` (`timeline.ts:940-949`) un nuevo miembro de la unión
discriminada:

| Campo del clip `kind: 'sequence'` | Valor |
|---|---|
| `source` | `{ type: 'sequence', sequenceId }` |
| `durationFrames` | == `sequence.durationFrames` (mismo invariante que compound, `project.ts:220-225`) |
| pista admisible | `video`, `image`, `graphic`, `adjustment` (misma tabla que compound, `timeline.ts:930`) |
| permitidos además | `transform`, `audio.gainDb/muted`, `blendMode`, `colorTag`, `label`, `enabled` — **no** `speed` (v1 sin retimado de secuencias) |

Por qué pistas propias y no extender `CompoundInnerClipSchema` con el clip
compound (la alternativa mínima):

- Los internos de compound viven en el espacio de pistas de la raíz
  (`project.ts:241-261` valida sus `trackId` contra `project.timeline.tracks`).
  Anidar B dentro de A obligaría a que los internos de B convivan en las mismas
  pistas que los internos de A: el orden de capas entre niveles se vuelve
  ambiguo (¿un clip de B en `v1` va por encima o por debajo de un clip de A en
  `v1`?) y el aplanado actual (`ffmpeg.rs:2526-2629`) no tiene forma de
  expresarlo.
- Con pistas propias, cada nivel es un documento completo y la composición es
  determinista: la secuencia se compone internamente igual que la raíz (por
  `order` de pista) y el resultado entra al padre como **una** capa.
- Es el modelo que la UI necesita para "doble clic para entrar": lo que se
  muestra al entrar es la pista y los clips de esa secuencia, con sus propios
  carriles.
- Auditoría de coste: los tipos `Track`/`Clip` ya son recursivos por
  referencia (`Clip` → `source.assetId`), así que el único trabajo nuevo es la
  recursión estructural del esquema.

### 1.2 Recursión en el esquema

`SequenceSchema` contiene `clips: ClipSchema[]` y `ClipSchema` contendrá el
clip `sequence` que referencia `SequenceSchema` por id (no por valor): la
recursión del **grafo de referencias** existe siempre; la recursión del
**esquema zod** sólo aparece si los tipos se declaran mutuamente. Dos caminos:

- **Camino elegido**: `ClipSchema` no anida `SequenceSchema`; el clip
  `sequence` lleva sólo `sequenceId`. El esquema TS sigue siendo un DAG de
  tipos (Sequence usa Clip, Clip no usa Sequence) y la referencialidad se
  valida igual que hoy: en `integrityIssues` (`project.ts:145+`), que ya
  resuelve referencias compuesto→existencia (`project.ts:209-218`) y
  asset/motion (`project.ts:188-196, 229-236`). Ventaja directa: el generador
  JSON Schema (`schema-document.ts:11-40`, `zod-to-json-schema`) no recibe un
  esquema con `z.lazy` dentro de una unión discriminada — la recursión por
  valor es el caso que rompe generadores y validadores Rust que consumen el
  artefacto.
- **Camino descartado**: `z.lazy(() => SequenceSchema)` anidado en la unión.
  Funciona en zod 3.24 en runtime, pero obliga a verificar qué emite
  `zod-to-json-schema` 3.23.5 (la versión restaurada del árbol) para un
  esquema recursivo dentro de `discriminatedUnion` (riesgo de `$ref` colgantes
  o de explosión de expansión inline), y el validador Rust que consume el
  artefacto tendría que resolver referencias.

### 1.3 Prohibición de ciclos

Con referencias por id, el grafo de secuencias es dirigido
(`secuencia A --clip sequence--> secuencia B`) y el formato debe garantizar
que es un **DAG**. Tres reglas, todas en `integrityIssues` (para que valgan al
abrir, al guardar desde el store — `project-store.tsx:30-37` valida cada
mutación con el esquema canónico — y en la frontera):

1. **Auto-referencia**: una secuencia no puede contener un clip cuyo
   `sequenceId` sea su propio id. Mensaje esperado (español, como el resto):
   "una secuencia no puede contenerse a sí misma".
2. **Ciclos indirectos**: DFS por secuencia con tres colores (no visitado /
   en pila / terminado); toda arista hacia un nodo "en pila" es un ciclo.
   Mensaje: "las secuencias forman un ciclo: A → B → A". El rombo (A→B, A→C,
   B→D, C→D) es válido y debe pasar.
3. **Tope de profundidad**: constante nueva `MAX_SEQUENCE_NESTING = 8`
   (mismo estilo que `MAX_TRANSFORM_KEYFRAMES`, `timeline.ts:41`). La
   profundidad no es sólo paranoia de usuarios: acota el tamaño del grafo
   FFmpeg y del argv generado — la razón de existir de los topes actuales
   (`timeline.ts:40-44`: *"Hard caps keep the generated FFmpeg expressions
   inside a bounded argv"*). Mensaje: "la anidación de secuencias supera el
   máximo de 8 niveles".

Además, topes espejo de compound: `sequences: z.array(SequenceSchema).max(100).optional()`
en la raíz y 1–200 clips por secuencia (`timeline.ts:883`).

La prohibición también vive en las **acciones** (defensa en profundidad, como
hace `createCompound` hoy en `project-actions.ts:3197-3198, 3219-3223`):
"crear secuencia desde selección" y "agrupar" rechazan si la selección contiene
un clip de secuencia que es ancestro del destino, con mensaje claro, aunque el
validador volvería a atrapar el caso.

### 1.4 Integridad adicional (misma línea que `project.ts:198-275`)

- Ids de clip únicos en todo el documento (raíz + todas las secuencias), como
  ya se exige entre timeline y compounds (`project.ts:244-249`).
- `trackId` de cada clip de secuencia debe existir en las pistas de **su**
  secuencia y cumplir `clipFitsTrack` (`timeline.ts:933-938`).
- Sin solapamientos entre clips de una misma pista de la misma secuencia
  (espejo de `timeline.ts:1133-1151`, que hoy sólo mira la raíz).
- Referencias a assets y motion resueltas dentro de cada secuencia (espejo de
  `project.ts:262-273`).
- Escenas (`SceneSchema.clipIds`, `production.ts:51`): siguen referenciando
  sólo clips de la raíz; los clips dentro de secuencias no entran en escenas
  en v1 (las escenas ya se reescriben al agrupar/desagrupar,
  `project-actions.ts:3263-3268, 3310-3316`).

## 2. Resolución de estado: transform/zoom entre niveles

### 2.1 Tiempo

- El clip contenedor mapea `[startFrame, startFrame + durationFrames)` del
  padre → `[0, durationFrames)` local de la secuencia. Con el invariante de
  duración fijada (1.1) la velocidad es 1x y el mapeo es una resta:
  `frameLocal = framePadre - startFrame`.
- Playhead: hoy hay **un** playhead global (`project-store.tsx:58`). Al entrar
  a una secuencia, la vista usa un playhead local derivado (si el frame global
  cae dentro de la instancia; si no, 0). El documento no guarda nada nuevo:
  es estado de vista, igual que `selection`.
- Trim/split del clip contenedor: siguen bloqueados en v1, igual que compound
  (`project-actions.ts:1253-1257, 1583-1586`), porque recortar una secuencia
  es recortar una ventana de fuente — eso es v2 (extender el invariante de
  `project.ts:952-970` a secuencias con `inFrame/outFrame` virtual).

### 2.2 Transform, opacidad y blend

Regla única: **el clip de secuencia es una capa atómica**.

- Los transforms de los clips internos se resuelven dentro de la secuencia
  (muestreo igual que hoy: `sampleTransformKeyframes` ya exportado por el
  paquete, `keyframes.ts:175`) y producen el compuesto de ese nivel.
- Encima de ese compuesto se aplica el transform del clip contenedor:
  `offsetX/offsetY` en píxeles del lienzo del padre, `scaleX/scaleY`
  multiplicativos respecto de 1, `rotationDeg` aditivo respecto de 0,
  `opacity` multiplicativa sobre la opacidad ya resultante del interior.
- No se distribuye el transform del contenedor hacia los internos: distribuir
  escala/rotación a través de niveles cambia el resultado según el orden y
  complica el muestreo de keyframes; aplicar sobre el resultado es exactamente
  lo que `visual_filter` ya hace con cualquier clip
  (`ffmpeg.rs:1631-1665`: escala→tamaño par, rotación, opacidad).
- `blendMode` del contenedor se aplica al superponer la capa contra lo que
  está debajo en el padre (mismo mecanismo que cualquier clip,
  `blend_mode_name` en `ffmpeg.rs:624`).
- Zoom (`motion`/zoompan Ken Burns): los internos animan su propio zoom sobre
  sus fuentes (`ffmpeg.rs:1673-1741`); el contenedor puede llevar `motion`
  propio que hace zoompan **sobre el compuesto interno**, igual que hoy un
  image clip hace zoom sobre su imagen. La expresión congelada de preview
  (`frozen`, `ffmpeg.rs:1699-1710`) sigue funcionando porque el sub-grafo de
  la secuencia también se puede rebasar al frame pedido (ver 3.2).

### 2.3 Ajustes y look

- Un clip `adjustment` **dentro** de una secuencia grada sólo el compuesto de
  esa secuencia (su sub-grafo), no la timeline global. Esto es una diferencia
  importante con el aplanado actual de compounds, donde un adjustment interno
  termina grando el compuesto global (el aplanado lo reinserta como
  adjustment de la raíz). Con sub-grafos por nivel el alcance queda natural.
- El `look` global del proyecto (`project.ts:124`) se aplica una sola vez, al
  final, como hoy (`ffmpeg.rs:1612-1616`).

### 2.4 Audio

- Cada nivel mezcla su audio por pista (gainDb/pan/EQ de pista,
  `ffmpeg.rs:2684-2695`); el clip contenedor aporta un **gain de bus**:
  `audio.gainDb` del clip se aplica a la suma del interior, `audio.muted`
  lo silencia.
- La propagación de mute/solo/hidden del padre hacia el interior que hoy hace
  `expand_compounds` (`ffmpeg.rs:2538-2570, 2615-2622`) se generaliza:
  los flags efectivos de la pista contenedora se heredan hacia abajo en la
  ruta de instancias (mute de la pista del padre silencia todo el interior,
  solo de una pista del padre mantiene el interior en solo, pista oculta
  descarta la instancia entera).

## 3. Estrategia de render: pre-render vs composición en línea

### 3.1 Comparación

| Criterio | A. Pre-render (archivo intermedio por secuencia) | B. Composición en línea (expansión recursiva en el plan) |
|---|---|---|
| Frescura | Caducidad: cada edición interna invalida el intermedio; hay que detectar "sucio" por revisión/hash | Siempre fresco: se expande en cada render |
| Cambios al pipeline | El plan no cambia (la secuencia es un clip de video más); el coste se va a un paso previo de render + asset generado | `expand_compounds` se generaliza a expansión recursiva; el resto del plan es igual |
| Coste de disco/provenance | Archivos generados que deben entrar al régimen de assets (`assets.ts:26-32` origen `generated-locally`, integridad sha256, `status`) | Cero archivos |
| Latencia de edición | Re-render de la sub-secuencia tras cada cambio interno (o visible porque queda viejo) | Nada |
| Tamaño del grafo FFmpeg | Plano y acotado | Crece con la anidación; acotado por topes (1.3) |
| Export/preview/loudness | Necesitan el paso previo garantizado | Mismo choke point que hoy (`ffmpeg.rs:2635-2647`) |
| Compatibilidad con worker | Igual (`apps/render-worker/src/protocol.ts` sólo recibe proyecto+salida; sin conciencia de compounds — búsqueda sin resultados) | Igual |

**Decisión: B, composición en línea**, por las mismas razones por las que v1
aplanó compounds: una sola invocación FFmpeg (`ffmpeg.rs:2772+`), cero estados
intermedios que puedan quedar viejos, y un único punto de expansión que ya
sirve a preview, exports y loudness. El pre-render queda como **acción
explícita futura** ("Consolidar secuencia": renderiza a un asset video y
reemplaza el clip; el usuario decide cuándo, no el sistema), útil para
anidaciones pesadas y para mandar material a terceros.

### 3.2 Cómo funciona la expansión en línea

1. Punto único: donde hoy se llama `expand_compounds` (`build_plan_range`,
   `ffmpeg.rs:2635-2647`; `preview_frame.rs:776`; los cuatro exportadores)
   se llama primero a `expand_compounds` (compatibilidad) y después a
   `expand_sequences` (o una sola función que haga las dos pasadas).
2. `expand_sequences` recorre el árbol de instancias con la pila de ancestros
   como estados (detección de ciclo en runtime, espejo del validador) y
   produce un **proyecto aplanado**: cada instancia se convierte en sus clips
   internos con:
   - `startFrame` = `startFramePadre + startFrameInterno` (misma aritmética
     que `expand_compounds`, `ffmpeg.rs:2593-2614`).
   - `trackId` **sintetizado** por (ruta de instancia, pista interna): en el
     proyecto aplanado se agregan pistas nuevas con ids derivados y `kind`
     de la pista interna; el `order` de capa se recalcula para que el interior
     de la instancia quede entre las capas del padre de forma determinista
     (regla propuesta: renumerar por recorrido en profundidad — las capas
     internas de la instancia quedan contiguas, encima de lo que había debajo
     de la pista contenedora y debajo de lo que había encima; es la semántica
     que un editor espera de un grupo).
   - Los flags heredados de mute/solo (2.4) se estampan en el audio interno,
     igual que hoy (`ffmpeg.rs:2615-2622`).
   - El transform/opacity/blend del clip contenedor se materializa como un
     `transform` del **nivel**: la expansión envuelve los clips internos de la
     instancia en una sub-cadena que recibe ese transform. En el grafo plano
     esto significa que los internos de la instancia se componen entre sí en
     una sub-línea y el resultado lleva el transform del contenedor antes del
     overlay final (equivale a lo que hoy hace `visual_filter` sobre un input,
     pero con el input siendo el compuesto interno). Si en una primera fase
     esto resulta demasiado para el generador de expresiones, el límite
     aceptable de v1 es: transform del contenedor soportado sólo con escala/
     offset/opacity (rotación y blend del contenedor en fase siguiente), y se
     documenta.
3. Topes en runtime: profundidad > 8 o ciclo → error `InvalidProject` con el
   mensaje del validador (mismo estilo que `ffmpeg.rs:2587-2592`).
4. Preview de un frame: `window_project` (`preview_frame.rs:773+`) ya expande
   compounds antes de recortar la ventana; con secuencias, la expansión debe
   correr **antes** de recortar para que los internos queden en coordenadas
   de la raíz (mismo orden que hoy: expandir → ventanar).

## 4. UI

### 4.1 Timeline

- El clip `kind: 'sequence'` se dibuja con la clase `kind-sequence` (el bloque
  ya compone la clase por kind, `Timeline.tsx:243`), con insignia de número de
  clips internos y un chevron; color por `colorTag` como cualquier clip.
- **Doble clic para entrar**: hoy `ClipBlock` no maneja `onDoubleClick`
  (verificado); se agrega sobre el bloque: doble clic → entra a la secuencia
  (cambia la ruta de edición, 4.2). Doble clic en el vacío de la timeline no
  sube de nivel (evita sorpresas); se sube con el breadcrumb o Escape.
- Menú contextual (`openClipMenu`, `Timeline.tsx:596-602`): entradas nuevas
  "Abrir secuencia" y "Desanidar" junto a las existentes (dividir/duplicar/
  borrar). El compuesto v1 no cambia su menú (no tiene).
- Teclado: integración con el sistema de atajos (`shortcuts-pro.ts`) —
  propuesta: Ctrl+Enter abre la
  secuencia del clip seleccionado, Escape sube un nivel (sólo si la ruta no
  está vacía y el foco no está en un input, patrón del guard existente en
  `Timeline.tsx:686-688`).

### 4.2 Ruta de edición (breadcrumb) — estado de vista, no documento

- Nuevo en el store de vista: `sequencePath: { clipId, sequenceId }[]` (ruta de
  instancias, no de definiciones: si la misma secuencia está dos veces, el
  breadcrumb distingue la instancia). La timeline renderiza el documento
  "efectivo": si la ruta está vacía, la raíz; si no, los `tracks`/`clips` de
  la última secuencia de la ruta, con el playhead local (2.1).
- Breadcrumb visible sobre la timeline: `Proyecto › Compuesto 1 › Título
  intro`; cada miga es un botón que trunca la ruta. Selección y playhead se
  re-mapean al entrar/salir; al salir, la selección vuelve al clip contenedor.
- Deshacer/rehacer no cambia: la ruta de edición no es parte del documento
  (`undo`/`redo` guardan `ProjectDocument`, `project-store.tsx:56-57`); al
  deshacer una edición interna se sigue dentro de la ruta.

### 4.3 Inspector

`CompoundInspector` (`Inspector.tsx:389-436`) es el molde. Para secuencias,
misma sección con:

- Nombre, duración, cantidad de clips internos (datos ya disponibles).
- Botones: **"Abrir secuencia"** (entra con la ruta), **"Desanidar"**
  (equivalente a `expandCompound`, pero inserta las pistas internas en el
  padre — ver riesgo 7.3), **"Duplicar"** (clona la definición con ids nuevos,
  política ya establecida por `cloneCompoundForClip` para compounds:
  instancias independientes, `project-actions.ts:3321-3336`).
- Texto de ayuda en español explicando la semántica de grupo (editar la
  definición afecta a todas las instancias de esa definición).
- El botón "Agrupar en compuesto" (`Inspector.tsx:1510`) gana un hermano
  "Crear secuencia con la selección" con las mismas validaciones de ancla
  visual (`project-actions.ts:3200-3208`).

## 5. Migración de proyectos existentes

- **Nada se convierte solo.** Los `compounds` v1 siguen siendo válidos y se
  siguen renderizando por su camino actual. La conversión compuesto→secuencia
  (para ganar anidación o pistas propias) será una acción explícita futura
  del Inspector, no una migración.
- **Nueva clave raíz opcional `sequences`**: actualizar las tres superficies
  que enumeran claves raíz — TS `KNOWN_ROOT_KEYS` (`project.ts:33-55`) y Rust
  `KNOWN_ROOT_KEYS` (`service.rs:27-48`) — y regenerar el artefacto con
  `npm run schema:generate` (script en `package.json:21`; el test de drift
  `schema-artifacts.test.ts:15-27` falla si el artefacto no se regenera).
  El validador Rust ya exige esto para `compounds` (hallazgo de la sección
  "Por qué"): **sin Fase 0, ni siquiera el compound v1 persiste**.
- **schemaVersion**: `parseProject` rechaza cualquier versión ≠ 1 con el
  código `UNSUPPORTED_SCHEMA_VERSION` (`project.ts:408-424`) y Rust hace lo
  propio (`service.rs:753-780`, `PROJECT_SCHEMA_VERSION` en `service.rs:25`).
  El campo `migrationHistory` y su esquema (`MigrationEntrySchema`,
  `project.ts:89-96`) existen pero **no hay ningún migrador que escriba
  entradas** (búsqueda: sólo la inicialización vacía en `service.rs:1011` y la
  declaración en la raíz). Recomendación, en orden de preferencia:
  1. **Bump a `PROJECT_SCHEMA_VERSION = 2`** cuando `sequences` aterrice
     persistida, con el primer migrador real: 1→2 es no-op de contenido
     (`sequences` ausente = `[]`) + entrada en `migrationHistory` (from 1,
     to 2, tool "editor-ia"). El lector acepta 1 y 2; el escritor emite 2.
     Los archivos v2 en builds viejas producen el mensaje claro
     "open this with a newer Editor IA" (`project.ts:419-421`) en lugar de
     cien issues de `INVALID_PROJECT` — mejor UX en parques de versiones
     mixtas, y hay una sola versión "puntero" en dos lados
     (`project.ts:29`, `service.rs:25`).
  2. Alternativa aceptada si el bump resulta caro en esa iteración: quedarse
     en v1 con `sequences` opcional (los proyectos viejos siguen válidos tal
     cual). Coste: una build vieja que abra un proyecto nuevo falla con
     `INVALID_PROJECT` genérico ("unexpected root key"), no con el mensaje de
     versión — peor diagnóstico, mismo bloqueo.
- **Recuperación y autosave**: la recuperación (`project-store.tsx:62-63`,
  `recovery.ts`) guarda documentos validados por el esquema; con el esquema
  actualizado, las instantáneas con secuencias siguen siendo válidas sin
  cambios.
- **Exportadores legados**: FCXML/OTIO/EDL ya aplanan compounds antes de
  emitir (`fcpxml.rs:334`, `otio.rs:138`, `edl.rs:182`); con la expansión en
  línea del punto 3.2, exports de proyectos anidados siguen emitiendo
  material plano sin entender la anidación (los formatos tienen nesting
  propio — gap/sequence refs — pero eso es otra historia; documentado como
  no-objetivo de v1).

## 6. Plan de fases con tests

Convenciones: tests nuevos en archivos nuevos cuando se pueda; correr sólo los
archivos propios con `npx vitest run --no-cache <archivos>`; si se toca
`packages/project-schema`, correr `npm run schema:generate`; nada deja el
árbol sin compilar. Cada fase termina compilando y con sus tests en verde.

### Fase 0 — Frontera Rust (precondición, bug existente)
- Agregar `"compounds"` a `KNOWN_ROOT_KEYS` (`service.rs:27-48`).
- Test Rust nuevo (archivo nuevo, p. ej. `src-tauri/tests/compounds_boundary.rs`
  o caso en `projects/tests.rs`): guardar y abrir un proyecto con compounds
  pasa; una clave raíz desconocida sigue rechazándose.
- Verificación de que un proyecto con compounds desde la UI guarda sin error
  (manual o e2e posterior).

### Fase 1 — Esquema (packages/project-schema)
- `SequenceSchema`, clip `kind: 'sequence'`, `MAX_SEQUENCE_NESTING`,
  integridad anti-ciclos en `integrityIssues`, topes espejo de compound.
- Regenerar artefacto (`npm run schema:generate`) y revisar a mano que el
  JSON no explota con la nueva unión.
- Tests nuevos en archivo nuevo `packages/project-schema/src/sequences.test.ts`
  (español, como el resto del paquete):
  - "una secuencia con pistas y clips propios valida"
  - "un clip de secuencia exige la duración de su secuencia"
  - "rechaza la auto-referencia de una secuencia"
  - "rechaza un ciclo de dos secuencias"
  - "acepta un rombo de secuencias (A→B, A→C, B→D, C→D)"
  - "rechaza anidación más profunda que MAX_SEQUENCE_NESTING"
  - "ids de clip únicos a través de la raíz y las secuencias"
  - "el artefacto JSON Schema coincide con el esquema TS" (si el drift test
    existente no lo cubre ya por la vía del `toEqual` global,
    `schema-artifacts.test.ts:21-24`).
- Comando: `npx vitest run --no-cache packages/project-schema/src/sequences.test.ts`
  (más el drift test del paquete si se toca el artefacto).

### Fase 2 — Acciones (apps/desktop/src/state)
- Acciones puras nuevas (archivo nuevo sugerido: `sequence-actions.ts` +
  `sequence-actions.test.ts`): crear desde selección (agrupa los solapados
  como `createCompound`, pero moviendo los clips a pistas **de la nueva
  secuencia**, re-creando en ella las pistas necesarias), abrir/cerrar ruta
  helpers, desanidar, duplicar con clonación de definición, guardas de ciclo
  en "agrupar/crear" (1.3).
- Tests nuevos `apps/desktop/src/state/sequence-actions.test.ts`:
  - "crear secuencia mueve los clips a pistas propias y deja un clip contenedor"
  - "desanidar devuelve los clips al padre y elimina la definición"
  - "duplicar clona la definición con ids nuevos"
  - "no se puede crear una secuencia que contenga a su ancestro"
  - "las escenas reescriben el clip contenedor"
  - "una mutación inválida (ciclo) es rechazada por el store" (usando el
    validador, sin UI).
- Comando: `npx vitest run --no-cache apps/desktop/src/state/sequence-actions.test.ts`.

### Fase 3 — Render Rust
- `expand_sequences` recursivo con sintetización de pistas, herencia de
  mute/solo/hidden y transform de contenedor (3.2), encadenado después de
  `expand_compounds` en `build_plan_range`, `window_project` y los
  exportadores/loudness.
- Tests Rust en el módulo de tests del archivo correspondiente (convención del
  repo: `mod tests` dentro del mismo archivo, `ffmpeg.rs:3736`), cubriendo:
  - "una secuencia anidada se aplana en coordenadas de la raíz"
  - "dos instancias de la misma secuencia no colisionan en pistas"
  - "el mute de la pista contenedora silencia el audio interior (dos niveles)"
  - "una pista oculta contenedora no revela clips internos" (espejo de
    `compounds_on_hidden_tracks_do_not_reveal_their_inner_clips`,
    `ffmpeg.rs:4464+`)
  - "un ciclo de secuencias produce InvalidProject en runtime"
  - "el frame de preview de una secuencia anidada coincide con el render
    completo" (patrón de `compound_clip_uses_the_window_and_matches_full`,
    `preview_frame.rs:4351+`).
  (Los tests Rust viven en el módulo de tests del propio archivo, como
  `mod tests` en `ffmpeg.rs:3736`.)

### Fase 4 — UI (apps/desktop/src/features/editor)
- Timeline: clase `kind-sequence`, doble clic, entradas de menú contextual.
- Store de vista: `sequencePath` + breadcrumb + remapeo de playhead/selección.
- Inspector: acciones Abrir/Desanidar/Duplicar y botón "Crear secuencia".
- Tests nuevos en archivo nuevo
  `apps/desktop/src/features/editor/Timeline.secuencias.test.tsx` con jsdom y
  convenciones del repo (children en props de `createElement`, eventos con
  `new MouseEvent`, `setPointerCapture` con try/catch):
  - "el doble clic en un clip de secuencia cambia la ruta de edición"
  - "el breadcrumb trunca la ruta al hacer clic en una miga"
  - "el playhead se mapea entre niveles al entrar y salir"
  - "el menú contextual ofrece Abrir secuencia y Desanidar".
- Comando: `npx vitest run --no-cache apps/desktop/src/features/editor/Timeline.secuencias.test.tsx`.

### Fase 5 — Pulido
- "Consolidar secuencia" (pre-render explícito a asset) si el perfilado de
  anidaciones profundas lo justifica (P1 #2 de rendimiento, `docs/AUDIT.md`).
- Transform completo del contenedor (rotación, blend) si la Fase 3 quedó en el
  subconjunto conservador.
- Actualizar `docs/TUTORIAL.md` y `ATAJOS-PRO.md` con la función y el atajo.

## 7. Riesgos abiertos

1. **Tamaño del grafo FFmpeg**: anidación 8×200 clips genera grafos enormes.
   Mitigado por topes, pero falta medir argv real (vinculado al perfilado de
   `docs/AUDIT.md` P1 #2). Si revienta, la válvula es la consolidación (Fase 5).
2. **Generador JSON Schema y validador Rust**: con referencias por id el
   esquema no es recursivo en tipos (1.2), pero igual hay que verificar que
   `zod-to-json-schema` 3.23.5 emite la unión nueva sin sorpresas; el test de
   drift atrapa la desactualización, no la mala forma del artefacto.
3. **Desanidar con pistas sintetizadas**: insertar las pistas internas en el
   padre puede chocar con el tope de 64 órdenes por pista (`order` máx 63,
   `timeline.ts:100`) y con solapamientos; v1 puede negarse con mensaje claro
   ("desanidá primero las secuencias interiores") como hace `expandCompound`
   con múltiples instancias (`project-actions.ts:3296-3300`).
4. **Semántica de capa del grupo**: la regla de intercalado por recorrido en
   profundidad (3.2.2) es una decisión visible para el usuario; si el resultado
   no coincide con Premiere/Resolve en algún caso de bordes, se documenta como
   diferencia consciente.
5. **El hallazgo de la frontera Rust (Fase 0)** es un bug presente, no un
   diseño: hasta que no se arregle, cualquier proyecto con compounds no
   persiste, y las secuencias heredan el mismo mecanismo de lista de claves.

## 8. Referencias rápidas

- Esquema: `packages/project-schema/src/timeline.ts:865-918` (compounds),
  `project.ts:115-137` (documento), `project.ts:145-348` (integridad),
  `time.ts:11-19` (frames).
- Acciones: `apps/desktop/src/state/project-actions.ts:3190-3336`,
  `project-store.tsx:30-64`.
- Render: `apps/desktop/src-tauri/src/render/ffmpeg.rs:2526-2647` (expansión y
  plan), `ffmpeg.rs:1631-1741` (transform/zoom), `commands/preview_frame.rs:770-776`.
- Exportadores: `commands/fcpxml.rs:334`, `commands/otio.rs:138`,
  `commands/edl.rs:182`, `commands/loudness.rs:250`.
- Frontera: `projects/service.rs:25-48, 753-804, 1024-1046`,
  `commands/projects.rs:323-329`.
- UI: `features/editor/Inspector.tsx:389-436, 1493-1510`,
  `features/editor/Timeline.tsx:120-260, 596-602`.
- Prioridad: `docs/AUDIT.md:95, 219`.
