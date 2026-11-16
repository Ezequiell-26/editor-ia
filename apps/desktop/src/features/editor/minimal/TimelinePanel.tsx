import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { Asset } from '@editor-ia/project-schema';
import { Icon } from '../../../components/Icon';
import { peaksForWindow, useWaveform } from '../../../hooks/useWaveform';
import { useThumbnail } from '../../../hooks/useThumbnail';
import type { DesktopService } from '../../../services/project-service';
import {
  RULER_EMPTY, RULER_STUDIO, TIMELINE_TOOLS_LEFT, TIMELINE_TOOLS_RIGHT,
  asset, type Scene,
} from './model';
import { Waveform } from './controls';

export interface TimelinePanelProps {
  readonly scene: Scene;
  readonly playheadLeft: number;
  readonly onSeek: (ratio: number) => void;
  readonly clipBlocks: readonly {
    readonly id: string;
    readonly left: number;
    readonly width: number;
    /** Fuente real del clip para la forma de onda (sólo video/audio con asset). */
    readonly kind?: string;
    readonly assetId?: string | null;
    readonly inFrame?: number;
    readonly outFrame?: number;
  }[];
  /** Escala horizontal real: 1 = ajuste medido en la referencia. */
  readonly zoom?: number;
  readonly onTool?: (label: string) => void;
  readonly onSelectClip?: (id: string) => void;
  readonly selectedClipId?: string | null;
  /** Clips/audio de muestra de la réplica: sólo en el arnés de medición. */
  readonly demoContent?: boolean;
  /** Contexto para la forma de onda real de cada clip (UI-002). */
  readonly service?: DesktopService | null;
  readonly projectRoot?: string | null;
  readonly assets?: readonly Asset[];
  readonly projectFps?: number;
}

function ClipStrip({ left, width, thumb, label, variant = 0, zoom }: {
  readonly left: number;
  readonly width: number;
  readonly thumb: string;
  readonly label?: string;
  readonly variant?: number;
  readonly zoom: number;
}): ReactNode {
  return (
    <span
      className={`me-tl-clip v${variant}`}
      style={{ left: `${left * zoom}%`, width: `${width * zoom}%` }}
      aria-hidden="true"
    >
      <span className="me-tl-clip-film">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <img key={index} src={thumb} alt="" draggable={false} />
        ))}
      </span>
      {label ? <em>{label}</em> : null}
    </span>
  );
}

/** Buckets por clip: el bloque mide ~1-3 % del ancho, 64 barras alcanzan. */
const CLIP_WAVE_BUCKETS = 64;
const CLIP_WAVE_HEIGHT = 14;

/**
 * UI-002: contenido real del clip — miniatura del asset (`useThumbnail`,
 * misma fuente que la biblioteca) y forma de onda verdadera del audio
 * (`useWaveform` + `peaksForWindow` sobre `inFrame..outFrame`, el mismo
 * cálculo que la timeline principal). Sin datos devuelve solo lo que haya:
 * nunca thumbnails ni picos inventados.
 */
function ClipMedia({ service, root, asset, kind, inFrame, outFrame, fps }: {
  readonly service: DesktopService;
  readonly root: string | null;
  readonly asset: Asset;
  readonly kind: string;
  readonly inFrame: number;
  readonly outFrame: number;
  readonly fps: number;
}): ReactNode {
  const thumb = useThumbnail(service, asset, root);
  const isWaveKind = kind === 'video' || kind === 'audio';
  const media = 'media' in asset ? asset.media : undefined;
  const assetFrames = media && 'durationFrames' in media ? media.durationFrames : 0;
  const all = useWaveform(service, root, isWaveKind ? asset : null, CLIP_WAVE_BUCKETS, fps);
  const peaks = all && assetFrames > 0
    ? peaksForWindow(all, inFrame, outFrame, assetFrames)
    : all;
  const count = peaks && peaks.length > 0 ? Math.min(peaks.length, CLIP_WAVE_BUCKETS) : 0;
  const step = 100 / Math.max(1, count);
  return (
    <>
      {thumb ? (
        <img className="me-clip-thumb" src={thumb} alt="" draggable={false} />
      ) : null}
      {count > 0 ? (
        <svg
          className="me-clip-wave"
          viewBox={`0 0 100 ${CLIP_WAVE_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {Array.from({ length: count }, (_, i) => {
            const amplitude = Math.min(1, Math.abs(peaks?.[i] ?? 0));
            const h = Math.max(1, amplitude * (CLIP_WAVE_HEIGHT - 2));
            return (
              <rect
                key={i}
                x={i * step}
                y={(CLIP_WAVE_HEIGHT - h) / 2}
                width={Math.max(0.4, step * 0.6)}
                height={h}
                rx={0.2}
              />
            );
          })}
        </svg>
      ) : null}
    </>
  );
}

export function TimelinePanel({
  scene, playheadLeft, onSeek, clipBlocks, zoom = 1, onTool, onSelectClip,
  selectedClipId, demoContent = false, service = null, projectRoot = null,
  assets = [], projectFps = 30,
}: TimelinePanelProps): ReactNode {
  const isStudio = scene === 'studio';
  const isEmpty = scene === 'empty';
  const ruler = isStudio ? RULER_STUDIO : RULER_EMPTY;
  const zoomPercent = Math.round(((zoom - 0.5) / 2.5) * 100);
  const safeZoom = Number.isFinite(zoom) ? zoom : 1;

  const handleSeek = (event: MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width / safeZoom;
    onSeek(Math.min(1, Math.max(0, ratio)));
  };

  const handleSeekKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === 'ArrowRight') onSeek(Math.min(1, playheadLeft / 100 + step));
    else if (event.key === 'ArrowLeft') onSeek(Math.max(0, playheadLeft / 100 - step));
    else if (event.key === 'Home') onSeek(0);
    else if (event.key === 'End') onSeek(1);
    else return;
    event.preventDefault();
  };

  return (
    <section className="me-timeline" aria-label="Timeline">
      <div className="me-tl-toolbar">
        <div className="me-tl-tools-left">
          {TIMELINE_TOOLS_LEFT.map((tool, index) => (
            <button
              type="button"
              key={`${tool.label}-${index}`}
              aria-label={tool.label}
              title={tool.label}
              className={index === 1 ? 'me-tl-accent' : ''}
              onClick={() => onTool?.(tool.label)}
            >
              <Icon name={tool.icon} size={12} />
            </button>
          ))}
        </div>
        <div className="me-tl-tools-right">
          {TIMELINE_TOOLS_RIGHT.map((tool, index) => (
            <button
              type="button"
              key={`${tool.label}-${index}`}
              aria-label={tool.label}
              title={tool.label}
              className={index < 4 ? 'me-tl-accent' : ''}
              onClick={() => onTool?.(tool.label)}
            >
              <Icon name={tool.icon} size={12} />
            </button>
          ))}
          <span className="me-zoom" role="group" aria-label="Zoom de la timeline">
            <button type="button" aria-label="Menos zoom" title="Alejar" onClick={() => onTool?.('Menos zoom')}>
              <Icon name="search" size={11} />
            </button>
            <i style={{
              background: `linear-gradient(90deg, var(--me-accent) ${zoomPercent}%, #3a3942 ${zoomPercent}%)`,
              '--me-zoom-knob': `${zoomPercent}%`,
            } as CSSProperties} aria-hidden="true" />
            <button type="button" aria-label="Mais zoom" title="Acercar" onClick={() => onTool?.('Mais zoom')}>
              <Icon name="search" size={13} />
            </button>
          </span>
          <button type="button" aria-label="Mais zoom" title="Acercar" onClick={() => onTool?.('Mais zoom')}>
            <Icon name="plus" size={12} />
          </button>
        </div>
      </div>

      <div
        className="me-tl-ruler"
        onClick={handleSeek}
        onKeyDown={handleSeekKey}
        role="slider"
        tabIndex={0}
        aria-label="Posición de reproducción"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(playheadLeft)}
      >
        {ruler.map((tick, index) => {
          const left = (index / (ruler.length - 1)) * 100 * safeZoom;
          return left <= 100
            ? <span key={`${tick}-${index}`} style={{ left: `${left}%` }}>{tick}</span>
            : null;
        })}
      </div>

      <div className={`me-tl-tracks ${isStudio ? 'me-tl-tracks-studio' : ''}`}>
        <div className="me-tl-headers" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div className="me-tl-header" key={row}>
              <span className="me-track-dot" />
              <Icon name="eye" size={10} />
              <Icon name="minus" size={10} />
            </div>
          ))}
        </div>
        <div className="me-tl-lanes">
          <div className="me-tl-lane" />
          <div className="me-tl-lane" />
          <div className="me-tl-lane me-tl-lane-audio" />

          {demoContent && !isEmpty && !isStudio ? (
            <>
              <ClipStrip left={0} width={12} thumb={asset('thumb-02.png')} label="tudo começa" zoom={safeZoom} />
              <ClipStrip left={12} width={10} thumb={asset('thumb-12.png')} zoom={safeZoom} />
              <ClipStrip left={0} width={14} thumb={asset('thumb-10.png')} variant={1} zoom={safeZoom} />
              <span className="me-tl-audio-strip" aria-hidden="true">
                <Waveform blocks={180} height={16} seed={2} />
                <em>audio para testes.mp3 · 00:57</em>
              </span>
            </>
          ) : null}

          {demoContent && isStudio ? (
            <>
              <ClipStrip left={0} width={9} thumb={asset('studio-thumb-1.png')} zoom={safeZoom} />
              <ClipStrip left={9} width={9} thumb={asset('studio-thumb-1.png')} zoom={safeZoom} />
              <ClipStrip left={18} width={9} thumb={asset('studio-thumb-1.png')} zoom={safeZoom} />
              <span className="me-tl-audio-strip studio" aria-hidden="true"><Waveform blocks={220} height={16} seed={5} /></span>
            </>
          ) : null}

          {clipBlocks.map((clip) => {
            const clipAsset = clip.assetId
              ? assets.find((entry) => entry.id === clip.assetId) ?? null
              : null;
            const mediaAsset = service && clipAsset
              && (clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image')
              ? clipAsset
              : null;
            return (
              <button
                key={clip.id}
                type="button"
                className={`me-clip${selectedClipId === clip.id ? ' selected' : ''}`}
                style={{ left: `${clip.left * safeZoom}%`, width: `${clip.width * safeZoom}%` }}
                aria-label={`Seleccionar clip ${clip.id}`}
                aria-pressed={selectedClipId === clip.id}
                onClick={() => onSelectClip?.(clip.id)}
              >
                {service && mediaAsset && clip.kind ? (
                  <ClipMedia
                    service={service}
                    root={projectRoot}
                    asset={mediaAsset}
                    kind={clip.kind}
                    inFrame={clip.inFrame ?? 0}
                    outFrame={clip.outFrame ?? clip.inFrame ?? 0}
                    fps={projectFps}
                  />
                ) : null}
              </button>
            );
          })}

          <div className="me-playhead" style={{ left: `${playheadLeft * safeZoom}%` }} />
          {isEmpty ? (
            <p className="me-tl-empty"><Icon name="plus" size={10} /> Arraste um material aqui e comece a edição</p>
          ) : null}
        </div>
      </div>

      {isStudio ? (
        <div className="me-tl-scroll" aria-hidden="true"><span /></div>
      ) : null}
    </section>
  );
}
