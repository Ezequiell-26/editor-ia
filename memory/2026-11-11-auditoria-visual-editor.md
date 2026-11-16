# 2026-11-11 (tarde) — Auditoría visual del editor entero + 2 features CapCut

## Pedido
«Sigue mejorando agregando más cosas front end que tiene CapCut, arregla todo,
revisa que todo se vea bien sin errores, que nada sobreponga nada, revisa el
editor entero, bien posicionado, bien minimalista».

## Cómo se midió (reusable)
- Arnés **temporal** `apps/desktop/visual-audit.html` + `src/__visual_audit.tsx`:
  `AppearanceProvider > ProjectProvider(createFakeService, createDemoProject) >
  FlowQueueProvider > Shell`, con el MISMO cascade de CSS de `main.tsx`.
  Sin `AppearanceProvider` falla con `useAppearance requiere AppearanceProvider`.
  Sin arnés, la app real en browser muestra empty-state (no hay proyecto).
- Vite: `cd apps/desktop && npx vite --host 127.0.0.1 --port 3210 --strictPort`.
  El puerto 3001 es de otro worktree. Al final: parar el servidor y borrar arnés.
- El detector de solapamientos DEBE descontar el recorte de cada ancestro con
  `overflow: hidden/clip/auto/scroll`. Sin eso, el contenido de `.rail-list`
  y del timeline produce ~23 falsos positivos; con eso quedan 2 reales.
- El 404 de consola de la primera pasada era **favicon del arnés temporal**:
  agregar `<link rel="icon" href="/olyvia-mark.png">` lo elimina. No es un
  error de la app.

## Resultado (62 estados × 3 resoluciones + 17 vistas)
- 0 textos cortados · 0 desbordes de documento · 0 paneles fuera de viewport ·
  0 errores de consola · solapamientos 2 (barra colapsada `.editor-mode-tabs`,
  intencional: y=734…768, las pistas terminan en y=730; no tapa contenido).
- `hiddenScroll` residual 3–10: regla del timeline + `input` nativos. Legítimo.

## Cambios
- `styles/editor-clarity.css` NUEVA, importada ÚLTIMA en `main.tsx`, sólo
  `:root[data-theme='dark']`. No pisa las capas HY4 ni el tema claro.
- `features/editor/timeline-zoom.ts` (+test): escala logarítmica 0,2→14
  px/frame, `zoomFromSlider` / `sliderFromZoom`, 100 posiciones. Insertado en
  `Timeline.tsx` entre − y + SIN quitar `.zoom-readout` (lo usan los tests).
- `ColorStudio.tsx`: prop `initialCompare`. `ColorPropertiesPanel.tsx`: botón
  «A/B» en el pie que abre el estudio comparando; «Estudio avanzado» abre
  normal; «Volver» limpia. El comparador real ya existía, sólo estaba escondido.

## Lecciones / gotchas
- `ColorStudio` monta `@xyflow/react`: en jsdom hace falta el stub de
  `ResizeObserver` (copiado de `ColorStudio.test.tsx`) y `matchMedia`.
- En jsdom no hay miniatura, así que el slider de la línea divisoria A/B NO se
  monta; el test debe afirmar el badge `ANTES / DESPUÉS`, no el slider.
- `min-width: max-content` en `.rail-tabs button` EMPORA el recorte (el botón
  es flex column con SVG): mejor un mínimo fijo de 78px.
- `width: max-content` en `.editor-mode-tab.active` también empeora; la barra
  colapsada mide 118px → darle 110px a la pestaña activa elimina el recorte.
- `App.test.tsx` en suite serial combinada puede fallar por `waitFor` de 1s
  bajo carga (79/79 pasa aislado). No es regresión de este ciclo; ya estaba
  documentado en handoff §25 como test de navegación ajeno.
- `css-audit.spec.ts` (Playwright, snapshots pixel-perfect) NO se regeneró:
  cualquier cambio visual intencional exige `--update-snapshots` + revisión.

## Verificación
`npm run typecheck` exit 0 · 16/16 (ColorPropertiesPanel+ColorStudio+zoom) ·
`App.test.tsx` 79/79 solo · App.teclado / Timeline / VisualsView /
catalog-verification / visuals verdes · suite serial 152/153 (1 flaky).
Sin commit, push, deploy ni rebuild. Cambios preexistentes intactos.
Informe: `docs/AUDITORIA-VISUAL-EDITOR-2026-11-11.md`.
