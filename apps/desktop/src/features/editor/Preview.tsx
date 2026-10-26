import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Asset, BlendMode, CaptionCue, Clip, ClipEffects, ClipMask, ProjectDocument, Track } from '@editor-ia/project-schema';
import { sampleMaskKeyframes } from '@editor-ia/project-schema';
import { captionMotionAt } from '../../state/caption-motion';
import { PreviewTransformBox, isTransformable } from './PreviewTransformBox';
import { cueWordsAt } from '../../state/subtitles';
import { framesToSeconds, fpsOf, formatTimecode, clipGainAtFrame, clipTransformAtFrame, updateProjectSettings } from '../../state/project-actions';
import { FORMAT_PRESETS } from '../../state/video-format';
import {
  attachPreviewAudio,
  detachPreviewAudio,
  isTrackAudible,
  resumePreviewAudio,
  syncPreviewAudioFromProject,
  trackGainDb,
} from '../mixer/usePreviewAudio';
import { useProjectStore } from '../../state/project-store';
import { loadEditorPreferences } from '../../state/editor-preferences';
import { Icon } from '../../components/Icon';
import { buildMotionPlan } from '../motion/plan';
import { MotionPreview } from '../motion/MotionPreview';
import { templateById } from '../motion/templates';
import { ScopesPanel } from './ScopesPanel';
import type { PreviewFrameResult } from '../../services/project-service';

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
  if (Math.abs(rotation) < 0.001 && !mask.invert) return undefined;
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
  let motionScale = 1;
  let motionX = 0;
  let motionY = 0;
  if (motion) {
    const progress =
      playheadFrame === undefined
        ? 0
        : Math.max(0, Math.min(1, (playheadFrame - clip.startFrame) / Math.max(1, clip.durationFrames)));
    const intensity = motion.intensity ?? 0.12;
    if (motion.type === 'zoom-in') motionScale = 1 + intensity * progress;
    if (motion.type === 'zoom-out') motionScale = 1 + intensity * (1 - progress);
    if (motion.type === 'pan-left') {
      motionScale = 1 + intensity;
      motionX = (0.5 - progress) * intensity * 50;
    }
    if (motion.type === 'pan-right') {
      motionScale = 1 + intensity;
      motionX = (progress - 0.5) * intensity * 50;
    }
    if (motion.type === 'pan-up') {
      motionScale = 1 + intensity;
      motionY = (0.5 - progress) * intensity * 50;
    }
    if (motion.type === 'pan-down') {
      motionScale = 1 + intensity;
      motionY = (progress - 0.5) * intensity * 50;
    }
  }
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
  return {
    transform: `translate(${offsetX * 100}%, ${offsetY * 100}%) translate(${motionX + animation.x}%, ${motionY + animation.y}%) scale(${scaleX * motionScale * animation.scale}, ${scaleY * motionScale * animation.scale}) rotate(${rotation + animation.rotation}deg)`,
    opacity: (sampled?.opacity ?? transform?.opacity ?? 1) * animation.opacity,
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
  };
}

function effectsToCss(effects: ClipEffects | undefined): CSSProperties {
  if (!effects) return {};
  const filters: string[] = [];
  if (effects.brightness !== undefined) filters.push(`brightness(${Math.max(0, 1 + effects.brightness)})`);
  if (effects.contrast !== undefined) filters.push(`contrast(${effects.contrast})`);
  if (effects.saturation !== undefined) filters.push(`saturate(${effects.saturation})`);
  if (effects.blur !== undefined && effects.blur > 0) filters.push(`blur(${effects.blur}px)`);
  if (effects.grayscale) filters.push('grayscale(1)');
  if (effects.sepia) filters.push('sepia(1)');
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
  return filters.length > 0 ? { filter: filters.join(' ') } : {};
}

function effectsStyle(clip: Clip): CSSProperties {
  if (!('effects' in clip) || !clip.effects) return {};
  return effectsToCss(clip.effects);
}

function assetById(project: ProjectDocument, id: string): Asset | undefined {
  return project.assets.find((asset) => asset.id === id);
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
  muted,
  trackId = '',
  trackGain = 0,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly muted: boolean;
  readonly trackId?: string;
  readonly trackGain?: number;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const ref = useRef<HTMLVideoElement | null>(null);
  // Enrutado por Web Audio: true sólo si el elemento quedó conectado al grafo
  // de su pista; en caso contrario la preview usa `element.volume` como siempre.
  const [routed, setRouted] = useState(false);
  const fps = fpsOf(project);
  const alphaCutout =
    asset !== undefined && asset.kind === 'video' && asset.media?.alpha === true;
  const proxy =
    asset && !alphaCutout && 'proxy' in asset
      ? (asset as Asset & { proxy?: { path: string } }).proxy
      : undefined;
  const url = asset ? store.service.mediaUrl(root, proxy?.path ?? asset.source.path) : '';
  const windowed = clip.kind === 'video' || clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  const speed = clip.kind === 'video' ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1) : 1;
  const sourceSeconds = source
    ? (source.inFrame + Math.max(0, playheadFrame - clip.startFrame) * speed) / fps
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
    const ok = attachPreviewAudio(trackId, media);
    setRouted(ok);
    return () => {
      if (ok) detachPreviewAudio(trackId, media);
    };
  }, [trackId, url]);

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

  if (!url) {
    return (
      <div className="media-missing" style={{ ...transformStyle(clip, project, playheadFrame), ...effectsStyle(clip) }}>
        <span>Medio no disponible en la vista previa</span>
      </div>
    );
  }

  return (
    <video
      ref={ref}
      className="preview-media"
      src={url}
      crossOrigin="anonymous"
      data-clip-id={clip.id}
      style={{ ...transformStyle(clip, project, playheadFrame), ...effectsStyle(clip) }}
      muted={muted}
      playsInline
      preload="auto"
    />
  );
}

function ImageLayer({
  clip,
  asset,
  project,
  playheadFrame,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  if (!url) {
    return (
      <div className="media-missing" style={{ ...transformStyle(clip, project, playheadFrame), ...effectsStyle(clip) }}>
        <span>Imagen no disponible</span>
      </div>
    );
  }
  return (
    <img
      className="preview-media"
      src={url}
      crossOrigin="anonymous"
      data-clip-id={clip.id}
      alt={clip.label ?? 'Imagen de la timeline'}
      style={{ ...transformStyle(clip, project, playheadFrame), ...effectsStyle(clip) }}
    />
  );
}

function GraphicLayer({
  clip,
  project,
  playheadFrame,
}: {
  readonly clip: Clip;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
}) {
  const motionId = clip.source.type === 'graphic' ? clip.source.motionId : null;
  const motion = project.motion.find((item) => item.id === motionId);
  const layerStyle = {
    position: 'absolute' as const,
    inset: 0,
    ...transformStyle(clip, project, playheadFrame),
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
    const ok = attachPreviewAudio(trackId, media);
    setRouted(ok);
    return () => {
      if (ok) detachPreviewAudio(trackId, media);
    };
  }, [trackId, url]);

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
        return (
          <div
            key={cue.id}
            className={`preview-caption caption-${position}`}
            style={{ zIndex: 6 + (track?.order ?? 0) + index }}
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

  useEffect(() => {
    setRealFrame(null);
    setPixelPerfect(false);
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

  const visualClips = useMemo(() => {
    if (!project) return [];
    return project.timeline.clips
      .filter((clip) => {
        const track = trackById(project, clip.trackId);
        if (!track || track.hidden) return false;
        if (!['video', 'image', 'graphic'].includes(track.kind)) return false;
        if (clip.enabled === false) return false;
        return playhead >= clip.startFrame && playhead < clip.startFrame + clip.durationFrames;
      })
      .sort((a, b) => {
        const orderA = trackById(project, a.trackId)?.order ?? 0;
        const orderB = trackById(project, b.trackId)?.order ?? 0;
        return orderA - orderB;
      });
  }, [playhead, project]);

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
  const lookStyle = compare ? {} : effectsToCss(project.look);
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
    try {
      const result = await store.service.renderPreviewFrame({
        project,
        clipId: target.id,
        frame: playhead,
        native,
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
          onPointerDown={(event) => {
            const target = (event.target as HTMLElement).closest('[data-clip-id]');
            const id = target?.getAttribute('data-clip-id');
            if (id) store.setSelection({ kind: 'clip', id });
          }}
        >
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
