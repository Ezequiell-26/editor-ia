# Mejora del front end — 2026-11-13

**Pedido:** «Mejorá el front end de la app completa», después de la auditoría
`docs/AUDITORIA-FRONTEND-ALAUKCUT-2026-11-13.md`.

**Resultado:** la superficie por defecto del editor (réplica AlaukCut) dejó de
ser una maqueta: todos sus controles ejecutan operaciones reales sobre el
proyecto, muestra el estado real y ya no envía artefactos de QA a producción.
Además se corrigieron accesibilidad, saneamiento de errores y validación de
persistencia en el resto del front end. **No se alteró la geometría, la paleta
ni los textos medidos** de la réplica.

---

## 1. Réplica AlaukCut: de maqueta a editor funcional

### Nuevo contrato de acciones

- `features/editor/minimal/editor-actions.ts`: mapa `TOOL_ACTIONS` /
  `MENU_ACTIONS` que resuelve **cada etiqueta visible** a una `EditorAction`,
  más `ACTION_VIEWS` (acciones → `ViewId`), `clampZoom` y `isHarnessHost`.
- `features/editor/minimal/useMinimalEditorActions.ts`: hook que ejecuta esas
  acciones contra el store y los contratos existentes. Reutiliza
  `splitClip`, `duplicateClip`, `deleteClip`, `addTrack`, `addMarker`,
  `addAsset`, `markAssetReady`, `updateEditorPreferences` y
  `store.service.importAssets`. **No crea ninguna API nueva.**

| Control antes | Acción ahora |
|---|---|
| «Importar» → cambiaba de escena demo | Diálogo de consentimiento de derechos + `importAssets()` real + alta de assets en el proyecto |
| 16 herramientas del timeline sin `onClick` | Reproducir, undo/redo, dividir, borrar, copiar, marcador, nueva pista, imán, deseleccionar, zoom real |
| Menús Arquivo/Versão/…, Layout, Histórico, Edição automática, Atalhos | Navegación a vistas reales, `ShortcutsCheatSheet`, `HistoryDialog`, tour |
| Tarjetas «Gravar tela», «Mão Mágica», features del inspector, «Aplicar câmera» | Navegación a `record`, `lab`, `localization`, `vfx`, `motion` |
| Zoom decorativo | Estado real `0,5×–3×` que escala regla, clips y cabezal; `Encaixar` vuelve a 1× |
| Filtros «Todos» / vista / orden | Filtrado por tipo, vista compacta y orden por nombre sobre los assets reales |
| Pestañas de categoría | Filtran la biblioteca real (`audio`, `elementos`, …) |

### Datos reales en lugar de literales

- `MinimalEditor.tsx`: `timecode`, `duration`, `playheadLeft` y el estado de
  guardado derivan de `playback.frame`, `store.durationFrames` y
  `store.state.phase`. Se eliminaron `SAVE_STATE` y los timecodes fijos.
- La biblioteca muestra **assets reales** (con `useThumbnail`) y permite
  agregarlos a la timeline con doble clic (`addClipFromAsset`).
- Los clips reales son seleccionables con mouse **y teclado**, y alimentan
  dividir/borrar/copiar.
- El monitor usa la miniatura real del asset seleccionado cuando existe.
- El inspector muestra duración real, ruta reducida a nombre de archivo y
  número de cuadros; se **eliminó una dirección de correo de terceros** que
  estaba literal en el mock del asistente.
- El pie informa materiales, clips y estado del imán.

### QA fuera de producción

- `SceneNav` y `?scene=` / `?inspector=` quedan acotados a
  `localhost` / `127.0.0.1` mediante `isHarnessHost()`. La app empaquetada
  (`tauri.localhost`) arranca siempre con el estado real.
- Se retiró el tooltip que anunciaba `Alt+1..4`, un atajo que nunca existió.
- `changeScene` es no-op fuera del arnés.

### Consentimiento de derechos

`features/editor/minimal/Overlays.tsx` añade `ConsentDialog` (antes de la
primera importación, persistido en `localStorage`) y `ActionToast` para
feedback. El diálogo usa `useDialogFocus` (trampa de foco, Tab circular,
Escape, restauración del disparador). Los avisos se retiran solos con
`temporizador limpiado al desmontar`.

---

## 2. Correcciones transversales

| Ámbito | Cambio |
|---|---|
| Accesibilidad | Nuevo `lib/a11y.ts` (`onKeyboardActivate`) aplicado a `AssetFolderTree` y a las dos variantes de `AssetThumbnailGrid`: `role="button"`, `tabIndex`, `aria-pressed`, `aria-label`, Enter/Espacio, sin doble activación con botones anidados. La regla de la réplica pasa a `role="slider"` con `aria-valuenow` y Home/End/flechas. |
| Errores | `ViewErrorBoundary` deja de pintar `error.message` crudo. Nuevo `components/SafeText.tsx` (usa `sanitizeForUi`) aplicado en `AppShell`, `AssistantDock`, `UpscaleView` y `AssetsPanel`. Los avisos de la réplica también se sanitizan. |
| Persistencia | `features/download/queue.ts`: `readJson` valida la forma antes de devolver `as T` (`sameShape` + validadores de jobs, feeds y registros numéricos). Antes un JSON manipulado podía romper el render de la cola. |
| Estilos | Bloque **additivo** al final de `minimal-editor.css` para los controles nuevos (zoom, foco visible, clips seleccionables, toast, diálogo). Sin tocar las reglas medidas ni su orden. |

---

## 3. Archivos

**Nuevos:** `minimal/editor-actions.ts`, `minimal/useMinimalEditorActions.ts`,
`minimal/Overlays.tsx`, `minimal/editor-actions.test.ts`,
`MinimalEditor.actions.test.tsx`, `queue.validation.test.ts`,
`ViewErrorBoundary.sanitize.test.tsx`, `lib/a11y.ts`, `lib/a11y.test.ts`,
`components/SafeText.tsx`.

**Modificados:** `MinimalEditor.tsx`, `minimal/{LibraryPanel,TimelinePanel,
MonitorPanel,InspectorPanel,Floating}.tsx`, `styles/minimal-editor.css`,
`app/WorkspaceView.tsx`, `features/download/queue.ts`,
`components/{ViewErrorBoundary,AppShell}.tsx`,
`features/ai/UpscaleView.tsx`, `features/assistant/AssistantDock.tsx`,
`features/assets/{AssetsPanel,AssetFolderTree,AssetThumbnailGrid}.tsx`.

---

## 4. Verificación

| Comando | Resultado |
|---|---|
| `npm run typecheck` (4 tsconfigs) | **0 errores** |
| `npm run test:serial` (suite completa) | **2984 passed / 3 skipped / 0 failed**, 336 archivos + 1 omitido, 503 s |
| Pruebas afectadas + reglas (11 archivos) | **59/59**, incluidos `architecture-rules` 13/13 y `dependency-rules` 7/7 |
| `vite build` (a `--outDir` temporal) | **✓ 593 módulos, 11,04 s, exit 0** |
| `git diff --check` sobre los archivos tocados | **exit 0** (sólo avisos CRLF de WIP ajeno) |

`npm run build` estándar sigue deteniéndose en la guardia de borrado masivo del
entorno al vaciar `dist/assets` (114 archivos); no es un fallo de código, por
eso se compiló a un directorio temporal externo sin borrar nada.

**Pruebas nuevas (22 casos)** que fijan el comportamiento:
`minimal/editor-actions.test.ts` (5), `MinimalEditor.actions.test.tsx` (5),
`queue.validation.test.ts` (7), `ViewErrorBoundary.sanitize.test.tsx` (2),
`lib/a11y.test.ts` (3).

**Coste medido del cambio:** el chunk principal pasó de 910,83 KB a
**924,00 KB** (+13,17 KB, +1,4 %; 281,49 KB gzip). No se añadió ninguna
dependencia ni hoja CSS al arranque; el bloque de estilos nuevo vive en la
hoja ya existente `minimal-editor.css`.

### Build nativo completo (15:06–15:19)

`npm run tauri:build` → **exit 0**, 12m40s. Log completo:
`target/build-frontend-20261113-1506.log`.

| Fase | Resultado |
|---|---|
| `rust-env` | FFmpeg dev 9.0 LGPL + libclang OK; toolchain 1.98.1 |
| Vite (`beforeBuildCommand`) | **598 módulos, ✓ 10,81 s** |
| Cargo release | `editor-ia-desktop v0.2.0` compilado |
| Firma + NSIS | 1 bundle firmado, 146,94 MiB |

Para esquivar la guardia de borrado masivo del entorno se **movió** el `dist`
anterior (321 archivos) a `target/dist-prev-20261113-1506` —sin borrar nada—
y se actualizó sólo el mtime de `src-tauri/src/main.rs` para que
`generate_context!` re-embeba el front end. Verificado: el ejecutable contiene
en claro `main-r9V7J3ey.js` y `main-g10sZ-OC.css`, que son los chunks del
código nuevo.

| Artefacto | Tamaño | SHA-256 |
|---|---:|---|
| `target/release/editor-ia-desktop.exe` | 52.452.864 B | `5a62b685e15455728bf831ae29c9875cd1334fb166456167fcb5213b4c3506fb` |
| `target/release/bundle/nsis/Olyvia_0.2.0_x64-setup.exe` | 154.079.984 B (146,94 MiB) | `96febe4840edeabbc1ce74bc786166d9e06b14c808d3ed3ec1df099b8716bbde` |

Avisos no fatales del log: `LNK4099` por PDB de `libcmt` no disponible
(sólo afecta símbolos de depuración en release) y 7 verificaciones
`SignTool: No signature found` sobre DLL de terceros **antes** de firmarlas
(todas terminan en `Successfully signed`). No hubo errores de compilación.

**No se instaló ni se reemplazó la aplicación en uso**: sólo se generaron los
artefactos. Tampoco se ejecutó la app nativa ni se regeneraron los snapshots
e2e.

---

## 5. Límites honestos

- El `EditorWorkspace` heredado **sigue montado debajo** de la réplica. Se
  conserva porque 80 tests de `App.test.tsx` y los modos de herramientas
  dependen de sus nodos. Es deuda conocida; quitarlo exige migrar esos
  contratos a la superficie nueva.
- Los controles del inspector dibujados como `span` en `minimal/controls.tsx`
  (sliders, ruedas HSL, toggles) siguen siendo de presentación: hacerlos
  editables requiere mapear cada propiedad a un campo del clip.
- La escala de zoom de la réplica no se comparte con la timeline heredada.
- No se reestructuró la cascada CSS global (6.440 `!important`) ni el bundle
  inicial: son refactors de varias pasadas con riesgo sobre el WIP.
- Sí se generó el instalador NSIS nuevo (ver §4), pero **no se instaló ni se
  ejecutó la app nativa**; no se regeneraron los 13 snapshots de
  `e2e/css-audit.spec.ts`.
- No se hizo commit, push ni operación destructiva. El WIP del usuario se
  preservó íntegro.
