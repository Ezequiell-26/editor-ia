# Diseño: time-remap por frame (P2)

**Estado**: propuesta (2026-10-26). Documento de investigación, cero código.
**Base real**: todo lo que sigue fue verificado leyendo `packages/project-schema/src/timeline.ts`,
`apps/desktop/src/state/` (`project-actions.ts`, `speed-ramp-presets.ts`),
`apps/desktop/src/features/editor/Preview.tsx`, `apps/desktop/src-tauri/src/render/ffmpeg.rs` y
`apps/desktop/src-tauri/src/commands/preview_frame.rs` en la rama `feat/motion-graphics`.

## Por qué

Hoy la "curva de velocidad" del editor no es un dato del proyecto: es la acción de
**materializar N clips contiguos con velocidad constante cada uno**. Existen tres caminos que
terminan en lo mismo:

- `applySpeedRamp` (`apps/desktop/src/state/project-actions.ts:952`): 3 tramos; fija las
  velocidades `from`/`to` y resuelve la del medio para que la ventana de origen sume exacta
  (`project-actions.ts:1000`), y `replaceWithSpeedSegments` (`project-actions.ts:1039`) crea un
  clip por tramo con su `speed` racional y ventana de origen contigua.
- `applySpeedCurve` (`project-actions.ts:1117`): N tramos (3–24) con forma smoothstep evaluada en
  el punto medio de cada tramo (`project-actions.ts:1171-1174`); los tramos del medio se corren
  por una constante para que la ventana siga sumando (`project-actions.ts:1182`).
- `applySpeedRampPreset` (`apps/desktop/src/state/speed-ramp-presets.ts:192`): 6 presets
  (`speed-ramp-presets.ts:62-125`) aplicados con `splitClipAtFrames` + `setClipSpeed` por tramo.

Consecuencias de esa aproximación, y lo que el remap por frame resuelve:

1. **La velocidad es escalonada, no continua**: entre tramo y tramo hay un salto. Con 24 tramos
   (el máximo de `applySpeedCurve`, `project-actions.ts:1153`) la escalera se nota poco pero el
   clip queda partidos en 24 en la pista: labels `· curva k/N` (`project-actions.ts:1206-1208`),
   cortes que afectan selección/escenas, y hover/trim por tramo.
2. **Cada tramo es un clip**: el usuario puede despegar un tramo y romper la curva sin aviso.
3. **`minterpolate` sólo actúa por tramo constante** (`ffmpeg.rs:2014-2025`): no puede seguir una
   curva porque hoy no existe una representación de velocidad variable dentro de un clip.

## Cómo funciona hoy (estado verificado)

### Schema

- Velocidad constante racional `{num, den}` en clips de video y audio, con el invariante
  `durationFrames × speed.num = sourceFrames × speed.den` en frames enteros
  (`timeline.ts:952-971`; usa `clip.speed ?? {num:1, den:1}`, o sea, un clip sin `speed` es 1×).
- Límites globales 0.1×–4× (`timeline.ts:26-28`), compartidos por presets
  (`speed-ramp-presets.ts:29-30`).
- **Ya existe una `speedCurve` publicada y sin consumidor**: `SpeedCurvePointSchema`
  (`timeline.ts:692-715`) declara puntos `{t ∈ [0,1], speed ∈ [0.1,4], easing?, bezier?}` y
  `SpeedCurveSchema` (`timeline.ts:717-757`) exige 2–50 puntos estrictamente ordenados con el
  primero en `t=0` y el último en `t=1`, más `opticalFlow?: boolean` y `targetFps?: 24|30|60|120`.
  Está adjunta a `VideoClipSchema` (`timeline.ts:766`) y ya figura en el JSON Schema generado
  (`packages/project-schema/schema/project-document.v1.schema.json:1573`). Un grep de
  `speedCurve` en `apps/desktop/src` y `src-tauri` **no devuelve ningún uso**: ni el render, ni la
  preview, ni las acciones la leen. Un clip con `speedCurve` hoy renderiza a 1× (el invariante
  usa `speed ?? {1,1}`).
- `speed` y `speedCurve` son mutuamente excluyentes (`checkSpeedConflict`, `timeline.ts:842-858`,
  aplicado en `timeline.ts:874-876` y `950-951`). Los clips de audio no tienen `speedCurve`
  (`timeline.ts:782-790`).
- Easings reutilizables: `linear | ease-in | ease-out | ease-in-out | hold`
  (`timeline.ts:47-53`) y Bézier cúbica `cp1X..cp2Y` (`timeline.ts:57-64`).
- Los topes duros existen porque "keep the generated FFmpeg expressions inside a bounded argv"
  (`timeline.ts:40`); `MAX_TRANSFORM_KEYFRAMES = 48` (`timeline.ts:41`).

### Export (`ffmpeg.rs`)

La cadena de un clip visual (`visual_filter`, `ffmpeg.rs:1631`) hoy es:

1. `fps={fps_arg}` al entrar (`ffmpeg.rs:1668`), `reverse` si aplica (`1669-1671`), zoompan de
   Ken Burns con reloj `on/total_frames` (`1673-1741`; `total_frames` crece con el ratio
   `num/den`, `1677-1698`), encuadre/escala, y escala keyframeada con reloj `n` — cuyo ritmo se
   corrige por la velocidad: `rate = fps × num/den` para no-imágenes (`595-608`).
2. **Velocidad constante**: `setpts=(PTS-STARTPTS)*{den}/{num}` cuando `num ≠ den`
   (`ffmpeg.rs:2008-2013`).
3. **Cámara lenta suave**: si `speed_num < speed_den` y `slowMotionSmoothing`, después del
   `setpts` va `tpad=stop_mode=clone:stop_duration=0.5` + `minterpolate=fps={fps}:mi_mode=mci:
   mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none` (`ffmpeg.rs:2014-2025`). Nunca interpola al
   acelerar, y sin la marca tampoco (testeado en `ffmpeg.rs:3938-4004`).
4. `motionBlur` (`tmix`, `2027-2041`), `trim=duration={total_seconds}` (`2042`) y la colocación en
   pista: `setpts=PTS-STARTPTS+{start−lead}/TB` (`2282-2285`) — el patrón `segundos/TB` para
   escribir constantes en unidades de time-base ya está en uso.
5. Entrada del clip: `-ss (in_seconds − lead×ratio)` y `-t (clip_seconds + lead)×ratio`
   (`ffmpeg.rs:2907-2918`), con `clip_seconds = durationFrames/project_fps` y
   `start_seconds = startFrame/project_fps` (`2828-2829`) y `lead` de la transición de entrada
   (`transition_lead_seconds`, `1138-1156`).
6. Audio: cadena con `atempo` en cascada (factor descompuesto en pasos de 2.0/0.5,
   `ffmpeg.rs:2337-2348`); el pase de audio sólo toma clips en pistas `audio|narration`
   (`3120-3137`) y su entrada busca `-ss in_seconds -t clip_seconds×ratio` (`3159-3171`).
7. La estabilización **rechaza** velocidad ≠ 1× (`resolve_stabilization`, `ffmpeg.rs:998-1006`) y
   `reverse` (`1007-1012`): el precedente de "feature nueva que rompe suposiciones → error claro".

La pieza reutilizable clave es `keyframe_expression` (`ffmpeg.rs:421-479`): convierte keyframes en
una expresión FFmpeg anidada `if(lt(t,…), tramo, else)` con easing por segmento — `pow` para
ease-in/out, smoothstep 3-2-1 para ease-in-out, `0` para hold (`459-468`) — y **resuelve la Bézier
pre-muestreándola como polilínea "como la preview"** (`ffmpeg.rs:452-458`), para que export y
preview coincidan. Ese es el patrón de paridad TS↔Rust que el remap debe copiar; el lado TS del
easing Bézier ya existe (`apps/desktop/src/features/editor/KeyframeCurveEditor.tsx`).

### Preview

- El seek de preview es lineal: `sourceSeconds = (inFrame + (playhead − startFrame) × speed)/fps`
  para video (`Preview.tsx:417-420`) y audio (`610-612`). El elemento se re-busca cuando el drift
  supera 0.12 s (`Preview.tsx:450-452`, `640-642`). **No hay `playbackRate` en todo
  `apps/desktop/src`** (grep sin resultados): la preview es seek-driven.
- El renderer de un frame (`preview_frame.rs`) tiene su propio mapeo constante en `source_time`
  (`preview_frame.rs:111-132`) y un camino rápido que reescribe el clip como 1× de un solo frame
  con la ventana corrida al frame pedido (`preview_frame.rs:956-989`, con
  `source_frame = (input_start + local_seconds × speed) × fps`), dejando `motion.frozen` y
  `scaleFrozen` (los valores que `ffmpeg.rs:1699-1710` y `572-574` consumen).

## Modelo propuesto (schema compatible hacia atrás)

**Reutilizar `speedCurve` tal como está publicada**, sin campos nuevos obligatorios. Ya está en el
JSON Schema generado, ya tiene topes, orden y easings; inventar otra cosa rompería compatibilidad
gratis. Lo único que falta es definir su semántica y consumirla.

### Semántica (la parte que hoy no está definida)

- `t` de cada punto es **tiempo de timeline normalizado**: `t = frameLocal / durationFrames`.
  Justificación: es la convención que ya usa `applySpeedCurve` (fija duración y ventana y
  renormaliza velocidades para que la ventana sume, `project-actions.ts:1156-1196`), y es la que
  permite dibujar la curva sobre el cuerpo del clip en la pista sin recalcular la geometría.
- `speed` es el múltiplo instantáneo `dSource/dTimeline`: la posición de origen avanza
  `speed(t) × dt` frames de fuente por cada frame de timeline. Con esto el invariante constante se
  generaliza:

  ```
  durationFrames × ∫₀¹ speed(x) dx = sourceFrames      (con speedCurve presente)
  ```

  que para una curva constante reduce exactamente al invariante actual
  `durationFrames × speed = sourceFrames`.
- `easing`/`bezier` de un punto describen el tramo que **empieza** en ese punto, igual que en los
  keyframes de transform (`timeline.ts:46`, `parse_easing` en `ffmpeg.rs:487-504`).
- `opticalFlow: true` activa el pase `minterpolate` del clip remapeado (ver FFmpeg);
  `targetFps` queda reservado (fase de RIFE externo), el MVP interpola al fps del perfil.

### Reglas de compatibilidad

1. **Sin `speedCurve`, comportamiento bit a bit idéntico**: nada del camino actual cambia.
2. `speed + speedCurve` sigue prohibido (`timeline.ts:848-858`).
3. La `speedCurve` existente en proyectos viejos era dato muerto (se renderizaba 1×). El nuevo
   refinement del invariante por curva se aplica con **tolerancia de ±1 frame**, así un documento
   viejo con una curva decorativa sigue cargando; los proyectos nuevos, creados por acciones que
   sí garantizan la igualdad exacta, cumplen sin holgura.
4. `durationFrames` y `source.inFrame/outFrame` siguen siendo la verdad de la geometría de pista:
   el remap no agrega ninguna noción de tiempo nueva a la timeline, sólo cambia cómo la ventana de
   origen se recorre dentro de la duración del clip.
5. Sólo clips de video (`timeline.ts:766` ya lo limita así); audio mantiene velocidad constante.

### Acciones nuevas (fase 1, no implementadas acá)

- `setClipSpeedCurve(project, clipId, curve)`: valida con el esquema, exige los mismos guards que
  la rampa (pista no bloqueada, sin keyframes de transform/volumen, sin `motion`, sin `reverse` —
  los mismos de `applySpeedRamp`, `project-actions.ts:966-980`), fija `durationFrames` al valor
  que hace exacta la integral y desplaza los clips posteriores de la pista como hace
  `setClipSpeed` (`project-actions.ts:2983-2992`).
- `updateSpeedCurvePoint(project, clipId, index, punto)`: recalcula duración y desplaza; es la
  edición fina de la curva.
- Conversión `speedRampSegments → SpeedCurve` para migrar los tramos actuales a una curva
  equivalente (cada tramo constante = 2 puntos con `easing: 'hold'` interior).

## Algoritmo de muestreo (la fuente única de verdad)

El remap "por frame" no se guarda: **se deriva**. Del vector de puntos se deriva, para cada frame
de timeline `k ∈ [0, durationFrames)`, el frame de origen que le toca. Tres consumidores comparten
el mismo algoritmo: acciones TS (invariante y desplazamientos), preview TS (`Preview.tsx`) y
preview/export Rust (`preview_frame.rs`, `ffmpeg.rs`). La paridad se asegura igual que la Bézier
de los keyframes: export pre-muestrea "como la preview" (`ffmpeg.rs:452-458`) + tests golden con
fixtures compartidas.

Pseudocódigo (referencial, no es código del repo):

```
// 1. Evaluar s(x) por tramo: valor interpolado con el easing del tramo.
//    linear → u = x_local; ease-in → u³; ease-out → 1−(1−x)³;
//    ease-in-out → u²(3−2u); hold → 0; bezier → polilínea pre-muestreada
//    de y(x) (mismo enfoque que bezier_segment_expression, ffmpeg.rs:384).
s(x) = sᵢ + (sᵢ₊₁ − sᵢ) · u(x)

// 2. Integral acumulada de fuente, en frames, con formas cerradas por tramo
//    (polinomios de grado ≤3) o trapecios sobre la polilínea de la Bézier.
σ(x₀) = 0;  σ(xⱼ) = Σ previos + durationFrames · ∫[xⱼ₋₁,xⱼ] s(ξ) dξ

// 3. Corrección de escala: el invariante exige entero exacto.
sourceFrames = round(σ(x_N))
factor       = sourceFrames / σ(x_N)         // ≈1; sólo cierra el redondeo
σ'           = σ · factor                     // σ'(x_N) = sourceFrames exacto

// 4. LUT por frame con muestreo al centro (evita sesgo de borde):
sourceFrame(k) = round(source.inFrame + σ'((k + 0.5) / durationFrames))
```

Propiedades que los tests deben fijar:

- **Monótona estricta**: `speed ≥ 0.1` garantiza avance; `sourceFrame(k+1) ≥ sourceFrame(k)` y el
  recorrido total es `[inFrame, outFrame)`.
- **Bordes**: `sourceFrame(0) ≈ inFrame`, `sourceFrame(D−1) < outFrame`.
- **Continuidad**: sin saltos > `MAX_RAMP_SPEED` frames entre vecinos (consecuencia de speed ≥ 0.1:
  avanza como mucho 10 frames de fuente por frame de timeline).
- **Equivalencia con lo actual**: una curva escalonada que replica un preset (p. ej. `heroe`,
  `speed-ramp-presets.ts:67-73`) produce la misma duración y la misma sucesión de velocidades
  medias por tramo que `applySpeedRampPreset` — test de puente entre ambos modelos.
- Ejemplo numérico de referencia para el test golden (D=100 frames, 30 fps, puntos
  `(0, 0.5) (0.5, 0.5) (1, 2)` lineal): ∫₀¹ = 0.875 → `sourceFrames = 88` con factor
  88/87.5; σ' del corte = 25.142857 frames = 0.838095 s en t = 1.666667 s; el frame de timeline
  k=60 muestrea el frame 32 de la ventana (32.0467 → redondeo 32).

Coste: O(D log P) con búsqueda binaria por frame (P ≤ 50 puntos); D es la duración del clip en
frames, así que el cálculo es trivial incluso para clips de minutos y se puede memoizar por
`(clipId, versión de curva)` en la preview.

## Generación FFmpeg (setpts/expr por tramos)

Se reemplaza **sólo** el bloque de velocidad constante de `visual_filter`
(`ffmpeg.rs:2008-2013`) cuando el clip tiene `speedCurve`; el resto de la cadena no cambia.

### El mapa y su expresión

El decodificador entrega frames con timestamp de fuente `T`; el compositor necesita que aparezcan
en el timestamp de timeline `τ = σ'⁻¹(T)`. Como `σ'` es monótona creciente por tramos, su inversa
es lineal por tramos con pendiente `1 / velocidadMediaDelTramo`:

```
para cada tramo j:  τ(T) = τⱼ + (T − σ'ⱼ) · (τⱼ₊₁ − τⱼ) / (σ'ⱼ₊₁ − σ'ⱼ)
```

con `τⱼ = xⱼ × clip_seconds` y `σ'ⱼ` en segundos. Se emite como `if` anidado sobre
`(PTS-STARTPTS)` — el mismo estilo de `keyframe_expression` (`ffmpeg.rs:421-479`) — con las
constantes de tiempo escritas en segundos y convertidas con `/TB`, como ya hace la colocación
(`ffmpeg.rs:2282-2285`); las pendientes son adimensionales y no llevan `/TB`:

```
setpts='if(lt((PTS-STARTPTS),0.838095/TB),
          (PTS-STARTPTS)*1.988636,
          1.666667/TB+((PTS-STARTPTS)-0.838095/TB)*0.795455)'
```

(Valores del ejemplo de la sección anterior, verificados con node: tramo 1 a 0.5× → pendiente
1.988636, que es 2 ÷ factor de corrección 88/87.5; tramo 2 con velocidad media 1.257× → pendiente
0.795455. Sin corrección de redondeo las pendientes serían 2 y 0.8 exactas.) Un clip cuya curva sea de facto constante (2 puntos con la
misma velocidad) **cae al camino actual** `setpts=(PTS-STARTPTS)*den/num` para no regresar
expresiones más caras por gusto.

### Cadena resultante

1. Entrada sin cambios: `-ss in_seconds -t source_seconds` recorre la ventana completa
   (`ffmpeg.rs:2907-2918`); con curva, `source_seconds = sourceFrames/fps` exacto.
2. `setpts='…anidado…'` (arriba) en el lugar del `setpts` constante.
3. `fps={fps_arg}` inmediatamente después: con pendiente variable los PTS de salida son no
   uniformes y hay que re-muestrear a tasa constante (duplica en cámara lenta, descarta al
   acelerar). Hoy el `fps` inicial de la cadena (`1668`) normaliza la decodificación; este segundo
   `fps` normaliza el resultado del remap.
4. Si `opticalFlow === true`: `tpad=stop_mode=clone:stop_duration=0.5` + `minterpolate=fps=…`
   con los mismos parámetros `mci/aobmc/bidir/vsbmc/scd=none` de `ffmpeg.rs:2020-2024`, ahora
   rellenando los huecos de **toda** la curva (no sólo un tramo < 1×). Sin `opticalFlow`, la
   cámara lenta queda nearest/duplicado, igual que un clip lento sin `slowMotionSmoothing`.
5. `trim=duration={total_seconds}` (`2042`) y colocación (`2282-2285`) sin cambios.

### Guards (errores claros, el patrón de `resolve_stabilization`)

El export rechaza con mensaje en español un clip con `speedCurve` que además tenga:

- `stabilization` (extender la validación de `ffmpeg.rs:998-1006`);
- `motion` (zoompan usa reloj `on` con rate retimado constante, `ffmpeg.rs:1698`);
- `transform.keyframes` (el reloj `n` de `scale_dynamic_expression` y de la escala keyframeada,
  `ffmpeg.rs:595-608` y `1758-1780`, asume tasa constante tras el `setpts`);
- `transitionIn` con lead en fase 1 (el lead consume fuente a `speed(0)`, se agrega en fase 3);
- `reverse` (la inversa de `σ'` dejaría de ser función).

La UI ya tiene el mismo criterio para las rampas (`project-actions.ts:966-980`), así que el
mensaje y el momento (acción, no render) son consistentes.

### Presupuesto de expresión

Con el máximo del schema (50 puntos, `timeline.ts:720`) el `if` anidado ronda los 4–5 KB, mismo
orden que las expresiones de 48 keyframes que el argv ya soporta por diseño
(`timeline.ts:40-41`). Optimización opcional (no bloqueante): fusionar tramos contiguos cuya
polilínea no se desvía más de 0.25 frames de una recta, para bajar la profundidad en curvas suaves.

### Audio

Fuera de alcance: `speedCurve` no existe en clips de audio (`timeline.ts:782-790`) y el pase de
audio sólo atiende pistas `audio|narration` (`ffmpeg.rs:3120-3137`), así que el grafo de audio no
se toca. `atempo` en cascada (`2337-2348`) no puede seguir una curva; un futuro remap de audio
necesitaría `atempo` por tramos y es otro diseño.

## Preview

- **Preview.tsx**: `sourceSeconds` (`417-420`) pasa de la fórmula lineal a la LUT del sampler
  compartido; sin `speedCurve`, la LUT degenera en la fórmula actual (mismos números garantizados
  por test). Como la preview es seek-driven con umbral de drift de 0.12 s (`450-452`) y no hay
  `playbackRate` en la app, la reproducción continua de una curva se comporta como hoy: el
  elemento avanza lineal y el drift lo re-busca; en curvas rápidas re-busca más seguido. Fase 3
  debe medirlo y, si hace falta, usar `playbackRate` = derivada local en tramos suaves.
- **preview_frame.rs**: `source_time` (`111-132`) consulta la misma LUT (sampler espejo en Rust)
  y el camino rápido (`956-989`) calcula `source_frame` con `σ'(local + 0.5)` en vez de la fórmula
  `input_start + local_seconds × speed`; el resto del rewrite (`startFrame=0`,
  `durationFrames=1`, `scaleFrozen`) no cambia.

## Límites

1. **Velocidad estrictamente positiva (0.1×–4×)**: no hay congelado interno (0×) ni reversa
   (negativa) dentro de un clip. El congelado ya existe como clip `freeze` (`timeline.ts:817-831`)
   y la reversa por tramos materializados sigue siendo el camino. Ampliar el rango de `speed` es
   cambio de schema aparte.
2. **50 puntos por curva** (`timeline.ts:720`): curvas más complejas se approximan; suficiente
   para el argv y para la UI.
3. **Sólo video**: audio con curva es otro diseño (ver arriba); imágenes ni siquiera tienen
   `speed` hoy.
4. **Sin lead de transición en fase 1** y sin combinar con `motion`, `transform.keyframes`,
   `stabilization` ni `reverse` (ver guards). Son restricciones temporales, cada una con plan en
   fases.
5. **`minterpolate` es caro**: `opticalFlow` es opt-in por clip y por eso ya está en el schema;
   sin él, cámara lenta = frames duplicados.
6. **Precisión**: integrales en `f64`, invariantes cerradas por redondeo al frame entero; el
   factor de corrección (paso 3 del sampler) hace que el mapeo cierre exacto en el último frame.
   La tolerancia del refinement es ±1 frame sólo por compatibilidad con curvas viejas muertas.
7. **Clips compuestos**: `CompoundInnerClipSchema` acepta `speedCurve` por reutilizar
   `VideoClipSchema` (`timeline.ts:865-876`), pero no verifiqué en esta investigación cómo aplana
   el render los compuestos; fase 2 debe trazarlo antes de prometer soporte (o excluirlo con
   guard).
8. **Preview continua**: sin `playbackRate`, curvas con cambios bruscos re-buscan seguido
   (`450-452`); es la misma mecánica actual, pero fase 3 tiene que medir clips largos.

## Plan de fases con tests

Convenciones: tests TS en archivos nuevos, corridos con
`npx vitest run --no-cache <archivos>` (nunca la suite completa); tocar
`packages/project-schema` exige `npm run schema:generate`; los tests Rust viven en el módulo
`#[cfg(test)]` del propio archivo (no hay harness de integración: `apps/desktop/src-tauri/tests/`
sólo contiene fixtures de ML). Nombres en español, como el resto del repo.

### Fase 0 — Sampler compartido (TS, archivo nuevo)

`apps/desktop/src/state/time-remap.ts` + `time-remap.test.ts`:

- `«la integral de una curva constante reproduce el invariante actual»` (speed fija ↔
  `durationFrames × speed = sourceFrames`).
- `«los puntos y easings del ejemplo golden producen la LUT esperada»` (el ejemplo numérico de
  arriba como fixture).
- `«la LUT es monótona y respeta la ventana de origen»` (propiedades de arriba, con curvas
  aleatorias validas y con las 6 presets convertidas a curva).
- `«hold congela el avance hasta el próximo punto»`, `«la Bézier pre-muestreada coincide con el
  evaluador de KeyframeCurveEditor»`.
- Criterio de salida: cero toques en archivos existentes; el sampler se importa sin usarse todavía.

### Fase 1 — Schema y acciones

- `timeline.ts`: refinement del invariante cuando hay `speedCurve` (tolerancia ±1 frame,
  evaluador de integral dentro del paquete). Correr `npm run schema:generate` y verificar el diff
  del JSON Schema.
- Acciones `setClipSpeedCurve` / `updateSpeedCurvePoint` (en archivo nuevo
  `time-remap-actions.ts` + tests propios, reutilizando los guards de `applySpeedRamp`).
- Tests: `«aplicar una curva recalcula la duración y desplaza los clips posteriores»`
  (espejo de los tests de `setClipSpeed` en `project-actions.test.ts:869-946`), `«rechaza curva
  junto a speed/keyframes/motion/reverse con mensaje claro»`, `«un proyecto viejo con curva
  decorativa sigue parseando»`, `«la curva migrada de un preset equivale al preset aplicado»`.
- Criterio de salida: proyectos nuevos exactos, viejos cargan, árbol compila.

### Fase 2 — Export (Rust)

- Sampler espejo en Rust + generador del `setpts` anidado dentro de `ffmpeg.rs` (mismo archivo que
  `keyframe_expression`), tests golden en el módulo de tests de `ffmpeg.rs` con las fixtures de la
  fase 0: `«el setpts de la curva es monótono y cierra en la duración del clip»`,
  `«una curva constante emite el setpts del camino actual»`,
  `«opticalFlow agrega tpad+minterpolate después del setpts»` (espejo de
  `slow_motion_smoothing_interpolates_only_below_one_x`, `ffmpeg.rs:3938-4004`),
  `«rechaza curva con stabilización/motion/keyframes/transición de entrada»`,
  `«la expresión no supera el presupuesto de argv»`.
- Test de paridad TS↔Rust: misma fixture, misma LUT (fixtures JSON compartidas).
- Trazar el flatten de compuestos y agregar guard si no aplica (límite 7).
- Criterio de salida: `cargo test` del paquete pasa y el árbol compila (`cargo build`).

### Fase 3 — Preview

- `Preview.tsx` usa el sampler (archivo/test de paridad propio);
  `preview_frame.rs` (`source_time` + camino rápido) con test espejo de
  `source_time_honours_trim_and_speed` (`preview_frame.rs:1631`).
- Medir reproducción continua (drift 0.12 s) y decidir `playbackRate` por tramos.
- Criterio de salida: seek y render de un frame idénticos entre preview y export para la fixture
  golden.

### Fase 4 — UX (Inspector)

- Editor de curva (reusar `KeyframeCurveEditor.tsx`), conversión rampa↔curva, etiqueta de
  velocidad media del clip (∫, no promedio ingenuo) y avisos de los guards.
- Tests de componente en archivo nuevo (convenciones React 19 + jsdom del repo).

Cada fase deja el árbol compilando; si una fase no cierra, se reporta en pendientes sin revertir
lo anterior.
