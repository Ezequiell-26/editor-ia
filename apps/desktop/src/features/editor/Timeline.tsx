import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Asset, CaptionCue, Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { useThumbnail } from '../../hooks/useThumbnail';
import { peaksForWindow, useWaveform } from '../../hooks/useWaveform';
import { Icon } from '../../components/Icon';
import { friendlyAssetLabel } from '../../state/asset-labels';
import {
  ProjectActionError,
  addAdjustmentLayer,
  addTrack,
  deleteCaptionCue,
  deleteClip,
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
  updateTrack,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

const HEADER = 168;
const ROW_HEIGHT = 56;
const CAPTION_ROW_HEIGHT = 42;
const SNAP_FRAMES = 5;

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

function ClipBlock({
  clip,
  track,
  pxPerFrame,
  selected,
  preview,
  onSelect,
  onDrag,
  onContextMenu,
}: {
  readonly clip: Clip;
  readonly track: Track;
  readonly pxPerFrame: number;
  readonly selected: boolean;
  readonly preview: Drag | null;
  readonly onSelect: () => void;
  readonly onDrag: (event: ReactPointerEvent, mode: 'move' | 'trim-start' | 'trim-end') => void;
  readonly onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const root = store.state.opened?.root ?? '';
  const asset = clip.source.type === 'asset' && project ? assetById(project, clip.source.assetId) : undefined;
  const thumbnail = useThumbnail(store.service, asset ?? null, root || null);
  const waveform = useWaveform(store.service, root || null, asset ?? null);
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

  return (
    <div
      className={`timeline-clip kind-${clip.kind}${selected ? ' selected' : ''}${track.locked ? ' locked' : ''}${activePreview ? ' dragging' : ''}`}
      style={{ left, width }}
      role="button"
      tabIndex={0}
      aria-label={`${clipLabel} en ${track.label}, desde ${formatTimecode(clip.startFrame, project ? fpsOf(project) : 30)}`}
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
      {thumbnail && (clip.kind === 'video' || clip.kind === 'image') ? (
        <img className="clip-thumb" src={thumbnail} alt="" draggable={false} />
      ) : null}
      {peaks && peaks.length > 1 ? (
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
      <span className="clip-label">{clipLabel}</span>
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
  const [pxPerFrame, setPxPerFrame] = useState(2.4);
  const [newTrackKind, setNewTrackKind] = useState<Track['kind']>('video');
  const [preview, setPreview] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const clipboardRef = useRef<Clip | null>(null);
  const [clipboardReady, setClipboardReady] = useState(false);
  const latest = useRef({ project, pxPerFrame, store });
  latest.current = { project, pxPerFrame, store };
  const surfaceRef = useRef<HTMLDivElement>(null);
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
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedClipId, project]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      const { project: doc, pxPerFrame: scale, store: state } = latest.current;
      if (!current || !doc) return;
      if (current.kind === 'scrub') {
        const surface = surfaceRef.current;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        const frame = Math.max(0, Math.round((event.clientX - rect.left - HEADER) / scale));
        state.setPlayhead(frame);
        return;
      }
      if (current.kind === 'cue') {
        const delta = Math.round((event.clientX - current.originX) / scale);
        const shift = Math.max(-current.originalStart, delta);
        const length = current.originalEnd - current.originalStart;
        const nextStart = current.originalStart + shift;
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
        const targets = [
          state.state.playheadFrame,
          0,
          ...doc.timeline.clips
            .filter((clip) => clip.id !== current.clipId && clip.trackId === current.previewTrackId)
            .flatMap((clip) => [clip.startFrame, clip.startFrame + clip.durationFrames]),
        ];
        const nearest = targets.reduce(
          (best, target) =>
            Math.abs(target - nextStart) < Math.abs(best - nextStart) ? target : best,
          nextStart,
        );
        if (Math.abs(nearest - nextStart) <= SNAP_FRAMES) {
          nextStart = nearest;
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
        let nextStart = clamp(
          current.originalStart + delta,
          0,
          current.originalStart + current.originalDuration - 1,
        );
        const targets = [
          state.state.playheadFrame,
          0,
          ...doc.timeline.clips
            .filter((clip) => clip.id !== current.clipId && clip.trackId === current.previewTrackId)
            .flatMap((clip) => [clip.startFrame, clip.startFrame + clip.durationFrames]),
        ];
        const nearest = targets.reduce(
          (best, edge) =>
            Math.abs(edge - nextStart) < Math.abs(best - nextStart) ? edge : best,
          nextStart,
        );
        if (Math.abs(nearest - nextStart) <= SNAP_FRAMES) nextStart = nearest;
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
        const targetEnd = current.originalStart + nextDuration;
        const targets = [
          state.state.playheadFrame,
          ...doc.timeline.clips
            .filter((clip) => clip.id !== current.clipId && clip.trackId === current.previewTrackId)
            .flatMap((clip) => [clip.startFrame, clip.startFrame + clip.durationFrames]),
        ];
        const nearest = targets.reduce(
          (best, edge) =>
            Math.abs(edge - targetEnd) < Math.abs(best - targetEnd) ? edge : best,
          targetEnd,
        );
        if (Math.abs(nearest - targetEnd) <= SNAP_FRAMES) {
          nextDuration = Math.max(1, nearest - current.originalStart);
        }
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
      if (!current) return;
      if (current.kind === 'scrub') return;
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
        state.update((projectDoc) => {
          const next = moveClip(
            projectDoc,
            current.clipId,
            current.previewStart,
            targetTrackId,
          );
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
    store.setPlaying(false);
    store.setSelection({ kind: 'none' });
    dragRef.current = { kind: 'scrub' };
    setPreview({ kind: 'scrub' });
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
  }

  function beginCueDrag(event: ReactPointerEvent, cue: CaptionCue): void {
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
  }

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
            className="small ghost"
            aria-label="Copiar clip seleccionado"
            disabled={!selectedClip}
            onClick={copySelectedClip}
          >
            Copiar
          </button>
          <button
            type="button"
            className="small ghost"
            aria-label="Pegar clip copiado en el playhead"
            disabled={!clipboardReady}
            onClick={pasteCopiedClip}
          >
            Pegar
          </button>
          <button
            type="button"
            className="small danger-ghost"
            aria-label="Borrar clip y cerrar el hueco"
            title="Borra el clip y mueve los siguientes para cerrar el hueco"
            disabled={!selectedClip}
            onClick={rippleDeleteSelected}
          >
            Ripple
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

      <div className="timeline-scroll">
        <div className="timeline-surface" ref={surfaceRef} style={{ width: surfaceWidth + HEADER }}>
          <div className="ruler-row">
            <div className="ruler-corner">
              <span className="ruler-corner-title">Timeline</span>
              <span className="ruler-corner-badge">SEQ 01</span>
            </div>
            <div className="ruler-lane" onPointerDown={beginScrub}>
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
                      preview={preview}
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

          <div
            className="playhead-line"
            style={{ left: HEADER + store.state.playheadFrame * pxPerFrame }}
            aria-hidden="true"
          >
            <span className="playhead-grip" />
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
