# Lista de producto — estado real

Contraste de la lista pedida contra el código, con el archivo donde vive cada cosa y el límite
cuando lo hay. «Existe» significa que hay UI y render, no sólo una función suelta.

| # | Función pedida | Estado | Dónde vive | Límite / nota |
|---|---|---|---|---|
| 1 | Recorte automático de silencios, pausas y espacios vacíos | **Existe** | `state/silence-cuts.ts` (amplitud), `state/speech-cuts.ts` (frases), `closeGaps` en `project-actions.ts` | Los huecos entre clips vienen apagados por defecto: en proyectos con audio separado, cerrar sólo la pista de video desincroniza. |
| 2 | Reducción de ruido, tres niveles | **Existe** | Limpieza automática (`DENOISE_LEVELS`: 0,15 / 0,35 / 0,6), vista Denoise (3 presets) y slider por clip | El FFmpeg empaquetado no trae `hqdn3d`: se usa `atadenoise` + `dctdnoiz`/`nlmeans`. |
| 3 | Volumen automático nivelado, sin estallar | **Existe** | `updateAudioMix` con `loudnessTarget` (-14 LUFS) + limitador maestro; medición en Mezcla | El nivelado real ocurre en el export con `loudnorm`; la preview no lo aplica. |
| 4 | Zoom automático en los cortes y zoom dinámico | **Existe** | Limpieza automática (alterna zoom-in/zoom-out), `motion` por clip y keyframes de transform | No pisa un movimiento que ya exista; los clips de menos de 24 frames quedan sin zoom. |
| 5 | Encuadre vertical 9:16 para Shorts, Reels y TikTok | **Existe** | Director → Shorts (`features/director/shorts.ts`, smart reframe con rostro), formato vertical del proyecto | El smart reframe necesita descargar el modelo de rostros; sin él cae al centro. |
| 6 | Exportación para CapCut, DaVinci Resolve y Premiere | **Parcial** | Producción → Publicación: `exportEdl`, `exportOtio`, `exportFcpxml` (`commands/edl.rs`, `otio.rs`, `fcpxml.rs`) | Resolve y Premiere importan OTIO/EDL/FCPXML. **CapCut no importa ninguno**: no hay formato de intercambio público. Se puede llevar el video + SRT. |
| 7 | Parámetros de detección ajustables | **Existe** | Umbral/mínimo/colchón (silencios), pausa mínima/aire (voz), nivel de denoise, LUFS, intensidad de zoom | — |
| 8 | Timeline con los cortes para revisión | **Existe** | Los cortes se aplican como clips reales; Ctrl+Z revierte todo el lote | La vista previa de la limpieza muestra conteos antes de aplicar en las secciones del Inspector. |
| 9 | Visualización del video antes de exportar | **Existe** | Preview del editor con audio, scopes y subtítulos | — |
| 10 | Exportación para continuar en tu editor favorito | **Existe** | EDL / OTIO / FCPXML desde Producción | Ver #6: CapCut queda fuera por formato. |
| 11 | Descarga liberada al instante, directo al e-mail | **No** | — | Olyvia es 100 % local: no hay servidor que envíe correos. La entrega es el archivo exportado + «mostrar en carpeta». Enviarlo por mail requeriría un backend y cuenta, que contradice el diseño sin nube. |

## Lo que se agregó en este ciclo

`state/auto-cleanup.ts` encadena los puntos 1–4 en **un solo paso de deshacer**:

1. Cerrar huecos (opcional, apagado).
2. Cortar silencios medidos por amplitud.
3. Cortar pausas entre frases con los subtítulos existentes (no transcribe).
4. Reducir ruido en el nivel elegido.
5. Nivelar a −14 LUFS con limitador.
6. Zoom alternado en los cortes, sin pisar movimiento previo.

Se dispara desde **Editar → Limpieza automática del proyecto** o desde el asistente con
«limpiá el video», «dejalo listo para publicar» o la acción `auto_cleanup`. Devuelve un reporte
medido: huecos, silencios, pausas, clips sin ruido, zooms y segundos removidos.

## Nivel 5: cero decisiones y entrega verificada

`state/adaptive.ts` mide el material y elige los parámetros que antes pedía la UI: umbral de
silencio (piso de ruido + 6 dB), nivel de reducción (según SNR), intensidad de zoom (según plano
mediano) y LUFS objetivo.

`state/auto-pilot.ts` usa ese perfil para limpiar, agrega los perfiles de entrega si faltan,
escribe el proyecto, renderiza y **sondea el MP4**: compara la duración con la timeline y confirma
que haya pistas de video y audio. Si algo no cuadra, devuelve `verified: false` con el motivo.

Se dispara desde Editar → «Piloto automático: limpiar y exportar», o de forma desatendida con
«Entrega automática cada 10 min»: si la revisión del proyecto cambió, guarda y vuelve a entregar
solo.

El lazo cerrado mide el MP4 con `loudnorm` y, si quedó a más de 1 LU del objetivo, corrige el
master y reexporta una vez. La corrección queda en el reporte.

## Pendientes reales (no cosméticos)

- **CapCut**: no hay formato de intercambio. La única vía honesta es MP4 + SRT y armarlo a mano.
- **Preview de audio de efectos**: los efectos de audio son export-only.
- **Keyframes de efecto en export**: el preview anima, el MP4 usa el valor estático.
- **Entrega por mail**: requiere backend; hoy no existe y no está planeado.
