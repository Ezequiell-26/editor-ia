import {memo, Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Asset, BlendMode, CaptionCue, Clip, ClipEffects, ClipMask, MaskPoint, ProjectDocument, Track } from '@editor-ia/project-schema';
import { sampleMaskKeyframes } from '@editor-ia/project-schema';
import { captionMotionAt } from '../../state/caption-motion';
import { PreviewTransformBox, isTransformable } from './PreviewTransformBox';
import { PerspectiveHandles } from './PerspectiveHandles';
import { MonitorFrameSvg } from './MonitorFrameSvg';
import { cueWordsAt } from '../../state/subtitles';
import { addAsset, addMotionGraphic, fpsOf, clipGainAtFrame, clipTransformAtFrame, updateClip, updateProjectSettings } from '../../state/project-actions';
import {
  setMaskDrawArmed,
  simplifyMaskPoints,
  smoothMaskStroke,
  useMaskDrawArmed,
} from '../../state/mask-draw';
import { getDoodleStyle, setDoodleArmed, setDoodleStyle, useDoodleArmed } from '../../state/doodle';
import {
  clearPreviewMedia,
  reportPreviewMedia,
  trackPreviewFonts,
  usePreviewMediaPending,
} from '../../state/preview-readiness';
import { FORMAT_PRESETS } from '../../state/video-format';
import {
  attachPreviewAudio,
  detachPreviewAudio,
  isTrackAudible,
  resumePreviewAudio,
  setPreviewClipFx,
  setPreviewClipPan,
  syncPreviewAudioAtFrame,
  syncPreviewAudioFromProject,
  syncPreviewAudioPanAtFrame,
  trackGainDb,
} from '../mixer/usePreviewAudio';
import { useProjectPlayback, useProjectStore } from '../../state/project-store';
import { loadEditorPreferences, updateEditorPreferences } from '../../state/editor-preferences';
import {
  SAFE_AREA_PRESETS,
  safeAreaAspectMismatch,
  safeAreaPresetById,
  safeAreaPointsAttr,
  type SafeAreaPresetId,
} from '../../state/safe-area-presets';
import { Icon } from '../../components/Icon';
import { buildMotionPlan } from '../../state/motion-plan';
import { MotionPreview } from '../motion/MotionPreview';
import { templateById } from '../../state/motion-templates';
import { ScopesPanel } from '../color/ScopesPanel';
import { PreviewAudioScopes } from './PreviewAudioScopes';
import { PreviewSpectrum } from './PreviewSpectrum';
import { PreviewSpectrumRegion } from './PreviewSpectrumRegion';
import { MediaSpyOverlay } from './MediaSpyOverlay';
import { clipAudioFxSpec, clipVoiceFxSpec } from '../mixer/clip-audio-fx';
import type { EffectStack } from '@editor-ia/effect-kit';
import { EffectCanvas, WEBGL_AVAILABLE } from '../vfx/EffectCanvas';
import { perspectiveMatrix3d, type PerspectiveViewport } from './perspective';
import type { PreviewFrameResult } from '../../services/project-service';
import { applyGradeProjection, clipChromaKeyFilterId, clipChromaKeySpec, clipCurvesFilterId, clipCurvesSpec, clipGlowFilterId, clipGlowSpec, clipRelightFilterId, clipRelightSpec, clipSharpenFilterId, clipSharpenSpec, clipVignetteFilterId, clipVignetteSpec, compileGrade, gradeFilterId, type GradeFilterSpec } from '../color/color-engine';
import { GradeFilterDefs } from '../color/GradeFilterDefs';
import { activeAt, buildPreviewClipIndex, type PreviewClipEntry } from './preview-index';
import {
  clipInTransitionLead,
  clipTransitionLeadActive,
  previewTransitionFrame,
  previewTransitionLeadFrames,
} from './preview-transition';
import { isLumaWipeClip, lumaMaskStyle, useLumaWipeMasks } from './preview-luma-mask';
import { clipPreviewLuts, usePreviewLuts } from './preview-luts';

/** Stack vacío estable: `EffectCanvas` compara por contenido y un `[]` nuevo
 * en cada render reiniciaría el scheduler de frames. */
const EMPTY_EFFECT_STACK: EffectStack = [];
import {
  clipIsReversed,
  clipPreviewRateAtLocal,
  clipSourceFrameAtLocal,
  clipStabilizationPreviewProxy,
  type SpeedCurveMode,
} from '../../state/clip-source-time';
import { useReversedClipAudio } from './useReversedClipAudio';
import { prewarmFramesAround } from './frame-prewarm';
import {
  auditionedEffects,
  useLookAudition,
  type LookAudition,
} from '../../state/look-audition';
import {
  recordPlaybackFrame,
  recordPreviewWait,
  resetPreviewTelemetry,
  setPreviewAutoQuality,
  setPreviewFrameBudget,
  usePreviewTelemetry,
} from './preview-telemetry';
import {
  claimProxyStatusFetch,
  getProxyStatus,
  publishProxyStatus,
  useProxyStatusVersion,
} from './proxy-status-store';
import { proxyPlaybackPath } from './proxy-ui';

function previewViewport(
  asset: Asset | undefined,
  width: number,
  height: number,
): PerspectiveViewport {
  const media =
    asset && (asset.kind === 'video' || asset.kind === 'image') ? asset.media : undefined;
  return {
    width,
    height,
    ...(media ? { mediaWidth: media.width, mediaHeight: media.height } : {}),
  };
}

function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function volumeFromDb(gainDb: number | undefined): number {
  const db = gainDb ?? 0;
  return Math.min(1, Math.max(0, 10 ** (db / 20)));
}

// Modo del monitor y zoom persistidos por equipo (CapCut/Filmora: el usuario
// elige “Ajustar” (imagen completa) o “Llenar” (sin franjas, recorta bordes) y
// el visor recuerda su encuadre). Storage protegido: ante error, defaults.
const PREVIEW_FIT_KEY = 'editoria.preview-fit.v1';
const PREVIEW_ZOOM_KEY = 'editoria.preview-zoom.v1';
// Migración única: la implementación anterior de «Llenar» anclaba el lienzo a
// la izquierda del panel y recortaba hasta ~42 % del fotograma. Ver medición
// 2026-11-07: lienzo 661 px dentro de un stage de 380 px, desborde 281 px a la
// derecha. Se corrige el encuadre guardado una sola vez; el usuario puede
// volver a elegir «Llenar» de forma explícita y entonces el recorte queda
// centrado en lugar de anclado.
const PREVIEW_FIT_FIX_KEY = 'editoria.preview-fit.crop-fixed.v1';

export function readPreviewFill(): boolean {
  try {
    const stored = window.localStorage.getItem(PREVIEW_FIT_KEY);
    if (stored === 'fill' && !window.localStorage.getItem(PREVIEW_FIT_FIX_KEY)) {
      window.localStorage.setItem(PREVIEW_FIT_KEY, 'fit');
      window.localStorage.setItem(PREVIEW_FIT_FIX_KEY, '1');
      return false;
    }
    // Por defecto «Ajustar»: el cuadro de la secuencia se ve completo y
    // centrado en el panel, como el player de Filmora (un proyecto 9:16 en un
    // panel ancho queda con franjas a los lados, no recortado). «Llenar»
    // (cover) sigue disponible y se respeta la elección explícita guardada.
    return stored === 'fill';
  } catch {
    return false;
  }
}

function readPreviewZoom(): number {
  try {
    const value = Number(window.localStorage.getItem(PREVIEW_ZOOM_KEY));
    return Number.isFinite(value) && value >= 0.5 && value <= 3
      ? Math.round(value * 10) / 10
      : 1;
  } catch {
    return 1;
  }
}

function maskPolygon(
  mask: ClipMask,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  aspect = 1,
): Array<readonly [number, number]> {
  if (mask.shape === 'polygon' || mask.shape === 'freehand') {
    const points = mask.points ?? [];
    // Paridad con `masks.rs`: width/height escalan el polígono alrededor
    // del centro de su bounding box (1 = identidad) antes de aplicar el
    // offset x/y — así una máscara de tracking facial crece con el sujeto.
    // Con escala 1 se conserva la forma corta `p*100 + offset*100` (evita
    // errores de punto flotante en el string del clip-path).
    const scaleX = mask.width ?? 1;
    const scaleY = mask.height ?? 1;
    if (scaleX === 1 && scaleY === 1 && !mask.rotationDeg) {
      return points.map((point) => [
        point.x * 100 + mask.x * 100,
        point.y * 100 + mask.y * 100,
      ]);
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const pivotX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const pivotY = (Math.min(...ys) + Math.max(...ys)) / 2;
    // Rotación horaria (convención CSS/SVG/NLE) sobre el punto ya escalado,
    // con corrección de aspecto igual que `masks.rs`: dy (fracción del alto)
    // se pasa a unidades x dividiendo por `aspect` (ancho/alto) y se vuelve
    // a multiplicar al proyectar de nuevo a y.
    const radians = ((mask.rotationDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const safeAspect = aspect > 0.01 ? aspect : 1;
    return points.map((point) => {
      const dx = (point.x - pivotX) * scaleX;
      const dy = (point.y - pivotY) * scaleY;
      const dyx = dy / safeAspect;
      return [
        (pivotX + cos * dx - sin * dyx + mask.x) * 100,
        (pivotY + (sin * dx + cos * dyx) * safeAspect + mask.y) * 100,
      ];
    });
  }
  if (mask.shape === 'diamond') {
    return [
      [centerX, centerY - radiusY],
      [centerX + radiusX, centerY],
      [centerX, centerY + radiusY],
      [centerX - radiusX, centerY],
    ];
  }
  if (mask.shape === 'triangle') {
    return [
      [centerX, centerY - radiusY],
      [centerX + radiusX, centerY + radiusY],
      [centerX - radiusX, centerY + radiusY],
    ];
  }
  if (mask.shape === 'star') {
    // Estrella de 5 puntas: vértices alternados punta/valle cada 36°,
    // punta al tope — misma silueta que el polar `geq` de masks.rs.
    const points: Array<readonly [number, number]> = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = (-90 + index * 36) * (Math.PI / 180);
      const radius = index % 2 === 0 ? 1 : 0.45;
      points.push([
        centerX + Math.cos(angle) * radiusX * radius,
        centerY + Math.sin(angle) * radiusY * radius,
      ]);
    }
    return points;
  }
  if (mask.shape === 'heart') {
    // Corazón muestreado de la curva implícita del render
    // ((u²+v²−1)³−u²v³≤0, /1.15): 16 puntos sobre el borde, cúspide abajo.
    const HEART: ReadonlyArray<readonly [number, number]> = [
      [0, -0.72], [0.28, -0.78], [0.55, -0.62], [0.72, -0.38],
      [0.82, -0.1], [0.8, 0.18], [0.62, 0.42], [0.4, 0.62],
      [0.18, 0.78], [0, 0.86], [-0.18, 0.78], [-0.4, 0.62],
      [-0.62, 0.42], [-0.8, 0.18], [-0.82, -0.1], [-0.72, -0.38],
      [-0.55, -0.62], [-0.28, -0.78],
    ];
    return HEART.map(([u, v]) => [
      centerX + u * radiusX,
      centerY + v * radiusY,
    ]);
  }
  return [];
}

export function maskClipPath(mask: ClipMask, aspect = 1): string {
  const clamp = (value: number): number => Math.max(0, Math.min(100, value));
  if (mask.shape === 'text') {
    // CSS no puede recortar por glifos sin duplicar la fuente; la máscara real
    // se ve en Frame real/render, no en la preview aproximada.
    return 'none';
  }
  // `expand` del render multiplica las coordenadas por (1−expand): la forma
  // se ve 1/(1−expand) más grande. Mismo factor acá para que preview y MP4
  // coincidan. `polygon`/`freehand` no lo aplican en el render (puntos
  // absolutos), así que acá tampoco; `text` ya salió por el early return.
  const expandScale =
    mask.shape === 'polygon' || mask.shape === 'freehand'
      ? 1
      : 1 / (1 - (mask.expand ?? 0));
  const centerX = clamp(50 + mask.x * 50);
  const centerY = clamp(50 + mask.y * 50);
  const radiusX = mask.width * 50 * expandScale;
  const radiusY = mask.height * 50 * expandScale;
  if (mask.shape === 'ellipse') {
    return `ellipse(${clamp(radiusX)}% ${clamp(
      radiusY,
    )}% at ${centerX}% ${centerY}%)`;
  }
  if (mask.shape === 'rectangle' || mask.shape === 'rounded') {
    const left = clamp(centerX - radiusX);
    const top = clamp(centerY - radiusY);
    const right = clamp(100 - (centerX + radiusX));
    const bottom = clamp(100 - (centerY + radiusY));
    const round =
      mask.shape === 'rounded'
        ? ` round ${clamp(mask.width * 12.5 * expandScale)}% / ${clamp(mask.height * 12.5 * expandScale)}%`
        : '';
    return `inset(${top}% ${right}% ${bottom}% ${left}%${round})`;
  }
  const points = maskPolygon(
    mask,
    centerX,
    centerY,
    radiusX,
    radiusY,
    aspect,
  )
    .map(([x, y]) => `${clamp(x)}% ${clamp(y)}%`)
    .join(', ');
  return `polygon(${points})`;
}

/**
 * Rotated masks and inverted masks are drawn as an inline SVG mask so the
 * preview matches the per-pixel `geq` mask of the renderer. Unrotated,
 * non-inverted masks keep the cheaper clip-path.
 */
function maskImage(mask: ClipMask, aspect = 1): string | undefined {
  const pointMask = mask.shape === 'polygon' || mask.shape === 'freehand';
  const rotation = pointMask ? 0 : (mask.rotationDeg ?? 0);
  // Sin feather, rotación ni inversión alcanza el clip-path barato. Con
  // feather hay que usar la máscara SVG; si no, la preview se ve dura y el MP4
  // suave.
  if (
    Math.abs(rotation) < 0.001 &&
    !mask.invert &&
    (mask.feather ?? 0) <= 0.001
  ) {
    return undefined;
  }
  const centerX = 50 + mask.x * 50;
  const centerY = 50 + mask.y * 50;
  const expandScale =
    pointMask || mask.shape === 'text'
      ? 1
      : 1 / (1 - (mask.expand ?? 0));
  const radiusX = mask.width * 50 * expandScale;
  const radiusY = mask.height * 50 * expandScale;
  const feather = Math.max(0.001, mask.feather) * 14;
  const fill = mask.invert ? 'black' : 'white';
  const transform = `rotate(${rotation} ${centerX} ${centerY})`;
  const shape =
    mask.shape === 'ellipse'
      ? `<ellipse cx="${centerX}" cy="${centerY}" rx="${radiusX}" ry="${radiusY}" fill="${fill}" transform="${transform}" filter="url(#soft)"/>`
      : mask.shape === 'rectangle'
        ? `<rect x="${centerX - radiusX}" y="${centerY - radiusY}" width="${radiusX * 2}" height="${radiusY * 2}" fill="${fill}" transform="${transform}" filter="url(#soft)"/>`
        : mask.shape === 'rounded'
          ? `<rect x="${centerX - radiusX}" y="${centerY - radiusY}" width="${radiusX * 2}" height="${radiusY * 2}" rx="${radiusX * 0.25}" ry="${radiusY * 0.25}" fill="${fill}" transform="${transform}" filter="url(#soft)"/>`
          : `<polygon points="${maskPolygon(
            mask,
            centerX,
            centerY,
            radiusX,
            radiusY,
            aspect,
          )
            .map(([x, y]) => `${x},${y}`)
            .join(' ')}" fill="${fill}" transform="${transform}" filter="url(#soft)"/>`;
  const backdrop = mask.invert ? '<rect width="100" height="100" fill="white"/>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${feather.toFixed(2)}"/></filter></defs>${backdrop}${shape}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Trazo de color alrededor del borde de la máscara (paridad «mask stroke»
 * de `molduras.js`): SVG con la misma silueta de `maskImage` pero sólo el
 * contorno. El semiancho de la banda es `strokeWidth` × radio medio (el
 * render dilata/erosiona las dimensiones ±sw → semiancho sw·radio).
 * `polygon`/`freehand`/`text` no lo soportan (igual que en Rust).
 */
export function maskStrokeSvg(mask: ClipMask): string | undefined {
  if (!mask.strokeColor || !(mask.strokeWidth && mask.strokeWidth > 0)) {
    return undefined;
  }
  if (
    mask.shape === 'polygon' ||
    mask.shape === 'freehand' ||
    mask.shape === 'text'
  ) {
    return undefined;
  }
  const expandScale = 1 / (1 - (mask.expand ?? 0));
  const centerX = 50 + mask.x * 50;
  const centerY = 50 + mask.y * 50;
  const radiusX = mask.width * 50 * expandScale;
  const radiusY = mask.height * 50 * expandScale;
  const sw = Math.min(0.5, mask.strokeWidth);
  const strokeWidth = Math.max(0.4, sw * (radiusX + radiusY));
  const rotation = mask.rotationDeg ?? 0;
  const transform = `rotate(${rotation} ${centerX} ${centerY})`;
  const strokeAttrs = `fill="none" stroke="${mask.strokeColor}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"`;
  const shape =
    mask.shape === 'ellipse'
      ? `<ellipse cx="${centerX}" cy="${centerY}" rx="${radiusX}" ry="${radiusY}" ${strokeAttrs} transform="${transform}"/>`
      : mask.shape === 'rectangle'
        ? `<rect x="${centerX - radiusX}" y="${centerY - radiusY}" width="${radiusX * 2}" height="${radiusY * 2}" ${strokeAttrs} transform="${transform}"/>`
        : mask.shape === 'rounded'
          ? `<rect x="${centerX - radiusX}" y="${centerY - radiusY}" width="${radiusX * 2}" height="${radiusY * 2}" rx="${radiusX * 0.25}" ry="${radiusY * 0.25}" ${strokeAttrs} transform="${transform}"/>`
          : `<polygon points="${maskPolygon(mask, centerX, centerY, radiusX, radiusY)
              .map(([x, y]) => `${x},${y}`)
              .join(' ')}" ${strokeAttrs} transform="${transform}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${shape}</svg>`;
}

type AnimationState = { x: number; y: number; scale: number; rotation: number; opacity: number };

function animationState(clip: Clip, playheadFrame?: number): AnimationState {
  const state: AnimationState = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
  if (playheadFrame === undefined || !('animationIn' in clip)) return state;
  const target = clip as Clip & {
    animationIn?: { type: string; durationFrames: number };
    animationOut?: { type: string; durationFrames: number };
  };
  const relative = Math.max(0, Math.min(clip.durationFrames, playheadFrame - clip.startFrame));
  const apply = (type: string | undefined, progress: number, exit: boolean): void => {
    if (!type) return;
    const remaining = exit ? progress : 1 - progress;
    switch (type) {
      case 'fade':
        state.opacity *= 1 - progress;
        break;
      case 'slide-left':
        state.x += (exit ? -100 : 100) * remaining;
        break;
      case 'slide-right':
        state.x += (exit ? 100 : -100) * remaining;
        break;
      case 'slide-up':
        state.y += (exit ? -100 : 100) * remaining;
        break;
      case 'slide-down':
        state.y += (exit ? 100 : -100) * remaining;
        break;
      case 'zoom-in':
        state.scale *= exit ? 1 + 0.18 * progress : 1 - 0.18 * remaining;
        break;
      case 'zoom-out':
        state.scale *= exit ? 1 - 0.18 * progress : 1 + 0.18 * remaining;
        break;
      case 'spin':
        state.rotation += exit ? 120 * progress : -120 * remaining;
        break;
      default:
        break;
    }
  };
  const inFrames = Math.max(1, Math.min(target.animationIn?.durationFrames ?? 15, clip.durationFrames));
  const outFrames = Math.max(1, Math.min(target.animationOut?.durationFrames ?? 15, clip.durationFrames));
  if (target.animationIn && relative < inFrames) {
    apply(target.animationIn.type, Math.max(0, relative / inFrames), false);
  }
  if (target.animationOut && relative > clip.durationFrames - outFrames) {
    apply(
      target.animationOut.type,
      Math.max(0, (relative - (clip.durationFrames - outFrames)) / outFrames),
      true,
    );
  }
  return state;
}

/**
 * Parámetros del Ken Burns (`clip.motion`) en el frame dado: escala
 * uniforme y desplazamiento en porcentaje del elemento. Los comparten
 * `transformStyle` (CSS) y el dibujo de máscara (inversa del transform).
 */
function motionParams(
  clip: Clip,
  playheadFrame: number | undefined,
): { scale: number; x: number; y: number } {
  const motion = 'motion' in clip ? clip.motion : undefined;
  if (!motion) return { scale: 1, x: 0, y: 0 };
  const progress =
    playheadFrame === undefined
      ? 0
      : Math.max(
          0,
          Math.min(1, (playheadFrame - clip.startFrame) / Math.max(1, clip.durationFrames)),
        );
  const intensity = motion.intensity ?? 0.12;
  let scale = 1;
  let x = 0;
  let y = 0;
  if (motion.type === 'zoom-in') scale = 1 + intensity * progress;
  if (motion.type === 'zoom-out') scale = 1 + intensity * (1 - progress);
  if (motion.type === 'pan-left') {
    scale = 1 + intensity;
    x = (0.5 - progress) * intensity * 50;
  }
  if (motion.type === 'pan-right') {
    scale = 1 + intensity;
    x = (progress - 0.5) * intensity * 50;
  }
  if (motion.type === 'pan-up') {
    scale = 1 + intensity;
    y = (0.5 - progress) * intensity * 50;
  }
  if (motion.type === 'pan-down') {
    scale = 1 + intensity;
    y = (progress - 0.5) * intensity * 50;
  }
  return { scale, x, y };
}

/**
 * Fundido de entrada/salida del clip (`effects.fadeInFrames`/`fadeOutFrames`).
 * El export lo emite como `fade=t=in/out:st=…:d=…:alpha=1` lineal sobre el
 * alfa del clip (`render/ffmpeg/visual/filter.rs`); acá se devuelve el mismo
 * factor para multiplicar la opacidad del monitor. `styleFrame` es el frame
 * de estilo (playhead + lead de transición), igual que en `transformStyle`.
 */
export function clipFadeOpacity(
  clip: Clip,
  styleFrame: number | undefined,
): number {
  if (styleFrame === undefined || !('effects' in clip)) return 1;
  const effects = clip.effects as ClipEffects | undefined;
  const fadeIn = Math.min(
    Math.max(0, effects?.fadeInFrames ?? 0),
    clip.durationFrames,
  );
  const fadeOut = Math.min(
    Math.max(0, effects?.fadeOutFrames ?? 0),
    clip.durationFrames,
  );
  if (fadeIn <= 0 && fadeOut <= 0) return 1;
  const local = styleFrame - clip.startFrame;
  let opacity = 1;
  if (fadeIn > 0 && local < fadeIn) {
    opacity *= Math.max(0, Math.min(1, local / fadeIn));
  }
  if (fadeOut > 0 && local > clip.durationFrames - fadeOut) {
    opacity *= Math.max(0, Math.min(1, (clip.durationFrames - local) / fadeOut));
  }
  return opacity;
}

/**
 * `effects.denoise` (0..1 → `hqdn3d` del export, que es temporal+espacial):
 * la preview no puede promediar frames, así que aproxima la componente
 * espacial con un blur leve — hqdn3d también suaviza el ruido, por eso el
 * parecido es razonable. Pico de 1.4px a denoise=1.
 */
export function clipDenoiseBlurPx(denoise: number | undefined): number {
  if (denoise === undefined || denoise <= 0.001) return 0;
  return Math.min(1, denoise) * 1.4;
}

function transformStyle(
  clip: Clip,
  project: ProjectDocument,
  playheadFrame?: number,
  viewport?: PerspectiveViewport,
): CSSProperties {
  const transform = clip.transform;
  // El render corre el clip `lead` frames antes de su startFrame durante una
  // transición: keyframes, máscaras y animaciones se muestrean en tiempo
  // local del stream (= frame del timeline + lead), igual que el `setpts`
  // del export. Sin transición lead = 0 y nada cambia.
  const leadFrames = previewTransitionLeadFrames(clip, fpsOf(project));
  const styleFrame = playheadFrame === undefined ? undefined : playheadFrame + leadFrames;
  const sampled =
    styleFrame === undefined
      ? null
      : clipTransformAtFrame(
          clip,
          Math.max(0, Math.min(clip.durationFrames - 1, styleFrame - clip.startFrame)),
        );
  const offsetX = (sampled?.offsetX ?? transform?.offsetX ?? 0) / project.video.width;
  const offsetY = (sampled?.offsetY ?? transform?.offsetY ?? 0) / project.video.height;
  const scaleX = sampled?.scaleX ?? transform?.scaleX ?? 1;
  const scaleY = sampled?.scaleY ?? transform?.scaleY ?? 1;
  const rotation = sampled?.rotationDeg ?? transform?.rotationDeg ?? 0;
  const blendMode =
    'blendMode' in clip
      ? (clip as Clip & { blendMode?: BlendMode }).blendMode
      : undefined;
  const motion = motionParams(clip, styleFrame);
  const motionScale = motion.scale;
  const motionX = motion.x;
  const motionY = motion.y;
  const animation = animationState(clip, styleFrame);
  const mask = 'mask' in clip ? (clip as Clip & { mask?: ClipMask }).mask : undefined;
  const sampledMask =
    mask?.keyframes && styleFrame !== undefined
      ? sampleMaskKeyframes(
          mask.keyframes,
          Math.max(0, Math.min(clip.durationFrames - 1, styleFrame - clip.startFrame)),
        )
      : {};
  const effectiveMask = mask ? { ...mask, ...sampledMask } : undefined;
  const maskAspect = project.video.width / Math.max(1, project.video.height);
  const image = effectiveMask ? maskImage(effectiveMask, maskAspect) : undefined;
  const perspective =
    transform?.perspective && viewport
      ? perspectiveMatrix3d(transform.perspective.corners, viewport)
      : undefined;
  return {
    transform: `translate(${offsetX * 100}%, ${offsetY * 100}%) translate(${motionX + animation.x}%, ${motionY + animation.y}%) scale(${scaleX * motionScale * animation.scale}, ${scaleY * motionScale * animation.scale}) rotate(${rotation + animation.rotation}deg)${perspective ? ` ${perspective}` : ''}`,
    opacity:
      (sampled?.opacity ?? transform?.opacity ?? 1) *
      animation.opacity *
      clipFadeOpacity(clip, styleFrame),
    ...(blendMode ? { mixBlendMode: blendMode } : {}),
    ...(effectiveMask
      ? image
        ? {
            maskImage: image,
            WebkitMaskImage: image,
            maskSize: '100% 100%',
            WebkitMaskSize: '100% 100%',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
          }
        : { clipPath: maskClipPath(effectiveMask, maskAspect) }
      : {}),
  };
}

/**
 * El lazo de máscara se dibuja en coordenadas de pantalla (fracción del
 * lienzo), pero `mask.points` vive en el espacio local de la capa: el
 * clip-path del preview y el `geq` del render se evalúan antes del
 * translate/scale/rotate del clip. Esta función aplica la inversa del
 * transform de `transformStyle` (espejo exacto, salvo perspectiva, que el
 * dibujo no soporta) para que el trazo caiga donde el usuario lo ve.
 */
function maskDrawPointToLocal(
  point: MaskPoint,
  clip: Clip,
  project: ProjectDocument,
  playheadFrame: number,
): MaskPoint {
  const width = project.video.width;
  const height = project.video.height;
  if (width <= 0 || height <= 0) return { ...point };
  const localFrame = Math.max(
    0,
    Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame),
  );
  const sampled = clipTransformAtFrame(clip, localFrame);
  const transform = clip.transform;
  const animation = animationState(clip, playheadFrame);
  const motion = motionParams(clip, playheadFrame);
  // translate en píxeles del lienzo: offset del clip + % de motion/animación.
  const tx =
    (sampled?.offsetX ?? transform?.offsetX ?? 0) +
    ((motion.x + animation.x) / 100) * width;
  const ty =
    (sampled?.offsetY ?? transform?.offsetY ?? 0) +
    ((motion.y + animation.y) / 100) * height;
  const sx =
    (sampled?.scaleX ?? transform?.scaleX ?? 1) * motion.scale * animation.scale;
  const sy =
    (sampled?.scaleY ?? transform?.scaleY ?? 1) * motion.scale * animation.scale;
  const degrees =
    (sampled?.rotationDeg ?? transform?.rotationDeg ?? 0) + animation.rotation;
  if (Math.abs(sx) < 1e-6 || Math.abs(sy) < 1e-6) return { ...point };
  // Pantalla → espacio local: deshacer T, luego S·R (rotación horaria en
  // coordenadas y-down, como el CSS rotate positivo).
  const cx = width / 2;
  const cy = height / 2;
  const vx = point.x * width - cx - tx;
  const vy = point.y * height - cy - ty;
  const ux = vx / sx;
  const uy = vy / sy;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const wx = ux * cos + uy * sin;
  const wy = -ux * sin + uy * cos;
  return {
    x: Math.min(1, Math.max(0, (cx + wx) / width)),
    y: Math.min(1, Math.max(0, (cy + wy) / height)),
  };
}

/**
 * The single filter builder of the editor. When a clip carries a Color-page
 * grade, `colorGrade` is authoritative: the flat fields it projects onto are
 * stripped so nothing is applied twice, and the compiled CSS + SVG chain is
 * appended. Without a grade the legacy behaviour is byte-for-byte unchanged.
 */
function effectsToCss(source: ClipEffects | undefined, filterId?: string): CSSProperties {
  if (!source) return {};
  const compiled = source.colorGrade && filterId ? compileGrade(source.colorGrade, filterId) : null;
  const effects: ClipEffects = compiled ? applyGradeProjection(source, {}) : source;
  const filters: string[] = [];
  if (effects.brightness !== undefined) filters.push(`brightness(${Math.max(0, 1 + effects.brightness)})`);
  if (effects.contrast !== undefined) filters.push(`contrast(${effects.contrast})`);
  if (effects.saturation !== undefined) filters.push(`saturate(${effects.saturation})`);
  if (effects.blur !== undefined && effects.blur > 0) filters.push(`blur(${effects.blur}px)`);
  const denoiseBlur = clipDenoiseBlurPx(effects.denoise);
  if (denoiseBlur > 0) filters.push(`blur(${denoiseBlur.toFixed(2)}px)`);
  if (effects.grayscale) filters.push('grayscale(1)');
  if (effects.sepia) filters.push('sepia(1)');
  if (effects.hueRotateDeg !== undefined && Math.abs(effects.hueRotateDeg) > 0.01) {
    filters.push(`hue-rotate(${effects.hueRotateDeg}deg)`);
  }
  if (effects.temperature !== undefined && effects.temperature > 0) {
    filters.push(`sepia(${Math.min(0.35, effects.temperature * 0.35)})`);
  }
  if (effects.shadows !== undefined && Math.abs(effects.shadows) > 0.001) {
    filters.push(
      `brightness(${Math.max(0.5, Math.min(1.5, 1 + effects.shadows * 0.06))})`,
    );
  }
  if (effects.highlights !== undefined && Math.abs(effects.highlights) > 0.001) {
    filters.push(
      `contrast(${Math.max(0.5, Math.min(1.5, 1 + effects.highlights * 0.12))})`,
    );
  }
  if (effects.fade !== undefined && effects.fade > 0.001) {
    filters.push(`contrast(${Math.max(0.5, 1 - effects.fade * 0.12)})`);
    filters.push(`brightness(${1 + effects.fade * 0.04})`);
  }
  const lift = effects.lift ?? { r: 0, g: 0, b: 0 };
  const gamma = effects.gamma ?? { r: 0, g: 0, b: 0 };
  const gain = effects.gain ?? { r: 0, g: 0, b: 0 };
  const red = lift.r + gain.r;
  const green = lift.g + gain.g;
  const blue = lift.b + gain.b;
  const exposure = (red + green + blue) / 3;
  if (Math.abs(exposure) > 0.01) {
    filters.push(`brightness(${Math.max(0.2, Math.min(3, 1 + exposure))})`);
  }
  const warmth = red - blue;
  if (Math.abs(warmth) > 0.01) {
    filters.push(`sepia(${Math.min(0.4, Math.abs(warmth))})`);
    filters.push(`hue-rotate(${warmth > 0 ? -15 : 160}deg)`);
  }
  const midtone = (gamma.r + gamma.g + gamma.b) / 3;
  if (Math.abs(midtone) > 0.01) {
    filters.push(`contrast(${Math.max(0.2, Math.min(3, 1 + midtone))})`);
  }
  const hsl = effects.hsl;
  if (hsl) {
    if (Math.abs(hsl.hue) > 0.1) filters.push(`hue-rotate(${hsl.hue}deg)`);
    if (Math.abs(hsl.saturation) > 0.001) {
      filters.push(`saturate(${Math.max(0, 1 + hsl.saturation)})`);
    }
    if (Math.abs(hsl.intensity) > 0.001) {
      filters.push(`brightness(${Math.max(0.2, 1 + hsl.intensity * 0.5)})`);
    }
  }
  const match = effects.colorMatch;
  if (match && match.strength > 0.001) {
    const matched = [match.r, match.g, match.b].map(
      (gain) => 1 + (gain - 1) * match.strength,
    );
    const matchExposure = (matched[0]! + matched[1]! + matched[2]!) / 3;
    if (Math.abs(matchExposure - 1) > 0.01) {
      filters.push(
        `brightness(${Math.max(0.2, Math.min(3, matchExposure))})`,
      );
    }
    const matchWarmth = matched[0]! - matched[2]!;
    if (Math.abs(matchWarmth) > 0.01) {
      filters.push(`sepia(${Math.min(0.4, Math.abs(matchWarmth))})`);
      filters.push(`hue-rotate(${matchWarmth > 0 ? -15 : 160}deg)`);
    }
  }
  if (compiled) {
    if (compiled.css) filters.push(compiled.css);
    if (compiled.svg) filters.push(`url(#${compiled.svg.id})`);
  }
  // Curvas propias o preset (`effects.curves`/`curvePreset`): el export las
  // emite como `curves=` de FFmpeg; la preview las dibuja con un
  // feComponentTransfer muestreado. Las defs las colecciona `gradeSpecs`.
  if (filterId && clipCurvesSpec(effects, clipCurvesFilterId(filterId))) {
    filters.push(`url(#${clipCurvesFilterId(filterId)})`);
  }
  // Nitidez plana (`effects.sharpen` → `unsharp` del export): va después de
  // las curvas, igual que en la cadena FFmpeg.
  if (filterId && clipSharpenSpec(effects, clipSharpenFilterId(filterId))) {
    filters.push(`url(#${clipSharpenFilterId(filterId)})`);
  }
  // Viñeta (`effects.vignette` → `vignette=` del export): multiplicación por
  // gradiente radial vía feImage+feBlend. Va antes del glow, que en el export
  // se aplica como paso final sobre todo lo demás.
  if (filterId && clipVignetteSpec(effects, clipVignetteFilterId(filterId))) {
    filters.push(`url(#${clipVignetteFilterId(filterId)})`);
  }
  // Relight (`effects.relight` → `geq` aditivo del export): pasa después de la
  // viñeta como en `filter.rs` y antes del glow.
  if (filterId && clipRelightSpec(effects, clipRelightFilterId(filterId))) {
    filters.push(`url(#${clipRelightFilterId(filterId)})`);
  }
  // Glow (`effects.glow` → halo screen del export): va último, sobre el
  // resultado ya graduado como en `apply_glow_to_chain`.
  if (filterId && clipGlowSpec(effects, clipGlowFilterId(filterId))) {
    filters.push(`url(#${clipGlowFilterId(filterId)})`);
  }
  return filters.length > 0 ? { filter: filters.join(' ') } : {};
}

/**
 * Stack declarativo del clip (`effects.stack`, editado en el modo VFX) que la
 * preview puede dibujar con el renderer WebGL de `EffectCanvas`.
 *
 * Aproximación de orden documentada: el export aplica el stack DESPUÉS del
 * grade plano (`apply_effect_stack` corre sobre la cadena ya graduada en
 * `plan/range.rs`), pero el canvas WebGL lee los frames crudos del elemento —
 * los filtros CSS no modifican la textura subida. La preview muestra
 * `grade(stack(crudo))` en vez de `stack(grade(crudo))`; para stacks
 * creativos la diferencia es sutil y el orden interno del stack se respeta.
 */
export function clipPreviewStack(
  clip: Clip,
  audition: LookAudition | null,
): EffectStack | null {
  const effects = auditionedEffects(clip, audition);
  const stack = effects?.stack;
  const lens = effects?.lensCorrection;
  const motionBlur = effects?.motionBlur;
  const denoise = effects?.denoise;
  const hasLens = lens !== undefined && (lens.k1 !== 0 || lens.k2 !== 0);
  const hasTemporal = motionBlur !== undefined && motionBlur.frames >= 2;
  const hasDenoise = denoise !== undefined && denoise > 0.001;
  if ((!stack || stack.length === 0) && !hasLens && !hasTemporal && !hasDenoise) return null;
  // denoise.temporal va PRIMERO: promedia el fuente crudo actual con el frame
  // fuente anterior sólo en zonas estáticas (componente temporal de hqdn3d;
  // la espacial la aproxima el blur CSS). blur.temporal después mezcla el
  // resultado con el previo — mismo orden que hqdn3d→tmix→stack del export.
  // Si hay LUTs activas el frame previo entra sin graduar (aproximación
  // documentada en los manifiestos).
  const instances = [
    ...(hasDenoise && denoise !== undefined
      ? [{
          id: 'denoise.temporal-' + clip.id,
          effectId: 'denoise.temporal',
          enabled: true,
          params: { strength: Math.min(1, denoise), tolerance: 0.35 },
        }]
      : []),
    ...(hasTemporal && motionBlur
      ? [{
          id: 'blur.temporal-' + clip.id,
          effectId: 'blur.temporal',
          enabled: true,
          params: { frames: motionBlur.frames, intensity: motionBlur.intensity },
        }]
      : []),
    ...(stack ?? []),
  ];
  if (hasLens && lens) {
    // effects.lensCorrection no es una instancia del stack: el export lo aplica
    // con lenscorrection en la cadena del clip. Se sintetiza una instancia
    // lens.correct al final para que la preview WebGL muestre el mismo warp
    // radial (aproximación documentada en el manifiesto).
    instances.push({
      id: 'lens.correct-' + clip.id,
      effectId: 'lens.correct',
      enabled: true,
      params: {
        k1: lens.k1,
        k2: lens.k2,
        cx: lens.cx ?? 0.5,
        cy: lens.cy ?? 0.5,
      },
    });
  }
  return instances as EffectStack;
}

function effectsStyle(clip: Clip, audition: LookAudition | null = null): CSSProperties {
  const effects = auditionedEffects(clip, audition);
  const style: CSSProperties = effects
    ? effectsToCss(effects, gradeFilterId(clip.id))
    : {};
  // Chroma key (`clip.chromaKey` → `chromakey=` del export): va primero en la
  // cadena — el fondo se elimina antes de graduar el sujeto. La spec la
  // colecciona `gradeSpecs`; acá sólo se referencia el id.
  const chromaKey = 'chromaKey' in clip ? clip.chromaKey : undefined;
  if (chromaKey) {
    const chromaId = clipChromaKeyFilterId(gradeFilterId(clip.id));
    style.filter = style.filter ? `url(#${chromaId}) ${style.filter}` : `url(#${chromaId})`;
  }
  return style;
}

function trackById(project: ProjectDocument, id: string): Track | undefined {
  return project.timeline.tracks.find((track) => track.id === id);
}

function VideoLayer({
  clip,
  asset,
  project,
  playheadFrame,
  playing,
  playbackRate,
  muted,
  trackId = '',
  trackGain = 0,
  viewport,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly playbackRate: number;
  readonly muted: boolean;
  readonly trackId?: string;
  readonly trackGain?: number;
  readonly viewport: PerspectiveViewport;
}) {
  const store = useProjectStore();
  const audition = useLookAudition();
  const root = store.state.opened?.root ?? '';
  const ref = useRef<HTMLVideoElement | null>(null);
  // Elemento vivo para `EffectCanvas`: el stack WebGL sube los frames del
  // propio <video>, así que el elemento tiene que quedar montado aunque la
  // imagen visible la pinte el canvas.
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | null>(null);
  // Enrutado por Web Audio: true sólo si el elemento quedó conectado al grafo
  // de su pista; en caso contrario la preview usa `element.volume` como siempre.
  const [routed, setRouted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  // Telemetría adaptativa (patrón Kloicut telemetry.rs): la capa lee el nivel
  // pedido y, en modo «Automática», elige original vs proxy por asset.
  const telemetry = usePreviewTelemetry();
  useProxyStatusVersion();
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const fps = fpsOf(project);
  const alphaCutout =
    asset !== undefined && asset.kind === 'video' && asset.media?.alpha === true;
  const proxy =
    asset && !alphaCutout && 'proxy' in asset
      ? (asset as Asset & { proxy?: { path: string } }).proxy
      : undefined;
  // Proxy listo verificado por el backend aunque aún no esté aplicado al
  // proyecto (`applyProxyToAsset`): sólo lo usa el modo automático.
  const readyProxyPath = asset ? proxyPlaybackPath(getProxyStatus(asset.id)) : null;
  // Proxy de estabilización horneado (`vidstabtransform`, el mismo filtro del
  // export): cuando aplica es la fuente de verdad visual, no una aproximación
  // — no pasa por la telemetría original/proxy.
  const stabProxy = clipStabilizationPreviewProxy(clip);
  const mediaPath = asset
    ? stabProxy ??
      (telemetry.auto
        ? telemetry.quality === 'full'
          ? asset.source.path
          : (proxy?.path ?? readyProxyPath ?? asset.source.path)
        : (proxy?.path ?? asset.source.path))
    : '';
  const url = asset ? store.service.mediaUrl(root, mediaPath) : '';
  useEffect(() => {
    setFailed(false);
    setReload(0);
  }, [url]);
  // Readiness del medio (paridad `prontidao.js`): el elemento reporta
  // cuándo puede dibujar el frame actual; el HUD muestra «Cargando…»
  // mientras quede algún clip visible sin datos.
  useEffect(() => {
    const video = ref.current;
    const key = `video:${clip.id}`;
    if (!video || !url) {
      clearPreviewMedia(key);
      return;
    }
    const notReady = () => reportPreviewMedia(key, false);
    const ready = () => reportPreviewMedia(key, true);
    // Stall durante la reproducción: además del indicador «Cargando…»,
    // alimenta la telemetría adaptativa (equivalente al frames_skipped del
    // recolector original).
    const stalled = () => {
      if (playingRef.current) recordPreviewWait();
      notReady();
    };
    if (video.readyState < 2) notReady();
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('playing', ready);
    video.addEventListener('waiting', stalled);
    video.addEventListener('stalled', stalled);
    video.addEventListener('error', ready);
    return () => {
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('playing', ready);
      video.removeEventListener('waiting', stalled);
      video.removeEventListener('stalled', stalled);
      video.removeEventListener('error', ready);
      clearPreviewMedia(key);
    };
  }, [url, clip.id]);
  const windowed = clip.kind === 'video' || clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  // Con curva de velocidad el elemento avanza a la velocidad instantánea de la
  // curva (`sampleSpeedCurve`, la misma que integra `curveSourceFraction`); el
  // render desactiva el `setpts` por tramos cuando hay lead de transición y
  // usa la media constante para todo el clip — la preview espeja ambas cosas.
  const speedCurveMode: SpeedCurveMode =
    clip.kind === 'video' && clip.speedCurve
      ? clipTransitionLeadActive(clip, fps)
        ? 'mean'
        : 'curve'
      : 'off';
  const reversed = clipIsReversed(clip);
  // El elemento tiene que avanzar sourceSeconds por segundo de reloj: la
  // velocidad del clip (o la instantánea de la curva) por la velocidad de la
  // reproducción con signo (negativo en el shuttle inverso J). preservesPitch
  // mantiene el tono del audio como hace el export (atempo); en reversa el
  // motor puede ignorarlo — es una revisión rápida, no una referencia de audio.
  const baseRate =
    clipPreviewRateAtLocal(clip, playheadFrame - clip.startFrame, {
      speedCurve: speedCurveMode,
    }) ?? 1;
  const signedRate = baseRate * playbackRate;
  const elementRate =
    (signedRate < 0 ? -1 : 1) * Math.min(8, Math.max(0.1, Math.abs(signedRate)));
  // Con transición el clip se monta `leadFrames` antes de su startFrame y el
  // render lo alimenta con fuente previa al inFrame (`in - lead·speed`): el
  // frame local puede ser negativo hasta -lead y el seek queda en 0 como el
  // `max(0)` del export. Sin transición el clamp es idéntico al anterior.
  const leadFrames = previewTransitionLeadFrames(clip, fps);
  const localFrame = playheadFrame - clip.startFrame;
  // El render descarta el audio del tramo de solape (`atrim=start=lead` +
  // `adelay=start_seconds`): durante el lead el clip entrante no suena y su
  // audio arranca en `startFrame` con el contenido del in-point. El <video>
  // ya está sonando el prerrol desde `startFrame - lead`, así que hay que
  // mutearlo o la preview adelanta el audio `lead` frames respecto al MP4.
  const inTransitionLead = clipInTransitionLead(clip, playheadFrame, fps);
  const mediaMuted = muted || inTransitionLead;
  const sourceFrame = clipSourceFrameAtLocal(clip, localFrame, {
    speedCurve: speedCurveMode,
  });
  // Con proxy de estabilización el medio empieza en `inFrame` del fuente
  // (el bake cubre exactamente esa ventana): el currentTime del elemento es
  // `sourceFrame - inFrame`. Sin proxy el offset es 0 como siempre.
  const stabInFrame =
    stabProxy !== undefined && clip.kind === 'video' && 'inFrame' in clip.source
      ? clip.source.inFrame
      : 0;
  const sourceSeconds =
    sourceFrame !== null ? Math.max(0, sourceFrame - stabInFrame) / fps : 0;
  const fxFrame = Math.max(0, Math.min(clip.durationFrames - 1, localFrame + leadFrames));
  const clipGainDb = clipGainAtFrame(clip, fxFrame);
  // Filtros de voz del clip (HP/LP/EQ/denoise/de-esser/puerta/compresor/
  // efecto de voz — el equivalente Web Audio de `audio_filter`; `denoise`
  // es una aproximación por sustracción espectral, no sample-exacta) +
  // efectos del audioStack, en el orden del render.
  const clipFx = [
    ...clipVoiceFxSpec(clip.audio),
    ...clipAudioFxSpec(
      ('effects' in clip ? clip.effects?.audioStack : undefined) as
        | EffectStack
        | undefined,
      fxFrame,
    ),
  ];
  // Con Web Audio, la ganancia de pista la aplica el fader del grafo (sin el
  // tope de 1.0 del elemento) y el elemento sólo lleva la ganancia del clip.
  // Sin grafo, el volumen combinado va en `element.volume` como siempre.
  const volume =
    mediaMuted || clip.audio?.muted === true ? 0 : volumeFromDb(clipGainDb + (routed ? 0 : trackGain));

  // Clip `reverse`: el <video> queda en flipbook sin sonido y esta voz
  // Web Audio reproduce la ventana de fuente invertida (el render la invierte
  // con `areverse`). Sin plan válido (speedCurve, archivo grande) no suena.
  useReversedClipAudio({
    clip,
    url,
    playing,
    localFrame,
    playbackRate,
    fps,
    trackId,
    gainDb: clipGainDb,
    pan: clip.audio?.pan ?? 0,
    fx: clipFx,
    silent: mediaMuted || clip.audio?.muted === true,
  });

  // Enruta el elemento al grafo de audio de su pista (fader, paneo y EQ). Si
  // no hay Web Audio disponible, attach devuelve false y sigue el camino de
  // siempre con `element.volume`: degradación silenciosa.
  useEffect(() => {
    const media = ref.current;
    if (!media || !url || trackId === '') {
      setRouted(false);
      return;
    }
    const ok = attachPreviewAudio(trackId, media, clip.audio?.pan ?? 0, clipFx);
    setRouted(ok);
    return () => {
      if (ok) detachPreviewAudio(trackId, media);
    };
    // clipFx se recalcula por frame (keyframes); attach sólo necesita la
    // versión del montaje — los cambios llegan por setPreviewClipFx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, url]);

  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    setPreviewClipPan(media, clip.audio?.pan ?? 0);
    setPreviewClipFx(media, clipFx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.audio?.pan, clipFx]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !url) return;
    // En reversa el objetivo baja mientras el elemento sólo avanza: la preview
    // no puede reproducir hacia atrás, así que avanza por seeks por frame
    // (flipbook) — el umbral de deriva es ~0 para seguir al playhead.
    const drift = Math.abs(video.currentTime - sourceSeconds);
    if (drift > (reversed ? 0.001 : 0.12)) {
      try {
        video.currentTime = Math.max(0, sourceSeconds);
      } catch {
        // Metadata may not be loaded yet; the next update will try again.
      }
    }
    if (playing) {
      if (reversed) {
        // Pausado a propósito: cada frame del playhead repositiona el seek.
        // El sonido del clip `reverse` lo da useReversedClipAudio (buffer
        // invertido por Web Audio), no el elemento.
        video.pause();
      } else {
        resumePreviewAudio();
        // `sourceSeconds` cambia en cada frame, así que este efecto se ejecuta
        // ~30 veces por segundo. Llamar a `play()` sobre un video que ya está
        // reproduciéndose encolaba otras tantas promesas sin ningún efecto.
        if (video.paused) {
          void video.play().catch(() => {
            // Autoplay can be denied; the scrub still works and the user can press play again.
          });
        }
      }
    } else if (!video.paused) {
      video.pause();
    }
  }, [playing, sourceSeconds, url, reversed]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.preservesPitch = true;
    video.playbackRate = elementRate;
  }, [elementRate]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  // `muted` por propiedad: el atributo JSX puede quedar como defaultMuted en
  // algunos motores y no silenciar el elemento (ni la ruta Web Audio).
  useEffect(() => {
    const video = ref.current;
    if (video) video.muted = mediaMuted;
  }, [mediaMuted]);

  const isImageSrc = url.endsWith('.jpg') || url.endsWith('.png') || url.endsWith('.webp');
  const stack = WEBGL_AVAILABLE ? clipPreviewStack(clip, audition) : null;
  const luts = usePreviewLuts(clipPreviewLuts(clip, audition));
  const gpuFx = WEBGL_AVAILABLE && (stack !== null || luts.length > 0);
  const mediaStyle: CSSProperties = {
    ...transformStyle(clip, project, playheadFrame, viewport),
    ...effectsStyle(clip, audition),
  };
  const stackFrame = Math.max(0, playheadFrame - clip.startFrame);

  if (failed || isImageSrc || !url) {
    return (
      <div
        className="preview-media preview-simulated-video"
        data-clip-id={clip.id}
        style={{
          ...transformStyle(clip, project, playheadFrame, viewport),
          ...effectsStyle(clip, audition),
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        }}
      >
        <img
          src={isImageSrc ? url : '/editor_preview.jpg'}
          crossOrigin="anonymous"
          alt={clip.label}
          style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            right: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(6px)',
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#f8fafc',
            fontSize: '11px',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontWeight: 600 }}>{clip.label}</span>
          <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>
            {((playheadFrame - clip.startFrame) / 30).toFixed(1)}s / {(clip.durationFrames / 30).toFixed(1)}s
          </span>
        </div>
      </div>
    );
  }

  const video = (
    <video
      key={`${url}-${reload}`}
      ref={(node) => {
        ref.current = node;
        setMediaEl(node);
      }}
      className="preview-media"
      src={url}
      crossOrigin="anonymous"
      data-clip-id={clip.id}
      style={gpuFx ? { ...mediaStyle, opacity: 0 } : mediaStyle}
      muted={mediaMuted}
      playsInline
      preload="auto"
      onError={() => setFailed(true)}
    />
  );
  if (!gpuFx) return video;
  // Con stack/LUT el frame visible lo compone el renderer WebGL sobre el mismo
  // elemento (sigue reproduciendo audio y alimenta la textura). El wrapper
  // lleva transform/efectos/máscara para que el canvas quede donde estaba el
  // video; `opacity: 0` en el <video> evita el doble pintado.
  return (
    <>
      {video}
      <div className="preview-media" data-clip-id={clip.id} style={mediaStyle}>
        <EffectCanvas
          source={mediaEl}
          stack={stack ?? EMPTY_EFFECT_STACK}
          luts={luts}
          frameIndex={stackFrame}
          frameRate={fps}
          active
          className="effect-canvas"
        />
      </div>
    </>
  );
}

function ImageLayer({
  clip,
  asset,
  project,
  playheadFrame,
  viewport,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly viewport: PerspectiveViewport;
}) {
  const store = useProjectStore();
  const audition = useLookAudition();
  const root = store.state.opened?.root ?? '';
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  useEffect(() => {
    setFailed(false);
    setReload(0);
  }, [url]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [mediaEl, setMediaEl] = useState<HTMLImageElement | null>(null);
  // Readiness (paridad `prontidao.js`): la imagen reporta load/error.
  useEffect(() => {
    const key = `image:${clip.id}`;
    const img = imgRef.current;
    if (!img || !url) {
      clearPreviewMedia(key);
      return;
    }
    if (!img.complete || img.naturalWidth === 0) reportPreviewMedia(key, false);
    const ready = () => reportPreviewMedia(key, true);
    img.addEventListener('load', ready);
    img.addEventListener('error', ready);
    return () => {
      img.removeEventListener('load', ready);
      img.removeEventListener('error', ready);
      clearPreviewMedia(key);
    };
  }, [url, clip.id, reload]);
  const luts = usePreviewLuts(clipPreviewLuts(clip, audition));
  if (!url || failed) {
    return (
      <div
        className="media-missing"
        style={{ ...transformStyle(clip, project, playheadFrame, viewport), ...effectsStyle(clip, audition) }}
        role="status"
      >
        <span>Imagen no disponible</span>
        {failed ? (
          <button
            type="button"
            className="small"
            onClick={() => {
              setFailed(false);
              setReload((value) => value + 1);
            }}
          >
            Reintentar
          </button>
        ) : null}
      </div>
    );
  }
  const stack = WEBGL_AVAILABLE ? clipPreviewStack(clip, audition) : null;
  const gpuFx = WEBGL_AVAILABLE && (stack !== null || luts.length > 0);
  const mediaStyle: CSSProperties = {
    ...transformStyle(clip, project, playheadFrame, viewport),
    ...effectsStyle(clip, audition),
  };
  const img = (
    <img
      ref={(node) => {
        imgRef.current = node;
        setMediaEl(node);
      }}
      key={`${url}-${reload}`}
      className="preview-media"
      src={url}
      crossOrigin="anonymous"
      data-clip-id={clip.id}
      alt={clip.label ?? 'Imagen de la timeline'}
      style={gpuFx ? { ...mediaStyle, opacity: 0 } : mediaStyle}
      onError={() => setFailed(true)}
    />
  );
  if (!gpuFx) return img;
  return (
    <>
      {img}
      <div className="preview-media" data-clip-id={clip.id} style={mediaStyle}>
        <EffectCanvas
          source={mediaEl}
          stack={stack ?? EMPTY_EFFECT_STACK}
          luts={luts}
          frameIndex={Math.max(0, playheadFrame - clip.startFrame)}
          frameRate={fpsOf(project)}
          active
          className="effect-canvas"
        />
      </div>
    </>
  );
}

function GraphicLayer({
  clip,
  project,
  playheadFrame,
  viewport,
}: {
  readonly clip: Clip;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly viewport: PerspectiveViewport;
}) {
  const motionId = clip.source.type === 'graphic' ? clip.source.motionId : null;
  const motion = project.motion.find((item) => item.id === motionId);
  const layerStyle = {
    position: 'absolute' as const,
    inset: 0,
    ...transformStyle(clip, project, playheadFrame, viewport),
  };
  if (!motion) {
    return (
      <div className="graphic-placeholder" style={layerStyle} data-clip-id={clip.id}>
        Gráfico sin motion item
      </div>
    );
  }
  const template = templateById(motion.template.id);
  if (!template) {
    return (
      <div className="graphic-placeholder" style={layerStyle}>
        Plantilla {motion.template.id} desconocida
      </div>
    );
  }
  try {
    const plan = buildMotionPlan(template, motion.props, {
      width: project.video.width,
      height: project.video.height,
      fpsNum: project.video.frameRate.num,
      fpsDen: project.video.frameRate.den,
      durationFrames: clip.durationFrames,
    });
    const progress = Math.max(
      0,
      Math.min(1, (playheadFrame - clip.startFrame) / Math.max(1, clip.durationFrames)),
    );
    return (
      <div style={layerStyle}>
        <MotionPreview plan={plan} progress={progress} />
      </div>
    );
  } catch (error) {
    return (
      <div className="graphic-placeholder" style={layerStyle}>
        Gráfico inválido: {error instanceof Error ? error.message : 'props inválidas'}
      </div>
    );
  }
}

function AudioLayer({
  clip,
  asset,
  project,
  playheadFrame,
  playing,
  playbackRate,
  trackId = '',
  trackGain = 0,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly playbackRate: number;
  readonly trackId?: string;
  readonly trackGain?: number;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const ref = useRef<HTMLAudioElement | null>(null);
  // Enrutado por Web Audio: true sólo si el elemento quedó conectado al grafo
  // de su pista; si no, el volumen combinado va en `element.volume`.
  const [routed, setRouted] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const fps = fpsOf(project);
  const windowed = clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  const reversed = clipIsReversed(clip);
  // Igual que en VideoLayer: el elemento avanza a la velocidad del clip (o la
  // instantánea de la curva si la hubiera) × velocidad de reproducción con
  // signo (negativo en el shuttle inverso) y preservesPitch conserva el tono
  // como el export cuando el motor lo permite (en reversa puede no aplicar).
  const baseRate =
    clipPreviewRateAtLocal(clip, playheadFrame - clip.startFrame) ?? 1;
  const signedRate = baseRate * playbackRate;
  const elementRate =
    (signedRate < 0 ? -1 : 1) * Math.min(8, Math.max(0.1, Math.abs(signedRate)));
  const sourceFrame = clipSourceFrameAtLocal(clip, playheadFrame - clip.startFrame);
  const sourceSeconds = sourceFrame !== null ? Math.max(0, sourceFrame) / fps : 0;
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  // Readiness del audio (misma regla que video/imagen): sin datos
  // suficientes el HUD muestra «Cargando…» aunque el cuadro ya esté.
  useEffect(() => {
    const audio = ref.current;
    const key = `audio:${clip.id}`;
    if (!audio || !url) {
      clearPreviewMedia(key);
      return;
    }
    const notReady = () => reportPreviewMedia(key, false);
    const ready = () => reportPreviewMedia(key, true);
    const stalled = () => {
      if (playingRef.current) recordPreviewWait();
      notReady();
    };
    if (audio.readyState < 2) notReady();
    audio.addEventListener('loadeddata', ready);
    audio.addEventListener('canplay', ready);
    audio.addEventListener('playing', ready);
    audio.addEventListener('waiting', stalled);
    audio.addEventListener('stalled', stalled);
    audio.addEventListener('error', ready);
    return () => {
      audio.removeEventListener('loadeddata', ready);
      audio.removeEventListener('canplay', ready);
      audio.removeEventListener('playing', ready);
      audio.removeEventListener('waiting', stalled);
      audio.removeEventListener('stalled', stalled);
      audio.removeEventListener('error', ready);
      clearPreviewMedia(key);
    };
  }, [url, clip.id]);
  const audioFxFrame = Math.max(
    0,
    Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame),
  );
  const clipGainDb = clipGainAtFrame(clip, audioFxFrame);
  const clipFx = [
    ...clipVoiceFxSpec(clip.audio),
    ...clipAudioFxSpec(
      ('effects' in clip ? clip.effects?.audioStack : undefined) as
        | EffectStack
        | undefined,
      audioFxFrame,
    ),
  ];
  const volume = clip.audio?.muted === true ? 0 : volumeFromDb(clipGainDb + (routed ? 0 : trackGain));

  // Clip `reverse`: el <audio> queda en flipbook sin sonido y esta voz Web
  // Audio reproduce la ventana de fuente invertida, igual que en VideoLayer.
  useReversedClipAudio({
    clip,
    url,
    playing,
    localFrame: playheadFrame - clip.startFrame,
    playbackRate,
    fps,
    trackId,
    gainDb: clipGainDb,
    pan: clip.audio?.pan ?? 0,
    fx: clipFx,
    silent: clip.audio?.muted === true,
  });

  // Enruta el elemento al grafo de audio de su pista (fader, paneo y EQ). Si
  // no hay Web Audio disponible, attach devuelve false y sigue el camino de
  // siempre con `element.volume`: degradación silenciosa.
  useEffect(() => {
    const media = ref.current;
    if (!media || !url || trackId === '') {
      setRouted(false);
      return;
    }
    const ok = attachPreviewAudio(trackId, media, clip.audio?.pan ?? 0, clipFx);
    setRouted(ok);
    return () => {
      if (ok) detachPreviewAudio(trackId, media);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, url]);

  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    setPreviewClipPan(media, clip.audio?.pan ?? 0);
    setPreviewClipFx(media, clipFx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.audio?.pan, clipFx]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio || !url) return;
    // En reversa el objetivo baja y el elemento sólo avanza: flipbook por
    // seeks por frame, igual que en VideoLayer (aproximación declarada).
    const drift = Math.abs(audio.currentTime - sourceSeconds);
    if (drift > (reversed ? 0.001 : 0.12)) {
      try {
        audio.currentTime = Math.max(0, sourceSeconds);
      } catch {
        // Ignore until metadata is available.
      }
    }
    if (playing) {
      if (reversed) {
        audio.pause();
      } else {
        resumePreviewAudio();
        void audio.play().catch(() => {});
      }
    } else {
      audio.pause();
    }
  }, [playing, sourceSeconds, url, reversed]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.preservesPitch = true;
    audio.playbackRate = elementRate;
  }, [elementRate]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  if (!url) return null;
  // crossOrigin como en los <video>: sin CORS limpio, Web Audio enmudecería
  // al enrutar el elemento al grafo.
  return <audio ref={ref} src={url} crossOrigin="anonymous" preload="auto" />;
}

function CaptionOverlay({
  project,
  playheadFrame,
  previewWidth,
}: {
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly previewWidth: number;
}) {
  const active = project.captions.cues
    .map((cue, index) => ({
      cue,
      index,
      track: trackById(project, cue.trackId),
    }))
    .filter(
      (entry) =>
        entry.track?.kind === 'caption' &&
        !entry.track.hidden &&
        playheadFrame >= entry.cue.startFrame &&
        playheadFrame < entry.cue.endFrame,
    )
    .sort((a, b) => (a.track?.order ?? 0) - (b.track?.order ?? 0));
  if (active.length === 0) return null;
  const scale = previewWidth > 0 ? previewWidth / project.video.width : 1;
  return (
    <>
      {active.map(({ cue, index, track }) => {
        const style =
          project.captions.styles.find((item) => item.id === cue.styleId) ??
          project.captions.styles[0];
        const fontSize = Math.max(10, (style?.fontSizePx ?? 54) * scale);
        const color = style?.color ?? '#ffffff';
        const outline = style?.outlineColor ?? '#000000';
        const position = style?.position ?? 'bottom';
        const boxed = style?.borderStyle === 'box';
        const background = style?.backgroundColor ?? (boxed ? outline : undefined);
        const revealWords =
          cue.wordReveal === true &&
          cue.words !== undefined &&
          cue.words.length > 0;
        const visibleWords = cueWordsAt(cue, playheadFrame);
        const hasWords = revealWords
          ? visibleWords.length > 0
          : cue.words !== undefined && cue.words.length > 1;
        if (revealWords && visibleWords.length === 0) return null;
        const depth =
          style && style.borderStyle !== 'box'
            ? Math.max(0, Math.min(12, style.depth3d ?? 0))
            : 0;
        const depthColor = style?.depthColor ?? style?.outlineColor ?? '#1f2937';
        const shadows: string[] = [];
        for (let layer = 1; layer <= depth; layer += 1) {
          shadows.push(`${layer}px ${layer}px 0 ${depthColor}`);
        }
        if (style?.shadow !== false) shadows.push('0 2px 12px rgba(0,0,0,0.75)');
        const spanStyle: CSSProperties = {
          color,
          fontSize,
          fontFamily: style?.fontFamily
            ? `"${style.fontFamily}", var(--emoji-font), sans-serif`
            : 'var(--emoji-font)',
          fontWeight: style?.bold ? 800 : 500,
          fontStyle: style?.italic ? 'italic' : 'normal',
          WebkitTextStroke: boxed ? undefined : `${Math.max(1, fontSize * 0.03)}px ${outline}`,
          textShadow: shadows.length > 0 ? shadows.join(', ') : undefined,
          ...(background
            ? { background, padding: '0.06em 0.28em', borderRadius: '0.12em' }
            : {}),
        };
        const motion =
          cue.words && cue.words.length > 0
            ? null
            : captionMotionAt(cue, playheadFrame);
        if (motion) {
          spanStyle.transform = `translate(${motion.x * 50}%, ${motion.y * 50}%) scale(${motion.scale}) rotate(${motion.rotationDeg}deg)`;
          spanStyle.opacity = motion.opacity;
        }
        // Desplazamiento manual del subtítulo (píxeles del proyecto → pantalla).
        const offsetX = (cue.offsetX ?? 0) * scale;
        const offsetY = (cue.offsetY ?? 0) * scale;
        const hasOffset = offsetX !== 0 || offsetY !== 0;
        return (
          <div
            key={cue.id}
            className={`preview-caption caption-${position}`}
            style={{
              zIndex: 6 + (track?.order ?? 0) + index,
              ...(hasOffset ? { transform: `translate(${offsetX}px, ${offsetY}px)` } : {}),
            }}
            aria-live="off"
          >
            {hasWords ? (
              <span className="caption-words" style={spanStyle}>
                {visibleWords.map((word, wordIndex) => {
                  const highlighted = revealWords
                    ? wordIndex === visibleWords.length - 1
                    : playheadFrame >= word.startFrame &&
                      playheadFrame < word.endFrame;
                  return (
                    <span
                      key={`${word.startFrame}-${wordIndex}`}
                      className={highlighted ? 'caption-word active' : 'caption-word'}
                      style={{ color: highlighted ? '#6fa8dc' : color }}
                    >
                      {word.text}{' '}
                    </span>
                  );
                })}
              </span>
            ) : (
              <span style={spanStyle}>{cue.text}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

export const Preview = memo(function Preview() {
  const store = useProjectStore();
  const project = store.state.project;
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>();
  // Las guías arrancan según Ajustes → Editor; el botón de la vista previa
  // sigue mandando durante la sesión.
  const [showGuides, setShowGuides] = useState(() => loadEditorPreferences().safeMargins);
  const [safeAreaPreset, setSafeAreaPreset] = useState<SafeAreaPresetId>(
    () => loadEditorPreferences().safeAreaPreset,
  );
  const [showScopes, setShowScopes] = useState(false);
  const [showAudioScopes, setShowAudioScopes] = useState(false);
  const [compare, setCompare] = useState(false);
  const [realFrame, setRealFrame] = useState<PreviewFrameResult | null>(null);
  const [realFrameBusy, setRealFrameBusy] = useState(false);
  // Token de la cadena de pre-calentamiento: cada render nuevo (o cambio
  // de proyecto) la invalida para no encolar FFmpeg detrás del usuario.
  const prewarmToken = useRef(0);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [monitorZoom, setMonitorZoom] = useState<number>(readPreviewZoom);
  const [monitorPan, setMonitorPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  // false = Ajustar (contain, imagen completa); true = Llenar (cover, sin franjas)
  const [monitorFill, setMonitorFill] = useState<boolean>(readPreviewFill);
  const [pixelPerfect, setPixelPerfect] = useState(false);
  const maskDrawArmed = useMaskDrawArmed();
  const [maskStroke, setMaskStroke] = useState<MaskPoint[] | null>(null);
  const maskStrokeRef = useRef<MaskPoint[] | null>(null);
  const doodleArmed = useDoodleArmed();
  const [doodleStroke, setDoodleStroke] = useState<MaskPoint[] | null>(null);
  const doodleStrokeRef = useRef<MaskPoint[] | null>(null);
  // Posición del puntero en px dentro del overlay de dibujo: alimenta la
  // «manito» que reemplaza al cursor mientras el modo está armado. Va por
  // ref + estilo directo para no re-renderizar el monitor a cada mousemove.
  const doodleHandRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    trackPreviewFonts();
  }, []);

  // Cualquier edición invalida la firma del caché: la cadena de
  // pre-calentamiento en vuelo deja de tener sentido y se corta.
  useEffect(() => {
    prewarmToken.current += 1;
  }, [project]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_ZOOM_KEY, String(monitorZoom));
    } catch {
      // Sin almacenamiento: zoom sólo para esta sesión.
    }
  }, [monitorZoom]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_FIT_KEY, monitorFill ? 'fill' : 'fit');
    } catch {
      // Sin almacenamiento: modo sólo para esta sesión.
    }
  }, [monitorFill]);
  const fps = project ? fpsOf(project) : 30;
  const safeArea = safeAreaPresetById(safeAreaPreset);
  const safeAreaMismatch = project
    ? safeAreaAspectMismatch(safeArea, project.video.width, project.video.height)
    : false;
  // La vista previa sí necesita cada frame (es el monitor).
  const playback = useProjectPlayback();
  const playhead = playback.frame;
  const playing = playback.playing;
  const telemetry = usePreviewTelemetry();
  // «Automática»: la telemetría decide original vs proxy por capa (patrón
  // adaptive_quality_desired de Kloicut). Sólo sesión, no se persiste.
  const [autoQuality, setAutoQuality] = useState(false);

  useEffect(() => {
    setPreviewAutoQuality(autoQuality);
    if (autoQuality) resetPreviewTelemetry();
  }, [autoQuality]);

  useEffect(() => {
    return () => {
      setPreviewAutoQuality(false);
      resetPreviewTelemetry();
    };
  }, []);

  useEffect(() => {
    resetPreviewTelemetry();
  }, [project?.id]);

  useEffect(() => {
    setPreviewFrameBudget(1000 / Math.max(1, fps));
  }, [fps]);

  // Cadencia real de frames de pantalla mientras reproduce: es la señal de
  // «decode cost» del recolector original, medida en el navegador.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      recordPlaybackFrame(now - last, 1000 / Math.max(1, fps));
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps]);

  useEffect(() => {
    // Este efecto corre en cada frame de reproducción. Si los valores ya
    // están en su estado por defecto, devolver la misma referencia deja que
    // React omita el render en vez de encolar dos actualizaciones por frame.
    setRealFrame((current) => (current === null ? current : null));
    setPixelPerfect((current) => (current === false ? current : false));
  }, [playhead, project?.id]);

  useEffect(() => {
    setMonitorZoom(1);
    setMonitorPan({ x: 0, y: 0 });
  }, [project?.id, project?.video.width, project?.video.height]);

  // El grafo de audio de la preview sigue el proyecto: fader, paneo y EQ de
  // pista más ganancia master, aunque se muevan desde la vista Mezcla.
  useEffect(() => {
    if (project) syncPreviewAudioFromProject(project);
  }, [project]);

  // Automatización de pista (fader y paneo): el grafo se muestrea en el frame visible,
  // también al arrastrar el playhead, no sólo cuando cambia el proyecto.
  useEffect(() => {
    if (project) syncPreviewAudioAtFrame(project, playhead);
  }, [project, playhead]);

  // Máscaras de luminancia del mate para los `luma-wipe` cuyo lead cubre el
  // playhead (canvas sobre el frame actual del mate, ver preview-luma-mask).
  const lumaMasks = useLumaWipeMasks(project, playhead, fps);

  // La pertenencia de cada clip a las selecciones visual/audio/ajuste y el
  // orden por pista no cambian durante la reproducción (el documento es
  // inmutable entre frames): `clipIndex` se construye una vez por proyecto
  // y cada tick sólo filtra por rango de frames.
  const clipIndex = useMemo(
    () => (project ? buildPreviewClipIndex(project) : null),
    [project],
  );

  const visualClips = useMemo<PreviewClipEntry[]>(
    () => (clipIndex ? activeAt(clipIndex.visual, playhead) : []),
    [clipIndex, playhead],
  );

  const audioClips = useMemo<PreviewClipEntry[]>(
    () => (clipIndex ? activeAt(clipIndex.audio, playhead) : []),
    [clipIndex, playhead],
  );

  const adjustmentClips = useMemo<PreviewClipEntry[]>(
    () => (clipIndex ? activeAt(clipIndex.adjustment, playhead) : []),
    [clipIndex, playhead],
  );

  // En modo «Automática» la preview puede usar proxies listos aunque no
  // estén aplicados al proyecto: se consulta `proxyStatus` una vez por asset
  // de video visible (el store reclama cada id para no re-consultar en loop).
  const previewVideoAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of visualClips) {
      if (entry.asset?.kind === 'video' && entry.clip.source.type === 'asset') {
        ids.add(entry.clip.source.assetId);
      }
    }
    return [...ids].sort().join(',');
  }, [visualClips]);

  useEffect(() => {
    if (!autoQuality || !store.service.available || previewVideoAssetIds === '') return;
    for (const assetId of previewVideoAssetIds.split(',')) {
      if (!claimProxyStatusFetch(assetId)) continue;
      void store.service
        .proxyStatus(assetId)
        .then((status) => publishProxyStatus(status))
        .catch(() => publishProxyStatus(null, assetId));
    }
  }, [autoQuality, previewVideoAssetIds, store.service]);

  // Agendador — pre-calentamiento al detener la reproducción: tras mirar,
  // el usuario suele inspeccionar frames vecinos («Frame real», pixel
  // perfect); con 400 ms de debounce se calientan ±2 del clip visible.
  // Se salta durante la reproducción y si hay un render manual en vuelo.
  useEffect(() => {
    if (playing || !project || realFrameBusy) return;
    const target = visualClips[visualClips.length - 1];
    if (!target) return;
    const timer = window.setTimeout(() => {
      const token = ++prewarmToken.current;
      void prewarmFramesAround(
        (request) => store.service.renderPreviewFrame(request),
        { project, clipId: target.clip.id, frame: playhead },
        {
          minFrame: target.clip.startFrame,
          maxFrame: target.clip.startFrame + target.clip.durationFrames - 1,
        },
        () => prewarmToken.current !== token,
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [playing, project, realFrameBusy, playhead, visualClips, store]);

  // Audición de looks del catálogo (state/look-audition): las capas de
  // ajuste en pantalla usan los efectos sonando en vez de los propios.
  const audition = useLookAudition();
  const adjustmentFilter = useMemo(() => {
    if (!project || compare) return '';
    return adjustmentClips
      .map((entry) => {
        const clip = entry.clip as Extract<Clip, { kind: 'adjustment' }>;
        const fx = auditionedEffects(clip, audition);
        return fx ? effectsToCss(fx, gradeFilterId(clip.id)).filter : undefined;
      })
      .filter((filter): filter is string => typeof filter === 'string' && filter.length > 0)
      .join(' ');
  }, [adjustmentClips, audition, compare, project]);

  // Capas de espectro audio-reactivo (paridad `espectro.js`): cada clip de
  // ajuste activo en el playhead con `effects.spectrum` dibuja su visualizador
  // sobre el video, anclado abajo como en el export FFmpeg (`showfreqs`).
  const spectrumOverlays = useMemo(
    () =>
      compare
        ? []
        : adjustmentClips
            .map((entry) => {
              const clip = entry.clip as Extract<Clip, { kind: 'adjustment' }>;
              const spec = clip.effects?.spectrum;
              return spec ? { clipId: clip.id, spec } : null;
            })
            .filter(
              (entry): entry is { clipId: string; spec: NonNullable<ClipEffects['spectrum']> } =>
                entry != null,
            ),
    [adjustmentClips, compare],
  );

  // Defs for every grade that can be on screen. Building them here (instead of
  // inside each clip layer) keeps one <svg> per preview and lets CSS url(#id)
  // resolve for clips, adjustment layers and the project-wide look alike.
  const gradeSpecs = useMemo<GradeFilterSpec[]>(() => {
    if (!project || compare) return [];
    const specs: GradeFilterSpec[] = [];
    const pushClipSpecs = (raw: unknown, baseId: string): void => {
      if (!raw || typeof raw !== 'object') return;
      const fx = raw as ClipEffects;
      // Misma proyección que effectsToCss: con colorGrade activo el grade es
      // autoridad y los campos planos owned (curves incluidos) se eliminan.
      const compiled = fx.colorGrade ? compileGrade(fx.colorGrade, baseId) : null;
      if (compiled?.svg) specs.push(compiled.svg);
      const effective = compiled ? applyGradeProjection(fx, {}) : fx;
      const curves = clipCurvesSpec(effective, clipCurvesFilterId(baseId));
      if (curves) specs.push(curves);
      const sharpen = clipSharpenSpec(effective, clipSharpenFilterId(baseId));
      if (sharpen) specs.push(sharpen);
      const vignette = clipVignetteSpec(effective, clipVignetteFilterId(baseId));
      if (vignette) specs.push(vignette);
      const relight = clipRelightSpec(effective, clipRelightFilterId(baseId));
      if (relight) specs.push(relight);
      const glow = clipGlowSpec(effective, clipGlowFilterId(baseId));
      if (glow) specs.push(glow);
    };
    for (const clip of project.timeline.clips) {
      const baseId = gradeFilterId(clip.id);
      pushClipSpecs('effects' in clip ? clip.effects : undefined, baseId);
      const chroma = 'chromaKey' in clip ? clip.chromaKey : undefined;
      const chromaSpec = clipChromaKeySpec(chroma, clipChromaKeyFilterId(baseId));
      if (chromaSpec) specs.push(chromaSpec);
    }
    pushClipSpecs(project.look, gradeFilterId('project-look'));
    return specs;
  }, [project, compare]);

  const selection = store.state.selection;
  const selectedClip =
    selection.kind === 'clip'
      ? (visualClips.find((entry) => entry.clip.id === selection.id)?.clip ?? null)
      : null;
  // Dibujo de máscara a mano: sólo clips visuales con máscara propia.
  const maskDrawClip =
    maskDrawArmed &&
    selectedClip &&
    (selectedClip.kind === 'video' ||
      selectedClip.kind === 'image' ||
      selectedClip.kind === 'freeze')
      ? selectedClip
      : null;
  // Preview en vivo del resultado final: la plumilla se muestra ya
  // suavizada (Catmull–Rom cerrado), no el trazo crudo del pointer.
  const maskStrokePreview =
    maskStroke && maskStroke.length > 2
      ? smoothMaskStroke(maskStroke, 48)
      : maskStroke;

  // El modo armado es frágil: Escape cancela y si la selección deja de ser
  // un clip visual en pantalla el overlay desaparecería sin aviso — se
  // desarma solo para no quedar en un estado invisible.
  useEffect(() => {
    if (!maskDrawArmed) return;
    if (maskDrawClip) return;
    setMaskDrawArmed(false);
    maskStrokeRef.current = null;
    setMaskStroke(null);
  }, [maskDrawArmed, maskDrawClip]);

  useEffect(() => {
    if (!maskDrawArmed) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        maskStrokeRef.current = null;
        setMaskStroke(null);
        setMaskDrawArmed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maskDrawArmed]);

  // Modo «dibujar» (`maozinha`): Escape cancela el trazo en curso o desarma.
  useEffect(() => {
    if (!doodleArmed) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (doodleStrokeRef.current) {
          doodleStrokeRef.current = null;
          setDoodleStroke(null);
        } else {
          setDoodleArmed(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doodleArmed]);

  // Indicador «preview no lista» (paridad `prontidao.js`): medios
  // visibles sin datos suficientes para dibujar el frame actual.
  const pendingMedia = usePreviewMediaPending();

  const usingProxy =
    project != null &&
    visualClips.some((entry) => {
      if (entry.clip.source.type !== 'asset') return false;
      const source = entry.asset;
      return Boolean(
        source && 'proxy' in source && (source as Asset & { proxy?: unknown }).proxy,
      );
    });

  if (!project) {
    return <div className="preview-empty">Abrí un proyecto para ver la vista previa.</div>;
  }

  const aspect = project.video.width / Math.max(1, project.video.height);
  // Ajustar = min (imagen completa, puede dejar aire a los lados); Llenar = max
  // (cubre el visor, recorta de forma controlada por `overflow: hidden`).
  const fitWidth =
    stageSize.width > 0 && stageSize.height > 0
      ? Math.min(stageSize.width, stageSize.height * aspect)
      : 0;
  const fillWidth =
    stageSize.width > 0 && stageSize.height > 0
      ? Math.max(stageSize.width, stageSize.height * aspect)
      : 0;
  const frameWidth = monitorFill && !pixelPerfect ? fillWidth : fitWidth;
  const frameHeight = frameWidth > 0 ? frameWidth / aspect : 0;
  // «Llenar» genera un lienzo mayor que el panel. El grid centra los hijos
  // pequeños pero, por alineación segura, ancla a la izquierda los que
  // desbordan: el fotograma quedaba cortado siempre del mismo lado. En ese
  // caso se posiciona en el centro real del panel (left/top 50% +
  // translate(-50%,-50%)) para que el recorte sea simétrico.
  const oversized =
    !pixelPerfect &&
    stageSize.width > 0 &&
    (frameWidth > stageSize.width + 1 || frameHeight > stageSize.height + 1);
  // En pixel-perfect el lienzo mide los píxeles reales del frame, no el
  // tamaño ajustado a la etapa: la homografía debe usar ese mismo cuadro.
  const canvasWidth = pixelPerfect ? (realFrame?.width ?? project.video.width) : frameWidth;
  const canvasHeight = pixelPerfect ? (realFrame?.height ?? project.video.height) : frameHeight;
  const lookStyle = compare ? {} : effectsToCss(project.look, gradeFilterId('project-look'));
  const lookFilter = typeof lookStyle.filter === 'string' ? lookStyle.filter : '';
  const previewStyle: CSSProperties =
    compare || !adjustmentFilter
      ? lookStyle
      : {
          ...lookStyle,
          filter: [adjustmentFilter, lookFilter].filter(Boolean).join(' '),
        };

  const currentRatioPreset = FORMAT_PRESETS.find(
    (p) => p.width === project.video.width && p.height === project.video.height,
  );

  function handleRatioChange(presetId: string): void {
    const target = FORMAT_PRESETS.find((p) => p.id === presetId);
    if (!target) return;
    store.update((current) =>
      updateProjectSettings(current, {
        width: target.width,
        height: target.height,
      }),
    );
    store.setNotice(`Formato cambiado a ${target.label} (${target.width}×${target.height}).`);
  }

  function toggleFullscreen(): void {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

  function changeZoom(delta: number): void {
    setMonitorZoom((current) => {
      const next = Math.max(0.5, Math.min(3, Math.round((current + delta) * 10) / 10));
      if (next === 1) setMonitorPan({ x: 0, y: 0 });
      return next;
    });
  }

  async function renderRealFrame(native = false): Promise<PreviewFrameResult | null> {
    const target = visualClips[visualClips.length - 1];
    if (!project || !target || realFrameBusy) return null;
    setRealFrameBusy(true);
    // El render FFmpeg del frame también cuenta como preview pendiente
    // (paridad `prontidao.js`: el HUD «Cargando…» cubre renders en vuelo).
    reportPreviewMedia('frame-real', false);
    try {
      const result = await store.service.renderPreviewFrame({
        project,
        clipId: target.clip.id,
        frame: playhead,
        native,
      });
      setRealFrame(result);
      // Primera rebanada del agendador: pre-calienta el caché por firma
      // con los frames vecinos del clip para que el paso de ±1/±2 sea
      // instantáneo. Best-effort y cancelable — nunca bloquea la UI.
      const token = ++prewarmToken.current;
      void prewarmFramesAround(
        (request) => store.service.renderPreviewFrame(request),
        { project, clipId: target.clip.id, frame: playhead, native },
        {
          minFrame: target.clip.startFrame,
          maxFrame: target.clip.startFrame + target.clip.durationFrames - 1,
        },
        () => prewarmToken.current !== token,
      );
      return result;
    } catch (failure) {
      store.setNotice(
        failure instanceof Error
          ? failure.message
          : 'no se pudo renderizar el frame real',
      );
      return null;
    } finally {
      reportPreviewMedia('frame-real', true);
      setRealFrameBusy(false);
    }
  }

  /// «Capturar cuadro» (paridad `CapturarImagem` de AlaukCut): compone el
  /// frame del playhead con el renderer real (todas las pistas, subtítulos
  /// y look) y lo importa a Medios como imagen. El PNG vive en la caché del
  /// preview; `importMediaPaths` lo copia al proyecto antes de registrar el
  /// asset, así la caché se puede limpiar sin romper el medio.
  async function captureFrame(): Promise<void> {
    const target = visualClips[visualClips.length - 1];
    if (!project || !target || captureBusy) return;
    setCaptureBusy(true);
    reportPreviewMedia('frame-capture', false);
    try {
      const result = await store.service.renderPreviewFrame({
        project,
        clipId: target.clip.id,
        frame: playhead,
        composite: true,
      });
      const outcome = await store.service.importMediaPaths({
        paths: [result.path],
        fpsNum: project.video.frameRate.num,
        fpsDen: project.video.frameRate.den,
        confirmRights: true,
        provider: 'capture',
      });
      const asset = outcome.assets[0];
      if (!asset) {
        store.setNotice(outcome.warnings[0] ?? 'no se pudo importar el cuadro capturado');
        return;
      }
      store.update((current) => addAsset(current, asset), {
        notice: `Cuadro capturado en el playhead: ${asset.label}.`,
      });
    } catch (failure) {
      store.setNotice(
        failure instanceof Error ? failure.message : 'no se pudo capturar el cuadro',
      );
    } finally {
      reportPreviewMedia('frame-capture', true);
      setCaptureBusy(false);
    }
  }

  async function showPixelPerfect(): Promise<void> {
    if (!project) return;
    if (pixelPerfect) {
      setPixelPerfect(false);
      return;
    }
    // El modo 1:1 inspecciona píxeles del medio: si el frame visible se
    // renderizó al tamaño del lienzo, se pide de nuevo a resolución nativa.
    const frame =
      realFrame?.native === true ? realFrame : await renderRealFrame(true);
    if (!frame) return;
    setPixelPerfect(true);
    setMonitorZoom(1);
    setMonitorPan({ x: 0, y: 0 });
  }

  // Selector de calidad: «Automática» delega en la telemetría de
  // reproducción; «1:1 nativo» es el frame real pixel-perfect; el resto
  // vuelve al comportamiento por defecto (proxy aplicado si existe).
  function handleQualityChange(value: string): void {
    if (value === 'full') {
      setAutoQuality(false);
      if (!pixelPerfect) void showPixelPerfect();
      return;
    }
    setAutoQuality(value === 'auto');
    if (pixelPerfect) setPixelPerfect(false);
  }

  return (
    <div
      className={`preview-stage${pixelPerfect ? ' pixel-perfect' : ''}${monitorFill ? ' fill' : ''}`}
      data-compare={compare ? 'true' : undefined}
      ref={stageRef}
    >
      {/* Barra superior del monitor: el HUD y las herramientas comparten una
          sola fila flex. Antes eran dos capas absolutas independientes y el
          chip «Vista previa aproximada» quedaba tapado por el selector de
          formato en cuanto la ventana se achicaba. */}
      <div className="preview-topbar">
        <div className="preview-hud" aria-hidden="true">
          <span className="preview-hud-chip strong">
            {project.video.width}×{project.video.height}
          </span>
          <span className="preview-hud-chip">{fps} fps</span>
          <span className="preview-hud-chip preview-hud-render" title="El render final usa FFmpeg">
            Vista previa aproximada
          </span>
          {pixelPerfect && realFrame ? (
            <span
              className="preview-hud-chip strong"
              title={`Frame decodificado con ${realFrame.decoder === 'video-rs' ? 'video-rs en proceso' : 'FFmpeg'}`}
            >
              1:1 {realFrame.native ? 'nativo' : ''} · {realFrame.width}×{realFrame.height}
            </span>
          ) : null}
          {usingProxy ? (
            <span className="preview-hud-chip proxy" title="La preview usa un proxy; el MP4 usa el original">
              PROXY
            </span>
          ) : null}
          {pendingMedia > 0 ? (
            <span
              className="preview-hud-chip proxy"
              title="Hay medios visibles cargando datos; la imagen puede verse incompleta hasta que terminen"
            >
              Cargando…
            </span>
          ) : null}
          {autoQuality ? (
            <span
              className="preview-hud-chip"
              title="Calidad adaptativa: la telemetría de reproducción elige entre el original y el proxy por capa (patrón adaptive quality de Kloicut)"
            >
              Auto
              {playing && telemetry.fps > 0 ? ` · ${telemetry.fps} fps` : ''}
              {` · ${telemetry.quality === 'full' ? 'original' : 'proxy'}`}
            </span>
          ) : null}
        </div>
        {/* Capturas 95/103/104/105: pestañas de fuente y «Calidad total».
            «Origen» activa el comparador real; «Calidad total» pide el frame
            1:1 nativo mediante `showPixelPerfect`. Nada decorativo. */}
        <div className="preview-source-tabs" role="tablist" aria-label="Fuente del visor">
          <button
            type="button"
            role="tab"
            aria-selected={!compare}
            className={compare ? '' : 'active'}
            onClick={() => setCompare(false)}
          >
            Línea de tiempo
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={compare}
            className={compare ? 'active' : ''}
            onClick={() => setCompare(true)}
          >
            Origen
          </button>
        </div>
        <select
          className="preview-quality-select"
          value={pixelPerfect ? 'full' : autoQuality ? 'auto' : 'performance'}
          aria-label="Calidad de la vista previa"
          title="Automática adapta original/proxy según el rendimiento medido; calidad total inspecciona el frame a resolución nativa"
          onChange={(event) => handleQualityChange(event.target.value)}
        >
          <option value="auto">Automática</option>
          <option value="performance">Calidad total</option>
          <option value="full">1:1 nativo</option>
        </select>
        <div className="preview-tools">
          <select
            className="preview-ratio-select"
            value={currentRatioPreset?.id ?? 'custom'}
            onChange={(e) => handleRatioChange(e.target.value)}
            title="Relación de aspecto (16:9, 9:16 vertical TikTok, 1:1, etc.)"
            aria-label="Relación de aspecto"
          >
            {FORMAT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label.split(' ')[0]} ({preset.width > preset.height ? '16:9' : preset.width < preset.height ? '9:16' : '1:1'})
              </option>
            ))}
            {!currentRatioPreset && (
              <option value="custom">Personalizado ({project.video.width}×{project.video.height})</option>
            )}
          </select>
          <button
            type="button"
            className={compare ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={compare}
            aria-label="Comparar con el original"
            title="Comparar con el original: oculta color, transformación, subtítulos y guías"
            onClick={() => setCompare((value) => !value)}
          >
            <Icon name="eye" size={13} />
            <span>Comparar</span>
          </button>
          <button
            type="button"
            className={realFrame ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={Boolean(realFrame)}
            aria-label="Frame real compuesto de la timeline"
            title="Compone con FFmpeg las pistas visibles, los subtítulos y el look en el playhead; una transición, un fade o un gráfico activo pueden tardar más o mostrar el clip"
            onClick={() => void renderRealFrame()}
            disabled={realFrameBusy || visualClips.length === 0}
          >
            <Icon name="sparkles" size={13} />
            <span>{realFrameBusy ? 'Render…' : 'Frame real'}</span>
          </button>
          <button
            type="button"
            className="preview-tool"
            aria-label="Capturar el cuadro del playhead a Medios"
            title="Capturar cuadro: compone el frame del playhead con el renderer real y lo agrega a Medios"
            onClick={() => void captureFrame()}
            disabled={captureBusy || visualClips.length === 0}
          >
            <Icon name="camera" size={13} />
            <span>{captureBusy ? 'Capturando…' : 'Capturar'}</span>
          </button>
          <button
            type="button"
            className={doodleArmed ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={doodleArmed}
            aria-label="Dibujar a mano sobre el frame"
            title="Dibujar: trazá libre sobre el monitor y al soltar se crea un gráfico de línea en el playhead"
            onClick={() => setDoodleArmed(!doodleArmed)}
          >
            <Icon name="pencil" size={13} />
            <span>Dibujar</span>
          </button>
          {doodleArmed ? (
            <>
              <input
                type="color"
                className="preview-doodle-color"
                value={getDoodleStyle().color}
                aria-label="Color del trazo"
                title="Color del trazo"
                onChange={(event) =>
                  setDoodleStyle(event.target.value, getDoodleStyle().width)
                }
              />
              <select
                className="preview-doodle-width"
                value={String(getDoodleStyle().width)}
                aria-label="Grosor del trazo"
                title="Grosor del trazo"
                onChange={(event) =>
                  setDoodleStyle(getDoodleStyle().color, Number(event.target.value))
                }
              >
                <option value="0.008">Fino</option>
                <option value="0.018">Medio</option>
                <option value="0.04">Grueso</option>
              </select>
            </>
          ) : null}
          <button
            type="button"
            className={showGuides ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={showGuides}
            aria-label="Guías de composición"
            title="Guías de composición"
            onClick={() => setShowGuides((value) => !value)}
          >
            <Icon name="grid" size={13} />
            <span>Guías</span>
          </button>
          <select
            className="preview-safearea-select"
            value={safeAreaPreset}
            aria-label="Guía de área segura por plataforma"
            title="Guía de área segura: zonas que la interfaz de cada plataforma tapa"
            onChange={(e) => {
              const next = e.target.value as SafeAreaPresetId;
              setSafeAreaPreset(next);
              updateEditorPreferences({ safeAreaPreset: next });
            }}
          >
            {SAFE_AREA_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={showScopes ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={showScopes}
            aria-label="Scopes de color"
            title="Onda, vectorscopio e histograma del clip visual activo"
            onClick={() => setShowScopes((value) => !value)}
          >
            <Icon name="palette" size={13} />
            <span>Scopes</span>
          </button>
          <button
            type="button"
            className={showAudioScopes ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={showAudioScopes}
            aria-label="Scopes de audio del monitor"
            title="Oscilograma y espectro del audio ya mezclado por la preview"
            onClick={() => setShowAudioScopes((value) => !value)}
          >
            <Icon name="volume" size={13} />
            <span>Audio</span>
          </button>
          <button
            type="button"
            className={monitorFill ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={monitorFill}
            aria-label={monitorFill ? 'Ajustar el video completo' : 'Llenar el monitor con el video'}
            title={
              monitorFill
                ? 'Ajustar: imagen completa (puede dejar franjas del color del panel)'
                : 'Llenar: cubre el visor sin franjas y recorta los bordes del video'
            }
            onClick={() => {
              setMonitorFill((current) => !current);
              setPixelPerfect(false);
              setMonitorZoom(1);
              setMonitorPan({ x: 0, y: 0 });
            }}
          >
            <span>{monitorFill ? 'Ajustar' : 'Llenar'}</span>
          </button>
          <button
            type="button"
            className={pixelPerfect ? 'preview-tool active' : 'preview-tool'}
            aria-pressed={pixelPerfect}
            aria-label="Monitor 1:1 en píxeles"
            title="Decodifica el frame a la resolución nativa del medio (video-rs, con FFmpeg de respaldo) y lo muestra 1:1 con scroll"
            onClick={() => void showPixelPerfect()}
            disabled={realFrameBusy}
          >
            <span>1:1</span>
          </button>
          <button
            type="button"
            className="preview-tool"
            aria-label="Alejar monitor"
            title="Alejar monitor"
            onClick={() => changeZoom(-0.5)}
            disabled={pixelPerfect || monitorZoom <= 0.5}
          >
            <Icon name="minus" size={13} />
          </button>
          <button
            type="button"
            className="preview-tool"
            aria-label="Ajustar monitor al 100 %"
            title="Ajustar monitor al 100 %"
            onClick={() => {
              setPixelPerfect(false);
              setMonitorZoom(1);
              setMonitorPan({ x: 0, y: 0 });
            }}
          >
            <span>{Math.round(monitorZoom * 100)}%</span>
          </button>
          <button
            type="button"
            className="preview-tool"
            aria-label="Acercar monitor"
            title="Acercar monitor"
            onClick={() => changeZoom(0.5)}
            disabled={pixelPerfect || monitorZoom >= 3}
          >
            <Icon name="plus" size={13} />
          </button>
          <button
            type="button"
            className="preview-tool"
            aria-label="Pantalla completa"
            title="Pantalla completa"
            onClick={toggleFullscreen}
          >
            <Icon name="fullscreen" size={13} />
            <span>Pantalla</span>
          </button>
        </div>
      </div>
      {showScopes ? (
        <ScopesPanel
          stageRef={stageRef}
          realFramePath={realFrame?.path ?? null}
          analyzeScopes={(path) => store.service.analyzeScopesFrame({ path })}
          onClose={() => setShowScopes(false)}
        />
      ) : null}
      {showAudioScopes ? (
        <PreviewAudioScopes onClose={() => setShowAudioScopes(false)} />
      ) : null}
      <div
        className={`preview-canvas${monitorZoom !== 1 ? ' zoomed' : ''}${panning ? ' panning' : ''}${selectedClip && isTransformable(selectedClip) && frameWidth > 0 ? ' has-selection' : ''}`}
        style={{
          ...(oversized ? { position: 'absolute' as const, left: '50%', top: '50%' } : {}),
          width: pixelPerfect
            ? (realFrame?.width ?? project.video.width)
            : frameWidth > 0
              ? frameWidth
              : '100%',
          height: pixelPerfect
            ? (realFrame?.height ?? project.video.height)
            : frameHeight > 0
              ? frameHeight
              : undefined,
          aspectRatio: `${project.video.width} / ${project.video.height}`,
          backgroundColor: project.video.backgroundColor ?? '#0b0e13',
          transform: pixelPerfect
            ? undefined
            : `${oversized ? 'translate(-50%, -50%) ' : ''}scale(${monitorZoom}) translate(${monitorPan.x}px, ${monitorPan.y}px)`,
          cursor:
            !pixelPerfect && monitorZoom !== 1
              ? panning
                ? 'grabbing'
                : 'grab'
              : undefined,
        }}
        onPointerDown={(event) => {
          if (pixelPerfect || monitorZoom === 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerMove={(event) => {
          if (!panning) return;
          setMonitorPan((current) => ({
            x: current.x + event.movementX / monitorZoom,
            y: current.y + event.movementY / monitorZoom,
          }));
        }}
        onPointerUp={(event) => {
          setPanning(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => setPanning(false)}
      >
        <GradeFilterDefs specs={gradeSpecs} />
        <div
          className="preview-look"
          style={previewStyle}
          onPointerDown={(event) => {
            const target = (event.target as HTMLElement).closest('[data-clip-id]');
            const id = target?.getAttribute('data-clip-id');
            if (id) store.setSelection({ kind: 'clip', id });
          }}
        >
          {visualClips.map((entry) => {
            const { clip, asset, track } = entry;
            const transition = previewTransitionFrame(clip, playhead, fps);
            const layer =
              clip.kind === 'video' ? (
                <VideoLayer
                  clip={clip}
                  asset={asset}
                  project={project}
                  playheadFrame={playhead}
                  playing={playing}
                  playbackRate={playback.rate * playback.direction}
                  muted={!track || !isTrackAudible(track, project.timeline.tracks)}
                  trackId={track ? track.id : ''}
                  trackGain={track ? trackGainDb(track) : 0}
                  viewport={previewViewport(asset, canvasWidth, canvasHeight)}
                />
              ) : clip.kind === 'image' || clip.kind === 'freeze' ? (
                <ImageLayer
                  clip={clip}
                  asset={asset}
                  project={project}
                  playheadFrame={playhead}
                  viewport={previewViewport(asset, canvasWidth, canvasHeight)}
                />
              ) : clip.kind === 'graphic' ? (
                <GraphicLayer
                  clip={clip}
                  project={project}
                  playheadFrame={playhead}
                  viewport={previewViewport(undefined, canvasWidth, canvasHeight)}
                />
              ) : null;
            if (!layer) return null;
            if (!transition) return <Fragment key={clip.id}>{layer}</Fragment>;
            const transitionStyle: CSSProperties = { ...transition.style };
            if (isLumaWipeClip(clip)) {
              // La máscara es la luma del mate cuadro a cuadro (alphamerge del
              // render). Sin máscara lista la capa queda invisible durante el
              // lead: mismo resultado que el corte anterior, nunca inventada.
              const maskUrl = lumaMasks.get(clip.id);
              if (maskUrl) {
                Object.assign(transitionStyle, lumaMaskStyle(maskUrl));
              } else {
                transitionStyle.opacity = 0;
              }
            }
            return (
              <Fragment key={clip.id}>
                {transition.underlay ? (
                  <div
                    className="preview-transition-underlay"
                    style={{ background: transition.underlay }}
                  />
                ) : null}
                <div className="preview-transition-layer" style={transitionStyle}>
                  {layer}
                </div>
              </Fragment>
            );
          })}
          {visualClips.map(({ clip, asset }) =>
            clip.monitorFrame ? (
              <div
                key={`frame-${clip.id}`}
                data-clip-id={clip.id}
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  ...transformStyle(
                    clip,
                    project,
                    playhead,
                    previewViewport(asset, canvasWidth, canvasHeight),
                  ),
                }}
              >
                <MonitorFrameSvg
                  frame={clip.monitorFrame}
                  viewport={previewViewport(asset, frameWidth, frameHeight)}
                />
              </div>
            ) : null,
          )}
          {visualClips.map(({ clip, asset }) => {
            // Trazo de máscara (paridad «mask stroke» de molduras.js):
            // overlay SVG con el contorno de la forma. `transformStyle`
            // ya lleva la máscara del clip, así que el trazo queda
            // recortado a la región visible igual que el geq del render
            // (por dentro sin invert, por fuera con invert).
            const mask =
              'mask' in clip ? (clip as Clip & { mask?: ClipMask }).mask : undefined;
            if (!mask?.strokeColor || !(mask.strokeWidth && mask.strokeWidth > 0)) {
              return null;
            }
            const sampledMask = mask.keyframes
              ? sampleMaskKeyframes(
                  mask.keyframes,
                  Math.max(
                    0,
                    Math.min(clip.durationFrames - 1, playhead - clip.startFrame),
                  ),
                )
              : {};
            const effectiveMask = { ...mask, ...sampledMask };
            const strokeSvg = maskStrokeSvg(effectiveMask);
            if (!strokeSvg) return null;
            return (
              <div
                key={`mask-stroke-${clip.id}`}
                data-clip-id={clip.id}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  ...transformStyle(
                    clip,
                    project,
                    playhead,
                    previewViewport(asset, canvasWidth, canvasHeight),
                  ),
                  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(strokeSvg)}")`,
                  backgroundSize: '100% 100%',
                  backgroundRepeat: 'no-repeat',
                }}
              />
            );
          })}
        </div>
        {audioClips.map((entry) => {
          const { clip, asset, track } = entry;
          return (
            <AudioLayer
              key={clip.id}
              clip={clip}
              asset={asset}
              project={project}
              playheadFrame={playhead}
              playing={playing}
              playbackRate={playback.rate * playback.direction}
              trackId={track ? track.id : ''}
              trackGain={track ? trackGainDb(track) : 0}
            />
          );
        })}
        {spectrumOverlays.map(({ clipId, spec }, index) => {
          const widthFrac = Math.min(1, Math.max(0.1, spec.width ?? 1));
          const heightFrac = Math.min(0.6, Math.max(0.05, spec.height ?? 0.28));
          const xOffset = Math.min(1, Math.max(-1, spec.x ?? 0));
          const yLift = Math.min(0.95, Math.max(0, spec.y ?? 0));
          const span = 1 - widthFrac;
          const leftFrac = span / 2 + xOffset * (span / 2);
          const topFrac = 1 - heightFrac - yLift;
          const boxStyle = {
            left: `${leftFrac * 100}%`,
            top: `${topFrac * 100}%`,
            width: `${widthFrac * 100}%`,
            height: `${heightFrac * 100}%`,
          };
          const selected = selection.kind === 'clip' && selection.id === clipId;
          const applySpec = (
            patch: NonNullable<ClipEffects['spectrum']>,
            history: boolean,
          ): void => {
            store.update(
              (current) => {
                const clipNow = current.timeline.clips.find(
                  (item) => item.id === clipId,
                );
                const baseEffects = (
                  clipNow && 'effects' in clipNow ? clipNow.effects : undefined
                ) as ClipEffects | undefined;
                // Merge sobre el spec vigente en el documento: los updates
                // `history:false` del arrastre re-renderizan y `spec` del
                // closure puede atrasarse.
                return updateClip(current, clipId, {
                  effects: {
                    ...(baseEffects ?? {}),
                    spectrum: { ...(baseEffects?.spectrum ?? {}), ...patch },
                  },
                });
              },
              { history },
            );
          };
          return (
            <Fragment key={`spectrum-${index}`}>
              <div className="preview-spectrum" style={boxStyle}>
                <PreviewSpectrum spec={spec} />
              </div>
              {selected ? (
                <PreviewSpectrumRegion
                  spec={spec}
                  onLive={(patch) => applySpec(patch, false)}
                  onCommit={(patch) => applySpec(patch, true)}
                />
              ) : null}
            </Fragment>
          );
        })}
        <CaptionOverlay project={project} playheadFrame={playhead} previewWidth={frameWidth} />
        {selectedClip && isTransformable(selectedClip) && frameWidth > 0 ? (
          <PreviewTransformBox
            clip={selectedClip}
            project={project}
            playheadFrame={playhead}
            canvas={{ width: frameWidth, height: frameHeight }}
          />
        ) : null}
        {selectedClip &&
        isTransformable(selectedClip) &&
        selectedClip.transform?.perspective &&
        frameWidth > 0 ? (
          <PerspectiveHandles
            clip={selectedClip}
            project={project}
            playheadFrame={playhead}
            canvas={{ width: frameWidth, height: frameHeight }}
            viewport={previewViewport(
              visualClips.find((entry) => entry.clip.id === selectedClip.id)?.asset,
              frameWidth,
              frameHeight,
            )}
          />
        ) : null}
        {maskDrawClip ? (
          <div
            className="preview-mask-draw"
            onPointerDown={(event) => {
              if (maskStrokeRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              const rect = event.currentTarget.getBoundingClientRect();
              const point = {
                x: Math.min(
                  1,
                  Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
                ),
                y: Math.min(
                  1,
                  Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)),
                ),
              };
              maskStrokeRef.current = [point];
              setMaskStroke([point]);
            }}
            onPointerMove={(event) => {
              const points = maskStrokeRef.current;
              if (!points || points.length === 0) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const last = points[points.length - 1]!;
              const x = Math.min(
                1,
                Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
              );
              const y = Math.min(
                1,
                Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)),
              );
              if (Math.hypot(x - last.x, y - last.y) < 0.004) return;
              const next = [...points, { x, y }];
              maskStrokeRef.current = next;
              setMaskStroke(next);
            }}
            onPointerUp={() => {
              const points = maskStrokeRef.current;
              maskStrokeRef.current = null;
              setMaskStroke(null);
              if (!points || points.length < 3 || !project) return;
              // Pantalla → espacio local del clip (espejo del transform).
              const local = points.map((point) =>
                maskDrawPointToLocal(point, maskDrawClip, project, playhead),
              );
              const smoothed = smoothMaskStroke(local);
              if (smoothed.length < 3) return;
              const existing =
                'mask' in maskDrawClip ? (maskDrawClip.mask as ClipMask | undefined) : undefined;
              store.update((current) =>
                updateClip(current, maskDrawClip.id, {
                  mask: {
                    shape: 'freehand',
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                    // La máscara de contorno (`polygon`/`freehand`) usa
                    // puntos absolutos + offset x/y; el render les aplica
                    // el mismo feather por distancia con signo que la
                    // preview SVG, así que se conserva el feather previo.
                    feather: existing?.feather ?? 0.08,
                    invert: existing?.invert ?? false,
                    points: smoothed,
                  },
                }),
              );
              setMaskDrawArmed(false);
            }}
            onPointerCancel={() => {
              maskStrokeRef.current = null;
              setMaskStroke(null);
            }}
            onLostPointerCapture={() => {
              maskStrokeRef.current = null;
              setMaskStroke(null);
            }}
          >
            {maskStrokePreview && maskStrokePreview.length > 1 ? (
              <svg
                className="preview-mask-draw-svg"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  points={maskStrokePreview
                    .map((point) => `${point.x * 100},${point.y * 100}`)
                    .join(' ')}
                />
              </svg>
            ) : null}
            <span className="preview-mask-draw-hint">
              {maskStroke ? 'Soltá para aplicar la máscara' : 'Dibujá la máscara con plumilla sobre el clip y soltá'}
            </span>
          </div>
        ) : null}
        {doodleArmed && project ? (
          <div
            className="preview-mask-draw preview-doodle-draw"
            onPointerDown={(event) => {
              if (doodleStrokeRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              const rect = event.currentTarget.getBoundingClientRect();
              const hand = doodleHandRef.current;
              if (hand) {
                hand.style.opacity = '1';
                hand.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px)`;
              }
              const point = {
                x: Math.min(
                  1,
                  Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
                ),
                y: Math.min(
                  1,
                  Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)),
                ),
              };
              doodleStrokeRef.current = [point];
              setDoodleStroke([point]);
            }}
            onPointerLeave={() => {
              if (doodleHandRef.current) doodleHandRef.current.style.opacity = '0';
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const hand = doodleHandRef.current;
              if (hand) {
                hand.style.opacity = '1';
                hand.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px)`;
              }
              const points = doodleStrokeRef.current;
              if (!points || points.length === 0) return;
              const last = points[points.length - 1]!;
              const x = Math.min(
                1,
                Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)),
              );
              const y = Math.min(
                1,
                Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)),
              );
              if (Math.hypot(x - last.x, y - last.y) < 0.004) return;
              const next = [...points, { x, y }];
              doodleStrokeRef.current = next;
              setDoodleStroke(next);
            }}
            onPointerUp={() => {
              const points = doodleStrokeRef.current;
              doodleStrokeRef.current = null;
              setDoodleStroke(null);
              if (!points || points.length < 2 || !project) return;
              // Los puntos ya están en coordenadas de frame (0–1): la caja
              // del clip gráfico es el bounding box del trazo y los puntos
              // se normalizan dentro de ella.
              const minX = Math.min(...points.map((p) => p.x));
              const minY = Math.min(...points.map((p) => p.y));
              const maxX = Math.max(...points.map((p) => p.x));
              const maxY = Math.max(...points.map((p) => p.y));
              const boxW = Math.max(0.001, maxX - minX);
              const boxH = Math.max(0.001, maxY - minY);
              const normalized = simplifyMaskPoints(
                points.map((p) => ({
                  x: (p.x - minX) / boxW,
                  y: (p.y - minY) / boxH,
                })),
                16,
              );
              if (normalized.length < 2) return;
              const stroke = getDoodleStyle();
              const result = store.mutate((current) => {
                const added = addMotionGraphic(current, {
                  templateId: 'shape',
                  templateVersion: '1.0.0',
                  props: {
                    shape: 'line',
                    color: stroke.color,
                    strokeColor: stroke.color,
                    strokeWidth: stroke.width,
                    size: 1,
                    boxX: minX,
                    boxY: minY,
                    boxWidth: boxW,
                    boxHeight: boxH,
                    points: normalized,
                    animation: 'none',
                  },
                  durationFrames: Math.round(3 * fps),
                  atFrame: playhead,
                  label: 'Dibujo',
                });
                return { project: added.project };
              });
              // El modo sigue armado: se pueden encadenar varios trazos
              // (cada uno crea su clip); Escape desarma.
              if (result) store.setNotice('Dibujo agregado en el playhead.');
            }}
            onPointerCancel={() => {
              doodleStrokeRef.current = null;
              setDoodleStroke(null);
            }}
            onLostPointerCapture={() => {
              doodleStrokeRef.current = null;
              setDoodleStroke(null);
            }}
          >
            {doodleStroke && doodleStroke.length > 1 ? (
              <svg
                className="preview-mask-draw-svg"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polyline
                  points={doodleStroke
                    .map((point) => `${point.x * 100},${point.y * 100}`)
                    .join(' ')}
                  style={{ stroke: getDoodleStyle().color }}
                />
              </svg>
            ) : null}
            <span
              ref={doodleHandRef}
              className="preview-doodle-hand"
              aria-hidden="true"
            >
              ✍️
            </span>
            <span className="preview-mask-draw-hint">
              {doodleStroke
                ? 'Soltá para crear el dibujo'
                : 'Dibujá sobre el frame · Escape para salir'}
            </span>
          </div>
        ) : null}
        {realFrame ? (
          <div className="preview-real-frame-wrap">
            <img
              src={store.service.absoluteFileUrl(realFrame.path)}
              alt={`Frame real de ${realFrame.clipLabel}`}
            />
            <span
              className="preview-real-frame-badge"
              title={
                realFrame.native
                  ? 'Resolución nativa del medio, con efectos y LUT aplicados'
                  : realFrame.composite
                    ? `Compuesto de ${realFrame.visibleTracks ?? 1} pista(s) visible(s) en el playhead`
                    : realFrame.fallbackReason
                      ? `Compuesto no disponible: ${realFrame.fallbackReason}. Se muestra el clip seleccionado.`
                      : 'Resolución del lienzo del proyecto'
              }
            >
              {realFrame.decoder === 'video-rs' ? 'video-rs' : 'FFmpeg'}
              {realFrame.native
                ? ' nativo'
                : realFrame.composite
                  ? ' compuesto'
                  : realFrame.fallbackReason
                    ? ' clip'
                    : ''}{' '}
              · {realFrame.clipLabel} · {realFrame.width}×{realFrame.height}
            </span>
            <button
              type="button"
              className="preview-real-frame-close"
              aria-label="Cerrar frame real"
              onClick={() => setRealFrame(null)}
            >
              ×
            </button>
          </div>
        ) : null}
        {showGuides ? (
          safeArea.id === 'generic' ? (
            <div className="safe-guides" aria-hidden="true">
              <span className="safe-action" />
              <span className="safe-title" />
            </div>
          ) : (
            <div className="safe-guides safe-area-overlay" aria-hidden="true">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                {safeArea.cover.map((r, index) => (
                  <rect
                    key={index}
                    className="safe-cover"
                    x={r.x * 100}
                    y={r.y * 100}
                    width={r.w * 100}
                    height={r.h * 100}
                  />
                ))}
                <polygon className="safe-zone" points={safeAreaPointsAttr(safeArea.safe)} />
                {safeArea.title ? (
                  <polygon className="safe-title-zone" points={safeAreaPointsAttr(safeArea.title)} />
                ) : null}
              </svg>
              <span className="safe-area-label">
                {safeArea.label}
                {safeAreaMismatch ? ` · hecha para ${safeArea.aspectLabel}` : ''}
              </span>
            </div>
          )
        ) : null}
        {visualClips.length === 0 ? (
          <div className="preview-overlay">
            <strong>
              {project.timeline.clips.length === 0
                ? 'Timeline vacía'
                : `Sin imagen en el frame ${playhead}`}
            </strong>
            <span>
              {project.timeline.clips.length === 0
                ? 'Importá medios y montá un clip para empezar.'
                : 'Movés el playhead o agregás un clip visual en este punto.'}
            </span>
          </div>
        ) : null}
        {!playing ? (
          <button
            type="button"
            className="preview-start"
            aria-label="Start · reproducir video"
            title={
              visualClips.length > 0
                ? 'Reproducir el resultado de la edición (Espacio)'
                : 'Pedile a Olyvia que importe material para tener qué reproducir'
            }
            onClick={() => {
              if (visualClips.length === 0) {
                store.setNotice(
                  'Todavía no hay clips: pedile a Olyvia que importe material o cree el video.',
                );
                return;
              }
              store.setPlaying(true);
            }}
          >
            <Icon name="play" size={26} />
            <span>Start</span>
          </button>
        ) : null}
        <MediaSpyOverlay />
      </div>
    </div>
  );
});
