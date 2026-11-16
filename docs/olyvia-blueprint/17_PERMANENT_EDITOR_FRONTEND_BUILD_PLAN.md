---
date: 2026-11-13
status: implementation-plan
owner: HY4-frontend
authority: operational-frontend-spec
---

# 17 — Plan ejecutable: frontend de un único editor permanente

> Este documento convierte la arquitectura maestra y la decisión del editor permanente en un plan concreto de construcción del frontend. No declara capacidades implementadas. La verdad de cada capacidad se demuestra con código, contratos y pruebas.

## 1. Jerarquía y alcance

Leer y respetar en este orden:

1. `docs/decisions/2026-11-13-permanent-editor-surface.md`: decisión de producto obligatoria.
2. `00_MASTER_ARCHITECTURE.md`: arquitectura integral y límites del sistema.
3. `02_FRONTEND_HY4_SPEC.md`: UX, geometría, componentes y pantallas.
4. `11_FRONTEND_BACKEND_HANDOFF.md`: contratos entre UI y backend.
5. `16_FEATURE_ACCEPTANCE_MATRIX.md`: criterios verificables por capacidad.
6. Este documento: orden de construcción del frontend permanente y criterios técnicos de integración visual.

Este plan no reemplaza ni duplica las especificaciones anteriores. Si una instrucción histórica contradice la decisión del 13-11-2026, prevalece la decisión del editor permanente.

### Alcance autorizado

- Completar y consolidar el frontend React/TypeScript.
- Construir la composición persistente del editor y sus slots visuales.
- Preparar registro de herramientas, IDs estables, activación contextual, estados de UI y contratos de presentación.
- Conectar UI únicamente a contratos/servicios existentes y comprobados.
- Registrar brechas de backend para SWE 2 sin inventar endpoints.

### Fuera de alcance de esta fase

- Reescritura global de Rust, Tauri, FFmpeg, workers, schemas o MCP.
- Cambiar contratos públicos sin revisar consumidores y acordar handoff.
- Sustituir motores existentes, eliminar herramientas o simular resultados reales.
- Rediseñar una interfaz ya aprobada sin una nueva instrucción del propietario del producto.
- Migrar todas las rutas y features de golpe como una única operación.

La unificación funcional completa de motores y operaciones queda para la fase posterior definida en la decisión canónica. Esta fase deja el frontend preparado, coherente y visualmente terminado.

## 2. Diagnóstico de partida observado en código

La inspección del 13-11-2026 encontró:

- `apps/desktop/src/app/Shell.tsx` mantiene el shell de aplicación y administra `activeId`, `editorMode`, `toolView`, `toolTab` y solicitudes de activación.
- `Shell.tsx` entrega una única región `content` a `AppShell`, cuyo contenido se construye mediante `WorkspaceView`.
- `apps/desktop/src/app/WorkspaceView.tsx` devuelve `EditorWorkspace` para algunas herramientas embebidas y modos de editor, pero conserva vistas standalone para otros `ViewId`.
- En la vista `editor`, `MinimalEditor` se monta condicionalmente sobre `EditorWorkspace` cuando el modo es `timeline` y no hay herramienta activa.
- El código ya contiene lógica de integración parcial; no es una arquitectura vacía ni debe reemplazarse por una segunda aplicación.

**Conclusión técnica:** la base de activación contextual existe parcialmente, pero la composición actual todavía decide entre superficies/vistas. Antes de declarar preview y timeline persistentes hay que demostrar que sus instancias reales permanecen montadas y visibles al cambiar entre todas las herramientas. Los comentarios del código no son evidencia suficiente.

Archivos de entrada prioritarios:

- `apps/desktop/src/app/Shell.tsx`
- `apps/desktop/src/app/WorkspaceView.tsx`
- `apps/desktop/src/app/view-registry.tsx`
- `apps/desktop/src/app/view-routing.ts`
- `apps/desktop/src/features/editor/EditorWorkspace.tsx`
- `apps/desktop/src/features/editor/MinimalEditor.tsx`
- `apps/desktop/src/features/editor/Preview.tsx`
- `apps/desktop/src/features/editor/Timeline.tsx`
- `apps/desktop/src/state/project-store.tsx` y módulos delegados
- `apps/desktop/src/services/contracts/**`
- `apps/desktop/src/platform/tauri/**`

No asumir que una vista está integrada porque su nombre aparece en `editorToolForView`, en el rail o en un mapa.

## 3. Resultado visual y funcional esperado

El frontend debe presentar un único espacio de trabajo de edición con estas regiones lógicas. La distribución y medidas finales respetan el diseño visual aprobado y la especificación 02:

1. **App chrome / header:** proyecto, secuencia, estado de guardado, undo/redo, búsqueda de comandos, asistente y estado de jobs.
2. **Navigation rail:** navegación primaria y acceso a categorías; no crea editores alternativos.
3. **Tool shelf izquierdo:** medios, efectos, títulos, transiciones, plantillas, generadores y recursos de la categoría activa.
4. **Toolbar contextual:** acciones compatibles con la herramienta y la selección actuales.
5. **Monitor / preview:** una única instancia de preview del proyecto activo, siempre visible dentro del editor.
6. **Inspector contextual:** controles de la herramienta o selección activa; cambia su contenido sin reemplazar el editor.
7. **Timeline dock:** una única instancia de timeline multipista, siempre disponible, con selección y playhead compartidos.
8. **Assistant surface:** panel contextual opcional; no contiene una copia paralela del proyecto.
9. **Job/activity surface:** progreso, cancelación y resultados de tareas en background.
10. **Status area:** FPS/preview status, guardado, medios offline, estado de proveedor y mensajes accionables.

Los paneles pueden colapsarse o redimensionarse según el diseño; preview y timeline no se desmontan por activar herramientas. Si la resolución es limitada, el layout debe reorganizar el espacio sin perder el contexto de edición ni sustituir el editor por otra pantalla.

## 4. Composición React objetivo

La implementación debe converger gradualmente a una jerarquía conceptual equivalente a:

```text
ApplicationRoot
└── AppShell
    ├── GlobalHeader
    ├── PrimaryNavigation
    └── EditorSessionRoot                 # permanece montado con proyecto activo
        ├── EditorCommandBar
        ├── EditorWorkspaceLayout
        │   ├── ToolShelfSlot
        │   ├── CenterColumn
        │   │   ├── ContextToolbarSlot
        │   │   └── PreviewHost            # instancia persistente
        │   ├── InspectorHost              # cambia el contenido, no el shell
        │   └── TimelineHost               # instancia persistente
        ├── AssistantDock
        ├── JobActivityDock
        └── StatusBar
```

Esto es una arquitectura lógica, no una orden de renombrar o mover todos los archivos ahora. Reutilizar los componentes existentes y extraer límites sólo cuando cada extracción tenga consumidor y prueba.

### Regla de montaje

- Cambiar `activeToolId` no cambia la identidad de `EditorSessionRoot`, `PreviewHost` ni `TimelineHost`.
- Cambiar de herramienta no crea una segunda instancia de preview o timeline.
- El panel contextual puede montar/desmontar su contenido específico; el host del panel y el editor no se reemplazan.
- El cambio de selección no debe remontar el monitor ni la timeline.
- Un error de una herramienta se aísla en su panel; no reinicia la sesión completa.
- Lazy loading sólo afecta al contenido de la herramienta, nunca a la persistencia de preview/timeline.
- No usar keys derivadas de `activeToolId`, `activeView` o `selection.id` en los hosts persistentes.

Si el usuario todavía no abrió un proyecto, se presenta el flujo de Inicio/Abrir/Crear. Al abrir o crear un proyecto, se entra en la sesión permanente del editor. Las funciones de preparación pueden añadir recursos al mismo proyecto, pero no mantienen otro documento editable.

## 5. Tool Registry: contrato de presentación

Cada herramienta se identifica con un ID estable independiente de su nombre visible, ruta o ubicación en la interfaz.

Descriptor conceptual TypeScript:

```ts
type ToolAvailability =
  | 'available'
  | 'partial'
  | 'provider-required'
  | 'engine-required'
  | 'permission-required'
  | 'offline'
  | 'experimental'
  | 'unavailable';

type ToolActivationMode =
  | 'inspector'
  | 'tool-shelf'
  | 'preview-overlay'
  | 'timeline-context'
  | 'assistant'
  | 'background-job';

interface EditorToolDescriptor {
  id: string;                    // estable: p. ej. "video.tracking"
  domain: string;                // media, edit, audio, color, motion, ai...
  labelKey: string;              // clave i18n, no texto duplicado
  descriptionKey: string;
  activationMode: ToolActivationMode;
  selectionRequirement:
    | 'none' | 'project' | 'sequence' | 'clip'
    | 'asset' | 'track' | 'time-range';
  requiredCapabilities: string[];
  permissionScopes: string[];
  panelSlot: 'left' | 'right' | 'toolbar' | 'overlay' | 'activity';
  operationIds: string[];
  availability: ToolAvailability;
}
```

El tipo es una guía de diseño: antes de implementarlo, reconciliarlo con los tipos y catálogos existentes. No crear un segundo registry si ya existe uno funcional. El descriptor no debe incluir una copia del documento de proyecto ni ejecutar lógica de negocio.

### Categorías mínimas

- Edición: selección, trim, split, ripple, transform, crop, velocidad, estabilización.
- Preview/monitor: overlays, safe areas, comparación, guías y controles de reproducción.
- Máscaras y tracking: máscara geométrica, seguimiento, puntos, estabilización y tracking planar cuando exista motor.
- Color: exposición, balance, curvas, HSL, LUT, scopes y máscaras.
- Audio: mixer, gain, pan, EQ, compresión, ducking, denoise, voz, waveform y loudness.
- Texto: títulos, subtítulos, transcripción, traducción, estilos y captions.
- Motion/VFX: keyframes, curvas, transiciones, efectos, nodos, composición y multicámara.
- Medios: importar, organizar, buscar, descargar, convertir, comprimir y proxies.
- IA/Crear: brief, guion, storyboard, análisis, generación, autoedición y revisión.
- Entrega: render, exportación, variantes, verificación y entregables.
- Integraciones: MCP, proveedores, conectores y permisos.

Cada entrada debe apuntar a la feature/servicio existente. No crear placeholders de producción para cubrir categorías.

## 6. Contrato de activación de herramienta

La activación contextual sigue este flujo:

1. Recibir `toolId` desde la UI, shortcut, command palette o asistente.
2. Resolver descriptor desde el registry único.
3. Leer el contexto actual: `projectId`, `sequenceId`, selección, clip/asset, pista, rango y playhead.
4. Validar requisitos de selección y capacidades declaradas.
5. Validar permisos antes de habilitar acciones con efectos externos.
6. Activar el panel/overlay correspondiente y conservar los hosts persistentes.
7. Cargar controles y valores desde el estado/proyecto/servicio real.
8. Mostrar disponibilidad y motivo concreto cuando la función esté bloqueada.
9. Al ejecutar, invocar un command/application service tipado ya existente.
10. Reflejar progreso/resultados desde eventos/estado reales; no simular progreso con timers.
11. Aplicar cambios al documento canónico mediante el mecanismo existente.
12. Actualizar preview, timeline, inspector e historial sin navegación.
13. Permitir cancelar, cerrar el panel o cambiar de herramienta sin perder el proyecto ni el trabajo ya persistido.

La activación de una herramienta no equivale a ejecutar una operación. Abrir el panel no modifica el proyecto.

## 7. Estado compartido y límites

No duplicar el store actual. Auditar sus módulos y conservar las APIs públicas durante la evolución.

Separación conceptual:

| Estado | Contenido | Persistencia |
|---|---|---|
| Project document | assets, secuencias, pistas, clips, efectos, keyframes, captions | schema/proyecto |
| Editor session | selección, playhead, zoom, panel activo, herramienta activa, playback UI | sesión/preferencias según contrato |
| Preview state | frame solicitado, calidad/proxy, cache status, overlays | derivado y temporal salvo preferencias |
| Jobs | jobId, tipo, estado, progreso, cancelación, resultado/error | backend/job store |
| UI preferences | layout, panel sizes, favoritos, densidad, shortcuts | preferencias |
| Assistant context | referencias al proyecto/selección/timecode y objetivo | conversación/sesión según contrato |

Reglas:

- Una sola fuente de verdad para documento, selección y playhead.
- Herramientas no guardan copias mutables del proyecto.
- Cambios de edición pasan por operaciones/acciones existentes y registran undo/redo.
- Los valores de producción no pueden vivir sólo en `useState`.
- Estado derivado no se duplica si puede calcularse desde el documento.
- Los jobs sobreviven al desmontaje del panel y notifican al editor mediante el store/eventos existentes.
- Las operaciones fallidas no dejan el documento parcialmente actualizado.

## 8. Contrato visual de una herramienta

Cada herramienta debe implementar los siguientes estados de UI, incluso si algunos se representan con componentes compartidos:

- `idle`: lista para recibir interacción.
- `needs-project` / `needs-selection`: requisito faltante explicado.
- `checking-capability`: validación real, sin afirmar disponibilidad antes de terminar.
- `unavailable`: engine/provider no existe o no está soportado.
- `permission-required`: explicar el scope y solicitar consentimiento donde corresponda.
- `ready`: controles disponibles con valores reales.
- `previewing`: preview temporal o proxy, identificado como tal.
- `running`: job/operación real con progreso de backend.
- `completed`: resultado verificable y acción siguiente.
- `failed`: error accionable, retry sólo si es seguro.
- `cancelled`: cancelación confirmada por el backend.
- `partial`: algunas subcapacidades disponibles; enumerar límites.

Los estados no deben confundirse. Por ejemplo, `provider-required` no es un error de render y `previewing` no significa que el resultado final ya se exportó.

## 9. Interacción directa sobre preview y timeline

### Preview

- Overlays de tracking, máscaras, crop, transform, puntos y guías se dibujan encima del mismo monitor.
- Coordenadas de pantalla se transforman al espacio de imagen usando el rectángulo real de contenido, escala, letterbox y orientación.
- El overlay no reemplaza el frame renderizado.
- El playhead del monitor es el mismo playhead de timeline.
- Los cambios temporales de parámetros se muestran como preview; sólo se persisten al confirmar/aplicar según la operación.
- Si el motor no puede producir preview en tiempo real, indicar preview degradado/proxy y ofrecer render de prueba cuando exista.

### Timeline

- Una única timeline para secuencias y pistas del proyecto activo.
- La herramienta contextual puede añadir lanes/overlays (keyframes, tracking data, captions, audio envelopes) sin crear otra timeline.
- Selección, playhead, zoom y scroll siguen sincronizados con inspector y preview.
- Operaciones de clips se aplican mediante acciones tipadas y se reflejan inmediatamente en la misma instancia.
- Grandes secuencias usan virtualización/cache; no cargar todos los thumbnails/waveforms a la vez.

## 10. IA como operador del editor

La IA no debe controlar la interfaz mediante clicks frágiles ni inventar funciones. Debe consumir un catálogo de capacidades y un contrato de operaciones.

Cada acción de IA debe incluir:

- `intent`: objetivo solicitado.
- `toolId` y `operationId`: capacidad/operación elegida.
- `target`: proyecto, secuencia, clip, asset, pista o rango.
- `parameters`: valores tipados validados.
- `preconditions`: selección, motor, proveedor, formato y permisos.
- `preview/diff`: cambios propuestos cuando sea posible.
- `approval`: si requiere confirmación por costo, red, publicación o impacto.
- `execution`: resultado real o jobId.
- `history`: registro y estrategia de undo/compensación.

La UI muestra qué hará la IA, sobre qué elemento, con qué proveedor/motor, si tiene costo y qué cambió. No mostrar razonamiento privado; sí un resumen verificable de acciones. La IA opera sobre el mismo proyecto y las mismas operaciones disponibles al usuario.

## 11. Rendimiento del frontend

Objetivo de referencia: Windows de gama modesta, 1360×768 y 16 GB de RAM.

- Mantener montados preview/timeline no significa renderizar todos sus subárboles en cada frame.
- Suscribirse a slices de estado; evitar que el playhead provoque rerender de toda la aplicación.
- Separar actualización de frame, selección, paneles, jobs y documento.
- Usar memoización sólo tras medir, no como sustituto de límites de estado correctos.
- Lazy-load de controles pesados y módulos especializados.
- Virtualizar listas de assets, resultados y clips cuando corresponda.
- Thumbnails, waveform, proxies y cachés deben ser progresivos y limitados.
- Evitar videos duplicados, decodificadores simultáneos y canvases de preview ocultos.
- Paneles ocultos pueden suspender cálculos costosos, pero no desmontar los hosts persistentes.
- Respetar reduce-motion, teclado y accesibilidad.

Medir startup, memoria en idle, memoria durante playback, latencia de activación de herramienta, frame drops y tiempo de apertura de proyecto.

## 12. Seguridad y permisos de UI

- UI no concede permisos por el solo hecho de mostrar una herramienta.
- Separar scopes de lectura del proyecto, edición, filesystem, red/descargas, generación remota, render y publicación.
- Confirmar acciones externas, costosas, irreversibles o de alto impacto.
- No mostrar secretos, tokens completos ni credenciales en logs, paneles o errores.
- Rutas, URLs y nombres de archivo se validan en backend; UI no es frontera de seguridad.
- Los errores se redactan para no filtrar paths privados, headers ni credenciales.
- Una herramienta bloqueada debe explicar cómo habilitarla sin sugerir que ya está funcionando.

## 13. Orden de implementación del frontend

### F0 — Inventario y baseline

- Auditar todos los `ViewId`, rutas, alias, tool maps, hosts y features.
- Dibujar un mapa de qué componentes se montan para cada combinación de proyecto/modo/herramienta.
- Identificar las instancias reales de Preview, Timeline, stores y servicios.
- Registrar capturas a 1360×768 y 1280×720.
- Clasificar cada herramienta: integrada, parcialmente integrada, standalone, UI-only, backend unavailable o no verificada.

**Salida:** matriz de rutas/herramientas y evidencia baseline. No modificar el backend.

### F1 — Editor session y hosts persistentes

- Establecer una raíz de sesión de editor estable al abrir un proyecto.
- Garantizar identidad estable de PreviewHost y TimelineHost.
- Convertir la navegación de herramientas a activación contextual.
- Mantener vistas standalone sólo para flujos previos al proyecto o superficies globales justificadas.
- No ocultar ni desmontar preview/timeline al cambiar de herramienta.
- Añadir pruebas de identidad/montaje y navegación.

**Gate:** cambiar entre al menos 10 herramientas representativas mantiene las mismas instancias de preview y timeline.

### F2 — Tool registry y paneles

- Consolidar IDs y descriptors sin duplicar mapas existentes.
- Conectar rail, tool shelf, command palette y shortcuts al mismo registry.
- Añadir slots estables para inspector, shelf, toolbar y overlay.
- Cada herramienta muestra disponibilidad, requisitos y estados reales.
- El panel puede cambiar sin reemplazar la sesión.

**Gate:** ninguna herramienta interna navega a un editor/workspace paralelo.

### F3 — Contexto y operaciones visuales

- Unificar el contexto que reciben preview, timeline, inspector y asistente.
- Conectar controles existentes a servicios reales.
- Preparar overlays de preview y lanes contextuales.
- Probar selección, playhead, cancelación y cierre del panel.
- Documentar contratos faltantes a SWE 2.

**Gate:** el usuario puede abrir herramienta, ajustar, cancelar y volver sin perder contexto.

### F4 — Cobertura de features

Integrar progresivamente los dominios en este orden, según dependencias y disponibilidad real:

1. Selección, transform, trim, split y acciones de timeline.
2. Medios, importación, proxies y metadatos.
3. Texto, títulos y subtítulos.
4. Audio y mixer.
5. Color y scopes.
6. Efectos, transiciones y keyframes.
7. Máscaras, tracking y motion.
8. Multicámara, nodos y composición.
9. IA, generación, análisis y autoedición.
10. Descarga, compresión, render, export y entrega.

Este orden no declara que todos los motores estén disponibles; el frontend sólo conecta capacidades verificadas.

### F5 — IA y jobs

- Mostrar catálogo real de herramientas/capacidades al asistente.
- Permitir propuestas/diffs y aprobaciones.
- Presentar jobs persistentes en el mismo editor.
- Mantener progreso al cambiar de herramienta o panel.
- Recuperar resultados al reabrir el proyecto si backend lo soporta.

### F6 — Validación y cierre visual

- Pruebas unitarias, integración y Playwright/E2E.
- Capturas antes/después a 1360×768 y 1280×720.
- Keyboard-only, foco, contraste y escalado.
- Medición de memoria y rendimiento.
- Matriz de capacidades actualizada con evidencia.
- Lista de brechas a SWE 2.

## 14. Pruebas obligatorias

Crear o ampliar pruebas sin romper las suites existentes:

1. **Persistencia de instancias:** PreviewHost y TimelineHost no se desmontan al activar herramientas.
2. **Persistencia de contexto:** selección, clip, playhead, zoom y secuencia se conservan.
3. **No navegación disruptiva:** activar cualquier toolId interno no cambia a un ViewId standalone.
4. **Error aislado:** fallo de un panel no reinicia el editor.
5. **Lazy loading:** cargar una feature no desmonta los hosts persistentes.
6. **Jobs desacoplados:** cambiar/cerrar panel no cancela un job sin orden explícita.
7. **Undo/redo:** controles reflejan historial real; no inventan reversibilidad.
8. **Guardado/recuperación:** los cambios persistidos sobreviven reload/reopen.
9. **Permisos:** scopes faltantes bloquean la acción antes de ejecutar.
10. **Disponibilidad:** engines/providers faltantes aparecen como unavailable/partial.
11. **Accesibilidad:** navegación teclado, foco y labels.
12. **Performance:** evitar renders masivos por actualización del playhead.

### Matriz mínima de recorrido E2E

- Abrir proyecto → Editor.
- Editor → Audio → Color → Tracking → Subtítulos → Efectos → IA → Export.
- Cambiar clip seleccionado mientras inspector está abierto.
- Mover playhead mientras un panel contextual está activo.
- Iniciar job → cambiar herramienta → observar progreso → abrir resultado.
- Cancelar operación → confirmar estado real.
- Cerrar panel → reabrir herramienta → verificar contexto.
- Guardar → cerrar → reabrir → verificar documento.

En cada paso, comprobar que el monitor y la timeline son las mismas instancias DOM/React, no sólo elementos visualmente parecidos.

## 15. Criterios de aceptación final del frontend

El frontend no se considera terminado hasta que:

- Existe una única sesión de editor por proyecto activo.
- Preview y timeline permanecen visibles y montados al activar cualquier herramienta interna.
- Todas las herramientas están localizables mediante IDs estables y un catálogo único.
- Ninguna herramienta crea una copia de proyecto, selección, playhead o timeline.
- Los paneles muestran estado real y requisitos claros.
- Los controles conectados usan servicios/contratos reales.
- Las capacidades no implementadas están marcadas honestamente.
- IA y usuario utilizan las mismas operaciones tipadas.
- Jobs no dependen del ciclo de vida del panel.
- No se pierden funciones existentes.
- Se cumplen pruebas y mediciones de los documentos 09 y 16.
- Se entrega inventario exacto de componentes, tools, operaciones, servicios y brechas.

## 16. Entrega obligatoria de HY4

Por cada fase informar:

- Archivos creados/modificados y motivo.
- Componentes persistentes y sus pruebas de identidad.
- Tool IDs integrados y slots utilizados.
- Servicios reales consumidos por cada herramienta.
- Estados no disponibles y razón técnica.
- Contratos faltantes enviados a SWE 2.
- Tests ejecutados, resultado y comando exacto.
- Capturas comparables y viewport.
- Bugs pendientes, riesgo y siguiente paso.

No declarar “integrado” por mostrar el panel. Se requiere flujo real y evidencia de preview/timeline, estado y operación.

## 17. Instrucción de inicio para HY4

Comenzar por F0 y entregar el mapa real de montaje/rutas antes de refactorizar. Luego implementar F1 en cambios pequeños, reversibles y probados. Preservar el WIP del worktree. No editar Rust ni contratos backend para resolver problemas visuales. No realizar movimientos masivos de archivos. No crear otro editor. No tocar la geometría visual ya aprobada sin autorización.

La regla canónica del editor permanente es obligatoria durante todas las fases. Este documento define cómo terminar el frontend para cumplirla; no autoriza saltar directamente a una reestructuración funcional global.


## 18. Addendum F0 — hallazgos concretos de la inspección del 13-11-2026

Inspección de código, sin editar archivos de implementación:

1. `EditorWorkspace.tsx` renderiza el panel de edición (assets, preview y inspector) sólo cuando `mode === 'timeline'`. En los demás modos sustituye esa zona por `editor-mode-panel` y `modeContent`. Por lo tanto, **el Preview real no permanece montado/visible en todos los modos**.
2. La instancia de `Timeline` está declarada después de esa condición, dentro de `timeline-panel`, por lo que permanece presente dentro de una instancia estable de `EditorWorkspace` al cambiar sus modos internos. Esto no demuestra todavía que la instancia sobreviva a cambios de raíz en `WorkspaceView`.
3. `WorkspaceView.tsx` tiene ramas raíz diferentes: herramientas embebidas y modos F2 devuelven `EditorWorkspace` directamente; la vista normal `editor` devuelve un Fragment con `EditorWorkspace` y, en modo timeline, `MinimalEditor`. Al pasar entre esas ramas React puede desmontar y volver a montar el workspace completo. Debe verificarse con pruebas de identidad/mount y corregirse dentro de F1.
4. `MinimalEditor.tsx` se describe a sí mismo como réplica visual de AlaukCut. Implementa su propio `MonitorPanel`, `TimelinePanel`, `LibraryPanel` e `InspectorPanel`, usa escenas locales (`empty/media/captions/studio`) y contenido de demostración como `MEDIA_ITEMS`, estados de guardado estáticos y timecodes fijos en algunas escenas. Aunque consulta el project store para clips/playback, **no equivale al Preview + Timeline reales del editor** y no debe confundirse con una integración funcional completa.
5. `view-routing.ts` ya contiene `EDITOR_EMBEDDED_VIEWS` y `EDITOR_TOOL_HOSTS`; `EditorWorkspace.tsx` ya dispone de modos y hosts lazy para numerosas features. Consolidar esas piezas; no crear un segundo mapa paralelo.

### Prioridad F1 derivada de evidencia

- Mantener una sola raíz estable de `EditorWorkspace` para un proyecto activo, con el mismo ciclo de vida al abrir cualquier herramienta.
- Mantener montados el Preview real y la Timeline real. Los modos contextuales deben cambiar slots/paneles, no sustituir el monitor por `modeContent`.
- Determinar el destino de `MinimalEditor` como prototipo visual: integrar su diseño aprobado en los componentes reales (Preview, Timeline, Library, Inspector) o mantenerlo aislado sólo como referencia/prueba visual. No presentarlo como editor productivo ni permitir que duplique el monitor/timeline reales.
- No borrar ni reescribir `MinimalEditor` en esta etapa: su archivo está sin seguimiento en Git y puede ser trabajo activo. Requiere decisión/revisión de ownership antes de moverlo o eliminarlo.
- Antes de tocar `WorkspaceView.tsx`, `view-routing.ts` o `EditorWorkspace.tsx`, revisar sus diffs actuales y conservar todas las modificaciones existentes. En la inspección del 13-11-2026 estos archivos tenían cambios locales (EditorWorkspace: 451 inserciones y 68 eliminaciones; WorkspaceView: 17 inserciones y 8 eliminaciones; view-routing: 2 inserciones). No se modificaron.

**Gate:** no iniciar F2 ni declarar el editor permanente hasta que una prueba automatizada demuestre que Preview y Timeline conservan identidad al cambiar entre Edición, Texto, Audio, Color, VFX, Tracking, Medios, IA y herramientas del mapa.


## 19. Addendum F0 — mapa de navegación y cobertura de pruebas

### 19.1 Catálogo de navegación encontrado

`apps/desktop/src/app/navigation.ts` declara 35 identificadores de vista:

- Núcleo/flujo: `home`, `projects`, `script`, `assets`, `production`, `editor`.
- Modos directos del editor: `text-edit`, `multicam`, `mixer`, `vfx`, `nodes`, `motion`, `visuals`.
- Hosts y hubs: `download`, `creator`, `lab`, `learn`, `mcp`, `settings`, `director`, `auto-edit`, `ai-hub`.
- Alias de hubs: `youtube`, `compliance`, `factory`, `thumbnails`, `localization`, `convert`, `compress`, `denoise`, `sharpen`, `upscale`, `compare`, `background`, `record`.

La taxonomía de rutas actual en `view-routing.ts` es:

- 12 alias resueltos a 3 hubs: Download (YouTube/Cumplimiento), Creator (Fábrica/Miniaturas/Localización), Lab (Convertir/Comprimir/Denoise/Nitidez/Upscale/Comparar/Fondo/Grabar).
- 6 modos de editor resueltos directamente: Texto, Multicámara, Mezcla, VFX, Nodos, Motion y Visuales son siete identificadores; todos excepto `nodes`? **Verificar esta discrepancia en el tipo y tests antes de modificar**: el mapa `EDITOR_MODE_ALIASES` enumera text-edit, multicam, mixer, vfx, nodes, motion, visuals (7).
- 6 vistas F2 embebidas por proyecto: Script, Assets, Production, Director, Auto-edit, AI Hub.
- 7 hosts T1: Home, Projects, Download, Creator, Lab, MCP, Learn.
- Editor y Settings tienen tratamiento propio.

La suma de categorías se solapa deliberadamente (alias/hubs/modos); no tratarla como partición matemática de los 35 IDs. La prueba `view-routing.test.ts` documenta la intención del routing.

### 19.2 Cobertura de tests observada

- Existe `apps/desktop/src/app/view-routing.test.ts` para alias, modos, hosts y resoluciones.
- Existe `apps/desktop/src/app/workspace-map.test.ts` para el mapa de workspace.
- `apps/desktop/e2e/app.spec.ts` prueba arranque, navegación del rail y geometría del rail/ruta.
- La búsqueda de tests por `EditorWorkspace`, `WorkspaceView`, `Preview.*unmount`, `Timeline.*unmount`, `toolView` y `activeId` no encontró una prueba directa que afirme la identidad persistente de los hosts reales Preview y Timeline durante cambios de herramienta.

No se ejecutaron tests en esta pasada porque no se modificó código de la aplicación y el worktree está muy intervenido por cambios locales. Antes de F1, añadir pruebas de identidad/montaje sobre los componentes reales, no sólo snapshots ni comprobaciones de texto.

### 19.3 Riesgo de producto y deuda de navegación

El rail aún conserva superficies que, con proyecto abierto, deben ser evaluadas para decidir si son herramientas contextuales o flujos de preparación: Inicio, Proyectos, Descargar, Creador, Laboratorio, MCP y Aprender. No moverlas ahora: definir por cada una si actúa sobre el proyecto activo, si es una superficie global o si debe permanecer fuera de la sesión de edición.

La vista `Settings` tiene un flujo propio y puede ser un diálogo/ventana de preferencias; no debe tratarse automáticamente como una herramienta de edición.

El mapa actual normaliza muchas rutas, pero la composición en `WorkspaceView.tsx` todavía tiene ramas raíz distintas. La existencia de un mapa unificado no demuestra que el ciclo de vida React sea persistente.

**Salida F0:** mapa de IDs y alias, puntos de entrada, riesgos de composición y brecha de pruebas de identidad documentados. Próximo paso autorizado dentro de la fase actual: cerrar inventario visual y contratos de presentación; la refactorización de navegación/hosts queda bloqueada hasta aprobación explícita del frontend conforme a la decisión canónica.


### Corrección de precisión del apartado 19.1

El mapa `EDITOR_MODE_ALIASES` contiene exactamente siete IDs y siete modos: `text-edit`, `multicam`, `mixer`, `vfx`, `nodes`, `motion` y `visuals`. No hay una excepción para `nodes`; la nota de verificación anterior fue una errata de redacción. La prueba existente debe seguir validando los siete.
