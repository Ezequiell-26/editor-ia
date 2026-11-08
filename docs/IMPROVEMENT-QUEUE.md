# Cola de mejora continua — Olyvia

Actualizado: 2026-11-08. Un ítem por vuelta. Ningún ítem se marca `done`
sin un test o una medición real. No se toca trabajo del usuario ni se
reconstruye el instalador salvo que el ítem lo pida.

- `[done]` **Rampa del shuttle cortada por cualquier pausa, no sólo por los
  atajos (2026-11-08)** — cierra el «Pendiente honesto» de la entrada rampa
  de velocidad («pausar desde la UI del transporte (botón, scrub) no pasa por
  `endShuttleRamp` — la rampa queda tibia hasta que venza la ventana»), en
  una pasada del protocolo del loop (Devin CLI); portado al worktree en la reconciliación 6 (provider spliteado). El estado de la rampa vivía
  en un `shuttleRef` local de `App.tsx`: sólo el dispatcher de teclado lo
  veía, así que el botón play/pausa y el scrub del `Transport` pausaban sin
  devolver la velocidad a 1× (y al reanudar con Espacio se seguía a la
  velocidad rampada).
  - **Cambio**: la rampa se mudó al store — `shuttleRef` interno +
    `shuttlePress(direction)` y `endShuttleRamp()` en `ProjectStoreValue`
    (`state/shuttle.ts` sigue siendo el módulo puro de la rampa). En este
    worktree el cambio vive en `project-store-provider.tsx` +
    `project-store-types.ts` (provider spliteado) y el dispatcher en
    `app/Shell.tsx`. `setPlaying(false)` corta la rampa de forma
    automática cuando `active` —antes del early-return— y una velocidad
    manual del selector no se toca. Los casos `playback.shuttleForward`/
    `Reverse` llaman `store.shuttlePress` y las pausas quedan cubiertas
    por `setPlaying`. `Transport.tsx` no necesitó cambios: su botón y su scrub
    ya pasan por `setPlaying(false)`. `shortcuts-pro.test.ts` actualiza la
    evidencia de ambos atajos a `store.shuttlePress`.
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `project-store.test.tsx` **12/12** (+3 tests de
    regresión: la rampa sube y `setPlaying(false)` vuelve a 1×, la dirección
    inversa queda en su contexto, la velocidad manual sobrevive a la pausa)
    · `shuttle.test.ts` **8/8** · `shortcuts-pro.test.ts` **5/5** ·
    `Transport.test.tsx` **4/4** · `App.test.tsx` **77/77**. No se tocó Rust
    ni el contrato del documento.
  - **Archivos**: `state/project-store-provider.tsx` + types (+test),
    `state/shortcuts-pro.test.ts`, `app/Shell.tsx`, `docs/ATAJOS-PRO.md`, esta
    entrada, `memory/2026-11-08-shuttle-rampa-store.md`.
  - **Pendiente honesto**: la rampa sigue siendo por pulsaciones (la
    auto-repetición del SO también escala); `endShuttleRamp` queda expuesto
    para una pausa futura que necesite cortar la rampa sin tocar `playing`
    (hoy `setPlaying(false)` lo cubre); el estado sigue siendo de sesión —
    no persiste ni va al documento, igual que la velocidad, y `adopt`/
    `closeProject` no lo resetean (la ventana de 1,5 s lo expira sola).

- `[done]` **`stateRef` del project-store sincronizado de forma eager en
  todos los mutadores del documento (2026-11-08)** — cierra el follow-up
  «`runGraph` llama `store.update` + `saveNow` en el mismo tick; `saveNow`
  lee `stateRef` que aún no refleja el update» asentado el 2026-11-07, que
  resultó ser un bug **sistémico**, en una pasada del protocolo del loop
  (Devin CLI); portado al worktree de arquitectura en la reconciliación 5 (provider spliteado: mismo cambio en `project-store-provider.tsx`).
  - **Brecha medida**: `applyRecipe` (vía `store.update`/`mutate`), `undo`,
    `redo`, `adopt`, `closeProject`, `setIoPoint` y `clearIoRange` pedían el
    render con `setState`, pero `stateRef.current` —leído por `saveNow`,
    `getProject`, `durationOf` y la siguiente `applyRecipe`— recién se
    actualizaba cuando React renderizaba (`stateRef.current = state` en el
    cuerpo del provider). Consecuencias reales: (a) dos `update` en el mismo
    tick encadenaban sobre el documento viejo y **la primera edición se
    perdía**; (b) `update` + `saveNow` inmediato guardaba el documento
    anterior (el `setTimeout(0)` de `NodeGraphView` era un parche frágil y
    la mayoría de los callers —AssistantDock, ExportDialog, Inspector,
    MenuBar— no lo tenían); (c) `DownloadView` ya documentaba el mismo
    síntoma («dos llamadas seguidas en el mismo tick se pisan») y lo
    esquivaba con `withImportLock` + tick.
  - **Cambio** (`state/project-store.tsx` en main; en este worktree el provider vive en `state/project-store-provider.tsx` tras el split de Fase 2): los mutadores del documento
    adelantan `stateRef.current` de forma síncrona antes de pedir el render
    —mismo criterio que `playbackRef` ya usaba para el playhead— calculando
    el próximo estado desde el ref y manteniendo el `setState` funcional
    para el commit de React. Cubiertos: `applyRecipe` (proyecto, phase,
    error, notice, undo, redo), `undo`, `redo`, `adopt` (estado completo),
    `closeProject` (`INITIAL`), `setIoPoint`/`clearIoRange` (`ioRange`, que
    `saveNow` combina con el proyecto vía `projectWithIoRange`). Quedan
    fuera a propósito los campos que ningún lector síncrono usa para
    decidir (selection, notice suelto, exportRequested, recoveryOffer,
    transiciones `saving`/`saved` de `saveNow`/`saveAs`).
  - **`NodeGraphView.tsx`**: eliminados los dos `setTimeout(0)` que cedían
    un tick antes de `saveNow` (ya innecesarios; el comentario documenta el
    nuevo contrato). `DownloadView` conserva su `withImportLock` (serializa
    imports entre sí, no sólo el tick).
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `project-store.test.tsx` **9/9** (+2 tests de
    regresión que **fallan sobre el código anterior** — verificado
    restaurando `HEAD` temporalmente: «dos update en el mismo tick» dejaba
    1 sola pista en vez de 2, y «update + saveNow» guardaba el documento
    sin el cue— y pasan con el fix) · `src/state` completo **776/776** ·
    `src/features/nodes` 13/13 · `App.test.tsx` **77/77**. No se tocó Rust
    ni el contrato del documento.
  - **Archivos**: `state/project-store-provider.tsx` (port), `state/project-store.test.tsx`,
    `features/nodes/NodeGraphView.tsx`, esta entrada,
    `memory/2026-11-08-stateRef-eager.md`.
  - **Pendiente honesto**: el adelanto es por mutador — un `setState`
    futuro que cambie `project`/`undo`/`redo`/`ioRange`/`opened` sin tocar
    `stateRef` reintroduciría la clase de bug (el contrato quedó escrito
    junto al ref); si una edición y un `setNotice`/`setSelection` quedan en
    el mismo tick, el ref puede mostrar transitoriamente el campo viejo
    hasta el próximo render (ningún lector síncrono lo consulta); un render
    concurrente descartado por React podría hacer retroceder el ref a un
    estado ya comprometido (peligro preexistente de `stateRef.current =
    state` en el cuerpo del render, no agravado por este cambio).

- `[done]` **CSS splitting fase 2 · slice 1: dedup del bloque premium
  duplicado (2026-11-08)** — primer corte de la segunda fase de CSS
  splitting (pendiente sin spec: se definió el alcance como «sacar del
  critical path lo que no es shell ni tokens»).
  - **Hallazgo**: `styles/app.css` tenía el sistema de componentes
    «PREMIUM * SYSTEM» (button/card/input/modal/dropdown/tooltip/tabs/
    progress/badge/alert/avatar/showcase) **dos veces** — líneas
    483-1855 y 1968-3173 — más un segundo «OLD OVERRIDES» duplicado
    (3174-3188 ⊂ 1855-1967). ~1.221 líneas redundantes en el CSS crítico.
  - **Prueba de redundancia** (no fue borrado a ciegas): las 168 reglas
    del bloque B son texto idéntico a reglas del bloque A; los 7 @-rules
    (2 @media + 5 @keyframes, incl. `shimmer` definido dos veces) son
    idénticos; análisis de cascada por selector compuesto no encontró
    ninguna regla con mismas propiedades y distinta declaración entre el
    original y la copia; verificación empírica final: los 170 chunks de
    regla del rango borrado existen verbatim en el archivo resultante.
  - **Cambio**: `app.css` 13.830 → 12.609 líneas (−8,8 %). Sin cambios de
    selectores ni declaraciones: el CSS computado es idéntico por
    construcción.
  - **Verificación**: `postcss.parse` OK (1.789 reglas, 35 @media, 9
    @keyframes, llaves balanceadas) · prueba de presencia de chunks
    170/170 · `git diff` revisado.
  - **Archivos**: `apps/desktop/src/styles/app.css`, esta entrada,
    `memory/2026-11-08-css-dedup-premium.md`.
  - **Sigue vivo**: el grueso de la fase 2 — las secciones «STUDIO UI»,
    «FÁBRICA DE CONTENIDO» y «ORGANIZACIÓN VISUAL» mezclan CSS de vistas
    de contenido con selectores editor/críticos (`.transport`,
    `.timeline-toolbar`, `.app-shell`, `.rail-*`). Requiere extracción a
    nivel selector con clasificación por vista, no por bloque contiguo.

- `[done]` **CSS splitting fase 2 · slice 2: Director + Convertidor al
  entry de contenido (2026-11-08)** — primera extracción real de CSS del
  critical path a un entry lazy.
  - **Cambio**: la sección «DIRECTOR AUTOMÁTICO + CONVERTIDOR» de
    `app.css` (868 líneas, 116 selectores, 127 reglas) se movió verbatim
    a `styles/director-convert.css`, importada ÚLTIMA en
    `entries/content.css` (que ya existía para vistas de contenido).
    `app.css`: 12.609 → 11.741 líneas.
  - **Análisis de cascada previo**: único selector compartido con el
    resto de `app.css` = `.director-cut-index` (ORGANIZACIÓN VISUAL lo
    pisaba con `color: muted` más tarde). Solución: el override viaja al
    final del archivo extraído, preservando el resultado exacto.
    Overlaps con `home.css`/`premium/views.css`: sólo `.director-view`/
    `.director-source`, sin conflicto de propiedades (views.css usa
    `!important` y selectores más específicos).
  - **Verificación**: `postcss.parse` OK en los 3 archivos · sin
    selectores bare de elemento en la sección · typecheck no aplica
    (CSS puro) · la medición CDP/SSIM de la ola 2 queda como verificación
    pendiente cuando se corra la app.
  - **Archivos**: `styles/app.css`, `styles/director-convert.css` (nuevo),
    `styles/entries/content.css`, esta entrada,
    `memory/2026-11-08-css-fase2-director.md`.
  - **Sigue vivo**: «FÁBRICA DE CONTENIDO» (~2.4k líneas: factory,
    descarga social, organización de medios, convert, motion graphics,
    Lottie, mixer, VFX — mezcla vistas content Y editor) y
    «ORGANIZACIÓN VISUAL» (~2.2k líneas: refinamientos globales
    editor+shell). Ambas requieren splitter por selector.

- `[done]` **CSS splitting fase 2 · slice 3: Fábrica + Descargador +
  Convertidor/Zona-de-soltar al entry de contenido (2026-11-08)** —
  extracción por sub-bloques contiguos dentro de «FÁBRICA DE CONTENIDO».
  - **Cambio**: tres rangos verbatim de `app.css` →
    `styles/content-tools.css` (nuevo): vista Fábrica (7182-7364),
    Descargador social (7530-7782) y Convertidor + Zona de soltar de
    Medios (8092-8206). Importado en `entries/content.css` después de
    `director-convert.css` para conservar el orden relativo original
    (director < fábrica < descarga < conversor).
  - **Lo que NO se movió** (sigue en critical): inspector por pestañas,
    media organization (`.rail-fav`, `.asset-fav` — selectores de rail
    del editor), timeline markers/snapping/I-O, motion graphics, Lottie,
    mezclador, VFX, editor inmersivo y monitor de loudness — todos
    belong a vistas editor o son compartidos.
  - **Cascada**: overlaps resueltos — `.factory-image:has()` queda en
    app.css con mayor especificidad; `.assets-view{position:relative}`
    no comparte props con la regla que queda; overlaps con
    home/views.css son selectores `.app-shell`-scoped o `!important`.
  - **Verificación**: `postcss.parse` OK (app.css 1.585 reglas,
    content-tools.css 78) · límites de sección revisados · sin medición
    visual (pendiente honesta, igual que slice 2).
  - **Archivos**: `styles/app.css` (−551 líneas), `styles/content-tools.css`,
    `styles/entries/content.css`, esta entrada,
    `memory/2026-11-08-css-fase2-content-tools.md`.
  - **Estado acumulado fase 2**: app.css 13.830 → 11.190 líneas
    (−19,1 %). Queda: media organization parcial, bloques editor de
    FÁBRICA (→ editor.css entry) y ORGANIZACIÓN VISUAL (refinamientos
    globales — evaluar si corresponde moverlos enteros al final del
    critical path o repartirlos por vista).

- `[done]` **CSS splitting fase 2 · slice 9: STUDIO UI clasificado por
  uso real (2026-11-08)** — cierre del barrido mecánico de app.css.
  - **Método**: mismo índice clase→área sobre las 734 reglas de las
    secciones STUDIO UI pass 1+2. Veredictos estrictos: editor sólo si
    TODAS las áreas de sus clases son features editor; content sólo si
    todas son features no-editor (componentes/app compartidos ⇒ stay).
    225 editor + 147 content candidatas; 20 reglas excluidas por
    conflicto de propiedad con reglas que quedan (habrían invertido la
    cascada: p.ej. `.asset-rail` radius/background, hints de color).
  - **@media**: 22 reglas movidas estaban dentro de media queries —
    detectado y re-envueltas con sus params originales en los entries
    (verificado regla por regla).
  - **Verificación**: `postcss.parse` OK · multiset check con EOL
    normalizado: **0 reglas faltantes** vs HEAD · `git diff --check`
    limpio · sin medición visual (pendiente honesta).
  - **Estado acumulado fase 2**: app.css 13.830 → **4.946 líneas
    (−64,2 %)**. Quedan ~705 reglas: tokens, shell, primitivas premium
    compartidas, chrome compartido y refinamientos ambiguos.
  - **Verificación visual real**: suite e2e Playwright completa contra
    Vite dev — **23/23 verdes** (1 skip: raster Lottie requiere media
    real). Cubre navegación por TODAS las vistas, repaint de tema en
    shell+preview, paneles de ajustes, paleta de comandos y chequeo de
    contraste AA. Las hojas extraídas cargan y renderizan correcto.
  - **Verificación pixel real (2026-11-08)**: auditoría A/B con
    Playwright `toHaveScreenshot` — snapshots de las 13 vistas
    navegables contra baseline `3a22c73` (app.css monolítico),
    `maxDiffPixelRatio: 0`. Resultado final: **13/13 pixel-perfect**.
    La auditoría encontró y se corrigió 1 regresión real:
    `.download-notes`/`.download-url` en `content-tools.css` ganaban
    empates de especificidad a `commercial.css` (capa de overrides que
    en baseline cargaba después de app.css) → reglas devueltas a
    app.css. AI Hub resultó no-determinista (contenido vivo), no CSS.
    Spec conservado en `e2e/css-audit.spec.ts` (regenera snapshots al
    primer run). Limitación: sub-vistas del editor (Mezcla/VFX/Motion…)
    requieren proyecto/backend — no auditadas en navegador.
  - **Sigue vivo**: auditoría equivalente dentro del workspace del
    editor cuando haya proyecto de prueba; evaluar si las ~360 reglas
    STUDIO UI que quedaron (uso mixto/compartido) tienen sub-grupos
    separables.

- `[done]` **CSS splitting fase 2 · slice 8: ORGANIZACIÓN VISUAL
  clasificada por uso real de selectores (2026-11-08)** — cierre del
  barrido de la sección org.
  - **Método**: índice clase→área construido grepeando las 180 clases
    únicas de las reglas org restantes contra `src/**/*.{ts,tsx}`;
    cada regla se movió sólo si TODOS sus selectores eran
    editor-exclusivos (52 reglas → `editor-tools.css`) o
    content-exclusivos (116 → `content-tools.css`). 53 reglas quedaron
    (selectores shell, genéricos —`.badge`,`.active`,`.check`— o clases
    sin uso en tsx / uso mixto editor+content).
  - **Verificación**: `postcss.parse` OK en las 3 hojas · 168/168
    reglas movidas sin duplicados · 53 reglas org permanecen en
    app.css · `git diff --check` limpio.
  - **Estado acumulado fase 2**: app.css 13.830 → **7.540 líneas
    (−45,5 %)**. ORGANIZACIÓN VISUAL en app.css quedó reducida a
    refinamientos shell/compartidos.
  - **Sigue vivo**: cierre formal con medición visual CDP/SSIM sobre
    la app real (pendiente desde la ola 2); las 53 reglas restantes
    son intencionalmente críticas.

- `[done]` **CSS splitting fase 2 · slice 7: refinamientos de
  ORGANIZACIÓN VISUAL de vistas content al content entry (2026-11-08)** —
  continuación del tramo de ORGANIZACIÓN VISUAL.
  - **Cambio**: 76 reglas de la sección org cuyos selectores pertenecen
    exclusivamente a vistas content (prefijos `yt-`, `creator-`,
    `delogo-`, `plugin-`; grep: cero uso en `features/editor` ni
    `components`, usos residuales sólo en home/learn = content) movidas
    a `content-tools.css`. 0 grupos mixtos — cobertura completa por
    construcción (toda regla que toca un selector de esos prefijos es
    safe, porque mixed=0).
  - **Verificación**: `postcss.parse` OK · 0 reglas con esos prefijos
    restantes en la sección org · `git diff --check` limpio.
  - **Estado acumulado fase 2**: app.css 13.830 → **8.718 líneas
    (−36,9 %)**.
  - **Sigue vivo**: en org quedan reglas de selectores editor-base
    (transport/preview/rail/timeline/inspector), shell y content-base
    ambiguos (auto-, ai-, home-, script-, review- con uso mixto) —
    moverlas exige clasificación por uso real + verificación visual.
    Cierre formal de la fase: medición CDP/SSIM con la app corriendo.

- `[done]` **CSS splitting fase 2 · slice 6: bloques editor de FÁBRICA +
  refinamientos de ORGANIZACIÓN VISUAL al editor entry (2026-11-08)** —
  el tramo grande de la fase.
  - **Cambio**: (a) el resto de la sección FÁBRICA — timeline
    markers/snapping/I-O, motion graphics, Lottie, mezclador Fairlight,
    VFX, editor inmersivo y monitor de loudness (~1.55k líneas contiguas)
    → `styles/editor-tools.css`; (b) las 33 reglas de la sección
    ORGANIZACIÓN VISUAL que refinaban selectores movidos viajaron al
    final del mismo archivo (30 enteras + 3 grupos mixtos divididos por
    selector). La sección FÁBRICA quedó sin contenido y su header
    huérfano se eliminó.
  - **Cascada**: para cada selector movido el orden relativo quedó
    idéntico (head app.css → bloques entry → refinamientos entry); las
    reglas de ORGANIZACIÓN para selectores NO movidos quedaron intactas
    en app.css. Verificado: 0 reglas de la sección org que toquen
    selectores movidos permanece en app.css.
  - **Verificación**: `postcss.parse` OK · multiset check — las
    **1.708 reglas únicas** del app.css original (git HEAD) existen en
    el nuevo conjunto app.css + 8 hojas de entries (**0 faltantes**) ·
    sin medición visual (pendiente honesta).
  - **Estado acumulado fase 2**: app.css 13.830 → **9.198 líneas
    (−33,5 %)**. El critical path ahora contiene sólo shell + tokens +
    primitivas compartidas + refinamientos globales no-editor.
  - **Sigue vivo**: medición CDP/SSIM sobre la app real para cerrar la
    fase con evidencia visual (la ola 2 lo exigía); evaluar si las
    reglas org restantes para selectores editor-base (transport,
    preview, rail) conviene moverlas también al editor entry.

- `[done]` **CSS splitting fase 2 · slice 5: media organization
  partida por dueño de vista (2026-11-08)** — primer split a nivel
  selector dentro de un bloque mezclado.
  - **Cambio**: la sección «media organization» de `app.css` (105
    líneas) se dividió por vista dueña: `.asset-fav`/`.library-fav`/
    `.asset-meta-form` (AssetsPanel, vista content) → `content-tools.css`;
    `.rail-fav`/`.rail-fav-filter`/`.rail-tags` (EditorAssets, rail
    del editor) → `editor-tools.css`. Grupos mezclados (`.asset-fav,
    .rail-fav {…}`) divididos por selector — misma especificidad y
    declaraciones por elemento, cascada preservada.
  - **Verificación**: script de verificación regla-por-regla — los
    selectores+declaraciones del bloque borrado existen en los destinos
    (**0 problemas**); `postcss.parse` OK (app.css 1.549, content 88,
    editor 32 reglas); ownership confirmado en el código
    (AssetsPanel.tsx vs EditorAssets.tsx).
  - **Estado acumulado fase 2**: app.css 13.830 → **10.922 líneas
    (−21,0 %)**.
  - **Sigue vivo**: bloques editor restantes de FÁBRICA (~1.7k líneas:
    timeline markers/snapping/I-O, motion, Lottie, mixer, VFX, inmersivo,
    loudness) + ORGANIZACIÓN VISUAL (~2.2k) — requieren mover cada bloque
    junto con sus refinamientos de ORGANIZACIÓN VISUAL (mismo patrón que
    este slice, a mayor escala).

- `[done]` **CSS splitting fase 2 · slice 4: inspector por pestañas al
  editor entry + reconciliación 5 (2026-11-08)** — dos piezas en la
  misma pasada.
  - **Reconciliación 5**: fix de main `49aaa98` (`stateRef` eager en
    mutadores del documento — bug sistémico: dos `update` en el mismo
    tick perdían la primera edición) portado a
    `project-store-provider.tsx` (provider spliteado), NodeGraphView sin
    `setTimeout(0)`, +2 tests de regresión. Commit `142bb22`.
  - **CSS slice 4**: bloque «Editor · inspector organizado por pestañas»
    (163 líneas, 19 selectores, 23 reglas) → `styles/editor-tools.css`,
    importado último en `entries/editor.css`. Era el único sub-bloque de
    FÁBRICA con **0 selectores compartidos** con el resto de app.css —
    los demás bloques editor (timeline markers, motion, Lottie, mixer,
    VFX, inmersivo, loudness) comparten ~200 selectores con las
    refinaciones de ORGANIZACIÓN VISUAL y requieren el splitter por
    selector completo (mover regla + sus refinamientos juntos,
    dividiendo grupos mezclados).
  - **Verificación**: `postcss.parse` OK (app.css 1.562 reglas,
    editor-tools.css 23) · overlap check vs los 3 CSS del editor entry y
    los del content entry · tsc 0 errores · vitest project-store 9/9,
    nodes 13/13.
  - **Archivos**: `styles/app.css` (−163 líneas), `styles/editor-tools.css`,
    `styles/entries/editor.css`, provider/test/NodeGraphView del fix,
    `memory/2026-11-08-css-fase2-editor-tools.md` +
    `memory/2026-11-08-stateRef-eager.md`.
  - **Estado acumulado fase 2**: app.css 13.830 → **11.027 líneas
    (−20,3 %)**. Pendiente: splitter por selector para los ~1.8k líneas
    de bloques editor restantes + media organization + ORGANIZACIÓN
    VISUAL (~2.2k, evaluar mover entera o repartir).

- `[done]` **Rampa de velocidad del shuttle `L`/`J` (2026-11-08)** — cierra el
  pendiente 2 de `docs/ATAJOS-PRO.md` («repetir `L`/`J` no cambia la
  velocidad»), portado desde `main` (`43f03d0`) en la reconciliación 4 del
  worktree de arquitectura.
  - **Cambio**: módulo puro `state/shuttle.ts` — `SHUTTLE_RATES`
    1→2→4→8× (tope = clamp 8 de `setPlaybackRate`), ventana de 1,5 s entre
    pulsaciones, `shuttleStep`/`shuttleRate`/`resetShuttle` con tests (8).
    `app/Shell.tsx` gana `shuttleRef`: los casos `playback.shuttleForward`/
    `Reverse` comparten bloque y escriben dirección + velocidad rampada +
    `setPlaying(true)`; `endShuttleRamp()` devuelve la velocidad a 1× sólo
    cuando `active` (la rampa la fijó, no el selector) y corre al pausar
    por Espacio/`K`/saltos de frame. `Transport.tsx`: el selector gana la
    opción 8× para reflejar la rampa.
  - **Verificación en este worktree**: `tsc` + vitest del slice (resultados
    en el commit de la reconciliación).
  - **Archivos**: `state/shuttle.ts` (+test), `app/Shell.tsx`,
    `features/editor/Transport.tsx`, `docs/ATAJOS-PRO.md`, esta entrada,
    `memory/2026-11-08-shuttle-rampa.md`.
  - **Pendiente honesto**: la rampa es por pulsaciones (la auto-repetición
    del SO también escala); pausar desde la UI del transporte (botón,
    scrub) no pasa por `endShuttleRamp` — la rampa queda tibia hasta que
    venza la ventana; el estado es un ref del Shell (cambiar de proyecto no
    lo resetea, pero la ventana lo expira sola).

- `[done]` **Shuttle inverso `J` con dirección real en el motor de
  reproducción (2026-11-08)** — cierra el pendiente 1 de
  `docs/ATAJOS-PRO.md` («`J` no se registró: el motor sólo avanza y
  `playing` es booleano»), en una pasada del protocolo del loop (Devin CLI).
  - **Brecha**: el playhead sólo avanzaba (`frame += delta·fps·rate`) y los
    elementos HTML sólo reproducían a `playbackRate` positivo; no existía
    reproducción hacia atrás ni forma de pedirla.
  - **Cambio**: `playback.direction` (`1 | -1`) en `project-store` con
    contexto propio (`PlaybackDirectionContext`,
    `useProjectPlaybackDirection`, `useProjectPlayback().direction`,
    `setPlaybackDirection`/`getPlaybackDirection` por ref — mismo patrón
    que la velocidad; `adopt`/`closeProject` la reinician a `1`).
    `usePlayback` lee la dirección por tick (cambiarla a mitad de la
    reproducción no reinicia el rAF): el avance es `delta·fps·rate·dir` y
    los bordes son simétricos — hacia atrás frena en el frame 0 o, con
    bucle, salta a `total−1` y sigue; parado en el frame 0 arranca desde
    el último (igual que el forward saltaba a 0 al final). `App.tsx`
    despacha `playback.shuttleForward` (`L` → dirección `1`) y el nuevo
    `playback.shuttleReverse` (`J` → `-1`); `K` y Espacio sólo pausan /
    reanudan y **conservan** la última dirección. `Preview` pasa
    `rate × direction` a `VideoLayer`/`AudioLayer` y el clamp de
    `elementRate` preserva el signo (magnitud 0.1–8 igual que antes).
    `shortcuts.ts` registra `playback.shuttleReverse` con default `J`;
    `Icon` gana `playReverse` y el botón play/pausa del transporte muestra
    el triángulo invertido y un título que declara el sentido.
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `project-store.test.tsx` **7/7** (+1: dirección
    en contexto propio sin renders del store) · `shortcuts-pro.test.ts`
    **5/5** (evidencia y default `J` actualizados) · `Transport.test.tsx`
    **4/4** (+1: en reversa el botón muestra icono `playReverse` y título
    «hacia atrás») · regresión `App.test.tsx` **77/77** + `render-cost`
    1/1 + `PreviewAudioScopes` 3/3 = **81/81**. No se tocó Rust ni el
    contrato del render (la reversa es sólo de preview).
  - **Archivos**: `state/project-store.tsx` (+test),
    `state/shortcuts.ts` (+test), `App.tsx`,
    `features/editor/{usePlayback.ts,Preview.tsx,Transport.tsx}`
    (+tests), `components/Icon.tsx`, `docs/ATAJOS-PRO.md`, esta entrada,
    `memory/2026-11-08-shuttle-inverso-j.md`.
  - **Pendiente honesto**: la reversa depende de `playbackRate` negativo
    del elemento HTML (Chromium/WebView2 lo soporta; en un motor que lo
    ignore el playhead retrocede pero el medio no — la corrección de
    deriva por `sourceSeconds` lo reconduce); `preservesPitch` puede no
    aplicar en reversa y el audio invertido no es una referencia (es
    revisión visual); no hay rampa de velocidad por teclas repetidas
    (pendiente 2 de ATAJOS-PRO); el bucle inverso envuelve al último
    frame, decisión tomada acá para mantener la simetría con el forward.

- `[done]` **Lista de keyframes por parámetro en el editor de curva de
  efectos (2026-11-08)** — cierra el «Pendiente honesto» de la pasada del
  selector `easing` (2026-11-08): «el easing se edita por tramo dentro del
  popover de curva (no hay lista de keyframes por parámetro como la del
  Inspector de transform)», en una pasada del protocolo del loop (Devin
  CLI). Hasta acá una clave suelta sólo se podía borrar con el playhead
  exactamente sobre ella (◆) o vaciando toda la pista (×).
  - **Cambio**: `removeParamKeyframe(stack, instanceId, paramId, frame)` en
    `packages/effect-kit/src/stack.ts` — quita la clave del frame y, con la
    misma invariante que `toggleParamKeyframe`, elimina la pista entera si
    quedan menos de 2 claves (el schema exige mínimo 2). En
    `EffectStackPanel.tsx`, dentro del popover «Curva» (junto al editor
    Bézier y a los selectores de tramo), una `.keyframe-list` muestra cada
    clave ordenada: `frame N · valor` (+ «curva propia» o el nombre del
    preset si no es lineal) y un × por fila que la borra sin mover el
    playhead. Reusa las clases `.keyframe-list`/`.keyframe-row` del
    Inspector; CSS nuevo mínimo `.effect-param-keys`.
  - **Verificación**: vitest effect-kit **56/56** (+3 tests de
    `removeParamKeyframe`: borrado suelto 3→2, pista eliminada al quedar
    1 clave, no-op sin pista/clave/instancia) · vitest desktop **49/49**
    en `features/vfx` + `AudioEffectStack` + `KeyframeCurveEditor` (+1
    test: la lista muestra las 3 claves con su easing, el × quita la del
    frame 15 y al quedar una sola la pista desaparece) ·
    `npx tsc --noEmit -p apps/desktop/tsconfig.json` **0 errores**. No se
    tocó Rust ni el contrato del documento.
  - **Archivos**: `packages/effect-kit/src/{stack,index,engine.test}.ts`,
    `apps/desktop/src/features/vfx/EffectStackPanel.tsx`,
    `apps/desktop/src/features/editor/AudioEffectStack.test.tsx`,
    `apps/desktop/src/styles/effect-studio.css`, esta entrada,
    `memory/2026-11-08-keyframe-list-efectos.md`.
  - **Pendiente honesto**: la lista vive dentro del popover «Curva» (no
    está siempre visible como la del Inspector de transform, para no
    inflar cada fila del stack); las filas muestran frame local del clip,
    no timecode (el panel no recibe fps); no hay click-to-seek (el panel
    es puro, sin acceso al playhead).

- `[done]` **Botón «Mover el mate a una pista propia oculta» en la
  transición `luma-wipe` del Inspector (2026-11-08)** — cierra el
  «Pendiente honesto» de la entrada luma-mate-ocultar-pista («no hay UI
  para mover el mate a una pista propia (hay que hacerlo a mano en la
  timeline)»), en una pasada del protocolo del loop (Devin CLI).
  - **Brecha**: cuando el mate compartía pista con otros clips —o estaba
    en la misma pista del clip— el Inspector avisaba «mové el mate a una
    pista propia» pero esa acción no existía en la UI.
  - **Cambio**: `moveLumaMateToOwnTrack` (`features/editor/luma-mate.ts`)
    compone las acciones existentes — `addTrack` con el kind compatible
    (`image`→pista imagen, `video`/`freeze`→video) y etiqueta
    `Mate · <label>` acotada a 120 chars, `moveClip` conservando
    `startFrame`, `updateTrack(hidden:true)`— y devuelve `null` si el
    clip no existe o la pista de origen está bloqueada. En `Inspector.tsx`,
    dentro del bloque `luma-wipe`, el botón aparece cuando el mate está
    en la misma pista del clip o su pista tiene más de un clip (los dos
    casos donde ocultar la pista entera no sirve); el copy del aviso y
    del `fine-print` ahora apunta al botón.
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `luma-mate.test.ts` **13/13** (+3 tests:
    pista nueva oculta con kind video y mates intactos, mate imagen →
    pista imagen, `null` con id inexistente y pista bloqueada) ·
    `features/visuals` **10/10**. No se tocó Rust ni el contrato del
    render.
  - **Archivos**: `features/editor/luma-mate.ts` (+test),
    `features/editor/Inspector.tsx`, esta entrada,
    `memory/2026-11-08-luma-mate-pista-propia.md`.
  - **Pendiente honesto**: el mate sigue sin preview animado en el
    monitor (el frame de transición se congela, igual que el resto de
    transiciones); la pista nueva queda al tope del orden (las pistas
    ocultas no afectan el render, pero si el usuario la muestra vuelve a
    ser una pista de video normal).

- `[done]` **Botón «Bucle» del transporte conectado a la preferencia real
  (2026-11-08)** — bug de UI deshonesta encontrado por inspección en una
  pasada del protocolo del loop (Devin CLI): `Transport.tsx` guardaba el
  estado del bucle en un `useState` local que **nunca llegaba a
  `usePlayback`** — el botón se veía activo pero la reproducción no
  repetía. El bucle real es la preferencia persistida `loopPlayback`
  (Ajustes → Editor → «Reproducir en bucle»), que `usePlayback` ya lee.
  - **Cambio**: el botón ahora refleja `useEditorPreferences().loopPlayback`
    y escribe con `updateEditorPreferences({ loopPlayback: !loop })`, el
    mismo patrón que el ripple de la timeline (`Timeline.tsx`). Transporte
    y Ajustes quedan sincronizados en ambos sentidos y el estado sobrevive
    a reinicios (antes el `useState` moría con el componente).
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `Transport.test.tsx` **3/3** (nuevo: refleja la
    preferencia, inactivo sin ella, el click escribe la preferencia real
    que lee `usePlayback`) · `editor-preferences` 9/9 ·
    `EditorPreferencesCard` 4/4 · `Timeline.pro` 7/7. No se tocó Rust ni
    el motor de reproducción.
  - **Archivos**: `features/editor/Transport.tsx` (+test nuevo), esta
    entrada, `memory/2026-11-08-transport-bucle-real.md`.
  - **Pendiente honesto**: el bucle sigue aplicando sólo a la dirección
    directa; cuando exista shuttle inverso (`J`, pendiente 1–2 de
    `ATAJOS-PRO.md`) habrá que decidir si el bucle envuelve al inicio o al
    final según la dirección.

- `[done]` **Velocidad de reproducción 0.25–4× en el transporte
  (2026-11-08)** — cierra la parte «no existe control de velocidad de
  reproducción» del pendiente 2 de `docs/ATAJOS-PRO.md` (la rampa por
  teclas repetidas sigue pendiente), en una pasada del protocolo del loop
  (Devin CLI). El motor avanzaba siempre a 1× (`usePlayback` sumaba
  `delta·fps`) y los elementos de media de la preview reproducían a
  velocidad natural.
  - **Cambio**: `playbackRef`/`PlaybackRateContext` nuevos en
    `project-store.tsx` — `setPlaybackRate`/`getPlaybackRate` con clamp
    0.1–8 y `useProjectPlaybackRate()`/`useProjectPlayback().rate`, en
    contexto propio para no re-renderizar el store por frame (mismo
    patrón que playhead/playing). `usePlayback` lee la velocidad del ref
    en cada tick (`delta·fps·rate`): cambiarla a mitad de la reproducción
    no reinicia el rAF. `Transport` gana un `<select>` «Velocidad de
    reproducción» con 0.25/0.5/1/2/4×. `Preview.tsx`: `VideoLayer` y
    `AudioLayer` reciben `playbackRate` y fijan
    `element.playbackRate = clipSpeed × rate` con `preservesPitch = true`
    — el elemento avanza exactamente lo que `sourceSeconds` necesita, así
    que el drift-correction de 0.12 s deja de reconducir y el audio
    conserva el tono como el `atempo` del export (antes los clips con
    `speed ≠ 1` re-busaban el `currentTime` cada ~0.12 s de deriva).
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `project-store.test.tsx` **6/6** (+1 test:
    rate en contexto propio sin renders del store, clamp a 8) ·
    `render-cost` 1/1 · `PreviewAudioScopes` 3/3 · `LiveMeters` 23/23 ·
    `App.test.tsx` **77/77** · `Timeline` 20/20 + `Timeline.pro` 7/7 ·
    shortcuts 12/12. No se tocó Rust ni el contrato del render.
  - **Archivos**: `state/project-store.tsx` (+test),
    `features/editor/{usePlayback.ts,Transport.tsx,Preview.tsx}`,
    `styles/app.css`, `docs/ATAJOS-PRO.md`, esta entrada,
    `memory/2026-11-08-velocidad-reproduccion.md`.
  - **Pendiente honesto**: la velocidad es de sesión (no persiste ni va
    al documento); no hay rampa por teclas repetidas (L/J sigue sin
    dirección inversa — el motor sólo avanza); a 4× el avance por rAF
    salta ~2 frames por tick a 30 fps, suficiente para revisar pero no
    frame-exacto.

- `[done]` **VisualsView: color y mate propios se precargan desde el
  `transitionIn` existente (2026-11-08)** — cierra la parte accionable del
  «Pendiente honesto» de la entrada dip-color-por-clip («el color por clip no
  se precarga desde un `transitionIn` existente — el swatch muestra el
  general hasta tocarlo») y el simétrico de `luma-wipe`, en una pasada del
  protocolo del loop (Devin CLI).
  - **Brecha medida**: al aplicar `dip-color` por lote, un clip que ya tenía
  `transitionIn.color` propio (p. ej. afinado en el Inspector) lo perdía: el
  lote escribía el color general en todos. En `luma-wipe` el selector caía al
  primer candidato aunque el clip ya tuviera un mate válido asignado.
  - **Cambio**: `dipColorForClip` (`features/visuals/visuals.ts`) resuelve el
    color efectivo — override de la vista > `null` (fuerza general) > color
    propio del `transitionIn` > general. `dipColorById` pasa a
    `Record<string, string | null>`; el botón «General» aparece cuando el
    color efectivo no es el general (propio u override) y fija `null`. Con un
    solo clip seleccionado el swatch general muestra el color efectivo y al
    cambiarlo guarda override para ese clip (lo que se ve es lo que se
    aplica). `lumaMatePick` (`features/editor/luma-mate.ts`) elige el mate:
    override válido > mate existente válido > primer candidato; lo usan el
    `<select>` y `applyTransition`. Copy del `fine-print` actualizado.
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `features/visuals` + `luma-mate.test.ts`
    **20/20** (`visuals.test.ts` 6/6 con `dipColorForClip` override/null/propio/
    general, `luma-mate.test.ts` 10/10 con `lumaMatePick` 3 tests,
    `VisualsView.test.tsx` 4/4 con el caso nuevo: clip con `dip-color`
    `#123456` propio conserva su color al aplicar el lote mientras el otro
    recibe el general). No se tocó Rust ni el contrato del render.
  - **Archivos**: `features/visuals/{visuals.ts,VisualsView.tsx}` (+tests),
    `features/editor/luma-mate.ts` (+test), esta entrada,
    `memory/2026-11-08-visuals-precarga-transicion.md`.
  - **Pendiente honesto**: para `luma-wipe` el lote sigue sin permitir mates
    «sugeridos» por tramo más allá del selector por clip (ya prefiere el mate
    existente); si el mate propio quedó inválido el selector muestra el
    primer candidato pero no lo marca como «cambiado»; el color/mate no se
    precarga hasta abrir la sección de transición (es resolución en vivo,
    no estado sembrado, así que nunca queda stale).

- `[done]` **`dip-color` con color por clip en la aplicación por lote de
  VisualsView (2026-11-08)** — cierra la primera mitad del «Pendiente
  honesto» de la entrada dip-color/luma-wipe («el lote aplica el mismo
  `color` a todos los clips (no hay color por clip)»), en una pasada del
  protocolo del loop (Devin CLI). El mate por clip de `luma-wipe` ya
  existía; faltaba el equivalente para el color.
  - **Cambio** (`features/visuals/VisualsView.tsx`): estado nuevo
    `dipColorById` (override por clip, mismo patrón que `mateChoice`).
    Con más de un clip seleccionado, debajo del «Color general del
    fundido» aparece una fila por clip con su `ColorSwatch` (valor =
    override ?? general) y, sólo cuando hay override, un botón «General»
    que lo quita. `applyTransition` escribe
    `color: dipColorById[id] ?? dipColor`. Con un solo clip no hay filas
    (el general alcanza). Copy actualizado: el `fine-print` distingue el
    caso multi y el single, y las descripciones del catálogo
    (`visuals.ts` fallback + `commands/visuals.rs`) ya no dicen «el lote
    usa el mismo color para todos». CSS: `.visuals-dip-colors` /
    `.visuals-dip-color-row` en `visuals-view.css`.
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `features/visuals` **8/8** (`VisualsView.test.tsx`
    nuevo, 3 tests: override por clip llega al documento con el general
    en el otro, «General» vuelve al color común, un solo clip no muestra
    filas) · `cargo test -p editor-ia-desktop --lib commands::visuals`
    **6/6** (sólo cambió una cadena de descripción) · `cargo fmt --check`
    limpio en `visuals.rs` (los diffs de fmt en otros archivos son
    preexistentes del árbol, no de esta pasada).
  - **Archivos**: `features/visuals/VisualsView.tsx` (+test nuevo),
    `features/visuals/visuals.ts`, `features/visuals/visuals-view.css`,
    `src-tauri/src/commands/visuals.rs`, esta entrada,
    `memory/2026-11-08-dip-color-por-clip.md`.
  - **Pendiente honesto**: para `luma-wipe` el lote sigue sin permitir
    mates distintos «sugeridos» por tramo más allá del selector por clip
    (ya los elige por clip); el color por clip no se precarga desde un
    `transitionIn` existente — el swatch muestra el general hasta tocarlo.

- `[done]` **DRIFT-PARITY: dos afirmaciones stale corregidas contra el
  código (2026-11-08)** — pasada del protocolo del loop (Devin CLI) sin
  cambios de código de producto: el documento de paridad es fuente de
  verdad para próximas pasadas y declaraba dos cosas que ya no son
  ciertas, lo que podía inducir a rehacer trabajo hecho.
  - **Matriz §2, «20 plantillas de efecto»**: decía «Pendiente: el stack ya
    lo permite, falta la UI». La UI existe desde antes
    (`features/vfx/EffectTemplates.tsx` + `state/effect-templates.ts`:
    guardar/aplicar/exportar/importar stacks como JSON portable) y desde
    el 2026-11-08 además hay catálogo curado de fábrica
    (`state/builtin-effect-templates.ts`, sección «De fábrica»). Celda
    actualizada a «Hecho» con las rutas reales.
  - **§5, «Efectos de audio»**: decía «la preview no los simula; el panel
    lo dice y el MP4 los aplica. Un preview Web Audio por efecto queda
    como trabajo aparte». Falso desde el commit `a7cff32` («audio preview
    30/30»): `features/mixer/clip-audio-fx.ts` resuelve manifiesto +
    keyframes por frame (`clipAudioFxSpec` muestrea `keyframes` en el
    frame pedido, cubierto por test) y `usePreviewAudio.ts` construye la
    cadena Web Audio por clip (`ClipFxChain`/`buildClipFxChain`); el copy
    del panel ya dice «La preview reproduce los 30 efectos del catálogo
    (con keyframes)». El bullet quedó reescrito con el estado real y sus
    límites honestos: shifter granular por AudioWorklet para el pitcheo y
    seguidores de envolvente (`gate`/`leveler`/`deesser`) que leen el RMS
    en el hilo de UI cada ~40 ms — aproximaciones, no sample-exactas; el
    MP4 sigue siendo la referencia.
  - **Verificación**: `npx vitest run src/features/mixer/
    clip-audio-fx.test.ts` → **6/6** (incluye `PREVIEW_AUDIO_FX.size ===
    30` y muestreo de keyframes) · inspección directa de
    `usePreviewAudio.ts` (`buildClipFxChain`, `envelopeFollower` con tick
    fijo de 40 ms) y `AudioEffectStack.tsx` (copy vigente). Sólo docs:
    no aplica typecheck ni suite.
  - **Archivos**: `docs/DRIFT-PARITY.md`, esta entrada,
    `memory/2026-11-08-drift-parity-stale.md`.
  - **Nota de contexto**: los pendientes reales que quedan son grandes o
    bloqueados — transiciones OBS en vivo, física 2D del stickman,
    editor de capas libres del titler, diarización con modelo local,
    importador de paquetes (sandbox real), firma OV/EV (externo) y Ola
    CapCut P1 (gateada a pedido del usuario).

- `[done]` **UI para ocultar la pista del mate de `luma-wipe`
  (2026-11-08)** — cierra el segundo «Pendiente» de la entrada luma-wipe
  («el mate en pista oculta funciona pero no hay UI para sugerirla»), en una
  pasada del protocolo del loop (Devin CLI).
  - **Por qué es seguro**: `render/ffmpeg.rs::luma_mate` resuelve el mate
    por id sin mirar `track.hidden`, y el pipeline ya salta los clips de
    pistas ocultas como imagen (`hidden_tracks`, ffmpeg.rs:4525-4567): el
    mate en pista oculta aporta la máscara sin aparecer en el frame. Lo que
    faltaba era la superficie para llegar a ese estado sin buscar la
    pestaña Pista.
  - **Cambio**: helper puro `lumaMateById` en `luma-mate.ts` (mate por id +
    su pista, sin validar cobertura: sirve aunque el mate esté stale).
    En el bloque `luma-wipe` del Inspector, con mate asignado: checkbox
    «Ocultar la pista «{label}»» que hace `updateTrack(hidden)` y copy que
    distingue tres casos honestos — pista ya oculta (sólo aporta máscara),
    pista con sólo el mate (ocultar no pierde nada más) y pista con más
    clips (avisa que se ocultan todos y sugiere mover el mate a pista
    propia). **Caso bloqueado**: mate en la misma pista que el clip —
    ocultarla también ocultaría el clip en preview y export, así que se
    muestra `notice-warning` en vez del toggle.
  - **Verificación**: `tsc --noEmit -p apps/desktop/tsconfig.json` **0
    errores** · vitest `luma-mate.test.ts` **7/7** (+2 tests de
    `lumaMateById`: mate no candidato válido con pista oculta, y
    undefined sin id/id inexistente/sin pista). No se tocó Rust ni el
    contrato del render.
  - **Archivos**: `features/editor/luma-mate.ts` (+test),
    `features/editor/Inspector.tsx`, esta entrada,
    `memory/2026-11-08-luma-mate-ocultar-pista.md`.
  - **Pendiente honesto**: el mate sigue sin preview animado en el monitor
    (el frame de transición se congela, igual que el resto de
    transiciones); no hay UI para mover el mate a una pista propia (hay
    que hacerlo a mano en la timeline).

- `[done]` **Descargar: los 12 idiomas del backend al traducir subtítulos
  (2026-11-08)** — cierra la asimetría medida entre `translate_subtitles`
  (acepta 12 códigos en `providers.rs::language_name`) y el selector de
  «Traducir los subtítulos al descargar» de `DownloadView`, que sólo
  ofrecía 8 (`es/en/pt/fr/de/it/ja/zh`): `hi`, `ar`, `bn` y `ru` — que
  Localización ya usaba— siempre fallaban con «el idioma de destino no
  está soportado» si se pedían por MCP, y ni siquiera eran elegibles en
  la UI, en una pasada del protocolo del loop (Devin CLI).
  - **Cambio** (`features/download/DownloadView.tsx`): el `<select>` de
    «Idioma de destino» y la grilla «También …» ahora se generan desde
    `LOCALIZATION_LANGUAGES` (`features/localization/localization.ts`,
    la misma lista canónica de los 12 que consume Localización) — una
    sola fuente, sin la lista duplicada que había hardcodeada dos veces.
    El job persiste los mismos códigos (`translateTo`/`translateExtras`
    son strings; jobs viejos en cola siguen válidos).
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `DownloadView.test.tsx` **12/12** (+1 test
    nuevo: las 12 opciones del select con sus etiquetas y los checks
    «También Hindi/Árabe/Bengalí/Ruso») · `queue.test.ts` 9/9 ·
    `features/localization/` 11/11. No se tocó Rust ni el contrato del
    servicio: el backend ya aceptaba los cuatro códigos.
  - **Archivos**: `features/download/DownloadView.tsx` (+test), esta
    entrada, `memory/2026-11-08-descarga-12-idiomas.md`.
  - **Pendiente honesto**: el árabe se guarda como SRT UTF-8 sin marca
    de dirección (el formato no la tiene; los players aplican bidi);
    el doblaje SAPI sigue sin `ja` y la clonación sin `bn`, igual que
    en Localización.

- `[done]` **Forma `custom` (puntos libres) en el titler (2026-11-08)** —
  cierra la mitad «forma custom» del pendiente del titler en
  `docs/KDENLIVE-REFERENCE.md` (el editor visual completo de capas sigue
  pendiente), en una pasada del protocolo del loop (Devin CLI).
  - **Cambio**: `MotionRectLayer.shape` admite `'custom'` + `points`
    (3..16 vértices normalizados 0..1 dentro de la caja de la capa, mismo
    espacio que el `clip-path` del preview y el dibujo ASS). La plantilla
    `badge` gana la opción «Personalizada» en el selector Forma y un campo
    nuevo `kind:'polygon'` que `MotionForm` muestra habilitado sólo cuando
    `shape==='custom'` (`MotionField.requires`, genérico). `points` tiene
    default (cheurón) para que elegir la forma no rompa la validación, y se
    conserva en props si se vuelve a una forma con nombre (la capa lo
    ignora). `PolygonEditor` (nuevo): SVG con `polygon` de relleno, clic en
    el fondo agrega vértice (tope 16), arrastrar mueve, doble clic quita
    (mínimo 3), hint accesible y estado deshabilitado honesto.
    `MotionPreview` emite `clip-path: polygon(...)` con los mismos puntos.
    Rust `render/motion.rs`: `validate_plan` exige `points` válidos con
    `shape:'custom'`; `custom_shape_vertices` + `drawing_commands`
    (emit extraído de `polygon_drawing`) generan el `\p1`; si el plan
    llega inválido el dibujo cae al rectángulo en vez de romper el render.
  - **Verificación**: `tsc --noEmit` desktop **0 errores** · vitest
    `motion` **13/13** (+3: points en la capa, default sin points, shapes
    con nombre ignoran points, points inválidos rechazados) ·
    `PolygonEditor.test.tsx` **7/7** (dibujo, agregar, quitar con mínimo,
    arrastre, disabled, tolerancia a valores inválidos) ·
    `templates-pro` 9/9 · `MotionView` 3/3 · `cargo test -p
    editor-ia-desktop --lib render::motion` **9/9** (+2: dibujo custom con
    coordenadas escaladas exactas, rechazo de points inválidos).
  - **Archivos**: `features/motion/{templates,MotionForm,MotionPreview,
    PolygonEditor}.tsx` (+`PolygonEditor.test.tsx`),
    `features/motion/motion-view.css`,
    `src-tauri/src/render/motion.rs`, `features/motion/motion.test.ts`,
    `docs/KDENLIVE-REFERENCE.md`, esta entrada,
    `memory/2026-11-08-forma-custom-titler.md`.
  - **Pendiente honesto**: la forma custom existe sólo en la plantilla
    insignia (no hay editor de capas libres del titler); los puntos son
    estáticos dentro de la caja (sin keyframes por vértice); no hay
    curvas Bézier entre vértices (ASS `\p1` tampoco las tiene).

- `[done]` **Selector de preset `easing` para keyframes de efecto
  (2026-11-08)** — cierra el «Pendiente honesto» de la pasada Bézier por
  parámetro (2026-11-08): «no hay selector de preset `easing` para
  keyframes de efecto (sólo lineal o curva propia)», en una pasada del
  protocolo del loop (Devin CLI). El campo ya existía en el schema y lo
  honraban preview (`sampleKeyframes`) y export (`effect_ease`); los
  keyframes de transform ya tenían su selector «Curva» en el Inspector.
  - **Cambio**: `setParamKeyframeEasing` en `effect-kit/stack.ts` escribe
    el preset en la clave que inicia el tramo (conserva `value`, quita
    `bezier` para que el preset rija — el bezier gana sobre easing en el
    muestreo). En `EffectStackPanel` (compartido por EffectStudio y
    AudioEffectStack), el popover «Curva» gana un `<select>` por tramo
    («Tramo N», `aria-label` con el parámetro) con Lineal/Acelerar/
    Desacelerar/Suave/Mantener; si la clave tiene curva propia el selector
    muestra «Curva propia» (deshabilitada) y elegir un preset la
    reemplaza. CSS: `.effect-param-easings`/`.effect-easing-field`.
  - **Verificación**: `tsc --noEmit` effect-kit + desktop **0 errores** ·
    vitest effect-kit **53/53** (+2 en `engine.test`: preset conserva
    valor y reemplaza bezier con assert de muestreo, no-op sin pista/clave)
    · vitest desktop **56/56** en los archivos tocados (`AudioEffectStack`
    8/8 con el flujo ◆→Curva→easing→«Curva propia»→preset, `features/vfx` +
    `KeyframeCurveEditor` 48/48).
  - **Archivos**: `packages/effect-kit/src/{stack,index,engine.test}.ts`,
    `apps/desktop/src/features/vfx/EffectStackPanel.tsx`,
    `apps/desktop/src/features/editor/AudioEffectStack.test.tsx`,
    `apps/desktop/src/styles/effect-studio.css`, esta entrada,
    `memory/2026-11-08-easing-por-parametro-efecto.md`.
  - **Pendiente honesto**: el easing se edita por tramo dentro del popover
    de curva (no hay lista de keyframes por parámetro como la del
    Inspector de transform); elegir un preset borra la curva propia de ese
    tramo a propósito.

- `[done]` **`dip-color` y `luma-wipe` en la aplicación por lote de
  VisualsView (2026-11-08)** — cierra el «pendiente honesto» declarado al
  agregar el catálogo de transiciones: el lote no podía ofrecerlos porque
  `dip-color` exige `color` y `luma-wipe` un `mateClipId` elegible por
  clip, en una pasada del protocolo del loop (Devin CLI).
  - **Cambio**: `catalog_transitions()` (Rust) y `FALLBACK_VISUAL_CATALOG`
    suman ambas transiciones (19 en total; `dip-color` con
    `overlapsPrevious: false`, `luma-wipe` con `true`). `VisualsView`
    muestra un `ColorSwatch` compartido cuando el tipo es `dip-color` y un
    `<select>` de mate **por clip seleccionado** cuando es `luma-wipe`,
    con los candidatos de `lumaMateCandidates` calculados sobre la
    transición pendiente (el solape depende de `frames`) — la misma regla
    que valida el render. `batchTransitionIn` (`visuals.ts`) arma el
    `transitionIn` por clip y devuelve `undefined` si falta `color`/`mate`;
    los clips sin mate válido se omiten y el notice lo dice. Thumbnails
    nuevos `dip-color.svg` y `luma-wipe.svg`.
  - **Verificación**: `tsc --noEmit` desktop **0 errores** · vitest
    `visuals.test.ts` **5/5** (lista esperada a 19 + tests de
    `batchTransitionIn`) · `luma-mate` 5/5 · `Timeline` 20/20 ·
    `project-actions` 108/108 · `EditorAssets` 9/9 · `cargo test -p
    editor-ia-desktop --lib commands::visuals` **6/6** · `cargo fmt
    --check` limpio en `visuals.rs`.
  - **Archivos**: `commands/visuals.rs`, `features/visuals/visuals.ts`
    (+test), `features/visuals/VisualsView.tsx`,
    `features/visuals/visuals-view.css`,
    `public/thumbnails/transitions/{dip-color,luma-wipe}.svg`, esta
    entrada, `memory/2026-11-08-dip-luma-lote-visuals.md`.
  - **Pendiente honesto**: el lote aplica el **mismo** `color` a todos los
    clips (no hay color por clip) y para `luma-wipe` elige un mate por
    clip pero no permite mates distintos por tramo; ambos casos siguen
    siendo más finos desde el Inspector.

- `[done]` **Catálogo curado de plantillas de fábrica para stacks de
  efectos (2026-11-08)** — cierra «no hay catálogo curado» de
  `docs/DRIFT-PARITY.md` §5 (Drift trae ~23 presets de fábrica), en una
  pasada del protocolo del loop (Devin CLI).
  - **Brecha medida**: `EffectTemplates` sólo listaba plantillas del
  usuario en `localStorage`; no había punto de partida para quien no
  conoce los 78 efectos del catálogo.
  - **Cambio**: `state/builtin-effect-templates.ts` (nuevo) define 12
    recetas de video + 15 de audio como datos `{effectId, params}` y las
    resuelve contra `effectRegistry` en cada llamada
    (`builtinEffectTemplates(kind)` → `EffectTemplate[]`, ids de instancia
    nuevos, plantilla entera omitida si un efecto ya no existe).
    `EffectTemplates.tsx` muestra la sección «De fábrica» (Aplicar +
    Exportar, sin Quitar) sobre la lista del usuario, ahora rotulada
    «Propias»; el contador del summary suma ambas. CSS:
    `.effect-templates-section`.
  - **Verificación**: `tsc --noEmit` desktop **0 errores** · vitest
    `builtin-effect-templates.test.ts` **4/4** (recetas resuelven y se
    aplican completas con params normalizados) · `effect-templates`
    **7/7** · `EffectTemplates.test.tsx` **6/6** (+2: aplicar «Look cine»
    con su stack y params; sección «De fábrica» separada) · regresión
    `features/vfx` + `AudioEffectStack` **34/34**.
  - **Archivos**: `state/builtin-effect-templates.ts` (+test),
    `features/vfx/EffectTemplates.tsx` (+test),
    `styles/effect-studio.css`, `docs/DRIFT-PARITY.md`, esta entrada,
    `memory/2026-11-08-plantillas-fabrica-efectos.md`.
  - **Pendiente honesto**: las recetas son stacks estáticos (sin
    keyframes); un preset animado (p. ej. zoom-punch con curve) queda
    como mejora si se pide.

- `[done]` **Catálogo de transiciones de VisualsView al día + thumbnails
  faltantes (2026-11-08)** — en una pasada del protocolo del loop (Devin CLI).
  - **Brecha medida**: `catalog_transitions()` (`commands/visuals.rs`, la
    fuente medida que consume `VisualsView`) quedó en 11 entradas y no
    incluía `slide-3d-*` (agregadas al renderer el 2026-11-08), `wipe-*` ni
    `iris`: la vista de aplicación por lote no podía ofrecer 10 de los 18
    tipos del schema. Además `slide-3d-*` pedía
    `/thumbnails/transitions/slide-3d-*.svg` inexistentes (fondo vacío) e
    `iris` no tenía thumbnail; el fallback `FALLBACK_VISUAL_CATALOG` de
    `visuals.ts` (modo navegador / servicio caído) ni siquiera tenía las
    `slide-3d-*`.
  - **Cambio**: `catalog_transitions()` suma `wipe-left|right|up|down` e
    `iris` (los 6 aplicables por lote: `transitionIn: {type, frames}` es
    válido tal cual). `dip-color` y `luma-wipe` quedan **fuera a propósito**
    — el primero exige `color` y el segundo un `mateClipId` elegible por
    clip; el Inspector ya los resuelve. Comentario en el código lo declara.
    `FALLBACK_VISUAL_CATALOG` queda espejo del backend (17 transiciones,
    mismas etiquetas/descripciones/defaults). Thumbnails nuevos:
    `iris.svg` (motivo circular propio) y `slide-3d-{left,right,up,down}.svg`
    (mismo placeholder que el resto del directorio).
  - **Verificación**: `cargo test -p editor-ia-desktop --lib
    commands::visuals` **6/6** (el test de unicidad ahora fija las 17) ·
    vitest `features/visuals/visuals.test.ts` **4/4** (lista esperada
    actualizada a las 17) · `npx tsc --noEmit -p apps/desktop/tsconfig.json`
    **0 errores** · `rustfmt --check` limpio en `visuals.rs`. Sin cambios en
    el renderer: wipe/iris ya exportaban y previsualizaban.
  - **Archivos**: `apps/desktop/src-tauri/src/commands/visuals.rs`,
    `apps/desktop/src/features/visuals/visuals.ts` (+test),
    `apps/desktop/public/thumbnails/transitions/{iris,slide-3d-*}.svg`,
    `docs/IMPROVEMENT-QUEUE.md`, `memory/2026-11-08-catalogo-transiciones-visuals.md`.
  - **Pendiente honesto**: `dip-color`/`luma-wipe` siguen siendo
    Inspector-only (el lote no puede elegir color/mate); si se quiere
    ofrecerlos en VisualsView hay que agregar un selector de color y un
    picker de mate por clip — trabajo aparte.

- `[done]` **UI honesta del clip mate del `luma-wipe` (2026-11-08)** —
  cierra el pendiente declarado al cerrar la transición (2026-11-08): «el
  mate en pista oculta funciona pero no hay UI para sugerirla», en una
  pasada del protocolo del loop (Devin CLI).
  - **`features/editor/luma-mate.ts` (nuevo)**: la lógica de candidatos
    que vivía inline en `Inspector.tsx` queda como función pura
    `lumaMateCandidates(clips, tracks, clip, fps)` — misma ventana activa
    (inicio menos lead, tope `2·fps`, tolerancia de un frame) que valida
    `luma_mate` en Rust — más `lumaMateOptionLabel` (nombre · frame ·
    pista · «pista oculta») y `lumaMateIsStale` (mate asignado que ya no
    es candidato válido: se movió, deshabilitó o cambió de tipo).
  - **`Inspector.tsx`**: las opciones del selector muestran la pista y la
    marca «pista oculta» — el render sólo lee la luminancia del mate, así
    que una pista oculta es una máscara válida y ahora la UI lo dice. Si
    el mate asignado quedó inválido, el selector conserva la opción
    «Mate actual (ya no cubre el solape)» y un `notice-warning` explica
    que el export va a fallar hasta elegir otro mate. Si no hay
    candidatos, un `fine-print` explica qué puede ser mate (video,
    imagen o freeze en cualquier pista, oculta incluida).
  - **Verificación**: vitest `luma-mate.test.ts` **5/5** (cobertura del
    solape, lead propio del mate, marca de pista oculta en la etiqueta,
    mate stale y mate vigente) · `tsc --noEmit` desktop **0 errores** ·
    vitest `EditorAssets` 9/9, `Timeline` 20/20, `project-actions` 108/108.
    No se tocó Rust: el renderer ya aceptaba mates en pistas ocultas.
  - **Archivos**: `features/editor/luma-mate.ts` (+test),
    `features/editor/Inspector.tsx`, `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-08-mate-luma-wipe-ui.md`.
  - **Pendiente honesto**: el mate animado sigue congelado en el preview
    del monitor (un frame, igual que el resto de transiciones); crear un
    mate nuevo (p. ej. freeze sobre la zona del solape) sigue siendo
    manual.

- `[done]` **Transición `iris` con máscara radial + fix de borde en
  `wipe-left`/`wipe-up` (2026-11-08)** — continúa la cola de transiciones
  Kdenlive (`docs/KDENLIVE-REFERENCE.md` §4), en una pasada del protocolo
  del loop (Devin CLI).
  - **`iris`**: nuevo tipo en `ClipTransitionSchema` (enum + JSON Schema
    regenerado). Reusa la infraestructura `geq` de los wipe:
    `wipe_alpha_expr("iris", p)` emite una máscara circular que crece
    desde el centro — `dist² < p²·R²` con `R² = (W/2)²+(H/2)²` — y un
    guard `gt(p,0.999)` que abre los cuatro vértices exactos al cerrar el
    lead (a `p=1` su `dist² = R²` y `lt` los dejaría fuera). Export:
    mismo brazo del lead que `wipe-*` en `visual_filter`; preview:
    `transitionFrozen {mode:"wipe",kind:"iris",progress}` →
    `wipe_frozen_filter` con progreso constante. UI: opción «Iris
    circular» en Inspector, preset en `EditorAssets` (17 tarjetas, grupo
    propio «Iris» en el árbol) y label en `Timeline`. Auditoría:
    `visuals.rs` whitelist actualizada.
  - **Fix real**: `wipe-left` y `wipe-up` usaban `gt(X,W*(1-p))` /
    `gt(Y,H*(1-p))`; al llegar a `p=1` la condición queda `gt(X,0)` /
    `gt(Y,0)` y la columna `X=0` / fila `Y=0` permanecía transparente
    durante todo el resto del clip. Pasan a `gte`, simétrico con
    `wipe-right`/`wipe-down` que ya eran correctos (`lt(X,W)` / `lt(Y,H)`
    incluyen todo el frame en `p=1`).
  - **Verificación**: `cargo test --lib transition` → **8/8** (incluye
    `extra_transitions_change_the_filter_chain` con asserts nuevos de
    `geq` radial + iris congelado sin `in`/`N`, y
    `window_freezes_fades_and_transition_leads` con el bloque iris:
    `mode:"wipe"`, `kind:"iris"`, `progress 0.5`) · `commands::visuals`
    dentro del filtro → ok · `tsc --noEmit` desktop **0 errores** ·
    project-schema **373/373** (schema regenerado en sync) · vitest
    `EditorAssets` 9/9, `Timeline` 20/20, `project-actions` 108/108.
    **Smoke real FFmpeg** (build LGPL local): el `geq` del iris parsea y
    corre sin errores; con progreso constante 0,5 sobre 64×36 el alfa
    medido da YAVG=115,3/255 ≈ 45 %, consistente con el círculo de
    radio √337 px (~46 % del frame). El test de render completo
    (`transition_leads_use_the_window_and_match_full`) sigue `ignored`:
    el FFmpeg dev local no trae `libx264`.
  - **Archivos**: `packages/project-schema/src/timeline.ts` + schema
    regenerado, `render/ffmpeg.rs`, `commands/preview_frame.rs`,
    `commands/visuals.rs`, `Inspector.tsx`, `Timeline.tsx`,
    `EditorAssets.tsx` (+test), `docs/KDENLIVE-REFERENCE.md`, esta
    entrada, `memory/2026-11-08-transicion-iris.md`.
  - **Pendiente**: `luma-wipe` sigue fuera de `TRANSITION_PRESETS` y del
    catálogo Rust (sólo Inspector, como antes); el mate animado en
    preview del monitor queda congelado igual que el resto de
    transiciones.

- `[done]` **Localización Studio unificada con los idiomas reales de cada
  backend (2026-11-08)** — cierra el «pendiente honesto» de la pasada de
  idiomas de traducción (2026-11-08): «Localización Studio sigue con su lista
  curada de ocho idiomas; si se quiere una sola lista hay que unificar
  `LOCALIZATION_LANGUAGES` con el backend y revisar doblaje/clonación por
  idioma», en una pasada del protocolo del loop (Devin CLI).
  - **Brecha medida**: `translate_subtitles` aceptaba 12 idiomas pero la UI
    sólo ofrecía 8 (sin `fr`/`de`/`it`/`ja`, que Descargar ya traducía); el
    doblaje SAPI acepta 11 (sin `ja`) y la clonación de voz 16 —de los 12 de
    la lista, todos menos `bn`, que el motor local rechaza— pero la UI
    ofrecía los 8 para todo sin distinguir capacidad.
  - **Cambio** (`features/localization/localization.ts`):
    `LocalizationLanguageCode` y `LOCALIZATION_LANGUAGES` pasan a los 12 del
    backend (fr Français, de Deutsch, it Italiano, ja 日本語). Sets nuevos
    `DUBBING_LANGUAGE_CODES` (11, sin `ja`, espejo de
    `dubbing.rs::normalize_language`) y `CLONE_LANGUAGE_CODES` (11, sin `bn`,
    espejo de `voice_clone.rs::CLONE_LANGUAGES`) con sus arrays filtrados
    `DUBBING_LANGUAGES`/`CLONE_LANGUAGES` y `isDubbingLanguage`.
  - **UI** (`LocalizationView.tsx`): el selector de idioma del doblaje sólo
    lista idiomas traducidos que el doblaje acepta, y avisa «Sin doblaje
    SAPI por ahora: …» cuando hay traducciones en idiomas no doblables (hoy
    sólo `ja`). El selector de clonación usa `CLONE_LANGUAGES` (sin `bn`,
    antes ofrecido y rechazado por el backend) con nota honesta; un efecto
    corrige la selección si el idioma guardado no es clonable. Copy
    «ocho idiomas» → «doce» en el encabezado y en el hint de navegación;
    `App.test.tsx` actualizado.
  - **Verificación**: vitest `features/localization/` +
    `app/navigation.test.ts` **18/18** · `App.test.tsx -t Localización`
    **1/1** · `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0
    errores**. No se tocó Rust: los backends ya aceptaban estos idiomas.
  - **Archivos**: `features/localization/localization.ts` (+test),
    `features/localization/LocalizationView.tsx`, `app/navigation.ts`,
    `App.test.tsx`, `docs/APP-FEATURE-AUDIT.md`, `docs/ROADMAP.md`,
    `docs/TUTORIAL.md`, `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-08-idiomas-localizacion-unificados.md`.
  - **Pendiente honesto**: doblaje de `ja` requiere una voz SAPI/engine que
    el backend no tiene mapeada; `bn` en clonación depende de que el motor
    local (GPT-SoVITS/XTTS) lo soporte — la lista `CLONE_LANGUAGES` de Rust
    admite más idiomas (ko/tr/pl/nl/cs) que la UI no ofrece porque la
    traducción de subtítulos no los cubre.

- `[done]` **Traducción de subtítulos: backend alineado con los idiomas que
  ya ofrece Descargar (2026-11-08)** — en una pasada del protocolo del loop
  (Devin CLI).
  - **Brecha medida**: `DownloadView` ofrece traducir subtítulos a `fr`,
    `de`, `it` y `ja`, pero `translate_subtitles`
    (`commands/providers.rs`) sólo aceptaba ocho códigos y devolvía «el
    idioma de destino no está entre los ocho soportados»; esos destinos
    siempre fallaban con un warning por subtítulo.
  - **Cambio**: `language_name` suma `fr`/`de`/`it`/`ja` con el nombre que va
    al prompt; el error deja de fijar el conteo («no está soportado»). Tests:
    el caso de idiomas ahora recorre los 12 soportados y el rechazo usa `tl`.
  - **Verificación**: `node scripts/rust-env.mjs -- cargo test -p
    editor-ia-desktop --lib providers` → **29/29** · `npx tsc --noEmit -p
    apps/desktop/tsconfig.json` → **0** · `rustfmt --edition 2021 --check
    providers.rs` limpio. `cargo fmt --all -- --check` falla por diffs
    preexistentes ajenos en `background.rs`, `upscale.rs` y `render/motion.rs`
    (no tocados).
  - **Archivos**: `apps/desktop/src-tauri/src/commands/providers.rs`,
    `docs/CAPABILITY-MATRIX.md`, `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-08-idiomas-traduccion-descarga.md`.
  - **Resuelto el mismo día**: Localización Studio quedó unificada con los
    12 idiomas del backend y con filtros por capacidad de doblaje/clonación
    (entrada siguiente de esta cola).

- `[done]` **Reproductor del material compartido en el editor automático
  (2026-11-08)** — cierra el «pendiente honesto» de la pasada del scrub del
  metraje (2026-11-08): «cada variante monta su propia copia del `<video>`
  por fuente (hasta 4×6 en el peor caso); si el coste se nota, la mejora
  es compartir un único reproductor por fuente fuera de las tarjetas», en
  una pasada del protocolo del loop (Devin CLI).
  - **`AutoEditView.tsx`**: `SourceUsageRow` ya no monta `<video>`: la
  barra temporal llama `onPreviewSeek(assetId, segundos)` y debajo queda
  un aviso honesto («El metraje se reproduce una vez por video, en
  «Reproductor del material»»). Nueva sección `Reproductor del material`
  fuera de las tarjetas con **un `<video controls preload="metadata">`
  por fuente que aporta cortes** a alguna variante (`previewSources` =
  unión de `cuts[].assetId` de `finalVariants` ∩ `sources`): hasta 24
  elementos `<video>` en el peor caso → máximo 6. `seekPreviewSource`
  busca el segundo en el reproductor compartido, hace
  `scrollIntoView({block:'nearest'})` (con guarda para jsdom/WebViews
  sin implementar) y reproduce; la política de autoplay sigue cubierta
  por el try/catch. Sin URL reproducible la sección no se monta y las
  filas conservan sus avisos (`assetMissing` / «disponible en la app de
  escritorio»).
  - **CSS** (`styles/app.css`): `.auto-src-player` (grid), `.auto-src-player-item`,
    `.auto-src-player-name`, `.auto-src-shared-hint`.
  - **Test** (`AutoEditView.test.tsx`): el test del preview ahora exige
    **exactamente 1** `.auto-src-video` dentro de `Reproductor del
    material` con 4 mapas montados, **0** `.auto-src-video` dentro de
    `.auto-src-map`, y verifica que el clic al 50 % de la barra de 10 s
    deja `currentTime ≈ 5` y llama a `play()` sobre el reproductor
    compartido.
  - **Verificación**: vitest `features/autoedit/` **43/43** ·
    `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**. No
    se tocó Rust ni el contrato del servicio.
  - **Archivos**: `features/autoedit/AutoEditView.tsx`,
    `features/autoedit/AutoEditView.test.tsx`, `styles/app.css`,
    `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-08-reproductor-material-autoedit.md`.

- `[done]` **Scrub del metraje real en el mapa del material del editor
  automático (2026-11-08)** — cierra el «pendiente honesto» de la pasada del
  preview por material (2026-11-07): «un scrub de preview por corte queda
  como mejora futura si se quiere ver el footage real», en una pasada del
  protocolo del loop (Devin CLI).
  - **UI** (`AutoEditView.tsx`): la fila de cada fuente dentro de «Mapa del
    material por video» pasó a `SourceUsageRow`: la barra temporal es ahora
    un `<button>` que busca el segundo clicado (`clientX` sobre el ancho de
    la pista × duración medida) y reproduce; debajo va un `<video
    controls preload="metadata" playsInline>` con la URL real del asset —
    mismo criterio que el monitor (`proxy.path ?? source.path` vía
    `service.mediaUrl(root, …)`). Sin sesión raíz o con `mediaUrl` vacío
    (modo navegador) la fila avisa «disponible en la app de escritorio»; si
    el asset ya no está en el proyecto, «El medio ya no está en el
    proyecto». Nada simulado: sin archivo reproducible no hay `<video>`.
  - **CSS** (`styles/app.css`): `.auto-src-map-track` como botón (reset,
    hover con acento, `:focus-visible` con outline), `.auto-src-video`
    acotado a 140 px de alto, `.auto-src-no-preview`.
  - **Tests** (`AutoEditView.test.tsx`): el test del mapa se actualizó al
    contrato nuevo (la pista es `button`, no `img`) y hay un test nuevo que
    verifica el `<video>` con `src` del fake, que el clic al 50 % de una
    barra de 10 s deja `currentTime ≈ 5` y que llama a `play()`.
  - **Verificación**: vitest `features/autoedit/` **43/43** (13 en la
    vista: el test del mapa actualizado al nuevo rol + 1 nuevo de preview) ·
    `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**. No se
    tocó Rust ni el contrato del servicio.
  - **Archivos**: `features/autoedit/AutoEditView.tsx`,
    `features/autoedit/AutoEditView.test.tsx`, `styles/app.css`,
    `docs/IMPROVEMENT-QUEUE.md`, `memory/2026-11-08-preview-material-autoedit-scrub.md`.
  - **Pendiente honesto**: ~~cada variante monta su propia copia del
    `<video>` por fuente~~ **resuelto el mismo día**: el reproductor ahora
    es único por fuente, fuera de las tarjetas («Reproductor del
    material», entrada siguiente de esta cola).

- `[done]` **Preview de los cortes sobre el material antes de aplicar
  (2026-11-07)** — cierra el último pendiente del lote «editor automático
  sin LLM» (2026-10-27): «preview antes de aplicar», en una pasada del
  protocolo del loop (Devin CLI). Las tarjetas ya mostraban la película del
  montaje y la lista de cortes, pero no qué tramo de **cada video fuente**
  sobrevivía ni dónde estaban los huecos medidos.
  - **Motor** (`features/autoedit/auto-edit.ts`): `buildSourceUsage(sources,
    variant, indices)` devuelve por fuente `{ kept, holes, keptSeconds,
    durationSeconds }` — `kept` es la unión de los cortes elegidos en
    segundos del video original y `holes` los silencios/negros/congelados
    medidos (merge de rangos solapados, clamps a la duración).
  - **UI** (`AutoEditView.tsx`): cada tarjeta gana un `<details>` «Mapa del
    material por video» con una fila por fuente que aporta cortes — nombre,
    `X s de Y s` conservados y una barra del video original con segmentos
    verdes (entra al montaje) y marcas oscuras para los huecos. Se
    actualiza al destildar cortes y tras reordenar con la IA. Además la
    lista «Ver los cortes» muestra el nombre del video por fila cuando hay
    más de una fuente (antes los tiempos eran ambiguos entre archivos).
  - **CSS** (`styles/app.css`): `.auto-src-*` — barra con segmentos
    posicionados por %, huecos con trama diagonal, leyenda honesta.
  - **Verificación**: vitest `features/autoedit/` **42/42** (+3 tests de
    `buildSourceUsage`: huecos y kept exactos, achique al destildar y fila
    en cero para la fuente sin cortes elegidos; +1 test de UI que abre el
    mapa y verifica pistas, segmentos y huecos del fake) ·
    `tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**. No se
    tocó Rust ni el contrato del servicio.
  - **Archivos**: `features/autoedit/auto-edit.ts`,
    `features/autoedit/auto-edit.test.ts`,
    `features/autoedit/AutoEditView.tsx`,
    `features/autoedit/AutoEditView.test.tsx`,
    `styles/app.css`, `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-07-preview-material-autoedit.md`.
  - **Pendiente honesto**: la vista previa es un mapa temporal (qué tramos
    entran), no una reproducción del video; un scrub de preview por corte
    queda como mejora futura si se quiere ver el footage real.

- `[done]` **Umbrales de escena/silencio configurables en el editor
  automático (2026-11-07)** — cierra «umbrales de escena configurables»
  del pendiente del lote «editor automático sin LLM» (2026-10-27), en una
  pasada del protocolo del loop (Devin CLI). El backend ya aceptaba los
  parámetros (`analyze_media`: `sceneThreshold`, `silenceDb`,
  `minSilenceSeconds`, con clamp y clave de caché que los incluye); sólo
  faltaba exponerlos.
  - **`AutoEditView.tsx`**: tarjeta «Medición · Umbrales del análisis» con
    tres inputs numéricos (escena 0.05–0.9, silencio −60…−10 dB, mínimo
    0.15–3 s, mismos rangos que el backend). `analyze()` los pasa a
    `analyzeMedia` en vez de `undefined` (defaults). Se guarda
    `measuredParams` con los valores usados en la última medición: si los
    umbrales cambian después, `analysisStale` muestra un aviso y
    **bloquea** aplicar, exportar y pedir criterio IA hasta volver a
    analizar (los cortes visibles se midieron con otros valores).
  - **`DirectorView.tsx`**: ya tenía silencio configurable pero la escena
    iba fija en 0.35 — se agregó el input «Umbral de escena (0–1)» al grid
    de tuning y se pasa a `analyzeMedia`. Además los tres umbrales ahora
    invalidan `plan`/`applied` al cambiar (antes sólo lo hacían las
    opciones, no los umbrales).
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · vitest `AutoEditView.test.tsx` **11/11** (+2 tests:
    los umbrales llegan a `analyzeMedia` como `[0.5, -40, 0.8, false]`;
    cambiar un umbral tras analizar muestra el aviso, deshabilita
    «Reemplazar timeline» y se levanta al re-analizar). No se tocó Rust
    ni el contrato del servicio.
  - **Archivos**: `apps/desktop/src/features/autoedit/AutoEditView.tsx`,
    `apps/desktop/src/features/autoedit/AutoEditView.test.tsx`,
    `apps/desktop/src/features/director/DirectorView.tsx`,
    `docs/IMPROVEMENT-QUEUE.md`, `memory/2026-11-07-umbrales-analisis.md`.
  - **Pendiente honesto**: queda del mismo lote «preview antes de
    aplicar» (ver los cortes elegidos sobre el material antes de escribir
    la timeline).

- `[done]` **Exportación en lote de las variantes del editor automático
  (2026-11-07)** — cierra la parte «exportar las tres variantes a MP4
  separados en un solo lote» del pendiente del lote «editor automático
  sin LLM» (2026-10-27), en una pasada del protocolo del loop (Devin CLI).
  - **Motor** (`features/autoedit/auto-edit-export.ts`, nuevo):
    `exportAutoEditVariants` recorre las variantes y por cada una aplica
    `applyAutoEditVariant` con `replace:true` (la variante ES la edición,
    no se toca la timeline abierta), escribe el documento con
    `write_project_variant` — que ya espeja los medios desde la raíz de la
    sesión — y renderiza con `render_project_variant`, que verifica el
    MP4 antes de publicarlo. Respeta la selección de cortes de cada
    tarjeta (`subsetVariant`), el reorden de la IA (`finalVariants`) y
    los títulos; el perfil sale de `chooseExportProfile`. Un fallo en una
    variante no cancela las demás; el proyecto abierto queda intacto
    (el apply clona).
  - **UI** (`AutoEditView.tsx`): tarjeta «Exportar variantes» en la
    columna de receta — carpeta de salida (default `<raíz>\variantes-auto`),
    botón «Exportar N variantes», etapa por variante y lista de resultados
    con ruta del MP4. Mismo copy honesto: no toca la timeline.
  - **Verificación**: vitest `features/autoedit/` **36/36** (5 tests
    nuevos en `auto-edit-export.test.ts`: MP4 por variante con proyecto
    escrito y ruta de salida, timeline intacta, selección vacía = todos
    los cortes como en la UI, fallo de render no frena la cola, progreso
    + resumen) · `tsc --noEmit` desktop **0 errores**. No se corrió un
    render real (los tests usan servicio fake; el camino
    write/render_project_variant ya está verificado en folder-queue).
  - **Archivos**: `features/autoedit/auto-edit-export.ts` (+test),
    `features/autoedit/AutoEditView.tsx`, `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-07-auto-edit-export-lote.md`.
  - **Pendiente honesto**: quedan del mismo lote «preview antes de
    aplicar» y «umbrales de escena configurables», que son ítems
    separados.

- `[done]` **Sub-pestañas de audio «Eliminar Ruido» y «Filtros de voz»
  habilitadas con controles reales (2026-11-07)** — en una pasada del
  protocolo del loop (Devin CLI). Las dos sub-pestañas del inspector de
  clip de audio estaban `pending` (deshabilitadas «por backend») aunque
  todo su backend ya existía y estaba cableado: `denoise` (`afftdn`),
  `gateDb`, voice isolation Demucs, `voiceEffect`, EQ de 3 bandas,
  HP/LP, `AudioEffectStack`, compresor y de-esser. La sección monolítica
  «Audio del clip» ya declaraba `subtab="basic noise voice"` y el CSS de
  Filmora ya tenía reglas para `noise`/`voice`: sólo faltaba repartir.
  - **Cambio** (`Inspector.tsx`): `SUB_TABS.audio` sin `pending` en
    `noise`/`voice` (el `ia` de speed sigue pendiente: no hay backend de
    rampas por IA). La sección se dividió en tres `InspectorSection`
    reales: «Audio del clip» (`basic`: mute, separar audio, ganancia,
    paneo, fades, transcribir, limpiar, automatización de volumen),
    «Reducción de ruido» (`noise`: denoise %, puerta de ruido, bloque de
    voice isolation completo con su botón Demucs, print de `afftdn`) y
    «Filtros de voz» (`voice`: HP/LP, EQ graves/medios/agudos,
    `voiceEffect`, `AudioEffectStack`, compresor/de-esser y presets
    «Voz clara»/«Música», print de filtros FFmpeg). Ningún control se
    perdió ni se simuló: es el mismo JSX repartido por `data-subtab`,
    que es el contrato que la capa Filmora ya usa para mostrar/ocultar.
    En temas sin la capa Filmora todas las secciones siguen montadas
    (la ocultación por sub-pestaña es sólo visual vía CSS).
  - **Test nuevo** (`App.test.tsx`): siembra un clip de audio, lo
    selecciona y verifica que ambas pestañas existen **habilitadas**
    (`role="tab"`, `disabled === false`), que `data-subtab` del
    `.clip-inspector` cambia a `noise`/`voice` al clickear y que las
    secciones `[data-subtab~=…]` contienen sus controles reales.
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0 errores** · `vitest run src/App.test.tsx` → **77/77** (antes
    76 + el nuevo) · `vitest run AudioEffectStack render-cost` →
    **7/7**. No se corrió la suite serial completa ni e2e (cambio
    acotado a una vista con cobertura propia).
  - **Archivos**: `apps/desktop/src/features/editor/Inspector.tsx`,
    `apps/desktop/src/App.test.tsx`,
    `memory/2026-11-07-subtabs-audio-reales.md`.
  - **Pendiente honesto**: «Rampas de IA» (speed) sigue `pending` — no
    existe backend de detección de rampas; las sub-pestañas de color
    HSL/Curvas/Ruedas/HDR ya tienen secciones reales propias.

- `[done]` **Limpieza automática de proxies huérfanos al cerrar/cambiar de
  proyecto (2026-11-07)** — cierra el pendiente de `FOLLOW-UPS.md` §6.1
  («limpieza automática de proxies huérfanos al cerrar proyecto; hoy
  `cleanup_proxies` es manual»), en una pasada del protocolo del loop
  (Devin CLI). Además `cleanupProxies` no tenía ninguna UI que lo llamara.
  - **Backend** (`commands/proxies.rs`): `proxy_asset_id` parsea el id del
    asset desde `proxy-<assetId>-<quality>-<mtime>-<bytes>.mp4` (el assetId
    puede tener guiones: UUID). `cleanup_orphan_proxies(root, project)`
    borra sólo los proxies cuyo asset ya **no existe como `kind:"video"`**
    en el documento — conservador a propósito: un proxy de asset presente
    con huella vieja se conserva (lo regenera `ensure_proxy`; borrarlo
    podría tirar trabajo válido si el origen está inaccesible). Devuelve
    `ProxyCleanupResult { removed, bytes_freed }`.
    `cleanup_session_orphans(state)` es el wrapper best-effort: lee la
    sesión, abre el proyecto del disco y limpia; **nunca devuelve error**
    (el cache no puede tumbar un cierre).
  - **Gancho** (`commands/projects.rs`): `close_project` la invoca antes de
    `set_session(None)`; `adopt` la invoca antes de `set_session` sólo
    cuando la ruta del proyecto que entra difiere de la sesión anterior
    (re-adoptar el mismo proyecto no limpia nada). Son los únicos dos
    puntos donde cambia la sesión nativa.
  - **Límite honesto**: la referencia es el documento **en disco** — si el
    usuario borró un asset en memoria sin guardar, su proxy se conserva
    hasta el próximo guardado+cierre. Los proxies de assets presentes con
    huella desactualizada tampoco se borran acá (quedan como caché
    regenerable; `proxy_status` ya los marca `upToDate:false`).
  - **Verificación**: `cargo test -p editor-ia-desktop --lib proxies`
    **6/6** (3 tests nuevos: parseo del assetId con/sin guiones y nombres
    rotos, limpieza que sólo borra ausentes — asset de video conservado,
    asset borrado y asset-audio eliminados, archivos ajenos intactos,
    `bytes_freed` exacto; carpeta inexistente y proyecto sin assets) ·
    `cargo test --lib commands::projects` **7/7** · `rustfmt --check`
    limpio en ambos archivos. No se tocó TypeScript.
  - **Archivos**: `apps/desktop/src-tauri/src/commands/proxies.rs`,
    `apps/desktop/src-tauri/src/commands/projects.rs`,
    `docs/FOLLOW-UPS.md`, `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-07-proxies-huerfanos-cierre.md`.

- `[done]` **Fix `PreviewTransformBox`: crash sin clip + typecheck verde
  (2026-11-07)** — el `tsc --noEmit` del desktop arrastraba **1 error
  preexistente** desde el lote grande (`PreviewTransformBox.tsx:248`,
  `'clip' is possibly 'undefined'`), documentado como WIP en pasadas
  anteriores y commiteado después en `a7cff32`.
  - **Brecha**: `clip` es opcional en las props (la caja también se usa
    para cues con `transformOverride`/`onApply`/`labelOverride`), pero el
    `aria-label` leía `clip.label` sin guarda → `TypeError` en render.
    Además un clip sin `label` imprimía «Encuadre de undefined».
  - **Fix**: `aria-label` usa `labelOverride ?? clip?.label ?? 'capa'` —
    mismo texto que antes para clips con nombre; fallback honesto para el
    resto.
  - **Test primero**: caso nuevo en `PreviewTransformBox.test.tsx` que
    renderiza la vía cue (sin `clip`, con `labelOverride`/`onApply`) —
    **falló con el TypeError real** antes del fix y pasa después; además
    verifica que el arrastre escribe por `onApply` y no toca el store.
  - **Verificación**: vitest `PreviewTransformBox.test.tsx` **8/8** ·
    `npx tsc --noEmit -p apps/desktop/tsconfig.json` → **0 errores**
    (antes 1). No se corrió la suite serial completa (cambio de una
    línea en un componente con cobertura propia).
  - **Archivos**: `apps/desktop/src/features/editor/PreviewTransformBox.tsx`,
    `apps/desktop/src/features/editor/PreviewTransformBox.test.tsx`,
    `memory/2026-11-07-preview-transform-box-clip-opcional.md`.

- `[done]` **Receta FFmpeg para `light.leak` (2026-11-07)** — el último efecto
  «sólo preview» del catálogo (`docs/DRIFT-PARITY.md` §5) en una pasada del
  protocolo del loop (Devin CLI). Con esto **los 48 efectos de video
  exportan**: no queda ninguno con etiqueta «Sólo preview».
  - **Brecha**: el manifiesto no declaraba `ffmpeg`; las manchas cálidas se
    veían en el preview GPU pero el MP4 salía sin ellas.
  - **Receta** (`packages/effect-kit/src/catalog/video.ts`): `graph` con
    `split=2` — base `format=gbrp` + overlay `format=gbrp,geq` que repite la
    envolvente del shader por píxel: `edge = smoothstep(0.35,1.1,length(p))`
    y `mask = smoothstep(0.35,0.85, blob*0.6 + edge*0.8)` (smoothstep
    cúbico escrito a mano), salida `clip(tint·mask·amount·255,0,255)` y
    `blend=all_mode=screen` que reproduce `1-(1-c)(1-light)`.
  - **Decisión honesta**: `blob = ek_fbm(p·1.6+(t,0.4t),4)` NO se pudo
    portar literal — 4 octavas × 4 hashes `ek_hash21` inlineados superan el
    límite de línea de comandos de Windows (~100 KB estimados). Se aproximó
    con **5 senos incommensurables** de frecuencia/phase crecientes
    (0.30/0.24/0.18/0.12/0.08, la idea de octavas del fbm) renormalizados a
    [0,1]. La cola ya lo anticipaba («aproximar con senos»).
  - **Verificación con FFmpeg real** (n9.0 empaquetado, `testsrc2` 320×180,
    50 frames): diff media por canal en frame 25 — esquina sup-izq **80**,
    sup-der **59**, calidez R−B **+70/+166**, centro **+0,8**; frame 10 vs 40
    en la esquina **11,2** (las manchas se mueven con `T·speed`). Scripts en
    `.tmp-leak/` (ignorado).
  - **Fidelidad honesta**: `approximate` — el blob es un sumando de senos,
    no value-noise fbm (patrón orgánico similar, no idéntico); el eje Y
    puede venir espejado respecto a `v_texCoord`; `format=gbrp` descarta
    alfa; coste alto por píxel (5 senos ×3 canales).
  - **Extra**: `EffectStudio.test.tsx` quedó verde de nuevo — el test
    «muestra el resumen de export del stack» esperaba «Sólo preview» tras
    agregar `light.flare`, aserción stale desde que flare ganó receta
    (2026-11-08); ahora espera «Export aproximado», que es lo que el producto
    muestra. `EffectTemplates.test.tsx` pasó en la re-corrida (su fallo
    anterior era flaky de jsdom/navigation).
  - **Verificación repo**: `npm run effects:codegen` → **78 recetas**;
    vitest effect-kit **48 passed / 3 skipped** (live; +1 test nuevo en
    `catalog.test.ts`, stack test actualizado) · vitest vfx desktop
    **25 passed / 1 failed** (único fallo el conocido y ajeno de
    `EffectTemplates.test.tsx` — importación JSON, flaky de jsdom; pasó en
    la corrida aislada de 2 archivos) · `cargo check -p editor-ia-desktop`
    limpio · Rust `cargo test --lib effect_stack` **11/11** con test nuevo
    `effect_stack_expands_leak_graph_with_filled_params` · `tsc --noEmit`
    desktop reporta **1 error preexistente** del WIP del usuario en
    `PreviewTransformBox.tsx:248` · `tsc` effect-kit reporta los **4 errores
    preexistentes** documentados de `engine.test.ts`.
  - **Archivos**: `packages/effect-kit/src/catalog/video.ts`,
    `packages/effect-kit/src/catalog.test.ts`,
    `apps/desktop/src-tauri/src/render/effect_recipes.rs` (codegen),
    `apps/desktop/src-tauri/src/render/ffmpeg.rs` (test),
    `apps/desktop/src/features/vfx/EffectStudio.test.tsx`,
    `docs/DRIFT-PARITY.md`, `memory/2026-11-07-light-leak-export.md`.
  - **Pendiente honesto**: la fidelidad visual del blob vs `ek_fbm` no está
    medida contra el preview GPU (no hay harness de comparación
    shader↔FFmpeg); si se quiere más parecido habría que generar el noise en
    un paso previo (p.ej. `geq` a 8 bit por octava) o un source sintético.

- `[done]` **Receta FFmpeg para `light.flare` (2026-11-08)** — uno de los 2
  efectos «sólo preview» que quedaban (`docs/DRIFT-PARITY.md` §5) en una
  pasada del protocolo del loop (Devin CLI), mismo patrón `geq`+`blend`
  que las recetas anteriores.
  - **Brecha**: el manifiesto no declaraba `ffmpeg`; los ghosts
    especulares se veían en el preview GPU pero el MP4 salía sin ellos.
  - **Receta** (`packages/effect-kit/src/catalog/video.ts`): `graph` con
    `split=2` — una rama es la base (`format=gbrp`) y la otra genera el
    flare por `geq` píxel a píxel: `core = smoothstep(size,0,d)`,
    `ring = smoothstep(size*1.4,size,|d-size*0.9|)*0.5` y
    `ghost = smoothstep(size*0.6,0,|mirror|)*0.6` (espejo en `1-position`),
    todo por `tint*intensity`, con los smoothstep cúbicos escritos a mano
    (`t*t*(3-2*t)` sobre `clip`). `p=(DX,DY)/H` con
    `DX=X+0.5-position.x*W`, `DY=Y+0.5-position.y*H` (mismo truco que
    `twirl`, porque `aspect=W/H`). El overlay negro se mezcla con la base
    vía `blend=all_mode=screen`, que reproduce el `1-(1-c)(1-light)` del
    shader.
  - **Verificación con FFmpeg real** (n9.0.2 empaquetado): el grafo
    completo corre sobre `testsrc2` 320×180 sin error. YAVG de crops:
    zona del core (x≈230, y≈50) **+48,4** vs el frame sin filtrar;
    ghost (x≈90, y≈130) **+4,6**; esquina **+0,0**. Verificación
    numérica del overlay solo: píxel (230,50) mide RGB **(152,130,96)**
    contra **(153,130,96)** calculado a mano con la fórmula del shader
    (diff ≤1 por redondeo); píxel (10,10) = (0,0,0).
  - **Fidelidad honesta**: `approximate` — el smoothstep es la misma
    cuenta pero escrito a mano en la gramática de `geq`; el eje Y puede
    venir espejado respecto a `v_texCoord` (la posición vertical se
    invierte, clase de efecto idéntica); `format=gbrp` descarta alfa;
    coste alto por píxel en cuadros grandes.
  - **Verificación repo**: `npm run effects:codegen` → 77 recetas;
    vitest effect-kit **47 passed / 3 skipped** (live) · vitest vfx
    desktop **25 passed / 1 failed** (fallo ajeno y previo en
    `EffectTemplates.test.tsx`, importación de JSON — sin relación con el
    catálogo) · `tsc --noEmit` desktop reporta **1 error preexistente**
    del WIP del usuario en `PreviewTransformBox.tsx:248` y effect-kit
    los **4 errores preexistentes** documentados de `engine.test.ts` ·
    Rust `cargo test --lib effect_stack_expands_flare` **bloqueado** por
    `os error 32` (archivo en uso por otro proceso durante el build
    script, ajeno al cambio — mismo bloqueo documentado en pasadas
    anteriores; dos intentos).
  - **Archivos**: `packages/effect-kit/src/catalog/video.ts`,
    `packages/effect-kit/src/catalog.test.ts` (test nuevo + stack test
    `flare`→`leak`), `apps/desktop/src-tauri/src/render/effect_recipes.rs`
    (codegen), `apps/desktop/src-tauri/src/render/ffmpeg.rs` (test,
    **sin commitear** por WIP del usuario en el mismo archivo),
    `docs/DRIFT-PARITY.md`, `memory/2026-11-08-light-flare-export.md`.
  - **Pendiente honesto**: queda 1 efecto preview-only (`light.leak`,
    usa `ek_fbm` de 4 octavas — no hay ruido por píxel en `geq`; habría
    que aproximar con senos o añadir un generador de ruido FFmpeg).

- `[done]` **Monitor de vídeo: fotograma completo, centrado y marco verde (2026-11-07)** —
  pedido con captura: «arregles donde se ve el video tiene que [verse]
  completo bien posicionado». Diagnóstico medido en navegador real: con
  `editoria.preview-fit.v1=fill` el lienzo era **661×372** dentro de un stage
  de **380×373** y quedaba anclado a la izquierda (`left=0`, `right=-281`),
  recortando ~42 % del fotograma siempre del lado derecho; el grid con
  `place-items:center` no centra hijos que desbordan (alineación segura).
  - `features/editor/Preview.tsx`: migración ÚNICA `fill` → `fit`
    (`editoria.preview-fit.crop-fixed.v1`), `readPreviewFill` exportada;
    `oversized` + `left/top:50%` + `translate(-50%,-50%)` para que un
    «Llenar» explícito recorte de forma simétrica; clase `has-selection`.
  - `styles/filmora/filmora-polish.css`: marco verde COMPLETO
    (`box-shadow: inset 0 0 0 1px var(--fm-accent)`, 4 lados dentro del
    lienzo) y `.transform-box`/handles/rotate/size unificados al acento verde
    en vez de `var(--color-accent)` (que podía ser magenta con otro preset).
  - Test nuevo `features/editor/PreviewFit.test.ts` (3 casos).
  - **Verificación**: typecheck 0 · build 0 · tests dirigidos 3/3 + 7/7 +
    20/20 · e2e **23 passed / 1 skipped / 0 failed** ·
    suite serial **2278 passed / 3 skipped / 1 failed** (fallo ajeno y
    previo en `packages/effect-kit/src/catalog.test.ts:194`, twirl `geq`).
    Medición posterior: `fill-legacy` → canvas 380×214 centrado (franjas
    79/80); `fill-explicit` → 661×372 con desborde −141/−141; con clip
    seleccionado la caja de transformación coincide exactamente con el lienzo
    y el marco es `rgb(61,244,186)`. Capturas `.tmp-redesign/preview-*.png`.
  - Nota: «verde» se cubrió también como lectura literal (color del recuadro)
    y como probable typo de «verse» (fotograma completo). Si se buscaba una
    pantalla verde/chroma en el visor, es otra función: el Inspector ya avisa
    que la preview no simula el recorte de croma.

- `[done]` **Receta FFmpeg para `distort.ripple` (2026-11-08)** — uno de los
  4 efectos «sólo preview» del catálogo (`docs/DRIFT-PARITY.md` §5) en una
  pasada del protocolo del loop (Devin CLI).
  - **Brecha**: el manifiesto no declaraba `ffmpeg`; la ondulación radial se
    veía en el preview GPU pero el MP4 salía sin ella.
  - **Receta** (`packages/effect-kit/src/catalog/video.ts`): `graph` con
    `format=gbrp,geq=` y `r/g/b(x,y)` remuestreando en la coordenada que el
    shader calcula: `px=(X+0.5)/W-{center.x}`, `py=(Y+0.5)/H-{center.y}`,
    `d=sqrt(px²+py²)`, `wave=sin(d·{frequency}−T·{speed})·{amplitude}` y
    offset `p/(d+0.000001)·wave` en píxeles (`·W`/`·H`). Misma cuenta que
    `uv = v_texCoord + normalize(p)·wave`; `T` = `u_time`.
  - **Verificación con FFmpeg real** (n9.0.2 empaquetado): grafo compilado
    por `compileInstance` sobre frame 64×64 con punto blanco en (16,32) →
    el punto sale en (17,32): el remuestreo radial movió el material en la
    dirección esperada. Script de verificación en `.tmp-ripple/` (ignorado).
  - **Fidelidad honesta**: `approximate` — `geq` remuestrea con bilineal,
    el mapeo a `v_texCoord` puede diferir medio píxel, el píxel exacto del
    centro no tiene dirección en el shader y el coste es alto en cuadros
    grandes.
  - **Verificación repo**: `npm run effects:codegen` → 75 recetas;
    vitest effect-kit **45/45** (3 live skipped; +1 test nuevo en
    `catalog.test.ts`) · vitest vfx desktop **26/26** · `tsc --noEmit`
    desktop **0** · `tsc` effect-kit reporta los **4 errores preexistentes**
    del WIP del usuario en `engine.test.ts` (sin relación) · Rust
    `cargo test -p editor-ia-desktop --lib effect_stack` **bloqueado** por
    `os error 32` (archivo en uso por otro proceso durante el build script,
    ajeno al cambio).
  - **Archivos**: `packages/effect-kit/src/catalog/video.ts`,
    `packages/effect-kit/src/catalog.test.ts`,
    `apps/desktop/src-tauri/src/render/effect_recipes.rs` (codegen),
    `docs/DRIFT-PARITY.md`, `memory/2026-11-08-distort-ripple-export.md`.
  - **Pendiente honesto**: quedan 3 efectos preview-only (`light.leak`,
    `light.flare`, `distort.twirl`); `distort.twirl` es el próximo candidato
    `geq` (rotación radial con `atan2`/`cos`/`sin` por píxel), los `light.*`
    usan `fbm` y son los más costosos.

- `[done]` **Receta FFmpeg para `stylize.halftone` (2026-11-08)** — cuarto
  de los efectos «sólo preview» del catálogo (`docs/DRIFT-PARITY.md` §5) en
  una pasada del protocolo del loop (Devin CLI), mismo patrón `geq` que
  `glitch.wave`.
  - **Brecha**: el manifiesto no declaraba `ffmpeg`; la trama de puntos se
    veía en el preview GPU pero el MP4 salía sin ella.
  - **Receta** (`packages/effect-kit/src/catalog/video.ts`): `graph` con
    `format=gbrp,geq=` repitiendo la cuenta del shader por píxel — celda
    `fract(px rotado)−0.5` con `px=(X+0.5)/max({scale},1)` (guarda contra
    params sin normalizar), `luma=clip(((0.2126·r+0.7152·g+0.0722·b)/255−0.5)
    ·{contrast}+0.5)`, `radius=(1−luma)·0.62` y `t=clip((radius−len)/0.08,
    0,1)` con salida `t·t·(3−2t)·255` (el smoothstep cúbico del shader,
    incluido el `edge0>edge1` invertido). `cos/sin({angle}·π/180)` quedan
    en la expresión.
  - **Verificación con FFmpeg real** (n9.0.1): la plantilla compilada por
    `applyTemplate` corre sobre `color=gray` 160×120 — lunares blancos
    periódicos cada ~11,3 px en la línea y=60 (trama 8 × √2 = el período
    esperado con ángulo 45°), cobertura ~23 % y mismos runs con y sin la
    guarda `max()`.
  - **Fidelidad honesta**: `approximate` — la cuenta es la misma pero el
    muestreo es por centro de píxel (media celda de desfase posible) y
    `geq` es costoso en cuadros grandes.
  - **Verificación repo**: `npm run effects:codegen` → 74 recetas;
    vitest effect-kit **44/44** (3 live skipped) · vitest vfx desktop
    **26/26** · `tsc --noEmit` desktop **0** · Rust `cargo test --lib
    effect_stack` **8/8** con test nuevo
    `effect_stack_expands_halftone_graph_with_filled_params`.
  - **Archivos**: `packages/effect-kit/src/catalog/video.ts`,
    `apps/desktop/src-tauri/src/render/effect_recipes.rs` (codegen),
    `apps/desktop/src-tauri/src/render/ffmpeg.rs` (test), `docs/DRIFT-PARITY.md`.
  - **Pendiente honesto**: quedan 4 efectos preview-only
    (`light.leak`, `light.flare`, `distort.ripple`, `distort.twirl`); los
    `distort.*` son los más duros (remuestreo radial/vorticial por píxel,
    candidato `geq` pero con `sqrt`/`atan2` por píxel), `light.*` usa fbm
    (muy costoso en `geq`).
  - **Nota**: el test Rust quedó **sin commitear** — `ffmpeg.rs` mezcla
    trabajo concurrente del usuario en el mismo archivo (misma situación
    que las pasadas de `zoom_pulse`, `blur.zoom` y `glitch.wave`). El
    resto sí se commitea.

- `[done]` **Upscale de video ×4 con Real-ESRGAN (2026-11-11)** — el
  upscale era sólo imagen; ahora agranda video completo frame a frame.
  - **Pipeline** (`commands/upscale.rs` → `upscale_video`): probe con
    ffprobe (`MediaMeasure`), decodificación FFmpeg a `rawvideo rgb24`,
    cada frame por el mismo motor por teselas 128×128 del upscale de
    imagen (refactor: `open_esrgan_session` + `upscale_frame_tiled`
    compartidos) y codificación `rawvideo rgba` → `libx264 -crf 16
    -preset medium -pix_fmt yuv420p` + audio original `aac` con
    `-map 1:a:0? -shortest -movflags +faststart`. Helpers del pipeline
    frame-a-frame (`drain_stderr`, `read_full_frame`, `log_tail`)
    pasaron a `pub(crate)` en `background.rs`.
  - **Límites honestos**: entrada ≤1280×720 (~0,9 MP) y ≤1800 frames
    (~75 s a 24 fps) — en CPU ONNX son minutos por segundo de video;
    `max_seconds` opcional recorta la entrada. Salida `<origen>-x4.mp4`
    junto al video (con sufijo -2, -3… si existe), progreso por evento
    `upscale-progress` (`percent`/`frame`/`total`).
  - **UI** (`UpscaleView`): sección «Video ×4» con selector, campo
    «máx. segundos», barra de progreso real y resultado con «Abrir
    carpeta». Mismo `LocalModelGate` (Real-ESRGAN ×4) que la imagen.
  - **Servicio**: `upscaleVideo`/`onUpscaleProgress` + tipos
    `UpscaleVideoResult`/`UpscaleProgress`; fake-service con stub.
  - **Descargador mejorado (misma pasada)**: ya llega a 8K —
    `MAX_HEIGHT = 4320`, selector `bestvideo[height<=4320]+bestaudio`,
    etiqueta «4320p · 8K» y la UI ofrece cada altura que reporta yt-dlp
    (`DownloadView` quality `best` → `max_height` null → 4320).
    Además se agregó `-S "res,fps,vcodec,acodec,ext,proto,hasaud"`
    (`video_format_sort`): a igual resolución y fps gana el códec más
    eficiente — AV1 > VP9 > H.265 > H.264 en el orden interno de yt-dlp —
    así el archivo pesa menos con el mismo píxel y sin re-codificar nada.
    Si se pidió idioma de audio, `lang:<iso>` se inserta tras `vcodec`
    dentro del mismo `-S` (antes era un segundo `-S` que pisaba el
    orden). En `quality="worst"` no se aplica (invertiría el orden).
  - **Verificación**: `cargo check -p editor-ia-desktop` y `--tests`
    limpios · `cargo test downloader` **57/57** (1 live ignorado) ·
    `tsc` desktop **0** · vitest `UpscaleView` **4/4**. No se corrió un
    upscale real de video (requiere el modelo descargado y minutos de
    CPU por segundo de metraje) — queda como prueba manual.

- `[done]` **Editor visual del rig stickman (2026-11-11)** — cierra el
  pendiente «editor visual del rig» de `CAPABILITY-MATRIX.md` §7.8.
  - **Pieza TS** (`features/motion/stickman-rig.ts`): puerto fiel de la
    geometría FK de `commands/stickman.rs` — `STAND_POSE`, `rigForHeight`
    (u = h/360), `solveSkeleton` (15 articulaciones, mismas longitudes y
    offsets), `lerpPose`/`poseAtKeyframes` con el mismo clamp de extremos.
    Nombres snake_case porque así serializa el `Pose` de Rust.
  - **UI** (`StickmanRigEditor.tsx`): preview SVG con los 14 segmentos +
    cabeza (línea sólida = pose interpolada en el frame de scrub, punteada
    = borrador), 11 sliders por hueso en grados (`pelvis_dy` en px),
    captura/carga/borrado de keyframes por frame. Se muestra en
    `StickmanPanel` sólo con la acción `custom`; el render exige ≥1
    keyframe (el backend ya rechazaba `custom` sin keyframes).
  - **Servicio**: `stickmanRender` acepta `action:'custom'` y
    `keyframes: StickmanKeyframeInput[]` (antes el tipo era un stub
    `{frame:number}[]` que hubiera tirado los campos de pose); la tool MCP
    `stickman_render` ahora reenvía los 11 campos de pose (antes los
    descartaba — bug real).
  - **Verificación**: `stickman-rig.test.ts` **6/6** (espeja los asserts
    del motor: muslos abajo, pie bajo rodilla, pelvis_dy traslada toda la
    cadena, interpolación y clamp idénticos a `pose_from_keyframes`); suite
    `state/`+motion **768/768**; `tsc` desktop **0**.
  - **Pendiente honesto**: física de cuerpos rígidos y edición de las 5
    acciones procedurales siguen fuera; el preview SVG no dibuja partículas.

- `[done]` **Receta FFmpeg para `glitch.wave` (2026-11-08)** — tercero de
  los efectos «sólo preview» del catálogo (`docs/DRIFT-PARITY.md` §5) en
  una pasada del protocolo del loop (Devin CLI), mismo patrón que
  `zoom_pulse` y `blur.zoom`.
  - **Brecha**: el manifiesto no declaraba `ffmpeg`; el desplazamiento por
    filas con seno viajero se veía en el preview GPU pero el MP4 salía sin
    él.
  - **Receta** (`packages/effect-kit/src/catalog/video.ts`): `graph` con
    `format=gbrp,geq=r='r(clip(X+sin(Y/H·{frequency}·TAU+T·{speed})·{amplitude}·W,0,W-1),Y)'`
    (ídem `g`/`b`). `geq` evalúa una expresión por píxel y `r/g/b(x,y)`
    remuestrean la entrada en el píxel desplazado — la misma lectura
    `texture(clamp(uv+dx))` del shader. `format=gbrp` evita la resolución
    dual de los planos de croma (el desplazamiento es idéntico por canal).
    `T` es el timestamp en segundos del frame = `u_time` del shader.
  - **Verificación con FFmpeg real**: el grafo corre sobre `testsrc2`
    320×180 a ~90 fps y el grafo compilado (con `{param}` ya sustituidos)
    también. Prueba numérica: barra vertical blanca en x=100 sobre fondo
    negro, `amplitude=0.1 frequency=4 speed=0` → la barra queda en
    x=68..71 en y=11 (desplazamiento −32 px = seno en su pico), x=100 en
    y=0/45/90/135 (nodos de la senoide: 4 ciclos sobre la altura) y x=104..107
    en y=179 — coincide con `sin(y/H·4·TAU)·0.1·W` en todos los muestreos.
  - **Fidelidad honesta**: `approximate` con nota — el remuestreo es
    bilineal de `geq` (como `texture()` del shader) pero el eje Y puede
    venir espejado respecto a `v_texCoord` (la fase vertical se invierte,
    la clase de efecto es la misma) y `geq` es costoso en cuadros grandes.
  - **Verificación repo**: `npm run effects:codegen` → 73 recetas;
    vitest effect-kit **36/36** · vitest vfx desktop **26/26** ·
    `tsc --noEmit` desktop **0** · Rust `cargo test --lib effect_stack`
    **7/7** con test nuevo
    `effect_stack_expands_glitch_wave_graph_with_filled_params`.
  - **Archivos**: `packages/effect-kit/src/catalog/video.ts`,
    `apps/desktop/src-tauri/src/render/effect_recipes.rs` (codegen),
    `apps/desktop/src-tauri/src/render/ffmpeg.rs` (test), `docs/DRIFT-PARITY.md`.
  - **Pendiente honesto**: quedan 5 efectos preview-only
    (`light.leak`, `light.flare`, `stylize.halftone`, `distort.ripple`,
    `distort.twirl`); los `distort.*` son los más duros (geometría no
    afín por píxel); `stylize.halftone` y `light.*` podrían intentarse con
    `geq` (muestreo/máscara aditiva) a coste alto.
  - **Nota**: el test Rust quedó **sin commitear** — `ffmpeg.rs` mezcla
    trabajo concurrente del usuario en el mismo archivo (misma situación
    que las pasadas de `zoom_pulse` y `blur.zoom`). El resto sí se commitea.

- `[done]` **Receta FFmpeg para `blur.zoom` (2026-11-08)** — segundo de los
  efectos «sólo preview» del catálogo (`docs/DRIFT-PARITY.md` §5) en una
  pasada del protocolo del loop (Devin CLI), mismo patrón que `zoom_pulse`.
  - **Brecha**: el manifiesto no declaraba `ffmpeg` (7 efectos sin receta);
    el desenfoque radial se veía en el preview GPU pero el MP4 salía sin él.
  - **Receta** (`packages/effect-kit/src/catalog/video.ts`): `graph` con
    `split=12` — 6 bases + 6 copias. Cada toma `t∈{0,…,1}` escala por
    `1/(1-{amount}·t)` (`scale` con guarda `max(…,0.05)` para `amount=1`)
    y se monta sobre la base con `overlay x='{center.x}*(W-w)'` (mismo
    ancla deducida que `zoom_pulse`); los 6 frames WxH se promedian par a
    par con `blend=all_mode=average`. Reproduce el promedio del shader
    `ek_sample(center + dir·(1-amount·t))` con 6 tomas fijas.
  - **Verificación con FFmpeg real** (n9.0): el grafo corre sobre
    `testsrc2` 320×180 y produce 50 frames a 25 fps sin error. Diff medio
    entrada/salida (`blend=difference`+`signalstats`): **YAVG 4,38** en el
    centro vs **78,65** (esquina sup-izq) y **54,75** (inf-der) — el centro
    queda nítido y el blur crece hacia los bordes, la semántica del efecto.
  - **Fidelidad honesta**: `approximate` con nota — el export usa 6 tomas
    fijas (el parámetro `samples` sólo aplica al preview) y el remuestreo
    es el de `scale`, no el de `ek_sample`. Coste: 12 vías + 6 scale +
    6 overlay + 5 blend por frame.
  - **Verificación repo**: `npm run effects:codegen` → 72 recetas;
    vitest effect-kit **36/36** · vitest vfx desktop **26/26** ·
    `tsc --noEmit` desktop **0** · `tsc` effect-kit reporta los **4 errores
    preexistentes** del WIP del usuario en `engine.test.ts` (sin relación)
    · Rust `cargo test --lib effect_stack` **6/6** con test nuevo
    `effect_stack_expands_blur_zoom_graph_with_filled_params`.
  - **Archivos**: `packages/effect-kit/src/catalog/video.ts`,
    `apps/desktop/src-tauri/src/render/effect_recipes.rs` (codegen),
    `apps/desktop/src-tauri/src/render/ffmpeg.rs` (test), `docs/DRIFT-PARITY.md`.
  - **Pendiente honesto**: quedan 6 efectos preview-only
    (`light.leak`, `light.flare`, `stylize.halftone`, `glitch.wave`,
    `distort.ripple`, `distort.twirl`); `glitch.wave` es candidato para
    `geq` con desplazamiento por fila, los `distort.*` son los más duros.
  - **Nota**: el test Rust quedó **sin commitear** — `ffmpeg.rs` mezcla
    ~1200 líneas de trabajo concurrente del usuario en el mismo archivo;
    commitear el archivo arrastraría ese WIP (misma situación que la pasada
    de `zoom_pulse`). El resto sí se commiteó.

- `[done]` **Receta FFmpeg para `impact.zoom_pulse` (2026-11-08)** — uno de
  los 8 efectos «sólo preview» del catálogo (`docs/DRIFT-PARITY.md` §5), en
  una pasada del protocolo del loop (Devin CLI).
  - **Brecha**: el manifiesto no declaraba `ffmpeg`, así que el efecto se
    veía en el preview GPU pero el MP4 salía sin él (el panel lo marcaba
    «Sólo preview»).
  - **Receta** (`packages/effect-kit/src/catalog/video.ts`): `graph` con
    `split` + `scale eval=frame` + `overlay`. La rama ampliada escala por
    `1+{amount}*exp(-6*(t*{rate}-floor(t*{rate})))` — la misma curva
    `exp(-phase*6)*amount` del shader GLSL (`fract` → `t*rate-floor(t*rate)`)
    — y el `overlay` la centra sobre el frame original con
    `x='{center.x}*(W-w)'`, `y='{center.y}*(H-h)'`, que reproduce el ancla
    en `p_center` del shader (deducido: el offset es `c·(W−w)`).
    `eval=frame` en ambos filtros (el `t` es el timestamp local del clip,
    igual que `u_time` del shader) y `format=auto` para no perder alfa.
  - **Verificación con FFmpeg real** (binario empaquetado n9.0): el grafo
    corre y `showinfo` mide la escala exacta — frame 0 → 416×312 (zoom 1,3
    en el pico del punch) y frame 1 → 384×288 (decaimiento `exp(-6·phase)`),
    coincidiendo con la fórmula. PNGs de control en el scratch de la sesión.
  - **Fidelidad honesta**: `approximate` con nota — el remuestreo es el del
    `scale` (lanczos por defecto), no el bilineal del shader; con keyframes
    el `t` vuelve a cero por tramo (el render segmenta, comportamiento ya
    documentado del pipeline).
  - **Verificación repo**: `npm run effects:codegen` regeneró
    `effect_recipes.rs` (71 recetas); vitest effect-kit **36/36**
    (3 live skipped) · `tsc` effect-kit reporta los **4 errores
    preexistentes** del WIP del usuario en `engine.test.ts` (sin relación)
    · Rust `cargo test --lib effect_stack` **5/5** con test nuevo
    `effect_stack_expands_zoom_pulse_graph_with_filled_params`.
  - **Archivos**: `packages/effect-kit/src/catalog/video.ts`,
    `apps/desktop/src-tauri/src/render/effect_recipes.rs` (codegen),
    `apps/desktop/src-tauri/src/render/ffmpeg.rs` (test), `docs/DRIFT-PARITY.md`.
  - **Pendiente honesto**: quedan 7 efectos preview-only
    (`light.leak`, `light.flare`, `blur.zoom`, `stylize.halftone`,
    `glitch.wave`, `distort.ripple`, `distort.twirl`); la misma técnica
    `scale eval=frame`+`overlay` aplica a futuros zoom/pulse.
  - **Nota**: el test Rust quedó **sin commitear** — `ffmpeg.rs` mezcla
    ~1200 líneas de trabajo concurrente del usuario en el mismo archivo;
    commitear el archivo arrastraría ese WIP. El resto de la pasada sí se
    commiteó (catálogo, recetas generadas, docs, memoria).

- `[done]` **Scopes de audio en vivo del bus master en el monitor
  (2026-11-08)** — cierra el «siguiente: scopes del audio ya mezclado en
  preview del monitor (bus master Web Audio)» del port Kdenlive
  (`docs/KDENLIVE-REFERENCE.md` §1), en una pasada del protocolo del loop
  (Devin CLI).
  - **Backend TS** (`features/mixer/usePreviewAudio.ts`): el `MasterChain`
    gana `freqBuffer`/`timeBuffer` (Float32) y la función nueva
    `readPreviewAudioMasterScope()` lee el `AnalyserNode` master con
    `getFloatFrequencyData`/`getFloatTimeDomainData`. Devuelve `null` si no
    hay grafo o el analizador no expone lectura float; los buffers son
    internos y se reescriben por llamada (documentado).
  - **UI** (`features/editor/PreviewAudioScopes.tsx`, nuevo): panel overlay
    `.scopes-panel--audio` (izquierda del monitor, no pisa el de color)
    con oscilograma min/max arriba y espectro dBFS abajo, muestreado por
    rAF mientras está abierto; el analizador retiene el último bloque en
    pausa. Pie honesto: mide el bus Web Audio (pistas, EQ, fader, paneo,
    master) y **no** incluye los efectos por clip ni la cadena de export.
    Botón «Audio» en la toolbar del monitor (`Preview.tsx`).
  - **Degradación**: sin `AudioContext` el panel muestra el aviso del
    entorno (misma redacción que `LiveMeters`) y el canvas queda con el
    fondo; el cierre funciona siempre.
  - **Verificación**: vitest `PreviewAudioScopes.test.tsx` **3/3** (panel
    honesto sin Web Audio + cierre; con AudioContext falso: lectura del
    scope 512 bins/1024 muestras a 48 kHz, dibujo y «Señal en vivo»;
    `null` sin grafo) + `LiveMeters.test.tsx` **14/14** (sin regresión en
    el grafo) + `ScopesPanel.test.tsx` **1/1** · `tsc --noEmit` desktop
    **0 errores**. No se corrió la suite serial completa.
  - **Archivos**: `features/mixer/usePreviewAudio.ts`,
    `features/editor/PreviewAudioScopes.tsx` (+test),
    `features/editor/Preview.tsx`, `styles/scopes.css`,
    `docs/KDENLIVE-REFERENCE.md`, `docs/CAPABILITY-MATRIX.md` §3.
  - **Límite honesto**: espectro de 512 bins lineal en frecuencia (no
    logarítmico) y oscilograma de una sola línea de mezcla (no por
    canal); la mezcla por canal no existe en el bus master.

- `[done]` **Thumbnails del catálogo de efectos y visuales (2026-11-08)** —
  la mitad «miniaturas de efectos/transiciones» del `[next]` del cotejo
  36/36, en una pasada del protocolo del loop (Devin CLI).
  - **Brecha medida**: `EffectBrowser` pide
    `/thumbnails/effects/<manifest.id>.svg` para los ~100 manifiestos del
    registro (48 video + 22 transiciones + 30 audio) pero sólo existían 15
    SVG del catálogo viejo de presets — ~85 tarjetas renderizaban `<img>`
    roto. `VisualsView` pedía 8 presets y 7 transiciones con ids que no
    tenían archivo (`soft`, `fade-black`, `slide-up`… vs los nombres viejos
    `cinematic`, `fade`, `wipe-up`).
  - **Generador nuevo** `packages/effect-kit/scripts/generate-thumbnails.ts`
    (`npm run thumbnails:effects`): un SVG determinista por manifiesto —
    tinte por categoría + hash del id, motivo por naturaleza (ondas para
    audio, motivo por categoría para video, dos mitades para transiciones).
    100 archivos emitidos. Son previews **representativos**, no renders del
    shader: la fidelidad real sigue siendo el preview GPU del estudio.
  - **`apps/desktop/scripts/generate-thumbnails.js`**: listas PRESETS y
    TRANSITIONS actualizadas a los ids reales del catálogo visual
    (`commands/visuals.rs` + fallback `visuals.ts`); regenerados los SVG
    que faltaban.
  - **Robustez**: `ThumbnailCard` gana `onError` → cae al placeholder con
    icono en vez de imagen rota si un SVG falta a futuro.
  - **Puerta de cobertura**: `effect-thumbnails.test.ts` (3 tests) exige
    que todo manifiesto/preset/transición del catálogo tenga su archivo —
    si el catálogo crece sin regenerar, el test falla. `import.meta.url`
    no es fiable en vitest (vite lo reescribe), así que el test ubica
    `public/` subiendo desde `process.cwd()`.
  - **Verificación**: vitest `effect-thumbnails` **3/3** · vfx+visuals+
    components **98/99** (el fallo de `EffectTemplates` «importa JSON
    corrupto» es flaky de FileReader en jsdom: pasó 4/4 aislado y no toca
    archivos de esta pasada) · `tsc --noEmit` desktop **0** ·
    `tsc` effect-kit reporta 4 errores **preexistentes del WIP del usuario**
    en `engine.test.ts` (keyframes Bézier, sin relación).
  - **Límite honesto**: los SVG son ilustrativos por categoría, no el
    resultado real del efecto; thumbnails renderizados por shader quedan
    como mejora futura. Los 15 SVG viejos de presets quedaron en disco
    (sin referencias actuales, no se borraron).
  - **Archivos**: `packages/effect-kit/scripts/generate-thumbnails.ts`,
    `apps/desktop/scripts/generate-thumbnails.js`, `package.json`,
    `components/ThumbnailBrowser.tsx`, `features/vfx/effect-thumbnails.test.ts`,
    `public/thumbnails/{effects,presets,transitions}/`.

- `[done]` **Auditoría de pendientes stale (2026-11-08)** — pasada del
  protocolo del loop (Devin CLI): la cola se usa como fuente de verdad del
  trabajo pendiente, así que los `[pending]` que lotes posteriores ya
  habían cerrado sin actualizar la marca se verificaron uno por uno contra
  el código y se corrigieron. Sin cambios de código.
  - **«Disparador por carpeta» → `[done]`**: el hueco declarado («falta un
    escritor/render sin sesión») está cubierto por `write_project_file` +
    `render_project_variant` (`commands/variants.rs`, sin `require_session`)
    y `state/folder-queue.ts` + `FolderQueuePanel`. Evidencia ejecutada:
    `npx vitest run src/state/folder-queue.test.ts` → **4/4**.
  - **«Keyframes de efecto en export» → resuelto**: video
    (`apply_effect_stack_animated`) y audio (`audio_stack_segment_plan`,
    `atrim`+`concat`) ya segmentan por keyframes con Bézier; la UI de
    keyframes existe en ambos stacks.
  - **«Efectos de audio (30 en Drift)»**: ya estaban (§4.5 de
    DRIFT-PARITY); el `[pending]` quedó acotado al importador de paquetes
    de terceros, que sigue siendo trabajo real.
  - **«Compresión por GPU…» → `[verified]`**: todos sus sub-ítems estaban
    tachados o verificados; la sonda AV1/VP9 y la UI WebM ya existen.
  - **`CAPABILITY-MATRIX.md` §2**: filas de stickman y partículas figuraban
    ❌ aunque la sección 7 los declara HECHO — corregidas a ✅ con
    evidencia (`commands/stickman.rs`, `StickmanPanel`, partículas con
    física). `KDENLIVE-REFERENCE.md`: la cola de ports de scopes de audio
    ya no lista el playhead como pendiente (sólo queda el scope en preview
    del monitor).
  - **Verificación**: `npx tsc --noEmit -p apps/desktop/tsconfig.json` →
    **0**; vitest `folder-queue.test.ts` **4/4**. No se tocó código.
  - **Nota**: no se commiteó — el árbol mezcla trabajo concurrente de otra
    sesión en los mismos archivos (`IMPROVEMENT-QUEUE.md` creció durante
    la pasada).
  - **Pendientes reales que quedan** (todos grandes o bloqueados):
    importador de paquetes de efectos, Preview Web Audio de la cadena de
    audio, editor visual del rig stickman, transiciones OBS en vivo,
    titler con formas, scopes de color/audio en vivo sobre el monitor,
    diarización con modelo local, firma OV/EV y ola CapCut P1 (gateada a
    pedido del usuario).

- `[done]` **Scopes de color en vivo — verificado ya implementado
  (2026-11-08)**: `ScopesPanel` en `Preview.tsx` samplea el medio real del
  monitor (`video`/`img` del stage) por canvas cada ~180 ms con
  `computeScopes` (onda/vectores/histograma/parade) **durante playback y
  scrubbing**, y sube a FilmCraft (`analyze_scopes_frame`) cuando hay
  `realFrame.path`. Ítem de cola stale, como emojis y sonda AV1/VP9.

- `[done]` **Formas pentágono/hexágono/flecha del titler (2026-11-08)** —
  completa el set a **8 formas**: `shape` suma `'pentagon'|'hexagon'|
  'arrow'`; pentágono/hexágono = polígono regular inscripto (5/6 lados,
  primer vértice arriba); flecha = polígono custom de 7 puntos
  normalizados (punta arriba). `MotionPreview` gana
  `regularPolygonClipPath(sides)` y `arrowClipPath()` con los mismos
  vértices que Rust. Opciones en el selector Forma de la insignia.
  **Verificación**: vitest motion **10/10** · Rust `render::motion`
  **7/7** (+asserts 5/6/7 ` l ` y punta de flecha) · `tsc` 0 errores.
  El test de rechazo usa ahora `"circle"` (los shapes válidos van
  creciendo — mantenerlo siempre inválido).

- `[done]` **Forma estrella del titler (2026-11-08)** — quinta forma del
  set, misma mecánica: `shape:'star'` en `MotionRectLayer`, opción
  «Estrella» en el selector Forma de la insignia, `starClipPath()` en
  `MotionPreview` (10 puntos alternando radio externo/interno sobre la
  elipse inscripta, mismos vértices que Rust) y rama `"star"` en
  `polygon_drawing`/`validate_plan`. **Verificación**: vitest motion
  **10/10** (+estrella en el test de formas) · Rust `render::motion`
  **7/7** (+asserts: 10 ` l ` + primer vértice `m 480.0 0.0`; el test de
  rechazo migró a `"pentagon"`) · `tsc` 0 errores.

- `[done]` **Formas extra del titler: triángulo y rombo (2026-11-08)** —
  continuación del ítem anterior, misma pasada de Devin CLI.
  - `MotionRectLayer.shape` suma `'triangle'|'diamond'`; `badgeSchema`
    gana campo `shape` (select Elipse/Triángulo/Rombo, default elipse) y
    `buildLayers` lo pasa a `rect()`.
  - `MotionPreview`: triángulo/rombo vía `clip-path: polygon(...)` con los
    **mismos vértices** que el ASS — preview y export coinciden.
  - `render/motion.rs`: `polygon_drawing(shape,w,h)` generaliza el
    polígono (elipse=32 lados paramétricos, triángulo=3, rombo=4);
    `validate_plan` acepta las 4 formas y rechaza el resto.
  - **Verificación**: vitest motion **22/22** en los 3 archivos tocados
    (+test: shape por props, default elipse) · Rust `render::motion`
    **7/7** (+test: triángulo `m 480 0 l 960 162 l 0 162` y rombo
    `m 480 0 l 960 81 l 480 162 l 0 81`, `shape:"star"` → error) ·
    `tsc` 0 errores.

- `[done]` **Formas en el titler: elipse + plantilla Insignia (2026-11-08)** —
  avanza el «Titler: formas y plantillas» del port Kdenlive
  (`docs/KDENLIVE-REFERENCE.md` §5), en una pasada de Devin CLI.
  - **Capa** (`features/motion/templates.ts`): `MotionRectLayer.shape`
    opcional `'rect'|'ellipse'` (default rect → documentos y planes
    existentes intactos); helper `rect()` con parámetro de forma.
  - **Plantilla nueva** `badgeTemplate` («Insignia elíptica», categoría
    dato): elipse centrada + texto centrado, campos texto/fondo/color de
    texto/animación, registrada al final de `MOTION_TEMPLATES` (las
    originales primero, invariante del test pro).
  - **Preview** (`MotionPreview.tsx`): `shape==='ellipse'` →
    `border-radius:50%` y `data-shape` para tests/estilos.
  - **Export** (`render/motion.rs`): `validate_plan` acepta `shape`
    `rect|ellipse` y rechaza otras; el ASS dibuja la elipse como polígono
    de **32 lados** inscripto (`\p1`, mismo espacio de coordenadas que el
    rect) — ASS no tiene curvas, la aproximación es la vía estándar.
  - **Verificación**: vitest `features/motion/` **44/44** (+2 tests:
    plan de la insignia con `shape:'ellipse'` y bounds; props inválidas
    rechazadas) · Rust `render::motion` **6/6** (+2: polígono con 32 ` l `
    + moveto, `shape` desconocida → error «forma inválida») · `tsc`
    **0 errores**.
  - **Pendiente honesto**: la elipse se aproxima con polígono (en 1080p la
    faceta es sub-píxel a tamaños típicos, pero no es curva real); faltan
    triángulo/estrella/custom y un editor visual de titler.

- `[done]` **Transición `dip-color` con color elegible (2026-11-08)** —
  primer tipo de transición con geometría/color del port Kdenlive
  (`docs/KDENLIVE-REFERENCE.md` §4), en una pasada de Devin CLI.
  - **Schema** (`project-schema/timeline.ts`): `ClipTransitionSchema`
    suma `'dip-color'` al enum y `color` hex opcional (`#rgb`/`#rrggbb`),
    **obligatorio para dip-color** vía `superRefine` — documentos viejos
    intactos, JSON Schema regenerado (372/372 tests).
  - **Export** (`render/ffmpeg.rs`): el clip entrante aplica
    `fade=t=in:color=0xRRGGBB` (helper `hex_color`, default negro si falta);
    el clip saliente congelado gana el modo `"color"` — curvas afines por
    canal `out = in·α + (1−α)·c` con `hex_rgb01`, misma ley que el blanco
    pero con intercepto por canal, preservando el alfa de máscaras.
  - **Preview** (`commands/preview_frame.rs`): `freezable_transition`
    acepta `dip-color` y emite `transitionFrozen {mode:"color", color,
    alpha}` para que el frame congelado del saliente coincida con el
    render.
  - **UI/acciones**: opción «Fundido a color» en Inspector con `<input
    type="color">` (default `#1b2a4a`, preservado al cambiar tipo/duración
    vía spread — antes se perdía); preset en `EditorAssets`;
    `applyTransitionToCuts({color})` normaliza a minúsculas y **salta el
    corte si dip-color no trae color válido** (el schema lo exige).
  - **Verificación**: Rust `extra_transitions_change_the_filter_chain` +
    asserts dip-color/fallback (8/8 transition tests; el test de preview
    `window_freezes_fades_and_transition_leads` cubre mode/color/alpha) ·
    vitest `project-actions` **108/108** (+test color válido→`#2244aa`,
    inválido→`applied:0` proyecto intacto) y `EditorAssets` **9/9** ·
    `tsc --noEmit` desktop **0 errores** (los 4 errores
    `exactOptionalPropertyTypes` que la nota anterior reportaba eran de
    este trabajo en curso y quedaron resueltos: `color?: string | undefined`
    en las opciones y `ClipTransition` directo en Inspector).
  - **Indicador en timeline** (misma pasada): `ClipBlockView` dibuja una
    marca `.clip-transition` al inicio del clip con el ancho de la
    transición; para `dip-color` usa el `color` real del documento y el
    resto un tinte del accent. `TRANSITION_LABELS` da el `aria-label`/
    `title` legible. Test en `Timeline.test.tsx` (20/20): verifica la
    clase, `backgroundColor` `#2244aa`→`rgb(34,68,170)` y la etiqueta.
  - **Pendiente honesto**: slide 3D y luma wipe con clip mate siguen en cola.

- `[done]` **Transiciones wipe direccionales (2026-11-08)** — port del wipe
  de Kdenlive: el clip entrante se revela por un borde que barre el cuadro
  y el saliente queda intacto debajo (a diferencia del slide, que mueve
  la capa entera).
  - **Schema**: `wipe-left|right|up|down` en `ClipTransitionSchema`
    (enum, sin campos extra); JSON Schema regenerado.
  - **Export** (`render/ffmpeg.rs`): `wipe_transition_filter` emite
    `geq=r=…:g=…:b=…:a='if(<cond>,alpha(X,Y),0)'` con progreso
    `p = if(lt(N,lead_frames),N/lead_frames,1)` — `N` es el frame del
    stream local (0 = inicio del solape). Dirección = hacia dónde viaja
    el borde (wipe-left revela desde la derecha, igual que slide-left
    entra desde la derecha). Helpers compartidos `wipe_alpha_expr` /
    `wipe_geq` / `wipe_frozen_filter`.
  - **Preview** (`commands/preview_frame.rs`): `freezable_transition`
    acepta los 4 tipos y emite `transitionFrozen {mode:"wipe",kind,
    progress}`; el bloque `transitionFrozen` de `ffmpeg.rs` aplica
    `wipe_frozen_filter` con `p` constante antes del chequeo de alfa.
  - **UI**: 4 opciones en Inspector («Barrido hacia …»), pestaña
    «Barrido» nueva en la biblioteca de transiciones y 4 presets;
    `transitionMatchesPreset` filtra por `wipe-`. `applyTransitionToCuts`
    funciona sin cambios (wipe no exige color).
  - **Verificación con FFmpeg real**: `geq` sobre clip sintético —
    alpha_avg por frame 0 → 99.6 → 227 (barrio del 0% al 90% visible),
    confirma que `N`/`W`/`H`/`alpha(X,Y)` se comportan como se asumió.
  - **Tests**: Rust `extra_transitions_change_the_filter_chain` con
    asserts por dirección (`gt(X,W*(1-(`, `lt(X,W*(`, `gt(Y,H*(1-(`,
    `lt(Y,H*(`); `cargo test transition` **8/8** ok · vitest
    `EditorAssets` conteo 8→**12** tarjetas.
  - **Límite honesto**: `geq` evalúa por píxel en CPU — una transición
    wipe sobre clips largos encarece el render de ese clip completo
    (el filtro queda en la cadena, no sólo durante el lead). Kdenlive
    lo hace en GPU/MLT. Además `N` asume fps constante del stream;
    con `setpts`/`fps` previos el progreso puede derivar levemente.

- `[done]` **UI de keyframes en el audioStack (2026-11-08)** — cierra el
  «Resta: UI para keyframes/curva en el audioStack» del port Kdenlive
  (`docs/KDENLIVE-REFERENCE.md` §2), en una pasada del protocolo del loop
  (Devin CLI).
  - **Diagnóstico**: toda la infraestructura ya existía — `EffectStackPanel`
    muestra el botón ◆ y el auto-key del slider cuando recibe
    `keyframeFrame`, y el export ya segmenta `audioStack` por keyframes
    (`atrim`/`concat`, verificado con FFmpeg real). Lo único que faltaba era
    pasar el frame: `AudioEffectStack` no exponía la prop y `Inspector` no
    la enviaba, así que la cadena de audio sólo se podía animar por datos
    (proyecto/MCP/plantillas).
  - **Cambio**: `AudioEffectStack` acepta `keyframeFrame?: number` y lo
    reenvía a `EffectStackPanel`; `Inspector` le pasa el `localFrame` que ya
    calculaba para máscaras/transform/gain (playhead − `startFrame`, acotado
    a `durationFrames − 1`, misma convención que `EffectStudio` de video).
    Copy honesto: «Las claves ◆ animan los parámetros sólo en el export» —
    la preview de audio sigue reproduciendo el original.
  - **Sin curva Bézier en UI**: el ◆ crea claves con interpolación lineal,
    igual que en el stack de video (el editor de curva no existe en ninguna
    de las dos superficies; `bezier` sigue disponible por datos/MCP).
  - **Archivos**: `features/editor/AudioEffectStack.tsx` (+test),
    `features/editor/Inspector.tsx` (1 prop), `docs/KDENLIVE-REFERENCE.md`.
  - **Verificación**: vitest `AudioEffectStack.test.tsx` **6/6** (2 tests
    nuevos: sin `keyframeFrame` no hay ◆; con frame 30 el ◆ crea la pista
    `[0,30]`, el slider escribe la clave del frame y el × limpia la pista).
    `tsc --noEmit` desktop reporta **4 errores preexistentes ajenos** en
    `EditorAssets.tsx:960,987` e `Inspector.tsx:2172,2218` — el trabajo no
    confirmado de otra sesión sobre transiciones `dip-color`/`color`
    (`exactOptionalPropertyTypes`); ninguno en los archivos tocados.
  - **Nota**: no se commiteó — el árbol mezcla trabajo concurrente de otra
    sesión (transiciones con color, `audio_scopes`, `vpn`, effect-kit, etc.)
    en los mismos archivos.

- `[done]` **Scopes de audio bajo el playhead (2026-11-08)** — mitad del
  «Pendiente: scopes del clip bajo playhead y en preview del monitor» del
  port Kdenlive, en una pasada del protocolo del loop (Devin CLI).
  - **Backend** (`commands/audio_scopes.rs`): `audio_scope_analyze` y
    `audio_scope_analyze_asset` aceptan `startSeconds`/`durationSeconds`
    opcionales; `decode_pcm` agrega `-ss` antes de `-i` y `-t` de salida.
    `normalize_scope_range` (puro, 3 tests): van juntos, start finito ≥ 0,
    duración finita > 0 acotada a `MAX_ANALYZE_SECONDS` (90 s).
  - **Mapeo timeline→fuente** (`state/playhead-audio-scope.ts`, nuevo):
    `audioScopeCandidatesAtPlayhead` devuelve los clips video/audio con
    fuente asset bajo el playhead ordenados de arriba hacia abajo (mayor
    `order` de pista). El segundo del asset es
    `inFrame + local·speed / fps` — el mismo de `Preview.tsx` — y con
    `speedCurve` usa `curveSourceFraction` (el mapeo de `buildSpeedKnots`
    del renderer); `reverse` recorre la ventana al revés. La ventana es
    ±2,5 s alrededor del playhead, acotada a la duración medida del asset.
  - **UI** (`AudioScopesPanel`): selector «Material completo» /
    «Ventana del playhead»; en modo playhead, si hay clips solapados, un
    segundo selector elige cuál. Aviso honesto: mide el audio FUENTE, no
    aplica mutes/fades/ganancia/efectos del clip. Sin clip bajo el playhead
    el botón queda deshabilitado con la explicación.
  - **Servicio**: `AudioScopeRange` + parámetros opcionales en
    `audioScopeAnalyze`/`audioScopeAnalyzeAsset` (los stubs `unavailable`
    y el fake-service no necesitaron cambios: firma compatible).
  - **Límite honesto**: sigue pendiente el scope «en preview del monitor»
    (audio ya mezclado por Web Audio, no el material fuente).
  - **Verificación**: cargo lib `audio_scopes` **8/8** (3 tests nuevos de
    rango) · vitest `playhead-audio-scope.test.ts` **7/7** +
    `AudioScopesPanel.test.tsx` **5/5** · mixer completo **37/37** ·
    `tsc --noEmit` desktop **0**. `cargo fmt` aplicado sólo a
    `audio_scopes.rs` (quedan diffs de formato preexistentes en `audio.rs`,
    trabajo ajeno sin commitear).
  - **Archivos**: `src-tauri/src/commands/audio_scopes.rs`,
    `services/project-service.ts`, `state/playhead-audio-scope.ts` (+test),
    `features/mixer/AudioScopesPanel.tsx` (+test).
  - **Nota**: no se commiteó — el árbol mezcla trabajo concurrente de otra
    sesión en los mismos archivos (`project-service.ts`, `audio.rs`, etc.).

- `[done]` **Suite: timeouts reales para chunks lazy de hubs y modos
  (2026-11-07)** — misma clase de flake que la entrada anterior, en una
  pasada del protocolo del loop (Devin CLI).
  - **Causa**: `App.test.tsx` fallaba con 5 tests en la corrida completa
    (76 tests) y pasaba cada uno aislado. Vistas lazy
    (`YouTubeAnalyzerView`, `MediaLabView`, `CreatorHubView`,
    `MixerView`, `DenoiseView`, `EditorWorkspace`) superan el timeout
    default de 1 s de `findBy*`/`waitFor` bajo carga; el DOM volcado
    mostraba `.view-loading` persistente. No era un fallo de producto.
  - **Fix**: 6 esperas en `App.test.tsx` subidas a `{ timeout: 5000 }`
    (mismo criterio que `createProject` y que el fix anterior de
    Descargar).
  - **Verificación**: `npx vitest run src/App.test.tsx` **76/76** (antes
    5 failed). `npx tsc --noEmit -p apps/desktop/tsconfig.json` reporta 1
    error ajeno en `VpnCard.test.tsx` (trabajo VPN no confirmado del
    usuario, no tocado).

- `[done]` **Suite: espera real para el chunk lazy de Descargar (2026-11-07)** —
  regresión de test detectada en una pasada del protocolo del loop (Devin CLI).
  - **Causa**: con proyecto abierto, `nav('Descargar')` monta
    `DownloadsHubView` dentro de `EditorWorkspace` (unificación F2/T1) y
    `DownloadView` es un chunk lazy grande; el `waitFor` por defecto (1 s)
    vencía antes del primer render del módulo. No era un fallo de producto:
    la vista embebida montaba y el flujo analizar→importar→auto-editar era
    el correcto.
  - **Fix**: `App.test.tsx` sube las dos esperas de «Motor de descargas» y
    «Copiar conexión» a `{ timeout: 5000 }`, mismo criterio que
    `createProject` usa para `.timeline-surface`.
  - **Archivos**: `apps/desktop/src/App.test.tsx` (2 líneas).
  - **Verificación**: `npx vitest run src/App.test.tsx` **76/76** ·
    `npm run typecheck` 0 errores. No se corrió `npm run verify` completo.
  - **Nota**: los warnings de `HTMLCanvasElement.getContext` en jsdom
    (ThumbnailView) son ruido conocido, no la causa del fallo.

- `[done]` **Cerebro: reorden de escenas según la timeline (2026-11-07)** —
  cierra el `[pending]` «el cerebro todavía no reordena escenas», en una
  pasada del protocolo del loop (Devin CLI).
  - **Señal medida, no invención**: `sceneOrderPolicy`
    (`state/brain/script-policies.ts`) compara el `order` de cada escena con
    la posición de su primer clip existente en `timeline.clips`. Si el orden
    por timeline difiere del orden del guion, propone `script:scene-order`
    con payload `scene-order` (permuto completo de ids). Las escenas sin
    clips conservan sus lugares: no aparecen en el video, así que su
    posición en el guion es decisión de guion, no de edición.
  - **Primitiva nueva**: `reorderScenes(project, orderedSceneIds)` en
    `project-actions.ts` — recibe la permutación completa, verifica que los
    ids cubran exactamente las escenas del proyecto (si no, lanza
    `ProjectActionError`) y renumera `order` 0..n-1. `applyProposal` la
    ejecuta; si la lista ya no coincide, se omite con motivo.
  - **Riesgo `moderate`**: cambia el orden narrativo del guion (no toca
    clips ni timeline), así que no entra en «Aplicar lo seguro».
  - **Límite honesto**: la posición de una escena es el `startFrame` mínimo
    de sus clips; si las escenas están entrelazadas en la timeline el orden
    propuesto es el de su primer clip, no una comparación fotograma a
    fotograma.
  - **Archivos**: `state/project-actions.ts` (+test), `state/brain/types.ts`,
    `script-policies.ts`, `apply.ts`, `brain.test.ts` (+3 tests, 36 total;
    el invariante «las propuestas script no tienen payload» quedó con la
    excepción declarada de `scene-order`).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest
    `state/brain/brain.test.ts` **36/36** · `state/project-actions.test.ts`
    **101/101**. No se corrió la suite serial completa.

- `[done]` **Cerebro: reescritura mecánica de subtítulos (2026-11-07)** — mitad
  del `[pending]` «el cerebro no reescribe texto ni reordena escenas», en una
  pasada del protocolo del loop (Devin CLI). Queda pendiente reordenar escenas.
  - **Política nueva** `captionTextPolicy` (`state/brain/script-policies.ts`):
    `cleanCaptionText` normaliza espacios horizontales repetidos, el espacio
    que falta tras `,` `;` `:` (sólo antes de letra: «3,5» queda igual) y tras
    `.` `!` `?` cuando sigue mayúscula o `¿`/`¡` (así «www.ejemplo.com» queda
    igual), y quita el espacio antes de puntuación de cierre. Conserva saltos
    de línea. Sin cambios no propone nada.
  - **Payload aplicable** `caption-fixes` (types + `apply.ts`): una propuesta
    `caption-text` con hasta 60 cues, riesgo `safe` (entra en «Aplicar lo
    seguro»). Se aplica con `updateCaptionCue` existente, omitiendo por cue el
    que falle (pista bloqueada, cue borrado). Los cues con `words`/
    `wordReveal` se saltan: reescribir el texto desincronizaría el reveal por
    palabra — límite honesto declarado en el preview.
  - **Archivos**: `state/brain/types.ts`, `script-policies.ts`, `apply.ts`,
    `brain.test.ts` (+5 tests, 33 total).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest
    `src/state/brain` **33/33**. No se corrió la suite serial completa.

- `[done]` **Export WebM VP9/AV1 + Opus (2026-11-07)** — el schema ya
  permitía `webm/vp9/av1/opus` (`CONTAINER_MATRIX`) pero el worker los
  rechazaba y la UI no los ofrecía. Ahora el pipeline completo los emite:
  - **Rust** (`render/ffmpeg.rs`): `parse_profile` valida la matriz del
    schema (WebM sólo VP9/AV1 + Opus; MP4/MOV sólo H.264/H.265 + AAC).
    `choose_encoder` elige por códec: `libvpx-vp9` para VP9;
    `libsvtav1`→`av1_nvenc`→`av1_qsv`→`av1_amf`→`libaom-av1` para AV1.
    `software_video_args` habla el dialecto de cada familia: x264/x265
    `-preset`+`-crf`; libvpx-vp9/libaom-av1 `-cpu-used`+`-row-mt` y CRF
    exige `-b:v 0`; libsvtav1 con su escala de presets 0-13; el resto sólo
    bitrate. `audio_encoder_for` mapea Opus→`libopus` a 48 kHz forzado.
    `-movflags +faststart` sólo para MP4/MOV. Hardware: `av1_*` y `vp9_qsv`
    validados por códec (la sonda `hardware_encoders` sigue midiendo sólo
    H.264/H.265 — VP9/AV1 van por software).
  - **Capabilities** (`commands/export_tools.rs`): la matriz interseca el
    renderer con los encoders reales del binario — WebM aparece sólo si hay
    VP9/AV1 **y** `libopus`; AV1 sólo si hay `libsvtav1`/`libaom-av1` o
    hardware AV1.
  - **Frontend**: `applyCompression` acepta `vp9`/`av1` y reacomoda
    `container`/`audioCodec` coherentes; el selector de códec del
    ExportDialog ofrece los 4 códecs; el check de compatibilidad usa el
    códec real (antes mapeaba h265→'hevc' que la matriz no usa); los nombres
    de archivo de lote y de cola usan la extensión del contenedor
    (`containerExtension`) — `.webm` ya no sale como `.mp4`; `availableHardware`
    devuelve `null` para VP9/AV1 (sin sonda propia, honesto); fine-print y
    preset explican Opus/WebM.
  - **Verificación real**: FFmpeg dev renderizó WebM VP9+Opus y AV1+Opus de
    1 s (testsrc+sine) con el dialecto exacto de `software_video_args`;
    ffprobe confirma `matroska,webm` + `vp9`/`av1` + `opus`.
  - **Límites honestos**: `pixelFormat` sigue fijo `yuv420p` (sin alpha ni
    10-bit en export); la sonda de hardware no mide AV1/VP9 (caen a
    software); CRF de VP9/AV1 usa la escala 0-63 del perfil (el schema la
    admite); AV1 por `libaom-av1` es el último fallback (muy lento).
  - **Archivos**: `src-tauri/src/render/ffmpeg.rs`,
    `src-tauri/src/commands/export_tools.rs`,
    `src/state/project-actions.ts` (+test),
    `src/features/editor/ExportDialog.tsx`,
    `docs/FOLLOW-UPS.md` §6.2.
  - **Tests**: Rust lib **635/635** (+4 nuevos: matriz webm, dialectos por
    encoder, choose_encoder, opus 48 kHz; export_tools +2: webm sólo con
    opus, av1 con encoder) · frontend project-actions+ExportDialog
    **108/108** (+1: ida y vuelta webm↔mp4) · `tsc` desktop 0.

- `[done]` **VPN del sistema en Ajustes (2026-11-07)** — pedido del usuario:
  "quiero que tenga vpn mi app". Diseño honesto: la app **no implementa un
  cliente VPN** (crypto/drivers TUN son un proyecto aparte y Windows ya tiene
  RAS nativo); gestiona las conexiones del sistema.
  - **Rust** (`commands/vpn.rs`): `vpn_list` (PowerShell
    `Get-VpnConnection` → nombre, servidor, tipo de túnel, estado),
    `vpn_connect`/`vpn_disconnect` vía `rasdial` con timeout (90 s/30 s) y
    `CREATE_NO_WINDOW`; el nombre se valida contra la lista real antes de
    ejecutar (anti-inyección y sin objetivos arbitrarios). Credenciales: las
    guardadas por Windows — la app nunca las ve ni las pide. `vpn_wireguard`
    detecta la instalación oficial y `vpn_wireguard_open` la abre (el túnel
    lo activa el usuario con sus privilegios). Parsing puro testeable
    (objeto único vs array de PowerShell, null/basura, nombre vacío).
    No-Windows devuelve error honesto.
  - **Servicio**: `vpnList`/`vpnConnect`/`vpnDisconnect`/`vpnWireguard`/
    `vpnWireguardOpen` en `DesktopService` + fake-service con dos conexiones
    de ejemplo (una conectada, una no).
  - **UI**: `VpnCard` en Ajustes → Herramientas — lista con estado
    (Conectada/Desconectando/Desconectada), botones Conectar/Desconectar por
    conexión, errores inline, estado vacío que explica que las conexiones se
    crean en Configuración de Windows, y sección WireGuard (abre la app
    oficial sólo si está instalada).
  - **Límites honestos**: no crea conexiones (eso requiere admin +
    credenciales en Windows), no es un túnel propio, no aplica proxy a las
    funciones de red de la app (eso ya existe por feature: `test_proxy` en
    descargas, `--proxy-server` en instancias de navegador), sin tool MCP
    propia todavía.
  - **Verificación**: cargo `vpn` **4/4** · VpnCard **5/5** + SettingsHome
    **4/4** · `tsc` desktop 0 · script PowerShell probado en vivo (lista
    vacía real en este equipo, parsea a `[]`).
  - **Nota**: un `cargo fmt` accidental reformateó ~18 archivos Rust con
    drift preexistente; el usuario decidió conservarlos (formato canónico,
    sin cambio semántico).
  - **Archivos**: `src-tauri/src/commands/vpn.rs` (nuevo), `commands/mod.rs`,
    `lib.rs`, `services/project-service.ts`, `test/fake-service.ts`,
    `features/settings/VpnCard.tsx` (+test), `SettingsHome.tsx`,
    `styles/settings.css`, `docs/CAPABILITY-MATRIX.md`.

- `[done]` **Sonda de hardware AV1/VP9 + GPU en export WebM (2026-11-08)** —
  cierra la parte «sonda de hardware para AV1/VP9 y exponerlo en la UI de
  WebM» del `[pending]` de velocidad, en una pasada del protocolo del loop
  (Devin CLI).
  - **Rust** (`commands/audio.rs`): `HardwareEncoders` suma `av1` y `vp9`;
    `detect_hardware` los sondea con `first_working` sobre `HW_AV1`
    (`av1_nvenc`/`av1_qsv`/`av1_amf`) y `HW_VP9` (`vp9_qsv`/`vp9_amf`) — el
    mismo init real de 0,1 s por encoder que ya medía H.264/H.265, cacheado
    por binario. `render/ffmpeg.rs` amplía `HARDWARE_VP9` con `vp9_amf` y
    `export_tools.rs` lo refleja en la matriz de capabilities.
  - **Pipeline ya existía**: `validate_hardware_encoder` aceptaba
    `av1_*`/`vp9_*` y `hardware_encoder_args` emite los flags por familia
    (`_amf`/`_nvenc`/`_qsv`); sólo faltaba detectar y ofrecer. El diálogo
    de exportación ahora los usa igual que H.264/H.265.
  - **Frontend**: `HardwareEncoders` (servicio + fake) suma los campos;
    `ExportDialog.availableHardware` mapea códec→encoder para los 4 códecs
    (códec desconocido → `null`, no cae a H.264). El checkbox «Acelerar con
    GPU» y `gpuRecommendation` aplican igual a perfiles WebM; el encoder
    viaja por `hardwareEncoder` en `startRender`/`startRenderTo` (single y
    lote) y el backend lo valida contra el códec del perfil.
  - **Verificación**: cargo lib test `commands::audio` **11/11** (test nuevo
    `detecta_encoders_av1_y_vp9_en_la_lista`) — la crate completa compiló con
    todos los cambios en esa corrida. `tsc --noEmit` desktop **0** · vitest
    `ExportDialog.test.tsx` **7/7** (test nuevo: perfil AV1/WebM +
    `av1_nvenc` detectado → checkbox habilitado → `startRenderTo` recibe
    `'av1_nvenc'`).
  - **Límite honesto**: `vp9_amf`/`av1_*` sólo se ofrecen si el encoder
    inicializa de verdad en la sonda; la matriz de capabilities sigue
    declarando VP9/AV1 como «(GPU)» sólo con encoder compilado. El tope de
    resolución hardware queda en 4096 px de lado (8192 sólo H.265), igual
    que la validación del backend. Tests filtrados de `convert`/
    `export_tools`/`ffmpeg` no se corrieron en esta pasada: otra sesión
    dejó `commands/audio_scopes.rs` (WIP no confirmado) con un error de
    sintaxis que bloquea el target lib-test completo; la compilación de la
    crate con mis cambios ya quedó verificada en la corrida de audio.
  - **Archivos**: `src-tauri/src/commands/audio.rs`,
    `src-tauri/src/commands/system.rs`, `src-tauri/src/commands/convert.rs`
    (literales de test), `src-tauri/src/render/ffmpeg.rs` (1 línea),
    `src-tauri/src/commands/export_tools.rs`, `services/project-service.ts`,
    `test/fake-service.ts`, `features/editor/ExportDialog.tsx` (+test).
  - **Nota**: no se commiteó: el árbol tiene trabajo concurrente de otra
    sesión (VPN ya registrada arriba, `audio_scopes.rs`, stickman,
    screen_record, etc.) mezclado en los mismos archivos; un commit ahora
    capturaría trabajo ajeno a medio hacer.

- `[done]` **Cola de render persistente en el backend · v1 espejo durable
  (2026-11-07)** — primer incremento real de la feature grande de
  `FOLLOW-UPS.md` §6.3, ejecutado fuera del loop (Devin CLI, continuación
  de sesión).
  - **Rust**: `commands/render_queue.rs` nuevo — núcleo puro
  (`load_queue`/`save_queue` sobre `PathBuf`, testeable sin Tauri) +
  comandos `render_queue_load` / `render_queue_save` /
  `render_queue_clear_finished` registrados en `lib.rs`. Persiste en
  `%LOCALAPPDATA%\com.editoria.desktop\render-queue.json` con los mismos
  estados del frontend (`pending`/`running`/`done`/`error`/`cancelled`),
  tope de 50, recuperación `running`→`pending` al cargar y tolerancia a
  JSON corrupto/entradas basura.
  - **Servicio**: `DesktopService` suma `renderQueueLoad` /
  `renderQueueSave` / `renderQueueClearFinished` (nativo invoca los
  comandos; el servicio no disponible devuelve `null`/`{}` para que la UI
  sepa que no hay backend durable). `fake-service` implementa la copia en
  memoria con la misma recuperación.
  - **UI**: `ExportDialog` hidrata la cola desde el backend al abrir
  (manda sobre localStorage) y le espejo cada cambio — localStorage queda
  como respaldo en navegador y caché. «Limpiar terminadas» usa
  `renderQueueClearFinished` cuando el backend respondió. Estado
  `cancelled` agregado a `RenderQueueStatus`/`QueueSummary` (paridad con
  el enum Rust): se muestra «Cancelado», se reintenta y cuenta como
  saldada.
  - **Honesto**: pausa/reanudar/reorden del lado del worker **siguen sin
  existir** — los controles quedan deshabilitados con motivo; el reorden
  real sigue siendo `movePending` en la UI. La cola durable es un espejo,
  no un scheduler del backend.
  - **Archivos**: `src-tauri/src/commands/render_queue.rs` (nuevo),
    `commands/mod.rs`, `lib.rs`, `services/project-service.ts`,
    `test/fake-service.ts`, `state/render-queue.ts` (+test),
    `features/editor/ExportDialog.tsx`, `docs/FOLLOW-UPS.md` §6.3.
  - **Verificación**: `cargo test -p editor-ia-desktop render_queue`
    **5/5** · `cargo fmt --check` limpio en el archivo nuevo ·
    `tsc --noEmit` 0 · vitest dirigido render-queue+ExportDialog+
    queue-capabilities+project-service **43/43**.

- `[done]` **Duraciones de assets con el fps real del proyecto (2026-11-07)** —
  `AssetThumbnailGrid` dividía `media.durationFrames` por **30 fijo** (dos
  TODOs). El campo se persiste en frames DEL PROYECTO (`media/mod.rs`:
  `seconds × project_fps`), así que con proyecto a 24 fps un video de 60 s se
  mostraba como 0:48. Ahora `projectFps(store)` lee
  `project.video.frameRate` (respaldo 30 sin proyecto) y lo usan el badge de
  video y la meta de audio en lista. Test nuevo con proyecto a 24 fps:
  1440 frames → «1:00», 2400 frames → «100s» (antes «0:48»/«80s»).
  - **Archivos**: `features/assets/AssetThumbnailGrid.tsx` (+test nuevo).
  - **Verificación**: assets **9/9** · `tsc --noEmit` 0.

- `[done]` **Cerebro: política de silencios medida (2026-11-07)** — cierra el
  `[pending]` «el cerebro mide huecos, no silencios» del lote cerebro de
  edición, ejecutado en una pasada del protocolo del loop (Devin CLI).
  - **Señal, no decodificación**: igual que `BeatGrid`, el cerebro no pide
    picos ni decodifica audio. `planEdits` acepta `silences?:
    SilenceCutSignal[]` — planes ya calculados con `planSilenceCuts` (el mismo
    motor que `runSilenceCuts`) — y la nueva `silencePolicy` los convierte en
    propuestas `cut-silences` con payload `cut-spans` (clipId + spans +
    cutFrames + removedSeconds). Sin señal no propone nada.
  - **Aplicación real**: `applyProposal` ejecuta `cut-spans` con
    `applyCutSpans` de `state/silence-cuts` (split + ripple + captions), orden
    de ejecución 1, riesgo `moderate` (borra material medido; no entra en
    «Aplicar lo seguro»). Filtros: clip existente, spans/cutFrames no vacíos,
    ≥0,3 s y ≥2 % del clip; tope de 3 propuestas por plan.
  - **UI**: `BrainPanel` suma «Medir silencios» / «Re-medir silencios» /
    «Quitar medición» — mide hasta 12 clips candidatos (`silenceCutCandidates`)
    con `service.audioPeaks` + caché por asset y pasa los planes al
    `useMemo` del plan. Tras cualquier aplicación exitosa se limpia la
    medición (un ripple corre los frames y los planes quedan corridos).
  - **Archivos**: `state/brain/types.ts`, `policies.ts`, `apply.ts`,
    `plan.ts`, `index.ts`, `features/brain/BrainPanel.tsx`,
    `state/brain/brain.test.ts` (+5 tests, 28 total).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest dirigido
    `state/brain` + `features/brain` + `state/silence-cuts` **46/46**
    (brain.test 28/28, BrainPanel 6/6, silence-cuts 12/12). No se corrió la
    suite serial completa (cambio acotado a estado puro + panel).
  - **Extra**: el `[pending]` «UI — botón en el inspector de medios con
    inicio/fin y aviso del keyframe» (lote corte sin recodificar) ya estaba
    implementado: `LosslessCutCard` existe desde 2026-11-03, montada en
    `Inspector.tsx` con tests propios. Se marca resuelto sin código nuevo.

- `[done]` **Primera ejecución alineada al recorrido único (2026-11-07)** —
  slice posterior al cierre de F4, ejecutado en una pasada del protocolo del
  loop (Devin CLI). El diálogo de bienvenida era la última superficie que
  mostraba un contenido propio distinto del recorrido canónico.
  - **Pando narra `WORKSPACE_STEPS`**: `PANDA_TIPS` (4 consejos sueltos:
    proyecto/medios/tutorial) pasó a `PANDA_SLIDES`, construido con `map`
    sobre `WORKSPACE_STEPS`: saludo + los 6 pasos del pipeline con su
    `tip` real. Ya no existe una quinta variante del recorrido.
  - **Recorrido visible en la primera ejecución**: el diálogo muestra un
    `<ol class="welcome-journey">` con las 6 etapas numeradas (mismo orden
    y etiquetas que Inicio, Aprender, la guía del editor y el tour).
  - **CTA al tour guiado**: nuevo botón «Ver el recorrido guiado, paso a
    paso» que cierra el diálogo (marca `welcome.v1=seen`) y abre
    `OnboardingTour` vía prop `onOpenTour`, cableada desde `App.tsx`.
  - **Archivos**: `components/WelcomeDialog.tsx`, `App.tsx` (1 línea),
    `styles/chrome.css` (+`.welcome-journey*`, `.welcome-tour-link`),
    `components/WelcomeDialog.test.tsx` (+2 tests, 5 total).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · `vitest run
    src/components/WelcomeDialog.test.tsx` **5/5**. No se corrió la suite
    serial completa (cambio acotado a un diálogo lazy de UI).

- `[done]` **Unificación F4 (cierre) · OnboardingTour sobre el recorrido
  único (2026-11-07)** — última pieza de la fase F4 de
  `docs/UNIFICATION-PLAN.md`, ejecutada en una pasada del protocolo del loop
  (Devin CLI).
  - **Tour derivado de `WORKSPACE_STEPS`**: `OnboardingTour` ya no define sus
    propios 6 pasos (welcome/assets/timeline/preview/ai-tools/export, un
    recorrido distinto). `TOUR_STEPS` se construye con `map` sobre
    `WORKSPACE_STEPS`: mismos ids, `title`=label, `subtitle`=action,
    `content`=detail, `proTip`=tip y `view`=la etapa canónica, así que cada
    paso navega a la vista real del pipeline (projects → script → assets →
    production → editor → production). Lo único propio que queda es
    `TOUR_TARGETS`, el ancla visual por etapa (toolbar de Proyectos/Guion/
    Medios/Producción, timeline del editor y botón Exportar del topbar, que es
    global). Test nuevo fija la derivación campo por campo.
  - **Archivos**: `components/OnboardingTour.tsx` (−75 líneas de copy
    duplicado), `components/OnboardingTour.test.tsx` (nuevo, 3 tests).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest dirigido
    (OnboardingTour 3/3, WorkspaceGuide 4/4, LearnView 2/2, workspace-map
    4/4) **13/13** · `App.test.tsx` **76/76**. No se corrió la suite serial
    completa (cambio acotado a un componente lazy de UI).
  - **F4 queda cerrada**: paleta desde el mapa, atajos agrupados, hubs como
    panel con retorno y onboarding con el recorrido único. Criterio del plan
    cumplido: LearnView, WorkspaceGuide (Inicio/Guía/editor) y OnboardingTour
    muestran los mismos 6 pasos de `app/pipeline.ts`.

- `[done]` **Grafos de nodos dentro del documento del proyecto (2026-11-07)** —
  cierre del gap 9 de `docs/CAPABILITY-MATRIX.md`, pedido del usuario
  («agregá lo que falta»).
  - **`x-nodeGraphs` en el `.editoria.json`**: los grafos del editor de
    nodos ya no son archivos sueltos en `<proyecto>/graphs/`. Se guardan en
    la clave `x-nodeGraphs` del documento — el namespace `x-` es la vía del
    formato para campos aditivos, así el archivo sigue válido para Zod, para
    el validador Rust y para versiones anteriores de la app.
  - **`graph-store.ts`** (helpers puros): `readStoredGraphs` /
    `upsertStoredGraph` con sanitizado JSON (los `undefined` de los campos
    opcionales del grafo romperían `JsonValueSchema`) y reemplazo por
    nombre sin duplicar.
  - **`NodeGraphView`**: «Guardar» ahora hace upsert en el proyecto +
    `saveNow` (con un tick para que `stateRef` vea el `update`); la vista
    restaura el último grafo del documento al abrir y mantiene el fallback
    legado `graphs/*.json`. Barra nueva con nombre del grafo editable y
    selector cuando hay más de uno guardado. Cargar/Guardar-externo por
    archivo se conserva para compartir grafos entre proyectos.
  - **Hallazgo relacionado**: `runGraph` llama `store.update` + `saveNow` en
    el mismo tick; `saveNow` lee `stateRef` que aún no refleja el update
    (posible guardado de documento viejo antes del render). No se tocó:
    queda asentado como follow-up.
  - **Archivos**: `features/nodes/graph-store.ts` (nuevo + test, 7 tests),
    `NodeGraphView.tsx`, `nodes.css`, `docs/CAPABILITY-MATRIX.md`.
  - **Verificación**: vitest `features/nodes/` **13/13** (graph-store 7 +
    graph-model 6) · `tsc --noEmit -p apps/desktop` 0. No se corrió la
    suite serial completa.

- `[done]` **Atajos locales del timeline reasignables + scopes del color con
  paridad FilmCraft + reorden de cola de render (2026-11-07)** — tres gaps de
  `docs/FOLLOW-UPS.md`/`CAPABILITY-MATRIX.md`, mismo pedido del usuario.
  - **Atajos**: 12 ids nuevos en `state/shortcuts.ts` (`timeline.rippleToggle`,
    `panMode`, `copyClip`, `pasteClip`, `deleteWithRipple`, `moveGroupLeft/Right`,
    `tools.select/split/selectBackward/selectForward/zoom`) con los defaults que
    el timeline ya usaba; `Timeline.tsx` y `EditorWorkspace.tsx` leen el registro
    vía `bindingMatches` + `shortcutsRef` (S/M incluidos). Evidencia por id en
    `shortcuts-pro.test.ts`. Pendiente honesto: `clipKeyboardAction` (Alt/Ctrl+Alt
    + flechas) sigue fijo porque Shift es modificador de la acción.
  - **Scopes**: `ColorStudio` renderiza el frame del clip gradeado
    (`render_preview_frame`, mismo `visual_filter` del export, debounce 400 ms)
    y pasa `realFramePath`+`analyzeScopes` a `ScopesPanel`: el botón FilmCraft
    mide waveform/vectorscope/histograma nativos en la página de Color, no sólo
    en el monitor.
  - **Cola de render**: la persistencia entre sesiones ya existía
    (`localStorage`, `running`→`pending`). Se agregó `movePending` para
    permutar entradas `pending` — reorden real sin backend — y el botón
    «Reordenar» del diálogo lo usa cuando el servicio no expone
    `moveRenderQueueEntry`. Pausa/reanudar siguen deshabilitados (sin soporte
    backend, no se simula). Backend persistente en Rust sigue pendiente.
  - **Archivos**: `state/shortcuts.ts`, `state/shortcuts-pro.test.ts`,
    `features/editor/Timeline.tsx` (+test), `EditorWorkspace.tsx`,
    `features/color/ColorStudio.tsx`, `state/render-queue.ts` (+test),
    `features/editor/ExportDialog.tsx`, `docs/ATAJOS-PRO.md`,
    `docs/FOLLOW-UPS.md`, `docs/CAPABILITY-MATRIX.md`.
  - **Verificación**: vitest dirigidos — shortcuts+Timeline **46/46**,
    render-queue+ExportDialog+capabilities **24/24**, color/scopes **8/8** ·
    `tsc --noEmit` 0. No se corrió la suite serial completa.

- `[done]` **Cableado global de atajos 🟡 + fix de guardado en `runGraph`
  (2026-11-07)** — pendientes 5 y 8 de la lista de gaps.
  - **`App.tsx`**: `playback.shuttleForward/Pause` (`L`/`K`), `framePrev/Next`
    (`,`/`.`) y `goToStart/End` (`Home`/`End`) ahora se despachan desde
    cualquier vista con proyecto abierto (pausan la reproducción al saltar de
    frame). Los ids de timeline con handler local (`S`, `M`, `H`, zoom, trim,
    ripple…) no se duplican: el dispatcher cae en `default` sin
    `preventDefault` y responde el handler local.
  - **`Timeline.tsx`**: `timeline.zoomIn/Out/Fit` (`+`/`-`/`F`) usan las mismas
    fórmulas que los botones (×1.4, ajuste `760/max(4·fps, duration)`);
    `timeline.trimIn/Out` (`[`/`]`) recortan el clip seleccionado hasta el
    playhead vía `trimClip`.
  - **Conflicto cerrado**: los divisores de panel (timeline height,
    inspector width) hacían `preventDefault` sin `stopPropagation` en
    Home/End y flechas — ahora frenan la propagación para no disparar los
    atajos globales/locales.
  - **`NodeGraphView.runGraph`**: `saveNow` ahora cede un tick tras
    `store.update` antes de guardar, igual que `saveGraph` — antes podía
    persistir (y renderizar) el documento anterior al grafo.
  - **Verificación**: `tsc --noEmit` 0 · vitest `App.test.tsx` +
    `Timeline.test.tsx` + `features/nodes/` **108/108**.

- `[done]` **Bindings para acciones de clip por teclado (2026-11-07)** —
  pendiente 7 de `ATAJOS-PRO.md`.
  - `clipKeyboardAction` (`timeline-keyboard.ts`) acepta el `ShortcutMap`
    vigente y resuelve los 6 ids `timeline.clipMove*`/`clipTrim*`; el match
    compara el binding del evento **sin Shift** contra el configurado **sin
    Shift** (Shift = ±1 s / borde de salida, modificador de la acción).
    `EditorWorkspace` le pasa `shortcutsRef.current`. Defaults idénticos al
    esquema Alt/Ctrl+Alt anterior — migración transparente.
  - Límite honesto documentado: bindings que sólo difieran en Shift
    colisionan al hacer match.
  - **Verificación**: vitest `timeline-keyboard.test.ts` **12/12** (test nuevo
    de reasignación) + `shortcuts-pro` 5/5.

- `[done]` **Unificación F4 (cierre) · onboarding de primera ejecución con el
  recorrido único (2026-11-07)** — último pendiente de la fase F4 de
  `docs/UNIFICATION-PLAN.md`. F4 queda **completada**.
  - **`WelcomeDialog` alineado al mapa**: el diálogo de primera ejecución ya
    no tiene copy propio divergente. `PANDA_TIPS` (4 consejos hardcodeados)
    se reemplazó por `PANDA_SLIDES`: saludo + los 6 pasos de
    `WORKSPACE_STEPS` («Paso N: <etapa>» con su `tip` real). El diálogo
    muestra además la lista numerada de las seis etapas
    (`.welcome-journey`), así el primer arranque presenta el mismo recorrido
    que Inicio, Aprender, la guía del editor y el tour.
  - **Puerta al tour desde la bienvenida**: nuevo prop `onOpenTour` (wired a
    `openTour` en `App.tsx`) y link «Ver el recorrido guiado, paso a paso»
    que cierra el diálogo y abre el `OnboardingTour` — que ya deriva sus
    pasos de `WORKSPACE_STEPS` desde F1.
  - **Archivos**: `components/WelcomeDialog.tsx` (+test, 3 tests nuevos),
    `App.tsx` (1 línea), `styles/chrome.css` (`.welcome-journey`,
    `.welcome-tour-link`), `components/WelcomeDialog.test.tsx`.
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest dirigido
    `WelcomeDialog.test.tsx` **5/5**. No se corrió la suite serial completa
    (cambio acotado a un diálogo que sólo monta con runtime nativo).
  - **Siguiente paso**: la unificación F1–F4 quedó cerrada; los pendientes
    vuelven a ser los de `docs/FOLLOW-UPS.md` (firma de release, verificación
    nativa del streaming, cola de render persistente, grafos de nodos en el
    `.olyp`, atajos locales del timeline reasignables).

- `[done]` **Unificación F4 (3ª parte) · hubs medidos + fix de «Volver al
  mapa» (2026-11-07)** — slice acotado de la fase F4 de
  `docs/UNIFICATION-PLAN.md`, ejecutado en una pasada del protocolo del loop
  (Devin CLI). Era la «verificación medida de los 3 hubs» que F4 dejaba
  pendiente.
  - **Bug real encontrado y corregido**: `clearTool` («Volver al mapa» del
    breadcrumb de una herramienta embebida) limpiaba `toolView`/`toolTab`
    pero dejaba `activeId` en el host (`creator`, `lab`, `download`…).
    `renderView` caía entonces en el `case` standalone del hub y **sacaba al
    usuario del editor**, contradiciendo la unificación. Fix de una línea:
    `setActiveId('editor')`, igual que ya hacía `openToolMap`. Detectado
    por el test nuevo (0 `.editor-tool-chip` tras volver al mapa).
  - **Verificación medida agregada** (`App.test.tsx`, describe T2, +2 tests,
    20 s por chunks lazy): Creador y Laboratorio se montan como panel del
    modo `tools` con `.timeline-panel` presente, pestaña inicial correcta
    (`Crear`/`Convertir`), rail marcando el host (`aria-current=page`),
    breadcrumb «Volver al mapa» + «Volver a Edición»; «Volver al mapa»
    regresa al mapa de 35 chips sin salir del editor y «Volver a Edición»
    devuelve el modo `timeline`. Aliases `factory`→Creador y
    `upscale`→Laboratorio abren la pestaña pedida (`initialTab` +
    `requestId`) dentro del mismo panel.
  - **Archivos**: `App.tsx` (+5 líneas), `App.test.tsx` (+69).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · `vitest run
    src/App.test.tsx` **76/76** (antes 74). No se corrió la suite serial
    completa (cambio acotado a `clearTool` + tests del módulo).
  - **Siguiente paso F4**: sólo queda el cierre del onboarding de primera
    ejecución con el recorrido único (`WORKSPACE_STEPS`).

- `[done]` **Unificación F4 (2ª parte) · atajos del cheat sheet agrupados por
  el mapa (2026-11-07)** — slice acotado de la fase F4 de
  `docs/UNIFICATION-PLAN.md`, ejecutado en una pasada del protocolo del loop
  (Devin CLI).
  - **Atajos `nav.*` por grupo del estudio**: `ShortcutsCheatSheet` ya no
    muestra los 9 atajos de navegación bajo una única sección plana
    «Navegación». Cada `nav.<view>` resuelve su `ViewId` con
    `workspaceGroupFor` (misma fuente que la paleta de comandos) y se
    agrupa como «Navegación · Preparar / Editar / Potenciar / Aprender y
    ajustar». El prefijo evita la colisión con la categoría «Editar» de los
    atajos `edit.*`. El filtro «Navegación» y la búsqueda no cambian.
  - **Archivos**: `components/ShortcutsCheatSheet.tsx` (+test nuevo
    `ShortcutsCheatSheet.test.tsx`, 4 tests).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest dirigido
    **25/25** (ShortcutsCheatSheet 4/4 + workspace-map, commands,
    navigation, view-routing 21/21). No se corrió la suite serial completa
    (cambio acotado a un componente lazy de UI).
  - **Siguiente paso F4**: verificar cobertura de los 3 hubs
    (`download`/`creator`/`lab`) como panel del editor con retorno
    persistente (T1 ya los monta vía `EDITOR_TOOL_HOSTS` → modo `tools`;
    falta la verificación medida) y cierre del onboarding de primera
    ejecución con el recorrido único.

- `[done]` **Unificación F4 (parcial) · paleta desde el mapa y copy de primera
  ejecución (2026-11-07)** — slice acotado de la fase F4 de
  `docs/UNIFICATION-PLAN.md`, ejecutado en una pasada del protocolo del loop
  (Devin CLI).
  - **Paleta de comandos generada desde `workspace-map`**: `app/commands.ts`
    ya no mantiene una lista manual de 15 vistas «principal» + resto plano
    bajo la categoría genérica «Navegar». Los 33 comandos `nav.*` se generan
    desde `WORKSPACE_GROUPS`: el orden sigue los 4 grupos del estudio
    (Preparar → Editar → Potenciar → Configurar) y la `category` es la
    etiqueta real del grupo, así que buscar «editar» o «preparar» en la
    paleta encuentra las herramientas del recorrido. Las etiquetas salen de
    `NAV_VIEWS` (fuente única) y los 9 atajos `nav.*` personalizables se
    conservan vía `NAV_SHORTCUTS`. Un test nuevo fija orden, categoría y
    etiqueta contra el mapa.
  - **Copy de primera ejecución alineado**: `WelcomeDialog` decía «Cinco
    pasos» desde antes de F1; ahora usa `WORKSPACE_STEP_COUNT` (6), el mismo
    recorrido canónico que Inicio, Aprender, el modo Guía y el editor vacío.
    Test nuevo lo fija.
  - **Archivos**: `app/commands.ts` (+test), `components/WelcomeDialog.tsx`
    (+test).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest dirigido
    (commands, workspace-map, navigation, view-routing, WelcomeDialog,
    CommandPalette ×2) **34/34** · `App.test.tsx` **74/74**. No se corrió la
    suite serial completa en esta pasada (cambio acotado a catálogo de
    comandos + copy; los consumidores usan ids `nav.*`, no etiquetas).
  - **Siguiente paso F4**: hubs como panel del editor con retorno persistente
    (T2 ya monta herramientas como panel: verificar cobertura de los 3 hubs
    download/creator/lab), atajos del cheat sheet agrupados por los grupos
    del mapa, y cierre del recorrido único en primera ejecución.

- `[done]` **Unificación F3 · puertas únicas en «Más» (2026-11-07)** —
  cierre de la fase F3 de `docs/UNIFICATION-PLAN.md`, ejecutada en una pasada
  del protocolo del loop (Devin CLI). Las 6 vistas que `resolveViewRoute`
  resuelve a modo del editor (Texto, Multicámara, Mezcla, VFX, Motion,
  Efectos) ya no tienen puerta propia en el rail: sus nombres colisionaban
  con las tabs del editor. `SECONDARY_NAV_VIEWS` las excluye derivando de
  `resolveViewRoute` (sin segunda lista que mantener); quedan 5 puertas
  (Nodos, Director, Automático, AI Hub, MCP — estas tres últimas conservadas
  porque tienen pantalla standalone sin proyecto, F2). Siguen alcanzables
  por paleta de comandos, deep links y las tabs del editor.
  - **Archivos**: `app/navigation.ts` (+test), `components/Sidebar.tsx`
    (tooltip), `App.test.tsx`, `features/motion/MotionView.test.tsx`,
    `features/motion/LottiePanel.test.tsx`, `e2e/app.spec.ts`,
    `e2e/helpers.ts`, `docs/UNIFICATION-PLAN.md`.
  - **Contrato actualizado deliberadamente** (no desactivado): tests de nav
    assertan la no-duplicación; `App.test.tsx` navega Motion/Efectos por tab
    del editor («Efectos» se acotó al tablist de modos porque el inspector
    tiene otra tab homónima); e2e suma aserciones negativas de las 6
    etiquetas en `#sidebar-more-list`.
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest dirigido
    (navigation, view-routing, workspace-map, MotionView, LottiePanel)
    **24/24** · `App.test.tsx` **74/74** · Playwright `app.spec.ts`
    **4/4** en Chrome real (incluye las nuevas aserciones F3).
  - **Siguiente paso**: F4 (hubs como panel del editor, paleta/atajos desde
    `workspace-map`, onboarding único). Detalle en `docs/UNIFICATION-PLAN.md`.

- `[done]` **Pulido visual medido: letras, iconos y detalles (2026-11-06)** —
  pedido del usuario: "arreglá y seguí mejorando los visuales del front end en
  las letras, los iconos, los detalles, completo". Alcance: `apps/desktop`,
  **sin tocar Rust ni backend**.
  - **Arnés nuevo** `.tmp-redesign/visual6/` (`audit.mjs`, `detail.mjs`,
    `detail2.mjs`, `theme-dialog.mjs`): 13 estados a 1360×768, puente Tauri
    simulado con proyecto demo real, medición de escala tipográfica,
    interlineado, recortes, contraste AA, áreas de clic, solapamientos,
    iconos y desbordes. Línea base `antes2-1360/` y resultado `final2-1360/`
    con la **misma sonda** (se reconstruyó el build sin la capa para el A/B).
  - **Defectos medidos antes → después**: texto < 10 px **15 → 0**;
    tamaños fuera de escala (8/9/9.5/10.12/10.5/11.04/11.5 px) **→ escala
    entera 10/11/12**; interlineado < 1,25 **111 → 3**; contraste < 4,5:1
    **10 → 0**; controles con área < 24 px **56 → 0**; solapamientos **1 → 0**;
    `pageOverflow` **0 → 0**; errores de consola **0 → 0**.
  - **Capa única nueva** `styles/filmora/filmora-polish.css`, importada al
    FINAL de `main.tsx` (después de `filmora-states.css`). No reemplaza ni
    edita las 9 capas legacy: corrige por especificidad, con variantes para
    `data-theme="light"`. Corrige avatar de 8 px, `code` a `0.92em`,
    `.info-tip` de 9.5 px/15 px, `summary` y notas de 10.5/11.5 px, anillo de
    Aprender de 9 px, `line-height: 12px` + `letter-spacing: -0.15px` en las
    pestañas del rail, `--fm2-ink-4` (4,12:1) en chips, `stroke-width: 1.6`
    del CTA, iconos sueltos de 12/13 px y foco de 1 px.
  - **Detalle de composición**: el badge «New» se movió de
    `.start-promo-copy` a `.start-promo-art` en `FilmoraStates.tsx` (1 línea):
    dejó de tapar el titular **sin** aumentar la altura de la tarjeta, que era
    lo que recortaba la última fila de «Herramientas de IA integradas».
    La barra del visor conserva sus 11 controles y el scroll horizontal
    decidido en `filmora.css`, pero ahora muestra scrollbar fina con
    `scroll-behavior: smooth` (antes era invisible).
  - **Verificación visual**: 13 capturas, inspección de lanzador/editor/
    Inicio/Descargas/Aprender, tema claro real vía `applyAppearance`
    (`preset: 'light'`) y `pageOverflow 0`. SSIM antes/después 0,74–0,97:
    la diferencia es el interlineado 1,4, que hace que el texto antes
    truncado se lea completo (mejora verificada, no regresión).
  - **Límites honestos**: los 60 textos < 4,5:1 del tema claro son deuda
    PREVIA (`#6b7480`, acento verde, blanco sobre CTA); el token nuevo
    `#4c5763` da ~7,5:1. El visor sigue siendo un HUD de 363 px con 788 px
    de controles: se añadió affordance, no se reestructuró (requiere JSX).
    Los nombres de pista siguen `sr-only` por pedido explícito anterior del
    usuario (sólo candado/ojo/sonido).

- `[done]` **Front end completo · prompt, análisis y F2 de unificación (2026-11-06)** —
  pedido del usuario: crear un prompt, analizar con las capturas de
  `D:\Users\ofici\Pictures\Screenshots` y mejorar, unificando TODA la app al
  editor. Documento `docs/UI-F2-PROMPT-ANALISIS.md` (prompt maestro, inventario
  de las 9 capturas nuevas 129–137, análisis del estado real, diseño y
  criterios). `docs/UNIFICATION-PLAN.md` actualizado con F2 y el siguiente paso.
  - **Análisis**: 45 capturas (93–137); las 9 nuevas son menús/diálogos de
    referencia (1360×768, 9 SHA-256 distintos), no pantallas nuevas. Ya existía
    el patrón de menú (separadores, atajos a la derecha, disabled, check).
    Brecha real: 6 vistas de flujo seguían sacando al usuario del editor con
    proyecto abierto; 9 tabs planos; sin retorno persistente; guía compacta con
    ~97 px de contenido por debajo del scroll.
  - **F2**: `EDITOR_EMBEDDED_VIEWS` + `editorModeForView` / `viewForEditorMode`
    en `app/view-routing.ts` (única fuente; `resolveViewRoute` INTACTO para no
    romper deep links ni `workspace-map`). `App.tsx`: con proyecto monta
    `EditorWorkspace(initialMode)` para script/assets/production/director/
    auto-edit/ai-hub, conserva el `activeId` lógico para que el rail marque la
    herramienta, carga **ambos** entries CSS y trata la superficie como editor
    (immersive/flush/playback); sin proyecto conserva las 6 pantallas
    standalone con su empty-state real. `onModeChange` sincroniza rail ↔ tab.
  - **UI**: 15 modos en 2 bloques con separador + cabecera «Editor › modo» y
    «Volver a Edición»; menú «Avanzado» con 11 accesos reales; botón
    persistente «Volver al editor» en `AppShell`; mapa de 4 grupos también en
    la guía compacta (scrollHeight 489 → **392 px**, cabe sin scroll);
    `MenuBar` con desplegable de 268 px. Corregidos los textos tenues heredados
    (`--color-text-faint`/`--color-empty` daban 3,5–3,7:1) en AI Hub y
    Automático → **0 textos < 4,5:1**. Quitado el blur del backdrop de atajos
    (el modal ya era 100 % opaco; las capturas «transparentes» se tomaban
    durante el fadeIn de 180 ms de un chunk lazy).
  - **Verificación**: typecheck **0** · `vite build` **0** · suite serial
    **2051 passed / 3 skipped / 0 failed** (234 archivos + 1 skip, exit 0;
    base 2047, +4 tests nuevos) · e2e **19 passed / 1 skipped / 4 failed**
    (exactamente los 4 previos de `input[type=color]`, sin regresiones) · arnés visual
    `.tmp-redesign/unify/f2/` con 13 estados + 1 captura aislada: **0 errores
    de consola / 0 pageerror**, `pageOverflow 0`, `tabsOverflow 0`, 15 tabs y
    1 separador, `.timeline-panel` presente en los 6 modos, 4 grupos en la
    guía, retorno al editor y sin-proyecto → empty-state preservado.
  - **Bundle**: JS principal **581.824 B (+0,29 %)** y CSS **666.960 B
    (+0,51 %)** frente a 580.128 / 663.563 B; ambos dentro del presupuesto 2 %.
  - `[next]` **F3**: quitar de «Más» las 6 puertas duplicadas, resolver las
    colisiones «Efectos»/«Texto»/«Audio» y actualizar deliberadamente
    `navigation.test.ts`, `App.test.tsx` y `e2e/app.spec.ts`. F4 completa:
    hubs como panel del editor, paleta/atajos desde el mapa y onboarding único.
    Cotejo 45/45 a 1100/1360/1600, miniaturas reales, nombres de pista
    visibles, 4 specs e2e desfasados, firma OV/EV y CDP nativa. No se declara
    100 % unificado.

- `[done]` **Unificación en un único editor · F1 (2026-11-06)** — pedido del
  usuario: prompt completo, análisis, plan y comienzo de la unificación en
  modo goal. Documento `docs/UNIFICATION-PLAN.md` (prompt maestro, análisis del
  estado real, arquitectura objetivo, fases F1–F4 y estado del objetivo).
  - **Diagnóstico**: la app ya tenía alias a hubs y 8 modos dentro del editor,
    pero CUATRO recorridos de aprendizaje contradictorios (Inicio 6 pasos,
    Aprender 5, tour 6 distintos y editor vacío 3 hints), 18 `ViewId` sin caso
    en `renderView` con loaders muertos, y el tour/atajos nunca montados
    (AppShell recibe props opcionales que `App.tsx` no pasaba).
  - **F1**: `app/workspace-map.ts` (+test) como única fuente de verdad: 6 pasos
    derivados de `app/pipeline.ts` y 4 grupos que cubren los **33 `ViewId`
    exactamente una vez**. `components/WorkspaceGuide.tsx` (+test) es el único
    componente de aprendizaje, montado en Aprender, en el nuevo modo «Guía» del
    editor y en el editor sin proyecto. `LearnView` pasó de 5 a 6 pasos;
    `OnboardingTour` y `ShortcutsCheatSheet` se montan una sola vez en
    `App.tsx` y se abren desde cualquier superficie. Eliminados 18 loaders
    muertos; los dos modales de ayuda pasaron a chunks lazy.
  - **Medición**: 4 recorridos → 1 (mismos 6 pasos en los 4 lugares); modo Guía
    con `.timeline-panel` presente; invariante 33/33; 14 cargadores / 14
    entradas / 15 casos; JS principal **580.128 B (−0,46 %)** y CSS 663.563 B
    (+1,08 %); `pageOverflow 0`, 0 `pageerror`, contraste AA 0 fallos.
  - **Verificación**: typecheck 0 · build 0 · suite serial **2047 passed /
    3 skipped / 0 failed** (234 archivos + 1 skip) · e2e **19 passed /
    1 skipped / 4 failed** (los 4 previos de `input[type=color]`, sin
    regresiones) · 6 capturas y métricas en `.tmp-redesign/unify/`.
  - `[next]` F2: modos agrupados para `script`/`assets`/`production`/
    `director`/`auto-edit`/`ai-hub` dentro del editor, conservando las vistas
    standalone cuando no hay proyecto; medir antes colisión de atajos con
    `Timeline`. F3: puertas únicas y colisiones de nombre. F4: hubs con retorno
    y onboarding único. No se declara 100 % unificado.

- `[done]` **Objetivo visual · iteraciones 1 y 2 (2026-11-06)** — pedido del usuario
  de activar el prompt de «app de pago» y el modo goal, enfocado **sólo en el
  front end visual**. El run externo `.agentloop/runs/20261105-233635-4108d0`
  había fallado en el arranque (`loop_agent_error`, CLI `opencode` exit 1); el
  objetivo se ejecutó como bucle directo con los mismos criterios medibles,
  sin falsificar el ledger ni el run fallido. Sin commits ni push.
  - **Estado base medido** (`.tmp-redesign/recon3/audit/baseline-*.json`):
    17 etiquetas de toolbar ocultas, 2 de 6 plantillas Split Screen visibles
    (contenedor 157 px / `scrollHeight` 462), guía de importación superpuesta al
    monitor, `.rail-list` de 20 px en editor vacío, arte genérico (`sparkles` /
    `film`), 38 textos por debajo de 4,5:1, 25 elementos a 9 px, 3 etiquetas
    `sr-only` de pista, chip del inspector en mono 8 px.
  - **Iteración 1 · estructura y arte**: guía de importación movida al panel de
    medios (`EditorWorkspace.tsx` → `EditorAssets.emptyGuide`), sin overlay;
    `.rail-list` 20 → **156 px** y `rail-main` sin desborde (ocultando pie y
    proxies cuando no hay medios). Las **6/6** plantillas Split Screen visibles
    sin scroll (densidad 4 px, `aspect-ratio 16/4.2`, proxies fuera de esa
    vista). Ilustraciones SVG reales: seguimiento de cámara en el diálogo de
    novedades (`NewsTrackingArt`, `MenuBar.tsx`) y fotograma + escena + play +
    progreso en el resultado de exportación (`RenderSuccessArt`). Chip
    «proyecto» del inspector pasado a UI 10 px sin mono/mayúsculas. Marca
    ajena fuera de la UI (`THEME_PRESET_LABELS.filmora` → «Grafito estudio»,
    opción de onboarding → «DaVinci Resolve»).
  - **Iteración 2 · legibilidad AA**: `--fm-type-2xs` 9 → 10 px y
    `.flag-letter` a 10 px → **0 elementos a 9 px** (escala 10/11/12, 2
    familias, 1 grosor de trazo, 2 tallas de icono). Contraste: texto oscuro
    sobre clips saturados (5,2–5,4:1 vs 2,86–3,19:1 anterior), ticks de regla
    `#96a0aa` (5,96:1) y `--fm-ink-4` `#828d98` (4,8:1) →
    **38 → 13 → 0 textos por debajo de 4,5:1** medidos con
    `probe-contrast.mjs`.
  - **Desviación honesta**: hacer visibles las 17 etiquetas de la toolbar
    principal suma 322 px y recorta controles (incluido «Más»); la densidad de
    2–3 filas quedó peor que la referencia. Se conservó el patrón icon-first
    (referencias 119–128) con `aria-label`/tooltips y la fila de herramientas
    rápidas con etiquetas visibles, y se ganó densidad real (padding 5→3 px,
    gap 6→4 px). `toolbar.scrollWidth = clientWidth = 1360`, 0 recortes.
  - **Verificación final**: typecheck 0 · build 0 · pruebas dirigidas
    **114/114** + test nuevo de composición SVG (13/13 en ese archivo) ·
    suite serial **2038 passed / 3 skipped / 0 failed**, exit 0 (232 archivos
    passed + 1 skipped; una primera corrida tuvo 2 fallos flaky de
    `EmojiPicker.focus.test.tsx`, aislado 2/2 y ausentes en la corrida final)
    · e2e **19 passed / 1 skipped / 4 failed** (exactamente los 4 previos de
    `input[type=color]`, sin regresiones) · arnés visual 10 estados,
    `pageOverflow 0`, 0 `pageerror` (3 errores benignos de rutas del stub de
    medios) · `icons.mjs`: 115 iconos, 1 trazo, 2 familias, 3 tamaños de letra.
  - **Capturas y métricas**: `.tmp-redesign/recon3/goal1/final/` (10 PNG +
    `results.json`) y `.tmp-redesign/recon3/goal1/*.json`.
  - `[next]` Cotejo completo 36/36 con las referencias a 1100/1360/1600;
    miniaturas de medios/efectos/transiciones reales; track names visibles en
    cabecera de pista (hoy `sr-only` por diseño, 3 etiquetas de 1 px); los 4
    specs e2e desfasados; firma OV/EV y verificación CDP nativa post-cambios.

- `[done]` **Reconstrucción integral Filmora · 36 capturas (93)–(128) (2026-11-05)** —
  auditoría completa en `docs/RECONSTRUCCION-FILMORA-93-128.md` e implementación
  sobre el frontend real, sin demo ni mockup.
  - **36/36** imágenes inventariadas (todas 1360×768, 36 SHA-256 distintos,
    0 duplicados exactos), inspeccionadas a resolución original; 7 pares de
    estados y 7 grupos funcionales documentados.
  - Proporciones corregidas por medición, no a ojo: editor
    `571 / 388 / 1 / 400 px` a 1360 (referencia `590 / 385 / 385`),
    sub-rail `160 + 410 px`, módulos `44 px`, grillas de 2 columnas 16:9.
  - Funcionalidad real nueva: grupos colapsables (`aria-expanded`), chips de
    filtro con `filterAssets` (3 → 0 medios al filtrar Imagen), contador de
    sección, desplegable «» del inspector con 8 pestañas y selección real,
    CTA degradado del lanzador que abre el diálogo de proyecto.
  - **3 bugs reales detectados y corregidos por medición**: `scrollBy` sin
    desborde propagaba el scroll al inspector y cortaba etiquetas; el grid
    `auto` de `.clip-inspector` lo ensanchaba a 441 px en un cuerpo de 373;
    a ≤1240 px el inspector caía en la columna de 1 px del divisor y
    desaparecía. HUD del visor ahora desplazable sin recortar chips.
  - **Verificación**: typecheck 0 · `vite build` 0 (368 módulos, 7 corridas) ·
    pruebas dirigidas **60/60** · suite serial raíz **2010 passed / 3 skipped /
    14 failed** (los 13 previos + `LottiePanel` flaky, aislado 3/3) · e2e
    **19 passed / 1 skipped / 4 failed** (los 4 previos de selectores
    `input[type=color]`). Arnés Playwright sobre build de producción:
    0 errores de consola, `pageOverflow 0`, 1360/1600/1100 px sin solapes.
  - Capturas finales en `.tmp-redesign/recon/final/` (19 PNG + `results.json`).
  - `[next]` Diferencias honestas: identidad «Olyvia» vs Filmora, fila extra
    de modos del editor, árbol de categorías genérico (no por módulo),
    miniaturas de stock no cargadas en el arnés, toolbars con más controles
    funcionales que la referencia, y sub-pestañas Básico/HSL/Curvas/Ruedas
    del inspector colour no reproducidas. Verificación CDP nativa pendiente.

- `[done]` **Rediseño visual Filmora 12 (2026-11-05)** — pedido del usuario
  con 4 capturas de referencia. Sistema global, no una pantalla:
  - Nuevo preset `filmora` en `state/theme-palette.ts` (34 tokens, grafito
    azulado `#0e141c`/`#161e28`, acento turquesa `#00c9a7`, clips azul/cian).
    El preset `olyvia` cobalt sigue disponible; `DEFAULT_APPEARANCE` usa el
    nuevo, radio 2 y densidad `compact`, con migración de la apariencia
    guardada que fuera exactamente el default viejo.
  - `styles/filmora/filmora.css`: capa única al final de `main.tsx` (barra
    32 px, pestañas con subrayado turquesa, paneles de 1 px, radios 2 px,
    sin sombras/glows/gradientes/blur, tipografía Segoe UI 11–13 px,
    etiquetas en caja mixta, EXPORTAR turquesa, transporte, inspector,
    timeline, lanzador, ajustes, diálogos y scrollbars).
  - Proporciones del editor: medios ~26 % · player ~48 % · propiedades
    ~26 %, timeline a todo el ancho; se conserva el divisor redimensionable.
  - `styles/tokens.css` actualizado como fallback de primera pintura.
  - Sin duplicación de CSS: se midió SSIM **1.000000 en 10 vistas** con y sin
    repetir la capa en los entries dinámicos, así que vive una sola vez.
  - **Tema claro preservado**: `applyAppearance` escribe `data-theme` y la
    capa usa `--fm-*` (superficies/lineas/tintas) con variantes oscura y
    clara. Sin esto los fondos hardcodeados rompían el preset «Claro neutro»
    (detectado por e2e `theme.spec.ts:929`, vuelto a verde).
  - **Migración acotada**: vive en `loadAppearance` (sólo preferencias
    persistidas sin marca `_design`), no en `normalizeAppearance`, para no
    impedir elegir explícitamente el preset «Olyvia». `saveAppearance`
    escribe la marca en cada guardado.
  - Arnés de verificación en `.tmp-redesign/filmora/` (proyecto demo real
    generado desde `test/fake-service.ts` + puente Tauri simulado por
    `addInitScript`); capturas `antes/`, `despues/`, `final/`,
    `theme-aware/` y comparación de color por moda de rejilla.
  - **Verificación**: typecheck 0; `vite build` 0; suite serial **2011
    passed / 3 skipped / 13 failed** (los 13 son los previos de
    `EffectStudio` 5, `AudioEffectStack` 4, `AssetsPanel` 3 y `App` 1 por
    trabajo UI no confirmado del usuario); e2e **19 passed / 1 skipped /
    4 failed** (specs desfasadas que buscan `input[type=color]`/`hue-slider`).
    Sin regresiones nuevas: la primera corrida tuvo 14/5 por dos fallos
    propios (reset de color y tema claro) y ambos se corrigieron.
    SSIM 1.000000 en 10 vistas al quitar la capa duplicada; 0 errores de
    consola en las 10 capturas.
  - Color medido: referencias barra `#17242d`/`#0c1117` y panel
    `#151f29`/`#23282e`; resultado `#101922`/`#161e28`, dentro del rango.
    Acento de referencia `#21dcc1`/`#44f2be`, resultado `#00c9a7`.
  - **Binario**: `cargo build --release -j 2 -p editor-ia-desktop
    --features tauri/custom-protocol --offline` OK en 11m19s; exe
    `target/release/editor-ia-desktop.exe` 39.712.256 B con el `dist`
    nuevo embebido. **No se pudo instalar**: la instancia en uso bloquea el
    archivo («está siendo utilizado en otro proceso») y no se puede cerrar
    desde esta sesión. El exe anterior se resguardó en
    `%LOCALAPPDATA%\Olyvia-backups\2026-11-05-filmora\`. Para verlo:
    cerrar Olyvia y ejecutar `Actualizar Olyvia.cmd` (cierra instancias,
    recompila y copia) o copiar manualmente el exe de `target\release`.
  - `[next]` Diferencias pendientes: marca «Olyvia» vs Filmora (identidad
    de producto), filmstrip de clips en el arnés (en nativo sí cargan),
    pestañas exactas Video/Color/Speed del inspector y verificación con
    CDP nativo tras reinstalar. El rail de iconos, el sub-rail de
    categorías, el mosaico 2 columnas y el tooltip del cabezal ya están
    resueltos en la segunda pasada.

- `[done]` **Segunda pasada Filmora · dos capturas nuevas (2026-11-05)** —
  pedido del usuario con `new-image-to-video-windows-29.jpg` y
  `filmora-split-button.jpg`; rediseño sobre el código real, sin demo ni
  mockup aparte.
  - Color medido con moda de rejilla: las referencias son grafito
    **neutro** (`#181d1f`/`#20262d`) con menta `#3df4ba`, clip
    periwinkle `#607eff` y cabezal rojo `#f96976`. Se corrigió la paleta
    global (antes azulada, acento `#00c9a7`, clip `#1c5f96`):
    `state/theme-palette.ts` (incluido `THEME_PRESETS.filmora`),
    `styles/tokens.css`, `state/appearance.test.ts` y los tokens `--fm-*`
    de `styles/filmora/filmora.css`. `LIGHT_PALETTE` sin tocar.
  - Sección 13 de `filmora.css`: módulos con icono+etiqueta, sub-rail de
    categorías y mosaico 2 columnas 16:9, pestañas/toggles/sliders del
    inspector, toolbar de timeline compacta, clips periwinkle, cabezal
    rojo circular y tooltip de dos líneas.
  - `EditorAssets.tsx`: `rail-stage` con `rail-categories` funcional
    (filtros reales `assetBins`/`filterAssets` y navegación a vistas
    existentes) sin tocar negocio. `Timeline.tsx`: sólo `data-tip` en el
    grip; lógica, atajos y scrub intactos.
  - **Hallazgo**: `app.css:5334` aplica `clip-path: polygon(...)` al grip,
    que recortaba también el `::after` del tooltip. Se resetea en la capa
    final (`clip-path: none`). El tooltip usa `S` y no `Ctrl+E`, porque en
    Olyvia `Ctrl+E` exporta.
  - Verificación: typecheck 0 · build 0 · suite serial raíz **2010
    passed / 3 skipped / 14 failed** (13 previos + 1 flake de foco que
    aislado pasa) · e2e **19 passed / 1 skipped / 4 failed** (los 4
    previos de ColorWheel), repetido dos veces. 13 vistas con paleta
    uniforme, `pageOverflow 0` y 0 errores de consola; capturas en
    `.tmp-redesign/filmora/final/`. Sin commits ni cambios Rust/servicios.

- `[done]` **Corte de contexto de playback (2026-11-05)** — pedido del usuario
  («que funcione rápida, consuma lo mínimo, extremadamente eficiente»).
  Cierra la deuda anotada el 2026-11-04 («los selectores nuevos no los usa
  ningún componente: el corte de contexto no está activo»).
  - **Cambio**: `playheadFrame` y `playing` salieron de `StoreState` a dos
    contextos propios (`PlayheadContext`, `PlayingContext`) dentro del mismo
    `ProjectProvider`. `useProjectStore()` ya no se invalida ~30-60 veces/s
    durante la reproducción: antes cada `setPlayhead` re-renderizaba a los
    ~100 consumidores (App, AppShell, MenuBar, Sidebar, AssistantDock,
    WelcomeDialog y toda vista montada). Ahora sólo se re-renderizan quienes
    muestran el frame (Timeline, Preview, Transport, MarkersPanel,
    TrackAutomationPanel, VfxView, `RegularClipInspector`, `usePlayback`).
  - **API**: `store.getPlayhead()`/`store.getPlaying()` leen un ref síncrono
    para handlers (siempre frescos, sin suscribir); hooks nuevos
    `usePlayheadFrame()`, `useProjectPlaying()`, `useProjectPlayback()`;
    `useProjectPlayhead()` se mantiene con la misma forma `{frame, playing}`.
    `adopt`/`closeProject` reinician el playback igual que antes.
  - **Migración**: 86 lecturas de `state.playheadFrame`/`state.playing` en 20
    archivos. Handlers → `getPlayhead()`/`getPlaying()`; render → hooks.
    `MenuBar` y `LiveMeters` sólo necesitaban `playing` (cambia 1 vez por
    play/pausa, no por frame). En `Timeline`, el rAF de drag usa
    `store.getPlayhead()` vía `latest.current`.
  - **Verificación**: `tsc --noEmit` 0 errores; `vite build` 0; test nuevo en
    `project-store.test.tsx` que cuenta renders y demuestra que un consumidor
    de `useProjectStore` **no** se re-renderiza con `setPlayhead` ni
    `setPlaying` (3/3 del archivo). Suites focalizadas: editor+App+components
    306 passed / 5 failed y assistant+assets+ai-hub+motion+script+vfx+mixer
    169 passed / 9 failed — los 14 fallos son **los ya documentados como
    preexistentes** del trabajo no confirmado del usuario (ThumbnailBrowser
    sin rol `button`: EffectStudio 5 + AudioEffectStack 4; AssetsPanel segundo
    `<main>` y filtro por carpeta: App 1 + AssetsPanel 3; LottiePanel 1 por el
    mismo `<main>` duplicado). Ninguno toca playback.
  - `[next]` Medición CDP del delta real de renders/CPU durante playback en la
    app instalada; segunda fase de CSS splitting; microbenchmark Rust LTO.

- `[done]` **Exploración de disco para la IA (2026-11-05)** — pedido del
  usuario («que la IA tenga acceso a la PC para tener los archivos o
  carpetas»). La superficie MCP ya cubría crear/borrar/editar toda la app
  (~95 herramientas: proyectos, pistas, clips, subtítulos, assets,
  exportación, automatizaciones, jobs); el hueco era **descubrir** material:
  `asset_import` exige rutas absolutas pero no había forma de listarlas.
  - **Cambio**: herramienta MCP `media_folder_list` — lista los medios
    (imagen/audio/video) de cualquier carpeta de la PC con ruta absoluta,
    nombre, tipo y tamaño. Acepta ruta absoluta o nombre de carpeta dentro
    de Descargas; reutiliza `list_media_folder` (Rust), que recorre hasta 2
    niveles, ignora no-medios y topa en 300 archivos. Read-only: entra en el
    conjunto de lecturas paralelas del bridge.
  - **Archivos**: `state/mcp-catalog.ts` (definición + `readOnlyHint`),
    `state/mcp-tools.ts` (caso que llama a `service.listMediaFolder`),
    `state/mcp-tools.test.ts` (test nuevo).
  - **Verificación**: `vitest run src/state/mcp-tools.test.ts` 23/23;
    `tsc --noEmit` 0 errores. El catálogo real lo sirve el frontend; el
    fallback Rust no requiere cambios (es un subconjunto mínimo).
  - **Límite honesto**: sólo lista medios (image/audio/video), no subtítulos
    ni proyectos sueltos; no hay búsqueda por nombre ni lectura de
    archivos. Si hace falta, siguiente iteración: `fs_list` general o
    `media_search`.

- `[done]` **Visibilidad total de la PC para la IA (2026-11-05)** — el usuario
  pidió que la IA «pueda modificar, crear, editar y VER TODO». La edición ya
  estaba cubierta (~97 tools); faltaba ver el disco completo.
  - **Cambio**: dos comandos Rust nuevos en `commands/files.rs` —
    `fs_list` (listado no recursivo de cualquier carpeta: subcarpetas
    primero, tipo dir/image/audio/video/subtitle/text/other, tamaño, tope
    500 entradas con flag `truncated`) y `fs_read` (contenido de texto de un
    archivo, tope 512 KiB con flag `truncated`). Sólo lectura, sin escritura
    de archivos arbitraria. Registrados en `lib.rs` y `mod.rs`.
  - **Frontend**: `project-service.ts` (tipos `FsEntry`/`FsListing`/
    `FsFileContent`, métodos `listDirectory`/`readTextFile`, stubs
    `unavailable`), `fake-service.ts` (stubs), `mcp-catalog.ts` (tools
    `fs_list` y `fs_read`, ambas `readOnlyHint`), `mcp-tools.ts` (casos).
  - **Verificación**: `vitest mcp-tools.test.ts` 24/24; `tsc --noEmit` 0;
    `cargo check` con `scripts/rust-env.mjs` 0 errores (sólo warnings
    preexistentes); `cargo test --lib commands::files` **4/4**; `vite build`
    OK (7,9 s). El binario de test Rust volvió a correr en esta máquina
    (el `STATUS_ENTRYPOINT_NOT_FOUND` documentado no se reprodujo).
  - **Límite honesto**: la IA ve y lee, pero **no escribe archivos
    arbitrarios** — modificar contenido sigue siendo vía tools de proyecto/
    exportación. `fs_read` lee cualquier archivo legible por el usuario
    (incl. secretos en texto plano si existen); el acceso está detrás del
    token Bearer del MCP en 127.0.0.1.

- `[done]` **Auditoría del backend Rust (2026-11-05)** — revisión completa
  pedida por el usuario («revisa todo primero»).
  - **Hallazgos**: 0 TODOs/FIXMEs en código de producción; 0 `unwrap()`/
    `expect()` en producción (los ~1.500 están todos en `#[cfg(test)]`;
    único `expect` de producción en `preview_frame.rs:1048` es seguro
    porque la clave se acaba de asignar); trabajo bloqueante correctamente
    en `spawn_blocking` (28 usos); clippy sólo warnings de estilo (111,
    cosméticos — `cargo clippy --fix` se revirtió solo por un falso
    positivo en const generics de `dialogue.rs`).
  - **Bug real encontrado y corregido**: test
    `hardware_encoder_args_match_each_api` esperaba `-preset p5` pero el
    código usa `p6` deliberadamente (comentario: «p6 = 2x más rápido que
    p5 con ~5% menos calidad»). Test desfasado, no regresión. Actualizada
    la aserción a `p6`.
  - **Verificación**: `cargo test --lib` completo → 567 passed / 49
    ignored / **1 failed** (el de arriba, ahora corregido y reverificado
    1/1 ok). `cargo check` 0 errores. Cambio sólo en `#[cfg(test)]`:
    no requiere rebuild del binario instalado.

- `[done]` **Pasada de rendimiento integral (2026-11-04)** — pedido del usuario
  («que todo vaya fluido y consuma lo mínimo»). No se tocó la UI ni el trabajo
  no confirmado del usuario.
  - **Trabajo por frame**: `totalFrames` pasó de `Math.max(...map)` a un solo
    recorrido: 10,5× más rápido con 2.500 clips (166,1 → 15,8 ms / 5.000
    llamadas) y sin desborde de pila por encima de ~150 k argumentos (test de
    regresión con 160 k clips). `durationOf` cachea la duración por identidad
    del documento, así que el store dejó de recorrer todos los clips dos veces
    por cada frame de reproducción; el clamp de `setPlayhead` sigue leyendo
    `current.project`, o sea que edita y mueve el cabezal en el mismo evento
    continúa siendo correcto.
  - **Edición**: el historial de undo guarda el documento por referencia (es
    inmutable por contrato: `applyRecipe` clona antes de entregar el borrador)
    en lugar de un segundo deep-clone completo por edición. Se midió
    `structuredClone` antes de usarlo: en este entorno es **0,63×** respecto
    de JSON, así que se conservó el clon JSON.
  - **Reproducción**: `usePlayback` emite sólo al cambiar el frame entero
    (≈ −50 % de `setState` a 60 Hz / 30 fps) y ya no reinicia el bucle rAF al
    editar; `PreviewClip` dejó de llamar `video.play()` ~30 veces/s; los
    resets de `realFrame`/`pixelPerfect` devuelven la misma referencia cuando
    ya están en su valor por defecto.
  - **Reposo**: `EffectCanvas` eliminó el rAF perpetuo a 30 fps con video
    pausado (render bajo demanda, bucle continuo sólo durante `play`, firma
    estructural del stack para no reiniciarlo con `?? []`); `App.tsx` dejó de
    re-registrar el listener global de atajos, reescribir el título y llamar
    `isMaximized()` por IPC en cada edición/frame.
  - **Binario**: `[profile.release]` con `lto = "thin"`, `codegen-units = 4`
    y `strip = "symbols"`. Se conserva `panic = "unwind"` para no convertir un
    panic de un hilo de fondo en cierre del proceso.
  - **Medición nativa (CDP, app real)**: en caliente, FCP 508 ms (antes) vs
    480–620 ms (después, dentro del ruido); 0 long tasks y 0 errores de
    consola en reposo; proceso 43,4 → 43,7 MB WS y 26,2 → 25,9 MB privados.
    Playback de 3 s sobre el mismo proyecto de 15 clips: 185 frames /
    1 lento / 0 long tasks / heap 16,5 MB (antes) vs 187 frames / 0 lentos /
    0 long tasks / heap 14,3 MB (después). El arranque **no** mejora de forma
    medible: la ganancia del perfil está en los caminos CPU-bound nativos,
    aún sin microbenchmark dedicado. Coste honesto: exe 39.373.824 →
    39.597.568 B (**+0,57 %** por el inlining de LTO) y build limpio 4 →
    7 min 20 s.
  - **Verificación**: typecheck de workspace 0; build frontend 0; pruebas
    focalizadas de los módulos tocados **121/121**; `cargo test --lib`
    **563 passed / 49 ignored / 1 flaky** (el test de servidor mock
    `xtts_adapter_receives_a_wave_from_mock_server` falla por
    `IncompleteMessage` bajo carga y pasa aislado); suite serial **2003 passed
    / 3 skipped / 13 failed**. Los 13 fallos son **previos y ajenos** a esta
    pasada, confirmados en el `git diff` del trabajo no confirmado del
    usuario: `EffectBrowser` → `ThumbnailBrowser` quitó el rol `button` del
    catálogo (EffectStudio 5, AudioEffectStack 4), `AssetsPanel` agregó un
    segundo `<main>` (App 1) y filtra por carpeta (AssetsPanel 3). No se
    marcan como verdes ni se modificó esa UI. e2e **19 passed / 1 skipped /
    4 failed**: esos 4 (`settings.spec`, `theme.spec`) buscan
    `input[type="color"]`, que el trabajo no confirmado del usuario reemplazó
    por `ColorWheel`/`ColorSwatch` (0 ocurrencias en `src`); specs desfasadas,
    misma causa previa.
  - **Entrega**: binario release compilado e instalado en
    `%LOCALAPPDATA%\Olyvia` (hash `C4B73C02…`); el anterior se resguardó en
    `%LOCALAPPDATA%\Olyvia-backups\2026-11-04\`; app abierta en modo normal.
  - `[next]` Corregir esos 4 archivos de UI (roles ARIA, `<main>` único,
    filtro por carpeta) y repetir la suite; segunda fase de CSS splitting;
    microbenchmark de un comando Rust CPU-bound para cuantificar el LTO.

- `[done]` **Ola CapCut/Filmora F1–F4** (pedido posterior del usuario):
  waveform con frecuencia real (FFmpeg `audio_peaks`, cache, semáforo 2,
  umbrales 30 min nativo / 10 min WebAudio), inspector derecho redimensionable
  persistido, preview Ajustar/Llenar sin franjas con zoom/pan persistidos y
  layout compacto (gaps 8/6, tabs y headers 34). Verificación: typecheck 0,
  build 0, suite serial **1944 passed / 3 skipped**, Rust **550 passed**, e2e
  **22 passed / 1 skipped**, visual 0 errores/0 overflow. Matriz de paridad y
  lo no replicable (stock/música/efectos propietarios, AI cloud, colaboración)
  en `.tmp-redesign/capcut/MATRIZ-PARIDAD.md`; P1 restante (proxies, LUTs
  `.cube`, Trimmer, grabación de voz, OAuth, biblioteca propia) documentado.
- `[next]` Ola CapCut P1 si el usuario la pide (proxies/LUTs/Trimmer/voz/
  publicación/biblioteca) + verificación nativa final de F1–F4 (onda real en
  la app instalada y métricas CDP post-cambios).
- `[next]` Firma de código real OV/EV + secrets y updater real (externos,
  documentados en `RELEASE.md` y `FOLLOW-UPS.md` §5).

## Ola 2 «hazlo todo» (2026-11-03) — `done` con verificación

Detalle completo en `docs/PREMIUM-REDESIGN-RESULT.md` §6.5. Resumen de lo
cerrado en esta ola (todo con evidencia y sin romper contratos):

- `[done]` **Rendimiento medido**: CDP nativo de WebView2 sobre la app instalada
  (arranque/FCP/timeline), CSS splitting (`styles/entries/`), manualChunks
  (`vite.config.ts`) y limpieza de los 127 `!important` muertos de
  `resolve-theme.css` (152→25). CSS crítico −19,7 %; `main` JS −19 %; FCP
  editor/proyectos −20..−44 ms; 33 vistas pixel-idénticas.
- `[done]` **Timeline pro**: rAF coalescing, virtualización (↓82–84 % DOM en
  proyecto largo; stress 24 pistas), ripple real, multi-selección, snap a
  escenas/beats, minimapa, `React.memo` de clips (p95 66→50 ms) y Ripple en
  Ajustes→Editor.
- `[done]` **Tema claro nativo «Claro neutro»** (34 tokens AA) + e2e/tests y
  deuda visual de Ajustes (chips 10 px, sub-tabs 24 px).
- `[done]` **Atajos**: persistencia sólo de overrides, helpers de conflicto y
  migración del formato legado.
- `[done]` **IA**: streaming/abort real (Rust 549 passed) con fallback,
  presupuesto de tokens visible/configurable, Home contextual, búsqueda de
  proyectos en la paleta y autosave visible.
- `[done]` **Release CI** (`.github/workflows/release.yml`) + `docs/RELEASE.md`
  y criterio de firma real documentado. **Bloqueo externo**: certificado OV/EV.
- `[done]` **Estabilización de tests** bajo carga (timeouts explícitos en
  `App.test` para chunks lazy) y exclusión de worktrees de `.git` en la suite.
- Verificación de cierre: typecheck 0; build 0; suite serial **1940 passed /
  3 skipped** (219 archivos); Rust **549 passed**; e2e **22 passed / 1 skipped**;
  build nativo release + instalación firmada en la PC y app abierta.
- `[next]` Ola CapCut/Filmora (pedido posterior): waveform de frecuencia real,
  inspector redimensionable, preview fit/fill/zoom, layout compacto y matriz de
  paridad (`.tmp-redesign/capcut/PLAN-IMPLEMENTACION.md`).

## Lote rediseño premium + honestidad funcional (2026-11-03) — `done` con verificación

Detalle completo en `docs/PREMIUM-REDESIGN-RESULT.md`; contrato visual en
`docs/PREMIUM-REDESIGN-SPEC.md`; auditoría funcional en
`docs/APP-FEATURE-AUDIT.md`; pendientes en `docs/FOLLOW-UPS.md` y
`docs/PREMIUM-POLISH-SPEC.md`.

- `[done]` **Capa premium nueva** `apps/desktop/src/styles/premium/*` (tokens,
  base, componentes, shell, launcher, workspace, vistas) importada al final de
  `main.tsx`, construida sobre los 34 colores de tema y el contrato de
  apariencia (radio/densidad/zoom). Shell 44/48/24, sin inline styles en el
  banner, Quiet Premium (sin gradientes en botones, sin translateY, sin glow).
- `[done]` **Neutralización en origen**: `flat.css` 608→87 líneas;
  `resolve-theme.css` 2.074→610 líneas y 1.036→152 `!important`;
  `commercial/olyvia` sin forzar superficies de contenido; fuera el ripple que
  recortaba botones. `premium/workspace.css` 1.149→16 `!important`.
- `[done]` **Launcher/shell/editor/vistas premium** con capturas antes/después
  (33 vistas 1440 y 1280, tema claro, timeline responsive).
- `[done]` **Honestidad de IA y capacidades**: modo navegador con banner en el
  flujo; Whisper sin ruta hardcodeada y con detección real; `test_provider` +
  «Probar conexión»; Fábrica rechaza guion simulado; demos muertas eliminadas
  (`demo://` = 0); modelos on-device con gate; panel MCP honesto.
- `[done]` **Documentación**: README/TUTORIAL con requisitos reales; FOLLOW-UPS
  con backend sin UI; este lote y el informe de resultado.
- Verificación de la ola: typecheck 0; build 0; Vitest serial **1869 passed /
  3 skipped**; Rust **541 passed**; Playwright **21 passed / 1 skipped**; 0
  errores de consola y 0 overflow en la verificación visual.
- `[done]` **Ola polish**: timeline customizable (densidad cómoda/compacta,
  etiquetas completas/minimal, rejilla alineada a la regla — preferencias
  persistentes en Ajustes→Editor), timeline premium (pistas/clips/regla/
  playhead/toolbar, handles al hover, fluidez sin trabajo por frame) y vistas
  más compactas/legibles (hub-tabs 24 px, chips 10 px, Home con 2 líneas).
  Verificación: typecheck 0, build 0, suite serial **1869 passed / 3 skipped**,
  e2e **21 passed / 1 skipped**, 33/33 vistas sin overflow a 1440/1280 y 0
  errores de consola. Capturas en `.tmp-redesign/polish/`.
- `[done]` **Publicación e instalación (pedido del usuario)**: push de la ola a
  https://github.com/Ezequiell-26/editor-ia (`main` = `8c4851c`, merge del README
  remoto resuelto conservando «Requisitos reales» y capturas nuevas) y rebuild
  nativo con polish (`target-polish`, NSIS firmado) instalado en la PC con la
  app abierta (0.2.0, exe 38.971.360 B). La verificación visual nativa
  post-instalación queda para el agente de QA; el runtime de IA/transcripción
  nativo sigue en el checklist de `FOLLOW-UPS.md`.

## Estado verificado en código (2026-10-28 18:49, última vuelta)

- **Frontend**: `npm run typecheck` verde; suite raíz **1361/1361 en 166
  archivos**; suite de escritorio **961/961 en 140**.
- **Rust**: **450 passed + 47 ignored**, incluidos 7 tests de licencia/prueba.
- **Instalador Fase 4 (no instalado)**: **222.329.952 B**, SHA-256
  `9D3EDD323160F2A97893774C4DA2BDF0879844DB80D2D3765F08C50F76FAE3A1`,
  Authenticode **Valid** con certificado autofirmado. Ejecutable de release
  **37.078.528 B**, SHA-256
  `3DEB7E45DA982F0420E7264B3CEA470CBFBCC994BF75164F1E921312644EACBC`
  (sin firmar en `target`).
- **Sigue instalada la build anterior**: instalador **275.462.336 B**, exe
  **103.720.928 B**, PID **28496**. No se reemplazó para no cerrar la sesión
  abierta.
- **Sin** commit ni push.

## Lote cerebro de edición (2026-11-01)

Detalle en `docs/EDIT-BRAIN.md`.

- `[done]` **Capa de decisión determinista** — `state/brain/`: análisis de la timeline
  completa (ASL, huecos, gancho, cobertura de subtítulos, repetición de material), nueve
  políticas independientes y plan ordenado por impacto × confianza. **13 tests**.
- `[done]` **Ejecución sobre primitivas existentes** — `apply.ts` llama a `closeGaps`,
  `splitClipAtFrames`, `deleteClip`, `applyTransitionToCuts` y `updateAudioMix`; no
  reimplementa edición. Una propuesta sin operación disponible se marca como
  recomendación manual en vez de fingir que se aplica.
- `[done]` **Brief para la IA** — el asistente ahora recibe el plan medido antes del JSON
  del proyecto (`assistant.rs` lo antepone como texto). Antes el contexto eran cinco
  campos y el modelo opinaba a ciegas. **1 test de integración** sobre el request real.
- `[done]` **UI** — modo «Cerebro» dentro del Editor: salud 0–100, métricas, hallazgos y
  propuestas con Aplicar/Descartar y "Aplicar lo seguro". **5 tests**.
- `[done]` **Cortes en el pulso** — `beatPolicy` recibe una grilla (`BeatGrid`) que la UI
  arma con `detectBeats` + `planBeatCuts`; con confianza ≥ 0,4 parte los planos largos
  sobre beats y apaga el corte por tiempo. Métrica «Cortes en beat» y botón
  «Detectar beats» en el panel. **3 tests** (incluye el caso de grilla poco confiable).
- `[done]` **Guion y narración** — `analyzeScript` + cinco reglas: escenas sin material,
  sin narración, narración demasiado rápida o lenta y subtítulos ilegibles. Son
  recomendaciones sin payload y penalizan el score. **3 tests**.
- `[done]` El cerebro ya reordena escenas: `sceneOrderPolicy` propone
  `script:scene-order` cuando el orden del guion difiere del orden de los
  clips en la timeline (ver entrada 2026-11-07 arriba). La reescritura de
  texto existe como normalización mecánica de subtítulos, `caption-text`.
- `[done]` **Cortes existentes al pulso (2026-11-07)** — el cerebro ya no sólo crea
  cortes sobre beats (`beatPolicy`): la política nueva `beatAlignPolicy` propone un
  **roll** (`rollClip`, primitivas existentes) que mueve cada corte contiguo al beat
  más cercano cuando el corrimiento es chico (3 frames a ~80 ms de tolerancia hasta
  `min(medio pulso, 0,25 s)`) y la ventana de fuente lo permite. La política replica
  los guardas de `trimGuards`/`rollClip` (velocidad 1×, sin keyframes/stabilización,
  pista desbloqueada, vecino real del roll, `outFrame+delta <= duración medida`,
  `inFrame+delta >= 0`) para no proponer lo que va a fallar; el payload `roll` quedó
  aplicable en `applyProposal` (antes `trim`/`roll` eran stubs honestos). Riesgo
  `moderate`: entra en «Aplicar» pero no en «Aplicar lo seguro». Tope de 6 propuestas
  por plan, ordenadas por |delta|.
  - **Archivos**: `state/brain/policies.ts`, `types.ts` (`beat-align` + payload
    `roll`), `apply.ts`, `brain.test.ts`.
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest dirigido
    `state/brain` + `features/brain` + `project-actions` **128/128** (4 tests nuevos:
    roll al beat, corte ya alineado, sin ventana de fuente, confianza baja).
  - **Pendiente honesto**: `npm run verify` completo no se corrió (la suite serial
    arrastra ~13 fallos preexistentes documentados arriba); la evidencia es el
    typecheck + los módulos tocados.

## Lote efectos declarativos (2026-11-01)

Referencia: auditoría de `CutWire-Studios/Drift` en `docs/DRIFT-PARITY.md`.

- `[done]` **Motor de efectos** — paquete nuevo `@editor-ia/effect-kit` (MIT):
  manifiesto, parámetros tipados con grupos, stack ordenado, registro con
  búsqueda, compilador a FFmpeg y renderer WebGL2 multipaso. **22 tests**.
- `[done]` **Catálogo propio** — **48 efectos** de video y **22 transiciones**,
  sin copiar código GPL de Drift. El test de integridad verifica que cada
  parámetro tenga su uniform y que toda receta compile sin marcadores sin
  resolver.
- `[done]` **`clip.effects.stack`** — campo opcional y retrocompatible en el
  schema; JSON Schema regenerado; **4 tests** nuevos en `effects.test.ts`.
- `[done]` **Export** — `effect_recipes.rs` generado desde el catálogo
  (`npm run effects:codegen`) y `apply_effect_stack` en el renderer nativo.
  **4 tests de Rust** en verde.
- `[done]` **UI** — `EffectStudio` en la vista VFX: catálogo con búsqueda y
  categorías, pila con reordenar/duplicar/apagar/resetear, parámetros por grupo
  y preview GPU con aviso de fidelidad de export. **5 tests**.
- `[done]` **Keyframes en la cadena de audio del export** — el `audioStack`
  ahora se renderiza segmentado igual que el video: `audio_stack_segment_plan`
  corta en los frames de keyframes (+extremos, tope 32 → fallback estático),
  `build_audio_stack_graphs` emite `asplit` + `atrim start_sample/end_sample`
  + `asetpts` + filtros con parámetros muestreados en el punto medio del
  tramo (`audio_params_at` reusa `sample_effect_track`, incluido Bézier) +
  `concat`. La cadena pre-stack cierra en `akp{input}`, el concat entrega
  `astk{input}` y todo lo demás (ganancia, EQ de pista, fades, paneo animado
  con su `channelsplit`/`join`) sigue detrás sin cambios — el `t` local del
  clip se conserva porque `concat` recompone la línea de tiempo.
  `effect_keyframe_tracks` se refactorizó en `instance_keyframe_tracks`
  compartida (video acepta cualquier receta; audio exige `audio_chain`).
  Verificado con FFmpeg real: `atrim` por samples + `concat` producen RMS
  −38 dB vs −24 dB en los dos tramos (vol 0,2 vs 1,0). UI de keyframes en el
  audioStack pendiente (la cadena es export-only; hoy se autora por datos).
  Tests: `audio_stack_*` 4/4 (+2 nuevos: grafo segmentado y cadena lineal
  sin keyframes).
- `[done]` **Importador de paquetes de terceros** (2026-11-11). `parseEffectPackage`
  en `packages/effect-kit/src/package-import.ts` acepta el manifiesto pelado o los
  envoltorios `{manifest, fragment|main.frag}` / `{effect.json, main.frag}` (un
  `.driftfx` puede venir como JSON único); valida estructura (id namespaced a
  `custom.*`, categoría/kind del enum, params por tipo con rangos, `gpu.passes`
  1–8), recetas `ffmpeg`/`audio` y el **filtro de shaders**: exige `void main()`,
  prohíbe `#version`/`#extension`/`#include`/`while`/`for(;;)` y limita tamaños
  (64 kB shader, 256 kB paquete). Los manifests válidos se registran con
  `registerCustomEffects`/`clearCustomEffects`/`customEffectIds` en
  `effect-kit/src/index.ts` (registry delegante que se reconstruye sin perder
  la referencia); ids duplicados se ignoran y nunca pisan el catálogo.
  Persistencia en `apps/desktop/src/state/custom-effects.ts`
  (localStorage `editor-ia.custom-effects.v1`, storage inyectable) y UI en
  `EffectBrowser`: botón «Importar» (JSON), badge «Terceros» (`new`) en las
  tarjetas y aviso de éxito/error. **Límite honesto**: la validación de shader
  es estática — no es un sandbox; el código GLSL corre en el mismo contexto
  WebGL del preview, así que un shader malicioso podría abusar de la GPU
  (los bucles infinitos obvios están bloqueados, no toda la superficie).
  Verificación: `package-import.test.ts` 8/8, `custom-effects.test.ts` 4/4,
  `tsc` limpio en effect-kit y desktop (los errores de `engine.test.ts` son
  drift preexistente del WIP de `motion/`, no de este cambio).
- **Verificación**: `npm run typecheck` verde en los 4 proyectos; `vite build`
  OK (chunk `VfxView` 100,55 kB); suite de escritorio 1070/1074 (las 3 fallas
  de `LottiePanel` vienen del WIP previo en `motion/`, comprobado con `git
  stash`; la de `EmojiPicker.focus` pasa al reintentar).

## Corte sin recodificar (2026-11-03)

Aprendido de LosslessCut (MIT): para sacar un rango no hace falta renderizar.

- `[done]` **`export_lossless`** — `commands/lossless.rs`: `ffmpeg -ss -to -c copy` sobre el archivo
  original. Devuelve duración real, bytes y **corrimiento por keyframe**, en vez de fingir precisión
  al milisegundo.
- `[done]` **Herramienta MCP** — `export_lossless` en el catálogo, disponible desde el asistente y
  desde una IA externa.
- `[done]` **UI** — botón en el inspector de medios con inicio/fin y aviso del keyframe.
  Ya implementado en `LosslessCutCard` (montada en `Inspector.tsx`, inicio/fin,
  aviso de corrimiento por keyframe, modo exacto, capítulos y audio); verificado
  2026-11-07.
- **Verificación**: Rust `commands::lossless` **2** (rango válido/invertido); `mcp-tools` **20**.
  Suite **1738** verde.

## Plugins (2026-11-02)

- `[done]` **Gestor** — `commands/plugins.rs`: un plugin es una carpeta con `plugin.json`
  (id, nombre, versión, autor, presets y comandos). Se instala copiándola al directorio de datos,
  se activa/desactiva y se quita; los oficiales viven en `resources/plugins` y no se borran.
  Ids validados (minúsculas, números, guiones, puntos): nada de rutas.
- `[done]` **Manifiesto declarativo** — sin ejecución de código de terceros: el plugin describe
  presets (efectos, perfiles, estilos) y comandos con pasos en lenguaje del operador. Un plugin no
  puede leer archivos ni tocar la red.
- `[done]` **UI** — Ajustes → Plugins: instalar desde carpeta, lista con insignia «oficial»,
  activar/desactivar y quitar.
- `[done]` **Plugin oficial de ejemplo** — `limpieza-rapida` con dos comandos.
- `[partial]` **Ejecutar comandos** — los comandos de plugin ya se disparaban por
  `olyvia:run-command` hacia el `AssistantDock`, pero sin respuesta visible en Ajustes.
  Se agregó `detail.onResult` al evento: el dock devuelve la respuesta del operador
  (éxito o error) y `PluginsCard` muestra «Ejecutando…» y el resultado inline por
  comando. Se conserva el puente por compatibilidad en vez de extraer el ejecutor a
  un módulo compartido (su closure depende de ~30 referencias del store).
- `[done]` **Aplicar presets de plugin** (2026-11-07) — contrato definido y
  aplicación real, en una pasada del protocolo del loop (Devin CLI).
  - **Contrato** (`state/plugin-presets.ts`, documentado en la cabecera):
    `presets.effects[]` = documentos `olyvia-effect-template` v1 (el formato
    que ya exporta el panel de plantillas); `presets.exportProfiles[]` =
    `RenderProfile` del schema del proyecto **sin `id`**; `presets.captionStyles[]`
    = `CaptionStyle` **sin `id`** (los ids uuid v4 sólo los genera la app).
    Cada entrada inválida se informa con su motivo y no impide aplicar las
    demás; la UI cuenta válidos e inválidos.
  - **Aplicación**: las plantillas de efectos se importan a la biblioteca del
    usuario (`saveEffectTemplate`, misma persistencia que el panel); los
    perfiles se agregan a `project.renderProfiles` y los estilos a
    `project.captions.styles`, ambos con id nuevo y deduplicación por nombre
    (dentro del lote y contra el proyecto; un nombre repetido se salta, no
    se duplica). `effect-templates.ts` expone `parseEffectTemplateValue`
    para validar el documento ya parseado (el archivo delega en él).
  - **UI**: `PluginsCard` muestra el bloque «Presets» por extensión con un
    botón por grupo. Los presets de proyecto se deshabilitan sin proyecto
    abierto (con `title` explicativo); el resultado se informa inline o como
    notice con agregados/ya-existentes/inválidos.
  - **Límite honesto**: ningún plugin oficial declara presets todavía, así
    que el camino está probado por tests pero no ejercitado por una
    extensión real; el preset de efectos importa a la biblioteca, no aplica
    directo al clip (la normalización de `effectId` desconocidos ocurre al
    usar la plantilla, como siempre).
  - **Archivos**: `state/plugin-presets.ts` (nuevo), `state/plugin-presets.test.ts`
    (nuevo, 10 tests), `state/effect-templates.ts` (+función exportada),
    `features/settings/PluginsCard.tsx` (+bloque Presets).
  - **Verificación**: `tsc --noEmit -p apps/desktop` 0 · vitest
    `plugin-presets` **10/10** + `effect-templates` **7/7** + `PluginsCard`
    **5/5** = **22/22**. No se corrió la suite serial completa.
- **Verificación**: Rust `commands::plugins` **3** (ids seguros, manifiesto válido, id inválido);
  `PluginsCard.test` **5** (listado, activar, instalar, puente, respuesta inline).
  Suite **1736** verde.

## Timeline: alto y plegado por pista (2026-11-02)

- `[done]` **Alto por pista** — asa en el borde inferior de cada fila (28–140 px), doble clic
  restablece el valor por defecto. Se guarda por id de pista en `localStorage`.
- `[done]` **Plegar pistas** — botón de chevron en la cabecera: deja la fila en 28 px y oculta el
  carril sin borrar clips. Persistido; sirve para trabajar con muchas pistas en pantalla chica.
- **Verificación**: `Timeline.test` **12** (incluye plegado, persistencia y arrastre del asa).
  Typecheck verde.
- Patrones tomados de editores MIT tipo OpenCut/Etro: altura por pista, plegado y persistencia de
  la vista local, sin servidor.

## Timeline redimensionable y arrastre corregido (2026-11-02)

- `[fixed]` **El clip volvía a su lugar** — `magneticMoveClip` cerraba los huecos de la pista de
  destino, y eso arrastraba el clip recién soltado junto a su vecino. Ahora respeta el frame donde
  se suelta; compactar es una acción aparte («cerrar huecos»). El test que consagraba el bug se
  actualizó.
- `[done]` **Alto redimensionable** — asa en la parte superior de la timeline: arrastrar cambia el
  alto (140–720 px), `Home`/`End` van a los extremos, flechas ±24 px, doble clic restablece 280.
  Se guarda en `localStorage` y se aplica con la variable `--timeline-height` en `.editor-grid`.
- **Verificación**: `Timeline.test` **10** (incluye alto y persistencia); `project-actions.test`
  **98** con la nueva expectativa de arrastre. Typecheck verde.

## Perfiles y proxy por cuenta de Flow (2026-11-02)

- `[done]` **Proxy por cuenta** — parche al MCP (`src/proxy-store.ts`): lee `proxies.json` del
  directorio de datos y agrega `--proxy-server=<url>` al lanzar Chrome para esa cuenta. Sin proxy,
  conexión directa. El MCP es MIT; el parche hay que reaplicarlo si se actualiza el repo.
- `[done]` **Comandos en la app** — `get_flow_proxies` / `set_flow_proxy` escriben ese archivo con
  validación de esquema (`http`, `https`, `socks5`) y sin espacios.
- `[done]` **UI** — panel Flow: un campo de proxy por cuenta conectada; se guarda al salir del campo
  y avisa que se aplica la próxima vez que la cuenta abra el navegador.
- **Verificación**: Rust `commands::flow_profiles` **2**; prueba real del `proxy-store` compilado
  (válido, sin esquema, sin entrada, ftp rechazado); typecheck verde.
- `[pending]` **Fingerprint spoofing** (canvas/WebGL/UA): no se implementa. Es evasión de detección
  de la plataforma, no aislamiento.

## Cuentas múltiples de Google Flow (2026-11-02)

- `[done]` **Rotación** — `state/flow-accounts.ts`: lee `flow_list_accounts`, normaliza las cuentas
  conectadas y rota **sólo ante fallos de créditos** (texto o código). Un error de UI, red o
  política no rota: cambiar de cuenta no lo arregla.
- `[done]` **Panel Flow** — selector de cuenta y casilla «Si se agotan los créditos, probar con otra
  cuenta» (activa por defecto). Al generar, prueba la elegida y sigue con las demás; informa qué
  cuenta usó y qué falló en cada una.
- `[done]` **Fábrica** — la generación por escena usa la misma rotación y recuerda la última cuenta
  que funcionó, para no volver a la agotada en la escena siguiente.
- `[done]` **Cola continua con rotación de cuentas Flow (2026-11-07)** —
  `FlowQueueProvider` ya no usa siempre la cuenta predeterminada. Al arrancar
  la corrida consulta `flow_list_accounts`; con dos o más cuentas conectadas
  cada imagen pasa por `generateWithRotation` (misma política que el panel y
  la fábrica: sólo rota ante fallos de créditos, una pasada por cuenta, sin
  ciclos) y recuerda la última cuenta que funcionó para el ítem siguiente.
  Sin listado o con una sola cuenta, la llamada queda idéntica a antes. El
  chequeo global de `flow_status` se saltea sólo cuando hay rotación (reporta
  la cuenta de la sesión, no cada perfil; el agotamiento total lo cortan los
  errores seguidos).
  - **Archivos**: `state/FlowQueueProvider.tsx`,
    `features/mcp/FlowQueueCard.test.tsx` (+1 test).
  - **Verificación**: FlowQueueCard **4/4** (el test nuevo prueba
    `acc-a` sin créditos → `acc-b` genera y la cola completa) ·
    flow-queue **12/12** · flow-accounts **12/12** · McpView/Compress/Sharpen
    **21/21** · `tsc --noEmit` 0.
- **Verificación**: `flow-accounts.test` **12** (parseo, detección de créditos, orden, rotación,
  corte ante errores ajenos); `flow.test` **6**. Typecheck verde.

## Integración Google Flow MCP (miyakejima) (2026-11-02)

- `[done]` **Preset** — MCP → «Agregar servidor» → «Preset: Google Flow»: precarga `node` +
  `dist/index.js` para el repo `miyakejima/google-flow-mcp`. El servidor es stdio local y necesita
  `npm ci && npm run build` antes de apuntarlo.
- `[done]` **Compatibilidad de dialectos** — `buildFlowArgs` en `state/flow.ts`: si conoce el
  `inputSchema` manda exactamente lo que declara; si no, manda el superconjunto. Cubre las dos
  familias: `ratio`/`output_folder`/`auto_confirm`/`duration` y
  `aspectRatio`/`outputDirectory`/`confirmCreditSpend`/`durationSeconds`. Se usa en el panel Flow,
  la cola de generación continua y la fábrica.
- **Verificación**: `flow.test` **4** (dialecto nuevo, dialecto viejo, superconjunto, sin créditos).
  Typecheck verde. La ejecución real del servidor no se probó: requiere Chromium, extensión y una
  cuenta de Google con Flow.

## Lote servidor MCP (2026-11-02)

La app ya era cliente de MCP; ahora también es **servidor**: una IA externa puede manejarla.

- `[done]` **Transporte** — `commands/mcp_server.rs`: HTTP en `127.0.0.1:0` (puerto aleatorio) con
  JSON-RPC 2.0 en `POST /mcp`. Token nuevo por arranque, obligatorio en
  `Authorization: Bearer`; sin token responde 401. Límites de headers y cuerpo.
- `[done]` **Herramientas (50)** — `state/mcp-catalog.ts` es la fuente única de `tools/list` (el
  servidor Rust la pide a la ventana); `state/mcp-tools.ts` ejecuta cada una con la misma primitiva
  que la UI, y todo cambio pasa por `store.update` (queda en el historial):
  - Lectura: `app_status`, `project_summary`, `timeline_clips`, `captions_list`, `assets_list`,
    `tracks_list`, `export_profiles`, `critic_run`, `markers_list`, `settings_get`, `review_build`.
  - Proyecto: `project_new`, `project_open`, `project_save`, `project_save_as`, `project_close`,
    `undo`, `redo`, `package_project`.
  - Medios: `asset_import` (rutas del disco), `asset_remove`.
  - Pistas: `track_add`, `track_update`, `track_delete`.
  - Clips: `clip_add`, `clip_update`, `clip_move`, `clip_split`, `clip_delete`, `clip_effects`.
  - Subtítulos, audio y marcadores: `caption_add/update/delete`, `diarize`, `audio_mix`,
    `marker_add`, `marker_delete`.
  - Operación: `run_automation`, `critic_fix`, `review_apply`, `export_render`,
    `export_interchange`, `navigate`, `playhead`, `run_command`, `settings_set`,
    `settings_set_tools` (rutas de FFmpeg).
  - Flujos compuestos: `multicam_build` (corte por voz o dado), `factory_run` (brief → video),
    `caption_style_update`.
- `[done]` **Acceso** — comando local «servidor mcp» / «conectar una IA»: arranca el servidor y
  devuelve el bloque JSON listo para Claude Desktop o Cursor.
- **Verificación**: Rust `commands::mcp_server` **3** (catálogo de respaldo, headers, errores);
  `mcp-tools.test` **17** (catálogo, resumen, listas, edición, subtítulos CRUD, pistas y clips,
  velocidad, audio/crítico, marcadores, ajustes, revisión, multicámara, estilo, rutas de
  herramientas, cabezal, automatización, navegar/operador, errores). Typecheck y `cargo check`
  verdes.
- **Límite declarado**: el servidor vive mientras la app está abierta y sólo escucha en loopback.
  Un cliente externo puede ejecutar cualquier comando del operador con los permisos del usuario:
  el token es la única barrera, así que no se comparte.

## Lote crítico de edición (2026-11-02)

La inteligencia dejó de ser sólo «proponer»: ahora también **evalúa** la edición terminada.

- `[done]` **Motor** — `state/timeline-critic.ts` con 7 reglas medibles: aire al inicio, huecos
  entre clips de audio, dispersión de duración de planos, velocidad de subtítulos (CPS),
  loudness ausente, planos de más de 12 s y flashes de menos de 6 frames. Cada hallazgo tiene
  severidad y puntaje 100 − descuentos.
- `[done]` **Arreglos seguros** — sólo tres tocan la timeline: recorte global del inicio
  (`trimTimelineStart`, nuevo: mueve clips, subtítulos y marcadores), cierre de huecos por pista y
  objetivo de loudness. El resto son avisos: no hay botón que adivine.
- `[done]` **UI** — Editar → «Criticar edición…»: puntaje, hallazgos con severidad, casilla sólo
  en los arreglables y «Aplicar N arreglos».
- **Verificación**: `timeline-critic.test` **8** (aire, huecos, dispersión, CPS, loudness, planos
  largos, flashes, edición sana en 100, sin aceptados no toca nada); `CriticDialog.test` **3**.
  Typecheck verde.

## Lote hablantes con API propia (2026-11-02)

La diarización no se resolvió con un modelo embebido: la persona conecta su API.

- `[done]` **Modelo** — `CaptionCueSchema.speaker` opcional (40 caracteres). Compatible hacia
  atrás: los proyectos viejos validan igual.
- `[done]` **Mapeo** — `state/speakers.ts`: cada cue toma el hablante con **mayor solapamiento**;
  identificadores numéricos (Deepgram) y de letra (AssemblyAI) se traducen a «Hablante N»; prefijo
  opcional en el texto; sin tramos no se toca nada.
- `[done]` **Backend** — `commands/diarize.rs`: `get/save_diarize_provider` con la clave en el
  almacén de Windows (nunca en los ajustes ni en el proyecto) y `diarize_audio` con dos
  adaptadores: Deepgram (una petición binaria) y AssemblyAI (subida + trabajo + sondeo). Parsers
  puros con tests; sin clave no se inventa nada.
- `[done]` **UI** — Inspector → Audio → «Hablantes»: proveedor, idioma, URL base opcional, clave,
  prefijo y «Etiquetar hablantes».
- **Verificación**: `speakers.test` **7**; Rust `commands::diarize` **3** (parsers); typecheck y
  `cargo check` verdes. La llamada HTTP real no se probó: requiere clave del usuario.
- **Límite declarado**: la app no valida el plan ni el costo del proveedor; la clave y el consumo
  son de la persona.

## Lote cola por carpeta (2026-11-02)

El bloqueo era `write_project_variant`: exigía `state.require_session()` y espejaba assets desde la
raíz de la sesión. Se resolvió con dos comandos que no dependen de la sesión.

- `[done]` **Backend** — `copy_media_into` copia el material externo a `media/` de la entrega con
  nombres seguros y sin pisar archivos; `write_project_file` valida y escribe el proyecto en una
  carpeta absoluta. `render_project_variant` ya era independiente de la sesión.
- `[done]` **Motor** — `state/folder-queue.ts`: escanea la carpeta, filtra videos, prueba cada
  archivo, copia, arma un proyecto con ruta relativa, mide picos por ruta (`audio_peaks_path`),
  limpia con el perfil adaptativo, escribe, renderiza y verifica duración. Un fallo no cancela el
  resto.
- `[done]` **UI** — Producción → «Procesar una carpeta»: entrada, entrega y resultados por archivo.
  No abre ni modifica el proyecto actual.
- **Verificación**: `folder-queue.test` **4** (dos videos, sin pista de video, render fallido que
  no frena la cola, carpeta vacía). Typecheck y `cargo check` verdes.
- `[pending]` **Diarización**: requiere un modelo de embeddings de hablante (sherpa-onnx o
  pyannote) en el backend. Etiquetar hablantes por pausas sería inventar.
- `[done]` **Tarjeta de título** — `state/auto-title.ts`: usa el **nombre del proyecto** como
  título (no la primera frase, que produce «Hola, ¿cómo están?») y la primera frase de los
  subtítulos como subtítulo. Menú Editar → «Agregar tarjeta de título». `auto-title.test`: **4**.

## Lote calidad visual con VMAF (2026-11-02)

- `[done]` **Puerta de calidad opcional** — `runAutoPilot({ qualityCheck: true })`: elige el perfil
  de referencia con el CRF más bajo (más calidad), renderiza la referencia, mide VMAF contra la
  entrega y, si queda por debajo de 93, **clona el perfil con CRF −4**, reescribe, reexporta y
  vuelve a medir una vez. El reporte incluye `quality.vmaf`, `referenceProfileId` y
  `adjustedProfileId`; el resumen muestra `VMAF 95`.
- **Costo declarado**: la puerta viene **apagada** porque suma un render de referencia (y otro más
  si corrige). Activarla es una decisión de tiempo, no de calidad.
- **Límite**: si el perfil elegido usa bitrate objetivo en vez de CRF, no hay perfil que ajustar y
  la puerta se saltea; se informa `vmaf` igual si hay referencia.
- **Verificación**: `auto-pilot.test` **11** (3 nuevos: verificación sin corrección, corrección con
  reexporta, sin gasto extra si no se pide). Typecheck verde.

## Lote multicámara automática y perfil por formato (2026-11-02)

- `[done]` **Corte por voz en multicámara** — `autoCutByActivity` en `features/multicam/multicam.ts`:
  compara las envolventes de audio de las cámaras en el tiempo del programa y elige la que suena.
  Guardias: plano mínimo 1,2 s, histéresis 1,25 y umbral de silencio 0,08 (en silencio no cambia).
  Botón «Auto-cortar por voz» en la vista; los cortes quedan en la lista para revisarlos antes de
  montar.
- `[done]` **Perfil de export por formato** — `state/render-profile.ts`: elige el perfil cuyo
  `aspectRatio` coincide con el proyecto (16:9, 9:16, 1:1), cae al perfil nativo y después al
  primero. Lo usan el piloto automático y el diálogo de exportación.
- **Verificación**: `multicam.test` **13** (5 nuevos: cambio y vuelta, silencio, histéresis, plano
  mínimo, sin envolventes); `render-profile.test` **4**; `auto-pilot.test` **8**. Typecheck verde.

## Lote revisión por ítem (2026-11-02)

La automatización se aceptaba entera o se deshacía entera. Ahora se puede auditar.

- `[done]` **Motor** — `state/review-queue.ts`: arma ítems independientes (cada silencio, cada
  pausa, el ruido por clip, el zoom por clip y el nivelado global) con tramos **relativos al
  clip**, así un corte previo no invalida los siguientes. Aplica primero los ajustes por clip y
  al final los cortes, porque un corte cambia los ids de las piezas.
- `[done]` **UI** — Editar → «Revisar automatización…» abre un diálogo con la lista agrupada,
  casillas por ítem y por grupo, y el resumen de lo que se va a aplicar. Nada se toca hasta
  confirmar.
- `[done]` **Completado de `auto_pilot`** — el operador y el tipo ya tenían la acción, pero no
  tenía ejecutor: el typecheck fallaba. Ahora el dock corre el piloto (guardar → medir → limpiar
  → exportar → verificar) y Rust la valida para el modelo.
- **Verificación**:
  - `review-queue.test`: **6** (ítems, sin silencios, sólo cortes aceptados, ruido+nivel sin
    cortar, vacío, resumen).
  - `ReviewDialog.test`: **2** (aplicar lo aceptado; desmarcar un grupo no lo aplica).
  - `operator.test` + `ai-hub`: **39** en el lote. Rust `commands::assistant`: **7/7**.
  - Typecheck verde en 4 proyectos.

## Lote piloto automático y nivel 5 (2026-11-02)

Cierra los dos huecos que impedían hablar de nivel 5: parámetros elegidos por una persona y
entrega sin verificación.

- `[done]` **Perfil adaptativo** — `state/adaptive.ts`: piso de ruido (percentil 10 de los picos),
  voz (percentil 90), SNR; de ahí salen umbral de silencio (piso + 6 dB), nivel de denoise
  (SNR ≥ 30 suave, ≥ 18 medio, si no fuerte), zoom según plano mediano (<2 s 5 %, ≤5 s 8 %,
  si no 12 %) y LUFS objetivo. Sin picos medibles devuelve un perfil conservador **explícito**.
- `[done]` **Piloto automático** — `state/auto-pilot.ts`: mide → limpia con ese perfil → agrega
  perfiles de entrega si faltan → escribe el proyecto → renderiza → **sondea el MP4** y compara
  duración contra la timeline y pistas presentes. Si algo no cuadra, `verified: false` y
  `warnings`; no dice «listo» por decir.
- `[done]` **Acceso** — Editar → «Piloto automático: limpiar y exportar» (escribe en
  `<raíz>/entregas`) y «Entrega automática cada 10 min»: mientras está activa, si la revisión del
  proyecto cambió, guarda y vuelve a entregar sin intervención.
- **Verificación**:
  - `adaptive.test`: **6** (estudio silencioso, ruido moderado, mucho ruido, sin picos, zoom por
    plano, resumen).
  - `auto-pilot.test`: **6** (camino feliz con verificación, duración que no coincide, MP4 sin
    audio, perfiles agregados, sin picos, resumen).
  - Typecheck verde en 4 proyectos.
- `[done]` **Lazo cerrado de loudness** — `measure_file_loudness` (nuevo comando) mide el MP4 con
  `loudnorm=print_format=json`; el piloto compara con el objetivo y, si está a más de 1 LU,
  corrige `masterGainDb`, reescribe y reexporta **una vez**. El reporte dice la corrección.
- `[done]` **Base para la carpeta** — `audio_peaks_path` (picos de un archivo sin proyecto) y
  `measure_file_loudness` ya existen y están registrados.
- `[done]` **Disparador por carpeta** (verificado 2026-11-08): el hueco se
  cerró con comandos sin sesión — `write_project_file` escribe el proyecto
  validado sin `require_session` (el material ya está copiado al lado, ver
  `commands/variants.rs`) y `render_project_variant` abre el `.editoria.json`
  desde disco y renderiza con FFmpeg. `state/folder-queue.ts` encadena
  probe → copia → proyecto → perfil adaptativo → limpieza → escritura →
  render → verificación de duración por archivo, y `FolderQueuePanel`
  (Producción) lo expone sin tocar el proyecto abierto. Tests:
  `folder-queue.test.ts` **4/4** (dos videos, sin pista de video, render
  fallido que no frena la cola, carpeta vacía).

## Lote limpieza automática (2026-11-02)

La lista de producto pedida estaba repartida en cinco pantallas. Este lote la junta en un paso.

- `[done]` **Orquestador** — `state/auto-cleanup.ts`: huecos (opcional) → silencios → pausas de
  voz → denoise en tres niveles → nivelado a −14 LUFS con limitador → zoom alternado en los
  cortes. Respeta pistas bloqueadas y no pisa un `motion` existente.
- `[done]` **Acceso** — Editar → «Limpieza automática del proyecto»; operador local («limpiá el
  video», «dejalo listo para publicar», con «sin zoom», «sin pausas», «denoise fuerte»); acción
  `auto_cleanup` para el modelo con validación de rangos en Rust.
- `[done]` **Reporte** — `autoCleanupSummary` devuelve conteos y segundos removidos; la UI y el
  asistente lo dicen tal cual.
- `[done]` **Matriz de producto** — `docs/FEATURES-CHECKLIST.md` contrasta los 11 puntos pedidos
  con el código: 9 existen, CapCut es parcial (no importa OTIO/EDL) y el envío por mail no existe
  porque la app es local.
- **Verificación**:
  - `auto-cleanup.test`: **7** (silencios, pausas, denoise+nivelado+zoom, motion previo,
    pistas bloqueadas, sin opciones, resumen).
  - `operator.test`: **30** (4 nuevos). `AssistantDock.test`: **1 nuevo** de punta a punta.
  - Rust `commands::assistant`: **7/7** con `auto_cleanup`.
  - Typecheck verde en 4 proyectos.

## Lote cortes por pausas de voz (2026-11-02)

Cierra el pendiente declarado en el lote anterior: cortar por **frases**, no por amplitud. El
detector de silencios confunde una respiración con una pausa y no sabe dónde termina una idea.

- `[done]` **Motor** — `state/speech-cuts.ts`: arma intervalos de habla con las palabras de los
  subtítulos (o con el rango del cue si no las tiene), fusiona solapamientos y recorta sólo los
  huecos ≥ `minPauseSeconds`, conservando `paddingSeconds` de aire. Guardia: si quitaría más del
  60 % del clip, el plan se rechaza.
- `[done]` **Corrimiento de subtítulos** — `removeCaptionRange` en `project-actions`: al eliminar
  un tramo, los cues posteriores se corren y los que cruzan el corte se recortan. Sin esto, cada
  corte dejaba los subtítulos atrasados respecto de la voz (afectaba también al corte de
  silencios).
- `[done]` **UI** — `SpeechCutsSection` en el Inspector (clip y pista): analiza los subtítulos
  existentes, muestra pausas y segundos, y aplica con confirmación. Si el clip no tiene
  subtítulos, lo dice y no inventa pausas.
- `[done]` **IA** — acción `cut_voice_pauses` (`selection|project`, pausa mínima y aire) en
  operador, `AssistantAction` y `clean_action`. Si el clip no tiene subtítulos, transcribe
  primero, genera los cues y corta: **un solo paso de deshacer**.
- **Verificación**:
  - `speech-cuts.test`: **12** (pausa entre frases, respiración corta, solapamientos, excesivo,
    ventana del clip, cues con y sin palabras, transcripción, aplicación con ripple y
    corrimiento de subtítulos).
  - `SpeechCutsSection.test`: **2** (sin subtítulos, análisis + aplicación).
  - `operator.test`: **27** (3 nuevos, incluida la distinción silencio/pausa).
  - `AssistantDock.test`: **2 nuevos** (cues existentes; transcripción previa).
  - Rust `commands::assistant`: **7/7**.
  - Typecheck verde en 4 proyectos.

## Lote subtítulos automáticos y legibles (2026-11-02)

El botón «Transcribir a subtítulos» existía, pero volcaba un segmento de Whisper por cue: frases
de 6–8 segundos y 15–20 palabras que no entran en dos líneas ni se leen en el tiempo que duran.
La IA tampoco podía pedirlo.

- `[done]` **Planificador** — `state/caption-planner.ts`: parte cada segmento en cues de como
  máximo `maxCharsPerLine × maxLines` (42×2 en horizontal, 32×2 en vertical), usa los tiempos de
  palabra cuando existen y reparte en proporción al texto cuando no, respeta un mínimo de 0,8 s
  sin pisar el cue siguiente y parte los tramos de más de 6 s.
- `[done]` **Honestidad sobre la velocidad** — los caracteres por segundo se **miden**, no se
  estiran: `overCps` y `maxCps` vuelven al llamador para que la UI avise. Cambiar el tiempo
  rompería la sincronización con la voz.
- `[done]` **Sin pérdida de texto** — si las palabras del transcriptor no cubren el segmento
  (Whisper devuelve a veces sólo una parte), se descartan sus tiempos y se usa el texto completo.
- `[done]` **Colocación** — en 9:16 los cues llevan `offsetY` de −8 % de la altura: la franja
  inferior pertenece a la UI de TikTok/Reels/Shorts.
- `[done]` **Integración** — `addTranscriptionCues` usa el planificador para todos los llamadores
  (Inspector, narración, asistente). El aviso del Inspector ahora informa subtítulos creados y
  cuántos superan la lectura cómoda.
- `[done]` **IA** — acción `auto_subtitles` (`selection|project`) en operador, `AssistantAction` y
  `clean_action`. Transcribe con Whisper local, planifica y agrega todo en **un solo paso de
  deshacer**. Guarda el proyecto antes (el transcriptor lee el archivo de disco) y limita a 12
  clips por pedido para no bloquear el chat.
- **Verificación**:
  - `caption-planner.test`: **10 tests** (partido, líneas, tiempos de palabra, reparto
    proporcional, mínimo, CPS, palabras incompletas, vertical).
  - `project-actions.test`: **98**, con 2 nuevos (segmento largo partido, offset vertical).
  - `operator.test`: **25**, con 2 nuevos (automático vs. manual).
  - `AssistantDock.test`: **2 nuevos** de punta a punta (transcribe y crea cues; sin audio).
  - Rust `commands::assistant`: **7/7** con la validación de `auto_subtitles`.
  - Typecheck verde en 4 proyectos.
- `[done]` **Cortar por voz** — cerrado en el lote de pausas de voz: usa los tiempos de los
  subtítulos y respeta las frases en vez de la amplitud.

## Lote corte de silencios para la app y la IA (2026-11-02)

El motor existía (`state/silence-cuts.ts` + sección del Inspector), pero sólo se podía usar
entrando al Inspector y apretando tres veces. Faltaba el acceso directo y, sobre todo, que la IA
pudiera pedirlo.

- `[done]` **Runner compartido** — `runSilenceCuts` elige candidatos (video/audio con asset, 1×,
  pista desbloqueada), pide los picos con caché por asset y aplica en lote rearmando el plan
  contra el proyecto vigente. La sección del Inspector ahora usa el mismo
  `applySilenceCutsToTargets`, así no hay dos implementaciones que se separen.
- `[done]` **Menú** — Editar → «Cortar silencios automáticamente». Con un clip seleccionado opera
  sobre él; sin selección, sobre todo el proyecto. Avisa cuántos cortes y segundos, y queda en
  el historial (Ctrl+Z).
- `[done]` **Operador local** — «cortá los silencios», «auto corte de silencio», «limpiá los
  silencios del proyecto con umbral -40, mínimo 0.5 s, colchón 0.2 s». El singular «quita el
  silencio» sigue significando desmutear: no cambió de significado.
- `[done]` **Modelo** — acción `cut_silences` con `scope` (`selection|project`) y los tres
  parámetros opcionales. `clean_action` valida y acota los rangos (-90..-10 dB, 0,05..5 s,
  0..2 s) y el prompt le indica no borrar clip por clip cuando piden limpiar pausas.
- `[done]` **Ejecución** — ambos caminos del dock (operador y modelo) llaman a la misma función;
  si no hay clip seleccionado, cae al proyecto y lo dice en la respuesta.
- **Verificación**:
  - `state/silence-cuts`: **12 tests**, incluidos 3 nuevos del runner (corte real, sin picos,
    alcance por clip y pista bloqueada).
  - `operator.test`: **23**, con 4 nuevos (defaults, parámetros, desmutear vs. cortar, clamping).
  - `AssistantDock.test`: **3 nuevos** de punta a punta (comando local, acción del modelo,
    material sin picos).
  - Rust `commands::assistant`: **7/7**, con los rangos y defaults de `cut_silences`.
  - Typecheck verde en los 4 proyectos.
- `[done]` **Brain** — el cerebro mide huecos, no silencios (no tiene picos). Una política que
  delegue en este runner cuando el hueco esté dentro de un clip con audio es el paso siguiente.
  **Resuelto 2026-11-07**: `silencePolicy` + payload `cut-spans` + botón
  «Medir silencios» en BrainPanel (entrada `[done]` de arriba).

## Lote efectos de audio (2026-11-02)

Cierra el primer pendiente de `docs/DRIFT-PARITY.md` §5: Drift tiene 30 efectos de audio y
Olyvia sólo tenía EQ/paneo/loudness por pista.

- `[done]` **Catálogo** — `packages/effect-kit/src/catalog/audio.ts`: **30 efectos** en cinco
  familias (8 espacio, 5 textura, 5 transmisión, 6 utilería, 6 voz), con parámetros tipados y
  cadena de filtros real. Categorías nuevas en `EFFECT_CATEGORIES` para que el navegador agrupe.
- `[done]` **Compilador** — `compileAudioStack` en `ffmpeg.ts`. Resuelve `%RATE%` (sample rate
  del perfil) y `%INV:<param>%` (inverso del parámetro) para que un cambio de tono conserve la
  duración. `manifestFidelity` / `manifestNote` dan a la UI una sola respuesta para video y audio.
- `[done]` **Schema** — `effects.audioStack` (máx. 32) en clips de video/imagen y
  `AudioClipEffectsSchema` en clips de audio (sólo `audioStack`; un `brightness` en un clip de
  audio se rechaza). JSON Schema regenerado: **115 líneas** nuevas.
- `[done]` **Render** — `audio_chain` en la tabla generada (**70 recetas: 40 de video + 30 de
  audio**) y `apply_audio_effect_stack` dentro de `audio_filter`, después de los presets de voz
  y antes del fader.
- `[done]` **UI** — `AudioEffectStack` en el Inspector → Audio del clip: catálogo filtrado,
  pila con reordenar/duplicar/apagar, fidelidad y cadena compilada visible.
- **Verificación**:
  - Las **30 cadenas** ejecutan contra el FFmpeg empaquetado sin error (`audio-live.test.ts`,
    3,3 s). Ese archivo se corre con `EDITOR_IA_RUN_AUDIO_TESTS=1`.
  - `audio.muffled` sobre un tono de 6 kHz: **−21,1 dB → −56,9 dB** (35,8 dB), medido en TS y en
    el test live de Rust `live_audio_stack_muffles_a_high_tone` (0,80 s).
  - `audio.voice_deep`: 1,000 s de entrada → 1,000 s de salida (±0,05 s).
  - `effect-kit`: **29 tests** (17 catálogo + 12 motor) + 3 live. `project-schema`: **343**.
    Suite de escritorio serial: **1563 pasan**, quedan los 3 de `LottiePanel` (WIP previo del
    usuario en `motion/`).
  - Typecheck verde en los 4 proyectos. `npm run build` en 9,81 s; el catálogo y los paneles
    comparten un chunk (`EffectStackPanel` 84,02 kB / 24,45 gzip), así que el Inspector no
    duplica la tabla.
- `[done]` **Preview Web Audio del audioStack (2026-11-08)** — la preview
  ya aplica los efectos de audio del clip que tienen equivalente Web
  Audio, con keyframes muestreados por frame. Los ~27 restantes siguen
  export-only y el panel lo declara.
  - **`features/mixer/clip-audio-fx.ts`** (nuevo): `clipAudioFxSpec`
    resuelve el `audioStack` a `{effectId, params}` numéricos —
    defaults del manifiesto + overrides + `resolveParamsAt` para
    keyframes en el frame local — y filtra a `PREVIEW_AUDIO_FX`
    (`audio.eq`, `audio.compressor`, `audio.limiter`, `audio.echo`,
    `audio.slapback`, `audio.tremolo`, `audio.chorus`, `audio.flanger`,
    `audio.phaser`, `audio.autopan`, `audio.widen`, `audio.bitcrush`,
    `audio.eightbit`, `audio.vinyl`, `audio.tape`, `audio.crystal`,
    `audio.megaphone`, `audio.muffled`, `audio.telephone`,
    `audio.underwater`, `audio.walkie`, `audio.gate`, `audio.leveler`,
    `audio.deesser`, `audio.voice_robot`, `audio.voice_wobble`,
    `audio.voice_alien`, `audio.voice_chipmunk`, `audio.voice_deep`,
    `audio.voice_vader` — **30 de 30**).
  - **`usePreviewAudio.ts`**: `ClipFxChain` inserta nodos entre el
    `MediaElementSource` y el paneo/entrada de pista
    (elemento → FX → splitter/gains de paneo → EQ de pista → fader →
    master). `audio.eq` → 2 `BiquadFilter` (lowshelf/highshelf, dB/Hz
    directos); `audio.compressor` → `DynamicsCompressorNode` + makeup en
    dB; `audio.limiter` → `DynamicsCompressorNode` con threshold
    `20*log10(limit)` y ratio 20 (aproxima `alimiter level=0`);
    `audio.echo`/`audio.slapback` → `DelayNode`+feedback con mezcla
    seca/mojada en paralelo (gain sumador como nuevo tail); `audio.tremolo`
    → `OscillatorNode`→depth→`amp.gain` (el oscilador arranca al crear la
    cadena); `audio.chorus`/`audio.flanger` → `DelayNode` con `delayTime`
    modulada por LFO (`lfoGain` barre ±depth/2 ms) + mezcla seca/mojada, y
    el flanger suma realimentación con signo (`regen` −95..95 %);
    `audio.phaser` → 4 `BiquadFilter` `allpass` en serie (centros
    300/600/1200/2400 Hz) con `frequency` modulada por LFO
    (seno/triangular según `type`, `speed` Hz) + delay corto + mezcla
    seca/mojada por `decay`; `audio.autopan` → `StereoPannerNode` con
    `pan` modulada por LFO triangular (`rate`/`depth`); `audio.widen` →
    matriz mid/side con splitter→4 gains→merger (`c = width/2`, width 2 =
    imagen original). Texturas/transmisión: `acrusher` → `WaveShaperNode`
    con curva de cuantización por `bits` + mezcla seca/mojada (`eightbit`
    suma LP ~3.8 kHz, `vinyl` suma HP/LP+peaking presencia, `walkie` suma
    banda+compresor); `audio.tape` → HP/LP + vibrato (LFO sobre
    `delayTime`) + compresor; `audio.crystal` → shaper tanh + HP `freq` +
    mezcla por `amount`/`blend`; `megaphone`/`telephone`/`muffled` →
    biquads de banda + compresor/nivel; `underwater` → LP + eco 60 ms +
    vibrato lento.
    `ensureClipFx` compara la **firma** (secuencia de effectId): si no
    cambió sólo actualiza AudioParam — las keyframes por frame no
    reconstruyen el grafo; si cambió, reconstruye y `connectSource`
    recablea. `attachPreviewAudio` acepta `clipFx` opcional (4º arg,
    retrocompatible) y `setPreviewClipFx` actualiza en caliente;
    `detachPreviewAudio` limpia la cadena.
  - **`Preview.tsx`**: ambos clips (video y audio) calculan
    `clipAudioFxSpec` en el frame local del playhead y lo pasan al
    attach + efecto `setPreviewClipFx` por render.
  - **UI honesta**: `AudioEffectStack` ya no dice «la preview reproduce
    el audio original» — declara EQ/compresor/limitador/eco/slapback/
    trémolo/coro/flanger/phaser/autopan/widen y las texturas y
    dinámica y voz con keyframes — los 30 efectos del catálogo tienen
    equivalente en preview (el pitch es granular aproximado, no
    rubberband).
  - **Tests**: `clip-audio-fx.test.ts` **6/6** (defaults+override,
    keyframes en frame 0/5/10, filtro de no-soportados/deshabilitados/
    manifests ajenos, orden de pila) · `LiveMeters.test.tsx` **22/22**
    (+test E2E de la cadena: topología elemento→FX→pista, EQ clip con
    sus Hz/gain, compresor con attack/release en segundos y makeup en
    lineal, update de params sin reconstruir nodos, rebuild al cambiar
    la secuencia, limiter con threshold `20*log10(0.5)` y ratio 20;
    `FakeAudioContext` ganó `createDynamicsCompressor`).
  - **Límite honesto**: compresor/limitador son aproximaciones
    (knee fijo 6/0, sin auto-makeup del `alimiter`); el eco es un
    `aecho` simplificado (una línea de retardo, no las multi-tap del
    original); el trémolo no tiene forma de onda distinta de seno; el
    autopan usa `StereoPannerNode` equalpower (el `apulsator` panea
    ganancias lineales sin downmix) y el phaser son 4 allpass fijas en
    vez de las etapas del `aphaser`. Además: `acrusher` no submuestrea
    en el tiempo (sólo cuantiza amplitud), `aexciter` es un shaper tanh
    + HP aproximado, el megáfono omite su excitador final y el vibrato
    de cinta/underwater es un LFO sobre una línea de retardo corta.
    Dinámica: `gate`/`leveler`/`deesser` usan un seguidor de envolvente
    (`AnalyserNode` + RMS cada ~40 ms + `setTargetAtTime`), no
    sample-exacto y la ventana `frame`/`gaussian` de dynaudnorm queda
    absorbida por el tick; el deesser es una banda HP ~3.5–8 kHz con
    ducking, no el detector de sibilancia del original. Además
    `ClipFxChain` ganó `dispose`: los LFO y seguidores se frenan al
    reconstruir o desmontar (antes los osciladores quedaban vivos —
    leak corregido). El pitch shifter es granular (2 granos Hann):
    calidad inferior a rubberband/`asetrate`, con ~85 ms de latencia
    fija por lookahead y posible artefacto en transientes. `voice_robot` → vibrato (LFO→`delayTime`) + eco
    18 ms/0.25; `voice_wobble` → UN LFO al `rate` modulando `delayTime`
    y `amp.gain` a la vez (vibrato+trémolo). Pitch real:
    `voice_alien|chipmunk|deep|vader` → `AudioWorklet` con pitch shifter
    granular (2 granos Hann al 50 %, lookahead ~85 ms, Blob URL sin
    assets; `buildPitchStage` inserta el nodo async y cae a passthrough
    seco si `addModule` falla); alien suma allpass LFO y vader LP+eco
    después del pitch, igual que sus cadenas FFmpeg. Con esto los 30
    efectos del catálogo tienen equivalente en preview.
- `[done]` **Plantillas de efecto** — `state/effect-templates.ts` guarda stacks
  nombrados en `localStorage` (`editor-ia.effect-templates.v1`) separados por
  tipo (`video`/`audio`), con reemplazo por nombre, exportación JSON portable
  (`olyvia-effect-template` v1, descarga Blob como el tema) e importación
  validada. `EffectTemplates` está en `EffectStudio` (video) y
  `AudioEffectStack` (audio): aplicar **reemplaza** el stack, regenera ids de
  instancia, normaliza params contra el manifiesto actual y descarta efectos
  que ya no existen (la UI informa cuántos se omitieron). No son las 23 de
  Drift: son plantillas del usuario, sin catálogo de fábrica.
- ~~`[pending]` **Keyframes de efecto en export**~~ **resuelto** (verificado
  2026-11-08): el export ya no usa el valor estático — `apply_effect_stack_animated`
  segmenta el stream en los frames de keyframe (video) y `audio_stack_segment_plan`
  hace lo propio con `atrim` por samples + `concat` (audio), con muestreo por la
  misma curva que la preview (incluido Bézier). Queda abierto sólo el importador
  de paquetes de terceros (línea de arriba).
- **Verificación plantillas**: `effect-templates.test` **7** (CRUD, dedupe
  por nombre+tipo, roundtrip JSON, rechazos, ids nuevos y skip de efectos
  desconocidos) + `EffectTemplates.test` **4** (guardar/aplicar, exportar,
  importar válido/corrupto, plantilla del otro tipo). vfx+audio **26/26**;
  `tsc --noEmit` 0.

## Lote velocidad (2026-10-28)

- `[done]` **Compresión x265 `faster`** — medición sintética 1080p/5 s con el
  FFmpeg empaquetado: `medium` 4,75 s · `fast` 4,35 s · **`faster` 3,41 s**
  (≈28 % menos tiempo), con tamaño final casi igual; el CRF sigue mandando.
- `[done]` **Arranque percibido** — piso del splash de **900 → 450 ms**.
- `[done]` **Precarga** — de 8 vistas a 4 (Inicio, Editor, Medios, Descargar);
  las herramientas se cargan al abrirlas.
- `[done]` **Laboratorio** — la conversión/comprisión por software también pasó
  de `medium` a `faster`; el camino de hardware AMF/NVENC/QSV ya existía en el
  Laboratorio.
- `[verified]` **Memoria** — build de release actual con **37,6–39,8 MB** de
  working set tras abrir, frente a 43,1 MB de la build anterior.
- `[verified]` **Compresión por GPU sólo donde `gpuRecommendation` la justifica**
  (codec-agnóstico: ya cubre AV1/VP9 vía `hardwareForProfile`; la sonda
  `detect_hardware` mide `av1_*`/`vp9_*` con init real y `availableHardware`
  es codec-agnóstico en ExportDialog), AV1 en export
  ya emitido por software (libsvtav1/libaom-av1, 2026-11-07), ~~carga
  diferida del catálogo de emojis~~ (**verificado 2026-11**: `EmojiPickerPopover`
  ya vive en chunk `React.lazy` con preload en hover/focus; las fuentes
  NotoColorEmoji/Twemoji son `@font-face` lazy-por-glifo y Twemoji sólo se
  referencia con `emojiStyle='open'`), ~~separación del playhead~~ (hecha:
  `usePlayheadFrame`/`useProjectPlaying` fuera del store, regresión en
  `project-store.test`), ~~sonda de hardware AV1/VP9 + UI WebM~~
  (**verificado 2026-11**: `detect_hardware` prueba `av1_*`/`vp9_*` con init
  real del encoder y `hardware_encoders` los devuelve; `availableHardware` y
  `hardwareForProfile` son codec-agnósticos en ExportDialog;
  `validate_hardware_encoder`+`choose_encoder` los emiten en el render).
- **Verificación**: Rust 450 + 47, frontend 1361/166. La build de release se
  recompiló con `custom-protocol`; el instalador no se regeneró en este lote.

## Lote Fase 4 · trial y paquete comercial (2026-10-28)

- `[done]` **Trial 14 días** cifrado y ligado a la máquina, con activación
  única, vencimiento a Free y tests.
- `[done]` **Modal de activación** con prueba, archivo firmado y estado del
  plan; la tarjeta muestra Pro/Prueba/Free y días restantes.
- `[done]` **Instalador NSIS firmado** generado; hashes y ejecutable en el
  estado verificado. Sin instalación sobre la build en uso.
- `[blocked]` **Clave Lemon Squeezy/Gumroad**: falta product ID y endpoint; el
  modal lo declara, no se finge la verificación.
- `[blocked]` **SmartScreen**: certificado autofirmado; hace falta OV/EV y
  reputación para evitar advertencias.
- `[blocked]` **Auto-updater**: sin endpoint/manifiesto firmado; el motor
  yt-dlp sí se actualiza cada 7 días.
- `[blocked]` **MSI**: sólo NSIS; el target WiX no está configurado.
- **Verificación**: typecheck, 1361/166, 961/140, Rust 450 + 47, auditoría de
  licencias OK. Detalle en [PHASE-4-COMMERCIAL.md](PHASE-4-COMMERCIAL.md).

## Lote Fase 3 · licencias Free/Pro (2026-10-28)

- `[done]` **LicenseState en Rust** — tier Free por defecto, archivo firmado
  Ed25519, copia local AES-256-GCM ligada a la máquina, activación y
  desactivación. La clave privada vive fuera del repo.
- `[done]` **Descarga gateada** — Free: 2 simultáneas, 1080p, MP4/H.264, sin
  SponsorBlock automático, sin upscale 4K. Pro: 512, 4K/8K, HEVC/AV1/HDR.
- `[done]` **Export gateado en Rust** — Free hasta 1080p H.264; H.265/4K y
  variantes de Fábrica requieren Pro.
- `[done]` **UI de licencia** — Ajustes → Licencia con estado, email, ID,
  activación por archivo y desactivación; bloqueos ProLock en Director y
  Fábrica; aviso y perfiles bloqueados en ExportDialog.
- `[done]` **Compatibilidad** — un proyecto se abre y edita igual en Free; sólo
  el export de perfiles Pro pide licencia.
- **Verificación**: Rust **449 + 47 ignored**, frontend **1361/1361 en 166**,
  escritorio **961/961 en 140**, licencia de desarrollo firmada y verificada.
  Sin build ni instalación. Detalle en [PHASE-3-LICENSING.md](PHASE-3-LICENSING.md).
- **Pendiente**: endpoint Lemon Squeezy/Gumroad, trial 14 días y emisión real
  de licencias en Fase 4.

## Lote Fase 2 · golden path y estabilidad (2026-10-28)

- `[done]` **Descarga → Auto-edit**: botón “Auto-editar” después de importar,
  con test de integración hasta el Editor automático.
- `[done]` **Short 9:16**: test de Creador que genera hook, exporta sólo
  vertical y quema subtítulos.
- `[verified]` **Fábrica**: núcleo de variantes y errores por lote cubiertos;
  falta la corrida UI con imágenes reales (documentado).
- `[done]` **Límites**: default 6, rango normal 1–8, 512 detrás de “Avanzado”
  con clamp y ayuda; tests de cola y UI.
- `[done]` **ViewErrorBoundary**: una vista que falla ya no deja la ventana en
  blanco; recuperación con reintento, Inicio y Ajustes; tests 2/2.
- `[verified]` **Recuperación**: detección automática de instantánea y
  restauración con un clic; no se auto-abre para no pisar una sesión nueva.
- `[done]` **Licencias**: `npm run audit:licenses` OK; Wav2Lip/checkpoints
  fuera del bundle; avisos de terceros agregados. eSpeak NG GPL-3.0 queda como
  blocker legal de venta.
- **Verificación**: typecheck verde; raíz **1356/1356 en 165**, escritorio
  **956/956 en 139**, revisión visual del límite 6/Avanzado. Sin build ni
  instalación. Detalle en [PHASE-2-GOLDEN-PATH.md](PHASE-2-GOLDEN-PATH.md).

## Lote Fase 1 · navegación y hubs (2026-10-28)

- `[done]` **Rail de 9 superficies** — Inicio, Descargar, Creador, Proyectos,
  Editor, Laboratorio, Producción, Aprender y Ajustes. Las herramientas
  avanzadas quedan detrás de **Más** (Guion, Medios, Texto, Multicámara,
  Mezcla, VFX, Director, Automático, Motion, Efectos).
- `[done]` **Tres workspaces** — Ingesta / Creador / Studio; la píldora sigue
  la vista activa, cada una navega a su landing y la migración `ai`→`studio`
  conserva la preferencia. El rail global no desaparece al cambiar de espacio.
- `[done]` **Hubs con tabs y estado preservado** — Descargar (Descargar/
  YouTube/Cumplimiento), Creador (Crear/Fábrica/Miniaturas/Localización) y
  Laboratorio (Convertir/Comprimir/Denoise/Upscale/Comparar/Fondo). Las
  pestañas visitadas se mantienen montadas: cambiar de tab no pierde una cola
  ni un formulario.
- `[done]` **Editor con modos internos** — Texto, Multicámara, Mezcla, VFX,
  Motion y Efectos como tabs del editor; la timeline sigue visible debajo.
- `[done]` **IA transversal** — AI Hub y MCP salen del rail; se abren desde
  Ajustes → Inteligencia artificial y desde el asistente global (Ctrl+K/dock).
- `[done]` **Salida a Studio** — después de importar una descarga aparece
  “Abrir en Studio”.
- **Verificación**: typecheck raíz verde, suite raíz **1352/1352 en 164**,
  escritorio **952/952 en 138**, revisión visual de Ingesta, Creador,
  Laboratorio, Ajustes IA y popover Más a 1280×720. Sin build ni instalación.
- `[done]` **Fase 1B · rutas canónicas** — `view-routing.ts` redirige YouTube/
  Cumplimiento a Descargar; Fábrica/Miniaturas/Localización a Creador;
  Convertir/Comprimir/Denoise/Upscale/Comparar/Fondo a Laboratorio; Texto/
  Multicámara/Mezcla/VFX/Motion/Efectos al tab del Editor. Se retiraron las
  rutas standalone duplicadas de `App.tsx`; deep links y paleta pasan por la
  misma normalización. Los hubs y el editor inicializan en el tab/modo pedido,
  con request id para navegaciones repetidas.

## Lote interfaz comercial 60-30-10 (2026-10-28)

- `[done]` **Paleta exacta y capa final** — `appearance.ts` fija el preset
  `olyvia` en `#0F1115` / `#181B20` / `#2D3240` / `#1F5EFF` / `#22C55E` /
  `#FF6B2B` / `#F2F5FF` / `#9CA3AF`, con radios 8–10 px y glow cobalto. La
  nueva `commercial.css` entra última y anula los degradados de las capas
  previas sin tocar los presets de otros temas.
- `[done]` **Workspaces en la topbar** — primera pasada con Descargas /
  Creador / Editor Studio / AI Hub. La Fase 1 la reemplazó por Ingesta /
  Creador / Studio y un rail global de 9 superficies.
- `[done]` **Barra de URL** — borde cobalto con transición de 0,2 s al foco o
  con URL normalizada válida, más glow medido.
- `[done]` **Ruido reducido** — instrucciones de la extensión, límites del
  motor y “cómo funciona” pasan a `InfoTip` accesibles (rol `note`,
  `data-tooltip` y foco por teclado). El aviso sin proyecto queda en una línea.
- `[done]` **Acordeones** — Programación/repetición, historial y los bloques de
  red/automatización quedan cerrados; sólo Destino y Presets rápidos abren por
  defecto. El historial resume registros sin inventar tamaños.
- `[done]` **Cola consolidada** — un solo pie sticky con estado, pendientes,
  total, progreso promedio y expansión; el detalle de la cola oculta sus
  controles hasta abrirlo. El pie distingue trabajos activos, en espera,
  completados y con error (color y texto), y ya no muestra “Cola lista” ante
  fallos.
- `[done]` **Verificación** — typecheck del workspace verde; suite raíz
  **1335/1335 en 161 archivos**; suite de escritorio **935/935 en 135**; 4
  tests nuevos de espacios de trabajo, 5 de shell y 1 de cola consolidada.
- `[done]` **Instalador construido y firmado** — `Olyvia_0.1.0_x64-setup.exe`
  queda listo en `target/release/bundle/nsis`; no se instaló para no cerrar la
  sesión abierta. Ver el estado verificado al inicio de este archivo para
  tamaño, SHA-256, firma y la build que sigue instalada.

## Lote cierre III del descargador (2026-10-28)

- `[done]` **Hasta 512 simultáneas** en la UI.
- `[done]` **Actualización automática de yt-dlp** cada 7 días, con interruptor
  persistido y reintento en el próximo arranque si falla.
- `[done]` **Playlist hasta 500** por lectura; backend admite 1.000.
- `[done]` **Aviso de carátula en WebM**: el contenedor no admite adjunto; se
  escriben metadatos y se advierte.
- `[done]` Verificación final: typecheck, raíz 1325/1325, Rust 443/443, firma y
  assets instalados.
- Límites de arquitectura que no se fuerzan desde el repo: servicio headless
  separado (el vigilante es tarea de Windows), torrent/P2P, cola en la nube y
  Dolby Vision. Tampoco se puede inventar un checksum que el servidor no
  publica.

## Lote cierre II del descargador (2026-10-28)

- `[done]` **128 simultáneas** en la UI.
- `[done]` **Traducción a varios destinos**: idioma principal + checkboxes de
  los otros siete; traduce todas las pistas a cada idioma y el burn-in usa el
  principal.
- `[done]` **Playlist hasta 200** entradas por lectura (backend acepta 500).
- `[done]` **Selector real de pista de audio**: `list_audio_tracks` lee los
  formatos de yt-dlp, la UI permite elegir `format_id` y la descarga usa
  `bv*+id` o el audio elegido.
- `[done]` **Días permitidos** además de la ventana horaria (Lun–Dom).
- `[done]` **Mute WebM** con `libopus`; verificado en MP4 y WebM con volumen
  antes/dentro/fuera del tramo.
- `[done]` **Notificación nativa verificada** con `--test-notification`: el
  plugin devolvió `ok` y el proceso arrancó oculto.
- Límites que quedan por diseño: el vigilante sigue siendo una tarea de
  Windows, no un servicio headless; no hay torrent/P2P ni cola en la nube; el
  checksum de fuente depende de que el servidor lo publique; Dolby Vision no
  está soportado.

## Lote cierre de brechas del descargador (2026-10-28)

- `[done]` **Hasta 64 simultáneas**: subió el tope de la UI; el backend no
  impone un límite.
- `[done]` **SponsorBlock mute**: `sponsorblockMute` consulta la API y silencia
  sólo el audio de los tramos, copiando el video. Live: antes >−40 dB, tramo
  muteado <−60 dB y fuera del tramo intacto.
- `[done]` **Checksum de la fuente**: `probe_source_checksum` lee
  `Content-MD5`, `Digest`, `X-Checksum-Sha256` y `x-goog-hash`; la UI llena el
  SHA-256 esperado. Prueba con base64 conocido.
- `[done]` **Hashes en historial**: los archivos del historial conservan MD5 y
  SHA-256 en el JSON exportado.
- `[done]` **Todos los subtítulos**: traduce cada pista en lotes de 80 y guarda
  un SRT por pista; el burn-in usa la primera traducida.
- `[done]` **Costo remoto**: interruptor explícito que pasa `approvedCost`.
- `[done]` **Carpeta vigilada recursiva** hasta 3 niveles y **filtros RSS** de
  incluir/excluir palabras, persistidos.
- `[done]` **Salud de proxies periódica** cada 10 minutos; el failover por
  reintento ya existía.
- `[done]` **Ventana horaria**: `windowStart`/`windowEnd` con cruce de
  medianoche; el planificador espera a la próxima apertura. Pruebas unitarias.
- `[done]` **Playlist real**: `list_playlist_entries` usa yt-dlp flat-playlist,
  la UI muestra hasta 50 títulos y checkboxes, y arma `playlistItems`.
- `[done]` **Idioma de audio**: `audioLanguage` acepta `es`, `en`, `pt-BR` o
  `all`; se pasa como `-S lang:` o `--audio-multistreams`.
- `[done]` **Metadatos y carátula**: título/artista/comentario y cover embebido
  (mjpeg attached_pic) en video/audio; live verificado con ffprobe.
- `[done]` **Vigilante de Windows**: `install_watchdog` crea tareas ONLOGON y
  cada 5 min; `--background` arranca oculto con mutex de instancia única. No es
  un servicio aparte.
- `[done]` **Probar notificación** desde Descargas.
- Límites: la traducción/burn-in sigue usando un idioma de destino por trabajo;
  el vigilante depende del Programador de tareas y «Salir» lo desactiva; el
  idioma de audio es una preferencia de yt-dlp, no una garantía del sitio; el
  toast no se verificó visualmente.

## Lote descargas paralelas y automatizaciones (2026-10-28)

- `[done]` **Descargas simultáneas**: se eliminó el lock global; cada trabajo
  registra su propio `DownloadControl` y la UI arranca hasta **32** a la vez
  (valor persistido, editable en “Simultáneas”). Pausa, reanudación y
  cancelación usan el `runId` del trabajo. Prueba UI: dos trabajos quedan
  `running` antes de resolver ninguno.
- `[done]` **Progreso por trabajo**: `download-progress` lleva `runId`; la cola
  muestra mensaje/porcentaje de cada trabajo. El historial guarda duración y
  velocidad media.
- `[done]` **Bandeja y segundo plano**: icono con “Mostrar Olyvia” y “Salir de
  Olyvia”; cerrar la ventana la oculta y deja la cola viva. Verificado con
  `WM_CLOSE` real: proceso vivo y ventana oculta.
- `[done]` **Notificaciones**: `tauri-plugin-notification` + comando
  `notify_user`; la UI avisa al completar o fallar con interruptor “Notificar”.
- `[done]` **Carpeta vigilada**: `scan_watch_folder` lee hasta 50 `.txt` de
  1 MB, extrae URLs http(s) y revisa cada 60 s; recuerda archivo+mtime.
- `[done]` **RSS/Atom**: `fetch_rss_feed` valida URL, limita 2 MB/100 entradas,
  parsea RSS y Atom; feeds persistidos y revisados cada 5 min. Prueba real
  contra `hnrss.org`.
- `[done]` **Repetición**: cada hora/día/semana clona el trabajo al completarse
  y calcula la próxima hora sin quedar en el pasado.
- `[done]` **Salud y failover de proxies**: `test_proxy` mide latencia;
  “Conservar los que responden” limpia la lista y un reintento rota al
  siguiente proxy.
- `[done]` **Checksums completos**: `hashFiles` calcula MD5+SHA-256 en streaming
  para todos los archivos; `expectedSha256` falla si ninguno coincide. Prueba
  con digests conocidos de “abc”.
- `[done]` **Traducción y burn-in**: traduce SRT en lotes de 80 con el proveedor
  de Localización, guarda el SRT traducido, lo adjunta y opcionalmente quema
  los subtítulos con FFmpeg.
- `[done]` **SponsorBlock por acción**: además de quitar,
  `--sponsorblock-mark` marca categorías como capítulo; la UI impide marcar lo
  que ya se quita.
- `[done]` **HDR AV1**: conservar HDR acepta H.265 o AV1 10-bit; H.264 se
  rechaza. Verificado con HLG→AV1 `yuv420p10le` y `arib-std-b67`.
- `[done]` **Plantilla de nombres y playlist**: tokens `{title}`, `{id}`,
  `{platform}`, `{height}`, `{date}`, rechazo de rutas/`..`, y rangos
  (`1-10`, `1,3,5`, `2:8`).
- `[done]` **4K largo**: 12 s 3840×2160 → HEVC, duración y dimensiones
  verificadas; 25,15 s incluyendo la fuente.
- Límites honestos: no hay daemon separado del WebView (la bandeja mantiene el
  proceso; un cierre forzado lo termina); la traducción usa el proveedor
  configurado y no autoriza costos remotos; “mute” de SponsorBlock no existe en
  yt-dlp (sí quitar y marcar); el SHA-256 esperado lo aporta la persona porque
  los sitios no publican uno; el máximo de concurrencia de la UI es 32.

## Lote accesibilidad del menubar (2026-10-28)

- `[done]` **Menubar operable con teclado (H13/3b)**: los títulos usan roving
  tabindex (sólo uno queda en el orden de Tab) y responden a ←/→ (abren el
  hermano con el foco en su primer ítem, o sólo mueven el foco si no hay menú
  abierto), ↓/↑ abren con el primer/último ítem, Home/End van al primer/último
  menú y Enter/Espacio abren el menú enfocado.
- `[done]` **Foco y propagación**: Escape cierra el desplegable, devuelve el
  foco al disparador y corta la propagación para que el atajo global de Escape
  no deseleccione el clip; Tab cierra el menú y deja el foco en el
  disparador; al activar un ítem con Enter/Espacio el foco vuelve al
  disparador. Si el menú abierto no tiene
  ningún ítem habilitado (Editar sin proyecto), el foco vuelve al disparador
  en vez de caer en `<body>`.
- `[done]` **Estado anunciado**: los ítems con tilde pasan a
  `role="menuitemcheckbox"` con `aria-checked` real («Etiquetas del rail»,
  «Barra de estado» y las vistas del menú Ver).
- `[done]` **Trampa corregida**: el `ref` compartido del desplegable quedaba en
  `null` al cambiar de menú porque React desmonta el anterior después de montar
  el siguiente; la búsqueda de ítems ahora usa un query acotado a la raíz del
  menubar.
- `[done]` **Pruebas**: `MenuBar.test.tsx` **8/8** (6 nuevas: roving tabindex,
  ↓/↑, ←/→ con fallback, Escape con foco y sin propagación, `aria-checked`);
  App + App.teclado + paleta **63/63**; suite completa **1321/1321 en 160
  archivos** en 53,89 s; `npm run typecheck` verde; `npm run build` verde en
  8,33 s (main 368,60 kB, gzip 103,16; los chunks del split no cambian).
- Límite honesto: no se tocó `ProfileMenu` (H14/3c) ni la paleta (H12/3a);
  siguen pendientes como ítems propios. El resto del ítem 10 quedó partido: el
  contraste de las guías de curvas sigue por debajo de 3:1 (medido en el ítem
  10b) y las etiquetas de paneo ya estaban completas (10c).
- Próximo candidato: **10b** (contraste de guías de curvas), con los ratios ya
  medidos.

## Lote descargador completo III (2026-10-28)

- `[done]` **HDR correcto**: `probe_color` ahora distingue PQ (`smpte2084`) de
  HLG (`arib-std-b67`). Conservar HDR mantiene la transferencia real y
  10-bit; el tonemap se aplica a PQ y HLG. Conservar con AV1/H.264 se rechaza
  con un error explícito y la UI fuerza H.265. El look cinematográfico también
  tonemapea fuentes HDR antes del LUT/grano.
- `[done]` **Tamaño objetivo honesto**: el cálculo usa MB decimales (igual que
  la UI), rechaza objetivos por debajo de 120 kbps de video con el mínimo
  sugerido, y ya no se envía para MKV/WebM/audio ni acepta decimales.
- `[done]` **Capítulos**: `creator_split_chapters` corta cada capítulo en un
  MP4 independiente con `-map_chapters -1`, valida el máximo de 80 y conserva
  nombres seguros. Verificado en vivo con dos capítulos: duración total 6 s.
- `[done]` **Burn-in**: `creator_burn_subtitles` incrusta SRT/VTT con Segoe UI,
  contorno negro y margen móvil; rechaza texto vacío o >5 MB. Verificado con
  FFmpeg real y audio conservado.
- `[done]` **Programación**: la cola persiste `scheduledFor`, espera la hora
  exacta con un temporizador y ofrece “Ahora” para adelantar. Cubierto por
  pruebas de persistencia y de UI (no descarga antes de tiempo).
- `[done]` **Rotación de proxies**: se pega uno por línea; cada trabajo toma
  el siguiente proxy de la lista y los reintentos conservan el suyo.
- `[done]` **SponsorBlock preview**: comando Rust que valida el ID de YouTube y
  consulta `sponsor.ajay.app` sin descargar; la UI lista categoría, rango y
  acción antes de decidir. Pruebas unitarias de extracción de ID y parseo.
- `[done]` **UI Creador**: seis módulos con tarjetas de capítulos y subtítulos,
  botones deshabilitados sin carpeta de salida y resultados unificados.
- `[done]` **Build verde**: la prueba de Motion esperaba el Inspector diferido
  con `getByLabelText` síncrono; ahora usa `findByLabelText` con 10 s. Era una
  carrera de carga, no un fallo de producto.
- `[done]` **Instalación**: NSIS firmado instalado con `/S` (exit 0), exe
  **93.554.656 B** SHA `88D9E4E9…A407CC`, firma válida, PID **21296**.
  `main-DDjGL1hx.js` referencia `DownloadView-BZUOuKzM.js` y
  `CreatorView-DHFgvVkc.js`; ambos nombres y los comandos nuevos están en el
  binario instalado. No se pudo grepear texto de UI porque los assets van
  comprimidos dentro del exe; se verificó por nombre de asset y pruebas.
- Límites honestos de esta vuelta: **no** hay descargas paralelas (sigue el
  lock de un trabajo), ni bandeja/daemon, ni notificaciones de Windows, ni
  carpeta vigilada/RSS, ni verificación de checksum contra una fuente externa.
  La traducción de subtítulos ya existía en Localización y no se duplicó.

## Lote partir EditorWorkspace (2026-10-28)

- `[done]` **Shell mínimo**: `EditorWorkspace` pasó de **999,83 kB (gzip
  192,78)** a **53,62 kB (gzip 18,25)** — −946,21 kB (−94,6 %), −174,53 kB
  gzip (−90,5 %) — con `React.lazy` + `Suspense` por panel. El shell conserva
  Preview y Transport; Inspector, Timeline, EditorAssets y ExportDialog viven
  en chunks propios.
- `[done]` **Chunks medidos** (`vite build` 6,12 s): Inspector **138,90 kB
  (37,40 gzip)**, Timeline **40,13 (12,15)**, EditorAssets **25,35 (7,57)**,
  EmojiPicker **719,71 (113,13)** y ExportDialog **24,73 (8,17)**. El primer
  grupo se pide al montar el editor; el diálogo de exportación recién se
  importa al abrirlo y se desmonta al cerrarlo (sólo se puede cerrar sin un
  render en curso).
- `[done]` **Acoplamiento roto**: `COLOR_LOOKS` salió de `Inspector.tsx` a
  `editor/color-looks.ts`; el rail lo importaba y arrastraba el Inspector
  completo al shell. También se retiró el export desde Inspector, que era el
  único consumidor externo.
- `[done]` **Fallbacks honestos**: reservas mudas con el punto de carga
  existente y `aria-busy`, conservando los landmarks (`asset-rail`,
  `inspector` con “Detalles”) y el ancho de cada columna; no se anuncia una
  espera ni se inventa contenido. CSS nuevo: `.panel-loading`.
- `[done]` **Pruebas**: typecheck verde; dirigidas **100/100 en 10 archivos**
  (App, App.teclado, ExportDialog, EditorAssets, Timeline, EmojiPicker ×2,
  Motion, Lottie, ProjectHome); suite desktop **908/908 en 134 archivos**;
  suite raíz **1310/1310 en 160 archivos** en 53,94 s. Los helpers
  `createProject`/`abrirEditor` ahora esperan `.timeline-surface` antes de
  leer clips.
- Límite honesto: el editor sigue pidiendo Inspector, Timeline, EditorAssets
  y EmojiPicker al montarse, así que el total inicial ronda **977,71 kB
  (188,62 gzip)**, similar al anterior; la ganancia real es que el shell y la
  preview se evalúan primero y que ExportDialog (24,73 kB) quedó diferido de
  verdad. El catálogo de emoji (719,71 kB min / 113,13 gzip, escapado ASCII)
  sigue cargándose al montar: diferirlo a la apertura del picker es el ítem 17,
  que quedó desbloqueado por este split. No se midió tiempo de arranque en la
  app Tauri; sólo tamaño de chunks y tests.

## Lote descargador avanzado II (2026-10-28)

- `[done]` **Tamaño objetivo**: `targetSizeMb` calcula el bitrate de video
  desde la duración y el audio de 160 kbps, reemplaza al CRF y se verifica en
  vivo: un clip de 4 s con objetivo 1 MB quedó por debajo de 1,6 MB.
- `[done]` **Conservar original**: `keepOriginal` deja en Descargas tanto el
  archivo descargado como el procesado (cine o compresión); el test live
  confirma que el input sigue en disco.
- `[done]` **Cookies del navegador**: selector Chrome/Edge/Firefox/Brave/
  Chromium/Opera/Vivaldi; yt-dlp usa `--cookies-from-browser` en probe y
  descarga, sin guardar secretos en el proyecto. Si hay cookies.txt, tiene
  prioridad.
- `[done]` **Espacio y estimación**: comando `download_disk_space`, indicador
  de espacio libre, tamaño de salida estimado (objetivo, cine o compresión) y
  tiempo estimado según el límite de bajada o 8 MB/s.
- `[done]` **Velocidad FFmpeg**: `-progress` ahora adjunta `speed=` al
  porcentaje; yt-dlp ya mostraba velocidad/ETA en su línea de progreso.
- `[done]` **Cola más resistente**: reencola sola los trabajos `running` al
  abrir, reintento automático hasta 2 veces con 2 s/4 s (no reintenta errores
  permanentes), reordenar subir/bajar, pausar/reanudar/cancelar todo, omitir
  URLs ya completadas y estadísticas/exportación JSON del historial.
- `[done]` **Puente con Creador**: desde el resultado de Descargas se abre
  Creador con el video ya cargado (sessionStorage).
- `[done]` **Pruebas**: target size live 1/1 en 0,97 s; cookies browser
  1/1; suite Rust **423/423 + 47 ignored**; frontend **1306/1306 en 160
  archivos** en 199,40 s; typecheck verde.
- Límite honesto: el tamaño objetivo es aproximado (contenedor/audio pueden
  desviarlo); las cookies dependen de que yt-dlp pueda leer el navegador y de
  que esté cerrado si la base está bloqueada; el reintento automático es de
  2 intentos; sigue sin HDR/10-bit/AV1, traducción o burn-in de subtítulos,
  split por capítulos, programador/carpeta vigilada, proxy pool/rotación,
  notificaciones del sistema ni daemon fuera de la app.

## Lote módulos de creador (2026-10-28)

- `[done]` **Módulo Hook**: `creator_inject_hook` divide los primeros 3 s,
  aplica `zoompan` progresivo (2–25 %), quema un ASS centrado con fade y mezcla
  un whoosh sintetizado con `anoisesrc`/`highpass`/`afade`. El resto del video
  se concatena sin tocar el audio; si el video dura menos de 3 s se hace zoom
  sobre todo. Salida H.264 CRF 20.
- `[done]` **Multi-formato concurrente**: `creator_export_multi_aspect` usa
  `tokio::task::JoinSet` y `spawn_blocking` para 9:16 1080×1920, 16:9
  1920×1080 y 1:1 1080×1080. Vertical/cuadrado usan fondo escalado + blur y
  foreground `decrease` centrado; horizontal recorta al centro. Audio se copia
  y sólo se reencodea si el contenedor lo rechaza; un FFmpeg por variante, sin
  intermedios.
- `[done]` **CTA con QR offline**: `creator_inject_cta` calcula los últimos
  3–5 s, quema un banner ASS inferior y, si se pide, rasteriza un QR con
  `qrcodegen` + `image` y lo superpone abajo-derecha con `enable=between(t,…)`.
  Sin red ni servicios externos.
- `[done]` **B-roll activo**: `creator_interleave_broll` escanea una carpeta,
  planifica cuts cada N segundos (1–3 s cada uno, máximo 20), reemplaza el
  video del tramo con el clip de apoyo escalado/recortado y conserva el audio
  principal continuo. Grafo en archivo con `-/filter_complex` para evitar el
  límite de Windows. Test live verifica que el frame del cut sea rojo.
- `[done]` **UI Creador**: nueva vista con selector de video/carpeta, cuatro
  tarjetas, resultados con “Ver archivo” y navegación en el rail.
- `[done]` **Pruebas**: 6 unitarias (ASS, plan de cuts, filtros, QR, Hook,
  B-roll) + live `creator_tools_live_optional` 1/1 en 7,32 s con hook, CTA/QR,
  tres variantes y B-roll; suite Rust **421/421 + 47 ignored**; frontend
  **1306/1306 en 160 archivos** en 153,74 s; typecheck verde.
- Límite honesto: el whoosh es ruido filtrado sintetizado, no un SFX
  descargado; el QR no lleva logo; el B-roll reencoda el video completo (no
  stream-copy por los cortes); no hay detección semántica de momentos, sólo
  intervalo fijo; los paths de entrada se validan como archivos existentes,
  no contra el root de un proyecto.

## Lote cola, entrega al proyecto y autoedición rápida (2026-10-28)

- `[done]` **Cola persistente**: trabajos en `localStorage` (`queue.ts`) con
  `runId` estable. Al reabrir, un trabajo `running` pasa a `paused`; al
  reanudar se reutiliza la misma carpeta y yt-dlp continúa los `.part`.
  Worker secuencial en la UI, lote de URLs (una por línea) y límite de un
  proceso pesado a la vez con `try_lock` en Rust, compartido por UI y bridge.
- `[done]` **Pausa/reanudación/cancelación reales**: registro global del
  child; en Windows `NtSuspendProcess`/`NtResumeProcess` suspenden y reanudan
  yt-dlp/FFmpeg; cancelar usa `TerminateProcess`, limpia la carpeta temporal
  y el cierre de la app cancela el trabajo activo. No hay pausa entre
  procesos si no hay child: el flag espera antes del siguiente paso.
- `[done]` **Progreso FFmpeg**: `-progress pipe:1` + `out_time_us` calcula
  porcentaje real en `process_video` y `compress_video`; el test 4K exige al
  menos una lectura >0 además de dimensiones/códec.
- `[done]` **Historial y reintento**: últimos 12 trabajos con estado, archivos
  y solicitud completa; “Reintentar” reencola con el mismo `runId` para
  aprovechar parciales. “Ver archivo” usa `revealOutput`.
- `[done]` **Pre-recorte y entrega**: `trimStart`/`trimEnd` pasan a
  `--download-sections`; los videos se insertan en el timeline, el SRT se
  convierte en cues (sin solapamientos), los capítulos en marcadores y la
  miniatura se importa a Medios y se registra como `x-coverAssetId` para la
  portada de proyectos recientes. Todo en **una sola mutación** porque
  `store.mutate` usa el snapshot del último render y dos llamadas en el mismo
  tick se pisaban.
- `[done]` **Red/utilidades**: idiomas de subtítulos libres, 8 categorías de
  SponsorBlock seleccionables, chequeo de espacio libre antes de descargar y
  botón “Actualizar motor” (`yt-dlp -U`) con invalidación del estado.
- `[done]` **Audio original en cortos**: el enrutador ya no sintetiza Piper
  automáticamente; conserva la pista original y aplica mastering transparente
  (`highpass 55`, `lowpass 18k`, compresor suave, `loudnorm −14`), sin cambiar
  velocidad ni tono. No se implementó evasión de detección de re-subida.
- `[done]` **Autoedición más rápida**: `analyze_media` corre escenas,
  detectores y una única pasada de audio (`silencedetect+ebur128+astats`) en
  paralelo, omite luma/saturación para Automático (`includeSamples=false`) y
  persiste el análisis en `cache_dir/analysis`. Medición real en clip 10 s
  640×360: **legacy 922,9 ms → Automático 169,5 ms (−81,6 %)** y Director
  408,6 ms (−55,7 %).
- `[done]` **4K real**: encode 3840×2160 HEVC de 1 s/60 fps por la ruta larga
  con Lanczos en **3,85 s** en CPU; dimensiones y códec verificados.
- `[done]` **Pruebas**: suite frontend **1304/1304 en 159 archivos** en
  194,76 s; downloader Rust **41/41 + 1 ignored** (live 32,81 s con YMAX
  242→88, 4K y audio master); intelligence 7/7 con benchmark. Typecheck
  verde.
- Límite honesto: la cola vive en `localStorage`, no en un servicio en
  segundo plano; tras cerrar la app hay que reanudarla desde la UI. La pausa
  suspende el proceso activo, no un trabajo que aún no arrancó. La portada usa
  el namespace `x-coverAssetId`, no un campo tipado del esquema. El 4K medido
  es 1 s sintético; no se probó un video largo 4K. La integración de SRT
  descarta cues solapados y no traduce el idioma del SRT al proyecto.

## Lote paneo animado de pista en export (2026-10-27)

- `[done]` **Medición real MP4 vs preview**:
  `render_live_5s_animated_track_pan_astats_matches_preview` renderiza 5 s a
  24 fps con `panKeyframes` (meseta −0,8, tramo Bézier `.42,0,.58,1`, meseta
  +0,36) y mide L/R con `astats` sobre ventanas de 0,4 s:
  **R−L −13,99 dB** contra **−13,98 dB** de la preview (Δ 0,01 dB) y
  **+3,88 dB** contra **+3,88 dB** (Δ 0,00 dB). El test 1/1 en 1,12 s.
  Segunda corrida junto al test live anterior: 2/2 en 1,71 s.
- `[done]` **Por qué mesetas**: el priming de AAC (~21 ms) corría la ventana
  sobre un barrido continuo y desviaba 0,85 dB; las mesetas con `hold` miden
  la ley sin ese sesgo. El tramo central conserva la Bézier y el golden del
  port de Rust (`cubicBezierProgress(48/59, .42,0,.58,1) = 0,929319`).
- `[done]` **Bug real encontrado y corregido**: con el paneo animado la línea
  de comandos del render llegaba a **35.271 caracteres** y `Command::spawn`
  fallaba en Windows (límite 32.767, mensaje "no se pudo iniciar ffmpeg").
  El grafo largo ahora se escribe en `filter-graph.txt` del temp del render y
  FFmpeg lo lee con `-/filter_complex` (FFmpeg 9.0.1/9.0.2; el antiguo
  `-filter_complex_script` ya no existe). Los grafos ≤8.000 caracteres siguen
  inline, así que los renders cortos no cambian. El test verifica que el plan
  usa el archivo y que los args totales quedan bajo 8.000.
- `[done]` **Hallazgo lateral corregido**: `perspective_filter` indexaba
  `perspective["interpolation"]` sobre un `Map` y paniqueaba cuando el campo
  opcional faltaba (`no entry found for key`). Se cambió a `.get(...)`; el
  test de perspectiva volvió a verde y la suite Rust quedó 412/412 al cierre.
- `[done]` **Test unitario del grafo**: el test
  `long_filter_graphs_use_a_file_and_short_ones_stay_inline` construye el plan
  sin FFmpeg, verifica que el grafo >8.000 va a `filter-graph.txt`, que los
  args quedan bajo 8.000 y que un proyecto corto sigue inline. 1/1 en 0,34 s.
- `[done]` **Preview sin cambios**: los tests de paneo por playhead siguen
  17/17; el ítem sólo agregó la verificación del MP4 y el arreglo del grafo.
- Límite honesto: el grafo leído de archivo requiere FFmpeg 9+ (la app
  empaqueta 9.0.2; uno externo anterior fallaría igual que antes por límite
  de línea). No se probó en GPU ni con proyectos de muchos clips; el umbral
  de 8.000 caracteres deja margen amplio pero no es una cota formal.

## Lote delogo + Lanczos + HEVC (2026-10-27)

- `[done]` **Delogo proporcional**: `delogo_rect` lee las dimensiones reales
  con FFprobe y calcula un parche 140×50 con margen 20 a 1080p, escalado al
  canvas y con recorte para no salir del cuadro. FFmpeg 9.0 **no** acepta
  `main_w` dentro de `x`/`y` de `delogo` (probado: `Undefined constant`), así
  que las coordenadas se resuelven en Rust y el filtro recibe enteros.
  Esquinas: superior/inferior × izquierda/derecha. El parche va antes del zoom
  del 4 %, que limpia residuos del margen.
- `[done]` **Lanczos automático**: si el origen queda por debajo del objetivo,
  `scale=…:flags=lanczos` + `pad` preserva la relación de aspecto; cortos a
  1920×1080 (vertical 1080×1920) y largos a 3840×2160 (vertical 2160×3840).
  Nunca reduce un origen mayor. El zoom 4 % usa dimensiones explícitas para
  que el archivo final sea exactamente el objetivo, sin los 2 px que perdía el
  redondeo par anterior. En la ruta larga se mantiene `hqdn3d` cuando hay
  upscaling; se siguen omitiendo flujo óptico y grano.
- `[done]` **H.265 forzado**: el perfil CPU pasó de `libx264` a `libx265`
  ultrafast CRF 23 (24 con RAM ≤9 GB); el look manual usa `libx265 fast`
  CRF 22. NVENC usa `p3`/CQ 23/`-tune ll`; AMF `speed`/CQP 23; QSV
  `fast`/QP 23. Todos agregan `tag hvc1`. Si sólo hay H.264 por hardware se
  prefiere x265 CPU: el asset final siempre es HEVC.
- `[done]` **Hashes dobles**: todo video postprocesado devuelve MD5 y SHA-256;
  la UI muestra ambos con tooltip y los conserva al mover a Descargas.
- `[done]` **UI**: checkbox de logo + selector de esquina, checkbox de Lanczos
  (encendido por defecto dentro del look) + objetivo Auto/1080/2160, con aviso
  de costo de 4K en largos.
- `[done]` **Pruebas reales**: `delogo_and_lanczos_live_optional` midió el
  YMAX de la zona del logo **242 → 88**, salida exacta **1920×1080**, códec
  **hevc**, MD5 32 hex y SHA-256 64 hex, en 31,23 s.
  `cinematic_render_live_optional` pasó en 5,63 s con look completo, pipeline,
  ruta larga, Piper y watermark; 34/35 tests de `commands::downloader` verdes
  (1 ignored de red). Typecheck verde y suite final **1299/1299 en 157
  archivos** en 186,70 s.
- Límite honesto: el delogo es estático y por esquina; no detecta ni sigue un
  logo, y si no hay marca difumina contenido real. `scale_cuda` no se usa
  porque el resto de la cadena es CPU; se documenta el equivalente con
  `hwupload/hwdownload` pero no se simula. El 4K en largos puede tardar mucho.
- `[done]` **Instalado** (lote delogo + Lanczos + HEVC): instalador
  **256.175.368 B**, SHA-256
  `9CC185B1AA222C5D4CD6712613835ABF611F861BB61763987FBC9985DF4F77DF`,
  firma Authenticode válida; ejecutable instalado **77.885.920 B**, SHA-256
  `804062473235A29852A5752701E8BED74F2BEE1527ACB5DA4689858E6001B579`,
  PID **25000** respondiendo. El binario instalado contiene el asset
  `main-5wWzMphb.js`, que referencia `DownloadView-DYF0AvxY.js`, además de
  `piper/es_voice.onnx` (63.201.294 B) y `watermark.png` (3.174 B).

## Lote actualizador honesto (2026-10-27)

- `[done]` **Fuera la release ficticia**: se eliminó `updater-service.ts`, que
  devolvía una 0.2.0 hardcodeada, simulaba 800 ms de red y una descarga con
  progreso y velocidad aleatorios. El modal ya no ofrece canales
  Estable/Beta, checkbox de auto-chequeo, botón de descarga ni estado
  "descargado y verificado": nada de eso existía.
- `[done]` **Estado real**: la ventana "Actualizaciones de Olyvia" muestra la
  versión instalada y el aviso "Sin canal de actualizaciones configurado",
  con los dos datos pendientes: firma local autofirmada sin sello de tiempo y
  endpoint de releases sin definir. El lanzador ya no muestra el chip
  "Actualización" en cada arranque.
- `[done]` **Versión única**: `CURRENT_APP_VERSION` vive en
  `apps/desktop/src/app/version.ts`; el lanzador, el modal y el panel Acerca
  de del menú lo leen de ahí. `version.test.ts` compara el valor con
  `apps/desktop/package.json` y `tauri.conf.json` para que no se despegue.
- `[done]` **Pruebas**: modal 4/4 (estado honesto, sin controles ficticios,
  foco inicial/Escape y trampa de Tab), versión 1/1, StartScreen 8/8,
  MenuBar 2/2. E2E nuevo `e2e/updater.spec.ts` en Chrome real: 1/1 en 1,6 min;
  verifica que el diálogo entre en el viewport, que no haya CTA de descarga y
  que Escape devuelva el foco al botón de versión.
- `[done]` **Verificación**: `npm run typecheck` verde; suite completa
  **1299/1299 en 157 archivos** en 175,11 s; `npm run build` verde en 7,46 s
  (`EditorWorkspace` 999,78 kB). Sin cambios en Rust, sin commit/push ni
  rebuild del instalador.
- Límite honesto: el ítem sigue `[partial]` porque la decisión de fondo
  (certificado de firma con sello de tiempo y endpoint de manifiesto) es del
  usuario. Hasta entonces no hay comprobación real ni descarga: la ventana
  informa el estado en vez de simular una actualización.

## Lote pipeline adaptativo del descargador (2026-10-27)

- `[done]` **Perfil por hardware real**: `pipeline_profile::detect` consulta
  los encoders con FFmpeg y elige NVENC (`hevc_nvenc`, preset p4, CQ 24,
  `-tune ll`, decodificación `cuda`), AMF (`hevc_amf`, balanced, CQP 24),
  QSV (`hevc_qsv`, medium, QP 24) o CPU (`libx264 ultrafast`, CRF 23; CRF 24
  con RAM ≤9 GB). La decisión se toma una vez por descarga y el perfil elegido
  se informa en las advertencias del resultado. En esta máquina el probe real
  no encontró encoder de hardware utilizable, así que el camino verificado es
  CPU; el resto queda cubierto por la selección de args y no se probó en GPU.
- `[done]` **Árbol de decisión estático** (`AutoRouteDecision`): ≤60 s y sin
  título musical → look completo de 60 fps por flujo óptico + voz Piper
  automática; >60 s → ruta rápida `fps=60`, espejo y zoom 4 % **sin**
  `minterpolate` ni grano, con audio 1,02× y ruido rosa a −50 dB; título con
  música/song/lyrics/cover/música/canción → conserva la pista original sin
  velocidad ni ruido, aunque sea largo. Si la duración llega vacía, el
  enrutador la resuelve con FFprobe después de descargar y recién entonces
  decide voz/audio.
- `[done]` **UI de red y utilidades**: checkbox de enrutamiento automático con
  vista previa de la ruta, campo de proxy HTTP/SOCKS con validación, límite
  global de bajada (`500K`, `8M`), subtítulos es/en a SRT, miniatura JPG,
  capítulos embebidos y SponsorBlock. Los campos viajan al backend; el
  frontend bloquea la descarga si el proxy o el límite tienen formato inválido.
- `[done]` **Pruebas**: 5 unitarias del mapeo de ruta en el frontend, 4 del
  árbol en Rust, 3 del perfil CPU/GPU y una prueba real de FFmpeg que ejerce
  look completo, pipeline, ruta larga simulada y audio preservado. Typecheck
  verde y suite completa **1298/1298 en 156 archivos** en 164,41 s.
- `[done]` **Build e instalación**: `tauri:build` con firma local, instalador
  de 254.780.768 B y ejecutable instalado de 76.450.272 B; firma válida,
  recursos de voz y watermark presentes, app abierta y respondiendo (PID
  20540). La instalación re-firma el ejecutable, por eso su SHA difiere del
  binario de `target/release`; ambos son el mismo build por longitud,
  timestamp y cadenas verificadas.
- Límite honesto: la cola persistente con pausa/reanudación/aborto real, el
  pre-recorte antes de descargar y la entrega directa a timeline siguen
  **pendientes**. Hoy la descarga se ejecuta en segundo plano con progreso,
  proxy, límite de tasa y selección de encoder, pero no hay botón de pausa ni
  reanudación entre sesiones. No se simula esa UI.

## Lote perspectiva en preview (2026-10-27)

- `[done]` **Homografía real**: `perspectiveMatrix3d(corners, viewport)`
  resuelve la homografía de 4 puntos (TL, TR, BR, BL → cuadro completo) y la
  emite como `matrix3d` en `transform`; va al final de la lista, así se aplica
  antes de translate/scale/rotate, igual orden que el render.
- `[done]` **Letterbox**: la caja del contenido replica `object-fit: contain`
  y el mapeo del MP4 (las esquinas se definen en píxeles del perfil sobre el
  frame ya escalado); cubre medios 4:3 en cuadros 16:9 y verticales.
- `[done]` **Integración**: video, imagen y gráfico pasan el viewport al
  transform de la preview (en pixel-perfect usa los píxeles reales del frame,
  no el tamaño ajustado a la etapa); el texto del Inspector ya no afirma que
  la preview no deforma.
- `[done]` **Medición real Chromium vs FFmpeg**: mismo frame sintético
  (320×180) y mismo cuadrilátero; dos marcas de color. Centroides CSS vs
  filtro `perspective` de FFmpeg 9.0.1: magenta **Δ 0,275 / 0,042 px** y cyan
  **Δ 0,109 / 0,022 px**; ambas marcas se movieron >5 px del origen. Test
  `e2e/perspective.spec.ts` 1/1 en 57,2 s.
- `[done]` **Tests**: 6 unitarios en `perspective.test.ts` (esquinas por
  defecto, cuadro completo, letterbox 4:3 y vertical, sin escena, cuadrilátero
  degenerado, medio sin tamaño) y 1 DOM en `App.test.tsx` que verifica el
  `matrix3d` en `.preview-media`.
- `[done]` **Verificación**: typecheck verde; suite **1293/1293 en 155
  archivos** en 63,07 s; `vite build` verde en 6,64 s. Sin Rust, sin
  commit/push ni rebuild del instalador.
- Límite honesto: la máscara y el blend siguen aplicándose en espacio del
  elemento (el MP4 aplica la perspectiva antes de la máscara); la caja de
  transformación interactiva no se deforma; la interpolación de muestreo de
  CSS no es idéntica a la de FFmpeg. En el caso medido, preview y MP4
  coinciden dentro de ±0,3 px.

## Lote Lottie real con alfa (2026-10-27)

- `[done]` **Motor**: `lottie-web@5.13.0` (MIT, JavaScript puro) con import
  dinámico; el chunk `lottie` pesa **307,87 kB (79,12 kB gzip)** y sólo se
  carga al abrir una preview o convertir. Se eligió sobre dotlottie-web porque
  no usa WASM y evita `wasm-unsafe-eval` en la CSP; su único `eval` es el
  intérprete de expresiones, que se rechaza al importar.
- `[done]` **Importación**: `.json` de hasta 8 MB, con validación de `layers`,
  `w`/`h` (≤8192), `fr` (≤120), `ip`/`op`, duración ≤300 s y ≤2000 capas. Las
  expresiones se rechazan con un mensaje explícito.
- `[done]` **Plan de salida**: escala a ≤1920×1080 con lados pares, fps 1–60 y
  tope de 900 frames; `trimmed` avisa cuando se recorta el final.
- `[done]` **Rasterizado real**: canvas fuera de pantalla, `goToAndStop` con
  subframes y PNG RGBA en base64 por frame. La preview en vivo usa el mismo
  motor y un damero que muestra la transparencia real.
- `[done]` **Backend**: `write_alpha_frames` / `alpha_frames_to_asset` /
  `discard_alpha_frames` escriben los PNG, codifican VP9 `yuva420p` con
  FFmpeg, importan a `media/` y marcan `media.alpha`; validan token, lote ≤24,
  frame ≤16 MB, secuencia ≤3600 frames y dimensiones pares.
- `[done]` **UI Motion**: panel Lottie (.json) con metadatos, fps de salida,
  autorización de derechos, progreso y agregado a Medios vía
  `markAssetReady(..., 'allowed')`. El video queda listo para montar.
- `[done]` **Prueba real en Chrome** (`e2e/lottie.spec.ts`, 2/2): la preview
  mide **3.600 px opacos / 36.400 transparentes** sobre 200×200, y el
  rasterizador de conversión mueve el centroide del cuadrado en los frames
  0/30/59 (49,5 → +30 → +30) con PNG RGBA.
- `[done]` **Prueba real FFmpeg**: secuencia 64×64 de 6 frames → WebM con
  `alpha_mode=1`; decodificado con libvpx, esquina alfa **0** y centro **255**.
  Overlay real sobre un video azul: centro **(252,0,0)** rojo de la animación y
  esquina **(0,0,252)** azul del fondo; 4.089 B, 1,000 s.
- `[done]` **Verificación del cambio**: typecheck verde; suite **1286/1286 en
  154 archivos**; `vite build` verde en 4,55 s; `cargo check --lib --tests`
  verde. Sin commit, push ni rebuild del instalador.
- Límite honesto: sólo `.json` (los `.lottie` ZIP no se abren todavía), sin
  expresiones, y el video se coloca a mano desde Medios (no hay auto-inserción
  en la timeline). El puente IPC de Tauri no se ejercitó en esta vuelta: el
  rasterizador y el codificador se midieron por separado, ambos reales.

## Lote paneo animado de pista en preview (2026-10-27)

- `[done]` **Preview**: `syncPreviewAudioPanAtFrame(project, frame)` muestrea
  `Track.panKeyframes` en el frame del playhead —clamp en los extremos,
  easing/Bézier por segmento y frames absolutos— y aplica la ley lineal del
  export a las ganancias L/R del grafo Web Audio. El paneo por clip conserva
  la prioridad: si un clip de la pista define `pan`, la pista queda al centro.
  Sólo recorre pistas con claves; las estáticas no pagan costo por tick.
- `[done]` `Preview.tsx` aplica el muestreo en cada cambio de `playhead`,
  además de la sincronización estática por proyecto; cubre reproducción y
  arrastre del playhead.
- `[done]` Tests: 4 nuevos en
  `apps/desktop/src/features/mixer/LiveMeters.test.tsx` (archivo 10/10):
  barrido -1→1 en frames 0 / 7,5 / 22,5 / 30 / 240; anclaje a frames
  absolutos 30 / 45 / 75; Bézier (0.42, 0, 1, 1) con ganancia derecha
  **0,6307136** en el frame 15 (golden
  `cubicBezierProgress(0.5, .42, 0, 1, 1) = 0,31535681250589304`, medido con
  node sobre `packages/project-schema/src/keyframes.ts`); y prioridad del
  paneo por clip (pista en 1,0/1,0).
- `[done]` **Coincidencia con Rust**: el muestreo replica
  `keyframe_expression` / `cubic_bezier_progress` con los mismos fixtures
  que `los_keyframes_de_paneo_*`. Segunda rebanada cerrada el 2026-10-27:
  el MP4 con paneo animado midió **R−L −13,99 dB** contra **−13,98 dB** de
  `panGains(sampleTrackPan(frame))` y **+3,88 dB** contra **+3,88 dB**;
  test live 1/1. Ver “Lote paneo animado de pista en export”.
- `[done]` **Artefacto de esquema**: `npm run schema:generate` agregó 72
  líneas al JSON Schema (denoise, chroma spill, perspective, offsetX/Y,
  note), todas derivadas del esquema TS; respaldo previo fuera del repo.
  `schema-artifacts.test.ts` 5/5.
- `[done]` **Verificación**: `npm run typecheck` verde; suite completa
  **1265/1265 en 150 archivos**; `npm run build` verde en 3,92 s. Un fallo
  intermitente de `App.test.tsx` bajo carga apareció una vez (pasó aislado
  50/50 y en la corrida final). Sin commit, push ni rebuild del instalador.

## Lote verificación de export 5 s (2026-10-27)

- `[done]` **Export real de 5 s a 24 fps medido**: paneo por clip con
  `astats` L −26,68 dB / R −20,66 dB → **6,02 dB** de diferencia, igual a la
  ley lineal de la preview (`panGains(0,5)` = 6,0206 dB). Opacidad Bézier
  (1 → 0 con (0.42, 0, 0.58, 1) sobre 119 frames): rojo promedio en los
  frames **0/64/119 = 252,0 / 112,0 / 0,0** contra **255,0 / 110,93 / 0,0**
  de la preview; el frame 64 queda a 1,07/255. No hizo falta corregir nada:
  el MP4 ya sigue la preview.
- `[done]` Test live permanente `render_live_5s_pan_astats_and_bezier_opacity_match_preview`
  en `apps/desktop/src-tauri/src/render/ffmpeg.rs`; incluye el golden
  `cubicBezierProgress(64/119, .42, 0, .58, 1) = 0.564961`, medido con node
  sobre `packages/project-schema/src/keyframes.ts`. Comando:
  `EDITOR_IA_RUN_RENDER_TESTS=1 node scripts/rust-env.mjs -- cargo test -p editor-ia-desktop --lib render_live_5s_pan_astats_and_bezier_opacity_match_preview -- --nocapture`
  → **1 passed, 0 failed, 412 filtered out** en 1,65 s.
- `[done]` Verificación del cambio: `cargo check -p editor-ia-desktop --lib --tests`
  verde en 50,59 s (solo warnings); `npm run typecheck` verde; `npm run build`
  verde en 7,52 s (`EditorWorkspace` 998,26 kB).

## Lote voz IA local Piper en el pipeline (2026-10-27)

- `[done]` Piper TTS empaquetado: binario Windows 2023.11.14-2, runtime
  ONNX/espeak y voz **es_ES-davefx-medium** (`resources/piper`, dataset CC0,
  aviso en `THIRD-PARTY-NOTICES.txt`). Todo offline; sin red ni credenciales.
- `[done]` UI en Descargas → look: **Generar voz IA local con Piper** + guion
  editable (máx. 4000 caracteres) + marca de agua opcional (`watermark.png`).
- `[done]` Hook: después de yt-dlp, `piper::synthesize` escribe
  `cache/downloads/<run>/voice_ia.wav`; el pipeline usa ese WAV como audio
  final, fuerza H.265 CRF 22, superpone la marca y calcula MD5. Si falla Piper,
  avisa y conserva el audio disponible; el video no se pierde.
- `[done]` Limpieza: se eliminan el video original, `voice_ia.wav` y la caché
  después de verificar el render. El archivo final va a
  `Videos descargados/<Plataforma>/<Título>`.
- `[done]` Tests Piper 4/4 (guion vacío, límite, recursos y síntesis real) y
  render real voz + watermark con video y audio.
- `[done]` Instalado: instalador 249.268.584 B, SHA
  `A9D25943DABFE10519DE6D53E7262705CDF9C43599666DEA4E83C0EF509950EE`,
  firma válida. Instalado 69.295.072 B, SHA
  `1C80E6127365FDBA9442108CF206BEA8333C5BE7761849CA64E2F7F386C578AD`,
  firma válida, app abierta (PID 19320). Recursos `piper/` y `watermark.png`
  verificados en la instalación; Piper sintetizó un WAV desde esa copia.
- `[done]` `npm run typecheck`: verde. Suite completa serial:
  **893/893 en 129 archivos**; bajo carga hubo flakes aislados de Lottie y
  teclado, cada archivo pasó por separado.

## Lote Post-Download Pipeline Hook (2026-10-27)

- `[done]` El post-proceso corre **dentro del mismo hilo bloqueante que
  yt-dlp**, en `cache/downloads/<run>` y antes de `move_download_to`. No hay
  una segunda descarga ni una segunda UI: al terminar yt-dlp se ejecuta el
  pipeline y recién después se despacha el archivo final a la carpeta
  `Videos descargados/<Plataforma>/<Título>`.
- `[done]` Modo **Pipeline automático** (checkbox dentro del look):
  - denoise `hqdn3d=1.86:1.39:2.80:2.15` + flujo óptico 60 fps + 0.98× +
    gamma/contraste/saturación + zoom 4 % por tercios + espejo + grano, en
    **una sola pasada** de FFmpeg.
  - salida **H.265 (libx265) CRF 22**, `hvc1`, 60 fps, `yuv420p`.
  - audio: si se eligió banda, se reemplaza y masteriza con
    `loudnorm=I=-14:TP=-1.5:LRA=11,apad`; sin banda, conserva el audio
    original limpio con `highpass=80,afftdn,loudnorm`; si no hay audio, `-an`.
  - **MD5 nuevo** del archivo final (crate `md-5`) y se muestra en el
    resultado; el original temporal se elimina después de verificar el
    render. El despacho final conserva el MD5.
  - El look manual sigue existiendo (H.264, sin denoise, sin audio original)
    para comparar; el pipeline automático es el modo de producción.
- `[done]` Audio original opcional: **1,02× con `atempo`** + ruido rosa
  `anoisesrc=color=pink:amplitude=0.003162` (**−50 dB**), mezclado con
  `amix=normalize=0` y `alimiter`; después se normaliza a −14 LUFS. Reemplaza
  la pista original. Si hay banda elegida, la banda tiene prioridad y esta
  opción se desactiva. Funciona en look manual y pipeline automático.
- `[done]` Tests Rust: filtro con denoise antes del look, foco por tercio,
  cadena de audio 1,02×/ruido, render real H.265 + MD5, y audio original
  limpio/ruido + banda reemplazada.
- `[done]` Verificación: typecheck completo verde; suite desktop **885/885 en
  128 archivos**; render real H.265 60 fps con MD5 y audio verificado. La corrida real con ruido y 1,02× pasó.
- `[done]` **Instalado** (con audio 1,02× + ruido): instalador 170.795.896 B,
  SHA `6E74B3F37D10A5B5442222EC9B682FC149DB8DC71E8123889F996231BE760DDB`,
  firma válida. Instalado 66.401.760 B, SHA
  `FC0BAB8E1ABFF3A61D9D40FC7E0A9B3BDE9A74006F00EB5E2E9B3D9BFB173514`,
  firma válida, app abierta (PID 14400).
- Nota: el pipeline se ejecuta dentro del `spawn_blocking` de la descarga;
  no bloquea la UI y el archivo no se mueve a destino hasta que termina.

## Lote look cinematográfico 35 mm en Descargas (2026-10-27)

- `[done]` Opción **Look cine analógico 35 mm** en el descargador (sólo MP4):
  `setpts=PTS/0.98` → `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:vsbmc=1`
  (flujo óptico real, 60 fps) → `eq=gamma=0.95:contrast=1.08:saturation=1.12`
  → zoom 4 % con recorte por tercios → `hflip` → grano `noise=alls=8:allf=t+u`
  → H.264 CRF 20, 60 fps.
- `[done]` Reencuadre elegible: centro, tercio izquierdo/derecho/superior/inferior.
  No hay detección de sujeto: el foco lo decide la persona.
- `[done]` Audio: quita la pista original. Si se elige una banda, se mapea,
  se masteriza con `loudnorm=I=-14:TP=-1.5:LRA=11,apad` y se corta al largo
  del video. Sin banda, el MP4 sale sin audio.
- `[done]` La compresión elegida se omite con un aviso: el look ya reencodea.
  El denoise posterior se desactiva mientras el look está activo.
- `[done]` Tests Rust: filtro completo, foco por tercio y render real opcional:
  clip 160×90 → salida 60 fps, dimensiones pares, y variante con banda de
  audio que conserva video + audio.
- `[done]` Verificación: typecheck completo verde; suite **870/870 en 126
  archivos** (la primera corrida tuvo un fallo intermitente de App.test bajo
  carga y la segunda pasó completa); `cargo test` dirigido 3/3; render real
  con y sin banda sonora OK.
- Límite honesto: el flujo óptico es costoso; el grano es fijo y el foco no
  detecta rostros/acción. Los parámetros creativos se muestran en la UI.
- `[done]` **Instalado**: instalador 166.109.760 B, SHA
  `BA29CCBDBFAB58C65255D3C8B9FBA7C225C4E9BF99344724FB53302B2F374AA8`,
  firma válida. Instalado 61.480.928 B, SHA
  `0BFB4C7C6BC8A605A6AED4B9C9DF35C2CF7C8E22340424E97774CB1C91A49053`,
  firma válida, app abierta (PID 26500).

## Lote orden y usabilidad (2026-10-27)

- `[done]` Topbar: botón **Buscar** visible (Ctrl+K) que abre la paleta. La
  paleta ahora genera sus comandos de navegación desde `NAV_VIEWS`: ninguna
  vista queda afuera, incluidas Automático, YouTube, VFX, Mezcla, Denoise,
  etc. Test `commands.test.ts` verifica las 29 vistas.
- `[done]` Inicio: nuevo desplegable **Todas las herramientas**, agrupado en
  Crear/Herramientas/Sistema, con descripción de cada vista. Accesos rápidos
  a Editor, Automático y YouTube. El sidebar dice “HERRAMIENTAS”, no “IA”.
- `[done]` Producción: un proyecto sólo con videos ahora puede montar (antes
  exigía imagen); el mensaje y el paso “Recursos” lo reflejan.
- `[done]` Guion: el selector de voz usa `voice.id` (no el nombre visible) y
  deja de rotular “local” cuando el proveedor es externo.
- `[done]` Publicación: sin clips en la timeline muestra “Sin contenido”,
  avisa por qué y deshabilita manifiesto/EDL/OTIO/FCPXML; materiales y
  subtítulos ya no aparecen en verde por vacuidad.
- `[done]` Automático: confirmación antes de reemplazar con conteo de clips,
  pistas y subtítulos; avisa si los subtítulos de la variante no se aplicarán
  y unifica el aviso de aplicar (reemplazó/agregó + deshacer).
- `[done]` YouTube: textos corregidos (el score usa sólo los videos con
  detalle, no todos los listados), el informe anterior se conserva al
  reanalizar o fallar, y la barra de progreso tiene `progressbar` + porcentaje.
- `[done]` Descargas: los avisos de denoise ya no se pierden al importar, el
  progreso de denoise se refleja en la barra y la etapa dice “Procesando”.
- `[done]` VFX: se quitaron las ruedas Lift/Gamma/Gain decorativas que
  parecían controles; “Detectar fondo” reemplaza la etiqueta contradictoria
  “Sin pantalla verde”; reiniciar polígono y quitar máscara piden confirmación.
- `[done]` Verificación: typecheck completo verde; suite desktop **870/870 en
  126 archivos**.
- `[done]` **Instalado**: instalador 165.137.600 B, SHA
  `E9692C29E2D48BAEF9893177D7DD0E9EC303C829903A26DF30FECD58782073FB`,
  firma válida. Instalado 59.954.144 B, SHA
  `5C61ADC886E14A4861C4D15BD4CD25BE95FDE47D662F5AB2133499BB3F03041D`,
  firma válida, app abierta (PID 20004).
- Nota: de los 20 agentes solicitados, el runtime cortó por límite de crédito
  tras 5 auditorías completas; los hallazgos restantes se revisaron y
  corrigieron en esta misma pasada. Sin commit ni push.

## Lote analizador de canales de YouTube (2026-10-27)

- `[done]` Vista **YouTube** en herramientas: pegás un `@handle` o URL de canal,
  y la app lista hasta 100 videos con yt-dlp. El detalle se reparte entre los
  más vistos y los más nuevos (8–24 videos) para no golpear la red.
- `[done]` Por video: vistas, likes, comentarios, duración, fecha, vistas/día,
  engagement (likes + 2×comentarios), score 0–100, flags de título y razones.
  Ranking por vistas/día (45), engagement (35) y recencia (20).
- `[done]` Miniaturas: descarga la mejor resolución, mide brillo, saturación,
  contraste y paleta, y devuelve un preview JPEG en data URL (CSP-safe).
- `[done]` Comentarios: lee hasta 40 de los 1–5 mejores videos, calcula
  sentimiento con léxico local, palabras clave y comentarios más gustados.
  Sin LLM ni servicios externos.
- `[done]` Informe de canal: suscriptores, mediana de vistas, engagement medio,
  cadencia semanal, mejor día/hora UTC, duración mediana, patrones de título
  (números/preguntas/tutoriales/listas), palabras frecuentes, miniaturas,
  fortalezas y oportunidades. El “mejor video” se etiqueta como muestra, no
  como historial completo.
- `[done]` Tests: 6 unitarios Rust (URLs, flags, sentimiento, scoring, imagen,
  fechas), 2 de UI, typecheck y suite desktop **867/867 en 125 archivos**.
- `[done]` Prueba de red real: Computerphile, 4 videos detallados, mejor
  `h6j_ixGnpiY`, 40 comentarios analizados, 35,68 s; miniaturas y comentarios
  presentes.
- `[done]` **Instalado**: instalador 163.689.928 B, SHA
  `AB2F6BB034AC8EC70EF96B32A12BD5CCF8E332C847D9EC6450DB2918B0A892E4`,
  firma válida. Instalado 58.520.032 B, SHA
  `32D5BFC9C863CF92FEC9463EF5F22F454EF790F289329ADF6B7B64174446C376`,
  firma válida, app abierta (PID 23908).

## Lote editor automático sin LLM (2026-10-27)

- `[done]` Vista **Automático** en herramientas: elegís un video, la app mide
  escenas, silencios, negros, congelados y loudness con FFmpeg y genera tres
  variantes: **Pulso rápido**, **Historia** e **Impacto** (highlight de
  15–30 s). Sin LLM, sin servicios externos.
- `[done]` Aplicar una variante crea clips reales en la timeline (reemplaza o
  agrega al final), con cortes por escena/silencio, transiciones dissolve,
  zoom punch-in con keyframes, y audio mejorado: high-pass 80 Hz, low-pass
  16 kHz, denoise, de-esser, compresor, EQ medio y gain calculado a −14 LUFS.
- `[done]` Subtítulos sin IA: extrae el primer subtítulo incrustado del video
  (prefiere español) a SRT con FFmpeg, o importa SRT/VTT. Los textos se
  remetean al tiempo de salida de cada corte. La transcripción Whisper local
  queda **opcional y apagada** por defecto.
- `[done]` El planner no inventa texto: si no hay subtítulos incrustados ni
  archivo, la variante se crea sin subtítulos y lo avisa.
- `[done]` Verificación: typecheck limpio; suite **865/865 en 124 archivos**;
  extracción real de un MKV con pista `spa` a SRT validada con FFmpeg.
- `[done]` **Instalado**: instalador 162.871.824 B, SHA
  `BD0C3E53FD11322AD0C84FB5F87F33D261B5D1831CFA6A9EDCFF6A4C870B0519`,
  firma válida. Instalado 56.823.776 B, SHA
  `C701599261193431742CC67FF73011DCFD63DBE39EFC428D690A4A6276173CD0`,
  firma válida, app abierta (PID 9208).
- ~~Pendiente: exportar las tres variantes a MP4 separados en un solo lote~~
  **resuelto (2026-11-07)**: tarjeta «Exportar variantes» en
  `AutoEditView` + `features/autoedit/auto-edit-export.ts`
  (`write_project_variant` + `render_project_variant`, MP4 verificado por
  variante, timeline intacta). ~~Siguen pendientes del mismo lote: preview
  antes de aplicar y umbrales de escena configurables~~ **umbrales
  resueltos (2026-11-07)**: tarjeta «Umbrales del análisis» en
  `AutoEditView` + umbral de escena en `DirectorView`. ~~Sigue pendiente:
  preview antes de aplicar.~~ **preview resuelto (2026-11-07)**: «Mapa del
  material por video» en cada tarjeta (`buildSourceUsage`), con tramos
  conservados y huecos medidos por fuente. Con esto el lote queda cerrado.

## Lote chroma con y sin pantalla verde (2026-10-27)

- `[done]` VFX: preview de clave real sobre damero en el visor, sin exportar.
  Canvas limitado a 1280 px para no bloquear los sliders; toggle “Vista de
  clave / original”.
- `[done]` Controles: color clave, similitud, suavizado y **derrame**; presets
  “Verde” y “Azul”. El derrame se aplica al export con `despill` sólo en
  pantallas verde/azul.
- `[done]` Sin pantalla verde: “Detectar fondo” elige la esquina más uniforme
  del frame actual como color clave (pared, tela, cielo). Si el fondo tiene
  textura o personas, el panel enlaza a Quitar fondo (IA).
- `[done]` Schema: `chromaKey.spill` opcional 0..1; tests de chroma 6/6.
- `[done]` Tests: 4 unitarios de la clave (verde, color arbitrario, borde
  suave, derrame y píxeles opacos) + 1 de UI de la cadena VFX.
- `[done]` FFmpeg real: fondo verde → azul `(0,0,254)` y sujeto rojo
  `(250,0,0)` tras `chromakey + despill`; tests Rust 2/2.
- `[done]` Verificación: typecheck limpio, suite completa **853/853 en 122
  archivos**, `cargo check --release` verde.
- `[done]` **Instalado**: instalador 161.749.496 B, SHA
  `F2E0D1DFDBF3351F99F7369B90173461F1CD0E6C032C234DEC3D4E99854F33C7`,
  firma válida. Instalado 55.405.024 B, SHA
  `C82A56C5EF16B54892D043C83A20DAFB4B1CE926ABE00CF2167A2C4E7A6B7925`,
  firma válida, app abierta (PID 26728).
- Límite honesto: la vista es una aproximación RGB del chromakey YUV del
  export; sirve para encuadrar la clave, el MP4 sigue siendo la referencia.

## Lote rendimiento y ruido (2026-10-27)

- `[done]` Arranque: el splash ya no retiene 4 s; mínimo 0,9 s (≈3,1 s
  menos cuando la app está lista). `src-tauri/src/lib.rs`.
- `[done]` Carga: la precarga en ocioso pasó de 27 vistas a 8 de uso
  frecuente (home, editor, medios, descargas, mezcla, VFX, director,
  fábrica) y arranca a los 1,2 s en vez de 0,35 s. Las demás se cargan al
  abrirlas. 27→8 pedidos de chunk.
- `[done]` Descargas: el default pasó de recomprimir H.265 CRF 24 a
  “Original · sin recomprimir”. Medido con un clip 1080p30 de 10 s:
  remux **172 ms / 9,6 MB** vs H.265 **9.685 ms / 8,5 MB** (56× más
  lento y con pérdida). Además `--concurrent-fragments 8` y
  `--http-chunk-size 10M`.
- `[done]` Ruido al descargar: opción “Reducir ruido del video al
  importar”; aplica Denoise Studio (FFmpeg hqdn3d) antes de importar y,
  si falla, importa el original con aviso.
- `[done]` Ruido en el editor: nuevo `effects.denoise` (0..1) por clip,
  slider en Inspector y VFX, `hqdn3d` temporal en el export. La UI aclara
  que la preview no lo simula. Medido sobre un clip sintético con ruido:
  SSIM 0,6075 → 0,6335 con fuerza máxima.
- `[done]` Denoise Studio: el resultado se puede **Importar a Medios**
  sin salir de la vista.
- `[done]` Render: publicar el MP4 verificado usa `rename` y sólo copia
  si el sistema no puede moverlo; se evita duplicar la escritura de
  archivos grandes. Tests de mover y reemplazar salida.
- `[done]` Render/UI: la detección de encoders se cachea por ruta de
  FFmpeg; la primera apertura mide y las siguientes son instantáneas.
- `[done]` Verificación: typecheck limpio; suite completa **848/848 en 121
  archivos**; `cargo check --release` verde; Rust de publish 2/2 y filtro
  visual 1/1.
- `[done]` **Instalado**: instalador 160.596.504 B, SHA
  `CA35269D1134F237575550E69A231458A5F7100A0EFD252C8408460DC6608B0A`,
  firma válida. Instalado 54.035.936 B, SHA
  `26AFDE1B229AECA4538F35AC951F3E5147C56902C0BF80BEF8A874997A6E0933`,
  firma válida, app abierta (PID 19388). La ventana apareció a los
  **1.284 ms** del lanzamiento (antes el mínimo del splash era 4 s).

## Lote relink de medios (2026-10-27)

- `[done]` Medios: botón “Reconectar archivo…” por material. Reimporta el
  archivo con el mismo pipeline (copia a `media/`, mide, hashea), conserva
  id, nombre, licencia, etiquetas, bin y los clips en su lugar; descarta el
  proxy viejo. Rechaza un tipo distinto o un archivo más corto que el
  `outFrame` de cualquier clip, también dentro de compuestos.
- `[done]` Tests: proyecto 96/96 (2 nuevos de relink), Medios 7/7 con el
  botón presente; typecheck limpio.
- `[done]` **Instalado**: instalador 159.349.448 B, SHA
  `CDE09121D460D23585EB2EDE9246BD522C212EF9FD5778698E4386228414F9E0`,
  firma válida. Instalado 52.680.160 B, SHA
  `895973C0F43E627428709993690C6034422A5B1580D07DCA136D1B690C0D488A`,
  firma válida, app abierta (PID 13264).

## Lote verificación y accesibilidad (2026-10-27)

- `[done]` Seguimiento facial: el backend informa tiempos relativos al rango
  analizado; ya no se resta `inFrame` dos veces. Test 5/5.
- `[done]` Fábrica: checkbox explícito de autorización de créditos; el pedido
  usa la decisión del usuario y el orquestador expone advertencias reales del
  log. Test 2/2.
- `[done]` Inspector: tabs con flechas/Home/End, `tabIndex` móvil, ids y
  `aria-controls`; panel con `role=tabpanel`.
- `[done]` Mezcla: aviso visible cuando el paneo de pista queda omitido por
  clips con paneo propio. Test 6/6.
- `[done]` VFX: la vista aclara que chroma, sharpen y viñeta se aplican recién
  en el export; no promete una preview que no existe.
- `[done]` Gate del render: además del contenedor, exige pista de video y de
  audio y que la duración declarada de cada pista coincida con la timeline.
  4 tests unitarios + 2 pruebas reales con FFmpeg (sin audio se rechaza; un
  render con paneo 0,5 pasa y mide L −26,7 / R −20,7 dB).
- `[done]` Typecheck limpio; tests dirigidos 121/121; `vite build` verde.
- `[done]` Instalado el checkpoint con face/Factory/tabs: instalador
  157.048.296 B, SHA
  `7CE2193515EACA497357AC860DB77B981FB56B2BFFBA3E88B027DB8797E2C876`,
  firma válida. Instalado 49.941.984 B, SHA
  `BA0D740B60EF45958D8F0FD42957FA5F430B3EAA125381465D20070C536312D9`,
  firma válida.
- `[done]` **Instalador final de este lote**: 159.143.440 B, SHA
  `535E3CF4D4FC10A72B4F451D25509A96BD86581CFD4963E2C489426383212CB2`,
  firma válida. Instalado 51.348.448 B, SHA
  `DED52060BD30F570AC7C95271704883408609F6AF296EACB85DB2EE4776EB50B`,
  firma válida, app abierta (PID 17144).

## Lote UX/medios (2026-10-27)

- `[done]` Scopes: FilmCraft conserva el último Parade en vez de vaciarlo.
- `[done]` Preview: feather usa la máscara SVG (ya no se ve dura); imágenes y
  videos rotos muestran “no disponible” con botón Reintentar, sin tocar el
  proyecto.
- `[done]` Contraste: tabs activas y flags del mixer usan `#9ec1ff` (5,19:1).
- `[done]` Reconstruir e instalar: instalador 156.431.264 B, SHA
  `fa6d35ab2ab956db548911a8184cf0b32d888f9ad87cebe83172980dc66e618e`,
  firma válida. Instalado 48.561.120 B, SHA
  `f599275bd6fbe4b3a4f48a179a0a393e8d3ad7edb6bedaaa8f3c4feafb381635`,
  firma válida, app abierta (PID 23544).

## Lote arreglos (2026-10-27)

- `[done]` Timeline: clic sin arrastre ya no mueve/cierra huecos; dividir
  reparte keyframes; trim-start rechaza superposición. Tests 93/93.
- `[done]` SRT sin línea en blanco, huecos de subtítulos ordenados y color de
  caja ASS. Tests 13/13.
- `[done]` LUT se conserva al elegir look/neutro; HSL y color match de capas
  de ajuste llegan al MP4.
- `[done]` Factory usa un nombre único por variante.
- `[done]` Seguridad: import de timelines confinado a root/base, capability
  `opener` retirada y clave PEM movida a `D:\Users\ofici\QODER-WORK\_keys`.
- `[done]` Suite flaky: el worker moría por un bucle de render en
  `TrackAutomationPanel.test.tsx`; los efectos ahora comparan antes de
  escribir y el archivo pasa 7/7 en 3,7 s.
- `[done]` Reconstruir e instalar: instalador 155.595.344 B, SHA
  `306ba1a22255d6f445bf077ba666a5f6822c785c86ed5442cfb94dc342e9f197`,
  firma válida. Instalado 47.188.448 B, SHA
  `a2bfcc86ce57a0641cb8e50fa8afc23ff5f8f05ad3756081647ee7d2db4ca6c3`,
  firma válida, app abierta (PID 7792).

## Lote perspectiva (2026-10-27)

- `[done]` **Perspectiva a 4 puntos**: schema `PerspectiveSchema` (convexidad y
  área), 8 campos en Inspector, filtro Rust `perspective=...:sense=source` y
  tests de schema + filtro. Se ve en Frame real y export; la preview CSS no
  deforma la imagen.
- `[done]` **Reconstruir e instalar**: instalador 154.122.584 B, SHA
  `904a8d575f97b5bcb9179054714215f4519cc54f5caa98ed2dfb4fc7b2b0d4e1`,
  firma válida. Instalado 45.900.256 B, SHA
  `0c8e16b04a718d0e0ebe377d0795e4e66402ca296739b7690cd509fb90ed25af`,
  firma válida, app abierta (PID 26912). Filtro validado con cuadrícula real:
  el cuadrilátero de origen llena el cuadro, sin esquinas negras.
  Límite: la preview CSS no deforma; se usa **Frame real** o export.

## Pendientes priorizados

1. **Reconstruir e instalar este lote** `[done]` — instalador
   153.000.616 B, SHA `f9b4086340173959201c78ffeedb685b5609423ffd153f55f7fc3d96591122a2`,
   firma válida. Instalado: 44.548.576 B, SHA
   `6e8029f64f01215ffce8a17da3cf113a19ce52673d3de4adea783cf23c2edbae`,
   firma válida, app abierta (PID 28032) y respondiendo.
2. **Export MP4 real de 5 s** `[done]` — paneo L/R por `astats` 6,02 dB
   (preview 6,0206) y opacidad Bézier 252,0 / 112,0 / 0,0 en frames
   0/64/119 (preview 255,0 / 110,93 / 0,0); test live 1/1. No difiere.
3. **Gate de render por stream** `[done]` — `verify_output` exige video y
   audio y compara la duración declarada de cada pista; 4 tests unitarios y
   2 reales con FFmpeg.
4. **Suite completa en rojo intermitente** `[done]` — 121 archivos,
   846 tests, 0 fallos (2026-10-27).
5. **Automatización de paneo de pista en preview** `[done]` — la preview
   muestrea `panKeyframes` por frame (4 tests, archivo 10/10) y el MP4 sigue
   la misma ley: **−13,99 vs −13,98 dB** y **+3,88 vs +3,88 dB** en las dos
   mesetas, medido con `astats` (test live 1/1). De paso se corrigió el
   límite de línea de comandos del grafo largo (35.271 → archivo) y un panic
   de perspectiva; suite Rust 412/412. Ver “Lote paneo animado de pista en
   export”.
6. **Lottie real (MIT)** `[done]` — lottie-web 5.13.0 (sin WASM), PNG RGBA →
   comando Tauri → WebM VP9 `yuva420p` → asset con `media.alpha` en Medios;
   overlay real medido (centro 252,0,0 / esquina 0,0,252). Ver “Lote Lottie”.
7. **Perspectiva de metraje** `[done]` — la preview aplica la misma homografía
   4 puntos que el filtro `perspective` del MP4, con letterbox; medido en
   Chromium contra FFmpeg 9.0.1 (Δ ≤ 0,28 px). Ver “Lote perspectiva en
   preview”. Límite: máscara/blend y caja interactiva siguen sin deformarse.
8. **Updater y timestamp** `[partial]` — la 0.2.0 ficticia, los canales
   decorativos y la descarga simulada ya no existen: el modal informa "sin
   canal configurado" y el lanzador no anuncia actualizaciones (typecheck
   verde, 1299/1299, build 7,46 s, e2e Chrome 1/1). Falta la decisión del
   usuario: certificado de firma con sello de tiempo y endpoint del
   manifiesto; recién entonces hay comprobación y descarga reales.
9. **Partir `EditorWorkspace` (~998 kB)** `[done]` — shell **999,83 →
   53,62 kB** (gzip 192,78 → 18,25); Inspector 138,90, Timeline 40,13,
   EditorAssets 25,35 y EmojiPicker 719,71 salen como chunks propios y
   ExportDialog 24,73 se carga al abrirse. `COLOR_LOOKS` se movió a
   `color-looks.ts`. Typecheck verde, suite raíz 1310/1310 en 160 archivos,
   build 6,12 s. Ver “Lote partir EditorWorkspace”.
10. **Accesibilidad restante** — partido en tres; 10a y 10c cerrados.
    - 10a `[done]` **Menú con teclado y foco** — roving tabindex, ←/→ entre
      menús, ↓/↑ con primer/último ítem, Enter/Espacio, Escape devuelve el foco
      al disparador y no propaga, Tab cierra, `aria-checked` con
      `menuitemcheckbox`. `MenuBar.test.tsx` 8/8, suite **1321/1321 en 160
      archivos** en 53,89 s, build 8,33 s. Ver “Lote accesibilidad del menubar”.
    - 10b `[done]` **Contraste de guías de curvas** — `KeyframeCurveEditor`
      define y exporta `CURVE_CANVAS_BG` (`#0a0f1e`), `GUIDE_CENTER_COLOR` (`#6b7480`,
      **4,03:1**) y `GUIDE_BOUNDS_COLOR` (`#7b8591`, **5,10:1**), ambas superando
      el ratio mínimo de 3:1 de WCAG 2.1 SC 1.4.11. `KeyframeCurveEditor.test.tsx`
      **12/12** (incluyendo el test unitario de ratio de contraste sRGB).
    - 10c `[done]` **Etiquetas de paneo** — verificado en código: la mesa usa
      `aria-label` «Paneo de <pista>» + `aria-valuetext` con `panLabel`
      (C / L 40 / R 25); la automatización rotula cada clave por pista y
      timecode; el paneo de clip del Inspector es un `NumberField` dentro de un
      `<label>` con el texto «Paneo (−1 izq · +1 der)».
11. **Medios faltantes** `[done]` — fallback y Reintentar, más “Reconectar
    archivo…” en Medios: reimporta, conserva id/nombre/licencia/etiquetas y
    rechaza tipo distinto o archivo más corto que un clip.
12. **Documentación honesta** — README con hashes/counts actuales, Lottie
    documentado con sus límites (`.json`, sin expresiones) y 3D marcado como
    pendiente, no como hecho.
13. **Face tracking con inFrame>0** `[done]` — `maskFromFaceTrack(result,
    fps)` usa tiempos relativos; test 5/5.
14. **Factory permisos y warnings** `[done]` — consentimiento explícito de
    créditos y avisos reales del log; test 2/2.
15. **Paneo: precedencia visible y reset unificado** `[done]` — la mesa avisa
    cuántos clips omiten el paneo de pista (test 6/6) y ahora ambos lados
    tienen reset «Centro» visible: en Mixer un botón junto al valor que
    aparece sólo con paneo ≠ 0 (el doble clic se conserva), y en el Inspector
    un «Paneo: centro» que borra `audio.pan` del clip. Antes había que saber
    que el doble clic o tipear 0 centraba. MixerView.test **7/7** (test nuevo
    del botón), `tsc --noEmit` 0.
16. **VFX preview honesta** `[done]` — la vista marca chroma, sharpen y
    viñeta como solo export; no se muestran inertes.
17. **Emoji diferido** `[done]` — el catálogo (~240 kB fuente) y el popover se
    extrajeron a `EmojiPickerPopover.tsx` con carga perezosa (`React.lazy`) y
    precarga en hover/focus. El chunk cargado al montar el editor cayó de
    **719,66 kB a 2,78 kB** (gzip 113,10 → 1,22 kB, reducción del **99,6%**).
    El chunk diferido `EmojiPickerPopover` (717,61 kB / 112,37 gzip) se descarga
    únicamente al interactuar con el selector. Tests unitarios y de accesibilidad
    (trampa de foco, Escape) 12/12 verdes.
18. **Composición opaca en yuv420p** — si ningún clip necesita alfa
    (sin chroma, máscara, opacidad, blend ni transición), componer sin
    RGBA. Un benchmark externo midió −32% (2,08→1,41 s) con salida
    idéntica; verificar con PSNR/SSIM y los tests live antes de adoptarlo.
19. **Playhead fuera del contexto** — hoy cada tick de reproducción
    re-renderiza paneles; separar el playhead y memoizar mapas de clips
    en Preview. Medir frames >16 ms en 10 s de playback.
20. **Denoise de audio en preview** — el `afftdn` del export no se
    simula en Web Audio; evaluar un filtro aproximado o marcar la
    diferencia en la UI.
21. **Automatización de fader de pista en preview** `[done]` — `trackAudioParams()`
    en `usePreviewAudio.ts` ahora muestrea `track.gainKeyframes` con `sampleTrackGain()`
    en el frame actual; `syncPreviewAudioAtFrame()` actualiza tanto fader como
    paneo animado en cada cambio de playhead. 4 tests nuevos en `LiveMeters.test.tsx`
    verifican la escala logarítmica/dB (`10^(dB/20)`), idéntica interpolación
    Bézier al export Rust, clamp de extremos y coexistencia de fader + paneo.
    14/14 tests verdes en LiveMeters y 144/144 en la suite editor/mixer.
22. **Lottie: `.lottie` y prueba IPC nativa** — abrir el ZIP `.lottie` con
    `fflate` (ya es dependencia) y ejercitar la conversión completa en la app
    nativa, IPC incluido, midiendo el WebM resultante.

## Color completamente configurable (2026-11-03)

Detalle técnico y contrato: `docs/COLOR-CUSTOMIZATION.md`. Verificación
independiente: `.tmp-theme-shots/after/report.json` + `METHOD.md`.

- `[done]` **Motor de paleta** — `state/theme-palette.ts` (nuevo): **34 tokens**
  en 5 grupos (superficies, acento, estados, medios, marca), 7 presets completos,
  derivación desde los 5 colores base, **66 variables CSS** emitidas (34
  `--color-*` + alias `--commercial-*`/`--olyvia-*`, estados con fallback,
  degradado/glow/borde/tinta de marca, glows y `--primary-hue`), contraste WCAG
  (`themeContrastReport` con 10 pares, `ensureContrast`, `fixTextContrast`) y
  archivo de tema estricto `olyvia-theme`. Compatibilidad v4: datos con sólo los
  5 colores se migran solos. **38 tests** de motor + 14 de apariencia.
- `[done]` **Estudio de color en Ajustes** — `ColorStudioCard`: 34 filas con
  color picker + hex + reset por token, 5 grupos colapsables, preview vivo del
  shell, reporte de contraste con «Corregir texto», exportar/importar tema JSON
  y restablecer con confirmación. **10 tests** + 3 de `AppearanceCard`.
- `[done]` **Tokenización de todas las capas CSS** — `commercial`, `olyvia`,
  `flat`, `chrome`, `resolve-theme`, `app`, `home`, `start-screen`, `settings`.
  Literales de rol que ganan la cascada: **24 → 0**. `resolve-theme.css` (última
  capa con `!important`) pasó de 162 a 7 hex y ya no aporta roles; `app.css`
  497→243 (restantes: sombras, fallbacks y secciones legacy pisadas).
  `start-screen.css` 261→0 y `home.css` 16→0.
- `[done]` **Marcadores semánticos unificados** — `MarkersPanel` y timeline usan
  las mismas clases `.marker-*` + `var(--marker-color)`; 6 categorías
  distinguibles por defecto y todas siguen la paleta.
- `[done]` **Fix de persistencia del picker** — el input nativo de color no
  siempre deja foco: el commit dependía de blur/pointerup y elegir color +
  cerrar con Escape perdía el cambio. Ahora hay commit agrupado (320 ms) además
  de blur/pointerup. Verificado en Chrome real con recarga.
- `[done]` **E2E del tema** — `e2e/theme.spec.ts` (7 tests): acento/panel en
  vivo, persistencia, import válido/inválido, export `olyvia-theme` con 34
  tokens, contraste fail→pass, tema claro y medición de cobertura. Config de
  Playwright alineada al puerto 3000 (antes apuntaba a 5173 y levantaba un
  segundo Vite) y fix de arnés `exact: true` en `helpers.ts`.
- **Verificación**: `theme.spec` **7/7** (22,6 s), `settings.spec` **4/4**;
  `npm run typecheck` exit 0; `npm run build` exit 0 (5,24 s); suite serial
  **1829 passed / 3 skipped** (205/206 archivos). Verificador independiente:
  cobertura de tema **66,7 %** (806/1209 propiedades), **0 tokens sin efecto
  visible** y **0 literales de rol** ganando la cascada.
- `[done]` **Tema claro: derivación AA en `paletteFromBase` (2026-11-07)** —
  el motor ya no deja nacer ilegible un tema claro personalizado. Antes los
  presets derivados (`custom` y los 6 oscuros) copiaban `STATUS_DEFAULTS` /
  `MEDIA_DEFAULTS` medidos sobre superficies oscuras: con fondo claro los
  estados caían a ~2,4:1. Ahora, sólo cuando `relativeLuminance(bg) > 0.55`,
  el acento sube a 3:1 sobre bg, los estados a 4,5:1 y los medios a 3:1 sobre
  `surface`, `accentInk` se reasegura contra el acento ajustado y los textos
  derivados pasan por `fixTextContrast`. Las paletas oscuras son bit a bit
  idénticas (`ensureContrast` no-op) y `LIGHT_PALETTE` no pasa por esta vía.
  Además `.start-thumb-hint` (Inicio) dejó el `color-mix(text 42%)` por
  `var(--color-text-faint)`, token medido AA en ambos esquemas.
  - **Archivos**: `state/theme-palette.ts`, `state/theme-palette.test.ts`
    (+1 test), `styles/start-screen.css`.
  - **Verificación**: `theme-palette.test` **44/44** + `appearance.test`
    **15/15** · `tsc --noEmit` 0.
  - **Residual honesto**: una paleta clara *guardada* por el usuario conserva
    sus tokens (el motor no pisa datos persistidos; el estudio los reporta y
    «Corregir texto» los sube). Los 13+8 pares medidos en Ajustes/Inicio se
    corrigen en origen para temas derivados; si quedan literales sueltos en
    otras vistas, se miden en la próxima pasada e2e de tema claro.
- `[done]` **Preset accesible de fábrica** — nuevo preset `contrast` («Alto
  contraste», oscuro) con paleta explícita de 34 tokens: texto 17-18:1,
  atenuado 8,6:1, tenue 4,8:1, acento 6,3:1, tinta/acento 6,3:1, estados
  4,9-11:1 y borde fuerte 3,7:1 sobre `#0a0c10`/`#12151b`. El reporte
  `themeContrastReport` pasa entero y `fixTextContrast` no toca ningún
  token. Los presets derivados siguen teniendo su deuda de diseño (el
  estudio permite corregirla a mano); esto da una opción AA sin tocar la
  identidad visual por defecto.
  - **Archivos**: `state/theme-palette.ts` (id, `THEME_PRESETS.contrast`,
    `CONTRAST_PALETTE`, `THEME_PALETTES`, `THEME_PRESET_LABELS`),
    `state/appearance.ts` (validador), `state/theme-palette.test.ts`.
  - **Verificación**: `theme-palette.test` **45/45** (+1: reporte AA
    completo y espejo de base) · `appearance.test` **15/15** ·
    AppearanceCard+ColorStudioCard **14/14** · `tsc --noEmit` 0.
- `[done]` **Color por clip/pista: decisión evaluada (2026-11-07)** —
  `clip.colorTag` es dato del proyecto (enum `ClipColorTagSchema`, 8 etiquetas)
  y **no** entra al tema: el estudio de color gobierna la paleta de la app.
  Ya está expuesto donde corresponde y verificado en código: chips de color en
  el Inspector (`Inspector.tsx:1622-1641`, con «Quitar color»), muestras en el
  menú contextual de la timeline (`Timeline.tsx:3023-3047`), tinte del clip en
  la pista (`clipColorHex`, `Timeline.tsx:304`), filtro por color
  (`clipMatchesColorFilter`, `Timeline.tsx:2821`) y agrupación por color en
  `clip-attributes.ts`. No hace falta exponerlo en el ColorStudio: sería
  confundir dato de proyecto con tema.

## Reglas del ciclo

- Elegir el primer ítem `pending`, implementarlo y verificar.
- Si falla un test o una medición, no avanzar: corregir o dejar `blocked`
  con la evidencia.
- Un solo escritor por archivo; no commit/push/install sin pedido explícito.
- Al cerrar: actualizar este archivo y la memoria con números medidos.

- `[done]` **Segunda pasada de contenido sobre las 36 capturas (2026-11-05)** —
  el cierre anterior sólo tenía estructura y proporciones; faltaban los
  elementos visibles. Ver `docs/RECONSTRUCCION-FILMORA-93-128.md` §9.
  - Árbol por módulo con filtros reales (Efectos «Blanco y negro»: 9 → 1
    tarjetas), chips, contadores, «Descargas N» y entradas IA deshabilitadas.
  - Sub-pestañas del inspector con 21 secciones etiquetadas; en Video
    «Básico» y «Máscara» muestran secciones distintas y reales.
  - Menú contextual con 22 ítems, 8 muestras de color accionando
    `updateClip({ colorTag })`, y desborde «Más» con 30 ítems que reutiliza
    los botones reales de la toolbar («Agregar pista»: 3 → 4 pistas).
  - Inicio: 6 accesos rápidos + 4 servicios pendientes; exportación: tira de
    7 destinos con «Local» activo y 6 pendientes.
  - Verificación: typecheck 0 · build 0 · dirigidas **51/51** · serial
    **2011 passed / 3 skipped / 13 failed** (los 13 previos, 0 regresiones) ·
    e2e **19 passed / 1 skipped / 4 failed** (previos) · 16 capturas con
    0 errores de consola y `pageOverflow 0` en `.tmp-redesign/recon2/final/`.
  - `[next]` Siguen pendientes por backend real: sub-pestañas HSL/Curvas/
    Ruedas/HDR, generación IA de video/audio, stock, login y exportación a
    redes. Están visibles pero deshabilitadas, no simuladas.

- `[done]` **Scopes de audio nativos (port Kdenlive `scopes/audioscopes`)** —
  `commands/audio_scopes.rs`: `analyze_pcm` puro (oscilograma min/max,
  espectro promedio y espectrograma con el FFT radix-2 de
  `filmcraft-audio-dsp`, ventana Hann, dBFS [-120,0], topes: 90 s, 512
  buckets, 512 bins, 384×256 espectrograma) + comandos
  `audio_scope_analyze` (path) y `audio_scope_analyze_asset` (asset del
  proyecto, misma resolución que `audio_peaks`). Frontend:
  `AudioScopeData`/`audioScopeAnalyze[Asset]` en `DesktopService` +
  `AudioScopesPanel` en Mixer (select de material, canvas con
  oscilograma/espectro/espectrograma, estados honestos). Tests: Rust 5/5,
  vitest 2/2, `tsc` 0. Referencia y cola de ports en
  `docs/KDENLIVE-REFERENCE.md`. Pendiente: scopes del audio ya mezclado
en preview del monitor (el scope bajo playhead quedó hecho el 2026-11-08).

- `[done]` **Timecode drop-frame (port Kdenlive `utils/timecode.cpp`)** —
  dos direcciones del algoritmo SMPTE DF (Heidelberger/Duncan):
  - `commands/edl.rs`: `is_drop_frame` (29.97 y 59.94), `drop_timecode`
    frames→`HH:MM:SS;FF` y `timecode` DF-aware. El EDL ahora escribe
    `FCM: DROP FRAME` y etiquetas `;` correctas en proyectos 29.97/59.94
    (antes exportaba NDF a 30 fps → timecodes corridos ~3.6 s/hora).
  - `multicam-timecode.ts`: `timecodeToFrames` acepta `;` cuando el fps es
    tasa DF real y aplica la inversa `getFrameCount` de Kdenlive — las
    cámaras con timecode DF ya sincronizan en multicam. Con fps entero el
    `;` se sigue rechazando con su motivo.
  Tests: Rust `commands::edl` 7/7 (nuevos: etiquetas conocidas 1798→
  `00:01:00;00`, minuto 10 sin pérdida, EDL DF completo) · vitest
  multicam-timecode 10/10.

- `[done]` **Display de timecode drop-frame en UI** — `formatTimecode` en
  `state/project-actions.ts` ahora detecta fps 29.97/59.94
  (`isDropFrameFps`) y formatea `H:MM:SS;FF` con el mismo algoritmo DF del
  EDL y de Kdenlive; fps enteros quedan NDF idéntico. Cierra el círculo:
  conversión DF en export EDL, parse en sync multicam y display comparten la
  misma matemática. Tests: `project-actions.test.ts` 106/106 (+4 DF).

- `[done]` **Puntos in/out de la secuencia (port Kdenlive timeline)** —
  rango de trabajo de la secuencia, como los I/O points de Kdenlive:
  - `shortcuts.ts`: `timeline.setInPoint` (`I`), `timeline.setOutPoint` (`O`),
    `timeline.clearInOut` (`Alt+X`) — reasignables desde Ajustes.
  - `project-store`: `state.ioRange` + `setIoPoint`/`clearIoRange`
    (un solo borde se puede mover sin borrar el otro; `clearIoRange` es
    no-op si ya está limpio).
  - `Timeline.tsx`: teclas en el handler global (mismos filtros de
    input/textarea que el resto), overlay `.timeline-io-range` sombreado
    + marcas `.timeline-io-mark` con `title` accesible en timecode, y los
    bordes entran como snap targets (`ioIn`/`ioOut` en
    `collectTimelineSnapTargets`, kind `marker`).
  - `ExportDialog`: al abrir, el rango de exportación se inicializa desde
    ioRange si es válido (in<out, dentro de la duración); si no, 0→total.
    La edición manual del rango se conserva.
  - Persistencia (2026-11): el rango se guarda en el documento como
    `x-ioRange` — el schema exime el namespace `x-` de `KNOWN_ROOT_KEYS` y el
    `catchall` lo conserva, así que no hace falta bump de `schemaVersion` y
    builds viejos lo preservan al re-guardar. `setIoPoint`/`clearIoRange`
    escriben el documento con `history:false` (marca de UI, no edición) →
    dirty + autosave + snapshot de recuperación gratis; `adopt`/`initial`
    restauran con `ioRangeFromDocument` (validación laxa: frames
    enteros ≥0 o null; shapes inválidas → null). `saveNow`/`saveAs`
    reescriben la clave desde el estado por si un undo restauró un doc con
    otro valor.
  Tests: `project-store.test` 5/5 (+test io +test persistencia/restauración
  `x-ioRange`) · `timeline-pro.test` 16/16 (+test snap a io) ·
  `shortcuts-pro` 5/5 · `tsc` 0 · `Timeline.test` 19/19 · `snapping.test` 8/8.

- `[done]` **Keyframes de efecto en export + autoria (port Kdenlive
  effectstack)** — la pieza que faltaba para que `effects.stack[].keyframes`
  fuera real de punta a punta:
  - **Export (Rust, `render/ffmpeg.rs`)**: `apply_effect_stack_animated`
    parte el stream del clip en los frames donde cambian los keyframes
    (`split` + `trim start_frame/end_frame` + `setpts` + parámetros estáticos
    muestreados por tramo + `concat`), porque los filtros de receta evalúan
    opciones una sola vez al init (verificado con ffmpeg real; `sendcmd` no
    comanda `eq`). El muestreo porta `sampleKeyframes`/`ease` de
    `effect-kit/params.ts` — la misma curva que la preview, no el cúbico de
    transform. Cortes corridos por el lead de transición; tope de 32 tramos
    con fallback al estático. Verificado con render real: `trim` corta por
    frame exacto y el concat recompone sin costura (frames 0-19 con
    brightness=0.5, 20-29 con -0.3 medidos por luminancia media).
  - **Autoria (`effect-kit/stack.ts`)**: `toggleParamKeyframe` (diálogo ◆ en
    el frame del playhead; la primera clave crea una compañera plana porque
    el schema exige mínimo 2), `setParamKeyframeAt` (el slider auto-keya en
    el frame cuando la pista existe), `clearParamKeyframes`, tope 64.
  - **UI (`EffectStackPanel`/`EffectStudio`)**: diamante por parámetro
    numérico cuando hay `keyframeFrame`; el slider muestra el valor
    muestreado (lo que la preview renderiza) y escribe en la clave del
    frame. Con pista, el control pasa a `<div>` + `aria-label` porque los
    botones dentro de `<label>` dejaban el nombre accesible del slider
    vacío. Audio stack sin keyframes todavía (su cadena de export es otra).
  Tests: Rust `effect_*` 10/10 (+5 nuevos: muestreo, hold, grafo
  segmentado, lead, fallback/tope) · effect-kit 18/18 (+6) ·
  EffectStudio 6/6 (+1 flujo ◆) · `tsc` 0.

- `[done]` **Easing Bézier por parámetro de efecto (port Kdenlive
  effectstack)** — los keyframes de efecto aceptaban sólo presets
  (linear/hold/ease-*); ahora `EffectKeyframeSchema` admite `bezier`
  (`CubicBezierSchema`, la misma forma que los keyframes de transform):
  - `effect-kit/types.ts`: `EffectKeyframe.bezier` opcional; `params.ts`
    gana `cubicBezierProgress` (solver y(x)=t, port del de
    project-schema/keyframes.ts — effect-kit no depende de project-schema)
    y `sampleKeyframes` lo aplica cuando la clave que inicia el tramo lo
    trae (prioridad sobre `easing`, misma regla que `samplePoints`).
  - `stack.ts`: `setParamKeyframeAt` preserva `bezier` al auto-keyear
    (antes reconstruía la clave y lo hubiera aplanado).
  - Rust `ffmpeg.rs`: `EffectParamTrack.keys` pasa de easing `String` a
    `SegmentEasing` (parse_easing ya leía `bezier`); `sample_effect_track`
    usa `cubic_bezier_progress` para Bezier y `effect_ease` para presets.
  - Honesto: no hay UI para editar la curva por parámetro todavía — las
    claves con `bezier` se crean por datos (proyecto, MCP, futuras tools).
  - Fix al margen: el WIP de la otra sesión no compilaba (`pixel_format`
    faltante en dos `Profile {}` de preview_frame.rs y moves de `vp9`/`av1`
    en export_tools.rs tras el cálculo de `has_444`); se completaron los
    inicializadores y se movió `has_444` antes de los `insert` — el crate
    vuelve a compilar.
  Tests: Rust `effect_keyframes_*` 7/7 (+2 bezier) · effect-kit 36/36
  (+1 muestreo bezier con 4 asserts) · `cargo check` limpio · `tsc` 0.

- `[done]` **Tokens de tema reales bajo la capa Filmora + specs e2e de
  color actualizados** — dos problemas encadenados:
  - *Specs desfasados*: `theme.spec.ts`/`settings.spec.ts` buscaban
    `input[type=color]` y `.hue-slider`, controles reemplazados por
    `ColorSwatch`/`ColorWheel`. `setTokenColor` ahora abre el popover del
    swatch y escribe el hex; el test de Apariencia mueve el dial
    `Color de acento` por teclado y pollea `--color-accent`. Además el
    test de panel tomaba la línea base con Ajustes abierto (el diálogo
    reemplaza al shell en el DOM) — ahora cierra Ajustes, mide el shell,
    reabre y compara.
  - *Bug real de producto*: la capa `filmora.css` (importada última)
    redefinía `--fm-*`/`--chrome-*` con literales, así que editar
    `--color-panel` en el estudio de color no repintaba ninguna
    superficie. Las variables neutras `--fm-*` ahora derivan de los
    tokens canónicos (`var(--color-*)`) y los shades intermedios usan
    `color-mix()` calibrado para reproducir el literal original bajo la
    paleta filmora (preset pixel-equivalente, ±1 por canal). Literales
    que quedan: colores de contenido/hue (playhead, snap, danger, audio,
    scrim, preview) y el bloque light-theme (acento `#0f9d7f` sin token
    equivalente).
  - Fix menor en WIP del usuario: `effect-kit/stack.ts`
    `setParamKeyframeAt` — el spread condicional de `easing` hacía que
    `frame` quedara opcional y rompía `tsc` con
    `exactOptionalPropertyTypes`; reescrito como ternario explícito.
  Tests: playwright `theme.spec`/`settings.spec` (4/4: acento en vivo,
  panel repinta shell+preview, paleta persiste, apariencia en vivo) ·
  `tsc --noEmit` 0 errores · vitest `effect-kit/engine.test.ts` 18/18.

- `[done]` **Verificación de los fallos de UI preexistentes (2026-11-08)** —
  pasada del protocolo del loop (Devin CLI). El `[next]` del lote de
  rendimiento del 2026-11-04 pedía «corregir esos 4 archivos de UI (roles
  ARIA, `<main>` único, filtro por carpeta) y repetir la suite»; la suite
  serial de esa fecha reportaba **13 fallos previos** del trabajo no
  confirmado del usuario (EffectStudio 5, AudioEffectStack 4, App 1,
  AssetsPanel 3, LottiePanel 1) más 4 specs e2e desfasadas.
  - **Medición de hoy** (mismos archivos, sin tocar código):
    `vitest run` → `EffectStudio.test.tsx` **6/6** · `AssetsPanel.test.tsx`
    **7/7** · `AudioEffectStack.test.tsx` **6/6** · `LottiePanel.test.tsx`
    **3/3** · `App.test.tsx` **77/77**. Los 13 fallos ya no existen: los
    cerraron los lotes posteriores (thumbnails SVG del catálogo, tokens
    `--color-*` bajo la capa Filmora, specs e2e actualizadas a
    `ColorSwatch`/`ColorWheel`).
  - **`<main>` único confirmado en código**: sólo `AppShell.tsx:378` monta
    `<main>` dentro del shell; el de `StartScreen.tsx:780` pertenece a la
    pantalla de arranque, fuera del shell de la app.
  - **Sin cambios de código**: es una pasada de verificación + cierre de
    cola. Los dos sub-ítems que siguen vivos de ese `[next]` quedan
    explícitos como pendientes separados: **segunda fase de CSS
    splitting** (el CSS crítico ya bajó 19,7 % en la ola anterior; la fase
    2 no tiene spec propia) y **microbenchmark de un comando Rust
    CPU-bound** para cuantificar la ganancia del perfil release con LTO
    (el arranque no mejoró de forma medible; falta el número nativo).
  - **Archivos**: `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-08-fallos-ui-preexistentes-verificados.md`.
  - **Verificación**: los 5 archivos de test citados arriba, corridos en
    esta sesión (5 archivos de test, 99 tests, 0 fallos). No se corrió la
    suite serial completa ni `tsc` (no hubo cambios de código).

- `[done]` **Transiciones `slide-3d-*` con perspectiva real (2026-11-08)** —
  cierra el pendiente «slide 3D» del port Kdenlive
  (`docs/KDENLIVE-REFERENCE.md` §4), en una pasada del protocolo del loop
  (Devin CLI). El ledger estaba cerrado (`loop:preflight` → `idle`); el
  ítem salió de la brecha declarada en la matriz/referencia.
  - **Schema** (`project-schema/timeline.ts`): `slide-3d-left|right|up|
    down` en `ClipTransitionSchema`; JSON Schema regenerado con
    `npm run schema:generate` (tests `timeline` + `schema-artifacts`
    57/57).
  - **Export** (`render/ffmpeg.rs`): los 4 tipos reusan el desplazamiento
    del overlay de `slide-*` (`slide_axis` ahora reconoce ambos grupos) y
    suman `slide3d_perspective` — filtro `perspective` con
    `sense=destination:eval=frame` que lleva las esquinas del fuente a un
    quad comprimido simétrico sobre el centro
    (`extent = 0.15 + 0.85·min(max(in/lead_frames,0),1)`), con
    `enable='lt(n,lead_frames)'` para no pagar el remapeo fuera del lead.
    Eje perpendicular al viaje: laterales comprimen X (giro sobre eje
    vertical), verticales comprimen Y. Variante congelada
    `slide3d_frozen_filter` con progreso constante para el preview.
  - **Preview** (`commands/preview_frame.rs`): `freezable_transition`
    acepta los 4 tipos y emite `transitionFrozen {mode:"slide3d", axis,
    progress, x, y}` — mismo contrato que wipe/dip-color.
  - **Catálogo/auditoría** (`commands/visuals.rs`): los 4 tipos entran al
    catálogo (overlap, 15 frames por defecto) **y se corrige la whitelist
    stale de la auditoría**, que no reconocía `dip-color` ni `wipe-*`
    (los habría marcado «transición desconocida» en proyectos válidos).
  - **UI**: 4 opciones en Inspector («Deslizar 3D desde …»), 4 presets en
    `EditorAssets` (pestaña «Deslizamiento») y labels en `Timeline`.
  - **Verificación**: `cargo test` — `extra_transitions_change_the_filter_chain`
    (asserts de `perspective`/`eval=frame`/`enable` por dirección +
    variante congelada sin `in/`) ok ·
    `window_freezes_fades_and_transition_leads` (mode/axis/progress/x/y
    congelados) ok · `visuals::` 6/6 ok · smoke real de FFmpeg con la
    cadena `perspective` exacta emitida (8 frames, sin errores) ·
    `tsc --noEmit` desktop **0 errores** · vitest `EditorAssets` 9/9
    (conteo 12→16 tarjetas), `Timeline` 20/20, `project-actions` 108/108,
    `visuals`/`motion`/`caption-motion` ok; schema 57/57.
  - **Límite honesto**: es una aproximación — el quad se comprime
    simétrico sobre el centro del frame, no una puerta 3D anclada a un
    borde como el slide 3D de MLT/Kdenlive; no hay iluminación ni
    deformación de perspectiva real por cara. Suficiente para el gesto
    «entra rotando», no para paridad geométrica exacta.
  - **Archivos**: `packages/project-schema/src/timeline.ts` + schema
    regenerado, `render/ffmpeg.rs`, `commands/preview_frame.rs`,
    `commands/visuals.rs`, `Inspector.tsx`, `EditorAssets.tsx`,
    `Timeline.tsx`, `docs/KDENLIVE-REFERENCE.md`, esta entrada,
    `memory/2026-11-08-slide-3d-transitions.md`.
  - **Pendiente**: luma wipe con clip mate (siguiente gap Kdenlive).

- `[done]` **Microbenchmark LTO vs sin-LTO en `analyze_pcm` (2026-11-08)** —
  cierra el pendiente «microbenchmark de un comando Rust CPU-bound para
  cuantificar el LTO del perfil release» del cierre de la ola de
  rendimiento, en una pasada del protocolo del loop (Devin CLI). El código
  ya estaba escrito por una pasada anterior sin commitear (perfil
  `[profile.release-nolto]` en `Cargo.toml` + test ignorado
  `bench_analyze_pcm_throughput` en `audio_scopes.rs`); esta pasada lo
  compiló en ambos perfiles y midió.
  - **Medición** (30 s de PCM sintético, 1.440.000 muestras, 3 iteraciones
    por corrida tras warmup, 4 corridas por perfil alternadas):
    `release` (lto thin, codegen-units=4) → 443,4 / 455,2 / 440,4 / 457,8
    × tiempo real; `release-nolto` → 451,3 / 455,8 / 453,0 / 457,7 ×.
    Medias ~449× vs ~454×: **solapadas, sin ganancia medible de LTO**
    (~1 % a favor de no-LTO, dentro del ruido).
  - **Conclusión honesta**: el coste de LTO (+0,57 % exe, +~3 min de build)
    no compra rendimiento en este DSP; coherente con la medición CDP
    previa (arranque sin mejora). No buscar ganancia en `lto="fat"`;
    caminos reales: codegen-units=1 o el algoritmo/SIMD.
  - **Verificación**: `cargo test --release -p editor-ia-desktop --lib
    audio_scopes -- --ignored --nocapture` ok · mismo comando con
    `--profile release-nolto` ok · tests no-ignorados del módulo **8/8**
    en ambos perfiles · compilación completa de la crate en release y
    release-nolto (~6–7 min cada una, deps cacheadas).
  - **Archivos**: `Cargo.toml`, `apps/desktop/src-tauri/src/commands/
    audio_scopes.rs`, `docs/IMPROVEMENT-QUEUE.md`,
    `memory/2026-11-08-bench-lto-audio-scopes.md`.
  - **Sigue vivo del mismo `[next]`**: segunda fase de CSS splitting (sin
    spec propia). Pendientes externos sin cambio: firma OV/EV + updater,
    Ola CapCut P1 (sólo si el usuario la pide), luma wipe con clip mate,
    scopes del audio ya mezclado, física 2D del stickman, transiciones OBS.

- `[done]` **Transición `luma-wipe` con clip mate (2026-11-08)** — el
  «siguiente gap Kdenlive» declarado al cerrar slide-3d, en una pasada del
  protocolo del loop (Devin CLI). La implementación venía sin commitear en
  el árbol (trabajo de una pasada anterior); esta pasada la verificó de
  punta a punta, agregó el test de render real y documentó.
  - **Schema**: `luma-wipe` en el enum de `ClipTransitionSchema` con
    `mateClipId` obligatorio vía `superRefine` (EntityId); schema JSON
    regenerado. `applyTransitionToCuts` la salta en aplicación masiva
    (no puede elegir mate por corte); se aplica desde el Inspector.
  - **Export (Rust, `render/ffmpeg.rs`)**: `luma_mate` resuelve el clip
    mate declarado (video/imagen/freeze, habilitado, sin speed curve ni
    reverse, ventana activa que cubre el solape con tolerancia de un
    frame, asset `ready` con licencia conocida, path dentro del root,
    `ensure_asset_unchanged`) y lo suma como entrada extra de FFmpeg
    (`-ss`/`-t` en source-time del solape, `-loop 1` para imágenes).
    `luma_wipe_graph` parte el clip entrante por `lead_frames`
    (`split`+`trim`+`setpts`), aplica `fps`+`format=gray`+`scale2ref`+
    `alphamerge` sobre el lead (la luma del mate se copia al alfa) y
    `concat` con el resto; el overlay consume `v{index}out`. Errores
    honestos: sin mate, mate inexistente, auto-mate, mate deshabilitado,
    mate sin cobertura del solape.
  - **Preview**: `preview_frame.rs` congela `transitionFrozen
    {mode:"luma",mateClipId}` en el lead y `freezable_transition` acepta
    `luma-wipe`; `luma_frozen_graph` aplica la máscara de un solo frame
    del mate sin split/concat.
  - **UI**: Inspector con selector «Clip mate (máscara)» filtrado por
    cobertura del solape (misma tolerancia de un frame que el renderer) y
    auto-asignación del primer candidato al elegir el tipo; label en
    Timeline; auditoría `visuals.rs` marca `luma-wipe` sin mate como
    error.
  - **Verificación**: `tsc --noEmit` 0 · project-schema **373/373**
    (incluye schema-artifacts: JSON en sync) · vitest dirigidos
    **144/144** (project-actions 108, Timeline 20, Timeline.pro 7,
    EditorAssets 9) · `cargo test --lib luma` **2/2** ·
    `window_freezes_fades_and_transition_leads` ok · `commands::visuals`
    6/6 · filtro `transition` 8/8 (+1 ignored) · **render real**
    (`EDITOR_IA_RUN_RENDER_TESTS=1`, ffmpeg 9.0.1): mate mitad
    negra/blanca sobre base roja y entrante azul — a mitad del lead
    YAVG izq=81.00 / der=41.00 (la máscara reveló el clip de abajo a la
    izquierda y el entrante a la derecha); post-lead 41.00/41.00 parejo.
    Nuevo test ignorado `render_luma_wipe_uses_the_mate_luminance` +
    helper `region_luma`.
  - **Archivos**: `packages/project-schema/src/timeline.ts` + schema
    regenerado + `effects.test.ts`, `render/ffmpeg.rs`,
    `commands/preview_frame.rs`, `commands/visuals.rs`, `Inspector.tsx`,
    `Timeline.tsx`, `state/project-actions.ts`, `docs/KDENLIVE-REFERENCE.md`,
    esta entrada, `memory/2026-11-08-luma-wipe-clip-mate.md`.
  - **Pendiente**: mate animado visible en preview del monitor (el
    preview congela un frame, igual que el resto de transiciones). ~~El
    mate en pista oculta funciona pero no hay UI para sugerirla~~
    **resuelto el mismo día**: checkbox «Ocultar la pista del mate» en el
    Inspector con aviso de pista completa y bloqueo si comparte pista con
    el clip (ver la entrada al tope de esta cola).

- `[done]` **Curva Bézier por parámetro de efecto en la UI (2026-11-08)** —
  cierra el «Honesto: no hay UI para editar la curva por parámetro todavía»
  declarado al implementar `bezier` en `EffectKeyframeSchema`, en una pasada
  del protocolo del loop (Devin CLI). Preview y export ya muestreaban la curva
  (`cubicBezierProgress` en effect-kit, `SegmentEasing.bezier` en ffmpeg.rs);
  faltaba la superficie.
  - **effect-kit** (`stack.ts`): `setParamKeyframeBezier` escribe la curva de
    la clave que inicia cada segmento (conserva valor y `easing`; `null` la
    quita) y `clearParamKeyframeCurves` las borra todas; ambas no-op sin pista
    o sin clave en el frame. Exportadas en `index.ts`.
  - **`KeyframeCurveEditor`** (`features/editor/`): el tipo de claves se
    generalizó a `CurveEditorKeyframe` estructural (`frame`/`easing`/`bezier`)
    — lo comparten `ClipTransformKeyframe` y `EffectKeyframe` sin acoplar
    effect-kit a project-schema; `property` admite string libre (los efectos
    pasan la etiqueta visible del parámetro) y `helpId` hace único el
    `aria-describedby` cuando hay varios editores montados.
  - **`EffectStackPanel`** (compartido por `EffectStudio` video y
    `AudioEffectStack` audio): los parámetros con pista de ≥2 claves ganan el
    botón «Curva» (∿) que despliega el editor; «Quitar curvas» aparece cuando
    alguna clave tiene `bezier` propio. La escritura pasa por
    `setParamKeyframeBezier` con el mismo `onChange` del stack.
  - **Fix al margen**: `engine.test.ts` no typecheckaba en el tsconfig del
    paquete (arrays mutables vs `EffectStack` readonly y un `sort` sobre
    `number[]` con `(a,b)=>a.frame-b.frame`); corregido — era deuda previa,
    no de esta pasada.
  - **Verificación**: `tsc --noEmit` effect-kit + desktop **0 errores** ·
    vitest effect-kit **51/51** (+3: setter preserva valor al reescribir,
    no-op sin pista/clave, clear de curvas) · vitest
    `AudioEffectStack` **7/7** (+1: flujo ◆→Curva→flecha→bezier en frame 0→
    «Quitar curvas») · `features/vfx` + `KeyframeCurveEditor` **47/47**.
  - **Archivos**: `packages/effect-kit/src/{stack,index,engine.test}.ts`,
    `apps/desktop/src/features/editor/{KeyframeCurveEditor.tsx,
    KeyframeCurveEditor.test.tsx,AudioEffectStack.test.tsx}`,
    `apps/desktop/src/features/vfx/EffectStackPanel.tsx`,
    `apps/desktop/src/styles/effect-studio.css`, esta entrada,
    `memory/2026-11-08-bezier-por-parametro-efecto.md`.
  - **Pendiente honesto**: ~~no hay selector de preset `easing` para
    keyframes de efecto~~ **resuelto el mismo día** (ver la entrada
    «Selector de preset `easing` para keyframes de efecto» al tope de
    esta cola). La curva se edita por teclado (flechas/`[`/`]`) y arrastre
    de manejadores, igual que en la sección «Curvas» del Inspector.
