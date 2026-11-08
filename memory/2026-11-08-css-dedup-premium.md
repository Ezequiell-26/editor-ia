# 2026-11-08 — CSS splitting fase 2, slice 1: dedup del bloque premium

## Qué se hizo

`apps/desktop/src/styles/app.css` tenía el sistema de componentes premium
(button/card/input/modal/dropdown/tooltip/tabs/progress/badge/alert/avatar/
showcase) duplicado casi verbatim: bloque A en líneas 483-1855 y bloque B
en 1968-3173, más un «OLD OVERRIDES» extra en 3174-3188 contenido en el de
1855-1967. Se borraron las líneas 1968-3188 (1.221 líneas, −8,8 % del
archivo: 13.830 → 12.609).

## Por qué es seguro (evidencia, no suposición)

1. Las 168 reglas del bloque B son texto idéntico a reglas del bloque A
   (comparación por chunks de regla, comentarios ignorados).
2. Los 7 @-rules de B (@media ×2, @keyframes ×5) son idénticos a los de A,
   incluido `shimmer` definido dos veces en cada bloque.
3. Análisis de cascada: para cada selector del bloque B se buscaron reglas
   con el mismo selector compuesto y distinta declaración en posición
   anterior; sólo aparecieron falsos positivos de @keyframes (`0%`, `50%`,
   `to`) y variantes dentro de @media idénticos (`.cards-grid-*`,
   `textarea` en selector grupal).
4. Verificación empírica: los 170 chunks de regla del rango eliminado
   existen verbatim en el CSS resultante (script node).
5. `postcss.parse` del archivo final: OK — 1.789 reglas, 35 @media, 9
   @keyframes, llaves balanceadas.

## Lección para la fase 2 restante

Las secciones grandes de `app.css` («FÁBRICA DE CONTENIDO» ~9268-11650,
«ORGANIZACIÓN VISUAL» ~11651+, «DIRECTOR AUTOMÁTICO», «STUDIO UI») NO son
extraíbles por bloque contiguo: mezclan CSS de vistas de contenido
(`factory-*`, `download-*`, `convert-*`) con selectores editor/críticos
(`.transport`, `.timeline-toolbar`, `.rail-*`, `.app-shell`, markers y
snapping de timeline). El slice siguiente necesita un splitter a nivel
selector que clasifique cada regla por vista dueña y regenere entries
(`entries/editor.css`, `entries/content.css` o entries por vista), con
verificación pixel/SSIM como hizo la ola 2 original.

## Archivos

- `apps/desktop/src/styles/app.css` (único archivo de código)
- `docs/IMPROVEMENT-QUEUE.md` (entrada `[done]`)
