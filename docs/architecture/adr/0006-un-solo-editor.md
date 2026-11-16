# ADR-0006: UN SOLO EDITOR — toda la app vive dentro de `EditorWorkspace`

**Estado:** aceptada e implementada (routing unificado, arranque directo al
editor, monitor persistente en modos de herramienta).
**Fecha:** 2026-11-13 (worktree `architecture/refactor-foundation`).

## Problema

La app tenía dos caras: con proyecto abierto las herramientas se embebían en
`EditorWorkspace`, pero sin proyecto (y en el arranque) cada `ViewId` podía
renderizar una pantalla standalone, y el `StartScreen` actuaba como launcher
previo. El usuario definió la regla de producto: **toda la app se usa en el
mismo editor; ninguna herramienta abre otra pestaña, ventana o pantalla, y el
video se ve en vivo mientras se trabaja**.

## Decisión

1. **`WorkspaceView` monta siempre `EditorWorkspace`.** Se eliminó la
   bifurcación standalone/embebido: ya no existe una vista por herramienta.
   Toda `ViewId` resuelve a un modo de flujo (`script`, `assets`,
   `production`, `director`, `auto-edit`, `ai-hub`), a un modo de editor
   (`text-edit`, `multicam`, `mixer`, `vfx`, `nodes`, `motion`, `visuals`),
   o a un panel del modo `tools` (hosts `home`, `projects`, `download`,
   `creator`, `lab`, `mcp`, `learn` y los 12 alias de hub vía
   `editorToolForView`). `settings` queda como excepción deliberada: es una
   ventana flotante del sistema, no una vista de trabajo.
2. **`Shell.navigate` ya no consulta `hasProject`.** La herramienta se
   resuelve a modo/panel siempre; el estado del proyecto sólo decide qué
   contenido puede mostrar cada modo.
3. **Editor vacío con herramientas.** Sin proyecto, `EditorWorkspace`
   muestra el mismo shell (pestañas de modo + contenido): `timeline` muestra
   `EditorEmptyState`, los modos `PROJECT_OPTIONAL_MODES` montan su
   empty-state real, y el resto muestra `EditorNeedsProject` — nunca una
   pantalla paralela ni un proyecto falso.
4. **Arranque directo al editor.** `App.tsx` ya no muestra `StartScreen` por
   defecto: la app abre en el editor (vacío si no hay proyecto) y la ventana
   queda en modo editor. `StartScreen` sigue existiendo como gestor de
   proyectos opcional, alcanzable desde el botón «Inicio» del topbar
   (`onReturnToStart`), donde quedan updater, onboarding, recovery,
   recientes y creación de proyecto. `ProjectHome` (panel `projects`)
   cubre el flujo principal de abrir/crear proyectos dentro del editor.
5. **Monitor persistente en modos de herramienta.** En cualquier modo
   distinto de `timeline`, el área central se divide en
   `.editor-mode-split`: panel de la herramienta + columna
   `.editor-mode-monitor` (~340 px) con `Preview` + `Transport`, así los
   cambios del video se ven en vivo sin volver a la edición. Botón
   «Monitor»/«Ocultar monitor» en la barra de contexto para plegarlo en
   vistas anchas. La timeline sigue renderizada abajo en todos los modos.

## Consecuencias

- Ninguna `ViewId` puede volver a renderizar una pantalla standalone: el
  catch-all de `WorkspaceView` monta el modo `tools` del editor.
- Los cambios de herramientas convergen en `state/project-store`, la misma
  fuente del preview y la timeline.
- Pendiente conocido (fuera de este ADR): efectos "solo export" que el
  preview no refleja en vivo; `SettingsWindow`, preview desacoplado y monitor
  dual siguen siendo ventanas opcionales explícitas del sistema, no
  navegación normal.
- Tests de routing actualizados al nuevo contrato (las vistas lazy dentro
  del editor requieren `findBy`/`waitFor`).

## Enmienda 2026-11-14 (P6 → P8-b)

El diseño de los puntos 4-5 de este ADR evolucionó sin cambiar su decisión
de fondo; las etapas y su evidencia están en
`docs/UNIFICACION-TOTAL-ETAPA-A-AUDITORIA.md` §§9-21:

- **P7:** se retiró el overlay `MinimalEditor`. Queda UN solo montaje de
  `Preview` (y su audio), `Timeline`, `Inspector` y `EditorAssets`.
- **B2:** la división `.editor-mode-split` se eliminó. `Preview` + `Transport`
  son el primer hijo del `.editor-grid` en TODOS los modos, fuera del
  ternario, para que no se desmonten al cambiar de herramienta; el plegado
  del monitor usa CSS (`editor-monitor-hidden`), no un desmontaje.
- **P8:** `AlaukTopBar`/`AlaukFooter` se montan en los 17 modos, con y sin
  proyecto (`alaukcut-chrome`). La geometría de tres columnas de la
  referencia (`.alaukcut`) sigue acotada a `timeline`.
- **P8-b:** el cromo clásico del AppShell (topbar, rail, barra de estado)
  se oculta en todos los estados cuando el editor unificado está montado;
  el toggle «Vista» lo devuelve. Un botón «Herramientas» en la barra del
  editor abre el mapa de herramientas del MISMO editor, porque en timeline
  con proyecto las pestañas de modos y el rail no están visibles.
- `settings` dejó de ser la excepción del punto 1: es un host del modo
  `tools`, dentro del editor. Ya no hay ventanas flotantes de navegación.

**Gate de identidad:** `apps/desktop/src/app/unified-editor.contract.test.tsx`
verifica sobre la app real que 11 cambios de herramienta conservan el mismo
nodo DOM de Preview/Transport/Timeline y que existe un único workspace.
Cualquier cambio que reintroduzca una segunda superficie rompe ese test.
