# Inventario de capacidades — motor de efectos, transiciones y motion graphics

Fecha: 2026-10-30. Estado evaluado contra la misión de efectos. Este documento es la lista
obligatoria de **completado / en desarrollo / pendiente / bloqueado / no compatible / excluido**.
No declara terminada la misión: las fases 7 (recursos) y 10 (criterios) siguen incompletas.

## Leyenda

- **Completado**: implementado y verificado con pruebas reales.
- **Parcial**: funciona, pero cubre sólo una parte del requisito.
- **Pendiente**: no implementado, sin bloqueo externo.
- **Bloqueado**: falta un asset, licencia o servicio externo.
- **No compatible**: la arquitectura actual no lo soporta sin duplicar motores.
- **Excluido**: descartado por licencia.

## 1. Catálogo de efectos (21)

Estados del registro (`registry.ts`): `available` = preview CSS/SVG/WebGL/canvas + export; `export-only` = sólo MP4;
`requires-file` = necesita LUT; `manual` = se configura en el Inspector.

| Efecto | Preview | Export | Estado | Notas |
|---|---|---|---|---|
| brightness | CSS / WebGL / 2D | colorbalance | available | parámetro + keyframes; usa el pase del overlay con la fórmula aditiva del export cuando hay LUT, blur, denoise, viñeta, curvas, chroma o ruedas, y también solo fuera del perfil eficiente (video con WebGL2); en eficiente o video sin WebGL2 queda CSS multiplicativo |
| contrast | CSS / WebGL | colorlevels | available | misma fórmula lineal que CSS; pasa al shader después de ruedas/gamma fuera del perfil eficiente o con overlay; en eficiente/sin WebGL2 queda CSS |
| saturation | CSS / WebGL | hue | available | shader con luma BT.601 (`hue=s` del export) fuera del perfil eficiente o con overlay; en eficiente/sin WebGL2 sigue CSS (Rec.709, aproximación) |
| temperature | WebGL / CSS | colorbalance | available | shader con `colorbalance` de sombras (rs=t·0,25, bs=−t·0,25) fuera del perfil eficiente o con overlay activo; en eficiente/sin WebGL2 y en el look global sigue la aproximación CSS |
| shadows | WebGL / CSS | curves (maestra) | available | curva maestra exacta antes de las curvas del clip fuera del perfil eficiente o con overlay; compuesta con las curvas en la misma tabla; en eficiente/sin WebGL2 queda CSS |
| highlights | WebGL / CSS | curves (maestra) | available | igual que shadows (punto 0,75 de la curva maestra) |
| fade | WebGL / CSS | curves (maestra) | available | igual que shadows; la curva maestra también se aplica al look global |
| blur | CSS | gblur | available | parámetro + keyframes |
| hueRotate | CSS / WebGL | hue | available | shader con rotación Cb/Cr BT.601 (`hue=h` del export) fuera del perfil eficiente o con overlay; en eficiente/sin WebGL2 sigue `hue-rotate()` CSS (matriz distinta: rojo+120° da 177 vs 255) |
| vignette | WebGL | vignette | available | fórmula de `vf_vignette` en el shader (`cos(angle·dnorm)^4`, centro w/2,h/2, ángulo PI/(5−4s)); verificada en RGB ≤2/255 contra `format=rgb24,vignette`; el export en YUV puede diferir |
| sharpen | SVG | unsharp | available | núcleo 3x3 aproximado; perfil Eficiente lo acota |
| glow | SVG | split/colorlevels/gblur/blend | available | halo SVG aproximado; radio/intensidad/umbral reales |
| motionBlur | Canvas | tmix | available | promedio exponencial con el peso nuevo de `tmix`; al pausar/reiniciar la estela se siembra de cero |
| denoise | WebGL | removegrain + atadenoise | available | sigma 5×5 espacial + dos frames anteriores con umbral (pesos 0,8/0,4); gradúa centro, vecinos y frames anteriores antes de comparar (orden del export); no es idéntico a `atadenoise` (ventana `s` de 9 frames por defecto en el FFmpeg 9.0 empaquetado, con frames que la preview todavía no vio); un tercer frame se midió a 43,1 FPS vs 56,8 del espacial y se descartó; se desactiva con motion blur e imágenes |
| grain | SVG | noise | available | grano procedural, sin assets externos |
| lut | WebGL | lut3d/lut1d/blend | requires-file | `.cube` 3D y 1D en preview por capa con el orden del export (clip LUT → ruedas → grade → look LUT); intensidad static o keyframable; alfa VP9 preservado |
| curves | WebGL / 2D | curves | manual | editor de curvas; tabla de 256 con spline natural y maestra después de cada canal; sin WebGL2 el video queda sin preview y la imagen usa el fallback 2D |
| colorWheels | WebGL / 2D | colorbalance + curves | manual | lift/offset/gain con la fórmula de colorbalance y gamma por canal, aplicados antes de las curvas como el export; el brillo se suma a las perillas cuando hay ruedas; sin WebGL2 la imagen usa el fallback 2D exacto y el video no tiene preview; las ruedas del look global también se aplican en el shader (ruedas → grade → LUT) |
| hsl | WebGL / CSS | huesaturation | manual | matriz 3×3 exacta de `huesaturation` (strength=100, lightness=true) validada contra el FFmpeg del bundle (≤1/255) con máscara selectiva de rangos (flags máx/mín y peso por píxel; `colors=r` → [92,255,0], `colors=g` sobre rojo → sin cambios), en clip y look fuera del perfil eficiente; sin WebGL2/eficiente queda `hue` CSS |
| chromaKey | WebGL | chromakey | manual | alfa por UV BT.601 (clave en rango completo, píxel en YUV limitado) con ventana 3×3 y borde replicado; sin WebGL2 no hay preview y el derrame (spill) no se aproxima |
| mask | — | geq | manual | máscara + keyframes |

## 2. Transiciones (12)

| Transición | Preview | Export | Easing |
|---|---|---|---|
| dissolve | alfa | fade alfa / alfa sendcmd | sí |
| fade-black / fade-white | brillo / blanco | fade | no (lineal por validación) |
| slide-left/right/up/down | traslación | overlay expresión | sí |
| wipe-left/right/up/down | clip-path | geq + enable | sí |
| iris | `circle()` creciente | geq con `hypot` + enable | sí |

Registro `buildTransitionRegistry`: versión, preview `css`, export `ffmpeg`, requisitos, licencia,
tipos de clip y estado. Aplicables desde Visuals, Inspector, presets y arrastre a un clip de la
timeline.

## 3. Keyframes

| Propiedad | Dónde | Preview | Export | UI |
|---|---|---|---|---|
| posición X/Y, escala, rotación, opacidad | transform | sí | sí | editor existente |
| máscara (x/y/w/h/rotación/feather) | mask | sí | sí | editor existente |
| ganancia y paneo | audio | sí | sí | mezcla |
| brillo, contraste, saturación | efecto | sí | eq + sendcmd | panel de efectos |
| temperatura | efecto | sí (CSS aproximada) | colorbalance + sendcmd | panel de efectos |
| desenfoque | efecto | sí | gblur + sendcmd | panel de efectos |
| giro de tono | efecto | sí | hue + sendcmd | panel de efectos |
| intensidad de LUT | efecto | sí | blend + sendcmd | panel de efectos |
| intensidad de glow | efecto | sí | blend + sendcmd | panel de efectos |
| grain | efecto | sí | noise + blend + sendcmd | panel de efectos |
| Bézier por keyframe | efecto | sí | sendcmd muestreado | 4 coordenadas |
| texto, transiciones, color avanzado | — | — | — | pendiente |

## 4. UI profesional

Completado: buscador, categorías, favoritos, recientes, presets propios, miniaturas CSS, **miniaturas
animadas WebM** (21, generadas desde el `Preview` real con `npm run effects:thumbs`, ~83 KB en total,
se reproducen al hover/foco y caen al swatch CSS si faltan), editor de parámetros, restaurar, aplicar
a selección, aplicar por arrastre al panel y a la timeline, selección por pista, capa de ajuste para
toda la pista, copiar/pegar/quitar todo o un efecto puntual, **duplicar un preset propio**
(`Duplicar` en cada fila, copia con id nuevo y sufijo ` (copia)`, tope de 20), undo/redo y perfiles de
preview. Sin pendientes en esta sección.

Las miniaturas usan un clip de prueba con ruido y valores representativos por efecto (no los defaults
del catálogo en los efectos manuales); el fixture fuente vive en `e2e/lut-harness/preview-source.mp4`
y no se empaqueta. Los WebM son propios (CC0) y se regeneran desde `scripts/generate-effect-thumbs.mjs`.

## 5. Repositorios evaluados

| Repo | Decisión |
|---|---|
| GL Transitions | **Bloqueado**: licencia NOASSERTION y por shader sin resolver. Se implementaron wipes propios. |
| PixiJS / Filters | **No compatible**: duplicaría el renderer DOM/CSS + FFmpeg. |
| Motion Canvas / Exporters | **No adoptado**: motor propio `MotionPlan` + ASS cubre escenas; no se embebe una segunda app. |
| Rive Runtime | **Bloqueado**: runtime MIT, pero no hay assets `.riv` con licencia revisada; sin captura/export verificado. |
| GSAP | **Excluido** por licencia restrictiva para herramientas de creación visual. |
| HyperFrames | **Integrado** como contenido Open Design (13 renderizables + 9 previews), no como motor del timeline. |
| OpenReel | **Referencia**; no se copió editor ni timeline. |
| FFmpeg | **Integrado** LGPL compartido, sin GPL/nonfree. |

## 6. Recursos multimedia

- **Completado**: importación de archivos propios; cada asset guarda origen, fecha, proveedor,
  licencia, uso comercial y atribución; botón Inventario que copia un Markdown auditable.
- **Completado (propio)**: biblioteca de **5 overlays** empaquetados (fuga cálida, fuga fría,
  polvo dorado, bokeh suave y **mascota con alfa**), generados con `scripts/generate-overlays.mjs`,
  con posters, catálogo, licencia CC0 y montaje automático en una pista Overlays con la mezcla
  que declara cada uno (Screen o Normal).
- **Bloqueado**: overlays, humo, fuego, lluvia, nieve, destellos y light leaks de
  Mixkit/Pixabay no se incorporan sin permisos de redistribución revisados. No se usan assets
  de stock; las partículas propias existen como plantilla Motion y como overlay de polvo.
- **No se redistribuyen** archivos de stock como biblioteca independiente.

## 7. Rendimiento

- Perfiles de preview Eficiente/Equilibrado/Máximo con adaptación real del desenfoque; el export no
  cambia.
- Perfiles de render, política GPU, proxies y límites de concurrencia ya existentes.
- Medido: 1080p 30 fps 3 s → 1.144 ms base vs 2.838 ms con barrido de 1 s.
- Medido (2026-10-30, corrida pareada 15:33Z): preview real 1080p60 con `EffectOverlay` y el
  componente de efectos: **51,1–60 FPS** (sin efectos 57,3; denoise temporal 60 vs espacial 57,5;
  corrida posterior con denoise graduado 52,8–60 FPS y GPU 3D del caso completo 61,6 %;
  LUT+denoise 60 vs 56; viñeta 51,1; motion blur 57,5; caso completo 60). La pasada de uso mide
  **1,8–4,3 % de CPU** de la máquina (0,22–0,52 núcleos), **602–627 MB** de working set del árbol
  de Chrome y **4,3–23,5 %** de GPU 3D. La varianza entre corridas supera la diferencia entre
  efectos; la corrida previa con 47,1 FPS no se reprodujo y queda como outlier en el historial.
  Hardware, método y límites en `docs/EFFECTS-PERFORMANCE.md` y `docs/EFFECTS-PREVIEW-BENCH.json`;
  se reproduce con `npm run bench:preview`.
- El perfil **Eficiente** apaga el denoise temporal (queda sólo el espacial); Equilibrado y Máximo
  lo mantienen. La prop `temporalDenoise` sigue disponible para forzarlo.
- Medido (2026-10-30): render FFmpeg 1080p/5 s: base 1,171 s / 1,672 s CPU / 148,7 MB; 7 efectos
  4,160 s / 25,031 s CPU / 186,4 MB. Con `h264_amf`: base 1,337 s / 1,422 s CPU / 167,9 MB;
  efectos 4,550 s / 24,391 s CPU / 206,0 MB, GPU 3D 2,8 % (pico 5,5 %) y motor de video
  30,9 % medio (pico 61,8 %, 2 muestras). La cadena de filtros en CPU es el cuello.
- Pendiente: muestreo del motor de video en corridas más largas y medición dentro de
  WebView2/Tauri; no hay motores GPU propios que cargar bajo demanda.

## 8. Pruebas reales

| Prueba de la misión | Estado | Evidencia |
|---|---|---|
| 1. Dos videos + transición | **Completado** | `render_live_wipe…`, `render_live_iris…`, `render_live_audio_captions…` |
| 2. Video con múltiples filtros | **Completado** | E2E de glow + motionBlur revalidado; keyframes de color/blur/hue |
| 3. Texto con animación | **Completado** | `render_live_motion_graphics_produces_visible_pixels`: rect rojo + texto con fade (0 → **1.019** píxeles blancos entre 0,05 y 0,5 s; 83.623 B, 2 s) |
| 4. Personaje animado | **Completado (propio)** | Mascota pre-renderizada con alfa en la biblioteca de overlays; Rive runtime no integrado |
| 5. Composición Motion Canvas | **No compatible** | no se embebe; se usa MotionPlan propio |
| 6. Efecto de partículas | **Completado (propio)** | Motion **Explosión de partículas** + overlays **Polvo dorado/Bokeh** y **Mascota** generados por Olyvia, CC0 |
| 7. GL Transition | **Bloqueado** | licencia por shader; wipes propios en su lugar |
| 8. Combinación de filtros | **Completado** | glow + motionBlur + keyframes |
| 9. Proyecto multipista | **Completado** | audio/video + capa de ajuste |
| 10. Audio y video sincronizados | **Completado** | E2E con ffprobe y subtítulos |

Además: 720p24, 1080p60 y 4K24 verificados con muestreo de píxeles; E2E de brillo, blur y giro de
tono animados, y glow + motionBlur revalidado; LUT 3D verificado en Chrome contra la interpolación
JS (diff 0–1/255), con el componente real sobre una imagen y con el orden del look
(clip LUT → grade → look LUT) medido en `e2e/lut-preview.spec.ts` (**48/48**, con fallback 2D,
LUT 1D, motion blur con curvas antes de acumular, denoise temporal, curvas, chroma, ruedas del clip y
del look, orden ruedas → grade → LUT del
look, grade del look sin LUT devuelto al canvas, integración de `Preview` —brillo antes de las curvas,
brillo solo por el pase exacto, ruedas + gamma antes de la curva, HSL del clip/look con la matriz de
FFmpeg y colorMatch del clip/look— y miniatura animada del panel);
**1.647 tests frontend en 215
archivos**, **505 Rust** (68 ignorados por hardware/servicios), typecheck, build y auditoría de
licencias verdes.

## 9. Criterios de finalización

| Criterio | Estado |
|---|---|
| Catálogo real de efectos | **Sí** (21, con estados honestos) |
| Transiciones aplicables desde el timeline | **Sí** (panel, Inspector, drag a clip) |
| Filtros configurables | **Sí** (9 con parámetros; el resto en Inspector) |
| Animaciones y keyframes | **Parcial** (9 props de efecto, incluidas temperatura, LUT, glow y grain + transform/mask/audio) |
| Persistencia de efectos/keyframes | **Sí** (test de serialización y reapertura) |
| Preview y render final | **Sí para lo anunciado**; no quedan efectos `export-only` visuales (los manuales se configuran en el Inspector) |
| No romper lo existente | **Sí** (suites completas verdes) |
| Licencias revisadas | **Sí** para lo integrado; GL/Rive/GSAP bloqueados o excluidos |
| Documentación e inventario | **Sí** (este documento y `EFFECTS-MOTION-AUDIT.md`) |
| Motion graphics/partículas/personajes completos | **Parcial**: partículas y overlays propios sí; personajes Rive no → misión no terminada |

## 10. Backlog priorizado

1. Overlays procedurales propios (grano/light leak) con el mismo asset en preview y export.
2. Keyframes para más parámetros (máscara de efecto, texto).
3. Medición de CPU/RAM por proceso y uso porcentual de GPU durante preview/render (FPS/GPU de preview ya medidos en `EFFECTS-PERFORMANCE.md`); incluir la carga de los filtros SVG.
4. Preview de `denoise`: sigma 5×5 espacial más dos frames anteriores con umbral (pesos 0,8/0,4),
   ya graduados (centro, vecinos y frames anteriores) en el orden del export; la segunda muestra baja
   la desviación de 8,35 a 7,84 (reducción 9,3 % → 14,9 %). Un tercer frame previo bajaba más la
   desviación en el harness, pero el benchmark real lo midió a **43,1 FPS** frente a **56,8** del
   espacial en la misma corrida (GPU 72 % vs 63,6 %), así que se descartó. Aproxima el temporal de
   `atadenoise` pero no lo replica (el export usa `s`, 9 frames por defecto en el FFmpeg 9.0
   empaquetado, con frames posteriores que la preview no vio). Se desactiva con motion blur y en
   imágenes; en la corrida pareada con dos frames subió CPU/GPU (0,52 vs 0,36 núcleos; 23,5 vs 19,6 % de GPU)
   sin bajar FPS, y el perfil Eficiente lo apaga. La corrida posterior con denoise graduado dio
   52,8–60 FPS y 61,6 % de GPU 3D en el caso completo.
   El motion blur tiene preview temporal (EMA) y sus límites están documentados.
5. Rive sólo si se consiguen assets redistribuibles y captura determinista verificada.
6. LUT: el look global se aplica por capa de video/imagen con el orden del export; no alcanza
   gráficos/captions en ninguno de los dos. La intensidad del LUT del clip es keyframable; queda
   la diferencia de compuesto multipista (el export aplica el look después de mezclar
   las pistas). El alfa de videos VP9 ya se conserva y compone correctamente.

## 11. Cambio de licencia del binario (2026-10-30)

El FFmpeg empaquetado pasó a ser una build **LGPL shared** verificada. Esto retiró filtros y
encoders GPL que la app usaba, con reemplazos reales o límites explícitos:

| Antes (GPL o ausente) | Ahora (LGPL) | Estado |
|---|---|---|
| `eq` para brillo/contraste/saturación | `colorbalance` + `colorlevels` + `hue` (+ `sendcmd`) | **Completado**, E2E de keyframes verde |
| `hqdn3d` | `removegrain` + `atadenoise` | **Completado**; Denoise Studio y efecto `denoise` |
| `delogo` (inpainting) | `drawbox` semitransparente con margen | **Sustituido**: redacta la marca, no reconstruye el fondo; la UI dice “Cubrir logo” |
| `vidstabdetect`/`vidstabtransform` | — | **No disponible** en el build LGPL; el análisis devuelve un error claro |
| `perspective` | — | **No disponible**; el export falla con el error de FFmpeg |
| `libx264` / `libx265` | `libopenh264` / `libkvazaar` (bitrate; H.265 exige múltiplos de 8) | **Completado** en render, descargas, conversión, creador, proxies y shorts |
| HDR H.265 por software | AV1 10 bits con `libaom-av1` | **H.265 HDR bloqueado** con mensaje claro; AV1 sigue |

Verificación: `npm run audit:ffmpeg` (buildconf/encoders/licencia) y E2E reales con el binario
empaquetado: wipes 720p24/1080p60/4K24, keyframes de brillo/blur/hue e **intensidades de LUT, glow y grain**
(render real rojo→cian), glow+motionBlur, audio+subtítulos+transición, pipeline base, look
cinematográfico y redacción de logo.
**505 Rust + 68 ignored**, suite normal sin fallos.

Límites que siguen abiertos: estabilización vidstab, transformación de perspectiva 4 puntos,
HDR H.265 por software y la máscara como efecto manual (su preview vive en la capa, no en el registro).
