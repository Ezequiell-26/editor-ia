import type {
  Asset,
  CaptionCue,
  Clip,
  ChromaKey,
  ClipEffects,
  ClipGainKeyframe,
  ClipMotion,
  ClipTransformKeyframe,
  ProjectDocument,
  Scene,
  Track,
} from '@editor-ia/project-schema';
import {
  MAX_GAIN_KEYFRAMES,
  MAX_TRANSFORM_KEYFRAMES,
  TRANSFORM_KEYFRAME_SCALE_MAX,
  TRANSFORM_KEYFRAME_SCALE_MIN,
  hasGeometryKeyframes,
  sampleGainKeyframes,
  sampleTransformKeyframes,
} from '@editor-ia/project-schema';
import { friendlyAssetLabel } from './asset-labels';
import { aspectRatioOf, evenDimension, retimeProject, validFpsRange } from './video-format';

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

const NATIVE_PROFILE_PREFIX = 'Formato del proyecto';

function makeDeliveryProfile(
  project: ProjectDocument,
  name: string,
  width: number,
  height: number,
  minOutputBytes: number,
) {
  return {
    id: newId(),
    name,
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    resolution: { width, height },
    frameRate: { ...project.video.frameRate },
    bitrate: { mode: 'crf' as const, crf: 22 },
    videoPreset: 'veryfast' as const,
    fit: 'contain' as const,
    pixelFormat: 'yuv420p' as const,
    audioSampleRate: 48_000,
    audioChannels: 2,
    audioBitsPerSecond: 128_000,
    aspectRatio: aspectRatioOf(width, height),
    qualityGate: { minOutputBytes, durationToleranceFrames: 10, requireAllAssetsReady: true },
  };
}

/** Keep one profile that follows the project canvas, even for unusual ratios. */
export function syncNativeProfile(project: ProjectDocument): ProjectDocument {
  const next = project;
  const width = next.video.width;
  const height = next.video.height;
  const name = `${NATIVE_PROFILE_PREFIX} ${width}×${height}`;
  const existing = next.renderProfiles.find((profile) =>
    profile.name.startsWith(NATIVE_PROFILE_PREFIX),
  );
  if (existing) {
    existing.name = name;
    existing.resolution = { width, height };
    existing.aspectRatio = aspectRatioOf(width, height);
    return next;
  }
  if (next.renderProfiles.some((profile) => profile.resolution.width === width && profile.resolution.height === height)) {
    return next;
  }
  next.renderProfiles.push(makeDeliveryProfile(next, name, width, height, 50_000));
  return next;
}

export function ensureDelivery(project: ProjectDocument): ProjectDocument {
  const next = cloneProject(project);
  const existingAspects = new Set(next.renderProfiles.map((profile) => profile.aspectRatio));
  const addProfile = (
    name: string,
    width: number,
    height: number,
    minOutputBytes: number,
  ) => {
    next.renderProfiles.push(makeDeliveryProfile(next, name, width, height, minOutputBytes));
  };
  if (!existingAspects.has('16:9')) {
    addProfile('YouTube 1080p', 1920, 1080, 500_000);
  }
  if (!existingAspects.has('9:16')) {
    addProfile('Shorts 1080x1920', 1080, 1920, 300_000);
  }
  if (!existingAspects.has('1:1')) {
    addProfile('Feed 1080x1080', 1080, 1080, 250_000);
  }
  syncNativeProfile(next);
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
    if (profile.aspectRatio === '1:1' && !platforms.has('other')) {
      next.exportVariants.push({
        id: newId(),
        name: profile.name,
        renderProfileId: profile.id,
        platform: 'other',
      });
      platforms.add('other');
    }
  }
  return next;
}

export type CompressionPresetId = 'rapido' | 'equilibrado' | 'compacto' | 'maximo';

export interface CompressionPreset {
  readonly id: CompressionPresetId;
  readonly label: string;
  readonly note: string;
  readonly crf: number;
  readonly videoPreset: 'ultrafast' | 'veryfast' | 'faster' | 'medium';
  readonly audioBitsPerSecond: number;
}

export const COMPRESSION_PRESETS: readonly CompressionPreset[] = [
  {
    id: 'rapido',
    label: 'Rápido',
    note: 'Renderiza lo antes posible; ocupa más.',
    crf: 23,
    videoPreset: 'ultrafast',
    audioBitsPerSecond: 128_000,
  },
  {
    id: 'equilibrado',
    label: 'Equilibrado',
    note: 'Buena calidad y tamaño razonable.',
    crf: 22,
    videoPreset: 'veryfast',
    audioBitsPerSecond: 128_000,
  },
  {
    id: 'compacto',
    label: 'Compacto',
    note: 'El archivo más chico; tarda un poco más.',
    crf: 27,
    videoPreset: 'faster',
    audioBitsPerSecond: 96_000,
  },
  {
    id: 'maximo',
    label: 'Máxima calidad',
    note: 'Más pesado y más lento; para masters.',
    crf: 18,
    videoPreset: 'medium',
    audioBitsPerSecond: 192_000,
  },
];

export function compressionPresetOf(
  profile: ProjectDocument['renderProfiles'][number],
): CompressionPresetId | 'custom' {
  const crf = profile.bitrate.mode === 'crf' ? profile.bitrate.crf : null;
  const match = COMPRESSION_PRESETS.find(
    (preset) =>
      preset.crf === crf &&
      preset.videoPreset === profile.videoPreset &&
      preset.audioBitsPerSecond === profile.audioBitsPerSecond,
  );
  return match?.id ?? 'custom';
}

/** Apply one compression profile and optional codec to every delivery profile. */
export function applyCompression(
  project: ProjectDocument,
  presetId: CompressionPresetId,
  videoCodec?: 'h264' | 'h265',
): ProjectDocument {
  const preset = COMPRESSION_PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new ProjectActionError('el preset de compresión no existe');
  const next = cloneProject(project);
  for (const profile of next.renderProfiles) {
    profile.bitrate = { mode: 'crf', crf: preset.crf };
    profile.videoPreset = preset.videoPreset;
    profile.audioBitsPerSecond = preset.audioBitsPerSecond;
    if (videoCodec) profile.videoCodec = videoCodec;
  }
  touch(next);
  return next;
}

/** Apply contain/cover to every delivery profile (used by the export dialog). */
export function applyProfileFit(
  project: ProjectDocument,
  fit: 'contain' | 'cover',
): ProjectDocument {
  const next = cloneProject(project);
  for (const profile of next.renderProfiles) profile.fit = fit;
  touch(next);
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
  options: {
    trackId?: string;
    atFrame?: number;
    durationFrames?: number;
    narration?: boolean;
    inFrame?: number;
    outFrame?: number;
  } = {},
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
    const requestedIn = Math.max(
      0,
      Math.min(mediaDuration - 1, Math.floor(options.inFrame ?? 0)),
    );
    const requestedOut = Math.max(
      requestedIn + 1,
      Math.min(mediaDuration, Math.floor(options.outFrame ?? mediaDuration)),
    );
    const windowFrames = requestedOut - requestedIn;
    durationFrames = options.durationFrames ?? windowFrames;
    durationFrames = Math.max(1, Math.min(durationFrames, windowFrames));
    source = {
      type: 'asset',
      assetId: asset.id,
      inFrame: requestedIn,
      outFrame: requestedIn + durationFrames,
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
    label: friendlyAssetLabel(asset.label),
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
  const oldStart = clip.startFrame;
  const oldDuration = clip.durationFrames;
  const originalTransformKeyframes = clip.transform?.keyframes
    ? [...clip.transform.keyframes]
    : undefined;
  const originalGainKeyframes = clip.audio?.gainKeyframes
    ? [...clip.audio.gainKeyframes]
    : undefined;
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
  if (originalTransformKeyframes) {
    if (edge === 'start') {
      assignTransformKeyframes(
        clip,
        trimStartKeyframes(
          originalTransformKeyframes,
          clip.startFrame - oldStart,
          (frame) => sampleTransformKeyframes(originalTransformKeyframes, frame),
        ),
      );
    } else if (clip.durationFrames !== oldDuration) {
      assignTransformKeyframes(
        clip,
        trimEndKeyframes(originalTransformKeyframes, clip.durationFrames, (frame) =>
          sampleTransformKeyframes(originalTransformKeyframes, frame),
        ),
      );
    }
  }
  if (originalGainKeyframes) {
    const sample = (frame: number) => ({
      gainDb: sampleGainKeyframes(originalGainKeyframes, frame) ?? 0,
    });
    if (edge === 'start') {
      assignGainKeyframes(
        clip,
        trimStartKeyframes(originalGainKeyframes, clip.startFrame - oldStart, sample),
      );
    } else if (clip.durationFrames !== oldDuration) {
      assignGainKeyframes(
        clip,
        trimEndKeyframes(originalGainKeyframes, clip.durationFrames, sample),
      );
    }
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
  const originalTransformKeyframes = clip.transform?.keyframes
    ? [...clip.transform.keyframes]
    : undefined;
  const originalGainKeyframes = clip.audio?.gainKeyframes
    ? [...clip.audio.gainKeyframes]
    : undefined;
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

/** Split a clip at several absolute timeline frames, in order. */
export function splitClipAtFrames(
  project: ProjectDocument,
  clipId: string,
  cutFrames: readonly number[],
): { project: ProjectDocument; clipIds: string[] } | null {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return null;
  const start = clip.startFrame;
  const end = clip.startFrame + clip.durationFrames;
  const cuts = [...new Set(cutFrames.map((frame) => Math.round(frame)))]
    .filter((frame) => frame > start && frame < end)
    .sort((a, b) => a - b);
  let next = project;
  let currentId = clipId;
  const clipIds = [clipId];
  for (const cut of cuts) {
    const result = splitClip(next, currentId, cut);
    if (!result) continue;
    next = result.project;
    currentId = result.rightClipId;
    clipIds.push(currentId);
  }
  return { project: next, clipIds };
}

/** Copy a clip after itself on the same track, preserving every effect. */
export function duplicateClip(
  project: ProjectDocument,
  clipId: string,
): { project: ProjectDocument; clipId: string } | null {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    return null;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    return null;
  }
  const startFrame = findGap(
    intervalsForTrack(next, clip.trackId),
    clip.startFrame + clip.durationFrames,
    clip.durationFrames,
  );
  const id = newId();
  const copy = {
    ...JSON.parse(JSON.stringify(clip)),
    id,
    startFrame,
  } as Clip;
  next.timeline.clips.push(copy);
  for (const scene of next.scenes) {
    const index = scene.clipIds.indexOf(clip.id);
    if (index >= 0) {
      scene.clipIds.splice(index + 1, 0, id);
    }
  }
  touch(next);
  return { project: next, clipId: id };
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
    effects: ClipEffects;
    motion: ClipMotion | undefined;
    chromaKey: ChromaKey | undefined;
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
  if (patch.effects !== undefined) {
    if (clip.kind !== 'video' && clip.kind !== 'image') {
      throw new ProjectActionError('este tipo de clip no acepta efectos visuales');
    }
    if (Object.keys(patch.effects).length === 0) {
      delete clip.effects;
    } else {
      clip.effects = patch.effects;
    }
  }
  if ('motion' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image') {
      throw new ProjectActionError('este tipo de clip no acepta movimiento');
    }
    if (patch.motion === undefined) {
      delete clip.motion;
    } else {
      clip.motion = patch.motion;
    }
  }
  if ('chromaKey' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image') {
      throw new ProjectActionError('este tipo de clip no acepta chroma key');
    }
    if (patch.chromaKey === undefined) {
      delete clip.chromaKey;
    } else {
      clip.chromaKey = patch.chromaKey;
    }
  }
  touch(next);
  return next;
}

export type ClipTransformSample = {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  opacity: number;
  keyframed: boolean;
  geometryKeyframed: boolean;
};

/**
 * Transform at a clip-relative frame. A keyframed property overrides its
 * static value; `scale` is a uniform multiplier on top of the static scaleX/Y.
 */
export function clipTransformAtFrame(clip: Clip, frame: number): ClipTransformSample {
  const transform = clip.transform ?? {};
  const keyframes = transform.keyframes ?? [];
  const sampled = sampleTransformKeyframes(keyframes, frame);
  const animatedScale = sampled.scale ?? 1;
  return {
    offsetX: sampled.offsetX ?? transform.offsetX ?? 0,
    offsetY: sampled.offsetY ?? transform.offsetY ?? 0,
    scaleX: (transform.scaleX ?? 1) * animatedScale,
    scaleY: (transform.scaleY ?? 1) * animatedScale,
    rotationDeg: sampled.rotationDeg ?? transform.rotationDeg ?? 0,
    opacity: sampled.opacity ?? transform.opacity ?? 1,
    keyframed: keyframes.length > 0,
    geometryKeyframed: hasGeometryKeyframes(keyframes),
  };
}

export function clipGainAtFrame(clip: Clip, frame: number): number {
  const keyframes = clip.audio?.gainKeyframes ?? [];
  return sampleGainKeyframes(keyframes, frame) ?? clip.audio?.gainDb ?? 0;
}

type TransformKeyframePatch = Partial<Omit<ClipTransformKeyframe, 'frame'>>;
type FrameKeyframe = { frame: number };

function assignTransformKeyframes(clip: Clip, keyframes: ClipTransformKeyframe[]): void {
  const transform = clip.transform ?? {};
  if (keyframes.length === 0) {
    delete transform.keyframes;
  } else {
    transform.keyframes = keyframes;
  }
  if (Object.keys(transform).length === 0) {
    delete clip.transform;
  } else {
    clip.transform = transform;
  }
}

function assignGainKeyframes(clip: Clip, keyframes: ClipGainKeyframe[]): void {
  const audio = clip.audio ?? {};
  if (keyframes.length === 0) {
    delete audio.gainKeyframes;
  } else {
    audio.gainKeyframes = keyframes;
  }
  if (Object.keys(audio).length === 0) {
    delete clip.audio;
  } else {
    clip.audio = audio;
  }
}

function normalizeTransformPatch(patch: TransformKeyframePatch): TransformKeyframePatch {
  const clean: TransformKeyframePatch = {};
  if (patch.offsetX !== undefined) {
    if (!Number.isFinite(patch.offsetX) || Math.abs(patch.offsetX) > 100_000) {
      throw new ProjectActionError('el desplazamiento debe estar entre -100000 y 100000');
    }
    clean.offsetX = Math.round(patch.offsetX);
  }
  if (patch.offsetY !== undefined) {
    if (!Number.isFinite(patch.offsetY) || Math.abs(patch.offsetY) > 100_000) {
      throw new ProjectActionError('el desplazamiento debe estar entre -100000 y 100000');
    }
    clean.offsetY = Math.round(patch.offsetY);
  }
  if (patch.scale !== undefined) {
    if (
      !Number.isFinite(patch.scale) ||
      patch.scale < TRANSFORM_KEYFRAME_SCALE_MIN ||
      patch.scale > TRANSFORM_KEYFRAME_SCALE_MAX
    ) {
      throw new ProjectActionError(
        `la escala animada debe estar entre ${TRANSFORM_KEYFRAME_SCALE_MIN} y ${TRANSFORM_KEYFRAME_SCALE_MAX}`,
      );
    }
    clean.scale = patch.scale;
  }
  if (patch.rotationDeg !== undefined) {
    if (!Number.isFinite(patch.rotationDeg) || Math.abs(patch.rotationDeg) > 360) {
      throw new ProjectActionError('la rotación debe estar entre -360 y 360 grados');
    }
    clean.rotationDeg = patch.rotationDeg;
  }
  if (patch.opacity !== undefined) {
    if (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1) {
      throw new ProjectActionError('la opacidad debe estar entre 0 y 1');
    }
    clean.opacity = patch.opacity;
  }
  if (Object.keys(clean).length === 0) {
    throw new ProjectActionError('la clave necesita al menos una propiedad animada');
  }
  return clean;
}

/** Creates or updates a transform keyframe at a clip-relative frame. */
export function setTransformKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
  patch: TransformKeyframePatch,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video' && clip.kind !== 'image') {
    throw new ProjectActionError('este tipo de clip no acepta keyframes de transformación');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const offset = Math.round(frame);
  if (offset < 0 || offset >= clip.durationFrames) {
    throw new ProjectActionError('la clave debe caer dentro del clip');
  }
  const clean = normalizeTransformPatch(patch);
  const keyframes = (clip.transform?.keyframes ?? []).map((keyframe) => ({ ...keyframe }));
  const index = keyframes.findIndex((keyframe) => keyframe.frame === offset);
  if (index >= 0) {
    keyframes[index] = { ...keyframes[index], ...clean, frame: offset };
  } else {
    if (keyframes.length >= MAX_TRANSFORM_KEYFRAMES) {
      throw new ProjectActionError(
        `este clip ya tiene el máximo de ${MAX_TRANSFORM_KEYFRAMES} keyframes`,
      );
    }
    keyframes.push({ frame: offset, ...clean });
  }
  keyframes.sort((a, b) => a.frame - b.frame);
  assignTransformKeyframes(clip, keyframes);
  touch(next);
  return next;
}

export function removeTransformKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const keyframes = clip.transform?.keyframes ?? [];
  const offset = Math.round(frame);
  if (!keyframes.some((keyframe) => keyframe.frame === offset)) {
    return project;
  }
  assignTransformKeyframes(
    clip,
    keyframes
      .filter((keyframe) => keyframe.frame !== offset)
      .map((keyframe) => ({ ...keyframe })),
  );
  touch(next);
  return next;
}

/** Removes the animation but freezes the value at `freezeAtFrame` in the static transform. */
export function clearTransformKeyframes(
  project: ProjectDocument,
  clipId: string,
  freezeAtFrame = 0,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  const keyframes = clip.transform?.keyframes ?? [];
  if (keyframes.length === 0) {
    return project;
  }
  const transform = { ...(clip.transform ?? {}) };
  const freeze = Math.max(0, Math.min(clip.durationFrames - 1, Math.round(freezeAtFrame)));
  const sampled = sampleTransformKeyframes(keyframes, freeze);
  if (sampled.offsetX !== undefined) transform.offsetX = sampled.offsetX;
  if (sampled.offsetY !== undefined) transform.offsetY = sampled.offsetY;
  if (sampled.scale !== undefined) {
    transform.scaleX = (transform.scaleX ?? 1) * sampled.scale;
    transform.scaleY = (transform.scaleY ?? 1) * sampled.scale;
  }
  if (sampled.rotationDeg !== undefined) transform.rotationDeg = sampled.rotationDeg;
  if (sampled.opacity !== undefined) transform.opacity = sampled.opacity;
  delete transform.keyframes;
  if (Object.keys(transform).length === 0) {
    delete clip.transform;
  } else {
    clip.transform = transform;
  }
  touch(next);
  return next;
}

/** Creates or updates a gain keyframe at a clip-relative frame. */
export function setGainKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
  gainDb: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video' && clip.kind !== 'audio') {
    throw new ProjectActionError('este tipo de clip no tiene audio para automatizar');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12) {
    throw new ProjectActionError('la ganancia debe estar entre -60 y 12 dB');
  }
  const offset = Math.round(frame);
  if (offset < 0 || offset >= clip.durationFrames) {
    throw new ProjectActionError('la clave debe caer dentro del clip');
  }
  const audio = { ...(clip.audio ?? {}) };
  const keyframes = (audio.gainKeyframes ?? []).map((keyframe) => ({ ...keyframe }));
  const index = keyframes.findIndex((keyframe) => keyframe.frame === offset);
  if (index >= 0) {
    keyframes[index] = { frame: offset, gainDb };
  } else {
    if (keyframes.length >= MAX_GAIN_KEYFRAMES) {
      throw new ProjectActionError(
        `este clip ya tiene el máximo de ${MAX_GAIN_KEYFRAMES} keyframes de volumen`,
      );
    }
    keyframes.push({ frame: offset, gainDb });
  }
  keyframes.sort((a, b) => a.frame - b.frame);
  audio.gainKeyframes = keyframes;
  clip.audio = audio;
  touch(next);
  return next;
}

export function removeGainKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const keyframes = clip.audio?.gainKeyframes ?? [];
  const offset = Math.round(frame);
  if (!keyframes.some((keyframe) => keyframe.frame === offset)) {
    return project;
  }
  assignGainKeyframes(
    clip,
    keyframes
      .filter((keyframe) => keyframe.frame !== offset)
      .map((keyframe) => ({ ...keyframe })),
  );
  touch(next);
  return next;
}

/** Removes gain automation but freezes the sampled gain at `freezeAtFrame`. */
export function clearGainKeyframes(
  project: ProjectDocument,
  clipId: string,
  freezeAtFrame = 0,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  const keyframes = clip.audio?.gainKeyframes ?? [];
  if (keyframes.length === 0) {
    return project;
  }
  const audio = { ...(clip.audio ?? {}) };
  const freeze = Math.max(0, Math.min(clip.durationFrames - 1, Math.round(freezeAtFrame)));
  audio.gainDb = sampleGainKeyframes(keyframes, freeze) ?? audio.gainDb ?? 0;
  delete audio.gainKeyframes;
  clip.audio = audio;
  touch(next);
  return next;
}

function sliceKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[] | undefined,
  cutFrame: number,
  sampleAt: (frame: number) => Partial<Omit<T, 'frame'>>,
): { left: T[]; right: T[] } | undefined {
  if (!keyframes || keyframes.length === 0) {
    return undefined;
  }
  const left = keyframes
    .filter((keyframe) => keyframe.frame < cutFrame)
    .map((keyframe) => ({ ...keyframe }));
  const right = keyframes
    .filter((keyframe) => keyframe.frame >= cutFrame)
    .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - cutFrame }));
  if (cutFrame > 0) {
    if (!left.some((keyframe) => keyframe.frame === cutFrame - 1)) {
      left.push({ frame: cutFrame - 1, ...sampleAt(cutFrame - 1) } as T);
    }
    if (!right.some((keyframe) => keyframe.frame === 0)) {
      right.unshift({ frame: 0, ...sampleAt(cutFrame) } as T);
    }
  }
  left.sort((a, b) => a.frame - b.frame);
  right.sort((a, b) => a.frame - b.frame);
  return { left, right };
}

function trimStartKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[],
  delta: number,
  sampleAt: (frame: number) => Partial<Omit<T, 'frame'>>,
): T[] {
  if (delta === 0) {
    return keyframes.map((keyframe) => ({ ...keyframe }));
  }
  if (delta < 0) {
    return keyframes
      .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - delta }))
      .sort((a, b) => a.frame - b.frame);
  }
  const shifted = keyframes
    .filter((keyframe) => keyframe.frame >= delta)
    .map((keyframe) => ({ ...keyframe, frame: keyframe.frame - delta }));
  if (!shifted.some((keyframe) => keyframe.frame === 0)) {
    shifted.unshift({ frame: 0, ...sampleAt(delta) } as T);
  }
  return shifted.sort((a, b) => a.frame - b.frame);
}

function trimEndKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[],
  newDuration: number,
  sampleAt: (frame: number) => Partial<Omit<T, 'frame'>>,
): T[] {
  const kept = keyframes
    .filter((keyframe) => keyframe.frame < newDuration)
    .map((keyframe) => ({ ...keyframe }));
  const boundary = Math.max(0, newDuration - 1);
  if (!kept.some((keyframe) => keyframe.frame === boundary)) {
    kept.push({ frame: boundary, ...sampleAt(boundary) } as T);
  }
  return kept.sort((a, b) => a.frame - b.frame);
}

function scaleKeyframes<T extends FrameKeyframe>(
  keyframes: readonly T[],
  factor: number,
  maxFrame: number,
): T[] {
  const merged = new Map<number, T>();
  for (const keyframe of keyframes) {
    const frame = Math.max(0, Math.min(maxFrame, Math.round(keyframe.frame * factor)));
    const previous = merged.get(frame);
    merged.set(frame, { ...(previous ?? {}), ...keyframe, frame } as T);
  }
  return [...merged.values()].sort((a, b) => a.frame - b.frame);
}

function applySplitKeyframes(
  left: Clip,
  right: Clip,
  cutFrame: number,
  transformKeyframes: readonly ClipTransformKeyframe[] | undefined,
  gainKeyframes: readonly ClipGainKeyframe[] | undefined,
): void {
  if (transformKeyframes && transformKeyframes.length > 0) {
    const sliced = sliceKeyframes(transformKeyframes, cutFrame, (frame) =>
      sampleTransformKeyframes(transformKeyframes, frame),
    );
    if (sliced) {
      assignTransformKeyframes(left, sliced.left);
      assignTransformKeyframes(right, sliced.right);
    }
  }
  if (gainKeyframes && gainKeyframes.length > 0) {
    const sliced = sliceKeyframes(gainKeyframes, cutFrame, (frame) => ({
      gainDb: sampleGainKeyframes(gainKeyframes, frame) ?? 0,
    }));
    if (sliced) {
      assignGainKeyframes(left, sliced.left);
      assignGainKeyframes(right, sliced.right);
    }
  }
}

/** Change the playback speed of a windowed clip and ripple the rest of its track.
 * The source window is adjusted so `durationFrames x speed = sourceFrames` stays exact. */
export function setClipSpeed(
  project: ProjectDocument,
  clipId: string,
  speed: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('solo los clips de video o audio tienen velocidad');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const requested = Number.isFinite(speed) ? Math.max(0.1, Math.min(4, speed)) : 1;
  const rawDen = 1_000;
  const rawNum = Math.max(1, Math.round(requested * rawDen));
  const divisor = gcd(rawNum, rawDen);
  const num = rawNum / divisor;
  const den = rawDen / divisor;
  const sourceFrames = clip.source.outFrame - clip.source.inFrame;
  const oldDuration = clip.durationFrames;
  const asset = next.assets.find((item) => item.id === clip.source.assetId);
  const mediaFrames =
    asset && 'media' in asset && asset.media && 'durationFrames' in asset.media
      ? asset.media.durationFrames
      : undefined;
  const maxSourceFrames =
    mediaFrames !== undefined ? Math.max(1, mediaFrames - clip.source.inFrame) : sourceFrames;

  let duration: number;
  if (num === den) {
    duration = Math.min(sourceFrames, maxSourceFrames);
    delete clip.speed;
    clip.source.outFrame = clip.source.inFrame + duration;
  } else {
    const unit = den / gcd(num, den);
    duration = Math.max(unit, Math.round((sourceFrames * den) / num / unit) * unit);
    let source = (duration * num) / den;
    while (source > maxSourceFrames && duration > unit) {
      duration -= unit;
      source = (duration * num) / den;
    }
    if (!Number.isInteger(source) || source < 1) {
      throw new ProjectActionError('esa velocidad no se puede representar en frames enteros');
    }
    clip.durationFrames = duration;
    clip.source.outFrame = clip.source.inFrame + source;
    clip.speed = { num, den };
  }
  const delta = clip.durationFrames - oldDuration;
  const oldEnd = clip.startFrame + oldDuration;
  if (delta !== 0) {
    for (const other of next.timeline.clips) {
      if (other.id === clip.id || other.trackId !== clip.trackId) continue;
      if (other.startFrame >= oldEnd) {
        other.startFrame = Math.max(0, other.startFrame + delta);
      }
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

export function addTranscriptionCues(
  project: ProjectDocument,
  clipId: string,
  segments: readonly {
    start: number;
    end: number;
    text: string;
    words?: readonly { start: number; end: number; word: string }[];
  }[],
  replaceExisting = true,
): { project: ProjectDocument; added: number; skipped: number } {
  const clip = project.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const captionTrack = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (captionTrack?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  const fps = fpsOf(next);
  const clipStart = clip.startFrame;
  const clipEnd = clip.startFrame + clip.durationFrames;
  if (replaceExisting) {
    next.captions.cues = next.captions.cues.filter(
      (cue) => !(cue.trackId === setup.trackId && cue.startFrame < clipEnd && cue.endFrame > clipStart),
    );
  }
  let added = 0;
  let skipped = 0;
  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    const startFrame = Math.max(clipStart, clipStart + Math.round(segment.start * fps));
    const endFrame = Math.min(clipEnd, clipStart + Math.round(segment.end * fps));
    if (!text || endFrame <= startFrame) {
      skipped += 1;
      continue;
    }
    const overlaps = next.captions.cues.some(
      (cue) =>
        cue.trackId === setup.trackId &&
        cue.startFrame < endFrame &&
        cue.endFrame > startFrame,
    );
    if (overlaps) {
      skipped += 1;
      continue;
    }
    const words =
      'words' in segment && Array.isArray(segment.words)
        ? segment.words
            .filter(
              (word: { start: number; end: number; word: string }) =>
                word.word.trim() && word.end > word.start,
            )
            .map((word: { start: number; end: number; word: string }) => ({
              text: word.word.trim().slice(0, 200),
              startFrame: Math.max(
                startFrame,
                clipStart + Math.round(word.start * fps),
              ),
              endFrame: Math.min(
                endFrame,
                clipStart + Math.round(word.end * fps),
              ),
            }))
            .filter(
              (word: { startFrame: number; endFrame: number }) =>
                word.endFrame > word.startFrame,
            )
        : undefined;
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: setup.styleId,
      text,
      language: next.language,
      startFrame,
      endFrame,
      ...(words && words.length > 0 ? { words } : {}),
    });
    added += 1;
  }
  touch(next);
  return { project: next, added, skipped };
}

/** Insert already-timed cues, used by the automatic director. */
export function addCaptionCueWindows(
  project: ProjectDocument,
  inputs: readonly {
    text: string;
    startFrame: number;
    endFrame: number;
    words?: readonly { text: string; startFrame: number; endFrame: number }[];
  }[],
  options: { replaceTrack?: boolean } = {},
): { project: ProjectDocument; added: number; skipped: number; trackId: string } {
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const captionTrack = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (captionTrack?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  if (options.replaceTrack) {
    next.captions.cues = next.captions.cues.filter((cue) => cue.trackId !== setup.trackId);
  }
  let added = 0;
  let skipped = 0;
  for (const input of inputs) {
    const text = input.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    const startFrame = Math.max(0, Math.round(input.startFrame));
    const endFrame = Math.max(0, Math.round(input.endFrame));
    if (!text || endFrame <= startFrame) {
      skipped += 1;
      continue;
    }
    const overlaps = next.captions.cues.some(
      (cue) =>
        cue.trackId === setup.trackId &&
        cue.startFrame < endFrame &&
        cue.endFrame > startFrame,
    );
    if (overlaps) {
      skipped += 1;
      continue;
    }
    const words = input.words
      ?.filter((word) => word.text.trim() && word.endFrame > word.startFrame)
      .map((word) => ({
        text: word.text.trim().slice(0, 200),
        startFrame: Math.max(startFrame, Math.round(word.startFrame)),
        endFrame: Math.min(endFrame, Math.round(word.endFrame)),
      }))
      .filter((word) => word.endFrame > word.startFrame);
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: setup.styleId,
      text,
      language: next.language,
      startFrame,
      endFrame,
      ...(words && words.length > 0 ? { words } : {}),
    });
    added += 1;
  }
  touch(next);
  return { project: next, added, skipped, trackId: setup.trackId };
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
  let next = cloneProject(project);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ProjectActionError('el proyecto necesita un nombre');
    next.name = name.slice(0, 120);
  }
  if (patch.width !== undefined) next.video.width = evenDimension(patch.width, next.video.width);
  if (patch.height !== undefined) next.video.height = evenDimension(patch.height, next.video.height);
  if (patch.backgroundColor !== undefined) next.video.backgroundColor = patch.backgroundColor;
  if (patch.language !== undefined) next.language = patch.language;
  if (patch.width !== undefined || patch.height !== undefined) {
    // Canvas changes are non-destructive; the renderer fits every clip to the
    // new frame. The native delivery profile follows the project size.
    syncNativeProfile(next);
  }
  const nextNum = patch.fpsNum !== undefined ? Math.max(1, Math.round(patch.fpsNum)) : next.video.frameRate.num;
  const nextDen = patch.fpsDen !== undefined ? Math.max(1, Math.round(patch.fpsDen)) : next.video.frameRate.den;
  if (!validFpsRange(nextNum, nextDen)) {
    throw new ProjectActionError('La tasa de frames debe quedar entre 1 y 240 fps.');
  }
  const fpsChanged =
    nextNum !== next.video.frameRate.num || nextDen !== next.video.frameRate.den;
  if (fpsChanged) {
    try {
      next = retimeProject(next, nextNum, nextDen);
    } catch (error) {
      throw new ProjectActionError(
        error instanceof Error ? error.message : 'no se pudo cambiar la tasa de frames',
      );
    }
  } else {
    touch(next);
  }
  return next;
}

export function updateAudioMix(
  project: ProjectDocument,
  patch: {
    masterGainDb?: number;
    masterLimiter?: boolean;
    loudnessTarget?: ProjectDocument['audio']['loudnessTarget'];
  },
): ProjectDocument {
  const next = cloneProject(project);
  if (patch.masterGainDb !== undefined) {
    next.audio.master.gainDb = Math.max(-60, Math.min(12, patch.masterGainDb));
  }
  if (patch.masterLimiter !== undefined) {
    next.audio.master.limiter = patch.masterLimiter;
  }
  if ('loudnessTarget' in patch) {
    if (patch.loudnessTarget === undefined) {
      delete next.audio.loudnessTarget;
    } else {
      next.audio.loudnessTarget = patch.loudnessTarget;
    }
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
