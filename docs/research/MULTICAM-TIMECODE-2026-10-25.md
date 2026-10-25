# Diseño: multicámara por timecode (P2 #6)

**Estado**: propuesta (2026-10-25). Prepara la iteración 3 del loop.
**Base real**: la multicam v1 de `apps/desktop/src/features/multicam/` ya tiene
el modelo de cortes y montaje (`buildMulticamProject`, `recordCut`,
`normalizeCuts`, pista nueva con tramos y offsets) y **sync por audio**
(`syncOffsetsFromEnvelopes` con correlación de envolventes de picos, probada en
`multicam.test.ts`). Falta el tercer camino de sincronización: **timecode**.

## Por qué timecode

Cámaras con jam-sync (Atomos, Blackmagic, móviles con app) o grabadoras
independientes escriben en cada archivo el timecode de inicio (`timecode` en el
contenedor MXF/MOV/MP4). Si los relojes coinciden, el desfase entre cámaras se
deriva **sin escuchar audio ni marcar nada a mano**: es el caso de producciones
deportivas/eventos (el caso de uso original de la app: deportes).

## Origen de datos (lectura, no suposición)

Con el FFmpeg ya integrado (patrón de `probe` existente en
`apps/desktop/src/services/project-service.ts`):

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=timecode:format_tags=timecode \
  -of json "<archivo>"
```

Dos lugares donde vive: `stream.timecode` (MXF/PRORES) y
`format.tags.timecode` (MOV/MP4). Formato `HH:MM:SS:FF` (o `;FF` drop-frame).

- **Frame rate**: usar el `avg_frame_rate` del stream ya conocido por el
  asset; el timecode es en la base de tiempo de la fuente.
- **Drop-frame**: si el separador de frames es `;`, la conversión a frames
  difiere (no lineal). MVP: soportar NDF (`:`) y rechazar con mensaje claro
  los DFD (`;`) — son minoritarios en cámaras; documentar el límite.
- **Conversión**: `frames = ((HH*60+MM)*60+SS)*fps + FF` con `fps` racional
  redondeado (`Math.round`), igual que `fpsOf` hace con el proyecto.

## Modelo (schema mínimo)

Sin tipos nuevos en el documento: los offsets derivados se materializan en el
estado de la vista (igual que `offsets` hoy). Lo único que persiste por asset,
si llega a hacer falta, es un campo opcional `sourceTimecode` en `AssetSchema`
(fase 3; el MVP puede viviir sin persistir).

## Reglas de sincronización (fases)

1. **Fase MVP — grupo por timecode**: botón "Sincronizar por timecode" en
   `MulticamView` con las cámaras seleccionadas. Para cada asset: leer
   timecode → frames absolutos de inicio. Elegir como **referencia** el inicio
   más tardío (para que ninguna entrada sea negativa, mismo criterio que
   `syncOffsetsFromEnvelopes` ya aplica). Offset de cada cámara =
   `inicioReferencia - inicioPropio`, en frames. Alimenta el `offsets` existente
   y de ahí en adelante todo el pipeline v1 (cortes, preview, montaje) funciona
   sin cambios.
2. **Fase 2 — cadena de fallbacks**: "Sincronizar todo" prueba timecode → si
   algún asset no tiene timecode legible (o es DFD), cae a sync por audio para
   ese asset contra la referencia, y marca en la UI el método usado por cámara
   (`timecode | audio | manual`). Regla de confianza: si el offset por audio y
   el por timecode difieren >2 frames en un asset que tiene ambos, avisar y
   preferir timecode (los relojes jam-sync son más estables que la correlación
   con audio de banda estrecha).
3. **Fase 3 — verificación por timecode de destino**: mostrar en el monitor el
   timecode del programa (`inTimecode + frame`) y permitir "ir a timecode" en
   el bus de cortes (grabar corte en un TC exacto pegado desde la orden del
   director). Coste bajo: `clock()` ya existe; solo formatear NDF.

## Render

**Ninguno**: el montaje final ya se materializa como pista normal con tramos y
offsets (`buildMulticamProject`), así que el export no ve multicam. Es la
decisión correcta y se mantiene.

## UX (MulticamView)

- Junto a "Sincronizar por audio": "Sincronizar por timecode" (deshabilitado si
  ninguna cámara seleccionada tiene timecode legible).
- Chip por cámara con el método usado: `TC`, `AUDIO`, `MANUAL` y el offset en
  frames (+/-).
- Errores legibles: "3 de 4 cámaras sin timecode legible (se usará audio)".

## Riesgos

- **Relojes no sincronizados**: derivas de segundos. Mitigación: fase 2 (audio
  como verificación) + aviso cuando la correlación discrepe.
- **MP4 de móviles con timecode cero o ausente**: detección y fallback; nunca
  inventar offsets.
- **FPS mixtos entre cámaras**: la v1 ya limita duración a la cámara más corta;
  el resample de ángulos a distinto fps queda fuera (documentarlo; el montaje
  usa el fps del proyecto y FFmpeg re-muestrea al exportar como hoy).
- **Coste**: lectura de 1 ffprobe por asset (~ms), cero render extra.

## Coste estimado

| Fase | Trabajo | Esfuerzo |
| --- | --- | --- |
| MVP timecode | servicio ffprobe + grupo/referencia/offsets + botón + tests (fixtures de ffprobe JSON falsos, como el resto del repo) | media (1 iteración de agente) |
| Fallbacks | orquestación timecode→audio + chips de método + tests | media |
| TC de programa | formateo + "ir a timecode" | baja |

## Fuentes

- FFmpeg ffprobe: timecode de stream y tags — https://ffmpeg.org/ffprobe.html
- Timecode SMPTE NDF/DF — https://en.wikipedia.org/wiki/SMPTE_timecode
- Documentación de la v1 local: `multicam.test.ts` y `MulticamView.tsx`
  (comportamiento auditable en el repo, no en la web).
