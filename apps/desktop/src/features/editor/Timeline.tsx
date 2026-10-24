import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
  rippleDeleteClip,
  totalFrames,
  updateCaptionCue,
  updateClip,
  updateTrack,
} from '../../state/project-actions';
import { addMarker, deleteMarker, markerAtFrame } from '../../state/markers';
import { useProjectStore } from '../../state/project-store';
import { useEditorPreferences } from '../../state/useEditorPreferences';
import {
  collectSnapTargets,
  snapFrame,
  snapSpan,
  snapThreshold,
} from '../../state/snapping';

const HEADER = 168;
const ROW_HEIGHT = 56;
const CAPTION_ROW_HEIGHT = 42;

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

function ClipBlock({
  clip,
  track,
  pxPerFrame,
  selected,
  dimmed,
  preview,
  showThumbnail,
  showWaveform,
  onSelect,
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
  readonly onSelect: () => void;
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
  const start = activePreview?.previewStart ?? clip.startFrame;
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
    target.setPointerCapture?.(event.pointerId);
    const onMove = (moveEvent: PointerEvent): void => {
      const delta = (moveEvent.clientX - startX) / Math.max(0.0001, pxPerFrame);
      last = fadeFramesForDrag(side, initial, delta, clip.durationFrames);
      store.update(
        (current) => applyFadeFrames(current, clip.id, side, last, fade.audioOnly),
        { history: false },
      );
    };
    const finish = (): void => {
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
        onSelect();
        if (!track.locked) onDrag(event, 'move');
      }}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {showThumbnail && thumbnail && (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'freeze') ? (
        <img className="clip-thumb" src={thumbnail} alt="" draggable={false} />
      ) : null}
      {showWaveform && peaks && peaks.length > 1 ? (
        <svg
          className={`clip-waveform kind-${clip.kind}`}
          viewBox={`0 0 ${peaks.length} 40`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {peaks.map((peak, index) => {
            const height = Math.max(1.4, peak * 34);
            return (
              <rect
                key={index}
                x={index + 0.14}
                y={20 - height / 2}
                width={0.72}
                height={height}
                rx={0.28}
              />
            );
          })}
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
              onSelect();
              onDrag(event, 'trim-start');
            }}
          />
          <span
            className="trim-handle end"
            role="separator"
            aria-label="Recortar el final"
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect();
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

export function Timeline() {
  const store = useProjectStore();
  const project = store.state.project;
  const preferences = useEditorPreferences();
  // El zoom y el imán arrancan con lo elegido en Ajustes → Editor; después el
  // usuario manda con los controles de la barra de la timeline.
  const [pxPerFrame, setPxPerFrame] = useState(preferences.defaultZoom);
  const [newTrackKind, setNewTrackKind] = useState<Track['kind']>('video');
  const [preview, setPreview] = useState<Drag | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(preferences.snapEnabled);
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

  const selectedClipId =
    store.state.selection.kind === 'clip' ? store.state.selection.id : null;
  const selectedCueId =
    store.state.selection.kind === 'cue' ? store.state.selection.id : null;

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

  function rippleDeleteSelected(): void {
    if (!selectedClipId) return;
    store.update((current) => rippleDeleteClip(current, selectedClipId));
    store.setSelection({ kind: 'none' });
    store.setNotice('Clip borrado y hueco cerrado en su pista.');
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedClipId, project]);

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
          (element.scrollLeft + pointerX - HEADER) / currentScale,
        );
        const next = clamp(currentScale * (delta < 0 ? 1.16 : 1 / 1.16), 0.2, 14);
        setPxPerFrame(next);
        window.requestAnimationFrame(() => {
          element.scrollLeft = Math.max(0, HEADER + anchor * next - pointerX);
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
    const x = HEADER + store.state.playheadFrame * pxPerFrame;
    const left = element.scrollLeft;
    const margin = 80;
    if (x < left + HEADER + margin || x > left + element.clientWidth - margin) {
      element.scrollLeft = Math.max(0, x - element.clientWidth / 2);
    }
  }, [
    preferences.followPlayhead,
    pxPerFrame,
    store.state.playheadFrame,
    store.state.playing,
  ]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
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
        const frame = Math.max(0, Math.round((event.clientX - rect.left - HEADER) / scale));
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
          const snapped = snapSpan(
            nextStart,
            length,
            collectSnapTargets(doc, {
              playhead: state.state.playheadFrame,
            }),
            threshold,
          );
          nextStart = Math.max(0, snapped.start);
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
          const snapped = snapSpan(
            nextStart,
            current.originalDuration,
            collectSnapTargets(doc, {
              excludeClipId: current.clipId,
              playhead: state.state.playheadFrame,
            }),
            threshold,
          );
          nextStart = Math.max(0, snapped.start);
          if (snapped.target) {
            guide = { frame: snapped.target.frame, label: snapped.target.label };
          }
        }
        setSnapGuide(guide);
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
          const snapped = snapFrame(
            nextStart,
            collectSnapTargets(doc, {
              excludeClipId: current.clipId,
              playhead: state.state.playheadFrame,
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
          const snapped = snapFrame(
            targetEnd,
            collectSnapTargets(doc, {
              excludeClipId: current.clipId,
              playhead: state.state.playheadFrame,
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

    const onUp = (event: PointerEvent) => {
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
        if (
          current.previewStart === current.originalStart &&
          current.previewTrackId === trackById(doc, current.clipId)?.id
        ) {
          return;
        }
        const hovered = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest('[data-lane-track-id]') as HTMLElement | null;
        const targetTrackId = hovered?.dataset.laneTrackId ?? current.previewTrackId;
        const magnetic = latest.current.snapEnabled && !event.altKey;
        state.update((projectDoc) => {
          const next = magnetic
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
      state.update((projectDoc) => {
        const next = trimClip(
          projectDoc,
          current.clipId,
          current.mode === 'trim-start' ? 'start' : 'end',
          current.mode === 'trim-start'
            ? current.previewStart
            : current.previewStart + current.previewDuration,
        );
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
      if (scrubRafRef.current) {
        window.cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = 0;
      }
    };
  }, []);

  if (!project) return null;

  const pxPerSecond = pxPerFrame * fps;
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((value) => value * pxPerSecond >= 92) ?? 900;
  const majorFrames = Math.max(1, Math.round(step * fps));
  const minorFrames = Math.max(2, Math.round(majorFrames / 5));
  const ticks: number[] = [];
  for (let frame = 0; frame <= duration + fps; frame += majorFrames) {
    ticks.push(frame);
  }
  const minorTicks: number[] = [];
  for (let frame = 0; frame <= duration + fps; frame += minorFrames) {
    if (frame % majorFrames !== 0) minorTicks.push(frame);
  }

  function beginScrub(event: ReactPointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    store.setPlaying(false);
    store.setSelection({ kind: 'none' });
    dragRef.current = { kind: 'scrub' };
    setPreview({ kind: 'scrub' });
    setSnapGuide(null);
    const surface = surfaceRef.current;
    if (surface) {
      const rect = surface.getBoundingClientRect();
      const frame = Math.max(0, Math.round((event.clientX - rect.left - HEADER) / pxPerFrame));
      store.setPlayhead(frame);
    }
  }

  function beginClipDrag(
    event: ReactPointerEvent,
    clip: Clip,
    mode: 'move' | 'trim-start' | 'trim-end',
  ): void {
    event.preventDefault();
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

  return (
    <div className="timeline">
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
            disabled={!selectedClip}
            onClick={() => {
              if (!selectedClip) return;
              let nextDuration = 0;
              store.update((current) => {
                const next = deleteClip(current, selectedClip.id);
                nextDuration = totalFrames(next);
                return next;
              });
              store.setSelection({ kind: 'none' });
              store.setPlayhead(Math.min(store.state.playheadFrame, nextDuration));
            }}
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
            title="Borra el clip y mueve los siguientes para cerrar el hueco"
            disabled={!selectedClip}
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
        <div className="timeline-surface" ref={surfaceRef} style={{ width: surfaceWidth + HEADER }}>
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

          {tracks.map((track) => {
            const trackClips = project.timeline.clips.filter((clip) => clip.trackId === track.id);
            const trackCues =
              track.kind === 'caption'
                ? project.captions.cues.filter((cue) => cue.trackId === track.id)
                : [];
            const height = track.kind === 'caption' ? CAPTION_ROW_HEIGHT : ROW_HEIGHT;
            return (
              <div
                key={track.id}
                className={`timeline-row${store.state.selection.kind === 'track' && store.state.selection.id === track.id ? ' selected' : ''}`}
                style={{ height }}
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
                  {trackClips.map((clip) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      track={track}
                      pxPerFrame={pxPerFrame}
                      selected={selectedClipId === clip.id}
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
                      onSelect={() => store.setSelection({ kind: 'clip', id: clip.id })}
                      onDrag={(event, mode) => beginClipDrag(event, clip, mode)}
                      onContextMenu={(event) => openClipMenu(event, clip)}
                    />
                  ))}
                  {trackCues.map((cue) => (
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

          {snapGuide ? (
            <div
              className="snap-guide"
              style={{ left: HEADER + snapGuide.frame * pxPerFrame }}
              aria-hidden="true"
            >
              <span>{snapGuide.label}</span>
            </div>
          ) : null}

          <div
            className="playhead-line"
            style={{ left: HEADER + store.state.playheadFrame * pxPerFrame }}
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
}
