import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Asset, CaptionCue, Clip, ProjectDocument, Track } from '@editor-ia/project-schema';
import { useThumbnail } from '../../hooks/useThumbnail';
import {
  ProjectActionError,
  addTrack,
  deleteCaptionCue,
  deleteClip,
  formatTimecode,
  fpsOf,
  moveClip,
  splitClip,
  trimClip,
  updateCaptionCue,
  updateTrack,
} from '../../state/project-actions';
import { useProjectStore } from '../../state/project-store';

const HEADER = 152;
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
}: {
  readonly clip: Clip;
  readonly track: Track;
  readonly pxPerFrame: number;
  readonly selected: boolean;
  readonly preview: Drag | null;
  readonly onSelect: () => void;
  readonly onDrag: (event: ReactPointerEvent, mode: 'move' | 'trim-start' | 'trim-end') => void;
}) {
  const store = useProjectStore();
  const project = store.state.project;
  const root = store.state.opened?.root ?? '';
  const asset = clip.source.type === 'asset' && project ? assetById(project, clip.source.assetId) : undefined;
  const thumbnail = useThumbnail(store.service, asset ?? null, root || null);
  const activePreview =
    preview && preview.kind === 'clip' && preview.clipId === clip.id ? preview : null;
  const start = activePreview?.previewStart ?? clip.startFrame;
  const duration = activePreview?.previewDuration ?? clip.durationFrames;
  const left = start * pxPerFrame;
  const width = Math.max(3, duration * pxPerFrame);
  const isWindowed = clip.kind === 'video' || clip.kind === 'audio';

  return (
    <div
      className={`timeline-clip kind-${clip.kind}${selected ? ' selected' : ''}${track.locked ? ' locked' : ''}${activePreview ? ' dragging' : ''}`}
      style={{ left, width }}
      role="button"
      tabIndex={0}
      aria-label={`${clip.label ?? clip.kind} en ${track.label}, desde ${formatTimecode(clip.startFrame, project ? fpsOf(project) : 30)}`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        onSelect();
        if (!track.locked) onDrag(event, 'move');
      }}
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
      <span className="clip-label">{clip.label ?? track.label}</span>
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
  const latest = useRef({ project, pxPerFrame, store });
  latest.current = { project, pxPerFrame, store };
  const surfaceRef = useRef<HTMLDivElement>(null);

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
  const ticks: number[] = [];
  for (let frame = 0; frame <= duration + fps; frame += Math.max(1, Math.round(step * fps))) {
    ticks.push(frame);
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
            −
          </button>
          <span className="zoom-readout">{pxPerFrame.toFixed(2)} px/frame</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Acercar"
            onClick={() => setPxPerFrame((value) => Math.min(14, value * 1.4))}
          >
            +
          </button>
          <button
            type="button"
            className="small ghost"
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
          </select>
          <button type="button" className="small" onClick={addTrackToTimeline}>
            Agregar pista
          </button>
        </div>
        <div className="timeline-tools">
          <button
            type="button"
            className="small"
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
            Dividir en playhead
          </button>
          <button
            type="button"
            className="small danger-ghost"
            disabled={!selectedClip}
            onClick={() => {
              if (!selectedClip) return;
              store.update((current) => deleteClip(current, selectedClip.id));
              store.setSelection({ kind: 'none' });
            }}
          >
            Borrar clip
          </button>
          <button
            type="button"
            className="small danger-ghost"
            disabled={!selectedCueId}
            onClick={() => {
              if (!selectedCueId) return;
              store.update((current) => deleteCaptionCue(current, selectedCueId));
              store.setSelection({ kind: 'none' });
            }}
          >
            Borrar subtítulo
          </button>
        </div>
        <span className="timeline-duration">
          {formatTimecode(store.durationFrames, fps)} · {project.timeline.tracks.length} pistas
        </span>
      </div>

      <div className="timeline-scroll">
        <div className="timeline-surface" ref={surfaceRef} style={{ width: surfaceWidth + HEADER }}>
          <div className="ruler-row">
            <div className="ruler-corner">Timeline</div>
            <div className="ruler-lane" onPointerDown={beginScrub}>
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
                      className={track.muted ? 'flag active' : 'flag'}
                      onClick={() => store.update((current) => updateTrack(current, track.id, { muted: !track.muted }))}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      aria-label={`Ocultar ${track.label}`}
                      aria-pressed={track.hidden}
                      className={track.hidden ? 'flag active' : 'flag'}
                      onClick={() => store.update((current) => updateTrack(current, track.id, { hidden: !track.hidden }))}
                    >
                      O
                    </button>
                    <button
                      type="button"
                      aria-label={`Bloquear ${track.label}`}
                      aria-pressed={track.locked}
                      className={track.locked ? 'flag active' : 'flag'}
                      onClick={() => store.update((current) => updateTrack(current, track.id, { locked: !track.locked }))}
                    >
                      L
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
        </div>
      </div>
    </div>
  );
}
