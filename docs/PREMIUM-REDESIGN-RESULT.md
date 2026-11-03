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
  instalada anterior (PID 11680), `Olyvia_0.2.0_x64-setup.exe /S` → exit 0;
  exe instalado en `C:\Users\ofici\AppData\Local\Olyvia\editor-ia-desktop.exe`
  (0.2.0, 38.971.360 B, 19:53:28) y app abierta (PID 30196, ~39,5 MB). La app
  anterior en uso no se había inspeccionado/cerrado hasta que el usuario pidió
  instalar; después de instalar no se modificó nada más fuera del repo.
- **Límite**: la verificación visual/nativa de esta build la hace el agente de
  QA con captura de ventana (PrintWindow) contra la instalación; el runtime
  nativo de IA/transcripción sigue sujeto al checklist de `FOLLOW-UPS.md`.

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
