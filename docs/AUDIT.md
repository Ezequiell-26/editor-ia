# Auditoría funcional de Olyvia (actualizada 2026-10-25, ciclo 2)

Auditoría del repositorio real (`apps/desktop`, `packages/project-schema`,
`apps/desktop/src-tauri`) y de la build instalada. No se tomaron como ciertas
las limitaciones del README sin comprobar el código.

## Estado medido

- **Pruebas**: 1081 Vitest en 124 archivos, Rust **342 passed / 46 ignorados**,
  0 fallos (2026-10-25, con curvas Bézier en keyframes, clonación de voz local
  por HTTP, medidores de audio en vivo y paneo/EQ de pista en la preview).
  Typecheck de los 3 paquetes limpio.
- **Instalador**: 218.731.520 bytes, SHA-256 `e089c498…a264678`, firma local
  válida (build del 2026-10-24; pendiente re-empaquetar con este ciclo).
- **Export VFX verificado** (2026-10-24): clip 1080p de 5 s con máscara
  poligonal, 259.685 bytes, 150 frames, luma 118–125 dentro contra 25 fuera.

## Lo que ya es real

- **Timeline**: split, delete, ripple delete, move magnético, trim, slip, slide y
  roll validados en `apps/desktop/src/state/project-actions.ts`; huecos,
  snapping y zoom.
- **Persistencia**: guardar/guardar como, autoguardado con retardo configurable,
  historial acotado, undo/redo y recuperación del último proyecto.
- **Velocidad**: velocidad constante exacta por clip (`speed` como tasa),
  rampa y curva por tramos, y **cámara lenta con interpolación** de movimiento
  (`minterpolate`) verificada a 0,5× con 60 frames en 2 s (2026-10-24).
  Contrato duración/fuente validado por esquema. Falta time-remap por frame.
- **Curvas Bézier de keyframes (2026-10-25)**: el campo `bezier`
  (`{cp1X,cp1Y,cp2X,cp2Y}`, 0–1) es parte del esquema; la preview y los helpers
  de muestreo resuelven `y(x=t)` con Newton + bisección (`cubicBezierProgress`),
  y la convención es la misma que `easing`: la curva del keyframe de inicio
  gobierna su segmento. El Inspector ganó la sección **Curvas** con
  `KeyframeCurveEditor` (arrastre de manejadores con pointer events, spans
  reales por frames, degradación sin canvas) que persiste con
  `setTransformKeyframe`. El render FFmpeg evalúa la Bézier de cada segmento.
  Los presets (`linear`, `ease-in/out/in-out`) y `hold` (escalón) se mantienen
  exactos; sin curva explícita no cambia nada.
- **Fondo automático**: segmentación local con u2netp (ONNX Runtime) sobre
  imágenes, frames congelados y tramos de video. El video se exporta como VP9
  con alfa y audio, limitado a 1080p y 3.600 frames por pasada; el render fuerza
  el decoder de libvpx para conservar el alfa (verificado end-to-end).
- **Funciones aprendidas del canal Visuals Luciano (2026-10-24)**: glow con
  preset **Glow viral**, motion blur de 2–12 frames, seguimiento de rostro y
  plantilla **Texto libre**. La matriz de paridad y los gaps viven en
  `docs/research/VISUALS-LUCIANO-2026-10-24.md`.
- **Audio**: ganancia/mute/solo por pista y master; por clip: fades, high/low
  pass, EQ de 3 bandas, compresor, deesser, gate, denoise y efectos de voz.
  Ducking y loudness. **Panorámica y EQ de pista** en export (balance lineal,
  verificado con FFmpeg: pan −0.5 → 6 dB de diferencia; EQ 120 Hz −12 dB →
  −11,9 dB) **y en la preview** con un grafo Web Audio por pista (EQ lowshelf/
  peaking/highshelf 120/1k/8k → fader → paneo con splitter+gains para conservar
  la imagen estéreo) espejo de `track_audio_filters` en `ffmpeg.rs`.
  **Medidores en vivo sincronizados al playhead** (RMS/pico por pista y master
  con `AnalyserNode`, panel en la vista Mezcla) y monitor de loudness de la
  mezcla (BS.1770-4 / EBU R128 con `filmcraft-audio-dsp`). Pendiente:
  automatización de fader/pan.
- **Vídeo**: transiciones, transformaciones con keyframes (posición, escala,
  rotación, opacidad) con curvas, máscaras (incluida poligonal), chroma,
  LUT/intensidad, curvas, glow/halo, motion blur, scopes, títulos, subtítulos,
  motion graphics (texto libre + 5 plantillas pro: placa minimalista, barras de
  cine, zoom punch, glitch de texto y título cinematográfico), seguimiento de
  rostro, proxies, multicámara con sync por audio, GPU (AMF), EDL/OTIO/FCPXML y
  VFX con roto y tracking facial.
- **Clonación de voz local por HTTP (2026-10-25)**: adaptador para motores
  **XTTS API Server** / **GPT-SoVITS** por loopback (rechaza URLs remotas y
  credenciales en disco), valida muestra 3–30 s y texto ≤2000 caracteres,
  verifica el WAV de respuesta y lo guarda como `media/voz-clonada-*.wav`.
- **IA local**: Ollama, narración SAPI, dubbing, lip-sync Wav2Lip, upscale y
  denoise, con requisitos externos documentados.
- **UX**: atajos de teclado pro documentados y probados (`docs/ATAJOS-PRO.md`),
  paleta de comandos, 226 `aria-label` y diálogos con `role="dialog"`. El pase
  de organización visual (2026-10-25) normaliza espaciado 4/8 px, jerarquía de
  secciones y sube a AA los grises secundarios. La auditoría de foco/teclado
  con plan de 6 fases vive en `docs/research/ACCESIBILIDAD-2026-10-24.md`.

## Carencias priorizadas

### P1 — Integridad y flujos principales

1. **Cobertura E2E desactualizada**: Playwright no corre desde la build con
   curvas Bézier y medidores.
2. **Rendimiento de timelines largas** sin perfilado medido (memoria, preview,
   export, proyectos con cientos de clips).
3. **Recuperación ante cierre inesperado**: el autoguardado cubre hasta el
   último retardo; no hay registro de recuperación separado verificable.

### P2 — Edición fundamental incompleta

4. **Automatización de fader/pan por keyframes** (los medidores y el paneo/EQ
   de pista ya funcionan en export y preview).
5. **Time-remap por frame** más allá de la rampa/curva por tramos.
6. **Multicámara por timecode**; la sincronización automática por audio ya
   funciona.
7. **Secuencias anidadas / clips compuestos** y multicámara con ángulos
   editables como clips.

### P3 — Herramientas profesionales de alto impacto

8. **Gestión de color HDR/ACES, 10 bits y monitores de referencia**. Diseño en
   `docs/research/COLOR-HDR-VFX-DAG-2026-10-24.md`.
9. **Tracking de objetos/planar y rotoscopía deformable**; el tracking actual
   es facial y el polígono es rígido. Diseño por fases en
   `docs/research/TRACKING-PLANAR-2026-10-24.md`.
10. **Paint, clonado y object removal**.
11. **VFX como grafo DAG** con ramas y compositing multicapa real (diseño en el
    mismo documento de color/VFX).
12. **Workspace de código** y automatizaciones externas.

### P4 — Productividad, accesibilidad y distribución

13. Auditoría de foco/teclado/contraste: el **plan de corrección** está en
    `docs/research/ACCESIBILIDAD-2026-10-24.md` (bloqueantes: trampa de foco en
    diálogos, trim/mover sin teclado, Space global roba activación); ejecutar
    sus fases.
14. Firma pública con sello de tiempo y estrategia de actualizaciones.
15. Motores/IA externos fuera del instalador: onboarding claro y verificación
    de modelos por hash.
16. **Precisión Bézier del export**: el render evalúa `y(u=t)` (el progreso del
    segmento como parámetro) mientras la preview resuelve `y(x=t)`; para curvas
    suaves la diferencia es pequeña, pero conviene pre-muestrear la curva en
    Rust (Newton, igual que la preview) y emitir la expresión por tramos.

## Implementado en este ciclo (2026-10-25)

Ocho agentes en paralelo + integración manual, sobre el ciclo de loudness del
2026-10-24 (monitor EBU R128 y paneo/EQ por pista, ya descritos arriba):

1. **Audio pro en la preview**: grafo Web Audio por pista (EQ 3 bandas, fader,
   paneo lineal con splitter→gains→merger, bus master con analizador) espejo
   del export, con degradación silenciosa a `element.volume`; medidores en vivo
   RMS/pico por pista y master en la vista Mezcla (`LiveMeters`,
   `usePreviewAudio`). `state/audio-mix.ts` restauró sus helpers canónicos y
   sumó `samplePanGain`/`panPanLabels` (balance lineal) y conversiones
   dBFS↔RMS; `usePreviewAudio` re-exporta sin copias.
2. **5 plantillas de motion graphics pro** en `templates.ts` (placa
   minimalista, barras de cine, zoom punch, glitch de texto, título
   cinematográfico) con 9 tests que replican las invariantes del plan.
3. **Presets de speed ramp** (`speed-ramp-presets.ts`: Héroe, Montaje rítmico,
   Congela y sigue, Entrada lenta, Salida rápida) y fila de botones en la
   sección Velocidad del Inspector.
4. **Atajos de teclado pro** (`shortcuts.ts` + `docs/ATAJOS-PRO.md` +
   `shortcuts-pro.test.ts`): shuttle J/K/L, paso a frame, marcador, splits,
   ripple delete, zoom, Home/End — sin reasignar existentes.
5. **Organización visual**: pase aditivo de 391 líneas en `app.css` (espaciado
   4/8 px, jerarquía de secciones, 11 grises subidos a AA, focus-visible,
   scrollbars).
6. **Investigación/diseño** (cero código): tracking planar + roto deformable,
   color HDR/10-bit + VFX grafo DAG, y auditoría de accesibilidad con plan de
   6 fases (`docs/research/`).
7. **Curvas Bézier** (integración del MVP de otro pase): matemática corregida
   en `cubicBezierProgress` (resuelve y(x=t) con Newton + bisección), muestreo
   conectado al esquema, convención start-keyframe-gobierna-segmento, editor
   con arrastre real, persistencia por `setTransformKeyframe` (con validación
   de puntos de control en `normalizeTransformPatch`) y render FFmpeg por
   segmento. 20 tests nuevos.
8. **Clonación de voz local** (integración de otro pase): compilación reparada
   (código muerto eliminado, `format!` corregido, moves ilegales, `parse_easing`
   con default linear y Bézier como objeto del esquema) y el test del mock HTTP
   corregido a runtime `multi_thread` (el `accept()` bloqueante colgaba el
   runtime de un solo hilo).

Verificación del ciclo: `npm run typecheck` limpio; **Vitest 1027/1027** en 119
archivos; **cargo test 337/0 fallos** (46 ignorados).


## Implementado en este ciclo 2 (2026-10-25)

Ocho agentes en paralelo (interrumpidos por un cambio de rama externo y
recuperados desde stash) + feature propia del integrador:

1. **Accesibilidad fase 1**: hook `useDialogFocus` (trampa de foco, Tab
   cíclico, Escape, retorno al disparador) adoptado en Configuración y
   Exportar; tests propios.
2. **Accesibilidad fase 2 (en curso al pausarse)**: teclado para mover/trim en
   Timeline y Space global que no roba activación — quedó a medias y se
   revertirá/rehará en la iteración 3.
3. **Automatización de fader/pan (parcial)**: keyframes de pista en el schema
   y acciones; el render Rust y la UI de captura quedan para la iteración 3.
4. **Bézier exacta en el render Rust**: pre-muestreo y(x=t) con Newton y
   expresión FFmpeg piecewise de 16 tramos; presets intactos; tests con
   evaluador numérico de expresiones. Paridad preview↔export real.
5. **6 plantillas de título pro** (retícula de noticias, kicker lateral, cita
   documental, marca de agua, capítulo, entrevista) con validación contra
   CaptionStyleSchema.
6. **Recuperación ante cierre**: registro verificable en localStorage con
   oferta de restauración en el store (14 tests).
7. **Multicámara por timecode (integrador)**: probe ffprobe con timecode,
   núcleo NDF con rechazo drop-frame, offsets con referencia más tardía y
   botón «Sincronizar por timecode» en la mesa (diseño en
   docs/research/MULTICAM-TIMECODE-2026-10-25.md).
8. **Cortar silencios (integrador)**: detección por picos con umbral/padding,
   plan con guardia anti-borrado masivo (>80%) y aplicación por split+ripple
   de las acciones existentes; wiring de UI pendiente.
9. **Diseños**: paint/object removal y plan E2E+rendimiento (docs/research/).

**Recuperación de incidente**: un cambio de rama externo (Qoder) stashó el
árbol en pleno vuelo y una sesión concurrente dejó feature Lottie a medias que
había entrado a medias en f3425ba (variante de schema sin consumidores, zod 4
en el lock, servicio inexistente). Rescate con parches fuera del repo, trabajo
en worktree aislado (rama integracion-loop2), purga de lo renegado y fixes:
variante lottie eliminada del schema, zod fijado a 3.24.1 con overrides (y
zod-to-json-schema 3.23.5), test de EDL DF con la duración correcta (60/29.97),
duplicado de slider de paneo eliminado y schema JSON regenerado.

## Continuidad

1. Ejecutar las fases 0–2 del plan de accesibilidad (trampa de foco en
   diálogos, teclado para mover/trim, Space global).
2. Automatización de fader/pan por keyframes (P2 #4).
3. Pre-muestrear la Bézier en el render Rust para exactitud `y(x=t)` (P4 #16).
4. Time-remap por frame (P2 #5).
5. Multicámara por timecode (P2 #6) y secuencias anidadas (P2 #7).
6. Re-empaquetar la build con este ciclo y verificar export desde la app
   instalada; renovar Playwright E2E (P1 #1).
