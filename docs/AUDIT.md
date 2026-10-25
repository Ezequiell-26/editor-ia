# Auditoría funcional de Olyvia (2026-10-24)

Auditoría del repositorio real (`apps/desktop`, `packages/project-schema`,
`apps/desktop/src-tauri`) y de la build instalada. No se tomaron como ciertas
las limitaciones del README sin comprobar el código.

## Estado medido

- **Pruebas**: 958 Vitest en 110 archivos, Rust **283 passed / 41 ignorados**,
  0 fallos (2026-10-24, con cámara lenta, recorte de fondo, glow, motion blur,
  seguimiento de rostro y texto libre). Build nativo verde. Playwright 11/11 es
  de una corrida anterior; no se re-ejecutó.
- **Instalador**: 218.731.520 bytes, SHA-256 `e089c498…a264678`, firma local
  válida. Ejecutable instalado: 124.049.376 bytes, SHA-256 `4307D86D…C86676`.
- **Export VFX verificado**: clip 1080p de 5 s con máscara poligonal, 259.685
  bytes, 150 frames, luma 118–125 dentro contra 25 fuera. Gate de bytes
  corregido para clips cortos/enmascarados.

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
- **Fondo automático**: segmentación local con u2netp (ONNX Runtime) sobre
  imágenes, frames congelados y tramos de video. El video se exporta como VP9
  con alfa y audio, limitado a 1080p y 3.600 frames por pasada; el render fuerza
  el decoder de libvpx para conservar el alfa (verificado end-to-end).
- **Funciones aprendidas del canal Visuals Luciano (2026-10-24)**: glow con
  preset **Glow viral**, motion blur de 2–12 frames, seguimiento de rostro y
  plantilla **Texto libre**. La matriz de paridad, la evidencia (subtítulos, no
  video completo) y los gaps restantes viven en
  `docs/research/VISUALS-LUCIANO-2026-10-24.md`.
- **Audio**: ganancia/mute/solo por pista y master; por clip: fades, high/low
  pass, EQ de 3 bandas, compresor, deesser, gate, denoise y efectos de voz.
  Ducking, loudness y medición puntual de picos. Sin paneo ni EQ por pista, sin
  automatización y sin medidores en vivo.
- **Vídeo**: transiciones, transformaciones con keyframes (posición, escala,
  rotación, opacidad), máscaras (incluida poligonal), chroma, LUT/intensidad,
  curvas, **glow/halo**, **motion blur**, scopes, títulos, subtítulos, motion
  graphics (incluida la plantilla **Texto libre**), **seguimiento de rostro**
  que crea keyframes de encuadre, proxies, multicámara con sync por audio, GPU
  (AMF), EDL/OTIO/FCPXML y VFX con roto y tracking facial.
- **IA local**: Ollama, narración SAPI, dubbing, lip-sync Wav2Lip, upscale y
  denoise, con requisitos externos documentados.
- **UX**: atajos configurables, paleta de comandos, 226 `aria-label` y diálogos
  con `role="dialog"`; el foco y la navegación completa por teclado no están
  auditados.

## Carencias priorizadas

### P1 — Integridad y flujos principales

1. **Cobertura E2E desactualizada**: Playwright no corre desde la build VFX.
2. **Rendimiento de timelines largas** sin perfilado medido (memoria, preview,
   export, proyectos con cientos de clips).
3. **Recuperación ante cierre inesperado**: el autoguardado cubre hasta el
   último retardo; no hay registro de recuperación separado verificable.

### P2 — Edición fundamental incompleta

4. **Paneo y EQ por pista** (Fairlight v2): implementado en este ciclo. Hoy
   existe paneo, EQ de 3 bandas, fader, mute y solo por pista; faltan
   automatización y preview procesada.
5. **Automatización de fader/pan** y medidores en tiempo real.
6. **Time-remap por frame** más allá de la rampa/curva por tramos.
7. **Multicámara por timecode**; la sincronización automática por audio ya
   funciona.
8. **Secuencias anidadas / clips compuestos** y multicámara con ángulos
   editables como clips.

### P3 — Herramientas profesionales de alto impacto

9. **Gestión de color HDR/ACES, 10 bits y monitores de referencia**.
10. **Tracking de objetos/planar y rotoscopía deformable**; el tracking actual
    es facial y el polígono es rígido.
11. **Paint, clonado y object removal**.
12. **VFX como grafo DAG** con ramas y compositing multicapa real.
13. **Workspace de código** y automatizaciones externas.

### P4 — Productividad, accesibilidad y distribución

14. Auditoría de foco/teclado/contraste y navegación completa sin mouse.
15. Medidores en vivo durante reproducción. El **monitor de loudness de la
    mezcla** (EBU R128 sobre el grafo real del export, con `filmcraft-audio-dsp`)
    ya existe en la vista Mezcla; falta el medidor en tiempo real sincronizado
    al playhead.
16. Firma pública con sello de tiempo y estrategia de actualizaciones.
17. Motores/IA externos fuera del instalador: onboarding claro y verificación de
    modelos por hash.

## Implementado en este ciclo

Monitor de loudness de la mezcla (BS.1770-4 / EBU R128) con `filmcraft-audio-dsp`:
- `build_plan_range` ganó un modo `audio_only`: arma sólo el grafo de audio de la
  mezcla (DSP por clip, EQ/paneo por pista, ducking, ganancia master) y emite
  PCM f32le por stdout, sin cadena de video y sin loudnorm/limitador de entrega;
- el comando `analyze_mix_loudness` abre el proyecto **guardado** (como el
  export), alimenta el `LoudnessMeter` de filmcraft por sub-bloques de 100 ms y
  emite `loudness-analysis-progress` durante la medición;
- el reporte devuelve integrated (doble compuerta), LRA, máximos momentary y
  short-term, pico digital y pico real (dBTP), el delta contra el objetivo
  configurado y el historial diezmado a ≤1200 muestras;
- la vista Mezcla ganó el panel **Loudness de la mezcla**: guarda, mide y
  dibuja las curvas momentary/short-term con la línea del objetivo, con el
  consejo de cuánto subir/bajar el master (o qué hará la normalización);
- pruebas Rust: calibración del tono de alineación 997 Hz −23 dBFS → −23 LUFS
  (±0,1), silencio sin infinitos serializables, diezmo del historial, delta
  redondeado, plan audio-only sin `-progress`/loudnorm/`-c:v`, y live opcional
  con `EDITOR_IA_FFMPEG`; pruebas Vitest del panel (medición, delta, error de
  guardado, sin objetivo).

Paneo y EQ de 3 bandas por pista:
- campos opcionales en `TrackSchema` (`pan`, `eqLowDb`, `eqMidDb`, `eqHighDb`);
- validación en acciones y JSON Schema regenerado;
- filtros FFmpeg reales por pista en el render (`equalizer` 120/1k/8k y `pan`
  de balance lineal) después del DSP de clip y antes del fader;
- controles en la vista Mezcla con reset de EQ;
- pruebas de esquema, acciones, helpers, UI y grafo de render.

Medición real con el FFmpeg instalado (tono 440 Hz, 1 s, 48 kHz):
- paneo -0.5: izquierda **-24,1 dB** de media, derecha **-30,1 dB** (6,0 dB de
  diferencia, exactamente el 0,5 de ganancia);
- EQ de 120 Hz a -12 dB: media **-24,1 → -36,0 dB** (-11,9 dB efectivos).

Límite: la preview reproduce ganancia y solo; el paneo y EQ de pista se aplican
en el export, igual que el DSP de clip que la preview no simula.

**Defecto de suite corregido**: el test `visual_effects_reach_the_filter_chain`
todavía esperaba `sendcmd`/`colorchannelmixer@fade0` de una implementación
anterior de los fades. Ahora verifica los `fade=t=in/out` reales; la suite
completa volvió a 274/0 fallos. También se agregó un test live opcional que mide
el paneo y el EQ con FFmpeg (`EDITOR_IA_FFMPEG`).

## Continuidad

1. Reproducir paneo/EQ de pista en la preview con Web Audio (o declarar el
   límite en la UI del monitor).
2. Automatización de fader/pan y medidores **en vivo sincronizados a la
   reproducción** (el monitor de loudness de la mezcla ya está en la vista
   Mezcla desde este pase).
3. Time-remap por frame (la rampa/curva por tramos ya está).
4. Multicámara por timecode.
5. Empaquetar la build con este pase y verificar el export desde la app
   instalada.
6. El test `empaqueta el proyecto desde Archivo…` de `App.test.tsx` falla
   también en HEAD limpio (verificado en worktree aparte): quedó atascado el
   flujo de creación en ese test. Es un fallo preexistente del commit
   `98a5c22`, no de este pase; conviene arreglarlo antes de empaquetar.
