# Google Flow MCP en Editor IA

Editor IA puede conectarse a **Google Flow** mediante un servidor MCP local que
controla la interfaz web con un perfil de Chrome dedicado. No hay API oficial de
Flow: el conector es un puente de automatización de navegador, no una integración
aprobada por Google.

## Qué permite

- Generar **imágenes** con Nano Banana 2/Pro o Imagen 4.
- Generar **videos** con Veo 3.1 u Omni Flash (consume créditos de Flow).
- Elegir aspecto, modelo, duración y guardar los artefactos en la carpeta
  `media/` del proyecto.
- Importar los artefactos a **Medios** y, opcionalmente, montarlos en la
  timeline como clips.

La vista **MCP** muestra un panel **Google Flow** cuando el servidor expone
`flow_generate_image` y/o `flow_generate_video`.

## Instalación local verificada

En esta máquina se clonó y configuró:

```text
D:\Users\ofici\QODER-WORK\google-flow-mcp
commit 425130fcb058949dfd8df17097302a9bc583c26b
```

El repositorio es [vynnlee/google-flow-mcp](https://github.com/vynnlee/google-flow-mcp),
MIT. Se instaló con:

```powershell
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
npm install --no-audit --no-fund
```

La configuración local está en `config/flow.config.json`:

```json
{
  "flowUrl": "https://flow.google.com/project/ae69d392-7134-4acc-8b3e-a5c9dc7e344d",
  "expectedAccount": "",
  "chromeUserDataDir": "D:\\Users\\ofici\\QODER-WORK\\google-flow-mcp\\chrome-profile",
  "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "cdpPort": 9333,
  "headless": false,
  "videoGenerationTimeoutMs": 900000
}
```

Se agregó al archivo de servidores MCP de Editor IA
(`%APPDATA%\com.editoria.desktop\mcp-servers.json`):

```json
{
  "id": "d90a0dc6-e472-4d64-83c1-57cdf3a97c46",
  "name": "Google Flow",
  "command": "node",
  "args": ["D:\\Users\\ofici\\QODER-WORK\\google-flow-mcp\\src\\index.js"],
  "envKeys": [],
  "workingDir": "D:\\Users\\ofici\\QODER-WORK\\google-flow-mcp",
  "enabled": true
}
```

## Iniciar sesión en el Chrome dedicado

El conector usa un perfil **separado** en el puerto CDP 9333. No copia cookies ni
la sesión del Chrome normal. Se abrió con:

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9333 `
  --user-data-dir="D:\Users\ofici\QODER-WORK\google-flow-mcp\chrome-profile" `
  --no-first-run --no-default-browser-check `
  "https://flow.google.com/project/ae69d392-7134-4acc-8b3e-a5c9dc7e344d"
```

**Hay que iniciar sesión manualmente en esa ventana la primera vez** y abrir el
proyecto indicado. Editor IA no pide ni recibe la contraseña, códigos ni cookies.
Si Google muestra login, CAPTCHA o verificación, la generación falla y hay que
resolverlo en la ventana de Chrome; no se intenta evadir.

El parche local del conector hace que, después de conectar, navegue al `flowUrl`
configurado si la pestaña no está dentro de un `/project/`.

## Uso desde la app

1. Abrí un proyecto en Editor IA.
2. **MCP → Google Flow → Probar**.
3. Elegí **Foto** o **Video**, escribí el prompt y seleccioná modelo/aspecto.
4. Marcá **“Autorizo consumir créditos de Flow”**. Sin esa marca la app no llama
   al tool. El costo exacto no lo conoce Editor IA.
5. **Generar con Flow**. Una imagen suele tardar segundos; un video puede tardar
   varios minutos. El timeout de `tools/call` de la app es de 15 minutos.
6. Cuando Flow devuelve artefactos, marcá **“Confirmo que tengo derechos”** y
   elegí **Importar a Medios** o **Importar y montar en timeline**.
7. Los assets importados quedan `ready` con licencia declarada por el usuario,
   procedencia `generated-by-provider` y proveedor `google-flow-image` o
   `google-flow-video`.

El panel usa `auto_confirm: true` sólo después de la marca de créditos. Las
imágenes y videos quedan en `<proyecto>/media/`; la app copia/valida con FFprobe y
los registra en el `.editoria.json`.

## Evidencia y límites

- **Verificado**: `initialize` y `tools/list` del servidor devuelven
  `flow_generate_image`, `flow_generate_video`, `flow_status`,
  `flow_manage_project`, `flow_download_latest`, `flow_connect` y
  `flow_disconnect`. El puente CDP responde en `127.0.0.1:9333`.
- **Verificado**: la app tiene un panel Flow, importa rutas de artefactos y puede
  montar clips; el comando nativo `import_media_paths` valida, copia y marca
  derechos sólo con confirmación explícita.
- **No verificado**: una generación real en este proyecto desde la app. El Chrome
  dedicado abrió la página pública de Flow (`/about`) porque no tenía sesión de
  Google. Se requiere que el usuario inicie sesión y autorice créditos.
- **No es una API oficial**: Google puede cambiar el DOM, pedir verificación o
  suspender cuentas por automatización. Revisá los términos de Flow antes de usar
  el conector en producción.
- **No hay generación masiva de N escenas todavía**: el panel genera un prompt
  por llamada; la fábrica y el montaje automático siguen usando los medios ya
  importados. El siguiente paso sería orquestar los prompts del guion y encadenar
  Flow → importación → auto-edit.
- El servidor MCP es código de terceros y corre con los permisos del usuario; la
  app no lo sandboxea ni firma sus dependencias.
