# 2026-11-05 — Exploración de disco para la IA (MCP `media_folder_list`)

## Pedido

El usuario pidió que la IA integrada pueda manejar toda la app (crear,
borrar, editar) y tener acceso a la PC para encontrar archivos/carpetas.

## Hallazgo

La superficie MCP ya era casi completa (~95 herramientas en
`state/mcp-catalog.ts` + casos en `state/mcp-tools.ts`): proyectos,
pistas, clips, subtítulos, assets, efectos, audio, color, exportación,
automatizaciones, jobs de factory, navegación. El hueco real era la
**descuberta de material en disco**: `asset_import` recibe rutas absolutas
pero ningún tool listaba carpetas.

Ya existía el comando Rust `list_media_folder` (acepta ruta absoluta o
nombre dentro de Descargas, recorre 2 niveles, sólo medios, máx. 300) y el
servicio `service.listMediaFolder` en el frontend — sólo faltaba exponerlo.

## Cambio

- `apps/desktop/src/state/mcp-catalog.ts`: nueva tool `media_folder_list`
  con `readOnlyHint: true` (entra en lecturas paralelas del bridge).
- `apps/desktop/src/state/mcp-tools.ts`: caso que llama a
  `service.listMediaFolder({ folder, root? })` y devuelve JSON con
  `directory`, `count` y `files[]` (path, name, kind, bytes).
- `apps/desktop/src/state/mcp-tools.test.ts`: test con spy sobre el fake
  service.

No hizo falta tocar Rust: `tools/list` sirve el catálogo del frontend y
`cache_read_only_tools` recoge el `readOnlyHint` del propio catálogo.

## Verificación

- `npx vitest run src/state/mcp-tools.test.ts`: 23/23 (antes 22).
- `npx tsc --noEmit -p apps/desktop`: 0 errores.

## Límites

- Sólo medios (image/audio/video). Subtítulos (.srt/.vtt) y archivos de
  proyecto no aparecen; si se necesita, agregar extensiones o un
  `fs_list`/`media_search` general.
- No hay lectura de contenido de archivos (sólo metadatos).
- El asistente interno (AssistantDock) ya tenía acción `media_folder`
  para lo mismo; esto cubre la vía MCP (IA externa por 127.0.0.1 + token).
