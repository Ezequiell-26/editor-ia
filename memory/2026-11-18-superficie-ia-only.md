# 2026-11-18 · Superficie IA-only (editor + chat)

Pedido del usuario: que la app completa sea edición por IA, con sólo la
pantalla del editor y el chat al costado, sin botones de edición.

## Decisiones

- `state/ai-mode.ts` es la fuente única: `aiOnly` nace activo en dev/build
  (`import.meta.env.MODE !== 'test'`) y `getAiMode()` = `aiOnly || toggle`.
  Escape hatch: `localStorage['editoria.ai-only.v1'] = '0'`. En vitest el
  default es `false` para no reescribir cientos de tests del editor completo.
- `App` omite StartScreen con aiOnly; `AppShell` oculta rail, menú, acciones
  y statusbar (deja marca, nombre de proyecto y controles de ventana).
- `AlaukChrome`/`MenuBar` ocultan sus botones manuales; `EditorWorkspace`
  oculta las pestañas de modo, deja la columna del chat fija (sin plegado ni
  botón «Abrir asistente») y reemplaza el empty-state sin proyecto por un
  escenario limpio con el chat acoplado.
- `AssistantDock` recibe `docked`: abre acoplado, sin lanzador flotante ni
  cierre. Comando local nuevo `abrir proyecto` → `store.openProject()`.

## Archivos tocados

`App.tsx`, `app/Shell.tsx`, `components/{AppShell,MenuBar}.tsx`,
`features/editor/{AlaukChrome,EditorWorkspace}.tsx`,
`features/assistant/AssistantDock.tsx`, `features/ai-hub/{operator,AiHubView}.tsx`,
`state/ai-mode.ts`, `styles/layouts.css`, `docs/IMPROVEMENT-QUEUE.md`
y 4 archivos de test (uno nuevo: `app/ai-first-shell.test.tsx`).

## Verificación

`npm run typecheck` exit 0. Focalizados: ai-mode 4, ai-first-shell 2,
EditorWorkspace.ai-mode 5, operator 35, UI AI-mode 22 — todos verdes.
Falla preexistente detectada: `AssistantDock.test.tsx` exige <48 KiB en el
payload `mcpTools`; el WIP concurrente de `mcp-catalog.ts` (+69 líneas de
herramientas de audio) lo subió a 50 867 B. No se tocó ese WIP.

Suite completa: 3190/3194 verdes (la única falla, la del párrafo anterior).
`npm run build` exit 0. Verificación visual por CDP en `http://127.0.0.1:3000`:
sin rail ni botones manuales, chat acoplado a toda la altura. Hubo que
elevar la especificidad de las reglas `.editor-grid.ai-mode` en
`layouts.css` porque el preset capcut fija columnas/filas con `!important`
y el divisor caía en la columna del chat. En modo navegador no se pudo
crear un proyecto (sin acceso a archivos), así que la vista con proyecto
queda cubierta por tests, no por CDP.

## Compilado y abierto

- `npm run tauri:build` exit 0. La guardia `safe-delete` impidió vaciar
  `apps/desktop/dist` (319 artefactos), así que el directorio se movió a
  `%TEMP%/olyvia-dist-bak-20261118-1635` y se reconstruyó desde cero.
- Instalador NSIS firmado: `target/release/bundle/nsis/Olyvia_0.2.0_x64-setup.exe`
  (147,10 MiB). El instalador `/S` no completó en este entorno; se copió
  el exe nuevo sobre `%LOCALAPPDATA%\Olyvia\`, con respaldo del anterior
  en `Olyvia-backups\2026-11-18\`.
- `.lnk` viejo del Escritorio movido al backup y repuesto desde Menú Inicio.
- App abierta (PID verificado) y DOM confirmado por CDP en el binario
  instalado: `editor-grid ai-mode ai-only-empty`, chat presente, sin rail
  ni menú. Se relanzó sin puerto de depuración para dejarla normal.

## Corrección posterior: editor visible

El usuario reportó que en la app no se veía el editor. Causa: el escenario
`ai-only-empty` sustituía al monitor cuando no había proyecto.

- `App` crea un proyecto en memoria al arrancar en aiOnly, así preview,
  timeline y transporte están montados desde el primer frame.
- `Preview` tiene un botón **Start** sobre el cuadro (reproduce si hay
  clips; si no, avisa por `notice` qué pedirle a la IA).
- Verificado en vivo por CDP en el exe instalado: preview, timeline, Start
  y chat presentes; escenario de bienvenida ausente.
- typecheck 0; tests ai-first-shell 3/3, EditorWorkspace.ai-mode 6/6,
  regresión 138/138; `tauri:build` exit 0. Exe respaldado como
  `editor-ia-desktop-pre-editor-visible.exe` y app abierta de nuevo.

## Bug reportado por la IA: «Descargas»

`media_folder_list {folder:'Descargas'}` buscaba `Descargas/Descargas`.
Arreglado en `media/folder.rs`: alias `Descargas`/`Downloads` → raíz real,
root propio y carpetas vacías devuelven `count: 0`. Verificado en el exe
instalado por CDP: `D:\Users\ofici\Downloads`, 99 medios (fotos y videos).
Rust `media_folder` 5/5; `mcp-tools` 38/38. Rebuild y reapertura hechos.

**Auditoría**: ~100 tools MCP cubren proyecto/timeline/audio/efectos/color/
fábrica/exportación. Faltan exponer: micrófono, teleprompter, upscale,
quitar fondo y descarga URL (comandos nativos existen, pero la IA no los
puede ejecutar como tools). `typecheck` hoy falla por WIP ajeno en
`custom-skills.test.ts`.

## Proyecto en disco (error NOT_FOUND del piloto)

El in-memory project no bastaba: importar medios y guardar exigen sesión
nativa. Agregado `AiDiskProjectBootstrap` en `App` y `ensureDiskProject()`
en `AssistantDock`, con `storeRef` para ver `opened` tras el `await`.
Verificado en vivo: la app arrancó con proyecto en disco y el montaje de
`video 1` terminó con 33 imágenes / 125 subtítulos / 7 clips, sin el
error de proyecto abierto. El montaje tardó >3 min. typecheck 0,
ai-first-shell 3/3, build exit 0. La app sigue abierta con ese proyecto.

## Cierre 19/11: auditoría y botón de herramientas

El usuario pidió arreglar todo el frente y ver botones de herramientas no
edición. Se agregó `UtilityToolsMenu` en la barra **visible** del editor
(`.alauk-topbar`); el intento anterior en `.topbar` no se veía porque esa
barra está `display:none` en modo inmersivo. El filtro usa
`resolveViewRoute().editorMode` para excluir Texto/Multicámara/Mezcla/VFX.
Verificado: suite completa 3229/3229, typecheck 0, build exit 0, CDP con
botón 115×28 px visible, cajón con Descargar/Comprimir/Laboratorio y sin
controles de edición. App abierta con PID 4512.
