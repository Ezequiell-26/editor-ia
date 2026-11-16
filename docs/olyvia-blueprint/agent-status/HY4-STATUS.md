# Estado de HY4 — Frontend de Olyvia

Estado: **FASE VISUAL + FASE DE EDICIÓN FÁCIL COMPLETADAS Y VERIFICADAS**. No se declara el
frontend «terminado» en el sentido del brief original (§12 catálogo completo / shell unificado
de 6 áreas): ver §6 «Alcance real y honesto» y §11 para la última fase.
Worktree/branch: `D:\Users\ofici\QODER-WORK\editor-ia-architecture` · `architecture/refactor-foundation`
Última actualización: 2026-11-11 (segunda pasada, tarde).

## 1. Descubrimiento (2026-11-08/09)

- Leídos íntegramente: `HY4_EXECUTION_BRIEF.md`, README, 01, 02, 05, 09, 11, 12, 13, 14, 15, 16,
  `agent-status/SWE2-STATUS.md`, `AUDITORIA-FRONTEND-2026-11-07.md` y `APP-FEATURE-AUDIT.md`.
- `apps/desktop/src` contiene ~608 ficheros TS/TSX, 41 CSS y 40 áreas `features/`. La app **ya
  tenía** shell, 11 vistas primarias, 36 `ViewId`, editor profesional (Timeline 3246 líneas,
  Preview 1692, Inspector 7010), monitor, inspector, biblioteca, producción autónoma, MCP,
  ajustes y asistente.
- **Suite de regresión grande y estricta**: `App.test.tsx` (77 KB) afirma las 11 etiquetas del
  rail, 3 separadores y los nombres de menú; `css-audit.spec.ts` compara capturas pixel-perfect
  de 13 vistas. Cualquier sustitución del shell rompe esos tests. Por eso todo el trabajo de
  HY4 es **aditivo** y se monta encima del código existente.
- Baseline `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0** (2026-11-09).
- SWE 2 tiene cambios locales sin confirmar en `apps/desktop/src-tauri/**`, `packages/project-schema/**`
  y otros. HY4 **no toca esos archivos**.

## 2. Contratos REALES disponibles (fachada `DesktopService`)

`services/project-service.ts` → `services/contracts.ts` → `platform/tauri/native-service.ts`.

| Dominio | Métodos reales consumibles |
|---|---|
| Proyectos | `createProject`, `openProject(At)`, `saveProject(As)`, `closeProject`, `importAssets`, `importMediaPaths`, `qualityGateReview`, `checkAssetFiles`, `findMissingAssets`, `relinkAsset*`, `listProjectVersions`, `restoreProjectVersion`, `findDuplicateAssets`, `packageProject` |
| Producción | `productionCreate/Status/List/Resume/Cancel/Remove/Advance/Start/Pause`, `catalogSearch/Get`; `buildProductionPlanFromProject`, `advanceProductionRun` |
| Proveedores/IA | `getProvider`, `saveProvider`, `clearProviderKey`, `testProvider`, `getAudioProvider`, `saveAudioProvider`, `generateScript`, `generateVideoEffect`, `generateMotion`, `assistantChat`, `assistantChatStream`, `cancelAssistantChat` |
| Capacidades | `listCapabilities(): CapabilityInfo[]`, `listModels/downloadModel/deleteModel`, `systemInfo`, `exportCapabilities`, `hardwareEncoders` |
| MCP | `listMcpServers`, `saveMcpServer`, `deleteMcpServer`, `probeMcpServer`, `callMcpTool`, `closeMcpSession`, `mcpSessionStatus`, `mcpServerStatus`, `startMcpServer`, `mcpDetectClients`, `mcpAutoconnect`, `listPlugins`, `setPluginEnabled` |
| Render/entrega | `startRender(To)`, `cancelRender`, `activeRender`, `onRenderProgress`, `onRenderFinished`, `verifyExport`, `renderQueueLoad/Save/ClearFinished`, `revealOutput`, `chooseExportDirectory` |
| Medios | `catalogSearch/Get`, `mediaThumbnail`, `analyzeMedia*`, `createVideoProxy`, `proxyStatus`, `ensureProxy`, `cancelProxy`, `applyProxyToAsset`, `cleanupProxies`, `detectScenes`, `convertMedia*`, `compressMedia`, `removeBackground*` |
| Audio/texto | `listVoices`, `synthesizeNarration`, `transcribeAsset`, `audioPeaks`, `analyzeMixLoudness`, `audioScopeAnalyze*`, `extractSubtitles`, `exportSubtitles` |
| Integraciones | `flowGenerateImage`, `flowBrowserStatus/Launch/Stop`, `flowEmbedStatus`, `screenRecord*`, `obsScene*`, `stickmanRender`, `notifyUser`, `openExternalUrl` |

**NO existe** (la UI debe mostrar «No disponible» y pedir contrato a SWE 2; ver §11 del
handoff): generador genérico de imagen/vídeo/música/voz por adaptador, envelope de job unificado
con `canPause`/`canCancel`, eventos `job.*`, capability registry enriquecido, `credentialState` en
DTO de credenciales, permisos por herramienta MCP, `expectedRevision`/`operationId` en
operaciones de proyecto.

## 3. Archivos propios de HY4 (estado final del árbol)

| Fichero | Estado | Qué hace |
|---|---|---|
| `apps/desktop/src/styles/capcut-ui.css` | Nuevo (29 KB) | Capa visual global: paleta grafito/teal medida de las capturas de CapCut, tokens, topbar, rail, tarjetas, botones, inputs, monitor, inspector, timeline. Sólo `data-theme='dark'`. |
| `apps/desktop/src/styles/capcut-editor.css` | Nuevo (23 KB) | Capa de geometría y comprensión del editor: proporciones del grid, pestañas icono+etiqueta, cabeceras rotuladas, barra del monitor, biblioteca, timeline, media queries 1320/1280. Sólo `data-theme='dark'`. |
| `apps/desktop/src/main.tsx` | Modificado (2 líneas) | Importa las dos capas **al final** de la cadena CSS, después de `layouts.css`. No se modifica ninguna otra línea. |
| `docs/olyvia-blueprint/agent-status/HY4-STATUS.md` | Este fichero | Estado real. |
| `docs/olyvia-blueprint/11_FRONTEND_BACKEND_HANDOFF.md` | Sección 24 añadida | Nota de contrato de HY4. |
| `docs/olyvia-blueprint/screenshots/hy4/*` | 14 PNG + 2 JSON | Capturas reales y métricas de geometría. |

**Se conserva sin tocar** `apps/desktop/src/styles/capcut.css` (preset opcional `data-preset='capcut'`
de otro agente) y `styles/layouts.css` (layouts alternativos `layout-shorts` / `layout-edicion`,
excluidos explícitamente de la nueva capa). El tema claro y los presets de Apariencia siguen
intactos: los selectores nuevos están acotados a `:root[data-theme='dark']` y no pisan
`--font-ui` / `--radius-*`, que siguen siendo configurables por el usuario.

## 4. Redirección de prioridad del usuario

En turnos posteriores el usuario pidió: (a) analizar `alaukcut.com/es/` y 4 capturas locales de
CapCut en `D:\Users\ofici\Pictures\Screenshots`, (b) que la app se parezca a CapCut, y (c)
«mejores y arregles todo el editor que todo esté bien posicionado». Se extrajo la paleta exacta
de las capturas (`#1c1c1c` chrome, `#262626`/`#303030` superficies, `#00c1cd` acento, `#4fe3ec`
texto activo) y se priorizó la **geometría y comprensión del editor** sobre el shell unificado.

`alaukcut.com/es/` resultó ser una **landing de marketing** (no una app viva); la referencia útil
fue la captura del editor embebida y las 4 capturas locales de CapCut.

## 5. Defectos MEDIDOS y corregidos (1360×768 / 1280×720)

Todos los valores salen de scripts de medición reales sobre el DOM (`.tmp-ref/audit-layout.mjs`,
`.tmp-ref/measure*.mjs`), no de estimación visual.

| # | Defecto | Antes | Después |
|---|---|---|---|
| 1 | `filmora-polish.css` fijaba la columna de medios en 590px → monitor 381px y `.preview-tools` desbordaba hasta x=1561 en un viewport de 1360 | monitor 381px, toolbar fuera de pantalla | monitor 693px (1360) / 687px (1280); `scrollWidth == clientWidth`, 0 controles recortados |
| 2 | 9 pestañas de herramientas con etiqueta oculta (`font-size:0` / `span{display:none}`) | iconos sin texto | icono **+ etiqueta**, scroll horizontal con barra y fundido visibles |
| 3 | `.rail-head` altura 32px con 50px de contenido: «Importar / Grabar» caían en y=145…169 y se solapaban con la búsqueda (y=151) | solapamiento real | cabecera de 52/48px en dos filas reales; sin solapamiento |
| 4 | Biblioteca de medios con 98px para tarjetas de 113px; 3 tarjetas se extendían hasta y=638 fuera del panel (y=507) | 98px | **185px** (1360) / **194px** (1280), con scroll vertical propio y `align-content:start` |
| 5 | Panel de medios con sólo 180px útiles (125px a 1280) por el árbol de categorías de 118px | 180 / 125px | 207 / 187px, árbol compactado sin perder la jerarquía |
| 6 | `.preview-topbar` absoluta (y=34…93) tapaba 41px del vídeo (`.preview-canvas` y=52) | 41px tapados | `padding-top: 68/65px` en el stage; barra integrada como cabecera (sin borde flotante), vídeo completo y centrado |
| 7 | `.timeline-tabs` (y=732) y `.fm-quick-tools` (y=744) absolutas se dibujaban sobre las pistas | superpuestas | franja propia de 38/34px al final del panel; pistas terminan antes de la barra |
| 8 | `.rail-facets` / `.rail-chips` con scroll invisible (client 180 / scroll 394) y chips en 2 filas de 63px | recorte silencioso | una fila compacta con scrollbar visible e indicador de fundido |
| 9 | `.editor-splitter` de 1px con grip de 4px dibujando un diente sobre el monitor | scrollWidth 4 / client 0 | `max-width:1px` + `overflow:hidden`, conservando el arrastre |
| 10 | Textos recortados («Todos los medios», «Normalización loudness», etiquetas del inspector) | 3–5 recortes | **0 recortes a 1360**, 1 ellipsis controlado a 1280 |
| 11 | Miniaturas de la biblioteca a 62px en dos columnas | ilegibles | una columna de ~168–195px con tarjeta de 104px y rótulo |

Métricas finales: `document.scrollWidth == innerWidth` y `scrollHeight == innerHeight` en ambas
resoluciones; **0 paneles fuera de viewport**; 0 errores de consola en las 10 capturas de la app
real. Los 20 «elementos fuera del viewport» que siguen apareciendo en el JSON son exclusivamente
los `ruler-tick` de la regla del timeline (contenido legítimo de un área con scroll horizontal).

## 6. Alcance real y honesto

- **Sí está hecho**: capa visual CapCut, geometría del editor corregida y medida, paneles
  rotulados y legibles, navegación y vistas existentes conservadas, capturas reales, tests de
  regresión, handoff.
- **No está hecho / no se afirma**: el shell unificado `src/studio/**` de 6 áreas y sus paneles
  de generación/exportaciones/MCP que se construyeron en una fase anterior **fueron eliminados
  del árbol por un commit concurrente** y no se han reconstruido. Tampoco se han conectado
  funcionalidades nuevas a contratos inexistentes: no se presenta ningún mock como capacidad
  terminada.
- **Contenido del monitor en las capturas**: el `preview-look` del proyecto de demostración del
  repo (`createDemoProject`) renderiza una composición de ejemplo que incluye una interfaz de
  editor dentro del vídeo. Es **contenido del proyecto demo**, no un panel de la app ni un
  defecto de posicionamiento.
- El arnés temporal `visual-preview.html` / `__visual_preview.tsx` usado para capturar el editor
  con proyecto abierto **se ha eliminado**; los scripts de verificación quedan en `.tmp-ref/`
  (ignorado por git).

## 7. Verificación ejecutada

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit -p apps/desktop/tsconfig.json` | 2026-11-11 (tarde): **Exit 0 — worktree LIMPIO**. El bloqueo de `state/mcp-tools.test.ts` (15 errores por el `Clip` discriminado) fue resuelto concurrentemente por el owner del esquema. Ningún fichero de HY4 tiene errores de tipos, incluido el cambio nuevo en `Inspector.tsx`. |
| `npx vitest run --no-file-parallelism` (ColorPropertiesPanel, App.teclado, appearance, theme-palette, Timeline) | **Exit 0 · 101/101 tests** (5 ficheros). Ver §8.2 para el único test ajeno que sigue en rojo. |
| `npx vitest run` (App, App.teclado, appearance, theme-palette) — pasada anterior | Exit 0 · 148/148 (4 ficheros) |
| Capturas `capture.mjs` (launcher, home, editor, assets, settings × 1360×768 y 1280×720) | 10/10 `ok`, `overflow={doc:0, body:0}`, `errors=0` (repetido tras la capa nueva) |
| Auditoría `audit-layout.mjs` sobre editor con proyecto | 2/2 resoluciones sin paneles fuera de viewport; JSON de métricas guardado |
| Flujo `flow.mjs` / `persist.mjs` (clic en clip → Color → otro clip) a 1360×768 y 1280×720 | **9/9 pestañas visibles, 0 cortadas, 0 errores**; pestaña Color conservada entre clips de vídeo y reseteada al pasar a audio |

## 8. Bloqueos

1. **RESUELTO (2026-11-11, tarde)** — el typecheck ajeno de `state/mcp-tools.test.ts` ya no
   falla; `tsc --noEmit` devuelve exit 0. No requiere acción de HY4.
2. **Test ajeno en rojo (owner: quien renombró las vistas del editor)** —
   `apps/desktop/src/App.test.tsx:326` espera `toContain('Editor automático')` tras hacer clic
   en la pestaña «Automático», pero el `main` renderiza el modo de edición con
   «Variantes editables analizadas localmente / Volver a Edición». El fichero tiene 32 líneas
   añadidas por otro agente en el mismo diff (`git diff` muestra renombrados de «Automático»,
   «Abrir en Studio» → «Abrir en el editor»). **No es causado por HY4**: ese test crea un
   proyecto vacío (0 pistas, 0 clips), así que `RegularClipInspector` —único fichero TSX que
   tocó HY4— ni se monta. No se corrige para no sobrescribir un test en edición activa.
   Registrado en el handoff §25.
3. **Contratos backend** — sin cambios respecto a §2 y al handoff §§22-24. Los gaps ya
   documentados por SWE 2 (`production_start`/`production_pause`, evento `production-run`,
   `production_plan_from_brief/text`, `repairAttempts`/`lastRepair`, `studio_capabilities.remoteVoice`)
   siguen sin consumirse en la UI.
4. **Un ellipsis controlado** a 1280×720: «Normalización loudness» en un `span` interno de
   `.inspector-grid` (143px dentro de 130px). Es legible y no afecta a la posición de ningún
   control.
5. **Sin comparación antes/después en Color** — CapCut ofrece un botón de comparación;
   `ColorPropertiesPanel` no lo expone hoy. No se simuló: queda como mejora pendiente de
   contrato/UX, no como funcionalidad presentada.
6. **404 `/favicon.ico`** — sólo en el arnés temporal de captura; la app real dio `errors=0`
   en las 10 capturas. El arnés se elimina al cerrar esta fase.

## 9. Capturas (reales, guardadas en `docs/olyvia-blueprint/screenshots/hy4/`)

- `editor-full-1360x768.png`, `editor-full-1280x720.png` — **editor completo** con las cuatro
  regiones (medios / monitor / inspector / timeline) y proyecto abierto.
- `launcher-*.png`, `home-*.png`, `editor-*.png` (empty-state sin proyecto), `assets-*.png`,
  `settings-*.png` — 5 superficies × 2 resoluciones.
- `layout-editor-full-1360x768.json`, `layout-editor-full-1280x720.json` — geometría de 22
  contenedores, desbordamientos, scrolls ocultos y textos recortados.
- **Fase de edición fácil (§11)**: `color-1360x768.png`, `color-1280x720.png`,
  `video-properties-1360x768.png`, `video-properties-1280x720.png`,
  `inspector-sin-seleccion-1360x768.png` y los JSON `layout-color-*.json` /
  `layout-video-properties-1360x768.json`. 22 ficheros en total.

## 10. Próxima acción concreta (si se retoma el brief original)

Reconstruir el shell unificado y los workspaces de `02_FRONTEND_HY4_SPEC.md` **encima** de las
capas visuales ya entregadas, reutilizando las vistas reales y sin romper `App.test.tsx`. El
worktree ya compila limpio; el único freno de la suite es el test ajeno del §8.2.

## 11. Fase 2026-11-11 (tarde): «edición fácil» del inspector, tipo CapCut

### 11.1 Petición del usuario
Revisar qué ocurre al hacer clic en un vídeo del timeline, analizar el apartado Color y lograr
que **todos** los apartados sean tan fáciles de modificar como en CapCut; usar REA/Ghidra para
aprender cómo es CapCut por dentro.

### 11.2 Aprendizaje de CapCut (REA / Ghidra + capturas)
- Instalación real localizada: `C:\Users\ofici\AppData\Local\CapCut\Apps\9.7.1.4203`
  (resuelta por REA a `D:\Users\ofici\_Migrado_de_C\...` por ser un **reparse point**; Ghidra
  rechazó la ruta C: con `ERR_REA_WINDOWS_NATIVE`, se reabrió con la ruta D: real).
- `mcp__rea__open_binary` sobre `CapCut.exe` (PE x86_64) y `FusionUI.dll` (PE x86_64).
- `mcp__rea__search_strings` devolvió 1.447 strings; el inventario QML confirma que la UI de
  CapCut es **Qt/QML** con `QUIColorPanel/QUIColorWheel.qml`, `QUIColorAlphaSlider.qml`,
  `QUIColorBrightnessSlider.qml`, `QUIColorHexInput.qml`, `QUIColorRGBAInput.qml`.
  Patrón: **rueda cromática + slider + entrada numérica, siempre visibles en el panel de
  propiedades**. Coincide con las 4 capturas locales de `D:\Users\ofici\Pictures\Screenshots`
  y con la referencia de `alaukcut.com`.
- No se extrajo código propietario ni se desensambló lógica: sólo inventario de recursos y
  etiquetas para informar decisiones de UX de Olyvia.

### 11.3 Diagnóstico MEDIDO (antes)
| Hallazgo | Valor |
|---|---|
| Clic en clip de vídeo | Abre el inspector **a la DERECHA** (x=1020…1360), pestaña «Video»; el usuario lo describió «a la izquierda», pero CapCut también lo ubica a la derecha, así que se conservó |
| Pestañas de un clip de vídeo | 9, en un contenedor de `client 288 / scroll 460` con `scrollbar-width:none` |
| Pestañas visibles | Sólo 5: Video, Audio, Velocidad, Recorte, Animación |
| **Pestañas cortadas** | **Color**, Máscara de color, Estilo, Todo → Color exigía abrir el desplegable «» (2 clics) |
| Pestaña Color | `PropertySlider` (etiqueta + slider con gradiente + valor editable + keyframe), 4 looks en miniatura, HSL, curvas, ruedas, HDR, capas, LUT, reset, guardar preset, estudio avanzado — **ya era de nivel CapCut** |
| Resto de pestañas | **91 `input[type=number]`**, 20 selects, 118 `.field`, 28 secciones abiertas, 88 `.fine-print`. Otro lenguaje de interacción: campos numéricos sueltos en vez de slider+valor |

### 11.4 Cambios entregados
| Fichero | Cambio |
|---|---|
| `apps/desktop/src/styles/capcut-inspector.css` | **Nuevo** (~400 líneas). Pestañas en cuadrícula de 2 filas × 5 columnas (la 7ª, «Máscara de color», ocupa 2), sin scroll oculto; subpestañas uniformes; `.field` / `.num-spin-wrap` / `select` con la misma métrica que `.fp-slider-number`; cabeceras de sección sticky con marca de acento; presets en una fila de 4; pie compacto; scroll con barra teal; hint de orientación cuando no hay clip; clip seleccionado con contorno teal. Todo acotado a `:root[data-theme='dark']`. |
| `apps/desktop/src/features/editor/Inspector.tsx` | **Edición aditiva de un bloque** en el `useEffect([clip.id, clip.kind])`: `setTab` ahora conserva la pestaña (y la subpestaña) si sigue siendo válida para el nuevo clip; cae a la raíz al cambiar de tipo. Permite aplicar el mismo Color a varios clips seguidos. No se tocó ninguna otra línea del fichero (que tiene cambios de otros agentes). |
| `apps/desktop/src/main.tsx` | +1 import de la capa nueva, al final del cascade. |

Correcciones durante la verificación (errores propios encontrados y arreglados):
- Primer intento aplicó el grid de 2 columnas también a `.fp-slider-row`, **colapsando los 4
  sliders de Color**. Se excluyó ese selector (conserva su grid de 4 columnas original).
- Los presets en 3 columnas ocupaban 2 filas y desplazaban los sliders → vuelta a 4 columnas.
- `position:sticky` en `.fp-foot` tapaba el último slider → eliminado (`.fp-root` ya lo deja
  siempre visible por flex).
- 3 filas de pestañas restaban altura → 2 filas + compactación de secciones en ≤1320px.
- `.fp-more` («Más estilos») **no tiene `onClick`** en el JSX: se ocultó para liberar altura
  sin perder ninguna acción real.

### 11.5 Resultado medido (después)
- 1360×768 y 1280×720: **9/9 pestañas visibles, 0 cortadas** (`client == scroll`).
- Color a **1 clic** desde cualquier clip de vídeo; los 4 sliders básicos (Temperatura, Tinte,
  Intensidad, Saturación) con su valor numérico caben **sin scroll** en ambas resoluciones.
- Flujo verificado: vídeo#1 → `video/basic` → Color → `color/basic` → Ruedas →
  `color/wheels` → vídeo#2 → **`color/wheels` (conservado)** → audio → `audio/basic` →
  vuelta a vídeo → `video/basic`. 0 errores de consola.
- Sin selección, el inspector muestra el hint «Seleccioná un clip en la línea de tiempo para
  editar sus propiedades».
- `tsc --noEmit` exit 0; 101/101 tests propios; 10/10 capturas de app real sin overflow ni errores.
