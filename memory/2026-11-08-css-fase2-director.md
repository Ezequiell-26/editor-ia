# 2026-11-08 — CSS splitting fase 2, slice 2: Director + Convertidor al entry de contenido

## Qué se hizo

La sección «DIRECTOR AUTOMÁTICO + CONVERTIDOR» de `styles/app.css`
(868 líneas, 127 reglas) se movió verbatim a `styles/director-convert.css`
y se importa ÚLTIMA en `styles/entries/content.css` (entry lazy de vistas
de contenido que ya existía). `app.css`: 12.609 → 11.741 líneas.

Acumulado fase 2 hasta acá: 13.830 → 11.741 (−15,1 % del CSS crítico
original).

## Decisiones de cascada

- Las reglas movidas ahora cargan DESPUÉS de todo `app.css` (el entry es
  dinámico). Antes de mover se verificó que el único selector compartido
  con el resto de `app.css` era `.director-cut-index`: la sección
  ORGANIZACIÓN VISUAL lo pisaba con `color: var(--color-text-muted)`.
  El override viaja como regla final dentro de `director-convert.css`,
  reproduciendo el resultado exacto.
- Overlaps con `home.css` y `premium/views.css` (mismo entry): sólo
  `.director-view`/`.director-source`, sin conflicto de propiedades —
  views.css gana por `!important` y mayor especificidad de todos modos.
- La sección no tenía selectores bare de elemento (todo con clase o
  scope `.director-view`/`.convert-view`).

## Verificación

- `postcss.parse` OK: app.css 1.663 reglas, director-convert.css 127.
- Análisis de overlap por primer token de clase + revisión manual de los
  hits.
- Pendiente honesto: no se corrió la app ni medición CDP/SSIM — la
  verificación visual de la ola 2 (pixel-idéntico) no se repitió; el
  análisis de cascada es la evidencia.

## Siguiente slice

«FÁBRICA DE CONTENIDO» (~2.4k líneas) mezcla vistas content
(factory/download/convert-tools) con editor (timeline markers/snapping,
audio mixer, VFX, immersive editor) → requiere splitter por selector,
no por bloque. «ORGANIZACIÓN VISUAL» (~2.2k) son refinamientos globales
que probablemente deben quedar en critical o moverse enteros al final.

## Archivos

- `styles/app.css` (−868 líneas)
- `styles/director-convert.css` (nuevo, +872 con override)
- `styles/entries/content.css` (+@import)
- `docs/IMPROVEMENT-QUEUE.md`, esta memoria
