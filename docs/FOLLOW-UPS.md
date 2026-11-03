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

## 2. Backend sin UI (deuda P1-3 del audit)

Verificado el 2026-11-03 con:

```powershell
Get-ChildItem apps/desktop/src -Recurse -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch "project-service|fake-service|\.test\." } |
  Select-String -Pattern "analyzeMediaFrames|checkAssetFiles|mcpServerStatus|inspectFlowInstall|\.convertMedia\("
# -> sin resultados (sólo aparecen en el contrato y en el fake de tests)
```

| Capacidad | Backend | Contrato TS | Estado | Qué falta / decisión |
|---|---|---|---|---|
| Análisis de cuadros de video (`analyze_media_frames`) | `src-tauri/src/lib.rs:350` | `project-service.ts:1788` | **BACKEND SIN UI** | El doc-comment decía que el asistente "ve" los clips y no ocurre. Decisión: exponerlo en el asistente (adjuntar cuadros muestreados al contexto) o borrar la promesa del doc-comment. No se tocó en 4b. |
| Detección de medios faltantes (`check_asset_files`) | `lib.rs:332` | `project-service.ts:1806` | **BACKEND SIN UI** | No hay verificación al abrir un proyecto con archivos movidos. Decisión: banner de "medios faltantes" en el store al abrir (requiere UI del editor). |
| Estado del servidor MCP propio (`mcp_server_status`) | `mcp_server.rs` | `project-service.ts:1900` | **BACKEND SIN UI** | El servidor arranca con token persistente y no hay panel de URL/token/stop. Decisión: tarjeta en MCP con token enmascarado y botón detener (UI de ola siguiente). |
| Conversión de un solo medio (`convert_media`) | `lib.rs:351` | `project-service.ts:1821` | **SIN UI** (sólo se usa el batch) | Decisión: usarlo desde Convertir para un archivo o eliminarlo del contrato en una limpieza. |
| `inspect_flow_install` | `mcp.rs:1404`, registrado en `lib.rs:399` | — | **REGISTRADO SIN CALLER** | La configuración de Flow se escribe a mano. Decisión: usarlo en el alta de Flow o quitarlo del handler. |

### 2.1 `voice-isolation` (decisión en esta ola)

`apps/desktop/src-tauri/src/commands/voice-isolation.rs` es un módulo **muerto**:

- No está declarado en `src-tauri/src/commands/mod.rs`, así que **no se compila**.
- El handler está comentado en `lib.rs:469`
  (`// commands::voice_isolation::isolate_voice, // TODO: Implementar voz isolation`).
- Cita APIs que el crate ya no tiene (`ProjectError::with_context`,
  `ProjectErrorCode::ValidationError`, `ProjectErrorCode::ProcessingError`), por
  lo que registrarlo tal cual **no compilaría**.
- No hay ninguna referencia desde TS (`voiceIsolation`/`isolate_voice`: 0 call
  sites fuera del contrato).

**Decisión de la ola 4b:** no se borra todavía. La tarea prohíbe tocar Rust en
esta ola salvo que un test lo exija, y el archivo no afecta al build ni a los
tests. La recomendación para la ola de limpieza es **eliminarlo** junto con el
comentario de `lib.rs:469` y el TODO, con esta verificación:

```powershell
# 1) no quedan referencias
Get-ChildItem apps/desktop/src-tauri/src -Recurse -Include *.rs |
  Select-String -Pattern "voice_isolation|voice-isolation|isolate_voice"   # esperado: 0
# 2) el crate sigue compilando y los tests pasan
node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop --lib
```

Mientras no exista el motor Demucs empaquetado ni una UI, el estado honesto es
"no implementado", no un TODO que sugiera lo contrario.

---

## 3. Pendientes de UI/funcionales para la próxima ola

| # | Pendiente | Archivo objetivo (dueño de la ola de UI) | Nota |
|---|---|---|---|
| 1 | Botón **«Probar conexión»** persistente en Ajustes → IA (hoy existe sólo dentro del estado de error del asistente) | `features/settings/SettingsHome.tsx` | Usar `store.service.testProvider()` ya implementado; el contrato devuelve `status`, `httpStatus`, `latencyMs`, `model`, `detail`. |
| 2 | Chip «proveedor simulado» y aviso en Fábrica; corregir el texto «Con el proveedor simulado podés probar el flujo completo sin red» (ahora es falso: la Fábrica rechaza el mock) | `features/factory/FactoryView.tsx` | El rechazo en `state/batch-factory.ts` ya está implementado y testeado. |
| 3 | Inicio en navegador: quitar los checks de capacidades en verde hardcodeados | `features/home/HomeView.tsx` | El banner global de modo navegador ya existe (`components/BrowserModeBanner.tsx` montado en `App.tsx`). |
| 4 | `StartScreen`: mostrar `store.state.error` (hoy el fallo es invisible) y eliminar/implementar los CTAs `demo://` y `proyectos/demo-*` | `features/start/StartScreen.tsx`, `features/editor/EditorWorkspace.tsx` | P0-3 del audit. |
| 5 | Pre-check de modelos on-device en Fondo/Upscale con botón «Descargar modelo» | `features/ai/RemoveBackgroundView.tsx`, `features/ai/UpscaleView.tsx` | Reutiliza `listModels()`/`downloadModel()`. |
| 6 | Botón «Abrir Ajustes» en el error del asistente: hoy cambia de vista; validar en la ventana de Ajustes de la app nativa | `features/assistant/AssistantDock.tsx` | Ya implementado con `onSelect('settings')`; la verificación en ventana nativa queda pendiente. |
| 7 | Integrar `BrowserModeBanner` al estilo premium del shell (hoy usa estilos inline y `position: fixed` abajo) y decidir si el launcher también ofrece acceso a Ajustes | `styles/premium/shell.css` o el dueño del shell | No se tocó CSS en 4b. |
| 8 | Conectar `analyze_media_frames`/`check_asset_files`/`mcp_server_status`/`convert_media`/`inspect_flow_install` según §2 | varios | P1-3. |

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
