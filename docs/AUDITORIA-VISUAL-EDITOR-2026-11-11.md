# Auditoría visual del editor completo — 2026-11-11

> Pedido: «arreglá todo, revisá que todo se vea bien sin errores, que nada
> sobreponga nada, revisá el editor entero, bien minimalista» + «agregá más
> cosas de front end que tiene CapCut».

## 1. Método (medición, no impresión visual)

- Arnés **temporal** `apps/desktop/visual-audit.html` + `src/__visual_audit.tsx`:
  monta el `Shell` real con `ProjectProvider` + `createDemoProject()` +
  `createFakeService()` y el **mismo cascade de CSS que `main.tsx`**. Es la única
  forma de ver el editor con proyecto abierto en navegador (la app real en
  browser muestra empty-state). Se elimina al cerrar el ciclo.
- Servidor de verificación: `npx vite --host 127.0.0.1 --port 3210 --strictPort`
  desde `apps/desktop` (3001 pertenece a otro worktree).
- Playwright/Chromium headless. **62 estados**: 3 resoluciones
  (1600×900 / 1360×768 / 1280×720) × (editor inicial, las 9 pestañas del rail,
  clip seleccionado, las 4 pestañas del inspector) + 17 vistas completas.
- Detector sobre DOM real: geometría de 41 paneles, **solapamientos con rect
  recortado por cada ancestro** (`overflow: hidden/clip/auto/scroll`), scroll
  oculto, textos cortados, elementos fuera de viewport y errores de consola.
  El recorte por ancestro es clave: sin él, el contenido de un panel con scroll
  produce decenas de falsos positivos (primera pasada: 23 «overlaps»).

## 2. Antes → después (medido)

| Métrica | Primera pasada | Auditoría definitiva |
|---|---|---|
| Solapamientos reales por estado | hasta 23 | **2** (ver §5) |
| Etiquetas cortadas | hasta 36 por estado (12 en el inspector, 9 pestañas del rail, 5 plantillas de efecto, 2 categorías, 2 medidores, ruta del proyecto…) | **0 en los 62 estados** |
| Scroll horizontal oculto | 3–37 | 3–10 (sólo regla del timeline e `input` nativos) |
| `scrollWidth != clientWidth` del documento | 0 | **0** |
| Paneles fuera de viewport | 0 | **0** |
| Errores de consola | 1 (favicon del arnés temporal) | **0** |

## 3. Defectos corregidos (`styles/editor-clarity.css`, capa aditiva final)

Toda la capa está acotada a `:root[data-theme='dark']`, usa alta especificidad
y `!important`, y **no reemplaza** ninguna hoja anterior (`capcut-ui`,
`capcut-editor`, `capcut-inspector`, `filmora-*`). El tema claro y el preset
«CapCut» conservan sus capas.

1. **Inspector**: `label.field > span:first-child` quedaba en 60px con ellipsis;
   «Paneo (−1 izq · +1 der)», «Desplazamiento (frames)», «Reducción de ruido
   (%)» y otras 9 etiquetas se cortaban. Ahora caben en **dos líneas reales**
   (clamp de 2) y la columna de control pasa de 82 a 72px.
2. **Pestañas del rail**: ancho fijo 50px + `max-width:48px` con ellipsis
   («Transicio…»). Ahora miden su contenido (mínimo 78px) y la fila conserva
   su scroll horizontal: patrón icono + etiqueta completa de CapCut.
3. **Textos auxiliares**: `.fm-split-templates-note`, `.fine-print`, `dd` del
   rail, ruta del proyecto, nombres de plantillas de efecto y rótulos de
   medidores del mezclador envuelven en lugar de cortarse.
4. **Árbol de categorías**: los ítems deshabilitados llevaban un chip
   «Pendiente» que dejaba 30px al rótulo. Se oculta el chip (el botón ya está
   atenuado y su `title` explica el estado): menos ruido, rótulo completo.
5. **Selector de modo colapsado**: la pestaña activa («Todo»/«Edición») se
   cortaba; la barra pasa de 92 a 118px y la pestaña ocupa ese ancho. Se
   preserva explícitamente el despliegue a 620px en `:hover`.
6. **Facetas del rail**: `max-width:108px` recortaba «Subtítulos por IA» + badge
   por 5px → 140px, aprovechando el scroll horizontal ya existente.
7. **Tarjetas «Pantalla dividida»** a 1280: tipografía 9px en vez de partir el
   rótulo, sin cambiar la caja.

## 4. Features nuevas de front end, tipo CapCut

- **Deslizador continuo de zoom del timeline** (`features/editor/timeline-zoom.ts`):
  escala **logarítmica** 0,2 → 14 px/frame en 100 posiciones, inversa exacta,
  acotada ante entradas no finitas. Se inserta entre los botones `−` / `+`
  sin quitar el `zoom-readout` que consumen los tests. Verificado en DOM:
  grupos de la barra en 6–350 / 352–408 / 410–491 / 493–701, **sin solape**.
- **Comparación antes/después a un clic**: `ColorStudio` ya implementaba el
  visor A/B real (fotograma original vs. `viewerFilter` con `clipPath` y línea
  divisoria), pero sólo se alcanzaba desde «Estudio avanzado de color». Ahora
  `ColorPropertiesPanel` expone un botón **A/B** en el pie que abre el estudio
  con `initialCompare=true`; «Estudio avanzado» lo abre en modo normal y
  «Volver» limpia el estado. Es la comparación real, no un mock.

## 5. Los 2 solapamientos que quedan (intencionales, documentados)

`.editor-mode-tabs` es una barra **colapsada flotante** (`position:fixed`,
franja inferior de 34px, diseño de la capa `filmora-polish`) que se dibuja
sobre `.editor-grid` y `.timeline-panel`. El contenido del timeline termina
**antes** de esa franja (pistas hasta y=730, barra en y=734…768), por lo que
**no tapa ningún control ni contenido**. Se expande a 620px al pasar el mouse.
No se cambió su `z-index`: `.editor-workspace` crea un contexto de apilamiento
con z=90, así que los diálogos (z≥1000, fuera de ese contexto) siempre quedan
por encima.

## 6. Verificación

| Comando | Resultado |
|---|---|
| Auditoría Playwright (62 estados × 3 resoluciones + 17 vistas) | 0 textos cortados · 0 desbordes de documento · 0 paneles fuera de viewport · 0 errores de consola |
| `npm run typecheck` | **exit 0** |
| `ColorPropertiesPanel` + `ColorStudio` + `timeline-zoom` | **16/16** |
| `App.test.tsx` aislado | **79/79** |
| `App.teclado` + `Timeline` + `VisualsView` + `catalog-verification` + `visuals` | **todos verdes** |
| Suite serial combinada (9 archivos) | 152/153; el único fallo es un `waitFor` de 1 s en `App.test.tsx:690` bajo carga (timeout/flaky). **El mismo archivo pasa 79/79 solo**; es un test de navegación ajeno a estos cambios, documentado ya en handoff §25. |

## 7. Límites honestos

- La capa CSS aplica **sólo al tema oscuro**; no se auditó el tema claro ni el
  preset «CapCut» opcional en esta pasada.
- Los `hiddenScroll` residuales (3–10) son la regla del timeline (contenido
  legítimo de un área con scroll horizontal) e `input` nativos cuyo valor
  excede su caja: no son recortes visuales.
- El arnés, los scripts de medición y las capturas son **temporales** y se
  borran al cerrar el ciclo. No se hizo commit, push, deploy ni rebuild.
- No se regeneraron los snapshots pixel-perfect de `e2e/css-audit.spec.ts`:
  son una suite Playwright separada y cualquier cambio visual intencional
  exige `--update-snapshots` con revisión del diff. Queda como tarea explícita
  si se quiere alinear esa suite.

## 8. Revalidación de snapshots — 2026-11-12

Se ejecutó npx playwright test e2e/css-audit.spec.ts --workers=1 --reporter=line sin actualizar snapshots.

- Resultado: **13/13 fallidos** por diferencias pixel-perfect contra las imágenes de referencia existentes (maxDiffPixelRatio: 0).
- Diferencias observadas: Inicio 33%; Proyectos 3%; Guion 2%; Medios 2%; Producción 2%; Editor 3%; Descargar 5%; Creador 5%; Laboratorio 2%; Aprender 5%; Director 2%; AI Hub 5%; MCP 4%.
- La captura actual de Inicio presenta una superficie hero cian/azul mucho más intensa que la referencia guardada. Es un candidato a revisión de contraste/jerarquía; el fallo de snapshot por sí solo no demuestra un defecto funcional.
- No se regeneraron snapshots ni se aceptaron cambios visuales automáticamente. Los artefactos actual/diff quedaron en apps/desktop/test-results/ para revisión.
- Los tests anteriores de TypeScript, Vitest y navegación siguen siendo evidencia separada; esta revalidación **no pasa** el control pixel-perfect.
- Pendiente: comparar los 13 pares actual/referencia, decidir qué cambios son intencionales y corregir los no deseados; recién después actualizar snapshots con revisión visual explícita.
