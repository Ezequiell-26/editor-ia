# USER-GUIDE — Olyvia 0.2.0

## Qué es

Olyvia es un editor de video local-first para Windows con un motor de
producción audiovisual autónomo: recibe una intención, planifica, obtiene o
genera recursos, edita, renderiza, revisa calidad y entrega el video final.

## Uso básico

1. Abrir Olyvia → proyecto nuevo o ejemplo.
2. Panel de Producción autónoma: escribir el objetivo, elegir opciones:
   - Voz por escena (SAPI local, gratis)
   - Música de fondo (ambient generada por ffmpeg)
   - Tarjeta de título con el objetivo
3. Crear corrida → `production_start` → el backend avanza las 9 etapas
   (plan → acquire → analyze → scenes → edit → render → review → deliver)
   sin depender de la ventana.
4. Entregable en `deliverables/<plan-id>.mp4` + manifiesto JSON.

## Control por MCP / agentes

Ver `PROVIDERS-AND-MCP.md`. Las tools `production_*` permiten orquestar el
pipeline completo sin la UI, incluida la planificación en lenguaje natural
(`production_plan_from_text`, requiere provider de chat BYOK).

## Qué revisa el quality gate

La etapa `review` valida el documento del proyecto **y el MP4 renderizado**:

- Recursos: assets referenciados existen, están listos y en rango.
- Legal: clips dentro de la duración de su asset; captions dentro de la
  timeline; derechos/licencias declarados.
- Render real (ffprobe/ffmpeg sobre el MP4):
  - `resolution` — dimensiones vs el proyecto (error si difieren).
  - `render-verify` — duración del archivo vs la timeline (>2 s error).
  - `loudness` — LUFS integrado vs el objetivo del plan (>3 LU error).
  - `color` — pix_fmt de entrega y tags de color (BT.709 se escribe
    automáticamente en MP4/MOV).
- Un error en `review` detiene la entrega; los warnings quedan en el
  reporte.

## Repair loop

Si `review` falla por un defecto mecánico reparable (clip con `outFrame`
mayor que la duración real del asset), el sistema intenta corregirlo hasta
**2 veces**: repara el documento, re-verifica el quality gate completo y
sólo entonces re-ejecuta render + review. Si el problema no es mecánico
(asset faltante, loudness, color), la corrida queda `failed` con el
hallazgo explícito — nunca se re-renderiza a ciegas.

## Providers e IA (BYOK)

- Todo lo local funciona sin claves: SAPI, música/patrones/tarjetas
  generadas por ffmpeg, archive.org.
- Remoto con tu clave (Credential Manager, nunca en archivos):
  - Chat OpenAI-compatible → planificación en lenguaje natural.
  - Imagen `/images/generations` → requisito `gen:<prompt>`.
  - Voz `/audio/speech` → requisito `remote:` o `remote:<voz>`.
- Los endpoints remotos exigen `maxCostCents > 0` declarado en el plan;
  loopback no. Detalle en `PROVIDERS-AND-MCP.md`.

## Atajos del editor

Ver la ayuda integrada y `docs/` del repositorio para atajos, flujo de
color, scopes y exportación profesional.
