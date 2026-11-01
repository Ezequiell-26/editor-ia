# Servidor MCP del proyecto (Editor IA / Olyvia)

Fecha: 2026-10-30. Bloque B del [audit universal](UNIVERSAL-AI-ENGINE-AUDIT.md):
cualquier cliente MCP (Claude, agentes compatibles, Codex, etc.) puede
inspeccionar, resolver y editar un proyecto de Olyvia por stdio, reutilizando las
acciones reales del editor.

> **Modo en vivo (2026-10-31):** además del modo archivo, el mismo servidor
> acepta `--live http://127.0.0.1:47615 --token <token>` y ejecuta las **16
> herramientas del agente dentro de la app abierta** por el puente autenticado.
> Ver [LIVE-MCP.md](LIVE-MCP.md). El modo archivo de abajo no cambió.

## Arranque

```bash
npm run mcp:build     # empaqueta con esbuild (sin dependencias nuevas)
npm run mcp:verify    # build + round-trip stdio real
node apps/project-mcp/dist/server.mjs \
  --workspace "D:/proyectos" \
  --project "D:/proyectos/demo.editoria.json"
```

Ejemplo de configuración de un cliente MCP:

```json
{
  "mcpServers": {
    "editor-ia-project": {
      "command": "node",
      "args": [
        "D:/Users/ofici/QODER-WORK/editor-ia/apps/project-mcp/dist/server.mjs",
        "--workspace",
        "D:/proyectos",
        "--project",
        "D:/proyectos/demo.editoria.json"
      ]
    }
  }
}
```

El proyecto puede no existir todavía: `project_create` lo crea en esa ruta. Si
existe, se carga al arrancar y cualquier error de schema corta el arranque con
código 1.

## Herramientas

| Herramienta | Tipo | Qué hace |
|---|---|---|
| `project_create` | escritura | Crea el proyecto configurado (nombre, resolución, fps) si no existe, con perfiles de entrega 16:9/9:16/1:1 (`ensureDelivery`). |
| `project_inspect` | lectura | Resumen del proyecto (resolución, fps, pistas, clips, assets, selección). |
| `timeline_list` | lectura | Pistas y clips con ids, tipo, etiqueta, inicio, duración y fuente. |
| `asset_list` | lectura | Materiales con id, etiqueta, tipo, estado y medios. |
| `timeline_seek` | estado | Mueve el playhead lógico del servidor (lo usan `clip_add`/`clip_split`). |
| `motion_add` | edición | Agrega una plantilla de motion en el playhead lógico. |
| `motion_path` | edición | Anima un clip de video/imagen por una trayectoria de puntos con keyframes, easing, Bezier y escala. |
| `clip_add` | edición | Monta un material ya importado en una pista/frame. |
| `clip_split` | edición | Divide un clip en un frame. |
| `project_save` | escritura | Guarda si el archivo no cambió desde la última lectura. |
| `engine_catalog` | lectura | Motores disponibles con estado real (available/partial/planned). |
| `scene_resolve` | lectura | Elige motor para un clip/escena; reporta parallax parcial y bloquea 3D/tracking no implementados. |
| `parallax_add` | edición | Crea una composición 2.5D de fondo + recorte con presets de parallax. |

`project_inspect`, `motion_add`, `motion_path`, `clip_add`, `clip_split`,
`engine_catalog`, `scene_resolve` y `parallax_add` son **las mismas
herramientas del asistente** (`apps/desktop/src/features/assistant/assistant-tools.ts`),
con la misma validación de argumentos y las mismas acciones de
`project-actions.ts`. No hay una segunda implementación del timeline.

## Seguridad y concurrencia

- El proyecto debe vivir **dentro del workspace** indicado por `--workspace`;
  se comparan rutas reales y se rechaza cualquier escape.
- Escritura atómica (temporal + rename), límite de 32 MB y validación completa
  del schema antes de tocar el disco.
- Antes de escribir se compara `mtime`/tamaño con la lectura: si el archivo
  cambió (por ejemplo, porque la app guardó), la edición se rechaza con un
  error claro en vez de pisar trabajo.
- El servidor no abre red ni puertos; es stdio local.
- No expone navegación, reproducción ni exportación: esas operaciones dependen
  de la UI y siguen en el asistente.

## Verificación real

`npm run mcp:verify` levanta el bundle, negocia `initialize` con un cliente
ficticio, lista las 13 herramientas, crea un proyecto temporal, agrega un
gráfico, mueve el playhead, divide el clip, aplica una trayectoria sobre el
clip de video del fixture, comprueba el archivo en disco y verifica errores de
herramienta/argumentos. Salida de la última corrida:

```json
{
  "ok": true,
  "protocol": "2025-06-18",
  "tools": [
    "project_inspect", "motion_add", "motion_path", "clip_add", "clip_split",
    "engine_catalog", "scene_resolve", "parallax_add", "project_create",
    "project_save", "timeline_list", "asset_list", "timeline_seek"
  ],
  "clips": 2,
  "bytes": 5851
}
```

Además: **17 tests unitarios** (sesión, conflictos, rutas, protocolo y
herramientas) integrados en la suite raíz.

## Límites actuales

- Es un servidor **de archivos**: la app puede tener el proyecto abierto; si
  guarda después, puede pisar los cambios del agente. Cerrá el proyecto en
  Olyvia, reabrilo después de editar por MCP, o usá el modo `--live`
  ([LIVE-MCP.md](LIVE-MCP.md)) para operar la app abierta.
- Sin transporte HTTP/SSE propio, sin autenticación remota (stdio local
  únicamente); el modo vivo usa el puente HTTP local autenticado de la app.
- Sin tools de render, export, navegación, audio ni subtítulos en el modo
  archivo; el modo vivo sí expone las **30** del agente (incluye render y cola de escenas).
- Sin recursos/prompts MCP ni notificaciones de progreso.
- El bundle se genera con esbuild; el repositorio no incluye Node en el
  instalador de la app.
