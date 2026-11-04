# Rendimiento de Olyvia — medición nativa (CDP) y propuesta de CSS splitting

Iteración «hazlo todo» · task-7 · 2026-11-03 20:31 (America/Buenos_Aires)
Autor: agente de contenido (`redesign-views`). Sin cambios en `vite.config.ts`,
`main.tsx`, `Timeline.tsx`, `workspace.css`, AppShell/App: los aplica el Lead /
`redesign-workspace`. Evidencia en `.tmp-redesign/perf/`.

## 1. Método: CDP real sobre WebView2

El binario instalado acepta el debug remoto aunque `tauri.conf.json` declare
`additionalBrowserArgs: "--in-process-gpu"`: la variable de entorno se suma.
Método validado:

```powershell
Get-Process editor-ia-desktop | Stop-Process -Force
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222 --remote-allow-origins=*"
Start-Process "$env:LOCALAPPDATA\Olyvia\editor-ia-desktop.exe"
# GET http://127.0.0.1:9222/json/version → 200 (Edg/156)
node .tmp-redesign/perf/native-measure.mjs   # Playwright chromium.connectOverCDP
```

El CDP expone `http://tauri.localhost/` con el DOM real del editor: se puede
automatizar y **medir** la app nativa (no sólo el build de navegador). La app es
single-instance (mutex `Local\OlyviaQueueAgent`), así que hay que cerrar la
instancia normal antes; al terminar se relanzó sin la variable para dejar el
uso normal (PID 10320, puerto 9222 cerrado).

Limitación: la pantalla del equipo es 1360×768 (máximo 1360×720 de contenido).
No se pudo medir con monitor grande ni con GPU distinta.

## 2. Arranque (instalada, 0.2.0)

| Métrica | Valor |
|---|---|
| Proceso → `load` de la webview | **1.035 ms** |
| Proceso → First Contentful Paint | **1.290 ms** |
| Navegación: domInteractive / DCL / load | 72 / 141 / 141 ms |
| first-paint / FCP (página) | 152 / 396 ms |
| CSS cargado | **1 stylesheet, 614 KB** (`main-Ci_qj86d.css`, 21 ms) |
| JS principales | main 611 KB · vendor-react 217 · Inspector 211 · EffectStack 83 · EditorWorkspace 58 · Timeline 43 |
| Nodos al abrir | 10.127 |
| Heap JS | 35 MB · proceso 38,6 MB RAM |

## 3. Editor completo (demo real: 62 clips, 4 pistas)

| Escenario | Duración | Frames rAF | Frames >25 ms | % frame lento |
|---|---|---|---|---|
| Zoom ×10 (botón) | 2.765 ms | 417 | 44 | **10,5 %** |
| Pan con rueda | 2.383 ms | 246 | 56 | **22,8 %** |
| Scrub del playhead | 2.270 ms | 384 | 19 | 4,9 % |
| Arrastre de clip | 1.578 ms | 270 | 12 | 4,4 % |
| Playback 3 s | 3.118 ms | 180 | 13 | 7,2 % |

- **DOM**: 8.755 de 10.127 nodos son la timeline (**86,4 %**), con 62 clips →
  **≈141 nodos por clip**. Cuatro pistas: CAP/V3/A2/I1.
- **Long tasks** durante la sesión: 18 (3.067 ms acumulados, peor 366 ms).
- Capturas nativas: `native/01-launcher.png`, `native/02-editor-demo.png`,
  `native/03-timeline-after-drag.png`. JSON: `native/measure.json`.

Conclusión: el arranque es bueno (~1,3 s a primer contenido) pero el coste está
concentrado en la timeline: pan/zoom son los peores escenarios y la timeline
ocupa el 86 % del DOM. Las dos palancas con más retorno son **virtualizar
pistas/clips** y **coalescer pointermove/wheel con rAF** (datos para
`redesign-workspace` en §6).

## 4. Limpieza de CSS legacy (hecha)

`resolve-theme.css`: eliminados los bloques muertos del rail del editor
(stickers/SFX/transiciones/ajustes de `EditorAssets.tsx`, componente que ya no
monta la app) — **127 `!important` y 214 líneas**.

| Antes | Después | Δ |
|---|---|---|
| 23.278 B / 516 líneas | 19.250 B / 340 líneas | −4.028 B fuente |
| 152 `!important` | **25** (sólo shell/preview/ruedas justificados) | −127 |
| CSS build 628.664 B | **624.844 B** | **−3.820 B (−0,61 %)** |
| gzip post | **94.292 B** | (medir post-splitting) |

Verificación: build OK; tests focalizados 148/148 (EditorAssets + App);
capturas 33 vistas antes/después: **33/37 píxel-idénticas**; 4 diffs ≤1.641 px
(0,13 % de 1440×900) en zonas animadas/live (panda de Aprender, preview de color
de Apariencia; 2 px de caret en Thumbnails/Localización) y no ligadas a los
selectores eliminados (sus clases no existen en el DOM). Evidencia:
`css-antes/`, `css-despues/`, `css-diff.txt`.

## 5. Propuesta de CSS splitting (para que la aplique el Lead)

Hoy `main.tsx` importa 19 CSS legacy + 7 premium en un único entry: un solo
`main-*.css` de **614 KB** (23 % del total de assets) en el arranque, aunque el
70 % del CSS sea de editor/timeline y vistas de contenido.

### Paso 1 — Entry de arranque reducido (crítico del shell)
Dejar en `main.tsx` sólo: `tokens.css`, `app.css`, `premium/tokens.css`,
`premium/base.css`, `premium/components.css`, `premium/shell.css`,
`premium/launcher.css`. Resto (≈ **200-260 KB raw** de `chrome/olyvia/
start-screen/settings/home/…` + `premium/workspace.css` 76 KB +
`premium/views.css` 69,4 KB) se mueve a dos agregadores:

```
src/styles/entries/editor.css   ← chrome.css, resolve-theme.css, premium/workspace.css, effect-studio.css, brain.css
src/styles/entries/content.css  ← home.css, settings.css, start-screen.css, olyvia.css, commercial.css, premium/views.css
```

### Paso 2 — Importar por modo de la app (sin romper la cascada)
En `App.tsx` (Lead), al resolver la vista:

```ts
if (isEditorView(view)) void import('./styles/entries/editor.css');
else if (isContentView(view)) void import('./styles/entries/content.css');
```

El CSS de un `import()` se emite como chunk CSS y se carga en paralelo al chunk
JS de la vista; los tokens/base/shell ya están aplicados y la capa premium
conserva su orden (editor/content al final de su propio grupo). Pre-cargar en
`index.html` sólo `main-*.css`; no preload de los CSS de vista.

### Paso 3 — JS
- `manualChunks` explícitos: `vendor-react` (ya existe), `vendor-lottie` (ya),
  `vendor-markdown`, y mantener `EmojiPicker`/`Inspector`/`EffectStackPanel`
  lazy como hoy.
- `preloadViews()` ya limita a 4 vistas primarias; no ampliar.
- Añadir `modulepreload` sólo de `main` + `vendor-react`.

### Medición esperada (a validar por el Lead tras el cambio)
- Arranque: CSS inicial 614 KB → **≈ 380-420 KB** (−30-38 %); FCP nativo
  debería bajar 50-120 ms.
- Editor: el CSS de editor (≈ 110-150 KB raw) llega con el chunk de editor que
  hoy ya se carga; sin penalización perceptible al abrir proyecto.
- Regresión a cubrir: tema claro/oscuro, 33 capturas, e2e de shell y editor.

### 5.1 Resultado de la implementación (task-12, 2026-11-03 20:41) — APLICADO

Implementación conservadora por seguridad de cascada (los legacy con
`!important` de shell —`olyvia/commercial/start-screen/settings`— **quedan
críticos** para no invertir el orden de la capa premium; documentado como
segunda fase pendiente):

- `main.tsx`: crítico = tokens/app/animaciones/dopamine/linear/chrome/flat/panda/
  compliance/scopes/settings/start-screen/resolve-theme/olyvia/commercial/shortcuts
  + premium tokens/base/components/shell/launcher.
- `styles/entries/editor.css` → `premium/workspace.css` + `effect-studio.css` +
  `brain.css` (71.220 B min).
- `styles/entries/content.css` → `home.css` + `premium/views.css` (54.170 B min).
- `App.tsx`: `ensureViewStyles(kind)` singleton; el shell monta la vista recién
  cuando su entry de CSS está aplicado (fallback `view-loading`, sin FOUC); el
  otro contexto se prefetcha a los 1,2 s. En `MODE=test` arranca resuelto para
  no alterar los tests síncronos.

Números (build prod, contextos fríos, warm server; 3 corridas):

| Métrica | Antes | Después | Δ |
|---|---|---|---|
| main CSS minificado | 624.844 B | **502.061 B** | **−19,6 %** |
| main CSS gzip | 94.292 B | **78.539 B** | **−16,7 %** |
| Launcher: CSS gzip / hojas | 93 KB / 1 | **78 KB / 1** | **−16 %** |
| CSS por vista (contenido) | 93 KB gzip | **85 KB** (main+content) | −8,6 % |
| CSS por vista (editor) | 93 KB | **89 KB** (main+editor) | −4,3 % |
| Shell visible (avg) | 227 ms | 238–242 ms | +~11 ms (ruido) |
| FCP promedio (5 vistas) | 305 ms | 313 ms | +8 ms (Home outlier) |
| FCP editor/proyectos | 276/260 ms | 236–256/216–231 ms | −20..−44 ms |
| e2e completo | 22 ok / 1 skip | **22 ok / 1 skip** | verde |
| Unit App+Palette | — | **217/217** | verde |
| Typecheck | — | **0 errores** | verde |

Sin FOUC: launcher pixel-idéntico al baseline (sha `ae6a8cbe…`), capturas
inmediatas post-navegación con contenido estilizado (la diferencia de
`projects-immediate` fue timing del fade de entrada). Diff 33 vistas: sólo
diffs esperados por cambios paralelos de otros agentes (Home CTAs y Ajustes con
8 dots del preset claro) + panda animado + caret de 2 px. **Decisión: aplicar.**

Notas de cierre de la implementación:
- Build final limpio: sin el warning de minify (se quitó el comentario CSS
  anidado que lo causaba en `resolve-theme.css`) ni warnings nuevos; CSS final
  `main-DRJbpTpE.css` **501.656 B** (gzip 78,4 KB) + `editor` 71.220 B +
  `content` 54.170 B.
- **Native CDP «después»: bloqueado por entorno**, no por código: `npx tauri
  build --no-bundle` falla al escribir el cache de cargo
  (`D:\DevCache\Rust\cargo\registry\cache\…brotli-decompressor…crate`,
  `Acceso denegado (os error 5)`) desde esta sesión. El exe instalado sigue con
  los assets previos; falta recompilar (Lead) y correr
  `node .tmp-redesign/perf/native-measure.mjs` para cerrar el número nativo
  «después». Los números de navegador (build prod real, contextos fríos) y la
  diferencia de bytes son los reportados arriba.

### 5.2 manualChunks + preload selectivo (task-12b, 2026-11-03 21:20) — APLICADO

Autorizado por el Lead en `apps/desktop/vite.config.ts` (sólo
`build.rollupOptions.output.manualChunks`; `server`/`watch`/`test` intactos).
Chunks explícitos: mantenidos `vendor-react`/`vendor-tauri`; nuevos
`vendor-schema` (`packages/project-schema`), `vendor-zod`, `vendor-effect`
(`packages/effect-kit`), `vendor-lottie`, `vendor-emojibase` (este último saca
514 KB del chunk del picker), `vendor-search` (minisearch).

| Métrica | Antes | Después | Δ |
|---|---|---|---|
| chunk `main` | 633 KB (187 gzip) | **514 KB (155 gzip)** | **−18,8 %** |
| JS inicial (raw) | 868,6 KB | **854 KB** | −1,7 % |
| JS inicial (gzip) | 260,1 KB | **253 KB** | −2,7 % |
| vendor separados | react/tauri | react, tauri, zod, schema, effect, lottie, emojibase, search | cache por release |
| shell visible avg (browser prod) | 227–242 ms | **219 ms** | igual/mejor |
| FCP avg (browser prod) | 305–313 ms | **294 ms** | −3..−6 % |
| warning chunks >500 kB | 1 (existente) | 1 (main 514 + emoji lazy) | sin warnings nuevos |

Verificación: `npm run build` OK; `npm run typecheck` 0 errores; **e2e 22
passed / 1 skipped / 0 failed (54,8 s)**. EmojiPicker sigue lazy (dos chunks:
datos + picker), lottie lazy; el preload del `index.html` queda en
main+vendor-react+vendor-zod+vendor-schema+vendor-tauri (ningún chunk lazy se
precarga). Nota honesta: la ganancia real está en `main` (−19 % de parse) y en
cache de vendors; el total inicial sólo baja 2,7 % gzip porque el código de la
app es el que domina el bundle.

## 6. Datos para `redesign-workspace` (virtualización + rAF; sin editar nada acá)

- **Virtualización**: 62 clips → 8.755 nodos de timeline (141/clip; 86 % del
  DOM). Pan 22,8 % slow frames, zoom 10,5 %. Recomendación: renderizar sólo los
  clips cuya ventana temporal esté en el viewport ±1-2 pantallas (x con
  `pxPerFrame`), mantener clips absolutos y el hit-testing de arrastre sobre la
  capa completa. Estimación: DOM de timeline ↓ **85-90 %** en proyectos largos;
  objetivo medible <5 % slow frames en pan.
- **rAF coalescing**: el scrub ya coalesce (`scrubRafRef`), pero `move`/`trim`
  hacen `setPreview` por cada `pointermove` y el snap recalcula
  `collectSnapTargets` en cada evento. Recomendación: buffer del último evento +
  un `requestAnimationFrame` por frame para move/trim, memoizar snap targets por
  drag y coalescer la rueda del pan. Medición de seguimiento: mismo harness
  (`node .tmp-redesign/polish/perf.mjs despues`) + CDP nativo (arriba).
- No se tocó `Timeline.tsx`/`workspace.css` (task-8 de `redesign-workspace`).

## 7. E2E nativo por CDP (viable, queda propuesto)

El método de §1 permite un smoke E2E real (sin Playwright webServer):
cerrar instancia → lanzar con puerto 9222 → `connectOverCDP` → launcher,
abrir demo, comprobar `.timeline-clip`, seleccionar, zoom, drag, Ajustes→Editor
(3 prefs) → cerrar app y relanzar normal. Se puede integrar como script
`scripts/e2e-native.mjs` cuando el Lead lo autorice (no se agregó al repo).

## 8. Pendientes / límites

- Aplicar el splitting (§5) y re-medir arranque/CSS: Lead.
- Virtualización y rAF en timeline: `redesign-workspace` (task-8).
- Playback automático: el selector del botón varía entre estados (medido con
  `aria-label` estable: 180 frames/3,1 s).
- Monitor real del usuario 1360×768; falta medir 1920×1080/GPU dedicada.
- Firmas/licencia/certificado real y updater: fuera del alcance de esta tarea.
