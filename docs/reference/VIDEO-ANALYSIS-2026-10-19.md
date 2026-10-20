# Análisis de la referencia: canal Faceless con IA (GxgPpYhN9cQ)

**Video:** “Cómo Hacer un canal Faceless Muy Fácil en 4 minutos”  
**Canal:** Katire Labs  
**URL:** https://www.youtube.com/watch?v=GxgPpYhN9cQ  
**Duración:** 267 s (4:27)  
**Fecha de publicación:** 2026-10-06  
**Analizado:** 2026-10-19 con metadatos y subtítulos automáticos de YouTube y
capturas del reproductor a 1080p.

> El transcript es automático y puede contener errores. Las citas de abajo se
> usan para ubicar acciones; lo que se afirma como “visible” se verificó en los
> frames, no solo en el texto.

## Qué muestra el video

| Momento | Acción | Evidencia visual |
| --- | --- | --- |
| 0:00-0:30 | Canales “faceless” con imágenes IA y voz en off; ingresos declarados. | Tomas de YouTube Studio y videos con stickmans. |
| 0:31-1:04 | Elige un video con buen rendimiento y toma 2-3 capturas para copiar el estilo visual. | Video “THE ENTIRE History of India in 16 Minutes” reproducido; captura del estilo stickman. |
| 1:05-1:28 | Copia la transcripción y la pega en Claude para que escriba el guion. | Panel de transcripción de YouTube y pestaña de Claude. La narración menciona “la extensión de …”; el nombre exacto no es legible. No se atribuye a una extensión concreta. |
| 1:28-1:53 | Pide un guion de ~1 minuto; lo revisa y pega 3 referencias visuales + un prompt para generar los prompts de imagen. | Chat de Claude con texto largo y miniaturas de referencia. |
| 1:53-2:23 | Copia los prompts y los lleva a Google Flow; muestra una herramienta propia que automatiza la generación. | `flow.google.com` con un panel lateral llamado **Katire Flow**. |
| 2:23-2:55 | Describe el editor propio: arrastrar audio, pegar guion, prompts, imágenes y “análisis de la IA”; edición automática. | La grabación muestra una página de error de reproducción, no la UI del editor. Se trata como **declaración no verificada**. |
| 2:55-4:27 | El video queda en una pantalla de error (“Se produjo un error…”) mientras la narración describe el resultado final. | No hay evidencia visual del resultado ni del editor. |

## La extensión visible: Katire Flow

En el frame de 2:00 el panel lateral sobre Google Flow muestra, con texto legible:

- **Modelo:** `Nano Banana 2`, con la nota “Se aplican solos en el selector de
  Flow y se comprueban antes del primer prompt”.
- **Referencias:** “Todas las referencias se adjuntan juntas en cada prompt
  (máx. 4)”; “Añadir imágenes · Click o arrastrar · PNG, JPG, WEBP”; “Uso de la
  referencia: Sólo estilo visual”.
- **Prompts:** contador `0 prompts`; botón `Importar .TXT`; texto “Se envían de
  uno en uno, sin duplicados”; desplegable `Ritmo de la cola`.
- **Listo para generar:** “Katire aplicará los ajustes y descargará sólo los
  archivos…” y botón `Iniciar cola`.

La demostración no llega a mostrar la cola llena ni las descargas: el lienzo de
Flow queda girando y el video pasa a la sección del editor. Por eso la
recreación se basa en los controles visibles y en la narración, no en un
comportamiento inventado.

## Comparación con Editor IA

| Capacidad del video | Editor IA antes | Editor IA ahora |
| --- | --- | --- |
| Guion a partir de una idea/transcripción | Guion IA con proveedor real o simulado; no importa una transcripción | Igual; pegar la transcripción en el brief sigue siendo manual |
| Capturas de referencia para el estilo | No había captura integrada | La extensión acepta hasta 4 imágenes de referencia |
| Prompts de imagen por escena | No existían | **Implementado:** tarjeta “Prompts para Flow”, estilo editable, exportación `.txt` |
| Cola de prompts en Google Flow | No existía | **Implementado:** extensión Flow Queue con modelo, referencias, `.txt`, deduplicación, ritmo, pausa/stop y descargas numeradas |
| Descarga ordenada de imágenes | No existía | **Implementado:** `flow-queue/<runId>/001_slug.png` + `manifest.json` |
| Edición automática imágenes + audio | No existía | **Implementado de forma determinista:** “Auto-montar lote” distribuye las imágenes sobre la duración de la narración; sin audio usa el guion o 5 s por imagen |
| Sincronización “IA” de voz e imágenes | No existía | **No implementado:** no hay alineación forzada ni análisis semántico; se declara la limitación |
| Voz de ElevenLabs | TTS local SAPI | Se mantiene SAPI; no se agregó una dependencia de ElevenLabs |
| Investigación de canales/nichos y monetización | Fuera de alcance | Fuera de alcance; no se simula |
| Publicación en YouTube | No existía | No se agregó; el producto termina en MP4 verificado |

## Límites de esta comparación

- El editor automático del video **no se pudo ver**: la grabación muestra un
  error desde 2:56. No se copiaron funciones que solo existen en la narración.
- La extensión se recreó a partir de la UI visible, no de su código. El
  adaptador usa heurísticas conservadoras sobre el DOM de Flow y se detiene si no
  encuentra el cuadro de prompt, el botón de generar o el modelo.
- La prueba de la extensión se hizo contra un fixture servido como
  `flow.google.com` y contra un Chromium real; **no** contra una cuenta de Google
  Flow. Esa primera ejecución real sigue pendiente.
- Los subtítulos automáticos pueden escribir mal nombres propios. “BQ” en la
  transcripción no se tomó como nombre de producto.

## Evidencia local reproducible

- Transcripción y metadatos: `D:\Users\ofici\QODER-WORK\youtube-ref\GxgPpYhN9cQ\`.
- Frames clave del reproductor: `D:\Users\ofici\MCPs\Project-Development-Tools\playwright-output\yt-frame-*.png`.
- Panel Katire Flow recortado y ampliado: `yt-katire-panel.png` en la misma
  carpeta.
- Smoke test de la extensión: `extensions/flow-queue/scripts/smoke-extension.mjs`
  y `tests/smoke-panel.png`.
