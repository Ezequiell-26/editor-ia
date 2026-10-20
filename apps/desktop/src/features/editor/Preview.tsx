import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Asset, CaptionCue, Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { framesToSeconds, fpsOf, formatTimecode } from '../../state/project-actions';
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

function transformStyle(
  clip: Clip,
  project: ProjectDocument,
  playheadFrame?: number,
): CSSProperties {
  const transform = clip.transform;
  const offsetX = (transform?.offsetX ?? 0) / project.video.width;
  const offsetY = (transform?.offsetY ?? 0) / project.video.height;
  const scaleX = transform?.scaleX ?? 1;
  const scaleY = transform?.scaleY ?? 1;
  const rotation = transform?.rotationDeg ?? 0;
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
  return {
    transform: `translate(${offsetX * 100}%, ${offsetY * 100}%) translate(${motionX}%, ${motionY}%) scale(${scaleX * motionScale}, ${scaleY * motionScale}) rotate(${rotation}deg)`,
    opacity: transform?.opacity ?? 1,
  };
}

function effectsStyle(clip: Clip): CSSProperties {
  if (!('effects' in clip) || !clip.effects) return {};
  const effects = clip.effects;
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
  return filters.length > 0 ? { filter: filters.join(' ') } : {};
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
  const url = asset ? store.service.mediaUrl(root, asset.source.path) : '';
  const windowed = clip.kind === 'video' || clip.kind === 'audio';
  const source = windowed ? clip.source : null;
  const speed = clip.kind === 'video' ? (clip.speed?.num ?? 1) / (clip.speed?.den ?? 1) : 1;
  const sourceSeconds = source
    ? (source.inFrame + Math.max(0, playheadFrame - clip.startFrame) * speed) / fps
    : 0;
  const volume = muted ? 0 : volumeFromDb(clip.audio?.gainDb);

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
  const volume = volumeFromDb(clip.audio?.gainDb);

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
  const active: CaptionCue | undefined = project.captions.cues.find((cue) => {
    const track = trackById(project, cue.trackId);
    return (
      track?.kind === 'caption' &&
      !track.hidden &&
      playheadFrame >= cue.startFrame &&
      playheadFrame < cue.endFrame
    );
  });
  if (!active) return null;
  const style = project.captions.styles.find((item) => item.id === active.styleId) ?? project.captions.styles[0];
  const scale = previewWidth > 0 ? previewWidth / project.video.width : 1;
  const fontSize = Math.max(10, (style?.fontSizePx ?? 54) * scale);
  const color = style?.color ?? '#ffffff';
  const outline = style?.outlineColor ?? '#000000';
  const position = style?.position ?? 'bottom';
  const hasWords = active.words && active.words.length > 1;
  return (
    <div className={`preview-caption caption-${position}`} aria-live="off">
      {hasWords ? (
        <span
          className="caption-words"
          style={{
            fontSize,
            WebkitTextStroke: `${Math.max(1, fontSize * 0.03)}px ${outline}`,
            textShadow: '0 2px 12px rgba(0,0,0,0.75)',
          }}
        >
          {active.words!.map((word, index) => {
            const highlighted =
              playheadFrame >= word.startFrame && playheadFrame < word.endFrame;
            return (
              <span
                key={`${word.startFrame}-${index}`}
                className={highlighted ? 'caption-word active' : 'caption-word'}
                style={{ color: highlighted ? '#5eead4' : color }}
              >
                {word.text}{' '}
              </span>
            );
          })}
        </span>
      ) : (
        <span
          style={{
            color,
            fontSize,
            WebkitTextStroke: `${Math.max(1, fontSize * 0.03)}px ${outline}`,
            textShadow: '0 2px 12px rgba(0,0,0,0.75)',
          }}
        >
          {active.text}
        </span>
      )}
    </div>
  );
}

export function Preview() {
  const store = useProjectStore();
  const project = store.state.project;
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>();
  const [showGuides, setShowGuides] = useState(false);
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

  if (!project) {
    return <div className="preview-empty">Abrí un proyecto para ver la vista previa.</div>;
  }

  const aspect = project.video.width / Math.max(1, project.video.height);
  const frameWidth =
    stageSize.width > 0 && stageSize.height > 0
      ? Math.min(stageSize.width, stageSize.height * aspect)
      : 0;
  const frameHeight = frameWidth > 0 ? frameWidth / aspect : 0;

  return (
    <div className="preview-stage" ref={stageRef}>
      <div className="preview-hud" aria-hidden="true">
        <span className="preview-hud-chip strong">
          {project.video.width}×{project.video.height}
        </span>
        <span className="preview-hud-chip">{fps} fps</span>
        <span className="preview-hud-chip preview-hud-render" title="El render final usa FFmpeg">
          Vista previa aproximada
        </span>
      </div>
      <div className="preview-tools">
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
