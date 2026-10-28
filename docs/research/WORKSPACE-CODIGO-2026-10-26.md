# Diseño: workspace de código y automatizaciones externas (P3 #12)

**Estado**: propuesta (2026-10-26). Documento de investigación, cero código.
**Base real**: todo lo que sigue fue verificado leyendo `apps/desktop/src/state/` (`project-store.tsx`,
`project-actions.ts`, `shortcuts.ts`, `flow-queue.ts`, `FlowQueueProvider.tsx`, `effect-presets.ts`),
`apps/desktop/src/app/commands.ts`, `apps/desktop/src/components/CommandPalette.tsx`,
`apps/desktop/src/features/editor/EditorWorkspace.tsx`, `apps/desktop/src/services/project-service.ts`,
`packages/project-schema/src/` (`index.ts`, `provenance.ts`, `timeline.ts`), `extensions/flow-queue/`
(`README.md`, `manifest.json`), `extensions/web-tts-bridge/manifest.json`,
`docs/integrations/FLOW-QUEUE.md`, `GOOGLE-FLOW-MCP.md` y `MOTION-MCP.md`, `docs/AUDIT.md`,
`docs/ROADMAP.md`, `package.json` y `vitest.config.ts` en la rama `feat/motion-graphics`.

## Por qué

El ítem P3 #12 de la auditoría (`docs/AUDIT.md:108`) pide "**workspace de código** y automatizaciones
externas". Hoy el editor es un buen producto de clics pero no da un punto de entrada programable: un
usuario con 60 clips no puede "renombrar en lote con un patrón" ni "aplicar el mismo preset a todos
los clips de una pista" sin repetir el gesto 60 veces. El roadmap ya anticipa dos consumidores que
necesitan exactamente la misma pieza:

- **Fase 5 — Operador IA** (`docs/ROADMAP.md:212-231`): un agente que "no conversa, ejecuta" y que
  necesita herramientas estructuradas con esquemas compactos, presupuesto y dry-run.
- **Fase 7 — Distribución** (`docs/ROADMAP.md:253-257`): "la app como servidor MCP: otros agentes
  controlan Editor IA" y "plugin SDK de terceros".

La tesis de este documento: **el registro de comandos con esquema es la fundación compartida**; el
workspace de código (panel + consola + API de scripting) es su primer consumidor, y el operador IA y
el MCP del futuro la reutilizan sin duplicar superficie. Un registro, tres consumidores.

## Qué existe hoy (estado verificado)

### La superficie de comandos actual es de cero argumentos

- `Command` (`apps/desktop/src/app/commands.ts:4-11`) es `{ id, label, category, shortcut?, action:
  () => void, disabled? }`: la paleta (`CommandPalette.tsx:35-39`, `fuzzyMatch` en
  `commands.ts:147-155`) sólo filtra y ejecuta. No hay parámetros, ni retorno, ni esquema de
  argumentos: un script no puede vivir encima de esto tal cual.
- `buildCommands(ctx)` (`commands.ts:36-135`) arma la lista con un `CommandContext` de ~16 acciones
  de alto nivel (navegar, guardar, exportar, undo/redo, play/pause). `App.tsx:386-388` la construye
  y `App.tsx:679` la pasa a la paleta.
- Los atajos (`shortcuts.ts:16-60`) son otra lista paralela de acciones: ids tipados, etiquetas y
  categorías en español (`shortcuts.ts:62-144`). La app tiene así **tres listas de acciones**
  (paleta, atajos, y las ~80 funciones puras de `project-actions.ts`) sin un registro común.

### La puerta de edición ya está validada y con historial

- Todo cambio de proyecto pasa por `mutate`/`update` del store (`project-store.tsx:104-111`): la
  receta produce un documento nuevo, **el store lo valida con el esquema canónico** (`parseProject`,
  `project-store.tsx:449-459`) y sólo entonces lo adopta, marca `dirty` y **empuja un paso de undo**
  (`project-store.tsx:460-474`). Una edición inválida nunca entra al estado.
- Las acciones de dominio son funciones puras `(project, ...) => project` con errores tipados en
  español (`ProjectActionError`, `project-actions.ts:55`): `updateClip` con patch de `label`
  (`project-actions.ts:2214-2240`), `updateTrack` (`3338-3396`), `moveClip`, `trimClip`, `splitClip`,
  `applyAudioPresetToAll` (`1835-1857`, el precedente exacto de "aplicar un preset a muchos clips en
  una sola operación, salteando pistas bloqueadas"), `applyTransitionToCuts`, `closeGaps`,
  `splitClipsAtMarkers`, etc. (`project-actions.ts`, ~80 exportaciones en 4294 líneas).
- El patrón de consumo es directo en los componentes: el teclado del editor llama
  `store.update((doc) => moveClip(doc, ...))` y traduce el fallo a un `notice`
  (`EditorWorkspace.tsx:66-72` y `96-102`).

### El límite de seguridad ya está dibujado

- "The webview never touches the filesystem, a shell or a credential. It calls typed methods"
  (`project-service.ts:12-19`): la única puerta al nativo es `DesktopService`, con ~150 métodos
  tipados (`project-service.ts:1112-1360`) que mapean a comandos Tauri (`PROJECT_COMMANDS`,
  `1362-1474`).
- Saneo de errores: `sanitizeForUi` tacha rutas absolutas antes de mostrarlas
  (`project-service.ts:1498-1506`); los proveedores remotos exigen https y los locales sólo loopback
  con host comparado exacto (`isLocalProviderUrl`, `1513-1525`).

### Existen tres modelos de "automatización externa" con formas distintas

1. **Puente MCP de salida** (`service.callMcpTool`, `project-service.ts:1220`; sesiones vivas con
   apagado por inactividad de 10 min, `251-262`): la app ejecuta herramientas de servidores MCP
   locales por stdio. Así se conecta hoy la cola de Flow dentro de la app
   (`FlowQueueProvider.tsx:212-226` llama `flow_generate_image`, `128-138` consulta `flow_status`,
   `175-180` hace `flow_connect`, y `140-164` importa los artefactos a Medios). Los servidores
   registrados viven en `mcp-servers.json` (`docs/integrations/GOOGLE-FLOW-MCP.md`) y Motion MCP
   implementa el subconjunto stdio `tools/list` + `tools/call` (`docs/integrations/MOTION-MCP.md`).
2. **Extensiones de Chrome** (`extensions/`): `flow-queue` (MV3, panel lateral sobre
   `flow.google.com`, cola de prompts con referencias y descargas numeradas
   `001_slug.png` + `manifest.json`; permisos en `extensions/flow-queue/README.md:57-65`) y
   `web-tts-bridge` (permisos por sitio, `optional_host_permissions: https://*/*`). **Viven fuera de
   la app**: su producto entra al editor a mano vía "Auto-montar lote" (`docs/integrations/FLOW-QUEUE.md:63-81`,
   orden por nombre numerado, `51-60`).
3. **Provenance para agentes** (`packages/project-schema/src/provenance.ts`): ya existe en el esquema
   un contrato pensado para operaciones de agentes — `AgentOperationSchema` (`130-164`) con
   `role` fijo (`97-107`), `summary`, `cost` con `disclosed`/`approved` (una operación aplicada debe
   declarar costo mostrado, y una operación con costo no puede aplicarse sin aprobación), `patch` de
   **JSON Patch** de 1–500 operaciones (`141`) sobre punteros JSON con guardia anti-escape
   (`66-72`), `expectedRevision` y `appliedStatus`. Hoy ningún flujo lo escribe: es una base
   publicada sin consumidor, igual que `speedCurve` lo estaba
   (`docs/research/TIME-REMAP-FRAME-2026-10-26.md:44-56` documentó ese patrón).

### Convenciones del repo que el diseño respeta

- Zod fijado a **3.24.1** y `zod-to-json-schema` a **3.23.5** por overrides (`package.json`,
  bloque `overrides`); tocar `packages/project-schema` exige `npm run schema:generate`.
- Tests nuevos en archivos nuevos, corridos con `npx vitest run --no-cache <archivos>` (nunca la
  suite completa); `vitest.config.ts` ya excluye `extensions/**` y `apps/desktop/e2e/**`.
- React 19 + jsdom: `children` dentro de props en `createElement`, eventos de puntero con
  `new MouseEvent`, `setPointerCapture` con try/catch; UI y nombres de tests en español.
- Regla fundacional (`docs/ROADMAP.md:15-17`): sin internet la función existe igual; licencias sólo
  MIT/Apache/BSD/Unlicense enlazadas (`19-25`).

## Modelo propuesto

### Principios

1. **Un script no tiene más poder que la UI**: toda edición pasa por el mismo `store.update`/`mutate`
   (validación de esquema + historial). No hay "modo script" que escriba el documento a mano libre.
2. **La API es el perímetro de seguridad**, no el sandbox: lo único que un script puede pedir son
   comandos registrados con argumentos validados. El sandbox de ejecución es la segunda barrera
   (defensa en profundidad), no la única.
3. **Sin red por defecto** (regla fundacional): un script no puede abrir sockets, `fetch` ni URLs.
   La única vía a la fuera es opt-in explícito por script, y va por las herramientas MCP ya
   aprobadas por el usuario.
4. **Todo es legible**: los scripts son archivos `.js` de texto en el proyecto o del usuario; nada
   se descarga ni se evalúa a escondidas; cada corrida queda registrada.
5. **Español en la superficie**: ids de comando estables en inglés técnico (`clip.rename`), labels y
   errores en español, como el resto del repo.

### Capa 1 — Registro de comandos con esquema (`CommandRegistry`)

Nuevo módulo `apps/desktop/src/state/command-registry.ts` (nombre propuesto), **aditivo**: no
reemplaza `buildCommands` ni `shortcuts.ts`; los envuelve.

```ts
// Diseño (no es código del repo):
interface CommandSpec<A> {
  readonly id: string;              // 'clip.rename', 'clips.renameBatch', 'track.rename', ...
  readonly label: string;           // español: 'Renombrar clip'
  readonly category: string;        // 'Clip' | 'Pista' | 'Archivo' | 'Reproducción' | 'Automatización'
  readonly args: ZodType<A>;        // esquema zod de los argumentos (zod 3.24.1)
  readonly needsProject: boolean;   // exige proyecto abierto
  readonly mutates: boolean;        // toca el documento (entra al historial)
  readonly run: (args: A, ctx: CommandRunContext) => Promise<CommandResult> | CommandResult;
}

interface CommandRunContext {      // lo único que un comando puede tocar
  readonly store: ProjectStoreValue;   // update/mutate/setNotice/setSelection/undo/redo/...
  readonly service: DesktopService;    // sólo comandos de servicio allowlisteados por capability
  readonly registry: CommandRegistry;  // para composición entre comandos
}

type CommandResult<T = unknown> =
  | { ok: true; value?: T; applied?: number; skipped?: number }
  | { ok: false; code: 'invalid-args' | 'no-project' | 'rejected' | 'locked' | 'not-found';
      message: string };             // mensaje en español, listo para la consola
```

Decisiones de diseño:

- **Resultado estructurado, no excepciones**: `updateClip` tira `ProjectActionError`
  (`project-actions.ts:55`); el registro la captura y la traduce a `{ ok: false, code: 'rejected',
  message: <mensaje en español> }`. Un script siempre recibe un valor con forma fija; la consola
  nunca muestra un stack crudo. Mismo espíritu que `sanitizeForUi`.
- **Batch = un paso de undo**: el store empuja una entrada de undo por cada `update`
  (`project-store.tsx:466-472`); un script que llama `clip.rename` 60 veces crearía 60 pasos.
  Por eso los comandos de lote (`clips.renameBatch`, `track.applyPresetAll`) son de primera clase y
  hacen **una sola** llamada `store.update` con un loop interno — el patrón exacto de
  `applyAudioPresetToAll` (`project-actions.ts:1835-1857`), que acumula en un solo documento y
  devuelve `{ applied, skipped }`.
- **`buildCommands` se migra gradualmente**: cada `Command` de la paleta puede envolver una
  `CommandSpec` (la paleta ignora `args` y llama `run` sin argumentos con defaults). En la fase 1 no
  se toca la paleta; en fases posteriores los ids de paleta (`nav.*`, `file.*`, `edit.*`) pueden
  registrarse también en el registry para que los scripts invoquen las mismas acciones. Los
  `ShortcutId` (`shortcuts.ts:16-60`) quedan como están: son una vista sobre acciones, no otra
  lista que unificar a la fuerza.
- **Descubrimiento**: `registry.list()` devuelve `{ id, label, category, argsSchema resumido,
  needsProject, mutates }` — es lo que la consola muestra como ayuda y lo que el futuro MCP
  `tools/list` del roadmap (fase 7) expondría sin trabajo extra.

### Capa 2 — API de scripting (`editoria`)

El objeto único inyectado al sandbox. Sin promesas ocultas: es el registro + lecturas de sólo
lectura + un canal de log.

```ts
// Superficie expuesta a un script (diseño):
declare const editoria: {
  readonly project: {
    get(): ProjectDocument | null;        // instantánea de sólo lectura del documento validado
    fps(): number;                        // azúcar sobre fpsOf (project-actions.ts:77)
    totalFrames(): number;
  };
  readonly selection: { get(): Selection };
  run<T>(id: string, args?: unknown): Promise<CommandResult<T>>;   // la única forma de mutar
  catalog: {
    effectPresets(): readonly EffectPreset[];      // state/effect-presets.ts:9
    audioPresets(): readonly { id: string; label: string }[];  // state/audio-presets.ts:5
    visualCatalog(): Promise<VisualCatalog>;       // service.listVisualCatalog
  };
  log(...values: unknown[]): void;        // línea en la consola; sin console del host
  wait(ms: number): Promise<void>;        // con tope (p. ej. 60 s) para no colgar la cola
};
```

El script no ve `window`, `document`, `localStorage`, `fetch`, `XMLHttpRequest`, `WebSocket`,
`importScripts`, `eval`, `Function` como globales propios del sandbox (ver Capa 4). No ve
`DesktopService` crudo: sólo los catálogos de lectura listados y los comandos que deciden exponer
`service` (ninguno en la fase 1).

### Capa 3 — Panel y consola de scripts (UI)

Recomendación: **nueva vista `workspace`** (`apps/desktop/src/features/workspace/`), registrada en
`navigation.ts` y en `buildCommands` con el patrón `nav()` existente (`commands.ts:37-43`). Razones:
los scripts son automatización a nivel proyecto (necesitan editor + consola a pantalla completa),
el repo ya tiene ~30 vistas con el mismo esqueleto, y el filtrado por modo ya lo maneja
`ExperienceProvider` (`App.tsx:750`). El atajo `nav.workspace` se agrega a `shortcuts.ts` **sin
reasignar teclas existentes** (sin binding por defecto al principio, como `nav.compliance`, que hoy
no tiene atajo en `commands.ts:55`).

Anatomía (dos paneles, una vista):

- **Lista de scripts** (izquierda): scripts del proyecto (`<proyecto>/scripts/*.js`) y del usuario
  (global). Cada uno con nombre, descripción de la cabecera y capacidades que pide. Botones:
  Ejecutar, Ejecutar en seco (dry-run), Editar, Exportar, Eliminar.
- **Editor + consola** (derecha): un `textarea` monoespaciada para la fase inicial (sin CodeMirror:
  es una dependencia nueva y no hace falta para el MVP) y la consola con líneas `{ nivel: info|error|
  resultado, texto }`, el resumen `{ applied, skipped }` de cada comando y el tiempo total. Los
  errores llegan en español por el `CommandResult`, no como excepciones crudas.
- **Cabecera de capacidades**: la primera línea del script se declara legible por humanos y
  parseable por la app:

  ```js
  // @editoria nombre="Renombrar tomas en lote" proyecto="true"
  // @editoria-capabilities proyecto.edicionar
  ```

  Si el script pide una capability no concedida (ver Capa 4), el botón Ejecutar abre un diálogo de
  permiso que la lista en español; sin concesión, no corre. Precedente de aprobación explícita:
  `cost.approved` en `provenance.ts:157-163` y el `approvedCost` que ya viaja en
  `GenerateScriptRequest` (`project-service.ts:102-107`).

Persistencia de scripts (fases):

- **Fase MVP**: `localStorage` con clave versionada (`editoria.scripts.v1`), igual que los atajos
  (`SHORTCUTS_STORAGE_KEY`, `shortcuts.ts:13`) y la cola de Flow (`FLOW_QUEUE_STORAGE_KEY`,
  `flow-queue.ts:14`). Importar/exportar por copiar-pegar; leer un `.js` del disco puede reutilizar
  el patrón de `chooseSubtitleFile` (lee un archivo de texto elegido por el usuario,
  `project-service.ts:1924-1933`) con un comando propio.
- **Fase 2 (Rust)**: comandos Tauri dedicados `script_list` / `script_read` / `script_write`
  acotados a `<proyecto>/scripts/` y a la carpeta de datos de la app (nunca rutas arbitrarias — el
  mismo criterio que hizo del allowlist de entrada una decisión de seguridad, `docs/ROADMAP.md:84-86`).

### Capa 4 — Modelo de seguridad

**Amenaza modelada**: un script pegado desde un foro (o escrito por un tercero) que hace algo
destructivo (borrar pistas), extrae datos (subir el proyecto a un servidor) o se cuelga. No se
modela un atacante del kernel del navegador: el sandbox es defensa en profundidad, no garantía
absoluta, y el diseño lo declara.

| Recurso | ¿Un script puede? | Mecanismo |
| --- | --- | --- |
| Documento del proyecto | **Leer instantánea y editar vía comandos** | `editoria.project.get()` (sólo lectura) + `editoria.run(...)` → `store.update` con `parseProject` (`project-store.tsx:449-459`) y undo agrupado |
| Historial undo/redo | Sí, como cualquier edición del usuario | Un run con cambios = pasos de undo normales; los lotes son un paso |
| Sistema de archivos | **No**. Ni leer ni escribir rutas | No hay `fs` en el sandbox; el servicio no se expone; los comandos de persistencia de scripts (fase 2) sólo aceptan `<proyecto>/scripts/` |
| Shell / procesos | **No** | El sandbox no ejecuta procesos; `callMcpTool` sólo vía capability `mcp.llamar` opt-in |
| Red | **No por defecto** | `fetch`/XHR/WebSocket/EventSource/`importScripts` ausentes del sandbox; verificación con test (fase 2) |
| MCP (consumo de créditos) | **Opt-in por script y por servidor** | capability `mcp.llamar` + lista de `serverId` permitidos en el diálogo de permisos; el costo se registra (provenance) |
| Render/export | **Opt-in** | capability `render.disparar`; el render ya es transaccional con eventos (`RenderProgressEvent`, `project-service.ts:186-206`) |
| Credenciales / keyring / proveedores | **Nunca** | `getProvider`/`saveProvider`/keys (`project-service.ts:1247-1264`) fuera de la superficie |
| DOM / localStorage / otras vistas | **No** | Sin `window`/`document`; la UI se afecta sólo por comandos (`setNotice`, `setSelection`, `navigate`) |
| Otros proyectos / el disco de proyectos | **No** | El registry opera sobre el proyecto abierto del store; no hay `openProjectAt` para scripts |

**Sin red por defecto, en concreto**: el worker del sandbox se arma desde un bootstrap propio antes
de evaluar el script del usuario: se eliminan/anulan `fetch`, `XMLHttpRequest`,
`XMLHttpRequestUpload`, `WebSocket`, `EventSource`, `importScripts`, `Worker` (anidar workers),
`navigator.sendBeacon` y se congela `globalThis` para que el script no pueda restaurarlos por
`Function('return this')()`. La promesa no es criptográfica: si el sandbox escapa, el código corre
en un **Web Worker** (sin `window`, sin `__TAURI_INTERNALS__` de la página, sin DOM), y lo primero
que tocaría es el perímetro del registry — que igual valida cada llamada. Fase de seguridad debe
verificar con evidencia que la IPC de Tauri no es alcanzable desde el scope del worker (hipótesis a
confirmar, no la afirmo como verificada) y que las cabeceras CSP del webview no amplían el radio.

**Elección del motor de sandbox** (decisión abierta declarada, con recomendación):

- **Recomendado, fase objetivo: QuickJS via WASM** (`quickjs-emscripten`, MIT — cumple la política
  de licencias del repo, `docs/ROADMAP.md:19-25`): intérprete sin acceso al host salvo lo inyectado,
  con `interruptHandler` para timeouts duros y límite de memoria. Aísla de verdad y hace
  determinista el no-red. Costo: dependencia nueva (~1 MB wasm) → fase propia con su verificación de
  licencia y su build.
- **MVP sin dependencias nuevas (fase 2): Web Worker desde Blob** con el bootstrap de globals
  limpiados de arriba y RPC por `postMessage`. Suficiente mientras los scripts son locales y
  revisables, y el perímetro real es el registry.
- **Descartado**: `eval`/`new Function` en la página (sin aislamiento), `node:vm` fuera de proceso
  (correría JS con acceso a Node: contra todo el modelo), ejecutar procesos externos (viola
  local-first y agrega superficie de shell).

**Trazabilidad — rellenar el provenance publicado**: cada run que muta el proyecto registra un
`AgentOperation` en `project.provenance.operations` con `role: 'editor'` (no exige cambio de
esquema: `AgentRoleSchema` es un enum cerrado, `provenance.ts:97-107`), `provider: { id: 'script',
model: <nombre del script> }`, `summary` en español, `cost` con `disclosed: true` y `items: []`
(un script local no gasta), y `patch` = **diff JSON Patch pre/post** del documento acotado a 500
operaciones (`provenance.ts:141`); si el diff excede el tope, el run igual aplica (ya pasó por el
store) pero la operación se registra con `summary` y `patch` truncada marcada, o se declara límite
explícito en la fase. Esto da revisión y revert de scripts con el contrato que el esquema ya
publicó. El diff por run es O(tamaño del documento): fase de trazabilidad debe medirlo en proyectos
grandes (ver Límites).

### Relación con `extensions/flow-queue` (y las otras extensiones)

**División de responsabilidades, sin acoplamiento**:

- Las extensiones (`flow-queue`, `web-tts-bridge`) automatizan **webs de terceros** (Flow, webs de
  voz) desde Chrome, con permisos por sitio y sin tocar el editor. Son "manos afuera". Su contrato
  con el editor hoy es un archivo: descargas numeradas `flow-queue/<runId>/001_slug.png` +
  `manifest.json` (`docs/integrations/FLOW-QUEUE.md:51-60`) que el humano trae de vuelta con
  "Auto-montar lote" (`63-81`).
- El workspace de código automatiza **el editor mismo** desde adentro. Es "pegamento adentro".
- **La relación es de complemento, no de puente**: la cola en Flow ya tiene dos vías (la extensión
  de Chrome y el MCP in-app de `FlowQueueProvider`); un script no las reemplaza, pero sí puede
  **absorber el paso manual final**: hoy "Auto-montar lote" es un selector de Windows
  (`FLOW-QUEUE.md:67-70`); como comando del registry (`assets.importFolder` o equivalente que
  reutilice `importMediaPaths`, `project-service.ts:1125-1131`, + la acción de montaje de
  `storyboard.ts`), un script puede encadenar: preparar prompts → (extensión o MCP genera) →
  importar carpeta numerada → montar storyboard → renombrar clips con el patrón del proyecto. La
  extensión queda intacta, en su carpeta, con sus tests (`npm run test:extension`,
  `package.json`).
- **Futuro reversible**: si algún día se quiere un puente directo editor↔extensión (p. ej. la cola
  de Flow dispara `assets.importFolder` al terminar), el camino natural es que **la extensión
  escriba el manifiesto y el editor lo consuma como comando**, no un socket entre ambos. Nada de
  esto entra en las fases de abajo: se registra como dirección, no como compromiso.

## Ejemplos de automatización (pseudocódigo referencial, no código del repo)

### Ejemplo A — Renombrar clips en lote

```js
// @editoria nombre="Renombrar tomas en lote" proyecto="true"
// @editoria-capabilities proyecto.edicionar
const patron = "Toma {n} · {original}";           // plantilla simple con dos variables
const pistaId = editoria.selection.get().kind === 'track' ? editoria.selection.get().id : null;

const doc = editoria.project.get();
if (!doc) throw new Error("Necesita un proyecto abierto.");
const clips = pistaId
  ? doc.timeline.clips.filter((c) => c.trackId === pistaId)
  : doc.timeline.clips;

let n = 0;
const renombres = clips.map((c) => {
  n += 1;
  const label = patron
    .replaceAll("{n}", String(n).padStart(3, "0"))
    .replaceAll("{original}", c.label);
  return { clipId: c.id, label };                 // updateClip valida no-vacío; esquema 1..200 (timeline.ts:683)
});

const resultado = await editoria.run("clips.renameBatch", { renombres });
editoria.log(`Renombrados ${resultado.applied ?? 0} clips en un paso de deshacer.`);
```

Puntos de diseño que el ejemplo fija: la lectura es de una **instantánea** (el lote se calcula
completo antes de mutar), la mutación es **un comando de lote** (un undo, un evento de validación),
y los clips con pista bloqueada se saltean con `skipped` (patrón de
`applyAudioPresetToAll`, `project-actions.ts:1845-1850`).

### Ejemplo B — Aplicar un preset a todos los clips de una pista

```js
// @editoria nombre="Preset de audio a toda la pista" proyecto="true"
// @editoria-capabilities proyecto.edicionar
const preset = "dialogo";                          // id de AUDIO_PRESETS (audio-presets.ts:5)
const pista = editoria.selection.get();
if (pista?.kind !== "track") throw new Error("Seleccioná una pista primero.");

const resultado = await editoria.run("track.applyAudioPreset", {
  trackId: pista.id,
  presetId: preset,
});
editoria.log(`Aplicado a ${resultado.applied ?? 0} clips; salteados ${resultado.skipped ?? 0}.`);
```

`track.applyAudioPreset` envuelve a `applyAudioPresetToAll` acotado por pista (el actual opera en
todo el proyecto) — una acción nueva pura en `project-actions` + su registro; mismo contrato
`{ applied, skipped }`. Para efectos visuales el análogo usa `applyEffectPreset`
(`effect-presets.ts:90`) por clip dentro de una sola `store.update`.

### Ejemplo C (fase posterior) — Encadenar el ciclo Flow

Prepara un `.txt` de prompts (`parseFlowPrompts`, `flow-queue.ts:185-198`), lo deja en la carpeta
que consume la extensión, espera el manifiesto y llama `assets.importFolder` + montaje + renombres
del Ejemplo A. Demuestra la composición de comandos como "librería de órdenes reutilizables" que la
fase 5 del roadmap pide para el centro de trabajos (`docs/ROADMAP.md:228-231`).

## Plan de fases con tests

Convenciones: tests TS en archivos nuevos, corridos con
`npx vitest run --no-cache <archivos>` (nunca la suite completa — la corre el integrador);
tocar `packages/project-schema` exige `npm run schema:generate`; zod queda en 3.24.1 y
`zod-to-json-schema` en 3.23.5 (overrides de `package.json`, no se tocan); UI y nombres de tests en
español; convenciones React 19 + jsdom (`children` en props, `new MouseEvent`, `setPointerCapture`
con try/catch); Rust tests en el módulo `#[cfg(test)]` del propio archivo. Cada fase deja el árbol
compilando; si una fase no cierra, se reporta en pendientes sin revertir lo anterior.

### Fase 0 — Registry con esquema (núcleo, sin UI)

`apps/desktop/src/state/command-registry.ts` + `command-registry.test.ts` (nuevos):

- `«un id desconocido devuelve resultado estructurado con mensaje en español»`.
- `«argumentos inválidos se rechazan con el detalle del esquema zod»` (caso bueno, caso con campo
  faltante y caso con tipos incorrectos).
- `«list agrupa por categoría y expone needsProject/mutates»`.
- `«un comando que tira ProjectActionError se traduce a { ok: false, code: 'rejected' }»`.
- `«needsProject bloquea la ejecución sin proyecto abierto»`.
- Criterio de salida: cero toques en archivos existentes; el módulo se importa sin usarse todavía.

### Fase 1 — Comandos de proyecto mínimos (los dos ejemplos primero)

`apps/desktop/src/state/workspace-commands.ts` + `workspace-commands.test.ts` (nuevos):

- Registro de ~10 comandos que envuelven acciones existentes: `clip.rename`, `clip.move`,
  `clip.splitAtPlayhead`, `clip.delete`, `track.rename`, `track.applyAudioPreset` (nueva acción
  pura acotada por pista), `clips.renameBatch`, `track.applyEffectPresetAll`, `playback.toggle`,
  `selection.set`.
- Tests con proyectos de fixture (el patrón de `project-actions.test.ts`): `«renombrar en lote
  valida con el esquema y produce un solo paso de undo»`, `«el lote saltea clips de pistas
  bloqueadas y reporta skipped»`, `«track.applyAudioPreset aplica sólo a clips de audio de esa
  pista»`, `«un renombre vacío o de más de 200 caracteres se rechaza con mensaje en español»`
  (límites de `timeline.ts:683`), `«run de edición sobre proyecto sin abrir devuelve code:
  'no-project'»`.
- Criterio de salida: la paleta y los atajos siguen intactos (sus tests existentes pasan sin
  cambios), árbol compila.

### Fase 2 — Sandbox de ejecución (worker + RPC)

`apps/desktop/src/features/workspace/script-runner.ts` + `script-runner.test.ts` (nuevos):

- Protocolo RPC `{ id, kind: 'run' | 'log' | 'resultado', payload }` como lógica pura con
  **transporte inyectable** (jsdom no tiene Workers reales: los tests del protocolo usan un
  transporte falso; el comportamiento del worker real se verifica manualmente en `tauri:dev` y se
  documenta el resultado).
- Bootstrap del worker: globals limpiados (`fetch`, XHR, WebSocket, EventSource, importScripts,
  Worker anidado, sendBeacon), `globalThis` congelado, timeout con `terminate()`.
- Tests del protocolo: `«un script que pide fetch recibe un error de capacidad, no un silencio»`
  (falso transporte que ejecuta el bootstrap en un objeto global simulado y verifica que la global
  no existe), `«el timeout termina el run con resultado estructurado»`, `«los logs llegan en orden
  con niveles»`, `«un error no atrapado del script llega como { ok: false, message } en español»`.
- Verificación manual documentada (no automatizable en jsdom): worker real dentro de la app, script
  que intenta `fetch('https://ejemplo.test')` y `globalThis.fetch` → ambos fallan; script benigno
  corre.
- Criterio de salida: nada del árbol existente cambia de comportamiento; el runner se consume en la
  fase 3.

### Fase 3 — Panel y consola (UI)

`apps/desktop/src/features/workspace/` (nuevos `WorkspaceView.tsx`, `ScriptsPanel.tsx`,
`ScriptConsole.tsx` + tests `.test.tsx`), vista registrada en `navigation.ts` y `buildCommands`,
`nav.workspace` en `shortcuts.ts` **sin** binding por defecto (no colisiona con Ctrl+1..9 ni con
ninguna tecla existente):

- Tests de componente (React 19 + jsdom): `«la lista muestra nombre, descripción y capacidades de
  la cabecera del script»`, `«Ejecutar corre el runner y pinta las líneas de la consola en orden»`,
  `«un resultado { ok: false } se muestra como error con su mensaje en español»`,
  `«Ejecutar en seco no llama a comandos que mutan»` (mock del runner),
  `«sin proyecto abierto el botón Ejecutar está deshabilitado con su aria-label»`,
  `«el diálogo de capacidades lista lo que pide el script y no corre sin concederlo»`.
- Criterio de salida: typecheck limpio, la vista se abre desde la paleta ("Workspace de código").

### Fase 4 — Trazabilidad y seguridad (provenance + permisos)

- Registrar `AgentOperation` por run con diff JSON Patch (capped 500) — toca
  `packages/project-schema` sólo si hace falta un helper; si se toca, correr
  `npm run schema:generate` y verificar el diff del JSON Schema.
- Tests nuevos (`workspace-provenance.test.ts`): `«un run de lote registra una operación con patch
  que reproduce el cambio»` (aplicar el patch sobre el documento previo reproduce el documento
  posterior), `«el diff que excede 500 operaciones queda declarado en el límite, no corrompe el
  registro»`, `«un script con capability mcp.llamar sin concesión es bloqueado antes de llamar»`.
- Verificación de seguridad documentada (manual + tests donde se pueda): IPC de Tauri no alcanzable
  desde el worker; CSP del webview revisada; correr el script malicioso de laboratorio (intenta
  leer `localStorage`, tocar `document`, abrir red) y documentar el resultado en este documento.

### Fase 5 — Persistencia de scripts y ejemplos incluidos

- Tauri `script_list`/`script_read`/`script_write` acotados a `<proyecto>/scripts/` y datos de app;
  tests en el módulo `#[cfg(test)]` del comando (`«rechaza rutas fuera de scripts/»`,
  `«lista sólo *.js»`).
- Los dos ejemplos de arriba entran como scripts de ejemplo (`scripts-de-ejemplo/renombrar-lote.js`,
  `preset-pista.js`) cargables sin ejecutar.
- Criterio de salida: `npm run typecheck` limpio; los scripts de ejemplo corren en la app contra un
  proyecto de prueba.

## Límites y decisiones abiertas

1. **El sandbox JS del worker no es una garantía absoluta**: es defensa en profundidad; el perímetro
   real es el registry con esquemas. QuickJS WASM (fase objetivo) mejora el aislamiento pero sigue
   siendo software; el modelo de amenaza declarado es "script pegado de un foro", no "atacante del
   runtime del navegador".
2. **No verifiqué en esta investigación** la alcanzabilidad de la IPC de Tauri desde un Web Worker
   ni la CSP vigente del webview: es la primera tarea de la fase de seguridad, con evidencia.
3. **Undo por lote**: los comandos de lote dan un paso de undo; un script que llama comandos
   unitarios N veces produce N pasos por diseño (honesto y predecible). No se propone transaccionalidad
   nueva del store en el MVP.
4. **Diff de provenance en proyectos grandes**: computar el JSON Patch por run puede ser costoso;
   fase 4 debe medirlo (proyecto con cientos de clips) y, si hace falta, muestrear o registrar
   resumen + hash en lugar de patch completa — sin mentir en el esquema (la `patch` es obligatoria
   mín. 1: si no se puede calcular, la operación no se registra y el run queda trazado sólo en la
   consola; se declara en el límite).
5. **Editor de código con resaltado**: fuera del MVP (dependencia nueva). El `textarea`
   monoespaciada cumple; si el workspace crece, CodeMirror (MIT) es el candidato y entraría con su
   propia verificación de licencia.
6. **El operador IA (fase 5 del roadmap) no está diseñado acá**: este documento deja la fundación
   (registro con esquema + capacidades + provenance); el agente que decide *qué* ejecutar es otro
   diseño. Lo mismo el "app como servidor MCP" (fase 7): mismo registro, otro transport.
7. **Alcance de comandos del MVP deliberadamente chico** (~10): cada comando nuevo es superficie de
   seguridad; crece por demanda con el mismo patrón de test, no por enumeración anticipada.
