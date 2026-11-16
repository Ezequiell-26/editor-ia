# 10 — Lectura profunda de módulos JS (algoritmos extraídos)

> Fuente real leída el 2026-11-09. Sirve para reimplementar con código
> propio. Cada sección cita el archivo y resume el COMPORTAMIENTO, no el
> código.

## `js/rastreamento.js` — auto-reframe con seguimiento (215 líneas)

Datos que produce el tracker (`clip.rastreamento.datos`):
`{ n, fps, t0, x[], y[], r[] (rotación), s[] (escala), midia:[w,h],
ref_i, regiao }`. Opciones del clip: `alvo` ("cabeca"…), `agitar` 0-100,
`suavidade` 0-100, `corte_auto`, `manter_tamanho`, `fundo_desfocado`,
`mostrar_caixa`.

Algoritmo de suavizado (lo importante):

- **Gaussiano por eje**: pos σ=1.8, giro σ=5, escala σ=6.8, multiplicados
  por `fatorSuave(suavidade) = 2^((s-50)/25)` → suavidad 50 = σ base,
  100 ≈ σ×2.8, 0 ≈ σ/2.8. Refleja bordes (no wrap).
- **Escala "branda"**: comprime la serie de escala a [0.92, 1.22],
  limita el delta por frame a ±0.022, luego suaviza en **log-espacio**
  (gauss sobre ln y exp) — evita pumping.
- **`ajustar(c, rel, W, H)`** devuelve el transform `{sx,sy,px,py,g}`:
  - Punto de referencia `ref_i` = posición en el frame ancla; la cámara
    apunta a `Q = mundo(ref)` y el target sigue `P = mundo(actual)`.
  - `agitar` inyecta jitter senoidal de baja frecuencia
    (`cos(fq*0.09)`, `sin(fq*0.2)`…) + micro-rotación.
  - `manter_tamanho`: divide el zoom por `s/sr` (clamp 0.5-2) para que el
    zoom no baile cuando el trackee se acerca/aleja.
  - `corte_auto`: calcula la región segura = intersección de los 4
    vértices transformados del clip con el frame; `zoomMinimo()` resuelve
    el zoom mínimo para que el vecindario del target quede dentro;
    se evalúa en ventana ±3 s (`ZOOM_JANELA_S`) con peso coseno → zoom
    **anticipa** movimientos. Techos: 2.5× normal, 1.2× con fondo
    desenfocado.
- `caixaEm()` devuelve la caja del target para el overlay
  `[x, y, w*s, h*s]` con la región relativa del track.

## `js/molduras.js` — marcos/bordes para clips de cámara/pantalla (299 líneas)

19 presets en 5 grupos (`redondo`, `quadrado`, `retrato`, `paisagem`,
`forma`). Cada preset: `prop` (aspect del marco), `raio` (esquinas, 1 o
4 valores), `espessura`, `cor`/`cor2` (gradiente opcional), `estilo`
1-6, `margem` opcional. Estilos: 1 trazo simple · 2 trazo doble ·
3 órbita (dos trazos desplazados) · 4 neon (glow ancho translúcido +
fino) · 5 flotante (sombra + vidrio) · 6 polaroid (relleno + ventana).

`numerosDe()` convierte a coordenadas normalizadas respecto al lado
menor del frame (los márgenes escalan con `min(bx,by)`), y `desenho()`
genera el SVG de preview por estilo. Forma especial `forma:1` = hexágono.

## `js/motor.js` + `curvas_predefinidas.js` — curvas de keyframes

- **13 presets Bézier** con ids: linear, entrada_suave, entrada_quadratica,
  entrada_cubica, desaceleracao_saida, saida_quadratica, saida_cubica,
  desaceleracao, desaceleracao_quadratica, desaceleracao_circular,
  entrada_rebote, saida_rebote (estos dos con **overshoot**: cpY fuera de
  [0,1], p.ej. `[.17,.89,.32,1.27]`).
- Se aplican a **todos los keyframes del mismo instante** del clip
  (`comTrecho` = keys que inician un segmento). El keyframe guarda
  `curva:{id,p}`.
- `curvaBezier(p,u)`: Newton 8 iteraciones sobre x(u)=t → y(u), igual que
  el `cubicBezierProgress` de Olyvia.
- UX extra: copiar/pegar **todos los keyframes de un instante** al
  playhead (`copiar`/`colarNaAgulha`), copiar "atributos" (keys de un
  instante) y pegarlos en otro clip/instante.

## Diferencia con Olyvia (estado al 2026-11-09)

| AlaukCut | Olyvia |
|---|---|
| 13 presets Bézier con nombre + overshoot | 4 easings + Bézier manual en editor de curvas |
| Preset por keyframe (`curva.id`) | `bezier` por keyframe (sin id de preset) |
| Copiar/pegar keyframes al playhead | ✅ `keyframe-clipboard.ts` + botones en Inspector |
| Tracking → auto-reframe con anticipación ±3 s | Estabilización estática (`ClipStabilization`) sin tracking |
| 19 molduras de monitor | ✅ `monitorFrame` + `MonitorFrameSvg` (preview y export MP4 y frame real) |
| Perspective drag en preview (`canto`) | ✅ `PerspectiveHandles` + `perspective-handles.ts` |
| `placa_perdida` (recuperación GPU) | Render-worker sin detector de GPU perdida |

## Lectura 2026-11-09 (tarde): `placa_perdida.js` + `canto_fixado.js`

### `placa_perdida.js` (107 líneas) — resiliencia ante pérdida del contexto gráfico

- Escucha `webglcontextlost` del canvas del motor (y en burbuja por si el
  target es hijo). Al perderse:
  1. `e.preventDefault()` + guard `tratando` (una sola recuperación).
  2. Cuenta caídas en ventana de **10 min** (`sessionStorage`).
  3. **Guarda el proyecto inmediatamente** (`salvar_projeto`) antes de
     recargar — la pérdida de contexto no debe costar trabajo.
  4. Si es la 1ª caída en la ventana: aviso al usuario + `location.reload()`
     automático a los **2.5 s**.
  5. Si es la ≥2ª: NO recarga solo — muestra diálogo con instrucciones
     (actualizar driver, cerrar programas que usan la GPU, reiniciar) y
     botón manual «Reabrir el proyecto».
  6. Telemetría: `prerender_anotar({o_que, motivo, veces_em_10_min, proyecto})`.
- Patrón portable a Olyvia: el render-worker Rust puede detectar fallo de
  dispositivo gráfico y reintentar; el análogo frontend es guardar estado
  antes de cualquier recuperación. En preview DOM no aplica WebGL, pero la
  idea "contar caídas en ventana + degradar a acción manual" sí.
- **Estado Olyvia (2026-11-09)**: la parte render-side ya está — si FFmpeg
  muere a mitad con firma de GPU (`gpu_failure_hint`), el worker
  reconstruye el plan sin `hardwareEncoder` y reintenta UNA vez
  (`RenderRetry` en `RenderLaunch`, `RenderRuntime::replace` para que la
  cancelación mate el proceso nuevo, log del intento en
  `render-<job>.gpu.log`). **Falta**: contar caídas en ventana, aviso al
  usuario con instrucciones, guardado de proyecto antes de reintentar y
  telemetría — la ventana de 10 min y el "≥2ª caída → manual" de AlaukCut
  no tienen equivalente (un render Olyvia es una sola pasada FFmpeg, no
  un contexto WebGL que se puede recargar).

### `canto_fixado.js` (131 líneas) — corrección de perspectiva por arrastre

- Efecto `canto` = quad de 4 puntos (`ef.pts`, coords normalizadas) que
  deforma la imagen (esquina fijada / perspective warp).
- Overlay SVG con `<polygon>` + 4 handles `.canto-h` posicionados por
  `Palco.fatorTela()`/`deslocTela()` (zoom+pan del monitor).
- Interacción:
  - `pointerdown` en handle `i` → arrastra **solo ese vértice**; en el
    polygon → arrastra **los 4 juntos** (delta común).
  - Coordenadas fracción del frame completo → clamp a **[-0.5, 1.5]**,
    redondeo a 4 decimales.
  - `convexo()`: rechaza el movimiento si el quad deja de ser convexo
    (cross product por arista, tol 1e-9) — mismo test que
    `PerspectiveSchema.superRefine` de Olyvia (que además exige área ≥1%).
  - `inicial()`: si el clip ya tiene transform (posición/escala/rotación
    del motor), pre-mapea el quad del content-box a coords de proyecto
    invirtiendo la matriz del clip.
- Estado Olyvia: ya existe `PerspectiveSchema` (4 esquinas normalizadas,
  validación convexa+área), `perspectiveMatrix3d` en preview e inputs
  numéricos en Inspector. **Falta**: edición directa en preview (handles
  arrastrables). Es el próximo candidato natural: overlay SVG dentro de
  `PreviewTransformBox` o componente hermano, escribiendo
  `transform.perspective.corners` vía `updateClip`. Precaución: las
  esquinas están en coords del content-box `object-fit: contain`, no del
  canvas — hay que mapear por `fittedContentBox` + transform 2D del clip.

### `espectro.js` + `previa_efeitos.js` — efectos audio-reactivos (análisis 2026-11-09 noche)

- `espectro.js` (85 líneas) es sólo el **cargador de datos**: cada medio
  puede tener `m.espectro` → JSON con `{fps, bandas, n, datos_b64}` —
  bandas de frecuencia precalculadas por frame (Uint8 por banda),
  interpoladas linealmente por tiempo fuente en `bandasEm(midiaId,
  tempoFonte, saida)` (toma el MÁX por banda entre frames colindantes).
  `garantirEspectros()` genera el sidecar bajo demanda; `semSom` marca
  medios sin audio.
- Los 3 efectos (`espectro`, `espectro_onda`, `espectro_neon`) pintan un
  visualizador sobre fondo negro con `Motor.amostraEspectro(ctx, W, H,
  bandas, nombre, intensidad)` — el dibujo real vive en el motor WebGL
  (`motor.js`), con paleta por efecto (#fff / #6aa6ff→#c86cff /
  #37b6ff→#ff45d0) y zoom 1.35/1.9. En `previa_efeitos.js` (tarjetas del
  panel) las bandas son **sintéticas**: `bandas[b]` se genera por tiempo
  con senos amortiguados — el preview de tarjeta no usa el audio real.
- **Costo en Olyvia**: necesita (a) pipeline backend que precalcule N
  bandas FFT por frame por medio (ffmpeg `aspectralstats` o WebAudio en
  frontend), (b) renderer en preview (canvas 2D alcanza para barras/onda;
  neon necesita glow), (c) equivalente FFmpeg en export (bars sobre
  `showwaves`/`avectorscope` o overlay generado). Es un feature de
  pipeline completo, no un efecto de filtro — queda como ítem mayor.

### `atalhos.js` (410 líneas) — sistema de atajos remapeables

- **~25 acciones** en 4 grupos (`geral`, `timeline`, `marcadores`, `criar`),
  cada una con `id`, `padrao` (combo tipo `Ctrl+X`), `roda()` (callback) o
  `botao` (id de botón DOM a clicar) y `tambem` (grupos extra).
- **Remapeables con persistencia**: `carregar()` lee
  `api().config_ler().atalhos` y pisa los defaults; `gravar()` guarda el
  mapa completo por `config_gravar("atalhos", mapa)`. Diálogo `veu-atalhos`
  con captura de tecla (`ouvindo`/`capturarTecla`) y `conflitos()` que
  detecta combos duplicados.
- `campoQuerATecla(e)`: guard que ignora el atajo si el foco está en
  input/textarea/select/contenteditable (los `range` sí aceptan flechas).
- `combinacaoDe(e)`: normaliza `e.key` (`ArrowLeft`→`←`, ` `→`Espaço`,
  `Delete`→`Del`, `=`→`+`) y arma `Ctrl+Alt+Shift+Tecla`; `Shift` se omite
  cuando la tecla es `+`.
- **Precedencia Ctrl+C/V clave**: `copiar`/`colar` primero intentan
  `CurvasKf.copiarDaTecla()`/`colarDaTecla()` y recién después
  `copiarClipe`/`colarClipe`.
  - `copiarDaTecla` sólo actúa si `kfSelecionado` existe (una clave fue
    clickeada en el editor de curvas): copia TODAS las props animadas de
    ese instante (`fotografar` → `{clipe, t, itens:[{prop,valor,curva}]}`)
    y setea `ultimaCopia = "kf"`.
  - `colarDaTecla` sólo actúa si `ultimaCopia === "kf"`: prueba en orden
    clip seleccionado → clip origen → todos los clips bajo la aguja, y pega
    en el PRIMERO que `podeColar` (aguja dentro del clip + al menos una
    prop compatible con `cabe()`). Consume el atajo aunque no pegue
    (aviso `kf.colarSemClipe`).
  - `PERTO = .05`: tolerancia de frame al escribir la clave destino.
- Otras acciones: Q/W corte a izquierda/derecha de la aguja, M/Shift+M/
  Ctrl+Shift+M/Alt+M/Alt+Shift+M marcadores, ,/. frame step, Shift+←/→
  salto de ±1 s, Alt+G/Alt+Shift+G compuesto, Ctrl+G/±Shift+G agrupar,
  Alt+C/Alt+V copiar/pegar ATRIBUTOS (separado de keyframes), D eliminar,
  S skim, B cuadro blanco, H mano, Ctrl+Alt+K abre el diálogo de atajos.
- **Estado en Olyvia**: ya existía `state/shortcuts.ts` (registro
  remapeable con persistencia, diálogo de captura y detección de
  conflictos — equivalente al `veu-atalhos`). **2026-11-09**: se agregaron
  los 4 ids faltantes con las mismas teclas de AlaukCut —
  `edit.copyAttributes`/`edit.pasteAttributes` (Alt+C/Alt+V, atributos del
  clip seleccionado vía `clip-attributes.ts` + handler de Timeline) y
  `timeline.markerNext`/`timeline.markerPrev` (Shift+M/Ctrl+Shift+M,
  `nextMarker`/`previousMarker` + `setPlayhead`) y
  `timeline.cutLeft`/`timeline.cutRight` (**Q/W** → `cutSideAtPlayhead`:
  `splitClip` + `deleteClip` de la mitad anterior/posterior; con selección
  sólo ese clip, sin ella todos los que contienen la aguja — igual que
  `cortarLadoDaAgulha`/`partirNaAgulha`, que devuelve el clip nuevo
  (derecha) y salta compuestos y bordes). Detalle: AlaukCut transfiere
  las puntas fade/transition de la mitad borrada (`devolverPontaDoComeco/
  Fim`); Olyvia no lo hace en v1. También hechos:
  `timeline.compoundClip`/`timeline.uncompoundClip` (**Alt+G/Alt+Shift+G**
  → `createCompound`/`expandCompound`, mismas acciones del Inspector) y
  `timeline.markerAdd`/`timeline.markerRemoveLast` (**Alt+M/Alt+Shift+M**
  → `addMarker` sin alternar + borrar el último insertado; `incluir`/
  `removerUltimo` de `marcadores.js` usan un contador `n` que en Olyvia
  equivale al orden de inserción de `project.markers`). Restan sin
  equivalente: Ctrl+G/±Shift+G agrupar clips (sin grupos en Olyvia), B
  cuadro blanco, H mano, S skim, D `excluirPeloAtalho` contextual,
  Ctrl+Alt+K (Olyvia ya tiene Ajustes → Atajos).
  remapeable más rico, ~50 ids) + `ShortcutsCheatSheet`. Implementado hoy:
  la precedencia Ctrl+C/V de keyframes (`keyframe-clipboard.ts` ahora
  trackea `lastCopy` = `ultimaCopia`; Timeline intenta
  `copyTransformKeyframesAt`/`pasteTransformKeyframesAtPlayhead` antes que
  clip). Pendientes detectados: Q/W corte lateral, Alt+C/V atributos por
  teclado, ,/. ya existen (`playback.framePrev/Next`), marcadores
  siguiente/anterior (sólo hay toggle), agrupación/compuesto si el modelo
  de Olyvia los soporta.

## Lectura 2026-11-09 (noche): `formas.js` + `espiada.js` + `animacoes.js` + maozinha

- **`formas.js`** (433 líneas): 10 tipos de forma-clips — `quadrado`,
  `circulo`, `triangulo`, `paralelogramo`, `trapezio`, `linha` (abierta),
  `seta`, `losango`, `estrela`, `coracao`. Trazo configurable por canto
  (`canto` =BorderRadius-like), relleno, y son clips normales: se mueven/
  escalan con el transform de siempre. **Implementado**: template
  `shape` en `features/motion/templates.ts` cubre rect/elipse/triángulo/
  rombo/estrela/pentágono/hexágono/flecha/custom-points (lo que
  `MotionRectLayer.shape` ya dibuja en preview y ASS). **Brecha**:
  paralelogramo/trapezoid/linha/coracao no tienen shape nativo — el
  polígono custom (3–16 puntos) los aproxima; corazón necesitaría ~16
  puntos al límite.
- **`espiada.js`** (855 líneas): pool de lectores de preview — hasta 4
  decoders simultáneos, 15 fps objetivo, velocidad de lectura adaptativa
  a la velocidad de scrub del usuario (`velMao` vs mediana), pausa por
  inactividad (25 s) y prefetch con ventana de validez de 800 ms.
  **Lección arquitectónica**: el preview de AlaukCut decodifica frames
  bajo demanda con presupuesto de decoders; Olyvia usa `<video>` DOM —
  patrón a considerar si el scrub de timelines pesadas se degrada.
- **`animacoes.js`** (498 líneas): packs de animaciones descargables
  (mov/webm/mp4 con variables editables: color, boolean, número). Es un
  sistema de assets con parámetros, no código de edición — equivalente
  futuro: templates MotionItem con `props` (Olyvia ya tiene el modelo;
  faltaría un catálogo/caché de packs).
- **Mãozinha / cuadro branco** (`Telas.inserir("branco")` +
  `alternarMaozinhaDoSelecionado`, atajos B/H): videoscribe — pantalla
  blanca/cuadriculada + mano que escribe texto letra a letra y dibuja
  imágenes. Feature completa (motor de dibujo + timeline de trazo);
  queda como gap grande documentado, no implementable en una pasada.
- **`excluirPeloAtalho`** (D): cadena contextual kfSeleccionado >
  transición > respiraciones > clip. En Olyvia Delete ya borra
  clip/cue; la prioridad keyframe ya está implementada:
  `state/keyframe-selection.ts` eleva la clave a estado compartido y
  `EditorWorkspace` aplica la cadena keyframe > transición
  (`getSelectedTransition`) > clip > cue en Delete/D — CUBIERTO.
- **`skim`** (S → `tl-skim`): skimmer del ruler para scrub visual
  rápido. **CUBIERTO**: skim del ruler con binding `timeline.skim` (S)
  — `skimEnabled`/`skimActiveRef`/`skimXRef` en Timeline.tsx.

## Lectura 2026-11-09 (noche 2): `faixas.js` + `menu_clipe.js`

- **`faixas.js`** (1689 líneas): motor canvas de **leyendas estilo banda** —
  banda inferior con nombre/rol, entrada/salida animada (`T_ENTRA`/`T_SAI`,
  `relogio` ease cúbico), foto circular con niveles de color propios,
  íconos vectoriales, karaoke (`normalCor`), variables de fuente
  (`FONTE_LETREIRO_VARIAVEAS`) y escala `un()` relativa a 720p.
  **Brecha Olyvia**: tiene ASS/captions pero no este sistema de bandas
  con plantillas variables — candidato a template MotionItem «lower-third
  bandeja» o renderer propio.
- **`menu_clipe.js`** (1234 líneas): menú contextual rico. Items que
  Olyvia NO tiene: **respiração** (`CaixaSilencio` — quitar silencios/
  respiraciones del audio del clip), **batidas** (`Batidas.abrir` —
  detección de beats para cortar al ritmo), **estilo onda**
  (`EscolherOnda` — estilos de forma de onda), fade especial por punto,
  y el diálogo de **copiar atributos por grupos** con checkboxes
  (`colarAtributos` permite elegir qué grupos pegar: efectos, motion,
  color, audio…). Las dos últimas son implementables: el portapapeles de
  atributos de Olyvia ya copia todo — agregar selección por grupo es
  una mejora acotada.

## Lectura 2026-11-09 (noche 3): audio del menú contextual

- **`caixa_silencio.js`**: diálogo de **respiração/silencios** — elige el
  clip, permite excluir otras pistas del lote, tiene modos (respiração vs
  silencios) y link a cleampcut.com. Backend probable: detección de
  silencios sobre el audio (ffmpeg `silencedetect` lo da gratis en
  Olyvia; el corte ripple con `rippleDeleteClip` ya existe).
- **`escolher_onda.js`**: selector de **estilo de forma de onda** —
  `estiloOndaDe(c)`: override por clip (`c.onda`) + global
  (`onda_padrao` en config, default `capcut`). Estilos: `capcut` =
  barras desde la base con guía + puntas calientes (`#f08a34`) y
  clipeadas (`#ff5a5c`) cuando amp>1; `davinci` = envolvente simétrica
  rellena al 55 % + stroke + línea central. **IMPLEMENTADO 2026-11-09**:
  `editor-preferences.waveformStyle` + `waveformBarsPath` en Timeline +
  SegmentedPref en Ajustes → Editor. Override por clip `c.onda` IMPLEMENTADO 2026-11-09:
  `clip.waveformStyle` en schema + chips Global/CapCut/DaVinci en Inspector
  + `waveStyle = clip.waveformStyle ?? pref` en Timeline. Brecha restante:
  codificación caliente/clipeada (picos normalizados [0,1]).
- **`Batidas`** (detección de beats): **Olyvia YA CUBRE** —
  `state/beat-sync.ts` (energy-flux + umbral adaptativo + confianza) +
  `planBeatCuts` cableado en Inspector y BrainPanel.

## Lectura 2026-11-09 (noche 4): exportación

- **`exportador.js`** (2236 líneas): pipeline de export por frames en
  canvas — pool de hasta 8 decodificadores por medio, cuADROs cacheados,
  "pixel de mentira" para clips que no necesitan frame real, medida por
  medio. Arquitectura distinta a Olyvia (FFmpeg nativo por rangos); las
  lecciones aplicables ya están cubiertas (encoder self-test, GPU-loss).
- **`exportar_formato.js` + `editor.html`**: formatos MP4/MOV/MP3/WAV/GIF
  (GIF con lado, calidad y fps propios, paso intermedio a MP4),
  resoluciones 720P/1080P/2K/4K. Olyvia: contenedores mp4/mov/webm,
  códecs h264/h265/vp9/av1 — **brecha**: sin GIF/MP3/WAV de timeline ni
  ProRes (`exportar_prores.js`). La conversión media→GIF/MP3/WAV ya
  existe en `media/conversion.rs` pero no exporta la timeline.
- **`exportar_resumo.js`**: estimación de peso del archivo
  (`bytesPrevistos`: ~0,13 bits/px + audio) y portada/capa del vídeo.
  **IMPLEMENTADO**: `estimateOutputBytes` en `export-presets.ts` +
  "Tamaño estimado del archivo" en ExportDialog → Avanzado.
## Lectura 2026-11-09 (noche 5): módulos chicos de efecto/UX

- **`espectro.js`** (86 l): efectos visuales audio-reactivos por clip —
  `espectro`, `espectro_onda`, `espectro_neon`. El backend precalcula bandas
  por frame (`m.espectro`: fps/bandas/datos_b64) y el frontend las samplea por
  tiempo de fuente. Olyvia tiene scopes de audio (análisis) pero NO efectos
  visuales reactivos al audio → gap mediano (requiere pipeline de bandas en
  render + 3 recetas de efecto).
- **`camera_inteligente.js`** (135 l): «barras» de cámara con rectángulo
  `[x,y,w,h]` normalizado, zoom máx 6×, permanencia tras el clip, easing
  (linear/suave/entrada/salida) y clamps de encuadre. Es el auto-recuadro
  manual con keyframes implícitos → relacionado con tracking→auto-reframe.
- **`contorno.js`** (225 l): trazo redondeado animado (draw-on con dash
  offset + ease coseno) alrededor del contenido del clip; params cor/espesor/
  cierre. Gap: Olyvia tiene monitorFrame estático pero no trazo animado.
- **`marca_texto.js`** (59 l): timing de marca de texto manuscrita (maozinha)
  — inicio = escritura + offset, duración, permanencia, y recorte `sobra`
  por espacio hasta el próximo clip. Solo aplica si se porta maozinha.
- **`legendas_formato.js`** (251 l): medición de líneas de leyenda (ancho de
  quiebre 1480, ocupación 90%, máx 2 líneas), escalado por resolución del
  proyecto y agrupación de palabras en partes para karaoke. Útil cuando se
  porte el sistema de bandas de `faixas.js`.
- **`roda_zoom.js`** (60 l): Ctrl+rueda zoom en timeline anclado a la aguja.
  Ya cubierto: Timeline.tsx tiene onWheel Ctrl/meta con ancla en el cursor.
- **`seletor_cor.js`** (150 l): implementado — recientes + paleta en
  ColorSwatch (ver IMPROVEMENT-QUEUE).
- **`formato_personalizado.js`** (175 l): ya cubierto — Inspector tiene
  FORMAT_PRESETS + ancho/alto custom + fps.
- **`area_segura.js`** / **`medidor_db.js`** / **`escopo_cor.js`** /
  **`espectro.js`** (scopes de video): ya cubiertos — safe-area-presets,
  LiveMeters/LoudnessMonitor, ScopesPanel (histograma+parade+waveform+
  vectorscope).
- **`lista_fontes.js`** (239 l): selector de fuente con botón que abre lista
  buscable (normaliza acentos, rankea prefijo > palabra > substring), items
  renderizados en su propia fuente, navegación por teclado. **2026-11-11 —
  CERRADA**: `FontPicker.tsx` (dropdown con `rankFonts` — misma normalización
  NFD y ranking prefijo > palabra > substring, opciones en su propia
  `fontFamily`, flechas/Enter/Escape) reemplaza al datalist en el campo
  Fuente del Inspector de subtítulos; la lista sigue siendo sistema +
  curada (`listSystemFonts`).
- **`preparo_videos.js`** (95 l): `PreparoVideos.trocar` — relink de ruta de
  medio post-movimiento de archivo; difiere mutaciones durante pointerdown.
  **2026-11-11 — verificado CUBIERTA**: `relinkAsset` (project-actions,
  validada: largo de path, tipo de medio, clips conservan lugar) +
  «Reconectar archivo…» en `AssetCard` (`relinkBusy` guard, diálogo por
  tipo de medio, `importMediaPaths`, aviso). La mutación ya es posterior
  al `await` del diálogo → equivalente al defer durante pointerdown.

## Lectura nocturna 6 — `transicoes_gl.js` + `transicoes_cine.js` (2026-11)

- **`transicoes_gl.js`** (34 líneas pero ~30 shaders GLSL embebidos): el
  catálogo de transiciones del motor WebGL. Nombres: DreamyZoom, SimpleZoom,
  directionalwarp/wipe, LinearBlur, crosswarp, GlitchDisplace,
  GlitchMemories, StripDatamoshGlitch, BookFlip, luma, morph, burn0,
  FilmBurn + originales AlaukCut `deslizar`, `cobrir`, `circulo`, `relogio`,
  `clarao`, `zoomradial`, `caleidoscopio`, `reflexo`, `persiana`, `tinta`.
  Los GLSL son portables a `geq` sólo para los que usan uv+progress con
  funciones soportadas (sin noise pesado ni voronoi). Implementado:
  **`persiana` → `blinds`** (10 listones en cascada, smoothstep 4 %) y
  **`relogio` → `clock-wipe`** (barrido angular horario desde el tope;
  `atan2` confirmado en geq, smoke FFmpeg 50 % alfa a p=0,5) y
  **`tinta` → `ink`** (mancha con ruido de valor 2 octavas; `if` de geq
  cortocircuita → máscara sólo durante el lead; ~10 s/frame a 1080p en el
  lead — costo acotado pero real, documentado).
  Equivalencias ya existentes: deslizar≈slide-*, cubrir≈wipe-*, circulo≈iris,
  clarao≈dip-to-white. Pendientes candidatos portables a geq:
  `caleidoscopio`/`reflexo`/`zoomradial` (necesitan ambos clips a la vez —
  la máscara alfa de un solo clip no alcanza; requerirían un pase
  overlay/persistencia como luma-mate), `clarao` (flash a blanco — requiere
  mix a blanco sobre el cuadro compuesto, no sólo alfa del entrante).
  `tinta`/`caleidoscopio`/`reflexo`/`zoomradial` (ruido y folds — geq los
  soporta pero la expresión crece mucho). Glitch*/FilmBurn/morph/BookFlip:
  mejor vía shader propio, no geq.
  **Actualización (ciclos posteriores)**: la lista MIT quedó portada casi
  completa por geq — `desenfoque-lineal` (LinearBlur, box-blur 9 taps),
  `warp-direccional` (directionalwarp, remap polar), `glitch-digital`
  (GlitchDisplace, hash por bloques), `zoom-suave` (DreamyZoom) y
  `zoom-rapido` (SimpleZoom) como remaps polares, `barrido-diagonal`
  (directionalwipe, proyección (X+Y)/(W+H)) como wipe alfa, más las
  propias `pixelar`/`interferencia`/`liquido`/`caleidoscopio` (las dos
  últimas sí resultaron portables como remap del entrante). Siguen sin
  portar: `crosswarp` (necesita 2 capas), `estilhacar` (voronoi),
  `GlitchMemories`/`StripDatamoshGlitch`/`BookFlip`/`morph`/`burn0`/
  `FilmBurn` (mejor vía shader/asset propio, no geq).
- **`transicoes_cine.js`** (129 l): 31 transiciones «cinemáticas» basadas en
  **imágenes JPG de referencia** (`img/cine/cine_a01..b13.jpg`) en grid 4×4 —
  son texturas de transición (light leaks / overlays), no shaders. Los JPG
  son assets propietarios → no se copian. **Equivalente propio
  implementado**: `textura-luz` (overlay `gradients` radial cálido de
  lavfi), `textura-celular` (overlay `cellauto` teñido a azul noche),
  `textura-fractal` (overlay `mandelbrot` con zoom, a media resolución
  + upscale por costo) y `textura-vida` (overlay `life`/Game of Life
  con paleta propia), todos con alfa modelado por luminancia (sólo
  zonas brillantes se ven) y envolvente temporal limitada al lead. El
  clip entrante disuelve debajo (`fade alpha`) para que el corte se
  lea como transición. Limitaciones honestas: texturas sintéticas
  fijas (4 variantes, no 31 secuencias), el overlay vive sólo en el
  clip entrante (no cubre al saliente como una textura full-screen
  real), y el preview de frame congelado no las soporta (cae al
  fallback de transición no congelable).

- **`capturar_imagem.js`** (128 l): captura del frame compuesto de la
  preview (espera readiness hasta 3 s), PNG/JPEG con fondo blanco para jpg,
  diálogo guardar-como y reimporta el archivo a la biblioteca de medios.
  Implementado en versión Olyvia: botón «Capturar» en Preview →
  `renderPreviewFrame(composite)` → `importMediaPaths` → Medios (sin
  diálogo guardar-como; copia al proyecto automáticamente).
- **`dicas.js`** (86 l): tooltips con globo posicionado (data-dica,
  delay 340 ms, flip arriba/abajo, foco también muestra). **CUBIERTO**:
  `components/TooltipEnhancer.tsx` puentea los ~380 `title=` nativos a
  `data-tooltip` (globo CSS, delay 340 ms sólo en hover, flip a 48 px
  del borde, foco visible) sin tocar cada componente.

## Lectura nocturna 7 — módulos chicos de UX/efectos (2026-11)

- **`canto_fixado.js`** (131 l): efecto «canto» = quad de 4 puntos
  arrastrables con overlay SVG (polygon + 4 handles), validación de
  convexidad y clamp [-0.5,1.5]. Equivalente funcional ya cubierto:
  `perspective.corners` del schema + `PerspectiveHandles` en Preview +
  selects numéricos en Inspector. Brecha menor: AlaukCut arrastra el quad
  completo o vértice a vértice con validación convexa; PerspectiveHandles
  probablemente ya hace drag por esquina (verificar comportamiento).
- **`sons.js`** (153 l): panel «Sons» — biblioteca de efectos de sonido
  por categorías (grabación/UX/transiciones), preview con ▶, descarga bajo
  demanda de items en la nube (☁), click → importa a pista de audio en el
  playhead. **CUBIERTO**: `sfx.rs` + SfxLibrary con grupos, preview y
  montaje en timeline (entrada «Biblioteca SFX» ya implementada).
- **`curvas_predefinidas.js`** (331 l): presets de easing para keyframes —
  los 13 `CURVAS_PREDEFINIDAS` de motor.js son IDÉNTICOS a
  `BEZIER_PRESETS` de Olyvia (mismos 4 params). El popup aplica la curva a
  TODOS los keyframes del instante; Olyvia aplica por keyframe vía select
  en Inspector (KeyframeCurveEditor edita handles). Cobertura funcional
  equivalente; la aplicación masiva por instante queda como mejora menor.
- **`molduras.js`** (299 l): ~20 presets de marco decorativo — formas
  (círculo/ cuadrado/ retrato/ paisaje) + estilos de borde (fino, halo,
  vidrio, neón degradado, aurora, atardecer, órbita) con radio y color.
  Olyvia cubre las FORMAS vía máscaras (ellipse/rounded/heart/polygon…) y
  desde este ciclo también el **trazo de máscara**: `strokeColor` +
  `strokeWidth` en `ClipMaskSchema` (banda alrededor del edge, render por
  distancia al borde). **CUBIERTO** como «mask stroke».
- **`caixa_silencio.js`** (234 l): panel de corte de silencios — modos
  auto/manual/semiautomático, sliders umbral dB/duración/retraso, y
  checkboxes para excluir pistas del corte por lote. **CUBIERTO Y
  SUPERADO**: `SilenceCutsSection.tsx` expone umbral dBFS, silencio
  mínimo, colchón (padding), exclusión por pista, vista previa de
  segundos/% y guardia anti-borrado >80%, con confirmación.
- **`caixa_numero.js`** (161 l): inputs numéricos con spinners ▲▼ que
  sincronizan con el slider hermano (data-attrs compartidos). **CUBIERTO**:
  `NumberField`/`OptionField` tienen stepper ▲▼ con press-and-hold
  (`startSpin`) y commit por blur/Enter.
- **`dicas.js`** (86 l): tooltips globo posicionado (delay 340 ms, flip,
  foco). **CUBIERTO** por `TooltipEnhancer` (ver entrada de lectura 6).

## Lectura nocturna 8 — módulos chicos restantes (2026-11-10)

- **`roda_zoom.js`** (59 l): Ctrl+rueda sobre la timeline = zoom anclado
  bajo el cursor (memoria de ancla entre eventos). CUBIERTO: Timeline.tsx
  ya hace exactamente eso (wheel + ctrlKey, ancla en pointerX).
- **`area_segura.js`** (126 l): overlay de zonas seguras por red social
  (reels/stories/feed/tiktok/shorts/tv) con polígonos cubre/seguro/título
  + aviso de aspecto distinto. CUBIERTO: `state/safe-area-presets.ts` +
  overlay en Preview + preferencia persistida.
- **`formato_personalizado.js`** (174 l): diálogo formato custom —
  aspecto predefinido o W×H libre + fps, límites min/max/píxeles.
  CUBIERTO: ProjectHome ya tiene presets + custom + validación.
- **`inspetor_movimento.js`** (208 l): inspector de movimiento — pos,
  escala uniforme/no uniforme, giro, ancla, opacidad, cada uno con keyframe
  + mini-tira de keyframes con aguja. CUBIERTO Y SUPERADO: Inspector de
  Olyvia tiene keyframe clipboard, curve editor, selección compartida.
- **`previa_templates.js`** (121 l): thumbnails canvas de plantillas.
  CUBIERTO: StartScreen tiene lista de plantillas.
- **`mp4_leitor_worker.js`** + **`cabecalho_mp4.js`**: lector MP4 por
  mp4box en worker + parser de header para metadatos/thumbnails.
  CUBIERTO por otra vía: FFmpeg hace thumbnails/metadatos (más robusto).
- **`prontidao.js`** (93 l): tracker de "preview lista" — motivos de
  espera (cargando, fuentes). **2026-11-11 — CERRADA**: Olyvia tiene
  `preview-readiness.ts` (imagen/video/audio/fuentes vía
  `document.fonts`) + HUD «Cargando…»; desde este ciclo los renders
  FFmpeg de frame real y captura también reportan como pendientes
  (`frame-real`/`frame-capture`), cubriendo el «render en curso» que
  faltaba.
- **`export_diario.js`** (108 l): diario de export con clasificación de
  motivos de fallo (prazo/media/no dibuja/GPU). **CUBIERTO**:
  `export-diary.ts` clasifica por keywords (gpu/timeout/media/verify/
  disk/other) y `ExportDialog` muestra la etiqueta por entrada;
  `GPU_RENDER_FAILED` ya distingue la firma GPU.
- **`prerender_ui.js`** (208 l): toggle de pre-render a disco para
  reproducción fluida. PARCIAL: Olyvia tiene proxies + frames
  congelados + caché de «Frame real» por firma de proyecto (primer
  corte de `agendador`); falta el scheduler de prerender por tramos.
- **`marca_texto.js`** (58 l) + **`maozinha_segundos.js`** (83 l):
  temporización del efecto manuscrito (escritura→permanencia→salida) y
  duración del cursor «maozinha». GAP: subsistema maozinha completo
  (cursor dibujado a mano + texto que se escribe) no existe en Olyvia.
- **`regiao_efeito.js`** (222 l): handles de región arrastrables (8 dirs)
  para efectos posicionales (espectro, marca de agua) en preview.
  GAP: pertenece al subsistema de efectos-overlay por pista «efeito» que
  Olyvia no tiene (sólo filtros full-frame en effect-kit).

## `contorno.js` (225 l, leído completo) — trazo animado «Contorno ajustable»

Clip tipo sticker con `c.contorno = {cor, espessura, fechar}`: rectángulo
redondeado con **trazo** que se dibuja solo en `fechar` segundos
(easing coseno `(1-cos(πx))/2`), margen = esp/2+0.5, radio de esquina
`clamp(esp*2.2, menor*0.09, menor/2)`, lineJoin/cap round. Canvas cacheado
por clip con versión `WxH|color|esp|prog`. Inspector: color, espesor
1-80, velocidad 0.2-4s, tamaño W×H vía escala no uniforme. Tarjeta de
galería con mini-preview animado ciclando 3 formas.

**Path de implementación en Olyvia (diseño, no implementado)**:
encaja en el pipeline motion-graphics existente — clip `graphic` +
`project.motion` + plan TS → `build_motion_ass` en Rust. Falta:
1. Capa `stroke-rect` (o `kind:'stroke'`) en `MotionLayer` con
   `{color, thickness, progress}` — hoy las capas son rellenos.
2. Emisor ASS: path `\p` de rect redondeado partido en ~24 segmentos de
   perímetro, cada uno como evento con start/end según progreso coseno —
   da el draw-on escalonado suave sin animar paths (libass no anima \p).
   Alternativa: `\clip()` vectorial no anima; segmentos temporales es la
   vía.
3. `graphic` clip necesita tamaño/posición del contorno (el plan usa
   coords normalizadas 0-1 del canvas completo — el contorno de AlaukCut
   es un sticker con transform propio; mapear a una capa rect con
   width/height en fracción + posición, o aceptar que ocupa todo el frame
   con márgenes — el caso de uso real es marco alrededor del frame).
4. Inspector: color/espesor/velocidad + tarjeta en galería Media.
5. Preview: el motion preview ya renderiza planes — verificar que la capa
   stroke se dibuje en preview (si el preview usa el mismo plan → ASS en
   canvas no existe; el preview DOM probablemente rasteriza capas —
   habría que añadir el stroke al renderer de preview también).

### Actualización `contorno.js` — viabilidad confirmada (2026-11-10)

Smoke test real con ffmpeg+libass del dev-build: un path `\p1` con dos
sub-paths de **winding opuesto** (outer CW + inner CCW) renderiza un ARO
con hueco — verificado por muestreo de píxeles (centro negro, borde
amarillo). El rect redondeado se aproxima con `b` curves de ASS o con
polígono de 32+ lados (mismo criterio que `polygon_drawing` existente).

**Diseño final viable** (sin cambiar el pipeline):
1. `templates.ts`: layer `kind:'stroke'` `{x,y,w,h,radius,color,thickness,
   drawSeconds}` — coords normalizadas como el resto de capas.
2. `motion.rs`: validar + emitir `\p1` con outer/inner rounded-rect; para
   el draw-on, K≈24 eventos Dialogue con `\clip()` **vectorial** cuyo
   polígono cubre el tramo de perímetro ya dibujado (región = path parcial
   ± grosor, construida por muestreo del perímetro — ~80 líneas Rust).
   Easing coseno `(1-cos(πx))/2` por tramo, igual que AlaukCut.
3. Template motion `contorno` con props {color, thickness, drawSeconds}
   + tarjeta en galería + Inspector de props del motion item.
4. Preview: verificar que el renderer de preview dibuje la capa stroke
   (si usa el mismo plan, añadir el path SVG equivalente).

## Lectura nocturna 9 — subsistemas grandes restantes (2026-11-10)

- **`faixas.js`** (1.689 l): titler completo en canvas — bandas/bajas con
  texto, oblicuidad (.25 skew), degradados, clip-paths, medición de texto
  con letterSpacing, animaciones T_ENTRA/T_SAI, parsing de path SVG.
  Olyvia cubre titler vía motion-graphics ASS (texto+rect+shape+stroke);
  NO tiene skew oblicuo, degradados en bandas ni clip-paths libres —
  gap de fidelidad visual, no de función.
- **`rastreamento.js`** (215 l) + **`palco_rastreamento.js`** (193 l) +
  **`camera_inteligente.js`** (134 l) + **`palco_camera.js`** (143 l):
  subsistema de tracking — datos por frame (x,y,escala,giro por cara/
  cuerpo), suavizado gaussiano σ, zoom techo 2.5 (1.2 con fondo
  desenfocado), «corte_auto», «mantener_tamaño», «fondo_desfocado»;
  camera bars inteligentes con rectángulo de paneo, zoom máx 6, curvas
  linear/suave/entrada/salida, «lousa infinita» (formato libre hasta
  6×/alcance 4). PARCIAL: Olyvia ya tiene tracking facial
  (`face_track.rs`), tracking de objeto genérico (`track_object` NCC),
  blur-que-sigue al rostro/objeto (overlay con `mask.keyframes`) y
  encuadre `fit:'blur'`; falta auto-reframe con anticipación, zoom
  techo por cámara y camera bars inteligentes (pipeline grande).
- **`luts_camera.js`** (177 l): curvas log→lineal por cámara
  (S-Log3/S-Gamut3.Cine, V-Log, N-Log, D-Log, C-Log3, GPLog) con dec/enc
  y flag `legal`. **CUBIERTO**: `visual/camera_log.rs` genera LUT .cube
  propias por perfil (`cameraProfile` en effects → `lut3d` en render),
  con dec/enc y flag legal — perfiles slog3709/slog3cinema/vlog709 en
  Inspector.
- **`espiada_midia.js`** (177 l): « Spy » — canvas flotante con preview
  del medio bajo el skim (thumbnails vivos). PARCIAL→CUBIERTO en
  sustancia: thumbnails de assets + spy aproximado del frame bajo el
  cursor en timeline (hover muestra el frame).
- **`previa_stickers.js`** (208 l): preview animada de stickers
  (sprite sheets con respiración). PARCIAL: Olyvia tiene stickers de
  formas animadas propios (entrada «Stickers de formas animadas»);
  falta el catálogo de sprites con respiración tipo emojis_animados.
- **`previa_legendas.js`** (182 l): preview de leyendas tipo karaoke
  (palabra a palabra, ciclos). **CUBIERTO**: karaoke preview con
  wrapping multilínea implementado en captions.
- **`impressao.js`** (171 l): fingerprint canónico del proyecto (JSON
  ordenado menos campos volátiles) para detectar cambios. Olyvia usa
  dirty-flag por mutaciones — cubierto por diseño distinto.
- **`suporte.js`** (124 l) + **`dialogo.js`** (35 l) + **`seletor_cor.js`**
  (149 l): toasts de soporte, confirm() promisificado, color picker.
  Cubiertos por notices/dialogs/color inputs de Olyvia.
- **`idioma.js`** (143 l): i18n con T() + pt/en/es. Olyvia es
  español-only — decisión de producto, no gap técnico.

## `luts_camera.js` — IMPLEMENTADO (2026-11-10)

Portado a `render/ffmpeg/visual/camera_log.rs`: 6 curvas dec, 6 gamuts
con npm()/PARA_709, 2 visuales, fórmula completa → `.cube` 33³ por perfil
en temp_dir + `lut3d`. `effects.cameraProfile` en schema, select en
Inspector (tarjeta LUT), preview clip-único también aplica. Ver
IMPROVEMENT-QUEUE para evidencia. Queda: `simularGravacao` (monitor de
record), detección automática, scopes legal — no portados.

## Lectura nocturna — preview animado de transiciones (`previa_transicoes.js`)

AlaukCut previsualiza cada transición con un shader WebGL en vivo sobre dos
capas de video. Olyvia no tiene WebGL en las tarjetas, pero la galería de
transiciones ahora muestra un **preview CSS animado** por tipo:

- `apps/desktop/src/features/editor/TransitionPreview.tsx`: escena de 3 capas
  ilustrativas (saliente A / entrante B / velo) con `data-tp=<tipo>`.
- `filmora.css`: `@property --tp-p` cicla 0→1→0 en 2.8 s; cada tipo calcula su
  gesto desde `--tp-p` (clip-path para wipes/iris, conic para clock, radial
  para ink, mascara de bandas para blinds, `4·p·(1−p)` para el velo de los
  fundidos a color, deslices y 3D por transform, luma-wipe como degradado
  diagonal — aproximación declarada).
- Cableado en `EditorAssets.tsx` reemplazando el glifo `iconSymbol` (el campo
  queda en los datos, sin uso visual).
- Verificación: `TransitionPreview.test.tsx` 21/21 (un render por tipo) +
  `tsc --noEmit` 0 errores.

Brecha honesta: es ilustrativo (gradientes), no footage real; luma-wipe es
aproximación direccional; blinds desliza bandas en vez de escalonar cada
listón.

## `transicao_saida` → `transitionOut` (implementado)

Hallazgo clave de `motor.js`: en AlaukCut la transición del corte vive en el
clip **saliente** (`transicao_saida`); `transicaoEntradaDe` la busca en el
vecino anterior y `preRollDe` le da al entrante material antes de su inicio.
Los fundidos (`esmaecer`, `esmaecer_preto`) además atenúan la salida del
propio clip vía `opacidadTransicion`; los gestos GL requieren el par y se
saltean sin sucesor.

Portado a Olyvia con el mismo modelo:

- `transitionOut` en schema (video/image/freeze) + validación + JSON regen.
- `resolve_transition_out` (opacity.rs): inyecta la transición del saliente
  como `transitionIn` del siguiente clip contiguo de la misma pista; el
  `transitionIn` propio gana. Se corre en `range.rs`, `window_project` y
  `composite_metadata` → lead, máscaras, slides, luma-mate y preview congelado
  funcionan sin código extra.
- `transition_trail_seconds` + `fade=t=out` en filter.rs para los 4 fundidos
  (dissolve→alpha, fade-black/white/dip-color→color), replicando
  `opacidadTransicion`. Sin sucesor los gestos no se dibujan (fiel a AlaukCut).
- `transitionOutFrozen` en el preview de un frame (keep = fracción restante).
- Inspector: sección «Transición de salida» (sin luma-wipe: el mate se
  resuelve del lado entrante); updateClip, clip-attributes (copiar/pegar),
  split (sólo la última porción conserva la salida), history-labels y la
  auditoría de visuales lo contemplan.

Verificación: 4 tests nuevos en ffmpeg::tests + 1 en preview_frame.tests +
test de schema; 16/16 tests de transición, 138 vitest, tsc y cargo check
limpios.

Brechas: OTIO/EDL/FCPXML exportan sólo `transitionIn` (el `transitionOut`
resuelto no se serializa); `luma-wipe` como salida no tiene UI (sí schema).

## `mascara_desenho.js` — IMPLEMENTADO como lazo→polígono (2026-11-10)

AlaukCut define formas de máscara `dividir/pelicula/circulo/retangulo/
estrella/corazon/texto/pincel/caneta` con propiedades de centro, tamaño,
rotación, suavidad, zoom y expansión; `pincel`/`caneta` son los modos de
trazo libre con radio y operaciones.

**Decisión de modelo**: en vez de un tipo de máscara nuevo, el trazo libre
se decima a `polygon` (ya soportado por schema, `masks.rs` geq y preview
clip-path/SVG). `state/mask-draw.ts` guarda el modo armado (efímero, fuera
del documento) y `simplifyMaskPoints` (Douglas–Peucker + muestreo
uniforme, tope 16 puntos del schema). Preview.tsx: overlay con pointer
capture sobre el monitor, Escape cancela, auto-disarm si la selección no
es visual; Inspector: `MaskDrawButton` toggle en la sección Máscara.

**Hallazgo de coordenadas**: `mask.points` vive en el espacio local de la
capa (el clip-path/`geq` se evalúa antes del transform del clip), pero el
dibujo se captura en pantalla — `maskDrawPointToLocal` invierte el
translate+scale+rotate del clip (origen al centro, igual que CSS).
Perspectiva queda fuera (aproximación documentada).

**Brechas vs AlaukCut**: polígono de ≤16 puntos (no pincel raster con
textura), sin expansión/animación de borde, sin `dividir`/`pelicula`/
`estrela`/`corazon`/`texto` como formas predefinidas dibujables.

## `sons.js` — IMPLEMENTADO como biblioteca SFX procedural (2026-11-10)

`sons.js` consume `api().listar_sons()`: grupos de efectos con preview ▶,
estado nube (☁ hasta descargar), click en tarjeta → `importar_midias` +
`adicionarMidiaNaTimeline` en la primera pista de audio libre.

En Olyvia no hay backend de catálogo, así que la vía elegida fue
**síntesis procedural propia**: `scripts/generate-sfx.mjs` genera los 8
WAV del catálogo existente (`SFX_PRESETS` ya declaraba los ids) con DSP
determinista (osciladores, ruido con seeds, pasa-bajas de un polo,
envolventes ADSR/swell). Recurso empaquetado `sfx/`, comando `sfx_library`,
contrato `sfxLibrary()`, y `SfxLibrary.tsx` reproduce el flujo `usar()`:
preview único + importar (provider 'sfx') + montar en playhead con dedup.

Brechas: sin grupos/colapsables, sin nube, catálogo fijo de 8 vs el
catálogo server-side de AlaukCut.

## `espiada_midia.js` — IMPLEMENTADO como espía de thumbnail (2026-11-10)

`espiada_midia.js` (177 l): al pasar el cursor sobre la tarjeta de un
medio en la biblioteca, un canvas sobre el monitor (`espiada-midia`)
muestra el frame del instante bajo el cursor + timecode MM:SS, con
needle `midia-skim` sobre el thumbnail. Usa `Espiada.quadro(m,t)`
(pool de lectores) con reserva `<video>` muted y respeta el modo
apilado (media apilada → mitad de frame).

En Olyvia: `state/media-spy.ts` (store efímero) + handlers en
`RailAsset` (`rail-thumb`: enter/move/leave → show/scrub/hide) +
`MediaSpyOverlay` en `preview-canvas` con `<video>` seek coalescido
(`createRafCoalescer`, una sola decode por medio) o `<img>` para
imágenes. CSS `.media-spy` letterbox negro + timecode.

Brechas: AlaukCut espía también sobre tramos de clip en timeline
(filmstrip por clip); Olyvia sólo sobre tarjetas de biblioteca. Audio
no espía (sin frame). El tiempo es sobre el archivo fuente completo,
no sobre el in-point de un clip montado.

## `faixas.js` — primer corte: letreiro de banda oblicua (2026-11-10)

`faixas.js` (1689 l) es el titler completo de AlaukCut: bandas en canvas
con skew/degradados/clip-paths, íconos, letras variables y múltiples
estilos de letreiro. Demasiado grande para un ciclo; se porta por
rebanadas empezando por el letreiro principal.

**Implementado**: template motion `faixa-letreiro` (puro TS, sin tocar
Rust — las capas `rect` con `shape:'custom'`+`points` ya renderizan en
preview clip-path y export ASS `\p1`). Réplicas fieles del original:
- paralelogramo inscripto con shear `slant` (equivalente al `incl()` que
  desplaza el borde superior `inc` px);
- color de tinta automático por luminancia de banda (`luz()`/`sobre()`:
  >0.6 → `#101318`, si no `#ffffff`);
- nombre 800 + rol 500, wrap de una línea, animación slide/fade/pop.

**Brechas del letreiro vs faixas**: sin itálica por shear (`OBLIQUO=.25`
no tiene equivalente ASS — `\frx` no es shear), sin entrada con
ease-out-back dedicada (se usa `pop`), sin tracking de posición
vertical por clip. Íconos ya portados (prop `icon`: check/person/
thumb/star geométricos); clip-paths animados cubiertos por la
animación `wipe` (barrido L→R) y la entrada con sobreimpulso por
`back` (easeOutBack). El resto de faixas.js (direcciones de wipe
alternativas, multi-línea con estilos por línea, variantes de
salida con easing propio) sigue pendiente.

## `rastreamento.js` — primer corte: fondo desenfocado (2026-11-10)

`rastreamento.js` (215 l): auto-reframe — trackea cabeza/región por
frame (x, y, giro, escala), suaviza con gaussiana, zoom de seguimiento
(ZOOM_TETO 2.5) y `fundo_desfocado` rellena el desajuste de aspecto
con copia desenfocada del clip.

Olyvia ya tenía «Seguimiento de rostro» (`face_track.rs` → keyframes
de posición/escala). El primer corte portado es el **fondo
 desenfocado** como modo de encuadre global: `fit: 'blur'` en
RenderProfile → sub-grafo split/overlay en `filter.rs` (fondo
cover+gblur+curves, primer plano contain con alfa). El auto-reframe
propiamente (tracking de región arbitraria + datos por frame +
suavizado gaussiano del track) sigue pendiente — es el subsistema
grande restante junto a faixas completo y maozinha.
