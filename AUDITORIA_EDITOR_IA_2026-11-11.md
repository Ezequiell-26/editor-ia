# Auditoría técnica — Editor IA / Olyvia

- Fecha: 2026-11-11
- Proyecto: `D:\Users\ofici\QODER-WORK\editor-ia-architecture`
- Equipo: `DESKTOP-8OVHDA0`
- Rama observada: `architecture/refactor-foundation`
- Modalidad: inspección de solo lectura; no se modificó código.
- Estado: auditoría parcial. Los hallazgos que requieren prueba en runtime están marcados expresamente.

## Resumen ejecutivo

Se inspeccionaron el estado Git, configuración Tauri, capabilities, workflow de empaquetado y el documento `SECURITY.md`. Se registran seis puntos para validación y mejora. No deben interpretarse todos como vulnerabilidades explotables: cada uno incluye el grado de evidencia y la comprobación pendiente.

## Hallazgos

### AUD-001 — Scope de Asset Protocol vacío pese al uso documentado de `asset:`

- Prioridad: **P1 — validar en ejecución**.
- Evidencia: `apps/desktop/src-tauri/tauri.conf.json`, bloque `app.security.assetProtocol`: `enable: true`, `scope: []`.
- Evidencia relacionada: `SECURITY.md` documenta uso de `asset:` para medios locales, decodificación de audio y waveforms.
- Riesgo: las rutas locales podrían no estar autorizadas para el protocolo y provocar fallos de preview, waveform o reproducción.
- Acción: probar con medios seleccionados por diálogo y en distintas ubicaciones; revisar cómo se concede el acceso en runtime. Si falla, aplicar allowlists estrechas o permisos persistentes para rutas elegidas por el usuario. No abrir todo el disco.
- Estado: **no confirmado en runtime**.
- Referencia técnica: https://v2.tauri.app/security/asset-protocol/

### AUD-002 — Los servidores MCP locales de terceros heredan permisos del usuario

- Prioridad: **P1 — riesgo de seguridad documentado**.
- Evidencia: `SECURITY.md`, sección “Servidores MCP”, declara que los procesos MCP no están sandboxeados y heredan los permisos del usuario.
- Impacto: un servidor MCP malicioso o comprometido podría acceder a recursos del usuario con los privilegios del proceso, más allá de las herramientas que la interfaz pretende exponer.
- Acción: separar consentimiento para instalar/probar/ejecutar; mostrar origen, versión y hash; allowlist de ejecutables y argumentos; sanitizar entorno; limitar directorios y red cuando sea viable; usar cuenta de bajo privilegio, Windows Job Objects o sandbox externo; terminar el árbol completo de procesos y limpiar temporales.
- Estado: **brecha de aislamiento confirmada por documentación**, sin prueba de explotación.

### AUD-003 — Los assets `not-for-redistribution` no tienen gate automático de exportación

- Prioridad: **P2 — brecha funcional y de derechos**.
- Evidencia: `SECURITY.md`, sección “Derechos de medios”, reconoce que el formato representa `not-for-redistribution`, pero no hay un gate de entrega que bloquee la publicación.
- Impacto: se puede exportar un proyecto que contiene medios marcados como no redistribuibles; la prevención depende de una decisión humana.
- Acción: incorporar preflight de render/export que enumere assets restringidos y bloquee por defecto; permitir excepción explícita solo con autorización válida y registro auditable. Separar “uso comercial permitido” de “redistribución permitida”.
- Estado: **brecha declarada en la documentación**; pendiente prueba de exportación.

### AUD-004 — Capability de `dual-monitor` concede `core:default`

- Prioridad: **P2 — reducir privilegios**.
- Evidencia: archivo nuevo/no rastreado `apps/desktop/src-tauri/capabilities/dual.json`, con `core:default`, permisos de ventana y `dialog:default`.
- Riesgo: `core:default` puede agrupar permisos de subsistemas que una ventana de preview no necesita. No se ha demostrado abuso ni explotación.
- Acción: mapear llamadas frontend reales de `dual-monitor` y sustituir el permiso agregado por permisos mínimos; mantener operaciones privilegiadas en la ventana principal cuando sea posible.
- Estado: **exceso potencial de permisos**, pendiente análisis de llamadas y compilación ACL.
- Referencias: https://v2.tauri.app/reference/acl/core-permissions/ y https://tauri.app/security/capabilities/

### AUD-005 — Workflow de Windows construye un instalador sin firma en esa fase

- Prioridad: **P2 — distribución y confianza**.
- Evidencia recuperada del historial de lectura: `.github/workflows/windows-package.yml` ejecuta `tauri:build -- --no-sign` y denomina el paso “Construye el instalador NSIS sin firma”.
- Impacto: el artefacto producido por ese workflow no recibe firma Authenticode en esa fase; el usuario no puede verificar el editor del instalador mediante dicha firma.
- Acción: revisar el workflow `release.yml` y todo el recorrido posterior para comprobar si se firma el artefacto final. Si no existe firma, añadir Authenticode en CI con secreto protegido y timestamp; verificar el instalador publicado. Nunca guardar claves privadas en el repositorio.
- Estado: **workflow inspeccionado sin firma; release completo no verificado**.

### AUD-006 — CSP permite imágenes HTTPS genéricas y estilos inline

- Prioridad: **P3 — endurecimiento**.
- Evidencia: `tauri.conf.json`: `img-src` contiene `https:` y `style-src` permite `'unsafe-inline'`; `script-src` se limita a `'self'` y `connect-src` no contiene HTTPS genérico.
- Impacto: imágenes externas pueden generar solicitudes a terceros y exponer metadatos de conexión; estilos inline amplían la superficie de inyección de contenido. Esto no equivale por sí solo a ejecución de JavaScript.
- Acción: inventariar usos reales de imágenes remotas; restringir a hosts concretos o retirar `https:` cuando no sea necesario. Reducir estilos inline si la arquitectura lo permite.
- Estado: **oportunidad de endurecimiento**, sin explotación observada.

## Estado Git observado

- Rama: `architecture/refactor-foundation...origin/architecture/refactor-foundation`.
- `git status --short --branch`: **325 entradas**: 183 modificadas y 142 nuevas/no rastreadas.
- Los cambios abarcan audio, transcripción, aislamiento de voz, render FFmpeg, proyectos, UI, MCP, capabilities Tauri, recursos SFX y documentación.
- No se determinó qué agente o persona produjo cada cambio.
- Se preservó todo: no se hizo stage, commit, push, reset, clean ni edición de código.

## Próximas inspecciones prioritarias

1. Reproducir AUD-001 en la app: importar desde varias rutas, preview, waveform y reproducción; recopilar errores de consola y logs.
2. Auditar `audio/sfx.rs`, `sfx-actions.ts`, `SfxLibrary.tsx`, `transcribe.rs` y `voice_isolation.rs`: reproducción, codecs, sample rate, canales, sincronización, cancelación, archivos temporales y límites.
3. Revisar todas las capabilities Tauri y construir matriz ventana → comando IPC → permiso.
4. Revisar `projects/files.rs`: traversal, symlinks, canonicalización, rutas UNC, colisiones, sobrescritura, tamaño y permisos.
5. Revisar procesos FFmpeg/FFprobe y MCP: argumentos, entorno heredado, rutas, timeouts, cancelación y terminación del árbol.
6. Revisar `release.yml` para comprobar si el instalador final se firma en una etapa posterior.
7. Ejecutar pruebas selectivas no destructivas, sin interferir con procesos de Qoder ni los cambios locales existentes.
8. Añadir nuevos hallazgos a este informe con IDs únicos y actualizar la cola de mejora solo después de verificar cada punto.

## Límites y criterio de clasificación

- AUD-001, AUD-004 y AUD-006 necesitan comprobación adicional de código/runtime antes de clasificarse como fallos confirmados.
- AUD-005 se basa en el workflow de empaquetado inspeccionado; no se revisó el flujo completo de publicación.
- No se inspeccionaron todavía en profundidad los módulos SFX, transcripción, aislamiento de voz ni el comportamiento real de exportación.
- No se hizo análisis dinámico de seguridad ni prueba de penetración.
- Mantener este archivo como registro acumulativo. No eliminar hallazgos; cambiar su estado a corregido solo con evidencia y prueba de regresión.


---

# Ampliación de auditoría — pasada de audio, procesos y filesystem (2026-11-11)

Esta ampliación se realizó después de la versión inicial. Se inspeccionaron los módulos de audio/SFX, el wrapper Python de Demucs, el puente Faster-Whisper, la interfaz del Inspector, el planificador FFmpeg y las herramientas MCP de filesystem. **No se modificó código de la aplicación.**

## Hallazgos adicionales

### AUD-007 — La transcripción ejecuta un proceso bloqueante dentro de un comando async

- Prioridad: **P1 — concurrencia y respuesta del escritorio**.
- Evidencia: apps/desktop/src-tauri/src/commands/domains/audio/transcribe.rs, función transcribe_asset: declara pub async fn, pero ejecuta command.output() directamente.
- Contraste: voice_isolation.rs sí utiliza tauri::async_runtime::spawn_blocking para su subprocess.
- Impacto: el trabajo síncrono puede ocupar un worker del runtime Tokio durante toda la transcripción y degradar otras operaciones asíncronas. El tiempo depende de la duración del archivo, modelo, CPU y carga.
- Acción: mover la ejecución a spawn_blocking o un supervisor de procesos dedicado; implementar cancelación y progreso.
- Estado: **problema de diseño confirmado por inspección estática**; no se midió aún el impacto en runtime.

### AUD-008 — Los subprocess de IA no tienen timeout ni cancelación verificable

- Prioridad: **P1 — resiliencia**.
- Evidencia:
  - transcribe.rs: Command::output() espera hasta que Python termina.
  - voice_isolation.rs: spawn_blocking(|| command.output()) tampoco establece límite de tiempo ni mecanismo de cancelación del proceso hijo.
  - Los comandos no exponen un identificador de trabajo para cancelar de forma segura.
- Impacto: una dependencia bloqueada, una inferencia muy larga o un proceso hijo que no termina puede dejar una operación ocupada indefinidamente. spawn_blocking evita bloquear directamente el executor, pero no cancela por sí solo el proceso.
- Acción: supervisor con deadline configurable, cancelación que termine el árbol de procesos, limpieza segura de temporales y estados terminales explícitos.
- Estado: **timeout/cancelación no encontrados en el flujo inspeccionado**.

### AUD-009 — Demucs decodifica el archivo completo a memoria y no impone límites de duración

- Prioridad: **P1 — estabilidad en medios largos**.
- Evidencia: scripts/ai-voice-isolation/demucs-wrapper.py:
  - _decode_with_ffmpeg() usa subprocess.run(..., capture_output=True) y recibe PCM f32le completo por stdout.
  - _load_audio() convierte ese resultado en un array completo y el flujo crea tensores para la separación.
  - El fallback _decode_with_soundfile() también carga el archivo entero.
  - No se observó un límite de duración/tamaño ni procesamiento por bloques desde el wrapper.
- Impacto estimado: audio estéreo float32 a 44,1 kHz ocupa aproximadamente **21,2 MB por minuto** sin contar copias, tensores, stems y modelo. Una hora representa aproximadamente **1,27 GB para un único buffer**; la memoria máxima real puede ser varias veces superior.
- Acción: limitar duración/tamaño antes de procesar, medir memoria disponible, procesar en ventanas con solapamiento y mezcla de bordes, liberar buffers entre etapas y ofrecer error recuperable cuando no alcance la memoria.
- Estado: **riesgo de memoria confirmado por la estrategia de lectura completa**; no se realizó una prueba de agotamiento de memoria.

### AUD-010 — El caché de aislamiento de voz no considera calidad ni cambios del medio

- Prioridad: **P1 — resultado funcional incorrecto**.
- Evidencia:
  - voice_isolation.rs, prepare_voice_isolation(): si existe media/isolation/<assetId>/vocals.wav y force != Some(true), devuelve el archivo como cacheado sin comparar hash/tamaño/fecha del medio ni calidad solicitada.
  - Inspector.tsx: el botón “Generar stem de voz” invoca voiceIsolationPrepare(asset.id, quality) sin pasar force=true.
  - La UI permite cambiar entre low/medium/high/best, pero el siguiente clic reutiliza el stem anterior si ya existe.
- Impacto: el usuario puede seleccionar calidad alta, pedir generar el stem y recibir el stem viejo sin reprocesamiento. Si el asset se reemplaza manteniendo el mismo ID, también puede reutilizar un stem de otro contenido.
- Acción: guardar metadatos de caché con hash del asset, modelo, calidad y versión del wrapper; invalidar ante cambios; ofrecer botón explícito “Regenerar”; validar ambos archivos y metadatos antes de declarar cache hit.
- Estado: **bug confirmado por flujo de control estático**.

### AUD-011 — El caché puede anunciar un stem de acompañamiento que no existe

- Prioridad: **P2 — consistencia del resultado**.
- Evidencia: en el retorno cacheado de prepare_voice_isolation(), basta con que exista vocals.wav, pero se devuelve Some(output_dir.join("accompaniment.wav")) sin comprobar que ese segundo archivo exista. Además, duration se devuelve como 0.0.
- Contexto: el wrapper Python escribe vocals.wav y después accompaniment.wav; un fallo al escribir el segundo archivo puede dejar un stem parcial. La siguiente llamada puede aceptar ese caché incompleto.
- Impacto: herramientas MCP o futuras pantallas pueden recibir una ruta no existente y metadatos incorrectos como si el caché estuviera completo.
- Acción: validar existencia, integridad WAV, duración, canales y sample rate de ambos stems; si el conjunto está incompleto, invalidar el caché y regenerar.
- Estado: **inconsistencia confirmada por inspección estática**.

### AUD-012 — La opción de aislamiento puede quedar activada aunque el render use el audio original

- Prioridad: **P2 — feedback engañoso / resultado distinto al esperado**.
- Evidencia:
  - Inspector.tsx: el checkbox “Aislar voz” marca voiceIsolation.enabled = true de forma independiente al botón “Generar stem de voz”.
  - render/ffmpeg/plan/range.rs: si el stem no existe, el plan conserva la ruta del audio original.
  - render/ffmpeg/tests.rs: voice_isolation_without_stem_falls_back_to_source_audio documenta y prueba ese fallback.
- Impacto: el proyecto puede guardar la opción activada y exportar sonido original sin advertir que el aislamiento no se aplicó. El fallback es intencional y evita romper el render, pero el resultado puede sorprender al usuario.
- Acción: mantener el fallback para resiliencia, pero emitir warning de exportación por clip; mostrar estado “pendiente de generar” y no presentar el aislamiento como aplicado hasta que el stem esté verificado.
- Estado: **comportamiento confirmado por tests existentes; riesgo de UX confirmado**.

### AUD-013 — Inserción SFX susceptible a cambio de proyecto durante la importación

- Prioridad: **P2 — integridad de proyectos**.
- Evidencia: apps/desktop/src/features/editor/sfx-actions.ts, addSfxToTimeline():
  - captura store.state.project antes de la operación;
  - hace await store.service.importMediaPaths(...);
  - después modifica el store actual con store.update() y store.mutate();
  - calcula duración en frames con fpsOf(project) del snapshot anterior.
- Impacto: si el usuario cambia o cierra el proyecto mientras la importación está pendiente, el resultado asíncrono puede aplicarse al estado actual con información del proyecto anterior o con FPS equivocados.
- Acción: capturar un identificador de sesión/revisión del proyecto, volver a comprobarlo después del await y abortar si cambió; calcular el FPS desde la sesión objetivo confirmada.
- Estado: **riesgo de carrera confirmado por inspección estática**; no se reprodujo con dos proyectos en runtime.

### AUD-014 — Las herramientas MCP de filesystem tienen alcance global y operaciones destructivas sin gate de confirmación propio

- Prioridad: **P1 — endurecimiento de seguridad**.
- Evidencia:
  - mcp-catalog.ts expone fs_read, fs_write, fs_delete y fs_move con rutas absolutas.
  - commands/domains/projects/files.rs acepta rutas globales y permite leer/escribir/mover/borrar archivos normales fuera del proyecto abierto.
  - Existen bloqueos de nombres sensibles, directorios de sistema, carpetas de la app y borrado de raíz/perfil, pero no una allowlist por proyecto/carpeta elegida ni una confirmación adicional dentro del comando antes de modificar/borrar archivos normales.
  - fs_delete permite borrar una carpeta completa cuando recursive=true; fs_write puede sobrescribir un archivo de texto existente.
- Impacto: un agente MCP con acceso a estas herramientas y una instrucción maliciosa o equivocada puede alterar o borrar datos de trabajo del usuario aunque no toque Windows ni las rutas explícitamente protegidas.
- Acción: limitar por defecto a raíces aprobadas por el usuario; pedir confirmación explícita y contextual para overwrite/delete/move; mostrar resumen de origen/destino y número de archivos afectados; registrar auditoría; mantener bloqueos actuales como defensa adicional, no como único control.
- Estado: **superficie de privilegios amplia confirmada por código y catálogo**; no se realizó prueba de abuso.

## Comprobaciones y límites de esta pasada

- Se inspeccionó el generador SFX y los ocho WAV empaquetados existen con tamaños acordes a las duraciones declaradas en el catálogo.
- SfxLibrary.test.ts prueba agrupación de elementos, pero no prueba reproducción real, errores de carga de audio, inserción en timeline ni cambio de proyecto durante una importación.
- Se intentó ejecutar Vitest para SfxLibrary.test.ts; el proceso no produjo salida durante 238 segundos y se terminó el proceso de prueba iniciado por esta auditoría. **No se considera ni aprobado ni fallido** y no se atribuye el bloqueo al código.
- No se hicieron cambios en la app, ni commits/push/reset/clean.
- Próxima prioridad: validar AUD-010/AUD-011 con pruebas unitarias de caché; añadir prueba de carrera para AUD-013; medir memoria en clips de duración controlada; ejecutar pruebas de regresión de FFmpeg y transcripción en entorno libre de otros procesos.


---

# Ampliación de auditoría — pasada de render, publicación y recuperación (2026-11-11)

Inspección estática adicional de application/render_lifecycle.rs, infrastructure/render_jobs.rs, projects/package.rs, projects/publish.rs, projects/storage.rs y projects_history.rs. No se modificó código.

## Hallazgos adicionales

### AUD-015 — Carrera al reservar el render puede dejar un FFmpeg huérfano

- Prioridad: **P1 — procesos y estabilidad**.
- Evidencia:
  - application/render_lifecycle.rs: start_render() comprueba runtime.is_busy() antes de preparar el plan; luego ejecuta encoder.spawn() y recién después llama a runtime.register().
  - infrastructure/render_jobs.rs: SharedRenderRuntime::register() rechaza el nuevo proceso si el mapa ya contiene otro job.
  - Si register() falla, start_render() elimina el temporal y retorna el error, pero no invoca spawned.process.request_cancel().
  - ChildRenderProcess implementa request_cancel() con Child::kill(), pero no implementa Drop que finalice el hijo al liberar el wrapper.
- Escenario: dos llamadas simultáneas pueden superar is_busy(); ambas arrancan FFmpeg, pero solo una consigue registrarse. La segunda retorna RenderBusy dejando el proceso iniciado sin registro y eliminando el directorio donde escribe.
- Impacto: proceso FFmpeg fuera del gestor, uso de CPU/disco no controlado, render parcial y pipes sin el worker que normalmente los consume.
- Acción: reservar el slot/job atómicamente antes del spawn, o cancelar explícitamente el hijo si falla el registro; asegurar cleanup de proceso, pipes y temporales en todas las rutas de error.
- Estado: **defecto en el manejo de fallo confirmado por inspección estática; escenario concurrente no reproducido aún**.

### AUD-016 — Reemplazo de paquetes y manifiestos no es atómico y puede perder la versión anterior

- Prioridad: **P1 — integridad de datos**.
- Evidencia:
  - commands/domains/projects/package.rs, write_atomic(): escribe el temporal; si el destino existe, ejecuta remove_file(output) y después rename(temp, output).
  - commands/domains/projects/publish.rs, save_publication_manifest(): repite el mismo patrón, eliminando el destino existente antes de renombrar el temporal.
  - En contraste, projects/storage.rs::write_project_file() usa temporal + flush + sync + rename sin borrar previamente el destino.
- Impacto: si rename() falla después de eliminar el destino, se pierde el ZIP/manifiesto anterior y también se elimina el temporal en el manejo del error. El nombre write_atomic y el comentario “escribiendo atómicamente” no reflejan esta ventana de pérdida.
- Acción: implementar reemplazo atómico adecuado para Windows y Unix, con respaldo o estrategia de swap/rollback; no borrar el destino hasta que la nueva versión esté publicada y validada. Añadir pruebas de fallo en cada paso que demuestren que el archivo anterior sobrevive.
- Estado: **secuencia destructiva confirmada en ambos flujos; el fallo del rename no se inyectó dinámicamente**.

### AUD-017 — La publicación del render puede sobrescribir un archivo creado mientras el render estaba en curso

- Prioridad: **P2 — protección de archivos del usuario**.
- Evidencia:
  - application/render_lifecycle.rs::start_render() comprueba requested_output.exists() antes de iniciar el trabajo y rechaza el destino si ya existe.
  - infrastructure/render_jobs.rs::LocalRenderFiles::publish_output() publica después de que termina el render: intenta rename(temporary, final_path) y, si falla, hace copy(temporary, final_path).
  - No hay una segunda comprobación de existencia ni una operación de creación exclusiva en publish_output().
- Escenario: otro proceso crea un archivo con ese nombre durante el tiempo que tarda la exportación. En sistemas donde rename reemplaza el destino, o cuando se usa el fallback copy, el archivo recién creado puede ser reemplazado.
- Impacto: pérdida silenciosa de un archivo ajeno al render. El mismo fallback de copia puede dejar un archivo parcial si la copia falla a mitad del proceso.
- Acción: reservar el nombre final mediante creación exclusiva/lock de destino, mantener esa reserva durante el job y publicar con operación que no sobrescriba; usar temporal en el mismo volumen cuando sea posible. En fallback de copia, copiar a un temporal de destino, verificar y renombrar; retirar el temporal parcial ante error.
- Estado: **ausencia de protección de publicación confirmada por código; carrera no reproducida en runtime**.

## Verificaciones adicionales

- projects/storage.rs::write_project_file() usa temporal, flush(), sync_all() y rename() sin borrar previamente el destino. Sirve como patrón interno a comparar, aunque debe probarse en Windows con destino existente y abierto.
- projects_history.rs::restore_project_version() valida el snapshot con open_project() y crea un snapshot previo antes de restaurar in-place; ese flujo no se registró como defecto en esta pasada.
- No se ejecutaron nuevas suites de test ni se tocaron los procesos de Qoder.
- Próxima prioridad: agregar tests de concurrencia para start_render, inyección de fallo de rename para paquete/manifiesto, y prueba de colisión de destino durante la publicación del MP4.


### AUD-018 — La restauración in-place continúa aunque no consiga crear el respaldo previo

- Prioridad: **P1 — recuperación y posible pérdida de trabajo**.
- Evidencia:
  - infrastructure/projects_history.rs::snapshot_project() devuelve Option y descarta errores de create_dir_all/fs::copy usando .ok()?.
  - restore_version() asigna let backup = snapshot_project(&project, "before-restore") y continúa con la copia temporal y el reemplazo del proyecto aunque backup sea None.
  - ProjectHome.tsx muestra en la confirmación “se guarda una copia previa”, pero el backend no lo garantiza. En el aviso final, backupPath nulo simplemente omite la mención de la copia; no muestra advertencia de restauración sin respaldo.
  - snapshot_project() copia directamente al nombre final de historial; no utiliza temporal + rename. Una interrupción o error durante la copia puede dejar un archivo parcial con extensión .editoria.json.
  - list_versions_of() filtra por extensión/nombre y version_info() solo intenta parsear JSON; no valida el schema/proyecto. Un snapshot incompleto puede aparecer en la lista como versión (con conteos cero) y fallar recién al intentar restaurarlo, porque restore_version() sí llama open_project().
- Impacto: la restauración in-place puede reemplazar la versión actual sin una copia previa recuperable; además, un snapshot incompleto puede presentarse como punto válido de recuperación.
- Acción: para restauración in-place, hacer obligatorio el backup previo o pedir confirmación explícita con advertencia y motivo; crear snapshots mediante temporal + flush/sync + rename; listar solo snapshots que pasen validación completa; reportar errores de backup y evitar afirmar que la copia fue creada cuando no existe.
- Estado: **comportamiento confirmado por código de backend y UI; no se provocó una falla de disco para reproducirlo dinámicamente**.


### Ampliación de evidencia de AUD-015 — el reintento de software tiene la misma ruta de fuga

- En infrastructure/render_jobs.rs, rebuild_software_render() inicia un nuevo FFmpeg antes de llamar a runtime.replace(&job_id, ...).
- Si replace() falla porque el job ya no está registrado, el flujo sale del reintento sin llamar a spawned.process.request_cancel().
- Esto puede ocurrir si la sesión/job fue cancelada o retirada durante el intervalo entre spawn y replace.
- La corrección debe cubrir tanto el alta inicial (register) como el reemplazo del proceso durante el fallback de encoder (replace).

### AUD-019 — browser_instance_launch permite abrir file:// y omite la validación de URL

- Prioridad: **P1 — exposición de archivos locales mediante el navegador automatizado**.
- Evidencia:
  - commands/domains/integrations/browser_instances.rs::browser_instance_launch() recibe url: Option<String> y, si no está vacía, la pasa directamente a Command como argumento del navegador (líneas 187–189); no valida esquema ni host.
  - browser_instance_navigate() sí rechaza todo lo que no comience por http:// o https:// (líneas 302–310) y su comentario explica que file:// puede leer archivos locales y que Runtime.evaluate podría exfiltrarlos.
  - flow_embed.rs y flow_browser.rs también tienen validación explícita que rechaza file:// y javascript:; browser_instance_launch es la ruta inconsistente.
  - Las pruebas cubren sanitize_id y validate_proxy, pero no existe prueba equivalente para la URL inicial de browser_instance_launch.
- Impacto: al abrir una URL file:// en el perfil automatizado, el proceso de automatización puede inspeccionar el contenido cargado mediante CDP/evaluación JS. También se aceptan argumentos que no son URLs.
- Acción: aplicar una única validación http(s) antes de construir el proceso; rechazar file:, javascript:, data: y argumentos de Chromium; añadir pruebas negativas/positivas para launch y navigate.
- Estado: **omisión de validación confirmada por código; no se intentó leer archivos locales en runtime**.

### AUD-020 — el navegador automatizado desactiva la separación de procesos entre sitios

- Prioridad: **P1 — debilitamiento de aislamiento del navegador**.
- Evidencia: commands/domains/integrations/browser_instances.rs::browser_instance_launch() añade el argumento --disable-features=IsolateOrigins,site-per-process (líneas 179–182).
- Impacto: se deshabilitan mecanismos Chromium de aislamiento por sitio/origen en los perfiles que manejan sesiones y cookies de usuario. Un fallo en una página puede tener mayor alcance sobre contenido de otros orígenes cargado en el mismo navegador.
- Acción: retirar ese flag salvo necesidad técnica probada; si hay un motivo de compatibilidad, aislarlo detrás de una opción explícita y medir qué funcionalidad depende de él. Mantener Site Isolation activado por defecto.
- Estado: **flag de debilitamiento de seguridad confirmado en el comando de arranque; no se hizo una prueba de explotación entre orígenes**.

### AUD-021 — endpoints CDP de sesiones autenticadas quedan sin autenticación de aplicación

- Prioridad: **P1 — control local de sesiones web autenticadas**.
- Evidencia:
  - flow_embed.rs crea WebView2 con --remote-debugging-port fijo por slot y devuelve cdp_url como http://127.0.0.1:<puerto> (líneas 247–271 y 182–188).
  - browser_instances.rs inicia Chromium con --remote-debugging-port y devuelve el endpoint 127.0.0.1 (líneas 171–174 y 225–233).
  - Los perfiles conservan cookies/sesiones entre aperturas y el endpoint CDP permite controlar páginas; no se observa token, autenticación ni verificación de cliente antes de usarlo.
- Impacto: cualquier proceso local que alcance esos puertos puede intentar inspeccionar páginas, navegar y ejecutar comandos CDP en sesiones autenticadas. La exposición es local/loopback; no se ha demostrado acceso desde la red externa.
- Acción: proteger CDP con un broker local autenticado y tokens de corta duración, limitarlo a procesos/agentes autorizados, abrirlo solo durante automatización y cerrarlo al terminar; no publicar el endpoint sin control de acceso.
- Estado: **exposición de endpoint sin autenticación visible confirmada por código; no se probó conexión desde otro proceso**.

### AUD-022 — colisión determinista entre puertos CDP de slots web

- Prioridad: **P1 — mezcla de sesiones y control de la ventana equivocada**.
- Evidencia:
  - flow_embed.rs::slot_port() asigna slots distintos a solo 47 puertos mediante hash % 47 (líneas 84–96).
  - register_slot() solo comprueba si el mismo nombre ya existe; no verifica si otro slot ya utiliza ese puerto (líneas 98–105).
  - Dos nombres válidos como capcut y kling producen el mismo puerto 19243; los dos slots pueden informar el mismo cdp_url.
  - flow_generate.rs obtiene el puerto del slot y después se conecta al endpoint CDP de ese puerto (líneas 83–96 y 183–211).
- Impacto: dos perfiles/ventanas diferentes pueden compartir el mismo endpoint anunciado. La automatización de un slot puede terminar operando sobre la página/perfil de otro, con riesgo de acciones y datos cruzados.
- Acción: reservar puertos de forma exclusiva por instancia, detectar colisiones al registrar, ampliar el rango o usar puertos dinámicos; comprobar que el endpoint pertenece a la ventana esperada antes de operar.
- Estado: **colisión determinista confirmada por la fórmula y los nombres válidos; no se lanzó runtime con ambos slots**.

### AUD-023 — la validación de proxy acepta direcciones inválidas y el test no detecta el defecto

- Prioridad: **P2 — configuración de red/proxy que aparenta ser válida pero no funciona**.
- Evidencia:
  - browser_instances.rs::validate_proxy() solo revisa prefijo http(s)/socks5, ausencia de @ y longitud máxima; no parsea la URL ni valida host/puerto (líneas 93–107).
  - Valores como http:// o socks5:// pasan esa condición, aunque carecen de host.
  - La prueba proxy_validation() contiene assert!(validate_proxy("http://").is_err() || true), expresión que siempre pasa y no valida el caso (líneas 527–534).
- Impacto: la app puede lanzar el navegador con un proxy inválido y reportar la instancia como iniciada; las conexiones fallan o el tráfico no sigue el proxy esperado.
- Acción: parsear con un parser URL, exigir host válido y puerto válido si está presente; probar entradas vacías, esquemas no admitidos, host ausente, puertos fuera de rango y URLs válidas.
- Estado: **aceptación de proxy inválido y test tautológico confirmados por código; no se probó tráfico de red**.

### AUD-024 — los navegadores hijos no se cierran al salir de Olyvia

- Prioridad: **P1 — procesos huérfanos y endpoint CDP activo después del cierre**.
- Evidencia:
  - flow_browser.rs guarda un std::process::Child en BROWSER; browser_instances.rs guarda Child por perfil en INSTANCES.
  - El cierre normal de esos procesos solo ocurre mediante flow_browser_stop() o browser_instance_close(). No hay Drop que mate los hijos ni una función stop_all.
  - lib.rs, en RunEvent::ExitRequested/Exit, cancela renders y descargas, pero no detiene flow_browser ni browser_instances (líneas 391–398).
- Impacto: al cerrar Olyvia, Chrome/Edge iniciado por la app puede continuar ejecutándose con el perfil autenticado y el puerto CDP abierto, consumiendo recursos y manteniendo la superficie de control local activa.
- Acción: detener todos los navegadores propiedad de la app en el hook de salida; centralizar su ciclo de vida y esperar la terminación de cada Child. Mantener persistente el perfil/cookies, no el proceso.
- Estado: **ausencia de limpieza en el hook de salida confirmada por código; no se cerró la app para comprobar el proceso residual**.

### AUD-025 — IDs de perfil distintos por mayúsculas pueden apuntar al mismo directorio en Windows

- Prioridad: **P2 — colisión de perfiles y comportamiento inconsistente al relanzar**.
- Evidencia:
  - browser_instances.rs::sanitize_id() permite y conserva mayúsculas/minúsculas.
  - El mapa INSTANCES es HashMap<String, Instance>, sensible a mayúsculas, y la comprobación de duplicados compara la cadena original.
  - profiles_root().join(&id) construye el directorio en el sistema de archivos Windows, que normalmente compara nombres de carpetas sin distinguir mayúsculas/minúsculas.
- Impacto: IDs como PerfilA y perfila son entradas distintas en el mapa, pero resuelven al mismo directorio físico de perfil. Dos lanzamientos pueden competir por el mismo user-data-dir y provocar reuso involuntario de la instancia existente, navegación inesperada o fallo de CDP.
- Acción: canonicalizar IDs (por ejemplo, lowercase) antes de usarlos como clave y ruta, y comprobar unicidad sobre la ruta canónica.
- Estado: **colisión lógica entre claves y ruta confirmada por código; no se lanzaron dos instancias con IDs que solo difieran en capitalización**.

### AUD-026 — browser_instance_list informa como activas instancias cuyo proceso ya terminó

- Prioridad: **P2 — estado obsoleto y bloqueo para volver a abrir el perfil**.
- Evidencia:
  - browser_instance_list() recorre INSTANCES y devuelve todas las entradas sin llamar Child::try_wait() ni comprobar el endpoint CDP (líneas 274–292).
  - browser_instance_launch() rechaza un profile_id si ya existe en el mapa (líneas 143–152).
  - flow_browser_status() sí usa try_wait() y limpia su estado cuando el proceso ya terminó; browser_instances no aplica ese patrón.
- Impacto: si el usuario cierra Chrome/Edge manualmente o el proceso cae, la lista puede seguir mostrándolo y el siguiente launch del mismo profile_id devuelve AlreadyExists hasta que se ejecute el cierre manual de esa entrada obsoleta.
- Acción: verificar try_wait() al listar y antes de bloquear un nuevo lanzamiento; retirar entradas terminadas y liberar su estado de manera segura.
- Estado: **ausencia de comprobación del proceso confirmada por código; no se simuló el cierre externo del navegador**.

### AUD-027 — los roots del protocolo asset se amplían de forma recursiva y nunca se revocan

- Prioridad: **P2 — exposición de archivos locales fuera de los medios del proyecto activo**.
- Evidencia:
  - application/projects.rs::OpenedProjectView::from() define root como el directorio padre del archivo de proyecto (líneas 36–42). El diálogo permite abrir un proyecto desde cualquier ubicación.
  - application/projects.rs::describe() llama a environment.allow_media_root(Path::new(&view.root)) cada vez que describe/abre un proyecto (líneas 120–128).
  - infrastructure/projects.rs::TauriProjectEnvironment::allow_media_root() ejecuta asset_protocol_scope().allow_directory(root, true), es decir, autoriza el directorio completo de forma recursiva (líneas 96–103), no solamente los archivos declarados como assets.
  - No se encontró ninguna llamada a forbid_directory ni una revocación de roots anteriores en el ciclo de abrir/cambiar/cerrar proyecto.
  - La configuración fija assetProtocol.scope está vacía, pero la autorización dinámica anterior agrega directorios durante la sesión.
- Impacto: todos los archivos y subdirectorios que estén junto al proyecto quedan dentro del alcance del protocolo asset, incluso si no son recursos multimedia del proyecto. Al cambiar de proyecto, los directorios ya autorizados permanecen habilitados en el proceso. Si una vista comprometida o un XSS consigue utilizar el protocolo, el conjunto de archivos locales accesibles resulta más amplio y crece con los proyectos abiertos.
- Acción: autorizar solo rutas individuales de medios verificadas y necesarias; revocar el root anterior al cambiar/cerrar proyecto, o mantener un conjunto de scopes activos sincronizado con las sesiones. Evitar conceder permisos recursivos al directorio arbitrario que contiene el JSON.
- Estado: **ampliación recursiva y falta de revocación confirmadas por código; no se intentó leer archivos locales desde una ventana**.

### AUD-028 — Audio Scope puede bloquearse al superar el límite de 90 segundos

- Prioridad: **P1 — operación de análisis de audio que puede quedar colgada**.
- Evidencia:
  - commands/domains/audio/audio_scopes.rs::decode_pcm() crea FFmpeg con stdout y stderr en pipes (líneas 204–218).
  - El lector acumula stdout solo mientras `pcm.len() < cap`, donde `cap` equivale a 90 segundos de PCM mono float32 (líneas 225–236). Al alcanzar el tope sale del bucle, pero no drena ni cierra explícitamente el flujo restante.
  - Después llama a `child.wait()` sin consumir stdout restante (líneas 238–245). Para un archivo con más de 90 segundos, FFmpeg intenta seguir escribiendo; cuando la pipe se llena, FFmpeg queda bloqueado y `wait()` no termina.
  - Además stderr está configurado como `Stdio::piped()` y nunca se lee; una entrada problemática que produzca muchos mensajes de error puede llenar también esa pipe.
- Impacto: el análisis de oscilograma/espectro de archivos largos puede quedar indefinidamente esperando. Afecta `audio_scope_analyze` y `audio_scope_analyze_asset`, que comparten `decode_pcm()`.
- Acción: limitar la salida en FFmpeg con `-t` cuando corresponda o seguir drenando stdout al descartar el excedente; drenar stderr en paralelo o enviarlo a null/log acotado; aplicar timeout y kill al proceso.
- Estado: **secuencia de pipe + wait confirmada por código; no se ejecutó FFmpeg con un archivo de más de 90 segundos para reproducir el bloqueo**.

### AUD-029 — Audio Scope ignora el código de salida de FFmpeg y puede devolver una forma de onda parcial como válida

- Prioridad: **P2 — resultado de audio incompleto presentado como correcto**.
- Evidencia:
  - `decode_pcm()` espera el proceso y captura su `ExitStatus`, pero lo descarta expresamente con `let _ = status` (líneas 238–245).
  - Si FFmpeg decodifica parte del archivo y luego termina con error, la función devuelve las muestras parciales como `Ok(Vec<f32>)`.
  - `audio_scope_analyze()` y `audio_scope_analyze_asset()` solo rechazan `samples.is_empty()`; aceptan cualquier buffer parcial no vacío y generan el análisis como si fuera completo (líneas 302–314 y 337–349).
- Impacto: archivos truncados, con paquetes dañados o decodificación interrumpida pueden mostrar una onda/espectro incompletos sin error ni advertencia, lo que lleva a diagnósticos y decisiones de edición incorrectos.
- Acción: comprobar `status.success()`, capturar un resumen acotado de stderr y devolver error si FFmpeg falla; si se desea aceptar decodificación parcial, marcar expresamente el resultado como incompleto.
- Estado: **manejo de estado de salida y aceptación de datos parciales confirmados por código; no se probó un archivo corrupto en runtime**.

### AUD-030 — las operaciones de FFprobe/FFmpeg de audio se ejecutan sincrónicamente dentro de comandos async

- Prioridad: **P1 — bloqueo de workers del runtime y degradación de concurrencia**.
- Evidencia:
  - `audio_peaks()` y `audio_peaks_path()` están declaradas `async`, pero llaman directamente a `probe_audio()` y `decode_peaks()` (audio.rs líneas 246–263 y 285–307).
  - `probe_audio()` utiliza `Command::output()` (líneas 100–121) y `decode_peaks()` crea FFmpeg, lee stdout en un bucle y espera `child.wait()` sin `spawn_blocking` (líneas 153–241).
  - A diferencia de `audio_scope_analyze()`, que traslada su decodificación a `spawn_blocking`, las operaciones de picos mantienen trabajo de proceso y lectura de archivos dentro del worker async.
- Impacto: al generar ondas de audio para archivos grandes, FFprobe/FFmpeg bloquean un worker Tokio durante toda la decodificación. Varias solicitudes concurrentes pueden ocupar workers y retrasar IPC, render y otras operaciones asíncronas.
- Acción: ejecutar sondeo y decodificación en `spawn_blocking` o supervisor dedicado; añadir timeout/cancelación de proceso y evitar esperas de FFmpeg en el worker async.
- Estado: **flujo síncrono dentro de los comandos async confirmado por código; no se midió saturación del runtime en ejecución**.

### AUD-031 — la generación de picos de audio también puede bloquearse al alcanzar el máximo de buckets

- Prioridad: **P2 — generación de onda colgada en archivos largos con duración no disponible**.
- Evidencia:
  - `audio.rs::probe_audio()` devuelve duración `0.0` cuando FFprobe no entrega una duración numérica válida, sin fallar ni verificar `output.status.success()` (líneas 116–135).
  - `decode_peaks()` usa `per_bucket = 1024.0` si la duración es desconocida (líneas 146–151). Con `MAX_BUCKETS = 4000`, alcanza el máximo tras 4.096.000 muestras, aproximadamente 85,3 segundos a 48 kHz.
  - Al llegar a `MAX_BUCKETS`, `decode_peaks()` sale del bucle de lectura stdout (líneas 216–227) y llama a `child.wait()` sin drenar el resto del stdout (líneas 232–240).
  - En un archivo más largo, FFmpeg puede seguir escribiendo a una pipe que ya no se consume y bloquearse; `wait()` queda esperando al proceso.
- Impacto: la forma de onda de archivos largos puede quedar cargando indefinidamente cuando FFprobe no logra reportar duración. Afecta tanto `audio_peaks()` como `audio_peaks_path()`.
- Acción: no dejar de drenar stdout al alcanzar el máximo de buckets; descartar el excedente, limitar duración en FFmpeg o cancelar el proceso. Tratar duración desconocida como estado explícito y no ignorar el estado de FFprobe.
- Estado: **ruta de bloqueo confirmada por flujo de control; no se reprodujo con un archivo real cuya duración falte en FFprobe**.

### AUD-032 — la validación anti-SSRF del descargador se puede eludir con IPv4-mapped IPv6, DNS y redirecciones

- Prioridad: **P1 — posible acceso a servicios de red local desde funciones que aceptan URLs**.
- Evidencia:
  - `downloader/probe.rs::validate_url()` bloquea IP privadas/locales solo cuando el host parsea directamente a `IpAddr`; para IPv6 comprueba loopback, unspecified, unique-local y link-local, pero no normaliza/rechaza direcciones IPv4-mapped IPv6 (líneas 23–42). Una representación como `::ffff:127.0.0.1` no es el valor IPv6 `::1` y no coincide con esas comprobaciones.
  - Para nombres DNS, la función solo evalúa la cadena del host (`localhost`, `.local`, `.internal`); no resuelve el nombre ni comprueba las IP resultantes. Un dominio público controlado con respuesta DNS a una IP privada/local pasa la validación.
  - `automation.rs::fetch_rss_feed()` y `probe_source_checksum()` usan `reqwest::blocking::Client` con política de redirección predeterminada; validan la URL inicial, pero no vuelven a validar cada destino HTTP de redirección (líneas 166–185 y 312–335).
  - Las pruebas existentes solo verifican `localhost`, `127.0.0.1` y `192.168.1.10`; no cubren IPv4-mapped IPv6, DNS privado ni redirecciones hacia destinos privados.
- Impacto: una URL aceptada puede terminar alcanzando servicios loopback, privados o internos mediante direcciones IPv6 equivalentes, resolución DNS o redirecciones. En un escenario con entrada controlada por contenido o agente, esto abre una vía SSRF hacia servicios locales/de red.
- Acción: resolver y validar todas las IP de cada destino, bloquear rangos no públicos incluyendo IPv4-mapped IPv6 y revalidar cada salto de redirección; aplicar límites también a URLs secundarias recuperadas por yt-dlp.
- Estado: **fallos de cobertura y controles insuficientes confirmados por código; no se efectuó una solicitud HTTP contra servicios locales ni una prueba DNS/redirect**.

### AUD-033 — el puente de descargas permite dos trabajos simultáneos por una carrera check-then-set

- Prioridad: **P2 — concurrencia no controlada y estado de descargas inconsistente**.
- Evidencia:
  - `downloader_bridge.rs::start()` crea un thread independiente por cada conexión TCP aceptada (líneas 172–186), por lo que `download_route()` puede ejecutarse concurrentemente.
  - `routes.rs::download_route()` comprueba `job.status == "running"` bajo un lock (líneas 119–130), libera el lock y después, en otra sección crítica, reemplaza `job_state` con el nuevo trabajo (líneas 132–144). La comprobación y la reserva no son atómicas.
  - Dos peticiones simultáneas pueden observar `busy == false`, ambas crear su trabajo e iniciar sus respectivos threads (líneas 155–163). `job_state` es un único `Option<BridgeJob>`, por lo que un trabajo pisa la identidad del otro y ambos workers actualizan el mismo estado.
- Impacto: la extensión puede iniciar descargas concurrentes aunque el puente pretende permitir una sola. El progreso/resultado visible puede corresponder al trabajo equivocado; las dos descargas pueden competir por CPU, red, espacio y nombres de archivos.
- Acción: reservar el slot de trabajo bajo un único lock/operación atómica antes de responder 202; mantener un estado por ID si se desea concurrencia real.
- Estado: **carrera check-then-set y ejecución por threads confirmadas por código; no se dispararon peticiones simultáneas contra el puente**.

### AUD-034 — el puente deja un trabajo marcado como running si no puede crear el thread de descarga

- Prioridad: **P2 — tarea atascada sin worker**.
- Evidencia:
  - `routes.rs::download_route()` escribe primero el estado inicial `status = "running"` en `job_state` (líneas 132–144), responde HTTP 202 al cliente (líneas 145–149) y después intenta crear el worker.
  - El resultado de `thread::Builder::spawn()` se descarta con `let _ =` (líneas 155–163). Si el sistema operativo rechaza crear el thread, no hay worker que ejecute `run_direct_image()`/`run_job()` ni que actualice el estado.
- Impacto: el trabajo queda reportado como activo indefinidamente, la extensión sigue consultando un ID que nunca finalizará y el control de una sola descarga puede quedar bloqueado para los siguientes pedidos.
- Estado: **fallo de creación ignorado y orden de actualización confirmados por código; no se agotaron recursos del sistema para reproducirlo**.

### AUD-035 — una descarga directa de imagen deja archivos parciales cuando falla la lectura o escritura

- Prioridad: **P2 — archivos corruptos residuales en Descargas**.
- Evidencia:
  - `jobs.rs::run_direct_image()` crea el archivo final directamente con `File::create(&destination)` antes de recibir todo el contenido (líneas 36–42).
  - Si `response.read()` o `file.write_all()` devuelve error, el `?` sale de la closure inmediatamente (líneas 43–51); el manejador exterior solo marca el job como error (líneas 88–93).
  - La eliminación explícita del destino solo existe para tamaño mayor a 100 MB o archivo vacío (líneas 53–68); no hay limpieza para los otros errores ni escritura temporal seguida de rename.
- Impacto: una desconexión HTTP, respuesta truncada o fallo de disco puede dejar una imagen incompleta con nombre definitivo en la carpeta de descargas. Puede confundirse con un archivo válido.
- Estado: **ruta de salida parcial confirmada por código; no se interrumpió una transferencia real para reproducirla**.

### AUD-036 — la conexión automática MCP puede reemplazar toda la configuración de Claude/Antigravity si el JSON no se puede leer o parsear

- Prioridad: **P2 — pérdida de configuración ajena al activar la integración MCP**.
- Evidencia:
  - `infrastructure/mcp_server.rs::EnvAiClientConfigs::write_olyvia_entry()` intenta leer y parsear el archivo del cliente, pero convierte cualquier error de lectura o parseo en `{}` mediante `.ok().and_then(...).unwrap_or_else(|| json!({}))` (líneas 272–275).
  - Luego mezcla la entrada `olyvia` sobre ese objeto vacío y escribe directamente sobre el archivo original con `std::fs::write()` (líneas 276–286).
  - Si el JSON del cliente contiene un error de sintaxis, está truncado o la lectura falla transitoriamente, el contenido anterior se descarta y se reemplaza por un JSON que solo contiene la entrada de Olyvia. No se conserva copia de respaldo.
- Impacto: conectar Olyvia puede eliminar otras configuraciones MCP y preferencias del cliente externo, aunque el comentario del método promete una mezcla no destructiva.
- Estado: **fallback destructivo confirmado por código; no se modificaron configuraciones reales de Claude ni Antigravity**.

### AUD-037 — guardar ajustes de la aplicación no es atómico y una interrupción puede restablecer toda la configuración

- Prioridad: **P2 — pérdida de preferencias y configuración del usuario**.
- Evidencia:
  - `state.rs::AppState::save_settings()` serializa los ajustes y escribe directamente en `settings.json` con `std::fs::write()` (líneas 193–202); no utiliza archivo temporal, flush/sync y rename atómico.
  - Al iniciar, `AppState::load()` ignora errores de lectura o JSON inválido y utiliza `Settings::default()` (líneas 165–169).
  - El método es utilizado por ajustes de audio, voz, rutas de FFmpeg y otros comandos de configuración; hay caminos que además ignoran el error de guardado.
- Impacto: si el proceso se cierra, el equipo pierde energía o falla el disco durante la escritura, `settings.json` puede quedar truncado. En el siguiente inicio se carga la configuración por defecto, perdiendo preferencias del usuario sin recuperación automática.
- Estado: **escritura directa y fallback a defaults confirmados por código; no se interrumpió deliberadamente un guardado real**.

### AUD-038 — cambios de servidores MCP no son transaccionales entre configuración y Credential Manager

- Prioridad: **P2 — pérdida de credenciales y servidores MCP inutilizables tras un fallo de guardado**.
- Evidencia:
  - `application/mcp.rs::save_server()` escribe o actualiza secretos de entorno mediante `secrets.set_env()` antes de guardar el nuevo `mcp-servers.json` (líneas 169–182 y 213). También elimina credenciales antiguas con `remove_key()` antes del guardado (líneas 201–205).
  - `delete_server()` elimina todas las credenciales del servidor antes de `store.write_servers()` (líneas 226–231).
  - Si `write_servers()` falla, la función retorna error, pero no restaura los secretos previos; el archivo JSON antiguo continúa presente y puede referenciar claves eliminadas o valores parcialmente actualizados.
- Impacto: un fallo de disco/permisos durante edición o eliminación puede dejar la configuración MCP y Credential Manager desincronizados. Los servidores que antes funcionaban dejan de arrancar por variables de entorno ausentes o alteradas.
- Acción: hacer el cambio transaccional o conservar y restaurar el estado previo de secretos cuando falla la persistencia del JSON.
- Estado: **orden de operaciones y ausencia de rollback confirmados por código; no se provocó un fallo de escritura ni se alteraron credenciales reales**.

### AUD-039 — el hook de forma de onda calcula mal la duración del audio en proyectos que no son de 30 FPS

- Prioridad: **P2 — decisión incorrecta de decodificación y posible consumo excesivo de RAM o ausencia de onda**.
- Evidencia:
  - `media/mod.rs::build_asset()` calcula `durationFrames` de audio usando `project_fps_num/project_fps_den` (líneas 671–684), pero el objeto `media` de audio solo guarda `sampleRate`, `channels` y `durationFrames`; no guarda `frameRate`.
  - `packages/project-schema/src/assets.ts::AudioAssetSchema` confirma ese esquema: `sampleRate`, `channels`, `durationFrames`, sin `frameRate`.
  - `hooks/useWaveform.ts` intenta leer `media.frameRate`, y cuando no existe fija `mediaFps = 30` (líneas 173–179). Después usa ese cálculo para aplicar el límite de 10 minutos de WebAudio y 30 minutos de análisis nativo (líneas 184–202).
- Impacto: en un proyecto de 24 FPS la duración se subestima un 20% y puede autorizar WebAudio para archivos que realmente superan los 10 minutos, elevando el consumo de memoria. En proyectos de 60 FPS se duplica la duración estimada y se puede desactivar innecesariamente la forma de onda en archivos que sí deberían procesarse.
- Acción: calcular la duración con el frame rate del proyecto disponible en el hook o persistir un valor `durationSeconds`/frame rate inequívoco en los metadatos de audio.
- Estado: **desajuste entre productor de metadatos, schema y consumidor confirmado por código; no se midieron casos en la interfaz**.

### AUD-040 — el generador TTS acepta AAC y PCM pero después rechaza sus bytes como formato desconocido

- Prioridad: **P2 — formatos de voz declarados como compatibles que no se pueden guardar**.
- Evidencia:
  - `remote_voice.rs::ALLOWED_FORMATS` anuncia `wav`, `mp3`, `opus`, `aac`, `flac` y `pcm` (línea 34); la solicitud admite `aac` y `pcm` y los envía como `response_format` (líneas 223–249).
  - `audio_extension()` solo reconoce WAV (`RIFF/WAVE`), MP3 (`ID3`/`FF FB`), FLAC (`fLaC`) y Ogg (`OggS`) (líneas 82–96). No reconoce ADTS AAC ni PCM crudo.
  - Después de que el proveedor responde correctamente, `generate()` exige que `audio_extension()` encuentre una firma y devuelve `InvalidProviderResponse` si no la encuentra (líneas 250–255).
- Impacto: al solicitar `response_format = aac` o `pcm` a un endpoint compatible que respete el formato, la síntesis puede completarse pero Olyvia descarta el audio y muestra error. El soporte anunciado no coincide con el validador ni con la extensión de salida.
- Estado: **desajuste entre formatos permitidos y firmas aceptadas confirmado por código; no se realizaron llamadas de TTS**.

### AUD-041 — la voz generada registra el modelo configurado aunque la solicitud haya usado un override

- Prioridad: **P2 — metadatos de procedencia incorrectos**.
- Evidencia:
  - `remote_voice.rs::generate()` permite `request.params.model` y utiliza ese valor real en el JSON enviado al endpoint (líneas 230–249).
  - El `GenerationResult` posterior informa `model: self.config.model.clone()` (líneas 272–279), sin conservar el modelo efectivo de la solicitud.
- Impacto: si se usa un modelo TTS alternativo al modelo de chat configurado en el proveedor, el audio se genera con el primero pero el historial/resultado atribuye la generación al segundo. Los informes de procedencia y diagnóstico quedan incorrectos.
- Estado: **valor enviado y valor devuelto divergentes confirmados por código; no se generaron audios con override**.

### AUD-042 — el generador de imágenes aplica el límite de 32 MB después de cargar toda la respuesta en RAM

- Prioridad: **P1 — consumo de memoria sin límite efectivo ante un proveedor de imágenes defectuoso o malicioso**.
- Evidencia:
  - `infrastructure/studio/remote_image.rs::post_images()` ejecuta `response.bytes()` (línea 171), que acumula el cuerpo completo en memoria.
  - Solo después de cargarlo comprueba `bytes.len() > MAX_IMAGE_BYTES` (líneas 177–181), por lo que el límite declarado de 32 MB no limita la asignación.
  - En contraste, `download_image()` sí utiliza `take(MAX_IMAGE_BYTES + 1)` antes de leer el cuerpo (líneas 229–244).
- Impacto: un endpoint configurado como proveedor de imágenes que responda con un JSON/b64 enorme puede hacer que la app reserve memoria proporcional al tamaño completo de la respuesta y provocar lentitud, congelamiento o falta de memoria antes de rechazarla.
- Acción: aplicar límite de lectura mientras se consume el cuerpo y comprobar `Content-Length` como optimización adicional, sin confiar únicamente en esa cabecera.
- Estado: **orden de lectura y validación confirmado por código; no se envió una respuesta sobredimensionada al generador**.

### AUD-043 — las generaciones remotas no descuentan gasto del presupuesto autorizado

- Prioridad: **P1 — límite de coste remoto no efectivo**.
- Evidencia:
  - `project_executor.rs::acquire_remote_image()` y `acquire_remote_voice()` solo comprueban que `remaining_budget_cents > 0` antes de llamar al proveedor (líneas 786–795 y 613–623). No calculan ni reservan el coste de cada solicitud.
  - Ambos métodos pueden ejecutar `req.max_count` llamadas remotas, pero `RemoteImageGenerator` y `RemoteVoiceGenerator` devuelven `GenerationResult { cost_cents: None }` porque no conocen el precio de la API.
  - Las entradas generadas registran `costCents: null`; la etapa `acquire_stage()` no suma esos valores a `cost_cents` y finalmente devuelve el coste acumulado de adquisiciones, que puede ser 0 (líneas 317–358).
  - `ProductionRun::finish_stage()` transforma `None` en 0 para `spent_cents` (run.rs líneas 247–248). La siguiente etapa vuelve a recibir el presupuesto completo/no consumido.
  - El presupuesto solo detiene nuevas etapas cuando `spent_cents >= max_cost_cents`; por tanto las llamadas remotas no reducen el saldo.
- Impacto: una corrida puede generar muchas imágenes o audios en un proveedor facturable y continuar mostrando gasto 0, aunque el plan haya declarado `maxCostCents`. La autorización de un presupuesto positivo no establece un límite efectivo para esas llamadas.
- Estado: **ausencia de contabilización confirmada por código; no se realizaron llamadas pagas ni se generaron cargos**.

### AUD-044 — `production_create` acepta `maxCount` sin límite y el ejecutor lo usa como número de llamadas/procesos

- Prioridad: **P1 — bloqueo prolongado, agotamiento de recursos y gasto remoto no acotado por entrada**.
- Evidencia:
  - `commands/domains/studio/production.rs::production_create()` deserializa el plan JSON y lo guarda sin una validación de rango visible para `requirements[].max_count` (líneas 23–34).
  - `studio/plan.rs::ResourceRequirement.max_count` es un `u32` sin máximo en el tipo ni validador asociado; el default es 3, pero el valor recibido del JSON se conserva.
  - `project_executor.rs` ejecuta bucles `for i in 0..req.max_count.max(1)` para generación remota de voz/imagen y también para generadores locales de voz, títulos, patrones y música (líneas 566, 637, 691, 736, 802 y 854).
  - El plan sólo se vuelve a deserializar en `plan_stage()`; esa etapa tampoco limita `max_count`.
- Impacto: un plan IPC con un `maxCount` muy elevado puede iniciar una cantidad enorme de operaciones secuenciales, congelar el driver/etapa y consumir recursos locales. Para proveedores remotos puede disparar muchísimas solicitudes facturables; el defecto de contabilización del presupuesto está documentado por separado en AUD-043.
- Acción: validar límites máximos por requisito y por plan al crear la corrida, y aplicar el mismo límite dentro de cada ejecutor antes de iniciar operaciones.
- Estado: **entrada no acotada y bucles dependientes del valor confirmados por código; no se envió una solicitud con un valor extremo**.

### AUD-045 — `production_advance` ejecuta análisis y procesos externos bloqueantes dentro de un comando async

- Prioridad: **P1 — bloqueo del runtime de Tauri durante producción/análisis**.
- Evidencia:
  - `commands/domains/studio/production.rs::production_advance()` está declarada `async`, pero invoca directamente `state.advance_production_run()` y no usa `spawn_blocking` (líneas 166–171).
  - `AppState::advance_production_run()` espera un `std::sync::Mutex::lock()` por corrida y llama directamente a `application::production::advance()` (state.rs líneas 490–531).
  - El ejecutor de análisis ejecuta `Command::output()` de FFmpeg para detectar cortes y silencios (project_executor.rs líneas 445–463 y 501–513), además de sondeo de medios, thumbnails y otras operaciones de disco/proceso.
  - El driver autónomo sí llama al mismo camino desde `spawn_blocking`; el comando IPC manual no.
- Impacto: al pulsar avanzar manualmente una producción con vídeos pesados, la operación puede bloquear un worker del runtime async durante el sondeo/FFmpeg. Una llamada concurrente que espere el lock también bloquea el worker, degradando la respuesta de la interfaz y otras operaciones Tauri.
- Acción: ejecutar el avance síncrono en `spawn_blocking` también desde IPC, con manejo explícito de errores de join y sin bloquear workers async al esperar locks.
- Estado: **llamada async→sync y procesos bloqueantes en el ejecutor confirmados por código; no se midió latencia ni saturación en runtime**.

### AUD-046 — conversión y compresión FFmpeg bloquean workers async durante toda la operación

- Prioridad: **P1 — degradación de interfaz y concurrencia durante exportaciones/conversiones largas**.
- Evidencia:
  - Los comandos `convert_media`, `convert_file`, `convert_media_batch`, `compress_media` y `compress_any_file` están declarados `async` en `commands/domains/media/convert.rs`, pero invocan directamente las funciones síncronas de `application::conversion`.
  - `application::conversion` llama a `ConversionRunner::run()` sin `spawn_blocking` (por ejemplo, líneas 202–210, 329–337, 436–444 y 564–572).
  - `infrastructure/conversion.rs::run_conversion()` hace `Command::spawn()` y `child.wait()` en el hilo llamador; los threads auxiliares solo drenan stdout/stderr y notifican progreso, no trasladan el worker principal.
  - `convert_media_batch()` puede repetir la operación para hasta 200 assets dentro de una sola llamada IPC y no cede el worker entre elementos.
- Impacto: una conversión/compresión larga bloquea el worker Tokio que atiende la invocación. Los lotes pueden mantenerlo ocupado durante muchas operaciones consecutivas y retrasar otros comandos asíncronos, incluidos los de proyectos, audio y MCP.
- Estado: **invocaciones sync dentro de handlers async y espera de Child confirmadas por código; no se midió saturación ni congelamiento de UI en runtime**.

### AUD-047 — importar medios ejecuta FFprobe, copia y SHA-256 de forma bloqueante dentro de comandos async

- Prioridad: **P1 — bloqueo de runtime al importar archivos grandes o varios medios**.
- Evidencia:
  - `commands/domains/media/media/import.rs::import_assets()` e `import_media_paths()` son handlers `async`, pero llaman directamente a `application::media::import_local_files()` sin `spawn_blocking` (líneas 8–17, 45–55 y 70–99).
  - `import_local_files()` procesa secuencialmente cada ruta con `media::import_file()`.
  - `import_file()` ejecuta FFprobe, copia el medio al proyecto y calcula SHA-256 de todo el archivo mediante operaciones síncronas (`media/mod.rs` líneas 597–639).
  - `probe_file()` usa `Command::output()` y el hash lee el archivo en un bucle síncrono; estas operaciones pueden durar mucho con archivos 4K o lotes.
- Impacto: el worker async que recibe la importación queda ocupado por todo el sondeo, copia y hash; con varios archivos la ocupación se prolonga. Puede retrasar IPC, render y otras operaciones del runtime.
- Acción: mover el proceso completo de ingesta (FFprobe, copia, hash y resultado) a `spawn_blocking`/worker dedicado, manteniendo el acceso a sesión y documentos seguro.
- Estado: **flujo bloqueante dentro de handlers async confirmado por código; no se midió saturación en runtime**.

### AUD-048 — la importación puede dejar archivos huérfanos o parciales cuando falla una copia o el hash

- Prioridad: **P2 — residuos de medios que ocupan disco y no aparecen en el proyecto**.
- Evidencia:
  - `media::import_file()` copia el origen a `media/` con `fs::copy()` (líneas 625–636), pero si la copia devuelve error no elimina el destino que pudo haberse creado parcialmente.
  - Si la copia termina pero `sha256_file(&destination)` falla, el error se propaga con `?` (línea 639) y el archivo ya copiado no se elimina.
  - En la ruta batch `import_media_paths`/`import_local_files`, cada archivo se importa individualmente y no hay rollback de archivos anteriores si otros fallan; se devuelven warnings, pero los archivos que se copiaron y luego fallaron durante medición/hash pueden quedar sin un asset asociado.
  - La copia de medios en `import_media_paths()` no usa archivo temporal ni publicación atómica.
- Impacto: fallos de disco, interrupciones o errores de lectura pueden dejar archivos incompletos o completos sin referencia en el proyecto, consumiendo espacio y confundiendo una limpieza o reimportación posterior.
- Acción: copiar a un nombre temporal exclusivo, validar/hash y publicar mediante rename; en cualquier error eliminar el temporal/destino creado por esa operación.
- Estado: **ausencia de limpieza posterior a error confirmada por código; no se provocaron fallos de disco ni se dejaron residuos de prueba**.

### AUD-049 — dos solicitudes simultáneas pueden generar el mismo proxy y escribir sobre el mismo archivo temporal

- Prioridad: **P1 — corrupción de caché y procesos FFmpeg duplicados**.
- Evidencia:
  - `application/proxies.rs::ensure_proxy()` consulta `runtime.status(asset_id)` y, si no encuentra job activo, continúa hasta `runtime.begin()`; la comprobación y la reserva no forman una operación atómica (líneas 149–154 y 194).
  - `infrastructure/proxies.rs::LocalProxyRuntime::begin()` hace `map.insert(asset_id, RuntimeEntry { ... })` sin rechazar ni coordinar una entrada ya activa (líneas 60–71).
  - `StdioProxyGenerator::generate()` crea un thread por llamada (líneas 265–271). Para un mismo asset/huella/calidad, ambos jobs calculan el mismo `target` y el mismo archivo `target.with_file_name("<stem>.part.mp4")` (líneas 295–301).
  - FFmpeg se inicia con `-y` y escribe directamente en ese temporal compartido (líneas 304–320).
- Impacto: solicitudes `ensure_proxy` concurrentes pueden arrancar dos procesos que compiten por el mismo archivo parcial. Pueden truncarse/alterarse mutuamente, publicar un proxy corrupto o hacer que el estado de cancelación/progreso de un job sustituya al otro.
- Estado: **reserva no atómica, reemplazo del registro y ruta temporal compartida confirmados por código; no se lanzaron dos solicitudes simultáneas en runtime**.

### AUD-050 — la limpieza selectiva de proxies elimina precisamente el asset indicado, en contradicción con su contrato

- Prioridad: **P2 — borrado selectivo de caché con semántica invertida**.
- Evidencia:
  - `application/proxies.rs::cleanup_proxies()` documenta que, al recibir `asset_id`, conserva los proxies de ese asset (líneas 304–305).
  - `LocalProxyFiles::cleanup()` construye `keep_prefix = Some("proxy-<asset_id>-")`, pero salta los archivos que NO empiezan con ese prefijo y elimina los que SÍ empiezan con él (líneas 164–184).
  - Por tanto, al invocar `cleanup_proxies(asset_id)`, el código elimina todos los proxies del ID recibido y conserva los demás; el comportamiento real es el opuesto al contrato documentado.
  - La interfaz AssetsPanel actualmente ejecuta limpieza global sin ID, por lo que el defecto afecta al comando de limpieza selectiva cuando se utiliza con un asset concreto.
- Impacto: la limpieza selectiva puede borrar el caché del asset que se pretendía conservar y mantener los demás archivos. La llamada global sin ID no tiene esta inversión.
- Estado: **contradicción entre documentación y filtro de borrado confirmada por código; no se ejecutó limpieza sobre un proyecto real**.

### AUD-051 — la generación de proxies desde la biblioteca puede cruzar proyectos mientras FFmpeg trabaja

- Prioridad: **P1 — proxy asociado a un proyecto/asset distinto del que lo originó**.
- Evidencia:
  - `AssetsPanel.tsx::createProxies()` captura `pendingProxies` del proyecto renderizado y procesa la lista con varios `await store.service.createVideoProxy(...)` (líneas 378–409).
  - No comprueba `store.state.project?.id === project.id` ni cancela la secuencia entre llamadas. `applyCreated()` usa `store.update()` sobre el estado actual, sin comprobar que siga abierto el proyecto original (líneas 392–399).
  - El handler Rust `create_video_proxy()` obtiene `state.require_session()` en cada invocación y resuelve `path` relativo contra la sesión activa (color_proxy.rs líneas 99–124).
  - Si se cambia de proyecto mientras se procesa el lote, las llamadas posteriores pueden resolver la misma ruta relativa en el proyecto nuevo; al finalizar, `applyCreated()` intenta agregar los resultados a la sesión actual.
  - `Inspector.tsx` tiene la misma forma en la acción individual: espera `createVideoProxy()` y luego actualiza el store actual sin comprobar el ID del proyecto que estaba activo al iniciar.
- Impacto: el lote puede fallar al cambiar de proyecto, generar proxies desde archivos distintos con la misma ruta relativa o guardar referencias a archivos de la carpeta de otro proyecto. Los IDs aleatorios reducen la posibilidad de aplicar un proxy a otro asset, pero no evitan que la operación siga contra la sesión equivocada.
- Estado: **ausencia de anclaje de sesión/guardas de proyecto confirmada por código; no se cambió de proyecto durante una generación real**.

### AUD-052 — generación de proxy y medición de loudness ejecutan FFmpeg de forma bloqueante en handlers async

- Prioridad: **P1 — bloqueo del runtime durante análisis y generación de vídeo/audio**.
- Evidencia:
  - `commands/domains/media/media/color_proxy.rs::create_video_proxy()` y `sample_asset_color()` están declaradas `async`, pero esperan directamente `Command::output()` (líneas 38–70 y 128–159). La generación de proxy decodifica y codifica el vídeo entero.
  - `commands/domains/audio/loudness.rs::measure_file_loudness()` también es `async` y ejecuta FFmpeg mediante `.output()` hasta medir todo el archivo (líneas 439–482).
  - La ruta `analyze_mix_loudness()` del mismo archivo sí utiliza explícitamente `spawn_blocking`, por lo que no es una limitación del stack.
- Impacto: generar proxies antiguos o medir loudness en medios largos ocupa un worker Tokio durante el proceso completo y puede retrasar otras llamadas IPC y tareas asíncronas.
- Estado: **invocaciones FFmpeg bloqueantes dentro de handlers async confirmadas por código; no se midieron tiempos de ejecución**.

### AUD-053 — un proxy generado queda huérfano si FFprobe falla al validar el archivo final

- Prioridad: **P2 — residuos de archivos derivados sin referencia en el proyecto**.
- Evidencia:
  - `create_video_proxy()` genera primero `media/proxies/proxy-<UUID>.mp4` con FFmpeg (líneas 119–159).
  - Después ejecuta `probe_file(&ffprobe, &target, MediaKind::Video)?` (línea 176). Si FFprobe no puede abrir el resultado o devuelve error, el `?` retorna inmediatamente y no elimina `target`.
  - La limpieza explícita del archivo existe si FFmpeg devuelve error o si las dimensiones son cero, pero no cubre el error de `probe_file()`.
- Impacto: una salida que FFmpeg creó pero FFprobe no puede validar queda en la carpeta de proxies sin un `asset.proxy` asociado; la siguiente generación crea otro UUID y acumula el residuo.
- Estado: **salida creada antes de la validación y propagación temprana sin limpieza confirmadas por código; no se forzó un fallo de FFprobe**.

### AUD-054 — la inteligencia de medios ejecuta varias pasadas FFmpeg bloqueantes dentro de `analyze_media` async

- Prioridad: **P1 — bloqueo de workers durante análisis automático**.
- Evidencia:
  - `commands/domains/media/intelligence/command.rs::analyze_media()` es un handler `async` (línea 2), pero llama directamente a `measure_media()` (líneas 98–107), sin `spawn_blocking`.
  - `measure_media()` crea varios threads con `std::thread::scope()` y cada uno ejecuta `run_pass()`/FFmpeg mediante `Command::output()`; adicionalmente `analyze_luma()` ejecuta tres procesos FFmpeg de forma secuencial.
  - La función espera que terminen todos esos threads antes de retornar la respuesta IPC. No existe un límite de concurrencia global ni timeout para esas pasadas.
- Impacto: un análisis automático puede ocupar un worker del runtime async mientras se ejecutan varias decodificaciones completas, y puede iniciar varias instancias FFmpeg por cada petición. Con análisis simultáneos, el uso de CPU/IO y los workers ocupados pueden degradar la interfaz y otras operaciones.
- Acción: mover el análisis completo a `spawn_blocking`/worker controlado, limitar análisis simultáneos y aplicar timeout/cancelación a cada proceso.
- Estado: **camino async→sync y ejecución paralela de FFmpeg confirmados por código; no se midió saturación real ni se ejecutó un análisis pesado**.

### AUD-055 — detección de escenas y estabilización ejecutan FFmpeg síncronamente dentro de handlers async

- Prioridad: **P1 — bloqueo de workers del runtime durante análisis de vídeo**.
- Evidencia:
  - `commands/domains/media/analysis.rs::detect_scenes()` y `analyze_stabilization()` están declaradas `async`, pero llaman directamente a sus casos de uso síncronos (líneas 15–42), sin `spawn_blocking`.
  - `application/media_analysis.rs` llama a `MediaRunner::run_ffmpeg()` y espera el resultado completo.
  - `infrastructure/media.rs::run()` implementa el runner mediante `Command::output()`; por tanto, detect scenes y vidstabdetect esperan FFmpeg en el worker que atiende IPC.
  - El mismo patrón afecta las solicitudes repetidas sobre varios clips, y no hay timeout/cancelación en el runner.
- Impacto: la detección de cortes y el análisis de estabilización de clips largos bloquean workers Tokio; otras llamadas asíncronas pueden demorarse mientras FFmpeg termina.
- Estado: **handlers async, casos de uso síncronos y runner `Command::output()` confirmados por código; no se midió el bloqueo durante una operación real**.

### AUD-056 — la selección de mejores frames deja temporales y resultados parciales si falla la publicación de una miniatura

- Prioridad: **P2 — caché de miniaturas con archivos huérfanos tras un error de disco**.
- Evidencia:
  - `best_frame.rs::extract_frames()` crea un directorio temporal `.thumb-frames-<UUID>` y extrae hasta 12 PNG (líneas 92–122).
  - El directorio se elimina al final normal y cuando no hay candidatos, pero la publicación de los tres resultados usa `fs::copy(...)?` (líneas 131–140). Si falla una copia, la función retorna inmediatamente sin eliminar el directorio temporal.
  - Si falla la segunda o tercera copia, las imágenes anteriores ya quedaron con nombre definitivo en `output_dir`, pero no se devuelve el vector parcial porque la función retorna `Err`.
- Impacto: un fallo de escritura puede dejar archivos PNG temporales y una o dos miniaturas definitivas sin referencia del frontend. Repetir la operación genera nuevos UUID y acumula residuos de caché.
- Acción: publicar en un subdirectorio temporal y limpiar todo ante error; mover los PNG al destino final solo cuando el conjunto esté completo.
- Estado: **propagación temprana con `?` y limpieza posterior no garantizada confirmadas por código; no se provocó un fallo de disco**.

### AUD-057 — el upscale de vídeo no aplica el máximo de 1.800 frames cuando FFprobe no puede calcular la duración

- Prioridad: **P1 — límite de tiempo/memoria aparente que no limita el proceso real**.
- Evidencia:
  - `upscale/video.rs::upscale_video()` establece `estimated_frames = MAX_VIDEO_FRAMES` cuando `duration_seconds` es 0 o desconocida (líneas 92–98). Después valida ese valor contra el máximo (líneas 99–107), por lo que la comprobación siempre pasa.
  - `upscale_video_blocking()` solo agrega `-t` al decoder y encoder cuando el usuario proporciona `max_seconds`; la interfaz envía `undefined` por defecto.
  - El bucle que lee frames no comprueba `written >= MAX_VIDEO_FRAMES`: procesa hasta EOF y no corta la fuente.
- Impacto: con un archivo cuya duración no sea reportada por FFprobe y sin límite manual, el upscale puede procesar un vídeo arbitrariamente largo, pese a que el backend informa un tope de 1.800 frames. La inferencia ×4 por CPU puede mantener la máquina ocupada durante un periodo muy superior al calculado.
- Acción: hacer efectivo el límite durante la lectura (contador/stop) o rechazar duración desconocida cuando no se haya fijado un máximo explícito.
- Estado: **fallback del contador, ausencia de corte en el bucle y ausencia de `-t` por defecto confirmados por código; no se procesó un vídeo sin duración conocida**.

### AUD-058 — el límite de dimensiones de Real-ESRGAN se comprueba después de decodificar toda la imagen

- Prioridad: **P1 — posible agotamiento de memoria al abrir imágenes de dimensiones extremas**.
- Evidencia:
  - `upscale/runtime.rs::upscale_image()` ejecuta `image::open(&input)` y materializa la imagen completa en memoria (línea 86).
  - Solo después consulta `image.dimensions()` y rechaza dimensiones mayores que `MAX_INPUT_SIDE = 2048` (líneas 92–101).
  - No hay un límite de píxeles/bytes aplicado al decoder antes de la asignación.
- Impacto: una imagen con dimensiones o ratio de compresión extremos puede provocar una asignación grande o agotamiento de memoria antes de que actúe el límite de 2048 px. El límite actual protege la inferencia, pero no la fase de decodificación.
- Acción: inspeccionar dimensiones desde el encabezado y aplicar límites de píxeles/bytes del decoder antes de materializar los píxeles.
- Estado: **orden de decodificación y validación confirmado por código; no se probó una imagen tipo decompression-bomb**.

### AUD-059 — el upscale de imagen sobrescribe el archivo `-x4.png` anterior sin comprobarlo

- Prioridad: **P2 — pérdida silenciosa de un resultado de upscale anterior**.
- Evidencia:
  - `UpscaleView.tsx` llama a `store.service.upscaleImage(inputPath)` sin proporcionar `outputPath` (líneas 77–78).
  - `upscale_image()` construye siempre el mismo destino `<nombre-original>-x4.png` si no se pasa una salida explícita (líneas 105–116).
  - No verifica `destination.exists()`, no genera sufijo incremental y `image::save_buffer_with_format()` escribe directamente sobre esa ruta; no hay confirmación ni publicación mediante archivo temporal.
- Impacto: repetir el upscale de la misma imagen reemplaza el PNG generado anteriormente. Si el usuario había ajustado/retocado ese resultado, puede perderlo sin aviso.
- Acción: reservar un nombre único o pedir confirmación explícita antes de reemplazar; publicar mediante temporal para no destruir una salida válida si falla la escritura.
- Estado: **destino determinista, ausencia de comprobación y escritura directa confirmados por código; no se sobrescribió un resultado real**.

### AUD-060 — el upscale de imagen ejecuta decodificación e inferencia ONNX en el handler síncrono

- Prioridad: **P1 — operación pesada sin worker dedicado, progreso ni cancelación**.
- Evidencia:
  - `upscale/runtime.rs::upscale_image()` es un comando Tauri síncrono (`pub fn`), no `async` (líneas 62–67).
  - Dentro del handler ejecuta `image::open()`, `run_realesrgan()` y el guardado PNG directamente (líneas 86–125).
  - `run_realesrgan()` recorre todas las teselas de la imagen e invoca ONNX Runtime por cada una; no hay `spawn_blocking`, evento de progreso ni mecanismo de cancelación. En contraste, `upscale_video()` traslada la operación a `spawn_blocking` y emite progreso.
- Impacto: una imagen permitida de hasta 2048×2048 puede requerir cientos de inferencias por teselas ×4. El handler queda ocupado durante todo el trabajo y no permite informar avance ni cancelar limpiamente la operación.
- Estado: **ejecución síncrona del pipeline completo confirmada por código; no se midió el comportamiento de la ventana durante una inferencia real**.

### AUD-061 — denoise y nitidez ejecutan el proceso FFmpeg y esperan su terminación dentro de handlers async

- Prioridad: **P1 — bloqueo de workers durante filtros de vídeo e imagen**.
- Evidencia:
  - `denoise_media()` en `commands/domains/media/denoise.rs` y `sharpen_media()` en `commands/domains/media/sharpen/command.rs` están declaradas `async`.
  - Ambas ejecutan FFprobe con `Command::output()`, inician FFmpeg con `spawn()` y luego llaman directamente a `child.wait()` en el propio handler (denoise.rs líneas 281–365; sharpen/command.rs líneas 94–95 y 173–220).
  - Los threads auxiliares solo consumen progreso/stderr; no trasladan la espera principal a `spawn_blocking`.
- Impacto: filtros de vídeo largos pueden ocupar workers Tokio durante toda la decodificación/encoding. Llamadas simultáneas pueden degradar la respuesta de IPC y otras funciones async.
- Estado: **handlers async y espera síncrona de FFmpeg confirmados por código; no se midió saturación en runtime**.

### AUD-062 — la descompresión de archivos `.lottie` no limita el tamaño expandido del ZIP

- Prioridad: **P1 — agotamiento de memoria mediante archivo comprimido**.
- Evidencia:
  - `LottiePanel.tsx::loadFile()` limita el archivo de entrada a 8 MB, pero ese límite solo se aplica al tamaño comprimido del ZIP.
  - `lottie.ts::extractLottieZip()` ejecuta `unzipSyncFn(new Uint8Array(buffer))`, descomprimiendo todas las entradas del ZIP completas en memoria antes de localizar `animation.json` (líneas 284–313).
  - No se comprueba el tamaño descomprimido total, el tamaño de cada entrada ni la relación de compresión antes de materializar los bytes.
- Impacto: un `.lottie` pequeño pero con entradas altamente comprimibles puede expandirse a cientos de MB/GB y agotar la memoria del WebView. Se descomprimen también recursos que luego no se utilizan.
- Acción: inspeccionar tamaños declarados y limitar bytes expandidos/entradas antes de descomprimir; extraer solamente la animación necesaria mediante un flujo con límite.
- Estado: **ZIP descomprimido íntegramente antes de cualquier límite expandido confirmado por código; no se creó ni abrió un ZIP de prueba de agotamiento**.

### AUD-063 — los frames PNG se decodifican desde Base64 antes de aplicar el límite de 16 MB

- Prioridad: **P1 — consumo de memoria no acotado por la validación de entrada IPC**.
- Evidencia:
  - `lottie.rs::write_alpha_frames()` acepta `Vec<String>` de hasta 24 elementos por llamada.
  - Para cada frame ejecuta primero `STANDARD.decode(payload)` y solo después compara `bytes.len()` con `MAX_FRAME_BYTES = 16 MiB` (líneas 109–113).
  - No valida previamente la longitud Base64 ni limita el tamaño agregado del lote; el límite individual llega después de reservar y decodificar el contenido.
- Impacto: una llamada IPC con una cadena Base64 enorme puede reservar memoria proporcional al payload antes de que el backend la rechace. Con múltiples frames, la asignación y las copias pueden crecer mucho más que el límite pretendido.
- Acción: rechazar por longitud Base64 antes de decodificar, imponer límite agregado por lote y transmitir/escribir frames de forma incremental.
- Estado: **orden de decodificación y validación confirmado por código; no se envió una carga sobredimensionada al proceso**.

### AUD-064 — un error en el primer lote de frames Lottie deja la carpeta temporal sin limpiar

- Prioridad: **P2 — residuos temporales en el perfil de Windows**.
- Evidencia:
  - `write_alpha_frames()` crea la carpeta `olyvia-lottie-<token>` y escribe los PNG de uno en uno; ante cualquier payload inválido o error de escritura retorna sin eliminar los archivos ya escritos (lottie.rs líneas 97–119).
  - `LottiePanel.convert()` marca `wroteFrames = true` solo después de que `writeAlphaFrames()` termina sin error (LottiePanel.tsx líneas 128–136).
  - Si falla el primer lote después de escribir uno o más frames, el `catch` ve `wroteFrames === false` y no llama a `discardAlphaFrames()` (líneas 163–166).
- Impacto: los PNG del primer lote quedan en `%TEMP%\olyvia-lottie-<token>` sin referencia ni limpieza desde la interfaz. La repetición genera otro token y deja más residuos.
- Acción: limpiar siempre el token en `finally` ante cualquier error, o hacer que el comando Rust elimine la carpeta al fallar un lote parcial.
- Estado: **ruta de error y condición de limpieza omitida confirmadas por código; no se provocó un lote inválido en runtime**.

### AUD-065 — la conversión Lottie puede agregar al proyecto actual un archivo creado en el proyecto anterior

- Prioridad: **P1 — referencias de medios entre proyectos**.
- Evidencia:
  - `LottiePanel.convert()` verifica que exista `project` al inicio, pero no captura ni vuelve a comprobar `project.id` durante los `await` de rasterización y `alphaFramesToAsset()`.
  - `alpha_frames_to_asset_impl()` captura la sesión activa al comenzar el comando y utiliza `session.root` para importar el WebM (lottie.rs líneas 249–286).
  - Cuando el comando termina, el frontend llama a `store.mutate()` sobre el estado actual (líneas 138–154) sin comprobar que el proyecto siga siendo el mismo que al iniciar la operación.
- Impacto: si el usuario cambia de proyecto mientras se codifica/importa el WebM, el archivo puede quedar guardado en la carpeta del proyecto A y la referencia del asset agregarse al JSON del proyecto B. El nuevo proyecto queda con un medio fuera de su carpeta original.
- Acción: capturar el ID de proyecto al inicio, vincular backend y frontend a esa sesión y cancelar/rechazar el resultado si cambia el proyecto.
- Estado: **sesión backend y store frontend no vinculados a la misma identidad a través de la espera confirmados por código; no se cambió de proyecto durante la conversión**.

### AUD-066 — codificación Lottie ejecuta FFmpeg mediante `Command::output()` dentro del comando async

- Prioridad: **P1 — bloqueo de worker durante exportación de secuencia con alfa**.
- Evidencia:
  - `alpha_frames_to_asset()` es un comando Tauri `async` y espera `alpha_frames_to_asset_impl()` (lottie.rs líneas 303–325).
  - La implementación invoca `encode_sequence()` directamente; esta función inicia FFmpeg con `Command::output()` y espera a su finalización (líneas 133–181).
  - El trabajo puede abarcar hasta 3.600 frames según el límite del backend; no se usa `spawn_blocking`, supervisor de procesos ni cancelación.
- Impacto: una conversión Lottie larga bloquea el worker Tokio que atiende el IPC y retrasa otras operaciones asíncronas durante el encoding VP9+alfa.
- Estado: **flujo async→sync y espera completa de FFmpeg confirmados por código; no se ejecutó una conversión larga para medir el bloqueo**.

### AUD-067 — el upscale de vídeo exige libx264, ausente del FFmpeg incluido en la aplicación

- Prioridad: **P1 — la función de upscale de vídeo falla con el binario distribuido**.
- Evidencia:
  - `commands/domains/media/upscale/video.rs::upscale_video_blocking()` fija `-c:v libx264` en los argumentos del encoder (líneas 226–228), sin detectar alternativas.
  - Se ejecutó `-hide_banner -encoders` contra `apps/desktop/src-tauri/resources/ffmpeg/ffmpeg.exe`, el binario empaquetado del proyecto. La lista incluye `libopenh264`, `h264_amf`, `h264_nvenc` y `h264_qsv`, pero no incluye `libx264`.
  - El propio módulo de sharpening dispone de `resolve_encoder()` para elegir un H.264 disponible y comprobar que inicialice; el upscale no usa esa resolución.
- Impacto: el FFmpeg incluido devuelve `Unknown encoder 'libx264'` al intentar codificar el vídeo ampliado, por lo que la función no puede terminar con ese binario aunque haya otros encoders H.264 disponibles.
- Estado: **incompatibilidad confirmada con el ejecutable FFmpeg empaquetado; se verificó la lista de encoders, sin ejecutar una exportación de vídeo real**.

### AUD-068 — la finalización tardía de un guardado puede sobrescribir metadatos y recuperación del proyecto que se abrió después

- Prioridad: **P1 — estado cruzado entre proyectos y posible pérdida de recuperación**.
- Evidencia:
  - `project-store-provider.tsx::saveNow()` captura `snapshot.project` al iniciar el guardado y espera `service.saveProject(toSave)` (líneas 255–268).
  - Si durante esa espera se abre otro proyecto, al completar el guardado `current.project !== captured` entra en una rama especial (líneas 276–284), pero conserva el proyecto actual y actualiza su `opened.path`, `opened.root` y `opened.label` con los valores devueltos por el guardado anterior.
  - Antes de comprobar si siguen siendo el mismo proyecto, también asigna `persistedVersionRef.current = version` y ejecuta `recoveryWriter.cancel()` y `clearRecoverySnapshot()` (líneas 269–275). La instantánea de recuperación usa una única clave global y puede pertenecer ya al proyecto nuevo.
- Impacto: un guardado demorado de A puede dejar el estado del frontend con el documento B y la ruta/raíz de A. Además puede borrar la instantánea de recuperación más reciente de B. El siguiente autosave puede corregir la ruta visual, pero si la app se cierra antes, la recuperación y los metadatos quedan inconsistentes.
- Acción: asociar cada guardado a una generación/ID de sesión; aplicar sus resultados, limpiar recuperación y actualizar versiones solo si el proyecto abierto sigue siendo el mismo y la versión guardada cubre el estado actual.
- Estado: **rama de finalización tardía y limpieza sin comprobación de identidad confirmadas por código; no se hizo un cambio de proyecto durante un guardado real**.

### AUD-069 — `Guardar como` puede volver a adoptar el proyecto anterior después de que el usuario abrió otro

- Prioridad: **P1 — sesión nativa y proyecto visible quedan desincronizados**.
- Evidencia:
  - `application/projects.rs::save_project_as()` captura `session.require()` al inicio, copia todos los assets a la nueva carpeta (líneas 266–282), guarda el JSON y finalmente llama a `open_and_adopt()` (líneas 284–285).
  - No vuelve a comprobar que la sesión nativa siga siendo la misma que al iniciar el proceso, ni mantiene un bloqueo transaccional de sesión durante copia/guardado/adopción.
  - `adopt_project` es otra operación IPC que puede cambiar la sesión mientras Save As está copiando. La operación Save As posterior puede adoptar de nuevo la ruta del proyecto anterior.
  - En el frontend, `saveAs()` detecta que `current.project !== captured` y conserva el proyecto visible y su `opened` actual (project-store-provider.tsx líneas 324–331), por lo que no refleja la adopción que ya ocurrió en el backend.
- Impacto: si se abre el proyecto B mientras Save As de A sigue trabajando, Save As puede terminar cambiando la sesión nativa de B a la copia de A, mientras la interfaz mantiene B abierto. Los siguientes guardados de B pueden fallar con `SessionMismatch` o dirigirse a una sesión distinta.
- Estado: **ausencia de bloqueo/generación de sesión y adopción al final de Save As confirmadas por código; no se ejecutó el cambio de proyecto durante la copia de assets**.

### AUD-070 — `package_project` permite escribir el ZIP en cualquier ruta del sistema desde MCP

- Prioridad: **P1 — escritura arbitraria de archivos mediante automatización/MCP**.
- Evidencia:
  - La herramienta MCP `package_project` admite `path` como cadena de hasta 32.768 caracteres (mcp-catalog.ts líneas 940–945) y su descripción dice que escribe directo sin diálogo.
  - `save_delivery_package()` recibe `output_path` y, cuando existe, lo transforma directamente a `PathBuf` (package.rs líneas 123–127).
  - El comentario de esa rama afirma que se escribe dentro del root del proyecto, pero `ensure_path_is_safe()` no verifica `output.starts_with(root)` ni restringe la ruta a una carpeta aprobada. Solo impide sobrescribir el JSON principal del proyecto y las rutas de medios referenciadas (publish.rs líneas 97–138).
  - Después `write_atomic()` crea carpetas temporales en el parent de la ruta arbitraria y publica el ZIP en ese destino (package.rs líneas 86–109). Si ya existe, la ruta elimina primero el archivo previo.
- Impacto: un agente MCP o una entrada manipulada puede hacer que la aplicación cree o reemplace archivos ZIP fuera de la carpeta del proyecto, en cualquier ubicación donde el usuario tenga permisos. No requiere el diálogo de guardado ni una confirmación adicional del usuario.
- Estado: **ausencia de confinamiento de output_path confirmada por código y herramienta MCP expuesta; no se escribió fuera del proyecto durante la auditoría**.

### AUD-071 — el decodificador ZIP de `package_project` reserva memoria antes de aplicar el máximo de 64 MB

- Prioridad: **P1 — agotamiento de memoria por payload IPC sobredimensionado**.
- Evidencia:
  - `package.rs::decode_package()` ejecuta `STANDARD.decode(encoded)` y materializa todo el ZIP en un `Vec<u8>` (líneas 56–62).
  - El límite `MAX_PACKAGE_BYTES = 64 MiB` se comprueba recién después de la decodificación (líneas 66–68).
  - La cadena Base64 puede ser considerablemente mayor que 64 MiB y no hay validación previa de longitud ni límite agregado antes de reservar la salida decodificada.
- Impacto: una solicitud MCP/IPC con una cadena enorme puede consumir memoria proporcional al payload antes de que el backend responda que supera 64 MB; la validación actual no protege la fase de asignación.
- Estado: **orden de decodificación y comprobación confirmado por código; no se envió un payload sobredimensionado**.

### AUD-072 — la cola por carpetas puede reemplazar proyectos de salida por colisión de nombres

- Prioridad: **P1 — pérdida silenciosa de una entrega anterior**.
- Evidencia:
  - `folder-queue.ts::processFile()` calcula el nombre de salida mediante `slug(file.name)` (líneas 122–128); `slug()` normaliza a minúsculas, elimina caracteres y limita a 60 caracteres.
  - La cola procesa cada vídeo secuencialmente y escribe `${stem}.editoria.json` y `${stem}.mp4` con ese mismo stem (líneas 180–189 y 230–233). Dos archivos de entrada en subcarpetas distintas pueden tener el mismo basename; nombres diferentes también pueden normalizar al mismo slug.
  - `variants.rs::write_project_file()` construye el destino y llama directamente a `service::save_project(&target, &project)` sin comprobar `target.exists()` (líneas 507–515). `service::save_project()` valida y escribe por temporal + rename, pero permite reemplazar el destino existente.
  - `render_project_variant()` sí rechaza si el MP4 ya existe (líneas 317–322), por lo que la segunda entrega puede haber reemplazado el JSON de la primera antes de fallar al publicar el vídeo.
- Impacto: la segunda entrada puede sobrescribir el proyecto de salida generado por la primera. La cola marca esa segunda entrada como fallida al detectar el MP4 existente, pero el `.editoria.json` anterior ya fue reemplazado por un proyecto que apunta al segundo medio.
- Estado: **colisión de slug, ausencia de comprobación de destino en write_project_file y orden secuencial confirmados por código; no se ejecutó una carpeta con basenames duplicados**.

### AUD-073 — un fallo de copia al publicar una variante deja un MP4 parcial con nombre definitivo

- Prioridad: **P2 — archivo de exportación corrupto residual**.
- Evidencia:
  - `render_project_variant()` valida el MP4 temporal y comprueba que el destino final no exista (líneas 378–390).
  - Publica mediante `std::fs::copy(&render_output, &final_output)` directamente al archivo definitivo (líneas 392–398). Si la copia falla por disco lleno, permisos o interrupción, la función devuelve error y elimina `temp_dir`, pero no elimina `final_output` que pudo quedar parcialmente escrito.
  - El siguiente intento detecta `final_output.exists()` y devuelve `AlreadyExists` (líneas 317–322), bloqueando la repetición aunque el archivo existente esté truncado.
- Impacto: el usuario puede quedarse con un MP4 corrupto que ocupa el nombre definitivo y no puede regenerarse desde la misma ruta sin intervención manual.
- Estado: **publicación directa y error sin limpieza confirmados por código; no se provocó un fallo de copia**.

### AUD-074 — `copy_media_into` deja medios parciales cuando falla `fs::copy`

- Prioridad: **P2 — archivos huérfanos en la carpeta de entregas**.
- Evidencia:
  - `variants.rs::copy_media_into()` reserva un nombre de destino libre y copia cada archivo mediante `std::fs::copy(&source, &candidate)` (líneas 458–469).
  - Si la copia devuelve error después de crear/truncar el destino, el `?` retorna inmediatamente; no elimina `candidate` ni revierte archivos copiados antes en el mismo lote.
  - En `folder-queue.ts`, esta función es llamada antes de construir y escribir el proyecto (líneas 139–143), así que un error puede dejar `media/<nombre>` sin documento de proyecto que lo referencie.
- Impacto: interrupciones o errores de disco pueden dejar medios truncados o copias válidas sin referencia en la carpeta de salida; las siguientes ejecuciones reservan otros nombres y acumulan residuos.
- Estado: **copia directa y ausencia de rollback confirmadas por código; no se provocó un error real de E/S**.

### AUD-075 — el listener MCP puede detenerse definitivamente por un error de `accept` y conservar un estado falso de servidor activo

- Prioridad: **P2 — integración MCP bloqueada hasta reiniciar la aplicación**.
- Evidencia:
  - `infrastructure/mcp_server.rs::serve_mcp()` inicia el accept loop en una tarea y ejecuta `let Ok((stream, _)) = listener.accept().await else { break; }` (líneas 467–471). Cualquier error de aceptación finaliza toda la tarea, sin retry ni registro del error.
  - `application/mcp_server.rs::start_server()` marca el estado global `info_slot` como activo después de que `serve_mcp()` devuelve `Ok(())` (líneas 64–70), pero no conserva un `JoinHandle` ni recibe notificación si la tarea del listener termina posteriormente.
  - Las llamadas posteriores a `start_server()` devuelven el `McpServerInfo` existente cuando `status()` contiene un valor, sin comprobar que el listener siga aceptando conexiones (líneas 60–63).
- Impacto: ante un error transitorio o de recursos del socket, el endpoint deja de atender MCP, pero la interfaz y las siguientes solicitudes de inicio pueden seguir mostrando el servidor como activo. El usuario no puede recuperarlo mediante el flujo normal de inicio sin reiniciar la app.
- Estado: **salida temprana del accept loop y estado global sin supervisión confirmados por código; no se forzó un error del socket en runtime**.

### AUD-076 — la tarjeta de subtítulos envía `burn=true` sin `outputPath`, por lo que el backend rechaza todas las ejecuciones por defecto

- Prioridad: **P1 — función principal de la tarjeta inutilizable con su configuración inicial**.
- Evidencia:
  - `SubtitlePipelineCard.tsx` inicializa `burn` en `true` (línea 23) y llama a `service.subtitlesPipeline()` enviando `inputPath`, `targetLanguage`, `sourceLanguage` y `burn`, pero nunca envía `outputPath` (líneas 46–51).
  - El componente solo presenta selector de vídeo, idiomas y checkbox de quemado; no presenta campo ni selector de destino de salida (líneas 78–126).
  - `subtitles_pipeline()` en Rust rechaza expresamente `burn=true` si `output_path` es `None` (líneas 125–130), antes de ejecutar Whisper.
  - La prueba `SubtitlePipelineCard.test.tsx` sustituye el servicio con `fake-service`, solo verifica que se llamó al método y no comprueba el contrato real del backend ni la ausencia de `outputPath` (líneas 40–52).
- Impacto: al pulsar «Generar subtítulos» con el valor por defecto, la interfaz recibe el error `burn=true requiere outputPath (.mp4)`; no llega a transcribir ni traducir el vídeo. El usuario tendría que desactivar el quemado para conseguir únicamente el `.ass`.
- Estado: **incompatibilidad frontend/backend confirmada por código y controles visibles; no se ejecutó el pipeline real**.

### AUD-077 — solicitudes simultáneas del pipeline de subtítulos comparten el mismo ASS y el mismo MP4 temporal

- Prioridad: **P2 — subtítulos cruzados y salida corrupta en ejecuciones concurrentes**.
- Evidencia:
  - `subtitles_pipeline()` deriva `ass_path` determinísticamente de `output_path` (o `input_path`) y lo escribe mediante `std::fs::write()` sin un identificador único (líneas 243–265).
  - Para `burn=true`, todas las ejecuciones con el mismo `outputPath` utilizan el mismo `tmp = out.with_extension("tmp.mp4")` (línea 285), y FFmpeg escribe allí con `-y` (líneas 293–316).
  - No existe lock por destino ni reserva atómica de una operación; el comando está expuesto tanto a la tarjeta de UI como a la herramienta MCP `subtitles_pipeline`.
  - El botón de UI impide la doble ejecución dentro de una misma tarjeta, pero no evita dos llamadas concurrentes desde MCP o desde dos ventanas/sesiones.
- Impacto: dos peticiones para el mismo destino pueden truncar/reemplazar el ASS mientras el otro FFmpeg lo lee y competir por el mismo MP4 temporal. El resultado puede contener la traducción equivocada, fallar al publicar o quedar incompleto.
- Estado: **nombres temporales compartidos y ausencia de exclusión confirmados por código; no se lanzaron peticiones concurrentes**.

### AUD-078 — el pipeline exige FFmpeg incluso cuando el usuario desactiva el quemado de subtítulos

- Prioridad: **P2 — modo de generación `.ass` sin vídeo no funciona con FFmpeg no configurado**.
- Evidencia:
  - Con `burn=false`, el pipeline solo necesita transcribir, opcionalmente traducir y escribir el archivo ASS.
  - Aun así, `subtitles_pipeline()` realiza `ffmpeg_opt.ok_or_else(...)` de forma incondicional (líneas 234–240), antes de comprobar si el bloque de quemado se va a ejecutar.
  - Todas las llamadas a FFmpeg están dentro del bloque `if burn`; cuando `burn=false` no existe otra operación que requiera el ejecutable FFmpeg.
- Impacto: una instalación donde faster-whisper y el proveedor IA funcionen pero FFmpeg no esté configurado no puede generar siquiera el `.ass`, aunque el usuario haya desactivado explícitamente la exportación de vídeo.
- Estado: **dependencia FFmpeg incondicional y ausencia de uso cuando burn=false confirmadas por código; no se probó una instalación sin FFmpeg**.

### AUD-079 — `subtitles_pipeline` bloquea un worker async durante Whisper, traducción y exportación FFmpeg

- Prioridad: **P1 — bloqueo de runtime durante transcripción y render de subtítulos**.
- Evidencia:
  - El handler `subtitles_pipeline()` es `async` (línea 103), pero ejecuta directamente `Command::output()` para Python/faster-whisper (líneas 160–185), operaciones síncronas de archivo/ASS (líneas 153–159 y 252–265) y uno o dos `Command::output()` para FFmpeg (líneas 292–316).
  - No usa `spawn_blocking` para el pipeline completo ni para la transcripción/encoding.
- Impacto: el worker que atiende IPC permanece bloqueado durante la transcripción, llamada al proveedor y encoding de un vídeo completo; operaciones concurrentes del runtime pueden retrasarse.
- Estado: **secuencia async con procesos y E/S síncronos confirmada por código; no se midió saturación del runtime**.

### AUD-076 — los timecodes EDL/FCPXML pueden desbordar `u64` y producir una timeline inválida

- Prioridad: **P2 — importación que falla por panic o convierte tiempos extremos en posiciones incorrectas**.
- Evidencia:
  - `media/timeline_import/otio.rs::parse_timecode()` parsea `hours` como `u64`, pero calcula `hours * 60 + minutes` y `(total_minutes * 60 + seconds) * nominal + frames` con aritmética no comprobada (líneas 191–200).
  - No existe un máximo para `hours` ni un límite temporal razonable antes de esos productos.
  - `media/timeline_import/fcpxml_parse.rs` reutiliza la misma función para timecodes XML (línea 266); el problema no queda limitado a EDL.
  - `import_timeline_file()` procesa el archivo del usuario en `spawn_blocking`, pero no captura un panic originado por el parser; el JoinError acaba devolviéndose como interrupción genérica.
- Impacto: un archivo de intercambio con un valor de horas muy grande puede desbordar las multiplicaciones. En compilación con overflow checks puede provocar panic del worker y abortar esa importación; en compilación sin esos checks puede envolver el resultado y convertir un timecode absurdo en un offset pequeño/inconsistente.
- Acción: validar un máximo de horas/duración y reemplazar las operaciones por `checked_mul`/`checked_add`; rechazar el timecode completo si se excede el rango.
- Estado: **operaciones no comprobadas y ausencia de cota confirmadas por código; no se ejecutó una importación con timecode extremo**.

### AUD-077 — el límite de 200 MB de lip-sync se aplica después de cargar el vídeo completo en memoria

- Prioridad: **P1 — consumo de RAM por respuesta de un motor local externo**.
- Evidencia:
  - `commands/domains/audio/lip_sync.rs::request_lipsync()` lee el cuerpo completo con `response.bytes().await` (líneas 160–165) y recién después compara su longitud con `MAX_RESPONSE_BYTES` (líneas 166–170).
  - Luego ejecuta `bytes.to_vec()` para devolver el resultado (línea 178), creando otra asignación del contenido completo.
  - La rama de HTTP no exitoso también usa `response.text().await` antes de recortar a 200 caracteres, por lo que un error HTTP puede reservar memoria por todo el cuerpo de error.
- Impacto: un servicio local de lip-sync que devuelva un cuerpo excesivo puede agotar memoria antes de que la app aplique el límite declarado. En una respuesta válida cercana a 200 MB se mantienen además buffers duplicados; una respuesta de error no tiene límite de lectura visible.
- Acción: comprobar `Content-Length` como filtro preliminar y leer el stream por bloques con límite estricto, cancelando al excederlo; aplicar el mismo máximo a cuerpos de error y evitar `to_vec()` adicional.
- Estado: **orden de lectura/validación y duplicación del buffer confirmados por código; no se envió una respuesta sobredimensionada al motor**.

### AUD-080 — varias funciones del módulo Creator exigen `libx264`, ausente del FFmpeg empaquetado

- Prioridad: **P1 — funciones principales de creación no exportan con el ejecutable incluido**.
- Evidencia:
  - La comprobación previa de `resources/ffmpeg/ffmpeg.exe -hide_banner -encoders` confirmó que el binario incluido no registra `libx264`, aunque sí registra `libopenh264`, `h264_amf`, `h264_nvenc` y `h264_qsv`.
  - `creator.rs::run_ffmpeg()` utiliza el ejecutable resuelto por `resolve_tools()` y no selecciona encoder ni hace fallback.
  - `aspect.rs::render_aspect()`, `chapters.rs::split_chapters_blocking()`, `broll.rs::broll_blocking()`, `hook.rs::hook_blocking()` y `cta.rs::cta_blocking()` fuerzan `-c:v libx264`.
  - `system.rs::find_executable()` prioriza el binario incluido antes de buscar en PATH, salvo que el usuario configure un override explícito. Por tanto la instalación por defecto utiliza un ejecutable que carece del encoder solicitado.
- Impacto: exportar múltiples relaciones de aspecto, dividir capítulos, intercalar B-roll, generar hook o CTA falla con `Unknown encoder 'libx264'` cuando se usa el FFmpeg incluido. Es un defecto compartido por varias funciones, separado del caso de upscale documentado en AUD-067.
- Estado: **compatibilidad del binario y selección fija del encoder confirmadas; no se ejecutaron exportaciones de esas funciones**.

### AUD-081 — Creator sobrescribe silenciosamente las exportaciones anteriores al repetir una operación

- Prioridad: **P2 — pérdida de archivos de salida generados previamente**.
- Evidencia:
  - `creator.rs::output_mp4()` crea el directorio y devuelve la ruta destino sin comprobar si ya existe el archivo.
  - `creator.rs::run_ffmpeg()` añade globalmente `-y` a todos los procesos FFmpeg; no solicita confirmación ni reserva un nombre nuevo.
  - `CreatorView.tsx` genera nombres deterministas a partir del vídeo de entrada: `<stem>-hook.mp4`, `<stem>-cta.mp4` y `<stem>-broll.mp4`; la exportación multi-aspect usa `<stem>-vertical-9x16.mp4`, `<stem>-horizontal-16x9.mp4` y `<stem>-square-1x1.mp4`. La división de capítulos también construye nombres deterministas.
  - No hay comprobación frontend de existencia ni advertencia antes de invocar esos comandos.
- Impacto: al repetir una operación sobre el mismo vídeo y carpeta, FFmpeg trunca y reemplaza los MP4 anteriores. Si el usuario había conservado o modificado una salida previa, se pierde sin aviso.
- Estado: **rutas deterministas, ausencia de comprobación de existencia y `-y` global confirmados por código; no se sobrescribieron archivos reales**.

### AUD-082 — el schema TypeScript acepta rutas `.` que Rust rechaza al guardar/abrir el proyecto

- Prioridad: **P2 — divergencia de validación entre frontend y backend**.
- Evidencia:
  - `packages/project-schema/src/paths.ts::ProjectRelativePathSchema` bloquea segmentos vacíos y `..`, pero no bloquea el segmento `.` (líneas 35–42). Ejemplos como `media/./clip.mp4` satisfacen todas las reglas del schema.
  - `packages/project-schema/src/paths.test.ts` prueba `..` y rutas absolutas, pero no contiene un caso para `media/./clip.mp4`.
  - Rust `projects/service.rs::path_problem()` y `media/mod.rs::is_forbidden_relative()` rechazan explícitamente segmentos `.` (service.rs líneas 386–390; media/mod.rs líneas 99–103).
- Impacto: un documento puede pasar `ProjectRelativePathSchema` en la interfaz/paquete y, al llegar a `save_project()`/`open_project()` en Rust, rechazarse con `PathEscapesRoot`. La validación compartida no garantiza el mismo resultado en ambos límites.
- Estado: **diferencia entre validadores confirmada por código; no se creó un proyecto con esa ruta**.

### AUD-083 — los límites de longitud de rutas difieren entre el validador del proyecto y el resolvedor de medios

- Prioridad: **P2 — proyectos que se validan pero no pueden resolver o copiar sus assets**.
- Evidencia:
  - `projects/service.rs::path_problem()` mide el máximo de 512 usando `value.chars().count()` (líneas 361–363). El schema TypeScript aplica `.max(512)` sobre el string (paths.ts línea 22).
  - `media/mod.rs::is_forbidden_relative()` utiliza `path.len()`, que en Rust mide bytes UTF-8, no caracteres (líneas 79–80).
  - Así, una ruta válida de hasta 512 caracteres Unicode puede pasar el schema y `validate_document()` pero exceder 512 bytes; luego `resolve_inside_root()` o `copy_project_assets()` la rechaza.
  - El test de rutas Unicode solo cubre un nombre corto y no detecta la diferencia de unidades.
- Impacto: proyectos con nombres/carpetas Unicode largos pueden abrirse y validarse, pero fallar más tarde al copiar medios en `Guardar como`, resolver medios para render o abrir una secuencia de archivos. El error parece una ruta incorrecta aunque el documento haya pasado su validación inicial.
- Estado: **unidades de longitud distintas confirmadas por código; no se generó una ruta Unicode larga para reproducirlo**.

### AUD-078 — el pipeline de subtítulos falla en su configuración predeterminada porque no envía `outputPath`

- Prioridad: **P1 — función de subtitulado/quemado inutilizable desde la tarjeta principal**.
- Evidencia:
  - `SubtitlePipelineCard.tsx` inicializa `burn` en `true` (línea 23).
  - Al llamar `service.subtitlesPipeline()`, solo envía `inputPath`, `targetLanguage`, `sourceLanguage` opcional y `burn` (líneas 46–51); no hay selector ni valor `outputPath` en el componente.
  - `commands/domains/creator/subtitles_pipeline.rs::subtitles_pipeline()` calcula `burn = request.burn && request.output_path.is_some()` y, si `request.burn` es true pero `output_path` es None, retorna error `burn=true requiere outputPath (.mp4)` (líneas 125–130).
  - Por tanto, al abrir la tarjeta por primera vez y pulsar Generar subtítulos, la solicitud se rechaza antes de transcribir. Desactivar el checkbox evita esa validación, pero solo genera el `.ass`; no genera el MP4 que la descripción de la tarjeta promete.
- Impacto: el flujo principal no puede terminar el quemado de subtítulos desde la interfaz y falla inmediatamente en su estado predeterminado.
- Acción: añadir selección/derivación segura del destino MP4 y enviarlo como `outputPath`, o cambiar la UX y el contrato para ofrecer explícitamente generación `.ass` sin burn.
- Estado: **desajuste frontend/backend confirmado por código; no se ejecutó la tarjeta en runtime**.

### AUD-079 — el pipeline automático de subtítulos aprueba el coste remoto sin consentimiento del usuario

- Prioridad: **P1 — llamadas de traducción facturables sin confirmación de coste**.
- Evidencia:
  - `commands/domains/creator/subtitles_pipeline.rs` crea `TranslateRequest` con `approved_cost: true` en forma fija (líneas 213–225).
  - `application/providers.rs::translate_subtitles()` pasa ese campo a `generation_provider()`, que rechaza proveedores no locales cuando `approved_cost` es false (líneas 315–322); la política común de coste sí está implementada.
  - `SubtitlePipelineCard.tsx` no muestra confirmación de coste ni envía `approvedCost`; solo deja seleccionar el idioma destino y ejecutar (líneas 21–24 y 46–51).
  - La pantalla general LocalizationView sí envía un estado explícito `approvedCost` para la misma operación, lo que evidencia una diferencia de control entre ambas rutas.
- Impacto: con un proveedor remoto configurado, pulsar el pipeline puede emitir una o dos llamadas facturables (incluido el reintento de reparación) sin la confirmación que exigen las demás rutas de traducción.
- Acción: incorporar un consentimiento explícito en la tarjeta y propagarlo; no fijar `approved_cost` a true en el backend.
- Estado: **bypass de la política de consentimiento confirmado por código; no se realizaron llamadas remotas ni cargos**.

### AUD-080 — diarización permite enviar la clave y el audio a un endpoint remoto HTTP sin TLS

- Prioridad: **P1 — exposición de credenciales y material audiovisual en tránsito**.
- Evidencia:
  - `commands/domains/audio/diarize.rs::save_diarize_provider()` acepta cualquier URL cuyo texto empiece por `http://` o `https://` (líneas 100–107); no exige HTTPS para hosts remotos ni valida loopback de forma especial.
  - `SpeakersSection.tsx::save()` envía `baseUrl` directamente al comando y no llama al validador de URLs compartido (líneas 53–62 y 130–137).
  - `diarize.rs::deepgram()` y `assemblyai()` envían la clave mediante `Authorization`/`authorization` y el audio como cuerpo binario al host configurado (líneas 219–225 y 261–267).
  - El propio validador común `shared.ts::validateProviderBaseUrl()` establece la política esperada: solo admite HTTP para loopback; proveedores remotos deben usar HTTPS (líneas 375–405). Esa política no se aplica a diarización.
- Impacto: al configurar un host remoto con `http://`, la clave API y el audio viajan sin cifrado de transporte y pueden ser observados o modificados en la red. También se contradice el mensaje del backend que dice que la URL debe empezar por `https://`.
- Acción: parsear la URL en Rust; permitir HTTP solo para loopback exacto y exigir HTTPS para cualquier host remoto. Reutilizar la misma regla en frontend y backend.
- Estado: **aceptación de HTTP remoto y envío del token/audio confirmado por código; no se configuró ni contactó un endpoint HTTP**.

### AUD-081 — diarización carga el archivo completo en RAM y no limita duración ni tamaño antes de subirlo

- Prioridad: **P1 — consumo de memoria no acotado durante diarización**.
- Evidencia:
  - `commands/domains/audio/diarize.rs::diarize_audio()` lee el medio completo con `std::fs::read(&source)` (líneas 380–389).
  - No consulta tamaño/duración antes de leer, no define `MAX_FILE_BYTES`/`MAX_DURATION_SECONDS` ni transmite el archivo por streaming.
  - El vector completo se pasa como body a Deepgram o AssemblyAI; no se libera hasta finalizar el upload/request. No existe un límite explícito del tamaño de respuesta JSON del proveedor (`response.json()`/`poll.json()`).
- Impacto: un archivo de audio de varios GB puede reservar una cantidad equivalente de RAM antes de iniciar la petición. El JSON de respuesta también se deserializa completo y puede crecer con transcripciones largas. En equipos con memoria limitada la función puede congelar la app o provocar falta de memoria.
- Acción: comprobar tamaño y duración antes de aceptar el medio, establecer un límite acorde al proveedor, transmitir desde archivo por streaming y limitar también el tamaño de las respuestas JSON.
- Estado: **lectura total a memoria y ausencia de límites confirmadas por código; no se subió un archivo grande ni se provocó OOM**.

### AUD-082 — clonación de voz valida el máximo de 20 MB después de descargar la respuesta completa

- Prioridad: **P1 — consumo de RAM no acotado por respuesta del motor de voz**.
- Evidencia:
  - `voice_clone.rs::request_clone()` consume el cuerpo completo con `response.bytes().await` (línea 286).
  - Solo después compara `bytes.len()` con `MAX_AUDIO_BYTES` (20 MB) (líneas 292–297); el límite no frena la lectura.
  - La rama de error HTTP usa `response.text().await` sin máximo de bytes antes de truncar el mensaje a 200 caracteres (líneas 267–278).
  - Tras validar el WAV, devuelve `bytes.to_vec()` (línea 312), duplicando la memoria de una respuesta aceptada.
- Impacto: un motor XTTS/GPT-SoVITS que responda con un WAV enorme puede hacer que la app cargue todo el contenido antes de rechazarlo; las respuestas HTTP de error también carecen de límite. Puede producir congelamiento o falta de memoria.
- Acción: leer la respuesta por bloques con máximo estricto de 20 MB, limitar igualmente respuestas de error y evitar duplicar el vector cuando se devuelve.
- Estado: **lectura completa, validación posterior y copia confirmadas por código; no se envió una respuesta sobredimensionada al motor**.

### AUD-083 — la mejora de diálogo deja archivos temporales al fallar la escritura o la medición del WAV

- Prioridad: **P2 — acumulación de archivos PCM/WAV sin referencia en la carpeta de destino**.
- Evidencia:
  - `dialogue.rs::process_audio()` crea `.voz-<UUID>.f32` y escribe los samples con `write_all(...)?` (líneas 298–314). Si una escritura falla, retorna sin eliminar el archivo parcial.
  - Después crea `.voz-<UUID>.wav` con FFmpeg. Si `probe_file(ffprobe, &temp_wav, MediaKind::Audio)` falla, el `?` retorna sin quitar ese WAV temporal (línea 372).
  - La limpieza de `raw_path` ocurre solo después de que `encode.output()` retorna; la limpieza del WAV solo está en ramas de status no-success o duración cero, no en el error de FFprobe.
- Impacto: errores de disco o FFprobe dejan archivos ocultos `.voz-*.f32`/`.voz-*.wav` en la carpeta que eligió el usuario. Repetir la mejora puede acumular residuos grandes sin asociarlos a ningún asset.
- Acción: envolver cada archivo temporal en un guard de limpieza RAII y conservarlo únicamente cuando se publique el nombre final.
- Estado: **rutas de salida temprana sin limpieza confirmadas por código; no se provocó un fallo de disco/FFprobe**.

### AUD-084 — narración SAPI deja un WAV huérfano si falla FFprobe o SHA-256 después de sintetizar

- Prioridad: **P2 — medios generados sin asset ni aviso de recuperación**.
- Evidencia:
  - `synthesize_narration()` crea un destino UUID bajo `media/` y ejecuta `synthesize_sapi_wav()` (líneas 271–286). La función SAPI ya ha escrito el WAV cuando retorna correctamente.
  - A continuación `probe_file(...)?` y `sha256_file(...)?` propagan errores sin eliminar el archivo generado (líneas 288–289).
  - El asset del proyecto solo se construye y se devuelve más tarde (líneas 308–343); si probe o hash fallan, no existe referencia al archivo que quedó en `media/`.
- Impacto: una interrupción/lectura defectuosa de FFprobe o del hash deja una narración WAV en la carpeta de medios, pero no devuelve el asset al frontend ni queda registrada en el documento. El usuario puede interpretar que la síntesis falló y repetirla.
- Acción: generar en un temporal y publicarlo/registrarlo después de validar metadatos y hash; eliminarlo en cualquier error anterior al registro.
- Estado: **orden de generación, validación y retorno confirmado por código; no se simuló un error de lectura**.

### AUD-084 — conversión/compresión selecciona `libx264` como software aunque el FFmpeg distribuido solo incluya `libopenh264`

- Prioridad: **P1 — compresión y conversión de vídeo fallan en modo software y en equipos sin encoder de hardware compatible**.
- Evidencia:
  - `render/ffmpeg/probe.rs::detect_hardware()` solo busca encoders de hardware (`h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_videotoolbox`); no selecciona encoders de software.
  - `media/conversion.rs::h264_encoder()` devuelve `libx264` para `EncoderPref::Software` y también como fallback de `Auto`/`Hardware` cuando no se detecta encoder hardware.
  - La inspección previa del FFmpeg empaquetado confirmó ausencia de `libx264` y presencia de `libopenh264`. El renderer principal ya conoce `libopenh264` como fallback de software, pero el módulo de conversión no.
- Impacto: las operaciones de conversión/compresión MP4/MKV/MOV/AVI/FLV/TS que elijan Software, o Auto en un equipo sin H.264 hardware funcional, intentan iniciar un encoder que no existe y terminan con `Unknown encoder 'libx264'`. La selección de software deja de ser una alternativa válida.
- Estado: **algoritmo de selección, listas de hardware y encoders disponibles del binario confirmados; no se ejecutó una conversión en una máquina sin hardware compatible**.

### AUD-085 — la validación nativa de proyectos solo confina `assets[].source.path` y deja rutas derivadas para validación tardía

- Prioridad: **P2 — documentos inválidos aceptados y errores tardíos al renderizar/copiar recursos**.
- Evidencia:
  - `projects/service.rs::validate_document()` recorre `assets[]` y aplica `path_problem()` únicamente a `assets[i].source.path` (líneas 810–829). No valida en esa fase `assets[i].proxy.path`, `look.lutFile`, `timeline.clips[i].effects.lutFile` ni `timeline.clips[i].stabilization.transformFile`.
  - `media/mod.rs` tiene helpers específicos `project_proxy_paths()`, `project_lut_paths()` y `project_stabilization_paths()` que sí llaman a `is_forbidden_relative()`, pero solo se ejecutan desde `copy_project_assets()` durante `Guardar como`, no desde `validate_document()` al abrir/guardar un proyecto normal.
  - En el schema TypeScript, `AssetProxySchema.path` sí usa `ProjectRelativePathSchema`, pero los campos `lutFile` y `transformFile` son solo `z.string().min(1).max(500)`, por lo que aceptan rutas absolutas o segmentos `..`.
  - El render de LUT usa `resolve_inside_root()` antes de consumir el archivo; por ello la ruta insegura no queda habilitada para lectura externa, pero el error se produce tardíamente al generar el render o al copiar recursos.
- Impacto: un documento puede superar la validación de apertura/guardado aunque proxy, LUT o transform apunten fuera del root o tengan rutas inválidas. Después puede fallar en render, en previsualización o en `Guardar como`, haciendo difícil detectar qué campo del proyecto está roto.
- Acción: usar un validador común de rutas relativas en schema y Rust para todos los recursos derivados y aplicarlo en `validate_document()`.
- Estado: **cobertura incompleta de `validate_document`, schemas permisivos y validación tardía en helpers confirmadas por código; no se abrió un proyecto manipulado**.

### AUD-085 — el doblaje completo ejecuta SAPI, FFprobe y FFmpeg en el worker async de Tauri

- Prioridad: **P1 — bloqueo del runtime durante doblaje de varios subtítulos**.
- Evidencia:
  - `commands/domains/audio/dubbing/command.rs::synthesize_dub()` es un handler `async` y, después de `sapi_voices(&state).await`, llama directamente a `synthesize_dub_file()` sin `spawn_blocking` (líneas 39–82).
  - `synthesize_dub_file()` recorre hasta `MAX_CUES = 60`; por cada cue ejecuta `synthesize_sapi_wav()` y FFprobe en serie (synthesis.rs líneas 24–45).
  - Después lanza FFmpeg con `Command::spawn()` y espera `child.wait()` en el mismo hilo (líneas 62–129).
  - La generación de cada cue usa PowerShell síncrono (`Command::output()` en `narration.rs::run_powershell()`).
- Impacto: una operación que puede ejecutar decenas de síntesis de voz y un render FFmpeg mantiene ocupado un worker Tokio del handler Tauri durante toda la corrida. Otras llamadas IPC asíncronas pueden sufrir latencia mientras dura el doblaje.
- Acción: trasladar el caso de uso completo a `spawn_blocking`/worker dedicado, conservar el progreso y añadir cancelación/timeout de procesos.
- Estado: **cadena completa de llamadas síncronas desde el handler async confirmada por código; no se midió saturación en runtime**.

### AUD-086 — el proceso FFmpeg del doblaje puede bloquearse porque `stderr` se drena después de `wait()`

- Prioridad: **P1 — exportación de doblaje potencialmente indefinida con archivos problemáticos**.
- Evidencia:
  - `dubbing/synthesis.rs` configura `stderr(Stdio::piped())` al crear FFmpeg (líneas 92–95).
  - El único thread lector consume `stdout` para progreso (líneas 105–123). No hay un lector paralelo de `stderr`.
  - El hilo principal llama primero a `child.wait()` (línea 124) y recién después ejecuta `handle.read_to_string(&mut stderr)` (líneas 125–128).
- Impacto: si FFmpeg produce suficientes líneas de error/diagnóstico para llenar el buffer de la pipe, el hijo se bloquea al escribir `stderr`; el padre queda esperando en `wait()` y nunca llega a leer esa pipe. El handler no tiene timeout ni cancelación para liberar el proceso.
- Acción: drenar `stderr` concurrentemente desde que inicia el proceso (con buffer/log limitado), o enviarlo a un destino que no bloquee; aplicar timeout y terminación del hijo.
- Estado: **orden wait-before-drain confirmado por código; no se reprodujo con un vídeo dañado ni se llenó la pipe en runtime**.

### AUD-086 — la identidad de timing de clips puede validarse incorrectamente por desbordamiento de `u64`

- Prioridad: **P2 — proyectos con velocidad/duración incoherentes aceptados por el validador nativo**.
- Evidencia:
  - `packages/project-schema/src/time.ts::SafeIntegerSchema` se define como `z.number().int().finite()` sin `.safe()` ni límite máximo. `FrameRateSchema.num` y `.den` usan ese esquema sin cota superior (líneas 15 y 25–30).
  - `projects/service.rs::validate_document()` convierte `durationFrames`, `speed.num`, `speed.den`, `outFrame` e `inFrame` a `u64` y comprueba la identidad con `duration * num != window * den` (líneas 556–571), sin `checked_mul`.
  - Los frames sí están acotados a 5.184.000, pero el numerador/denominador de la velocidad no tiene límite. Valores dentro de `u64` pueden desbordar al multiplicarse; en build release el producto puede envolver y producir una igualdad falsa. Valores mayores que `u64` hacen que `number()` devuelva `None` y se sustituyan por 1 mediante `unwrap_or(1)`.
  - Ejemplo de entrada aceptada por los límites de los campos: `durationFrames=3`, ventana de fuente de 1 frame, `speed.num=speed.den=9223372036854775808`. Ambos productos envuelven al mismo valor módulo 2^64 aunque la duración real del clip no coincide con la ventana fuente.
- Impacto: `validate_document()` puede aceptar un clip cuya duración no concuerda con sus frames fuente/velocidad. En builds con overflow checks habilitados, la multiplicación también puede provocar panic al abrir un documento manipulado.
- Acción: limitar explícitamente num/den a un rango de velocidad razonable y usar `checked_mul` (rechazando overflow) para ambos lados de la identidad.
- Estado: **ausencia de límites superiores y multiplicación no comprobada confirmadas por código; no se abrió un proyecto con esos valores extremos**.

### AUD-087 — el límite de 200 MB de respuesta de lip-sync se comprueba después de cargar todo el MP4 en RAM

- Prioridad: **P1 — el control de memoria no evita una respuesta sobredimensionada del motor local**.
- Evidencia:
  - `lip_sync.rs::request_lipsync()` consume el cuerpo de respuesta completo mediante `response.bytes().await` (líneas 160–165).
  - Solo después comprueba `bytes.len() > MAX_RESPONSE_BYTES` (líneas 166–171), cuyo valor es 200 MB.
  - Luego `bytes.to_vec()` crea otra copia del cuerpo validado (línea 178), aumentando el pico de memoria por encima del tamaño total de la respuesta.
- Impacto: un motor local defectuoso o comprometido puede devolver un MP4 enorme; la aplicación reserva el cuerpo entero antes de rechazarlo y puede mantener al mismo tiempo el buffer original y la copia, provocando una caída por falta de memoria.
- Acción: leer el stream con límite incremental y evitar la copia adicional del `Bytes` ya validado.
- Estado: **lectura ilimitada, comprobación posterior y copia confirmadas por código; no se configuró un motor que devolviera una respuesta sobredimensionada**.

### AUD-088 — FFprobe se ejecuta de forma síncrona varias veces dentro del handler async de lip-sync

- Prioridad: **P1 — bloqueo del runtime antes y después de la llamada al motor**.
- Evidencia:
  - `lip_sync()` es `async`, pero llama directamente a `probe_video()` y `probe_audio()` para los medios de entrada (líneas 214–226) y vuelve a llamar a `probe_video()` sobre la respuesta temporal (líneas 244–250).
  - `probe_video()`/`probe_audio()` usan `probe_file()`, que ejecuta `Command::output()` para FFprobe de forma síncrona.
  - La llamada HTTP al motor usa `.await`, pero los sondeos previos y posteriores no se trasladan a `spawn_blocking`.
- Impacto: archivos con metadatos complejos o ubicados en almacenamiento lento pueden bloquear un worker Tokio en cada una de las validaciones de entrada/salida; operaciones IPC concurrentes se retrasan antes o después del procesamiento de labios.
- Estado: **handler async, llamadas de FFprobe y `Command::output()` confirmados por código; no se midió latencia durante un lip-sync real**.

### AUD-087 — `diarize_audio` permite cargar y enviar al proveedor cualquier archivo local, sin restringirlo al proyecto

- Prioridad: **P1 — exfiltración de archivos locales a un proveedor externo desde el límite IPC**.
- Evidencia:
  - `commands/domains/audio/diarize.rs::diarize_audio()` recibe `path: String`, lo convierte directamente en `PathBuf` y solo verifica `source.is_file()` (líneas 361–389). No llama a `state.require_session()`, `resolve_inside_root()` ni comprueba que el archivo sea un asset de audio del proyecto.
  - Después ejecuta `std::fs::read(&source)` y entrega esos bytes a Deepgram o AssemblyAI mediante las funciones HTTP (líneas 387–397).
  - El comando está expuesto en `commands/registry.rs` dentro de `generate_handler!` (línea 101). El frontend normal construye la ruta desde `asset.source.path`, pero esa validación no existe en la frontera Rust/IPC.
  - El schema del proyecto define `ProjectRelativePathSchema` y rechaza rutas absolutas, `..` y separadores inversos; `diarize_audio` no usa ese schema ni una validación equivalente.
- Impacto: cualquier código que pueda invocar el comando Tauri —por ejemplo, una vista comprometida o XSS— puede pasar una ruta a otro archivo legible de Windows y hacer que su contenido se cargue y se envíe al proveedor configurado, siempre que exista una clave y proveedor activos. La API puede recibir datos que no pertenecen al proyecto ni son audio.
- Acción: cambiar el contrato para recibir `asset_id`, resolver el asset dentro de la sesión abierta y verificar que sea audio/video con ruta dentro del root; no aceptar una ruta absoluta arbitraria desde IPC.
- Estado: **ruta absoluta no restringida, lectura y envío externo confirmados por código; no se intentó acceder ni transmitir archivos fuera del proyecto**.

### AUD-088 — la descarga y extracción de modelos no limitan bytes durante la escritura en disco

- Prioridad: **P2 — agotamiento de almacenamiento por respuesta de descarga/ZIP sobredimensionada**.
- Evidencia:
  - `models.rs::stream_download()` copia cada bloque HTTP al consumidor hasta EOF (líneas 279–310), sin limitar el total al tamaño declarado en `ModelFileSpec.bytes` ni al tamaño esperado del ZIP.
  - `ensure_archive()` guarda el ZIP completo en `.zip.partial` y solo comprueba que la descarga terminó; no existe máximo de bytes para el paquete (líneas 315–357).
  - `download_file_verified()` extrae la entrada ZIP a `.partial` y aumenta `written` mientras escribe, pero compara `written != file.bytes` únicamente después de extraer el stream completo (líneas 400–456).
  - Para el archivo Real-ESRGAN, el catálogo espera un `.data` de 66.737.664 bytes; una entrada descomprimida mayor puede ocupar todo el espacio disponible antes de fallar por tamaño/hash.
- Impacto: un CDN/servidor comprometido, una respuesta incorrecta o un archivo ZIP malformado puede consumir disco de forma desproporcionada durante la descarga o la extracción. El SHA-256 impide instalar finalmente contenido distinto, pero se verifica después de la escritura completa.
- Acción: aplicar límites de bytes mientras se descarga el ZIP y mientras se extrae cada entrada; abortar al superar el máximo esperado y limpiar el parcial en todos los errores.
- Estado: **falta de límites durante streaming y validación posterior confirmadas por código; no se descargó ni extrajo un paquete anómalo**.

### AUD-089 — dos llamadas simultáneas a `download_model` comparten archivos `.partial` y caché ZIP

- Prioridad: **P2 — carrera de descarga que puede corromper o interrumpir la instalación del modelo**.
- Evidencia:
  - `download_model()` no reserva un estado exclusivo por `model_id`; dos llamadas que pasan `is_model_downloaded()` pueden preparar la misma lista de archivos pendientes (líneas 481–493).
  - `download_file_verified()` usa un nombre parcial determinista derivado del destino (`target.with_extension(...partial)`) (líneas 370–375). Dos descargas del mismo modelo escriben al mismo `.partial` y cada una intenta verificarlo/publicarlo.
  - Para paquetes ZIP, `ensure_archive()` usa un único `zip_cache_path` basado en URL y un archivo temporal fijo `.zip.partial` (líneas 245–247 y 320–354).
  - La UI `LocalModelGate` deshabilita el botón mientras `busy`, pero esa protección es local al componente; el comando Tauri `download_model` no aplica un lock global por modelo y sigue expuesto en el registro de IPC.
- Impacto: dos solicitudes concurrentes pueden truncar/escribir el mismo archivo parcial, competir por el rename final o eliminar la caché ZIP mientras la otra todavía la utiliza. El modelo puede quedar sin instalar o la descarga puede fallar intermitentemente.
- Acción: implementar exclusión mutua/reserva en backend por `model_id`, mantener el lock hasta verificar y publicar todos los archivos y proteger el ciclo de vida de la caché compartida.
- Estado: **rutas temporales compartidas y ausencia de reserva backend confirmadas por código; no se lanzaron dos descargas concurrentes**.

### AUD-090 — los pasos de Skills se ejecutan en paralelo por temporizadores y el operador no serializa los comandos

- Prioridad: **P2 — automatizaciones de plugin con pasos fuera de orden y resultados mezclados**.
- Evidencia:
  - `PluginsCard.tsx::runCommand()` recorre `command.steps` y programa cada paso con `setTimeout(index * 600)` (líneas 113–128); no espera a que termine el paso anterior ni utiliza la promesa de `onResult`.
  - `AssistantDock.tsx` escucha `olyvia:run-command` y para cada evento inicia inmediatamente un IIFE async que ejecuta `runLocalCommand(text)` (líneas 1276–1303). No hay una cola, mutex ni comprobación de una operación de plugin ya activa.
  - `runLocalCommand()` llama a `executeOperator()` directamente (líneas 1310–1315); el puente no aplica el mismo control `busy` que sí usan algunas acciones del chat.
  - El manifiesto permite hasta 32 pasos por comando, de modo que se pueden despachar muchos trabajos en intervalos de 600 ms aunque el operador siga ocupado con los anteriores.
- Impacto: en una Skill con operaciones largas, el siguiente paso puede empezar antes de que el anterior haya guardado/cambiado la timeline. Los pasos pueden operar sobre estados distintos, competir por el proyecto y reportar respuestas en orden incorrecto; la ejecución deja de comportarse como una cadena de trabajo.
- Acción: ejecutar cada paso mediante una cola secuencial, esperar la confirmación del anterior antes de continuar y cancelar el resto si un paso falla; serializar también las invocaciones externas al puente.
- Estado: **temporizadores no coordinados y receptor async sin exclusión confirmados por código; no se ejecutó una Skill con pasos lentos en runtime**.

### AUD-091 — la corrupción de `plugins.json` reactiva todos los plugins y Skills deshabilitados

- Prioridad: **P2 — pérdida del estado de seguridad de extensiones**.
- Evidencia:
  - `plugins.rs::write_state()` serializa el mapa y escribe directamente sobre `plugins.json` con `std::fs::write()`; no crea temporal, no hace flush/sync y no publica mediante rename atómico (líneas 135–145).
  - `read_state()` convierte cualquier error de lectura, JSON inválido o contenido no-object a un mapa vacío con `unwrap_or_default()` (líneas 127–133).
  - `scan()` considera habilitado un plugin siempre que su ID no esté en el array `disabled` (`enabled: !disabled`, líneas 249–263). Con un mapa vacío, todos los plugins válidos aparecen habilitados.
  - La lista de deshabilitados es el único estado persistido por `set_plugin_enabled()`; un archivo truncado hace que ese estado se pierda.
- Impacto: una interrupción o corrupción de `plugins.json` elimina la lista de extensiones deshabilitadas. Al abrir Ajustes, plugins/Skills que el usuario había apagado pueden aparecer habilitados y sus comandos vuelven a quedar disponibles.
- Acción: guardar el estado con escritura atómica y validación; si no se puede leer, conservar un estado de error/seguro y no habilitar extensiones por defecto.
- Estado: **escritura no atómica, fallback vacío y habilitación por ausencia confirmados por código; no se dañó el archivo real**.

### AUD-092 — el instalador de la extensión sigue enlaces simbólicos y copia contenido externo dentro de la extensión del navegador

- Prioridad: **P2 — límite de confianza débil en la preparación de la extensión**.
- Evidencia:
  - `extension.rs::extension_source()` acepta la primera carpeta candidata que simplemente contiene `manifest.json` (líneas 30–66); entre las candidatas se incluye `current_dir()/extensions/editor-ia-downloader`.
  - `copy_dir()` no usa `symlink_metadata()` ni comprueba `file_type().is_symlink()` para las entradas. Usa `source_path.is_dir()`, que sigue enlaces de directorio, y `fs::copy()`, que sigue enlaces de archivo (líneas 75–95).
  - El instalador de plugins de la misma aplicación sí rechaza explícitamente enlaces simbólicos en carpetas y entradas (`plugins.rs::copy_dir()`, líneas 354–382); el instalador de la extensión no aplica esa protección.
- Impacto: si una de las rutas candidatas no confiables contiene symlinks, la preparación puede incorporar archivos que están fuera del árbol de la extensión a la carpeta que luego se carga como extensión unpacked en Chrome/Edge. La ruta `current_dir` hace que el origen pueda depender del directorio de trabajo con el que se lanzó la app.
- Acción: restringir el origen de producción a los recursos empaquetados verificados; rechazar symlinks en cada nivel y validar el árbol/manifest antes de copiarlo.
- Estado: **resolución de origen y copia que sigue enlaces confirmadas por código; no se creó un árbol con symlinks ni se cargó contenido externo en Chrome**.

### AUD-093 — al actualizar la extensión se elimina la versión funcional antes de copiar/verificar la nueva

- Prioridad: **P2 — actualización no transaccional que puede dejar la extensión incompleta**.
- Evidencia:
  - `extension.rs::prepare_extension()` comprueba si el destino existe y lo elimina con `remove_dir_all()` antes de ejecutar `copy_dir(source, destination)` (líneas 145–157).
  - `copy_dir()` copia cada entrada directamente al destino final y retorna en el primer error, sin limpiar el árbol parcial ni restaurar el destino anterior.
  - No se copia a una carpeta temporal ni se valida el nuevo `manifest.json`/árbol antes de sustituir la instalación existente.
- Impacto: un fallo de lectura, permiso, espacio en disco o interrupción durante la actualización destruye la copia anterior y deja una extensión parcial en la ruta que Chrome/Edge utiliza para «Cargar descomprimida».
- Acción: copiar a un directorio temporal independiente, validar manifest/archivos y hacer swap controlado solo al completar; si falla, conservar la versión anterior.
- Estado: **orden de borrado previo y copia no transaccional confirmados por código; no se interrumpió una actualización real**.

### AUD-094 — `screen_record_start` comprueba el estado de grabación sin reservarlo; dos llamadas pueden iniciar FFmpeg y pisarse

- Prioridad: **P1 — procesos huérfanos y posible sobrescritura de grabaciones**.
- Evidencia:
  - `screen_record_start()` comprueba `RECORDING.is_some()` dentro de un lock y libera el lock inmediatamente (líneas 24–32). La reserva real solo se hace después de preparar y lanzar FFmpeg, al final del handler (líneas 396–409).
  - Dos solicitudes concurrentes pueden superar la comprobación inicial, crear dos procesos y dos instancias `Recording`; al finalizar ambas, la segunda asignación sustituye el `Child` de la primera en el `static RECORDING`.
  - `Child` no se mata automáticamente al descartar el wrapper. El primer FFmpeg puede continuar ejecutándose y ya no habrá estado para detenerlo ni consultar su salida.
  - El destino se genera como `screen-<timestamp>.mp4` con precisión de segundos y FFmpeg recibe `-y` (líneas 135–143). Dos solicitudes que comiencen en el mismo segundo pueden apuntar además al mismo archivo.
  - `screen_record_stop()` retira el estado global con `guard.take()` antes de esperar a que FFmpeg termine (stop.rs líneas 7–10), de modo que otra llamada `start` puede pasar la comprobación mientras el proceso anterior todavía está cerrándose.
- Impacto: dos grabaciones pueden competir por el mismo MP4; uno de los procesos puede quedar huérfano, y una grabación existente puede ser truncada/sobrescrita por `-y`. La operación de stop abre una ventana adicional entre liberar el estado y cerrar el proceso.
- Acción: reservar el estado `Starting/Stopping` bajo el mismo lock antes de lanzar FFmpeg, usar nombres de salida únicos sin sobrescritura y no liberar la reserva hasta que el proceso haya terminado.
- Estado: **check-then-set, reemplazo del `Child`, timestamp de un segundo y `-y` confirmados por código; no se lanzaron dos grabaciones simultáneas**.

### AUD-095 — quemar el cursor puede borrar la grabación original si falla el rename final

- Prioridad: **P1 — pérdida de un vídeo ya grabado durante el postproceso**.
- Evidencia:
  - `screen_record_stop()` llama a `burn_cursor_overlay()` después de cerrar la grabación original.
  - `burn_cursor_overlay()` genera un MP4 temporal y, si FFmpeg termina correctamente, ejecuta `remove_file(output)` antes de `rename(tmp_path, output)` (cursor_track.rs / función incluida desde stop.rs, líneas 189–196).
  - Si `remove_file()` funciona pero `rename()` falla —por ejemplo, antivirus, permiso, bloqueo del archivo o error de disco— la función elimina también el temporal y devuelve error; el MP4 original ya fue eliminado.
  - La documentación y el mensaje de warning indican que el original queda intacto cuando falla el cursor, pero no se cumple en este caso de fallo del rename.
- Impacto: una grabación válida puede desaparecer aunque el postproceso de cursor sea la única fase que haya fallado. El usuario recibe un warning de que la grabación está bien, pero puede no quedar ningún MP4 en el destino.
- Acción: no eliminar el original antes de publicar el temporal; usar reemplazo atómico soportado por Windows o conservar una copia de respaldo hasta verificar el nuevo MP4.
- Estado: **orden remove-then-rename y limpieza del temporal confirmados por código; no se simuló un fallo de rename**.

### AUD-096 — las escenas OBS guardan las URLs RTMP completas y sus claves de transmisión en texto plano

- Prioridad: **P1 — exposición de credenciales de streaming en reposo**.
- Evidencia:
  - `ObsScene` persiste el campo `stream_url` dentro de `obs-scenes.json` (`obs_scenes.rs`, estructura `ObsScene` y función `write_scenes()`).
  - `obs_scene_save()` serializa toda la escena mediante `serde_json::to_string_pretty()` y `std::fs::write()` (líneas 73–86 y 135–158). No extrae ni cifra la clave de transmisión.
  - `screen_record_start()` documenta expresamente que la URL RTMP puede contener la clave del stream; solo evita incluirla en errores/estado de grabación. Esa protección no se aplica al archivo persistido por `obs_scene_save()`.
  - La configuración vive bajo `config_dir`, accesible como archivo local del usuario; el campo se devuelve también en `obs_scene_list()`.
- Impacto: las claves de streaming de YouTube/Twitch/otros servicios quedan legibles en `obs-scenes.json`, copias de seguridad y herramientas que inspeccionen la carpeta de configuración. Una filtración de esa carpeta puede permitir transmitir a la cuenta del usuario.
- Acción: separar endpoint y stream key; guardar la clave en Credential Manager/Keyring y persistir solo una referencia, no el secreto.
- Estado: **persistencia JSON del campo completo confirmada por código; no se leyó ni se expuso el contenido real de la configuración local**.

### AUD-097 — guardar o borrar escenas OBS en paralelo puede perder cambios y corromper `obs-scenes.json`

- Prioridad: **P2 — pérdida de escenas y archivo de configuración parcialmente escrito**.
- Evidencia:
  - `obs_scene_save()` y `obs_scene_delete()` hacen un ciclo leer → modificar → escribir, pero no protegen el ciclo completo con un mutex (líneas 135–176).
  - Dos operaciones concurrentes pueden leer la misma lista y cada una guardar su propia versión; la última escritura elimina los cambios de la otra (lost update).
  - `write_scenes()` sobrescribe directamente el archivo final mediante `std::fs::write()` y no usa temporal + rename atómico (líneas 73–86). Una interrupción durante la escritura puede dejar JSON truncado; la siguiente lectura falla con `obs-scenes.json corrupto` y bloquea listar/editar escenas.
- Impacto: al guardar/borrar escenas rápidamente o desde dos ventanas, pueden desaparecer cambios. Un cierre o fallo de disco durante la escritura puede dejar inaccesible toda la colección guardada.
- Acción: serializar lectura-modificación-escritura con un lock y usar persistencia atómica con validación antes de reemplazar el archivo.
- Estado: **ausencia de sincronización y escritura directa confirmadas por código; no se dispararon operaciones simultáneas ni se alteró el archivo real**.

### AUD-098 — el estado de una grabación RTMP puede devolver la clave de transmisión dentro del error de FFmpeg

- Prioridad: **P1 — fuga de credenciales de streaming por IPC/UI/logs**.
- Evidencia:
  - `screen_record_start()` reconoce que FFmpeg puede repetir la URL RTMP en stderr y la reemplaza por `[stream-url-oculta]` cuando el proceso muere durante los primeros 1.200 ms (start.rs líneas 322–353).
  - Para una grabación que inicia correctamente y muere después, el lector de stderr almacena las últimas 16 KB sin sanitizar en `Recording.stderr_tail` (start.rs líneas 362–385).
  - `Recording` conserva solo `streaming: bool`; no conserva la URL necesaria para redactar la clave.
  - `status_inner()` devuelve el contenido de esa cola en `ScreenRecordStatus.error` al detectar que FFmpeg murió (state.rs líneas 4–24 y 45–63).
- Impacto: si el servidor RTMP rechaza la transmisión, se corta la red o falla FFmpeg después de iniciar, el error que la app devuelve a la interfaz puede incluir la URL completa con stream key. La protección existe solo para el fallo inmediato de arranque, no para los errores durante la transmisión.
- Acción: no conservar URLs/keys en texto; redactar la clave antes de almacenar stderr y antes de devolver cualquier error/estado. Aplicar una función central de sanitización a los errores de toda la vida del proceso.
- Estado: **rama inicial con redacción y rama de estado posterior sin redacción confirmadas por código; no se inició una transmisión RTMP ni se expuso una clave real**.

### AUD-099 — un error de `try_wait()` puede hacer que la grabación pierda el control del proceso FFmpeg sin detenerlo

- Prioridad: **P2 — posible proceso de grabación huérfano**.
- Evidencia:
  - `screen_record_stop()` retira `Recording` del mutex global al comienzo (`guard.take()`, stop.rs líneas 7–10).
  - En su loop de parada, la rama `Err(error)` de `rec.child.try_wait()` devuelve el error directamente sin ejecutar `kill()` ni un `wait()` de recuperación (líneas 37–51). Al salir del closure, el `Child` queda descartado; `Drop` no mata automáticamente al proceso.
  - `status_inner()` convierte `try_wait()` en un booleano usando `matches!(..., Ok(None))` (state.rs línea 5). Cualquier error se interpreta como proceso muerto y el registro global se elimina (líneas 45–47), también sin terminar el hijo.
- Impacto: si Windows devuelve un error al consultar el estado del proceso, Olyvia deja de mostrar y controlar la grabación; FFmpeg podría continuar consumiendo recursos y escribiendo el MP4 hasta que finalice por su cuenta.
- Acción: distinguir explícitamente `Ok(Some)`, `Ok(None)` y `Err`; ante error, conservar el estado y reintentar o cancelar el proceso y confirmar su terminación antes de liberar el registro.
- Estado: **ramas de error que descartan el `Child` sin kill/wait confirmadas por código; no se provocó un fallo de `try_wait()` en runtime**.

### AUD-100 — el token del puente del navegador se guarda sin protección y los errores de persistencia se ignoran

- Prioridad: **P2 — credencial local expuesta y reconexión rota tras reiniciar**.
- Evidencia:
  - `downloader_bridge.rs::bridge_token()` guarda el token en `config_dir/downloader-bridge.token` mediante `std::fs::write()` (líneas 129–139), en texto plano y sin usar Credential Manager/Keyring.
  - El resultado de esa escritura se descarta con `let _ =`; la función devuelve el token generado aunque el archivo no se haya creado/escrito.
  - `start()` entrega el token al `BridgeRuntime`, `downloader_bridge_info()` lo expone a la interfaz para el emparejamiento y `popup.js` lo almacena de forma persistente en `chrome.storage.local` (líneas 142–145 y 158–175).
  - Si la escritura local falla por permisos, antivirus, espacio o error de disco, la app acepta el token solo en memoria; en el siguiente inicio genera otro, mientras que la extensión conserva el anterior y ya no puede autenticarse.
- Impacto: la credencial queda legible en un archivo local sin almacenamiento protegido y, ante un fallo de persistencia, la conexión se rompe silenciosamente al reiniciar. La app debería informar que no pudo persistir la credencial y no anunciar un emparejamiento estable.
- Acción: almacenar el secreto en Credential Manager/Keyring o proteger el archivo con ACL apropiadas; hacer la creación/escritura atómica y tratar cualquier error como fallo de inicialización del puente.
- Estado: **persistencia en texto plano y descarte del error confirmados por código; no se inspeccionó el valor real del token ni se alteró la configuración local**.

### AUD-101 — Flow Queue puede seleccionar un modelo aproximado distinto y marcarlo como verificado

- Prioridad: **P2 — generación con un modelo diferente del que pidió el usuario**.
- Evidencia:
  - `flow-queue/src/lib/adapter.js::findModelCandidates()` devuelve elementos cuando el texto accesible simplemente contiene el nombre buscado (`haystack.includes(wanted)`, líneas 166–173).
  - `flow-queue/src/content.js::applyModel()` intenta primero una coincidencia exacta, pero cuando no hay ninguna elige `options[0]` (líneas 157–169). No comprueba que el nombre seleccionado coincida realmente con el solicitado.
  - Tras ese clic retorna `{ verified: true, model: wanted, via: 'menu' }` aunque haya seleccionado una opción que solo contenía el texto buscado.
- Impacto: al pedir un modelo cuyo nombre es prefijo/fragmento de varias variantes —por ejemplo, familias con variantes Fast/Quality o versiones— la cola puede elegir la primera variante del selector y afirmar que usó el modelo solicitado. La generación puede consumir créditos y producir contenido con parámetros distintos.
- Acción: exigir igualdad normalizada de nombre/ID para seleccionar y verificar después del clic el modelo visible activo; si solo hay candidatos aproximados, pedir selección manual en vez de escoger el primero.
- Estado: **búsqueda por subcadena, fallback a primera opción y resultado `verified: true` confirmados por código; no se ejecutó Flow con dos variantes similares**.

### AUD-102 — Flow Queue aplica el límite de 30 MB después de cargar la imagen y lo omite por completo para respuestas `data:`

- Prioridad: **P1 — memoria sin límite efectivo al capturar imágenes generadas**.
- Evidencia:
  - `flow-queue/src/content.js::imageToDataUrl()` devuelve inmediatamente el contenido completo si `result.src.startsWith('data:')` (líneas 282–288), sin inspeccionar ni limitar su tamaño.
  - Para URLs HTTP(S), ejecuta `response.blob()` y solo después comprueba `blob.size > 30_000_000` (líneas 289–299); por tanto, el límite se aplica después de que el navegador haya cargado el cuerpo completo en memoria.
  - Una respuesta aceptada de hasta 30 MB se convierte a Base64 con `FileReader.readAsDataURL()`, aumentando el tamaño en memoria aproximadamente un tercio, además del Blob original.
- Impacto: una salida grande o una URL `data:` puede reservar memoria proporcional al tamaño entero del contenido antes de cualquier rechazo. En colas de varias generaciones puede provocar congelamiento o falta de memoria en el navegador.
- Acción: limitar el stream mientras se lee, aplicar el máximo también a `data:` antes de procesarlo y evitar mantener simultáneamente Blob y Base64 cuando se pueda usar un almacenamiento binario.
- Estado: **validación posterior a `blob()` y bypass para `data:` confirmados por código; no se envió una imagen sobredimensionada**.

### AUD-103 — Flow Queue informa referencias aceptadas aunque el evento de arrastre no haya sido procesado por Flow

- Prioridad: **P2 — prompts generados con referencias ausentes sin un error visible**.
- Evidencia:
  - `flow-queue/src/content.js::applyReferences()` intenta asignar `input.files = transfer.files` y comprueba cantidad (líneas 85–91).
  - Si esa asignación falla, construye y despacha un `DragEvent('drop')`, pero marca `assigned = true` inmediatamente después de `dispatchEvent()` (líneas 93–105). `dispatchEvent()` solo informa si el evento se despachó; no confirma que Flow haya procesado los archivos.
  - Después dispara `change` sobre el input y espera 500 ms, pero no comprueba que Flow muestre las referencias ni que el input conserve los archivos. Devuelve `{ count, names }` como éxito (líneas 108–117).
- Impacto: en una versión de Flow que no acepte ese evento sintético, la extensión dice que cargó las referencias aunque el modelo genere sin ellas. El usuario puede gastar créditos en una imagen/video que no sigue las referencias indicadas.
- Acción: verificar el estado de referencias que Flow muestra después de la operación; si no se puede confirmar, devolver advertencia/error y no continuar a generar como si se hubieran adjuntado.
- Estado: **éxito asignado únicamente por `dispatchEvent()` y ausencia de verificación posterior confirmados por código; no se probó con una cuenta de Flow**.

### AUD-104 — Web TTS puede descargar un audio anterior porque no compara la fuente antes/después de generar

- Prioridad: **P1 — resultado equivocado presentado como la nueva síntesis**.
- Evidencia:
  - `web-tts-bridge/src/tts-content.js::run()` hace clic en Generar y después llama a `adapter.waitForAudio()` (líneas 95–98).
  - `web-tts-bridge/src/lib/adapter.js::waitForAudio()` busca inmediatamente cualquier elemento `<audio>` visible o enlace con extensión de audio, y retorna el primero que encuentra (líneas 218–231).
  - No recibe ni captura una lista de fuentes/URL antes de generar, no comprueba que haya cambiado la URL, ni espera a que cambie el `src`, `currentSrc` o la fecha del resultado.
- Impacto: si la página de voz ya contiene un reproductor con una síntesis anterior, una vista previa o un audio por defecto, el primer sondeo lo devuelve inmediatamente. La extensión puede descargar ese audio y declarar que la síntesis nueva fue completada cuando en realidad no detectó el nuevo resultado.
- Acción: guardar el estado de audio antes de pulsar generar y esperar una fuente nueva/cambiada con reproducción/estado de carga completado; asociar el resultado con la operación actual.
- Estado: **ausencia de comparación temporal y retorno inmediato del primer audio visible confirmados por código; no se ejecutó sobre un sitio de TTS real**.

### AUD-105 — el límite de 25 MB de Web TTS se puede eludir mediante el fallback de descarga directa

- Prioridad: **P2 — descarga sin límite efectivo y posible consumo excesivo de disco**.
- Evidencia:
  - `tts-content.js::downloadFromUrl()` lee primero el cuerpo completo con `response.blob()` y después rechaza si `blob.size > 25 * 1024 * 1024` (líneas 39–45).
  - La excepción entra en el `catch`, que intenta inmediatamente `chrome.runtime.sendMessage({ type: 'download-tts-audio', url, filename })` (líneas 53–60).
  - `background.js` aplica `MAX_DATA_URL_CHARS` solo a `message.dataUrl`; en la rama `message.url` acepta cualquier URL HTTP(S) sin consultar `Content-Length` ni un máximo de descarga (líneas 37–56).
- Impacto: un audio mayor de 25 MB se rechaza en la ruta Blob, pero acto seguido se descarga directamente mediante Chrome, sin el mismo límite. Así, la UI puede descargar contenido mucho más grande que el máximo declarado, además de haber cargado el Blob completo antes de entrar al fallback.
- Acción: distinguir errores de tamaño de errores de CORS/red; no aplicar fallback directo a una respuesta que excedió el límite. Limitar el stream antes de leer y validar el tamaño también en la ruta del background.
- Estado: **fallback incondicional y ausencia de límite en la rama URL confirmados por código; no se descargó un audio sobredimensionado**.

### AUD-106 — Web TTS informa «descarga correcta» cuando Chrome solo aceptó iniciar la transferencia

- Prioridad: **P2 — estado de descarga falso/ambiguo**.
- Evidencia:
  - `background.js` responde `{ ok: true, downloadId }` en el callback de `chrome.downloads.download()` (líneas 58–67). Ese callback entrega el ID de la transferencia iniciada, no la confirmación de que el archivo haya terminado correctamente.
  - `tts-content.js::downloadFromUrl()` convierte esa respuesta en `status: 'success'` y mensaje «Audio generado y descargado correctamente» (líneas 46–52 y 56–64).
  - No hay suscripción a `chrome.downloads.onChanged` ni consulta a `chrome.downloads.search()` para esperar `state === 'complete'` o detectar `interrupted`.
  - `sidepanel.js` muestra el estado de éxito y habilita el acceso a Descargas basándose solo en `response.status === 'success'` (líneas 105–108).
- Impacto: una transferencia que falle después de ser aceptada —por desconexión, URL firmada vencida, error HTTP o cancelación— ya puede haberse presentado como completada.
- Acción: conservar el `downloadId`, seguir el ciclo de vida de la descarga y mostrar estados separados `iniciada`, `completada` e `interrumpida`.
- Estado: **respuesta inmediata del ID y falta de seguimiento de `downloads.onChanged` confirmadas por código; no se interrumpió una descarga real**.

### AUD-107 — detener Flow Queue no cancela la generación actual y la marca como error aunque el resultado se descargue

- Prioridad: **P2 — estado de cola incorrecto y consumo de créditos después de pulsar Detener**.
- Evidencia:
  - `QueueEngine.stop()` marca `_stopRequested`, aborta su `AbortController` y cambia el estado a `stopped` (queue.js líneas 134–151), pero no dispone de un mecanismo para interrumpir la llamada actual de `runPrompt()`.
  - `sidepanel.js` implementa `runPrompt` sin recibir/usar el `signal` del tercer argumento de `QueueEngine`; solo espera `sendToTab({ type: 'FLOWQ_RUN_PROMPT', ... })` (líneas 523–560).
  - `content.js` no recibe un mensaje de cancelación ni escucha `AbortSignal`; una vez que pulsa Generar, espera el resultado hasta el timeout configurado.
  - Cuando la promesa termina, `QueueEngine._loop()` comprueba `_stopRequested` antes de marcar el item como `done` y lo cambia a `error` (queue.js líneas 163–170), aunque `sidepanel.js::runPrompt()` ya haya descargado el archivo y guardado el registro en `state.results`.
- Impacto: pulsar Detener no detiene la generación en curso ni evita el gasto de créditos de ese prompt. Si el resultado llega, el archivo puede estar en Descargas y el manifiesto guardarlo, mientras la cola informa que ese mismo elemento falló y no incrementa `completedCount`.
- Acción: propagar una cancelación real al content script cuando Flow la permita; si Flow no soporta cancelar una generación ya iniciada, representar el estado como `deteniendo`/`terminando el prompt actual` y clasificar el resultado real sin marcarlo como error.
- Estado: **ausencia de cancelación en el content script y comprobación de stop antes de marcar done confirmadas por código; no se interrumpió una generación real**.

### AUD-108 — cerrar el panel Flow Queue detiene la cola local, pero no la generación que ya está ejecutándose en la pestaña

- Prioridad: **P2 — generación sin consumidor y resultado no exportado al cerrar el panel**.
- Evidencia:
  - `sidepanel.js::bindEvents()` solo llama a `state.queue?.stop()` en `beforeunload` (líneas 807–809); no envía un mensaje de cancelación a la pestaña ni delega la operación a un worker persistente.
  - El `sendToTab()` de la cola mantiene la espera y descarga del resultado dentro del contexto del side panel (startQueue, líneas 523–560). Es el panel quien convierte el resultado a archivo, registra el manifiesto y actualiza `chrome.storage.local`.
  - `content.js` mantiene `running` y la operación de Flow en el content script de la pestaña; no recibe un evento de unload/cancelación del side panel y puede seguir esperando la generación aunque el panel ya se haya cerrado.
  - Al cerrarse el side panel se destruye el contexto que iba a recibir el resultado y ejecutar `downloadDataUrl()`/`downloadRemoteUrl()`. No hay un job durable en `background.js` que recoja la respuesta y complete la descarga.
- Impacto: si el usuario cierra el panel durante una generación, Flow puede continuar consumiendo créditos y mostrar su resultado en la página, pero la extensión pierde el consumidor que debía guardar la imagen y registrar el resultado en la cola/manifiesto.
- Acción: mover la coordinación y persistencia de los jobs a un contexto persistente (service worker/background con estado recuperable), o impedir el cierre mientras un prompt está en curso y explicar claramente el comportamiento.
- Estado: **operación residente en content script y procesamiento/descarga dependiente del panel confirmados por código; no se cerró el panel durante una generación real**.

### AUD-109 — Flow Queue puede reutilizar el mismo `runId` y registrar nombres distintos de los archivos que Chrome guarda realmente

- Prioridad: **P2 — manifiestos que apuntan a rutas incorrectas y lotes que se mezclan**.
- Evidencia:
  - `flow-queue/src/lib/naming.js::runIdFromDate()` usa año, mes, día, hora, minuto y segundo; no incluye milisegundos ni un UUID (líneas 24–35). Dos ejecuciones que comiencen dentro del mismo segundo generan exactamente el mismo `runId`.
  - `resultFileName()` construye nombres deterministas a partir de `runId`, posición y slug del prompt (líneas 37–42). Una segunda corrida del mismo guion y mismo segundo repite las rutas.
  - `sidepanel.js::downloadDataUrl()` y `downloadRemoteUrl()` usan `chrome.downloads.download()` con `conflictAction: 'uniquify'` (líneas 619–645). Chrome puede guardar `..._1.png`, `..._2.png`, etc. cuando el nombre ya existe.
  - Ambas funciones descartan el `downloadId` devuelto; `state.results` y `manifest.js::buildManifest()` conservan el `filename` original (sidepanel.js líneas 532–558 y manifest.js líneas 28–37). No se consulta `chrome.downloads.search()` para conocer el nombre final asignado.
- Impacto: dos ejecuciones rápidas pueden compartir carpeta `flow-queue/<runId>/`; Chrome renombra archivos de la segunda, pero el manifiesto conserva el nombre sin sufijo. El manifiesto puede referenciar un archivo distinto del que realmente se descargó, y ambas corridas quedan mezcladas dentro de la misma carpeta.
- Acción: generar `runId` con UUID o timestamp de alta resolución; registrar el `filename` real consultando el objeto de descarga tras completarse, y solo entonces generar el manifiesto.
- Estado: **precisión de un segundo, nombres deterministas y `uniquify` sin recuperar filename real confirmados por código; no se lanzaron dos colas en un mismo segundo**.

### AUD-110 — la caché de preview no invalida un frame cuando el archivo multimedia cambia fuera de la aplicación

- Prioridad: **P2 — previsualización obsoleta aunque el medio de origen haya cambiado**.
- Evidencia:
  - `preview_frame/cache.rs::frame_signature()` calcula la firma con la serialización JSON del proyecto, `clip_id`, frame y flags `native/composite` (líneas 26–44).
  - La firma no incorpora el hash actual del archivo de origen, tamaño/mtime ni otra identidad de contenido del medio.
  - `render_preview_frame()` calcula esa firma y ejecuta `cache_lookup()` antes de resolver/decodificar el medio (command.rs líneas 37–47); si PNG y JSON existen, retorna el frame cacheado sin comprobar si el archivo de origen cambió.
  - Si un vídeo o imagen se reemplaza externamente conservando la misma ruta y no se actualiza el JSON/integrity del proyecto, la firma permanece igual y el preview continúa devolviendo el frame viejo.
- Impacto: el usuario puede visualizar un frame de la versión anterior de un clip mientras el render final usa el nuevo contenido en disco. El preview y la exportación pueden divergir hasta que otra edición del proyecto invalide la firma.
- Acción: incorporar identidad actual del medio (hash fiable o fingerprint por tamaño/mtime con verificación de contenido) a la firma y comprobarla antes del cache lookup.
- Estado: **firma sin identidad del archivo y cache lookup anterior a la decodificación confirmados por código; no se reemplazó un medio real para reproducirlo**.

### AUD-111 — la caché de preview limita el número de PNG, pero no el espacio total que puede consumir

- Prioridad: **P2 — crecimiento de caché sin límite real de almacenamiento**.
- Evidencia:
  - `preview_frame/cache.rs` fija `CACHE_LIMIT = 240` y `prune_cache()` conserva las 240 entradas más recientes por mtime (líneas 19–21 y 89–120).
  - La caché acepta frames nativos; `PreviewFrameResult.native` y el camino `native_input()` mantienen la resolución original del medio, no un máximo de 1080p (types.rs y decode.rs).
  - El tamaño de cada PNG puede variar ampliamente según resolución y contenido. No se comprueba `metadata().len()` para sumar bytes ni existe un límite global por directorio; la poda solo cuenta archivos.
  - La carpeta se guarda en `app_cache_dir()/preview` (preview_frame/command.rs líneas 21–35), por lo que un proyecto con muchos medios 4K/8K puede acumular cientos de PNG grandes.
- Impacto: 240 previews de resolución nativa pueden ocupar varios GB o más en la unidad de sistema, incluso si cada entrada individual es válida. La caché puede consumir el espacio de disco disponible y afectar al sistema operativo y a las exportaciones.
- Acción: limitar por tamaño total en bytes, considerar un máximo de dimensiones para cache preview y expulsar por LRU hasta quedar bajo un presupuesto de almacenamiento configurable.
- Estado: **poda basada solo en conteo y ausencia de presupuesto de bytes confirmadas por código; no se llenó la caché en runtime**.

### AUD-112 — seguimiento de objetos acumula todos los frames RGB en RAM, pese a que el contrato dice que es streaming

- Prioridad: **P1 — consumo elevado de memoria en equipos con RAM limitada**.
- Evidencia:
  - `commands/domains/media/object_track.rs::track_stream()` crea `frames: Vec<Vec<u8>>` y hace `frames.push(buffer.clone())` por cada frame decodificado (líneas 648–658).
  - El límite permite hasta `SAMPLE_FPS * MAX_TRACK_SECONDS + 8`, es decir, aproximadamente 1.088 frames a 6 fps durante 180 segundos.
  - `scaled_dims()` limita el lado mayor a 256 px, pero una secuencia cuadrada de 256×256 RGB ocupa 196.608 bytes por frame; 1.088 copias alcanzan aproximadamente 203 MiB solo para el buffer RGB, sin contar clones temporales, `to_gray()` y estructuras de análisis.
  - El comentario inicial del archivo afirma que los frames se consumen en streaming y nunca se acumulan en memoria; el código real hace exactamente lo contrario.
- Impacto: analizar clips de tres minutos puede reservar cientos de MB en RAM y degradar o agotar memoria en máquinas con 8–16 GB, especialmente mientras el editor mantiene previews, imágenes y buffers de FFmpeg.
- Acción: procesar cada frame incrementalmente dentro del tracker (mantener solo el frame previo/template y muestras acumuladas) en lugar de almacenar todas las imágenes RGB.
- Estado: **buffer acumulativo y límite de frames confirmados por código; no se ejecutó tracking de 180 segundos ni se midió RAM**.

### AUD-113 — `track_object` ejecuta FFprobe, lectura de frames y cálculo del tracker dentro del handler `async`

- Prioridad: **P1 — bloqueo del runtime durante seguimiento de objetos**.
- Evidencia:
  - `commands/domains/media/object_track.rs::track_object()` está declarado `async` (línea 85), pero llama directamente a `probe_dimensions()` (línea 108) y `track_stream()` (líneas 110–119), sin `spawn_blocking`.
  - `probe_dimensions()` usa `Command::output()` síncrono para FFprobe (líneas 186–205).
  - `track_stream()` lanza FFmpeg, lee repetidamente `stdout.read_exact()` y calcula el seguimiento completo mediante `track_frames()` antes de retornar (líneas 626–669).
  - El cálculo de correlación, escalado y búsqueda de movimiento es CPU-bound; todo termina en el worker que atiende el comando Tauri.
- Impacto: una acción de seguimiento de hasta 180 segundos puede mantener ocupado un worker Tokio durante FFprobe, la decodificación y el procesamiento CPU, retrasando otros comandos asíncronos del editor.
- Acción: trasladar el pipeline completo a `spawn_blocking` o a un worker de análisis con concurrencia limitada, y devolver progreso/cancelación por separado.
- Estado: **camino async→sync y procesamiento CPU en el hilo del handler confirmados por código; no se midió latencia en runtime**.

### AUD-114 — el resultado de seguimiento ignora el código de salida de FFmpeg y acepta secuencias parciales como completas

- Prioridad: **P2 — tracking incompleto presentado como resultado válido**.
- Evidencia:
  - `track_stream()` sale del bucle ante cualquier error de `read_exact()` (incluido EOF tras frames parciales), y después ejecuta `let _ = child.wait()` sin conservar ni comprobar el `ExitStatus` (líneas 651–662).
  - Si FFmpeg decodifica parte del clip y termina con error, la función solo comprueba que `frames` no esté vacío; pasa los frames parciales a `track_frames()` y devuelve `Ok`.
  - El frontend recibe `frames`, `confident` y muestras sin un indicador de secuencia incompleta o motivo de fallo.
- Impacto: un vídeo corrupto, truncado o interrumpido puede mostrar una trayectoria parcial como si cubriera toda la ventana solicitada. La cámara/objeto puede parecer que desaparece antes de tiempo y el usuario puede aplicar keyframes incorrectos.
- Acción: verificar `ExitStatus.success()`, distinguir EOF normal de error/lectura parcial, y devolver error o estado `partial` con cantidad/duración decodificada cuando el proceso falle.
- Estado: **status de FFmpeg descartado y aceptación de cualquier secuencia no vacía confirmados por código; no se probó un vídeo corrupto en runtime**.

### AUD-115 — el denoise de vídeo bloquea el worker async durante sondeo y toda la codificación FFmpeg

- Prioridad: **P1 — degradación del runtime mientras se reduce ruido de archivos largos**.
- Evidencia:
  - `commands/domains/media/denoise.rs::denoise_media()` es un handler `async` (línea 231), pero ejecuta `probe_media()` de forma síncrona (línea 281), luego `Command::spawn()` y finalmente `child.wait()` directamente en el mismo handler (líneas 317–364).
  - La lectura de progreso y `stderr` se delega a dos threads, pero la espera principal del proceso y la publicación del archivo siguen ejecutándose en el worker Tauri.
  - No existe `spawn_blocking` ni un supervisor de tareas para esa operación; la duración depende del vídeo y del filtro seleccionado.
- Impacto: aplicar denoise a un vídeo largo ocupa un worker async durante toda la decodificación/codificación. En paralelo con preview, importación y otras funciones puede aumentar la latencia del IPC y aparentar congelamiento del editor.
- Acción: mover el sondeo, proceso, monitorización y publicación del denoise a `spawn_blocking` o a un supervisor de jobs, con progreso/cancelación y timeout explícitos.
- Estado: **cadena síncrona desde handler async confirmada por código; no se ejecutó un denoise pesado ni se midió saturación**.

### AUD-116 — el lector de `stderr` del denoise deja de consumir después de 64 KB en lugar de seguir drenando el pipe

- Prioridad: **P2 — el proceso FFmpeg puede fallar si emite más de 64 KB de diagnóstico**.
- Evidencia:
  - `denoise_media()` configura `stderr(Stdio::piped())` (líneas 311–315).
  - El thread lector usa `BufReader::new(stderr).take(64 * 1024).read_to_string(&mut text)` (líneas 331–336). Al alcanzar 64 KB, el `Take` termina y el thread deja de leer el stream aunque el proceso continúe.
  - El proceso principal continúa esperando a FFmpeg con `child.wait()` (línea 359); el extremo lector de la tubería se descarta al terminar el thread, por lo que los mensajes posteriores ya no pueden drenarse normalmente.
  - A diferencia de una captura acotada que sigue descartando bytes, el límite actual corta la lectura del pipe completo. FFmpeg puede recibir una tubería rota al seguir escribiendo y terminar con error antes de completar el render.
- Impacto: vídeos problemáticos con numerosos warnings/errores o filtros que generan mucho diagnóstico pueden superar ese límite; el denoise puede fallar por el canal de diagnóstico, aunque la codificación principal todavía pudiera haber continuado.
- Acción: limitar únicamente el texto almacenado, pero continuar leyendo y descartando el excedente hasta EOF; alternativamente redirigir stderr a un sink acotado que siempre drene.
- Estado: **lectura `take(64 KB)` y cierre del lector al alcanzar el límite confirmados por código; no se generó stderr >64 KB para reproducir el fallo**.

### AUD-117 — la nitidez bloquea el worker async y corta la lectura de `stderr` al alcanzar 64 KB

- Prioridad: **P1 — bloqueo de IPC y fallo potencial del proceso de nitidez**.
- Evidencia:
  - `commands/domains/media/sharpen/command.rs::sharpen_media()` es `async`, pero llama a `probe_media()` síncrono, lanza FFmpeg y espera `child.wait()` en el mismo handler (líneas 43–48, 132–178 y 215–222).
  - El hilo que consume `stderr` usa `BufReader::new(stderr).take(64 * 1024).read_to_string(...)` (líneas 187–192), igual que el denoise.
  - Al alcanzar 64 KB, el hilo deja de consumir el pipe; el resto de la vida del proceso no tiene un consumidor de stderr. Los mensajes posteriores pueden provocar error de escritura/terminación del proceso antes de completar la nitidez.
- Impacto: un trabajo de nitidez sobre un vídeo largo bloquea un worker del runtime async. Si FFmpeg produce un log largo, puede fallar por dejar de drenar su pipe de error, incluso cuando el encoder todavía podía procesar el medio.
- Acción: mover todo el proceso a `spawn_blocking`/supervisor y limitar solo el texto conservado, pero continuar drenando stderr hasta EOF.
- Estado: **handler async síncrono y lectura limitada a 64 KB confirmados por código; no se midió saturación ni se generó stderr superior al límite**.

### AUD-118 — el tope de 1.800 frames del upscale de vídeo no se aplica cuando FFprobe no informa duración

- Prioridad: **P1 — procesamiento de duración ilimitada pese al máximo documentado**.
- Evidencia:
  - `upscale_video()` fija `estimated_frames = MAX_VIDEO_FRAMES` (1.800) cuando `duration_seconds` es desconocida o cero (líneas 90–98).
  - `upscale_video_blocking()` usa ese número para calcular el progreso, pero el loop de lectura (`while`/`loop` de líneas 258–300) no contiene una condición que detenga el upscale al llegar a `MAX_VIDEO_FRAMES`.
  - `-t` solo se agrega a los procesos FFmpeg cuando `max_seconds` fue proporcionado explícitamente (líneas 169–172 y 229–231). Si la duración no fue detectada y `max_seconds` es None, el decoder recibe el archivo completo.
  - Cuando termina el bucle, la función copia el resto del stdout a `sink()` (líneas 302–305) para drenar el pipe; por tanto continúa leyendo/decodificando el resto del archivo sin aumentar `written` ni actualizar el progreso.
- Impacto: un vídeo con duración desconocida evita el rechazo por encima de 1.800 frames y puede procesarse hasta el final. El progreso usa 1.800 como total y llega a 100% mientras el proceso todavía puede tardar mucho tiempo decodificando el resto, contrariando el límite de tiempo/recursos declarado.
- Acción: aplicar una condición dura `written < MAX_VIDEO_FRAMES` y cancelar/detener decoder al alcanzar el tope; si no hay duración y el usuario no fijó un máximo de segundos, rechazar el medio en vez de tratar 1.800 como mera estimación.
- Estado: **máximo usado solo en estimación y ausencia de corte en el loop confirmados por código; no se procesó un vídeo cuya duración no esté disponible**.

### AUD-119 — el upscale de vídeo fija `libx264` y no utiliza los encoders H.264 que sí contempla el resto de la aplicación

- Prioridad: **P1 — el upscale de vídeo falla con el FFmpeg LGPL empaquetado**.
- Evidencia:
  - `commands/domains/media/upscale/video.rs::upscale_video_blocking()` fija `-c:v libx264` al construir FFmpeg (líneas 224–228). No consulta el catálogo de encoders ni ejecuta fallback.
  - `commands/domains/integrations/screen_record/devices.rs::h264_software_video_args()` documenta que el bundle LGPL de la app no incluye `libx264` y que pedirlo fijo provocaba `Unknown encoder`; selecciona `h264_mf` o `libopenh264` cuando están disponibles.
  - La operación de denoise usa `sharpen::resolve_encoder()` y el render principal también tiene selección/fallback de encoder, pero el upscale de vídeo no reutiliza esos mecanismos.
- Impacto: en la distribución estándar que contiene el bundle LGPL, FFmpeg rechaza el encoder `libx264` y el upscale de vídeo falla sin procesar el vídeo. En instalaciones con un FFmpeg distinto que sí incluya x264 puede funcionar, por eso el fallo depende del binario configurado.
- Acción: resolver un encoder H.264 funcional mediante el sondeo existente y construir los argumentos compatibles con el encoder escogido; no fijar `libx264`.
- Estado: **encoder fijado y documentación interna de ausencia de x264 en el bundle confirmados por código; no se ejecutó el comando contra el FFmpeg empaquetado**.

### AUD-120 — el análisis de rostros ejecuta extracción FFmpeg e inferencia Seeta de forma síncrona dentro de un handler `async`

- Prioridad: **P1 — bloqueo de runtime durante reencuadre inteligente**.
- Evidencia:
  - `commands/domains/creator/shorts/face_track.rs::analyze_face_track()` es `async` (línea 27), pero llama directamente a `extract_face_samples()` y luego a `probe_result()` (líneas 77–86), sin `spawn_blocking`.
  - `extract_face_samples()` ejecuta FFmpeg mediante `Command::output()` para extraer frames (líneas 24–56), abre cada JPG y ejecuta `face::detect_in_image()` con el detector Seeta en serie (líneas 94–110).
  - La función hace además lectura de directorios y archivos temporales en el mismo worker del handler. La duración del rango se valida, pero eso no traslada el cómputo fuera del runtime async.
- Impacto: analizar un rango para Smart Reframe ocupa un worker mientras extrae imágenes y ejecuta hasta 30 inferencias de detección facial. Varias solicitudes concurrentes pueden retrasar IPC y otras operaciones asíncronas del editor.
- Acción: trasladar extracción, inferencia y sondeo final a `spawn_blocking`/worker de visión con límite de concurrencia.
- Estado: **cadena sync desde handler async confirmada por código; no se midió latencia ni se corrieron inferencias concurrentes**.

### AUD-121 — exportar un short ejecuta FFmpeg y espera su finalización dentro del handler `async`

- Prioridad: **P1 — bloqueo del runtime durante exportaciones de clips cortos**.
- Evidencia:
  - `commands/domains/creator/shorts/export.rs::export_short()` es una función `async` (línea 4) que construye y lanza FFmpeg directamente, luego espera `child.wait()` antes de retornar (líneas 119–191).
  - El thread auxiliar solo procesa stdout de progreso; el handler sigue esperando de forma bloqueante el proceso completo y después valida el MP4 con `probe_result()` (líneas 191–229).
  - No se encontró una llamada a `spawn_blocking` que envuelva el proceso completo.
- Impacto: exportar un short de hasta la duración máxima del módulo ocupa un worker async de Tauri mientras FFmpeg recorta, reencuadra, codifica y se valida el resultado.
- Acción: ejecutar el ciclo completo de exportación en `spawn_blocking` o job supervisor, manteniendo la comunicación de progreso y cancelación por canal.
- Estado: **handler async con `Child::wait()` síncrono confirmado por código; no se midió saturación en runtime**.

### AUD-122 — export_short espera a FFmpeg antes de leer su `stderr` y puede quedar bloqueado por una tubería llena

- Prioridad: **P1 — exportación de short potencialmente indefinida ante streams con errores repetidos**.
- Evidencia:
  - `export_short()` configura `stderr(Stdio::piped())` al lanzar FFmpeg (líneas 119–163).
  - El hilo auxiliar drena stdout/progreso, pero no se crea un lector paralelo para stderr (líneas 170–190).
  - El handler ejecuta primero `child.wait()` y solo después extrae y lee el handle `child.stderr` (líneas 191–195).
  - El comando usa `-loglevel error`; un medio dañado o un decoder que emita errores repetidos puede llenar el buffer de stderr mientras el padre espera la salida del proceso.
- Impacto: si el hijo no puede escribir más stderr porque la tubería está llena, queda esperando a que el padre lea; el padre, a su vez, espera a que termine el hijo. La exportación no llega al paso que drena la salida.
- Acción: drenar stderr en paralelo desde el inicio, conservando solo una cola acotada para mostrar al usuario; no esperar al proceso antes de leer una pipe redirigida.
- Estado: **orden wait-before-read con stderr piped confirmado por código; no se llenó la tubería en runtime**.

### AUD-123 — la validación Rust acepta tiempos fuera del máximo del esquema y puede desbordar la identidad temporal de un clip

- Prioridad: **P1 — validación que puede hacer panic o aceptar una timeline inválida**.
- Evidencia:
  - `projects/storage.rs` limita el documento a 8 MB, pero `projects/service.rs::envelope_issues()` solo comprueba que `video.frameRate.num` y `.den` sean positivos; no aplica el máximo `SafeIntegerSchema` de JavaScript ni límites de frame rate.
  - `projects/service.rs::integrity_issues()` toma `durationFrames`, `inFrame` y `outFrame` mediante `Value::as_u64()` y calcula `duration * num != window * den` sin `checked_mul` (líneas 556–571). `out.checked_sub(in_frame)` es la única operación temporal protegida.
  - El esquema compartido `packages/project-schema/src/time.ts` restringe los frames/duraciones a `TOTAL_DURATION_MAX_FRAMES = 5.184.000` y los racionales a enteros seguros de JavaScript; `projects/service.rs` no aplica esos mismos límites a los valores de clips.
  - Ejemplo de valores admitidos por el tipo JSON/Rust pero fuera del esquema: `outFrame = inFrame = 0` no aplica porque la ventana sería cero; con `outFrame = 2^63`, `inFrame = 0`, `durationFrames = 2^63`, `speed.num = 2` y `speed.den = 2`, las dos multiplicaciones `u64` desbordan y se pueden comparar como cero en compilación con wrap, aunque el proyecto excede ampliamente el máximo de 24 horas. En compilaciones con overflow checks la multiplicación puede provocar panic.
- Impacto: un `.editoria.json` externo de menos de 8 MB puede superar los límites de frames/velocidad que la interfaz declara, provocar panic durante `open_project()` o hacer que el backend acepte una identidad de timing inválida por wraparound. Otros comandos backend que vuelven a abrir ese documento heredan el estado fuera de rango.
- Acción: hacer que Rust aplique exactamente los máximos de `FrameSchema`, `DurationSchema` y `FrameRateSchema`; usar `checked_mul` en ambos lados de la igualdad y rechazar el documento si cualquier cálculo desborda.
- Estado: **ausencia de límites equivalentes y multiplicaciones `u64` sin protección confirmadas por código; no se creó ni abrió un proyecto con valores extremos**.

### AUD-124 — los previews concurrentes comparten y eliminan el mismo `monitor-frame-1.png` temporal

- Prioridad: **P2 — overlays del monitor mezclados o errores intermitentes al previsualizar**.
- Evidencia:
  - `preview_frame::render_preview_frame()` ejecuta cada petición en su propio `spawn_blocking`; no hay un lock por carpeta de caché o por frame.
  - `render_frame()` inicializa `next_input = 1` y llama a `prepare_frame_input(..., output_dir, ...)` (render.rs líneas 101–110), pasando el directorio global `app_cache_dir/preview`, no una carpeta temporal exclusiva de esa petición.
  - `render/ffmpeg/visual/monitor_frame.rs::prepare_frame_input()` construye el nombre con `temp_dir.join(format!("monitor-frame-{index}.png"))`; para el primer input siempre es `monitor-frame-1.png` y escribe allí directamente (líneas 811–814).
  - Cuando termina FFmpeg, cada petición elimina `output_dir/monitor-frame-1.png` sin comprobar si ese archivo pertenece a su propio trabajo (render.rs líneas 172–175).
- Impacto: si dos previews de clips con `monitorFrame` se ejecutan simultáneamente, ambos escriben el mismo PNG. Uno puede sobrescribir el marco que el otro está leyendo o eliminarlo mientras FFmpeg lo utiliza. El resultado puede mostrar el preset/color de otro clip o fallar de manera intermitente.
- Acción: crear un directorio temporal único por preview y pasarlo a `prepare_frame_input`; eliminar solamente los recursos de esa petición mediante un guard RAII.
- Estado: **ruta compartida, índice reiniciado en 1 y eliminación global confirmados por código; no se lanzaron dos previews concurrentes para reproducirlo**.

### AUD-125 — los PNG de preview parcialmente generados no se eliminan cuando FFmpeg devuelve error

- Prioridad: **P2 — acumulación de archivos temporales inválidos en la caché**.
- Evidencia:
  - `render_frame()` asigna un nombre único `frame-<UUID>.png` antes de ejecutar FFmpeg (render.rs líneas 135–158).
  - Si `command.output()` devuelve un `ExitStatus` no exitoso, el handler retorna `RenderFailed` (líneas 177–199), pero no elimina `output`, aunque FFmpeg haya alcanzado a crear un PNG parcial.
  - La eliminación del resultado solo se hace si `image::image_dimensions()` falla después de un status exitoso (líneas 201–207); no cubre la rama de status no-success.
  - `cache::prune_cache()` solo elimina entradas cuando supera el límite de 240 PNG; si hay menos de 240, los parciales se quedan y ocupan espacio hasta que llegue una poda posterior.
- Impacto: errores repetidos de decodificación, filtros o fuentes pueden dejar PNG inválidos/partiales en `app_cache_dir/preview`. La aplicación solo devuelve error y no vincula esos archivos a una cache entry válida, de modo que se acumulan residuos y consumen disco.
- Acción: limpiar el output en toda rama de error, preferiblemente con un guard temporal que solo se desactive después de validar dimensiones y publicar la caché.
- Estado: **retorno temprano sin `remove_file` y poda diferida por conteo confirmados por código; no se provocaron fallos de FFmpeg ni se crearon residuos reales**.

### AUD-126 — la herramienta «Mejor frame» deja tres PNG permanentes por análisis y no dispone de limpieza

- Prioridad: **P2 — crecimiento indefinido de la caché de miniaturas**.
- Evidencia:
  - `commands/domains/media/best_frame.rs::extract_frames()` copia los tres mejores PNG a `app_cache_dir()/thumbnails` con nombres `mejor-frame-<UUID>-<rank>.png` (líneas 131–142 y 185–195).
  - La función elimina su directorio temporal `.thumb-frames-<UUID>`, pero conserva los tres archivos finales para devolver sus rutas.
  - `ThumbnailView.tsx::pickBestFrames()` guarda las rutas en `bestFrames` y usa el primer PNG como `inputPath`; al elegir otra tanda hace `setBestFrames()` y al salir de la vista no existe una operación de borrado para las rutas anteriores.
  - No se encontró una poda por fecha, tamaño o cantidad para los archivos `mejor-frame-*.png` ni un comando para descartarlos al finalizar el uso. `prune_cache()` del preview usa el prefijo `frame-`, por lo que tampoco los elimina.
- Impacto: cada análisis exitoso deja hasta tres PNG adicionales, incluso cuando el usuario descarta los candidatos o repite la selección. El directorio de caché aumenta con el uso y no se recupera espacio automáticamente.
- Acción: guardarlos en un subdirectorio de trabajo temporal por sesión, limpiar los candidatos anteriores al reemplazarlos y aplicar una política de expiración/espacio a los resultados que no se hayan guardado como miniatura definitiva.
- Estado: **copias con UUID, limpieza limitada al directorio temporal y ausencia de poda de `mejor-frame-*` confirmadas por código; no se generaron archivos adicionales durante esta auditoría**.

### AUD-127 — `save_thumbnail` decodifica Base64 sin límite antes de validar tamaño y dimensiones; luego duplica el resultado al re-encodear

- Prioridad: **P1 — consumo de RAM elevado mediante IPC y congelamiento/falta de memoria**.
- Evidencia:
  - `commands/domains/media/thumbnail.rs::decode_data_url()` extrae el payload y ejecuta `STANDARD.decode(payload)` sin comprobar longitud ni tamaño máximo antes de reservar el `Vec<u8>` (líneas 36–53).
  - `save_thumbnail()` recibe el `dataUrl` completo como `String`, decodifica todo el Base64 y llama a `image::load_from_memory(&bytes)` antes de verificar dimensiones (líneas 108–120).
  - La dependencia resuelta es `image 0.25.10`. Su `Limits::default()` permite hasta 512 MiB de asignaciones del decodificador y no fija máximos de ancho/alto; el límite de 16.384 px de Olyvia se verifica después de que `load_from_memory()` ya haya decodificado la imagen.
  - Luego `write_to()` re-encodea la imagen a un nuevo `Vec<u8>` PNG completo mientras siguen vivos el `String` Base64, el `Vec<u8>` decodificado y `DynamicImage` (líneas 122–132).
  - La interfaz normal genera canvas de 1080–1920 px, pero el comando `save_thumbnail` está expuesto por IPC y no limita el tamaño del `dataUrl` ni verifica que provenga del canvas esperado.
- Impacto: una solicitud IPC con Base64 grande puede cargar cientos de MB antes del primer control; la decodificación puede consumir hasta el límite interno de 512 MiB y el re-encode añade otro buffer completo. En equipos con memoria limitada puede congelar Olyvia o provocar falta de memoria, aunque la imagen termine rechazándose por dimensiones.
- Acción: rechazar el `dataUrl` por longitud máxima antes de decodificar, verificar dimensiones desde un `ImageReader` con `Limits` explícitos y estrictos antes de asignar el raster, y evitar mantener a la vez todos los buffers cuando se publica el PNG.
- Estado: **payload sin máximo, validación de dimensiones posterior al decode y segundo buffer PNG confirmados por código; no se invocó el comando con una imagen sobredimensionada**.

### AUD-128 — varios exportadores calculan nombres únicos con `exists()` pero no reservan el destino antes de `rename()`

- Prioridad: **P2 — exportaciones simultáneas con el mismo nombre se rechazan o colisionan**.
- Evidencia:
  - `infrastructure/media.rs::LocalTimelineExportFiles::publish()` itera mientras `path.exists()`, crea un temporal UUID y más tarde ejecuta `rename(temp, path)`; el chequeo y la publicación no son atómicos (líneas 119–138). Afecta exportaciones EDL, OTIO y FCPXML.
  - `commands/domains/media/thumbnail.rs::save_thumbnail()` usa `unique_path()` con `exists()` antes de escribir el temporal y hace el `rename()` después (líneas 86–94 y 133–155).
  - `commands/domains/media/color_lut.rs::export_look_lut()` también selecciona el nombre mediante `while path.exists()` y luego renombra el temporal (líneas 91–117).
  - `commands/domains/audio/lip_sync.rs` y `commands/domains/creator/shorts/export.rs` repiten el patrón para sus vídeos de salida; `dubbing::unique_output()` calcula el nombre final antes de la codificación.
  - No hay lock por carpeta/nombre ni reserva atómica mediante `create_new`/`rename_noreplace`; las funciones tampoco reintentan otro sufijo cuando el rename falla por colisión.
- Impacto: dos exportaciones concurrentes con la misma carpeta y basename pueden observar el mismo destino libre. En Windows, una publicación puede completarse y la otra fallar al renombrar porque el destino ya existe; el segundo trabajo devuelve error aunque habría podido usar `-2`. En plataformas donde `rename` reemplaza destinos, el resultado puede sustituir al primero.
- Acción: reservar el nombre de forma atómica antes de escribir o publicar usando una primitiva no-replace; ante colisión, elegir otro sufijo y reintentar.
- Estado: **chequeo no atómico repetido en varios exportadores y ausencia de reintento confirmados por código; no se ejecutaron dos exportaciones con el mismo basename**.

### AUD-129 — merge/trim/watermark/metadata y extracción de subtítulos bloquean workers async durante FFmpeg/FFprobe

- Prioridad: **P1 — bloqueo del runtime durante herramientas de material**.
- Evidencia:
  - `media_tools.rs` declara `merge_videos()`, `trim_video()`, `watermark_video()`, `set_metadata()` y `extract_subtitles()` como `async`.
  - Las cuatro herramientas de vídeo llaman a `run_ffmpeg()`, que ejecuta `Command::output()` síncrono (líneas 118–149). No se usa `spawn_blocking` para la operación completa.
  - `extract_subtitles()` ejecuta `probe.output()` para FFprobe y `command.output()` para FFmpeg directamente en el handler (líneas 573–642).
  - No se limita la concurrencia de esos trabajos ni se separa el cómputo de la decodificación del worker que atiende IPC.
- Impacto: unir, recortar, marcar, modificar metadatos o extraer subtítulos puede ocupar un worker Tokio durante la operación completa. Varios trabajos simultáneos pueden retrasar otras llamadas Tauri, render y audio.
- Acción: trasladar cada flujo de FFmpeg/FFprobe a `spawn_blocking` o supervisor común, sin bloquear workers async y con límite global de procesos.
- Estado: **handlers async con procesos síncronos confirmados por código; no se midió saturación en runtime**.

### AUD-130 — `merge_videos` falla si cualquiera de los vídeos no tiene pista de audio

- Prioridad: **P1 — la función de unión rechaza vídeos mudos aunque sí sean vídeos válidos**.
- Evidencia:
  - `merge_videos()` crea para cada input la secuencia de filtros `[index:v:0][index:a:0]` (líneas 209–218). La referencia a audio es obligatoria y no usa el selector opcional `a?`.
  - Después concatena esos pares con `concat=n=...:v=1:a=1` y siempre mapea `[outa]` (líneas 218–224).
  - No hay sondeo previo que detecte entradas sin audio ni generación de una pista silenciosa de reemplazo.
  - Un vídeo grabado desde una cámara, animación o exportación sin audio puede ser `ready` y resolver correctamente como `kind == video`, pero FFmpeg no encuentra `0:a:0` para ese input.
- Impacto: basta con que uno de los vídeos seleccionados no tenga audio para que la unión falle con un error de stream specifier/concat. La herramienta no puede concatenar clips visuales mudos, aunque la UI solo pide «unir videos».
- Acción: sondear las pistas por input y normalizar el audio (por ejemplo, insertar `anullsrc` cuando falte), o construir un grafo concat que admita entradas sin audio.
- Estado: **mapeo obligatorio `[i:a:0]` y ausencia de tratamiento para vídeo sin audio confirmados por código; no se ejecutó una unión de vídeos mudos**.

### AUD-131 — las herramientas de medios escriben FFmpeg directamente sobre el nombre final y conservan salidas parciales cuando el proceso falla

- Prioridad: **P2 — archivos MP4 incompletos que quedan como resultados aparentes**.
- Evidencia:
  - `merge_videos()`, `trim_video()`, `watermark_video()` y `set_metadata()` calculan `final_path`, añaden `-y` y entregan esa ruta directamente a FFmpeg (por ejemplo, líneas 240–243, 317–319, 392–415 y 481–484). No se usa un archivo temporal de publicación.
  - `run_ffmpeg()` devuelve error si `output.status.success()` es falso, pero no elimina el archivo de destino (líneas 133–148).
  - El helper `finish()` que elimina archivos vacíos solo se llama después de un FFmpeg exitoso; si el proceso escribió bytes y luego falló, el partial queda en la carpeta elegida y la función ya ha retornado error.
- Impacto: al producir errores de codec, espacio, decodificación o cancelación externa, el usuario puede encontrar un `union.mp4`, `recorte.mp4`, `marca-de-agua.mp4` o `con-metadatos.<ext>` incompleto junto a los resultados válidos. La siguiente ejecución crea un nombre alternativo y no retira el parcial anterior.
- Acción: codificar a un nombre temporal único en la misma carpeta, validar/probar el resultado y publicarlo con rename solo al completar; eliminar temporales en todos los caminos de error.
- Estado: **destino final directo, `-y` y retorno temprano sin limpieza confirmados por código; no se provocó una salida FFmpeg fallida**.

### AUD-133 — `audio_peaks` acepta una forma de onda parcial si FFmpeg falla después de producir al menos un bucket

- Prioridad: **P2 — waveform incompleta presentada sin advertencia**.
- Evidencia:
  - `commands/domains/audio/audio.rs::decode_peaks()` espera el proceso y conserva su `ExitStatus` (líneas 232–234).
  - Solo devuelve error por status no-success cuando `peaks.is_empty()` (líneas 235–240). Si FFmpeg emitió uno o más buckets y luego falla, devuelve `Ok(peaks)` con el resultado parcial.
  - `audio_peaks()` y `audio_peaks_path()` devuelven ese vector sin un campo `partial`/`complete`; los consumidores dibujan los buckets como si cubrieran todo el archivo.
- Impacto: archivos corruptos, truncados, filtros fallidos o decodificación interrumpida pueden mostrar una onda que termina antes del final, sin señal de error. El usuario puede interpretar erróneamente que el resto del audio es silencio o que el medio tiene menor duración.
- Acción: propagar error para cualquier `ExitStatus` no exitoso, o devolver un estado parcial explícito con cantidad de muestras/duración decodificada y advertencia visible.
- Estado: **condición que acepta cualquier vector no vacío aun con status fallido confirmada por código; no se procesó un archivo de audio corrupto**.

### AUD-134 — `extract_subtitles` convierte errores de JSON/lectura en «el vídeo no tiene subtítulos»

- Prioridad: **P2 — errores de extracción ocultos como ausencia de subtítulos**.
- Evidencia:
  - Después de comprobar que FFprobe terminó con status exitoso, el handler parsea stdout con `serde_json::from_slice(...).unwrap_or_else(|_| json!({}))` (media_tools.rs líneas 596–601). Un JSON inválido se convierte en objeto vacío y retorna `Ok(None)`.
  - Tras extraer el SRT y verificar que su tamaño no supera 4 MB, hace `std::fs::read_to_string(&temp).unwrap_or_default()` (líneas 655–669). Si falla la lectura o el archivo no es UTF-8 válido, lo convierte en cadena vacía y retorna `Ok(None)`.
  - `Ok(None)` es también el resultado legítimo cuando el vídeo no contiene pistas o la pista SRT está vacía; la interfaz no puede distinguir los tres casos.
- Impacto: un error de FFprobe, SRT ilegible, encoding inesperado o problema de disco puede mostrarse como «no hay subtítulos incrustados». El usuario puede abandonar la transcripción o buscar subtítulos externos sin saber que falló la extracción.
- Acción: propagar los errores de JSON y lectura como `ProjectError`, reservando `Ok(None)` exclusivamente para una respuesta válida sin streams o sin contenido.
- Estado: **fallbacks a objeto vacío/cadena vacía y retorno `None` confirmados por código; no se provocó un fallo de lectura ni un JSON inválido**.

### AUD-135 — la cola por carpeta asigna un SHA-256 de 64 ceros en vez de calcular la huella real del medio

- Prioridad: **P1 — integridad falsa, colisión de caché y recuperación de medios bloqueada**.
- Evidencia:
  - `state/folder-queue.ts::buildProject()` crea cada asset con `integrity.sha256 = '0'.repeat(64)` (línea 102); el flujo ya recibió `copied.relativePath` y `probe.bytes`, pero nunca calcula el hash del archivo.
  - `hooks/waveform-cache.ts::waveformCacheKey()` usa `asset.integrity.sha256` como base de la clave persistente cuando el campo existe; solo usa URL/ruta cuando el hash está ausente (líneas 35–44).
  - `useWaveform.ts` utiliza esa clave para leer y guardar picos en memoria/localStorage (líneas 203–215). Por tanto, todos los vídeos creados por la cola con el mismo número de buckets comparten una única clave de caché compuesta por 64 ceros, independientemente del contenido.
  - `infrastructure/projects_recovery.rs::relink_asset_in_project()` trata cualquier SHA-256 declarado de 64 caracteres como huella válida y exige que el archivo elegido coincida exactamente (líneas 225–230 y 265–275). La huella de ceros hace que los medios reales no pasen la reconexión aunque sean el archivo correcto.
  - El mismo valor se expone en manifiestos de entrega y auditorías de integridad como si fuera un SHA-256 real.
- Impacto: distintas formas de onda pueden compartir los picos de otro vídeo; el proyecto afirma una integridad que nunca calculó; y, si se pierde/reubica el medio, la recuperación por hash rechaza el archivo verdadero. La cola genera proyectos que no son recuperables correctamente mediante el flujo de reconexión.
- Acción: calcular SHA-256 del archivo copiado antes de construir el asset; si no es posible, omitir `integrity` en lugar de inventar una huella sintácticamente válida.
- Estado: **SHA constante y consumidores de caché/relink que confían en el valor confirmados por código; no se ejecutó una cola de carpeta ni se alteró una waveform existente**.

### AUD-136 — la cola por carpeta colisiona proyectos y exportaciones cuando dos vídeos comparten basename

- Prioridad: **P1 — el proyecto de una entrega puede apuntar a otro vídeo y el MP4 queda desincronizado**.
- Evidencia:
  - `folder-queue.ts::slug()` elimina la última extensión del nombre antes de normalizarlo (líneas 65–75). Así, `escena.mov` y `escena.mp4` producen el mismo `stem = "escena"`; también pueden colisionar nombres diferentes después de normalizar acentos/caracteres y truncar a 60 caracteres.
  - `processFile()` escribe el proyecto con `${stem}.editoria.json` (líneas 180–184) y el vídeo de salida con `${stem}.mp4` (líneas 185–189).
  - El proceso es secuencial, pero `write_project_file()` no crea un nombre único ni rechaza un destino preexistente; `projects::save_project()` publica por `storage::write_project_file()` mediante temporal + `rename`, que reemplaza el archivo de proyecto existente.
  - `render_project_variant()` sí rechaza el MP4 si ya existe antes del render (variants.rs líneas 317–321). Por tanto, al procesar el segundo vídeo con el mismo `stem`, el JSON del primero puede ser sustituido por el proyecto del segundo, mientras que la exportación `escena.mp4` ya corresponde al primero y la segunda entrega termina en error AlreadyExists.
- Impacto: una misma carpeta puede terminar con `escena.editoria.json` apuntando al segundo medio y `escena.mp4` conteniendo el render del primero. El segundo elemento aparece como fallido aunque haya reemplazado el proyecto, dejando una pareja de archivos incoherente.
- Acción: generar un identificador de entrega único a partir del nombre + extensión/hash, y reservar de forma exclusiva tanto el JSON como el MP4 antes de comenzar a copiar o renderizar.
- Estado: **normalización sin extensión, destinos derivados del mismo stem y política distinta de reemplazo/rechazo entre JSON y MP4 confirmadas por código; no se procesó un folder con basenames duplicados**.

### AUD-137 — el relink copia el archivo al proyecto antes de validar el SHA-256 y deja la copia huérfana cuando la huella no coincide

- Prioridad: **P2 — residuos de medios copiados aunque la recuperación haya fallado**.
- Evidencia:
  - `projects_recovery.rs::relink_asset_in_project()` llama a `place_inside_project()` antes de calcular/verificar la huella declarada (líneas 261–269).
  - Si el nuevo archivo está fuera del root, `place_inside_project()` ejecuta `copy_into_project()`, que publica directamente en `media/relink/` con un nombre único (líneas 161–181 y 184–197).
  - Después, si SHA-256 no coincide, la función devuelve `RelinkResult::failed()` (líneas 269–275), pero no elimina la copia recién creada ni restaura el estado de la carpeta.
  - El documento no cambia porque `set_asset_path()` ocurre después de la comprobación; sin embargo, el archivo copiado sí permanece en el proyecto sin referencia.
- Impacto: cada intento de reconexión con un archivo incorrecto, dañado o distinto del hash esperado deja un duplicado completo en `media/relink/`, aun cuando la interfaz muestra que la operación fue rechazada. Los intentos repetidos consumen disco.
- Acción: calcular y comparar SHA-256 sobre el origen antes de copiar; alternativamente, si se verifica después de copiar, borrar el destino recién creado en la rama de mismatch/error.
- Estado: **orden copiar→validar y retorno fallido sin limpieza confirmados por código; no se intentó relinkear un archivo real incorrecto**.

### AUD-138 — la carpeta de variantes reutiliza un archivo existente solo porque su tamaño coincide, sin comparar su contenido

- Prioridad: **P1 — una variante puede renderizar con el medio equivocado sin detectar la colisión**.
- Evidencia:
  - `commands/domains/projects/variants.rs::mirror_assets()` resuelve cada asset por su ruta relativa y comprueba si `destination.exists()` (líneas 132–145).
  - Cuando el destino existe, solo compara `metadata(source).len()` con `metadata(destination).len()`; si los tamaños coinciden, continúa sin calcular SHA-256 ni comparar contenido.
  - El comentario de la función dice que los archivos existentes deben coincidir en tamaño para evitar mezclar assets distintos, pero dos vídeos/imágenes diferentes pueden tener exactamente el mismo número de bytes.
  - El proyecto JSON de la variante mantiene la ruta relativa original, por lo que renderizará el archivo que ya estaba en la carpeta de variantes, aunque su contenido no sea el del proyecto de origen.
- Impacto: al crear variantes desde proyectos distintos que usan nombres relativos iguales —por ejemplo `media/clip.mp4`— y medios de igual tamaño, la segunda variante puede renderizar silenciosamente el clip de la primera. No se detecta que el contenido sea distinto.
- Acción: comparar hashes SHA-256 de origen y destino cuando un archivo ya existe; si no coinciden, rechazar con un error explícito o asignar un nombre/ruta única y actualizar el proyecto.
- Estado: **reutilización basada exclusivamente en tamaño confirmada por código; no se creó una carpeta de variantes con dos clips de igual tamaño y contenido distinto**.

### AUD-139 — `write_project_variant` y `mirror_assets` no revierten medios ya copiados cuando un asset posterior falla

- Prioridad: **P2 — carpetas de variantes incompletas que ocupan disco tras un error**.
- Evidencia:
  - `write_project_variant()` crea la carpeta de destino y ejecuta `mirror_assets(...)?` antes de escribir el JSON final (variants.rs líneas 179–205).
  - `mirror_assets()` copia cada asset individual directamente a su destino con `fs::copy()` y aumenta `copied`; si un asset posterior no existe, no puede prepararse la carpeta, la ruta escapa o los tamaños no coinciden, retorna error inmediatamente (líneas 102–153).
  - No conserva la lista de archivos creados para borrarlos al fallar ni copia a un directorio staging que se publique al completar.
  - El proyecto `.editoria.json` se escribe solo después de terminar todas las copias, por lo que el error deja archivos en `media/` sin un proyecto de variante que los referencie.
- Impacto: variantes con varios medios pueden dejar copias huérfanas cuando un archivo posterior falta o choca. Reintentar el proceso vuelve a recorrerlos y puede acabar encontrando esos residuos como destinos existentes, lo que hace más difícil recuperar una carpeta de variantes limpia.
- Acción: espejar todos los assets en un staging temporal y publicar el proyecto/carpeta solo al terminar; si falla, eliminar únicamente los archivos creados por esa operación.
- Estado: **copias directas por iteración, retorno temprano y ausencia de rollback confirmados por código; no se provocó un fallo en medio de la copia de una variante**.
