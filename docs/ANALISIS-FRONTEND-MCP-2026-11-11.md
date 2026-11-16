# Análisis del front end con MCP — 2026-11-11

> Pedido: «seguí analizando la app, usá el MCP, revisá el front end, qué más se
> puede seguir mejorando; usá REA y Ghidra para aprender de CapCut».
>
> Herramienta: **codebase-memory MCP** (`index_repository` moderate +
> `get_architecture` + `query_graph` Cypher). Complementado con Playwright sobre
> el editor real para lo que el grafo no puede medir (UX/geometría).

## 1. Cobertura del índice

- Proyecto: `D-Users-ofici-QODER-WORK-editor-ia-architecture`, estado `ready`.
- **16.129 nodos / 61.042 aristas** en todo el repo.
- Scope `apps/desktop/src`: **6.632 nodos / 24.021 aristas**, 447 archivos,
  3.800 funciones, 753 interfaces, 245 tipos, 46 hojas CSS.
- Límite honesto: 424 archivos y 40 directorios **no indexados** (truncado por
  presupuesto) y 2 archivos con parse parcial. Los conteos son un **piso**.

## 2. Salud estructural (lo que está bien)

| Chequeo | Resultado |
|---|---|
| Ciclos de dependencias en el front | **0**. Los 3 ciclos detectados son de tests Rust / transporte MCP. |
| Archivos huérfanos (sin `IMPORTS` entrante) | **0** en `apps/desktop/src`. |
| Deuda `TODO/FIXME/HACK` | **0 real**: las 13 coincidencias eran la palabra «todo» en comentarios en español. |
| `console.log/warn/error` en producción | **3**, todos justificados (WorkspaceView, view-registry, test Rust). |

## 3. Hotspots por fan-in (qué toca todo)

| Símbolo | Fan-in | Lectura |
|---|---|---|
| `platform/tauri/shared.unavailable` | 230 | Fachada de modo navegador; central y esperada. |
| `state/project-actions.cloneProject` | 106 | **Cada edición clona el documento completo**. Punto caliente de performance en proyectos grandes. |
| `state/project-store-selectors.useProjectStore` | 103 | Selector central del store; correcto. |
| `state/project-actions.touch` | 96 | Marcado de cambios; acoplado a `cloneProject`. |
| `components/Icon.Icon` | 86 | Componente único de iconos; correcto. |
| `state/project-actions.fpsOf` | 72 | Helper puro; correcto. |

## 4. Componentes más grandes (mantenibilidad)

| Función / archivo | Líneas | Complejidad |
|---|---|---|
| `RegularClipInspector` — `features/editor/Inspector.tsx` | **5.369** | **157** |
| `DownloadView` — `features/download/DownloadView.tsx` | 4.097 | 201 |
| `ExportDialog` — `features/editor/ExportDialog.tsx` | 1.994 | 97 |
| `AssistantDock` — `features/assistant/AssistantDock.tsx` | 1.980 | 251 |
| `McpView` — `features/mcp/McpView.tsx` | 1.587 | 82 |
| `ProjectInspector` — `features/editor/Inspector.tsx` | 1.581 | 41 |
| `LocalizationView` | 1.369 | 76 |
| `AutoEditView` | 1.119 | 58 |
| `DirectorWorkspace` | 1.093 | 51 |
| `ProjectHome` | 1.091 | 63 |
| `EditorAssets` | 1.069 | 21 |

`Inspector.tsx` suma **6.950 líneas** entre sus dos componentes. No es un bug,
pero es el principal riesgo de regresión del front.

## 5. Duplicados detectados (`SIMILAR_TO` ≥ 0.85)

La mayoría son tests deliberadamente paralelos (variantes de un mismo caso).
Los reales, pequeños y de bajo riesgo:

- `average_luma` ↔ `region_luma` (Rust).
- `vttClock` ↔ `timestamp` (subtítulos).
- `insertIntoCue` ↔ `insertIntoTitle`.
- `createMarkersFromScenes` ↔ `cutClipsAtMarkers`.
- `toggleMedia` ↔ `toggleImage` ↔ `toggle`.

## 6. Qué seguir mejorando (priorizado)

1. **Partir `RegularClipInspector` por pestaña** (Video, Audio, Velocidad,
   Recorte, Animación, Color, Máscara, Estilo, Todo). Empezar por las pestañas
   con menos estado compartido; cada extracción con sus tests actuales como red.
   Riesgo alto: hacerlo en fases, nunca en un solo commit.
2. **`DownloadView` (4.097 líneas / complejidad 201)**: separar proveedores y
   máquina de estados de descarga de la vista.
3. **`ExportDialog`**: extraer el formulario de perfiles y la validación.
4. **`AssistantDock`**: separar el motor de comandos de la capa de chat.
5. **Consolidar capas CSS**: hoy hay 20+ hojas globales con `!important`
   (filmora, capcut-ui, capcut-editor, capcut-inspector, editor-clarity…).
   Fase dedicada con auditoría de selectores muertos; no en caliente.
6. **Duplicados del §5**: unificar helpers con alias de compatibilidad.

## 7. Lo que el MCP NO puede decir

- No mide UX, performance de runtime ni calidad visual. Para eso se usó el
  arnés Playwright y la auditoría de 62 estados del ciclo anterior.
- El grafo es estático: no prueba que una ruta se ejecute en producción.

## 8. Ciclo implementado con este análisis

- **Clúster de keyframes `‹ ◇ ›`** en la barra del timeline:
  - `◇` crea/quita el keyframe de transformación en el playhead (toggle real,
    `setTransformKeyframe` / `removeTransformKeyframe` / `captureTransformKeyframe`).
  - `‹ ›` navegan entre claves (ciclo anterior).
- **Diamantes de keyframe sobre el clip seleccionado**: un marcador de 5px por
  clave, en su frame real; sólo el clip activo, tope de 80.
- Verificado en vivo a 1360×768 y 1280×720: 3 → 2 → 3 marcas al alternar el
  diamante, `aria-pressed` y tooltip correctos, **0 errores de consola**, sin
  desborde de documento. Tests: `Timeline.test.tsx` 29/29 + `keyframe-nav` 9/9.
