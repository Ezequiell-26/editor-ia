# Seguridad

Editor IA es local-first: los proyectos, los medios y las claves se quedan en la
máquina del usuario. Este documento describe **qué protege el código que existe
hoy** y qué queda fuera de alcance.

## Almacén de credenciales

La clave del proveedor de IA se guarda en el **Administrador de credenciales de
Windows** (Windows Credential Manager) mediante la crate `keyring` (servicio
`editor-ia.provider`). No se persiste en el proyecto, ni en `localStorage`, ni en
el archivo de ajustes, ni en los logs.

- La UI envía la clave una sola vez al comando nativo `save_provider`; el proceso
  Rust la escribe en el almacén y devuelve únicamente `hasKey`.
- La clave se lee en Rust sólo cuando se está por hacer una llamada al proveedor.
- Los errores del proveedor no incluyen la clave ni el encabezado `Authorization`.
- `clear_provider_key` borra la entrada del almacén.
- El proveedor simulado no hace red y no usa claves.

Además, el formato de proyecto **rechaza** cualquier clave con forma de
credencial, incluso dentro del namespace `x-`. La lista cerrada es:
`api_key`, `apikey`, `access_token`, `refresh_token`, `secret`, `password`,
`passwd`, `authorization`, `auth_token`, `bearer_token`, `cookie`,
`private_key`. Un `.editoria.json` que las contenga no valida, así que se puede
compartir o versionar sin secretos.

## Superficie del WebView

- El CSP conserva `default-src 'self'` y `script-src 'self'`. El protocolo
  `asset:` sólo se usa para mostrar medios del proyecto y para **decodificar
  audio local** y dibujar waveforms; `connect-src` incluye
  `asset: http://asset.localhost` con ese único fin, no hosts remotos.
- Los waveforms se calculan en el WebView desde el archivo del proyecto; no se
  envía audio a ningún servicio y los medios de más de 10 minutos se omiten para
  no consumir memoria desmedida.
- Las guías de composición y el HUD de la preview son sólo ayudas visuales; no
  cambian el render.

## Perfil local

El nombre, el rol y la foto del menú de perfil se guardan en
`localStorage` (`editor-ia.profile.v1`), no en el `.editoria.json`. La foto se
lee con el selector del sistema, se limita a 8 MB de entrada, se recorta a
256×256 y se guarda como JPEG; se puede quitar desde el mismo menú. No se sube a
ningún servidor ni se incluye en un proyecto compartido.

## Director automático y convertidor

- `analyze_media` sólo lee el archivo del proyecto y ejecuta FFmpeg/FFprobe con
  argumentos fijos; no escribe el material ni hace red. La transcripción usa el
  puente local de Faster-Whisper.
- La memoria del Director vive en `%APPDATA%\com.editoria.desktop\director-memory.json`,
  se escribe con temporal + rename y tiene un límite de 2 MB. No se mezcla con
  el proyecto ni se envía a ningún servicio.
- `convert_media` sólo acepta los formatos allowlisted y assets listos del
  proyecto. Construye el vector de argumentos en Rust, escribe a un temporal,
  verifica con FFprobe y publica con rename atómico; se niega a sobrescribir y
  no acepta flags del usuario.
- El Director no publica en redes: deja una timeline editable y el MP4 se
  exporta con confirmación de destino.
- La **Fábrica** escribe variantes en una carpeta absoluta elegida por la
  persona, espeja sólo los medios referenciados y nunca sobrescribe un
  `.editoria.json` ni un MP4 existente.
- `render_project_variant` lee un proyecto de disco, usa el primer perfil de
  entrega y publica el MP4 con el mismo patrón temporal + FFprobe + rename; no
  recibe flags de FFmpeg.
- Los subtítulos por palabra y el ducking se procesan localmente; el ducking
  usa `sidechaincompress` y no envía audio a ningún servicio.

## Proveedores de IA

- Los endpoints compatibles con OpenAI reciben el brief y el modelo elegido. No
  reciben archivos del proyecto ni la clave por otro canal que el encabezado de
  autenticación.
- Las llamadas a un endpoint que no sea local requieren una confirmación explícita
  de costo antes de ejecutarse. Editor IA no estima precios que no puede conocer.
- La respuesta del modelo se trata como texto no confiable: se extrae un JSON
  acotado, se validan cantidad y longitudes de escenas y recién entonces la UI
  ofrece aplicarlo. El modelo no puede ejecutar comandos ni escribir archivos.
- El plan aplicado queda en `provenance.operations` con proveedor, modelo, costo
  declarado y revisión esperada.

## Proveedores de audio

- **Windows SAPI** es local: el texto viaja por `stdin` a un script fijo de
  PowerShell y no hay red.
- **ElevenLabs** usa la API oficial con un endpoint fijo
  (`https://api.elevenlabs.io/v1/...`); el usuario no puede redirigirlo a otro
  host. La clave vive en un servicio de credenciales separado,
  `editor-ia.audio`, y no se escribe en ajustes, proyectos ni logs.
- La síntesis con ElevenLabs exige una confirmación explícita de que la cuenta
  puede consumir créditos. La respuesta se limita a 25 MB y los errores se
  muestran acotados, sin la clave.
- **Web externa** es un puente manual: la app sólo abre una URL HTTPS con el
  navegador del sistema. No inicia sesión, no resuelve captchas, no descarga
  automáticamente ni evade límites del sitio. El audio se importa después como
  cualquier archivo local, con licencia y procedencia declaradas.
- El manifiesto de publicación se guarda en una ruta elegida con diálogo, se
  escribe de forma atómica, se limita a 1 MB y rechaza claves con forma de
  credencial. No se sube a ningún servicio.

## Servidores MCP

El gestor MCP ejecuta **procesos locales definidos por el usuario**. Es una
capacidad poderosa y por eso está acotada de forma explícita:

- Guardar un servidor **no lo inicia**. Sólo `probe_mcp_server` y
  `call_mcp_tool`, disparados por “Probar” o “Ejecutar herramienta”, crean el
  proceso; al terminar se mata y se drena su salida.
- El comando y los argumentos se validan y se pasan como vector, sin interpolar
  texto del usuario en una shell. En Windows los lanzadores `npx`/`npm` y los
  `.cmd`/`.bat` se ejecutan con `cmd /C` porque de otro modo no arrancan.
- Los **valores** de variables de entorno se guardan en el Administrador de
  credenciales de Windows (`editor-ia.mcp`, cuenta `<serverId>:<KEY>`). El JSON
  `mcp-servers.json` guarda sólo los nombres.
- Los límites son 40 servidores, 32 argumentos, 24 variables, 4 MB por línea de
  respuesta y timeouts de 12/20/45 s. `stderr` se descarta para evitar que un
  servidor bloquee la tubería.
- Editor IA **no sandboxea** el proceso MCP: hereda los permisos del usuario.
  Un servidor MCP es código de terceros; la persona decide ejecutarlo y debe
  revisar su procedencia. La app no firma ni audita esos paquetes.
- No hay transporte HTTP/SSE, OAuth, marketplace, `resources/*`, `prompts/*` ni
  sampling. El gestor todavía no se usa dentro del Director o del generador de
  guiones.

El detalle del protocolo y de los comandos está en
[`docs/reference/MCP-MANAGER-2026-10-19.md`](docs/reference/MCP-MANAGER-2026-10-19.md).

## Google Flow MCP

La integración con Google Flow usa un **servidor MCP de terceros** local
(`vynnlee/google-flow-mcp`, MIT) que automatiza la interfaz web en un perfil de
Chrome dedicado. Implicaciones:

- El perfil vive en `D:\Users\ofici\QODER-WORK\google-flow-mcp\chrome-profile` y
  se abre con CDP 9333. Editor IA **no lee cookies, tokens ni la sesión** del
  Chrome normal. La primera vez, la persona inicia sesión manualmente en esa
  ventana. La app no pide contraseñas, códigos ni resuelve CAPTCHA.
- Las herramientas `flow_generate_image`/`flow_generate_video` consumen recursos
  del servicio. La app exige una marca explícita de autorización de créditos y
  usa `auto_confirm: true` sólo después. No estima el costo.
- Los artefactos se importan con `import_media_paths` únicamente desde rutas
  devueltas por una herramienta que la persona ejecutó. El comando valida que
  sean archivos reales, los mide con FFprobe, los copia a `media/` y los registra;
  no acepta rutas del proyecto para leerlas fuera de la raíz.
- Sólo con una segunda confirmación de derechos los assets pasan a `ready` con
  licencia `user-declared`, origen `generated-by-provider` y proveedor
  `google-flow-image`/`google-flow-video`. Sin esa confirmación quedan
  `unverified`.
- Google puede cambiar el DOM, pedir verificación o aplicar sus términos. No se
  evade ningún control. El usuario es responsable de cumplir los términos de Flow
  y de los derechos de uso del material generado.
- El servidor MCP no está sandboxeado: es código de terceros con los permisos del
  usuario. Se documenta su commit y se instala fuera del repositorio de Editor IA.

## Derechos de medios

Cada asset declara `rights`:

- `rights.license.commercialUse`: `allowed`, `requires-attribution`,
  `not-for-redistribution` o `unknown`.
- `rights.provenance`: origen (`user-imported`, `downloaded`,
  `generated-by-provider`, `generated-locally`, `template-default`),
  `acquiredAt`, y cuando corresponde `sourceUrl`, `provider` y `termsSnapshot`.

Un asset no puede estar `status: "ready"` con `commercialUse: "unknown"`. La UI
exige confirmar derechos antes de importar y de montar. El renderer vuelve a
comprobar cada asset referenciado: si falta el archivo, el tamaño no coincide
con el registrado en la importación o la licencia es desconocida, el trabajo
falla con `ASSET_NOT_READY` en lugar de producir un MP4.

La licencia MIT del repositorio cubre solo el código propio. No otorga derechos
sobre medios de stock, fuentes, voces instaladas en Windows ni dependencias de
terceros. Remotion no forma parte de esta versión; su licencia debe validarse
antes de integrarlo.

`not-for-redistribution` está representado en el formato, pero **no hay un gate
de entrega que bloquee su publicación**: la decisión de no redistribuir ese
material es humana. No se debe afirmar que el export lo impide.

## Extensión Flow Queue

La extensión de Chrome está en `extensions/flow-queue` y se carga descomprimida
en modo desarrollador. Su superficie es deliberadamente pequeña:

- **Permisos**: `sidePanel`, `storage`, `unlimitedStorage`, `downloads` y
  `scripting`.
- **Host permissions**: solo `https://flow.google.com/*` y
  `https://labs.google/*`.
- **Sin credenciales**: no lee cookies, tokens ni el Administrador de
  credenciales de Windows.
- **Sin servidor**: no envía prompts, referencias ni métricas a Editor IA ni a
  terceros. Los prompts y las referencias quedan en `chrome.storage.local`; las
  imágenes se descargan mediante `chrome.downloads`.
- **Automatización conservadora**: si no encuentra el cuadro de prompt, el botón
  de generar, el input de imágenes o el modelo pedido, se detiene y muestra un
  diagnóstico; no hace clic en botones no identificados.
- **Límite**: el DOM de Google Flow no es un contrato público. La extensión se
  probó contra un fixture servido como `flow.google.com` y un Chromium real, no
  contra una cuenta de Flow. No tiene auditoría de terceros.

## Rutas y sistema de archivos

- Los paths del proyecto son relativos, usan `/` y se rechazan si son absolutos,
  tienen letra de unidad, `..`, segmentos vacíos, barras invertidas o caracteres
  reservados. La regla está duplicada en TypeScript y en Rust.
- Rust canonicaliza el path y comprueba que siga dentro de la raíz del proyecto
  antes de leer, miniar o renderizar un medio.
- La importación copia el original a `media/` con un nombre saneado y único; no
  sobrescribe ni borra el archivo fuente.
- El guardado de proyecto escribe un temporal en el mismo directorio y hace
  `rename`; un fallo deja intacto el archivo anterior.
- Los temporales de render y subtítulos viven en la caché de la app y se borran
  al terminar o cancelar.

## Procesos externos

- FFmpeg y FFprobe se ejecutan con un vector de argumentos construido en Rust a
  partir de valores validados. No hay shell, no se interpola texto del modelo y
  los ejecutables se eligen con un diálogo o desde Ajustes.
- El render usa perfiles allowlisted (MP4/MOV, H.264/H.265, AAC).
- El comando de cancelación mata el proceso hijo y no reporta un archivo.
- La narración local ejecuta un script PowerShell **fijo, embebido en el
  binario**; el texto se entrega por `stdin` y el nombre de la voz por variable
  de entorno.
- La app no abre una terminal ni ejecuta comandos escritos por el usuario.

## Verificación del render

Un resultado `completed` exige todas estas comprobaciones con FFprobe:

1. el archivo existe;
2. pesa al menos el mínimo del perfil;
3. la duración está dentro de la tolerancia de frames;
4. la resolución coincide con el perfil.

El progreso se reporta, se puede cancelar y el estado final es `completed`,
`failed` o `cancelled`. Nunca se devuelve una ruta de salida para un render que no
pasó la verificación.

## Logs

Los mensajes de error de FFmpeg se sanean reemplazando la raíz del proyecto y el
perfil del usuario por marcadores, y se limitan a las últimas líneas. La UI no
muestra rutas absolutas de proyectos en sus estados. Los logs no contienen claves
de proveedor.

## Qué no está implementado

- Firma de código del instalador y actualizaciones automáticas.
- Publicación en redes, descarga de stock, investigación con fuentes y agentes
  autónomos con escritura libre.
- Cifrado de los proyectos en reposo: quedan protegidos por los permisos del
  sistema de archivos de Windows.
- Sandbox adicional para FFmpeg más allá del proceso hijo y los argumentos
  allowlisted.

## Cómo reportar una vulnerabilidad

- **No abras un issue público** con un exploit, un archivo de proyecto de otra
  persona o datos sensibles. Está prohibido adjuntar credenciales, tokens, claves
  privadas, cookies o cabeceras de autenticación en el reporte.
- Incluí versión/commit, sistema operativo, pasos de reproducción, impacto y una
  prueba de concepto mínima. Saneá cualquier dato de terceros.
- Usá el canal privado que indique el maintainer del repositorio. Si todavía no
  está publicado, no envíes el detalle por un issue.
- Se responde dentro de los 5 días hábiles con confirmación de recibido y una
  estimación de arreglo, sin prometer un SLA que el proyecto no pueda sostener.
