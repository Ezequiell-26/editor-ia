# 2026-11-17 — Sesión: verificación integral del editor unificado + higiene

Continuación de `2026-11-13-un-solo-editor.md`. ~35 pasadas documentadas en
`docs/IMPROVEMENT-QUEUE.md` (pasadas 60–94). Resumen de lo durable:

## Estado del editor unificado (verificado en vivo, no sólo tests)

- Un solo `EditorWorkspace` tras el launcher; 14 herramientas dentro;
  Preview/Timeline/Inspector conservan identidad al conmutar (contrato
  `unified-editor.contract.test.tsx`).
- **Mapa preview↔export ejercitado con píxeles/señal real en la app
  Tauri+CDP**: grade CSS/SVG, LUT perfil/.cube/look (WebGL), stack WebGL
  (pixelate verificado por corridas de color), chroma spill, motionBlur
  temporal (2 tomas, `u_prevTexture`), lensCorrection (`lens.correct`,
  warp radial), transiciones (ventana lead + 42 tipos), captions con
  timing por seeks reales, scopes, mixer (faders→proyecto→autosave),
  audio real (medidores −27 dB + AAC en MP4), audioStack (trémolo medido
  en el VU: oscilación 25–55 % confinada al clip), multicámara
  (sync + cambio de ángulo + pista generada), freeze-frame (PNG real +
  inserción), y las 6 herramientas de preview (dibujar, audio, llenar,
  comparar, frame real, capturar).
- Export real: `exports/test-cdp.mp4` h264 1080p30 + AAC 4.000 s exactos.

## Hallazgos de honestidad UI corregidos

- `effects.lutFile`/`cameraProfile` estaban **inalcanzables** (su única UI
  era la sección legada `group="color"` que la pestaña Color ya no
  renderiza) → nuevo `LutFilePanel` en `ColorPropertiesPanel`.
- ~700 líneas de secciones `group="color"` resucitadas retagueando a
  pestañas vivas (Estilo→Efectos, Video→Básico); ~160 líneas 100 % muertas
  eliminadas (Ruedas/HSL/Curvas del inspector clásico).
- `relight` tiene UI canónica en `inspector/RelightSection.tsx`
  (Video→IA); un panel duplicado fue revertido (errata de auditoría por
  grep case-sensitive).
- 4 textos «la preview no la simula» eran falsos (denoise, speedCurve,
  glow, relight) — todos tienen aproximación real en preview.

## Limpieza estructural

- `minimal-editor.css` + `minimal-editor-scenes.css` (2404 líneas)
  eliminados: la raíz `.minimal-editor` ya no existe en el DOM. La parte
  viva (chrome AlaukCut §9/§10) se preservó en `styles/alauk-chrome.css`.
- Cero módulos TS sin imports (443 auditados), cero comandos IPC sin
  caller (~190 handlers), cero deps npm sin uso, cero TODOs de producción.
- `VIEW_PRELOADERS`: los 15 chunks son canónicos o compartidos con los
  lazy-loaders del workspace (mismo módulo = mismo chunk Vite).

## Verificación de cierre

`typecheck` exit 0 · `test:serial` 3071/3071 · `test:extension` 33/33 ·
`test:web-tts` 10/10 · `audit:security` PASS · **`npm run build` exit 0**
(dist sin rastros de minimal-editor).

## Pendientes genuinos (features grandes, no bugs)

- **Estabilización vidstab en preview**: el `.trf` es binario `TRF1` con
  *mediciones locales por campo* (vx vy fx fy size contrast match), NO el
  camera path — éste se computa en el segundo pase de vid.stab
  (estimación de movimiento global + smoothing + crop=black). Una preview
  fiel exige reimplementar ese algoritmo (RANSAC/global motion), no un
  parser. Documentado en `docs/trf-format.md` de vid.stab.
- **`denoise` paridad temporal**: la preview ya muestra blur espacial
  (`clipDenoiseBlurPx`); hqdn3d temporal+espacial del export no tiene
  equivalente WebAudio honesto.
- `project.look.lutFile` con capas superpuestas: aproximación por capa
  documentada.
- Diálogo nativo «Guardar como» de `start_render`: no conducible por CDP
  (limitación de automatización, no bug).

## Notas de tooling

- Driver CDP reutilizable: `%TEMP%\olyvia-cdp.mjs`
  (`node olyvia-cdp.mjs "<js>"` contra WebView2 :9222).
- Reabrir proyecto tras editar el JSON: `adopt_project` por invoke NO
  actualiza el store React — hay que volver a StartScreen y reabrir.
- `npm run thumbnails:effects` regenera los SVG del catálogo (requerido
  por `effect-thumbnails.test.ts` al agregar efectos).

## Addendum pasadas 95–100

- Pasadas 95-96: vidstab preview cerrado como pendiente genuino (.trf = mediciones
  locales crudas; el camera path lo calcula el 2do pase de vid.stab — requeriría
  reimplementar el estimador global). audit:licenses OK, test:inventory OK,
  test:studio bloqueado por os error 32 (binario en uso por la app corriendo).
- Pasada 97: `denoise.temporal` v1 — promedio edge-preserving de 2 tomas.
- Pasadas 98-99: freeze/reverse/hold ya implementados (texto stale corregido);
  auditoría final de fine-prints preview↔export limpia.
- Pasada 100: `denoise.temporal` v2 — webgl.ts ahora guarda historia de 4 frames
  fuente (ring buffer cronológico, mismas guardas anti-ghost) y el shader
  pondera las 4 tomas por similitud de color. Verificado en vivo con playback
  real sin errores de consola. Sigue `approximate` vs hqdn3d (sin sigma
  adaptativo ni espacial propia — la espacial es el blur CSS).
- Tooling: para relanzar la app con CDP usar
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222
  --remote-allow-origins=*" npm run tauri:dev` (el puerto 3000 lo sirve un
  vite previo del mismo repo; tauri:dev toma 3001+ pero devUrl apunta a 3000,
  que sirve los mismos archivos).

## Addendum bis — pasadas 101–104

- Pasada 101: `impact.trail` migrado a estela temporal real (4 tomas, decaimiento
  lineal). Verificado en vivo con playback sin errores.
- Pasada 102: `blur.temporal` migrado a promedio uniforme de hasta 5 tomas
  (actual + 4 historia) — paridad conceptual con `tmix=frames=N`. Param
  `frames` topado a 5 en el manifiesto.
- Pasada 103: historial WebGL bajo demanda — `needsHistory` escanea el GLSL de
  los efectos activos; sin efectos temporales no hay copia por frame y
  `historyCount` se resetea para que un efecto recién activado arranque limpio.
- Pasada 104: `test:serial` post-refactor **341 archivos / 3074 tests / 0
  fallos**. Audio: los 30 `audio.*` tienen equivalente Web Audio (100%).
  `blur.motion` (direccional espacial vs tmix temporal) queda documentado
  como approximate en ambas puntas — sin fix limpio.
- Pendiente conocido: `u_prevTexture` sigue expuesto por compat con efectos
  custom; ningún efecto del catálogo lo usa ya.

## Addendum tres — pasadas 105–109

- 105: paneles Motion/Visuals/VFX auditados — estado local legítimo, cero
  controles muertos.
- 106: `nodes` no tiene compositor paralelo — usa el mismo webgl.ts.
- 107: `.gitignore` — `.olyvia-history/`, `/exports/`, `/media/` fuera del
  árbol (anclados a raíz).
- 108-109: **diseño cerrado para preview de estabilización vidstab** —
  proxy horneado con el mismo `vidstabtransform` del export (paridad casi
  exacta). Plan de implementación paso a paso en IMPROVEMENT-QUEUE
  (Pasada 109): Rust bake en `media_analysis.rs`, schema
  `stabilization.previewProxy`, selección de fuente en Preview.tsx,
  invalidación por ventana/smoothing, tests y verificación CDP.
- Pendiente de commit: ~34 archivos + .gitignore (sin autorización).

## Addendum cuatro — pasada 110: vidstab preview IMPLEMENTADO

- `analyze_stabilization` (Rust) hornea `media/stabilizers/*-preview.mp4`
  con el mismo `vidstabtransform` del export + audio AAC; best-effort.
- Schema: `stabilization.previewProxy` opcional; `setClipStabilization`
  lo preserva; Inspector lo guarda y cambia el notice.
- Preview: `clipStabilizationPreviewProxy()` (mismas guardas que
  `resolve_stabilization`) elige el proxy como fuente y descuenta
  `source.inFrame` del currentTime.
- Verificado: cargo check exit 0, tsc exit 0, tests 17/17 + 6/6.
- PENDIENTE: verificación en vivo requiere rebuild del binario Tauri
  (la app en ejecución tiene el Rust viejo). Al reabrir: analizar
  estabilización → video.src debe ser *-preview.mp4.
- ~38 archivos sin commitear.

## Addendum cinco — pasada 111: vidstab preview verificado en vivo

- Flujo completo probado por CDP: análisis → bake → previewProxy en JSON
  → <video> reproduce *-preview.mp4 → playback sin errores.
- IMPORTANTE: el FFmpeg bundled (resources/ffmpeg n9.0.2) tiene
  --disable-libvidstab y --disable-libx264 → estabilización y x264 nunca
  funcionaron con él. Se configuró ffmpegPath/ffprobePath a chocolatey
  (9.0.1 essentials, full) vía IPC `set_tool_paths`. Si el usuario
  revierte settings.json a null, la estabilización vuelve a fallar.
