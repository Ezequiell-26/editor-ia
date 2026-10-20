# Gestor de servidores MCP (2026-10-19)

Editor IA incorpora un gestor de servidores **MCP (Model Context Protocol)**
locales por transporte **stdio**. La vista `MCP` permite registrar un comando,
probar el handshake y ejecutar herramientas con argumentos JSON.

## Modelo de datos

El archivo local es `%APPDATA%\com.editoria.desktop\mcp-servers.json` y contiene:

```json
[
  {
    "id": "uuid",
    "name": "Servidor de prueba",
    "command": "node",
    "args": ["C:\\ruta\\fixture.mjs"],
    "envKeys": ["API_KEY"],
    "workingDir": null,
    "enabled": true
  }
]
```

- `envKeys` guarda **sólo nombres**. Los valores se escriben en el
  Administrador de credenciales de Windows con el servicio `editor-ia.mcp` y la
  cuenta `<serverId>:<KEY>`.
- Al editar, una línea `KEY=` conserva el valor existente; una clave eliminada
  del formulario también se borra del almacén.
- El máximo es 40 servidores, 32 argumentos por servidor y 24 variables de
  entorno. Los nombres de variables deben cumplir `[A-Za-z_][A-Za-z0-9_]*`.
- El comando y los argumentos se pasan como vector, sin interpolar una shell.
  En Windows, `npx`, `npm`, `pnpm`, `yarn`, `bunx` y archivos `.cmd`/`.bat` se
  ejecutan mediante `cmd /C` para que funcionen los lanzadores de Node.

## Operaciones nativas

| Comando | Qué hace |
| --- | --- |
| `list_mcp_servers` | Lee la configuración local. |
| `save_mcp_server` | Valida y hace upsert; escribe config con temporal + rename. No inicia el proceso. |
| `delete_mcp_server` | Elimina el servidor y sus valores del almacén. |
| `probe_mcp_server` | Inicia el proceso, hace `initialize`, envía `notifications/initialized`, pide `tools/list` (hasta 5 páginas) y lo mata. |
| `call_mcp_tool` | Repite el handshake y ejecuta `tools/call` con un objeto JSON. |

Tiempos máximos: 12 s para el handshake, 20 s para `tools/list` y **15 minutos**
para `tools/call` (las herramientas generativas como Flow/Veo pueden tardar
minutos). Cada línea de respuesta se limita a 4 MB y los logs del servidor se
descartan (`stderr` a `null`) para que no bloqueen la tubería. El proceso se mata
siempre al terminar, incluso si hubo error.

## Flujo en la UI

1. Ajustes o el menú **Herramientas → Servidores MCP** abre la vista.
2. “Agregar servidor” pide nombre, comando, argumentos (uno por línea),
   variables `KEY=valor`, carpeta de trabajo opcional y estado activo.
3. “Probar” muestra nombre/versión del servidor, protocolo, herramientas y el
   esquema de entrada.
4. Al elegir una herramienta se genera un JSON de ejemplo a partir de
   `inputSchema`; el botón “Ejecutar herramienta” llama a `tools/call` y muestra
   el resultado o el error del servidor.

No hay ejecución automática al guardar, ni al abrir la vista, ni al iniciar la
app. Tampoco hay integración todavía con el Director o el generador de guiones:
el gestor sirve para conectar y probar servidores.

## Evidencia

- **Test Rust en vivo** `commands::mcp::tests::live_stdio_probe_and_tool_call`:
  escribe un servidor fixture Node, lo inicia por stdio, verifica
  `serverInfo.name = fixture-mcp`, lista `echo` y comprueba que
  `tools/call` devuelve el texto enviado. Pasó el 2026-10-19.
- **Test de vista** `McpView.test.tsx`: agrega un servidor, verifica que el
  servicio recibe argumentos y variables, prueba la conexión y ejecuta una
  herramienta. Pasó en jsdom.
- **Validación** `validates_bounded_config`: rechaza nombre vacío, argumentos con
  salto de línea, variables con guiones y carpetas inexistentes.

## Límites declarados

- Sólo transporte **stdio local**. No hay HTTP/SSE, OAuth, ni marketplace.
- Sólo `tools/list` y `tools/call`; no `resources/*`, `prompts/*` ni sampling.
- Un servidor MCP es código de terceros que el usuario decide ejecutar. La app
  no firma, audita ni sandboxea ese proceso; hereda los permisos del usuario.
- `npx` puede descargar paquetes de la red al probar un servidor. Esa descarga
  la inicia el propio lanzador, no Editor IA.
- Los valores de entorno quedan en el almacén del usuario, pero el JSON local
  sigue siendo legible: no guardes secretos en `name`, `command` ni `args`.
