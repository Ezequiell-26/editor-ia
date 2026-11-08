# Follow-ups: backend sin UI y pendientes de honestidad

**Fecha:** 3 de noviembre de 2026
**Contexto:** Ola 4b (`task-6`). Cierra lo que quedó fuera de `task-4`: acciones
de recuperación de IA en el asistente, capacidades honestas en Ajustes y
documentación de requisitos. Este archivo es el registro de lo que **todavía no
tiene superficie de UI** o requiere otra ola, con evidencia verificable.

> Regla del proyecto: una capacidad no se anuncia como "lista" si no tiene
> superficie o si la superficie promete algo que el backend no hace. Lo que sigue
> es deuda **conocida y medida**, no una lista de deseos.

---

## 1. Hecho en esta ola (para no volver a reclamarlo)

| Cambio | Archivo | Evidencia |
|---|---|---|
| Acciones «Probar proveedor» y «Abrir Ajustes» en el estado de error del asistente | `apps/desktop/src/features/assistant/AssistantDock.tsx` | `AssistantDock.test.tsx`: 3 tests nuevos (resultado tipado, fallo honesto, sin error no muestra acciones). 32/32 archivos de test. |
| Fila de transcripción honesta: `no disponible` + motivo accionable del backend | `apps/desktop/src/features/settings/CapabilitiesCard.tsx` | `CapabilitiesCard.test.tsx`: 2 tests (motivo de faster-whisper visible; capacidad disponible como lista). |
| Requisitos reales (nativa, navegador, Whisper, FFmpeg, ONNX, MCP) | `README.md`, `docs/TUTORIAL.md` | Secciones nuevas/actualizadas; ver §3 de este archivo. |
| Comando `test_provider` + contrato `testProvider()` | `src-tauri/src/commands/providers.rs`, `services/project-service.ts` | `task-4`: Rust 26 passed, `project-service.test.ts` 6/6. |

---

## 1b. Ola 4c — atajos endurecidos e IA en streaming (2026-11-03)

| Cambio | Archivo | Evidencia |
|---|---|---|
| Persistencia de atajos **sólo de overrides** `id -> binding` distintos del default, merge al cargar y lectura del formato legado | `apps/desktop/src/state/shortcuts.ts` | `shortcuts-config.test.ts`: 15 tests (round-trip, legado, reset, corrupto, eventos, `getShortcut`). |
| Helpers puros `assignShortcut`/`findShortcutConflict` (normalización, `isBindable`, sin duplicados) usados por la UI | `state/shortcuts.ts`, `features/settings/ShortcutsCard.tsx` | Tests de conflicto/no-bindable/mismo binding; la card ya no duplica la lógica. Grupo «Timeline» ordenado en Ajustes. |
| Streaming del asistente con SSE OpenAI-compatible y cancelación | `src-tauri/src/commands/assistant.rs`, `lib.rs`; `services/project-service.ts`; `features/assistant/AssistantDock.tsx` | Eventos `assistant-stream-{delta,completed,failed,cancelled}`; comandos `assistant_chat_stream` + `cancel_assistant_stream`. Rust: parser SSE incremental, cancelación y servidor SSE local; TS: burbuja en vivo (`reply` parcial), botón **Detener respuesta**, fallback al camino no-streaming. |
| Presupuesto de tokens visible y configurable | `state/assistant-budget.ts`, `AssistantDock.tsx`, `SettingsHome.tsx` | Estimación ~4 caracteres/token en el compositor + aviso al superar el umbral de **Ajustes → IA → Presupuesto de tokens** (default 4.000, rango 500–50.000). Tests de módulo y de componente. |
| Documentación | `docs/TUTORIAL.md` (atajos y asistente), `docs/ATAJOS-PRO.md` | Comportamiento y límites explicados sin prometer de más. |

**Límites de la ola 4c (verificar en la app nativa):**

- El streaming se probó con tests Rust (SSE local) y con un fake de componente;
  **no** se lanzó contra Ollama/OpenAI reales en esta sesión. Verificación
  sugerida: `npm run tauri:dev` con Ollama encendido → pedir algo al asistente y
  comprobar (a) deltas visibles, (b) **Detener respuesta** corta el flujo y no
  aplica acciones, (c) con un endpoint que ignore `stream:true` cae al camino
  normal sin duplicar texto.
- La cancelación se aplica al próximo chunk leído (la lectura HTTP es bloqueante
  en el hilo del backend): con proveedores locales el corte es casi instantáneo;
  con uno remoto que tarde en mandar el próximo token puede demorar ese intervalo.
- El fallback no-streaming sólo se dispara si el fallo ocurre **antes del primer
  delta** (`retryable: true`); un corte a mitad de respuesta muestra el error en
  vez de repetir la llamada (evita duplicar costo y texto).
- La estimación de tokens es aproximada (4 caracteres/token) y no incluye el
  contexto del proyecto; sirve como aviso, no como facturación.
- ✅ **Atajos locales del timeline reasignables** (ola posterior): `Timeline.tsx`
  y `EditorWorkspace.tsx` leen el registro vía `bindingMatches` +
  `shortcutsRef`. `S`/`M` y los 12 atajos locales nuevos (`Shift+R`, `H`,
  `Ctrl+C/V`, `Shift+Delete`, `Alt+Shift+←/→`, `V`/`C`/`A`/`Shift+A`/`Z` del
  selector) aparecen en Ajustes → Atajos con sus defaults originales.
  ✅ `clipKeyboardAction` (`timeline-keyboard.ts`) también lee el registro:
  el match ignora Shift en ambos lados porque Shift es el modificador de la
  acción (±1 s / borde de salida), no del binding. Límite documentado en
  `ATAJOS-PRO.md`: bindings que sólo difieran en Shift colisionan. ✅ Cableado global de los atajos 🟡 resuelto:
  `App.tsx` despacha shuttle/frame/inicio/fin desde cualquier vista y
  `Timeline.tsx` atiende zoom (`+`/`-`/`F`) y recorte (`[`/`]`) con las mismas
  fórmulas que sus botones.
- La fase de timeline pro agregó atajos **locales** en `Timeline.tsx`
  (`Shift/Ctrl+clic` multi-selección sigue siendo mouse). `Esc` no tiene
  handler local: la multi-selección depende de `edit.deselect` del registro;
  migrar a `selection: { kind: 'clips', ids }` en el store queda para otra ola.

---

## 2. Backend sin UI (deuda P1-3 del audit)

Verificado el 2026-11-03 con:

```powershell
Get-ChildItem apps/desktop/src -Recurse -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch "project-service|fake-service|\.test\." } |
  Select-String -Pattern "analyzeMediaFrames|checkAssetFiles|mcpServerStatus|inspectFlowInstall|\.convertMedia\("
# -> sin resultados (sólo aparecen en el contrato y en el fake de tests)
```

| Capacidad | Backend | Superficie | Estado | Resolución |
|---|---|---|---|---|
| Análisis de cuadros de video (`analyze_media_frames`) | `src-tauri/src/lib.rs` | MCP `media_analyze` → `service.analyzeMediaFrames` | **CONECTADO** | El asistente la invoca como tool MCP; descripción del catálogo aclara que muestrea el cuadro medio de videos. Test en `mcp-tools.test.ts`. |
| Detección de medios faltantes (`check_asset_files`) | `lib.rs` | `ProjectHome.tsx` (banner al abrir) + MCP `fs_check` → `service.checkAssetFiles` | **CONECTADO** | Banner de medios faltantes al abrir proyecto y tool MCP para verificación bajo demanda. |
| Estado del servidor MCP propio (`mcp_server_status`) | `mcp_server.rs` | `McpView.tsx` | **CONECTADO** | Panel con URL, token enmascarado y start/stop/restart. |
| Conversión de un solo medio (`convert_media`) | `lib.rs` | MCP `media_convert` → `convertMedia` (1 asset) / `convertMediaBatch` (>1) | **CONECTADO** | La tool MCP usa la vía simple con un solo `assetId` y el batch con varios. Tests en `mcp-tools.test.ts`. |
| `inspect_flow_install` | — | — | **ELIMINADO** | La generación Flow va por el navegador embebido (`flow_generate.rs`), no por google-flow-mcp; comando, handler y test retirados de `mcp.rs`/`lib.rs`. |

### 2.1 `voice-isolation` (resuelto después de esta ola)

**Estado actual: IMPLEMENTADO.** `commands/voice-isolation.rs` está declarado en
`mod.rs` y registra `voice_isolation_status`, `voice_isolate_media` y
`prepare_voice_isolation` en `lib.rs`. El backend embebe el wrapper Python
`scripts/ai-voice-isolation/demucs-wrapper.py` (Demucs) y la UI lo expone con
preparación honesta del motor (Python + torch/torchaudio/demucs/soundfile, modelo
~2 GB en `~/.cache/demucs/`). Tools MCP: `voice_isolate` y
`voice_isolation_prepare`.

La descripción original de esta sección (módulo muerto, APIs inexistentes,
handler comentado) quedó **obsoleta**: correspondía al árbol anterior a la
integración Demucs. Se conserva el razonamiento como registro histórico; la
evidencia vigente está en `voice_isolation.rs`, `lib.rs` y los tests del módulo.

---

## 3. Pendientes de UI/funcionales para la próxima ola

| # | Pendiente | Archivo objetivo (dueño de la ola de UI) | Nota |
|---|---|---|---|
| 1 | ✅ Resuelto (ola 4b/4c): **«Probar conexión»** persistente en Ajustes → IA y en el error del asistente, con resultado tipado | `features/settings/SettingsHome.tsx`, `features/assistant/AssistantDock.tsx` | Usa `store.service.testProvider()`; devuelve `status`, `httpStatus`, `latencyMs`, `model`, `detail`. |
| 2 | ✅ Resuelto: chip «proveedor simulado» y aviso en Fábrica | `features/factory/FactoryView.tsx` | El rechazo en `state/batch-factory.ts` ya está implementado y testeado. |
| 3 | ✅ Resuelto (verificado 2026-11-07): los checks de `HomeView` en modo navegador ya son honestos — 3 filas «solo app nativa» con `ok:false` y una de recorrido con `ok:true`; nada en verde hardcodeado | `features/home/HomeView.tsx:225-237` | — |
| 4 | ✅ Resuelto (verificado 2026-11-07): `StartScreen` muestra `store.state.error` en `visibleError` con banner `role="alert"` y botón de descarte; no quedan CTAs `demo://` ni `proyectos/demo-*` en el archivo | `features/start/StartScreen.tsx:229,570-580` | — |
| 5 | ✅ Resuelto (verificado 2026-11-07): `LocalModelGate` consulta `listModels()` al entrar, muestra el estado del modelo y ofrece «Descargar modelo» con `downloadModel()` en la propia vista; lo usan `RemoveBackgroundView` y `UpscaleView` | `features/ai/LocalModelGate.tsx`, `RemoveBackgroundView.tsx:86`, `UpscaleView.tsx:87` | — |
| 6 | Botón «Abrir Ajustes» en el error del asistente: hoy cambia de vista; validar en la ventana de Ajustes de la app nativa | `features/assistant/AssistantDock.tsx` | Ya implementado con `onSelect('settings')`; la verificación en ventana nativa queda pendiente. |
| 7 | ✅ Resuelto (verificado 2026-11-07): `BrowserModeBanner` ya es un `<aside>` en flujo (sin `position:fixed` ni estilos inline), con copy honesto de qué sí/no se puede probar y acción «Abrir Ajustes»; estilos en `filmora.css` y `premium/shell.css` | `components/BrowserModeBanner.tsx`, `styles/filmora/filmora.css:1135-1160`, `styles/premium/shell.css:2087+` | — |
| 8 | ✅ Resuelto: `analyze_media_frames`/`check_asset_files`/`mcp_server_status`/`convert_media` conectados como MCP/UI; `inspect_flow_install` eliminado | varios | Ver §2 actualizado. |

### Documentación ya actualizada (no volver a pedirla)

- `README.md` → «Requisitos reales: qué es nativo y qué no»: app nativa
  obligatoria para el trabajo real, navegador como demo de UI con banner,
  FFmpeg/FFprobe, yt-dlp, SAPI/ElevenLabs, proveedor IA y **Probar proveedor**,
  Faster-Whisper no empaquetado con `pip install faster-whisper` o
  `EDITORIA_WHISPER_PYTHON`, `onnxruntime.dll` + pesos, MCP local, motores
  externos.
- `docs/TUTORIAL.md` → §1 (requisitos y «local-first ≠ sin instalar nada»), §4
  (probar proveedor desde el asistente), §15 (estudio de color: 34 colores, 7
  presets, WCAG, JSON, `localStorage`), §21 (modo navegador y Whisper no
  empaquetado).

---

## 4. Cómo verificar lo nativo (lo que no se pudo probar en esta ola)

La Ola 4b no levantó la app Tauri. Para cerrar el círculo en la próxima sesión:

1. `npm run tauri:dev` → ventana y splash.
2. **Ajustes → IA** con Ollama encendido y apagado: el error del asistente debe
   ofrecer «Probar proveedor» y distinguir `ok` / `unauthorized` / `unreachable` /
   `timeout` con el `detail` del backend; «Abrir Ajustes» debe abrir la ventana.
3. **Ajustes → Capacidades** en una máquina sin `faster-whisper`: la fila de
   transcripción debe decir `no disponible: el Python de PATH (…) no tiene
   faster-whisper; instalá el motor con …`. Con el módulo instalado y la app
   reiniciada, debe pasar a `listo` con el intérprete verificado.
4. **Texto/Subtítulos automáticos** con y sin el motor.
5. **Fábrica** con proveedor simulado: debe rechazar la variante con el error de
   `state/batch-factory.ts` y no escribir archivos.

---

## 5. Firma de código real y release firmado (task-13, 2026-11-03)

Estado del frente: **preparado y verificado, bloqueado por un recurso externo**
(certificado de firma de código de una CA pública). No se puede comprar ni
obtener desde el repositorio ni desde el agente; el pedido «firma real» queda
cubierto hasta donde es técnicamente posible sin credenciales.

### 5.1 Hecho y verificado en esta ola

| Pieza | Archivo | Evidencia |
|---|---|---|
| Workflow de release reproducible Windows x64 (Tauri + NSIS) | `.github/workflows/release.yml` | YAML válido (`js-yaml`), 20 pasos y **43/43 checks** offline (`.tmp-redesign/shell/release-validation.json`). Corre `npm ci`, toolchain de `rust-toolchain.toml`, FFmpeg dev, recursos, `npm run verify` (typecheck + tests seriales + extensión), build del frontend, `cargo fmt --check` y build Tauri NSIS. |
| Triggers y publicación | `.github/workflows/release.yml` | `workflow_dispatch` (con `allow_unsigned` sólo para pruebas) + tags `v*`; en tag verifica versión contra `tauri.conf.json`, sube artefactos y crea/actualiza GitHub Release con `gh` + `SHA256SUMS.txt`. |
| Firma Authenticode condicional | `.github/workflows/release.yml` | Si existen `WINDOWS_CERTIFICATE_BASE64`/`WINDOWS_CERTIFICATE_PASSWORD`: importa el PFX, firma con `certificateThumbprint` vía `--config` temporal, exige `Get-AuthenticodeSignature = Valid` en exe e instalador y advierte si falta timestamp. Si no existen y es tag: **falla con instrucciones** (nunca publica un release sin firma). |
| Documentación de build/versionado/firma/SmartScreen | `docs/RELEASE.md` | Procedimiento local y CI, requisitos OV/EV, timestamp, secrets y variables, verificación con `Get-AuthenticodeSignature`/`signtool`, diferencia self-signed vs. real, hashes y tamaños de la release 0.2.0 actual. |
| Estado self-signed local (honesto) | `tauri.conf.json` + `docs/RELEASE.md` §4.1 | Certificado `CN=Editor IA (Self-Signed)` con thumbprint `5820…3954`: firma `Valid` sólo en la máquina que lo tiene instalado; **no** es de confianza en otras PCs y **no** evita SmartScreen. |
| Hashes medidos de la release actual | `docs/RELEASE.md` §6.1 | Exe firmado 38.971.360 B SHA-256 `4127E8C3…C3883E` (Valid, self-signed); instalador NSIS 166.227.272 B SHA-256 `29AB73E6…C5CBB2` (Valid); exe sin firmar del mismo build `445D242E…15286D` (NotSigned; +1.504 B de firma en el empaquetado). |

El workflow **no** se ejecutó desde este entorno (no hay runner de GitHub ni
certificado): se validó su YAML y su contrato de forma offline. No se commiteó
ningún secreto, clave ni ruta absoluta de una máquina personal.

### 5.2 Pendiente (bloqueo externo / requiere acción humana)

| # | Pendiente | Requiere | Estado |
|---|---|---|---|
| 1 | Comprar certificado **OV o EV** de code signing Authenticode | CA pública (identidad legal + pago + credenciales) | **BLOQUEADO (externo)** |
| 2 | Configurar secrets de firma en el repo | `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD` y URL de timestamp | PENDIENTE |
| 3 | Ejecutar un release real por tag | GitHub Actions + secrets del punto 2 | PENDIENTE (no se corre desde acá) |
| 4 | Verificar SmartScreen en Windows 11 limpio | VM sin historial + certificado real | PENDIENTE |
| 5 | Firma con EV por token/HSM o cloud | proveedor (Azure Trusted Signing, SSL.com eSigner…) + adaptar `bundle.windows.signCommand` | OPCIONAL (sólo si el cert no es PFX exportable) |
| 6 | Firma de artefactos de updater (`.sig`) | adoptar updater de Tauri + `bundle.createUpdaterArtifacts` + `TAURI_SIGNING_PRIVATE_KEY` | PENDIENTE (la app no usa el plugin updater hoy) |
| 7 | Actualizar hashes de `docs/RELEASE.md` §6.1 con el artefacto firmado real | release del punto 3 | PENDIENTE |

### 5.3 Criterio de aceptación (verificable, para cerrar el follow-up)

1. **Firma válida y de confianza:** `Get-AuthenticodeSignature` del `.exe` y del
   instalador NSIS devuelve `Status = Valid`, firmante con CA pública (no
   `Self-Signed`) y certificado dentro de fecha.
2. **Sello de tiempo:** `TimeStamperCertificate` presente en ambos artefactos y
   `signtool verify /pa /v` con código de salida 0.
3. **SmartScreen:** en una VM Windows 11 limpia (sin el certificado instalado,
   sin historial de descargas) el instalador no queda bloqueado; con OV se
   documenta el período de reputación, con EV no debe aparecer «Unknown
   publisher». Evidencia: captura de pantalla.
4. **Instalación y app:** instalación silenciosa `/S` con exit 0, la app abre, la
   versión mostrada coincide con el tag y funciona el flujo mínimo (launcher →
   abrir proyecto demo → exportar un clip corto).
5. **Integridad:** SHA-256 del instalador y del exe firmado coinciden con
   `SHA256SUMS.txt` publicado en el release.
6. **CI reproducible:** un tag `vX.Y.Z` ejecutado con los secrets configurados
   produce artefactos + GitHub Release; el workflow falla en tags sin firma
   (comportamiento ya implementado y validado offline); el repo no contiene
   secretos ni rutas absolutas.
7. **Evidencia registrada:** captura de SmartScreen, salidas de firma/hashes,
   link al run de GitHub Actions y hashes finales actualizados en
   `docs/RELEASE.md` §6.1 y en esta sección.

**Bloqueo actual:** los puntos 1–4 dependen de obtener el certificado real; no
hay certificado ni credenciales disponibles en este entorno. Hasta entonces, el
estado honesto es «release reproducible preparado y documentado; firma real
pendiente de certificado», no «app firmada».

---

## 6. Fase 1 CapCut · backend (task-16, 3 de noviembre de 2026)

Contrato publicado en `apps/desktop/src/services/project-service.ts` (+fake en
`apps/desktop/src/test/fake-service.ts`) y comandos Rust registrados. Lo que
sigue quedó **fuera** de este incremento y la UI no debe ofrecerlo todavía.

### 6.1 Proxies de vista previa (hecho)
- Rust: `commands/proxies.rs` → `proxy_status`, `ensure_proxy`, `cancel_proxy`,
  `apply_proxy_to_asset`, `cleanup_proxies`; evento `proxy-progress`.
- Cache `media/proxies/proxy-<assetId>-<quality>-<mtimeMs>-<bytes>.mp4`
  (invalidación por huella del origen), verificación FFprobe y cancelación real.
- El proxy se persiste en `asset.proxy` con `apply_proxy_to_asset` (valida
  `exists && upToDate` y guarda; devuelve `Asset | null`).
- ~~**Pendiente:** limpieza automática de proxies huérfanos~~ **HECHO
  (2026-11-07)**: `cleanup_orphan_proxies` + `cleanup_session_orphans` en
  `commands/proxies.rs` borran los `proxy-*.mp4` cuyo asset ya no existe como
  video en el proyecto; se invocan best-effort desde `close_project` y desde
  `adopt` cuando cambia la ruta de sesión. La UI de proxies ya existe
  (`ProxyToolsPanel`); `cleanup_proxies` manual sigue disponible por IPC.

### 6.2 Export avanzado (parcial)
- Hecho: `export_capabilities` (matriz real del FFmpeg empaquetado intersectada
  con lo que el worker puede emitir), `verify_export` (FFprobe: códec,
  contenedor, resolución, fps, pixel format, bitrates, color space/transfer/
  primaries, HDR detectado, duración, bytes, warnings) y
  `render-finished.verification` con ese reporte al completar.
- **Límite actual:** el worker emite **MP4/MOV H.264/H.265 + AAC** y
  **WebM VP9/AV1 + Opus** (implementado 2026-11-07: `parse_profile` valida la
  matriz del schema, `software_video_args` habla el dialecto de cada encoder
  —libvpx-vp9/libaom-av1 con `-cpu-used`+`-row-mt` y CRF con `-b:v 0`,
  libsvtav1 con presets 0-13—, Opus→`libopus` a 48 kHz, `-movflags` sólo en
  MP4/MOV, y `export_capabilities` sólo ofrece WebM si el binario tiene
  encoder VP9/AV1 **y** `libopus`). Verificado con renders reales de 1 s en
  VP9+Opus y AV1+Opus.
- **Límites del soporte WebM:** `pixelFormat` sigue fijo `yuv420p` (sin
  alpha ni 10-bit); la sonda `hardware_encoders` sólo mide H.264/H.265, así
  que VP9/AV1 van por software aunque el binario tenga `av1_*`/`vp9_qsv`
  (válidos vía `hardwareEncoder` explícito del perfil).
- **HDR:** no soportado en export (no se inyecta metadata HDR10/HLG). El reporte
  de verificación sólo *detecta* HDR en archivos existentes.
- ~~**Pendiente:** `pixelFormat` real~~ **resuelto**: `pixel_format_for`
  (`render/ffmpeg/profile.rs`) valida el `pixelFormat` del perfil contra la
  matriz real — `yuv420p` siempre, `yuv444p` sólo en WebM VP9/AV1 por
  software (los encoders de hardware y MP4/MOV lo rechazan con motivo
  honesto), `rgb24` rechazado como formato intermedio. `software_encoder_for`
  fuerza `libvpx-vp9`/`libaom-av1` para 4:4:4 porque degradarían en
  silencio. **Sonda de hardware AV1/VP9 también resuelta**:
  `render/ffmpeg/probe.rs` declara `HW_AV1`/`HW_VP9` y `hardware_encoders`
  devuelve `av1`/`vp9` con prueba funcional real (codificación lavfi de
  0,1 s por candidato, cacheada por binario).
- **HDR:** no soportado en export (no se inyecta metadata HDR10/HLG). El reporte
  de verificación sólo *detecta* HDR en archivos existentes.
- **Pendiente restante:** metadata HDR10/HLG en el plan de export (feature
  nueva: mastering display metadata + transfer characteristics en el
  contenedor) y `pixelFormat` de entrada (alpha/10-bit) en el plan de
  composición, que es otro pipeline (`render/ffmpeg/plan`).

### 6.3 Cola de render persistente (persistencia nativa v1 implementada)
- Hoy: el backend tiene **un render activo a la vez** (`start_render`,
  `cancel_render`, `active_render`, eventos `render-progress`/`render-finished`),
  sin pausa propia; la cola vive en la UI (`state/render-queue.ts`) y ahora se
  **espeja al backend**: `commands/render_queue.rs` persiste la cola como JSON en
  `%LOCALAPPDATA%\com.editoria.desktop\render-queue.json` con los mismos estados
  (`pending`/`running`/`done`/`error`/`cancelled`), el mismo tope de 50, la misma
  recuperación `running`→`pending` al cargar y tolerancia a JSON corrupto.
- IPC: `render_queue_load`, `render_queue_save`, `render_queue_clear_finished`
  (registrados en `lib.rs`). `DesktopService` expone `renderQueueLoad` /
  `renderQueueSave` / `renderQueueClearFinished`; la UI hidrata desde el backend
  cuando responde (manda sobre localStorage) y le espejo cada cambio —
  localStorage queda como respaldo en navegador y como caché offline.
- `pause_render`, `resume_render` y `move_render_queue_entry` **no existen**: pausa
  y reanudar quedan deshabilitados con motivo «la cola persistente del backend
  llega en una próxima fase». **Reordenar ya funciona**: permutar entradas
  `pending` es real sin backend (el runner drena `nextPending` en orden), así que
  `movePending` (`state/render-queue.ts`) + el botón «Reordenar» del diálogo
  intercambian las dos primeras pendientes cuando el servicio no expone
  `moveRenderQueueEntry`; si el backend lo soporta, se delega a él.
- Verificación: 5 tests cargo del módulo (roundtrip, `running`→`pending`, JSON
  corrupto, entradas basura, tope 50) + 15 tests de `render-queue` + 6 de
  ExportDialog + 18 de project-service en verde; `tsc --noEmit` limpio.
- **Pendiente:** pausa/reanudación/reorden real del lado del worker (hoy la cola
  durable es un espejo de la de la UI, no un scheduler del backend), estados
  intermedios (`paused`) y reintento automático al iniciar la app. La
  persistencia entre sesiones ya existe en dos capas (backend JSON +
  localStorage).

### 6.4 Recuperación, historial y duplicados (hecho)
- Rust: `commands/recovery.rs` → `choose_media_folder`, `find_missing_assets`,
  `relink_asset`, `relink_assets_from_folder`, `list_project_versions`,
  `restore_project_version` (in-place con copia previa / copy), y
  `find_duplicate_assets` (SHA-256 streaming).
- Snapshots en `<raíz>/.olyvia-history/<savedAtMs>-<reason>.editoria.json`,
  rotación 20; se crean antes de cada guardado (autosave con throttle 60 s) y
  antes de restaurar (`before-restore`). `RelinkFolderResult.relinked` devuelve
  `RelinkResult[]` con la ruta nueva por asset para actualizar el documento.
- Límites: relink exige el proyecto abierto (el documento se modifica y guarda);
  la validación es nombre+tamaño, y SHA-256 sólo si el asset ya lo declaraba;
  un proxy no es un origen válido de relink (es sólo previsualización).
- **Pendiente:** UI de proyectos (task-18, functional-ui); oferta de crash
  recovery sigue en StartScreen/AppShell (no se tocó).

