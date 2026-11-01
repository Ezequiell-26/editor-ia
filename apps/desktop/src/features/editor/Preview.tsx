import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Asset, BlendMode, CaptionCue, Clip, ClipEffects, ClipMask, ProjectDocument, Track } from '@editor-ia/project-schema';
import { sampleMaskKeyframes, hasCustomCurves } from '@editor-ia/project-schema';
import { hasColorWheels } from './color-wheels-preview';
import { motionPreview } from './motion-preview';
import { captionMotionAt } from '../../state/caption-motion';
import { PreviewTransformBox, isTransformable } from './PreviewTransformBox';
import { cueWordsAt } from '../../state/subtitles';
import { clipTimeRemap } from '../../state/time-remap';
import { transitionLeadFrames, transitionSample } from '../../state/transition';
import { effectsAtFrame } from '../../state/effect-animation';
import {
  adaptEffectsForPreview,
  getPreviewProfile,
  temporalDenoiseForProfile,
  usePreviewProfile,
} from '../effects/preview-profile';
import { effectsToCss } from './effects-to-css';
import {
  appendSharpenFilter,
  clampSharpen,
  sharpenFilterId,
  sharpenKernel,
} from './sharpen-preview';
import {
  appendGlowFilter,
  glowFilterId,
  glowStdDeviation,
  glowThresholdCurve,
  normalizeGlow,
  type GlowPreview,
} from './glow-preview';
import {
  appendGrainFilter,
  clampGrain,
  grainFilterId,
  grainMatrix,
} from './grain-preview';
import { EffectOverlay } from './EffectOverlay';
import { canUseWebGL2 } from './lut-renderer';
import { framesToSeconds, fpsOf, formatTimecode, clipGainAtFrame, clipTransformAtFrame, updateProjectSettings } from '../../state/project-actions';
import { FORMAT_PRESETS } from '../../state/video-format';
import {
  attachPreviewAudio,
  detachPreviewAudio,
  isTrackAudible,
  resumePreviewAudio,
  setPreviewClipPan,
  syncPreviewAudioFromProject,
  syncPreviewAudioAutomationAtFrame,
  trackGainDb,
} from '../mixer/usePreviewAudio';
import { useProjectStore } from '../../state/project-store';
import { loadEditorPreferences } from '../../state/editor-preferences';
import { Icon } from '../../components/Icon';
import { buildMotionPlan } from '../motion/plan';
import { MotionPreview } from '../motion/MotionPreview';
import { buildProjectMotionPlans } from '../motion/plan';
import { templateById } from '../motion/templates';
import { ScopesPanel } from './ScopesPanel';
import { usePreviewPerf } from '../perf/use-preview-perf';
import { perspectiveMatrix3d, type PerspectiveViewport } from './perspective';
import type { PreviewFrameResult } from '../../services/project-service';

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

function maskPolygon(
  mask: ClipMask,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): Array<readonly [number, number]> {
  if (mask.shape === 'polygon') {
    return (mask.points ?? []).map((point) => [
      point.x * 100 + mask.x * 100,
      point.y * 100 + mask.y * 100,
    ]);
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
  return [];
}

function maskClipPath(mask: ClipMask): string {
  const clamp = (value: number): number => Math.max(0, Math.min(100, value));
  if (mask.shape === 'text') {
    // CSS no puede recortar por glifos sin duplicar la fuente; la máscara real
    // se ve en Frame real/render, no en la preview aproximada.
    return 'none';
  }
  const centerX = clamp(50 + mask.x * 50);
  const centerY = clamp(50 + mask.y * 50);
  if (mask.shape === 'ellipse') {
    return `ellipse(${clamp(mask.width * 50)}% ${clamp(
      mask.height * 50,
    )}% at ${centerX}% ${centerY}%)`;
  }
  if (mask.shape === 'rectangle' || mask.shape === 'rounded') {
    const left = clamp(centerX - mask.width * 50);
    const top = clamp(centerY - mask.height * 50);
    const right = clamp(100 - (centerX + mask.width * 50));
    const bottom = clamp(100 - (centerY + mask.height * 50));
    const round =
      mask.shape === 'rounded'
        ? ` round ${clamp(mask.width * 12.5)}% / ${clamp(mask.height * 12.5)}%`
        : '';
    return `inset(${top}% ${right}% ${bottom}% ${left}%${round})`;
  }
  const points = maskPolygon(
    mask,
    centerX,
    centerY,
    mask.width * 50,
    mask.height * 50,
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
function maskImage(mask: ClipMask): string | undefined {
  const rotation = mask.shape === 'polygon' ? 0 : (mask.rotationDeg ?? 0);
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
  const radiusX = mask.width * 50;
  const radiusY = mask.height * 50;
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
          )
            .map(([x, y]) => `${x},${y}`)
            .join(' ')}" fill="${fill}" transform="${transform}" filter="url(#soft)"/>`;
  const backdrop = mask.invert ? '<rect width="100" height="100" fill="white"/>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${feather.toFixed(2)}"/></filter></defs>${backdrop}${shape}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
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

function transformStyle(
  clip: Clip,
  project: ProjectDocument,
  playheadFrame?: number,
  viewport?: PerspectiveViewport,
): CSSProperties {
  const transform = clip.transform;
  const sampled =
    playheadFrame === undefined
      ? null
      : clipTransformAtFrame(
          clip,
          Math.max(0, Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame)),
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
  const motion = 'motion' in clip ? clip.motion : undefined;
  const progress =
    playheadFrame === undefined
      ? 0
      : Math.max(0, Math.min(1, (playheadFrame - clip.startFrame) / Math.max(1, clip.durationFrames)));
  const sampledMotion = motion
    ? motionPreview(motion, progress)
    : { scale: 1, x: 0, y: 0 };
  const motionScale = sampledMotion.scale;
  const motionX = sampledMotion.x;
  const motionY = sampledMotion.y;
  const animation = animationState(clip, playheadFrame);
  const mask = 'mask' in clip ? (clip as Clip & { mask?: ClipMask }).mask : undefined;
  const sampledMask =
    mask?.keyframes && playheadFrame !== undefined
      ? sampleMaskKeyframes(
          mask.keyframes,
          Math.max(0, Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame)),
        )
      : {};
  const effectiveMask = mask ? { ...mask, ...sampledMask } : undefined;
  const image = effectiveMask ? maskImage(effectiveMask) : undefined;
  const perspective =
    transform?.perspective && viewport
      ? perspectiveMatrix3d(transform.perspective.corners, viewport)
      : undefined;
  // Transición entrante: la preview en vivo compone el solape con el clip
  // anterior igual que el export (alfa, desplazamiento, fundido o barrido).
  const transition =
    playheadFrame === undefined ? null : transitionSample(clip, playheadFrame, fpsOf(project));
  return {
    transform: `translate(${offsetX * 100}%, ${offsetY * 100}%) translate(${motionX + animation.x + (transition?.translateXPercent ?? 0)}%, ${motionY + animation.y + (transition?.translateYPercent ?? 0)}%) scale(${scaleX * motionScale * animation.scale}, ${scaleY * motionScale * animation.scale}) rotate(${rotation + animation.rotation}deg)${perspective ? ` ${perspective}` : ''}`,
    opacity: (sampled?.opacity ?? transform?.opacity ?? 1) * animation.opacity * (transition?.opacity ?? 1),
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
        : { clipPath: maskClipPath(effectiveMask) }
      : {}),
    ...(transition?.clipPath ? { clipPath: transition.clipPath } : {}),
  };
}

interface EffectFilterParts {
  /** Grade del clip que el export aplica antes del LUT. */
  readonly grade: string;
  /** Glow, grano, nitidez y transición, que van después del LUT. */
  readonly extras: string;
}

/** Efectos que el shader aplica y por lo tanto se omiten del CSS. */
interface EffectFilterOmit {
  readonly wheels?: boolean;
  readonly temperature?: boolean;
  readonly contrast?: boolean;
  readonly saturation?: boolean;
  readonly hue?: boolean;
  readonly grayscale?: boolean;
  readonly sepia?: boolean;
  readonly tone?: boolean;
  readonly colorMatch?: boolean;
  readonly hsl?: boolean;
}

function effectFilterParts(
  clip: Clip,
  playheadFrame?: number,
  project?: ProjectDocument,
  omit: EffectFilterOmit = {},
): EffectFilterParts {
  const effects =
    playheadFrame !== undefined
      ? effectsAtFrame(clip, playheadFrame)
      : 'effects' in clip
        ? clip.effects
        : undefined;
  const adapted = adaptEffectsForPreview(effects, getPreviewProfile());
  const base = adapted
    ? effectsToCss(adapted, {
        colorWheels: !omit.wheels,
        brightness: !omit.wheels,
        temperature: !omit.temperature,
        contrast: !omit.contrast,
        saturation: !omit.saturation,
        hue: !omit.hue,
        grayscale: !omit.grayscale,
        sepia: !omit.sepia,
        tone: !omit.tone,
        colorMatch: !omit.colorMatch,
        hsl: !omit.hsl,
      })
    : {};
  const transition =
    project && playheadFrame !== undefined
      ? transitionSample(clip, playheadFrame, fpsOf(project))
      : null;
  const grade = typeof base.filter === 'string' ? base.filter : '';
  let extras = '';
  extras = appendSharpenFilter(extras, clip.id, clampSharpen(adapted?.sharpen));
  extras = appendGlowFilter(
    extras,
    clip.id,
    adapted?.glow ? normalizeGlow(adapted.glow) : undefined,
  );
  extras = appendGrainFilter(extras, clip.id, adapted?.grain);
  if (transition?.filter) {
    extras = extras ? `${extras} ${transition.filter}` : transition.filter;
  }
  return { grade, extras };
}

function effectsStyle(clip: Clip, playheadFrame?: number, project?: ProjectDocument): CSSProperties {
  const { grade, extras } = effectFilterParts(clip, playheadFrame, project);
  const filter = [grade, extras].filter(Boolean).join(' ');
  return filter ? { filter } : {};
}

/** Grade del look global. El export lo aplica entre ambos LUT. */
function lookGradeFilterOf(
  project: ProjectDocument,
  omitWheels = false,
  omitShaderStages = false,
  omitTone = false,
  omitColorMatch = false,
  omitHsl = false,
): string {
  const style = effectsToCss(project.look, {
    ...(omitWheels ? { colorWheels: false, brightness: false } : {}),
    ...(omitShaderStages
      ? {
          temperature: false,
          contrast: false,
          saturation: false,
          hue: false,
          grayscale: false,
          sepia: false,
        }
      : {}),
    ...(omitTone ? { tone: false } : {}),
    ...(omitColorMatch ? { colorMatch: false } : {}),
    ...(omitHsl ? { hsl: false } : {}),
  });
  return typeof style.filter === 'string' ? style.filter : '';
}

/** Etapas del look que el shader puede aplicar con la fórmula del export. */
interface LookShaderGrade {
  readonly contrast?: number | undefined;
  readonly saturation?: number | undefined;
  readonly hueRotateDeg?: number | undefined;
  readonly temperature?: number | undefined;
  readonly grayscale?: boolean | undefined;
  readonly sepia?: boolean | undefined;
}

/** Ganancia por canal del colorMatch, igual a `colorchannelmixer` del export. */
function colorMatchGain(
  match: ClipEffects['colorMatch'] | undefined,
): [number, number, number] | null {
  if (!match) return null;
  const strength = Math.min(1, Math.max(0, match.strength));
  if (strength <= 0.001) return null;
  const gain = (value: number): number =>
    1 + (Math.min(4, Math.max(0.25, value)) - 1) * strength;
  const gains: [number, number, number] = [gain(match.r), gain(match.g), gain(match.b)];
  return gains.some((value) => Math.abs(value - 1) > 0.0005) ? gains : null;
}

/**
 * HSL portado al shader: matriz completa y máscara de colores del filtro
 * (`huesaturation` con strength=100). El CSS sólo queda para sin WebGL2/eficiente.
 */
function hslShaderInput(
  hsl: ClipEffects['hsl'] | undefined,
): {
  hue: number;
  saturation: number;
  intensity: number;
  colors?: readonly string[] | undefined;
} | null {
  if (!hsl) return null;
  const active =
    Math.abs(hsl.hue) > 0.01 ||
    Math.abs(hsl.saturation) > 0.001 ||
    Math.abs(hsl.intensity) > 0.001;
  if (!active) return null;
  return {
    hue: hsl.hue,
    saturation: hsl.saturation,
    intensity: hsl.intensity,
    colors: hsl.colors,
  };
}

function lookShaderGradeOf(
  project: ProjectDocument,
  enabled: boolean,
): LookShaderGrade | null {
  if (!enabled || !project.look) return null;
  const look = project.look;
  const active =
    (look.contrast !== undefined && Math.abs(look.contrast - 1) > 0.001) ||
    (look.saturation !== undefined && Math.abs(look.saturation - 1) > 0.001) ||
    (look.hueRotateDeg !== undefined && Math.abs(look.hueRotateDeg) > 0.01) ||
    (look.temperature !== undefined && Math.abs(look.temperature) > 0.001) ||
    look.grayscale === true ||
    look.sepia === true;
  if (!active) return null;
  return {
    contrast: look.contrast,
    saturation: look.saturation,
    hueRotateDeg: look.hueRotateDeg,
    temperature: look.temperature,
    grayscale: look.grayscale,
    sepia: look.sepia,
  };
}

/**
 * Aplica el grade del look sobre una capa de video/imagen cuando no hay
 * `EffectOverlay` que lo inserte entre el LUT del clip y el del look.
 */
function withLookGrade(style: CSSProperties, lookGrade: string): CSSProperties {
  if (!lookGrade) return style;
  const base = typeof style.filter === 'string' ? style.filter : '';
  return { ...style, filter: [base, lookGrade].filter(Boolean).join(' ') };
}

function svgFilterSpecAt(
  clip: Clip,
  playheadFrame: number,
): {
  readonly sharpen: number;
  readonly glow: GlowPreview | undefined;
  readonly grain: number;
} {
  if (!('effects' in clip) || !clip.effects) {
    return { sharpen: 0, glow: undefined, grain: 0 };
  }
  const adapted = adaptEffectsForPreview(
    effectsAtFrame(clip, playheadFrame),
    getPreviewProfile(),
  );
  return {
    sharpen: clampSharpen(adapted?.sharpen),
    glow: adapted?.glow ? normalizeGlow(adapted.glow) : undefined,
    grain: clampGrain(adapted?.grain),
  };
}

/** Definiciones SVG que respaldan `filter: url(#…)` de nitidez y glow. */
function PreviewSvgFilters({
  clips,
  playheadFrame,
}: {
  readonly clips: readonly Clip[];
  readonly playheadFrame: number;
}) {
  const filters = clips
    .map((clip) => ({ id: clip.id, ...svgFilterSpecAt(clip, playheadFrame) }))
    .filter(
      (item) =>
        item.sharpen > 0.01 ||
        (item.glow?.intensity ?? 0) > 0.01 ||
        item.grain > 0.01,
    );
  if (filters.length === 0) return null;
  return (
    <svg className="preview-filter-defs" aria-hidden="true" focusable="false">
      <defs>
        {filters.map(({ id, sharpen, glow, grain }) => (
          <g key={id}>
            {sharpen > 0.01 ? (
              <filter
                id={sharpenFilterId(id)}
                x="0"
                y="0"
                width="100%"
                height="100%"
                colorInterpolationFilters="sRGB"
              >
                <feConvolveMatrix
                  order="3"
                  kernelMatrix={sharpenKernel(sharpen)}
                  divisor="1"
                  preserveAlpha="true"
                />
              </filter>
            ) : null}
            {glow && glow.intensity > 0.01 ? (
              <filter
                id={glowFilterId(id)}
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur
                  in="SourceGraphic"
                  stdDeviation={glowStdDeviation(glow.radius)}
                  result="glowBlur"
                />
                <feComponentTransfer in="glowBlur" result="glowHighlights">
                  <feFuncR
                    type="linear"
                    slope={glowThresholdCurve(glow.threshold).slope}
                    intercept={glowThresholdCurve(glow.threshold).intercept}
                  />
                  <feFuncG
                    type="linear"
                    slope={glowThresholdCurve(glow.threshold).slope}
                    intercept={glowThresholdCurve(glow.threshold).intercept}
                  />
                  <feFuncB
                    type="linear"
                    slope={glowThresholdCurve(glow.threshold).slope}
                    intercept={glowThresholdCurve(glow.threshold).intercept}
                  />
                </feComponentTransfer>
                <feColorMatrix
                  in="glowHighlights"
                  type="matrix"
                  values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${glow.intensity} 0`}
                  result="glowWeighted"
                />
                <feMerge>
                  <feMergeNode in="SourceGraphic" />
                  <feMergeNode in="glowWeighted" />
                </feMerge>
              </filter>
            ) : null}
            {grain > 0.01 ? (
              <filter
                id={grainFilterId(id)}
                x="0"
                y="0"
                width="100%"
                height="100%"
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.9"
                  numOctaves="2"
                  seed="7"
                  result="grainNoise"
                />
                <feColorMatrix
                  in="grainNoise"
                  type="matrix"
                  values={grainMatrix(grain)}
                  result="grainLayer"
                />
                <feBlend in="SourceGraphic" in2="grainLayer" mode="overlay" />
              </filter>
            ) : null}
          </g>
        ))}
      </defs>
    </svg>
  );
}

/** Estilo de una capa visual: transformación, transición entrante y efectos. */
function layerStyle(
  clip: Clip,
  project: ProjectDocument,
  playheadFrame: number,
  viewport: PerspectiveViewport,
): CSSProperties {
  return {
    ...transformStyle(clip, project, playheadFrame, viewport),
    ...effectsStyle(clip, playheadFrame, project),
  };
}

/**
 * Estilo del canvas LUT: el grade ya se aplicó antes del LUT dentro del
 * pipeline (canvas intermedio + shader), así que sólo quedan los efectos que
 * el export aplica después: glow, grano, nitidez y transición.
 */
function lutLayerStyle(
  clip: Clip,
  project: ProjectDocument,
  playheadFrame: number,
  viewport: PerspectiveViewport,
): CSSProperties {
  const { extras } = effectFilterParts(clip, playheadFrame, project);
  return {
    ...transformStyle(clip, project, playheadFrame, viewport),
    ...(extras ? { filter: extras } : {}),
  };
}

function assetById(project: ProjectDocument, id: string): Asset | undefined {
  return project.assets.find((asset) => asset.id === id);
}

function trackById(project: ProjectDocument, id: string): Track | undefined {
  return project.timeline.tracks.find((track) => track.id === id);
}

function MediaUnavailable({
  clip,
  asset,
  failed,
  kind,
  onRetry,
  style,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly failed: boolean;
  readonly kind: 'video' | 'image';
  readonly onRetry: () => void;
  readonly style: CSSProperties;
}) {
  const label = asset?.label ?? clip.label ?? (kind === 'video' ? 'Clip de video' : 'Imagen');
  return (
    <div className="media-missing" style={style} role="status" aria-live="polite">
      <strong>{failed ? `No se pudo cargar ${label}` : `Medio sin vínculo: ${label}`}</strong>
      <span>
        {failed
          ? 'El archivo no está disponible en esta ruta o el decodificador falló.'
          : 'El asset no tiene una ruta válida para este equipo.'}
      </span>
      <span className="media-missing-hint">Reconectá el archivo desde Medios → “Reconectar archivo…”.</span>
      {failed ? (
        <button type="button" className="small" onClick={onRetry} aria-label={`Reintentar ${label}`}>
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

function VideoLayer({
  clip,
  asset,
  project,
  playheadFrame,
  playing,
  muted,
  trackId = '',
  trackGain = 0,
  viewport,
  applyLook = true,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly muted: boolean;
  readonly trackId?: string;
  readonly trackGain?: number;
  readonly viewport: PerspectiveViewport;
  readonly applyLook?: boolean;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const previewProfile = usePreviewProfile();
  const ref = useRef<HTMLVideoElement | null>(null);
  // Enrutado por Web Audio: true sólo si el elemento quedó conectado al grafo
  // de su pista; en caso contrario la preview usa `element.volume` como siempre.
  const [routed, setRouted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const fps = fpsOf(project);
  const alphaCutout =
    asset !== undefined && asset.kind === 'video' && asset.media?.alpha === true;
  const proxy =
    asset && !alphaCutout && 'proxy' in asset
      ? (asset as Asset & { proxy?: { path: string } }).proxy
      : undefined;
  const url = asset ? store.service.mediaUrl(root, proxy?.path ?? asset.source.path) : '';
  useEffect(() => {
    setFailed(false);
    setReload(0);
  }, [url]);
  const windowed = clip.kind === 'video' || clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  const speed = clip.kind === 'video' ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1) : 1;
  const remap = useMemo(() => clipTimeRemap(clip), [clip]);
  const localFrame = Math.max(0, playheadFrame - clip.startFrame);
  // LUT en vivo: el clip y el look global comparten el mismo archivo `.cube`
  // que consume FFmpeg. El motion blur se acumula en el mismo canvas.
  const clipLutFile = 'effects' in clip ? clip.effects?.lutFile : undefined;
  const lookLutFile = applyLook ? project.look?.lutFile : undefined;
  const lookHasWheels = applyLook && hasColorWheels(project.look);
  const lookBrightness = applyLook ? project.look?.brightness : undefined;
  const lookBrightnessActive =
    lookBrightness !== undefined &&
    Number.isFinite(lookBrightness) &&
    Math.abs(lookBrightness) > 0.001;
  const lookWheelsActive = lookHasWheels || lookBrightnessActive;
  const lookBrightnessInShader = lookWheelsActive && !lookHasWheels;
  const lookShaderGrade = applyLook
    ? lookShaderGradeOf(project, canUseWebGL2() && getPreviewProfile() !== 'efficient')
    : null;
  const lookShaderActive = lookShaderGrade !== null;
  const lookToneActive =
    applyLook &&
    canUseWebGL2() &&
    getPreviewProfile() !== 'efficient' &&
    ((project.look?.shadows !== undefined &&
      Math.abs(project.look.shadows) > 0.001) ||
      (project.look?.highlights !== undefined &&
        Math.abs(project.look.highlights) > 0.001) ||
      (project.look?.fade !== undefined && project.look.fade > 0.001));
  const lookMatchGain = applyLook ? colorMatchGain(project.look?.colorMatch) : null;
  const lookMatchActive = lookMatchGain !== null;
  const lookHslInput = applyLook ? hslShaderInput(project.look?.hsl) : null;
  const lookHslActive =
    lookHslInput !== null &&
    canUseWebGL2() &&
    getPreviewProfile() !== 'efficient';
  const lookGrade = applyLook
    ? lookGradeFilterOf(
        project,
        lookWheelsActive,
        lookShaderActive,
        lookToneActive,
        lookMatchActive,
        lookHslActive,
      )
    : '';
  const lookGradeApprox = applyLook ? lookGradeFilterOf(project) : '';
  const effectsAtPlayhead = effectsAtFrame(clip, playheadFrame);
  const motionBlur = effectsAtPlayhead?.motionBlur;
  const blurActive =
    clip.kind === 'video' &&
    motionBlur !== undefined &&
    Number.isFinite(motionBlur.intensity) &&
    motionBlur.intensity > 0.001;
  const denoise = effectsAtPlayhead?.denoise;
  const denoiseActive =
    denoise !== undefined && Number.isFinite(denoise) && denoise > 0.001;
  const vignette = effectsAtPlayhead?.vignette;
  const vignetteActive =
    vignette !== undefined && Number.isFinite(vignette) && vignette > 0.001;
  const clipCurves = effectsAtPlayhead?.curves;
  const curvesActive = hasCustomCurves(clipCurves);
  const chromaKey = 'chromaKey' in clip ? clip.chromaKey : undefined;
  const wheelsActive = hasColorWheels(effectsAtPlayhead);
  const lutActive = Boolean(clipLutFile || lookLutFile);
  const brightness = effectsAtPlayhead?.brightness;
  const brightnessActive =
    brightness !== undefined && Number.isFinite(brightness) && Math.abs(brightness) > 0.001;
  const overlayActive =
    lutActive ||
    blurActive ||
    denoiseActive ||
    vignetteActive ||
    curvesActive ||
    Boolean(chromaKey) ||
    wheelsActive ||
    lookWheelsActive;
  const temperature = effectsAtPlayhead?.temperature;
  const temperatureActive =
    temperature !== undefined && Number.isFinite(temperature) && Math.abs(temperature) > 0.001;
  const shaderAvailable = canUseWebGL2() && getPreviewProfile() !== 'efficient';
  // La temperatura usa colorbalance del export fuera del perfil eficiente; con
  // el overlay ya activo no cuesta un pase extra.
  const temperatureInShader =
    temperatureActive && canUseWebGL2() && (overlayActive || getPreviewProfile() !== 'efficient');
  // El brillo va al shader cuando el overlay ya está activo (costo cero) o,
  // fuera del perfil eficiente, aunque sea el único efecto. Un video sin
  // WebGL2 conserva la aproximación CSS porque el overlay no dibuja frames.
  const brightnessInShader =
    brightnessActive && (overlayActive || temperatureInShader || shaderAvailable);
  const shaderGradeActive = overlayActive || brightnessInShader || temperatureInShader;
  // Fuera del perfil eficiente el grade exacto usa el pase aunque sea el único
  // efecto; en eficiente o sin WebGL2 se conserva la aproximación CSS.
  const exactGrade =
    canUseWebGL2() && (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const contrast = effectsAtPlayhead?.contrast;
  const contrastActive =
    contrast !== undefined && Number.isFinite(contrast) && Math.abs(contrast - 1) > 0.001;
  const contrastInShader = contrastActive && exactGrade;
  const saturation = effectsAtPlayhead?.saturation;
  const saturationActive =
    saturation !== undefined && Number.isFinite(saturation) && Math.abs(saturation - 1) > 0.001;
  const saturationInShader = saturationActive && exactGrade;
  const hueRotate = effectsAtPlayhead?.hueRotateDeg;
  const hueActive =
    hueRotate !== undefined && Number.isFinite(hueRotate) && Math.abs(hueRotate) > 0.01;
  const hueInShader = hueActive && exactGrade;
  const grayscaleActive = effectsAtPlayhead?.grayscale === true;
  const sepiaActive = effectsAtPlayhead?.sepia === true;
  const grayscaleInShader = grayscaleActive && exactGrade;
  const sepiaInShader = sepiaActive && exactGrade;
  const shadows = effectsAtPlayhead?.shadows;
  const highlights = effectsAtPlayhead?.highlights;
  const fade = effectsAtPlayhead?.fade;
  const toneActive =
    (shadows !== undefined && Number.isFinite(shadows) && Math.abs(shadows) > 0.001) ||
    (highlights !== undefined && Number.isFinite(highlights) && Math.abs(highlights) > 0.001) ||
    (fade !== undefined && Number.isFinite(fade) && fade > 0.001);
  const toneInShader =
    toneActive &&
    canUseWebGL2() &&
    (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const matchGain = colorMatchGain(effectsAtPlayhead?.colorMatch);
  const matchInShader =
    matchGain !== null &&
    canUseWebGL2() &&
    (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const hslInput = hslShaderInput(effectsAtPlayhead?.hsl);
  const hslInShader =
    hslInput !== null &&
    canUseWebGL2() &&
    (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const effectActive =
    shaderGradeActive ||
    contrastInShader ||
    saturationInShader ||
    hueInShader ||
    grayscaleInShader ||
    sepiaInShader ||
    toneInShader ||
    matchInShader ||
    hslInShader ||
    lookShaderActive ||
    lookToneActive ||
    lookMatchActive ||
    lookHslActive;
  const clipLutIntensity = effectsAtPlayhead?.lutIntensity ?? 1;
  const lookLutIntensity = project.look?.lutIntensity ?? 1;
  const [lutReady, setLutReady] = useState(false);
  useEffect(() => {
    setLutReady(false);
  }, [url, reload, effectActive]);
  // Durante el lead de la transición el clip entrante muestra el material
  // anterior a su inicio, igual que el recorte de origen del export.
  const relativeFrame = playheadFrame - clip.startFrame;
  const sourceSeconds = source
    ? remap
      ? remap.sourceSecondsAt(localFrame, source.inFrame, fps)
      : Math.max(0, (source.inFrame + relativeFrame * speed) / fps)
    : 0;
  const clipGainDb = clipGainAtFrame(
    clip,
    Math.max(0, Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame)),
  );
  // Con Web Audio, la ganancia de pista la aplica el fader del grafo (sin el
  // tope de 1.0 del elemento) y el elemento sólo lleva la ganancia del clip.
  // Sin grafo, el volumen combinado va en `element.volume` como siempre.
  const volume =
    muted || clip.audio?.muted === true ? 0 : volumeFromDb(clipGainDb + (routed ? 0 : trackGain));

  // Enruta el elemento al grafo de audio de su pista (fader, paneo y EQ). Si
  // no hay Web Audio disponible, attach devuelve false y sigue el camino de
  // siempre con `element.volume`: degradación silenciosa.
  useEffect(() => {
    const media = ref.current;
    if (!media || !url || trackId === '') {
      setRouted(false);
      return;
    }
    const ok = attachPreviewAudio(trackId, media, clip.audio?.pan ?? 0);
    setRouted(ok);
    return () => {
      if (ok) detachPreviewAudio(trackId, media);
    };
  }, [trackId, url]);

  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    setPreviewClipPan(media, clip.audio?.pan ?? 0);
  }, [clip.audio?.pan]);

  useEffect(() => {
    const video = ref.current;
    if (!video || !url) return;
    if (Math.abs(video.currentTime - sourceSeconds) > 0.12) {
      try {
        video.currentTime = Math.max(0, sourceSeconds);
      } catch {
        // Metadata may not be loaded yet; the next update will try again.
      }
    }
    if (playing) {
      resumePreviewAudio();
      void video.play().catch(() => {
        // Autoplay can be denied; the scrub still works and the user can press play again.
      });
    } else {
      video.pause();
    }
  }, [playing, sourceSeconds, url]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  // El audio de un clip con curva no puede seguir la velocidad instantánea
  // frame a frame; se usa la media (como el atempo del export) para que no se
  // desincronice de punta a punta.
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const rate = remap
      ? Math.min(4, Math.max(0.25, remap.averageSpeed))
      : 1;
    try {
      media.playbackRate = rate;
    } catch {
      // WebView sin playbackRate: queda a 1×.
    }
  }, [remap]);

  if (!url || failed) {
    return (
      <MediaUnavailable
        clip={clip}
        asset={asset}
        failed={failed}
        kind="video"
        style={layerStyle(clip, project, playheadFrame, viewport)}
        onRetry={() => {
          setFailed(false);
          setReload((value) => value + 1);
        }}
      />
    );
  }

  const mediaStyle = withLookGrade(
    layerStyle(clip, project, playheadFrame, viewport),
    lookGradeApprox,
  );
  return (
    <>
      <video
        key={`${url}-${reload}`}
        ref={ref}
        className="preview-media"
        src={url}
        crossOrigin="anonymous"
        data-clip-id={clip.id}
        style={
          effectActive && lutReady
            ? { ...mediaStyle, opacity: 0, filter: 'none' }
            : mediaStyle
        }
        muted={muted}
        playsInline
        preload="auto"
        onError={() => setFailed(true)}
      />
      {effectActive ? (
        <EffectOverlay
          sourceRef={ref}
          sourceKind="video"
          sourceKey={`${url}-${reload}`}
          style={lutLayerStyle(clip, project, playheadFrame, viewport)}
          dataClipId={clip.id}
          gradeFilter={effectFilterParts(clip, playheadFrame, project, {
            wheels: wheelsActive || brightnessInShader,
            temperature: temperatureInShader,
            contrast: contrastInShader,
            saturation: saturationInShader,
            hue: hueInShader,
            grayscale: grayscaleInShader,
            sepia: sepiaInShader,
            tone: toneInShader,
            colorMatch: matchInShader,
            hsl: hslInShader,
          }).grade}
          lookGradeFilter={lookGrade}
          clipLutFile={clipLutFile}
          clipIntensity={clipLutIntensity}
          lookLutFile={lookLutFile}
          lookIntensity={lookLutIntensity}
          motionBlur={blurActive ? motionBlur : undefined}
          denoise={denoiseActive ? denoise : undefined}
          temporalDenoise={temporalDenoiseForProfile(previewProfile)}
          vignette={vignetteActive ? vignette : undefined}
          curves={curvesActive ? clipCurves : undefined}
          chromaKey={chromaKey}
          colorWheels={wheelsActive || brightnessInShader ? effectsAtPlayhead : undefined}
          brightnessInShader={brightnessInShader}
          temperature={temperatureInShader ? temperature : undefined}
          contrast={contrastInShader ? contrast : undefined}
          saturation={saturationInShader ? saturation : undefined}
          hueRotateDeg={hueInShader ? hueRotate : undefined}
          grayscale={grayscaleInShader ? true : undefined}
          sepia={sepiaInShader ? true : undefined}
          lookColorWheels={lookWheelsActive ? project.look : undefined}
          lookBrightnessInShader={lookBrightnessInShader}
          lookContrast={lookShaderGrade?.contrast}
          lookSaturation={lookShaderGrade?.saturation}
          lookHueDeg={lookShaderGrade?.hueRotateDeg}
          lookTemperature={lookShaderGrade?.temperature}
          lookGrayscale={lookShaderGrade?.grayscale}
          lookSepia={lookShaderGrade?.sepia}
          shadows={toneInShader ? shadows : undefined}
          highlights={toneInShader ? highlights : undefined}
          fade={toneInShader ? fade : undefined}
          lookShadows={lookToneActive ? project.look?.shadows : undefined}
          lookHighlights={lookToneActive ? project.look?.highlights : undefined}
          lookFade={lookToneActive ? project.look?.fade : undefined}
          matchR={matchInShader ? matchGain?.[0] : undefined}
          matchG={matchInShader ? matchGain?.[1] : undefined}
          matchB={matchInShader ? matchGain?.[2] : undefined}
          lookMatchR={lookMatchActive ? lookMatchGain?.[0] : undefined}
          lookMatchG={lookMatchActive ? lookMatchGain?.[1] : undefined}
          lookMatchB={lookMatchActive ? lookMatchGain?.[2] : undefined}
          hslHue={hslInShader ? hslInput?.hue : undefined}
          hslSat={hslInShader ? hslInput?.saturation : undefined}
          hslIntensity={hslInShader ? hslInput?.intensity : undefined}
          hslColors={hslInShader ? hslInput?.colors : undefined}
          lookHslHue={lookHslActive ? lookHslInput?.hue : undefined}
          lookHslSat={lookHslActive ? lookHslInput?.saturation : undefined}
          lookHslIntensity={lookHslActive ? lookHslInput?.intensity : undefined}
          lookHslColors={lookHslActive ? lookHslInput?.colors : undefined}
          playing={playing}
          onReadyChange={setLutReady}
        />
      ) : null}
    </>
  );
}

function ImageLayer({
  clip,
  asset,
  project,
  playheadFrame,
  viewport,
  applyLook = true,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly viewport: PerspectiveViewport;
  readonly applyLook?: boolean;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  const clipLutFile = 'effects' in clip ? clip.effects?.lutFile : undefined;
  const lookLutFile = applyLook ? project.look?.lutFile : undefined;
  const lookHasWheels = applyLook && hasColorWheels(project.look);
  const lookBrightness = applyLook ? project.look?.brightness : undefined;
  const lookBrightnessActive =
    lookBrightness !== undefined &&
    Number.isFinite(lookBrightness) &&
    Math.abs(lookBrightness) > 0.001;
  const lookWheelsActive = lookHasWheels || lookBrightnessActive;
  const lookBrightnessInShader = lookWheelsActive && !lookHasWheels;
  const lookShaderGrade = applyLook
    ? lookShaderGradeOf(project, canUseWebGL2() && getPreviewProfile() !== 'efficient')
    : null;
  const lookShaderActive = lookShaderGrade !== null;
  const lookToneActive =
    applyLook &&
    canUseWebGL2() &&
    getPreviewProfile() !== 'efficient' &&
    ((project.look?.shadows !== undefined &&
      Math.abs(project.look.shadows) > 0.001) ||
      (project.look?.highlights !== undefined &&
        Math.abs(project.look.highlights) > 0.001) ||
      (project.look?.fade !== undefined && project.look.fade > 0.001));
  const lookMatchGain = applyLook ? colorMatchGain(project.look?.colorMatch) : null;
  const lookMatchActive = lookMatchGain !== null;
  const lookHslInput = applyLook ? hslShaderInput(project.look?.hsl) : null;
  const lookHslActive =
    lookHslInput !== null &&
    canUseWebGL2() &&
    getPreviewProfile() !== 'efficient';
  const lookGrade = applyLook
    ? lookGradeFilterOf(
        project,
        lookWheelsActive,
        lookShaderActive,
        lookToneActive,
        lookMatchActive,
        lookHslActive,
      )
    : '';
  const lookGradeApprox = applyLook ? lookGradeFilterOf(project) : '';
  const effectsAtPlayhead = effectsAtFrame(clip, playheadFrame);
  const denoise = effectsAtPlayhead?.denoise;
  const denoiseActive =
    denoise !== undefined && Number.isFinite(denoise) && denoise > 0.001;
  const vignette = effectsAtPlayhead?.vignette;
  const vignetteActive =
    vignette !== undefined && Number.isFinite(vignette) && vignette > 0.001;
  const clipCurves = effectsAtPlayhead?.curves;
  const curvesActive = hasCustomCurves(clipCurves);
  const chromaKey = 'chromaKey' in clip ? clip.chromaKey : undefined;
  const wheelsActive = hasColorWheels(effectsAtPlayhead);
  const lutActive = Boolean(clipLutFile || lookLutFile);
  const brightness = effectsAtPlayhead?.brightness;
  const brightnessActive =
    brightness !== undefined && Number.isFinite(brightness) && Math.abs(brightness) > 0.001;
  const overlayActive =
    lutActive ||
    denoiseActive ||
    vignetteActive ||
    curvesActive ||
    Boolean(chromaKey) ||
    wheelsActive ||
    lookWheelsActive;
  const temperature = effectsAtPlayhead?.temperature;
  const temperatureActive =
    temperature !== undefined && Number.isFinite(temperature) && Math.abs(temperature) > 0.001;
  const shaderAvailable = canUseWebGL2() && getPreviewProfile() !== 'efficient';
  // La temperatura usa colorbalance del export; el fallback 2D no la aplica,
  // así que se exige WebGL2 fuera del perfil eficiente.
  const temperatureInShader =
    temperatureActive && canUseWebGL2() && (overlayActive || getPreviewProfile() !== 'efficient');
  // Las imágenes tienen fallback 2D exacto: fuera del perfil eficiente el
  // brillo también usa el pase aunque sea el único efecto.
  const brightnessInShader =
    brightnessActive && (overlayActive || temperatureInShader || shaderAvailable);
  const contrast = effectsAtPlayhead?.contrast;
  const contrastActive =
    contrast !== undefined && Number.isFinite(contrast) && Math.abs(contrast - 1) > 0.001;
  const shaderGradeActive = overlayActive || brightnessInShader || temperatureInShader;
  // Fuera del perfil eficiente el grade exacto usa el pase aunque sea el único
  // efecto; en eficiente o sin WebGL2 se conserva la aproximación CSS.
  const exactGrade =
    canUseWebGL2() && (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const contrastInShader = contrastActive && exactGrade;
  const saturation = effectsAtPlayhead?.saturation;
  const saturationActive =
    saturation !== undefined && Number.isFinite(saturation) && Math.abs(saturation - 1) > 0.001;
  const saturationInShader = saturationActive && exactGrade;
  const hueRotate = effectsAtPlayhead?.hueRotateDeg;
  const hueActive =
    hueRotate !== undefined && Number.isFinite(hueRotate) && Math.abs(hueRotate) > 0.01;
  const hueInShader = hueActive && exactGrade;
  const grayscaleActive = effectsAtPlayhead?.grayscale === true;
  const sepiaActive = effectsAtPlayhead?.sepia === true;
  const grayscaleInShader = grayscaleActive && exactGrade;
  const sepiaInShader = sepiaActive && exactGrade;
  const shadows = effectsAtPlayhead?.shadows;
  const highlights = effectsAtPlayhead?.highlights;
  const fade = effectsAtPlayhead?.fade;
  const toneActive =
    (shadows !== undefined && Number.isFinite(shadows) && Math.abs(shadows) > 0.001) ||
    (highlights !== undefined && Number.isFinite(highlights) && Math.abs(highlights) > 0.001) ||
    (fade !== undefined && Number.isFinite(fade) && fade > 0.001);
  const toneInShader =
    toneActive &&
    canUseWebGL2() &&
    (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const matchGain = colorMatchGain(effectsAtPlayhead?.colorMatch);
  const matchInShader =
    matchGain !== null &&
    canUseWebGL2() &&
    (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const hslInput = hslShaderInput(effectsAtPlayhead?.hsl);
  const hslInShader =
    hslInput !== null &&
    canUseWebGL2() &&
    (shaderGradeActive || getPreviewProfile() !== 'efficient');
  const effectActive =
    shaderGradeActive ||
    contrastInShader ||
    saturationInShader ||
    hueInShader ||
    grayscaleInShader ||
    sepiaInShader ||
    toneInShader ||
    matchInShader ||
    hslInShader ||
    lookShaderActive ||
    lookToneActive ||
    lookMatchActive ||
    lookHslActive;
  const clipLutIntensity = effectsAtPlayhead?.lutIntensity ?? 1;
  const lookLutIntensity = project.look?.lutIntensity ?? 1;
  const [lutReady, setLutReady] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    setFailed(false);
    setReload(0);
    setLutReady(false);
  }, [url, effectActive]);
  if (!url || failed) {
    return (
      <MediaUnavailable
        clip={clip}
        asset={asset}
        failed={failed}
        kind="image"
        style={layerStyle(clip, project, playheadFrame, viewport)}
        onRetry={() => {
          setFailed(false);
          setReload((value) => value + 1);
        }}
      />
    );
  }
  const mediaStyle = withLookGrade(
    layerStyle(clip, project, playheadFrame, viewport),
    lookGradeApprox,
  );
  return (
    <>
      <img
        key={`${url}-${reload}`}
        ref={ref}
        className="preview-media"
        src={url}
        crossOrigin="anonymous"
        data-clip-id={clip.id}
        alt={clip.label ?? 'Imagen de la timeline'}
        style={
          effectActive && lutReady
            ? { ...mediaStyle, opacity: 0, filter: 'none' }
            : mediaStyle
        }
        onError={() => setFailed(true)}
      />
      {effectActive ? (
        <EffectOverlay
          sourceRef={ref}
          sourceKind="image"
          sourceKey={`${url}-${reload}`}
          style={lutLayerStyle(clip, project, playheadFrame, viewport)}
          dataClipId={clip.id}
          gradeFilter={effectFilterParts(clip, playheadFrame, project, {
            wheels: wheelsActive || brightnessInShader,
            temperature: temperatureInShader,
            contrast: contrastInShader,
            saturation: saturationInShader,
            hue: hueInShader,
            grayscale: grayscaleInShader,
            sepia: sepiaInShader,
            tone: toneInShader,
            colorMatch: matchInShader,
            hsl: hslInShader,
          }).grade}
          lookGradeFilter={lookGrade}
          clipLutFile={clipLutFile}
          clipIntensity={clipLutIntensity}
          lookLutFile={lookLutFile}
          lookIntensity={lookLutIntensity}
          motionBlur={undefined}
          denoise={denoiseActive ? denoise : undefined}
          vignette={vignetteActive ? vignette : undefined}
          curves={curvesActive ? clipCurves : undefined}
          chromaKey={chromaKey}
          colorWheels={wheelsActive || brightnessInShader ? effectsAtPlayhead : undefined}
          brightnessInShader={brightnessInShader}
          temperature={temperatureInShader ? temperature : undefined}
          contrast={contrastInShader ? contrast : undefined}
          saturation={saturationInShader ? saturation : undefined}
          hueRotateDeg={hueInShader ? hueRotate : undefined}
          grayscale={grayscaleInShader ? true : undefined}
          sepia={sepiaInShader ? true : undefined}
          lookColorWheels={lookWheelsActive ? project.look : undefined}
          lookBrightnessInShader={lookBrightnessInShader}
          lookContrast={lookShaderGrade?.contrast}
          lookSaturation={lookShaderGrade?.saturation}
          lookHueDeg={lookShaderGrade?.hueRotateDeg}
          lookTemperature={lookShaderGrade?.temperature}
          lookGrayscale={lookShaderGrade?.grayscale}
          lookSepia={lookShaderGrade?.sepia}
          shadows={toneInShader ? shadows : undefined}
          highlights={toneInShader ? highlights : undefined}
          fade={toneInShader ? fade : undefined}
          lookShadows={lookToneActive ? project.look?.shadows : undefined}
          lookHighlights={lookToneActive ? project.look?.highlights : undefined}
          lookFade={lookToneActive ? project.look?.fade : undefined}
          matchR={matchInShader ? matchGain?.[0] : undefined}
          matchG={matchInShader ? matchGain?.[1] : undefined}
          matchB={matchInShader ? matchGain?.[2] : undefined}
          lookMatchR={lookMatchActive ? lookMatchGain?.[0] : undefined}
          lookMatchG={lookMatchActive ? lookMatchGain?.[1] : undefined}
          lookMatchB={lookMatchActive ? lookMatchGain?.[2] : undefined}
          hslHue={hslInShader ? hslInput?.hue : undefined}
          hslSat={hslInShader ? hslInput?.saturation : undefined}
          hslIntensity={hslInShader ? hslInput?.intensity : undefined}
          hslColors={hslInShader ? hslInput?.colors : undefined}
          lookHslHue={lookHslActive ? lookHslInput?.hue : undefined}
          lookHslSat={lookHslActive ? lookHslInput?.saturation : undefined}
          lookHslIntensity={lookHslActive ? lookHslInput?.intensity : undefined}
          lookHslColors={lookHslActive ? lookHslInput?.colors : undefined}
          playing={false}
          onReadyChange={setLutReady}
        />
      ) : null}
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
  trackId = '',
  trackGain = 0,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly trackId?: string;
  readonly trackGain?: number;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const ref = useRef<HTMLAudioElement | null>(null);
  // Enrutado por Web Audio: true sólo si el elemento quedó conectado al grafo
  // de su pista; si no, el volumen combinado va en `element.volume`.
  const [routed, setRouted] = useState(false);
  const fps = fpsOf(project);
  const windowed = clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  const speed = clip.kind === 'audio' ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1) : 1;
  const remap = useMemo(() => clipTimeRemap(clip), [clip]);
  const sourceSeconds = source
    ? (source.inFrame + Math.max(0, playheadFrame - clip.startFrame) * speed) / fps
    : 0;
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  const clipGainDb = clipGainAtFrame(
    clip,
    Math.max(0, Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame)),
  );
  const volume = clip.audio?.muted === true ? 0 : volumeFromDb(clipGainDb + (routed ? 0 : trackGain));

  // Enruta el elemento al grafo de audio de su pista (fader, paneo y EQ). Si
  // no hay Web Audio disponible, attach devuelve false y sigue el camino de
  // siempre con `element.volume`: degradación silenciosa.
  useEffect(() => {
    const media = ref.current;
    if (!media || !url || trackId === '') {
      setRouted(false);
      return;
    }
    const ok = attachPreviewAudio(trackId, media, clip.audio?.pan ?? 0);
    setRouted(ok);
    return () => {
      if (ok) detachPreviewAudio(trackId, media);
    };
  }, [trackId, url]);

  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    setPreviewClipPan(media, clip.audio?.pan ?? 0);
  }, [clip.audio?.pan]);

  useEffect(() => {
    const audio = ref.current;
    if (!audio || !url) return;
    if (Math.abs(audio.currentTime - sourceSeconds) > 0.12) {
      try {
        audio.currentTime = Math.max(0, sourceSeconds);
      } catch {
        // Ignore until metadata is available.
      }
    }
    if (playing) {
      resumePreviewAudio();
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing, sourceSeconds, url]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  // El audio de un clip con curva no puede seguir la velocidad instantánea
  // frame a frame; se usa la media (como el atempo del export) para que no se
  // desincronice de punta a punta.
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const rate = remap
      ? Math.min(4, Math.max(0.25, remap.averageSpeed))
      : 1;
    try {
      media.playbackRate = rate;
    } catch {
      // WebView sin playbackRate: queda a 1×.
    }
  }, [remap]);

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

export function Preview() {
  const store = useProjectStore();
  const project = store.state.project;
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>();
  // Las guías arrancan según Ajustes → Editor; el botón de la vista previa
  // sigue mandando durante la sesión.
  const [showGuides, setShowGuides] = useState(() => loadEditorPreferences().safeMargins);
  const [showScopes, setShowScopes] = useState(false);
  const [compare, setCompare] = useState(false);
  const [realFrame, setRealFrame] = useState<PreviewFrameResult | null>(null);
  const [realFrameBusy, setRealFrameBusy] = useState(false);
  const [monitorZoom, setMonitorZoom] = useState(1);
  const [monitorPan, setMonitorPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [pixelPerfect, setPixelPerfect] = useState(false);
  const fps = project ? fpsOf(project) : 30;
  const playhead = store.state.playheadFrame;
  const playing = store.state.playing;
  const perf = usePreviewPerf(playing, fps);

  useEffect(() => {
    setRealFrame(null);
    setPixelPerfect(false);
  }, [playhead, project]);

  useEffect(() => {
    setMonitorZoom(1);
    setMonitorPan({ x: 0, y: 0 });
  }, [project?.id, project?.video.width, project?.video.height]);

  // El grafo de audio de la preview sigue el proyecto: fader, paneo y EQ de
  // pista más ganancia master, aunque se muevan desde la vista Mezcla.
  useEffect(() => {
    if (project) syncPreviewAudioFromProject(project);
  }, [project]);

  // Fader y paneo de pista animados: el grafo se muestrea en el frame visible,
  // también al arrastrar el playhead, no sólo cuando cambia el proyecto.
  useEffect(() => {
    if (project) syncPreviewAudioAutomationAtFrame(project, playhead);
  }, [project, playhead]);

  const visualClips = useMemo(() => {
    if (!project) return [];
    return project.timeline.clips
      .filter((clip) => {
        const track = trackById(project, clip.trackId);
        if (!track || track.hidden) return false;
        if (!['video', 'image', 'graphic'].includes(track.kind)) return false;
        if (clip.enabled === false) return false;
        // El clip entrante aparece durante el lead de su transición para
        // componer el mismo solape que el export y el frame nativo.
        const from = clip.startFrame - transitionLeadFrames(clip, fps);
        return playhead >= from && playhead < clip.startFrame + clip.durationFrames;
      })
      .sort((a, b) => {
        const orderA = trackById(project, a.trackId)?.order ?? 0;
        const orderB = trackById(project, b.trackId)?.order ?? 0;
        return orderA - orderB;
      });
  }, [fps, playhead, project]);

  const audioClips = useMemo(() => {
    if (!project) return [];
    return project.timeline.clips.filter((clip) => {
      const track = trackById(project, clip.trackId);
      if (!track || !isTrackAudible(track, project.timeline.tracks)) return false;
      if (!['audio', 'narration'].includes(track.kind)) return false;
      if (clip.enabled === false) return false;
      return playhead >= clip.startFrame && playhead < clip.startFrame + clip.durationFrames;
    });
  }, [playhead, project]);

  const adjustmentFilter = useMemo(() => {
    if (!project || compare) return '';
    return project.timeline.clips
      .filter((clip): clip is Extract<Clip, { kind: 'adjustment' }> => {
        if (clip.kind !== 'adjustment') return false;
        if (clip.enabled === false) return false;
        const track = trackById(project, clip.trackId);
        if (!track || track.hidden) return false;
        return (
          playhead >= clip.startFrame &&
          playhead < clip.startFrame + clip.durationFrames
        );
      })
      .sort(
        (a, b) =>
          (trackById(project, a.trackId)?.order ?? 0) -
          (trackById(project, b.trackId)?.order ?? 0),
      )
      .map((clip) => effectsToCss(clip.effects).filter)
      .filter((filter): filter is string => typeof filter === 'string' && filter.length > 0)
      .join(' ');
  }, [compare, playhead, project]);

  const selection = store.state.selection;
  const selectedClip =
    selection.kind === 'clip'
      ? (visualClips.find((clip) => clip.id === selection.id) ?? null)
      : null;

  const usingProxy =
    project != null &&
    visualClips.some((clip) => {
      if (clip.source.type !== 'asset') return false;
      const source = assetById(project, clip.source.assetId);
      return Boolean(
        source && 'proxy' in source && (source as Asset & { proxy?: unknown }).proxy,
      );
    });

  if (!project) {
    return <div className="preview-empty">Abrí un proyecto para ver la vista previa.</div>;
  }

  const aspect = project.video.width / Math.max(1, project.video.height);
  const frameWidth =
    stageSize.width > 0 && stageSize.height > 0
      ? Math.min(stageSize.width, stageSize.height * aspect)
      : 0;
  const frameHeight = frameWidth > 0 ? frameWidth / aspect : 0;
  // En pixel-perfect el lienzo mide los píxeles reales del frame, no el
  // tamaño ajustado a la etapa: la homografía debe usar ese mismo cuadro.
  const canvasWidth = pixelPerfect ? (realFrame?.width ?? project.video.width) : frameWidth;
  const canvasHeight = pixelPerfect ? (realFrame?.height ?? project.video.height) : frameHeight;
  const previewStyle: CSSProperties =
    compare || !adjustmentFilter ? {} : { filter: adjustmentFilter };

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
    try {
      const hasGraphics = project.timeline.clips.some((clip) => clip.kind === 'graphic');
      const motionPlans = hasGraphics ? buildProjectMotionPlans(project).plans : null;
      const result = await store.service.renderPreviewFrame({
        project,
        clipId: target.id,
        frame: playhead,
        native,
        ...(motionPlans ? { motionPlans } : {}),
      });
      setRealFrame(result);
      return result;
    } catch (failure) {
      store.setNotice(
        failure instanceof Error
          ? failure.message
          : 'no se pudo renderizar el frame real',
      );
      return null;
    } finally {
      setRealFrameBusy(false);
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

  return (
    <div
      className={`preview-stage${pixelPerfect ? ' pixel-perfect' : ''}`}
      data-compare={compare ? 'true' : undefined}
      ref={stageRef}
    >
      <div className="preview-hud" aria-hidden="true">
        <span className="preview-hud-chip strong">
          {project.video.width}×{project.video.height}
        </span>
        <span className="preview-hud-chip">{fps} fps</span>
        {perf.frames > 1 ? (
          <span
            className="preview-hud-chip"
            title="FPS reales medidos con requestAnimationFrame en WebView2"
          >
            {perf.fps.toFixed(0)} fps reales · {perf.dropped} caídos
          </span>
        ) : null}
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
      </div>
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
              {preset.label}
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
          className={showGuides ? 'preview-tool active' : 'preview-tool'}
          aria-pressed={showGuides}
          aria-label="Guías de composición"
          title="Guías de composición"
          onClick={() => setShowGuides((value) => !value)}
        >
          <Icon name="grid" size={13} />
          <span>Guías</span>
        </button>
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
      {showScopes ? (
        <ScopesPanel
          stageRef={stageRef}
          realFramePath={realFrame?.path ?? null}
          analyzeScopes={(path) => store.service.analyzeScopesFrame({ path })}
          onClose={() => setShowScopes(false)}
        />
      ) : null}
      <div
        className={`preview-canvas${monitorZoom !== 1 ? ' zoomed' : ''}${panning ? ' panning' : ''}`}
        style={{
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
            : `scale(${monitorZoom}) translate(${monitorPan.x}px, ${monitorPan.y}px)`,
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
        <div
          className="preview-look"
          style={previewStyle}
          tabIndex={0}
          role="group"
          aria-label="Lienzo de la vista previa. Enter selecciona el clip superior."
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            const top = visualClips[visualClips.length - 1];
            if (top) store.setSelection({ kind: 'clip', id: top.id });
          }}
          onPointerDown={(event) => {
            const target = (event.target as HTMLElement).closest('[data-clip-id]');
            const id = target?.getAttribute('data-clip-id');
            if (id) store.setSelection({ kind: 'clip', id });
          }}
        >
          <PreviewSvgFilters clips={visualClips} playheadFrame={playhead} />
          {visualClips.map((clip) => {
            const asset = clip.source.type === 'asset' ? assetById(project, clip.source.assetId) : undefined;
            const track = trackById(project, clip.trackId);
            if (clip.kind === 'video') {
              return (
                <VideoLayer
                  key={clip.id}
                  clip={clip}
                  asset={asset}
                  project={project}
                  playheadFrame={playhead}
                  playing={playing}
                  muted={!track || !isTrackAudible(track, project.timeline.tracks)}
                  trackId={track ? track.id : ''}
                  trackGain={track ? trackGainDb(track) : 0}
                  viewport={previewViewport(asset, canvasWidth, canvasHeight)}
                  applyLook={!compare}
                />
              );
            }
            if (clip.kind === 'image' || clip.kind === 'freeze') {
              return (
                <ImageLayer
                  key={clip.id}
                  clip={clip}
                  asset={asset}
                  project={project}
                  playheadFrame={playhead}
                  viewport={previewViewport(asset, canvasWidth, canvasHeight)}
                  applyLook={!compare}
                />
              );
            }
            if (clip.kind === 'graphic') {
              return (
                <GraphicLayer
                  key={clip.id}
                  clip={clip}
                  project={project}
                  playheadFrame={playhead}
                  viewport={previewViewport(undefined, canvasWidth, canvasHeight)}
                />
              );
            }
            return null;
          })}
        </div>
        {audioClips.map((clip) => {
          const track = trackById(project, clip.trackId);
          return (
            <AudioLayer
              key={clip.id}
              clip={clip}
              asset={clip.source.type === 'asset' ? assetById(project, clip.source.assetId) : undefined}
              project={project}
              playheadFrame={playhead}
              playing={playing}
              trackId={track ? track.id : ''}
              trackGain={track ? trackGainDb(track) : 0}
            />
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
          <div className="safe-guides" aria-hidden="true">
            <span className="safe-action" />
            <span className="safe-title" />
          </div>
        ) : null}
        <span
          className="preview-timecode-chip"
          title={`${framesToSeconds(playhead, fps).toFixed(2)} s en la timeline`}
        >
          {formatTimecode(playhead, fps)}
        </span>
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
      </div>
    </div>
  );
}
