# Estado arquitectónico actual

**Snapshot de la rama de refactor:** a7cff32.  
**Rama:** architecture/refactor-foundation.  
**Estado del proyecto principal:** el loop concurrente de Devin avanzó main después del snapshot; sus cambios posteriores aún no se han integrado en esta rama.

## Topología del repositorio

| Unidad | Responsabilidad | Decisión |
|---|---|---|
| apps/desktop | UI React + contenedor Tauri | Shell local-first, dominio visual y adaptador nativo |
| apps/render-worker | Worker de render | Mantener contrato de proceso independiente |
| apps/motion-mcp | Servidor MCP de motion | Integración auxiliar |
| apps/project-mcp | Servidor MCP de proyectos | Integración auxiliar |
| packages/project-schema | Documento, validación y migraciones | Fuente canónica del proyecto persistido |
| packages/effect-kit | Catálogo y motor de efectos | Fuente canónica de efectos |
| extensions/* | Puentes e integraciones externas | Fuera del núcleo de UI |

La decisión es un monolito modular por dominios, no microservicios ni un crate Rust por carpeta.

## Frontend: reorganización ejecutada

La UI ya contiene features por dominios. Se conservan sus rutas de entrada y sus lazy imports. La reorganización ha empezado por extraer los puntos de concentración sin cambiar sus contratos públicos.

| Ruta | Antes | Después | Responsabilidad |
|---|---:|---:|---|
| App.tsx | 1.144 líneas aprox. | 138 líneas | Composition root |
| app/Shell.tsx | Integrado en App | 744 líneas | Shell y ciclo de vida de la superficie principal |
| app/view-registry.tsx | Integrado en App | 190 líneas | Lazy loaders, precarga y CSS por vista |
| services/project-service.ts | 5.032 líneas | 3 líneas | Fachada pública estable |
| services/native-service.ts | Integrado | 2.367 líneas | Adaptador nativo Tauri |
| services/contracts.ts | Tipos embebidos | 10 líneas | Barrel de contratos por dominio |
| state/project-store.tsx | 890 líneas aprox. | 7 líneas | Fachada pública |
| state/project-store-provider.tsx | Integrado | 642 líneas | Provider y ciclo de vida del proyecto |
| state/project-store-selectors.ts | Integrado | 64 líneas | Hooks y selectores |
| state/project-store-types.ts | Integrado | 102 líneas | Contratos del store |
| state/project-store-context.ts | Integrado | 13 líneas | Contextos React |

### Contratos del servicio

Se extrajeron 236 declaraciones exportadas (interfaces y tipos) a archivos por dominio: projects, providers, assistant, audio, subtitles, render, integrations, downloader y media. La interfaz DesktopService se compone de interfaces más pequeñas por dominio y mantiene el mismo nombre público mediante una fachada.

La implementación Tauri se trasladó a native-service.ts. Las rutas importadas por los consumidores existentes siguen disponibles.

### Estado del provider del proyecto

El Provider se separó de tipos, contextos y selectores. La fachada pública sigue exponiendo ProjectProvider, hooks y tipos desde state/project-store.tsx. Los cambios de implementación no alteran el formato persistido del proyecto.

## Rust: reorganización ejecutada

| Ruta | Antes | Después | Estado |
|---|---:|---:|---|
| render/ffmpeg.rs | 12.942 líneas aprox. | 5.358 líneas | Implementación + declaración de módulos de prueba |
| render/ffmpeg/tests.rs | Dentro de ffmpeg.rs | 7.062 líneas | Suite principal extraída |
| render/ffmpeg/encoder_tests.rs | Dentro de ffmpeg.rs | 35 líneas | Suite de selección de encoders extraída |

Se conservan los módulos de prueba como módulos hermanos dentro de render::ffmpeg. El contenido extraído recibió rustfmt de forma selectiva. El check selectivo de los tres archivos tocados pasó. No se ejecutó cargo fmt global porque detectó diferencias preexistentes de formato en otros archivos Rust (por ejemplo commands/background.rs, commands/upscale.rs, render/effect_recipes.rs y render/motion.rs); no se reformatearon dichos archivos.

La implementación de producción de FFmpeg aún necesita separarse en perfil/encoders, filtros visuales, audio, planificación y ejecución/verificación. Ese trabajo no se considera terminado.

## Validación observada

- Vitest: project-service.test.ts 18/18.
- Vitest: project-store.test.tsx 5/5.
- Vitest combinado: 23/23 tests, 2 archivos.
- git diff --check: pasó en la rama aislada.
- TypeScript desktop: permanece un error ajeno a los módulos reorganizados: features/editor/PreviewTransformBox.tsx(248,36), clip posiblemente indefinido.
- Typecheck workspace inicial previo a los cambios: ya fallaba en packages/effect-kit/src/engine.test.ts (TS4104 en 198 y 228, TS2339 en 201).
- Rust: rustfmt selectivo pasó; cargo test dirigido en target aislado se está intentando compilar por primera vez. No marcar tests Rust como aprobados hasta ver el resultado de ejecución.

## Riesgos y tareas pendientes

1. Separar servicios nativos por implementación de dominio; native-service.ts todavía tiene más de 2.300 líneas.
2. Dividir el Provider en acciones y coordinación de casos de uso, conservando el Provider façade.
3. Convertir commands Tauri en adaptadores IPC delgados y trasladar lógica a application.
4. Separar ffmpeg.rs por módulos de producción preservando la interfaz pública y pruebas.
5. Revisar y consolidar state/, evitar ciclos y formalizar barreras de imports.
6. Integrar después los commits y cambios posteriores del loop de main con comparación explícita; no sobrescribir ni descartar cambios concurrentes.

## Seguridad de cambios

Todo este refactor está confinado a editor-ia-architecture y architecture/refactor-foundation. No se hizo commit ni push. El directorio principal y el loop concurrente no fueron alterados por este refactor.

## Actualización de ejecución — fase de reorganización local

**Rama aislada:** architecture/refactor-foundation (base a7cff32).  
**No integrada en main:** la rama principal continúa gestionada por el loop de desarrollo existente.

### Frontend
- App.tsx quedó en 138 líneas; Shell.tsx contiene el ciclo de vida global y WorkspaceView.tsx concentra el despacho de pantallas.
- view-registry.tsx contiene lazy loading, precarga y estilos por vista.
- project-service.ts conserva la fachada pública; native-service.ts compone nueve adaptadores por dominio y contracts/ reúne las 236 declaraciones de tipos/interfaces.
- project-store.tsx conserva la fachada; Provider, tipos, contextos y selectores están separados.
- Validación final: **108/108 tests** en App.test.tsx, App.teclado.test.tsx, project-service.test.ts y project-store.test.tsx.
- TypeScript desktop conserva un único error ajeno a esta extracción: features/editor/PreviewTransformBox.tsx(248,36), clip posiblemente indefinido.

### Backend Rust
- Los 78 módulos de comandos están ordenados físicamente bajo nueve dominios en commands/domains/. Los nombres lógicos commands::<módulo> siguen disponibles mediante #[path] en commands/mod.rs.
- commands/registry.rs reúne los 234 handlers IPC y lib.rs delega su registro.
- Se externalizaron 16 submódulos de tests de 13 comandos grandes a archivos adyacentes con #[path], sin cambiar el namespace de los tests.
- render/ffmpeg.rs quedó como fachada con módulos profile, visual, audio, plan y execution; tests separados en ffmpeg/tests.rs y encoder_tests.rs.
- rustfmt --check selectivo pasó para los módulos FFmpeg, el registro Tauri y todo el árbol de comandos movido.
- No se pudo completar cargo test: la dependencia ffmpeg-sys-next requiere headers y bibliotecas de desarrollo FFmpeg que no están instaladas en el entorno aislado. La presencia de ffmpeg.exe/ffprobe.exe no reemplaza ese SDK.

### Alcance restante
- Descomponer la lógica de producción que todavía queda en módulos grandes como downloader.rs, preview_frame.rs, timeline_import.rs, convert.rs y assistant.rs.
- Extraer acciones/coordinación del Provider y revisar límites de estado por dominio.
- Separar casos de uso Rust de adaptadores IPC y de infraestructura.
- Resolver el error preexistente de PreviewTransformBox.tsx como corrección funcional independiente.
- Integrar los commits concurrentes recientes de main mediante reconciliación explícita antes de cualquier merge.

No se hizo commit ni push.

## Segunda ola de descomposición — actualización

### Módulos de comandos y multimedia divididos adicionalmente

Se añadieron más cortes por responsabilidad, sin alterar los namespaces gracias al mecanismo Rust de inclusión de archivos:

| Módulo original | Submódulos |
|---|---|
| providers.rs | chat, test, script, effects, translation |
| youtube_analytics.rs | normalize, engine, analysis, thumbnails, channel |
| creator.rs | hook, cta, aspect, broll, chapters, subtitles |
| mcp_server.rs | catalog, rpc, http, lifecycle |
| mcp.rs | process, sessions |
| stickman.rs | pose_animation, rig, draw, render, particles, command |
| downloader/media_filters.rs | download_state, visual_filters, source_metadata, audio_metadata |
| media.rs | import, color_proxy, lut_thumbnail, filesystem |
| recovery.rs | assets, history |
| screen_record.rs | state, devices, list_devices, start, stop, preview, snapshot |
| intelligence.rs | parsers, cache, measurements, command |
| visuals.rs | catalog, filter_support, catalog_command, audit |
| sharpen.rs | clarity, filters, probe, command; tests en archivo hermano |
| background.rs | runtime, image, video, command |
| render.rs | output, execute, commands |
| dubbing.rs | validation, filter, probe, synthesis, voice, command |
| downloader_bridge.rs | http, routes, jobs |
| proxies.rs | cache, assets, status, commands |
| fcpxml.rs | xml_helpers, timeline, command; tests en archivo hermano |
| shorts.rs | validation, face_analysis, export, face_track; tests en archivo hermano |
| upscale.rs | runtime, image, video; tests en archivo hermano |
| convert/conversion.rs | helpers, engine, single, batch, compression_types, compression_validate, compression_run |

Además se externalizaron suites de tests que permanecían incrustadas en FCPXML, shorts y upscale. Las fachadas públicas siguen presentes.

### Inventario de tamaño

Tras la segunda ola, el único archivo de producción de comandos que permanece por encima de 700 líneas es downloader/downloader/download.rs (750 líneas), que implementa una única rutina de orquestación de descarga. No se ha dividido artificialmente porque no tiene límites independientes entre declaraciones de nivel módulo. Las demás responsabilidades extensas están en archivos parciales cohesivos.

### Validación de formato
- rustfmt --check pasó para todo commands/mod.rs, commands/registry.rs y todos los archivos Rust bajo commands/domains.
- rustfmt --check pasó para render/ffmpeg.rs y todos sus submódulos, incluidos plan y visual.
- git diff --check pasó.

### Validación de comportamiento
- Última ejecución de Vitest focalizada: App, teclado, DesktopService y ProjectStore; registrar el conteo una vez que termine.
- La ejecución Rust cargo test sigue bloqueada por el SDK nativo de FFmpeg ausente (headers y libs de desarrollo). No se atribuye el bloqueo al cambio de organización, pero tampoco se declara compilación Rust aprobada.
- TypeScript desktop conserva el error de baseline en PreviewTransformBox.tsx:248; el loop concurrente en main puede haber corregido su equivalente, pero no se incorporó ningún cambio de main a esta rama.

### Siguiente fase real
La estructura física de comandos y los dos motores más grandes (FFmpeg y descargas) están organizados. El próximo trabajo arquitectónico es separar los casos de uso Rust de los adaptadores IPC, formalizar ports/infrastructure, y establecer reglas automáticas de dependencias. Hacerlo en migraciones verticales con compilación real cuando el SDK FFmpeg esté disponible.

## Cierre de validación de la segunda ola

- Vitest serial: **108/108 tests, 4/4 archivos**, exit code 0. Incluye 76 tests de App, 9 de teclado, 18 de DesktopService y 5 de ProjectStore. La ejecución serial se usa porque la suite de teclado mostró una carrera puntual bajo concurrencia; al repetir el caso aislado pasó 1/1 y el conjunto serial pasó 108/108.
- Auditoría de rutas Rust: se analizaron 255 archivos .rs, 135 macros include! y 98 atributos path; **0 referencias ausentes**.
- rustfmt: rustfmt --check pasó para todo commands/mod.rs, commands/registry.rs, commands/domains/** y el árbol de render/ffmpeg/**.
- git diff --check: sin errores.
- TypeScript desktop (última ejecución tras la reorganización frontend): un error aislado en features/editor/PreviewTransformBox.tsx(248,36), clip posiblemente indefinido. No pertenece a las rutas extraídas. El loop concurrente de main puede haber cambiado su equivalente, pero esa modificación no fue incorporada a esta rama.
- Rust cargo test: no pudo terminar porque el SDK de desarrollo FFmpeg (headers/libs requeridos por ffmpeg-sys-next) no está disponible en el entorno aislado. No se declara compilación Rust validada.
- El único archivo de comando que supera 700 líneas es downloader/downloader/download.rs (750), una única rutina de orquestación; queda como deuda para extraer subfunciones semánticas, no como una fachada mal organizada.

La fase de reubicación y descomposición de archivos queda validada por formato, resolución de rutas y tests frontend. La fase de capas de aplicación/puertos/infraestructura Rust aún no se ha ejecutado ni se debe confundir con la reorganización física ya realizada.

## Tercera ola — plataforma Tauri consolidada y reglas automatizadas

### Cambio ejecutado

Se eliminaron **todos** los imports directos de `@tauri-apps/api` fuera de
`platform/tauri/`:

| Antes | Después |
|---|---|
| `App.tsx`: invoke/listen/emit/getCurrentWindow/LogicalSize | `platform/tauri/app.ts` (`isBackgroundStartMode`, `onAppShowRequested`, `emitAppReady`) + `window.ts` (`enterEditorWindowMode`, `setupCompactWindow`) |
| `app/Shell.tsx`: getCurrentWindow (maximize, onCloseRequested, destroy) | `window.ts` (`ensureWindowMaximized`, `onWindowCloseRequested`, `destroyMainWindow`) |
| `components/MenuBar.tsx`: isFullscreen/setFullscreen | `window.ts` (`isWindowFullscreen`, `setWindowFullscreen`) |
| `components/WindowControls.tsx`: isMaximized/toggleMaximize/onResized/minimize/close | `window.ts` (helpers equivalentes) |
| `hooks/useFileDrop.ts`: getCurrentWebview().onDragDropEvent | `platform/tauri/webview.ts` (`onWebviewDragDrop`, payload normalizado) |
| `features/settings/CapabilitiesCard.tsx`: listen('model-download') | `platform/tauri/events.ts` (`onModelDownloadProgress`) |
| `features/start/StartScreen.tsx`: window/dpi | `window.ts` (`setupCompactWindow`, `maximizeMainWindow`, `minimizeMainWindow`, `closeMainWindow`) |
| `services/contracts/services/*.ts` (6 archivos): `import type { UnlistenFn } from '@tauri-apps/api/event'` | `services/contracts/events.ts` define `UnlistenFn = () => void` local — los contratos ya no dependen de tipos de Tauri |

Se crearon `platform/tauri/app.ts` (ciclo de vida: modo background, bandeja,
app-ready) y `platform/tauri/webview.ts` (drag & drop normalizado). Todos los
adaptadores son no-op seguros cuando `detectNativeRuntime()` es false.

`onWindowCloseRequested` devuelve la Promise del handler para que Tauri la
espere antes de cerrar (misma semántica que el código original).

### Regla automatizada

`scripts/architecture-rules.test.mjs` (7 tests) hace cumplir:

- `features/**`, `components/**`, `hooks/**`, `lib/**`, `state/**`: cero
  imports `@tauri-apps/*` — el único lugar permitido es `platform/tauri/`.
- `services/contracts/**`: cero dependencias de tipos de Tauri.
- `src-tauri/src/projects/**` y `src-tauri/src/media/**`: cero `use tauri`
  (dominio puro).
- `commands/registry.rs`: handlers IPC únicos y >= 234 (baseline del
  contrato; un handler perdido rompe la UI).

### Fix de baseline

`PreviewTransformBox.tsx:248` — `clip` es opcional (vía cues con
`labelOverride`); el `aria-label` leía `clip.label` sin guarda. Se aplicó el
mismo fix que main (`labelOverride ?? clip?.label ?? 'capa'`) más el test de
la vía cue. **TypeScript desktop: 0 errores.**

### Recursos para compilar Rust

El worktree no tenía los binarios bundled (gitignored). Se copiaron desde el
repo principal (sólo lectura del origen): `resources/ffmpeg`,
`resources/ffmpeg-dll`, `resources/tools`, `resources/onnxruntime` (~330 MB).
Con eso `cargo check` puede correr con `CARGO_TARGET_DIR=.target-architecture`
y `CARGO_HOME=.cargo-home-architecture` vía `scripts/rust-env.mjs`.

### Validación de esta ola

- `tsc --noEmit -p apps/desktop/tsconfig.json`: **0 errores** (antes 1 baseline).
- Vitest focalizado (App, teclado, MenuBar, CapabilitiesCard, StartScreen,
  useFileDrop, PreviewTransformBox): **119/119**, 7 archivos.
- `architecture-rules.test.mjs`: **7/7**.
- `cargo check -p editor-ia-desktop`: **0 errores** tras reparar los 99
  errores que la reorganización física había introducido (la rama nunca
  había compilado; sólo rustfmt se había validado).
- `cargo check --tests`: **0 errores**.
- `cargo test -p editor-ia-desktop --lib`: **672 pasados, 0 fallados,
  49 ignorados** (los ignorados son tests live que requieren render o
  `EDITOR_IA_RUN_TTS_TESTS=1`).
- `cargo fmt -p editor-ia-desktop -- --check`: pasó.
- `git diff --check`: pasó.

#### Reparaciones Rust de esta sesión

La primera compilación real destapó deuda de la reorganización física:

- `commands/registry.rs`: `register` era genérico sobre `R: Runtime`, lo que
  dejaba `Invoke<R>` genérico y rompía el impl `CommandArg` de
  `AppHandle<Wry>` (66 errores E0277). Se fijó a `Builder<Wry>`, que es el
  runtime real de la app.
- `convert.rs`: un `#[derive]` quedó sobre un `include!` (E0774); se movió
  al enum `ConversionTarget` en `types_args.rs`, que además recuperó
  `Copy + PartialEq` (los métodos consumen `self` y los callers lo usan
  detrás de referencias).
- `render/ffmpeg`: visibilidad de helpers entre submódulos
  (`fps_arg`, `ensure_asset_unchanged`, `push_filter_complex`) y campos de
  structs `pub(crate)` usados por tests (`TrackPanAutomation`,
  `EffectParamTrack`, `CurvePoint`).
- `screen_record.rs`: la extracción a parciales había perdido
  `chrono_lite_stamp`/`civil_from_days`; restaurados.
- Test `piper::bundled_voice_is_resolvable_in_the_checkout`: fallaba porque
  los binarios bundled (gitignored) no existían en el worktree; se copiaron
  `piper.exe`, `es_voice.onnx` y `es_voice.onnx.json` desde el repo
  principal (sólo lectura del origen).

### Fase 3 — primer corte vertical: Projects

Primera migración real de comandos a capas. El ciclo de vida del proyecto
(create/open/open_at/adopt/save/save_as/close) ya no contiene reglas en el
adaptador IPC:

- `ports/projects.rs`: 5 traits — `ProjectDocuments` (documento
  `.editoria.json`), `ProjectEnvironment` (diálogos, asset protocol, sondeo
  de rutas), `ProjectSession` (sesión nativa + cancelación de renders),
  `ProjectVersioning` (snapshots), `ProjectAssetFiles` (copia/rollback de
  assets).
- `application/projects.rs`: casos de uso con las reglas que antes vivían
  en el comando — slug de nombre, completado de extensión y colisión,
  descripción con asset scope, identidad sesión↔payload, adopt que cancela
  renders, save-as con copia de assets y rollback.
- `infrastructure/projects.rs`: adaptadores — `LocalProjectDocuments` sobre
  `projects::service`, `TauriProjectEnvironment` (diálogos + scope),
  `StateProjectSession` sobre `AppState`, `CommandsProjectVersioning`
  (delega en `commands::recovery` hasta que el versionado migre) y
  `NativeProjectAssetFiles`.
- `commands/domains/projects/projects.rs`: quedó como adaptador IPC —
  construye los ports y delega; conserva `recent_project_thumbnail` y
  `thumbnail_source` (consulta de presentación que combina service + motor
  de medios + caché).

Los 7 handlers IPC conservan nombre, payload y semántica. `projects/`
sigue siendo el dominio puro (regla ya automatizada por
architecture-rules); `OpenedProjectDto` sigue siendo el DTO serde.

**Validación:** cargo check lib+tests 0 errores · tests focalizados
projects+application **28/28** · cargo fmt --check limpio ·
git diff --check limpio.

### Fase 3 — segundo corte: VersionHistory y Relink

- `infrastructure/projects_history.rs` (nuevo): `LocalProjectVersioning`
  implementa `ProjectVersioning` con la lógica completa que vivía en
  `commands/domains/projects/recovery/history.rs` — snapshots en
  `<raíz>/.olyvia-history/`, nombre `<savedAtMs>-<reason>.editoria.json`,
  `HISTORY_LIMIT = 20`, throttle de autosave de 60 s, listado con conteo
  de assets/clips, restauración in-place con backup `before-restore` y
  modo `copy` vía `unique_target`. Incluye sus 3 tests.
- `commands/domains/projects/recovery/history.rs` eliminado (era un
  `include!` huérfano tras la migración).
- `application/projects.rs`: `list_project_versions` (resuelve proyecto
  explícito o de sesión vía `ProjectEnvironment::path_exists`) y
  `restore_project_version` delegando en el port.
- `commands/domains/projects/recovery.rs`: quedó como adaptador IPC —
  `list_project_versions` y `restore_project_version` delegan en
  application+infrastructure; conserva `find_duplicate_assets` como
  consulta de sólo lectura (mismo criterio que
  `recent_project_thumbnail`); `recovery/assets.rs` sigue con relink /
  missing-assets / choose_media_folder sin cambios de contrato.
- `commands/domains/projects/projects.rs`: `CommandsProjectVersioning`
  reemplazado por `LocalProjectVersioning`.

**Validación:** cargo check --tests 0 errores · tests `projects`
focalizados **31/31** (incluye los 3 de history migrados) ·
cargo fmt --check limpio · architecture-rules **7/7** ·
git diff --check limpio. Incidente resuelto: `find_duplicate_assets`
se perdió al eliminar el parcial `history.rs` (árbol no commiteado);
recuperado desde `editor-ia` principal (sólo lectura) y restaurado en
`recovery.rs`.

### Fase 3 — tercer corte: RelinkAssets / recuperación de assets

Cierra la Fase 3 (Projects completa: ciclo de vida + versionado +
relink). `commands/domains/projects/recovery/assets.rs` y su `include!`
fueron eliminados; `recovery.rs` quedó como adaptador IPC puro (~150
líneas, sólo `choose_media_folder` conserva lógica de diálogo):

- `ports/projects.rs`: DTOs de recovery (`MissingAssetInfo`,
  `RelinkResult`, `RelinkFolderRejected`, `RelinkFolderResult`,
  `DuplicateAssetGroup`) y trait `ProjectAssetRecovery` con 5
  operaciones: `missing_assets`, `scan_source_folder` (acotado:
  profundidad 4 / 5000 archivos), `file_size`, `relink_asset` (valida,
  copia a `media/relink` si el origen está fuera de la raíz, verifica
  SHA-256 declarado, repunta el documento sin persistir) y
  `duplicate_groups` (hash + bytes).
- `application/projects.rs`: casos de uso `find_missing_assets`,
  `relink_asset` (sesión únicamente, guarda sólo si `ok`),
  `relink_assets_from_folder` (matching por nombre+bytes, rechazo de
  ambiguos, un solo guardado) y `find_duplicate_assets`. Helpers puros:
  `asset_expected_bytes`, `repository_name`, `file_matches`.
- `infrastructure/projects_recovery.rs` (nuevo): `LocalProjectAssetRecovery`
  con toda la complejidad de filesystem — `asset_paths`,
  `clips_for_asset`, búsqueda de proxies `proxy-{id}-*`, `unique_target`,
  `place_inside_project` (canonicalize + copia), `ensure_asset`,
  `set_asset_path`, hashing SHA-256. Sin Tauri ni sesión.
- Los 7 handlers IPC conservan nombre, payload y semántica; se añadió
  `AppHandle` como parámetro inyectado (no forma parte del payload)
  donde el caso de uso necesita `ProjectEnvironment`.

**Validación Fase 3 completa:** cargo check --tests 0 errores · tests
`projects` focalizados **32/32** · cargo fmt --check limpio ·
architecture-rules **7/7** · git diff --check limpio.

### Fase 4 — slices Media (en curso)

**Slice 1 — ingesta:** `application/media.rs` (nuevo) con
`import_local_files` (tope `ImportLimit::MaxAssets` para el diálogo —
cuenta assets exitosos y avisa — vs `MaxPaths` silencioso para tool
bridges, `skip_missing`, `confirm_generated_rights`) y
`check_asset_files` + `require_ffprobe`. `commands/.../media/import.rs`
y `filesystem.rs` delegan; `AssetFileInfo` se movió a `ports/media.rs`.
`confirm_generated_rights` quedó en application y sus 2 consumidores
(media.rs tests, timeline_import) apuntan ahí.

**Slice 2 — análisis:** helpers puros (`parse_scene_times`,
`scene_filter`, `requested_threshold`) movidos a `media/analysis.rs`
(dominio); DTOs `SceneCut`/`SceneDetection`/`StabilizationAnalysis` y
trait `MediaAnalysisBackend` (ffmpeg_path, run_ffmpeg, ensure_dir,
file_exists, remove_file) en `ports/media.rs`; adaptador
`StateMediaAnalysis` en `infrastructure/media.rs` (AppState +
resolve_tools + Command ocultando consola); casos de uso
`detect_scenes`/`analyze_stabilization` en `application/media.rs` con la
validación compartida `ready_video_asset` (kind=video, status=ready,
fuente dentro del root). `commands/.../media/analysis.rs` quedó en ~50
líneas de adaptador.

**Validación:** cargo check --tests 0 errores · tests `media`
focalizados **29/29** · cargo fmt --check limpio ·
architecture-rules **7/7** · git diff --check limpio.

**Slice 3 — timeline import:** el módulo `commands/.../timeline_import/`
(5 parciales, ~1200 líneas) se dividió por capa real:

- `media/timeline_import.rs` + `media/timeline_import/` (dominio puro):
  tipos `ParsedTrack`/`ParsedClip`/`ParsedTimeline`/`TrackKind`,
  constantes de límites, parsers EDL/OTIO/FCPXML y helpers
  (`detect_format`, `project_fps`, `resolve_media`, `ensure_track`,
  `seconds_to_frames`). Los ~950 líneas de tests se movieron con ellos a
  `media/timeline_import.tests.rs`.
- `application/timeline_import.rs`: `import_timeline_file` — la
  orquestación completa (formato → tamaño → parseo → resolución de
  medios → `import_file` → tracks/clips con todas las reglas de recorte,
  velocidad y warnings).
- `ports/media.rs`: DTO `TimelineImportResult`.
- `commands/.../timeline_import.rs`: ~100 líneas de adaptador IPC
  (`choose_timeline_file`, `import_timeline` con `spawn_blocking`).

**Validación:** cargo check --tests 0 errores · tests
`timeline_import` focalizados **28/28** · cargo fmt --check limpio ·
architecture-rules **7/7** · git diff --check limpio.

**Slice 4 — probe y VMAF:** `MediaTools` (rutas ffmpeg/ffprobe) y
`MediaRunner` (run_ffmpeg/run_ffprobe/ensure_dir/file_exists/remove_file)
en `ports/media.rs`; adaptadores `StateMediaTools` y `SystemMediaRunner`
en `infrastructure/media.rs`; DTO `MediaProbe` en ports y
`parse_vmaf_score` en `media/analysis.rs` (dominio puro). Casos de uso en
`application/media.rs`: `probe_file_json`, `probe_any_file`,
`vmaf_available` (cache `OnceLock`) y `measure_vmaf`. El comando
`probe_vmaf.rs` quedó como adaptador IPC delgado y conserva
`resolve_tools_public`, `vmaf_filter_available` y `CompressAnyRequest`
que otros módulos de comandos reutilizan. `compression.rs` consume
`application::media::probe_file_json` en lugar del helper local.

**Validación:** cargo check --tests 0 errores · tests `convert`
focalizados **21/21** (incluye live VMAF y compresión real) ·
cargo fmt --check limpio · git diff --check limpio.

**Slice 5 — timeline export (EDL/OTIO/FCPXML):** los tres exportadores
compartían el mismo patrón (validar dir → `expand_compounds` → builder →
chequeo de vacío → stem único → escritura temp+rename) duplicado en los
comandos.

- `media/timeline_export.rs` + `media/timeline_export/{edl,otio,fcpxml}`:
  builders puros (`build_edl`, `build_otio`, `build_xml`), helpers de
  timecode/OTIO/FCPXML y `OmittedClips` (movido desde `commands/mod.rs`)
  + `export_stem`. Los tests se movieron con ellos; los que ejercitan el
  comando IPC llaman `crate::commands::{edl,otio,fcpxml}::export_*`.
- `ports/media.rs`: `TimelineExportOutcome` + trait `TimelineExportFiles`
  (`is_dir`, `publish` con nombre único y escritura atómica).
- `infrastructure/media.rs`: `LocalTimelineExportFiles` — una sola
  implementación del patrón temp+rename que antes estaba copiado 3 veces.
- `application/timeline_export.rs`: `export_edl`/`export_otio`/
  `export_fcpxml` — expand → build → validaciones (vacío, XML válido por
  roxmltree) → publish. `commands/{edl,otio,fcpxml}.rs` quedaron como
  adaptadores delgados que conservan nombre, payload y DTOs.

**Validación:** cargo check --tests 0 errores · tests de export/import de
timeline **72/72** (incluye round-trips EDL/OTIO/FCPXML) ·
cargo fmt --check limpio · architecture-rules **7/7** ·
git diff --check limpio.

### Fase 4 — cierre

**Fase 4 (Media/Timeline vertical) completa** con este alcance:
ingesta de medios, chequeo de assets en disco, análisis (escenas +
estabilización), import de timeline (EDL/OTIO/FCPXML), probe/VMAF de
archivos y export de timeline (EDL/OTIO/FCPXML). Los comandos IPC de
estos casos de uso son adaptadores delgados sobre
application/ports/infrastructure.

Queda fuera de esta fase, por frontera ya documentada en el roadmap:

- ~~**Conversión** (`convert/*`)~~ → migrado en Fase 7 (ver abajo).
- ~~**Proxies** (`proxies/*`)~~ → migrado en Fase 7 (ver abajo).
- **Resto de comandos media** (preview_frame, image_sense, models,
  denoise, lottie, upscale, face, thumbnail, sharpen, visuals,
  media_tools, capabilities): se auditan en la fase de render/FFmpeg o
  AI según su dependencia real; varios ya son dominio puro testeado.

### Fase 5 — slices Render (en curso)

**Slice 1 — cola de render persistida:** `render/queue.rs` (dominio) con
`QueueEntry`/`QueueStatus`/`RENDER_QUEUE_LIMIT`, `recover_entries`
(recuperación `running → pending` + cap) e `is_unfinished`.
`ports/render.rs` (nuevo) con trait `RenderQueueStore`;
`infrastructure/render_queue.rs` con `LocalRenderQueueStore` (JSON en
`%LOCALAPPDATA%\com.editoria.desktop\render-queue.json`, degrada a vacío
ante archivo faltante/corrupto); `application/render_queue.rs` con
`load`/`save`/`clear_finished`. `commands/render_queue.rs` quedó en ~35
líneas de adaptador IPC.

**Validación:** cargo check --tests 0 errores · tests `render_queue`
**6/6** · cargo fmt --check limpio · git diff --check limpio.

**Slice 2 — exportaciones sin recodificar (lossless):**
`render/lossless.rs` (dominio) con DTOs (`LosslessResult`,
`ChapterInput`, `ChaptersResult`, `ExtractResult`), validaciones
(`valid_range`, `valid_container`), `chapters_metadata`, `audio_container`
y parsers ffprobe puros. `ports/render.rs` suma trait `LosslessOutputs` +
`ReservedOutput` (reserva atómica `create_new` con guard de File y
sidecar ffmeta). `infrastructure/render_lossless.rs` implementa la
reserva con nombres únicos `<stem>-N` sin pisar entregas existentes.
`application/lossless.rs` orquesta `export_lossless`, `remux`,
`write_chapters` y `extract_audio` sobre `MediaTools`/`MediaRunner`/
`LosslessOutputs` — mismos mensajes de error y semántica (corte en
keyframe reporta `start_shift_seconds`, sidecar se borra siempre).
`commands/lossless.rs` quedó en ~85 líneas de adaptador IPC.

**Validación:** cargo check --tests 0 errores · tests `lossless`
**10/10** · cargo fmt --check limpio · git diff --check limpio.

**Slice 3 — capacidades de export y verificación:**
`render/export_tools.rs` (dominio) con los DTOs serde
(`ContainerCapability`, `CodecCapability`, `ExportCapabilities`,
`ExportVerification`), la matriz `matrix_from_encoders` (mp4/mov/webm
sólo con lo que el binario declara; 4:4:4 sólo con libvpx-vp9/libaom-av1)
y `parse_verification` (codec/contenedor/fps/HDR desde el JSON de
ffprobe). `application/export_tools.rs` resuelve tools por `MediaTools`,
ejecuta el sondeo por `MediaRunner` y mide el archivo por
`LosslessOutputs::file_bytes`; `verify_export_file` conserva los mismos
errores (`NotFound` si el archivo está vacío, `Io` si ffprobe no arranca,
`RenderFailed` si el probe sale mal). `commands/domains/render/
export_tools.rs` quedó en ~55 líneas de adaptador IPC y re-exporta los
DTOs para no romper `commands::render` ni el worker (`verify_file`
delega en application con `SystemMediaRunner` + `LocalLosslessOutputs`).

**Validación:** cargo check --tests 0 errores · tests `export_tools`
**9/9** · cargo fmt --check limpio · git diff --check limpio.
Nota de entorno: el `CARGO_HOME` configurado (`D:\DevCache\Rust\cargo`)
perdió permiso de escritura en `registry/src` (ACL quedó en sólo
lectura); la compilación se verificó vía `scripts/rust-env.mjs`, que ya
resuelve el fallback `target/.cargo-home` + FFMPEG_DIR + libclang.

**Slice 4 — consolidación de detección de encoders:**
el sondeo funcional de hardware (estaba duplicado como sistema paralelo en
`commands::audio`) se unificó en `render/ffmpeg/probe.rs`: `HardwareEncoders`,
las listas de preferencia `HW_*` (nvenc→qsv→amf→videotoolbox), la prueba real
`encoder_works` (codificación lavfi de 0,1 s por candidato), `detect_hardware`,
`detect_hardware_cached` (caché por binario, antes vivía en el comando) y
`hardware_h264`. `commands::audio` re-exporta los símbolos para no romper las
rutas `commands::audio::*` que usan convert/proxies/system; el comando
`hardware_encoders` quedó delegando en `detect_hardware_cached`.
`pipeline_profile` y `sharpen/probe` ahora llaman al camino canónico
`render::ffmpeg`. Las listas `HARDWARE_*` de `profile.rs` se conservan: son
validación de elección explícita, no sondeo de disponibilidad.

**Validación:** cargo check --tests 0 errores · tests audio/probe/sharpen
**22/22** · cargo fmt --check limpio · git diff --check limpio.

### Fase 5 — pendiente dentro de la fase

- `pipeline_profile.rs`: módulo helper sin comandos IPC usado por
  downloader; ya consume el sondeo unificado (`render::ffmpeg::detect_hardware`).
  Pendiente decidir si migra con el motor de conversión/Jobs.
- Ciclo de vida del render (`render/{commands,execute,output}.rs`):
  workers con estado, threads, eventos y verificación — pertenece al
  port de Jobs unificado (Fase 6/7), no a un segundo sistema.
- Motor de conversión (`commands/convert/*`): encode FFmpeg con progreso
  y eventos — migra junto al ciclo de vida del render/Jobs.

### Fase 6 — AI/MCP (completa)

**Slice 1 — importación de archivos de subtítulos:**
`media/subtitle_file.rs` (dominio) con `SubtitleFile`, validaciones
puras granulares (`validate_subtitle_extension`, `validate_subtitle_len`,
`decode_subtitle_text`, `subtitle_name`) que preservan el orden histórico
de errores. `SubtitleFiles`/`SubtitleFileMeta` en `ports/media.rs`;
`LocalSubtitleFiles` en `infrastructure/media.rs` (metadata + read).
`application/media.rs::read_subtitle_file` orquesta; el comando
`choose_subtitle_file` quedó en ~40 líneas (sólo el diálogo nativo) y
re-exporta `SubtitleFile` para no romper el contrato IPC.

**Validación:** cargo check --tests 0 errores · tests `application::media`
**9/9** (5 de subtítulos migrados desde el comando) · cargo fmt --check
limpio · git diff --check limpio.

**Slice 2 — proveedores IA (`ai/providers`):**
- `ai/providers.rs` (dominio): DTOs serde (`ProviderInfo`, `ScriptPlan`,
  `EffectRecipe`, `TranslatedTexts`, `ProviderTestResult`, requests),
  endpoints (`chat_endpoint`, `models_endpoint`, `is_local_endpoint`,
  `validate_provider_base_url`), payload/repair de chat
  (`chat_payload`, `should_retry_without_json_mode`, `json_repair_messages`,
  `MAX_REPAIR_ECHO_CHARS`), parsers (`extract_json`, `parse_script_content`,
  `plan_from_raw`, `validate_plan`, `parse_translations`, `clean_effect`),
  mocks y bounds (`MAX_BRIEF_CHARS`, `MAX_SCENES`, `MAX_TRANSLATE_*`).
- `ports/ai.rs`: `ProviderSecrets` (keyring), `ProviderSettingsStore`
  (AppState), `ProviderChat` y `ProviderProbe` — los cuatro con
  `Send + Sync` para que los futures IPC sean `Send`.
- `infrastructure/ai.rs`: `KeyringProviderSecrets` (Windows Credential
  Manager), `StateProviderSettings`, `ReqwestProviderChat` (JSON mode con
  retry sólo en 400/415/422, body cap 2 MB, timeout 120 s) y
  `ReqwestProviderProbe` (`{base}/models`, estados clasificados).
- `application/providers.rs`: los 7 casos de uso (get/save/clear key,
  generate_script, generate_video_effect, translate_subtitles, test_provider)
  con la orquestación: validación → aprobación de costo remota → key →
  mock remoto → chat con un retry de reparación → parseo acotado.
- `commands/domains/ai/providers.rs`: ~140 líneas de adaptador IPC; los
  `pub use` mantienen `commands::providers::*` para assistant, motion_ai y
  subtitles_pipeline sin tocarlos. `ChatRequest`/`read_key`/
  `chat_completion` siguen siendo `pub(crate)` para esos consumidores.

**Validación slice 2:** cargo check --tests 0 errores · tests
`ai::providers` **19/19** + `infrastructure::ai` **7/7** (servidor HTTP
local real: retry sin JSON mode, 401 sin retry, sondeo 200/401/404,
timeout, transporte) · cargo fmt --check limpio · git diff --check limpio ·
architecture-rules 7/7.

**Slice 3 — localization studio:** `media::localized_subtitle` (dominio:
safe_token/validate_format/validate_content/localized_file_name),
`LocalizedSubtitleFiles` en `ports/media.rs`,
`LocalLocalizedSubtitleFiles` en infrastructure (temporal oculto + rename
atómico) y `application::localization::save_localized_subtitle` con el
bucle de nombre único. Comando IPC en ~25 líneas, firma intacta.

**Slice 4 — watchdog de cola (`agent`):** `ai::watchdog` (dominio: nombres
de tareas, `install_args`/`delete_args` de schtasks, `WatchdogStatus`),
`WatchdogTasks` en `ports/agent.rs`, `SchtasksWatchdog` en
`infrastructure/agent.rs` y `application::agent` (status/install/remove/
silent). `remove_watchdog_silent` sigue siendo `pub` para `lib.rs`.

**Slice 5 — motion_ai:** `ai::motion` (dominio: DTOs, `motion_template`,
`validate_brief`, `motion_schema`/`motion_system_prompt`,
`clean_motion_props`, `extract_message_content`, `mock_motion`),
`MotionChatCall`/`MotionChat` en `ports/ai.rs` (POST único sin JSON mode,
con los errores propios del comando: `ProviderRejected` HTTP,
`InvalidProviderResponse`), `ReqwestMotionChat` en infrastructure y
`application::motion::generate_motion`. Comando en ~25 líneas.

**Slice 6 — assistant:** `ai::assistant` (dominio ~1.200 líneas: DTOs
`AssistantMessage`/`AssistantReply`/`MatchMediaRequest`, validación de
mensajes y acciones con allowlist, `clean_action`/`clean_reply`, contexto
del proyecto + packing del catálogo MCP acotado, prompts y parsing de
respuesta estructurada, mocks, media-match con asignaciones exactas, y
todo el bloque SSE: `stream_request_body`, parser incremental de chunks,
`consume_sse_stream` con cancelación, registry de streams activos),
`media::folder::sanitize_media_folder_name` (dominio puro compartido),
`application::assistant` (chat regular + media matching con
validación de asignaciones), comandos IPC delgados
(`assistant_chat`/`assistant_chat_stream`/`cancel_assistant_stream`/
`match_media_plan` con nombres intactos) y el worker de streaming en
`commands/domains/ai/assistant/stream.rs` (usa `AppHandle`/eventos/threads,
permanece en el adaptador). `read_key` quedó como fachada síncrona sobre
`ProviderSecrets` para el worker; `ChatRequest`/`chat_completion` se
eliminaron por quedar sin consumidores.

**Validación slices 3-6:** cargo check --tests 0 errores · tests
localized_subtitle+localization **4/4** · watchdog **2/2** · motion
**6/6** · assistant+folder **24/24** (1 live ignorado) ·
cargo fmt --check limpio · git diff --check limpio ·
architecture-rules **7/7**.

**Slice 7 — cliente MCP (`mcp`):**
- `mcp/client.rs` (dominio): DTOs serde (`McpServerConfig`, `McpServerInput`,
  `McpEnvInput`, `McpToolInfo`, `McpProbeResult`, `McpCallResult`,
  `McpSessionInfo`), límites, `validate`/`valid_env_key`,
  `needs_cmd_shell`/`check_shell_launch` (metacaracteres cmd), builders
  JSON-RPC (`initialize`, `notifications/initialized`, `tools/list`,
  `tools/call`), `handshake_fields` y `parse_tools`.
- `ports/mcp.rs`: `McpServerStore` (JSON atómico), `McpEnvSecrets`
  (keyring por `server_id:key`, con `remove_key`), `McpTransport`
  (`send`/`receive_for`/`pid`, `Send`) y `McpTransportFactory`.
- `infrastructure/mcp.rs`: `LocalMcpServerStore`, `KeyringMcpEnv` y
  `StdioMcpTransport` (spawn con `cmd /C` para npx/npm/.cmd, pipes,
  hilos stdout/stderr con cola de 24 líneas, `receive_for` con timeouts y
  `kill_tree` vía `taskkill /T`).
- `application/mcp.rs`: CRUD (`list`/`save`/`delete`), `SessionRegistry`
  inyectable (reap por inactividad, `MAX_SESSIONS` con eviction de la más
  ociosa, `try_lock` para evitar deadlock registry↔sesión), `probe_config`
  efímero y `call_config`/`call_tool` con sesión persistente e
  inicialización perezosa. La orquestación del protocolo
  (handshake/list/call) vive aquí, no en infrastructure.
- Comandos IPC delgados (~115 líneas): `list_mcp_servers`,
  `save_mcp_server`, `delete_mcp_server`, `probe_mcp_server`,
  `call_mcp_tool`, `close_mcp_session`, `mcp_session_status` — nombres
  intactos. Los parciales `mcp/process.rs`/`mcp/sessions.rs` se eliminaron.

**Validación slice 7:** cargo check --tests 0 errores · tests MCP
**24/24** (5 dominio + 4 live node: probe/call, estado de sesión,
stderr tail, Playwright MCP) + 12 tests mcp_server intactos ·
cargo fmt limpio · git diff --check limpio.

**Slice 8 — servidor MCP embebido (`mcp::server`):**
- `mcp/server.rs` (dominio): constantes del endpoint, DTOs
  (`McpServerInfo`, `DetectedClient`, `AutoconnectResult`, `McpReply`),
  catálogo `tools()` con `normalize_json_schema` y anotaciones de riesgo,
  `collect_read_only_tools`, `classify_request`/`RpcRequest` (Call /
  Notification / Reject), `call_parts`, `is_parallel_read_request`,
  `tool_result`/`rpc_result`/`rpc_error`, `client_entry`,
  `known_clients`, `merge_olyvia_entry` y los parsers HTTP puros
  (`header_value`, `is_json_content_type`, `request_content_length`).
- `ports/mcp_server.rs`: `McpServerToken`, `McpToolInvoker` (bridge async
  a la ventana), `McpRequestHandler` (handle/handle_batch con futures
  boxed) y `AiClientConfigs`.
- `infrastructure/mcp_server.rs`: `KeyringMcpServerToken` (token Bearer
  persistente), `TauriMcpToolInvoker` (pending map + evento `mcp-call` +
  timeout, `respond_pending` para `mcp_respond`), `EnvAiClientConfigs`
  (detección Claude Desktop/Antigravity por env+fs, merge no destructivo)
  y `serve_mcp` (bind 127.0.0.1:31417, accept loop con semáforo de 32
  conexiones, serve HTTP con timeouts y límites de headers/body).
- `application/mcp_server.rs`: `RpcDispatcher<I>` implementa
  `McpRequestHandler` (initialize/ping/tools-list con catálogo del
  frontend + fallback, tools/call, lotes paralelos sólo-read con chunks
  de 8), cache read-only, `start_server`/`status` con info slot y start
  lock, `ensure_client_ready`/`autoconnect_client`/`detect_clients`.
- Comandos IPC delgados: `start_mcp_server`, `mcp_server_status`,
  `mcp_detect_clients`, `mcp_server_autoconnect`, `mcp_respond` —
  nombres intactos. Los 4 parciales `mcp_server/*` y sus tests se
  eliminaron tras migrar.

**Validación slice 8:** cargo check --tests 0 errores · tests MCP server
**14/14** (12 dominio + token keyring real + detect clients) ·
cargo fmt limpio · git diff --check limpio · architecture-rules **7/7**.

**Fase 6 COMPLETA:** providers, assistant, localization, watchdog/agent,
motion_ai, cliente MCP y servidor MCP embebido migrados al patrón
ports/application/infrastructure con comandos IPC delgados.

### Fase 7 — Jobs/Eventos unificados (completa)

**Slice 1 — proxies migrados al patrón ports/application/infrastructure:**

- `media/proxy.rs` (dominio): DTOs `ProxyStatus`/`ProxyProgressEvent`/
  `ProxyCleanupResult`/`ExistingProxy`, naming y parseo de la huella en
  el nombre del archivo, `parse_quality`/`scale_for`, `proxy_video_args`
  (movido desde `commands::audio`, que lo re-exporta),
  `progress_percent_from_line` (`out_time_us=` → %), `empty_status` y
  `pick_existing` (elección del mejor candidato del cache).
- `ports/proxies.rs`: `ProxyRuntime` (mapa asset→{status, flag} con
  `begin`/`update`), `ProxyFiles` (cache + huella del origen),
  `ProxyEvents` (`proxy-progress`), `ProxyGenerator`/`ProxyJob` (worker
  FFmpeg en background — semilla del port de Jobs unificado).
- `infrastructure/proxies.rs`: `LocalProxyRuntime` (mapa global que
  antes era `RUNTIMES` estático en commands), `LocalProxyFiles`,
  `TauriProxyEvents` y `StdioProxyGenerator`: el worker completo
  (spawn `-progress pipe:1`, cola stderr 600 chars, throttle 2%/500 ms,
  `.part.mp4` + rename, verificación FFprobe, cancelación por flag)
  movido verbatim desde `proxies/commands.rs`.
- `application/proxies.rs`: `current_status`, `proxy_status`,
  `ensure_proxy`, `cancel_proxy`, `apply_proxy_to_asset`,
  `cleanup_proxies` — misma semántica y mensajes de error.
- `commands/domains/media/proxies.rs`: ~140 líneas de adaptadores IPC;
  los 4 parciales `proxies/*` eliminados.
- `infrastructure/process.rs` (nuevo): `hide_console` movido desde
  `commands/mod.rs` (re-export preserva `commands::hide_console`).

Validado: `cargo check --tests` 0 errores · tests `media::proxy` 5/5 +
`commands::audio` 5/5 (proxy_video_args vía re-export) · `cargo fmt`
limpio · `git diff --check` limpio.

**Slice 2 — ciclo de vida del render migrado:**

- `render/lifecycle.rs` (dominio): DTOs `RenderStarted`/`RenderProgressEvent`/
  `RenderFinishedEvent` (verification → `render::export_tools`), `safe_name`,
  `ensure_mp4`.
- `ports/render.rs` (ampliado): `RenderProcess` (`try_wait`/`request_cancel`/
  `is_cancelled`), `RenderRuntime` (busy/first/register/unregister/cancel/
  cancel_all), `RenderEvents`, `RenderFiles` (canonical/temp_dir/publish/
  prune), `RenderDialogs`, `RenderEncoder`/`SpawnedRender`, `RenderVerifier`,
  `RenderLaunch` y `RenderLauncher` — el contrato `launch(job)` compartido
  con `StdioProxyGenerator::generate(job)`.
- `infrastructure/render_jobs.rs`: `ChildRenderProcess` (Child+flag),
  `SharedRenderRuntime` sobre `AppState::render_jobs` (que ahora guarda
  `Arc<dyn RenderProcess>`; `RenderJob`/`SharedRenderJobs` viejos eliminados
  y `cancel_all_renders` actualizado), `LocalRenderFiles`,
  `TauriRenderEvents`/`TauriRenderDialogs`, `SystemRenderEncoder`
  (`ffmpeg::spawn` + pipes), `SystemRenderVerifier` (mismo compose que
  `verify_export_file`) y `StdioRenderLauncher`: worker con threads de
  progreso/stderr, espera 120 ms, verify+publish+bytes-match y eventos
  cancelled/failed/completed — verbatim desde `render/{execute,output}`.
- `application/render_lifecycle.rs`: `start_render` (validación → proyecto →
  perfil → motion → output → tempdir → safety → plan → spawn → register →
  progress → launch), `cancel_render`, `active_render`,
  `choose_export_directory`, `prune_render_cache`, `ensure_output_is_safe`.
- `commands/domains/render/render.rs`: 6 comandos IPC delgados; los 3
  parciales `render/{commands,execute,output}.rs` eliminados. Los tests de
  publish/safety se reubicaron en `infrastructure::render_jobs::tests`.

Validado: `cargo check --tests` 0 errores · tests `render_jobs` 3/3 ·
`cargo fmt` limpio · `git diff --check` limpio.

**Slice 3 — motor de conversión/compresión/lote migrado:**

- `media/conversion.rs` (dominio, ~640 líneas): `ConversionTarget`
  (allowlist + `accepts` por kind), `EncoderPref`/`EnhanceOptions`/
  `ConvertOptions` (`simple`, `audio_kbps`), `ConversionResult`,
  `ConvertProgress`, `BatchConversionItem`, `CompressRequest`/
  `CompressAnyRequest`, `CompressParams`/`CompressInput`,
  `LiveProgress` (callback Arc para el hilo de progreso), helpers puros
  (`safe_stem`, `unique` vía port, `parse_out_time_us`,
  `parse_probe_result`, escalas `crf_for_quality`/`jpeg_qscale`/
  `webp_quality`/`quality_bitrate_kbps`/`video_bitrate_for_target`,
  `scale_filter`/`video_filter_chain`/`audio_filter_chain`,
  `h264_encoder`/`hevc_encoder`, `push_rate_control`, `build_args` —
  vector de argumentos FFmpeg sin shell) y
  `validate_compress_target_mode` (la parte I/O de la validación —
  `is_dir`— quedó en application vía port).
- `ports/conversion.rs`: `ConversionFiles` (is_dir/is_file/exists/len/
  remove/rename/`unique_output`), `ConversionRunner` (`run` = worker
  completo), `ConversionEvents` (`compress-progress` porcentaje +
  `convert-progress` por ítem), `ConversionHardware` (detección NVENC/
  AMF/QSV con caché) y `ConversionDeps`.
- `infrastructure/conversion.rs`: `LocalConversionFiles`,
  `TauriConversionEvents`, `SystemConversionHardware`
  (`detect_hardware_cached`) y `SystemConversionRunner` con el worker
  verbatim (`-nostats -progress pipe:1`, thread stderr cap 256 KB, thread
  `out_time_us=`→%, espera, borrado del temporal en error, rename
  atómico, sondeo ffprobe no fatal del resultado).
- `application/conversion.rs`: `convert_media`, `convert_media_batch`
  (nunca aborta el lote; `unique_output` por ítem), `compress_media`,
  `compress_any_file` (sondeo por contenido, sin proyecto) y el tramo
  común `compress_input` (quality→CRF | size→bitrate budget).
- `commands/domains/media/convert.rs`: 4 comandos IPC delgados;
  `probe_vmaf.rs` quedó como submódulo autónomo (`probe_any_file`,
  `measure_vmaf`, `resolve_tools_public`, `vmaf_filter_available`).
  Los 8 parciales `convert/{types_args,conversion,compression,conversion/*}`
  eliminados. `convert_media` ganó `AppHandle` inyectado (no cambia el
  contrato IPC). Los 18 tests se reubicaron en
  `application/conversion.tests.rs`.

**Decisión sobre `infrastructure/jobs.rs`:** con los tres consumidores
migrados se evaluó extraer un runner genérico. Los tres comparten la
forma spawn→pipes→wait→publish, pero difieren en parsing de progreso
(% proxy, frames render, `out_time_us` conversión), cancelación
(render/proxy sí, conversión no) y verificación post-publish. Un runner
genérico necesitaría 4-5 hooks por consumidor y no eliminaría código
real: se decidió mantener los tres workers separados tras sus ports —
el contrato común es la forma del port, no el motor.

Validado: `cargo check --tests` 0 errores · tests `application::conversion`
18/18 · `cargo fmt` limpio · `git diff --check` limpio.

### Reconciliación 3 con main (delta 34cefcb..f10fadb)

- **Shuttle inverso J** (`713ebc5`): `playbackDirection` (1/-1) en el
  project-store — portado a los 4 módulos del split
  (`PlaybackDirectionContext`, `useProjectPlaybackDirection`,
  `useProjectPlayback().direction`) y el caso `playback.shuttleReverse`
  + `setPlaybackDirection` en `app/Shell.tsx` (el shortcut handler vive
  ahí tras el refactor, no en App.tsx).
- 11 archivos copiados desde `git show HEAD:` (Preview, Transport,
  usePlayback, shortcuts, Icon `playReverse`, tests, docs, memoria).
- **NO portado (WIP sin commitear en main)**: `state/shuttle.ts` +
  `shuttle.test.ts` + cambios en App.tsx/Transport.tsx — rampa de
  velocidad del shuttle en curso; se porta cuando se commitee.
- **Verificación**: typecheck raíz verde · vitest 16/16 en las áreas
  tocadas (project-store direction, Transport, shortcuts-pro) ·
  diff --check limpio.

### Reconciliación 2 con main (delta 73fabb6..34cefcb)

Segundo delta auditado y portado (30 commits nuevos en main):

- **Frontend/packages**: 54 archivos copiados desde main HEAD
  (autoedit export lote, keyframes UI, easing por parámetro, forma
  custom del titler + PolygonEditor, plantillas de fábrica, transiciones
  por lote en VisualsView, velocidad 0.25–4× y botón Bucle, luma-mate,
  descarga 12 idiomas, thumbnails de transiciones, project-store con
  playbackRate portado a los 4 módulos del split).
- **Rust**: `luma-wipe` con clip mate (`plan/luma.rs`:
  `luma_mate`/`luma_wipe_graph`/`luma_frozen_graph` + input extra en
  `build_plan_range`), `iris` en wipe_alpha_expr + fix `gte` en
  wipe-left/up, `preview_frame` frozen `mode:"luma"`, catálogo/audit de
  transiciones completo (wipe×4, iris, dip-color, luma-wipe), forma
  `custom` en motion graphics.
- **Verificación**: cargo check --tests 0 errores · tests del port
  6/6 (luma plan, custom shape ×2, preview freezes, catálogo,
  transiciones) · typecheck raíz completo en verde (el error
  preexistente de engine.test.ts quedó resuelto por el sync) ·
  vitest 49/49 en las áreas tocadas · cargo fmt + diff --check limpios.

### Reconciliación con main (post-Fase 7)

Delta `a7cff32..main-HEAD` (19 commits) auditado y portado:

- **44 archivos frontend** (autoedit, inspector, localization, light
  .flare/.leak, PreviewTransformBox, effect-kit, project-schema) —
  verificados idénticos a la base del refactor y copiados desde main
  HEAD; contenido igual, EOL normalizado por git.
- **Providers**: idiomas `fr`/`de`/`it`/`ja` ya presentes en
  `ai/providers.rs` del worktree.
- **Bench audio_scopes** (`73fabb6`): `[profile.release-nolto]` en
  Cargo.toml raíz y `bench_analyze_pcm_throughput` ya presentes.
- **Proxies huérfanos**: cleanup de `media/proxies` portado —
  `ProxyFiles::orphan_candidates`/`remove_orphans` en ports+infra,
  `cleanup_orphans` en application, hook en adopt/close de proyecto,
  comparación de paths canonicalizada en `adopt_project`.
- **slide-3d-*** (`7b107c4`): portado a los submódulos —
  `visual/helpers.rs` (`slide_axis`, `slide3d_transition_filter`,
  `slide3d_frozen_filter`, overlay x/y), `visual/filter.rs` (dispatch
  live + frozen `mode=="slide3d"`), `preview_frame/timeline.rs`
  (`freezable_transition` + `window_project` frozen metadata),
  `visuals/catalog.rs` + `visuals/audit.rs` allowlists, tests en
  `render/ffmpeg/tests.rs` (`extra_transitions_change_the_filter_chain`)
  y `preview_frame.tests.rs`.

**NO portado (WIP sin commitear en main)**: `luma-wipe` +
`mateClipId` (timeline.ts, schema, Inspector, Timeline,
project-actions, preview_frame.rs, visuals.rs, ffmpeg.rs,
effects.test.ts) — trabajo en curso del usuario en el repo main;
queda como delta pendiente hasta que se commitee.

**Verificación**: cargo check --tests 0 errores · lib tests 689+1
(verdes tras fix de lista esperada del catálogo) · typecheck raíz:
solo errores preexistentes de `effect-kit/engine.test.ts`, idénticos
en main (TS4104/TS2339, ajenos al port) · cargo fmt + git diff
--check limpios.

### Pendiente

- Reconciliar con main (el loop siguió avanzando: light.flare, light.leak,
  PreviewTransformBox fix ya portado manualmente).

---

## Fase de maduración arquitectónica y fundación del estudio (worktree, sin commit)

Trabajo ejecutado sobre `architecture/refactor-foundation` a partir de `690f2bb`, preservando el WIP del usuario (`commands/preview_frame.rs`, `render/ffmpeg.rs`, `nul`, `vibe_videos/`).

### Dependencias entre capas (Fase B)

- `commands/**` ya no importa ni construye `infrastructure/**`: los ~20 dominios de comandos migrados a accessors del composition root (`AppState`) que devuelven vistas/adapters por préstamo. Los comandos que no recibían `State` lo ganaron como parámetro IPC (el contrato público no cambia: Tauri lo inyecta).
- `application/**` quedó limpio de `commands`, `infrastructure` y `tauri` en código de producción; las únicas referencias a `infrastructure` son seams `#[cfg(test)]` documentados (tests de integración intencionales).
- `application/mcp.rs`/`mcp_server.rs` ya no exponen helpers que devolvían tipos concretos de infraestructura ni `tauri::async_runtime`.
- Tests que invocaban comandos con `State` migrados a llamar casos de uso de `application` con adaptadores concretos (`media/timeline_export/*`, `media/timeline_import.tests.rs`).

### Reglas automatizadas

`scripts/architecture-rules.test.mjs` pasó de 7 a **12 verificaciones**: aislamiento Tauri del frontend por capa, unicidad de `platform/tauri` como transporte, ciclos entre features (con 2 excepciones documentadas: `color↔editor`, `editor↔vfx` — pendiente bajar el módulo compartido), `commands` sin `infrastructure`, `application` sin `commands`/`infrastructure`/Tauri, dominio puro sin procesos/Tauri, `#[path]` a archivos existentes, unicidad y conteo de handlers IPC. La suite excluye `target/` y `*.tests.rs` (los tests sí pueden usar infraestructura concreta).

### Modularización dirigida (Fase C)

- `application/media.rs` (752 líneas, 3 responsabilidades) → fachada `media.rs` (259, ingesta/assets) + `media_analysis.rs` (430, escenas/estabilización/probe/VMAF) + `media_subtitles.rs` (101). Re-exporta la API pública: ningún consumidor cambió.
- `infrastructure/ai.rs` (659, 5 adaptadores) → `infrastructure/ai/` con `mod.rs` fachada + `secrets.rs` (keyring), `settings.rs` (AppState), `chat.rs` (`/chat/completions`), `probe.rs` (`/models`), `single_shot.rs` (motion + media-match) + `test_server` compartido.
- Inventario `include!`/`#[path]`: 99 `include!` en 21 archivos y 99 `#[path]` — la mayoría justificados (tests incluidos como módulos hermanos y submódulos de comandos gigantes). Clasificación completa en el ADR-0003; no se convirtieron masivamente porque varias rutas comparten scope/visibilidad deliberadamente.
- Módulos grandes revisados y **justificados como cohesivos** (una responsabilidad, cabecera documental): `infrastructure/render_jobs.rs`, `application/conversion.rs`, `application/projects.rs`, `application/mcp.rs`, `application/proxies.rs`, `infrastructure/mcp_server.rs`.

### Fundación del Autonomous Creative Studio (Fase D)

Contratos nuevos, sin implementar providers:

- **`ProductionPlan`**: `packages/project-schema/src/studio.ts` — schema zod versionado (`STUDIO_PLAN_VERSION = 1`) con brief, target (plataforma/aspecto/duración/profile), requirements de recursos con piso de derechos, escenas planned, specs de subtítulos/música, criterios de calidad y etapa del pipeline. Es artefacto de *entrada* del orquestador; no duplica `ProjectDocumentSchema`. Espejo serde en `src/studio/plan.rs` para Rust.
- **Catálogo multimedia**: `ports/studio.rs::MediaCatalog` + `CatalogEntry`/`CatalogQuery` (tipo, duración, tags, transcript, análisis, thumbnail, fuente/licencia/derechos).
- **Adquisición**: `ResourceAcquisition` + `SourceDescriptor` (términos, límites, coste, disponibilidad) + `AcquisitionCandidate`/`AcquiredResource`. Implementado `LocalCatalogAcquisition` (biblioteca del proyecto, coste 0, verifica piso de derechos y existencia en disco); fuentes externas siguen sin provider — lo no resoluble localmente falla `requires_provider`.
- **Generación**: `ContentGenerator` + `GenerationCapability`/`GenerationRequest`/`GenerationResult` por tipo (texto, imagen, vídeo, voz, música, sfx, animación).
- **AI Editor**: las operaciones tipadas ya existen como `AgentOperation` (JSON Patch versionado con `expectedRevision`, coste declarado y aprobación) en `provenance.ts`; el orquestador las consumirá, no se duplicó un segundo mecanismo.
- **Quality Gate**: `studio/quality.rs` (checks puros: timeline vacío, assets no listos, clips fuera de rango fuente, subtítulos más allá de la duración, sin perfil de render, derechos de uso) + `application/quality_gate.rs::review_project`/`review_open_project` que agrega verificación de archivos en disco con `resolve_inside_root`. Taxonomía alineada a `QualityCheckKindSchema`. **Expuesto por IPC**: comando `quality_gate_review` (`commands/domains/projects/quality_gate.rs`) → `QualityReportSummary` serializable (`passed`/`errors`/`warnings`/`findings`), con método `service.qualityGateReview()` en el contrato `DesktopService`. Evalúa el último estado persistido: la UI debe guardar antes de pedir el veredicto. No confundir con `RenderProfile.qualityGate` (verificación post-render ya existente).

### Reconciliación con main (post-fase)

Matriz medida y commits pendientes portados en `docs/architecture/RECONCILIATION.md`. Desde el último sync (`cf943ef`) se portaron: `ea94355` (mate luma-wipe en pista oculta), `cf4ba59` (scope por proyecto en cola de render), `6a630e6` (CSS splitting fase 2: scopes/compliance fuera del critical path), `2c60004` (timeouts Testing Library). `cf943ef` ya estaba portado. Los commits docs-only de bookkeeping de main no se portan (cada worktree lleva su cola/ledger).

### Evidencia

- `cargo test --lib`: 698/698 antes del split; 16/16 tests de media+ai tras el split; 14/14 tests nuevos de studio/quality_gate/ports.
- `npx vitest run scripts/architecture-rules.test.mjs`: 12/12.
- `packages/project-schema`: `tsc --noEmit` limpio, `studio.test.ts` 10/10.
- `cargo check` dev: 0 errores tras cada fase.
- Orquestador completo: `cargo test --lib` 749 passed / 0 failed / 53 ignored; architecture-rules 12/12; `cargo check --tests` limpio; `packages/project-schema` tsc + vitest studio 10/10.
- Pipeline E2E con render real: `EDITOR_IA_RUN_RENDER_TESTS=1 cargo test --lib production_e2e -- --ignored` → 1/1 (MP4 verificado + manifest + clips/cues/transitionIn en el documento).

### Production Orchestrator (ADR-0004)

Ciclo de vida de producciones autónomas implementado y probado:

- `studio/run.rs`: `ProductionRun` puro (status, checkpoints por etapa del pipeline, presupuesto `max_cost_cents`/`spent_cents`, `max_stage_attempts=3`, resumes). Etapa fallida no fatal vuelve a `pending`; fatal o intentos agotados ⇒ `failed`.
- `ports/studio.rs`: `ProductionStore` + `StageExecutor`/`StageContext`/`StageOutcome` (el ejecutor debe ser honesto; el orquestador nunca simula).
- `application/production.rs`: `create_run`, `advance` (una etapa por llamada), `cancel`, `resume`, `status`, `list`, `remove` (sólo terminales).
- `infrastructure/studio/production_store.rs`: JSON por corrida en `<config_dir>/productions/`, escritura atómica, id sanitizado.
- IPC: `production_create|status|list|resume|cancel|remove|advance`. `advance` usa `ProjectStageExecutor` y requiere proyecto abierto.

### Primer catálogo y ejecutor reales

- `infrastructure/studio/local_catalog.rs`: `LocalProjectCatalog` implementa `MediaCatalog` sobre `project.assets` del documento abierto + índice de enriquecimiento en `<root>/.olyvia/catalog-index.json` (transcript/analysis/thumbnail vía `upsert`; `prune_missing` limpia huérfanos). Traduce kind, licencia (`rights.license.commercialUse`), procedencia y sha256 1:1. Omite `font`/`text` (no son recursos producibles).
- `infrastructure/studio/project_executor.rs`: `ProjectStageExecutor` soporta `plan` (re-valida el plan embebido), `acquire` (sin requisitos ⇒ completa a coste 0; con requisitos resuelve cada uno contra `LocalCatalogAcquisition` — biblioteca local, hasta `max_count` assets por requisito con licencia ≥ piso y archivo en disco; lo no satisfecho ⇒ `fatal` + `requires_provider`), `analyze` (indexa assets, reporta `indexedAssets`/`missingFiles`/`byKind`).
- `infrastructure/studio/local_acquisition.rs`: `LocalCatalogAcquisition` implementa `ResourceAcquisition` sobre el `LocalProjectCatalog` (fuente `project-assets`, coste 0). `search` filtra por kind/texto/piso de derechos; `acquire` verifica que el asset siga en el catálogo, que su ruta resuelva dentro del root (`resolve_inside_root`) y que el archivo exista; devuelve `AcquiredResource` con bytes reales y sha256 declarado.
- `infrastructure/studio/assembly_executor.rs`: `AssemblyStageExecutor` soporta `scenes` (resuelve cada escena contra el catálogo por `requirement_ids`+kind+query+piso de licencia, escribe `.olyvia/production/<planId>.scenes.json`) y `edit` (crea pistas "Producción Video/Imagen/Audio" y monta un clip por escena en secuencia desde frame 0; idempotente vía `clipIds` del artefacto; escritura atómica del documento; escenas sin resolver ⇒ `fatal` nombrándolas). `edit` además materializa las specs del plan: `transition` → `transitionIn` en los clips visuales tras el primero por pista (frames clampeados a duración y a 120), `subtitles.enabled` → un cue por escena en pista "Producción Subtítulos" (kind `caption`) con estilo propio y `narrationText`/título, `music.enabled` → asset de audio del catálogo en pista "Producción Música" a lo largo de la corrida con `gainDb -12` y fades (sin candidato ⇒ warning en output, no falla).
- `infrastructure/studio/render_executor.rs`: `RenderReviewDeliverExecutor<'a>` cubre `render` (arranca `render_lifecycle::start_render` real con salida en `<root>/renders/`, sondea el job entre advances vía `previous_output`, verifica el MP4 publicado con ffprobe; `RenderBusy` ⇒ reintentable), `review` (Quality Gate post-edición; errores ⇒ fatal con reporte en output) y `deliver` (copia el MP4 a `<root>/deliverables/` + `manifest.json` con plan/proyecto/calidad).
- `infrastructure/studio/composite.rs`: `CompositeStageExecutor<'a>` enruta cada etapa al ejecutor que la implementa (built-ins + `with_extra` para los que necesitan `RenderDeps` del `AppState`). Es lo que `production_advance` inyecta. Cobertura real: las 8 etapas del pipeline.
- Soporte async en el dominio: `StageOutcome.in_progress` (etapa queda `running` y se re-sondea sin consumir intentos), `StageRecord.output` persistido, `StageContext.previous_output`/`stage_outputs` para que las etapas se pasen estado (jobId, outputPath, reportes). `resume` re-pone a `pending` las etapas `failed`.
- `ProductionRun` ahora embebe el `plan` serializado: la corrida es autosuficiente y `advance` no necesita que el llamador lo re-suministre.
- IPC nuevo: `production_advance`, `catalog_search`, `catalog_get` (requieren sesión de proyecto).
- **E2E real verificado**: `production_e2e_runs_all_stages_to_deliverables` (ignorado por defecto, `EDITOR_IA_RUN_RENDER_TESTS=1`) corre las 8 etapas sobre el fixture `sample-vertical-slice` con medios generados por ffmpeg lavfi y un plan con subtítulos + transición. Resultado medido: `done`, MP4 entregado en `deliverables/e2e-plan.mp4` (~1,0 MB, 1920x1080 h264/aac, verificado por ffprobe), `e2e-plan.manifest.json` con `quality.passed=true`, 2 clips de escena + `transitionIn` dissolve + cues de subtítulo en el documento. La corrida completa tarda ~15 s.
- **Schema**: `ProductionPlanSchema` gana `transition` opcional (`{type, frames}`, subconjunto seguro de `ClipTransitionSchema`); espejo serde `PlanTransition`/`PlanTransitionType` en `studio/plan.rs`.
- **Bug real encontrado y corregido por el E2E**: `studio/quality.rs::collect_clips` leía `timeline.tracks[].clips[]`, forma que no existe en el schema v1 (los clips viven en `timeline.clips` plano con `trackId`); el Quality Gate reportaba "sin clip visual" en todo proyecto real. Corregido el lector y los fixtures de test que reproducían la forma equivocada.

- **Contratos TS + UI de corridas**: `services/contracts/studio.ts` (`ProductionRun`, `StageRecord`, `CatalogEntry`, `CatalogQuery` — espejo camelCase del serde Rust), `services/contracts/services/studio.ts` (`DesktopServiceStudio`), comandos en `STUDIO_COMMANDS` (`platform/tauri/shared.ts`), adaptador `platform/tauri/studio.ts` compuesto en `native-service.ts`; stubs honestos en `unavailable-service.ts` y `fake-service.ts`. `state/production-plan.ts::buildProductionPlanFromProject` construye un `ProductionPlan` desde el proyecto abierto (assets de escena → `ResourceRequirement` con query=assetId, escenas → `PlanScene`, subtítulos si hay narración, target desde el primer render profile). `features/production/AutonomousRunsPanel.tsx` lista corridas con estado por etapa y opera avance/reanudación/cancelación/eliminación — todo vía `store.service`, sin imports de Tauri.
- **Fix de workspace**: `node_modules/@editor-ia/project-schema` apuntaba al worktree hermano (`editor-ia`); se repuntó a `packages/project-schema` de este worktree para que los tipos `ProductionPlan`/`StudioStage` resuelvan.
- **Provider externo real — Internet Archive**: `infrastructure/studio/internet_archive.rs` implementa `ResourceAcquisition` sobre archive.org (advancedsearch + metadata + descarga de derivado, sin credenciales). `acquire_stage` ahora prueba en dos pisos: biblioteca local → Internet Archive. `AcquisitionCandidate` ganó `kind`. Los recursos remotos se **registran como `project.assets`** (`register_remote_asset`: ffprobe para `media.*`, escritura atómica, idempotente por `source.path`, derechos/licencia del candidato en `rights`) para que `analyze`/`scenes`/`edit` los resuelvan. Sin ffprobe la fuente remota se omite y el requisito sigue `requires_provider`. Búsqueda live verificada contra archive.org (`EDITOR_IA_RUN_LIVE_TESTS=1`).
- **UI de corridas**: `AutonomousRunsPanel` con "Correr" (auto-avance con sondeo del render async vía `state/production-runs.ts::advanceProductionRun`), "Detener", "Avanzar etapa", Reanudar/Cancelar/Eliminar y aviso al terminar.
- **ContentGenerator real — voz local SAPI**: `infrastructure/studio/local_voice.rs` implementa `ContentGenerator` sobre la voz System.Speech de Windows (PowerShell, sin red, coste 0). `acquire_stage` desvía los requisitos `kind: voice` al generador: sintetiza `req.query` como texto a `media/generated/narracion-<req>.wav`, lo registra como asset `audio` (`register_generated_asset`: ffprobe + sha256 + provenance `generated-locally`/`windows-sapi`, licencia `user-generated`/`allowed`) y `scenes`/`edit` lo resuelven vía el binding `requirementId→assetId` (el catálogo mapea `voice`→`audio`). Tests live verificados: `live_synthesize_writes_a_real_wav` (RIFF/WAVE real, 0,9 s) y `acquire_voice_generates_registers_and_indexes_asset` (WAV + asset + catálogo, 3,4 s), ambos gated por `EDITOR_IA_RUN_LIVE_TESTS=1`.
- **E2E con narración completa**: `production_e2e_voice_narration_runs_all_stages` (ignorado, `EDITOR_IA_RUN_RENDER_TESTS=1`) corre las 8 etapas con un requisito `voice`: SAPI sintetiza el WAV, `acquire` lo registra como asset `audio`, `scenes`/`edit` lo montan como clip de audio, `render` lo mezcla y `deliver` entrega el MP4 — `done` en ~14 s.

### Pendiente

- `npm run typecheck|test:serial|verify|build` completos al cierre de la fase.
- Ciclos frontend `color↔editor` y `editor↔vfx` (excepciones documentadas).
- Providers externos adicionales (más fuentes de `ResourceAcquisition` e `ContentGenerator` para imagen/vídeo/música; hoy: biblioteca local + Internet Archive + voz SAPI local).
- **E2E remoto verificado**: `acquire_remote_downloads_and_registers_project_asset` (ignorado, `EDITOR_IA_RUN_LIVE_TESTS=1`) descargó un derivado real de archive.org (~2,5 min), lo registró como `project.assets` con ffprobe y el `LocalProjectCatalog` lo resolvió con `durationFrames`.
- **E2E remoto completo**: `production_e2e_remote_acquire_runs_all_stages` (ignorado, `EDITOR_IA_RUN_RENDER_TESTS=1` + `EDITOR_IA_RUN_LIVE_TESTS=1`) corrió las 8 etapas con un requisito que la biblioteca local no satisface: `acquire` bajó `bigbuckdance.ogv` (CC-BY) de archive.org, lo registró, `scenes` lo resolvió vía binding `requirementId→assetId` del output de acquire, `edit` lo montó, `render` produjo el MP4 y `deliver` lo entregó con manifest — `done` en ~83 s. `candidates_for_scene` ahora prefiere los assets adquiridos para el requisito antes de buscar por texto en el catálogo.
- Generación de texto de subtítulos por IA (hoy los cues usan `narrationText`/título de la escena) y transiciones más elaboradas (hoy una sola `transitionIn` por plan).
- Reconciliación main↔architecture: matriz en el informe de la fase; sin merges automáticos.
