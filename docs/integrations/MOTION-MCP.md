# Motion MCP — integración

**Fecha:** 2026-10-23
**Estado:** implementado y probado por stdio.
**Código:** `apps/motion-mcp/src/server.mjs` (Node, sin dependencias).

## Qué hace

Servidor MCP local para que un agente externo cree o valide planes de motion
graphics de Editor IA. No renderiza y no escribe archivos: devuelve un
`MotionPlan` neutral. El render, la preview y la timeline siguen en la app.

## Herramientas

| Herramienta | Entrada | Salida |
| --- | --- | --- |
| `motion_list_templates` | `{}` | Plantillas, props, defaults y campos |
| `motion_create` | `{templateId, props, width?, height?, fps?, durationFrames?}` | `{ok, plan}` o error de herramienta |
| `motion_validate` | `{plan}` | `{ok, errors[]}` |

Plantillas: `title-card`, `lower-third`, `end-card`, `stat-callout`.

## Registro en Editor IA

**Ajustes → Servidores MCP → Agregar servidor**:

- Nombre: `Motion`
- Comando: `node`
- Argumentos:
  ```
  D:\ruta\a\editor-ia\apps\motion-mcp\src\server.mjs
  ```
- Variables: ninguna.
- Carpeta de trabajo: la raíz del repo (opcional).

El gestor de MCP de la app usa stdio, `tools/list` y `tools/call`; este servidor
implementa ese subconjunto. No hay HTTP/SSE, OAuth ni sampling.

## Prueba

```bash
npx vitest run apps/motion-mcp/src/server.test.mjs
```

El test inicia el proceso, hace `initialize`, lista las tres herramientas, crea
un lower-third y valida el plan. También comprueba que una prop inválida vuelve
como `isError`.

## Límites

- No reemplaza al catálogo TypeScript de la app; la app es la autoridad de
  preview/render.
- No renderiza: no ejecuta FFmpeg ni Revideo.
- El servidor no firma ni sandboxea el plan; el consumidor debe validarlo (la
  app lo hace con Zod y Rust).
- Revideo/Motion Canvas no se incluyen. Si se retoma el worker opcional, el MCP
  podrá devolver un plan y el worker externo renderizarlo.
