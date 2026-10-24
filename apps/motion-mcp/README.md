# Editor IA Motion MCP

Servidor MCP local (stdio) para crear y validar planes de motion graphics. No
renderiza: el render sigue en Editor IA con FFmpeg/libass.

## Herramientas

- `motion_list_templates`: plantillas, props y defaults.
- `motion_create`: recibe `templateId` + `props` y devuelve un `MotionPlan`
  neutral (`version`, `layers`, canvas, fps y duración).
- `motion_validate`: valida versión, límites, colores y animaciones.

## Uso

```bash
node apps/motion-mcp/src/server.mjs
```

En **Ajustes → Servidores MCP**, agregá:

- Nombre: `Motion`
- Comando: `node`
- Argumentos: `D:\ruta\a\editor-ia\apps\motion-mcp\src\server.mjs`
- Sin variables de entorno.

El servidor no ejecuta FFmpeg ni escribe archivos. Un agente externo puede
crear el plan, y la app lo usa como base para previsualizar/agregar el clip.
