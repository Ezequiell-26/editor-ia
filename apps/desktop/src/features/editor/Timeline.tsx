import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Asset, CaptionCue, Clip, ClipColorTag, ClipEffects, ProjectDocument, Track } from '@editor-ia/project-schema';
import { useThumbnail } from '../../hooks/useThumbnail';
import { peaksForWindow, useWaveform } from '../../hooks/useWaveform';
import { Icon } from '../../components/Icon';
import { friendlyAssetLabel } from '../../state/asset-labels';
import { clipColorHex, CLIP_COLORS, clipMatchesColorFilter } from '../../state/clip-colors';
import { matchesClipSearch } from '../../state/clip-search';
import {
  applyClipAttributes,
  copyClipAttributes,
  getClipAttributesClipboard,
  hasClipAttributesClipboard,
  pasteAttributesToColor,
  setClipAttributesClipboard,
} from '../../state/clip-attributes';
import { fadeFramesForDrag } from '../../state/fade-handles';
import {
  ProjectActionError,
  addAdjustmentLayer,
  addTrack,
  deleteCaptionCue,
  closeGaps,
  deleteClip,
  magneticMoveClip,
  duplicateClip,
  formatTimecode,
  fpsOf,
  moveClip,
  pasteClip,
  splitClip,
  trimClip,
  totalFrames,
  updateCaptionCue,
  updateClip,
  updateTrack,
} from '../../state/project-actions';
import { addMarker, deleteMarker, markerAtFrame } from '../../state/markers';
import { useProjectStore } from '../../state/project-store';
import { updateEditorPreferences } from '../../state/editor-preferences';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import { TimelineOverview } from './TimelineOverview';
import { createRafCoalescer } from './timeline-raf';
import {
  deleteClips,
  moveClipsBy,
  rippleMoveClip,
  rippleTrim,
} from './timeline-edits';
import {
  beatFramesFromPeaks,
  collectTimelineSnapTargets,
  sceneSnapPoints,
  snapFrameTo,
  snapSpanTo,
  snapThreshold,
} from './timeline-snap';
import {
  spanIntersectsWindow,
  visibleFrameWindow,
  visibleTrackWindow,
  type FrameWindow,
} from './timeline-viewport';

/**
 * Ancho del header de pistas. La fuente de verdad es `--tl-track-head-w`
 * (spec §7.5: 160 px); el fallback 160 es el mismo valor del token y mantiene
 * la geometría del test de arrastre en jsdom (donde no hay CSS de la app).
 */
const HEADER_FALLBACK = 160;

/**
 * Ancho real de la columna de cabecera.
 *
 * Antes se leía el token `--tl-track-head-w`, que no está definido en ningún
 * CSS: caía siempre en 160 aunque la columna mida 152, así que el cabezal
 * quedaba 8 px a la izquierda del clic. Se mide el DOM —la esquina de la regla
 * siempre existe— y el token queda sólo como respaldo.
 */
function headerWidth(): number {
  if (typeof document === 'undefined') return HEADER_FALLBACK;
  const corner = document.querySelector<HTMLElement>('.timeline .ruler-corner');
  const head = corner ?? document.querySelector<HTMLElement>('.timeline .track-head');
  const measured = head?.offsetWidth ?? 0;
  if (measured > 0) return measured;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--tl-track-head-w')
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : HEADER_FALLBACK;
}

/** Alto por defecto de una pista: el del usuario (`--timeline-row`, 34–76). */
const CAPTION_ROW_HEIGHT = 42;
const ROW_HEIGHT_FALLBACK = 48;
let cachedRowHeight: number | null = null;

function defaultRowHeight(kind: string): number {
  if (kind === 'caption') return CAPTION_ROW_HEIGHT;
  if (cachedRowHeight !== null) return cachedRowHeight;
  if (typeof document === 'undefined') return ROW_HEIGHT_FALLBACK;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--timeline-row').trim();
  const parsed = Number.parseFloat(raw);
  cachedRowHeight = Number.isFinite(parsed) && parsed > 0 ? parsed : ROW_HEIGHT_FALLBACK;
  return cachedRowHeight;
}

type Drag =
  | {
      kind: 'scrub';
    }
  | {
      kind: 'clip';
      clipId: string;
      mode: 'move' | 'trim-start' | 'trim-end';
      originX: number;
      originalStart: number;
      originalDuration: number;
      previewStart: number;
      previewDuration: number;
      previewTrackId: string;
      /** Multi-selección: ids que se mueven junto con el clip arrastrado. */
      groupIds?: readonly string[];
      /** Desplazamiento en frames del grupo (sólo modo move). */
      groupDelta?: number;
    }
  | {
      kind: 'cue';
      cueId: string;
      originX: number;
      originalStart: number;
      originalEnd: number;
      previewStart: number;
      previewEnd: number;
    };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function trackById(project: ProjectDocument, id: string): Track | undefined {
  return project.timeline.tracks.find((track) => track.id === id);
}

function assetById(project: ProjectDocument, id: string): Asset | undefined {
  return project.assets.find((asset) => asset.id === id);
}

function applyFadeFrames(
  project: ProjectDocument,
  clipId: string,
  side: 'in' | 'out',
  frames: number,
  audioOnly: boolean,
): ProjectDocument {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return project;
  const key = side === 'in' ? 'fadeInFrames' : 'fadeOutFrames';
  if (audioOnly) {
    const audio = { ...(clip.audio ?? {}) };
    if (frames > 0) audio[key] = frames;
    else delete audio[key];
    return updateClip(project, clipId, { audio });
  }
  const effects: ClipEffects = {
    ...(('effects' in clip ? clip.effects : undefined) ?? {}),
  };
  if (frames > 0) effects[key] = frames;
  else delete effects[key];
  return updateClip(project, clipId, { effects });
}

/**
 * Envolvente simétrica de la forma de onda en un único `<path>`.
 *
 * Antes cada clip dibujaba hasta 600 `<rect>`: con 20 clips de audio eran
 * ~12.000 nodos SVG que React reconciliaba en cada frame de reproducción (el
 * mayor coste de render del timeline). El mismo dibujo —picos espejados estilo
 * DAW— en un solo path deja ~20 nodos en toda la pista y se ve más parejo
 * porque muestrea una columna cada ~1,5 px del clip.
 */
export function waveformPath(peaks: readonly number[], columns: number): string {
  if (peaks.length === 0 || columns < 2) return '';
  const cols = Math.max(2, Math.round(columns));
  const step = peaks.length / cols;
  const upper: string[] = [];
  const lower: string[] = [];
  for (let index = 0; index < cols; index += 1) {
    const from = Math.floor(index * step);
    const to = Math.max(from + 1, Math.min(peaks.length, Math.floor((index + 1) * step)));
    let peak = 0;
    for (let cursor = from; cursor < to; cursor += 1) {
      const value = peaks[cursor] ?? 0;
      if (value > peak) peak = value;
    }
    // Piso de 0,8 unidades: un silencio se lee como línea, no desaparece.
    const half = Math.max(0.8, Math.min(1, peak) * 18);
    const x = (index + 0.5).toFixed(2);
    upper.push(`${x},${(20 - half).toFixed(2)}`);
    lower.push(`${x},${(20 + half).toFixed(2)}`);
  }
  lower.reverse();
  return `M${upper.join('L')}L${lower.join('L')}Z`;
}

/** Columnas de la onda: una cada ~1,5 px del clip, con techo de 480. */
export function waveformColumns(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return 2;
  return Math.max(2, Math.min(480, Math.round(widthPx / 1.5)));
}

function ClipBlockView({
  clip,
  track,
  pxPerFrame,
  selected,
  dimmed,
  preview,
  showThumbnail,
  showWaveform,
  onSelect,
  onSeek,
  onDrag,
  onContextMenu,
}: {
  readonly clip: Clip;
  readonly track: Track;
  readonly pxPerFrame: number;
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly preview: Drag | null;
  readonly showThumbnail: boolean;
  readonly showWaveform: boolean;
  readonly onSelect: (event?: ReactPointerEvent | ReactMouseEvent) => void;
  readonly onSeek: (event: ReactPointerEvent) => void;
  readonly onDrag: (event: ReactPointerEvent, mode: 'move' | 'trim-start' | 'trim-end') => void;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const root = store.state.opened?.root ?? '';
  const asset = clip.source.type === 'asset' && project ? assetById(project, clip.source.assetId) : undefined;
  // Con la capa apagada no se pide miniatura ni forma de onda: el hook recibe
  // null y no dispara trabajo de disco.
  const thumbnail = useThumbnail(store.service, showThumbnail ? asset ?? null : null, root || null);
  const waveform = useWaveform(
    store.service,
    root || null,
    showWaveform ? asset ?? null : null,
  );
  const activePreview =
    preview && preview.kind === 'clip' && preview.clipId === clip.id ? preview : null;
  // Arrastre de grupo: los clips no primarios siguen el mismo delta en preview.
  const groupPreview =
    preview &&
    preview.kind === 'clip' &&
    preview.mode === 'move' &&
    preview.groupDelta !== undefined &&
    preview.groupIds?.includes(clip.id) &&
    preview.clipId !== clip.id
      ? preview
      : null;
  const start =
    activePreview?.previewStart ??
    (groupPreview ? clip.startFrame + (groupPreview.groupDelta ?? 0) : clip.startFrame);
  const duration = activePreview?.previewDuration ?? clip.durationFrames;
  const left = start * pxPerFrame;
  const width = Math.max(3, duration * pxPerFrame);
  const isWindowed = clip.kind === 'video' || clip.kind === 'audio';
  const sourceWindow = clip.kind === 'video' || clip.kind === 'audio' ? clip.source : null;
  const assetMedia = asset && 'media' in asset ? asset.media : undefined;
  const assetFrames =
    assetMedia && 'durationFrames' in assetMedia ? assetMedia.durationFrames : 0;
  const peaks =
    waveform && asset && sourceWindow
      ? peaksForWindow(waveform, sourceWindow.inFrame, sourceWindow.outFrame, assetFrames)
      : null;
  const waveColumns = waveformColumns(width);
  const clipLabel = clip.label ? friendlyAssetLabel(clip.label) : track.label;
  const colorHex = clipColorHex(clip.colorTag);
  const fade =
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze'
      ? {
          inFrames: clip.effects?.fadeInFrames ?? 0,
          outFrames: clip.effects?.fadeOutFrames ?? 0,
          audioOnly: false,
        }
      : clip.kind === 'audio'
        ? {
            inFrames: clip.audio?.fadeInFrames ?? 0,
            outFrames: clip.audio?.fadeOutFrames ?? 0,
            audioOnly: true,
          }
        : null;

  function beginFade(
    event: ReactPointerEvent<HTMLSpanElement>,
    side: 'in' | 'out',
  ): void {
    if (!fade || track.locked) return;
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget;
    const startX = event.clientX;
    const initial = side === 'in' ? fade.inFrames : fade.outFrames;
    let last = initial;
    // Mismo coalescing que el arrastre: un solo update por frame. Cada update
    // re-renderiza el inspector completo, así que aplicar 100/s es caro.
    const coalescer = createRafCoalescer<number>((clientX) => {
      const delta = (clientX - startX) / Math.max(0.0001, pxPerFrame);
      last = fadeFramesForDrag(side, initial, delta, clip.durationFrames);
      store.update(
        (current) => applyFadeFrames(current, clip.id, side, last, fade.audioOnly),
        { history: false },
      );
    });
    target.setPointerCapture?.(event.pointerId);
    const onMove = (moveEvent: PointerEvent): void => {
      coalescer.push(moveEvent.clientX);
    };
    const finish = (): void => {
      coalescer.flush();
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
      if (target.hasPointerCapture?.(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      store.update((current) =>
        applyFadeFrames(current, clip.id, side, last, fade.audioOnly),
      );
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  }

  function nudgeFade(side: 'in' | 'out', step: number): void {
    if (!fade || track.locked) return;
    const initial = side === 'in' ? fade.inFrames : fade.outFrames;
    store.update((current) =>
      applyFadeFrames(
        current,
        clip.id,
        side,
        fadeFramesForDrag(side, initial, step, clip.durationFrames),
        fade.audioOnly,
      ),
    );
  }

  return (
    <div
      className={`timeline-clip kind-${clip.kind}${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}${clip.enabled === false ? ' disabled' : ''}${track.locked ? ' locked' : ''}${activePreview ? ' dragging' : ''}`}
      style={{ left, width }}
      role="button"
      tabIndex={0}
      aria-label={`${clipLabel} en ${track.label}, desde ${formatTimecode(clip.startFrame, project ? fpsOf(project) : 30)}${clip.enabled === false ? ' (desactivado)' : ''}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        // Clic sobre el clip: además de seleccionarlo, el cabezal va al punto
        // clickeado (patrón CapCut/Premiere). Antes sólo seleccionaba y el
        // cabezal quedaba donde estaba, así que el timeline se sentía
        // desincronizado con el clic.
        onSeek(event);
        onSelect(event);
        if (!track.locked) onDrag(event, 'move');
      }}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(event as unknown as ReactPointerEvent);
        }
      }}
    >
      {showThumbnail && thumbnail && (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze') ? (
        <img className="clip-thumb" src={thumbnail} alt="" draggable={false} />
      ) : null}
      {showWaveform && peaks && peaks.length > 1 ? (
        <svg
          className={`clip-waveform kind-${clip.kind}`}
          viewBox={`0 0 ${waveColumns} 40`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path d={waveformPath(peaks, waveColumns)} />
        </svg>
      ) : null}
      <span className="clip-label">
        {colorHex ? (
          <span
            className="clip-color-dot"
            style={{ background: colorHex }}
            aria-hidden="true"
          />
        ) : null}
        {clipLabel}
      </span>
      {isWindowed ? (
        <span className="clip-window">
          in {clip.source.inFrame} · out {clip.source.outFrame}
        </span>
      ) : null}
      {selected && !track.locked ? (
        <>
          <span
            className="trim-handle start"
            role="separator"
            aria-label="Recortar el inicio"
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(event);
              onDrag(event, 'trim-start');
            }}
          />
          <span
            className="trim-handle end"
            role="separator"
            aria-label="Recortar el final"
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(event);
              onDrag(event, 'trim-end');
            }}
          />
        </>
      ) : null}
      {fade && selected && !track.locked && width > 24 ? (
        <>
          <span
            className={`fade-handle${fade.inFrames > 0 ? ' active' : ''}`}
            style={{ left: fade.inFrames * pxPerFrame + 4 }}
            role="slider"
            tabIndex={0}
            aria-label="Fade de entrada"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={clip.durationFrames}
            aria-valuenow={fade.inFrames}
            title={`Fade de entrada: ${fade.inFrames} frames`}
            onPointerDown={(event) => beginFade(event, 'in')}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              nudgeFade('in', (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
            }}
          />
          <span
            className={`fade-handle out${fade.outFrames > 0 ? ' active' : ''}`}
            style={{ right: fade.outFrames * pxPerFrame + 4 }}
            role="slider"
            tabIndex={0}
            aria-label="Fade de salida"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={clip.durationFrames}
            aria-valuenow={fade.outFrames}
            title={`Fade de salida: ${fade.outFrames} frames`}
            onPointerDown={(event) => beginFade(event, 'out')}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              nudgeFade('out', (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
            }}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Comparador del memo del clip: durante el paneo/zoom el Timeline re-renderiza
 * por la ventana de virtualización, pero un clip cuyas props visuales no
 * cambiaron no necesita renderizarse de nuevo. Los callbacks se ignoran a
 * propósito: el padre los crea inline y siempre delega en refs con la versión
 * más nueva del handler (así el memo no los deja "stale").
 */
type ClipBlockProps = Parameters<typeof ClipBlockView>[0];

function clipBlockPropsEqual(
  previous: Readonly<ClipBlockProps>,
  next: Readonly<ClipBlockProps>,
): boolean {
  return (
    previous.clip === next.clip &&
    previous.track === next.track &&
    previous.pxPerFrame === next.pxPerFrame &&
    previous.selected === next.selected &&
    previous.dimmed === next.dimmed &&
    previous.preview === next.preview &&
    previous.showThumbnail === next.showThumbnail &&
    previous.showWaveform === next.showWaveform
  );
}

const ClipBlock = memo(ClipBlockView, clipBlockPropsEqual);

function CueBlock({
  cue,
  selected,
  pxPerFrame,
  preview,
  onSelect,
  onDrag,
}: {
  readonly cue: CaptionCue;
  readonly selected: boolean;
  readonly pxPerFrame: number;
  readonly preview: Drag | null;
  readonly onSelect: () => void;
  readonly onDrag: (event: ReactPointerEvent) => void;
}) {
  const activePreview = preview && preview.kind === 'cue' && preview.cueId === cue.id ? preview : null;
  const start = activePreview?.previewStart ?? cue.startFrame;
  const end = activePreview?.previewEnd ?? cue.endFrame;
  return (
    <div
      className={`caption-cue${selected ? ' selected' : ''}${activePreview ? ' dragging' : ''}`}
      style={{ left: start * pxPerFrame, width: Math.max(8, (end - start) * pxPerFrame) }}
      role="button"
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onSelect();
        onDrag(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {cue.text}
    </div>
  );
}

const TIMELINE_HEIGHT_KEY = 'editoria.timeline-height.v1';
const TRACK_HEIGHTS_KEY = 'editoria.track-heights.v1';
const TRACK_COLLAPSED_KEY = 'editoria.track-collapsed.v1';
const TRACK_MIN = 28;
const TRACK_MAX = 140;

function clampTrackHeight(value: number): number {
  return Math.min(TRACK_MAX, Math.max(TRACK_MIN, Math.round(value)));
}

function readTrackHeights(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(TRACK_HEIGHTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[key] = clampTrackHeight(value);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function readCollapsedTracks(): string[] {
  try {
    const raw = window.localStorage.getItem(TRACK_COLLAPSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
/** Alto de la regla (token --tl-ruler-h) para convertir scrollTop en filas. */
const RULER_VIEWPORT_H = 28;

const TIMELINE_MIN = 140;
const TIMELINE_MAX = 720;
const TIMELINE_DEFAULT = 280;

function clampTimelineHeight(value: number): number {
  return Math.min(TIMELINE_MAX, Math.max(TIMELINE_MIN, Math.round(value)));
}

export const Timeline = memo(function Timeline() {
  const store = useProjectStore();
  const project = store.state.project;
  const preferences = useEditorPreferences();
  const selectedClipId =
    store.state.selection.kind === 'clip' ? store.state.selection.id : null;
  const selectedCueId =
    store.state.selection.kind === 'cue' ? store.state.selection.id : null;
  // El zoom y el imán arrancan con lo elegido en Ajustes → Editor; después el
  // usuario manda con los controles de la barra de la timeline.
  const [pxPerFrame, setPxPerFrame] = useState(preferences.defaultZoom);
  const [newTrackKind, setNewTrackKind] = useState<Track['kind']>('video');
  // Alto de la timeline: se arrastra desde la asa, se guarda y se recuerda.
  const [timelineHeight, setTimelineHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return TIMELINE_DEFAULT;
    const stored = Number(window.localStorage.getItem(TIMELINE_HEIGHT_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampTimelineHeight(stored) : TIMELINE_DEFAULT;
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--timeline-height', `${timelineHeight}px`);
    try {
      window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeight));
    } catch {
      // Sin almacenamiento: el alto vale para esta sesión.
    }
  }, [timelineHeight]);

  // Alto y plegado por pista: la timeline se ajusta a cómo trabaja cada uno.
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>(() =>
    typeof window === 'undefined' ? {} : readTrackHeights(),
  );
  const [collapsedTracks, setCollapsedTracks] = useState<ReadonlySet<string>>(
    () => new Set(typeof window === 'undefined' ? [] : readCollapsedTracks()),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(TRACK_HEIGHTS_KEY, JSON.stringify(trackHeights));
    } catch {
      // Sin almacenamiento: vale para esta sesión.
    }
  }, [trackHeights]);

  useEffect(() => {
    try {
      window.localStorage.setItem(TRACK_COLLAPSED_KEY, JSON.stringify([...collapsedTracks]));
    } catch {
      // Sin almacenamiento: vale para esta sesión.
    }
  }, [collapsedTracks]);

  const [preview, setPreview] = useState<Drag | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(preferences.snapEnabled);
  // Edición ripple: ahora es una preferencia del editor (Ajustes → Editor),
  // con migración retrocompatible desde la clave histórica del timeline.
  // Multi-selección: estado local del timeline (no cambia el contrato del store).
  const [selectedClipIds, setSelectedClipIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [beatState, setBeatState] = useState<{
    readonly frames: readonly number[];
    readonly bpm: number;
    readonly clipLabel: string;
  } | null>(null);
  // Métricas del scroll para virtualización y minimapa.
  const [viewport, setViewport] = useState({
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 0,
    clientHeight: 0,
  });
  const timelineRootRef = useRef<HTMLDivElement>(null);
  const [colorFilter, setColorFilter] = useState<ClipColorTag | 'all'>('all');
  const [clipQuery, setClipQuery] = useState('');
  const [snapGuide, setSnapGuide] = useState<{ frame: number; label: string } | null>(
    null,
  );
  const [panMode, setPanMode] = useState(false);
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const clipboardRef = useRef<Clip | null>(null);
  const [clipboardReady, setClipboardReady] = useState(false);
  const [attributesReady, setAttributesReady] = useState(hasClipAttributesClipboard);
  const latest = useRef({ project, pxPerFrame, store, snapEnabled, snapPixels: preferences.snapPixels });
  latest.current = { project, pxPerFrame, store, snapEnabled, snapPixels: preferences.snapPixels };

  // Snap a escenas (el frame de inicio de sus clips): se calcula con el
  // proyecto y se lee desde el handler de arrastre, que vive fuera del render.
  const scenePoints = useMemo(
    () => (project ? sceneSnapPoints(project) : []),
    [project],
  );
  const rippleRef = useRef(preferences.timelineRipple);
  rippleRef.current = preferences.timelineRipple;
  const multiSelectionRef = useRef<ReadonlySet<string>>(selectedClipIds);
  multiSelectionRef.current = selectedClipIds;
  // Callbacks estables para los ClipBlock memoizados: las props visuales se
  // comparan, los handlers se resuelven siempre contra la última versión acá.
  const clipHandlersRef = useRef<{
    select: (
      clipId: string,
      event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    ) => void;
    seek: (event: ReactPointerEvent, clip: Clip) => void;
    drag: (
      event: ReactPointerEvent,
      clip: Clip,
      mode: 'move' | 'trim-start' | 'trim-end',
    ) => void;
    menu: (event: ReactMouseEvent, clip: Clip) => void;
  }>({
    select: () => undefined,
    seek: () => undefined,
    drag: () => undefined,
    menu: () => undefined,
  });
  const scenesRef = useRef<readonly { frame: number; label: string }[]>(scenePoints);
  scenesRef.current = scenePoints;
  const beatsRef = useRef<readonly number[]>(beatState?.frames ?? []);
  beatsRef.current = beatState?.frames ?? [];
  const beatLabelRef = useRef<string>('Beat');
  beatLabelRef.current = beatState ? `Beat ${beatState.bpm} bpm` : 'Beat';

  // La selección primaria del store (Inspector, atajos, menús) manda cuando no
  // hay multi-selección; agregar un clip con Shift/Ctrl la deja como primaria.
  useEffect(() => {
    const selection = store.state.selection;
    if (selection.kind === 'clip') {
      setSelectedClipIds((current) =>
        current.has(selection.id) ? current : new Set([selection.id]),
      );
    } else if (selection.kind === 'none') {
      setSelectedClipIds((current) => (current.size === 0 ? current : new Set()));
    }
  }, [store.state.selection]);

  // Métricas del scroll: alimentan virtualización y minimapa. Un solo update
  // por frame; ResizeObserver cubre resize de ventana y cambios de densidad.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const coalescer = createRafCoalescer<{
      scrollLeft: number;
      scrollTop: number;
      clientWidth: number;
      clientHeight: number;
    }>((next) => setViewport(next));
    const measure = (): void => {
      // Cuantización del scroll horizontal: la ventana visible ya tiene un
      // overscan de un viewport a cada lado, así que actualizar la ventana cada
      // ~1/3 de pantalla no deja huecos y evita re-renderizar la timeline en
      // cada píxel de un paneo. El overview conserva una precisión de ~1 %.
      const quantum = Math.max(120, Math.round(element.clientWidth / 3));
      const quantizedLeft = Math.round(element.scrollLeft / quantum) * quantum;
      coalescer.push({
        scrollLeft: quantizedLeft,
        scrollTop: element.scrollTop,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
      });
    };
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(element);
    }
    return () => {
      coalescer.cancel();
      element.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [project]);

  // Waveform del clip que se usa para detectar beats de snap. Se decodifica
  // sólo cuando el usuario pide "Beats" (el hook comparte caché con la waveform
  // de los clips, así que normalmente es un hit).
  const root = store.state.opened?.root ?? '';
  const beatSource = useMemo(() => {
    if (!project) return null;
    const candidates = project.timeline.clips.filter(
      (clip) =>
        (clip.kind === 'audio' || clip.kind === 'video') &&
        clip.source.type === 'asset' &&
        'inFrame' in clip.source &&
        'outFrame' in clip.source,
    );
    const preferred =
      candidates.find((clip) => clip.id === selectedClipId) ??
      candidates.find((clip) => clip.kind === 'audio') ??
      candidates[0];
    if (!preferred) return null;
    const source = preferred.source;
    if (source.type !== 'asset') return null;
    const asset = project.assets.find((item) => item.id === source.assetId);
    return asset ? { clip: preferred, asset } : null;
  }, [project, selectedClipId]);
  const beatWaveform = useWaveform(store.service, root || null, beatSource?.asset ?? null);

  /** Coalescing del scrub (legacy): un setPlayhead por frame. */
  // Coalescing del scrub: pointermove puede dispararse >100 veces por segundo
  // y cada setPlayhead re-renderiza el editor entero (incluida la vista
  // previa). Aplicamos a lo sumo UN setPlayhead por frame de pantalla; el
  // valor final pendiente se vuelca al soltar.
  const scrubPendingRef = useRef<number | null>(null);
  const scrubRafRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    clipId: string;
    x: number;
    y: number;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const fps = project ? fpsOf(project) : 30;
  const duration = project ? Math.max(store.durationFrames, Math.round(fps * 4)) : 0;
  const surfaceWidth = Math.max(880, duration * pxPerFrame + fps * pxPerFrame * 2);
  const tracks = useMemo(
    () =>
      project
        ? [...project.timeline.tracks].sort((a, b) => b.order - a.order)
        : [],
    [project],
  );

  // Virtualización: ventana de frames visibles y ventana de filas visibles.
  // Ambas devuelven `null` sin layout medible (jsdom): en ese caso se renderiza
  // todo, conservando el contrato de tests y e2e.
  const frameWindow = useMemo<FrameWindow | null>(
    () =>
      visibleFrameWindow(
        viewport.scrollLeft,
        viewport.clientWidth,
        pxPerFrame,
        headerWidth(),
      ),
    [viewport.scrollLeft, viewport.clientWidth, pxPerFrame],
  );
  const trackRows = useMemo(
    () =>
      tracks.map((track) => ({
        id: track.id,
        height: collapsedTracks.has(track.id)
          ? TRACK_MIN
          : (trackHeights[track.id] ?? defaultRowHeight(track.kind)),
      })),
    [tracks, collapsedTracks, trackHeights],
  );
  const trackWindow = useMemo(
    () =>
      visibleTrackWindow(
        Math.max(0, viewport.scrollTop - RULER_VIEWPORT_H),
        viewport.clientHeight,
        trackRows.map((row) => row.height),
      ),
    [viewport.scrollTop, viewport.clientHeight, trackRows],
  );
  const visibleTracks = trackWindow ? tracks.slice(trackWindow.first, trackWindow.last) : tracks;
  const overviewClips = useMemo(
    () =>
      project
        ? project.timeline.clips.map((clip) => ({
            id: clip.id,
            kind: clip.kind,
            startFrame: clip.startFrame,
            durationFrames: clip.durationFrames,
          }))
        : [],
    [project],
  );
  const contentWidth = surfaceWidth + headerWidth();
  const overviewVisible =
    viewport.clientWidth > 0 && duration > 0 && contentWidth > viewport.clientWidth + 80;

  function copySelectedClip(): void {
    const clip = project?.timeline.clips.find((item) => item.id === selectedClipId);
    if (!clip) return;
    clipboardRef.current = JSON.parse(JSON.stringify(clip)) as Clip;
    setClipboardReady(true);
    store.setNotice(`${clip.label ?? 'Clip'} copiado; usá Pegar para insertarlo.`);
  }

  function pasteCopiedClip(): void {
    const clip = clipboardRef.current;
    if (!clip) return;
    const result = store.mutate((current) =>
      pasteClip(current, clip, { startFrame: store.state.playheadFrame }),
    );
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
      store.setNotice('Clip pegado en el primer hueco libre de la pista.');
    }
  }

  function copyAttributesFor(clip: Clip): void {
    const attributes = copyClipAttributes(clip);
    if (!attributes) {
      store.setNotice('El clip no tiene atributos para copiar.');
      return;
    }
    setClipAttributesClipboard(attributes);
    setAttributesReady(true);
    store.setNotice(
      'Atributos copiados; seleccioná otro clip y usá Pegar atributos.',
    );
  }

  function pasteAttributesFor(clip: Clip): void {
    const attributes = getClipAttributesClipboard();
    const current = store.state.project;
    if (!attributes || !current) return;
    try {
      const next = applyClipAttributes(current, clip.id, attributes);
      if (next === current) {
        store.setNotice('No hay atributos aplicables a este tipo de clip.');
        return;
      }
      store.update(() => next);
      store.setNotice(`Atributos pegados en ${clip.label ?? 'el clip'}.`);
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudieron pegar los atributos',
      );
    }
  }

  function jumpToSearchMatch(): void {
    if (!project) return;
    const matches = project.timeline.clips
      .filter((clip) => {
        const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
        const source = clip.source;
        const asset =
          source.type === 'asset'
            ? project.assets.find((item) => item.id === source.assetId)
            : undefined;
        return matchesClipSearch(
          [clip.label, track?.label, asset?.label],
          clipQuery,
        );
      })
      .sort((a, b) => a.startFrame - b.startFrame);
    if (matches.length === 0) {
      store.setNotice('Ningún clip coincide con la búsqueda.');
      return;
    }
    const next =
      matches.find((clip) => clip.startFrame > store.state.playheadFrame) ?? matches[0]!;
    store.setPlayhead(next.startFrame);
    store.setSelection({ kind: 'clip', id: next.id });
    store.setNotice(
      `Clip ${next.label ?? 'sin nombre'} en ${formatTimecode(next.startFrame, fps)}.`,
    );
  }

  function pasteAttributesToFilter(): void {    const attributes = getClipAttributesClipboard();
    const current = store.state.project;
    if (!attributes || !current || colorFilter === 'all') return;
    try {
      const result = pasteAttributesToColor(current, colorFilter, attributes);
      if (result.applied === 0) {
        store.setNotice('No hay clips con ese color para pegar atributos.');
        return;
      }
      store.update(() => result.project);
      store.setNotice(
        `Atributos pegados en ${result.applied} clip(s).${
          result.skipped > 0 ? ` ${result.skipped} en pistas bloqueadas.` : ''
        }`,
      );
    } catch (error) {
      store.setNotice(
        error instanceof Error ? error.message : 'no se pudieron pegar los atributos',
      );
    }
  }

  /**
   * Selección de clip con multi-selección: clic normal reemplaza, Shift/Ctrl/
   * Cmd alternan. La selección primaria (la que ve el Inspector) es el último
   * clip clickeado; el resto se resalta en la timeline y se mueve en grupo.
   */
  function selectClip(
    clipId: string,
    event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  ): void {
    const additive = Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey);
    if (!additive) {
      setSelectedClipIds(new Set([clipId]));
      store.setSelection({ kind: 'clip', id: clipId });
      return;
    }
    const wasSelected = selectedClipIds.has(clipId);
    setSelectedClipIds((current) => {
      const next = new Set(current);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
    if (wasSelected) {
      // Se quitó el clip: la primaria pasa a otro seleccionado o a ninguna.
      const remaining = [...selectedClipIds].filter((id) => id !== clipId);
      const primary = remaining[remaining.length - 1];
      store.setSelection(primary ? { kind: 'clip', id: primary } : { kind: 'none' });
    } else {
      store.setSelection({ kind: 'clip', id: clipId });
    }
  }

  function isClipSelected(clipId: string): boolean {
    return selectedClipIds.has(clipId) || selectedClipId === clipId;
  }

  function currentSelectedIds(): string[] {
    if (selectedClipIds.size > 0) return [...selectedClipIds];
    return selectedClipId ? [selectedClipId] : [];
  }

  function toggleRippleMode(): void {
    const next = !preferences.timelineRipple;
    updateEditorPreferences({ timelineRipple: next });
    store.setNotice(
      next
        ? 'Ripple activo: mover y recortar desplaza los clips posteriores (Shift+R).'
        : 'Ripple desactivado.',
    );
  }

  /**
   * Detecta beats del clip de audio/video seleccionado (o del primer audio)
   * a partir de su forma de onda cacheada y los usa como puntos de snap.
   * Si el medio no expone waveform (navegador sin Web Audio, medio largo o sin
   * archivo accesible) avisa con un notice honesto en vez de inventar beats.
   */
  function analyzeBeats(): void {
    if (beatState) {
      setBeatState(null);
      store.setNotice('Beats desactivados del imán.');
      return;
    }
    if (!beatSource || !beatWaveform || beatWaveform.length === 0) {
      store.setNotice(
        beatSource
          ? 'La forma de onda todavía no está disponible para ese medio; esperá un momento o probá con otro clip.'
          : 'No hay un clip de audio o video con medio asociado para analizar beats.',
      );
      return;
    }
    const { clip, asset } = beatSource;
    const source = clip.source;
    if (source.type !== 'asset' || !('inFrame' in source) || !('outFrame' in source)) {
      store.setNotice('Ese clip no tiene una ventana de audio analizable.');
      return;
    }
    const media = 'media' in asset ? asset.media : undefined;
    const totalFrames =
      media && 'durationFrames' in media ? media.durationFrames : source.outFrame;
    const frames = beatFramesFromPeaks(beatWaveform, {
      clipStartFrame: clip.startFrame,
      inFrame: source.inFrame,
      outFrame: source.outFrame,
      totalFrames,
      fps,
    });
    if (frames.length === 0) {
      store.setNotice('No se detectaron beats claros en ese medio.');
      return;
    }
    const averageGap =
      frames.length > 1
        ? (frames[frames.length - 1]! - frames[0]!) / (frames.length - 1)
        : fps / 2;
    const bpm = Math.max(30, Math.min(300, Math.round((60 * fps) / Math.max(1, averageGap))));
    setBeatState({ frames, bpm, clipLabel: clip.label ?? 'clip' });
    store.setNotice(`${frames.length} beats detectados (≈${bpm} bpm) para el imán.`);
  }

  /** Borra todos los clips seleccionados; ripple cierra los huecos. */
  function deleteSelectedClips(ripple: boolean): void {
    const ids = currentSelectedIds();
    if (ids.length === 0) return;
    let nextDuration = 0;
    store.update((current) => {
      const next = deleteClips(current, ids, ripple);
      if (!next) return current;
      nextDuration = totalFrames(next);
      return next;
    });
    store.setSelection({ kind: 'none' });
    setSelectedClipIds(new Set());
    store.setPlayhead(Math.min(store.state.playheadFrame, nextDuration));
    store.setNotice(
      ripple
        ? `${ids.length} clip(s) borrados con ripple.`
        : `${ids.length} clip(s) borrados.`,
    );
  }

  function rippleDeleteSelected(): void {
    deleteSelectedClips(true);
  }

  const contextClip =
    contextMenu && project
      ? project.timeline.clips.find((clip) => clip.id === contextMenu.clipId)
      : undefined;
  const contextLocked =
    !contextClip ||
    !project ||
    project.timeline.tracks.find((track) => track.id === contextClip.trackId)?.locked === true;
  const contextSplitAllowed =
    contextClip !== undefined &&
    !contextLocked &&
    store.state.playheadFrame > contextClip.startFrame &&
    store.state.playheadFrame < contextClip.startFrame + contextClip.durationFrames;

  function openClipMenu(event: ReactMouseEvent, clip: Clip): void {
    event.preventDefault();
    event.stopPropagation();
    store.setSelection({ kind: 'clip', id: clip.id });
    setContextMenu({ clipId: clip.id, x: event.clientX, y: event.clientY });
  }

  function splitContextClip(): void {
    if (!contextClip) return;
    const clipId = contextClip.id;
    let rightClipId: string | null = null;
    store.update((current) => {
      const result = splitClip(current, clipId, store.state.playheadFrame);
      if (!result) return current;
      rightClipId = result.rightClipId;
      return result.project;
    });
    setContextMenu(null);
    if (rightClipId) {
      store.setSelection({ kind: 'clip', id: rightClipId });
      store.setNotice('Clip dividido en el playhead.');
    } else {
      store.setNotice('Movés el playhead dentro del clip para dividirlo.');
    }
  }

  function duplicateContextClip(): void {
    if (!contextClip) return;
    const clipId = contextClip.id;
    let newClipId: string | null = null;
    store.update((current) => {
      const result = duplicateClip(current, clipId);
      if (!result) return current;
      newClipId = result.clipId;
      return result.project;
    });
    setContextMenu(null);
    if (newClipId) {
      store.setSelection({ kind: 'clip', id: newClipId });
      store.setNotice('Clip duplicado en el primer hueco libre.');
    }
  }

  function deleteContextClip(): void {
    if (!contextClip) return;
    const clipId = contextClip.id;
    let nextDuration = 0;
    store.update((current) => {
      const next = deleteClip(current, clipId);
      nextDuration = totalFrames(next);
      return next;
    });
    setContextMenu(null);
    store.setSelection({ kind: 'none' });
    store.setPlayhead(Math.min(store.state.playheadFrame, nextDuration));
  }

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    const frame = window.requestAnimationFrame(() => {
      contextMenuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'c' && selectedClipId) {
        event.preventDefault();
        copySelectedClip();
      } else if (command && event.key.toLowerCase() === 'v' && clipboardRef.current) {
        event.preventDefault();
        pasteCopiedClip();
      } else if (event.shiftKey && event.key === 'Delete' && selectedClipId) {
        event.preventDefault();
        rippleDeleteSelected();
      } else if (!command && !event.altKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleMarkerAtPlayhead();
      } else if (!command && !event.altKey && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setPanMode((value) => !value);
      } else if (
        event.shiftKey &&
        !command &&
        !event.altKey &&
        event.key.toLowerCase() === 'r'
      ) {
        // Atajo local del timeline (coordinado con functional-ai): libre en el
        // registro global. No actúa si hay un diálogo abierto.
        if (document.querySelector('[role="dialog"], .modal, .settings-window')) return;
        event.preventDefault();
        event.stopPropagation();
        toggleRippleMode();
      } else if (
        event.altKey &&
        event.shiftKey &&
        !command &&
        selectedClipIds.size > 1 &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        // Mover el grupo seleccionado frame a frame (combianción libre; no pisa
        // Alt+flecha del registro global, que no se ejecuta para el editor).
        if (document.querySelector('[role="dialog"], .modal, .settings-window')) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const ids = [...selectedClipIds];
        store.update((current) => {
          const next = moveClipsBy(current, ids, delta);
          if (!next) return current;
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedClipId, selectedClipIds, project, preferences.timelineRipple]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const currentScale = latest.current.pxPerFrame;
        const rect = element.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const anchor = Math.max(
          0,
          (element.scrollLeft + pointerX - headerWidth()) / currentScale,
        );
        const next = clamp(currentScale * (delta < 0 ? 1.16 : 1 / 1.16), 0.2, 14);
        setPxPerFrame(next);
        window.requestAnimationFrame(() => {
          element.scrollLeft = Math.max(0, headerWidth() + anchor * next - pointerX);
        });
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        element.scrollLeft += delta;
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [project]);

  /**
   * Seguir al playhead durante la reproducción. Sólo actúa mientras se
   * reproduce: al arrastrar o hacer zoom el usuario manda y la vista no se
   * mueve sola. Mantiene el playhead dentro de la ventana con un margen para
   * que no quede pegado al borde.
   */
  useEffect(() => {
    if (!preferences.followPlayhead || !store.state.playing) return;
    const element = scrollRef.current;
    if (!element) return;
    const x = headerWidth() + store.state.playheadFrame * pxPerFrame;
    const left = element.scrollLeft;
    const margin = 80;
    if (x < left + headerWidth() + margin || x > left + element.clientWidth - margin) {
      element.scrollLeft = Math.max(0, x - element.clientWidth / 2);
    }
  }, [
    preferences.followPlayhead,
    pxPerFrame,
    store.state.playheadFrame,
    store.state.playing,
  ]);

  useEffect(() => {
    /**
     * Procesa el ÚLTIMO pointermove del frame. El listener de `pointermove`
     * sólo guarda el evento (ver `onMove` abajo): 100+ eventos/s ya no
     * re-renderizan la timeline 100 veces. `flush()` en pointerup garantiza que
     * la posición final sea exactamente la del mouse al soltar.
     */
    const processDragMove = (event: PointerEvent): void => {
      const current = dragRef.current;
      const {
        project: doc,
        pxPerFrame: scale,
        store: state,
        snapEnabled: snapping,
        snapPixels,
      } = latest.current;
      if (!current || !doc) return;
      const threshold = snapThreshold(scale, snapPixels);
      const snapActive = snapping && !event.altKey;
      if (current.kind === 'scrub') {
        const surface = surfaceRef.current;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        const frame = Math.max(0, Math.round((event.clientX - rect.left - headerWidth()) / scale));
        scrubPendingRef.current = frame;
        if (scrubRafRef.current === 0) {
          scrubRafRef.current = window.requestAnimationFrame(() => {
            scrubRafRef.current = 0;
            const pending = scrubPendingRef.current;
            scrubPendingRef.current = null;
            if (pending !== null) {
              latest.current.store.setPlayhead(pending);
            }
          });
        }
        return;
      }
      if (current.kind === 'cue') {
        const delta = Math.round((event.clientX - current.originX) / scale);
        const shift = Math.max(-current.originalStart, delta);
        const length = current.originalEnd - current.originalStart;
        let nextStart = current.originalStart + shift;
        let guide: { frame: number; label: string } | null = null;
        if (snapActive) {
          const snapped = snapSpanTo(
            nextStart,
            length,
            collectTimelineSnapTargets(doc, {
              playhead: state.state.playheadFrame,
              scenes: scenesRef.current,
              beats: beatsRef.current,
              beatLabel: beatLabelRef.current,
            }),
            threshold,
          );
          nextStart = Math.max(0, snapped.frame);
          if (snapped.target) {
            guide = { frame: snapped.target.frame, label: snapped.target.label };
          }
        }
        setSnapGuide(guide);
        const next: Drag = {
          ...current,
          previewStart: nextStart,
          previewEnd: nextStart + length,
        };
        dragRef.current = next;
        setPreview(next);
        return;
      }
      const delta = Math.round((event.clientX - current.originX) / scale);
      if (current.mode === 'move') {
        let nextStart = Math.max(0, current.originalStart + delta);
        let guide: { frame: number; label: string } | null = null;
        if (snapActive) {
          const snapped = snapSpanTo(
            nextStart,
            current.originalDuration,
            collectTimelineSnapTargets(doc, {
              excludeClipId: current.clipId,
              playhead: state.state.playheadFrame,
              scenes: scenesRef.current,
              beats: beatsRef.current,
              beatLabel: beatLabelRef.current,
            }),
            threshold,
          );
          nextStart = Math.max(0, snapped.frame);
          if (snapped.target) {
            guide = { frame: snapped.target.frame, label: snapped.target.label };
          }
        }
        setSnapGuide(guide);
        const groupIds = current.groupIds ?? [];
        const isGroup = groupIds.length > 1;
        if (isGroup) {
          // El grupo se mueve en bloque sobre las mismas pistas; el preview
          // aplica el mismo delta a todos los clips seleccionados.
          const next: Drag = {
            ...current,
            previewStart: nextStart,
            groupDelta: nextStart - current.originalStart,
          };
          dragRef.current = next;
          setPreview(next);
          return;
        }
        const hovered = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('[data-lane-track-id]') as HTMLElement | null;
        const targetTrackId = hovered?.dataset.laneTrackId ?? current.previewTrackId;
        const targetTrack = trackById(doc, targetTrackId);
        const clip = doc.timeline.clips.find((item) => item.id === current.clipId);
        const compatible =
          targetTrack &&
          clip &&
          ((clip.kind === 'video' && targetTrack.kind === 'video') ||
            (clip.kind === 'image' && targetTrack.kind === 'image') ||
            (clip.kind === 'freeze' && targetTrack.kind === 'video') ||
            (clip.kind === 'audio' && (targetTrack.kind === 'audio' || targetTrack.kind === 'narration')) ||
            (clip.kind === 'graphic' && targetTrack.kind === 'graphic'));
        const next: Drag = {
          ...current,
          previewStart: nextStart,
          previewTrackId: compatible ? targetTrackId : current.previewTrackId,
        };
        dragRef.current = next;
        setPreview(next);
        return;
      }
      if (current.mode === 'trim-start') {
        const maxStart = current.originalStart + current.originalDuration - 1;
        let nextStart = clamp(
          current.originalStart + delta,
          0,
          maxStart,
        );
        let guide: { frame: number; label: string } | null = null;
        if (snapActive) {
          const snapped = snapFrameTo(
            nextStart,
            collectTimelineSnapTargets(doc, {
              excludeClipId: current.clipId,
              playhead: state.state.playheadFrame,
              scenes: scenesRef.current,
              beats: beatsRef.current,
              beatLabel: beatLabelRef.current,
            }),
            threshold,
          );
          const clamped = clamp(snapped.frame, 0, maxStart);
          nextStart = clamped;
          if (snapped.target && snapped.frame === clamped) {
            guide = { frame: snapped.target.frame, label: snapped.target.label };
          }
        }
        setSnapGuide(guide);
        const next: Drag = {
          ...current,
          previewStart: nextStart,
          previewDuration: current.originalStart + current.originalDuration - nextStart,
        };
        dragRef.current = next;
        setPreview(next);
      } else {
        let nextDuration = Math.max(
          1,
          current.originalDuration + delta,
        );
        let guide: { frame: number; label: string } | null = null;
        if (snapActive) {
          const targetEnd = current.originalStart + nextDuration;
          const snapped = snapFrameTo(
            targetEnd,
            collectTimelineSnapTargets(doc, {
              excludeClipId: current.clipId,
              playhead: state.state.playheadFrame,
              scenes: scenesRef.current,
              beats: beatsRef.current,
              beatLabel: beatLabelRef.current,
            }),
            threshold,
          );
          const snappedDuration = Math.max(
            1,
            snapped.frame - current.originalStart,
          );
          nextDuration = snappedDuration;
          if (
            snapped.target &&
            current.originalStart + snappedDuration === snapped.frame
          ) {
            guide = { frame: snapped.target.frame, label: snapped.target.label };
          }
        }
        setSnapGuide(guide);
        const next: Drag = {
          ...current,
          previewDuration: nextDuration,
        };
        dragRef.current = next;
        setPreview(next);
      }
    };

    // El listener de move sólo guarda el evento; el trabajo pesado se hace una
    // vez por frame. En pointerup se vuelca el último evento antes de commitear.
    const dragMoveCoalescer = createRafCoalescer<PointerEvent>(processDragMove);
    const onMove = (event: PointerEvent): void => {
      if (!dragRef.current) return;
      dragMoveCoalescer.push(event);
    };

    const onUp = (event: PointerEvent) => {
      // Vuelca el último move pendiente para que el commit use la posición
      // exacta del mouse al soltar (antes se perdía el último evento).
      dragMoveCoalescer.flush();
      dragMoveCoalescer.cancel();
      const current = dragRef.current;
      const { store: state, project: doc } = latest.current;
      dragRef.current = null;
      setPreview(null);
      setSnapGuide(null);
      if (!current) return;
      if (current.kind === 'scrub') {
        // Volar el frame pendiente: la posición final es la última vista.
        if (scrubRafRef.current) {
          window.cancelAnimationFrame(scrubRafRef.current);
          scrubRafRef.current = 0;
        }
        const pending = scrubPendingRef.current;
        scrubPendingRef.current = null;
        if (pending !== null) state.setPlayhead(pending);
        return;
      }
      if (current.kind === 'cue') {
        if (current.previewStart !== current.originalStart) {
          state.update((projectDoc) =>
            updateCaptionCue(projectDoc, current.cueId, {
              startFrame: current.previewStart,
              endFrame: current.previewEnd,
            }),
          );
        }
        return;
      }
      if (!doc) return;
      if (current.mode === 'move') {
        const groupIds = current.groupIds ?? [];
        if (groupIds.length > 1) {
          const delta = current.previewStart - current.originalStart;
          if (delta === 0) return;
          state.update((projectDoc) => {
            const next = moveClipsBy(projectDoc, groupIds, delta);
            if (!next) {
              throw new ProjectActionError(
                'el grupo no se puede mover: pista bloqueada o superposición',
              );
            }
            return next;
          });
          state.setNotice(`${groupIds.length} clips movidos ${delta} frames.`);
          return;
        }
        const currentClip = doc.timeline.clips.find(
          (item) => item.id === current.clipId,
        );
        if (
          current.previewStart === current.originalStart &&
          currentClip?.trackId === current.previewTrackId
        ) {
          // Un clic sin arrastre no debe mover ni cerrar huecos.
          return;
        }
        const hovered = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('[data-lane-track-id]') as HTMLElement | null;
        const targetTrackId = hovered?.dataset.laneTrackId ?? current.previewTrackId;
        const magnetic = latest.current.snapEnabled && !event.altKey;
        const ripple = rippleRef.current;
        state.update((projectDoc) => {
          const next = ripple
            ? rippleMoveClip(projectDoc, current.clipId, current.previewStart, targetTrackId)
            : magnetic
              ? magneticMoveClip(projectDoc, current.clipId, current.previewStart, targetTrackId)
              : moveClip(projectDoc, current.clipId, current.previewStart, targetTrackId);
          if (!next) {
            throw new ProjectActionError(
              'ese movimiento se superpone con otro clip o la pista no acepta el clip',
            );
          }
          return next;
        });
        state.setSelection({ kind: 'clip', id: current.clipId });
        return;
      }
      const trimEdge = current.mode === 'trim-start' ? 'start' : 'end';
      const trimTarget =
        current.mode === 'trim-start'
          ? current.previewStart
          : current.previewStart + current.previewDuration;
      state.update((projectDoc) => {
        const next = rippleRef.current
          ? rippleTrim(projectDoc, current.clipId, trimEdge, trimTarget)
          : trimClip(projectDoc, current.clipId, trimEdge, trimTarget);
        if (!next) {
          throw new ProjectActionError(
            'ese recorte no es válido para la ventana de origen del clip',
          );
        }
        return next;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragMoveCoalescer.cancel();
      if (scrubRafRef.current) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = 0;
      }
    };
  }, []);

  if (!project) return null;

  // La regla sólo dibuja las marcas de la ventana visible (+overscan): antes
  // generaba una marca menor cada ~8 frames de TODO el proyecto (≈1.900 spans
  // en un timeline de 12k frames) y React las reconciliaba en cada frame de
  // reproducción. Memoizado por zoom/ventana, el coste por frame es cero.
  const ruler = useMemo(() => {
    const pxPerSecond = pxPerFrame * fps;
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((value) => value * pxPerSecond >= 92) ?? 900;
    const major = Math.max(1, Math.round(step * fps));
    const minor = Math.max(2, Math.round(major / 5));
    const from = frameWindow
      ? Math.max(0, Math.floor(frameWindow.startFrame / major) * major)
      : 0;
    const to = frameWindow ? Math.max(from, Math.ceil(frameWindow.endFrame)) : duration + fps;
    const ticks: number[] = [];
    for (let frame = from; frame <= to; frame += major) ticks.push(frame);
    const minorTicks: number[] = [];
    for (let frame = from - (from % minor); frame <= to; frame += minor) {
      if (frame % major !== 0) minorTicks.push(frame);
    }
    return { ticks, minorTicks, majorFrames: major };
  }, [duration, fps, pxPerFrame, frameWindow]);
  const { ticks, minorTicks, majorFrames } = ruler;

  function beginScrub(event: ReactPointerEvent): void {
    if (event.button !== 0) return;
    // La esquina de la regla es la cabecera sticky de las pistas: un clic ahí
    // no es un seek. Antes caía en la cuenta y mandaba el cabezal a 0 (se leía
    // como «el timeline no está sincronizado»).
    if (event.target instanceof Element && event.target.closest('.ruler-corner')) return;
    event.preventDefault();
    store.setPlaying(false);
    store.setSelection({ kind: 'none' });
    dragRef.current = { kind: 'scrub' };
    setPreview({ kind: 'scrub' });
    setSnapGuide(null);
    const surface = surfaceRef.current;
    if (surface) {
      const rect = surface.getBoundingClientRect();
      const frame = Math.max(0, Math.round((event.clientX - rect.left - headerWidth()) / pxPerFrame));
      store.setPlayhead(frame);
    }
  }

  /**
   * Clic sobre un clip: además de seleccionarlo, lleva el cabezal al frame
   * clickeado (patrón CapCut/Premiere). Se mide contra el propio clip —su borde
   * izquierdo es `startFrame`— así el resultado no depende del scroll ni del
   * ancho de la cabecera de pistas.
   */
  function seekFromClipPointer(event: ReactPointerEvent, clip: Clip): void {
    // Shift/Ctrl/Cmd son multi-selección: ahí no movemos el cabezal.
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const offset = (event.clientX - rect.left) / Math.max(0.0001, pxPerFrame);
    store.setPlaying(false);
    store.setPlayhead(clip.startFrame + offset);
  }

  function beginClipDrag(
    event: ReactPointerEvent,
    clip: Clip,
    mode: 'move' | 'trim-start' | 'trim-end',
  ): void {
    event.preventDefault();
    const multi = multiSelectionRef.current;
    const groupIds =
      mode === 'move' && multi.has(clip.id) && multi.size > 1 ? [...multi] : undefined;
    const drag: Drag = {
      kind: 'clip',
      clipId: clip.id,
      mode,
      originX: event.clientX,
      originalStart: clip.startFrame,
      originalDuration: clip.durationFrames,
      previewStart: clip.startFrame,
      previewDuration: clip.durationFrames,
      previewTrackId: clip.trackId,
      ...(groupIds ? { groupIds, groupDelta: 0 } : {}),
    };
    dragRef.current = drag;
    setPreview(drag);
    setSnapGuide(null);
  }

  function beginCueDrag(event: ReactPointerEvent, cue: CaptionCue): void {
    event.preventDefault();
    const drag: Drag = {
      kind: 'cue',
      cueId: cue.id,
      originX: event.clientX,
      originalStart: cue.startFrame,
      originalEnd: cue.endFrame,
      previewStart: cue.startFrame,
      previewEnd: cue.endFrame,
    };
    dragRef.current = drag;
    setPreview(drag);
    setSnapGuide(null);
  }

  function beginPan(event: ReactPointerEvent<HTMLDivElement>): void {
    const element = scrollRef.current;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
    };
    setPanning(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; dragging still works inside the viewport.
    }
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>): void {
    const pan = panRef.current;
    const element = scrollRef.current;
    if (!pan || !element || pan.pointerId !== event.pointerId) return;
    element.scrollLeft = pan.left - (event.clientX - pan.x);
    element.scrollTop = pan.top - (event.clientY - pan.y);
  }

  function finishPan(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!panRef.current) return;
    panRef.current = null;
    setPanning(false);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already be released.
    }
  }

  useEffect(() => {
    if (!panning) return;
    const stop = (): void => {
      panRef.current = null;
      setPanning(false);
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [panning]);

  function addTrackToTimeline(): void {
    const result = store.mutate((current) => addTrack(current, newTrackKind));
    if (result) {
      store.setSelection({ kind: 'track', id: result.trackId });
    }
  }

  function addAdjustmentLayerToTimeline(): void {
    const result = store.mutate((current) =>
      addAdjustmentLayer(current, store.state.playheadFrame),
    );
    if (result) {
      store.setSelection({ kind: 'clip', id: result.clipId });
    }
  }

  function toggleMarkerAtPlayhead(): void {
    if (!project) return;
    store.update((current) => {
      const existing = markerAtFrame(current, store.state.playheadFrame);
      return existing
        ? deleteMarker(current, existing.id)
        : addMarker(current, store.state.playheadFrame).project;
    });
  }

  const selectedClip = selectedClipId
    ? project.timeline.clips.find((clip) => clip.id === selectedClipId)
    : undefined;

  // Paso de la rejilla del lane: una línea por marca mayor de la regla. Se pasa
  // como variable para que el CSS no adivine píxeles fijos (antes eran 120 px).
  const gridStepPx = Math.max(8, Math.round(majorFrames * pxPerFrame));

  // Handlers "vivos" para los clips memoizados (ver clipHandlersRef).
  clipHandlersRef.current = {
    select: selectClip,
    seek: seekFromClipPointer,
    drag: beginClipDrag,
    menu: openClipMenu,
  };

  return (
    <div
      ref={timelineRootRef}
      className={
        `timeline density-${preferences.timelineDensity}` +
        (preferences.timelineShowGrid ? '' : ' no-grid') +
        (preferences.timelineClipLabels === 'minimal' ? ' labels-minimal' : '')
      }
    >
      <div
        className="timeline-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Cambiar el alto de la timeline"
        aria-valuemin={TIMELINE_MIN}
        aria-valuemax={TIMELINE_MAX}
        aria-valuenow={timelineHeight}
        tabIndex={0}
        title="Arrastrá para cambiar el alto · doble clic para restablecer"
        onPointerDown={(event) => {
          event.preventDefault();
          const startY = event.clientY;
          const startHeight = timelineHeight;
          const move = (pointer: PointerEvent): void => {
            setTimelineHeight(clampTimelineHeight(startHeight + (startY - pointer.clientY)));
          };
          const up = (): void => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          window.addEventListener('pointercancel', up);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setTimelineHeight((value) => clampTimelineHeight(value + 24));
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setTimelineHeight((value) => clampTimelineHeight(value - 24));
          }
          if (event.key === 'Home') {
            event.preventDefault();
            setTimelineHeight(TIMELINE_MIN);
          }
          if (event.key === 'End') {
            event.preventDefault();
            setTimelineHeight(TIMELINE_MAX);
          }
        }}
        onDoubleClick={() => setTimelineHeight(TIMELINE_DEFAULT)}
      />
      <div className="timeline-toolbar">
        <div className="timeline-tools">
          <button
            type="button"
            className="icon-button"
            aria-label="Alejar"
            onClick={() => setPxPerFrame((value) => Math.max(0.2, value / 1.4))}
          >
            <Icon name="minus" size={14} />
          </button>
          <span className="zoom-readout">{pxPerFrame.toFixed(2)} px/frame</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Acercar"
            onClick={() => setPxPerFrame((value) => Math.min(14, value * 1.4))}
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            type="button"
            className="small ghost zoom-fit"
            aria-label="Ajustar zoom a la duración"
            onClick={() => {
              const seconds = Math.max(4, duration / fps);
              setPxPerFrame(clamp(760 / (seconds * fps), 0.2, 14));
            }}
          >
            Ajustar
          </button>
          <button
            type="button"
            className={panMode ? 'small ghost pan-toggle active' : 'small ghost pan-toggle'}
            aria-label="Mover la vista con el mouse"
            aria-pressed={panMode}
            aria-keyshortcuts="H"
            title="Herramienta mano (H): arrastrá para mover la timeline. El botón central también panea; Ctrl+rueda acerca y Shift+rueda desplaza."
            onClick={() => setPanMode((value) => !value)}
          >
            <Icon name="hand" size={13} />
            <span className="tool-label">Mover</span>
          </button>
          {panMode ? (
            <span className="zoom-readout pan-hint">Arrastrá para mover</span>
          ) : null}
          <button
            type="button"
            className={snapEnabled ? 'small ghost snap-toggle active' : 'small ghost snap-toggle'}
            aria-label="Activar o desactivar timeline magnética"
            aria-pressed={snapEnabled}
            title="Timeline magnética: imán en bordes/marcadores/playhead y los movimientos cierran huecos (Alt para mover libre)"
            onClick={() => setSnapEnabled((value) => !value)}
          >
            <Icon name="magnet" size={13} />
            <span className="tool-label">Magnética</span>
          </button>
          <button
            type="button"
            className={
              preferences.timelineRipple
                ? 'small ghost ripple-toggle active'
                : 'small ghost ripple-toggle'
            }
            aria-label="Activar o desactivar edición ripple"
            aria-pressed={preferences.timelineRipple}
            aria-keyshortcuts="Shift+R"
            title="Ripple (Shift+R): mover y recortar desplaza los clips posteriores para no dejar huecos"
            onClick={toggleRippleMode}
          >
            <Icon name="ripple" size={13} />
            <span className="tool-label">Ripple</span>
          </button>
          <button
            type="button"
            className={
              beatState ? 'small ghost beat-toggle active' : 'small ghost beat-toggle'
            }
            aria-label="Detectar beats para el imán"
            aria-pressed={Boolean(beatState)}
            title={
              beatState
                ? `${beatState.frames.length} beats de ${beatState.clipLabel} (≈${beatState.bpm} bpm); clic para quitarlos del imán`
                : 'Analiza la forma de onda del clip seleccionado y usa sus beats como puntos de imán'
            }
            onClick={analyzeBeats}
            disabled={!beatSource}
          >
            <Icon name="audio" size={13} />
            <span className="tool-label">
              {beatState ? `Beats · ${beatState.frames.length}` : 'Beats'}
            </span>
          </button>
        </div>
        <div className="timeline-tools timeline-tools-filters">
          <label className="color-filter-field">
            <span className="tool-label">Color</span>
            <select
              value={colorFilter}
              aria-label="Filtrar clips por color"
              title="Atenúa los clips que no tienen el color elegido"
              onChange={(event) =>
                setColorFilter(event.target.value as ClipColorTag | 'all')
              }
            >
              <option value="all">Todos</option>
              {CLIP_COLORS.map((color) => (
                <option key={color.id} value={color.id}>
                  {color.label}
                </option>
              ))}
            </select>
          </label>
          {attributesReady && colorFilter !== 'all' ? (
            <button
              type="button"
              className="small ghost"
              onClick={pasteAttributesToFilter}
            >
              Pegar atributos al filtro
            </button>
          ) : null}
          <label className="clip-search-field">
            <input
              type="search"
              value={clipQuery}
              placeholder="Buscar clip"
              aria-label="Buscar clips por nombre"
              onChange={(event) => setClipQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                jumpToSearchMatch();
              }}
            />
          </label>
        </div>
        <div className="timeline-tools">
          <select
            value={newTrackKind}
            aria-label="Tipo de pista nueva"
            onChange={(event) => setNewTrackKind(event.target.value as Track['kind'])}
          >
            <option value="video">Video</option>
            <option value="image">Imagen</option>
            <option value="audio">Audio</option>
            <option value="narration">Narración</option>
            <option value="caption">Subtítulos</option>
            <option value="graphic">Gráficos</option>
            <option value="adjustment">Ajustes</option>
          </select>
          <button
            type="button"
            className="small icon-text"
            aria-label="Agregar pista"
            onClick={addTrackToTimeline}
          >
            <Icon name="plus" size={13} />
            <span className="tool-label">Agregar pista</span>
          </button>
          <button
            type="button"
            className="small icon-text"
            aria-label="Agregar capa de ajuste en el playhead"
            title="Grade sobre el compuesto dentro de su tramo"
            onClick={addAdjustmentLayerToTimeline}
          >
            <Icon name="layers" size={13} />
            <span className="tool-label">Capa de ajuste</span>
          </button>
        </div>
        <div className="timeline-tools">
          <button
            type="button"
            className="small icon-text"
            aria-label="Dividir en playhead"
            disabled={!selectedClip}
            onClick={() => {
              if (!selectedClip) return;
              store.mutate((current) => {
                const split = splitClip(current, selectedClip.id, store.state.playheadFrame);
                if (!split) {
                  throw new ProjectActionError('el playhead no está dentro del clip seleccionado');
                }
                return { project: split.project, rightClipId: split.rightClipId };
              });
            }}
          >
            <Icon name="split" size={13} />
            <span className="tool-label">Dividir en playhead</span>
          </button>
          <button
            type="button"
            className="small icon-text"
            aria-label="Agregar o quitar marcador"
            aria-keyshortcuts="M"
            title="Agregar o quitar marcador en el playhead (M)"
            onClick={toggleMarkerAtPlayhead}
          >
            <Icon name="marker" size={13} />
            <span className="tool-label">Marcador</span>
          </button>
          <button
            type="button"
            className="small danger-ghost icon-text"
            aria-label="Borrar clip"
            disabled={selectedClipIds.size === 0 && !selectedClip}
            onClick={() => deleteSelectedClips(preferences.timelineRipple)}
          >
            <Icon name="trash" size={13} />
            <span className="tool-label">Borrar clip</span>
          </button>
          <button
            type="button"
            className="small ghost icon-text"
            aria-label="Copiar clip seleccionado"
            title="Copiar clip · Ctrl+C"
            disabled={!selectedClip}
            onClick={copySelectedClip}
          >
            <Icon name="copy" size={13} />
            <span className="tool-label">Copiar</span>
          </button>
          <button
            type="button"
            className="small ghost icon-text"
            aria-label="Pegar clip copiado en el playhead"
            title="Pegar clip · Ctrl+V"
            disabled={!clipboardReady}
            onClick={pasteCopiedClip}
          >
            <Icon name="paste" size={13} />
            <span className="tool-label">Pegar</span>
          </button>
          <button
            type="button"
            className="small danger-ghost icon-text"
            aria-label="Borrar clip y cerrar el hueco"
            title="Borra el clip (o los seleccionados) y mueve los siguientes para cerrar el hueco"
            disabled={selectedClipIds.size === 0 && !selectedClipId}
            onClick={rippleDeleteSelected}
          >
            <Icon name="ripple" size={13} />
            <span className="tool-label">Ripple</span>
          </button>
          <button
            type="button"
            className="small ghost icon-text"
            aria-label="Cerrar huecos de la pista del clip"
            title="Mueve los clips de esta pista para eliminar los huecos entre ellos"
            disabled={!selectedClip}
            onClick={() => {
              if (!selectedClip) return;
              const trackId = selectedClip.trackId;
              let moved = 0;
              let removedFrames = 0;
              store.update((current) => {
                const result = closeGaps(current, trackId);
                moved = result.moved;
                removedFrames = result.removedFrames;
                return result.project;
              });
              store.setNotice(
                moved > 0
                  ? `Huecos cerrados: ${moved} clip(s) movidos, ${removedFrames} frames recuperados.`
                  : 'La pista no tenía huecos que cerrar.',
              );
            }}
          >
            <Icon name="magnet" size={13} />
            <span className="tool-label">Cerrar huecos</span>
          </button>
          <button
            type="button"
            className="small danger-ghost icon-text"
            aria-label="Borrar subtítulo"
            disabled={!selectedCueId}
            onClick={() => {
              if (!selectedCueId) return;
              store.update((current) => deleteCaptionCue(current, selectedCueId));
              store.setSelection({ kind: 'none' });
            }}
          >
            <Icon name="captions" size={13} />
            <span className="tool-label">Borrar subtítulo</span>
          </button>
        </div>
        <span className="timeline-duration">
          {formatTimecode(store.durationFrames, fps)}
          <span className="duration-tracks"> · {project.timeline.tracks.length} pistas</span>
        </span>
      </div>

      {overviewVisible ? (
        <TimelineOverview
          durationFrames={duration}
          fps={fps}
          clips={overviewClips}
          playheadFrame={store.state.playheadFrame}
          contentWidth={contentWidth}
          clientWidth={viewport.clientWidth}
          scrollLeft={viewport.scrollLeft}
          onScrollTo={(next) => {
            const element = scrollRef.current;
            if (element) element.scrollLeft = next;
          }}
        />
      ) : null}

      <div
        ref={scrollRef}
        className={`timeline-scroll${panMode ? ' pan-mode' : ''}${panning ? ' panning' : ''}`}
        onPointerDownCapture={(event) => {
          if (!panMode && event.button !== 1) return;
          if (event.button !== 0 && event.button !== 1) return;
          beginPan(event);
        }}
        onPointerMove={movePan}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
      >
        <div
          className="timeline-surface"
          ref={surfaceRef}
          style={
            {
              width: surfaceWidth + headerWidth(),
              '--tl-grid-step': `${gridStepPx}px`,
            } as CSSProperties
          }
        >
          <div className="ruler-row" onPointerDown={beginScrub}>
            <div className="ruler-corner">
              <span className="ruler-corner-title">Timeline</span>
              <span className="ruler-corner-badge">SEQ 01</span>
            </div>
            <div className="ruler-lane" style={{ width: surfaceWidth }}>
              {minorTicks.map((frame) => (
                <span
                  key={`minor-${frame}`}
                  className="ruler-minor"
                  style={{ left: frame * pxPerFrame }}
                  aria-hidden="true"
                />
              ))}
              {ticks.map((frame) => (
                <div
                  key={frame}
                  className="ruler-tick"
                  style={{ left: frame * pxPerFrame }}
                >
                  <span>{formatTimecode(frame, fps)}</span>
                </div>
              ))}
              {project.markers.map((marker) =>
                marker.endFrame !== undefined ? (
                  <span
                    key={`range-${marker.id}`}
                    className={`timeline-marker-range marker-${marker.color ?? 'mint'}`}
                    style={{
                      left: marker.frame * pxPerFrame,
                      width: Math.max(2, (marker.endFrame - marker.frame) * pxPerFrame),
                    }}
                    aria-hidden="true"
                  />
                ) : null,
              )}
              {project.markers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={`timeline-marker marker-${marker.color ?? 'mint'}`}
                  style={{ left: marker.frame * pxPerFrame }}
                  title={`${marker.label} · ${formatTimecode(marker.frame, fps)}`}
                  aria-label={`Marcador ${marker.label} en ${formatTimecode(marker.frame, fps)}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    store.setPlaying(false);
                    store.setPlayhead(marker.frame);
                    store.setSelection({ kind: 'none' });
                  }}
                >
                  <span className="timeline-marker-flag" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          {tracks.length === 0 ? (
            <div className="timeline-empty" style={{ height: 220 }}>
              <strong>La timeline está vacía.</strong>
              <span>
                Montá un medio desde el panel de assets o importá archivos en Medios. Después
                arrastrá, recortá y dividí clips acá.
              </span>
            </div>
          ) : null}

          {trackWindow && trackWindow.topPad > 0 ? (
            <div
              className="timeline-spacer"
              style={{ height: trackWindow.topPad }}
              aria-hidden="true"
            />
          ) : null}
          {visibleTracks.map((track) => {
            const trackClips = project.timeline.clips.filter((clip) => clip.trackId === track.id);
            const trackCues =
              track.kind === 'caption'
                ? project.captions.cues.filter((cue) => cue.trackId === track.id)
                : [];
            // Virtualización de contenido: sólo los clips/cues que intersectan
            // la ventana visible (+overscan). Sin layout medible (jsdom),
            // `frameWindow` es null y se renderiza todo.
            const visibleClips = trackClips.filter((clip) =>
              spanIntersectsWindow(clip.startFrame, clip.durationFrames, frameWindow),
            );
            const visibleCues = trackCues.filter((cue) =>
              spanIntersectsWindow(cue.startFrame, cue.endFrame - cue.startFrame, frameWindow),
            );
            const collapsed = collapsedTracks.has(track.id);
            const storedHeight = trackHeights[track.id];
            // Sin alto guardado, el alto lo pone el CSS con `--timeline-row`
            // (spec §10.1: 34–76 px del usuario); sólo escribimos inline cuando
            // la pista está plegada o el usuario ya la redimensionó.
            const height = collapsed ? TRACK_MIN : storedHeight;
            return (
              <div
                key={track.id}
                className={`timeline-row${store.state.selection.kind === 'track' && store.state.selection.id === track.id ? ' selected' : ''}${collapsed ? ' collapsed' : ''}`}
                style={height !== undefined ? { height } : undefined}
                data-track-id={track.id}
              >
                <div className="track-head">
                  <button
                    type="button"
                    className="track-name"
                    onClick={() => store.setSelection({ kind: 'track', id: track.id })}
                    title="Seleccionar pista"
                  >
                    <span className={`track-kind kind-${track.kind}`}>{track.kind.slice(0, 3).toUpperCase()}</span>
                    <span>{track.label}</span>
                  </button>
                  <div className="track-flags">
                    <button
                      type="button"
                      aria-label={collapsed ? `Expandir ${track.label}` : `Colapsar ${track.label}`}
                      aria-pressed={collapsed}
                      title={collapsed ? 'Expandir pista' : 'Colapsar pista'}
                      className="flag"
                      onClick={() =>
                        setCollapsedTracks((current) => {
                          const next = new Set(current);
                          if (next.has(track.id)) next.delete(track.id);
                          else next.add(track.id);
                          return next;
                        })
                      }
                    >
                      <Icon name={collapsed ? 'chevron' : 'chevron-down'} size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Silenciar ${track.label}`}
                      aria-pressed={track.muted}
                      title="Silenciar pista"
                      className={track.muted ? 'flag active' : 'flag'}
                      onClick={() => store.update((current) => updateTrack(current, track.id, { muted: !track.muted }))}
                    >
                      <Icon name="volume" size={12} />
                    </button>
                    {track.kind === 'video' || track.kind === 'audio' || track.kind === 'narration' ? (
                      <button
                        type="button"
                        aria-label={`Solo ${track.label}`}
                        aria-pressed={track.solo === true}
                        title="Solo: silencia las demás pistas con audio"
                        className={track.solo ? 'flag solo active' : 'flag solo'}
                        onClick={() => store.update((current) => updateTrack(current, track.id, { solo: !track.solo }))}
                      >
                        <span className="flag-letter">S</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Ocultar ${track.label}`}
                      aria-pressed={track.hidden}
                      title="Ocultar pista"
                      className={track.hidden ? 'flag active' : 'flag'}
                      onClick={() => store.update((current) => updateTrack(current, track.id, { hidden: !track.hidden }))}
                    >
                      <Icon name="eye" size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Bloquear ${track.label}`}
                      aria-pressed={track.locked}
                      title="Bloquear pista"
                      className={track.locked ? 'flag active' : 'flag'}
                      onClick={() => store.update((current) => updateTrack(current, track.id, { locked: !track.locked }))}
                    >
                      <Icon name="lock" size={12} />
                    </button>
                  </div>
                </div>
                <div
                  className="track-resize"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={`Alto de la pista ${track.label}`}
                  title="Arrastrá para cambiar el alto de esta pista · doble clic para restablecer"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const startY = event.clientY;
                    // El alto real puede venir de CSS (densidad cómoda/compacta);
                    // leerlo del DOM evita saltos al empezar a arrastrar.
                    const row = event.currentTarget.closest('.timeline-row');
                    const measured = row ? Math.round(row.getBoundingClientRect().height) : 0;
                    const startHeight =
                      storedHeight ??
                      (measured > 0 ? measured : defaultRowHeight(track.kind));
                    const move = (pointer: PointerEvent): void => {
                      setTrackHeights((current) => ({
                        ...current,
                        [track.id]: clampTrackHeight(startHeight + (pointer.clientY - startY)),
                      }));
                    };
                    const up = (): void => {
                      window.removeEventListener('pointermove', move);
                      window.removeEventListener('pointerup', up);
                      window.removeEventListener('pointercancel', up);
                    };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                    window.addEventListener('pointercancel', up);
                  }}
                  onDoubleClick={() =>
                    setTrackHeights((current) => {
                      const next = { ...current };
                      delete next[track.id];
                      return next;
                    })
                  }
                />
                <div
                  className="track-lane"
                  data-lane-track-id={track.id}
                  style={{ width: surfaceWidth }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    if (event.target !== event.currentTarget) return;
                    store.setSelection({ kind: 'none' });
                    store.setPlaying(false);
                    const rect = event.currentTarget.getBoundingClientRect();
                    store.setPlayhead(Math.max(0, Math.round((event.clientX - rect.left) / pxPerFrame)));
                  }}
                >
                  {visibleClips.map((clip) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      track={track}
                      pxPerFrame={pxPerFrame}
                      selected={isClipSelected(clip.id)}
                      dimmed={
                        !clipMatchesColorFilter(clip.colorTag, colorFilter) ||
                        !matchesClipSearch(
                          [
                            clip.label,
                            track.label,
                            clip.source.type === 'asset'
                              ? assetById(project, clip.source.assetId)?.label
                              : undefined,
                          ],
                          clipQuery,
                        )
                      }
                      preview={preview}
                      showThumbnail={preferences.showThumbnails}
                      showWaveform={preferences.showWaveforms}
                      onSelect={(event) => clipHandlersRef.current.select(clip.id, event)}
                      onSeek={(event) => clipHandlersRef.current.seek(event, clip)}
                      onDrag={(event, mode) =>
                        clipHandlersRef.current.drag(event, clip, mode)
                      }
                      onContextMenu={(event) => clipHandlersRef.current.menu(event, clip)}
                    />
                  ))}
                  {visibleCues.map((cue) => (
                    <CueBlock
                      key={cue.id}
                      cue={cue}
                      pxPerFrame={pxPerFrame}
                      selected={selectedCueId === cue.id}
                      preview={preview}
                      onSelect={() => store.setSelection({ kind: 'cue', id: cue.id })}
                      onDrag={(event) => beginCueDrag(event, cue)}
                    />
                  ))}
                  {trackClips.length === 0 && trackCues.length === 0 ? (
                    <span className="lane-hint">
                      {track.kind === 'caption' ? 'Sin subtítulos' : 'Pista vacía'}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}

          {trackWindow && trackWindow.bottomPad > 0 ? (
            <div
              className="timeline-spacer"
              style={{ height: trackWindow.bottomPad }}
              aria-hidden="true"
            />
          ) : null}

          {snapGuide ? (
            <div
              className="snap-guide"
              style={{ left: headerWidth() + snapGuide.frame * pxPerFrame }}
              aria-hidden="true"
            >
              <span>{snapGuide.label}</span>
            </div>
          ) : null}

          <div
            className="playhead-line"
            style={{ left: headerWidth() + store.state.playheadFrame * pxPerFrame }}
          >
            <span
              className="playhead-grip"
              role="slider"
              tabIndex={0}
              aria-label="Cabezal de la timeline"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={Math.round(store.state.playheadFrame)}
              title="Arrastrá para mover el cabezal"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginScrub(event);
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 10 : 1;
                let next: number | null = null;
                if (event.key === 'ArrowLeft') next = store.state.playheadFrame - step;
                else if (event.key === 'ArrowRight') next = store.state.playheadFrame + step;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = duration;
                if (next === null) return;
                event.preventDefault();
                store.setPlaying(false);
                store.setPlayhead(Math.max(0, Math.min(duration, next)));
              }}
            />
          </div>

          {contextMenu && contextClip ? (
            <div
              ref={contextMenuRef}
              className="timeline-menu"
              role="menu"
              aria-label={`Acciones para ${contextClip.label ?? 'el clip'}`}
              style={{
                left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 244)),
                top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 300)),
              }}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setContextMenu(null);
                  return;
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]:not(:disabled)',
                  ),
                );
                if (items.length === 0) return;
                if (event.key === 'Home') {
                  items[0]?.focus();
                  return;
                }
                if (event.key === 'End') {
                  items[items.length - 1]?.focus();
                  return;
                }
                const current = items.indexOf(document.activeElement as HTMLButtonElement);
                const step = event.key === 'ArrowDown' ? 1 : -1;
                items[(current + step + items.length) % items.length]?.focus();
              }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={!contextSplitAllowed}
                onClick={splitContextClip}
              >
                <span>Dividir en el playhead</span>
                <span className="timeline-menu-hint">Playhead</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={contextLocked}
                onClick={duplicateContextClip}
              >
                <span>Duplicar</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  copySelectedClip();
                  setContextMenu(null);
                }}
              >
                <span>Copiar</span>
                <span className="timeline-menu-hint">Ctrl+C</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!clipboardReady}
                onClick={() => {
                  pasteCopiedClip();
                  setContextMenu(null);
                }}
              >
                <span>Pegar en el playhead</span>
                <span className="timeline-menu-hint">Ctrl+V</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  copyAttributesFor(contextClip);
                  setContextMenu(null);
                }}
              >
                <span>Copiar atributos</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!attributesReady}
                onClick={() => {
                  pasteAttributesFor(contextClip);
                  setContextMenu(null);
                }}
              >
                <span>Pegar atributos</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={contextLocked}
                onClick={() => {
                  store.update((current) =>
                    updateClip(current, contextClip.id, {
                      enabled: contextClip.enabled === false,
                    }),
                  );
                  setContextMenu(null);
                  store.setNotice(
                    contextClip.enabled === false
                      ? 'Clip activado.'
                      : 'Clip desactivado: sigue en la timeline pero no se renderiza.',
                  );
                }}
              >
                <span>
                  {contextClip.enabled === false ? 'Activar clip' : 'Desactivar clip'}
                </span>
              </button>
              <div className="timeline-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  store.setPlayhead(contextClip.startFrame);
                  setContextMenu(null);
                }}
              >
                <span>Ir al inicio del clip</span>
              </button>
              <div className="timeline-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={contextLocked}
                onClick={deleteContextClip}
              >
                <span>Eliminar clip</span>
                <span className="timeline-menu-hint">Supr</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={contextLocked}
                onClick={() => {
                  rippleDeleteSelected();
                  setContextMenu(null);
                }}
              >
                <span>Eliminar y cerrar hueco</span>
                <span className="timeline-menu-hint">Shift+Supr</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
