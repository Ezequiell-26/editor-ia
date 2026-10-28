# Renovación del E2E Playwright — 2026-10-26

**Alcance:** diseño (cero código) de la renovación de la suite E2E de
`apps/desktop/e2e`, desactualizada desde que entraron las curvas Bézier y los
medidores en vivo (commit `f3425ba`, ciclo 8 agentes, 2026-10-25). Responde al
P1 #1 de `docs/AUDIT.md` («Cobertura E2E desactualizada», `docs/AUDIT.md:81-82`)
y al punto 4 de «Continuidad» (`docs/AUDIT.md:221`).

**Nota sobre el material previo:** el pedido menciona un «plan E2E previo en
`docs/research/`». No existe ningún documento E2E en `docs/research/` (sus cinco
archivos son accesibilidad, color/HDR, tracking, multicámara y visuals). El
documento E2E previo que sí existe es `docs/reference/APP-AUTOEDIT-E2E-2026-10-19.md`,
un registro de prueba **manual** (montaje automático + export real contra el
binario Tauri debug + Vite), no un plan Playwright. Este documento llena el hueco
que `docs/AUDIT.md:195` deja como pendiente («plan E2E+rendimiento en
docs/research/»).

## 1. Hallazgo central: el navegador solo no alcanza

La config actual corre contra el servidor de Vite en un Chrome del sistema
(`apps/desktop/playwright.config.ts:4-6`, `channel: 'chrome'`, `baseURL
http://localhost:5173`). En ese contexto la app **no tiene backend Tauri**:
`detectNativeRuntime()` sólo devuelve true si existe
`window.__TAURI_INTERNALS__.invoke` (`apps/desktop/src/services/project-service.ts:1485-1487`),
y sin él el servicio se reemplaza por `createUnavailableService()`
(`project-service.ts:2484-2485`), donde **toda** operación de archivo lanza
`NATIVE_UNAVAILABLE_REASON` (`project-service.ts:1476-1477` y `2342-2360`):
«Abrí la app de escritorio de Olyvia para crear, importar y exportar…».

Consecuencias verificadas en el árbol actual:

- `createProject` en el store captura ese error y deja `phase: 'failed'` sin
  proyecto (`apps/desktop/src/state/project-store.tsx:209-235`).
- Sin proyecto, el Editor renderiza un estado vacío con un botón a Proyectos
  (`apps/desktop/src/features/editor/EditorWorkspace.tsx:85-91`): **la timeline,
  la preview, el inspector y el diálogo de export no existen en el DOM**.
- Por eso la suite actual esquiva todo flujo con proyecto: entra con el botón
  «Tutorial», que sólo navega a Aprender (`apps/desktop/e2e/helpers.ts:9-14`,
  `apps/desktop/src/features/start/StartScreen.tsx:774-777`).

Los seis flujos críticos del pedido (crear proyecto, importar, timeline básico,
export corto, curvas Bézier, medidores en vivo) **requieren la app nativa**. La
prueba manual del 2026-10-19 ya demostró el camino: binario debug
`target\debug\editor-ia-desktop.exe` (usa `devUrl` → Vite en :5173) con el
proyecto demo, llegando a export real verificado con FFprobe
(`docs/reference/APP-AUTOEDIT-E2E-2026-10-19.md:3-22`).

**Diseño propuesto: dos niveles.**

- **Nivel A — navegador (config actual intacta):** shell, paleta, ajustes y
  *estados vacíos*. Es lo que hoy existe; se conserva y se re-nombra por flujo.
- **Nivel B — binario Tauri debug + Playwright:** los seis flujos críticos. Para
  que Playwright controle WebView2 hace falta un **spike** (pendiente de
  validar, no verificado en este repo): lanzar el binario con
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` y adjuntar
  con `chromium.connectOverCDP('http://localhost:9222')`; la alternativa
  documentada por Tauri es `tauri-driver` (WebDriver), pero la suite está
  invertida en Playwright. El spike debe medir: (a) que `connectOverCDP` vea el
  DOM de la ventana WebView2, (b) que los diálogos nativos (abrir/importar) se
  puedan esquivar escribiendo archivos directamente en el directorio del
  proyecto demo y recargando, o sembrando el proyecto antes de lanzar el
  binario. Si el spike falla, el fallback es mantener los flujos de archivo como
  pruebas manuales scriptadas (como la del 2026-10-19) y automatizar en Nivel A
  lo que sí es alcanzable.

## 2. Inventario de specs actuales

Cuatro archivos en `apps/desktop/e2e/`, sin cambios sin commitear (sólo
`playwright.config.ts` está modificado en el árbol). Última vez que tocaron
`apps/desktop/e2e/`: commit `98a5c22` («editor pro, mezclador y render GPU»),
anterior a `f3425ba` que introdujo curvas Bézier, medidores, audio pro y speed
ramps — de ahí que la suite esté «muerta» respecto de todo lo nuevo, aunque sus
selectores sigan vivos.

| Archivo | Tests | Estado | Evidencia |
| --- | --- | --- | --- |
| `app.spec.ts` | 4 | **Vivo** (no corrido en esta sesión) | Los selectores que usa siguen existiendo: `.topbar` y `.app-statusbar` en `AppShell.tsx`, `.sidebar` en `components/Sidebar.tsx:53-54`, `.start-window` en `StartScreen.tsx:445`, `.app-shell` en `AppShell.tsx`, `.pipeline-guide` en `features/home/PipelineGuide.tsx`. Verificado por grep sobre `apps/desktop/src`. |
| `app.spec.ts` (navegación) | 1 | Vivo pero **incompleto** | Recorre 10 vistas (`app.spec.ts:20-31`); `app/navigation.ts:46-73` define 27. No cubre Mezcla, Motion, VFX, Texto, Multicámara, etc. |
| `palette.spec.ts` | 3 | **Vivo** | `.cmdp-panel`/`.cmdp-item` siguen en `components/CommandPalette.tsx`. |
| `settings.spec.ts` | 4 | **Vivo**, con un anti-patrón | `.hue-slider` en `features/settings/AppearanceCard.tsx`, `.settings-window` en `components/SettingsWindow.tsx`, `.shortcuts-row` en `features/settings/ShortcutsCard.tsx`. Usa `page.waitForTimeout(400)` (`settings.spec.ts:27`) esperando el debounce de guardado — patrón a erradicar (ver §5). |
| `helpers.ts` | — | Vivo, a extender | `enterApp` por «Tutorial»; habrá que añadir un `enterAppWithProject` para Nivel B. |

**Muerto:** ningún spec referencía features eliminadas; lo muerto es la
**cobertura**: nada prueba nada posterior a `98a5c22`. Específicamente ausente:
curvas Bézier (`KeyframeCurveEditor.tsx`, commit `f3425ba`), medidores en vivo
(`features/mixer/LiveMeters.tsx`, `f3425ba`), mixer completa, export dialog,
timeline con clips, creación/importación de proyecto.

Verificación de entorno corrida en esta sesión: `npx playwright --version` →
`Version 1.64.1` (dependencias presentes, sin `npm install`), y Chrome del
sistema presente en `C:\Program Files\Google\Chrome\Application\chrome.exe`
(viable para `channel: 'chrome'`). **La suite no se ejecutó** en esta tarea
(investigación, cero código; correrla es trabajo del integrador).

## 3. Suite objetivo por flujos críticos

Convención: los tests se nombran en español como el resto del repo, archivos
nuevos por flujo (`e2e/proyecto.spec.ts`, etc.) sin tocar los vivos. Cada flujo
indica nivel (A/B) y las aserciones concretas contra selectores verificados en
el árbol.

### 3.1 Crear proyecto — Nivel B — `proyecto.spec.ts`

- Precondición: binario debug + Vite; sin proyecto previo (limpiar
  `%APPDATA%/…` de recientes o usar perfil limpio).
- Pasos: en `.start-window` → botón «Crear proyecto» (`StartScreen.tsx:532-533`)
  → diálogo `role=dialog` «Nuevo proyecto» (`.start-create-dialog`,
  `StartScreen.tsx:785-800`) → nombre + plantilla → «Crear y entrar al editor»
  (`StartScreen.tsx:899`).
- Aserciones: `.app-shell` visible; sidebar muestra nombre de proyecto
  (`Sidebar` recibe `projectName`, `components/Sidebar.tsx:45`). Vista Editor
  **sin** `.empty-state` (`EditorWorkspace.tsx:85-91`).
- Variante nivel A (gratis hoy): intentar crear en navegador y verificar que el
  error nativo se comunica y no rompe el shell (el estado `failed` ya existe,
  `project-store.tsx:225-231`).

### 3.2 Importar medios — Nivel B — `importar.spec.ts`

- Precondición: proyecto del flujo 3.1 (o el demo del 2026-10-19).
- Pasos: vista Editor → panel de recursos pestaña Medios → botón «Importar»
  (`features/editor/EditorAssets.tsx:568-572`) → diálogo nativo. **En Playwright
  no se puede automatizar el diálogo nativo de Windows**: esquivar sembrando el
  archivo en el directorio del proyecto antes de lanzar el binario, o usando
  drag & drop si el destino nativo lo permite (spike, §1).
- Aserciones: contador de medios en `.rail-head` (`EditorAssets.tsx:547-566`);
  el asset aparece en `.rail-browser` con miniatura o etiqueta; sin errores en
  `pageerror`.
- Riesgo: depende del spike; si no hay camino automático, queda como flujo
  sembrado (proyecto demo ya con medios) y se prueba la *renderización* del
  medio, no la importación en sí.

### 3.3 Timeline básico — Nivel B — `timeline.spec.ts`

- Precondición: proyecto con al menos un clip en la pista (demo o importado).
- Selectores verificados (`features/editor/Timeline.tsx`): `.timeline`,
  `.timeline-toolbar`, `.timeline-clip.kind-*` con `aria-label` «{clip} en
  {pista}, desde {timecode}» (`Timeline.tsx:243-247`), `.trim-handle` «Recortar
  el inicio/fin» (306-318), `.fade-handle` «Fade de entrada/salida» (330-352),
  zoom «Acercar/Alejar/Ajustar zoom a la duración» (1182-1200), herramienta
  «Mover la vista con el mouse» (1211) y «Activar o desactivar timeline
  magnética» (1226). Transport en `.transport` con «Reproducir/Pausar», «Ir al
  inicio», «Dividir clip en el playhead» (`features/editor/Transport.tsx:68-118`).
- Aserciones mínimas: clip visible en su pista; seleccionar clip refleja el
  Inspector; dividir en playhead crea dos clips (`aria-label` con timecodes
  distintos); zoom cambia `.zoom-readout` (`Timeline.tsx:1188`); «Reproducir»
  mueve «Posición de reproducción» (`Transport.tsx:139`).
- Convenciones de arrastre: eventos de puntero con movimiento por pasos y
  `setPointerCapture` tolerante (el código ya lo hace así,
  `KeyframeCurveEditor.tsx:183-187`).

### 3.4 Export corto — Nivel B — `export.spec.ts`

- Precondición: proyecto demo del 2026-10-19 (34 s) o uno más corto sembrado
  (< 10 s para CI); FFmpeg presente en el path del binario debug.
- Pasos: abrir el diálogo de export desde el Editor
  (`EditorWorkspace.tsx:129`), elegir Perfil (`ExportDialog.tsx:576-577`),
  destino fijo en temp, iniciar render; el diálogo bloquea Escape mientras
  corre (`ExportDialog.tsx:108`).
- Aserciones: progreso llega a fin sin `markFailed`
  (`ExportDialog.tsx:294,317`); luego **validación fuera de la UI** con
  `ffprobe` sobre el archivo (duración ±1 frame, códecs H.264/AAC — mismo
  criterio que `docs/reference/APP-AUTOEDIT-E2E-2026-10-19.md:44-54`).
- Coste: es el flujo más caro; el render de referencia tardó ~12 s de proceso
  para 34 s de video (documento previo, línea 52). Un clip de 5 s debería
  renderizar en pocos segundos, más arranque del proceso.

### 3.5 Curvas Bézier visibles — Nivel B — `curvas.spec.ts`

- Precondición: proyecto con un clip de video o imagen seleccionable.
- Pasos: seleccionar clip → Inspector → panel «Keyframes de transformación» →
  «Fijar en playhead» (`features/editor/Inspector.tsx:1685-1701`); mover
  playhead, cambiar escala, «Fijar en playhead» otra vez. Con ≥ 2 claves aparece
  la sección «Curvas» con `KeyframeCurveEditor`
  (`Inspector.tsx:2413-2434`).
- Aserciones: `canvas[role=img]` visible con `aria-label` que empieza
  «Editor de curvas Bézier de escala:» y contiene «2 segmentos»… / «2 keyframes»
  (`KeyframeCurveEditor.tsx:246-259`; el número exacto se toma del aria-label
  generado, no hardcodear). Arrastrar un punto naranja y verificar que el
  proyecto se actualiza (`onEditBezier` → `setTransformKeyframe`,
  `Inspector.tsx:2422-2427`): reabrir el Inspector y confirmar que la curva
  persiste; opcionalmente verificar el aria-label del keyframe en la lista
  (`.keyframe-row`, `Inspector.tsx:1723-1730`).
- Caso negativo (nivel A, sin proyecto no aplica; dejarlo en Nivel B): con 0-1
  claves la sección no existe y el editor muestra «Curvas sin keyframes»
  (`KeyframeCurveEditor.tsx:238-244`).

### 3.6 Medidores en vivo — Nivel B — `medidores.spec.ts`

- Precondición: proyecto con una pista audible con contenido (narración del
  montaje automático del demo, o audio importado). Los medidores sin proyecto no
  renderizan (`LiveMeters.tsx:148`) y sin reproducción quedan en −∞.
- Pasos: vista «Mezcla» (label del rail en `app/navigation.ts:54`) →
  reproducir desde el editor o transport → volver a Mezcla (o dejar correr).
- Aserciones: `section[aria-label="Medidores en vivo"]` visible
  (`LiveMeters.tsx:171-175`); existe `div[role="meter"]` por pista y uno
  «Master» con `aria-label` «Nivel en vivo de …» (`LiveMeters.tsx:63-71`);
  **durante la reproducción** algún `aria-valuenow` > −60 (`LiveMeters.tsx:69-71`,
  rango −60..0); al pausar los niveles caen al piso y el pico se sostiene
  (`LiveMeters.tsx:15-17,22-25`): asertar `.mixer-meter-peak-hold` presente y
  `.mixer-peak` con valor finito tras reproducir.
- Nota headless: Web Audio funciona en Chrome headless sin dispositivo real (el
  grafo procesa datos, no depende de la placa); la degradación sin AudioContext
  ya está contemplada en la UI (`LiveMeters.tsx:191-195`) y sirve de aserción
  alternativa si el spike de WebView2 capa audio.

### 3.7 Cobertura nivel A a completar (sin binario)

- Navegación por las 27 vistas de `app/navigation.ts:46-73` (hoy 10).
- Mezcla vacía: `.mixer-board` muestra `.mixer-empty` sin proyecto
  (`features/mixer/MixerView.tsx:172-174`) y **no** renderiza medidores.
- Vista Motion (nueva en `f3425ba`) y speed ramps: al menos smoke de render
  sin errores de consola.

## 4. Estrategia de tiempos y flakiness

La config ya tiene timeouts realistas (diff sin commitear de
`apps/desktop/playwright.config.ts`): test 30 s → **120 s**, expect 7 s → **20 s**,
actionTimeout 8 s → **15 s**, navigationTimeout 15 s → **90 s**, más
`webServer.timeout 60 s` con `reuseExistingServer: true`. Esa base se conserva;
las decisiones de diseño encima:

1. **Serial estricto:** mantener `workers: 1` y `fullyParallel: false` — un solo
   Vite, estado compartido en localStorage del navegador y, en Nivel B, un solo
   binario. La paralelización no vale el flakiness en una app de escritorio.
2. **`retries: 0` local, 1 en CI:** proponer `retries: process.env.CI ? 1 : 0`
   cuando exista CI; en local un retry enmascara flakiness real. No proponer más
   de 1: los errores aquí suelen ser deterministas (timing de Vite frío, diálogo
   nativo).
3. **Prohibido `waitForTimeout` fijo:** el único uso actual
   (`settings.spec.ts:27`) espera el debounce de guardado; el reemplazo es
   asertar el efecto (valor committeado tras `reload`, como ya hace el propio
   test en las líneas 28-37) o exponer una condición observable. Todo lo demás
   va por `expect(...).toHave...` que sondea hasta 20 s.
4. **Arrastres de puntero:** siempre por pasos intermedios (`mouse.move` en
   varios incrementos entre down y up) — el hit-test de los manejadores usa un
   radio de 10 px (`KeyframeCurveEditor.tsx:9,165-175`) y un salto directo puede
   perder el punto; cada `down` con su `up` garantizado en `finally` para no
   dejar el estado `draggingRef` colgado.
5. **Primer test paga el compile frío de Vite** (comentario de la propia
   config, línea 9): ordenar los specs para que el más tolerante (shell) corra
   primero y absorbá el arranque; los specs Nivel B no dependen de Vite para su
   primer render si el binario ya compuso.
6. **Aserciones sobre semántica accesible, no sobre CSS:** todos los flujos
   nuevos usan `role`/`aria-label` (medidores, curvas, transport) que el repo ya
   mantiene; eso resiste cambios de estilo como los de este ciclo.
7. **Errores de página como aserción global:** replicar el patrón de
   `app.spec.ts:5-6` (colección de `pageerror`) en el `beforeEach` de los specs
   nuevos y fallar si apareció alguno al cierre del test.
8. **Datos de prueba versionados fuera del repo:** los proyectos/seeds van a un
   directorio temporal por corrida (nada dentro de `apps/desktop/e2e/fixtures`
   que el schema pueda invalidar); el proyecto demo grande queda como fixture
   manual documentado, no como dependencia de la suite.

## 5. Coste de ejecución

Estimaciones (marcadas como tales) a partir de los tiempos conocidos: compile
frío de Vite absorbido por el timeout del primer test (config, líneas 9-11),
webServer hasta 60 s, y el render del 2026-10-19 (34 s de video en ~12 s de
proceso). Nada de esto se midió corriendo la suite en esta sesión.

| Bloque | Tests | Estimado | Supuesto dominante |
| --- | --- | --- | --- |
| Nivel A: shell + navegación (existente) | 4 | 1,5–3 min | primer test paga compile frío de Vite (hasta ~60-90 s) |
| Nivel A: paleta (existente) | 3 | 0,5–1 min | cada test re-entra por `enterApp` |
| Nivel A: ajustes (existente) | 4 | 1–2 min | incluye `reload` + debounce |
| Nivel A: mezcla vacía / motion smoke (nuevos) | 3–4 | 1–2 min | entradas por rail |
| Nivel B: arranque binario + crear proyecto | 1–2 | 1–2 min | lanzamiento del exe (una vez por corrida, compartido) |
| Nivel B: importar (según spike) | 1–2 | 1–3 min | si no hay camino automático, se descuenta |
| Nivel B: timeline básico | 4–5 | 2–3 min | arrastres por pasos |
| Nivel B: curvas Bézier | 2–3 | 1–2 min | interacciones de canvas |
| Nivel B: medidores en vivo | 2 | 1–2 min | reproducción de ~3 s + pausa |
| Nivel B: export corto | 1–2 | 2–4 min | render + ffprobe |
| **Total** | ~22–28 | **~12–20 min** | serial, un worker, un Vite, un binario |

Coste de mantenimiento esperado: bajo en Nivel A (selectores estables), medio en
Nivel B (acoplado a rutas de disco y al spike de WebView2). El export corto es
el único bloque con coste por corrida realmente variable; mantenerlo al final de
la corrida para que un fallo suyo no retrase la señal del resto.

## 6. Plan de migración sugerido (orden, sin código en este documento)

1. Renombrar/reorganizar los specs vivos por flujo (nivel A) y añadir los
   tests A de §3.7 — cero riesgo, no tocan la app.
2. Spike Nivel B: binario debug + `connectOverCDP` a WebView2; decidir mecanismo
   de siembra de proyecto (archivo en disco antes de lanzar). Si falla, dejar
   documentado el camino manual y quedarse con nivel A ampliado.
3. Specs B en orden de dependencia: crear proyecto → timeline → curvas →
   medidores → export corto (export al final por coste).
4. Recién entonces tocar config: `retries` por CI y, si el binario entra en la
   corrida, un segundo `project` (p. ej. `tauri-debug`) para separar reportes.

## 7. Lo que esta tarea no verificó

- La suite no se ejecutó (ni A ni B); el estado «no corre desde `f3425ba`» se
  infiere del historial de git (último commit que tocó `apps/desktop/e2e/`:
  `98a5c22`, anterior a `f3425ba` que introdujo curvas y medidores) y de
  `docs/AUDIT.md:81-82`, no de una corrida.
- El mecanismo Playwright↔WebView2 (`connectOverCDP` / `tauri-driver`) es la
  propuesta del spike: no se validó en este repo.
- Los tiempos de §5 son estimaciones; la primera corrida real debe medir y
  corregir esta tabla.
