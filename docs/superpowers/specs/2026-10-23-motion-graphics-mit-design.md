# Motion Graphics Studio nativo (MIT) — diseño

**Fecha:** 2026-10-23
**Estado:** Fase 1, Fase 2 (skill/operador + `generate_motion`) y servidor MCP
implementados y verificados. El worker Revideo opcional queda como adaptador
externo pendiente; no se empaqueta.
**Rama:** `feat/motion-graphics`.
**Relación:** cierra la brecha de “clips gráficos” del README y el
`Motion Graphics Studio` del AI Hub sin incorporar Remotion.

## 1. Decisión

Editor IA implementa un motor propio de motion graphics para clips `graphic`
usando el pipeline **ASS/libass + FFmpeg** que ya quema subtítulos. No se
empaqueta Remotion: su licencia no es MIT y restringe el uso comercial
automatizado. Motion Canvas y Revideo (MIT) quedan como adaptadores opcionales
para composiciones personalizadas en una fase posterior; no son necesarios para
las plantillas incluidas.

El motor es local, no ejecuta código de terceros y no agrega Node, Chromium ni
un servicio de red al instalador base.

## 2. Objetivos

1. Plantillas editables de título, lower-third, end card y stat callout.
2. Preview real en la app y render final verificable con FFmpeg.
3. Integración normal con timeline, undo/redo, guardado y publicación.
4. Una capa de generación asistida (skill + operador determinista) que produzca
   props validados y pida confirmación antes de tocar la timeline.
5. Una base limpia para un servidor MCP de motion y para un worker Revideo
   opcional, sin incluirlos en el instalador base.

## 3. No objetivos de la primera entrega

- Composición arbitraria con código TypeScript del usuario.
- Render de video con transparencia real en un archivo separado (el ASS se
  quema sobre el compuesto).
- Edición de keyframes libres, máscaras o efectos por capa.
- Remotion, Motion Canvas o Revideo dentro del binario.
- Servidor MCP y worker Revideo: fase 3.

## 4. Arquitectura

```
Template catalog (TS)
  -> buildMotionPlan(template, props, project) -> MotionPlan JSON
      -> MotionPreview (React)              [preview]
      -> start_render(motionPlans)          [render]
          -> build_motion_ass() (Rust)      [ASS]
          -> FFmpeg ass=motion.ass         [quemado]
```

### 4.1 Catálogo de plantillas

Vive en `apps/desktop/src/features/motion/templates.ts`. Cada plantilla declara:

- `id`, `version`, `label`, `description`, `category`.
- `propsSchema` (Zod), `defaults`, `limits`.
- `buildLayers(props, context): MotionLayer[]`.
- `previewVariant` para estilos específicos de la UI.

El catálogo es la única fuente de verdad de la forma de las props. El renderer
Rust no conoce las plantillas: consume el `MotionPlan` neutral que produce el
catálogo. Así preview y render no duplican reglas.

### 4.2 MotionPlan

JSON acotado y validado. Se calcula en el renderer al abrir el proyecto o al
exportar; no se persiste en el `.editoria.json` (el proyecto guarda sólo el
`MotionItem` con template/props). Ejemplo:

```json
{
  "version": 1,
  "width": 1920,
  "height": 1080,
  "fps": { "num": 30, "den": 1 },
  "durationFrames": 90,
  "layers": [
    {
      "kind": "rect",
      "x": 0.08, "y": 0.68, "width": 0.56, "height": 0.18,
      "color": "#0f172a", "opacity": 0.9,
      "animation": { "kind": "slide-left", "durationFrames": 18, "distance": 0.04 }
    },
    {
      "kind": "text",
      "x": 0.11, "y": 0.72, "width": 0.5, "height": 0.1,
      "text": "Nombre Apellido",
      "fontFamily": "Segoe UI",
      "fontSizePx": 58,
      "weight": 600,
      "color": "#ffffff",
      "align": "left",
      "animation": { "kind": "fade", "inFrames": 10, "outFrames": 10 }
    }
  ]
}
```

Reglas:

- Coordenadas normalizadas `[0,1]` respecto del canvas del proyecto.
- `fontSizePx` se expresa en píxeles del canvas del proyecto; el renderer lo
  escala al perfil de salida igual que los subtítulos.
- `animation` sólo admite `none`, `fade`, `slide-up`, `slide-left`, `pop`.
- Máximo 16 capas, 500 caracteres por texto, 6 líneas por texto.
- Colores en `#rrggbb`; opacidad `[0,1]`.
- El texto se preenvuelve en líneas en el generador; no se mide con fuentes en
  el renderer.

### 4.3 Modelo del proyecto

No cambia el esquema:

- `motion[]`: `{ id, template: { id, version, source }, props, targetTrackId? }`.
- clip `graphic`: `{ kind: "graphic", source: { type: "graphic", motionId } }`.

Se agregan helpers puros en `state/project-actions.ts`:

- `addMotionGraphic(project, { template, props, durationFrames, startFrame })`
  crea/usa una pista `graphic`, inserta el `MotionItem` y el clip, y devuelve el
  proyecto y los ids nuevos.
- La operación es atómica y pasa por `store.mutate` (validación Zod).

### 4.4 Preview

`Preview.tsx` reemplaza el placeholder de `GraphicLayer` por un renderer de
capas:

- `MotionLayerView` dibuja rects y textos con posiciones porcentuales.
- La animación se calcula con `playheadFrame` y la duración del clip; sin
  timers propios.
- Para lower-third se conserva el estilo actual como variante visual, pero la
  geometría sale del plan.
- Si la plantilla o las props son inválidas, se muestra un placeholder con el
  error, nunca una capa silenciosa.

### 4.5 UI

Nueva vista `motion` en Herramientas:

- Galería de plantillas con categoría y descripción.
- Formulario generado desde `propsSchema` (texto, color, select, número).
- Preview 16:9 o con el aspecto del proyecto, con scrub de duración.
- Botón **Agregar a la timeline**; crea el clip en el playhead o al final.
- Aviso con el nombre del clip y acceso a “Abrir editor”.

Inspector:

- En un clip `graphic`, muestra el formulario de props y la duración; los
  cambios se aplican con undo/redo y validación.
- El botón “Editar en Motion” abre la vista con el motion item cargado.

### 4.6 Render

El render actual rechaza clips `graphic`. Se reemplaza por:

1. El frontend arma `motionPlans` para todos los `motion` referenciados por
   clips visibles y los envía en `start_render` / `start_render_to` /
   `render_project_variant`.
2. Rust valida el plan (límites, tipos, colores, números finitos).
3. `render::motion::build_motion_ass()` genera un ASS temporal con:
   - un estilo por capa de texto (fuente, tamaño escalado, color, alineación);
   - `\pos`, `\fad`, `\move`, `\fscx/\fscy` para las animaciones soportadas;
   - rectángulos como dibujos vectoriales `\p1` con color y alpha;
   - `Layer` según el orden de pista para superponer capas en orden.
4. `build_plan` agrega `ass=motion.ass` antes del ASS de subtítulos, de modo que
   los subtítulos queden siempre legibles arriba.
5. Si un clip `graphic` no tiene plan, el render falla con
   `RENDER_MOTION_PLAN_MISSING`; no se omite.

Limitación explícita: el motion ASS se quema sobre el compuesto; no se puede
poner un gráfico debajo de una pista de video superior. Las plantillas están
pensadas como overlays o end cards a pantalla completa.

## 5. Plantillas v1

| id | Props principales | Uso |
| --- | --- | --- |
| `title-card` | `title`, `subtitle?`, `background`, `accent`, `align`, `animation` | Apertura / cartela |
| `lower-third` | `name`, `role?`, `accent`, `side`, `animation` | Identificación |
| `end-card` | `title`, `cta?`, `background`, `accent`, `animation` | Cierre / CTA |
| `stat-callout` | `value`, `label`, `accent`, `animation` | Dato destacado |

Todas las plantillas usan `Segoe UI` por defecto y permiten `fontFamily` dentro
de una allowlist de fuentes del sistema. Si la fuente no está, libass usa su
fallback; el preview usa la misma familia declarada.

## 6. Capa inteligente (fase 2)

### 6.1 Skill de Motion en AI Hub

Agregar `motion` a `AI_SKILLS` con:

- brief + catálogo compacto (ids, props, límites);
- contrato de salida JSON:
  `{ "templateId": "...", "props": {...}, "durationSeconds": 3, "reason": "..." }`;
- presupuesto de tokens y ausencia de prosa;
- el botón copia el prompt; no llama al modelo por sí solo.

### 6.2 Generación con proveedor

Comando `generate_motion` (Rust) que reutiliza el proveedor configurado:

- envía sólo el brief y el catálogo de props;
- parsea JSON, valida con el mismo esquema que la UI y devuelve
  `MotionSuggestion`;
- la UI muestra preview + “Aplicar a la timeline”; nunca aplica sin
  confirmación;
- el proveedor `mock` devuelve una sugerencia determinista para tests;
- errores de proveedor se muestran como bloqueo, sin inventar un gráfico.

### 6.3 Operador determinista

Comandos sin tokens en AI Hub:

- `crear título <texto>`
- `crear lower third <nombre>`
- `crear cierre <texto>`
- `crear dato <valor> <etiqueta>`

Crean un `MotionItem` + clip `graphic` con defaults y muestran el resultado. No
inventan texto si falta el argumento: piden el dato.

## 7. MCP y Revideo (fase 3)

- **Implementado:** `apps/motion-mcp/src/server.mjs`, servidor stdio MIT con
  `motion_list_templates`, `motion_create` y `motion_validate`. Devuelve el plan
  neutral; el render queda en la app. Ver `docs/integrations/MOTION-MCP.md`.
- **Pendiente:** worker Revideo opcional (MIT) para composiciones
  personalizadas. Se detectaría una instalación del usuario y no se empaquetaría
  en el instalador base. No se implementó porque exige Node/Chromium y una
  instalación externa; el motor nativo ya cubre las plantillas incluidas.
- Remotion no se integra. Cualquier plantilla Remotion que el usuario quiera
  usar queda fuera del producto y de la distribución.

## 8. Seguridad y límites

- El plan es dato, no código: no se evalúa nada.
- Todos los números se validan (`finite`, rangos), los colores se normalizan y
  los textos se escapan antes de ASS.
- Límites: 16 capas, 500 caracteres, 6 líneas, 64 pistas, 1.000 clips.
- El ASS se escribe en el directorio temporal del render y se elimina con el
  resto de los temporales.
- No se agregan dependencias nuevas para la fase 1.
- No se ejecuta Node ni se descargan paquetes para renderizar.

## 9. Pruebas y aceptación

### Unitarias TS

- Validación de props y defaults de cada plantilla.
- `buildMotionPlan` produce capas con límites, líneas y animaciones.
- `addMotionGraphic` crea pista, motion item y clip; undo/redo funciona.
- La vista Motion agrega un clip y el Inspector edita props.

### Unitarias Rust

- Validación de `MotionPlan` (rechaza NaN, colores inválidos, demasiadas capas).
- `build_motion_ass` contiene texto escapado, posición, color y `\fad`/`\move`.
- Un clip `graphic` sin plan falla; con plan, el filtro incluye `ass=motion.ass`.

### Integración real

- Render de un video sintético de 2 s con un `title-card` y un `lower-third`.
- ffprobe: duración, resolución y fps esperados.
- Extraer un frame del centro del gráfico y comprobar que el color de acento
  aparece (no un video idéntico al base).
- Repetir con subtítulos activos para verificar el orden motion → captions.

### UI

- Playwright/App test: abrir Motion, elegir plantilla, completar props,
  agregar, ver el clip en la timeline.
- QA visual en la app real a 1376×788 y 1920×1080.

### Criterio de terminado

- `npm run typecheck`, build, tests TS y Rust verdes.
- Render real verificado con ffprobe y muestreo de frame.
- Sin Remotion en dependencias ni en el instalador.
- Documentación actualizada (`README`, `TUTORIAL`, `THIRD-PARTY-NOTICES`).

## 10. Archivos previstos

- `apps/desktop/src/features/motion/templates.ts`
- `apps/desktop/src/features/motion/plan.ts`
- `apps/desktop/src/features/motion/MotionView.tsx`
- `apps/desktop/src/features/motion/MotionPreview.tsx`
- `apps/desktop/src/features/motion/MotionForm.tsx`
- `apps/desktop/src/features/motion/motion.test.ts`
- `apps/desktop/src/features/editor/Preview.tsx`
- `apps/desktop/src/features/editor/Inspector.tsx`
- `apps/desktop/src/app/navigation.ts`, `App.tsx`, `Sidebar.tsx`, `Icon.tsx`
- `apps/desktop/src/state/project-actions.ts` + tests
- `apps/desktop/src/services/project-service.ts`, `test/fake-service.ts`
- `apps/desktop/src-tauri/src/render/motion.rs` + tests
- `apps/desktop/src-tauri/src/render/ffmpeg.rs`
- `apps/desktop/src-tauri/src/commands/render.rs`
- `apps/desktop/src-tauri/src/commands/providers.rs` (fase 2)
- `README.md`, `docs/TUTORIAL.md`, `THIRD-PARTY-NOTICES.md`

## 11. Riesgos y mitigación

| Riesgo | Mitigación |
| --- | --- |
| Diferencia preview vs render | Plan único; pruebas de frame y QA visual; preview declarada representativa. |
| Texto largo/inseguro | Límites + escape + líneas preenvueltas; tests de inyección. |
| ASS no soporta una animación | Sólo se ofrecen las animaciones implementadas y probadas. |
| Gráfico debajo de video | Limitación documentada; plantillas como overlay/end card. |
| Complejidad del Inspector | Formulario compartido con la vista Motion; si bloquea, “Editar en Motion” es el fallback. |
| Licencias | Sin Remotion; Revideo es fase 3 y opcional, con aviso. |

## 12. Orden de entrega

1. Catálogo, plan, preview y vista Motion. **Hecho.**
2. Render ASS y verificación real. **Hecho** (live 2,000 s/51.779 bytes y render
   de UI 6 s/1.364.121 bytes).
3. Inspector y pulido. **Hecho.**
4. Skill + operador determinista. **Hecho.**
5. `generate_motion` con proveedor. **Hecho**, con consentimiento de costo y
   validación antes de aplicar.
6. Servidor MCP de motion. **Hecho.**
7. Worker Revideo opcional. **Pendiente** y fuera del instalador base.
