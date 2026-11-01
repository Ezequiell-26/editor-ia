# Efectos, transiciones y motion graphics — auditoría y matriz de licencias

Fecha: 2026-10-30. Alcance: misión «Professional Effects, Transitions & Motion Graphics Engine».
Este documento es el registro de Fase 0 (auditoría) y Fase 2 (licencias), y la bitácora de los
bloques implementados. No declara completas las fases que siguen pendientes. La lista obligatoria de
completado/pendiente/bloqueado vive en [EFFECTS-INVENTORY.md](EFFECTS-INVENTORY.md).

## 1. Auditoría del estado inicial (Fase 0)

### Arquitectura real

- Aplicación de escritorio **Tauri 2** (WebView2) con UI **React 19 + TypeScript + Vite** y backend
  **Rust**. El proyecto audiovisual se define con Zod en `packages/project-schema` (versión 1, con
  migraciones y JSON Schema versionado en `packages/project-schema/schema/`).
- Composición: `apps/desktop/src/features/editor/Preview.tsx` compone capas DOM (video, imagen,
  gráfico) con `transform`, `opacity`, `clip-path`, `mask-image` y filtros CSS. Las capas se ordenan
  por pista y se recortan al frame visible.
- Exportación: `apps/desktop/src-tauri/src/render/ffmpeg.rs` construye un filtergraph de FFmpeg.
  Cada clip visual se escala/recorta, se transforma y se compone con `overlay` sobre un lienzo
  (`overlay=x='…':y='…':enable='between(t,…)'`). Los efectos de color se traducen a `eq`, `curves`,
  `colorbalance`, `colorchannelmixer`, `gblur`, `unsharp`, `vignette`, LUT (`lut3d`), etc.
- Frame nativo 1:1: `apps/desktop/src-tauri/src/commands/preview_frame.rs` reencuadra el proyecto a un
  solo frame y reutiliza el mismo renderer; congela transiciones, animaciones, Ken Burns y máscaras
  para que el frame coincida con el export.
- Catálogo de efectos/transiciones: `apps/desktop/src-tauri/src/commands/visuals.rs` (Rust) alimenta
  `VisualsView` y `EditorAssets`; hay un catálogo local de respaldo en
  `apps/desktop/src/features/visuals/visuals.ts`.
- Keyframes: esquema propio (`packages/project-schema/src/keyframes.ts`, `curves.ts`) con
  `linear`, `ease-in`, `ease-out`, `ease-in-out`, `hold` y curvas Bézier editables. La UI de curvas
  existe en `KeyframeCurveEditor.tsx`.
- Motion graphics: motor propio determinista `MotionPlan` → ASS (render) y `MotionPreview` (preview),
  más catálogo Lottie/.lottie. No hay dependencia de Motion Canvas ni Rive.
- Recursos: `Media`/`assets`, biblioteca de motion y plantillas, más **5 overlays propios**
  empaquetados con catálogo, poster, licencia CC0, mezcla y alfa opcional desde Motion.

### Estado de transiciones (antes de este bloque)

- Esquema: 7 tipos (`dissolve`, `fade-black`, `fade-white`, `slide-left/right/up/down`), máximo 120
  frames.
- Export: dissolve con `fade=alpha=1`; fundidos con `fade` opaco; deslizamientos con expresión de
  `overlay` durante el lead.
- Frame nativo: congelaba alfa/desplazamiento/fundido y contaba el clip entrante durante el lead.
- **Brecha crítica**: la preview en vivo no incluía el clip entrante durante el lead y no aplicaba
  ninguna transición; el corte se veía seco y no coincidía con el export.
- **Brecha de paridad**: en el frame nativo, `fade-black` aplicaba también alfa (`colorchannelmixer
  rr/gg/bb/aa`), revelando el clip anterior; el export mantiene la capa opaca. Corregido en este
  bloque.

### Efectos existentes

Color y luz: brillo, contraste, saturación, temperatura, sombras/luces, fade, lift/gamma/gain/offset,
HSL, color match, viñeta, corrección de lente, relight, nitidez, denoise, blur, glow, motion blur,
grises, sepia, rotación de tono, curvas, LUT, glow y grain con intensidad estática o keyframable. Máscaras (rectángulo, elipse, diamante,
triángulo, redondeado, polígono, texto), blend modes, chroma key, estabilización, transformación
perspectiva y keyframes.

Límites conocidos: el denoise de la preview es un sigma 5×5 espacial con dos frames previos y umbral,
graduando centro, vecinos y frames anteriores antes de comparar (no promedia los 6 frames de `atadenoise`); glow se aproxima en SVG, motion blur usa una estela temporal
(promedio exponencial con el peso nuevo de `tmix`, se reinicia al pausar o saltar) con grade, curvas,
ruedas, denoise y viñeta aplicados por frame antes de acumular y el LUT después, y la viñeta es un
radial continuo que aproxima el ángulo del export; el LUT `.cube` 3D o 1D se aplica con un shader WebGL2 por capa activa
(conserva el alfa VP9) y el look global sigue el orden del export: LUT del clip → ruedas del look →
grade del look → LUT del look. El look no alcanza capas gráficas en ninguno de los dos. El registro unificado de efectos con
metadatos/licencia y el panel profesional con búsqueda, favoritos y parámetros por efecto ya existen
desde el bloque de efectos.

### Persistencia y undo/redo

Proyectos versionados con Zod y migraciones; autoguardado y recuperación. Las transiciones y efectos
se guardan en el clip y sobreviven a cerrar/abrir. `updateClip` y el historial del store cubren
undo/redo para los cambios de transición; el bloque nuevo no introduce estado paralelo.

### Rendimiento de referencia

- Hardware objetivo: Ryzen 5 4600G, 16 GB RAM, gráficos integrados, Windows 11.
- La preview usa DOM/CSS; sólo crea un contexto WebGL2 por capa cuando hay un LUT `.cube` activo,
  sin duplicar el motor de composición. El export usa FFmpeg con encoder elegido por sondeo (AMF
  cuando está disponible).
- Medición de este bloque (1080p, 30 fps, 3 s, mpeg4, mismo equipo): composición base **1.144 ms**;
  con barrido de 1 s **2.838 ms**. El coste del barrido es proporcional a la ventana de solape
  (`geq` sólo se evalúa dentro del lead).

## 2. Matriz de licencias (Fase 2)

> Regla: no se incorpora un componente con licencia dudosa. GSAP queda excluido sin aprobación
> legal escrita. Las licencias de shaders, assets, fuentes y modelos se revisan por separado.

| Componente | Repo | Versión/commit | Licencia | Uso previsto | Decisión |
|---|---|---|---|---|---|
| GL Transitions | github.com/gl-transitions/gl-transitions | sin fijar | **NOASSERTION** en el repo; cada shader declara su licencia en comentarios | Referencia / shaders GLSL | **No integrado**. Requiere revisión shader por shader; no se copia nada hasta resolverlo. |
| PixiJS | github.com/pixijs/pixijs | sin fijar | MIT | Motor WebGL 2D | **No adoptado**: la app ya tiene renderer DOM/CSS + FFmpeg; un segundo contexto GPU no aporta y rompe la paridad. |
| PixiJS Filters | github.com/pixijs/filters | sin fijar | MIT | Filtros WebGL | **No adoptado** por el mismo motivo; los filtros reales se resuelven en CSS/FFmpeg. |
| Motion Canvas | github.com/motion-canvas/motion-canvas | sin fijar | MIT | Escenas vectoriales programáticas | **No embebido**: es una aplicación/editor completo; el motor propio `MotionPlan` ya cubre escenas y ASS. Se usa como referencia conceptual de keyframes. |
| Motion Canvas Exporters | github.com/motion-canvas/exporters | sin fijar | MIT | Export FFmpeg de escenas | **No adoptado**; el export existente ya usa FFmpeg. |
| Rive Runtime | github.com/rive-app/rive-runtime | sin fijar | MIT (runtime) | Personajes vectoriales | **No integrado todavía**. Los assets `.riv` y el editor Rive tienen licencias propias; no se asume MIT para ellos. |
| GSAP | github.com/greensock/GSAP | — | Licencia estándar «no charge» con restricciones para herramientas de creación visual | Animación de propiedades | **Excluido**. No se incorpora sin aprobación legal por escrito. Alternativa: keyframes propios + Web Animations API. |
| HyperFrames | github.com/heygen-com/hyperframes | catálogo Open Design ya integrado | Apache-2.0 | Composiciones HTML → video | **Ya integrado** como contenido/plantillas (13 renderizables + 9 previews). No se usa como motor de composición del timeline. |
| OpenReel Video | github.com/Augani/openreel-video | sin fijar | MIT | Referencia de timeline multipista | **Sólo referencia**. No se copia el editor ni se introduce un segundo timeline. |
| FFmpeg (build de la app) | github.com/FFmpeg/FFmpeg | 9.0 LGPL shared | LGPL-2.1-or-later; componentes GPL opcionales | Render, filtros, codificación | **Integrado** como binario compartido LGPL. Sin `--enable-gpl` ni `--enable-nonfree`. Se distribuyen DLLs y avisos; no hay modificaciones al código de FFmpeg. |
| Fuentes / assets de ejemplo | varios | — | OFL / propias | Contenido de plantillas | Revisadas por el audit de Open Design; cada asset conserva su aviso. |

### Obligaciones y riesgos

- **FFmpeg LGPL**: enlazado dinámico, aviso de licencia y acceso al código fuente de la versión
  usada. No enlazar estáticamente ni habilitar GPL/nonfree sin revisión. El producto sigue siendo
  propietario; FFmpeg permanece como componente separado.
- **GL Transitions**: la licencia general del repo no cubre automáticamente cada shader. Sin
  decisión por shader no hay integración.
- **Rive**: MIT cubre el runtime, no los assets, fuentes ni herramientas del ecosistema.
- **GSAP**: la licencia no es OSI y restringe herramientas de creación visual; conflicto directo con
  el producto. Excluido.
- **PixiJS/Motion Canvas**: MIT compatible, pero adoptarlos duplicaría motores. Se descartan por
  arquitectura, no por licencia.

## 3. Bloques implementados en esta sesión

### Bloque A — Paridad de transiciones en preview en vivo

- Nuevo módulo puro `apps/desktop/src/state/transition.ts` que replica la regla Rust de lead
  (frames, duración del clip, inicio y tope de 2 s) y calcula la muestra visual: alfa, traslación,
  filtro de fundido o `clip-path` de barrido.
- `Preview.tsx` incluye el clip entrante durante su lead, aplica la transición en la capa, compone el
  filtro de transición con los efectos y muestra el material previo al inicio del clip (`source`),
  igual que el recorte de origen del export.
- `fade-black` usa `brightness(p)` (opaco) y `fade-white` usa `invert(1) brightness(p) invert(1)`,
  que mezcla hacia blanco sin perder alfa.
- Frame nativo: `fade-black` deja de multiplicar el alfa, para no revelar el clip anterior.

### Bloque B — Wipes profesionales end-to-end

- Esquema: `wipe-left`, `wipe-right`, `wipe-up`, `wipe-down` e `iris` en `ClipTransitionSchema` y JSON Schema
  regenerado.
- Export: máscara de alfa por píxel con `geq` y `enable='between(t,0,lead)'`. `crop` no admite
  expresiones temporales en `w/h` (verificado con FFmpeg 9.0: sólo `x/y` son por frame). El reloj de
  `geq` es `T` (no `t`); el primer intento con `t` falló en el grafo real y quedó cubierto por el
  test E2E. La máscara conserva el alfa existente (máscaras del clip).
- Frame nativo: la transición congelada incluye `wipe` + `progress` y el renderer aplica la misma
  máscara estática.
- UI: catálogo Rust (12 transiciones), catálogo de respaldo TS, presets de `EditorAssets` y selector
  del Inspector.
- **Curvas de transición**: `easing` (lineal/ease-in/out/in-out/hold) en el esquema y en la UI;
  la preview, el frame nativo y FFmpeg usan la misma curva para disolvencias, deslizamientos y
  barridos. Los fundidos a negro/blanco quedan lineales por validación del esquema.
- **Registro de transiciones**: `buildTransitionRegistry` expone el mismo contrato que los efectos
  (versión, preview, export, licencia, tipos de clip y estado) y alimenta el selector del panel.
- Pruebas: esquema (acepta wipes, rechaza desconocidas y >120 frames), muestra de transición
  (lead/progreso/estilos), catálogo Rust, cadena de filtros Rust y ventana del frame nativo.
- **E2E real** (`render_live_wipe_transition_reveals_from_the_left`, `EDITOR_IA_RUN_RENDER_TESTS=1`):
  dos videos de color generados con FFmpeg, proyecto de dos clips con `wipe-left` de 15 frames,
  `build_plan` + `execute_sync`, `ffprobe` con duración 2,0 s y muestreo de píxeles en 0,4 s (azul),
  0,75 s (mitad revelada: x=80 verde, x=240 azul) y 0,9 s (x=240 verde, x=300 azul). **Pasa**.

### Validación real con FFmpeg

- Se renderizó un clip 320x180 con la cadena exacta `format=rgba,geq=…` y se muestrearon píxeles con
  `ffmpeg -ss … -vf crop=1:1:…`. Resultado: el borde del barrido avanza 64 px → 160 px → 256 px en
  t = 0,2 / 0,5 / 0,8 s sobre 320 px. El barrido revela de izquierda a derecha.
- Rendimiento 1080p medido arriba; el coste se limita al lead.

### Bloque C — Registro tipado y panel profesional de efectos

- **Registro** (`apps/desktop/src/features/effects/registry.ts`): toma el catálogo vivo de Rust y
  agrega versión, motor de preview (`css`/`none`), motor de export (`ffmpeg`), requisitos,
  licencia MIT del código propio, tipos de clip admitidos y estado (`available`, `export-only`,
  `requires-file`, `manual`). Un efecto nuevo en Rust aparece con valores seguros y sólo se anuncia
  como previsualizable cuando se declara su metadata.
- **Aplicación validada** (`apply.ts`): defaults, lectura del estado del clip (incluidos objetos
  anidados como glow/motionBlur), clamp al rango, redondeo de parámetros enteros y validación final
  con `ClipEffectsSchema`; si el resultado no valida, conserva el estado anterior.
- **Panel** (`EffectBrowser.tsx`): buscador, filtros por categoría, favoritos y recientes persistidos
  en `localStorage`, editor de parámetros con restaurar y aplicar a todos los clips seleccionados.
  Los efectos sin preview muestran “Solo export” y un aviso; los que requieren archivo o se
  configuran en el Inspector no se aplican desde acá.
- **Catálogo Rust**: se agregaron glow, motionBlur, denoise y fade con parámetros reales; el catálogo
  local de respaldo ahora también declara rangos para sus ocho efectos.
- **Portapapeles**: copiar los efectos del clip principal, pegarlos combinándolos con los del destino
  y quitar todos los efectos de la selección, con undo real.
- **Arrastre**: los presets de `EditorAssets` y las tarjetas del registro se arrastran a un clip del
  panel o directamente a un clip de la timeline; la timeline valida transición y efectos antes de
  escribir y selecciona pistas completas para aplicar en lote.
- **Miniaturas**: cada tarjeta aplica el filtro CSS real de sus valores por defecto sobre una muestra,
  usando el mismo `effectsToCss` que la preview (extraído a `effects-to-css.ts`).
- **Pruebas**: tests de registro, aplicación, preferencias, panel, arrastre, pista, portapapeles y
  wiring con undo real. E2E real de barrido en **720p24, 1080p60 y 4K24** con muestreo de bordes.

### Bloque D — Keyframes de parámetros de efecto

- **Esquema**: `effectKeyframes` en clips visuales para `brightness`, `contrast`, `saturation` y
  `blur`, con frame, valor, easing y Bézier opcional; validación de frame dentro del clip y rango por
  propiedad.
- **Muestreo compartido** (`effect-keyframes.ts`): clamp antes/después, interpolación con la easing
  del keyframe que inicia el tramo y `hold`; la preview lo aplica sobre el look estático y el frame
  nativo reubica los keyframes al recortar la ventana de un frame.
- **Export**: `sendcmd` sobre un `eq@efx` etiquetado para color y sobre `gblur@efx` para desenfoque,
  con la rampa muestreada (máximo 300 comandos por propiedad), el mismo criterio que la opacidad.
- **UI**: en el editor de parámetros de color y desenfoque, alta de keyframe en el playhead,
  edición de frame/valor/easing (incluida curva Bézier con cuatro coordenadas) y borrado; se guarda
  en el clip principal con undo y se copia al copiar atributos entre clips.
- **E2E real** (`render_live_effect_keyframes_brighten_over_time`): clip gris con brillo 0 → 0,8,
  `sendcmd` en el grafo y muestreo de píxeles en 0,1/0,5/0,9 s con luminancia creciente. **Pasa**.
- **E2E real de blur** (`render_live_effect_keyframes_blur_over_time`): tablero de ajedrez con blur
  0 → 8; el detalle horizontal medio cae de ~20 a menos de 0,75× al final. **Pasa**.

### Bloque E — Perfiles de preview

- `preview-profile.ts`: `Eficiente`, `Equilibrado` y `Máximo`, persistidos en `localStorage`.
  `Eficiente` acota el desenfoque de la preview a 4 px y `Equilibrado` a 20 px; `Máximo` no acota.
  **El export no cambia**: el perfil sólo decide el coste de la vista en vivo y de las miniaturas.
- Selector en el panel con estado `aria-pressed`; las miniaturas usan el mismo perfil.
- Ya existían los perfiles de render (Rápido/Equilibrado/Compacto/Máxima calidad), la política GPU y
  los proxies. El registro y el panel se cargan sólo en su vista: no hay contextos GPU adicionales.

### Bloque F — Inventario de licencias de medios

- `buildAssetLicenseReport` genera un Markdown con medio, tipo, origen, fecha de adquisición,
  proveedor, licencia, uso comercial y atribución de cada asset del proyecto. No inventa campos: los
  vacíos quedan como `—`.
- El botón **Inventario** de Medios copia el reporte al portapapeles y avisa el resultado. Se apoya
  en el esquema existente de derechos/provenance, que ya se exige al importar y al marcar un asset
  como listo.
- Se empaquetan **5 overlays propios** generados por `scripts/generate-overlays.mjs` (CC0, con
  catálogo y posters, incluida una mascota con alfa) y las partículas son una plantilla propia
  determinista (capa `circle` + `\move` en ASS). No se usa stock de Mixkit/Pixabay ni se copian
  assets sin permiso.

### Bloque G — Presets de efectos del usuario

- Guardar el look actual del clip como preset con nombre, listarlo, aplicarlo a la selección y
  eliminarlo; persistido en `localStorage` (máximo 20), validado con `ClipEffectsSchema` al cargar y
  al guardar.
- La aplicación mezcla el preset sobre los efectos del destino y pasa por undo/redo.
- **Quitar efecto puntual**: el portapapeles lista los efectos activos del clip principal con su
  etiqueta del registro y permite quitar uno solo, conservando el resto (también con undo).

### Bloque H — Render completo con audio y subtítulos

- E2E real `render_live_audio_captions_and_transition`: dos escenas con disolvencia, pista de audio
  (tono 440 Hz), subtítulo quemado y dos renders (con/sin subtítulos).
- Verifica con `ffprobe` que existen video y audio, y compara los píxeles de la zona inferior: el
  subtítulo se quema realmente (diferencia media > 1). **Pasa**.

### Bloque I — Aplicar un efecto a toda la pista

- El editor de parámetros ofrece **Aplicar a la pista**: crea una capa de ajuste que cubre el rango
  de los clips seleccionados y le escribe el efecto configurado. Usa el motor de capas de ajuste que
  ya existía en la preview y en el export, sin un segundo pipeline.
- El rango se calcula con el mínimo inicio y el máximo fin de la selección; la duración resultante se
  valida y la operación pasa por undo/redo.

### Bloque J — Persistencia y copia de keyframes

- Test de **serialización y reapertura** con un proyecto real: efectos anidados (glow), keyframes de
  color y blur con Bézier, y transición con easing sobreviven a `JSON.stringify` + validación Zod.
- **Copiar atributos** ahora conserva `effectKeyframes` y descarta los que caen fuera del clip
  destino, igual que ya hacía con máscaras y animaciones.

### Archivos modificados

- `packages/project-schema/src/timeline.ts`, `timeline.test.ts`,
  `packages/project-schema/schema/project-document.v1.schema.json` (regenerado).
- `apps/desktop/src/state/transition.ts` (nuevo), `transition.test.ts` (nuevo).
- `apps/desktop/src/features/editor/Preview.tsx`, `Inspector.tsx`, `EditorAssets.tsx`,
  `EditorAssets.test.tsx`.
- `apps/desktop/src/features/visuals/visuals.ts`, `visuals.test.ts`.
- `apps/desktop/src-tauri/src/render/ffmpeg.rs`,
  `apps/desktop/src-tauri/src/commands/visuals.rs`,
  `apps/desktop/src-tauri/src/commands/preview_frame.rs`.
- `apps/desktop/src/features/effects/registry.ts`, `apply.ts`, `preferences.ts`, `EffectBrowser.tsx`
  (nuevos) con sus tests; `VisualsView.tsx`, `VisualsView.effects.test.tsx` (nuevo),
  `styles/chrome.css`, `features/visuals/visuals.ts` (params de respaldo).

### Pruebas ejecutadas

- `npm run typecheck`: OK.
- Suites frontend: **1.546/1.546 en 199 archivos**. `npm run build`: OK.
- Rust: **489 pasan, 62 ignorados** (la suite completa). Incluye
  `extra_transitions_change_the_filter_chain`, `window_freezes_fades_and_transition_leads`,
  `catalog_has_unique_effects_presets_and_transitions`, `catalog_effects_carry_real_parameters`
  y los E2E `render_live_wipe…`, `render_live_effect_keyframes_*` y
  `render_live_audio_captions_and_transition` con
  `EDITOR_IA_RUN_RENDER_TESTS=1`.
- FFmpeg real: barrido 320x180 muestreado por píxeles; **720p24, 1080p60 y 4K24** verificados
  con duración y borde del wipe; medición de rendimiento 1080p.

## 4. Estado del resto de la misión

| Fase | Estado | Nota |
|---|---|---|
| 0 Auditoría | Completada | Este documento. |
| 1 Repos | Analizados | Ver matriz; ninguno se embebe como segundo motor. |
| 2 Licencias | Matriz creada | Falta revisión shader por shader si se importan GL Transitions. |
| 3 Registro unificado de efectos | **Base implementada** | Efectos y transiciones comparten contrato tipado (preview/export/licencia/estado/parámetros). Faltan máscaras, títulos y motion graphics dentro del mismo registro. |
| 4 Panel profesional | **Casi completo** | Buscador, categorías, favoritos, recientes, presets propios, miniaturas CSS, parámetros, arrastre, capa de ajuste para toda la pista, copiar/pegar, quitar por efecto y undo. La duplicación de clips conserva efectos; el ruler acepta transiciones y presets por drag-and-drop (2026-10-30). |
| 5 Keyframes | **Mejorada** | Brillo, contraste, saturación, desenfoque y giro de tono con keyframes, curvas Bézier, preview, frame nativo, export, persistencia y copia entre clips. Faltan propiedades de texto y más parámetros de color. |
| 6 Paridad preview/export | **Mejorada** | Transiciones y keyframes de color alineados entre preview, frame nativo y MP4; `sharpen`/`glow` tienen preview SVG aproximada, el LUT usa WebGL2, el motion blur una estela temporal con el peso nuevo de `tmix` y el orden grade/curvas → estela → LUT del export, el denoise un sigma 5×5 espacial y la viñeta la fórmula de `vf_vignette` (verificada en RGB ≤2/255). El temporal de `atadenoise` no se replica. |
| 7 Biblioteca de recursos | **Catálogo propio** | El esquema guarda origen, fecha, proveedor, licencia y atribución por asset; Medios importa archivos propios y copia un inventario Markdown. Se empaquetan 5 overlays propios CC0 (4 Screen + mascota alfa Normal) con catálogo y posters; no se usa stock sin permisos revisados. |
| 8 Rendimiento | **Base implementada** | Perfiles Eficiente/Equilibrado/Máximo de preview con adaptación real del desenfoque, perfiles de render, GPU policy y proxies. Falta medición completa de procesos y carga bajo demanda de motores externos (no hay motores GPU propios). |
| 9 Pruebas reales | **Mejorada** | Barridos en 720p24/1080p60/4K24, keyframes de brillo y blur, y render completo con audio + subtítulos quemados verificados con ffprobe y píxeles. |
| 10 Criterios | **No cumplidos aún** | El catálogo profesional, el registro y la biblioteca de recursos siguen pendientes. |

## 5. Próximos bloques propuestos

1. **Registro de efectos tipado** en el esquema (id, categoría, parámetros, rango, default, motor de
   preview/export, requisitos, licencia, compatibilidad) y catálogo derivado del registro, sin
   duplicar listas en Rust y TS.
2. **Panel profesional** conectado al registro: búsqueda, categorías, favoritos/recientes
   persistidos, parámetros reales y aplicación múltiple con undo/redo.
3. **Keyframes de efectos** con muestreo en preview y expresión FFmpeg, empezando por opacidad,
   escala y parámetros de color ya exportables.
4. **Biblioteca de overlays** con origen, autor, licencia y fecha por asset, importación de archivos
   propios y sin redistribuir stock.
5. **Proyecto E2E de dos videos con transición** renderizado y validado con `ffprobe` y muestreo de
   frames, más perfiles de rendimiento medidos.

## 6. Bloque K — Cumplimiento LGPL del binario (2026-10-30)

Se auditó el FFmpeg empaquetado y se reemplazó por la build BtbN **win64-lgpl-shared-9.0**:
sin `--enable-gpl`/`--enable-nonfree`, sin libx264/libx265/libxvid y con libopenh264/libkvazaar.
`npm run audit:ffmpeg` ejecuta buildconf/encoders y exige `LICENSE.txt` LGPL; el script de CI
descarga la misma build y copia DLLs + licencia.

Consecuencias funcionales, todas explícitas:

- `eq`, `hqdn3d`, `delogo` y `vidstab` son GPL y no existen en el binario. Se sustituyeron por
  `colorbalance`/`colorlevels`/`hue`, `removegrain`+`atadenoise`, un recuadro `drawbox` de
  redacción y un aviso de estabilización no disponible, respectivamente.
- `perspective` tampoco forma parte del build; el export falla con el error de FFmpeg en vez de
  fingir el efecto.
- Los encoders de software usan bitrate (libopenh264/libkvazaar) porque `-crf`/`-preset` no
  aplican; libkvazaar exige dimensiones múltiplos de 8 y el look cae a H.264 cuando el zoom no
  las produce.
- HDR H.265 por software queda bloqueado (kvazaar es 8 bits); AV1 10 bits sigue disponible.

E2E reales con el binario LGPL: wipes 720p24/1080p60/4K24, keyframes de brillo/blur/hue,
glow+motionBlur, audio+subtítulos+transición, pipeline base, look cinematográfico y redacción de
logo. **494 Rust + 62 ignored**, sin fallos en la suite normal.

## 7. Medición de CPU y memoria del render (2026-10-30)

Medición real del proceso FFmpeg empaquetado, no estimada, con
`npm run bench:ffmpeg` (PowerShell). Clip sintético 1080p, 30 fps, 5 s, audio AAC;
encode `libopenh264` 8 Mbps; el caso «effects» aplica colorbalance + colorlevels +
hue + unsharp + vignette + gblur + noise.

| Caso | Pared | CPU del proceso | CPU % (1 núcleo = 100) | Pico de memoria | Salida |
|---|---:|---:|---:|---:|---:|
| Base (sin filtros) | 1,245 s | 1,828 s | 146,9 % | 149,1 MB | 4.981.262 B |
| Con 7 efectos | 4,339 s | 24,000 s | 553,1 % | 186,3 MB | 5.050.091 B |

Lectura: los filtros multiplican el costo de CPU (≈13× CPU y ≈3,5× pared) pero
suman sólo ≈37 MB de pico; cabe holgado en 16 GB. No hay GPU involucrada: el
render de efectos es CPU (`colorbalance`, `colorlevels`, `hue`, `unsharp`,
`vignette`, `gblur`, `noise`) y el encoder de software también es CPU. El pico
incluye los buffers de filtros y el muxer, no el proceso de la app.

La app no abre varios motores GPU: los efectos son CSS/SVG en preview y filtros
FFmpeg en export; Rive/Pixi no se integraron (ver matriz).
