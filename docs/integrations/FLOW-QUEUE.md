# Flow Queue ↔ Editor IA

Integración entre la extensión de Chrome `extensions/flow-queue` y el editor de
escritorio. El objetivo es cerrar el ciclo guion → prompts → imágenes → timeline
sin que Editor IA dependa de una API privada de Google Flow.

## Instalación de la extensión

1. Abrí `chrome://extensions` y activá **Modo de desarrollador**.
2. **Cargar descomprimida** → `extensions/flow-queue`.
3. Abrí `https://flow.google.com`, entrá a un proyecto y abrí el panel lateral de
   Flow Queue.

La extensión no tiene build step: se carga tal cual. Los iconos se regeneran con
`node extensions/flow-queue/scripts/make-icons.mjs`.

## Flujo completo

### 1. Prompts desde el guion

En Editor IA → **Guion**, cada escena tiene un **Prompt visual / nota**. La tarjeta
**Prompts para Flow** combina:

- el estilo visual editable (por defecto, ilustración editorial limpia);
- el título de la escena y su nota visual (o la narración si no hay nota);
- opcionalmente, la narración como contexto.

El botón **Descargar .txt para Flow Queue** escribe una línea por prompt. El
formato del archivo es el mismo que importa la extensión: líneas no vacías, con
`---` como separador opcional para prompts de varias líneas.

### 2. Cola en Flow

En el panel de la extensión:

1. **Conectar pestaña** verifica el cuadro de prompt, el botón de generar y el
   input de imágenes.
2. **Modelo y formato**: elegí el nombre y el aspecto que existan en el selector
   de Flow. El panel abre el overlay real, fija modo Imagen, aspecto, `x1` y
   familia de modelo, y verifica el resultado; si no coincide, se detiene. Si ya
   lo configuraste a mano, activá “Ya configuré modelo y formato en Flow”.
3. **Referencias**: hasta 4 PNG/JPG/WEBP. Flow abre un selector de archivos
   nativo; si la extensión no puede adjuntarlas, cargalas a mano y activá “Ya
   adjunté estas referencias”.
4. **Prompts**: importá el `.txt` o pegalos. Se normalizan y deduplican. La cola
   trabaja en **Imagen, x1** por prompt.
5. **Ritmo de la cola**: pausa entre prompts y espera máxima por imagen.
6. **Iniciar cola**: genera de a uno, descarga las imágenes y escribe un
   `manifest.json`.

Los archivos quedan en:

```text
Descargas/flow-queue/<runId>/001_slug.png
Descargas/flow-queue/<runId>/002_slug.png
Descargas/flow-queue/<runId>/manifest.json
```

El `runId` tiene la forma `AAAAMMDD-HHMMSS`. El ancho del número se adapta a la
cantidad de prompts (mínimo 3 dígitos). Editor IA ordena por nombre.

### 3. Storyboard en Editor IA

En **Medios**:

1. Confirmá los derechos de los archivos.
2. **Auto-montar lote…** abre el selector múltiple de Windows.
3. Elegí las imágenes descargadas y, si existe, el audio de narración.
4. Editor IA copia, mide y hashea cada archivo, los marca como `ready` con la
   licencia declarada y arma el storyboard.

Distribución:

| Caso | Duración de cada imagen |
| --- | --- |
| Hay audio | Duración del audio repartida en partes iguales (el resto va a las primeras). |
| No hay audio, hay escenas con duración estimada | Suma de duraciones del guion repartida en partes iguales. |
| Sin audio ni guion | 5 segundos por imagen (configurable en el código). |

Las imágenes se ordenan por `label` con comparación numérica, por eso el prefijo
`001_`, `002_` es importante. El audio se monta en una pista de narración en el
frame 0. La operación queda en `provenance` como rol `editor`.

## Límites

- No hay alineación forzada palabra-imagen. El reparto es determinista y se
  declara como tal.
- Si el lote tiene varios audios, se usa el primero y se avisa; los demás quedan
  en la biblioteca.
- Los videos que vengan en el mismo lote se importan pero no se montan en el
  storyboard automático.
- La extensión requiere que el panel quede abierto y que la pestaña de Flow no se
  recargue.
- El adaptador de Flow es heurístico. Si Google cambia el DOM, el panel muestra
  un diagnóstico y no hace clic a ciegas.

## Verificación

```bash
npm run test:extension
npm run typecheck
npx vitest run apps/desktop/src/state/storyboard.test.ts \
  apps/desktop/src/features/script/flow-prompts.test.ts \
  apps/desktop/src/features/assets/AssetsPanel.test.tsx
```

El smoke test de Chromium real (requiere Playwright y un navegador Chromium
descargado) está en `extensions/flow-queue/scripts/smoke-extension.mjs`. Sirve
una página `flow.google.com` falsa, carga la extensión y ejecuta un prompt.

La corrida completa de cola + descarga está en
`extensions/flow-queue/scripts/smoke-download.mjs`. Verificó un PNG de 14.822
bytes y un `manifest.json` con el prompt en estado `downloaded` y la ruta
`flow-queue/<runId>/001_....png`. Playwright redirige las descargas a una carpeta
temporal y las renombra con UUID; el nombre solicitado queda en el manifiesto.

La validación contra el Flow real del usuario está documentada en
[FLOW-REAL-DOM-2026-10-19.md](../reference/FLOW-REAL-DOM-2026-10-19.md):
prompt ProseMirror, botón “Iniciar generación”, overlay de formato, una imagen
real 1376×768 y descarga firmada de 463.522 bytes. La extensión no se instaló
como panel lateral en ese Chrome y la carga de referencias sigue siendo manual.

## Referencia

- [Análisis del video](../reference/VIDEO-ANALYSIS-2026-10-19.md)
- [README de la extensión](../../extensions/flow-queue/README.md)
