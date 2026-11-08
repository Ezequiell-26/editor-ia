# Hoja de ruta de reorganización arquitectónica

**Rama:** architecture/refactor-foundation.  
**Base inicial:** a7cff32638e670a1265d74e86e641abc7dc32764.  
**Objetivo:** organizar responsabilidades y archivos sin alterar capacidades ni formato de proyectos.

## Fase 0 — Preservación y aislamiento
**Completada.**
- Se creó un worktree independiente en D:\Users\ofici\QODER-WORK\editor-ia-architecture.
- La rama de refactor se creó desde el último snapshot limpio disponible.
- Las dependencias instaladas se enlazaron en vez de reinstalar.
- El loop concurrente de Devin permaneció intacto.
- No hubo commit ni push.

## Fase 1 — Contratos y composición del frontend
**Implementación completada; validación parcial.**
- 236 tipos/interfaces extraídos de project-service a contratos por dominio.
- DesktopService dividido en interfaces especializadas y una interfaz raíz compatible.
- project-service.ts ahora es fachada; implementación en native-service.ts.
- 44 declaraciones de registro lazy, estilos y precarga extraídas a app/view-registry.tsx.
- ShellProps, isTypingTarget y Shell extraídos a app/Shell.tsx.
- App.tsx queda como composition root de unas 138 líneas.
- project-store separado en Provider, tipos, contextos, selectores y fachada pública.

Criterios y evidencia:
- Project-service tests: 18/18.
- Project-store tests: 5/5.
- git diff --check: pasó.
- Typecheck desktop: sólo queda identificado el error de PreviewTransformBox.tsx:248; debe corregirse en el dominio editor con una tarea funcional aparte o registrarse como baseline antes del cierre definitivo.
- El typecheck completo del workspace ya tenía fallos previos en effect-kit antes del refactor.

## Fase 2 — Servicios y estado por dominios
**Pendiente / siguiente bloque.**
1. Descomponer native-service.ts por dominio, conservando sus funciones públicas.
2. Extraer acciones del proyecto y coordinadores del Provider.
3. Separar stores y selectores del estado global por propietario de dominio.
4. Mantener una única fuente de verdad para proyectos, timeline, render y preferencias.
5. Añadir reglas verificables de imports sin nuevas dependencias, siempre que la configuración actual lo permita.

Cierre: typecheck de desktop, tests de service/store, smoke test de arranque y navegación.

## Fase 3 — Backend Rust en capas
**Pendiente.**
1. Establecer domain, application, ports, infrastructure y runtime sin añadir crates por carpeta.
2. Mover un caso de uso completo por vez.
3. Reducir commands/ a adaptadores IPC.
4. Mantener idénticos nombres/payloads Tauri y MCP.
5. Convertir lib.rs en composition root.

Cierre: cargo fmt sólo para los archivos modificados, cargo check/test, tests de comandos y compatibilidad IPC.

## Fase 4 — FFmpeg / render
**Extracción de tests completada; producción pendiente.**
- Los tests se movieron a render/ffmpeg/tests.rs y encoder_tests.rs.
- rustfmt selectivo de los archivos nuevos y ffmpeg.rs pasó.
- La prueba Rust dirigida se compila en un target aislado para no tocar el target de main.
- Próxima descomposición: perfil/encoders, filtros visuales/curvas/efectos, audio, planificación y ejecución/verificación.
- Cada submódulo conserva fachada y no cambia resultados del render.

## Fase 5 — Workers, paquetes e integraciones
**Pendiente.**
- Confirmar project-schema y effect-kit como propietarios únicos.
- Documentar contratos de render-worker, MCP y extensiones.
- Eliminar dependencias circulares entre desktop y procesos auxiliares.
- Unificar capabilities y transporte MCP sin duplicar matrices de funciones.

## Fase 6 — Validación final
**Pendiente.**
- Typecheck y tests de todos los workspaces.
- Cargo check/test Rust.
- E2E: abrir proyecto, timeline, medios, audio, preview y render.
- Smoke tests de MCP, downloader y plugins.
- Comparativa de arranque, bundle, RAM en reposo y export contra baseline.
- Revisar README, arquitectura y compatibilidad de proyectos existentes.

## Registro de validación
| Comprobación | Resultado |
|---|---|
| Vitest project-service | 18/18 |
| Vitest project-store | 5/5 |
| Vitest combinado | 23/23 |
| git diff --check | Pasó |
| TypeScript desktop | Un error ajeno al refactor en PreviewTransformBox.tsx:248 |
| Typecheck inicial workspace | Fallos previos en effect-kit: TS4104 y TS2339 |
| rustfmt selectivo (3 archivos FFmpeg) | Pasó |
| cargo fmt global --check | No pasa por diferencias de formato preexistentes en otros módulos; no se reformatearon |
| cargo test Rust dirigido | Compilación inicial en proceso; pendiente de resultado |

## Protocolo de entrega por fase
Cada fase registra objetivo, rutas creadas/movidas, fachadas conservadas, cambios de imports, pruebas con exit code, fallos preexistentes, regresiones y siguiente fase. Nunca se marca como terminada por sólo crear directorios o mover archivos.

## Registro incremental actualizado

**Estado de la fase 1 — composición/contratos frontend:** completada y validada en las suites focalizadas.  
**Estado de la fase 2 — agrupación por dominios:** avance material en frontend y backend; quedan submódulos internos grandes por descomponer.

### Entregables añadidos
1. WorkspaceView.tsx extraído desde Shell.tsx.
2. Adaptador nativo Tauri dividido en nueve fábricas por dominio, con fachada compatible.
3. commands/domains/ creado y 78 módulos trasladados con #[path] para mantener sus rutas lógicas.
4. commands/registry.rs creado para centralizar 234 handlers IPC.
5. 16 submódulos de tests extraídos de 13 comandos grandes.
6. render/ffmpeg/ dividido en cinco submódulos de producción y dos de tests.

### Validación acumulada vigente
| Comprobación | Resultado |
|---|---|
| Suites UI / servicios / store | **108/108 tests** |
| Typecheck desktop | Un error preexistente fuera del refactor: PreviewTransformBox.tsx:248 |
| git diff --check | Pasó |
| rustfmt --check comandos trasladados + registry | Pasó |
| rustfmt --check FFmpeg y módulos de test | Pasó |
| cargo test FFmpeg dirigido | No compiló: SDK FFmpeg (headers/libs) ausente en CARGO_HOME/entorno aislado; no es un test fallido de la lógica del refactor |

### Siguiente secuencia
- Fase 2B: dividir los módulos de producción de downloader y preview, con fachadas que mantengan su API.
- Fase 3: capas Rust application, ports e infrastructure, un caso de uso por vez.
- Fase 4: revisar paquetes compartidos y contratos de workers/MCP.
- Fase 5: test completo, smoke tests y comparación de arranque/render.
- Fase 6: reconciliar el trabajo nuevo de main, luego preparar una integración revisable. No hacer merge automático mientras el loop concurrente tenga cambios pendientes.

Las fases sólo se consideran cerradas con evidencia de compilación/pruebas y smoke test; el bloqueo de SDK se mantiene explícito.

## Segunda ola de ejecución — cierre incremental

La segunda ola descompuso los mayores módulos Rust de comandos por responsabilidad sin cambiar su namespace. Incluye providers, analítica de YouTube, creator, MCP server/client, stickman, media filters, media, recovery, screen record, intelligence, visuals, sharpen, background, render, dubbing, downloader bridge, proxies, FCPXML, shorts, upscale y conversion.

Se extrajeron también suites de tests de FCPXML, shorts y upscale a archivos hermanos. El único archivo de comando de producción que permanece sobre 700 líneas es la rutina de descarga de 750 líneas en downloader/downloader/download.rs; se mantiene cohesiva.

**Validaciones:**
- rustfmt --check sobre todo el árbol commands: aprobado.
- rustfmt --check sobre FFmpeg: aprobado.
- git diff --check: aprobado.
- Vitest final focalizado: pendiente de resultado.
- cargo test: bloqueado por SDK nativo FFmpeg ausente.
- TypeScript desktop: un error base ajeno al refactor permanece en PreviewTransformBox.tsx:248.

## Siguiente objetivo
Entrar en separación vertical de casos de uso Rust y sus ports/adapters, sin microservicios ni nuevos crates hasta que exista razón de compilación o despliegue. Automatizar reglas de dependencia y completar smoke tests de runtime antes de integrar.

## Cierre de segunda ola y resultados

### Entregables finales
- 78 módulos de comando reorganizados bajo nueve dominios físicos, preservando sus rutas lógicas.
- 234 handlers IPC centralizados en commands/registry.rs.
- Más de veinte módulos grandes descompuestos en archivos parciales por responsabilidad usando include! para conservar visibilidad y namespace.
- Suites de test embebidas extraídas a módulos vecinos cuando el tamaño y el alcance lo justificaban.
- FFmpeg reorganizado por perfiles, visual, audio, planificación y ejecución; visual y planificación también divididos en submódulos internos.
- Fachadas frontend mantenidas para App composition, WorkspaceView, DesktopService y ProjectStore.

### Evidencia final
| Comprobación | Resultado |
|---|---|
| Vitest serial | **108/108**, 4/4 archivos, exit code 0 |
| Auditoría de rutas Rust | 255 archivos, 135 include!, 98 path, 0 faltantes |
| rustfmt commands tree | Pasó |
| rustfmt FFmpeg tree | Pasó |
| git diff --check | Pasó |
| TypeScript desktop | Un error no relacionado en PreviewTransformBox.tsx:248 |
| cargo test | Bloqueado por SDK FFmpeg de desarrollo ausente |

### Estado de integración
- El trabajo permanece en la rama architecture/refactor-foundation del worktree editor-ia-architecture.
- El repositorio principal ha avanzado por trabajo concurrente de Devin; no se ha mezclado ni sobrescrito.
- No se hizo commit ni push.
- La siguiente operación segura, una vez detenido el loop concurrente, es comparar el delta de main con esta rama y preparar una integración revisable.

### Próxima fase arquitectónica
La siguiente fase deja de ser mover archivos. Consiste en migrar verticalmente un caso de uso (proyectos primero) desde commands hacia application, definir traits en ports e implementar adaptadores en infrastructure; después aplicar la misma frontera a media/render/providers. Mantener un solo crate Tauri por ahora y no crear microservicios ni crates por carpeta sin un beneficio medido.

## Tercera ola — plataforma Tauri y reglas automatizadas

**Estado: implementada y validada en frontend; Rust en compilación.**

- Todos los accesos a `@tauri-apps/api` quedaron confinados en
  `platform/tauri/` (window, events, app, webview + adaptadores de dominio
  ya existentes). Cero imports directos en features/components/hooks/lib/
  state y cero tipos de Tauri en `services/contracts`.
- `scripts/architecture-rules.test.mjs` automatiza las reglas: imports
  prohibidos, pureza de `projects/`+`media/` y unicidad/conteo del registry
  IPC (>= 234 handlers).
- Baseline TS resuelto: PreviewTransformBox clip opcional (mismo fix que
  main, portado manualmente sin merge).
- Recursos FFmpeg bundled copiados al worktree para habilitar cargo.

**Evidencia:** tsc desktop 0 errores · vitest focalizado 119/119 ·
architecture-rules 7/7 · cargo check lib+tests 0 errores ·
cargo test --lib 672/672 ejecutables (49 ignorados live) ·
cargo fmt --check y git diff --check limpios.

#### Reparación post-reorganización (Rust)

La primera compilación real del worktree expuso 99 errores introducidos por
la reorganización física (la rama nunca había compilado). Todos reparados:
registry `register` fijado a `Builder<Wry>` (los `AppHandle` de los comandos
son `AppHandle<Wry>` y sólo satisfacen `CommandArg` con `Invoke<Wry>`),
derives/visibilidad en `convert` y `render/ffmpeg`, helpers de
`screen_record` restaurados, campos `pub(crate)` para tests, y assets
bundled de piper copiados al worktree (gitignored).

### Siguiente bloque
1. ~~Fase 3 Rust: caso de uso Projects vertical~~ **hecho para el ciclo de
   vida** (create/open/open_at/adopt/save/save_as/close): ports en
   `ports/projects.rs`, casos de uso en `application/projects.rs`,
   adaptadores en `infrastructure/projects.rs`, comandos IPC delegando.
   Validado: check 0 errores, 28/28 tests de projects+application.
2. ~~VersionHistory~~ **hecho**: `LocalProjectVersioning` en
   `infrastructure/projects_history.rs` implementa el port; snapshots,
   listado y restauración fuera del comando IPC. Validado: check 0
   errores, 31/31 tests projects, arch-rules 7/7.
3. ~~ImportAssets/RelinkAssets~~ **hecho**: trait `ProjectAssetRecovery`
   en ports, casos de uso en `application/projects.rs`, adaptador
   `LocalProjectAssetRecovery` en `infrastructure/projects_recovery.rs`.
   `recovery/assets.rs` eliminado; `recovery.rs` es adaptador puro.
   **Fase 3 (Projects) completa.**
4. ~~Fase 4: Media/Timeline~~ **completa**. Hecho: ingesta
   (`import_local_files`, `check_asset_files`), análisis
   (`detect_scenes`, `analyze_stabilization` + `MediaAnalysisBackend`),
   timeline import (`media::timeline_import` dominio +
   `application::timeline_import`), probe/VMAF (`MediaTools`/`MediaRunner`
   en ports, `probe_any_file`/`measure_vmaf` en application) y timeline
   export (`media::timeline_export` dominio + `TimelineExportFiles` port +
   `application::timeline_export`).
   Fuera de alcance por frontera documentada: conversión (motor FFmpeg →
   fase render) y proxies (workers con estado → port de Jobs).
5. Fase 5: Render engine — **en curso**. Hecho: cola de render
   (`render::queue` + `RenderQueueStore` + `LocalRenderQueueStore` +
   `application::render_queue`) y exportaciones sin recodificar
   (`render::lossless` + `LosslessOutputs`/`ReservedOutput` +
   `LocalLosslessOutputs` + `application::lossless`) y capacidades de
   export/verificación (`render::export_tools` + `application::export_tools`
   sobre `MediaTools`/`MediaRunner`/`LosslessOutputs`) y sondeo de
   encoders unificado (`render::ffmpeg::probe` — antes duplicado entre
   `commands::audio` y `render/ffmpeg/profile`). Pendiente:
   ciclo de vida del render y motor de conversión (→ port de Jobs).
6. Fase 6: AI/MCP — **completa**. Hecho: importación de archivos de
   subtítulos (`media::subtitle_file` + `SubtitleFiles` port +
   `application::media::read_subtitle_file`) y proveedores IA
   (`ai::providers` dominio + `ports::ai` — secrets/settings/chat/probe con
   `Send + Sync` — + `infrastructure::ai` reqwest/keyring +
   `application::providers` con los 7 casos de uso; comandos IPC delgados
   que conservan `commands::providers::*` para assistant/motion_ai/
   subtitles_pipeline). Validado: check 0 errores, 19/19 tests dominio +
   7/7 tests HTTP locales, fmt/diff limpios, arch-rules 7/7.
   Además: localization studio (`media::localized_subtitle` +
   `LocalizedSubtitleFiles` + `application::localization`), watchdog de
   cola (`ai::watchdog` + `WatchdogTasks` + `application::agent`),
   motion_ai (`ai::motion` + `MotionChat` port + `ReqwestMotionChat` +
   `application::motion`) y assistant (`ai::assistant` dominio con
   acciones/SSE/media-match + `media::folder` sanitizer +
   `application::assistant` + worker de streaming en el adaptador IPC).
   Validado: check 0 errores, tests focalizados 4/4 + 2/2 + 6/6 + 24/24,
   fmt/diff limpios, arch-rules 7/7.
   Además: cliente MCP (`mcp::client` dominio + `ports::mcp`
   store/secrets/transport/factory + `infrastructure::mcp` store JSON
   atómico/keyring/stdio con kill_tree + `application::mcp` CRUD +
   SessionRegistry + probe/call; comandos IPC delgados).
   Validado: check 0 errores, tests MCP 24/24 (5 dominio + 4 live node +
   12 mcp_server intactos + 3 assistant), fmt/diff limpios.
   Además: servidor MCP embebido (`mcp::server` dominio — catálogo,
   classify_request, merge de configs, parsers HTTP — + `ports::mcp_server`
   token/invoker/handler/client-configs + `infrastructure::mcp_server`
   keyring/bridge `mcp-call`/listener 127.0.0.1 + `application::mcp_server`
   RpcDispatcher con lotes paralelos sólo-read + start/autoconnect;
   comandos IPC delgados).
   Validado: check 0 errores, tests MCP server 14/14 (12 dominio +
   token keyring real + detect clients), fmt/diff limpios, arch-rules 7/7.
   **Fase 6 completa.**
7. Fase 7: Jobs/Eventos unificados (render lifecycle, conversión,
   proxies) — diseña el port antes de migrar cada worker para no
   duplicar ciclo de vida.
   - **Hecho — proxies**: `media/proxy.rs` (dominio) + `ports/proxies.rs`
     (`ProxyRuntime`/`ProxyFiles`/`ProxyEvents`/`ProxyGenerator`) +
     `infrastructure/proxies.rs` (`LocalProxyRuntime`, `LocalProxyFiles`,
     `TauriProxyEvents`, `StdioProxyGenerator` con el worker FFmpeg
     verbatim) + `application/proxies.rs` + comandos IPC delgados.
     `hide_console` → `infrastructure/process.rs`; `proxy_video_args` →
     `media::proxy` (re-export en `commands::audio`).
     Validado: check 0 errores, tests proxy 5/5 + audio 5/5, fmt/diff
     limpios.
   - **Hecho — ciclo de vida del render**: `render/lifecycle.rs` (DTOs +
     `safe_name`/`ensure_mp4`) + ports `RenderProcess`/`RenderRuntime`/
     `RenderEvents`/`RenderFiles`/`RenderDialogs`/`RenderEncoder`/
     `RenderVerifier`/`RenderLaunch`/`RenderLauncher` +
     `infrastructure/render_jobs.rs` (`ChildRenderProcess`,
     `SharedRenderRuntime` sobre `AppState::render_jobs` — ahora
     `Arc<dyn RenderProcess>`—, `LocalRenderFiles`, eventos/diálogos
     Tauri, encoder/verifier y `StdioRenderLauncher` con el worker
     completo) + `application/render_lifecycle.rs` + 6 comandos IPC
     delgados. Parciales `render/{commands,execute,output}` eliminados.
     Validado: check 0 errores, tests render_jobs 3/3, fmt/diff limpios.
   - **Hecho — motor de conversión**: `media/conversion.rs` (dominio:
     allowlist `ConversionTarget`, `build_args` sin shell, escalas de
     calidad/bitrate, `safe_stem`, `parse_out_time_us`, DTOs de
     resultado/progreso/lote/petición) + `ports/conversion.rs`
     (`ConversionFiles`/`ConversionRunner`/`ConversionEvents`/
     `ConversionHardware`/`ConversionDeps`) +
     `infrastructure/conversion.rs` (`LocalConversionFiles`,
     `TauriConversionEvents`, `SystemConversionHardware`,
     `SystemConversionRunner` con el worker verbatim) +
     `application/conversion.rs` (convert/batch/compress/compress_any +
     `compress_input` común) + comandos IPC delgados.
     `probe_vmaf.rs` quedó submódulo autónomo; 8 parciales eliminados.
     Validado: check 0 errores, tests conversion 18/18, fmt/diff limpios.
     **Decisión Jobs**: NO se extrajo `infrastructure/jobs.rs` — los tres
     consumidores (proxy/render/conversión) comparten la forma
     spawn→pipes→wait→publish pero difieren en progreso, cancelación y
     verificación; el contrato común es el port, no el motor.
     **Fase 7 completa.**
8. Reconciliación con main (auditoría del delta a7cff32..HEAD):
   44 archivos frontend copiados, slide-3d-* portado a los submódulos
   del refactor, proxies huérfanos implementados, providers/bench ya
   presentes. Pendiente: `luma-wipe`/`mateClipId` sigue siendo WIP sin
   commitear en main — no se porta hasta que el usuario lo confirme.
   Antes de cualquier merge: revisar `git status` de main y repetir la
   comparación de delta.
