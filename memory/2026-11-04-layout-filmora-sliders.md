# Layout Filmora: paneles rectos sin aire, sliders en toda la app — 2026-11-04

## Pedido

Con dos capturas de Filmora: «que los videos o imágenes se vean como en la foto,
bien posicionados; que toda la app tenga barras de deslizamiento (sliders)» y
«aprovechá cada espacio del editor y que las puntas sean rectas, no redondeadas».

## Cambios

### Editor sin aire y con esquinas rectas (`premium/workspace.css`)

- `.editor-workspace`: `gap: 0` y `padding: 0` (antes 10/12 px alrededor).
- `.editor-grid`: `gap: 0` (antes 8 px, y 6/10 según densidad) y la columna del
  divisor pasa de 6 px a **1 px**.
- Paneles (`.asset-rail`, `.preview-panel`, `.inspector`, `.timeline-panel`,
  `.editor-mode-panel`): `border: 0`, `border-radius: 0`; la separación es una
  hairline (`border-right`/`border-left`/`border-top`) para que no queden líneas
  dobles.
- Divisor del inspector: línea de 1 px con zona de agarre de 9 px
  (`::before`), acento al hover.
- `.editor-mode-tabs`: fondo `--chrome-1` + hairline inferior.
- `.preview-stage`: `padding: 34px 0 0` (antes 44px + 10px a los lados y 8
  abajo). El lienzo toca los bordes del panel.
- `.preview-canvas`: `border-radius: 0`, sin marco ni sombra.

Causa de fondo de las esquinas redondeadas: `commercial.css` aplicaba
`border-radius: 10px !important` a los cuatro paneles del editor. Se sacaron de
esa lista (Ola 2, como ya estaba previsto en el comentario del archivo) y el
bloque «impasse» de `workspace.css` ahora fuerza `border-radius: 0`.

### Deslizadores en toda la app (`premium/components.css`)

- Se eliminó la regla vieja que pintaba `input[type=range]` como una píldora de
  4 px con `!important` (tapaba cualquier pista).
- Nuevo bloque «Deslizadores (toda la app)»: `appearance: none`, pista de 3 px,
  pulgar redondo blanco de 12 px con sombra, hover con escala y anillo de foco.
  Aplica a **todos** los `input[type=range]` del producto.
- `commercial.css`: el `input, select, textarea` con `!important` pasó a
  `input:not([type='range'])` — dibujaba una caja de 8 px de radio alrededor de
  cada slider.
- Nota de especificidad: los selectores de pista usan `input.color-slider-input`
  (0,2,1) porque `input[type='range']` (0,1,1) les ganaba y el degradado no se
  pintaba.

### Panel de color con sliders HSL (`components/ColorSwatch.tsx`)

Debajo de la rueda, tres filas como el panel HSL de Filmora: **Tono**
(degradado espectral, 0-360°), **Saturación** (gris → color) y **Luminancia**
(negro → color → blanco), cada una con su valor a la derecha. El componente
`ColorSlider` es local y usa `--color-slider-track` para el degradado.

## Verificación

- `tsc` OK; suite del desktop: **1534 pruebas, 0 fallos** (incluye las 8 de
  `ColorWheel.test.tsx`).
- Medido en 1088/1360/1600 px: `gap: 0px`, `border-radius: 0px` en los paneles,
  divisor de 1 px, timeline a todo el ancho, lienzo centrado.
- Capturas: editor completo (1360 y 1600), panel de Apariencia con sliders
  nuevos, popover de color con rueda + tres sliders HSL.

## Decisiones

- El monitor queda en **Ajustar** (fit) por defecto: un proyecto 9:16 en un
  panel ancho se ve centrado y completo, como el player de Filmora; «Llenar»
  (cover) sigue disponible. Probé poner cover por defecto y recortaba el cuadro
  a una franja, así que se revirtió.
- Las esquinas rectas se aplican a los paneles del editor. La ventana de Windows
  sigue redondeada por el sistema (DWM); si el usuario se refería a eso, hay que
  pedir `DWMWCP_DONOTROUND` en `lib.rs`.
