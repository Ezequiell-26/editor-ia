# Auditoría del front end (réplica AlaukCut / Olyvia) — 2026-11-13

**Pedido:** «Revisá el front end de mi app y revisá que todo esté bien hecho;
es el front end de ALAUKCUT».

**Veredicto:** el front end **compila, pasa los tipos y toda la suite de tests
sin fallos**, y su arquitectura por capas está realmente gateada. Pero **no está
"todo bien hecho"**: la réplica AlaukCut que hoy es la superficie por defecto
del editor es una **maqueta visual con estado simulado y controles
decorativos**, y el sistema de estilos y el bundle inicial acumulan deuda
estructural medible. Detalle y evidencia abajo.

---

## 0. Alcance (aclaración necesaria)

En este repositorio **AlaukCut es un producto comercial de terceros usado como
referencia**, no el código de la app:

- `docs/reference/ALAUKCUT-GAP-ANALYSIS-2026-11-09.md`: «software comercial de
  terceros — se extraen patrones y features, **no código ni assets**».
- Base de conocimiento: `docs/reference/alaukcut/` (frontend de 105 módulos JS
  vanilla, ~68k líneas), `memory/2026-11-09-alaukcut-architecture.md`.
- El front end real es **Olyvia**, React 18 + TypeScript + Tauri, en
  `apps/desktop/src`.

Lo que el usuario llama «el front end de ALAUKCUT» corresponde, según la bitácora
de hoy (`.workbuddy-ai/memory/2026-11-13.md`), a la **réplica exacta del editor
AlaukCut** creada esta mañana: `features/editor/MinimalEditor.tsx` +
`features/editor/minimal/` + `styles/minimal-editor*.css` +
`styles/alaukcut-workspace.css` + `public/alaukcut/` (14 PNG). Esa superficie se
monta **encima del editor heredado** y es lo que muestra la app instalada.

Esta auditoría cubre **ambos**: el front end general y, con detalle, la réplica.
No se revisó el código JS del AlaukCut instalado en
`C:\Users\ofici\AppData\Local\Programs\AlaukCut` (fuera del repo).

---

## 1. Evidencia ejecutada en esta revisión

| Verificación | Resultado medido |
|---|---|
| `npm run typecheck` (4 tsconfigs) | **0 errores**, 1m18s |
| `npm run test:serial` | **2962 passed / 3 skipped / 0 failed**, 331 archivos, 691,6s |
| `scripts/architecture-rules.test.mjs` | **13/13** (dentro de la suite) |
| `scripts/dependency-rules.test.mjs` | **7/7** (dentro de la suite) |
| `vite build` (593 módulos, a `--outDir` temporal) | **✓ built in 11,05s** |
| Inventario de fuente | 450 módulos TS/TSX de producción / 151.269 líneas; 746 con tests / 202.202 líneas; **52 CSS / 54.698 líneas** |

Nota de entorno: `npm run build` estándar se detuvo con
`SAFE_DELETE_BULK_CONFIRM_REQUIRED` al intentar vaciar `dist/assets` (114
archivos). Es una guardia de borrado del entorno, **no un fallo de código**; se
repitió escribiendo en un directorio temporal externo y compiló limpio. No se
borró ningún archivo del proyecto.

---

## 2. Lo que sí está bien hecho (con evidencia)

1. **Arquitectura por capas gateada, no sólo documentada.** 17 de las 18
   referencias a `@tauri-apps` están confinadas en `platform/tauri/`; la única
   restante es un comentario en `services/contracts/events.ts:4`. **0 barrel
   files** (`export *`) en `features/**` ni `packages/*/src`. **0 ciclos** entre
   features (`KNOWN_CYCLES` está vacío en `scripts/architecture-rules.test.mjs:152`).
   Sólo 2 aristas ascendentes, documentadas con motivo y criterio de eliminación
   (`KNOWN_UPWARD_EDGES`, líneas 207–216: `AppShell → features/assistant`,
   `MenuBar → features/editor`).
2. **Higiene de tipos y seguridad notable para 151k líneas.** 0
   `dangerouslySetInnerHTML`, 0 `innerHTML`, 0 `eval`, 0 `console.log` en
   producción; **3 usos reales del tipo `any`**
   (`components/ThumbnailBrowser.tsx:146`, `state/project-store-provider.tsx:17`),
   0 `@ts-ignore`/`@ts-nocheck` (1 `@ts-expect-error` en infra de tests) y **0
   TODO/FIXME reales**. Los otros 15 `\bany\b` son el literal de dominio
   `'any'`, no el tipo de TypeScript. `ViewErrorBoundary` aísla fallos por
   vista y tiene tests.
3. **Accesibilidad con trabajo real.** 1.076 atributos `aria-*`, 461 `role`,
   32 `tabIndex`, 1.246 `<button>` nativos, ~90 reglas `:focus-visible`,
   trampas de foco testeadas (`EmojiPicker.focus`, `StartScreen.focus`), axe en
   6 vistas (`a11y/a11y-shell.test.tsx`) y contraste AA medido en
   `e2e/theme.spec.ts`.
4. **CSS splitting por ruta implementado:** 30 imports estáticos en
   `main.tsx`, 11 `@import` diferidos en `styles/entries/{editor,content}.css`
   cargados por `import()` desde `app/view-registry.tsx`, y 9 imports de
   componente. **0 de 52 hojas CSS huérfanas.**
5. **Cobertura de tests amplia y verde**, incluidos 80 tests de `App.test.tsx`,
   inventario de tests, reglas de CI y suites de dominio.

---

## 3. Hallazgos priorizados

### P1 — La réplica AlaukCut es una maqueta, no un editor funcional

Es el hallazgo más importante y afecta directamente al pedido.

- **`app/WorkspaceView.tsx:110`** monta `EditorWorkspace` **y** `MinimalEditor`
  simultáneamente cuando `editorMode === 'timeline' && !toolActive`. La réplica
  es un overlay opaco que oculta el editor real con `:has()` + `!important`.
  Consecuencias: dos superficies montadas, dos motores de reproducción
  (`usePlayback()` en `MinimalEditor.tsx:85`), doble suscripción a eventos y
  árbol de accesibilidad duplicado (la bitácora de hoy ya registró 4 fallos de
  `getByRole` por `banner`/`contentinfo` duplicados). Es una decisión tomada
  para no romper 80 tests, no una arquitectura sostenible.
- **Estado simulado y hardcodeado** en `MinimalEditor.tsx`:
  - `SAVE_STATE` (líneas 40–45): marcas de tiempo fijas «✓ Salvo
    automaticamente: 12:00:59» / «12:06:23».
  - `timecode`/`duration` (líneas 146–152): `00:00:07:03`, `00:02:37:04`, etc.,
    por escena, en vez del estado real de reproducción.
  - `playheadLeft` (líneas 126–131): 6,2 / 10,5 / 14,2 % fijos por escena.
  - `totalFrames = fps * 660` (línea 97): duración inventada; las posiciones de
    los clips reales se calculan contra esa constante.
  - `monitorSrc` apunta a PNG estáticos de `public/alaukcut/`.
  - `minimal/model.ts:4` lo declara explícitamente: «Todo el contenido es
    estático y medido de las 15 capturas de referencia».
- **Controles decorativos.** `LibraryPanel.tsx:106` «Importar» llama a
  `onImport = () => changeScene('media')` (`MinimalEditor.tsx:215`): **no abre
  ningún diálogo ni importa archivos**, sólo cambia de escena de demostración.
  5 de los 7 `<button>` de `MinimalEditor.tsx` no tienen `onClick` (menú
  Arquivo/Versão/Atualização/Configurações/Ajuda, Layout, Histórico, «Edição
  automática», «Atalhos»). Los 16 botones de herramientas del timeline
  (`model.ts:155–175`, renderizados en `TimelinePanel.tsx:49–69`) tampoco.
  `minimal/controls.tsx:4` lo admite: «se dibujan con spans para no inundar el
  árbol de accesibilidad con cientos de `slider`/`spinbutton` **que no hacen
  nada**». En total ~18 etiquetas `<button>` sin handler en el código fuente,
  que se multiplican al resolverse los `.map()`.
- **Artefacto de QA enviado a producción:** `Floating.tsx:82` `SceneNav` con
  `title="Estados de la réplica — también Alt+1..4"`; el atajo Alt+1..4
  **no está implementado** en ningún archivo de producción (sólo aparece en
  comentarios y en tests de otros atajos). `?scene=` está acotado a localhost,
  pero el selector de escenas no.
- **Marca de terceros:** `model.ts:26` `PRODUCT = 'AlaukCut'` y la marca «AC»
  se mantienen literales «por pedido de réplica exacta». Dado que
  `ALAUKCUT-GAP-ANALYSIS` declara explícitamente que no se copian código ni
  assets de ese producto comercial, distribuir un instalador firmado con su
  nombre y su identidad visual merece una revisión de marca/licencia antes de
  publicar. Es un riesgo jurídico, no un defecto técnico.

> Esto contradice el criterio de calidad del propio proyecto
> (`CLAUDE.md:37` «no una lista de funciones ficticia» y
> `docs/verification/2026-11-12-build-qa-and-blockers.md:162` «ningún botón,
> menú o panel debe ser decorativo o quedar sin acción»).

### P1 — Cascada CSS ingobernable

- **6.440 `!important`** en 52 hojas; **3.017** sólo en
  `styles/filmora/filmora.css`. Otras: `filmora-states.css` 957,
  `capcut-editor.css` 422, `capcut-ui.css` 323, `capcut-inspector.css` 252.
- **Selectores repetidos entre hojas:** 458 (criterio estricto, 5.171
  selectores distintos), 56 de ellos en ≥3 hojas; con normalización más amplia
  se miden hasta 762. `body`, `.app-shell`, `.app-shell .topbar` aparecen en
  **6 hojas distintas**.
- **Cinco sistemas visuales coexistentes**: `premium/*`, `filmora/*`,
  `capcut*`, `olyvia.css`/`app.css`/`chrome.css`, `minimal-editor*`.
  `main.tsx:6–82` encadena 30 imports con comentarios del tipo «debe ir
  DESPUÉS de…», «gana la cascada», «última del cascade». El resultado depende
  del **orden de carga y la especificidad**, no de contratos. Ya causó un bug
  real: `capcut-ui.css` con `!important` anulaba la paleta elegida por el
  usuario (corregido el 12/11, ver `docs/verification/2026-11-12-…md:96`).
- **Tokens fragmentados:** ~474 custom properties en ~20 namespaces,
  **2.094 colores literales** frente a 9.711 usos de `var(--…)`; tres fuentes
  de verdad del color (dos hojas de tokens + `state/appearance.ts:274`).
- **Tema claro casi sin mantener:** 509 selectores `:root[data-theme='dark']`
  frente a **9** de light; **0** `prefers-color-scheme`;
  `editor-clarity.css` aplica sólo a dark. La auditoría visual del 11/11 admite
  no haber revisado tema claro ni preset CapCut (`docs/AUDITORIA-VISUAL-EDITOR-2026-11-11.md:102`).
- Selector frágil: `:root[style*='color-scheme: light']` en
  `premium/workspace.css:3363+` depende de la serialización exacta del estilo
  inline.

### P1 — Bundle inicial pesado (medido en el build de hoy)

| Artefacto | Tamaño |
|---|---:|
| `main-*.js` | **910,83 KB** / 277,28 KB gzip |
| `main-*.css` (crítico) | **702,9 KB** |
| CSS total (10 chunks) | 1.030,7 KB |
| JS total (76 chunks) | 4.173,7 KB |
| `NotoColorEmoji.ttf` | **7.083 KB** |
| `Twemoji.Mozilla.ttf` | 1.440 KB |
| `vendor-emojibase` / `vendor-lottie` / `vendor-react` | 499 / 308 / 413 KB |
| `Inspector` / `EmojiPickerPopover` | 331 / 218 KB |

Vite advierte por chunks >300 KB. `lottie-web` contiene `eval` (advertencia de
Vite y riesgo de CSP). 8,76 MB de fuentes se empaquetan aunque la mayoría de
las vistas no usan emojis. Coincide con lo ya medido el 12/11
(`docs/verification/2026-11-12-build-qa-and-blockers.md:115–131`).

### P1 — Módulos monolíticos sin plan de descomposición

`docs/architecture/DEPENDENCY-RULES.md` §4 exige **plan explícito** para
módulos >1.000 líneas (regla hoy manual, no gateada). Hay **26 archivos de
producción >1.000 líneas y 41 >700**:

| Archivo | Líneas |
|---|---:|
| `features/editor/Inspector.tsx` | 6.986 |
| `features/editor/Timeline.tsx` | 4.736 |
| `features/download/DownloadView.tsx` | 4.320 |
| `state/motion-templates.ts` | 3.276 |
| `features/editor/Preview.tsx` | 2.910 |
| `features/mixer/usePreviewAudio.ts` | 2.514 |
| `state/mcp-tools.ts` · `EditorAssets.tsx` · `ExportDialog.tsx` · `project-actions.ts` | 2.402 / 2.284 / 2.278 / 2.220 |

`docs/architecture/CURRENT-STATE.md` ya lista esta deuda como pendiente. No se
encontró un plan de descomposición con criterios de aceptación para estos
módulos.

### P2 — Verificación visual incompleta

`e2e/css-audit.spec.ts` toma 13 capturas pixel-perfect de las vistas, pero
`enterApp()` corre en **«Modo navegador» sin proyecto abierto**: las capturas
de `Editor` y `Producción` son *empty states* («No hay un proyecto abierto»).
El editor real con medios, inspector y timeline **no tiene regresión visual
permanente**; el arnés de 62 estados de la auditoría del 11/11 era temporal y
se eliminó. El propio informe del 12/11 lo marca como P1 pendiente
(`docs/verification/…md:152–154`). Además, los 13 snapshots están marcados como
modificados en `git status` y no se regeneraron tras la réplica de hoy.

### P2 — Deuda de acoplamiento y responsive

- 71 imports cruzados entre features (43 concentrados en `editor`) y 22
  aristas de capas inferiores hacia `features/` (la mayoría desde
  `app/view-registry.tsx`, composition root, por diseño). 15 nombres de archivo
  duplicados (`audio.ts`, `media.ts`, `events.ts`, `native-service.ts`…).
- 161 `@media` con ~29 breakpoints arbitrarios; `body { overflow: hidden }`
  (`filmora/filmora.css:275`); grilla fija `366 | 1fr | 312` y `32/1fr/260/37`.
  Sin prueba de ventana mínima en la app nativa.

### P2 — Manejo de errores, estado y rendimiento

- **~145 `catch` con cuerpo vacío o sólo un comentario** (43 de ellos en
  `features/mixer/usePreviewAudio.ts`, de 55 `catch`); también
  `Timeline.tsx` 9 y `state/auto-pilot.ts` 5. Silencian fallos reales de
  audio/teardown sin dejar rastro.
- **Sanitización de errores no sistémica.** Existe `sanitizeForUi()`
  (`platform/tauri/shared.ts:376-384`: quita rutas absolutas y trunca a 400
  caracteres), pero se usa en **1 solo archivo** de producción; ~30 renders
  publican `failure.message` crudo (`AssistantDock.tsx:299,399,467,…`,
  `UpscaleView.tsx:62,80,…`, `AssetsPanel.tsx:419,…`) y
  `ViewErrorBoundary.tsx:45` pinta `<pre>{error.message}</pre>`.
- **Persistencia sin validar:** `features/download/queue.ts:169-174`
  `readJson<T>` hace `JSON.parse(raw) as T` sin comprobar la forma. El resto
  de la persistencia sí valida (`unknown` + `Array.isArray`/`typeof`).
- **Sin store único:** 3 Context + 95 módulos de dominio puros + 1.320
  `useState` locales; las preferencias en `localStorage` se reparten en 45
  archivos sin una fuente de verdad central (riesgo de divergencia).
- **Rendimiento:** 0 virtualización de listas pese a `.map()` de
  clips/ticks/marcadores (`Timeline.tsx:1520,3889-3921`); 19 archivos
  suprimen `exhaustive-deps`; los 5 componentes gigantes tienen 0
  `useCallback` y `DownloadView.tsx` 0 `useMemo` con 108 `useState`. Como
  contrapeso: `memo` con comparador propio en `ClipBlock`
  (`Timeline.tsx:1021`) y limpieza de efectos equilibrada.
- **Menor, sólo en WIP:** `platform/tauri/dual-monitor.ts:14` abre
  `window.open(url,'_blank',…)` sin `noopener,noreferrer`. La URL es de mismo
  origen y el código corre únicamente en el fallback de desarrollo, nunca en
  Tauri de producción; riesgo bajo.

### P3 — Detalles corregibles

- 17 `<div onClick>`; entre 8 y 11 sin `role`/`tabIndex`/`onKeyDown`
  (`AssetFolderTree.tsx:52`, `AssetsPanel.tsx:222/235/263`,
  `AssetThumbnailGrid.tsx:173/283`) → no alcanzables por teclado.
- `apps/desktop/src/nul` (y `nul` en la raíz): artefactos de `2>nul` en Git
  Bash, sin seguimiento.
- `ViewErrorBoundary.tsx` muestra `error.message` en un `<pre>`: posible
  exposición de rutas/detalles internos en la UI.
- `index.html` tiene `lang="es"` y `<title>` correctos, pero `description` y
  `og:*` están en inglés.
- Warnings jsdom no fatales durante la suite (`HTMLCanvasElement.getContext`,
  `HTMLMediaElement.pause` no implementados): ensucian stderr y no sustituyen
  a pruebas en navegador real.

---

## 4. Lo que NO se encontró (para ser justos)

0 fallos de test · 0 errores de tipos · 0 CSS huérfanos · 0 barrels · 0 ciclos
entre features · 0 violaciones del aislamiento Tauri · 0 `eval`/XSS obvio en
código propio · 0 secretos hardcodeados en el front end · 0 `console.log` de
producción · 0 `window.open` en código commiteado. La base técnica es sólida;
el problema está en la **deuda de mantenibilidad** y en que **la réplica se
envió como superficie funcional**.

---

## 5. Plan recomendado (por impacto)

1. **Decidir el destino de la réplica AlaukCut.** Si es una demo, aislarla tras
   un flag/vista explícita y no montarla por defecto. Si es el editor real,
   cablear cada control al store/servicio (Importar, menús, herramientas del
   timeline, inspector), eliminar los valores hardcodeados y **desmontar el
   editor heredado** en vez de superponerlo. Retirar `SceneNav` y el atajo
   documentado que no existe.
2. **Revisar marca/licencia** antes de distribuir el instalador con
   `PRODUCT='AlaukCut'` y la marca «AC».
3. **Presupuesto de bundle por ruta** (CI gate): fuentes emoji bajo demanda,
   aislar Lottie sin `eval`, separar `EmojiPicker`/`Inspector` del arranque.
4. **Estabilizar la cascada:** baseline decreciente de `!important`, unificación
   de tokens, migración progresiva a `@layer`/CSS Modules y consolidación de
   las 5 capas, con los 13 snapshots como red de seguridad.
5. **Plan de descomposición** para los 6 módulos >2.000 líneas y gatear la regla
   §4 en `scripts/dependency-rules.test.mjs`.
6. **E2E con proyecto real**: importar → editar → reproducir → guardar →
   reabrir → exportar, con capturas del editor con contenido y prueba de
   ventana mínima nativa.
7. **Cerrar tema claro** y los 8–11 targets sin teclado.

---

## 6. Límites de esta revisión

Revisión estática + typecheck + suite completa + build de producción sobre el
**working tree con ~735 rutas con WIP sin commitear** (preservado íntegramente).
No se ejecutó la app nativa Tauri ni la suite Playwright en esta sesión; las
capturas disponibles son del 12/11 (e2e) y 13/11 (réplica). No se modificó
ningún archivo del proyecto salvo este informe y la memoria diaria. Los
conteos se hicieron sobre el árbol en disco, no sobre `HEAD`.
