import type {
  Asset,
  AssetProxy,
  BlendMode,
  CaptionCue,
  CaptionStyle,
  CaptionMotion,
  Clip,
  ChromaKey,
  ClipEffects,
  ClipGainKeyframe,
  ClipMotion,
  ClipTransformKeyframe,
  ClipTransition,
  ClipMask,
  ClipMaskKeyframe,
  ClipAnimation,
  ClipColorTag,
  ProjectDocument,
  Scene,
  Track,
} from '@editor-ia/project-schema';
import {
  MAX_ASSET_BIN_LENGTH,
  MAX_ASSET_TAGS,
  MAX_ASSET_TAG_LENGTH,
  MAX_GAIN_KEYFRAMES,
  MAX_TRANSFORM_KEYFRAMES,
  TRANSFORM_KEYFRAME_SCALE_MAX,
  TRANSFORM_KEYFRAME_SCALE_MIN,
  hasGeometryKeyframes,
  sampleGainKeyframes,
  sampleTransformKeyframes,
} from '@editor-ia/project-schema';
import { friendlyAssetLabel } from './asset-labels';
import { AUDIO_PRESETS, type AudioPresetId } from './audio-presets';
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
    case 'freeze':
      return 'video';
    case 'adjustment':
      return 'adjustment';
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

/** Edits the organisational metadata without touching paths, hashes or rights. */
export function updateAssetMetadata(
  project: ProjectDocument,
  assetId: string,
  patch: {
    label?: string;
    bin?: string | null;
    tags?: readonly string[];
    favorite?: boolean;
  },
): ProjectDocument {
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) {
      throw new ProjectActionError('el material necesita un nombre');
    }
    asset.label = label;
  }
  if (patch.bin !== undefined) {
    const bin = (patch.bin ?? '').trim();
    if (!bin) {
      delete asset.bin;
    } else {
      if (bin.length > MAX_ASSET_BIN_LENGTH) {
        throw new ProjectActionError(
          `el bin admite hasta ${MAX_ASSET_BIN_LENGTH} caracteres`,
        );
      }
      asset.bin = bin;
    }
  }
  if (patch.tags !== undefined) {
    const tags: string[] = [];
    const seen = new Set<string>();
    for (const raw of patch.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      if (tag.length > MAX_ASSET_TAG_LENGTH) {
        throw new ProjectActionError(
          `cada etiqueta admite hasta ${MAX_ASSET_TAG_LENGTH} caracteres`,
        );
      }
      const key = tag.toLocaleLowerCase('es');
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
    if (tags.length > MAX_ASSET_TAGS) {
      throw new ProjectActionError(`un material admite hasta ${MAX_ASSET_TAGS} etiquetas`);
    }
    if (tags.length === 0) {
      delete asset.tags;
    } else {
      asset.tags = tags;
    }
  }
  if (patch.favorite !== undefined) {
    if (patch.favorite) asset.favorite = true;
    else delete asset.favorite;
  }
  touch(next);
  return next;
}

export function toggleAssetFavorite(
  project: ProjectDocument,
  assetId: string,
): ProjectDocument {
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  return updateAssetMetadata(project, assetId, { favorite: !asset.favorite });
}

export function setAssetProxy(
  project: ProjectDocument,
  assetId: string,
  proxy: AssetProxy | undefined,
): ProjectDocument {
  const next = cloneProject(project);
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset) {
    throw new ProjectActionError('el material no está en el proyecto');
  }
  if (asset.kind !== 'video') {
    throw new ProjectActionError('solo los videos aceptan un proxy');
  }
  const target = asset as Asset & { proxy?: AssetProxy };
  if (proxy) target.proxy = proxy;
  else delete target.proxy;
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

/**
 * Adds a source-less adjustment layer at the playhead. It lands on its own
 * track (created on demand) and grades the composite only inside its window;
 * the default length is three seconds because it is a grade range, not media.
 */
export function addAdjustmentLayer(
  project: ProjectDocument,
  atFrame: number,
  options: { durationFrames?: number; trackId?: string } = {},
): { project: ProjectDocument; clipId: string; trackId: string; startFrame: number } {
  const next = cloneProject(project);
  const fps = fpsOf(next);
  let track: Track | undefined;
  if (options.trackId) {
    track = next.timeline.tracks.find((item) => item.id === options.trackId);
    if (!track || track.kind !== 'adjustment') {
      throw new ProjectActionError('la pista elegida no es una pista de ajustes');
    }
    if (track.locked) {
      throw new ProjectActionError('la pista de ajustes está bloqueada');
    }
  } else {
    track = next.timeline.tracks.find(
      (item) => item.kind === 'adjustment' && !item.locked,
    );
    if (!track) {
      const created = addTrack(next, 'adjustment', 'Ajustes');
      next.timeline = created.project.timeline;
      track = next.timeline.tracks.find((item) => item.id === created.trackId);
      if (!track) {
        throw new ProjectActionError('no se pudo crear la pista de ajustes');
      }
    }
  }
  const durationFrames = Math.max(
    1,
    Math.round(options.durationFrames ?? Math.round(fps * 3)),
  );
  const startFrame = findGap(
    intervalsForTrack(next, track.id),
    Math.max(0, Math.round(atFrame)),
    durationFrames,
  );
  const clipId = newId();
  const clip: Clip = {
    id: clipId,
    trackId: track.id,
    kind: 'adjustment',
    label: 'Capa de ajuste',
    startFrame,
    durationFrames,
    source: { type: 'adjustment' },
    effects: {},
  };
  next.timeline.clips.push(clip);
  touch(next);
  return { project: next, clipId, trackId: track.id, startFrame };
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
    case 'freeze':
      return ['video'];
    case 'adjustment':
      return ['adjustment'];
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

export function applySpeedRamp(
  project: ProjectDocument,
  clipId: string,
  options: { readonly from: number; readonly to: number },
): { project: ProjectDocument; clipIds: string[]; speeds: number[] } {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) {
    throw new ProjectActionError('la rampa de velocidad necesita un clip de video o audio');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length || clip.audio?.gainKeyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación o volumen antes de aplicar la rampa',
    );
  }
  if ('motion' in clip && clip.motion) {
    throw new ProjectActionError(
      'quitá el movimiento Ken Burns antes de aplicar la rampa; después podés aplicarlo por tramo',
    );
  }
  if ('reverse' in clip && clip.reverse) {
    throw new ProjectActionError(
      'quitá el reverse antes de aplicar la rampa; después podés invertir cada tramo',
    );
  }
  const from = Number(options.from);
  const to = Number(options.to);
  if (from < 0.1 || from > 4 || to < 0.1 || to > 4) {
    throw new ProjectActionError('las velocidades de la rampa deben estar entre 0.1x y 4x');
  }
  if (Math.abs(from - to) < 0.001) {
    throw new ProjectActionError('elegí dos velocidades distintas para la rampa');
  }
  const windowFrames = clip.source.outFrame - clip.source.inFrame;
  const total = clip.durationFrames;
  if (windowFrames < 3 || total < 3) {
    throw new ProjectActionError('el clip es demasiado corto para una rampa de tres tramos');
  }
  const d1 = Math.max(1, Math.floor(total / 3));
  const d2 = Math.max(1, Math.floor((total - d1) / 2));
  const d3 = total - d1 - d2;
  if (d3 < 1) {
    throw new ProjectActionError('el clip es demasiado corto para una rampa de tres tramos');
  }
  const middleSpeed = (windowFrames - d1 * from - d3 * to) / d2;
  if (!Number.isFinite(middleSpeed) || middleSpeed < 0.1 || middleSpeed > 4) {
    throw new ProjectActionError(
      'la ventana del clip no alcanza para esas velocidades; acercá los extremos',
    );
  }
  const durations = [d1, d2, d3];
  const sourceFrames = [
    Math.max(1, Math.round(d1 * from)),
    Math.max(1, Math.round(d2 * middleSpeed)),
    0,
  ];
  sourceFrames[2] = windowFrames - sourceFrames[0]! - sourceFrames[1]!;
  if (sourceFrames[2]! < 1) {
    throw new ProjectActionError(
      'la ventana del clip no alcanza para esas velocidades; acercá los extremos',
    );
  }
  const speeds = sourceFrames.map((frames, index) => frames / durations[index]!);
  if (speeds.some((speed) => speed < 0.1 || speed > 4)) {
    throw new ProjectActionError(
      'la rampa produjo un tramo fuera de 0.1x–4x; acercá los extremos',
    );
  }

  const result = replaceWithSpeedSegments(
    next,
    clipId,
    durations,
    sourceFrames,
    (index) => `${clip.label ?? 'Clip'} · rampa ${index + 1}/3`,
  );
  return { project: next, clipIds: result.clipIds, speeds: result.speeds };
}

/**
 * Replaces a windowed clip with contiguous segments and keeps the scene
 * references valid. Shared by the three-step ramp and the smooth curve.
 */
function replaceWithSpeedSegments(
  next: ProjectDocument,
  clipId: string,
  durations: readonly number[],
  sourceFrames: readonly number[],
  labelFor: (index: number) => string,
): { clipIds: string[]; speeds: number[] } {
  const template = next.timeline.clips.find((item) => item.id === clipId) as Extract<
    Clip,
    { kind: 'video' | 'audio' }
  >;
  const baseIn = template.source.inFrame;
  const total = durations.length;
  const clipIds: string[] = [];
  const created: Clip[] = [];
  let cursorFrame = template.startFrame;
  let cursorSource = 0;
  for (let index = 0; index < total; index += 1) {
    const duration = durations[index]!;
    const window = sourceFrames[index]!;
    const copy = JSON.parse(JSON.stringify(template)) as Extract<
      Clip,
      { kind: 'video' | 'audio' }
    > & {
      transitionIn?: ClipTransition;
      effects?: ClipEffects;
    };
    copy.id = newId();
    copy.label = labelFor(index).slice(0, 200);
    copy.startFrame = cursorFrame;
    copy.durationFrames = duration;
    copy.source.inFrame = baseIn + cursorSource;
    copy.source.outFrame = baseIn + cursorSource + window;
    const divisor = gcd(window, duration);
    if (window === duration) delete copy.speed;
    else copy.speed = { num: window / divisor, den: duration / divisor };
    if (index > 0) delete copy.transitionIn;
    if (copy.effects) {
      if (index > 0) delete copy.effects.fadeInFrames;
      if (index < total - 1) delete copy.effects.fadeOutFrames;
      if (Object.keys(copy.effects).length === 0) delete copy.effects;
    }
    if (copy.audio) {
      if (index > 0) delete copy.audio.fadeInFrames;
      if (index < total - 1) delete copy.audio.fadeOutFrames;
      if (Object.keys(copy.audio).length === 0) delete copy.audio;
    }
    created.push(copy as Clip);
    clipIds.push(copy.id);
    cursorFrame += duration;
    cursorSource += window;
  }
  next.timeline.clips = [
    ...next.timeline.clips.filter((item) => item.id !== clipId),
    ...created,
  ];
  const replacement = new Set(clipIds);
  next.scenes = next.scenes.map((scene) => ({
    ...scene,
    clipIds: scene.clipIds.flatMap((id) => (id === clipId ? [...replacement] : [id])),
  }));
  touch(next);
  return {
    clipIds,
    speeds: sourceFrames.map((frames, index) => frames / durations[index]!),
  };
}

/**
 * Smooth speed curve in N contiguous segments. Like the three-step ramp it
 * keeps the clip's total duration and source window fixed and pins the first
 * and last segment to `from`/`to`; the intermediate segments are shifted by a
 * constant so the source window still adds up. The resulting speeds are
 * returned so the UI can show what was applied.
 */
export function applySpeedCurve(
  project: ProjectDocument,
  clipId: string,
  options: { readonly from: number; readonly to: number; readonly segments?: number },
): { project: ProjectDocument; clipIds: string[]; speeds: number[] } {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || (clip.kind !== 'video' && clip.kind !== 'audio')) {
    throw new ProjectActionError('la curva de velocidad necesita un clip de video o audio');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  if (clip.transform?.keyframes?.length || clip.audio?.gainKeyframes?.length) {
    throw new ProjectActionError(
      'quitá los keyframes de transformación o volumen antes de aplicar la curva',
    );
  }
  if ('motion' in clip && clip.motion) {
    throw new ProjectActionError(
      'quitá el movimiento Ken Burns antes de aplicar la curva; después podés aplicarlo por tramo',
    );
  }
  if ('reverse' in clip && clip.reverse) {
    throw new ProjectActionError('quitá el reverse antes de aplicar la curva');
  }
  const from = Number(options.from);
  const to = Number(options.to);
  if (from < 0.1 || from > 4 || to < 0.1 || to > 4) {
    throw new ProjectActionError('las velocidades de la curva deben estar entre 0.1x y 4x');
  }
  if (Math.abs(from - to) < 0.001) {
    throw new ProjectActionError('elegí dos velocidades distintas para la curva');
  }
  const segments = Math.round(options.segments ?? 8);
  if (segments < 3 || segments > 24) {
    throw new ProjectActionError('la curva necesita entre 3 y 24 tramos');
  }
  const windowFrames = clip.source.outFrame - clip.source.inFrame;
  const total = clip.durationFrames;
  if (windowFrames < segments || total < segments * 2) {
    throw new ProjectActionError('el clip es demasiado corto para esa cantidad de tramos');
  }
  const durations: number[] = [];
  let remaining = total;
  for (let index = 0; index < segments; index += 1) {
    const duration = index === segments - 1 ? remaining : Math.floor(total / segments);
    durations.push(duration);
    remaining -= duration;
  }
  if (durations.some((duration) => duration < 1)) {
    throw new ProjectActionError('el clip es demasiado corto para esa cantidad de tramos');
  }
  const ease = (value: number): number => value * value * (3 - 2 * value);
  const shape = durations.map((_, index) =>
    from + (to - from) * ease((index + 0.5) / segments),
  );
  const middle = durations.slice(1, -1).reduce((sum, duration) => sum + duration, 0);
  const fixedSource =
    durations[0]! * from + durations[segments - 1]! * to;
  let middleSource = 0;
  for (let index = 1; index < segments - 1; index += 1) {
    middleSource += durations[index]! * shape[index]!;
  }
  const shift = middle > 0 ? (windowFrames - fixedSource - middleSource) / middle : 0;
  const speeds = shape.map((value, index) =>
    index === 0 ? from : index === segments - 1 ? to : value + shift,
  );
  if (speeds.some((speed) => speed < 0.1 || speed > 4)) {
    throw new ProjectActionError(
      'la curva produjo un tramo fuera de 0.1x–4x; acercá los extremos',
    );
  }
  const sourceFrames = durations.map((duration, index) =>
    index === segments - 1
      ? 0
      : Math.max(1, Math.round(duration * speeds[index]!)),
  );
  sourceFrames[segments - 1] = windowFrames - sourceFrames.reduce((sum, value) => sum + value, 0);
  if (sourceFrames[segments - 1]! < 1) {
    throw new ProjectActionError('la ventana del clip no alcanza para esa curva');
  }
  const actual = sourceFrames.map((frames, index) => frames / durations[index]!);
  if (actual.some((speed) => speed < 0.1 || speed > 4)) {
    throw new ProjectActionError(
      'la curva produjo un tramo fuera de 0.1x–4x; acercá los extremos',
    );
  }
  const result = replaceWithSpeedSegments(next, clipId, durations, sourceFrames, (index) =>
    `${clip.label ?? 'Clip'} · curva ${index + 1}/${segments}`,
  );
  return { project: next, clipIds: result.clipIds, speeds: result.speeds };
}

/** Attach or clear the analyzed stabilization of a video clip. */
export function setClipStabilization(
  project: ProjectDocument,
  clipId: string,
  stabilization:
    | { smoothing: number; transformFile: string; inFrame: number; outFrame: number }
    | undefined,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video') {
    throw new ProjectActionError('solo los clips de video aceptan estabilización');
  }
  if (stabilization === undefined) {
    delete clip.stabilization;
  } else {
    clip.stabilization = {
      smoothing: Math.max(1, Math.min(60, Math.round(stabilization.smoothing))),
      transformFile: stabilization.transformFile,
      inFrame: stabilization.inFrame,
      outFrame: stabilization.outFrame,
    };
  }
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

function measuredSourceFrames(project: ProjectDocument, clip: WindowedClip): number {
  if (clip.source.type !== 'asset') {
    throw new ProjectActionError('el clip no referencia un material local');
  }
  const asset = project.assets.find((item) => item.id === clip.source.assetId);
  const media = asset && 'media' in asset ? asset.media : undefined;
  const duration =
    media && 'durationFrames' in media ? media.durationFrames : undefined;
  if (typeof duration !== 'number' || duration <= 0) {
    throw new ProjectActionError('el material no declara una duración medida');
  }
  return duration;
}

function trimGuards(
  project: ProjectDocument,
  clip: WindowedClip,
  options: { allowKeyframes: boolean },
): void {
  const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!track || track.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const speed = speedOf(clip);
  if (speed.num !== speed.den) {
    throw new ProjectActionError('el ajuste fino requiere velocidad 1×');
  }
  if ('stabilization' in clip && clip.stabilization) {
    throw new ProjectActionError(
      'quitá la estabilización antes de mover la ventana de origen',
    );
  }
  if (options.allowKeyframes) return;
  const maskKeyframes = 'mask' in clip ? clip.mask?.keyframes?.length : undefined;
  if (
    clip.transform?.keyframes?.length ||
    clip.audio?.gainKeyframes?.length ||
    maskKeyframes
  ) {
    throw new ProjectActionError(
      'quitá los keyframes de los clips afectados antes de mover el corte',
    );
  }
}

/**
 * Slip: moves the source window inside the clip without moving the clip on the
 * timeline. The duration and every neighbour stay untouched.
 */
export function slipClip(
  project: ProjectDocument,
  clipId: string,
  deltaFrames: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('el slip necesita un clip de video o audio');
  }
  trimGuards(next, clip, { allowKeyframes: true });
  const delta = Math.round(deltaFrames);
  if (delta === 0) return project;
  const max = measuredSourceFrames(next, clip);
  const inFrame = clip.source.inFrame + delta;
  const outFrame = clip.source.outFrame + delta;
  if (inFrame < 0 || outFrame > max) {
    throw new ProjectActionError(
      'el slip se sale de la ventana disponible del material',
    );
  }
  clip.source.inFrame = inFrame;
  clip.source.outFrame = outFrame;
  touch(next);
  return next;
}

/**
 * Slide: moves the clip on the timeline and absorbs the difference in its two
 * contiguous neighbours. The middle clip keeps its duration and source window.
 */
export function slideClip(
  project: ProjectDocument,
  clipId: string,
  deltaFrames: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('el slide necesita un clip de video o audio');
  }
  const trackClips = next.timeline.clips
    .filter((item) => item.trackId === clip.trackId)
    .sort((a, b) => a.startFrame - b.startFrame);
  const index = trackClips.findIndex((item) => item.id === clip.id);
  const previous = trackClips[index - 1];
  const following = trackClips[index + 1];
  if (!previous || !following) {
    throw new ProjectActionError('slide necesita un clip anterior y otro posterior');
  }
  if (!isWindowed(previous) || !isWindowed(following)) {
    throw new ProjectActionError(
      'slide necesita clips de video o audio a ambos lados',
    );
  }
  if (
    previous.startFrame + previous.durationFrames !== clip.startFrame ||
    clip.startFrame + clip.durationFrames !== following.startFrame
  ) {
    throw new ProjectActionError('slide necesita tres clips contiguos');
  }
  for (const item of [previous, clip, following]) {
    trimGuards(next, item, { allowKeyframes: false });
  }
  const delta = Math.round(deltaFrames);
  if (delta === 0) return project;
  const previousMax = measuredSourceFrames(next, previous);
  const previousDuration = previous.durationFrames + delta;
  const followingDuration = following.durationFrames - delta;
  const followingIn = following.source.inFrame + delta;
  if (previousDuration < 1 || followingDuration < 1) {
    throw new ProjectActionError('slide dejaría un clip sin duración');
  }
  if (
    previous.source.outFrame + delta > previousMax ||
    previous.source.outFrame + delta <= previous.source.inFrame
  ) {
    throw new ProjectActionError(
      'slide se sale de la ventana del clip anterior',
    );
  }
  if (followingIn < 0 || followingIn >= following.source.outFrame) {
    throw new ProjectActionError(
      'slide se sale de la ventana del clip siguiente',
    );
  }
  previous.durationFrames = previousDuration;
  previous.source.outFrame += delta;
  clip.startFrame += delta;
  following.startFrame += delta;
  following.durationFrames = followingDuration;
  following.source.inFrame = followingIn;
  touch(next);
  return next;
}

/**
 * Roll: moves the cut between two contiguous clips without moving either outer
 * edge. `edge: "in"` edits the cut with the previous clip; `"out"` the next.
 */
export function rollClip(
  project: ProjectDocument,
  clipId: string,
  edge: 'in' | 'out',
  deltaFrames: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !isWindowed(clip)) {
    throw new ProjectActionError('el roll necesita un clip de video o audio');
  }
  const trackClips = next.timeline.clips
    .filter((item) => item.trackId === clip.trackId)
    .sort((a, b) => a.startFrame - b.startFrame);
  const index = trackClips.findIndex((item) => item.id === clip.id);
  const left = edge === 'in' ? trackClips[index - 1] : clip;
  const right = edge === 'in' ? clip : trackClips[index + 1];
  if (!left || !right) {
    throw new ProjectActionError(
      edge === 'in'
        ? 'el roll de entrada necesita un clip anterior'
        : 'el roll de salida necesita un clip posterior',
    );
  }
  if (!isWindowed(left) || !isWindowed(right)) {
    throw new ProjectActionError('el roll necesita clips de video o audio');
  }
  if (left.startFrame + left.durationFrames !== right.startFrame) {
    throw new ProjectActionError('los clips del corte no son contiguos');
  }
  trimGuards(next, left, { allowKeyframes: false });
  trimGuards(next, right, { allowKeyframes: false });
  const delta = Math.round(deltaFrames);
  if (delta === 0) return project;
  const leftMax = measuredSourceFrames(next, left);
  const leftDuration = left.durationFrames + delta;
  const rightDuration = right.durationFrames - delta;
  const rightIn = right.source.inFrame + delta;
  if (leftDuration < 1 || rightDuration < 1) {
    throw new ProjectActionError('el roll dejaría un clip sin duración');
  }
  if (
    left.source.outFrame + delta > leftMax ||
    left.source.outFrame + delta <= left.source.inFrame
  ) {
    throw new ProjectActionError('el roll se sale de la ventana del clip izquierdo');
  }
  if (rightIn < 0 || rightIn >= right.source.outFrame) {
    throw new ProjectActionError('el roll se sale de la ventana del clip derecho');
  }
  left.durationFrames = leftDuration;
  left.source.outFrame += delta;
  right.startFrame += delta;
  right.durationFrames = rightDuration;
  right.source.inFrame = rightIn;
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
/**
 * Freeze inside the original video track: split at the playhead, shift every
 * clip, caption and marker at/after it, and insert a ready image asset as a
 * `freeze` clip. The copied effects/static transform keep the still close to
 * the surrounding grade.
 */
export function freezeFrameInPlace(
  project: ProjectDocument,
  clipId: string,
  atFrame: number,
  assetId: string,
  durationFrames = 60,
): {
  project: ProjectDocument;
  freezeClipId: string;
  startFrame: number;
  durationFrames: number;
} {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || clip.kind !== 'video') {
    throw new ProjectActionError('el freeze en la pista necesita un clip de video');
  }
  const track = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!track || track.locked) {
    throw new ProjectActionError('la pista del video está bloqueada');
  }
  const at = Math.round(atFrame);
  const clipEnd = clip.startFrame + clip.durationFrames;
  if (at < clip.startFrame || at >= clipEnd) {
    throw new ProjectActionError('poné el playhead dentro del clip de video');
  }
  const duration = Math.max(1, Math.round(durationFrames));
  const asset = next.assets.find((item) => item.id === assetId);
  if (!asset || asset.kind !== 'image') {
    throw new ProjectActionError('el freeze necesita una imagen importada');
  }
  if (asset.status !== 'ready') {
    throw new ProjectActionError('confirmá los derechos del frame antes de congelarlo');
  }
  const original = {
    effects: clip.effects ? JSON.parse(JSON.stringify(clip.effects)) : undefined,
    transform: clip.transform
      ? (() => {
          const { keyframes: _keyframes, ...rest } = clip.transform;
          return Object.keys(rest).length > 0
            ? JSON.parse(JSON.stringify(rest))
            : undefined;
        })()
      : undefined,
    blendMode: 'blendMode' in clip ? clip.blendMode : undefined,
    trackId: clip.trackId,
  };
  let working = next;
  if (at > clip.startFrame) {
    const split = splitClip(working, clipId, at);
    if (!split) {
      throw new ProjectActionError('no se pudo dividir el clip en el playhead');
    }
    working = split.project;
  }
  for (const item of working.timeline.clips) {
    if (item.startFrame >= at) item.startFrame += duration;
  }
  for (const cue of working.captions.cues) {
    if (cue.startFrame >= at) {
      cue.startFrame += duration;
      cue.endFrame += duration;
      for (const word of cue.words ?? []) {
        word.startFrame += duration;
        word.endFrame += duration;
      }
    }
  }
  for (const marker of working.markers) {
    if (marker.frame >= at) marker.frame += duration;
  }
  const freezeClipId = newId();
  const freeze: Clip = {
    id: freezeClipId,
    trackId: original.trackId,
    kind: 'freeze',
    label: 'Congelado',
    startFrame: at,
    durationFrames: duration,
    source: { type: 'asset', assetId },
    ...(original.effects ? { effects: original.effects } : {}),
    ...(original.transform ? { transform: original.transform } : {}),
    ...(original.blendMode ? { blendMode: original.blendMode } : {}),
  };
  working.timeline.clips.push(freeze);
  touch(working);
  return {
    project: working,
    freezeClipId,
    startFrame: at,
    durationFrames: duration,
  };
}

/**
 * Moves the embedded audio of a video clip to its own audio clip. It reuses the
 * first free audio/narration track at that window and creates one otherwise;
 * the video keeps its picture and is muted so the sound never doubles.
 */
export function detachAudio(
  project: ProjectDocument,
  clipId: string,
): {
  project: ProjectDocument;
  clipId: string;
  trackId: string;
  createdTrack: boolean;
} {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) {
    throw new ProjectActionError('el clip no está en la timeline');
  }
  if (clip.kind !== 'video') {
    throw new ProjectActionError('sólo un clip de video puede separar su audio');
  }
  const owner = next.timeline.tracks.find((item) => item.id === clip.trackId);
  if (!owner || owner.locked) {
    throw new ProjectActionError('la pista del video está bloqueada');
  }
  const start = clip.startFrame;
  const end = start + clip.durationFrames;
  let target = next.timeline.tracks.find(
    (track) =>
      (track.kind === 'audio' || track.kind === 'narration') &&
      !track.locked &&
      !track.muted &&
      !next.timeline.clips.some(
        (item) =>
          item.trackId === track.id &&
          item.startFrame < end &&
          item.startFrame + item.durationFrames > start,
      ),
  );
  let createdTrack = false;
  if (!target) {
    const order = Math.max(-1, ...next.timeline.tracks.map((track) => track.order)) + 1;
    target = {
      id: newId(),
      kind: 'audio',
      label: 'Audio separado',
      order,
      muted: false,
      hidden: false,
      locked: false,
    };
    next.timeline.tracks.push(target);
    createdTrack = true;
  }
  const audio = clip.audio ? JSON.parse(JSON.stringify(clip.audio)) : {};
  delete audio.muted;
  const detached: Clip = {
    id: newId(),
    trackId: target.id,
    kind: 'audio',
    label: `${clip.label ?? 'Audio'} · audio`.slice(0, 200),
    startFrame: start,
    durationFrames: clip.durationFrames,
    source: JSON.parse(JSON.stringify(clip.source)),
    ...(clip.speed ? { speed: JSON.parse(JSON.stringify(clip.speed)) } : {}),
    ...(clip.reverse ? { reverse: true } : {}),
    ...(Object.keys(audio).length > 0 ? { audio } : {}),
    ...(clip.colorTag ? { colorTag: clip.colorTag } : {}),
  };
  next.timeline.clips.push(detached);
  clip.audio = { ...(clip.audio ?? {}), muted: true };
  touch(next);
  return {
    project: next,
    clipId: detached.id,
    trackId: target.id,
    createdTrack,
  };
}

/**
 * Closes the empty spaces between clips of one track. The first clip keeps its
 * start so overlay tracks do not jump to zero; locked tracks are rejected.
 */
export function applyAudioPresetToAll(
  project: ProjectDocument,
  preset: AudioPresetId,
): { project: ProjectDocument; applied: number; skipped: number } {
  const settings = AUDIO_PRESETS.find((item) => item.id === preset)?.settings;
  if (!settings) return { project, applied: 0, skipped: 0 };
  let next = project;
  let applied = 0;
  let skipped = 0;
  for (const clip of project.timeline.clips) {
    if (clip.kind !== 'audio') continue;
    const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
    if (!track || track.locked) {
      skipped += 1;
      continue;
    }
    const audio = { ...(clip.audio ?? {}), ...settings };
    next = updateClip(next, clip.id, { audio });
    applied += 1;
  }
  return { project: next, applied, skipped };
}

export function applyTransitionToCuts(
  project: ProjectDocument,
  options: {
    type?: ClipTransition['type'];
    frames?: number;
    trackIds?: readonly string[];
  } = {},
): { project: ProjectDocument; applied: number } {
  const type = options.type ?? 'dissolve';
  const frames = Math.max(1, Math.round(options.frames ?? 12));
  const next = cloneProject(project);
  let applied = 0;
  for (const track of next.timeline.tracks) {
    if (track.locked) continue;
    if (options.trackIds && !options.trackIds.includes(track.id)) continue;
    const clips = next.timeline.clips
      .filter((clip) => clip.trackId === track.id)
      .sort((a, b) => a.startFrame - b.startFrame);
    for (let index = 1; index < clips.length; index += 1) {
      const previous = clips[index - 1]!;
      const clip = clips[index]!;
      if (previous.startFrame + previous.durationFrames !== clip.startFrame) continue;
      if (
        clip.kind !== 'video' &&
        clip.kind !== 'image' &&
        clip.kind !== 'freeze'
      ) {
        continue;
      }
      if (
        previous.kind !== 'video' &&
        previous.kind !== 'image' &&
        previous.kind !== 'freeze'
      ) {
        continue;
      }
      const target = clip as Clip & { transitionIn?: ClipTransition };
      target.transitionIn = {
        type,
        frames: Math.min(frames, clip.durationFrames),
      };
      applied += 1;
    }
  }
  if (applied === 0) return { project, applied };
  touch(next);
  return { project: next, applied };
}

export function closeGaps(
  project: ProjectDocument,
  trackId: string,
): { project: ProjectDocument; moved: number; removedFrames: number } {
  const next = cloneProject(project);
  const track = next.timeline.tracks.find((item) => item.id === trackId);
  if (!track) {
    throw new ProjectActionError('la pista no está en el proyecto');
  }
  if (track.locked) {
    throw new ProjectActionError('la pista está bloqueada');
  }
  const clips = next.timeline.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
  if (clips.length < 2) {
    return { project, moved: 0, removedFrames: 0 };
  }
  let cursor = clips[0]!.startFrame;
  let moved = 0;
  let removedFrames = 0;
  for (const clip of clips) {
    if (clip.startFrame !== cursor) {
      removedFrames += Math.max(0, clip.startFrame - cursor);
      clip.startFrame = cursor;
      moved += 1;
    }
    cursor += clip.durationFrames;
  }
  if (moved > 0) touch(next);
  return { project: moved > 0 ? next : project, moved, removedFrames };
}

/**
 * Splits every unlocked clip that crosses a marker frame. It turns chapter
 * markers into editable segments without rippling or changing durations.
 */
export function splitClipsAtMarkers(
  project: ProjectDocument,
  options: { trackIds?: readonly string[] } = {},
): { project: ProjectDocument; cuts: number; clips: number; skippedTracks: number } {
  const frames = [
    ...new Set(
      project.markers
        .map((marker) => marker.frame)
        .filter((frame) => frame > 0),
    ),
  ].sort((a, b) => a - b);
  if (frames.length === 0) {
    return { project, cuts: 0, clips: 0, skippedTracks: 0 };
  }
  let next = project;
  let cuts = 0;
  let clips = 0;
  const skipped = new Set<string>();
  const originals = [...project.timeline.clips];
  for (const clip of originals) {
    const track = project.timeline.tracks.find((item) => item.id === clip.trackId);
    if (!track) continue;
    if (options.trackIds && !options.trackIds.includes(track.id)) continue;
    const inside = frames.filter(
      (frame) =>
        frame > clip.startFrame && frame < clip.startFrame + clip.durationFrames,
    );
    if (inside.length === 0) continue;
    if (track.locked) {
      skipped.add(track.id);
      continue;
    }
    const result = splitClipAtFrames(next, clip.id, inside);
    if (!result) continue;
    next = result.project;
    cuts += Math.max(0, result.clipIds.length - 1);
    clips += 1;
  }
  return {
    project: next,
    cuts,
    clips,
    skippedTracks: skipped.size,
  };
}

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

/**
 * Split every clip of a track at the given absolute frames. Used by beat sync:
 * the same cut list is applied to whichever clips overlap those frames.
 */
export function splitTrackAtFrames(
  project: ProjectDocument,
  trackId: string,
  frames: readonly number[],
): ProjectDocument | null {
  const track = project.timeline.tracks.find((item) => item.id === trackId);
  if (!track || track.locked) return null;
  const unique = [...new Set(frames.map((frame) => Math.round(frame)))].sort((a, b) => a - b);
  if (unique.length === 0) return null;
  const clips = project.timeline.clips
    .filter((clip) => clip.trackId === trackId)
    .map((clip) => ({
      id: clip.id,
      start: clip.startFrame,
      end: clip.startFrame + clip.durationFrames,
    }));
  let next = project;
  let changed = false;
  for (const clip of clips) {
    const inside = unique.filter((frame) => frame > clip.start && frame < clip.end);
    if (inside.length === 0) continue;
    const result = splitClipAtFrames(next, clip.id, inside);
    if (result) {
      next = result.project;
      changed = true;
    }
  }
  return changed ? next : null;
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

/**
 * Pastes a serialized clip at the requested frame. The target track is the
 * original one when it still exists, and the paste moves to the next free gap
 * on that track so it never overlaps.
 */
export function pasteClip(
  project: ProjectDocument,
  clip: Clip,
  input: { startFrame: number; trackId?: string },
): { project: ProjectDocument; clipId: string; startFrame: number; trackId: string } {
  const next = cloneProject(project);
  const target =
    (input.trackId
      ? next.timeline.tracks.find((track) => track.id === input.trackId)
      : undefined) ??
    next.timeline.tracks.find((track) => track.id === clip.trackId) ??
    next.timeline.tracks.find((track) => {
      if (clip.kind === 'video' || clip.kind === 'freeze') {
        return track.kind === 'video';
      }
      if (clip.kind === 'image') return track.kind === 'image';
      if (clip.kind === 'audio') return track.kind === 'audio' || track.kind === 'narration';
      if (clip.kind === 'graphic') return track.kind === 'graphic';
      return track.kind === 'adjustment';
    });
  if (!target) {
    throw new ProjectActionError('no hay una pista compatible para pegar el clip');
  }
  if (target.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const startFrame = findGap(
    intervalsForTrack(next, target.id),
    Math.max(0, Math.round(input.startFrame)),
    clip.durationFrames,
  );
  const id = newId();
  const copy = {
    ...JSON.parse(JSON.stringify(clip)),
    id,
    trackId: target.id,
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
  return { project: next, clipId: id, startFrame, trackId: target.id };
}

/**
 * Removes a clip and closes the gap it leaves on its own track. Other tracks
 * keep their timing.
 */
export function rippleDeleteClip(
  project: ProjectDocument,
  clipId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip) return next;
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const end = clip.startFrame + clip.durationFrames;
  const duration = clip.durationFrames;
  next.timeline.clips = next.timeline.clips.filter((item) => item.id !== clipId);
  for (const item of next.timeline.clips) {
    if (item.trackId === clip.trackId && item.startFrame >= end) {
      item.startFrame = Math.max(0, item.startFrame - duration);
    }
  }
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
    transitionIn: ClipTransition | Record<string, never>;
    reverse: boolean;
    mask: ClipMask | undefined;
    blendMode: BlendMode | undefined;
    animationIn: ClipAnimation | undefined;
    animationOut: ClipAnimation | undefined;
    colorTag: ClipColorTag | undefined;
    enabled: boolean;
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
  if ('colorTag' in patch) {
    const target = clip as Clip & { colorTag?: ClipColorTag };
    if (patch.colorTag === undefined) delete target.colorTag;
    else target.colorTag = patch.colorTag;
  }
  if (patch.enabled !== undefined) {
    if (patch.enabled) delete clip.enabled;
    else clip.enabled = false;
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
    if (
      clip.kind !== 'video' &&
      clip.kind !== 'image' &&
      clip.kind !== 'freeze' &&
      clip.kind !== 'adjustment'
    ) {
      throw new ProjectActionError('este tipo de clip no acepta efectos visuales');
    }
    if (Object.keys(patch.effects).length === 0) {
      delete clip.effects;
    } else {
      clip.effects = patch.effects;
    }
  }
  if ('motion' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta movimiento');
    }
    if (patch.motion === undefined) {
      delete clip.motion;
    } else {
      clip.motion = patch.motion;
    }
  }
  if ('chromaKey' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta chroma key');
    }
    if (patch.chromaKey === undefined) {
      delete clip.chromaKey;
    } else {
      clip.chromaKey = patch.chromaKey;
    }
  }
  if ('transitionIn' in patch && patch.transitionIn !== undefined) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta transiciones visuales');
    }
    const target = clip as Clip & { transitionIn?: ClipTransition };
    if (Object.keys(patch.transitionIn).length === 0) {
      delete target.transitionIn;
    } else {
      target.transitionIn = patch.transitionIn as ClipTransition;
    }
  }
  if (patch.reverse !== undefined) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') {
      throw new ProjectActionError('este tipo de clip no se puede reproducir al revés');
    }
    const target = clip as Clip & { reverse?: boolean };
    if (patch.reverse) target.reverse = true;
    else delete target.reverse;
  }
  if ('mask' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta máscara');
    }
    const target = clip as Clip & { mask?: ClipMask };
    if (patch.mask === undefined || Object.keys(patch.mask).length === 0) {
      delete target.mask;
    } else {
      target.mask = patch.mask;
    }
  }
  if ('blendMode' in patch) {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta modo de mezcla');
    }
    const target = clip as Clip & { blendMode?: BlendMode };
    if (patch.blendMode === undefined) delete target.blendMode;
    else target.blendMode = patch.blendMode;
  }
  for (const side of ['animationIn', 'animationOut'] as const) {
    if (!(side in patch)) continue;
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
      throw new ProjectActionError('este tipo de clip no acepta animaciones');
    }
    const target = clip as Clip & { animationIn?: ClipAnimation; animationOut?: ClipAnimation };
    const animation = patch[side];
    if (animation === undefined) {
      delete target[side];
      continue;
    }
    if (animation.durationFrames > clip.durationFrames) {
      throw new ProjectActionError('la animación no puede durar más que el clip');
    }
    target[side] = animation;
  }
  touch(next);
  return next;
}

export function setMaskKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
  values: Partial<
    Pick<
      ClipMaskKeyframe,
      'x' | 'y' | 'width' | 'height' | 'rotationDeg' | 'feather' | 'easing'
    >
  >,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !('mask' in clip) || !clip.mask) {
    throw new ProjectActionError('el clip no tiene una máscara para animar');
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const rounded = Math.round(frame);
  if (rounded < 0 || rounded >= clip.durationFrames) {
    throw new ProjectActionError('el keyframe de máscara debe caer dentro del clip');
  }
  const properties = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(properties).length === 0) {
    throw new ProjectActionError('capturá al menos una propiedad de la máscara');
  }
  const keyframe = { frame: rounded, ...properties } as ClipMaskKeyframe;
  const keyframes = [...(clip.mask.keyframes ?? [])];
  const index = keyframes.findIndex((item) => item.frame === rounded);
  if (index >= 0) keyframes[index] = keyframe;
  else keyframes.push(keyframe);
  keyframes.sort((a, b) => a.frame - b.frame);
  if (keyframes.length > 32) {
    throw new ProjectActionError('la máscara admite como máximo 32 keyframes');
  }
  clip.mask = { ...clip.mask, keyframes };
  touch(next);
  return next;
}

export function removeMaskKeyframe(
  project: ProjectDocument,
  clipId: string,
  frame: number,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !('mask' in clip) || !clip.mask?.keyframes) {
    return next;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const keyframes = clip.mask.keyframes.filter((item) => item.frame !== frame);
  if (keyframes.length === 0) {
    const { keyframes: _keyframes, ...rest } = clip.mask;
    clip.mask = rest;
  } else {
    clip.mask = { ...clip.mask, keyframes };
  }
  touch(next);
  return next;
}

export function clearMaskKeyframes(
  project: ProjectDocument,
  clipId: string,
): ProjectDocument {
  const next = cloneProject(project);
  const clip = next.timeline.clips.find((item) => item.id === clipId);
  if (!clip || !('mask' in clip) || !clip.mask?.keyframes) {
    return next;
  }
  if (next.timeline.tracks.find((item) => item.id === clip.trackId)?.locked) {
    throw new ProjectActionError('la pista del clip está bloqueada');
  }
  const { keyframes: _keyframes, ...rest } = clip.mask;
  clip.mask = rest;
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

/**
 * Current look at a clip-relative frame, ready to pin as a keyframe.
 *
 * `scale` is captured as the uniform keyframe multiplier on top of the static
 * scaleX/scaleY, so pinning a key does not reset a clip that was already
 * scaled. Offsets, rotation and opacity fall back to the static transform.
 */
export function captureTransformKeyframe(clip: Clip, frame: number): TransformKeyframePatch {
  const transform = clip.transform ?? {};
  const sampled = sampleTransformKeyframes(transform.keyframes ?? [], frame);
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return {
    offsetX: Math.round(sampled.offsetX ?? transform.offsetX ?? 0),
    offsetY: Math.round(sampled.offsetY ?? transform.offsetY ?? 0),
    scale: round(sampled.scale ?? 1),
    rotationDeg: round(sampled.rotationDeg ?? transform.rotationDeg ?? 0),
    opacity: round(sampled.opacity ?? transform.opacity ?? 1),
  };
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
  if (patch.easing !== undefined) {
    if (
      patch.easing !== 'linear' &&
      patch.easing !== 'ease-in' &&
      patch.easing !== 'ease-out' &&
      patch.easing !== 'ease-in-out' &&
      patch.easing !== 'hold'
    ) {
      throw new ProjectActionError('la curva de la clave no es válida');
    }
    clean.easing = patch.easing;
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
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'freeze') {
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
  if (index < 0 && Object.keys(clean).every((key) => key === 'easing')) {
    throw new ProjectActionError('la clave necesita al menos una propiedad animada');
  }
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
  easing: NonNullable<ClipGainKeyframe['easing']> = 'linear',
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
  if (
    easing !== 'linear' &&
    easing !== 'ease-in' &&
    easing !== 'ease-out' &&
    easing !== 'ease-in-out' &&
    easing !== 'hold'
  ) {
    throw new ProjectActionError('la curva de la clave de volumen no es válida');
  }
  const offset = Math.round(frame);
  if (offset < 0 || offset >= clip.durationFrames) {
    throw new ProjectActionError('la clave debe caer dentro del clip');
  }
  const audio = { ...(clip.audio ?? {}) };
  const keyframes = (audio.gainKeyframes ?? []).map((keyframe) => ({ ...keyframe }));
  const index = keyframes.findIndex((keyframe) => keyframe.frame === offset);
  if (index >= 0) {
    keyframes[index] = { frame: offset, gainDb, easing };
  } else {
    if (keyframes.length >= MAX_GAIN_KEYFRAMES) {
      throw new ProjectActionError(
        `este clip ya tiene el máximo de ${MAX_GAIN_KEYFRAMES} keyframes de volumen`,
      );
    }
    keyframes.push({ frame: offset, gainDb, easing });
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

export function moveTrack(
  project: ProjectDocument,
  trackId: string,
  direction: 'up' | 'down',
): ProjectDocument {
  const next = cloneProject(project);
  const sorted = [...next.timeline.tracks].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((item) => item.id === trackId);
  if (index < 0) {
    throw new ProjectActionError('la pista no existe');
  }
  const target = direction === 'up' ? index + 1 : index - 1;
  if (target < 0 || target >= sorted.length) {
    return project;
  }
  const track = sorted[index]!;
  const neighbour = sorted[target]!;
  const order = track.order;
  track.order = neighbour.order;
  neighbour.order = order;
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

/**
 * Titles are caption cues on their own track and style. They burn through the
 * same ASS renderer, never overlap the subtitle track, and stay editable.
 */
export function addTitleCue(
  project: ProjectDocument,
  input: { text: string; startFrame?: number; durationFrames?: number; styleId?: string },
): { project: ProjectDocument; cueId: string; startFrame: number; trackId: string; styleId: string } {
  const text = input.text.trim();
  if (!text) {
    throw new ProjectActionError('el título está vacío');
  }
  const next = cloneProject(project);
  const fps = fpsOf(next);
  const duration = Math.max(1, input.durationFrames ?? Math.round(3 * fps));
  let track = next.timeline.tracks.find(
    (item) => item.kind === 'caption' && item.label === 'Títulos',
  );
  if (!track) {
    const order = Math.max(-1, ...next.timeline.tracks.map((item) => item.order)) + 1;
    track = {
      id: newId(),
      kind: 'caption',
      label: 'Títulos',
      order,
      muted: false,
      hidden: false,
      locked: false,
    };
    next.timeline.tracks.push(track);
  }
  if (track.locked) {
    throw new ProjectActionError('la pista de títulos está bloqueada');
  }
  let style = input.styleId
    ? next.captions.styles.find((item) => item.id === input.styleId)
    : next.captions.styles.find((item) => item.name === 'Título');
  if (input.styleId && !style) {
    throw new ProjectActionError('el estilo de título elegido no existe');
  }
  if (!style) {
    style = {
      id: newId(),
      name: 'Título',
      fontFamily: next.captions.styles[0]?.fontFamily ?? 'Arial',
      fontSizePx: 92,
      color: '#ffffff',
      outlineColor: '#000000',
      position: 'center',
    };
    next.captions.styles.push(style);
  }
  const cues = next.captions.cues.filter((cue) => cue.trackId === track.id);
  const start = findGap(
    cues.map((cue) => ({ start: cue.startFrame, end: cue.endFrame })),
    input.startFrame ?? 0,
    duration,
  );
  const cue: CaptionCue = {
    id: newId(),
    trackId: track.id,
    styleId: style.id,
    text: text.slice(0, 500),
    language: next.language,
    startFrame: start,
    endFrame: start + duration,
    animation: 'pop',
  };
  next.captions.cues.push(cue);
  touch(next);
  return {
    project: next,
    cueId: cue.id,
    startFrame: start,
    trackId: track.id,
    styleId: style.id,
  };
}

/**
 * Adds a title cue with a dedicated caption style for a visual template.
 * The style is reused by name so several titles share one editable look.
 */
export function addTitleFromTemplate(
  project: ProjectDocument,
  input: {
    text: string;
    startFrame?: number;
    durationFrames?: number;
    template: {
      id: string;
      name: string;
      style: Omit<CaptionStyle, 'id' | 'name'>;
      animation?: CaptionCue['animation'];
    };
  },
): { project: ProjectDocument; cueId: string; startFrame: number; styleId: string } {
  const styled = cloneProject(project);
  const styleName = `Plantilla · ${input.template.name}`;
  let style = styled.captions.styles.find((item) => item.name === styleName);
  if (!style) {
    style = {
      id: newId(),
      name: styleName,
      ...input.template.style,
    };
    styled.captions.styles.push(style);
    touch(styled);
  }
  const added = addTitleCue(styled, {
    text: input.text,
    ...(input.startFrame !== undefined ? { startFrame: input.startFrame } : {}),
    ...(input.durationFrames !== undefined ? { durationFrames: input.durationFrames } : {}),
    styleId: style.id,
  });
  if (input.template.animation) {
    const cue = added.project.captions.cues.find((item) => item.id === added.cueId);
    if (cue) cue.animation = input.template.animation;
  }
  return added;
}

/** Imports SRT/VTT cues into the main caption track. */
export function importSubtitleCues(
  project: ProjectDocument,
  cues: readonly { startSeconds: number; endSeconds: number; text: string }[],
  options?: { replace?: boolean; styleId?: string },
): { project: ProjectDocument; added: number; skipped: number; trackId: string } {
  const setup = ensureCaptionSetup(project);
  const next = cloneProject(setup.project);
  const track = next.timeline.tracks.find((item) => item.id === setup.trackId);
  if (track?.locked) {
    throw new ProjectActionError('la pista de subtítulos está bloqueada');
  }
  if (options?.replace !== false) {
    next.captions.cues = next.captions.cues.filter(
      (cue) => cue.trackId !== setup.trackId,
    );
  }
  const fps = fpsOf(next);
  let added = 0;
  let skipped = 0;
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!text || !Number.isFinite(cue.startSeconds) || cue.endSeconds <= cue.startSeconds) {
      skipped += 1;
      continue;
    }
    const startFrame = Math.max(0, Math.round(cue.startSeconds * fps));
    const endFrame = Math.max(startFrame + 1, Math.round(cue.endSeconds * fps));
    next.captions.cues.push({
      id: newId(),
      trackId: setup.trackId,
      styleId: options?.styleId ?? setup.styleId,
      text,
      language: next.language,
      startFrame,
      endFrame,
    });
    added += 1;
  }
  touch(next);
  return { project: next, added, skipped, trackId: setup.trackId };
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
  patch: Partial<
    Pick<
      CaptionCue,
      | 'text'
      | 'startFrame'
      | 'endFrame'
      | 'styleId'
      | 'animation'
      | 'wordReveal'
    >
  > & { motion?: CaptionMotion | null },
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
  if (patch.animation !== undefined) {
    if (patch.animation === 'none') delete cue.animation;
    else cue.animation = patch.animation;
  }
  if (patch.wordReveal !== undefined) {
    if (patch.wordReveal) cue.wordReveal = true;
    else delete cue.wordReveal;
  }
  if ('motion' in patch) {
    if (patch.motion) cue.motion = patch.motion as CaptionMotion;
    else delete cue.motion;
  }
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
    backgroundColor: string;
    bold: boolean;
    italic: boolean;
    borderStyle: 'outline' | 'box';
    shadow: boolean;
    depth3d: number;
    depthColor: string;
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
  if (patch.backgroundColor !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.backgroundColor)) {
      throw new ProjectActionError('el fondo debe ser un hex como #0b0e13');
    }
    style.backgroundColor = patch.backgroundColor;
  }
  if (patch.bold !== undefined) style.bold = patch.bold;
  if (patch.italic !== undefined) style.italic = patch.italic;
  if (patch.borderStyle !== undefined) style.borderStyle = patch.borderStyle;
  if (patch.shadow !== undefined) style.shadow = patch.shadow;
  if (patch.depth3d !== undefined) {
    style.depth3d = Math.max(0, Math.min(12, Math.round(patch.depth3d)));
  }
  if (patch.depthColor !== undefined) {
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(patch.depthColor)) {
      throw new ProjectActionError('el color 3D debe ser un hex como #f43f5e');
    }
    style.depthColor = patch.depthColor;
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

export function updateProjectLook(
  project: ProjectDocument,
  patch: Partial<ClipEffects> | null,
): ProjectDocument {
  const next = cloneProject(project);
  if (patch === null) {
    delete next.look;
  } else {
    const look: ClipEffects = { ...(next.look ?? {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete look[key as keyof ClipEffects];
      else (look as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(look).length === 0) delete next.look;
    else next.look = look;
  }
  touch(next);
  return next;
}

/** Replaces the whole project look, used by presets so no stale fields survive. */
export function setProjectLook(
  project: ProjectDocument,
  look: ClipEffects | null,
): ProjectDocument {
  const next = cloneProject(project);
  if (look === null || Object.keys(look).length === 0) delete next.look;
  else next.look = look;
  touch(next);
  return next;
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
