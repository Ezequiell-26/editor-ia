# Flow Queue — Editor IA

Extensión de Chrome (Manifest V3) que reproduce el flujo de **Katire Flow** visto en
el video de referencia: una cola de prompts sobre Google Flow, con referencias,
ritmo configurable y descargas numeradas para montar el storyboard en Editor IA.

## Qué hace

- Se abre como panel lateral de Chrome sobre `flow.google.com`.
- Aplica modo Imagen, relación de aspecto, `x1` y familia de modelo en el
  selector real de Flow antes del primer prompt.
- Permite elegir el modelo, adjuntar hasta **4 referencias** (PNG/JPG/WEBP) y
  aplicar el modelo en el selector de Flow antes del primer prompt.
- Importa un `.txt` con **un prompt por línea** (o bloques separados por `---`).
  Normaliza espacios, elimina duplicados y conserva el orden.
- Ejecuta los prompts **de uno en uno**, espera la imagen nueva, la descarga como
  `flow-queue/<runId>/001_slug.png`, `002_...` y deja un `manifest.json`.
- Pausa, reanuda y detiene la cola. Si un prompt falla, por defecto se detiene;
  se puede activar “continuar si falla”.
- No envía prompts, imágenes ni métricas a ningún servidor de Editor IA. Todo
  queda en la pestaña de Flow, en `chrome.storage.local` y en Descargas.

## Instalación

1. Abrí `chrome://extensions`.
2. Activá **Modo de desarrollador**.
3. **Cargar descomprimida** y elegí esta carpeta:
   `extensions/flow-queue`.
4. Abrí `https://flow.google.com` en una pestaña, entrá a un proyecto y abrí el
   panel con el icono de la extensión (o el menú lateral de Chrome).

También podés generar un zip con `npm run package:extension` en la raíz del
repositorio, descomprimir `dist/flow-queue-0.1.0.zip` y cargar la carpeta
resultante. Chrome no instala el zip directamente: siempre es una carpeta
descomprimida.

## Uso, de punta a punta

1. En **Editor IA → Guion**, generá o escribí las escenas y descargá
   **Prompts para Flow (.txt)**.
2. En el panel, **Importar .TXT** y revisá el contador. Los duplicados se omiten.
3. Agregá las referencias visuales (máximo 4). Flow abre un selector de archivos
   nativo: si la extensión no puede adjuntarlas, cargalas a mano en el selector
   de Flow y activá “Ya adjunté estas referencias”.
4. Elegí el modelo y la relación de aspecto que existan en tu selector de Flow.
   Si el nombre no coincide, el panel se detiene y lo informa; no adivina. Si ya
   lo configuraste a mano, activá “Ya configuré modelo y formato en Flow; no
   tocar el selector”. La cola trabaja en **Imagen, x1** por prompt: cada prompt
   produce un archivo predecible.
5. **Iniciar cola**. El panel aplica el modelo, adjunta las referencias y empieza
   a generar. La pestaña de Flow debe quedar abierta y el panel también.
6. Las imágenes se descargan en `Descargas/flow-queue/<runId>/` con un manifiesto
   que conserva el prompt, el orden y el modelo.
7. En Editor IA → **Medios → Auto-montar lote**, seleccioná las imágenes
   descargadas y la narración. El orden se toma por el nombre numerado.

## Permisos y privacidad

| Permiso | Para qué |
| --- | --- |
| `sidePanel` | Mostrar el panel lateral. |
| `storage`, `unlimitedStorage` | Guardar prompts y referencias localmente. |
| `downloads` | Descargar las imágenes y el manifiesto. |
| `scripting` | Conectar e inyectar el puente en la pestaña de Flow. |
| Host `flow.google.com`, `labs.google` | Único origen donde actúa. |

No pide credenciales, no lee cookies, no usa analytics y no llama a APIs de
terceros. Las imágenes de referencia se guardan como data URLs en el
almacenamiento local de la extensión.

## Límites honestos

- **El DOM de Flow no es un contrato público.** El adaptador usa heurísticas
  conservadoras (placeholder, etiquetas, roles). Si Flow cambia el markup, el
  panel muestra un diagnóstico y se detiene en vez de hacer clic a ciegas.
- El botón de generar y el cuadro de prompt se detectan en la vista de proyecto.
  Si Flow muestra un modal de confirmación de créditos, se intenta **un** clic
  dentro de un diálogo visible con etiqueta de confirmación.
- La descarga depende de que Chrome pueda leer la imagen generada. Si la imagen
  está protegida por CORS y el canvas está contaminado, el panel lo informa y
  deja la URL para descarga manual.
- El panel debe quedar abierto: la cola vive en él. Al cerrarlo se detiene.
- El modo de referencia “sólo estilo visual” se muestra en el panel, pero su
  aplicación exacta depende de los controles de Flow.
- La extensión se probó contra fixtures y Chromium real, y sus selectores se
  validaron contra el **DOM real de Flow** en la sesión del usuario: prompt
  ProseMirror, botón “Iniciar generación”, overlay de formato y una generación
  real. No se instaló como panel lateral en ese Chrome ni se ejecutó una cola
  completa. Ver `docs/reference/FLOW-REAL-DOM-2026-10-19.md` en el repositorio.
- Las referencias usan el selector de archivos nativo de Flow; la carga
  automática no está resuelta. La casilla de adjunto manual es el camino
  soportado.

## Desarrollo

```bash
cd extensions/flow-queue
npm test
node scripts/make-icons.mjs
```

Empaquetado (desde la raíz): `npm run package:extension` genera
`dist/flow-queue-0.1.0.zip`.

Smoke tests en Chromium real (requieren Playwright y `PLAYWRIGHT_BROWSERS_PATH`):

```bash
node scripts/smoke-extension.mjs   # conexión, modelo, prompt e imagen
node scripts/smoke-download.mjs    # cola completa + PNG + manifiesto
```

`smoke-download.mjs` redirige las descargas a una carpeta temporal. Playwright
las guarda con nombres UUID; la ruta solicitada `flow-queue/<runId>/001_...png`
queda registrada en el manifiesto y es la que Chrome usa fuera del test.

Fixture manual (sin cuenta de Flow):

```bash
cd extensions/flow-queue
python -m http.server 4174
# abrir http://127.0.0.1:4174/tests/fixture-flow.html
```

El fixture imita el cuadro de prompt, el selector de modelo, el input de imágenes
y una imagen de resultado, y expone `window.__flowq` para inspeccionar el
adaptador desde la consola.

## Referencia

El video `GxgPpYhN9cQ` (“Cómo Hacer un canal Faceless Muy Fácil en 4 minutos”,
Katire Labs) muestra el panel **Katire Flow** sobre Google Flow con modelo
Nano Banana 2, hasta 4 referencias, importación de `.txt`, “se envían de uno en
uno, sin duplicados”, ritmo de cola y descarga de resultados. El tramo del editor
automático posterior aparece como una página de error en la grabación, así que no
se toma como evidencia de una función concreta.
