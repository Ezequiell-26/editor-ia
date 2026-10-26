# Toolkit de Edición Avanzada para Editor IA — 2026-10-25

**Objetivo:** listar **todas las herramientas avanzadas de edición que se pueden agregar** usando FFmpeg 9.0+, modelos locales open-source y APIs gratuitas, con evidencia de implementación viable, impacto en flujo real y ubicación exacta del código.

Esta auditoría es **técnica**, no copiada de competidores: cada herramienta debe ser implementable sin violar licencias ni depender de servicios propietarios cerrados.

---

## Estado actual (resumen ejecutivo)

### Ya implementado (verificado con tests)

**Video/transformación:**
- ✅ Transformación básica: escala, posición, rotación, opacidad
- ✅ Keyframes de transformación/opacidad/ganancia con easing lineal/ease-in/out/hold
- ✅ Movimiento Ken Burns con `zoompan`
- ✅ Curvas de velocidad por tramos (3 puntos)
- ✅ Reverse/clips invertidos
- ✅ Freeze frame (extracción de frame único)
- ✅ Máscaras rectángulo/elipse con feather, rotación y keyframes
- ✅ 9 blend modes con `blend` filter
- ✅ Chroma key básico (`chromakey`)
- ✅ Corrección de lente: `lenscorrection`
- ✅ Relight radial local con detección SeetaFace
- ✅ Rotación animada con `rotate eval=t`
- ✅ Escala dinámica con curves min<1 (`scale_zoom_expression` + `scale_dynamic`)
- ✅ Motion + scale combinados
- ✅ Speed + scale combinados
- ✅ Fade alpha con `fade:alpha=1`
- ✅ Composite Frame real (todo el compuesto en 0.2–0.3 s)

**Color:**
- ✅ Brillo, contraste, saturación, temperatura, tono
- ✅ Highlights/shadows/curvas RGB/HSL
- ✅ LUT `.cube` por clip y look global con intensidad
- ✅ Viñeta, nitidez, desenfoque bilateral, B/N, sepia
- ✅ Ruedas RGB lift/gamma/gain y Offset (4ta rueda)
- ✅ Equalizer HSL selectivo (6 rangos)
- ✅ Scopes: waveform, vectorscope, histogram, parade
- ✅ Curvas predefinidas (vintage, cross-process, cine)

**Audio:**
- ✅ Gain master por pista y clip
- ✅ Fades entrada/salida audio
- ✅ EQ 3 bandas paramétrico + highpass/lowpass
- ✅ Compresor multibanda
- ✅ Reducción de ruido: `afftdn`, `hqdn3d`, `nlmeans`
- ✅ Presets "Voz clara", "Música", FilmCraft DSP
- ✅ Loudness ITU: `loudnorm` -14/-23 LUFS
- ✅ Voice changers: deep, chipmunk, robot, echo, cave, radio
- ✅ TTS SAPI local y ElevenLabs API
- ✅ Clonación de voz por loopback (XTTS/gpt-sovits)
- ✅ Lip-sync con Wav2Lip (límite 45s/1280px)
- ✅ Beat sync local por energía/onsets

**Texto/subtítulos:**
- ✅ Subtítulos ASS con estilo completo y animaciones por palabra
- ✅ 9 plantillas de títuloLowerThird/Scroll/Typewriter/etc.
- ✅ Import/export SRT/VTT con validación
- ✅ Subtítulos automáticos Faster-Whisper `small` CPU
- ✅ Dubbing desde vista Localización con cues alineadas
- ✅ Texto 3D por extrusión de sombras ASS

**Edición timeline:**
- ✅ Multipista, trim, split, move, ripple
- ✅ Slip/slide/roll/cerrar huecos
- ✅ Snap a bordes/marcadores/playhead
- ✅ Copy/paste atributos en lote por color
- ✅ Subir/bajar capas
- ✅ Búsqueda de clips por nombre
- ✅ Marcadores con rangos editables y colores
- ✅ Capas de ajuste por tramo
- ✅ Compound clips con expansión

**IA/automatización:**
- ✅ Auto Short con face detection y reframe inteligente
- ✅ Detección de escenas local
- ✅ Guion IA con handoff structurado
- ✅ Lote de variantes con render secuencial
- ✅ Publicación con manifiesto JSON y auditoría
- ✅ Descarga social con yt-dlp y extension browser
- ✅ Proxy 854px generado y usado en preview

**Render/entrega:**
- ✅ Render atómico verificado FFprobe
- ✅ Perfiles 16:9/9:16/1:1
- ✅ Export en lote secuencial
- ✅ H.264/H.265, CRF 20/24/27, AAC 128/160/192 kbps
- ✅ Fit contain/cover

---

## Herramientas avanzadas FALTANTES para agregar (priorizadas)

### Tier T1: Primitivas fundamentales (impacto alto, viabilidad alta)

#### 1. **Curvas de velocidad continuas con optical flow**

**Estado actual:** rampa lineal de 3 tramos (inicio/mitad/fin) con interpolación lineal de速度 entre ellos.

**Qué falta:**
- Curva Bézier libre editable con controladores
- Interpolación suavizada por frame con `setpts`
- **Optical flow frame interpolation** (`minterpolate`) para generar frames intermedios y suavizar motion blur natural

**Implementación:**
- Schema: `speed_curve: { points: [{ t: number, speed: number }] }` con al menos 5 puntos
- UI: editor de curvas Bézier sobre grid temporal (como Premiere/DaVinci)
- Render: derivar expresión `speed(t)` por frame y aplicar `setpts=PTS*1/speed(t)`
- Optflow: `minterpolate=fps=12:mi_mode=miaeo:me_mode=bidi` antes de speed ramping para suavizar transiciones rápidas

**Impacto:** motion smoother en ramps, efecto profesional, necesario para paralajes fluidos

**Ubicación:**
- Schema: `packages/project-schema/src/timeline.ts` → `ClipSchema.speed`
- Render: `apps/desktop/src-tauri/src/render/ffmpeg.rs::build_filter_graph()`
- UI: `apps/desktop/src/features/editor/Inspector.tsx::ClipSpeed`

**Tests needed:**
- curva con 5 puntos, transición rápida 0.5×→3×
- optical flow vs sin optflow (medir Laplacian variance para sharpness)
- reverse + speed curve (invertir curva también)
- freeze dentro de curva (congelar donde v=0)

**Referencia CapCut:** `curve_speed`, `vimo curve_speed effect`
**Referencia DaVinci:** Speed and Change page con curves y optical flow

---

#### 2. **Máscaras avanzadas: bezier libre, tracking, track matte**

**Estado actual:** máscaras rectángulo/elipse con centro, tamaño, rotación, feather e inversión.

**Qué falta:**
- Máscara Bézier libre con n puntos editables (add/delete points)
- Tracking de máscara automáticamente (motion tracking manual + semi-auto)
- Track matte: usar otro clip como máscara luminance/alpha
- Feather non-uniform y mask expand/shrink keyframed

**Implementación:**
- Schema: `mask: { type: 'bezier', points: [{x,y}], closed: boolean, feather: number, inverted: boolean }`
- UI: canvas SVG con puntos arrastrables, Ctrl+clic para añadir, Delete para borrar, Shift+drag para feather
- Tracking: usar `opticflow` o `dftblur` para pre-calcular offset por frame, o integrar modelo open-source (DAVIS tracker lite)
- Track matte: `format=yuv420p;overlay=format=full;eq=contrast=1,bw` para luminance mask; `overlay=format=ya` para alpha mask
- Expression: `maskpoints` interpolados por frame con easing, geq filter para evaluar punto por pixel

**Impacto:** compositing avanzado, remove objetos, isolate subject, matte painting

**Ubicación:**
- Schema: `timeline.ts::VisualClip.mask`
- Render: `ffmpeg.rs::apply_mask_with_tracking()` nueva función
- UI: `features/editor/MaskEditor.tsx` nuevo componente

**Tests needed:**
- bezier 8 puntos con feather 20 px, rotación 0→90°
- tracking 30 frames con offset manual corregido (validate offset stored)
- track matte black→white transition, alpha matte soft edge
- feather keyframed 0→30 px, mask expansion keyframed

**Referencia CapCut:** `common_mask`, `mattingBlendV2`, `KFTypeCommonMask`
**Referencia Resolve:** Shape masks, polygon masks, track matte, 3D cameras

---

#### 3. **Transiciones solapadas avanzadas: wipe, dip, iris, transform**

**Estado actual:** disolvencia fade-in/fade-out, dip to black, slide horizontal/vertical, fundidos a negro/blanco.

**Qué falta:**
- Wipe transitions con shape: circle, ellipse, rectangle, diamond, triangle, custom path
- Iris: zoom in/out circular desde centro
- Transform wipe: puerta abierta, persiana, cortina vertical/horizontal
- Pattern wipe: wave, checkerboard, starburst, clock wipe
- Crossfade con superposición de tiempo configurable (no fija)
- Transiciones multi-layer (varias clips simultáneamente)

**Implementación:**
- Schema: `transition: { type: 'wipe'|'iris'|'transform'|'pattern', duration: number, shape?: string, progress?: 'in'|'out'|'both', overlap?: number }`
- UI: selector de tipo, slider duration, preview de shape, slider overlap (0–50% clip duration)
- Render wipe: `maskclick` con pattern animado o `geq` custom expression
- Render iris: `zoompan` con radius variable, `fade` con center shift
- Render transform: `perspective` filter o `affine` matrix animation
- Crossfade overlap: `-trim=start=a_in-end=a_out+overlap:start_trim=-overlap`

**Impacto:** transiciones más dinámicas, style branding, conectores narrativos

**Ubicación:**
- Schema: `timeline.ts::TransitionSchema`
- Render: `ffmpeg.rs::build_transition_effects()` existente pero incomplete
- UI: `features/editor/TransitionsPanel.tsx` extender con nuevos tipos

**Tests needed:**
- circle wipe 0→180°, duration 2 s, ease-in-out
- iris zoom 0→50%, center adjustable per clip
- door hinge left/right, blind up/down, curtain side
- crossfade overlap 10%/25%/50%, verify source frames overlapped correctly

**Referencia CapCut:** `overlap_transition`, `subtrack_transition`
**Referencia DaVinci:** 3D transitions, 2D morph transitions

---

#### 4. **Motion tracking & stabilization completa**

**Estado actual:** estabilización local con `vidstab` (analiza + transforma), pero no tiene **tracking de puntos** para attached effects.

**Qué falta:**
- Motion tracker: detectar feature points y seguirlos frame a frame
- Attached effects: texto/effect/icono pegado a objeto tracked
- Planar tracker: seguir planes 2D (pantallas, paredes, superficies planas)
- Camera solver: reconstruir movimiento de cámara para match move

**Implementación:**
- Tracker: usar `dnn_detect` con modelo YOLO-lite o integrate `OpenCV contrib` Python side
- Attach: export track data `[{t,x,y,scale,rotation}]`, apply as mask/text position
- Planar: `planar_track` con homography matrix via `hflip|transpose|rotate` sequence
- Solver: `dehomography` para camera path, export as JSON for external use

**Tracking workflow:**
1. User selects point(s) on frame 0
2. Run `feature_track` algorithm (FAST + BRIEF or ORB) per frame
3. Store trajectory: `{ pointId: [{t,x,y,score}] }`
4. Apply to effect: text position = interpolated track point

**Stabilization enhancement:**
- Current: two-pass `vidstabdetect` → `vidstabtransform` with smoothing
- Add: crop adaptive vs fixed, roll correction, yaw/pitch separation
- Add: gyro stabilization if device has IMU metadata

**Impacto:** attached titles, VFX placement, shake removal professional

**Ubicación:**
- Schema: `timeline.ts::ClipSchema.tracking`
- Render: `ffmpeg.rs::apply_motion_tracking()` new function
- UI: `features/editor/MotionTracker.tsx` new panel, point editor
- Commands: `commands/tracking.rs` new file for analysis job

**Tests needed:**
- track 5 points across 60 frames, score >0.7 average
- attached text stays on moving car (verify position error <3 px)
- planar tracker on screen: overlay stays aligned after warping
- stabilization: measure RMS of translation vector before/after (target >80% reduction)

**Referencia CapCut:** `video tracking`, `object lock`, `matting_config`
**Referencia Resolve:** Fusion tracking tools, planar tracker, camera loader

---

#### 5. **Smart reframing con IA local (face/body detection)**

**Estado actual:** auto Shorts con face detection simple (SeetaFace frontal más grande), recorte centrado.

**Qué falta:**
- Smart crop: seguir rostro activo con expresiones faciales (FFmpeg facial landmarks)
- Subject tracking: múltiples sujetos, switch automático al que habla (audio energy + gaze direction)
- Pan-and-scan smart: no solo centro, sino ROI maximization (salient regions)
- Aspect ratio conversion with subject priority (16:9→9:16 con face tracking)

**Implementación:**
- Detect: SeetaFace ya instalado, extraer landmarks (eyes, nose, mouth)
- Expressions: eye aspect ratio (EAR) para blink detection, mouth aspect ratio para speech
- Selection: weight by face area × EAR stability × gaze direction (pupil center vs image center)
- Crop: `crop=w:h:x:y` where x/y follow face centroid with smooth path (`mov Suri` style)
- Priority: audio energy peaks trigger focus change (talking head heuristic)

**Schema:**
```typescript
smartReframe: {
  mode: 'face'|'subject'|'roi',
  confidence: 0.5–1.0,
  smoothness: 0–100 (fps lag for movement),
  prioritize: 'speaking'|'largest'|'center'
}
```

**UI:**
- Toggle smart reframing per clip
- Show active ROI box in preview with confidence indicator
- Manual override: drag crop box, lock rotation

**Render optimization:**
- Precompute ROIs during import (cache in `media/rois/{sha256}.json`)
- Streamlined crop: `crop=iw*s:h*s:x+y:y+h*s` where x/y from cache interpolated
- Avoid re-detect per frame: detect every N frames, interpolate linearly

**Impacto:** TikTok/Shorts automatizado con foco real, no solo centro, profesionales

**Ubicación:**
- Schema: `project.renderProfiles.smartReframe`
- Commands: `commands/smart-reframe.rs` new
- Render: `ffmpeg.rs::apply_smart_reframe()` integration
- UI: `features/editor/SmartReframePanel.tsx`

**Tests needed:**
- 2-person scene: follow speaker (audio peak + face size), verify switch timing within ±2 frames
- Face exits frame: predict continuation or switch to next subject smoothly
- Static face: verify crop doesn't drift (>0.1 px/frame drift is bug)
- Performance: 1080p@30fps, 1 minute, face detect every 10 frames <1 s CPU

**Referencia CapCut:** `lvop_intelligent_crop`, `smart crop`, `auto reframing`
**Referencia DaVinci:** Cut page auto-framing, Color page object tracking

---

### Tier T2: Efectos visuales avanzados (viabilidad media-alta)

#### 6. **Super resolution y frame interpolation**

**Estado actual:** escala bilineal/bicúbica estándar FFmpeg (`scale`).

**Qué falta:**
- Super resolution UPSCALING: 2×/4× con AI models (RealESRGAN, SwinIR)
- Frame interpolation: aumentar FPS nativamente (60→120, 30→60) con motion estimation
- Deinterlacing avanzado: `bwdif`, `yadif` already exist but could add AI variants

**Implementación:**
- SR model: integrate ` RealESRGAN-x4plus` (PyTorch, MIT license) via Python subprocess or ONNX runtime
- Frame interp: `interpolation.py` using `RIFE` or `AMTG` (open source)
- Pipeline: `video → python inference → upscale_frame × fps → concat`
- Cache: process each source once, store upscaled versions in `media/upscaled/{sha256}_4x.mp4`

**User control:**
- Scaling factor: 2×, 4× options
- Model selection: `realesrgan-x4`, `swinir`, `basicvsr`
- Quality tradeoff: speed vs quality preset

**Performance note:** SR is GPU-accelerated ideally, fallback to CPU for small clips (<10 s). Use multiprocessing for batch jobs.

**Impacto:** upscaling old footage, converting 30fps to 60fps for smooth motion

**Ubicación:**
- Commands: `commands/super-resolution.rs` new
- Python: `scripts/sr-inference.py` (RIFE/RealESRGAN wrapper)
- UI: `features/editor/SuperResolutionPanel.tsx`

**Tests needed:**
- 720p → 4K with RealESRGAN: verify PSNR vs ground truth (≥30 dB target)
- 30fps → 60fps with RIFE: measure motion smoothness (LSI metric)
- Batch processing: queue 10 clips, verify completion order matches submission

**Referencia CapCut:** `super resolution` (AI), `frame interpolation`
**Referencia DaVinci:** Temporal Upscaling, Detail Enhancer

---

#### 7. **De-noising avanzado y restoration**

**Estado actual:** `hqdn3d`, `nlmeans`, `afftdn` (audio only).

**Qué falta:**
- Video denoise AI: `BM3D`, `NL-means++`, `DnCNN` para ruido bajo iluminación
- De-teethrumbling / debanding: eliminar banding en gradientes
- De-interlace: mejorar `bwdif` con AI prediction
- Flicker removal: stabilize brightness fluctuations between frames

**Implementación:**
- Models: integrate `NVIDIA Video Super Resolution` (open weights) or `FastDVDNet` (PyTorch)
- Banding: `deflicker` + `colorcorrect` adaptive
- Deinterlace: use existing `bwdif` but add AI-enhanced field merging

**Pipeline:**
```
input → deband (adaptive threshold) → denoise (Gaussian + NL-means hybrid) → deflicker (median filter 3-frame)
```

**Impacto:** restaurar video antiguo, mejorar grabaciones low-light, eliminar compresión artifacts

**Ubicación:**
- Render: `ffmpeg.rs::apply_restoration_filters()` new
- Commands: `commands/restore-video.rs` analysis job
- UI: `features/editor/RestorationPanel.tsx`

**Tests needed:**
- low-light footage: compare SNR before/after (target >15 dB improvement)
- compression artifacts (blockiness): verify block edge suppression without blur
- flicker removal: variance of luminance over static scene reduced >50%

**Referencia CapCut:** `deflicker`, `noise reduction`
**Referencia DaVinci:** Noise Tools, Denoise (node-based)

---

#### 8. **Composite avanzado: nodos, matte painting, keying**

**Estado actual:** composición lineal por track order, chroma key básico.

**Qué falta:**
- Node-based compositor: grafo de nodos para composiciones complejas
- Alpha matting: `rotomatte`, `contourkeyer`, `ultrakey` (IA-driven background removal)
- 3D camera tracker: tracker para insertar objetos 3D en escena
- HDR tone mapping: convertir log/flat to SDR con ACES曲线

**Implementación:**
- Nodes: implement simplified node system (similar a Fusion lite), input/output slots, graph editing
- Matte: integrate `MODNet` (background removal, PyTorch, MIT) or `rembg` (fast, ONNX)
- 3D: basic perspective warp + camera projection for virtual sets
- HDR: `histogram` analysis + `tone_map` with ACES lookup table

**Node schema:**
```typescript
nodeGraph: {
  nodes: [{ id, type: 'source'|'blend'|'effect'|'output', inputs: [], params: {} }],
  edges: [{ fromNodeId, toNodeId, outIndex, inIndex }]
}
```

**Impacto:** composiciones VFX complejas, green screen profesional, integración CGI

**Ubicación:**
- Schema: `timeline.ts::CompositeNode` new
- Renderer: `render/node-compositor.rs` new file (separate from ffmpeg pipeline)
- UI: `features/editor/NodeEditor.tsx` complex component
- Effects: integrarse con FFmpeg para efectos simples, nodos para complejos

**Tests needed:**
- green screen: foreground/background分离, hair details preserved (>80% accuracy)
- node graph: blender node chain, verify output matches expected compositing
- HDR tone map: log encoding → SDR, verify perceptual brightness consistency

**Referencia CapCut:** `ai_matting`, `chamakey`, `spilling`
**Referencia DaVinci:** Fusion page (full compositor), Color page HDR tools

---

### Tier T3: Audio avanzado (viabilidad alta)

#### 9. **Voice isolation y separación de stems**

**Estado actual:** reducción de ruido genérica `afftdn`, presets vocales/music.

**Qué falta:**
- Voice isolation: separar voz humana de ruido ambiental específico
- Stem separation: dividir canción en vocal/instrumental/drum/bass (Spleeter, Demucs)
- Echo cancellation: remover reverberación de sala
- Dialogue enhancer: mejorar inteligibilidad de diálogo

**Implementación:**
- Isolation: `MDX-Net` (demucs) o `Demucs v4` (Facebook, MIT) → voice stem extraction
- Echo cancel: `aec` module of FFmpeg plus machine learning post-processing
- Dialog enhancer: spectral gating + noise subtraction + dynamic equalization

**Pipeline:**
```
audio → denoise (MDX) → isolate voice (voice mask) → enhance (de-reverb + eq boost 2-4kHz) → limiter
```

**Schema:**
```typescript
audioEnhancement: {
  isolation: boolean,
  stemSeparation: ['vocals'|'drums'|'bass'|'other'],
  echoCancel: boolean,
  dialogEnhance: { presence: 0–100, clarity: 0–100 }
}
```

**Impacto:** grabaciones caseras suenan profesionales, podcasts, entrevistas

**Ubicación:**
- Commands: `commands/audio-separation.rs` new
- Python: `scripts/stem-separation.py` (demucs wrapper)
- UI: `features/editor/AudioEnhancementPanel.tsx`

**Tests needed:**
- noisy room: voice isolation SNR improvement (target >20 dB)
- song separation: vocals isolated, instrumentals clean (SI-SDR ≥10 dB)
- echo cancel: measured RT60 reduction from >500ms to <200ms

**Referencia CapCut:** `rnnoise v2.0`, `voice isolation`
**Referencia Fairlight:** Dialogue Processing,Noise Suppression

---

#### 10. **Spatial audio y 3D panning**

**Estado actual:** panning stereo izquierdo/derecho lineal.

**Qué falta:**
- 3D audio positioning: azimuth/elevation/radius para sonido espacial
- Ambisonics decode: convertir Grabación 360° a estéreo
- HRTF filters: personalización de filtros de respuesta direccional
- Reverb spatial: convolución con IR (impulse response) de salas reales

**Implementación:**
- Panning: extend `pan` filter con spherical coordinates
- Ambisonics: extract Ambisonic channels, decode with first-order decoder
- HRTF: use `sofa` files (impulse responses from Head-Related Transfer Functions)
- Reverb: impulse convolution (`aconvolve`) with room IRs provided

**Schema:**
```typescript
spatialAudio: {
  azim: 0–360°, elev: -90–90°, distance: 0–10 m,
  hrtf: 'generic'|'custom', reverbRoom: 'small'|'medium'|'large'|'custom'
}
```

**Impacto:** VR/360° videos, música experimental, experiencias inmersivas

**Ubicación:**
- Render: `ffmpeg.rs::apply_spatial_audio()` new
- Assets: `assets/ir/` directory for impulse responses
- UI: `features/editor/SpatialAudioPanel.tsx`

**Tests needed:**
- 360° video: pan listener 360°, verify sound follows orientation
- HRTF: directional localization accuracy (user test ≥80% correct)
- Reverb: match measured RT60 to room specifications

**Referencia DaVinci Fairlight:** Spatial Mixer, Reverb, Panning

---

### Tier T4: Text/Títulos avanzados (viabilidad media)

#### 11. **Texto con forma, letras animadas, karaoke**

**Estado actual:** subtítulos ASS con animación por palabra, plantillas de título estáticas.

**Qué falta:**
- Text on path: texto siguiendo curva Bezier arbitraria
- Letter-by-letter reveal: animación de caracteres individuales con delay configurable
- Karaoke highlighting: sílabas sincronizadas con fonemas (ASR word-level timestamps)
- Text warp: distorsionar texto siguiendo perspectiva 3D

**Implementación:**
- Path text: `drawtext` con `path=` parameter and point sampling along Bezier
- Letter reveal: split ASS into character-level cues, animate opacity/x offset
- Karaoke: integrate Faster-Whisper phoneme alignment or use external phoneme recognizer
- Warp: `warped` filter with mesh based on text bounding box transformation

**Schema:**
```typescript
textContent: {
  onPath: { curve: Point[], align: 'start'|'center'|'end', offset: number },
  letterAnimation: { reveal: 'left'|'right'|'random', delay: ms, spring: number },
  karaoke: { highlightColor: '#rrggbb', syllableDuration: ms[] }
}
```

**Impacto:** títulos creativos, lyric videos, motion graphics sofisticados

**Ubicación:**
- Schema: `timeline.ts::SubtitleTextSchema` extended
- Render: `render/subtitles.rs::apply_text_on_path()` new
- UI: `features/editor/TextAnimationPanel.tsx`

**Tests needed:**
- text on circle: 10 characters evenly distributed, verify spacing uniformity
- letter reveal: random order, timing jitter <10 ms
- karaoke: syllable highlights synchronized to audio peaks (offset <50 ms)

**Referencia CapCut:** `text curve`, `text shape`, `lyrics templates`
**Referencia After Effects:** Text animations, Trim Paths

---

### Tier T5: Workflow/Productividad (impacto alto)

#### 12. **Proxies optimizados y transcoding masivo**

**Estado actual:** proxy 854 px generado y usado en preview.

**Qué falta:**
- Optimized media: codificar proxies en códec eficiente (ProRes, DNxHR) para edición fluida
- Multi-format export: export original + proxy + delivery en una operación
- Relink media: cambiar origen de clip si se mueve archivo o cambia resolución
- Sync proxies: mantener proxy sincronizado con fuente (hash-based monitoring)

**Implementación:**
- Proxies: transcode to ProRes LT (macOS) / DNxHR LB (Windows/Linux) during import
- Monitoring: periodic hash check of source files, regenerate proxy if changed
- Relink: search workspace for file by name/hash when path broken

**Workflow:**
1. Import: copy original to project folder, generate optimized proxy in `media/proxies/{name}_opt.mov`
2. Edit: always work with proxy (faster playback, lower CPU)
3. Export: use original automatically if available, else proxy with warning

**Impacto:** edición fluida con 4K/H.265 material pesado, workflow profesional

**Ubicación:**
- Commands: `commands/optimize-media.rs` new
- Media: `media/services/OptimizedMediaService.ts`
- UI: `features/assets/OptimizedMediaPanel.tsx`

**Tests needed:**
- 4K H.265 source: proxy generation time vs playback smoothness (FPS increase target 3×)
- relink: move source file, verify app finds and relinks within 10 s
- multi-export: original + proxy + delivery MP4 in same batch, verify all present

**Referencia DaVinci:** Optimized Media, Proxy Workflow
**Referencia Premiere:** Proxies, Merge Proxies

---

#### 13. **Multicam y timelines anidados (nesting)**

**Estado actual:** multipista plana, compound clips pero sin multicam switching.

**Qué falta:**
- Multicam source set: agrupar 2+ ángulos de misma escena con sync automático
- Multicam edit:切换 cámaras en tiempo real durante reproducción (tecla 1/2/3...)
- Nested timelines:Timeline dentro de Timeline (like Premiere bins but executable)
- Compound clip rendering: pre-render compound as single clip for performance

**Implementación:**
- Multicam source: group clips by timestamp range, auto-sync via audio correlation or timecode
- Switching: `concat` with segment selection based on current time and active angle
- Nesting: recursively evaluate nested timeline, flatten before final render
- Compound: render compound to temporary MP4, reference that in parent timeline

**Data structure:**
```typescript
multicamSource: {
  clips: [{ trackId, angle: number, startTime: number }],
  syncMethod: 'audio'|'timecode'|'manual',
  syncPoint: number // frame number
}

nestedTimeline: {
  id: string,
  children: TimelineSchema,
  startTimeOffset: number,
  duration: number
}
```

**Impacto:** entrevistas con múltiples cámaras, eventos deportivos, producciones multicamera

**Ubicación:**
- Schema: `timeline.ts::MulticamSource`, `nestedTimeline`
- Commands: `commands/multicam.rs` new
- Render: `render/multicam-switcher.rs` new
- UI: `features/editor/MulticamEditor.tsx`

**Tests needed:**
- 3-camera interview: switch angles smoothly, no frame drops or jumps
- nested timeline: 5 levels deep, verify final render includes all transformations
- sync audio: correlation-based sync <1 frame error

**Referencia DaVinci:** Multicam page, Fusion nesting
**Referencia Premiere:** Multicam source, Sequence nesting

---

### Tier T6: Colaboración/Publicación (impacto medio)

#### 14. **Colaboración en tiempo real y versionado cloud**

**Estado actual:** proyecto local .editoria.json sin colaboración.

**Qué falta:**
- Multi-user editing: dos personas editando mismo proyecto simultáneamente
- Conflict resolution: merge automático de cambios en clips diferentes, conflicto manual en mismos
- Version history: branch/merge style para versiones de proyecto
- Comments/annotations: markup en frames específicos para feedback

**Implementación:**
- Backend: WebSocket server para estado compartido (opcional, puede ser nube externa)
- OT (Operational Transformation) o CRDT para consenso sin servidor
- Versioning: Git-style commits para proyecto, branching para experimentos

**Schema:**
```typescript
collaborativeSession: {
  participants: [{ userId, displayName, cursorPosition, selectedClip? }],
  operations: [{ timestamp, type, target, payload }],
  version: number,
  branches: [{ name, parentId, commitHash }]
}
```

**Impacto:** trabajo remoto同步, agencias con clientes, edición distribuida

**Ubicación:**
- Network: `network/collaboration.ts` new
- Storage: `storage/git-backend.rs` (local Git repo for projects)
- UI: `features/collaboration/CollaborationPanel.tsx`

**Tests needed:**
- 2 users editing different clips: verify merge succeeds without conflicts
- same clip edit conflict: force manual merge UI, resolve successfully
- offline mode: edits queue locally, sync when reconnected

**Referencia Google Docs:** realtime collaboration patterns
**Referencia Frame.io:** review/approve workflow

---

#### 15. **Publicación directa a plataformas y scheduling**

**Estado actual:** manifiesto JSON local, descarga manual a redes.

**Qué falta:**
- Direct upload: YouTube, TikTok, Instagram vía API oficial
- Scheduling: programar publicación para fecha/hora específica
- Thumbnail automation: A/B testing de miniaturas con rendimiento tracking
- Analytics: métricas de audiencia importadas de plataformas

**Implementación:**
- YouTube Data API v3: upload video, set metadata, schedule
- TikTok Upload API: business account access required (may need OAuth flow)
- Instagram Graph API: Facebook Business integration
- Scheduler: cron job or cloud function to trigger upload at scheduled time

**OAuth flow:**
1. User authorizes platform connection in Settings
2. Store access token encrypted in Windows Credential Manager
3. Token refresh automatic when expired
4. Per-platform quota tracking (daily upload limits)

**Impacto:** ahorrar tiempo de upload manual, consistencia de branding, métricas unificadas

**Ubicación:**
- Platform service: `platforms/YouTubeService.ts`, `platforms/TikTokService.ts`, etc.
- Upload: `commands/upload-to-platform.rs` new
- UI: `features/publication/DirectPublishPanel.tsx`

**Tests needed:**
- YouTube upload: 1080p video uploaded successfully, metadata applied correctly
- scheduling: upload executes at scheduled time ±1 min
- thumbnail A/B: track CTR difference between variants

**Referencia:** YouTube Studio, TikTok Creator Portal, Meta Business Suite

---

### Tier T7: IA avanzada (futuro)

#### 16. **Generación de contenido con IA generativa**

**Estado actual:** Flow Queue externo, guion IA con LLM, TTS local.

**Qué falta:**
- Image generation inside editor: Stable Diffusion XL integrado para assets
- In-painting/out-painting: expandir/editar imágenes con inpainting
- Video synthesis: generar video corto desde prompt (Sora, Runway ML - modelos cerrados)
- Style transfer: aplicar estilo visual de imagen referencia a todo el video

**Implementación:**
- SDXL: run locally via `diffusers` library (PyTorch, requires GPU)
- Inpainting: SDXL inpaint model, user paints region with brush
- Style transfer: CLIP embedding match for style guidance, VAE encode-decode
- Video gen: not realistic yet (closed models), wait for open alternatives

**Schema:**
```typescript
generativeTool: {
  type: 'image-gen'|'inpaint'|'style-transfer',
  prompt: string,
  negativePrompt?: string,
  steps: 20–50,
  cfgScale: 5–15,
  seed?: number,
  outputFormat: 'png'|'jpg'
}
```

**Impacto:** generar assets únicos sin stock libraries, prototipado rápido, creatividad expandida

**Ubicación:**
- Integration: `integrations/StableDiffusion.ts` new (Python backend)
- UI: `features/editor/GenerativeToolsPanel.tsx`
- Jobs: `jobs/image-generation-job.rs` queue management

**Tests needed:**
- prompt "sunset over mountains": verify semantic coherence with expected concepts
- inpaint "add tree here": seamless integration, no visible boundaries
- style transfer: style similarity score (CLIP similarity >0.7 with reference)

**Referencia Runway Gen-2, Pika Labs:** video from text
**Referencia Adobe Firefly:** generative fill for images

---

## Resumen de prioridades (roadmap sugerido)

### Fase 1 (próximas 4 semanas)
1. **Curvas de velocidad continuas con optical flow** — impacto inmediato en calidad de motion
2. **Máscaras Bézier con tracking básico** — habilita VFX elementales
3. **Transiciones wipe/iris avanzadas** — diversifica toolkit creativo
4. **Voice isolation con Demucs** — mejora audio casero significativamente
5. **Proxies optimizados ProRes/DNxHR** — mejora fluidez de edición con material pesado

### Fase 2 (mes 2-3)
6. **Smart reframing con face tracking mejorado** — automatización Shorts/TikTok
7. **Estabilización con gyro data + optical flow** — profesional shake removal
8. **Track matte y compositing avanzado** — habilita Green Screen pro
9. **Super resolution local (RealESRGAN)** — upscaling de material legacy
10. **Text on path con animación avanzada** — títulos creativos

### Fase 3 (mes 4-6)
11. **Multicam editing completo** — producción multicámara
12. **Stem separation (Demucs v4)** — remix, aislamiento, cleanup
13. **Temporal upscaling (frame interpolation)** — 30→60→120 fps
14. **De-noising AI avanzado** — restauración de video viejo
15. **Nested timelines + compound rendering** — organización profesional

### Fase 4 (futuro, investigación)
16. **Node-based compositor** — fusion Lite interno
17. **Motion tracking planar + 3D solve** — matchmove para VFX
18. **Spatial audio 3D** — VR/ambisonics support
19. **Direct platform publishing** — ahorro operativo
20. **IA generativa integrada** — generación de assets única

---

## Consideraciones técnicas generales

### Licencias y legalidad

✅ **Permitido (open source, MIT/GPL/Apache):**
- FFmpeg filters (any public domain or LGPL filter)
- AI models: RealESRGAN (MIT), Demucs (MIT), RIFE (Apache), MDX-Net (MIT), MODNet (Apache)
- Algorithms: optical flow (TV-L1, GMG), feature tracking (ORB, FAST+BRIEF)
- Audio: equalization curves, compressor algorithms (public domain designs)

❌ **No permitir (copyrighted, proprietary):**
- Copiar código binario de CapCut/Filmora/Resolve
- Extraer assets protegidos (LUTs propiedad, sonidos registrados)
- Usar marcas comerciales de competidores en UI
- Patentes activas (algún algoritmo específico de motion estimation patentado)

✅ **Zona gris (evaluar caso por caso):**
- Inspirarse en UX sin copiar layout exacto
- Implementar funcionalidades similares con código propio
- Usar APIs públicas de plataformas (YouTube/TikTok) según sus ToS

### Performance considerations

**GPU acceleration:**
- Priorizar filtros que usan CUDA/OpenCL en FFmpeg (`cuda`, `cuviddec`, `nvenc`)
- Para AI models: ONNX Runtime con CUDA execution provider
- Fallback CPU para máquinas sin GPU dedicada

**Batch processing:**
- Jobs colgados en cola para procesamiento asíncrono (super res, stem separation)
- Caché de resultados intermedios en `media/cache/{operation}/{sha256}`
- Progress report con events (`processing-progress`, `processing-complete`)

**Streaming:**
- Preview de efectos pesados: reducir resolución (540p) para preview, render final en full
- Incremental render: partes del proyecto ya renderizadas reusable
- Memory-mapped IO para grandes archivos (>4K videos)

### Integración con stack existente

**FFmpeg 9.0.1:** casi todos los filtros mencionados están disponibles en FFmpeg official build excepto IA models (necesitan Python backend).

**Rust render engine:** mantener pipeline principal en Rust, delegar AI/complejo a Python subprocess cuando sea necesario.

**TypeScript frontend:** componentes reutilizables para controles de efectos (sliders, graphs, previews).

---

## Validación y QA

Cada nueva herramienta debe tener:
1. **Unit tests** en Rust para lógica de transformación/schema validation
2. **Integration tests** para end-to-end render con FFmpeg
3. **Live render test** con archivo real, verificación FFprobe de salida
4. **Performance benchmark** medido contra baseline actual
5. **UI accessibility** verification (keyboard navigation, focus states, color contrast)
6. **Backward compatibility** test (proyectos antiguos siguen funcionando)

**Cobertura de tests objetivo:**
- Lógica central: ≥90% coverage
- Filtros FFmpeg: 100% de paths posibles cubiertos
- Edge cases: vacio, máximo valores, valores negativos, formatos inválidos
- Regression: suite completa corriendo en CI antes de merge

---

## Referencias cruzadas

- Matriz de paridad CapCut: `docs/reference/CAPCUT-9.4-FEATURE-INVENTORY-2026-10-20.md`
- Paridad DaVinci: `docs/reference/DAVINCI-PARITY-2026-10-22.md`
- Paridad general: `docs/reference/EDITOR-PARITY-MATRIX-2026-10-19.md`
- Loop closure gaps: `docs/reference/editor-ia-loop-closure-gaps.md`

---

**Fecha de esta auditoría:** 2026-10-25  
**Próxima revisión:** 2026-11-25 (actualizar progreso)  
**Autor:** Auditoría técnica interna basada en análisis REA de capacidad del proyecto  

---

## Checklist de implementación (para cada feature)

Para agregar cada herramienta avanzada:

- [ ] Schema TypeScript definido y tested
- [ ] Preview UI implementada (controls, sliders, graph editors)
- [ ] Render pipeline en FFmpeg implementado
- [ ] Tests unitarios escritos (≥90% coverage)
- [ ] Live render test exitoso con FFprobe verification
- [ ] Documentation actualizada (UI tooltips, docs/)
- [ ] Backwards compatibility verified (old projects still load)
- [ ] Performance benchmark documented
- [ ] Accessibility checked (keyboard, screen reader, color contrast)
- [ ] Error handling robusto (invalid inputs, missing dependencies)
- [ ] Progressive enhancement (graceful degradation si falta GPU/Python)

---

**Fin del documento.**
