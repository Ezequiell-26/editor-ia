# Auditoría de funciones e IA — Olyvia (editor-ia)

**Fecha:** 3 de noviembre de 2026
**Alcance:** `apps/desktop` (React 19 + TS estricto) y `apps/desktop/src-tauri` (Rust). No se modificó código de la app: este documento es el único archivo creado.
**Método:** lectura de código con `read`/`grep`, `npx tsc --noEmit -p apps/desktop/tsconfig.json` (exit 0), cuatro archivos de test con vitest (25 tests, todos verdes), `GET http://localhost:3000` (HTTP 200) y `git status` (árbol con cambios del usuario, preservados).

## 0. Qué se pudo verificar y qué no

| Verificación | Resultado |
|---|---|
| Typecheck estricto del desktop | **Pasa** (`npx tsc --noEmit -p apps/desktop/tsconfig.json`, exit 0) |
| Tests de navegación, routing y catálogo IA | **25/25 verdes** (`navigation.test.ts`, `view-routing.test.ts`, `ai-models.test.ts`, `ai-hub.test.ts`) |
| Servidor de desarrollo | Responde **200** y sirve `apps/desktop/src/main.tsx` |
| Suite completa de vitest / `npm run verify` | **No ejecutada** (fuera del alcance pedido) |
| `cargo check` / `cargo test` / build Tauri | **No ejecutados** (no hay verificación de compilación Rust en esta sesión) |
| App nativa real (SAPI, keyring, FFmpeg, ONNX, yt-dlp, MCP) | **No verificada en ejecución**: sólo se auditó el código que la implementa |
| Navegador con interacción real | **No verificada**: sin automatización de navegador; sólo `curl` y lectura del código |
| Existencia de `app.new` | **No existe** en este repo (`Get-ChildItem -Recurse -Filter "app.new*"` devuelve vacío). El enunciado lo menciona, pero no hay tal directorio |

Una advertencia metodológica: gran parte de la evidencia son contratos y ramas de código, no comportamiento observado. Donde afirmo "funciona" quiero decir "la cadena UI → comando → implementación existe y es coherente", no que la haya ejecutado. Lo digo explícitamente en la matriz.

---

## (a) Resumen ejecutivo

Olyvia **no es un cascarón de demos**. Hay 33 vistas declaradas (`app/navigation.ts:1-84`), 15 superficies renderizadas de verdad (`App.tsx:621-683`), 18 rutas heredadas que se resuelven como alias a hubs o modos del editor (`app/view-routing.ts:20-58`), ~165 comandos Tauri registrados (`src-tauri/src/lib.rs:314-482`), 184 métodos en el contrato `DesktopService` y 164 comandos mapeados en el cliente (`services/project-service.ts:2087-2255`). El editor, medios, exportación, los siete utilitarios del Laboratorio, Descargar, Creador y MCP son código real con manejo de error y tests.

El problema no es la cantidad de funciones: es **la verificabilidad y la honestidad de los bordes**. Tres cosas dominan el diagnóstico:

1. **El modo navegador no tiene mock: es un cascarón sin datos.** `createDesktopService()` devuelve, sin runtime nativo, un servicio `available: false` donde **153 métodos lanzan una excepción** y el resto devuelve vacío (`project-service.ts:3440-3649`). El comentario es explícito: antes había un fake y se quitó porque la gente perdía proyectos (`:3637-3644`). Es una decisión correcta, pero deja el desarrollo en `localhost:3000` sin poder ejercitar **ningún** flujo de proyecto ni de IA. Si el usuario está evaluando la app en el navegador, la conclusión inevitable es "no funciona".
2. **La IA de texto está bien construida, pero su antesala está rota o es invisible.** El proveedor OpenAI-compatible (incluido Ollama/LM Studio/vLLM/llama.cpp) está implementado con validación de URL, HTTPS obligatorio para remotos, consentimiento de costo, keyring de Windows y salida JSON validada (`providers.rs:193-238, 414-576`; `assistant.rs:620-672`). El modo `mock` es honesto: devuelve `simulated: true` y plantillas, y la traducción simulada devuelve el texto original marcado (`providers.rs:915-926`). Pero **no hay botón "probar conexión"** en Ajustes, el proveedor por defecto está vacío (`state.rs:40-47,105-109`), y el usuario sólo descubre que su URL/modelo está mal cuando falla una generación.
3. **La transcripción (Whisper), que es la puerta de entrada de subtítulos, edición por texto y corte de pausas, no está empaquetada y su detección miente.** `transcribe.rs` resuelve Python desde una ruta **hardcodeada del autor** (`transcribe.rs:19-20`), y el panel de capacidades dice "Faster-Whisper empaquetado con la app" mientras `whisper_cli_available()` sólo comprueba que exista *cualquier* `python` (`background.rs:57-59`, `capabilities.rs:105-124`). En una máquina limpia el panel puede mostrar "listo" y la transcripción fallar.

### Los 10 problemas de mayor impacto

| # | Problema | Evidencia | Impacto |
|---|---|---|---|
| 1 | El modo navegador es un servicio "no disponible" (sin mock): 153 métodos lanzan excepción y las pantallas quedan sin datos. Peor: **Inicio finge preparación** con cuatro checks y tres filas en verde hardcodeadas para navegador. No hay banner global que explique el modo; sólo Ajustes, Proyectos y MCP lo dicen. | `project-service.ts:2257-2258, 3440-3649`; `HomeView.tsx:311-323, 437-470`; banners en `ProjectHome.tsx:185-190`, `SettingsHome.tsx:312-315`, `McpView.tsx:665-667` | Bloquea el desarrollo y la evaluación en navegador; el panel de estado dice "listo" cuando nada puede ejecutarse |
| 2 | Whisper no está empaquetado, la ruta de Python es del PC del autor y la detección de capacidad da falso positivo con cualquier `python`. | `transcribe.rs:18-20, 53-80, 201-206`; `background.rs:57-59`; `capabilities.rs:105-124`; `transcribe_faster.py:34-38` | Subtítulos automáticos, edición por texto, corte de pausas y asistente quedan rotos fuera de esa máquina |
| 3 | Tres CTAs de "Probar Demo" apuntan a rutas que no existen (`demo://reels-vertical`, `proyectos/demo-*.olyvia`). En la pantalla de inicio el fallo es **invisible** (no se renderiza `store.state.error`). | `StartScreen.tsx:505-519, 347-352`; `HomeView.tsx:203-212, 252-269`; `EditorWorkspace.tsx:259-302`; `projects.rs:314-321` | Primer clic del usuario nuevo termina en nada; en Inicio, sin mensaje |
| 4 | La Fábrica genera variantes con guion simulado sin comprobar `simulated`: es la única superficie que no bloquea el mock y puede renderizar MP4 con narración de plantilla. | `state/batch-factory.ts:133-154`; contraste con `ScriptView.tsx:364-367`, `LocalizationView.tsx:387-392`, `AutoEditView.tsx:361-366` | Se puede exportar contenido "IA" que en realidad es texto genérico |
| 5 | La Fábrica y el Asistente no ofrecen "probar proveedor"; no hay comando de ping ni listado de modelos. El default está vacío y el error aparece recién al generar. | `SettingsHome.tsx:330-463`; `providers.rs:109-175`; `state.rs:40-47` | Fricción alta para configurar Ollama/OpenAI; errores difíciles de diagnosticar |
| 6 | El propio servidor MCP arranca al iniciar la app con token persistente, pero **no hay UI de estado/URL/token/stop**: `mcpServerStatus()` no se llama nunca y el token sólo se ve si se le pide "iniciar MCP" al chat. | `McpBridgeRuntime.tsx:69`; `project-service.ts:1867-1868` (sin call site); `AssistantDock.tsx:1156-1175`; `mcp_server.rs:752-754, 847-871` | Superficie de seguridad y observabilidad sin control visible |
| 7 | Hay capacidades de backend sin ninguna UI: `analyze_media_frames`, `check_asset_files`, `mcp_server_status`, `inspect_flow_install`, el módulo de aislamiento de voz y `convert_media` (single). | `project-service.ts:1757, 1774, 1868`; `lib.rs:350, 332, 399, 468`; `voice-isolation.rs:75` | Funciones pagadas en complejidad que no se pueden usar; promesas del doc-comment falsas (p. ej. "el asistente puede ver los clips") |
| 8 | El AI Hub no es IA: es un compositor de prompts y un operador determinista, y su hint promete "modelos locales con tokens". AI Hub y MCP están fuera del rail (sólo paleta/Ajustes). | `AiHubView.tsx:263-300, 456-460`; `navigation.ts:75, 137-143`; `navigation.test.ts:64-65` | Expectativa vs realidad; dos superficies de IA con baja descubribilidad |
| 9 | Errores silenciosos en las antesalas de IA: `getProvider()`/`listVoices()` caen a `null`/`[]` sin motivo y la UI muestra "Proveedor no consultado". Encontré 229 apariciones de patrones de captura silenciosa (`catch {}`, `.catch(() => {})`, `.catch(() => null)`) en 85 archivos. | `AiHubView.tsx:60-73`; `ScriptView.tsx:272-297`; `CapabilitiesCard.tsx:39-43`; conteo propio | Fallos de configuración indistinguibles de "no configurado" |
| 10 | La cobertura de tests no protege los flujos clave: no hay test de que todas las `ViewId` rendericen, ni de la Fábrica con mock, ni de las vistas Localización/IA/Director/Home; el hardcode de Whisper no tiene test que lo detecte. | `App.tsx:678-679` (default `null`); `features/director`, `features/localization`, `features/ai`, `features/ai-hub`, `features/home` sin test de componente | Regresiones como las de arriba pasan el CI (typecheck + tests actuales verdes) |

**Lo bueno, para no perderlo:** el typecheck estricto pasa; el editor es real; el contrato de proveedor es seguro (HTTPS remoto, keyring, consentimiento de costo, límites de tamaño y timeout); el modo `mock` y la UI que lo bloquea son ejemplos de honestidad que el resto debería copiar; la capa MCP (cliente stdio y servidor HTTP) está bien resuelta.

---

## (b) Mapa de las 33 vistas

### Cómo se renderizan

- `NAV_VIEWS` declara 33 ids (`navigation.ts:1-84`). El rail muestra 11 (`MAIN_NAV_VIEWS`, `navigation.ts:107-119`) y "Más" muestra 8 (`SECONDARY_NAV_VIEWS`, `navigation.ts:137-143`).
- `renderView` tiene **15 casos** (`App.tsx:621-683`). Los otros **18 ids** son alias que `resolveViewRoute` normaliza antes de renderizar (`view-routing.ts:20-58`):
  - a **Descargar** (hub): `youtube`, `compliance`;
  - a **Creador** (hub): `factory`, `thumbnails`, `localization`;
  - a **Laboratorio** (hub): `convert`, `compress`, `denoise`, `sharpen`, `upscale`, `compare`, `background`;
  - al **Editor** como modo: `text-edit`, `multicam`, `mixer`, `vfx`, `motion`, `visuals`.
- Verifiqué a mano que los 33 resuelven a una de las 15 superficies renderizadas: **no hay vista muerta ni `null` en la práctica**. El `default: return null` de `App.tsx:678-679` es un riesgo latente, no un bug actual.
- Los hubs montan los componentes reales, no copias: `MediaLabView.tsx:110-158`, `CreatorHubView.tsx:83-110`, `DownloadsHubView.tsx:82-102`. Los modos del editor también: `EditorWorkspace.tsx:316-331`.

### Leyenda

- **REAL**: flujo nativo completo (UI → comando → implementación) con manejo de error.
- **PARCIAL**: funciona, pero con un límite declarado o dependencia externa/manual.
- **SOLO NATIVO**: no puede funcionar en navegador por diseño; el código lo asume.
- **HUB**: no tiene pantalla propia; renderiza otras.
- **ESTÁTICO**: sin datos externos.
- **ROTO**: una acción principal no puede funcionar como está prometida.

| Vista | Archivo principal | Estado | Entrada de datos | Evidencia | Riesgos |
|---|---|---|---|---|---|
| `home` | `features/home/HomeView.tsx` | PARCIAL | `systemInfo`, `downloaderStatus`, `extensionStatus`, `bridgeInfo` (nativo) + `localStorage` (`recents`) | `HomeView.tsx:83-101`; CTAs demo en `:203-212, 252-269`; checks de navegador en `:311-323, 437-470` | Dos demos muertas (`proyectos/demo-*.olyvia` no existen); en navegador muestra cuatro capacidades y tres filas "listo" hardcodeadas, aunque importar/exportar no pueden funcionar |
| `projects` | `features/projects/ProjectHome.tsx` | REAL (solo nativo) | Diálogos nativos `create/open/adopt` | `ProjectHome.tsx:49, 129, 185-190` | En navegador sólo muestra banner; correcto y honesto |
| `director` | `features/director/DirectorView.tsx` | REAL (heurística, no LLM) | `analyzeMedia`, `transcribeAsset`, `analyzeFaceTrack`, `exportShort`, descarga del modelo de rostros | `DirectorView.tsx:122-180, 244, 382, 423-481`; no llama a `generateScript`/`assistantChat` | Se llama "Director IA" pero decide con reglas y modelo de rostros; sin LLM. Sin test de componente |
| `auto-edit` | `features/autoedit/AutoEditView.tsx` | REAL | `analyzeMedia`, `audioPeaks`, `transcribeAsset` + `assistantChat` opcional | `AutoEditView.tsx:341-381` | La segunda opinión de IA exige proveedor real y consentimiento; correcto. Sin test de la vista completa |
| `youtube` | `features/youtube/YouTubeAnalyzerView.tsx` | REAL (solo nativo) | `analyzeYoutubeChannel` (yt-dlp) | `YouTubeAnalyzerView.tsx` (2 llamadas); `downloader.rs:601-620` | Depende del motor yt-dlp (se resuelve desde `resources/tools`); en navegador el hub no lo advierte antes de entrar |
| `production` | `features/production/ProductionView.tsx` | REAL | `synthesizeNarration`, `listVoices` (SAPI/ElevenLabs) | `ProductionView.tsx:51, 163`; `narration.rs:204-343` | En navegador la vista se ve completa pero las acciones fallan; no hay banner local |
| `factory` | `features/factory/FactoryView.tsx` | PARCIAL | `generateScript` + `synthesizeNarration` + `writeProjectVariant`/`renderProjectVariant` | `state/batch-factory.ts:133-154` | **No bloquea el proveedor simulado** (ver P0-4). Requiere imágenes ya importadas |
| `creator` | `features/creator/CreatorView.tsx` | REAL (solo nativo) | 6 comandos `creator_*` (FFmpeg, QR real con `qrcodegen`) | `CreatorView.tsx` (9 métodos); `creator.rs:8, 305-351` | Sólo nativo; una imagen/archivo inválido se reporta por error del comando |
| `editor` | `features/editor/EditorWorkspace.tsx` | REAL (con CTA roto) | Store del proyecto + FFmpeg/Preview nativo en hijos | `EditorWorkspace.tsx:316-331`; estado vacío `:259-302` | Botones "Probar Demo" con `demo://` (P0-3). El resto es el núcleo sólido |
| `text-edit` | `features/text-edit/TextEditView.tsx` | PARCIAL | `transcribeAsset` (Whisper Python externo) | `TextEditView.tsx:73-94`; `transcribe.rs:18-20` | Depende de faster-whisper instalado; sin instalador en la UI |
| `multicam` | `features/multicam/MulticamView.tsx` | REAL | `audioPeaks`, `probeMediaFile`, `mediaUrl` | `MulticamView.tsx`; `multicam-sync.ts:37-48` | Sincroniza por timecode o audio y reporta qué método usó; sin método automático queda manual (declarado en `multicam-sync.ts:195`) |
| `mixer` | `features/mixer/MixerView.tsx` | REAL | Mezcla en el documento + medición nativa | `MixerView.tsx`, `LoudnessMonitor.tsx`, `audioPeaks` | La preview no aplica loudnorm; el nivelado real ocurre al exportar (`docs/FEATURES-CHECKLIST.md:10`) |
| `vfx` | `features/vfx/VfxView.tsx` | REAL | Máscaras locales + `analyzeFaceTrack` nativo | `VfxView.tsx:73-81, 165-204` | Rotoscopía/seguimiento dependen del modelo de rostros descargado |
| `script` | `features/script/ScriptView.tsx` | REAL (IA) | `generateScript`, `saveProvider`, `synthesizeNarration` | `ScriptView.tsx:333-347, 364-367` | Requiere proveedor; el mock se marca y no se aplica como real |
| `assets` | `features/assets/AssetsPanel.tsx` | REAL (solo nativo) | `importAssets`, `importMediaPaths`, `createVideoProxy`, diálogos | `AssetsPanel.tsx` (6 métodos) | Sin nativo no hay biblioteca; los proxies son FFmpeg |
| `download` | `features/download/DownloadView.tsx` | REAL (solo nativo) | yt-dlp + FFmpeg + 25 métodos del servicio | `DownloadView.tsx` (4263 líneas); `downloader.rs:601-620` | El motor se resuelve desde `resources/tools` y se copia a la carpeta gestionada; si falta, la vista explica cómo instalarlo (`DownloadView.tsx:2182`) |
| `compliance` | `features/compliance/ComplianceView.tsx` | REAL | `fetchPlatformRules` (GitHub raw) + packs locales | `ComplianceView.tsx:147`; `rules.rs:11-12` | La actualización depende de un repo personal (`Ezequiell-26/editor-ia`); offline quedan los packs locales |
| `convert` | `features/convert/ConvertView.tsx` | REAL (solo nativo) | `convertMediaBatch`, `mergeVideos`, `trimVideo`, `watermarkVideo`, `setMetadata` | `ConvertView.tsx:169-229` | Sólo nativo; los errores del comando se muestran |
| `compare` | `features/compare/CompareView.tsx` | REAL | `absoluteFileUrl`, `chooseImageFile` + cola local `pending.ts` | `CompareView.tsx`, `BeforeAfterSlider.tsx` | Compara imágenes sueltas; no hay comparación de video A/B |
| `compress` | `features/compress/CompressView.tsx` | REAL (solo nativo) | `chooseVideoFile`, `probeMediaFile`, `compressAnyFile`, `measureVmaf` | `CompressView.tsx:45-95` | VMAF depende de un FFmpeg con libvmaf (se informa) |
| `denoise` | `features/denoise/DenoiseView.tsx` | REAL (solo nativo) | `denoiseMedia`, `enhanceDialogue`, `importMediaPaths` | `DenoiseView.tsx` (10 métodos); `denoise.ts` | Sin test de componente; el presets y el render viven en `denoise.ts`, no en la vista |
| `sharpen` | `features/sharpen/SharpenView.tsx` | REAL (solo nativo) | `sharpenMedia`, `probeMediaFile`, `importMediaPaths` | `SharpenView.tsx` (8 métodos) | Cadena de 5 etapas; sin verificación visual automática |
| `thumbnails` | `features/thumbnails/ThumbnailView.tsx` | REAL (solo nativo) | Canvas + `pickThumbnailFrames` + `saveThumbnail` | `ThumbnailView.tsx` (7 métodos) | Sin test de componente; exporta PNG por comando nativo |
| `localization` | `features/localization/LocalizationView.tsx` | PARCIAL (IA + externos) | `translateSubtitles` (IA), `synthesizeDub` (SAPI), `cloneVoice`/`lipSync` (engines externos en localhost) | `LocalizationView.tsx:249-258, 330, 387-392, 463, 511, 554, 90-103` | Clonación y lip-sync requieren servidores Python externos (`scripts/lipsync-engine` existe; el de XTTS/SovITS no); la UI lo permite sin guía |
| `ai-hub` | `features/ai-hub/AiHubView.tsx` | PARCIAL (no es IA) | `getProvider` (nativo) + `localStorage` para briefs; operador local | `AiHubView.tsx:60-73, 91-118, 263-300, 456-460` | No llama a ningún modelo; el hint promete "modelos locales con tokens"; fuera del rail |
| `motion` | `features/motion/MotionView.tsx` | REAL (IA) | `generateMotion` (LLM) + render Lottie local | `MotionView.tsx:74-92`; `motion_ai.rs:153-191, 214-215` | Requiere proveedor para la sugerencia; sin él se usan plantillas manuales |
| `visuals` | `features/visuals/VisualsView.tsx` | REAL | `auditVisuals` + catálogo de efectos/transiciones | `VisualsView.tsx`; `visuals.rs` | Sin test de componente; auditoría sólo reporta, no corrige |
| `background` | `features/ai/RemoveBackgroundView.tsx` | PARCIAL (on-device) | `removeBackground` + `chooseImageFile` | `RemoveBackgroundView.tsx:37-49`; `background.rs:121-173, 297-308` | Requiere modelo descargado y `onnxruntime.dll`; la vista no lo verifica antes de ejecutar |
| `upscale` | `features/ai/UpscaleView.tsx` | PARCIAL (on-device) | `upscaleImage` + `chooseImageFile` | `UpscaleView.tsx:37-49`; `upscale.rs:96-105` | Ídem: error recién al ejecutar; límite 2048 px declarado |
| `lab` | `features/lab/MediaLabView.tsx` | HUB | Renderiza 7 vistas | `MediaLabView.tsx:29-158` | Ninguno propio |
| `learn` | `features/learn/LearnView.tsx` | ESTÁTICO | Contenido y atajos embebidos | `LearnView.tsx:23-230` | Puede quedar desactualizado respecto de la app (no se genera) |
| `mcp` | `features/mcp/McpView.tsx` | REAL (solo nativo) | `listMcpServers`, `probeMcpServer`, `callMcpTool`, sesiones, Flow | `McpView.tsx:219-266, 332-390`; `mcp.rs` | El servidor propio no tiene panel (P1); Flow exige instalar un MCP de terceros a mano |
| `settings` | `features/settings/SettingsHome.tsx` | REAL | `saveProvider`, `clearProviderKey`, `systemInfo`, `chooseTool` | `SettingsHome.tsx:316-466` | No hay "probar proveedor"; el estado de capacidades puede mentir (P0-2) |

---

## (c) Matriz de IA y capacidades

Estados: **FUNCIONA** (cadena completa, no ejecutada en esta sesión), **MOCK HONESTO**, **SOLO NATIVO**, **EXTERNO** (requiere servicio/software de terceros), **BACKEND SIN UI**, **NO IMPLEMENTADO**.

| Capacidad | Backend / comando | Estado real | Dónde se usa | Evidencia | Nota |
|---|---|---|---|---|---|
| Chat de texto del asistente | `assistant_chat` → `/chat/completions` | FUNCIONA (nativo) | `AssistantDock.tsx:1574` | `assistant.rs:620-672`; `providers.rs:240-247` | Contrato JSON propio; sin function calling nativo |
| Proveedor simulado | `kind = "mock"` | MOCK HONESTO | Asistente, Guion, Efecto, Motion, Traducción | `assistant.rs:383-441`; `providers.rs:442-444, 915-926`; `motion_ai.rs:153-191` | Devuelve `simulated: true`; la traducción devuelve el original |
| Consentimiento de costo | `approved_cost` | FUNCIONA | Asistente, Guion, Traducción, Efecto, Motion, match | `providers.rs:452-458, 662-667, 949-955`; `assistant.rs:638-644` | Sólo remotos; loopback exento |
| Guion por brief | `generate_script` | FUNCIONA | Guion, Fábrica, orquestador MCP | `providers.rs:414-576`; `ScriptView.tsx:364`; `batch-factory.ts:139` | Valida 1..30 escenas y JSON; mock entrega plantillas |
| Efecto visual por prompt | `generate_video_effect` | FUNCIONA | Inspector | `providers.rs:630-759`; `Inspector.tsx:1118-1128` | Parámetros clampeados; `simulated` se muestra |
| Motion por prompt | `generate_motion` | FUNCIONA | Motion | `motion_ai.rs:194-353`; `MotionView.tsx:74-92` | Mock honesto y rotulado en UI |
| Traducción de subtítulos (8 idiomas) | `translate_subtitles` | FUNCIONA | Localización, Descargar | `providers.rs:928-1066`; `LocalizationView.tsx:330`; `DownloadView.tsx:1046` | Exige misma cantidad de cues; bloquea export simulado (`LocalizationView.tsx:387-392`) |
| Emparejar frases ↔ imágenes | `match_media_plan` | FUNCIONA (sin mock) | Asistente (`media_folder`) | `assistant.rs:738-830`; `AssistantDock.tsx:419` | Rechaza mock explícitamente (`assistant.rs:774-779`) |
| Análisis de imágenes | `analyze_images` | FUNCIONA (nativo) | Asistente | `image_sense.rs` (registrado en `lib.rs:349`); `AssistantDock.tsx:396` | Métricas reales (luz, color, rostros) |
| Análisis de cuadros de video | `analyze_media_frames` | **BACKEND SIN UI** | Ninguna | `lib.rs:350`; `project-service.ts:1757, 2104`; sin call sites | El doc-comment promete que el asistente "ve" los clips; no ocurre |
| Detección de faltantes de medios | `check_asset_files` | **BACKEND SIN UI** | Ninguna | `project-service.ts:1774`; `lib.rs:332`; sin call sites | No hay verificación de medios perdidos al abrir |
| Transcripción (Whisper) | `transcribe_asset` + Python externo | SOLO NATIVO + EXTERNO | Texto, Director, Auto-Edit, Asistente, Inspector | `transcribe.rs:18-20, 53-80, 201-257`; `transcribe_faster.py:34-38` | Requiere faster-whisper; el modelo se baja de HuggingFace en el primer uso |
| Diarización (hablantes) | `diarize_audio` | EXTERNO | Inspector (`SpeakersSection`) | `diarize.rs:4-24, 90-106` | Deepgram/AssemblyAI con clave; no local |
| TTS SAPI | `synthesize_narration` + PowerShell | FUNCIONA (Windows) | Producción, Guion, Fábrica, Doblaje | `narration.rs:23-32, 204-343` | Texto por stdin; audita licencia como "unknown" |
| TTS ElevenLabs | `synthesize_narration` (kind elevenlabs) | FUNCIONA con clave | Producción, Guion | `audio_providers.rs:23-30, 77-80` | Endpoint fijo; clave en keyring |
| TTS web externo | `kind = "external-web"` | NO IMPLEMENTADO (manual) | Ajustes → Voz | `narration.rs:233-238`; `audio_providers.rs:1-8` | Devuelve error que pide generar y descargar a mano |
| Piper (TTS neuronal local) | `commands/piper.rs` | FUNCIONA (pero sólo descargas) | Pipeline de `download_media` | `downloader.rs:3499, 4157, 5409`; recursos `resources/piper` | Existe y está empaquetado, pero no se ofrece en narración |
| Doblaje | `synthesize_dub` | FUNCIONA (nativo) | Localización | `dubbing.rs`; `LocalizationView.tsx:463` | SAPI + FFmpeg; reemplaza/mezcla audio original |
| Clonación de voz | `clone_voice` | EXTERNO (manual) | Localización | `voice_clone.rs`; `LocalizationView.tsx:90-91, 511` | Requiere engine en `127.0.0.1:8020/9880`; no hay instalador |
| Lip-sync | `lip_sync` | EXTERNO (manual) | Localización | `lip_sync.rs`; `LocalizationView.tsx:102-103, 554` | Requiere engine en `127.0.0.1:8765/lipsync`; `scripts/lipsync-engine` existe |
| Quitar fondo (u2netp) | `remove_background` + ONNX | FUNCIONA con modelo + DLL | Laboratorio → Fondo | `background.rs:39-59, 121-173, 297-308`; `models.rs:56-73` | Sin pre-check en la vista; el error manda a Ajustes |
| Upscale ×4 (Real-ESRGAN) | `upscale_image` + ONNX | FUNCIONA con modelo + DLL | Laboratorio → Upscale | `upscale.rs:19-24, 96-105`; `models.rs:74-98` | Ídem; tope 2048 px |
| Detección de rostros (SeetaFace) | `analyze_face_track` + rustface | FUNCIONA con modelo | Director (shorts), VFX, Inspector | `models.rs:99-115`; `face.rs`; `DirectorView.tsx:382` | Modelo se descarga desde Ajustes o desde Director |
| Servidor MCP propio (para agentes externos) | `start_mcp_server` HTTP 127.0.0.1 + Bearer | FUNCIONA (sin UI) | Ninguna pantalla | `mcp_server.rs:145, 752-754, 847-871`; `McpBridgeRuntime.tsx:69` | 25 herramientas expuestas; token persistente en keyring |
| Cliente MCP (servidores externos) | `probe/call_mcp_server` stdio JSON-RPC | FUNCIONA (nativo) | MCP | `mcp.rs:1-20, 50-58, 496-530` | Keyring para env, kill del árbol, sesiones con idle 10 min |
| Flow (Google) | Servidor MCP de terceros | EXTERNO (manual) | MCP, Fábrica/Autopilot | `McpView.tsx:263-390`; `state/flow.ts:1-161` | No hay API oficial; hay que instalar `google-flow-mcp` y escribir la ruta |
| Visión de calidad / auditoría visual | `audit_visuals` | FUNCIONA (nativo) | Visuals | `visuals.rs`; `VisualsView.tsx` | Reporta hallazgos, no corrige |
| Cerebro de edición | `state/brain/*` | FUNCIONA (determinista, no IA generativa) | Editor → modo Cerebro; contexto del asistente | `state/brain/index.ts:1-7`; `BrainPanel.tsx:54-60` | Mide y propone; aplica con las primitivas existentes |
| Operador local | `features/ai-hub/operator.ts` | FUNCIONA (determinista) | AI Hub y asistente (comandos rápidos) | `operator.ts:664`; `AiHubView.tsx:120-249` | "Sin tokens", no es un modelo |
| Director automático | `features/director` | FUNCIONA (heurística + rostros) | Director | `DirectorView.tsx` (sin llamadas LLM) | Nombre "IA" sobrepromete |
| Generación de imágenes/video con IA | — | NO EXISTE | — | — | Sólo vía Flow MCP externo; la app no genera medios |

### c.1 La IA de texto: qué está bien y qué falta

**Bien:**
- Un único contrato OpenAI-compatible con URL base + modelo libres (`ai-models.ts:1-10, 48-240`), pensado para Ollama/LM Studio/vLLM/llama.cpp con loopback exento de clave y de consentimiento (`providers.rs:193-204, 452`).
- Validación de seguridad del endpoint: http sólo loopback, https para remotos, sin userinfo, host obligatorio (`providers.rs:206-238`); la misma regla existe en el cliente (`project-service.ts:2294-2326`).
- Salida del modelo tratada como no confiable: `extract_json`, límites de tamaño (2 MB), clamping de parámetros y cantidades acotadas (`providers.rs:281-345, 531-568, 597-628`).
- El asistente revalida acciones en el frontend y ejecuta sólo un allowlist (`assistant.rs:28-62, 163-374`; `AssistantDock.tsx:1589-1621`), con confirmación para borrado y MCP destructivo (`AssistantDock.tsx:1308-1358, 1590-1607`).
- La UI muestra el estado del proveedor: chip "simulado/local/remoto" (`AssistantDock.tsx:1720-1737`), marca de modelo (`AiBrandMark`), error visible (`:1751-1755`) y enlace "Configurar proveedor" (`:1877-1885`).

**Falta / duele:**
- **No hay prueba de conexión.** Ajustes guarda y ya (`SettingsHome.tsx:330-463`); no hay comando `test_provider` ni `GET /models`. Un error de modelo o de URL se descubre al generar, con mensajes HTTP genéricos (`providers.rs:516-523`).
- **Default vacío** (`state.rs:40-47, 105-109`): primer arranque con `kind=openai-compatible`, `baseUrl=""`, `model=""`. El asistente existe pero cualquier mensaje libre devuelve "configurá un proveedor…" (`assistant.rs:631-636`). El enlace a Ajustes está, pero no hay onboarding.
- **Sin function calling nativo:** las 83 herramientas MCP viajan como catálogo JSON en el prompt (`AssistantDock.tsx:1555-1568`; `assistant.rs:453-494`). Modelos chicos suelen fallar el formato; el sistema tolera fallo (cae a texto) pero pierde acciones (`assistant.rs:567-577`).
- **El catálogo se descarta en silencio** si serializa a más de 48 KB (`assistant.rs:588-593`). El archivo fuente del catálogo pesa 37 KB (`state/mcp-catalog.ts`); no medí el payload serializado (nombre + descripción recortada a 220 + `inputSchema` + anotaciones), pero es del mismo orden. Al agregar herramientas, el modelo puede quedarse sin catálogo y sin aviso.
- Sin streaming y timeout fijo de 120 s (`providers.rs:489`, `assistant.rs`): con modelos locales grandes la espera puede parecer un cuelgue.
- `match_media_plan` no tiene modo mock ni fallback de UI: si el proveedor es mock, el flujo de carpeta del asistente falla con un error (`assistant.rs:774-779`).

### c.2 Voz (TTS): tres motores, uno visible

- **SAPI** es el camino real y gratis: script PowerShell embebido, texto por stdin, salida WAV medida con ffprobe y asset generado con licencia "unknown" (`narration.rs:23-32, 277-329`). Funciona sólo en Windows con PowerShell (`:194-199, 257-263`).
- **ElevenLabs** es real, con clave en keyring y endpoint fijo (`audio_providers.rs:23-30`), pero la UI no muestra consumo ni límites; el costo lo cobra el proveedor.
- **"Web externa"** no está implementado: devuelve un error que explica el trabajo manual (`narration.rs:233-238`). Es honesto pero no es una función.
- **Piper** está empaquetado (`resources/piper`) y se usa para el pipeline de descargas (`downloader.rs:3499, 5409`), pero **no se ofrece en Producción/Guion**, donde SAPI es la única voz local. Es una capacidad ya pagada (binario + datos) con superficie mínima.

### c.3 Modelos on-device

- Hay un gestor real de pesos con SHA-256, licencia declarada y descarga con progreso (`models.rs:21-116, 134-141`; `CapabilitiesCard.tsx:50-94`). Tres modelos: `u2netp` (recorte), `real-esrgan-x4plus` (upscale), `seeta-face` (rostros).
- La inferencia es real: ONNX Runtime cargado desde `onnxruntime.dll` junto al exe o `ORT_DYLIB_PATH` (`background.rs:39-53`; `upscale.rs:28-52`), u2netp a 320×320 con normalización ImageNet (`background.rs:27-35`) y Real-ESRGAN por teselas 128 con padding 10 y tope 2048 (`upscale.rs:19-24`).
- **Fricción:** las vistas de Fondo y Upscale no comprueban modelo/DLL antes de ejecutar; el usuario descubre el requisito con un error que apunta a Ajustes → Capacidades (`background.rs:301-306`; `upscale.rs:101`). En un producto "local-first" esa descarga debería ofrecerse desde la propia vista.
- `list_capabilities` informa por modelo y por motor (`capabilities.rs:54-94`), pero la detección de Whisper es falsa (ver P0-2) y el TTS se considera "disponible" sólo por existir `C:\Windows\System32\Speech` (`capabilities.rs:127-146`), sin comprobar voces instaladas.

### c.4 MCP: lo mejor y lo invisible

- **Cliente**: proceso stdio con handshake `initialize`, timeouts por etapa, variables de entorno en keyring, cierre del árbol de procesos con `taskkill /T` y sesiones reutilizables con idle de 10 min y máximo 3 (`mcp.rs:1-20, 50-58, 496-530`). La UI permite alta, prueba, llamada, sesión y catálogo de herramientas (`McpView.tsx:219-390`).
- **Servidor propio**: HTTP en `127.0.0.1` con Bearer token persistente en keyring y 25 herramientas (`mcp_server.rs:145, 752-754, 847-871`). El runtime se monta siempre en la app nativa (`McpBridgeRuntime.tsx:69`) y ejecuta las herramientas en el frontend con cola de escritura (`:40-63`).
- **Huecos**: no hay pantalla de estado (URL, token enmascarado, cliente conectado, stop). `mcpServerStatus()` existe en el contrato y **no se usa** (`project-service.ts:1867-1868`). El token sólo aparece si el usuario pide "iniciar MCP" al chat (`AssistantDock.tsx:1156-1175`). Además `inspect_flow_install` está registrado pero no se llama (`lib.rs:399`), así que la configuración de Flow se hace escribiendo una ruta a mano (`McpView.tsx:277-290`).
- **Duplicación**: hay dos catálogos, el de Rust (`mcp_server.rs:145+`, 25 herramientas) y el de TS (`state/mcp-catalog.ts`, 83). Verifiqué que todo nombre expuesto por Rust existe en TS; los 58 restantes son internos. No es un bug hoy, pero es deuda de una sola fuente de verdad.

### c.5 Qué NO es IA (y se presenta como tal)

| Superficie | Qué es en realidad | Evidencia |
|---|---|---|
| AI Hub | Compositor de prompts + operador local determinista; no hay llamada a modelo | `AiHubView.tsx:296-299, 456-460` |
| Operador del asistente (comandos rápidos) | Parser determinista de intenciones | `operator.ts:664`; `AssistantDock.tsx:1519-1539` |
| Cerebro de edición | Análisis determinista de la timeline | `state/brain/index.ts:1-7` |
| Director "IA" | Heurísticas + modelo local de rostros; sin LLM | `DirectorView.tsx` (sin `generateScript`/`assistantChat`) |
| Auto-Edit | Cortes por análisis local; LLM sólo como segunda opinión opcional | `AutoEditView.tsx:341-381` |

Esto no es necesariamente malo: son funciones útiles y baratas. El problema es de **etiquetado**: el hint de navegación de AI Hub dice "modelos locales con tokens" (`navigation.ts:75`) y el rail lo esconde (`navigation.ts:137-143`), mientras Director se llama "Director IA" sin serlo.

### c.6 Contraste de honestidad del modo simulado

| Superficie | ¿Bloquea o rotula el mock? | Evidencia |
|---|---|---|
| Guion | Sí: aviso y no aplica | `ScriptView.tsx:364-367` |
| Localización | Sí: impide exportar traducción simulada | `LocalizationView.tsx:387-392` |
| Asistente | Sí: respuesta del mock es explícita | `assistant.rs:383-441` |
| Auto-Edit (segunda opinión) | Sí: no aplica y avisa | `AutoEditView.tsx:361-366` |
| Motion | Sí: rotula "Sugerencia simulada" | `MotionView.tsx:89` |
| Inspector (efecto) | Sí: agrega "(simulado)" al aviso | `Inspector.tsx:1128` |
| Descargar (traducción) | Sí: conserva el SRT original y avisa | `DownloadView.tsx:1060` |
| **Fábrica** | **No** | `batch-factory.ts:133-154` (sin referencia a `simulated`) |

---

## (d) Mejoras priorizadas

### P0 — bloquean la promesa "todo funciona / la IA funciona"

**P0-1. Modo navegador explícito y honesto, con demo de sólo lectura.**
- Archivo objetivo: `apps/desktop/src/services/project-service.ts` (+ nuevo `services/browser-service.ts`), `apps/desktop/src/components/AppShell.tsx`, `apps/desktop/src/features/home/HomeView.tsx`.
- Cambio: mantener `available: false` (no volver al fake que perdía proyectos), pero (a) un banner persistente en el shell que explique el modo y qué se puede probar; (b) un servicio de demo en memoria sólo si se pide explícitamente (`?demo=1` o "Abrir demo"), con cartel "nada se guarda"; (c) reemplazar los checks verdes hardcodeados de Inicio por "no medido en navegador"; (d) todas las vistas que hoy fallan por excepción deben mostrar ese motivo.
- Aceptación verificable: `?view=editor` en navegador muestra el banner y el editor abre un proyecto demo con timeline; Inicio no muestra ninguna fila "listo" que dependa de FFmpeg/yt-dlp; `browser-service.test.ts` verifica que ningún método lanza una excepción no traducida a un mensaje con `NATIVE_UNAVAILABLE_REASON`; `npx tsc` y vitest verdes.

**P0-2. Transcripción: empaquetado real o detección honesta.**
- Archivos objetivo: `src-tauri/src/commands/transcribe.rs`, `commands/capabilities.rs`, `commands/background.rs`, `features/settings/CapabilitiesCard.tsx`.
- Cambio: eliminar la ruta hardcodeada (`transcribe.rs:19-20`); resolver sólo `EDITORIA_WHISPER_PYTHON` o un Python del que se **verifique** `faster_whisper` (probar `-c "import faster_whisper"`); si no, capacidad "no disponible" con instrucciones; documentar la ruta del engine y el modelo; opcional: instalar/empaquetar el engine.
- Aceptación verificable: en una máquina sin faster-whisper, `list_capabilities` devuelve `transcribe.available=false` con motivo accionable; `grep -R "ofici" apps/desktop/src-tauri/src` devuelve 0; test Rust de `probe_python` con un ejecutable falso que no importa el módulo.

**P0-3. Eliminar o implementar las demos muertas y no perder el error en Inicio.**
- Archivos objetivo: `features/start/StartScreen.tsx`, `features/home/HomeView.tsx`, `features/editor/EditorWorkspace.tsx`.
- Cambio: o se elimina el CTA o se crea un proyecto demo real (generado con `createProject` + assets de ejemplo). Además, `StartScreen` debe renderizar `store.state.error` (hoy sólo muestra su validación local, `:887-890`) y `HomeView` debe mostrar el motivo cuando `openProjectAt` falla.
- Aceptación verificable: `grep -R "demo://" apps/desktop/src` = 0; test de `StartScreen` con un servicio que falla al abrir muestra `role="alert"`; sin rutas `proyectos/demo-*` en el código.

**P0-4. La Fábrica no debe generar con proveedor simulado.**
- Archivos objetivo: `state/batch-factory.ts`, `features/factory/FactoryView.tsx`.
- Cambio: antes de escribir variantes, rechazar `ScriptPlan.simulated` (o exigir confirmación explícita "usar guion de plantilla") y mostrar el estado del proveedor en el formulario, igual que Guion/Localización.
- Aceptación verificable: test en `batch-factory.test.ts` con un plan `simulated: true` que espera error y cero archivos escritos; test de `FactoryView` que ve el aviso y el botón deshabilitado.

**P0-5. "Probar conexión" del proveedor de IA y recuperación del error.**
- Archivos objetivo: `src-tauri/src/commands/providers.rs` (nuevo `test_provider`), `features/settings/SettingsHome.tsx` (sección IA), `features/assistant/AssistantDock.tsx`.
- Cambio: comando que consulta `GET {base}/models` o hace un chat mínimo con timeout corto y devuelve modelo/latencia/HTTP; botón en Ajustes; en el error del asistente, botón "Probar proveedor" y "Abrir Ajustes".
- Aceptación verificable: test Rust con un servidor HTTP local de prueba (o función pura de armado/parseo) que distingue 401, 404, timeout y éxito; prueba manual con Ollama levantado y apagado; el error del asistente incluye acción.

### P1 — impacto alto, no bloqueante

1. **Panel de estado del servidor MCP** (`features/mcp/McpView.tsx`): usar `mcpServerStatus()`, mostrar URL, token enmascarado, copiar configuración, estado y stop/restart. Aceptación: test con servicio fake; el token nunca se muestra completo sin acción explícita.
2. **AI Hub honesto y descubrible**: cambiar el hint (`navigation.ts:75`) a "prompts, briefs y operador local"; agregar AI Hub y MCP a "Más" (`SECONDARY_NAV_VIEWS`) o a un grupo "IA" del rail; si no habrá chat, que el CTA "Copiar prompt" sea el principal. Aceptación: test de navegación que exija entrada visible y hint sin "modelos".
3. **Superficies para el backend huérfano**: (a) mostrar `analyze_media_frames` en el asistente para "mirar" clips; (b) `check_asset_files` al abrir proyecto con banner de medios faltantes; (c) borrar `inspect_flow_install` o usarlo en el alta de Flow; (d) borrar `voice-isolation.rs` o registrarlo con UI. Aceptación: cero métodos del contrato sin call site (`grep` automatizable) y test de cada flujo.
4. **Pre-check de modelos on-device** (`RemoveBackgroundView.tsx`, `UpscaleView.tsx`): consultar `listModels()` y ofrecer "Descargar modelo" en la propia vista; mostrar requisito de `onnxruntime.dll`. Aceptación: test de componente con modelo ausente (botón de descarga, no error).
5. **Contrato `simulated` único**: extraer un helper compartido y aplicarlo en todas las superficies; test que falle si una vista que llama a un generador no referencia `simulated`.
6. **Catálogo MCP con degradación explícita** (`assistant.rs:588-593`): si supera 48 KB, recortar por herramienta (no descartar todo) y avisar en el contexto; test unitario con un catálogo grande.
7. **`response_format`/reintento JSON** en `generate_script`, `assistant_chat` y `translate_subtitles`: pedir `{"type":"json_object"}` cuando el endpoint lo soporte y reintentar una vez con reparación; mejora directa de fiabilidad con modelos locales.
8. **Tests de los flujos IA que hoy no tienen**: `FactoryView` con mock, `LocalizationView` (bloqueo de export simulado), `AiHubView` (brief y navegación), `RemoveBackgroundView`/`UpscaleView` (modelo ausente), `DirectorView` (plan y shorts con servicio fake). Aceptación: cada archivo nuevo cubre un camino feliz y uno de error.
9. **Director**: renombrar el hint a "Director local · análisis, cortes y shorts" o explicar en la UI que usa análisis y rostros, no un LLM. Aceptación: texto de la vista y hint coherentes; sin "IA" en el hint si no hay LLM.
10. **Errores de antesala de IA con motivo y reintento** (`AiHubView.tsx:60-73`, `ScriptView.tsx:272-297`, `CapabilitiesCard.tsx:39-43`): guardar `{provider, error}` y mostrar "no se pudo leer el proveedor: <motivo>" con reintento.

### P2 — deuda y calidad

1. **Consolidar los lazy loaders de `App.tsx`**: 18 de los 32 loaders de `VIEW_PRELOADERS` nunca se usan porque `preloadViews` sólo recorre `PRIMARY_PRELOADS` (`App.tsx:163-239`); además duplican los imports dinámicos de los hubs.
2. **Eliminar componentes demo muertos** (ver sección f).
3. **Limpiar `capabilities.rs`**: parámetro `state` sin uso y `let _ = state;` (`:106-129`), y comprobar voces SAPI reales en vez de sólo la carpeta.
4. **`convert_media` (single) sin uso**: o se usa desde Convertir para un archivo, o se elimina del contrato (`project-service.ts:1789`).
5. **URL de reglas atada a un repo personal** (`rules.rs:11-12`): mover a configuración o documentar que la actualización es best-effort.
6. **Prueba de humo de rutas**: test que, para cada `ViewId`, `resolveViewRoute(id).view` esté entre los casos de `renderView` (evita el `null` silencioso).
7. **`README`/`TUTORIAL`**: documentar que la app nativa es requisito para IA local, que Whisper necesita engine y que "local" no significa "sin instalar nada".
8. **Logs `.tmp-*` y `build*.log` en la raíz**: ruido de más de 100 archivos; mover a `tmp/` o borrar los que ya no se usan (fuera de esta auditoría).

---

## (e) Quick wins seguros (bajo riesgo, alto retorno)

| # | Cambio | Archivo | Por qué es seguro |
|---|---|---|---|
| 1 | Ocultar los tres CTAs de demo detrás de un flag o eliminarlos | `StartScreen.tsx:505-519`, `HomeView.tsx:252-269`, `EditorWorkspace.tsx:270-284` | Son botones que hoy no pueden funcionar; no hay lógica que dependa de ellos |
| 2 | Mostrar `store.state.error` en `StartScreen` | `StartScreen.tsx:887-890` | Sólo agrega un banner; cubre también fallos nativos de creación |
| 3 | Cambiar el hint de AI Hub | `navigation.ts:75` | Texto; el test `navigation.test.ts` no valida hints |
| 4 | Agregar AI Hub y MCP a "Más" | `navigation.ts:137-143` | Cambia sólo el menú; hay que actualizar `navigation.test.ts:64-65` |
| 5 | Pre-check de modelo en Fondo/Upscale con botón "Descargar" | `features/ai/*.tsx` | Reutiliza `listModels`/`downloadModel` ya existentes |
| 6 | Chip "proveedor simulado" en la Fábrica | `FactoryView.tsx` | Sólo lectura de `provider.kind` |
| 7 | Borrar el módulo de aislamiento de voz no registrado | `voice-isolation.rs`, `mod.rs` | No está en el handler ni lo llama nadie |
| 8 | Borrar los 7 componentes demo y `pages/ButtonGallery.tsx` | `components/*Demo*.tsx`, `pages/ButtonGallery.tsx` | Cero imports (verificado por grep) |
| 9 | `default` de `renderView` con `console.warn` y test de cobertura | `App.tsx:678-679` | No cambia comportamiento; hace visible una regresión futura |
| 10 | Quitar `// TODO: Implementar voz isolation` y la línea comentada | `lib.rs:468` | Sólo comentario; evita falsa expectativa |
| 11 | Reemplazar los checks verdes de navegador por "no medido" | `HomeView.tsx:311-323, 437-470` | Sólo cambia el estado visual de filas que en navegador no miden nada |

---

## (f) Archivos duplicados o muertos (candidatos a limpieza)

| Archivo | Estado | Evidencia |
|---|---|---|
| `apps/desktop/src/components/ButtonDemo.tsx` | Muerto | Sólo se define; sin imports |
| `apps/desktop/src/components/PremiumAuthDemo.tsx` | Muerto | Ídem |
| `apps/desktop/src/components/PremiumCardDemo.tsx` | Muerto | Ídem |
| `apps/desktop/src/components/PremiumInputDemo.tsx` | Muerto | Ídem |
| `apps/desktop/src/components/PremiumShowcase.tsx` | Muerto | Ídem |
| `apps/desktop/src/components/PremiumComponentShowcase.tsx` | Muerto | Ídem |
| `apps/desktop/src/pages/ButtonGallery.tsx` | Muerto | Sin imports; `pages/` sólo lo contiene a él |
| `apps/desktop/src-tauri/src/commands/voice-isolation.rs` | Muerto/no registrado | `isolate_voice` es `pub fn` sin `#[tauri::command]` (`:75`); handler comentado (`lib.rs:468`); sin referencias desde `ffmpeg.rs` |
| 18 loaders de `App.tsx` (`loadYouTube`, `loadFactory`, `loadConvert`, `loadCompare`, `loadCompress`, `loadDenoise`, `loadSharpen`, `loadThumbnails`, `loadLocalization`, `loadMotion`, `loadVisuals`, `loadBackground`, `loadUpscale`, `loadTextEdit`, `loadMulticam`, `loadMixer`, `loadVfx`, `loadCompliance`) | Código muerto (precarga inalcanzable) | `VIEW_PRELOADERS` sólo se recorre con `PRIMARY_PRELOADS` (4 ids) en `App.tsx:204-239` |
| Duplicación de lazy imports de los hubs | Deuda | `App.tsx:90-145` y `MediaLabView.tsx:5-27`, `CreatorHubView.tsx:5-18`, `DownloadsHubView.tsx:5-17` cargan los mismos módulos |
| `DesktopService.convertMedia` | Sin UI | `project-service.ts:1789`; sólo batch se usa |
| `DesktopService.analyzeMediaFrames` | Sin UI | `project-service.ts:1757`; doc promete visión de clips |
| `DesktopService.checkAssetFiles` | Sin UI | `project-service.ts:1774` |
| `DesktopService.mcpServerStatus` | Sin UI | `project-service.ts:1868` |
| Comando `inspect_flow_install` | Registrado sin caller | `lib.rs:399`; sin referencias en `src` |
| `docs/AUDIT.md`, `MEJORAS-PREMIUM.md`, `SISTEMA-COMPLETO-UX.md` | Posible solapamiento | No los evalué en profundidad; conviene consolidar el estado en `docs/FEATURES-CHECKLIST.md` |
| Raíz: `.tmp-*` (~100 archivos), `build*.log`, `cargo-*.log` | Ruido | No es código; fuera del alcance, pero entorpece la revisión |

**No son duplicados** (aunque lo parezcan): `features/brain` (UI) y `state/brain` (lógica) tienen capas distintas; `features/ai-hub/ai-hub.ts` (catálogo de skills) y `operator.ts` (parser) son módulos distintos; `features/mcp/FlowQueueCard` y `state/flow-queue` separan UI y estado.

---

## (g) Qué no se puede verificar en navegador y cómo verificarlo en la app nativa

El navegador no puede: acceder a archivos, lanzar FFmpeg/PowerShell/Python, usar el keyring, cargar ONNX, abrir diálogos, spawnear MCP, escribir proyectos ni renderizar. En el código, esas llamadas lanzan `NATIVE_UNAVAILABLE_REASON` (`project-service.ts:2257-2258`) o devuelven vacío; además, Inicio muestra un panel de capacidades de navegador con checks en verde (`HomeView.tsx:311-323, 437-470`) que no miden nada del sistema.

| Flujo | Por qué no se puede en navegador | Cómo verificarlo en nativo |
|---|---|---|
| Crear/abrir/guardar proyecto | Diálogos y FS nativos (`projects.rs`) | `npm run tauri:dev`; crear proyecto 1080×1920; editar un clip; guardar; cerrar y reabrir |
| Importar medios y proxies | FFmpeg/ffprobe (`media.rs`) | Importar 3 videos + 2 imágenes; ver miniaturas, waveform y proxy |
| Exportar MP4 | FFmpeg + perfiles (`render/*`) | Exportar un perfil; comprobar progreso, `render-finished`, tamaño y reproducción del archivo |
| IA de texto | HTTP desde Rust + keyring | Ajustes → IA: guardar Ollama `http://127.0.0.1:11434/v1` + `llama3.1`; pedir un guion de 3 escenas; verificar que el JSON se aplica |
| Consentimiento de costo | Sólo aplica a remotos | Configurar OpenAI sin consentimiento y confirmar el error `CostNotApproved`; luego marcar y reintentar |
| Traducción | Proveedor + archivo SRT | Localización: cargar SRT, traducir a `en`, exportar; con mock, confirmar que el export se bloquea |
| TTS SAPI | PowerShell + voces del sistema | Producción: narrar una escena; verificar WAV, duración y asset generado |
| ElevenLabs | Clave + red | Ajustes → Voz: guardar clave, listar voces y narrar; verificar costo/errores |
| Transcripción | Python + faster-whisper | Texto: transcribir un clip; si falta el engine, comprobar el mensaje y el estado de capacidades |
| Fondo/Upscale | ONNX + modelos | Ajustes → Capacidades: descargar `u2netp` y `real-esrgan-x4plus`; ejecutar ambas vistas con una imagen de prueba |
| Rostros/shorts | Modelo `seeta-face` + FFmpeg | Director: descargar el modelo, analizar un video con una persona, exportar un short |
| MCP cliente | Spawn de procesos | Instalar un servidor stdio de prueba; probar tools/list y llamar una herramienta; matar el proceso y comprobar el cierre del árbol |
| MCP servidor | HTTP local + token | Abrir el asistente, pedir "iniciar MCP", copiar la config, probar desde Claude/Cursor; reiniciar y verificar que el token persiste |
| Flow | Terceros + navegador automatizado | Instalar `google-flow-mcp`, cargarlo en MCP, generar una imagen y confirmar el import a Medios |
| Recuperación ante cierre | localStorage + FS | Editar sin guardar, matar el proceso, reabrir y comprobar la oferta de recuperación |
| Actualizador | Red + firma | Sólo en build firmado; no verificable en dev |

Checklist mínimo de verificación nativa (en orden, ~30 min):

1. `npm run tauri:dev` y confirmar que la ventana y el splash aparecen.
2. Crear proyecto, importar medios, agregar a timeline, mover/recortar, hacer zoom y deshacer.
3. Abrir Ajustes → IA: guardar proveedor local, ejecutar "probar proveedor" (cuando exista), pedir guion y aplicarlo.
4. Reproducir una escena con narración SAPI y exportar un MP4; verificar duración y pistas.
5. Repetir con proveedor `mock` en Guion, Localización, Motion y Fábrica (debe avisar/bloquear).
6. Probar Fondo y Upscale con y sin modelo descargado.
7. Probar Texto y Subtítulos automáticos con y sin faster-whisper.
8. Abrir MCP, listar servidores, probar uno, y comprobar el servidor propio.

---

## Anexo A — Comandos ejecutados y resultados

```text
npx tsc --noEmit -p apps/desktop/tsconfig.json
  -> exit 0 (sin salida)

npx vitest run apps/desktop/src/app/navigation.test.ts \
  apps/desktop/src/app/view-routing.test.ts \
  apps/desktop/src/services/ai-models.test.ts \
  apps/desktop/src/features/ai-hub/ai-hub.test.ts --reporter=dot
  -> 4 archivos, 25 tests, todos pasan (2.80 s)

Invoke-WebRequest http://localhost:3000
  -> HTTP 200, sirve /src/main.tsx (Vite)

git status --short --branch
  -> main...origin/main con cambios del usuario en curso (no tocados)
```

Conteos propios usados en el documento (grep sobre `apps/desktop/src` y `src-tauri/src`):

```text
Vistas declaradas: 33          renderView: 15 casos + 18 alias
Rail: 11 vistas                "Más": 8 vistas
Comandos Tauri registrados: ~165
Métodos del contrato: 184      Comandos mapeados en el cliente: 164
Métodos sin call site: 4 (analyzeMediaFrames, checkAssetFiles, convertMedia, mcpServerStatus)
Sin caller: inspect_flow_install (registrado) y el módulo voice_isolation (no registrado)
Catch silenciosos (patrones): 229 en 85 archivos (no todos son un problema)
Herramientas MCP: 83 en TS, 25 expuestas por el servidor Rust
Stub de navegador: 153 métodos lanzan excepción
UI sin backend: 0 (los 164 comandos mapeados existen en el handler de Tauri)
```

Contraste explícito de la pregunta "¿backend sin UI o UI sin backend?": no encontré **UI llamando comandos inexistentes** (los 164 valores de `PROJECT_COMMANDS` están todos registrados en `lib.rs`); sí encontré **backend sin superficie** (`analyzeMediaFrames`, `checkAssetFiles`, `convertMedia` single, `mcpServerStatus`, `inspect_flow_install` y el módulo `voice_isolation`), además de las rutas `demo://` que no tienen backend.

## Anexo B — Discrepancias con el enunciado

- **"app.new"**: no existe en el repo. No hay directorio, archivo ni referencia.
- **"servicio mock cuando no hay runtime nativo"**: no es un mock. Es un servicio `available: false` que lanza excepción (por diseño, para no fingir persistencia). El fake que sí existe es `src/test/fake-service.ts`, usado sólo por tests.
- **"la app corre también en navegador para desarrollo"**: corre, pero sin acceso a proyecto, medios, IA, export ni MCP. Sirve para ver el shell y las pantallas vacías, no para desarrollar flujos.
- **"33 vistas"**: correcto como registro; sólo 15 son pantallas propias y 18 son alias a hubs/modos. No hay vistas placeholder ni pantallas de relleno: el problema son las demos muertas y los bordes, no el relleno.

## Anexo C — Reproducibilidad

Los números de línea corresponden al árbol de trabajo tal como estaba durante esta auditoría (hay cambios sin commitear del usuario y el árbol puede seguir cambiando). Para reproducir los conteos: `grep` sobre `apps/desktop/src` y `apps/desktop/src-tauri/src`, más los comandos del Anexo A. El typecheck y los tests citados se ejecutaron sobre ese mismo árbol.

## Anexo D — Actualización posterior a la auditoría (Olas 4 y 4b, 2026-11-03)

Los fixes de las olas 4/4b cambiaron parte de los bordes que describe este documento:

- **P0-1/P0-2/P0-4/P0-5/P1-6/P1-7** implementados y testeados en `task-4`
  (transcripción honesta medida con `import faster_whisper`, `test_provider`,
  catálogo MCP degradado por herramienta, JSON mode con reparación, Fábrica que
  rechaza el guion simulado, banner de modo navegador).
- **P1-2/P1-9** implementados: hints honestos de AI Hub y Director; AI Hub y MCP
  visibles en «Más».
- **Ola 4b** (`task-6`): acciones «Probar proveedor»/«Abrir Ajustes» en el error
  del asistente, fila de transcripción honesta en Ajustes → Capacidades y
  requisitos documentados en `README.md` y `docs/TUTORIAL.md`.
- **Sigue pendiente** el backend sin UI (`analyze_media_frames`,
  `check_asset_files`, `mcp_server_status`, `convert_media` single,
  `inspect_flow_install`) y la decisión sobre `voice-isolation.rs`: el detalle y
  la verificación propuesta están en [`docs/FOLLOW-UPS.md`](FOLLOW-UPS.md).
- Los conteos de tests de este documento (25 tests, 15 superficies) son los de la
  auditoría original, no los actuales; la evidencia vigente vive en los reportes
  de cada ola y en `docs/FOLLOW-UPS.md`.
