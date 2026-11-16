# Unificación total — Etapa A: auditoría e inventario

**Fecha:** 2026-11-14 · **Misión:** un solo editor permanente (prompt del propietario)
**Docs leídos:** `decisions/2026-11-13-permanent-editor-surface.md`, `olyvia-blueprint/18_UNIFIED_EDITOR_PRODUCT_CONTRACT.md`, `17_PERMANENT_EDITOR_FRONTEND_BUILD_PLAN.md` (F0–F4), `16_FEATURE_ACCEPTANCE_MATRIX.md`, encabezado de `AUDITORIA-FRONTEND-ALAUKCUT-2026-11-13.md`. `00/02/11/12` consultados por secciones según necesidad — pendientes de lectura completa en Etapa C.

## 1. Estado del árbol

- Rama `architecture/refactor-foundation`, sincronizada con origin. **872 archivos modificados/sin trackear** — WIP masivo de varias líneas de trabajo (refactor de capas Rust Fase 3, HY4 frontend, esta sesión). Preservar todo; los cambios de esta misión se hacen sólo sobre archivos propios o con ownership claro.

## 2. Inventario de superficies (medido en código)

### Routing actual (`app/navigation.ts`, `view-routing.ts`, `WorkspaceView.tsx`)

- **33 `ViewId`**: home, projects, director, auto-edit, youtube, production, factory, creator, editor, text-edit, multicam, mixer, vfx, nodes, script, assets, download, record, compliance, convert, compare, compress, denoise, sharpen, thumbnails, localization, ai-hub, motion, visuals, background, upscale, lab, learn, mcp, settings.
- `HUB_ALIASES` (12): youtube/compliance→download, factory/thumbnails/localization→creator, convert/compress/denoise/sharpen/upscale/compare/background/record→lab.
- `EDITOR_MODE_ALIASES` (7): text-edit, multicam, mixer, vfx, nodes, motion, visuals → modos de `EditorWorkspace`.
- `EDITOR_EMBEDDED_VIEWS`: modos embebidos adicionales.
- `EDITOR_TOOL_HOSTS` (7): home, projects, download, creator, lab, mcp, learn → panel `tools` dentro del editor.
- `settings` → `SettingsHome` (ventana flotante, excepción deliberada).

### Duplicación conocida (UI-001)

`WorkspaceView` en `id==='editor'` monta **dos superficies**:

```tsx
<EditorWorkspace initialMode={editorMode} ... />
{hasProject && editorMode === 'timeline' && !toolActive && (
  <MinimalEditor ... />   // tapa al workspace
)}
```

- `EditorWorkspace` (WIP, ~grande): Preview real (`Preview.tsx` ~3000 líneas: `<video>` por clip, WebGL effects, audio scopes), `Timeline.tsx` pro, `Inspector.tsx`, `Transport`, modos de herramientas. **Conduce**: `usePlayback()` (rAF), `usePreviewAudio` (WebAudio), decode de video/audio.
- `MinimalEditor` (untracked, ~500 líneas + `minimal/` 9 archivos + `minimal-editor*.css`): réplica visual AlaukCut — `MonitorPanel`, `TimelinePanel`, `LibraryPanel`, `InspectorPanel`, transporte propio. Desde esta sesión: monitor con frame compuesto real (`renderPreviewFrame`), **video en vivo** para clips cubiertos sin transición/reverse/speedCurve, waveforms y thumbnails reales por clip, inspector Transform escribiendo vía `updateClip`, acciones cableadas con fallback honesto, `usePlayback()` singleton.

### Estado compartido (ya existe, NO duplicar)

`ProjectProvider` en `App.tsx` — una sola fuente para proyecto, assets, clips, playhead (`PlayheadContext`), playing, rate, direction, historial undo/redo, service Tauri. `usePlayback` ya es singleton a nivel módulo (hecho esta sesión). `renderPreviewFrame` tiene caché Rust.

## 3. Matriz de duplicaciones detectadas

| Elemento | EditorWorkspace | MinimalEditor | Acción Etapa B/C |
|---|---|---|---|
| Motor playback | `usePlayback()` (singleton compartido) | `usePlayback()` (comparte) | ✅ resuelto esta sesión |
| Preview | `Preview.tsx` completo (video+efectos+scopes) | `MonitorPanel` (img frames + `<video>` live acotado) | Minimal debe consumir el Preview real o un subconjunto honesto |
| Timeline | `Timeline.tsx` pro | `TimelinePanel.tsx` réplica | Minimal usa datos reales ya; unificar montaje |
| Inspector | `Inspector.tsx` completo | `InspectorPanel.tsx` réplica (sólo Transform escribe) | pendiente refactor grande |
| Biblioteca | `EditorAssets`/shelves | `LibraryPanel` | pendiente |
| Transporte | `Transport.tsx` | `PlaybackBar` (acciones reales) | unificar |
| Audio preview | `usePreviewAudio` (2513 líneas, WIP) | ninguno (hereda del workspace) | depende de Preview |

## 4. Lo que ya es verdad (verificado esta sesión)

- Una sola `ProjectProvider`/store para toda la app.
- `usePlayback` singleton: N consumidores = 1 rAF (test `usePlayback.test.tsx`).
- MinimalEditor es autosuficiente para playhead + video monitor (clip plano).
- Todas las `ViewId` de herramienta ya se resuelven dentro de `EditorWorkspace` (modo/hub/panel) — **no hay rutas standalone de edición**; `settings` es la única excepción deliberada.
- Tools sin proyecto tienen fallback honesto; monitor visible con monitor plegable.

## 5. Brechas honestas (estado real, no declarado)

- **Doble montaje DOM** persiste: `EditorWorkspace` sigue montado debajo de `MinimalEditor` en `id==='editor'` + timeline mode. Preview.tsx y usePreviewAudio.ts están en WIP de otro trabajo — la extracción del preview A/V es el cuello de botella de UI-001.
- Inspector mínimo: sólo Transform escribe; Cor/Audio/Animação/keyframes sin conexión (necesitan campos del schema + UI).
- Video en vivo: sólo clip que cubre playhead, sin transición/reverse/speedCurve, sin compositing de efectos; fuente cruda o proxy.
- `vitest@2.1.9` pendiente (install bloqueado por hook — requiere al usuario).
- WIP ajeno sin tocar: `object_track`, `render_diary`, `mcp_audit`, catches vacíos, `window.open`.

## 6. Diseño de integración (Etapa B propuesta)

Dirección arquitectónica recomendada (a validar antes de ejecutar):

1. **EditorSessionRoot**: un único componente raíz por proyecto activo que monte `EditorWorkspace` como shell permanente. `MinimalEditor` NO es un segundo editor — es una *skin/slot* de la misma sesión.
2. **Decisión de superficie**: dos caminos posibles —
   - **A) MinimalEditor absorbe**: portar el preview A/V (video por clip + audio) al minimal y desmontar EditorWorkspace en `id==='editor'`. Riesgo: Preview.tsx es 3000 líneas WIP con efectos/composición que el minimal no tiene.
   - **B) EditorWorkspace adopta el diseño minimal**: el minimal es la referencia visual aprobada (HY4); hacer que EditorWorkspace renderice la composición minimal pero con sus componentes productivos reales (Preview/Timeline/Inspector). Es la ruta que el contrato §6 del doc 18 sugiere: «integrar los patrones visuales aprobados en los componentes productivos».
   - **Recomendación: camino B** — la decisión canónica dice conservar el diseño aprobado pero conectar funciones reales; el minimal ya demostró que sus paneles pueden consumir estado real sin duplicar engines.
3. **Siguiente paso concreto seguro**: extraer de `Preview.tsx` un `PreviewHost` reutilizable (video+audio del clip activo) que MinimalEditor pueda montar en su `MonitorPanel` — reemplaza el `<video>` acotado actual y hereda efectos/composición. Requiere coordinar con el WIP de Preview.
4. **Tool Registry**: consolidar `EDITOR_MODE_ALIASES`/`HUB_ALIASES`/`EDITOR_TOOL_HOSTS`/`resolveViewRoute` en un descriptor único con `availability` — ya existe la mitad (`view-routing.ts`); extender con availability/selectionRequirement según doc 17 §5.
5. **Pruebas de identidad** (doc 17 F1 gate): test que monte la sesión, cambie de herramienta ≥10 veces y verifique que Preview/Timeline conservan identidad (misma instancia React) y playhead/selección/historial.

## 7. Plan de etapas siguiente

- **Etapa B1**: test de identidad de montaje (Preview/Timeline no se remontan al cambiar herramienta) — define el gate antes de mover código.
- **Etapa B2**: decisión A/B documentada con el propietario si hace falta; extracción de PreviewHost.
- **Etapa B3**: un solo árbol en `id==='editor'` (eliminar el condicional de WorkspaceView).
- **Etapa C**: inspector mínimo completo (keyframes, color, audio) + tools availability states.
- **Etapa D/E**: validación E2E Tauri con proyecto real (requisito del contrato — no declarar unificado sin esto).

## 8. Riesgos

- Preview.tsx/usePreviewAudio.ts/EditorWorkspace.tsx en WIP activo — toda extracción puede colisionar. Mitigación: cambios aditivos, archivos nuevos para hosts, coordinación por ownership.
- 872 archivos WIP: cualquier "verificación completa" es ruidosa; usar tests focalizados.
- El minimal replica geometría pixel-perfect — moverlo a componentes productivos exige comparar capturas antes/después.

## 9. Etapa B1 ejecutada (2026-11-14) — raíz única en WorkspaceView

**Hallazgos de la auditoría de montaje (medidos en código):**

1. `WorkspaceView` devolvía tipos de raíz distintos: `id==='editor'` → fragmento `<>`, herramientas → `<EditorWorkspace>` suelto. React desmontaba/remontaba el editor entero al navegar entre «editor» y cualquier herramienta.
2. `EditorWorkspace` montaba `<Preview/>`+`<Transport/>` en DOS posiciones mutuamente excluyentes (timeline vs `editor-mode-split`) → cada cambio de modo recreaba el `<video>` y reiniciaba el audio. `Timeline` sí era persistente entre modos (fuera del ternario).
3. `Timeline` ya era persistente dentro de `EditorWorkspace`; el problema era la raíz de `WorkspaceView` y el Preview duplicado.

**Cambio aplicado:**

- `apps/desktop/src/app/WorkspaceView.tsx` reescrito: todas las ramas de edición devuelven el MISMO fragmento con `EditorWorkspace` en primera posición y `MinimalEditor` condicional en segunda. Props resueltas por precedencia idéntica a la original (toolPanel > embeddedMode > editor > catch-all hosts; `settings` conserva su precedencia original detrás de toolPanel). Sin proyecto el overlay no aplica.
- `apps/desktop/src/app/WorkspaceView.test.tsx` (nuevo): 4 tests estructurales que llaman a `WorkspaceView(props)` como función pura y verifican raíz fragmento + `EditorWorkspace` único en primera posición para 26 ViewIds, `MinimalEditor` sólo en editor+proyecto+timeline+sin tool, y que activar herramienta no cambia raíz ni posición.

**Verificación:** `vitest run src/app/` → **38/38** (8 archivos, incluidos view-routing/navigation/workspace-map/workspaces/pipeline) · `tsc --noEmit` exit 0.

**Pendiente de Etapa B:**

- ~~**B2 — Preview/Transport persistentes**~~ → **ejecutada (ver §10)**.
- **B3**: eliminar el overlay `MinimalEditor` cuando la superficie única esté validada (decisión A/B del punto 6).

## 10. Etapa B2 ejecutada (2026-11-14) — Preview/Transport persistentes entre modos

**Problema:** `EditorWorkspace` montaba `<Preview/>`+`<Transport/>` en DOS posiciones mutuamente excluyentes del ternario de modos (rama timeline vs `.editor-mode-monitor` de herramientas). Cada cambio timeline↔herramienta desmontaba el `<video>`, destruía el estado del componente y reiniciaba el grafo de audio — violación directa del invariante «Preview persistente».

**Solución aplicada (quirúrgica, sin tocar Preview.tsx/usePreviewAudio.ts que están en WIP):**

- `EditorWorkspace.tsx`: el `.preview-panel` con `<Preview/>`+`<Transport/>` es ahora el **PRIMER hijo del `.editor-grid`**, fuera del ternario de modos — misma posición de reconciliación en todos los modos. Los botones de desacoplar/monitor dual quedan sólo en modo timeline (diseño aprobado); `is-detached`/`previewWindow.style` sólo aplican en timeline.
- La rama de herramientas quedó como `.editor-mode-panel` directo (se eliminó el wrapper `.editor-mode-split`/`.editor-mode-monitor` y su segundo preview-panel).
- El plegado «Monitor» ya no desmonta: el grid gana `editor-monitor-hidden` → CSS `display:none` + template de 1 columna. El `<video>` y el audio siguen vivos con el monitor oculto.
- Posición visual: `.preview-panel` ya tenía `grid-column:2; grid-row:1` explícito y TODOS los paneles del grid tienen posición explícita (asset-rail c1, splitter c3, inspector c4, timeline-panel c1/-1 fila 2, ia-coluna c6) — el reorden del DOM no altera el layout.
- `editor-tools.css`: reglas `.editor-mode-split`/`.editor-mode-monitor` reemplazadas por `.editor-grid.editor-mode-active` (2 columnas `1fr | var(--mode-monitor-width,340px)`, 280px bajo 1120px, `!important` por filmora.css) + `.editor-mode-panel` a `grid-column:1` + reglas de `editor-monitor-hidden`.

**Verificación:** `tsc --noEmit` exit 0 · `vitest run src/app/ + Transport + Timeline` **79/79** · grep: 0 referencias restantes a `editor-mode-split`/`editor-mode-monitor`.

**Residual honesto:**

- Verificación visual real (capturas antes/después, playback continuando al cambiar de modo) requiere correr la app — pendiente E2E Tauri. El razonamiento de reconciliación es sólido (mismo tipo+mismo índice de hijo en todos los modos) pero no hay test que monte EditorWorkspace completo en jsdom.
- `Inspector`/`EditorAssets` sí se desmontan al cambiar de modo (son contenido del modo, no hosts persistentes — aceptable según contrato §4: «el panel contextual puede montar/desmontar su contenido»; el inspector de clip podría evaluarse como host persistente en una pasada futura).
- `.editor-mode-panel` conserva `overflow:auto` — el modo tools con panel ancho puede necesitar revisar scroll en 1360×768 (verificación visual pendiente).

## 11. Etapa B3 — plan de migración del overlay MinimalEditor (diseño, sin ejecutar)

### Estado actual

`WorkspaceView` monta `EditorWorkspace` + `MinimalEditor` (overlay `position:absolute;inset:0;z-index:100`) cuando `id==='editor'` + proyecto + `editorMode==='timeline'` + sin tool. Consecuencias medidas:

- **Doble decodificación**: el `Preview` oculto sigue decodificando `<video>` y el `MonitorVideo` del minimal decodifica el mismo asset en vivo → 2 decoders por clip (viola §13).
- **Audio fantasma**: el audio que escucha el usuario durante playback proviene del `usePreviewAudio` del Preview OCULTO — MinimalEditor no tiene audio propio (su `<video>` va `muted`).
- **Doble timeline/inspector/biblioteca**: `TimelinePanel`, `InspectorPanel`, `LibraryPanel`, `PlaybackBar` del minimal son réplicas — algunas ya leen estado real (esta sesión), otras siguen decorativas.

### Hallazgo clave que habilita la migración

`Timeline`, `Inspector` y `EditorAssets` consumen `useProjectStore()`/`useProjectPlayback()` **directamente** (no reciben estado por props de EditorWorkspace) → son montables dentro del shell minimal sin EditorWorkspace. `Preview` igual (store + playback). El acople real está en el CSS (clases `.editor-grid`, `.timeline-panel`, variables `--timeline-height`, `--inspector-width`) y en utilidades compartidas (`requestInspectorTab`, `editorLayout`, prefs).

### Orden de migración propuesto (cada paso reversible, con verificación)

1. **P1 — Audio del minimal**: portar `usePreviewAudio` (o un subconjunto: gain por clip + transporte) a MinimalEditor. *Prerequisito de todo lo demás*: sin esto, retirar el Preview oculto deja el playback mudo. Archivo WIP (2513 líneas) → extraer hook, no reescribir.
2. **P2 — Preview real en MonitorPanel**: montar `<Preview/>` dentro de `.me-center` (o reemplazar MonitorPanel por el preview-panel productivo con skin minimal). El `<video>` live acotado actual se retira — el Preview real ya hace live playback con efectos/composición.
3. **P3 — Timeline real**: montar `<Timeline/>` en `.me-timeline` (auto-contenido; ajusta `--timeline-height`). Retirar `TimelinePanel` réplica. Verificar snapping/selección/zoom.
4. **P4 — Inspector real**: montar `<Inspector/>` en `.me-right` (con `tabRequest` cableado a las escenas del minimal). Retirar `InspectorPanel` cuando el real cubra Transform+tabs.
5. **P5 — Biblioteca real**: `EditorAssets` en `.me-left` o mantener `LibraryPanel` sólo si el real no entra en la geometría aprobada — decidir con captura comparativa.
6. **P6 — Retiro**: cuando P1–P5 verificados, `WorkspaceView` deja de montar `EditorWorkspace` en `id==='editor'`+timeline; el overlay y `MinimalEditor` se funden en UN componente (renombrar a `EditorSession` o mantener nombre). Modos de herramientas siguen en EditorWorkspace — evaluar si el shell minimal absorbe también el modo `tools` (mapa de herramientas) o si EditorWorkspace queda como "modo herramientas" del mismo árbol.
7. **P7 — Un solo árbol**: `EditorWorkspace` deja de existir como montaje separado; sus modos se convierten en paneles del shell único.

### Riesgos

- `Preview.tsx` (3000 líneas) y `usePreviewAudio.ts` (2513) en WIP activo — P1/P2 requieren cambios aditivos mínimos y coordinación.
- CSS: los componentes reales traen ~50k líneas de estilos heredados; el shell minimal usa `minimal-editor*.css` + `alaukcut-workspace.css`. La convivencia exige scoped overrides, no reescritura.
- Verificación visual obligatoria por paso (capturas 1360×768) — jsdom no valida geometría.
- Decisión de diseño pendiente del propietario: ¿el shell final es la réplica minimal (camino actual) o el workspace clásico restilizado? El contrato §6 sugiere patrones minimal → componentes productivos; este plan asume eso.

## 12. Etapa B3/P3 ejecutada (2026-11-14) — Timeline productiva dentro del shell mínimo

**Cambio:** `MinimalEditor` ya no monta la réplica `minimal/TimelinePanel` — monta la **`Timeline` real** (`features/editor/Timeline.tsx`, ~7000 líneas: split/trim/snapping/zoom/pistas/keyframes/transiciones, lee `useProjectStore`+`useProjectPlayback` directamente) vía `lazy()` dentro de `.me-timeline-real` (fila de 260 px del grid minimal, CSS nuevo en `minimal-editor.css`). La réplica queda sólo para sus tests unitarios.

**Estado compartido verificado por tests:**
- Clips reales `.timeline-clip` posicionados por `startFrame`/`pxPerFrame` (test reescrito: 2 clips, orden por `style.left`).
- Selección por `pointerDown` en clip real → `store.selection` → el inspector réplica sigue leyendo `selectedClipTransform` y `commitTransform` escribe vía `updateClip` (test e2e transform 45° verde).
- Toggle «timeline magnética» real (`aria-pressed`) operativo — sustituye al botón «Imã» de la réplica (que sólo existía en su toolbar).
- Playhead real `.playhead-grip` (`role=slider`, ArrowLeft/Right/Home/End → `store.setPlayhead`) — sustituye a la regla réplica «Posición de reproducción».

**Verificación:** `MinimalEditor.test` 7/7 · `MinimalEditor.actions` 6/6 · suite `minimal/` + usePlayback 13/13 · `tsc --noEmit` exit 0.

**Residual honesto:**
- **Verificación visual pendiente**: la Timeline real trae su propio cromo (toolbar, headers de pista, ruler) — dentro de la fila de 260 px del shell minimal puede necesitar ajustes de CSS (`--timeline-height` no aplica aquí; el resize handle interno pelea con la fila fija). Capturas 1360×768 pendientes.
- `minimal/TimelinePanel.tsx` queda como código muerto de producción (sólo sus tests lo usan) — candidato a retiro en Etapa D.
- El audio sigue viniendo del Preview oculto (P1 pendiente) y el monitor sigue siendo la aproximación composed+live (P2 pendiente).

## 13. Etapa B3/P4 ejecutada (2026-11-14) — Inspector productivo dentro del shell mínimo

**Cambio:** `MinimalEditor` ya no monta la réplica `minimal/InspectorPanel` — la tercera columna del cuerpo (`.me-inspector`, CSS nuevo en `minimal-editor.css`) monta el **`Inspector` real** (`features/editor/Inspector.tsx`, ~7000 líneas: ClipInspector con tabs video/audio/speed/trim/animation/color/style/mask, TrackInspector, CueInspector, AssetInspector, SceneInspector, ProjectInspector) vía `lazy()`. Lee `store.selection` directamente — selección de clip/track/cue/asset/scene desde la Timeline real abre el inspector correcto sin puente.

**Decisiones:**
- El bridge `clipTransform`/`commitTransform`/`selectedClipTransform` de la réplica se eliminó (el Inspector real escribe vía `store.update`+`updateClip` con keyframes, máscaras, color, etc. — infinitamente más que el transform estático).
- «Pedir ao assistente» ya no abre la pestaña mock del assistant (chat hardcodeado de la réplica): navega a `ai-hub` — el modo de asistente del MISMO editor (EXIT del shell mínimo → EditorWorkspace con Preview/Timeline persistentes, comportamiento unificado correcto). `onOpenAssistant` de las acciones también apunta ahí.
- Estado `inspector`/`INSPECTOR_IDS`/`?inspector=` del boot eliminados; `changeScene` (sólo arnés) ya no conmuta tabs de inspector — la escena sólo gobierna monitor/biblioteca.
- `minimal/InspectorPanel.tsx` queda sólo para sus tests unitarios (candidato a retiro Etapa D, junto a TimelinePanel).

**Verificación:** test transform reescrito — pointerDown en `.timeline-clip` real → spinbutton «Rotación» del TransformSection real → `fireEvent.change`+`focusOut` → `clip.transform.rotationDeg === 45` en el store. `MinimalEditor.test` 7/7 · actions 6/6 · `minimal/` 13/13 · `tsc --noEmit` exit 0.

**Residual honesto:**
- **Doble montaje transitorio**: en `id==='editor'`+timeline el overlay minimal y el EditorWorkspace siguen montados a la vez → hay DOS Timeline y DOS Inspector reales en el DOM (uno oculto bajo el overlay). Es el costo documentado del camino incremental; P6/P7 lo resuelven retirando el overlay.
- El Inspector real trae tabs propios (video/color/mask…) que reemplazan las tabs de escena del arnés — las escenas `color-*`/`audio-*`/`anim-*` del inspector réplica ya no tienen equivalente visual en el shell (eran maqueta sin escritura).
- Verificación visual 1360×768 pendiente: el Inspector real dentro de 312 px puede necesitar ajustes de densidad.

## 15. Etapa B3/P5 ejecutada (2026-11-14) — Rail de assets productivo dentro del shell mínimo

**Cambio:** `MinimalEditor` ya no monta la réplica `minimal/LibraryPanel` — la primera columna del cuerpo (`.me-library`, CSS nuevo) monta el **`EditorAssets` real** (~2300 líneas: pestañas media/audio/efectos/transiciones/filtros/plantillas/stickers/títulos, búsqueda, bins, favoritos, proxies) vía `lazy()`. Es el mismo rail del workspace — misma tienda, mismos stores.

**Decisión de flujo de importación (importante):** el botón «Importar» del rail productivo **no importa inline** — llama `onNavigate('assets')` → modo `assets` del MISMO editor → `AssetsPanel` (`features/assets/`), que sí tiene el consentimiento de derechos y `service.importAssets` reales. Es el comportamiento unificado correcto: la biblioteca profunda vive en el modo assets del editor, no en un segundo diálogo del shell. En el shell mínimo `onNavigate` llega por props desde `Shell.navigate`.

**Limpieza:** eliminados `addToTimeline`, `handleTab`, estados `activeTab`/`subtitleStyle`, `BOOT.activeTab`, import de `addClipFromAsset`/`LibraryPanel`. `selectedId`/`selectedAsset`/`realThumb` se conservan: alimentan el `monitorSrc` (miniatura del asset seleccionado en el monitor).

**Tests actualizados al contrato nuevo:**
- «Importar pide consentimiento…» → «el rail navega a Importar del mismo editor»: click en «Importar» → `onNavigate('assets')` (spy).
- Nuevo: «el rail muestra los materiales reales del proyecto» — asset real visible en el rail.
- «diez categorías» (réplica) → «monta el rail de assets real y conserva el monitor».
- Test de rotación: waits explícitos para los lazy chunks (Inspector ~7k + EditorAssets ~2k líneas).

**Verificación:** `MinimalEditor.test` 7/7 · actions 6/6 · `minimal/` 13/13 · `tsc --noEmit` exit 0.

**Residual honesto:**
- `actions.requestImport`/`importMedia`/`ConsentDialog` quedaron **código muerto** en el shell mínimo (nadie los dispara desde P5) — candidatos a retiro en Etapa D; el consentimiento real vive en `AssetsPanel`.
- Las escenas del arnés `captions`/`studio` pierden sus demos de biblioteca (estilos de subtítulo, ítems de estudio) — eran maqueta; las funciones reales están en CueInspector/EditorAssets.
- Doble montaje transitorio continúa (rail+inspector+timeline ×2 bajo el overlay) hasta P6/P7.
- Verificación visual pendiente: EditorAssets dentro de 366 px puede requerir ajustes de densidad.

## 16. Análisis P1/P2 (2026-11-14) — por qué NO se monta un segundo Preview y la ruta corregida

**Hechos verificados en código:**
- El audio de preview **no es un hook aparte**: `Preview.tsx` llama funciones module-level de `features/mixer/usePreviewAudio` (`attachPreviewAudio`, `syncPreviewAudioFromProject`, `resumePreviewAudio`…). Montar `<Preview />` traería audio incluido — no hay nada que portar.
- **No existe suspensión por visibilidad**: ni `Preview.tsx` ni `usePreviewAudio.ts` tienen `visibilitychange`/`IntersectionObserver`/`document.hidden`. El Preview del workspace, oculto bajo el overlay `.minimal-editor` (`inset:0; z-index:100`), **sigue decodificando vídeo y sonando** — hoy el audio que escucha el usuario en el shell mínimo proviene de ese Preview escondido (funciona, pero es el único camino de audio).
- `usePreviewAudio` es un mixer **singleton a nivel módulo** indexado por `trackId`: dos `<Preview />` montados a la vez se pisarían (`attach`/`detach` sobre los mismos tracks) → audio corrupto o duplicado.
- El CSS para montar Preview dentro de `.me-monitor` **ya existe** (`minimal-editor.css:445-461`: `.preview-stage` a 100% y chrome oculto) — quedó preparado, pero montarlo así crea la duplicación prohibida.

**Conclusión:** P2 «montar `<Preview />` dentro del overlay» es inviable sin violar «un solo decodificador / un solo motor de audio». La ruta correcta es **invertir la consolidación**:

- **P6 redefinido**: en vez de «retirar EditorWorkspace del camino timeline», el shell AlaukCut (`.me-*` chrome: topbar, monitor con reglas, foot de transporte, footer) se porta **dentro** de `EditorWorkspace` modo timeline — los componentes reales (Preview, Transport, Timeline, Inspector, EditorAssets) ya están montados una sola vez ahí; sólo cambia la presentación a la geometría AlaukCut aprobada.
- `MinimalEditor` y sus paneles réplica (`MonitorPanel`, `PlaybackBar`, `Overlays`, escenas de arnés) se retiran en Etapa D una vez que el layout AlaukCut viva en el workspace.
- Beneficio extra: se elimina el doble montaje actual (rail+inspector+timeline×2) y el Preview oculto que decodifica al pedo — de una vez.
- Alternativa evaluada y descartada: renderizar `MinimalEditor` *en lugar* de `EditorWorkspace` en modo timeline — rompería la persistencia Preview/Timeline al entrar a un modo herramienta (B2) y exigiría re-embeber los modos dentro del shell.

**Estado de P1/P2:** audio = ya funciona (vía Preview del workspace); preview real en el monitor = **bloqueado por diseño hasta P6** — no es un pendiente de código, es una decisión de arquitectura ya tomada y documentada.

## 17. Etapa P6-a ejecutada (2026-11-14) — chrome AlaukCut dentro de EditorWorkspace (timeline)

**Cambio:** nuevo `features/editor/AlaukChrome.tsx` — `AlaukTopBar` + `AlaukFooter`, montados en `EditorWorkspace` **sólo en modo timeline** (clase `alaukcut` en `.editor-workspace`). CSS propio `.alauk-*` en `minimal-editor.css` §9 (mismas variables/valores que `.me-*`, scope propio — no depende de `.minimal-editor`).

**Sólo acciones reales** (nada de maqueta):
- «Projetos» → `onNavigate('projects')` · proyecto nombre centrado · estado de guardado (`phase`/`lastSavedAt` del store).
- «Edição automática» → `switchMode('auto-edit')` · «Atalhos» → `onOpenShortcuts` · «Exportar» → `store.requestExport()` (abre el ExportDialog existente).
- Footer: recuentos reales `assets.length`/`clips.length` + estado de guardado.

**Detalle de layout:** `.editor-workspace` es `display:grid` con filas `auto 1fr`; `.alaukcut` fija `grid-template-rows: auto auto minmax(0,1fr) auto` para [topbar, mode-tabs(ocultas en immersive), grid, footer]. No se tocaron Preview/Timeline/Inspector/Assets — los componentes únicos siguen montados una vez.

**Verificación:** `AlaukChrome.test.tsx` 4/4 (navegación, atajos, auto-edit, exportRequested del store, recuentos) · suite `src/app/` 38/38 · `tsc --noEmit` exit 0.

**Pendiente P6:** monitor con marco/reglas `.me-monitor`, transporte con look `.me-monitor-foot`, integración visual completa y **verificación con capturas** (jsdom no valida geometría). La retirada del overlay `MinimalEditor` (P6-b/P7) sigue pendiente — el doble montaje continúa hasta que el shell AlaukCut cubra también los modos herramienta.

## 18. Etapa P6-b ejecutada (2026-11-14) — tema AlaukCut del monitor y transporte

**Cambio:** CSS scoped `.editor-workspace.alaukcut` en `minimal-editor.css` §10 — recolorea `.preview-panel`, `.transport` (botones, rate, scrub, readout) y `.timeline-panel` a la paleta AlaukCut (`#17161b`/`#1f1e25`/`#2a2931` + acento `#2adaba`).

**Decisión honesta:** el `Transport` real se conserva completo (scrub, rate, readout, loop) — es un superset del pie de AlaukCut; la directiva prohíbe simplificar funcionalidad. Las reglas decorativas `.me-ruler-*` del monitor réplica **no se portan**: eran marcas falsas sin datos reales.

**Verificación:** CSS balanceado (180/180 llaves); sin cambios TS — `tsc` y tests no aplican. **Verificación visual PENDIENTE y bloqueada**: el chrome sólo se monta con proyecto abierto; jsdom no tiene proyecto real y el flujo completo requiere Tauri o un proyecto sembrado — registrar como pendiente de la validación E2E.

## 19. Verificación visual real en Tauri + fix de overflow (2026-11-14)

**Runtime:** `npm run tauri:dev` desde la raíz del repo (NO desde `apps/desktop`: el script de workspace invoca `tauri dev` sin el wrapper `scripts/rust-env.mjs` → sin MSVC/FFmpeg en env → `whisper-rs-sys` falla en cmake "No CMAKE_C_COMPILER"). Con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` el WebView2 expone CDP y Playwright (`chromium.connectOverCDP`) mide el DOM real: geometría, computed styles, conteos de montaje. Proyecto real restaurado: «Demo E2E» (58 clips → `.timeline-surface` de 11 615 px).

**Bug crítico encontrado (sólo visible en runtime real):** la columna implícita del grid de `.minimal-editor` (`grid-template-columns: none` → `auto`) tomaba el min-content del `.me-timeline-real` — la Timeline real sin clamp aportaba ~11 615 px → la columna quedaba en 11 625 px y monitor (x≈5566), inspector (x≈11313) y footer desbordaban el viewport de 1360 px. jsdom no detecta geometría: los tests estaban verdes con el layout roto.

**Fix (`minimal-editor.css` §5):** `.me-timeline-real` con `min-width:0; overflow:hidden` y regla `.minimal-editor > * { min-width:0; min-height:0 }` — la superficie de la Timeline scrollea dentro de su propio `.timeline-scroll` (verificado: scrollWidth 11 615 / clientWidth 1 350).

**Geometría post-fix medida a 1360×720:**

| Región | Medición | Referencia AlaukCut |
|---|---|---|
| topbar | 1360×32 @ y0 | barra superior fina ✓ |
| library rail | 366×391 @ x0 | rail izquierdo ✓ |
| monitor | 554×303 centrado en columna de 682 | monitor 16:9 con bandas ✓ |
| transport | 681×32 bajo el monitor | pie de monitor ✓ |
| inspector | 312×391 @ x1048 | panel derecho ✓ |
| timeline | 1360×260 @ y423 | timeline inferior fija ✓ |
| footer | 1360×37 @ y683 | barra de estado ✓ |

**Paleta verificada (computed style):** topbar `rgb(16,16,20)` · paneles `rgb(31,30,37)` · timeline `rgb(23,22,27)` · monitor `#000` · botón Exportar `rgb(42,218,186)`/`rgb(6,35,31)` — coincide con las variables `--me-*` de la réplica.

**Contenido real verificado en el overlay:** `.asset-rail` con 9 categorías productivas (Medios, Audio, Texto, Stickers, Efectos, Transiciones, Filtros, Ajustes, Plantillas — cubre funcionalmente las tabs de AlaukCut), `aside.inspector` con `.inspector-body` poblado, monitor con img/canvas de frame real, 18 `.timeline-clip` dentro de `.me-timeline-real`.

**Estado de duplicación (medido, no inferido):** `.editor-workspace`×2 (la raíz del overlay comparte la clase), `aside.inspector`×2, `.asset-rail`×2, `playheadGrip`×2 — el workspace oculto sigue montando Preview (única fuente de audio hoy), Transport y Timeline. Es el doble montaje conocido: se retira en P7 cuando el chrome AlaukCut cubra los modos herramienta y el overlay deje de existir.

**Tests arreglados en la misma pasada:** `MinimalEditor.test.tsx` y `MinimalEditor.actions.test.tsx` recibieron `beforeAll` que precalienta los chunks lazy (`import('./EditorAssets'|'./Inspector'|'./Timeline')`); sin eso, el transform de `Inspector.tsx` (~7k líneas) bajo carga de CPU (cargo compilando) superaba los timeouts de `waitFor` y 3 tests fallaban de forma intermitente. 13/13 verde post-fix.

## 20. P7 — retiro del overlay MinimalEditor + tema AlaukCut definitivo (2026-11-14)

**Cambio estructural:** `WorkspaceView` ya no monta `MinimalEditor` en el camino editor+timeline; el `EditorWorkspace` es la única superficie. `AlaukChrome` (`AlaukTopBar`/`AlaukFooter`) absorbe las acciones globales que el overlay proveía — paleta `Ctrl+K` (`onOpenPalette` prop nueva WorkspaceView→Shell→EditorWorkspace), Exportar (`store.requestExport`), atajos y auto-edit — y `.app-shell.editor-immersive` oculta la topbar global cuando el chrome está activo. Se acabó el doble montaje: un solo Preview (y su audio), una sola Timeline, un solo Inspector, un solo EditorAssets.

**Tests:** `WorkspaceView.test` actualizado al nuevo contrato (el overlay sólo existe en el camino viejo sin chrome); `src/app/` 38/38 · `AlaukChrome.test` 4/4 · MinimalEditor 13/13 · `tsc --noEmit` exit 0.

**Verificación real Tauri+CDP** (misma sesión que §19, proyecto «Demo E2E», 1360×720, modo timeline): `.minimal-editor`=0, `.editor-workspace.alaukcut`=1, inspector/asset-rail/preview/transport/timeline-panel=1 c/u, 18 clips, `scrollWidth===innerWidth`. Geometría medida: topbar 1360×32 · rail 326×412 · preview 693×412 · transport 692×32 · inspector 340×412 · timeline 1360×248 · footer 1360×28 — la distribución AlaukCut sobre los componentes productivos. Captura: `target/olyvia-p7-final.png`.

**Guerra de especificidad CSS resuelta con evidencia CDP:** `CSS.getMatchedStylesForNode` mostró que el play button rojo venía de `.app-shell .transport-button.primary-transport { background: var(--fm-accent) !important }` (filmora) y el transport navy de `var(--fm-bar-2)/var(--fm2-canvas) !important` — el preset custom del usuario fija esos alias en rojo fuera del editor. Fix en `minimal-editor.css` §10: overrides de los alias (`--fm-accent`, `--fm-accent-hover/ink`, `--fm-bar`, `--fm-bar-2`, `--fm2-canvas`, `--chrome-2`, `--commercial-accent`, `--olyvia-accent`, `--olyvia-panel`) scoped a `.editor-workspace.alaukcut`, `!important` donde la cascada lo exige, y selectores `.transport-button.primary-transport` para empatar especificidad con `data-theme='dark'`. Resultado medido: preview `#0d0c0f`, paneles/transport/timeline `#17161b`, play `#2adaba`/`#06231f`, rail tabs `#1f1e25`.

**Residual honesto:** `MinimalEditor.tsx` y los paneles réplica (`minimal/*`) quedan como código muerto de producción — sólo sus tests los importan; retiro en Etapa D. Los modos herramienta conservan su cromo propio bajo el workspace (el chrome AlaukCut hoy sólo aplica a timeline); extenderlo es trabajo de P8 si se decide. E2E del contrato unificado sigue abierto para otros flujos (import real, edición con resultado visible, export).

## 21. P8-b — un solo chrome en TODOS los estados + gate de identidad (2026-11-14)

**Punto de partida medido.** El WIP de P8 ya montaba `AlaukTopBar`/`AlaukFooter` en los 17 modos (`editor-surface.ts` → `.alaukcut-chrome`) y ocultaba la `.topbar` clásica. Dos brechas seguían abiertas:

1. `AppShell` calculaba `immersive = editorSurface && Boolean(project)`. Sin proyecto el rail (`.sidebar`) y la `.app-statusbar` clásicos seguían visibles: la app arrancaba con chrome híbrido (topbar AlaukCut + rail viejo + dos barras de estado), contra la regla «todo en el mismo editor».
2. Con proyecto en `timeline`, `alaukcut-workspace.css` oculta `.editor-mode-tabs` (`editor-immersive`) y el rail ya no está: no había acceso directo al mapa de herramientas desde la barra del editor. Quedaban sólo Ctrl+K y atajos.
3. No existía el gate F1 del doc 17: ningún test montaba la app real y verificaba que cambiar de herramienta conserva la identidad de Preview/Transport/Timeline. `App.test.tsx` además tenía 13 tests en rojo con el contrato viejo (arranque en Inicio, diálogo `Configuración`, ventana flotante de Ajustes, doble botón `Guardar`).

**Cambios aplicados (aditivos, sin segunda superficie):**

- `styles/minimal-editor.css` §P8: se ocultan `.topbar`, `.app-body > .sidebar` y `.app-statusbar`, y se colapsa la columna del rail, siempre que exista `.editor-workspace.alaukcut-chrome` — con y sin proyecto. Se acota a `:root:not([data-editor-skin='full'])` para que el toggle «Vista» siga siendo el escape hatch que devuelve el cromo clásico. **No** se fuerza `editor-immersive`: esa clase además oculta las pestañas de modos en timeline, que sin proyecto son la puerta a las herramientas (ADR-0006 §3).
- `features/editor/AlaukChrome.tsx`: nuevo botón «Herramientas» (`onOpenTools`, `Icon layers`) en `AlaukTopBar`, disponible en todos los modos. `EditorWorkspace` lo cablea a `switchMode('tools')` en ambas ramas (con/sin proyecto). Es la puerta directa al mapa de herramientas del MISMO editor.
- `app/unified-editor.contract.test.tsx` (nuevo): 4 tests de contrato sobre la app real — un solo `.editor-workspace.alaukcut-chrome`/topbar/footer, sin `MinimalEditor` ni `StartScreen` ni diálogo de Ajustes; **identidad de nodo DOM** de `.preview-panel`, `.transport` y `.timeline-panel` a lo largo de 11 cambios de modo (Mezcla, Motion, VFX, Texto, Guion, Medios, Producción, Automático, AI Hub, Todo, Edición); el botón «Herramientas» conmuta a `tools` sin crear otra superficie; Ajustes es un panel dentro del workspace.
- `App.test.tsx`: 13 tests migrados al contrato unificado. Helpers: `createProject` usa `findByRole` (el panel Proyectos es lazy dentro del editor) y `openAiHub` usa la pestaña de modos en vez del diálogo de Ajustes. Los clics «Guardar»/«Buscar» se scopan al `role=toolbar[name="Barra del editor"]` para no confundirlos con los botones del topbar clásico (presente en el DOM, oculto por CSS en el browser).

**Verificación:**

- `npm run typecheck`: exit 0.
- Suite focalizada (App + WorkspaceView + contrato + AlaukChrome + editor-surface): **5 archivos / 97 tests verdes**, 0 fallos.
- Chrome real vía Playwright sobre el dev server (1360×768, estado vacío, `target/_unified-visual.mjs`): `.editor-workspace.alaukcut-chrome`=1, `.alauk-topbar`=1, `.alauk-footer`=1, `classicTopbarDisplay`/`sidebarDisplay`/`statusbarDisplay`=`none`, `.editor-mode-tabs`=`flex`, `app-body`=`1360px` (una columna), `overflowX`=0, `pageerror`=[]. A/B con `data-editor-skin='full'`: los tres vuelven a `flex` y el workspace sigue siendo único. Clic en «Herramientas» → `data-editor-mode='tools'`, un solo workspace, footer visible 1360×28, `overflowX`=0. Capturas: `target/olyvia-unificado-vacio.png`, `target/olyvia-unificado-herramientas.png`.
- `npm run build --workspace=apps/desktop` falló por el guardia de borrado seguro del entorno al vaciar `dist/assets` (115 archivos > umbral 50), NO por código; se repitió con `--outDir` limpio.

**Honestidad / residual:**

- `alaukcut-reference.css` oculta `.alauk-footer` en modo `timeline` (fidelidad a las capturas 146–160, que no muestran pie). El footer está en el DOM pero mide 0×0 ahí; es visible en los otros 16 modos. No se cambió: es decisión de diseño previa, no regresión de esta pasada.
- `.editor-mode-tabs` es `position:fixed` al pie por hojas anteriores (`editor-clarity`/`filmora`): en el estado vacío se ve como una tira «Edición» abajo. Con proyecto `editor-immersive` la oculta; el nuevo botón «Herramientas» y Ctrl+K cubren la navegación.
- La réplica `MinimalEditor` + `minimal/*` sigue empaquetada (código muerto de producción) — Etapa D.
- `vitest@2.1.9` sigue pendiente (install bloqueado por hook, requiere OK del usuario).
- Sin commit/push, sin instalar ni reemplazar la app en ejecución, sin regenerar snapshots e2e.

### 21.1 · Segunda tanda: tests de contrato viejo fuera de `App.test.tsx`

La primera corrida de `npm run test:serial` dio **9 fallos / 3067 tests en 5 archivos**. Ninguno estaba en los archivos modificados por esta pasada: son aserciones del WIP de la enmienda 14:16 que quedaron sin migrar. Se migraron al contrato unificado:

| Archivo | Aserción vieja | Contrato nuevo |
|---|---|---|
| `app/view-routing.test.ts` | `EDITOR_TOOL_HOSTS.size === 7` y `settings` NO es panel | 8 hosts, `settings` resuelve `{view:'settings'}` dentro del editor |
| `components/MenuBar.test.tsx` (4) | primer ítem de Archivo = «Pantalla de inicio» | «Nuevo proyecto…» (el launcher se retiró) |
| `features/home/HomeView.test.tsx` | `HomeView` se monta al arrancar la app | se audita el componente en sí (`renderHome`); Inicio es un host del modo «Todo» |
| `a11y/a11y-shell.test.tsx` (2) | axe sobre «Estudio Web» al arrancar y sobre el diálogo `Configuración` | axe sobre Inicio navegado dentro del editor y sobre el panel de Ajustes; se verifica que NO hay diálogo |
| `features/emoji/EmojiPicker.focus.test.tsx` | trampa de foco | **sin cambios**: pasa aislado, falló sólo bajo carga de la suite serial (flake conocido de CPU/timing) |

Verificación focalizada de los 5 archivos tras la migración: **27/28** (el restante era la última aserción de `settings`, corregida) → `view-routing.test.ts` 7/7 aislado.

**Estado global final:** `npm run test:serial` → **344 archivos pasados / 1 skipped, 3064 tests pasados / 3 skipped, 0 fallos**, exit 0 (518,92 s). `npm run typecheck` exit 0. `vite build --outDir` limpio exit 0 (17,97 s; únicos avisos los de chunk >300 kB, preexistentes). El `npm run build` estándar sigue bloqueado por el guardia de borrado seguro del entorno al vaciar `dist/assets` (115 archivos > umbral 50) — límite del entorno, no del código.
