# Olyvia — Especificación de rediseño premium

**Documento de investigación de diseño + especificación implementable.**
Estado: entrega de Ola 0 (reconocimiento). No modifica código de la app.
Fecha: 2026-11-03. Autor: investigación de diseño de producto (agente).
Repo: `D:\Users\ofici\QODER-WORK\editor-ia`.

> **Regla de lectura.** Todo lo que sigue distingue explícitamente entre:
> **[OBS]** = observado y verificado en una fuente citada (código, doc o página con URL);
> **[PROP]** = propuesta para Olyvia (decisión de diseño, no medida);
> **[REPO]** = verificado en este repositorio, con archivo y línea.
> No hay valores inventados presentados como medidos. Donde una app comercial no
> publica especificación (Resolve, Premiere, CapCut, Descript, Opus, Screen Studio),
> el documento dice "sin spec pública" y no le atribuye números.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Método y trazabilidad](#2-método-y-trazabilidad)
3. [Diagnóstico del repo (evidencia)](#3-diagnóstico-del-repo-evidencia)
4. [Principios de diseño](#4-principios-de-diseño)
5. [Lo observado en las referencias](#5-lo-observado-en-las-referencias)
6. [Fundamentos propuestos](#6-fundamentos-propuestos)
7. [Tabla maestra de tokens nuevos](#7-tabla-maestra-de-tokens-nuevos)
8. [Especificación de componentes](#8-especificación-de-componentes)
9. [Layout de shell con medidas exactas](#9-layout-de-shell-con-medidas-exactas)
10. [Workspace y densidad de timeline](#10-workspace-y-densidad-de-timeline)
11. [Accesibilidad](#11-accesibilidad)
12. [Estrategia de cascada recomendada](#12-estrategia-de-cascada-recomendada)
13. [Plan por fases y archivos priorizados](#13-plan-por-fases-y-archivos-priorizados)
14. [A/B de referencias](#14-ab-de-referencias)
15. [Anexos](#15-anexos)

---

## 1. Resumen ejecutivo

Olyvia no se ve barata por falta de tokens: se ve barata porque **el sistema de
color que ya existe (34 tokens + alias + presets + estudio de color) está
desconectado de la capa que realmente pinta la interfaz**. La capa que gana la
cascada es `resolve-theme.css` (2081 líneas, **1038 `!important`**), una piel
"DaVinci" plana que además apaga el vidrio, las sombras y las animaciones de
forma global. Encima de eso, `app.css` (13 571 líneas) conserva un "sistema
premium" antiguo hecho de gradientes, `translateY(-2px)` en hover y bordes
`rgba(255,255,255,.1)`, con hex literales que no responden a la paleta.

Cinco hallazgos que ordenan todo el rediseño:

1. **[REPO] La cascada la deciden los `!important`, no el orden.** Los archivos
   con más `!important` (`resolve-theme.css` 1038, `commercial.css` 188,
   `flat.css` 145, `olyvia.css` 112 ≈ **1 511 declaraciones** en total) son los
   que fijan el look aunque no sean los últimos en importarse. Consecuencia
   medible: `--topbar-h` (36 px, y sus variantes de densidad 32/42) está
   **muerto**, porque `resolve-theme.css` fuerza
   `height/min-height: 34px !important` sobre `.app-shell .topbar`.
2. **[REPO] El "premium" actual es de consumo, no profesional.** Gradiente de
   marca en `button.primary`, `translateY(-2px)` + glow cian en hover,
   `backdrop-filter: blur(8px)` en botones, `--brand-gradient` de 4 colores.
   Linear/Vercel/Raycast y los NLE profesionales hacen lo contrario: superficies
   opacas, hairlines de 1 px, un solo acento y movimiento de 70–150 ms.
3. **[REPO] Hay un contrato de apariencia que el rediseño debe respetar y que la
   capa ganadora ignora en buena parte.** El motor (`state/appearance.ts`) emite
   `--radius-1/2/3` derivados del slider de radio del usuario (2–18 px),
   `--sidebar-width`, `--timeline-row`, `--app-zoom` y los atributos
   `data-density`, `data-reduce-motion`, `data-sidebar`, `data-statusbar`.
   Ningún diseño nuevo puede hardcodear radios ni alturas: deben ser funciones de
   esos valores.
4. **[OBS] Los números que hacen "premium" a una app de escritorio son
   aburridos y pequeños.** VS Code (MIT): titlebar 35 px, activity bar 48 px,
   status bar 22 px con 12 px de texto, menubar 35 px. Carbon (Apache-2.0):
   duraciones 70/110/150/240/400/700 ms y *easing* productivo
   `cubic-bezier(.2,0,.38,.9)`. Linear: hairlines `rgba(255,255,255,.06)`,
   radio máximo 16 px, hover a ~150 ms.
5. **[REPO][OBS] Hay tres deudas de accesibilidad concretas y medibles.**
   (a) `--color-text-faint` sobre `--color-surface` da **3,65:1** y
   `--color-empty` **3,57:1** → fallan AA para texto pequeño; (b) el acento como
   texto de enlace sobre `--color-bg` da **3,69:1** → falla AA; (c) el borde de
   control (`--color-border`) da **1,35:1** → falla 1.4.11 (mínimo 3:1 para
   identificar componentes). Las tres tienen arreglo derivado de los mismos
   tokens, sin tocar la paleta.

**Decisión de cascada recomendada (resumen):** no reescribir `app.css`; crear
`apps/desktop/src/styles/premium/` (6 archivos) importada **al final** de
`main.tsx`, **sin `@layer`** (por el comportamiento invertido de `!important`,
§12), y desactivar primero en `resolve-theme.css` los tres "kill switches"
(`backdrop-filter: none` global, `animation: none`, `--radius-panel: 0`) y el
`34px !important` del topbar. Detalle completo en §12.

---

## 2. Método y trazabilidad

### 2.1 Qué se leyó del repo

| Archivo | Qué se extrajo |
|---|---|
| `apps/desktop/src/styles/tokens.css` (195 líneas) | 34 colores + alias `--commercial-*`/`--olyvia-*`, tipografía 11/12.5/14/15/19/28/36, espacio 4–48, radios 6/8/12/16/20/9999, sombras 7 niveles, vidrio, transiciones, z-index |
| `apps/desktop/src/main.tsx` | orden exacto de las 19 capas CSS importadas |
| `apps/desktop/src/components/AppShell.tsx` | estructura real del shell: `topbar` (brand, home, MenuBar, drag, proyecto+fase, acciones, WindowControls), banners, `app-body` (Sidebar + main), AssistantDock, `app-statusbar` |
| `apps/desktop/src/components/Sidebar.tsx` | rail con grupos (RUTA/HERRAMIENTAS/AYUDA), `nav-more`, `sidebar-tail` con `ProfileMenu` |
| `apps/desktop/src/components/MenuBar.tsx` | menubar + dropdown (`menubar-item`, `menubar-shortcut`, `menubar-check`), modal "Acerca de" con `shortcut-grid` y `data-list` |
| `apps/desktop/src/components/WindowControls.tsx` | 3 botones `window-control` (min/max/close) con `Icon` 13–14 px |
| `apps/desktop/src/components/Icon.tsx` | grid 24, `strokeWidth=1.6`, default `size=18` |
| `apps/desktop/src/state/appearance.ts` | contrato no-color: `scale` (0.85–1.2), `density`, `radius` (2–18), `sidebarWidth` (150–320), `timelineRows` (34–76), `reduceMotion`, `showStatusbar`; variables y `data-*` emitidos |
| `apps/desktop/src/state/theme-palette.ts` (nombrado por `docs/COLOR-CUSTOMIZATION.md`) | 34 tokens editables + presets + contraste + import/export |
| `apps/desktop/src/features/settings/ColorStudioCard.tsx` | estudio de color con `theme-preview` (mini-shell: topbar, rail, panel, clip, waveform, badge, notice, primary) y `contrast-list` |
| `docs/PREMIUM-REDESIGN-PLAN.md` | plan de olas, arquitectura de capas y propiedad de archivos ya acordada (este documento la alimenta) |
| `docs/COLOR-CUSTOMIZATION.md` | contrato de color (34 tokens, derivaciones, reporte de contraste, archivo de tema) |

> **Nota de snapshot.** Las líneas citadas corresponden al **árbol de trabajo**
> del 2026-11-03, que ya tenía cambios sin confirmar en `app.css`,
> `resolve-theme.css`, `main.tsx`, `appearance.ts`, entre otros. Si otro agente
> edita esas zonas, el número de línea puede correr unos renglones: el ancla
> estable es el selector (`archivo:selector`), no el número.

### 2.2 Qué se investigó fuera del repo

Ver §5 (tabla de fuentes y licencias). Prioridad: **MIT/Apache-2.0**.
Se descartó copiar de `LosslessCut` (GPL-2.0, verificado vía API de GitHub):
su UI se puede estudiar, su código no se puede reutilizar en un producto
propietario.

### 2.3 Límites del estudio

- No se ejecutó la app ni se tomaron capturas: los valores **[REPO]** son de
  lectura de código, no de medición en pantalla. Donde la medición importa
  (contraste), se calculó por fórmula WCAG (§11).
- Las apps cerradas (Resolve, Premiere, CapCut, Descript, Opus, Screen Studio,
  Linear, Raycast, Figma) **no publican especificación de UI**; de ellas se
  registran patrones cualitativos y, cuando existen, análisis derivados
  publicados (§5, marcados como derivados).
- Este documento no decide la marca: propone el *sistema*. El acento sigue
  siendo `--color-accent` y el usuario conserva sus 34 colores.

---

## 3. Diagnóstico del repo (evidencia)

### 3.1 Orden de capas y peso de `!important` [REPO]

Import real en `main.tsx` (líneas 5–23) y `!important` contados por archivo:

| # | Capa | Líneas | `!important` |
|---|---|---|---|
| 1 | `tokens.css` | 195 | 0 |
| 2 | `app.css` | 13 571 | 21 |
| 3 | `premium-animations.css` | 482 | 0 |
| 4 | `dopamine-ux.css` | 741 | 0 |
| 5 | `linear-inspired.css` | 611 | 0 |
| 6 | `chrome.css` | 4 752 | 4 |
| 7 | `flat.css` | 609 | 145 |
| 8 | `panda.css` | 271 | 0 |
| 9 | `compliance.css` | 104 | 0 |
| 10 | `scopes.css` | 123 | 0 |
| 11 | `settings.css` | 1 557 | 1 |
| 12 | `home.css` | 479 | 0 |
| 13 | `start-screen.css` | 1 611 | 1 |
| 14 | `resolve-theme.css` | 2 081 | **1 038** |
| 15 | `olyvia.css` | 1 629 | 112 |
| 16 | `effect-studio.css` | 445 | 0 |
| 17 | `brain.css` | 285 | 1 |
| 18 | `commercial.css` | 1 217 | 188 |
| 19 | `shortcuts-and-tour.css` | 534 | 0 |

Cualquier capa nueva con declaraciones **normales** pierde contra las ~1 511
declaraciones `!important` existentes. Esto no es opinión: es la razón por la
que `--topbar-h` no funciona (§3.2).

### 3.2 El topbar mide 34 px y su token de densidad está muerto [REPO]

- `chrome.css:7` define `--topbar-h: 36px` (compact 32 en `:root[data-density='compact']`, spacious 42).
- `chrome.css:34-37` aplica `.app-shell .topbar { height: var(--topbar-h) }` **sin** `!important`.
- `resolve-theme.css:81-87` aplica `.app-shell .topbar { height: 34px !important; min-height: 34px !important; padding: 0 10px !important }`.
- `commercial.css:46-55` aplica `min-height: 48px; padding: 7px 14px; backdrop-filter: blur(8px)` (sin `!important`, por lo tanto pierde).

**Resultado:** barra de 34 px con padding de 14 px y un buscador de 28 px
(`commercial.css:129-135`) → 20 px de contenido útil; el ajuste de densidad
"cómodo/espacioso" del usuario no cambia nada; el vidrio configurado nunca se
pinta. Tres intenciones anuladas por una sola regla.

### 3.3 Los kill switches que hacen que la app se vea plana [REPO]

`resolve-theme.css`:

- `:root { --shadow-panel: none; --glow-accent: none; --radius-panel: 0px }` (15-20).
- `.app-shell * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important }` (28-33) → **mata todo el vidrio**, incluidos `commercial.css` y `settings.css`.
- `.content, .content-flush { animation: none !important }` (36-39) → ninguna entrada de vista.
- `*::-webkit-scrollbar-thumb { border-radius: 0 !important }` (56-59) → scrollbars cuadradas.

No son "gusto": son reglas que impiden implementar el sistema. La capa premium
puede sortearlas con `!important` propios, pero es más barato y más sano
neutralizarlas en origen (Fase 1, §13).

### 3.4 "Premium" heredado que hay que retirar (no sumar) [REPO]

- `app.css:501-513` `button.primary` = `background: var(--brand-gradient)` (4 colores) + `box-shadow` cian + `inset 0 1px 0 rgba(255,255,255,.3)`.
- `app.css:524-530` hover `translateY(-2px)` + glow. Se repite en `app.css:577-613` (segunda definición del mismo "PREMIUM BUTTON SYSTEM": dos bloques con el mismo comentario, uno pisa al otro).
- `app.css:488-497` todos los botones llevan `backdrop-filter: blur(8px)` y borde `rgba(255,255,255,.1)`.
- `app.css:650-657` `.card` = `border-radius: 16px` + `transition: all .3s` (Linear: nunca >16; transición de `all` es un antipatrón de performance).
- `premium-animations.css:168-192` `button { position: relative; overflow: hidden }` + `button::after` con un círculo de 300 px al hacer click: **recorta** focus rings, badges y chevrons de cualquier botón del shell.
- `premium-animations.css:292-313` entradas `translateY(20px)` en 500 ms con delays escalonados: 6× más lentas que el estándar observado (§5).

Conclusión: no falta "más premium", sobra premium de marketplace. El rediseño es
**restar decoración y sumar precisión**, no agregar capas de brillo.

### 3.5 Colores literales que ignoran los 34 tokens [REPO]

Ejemplos en la capa que gana (todos hex fijos):

- `app.css:6247-6248` topbar `rgba(8,11,16,.9)` y `border-bottom: 1px solid #333438`.
- `app.css:6358-6369` sidebar `linear-gradient(180deg,#0b1016,#090d12)` y label `#627387`.
- `app.css:6376-6426` nav `#93a3b6`, activo con `rgba(94,234,212,…)` (cian **no** es el acento), glow `rgba(94,234,212,.7)`.
- `app.css:6489-6503` statusbar `#080c11`, texto `#728499`, `font-size: 8.5px`.
- `app.css:6550-6551` content `radial-gradient(900px 420px at 75% -10%, rgba(94,234,212,.035), transparent 65%), #080b10`.

Consecuencia directa: el usuario cambia el acento en el estudio de color y
**el rail, la statusbar y el fondo del editor no cambian**. `docs/COLOR-CUSTOMIZATION.md`
ya documenta este problema; la capa premium debe ser la que lo cierre, usando
solo `--color-*` y derivaciones `color-mix`.

### 3.6 El contrato de apariencia que hay que respetar [REPO]

`appearanceCssVariables()` (`state/appearance.ts:220-240`) emite:

```
--sidebar-width / --sidebar-min / --sidebar-max   (40 px si rail; 150–320 px si labels)
--radius-1 = radius − 2   --radius-2 = radio del usuario (2–18, default 10)   --radius-3 = radius + 2
--timeline-row  (34–76 px, default 48)
--app-zoom (0.85–1.2)   --app-width   --app-height
--font-ui / --font-display / --font-mono
```

y `applyAppearance()` escribe `data-density`, `data-reduce-motion`,
`data-statusbar`, `data-sidebar` en `<html>`.

Reglas derivadas para el rediseño:

1. **Radios**: ningún valor fijo. Todo radio de UI se calcula con `calc()` sobre `--radius-2` (§6.4).
2. **Densidad**: alturas de shell y de control salen de `data-density`, no de constantes.
3. **Motion**: `data-reduce-motion="true"` y `prefers-reduced-motion` deben apagar animaciones de verdad (§11).
4. **Zoom**: `chrome.css:24-32` usa `zoom` sobre `.app-shell`; los `blur()` de vidrio y los `box-shadow` se escalan con el zoom, así que hay que mantener los valores por debajo de 24 px de blur para no degradar el frame.
5. **Color**: `--color-*` se escriben **inline** en `documentElement`; nunca redefinirlos en CSS. Se derivan hacia tokens nuevos con `color-mix()`.

### 3.7 Deudas de accesibilidad medidas [REPO + cálculo WCAG]

Ratios calculados con la fórmula de luminancia relativa (sRGB) sobre la paleta
`olyvia` (`tokens.css`):

| Par | Ratio | Requisito | Veredicto |
|---|---|---|---|
| `text` sobre `bg` | 17,35:1 | 4,5 | OK |
| `text` sobre `surface` | 15,85:1 | 4,5 | OK |
| `text-muted` sobre `surface` | 6,80:1 | 4,5 | OK |
| `text-secondary` sobre `surface` | 5,00:1 | 4,5 | OK (justo) |
| `text-faint` sobre `surface` | **3,65:1** | 4,5 | **Falla AA** |
| `empty` sobre `surface` | **3,57:1** | 4,5 | **Falla AA** |
| `accent` sobre `bg` (enlaces) | **3,69:1** | 4,5 | **Falla AA** |
| `accent` sobre `bg` (indicador/ícono) | 3,69:1 | 3,0 | OK como no-texto |
| `accent-ink` sobre `accent` (botón) | 5,04:1 | 4,5 | OK |
| `success` / `warning` / `cta` sobre `surface` | 7,58 / 8,04 / 6,07 | 4,5 | OK |
| `danger` sobre `surface` | 4,59:1 | 4,5 | OK (justo) |
| `border` sobre `surface` | **1,35:1** | 3,0 (control) | **Falla 1.4.11** |

**No se cambia la paleta.** Se resuelve por derivación (§6.1 y §11): un token
`--ink-3` legible, un `--link` iluminado y un `--ctl-border` de control.

### 3.8 Otros problemas observados que la capa premium debe corregir

- **Tres fuentes de verdad para la misma pieza**: `.topbar` existe en `app.css` (1 y 6 242), `chrome.css:34`, `resolve-theme.css:81` y `commercial.css:46`; `.icon-button` en `app.css:1852`, `1866`, `3170`, `3185`, `6157`.
- **Tipografía por fuera de escala**: 8,5 px (statusbar, `app.css:6500`), 9 px, 10 px, 11 px, 11,5 px, 12 px, 12,5 px, 13 px conviviendo sin jerarquía.
- **Componentes duplicados con el mismo nombre y distinto aspecto** `card`/`panel`/`modal` en 4 capas.
- **Tooltips por atributo** (`data-tooltip`) ya existen en el shell: es la vía para estandarizar tooltip sin añadir JS.
- **`nav-separator-label` está oculto** (`commercial.css:190-193`) pero el JS lo sigue renderizando (RUTA/HERRAMIENTAS/AYUDA): hay contenido de jerarquía que no se ve.

---

## 4. Principios de diseño

Nueve principios, cada uno con su criterio de aceptación verificable. La columna
"de dónde sale" indica referencia observada; la propuesta es de Olyvia.

| # | Principio | De dónde sale | Criterio de aceptación |
|---|---|---|---|
| 1 | **El trabajo ocupa el centro; el chrome retrocede.** Ningún elemento de shell compite con el preview ni con el timeline. | Figma UI3: el rediseño se presenta como "tu trabajo ocupa el centro del escenario" [OBS]; Resolve/Premiere: chrome neutro [patrón de producto] | En el editor, el 100 % de los píxeles de acento saturado está en controles activos o playhead; el shell es acromático |
| 2 | **Un solo acento, en menos del 5 % de los píxeles.** | Linear: el acento aparece en foco/activo/pills, nunca en fondos [OBS, receta derivada] | Conteo de área cromática por vista ≤ 5 %; el primario es el único relleno de acento |
| 3 | **Precisión antes que efecto: hairlines de 1 px, no glow.** | Linear `rgba(255,255,255,.06)`; VS Code `box-shadow: var(--vscode-shadow-md)` sólo en estados [OBS] | Cero `text-shadow`, cero glow cian, cero gradiente en botones; separadores 1 px `--hairline` |
| 4 | **Profundidad por capas de superficie, no por sombras grandes.** 4 niveles de superficie + 2 de elevación alcanzan. | VS Code/Raycast: elevación discreta; Linear: sombras casi invisibles [OBS] | Máximo 2 sombras simultáneas por pantalla (popover + diálogo) |
| 5 | **Tipografía como jerarquía, no como decoración.** 3 pesos, 4 tamaños por vista como máximo. | VS Code 12 px de statusbar; Carbon/Linear escalas cortas [OBS] | Ninguna vista usa más de 4 tamaños distintos de texto |
| 6 | **Movimiento corto, con propósito y salida rápida.** 70–240 ms; entrada con `ease-entrance`, salida con `ease-exit`. | Carbon 70/110/150/240 ms + curvas [OBS] | Ninguna transición > 400 ms salvo celebración explícita; hover ≤ 110 ms |
| 7 | **Todo responde al tema y al usuario.** Color, radio, densidad, zoom, movimiento reducido. | Contrato de `appearance.ts` + `COLOR-CUSTOMIZATION.md` [REPO] | Test automático: cambiar preset/radio/densidad y verificar 12 elementos del shell |
| 8 | **El foco es visible sin adivinar.** Anillo de 2 px + offset 2, nunca `outline: none` sin reemplazo. | WCAG 2.4.7/2.4.11/2.4.13; VS Code usa `outline-offset: -1px` en items [OBS] | Recorrido de teclado completo en launcher, shell, ajustes y editor sin perder el foco |
| 9 | **Densidad profesional por defecto, confort como opción.** 28 px de control, 32 px de fila, 11–13 px de texto. | VS Code 22 px de statusbar/35 de titlebar; Resolve ~24 px de fila [OBS el primero] | `density=compact` no rompe ningún texto ni recorta iconos |

**Antipatrones prohibidos en la capa premium** (todos existen hoy en el repo):

- `translateY(-2px)`/`-4px` en hover de botones y cards.
- Gradiente de marca como fondo de un botón primario (permitido **una vez** en el launcher, como firma).
- `backdrop-filter` en botones, inputs o cards pequeñas (solo en superficies de chrome: topbar, menubar, popover, diálogo).
- `transition: all`.
- `outline: none` sin anillo de reemplazo.
- Sombras de color (`rgba(94,234,212,.4)`) o glow.
- Más de un radio "grande" (>16 px) por vista.

---

## 5. Lo observado en las referencias

### 5.1 Fuentes primarias verificadas

| Ref | Tipo | Licencia | URL | Qué se observó (textual) |
|---|---|---|---|---|
| **VS Code** | código | MIT | [`titlebarpart.css`](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/browser/parts/titlebar/media/titlebarpart.css) | `.window-controls-container` 138 px; `.window-icon` 46×100 %; `.window-appicon` 35 px; command center `height: 22px` con `border-radius: var(--vscode-cornerRadius-medium)`; titlebar `env(titlebar-area-height, 35px)`; badge de actividad `font-size: 9px; border-radius: 11px`; gap de acciones `4px` |
| **VS Code** | código | MIT | [`activitybarpart.css`](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css) | `.part.activitybar { width: var(--activity-bar-width, 48px) }`; menubar `height: 35px` |
| **VS Code** | código | MIT | [`statusbarpart.css`](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/browser/parts/statusbar/media/statusbarpart.css) | `.part.statusbar { height: 22px; font-size: 12px }`; item `line-height: 22px`, `font-variant-numeric: tabular-nums`, label `padding: 0 5px; margin: 0 3px`; hover con token de fondo; `transition: background-color .15s ease-out` sólo si el motion está habilitado |
| **OpenCut** | código | **MIT** (verificado en `LICENSE`) | [repo](https://github.com/OpenCut-app/OpenCut) · [`apps/web/src/styles.css`](https://raw.githubusercontent.com/OpenCut-app/OpenCut/main/apps/web/src/styles.css) | tokens shadcn en `oklch`; dark: `--border: oklch(1 0 0 / 10%)`, `--input: oklch(1 0 0 / 15%)`; **radio base con multiplicadores**: `--radius: .625rem` → `sm: ×.6`, `md: ×.8`, `lg: ×1`, `xl: ×1.4`, `2xl: ×1.8`; Inter Variable |
| **Carbon** | doc | Apache-2.0 | [Motion](https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview) | `duration-fast-01: 70ms`, `fast-02: 110ms`, `moderate-01: 150ms`, `moderate-02: 240ms`, `slow-01: 400ms`, `slow-02: 700ms`; productive standard `cubic-bezier(.2,0,.38,.9)`, entrance `cubic-bezier(0,0,.38,.9)`, exit `cubic-bezier(.2,0,1,.9)`; guía: micro-interacciones 90–120 ms, `ease-out` a la entrada, motion adaptativo para usuarios con sensibilidad |
| **Linear (receta derivada)** | análisis | contenido público en repo | [`style-recipes/linear.md`](https://raw.githubusercontent.com/ConardLi/garden-skills/main/skills/web-design-engineer/references/style-recipes/linear.md) | espacio 4/8/12/16/24/40/64/96; radios 6/12/16, "**nunca por encima de 16**"; hairline `rgba(255,255,255,.06)`; hover ~150 ms, cambios de layout 350–450 ms con `cubic-bezier(.22,1,.36,1)`; cuerpo 14–15 px, 400–500, `line-height 1.55`; display con tracking −0.02em; "nunca glow, nunca sombra de color" |
| **Linear (extracto)** | análisis | repo público | [`design-extract/linear-app-AGENT.md`](https://github.com/manavarya09/design-extract/blob/5b94e9567c0e4f98a2f4def9e4d549349bec4b29/website/public/gallery/linear-app/linear-app-AGENT.md) | radios 1/4/7/12/16/20; duraciones 100/160/400 ms; pesos 400/510/590; Inter Variable + mono; base 16 px |
| **Raycast (extracto)** | análisis | repo público | [`design-extract/raycast-com-AGENT.md`](https://github.com/manavarya09/design-extract/blob/d2c28da8aae3098a7f7dc02fb4355f3f803edb6c/website/public/gallery/raycast-com/raycast-com-AGENT.md) | radios 2/5/8/11/16/19; duraciones 100/200/300/500 ms; Inter · SF Pro · GeistMono; WCAG declarado 100 % |
| **Figma UI3** | blog | — | [Behind the Redesigned Figma](https://www.figma.com/blog/behind-our-redesign-ui3/) | marco conceptual: el trabajo del usuario toma el centro de la escena (el chrome se reduce a lo esencial) |
| **WCAG 2.2** | estándar | W3C | [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) · [2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) · [2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) · [2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) · [2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) | mínimos 4,5:1 texto / 3:1 no-texto; foco visible y no obstruido; 2 px de perímetro de foco con 3:1 |
| **MDN `@layer`** | doc | CC-BY-SA | [@layer](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer) | "**all important declarations within CSS layers take precedence over any important declarations declared outside of a layer, while all normal declarations within CSS layers have a lower priority than declarations declared outside of a layer**" |
| **LosslessCut** | código | **GPL-2.0** (verificado) | [repo](https://github.com/mifi/lossless-cut) | descartado para copiar código; sirve como referencia de flujo (cortes por keyframe) |

### 5.2 Referencias de producto sin especificación pública

Se listan como material de observación visual para el equipo. **No se les
atribuyen números.**

| Producto | URL | Patrón a estudiar |
|---|---|---|
| DaVinci Resolve | https://www.blackmagicdesign.com/products/davinciresolve | cromo acromático, separadores 1 px, etiquetas en mayúscula, inspector a la derecha, timeline denso; el azul solo en estado activo |
| Adobe Premiere Pro | https://www.adobe.com/products/premiere.html | paneles contiguos sin gap (bordes compartidos), headers de panel con acciones a la derecha |
| CapCut | https://www.capcut.com/ | onboarding por plantillas, cards con thumbnail 9:16, CTA único; densidad amable para no profesionales |
| Descript | https://www.descript.com/ | el texto como interfaz principal: edición "por documento", estados de transcripción en línea |
| Opus Clip | https://www.opus.pro/ | clips como tarjetas con métricas (score, duración, motivo), jerarquía de datos y badges |
| Screen Studio | https://screen.studio/ | presentación premium de un editor simple: un acento, sombras suaves, radios grandes pero únicos, foco en el resultado |

### 5.3 Síntesis de números observados que Olyvia va a adoptar

| Dimensión | Observado | Fuente | Propuesta Olyvia |
|---|---|---|---|
| Statusbar | 22 px, texto 12 px, tabular | VS Code | 24 px (22 compact / 28 spacious), texto 11,5 px, tabular |
| Activity bar / rail | 48 px | VS Code | 48 px (hoy 40) |
| Titlebar | 35 px | VS Code | 44 px (40/48 según densidad) |
| Hairline | `rgba(255,255,255,.06)` / `oklch(1 0 0 / 10%)` | Linear, OpenCut | `color-mix(text 6%, transparent)` |
| Radio máximo | 16 px | Linear | 16 px (`--rad-2xl`) |
| Radio base derivado | `--radius` × multiplicadores | OpenCut/shadcn | `calc()` sobre `--radius-2` del usuario |
| Hover | 100–160 ms | Linear, Carbon | 110 ms `ease-out` |
| Micro-interacción | 70–150 ms | Carbon | 70/90/110 ms |
| Popover | 150–240 ms | Carbon | 150 ms entrada / 110 ms salida |
| Layout move | 350–450 ms | Linear | 240 ms máximo; 400 solo para vista completa |
| Glow / sombra de color | prohibido | Linear | prohibido |

---

## 6. Fundamentos propuestos

### 6.1 Color: derivar de los 34 tokens, nunca redefinirlos [PROP]

Los `--color-*` los escribe el motor **inline** en `<html>`; una regla CSS no
los puede pisar sin `!important` y no queremos pelear con el motor. La capa
premium **deriva** hacia tokens nuevos con `color-mix()`:

```css
:root {
  /* Superficies de chrome (siempre relativas a la paleta) */
  --chrome-1: color-mix(in srgb, var(--color-surface) 82%, var(--color-bg));   /* topbar/menubar */
  --chrome-2: color-mix(in srgb, var(--color-surface) 92%, var(--color-bg));   /* panel headers */
  --chrome-3: var(--color-panel);                                              /* cuerpo de panel */
  --chrome-4: color-mix(in srgb, var(--color-panel-2) 70%, var(--color-panel)); /* cards */

  /* Tinta legible: derivada de la paleta para no tocar los 34 tokens */
  --ink-1: var(--color-text);                                                    /* 15,85:1 sobre surface */
  --ink-2: var(--color-text-muted);                                              /* 6,80:1 OK */
  --ink-3: color-mix(in srgb, var(--color-text-faint) 70%, var(--color-text));    /* 6,09:1 AA (el faint crudo da 3,65) */
  --ink-4: color-mix(in srgb, var(--color-empty) 62%, var(--color-text));         /* 6,90:1 AA (el empty crudo da 3,57) */
  --ink-link: color-mix(in srgb, var(--color-accent) 34%, var(--color-text));   /* enlaces AA */

  /* Estados: fondo + borde + texto, siempre derivados del token semántico */
  --state-hover: color-mix(in srgb, var(--color-text) 5%, transparent);
  --state-active: color-mix(in srgb, var(--color-text) 9%, transparent);
  --state-selected: color-mix(in srgb, var(--color-accent) 14%, transparent);
  --state-selected-border: color-mix(in srgb, var(--color-accent) 42%, transparent);
  --state-danger-soft: color-mix(in srgb, var(--color-danger) 14%, transparent);
  --state-warning-soft: color-mix(in srgb, var(--color-warning) 16%, transparent);
  --state-success-soft: color-mix(in srgb, var(--color-success) 14%, transparent);

  /* Bordes: decorativo vs interactivo (1.4.11) */
  --hairline: 1px solid color-mix(in srgb, var(--color-text) 6%, transparent);
  --hairline-strong: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  --ctl-border: color-mix(in srgb, var(--color-text) 38%, var(--color-border)); /* ≈4,15:1 vs surface */
}
```

Reglas duras:

1. **Prohibido** hex literal en la capa premium. Solo `var(--color-*)`, `var(--commercial-*)` o `color-mix` de estos.
2. **Prohibido** usar `--color-accent` como color de **texto** sobre `bg` (3,69:1). Para texto: `--ink-link`. Para relleno/indicador: `--color-accent` (3:1 cumple no-texto).
3. Los estados usan el token semántico (`--color-danger`), nunca un rojo fijo; así el estudio de color y los presets siguen funcionando.
4. El acento de un tema claro se aclara/oscurece según `color-scheme`, ya resuelto por el motor; la capa premium **no** duplica esa lógica.

### 6.2 Tipografía [PROP]

Escala propuesta (px, no rem: la app se escala con `zoom` + `--app-zoom`, no con
el root font-size; usar `rem` acá duplicaría escalas).

| Token | Tamaño | Peso | Interlineado | Tracking | Uso |
|---|---|---|---|---|---|
| `--type-10` | 10 px | 650 | 1.3 | +0.08em | micro-etiquetas en mayúscula (grupos del rail, headers de panel, badges) |
| `--type-11` | 11 px | 500 | 1.45 | 0 | statusbar, kbd, metadatos, `menubar-shortcut` |
| `--type-12` | 12 px | 500 | 1.5 | 0 | menús, celdas de tabla densa, botones sm, labels de formulario |
| `--type-13` | 13 px | 450 | 1.55 | 0 | **texto base de UI** (reemplaza 12,5 px y 11,5 px dispersos) |
| `--type-14` | 14 px | 450 | 1.6 | 0 | copy largo de vistas, descripciones, onboarding |
| `--type-15` | 15 px | 600 | 1.4 | −0.01em | título de panel/diálogo, `card-header-title` |
| `--type-18` | 18 px | 650 | 1.3 | −0.02em | título de vista (`view-head h1`) |
| `--type-24` | 24 px | 650 | 1.25 | −0.02em | hero secundario, empty state grande |
| `--type-32` | 32 px | 700 | 1.15 | −0.025em | hero del launcher únicamente |

Pesos: `--fw-regular: 450`, `--fw-medium: 550`, `--fw-strong: 650`,
`--fw-black: 700`. `--font-ui` ya es `Segoe UI Variable Text`, que tiene eje de
peso 300–700: 450/550/650 son válidos y no "redondean" a 400/600. Para fallback
estático (`Segoe UI`) hay que aceptar el redondeo y **no** depender de 550 para
distinguir jerarquía (usar tamaño o color).

Reglas:

- `font-variant-numeric: tabular-nums` obligatorio en: statusbar, timecode, duración de clip, monitor de audio, métricas, tablas numéricas.
- `letter-spacing` positivo **solo** en mayúsculas (`--type-10`); negativo solo en ≥18 px.
- `font-feature-settings: 'ss01'` no: Segoe UI no lo necesita y añade riesgo.
- Líneas de texto de lectura: `max-width: 62ch`.
- Nunca bajar de 10 px. Los 8,5 px de la statusbar (`app.css:6500`) desaparecen.
- Tres roles de color de texto: `--ink-1` (primario), `--ink-2` (secundario), `--ink-3` (terciario). Prohibido `--color-empty` para texto < 18 px.

### 6.3 Espaciado [PROP]

Base 4 px, con medios pasos solo donde el ojo los necesita (2 y 6 px). Nombres
numéricos en px: imposible que un revisor escriba "8" pensando "12".

```css
:root {
  --gap-2: 2px;   --gap-4: 4px;   --gap-6: 6px;   --gap-8: 8px;
  --gap-10: 10px; --gap-12: 12px; --gap-16: 16px; --gap-20: 20px;
  --gap-24: 24px; --gap-32: 32px; --gap-40: 40px; --gap-56: 56px; --gap-72: 72px;
}
```

| Contexto | Valor |
|---|---|
| Gap entre icono y label en botón | 6 px |
| Padding horizontal de control md | 10 px |
| Gap entre botones de un grupo | 8 px |
| Gap entre grupos de acciones | 16 px (con divider de 1 px si son >3) |
| Padding de card md | 16 px (20 px en lg) |
| Padding de contenido de vista | 24 px horizontal, 20 px arriba, 40 px abajo |
| Separación entre secciones de una vista | 32 px |
| Gap de grilla de cards | 16 px |
| Padding de menú desplegable | 4 px |
| Padding interno de fila de lista | 0 10 px |
| Gap entre paneles del editor | **0** (borde compartido de 1 px) |

Los `--space-1..8` existentes se mantienen por compatibilidad; la capa premium
usa `--gap-*` y deja la migración de nombres para una limpieza posterior.

### 6.4 Radios [PROP]

Todo derivado de `--radius-2` (radio del usuario; default 10, rango 2–18).
Ningún valor fijo; ningún radio > 16 px.

```css
:root {
  --rad-xs:  max(2px, calc(var(--radius-2) - 6px));   /* 4 con default 10 */
  --rad-sm:  max(3px, calc(var(--radius-2) - 4px));   /* 6 */
  --rad-md:  max(4px, calc(var(--radius-2) - 2px));   /* 8 */
  --rad-lg:  var(--radius-2);                          /* 10 */
  --rad-xl:  calc(var(--radius-2) + 2px);              /* 12 */
  --rad-2xl: min(16px, calc(var(--radius-2) + 6px));   /* 16 (tope) */
  --rad-pill: 9999px;
}
```

| Elemento | Radio |
|---|---|
| kbd, badge, dot, clip del timeline, chip de shortcut | `--rad-xs` |
| botón, input, select, item de menú, icon-button | `--rad-sm` |
| card, panel interno, segmented container | `--rad-md` |
| superficie de panel, toolbar contenedora | `--rad-lg` |
| menú flotante, popover, toast | `--rad-xl` |
| diálogo, command palette | `--rad-2xl` |
| avatar, pill, dot de estado | `--rad-pill` |

Regla de composición: un contenedor con radio R debe tener hijos con radio
`calc(R - padding)` (patrón que ya usa `.segmented` en `settings.css:453`).

### 6.5 Elevación, sombras y hairlines [PROP]

```css
:root {
  --elev-1: 0 1px 1px -0.5px rgba(0,0,0,.24), 0 1px 2px rgba(0,0,0,.16),
            inset 0 1px 0 color-mix(in srgb, var(--color-text) 3%, transparent);
  --elev-2: 0 2px 4px -1px rgba(0,0,0,.28), 0 6px 12px -4px rgba(0,0,0,.24),
            inset 0 1px 0 color-mix(in srgb, var(--color-text) 4%, transparent);
  --elev-3: 0 4px 10px -2px rgba(0,0,0,.30), 0 14px 28px -8px rgba(0,0,0,.34);
  --elev-4: 0 8px 20px -4px rgba(0,0,0,.34), 0 28px 56px -12px rgba(0,0,0,.46);
  --elev-5: 0 12px 28px -6px rgba(0,0,0,.38), 0 48px 96px -18px rgba(0,0,0,.55);
  --shadow-ink: color-mix(in srgb, var(--color-bg) 70%, #000);
  --glass-edge: inset 0 1px 0 color-mix(in srgb, var(--color-text) 6%, transparent);
}
```

| Nivel | Uso | Nota |
|---|---|---|
| 0 | paneles contiguos del editor, topbar, statusbar | solo `--hairline` |
| 1 | card en reposo, control, chip | casi invisible; es el "premium silencioso" |
| 2 | card hover/elevada, dropdown cerrado, kbd | |
| 3 | menú abierto, popover, tooltip, select abierto | máximo en navegación |
| 4 | diálogo modal | |
| 5 | command palette / overlay a pantalla completa | único caso |

**Pendiente de motor (Fase 2):** con tema claro, `rgba(0,0,0,.3)` puede verse
sólido. Propuesta: `appearance.ts` emite `--elev-alpha` (1.0 dark, 0.6 light)
según la luminancia de `bg` y la capa premium multiplica con
`color-mix(in srgb, #000 calc(30% * var(--elev-alpha)), transparent)`. No se
implementa en esta ola.

### 6.6 Vidrio (capas de profundidad) [PROP]

Solo en superficies de chrome (3 usos), nunca en botones/inputs/cards. El vidrio
existe para indicar **qué flota sobre qué**, no para decorar.

| Token | Capa | Valor |
|---|---|---|
| `--glass-hi-bg` | topbar, menubar | `color-mix(in srgb, var(--color-surface) 72%, transparent)` |
| `--glass-hi-blur` | | `blur(12px) saturate(140%)` |
| `--glass-menu-bg` | dropdown, popover, tooltip | `color-mix(in srgb, var(--color-panel-2) 88%, transparent)` |
| `--glass-menu-blur` | | `blur(16px) saturate(150%)` |
| `--glass-dialog-bg` | diálogo, command palette | `color-mix(in srgb, var(--color-panel) 94%, transparent)` |
| `--glass-dialog-blur` | | `blur(20px) saturate(150%)` |
| `--glass-edge` | todas | `inset 0 1px 0 color-mix(text 6%)` |
| `--glass-border` | todas | `1px solid color-mix(in srgb, var(--color-text) 8%, transparent)` |

Reglas: máx. 20 px de blur (con `zoom` 1.2 son 24 px efectivos, el límite
práctico en GPU integrada); `backdrop-filter` **no** se anima; si
`data-reduce-motion="true"`, el vidrio se mantiene (no es movimiento) pero se
quita cualquier transición de opacidad asociada.

**Bloqueante actual:** `resolve-theme.css:28-33` anula todo `backdrop-filter`
con `!important` (§3.3). Sin ese cambio, el vidrio es imposible.

### 6.7 Motion [PROP]

```css
:root {
  --dur-1: 70ms;    /* color/opacidad de estado (botón hover, checkbox) */
  --dur-2: 90ms;    /* press */
  --dur-3: 110ms;   /* hover de superficie, icono */
  --dur-4: 150ms;   /* aparición de menú/tooltip, subrayado de tab */
  --dur-5: 240ms;   /* diálogo, toast, expansión de panel */
  --dur-6: 400ms;   /* entrada de vista completa (raro) */

  --ease-out:        cubic-bezier(0.2, 0, 0.38, 0.9);   /* Carbon productive standard */
  --ease-entrance:   cubic-bezier(0, 0, 0.38, 0.9);     /* Carbon productive entrance */
  --ease-exit:       cubic-bezier(0.2, 0, 1, 0.9);      /* Carbon productive exit */
  --ease-emphasized: cubic-bezier(0.22, 1, 0.36, 1);    /* layout moves ≥200ms */
}
```

| Interacción | Duración | Curva | Distancia/transform |
|---|---|---|---|
| hover de botón (bg/borde/color) | 110 ms | `--ease-out` | ninguna |
| press | 90 ms | `--ease-out` | `scale(.985)` máximo (opcional) |
| focus ring | 0 ms | — | instantáneo (accesibilidad) |
| aparición de menú/popover | 150 ms | `--ease-entrance` | `translateY(-4px)` → 0 + opacity |
| cierre de menú | 110 ms | `--ease-exit` | opacity |
| tooltip | 110 ms | `--ease-out` | opacity, delay 400 ms |
| diálogo | 240 ms | `--ease-emphasized` | `scale(.98)` + opacity |
| cierre de diálogo | 150 ms | `--ease-exit` | opacity |
| toast | 240 ms | `--ease-emphasized` | `translateY(8px)` + opacity |
| cambio de vista | 240 ms | `--ease-out` | opacity + `translateY(6px)`, **sin stagger** |
| acordeón/panel | 240 ms | `--ease-emphasized` | altura |
| shimmer de skeleton | 1 600 ms | `linear` | loop |
| progreso indeterminado | 1 200 ms | `linear` | loop |

Prohibido: springs, `bounce`, `rotate` decorativo, parallax, animaciones de más
de 8 px de recorrido en chrome, stagger de más de 3 ítems, animar
`box-shadow`/`filter`/`backdrop-filter` en superficies grandes, `transition: all`.

### 6.8 Iconografía [PROP]

Estado actual [REPO]: `Icon.tsx` usa grid 24, `strokeWidth="1.6"`,
`strokeLinecap/Linejoin: round`, `aria-hidden`, default `size=18`, tamaños
usados 12/13/14/15/16/17/18 en el shell.

Reglas propuestas:

| Uso | Tamaño | Stroke |
|---|---|---|
| inline en texto, dentro de badge/kbd | 12 px | 1.6 |
| statusbar, chips, indicadores | 14 px | 1.5 |
| **toolbar, nav, menú, botón md** | **16 px** | 1.6 |
| header de panel, empty state | 18–20 px | 1.6 |
| ilustración de empty state / hero | 24 px | 1.5 |

- Alineación óptica: el ícono de 16 px se centra en un box de 16, no de 24; usar `flex` + `place-items:center` y nunca `vertical-align: middle` a mano.
- Color: `currentColor` siempre. Activo = `var(--color-accent)`. Deshabilitado = `opacity: .45` (no cambiar el color del trazo).
- No mezclar familias de íconos: el set actual es de trazo; no introducir íconos rellenos salvo en el logo.
- Iconos que comunican estado deben ir acompañados de texto o `aria-label` (nunca solo color).

### 6.9 Densidad y zoom [PROP]

`data-density` en `<html>` maneja tres juegos de tokens. El zoom del usuario
(`zoom` sobre `.app-shell`) escala todo; por eso las alturas se definen en px y
no en `rem`.

| Token | compact | comfortable (default) | spacious |
|---|---|---|---|
| `--ctl-h-sm` | 22 px | 24 px | 26 px |
| `--ctl-h-md` | 26 px | 28 px | 32 px |
| `--ctl-h-lg` | 30 px | 32 px | 36 px |
| `--row-h` (lista/tabla) | 28 px | 32 px | 36 px |
| `--shell-topbar-h` | 40 px | 44 px | 48 px |
| `--shell-statusbar-h` | 22 px | 24 px | 28 px |
| `--shell-panel-head-h` | 28 px | 32 px | 36 px |
| `--shell-toolbar-h` | 32 px | 36 px | 40 px |
| `--shell-content-pad-y` | 16 px | 20 px | 28 px |
| `--shell-nav-item-h` | 28 px | 32 px | 36 px |

`--timeline-row` **no** se redefine en la capa premium: es del usuario
(34–76 px, default 48).

---

## 7. Tabla maestra de tokens nuevos

Convención: `--shell-*` estructura, `--ctl-*` controles, `--gap-*` espacio,
`--rad-*` radios, `--elev-*` sombras, `--glass-*` vidrio, `--dur-*`/`--ease-*`
movimiento, `--hl-*`/`--ink-*` color semántico derivado, `--tl-*` timeline.

### 7.1 Shell

| Token | Valor propuesto | Uso | Mapeo / derivación |
|---|---|---|---|
| `--shell-topbar-h` | 44 px (40/48 por densidad) | altura del topbar | reemplaza `--topbar-h` (36 px, hoy anulado por `!important`) |
| `--shell-menubar-item-h` | 24 px | hit-area de cada menú | nuevo; hoy `padding: 4px 8px` |
| `--shell-menubar-gap` | 2 px | separación entre menús | `commercial.css:95` usa 2 px |
| `--shell-brand-w` | 132 px | ancho de marca en topbar | nuevo |
| `--shell-winctl-w` | 46 px por botón (Windows) | ventana | VS Code 46 px [OBS]; hoy 38 px |
| `--shell-rail-w` | 48 px | rail colapsado | VS Code activity bar 48 px [OBS]; hoy 40 px (`appearance.ts:221`) |
| `--shell-sidebar-w` | `var(--sidebar-width)` | sidebar expandida | **no** crear: usar la del motor |
| `--shell-nav-item-h` | 32 px (28/36) | ítem de navegación | hoy `min-height: 38px` (`app.css:6378`) |
| `--shell-nav-pad-x` | 8 px | padding horizontal | `commercial.css:152` 8 px |
| `--shell-statusbar-h` | 24 px (22/28) | statusbar | `app.css:6490` 24 px, mantener |
| `--shell-panel-head-h` | 32 px (28/36) | header de panel | nuevo |
| `--shell-toolbar-h` | 36 px (32/40) | barras de herramientas | `resolve-theme` fuerza 34/32/26 dispersos |
| `--shell-tab-h` | 32 px | tabs de vista | nuevo |
| `--shell-content-pad-x` | 24 px | padding de contenido | `commercial.css:203` 22 px |
| `--shell-content-pad-y` | 20 px (16/28) | padding superior | `start-screen`/`.view` 22 px |
| `--shell-content-pad-b` | 40 px | padding inferior | `.view` 44 px |
| `--shell-dock-w` | 340 px | AssistantDock | nuevo (hoy sin token) |
| `--shell-divider` | `1px solid var(--hairline)` | separadores | reemplaza `#333438`, `#1a2430` |

### 7.2 Superficies, tinta y estados

| Token | Valor propuesto | Uso | Mapeo / derivación |
|---|---|---|---|
| `--chrome-1` | `color-mix(surface 82%, bg)` | topbar, statusbar | reemplaza `rgba(8,11,16,.9)` |
| `--chrome-2` | `color-mix(surface 92%, bg)` | headers de panel, sidebar | reemplaza gradiente `#0b1016→#090d12` |
| `--chrome-3` | `var(--color-panel)` | cuerpo de panel/card | `--color-panel` |
| `--chrome-4` | `color-mix(panel-2 70%, panel)` | card elevada | `--color-panel-2` |
| `--ink-1` | `var(--color-text)` | texto primario | `--color-text` |
| `--ink-2` | `var(--color-text-muted)` | secundario | `--color-text-muted` (6,8:1) |
| `--ink-3` | `color-mix(text-faint 70%, text)` | terciario AA | corrige 3,65:1 → **6,09:1** |
| `--ink-4` | `color-mix(empty 62%, text)` | terciario débil / íconos | corrige 3,57:1 → **6,90:1** |
| `--ink-link` | `color-mix(accent 34%, text)` | enlaces (AA) | corrige 3,69:1 |
| `--hairline` | `1px solid color-mix(text 6%, transparent)` | separador decorativo | Linear 6 % [OBS] |
| `--hairline-strong` | `1px solid color-mix(text 10%, transparent)` | borde de card/panel | OpenCut 10 % [OBS] |
| `--ctl-border` | `color-mix(text 38%, border)` | borde de control (≥3:1) | corrige 1,35:1 (1.4.11) |
| `--state-hover` | `color-mix(text 5%, transparent)` | hover de superficie | reemplaza `rgba(255,255,255,.06)` |
| `--state-active` | `color-mix(text 9%, transparent)` | press/selección de fila | nuevo |
| `--state-selected` | `color-mix(accent 14%, transparent)` | ítem activo del rail | hoy cian fijo |
| `--state-selected-border` | `color-mix(accent 42%, transparent)` | borde de activo | `commercial.css:171` 42 % |
| `--state-danger-soft` | `color-mix(danger 14%, transparent)` | banner/pill de error | reemplaza `rgba(239,68,68,…)` |
| `--state-warn-soft` | `color-mix(warning 16%, transparent)` | aviso | reemplaza literales |
| `--state-success-soft` | `color-mix(success 14%, transparent)` | éxito | reemplaza literales |

### 7.3 Tipografía, espacio, radio

| Token | Valor propuesto | Uso | Mapeo |
|---|---|---|---|
| `--type-10…--type-32` | 10/11/12/13/14/15/18/24/32 px | escala completa | reemplaza 8,5/11,5/12,5 dispersos; conserva `--text-xs/sm/base` como alias |
| `--fw-regular` | 450 | cuerpo | Segoe UI Variable admite el eje |
| `--fw-medium` | 550 | labels, botones | hoy 500/600 mezclados |
| `--fw-strong` | 650 | títulos | hoy 700/750/800 |
| `--track-caps` | 0.08em | mayúsculas 10 px | hoy 0.14–0.16em (excesivo) |
| `--track-tight` | −0.02em | títulos ≥18 px | nuevo |
| `--lh-ui` | 1.45 | controles/labels | nuevo |
| `--lh-body` | 1.6 | copy | token existente `--leading` 1.5 → 1.6 |
| `--gap-*` | 2…72 px | espacio | ver §6.3 |
| `--rad-xs…--rad-2xl` | 4/6/8/10/12/16 | radios | derivados de `--radius-2` |
| `--rad-pill` | 9999 px | pills | = `--radius-full` |

### 7.4 Controles

| Token | Valor propuesto | Uso | Mapeo |
|---|---|---|---|
| `--ctl-h-xs` | 22 px | kbd, badge alto, chip | nuevo |
| `--ctl-h-sm` | 24 px | botón sm, menubar item | nuevo |
| `--ctl-h-md` | 28 px | **control estándar** | hoy 24–38 px según capa |
| `--ctl-h-lg` | 32 px | input/CTA de formulario | nuevo |
| `--ctl-h-xl` | 36 px | hero CTA del launcher | hoy `padding: 10px 24px` |
| `--ctl-px-sm` | 8 px | padding x de sm | nuevo |
| `--ctl-px-md` | 10 px | padding x de md | nuevo |
| `--ctl-px-lg` | 14 px | padding x de lg | nuevo |
| `--ctl-gap` | 6 px | icono↔label | coincide con `AppShell` (6–7 px) |
| `--icon-sm` | 14 px | inline | usado hoy |
| `--icon-md` | 16 px | toolbar/nav | usado hoy |
| `--icon-lg` | 20 px | empty state | nuevo |
| `--focus-ring-w` | 2 px | anillo de foco | WCAG 2.4.13 |
| `--focus-ring-offset` | 2 px | separación | nuevo |
| `--focus-ring` | `0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent)` | doble anillo con "hueco" | funciona sobre cualquier fondo |
| `--focus-ring-inset` | `inset 0 0 0 2px color-mix(accent 80%, transparent)` | filas, celdas, clips | evita recorte por `overflow:hidden` |
| `--disabled-opacity` | 0.45 | deshabilitado | hoy 0.32/0.4/0.45/0.5 |

### 7.5 Datos, timeline y overlays

| Token | Valor propuesto | Uso | Mapeo |
|---|---|---|---|
| `--badge-h` | 18 px (20 lg) | badge/chip de estado | nuevo |
| `--badge-font` | 10 px / 650 / +0.06em | texto de badge | nuevo |
| `--chip-h` | 22 px | chip removible/filtro | nuevo |
| `--kbd-h` | 18 px | tecla | nuevo; hoy hereda y queda desparejo |
| `--kbd-bg` | `color-mix(text 7%, transparent)` | tecla | nuevo |
| `--kbd-border` | `1px solid color-mix(text 10%, transparent)` + `inset 0 -1px 0 color-mix(text 8%)` | efecto tecla física | nuevo |
| `--row-h` | 32 px (28/36) | fila de lista/tabla | nuevo |
| `--table-head-h` | 28 px | header de tabla | nuevo |
| `--dot-size` | 6 px | dot de estado | hoy 6/7/10 px |
| `--tl-ruler-h` | 28 px | regla del timeline | nuevo |
| `--tl-track-head-w` | 160 px (120 colapsado) | cabecera de pista | nuevo |
| `--tl-clip-radius` | `var(--rad-xs)` | clip | nuevo |
| `--tl-clip-pad` | `4px 6px` | contenido de clip | nuevo |
| `--tl-playhead-w` | 1 px (+1 px de halo 8 %) | playhead | hoy con glow |
| `--tl-wave-alpha` | 0.55 | waveform sobre clip | nuevo |
| `--tl-sel-ring` | `inset 0 0 0 1.5px color-mix(accent 90%, white 10%)` | clip seleccionado | nuevo |
| `--tl-snap-guide` | `1px dashed color-mix(accent 60%, transparent)` | guía de snap | nuevo |
| `--scrim` | `color-mix(in srgb, #000 55%, transparent)` | backdrop de diálogo | hoy `rgba(0,0,0,…)` variables |
| `--scrim-blur` | `blur(2px)` | backdrop | opcional; se apaga con reduce-motion |

### 7.6 Qué **no** se toca

- Las 34 variables `--color-*` y sus alias `--commercial-*`, `--olyvia-*`: las escribe el motor inline.
- `--primary-hue`, `--brand-gradient*`, `--glow-*`, `--shadow-*`: se dejan por compatibilidad; la capa premium no las usa (salvo `--brand-gradient` en el único CTA de marca del launcher).
- `--sidebar-width*`, `--timeline-row`, `--app-zoom`, `--app-width/height`, `--font-*`: los emite `appearance.ts`; se consumen, no se redefinen.
- Los `data-*` del `<html>`: se consumen como selectores de densidad/motion.

---

## 8. Especificación de componentes

Para cada componente: **anatomía**, **medidas**, **estados** (reposo / hover /
active / focus-visible / disabled / loading), **tokens** y **selector legacy a
ganar**. Todos los tamaños en px, sin `rem`.

### 8.1 Botón

Anatomía: `[icono 16] gap 6 [label]`. Sin pseudo-elementos decorativos.

| Variante | Reposo | Hover | Active | Focus |
|---|---|---|---|---|
| **primary** | `bg: var(--color-accent)`, `color: var(--color-accent-ink)`, `border: 1px solid color-mix(accent 80%, #000)`, `box-shadow: inset 0 1px 0 color-mix(#fff 14%, transparent)` | `bg: color-mix(accent 90%, var(--color-text))` | `bg: color-mix(accent 86%, #000)`, `transform: none` | doble anillo `--focus-ring` |
| **secondary** | `bg: var(--chrome-4)`, `border: --hairline-strong`, `color: --ink-1` | `bg: var(--chrome-3)`, borde 14 % | `bg: color-mix(panel-3 80%, panel-2)` | idem |
| **ghost** | transparente, `border: 1px solid transparent`, `color: --ink-2` | `bg: --state-hover`, `color: --ink-1` | `bg: --state-active` | idem |
| **danger** | `bg: var(--state-danger-soft)`, `border: color-mix(danger 45%, transparent)`, `color: color-mix(danger 70%, text)` | `bg: color-mix(danger 22%, transparent)` | `bg: color-mix(danger 30%, transparent)` | anillo con `--color-danger` |
| **icon** | 28×28, `--rad-sm`, icono 16 centrado | `bg: --state-hover`, color `--ink-1` | `bg: --state-active` | anillo interior si está en toolbar |
| **link** | sin caja, `color: --ink-link`, `text-decoration: underline`, `text-underline-offset: 2px` | `text-decoration-thickness: 2px` | — | anillo |

Medidas: `h: var(--ctl-h-md)` (28), `padding: 0 var(--ctl-px-md)`, `font: 500 var(--type-12)/1 var(--font-ui)`, `letter-spacing: .01em`, `--rad-sm`.
Tamaños: `sm` 24 / `md` 28 / `lg` 32 / `xl` 36 (launcher). Loading: spinner 12 px
+ label, `aria-busy="true"`, ancho fijo para no saltar.
Prohibido: gradiente, `translateY`, glow, `backdrop-filter`, `overflow: hidden`.

Selector legacy a ganar: `button.primary, button.ghost, button.small, .icon-button` (`app.css:482-571`), `premium-animations.css:175-192` (`button::after`).

### 8.2 Input / textarea / search

- Alto `--ctl-h-md` (28) / `lg` 32 en formularios; `--rad-sm`; `padding: 0 10px`.
- Fondo: `color-mix(in srgb, var(--color-bg) 74%, var(--color-surface))` (pozo, más oscuro que la superficie).
- Borde: `--ctl-border` (≥3:1). Hover: borde `color-mix(text 46%, border)`.
- Focus: `border-color: var(--color-accent)` + `box-shadow: 0 0 0 3px color-mix(accent 18%, transparent)`.
- Placeholder: `--ink-3`. Texto: `--ink-1`, `--type-13`.
- Label: `--type-11`, 650, mayúscula, `+0.06em`, `--ink-2`, separación 6 px.
- Ayuda: `--type-11`, `--ink-3`. Error: borde `color-mix(danger 70%, transparent)`, halo `danger 14 %`, mensaje con icono 12 px.
- Input con icono: icono 14 px a 8 px del borde, `padding-left: 28px`.
- Search del topbar: alto 28, ancho 200–280 px, `--rad-sm`, incluye `kbd` a la derecha.
- Textarea: `padding: 8px 10px`, `min-height: 72px`, `resize: vertical`.
- Numérico/path: `font-family: var(--font-mono)`, `font-size: var(--type-12)`, `tabular-nums`.

Legacy: `app.css` `.input-*`, `resolve-theme.css` alturas 24/26/32 px forzadas.

### 8.3 Select / dropdown

Caja igual a input; chevron 14 px a 8 px de la derecha con `padding-right: 26px`.
Menú: `--elev-3`, `--rad-xl`, `--glass-menu-*`, borde `--glass-border`, padding 4 px.
Ítem: alto 28, padding `0 8px`, `--rad-sm`, icono 14 + label 12 + check 13 a la
derecha; hover `--state-selected` (acento 14 %) **o** `--state-hover` (neutro)
según si es menú de comando o de valor. Separador: `--hairline` con margen 4 px 8 px.
Máx. 8 ítems visibles antes de scroll; ancho mínimo = ancho del trigger.

### 8.4 Card

- Fondo `--chrome-4`, borde `--hairline-strong`, `--rad-md`, `--elev-1`, padding 16 (lg 20).
- Header: alto 36, título `--type-13/600` + `--ink-1`, acciones ghost 24 px a la derecha; separado con `--hairline`.
- Body: gap 12; Footer: gap 8, alineado a la derecha.
- Interactiva: hover `border-color: color-mix(text 16%, transparent)` + `--elev-2`; **sin** `translateY`.
- Focus: `--focus-ring-inset` (no crece el layout).
- Thumbnail (proyectos/plantillas): `aspect-ratio: 16/9`, `--rad-sm`, `object-fit: cover`, overlay de duración abajo a la derecha con badge negro 55 %.
- Prohibido: gradiente de fondo, `card-glow`, `animated-border`.

Legacy: `.card` (`app.css:650`), `.card-glow`, `.card-gradient-primary`, `.card-animated`.

### 8.5 Panel

- Superficie `--chrome-3`, borde compartido `--hairline` (panel contiguo, gap 0).
- Header `--shell-panel-head-h` (32): etiqueta `--type-10/650` mayúscula `+0.08em` `--ink-3`, acciones 24 px; opcional contador `badge` neutro.
- Subheader de sección: 28 px, `--type-12/550`.
- Contenido: padding 12 (compact 8, spacious 16).
- Panel colapsable: header clickeable con chevron 14 que rota 90°, `--dur-5`.
- Resizer: 4 px, `cursor: col-resize`, hover `--color-accent` 40 %; `:focus-visible` visible.
- Estado vacío interno: ver 8.13.

### 8.6 Tabs y segmented

**Tabs de vista (underline):** alto 32; label `--type-12/550` `--ink-2`; activo
`--ink-1` + indicador 2 px inferior `--color-accent` con `--rad-xs` arriba;
hover `--ink-1`; separación 16 px entre tabs; badge de conteo opcional.
**Segmented (control):** contenedor alto 28, padding 2, `--rad-md`, borde
`--ctl-border`, fondo `--chrome-3`; ítem alto 24, `--rad-sm`, `--type-11/550`;
activo `bg: --color-panel-3`, `--ink-1`, `inset 0 1px 0 color-mix(text 6%)`,
`--elev-1`; inactivo `--ink-2`, hover `--state-hover`. Transición 110 ms solo de
color de fondo.
Ya existe `.segmented` correcto en `settings.css:439-462`: se toma como base y
se le agregan foco y densidad.

### 8.7 Badge y chip

**Badge** (no interactivo): alto 18 (lg 20), padding `0 6px`, `--rad-xs`,
`--badge-font`, variantes:

| Variante | Fondo | Texto |
|---|---|---|
| neutral | `color-mix(text 8%, transparent)` | `--ink-2` |
| accent | `color-mix(accent 16%, transparent)` | `color-mix(accent 55%, text)` |
| success / warning / danger | `--state-*-soft` | `color-mix(state 62%, text)` |
| outline | transparente + `--hairline-strong` | `--ink-2` |
| solid | `var(--color-accent)` | `var(--color-accent-ink)` |

Conteo: `min-width: 18px`, `padding: 0 5px`, `tabular-nums`, `--rad-pill`.
Dot de estado: 6 px (`--rad-pill`) + halo 8 % opcional.
**Chip** (interactivo): alto 22, `--rad-pill`, `--hairline-strong`, fondo
`color-mix(text 4%)`, label 11/550, icono 14, botón de quitar 14 con
`--focus-ring-inset`. Hover: fondo text 7 %. Seleccionado: `--state-selected` +
borde `--state-selected-border`.

Legacy: `.badge-*` (6 variantes), `.tag`, `.tag-sm`, `.tag-lg`, `.chip`.

### 8.8 Dialog / modal / command palette

- **Backdrop**: `--scrim` + `blur(2px)` opcional; click cierra salvo `destructive`.
- **Panel**: `--rad-2xl`, `--glass-dialog-*`, `--elev-4`, borde `--glass-border`.
- **Anchos**: sm 440 / md 560 / lg 760 / xl 920 px; `max-height: min(86dvh, 720px)`.
- **Header**: 52 px, título `--type-15/600` `--ink-1`, subtítulo `--type-12` `--ink-2`, close icon 28 a la derecha; borde inferior `--hairline`.
- **Body**: padding 20, scroll propio (`overflow:auto`), `gap: 16`.
- **Footer**: 56 px, borde superior `--hairline`, botones a la derecha (orden: secundario, primario), gap 8.
- **Command palette**: ancho 640, arriba a 12 % del viewport, input sin borde (36 px) con icono 16, lista de resultados con filas de 32, sección `--type-10`, shortcut a la derecha en `kbd`, item activo `--state-selected` con barra izquierda 2 px de acento. `role="dialog" aria-modal="true"`, foco inicial en el input, `Escape` cierra, foco atrapado y restituido.
- Animación: entrada 240 ms `--ease-emphasized` (`scale .98`), salida 150 ms.
- Prohibido: `alert()`/`confirm()` nativos (hay que usar estos diálogos).

Legacy: `.modal`, `.app-modal`, `.modal-*` en `app.css` y `chrome.css`.

### 8.9 Tooltip

- Fondo `--glass-menu-bg`, borde `--glass-border`, `--rad-md`, `--elev-3`, padding `4px 8px`.
- Texto `--type-11/500` `--ink-1`; `max-width: 280px`; `white-space: normal`.
- Flecha de 6 px opcional; offset 6 px del trigger; se posiciona arriba y voltea si no hay lugar.
- Aparición 110 ms con delay 400 ms; salida inmediata (0–70 ms) al mover el mouse.
- Contenido: frase corta + `kbd` del atajo separado por `·`. Nunca párrafos.
- Si el trigger tiene `aria-label`, el tooltip no lo duplica: es refuerzo visual.
- En el repo ya existe el patrón `data-tooltip` en el shell: la capa premium debe estilizarlo (y añadir `data-tooltip-side`).

### 8.10 Toast / notificación

- Ancho 320–400, `--rad-xl`, `--chrome-4`, `--hairline-strong`, `--elev-4`, padding `10px 12px`.
- Anatomía: icono 16 (estado) + bloque título `--type-12/600` + descripción `--type-11` `--ink-3` + acción ghost 24 + close 24.
- Barra de progreso de 2 px al pie si es temporizado.
- Posición: abajo-derecha, offset 16; pila `gap: 8`, máximo 3 visibles, 4.º reemplaza al más viejo.
- Duraciones: éxito 4 000 ms, info 5 000 ms, error 8 000 ms, con acción = persistente hasta interacción.
- Entrada 240 ms desde `translateY(8px)`, salida 150 ms; `role="status"` (éxito/info) o `role="alert"` (error).
- `aria-live` ya está en el assistant (`role="log"`), no duplicar.

Legacy: `.notification-*` en `premium-animations.css`.

### 8.11 Empty state

- Contenedor centrado, `padding: 32px`, `max-width: 420px`, texto centrado.
- Icono 24 px dentro de un tile de 40×40, `--rad-md`, `bg: color-mix(text 4%)`, borde `--hairline`.
- Título `--type-15/600`; descripción `--type-13` `--ink-2`, `max-width: 42ch`.
- Acciones: primario + ghost (o solo primario si hay un único camino).
- Variante "aprendizaje": fila de 3 pasos numerados 20 px con `kbd` donde aplique.
- Nunca usar una ilustración grande sin jerarquía: el icono en tile es suficiente y escala con el tema.
- Ya existen `.empty-state` y `.empty-inline` (`app.css`): se reescriben visualmente, se conserva el markup.

### 8.12 Tabla y lista

- Header 28 px, `--type-10/650` mayúscula `+0.06em` `--ink-3`, sticky con
  `background: --chrome-2` y borde inferior `--hairline`.
- Fila `--row-h` (32), separador `1px color-mix(text 5%)`; hover fila
  `color-mix(text 4%)`; seleccionada `--state-selected` + barra izquierda 2 px
  de acento; focus `--focus-ring-inset`.
- Celdas: padding `0 10px`; numéricas a la derecha con `tabular-nums`.
- Orden: indicador 12 px junto al label, inactivo `--ink-4`.
- Densidad compacta: `--row-h: 28` (por `data-density`).
- Lista simple: alto 32–40 con avatar/thumb 24, título 12/550, meta 11 `--ink-3`, acción a la derecha que aparece en hover **y** siempre con focus.
- Vacío: 8.11. Carga: 5 filas skeleton (shimmer 1 600 ms) del alto real.

### 8.13 Toolbar

- Alto `--shell-toolbar-h` (36), padding `0 8px`, gap 4, bordes `--hairline` arriba/abajo si separa zonas.
- Grupos separados por divider de 1×20 px con margen 6 px.
- Botones icon 28×28; toggle con `aria-pressed` y fondo `--state-selected`.
- Selector de zoom/valor con `font-mono` 12 y ancho fijo para no saltar.
- Los botones destructivos nunca quedan en el grupo principal: van en overflow.

### 8.14 kbd (tecla)

- Alto 18, `min-width: 20`, padding `0 4px`, `--rad-xs`, `--kbd-bg`,
  `--hairline-strong` + `inset 0 -1px 0 color-mix(text 8%)` (efecto tecla).
- `font-family: var(--font-mono)`, `font-size: 10.5px`, 600, `--ink-2`, `line-height: 1`.
- Combinaciones: `Ctrl` `K` separadas por 3 px; el separador textual es `·`.
- En menús: alineado a la derecha, `--ink-3`, sin caja (solo texto mono) para no competir con el label.
- Accesible: `<kbd>` real, no `<span>`.

---

## 9. Layout de shell con medidas exactas

### 9.1 Diagrama vertical

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOPBAR  44px  ─────────────────────────────────────────────────────────  │
│ [marca 22 + wordmark] │ [Inicio 24] │ [menubar 24/ítem] │ ← drag →      │
│                       │ [proyecto 26 + fase] │ [buscar 28] [undo 28] …  │
│                       │ [Exportar 28] │ [divider] │ [atajos/tour/ajustes] │
│                       │ [window controls 46×3]                          │
├──────────────────────────────────────────────────────────────────────────┤
│ BANNER (opcional) 32px  [icono 14] mensaje .................. [acción]   │
├───────────┬──────────────────────────────────────────────────────────────┤
│ RAIL 48px │ CONTENT  (padding 24 / 20 / 40)                              │
│ (o 216px) │                                                              │
│ items 32  │                                                              │
│ …         │                                                              │
│ ─ tail ─  │                                                              │
│ dot+proj  │                                                              │
│ avatar 28 │                                                              │
├───────────┴──────────────────────────────────────────────────────────────┤
│ STATUSBAR 24px  ● proyecto · 1920×1080 · 30fps …… atajos · estado · local │
└──────────────────────────────────────────────────────────────────────────┘
```

### 9.2 Medidas por zona

| Zona | Medida propuesta | Hoy [REPO] | Token | Riesgo |
|---|---|---|---|---|
| Topbar alto | **44 px** (40/48) | 34 px forzado | `--shell-topbar-h` | medio: `resolve-theme.css` `!important`; tests de shell |
| Topbar padding x | 8 px izq / 0 der (los window controls van al borde) | 10 px + `-8px` margin en `.window-controls` | — | bajo |
| Topbar gap | 8 px | 10 px | `--gap-8` | bajo |
| Marca: mark | 22×22, `--rad-xs` | 22×22 `--rad-sm` (`commercial.css:64-70`) | — | bajo |
| Marca: wordmark | 12.5 px / 650 / `+0.01em` | 12 px / 750 | `--type-12` | bajo |
| Marca: divider | 1×20 px, `--hairline` | `commercial.css:60` | — | bajo |
| Menubar item | alto 24, padding 0 8, `--rad-sm` | padding 4/8 | `--shell-menubar-item-h` | bajo |
| Menubar gap | 2 px | 2 px | — | — |
| Menubar dropdown | ancho mín. 240 / máx. 360; ítem 28; shortcut 11 mono | sin medida fija | `--elev-3` | bajo |
| Botón Home | alto 24, padding 0 9, gap 6, icono 14 | 24 px (`resolve-theme:93`) | `--ctl-h-sm` | bajo |
| Project chip | alto 26, padding 0 8, `--rad-sm`; nombre 12.5/600 truncado 220 px; fase 11/500 + dot 6 | 4px 10px / `--rad-lg` | — | bajo |
| Buscar | alto 28, ancho 200–280, icono 14, `kbd` derecha | 28 px (`commercial:130`) | `--ctl-h-md` | bajo |
| Icon buttons topbar | 28×28, icono 16, gap 4, divider 1×20 | `.icon-button` 28–34 variable | `--ctl-h-md` | bajo |
| Exportar | alto 28, padding 0 12, `--rad-sm`, primario sólido | 24 px / `--rad-4` / acento plano | `--ctl-h-md` | bajo |
| Window controls | 46×44 c/u (Windows), close `#c42b1c` en hover | 38×100 % | `--shell-winctl-w` | bajo (verificar con barra nativa) |
| Rail | **48 px**; ítems 32 alto, icono 16, padding 0 8; activo `--state-selected` + barra 2 px | 40 px (`appearance.ts:221`) | `--shell-rail-w` | **alto**: `--sidebar-min/max` son 40 en rail; requiere cambio en `appearance.ts` |
| Sidebar labels | ancho `--sidebar-width` (150–320, default propuesto **216**) | default 172 | — | medio: cambia default persistido |
| Nav separador de grupo | etiqueta `--type-10/650` `+0.08em` `--ink-3`, margen 12 px 8 px 6 px | `commercial.css:190` la **oculta** | — | bajo (decidir: mostrarla) |
| Statusbar | **24 px**, padding 0 10, gap 8, `--type-11`, `tabular-nums`; ítem hover `bg: --state-hover`, `--rad-xs` | 24 px, `font-size: 8.5px` | `--shell-statusbar-h` | bajo |
| Content | padding 24 / 20 / 40; `max-width: 1500px` centrado | 18/22/30 y 22/24/44 | `--shell-content-pad-*` | bajo |
| Panel header | 32 px | disperso 24–34 | `--shell-panel-head-h` | bajo |
| Toolbar editor | 36 px | 34/32/26 | `--shell-toolbar-h` | medio (timeline) |
| Tabs | 32 px | variable | `--shell-tab-h` | bajo |
| Dock del asistente | 340 px, header 40 | sin token | `--shell-dock-w` | medio: `AssistantDock` tiene 71 KB de lógica |
| Tamaño mínimo de ventana | 1 024×640 | `min-height: 560px` | — | bajo |

### 9.3 Jerarquía de paneles (regla de 3 niveles)

1. **Nivel 1 — chrome persistente**: topbar, rail/sidebar, statusbar. Fondo
   `--chrome-1`, borde `--hairline`, nunca scrollean.
2. **Nivel 2 — paneles de trabajo**: preview, timeline, inspector, asistente.
   Fondo `--chrome-3`, headers `--chrome-2`, bordes compartidos, gap 0.
3. **Nivel 3 — contenido y tarjetas**: vistas de herramientas, cards, filas.
   Fondo `--color-bg` o `--chrome-4`, `--rad-md`, `--elev-1` solo si son
   interactivas.

Regla: **un elemento de nivel N nunca usa el fondo de nivel N-2**; así se evita
el "todo flota" actual, donde cards, paneles y modales compiten.

### 9.4 Estados de interacción (definición única para todo el shell)

| Estado | Regla | Aplicación |
|---|---|---|
| reposo | sin sombra o `--elev-1` | — |
| hover | `--state-hover` (5 %) + `--dur-3`; **sin** transform | botones, filas, ítems |
| hover en superficie grande (card) | sube borde a `text 16 %` y `--elev-2` | cards |
| active/press | `--state-active` (9 %), `--dur-2`, `scale(.985)` opcional | botones |
| selected (persistente) | `--state-selected` + `--state-selected-border` + barra 2 px izq | rail, fila, tab, clip |
| focus-visible | `--focus-ring` (exterior) o `--focus-ring-inset` | todo |
| disabled | `--disabled-opacity: .45`, `cursor: not-allowed`, sin hover | todo |
| loading | spinner 12 + `aria-busy`, sin cambio de tamaño | botones, filas |
| invalid | borde `danger 70 %` + halo 14 % + mensaje 11 | inputs |

---

## 10. Workspace y densidad de timeline

### 10.1 Medidas propuestas [PROP]

| Elemento | Medida | Nota |
|---|---|---|
| Regla (ruler) | 28 px, marcas mayores 1×8, menores 1×4, label 9.5 px mono `--ink-3` | `tabular-nums` |
| Cabecera de pista | 160 px (colapsable a 120), fondo `--chrome-2` | |
| Alto de pista | `var(--timeline-row)` (34–76, default 48) | **del usuario** |
| Clip | `--rad-xs`, borde 1 px `color-mix(kind 45%, transparent)`, padding `4px 6px`, label 10.5/600, `min-width: 12px` | color por `--color-video/audio/caption/...` |
| Waveform | barras 1 px, gap 1 px, `alpha .55`, fondo del clip `color-mix(kind 18%, transparent)` | sin glow |
| Playhead | 1 px `--color-accent` + halo `0 0 0 1px color-mix(accent 10%)`; handle 9×9 en la regla | sin `box-shadow` cian |
| Marcadores | 7×7 en la regla, color por categoría (`--color-warning/success/...`) | coincidir con `MarkersPanel` |
| Snap guide | 1 px dashed `accent 60 %` | |
| Selección | `--tl-sel-ring` + `color-mix(accent 6%)` | |
| Fade handles | 8×8, aparecen en hover/selección, `--rad-xs` | |
| Toolbar del timeline | `--shell-toolbar-h` (36) | zoom, snap, herramientas |
| Zoom mín/máx | 1 px/seg … 40 px/seg | PxPerSecond existente |
| Hit area de handle | ≥ 8 px, con zona invisible ampliada a 12 px | accesibilidad motora |

### 10.2 Reglas de densidad

- El clip **nunca** cambia de alto con el zoom: el alto es de la pista.
- Con `--timeline-row` = 34 px, el clip debe mostrar al menos: label + waveform
  reducida (24 px) o thumb de 28 px. No ocultar acciones esenciales.
- Agrupación por tipo de pista con etiqueta `--type-10` en la cabecera.
- Cursor: `col-resize` en bordes de clip, `grab` en el cuerpo, `grabbing` al arrastrar.
- Con teclado: flechas mueven playhead 1 frame (`Shift` = 10), `,`/`.` trim;
  cada clip es focusable con `--focus-ring-inset` y `aria-label` con
  nombre + tiempo.

---

## 11. Accesibilidad

### 11.1 Contraste (WCAG 2.2 AA)

| Requisito | Regla para Olyvia |
|---|---|
| 1.4.3 texto ≥4,5:1 | `--ink-1` (15,85), `--ink-2` (6,80), `--ink-3` (6,09), `--ink-4` (6,90) sobre surface. **Prohibido** usar `--color-text-faint` (3,65) y `--color-empty` (3,57) crudos como color de texto. |
| 1.4.3 texto grande ≥3:1 | con ≥24 px se admite `--ink-4` sin mezclar; igualmente se recomienda `--ink-3`. |
| 1.4.11 no-texto ≥3:1 | bordes de control con `--ctl-border` (≈4,15 contra surface), no `--color-border` (1,35). Íconos de estado: contraste ≥3 contra su fondo. |
| Acento como texto | nunca: usar `--ink-link` (mezcla con `text`). |
| Texto sobre acento | `--color-accent-ink` ya da 5,04:1; mantener ese token, nunca `#fff` fijo. |
| Foco | el anillo debe contrastar ≥3:1 con el fondo **adyacente**; el doble anillo (`bg` + `accent`) lo garantiza en cualquier tema. |

Herramienta: el estudio de color ya calcula `themeContrastReport()`
(`theme-palette.ts`, documentado en `COLOR-CUSTOMIZATION.md:155-168`). La capa
premium debe **agregar** al reporte los tres pares nuevos: `ink-3/surface`,
`ink-link/bg`, `ctl-border/surface`.

### 11.2 Foco visible

- `:focus-visible` en **todo** elemento interactivo, sin excepción.
- Prohibido `outline: none` sin reemplazo; si el elemento tiene `overflow: hidden`
  (clips, tabs, celdas), usar `--focus-ring-inset`.
- Nunca `outline-offset` negativo con fondo del mismo color (invisible).
- El foco no debe quedar tapado (2.4.11): sticky headers y toolbars no deben
  cubrir el elemento enfocado al hacer scroll (`scroll-margin-block: 48px`).
- Orden de tabulación: topbar → rail → contenido → statusbar → dock; sin
  trampas; diálogo atrapa el foco y lo restituye al cerrar.

### 11.3 Movimiento reducido

- `:root[data-reduce-motion='true']` ya existe (`chrome.css:2538-2545`) y anula
  animación/transición global. La capa premium **no debe** reintroducir
  transiciones fuera de ese bloque.
- Además respetar `@media (prefers-reduced-motion: reduce)`: mismo efecto.
- Regla de producto: con movimiento reducido, ningún cambio de layout animado
  (acordeón abre instantáneo), pero los estados de color pueden cambiar en 0 ms.
- Nada de parpadeos > 3 Hz (2.3.1), nada de `animation-iteration-count: infinite`
  en elementos que no sean indicadores de progreso (2.2.2).

### 11.4 Semántica y teclado

- `aria-current="page"` ya se usa en el rail (`Sidebar.tsx:112`): conservarlo.
- `aria-pressed` en toggles de toolbar; `aria-expanded` en menús y paneles
  colapsables (`Sidebar` ya lo hace con "Más").
- `role="status"`/`"alert"` en banners y toasts (el banner de error ya usa
  `role="alert"`, `AppShell.tsx:228`).
- Todo `data-tooltip` debe tener `aria-label` o texto visible equivalente.
- Los íconos decorativos ya son `aria-hidden` (`Icon.tsx:585`): mantener.
- Atajos: `kbd` visible en menús y command palette; `Shift+?` abre el cheatsheet
  (ya existe `ShortcutsCheatSheet.tsx`).

---

## 12. Estrategia de cascada recomendada

### 12.1 El problema en una frase

Hay 19 capas CSS, ~33 000 líneas y ~1 511 `!important`; la capa que gana es la
que **menos** intención de diseño tiene hoy. Agregar una capa 20 al final con
reglas normales **no va a funcionar**.

### 12.2 Por qué NO usar `@layer` para la capa premium

Según la especificación (MDN `@layer`, citado en §5.1): en estilos de autor,
**las declaraciones `!important` dentro de capas ganan a las `!important` fuera
de capas, y las declaraciones normales dentro de capas pierden contra las
normales fuera de capas**; además el orden de prioridad se invierte para
`!important`.

Consecuencia práctica para Olyvia:

- Si `premium.css` va en `@layer` y usa reglas **normales**, pierde contra
  `app.css` (no capado) → la mayoría de los estilos no se aplican.
- Si usa `!important` dentro de la capa, gana a todo el legacy `!important`
  (por la inversión) pero se vuelve imposible de sobrescribir después, incluso
  por la propia capa premium, sin otro `!important`.
- Para que `@layer` funcione "bien" habría que meter **las 19 capas** en layers:
  un refactor de 33 000 líneas con riesgo alto y cero beneficio visual inmediato.

**Decisión: capa premium sin `@layer`, importada al final, con la guerra de
`!important` resuelta en origen (§12.4).** Se documenta `@layer` como opción de
largo plazo (Fase 5) cuando el legacy esté encapsulado.

### 12.3 Estructura de archivos propuesta

```
apps/desktop/src/styles/premium/
  tokens.css        tokens nuevos (§7) + mapeo a tokens existentes
  base.css          reset de tipografía, scrollbars, selección, focus global,
                    utilidades, reduced-motion, densidad
  components.css    botón, input, select, card, panel, tabs, badge, chip,
                    dialog, tooltip, toast, empty, tabla, toolbar, kbd
  shell.css         topbar, menubar, rail/sidebar, statusbar, banners,
                    window controls, command palette, assistant dock
  workspace.css     editor: preview, timeline, inspector, mixer, export
  launcher.css      StartScreen
```

Importación al final de `main.tsx` (después de `shortcuts-and-tour.css`),
en ese orden exacto: `tokens → base → components → shell → workspace → launcher`.
`tokens.css` primero porque define las variables que consumen los demás.

### 12.4 Neutralización del legacy (la parte que de verdad destraba el rediseño)

Estas ediciones son en archivos existentes, quirúrgicas y con verificación
visual. Sin ellas, la capa premium necesita `!important` en casi todo.

| Archivo | Cambio | Por qué |
|---|---|---|
| `resolve-theme.css:28-33` | eliminar el bloque `.app-shell * { backdrop-filter: none !important }` | es el único impedimento real para las 3 capas de vidrio |
| `resolve-theme.css:81-87` | quitar `height/min-height: 34px !important` del topbar (dejar padding y borde) | devuelve el control a `--shell-topbar-h` y a la densidad |
| `resolve-theme.css:15-20` | `--shadow-panel: var(--elev-1)`, `--radius-panel: var(--rad-lg)`, `--glow-accent: none` se mantiene | el glow se prohíbe igual, pero sin romper sombras |
| `resolve-theme.css:36-39` | quitar `animation: none !important` de `.content` | permite la entrada de vista de 240 ms |
| `resolve-theme.css:56-59` | `border-radius: var(--rad-pill)` en el thumb del scrollbar | coherencia |
| `premium-animations.css:168-192` | eliminar `button { overflow: hidden }` y `button::after` (ripple) | recorta focus rings y badges |
| `premium-animations.css:230-239` | eliminar `.hover-lift` (`translateY(-4px)`) o dejarlo sin efecto | antipatrón |
| `flat.css` (145 `!important`) | auditar: es una capa de "aplanado" que compite con Resolve; decidir si se retira del import | duplica intención con `resolve-theme` |
| `commercial.css` (188 `!important`) | dejar solo las reglas de layout; mover color a tokens premium | es la que más se acerca al objetivo, pero pisa con `!important` |
| `app.css` | **no reescribir**: solo borrar los dos bloques "PREMIUM BUTTON SYSTEM" duplicados (501-571 y 577-613) y las definiciones de shell (siguen ganando contra premium por orden) | reduce 200 líneas de conflicto sin tocar 13 000 |

### 12.5 Reglas de autoría para la capa premium

1. **Un solo archivo por dominio**; nunca dos reglas para el mismo selector en
   dos archivos premium.
2. Selectores con especificidad estable: `.app-shell .topbar` (0,2,0) y
   `:where()` para agrupar sin inflar:
   `.app-shell :where(.card, .panel) { … }`.
3. `!important` solo en el **catálogo de impasse** (§12.6), siempre con el
   comentario `/* !impasse: <selector legacy> — <archivo:línea> */` para que sea
   greppable y se pueda retirar cuando el legacy se limpie.
4. Tokens en `:root`, no en componentes. Cero valores mágicos dentro de reglas.
5. Cero hex; cero `rgba(255,255,255,…)` (usar `color-mix` con `--color-text`).
6. `transition` con propiedad explícita, nunca `all`.
7. Prohibido `!important` en: `display`, `position`, `flex`, `grid`, `width`,
   `height` de contenedores de layout (rompe tests de componente y el zoom).
8. Un comentario de cabecera en cada archivo con: qué domina, qué NO toca, y
   lista de selectores legacy que sobrescribe.

### 12.6 Catálogo de impasse (los únicos `!important` permitidos al inicio)

| Selector premium | Legacy que lo obliga |
|---|---|
| `.app-shell .topbar` (height/padding) | `resolve-theme.css:84-86` |
| `.app-shell .sidebar button` (radio/padding/color) | `app.css:6376-6390`, `commercial.css:156-161` |
| `.app-shell .app-statusbar` (fondo/color/font-size) | `app.css:6489-6503`, `resolve-theme.css` |
| `*::-webkit-scrollbar-*` | `resolve-theme.css:42-67` |
| `.app-shell .menubar-title` (padding/font) | `commercial.css:98-104` |
| `.content` (background) | `app.css:6548-6552` |

Todo lo demás debe poder ganarse por orden (import final) + especificidad
`.app-shell …`. Si un selector necesita `!important` y no está en esta tabla,
es señal de que falta neutralizar algo en §12.4.

### 12.7 Verificación de la cascada (sin tocar la app)

1. **Test de orden de imports**: un test de Vitest que lea `main.tsx` y afirme
   que el último import es `./styles/premium/launcher.css` y que
   `premium/tokens.css` aparece antes que el resto de `premium/`. Barato y
   detecta el error más común (olvidar el import).
2. **Auditoría CSSOM en e2e**: en Playwright, para una lista de 15 elementos
   (`.topbar`, `.sidebar`, `.app-statusbar`, `.menubar-title`, `.card`,
   `button.primary`, `.icon-button`, `.modal`, `kbd`, `.badge-primary`,
   fila de tabla, clip, playhead, `.start-action-card`, `.segmented`), leer
   `getComputedStyle` y comparar contra la tabla de §9/§8 (altura, radio,
   `font-size`, `color`). Falla con el diff exacto.
3. **Auditoría de `!important`**: script de lectura que cuente `!important` por
   archivo y falle si `resolve-theme.css` no bajó del objetivo de Fase 1
   (p. ej. ≤ 950) o si `premium/` supera 12.
4. **Auditoría de hex**: grep de `#[0-9a-f]{3,8}` en `premium/` → debe dar 0.
5. **Capturas por tema**: las 6 paletas + 3 densidades + radius 2/10/18, sobre
   launcher, editor, ajustes y una vista de herramientas.

### 12.8 Orden de import final propuesto

```ts
// main.tsx (fragmento, al final de los imports de estilo)
import './styles/tokens.css';
import './styles/app.css';
/* … resto sin cambios … */
import './styles/commercial.css';
import './styles/shortcuts-and-tour.css';
// capa premium: última en la cascada
import './styles/premium/tokens.css';
import './styles/premium/base.css';
import './styles/premium/components.css';
import './styles/premium/shell.css';
import './styles/premium/workspace.css';
import './styles/premium/launcher.css';
```

---

## 13. Plan por fases y archivos priorizados

Cada fase tiene criterio de aceptación verificable. No se declara cerrada sin
evidencia (capturas + tests + conteo de `!important`).

### Fase 1 — Fundación y desbloqueo (mayor retorno, menor riesgo)

Archivos: `styles/premium/tokens.css`, `styles/premium/base.css`,
`main.tsx` (imports), y las ediciones quirúrgicas de §12.4 en
`resolve-theme.css` y `premium-animations.css`.

Entregable: tokens nuevos disponibles, vidrio y sombras restaurados, topbar
obedeciendo densidad, foco visible global, scrollbars coherentes, tipografía
base 13 px.

Aceptación: `typecheck` verde; test de orden de imports; auditoría CSSOM de los
15 elementos en verde para altura/radio/font; capturas comparables del shell en
3 densidades; `!important` de `resolve-theme` reducido y documentado.

### Fase 2 — Componentes compartidos

Archivos: `styles/premium/components.css` + ajustes de markup **solo si son
necesarios** (evitar: los componentes ya tienen las clases correctas en su
mayoría). Candidatos a retoques de markup: `MenuBar` (divider/rol de menú),
`AppShell` (statusbar: reemplazar los `style={{…}}` inline de los botones de
atajos/tour por clases), `Icon` (prop `strokeWidth` opcional).

Aceptación: muestra de componentes (botón 6 variantes × 6 estados, input 4
estados, card 3 variantes, tabs/segmented, badge 6, dialog, tooltip, toast,
empty, tabla, toolbar, kbd) renderizada y capturada; AA verificado en los pares
nuevos; teclado completo.

### Fase 3 — Shell y launcher (primera impresión)

Archivos: `styles/premium/shell.css`, `styles/premium/launcher.css`; ajustes
puntuales en `styles/start-screen.css` (eliminar medidas que compitan) y
`styles/commercial.css` (retirar color duplicado).

Aceptación: topbar 44/40/48; rail 48 o sidebar 216; statusbar 24 con texto
legible; menubar con dropdown de 28 px; launcher con hero 32 px, 3 acciones,
plantillas, recientes; capturas en 3 densidades y 2 temas; sin regresiones en
`App.test.tsx`, `MenuBar.test.tsx`, `Sidebar`/`ProfileMenu` tests.

### Fase 4 — Workspace de edición

Archivos: `styles/premium/workspace.css`; `styles/premium/shell.css` para dock.
Riesgo alto: timeline (muchas medidas y drag). Aceptación: e2e existentes verdes;
`--timeline-row` 34/48/76 sin recortes; playhead/clips/marcadores con tokens;
capturas del editor con y sin proyecto.

### Fase 5 — Vistas de contenido y consistencia

Archivos: `styles/premium/components.css` (extensiones) + `home.css`,
`settings.css` (solo las partes que no sean estructura). Aceptación: capturas de
las 33 vistas; cero texto recortado; `--row-h` respetado; grillas con `--gap-*`.

### Fase 6 — Limpieza estructural (opcional, post-rediseño)

- Retirar `flat.css` del import si `resolve-theme` ya no lo necesita.
- Envolver las capas legacy en `@layer legacy` y mover la premium a
  `@layer premium` (ahora sí, con el legacy capado).
- Unificar `--text-*` → `--type-*` y borrar alias muertos.
- Reducir `app.css` por dominio (shell → `chrome.css`, timeline → `workspace`).

### Backlog priorizado (impacto / esfuerzo)

| # | Cambio | Impacto | Esfuerzo | Fase |
|---|---|---|---|---|
| 1 | Neutralizar kill switches de `resolve-theme` | muy alto | bajo | 1 |
| 2 | `premium/tokens.css` completo | muy alto | bajo | 1 |
| 3 | Quitar ripple global de `premium-animations` | alto | muy bajo | 1 |
| 4 | Topbar/menubar/statusbar con medidas nuevas | muy alto | medio | 3 |
| 5 | Botones/inputs/cards sin gradiente ni lift | muy alto | medio | 2 |
| 6 | Rail 40→48 y sidebar 172→216 | alto | bajo-medio | 3 |
| 7 | Launcher hero + 3 acciones + plantillas | alto | medio | 3 |
| 8 | `--ink-3`, `--ink-link`, `--ctl-border` | alto (AA) | bajo | 1 |
| 9 | Timeline densa con tokens de clip/playhead | alto | alto | 4 |
| 10 | Empty states y onboarding con el nuevo sistema | medio | bajo | 5 |
| 11 | Motion por interacción (tabla §6.7) | medio | bajo | 2 |
| 12 | Tooltip/toast/kbd/command palette | medio | medio | 2-3 |
| 13 | Limpieza de `flat.css`/`@layer` | bajo | alto | 6 |

---

## 14. A/B de referencias

Dos direcciones posibles. Se recomienda **B en la estructura, A en la
superficie** (opción C).

### Opción A — "Quiet premium" (Linear / Vercel / Raycast)

- Superficies casi negras o casi blancas, hairlines de 6–10 %, un acento.
- Radios 6–12, sombras casi invisibles, tipografía 13–14 px con tracking negativo en títulos.
- Mucho aire: padding 16–24, filas 32–40.
- Movimiento 100–150 ms, sin stagger.
- **A favor:** se ve caro con poco esfuerzo; excelente para launcher, ajustes y vistas de herramientas; muy buen contraste de marca.
- **En contra:** poco denso para un timeline profesional; si se aplica a todo, el editor se siente "web app".

### Opción B — "Pro NLE" (Resolve / Premiere / VS Code)

- Chrome acromático, paneles contiguos sin gap, headers de 28–32, texto 11–12, filas 24–28.
- Un único azul desaturado para estado; cero decoración.
- **A favor:** densidad real de edición, el timeline gana espacio, se siente herramienta.
- **En contra:** riesgo de "plano" otra vez (el problema actual); exige tipografía y hairlines perfectos para no verse pobre; la primera impresión (launcher) necesita otra lógica.

### Opción C — recomendada: híbrido por contexto

| Zona | Dirección | Por qué |
|---|---|---|
| Launcher | A (aire, hero 32 px, radio 16, una firma de marca) | primera impresión y decisión del usuario |
| Shell (topbar/rail/statusbar) | híbrido: métricas de B (44/48/24) con superficie de A (hairline 6 %, sin gradiente) | densidad de herramienta, acabado premium |
| Componentes | A | cards, forms, badges, diálogos |
| Workspace/timeline | B | densidad y legibilidad a 1 px/seg |
| Vistas de herramientas | A con grillas B (row 32) | contenido escaneable |

Justificación: el usuario percibe "premium" en la primera pantalla y en los
detalles de acabado (hairline, foco, motion); percibe "profesional" en la
densidad y predictibilidad del editor. Mezclar mal (aire en el timeline o
densidad en el launcher) produce exactamente el aspecto que hay que corregir.

### Referencias visuales priorizadas (para mirar mientras se implementa)

1. **VS Code — workbench real + CSS** (`titlebarpart.css`, `statusbarpart.css`,
   `activitybarpart.css`): copiar exactamente la relación **35/48/22** y el
   concepto de "ítem de statusbar con hover de fondo y `tabular-nums`". Ver
   §9.2 para el mapeo a 44/48/24.
2. **OpenCut** (`apps/web/src/styles.css`): copiar la **derivación de radios por
   multiplicadores** sobre un radio base y los bordes hairline en capas
   (`--border` 10 %, `--input` 15 %) — es el mismo problema de tokens que
   Olyvia, resuelto con MIT.
3. **Linear (receta derivada)**: copiar la **disciplina** — máximo 16 px de
   radio, hairlines de 6 %, hover 150 ms, prohibición de glow y de sombra de
   color. Aplicar sobre el shell, no sobre el timeline.
4. **Carbon Motion**: copiar la **tabla de duraciones y las tres curvas** tal
   cual (§6.7); es la parte más fácil de implementar bien y la que más "se
   siente" premium.
5. **Figma UI3 (blog)**: copiar el **criterio de jerarquía** — el chrome se
   reduce para que el trabajo ocupe el centro; en Olyvia se traduce en topbar
   de 44 px sin decoración y un solo elemento de acento por pantalla.

---

## 15. Anexos

### 15.1 Esqueleto de `premium/tokens.css` (para copiar en Fase 1)

```css
/* ============================================================
   Olyvia Premium — tokens
   Capa: última de la cascada (sin @layer). Dominio: variables.
   NO redefine --color-* (los escribe el motor inline).
   ============================================================ */
:root {
  /* — Superficies de chrome — */
  --chrome-1: color-mix(in srgb, var(--color-surface) 82%, var(--color-bg));
  --chrome-2: color-mix(in srgb, var(--color-surface) 92%, var(--color-bg));
  --chrome-3: var(--color-panel);
  --chrome-4: color-mix(in srgb, var(--color-panel-2) 70%, var(--color-panel));

  /* — Tinta — */
  --ink-1: var(--color-text);
  --ink-2: var(--color-text-muted);
  --ink-3: color-mix(in srgb, var(--color-text-faint) 70%, var(--color-text));
  --ink-4: color-mix(in srgb, var(--color-empty) 62%, var(--color-text));
  --ink-link: color-mix(in srgb, var(--color-accent) 34%, var(--color-text));

  /* — Líneas — */
  --hairline: 1px solid color-mix(in srgb, var(--color-text) 6%, transparent);
  --hairline-strong: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  --ctl-border: color-mix(in srgb, var(--color-text) 38%, var(--color-border));

  /* — Estados — */
  --state-hover: color-mix(in srgb, var(--color-text) 5%, transparent);
  --state-active: color-mix(in srgb, var(--color-text) 9%, transparent);
  --state-selected: color-mix(in srgb, var(--color-accent) 14%, transparent);
  --state-selected-border: color-mix(in srgb, var(--color-accent) 42%, transparent);

  /* — Tipografía — */
  --type-10: 10px;  --type-11: 11px;  --type-12: 12px;  --type-13: 13px;
  --type-14: 14px;  --type-15: 15px;  --type-18: 18px;  --type-24: 24px;
  --type-32: 32px;
  --fw-regular: 450; --fw-medium: 550; --fw-strong: 650; --fw-black: 700;
  --track-caps: 0.08em; --track-tight: -0.02em;
  --lh-ui: 1.45; --lh-body: 1.6;

  /* — Espacio — */
  --gap-2: 2px;  --gap-4: 4px;  --gap-6: 6px;  --gap-8: 8px;
  --gap-10: 10px; --gap-12: 12px; --gap-16: 16px; --gap-20: 20px;
  --gap-24: 24px; --gap-32: 32px; --gap-40: 40px; --gap-56: 56px; --gap-72: 72px;

  /* — Radio (depende del slider del usuario) — */
  --rad-xs: max(2px, calc(var(--radius-2) - 6px));
  --rad-sm: max(3px, calc(var(--radius-2) - 4px));
  --rad-md: max(4px, calc(var(--radius-2) - 2px));
  --rad-lg: var(--radius-2);
  --rad-xl: calc(var(--radius-2) + 2px);
  --rad-2xl: min(16px, calc(var(--radius-2) + 6px));
  --rad-pill: 9999px;

  /* — Controles y shell — */
  --ctl-h-sm: 24px; --ctl-h-md: 28px; --ctl-h-lg: 32px; --ctl-h-xl: 36px;
  --ctl-px-md: 10px; --ctl-gap: 6px;
  --shell-topbar-h: 44px; --shell-statusbar-h: 24px;
  --shell-panel-head-h: 32px; --shell-toolbar-h: 36px;
  --shell-nav-item-h: 32px; --shell-tab-h: 32px;
  --shell-content-pad-x: 24px; --shell-content-pad-y: 20px; --shell-content-pad-b: 40px;

  /* — Elevación — */
  --elev-1: 0 1px 1px -0.5px rgba(0,0,0,.24), 0 1px 2px rgba(0,0,0,.16),
            inset 0 1px 0 color-mix(in srgb, var(--color-text) 3%, transparent);
  --elev-2: 0 2px 4px -1px rgba(0,0,0,.28), 0 6px 12px -4px rgba(0,0,0,.24),
            inset 0 1px 0 color-mix(in srgb, var(--color-text) 4%, transparent);
  --elev-3: 0 4px 10px -2px rgba(0,0,0,.30), 0 14px 28px -8px rgba(0,0,0,.34);
  --elev-4: 0 8px 20px -4px rgba(0,0,0,.34), 0 28px 56px -12px rgba(0,0,0,.46);
  --elev-5: 0 12px 28px -6px rgba(0,0,0,.38), 0 48px 96px -18px rgba(0,0,0,.55);

  /* — Movimiento — */
  --dur-1: 70ms; --dur-2: 90ms; --dur-3: 110ms;
  --dur-4: 150ms; --dur-5: 240ms; --dur-6: 400ms;
  --ease-out: cubic-bezier(.2, 0, .38, .9);
  --ease-entrance: cubic-bezier(0, 0, .38, .9);
  --ease-exit: cubic-bezier(.2, 0, 1, .9);
  --ease-emphasized: cubic-bezier(.22, 1, .36, 1);

  /* — Foco — */
  --focus-ring: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-accent);
  --focus-ring-inset: inset 0 0 0 2px color-mix(in srgb, var(--color-accent) 80%, transparent);
  --disabled-opacity: .45;
}

/* Densidad: sólo alturas, nunca tamaños de texto */
:root[data-density='compact'] {
  --shell-topbar-h: 40px; --shell-statusbar-h: 22px;
  --shell-panel-head-h: 28px; --shell-toolbar-h: 32px;
  --shell-nav-item-h: 28px; --shell-content-pad-y: 16px;
  --ctl-h-sm: 22px; --ctl-h-md: 26px; --ctl-h-lg: 30px; --row-h: 28px;
}
:root[data-density='spacious'] {
  --shell-topbar-h: 48px; --shell-statusbar-h: 28px;
  --shell-panel-head-h: 36px; --shell-toolbar-h: 40px;
  --shell-nav-item-h: 36px; --shell-content-pad-y: 28px;
  --ctl-h-sm: 26px; --ctl-h-md: 32px; --ctl-h-lg: 36px; --row-h: 36px;
}
```

### 15.2 Checklist de aceptación visual (por vista)

- [ ] Un solo acento por pantalla; el resto acromático.
- [ ] Separadores de 1 px (`--hairline`), no `border: 1px solid #hex`.
- [ ] Ningún texto < 10 px; terciario ≥ 4,5:1.
- [ ] Controles a 28 px (o al valor de densidad); hit areas ≥ 24×24.
- [ ] Hover ≤ 110 ms; sin `translateY`; sin glow.
- [ ] Focus visible en tab/tab/tab, nunca tapado.
- [ ] Con `data-reduce-motion="true"` no hay animación de layout.
- [ ] Cambiar preset / radio / densidad / zoom no rompe nada.
- [ ] Con `zoom` 1.2 no hay blur > 24 px efectivo ni scroll horizontal.
- [ ] Con `--radius-2: 2px` y `18px` los componentes siguen coherentes.

### 15.3 Mapeo rápido legacy → premium (para el que implementa)

| Legacy (hoy) | Premium (propuesto) |
|---|---|
| `background: var(--brand-gradient)` en `.primary` | `background: var(--color-accent)` |
| `translateY(-2px)` en hover | `background: --state-hover` |
| `box-shadow: 0 0 22px rgba(94,234,212,.4)` | `--elev-2` o nada |
| `border: 1px solid rgba(255,255,255,.1)` | `--hairline-strong` |
| `border-radius: 16px` en card | `--rad-md` |
| `font-size: 8.5px` statusbar | `--type-11` |
| `transition: all .3s` | `transition: background-color var(--dur-3) var(--ease-out)` |
| `#333438`, `#080c11`, `#93a3b6` | `--hairline`, `--chrome-1`, `--ink-2` |
| `button::after` ripple | (eliminar) |
| `.hover-lift` | (eliminar) |
| `--radius-panel: 0px` | `--rad-lg` |

### 15.4 Preguntas abiertas para el Lead

1. ¿Se retira `flat.css` del import en Fase 1 o se deja hasta la 6? (145 `!important` compitiendo con `resolve-theme`).
2. ¿El rail pasa a 48 px (VS Code) o se mantiene 40 para no tocar `appearance.ts`? La propuesta es 48.
3. ¿La sidebar expandida arranca en 216 px (nuevo default) o se respeta 172 y sólo se rediseña el contenido?
4. ¿El launcher conserva el gradiente de marca en el CTA principal (única excepción) o se usa acento sólido?
5. ¿Se muestra la etiqueta de grupo del rail (RUTA/HERRAMIENTAS/AYUDA), hoy oculta por `commercial.css:190-193`?
6. ¿Se agrega `--elev-alpha` al motor de apariencia (Fase 2) para que las sombras funcionen en temas claros?

### 15.5 Glosario

- **Hairline**: línea de 1 px de bajo contraste (6–10 % del color de texto) usada como separador estructural.
- **Chrome**: todo lo que no es contenido ni preview (topbar, rail, statusbar, headers).
- **Kill switch**: regla `!important` que anula una capacidad visual en toda la app.
- **Impasse**: selector legacy con `!important` que obliga a responder con `!important` en la capa nueva.
- **Densidad**: juego de alturas de shell/control según `data-density`.
- **Elevación**: nivel de sombra (0–5) que indica profundidad; no es decoración.

---

*Fin del documento. Este archivo no modifica la aplicación: es la especificación
que alimenta las olas descritas en `docs/PREMIUM-REDESIGN-PLAN.md`.*
