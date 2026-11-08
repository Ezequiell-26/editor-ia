# 2026-11-08 — CSS splitting fase 2, slice 3: content-tools.css

## Qué se hizo

Tres rangos verbatim de `app.css` → `styles/content-tools.css`, importado
en `entries/content.css` después de `director-convert.css`:

| Rango original | Contenido | Vista |
|---|---|---|
| 7182-7364 | `.factory-*` | Fábrica de contenido |
| 7530-7782 | `.download-*` | Descargador social |
| 8092-8206 | `.convert-*` + drop zone + `@keyframes drop-in` | Convertidor / Medios |

`app.css`: 11.741 → 11.190 líneas. Acumulado fase 2: 13.830 → 11.190
(−19,1 %).

## Qué se dejó en critical (a propósito)

Dentro de la sección «FÁBRICA DE CONTENIDO» quedan: inspector por
pestañas (`.clip-inspector`), media organization (`.rail-fav`,
`.asset-fav`, `.rail-tags` — selectores del rail del EDITOR), timeline
markers/snapping/I-O, motion graphics, Lottie, mezclador Fairlight, VFX,
editor inmersivo y monitor de loudness. Pertenecen a vistas editor
(`EDITOR_STYLE_VIEWS`) o son compartidos → candidatos al entry
`editor.css` en un slice futuro, no a content.

## Cascada

- Orden relativo preservado: en app.css original director < fábrica <
  descarga < conversor; en el entry quedan `director-convert.css` →
  `content-tools.css` en ese orden.
- Overlaps verificados: `.factory-image:has(input:focus-visible)` queda
  en app.css con mayor especificidad; `.assets-view{position:relative}`
  no comparte propiedades con `.assets-view` de la sección assets que
  queda; los hits contra `premium/views.css` son selectores scopeados
  `.app-shell` o con `!important` (ganan por especificidad, no por orden).

## Verificación

`postcss.parse` OK en ambos archivos (app.css 1.585 reglas,
content-tools.css 78). Sin medición visual — pendiente igual que slice 2.

## Siguiente

- Bloques editor de FÁBRICA → `entries/editor.css` (mismo patrón).
- «ORGANIZACIÓN VISUAL» (~2.2k líneas, selectores `.transport`,
  `.timeline-*`, `.rail-*`, `.preview-*`…): refinamientos globales que
  probablemente correspondan al editor entry o quedarse — requiere
  decidir por vista dueña de cada regla.
