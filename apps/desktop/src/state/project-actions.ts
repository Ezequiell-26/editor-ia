import type {
  Asset,
  CaptionCue,
  Clip,
  ProjectDocument,
  Scene,
  Track,
} from '@editor-ia/project-schema';

/**
 * Pure project mutations.
 *
 * Every function returns a new document or `null` when the operation would
 * break the canonical format. The store validates the result before adopting
 * it, so an editor bug can never write a project the Rust boundary rejects.
 * Timeline timing stays in integer frames and every trim/split preserves the
 * `duration x speed = sourceWindow` identity.
 */

type MutableProject = ProjectDocument;
type WindowedClip = Extract<Clip, { kind: 'video' | 'audio' }>;

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

export function formatTimecode(frames: number, fps: number): string {
  const totalSeconds = Math.max(0, frames) / Math.max(1, fps);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frame = Math.round((totalSeconds - Math.floor(totalSeconds)) * fps);
  return [hours, minutes, seconds, frame]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join(':');
}

function touch(project: MutableProject): void {
  project.revision += 1;
  project.updatedAt = new Date().toISOString();
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

function speedOf(clip: Clip): { num: number; den: number } {
  const speed = (clip as WindowedClip).speed;
  return {
    num: speed?.num ?? 1,
    den: speed?.den ?? 1,
  };
}

function isWindowed(clip: Clip): clip is WindowedClip {
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
  }
}

function clipEnd(clip: Clip): number {
  return clip.startFrame + clip.durationFrames;
}

function intervalsForTrack(project: ProjectDocument, trackId: string, exceptClipId?: string) {
  return project.timeline.clips
    .filter((clip) => clip.trackId === trackId && clip.id !== exceptClipId)
    .map((clip) => ({ start: clip.startFrame, end: clipEnd(clip) }))
    .sort((a, b) => a.start - b.start);
}

function findGap(
  intervals: { start: number; end: number }[],
  preferred: number,
  duration: number,
): number {
  let start = Math.max(0, Math.floor(preferred));
  for (const interval of intervals) {
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

export function ensureDelivery(project: ProjectDocument): ProjectDocument {
  const next = cloneProject(project);
  const existingAspects = new Set(next.renderProfiles.map((profile) => profile.aspectRatio));
  const frameRate = next.video.frameRate;
  const makeProfile = (
    name: string,
    width: number,
    height: number,
    aspectRatio: '16:9' | '9:16',
    crf: boolean,
    minOutputBytes: number,
  ) => ({
    id: newId(),
    name,
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    resolution: { width, height },
    frameRate,
    bitrate: crf ? { mode: 'crf' as const, crf: 20 } : { mode: 'target' as const, videoBitsPerSecond: 8_000_000 },
    pixelFormat: 'yuv420p' as const,
    audioSampleRate: 48_000,
    audioChannels: 2,
    aspectRatio,
    qualityGate: { minOutputBytes, durationToleranceFrames: 10, requireAllAssetsReady: true },
  });
  if (!existingAspects.has('16:9')) {
    next.renderProfiles.push(makeProfile('YouTube 1080p', 1920, 1080, '16:9', true, 500_000));
  }
  if (!existingAspects.has('9:16')) {
    next.renderProfiles.push(makeProfile('Shorts 1080x1920', 1080, 1920, '9:16', false, 300_000));
  }
  const platforms = new Set(next.exportVariants.map((variant) => variant.platform));
  for (const profile of next.renderProfiles) {
    if (profile.aspectRatio === '16:9' && !platforms.has('youtube')) {
      next.exportVariants.push({
        id: newId(),
        name: profile.name,
        renderProfileId: profile.id,
        platform: 'youtube',
      });
      platforms.add('youtube');
    }
    if (profile.aspectRatio === '9:16' && !platforms.has('shorts')) {
      next.exportVariants.push({
        id: newId(),
        name: profile.name,
        renderProfileId: profile.id,
        platform: 'shorts',
      });
      platforms.add('shorts');
    }
  }
  return next;
}

export function ensureCaptionSetup(project: ProjectDocument): {
  project: ProjectDocument;
  trackId: string;
  styleId: string;
} {
  const next = cloneProject(project);
  let track = next.timeline.tracks.find((item) => item.kind === 'caption');
  if (!track) {
    const order = Math.max(-1, ...next.timeline.tracks.map((item) => item.order)) + 1;
    track = {
      id: newId(),
      kind: 'caption',
      label: 'C1',
      order,
      muted: false,
      hidden: false,
      locked: false,
    };
    next.timeline.tracks.push(track);
  }
  let style = next.captions.styles[0];
  if (!style) {
    style = {
      id: newId(),
      name: 'Principal',
      fontFamily: 'Segoe UI',
      fontSizePx: 54,
      color: '#ffffff',
      outlineColor: '#000000',
      position: 'bottom',
    };
    next.captions.styles.push(style);
  }
  return { project: next, trackId: track.id, styleId: style.id };
}

export function addAsset(project: ProjectDocument, asset: Asset): ProjectDocument {
  if (project.assets.some((item) => item.id === asset.id)) {
    throw new ProjectActionError('el material ya está en la biblioteca del proyecto');
  }
  const next = cloneProject(project);
  next.assets.push(asset);
  touch(next);
  return next;
}

export function markAssetReady(
  project: ProjectDocument,
  assetId: string,
  commercialUse: 'allowed' | 'requires-attribution',
): ProjectDocument {
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  asset.status = 'ready';
  asset.rights.license = {
    id: 'user-declared',
    commercialUse,
    ...(commercialUse === 'requires-attribution'
      ? { attributionText: `Atribución requerida: ${asset.label}` }
      : {}),
    notes: 'Licencia declarada por el usuario en Editor IA.',
  };
  touch(next);
  return next;
}

export function removeAsset(project: ProjectDocument, assetId: string): ProjectDocument {
  const inUse = project.timeline.clips.some((clip) => {
    const source = clip.source;
    return source.type === 'asset' && source.assetId === assetId;
  });
  if (inUse) {
    throw new ProjectActionError('el material está en uso en la timeline; quitá esos clips primero');
  }
  const next = cloneProject(project);
  next.assets = next.assets.filter((asset) => asset.id !== assetId);
  for (const scene of next.scenes) {
    if (scene.narration.assetId === assetId) {
      delete scene.narration.assetId;
      if (!scene.narration.text) {
        scene.narration.text = 'Narración pendiente.';
      }
    }
  }
  touch(next);
  return next;
}

export function updateAssetLabel(project: ProjectDocument, assetId: string, label: string): ProjectDocument {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new ProjectActionError('el material necesita un nombre');
  }
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  asset.label = trimmed;
  touch(next);
  return next;
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

function compatibleTrackKinds(kind: Clip['kind']): Track['kind'][] {
  switch (kind) {
    case 'video':
      return ['video'];
    case 'image':
      return ['image'];
    case 'audio':
      return ['audio', 'narration'];
    case 'graphic':
      return ['graphic'];
  }
}

export function addClipFromAsset(
  project: ProjectDocument,
  asset: Asset,
  options: { trackId?: string; atFrame?: number; durationFrames?: number; narration?: boolean } = {},
): { project: ProjectDocument; clipId: string; trackId: string; startFrame: number } {
  if (asset.status !== 'ready') {
    throw new ProjectActionError('confirmá los derechos del material antes de montarlo');
  }
  const kind: Clip['kind'] | null =
    asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio' ? asset.kind : null;
  if (!kind) {
    throw new ProjectActionError('este tipo de material todavía no se puede montar');
  }
  const next = cloneProject(project);
  const fps = fpsOf(next);
  let track: Track | undefined;
  if (options.trackId) {
    track = next.timeline.tracks.find((item) => item.id === options.trackId);
    if (!track) {
      throw new ProjectActionError('la pista elegida no existe');
    }
    if (!compatibleTrackKinds(kind).includes(track.kind)) {
      throw new ProjectActionError('la pista elegida no acepta este tipo de clip');
    }
    if (track.locked) {
      throw new ProjectActionError('la pista elegida está bloqueada');
    }
  } else {
    const wanted = options.narration ? 'narration' : kind === 'audio' ? 'audio' : kind;
    track = next.timeline.tracks.find((item) => item.kind === wanted && !item.locked);
    if (!track) {
      const created = addTrack(next, wanted as Track['kind']);
      track = created.project.timeline.tracks.find((item) => item.id === created.trackId);
      if (!track) {
        throw new ProjectActionError('no se pudo crear la pista');
      }
      next.timeline = created.project.timeline;
    }
  }

  let durationFrames: number;
  let source: Clip['source'];
  if (isWindowedAsset(kind)) {
    const mediaDuration =
      'media' in asset && asset.media && 'durationFrames' in asset.media
        ? asset.media.durationFrames
        : undefined;
    if (!mediaDuration) {
      throw new ProjectActionError('el material no declara duración medida');
    }
    durationFrames = options.durationFrames ?? mediaDuration;
    durationFrames = Math.max(1, Math.min(durationFrames, mediaDuration));
    source = {
      type: 'asset',
      assetId: asset.id,
      inFrame: 0,
      outFrame: durationFrames,
    };
  } else {
    const defaultSeconds = 5;
    durationFrames = Math.max(1, options.durationFrames ?? Math.round(defaultSeconds * fps));
    source = { type: 'asset', assetId: asset.id };
  }

  const startFrame = findGap(
    intervalsForTrack(next, track.id),
    options.atFrame ?? 0,
    durationFrames,
  );
  const clipId = newId();
  const base = {
    id: clipId,
    trackId: track.id,
    label: asset.label,
    startFrame,
    durationFrames,
  };
  const clip: Clip =
    kind === 'image'
      ? { ...base, kind: 'image', source: source as Extract<Clip, { kind: 'image' }>['source'] }
      : {
          ...base,
          kind,
          source: source as Extract<Clip, { kind: 'video' | 'audio' }>['source'],
        };
  next.timeline.clips.push(clip);
  touch(next);
  return { project: next, clipId, trackId: track.id, startFrame };
}

function isWindowedAsset(kind: Clip['kind']): boolean {
  return kind === 'video' || kind === 'audio';
}

export function moveClip(
  project: ProjectDocument,
  clipId: string,
  targetStart: number,
  targetTrackId?: string,
): ProjectDocument | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  const trackId = targetTrackId ?? clip.trackId;
  const track = next.timeline.tracks.find((item) => item.id === trackId);
  const sourceTrack = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!track || track.locked || sourceTrack?.locked || !compatibleTrackKinds(clip.kind).includes(track.kind)) {
    return null;
  }
  const start = Math.max(0, Math.round(targetStart));
  if (!canPlaceClip(next, trackId, start, clip.durationFrames, clipId)) {
    return null;
  }
  clip.startFrame = start;
  clip.trackId = trackId;
  touch(next);
  return next;
}

export function trimClip(
  project: ProjectDocument,
  clipId: string,
  edge: 'start' | 'end',
  targetFrame: number,
): ProjectDocument | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  const target = Math.round(targetFrame);
  const owner = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (owner?.locked) {
    return null;
  }
  if (edge === 'start') {
    const maxStart = clip.startFrame + clip.durationFrames - 1;
    let newStart = Math.min(Math.max(0, target), maxStart);
    let delta = newStart - clip.startFrame;
    if (isWindowed(clip)) {
      const { num, den } = speedOf(clip);
      const step = den / gcd(num, den);
      delta = Math.round(delta / step) * step;
      newStart = clip.startFrame + delta;
      if (newStart < 0 || newStart > maxStart) {
        return null;
      }
      const sourceDelta = (delta * num) / den;
      if (!Number.isInteger(sourceDelta)) {
        return null;
      }
      const newIn = clip.source.inFrame + sourceDelta;
      if (newIn < 0 || newIn >= clip.source.outFrame) {
        return null;
      }
      clip.source.inFrame = newIn;
    }
    clip.startFrame = newStart;
    clip.durationFrames = maxStart + 1 - newStart;
  } else {
    const source = clip.source;
    const asset = source.type === 'asset'
      ? next.assets.find((item) => item.id === source.assetId)
      : undefined;
    let newEnd = Math.max(clip.startFrame + 1, target);
    let newDuration = newEnd - clip.startFrame;
    if (isWindowed(clip)) {
      const { num, den } = speedOf(clip);
      const step = den / gcd(num, den);
      newDuration = Math.round(newDuration / step) * step;
      newDuration = Math.max(step, newDuration);
      newEnd = clip.startFrame + newDuration;
      const sourceOut = clip.source.inFrame + (newDuration * num) / den;
      if (!Number.isInteger(sourceOut)) {
        return null;
      }
      const maxSource =
        asset && 'media' in asset && asset.media && 'durationFrames' in asset.media
          ? asset.media.durationFrames
          : undefined;
      if (maxSource !== undefined && sourceOut > maxSource) {
        return null;
      }
      if (sourceOut <= clip.source.inFrame) {
        return null;
      }
      clip.source.outFrame = sourceOut;
    }
    if (!canPlaceClip(next, clip.trackId, clip.startFrame, newDuration, clip.id)) {
      return null;
    }
    clip.durationFrames = newDuration;
  }
  touch(next);
  return next;
}

export function splitClip(
  project: ProjectDocument,
  clipId: string,
  atFrame: number,
): { project: ProjectDocument; rightClipId: string } | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  const owner = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (owner?.locked) {
    return null;
  }
  let at = Math.round(atFrame);
  if (isWindowed(clip)) {
    const { num, den } = speedOf(clip);
    const step = den / gcd(num, den);
    at = Math.round((at - clip.startFrame) / step) * step + clip.startFrame;
  }
  if (at <= clip.startFrame || at >= clip.startFrame + clip.durationFrames) {
    return null;
  }
  const leftDuration = at - clip.startFrame;
  const rightDuration = clip.durationFrames - leftDuration;
  const rightId = newId();
  if (isWindowed(clip)) {
    const { num, den } = speedOf(clip);
    const splitSource = clip.source.inFrame + (leftDuration * num) / den;
    if (!Number.isInteger(splitSource)) {
      return null;
    }
    const right = {
      ...JSON.parse(JSON.stringify(clip)),
      id: rightId,
      startFrame: at,
      durationFrames: rightDuration,
      source: { ...clip.source, inFrame: splitSource },
    } as Clip;
    clip.durationFrames = leftDuration;
    clip.source.outFrame = splitSource;
    next.timeline.clips.push(right);
  } else {
    const right = {
      ...JSON.parse(JSON.stringify(clip)),
      id: rightId,
      startFrame: at,
      durationFrames: rightDuration,
    } as Clip;
    clip.durationFrames = leftDuration;
    next.timeline.clips.push(right);
  }
  for (const scene of next.scenes) {
    const index = scene.clipIds.indexOf(clip.id);
    if (index >= 0) {
      scene.clipIds.splice(index + 1, 0, rightId);
    }
  }
  touch(next);
  return { project: next, rightClipId: rightId };
}

export function deleteClip(project: ProjectDocument, clipId: string): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return next;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  next.timeline.clips = next.timeline.clips.filter((item) => item.id !== clipId);
  for (const scene of next.scenes) {
    scene.clipIds = scene.clipIds.filter((id) => id !== clipId);
  }
  touch(next);
  return next;
}

export function updateClip(
  project: ProjectDocument,
  clipId: string,
  patch: Partial<{
    label: string;
    transform: Clip extends { transform?: infer T } ? T : never;
    audio: Clip extends { audio?: infer T } ? T : never;
  }>,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) {
      throw new ProjectActionError('el clip necesita un nombre');
    }
    clip.label = label;
  }
  if (patch.transform !== undefined) {
    if (Object.keys(patch.transform).length === 0) {
      delete clip.transform;
    } else {
      clip.transform = patch.transform as NonNullable<Clip['transform']>;
    }
  }
  if (patch.audio !== undefined) {
    if (Object.keys(patch.audio).length === 0) {
      delete clip.audio;
    } else {
      clip.audio = patch.audio as NonNullable<Clip['audio']>;
    }
  }
  touch(next);
  return next;
}

export function updateTrack(
  project: ProjectDocument,
  trackId: string,
  patch: Partial<Pick<Track, 'label' | 'muted' | 'hidden' | 'locked'>>,
): ProjectDocument {
  const next = cloneProject(project);
  const track = next.timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new ProjectActionError('la pista no existe');
  }
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) {
      throw new ProjectActionError('la pista necesita un nombre');
    }
    track.label = label;
  }
  if (patch.muted !== undefined) track.muted = patch.muted;
  if (patch.hidden !== undefined) track.hidden = patch.hidden;
  if (patch.locked !== undefined) track.locked = patch.locked;
  touch(next);
  return next;
}

export function deleteTrack(project: ProjectDocument, trackId: string): ProjectDocument {
  const next = cloneProject(project);
  if (next.timeline.clips.some((clip) => clip.trackId === trackId)) {
    throw new ProjectActionError('la pista tiene clips; vaciala antes de borrarla');
  }
  if (next.captions.cues.some((cue) => cue.trackId === trackId)) {
    throw new ProjectActionError('la pista tiene subtítulos; quitalos antes de borrarla');
  }
  if (next.motion.some((item) => item.targetTrackId === trackId)) {
    throw new ProjectActionError('la pista tiene gráficos asociados');
  }
  if (next.timeline.tracks.find((item) => item.id === trackId)?.locked) {
    throw new ProjectActionError('la pista está bloqueada');
  }
  next.timeline.tracks = next.timeline.tracks.filter((track) => track.id !== trackId);
  touch(next);
  return next;
}

export function addCaptionCue(
  project: ProjectDocument,
  input: { text: string; startFrame?: number; durationFrames?: number; styleId?: string },
): { project: ProjectDocument; cueId: string; startFrame: number; trackId: string } {
  const text = input.text.trim();
  if (!text) {
    throw new ProjectActionError('el subtítulo está vacío');
  }
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const captionTrack = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (captionTrack?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  const fps = fpsOf(next);
  const duration = Math.max(1, input.durationFrames ?? Math.round(3 * fps));
  const cues = next.captions.cues.filter((cue) => cue.trackId === setup.trackId);
  const start = findGap(
    cues.map((cue) => ({ start: cue.startFrame, end: cue.endFrame })),
    input.startFrame ?? 0,
    duration,
  );
  const cue: CaptionCue = {
    id: newId(),
    trackId: setup.trackId,
    styleId: input.styleId ?? setup.styleId,
    text: text.slice(0, 500),
    language: next.language,
    startFrame: start,
    endFrame: start + duration,
  };
  next.captions.cues.push(cue);
  touch(next);
  return { project: next, cueId: cue.id, startFrame: start, trackId: setup.trackId };
}

export function updateCaptionCue(
  project: ProjectDocument,
  cueId: string,
  patch: Partial<Pick<CaptionCue, 'text' | 'startFrame' | 'endFrame' | 'styleId'>>,
): ProjectDocument {
  const next = cloneProject(project);
  const cue = next.captions.cues.find((item) => item.id === cueId);
  if (!cue) {
    throw new ProjectActionError('el subtítulo no existe');
  }
  if (next.timeline.tracks.find((item) => item.id === cue.trackId)?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  if (patch.text !== undefined) {
    const text = patch.text.trim();
    if (!text) {
      throw new ProjectActionError('el subtítulo no puede quedar vacío');
    }
    cue.text = text.slice(0, 500);
  }
  if (patch.startFrame !== undefined) cue.startFrame = Math.max(0, Math.round(patch.startFrame));
  if (patch.endFrame !== undefined) cue.endFrame = Math.max(0, Math.round(patch.endFrame));
  if (patch.styleId !== undefined) cue.styleId = patch.styleId;
  if (cue.endFrame <= cue.startFrame) {
    throw new ProjectActionError('el subtítulo debe terminar después de empezar');
  }
  const overlapping = next.captions.cues.some(
    (other) =>
      other.id !== cue.id &&
      other.trackId === cue.trackId &&
      cue.startFrame < other.endFrame &&
      other.startFrame < cue.endFrame,
  );
  if (overlapping) {
    throw new ProjectActionError('ese subtítulo se superpone con otro en la misma pista');
  }
  touch(next);
  return next;
}

export function deleteCaptionCue(project: ProjectDocument, cueId: string): ProjectDocument {
  const next = cloneProject(project);
  const cue = next.captions.cues.find((item) => item.id === cueId);
  if (cue && next.timeline.tracks.find((item) => item.id === cue.trackId)?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  next.captions.cues = next.captions.cues.filter((item) => item.id !== cueId);
  touch(next);
  return next;
}

export interface AppliedScenePlan {
  readonly title: string;
  readonly scenes: readonly {
    id: string;
    title: string;
    intent: Scene['intent'];
    narration: string;
    visual: string;
    estimatedSeconds: number;
  }[];
  readonly providerId: string;
  readonly model: string;
  readonly simulated: boolean;
  readonly costApproved: boolean;
}

export function applyScenePlan(
  project: ProjectDocument,
  plan: AppliedScenePlan,
  options: { replace?: boolean } = {},
): ProjectDocument {
  const next = cloneProject(project);
  if (options.replace) {
    const citedSceneIds = new Set(
      next.provenance.claims
        .map((claim) => claim.sceneId)
        .filter((value): value is string => typeof value === 'string'),
    );
    if (next.scenes.some((scene) => citedSceneIds.has(scene.id))) {
      throw new ProjectActionError(
        'una fuente cita una escena existente; no se puede reemplazar el guion sin perder esa referencia',
      );
    }
    next.scenes = [];
  }
  const fps = fpsOf(next);
  const baseOrder = Math.max(-1, ...next.scenes.map((scene) => scene.order)) + 1;
  const added: Scene[] = plan.scenes.map((scene, index) => ({
    id: newId(),
    order: baseOrder + index,
    title: scene.title.trim().slice(0, 200) || `Escena ${index + 1}`,
    intent: scene.intent,
    status: 'draft',
    narration: {
      text: scene.narration.trim().slice(0, 4_000),
      estimatedDurationFrames: secondsToFrames(scene.estimatedSeconds, fps),
    },
    clipIds: [],
    ...(scene.visual.trim() ? { notes: scene.visual.trim().slice(0, 2_000) } : {}),
  }));
  next.scenes.push(...added);
  next.provenance.operations.push({
    id: newId(),
    role: 'scriptwriter',
    summary: `${plan.simulated ? 'Guion simulado' : 'Guion generado'}: ${plan.title}`.slice(0, 300),
    createdAt: new Date().toISOString(),
    provider: { id: plan.providerId, model: plan.model },
    cost: { items: [], disclosed: true, approved: plan.costApproved },
    patch: added.map((scene) => ({
      op: 'add' as const,
      path: '/scenes/-',
      value: scene as unknown as Parameters<typeof JSON.stringify>[0],
    })),
    expectedRevision: project.revision,
    appliedStatus: 'applied',
  });
  touch(next);
  return next;
}

export function addScene(
  project: ProjectDocument,
  input: { title: string; intent: Scene['intent']; narration: string; notes?: string },
): { project: ProjectDocument; sceneId: string } {
  const title = input.title.trim();
  const narration = input.narration.trim();
  if (!title) throw new ProjectActionError('la escena necesita un título');
  if (!narration) throw new ProjectActionError('la escena necesita narración');
  const next = cloneProject(project);
  const fps = fpsOf(next);
  const scene: Scene = {
    id: newId(),
    order: Math.max(-1, ...next.scenes.map((item) => item.order)) + 1,
    title: title.slice(0, 200),
    intent: input.intent,
    status: 'draft',
    narration: {
      text: narration.slice(0, 4_000),
      estimatedDurationFrames: secondsToFrames(Math.max(2, narration.length / 15), fps),
    },
    clipIds: [],
    ...(input.notes?.trim() ? { notes: input.notes.trim().slice(0, 2_000) } : {}),
  };
  next.scenes.push(scene);
  touch(next);
  return { project: next, sceneId: scene.id };
}

export function moveScene(
  project: ProjectDocument,
  sceneId: string,
  direction: -1 | 1,
): ProjectDocument | null {
  const next = cloneProject(project);
  const ordered = [...next.scenes].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((scene) => scene.id === sceneId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) {
    return null;
  }
  const current = ordered[index];
  const other = ordered[target];
  if (!current || !other) return null;
  const order = current.order;
  current.order = other.order;
  other.order = order;
  touch(next);
  return next;
}

export function updateScene(
  project: ProjectDocument,
  sceneId: string,
  patch: Partial<Pick<Scene, 'title' | 'intent' | 'status' | 'notes'>> & { narration?: string },
): ProjectDocument {
  const next = cloneProject(project);
  const scene = next.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new ProjectActionError('la escena no existe');
  }
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new ProjectActionError('la escena necesita un título');
    scene.title = title.slice(0, 200);
  }
  if (patch.intent !== undefined) scene.intent = patch.intent;
  if (patch.status !== undefined) scene.status = patch.status;
  if (patch.notes !== undefined) scene.notes = patch.notes.slice(0, 2_000);
  if (patch.narration !== undefined) {
    const text = patch.narration.trim();
    if (!text) throw new ProjectActionError('la narración no puede quedar vacía');
    scene.narration.text = text.slice(0, 4_000);
    const fps = fpsOf(next);
    scene.narration.estimatedDurationFrames = secondsToFrames(
      Math.max(2, text.length / 15),
      fps,
    );
  }
  touch(next);
  return next;
}

export function removeScene(project: ProjectDocument, sceneId: string): ProjectDocument {
  if (project.provenance.claims.some((claim) => claim.sceneId === sceneId)) {
    throw new ProjectActionError('una fuente cita esta escena; quitá la cita antes de borrarla');
  }
  const next = cloneProject(project);
  next.scenes = next.scenes
    .filter((scene) => scene.id !== sceneId)
    .sort((a, b) => a.order - b.order)
    .map((scene, index) => ({ ...scene, order: index }));
  touch(next);
  return next;
}

export function attachNarrationAsset(
  project: ProjectDocument,
  sceneId: string,
  assetId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const scene = next.scenes.find((item) => item.id === sceneId);
  if (!scene) {
    throw new ProjectActionError('la escena no existe');
  }
  scene.narration.assetId = assetId;
  touch(next);
  return next;
}

export function captionsFromScenes(project: ProjectDocument): ProjectDocument {
  let next = ensureCaptionSetup(project).project;
  const setup = ensureCaptionSetup(next);
  next = cloneProject(setup.project);
  const fps = fpsOf(next);
  let cursor = Math.max(0, ...next.captions.cues.map((cue) => cue.endFrame));
  const scenes = [...next.scenes].sort((a, b) => a.order - b.order);
  for (const scene of scenes) {
    const text = scene.narration.text?.trim();
    if (!text) continue;
    const duration = Math.max(
      secondsToFrames(1.5, fps),
      scene.narration.estimatedDurationFrames ?? secondsToFrames(Math.max(2, text.length / 15), fps),
    );
    const start = findGap(
      next.captions.cues
        .filter((cue) => cue.trackId === setup.trackId)
        .map((cue) => ({ start: cue.startFrame, end: cue.endFrame })),
      cursor,
      duration,
    );
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: setup.styleId,
      text: text.slice(0, 500),
      language: next.language,
      startFrame: start,
      endFrame: start + duration,
    });
    cursor = start + duration;
  }
  touch(next);
  return next;
}


export function updateCaptionStyle(
  project: ProjectDocument,
  styleId: string,
  patch: Partial<{
    name: string;
    fontFamily: string;
    fontSizePx: number;
    color: string;
    outlineColor: string;
    position: 'top' | 'center' | 'bottom';
  }>,
): ProjectDocument {
  const next = cloneProject(project);
  const style = next.captions.styles.find((item) => item.id === styleId);
  if (!style) {
    throw new ProjectActionError('el estilo de subt�tulos no existe');
  }
  if (patch.name !== undefined) style.name = patch.name.trim().slice(0, 80) || 'Principal';
  if (patch.fontFamily !== undefined) style.fontFamily = patch.fontFamily.trim().slice(0, 120) || 'Segoe UI';
  if (patch.fontSizePx !== undefined) style.fontSizePx = Math.max(1, Math.min(400, Math.round(patch.fontSizePx)));
  if (patch.color !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.color)) {
      throw new ProjectActionError('el color debe ser un hex como #ffffff');
    }
    style.color = patch.color;
  }
  if (patch.outlineColor !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.outlineColor)) {
      throw new ProjectActionError('el contorno debe ser un hex como #000000');
    }
    style.outlineColor = patch.outlineColor;
  }
  if (patch.position !== undefined) style.position = patch.position;
  touch(next);
  return next;
}


/** Add a locally generated narration asset and, when the user confirmed the
 * voice rights, mount it on a narration track. The asset passed to
 * addClipFromAsset is the project copy after markAssetReady: mounting the raw
 * `unverified` candidate would be rejected by the same gate the render uses. */
export function addGeneratedNarration(
  project: ProjectDocument,
  asset: Asset,
  sceneId: string,
  options: { confirmRights: boolean; atFrame: number; label?: string },
): { project: ProjectDocument; clipId: string | null } {
  let next = cloneProject(project);
  const existing = next.assets.find((item) => item.id === asset.id);
  if (!existing) {
    next.assets.push(asset);
  }
  const stored = next.assets.find((item) => item.id === asset.id);
  if (!stored) {
    throw new ProjectActionError('la narraci�n generada no se pudo agregar al proyecto');
  }
  if (options.label && options.label.trim()) {
    stored.label = options.label.trim().slice(0, 200);
  }
  if (options.confirmRights) {
    next = markAssetReady(next, asset.id, 'allowed');
  }
  next = attachNarrationAsset(next, sceneId, asset.id);
  let clipId: string | null = null;
  if (options.confirmRights) {
    const ready = next.assets.find((item) => item.id === asset.id);
    if (!ready) {
      throw new ProjectActionError('la narraci�n qued� sin derechos verificados');
    }
    const added = addClipFromAsset(next, ready, {
      atFrame: options.atFrame,
      narration: true,
    });
    next = added.project;
    clipId = added.clipId;
  }
  touch(next);
  return { project: next, clipId };
}

export function updateProjectSettings(
  project: ProjectDocument,
  patch: { name?: string; width?: number; height?: number; fpsNum?: number; fpsDen?: number; backgroundColor?: string; language?: string },
): ProjectDocument {
  const next = cloneProject(project);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ProjectActionError('el proyecto necesita un nombre');
    next.name = name.slice(0, 120);
  }
  if (patch.width !== undefined) next.video.width = Math.max(16, Math.min(16_384, Math.round(patch.width)));
  if (patch.height !== undefined) next.video.height = Math.max(16, Math.min(16_384, Math.round(patch.height)));
  if (patch.fpsNum !== undefined) next.video.frameRate.num = Math.max(1, Math.round(patch.fpsNum));
  if (patch.fpsDen !== undefined) next.video.frameRate.den = Math.max(1, Math.round(patch.fpsDen));
  if (patch.backgroundColor !== undefined) next.video.backgroundColor = patch.backgroundColor;
  if (patch.language !== undefined) next.language = patch.language;
  if (next.timeline.clips.length > 0 && (patch.width !== undefined || patch.height !== undefined)) {
    // Changing canvas size is allowed and non-destructive: clips keep their
    // frame timing; the renderer fits them to the new canvas.
  }
  touch(next);
  return next;
}

export function totalFrames(project: ProjectDocument): number {
  return Math.max(
    0,
    ...project.timeline.clips.map((clip) => clip.startFrame + clip.durationFrames),
    ...project.captions.cues.map((cue) => cue.endFrame),
  );
}
