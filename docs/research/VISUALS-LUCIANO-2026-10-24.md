# Visuals Luciano → Olyvia (2026-10-24)

## Fuentes y nivel de evidencia

- **Canal:** [Visuals Luciano](https://www.youtube.com/@visualsluciano) — 44 videos, 2,33 K suscriptores; Alba y Xavi, filmmaking, edición y marketing digital.
- **Método:** metadatos y subtítulos públicos en español con `yt-dlp --skip-download`; no se descargaron videos completos. Los subtítulos ingleses devolvieron HTTP 429 y se detuvo el pedido.
- **Nivel de evidencia:** *caption reviewed* (transcripción pública), no *visual walkthrough*. Los tiempos son aproximados y no se atribuyen secuencias exactas de UI que no se vieron en pantalla.

| # | Video | Duración | Qué se usó |
|---|-------|----------|------------|
| 1 | [6 EFECTOS de VÍDEO VIRALES en CapCut (El 1º lo usa Mr.Beast)](https://www.youtube.com/watch?v=FwFHHc0gvOQ) | 9:58 | Glow, cutout, máscaras, keyframes, tracking de cámara |
| 2 | [7 EFECTOS de TEXTO en CapCut que NADIE te enseña (2026)](https://www.youtube.com/watch?v=m2Qm9sXfeLQ) | 15:43 | Texto con chroma, degradado, ojo de pez, máscara de texto, perspectiva, contador |
| 3 | [De NOOB a PRO en CapCut — 17 trucos](https://www.youtube.com/watch?v=oiw7JEbWYzk) | 17:25 | Fondo difuminado, guías, sombras, motion blur, beat, adjustment layers, HSL, loudness, overlays |
| 4 | [Tutorial de CapCut para PRINCIPIANTES](https://www.youtube.com/watch?v=1A_y3XW9d30) | 15:48 | Contexto de flujo básico, pistas, texto, audio, export |

## Matriz de funciones

| Función del canal | Estado en Olyvia antes | Acción / límite |
|---|---|---|
| Quitar fondo automático y personalizado con pincel | u2netp sólo imagen, en AI Hub | **Integrado** en imagen/freeze/video; segmentación automática por frame. **Falta pincel correctivo** y tracking explícito de objeto |
| Glow / brillo tipo MrBeast | No existía | **Implementado**: efecto `glow` (intensidad, radio, umbral) + preset **Glow viral** |
| Seguimiento de cámara / rostro | Había detección de rostro para relight, sin seguimiento | **Implementado**: **Centrar rostro** analiza el track SeetaFace y crea keyframes de posición/escala. Sin tracking de objetos ni smart reframe por IA |
| Resaltar objeto con máscara circular y capa negra | Máscaras, opacidad y keyframes existían; sin compound clips | Se puede armar con clips duplicados; **falta compound clip** |
| Revelar fondo con máscara y curva de velocidad | Cutout y curvas existían, cutout sólo imagen | **Cubierto** con el cutout nuevo + máscaras/keyframes |
| Texto con chroma, degradado, ojo de pez, máscara de texto, contador | Captions y plantillas de motion; sin texto libre ni máscaras de texto | **Plantilla Texto libre** agregada (posición, tamaño, color, animación). **Faltan** degradado por capas, máscara de texto, ojo de pez, contador y compound |
| Motion blur realista | No existía | **Implementado**: `motionBlur` (2–12 frames, intensidad) con `tmix` |
| Sombra de logo/clip | No existía | **Pendiente**: requiere rama de sombra por clip |
| Exportar sólo un trozo (I/O) | No existía | **Pendiente** |
| Guías y reglas personalizadas | Hay márgenes seguros y snapping | **Parcial**: faltan guías colocables |
| Eliminar silencios automáticamente | **Ya existía** en Director (`removeSilences`) | Sin cambios |
| Auto shorts, dividir escenas, beat detection | **Ya existían** | Sin cambios |
| Adjustment layers, HSL, loudness, normalización | **Ya existían** | Sin cambios |
| Overlays de redes / zonas seguras | **Ya existía** el flujo de cumplimiento por plataforma | Sin cambios |
| Texto plano, subtítulos, transiciones, audio, export | **Ya existía** | Sin cambios |

## Implementado en este pase

- **Glow:** `ClipEffectsSchema.glow`, `apply_glow_to_chain` (split → colorlevels → gblur → screen), controles en Inspector y preset **Glow viral**. Unit `glow_and_motion_blur_reach_the_render_chain` y render live `render_live_glow_and_motion_blur_produces_a_verified_mp4` (320×180).
- **Motion blur:** `ClipEffectsSchema.motionBlur`, pesos temporales normalizados en `tmix`, controles en Inspector; sólo video.
- **Centrar rostro:** `applyFaceCenter` convierte muestras del track en keyframes de transformación; usa `analyzeFaceTrack` y el modelo SeetaFace. Test puro con muestras sintéticas.
- **Texto libre:** plantilla motion `free-text` con texto, X/Y, ancho, tamaño, color, grosor, alineación y animación; renderiza por el mismo ASS de las demás plantillas.
- **Correcciones de la revisión independiente:** el glow restaura el alfa de la rama base (`alphaextract`/`alphamerge`); el centrado usa escala estática en vez de keyframes de zoom para no abrir bordes; se rechazan Ken Burns/estabilización; el rango de rostros es 0,1–600 s; las capas de ajuste no muestran glow/motion blur; y el texto libre acota tamaño/líneas en 4K vertical.

## Gaps restantes priorizados

1. **Compound clips / secuencias anidadas** — usado en casi todos los efectos de texto y en la sombra.
2. **Texto avanzado** — degradado multi-capa, máscara con forma de texto, ojo de pez y contador de años.
3. **Sombra por clip** y **radial blur**.
4. **Rango de export I/O**.
5. **Guías colocables**.
6. **Pincel de recorte** y tracking de objetos/planar.
7. **Separación de voz por stems** (Olyvia tiene denoise/realce de diálogo, no separación IA tipo CapCut).

## Verificación de este pase

- Vitest: **958 / 110 archivos**, 0 fallos.
- Rust: **283 passed / 41 ignored**, 0 fallos.
- Typecheck, `rustfmt --check` de los archivos tocados y `git diff --check` limpios.
- Live renders: glow+motion blur 320×180 verificado; cámara lenta 2,000 s/60 frames; alfa VP9 end-to-end; recorte de imagen y video con audio corto.
- Sin commit, push ni instalador.
