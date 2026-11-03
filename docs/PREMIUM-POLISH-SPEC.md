# Olyvia — Especificación de pulido premium (iteración «polish»)

Estado: borrador de hallazgos + plan, 2026-11-03 (19:15). Autor: agente de contenido
(`redesign-views`), autorizado por el Lead para tomar vistas de contenido **y** timeline
en esta iteración. Este documento NO modifica la app: ordena la evidencia y el alcance
antes del «GO polish». Complementa `docs/PREMIUM-REDESIGN-SPEC.md` (fundamentos) y
`docs/PREMIUM-REDESIGN-PLAN.md` (§ olas).

## 1. Pedido del usuario (resumen operativo)

1. Arreglar todo lo que esté mal posicionado.
2. Visual más profesional; **aún más minimalista y compacto**, que se entienda rápido
   para qué sirve cada cosa y cómo funciona.
3. Rendimiento completo: fluidez y rapidez.
4. Timeline **customizable**, fluido y «super clean premium de altísima calidad».
5. Estudiar referencias (internet / repos MIT) y aplicar.

## 2. Estado medido (producción, `vite preview` :4173, 1440×900, 33 vistas)

Método: `.tmp-redesign/audit2/audit.mjs` → `.tmp-redesign/audit2/audit.json`.
Build actual: `main` 611 KB min / 184 KB gzip, CSS única 606 KB min / ~95 KB gzip,
`EmojiPickerPopover` 752 KB lazy, `lottie` 301 KB lazy, fuentes emoji 8,5 MB sólo bajo
demanda. Shell ~30–55 ms por vista; primera vista 380–470 ms (Home frío 801 ms, por
chunk inicial + CSS). Long tasks ≥50 ms: máx. 1; CLS 0. **No hay scroll horizontal en
ninguna vista.**

Hallazgos de posición/legibilidad (prioridad alta → baja):

| # | Vista(s) | Hallazgo | Acción |
|---|---|---|---|
| 1 | Hubs (`youtube`, `factory`, `creator`, `download`, `compliance`, `convert`, `compare`, `compress`, `denoise`, `sharpen`, `thumbnails`, `localization`, `background`, `upscale`, `lab`) | `.hub-tab` mide **22 px de alto** (<24 px de hit target accesible) | subir contenedor a 32 px y tabs a 24 px; mantiene look segmented |
| 2 | Proyectos | chips de formato en mono **9 px** | 10 px mínimo (regla del spec: nunca <10 px) |
| 3 | AI Hub | `.ai-hub-skill-target` / `.ai-hub-skill-category` **9 px** | 10 px + color `--ink-3` |
| 4 | Aprender | texto del anillo de progreso **8 px** | 9–10 px o reubicar «completado» fuera del anillo |
| 5 | Inicio | descripciones del mapa de herramientas cortadas con ellipsis (a 1 línea) | permitir 2 líneas (`line-clamp: 2`) sin romper grid |
| 6 | Varias | labels de acciones del timeline ocultos salvo hover (dependen de memoria) | mostrar labels estáticas en grupos primarios y dejar icon-only sólo acciones secundarias |
| 7 | Global | el aviso de modo navegador suma una franja en flujo (correcto) pero no reserva contraste de borde inferior con el toolbar sticky en scroll | hairline inferior + `position: relative` para que el sticky no lo pise |
| 8 | Ajustes | sub-tabs de 22 px y chips 9,5 px (shell) | fuera de esta iteración: se reporta al Lead/shell |

## 3. Timeline: diagnóstico

Base visual: `.tmp-redesign/polish/shots/antes-1440-03-editor-demo.png`,
`antes-1440-03b-timeline.png`, `antes-1440-05-timeline-zoom.png`,
`antes-1440-06-timeline-tema-claro.png` (harness fake-service sobre demo).

Problemas concretos observados:

1. **Pistas planas**: cabecera `AUD/VID` + nombre en micro-tipografía y controles
   (colapsar/S/M/ojo/candado) alineados como glifos sueltos, sin jerarquía ni hover;
   no se descubre que la altura de pista se arrastra.
2. **Clips planos**: relleno de color uniforme, sin radio/borde/interior, sin thumbnail
   ni waveform visibles, texto y meta con contraste bajo; selección poco evidente;
   handles de trim sólo aparecen de forma sutil. No se percibe «NLE profesional».
3. **Regla (ruler)** sin jerarquía de ticks, labels 10 px sin fondo propio; el
   playhead es una línea sin grip claro y compite con la regla.
4. **Toolbar**: 4 grupos mezclados sin separadores; ~20 controles icon-only con labels
   ocultas; acciones destructivas al mismo nivel que las primarias. Hay ancho libre a
   1440 (sobra ~400 px), así que el icon-only no está justificado.
5. **Fondo del lane**: filas alternas apenas perceptibles, sin rejilla temporal que
   ayude a leer compases/segundos.
6. **Customización escondida**: `EditorPreferencesCard` ya expone zoom inicial, snap,
   waveforms y miniaturas; `appearance.timelineRows` expone altura global; el drag de
   altura por pista existe. Falta descubrimiento y una densidad cómoda/compacta.

## 4. Referencias estudiadas (MIT / públicas)

- **OpenCut (MIT)** — [`apps/web/src/styles.css`](https://raw.githubusercontent.com/OpenCut-app/OpenCut/main/apps/web/src/styles.css):
  design tokens shadcn en `oklch`, radios por multiplicadores (`sm ×.6`, `md ×.8`,
  `lg ×1`, `xl ×1.4`), `muted/foreground` separados, `--border: 1px` hairline y
  `--ring` para foco. **Se adopta**: mantener radios derivados de `--radius-2` (ya
  vigente) y hairline para separadores, evitando cajas duras en pistas/clips.
- **dnd-timeline (MIT)** — interacción: drag/resize con `pointer events`, snap a
  bordes, guía vertical durante el arrastre, `aria` en items arrastrables.
  **Se adopta**: guía vertical de snap ya existe (`.snap-guide`); refinar contraste y
  que aparezca también al mover el playhead.
- **VS Code (MIT)** — densidad: titlebar 35 px, statusbar 22 px, filas de lista con
  hover por token; iconos 16 px centrados. **Se adopta**: cabeceras de pista con hover
  por token y controles 24 px, sin bordes duros.
- **Linear-style recipes** (público) — hairlines `rgba(text 6%)`, hover 150 ms,
  "nunca glow", un solo acento. **Se adopta**: micro-interacciones ≤110–150 ms,
  acento reservado a playhead/selección/indicadores.

Nota: no se copia código; se adoptan patrones de interacción y proporciones,
respetando los 34 tokens y el contrato de apariencia de Olyvia.

## 5. Plan P0 — Timeline premium (archivos asignados)

### 5.1 Preferencias nuevas (`state/editor-preferences.ts`, `EditorPreferencesCard.tsx`)
- `timelineDensity: 'comfortable' | 'compact'` (default comfortable). Compact reduce
  20 % la altura de pista sin altura custom y la altura de la regla (24 px), mantiene
  clips legibles.
- `timelineClipLabels: 'full' | 'minimal'` (default full) → `minimal` oculta la línea
  `in · out` y deja sólo el nombre (más limpio en zoom bajo).
- `timelineShowGrid: boolean` (default true) → rejilla temporal sutil en el lane.
- Bounds + normalización + tests de `editor-preferences.test.ts`; UI en
  `EditorPreferencesCard` (sección «Timeline») con segmented/checkbox y reset.
- Persistencia: localStorage; el timeline lee el evento existente
  `EDITOR_PREFS_CHANGED_EVENT`, sin recargar.

### 5.2 Timeline.tsx (y subcomponentes)
- Clase raíz `timeline density-compact` + variables `--tl-grid-step` (mayor tick en
  px, calculado con `pxPerFrame`) y `--tl-row-default` (según densidad).
- Toolbar: 4 grupos con divisores (`zoom/navegación`, `filtros`, `pistas`, `editar`);
  labels visibles en acciones primarias (Dividir, Marcador, Borrar) y secundarias
  icon-only con `aria-label`/`data-tooltip`; botones 28 px, gap 4, separadores 1×20
  hairline; «Borrar» al extremo derecho con `danger-ghost`.
- Cabecera de pista: bloque `kind chip` + nombre 12/550 + contador de clips opcional;
  controles 24×24 con hover/focus visibles; grip de arrastre de altura (3 px) con
  `cursor: ns-resize` y `title` accesible; estado colapsado con altura 24.
- Clips: `--rad-sm`, borde 1 px `color-mix(kind 42%)`, fondo degradado suave
  `color-mix(kind 22% → 12%, chrome-4)`, label 11/550 `--ink-1`, meta 10 `--ink-3`,
  waveform con `--color-audio` 55 % encima del fondo del clip, thumbnail con
  `object-fit: cover`, `mask` de 28 % en el borde derecho; hover eleva borde;
  selección: ring 1,5 px accent + `--elev-2`; trim handles 7 px accent con grip;
  fade handles 8 px círculo; color tag dot 7 px en el label.
- Ruler: fondo `--chrome-1`, borde inferior hairline, ticks mayores 7 px y menores
  4 px con `--ink-4`, labels 10 px mono `--ink-3`; playhead: línea 1,5 px accent con
  outline 1 px `--color-bg` y grip 12×14 con `border-radius` 4 y chevron.
- Regla de capas: no `!important` nuevos salvo impasse ya catalogado; todo por tokens.

### 5.3 Microinteracciones / fluidez
- Hover de clip/cabecera 110 ms `--ease-out`; nada de `translateY`; selección
  instantánea.
- `content-visibility` no aplica a clips; se limita DOM: waveform en un único
  `<svg>` por clip (ya existente) y thumbnails sólo si `showThumbnails`.
- Memoizar el render de clip con props estables si el profiler muestra coste >4 ms
  por frame durante el drag (medir con el harness antes/después).
- Objetivo medible: arrastre/zoom sin long tasks >16 ms en el harness (dev) y sin
  «saltos» de layout al mostrar labels.

## 6. Plan P0 — Vistas de contenido (más compactas y claras)

- Hubs: tabs 24 px de alto; separación de grupos y toolbar de hub visible.
- Densidad de contenido: `.view` gap 12→10 en secciones densas (card grids), padding
  interno de cards 16→14 en vistas de herramientas; Home hero 24→20 de padding y
  pilares 16→14 (mantiene aire, gana ~40 px verticales por pantalla).
- Jerarquía «para qué sirve»: cada vista de herramienta con subtítulo en 1 línea
  (ya existe `.view-summary`); en Home, pilares con CTA más corto y un subtítulo de
  1 línea; en Aprender, chips de progreso más pequeños.
- Ajustes de legibilidad: 9→10 px en chips mono, 8→9 px anillo Aprender, 2 líneas en
  el mapa de herramientas.
- Alineaciones: mismo `x` para eyebrow/título/summary en todas las vistas; acciones
  primarias al extremo derecho de `view-head`/`view-toolbar`; `view-toolbar` sticky con
  hairline inferior y altura 36 consistente.
- Sin scroll horizontal ni texto cortado en 1280/1440/1920.

## 7. Plan P1 — Rendimiento (medible y acotado)

1. Medición base: shell 30–55 ms / primera vista 380–470 ms (Home 801 ms frío).
   Objetivo: no empeorar y bajar Home frío con `modulepreload` del chunk inicial y del
   CSS ya existente; no tocar build si el Lead no lo autoriza.
2. Verificar `preloadViews()`: hoy precarga sólo 4 vistas primarias (home/editor/
   assets/download) — correcto; no precargar los 33.
3. EmojiPicker 752 KB y Lottie 301 KB ya son chunks lazy: confirmar que no se cargan
   al iniciar (network waterfall en auditoría) y que abrir el picker no bloquea el
   frame (skeleton/placeholder).
4. Timeline: evitar recalcular `peaks`/thumbs al cambiar zoom (cache existente por
   bucket); memoizar clip si el profiler lo justifica. Medir con harness: FPS durante
   drag de playhead y zoom con `PerformanceObserver` de long tasks.
5. CSS: no cargar fuentes emoji hasta abrir picker/preview con emoji; no agregar
   nuevas animaciones de layout.

## 8. Archivos y riesgos

Tocados (autorizados por el Lead):
`styles/premium/workspace.css` (§7–§9), `features/editor/Timeline.tsx` y subcomponentes
de timeline, `state/editor-preferences.ts` (+test), `features/settings/EditorPreferencesCard.tsx`,
`styles/premium/views.css`, `features/home|learn|projects|script|assets|production|director`.
No se toca shell/launcher/Ajustes visual (excepto la card de Editor), ni
`premium/tokens.css` (si hace falta un token, lo agrega el Lead).

Riesgos: el timeline tiene contrato de clases usado por tests/e2e
(`.timeline-clip`, `.track-head`, `.ruler-*`, aria-labels); se preservan nombres,
roles y data-*; sólo se agregan clases/variables. Los cambios de densidad usan
`prefers-reduced-motion` y no alteran atajos.

## 9. Verificación

- `npx tsc --noEmit -p apps/desktop/tsconfig.json`.
- `npx vitest run` de los tests tocados (Timeline, EditorPreferencesCard, App, vistas).
- Capturas antes/después: timeline con demo (harness etiquetado), zoom, selección,
  tema claro; 33 vistas a 1440 y 1280; launcher/Ajustes sin cambios.
- Medición de performance antes/después (auditoría §2 y long tasks del timeline).
- Reporte al Lead con números, capturas y deuda.
