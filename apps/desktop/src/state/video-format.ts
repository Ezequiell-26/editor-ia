import type { Clip, ProjectDocument } from '@editor-ia/project-schema';

/**
 * Project format helpers: any integer aspect ratio, any practical frame rate.
 *
 * Changing the frame rate retimes every frame-based value while preserving the
 * wall-clock position. Boundaries are converted from their absolute frame so
 * adjacent clips keep sharing the same cut after rounding. Clips with a non-1×
 * speed are refused because their exact source/timeline identity cannot be
 * preserved for every new rate; the UI tells the user to set them back to 1×.
 */

export interface FpsPreset {
  readonly id: string;
  readonly label: string;
  readonly num: number;
  readonly den: number;
}

export const FPS_PRESETS: readonly FpsPreset[] = [
  { id: '23.976', label: '23,976 (cine)', num: 24_000, den: 1_001 },
  { id: '24', label: '24', num: 24, den: 1 },
  { id: '25', label: '25 (PAL)', num: 25, den: 1 },
  { id: '29.97', label: '29,97 (NTSC)', num: 30_000, den: 1_001 },
  { id: '30', label: '30', num: 30, den: 1 },
  { id: '50', label: '50', num: 50, den: 1 },
  { id: '59.94', label: '59,94', num: 60_000, den: 1_001 },
  { id: '60', label: '60', num: 60, den: 1 },
  { id: '120', label: '120', num: 120, den: 1 },
];

export interface FormatPreset {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly width: number;
  readonly height: number;
}

export const FORMAT_PRESETS: readonly FormatPreset[] = [
  { id: 'landscape', label: '16:9 horizontal', note: 'YouTube, tutoriales, escritorio', width: 1920, height: 1080 },
  { id: 'vertical', label: '9:16 vertical', note: 'Shorts, Reels, TikTok', width: 1080, height: 1920 },
  { id: 'square', label: '1:1 cuadrado', note: 'Feed, carrusel, Instagram', width: 1080, height: 1080 },
  { id: 'portrait', label: '4:5 retrato', note: 'Feed vertical', width: 1080, height: 1350 },
  { id: 'classic', label: '4:3 clásico', note: 'Archivo, presentaciones', width: 1440, height: 1080 },
  { id: 'cinema', label: '21:9 cine', note: 'Cine, YouTube cinematográfico', width: 2560, height: 1080 },
];

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

/** Simplified integer ratio, e.g. 1920×1080 → 16:9, 1366×768 → 683:384. */
export function aspectRatioOf(width: number, height: number): string {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const divisor = gcd(safeWidth, safeHeight);
  return `${safeWidth / divisor}:${safeHeight / divisor}`;
}

/** H.264 yuv420p needs even dimensions; clamp to the supported range. */
export function evenDimension(value: number, fallback = 1920): number {
  if (!Number.isFinite(value)) return fallback;
  const clamped = Math.max(16, Math.min(32_768, Math.round(value)));
  return clamped % 2 === 0 ? clamped : Math.min(32_768, clamped + 1);
}

export function formatFps(num: number, den: number): string {
  if (!num || !den) return '30';
  const value = num / den;
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function fpsOfFormat(num: number, den: number): number {
  return den > 0 ? num / den : 30;
}

export function validFpsRange(num: number, den: number): boolean {
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return false;
  const value = num / den;
  return value >= 1 && value <= 240;
}

function isWindowed(clip: Clip): clip is Extract<Clip, { kind: 'video' | 'audio' }> {
  return clip.kind === 'video' || clip.kind === 'audio';
}

function speedOf(clip: Clip): { num: number; den: number } {
  const speed = (clip as { speed?: { num: number; den: number } }).speed;
  return { num: speed?.num ?? 1, den: speed?.den ?? 1 };
}

function hasNonUnitSpeed(project: ProjectDocument): boolean {
  return project.timeline.clips.some((clip) => {
    const { num, den } = speedOf(clip);
    return num !== den;
  });
}

/**
 * Return a copy of the project with every frame-based field mapped to the new
 * rate. Throws when a speed-adjusted clip cannot keep its exact identity.
 */
export function retimeProject(
  project: ProjectDocument,
  nextNum: number,
  nextDen: number,
): ProjectDocument {
  const num = Math.max(1, Math.round(nextNum));
  const den = Math.max(1, Math.round(nextDen));
  const oldNum = project.video.frameRate.num;
  const oldDen = project.video.frameRate.den;
  if (num === oldNum && den === oldDen) return project;
  if (hasNonUnitSpeed(project)) {
    throw new Error(
      'Para cambiar los fps, poné primero los clips con velocidad distinta de 1× en 1×. Así se conserva la identidad exacta de cada clip.',
    );
  }
  const next = structuredClone(project) as ProjectDocument;
  const ratio = (num / den) / (oldNum / oldDen);
  const frame = (value: number, min: number): number =>
    Math.max(min, Math.round(value * ratio));

  for (const asset of next.assets) {
    if ('media' in asset && asset.media && 'durationFrames' in asset.media) {
      asset.media.durationFrames = frame(asset.media.durationFrames, 1);
    }
  }

  for (const clip of next.timeline.clips) {
    const newStart = frame(clip.startFrame, 0);
    const newEnd = frame(clip.startFrame + clip.durationFrames, newStart + 1);
    clip.startFrame = newStart;
    clip.durationFrames = Math.max(1, newEnd - newStart);
    const effects = (clip as { effects?: { fadeInFrames?: number; fadeOutFrames?: number } }).effects;
    if (effects?.fadeInFrames !== undefined) effects.fadeInFrames = frame(effects.fadeInFrames, 1);
    if (effects?.fadeOutFrames !== undefined) effects.fadeOutFrames = frame(effects.fadeOutFrames, 1);
    const audio = (clip as { audio?: { fadeInFrames?: number; fadeOutFrames?: number } }).audio;
    if (audio?.fadeInFrames !== undefined) audio.fadeInFrames = frame(audio.fadeInFrames, 1);
    if (audio?.fadeOutFrames !== undefined) audio.fadeOutFrames = frame(audio.fadeOutFrames, 1);
    if (isWindowed(clip)) {
      const asset = next.assets.find(
        (item) => 'id' in item && item.id === clip.source.assetId,
      );
      const mediaDuration =
        asset && 'media' in asset && asset.media && 'durationFrames' in asset.media
          ? asset.media.durationFrames
          : undefined;
      // Speed is 1× here (non-unit speed was refused), so the source window
      // must equal the timeline duration exactly. The source in-point is
      // converted and the out-point follows the rounded duration.
      const sourceIn = frame(clip.source.inFrame, 0);
      clip.source.inFrame =
        mediaDuration !== undefined ? Math.min(sourceIn, mediaDuration - 1) : sourceIn;
      clip.source.outFrame = clip.source.inFrame + clip.durationFrames;
      if (mediaDuration !== undefined && clip.source.outFrame > mediaDuration) {
        clip.source.outFrame = mediaDuration;
        clip.durationFrames = Math.max(1, clip.source.outFrame - clip.source.inFrame);
      }
    }
  }

  for (const cue of next.captions.cues) {
    const start = frame(cue.startFrame, 0);
    const end = frame(cue.endFrame, start + 1);
    cue.startFrame = start;
    cue.endFrame = Math.max(start + 1, end);
    for (const word of cue.words ?? []) {
      const wordStart = frame(word.startFrame, 0);
      const wordEnd = frame(word.endFrame, wordStart + 1);
      word.startFrame = wordStart;
      word.endFrame = Math.max(wordStart + 1, wordEnd);
    }
  }

  for (const scene of next.scenes) {
    if (scene.narration.estimatedDurationFrames !== undefined) {
      scene.narration.estimatedDurationFrames = frame(scene.narration.estimatedDurationFrames, 1);
    }
  }
  if (next.audio.music?.fadeInFrames !== undefined) {
    next.audio.music.fadeInFrames = frame(next.audio.music.fadeInFrames, 1);
  }
  if (next.audio.music?.fadeOutFrames !== undefined) {
    next.audio.music.fadeOutFrames = frame(next.audio.music.fadeOutFrames, 1);
  }

  next.video.frameRate = { num, den };
  for (const profile of next.renderProfiles) {
    profile.frameRate = { num, den };
    profile.qualityGate.durationToleranceFrames = Math.min(
      600,
      frame(profile.qualityGate.durationToleranceFrames, 0),
    );
  }
  next.revision += 1;
  next.updatedAt = new Date().toISOString();
  return next;
}
