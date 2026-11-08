# 2026-11-08 — CSS splitting fase 2, slice 6: el tramo grande

## Qué se hizo

- El resto de la sección «FÁBRICA DE CONTENIDO» (~1.55k líneas contiguas:
  timeline markers/snapping/I-O, motion graphics, Lottie, mezclador
  Fairlight, VFX, editor inmersivo, monitor de loudness) se movió
  verbatim a `styles/editor-tools.css`.
- Las 33 reglas de «ORGANIZACIÓN VISUAL» que refinaban selectores movidos
  viajaron al final del mismo archivo (30 enteras + 3 grupos mixtos
  divididos por selector con postcss). La sección FÁBRICA quedó vacía y
  su header huérfano se eliminó.
- `app.css`: 10.922 → 9.198 líneas. **Acumulado fase 2: 13.830 → 9.198
  (−33,5 %)**.

## Técnica (repetible para futuras pasadas)

1. Extraer el rango contiguo por bloques (postcss no hizo falta para el
   movimiento verbatim).
2. Construir el conjunto de selectores movidos desde el archivo destino.
3. Parsear la sección de refinamientos (ORGANIZACIÓN VISUAL) con postcss;
   para cada regla que toque un selector movido: si es toda movida →
   clonar al final del entry; si es mixta → dividir el grupo por
   selector (partes movidas viajan, partes quietas se quedan en app.css
   en su posición).
4. Verificar: 0 reglas de la sección org que toquen selectores movidos
   queda en app.css + multiset check de reglas.

## Verificación

- `postcss.parse` OK en todos los archivos.
- Multiset check: las 1.708 reglas únicas del app.css original (git
  HEAD) existen en el nuevo conjunto (app.css + home + views +
  workspace + effect-studio + brain + director-convert + content-tools
  + editor-tools): **0 faltantes**.
- Orden de cascada preservado por construcción: para cada selector
  movido, head(app.css) → bloques(entry) → refinamientos(entry), igual
  que antes (todo app.css → entries).
- **Pendiente honesto**: no se corrió la app ni medición visual. La ola
  2 original exigía SSIM/pixel-diff; queda como verificación pendiente
  para cerrar la fase del todo.

## Estado del critical path

app.css ahora contiene: tokens, shell (topbar/sidebar/banner),
primitivas compartidas (botones/cards/inputs/modals legacy), secciones
STUDIO UI (control-room chrome) y ORGANIZACIÓN VISUAL sólo para
selectores no-movidos (shell, transport, preview, rail base, content
views). Todo lo de vistas editor vive en `editor-tools.css` dentro del
editor entry; lo de herramientas content en `content-tools.css` +
`director-convert.css` dentro del content entry.

## Slice 7 (misma sesión) — refinamientos org de vistas content

- 76 reglas de ORGANIZACIÓN VISUAL con selectores 100% content
  (yt-, creator-, delogo-, plugin-; grep: cero uso en editor/components;
  usos residuales en home/learn = vistas content igualmente) → content-tools.css.
- 0 grupos mixtos. app.css queda en 8.718 líneas (−36,9 % vs 13.830).
- Queda en org sólo lo de editor-base (transport/preview/rail/timeline…),
  shell y prefijos ambiguos (auto-, ai-, home-, script-, review- con uso
  mixto) — moverlos exige clasificación por uso + verificación visual.
