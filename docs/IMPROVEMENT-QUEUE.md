# Cola de mejora continua — Olyvia

Actualizado: 2026-10-28. Un ítem por vuelta. Ningún ítem se marca `done`
sin un test o una medición real. No se toca trabajo del usuario ni se
reconstruye el instalador salvo que el ítem lo pida.

## Estado verificado en código (2026-10-28 18:49, última vuelta)

- **Frontend**: `npm run typecheck` verde; suite raíz **1361/1361 en 166
  archivos**; suite de escritorio **961/961 en 140**.
- **Rust**: **450 passed + 47 ignored**, incluidos 7 tests de licencia/prueba.
- **Instalador Fase 4 (no instalado)**: **222.329.952 B**, SHA-256
  `9D3EDD323160F2A97893774C4DA2BDF0879844DB80D2D3765F08C50F76FAE3A1`,
  Authenticode **Valid** con certificado autofirmado. Ejecutable de release
  **37.078.528 B**, SHA-256
  `3DEB7E45DA982F0420E7264B3CEA470CBFBCC994BF75164F1E921312644EACBC`
  (sin firmar en `target`).
- **Sigue instalada la build anterior**: instalador **275.462.336 B**, exe
  **103.720.928 B**, PID **28496**. No se reemplazó para no cerrar la sesión
  abierta.
- **Sin** commit ni push.

## Lote velocidad (2026-10-28)

- `[done]` **Compresión x265 `faster`** — medición sintética 1080p/5 s con el
  FFmpeg empaquetado: `medium` 4,75 s · `fast` 4,35 s · **`faster` 3,41 s**
  (≈28 % menos tiempo), con tamaño final casi igual; el CRF sigue mandando.
- `[done]` **Arranque percibido** — piso del splash de **900 → 450 ms**.
- `[done]` **Precarga** — de 8 vistas a 4 (Inicio, Editor, Medios, Descargar);
  las herramientas se cargan al abrirlas.
- `[done]` **Laboratorio** — la conversión/comprisión por software también pasó
  de `medium` a `faster`; el camino de hardware AMF/NVENC/QSV ya existía en el
  Laboratorio.
- `[verified]` **Memoria** — build de release actual con **37,6–39,8 MB** de
  working set tras abrir, frente a 43,1 MB de la build anterior.
- `[pending]` Compresión por GPU AMF/NVENC/QSV, AV1 con SVT-AV1 (el FFmpeg
  actual no trae libsvtav1), carga diferida del catálogo de emojis (771 kB +
  7,25 MB de fuente), y separación del playhead para reducir re-render del
  editor.
- **Verificación**: Rust 450 + 47, frontend 1361/166. La build de release se
  recompiló con `custom-protocol`; el instalador no se regeneró en este lote.

## Lote Fase 4 · trial y paquete comercial (2026-10-28)

- `[done]` **Trial 14 días** cifrado y ligado a la máquina, con activación
  única, vencimiento a Free y tests.
- `[done]` **Modal de activación** con prueba, archivo firmado y estado del
  plan; la tarjeta muestra Pro/Prueba/Free y días restantes.
- `[done]` **Instalador NSIS firmado** generado; hashes y ejecutable en el
  estado verificado. Sin instalación sobre la build en uso.
- `[blocked]` **Clave Lemon Squeezy/Gumroad**: falta product ID y endpoint; el
  modal lo declara, no se finge la verificación.
- `[blocked]` **SmartScreen**: certificado autofirmado; hace falta OV/EV y
  reputación para evitar advertencias.
- `[blocked]` **Auto-updater**: sin endpoint/manifiesto firmado; el motor
  yt-dlp sí se actualiza cada 7 días.
- `[blocked]` **MSI**: sólo NSIS; el target WiX no está configurado.
- **Verificación**: typecheck, 1361/166, 961/140, Rust 450 + 47, auditoría de
  licencias OK. Detalle en [PHASE-4-COMMERCIAL.md](PHASE-4-COMMERCIAL.md).

## Lote Fase 3 · licencias Free/Pro (2026-10-28)

- `[done]` **LicenseState en Rust** — tier Free por defecto, archivo firmado
  Ed25519, copia local AES-256-GCM ligada a la máquina, activación y
  desactivación. La clave privada vive fuera del repo.
- `[done]` **Descarga gateada** — Free: 2 simultáneas, 1080p, MP4/H.264, sin
  SponsorBlock automático, sin upscale 4K. Pro: 512, 4K/8K, HEVC/AV1/HDR.
- `[done]` **Export gateado en Rust** — Free hasta 1080p H.264; H.265/4K y
  variantes de Fábrica requieren Pro.
- `[done]` **UI de licencia** — Ajustes → Licencia con estado, email, ID,
  activación por archivo y desactivación; bloqueos ProLock en Director y
  Fábrica; aviso y perfiles bloqueados en ExportDialog.
- `[done]` **Compatibilidad** — un proyecto se abre y edita igual en Free; sólo
  el export de perfiles Pro pide licencia.
- **Verificación**: Rust **449 + 47 ignored**, frontend **1361/1361 en 166**,
  escritorio **961/961 en 140**, licencia de desarrollo firmada y verificada.
  Sin build ni instalación. Detalle en [PHASE-3-LICENSING.md](PHASE-3-LICENSING.md).
- **Pendiente**: endpoint Lemon Squeezy/Gumroad, trial 14 días y emisión real
  de licencias en Fase 4.

## Lote Fase 2 · golden path y estabilidad (2026-10-28)

- `[done]` **Descarga → Auto-edit**: botón “Auto-editar” después de importar,
  con test de integración hasta el Editor automático.
- `[done]` **Short 9:16**: test de Creador que genera hook, exporta sólo
  vertical y quema subtítulos.
- `[verified]` **Fábrica**: núcleo de variantes y errores por lote cubiertos;
  falta la corrida UI con imágenes reales (documentado).
- `[done]` **Límites**: default 6, rango normal 1–8, 512 detrás de “Avanzado”
  con clamp y ayuda; tests de cola y UI.
- `[done]` **ViewErrorBoundary**: una vista que falla ya no deja la ventana en
  blanco; recuperación con reintento, Inicio y Ajustes; tests 2/2.
- `[verified]` **Recuperación**: detección automática de instantánea y
  restauración con un clic; no se auto-abre para no pisar una sesión nueva.
- `[done]` **Licencias**: `npm run audit:licenses` OK; Wav2Lip/checkpoints
  fuera del bundle; avisos de terceros agregados. eSpeak NG GPL-3.0 queda como
  blocker legal de venta.
- **Verificación**: typecheck verde; raíz **1356/1356 en 165**, escritorio
  **956/956 en 139**, revisión visual del límite 6/Avanzado. Sin build ni
  instalación. Detalle en [PHASE-2-GOLDEN-PATH.md](PHASE-2-GOLDEN-PATH.md).

## Lote Fase 1 · navegación y hubs (2026-10-28)

- `[done]` **Rail de 9 superficies** — Inicio, Descargar, Creador, Proyectos,
  Editor, Laboratorio, Producción, Aprender y Ajustes. Las herramientas
  avanzadas quedan detrás de **Más** (Guion, Medios, Texto, Multicámara,
  Mezcla, VFX, Director, Automático, Motion, Efectos).
- `[done]` **Tres workspaces** — Ingesta / Creador / Studio; la píldora sigue
  la vista activa, cada una navega a su landing y la migración `ai`→`studio`
  conserva la preferencia. El rail global no desaparece al cambiar de espacio.
- `[done]` **Hubs con tabs y estado preservado** — Descargar (Descargar/
  YouTube/Cumplimiento), Creador (Crear/Fábrica/Miniaturas/Localización) y
  Laboratorio (Convertir/Comprimir/Denoise/Upscale/Comparar/Fondo). Las
  pestañas visitadas se mantienen montadas: cambiar de tab no pierde una cola
  ni un formulario.
- `[done]` **Editor con modos internos** — Texto, Multicámara, Mezcla, VFX,
  Motion y Efectos como tabs del editor; la timeline sigue visible debajo.
- `[done]` **IA transversal** — AI Hub y MCP salen del rail; se abren desde
  Ajustes → Inteligencia artificial y desde el asistente global (Ctrl+K/dock).
- `[done]` **Salida a Studio** — después de importar una descarga aparece
  “Abrir en Studio”.
- **Verificación**: typecheck raíz verde, suite raíz **1352/1352 en 164**,
  escritorio **952/952 en 138**, revisión visual de Ingesta, Creador,
  Laboratorio, Ajustes IA y popover Más a 1280×720. Sin build ni instalación.
- `[done]` **Fase 1B · rutas canónicas** — `view-routing.ts` redirige YouTube/
  Cumplimiento a Descargar; Fábrica/Miniaturas/Localización a Creador;
  Convertir/Comprimir/Denoise/Upscale/Comparar/Fondo a Laboratorio; Texto/
  Multicámara/Mezcla/VFX/Motion/Efectos al tab del Editor. Se retiraron las
  rutas standalone duplicadas de `App.tsx`; deep links y paleta pasan por la
  misma normalización. Los hubs y el editor inicializan en el tab/modo pedido,
  con request id para navegaciones repetidas.

## Lote interfaz comercial 60-30-10 (2026-10-28)

- `[done]` **Paleta exacta y capa final** — `appearance.ts` fija el preset
  `olyvia` en `#0F1115` / `#181B20` / `#2D3240` / `#1F5EFF` / `#22C55E` /
  `#FF6B2B` / `#F2F5FF` / `#9CA3AF`, con radios 8–10 px y glow cobalto. La
  nueva `commercial.css` entra última y anula los degradados de las capas
  previas sin tocar los presets de otros temas.
- `[done]` **Workspaces en la topbar** — primera pasada con Descargas /
  Creador / Editor Studio / AI Hub. La Fase 1 la reemplazó por Ingesta /
  Creador / Studio y un rail global de 9 superficies.
- `[done]` **Barra de URL** — borde cobalto con transición de 0,2 s al foco o
  con URL normalizada válida, más glow medido.
- `[done]` **Ruido reducido** — instrucciones de la extensión, límites del
  motor y “cómo funciona” pasan a `InfoTip` accesibles (rol `note`,
  `data-tooltip` y foco por teclado). El aviso sin proyecto queda en una línea.
- `[done]` **Acordeones** — Programación/repetición, historial y los bloques de
  red/automatización quedan cerrados; sólo Destino y Presets rápidos abren por
  defecto. El historial resume registros sin inventar tamaños.
- `[done]` **Cola consolidada** — un solo pie sticky con estado, pendientes,
  total, progreso promedio y expansión; el detalle de la cola oculta sus
  controles hasta abrirlo. El pie distingue trabajos activos, en espera,
  completados y con error (color y texto), y ya no muestra “Cola lista” ante
  fallos.
- `[done]` **Verificación** — typecheck del workspace verde; suite raíz
  **1335/1335 en 161 archivos**; suite de escritorio **935/935 en 135**; 4
  tests nuevos de espacios de trabajo, 5 de shell y 1 de cola consolidada.
- `[done]` **Instalador construido y firmado** — `Olyvia_0.1.0_x64-setup.exe`
  queda listo en `target/release/bundle/nsis`; no se instaló para no cerrar la
  sesión abierta. Ver el estado verificado al inicio de este archivo para
  tamaño, SHA-256, firma y la build que sigue instalada.

## Lote cierre III del descargador (2026-10-28)

- `[done]` **Hasta 512 simultáneas** en la UI.
- `[done]` **Actualización automática de yt-dlp** cada 7 días, con interruptor
  persistido y reintento en el próximo arranque si falla.
- `[done]` **Playlist hasta 500** por lectura; backend admite 1.000.
- `[done]` **Aviso de carátula en WebM**: el contenedor no admite adjunto; se
  escriben metadatos y se advierte.
- `[done]` Verificación final: typecheck, raíz 1325/1325, Rust 443/443, firma y
  assets instalados.
- Límites de arquitectura que no se fuerzan desde el repo: servicio headless
  separado (el vigilante es tarea de Windows), torrent/P2P, cola en la nube y
  Dolby Vision. Tampoco se puede inventar un checksum que el servidor no
  publica.

## Lote cierre II del descargador (2026-10-28)

- `[done]` **128 simultáneas** en la UI.
- `[done]` **Traducción a varios destinos**: idioma principal + checkboxes de
  los otros siete; traduce todas las pistas a cada idioma y el burn-in usa el
  principal.
- `[done]` **Playlist hasta 200** entradas por lectura (backend acepta 500).
- `[done]` **Selector real de pista de audio**: `list_audio_tracks` lee los
  formatos de yt-dlp, la UI permite elegir `format_id` y la descarga usa
  `bv*+id` o el audio elegido.
- `[done]` **Días permitidos** además de la ventana horaria (Lun–Dom).
- `[done]` **Mute WebM** con `libopus`; verificado en MP4 y WebM con volumen
  antes/dentro/fuera del tramo.
- `[done]` **Notificación nativa verificada** con `--test-notification`: el
  plugin devolvió `ok` y el proceso arrancó oculto.
- Límites que quedan por diseño: el vigilante sigue siendo una tarea de
  Windows, no un servicio headless; no hay torrent/P2P ni cola en la nube; el
  checksum de fuente depende de que el servidor lo publique; Dolby Vision no
  está soportado.

## Lote cierre de brechas del descargador (2026-10-28)

- `[done]` **Hasta 64 simultáneas**: subió el tope de la UI; el backend no
  impone un límite.
- `[done]` **SponsorBlock mute**: `sponsorblockMute` consulta la API y silencia
  sólo el audio de los tramos, copiando el video. Live: antes >−40 dB, tramo
  muteado <−60 dB y fuera del tramo intacto.
- `[done]` **Checksum de la fuente**: `probe_source_checksum` lee
  `Content-MD5`, `Digest`, `X-Checksum-Sha256` y `x-goog-hash`; la UI llena el
  SHA-256 esperado. Prueba con base64 conocido.
- `[done]` **Hashes en historial**: los archivos del historial conservan MD5 y
  SHA-256 en el JSON exportado.
- `[done]` **Todos los subtítulos**: traduce cada pista en lotes de 80 y guarda
  un SRT por pista; el burn-in usa la primera traducida.
- `[done]` **Costo remoto**: interruptor explícito que pasa `approvedCost`.
- `[done]` **Carpeta vigilada recursiva** hasta 3 niveles y **filtros RSS** de
  incluir/excluir palabras, persistidos.
- `[done]` **Salud de proxies periódica** cada 10 minutos; el failover por
  reintento ya existía.
- `[done]` **Ventana horaria**: `windowStart`/`windowEnd` con cruce de
  medianoche; el planificador espera a la próxima apertura. Pruebas unitarias.
- `[done]` **Playlist real**: `list_playlist_entries` usa yt-dlp flat-playlist,
  la UI muestra hasta 50 títulos y checkboxes, y arma `playlistItems`.
- `[done]` **Idioma de audio**: `audioLanguage` acepta `es`, `en`, `pt-BR` o
  `all`; se pasa como `-S lang:` o `--audio-multistreams`.
- `[done]` **Metadatos y carátula**: título/artista/comentario y cover embebido
  (mjpeg attached_pic) en video/audio; live verificado con ffprobe.
- `[done]` **Vigilante de Windows**: `install_watchdog` crea tareas ONLOGON y
  cada 5 min; `--background` arranca oculto con mutex de instancia única. No es
  un servicio aparte.
- `[done]` **Probar notificación** desde Descargas.
- Límites: la traducción/burn-in sigue usando un idioma de destino por trabajo;
  el vigilante depende del Programador de tareas y «Salir» lo desactiva; el
  idioma de audio es una preferencia de yt-dlp, no una garantía del sitio; el
  toast no se verificó visualmente.

## Lote descargas paralelas y automatizaciones (2026-10-28)

- `[done]` **Descargas simultáneas**: se eliminó el lock global; cada trabajo
  registra su propio `DownloadControl` y la UI arranca hasta **32** a la vez
  (valor persistido, editable en “Simultáneas”). Pausa, reanudación y
  cancelación usan el `runId` del trabajo. Prueba UI: dos trabajos quedan
  `running` antes de resolver ninguno.
- `[done]` **Progreso por trabajo**: `download-progress` lleva `runId`; la cola
  muestra mensaje/porcentaje de cada trabajo. El historial guarda duración y
  velocidad media.
- `[done]` **Bandeja y segundo plano**: icono con “Mostrar Olyvia” y “Salir de
  Olyvia”; cerrar la ventana la oculta y deja la cola viva. Verificado con
  `WM_CLOSE` real: proceso vivo y ventana oculta.
- `[done]` **Notificaciones**: `tauri-plugin-notification` + comando
  `notify_user`; la UI avisa al completar o fallar con interruptor “Notificar”.
- `[done]` **Carpeta vigilada**: `scan_watch_folder` lee hasta 50 `.txt` de
  1 MB, extrae URLs http(s) y revisa cada 60 s; recuerda archivo+mtime.
- `[done]` **RSS/Atom**: `fetch_rss_feed` valida URL, limita 2 MB/100 entradas,
  parsea RSS y Atom; feeds persistidos y revisados cada 5 min. Prueba real
  contra `hnrss.org`.
- `[done]` **Repetición**: cada hora/día/semana clona el trabajo al completarse
  y calcula la próxima hora sin quedar en el pasado.
- `[done]` **Salud y failover de proxies**: `test_proxy` mide latencia;
  “Conservar los que responden” limpia la lista y un reintento rota al
  siguiente proxy.
- `[done]` **Checksums completos**: `hashFiles` calcula MD5+SHA-256 en streaming
  para todos los archivos; `expectedSha256` falla si ninguno coincide. Prueba
  con digests conocidos de “abc”.
- `[done]` **Traducción y burn-in**: traduce SRT en lotes de 80 con el proveedor
  de Localización, guarda el SRT traducido, lo adjunta y opcionalmente quema
  los subtítulos con FFmpeg.
- `[done]` **SponsorBlock por acción**: además de quitar,
  `--sponsorblock-mark` marca categorías como capítulo; la UI impide marcar lo
  que ya se quita.
- `[done]` **HDR AV1**: conservar HDR acepta H.265 o AV1 10-bit; H.264 se
  rechaza. Verificado con HLG→AV1 `yuv420p10le` y `arib-std-b67`.
- `[done]` **Plantilla de nombres y playlist**: tokens `{title}`, `{id}`,
  `{platform}`, `{height}`, `{date}`, rechazo de rutas/`..`, y rangos
  (`1-10`, `1,3,5`, `2:8`).
- `[done]` **4K largo**: 12 s 3840×2160 → HEVC, duración y dimensiones
  verificadas; 25,15 s incluyendo la fuente.
- Límites honestos: no hay daemon separado del WebView (la bandeja mantiene el
  proceso; un cierre forzado lo termina); la traducción usa el proveedor
  configurado y no autoriza costos remotos; “mute” de SponsorBlock no existe en
  yt-dlp (sí quitar y marcar); el SHA-256 esperado lo aporta la persona porque
  los sitios no publican uno; el máximo de concurrencia de la UI es 32.

## Lote accesibilidad del menubar (2026-10-28)

- `[done]` **Menubar operable con teclado (H13/3b)**: los títulos usan roving
  tabindex (sólo uno queda en el orden de Tab) y responden a ←/→ (abren el
  hermano con el foco en su primer ítem, o sólo mueven el foco si no hay menú
  abierto), ↓/↑ abren con el primer/último ítem, Home/End van al primer/último
  menú y Enter/Espacio abren el menú enfocado.
- `[done]` **Foco y propagación**: Escape cierra el desplegable, devuelve el
  foco al disparador y corta la propagación para que el atajo global de Escape
  no deseleccione el clip; Tab cierra el menú y deja el foco en el
  disparador; al activar un ítem con Enter/Espacio el foco vuelve al
  disparador. Si el menú abierto no tiene
  ningún ítem habilitado (Editar sin proyecto), el foco vuelve al disparador
  en vez de caer en `<body>`.
- `[done]` **Estado anunciado**: los ítems con tilde pasan a
  `role="menuitemcheckbox"` con `aria-checked` real («Etiquetas del rail»,
  «Barra de estado» y las vistas del menú Ver).
- `[done]` **Trampa corregida**: el `ref` compartido del desplegable quedaba en
  `null` al cambiar de menú porque React desmonta el anterior después de montar
  el siguiente; la búsqueda de ítems ahora usa un query acotado a la raíz del
  menubar.
- `[done]` **Pruebas**: `MenuBar.test.tsx` **8/8** (6 nuevas: roving tabindex,
  ↓/↑, ←/→ con fallback, Escape con foco y sin propagación, `aria-checked`);
  App + App.teclado + paleta **63/63**; suite completa **1321/1321 en 160
  archivos** en 53,89 s; `npm run typecheck` verde; `npm run build` verde en
  8,33 s (main 368,60 kB, gzip 103,16; los chunks del split no cambian).
- Límite honesto: no se tocó `ProfileMenu` (H14/3c) ni la paleta (H12/3a);
  siguen pendientes como ítems propios. El resto del ítem 10 quedó partido: el
  contraste de las guías de curvas sigue por debajo de 3:1 (medido en el ítem
  10b) y las etiquetas de paneo ya estaban completas (10c).
- Próximo candidato: **10b** (contraste de guías de curvas), con los ratios ya
  medidos.

## Lote descargador completo III (2026-10-28)

- `[done]` **HDR correcto**: `probe_color` ahora distingue PQ (`smpte2084`) de
  HLG (`arib-std-b67`). Conservar HDR mantiene la transferencia real y
  10-bit; el tonemap se aplica a PQ y HLG. Conservar con AV1/H.264 se rechaza
  con un error explícito y la UI fuerza H.265. El look cinematográfico también
  tonemapea fuentes HDR antes del LUT/grano.
- `[done]` **Tamaño objetivo honesto**: el cálculo usa MB decimales (igual que
  la UI), rechaza objetivos por debajo de 120 kbps de video con el mínimo
  sugerido, y ya no se envía para MKV/WebM/audio ni acepta decimales.
- `[done]` **Capítulos**: `creator_split_chapters` corta cada capítulo en un
  MP4 independiente con `-map_chapters -1`, valida el máximo de 80 y conserva
  nombres seguros. Verificado en vivo con dos capítulos: duración total 6 s.
- `[done]` **Burn-in**: `creator_burn_subtitles` incrusta SRT/VTT con Segoe UI,
  contorno negro y margen móvil; rechaza texto vacío o >5 MB. Verificado con
  FFmpeg real y audio conservado.
- `[done]` **Programación**: la cola persiste `scheduledFor`, espera la hora
  exacta con un temporizador y ofrece “Ahora” para adelantar. Cubierto por
  pruebas de persistencia y de UI (no descarga antes de tiempo).
- `[done]` **Rotación de proxies**: se pega uno por línea; cada trabajo toma
  el siguiente proxy de la lista y los reintentos conservan el suyo.
- `[done]` **SponsorBlock preview**: comando Rust que valida el ID de YouTube y
  consulta `sponsor.ajay.app` sin descargar; la UI lista categoría, rango y
  acción antes de decidir. Pruebas unitarias de extracción de ID y parseo.
- `[done]` **UI Creador**: seis módulos con tarjetas de capítulos y subtítulos,
  botones deshabilitados sin carpeta de salida y resultados unificados.
- `[done]` **Build verde**: la prueba de Motion esperaba el Inspector diferido
  con `getByLabelText` síncrono; ahora usa `findByLabelText` con 10 s. Era una
  carrera de carga, no un fallo de producto.
- `[done]` **Instalación**: NSIS firmado instalado con `/S` (exit 0), exe
  **93.554.656 B** SHA `88D9E4E9…A407CC`, firma válida, PID **21296**.
  `main-DDjGL1hx.js` referencia `DownloadView-BZUOuKzM.js` y
  `CreatorView-DHFgvVkc.js`; ambos nombres y los comandos nuevos están en el
  binario instalado. No se pudo grepear texto de UI porque los assets van
  comprimidos dentro del exe; se verificó por nombre de asset y pruebas.
- Límites honestos de esta vuelta: **no** hay descargas paralelas (sigue el
  lock de un trabajo), ni bandeja/daemon, ni notificaciones de Windows, ni
  carpeta vigilada/RSS, ni verificación de checksum contra una fuente externa.
  La traducción de subtítulos ya existía en Localización y no se duplicó.

## Lote partir EditorWorkspace (2026-10-28)

- `[done]` **Shell mínimo**: `EditorWorkspace` pasó de **999,83 kB (gzip
  192,78)** a **53,62 kB (gzip 18,25)** — −946,21 kB (−94,6 %), −174,53 kB
  gzip (−90,5 %) — con `React.lazy` + `Suspense` por panel. El shell conserva
  Preview y Transport; Inspector, Timeline, EditorAssets y ExportDialog viven
  en chunks propios.
- `[done]` **Chunks medidos** (`vite build` 6,12 s): Inspector **138,90 kB
  (37,40 gzip)**, Timeline **40,13 (12,15)**, EditorAssets **25,35 (7,57)**,
  EmojiPicker **719,71 (113,13)** y ExportDialog **24,73 (8,17)**. El primer
  grupo se pide al montar el editor; el diálogo de exportación recién se
  importa al abrirlo y se desmonta al cerrarlo (sólo se puede cerrar sin un
  render en curso).
- `[done]` **Acoplamiento roto**: `COLOR_LOOKS` salió de `Inspector.tsx` a
  `editor/color-looks.ts`; el rail lo importaba y arrastraba el Inspector
  completo al shell. También se retiró el export desde Inspector, que era el
  único consumidor externo.
- `[done]` **Fallbacks honestos**: reservas mudas con el punto de carga
  existente y `aria-busy`, conservando los landmarks (`asset-rail`,
  `inspector` con “Detalles”) y el ancho de cada columna; no se anuncia una
  espera ni se inventa contenido. CSS nuevo: `.panel-loading`.
- `[done]` **Pruebas**: typecheck verde; dirigidas **100/100 en 10 archivos**
  (App, App.teclado, ExportDialog, EditorAssets, Timeline, EmojiPicker ×2,
  Motion, Lottie, ProjectHome); suite desktop **908/908 en 134 archivos**;
  suite raíz **1310/1310 en 160 archivos** en 53,94 s. Los helpers
  `createProject`/`abrirEditor` ahora esperan `.timeline-surface` antes de
  leer clips.
- Límite honesto: el editor sigue pidiendo Inspector, Timeline, EditorAssets
  y EmojiPicker al montarse, así que el total inicial ronda **977,71 kB
  (188,62 gzip)**, similar al anterior; la ganancia real es que el shell y la
  preview se evalúan primero y que ExportDialog (24,73 kB) quedó diferido de
  verdad. El catálogo de emoji (719,71 kB min / 113,13 gzip, escapado ASCII)
  sigue cargándose al montar: diferirlo a la apertura del picker es el ítem 17,
  que quedó desbloqueado por este split. No se midió tiempo de arranque en la
  app Tauri; sólo tamaño de chunks y tests.

## Lote descargador avanzado II (2026-10-28)

- `[done]` **Tamaño objetivo**: `targetSizeMb` calcula el bitrate de video
  desde la duración y el audio de 160 kbps, reemplaza al CRF y se verifica en
  vivo: un clip de 4 s con objetivo 1 MB quedó por debajo de 1,6 MB.
- `[done]` **Conservar original**: `keepOriginal` deja en Descargas tanto el
  archivo descargado como el procesado (cine o compresión); el test live
  confirma que el input sigue en disco.
- `[done]` **Cookies del navegador**: selector Chrome/Edge/Firefox/Brave/
  Chromium/Opera/Vivaldi; yt-dlp usa `--cookies-from-browser` en probe y
  descarga, sin guardar secretos en el proyecto. Si hay cookies.txt, tiene
  prioridad.
- `[done]` **Espacio y estimación**: comando `download_disk_space`, indicador
  de espacio libre, tamaño de salida estimado (objetivo, cine o compresión) y
  tiempo estimado según el límite de bajada o 8 MB/s.
- `[done]` **Velocidad FFmpeg**: `-progress` ahora adjunta `speed=` al
  porcentaje; yt-dlp ya mostraba velocidad/ETA en su línea de progreso.
- `[done]` **Cola más resistente**: reencola sola los trabajos `running` al
  abrir, reintento automático hasta 2 veces con 2 s/4 s (no reintenta errores
  permanentes), reordenar subir/bajar, pausar/reanudar/cancelar todo, omitir
  URLs ya completadas y estadísticas/exportación JSON del historial.
- `[done]` **Puente con Creador**: desde el resultado de Descargas se abre
  Creador con el video ya cargado (sessionStorage).
- `[done]` **Pruebas**: target size live 1/1 en 0,97 s; cookies browser
  1/1; suite Rust **423/423 + 47 ignored**; frontend **1306/1306 en 160
  archivos** en 199,40 s; typecheck verde.
- Límite honesto: el tamaño objetivo es aproximado (contenedor/audio pueden
  desviarlo); las cookies dependen de que yt-dlp pueda leer el navegador y de
  que esté cerrado si la base está bloqueada; el reintento automático es de
  2 intentos; sigue sin HDR/10-bit/AV1, traducción o burn-in de subtítulos,
  split por capítulos, programador/carpeta vigilada, proxy pool/rotación,
  notificaciones del sistema ni daemon fuera de la app.

## Lote módulos de creador (2026-10-28)

- `[done]` **Módulo Hook**: `creator_inject_hook` divide los primeros 3 s,
  aplica `zoompan` progresivo (2–25 %), quema un ASS centrado con fade y mezcla
  un whoosh sintetizado con `anoisesrc`/`highpass`/`afade`. El resto del video
  se concatena sin tocar el audio; si el video dura menos de 3 s se hace zoom
  sobre todo. Salida H.264 CRF 20.
- `[done]` **Multi-formato concurrente**: `creator_export_multi_aspect` usa
  `tokio::task::JoinSet` y `spawn_blocking` para 9:16 1080×1920, 16:9
  1920×1080 y 1:1 1080×1080. Vertical/cuadrado usan fondo escalado + blur y
  foreground `decrease` centrado; horizontal recorta al centro. Audio se copia
  y sólo se reencodea si el contenedor lo rechaza; un FFmpeg por variante, sin
  intermedios.
- `[done]` **CTA con QR offline**: `creator_inject_cta` calcula los últimos
  3–5 s, quema un banner ASS inferior y, si se pide, rasteriza un QR con
  `qrcodegen` + `image` y lo superpone abajo-derecha con `enable=between(t,…)`.
  Sin red ni servicios externos.
- `[done]` **B-roll activo**: `creator_interleave_broll` escanea una carpeta,
  planifica cuts cada N segundos (1–3 s cada uno, máximo 20), reemplaza el
  video del tramo con el clip de apoyo escalado/recortado y conserva el audio
  principal continuo. Grafo en archivo con `-/filter_complex` para evitar el
  límite de Windows. Test live verifica que el frame del cut sea rojo.
- `[done]` **UI Creador**: nueva vista con selector de video/carpeta, cuatro
  tarjetas, resultados con “Ver archivo” y navegación en el rail.
- `[done]` **Pruebas**: 6 unitarias (ASS, plan de cuts, filtros, QR, Hook,
  B-roll) + live `creator_tools_live_optional` 1/1 en 7,32 s con hook, CTA/QR,
  tres variantes y B-roll; suite Rust **421/421 + 47 ignored**; frontend
  **1306/1306 en 160 archivos** en 153,74 s; typecheck verde.
- Límite honesto: el whoosh es ruido filtrado sintetizado, no un SFX
  descargado; el QR no lleva logo; el B-roll reencoda el video completo (no
  stream-copy por los cortes); no hay detección semántica de momentos, sólo
  intervalo fijo; los paths de entrada se validan como archivos existentes,
  no contra el root de un proyecto.

## Lote cola, entrega al proyecto y autoedición rápida (2026-10-28)

- `[done]` **Cola persistente**: trabajos en `localStorage` (`queue.ts`) con
  `runId` estable. Al reabrir, un trabajo `running` pasa a `paused`; al
  reanudar se reutiliza la misma carpeta y yt-dlp continúa los `.part`.
  Worker secuencial en la UI, lote de URLs (una por línea) y límite de un
  proceso pesado a la vez con `try_lock` en Rust, compartido por UI y bridge.
- `[done]` **Pausa/reanudación/cancelación reales**: registro global del
  child; en Windows `NtSuspendProcess`/`NtResumeProcess` suspenden y reanudan
  yt-dlp/FFmpeg; cancelar usa `TerminateProcess`, limpia la carpeta temporal
  y el cierre de la app cancela el trabajo activo. No hay pausa entre
  procesos si no hay child: el flag espera antes del siguiente paso.
- `[done]` **Progreso FFmpeg**: `-progress pipe:1` + `out_time_us` calcula
  porcentaje real en `process_video` y `compress_video`; el test 4K exige al
  menos una lectura >0 además de dimensiones/códec.
- `[done]` **Historial y reintento**: últimos 12 trabajos con estado, archivos
  y solicitud completa; “Reintentar” reencola con el mismo `runId` para
  aprovechar parciales. “Ver archivo” usa `revealOutput`.
- `[done]` **Pre-recorte y entrega**: `trimStart`/`trimEnd` pasan a
  `--download-sections`; los videos se insertan en el timeline, el SRT se
  convierte en cues (sin solapamientos), los capítulos en marcadores y la
  miniatura se importa a Medios y se registra como `x-coverAssetId` para la
  portada de proyectos recientes. Todo en **una sola mutación** porque
  `store.mutate` usa el snapshot del último render y dos llamadas en el mismo
  tick se pisaban.
- `[done]` **Red/utilidades**: idiomas de subtítulos libres, 8 categorías de
  SponsorBlock seleccionables, chequeo de espacio libre antes de descargar y
  botón “Actualizar motor” (`yt-dlp -U`) con invalidación del estado.
- `[done]` **Audio original en cortos**: el enrutador ya no sintetiza Piper
  automáticamente; conserva la pista original y aplica mastering transparente
  (`highpass 55`, `lowpass 18k`, compresor suave, `loudnorm −14`), sin cambiar
  velocidad ni tono. No se implementó evasión de detección de re-subida.
- `[done]` **Autoedición más rápida**: `analyze_media` corre escenas,
  detectores y una única pasada de audio (`silencedetect+ebur128+astats`) en
  paralelo, omite luma/saturación para Automático (`includeSamples=false`) y
  persiste el análisis en `cache_dir/analysis`. Medición real en clip 10 s
  640×360: **legacy 922,9 ms → Automático 169,5 ms (−81,6 %)** y Director
  408,6 ms (−55,7 %).
- `[done]` **4K real**: encode 3840×2160 HEVC de 1 s/60 fps por la ruta larga
  con Lanczos en **3,85 s** en CPU; dimensiones y códec verificados.
- `[done]` **Pruebas**: suite frontend **1304/1304 en 159 archivos** en
  194,76 s; downloader Rust **41/41 + 1 ignored** (live 32,81 s con YMAX
  242→88, 4K y audio master); intelligence 7/7 con benchmark. Typecheck
  verde.
- Límite honesto: la cola vive en `localStorage`, no en un servicio en
  segundo plano; tras cerrar la app hay que reanudarla desde la UI. La pausa
  suspende el proceso activo, no un trabajo que aún no arrancó. La portada usa
  el namespace `x-coverAssetId`, no un campo tipado del esquema. El 4K medido
  es 1 s sintético; no se probó un video largo 4K. La integración de SRT
  descarta cues solapados y no traduce el idioma del SRT al proyecto.

## Lote paneo animado de pista en export (2026-10-27)

- `[done]` **Medición real MP4 vs preview**:
  `render_live_5s_animated_track_pan_astats_matches_preview` renderiza 5 s a
  24 fps con `panKeyframes` (meseta −0,8, tramo Bézier `.42,0,.58,1`, meseta
  +0,36) y mide L/R con `astats` sobre ventanas de 0,4 s:
  **R−L −13,99 dB** contra **−13,98 dB** de la preview (Δ 0,01 dB) y
  **+3,88 dB** contra **+3,88 dB** (Δ 0,00 dB). El test 1/1 en 1,12 s.
  Segunda corrida junto al test live anterior: 2/2 en 1,71 s.
- `[done]` **Por qué mesetas**: el priming de AAC (~21 ms) corría la ventana
  sobre un barrido continuo y desviaba 0,85 dB; las mesetas con `hold` miden
  la ley sin ese sesgo. El tramo central conserva la Bézier y el golden del
  port de Rust (`cubicBezierProgress(48/59, .42,0,.58,1) = 0,929319`).
- `[done]` **Bug real encontrado y corregido**: con el paneo animado la línea
  de comandos del render llegaba a **35.271 caracteres** y `Command::spawn`
  fallaba en Windows (límite 32.767, mensaje "no se pudo iniciar ffmpeg").
  El grafo largo ahora se escribe en `filter-graph.txt` del temp del render y
  FFmpeg lo lee con `-/filter_complex` (FFmpeg 9.0.1/9.0.2; el antiguo
  `-filter_complex_script` ya no existe). Los grafos ≤8.000 caracteres siguen
  inline, así que los renders cortos no cambian. El test verifica que el plan
  usa el archivo y que los args totales quedan bajo 8.000.
- `[done]` **Hallazgo lateral corregido**: `perspective_filter` indexaba
  `perspective["interpolation"]` sobre un `Map` y paniqueaba cuando el campo
  opcional faltaba (`no entry found for key`). Se cambió a `.get(...)`; el
  test de perspectiva volvió a verde y la suite Rust quedó 412/412 al cierre.
- `[done]` **Test unitario del grafo**: el test
  `long_filter_graphs_use_a_file_and_short_ones_stay_inline` construye el plan
  sin FFmpeg, verifica que el grafo >8.000 va a `filter-graph.txt`, que los
  args quedan bajo 8.000 y que un proyecto corto sigue inline. 1/1 en 0,34 s.
- `[done]` **Preview sin cambios**: los tests de paneo por playhead siguen
  17/17; el ítem sólo agregó la verificación del MP4 y el arreglo del grafo.
- Límite honesto: el grafo leído de archivo requiere FFmpeg 9+ (la app
  empaqueta 9.0.2; uno externo anterior fallaría igual que antes por límite
  de línea). No se probó en GPU ni con proyectos de muchos clips; el umbral
  de 8.000 caracteres deja margen amplio pero no es una cota formal.

## Lote delogo + Lanczos + HEVC (2026-10-27)

- `[done]` **Delogo proporcional**: `delogo_rect` lee las dimensiones reales
  con FFprobe y calcula un parche 140×50 con margen 20 a 1080p, escalado al
  canvas y con recorte para no salir del cuadro. FFmpeg 9.0 **no** acepta
  `main_w` dentro de `x`/`y` de `delogo` (probado: `Undefined constant`), así
  que las coordenadas se resuelven en Rust y el filtro recibe enteros.
  Esquinas: superior/inferior × izquierda/derecha. El parche va antes del zoom
  del 4 %, que limpia residuos del margen.
- `[done]` **Lanczos automático**: si el origen queda por debajo del objetivo,
  `scale=…:flags=lanczos` + `pad` preserva la relación de aspecto; cortos a
  1920×1080 (vertical 1080×1920) y largos a 3840×2160 (vertical 2160×3840).
  Nunca reduce un origen mayor. El zoom 4 % usa dimensiones explícitas para
  que el archivo final sea exactamente el objetivo, sin los 2 px que perdía el
  redondeo par anterior. En la ruta larga se mantiene `hqdn3d` cuando hay
  upscaling; se siguen omitiendo flujo óptico y grano.
- `[done]` **H.265 forzado**: el perfil CPU pasó de `libx264` a `libx265`
  ultrafast CRF 23 (24 con RAM ≤9 GB); el look manual usa `libx265 fast`
  CRF 22. NVENC usa `p3`/CQ 23/`-tune ll`; AMF `speed`/CQP 23; QSV
  `fast`/QP 23. Todos agregan `tag hvc1`. Si sólo hay H.264 por hardware se
  prefiere x265 CPU: el asset final siempre es HEVC.
- `[done]` **Hashes dobles**: todo video postprocesado devuelve MD5 y SHA-256;
  la UI muestra ambos con tooltip y los conserva al mover a Descargas.
- `[done]` **UI**: checkbox de logo + selector de esquina, checkbox de Lanczos
  (encendido por defecto dentro del look) + objetivo Auto/1080/2160, con aviso
  de costo de 4K en largos.
- `[done]` **Pruebas reales**: `delogo_and_lanczos_live_optional` midió el
  YMAX de la zona del logo **242 → 88**, salida exacta **1920×1080**, códec
  **hevc**, MD5 32 hex y SHA-256 64 hex, en 31,23 s.
  `cinematic_render_live_optional` pasó en 5,63 s con look completo, pipeline,
  ruta larga, Piper y watermark; 34/35 tests de `commands::downloader` verdes
  (1 ignored de red). Typecheck verde y suite final **1299/1299 en 157
  archivos** en 186,70 s.
- Límite honesto: el delogo es estático y por esquina; no detecta ni sigue un
  logo, y si no hay marca difumina contenido real. `scale_cuda` no se usa
  porque el resto de la cadena es CPU; se documenta el equivalente con
  `hwupload/hwdownload` pero no se simula. El 4K en largos puede tardar mucho.
- `[done]` **Instalado** (lote delogo + Lanczos + HEVC): instalador
  **256.175.368 B**, SHA-256
  `9CC185B1AA222C5D4CD6712613835ABF611F861BB61763987FBC9985DF4F77DF`,
  firma Authenticode válida; ejecutable instalado **77.885.920 B**, SHA-256
  `804062473235A29852A5752701E8BED74F2BEE1527ACB5DA4689858E6001B579`,
  PID **25000** respondiendo. El binario instalado contiene el asset
  `main-5wWzMphb.js`, que referencia `DownloadView-DYF0AvxY.js`, además de
  `piper/es_voice.onnx` (63.201.294 B) y `watermark.png` (3.174 B).

## Lote actualizador honesto (2026-10-27)

- `[done]` **Fuera la release ficticia**: se eliminó `updater-service.ts`, que
  devolvía una 0.2.0 hardcodeada, simulaba 800 ms de red y una descarga con
  progreso y velocidad aleatorios. El modal ya no ofrece canales
  Estable/Beta, checkbox de auto-chequeo, botón de descarga ni estado
  "descargado y verificado": nada de eso existía.
- `[done]` **Estado real**: la ventana "Actualizaciones de Olyvia" muestra la
  versión instalada y el aviso "Sin canal de actualizaciones configurado",
  con los dos datos pendientes: firma local autofirmada sin sello de tiempo y
  endpoint de releases sin definir. El lanzador ya no muestra el chip
  "Actualización" en cada arranque.
- `[done]` **Versión única**: `CURRENT_APP_VERSION` vive en
  `apps/desktop/src/app/version.ts`; el lanzador, el modal y el panel Acerca
  de del menú lo leen de ahí. `version.test.ts` compara el valor con
  `apps/desktop/package.json` y `tauri.conf.json` para que no se despegue.
- `[done]` **Pruebas**: modal 4/4 (estado honesto, sin controles ficticios,
  foco inicial/Escape y trampa de Tab), versión 1/1, StartScreen 8/8,
  MenuBar 2/2. E2E nuevo `e2e/updater.spec.ts` en Chrome real: 1/1 en 1,6 min;
  verifica que el diálogo entre en el viewport, que no haya CTA de descarga y
  que Escape devuelva el foco al botón de versión.
- `[done]` **Verificación**: `npm run typecheck` verde; suite completa
  **1299/1299 en 157 archivos** en 175,11 s; `npm run build` verde en 7,46 s
  (`EditorWorkspace` 999,78 kB). Sin cambios en Rust, sin commit/push ni
  rebuild del instalador.
- Límite honesto: el ítem sigue `[partial]` porque la decisión de fondo
  (certificado de firma con sello de tiempo y endpoint de manifiesto) es del
  usuario. Hasta entonces no hay comprobación real ni descarga: la ventana
  informa el estado en vez de simular una actualización.

## Lote pipeline adaptativo del descargador (2026-10-27)

- `[done]` **Perfil por hardware real**: `pipeline_profile::detect` consulta
  los encoders con FFmpeg y elige NVENC (`hevc_nvenc`, preset p4, CQ 24,
  `-tune ll`, decodificación `cuda`), AMF (`hevc_amf`, balanced, CQP 24),
  QSV (`hevc_qsv`, medium, QP 24) o CPU (`libx264 ultrafast`, CRF 23; CRF 24
  con RAM ≤9 GB). La decisión se toma una vez por descarga y el perfil elegido
  se informa en las advertencias del resultado. En esta máquina el probe real
  no encontró encoder de hardware utilizable, así que el camino verificado es
  CPU; el resto queda cubierto por la selección de args y no se probó en GPU.
- `[done]` **Árbol de decisión estático** (`AutoRouteDecision`): ≤60 s y sin
  título musical → look completo de 60 fps por flujo óptico + voz Piper
  automática; >60 s → ruta rápida `fps=60`, espejo y zoom 4 % **sin**
  `minterpolate` ni grano, con audio 1,02× y ruido rosa a −50 dB; título con
  música/song/lyrics/cover/música/canción → conserva la pista original sin
  velocidad ni ruido, aunque sea largo. Si la duración llega vacía, el
  enrutador la resuelve con FFprobe después de descargar y recién entonces
  decide voz/audio.
- `[done]` **UI de red y utilidades**: checkbox de enrutamiento automático con
  vista previa de la ruta, campo de proxy HTTP/SOCKS con validación, límite
  global de bajada (`500K`, `8M`), subtítulos es/en a SRT, miniatura JPG,
  capítulos embebidos y SponsorBlock. Los campos viajan al backend; el
  frontend bloquea la descarga si el proxy o el límite tienen formato inválido.
- `[done]` **Pruebas**: 5 unitarias del mapeo de ruta en el frontend, 4 del
  árbol en Rust, 3 del perfil CPU/GPU y una prueba real de FFmpeg que ejerce
  look completo, pipeline, ruta larga simulada y audio preservado. Typecheck
  verde y suite completa **1298/1298 en 156 archivos** en 164,41 s.
- `[done]` **Build e instalación**: `tauri:build` con firma local, instalador
  de 254.780.768 B y ejecutable instalado de 76.450.272 B; firma válida,
  recursos de voz y watermark presentes, app abierta y respondiendo (PID
  20540). La instalación re-firma el ejecutable, por eso su SHA difiere del
  binario de `target/release`; ambos son el mismo build por longitud,
  timestamp y cadenas verificadas.
- Límite honesto: la cola persistente con pausa/reanudación/aborto real, el
  pre-recorte antes de descargar y la entrega directa a timeline siguen
  **pendientes**. Hoy la descarga se ejecuta en segundo plano con progreso,
  proxy, límite de tasa y selección de encoder, pero no hay botón de pausa ni
  reanudación entre sesiones. No se simula esa UI.

## Lote perspectiva en preview (2026-10-27)

- `[done]` **Homografía real**: `perspectiveMatrix3d(corners, viewport)`
  resuelve la homografía de 4 puntos (TL, TR, BR, BL → cuadro completo) y la
  emite como `matrix3d` en `transform`; va al final de la lista, así se aplica
  antes de translate/scale/rotate, igual orden que el render.
- `[done]` **Letterbox**: la caja del contenido replica `object-fit: contain`
  y el mapeo del MP4 (las esquinas se definen en píxeles del perfil sobre el
  frame ya escalado); cubre medios 4:3 en cuadros 16:9 y verticales.
- `[done]` **Integración**: video, imagen y gráfico pasan el viewport al
  transform de la preview (en pixel-perfect usa los píxeles reales del frame,
  no el tamaño ajustado a la etapa); el texto del Inspector ya no afirma que
  la preview no deforma.
- `[done]` **Medición real Chromium vs FFmpeg**: mismo frame sintético
  (320×180) y mismo cuadrilátero; dos marcas de color. Centroides CSS vs
  filtro `perspective` de FFmpeg 9.0.1: magenta **Δ 0,275 / 0,042 px** y cyan
  **Δ 0,109 / 0,022 px**; ambas marcas se movieron >5 px del origen. Test
  `e2e/perspective.spec.ts` 1/1 en 57,2 s.
- `[done]` **Tests**: 6 unitarios en `perspective.test.ts` (esquinas por
  defecto, cuadro completo, letterbox 4:3 y vertical, sin escena, cuadrilátero
  degenerado, medio sin tamaño) y 1 DOM en `App.test.tsx` que verifica el
  `matrix3d` en `.preview-media`.
- `[done]` **Verificación**: typecheck verde; suite **1293/1293 en 155
  archivos** en 63,07 s; `vite build` verde en 6,64 s. Sin Rust, sin
  commit/push ni rebuild del instalador.
- Límite honesto: la máscara y el blend siguen aplicándose en espacio del
  elemento (el MP4 aplica la perspectiva antes de la máscara); la caja de
  transformación interactiva no se deforma; la interpolación de muestreo de
  CSS no es idéntica a la de FFmpeg. En el caso medido, preview y MP4
  coinciden dentro de ±0,3 px.

## Lote Lottie real con alfa (2026-10-27)

- `[done]` **Motor**: `lottie-web@5.13.0` (MIT, JavaScript puro) con import
  dinámico; el chunk `lottie` pesa **307,87 kB (79,12 kB gzip)** y sólo se
  carga al abrir una preview o convertir. Se eligió sobre dotlottie-web porque
  no usa WASM y evita `wasm-unsafe-eval` en la CSP; su único `eval` es el
  intérprete de expresiones, que se rechaza al importar.
- `[done]` **Importación**: `.json` de hasta 8 MB, con validación de `layers`,
  `w`/`h` (≤8192), `fr` (≤120), `ip`/`op`, duración ≤300 s y ≤2000 capas. Las
  expresiones se rechazan con un mensaje explícito.
- `[done]` **Plan de salida**: escala a ≤1920×1080 con lados pares, fps 1–60 y
  tope de 900 frames; `trimmed` avisa cuando se recorta el final.
- `[done]` **Rasterizado real**: canvas fuera de pantalla, `goToAndStop` con
  subframes y PNG RGBA en base64 por frame. La preview en vivo usa el mismo
  motor y un damero que muestra la transparencia real.
- `[done]` **Backend**: `write_alpha_frames` / `alpha_frames_to_asset` /
  `discard_alpha_frames` escriben los PNG, codifican VP9 `yuva420p` con
  FFmpeg, importan a `media/` y marcan `media.alpha`; validan token, lote ≤24,
  frame ≤16 MB, secuencia ≤3600 frames y dimensiones pares.
- `[done]` **UI Motion**: panel Lottie (.json) con metadatos, fps de salida,
  autorización de derechos, progreso y agregado a Medios vía
  `markAssetReady(..., 'allowed')`. El video queda listo para montar.
- `[done]` **Prueba real en Chrome** (`e2e/lottie.spec.ts`, 2/2): la preview
  mide **3.600 px opacos / 36.400 transparentes** sobre 200×200, y el
  rasterizador de conversión mueve el centroide del cuadrado en los frames
  0/30/59 (49,5 → +30 → +30) con PNG RGBA.
- `[done]` **Prueba real FFmpeg**: secuencia 64×64 de 6 frames → WebM con
  `alpha_mode=1`; decodificado con libvpx, esquina alfa **0** y centro **255**.
  Overlay real sobre un video azul: centro **(252,0,0)** rojo de la animación y
  esquina **(0,0,252)** azul del fondo; 4.089 B, 1,000 s.
- `[done]` **Verificación del cambio**: typecheck verde; suite **1286/1286 en
  154 archivos**; `vite build` verde en 4,55 s; `cargo check --lib --tests`
  verde. Sin commit, push ni rebuild del instalador.
- Límite honesto: sólo `.json` (los `.lottie` ZIP no se abren todavía), sin
  expresiones, y el video se coloca a mano desde Medios (no hay auto-inserción
  en la timeline). El puente IPC de Tauri no se ejercitó en esta vuelta: el
  rasterizador y el codificador se midieron por separado, ambos reales.

## Lote paneo animado de pista en preview (2026-10-27)

- `[done]` **Preview**: `syncPreviewAudioPanAtFrame(project, frame)` muestrea
  `Track.panKeyframes` en el frame del playhead —clamp en los extremos,
  easing/Bézier por segmento y frames absolutos— y aplica la ley lineal del
  export a las ganancias L/R del grafo Web Audio. El paneo por clip conserva
  la prioridad: si un clip de la pista define `pan`, la pista queda al centro.
  Sólo recorre pistas con claves; las estáticas no pagan costo por tick.
- `[done]` `Preview.tsx` aplica el muestreo en cada cambio de `playhead`,
  además de la sincronización estática por proyecto; cubre reproducción y
  arrastre del playhead.
- `[done]` Tests: 4 nuevos en
  `apps/desktop/src/features/mixer/LiveMeters.test.tsx` (archivo 10/10):
  barrido -1→1 en frames 0 / 7,5 / 22,5 / 30 / 240; anclaje a frames
  absolutos 30 / 45 / 75; Bézier (0.42, 0, 1, 1) con ganancia derecha
  **0,6307136** en el frame 15 (golden
  `cubicBezierProgress(0.5, .42, 0, 1, 1) = 0,31535681250589304`, medido con
  node sobre `packages/project-schema/src/keyframes.ts`); y prioridad del
  paneo por clip (pista en 1,0/1,0).
- `[done]` **Coincidencia con Rust**: el muestreo replica
  `keyframe_expression` / `cubic_bezier_progress` con los mismos fixtures
  que `los_keyframes_de_paneo_*`. Segunda rebanada cerrada el 2026-10-27:
  el MP4 con paneo animado midió **R−L −13,99 dB** contra **−13,98 dB** de
  `panGains(sampleTrackPan(frame))` y **+3,88 dB** contra **+3,88 dB**;
  test live 1/1. Ver “Lote paneo animado de pista en export”.
- `[done]` **Artefacto de esquema**: `npm run schema:generate` agregó 72
  líneas al JSON Schema (denoise, chroma spill, perspective, offsetX/Y,
  note), todas derivadas del esquema TS; respaldo previo fuera del repo.
  `schema-artifacts.test.ts` 5/5.
- `[done]` **Verificación**: `npm run typecheck` verde; suite completa
  **1265/1265 en 150 archivos**; `npm run build` verde en 3,92 s. Un fallo
  intermitente de `App.test.tsx` bajo carga apareció una vez (pasó aislado
  50/50 y en la corrida final). Sin commit, push ni rebuild del instalador.

## Lote verificación de export 5 s (2026-10-27)

- `[done]` **Export real de 5 s a 24 fps medido**: paneo por clip con
  `astats` L −26,68 dB / R −20,66 dB → **6,02 dB** de diferencia, igual a la
  ley lineal de la preview (`panGains(0,5)` = 6,0206 dB). Opacidad Bézier
  (1 → 0 con (0.42, 0, 0.58, 1) sobre 119 frames): rojo promedio en los
  frames **0/64/119 = 252,0 / 112,0 / 0,0** contra **255,0 / 110,93 / 0,0**
  de la preview; el frame 64 queda a 1,07/255. No hizo falta corregir nada:
  el MP4 ya sigue la preview.
- `[done]` Test live permanente `render_live_5s_pan_astats_and_bezier_opacity_match_preview`
  en `apps/desktop/src-tauri/src/render/ffmpeg.rs`; incluye el golden
  `cubicBezierProgress(64/119, .42, 0, .58, 1) = 0.564961`, medido con node
  sobre `packages/project-schema/src/keyframes.ts`. Comando:
  `EDITOR_IA_RUN_RENDER_TESTS=1 node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop --lib render_live_5s_pan_astats_and_bezier_opacity_match_preview -- --nocapture`
  → **1 passed, 0 failed, 412 filtered out** en 1,65 s.
- `[done]` Verificación del cambio: `cargo check -p editor-ia-desktop --lib --tests`
  verde en 50,59 s (solo warnings); `npm run typecheck` verde; `npm run build`
  verde en 7,52 s (`EditorWorkspace` 998,26 kB).

## Lote voz IA local Piper en el pipeline (2026-10-27)

- `[done]` Piper TTS empaquetado: binario Windows 2023.11.14-2, runtime
  ONNX/espeak y voz **es_ES-davefx-medium** (`resources/piper`, dataset CC0,
  aviso en `THIRD-PARTY-NOTICES.txt`). Todo offline; sin red ni credenciales.
- `[done]` UI en Descargas → look: **Generar voz IA local con Piper** + guion
  editable (máx. 4000 caracteres) + marca de agua opcional (`watermark.png`).
- `[done]` Hook: después de yt-dlp, `piper::synthesize` escribe
  `cache/downloads/<run>/voice_ia.wav`; el pipeline usa ese WAV como audio
  final, fuerza H.265 CRF 22, superpone la marca y calcula MD5. Si falla Piper,
  avisa y conserva el audio disponible; el video no se pierde.
- `[done]` Limpieza: se eliminan el video original, `voice_ia.wav` y la caché
  después de verificar el render. El archivo final va a
  `Videos descargados/<Plataforma>/<Título>`.
- `[done]` Tests Piper 4/4 (guion vacío, límite, recursos y síntesis real) y
  render real voz + watermark con video y audio.
- `[done]` Instalado: instalador 249.268.584 B, SHA
  `A9D25943DABFE10519DE6D53E7262705CDF9C43599666DEA4E83C0EF509950EE`,
  firma válida. Instalado 69.295.072 B, SHA
  `1C80E6127365FDBA9442108CF206BEA8333C5BE7761849CA64E2F7F386C578AD`,
  firma válida, app abierta (PID 19320). Recursos `piper/` y `watermark.png`
  verificados en la instalación; Piper sintetizó un WAV desde esa copia.
- `[done]` `npm run typecheck`: verde. Suite completa serial:
  **893/893 en 129 archivos**; bajo carga hubo flakes aislados de Lottie y
  teclado, cada archivo pasó por separado.

## Lote Post-Download Pipeline Hook (2026-10-27)

- `[done]` El post-proceso corre **dentro del mismo hilo bloqueante que
  yt-dlp**, en `cache/downloads/<run>` y antes de `move_download_to`. No hay
  una segunda descarga ni una segunda UI: al terminar yt-dlp se ejecuta el
  pipeline y recién después se despacha el archivo final a la carpeta
  `Videos descargados/<Plataforma>/<Título>`.
- `[done]` Modo **Pipeline automático** (checkbox dentro del look):
  - denoise `hqdn3d=1.86:1.39:2.80:2.15` + flujo óptico 60 fps + 0.98× +
    gamma/contraste/saturación + zoom 4 % por tercios + espejo + grano, en
    **una sola pasada** de FFmpeg.
  - salida **H.265 (libx265) CRF 22**, `hvc1`, 60 fps, `yuv420p`.
  - audio: si se eligió banda, se reemplaza y masteriza con
    `loudnorm=I=-14:TP=-1.5:LRA=11,apad`; sin banda, conserva el audio
    original limpio con `highpass=80,afftdn,loudnorm`; si no hay audio, `-an`.
  - **MD5 nuevo** del archivo final (crate `md-5`) y se muestra en el
    resultado; el original temporal se elimina después de verificar el
    render. El despacho final conserva el MD5.
  - El look manual sigue existiendo (H.264, sin denoise, sin audio original)
    para comparar; el pipeline automático es el modo de producción.
- `[done]` Audio original opcional: **1,02× con `atempo`** + ruido rosa
  `anoisesrc=color=pink:amplitude=0.003162` (**−50 dB**), mezclado con
  `amix=normalize=0` y `alimiter`; después se normaliza a −14 LUFS. Reemplaza
  la pista original. Si hay banda elegida, la banda tiene prioridad y esta
  opción se desactiva. Funciona en look manual y pipeline automático.
- `[done]` Tests Rust: filtro con denoise antes del look, foco por tercio,
  cadena de audio 1,02×/ruido, render real H.265 + MD5, y audio original
  limpio/ruido + banda reemplazada.
- `[done]` Verificación: typecheck completo verde; suite desktop **885/885 en
  128 archivos**; render real H.265 60 fps con MD5 y audio verificado. La corrida real con ruido y 1,02× pasó.
- `[done]` **Instalado** (con audio 1,02× + ruido): instalador 170.795.896 B,
  SHA `6E74B3F37D10A5B5442222EC9B682FC149DB8DC71E8123889F996231BE760DDB`,
  firma válida. Instalado 66.401.760 B, SHA
  `FC0BAB8E1ABFF3A61D9D40FC7E0A9B3BDE9A74006F00EB5E2E9B3D9BFB173514`,
  firma válida, app abierta (PID 14400).
- Nota: el pipeline se ejecuta dentro del `spawn_blocking` de la descarga;
  no bloquea la UI y el archivo no se mueve a destino hasta que termina.

## Lote look cinematográfico 35 mm en Descargas (2026-10-27)

- `[done]` Opción **Look cine analógico 35 mm** en el descargador (sólo MP4):
  `setpts=PTS/0.98` → `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:vsbmc=1`
  (flujo óptico real, 60 fps) → `eq=gamma=0.95:contrast=1.08:saturation=1.12`
  → zoom 4 % con recorte por tercios → `hflip` → grano `noise=alls=8:allf=t+u`
  → H.264 CRF 20, 60 fps.
- `[done]` Reencuadre elegible: centro, tercio izquierdo/derecho/superior/inferior.
  No hay detección de sujeto: el foco lo decide la persona.
- `[done]` Audio: quita la pista original. Si se elige una banda, se mapea,
  se masteriza con `loudnorm=I=-14:TP=-1.5:LRA=11,apad` y se corta al largo
  del video. Sin banda, el MP4 sale sin audio.
- `[done]` La compresión elegida se omite con un aviso: el look ya reencodea.
  El denoise posterior se desactiva mientras el look está activo.
- `[done]` Tests Rust: filtro completo, foco por tercio y render real opcional:
  clip 160×90 → salida 60 fps, dimensiones pares, y variante con banda de
  audio que conserva video + audio.
- `[done]` Verificación: typecheck completo verde; suite **870/870 en 126
  archivos** (la primera corrida tuvo un fallo intermitente de App.test bajo
  carga y la segunda pasó completa); `cargo test` dirigido 3/3; render real
  con y sin banda sonora OK.
- Límite honesto: el flujo óptico es costoso; el grano es fijo y el foco no
  detecta rostros/acción. Los parámetros creativos se muestran en la UI.
- `[done]` **Instalado**: instalador 166.109.760 B, SHA
  `BA29CCBDBFAB58C65255D3C8B9FBA7C225C4E9BF99344724FB53302B2F374AA8`,
  firma válida. Instalado 61.480.928 B, SHA
  `0BFB4C7C6BC8A605A6AED4B9C9DF35C2CF7C8E22340424E97774CB1C91A49053`,
  firma válida, app abierta (PID 26500).

## Lote orden y usabilidad (2026-10-27)

- `[done]` Topbar: botón **Buscar** visible (Ctrl+K) que abre la paleta. La
  paleta ahora genera sus comandos de navegación desde `NAV_VIEWS`: ninguna
  vista queda afuera, incluidas Automático, YouTube, VFX, Mezcla, Denoise,
  etc. Test `commands.test.ts` verifica las 29 vistas.
- `[done]` Inicio: nuevo desplegable **Todas las herramientas**, agrupado en
  Crear/Herramientas/Sistema, con descripción de cada vista. Accesos rápidos
  a Editor, Automático y YouTube. El sidebar dice “HERRAMIENTAS”, no “IA”.
- `[done]` Producción: un proyecto sólo con videos ahora puede montar (antes
  exigía imagen); el mensaje y el paso “Recursos” lo reflejan.
- `[done]` Guion: el selector de voz usa `voice.id` (no el nombre visible) y
  deja de rotular “local” cuando el proveedor es externo.
- `[done]` Publicación: sin clips en la timeline muestra “Sin contenido”,
  avisa por qué y deshabilita manifiesto/EDL/OTIO/FCPXML; materiales y
  subtítulos ya no aparecen en verde por vacuidad.
- `[done]` Automático: confirmación antes de reemplazar con conteo de clips,
  pistas y subtítulos; avisa si los subtítulos de la variante no se aplicarán
  y unifica el aviso de aplicar (reemplazó/agregó + deshacer).
- `[done]` YouTube: textos corregidos (el score usa sólo los videos con
  detalle, no todos los listados), el informe anterior se conserva al
  reanalizar o fallar, y la barra de progreso tiene `progressbar` + porcentaje.
- `[done]` Descargas: los avisos de denoise ya no se pierden al importar, el
  progreso de denoise se refleja en la barra y la etapa dice “Procesando”.
- `[done]` VFX: se quitaron las ruedas Lift/Gamma/Gain decorativas que
  parecían controles; “Detectar fondo” reemplaza la etiqueta contradictoria
  “Sin pantalla verde”; reiniciar polígono y quitar máscara piden confirmación.
- `[done]` Verificación: typecheck completo verde; suite desktop **870/870 en
  126 archivos**.
- `[done]` **Instalado**: instalador 165.137.600 B, SHA
  `E9692C29E2D48BAEF9893177D7DD0E9EC303C829903A26DF30FECD58782073FB`,
  firma válida. Instalado 59.954.144 B, SHA
  `5C61ADC886E14A4861C4D15BD4CD25BE95FDE47D662F5AB2133499BB3F03041D`,
  firma válida, app abierta (PID 20004).
- Nota: de los 20 agentes solicitados, el runtime cortó por límite de crédito
  tras 5 auditorías completas; los hallazgos restantes se revisaron y
  corrigieron en esta misma pasada. Sin commit ni push.

## Lote analizador de canales de YouTube (2026-10-27)

- `[done]` Vista **YouTube** en herramientas: pegás un `@handle` o URL de canal,
  y la app lista hasta 100 videos con yt-dlp. El detalle se reparte entre los
  más vistos y los más nuevos (8–24 videos) para no golpear la red.
- `[done]` Por video: vistas, likes, comentarios, duración, fecha, vistas/día,
  engagement (likes + 2×comentarios), score 0–100, flags de título y razones.
  Ranking por vistas/día (45), engagement (35) y recencia (20).
- `[done]` Miniaturas: descarga la mejor resolución, mide brillo, saturación,
  contraste y paleta, y devuelve un preview JPEG en data URL (CSP-safe).
- `[done]` Comentarios: lee hasta 40 de los 1–5 mejores videos, calcula
  sentimiento con léxico local, palabras clave y comentarios más gustados.
  Sin LLM ni servicios externos.
- `[done]` Informe de canal: suscriptores, mediana de vistas, engagement medio,
  cadencia semanal, mejor día/hora UTC, duración mediana, patrones de título
  (números/preguntas/tutoriales/listas), palabras frecuentes, miniaturas,
  fortalezas y oportunidades. El “mejor video” se etiqueta como muestra, no
  como historial completo.
- `[done]` Tests: 6 unitarios Rust (URLs, flags, sentimiento, scoring, imagen,
  fechas), 2 de UI, typecheck y suite desktop **867/867 en 125 archivos**.
- `[done]` Prueba de red real: Computerphile, 4 videos detallados, mejor
  `h6j_ixGnpiY`, 40 comentarios analizados, 35,68 s; miniaturas y comentarios
  presentes.
- `[done]` **Instalado**: instalador 163.689.928 B, SHA
  `AB2F6BB034AC8EC70EF96B32A12BD5CCF8E332C847D9EC6450DB2918B0A892E4`,
  firma válida. Instalado 58.520.032 B, SHA
  `32D5BFC9C863CF92FEC9463EF5F22F454EF790F289329ADF6B7B64174446C376`,
  firma válida, app abierta (PID 23908).

## Lote editor automático sin LLM (2026-10-27)

- `[done]` Vista **Automático** en herramientas: elegís un video, la app mide
  escenas, silencios, negros, congelados y loudness con FFmpeg y genera tres
  variantes: **Pulso rápido**, **Historia** e **Impacto** (highlight de
  15–30 s). Sin LLM, sin servicios externos.
- `[done]` Aplicar una variante crea clips reales en la timeline (reemplaza o
  agrega al final), con cortes por escena/silencio, transiciones dissolve,
  zoom punch-in con keyframes, y audio mejorado: high-pass 80 Hz, low-pass
  16 kHz, denoise, de-esser, compresor, EQ medio y gain calculado a −14 LUFS.
- `[done]` Subtítulos sin IA: extrae el primer subtítulo incrustado del video
  (prefiere español) a SRT con FFmpeg, o importa SRT/VTT. Los textos se
  remetean al tiempo de salida de cada corte. La transcripción Whisper local
  queda **opcional y apagada** por defecto.
- `[done]` El planner no inventa texto: si no hay subtítulos incrustados ni
  archivo, la variante se crea sin subtítulos y lo avisa.
- `[done]` Verificación: typecheck limpio; suite **865/865 en 124 archivos**;
  extracción real de un MKV con pista `spa` a SRT validada con FFmpeg.
- `[done]` **Instalado**: instalador 162.871.824 B, SHA
  `BD0C3E53FD11322AD0C84FB5F87F33D261B5D1831CFA6A9EDCFF6A4C870B0519`,
  firma válida. Instalado 56.823.776 B, SHA
  `C701599261193431742CC67FF73011DCFD63DBE39EFC428D690A4A6276173CD0`,
  firma válida, app abierta (PID 9208).
- Pendiente: exportar las tres variantes a MP4 separados en un solo lote,
  preview antes de aplicar, y umbrales de escena configurables.

## Lote chroma con y sin pantalla verde (2026-10-27)

- `[done]` VFX: preview de clave real sobre damero en el visor, sin exportar.
  Canvas limitado a 1280 px para no bloquear los sliders; toggle “Vista de
  clave / original”.
- `[done]` Controles: color clave, similitud, suavizado y **derrame**; presets
  “Verde” y “Azul”. El derrame se aplica al export con `despill` sólo en
  pantallas verde/azul.
- `[done]` Sin pantalla verde: “Detectar fondo” elige la esquina más uniforme
  del frame actual como color clave (pared, tela, cielo). Si el fondo tiene
  textura o personas, el panel enlaza a Quitar fondo (IA).
- `[done]` Schema: `chromaKey.spill` opcional 0..1; tests de chroma 6/6.
- `[done]` Tests: 4 unitarios de la clave (verde, color arbitrario, borde
  suave, derrame y píxeles opacos) + 1 de UI de la cadena VFX.
- `[done]` FFmpeg real: fondo verde → azul `(0,0,254)` y sujeto rojo
  `(250,0,0)` tras `chromakey + despill`; tests Rust 2/2.
- `[done]` Verificación: typecheck limpio, suite completa **853/853 en 122
  archivos**, `cargo check --release` verde.
- `[done]` **Instalado**: instalador 161.749.496 B, SHA
  `F2E0D1DFDBF3351F99F7369B90173461F1CD0E6C032C234DEC3D4E99854F33C7`,
  firma válida. Instalado 55.405.024 B, SHA
  `C82A56C5EF16B54892D043C83A20DAFB4B1CE926ABE00CF2167A2C4E7A6B7925`,
  firma válida, app abierta (PID 26728).
- Límite honesto: la vista es una aproximación RGB del chromakey YUV del
  export; sirve para encuadrar la clave, el MP4 sigue siendo la referencia.

## Lote rendimiento y ruido (2026-10-27)

- `[done]` Arranque: el splash ya no retiene 4 s; mínimo 0,9 s (≈3,1 s
  menos cuando la app está lista). `src-tauri/src/lib.rs`.
- `[done]` Carga: la precarga en ocioso pasó de 27 vistas a 8 de uso
  frecuente (home, editor, medios, descargas, mezcla, VFX, director,
  fábrica) y arranca a los 1,2 s en vez de 0,35 s. Las demás se cargan al
  abrirlas. 27→8 pedidos de chunk.
- `[done]` Descargas: el default pasó de recomprimir H.265 CRF 24 a
  “Original · sin recomprimir”. Medido con un clip 1080p30 de 10 s:
  remux **172 ms / 9,6 MB** vs H.265 **9.685 ms / 8,5 MB** (56× más
  lento y con pérdida). Además `--concurrent-fragments 8` y
  `--http-chunk-size 10M`.
- `[done]` Ruido al descargar: opción “Reducir ruido del video al
  importar”; aplica Denoise Studio (FFmpeg hqdn3d) antes de importar y,
  si falla, importa el original con aviso.
- `[done]` Ruido en el editor: nuevo `effects.denoise` (0..1) por clip,
  slider en Inspector y VFX, `hqdn3d` temporal en el export. La UI aclara
  que la preview no lo simula. Medido sobre un clip sintético con ruido:
  SSIM 0,6075 → 0,6335 con fuerza máxima.
- `[done]` Denoise Studio: el resultado se puede **Importar a Medios**
  sin salir de la vista.
- `[done]` Render: publicar el MP4 verificado usa `rename` y sólo copia
  si el sistema no puede moverlo; se evita duplicar la escritura de
  archivos grandes. Tests de mover y reemplazar salida.
- `[done]` Render/UI: la detección de encoders se cachea por ruta de
  FFmpeg; la primera apertura mide y las siguientes son instantáneas.
- `[done]` Verificación: typecheck limpio; suite completa **848/848 en 121
  archivos**; `cargo check --release` verde; Rust de publish 2/2 y filtro
  visual 1/1.
- `[done]` **Instalado**: instalador 160.596.504 B, SHA
  `CA35269D1134F237575550E69A231458A5F7100A0EFD252C8408460DC6608B0A`,
  firma válida. Instalado 54.035.936 B, SHA
  `26AFDE1B229AECA4538F35AC951F3E5147C56902C0BF80BEF8A874997A6E0933`,
  firma válida, app abierta (PID 19388). La ventana apareció a los
  **1.284 ms** del lanzamiento (antes el mínimo del splash era 4 s).

## Lote relink de medios (2026-10-27)

- `[done]` Medios: botón “Reconectar archivo…” por material. Reimporta el
  archivo con el mismo pipeline (copia a `media/`, mide, hashea), conserva
  id, nombre, licencia, etiquetas, bin y los clips en su lugar; descarta el
  proxy viejo. Rechaza un tipo distinto o un archivo más corto que el
  `outFrame` de cualquier clip, también dentro de compuestos.
- `[done]` Tests: proyecto 96/96 (2 nuevos de relink), Medios 7/7 con el
  botón presente; typecheck limpio.
- `[done]` **Instalado**: instalador 159.349.448 B, SHA
  `CDE09121D460D23585EB2EDE9246BD522C212EF9FD5778698E4386228414F9E0`,
  firma válida. Instalado 52.680.160 B, SHA
  `895973C0F43E627428709993690C6034422A5B1580D07DCA136D1B690C0D488A`,
  firma válida, app abierta (PID 13264).

## Lote verificación y accesibilidad (2026-10-27)

- `[done]` Seguimiento facial: el backend informa tiempos relativos al rango
  analizado; ya no se resta `inFrame` dos veces. Test 5/5.
- `[done]` Fábrica: checkbox explícito de autorización de créditos; el pedido
  usa la decisión del usuario y el orquestador expone advertencias reales del
  log. Test 2/2.
- `[done]` Inspector: tabs con flechas/Home/End, `tabIndex` móvil, ids y
  `aria-controls`; panel con `role=tabpanel`.
- `[done]` Mezcla: aviso visible cuando el paneo de pista queda omitido por
  clips con paneo propio. Test 6/6.
- `[done]` VFX: la vista aclara que chroma, sharpen y viñeta se aplican recién
  en el export; no promete una preview que no existe.
- `[done]` Gate del render: además del contenedor, exige pista de video y de
  audio y que la duración declarada de cada pista coincida con la timeline.
  4 tests unitarios + 2 pruebas reales con FFmpeg (sin audio se rechaza; un
  render con paneo 0,5 pasa y mide L −26,7 / R −20,7 dB).
- `[done]` Typecheck limpio; tests dirigidos 121/121; `vite build` verde.
- `[done]` Instalado el checkpoint con face/Factory/tabs: instalador
  157.048.296 B, SHA
  `7CE2193515EACA497357AC860DB77B981FB56B2BFFBA3E88B027DB8797E2C876`,
  firma válida. Instalado 49.941.984 B, SHA
  `BA0D740B60EF45958D8F0FD42957FA5F430B3EAA125381465D20070C536312D9`,
  firma válida.
- `[done]` **Instalador final de este lote**: 159.143.440 B, SHA
  `535E3CF4D4FC10A72B4F451D25509A96BD86581CFD4963E2C489426383212CB2`,
  firma válida. Instalado 51.348.448 B, SHA
  `DED52060BD30F570AC7C95271704883408609F6AF296EACB85DB2EE4776EB50B`,
  firma válida, app abierta (PID 17144).

## Lote UX/medios (2026-10-27)

- `[done]` Scopes: FilmCraft conserva el último Parade en vez de vaciarlo.
- `[done]` Preview: feather usa la máscara SVG (ya no se ve dura); imágenes y
  videos rotos muestran “no disponible” con botón Reintentar, sin tocar el
  proyecto.
- `[done]` Contraste: tabs activas y flags del mixer usan `#9ec1ff` (5,19:1).
- `[done]` Reconstruir e instalar: instalador 156.431.264 B, SHA
  `fa6d35ab2ab956db548911a8184cf0b32d888f9ad87cebe83172980dc66e618e`,
  firma válida. Instalado 48.561.120 B, SHA
  `f599275bd6fbe4b3a4f48a179a0a393e8d3ad7edb6bedaaa8f3c4feafb381635`,
  firma válida, app abierta (PID 23544).

## Lote arreglos (2026-10-27)

- `[done]` Timeline: clic sin arrastre ya no mueve/cierra huecos; dividir
  reparte keyframes; trim-start rechaza superposición. Tests 93/93.
- `[done]` SRT sin línea en blanco, huecos de subtítulos ordenados y color de
  caja ASS. Tests 13/13.
- `[done]` LUT se conserva al elegir look/neutro; HSL y color match de capas
  de ajuste llegan al MP4.
- `[done]` Factory usa un nombre único por variante.
- `[done]` Seguridad: import de timelines confinado a root/base, capability
  `opener` retirada y clave PEM movida a `D:\Users\ofici\QODER-WORK\_keys`.
- `[done]` Suite flaky: el worker moría por un bucle de render en
  `TrackAutomationPanel.test.tsx`; los efectos ahora comparan antes de
  escribir y el archivo pasa 7/7 en 3,7 s.
- `[done]` Reconstruir e instalar: instalador 155.595.344 B, SHA
  `306ba1a22255d6f445bf077ba666a5f6822c785c86ed5442cfb94dc342e9f197`,
  firma válida. Instalado 47.188.448 B, SHA
  `a2bfcc86ce57a0641cb8e50fa8afc23ff5f8f05ad3756081647ee7d2db4ca6c3`,
  firma válida, app abierta (PID 7792).

## Lote perspectiva (2026-10-27)

- `[done]` **Perspectiva a 4 puntos**: schema `PerspectiveSchema` (convexidad y
  área), 8 campos en Inspector, filtro Rust `perspective=...:sense=source` y
  tests de schema + filtro. Se ve en Frame real y export; la preview CSS no
  deforma la imagen.
- `[done]` **Reconstruir e instalar**: instalador 154.122.584 B, SHA
  `904a8d575f97b5bcb9179054714215f4519cc54f5caa98ed2dfb4fc7b2b0d4e1`,
  firma válida. Instalado 45.900.256 B, SHA
  `0c8e16b04a718d0e0ebe377d0795e4e66402ca296739b7690cd509fb90ed25af`,
  firma válida, app abierta (PID 26912). Filtro validado con cuadrícula real:
  el cuadrilátero de origen llena el cuadro, sin esquinas negras.
  Límite: la preview CSS no deforma; se usa **Frame real** o export.

## Pendientes priorizados

1. **Reconstruir e instalar este lote** `[done]` — instalador
   153.000.616 B, SHA `f9b4086340173959201c78ffeedb685b5609423ffd153f55f7fc3d96591122a2`,
   firma válida. Instalado: 44.548.576 B, SHA
   `6e8029f64f01215ffce8a17da3cf113a19ce52673d3de4adea783cf23c2edbae`,
   firma válida, app abierta (PID 28032) y respondiendo.
2. **Export MP4 real de 5 s** `[done]` — paneo L/R por `astats` 6,02 dB
   (preview 6,0206) y opacidad Bézier 252,0 / 112,0 / 0,0 en frames
   0/64/119 (preview 255,0 / 110,93 / 0,0); test live 1/1. No difiere.
3. **Gate de render por stream** `[done]` — `verify_output` exige video y
   audio y compara la duración declarada de cada pista; 4 tests unitarios y
   2 reales con FFmpeg.
4. **Suite completa en rojo intermitente** `[done]` — 121 archivos,
   846 tests, 0 fallos (2026-10-27).
5. **Automatización de paneo de pista en preview** `[done]` — la preview
   muestrea `panKeyframes` por frame (4 tests, archivo 10/10) y el MP4 sigue
   la misma ley: **−13,99 vs −13,98 dB** y **+3,88 vs +3,88 dB** en las dos
   mesetas, medido con `astats` (test live 1/1). De paso se corrigió el
   límite de línea de comandos del grafo largo (35.271 → archivo) y un panic
   de perspectiva; suite Rust 412/412. Ver “Lote paneo animado de pista en
   export”.
6. **Lottie real (MIT)** `[done]` — lottie-web 5.13.0 (sin WASM), PNG RGBA →
   comando Tauri → WebM VP9 `yuva420p` → asset con `media.alpha` en Medios;
   overlay real medido (centro 252,0,0 / esquina 0,0,252). Ver “Lote Lottie”.
7. **Perspectiva de metraje** `[done]` — la preview aplica la misma homografía
   4 puntos que el filtro `perspective` del MP4, con letterbox; medido en
   Chromium contra FFmpeg 9.0.1 (Δ ≤ 0,28 px). Ver “Lote perspectiva en
   preview”. Límite: máscara/blend y caja interactiva siguen sin deformarse.
8. **Updater y timestamp** `[partial]` — la 0.2.0 ficticia, los canales
   decorativos y la descarga simulada ya no existen: el modal informa "sin
   canal configurado" y el lanzador no anuncia actualizaciones (typecheck
   verde, 1299/1299, build 7,46 s, e2e Chrome 1/1). Falta la decisión del
   usuario: certificado de firma con sello de tiempo y endpoint del
   manifiesto; recién entonces hay comprobación y descarga reales.
9. **Partir `EditorWorkspace` (~998 kB)** `[done]` — shell **999,83 →
   53,62 kB** (gzip 192,78 → 18,25); Inspector 138,90, Timeline 40,13,
   EditorAssets 25,35 y EmojiPicker 719,71 salen como chunks propios y
   ExportDialog 24,73 se carga al abrirse. `COLOR_LOOKS` se movió a
   `color-looks.ts`. Typecheck verde, suite raíz 1310/1310 en 160 archivos,
   build 6,12 s. Ver “Lote partir EditorWorkspace”.
10. **Accesibilidad restante** — partido en tres; 10a y 10c cerrados.
    - 10a `[done]` **Menú con teclado y foco** — roving tabindex, ←/→ entre
      menús, ↓/↑ con primer/último ítem, Enter/Espacio, Escape devuelve el foco
      al disparador y no propaga, Tab cierra, `aria-checked` con
      `menuitemcheckbox`. `MenuBar.test.tsx` 8/8, suite **1321/1321 en 160
      archivos** en 53,89 s, build 8,33 s. Ver “Lote accesibilidad del menubar”.
    - 10b `[pending]` **Contraste de guías de curvas** — `KeyframeCurveEditor`
      dibuja la línea central en `#3a3f46` (**1,80:1** sobre `#0a0f1e`) y las
      guías punteadas en `#565d66` (**2,87:1**), ambas por debajo de 3:1
      (WCAG 1.4.11). Candidatos medidos sobre el mismo fondo: `#6b7480`
      (4,03:1) y `#7b8591` (5,10:1). Falta elegir el par y fijar el test de
      ratio.
    - 10c `[done]` **Etiquetas de paneo** — verificado en código: la mesa usa
      `aria-label` «Paneo de <pista>» + `aria-valuetext` con `panLabel`
      (C / L 40 / R 25); la automatización rotula cada clave por pista y
      timecode; el paneo de clip del Inspector es un `NumberField` dentro de un
      `<label>` con el texto «Paneo (−1 izq · +1 der)».
11. **Medios faltantes** `[done]` — fallback y Reintentar, más “Reconectar
    archivo…” en Medios: reimporta, conserva id/nombre/licencia/etiquetas y
    rechaza tipo distinto o archivo más corto que un clip.
12. **Documentación honesta** — README con hashes/counts actuales, Lottie
    documentado con sus límites (`.json`, sin expresiones) y 3D marcado como
    pendiente, no como hecho.
13. **Face tracking con inFrame>0** `[done]` — `maskFromFaceTrack(result,
    fps)` usa tiempos relativos; test 5/5.
14. **Factory permisos y warnings** `[done]` — consentimiento explícito de
    créditos y avisos reales del log; test 2/2.
15. **Paneo: precedencia visible** `[partial]` — la mesa avisa cuántos
    clips omiten el paneo de pista (test 6/6); falta el reset “Centro”
    unificado en Inspector.
16. **VFX preview honesta** `[done]` — la vista marca chroma, sharpen y
    viñeta como solo export; no se muestran inertes.
17. **Emoji diferido** — el catálogo (~240 kB fuente) ya no está en el shell:
    vive en el chunk `EmojiPicker` (**719,71 kB min / 113,13 gzip**, escapado
    ASCII) que comparten rail e Inspector y todavía se carga al montar el
    editor. Falta importarlo recién al abrir el picker y medir el chunk
    antes/después.
18. **Composición opaca en yuv420p** — si ningún clip necesita alfa
    (sin chroma, máscara, opacidad, blend ni transición), componer sin
    RGBA. Un benchmark externo midió −32% (2,08→1,41 s) con salida
    idéntica; verificar con PSNR/SSIM y los tests live antes de adoptarlo.
19. **Playhead fuera del contexto** — hoy cada tick de reproducción
    re-renderiza paneles; separar el playhead y memoizar mapas de clips
    en Preview. Medir frames >16 ms en 10 s de playback.
20. **Denoise de audio en preview** — el `afftdn` del export no se
    simula en Web Audio; evaluar un filtro aproximado o marcar la
    diferencia en la UI.
21. **Automatización de fader de pista en preview** — el export aplica
    `gainKeyframes` con `volume` por frame, pero la preview sigue leyendo el
    `gainDb` estático. Reutilizar el muestreo por playhead del paneo y medir
    las ganancias del fader con un test.
22. **Lottie: `.lottie` y prueba IPC nativa** — abrir el ZIP `.lottie` con
    `fflate` (ya es dependencia) y ejercitar la conversión completa en la app
    nativa, IPC incluido, midiendo el WebM resultante.

## Reglas del ciclo

- Elegir el primer ítem `pending`, implementarlo y verificar.
- Si falla un test o una medición, no avanzar: corregir o dejar `blocked`
  con la evidencia.
- Un solo escritor por archivo; no commit/push/install sin pedido explícito.
- Al cerrar: actualizar este archivo y la memoria con números medidos.
