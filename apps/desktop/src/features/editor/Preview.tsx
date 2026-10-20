import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Asset, BlendMode, CaptionCue, Clip, ClipEffects, ClipMask, ProjectDocument, Track } from '@editor-ia/project-schema';
import { sampleMaskKeyframes } from '@editor-ia/project-schema';
import { framesToSeconds, fpsOf, formatTimecode, clipGainAtFrame, clipTransformAtFrame } from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';
import { Icon } from '../../components/Icon';

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

function maskClipPath(mask: ClipMask): string {
  const clamp = (value: number): number => Math.max(0, Math.min(100, value));
  const centerX = clamp(50 + mask.x * 50);
  const centerY = clamp(50 + mask.y * 50);
  if (mask.shape === 'ellipse') {
    return `ellipse(${clamp(mask.width * 50)}% ${clamp(
      mask.height * 50,
    )}% at ${centerX}% ${centerY}%)`;
  }
  const left = clamp(centerX - mask.width * 50);
  const top = clamp(centerY - mask.height * 50);
  const right = clamp(100 - (centerX + mask.width * 50));
  const bottom = clamp(100 - (centerY + mask.height * 50));
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

/**
 * Rotated masks and inverted masks are drawn as an inline SVG mask so the
 * preview matches the per-pixel `geq` mask of the renderer. Unrotated,
 * non-inverted masks keep the cheaper clip-path.
 */
function maskImage(mask: ClipMask): string | undefined {
  const rotation = mask.rotationDeg ?? 0;
  if (Math.abs(rotation) < 0.001 && !mask.invert) return undefined;
  const centerX = 50 + mask.x * 50;
  const centerY = 50 + mask.y * 50;
  const radiusX = mask.width * 50;
  const radiusY = mask.height * 50;
  const feather = Math.max(0.001, mask.feather) * 14;
  const fill = mask.invert ? 'black' : 'white';
  const shape =
    mask.shape === 'ellipse'
      ? `<ellipse cx="${centerX}" cy="${centerY}" rx="${radiusX}" ry="${radiusY}" fill="${fill}" transform="rotate(${rotation} ${centerX} ${centerY})" filter="url(#soft)"/>`
      : `<rect x="${centerX - radiusX}" y="${centerY - radiusY}" width="${radiusX * 2}" height="${radiusY * 2}" fill="${fill}" transform="rotate(${rotation} ${centerX} ${centerY})" filter="url(#soft)"/>`;
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
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly playing: boolean;
  readonly muted: boolean;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const ref = useRef<HTMLVideoElement | null>(null);
  const fps = fpsOf(project);
  const proxy =
    asset && 'proxy' in asset
      ? (asset as Asset & { proxy?: { path: string } }).proxy
      : undefined;
  const url = asset ? store.service.mediaUrl(root, proxy?.path ?? asset.source.path) : '';
  const windowed = clip.kind === 'video' || clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  const speed = clip.kind === 'video' ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1) : 1;
  const sourceSeconds = source
    ? (source.inFrame + Math.max(0, playheadFrame - clip.startFrame) * speed) / fps
    : 0;
  const volume = muted
    ? 0
    : volumeFromDb(
        clipGainAtFrame(
          clip,
          Math.max(0, Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame)),
        ),
      );

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
      alt={clip.label ?? 'Imagen de la timeline'}
      style={{ ...transformStyle(clip, project, playheadFrame), ...effectsStyle(clip) }}
    />
  );
}

function GraphicLayer({
  clip,
  project,
}: {
  readonly clip: Clip;
  readonly project: ProjectDocument;
}) {
  const motionId = clip.source.type === 'graphic' ? clip.source.motionId : null;
  const motion = project.motion.find((item) => item.id === motionId);
  if (!motion) {
    return null;
  }
  if (motion.template.id === 'lower-third') {
    const label = typeof motion.props.label === 'string' ? motion.props.label : 'Editor IA';
    const accent = typeof motion.props.accentColor === 'string' ? motion.props.accentColor : '#7dd3c0';
    return (
      <div className="lower-third" style={{ ...transformStyle(clip, project), borderColor: accent }}>
        <span style={{ background: accent }} />
        <strong>{label}</strong>
      </div>
    );
  }
  return (
    <div className="graphic-placeholder" style={transformStyle(clip, project)}>
      Plantilla {motion.template.id} sin motor de preview
    </div>
  );
}

function AudioLayer({
  clip,
  asset,
  project,
  playheadFrame,
  playing,
}: {
  readonly clip: Clip;
  readonly asset: Asset | undefined;
  readonly project: ProjectDocument;
  readonly playheadFrame: number;
  readonly playing: boolean;
}) {
  const store = useProjectStore();
  const root = store.state.opened?.root ?? '';
  const ref = useRef<HTMLAudioElement | null>(null);
  const fps = fpsOf(project);
  const windowed = clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  const speed = clip.kind === 'audio' ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1) : 1;
  const sourceSeconds = source
    ? (source.inFrame + Math.max(0, playheadFrame - clip.startFrame) * speed) / fps
    : 0;
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  const volume = volumeFromDb(
    clipGainAtFrame(
      clip,
      Math.max(0, Math.min(clip.durationFrames - 1, playheadFrame - clip.startFrame)),
    ),
  );

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
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing, sourceSeconds, url]);

  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);

  if (!url) return null;
  return <audio ref={ref} src={url} preload="auto" />;
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
        const hasWords = cue.words !== undefined && cue.words.length > 1;
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
          fontFamily: style?.fontFamily ? `"${style.fontFamily}", sans-serif` : undefined,
          fontWeight: style?.bold ? 800 : 500,
          fontStyle: style?.italic ? 'italic' : 'normal',
          WebkitTextStroke: boxed ? undefined : `${Math.max(1, fontSize * 0.03)}px ${outline}`,
          textShadow: shadows.length > 0 ? shadows.join(', ') : undefined,
          ...(background
            ? { background, padding: '0.06em 0.28em', borderRadius: '0.12em' }
            : {}),
        };
        return (
          <div
            key={cue.id}
            className={`preview-caption caption-${position}`}
            style={{ zIndex: 6 + (track?.order ?? 0) + index }}
            aria-live="off"
          >
            {hasWords ? (
              <span className="caption-words" style={spanStyle}>
                {cue.words!.map((word, wordIndex) => {
                  const highlighted =
                    playheadFrame >= word.startFrame && playheadFrame < word.endFrame;
                  return (
                    <span
                      key={`${word.startFrame}-${wordIndex}`}
                      className={highlighted ? 'caption-word active' : 'caption-word'}
                      style={{ color: highlighted ? '#5eead4' : color }}
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
  const [showGuides, setShowGuides] = useState(false);
  const [compare, setCompare] = useState(false);
  const fps = project ? fpsOf(project) : 30;
  const playhead = store.state.playheadFrame;
  const playing = store.state.playing;

  const visualClips = useMemo(() => {
    if (!project) return [];
    return project.timeline.clips
      .filter((clip) => {
        const track = trackById(project, clip.trackId);
        if (!track || track.hidden) return false;
        if (!['video', 'image', 'graphic'].includes(track.kind)) return false;
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
      if (!track || track.muted) return false;
      if (!['audio', 'narration'].includes(track.kind)) return false;
      return playhead >= clip.startFrame && playhead < clip.startFrame + clip.durationFrames;
    });
  }, [playhead, project]);

  const adjustmentFilter = useMemo(() => {
    if (!project || compare) return '';
    return project.timeline.clips
      .filter((clip): clip is Extract<Clip, { kind: 'adjustment' }> => {
        if (clip.kind !== 'adjustment') return false;
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

  return (
    <div
      className="preview-stage"
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
        {usingProxy ? (
          <span className="preview-hud-chip proxy" title="La preview usa un proxy; el MP4 usa el original">
            PROXY
          </span>
        ) : null}
      </div>
      <div className="preview-tools">
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
          className={showGuides ? 'preview-tool active' : 'preview-tool'}
          aria-pressed={showGuides}
          aria-label="Guías de composición"
          title="Guías de composición"
          onClick={() => setShowGuides((value) => !value)}
        >
          <Icon name="grid" size={13} />
          <span>Guías</span>
        </button>
      </div>
      <div
        className="preview-canvas"
        style={{
          width: frameWidth > 0 ? frameWidth : '100%',
          height: frameHeight > 0 ? frameHeight : undefined,
          aspectRatio: `${project.video.width} / ${project.video.height}`,
          backgroundColor: project.video.backgroundColor ?? '#0b0e13',
        }}
      >
        <div className="preview-look" style={previewStyle}>
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
                  muted={track?.muted ?? false}
                />
              );
            }
            if (clip.kind === 'image') {
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
              return <GraphicLayer key={clip.id} clip={clip} project={project} />;
            }
            return null;
          })}
        </div>
        {audioClips.map((clip) => (
          <AudioLayer
            key={clip.id}
            clip={clip}
            asset={clip.source.type === 'asset' ? assetById(project, clip.source.assetId) : undefined}
            project={project}
            playheadFrame={playhead}
            playing={playing}
          />
        ))}
        <CaptionOverlay project={project} playheadFrame={playhead} previewWidth={frameWidth} />
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
