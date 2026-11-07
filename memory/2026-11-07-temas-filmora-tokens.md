# 2026-11-07 — Tokens de tema bajo la capa Filmora

## Qué pasó

Pasada del loop de mejora. Los specs e2e de color (`theme.spec.ts`,
`settings.spec.ts`) seguían buscando `input[type=color]` y `.hue-slider`,
controles que el producto ya había reemplazado por `ColorSwatch` /
`ColorWheel`. Al actualizarlos apareció un bug real: la hoja
`src/styles/filmora/filmora.css` se importa última y redefinía las
variables `--fm-*`/`--chrome-*` con literales hardcodeados, así que los
tokens canónicos `--color-*` del estudio de color no llegaban a ninguna
superficie del shell.

## Solución

- `filmora.css`: las variables neutras `--fm-*` derivan de
  `var(--color-*)`; los shades sin token equivalente usan `color-mix()`
  calibrado contra la paleta filmora para reproducir el literal original
  (preset visualmente idéntico, el tema custom ahora propaga).
- Los literales que quedan son colores de contenido/hue (playhead, snap,
  danger, scrim, preview) y todo el bloque light-theme.
- Ojo al testear temas: el diálogo de Ajustes **reemplaza** al shell en
  el DOM; la línea base hay que tomarla con el diálogo cerrado.

## Verificación

- Playwright: 4/4 tests de color en vivo/persistencia/panel.
- `tsc --noEmit -p apps/desktop/tsconfig.json`: 0 errores.
- vitest `packages/effect-kit/src/engine.test.ts`: 18/18.

## Extra

Fix de tipo en `packages/effect-kit/src/stack.ts` (`setParamKeyframeAt`,
trabajo sin commitear del usuario): el spread condicional de `easing`
rompía `exactOptionalPropertyTypes`; quedó como ternario explícito.
