import type { Clip, ProjectDocument, Track } from '@editor-ia/project-schema';

/**
 * Shared primitives for project mutations: id/time helpers, the immutable
 * clone/touch pair and timeline placement utilities. Extracted from
 * `project-actions.ts` so domain modules (captions, scenes, clips) can share
 * them without importing the whole action surface.
 */

export type MutableProject = ProjectDocument;
export type WindowedClip = Extract<Clip, { kind: 'video' | 'audio' }>;

export class ProjectActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectActionError';
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function cloneProject(project: ProjectDocument): ProjectDocument {
  return JSON.parse(JSON.stringify(project)) as ProjectDocument;
}

export function fpsOf(project: ProjectDocument): number {
  const { num, den } = project.video.frameRate;
  return num / Math.max(1, den);
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / Math.max(1, fps);
}

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * Math.max(1, fps)));
}

/** Tasas fraccionarias de broadcast con timecode drop-frame (SMPTE). */
const DF_RATES = [30000 / 1001, 60000 / 1001] as const;

export function isDropFrameFps(fps: number): boolean {
  return DF_RATES.some((rate) => Math.abs(fps - rate) < 0.005);
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * frames → `H:MM:SS;FF` drop-frame. Mismo algoritmo que el export EDL
 * (`commands/edl.rs`) y que Kdenlive `Timecode::getTimecodeDropFrame`: las
 * etiquetas corren al fps nominal (30/60) y saltan `drop` números por minuto,
 * salvo en los minutos múltiplos de 10.
 */
export function formatDropTimecode(frames: number, fps: number): string {
  const displayed = Math.round(fps);
  const drop = Math.round(fps * 0.066666);
  const framesPer10Minutes = Math.round(fps * 600);
  const perMinuteDivisor = Math.round(fps * 60) - drop;
  let adjusted = Math.max(0, Math.round(frames));
  const d = Math.floor(adjusted / framesPer10Minutes);
  const m = adjusted % framesPer10Minutes;
  adjusted += drop * 9 * d;
  if (m > drop) {
    adjusted += drop * Math.floor((m - drop) / perMinuteDivisor);
  }
  const ff = adjusted % displayed;
  const totalSeconds = Math.floor(adjusted / displayed);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${hh}:${pad2(mm)}:${pad2(ss)};${pad2(ff)}`;
}

export function formatTimecode(frames: number, fps: number): string {
  if (isDropFrameFps(fps)) {
    return formatDropTimecode(frames, fps);
  }
  const totalSeconds = Math.max(0, frames) / Math.max(1, fps);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frame = Math.round((totalSeconds - Math.floor(totalSeconds)) * fps);
  return [hours, minutes, seconds, frame]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join(':');
}

export function touch(project: MutableProject): void {
  project.revision += 1;
  project.updatedAt = new Date().toISOString();
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

export function speedOf(clip: Clip): { num: number; den: number } {
  const speed = (clip as WindowedClip).speed;
  return {
    num: speed?.num ?? 1,
    den: speed?.den ?? 1,
  };
}

export function isWindowed(clip: Clip): clip is WindowedClip {
  return clip.kind === 'video' || clip.kind === 'audio';
}

export function trackKindForClip(clip: Clip): Track['kind'] {
  switch (clip.kind) {
    case 'video':
      return 'video';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'graphic':
      return 'graphic';
    case 'freeze':
      return 'video';
    case 'adjustment':
      return 'adjustment';
    case 'compound':
      return 'video';
  }
}

export function clipEnd(clip: Clip): number {
  return clip.startFrame + clip.durationFrames;
}

export function intervalsForTrack(project: ProjectDocument, trackId: string, exceptClipId?: string) {
  return project.timeline.clips
    .filter((clip) => clip.trackId === trackId && clip.id !== exceptClipId)
    .map((clip) => ({ start: clip.startFrame, end: clipEnd(clip) }))
    .sort((a, b) => a.start - b.start);
}

export function findGap(
  intervals: { start: number; end: number }[],
  preferred: number,
  duration: number,
): number {
  let start = Math.max(0, Math.floor(preferred));
  // No asumir que el caller ya ordenó: una cue movida o importada puede dejar
  // intervalos fuera de orden y el primer hueco sería falso.
  const ordered = [...intervals].sort((a, b) => a.start - b.start);
  for (const interval of ordered) {
    if (start + duration <= interval.start) {
      return start;
    }
    start = Math.max(start, interval.end);
  }
  return start;
}

export function canPlaceClip(
  project: ProjectDocument,
  trackId: string,
  startFrame: number,
  durationFrames: number,
  exceptClipId?: string,
): boolean {
  const start = Math.max(0, startFrame);
  const end = start + durationFrames;
  return intervalsForTrack(project, trackId, exceptClipId).every(
    (interval) => end <= interval.start || start >= interval.end,
  );
}

export function addTrack(
  project: ProjectDocument,
  kind: Track['kind'],
  label?: string,
): { project: ProjectDocument; trackId: string } {
  const next = cloneProject(project);
  const order = Math.max(-1, ...next.timeline.tracks.map((track) => track.order)) + 1;
  const track: Track = {
    id: newId(),
    kind,
    label: label?.trim() || `${kind[0]?.toUpperCase() ?? 'T'}${order + 1}`,
    order,
    muted: false,
    hidden: false,
    locked: false,
  };
  next.timeline.tracks.push(track);
  touch(next);
  return { project: next, trackId: track.id };
}
