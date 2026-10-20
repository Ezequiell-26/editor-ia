# Prueba real de Google Flow — 2026-10-19

**Cuenta:** sesión de Chrome del usuario, conectada por Qoder Browser Connector.  
**Proyecto:** `oct 19 - 10:53`, `https://flow.google.com/project/ae69d392-7134-4acc-8b3e-a5c9dc7e344d`  
**Navegador:** Chrome real, no un fixture.  
**Alcance:** inspección del DOM, configuración de modelo/formato, escritura de un prompt y **una** generación real. No se instaló la extensión como panel lateral en ese Chrome.

> La cuenta y el proyecto son del usuario. Las URLs firmadas que aparecen aquí
> son temporales y no deben reutilizarse. La imagen de prueba quedó en el
> proyecto y se puede borrar desde Flow cuando el usuario quiera.

## Lo que se midió en el DOM real

| Elemento | DOM observado | Consecuencia para la extensión |
| --- | --- | --- |
| Cuadro de prompt | `div[role="textbox"][contenteditable="true"].ProseMirror` con `aria-label="¿Qué quieres crear?"` | El adaptador ya lo encontraba por `[role="textbox"]`/`[contenteditable]`. |
| Botón de generar | `button[aria-label="Iniciar generación"]`, deshabilitado hasta que hay texto | El adaptador **no** lo encontraba: el nombre “generación” no coincidía con `generar` y `isVisible` rechazaba botones deshabilitados. Corregido: se acepta deshabilitado y se agrega `generación|generacion|iniciar|start`. |
| Configuración | `button[aria-label="Botón de configuración"]` con texto `🍌 Nano Banana 2.1 crop_16_9 x2` | El nombre accesible no contiene el modelo. Se agregó `findSettingsButton` y `findOptionByText`, y se busca el modelo también en `textContent`. |
| Menú de formato | Overlay con radios `Imagen`/`Video`, `16:9`/`4:3`/`1:1`/`3:4`/`9:16`, botón `Seleccionar familia de modelos` y menú `Nano Banana Pro`, `Nano Banana 2 Lite`, `Nano Banana 2.1`, cantidad `x1`–`x4` | Se agregó `FLOWQ_APPLY_SETTINGS` para fijar modo, aspecto, cantidad y familia antes del primer prompt. |
| Referencias | `Agregar ingredientes` abre un selector con `Cargar contenido multimedia`; **no hay `input[type=file]`**. Un `drop` sintético con un PNG no subió el archivo. | No se puede automatizar el file chooser nativo desde un content script. Se agregó la casilla “Ya adjunté estas referencias en Flow” y el aviso correspondiente. |
| Imagen resultado | `<img alt="Tarjeta que muestra la imagen de un usuario">` con `src="https://flow-content.google/image/<id>?Expires=…&Signature=…"`, 1376×768 | `collectResultImages` la detecta por tamaño y fuente. La URL firmada se puede descargar; no requiere cookies. |
| Progreso | La tarjeta muestra un porcentaje (`37%`) y una imagen provisional antes de terminar | `waitForResult` se endureció: exige una imagen estable en dos lecturas y ausencia de un porcentaje visible. |

## Prueba de generación

- Prompt: `Un faro azul en un acantilado, ilustración plana, sin texto`.
- Modelo: `Nano Banana 2.1`, modo Imagen, 16:9, `x1`.
- El botón `Iniciar generación` se habilitó después de escribir el prompt con
  `document.execCommand('insertText')` + evento `input`, que es exactamente lo
  que hace el adaptador.
- La generación tardó aproximadamente 12 s. El resultado fue una imagen de
  **1376×768** con título “Blue lighthouse on cliff”.
- La URL firmada se descargó con `fetch` desde Node: **HTTP 200**,
  `image/jpeg`, **463.522 bytes**. Esto valida el camino de descarga remota de la
  extensión.
- Se restauró la configuración de la página a `Nano Banana 2.1`, Imagen, 16:9,
  `x2` (la cantidad original). La imagen de prueba quedó en el proyecto; el
  usuario puede borrarla.

## Límites de esta prueba

- **No** se instaló la extensión Flow Queue en el Chrome del usuario. El panel
  lateral se probó con Chromium y fixtures (`smoke-extension.mjs`,
  `smoke-download.mjs`); el DOM real se probó con Playwright sobre la pestaña
  existente.
- **No** se ejecutó una cola completa de la extensión contra Flow. Se generó una
  imagen y se validaron los selectores, el prompt y la descarga.
- **No** se automatizaron referencias: Flow usa un selector de archivos nativo.
  La extensión ahora permite declarar que ya se adjuntaron a mano.
- La página mostró “La generación usará 0 créditos”; no se verificó el consumo
  real de la cuenta ni la política de créditos.
- La cuenta y el proyecto son datos del usuario; no se copiaron cookies,
  tokens ni la sesión. La URL firmada caduca.

## Qué cambió en la extensión a partir de esto

- `findGenerateButton`: acepta el botón deshabilitado y el texto “Iniciar generación”.
- `findSettingsButton` / `findOptionByText`: leen modelo/formato desde el overlay real.
- `FLOWQ_APPLY_SETTINGS`: fija modo Imagen, aspecto, `x1` y familia de modelo.
- `waitForResult`: espera una imagen estable y sin porcentaje de progreso.
- Referencias: casilla de adjunto manual y error explicativo si no hay input.
- Se limita la cola a **Imagen, x1** por prompt para que cada prompt produzca un
  archivo predecible; los videos de Flow se generan/importan aparte.
