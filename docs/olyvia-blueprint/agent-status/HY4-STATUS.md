# Estado de HY4 — Implementación del frontend de Olyvia

Estado: **EN PROGRESO** (fase 2 de 6)
Worktree/branch: `D:\Users\ofici\QODER-WORK\editor-ia-architecture` · `architecture/refactor-foundation` · HEAD `4f2e4a4`
Último checkpoint: auditoría completa de blueprint + código + contratos + baseline de typecheck.

## 1. Descubrimiento (2026-11-08/09)

- Leídos íntegramente: README, 01, 02, 05, 09, 11, 12, 13, 14, 15, 16, HY4/SWE2 brief, y las auditorías históricas `AUDITORIA-FRONTEND-2026-11-07.md` y `APP-FEATURE-AUDIT.md`.
- `git status`: SWE 2 tiene cambios locales **sin confirmar** en `apps/desktop/src-tauri/**` (Rust: MCP, production, state) y `docs/architecture/README.md`. HY4 **no toca esos archivos**. `docs/olyvia-blueprint/` es nuevo (untracked).
- `apps/desktop/src` contiene 608 ficheros TS/TSX, 41 CSS y 40 áreas `features/`. La app ya tiene shell, 11 vistas primarias, 36 `ViewId`, editor profesional (Timeline 3246 líneas, Preview 1692, Inspector 7010), preview, inspector, biblioteca, producción autónoma, MCP, ajustes y asistente.
- **Suite de regresión grande y estricta**: `App.test.tsx` (77 KB) afirma exactamente las 11 etiquetas del rail, 3 separadores y los nombres de menú; `css-audit.spec.ts` compara capturas pixel-perfect de 13 vistas. Por eso la navegación unificada se implementa **encima** del shell existente, sin borrar ni renombrar nada.
- Baseline `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0** (2026-11-09).

## 2. Contratos REALES disponibles (fachada `DesktopService`)

`services/project-service.ts` → `services/contracts.ts` → `platform/tauri/native-service.ts`.

| Dominio | Métodos reales consumibles |
|---|---|
| Proyectos | `createProject`, `openProject(At)`, `saveProject(As)`, `closeProject`, `importAssets`, `importMediaPaths`, `qualityGateReview`, `checkAssetFiles`, `findMissingAssets`, `relinkAsset*`, `listProjectVersions`, `restoreProjectVersion`, `findDuplicateAssets`, `packageProject` (store) |
| Producción | `productionCreate/Status/List/Resume/Cancel/Remove/Advance`, `catalogSearch/Get`; `buildProductionPlanFromProject`, `advanceProductionRun` (state) |
| Proveedores/IA | `getProvider`, `saveProvider`, `clearProviderKey`, `testProvider`, `getAudioProvider`, `saveAudioProvider`, `clearAudioProviderKey`, `generateScript`, `generateVideoEffect`, `generateMotion`, `assistantChat`, `assistantChatStream`, `cancelAssistantChat` |
| Capacidades | `listCapabilities(): CapabilityInfo[]`, `listModels/downloadModel/deleteModel`, `systemInfo`, `exportCapabilities`, `hardwareEncoders` |
| MCP | `listMcpServers`, `saveMcpServer`, `deleteMcpServer`, `probeMcpServer`, `callMcpTool`, `closeMcpSession`, `mcpSessionStatus`, `mcpServerStatus`, `startMcpServer`, `mcpDetectClients`, `mcpAutoconnect`, `listPlugins`, `setPluginEnabled` |
| Render/entrega | `startRender(To)`, `cancelRender`, `activeRender`, `onRenderProgress`, `onRenderFinished`, `verifyExport`, `renderQueueLoad/Save/ClearFinished`, `revealOutput`, `chooseExportDirectory` |
| Medios | `catalogSearch/Get`, `mediaThumbnail`, `analyzeMedia*`, `createVideoProxy`, `proxyStatus`, `ensureProxy`, `cancelProxy`, `applyProxyToAsset`, `cleanupProxies`, `detectScenes`, `convertMedia*`, `compressMedia`, `removeBackground*` |
| Audio/texto | `listVoices`, `synthesizeNarration`, `transcribeAsset`, `audioPeaks`, `analyzeMixLoudness`, `audioScopeAnalyze*`, `extractSubtitles`, `exportSubtitles` |
| Integraciones | `flowGenerateImage`, `flowBrowserStatus/Launch/Stop`, `flowEmbedStatus`, `screenRecord*`, `obsScene*`, `stickmanRender`, `notifyUser`, `openExternalUrl` |

**NO existe** (se muestra «No disponible» en UI y se pide contrato a SWE 2): generador genérico de imagen/vídeo/música/voz por adaptador, job envelope unificado (`schemaVersion`/`requestId`/`canPause`/`canCancel`/`events`), eventos `job.*`, `productionPause`, capability registry enriquecido (status/pricing/requirements/permission), DTO de credenciales con `credentialState`, permisos por herramienta MCP, `expectedRevision`/`operationId` en operaciones de proyecto, y ventana nativa redimensionable (`tauri.conf.json` es de SWE 2).

## 3. Archivos propios (HY4)

Se detallan por fase más abajo. Todos bajo `apps/desktop/src/**`, salvo este estado y `11_FRONTEND_BACKEND_HANDOFF.md` (requeridos por el brief).

## 4. Fases

| Fase | Estado | Entregable |
|---|---|---|
| 1. Auditoría | ✅ | Este documento, mapa de contratos, baseline typecheck |
| 2. Tokens + sistema de componentes | 🔄 | `studio/tokens.css`, `studio/studio.css`, `components/ui/*` |
| 3. Shell unificado + navegación | ⏳ | `studio/*` |
| 4. Workspaces (Inicio/Crear/Editor/Medios/Exportaciones/Ajustes) | ⏳ | `features/studio/*` |
| 5. Estados, capacidades, asistente, a11y, responsive | ⏳ | — |
| 6. Verificación + capturas + handoff | ⏳ | typecheck, vitest, build, PNG 1360×768 y 1280×720 |

## 5. Tests ejecutados

| Comando | Fecha | Exit | Nota |
|---|---|---|---|
| `npx tsc --noEmit -p apps/desktop/tsconfig.json` | 2026-11-09 | 0 | Baseline limpio |

## 6. Bloqueos

- Ninguno de código. Los bloqueos son de contrato backend (ver `11_FRONTEND_BACKEND_HANDOFF.md`) y de configuración nativa (`tauri.conf.json`, owner SWE 2).

## 7. Próxima acción concreta

Crear tokens y primitivas reutilizables, luego el shell unificado con las 6 áreas de información del documento 02.

## 8. Capturas

Pendientes de la fase 6. Se guardarán en `docs/olyvia-blueprint/screenshots/hy4/`.
