# 2026-11-08 — CSS splitting fase 2, slice 4: editor-tools.css

## Qué se hizo

El bloque «Editor · inspector organizado por pestañas» de `app.css`
(163 líneas, 23 reglas: `.clip-inspector`, `.inspector-tabs`,
`.subtitle-io`…) se movió verbatim a `styles/editor-tools.css`, importado
último en `styles/entries/editor.css`. `app.css`: 11.741 → 11.027? no —
11.190 → 11.027 líneas (−163).

Acumulado fase 2: 13.830 → 11.027 (−20,3 %).

## Por qué este bloque sí y los demás no (todavía)

Es el único sub-bloque de «FÁBRICA DE CONTENIDO» con **0 selectores
compartidos** (selector completo) con el resto de `app.css`. Los bloques
editor restantes (timeline markers/snapping/I-O, motion graphics, Lottie,
mezclador, VFX, editor inmersivo, loudness monitor — ~1.8k líneas)
comparten ~200 selectores con la sección ORGANIZACIÓN VISUAL, que los
refina después. Moverlos sin mover también sus refinamientos invertiría
la cascada (el entry carga después de todo app.css y el bloque pisaría
al refinamiento).

## Camino para el slice siguiente (splitter por selector)

1. Parsear app.css con postcss; clasificar cada regla por vista dueña
   (editor set = editor/text-edit/multicam/mixer/vfx/motion/visuals;
   content = resto).
2. Para cada bloque editor a mover, mover TAMBIÉN las reglas de
   ORGANIZACIÓN VISUAL que compartan selector, appendizándolas después
   en el mismo archivo del entry (preserva orden relativo).
3. Grupos mezclados `.a,.b{decl}`: dividir en `.a{decl}`+`.b{decl}` —
   transformación segura (misma especificidad por elemento).
4. Verificación: postcss.parse + chequeo de que todo selector movido no
   tiene reglas restantes en app.css que debieran seguir ganándole, y
   medición visual (SSIM/pixel-diff como la ola 2) antes de declarar done.

## Verificación de este slice

- `postcss.parse` OK en app.css (1.562 reglas) y editor-tools.css (23).
- Overlap vs premium/workspace.css, effect-studio.css, brain.css,
  home.css, premium/views.css, director-convert.css, content-tools.css:
  único hit `.asset-rail` → resuelto por `!important` + especificidad
  `.app-shell .view :is()` en views.css.
- Sin medición visual (mismo caveat que slices 2-3).
