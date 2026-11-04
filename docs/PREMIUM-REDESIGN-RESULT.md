# Rediseño premium + mejora funcional — resultado de la ola 1

Actualizado: 2026-11-03 (America/Buenos_Aires). HEAD de la verificación:
`3a886f0 fix: el menu de perfil se recortaba a los 40px del rail`. **Sin
commits ni push**: todo el trabajo está en el worktree (70 archivos modificados
+ nuevos; ver §6). Este documento resume qué cambió, con qué evidencia y qué
queda pendiente. El detalle de método y diseño está en
`docs/PREMIUM-REDESIGN-SPEC.md` y `docs/PREMIUM-REDESIGN-PLAN.md`.

## 1. Qué se entregó

### Rediseño visual completo (capa nueva `styles/premium/`)
- **`premium/tokens.css`**: tokens derivados del contrato de apariencia
  (34 colores de tema, `--radius-2`, `--sidebar-width`, densidades) + vocabulario
  del spec (`--chrome-*`, `--ink-*`, `--type-*`, `--gap-*`, `--rad-*`,
  `--elev-*`, `--dur-*`/`--ease-*`, `--shell-*`, `--ctl-*`, `--tl-*`,
  `--focus-ring`). Sin paleta paralela: sigue funcionando el estudio de color,
  los 7 presets y el tema claro.
- **`premium/base.css` + `components.css`**: tipografía, foco visible AA,
  scrollbars, botones (primario sólido, sin gradientes), inputs, cards con
  hairline + elevación, badges/chips/kbd, segmented, menús y diálogos con vidrio,
  tooltips, tablas, empty states. Regla Quiet Premium del spec: sin translateY,
  sin glow, sin gradientes en botones/cards, hover 110–150 ms.
- **`premium/shell.css`**: topbar 44 px con vidrio, menubar, rail 48 px
  (expandido respeta `--sidebar-width`), statusbar 24 px, banners, dock del
  asistente, ventana de Ajustes, paleta de comandos, responsive 1024×640 y editor
  inmersivo. Franja honesta de «Modo navegador» en el flujo (no flotante).
- **`premium/launcher.css`**: launcher premium (header, 3 acciones, plantillas,
  herramientas IA, recientes 16:9 con fallback neutro, drag-hint, diálogos).
- **`premium/workspace.css`**: editor completo (paneles nivel 2, timeline con
  ruler 28, track-head 160, filas por `--timeline-row`, clips con color de medio,
  waveform 55 %, selección ring, handles 7 px, playhead 1 px, transporte, HUD,
  inspector con secciones colapsables, export).
- **`premium/views.css` + TSX**: Inicio (hero + estado honesto + stepper de 6
  pasos), Aprender (anillo de progreso), Proyectos/Guion/Medios/Producción/
  Director (empty states premium) y consistency pass de las 33 vistas.

### Neutralización en origen (menos `!important`, look real)
- `flat.css`: 608 → 87 líneas; sólo layout/comportamiento (15 `!important`).
- `resolve-theme.css`: 2.074 → 610 líneas; `!important` 1.036 → **152**.
  Neutralizados shell y contenido; editor/timeline/preview/transporte
  neutralizados por su capa. Preview/color-wheels conservados a propósito.
- `commercial.css`/`olyvia.css`: cards de contenido ya no fuerzan superficie plana.
- `premium-animations.css`: fuera el ripple de 300 px y `button{overflow:hidden}`
  que recortaba focus rings.
- `premium/workspace.css`: 1.149 → **16** `!important`; `shell.css` 89,
  `launcher.css` 77, `views.css` 40. Todos los restantes documentados como
  impasse en el código.

### Funcional + IA (auditoría `docs/APP-FEATURE-AUDIT.md`)
- **Honestidad de modo navegador**: `BrowserModeBanner` (franja en el flujo) +
  Inicio ya no muestra LISTO falso; 153 métodos del servicio nativo rechazan con
  motivo explícito.
- **Whisper honesto**: fuera la ruta hardcodeada del autor; se resuelve
  `EDITORIA_WHISPER_PYTHON` o un Python verificado con `import faster_whisper`;
  capacidades reportan no disponible con motivo accionable.
- **Probar proveedor IA**: comando Rust `test_provider` (GET /models, timeout,
  errores tipados, modelo verificado) + `testProvider()` en el contrato +
  botón «Probar conexión» en Ajustes→IA y acciones de recuperación en el
  asistente («Probar proveedor», «Abrir Ajustes»).
- **Fábrica**: rechaza `ScriptPlan.simulated` antes de narrar/escribir; chip y
  banner «Proveedor simulado: el guion es plantilla»; generación bloqueada.
- **Demos muertas eliminadas**: `grep demo:// apps/desktop/src` = **0**;
  `INITIAL_DEMO_PROJECTS` fuera y recents viejos filtrados.
- **Modelos locales**: `LocalModelGate` compartido con `listModels`/
  `downloadModel`, requisito `onnxruntime.dll`, enlace a Ajustes.
- **MCP**: panel del servidor propio (URL, token enmascarado con copia explícita,
  estado, iniciar/comprobar; sin stop/restart: no existe en el backend y se
  dice).
- **Honestidad documental**: README «Requisitos reales», TUTORIAL actualizado
  (34 colores, 7 presets, Whisper no empaquetado, modo navegador) y
  `docs/FOLLOW-UPS.md` con backend sin UI + decisión `voice-isolation`.
- **IA de texto/MCP/JSON**: catálogo MCP degradado por herramienta (no descarta
  todo), `response_format` JSON con fallback y una reparación para guion,
  asistente y traducción.

## 2. Verificación final (números exactos)

| Check | Resultado |
|---|---|
| `npm run typecheck` (4 proyectos) | **exit 0** |
| `npm run build` (vite) | **exit 0**, `✓ built in 5.68 s`; CSS 621 KB min, JS main 623.6 KB |
| `npm run test:serial` | **1869 passed, 3 skipped (1872)** · 212 archivos passed + 1 skipped (213) · exit 0 |
| `cargo test -p editor-ia-desktop --lib` | **541 passed, 0 failed, 49 ignored** · exit 0 |
| `npx playwright test` (todos los e2e) | **21 passed, 1 skipped (22)** · exit 0 · 44 s |
| Verificación visual del Lead | 0 console errors, 0 pageErrors, **0 scroll horizontal** en rail/1440 y launcher/Ajustes/editor; topbar 44, rail 48, statusbar 24, tema claro `#ffffff` + `color-scheme: light` |
| Build nativo (Tauri release + NSIS) | exe 38,9 MB + instalador 158,5 MB firmados; app abierta para el usuario |

Los 5 e2e que estaban rojos por deriva previa se corrigieron en el arnés
(nav «Más» para vistas secundarias, versión dinámica del updater, Motion/Lottie
documentado como no verificable en navegador) y no eran regresiones del
rediseño. El único skip es el panel Lottie dentro del modo Motion del editor:
sin proyecto/servicio en navegador no se puede montar (su cobertura vive en
`LottiePanel.test.tsx` + el test del rasterizador).

## 3. Capturas y evidencia

- Baseline antes: `.tmp-redesign/baseline/shots/` (22 PNG) + `baseline.md`.
- Final real (banner visible): `.tmp-redesign/views/final-real/` (33 vistas
  1440 + 4 tema claro + contact sheet), `final-real-1280/` (33 a 1280) y
  `final-real-shell/` (launcher, palette, Ajustes, editor).
- Capas por dueño: `.tmp-redesign/shell/` (60 PNG antes/después + temas),
  `.tmp-redesign/workspace/` (editor/timeline responsive + métricas),
  `.tmp-redesign/verify/shots/` (verificación del Lead + `verify-metrics.json`),
  `.tmp-redesign/audit2/audit.json` (geometría/rendimiento por vista).
- Docs: `docs/PREMIUM-REDESIGN-SPEC.md` (1.552 líneas, investigación),
  `docs/PREMIUM-REDESIGN-PLAN.md`, `docs/PREMIUM-POLISH-SPEC.md`,
  `docs/APP-FEATURE-AUDIT.md`, `docs/FOLLOW-UPS.md`.

## 4. Límites honestos

- **Runtime nativo no ejercitado end-to-end**: `test_provider` contra Ollama
  real, transcripción con faster-whisper, TTS/FFmpeg/MCP nativos quedan
  verificados por contrato + tests unitarios. Checklist en `FOLLOW-UPS.md`.
- **Demo de proyecto** ya no existe como tal: en navegador no hay servicio que
  abra proyectos; las capturas con clips usan el *harness* `fake-service`
  (etiquetadas en `workspace/CAPTURAS.md`). En la app nativa se usa un proyecto
  real.
- **Tema claro**: funciona con superficies base, pero el texto de estado/tenue
  sigue por debajo de WCAG AA en algunos pares (deuda de diseño previa); y el
  contraste del tema por defecto ya incumplía AA antes de esta iteración.
- **Arte decorativo, sombras/backdrops y datos de proyecto** (marcadores) siguen
  fuera de la paleta por diseño (§7 de COLOR-CUSTOMIZATION).
- 127 `!important` de `resolve-theme.css` son bloques muertos del rail legado;
  no se tocaron por no tener consumidores en TSX (documentado en la spec de polish).
- `EmojiPickerPopover` (752 KB) y `lottie` (301 KB) siguen lazy; el CSS creció a
  ~621 KB con la capa premium (gzip ~95 KB). Performance medida sin regresión
  (shell 30–55 ms, primera vista 380–470 ms, long tasks máx 1, CLS 0).

## 5. Ola polish (cerrada): timeline customizable + vistas compactas

Ver `docs/PREMIUM-POLISH-SPEC.md`. Implementado y verificado:

- **Timeline customizable**: nuevas preferencias persistentes en Ajustes→Editor
  (`timelineDensity: cómoda|compacta`, `timelineClipLabels: completas|minimal`,
  `timelineShowGrid`), retrocompatibles y con normalización segura. Compacta
  reduce 20 % el alto de pistas sin altura propia; los ajustes manuales y el
  plegado se conservan.
- **Timeline premium**: cabeceras con chip de tipo/nombre/flags/grip, regla con
  jerarquía de ticks y fondo, rejilla alineada a la regla
  (`--tl-grid-step` en línea), clips con radio/borde/degradado por tipo,
  labels 11 px, waveform/thumb sutiles, selección con anillo accent, handles
  sólo al hover, playhead 2 px con grip, marcadores; toolbar en 4 grupos, sin
  overflow a 1280/1440.
- **Fluidez**: zoom/pan/scrub sin trabajo nuevo por frame (long tasks 2/150 ms
  igual que antes, DOM 238→239; demo listo 1569→1564 ms, dentro de varianza).
- **Vistas**: hub-tabs 22→24 px (hit target en 20 hubs), chips/metadatos 9→10 px,
  anillo de Aprender 8→10, Home más compacto con nota de estado a 2 líneas y
  mapa de herramientas legible; 33/33 vistas sin overflow a 1440 y 1280 (8
  claves a 1920), 0 errores de consola. Copy del timeline corregido
  («DENSIDAD DEL TIMELINE»).
- **Verificación final**: typecheck 0; build 0 (`✓ built in 6.48 s`; CSS
  628,65 KB min / 95,7 KB gzip; JS main 623,9 KB / 184,2 KB gzip); suite serial
  **1869 passed / 3 skipped**; e2e **21 passed / 1 skipped**; verificación
  visual del Lead 0 console errors / 0 overflow (topbar 44, rail 48,
  statusbar 24, banner visible, tema claro OK); capturas finales en
  `.tmp-redesign/polish/final-views-1440|1280/` y
  `.tmp-redesign/polish/shots/final3-*`.
- Rebuild nativo con los cambios de polish en `target-polish/` (ver §7).

## 6. Siguiente paso recomendado

1. Verificación en **runtime nativo** (checklist en `FOLLOW-UPS.md`):
   `test_provider` contra Ollama real, transcripción con faster-whisper,
   TTS/FFmpeg/MCP nativos.
2. Reemplazar la build instalada por la nueva (`target-polish`) cuando el
   usuario cierre la app en uso; SmartScreen pedirá confirmación por la firma
   local autofirmada.
3. Limpieza opcional: 127 `!important` de bloques muertos del rail legado en
   `resolve-theme.css` (sin consumidores en TSX) y reducción fina de
   `components.css` (201) ahora que las capas legacy están neutralizadas.

## 6.5 Ola 2 «hazlo todo»: rendimiento, timeline pro, tema claro e IA streaming

Segunda ola ejecutada tras el pedido del usuario de no parar hasta terminar la
lista completa. Todo verificado; detalles en `docs/CSS-PERF-NOTES.md`,
`docs/RELEASE.md`, `docs/COLOR-CUSTOMIZATION.md`, `docs/ATAJOS-PRO.md` y
`docs/FOLLOW-UPS.md`.

### Rendimiento medido y reducción de bundle
- **CDP nativo de WebView2** (app instalada, demo real de 62 clips/4 pistas):
  proceso→load **1.035 ms**, proceso→FCP **1.290 ms**; timeline con 8.755 de
  10.127 nodos (86,4 % del DOM). Baseline honesto de frames lentos: pan 22,8 %,
  zoom 10,5 %, scrub 4,9 %, drag 4,4 %, playback 7,2 %.
- **CSS splitting** (`styles/entries/editor.css` y `content.css`, gate de render
  sin FOUC + prefetch a 1,2 s): CSS crítico **624.844→501.656 B (−19,7 %)**;
  gzip **94,3→78,4 KB (−16,9 %)**; FCP de editor/proyectos **−20 a −44 ms**;
  launcher pixel-idéntico al baseline (mismo sha). 33 vistas comparadas.
- **manualChunks** (`vite.config.ts`): `main` JS 633→**524,7 KB** (gzip
  187→160,5 KB); vendors separados (react, tauri, zod, schema, effect-kit,
  lottie, emojibase, search); EmojiPicker dejó de ser un chunk de 718 KB
  (emojibase 514 + picker 238 lazy); JS inicial gzip 260→253 KB.
- **Limpieza legacy**: eliminados los 127 `!important` de bloques muertos del
  editor rail en `resolve-theme.css` (152→**25**), −214 líneas y −3.820 B de
  CSS; 33/37 capturas pixel-idénticas (resto ruido animado ≤0,13 %).
- Se estabilizaron bajo carga los tests de `App.test` más sensibles a chunks
  lazy (timeouts explícitos; aislados ya pasaban) y el descubrimiento de la
  suite raíz dejó de escanear worktrees de `.git` (219 archivos reales).

### Timeline pro
- **Fluidez**: coalescing de `pointermove` con `requestAnimationFrame`
  (`timeline-raf.ts`) para arrastre/trim/fades, flush en pointerup (antes se
  perdía el último evento), sin trabajo nuevo por frame.
- **Virtualización**: sólo clips/cues en la ventana visible ±1 viewport y filas
  de pista visibles con spacers; contrato `.timeline-clip`/`[data-kind]`/aria
  intacto. Proyecto sintético 12.394 frames/62 clips: **7–11 clips de 62**
  renderizados y **~1,53 k nodos** (↓82–84 % del DOM de timeline); 24 pistas:
  12/24 filas + 2 spacers, ~1,77 k nodos, paneo 48,7 fps / p95 50 ms.
- **Ripple real, multi-selección (Shift/Ctrl+clic, arrastre de grupo, nudge),
  snap a escenas/beats medidas y minimapa/overview** con click/arrastre.
- **Memo de clips** (`React.memo` + handlers por refs): paneo largo **42,8→45,4
  fps**, p95 **66,6→50 ms**, long tasks **6/351 ms→3/203 ms**; demo corta
  arrastre 59,2 fps, scrub 58,4, zoom 59,1.
- **Ripple en Ajustes→Editor** (`timelineRipple`, default false, migración de
  la clave histórica) junto a densidad/etiquetas/rejilla.

### Tema claro nativo y deuda visual
- Preset **«Claro neutro»** con los 34 tokens explícitos y **AA medido**
  (texto 15,57:1; muted 7,11; faint 5,31; empty 4,65; accentInk 5,04; estados
  ≥4,54; 10/10 pares en pass). `color-scheme` derivado de luminancia; la paleta
  guardada del usuario no se toca. Export/import `olyvia-theme` con round-trip
  cubierto. Tests 71/71 + e2e theme **8/8** (nuevo test del preset y
  persistencia) y capturas en claro 38×1440 + 37×1280.
- Chips de Ajustes 9,5→10 px y sub-tabs 22→24 px; 0 overflow 1280/1440.

### Atajos e IA
- **Atajos configurables**: persistencia sólo de overrides con migración del
  formato legado, helpers puros de conflicto/asignación, `CATEGORY_ORDER` con
  Timeline, docs actualizadas; e2e de reasignación **4/4**.
- **IA streaming/abort**: comando Rust `assistant_chat_stream` +
  `cancel_assistant_stream` con SSE incremental (chunks partidos, `[DONE]`,
  keep-alive), reintento sin `response_format` sólo antes del primer delta y
  fallback no-streaming; `AssistantDock` con burbuja en vivo y botón Detener.
  **Rust 549 passed / 49 ignored**; tests de componente 109.
- **Presupuesto de tokens visible** (estimación 4 chars/token, umbral
  configurable 500–50.000 en Ajustes→IA, aviso sin bloquear).
- **Home contextual** (con/sin proyecto, CTA reales sin datos falsos),
  **búsqueda de proyectos recientes en la paleta** (abre con `openProjectAt`) y
  **autosave visible** en statusbar con la señal real (`phase`/`lastSavedAt`).
  Tests 20/20 y regresión App 66/66.

### Release reproducible y firma
- `.github/workflows/release.yml` (workflow_dispatch + tags `v*`, puertas
  typecheck/tests seriales/`npm run verify`, FFmpeg dev, versión tag vs
  `tauri.conf.json`, firma Authenticode condicional con PFX desde secrets,
  falla en tags sin firma, `SHA256SUMS.txt`, GitHub Release con `gh`) validado
  offline (YAML 0 errores, 45/45 checks, sin secretos/rutas absolutas).
- `docs/RELEASE.md` (build/versionado/firma OV-EV/timestamp/SmartScreen/
  verificación/hashes) y criterio de aceptación de firma real en
  `FOLLOW-UPS.md` §5. **Bloqueo externo**: comprar/gestionar un certificado
  OV/EV y cargar secrets; imposible desde el repo.

### Verificación final de la ola 2
- `npm run typecheck` (4 proyectos): **exit 0**.
- `npm run build`: **exit 0** (main CSS 501,64 KB / 79,21 KB gzip; main JS
  524,74 KB / 160,50 KB gzip).
- `npm run test:serial`: **1940 passed, 3 skipped** en 219 archivos (218 passed
  +1 skipped); sin worktrees duplicados.
- `cargo test --lib`: **549 passed, 0 failed, 49 ignored**.
- `npx playwright test`: **22 passed, 1 skipped** (52 s, exit 0).
- Capturas/perf: `.tmp-redesign/perf/` (CDP nativo + prod antes/después),
  `.tmp-redesign/shell/claro/` (tema claro 38+37 PNG), `.tmp-redesign/workspace/`
  (timeline pro), `.tmp-redesign/context/` (Home/paleta/autosave).

### Nueva ola en curso (pedido posterior del usuario)
Waveform de frecuencia real en el timeline, inspector derecho redimensionable,
preview sin franjas (fit/fill/zoom), layout compacto tipo CapCut/Filmora y
matriz de paridad de features. Plan/auditoría en `.tmp-redesign/capcut/`;
estado y límites se documentarán al cerrar esa ola.

## 7. Artefactos, publicación e instalación (2026-11-03)

- **Repositorio publicado**: `main` subido a
  https://github.com/Ezequiell-26/editor-ia en `8c4851c` (commits de la ola:
  `4b8bf08 feat: rediseno premium…`, merge `3b614bc` del README remoto,
  `fa34229 docs: requisitos reales…`, `8c4851c docs: capturas nuevas…`).
  Antes del push: `git fetch` + merge de `origin/main` (`81bc927`) resolviendo
  el conflicto del README a favor de la presentación nueva del remoto y
  reinsertando la sección «Requisitos reales» + capturas del rediseño. Árbol
  limpio y `ls-remote` coincide.
- **Rebuild nativo con la ola polish** (para no bloquear el exe en uso):
  `CARGO_TARGET_DIR=apps/desktop/src-tauri/target-polish` →
  `.../target-polish/release/editor-ia-desktop.exe` (38.971.360 B, 19:53:28) y
  NSIS firmado `.../target-polish/release/bundle/nsis/Olyvia_0.2.0_x64-setup.exe`
  (158,53 MiB). Sólo warnings de Rust previos y «No signature found» al
  timestampear DLLs de terceros; exe e instalador firmados correctamente.
- **Instalación en la PC** (pedido explícito del usuario): se cerró la app
  instalada anterior, `Olyvia_0.2.0_x64-setup.exe /S` → exit 0 (reinstalado
  desde el NSIS de 19:56 para dejar artefacto e instalación alineados); exe
  instalado en `C:\Users\ofici\AppData\Local\Olyvia\editor-ia-desktop.exe`
  (0.2.0, 38.971.360 B, hash SHA-256 `4127E8C3…`, firma **Válida**
  CN=Editor IA Self-Signed) y app abierta (PID 38880, ~36 MB). La app anterior
  en uso no se había inspeccionado/cerrado hasta que el usuario pidió instalar;
  después de instalar no se modificó nada más fuera del repo.
- **Aclaración de integridad**: el `target-polish/release/editor-ia-desktop.exe`
  es **NotSigned** (38.969.856 B, hash `445D242E…`) porque Tauri firma la copia
  que empaqueta en el NSIS; el instalado es el firmado (+1.504 B de firma). La
  diferencia de bytes/hash es por la firma, no por un build viejo.
- **Verificación visual nativa** (agente QA con captura de ventana real,
  `.tmp-redesign/polish/installed/`, 27 PNG + `INDEX.md`): launcher con chip
  v0.2.0 y **sin banner de modo navegador** (0 coincidencias por UI Automation);
  editor + timeline demo con 4 pistas, thumbs/waveforms, zoom real 2.40→6.59
  px/frame, selección de clip y playhead; Ajustes→Apariencia con 34 colores; y
  Ajustes→Editor con las 3 prefs nuevas («Densidad del timeline» cómoda/compacta,
  «Etiquetas de clip» completas/minimal, rejilla alineada). Sin crashes tras
  ~10 min. La verificación nativa de IA/transcripción sigue en el checklist de
  `FOLLOW-UPS.md`.
- **Límite de tema claro nativo**: los 7 presets son oscuros; el tema claro se
  logra con paleta custom / importar `olyvia-theme` (el contrato `color-scheme`
  está implementado y verificado en navegador con e2e). No se tocó la paleta
  violeta del usuario.

## 8. Alcance del worktree

`git status`: 72 archivos modificados + 32 nuevos; **HEAD sin commits**, sin
push. Todo el trabajo es del feature (rediseño, honestidad funcional, docs,
polish) y sus arneses de verificación:

- Nuevos: `styles/premium/*` (7), `BrowserModeBanner(.test).tsx`,
  `LocalModelGate.tsx`, `ColorStudioCard(.test).tsx` (iteración color previa),
  `theme-palette(.test).ts`, `InspectorSection.tsx`, tests nuevos de
  Home/Factory/IA/Capabilities/Settings, `docs/ALCANCE` (auditoría, spec, plan,
  polish, follow-ups), `e2e/theme.spec.ts`.
- Modificados: motor de color/apariencia (iteración previa), TSX de shell/
  launcher/editor/vistas, CSS legacy (neutralizaciones), Rust de IA/transcripción,
  `App.tsx` (banner), `app/navigation.ts`, e2e y configs de arnés.
- No se tocaron: instalación existente del usuario, proceso de la app en uso,
  datos de proyectos ni credenciales. El dev server de desarrollo sigue en
  `http://localhost:3000`; la app nativa se compiló y se abrió para el usuario.
